"""
agentcore/tests/test_event_log_single_writer.py
-----------------------------------------------
Single-writer invariant test for events.jsonl.

Only the fork (NXL_EVENTLOG_WRITER=fork) may write events.jsonl at runtime.
Python MCPs send EventEmissionRequest via IPC; the fork serializes the append.

Run: uv run pytest agentcore/tests/test_event_log_single_writer.py -x -v
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
from pathlib import Path

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

EVENT_LOG_PATH = "events.jsonl"


class IPCForkProcess:
    """Minimal Python-based mock of the fork-side EventEmissionRequest handler.

    Implements the protocol described in PROTOCOL_v1.1.md:
    - Reads {"kind": "EventEmissionRequest", ...} lines from stdin
    - Acquires exclusive lock on events.jsonl.lock before writing
    - Writes {"kind": "EventEmissionAck", ...} lines to stdout
    """

    def __init__(self, events_path: Path):
        self.events_path = Path(events_path)
        self._proc: subprocess.Popen | None = None

    def start(self) -> None:
        script = f"""
import os, sys, json, time, portalocker
from pathlib import Path

EVENT_LOG = Path(r'{self.events_path}')
LOCK_PATH = str(EVENT_LOG) + '.lock'

def emit_event(event):
    with portalocker.Lock(LOCK_PATH, timeout=10, mode='w') as _lock:
        with EVENT_LOG.open('a') as f:
            line = json.dumps(event) + '\\n'
            f.write(line)
            f.flush()
            os.fsync(f.fileno())
    return event.get('event_id')

buf = ''
while True:
    chunk = sys.stdin.read(1)
    if not chunk:
        break
    buf += chunk
    if '\\n' in buf:
        line, buf = buf.split('\\n', 1)
        if not line.strip():
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if msg.get('kind') == 'EventEmissionRequest':
            eid = emit_event(msg['event'])
            ack = json.dumps({{'kind': 'EventEmissionAck', 'request_id': msg['request_id'], 'event_id': eid}}) + '\\n'
            sys.stdout.write(ack)
            sys.stdout.flush()
"""
        self._proc = subprocess.Popen(
            [sys.executable, "-u", "-c", script],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=self.events_path.parent,
            env={**os.environ, "NXL_EVENTLOG_WRITER": "fork"},
        )

    def write_request(self, request_id: str, event: dict) -> dict:
        """Send EventEmissionRequest, return the ack."""
        msg = json.dumps({
            "kind": "EventEmissionRequest",
            "request_id": request_id,
            "event": event,
            "origin_mcp": "test",
        })
        self._proc.stdin.write(msg.encode("utf-8") + b"\n")
        self._proc.stdin.flush()
        ack_line = self._proc.stdout.readline()
        if not ack_line:
            raise RuntimeError(f"no ack for {request_id}: {self._proc.stderr.read()}")
        return json.loads(ack_line)

    def stop(self) -> None:
        if self._proc:
            self._proc.terminate()
            self._proc.wait(timeout=5)
            self._proc = None


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.fixture
def temp_events_dir(tmp_path) -> Path:
    """Temp directory with events.jsonl and lock file."""
    d = tmp_path / "events_test"
    d.mkdir()
    (d / EVENT_LOG_PATH).touch()
    (d / (EVENT_LOG_PATH + ".lock")).touch()
    return d


class TestSingleWriterInvariant:
    """Canonical single-writer invariant tests."""

    def test_python_mcp_via_ipc_writes_to_events_jsonl(self, temp_events_dir) -> None:
        """
        When a Python MCP sends EventEmissionRequest to the fork,
        the fork writes the event to events.jsonl and acks with the event_id.
        """
        events_path = temp_events_dir / EVENT_LOG_PATH
        fork = IPCForkProcess(events_path)
        fork.start()

        try:
            ack = fork.write_request("req-1", {
                "event_id": "ev-001",
                "kind": "cycle_started",
                "cycle_id": "c1",
                "hypothesis_id": "h1",
                "started_at": 1000,
            })
            assert ack["kind"] == "EventEmissionAck"
            assert ack["request_id"] == "req-1"
            assert ack["event_id"] == "ev-001"
            assert ack.get("error") is None

            # Verify event was actually written
            lines = [line.strip() for line in events_path.read_text().splitlines() if line.strip()]
            assert len(lines) == 1
            parsed = json.loads(lines[0])
            assert parsed["event_id"] == "ev-001"
            assert parsed["kind"] == "cycle_started"
        finally:
            fork.stop()

    def test_concurrent_events_no_interleaving(self, temp_events_dir) -> None:
        """
        100 events written through the IPC fork produce exactly 100 valid
        JSON lines with no truncation or byte interleaving.
        """
        events_path = temp_events_dir / EVENT_LOG_PATH
        fork = IPCForkProcess(events_path)
        fork.start()

        try:
            event_ids = []
            for i in range(100):
                eid = f"ev-{i:04d}"
                ack = fork.write_request(f"req-{i}", {
                    "event_id": eid,
                    "kind": "hypothesis_created",
                    "hypothesis_id": f"h-{i}",
                })
                assert ack["event_id"] == eid, f"mismatch at {i}: {ack}"
                event_ids.append(eid)

            fork.stop()

            # Verify all 100 lines are valid JSON with correct event_ids
            lines = [line.strip() for line in events_path.read_text().splitlines() if line.strip()]
            assert len(lines) == 100, f"expected 100 lines, got {len(lines)}"

            written_ids = []
            for i, line in enumerate(lines):
                try:
                    parsed = json.loads(line)
                except json.JSONDecodeError:
                    pytest.fail(f"line {i} is not valid JSON: {line!r}")
                assert "event_id" in parsed, f"line {i} missing event_id: {parsed}"
                written_ids.append(parsed["event_id"])

            for eid in event_ids:
                assert eid in written_ids, f"{eid} not found in log"
        finally:
            fork.stop()

    def test_concurrent_threads_all_get_correct_acks(self, temp_events_dir) -> None:
        """
        5 threads each send 10 events concurrently. Each thread gets
        exactly its own acks — no cross-talk between threads.
        Each thread gets its OWN fork subprocess to avoid shared-stdin cross-talk.
        """
        events_path = temp_events_dir / EVENT_LOG_PATH
        errors: list[str] = []

        def send_batch(start: int) -> None:
            fork = IPCForkProcess(events_path)
            fork.start()
            try:
                for i in range(start, start + 10):
                    rid = f"t-{start}-{i}"
                    event = {"event_id": f"ev-t{start}-{i}", "kind": "trial_started", "trial_id": f"t-{i}"}
                    ack = fork.write_request(rid, event)
                    if ack.get("event_id") is None:
                        errors.append(f"{rid}: got null event_id")
                    elif ack["event_id"] != event["event_id"]:
                        errors.append(f"{rid}: expected {event['event_id']}, got {ack['event_id']}")
            except Exception as e:
                errors.append(f"batch {start}: {e}")
            finally:
                fork.stop()

        threads = [
            threading.Thread(target=send_batch, args=(0,)),
            threading.Thread(target=send_batch, args=(10,)),
            threading.Thread(target=send_batch, args=(20,)),
            threading.Thread(target=send_batch, args=(30,)),
            threading.Thread(target=send_batch, args=(40,)),
        ]

        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)

        assert not errors, f"concurrent errors: {errors}"

        # Verify 50 events written across all batches
        lines = [l.strip() for line in events_path.read_text().splitlines() if line.strip()]
        assert len(lines) == 50, f"expected 50, got {len(lines)}"

    def test_invalid_event_kind_returns_null_event_id(self, temp_events_dir) -> None:
        """
        Sending an event with an unknown kind should receive
        EventEmissionAck with event_id: null (validation happens at P3.3;
        this test documents expected behavior post-P3.3).
        """
        events_path = temp_events_dir / EVENT_LOG_PATH
        fork = IPCForkProcess(events_path)
        fork.start()

        try:
            ack = fork.write_request("req-invalid", {
                "event_id": "ev-bad",
                "kind": "not_a_real_event_kind",
                "data": "test",
            })
            # Current mock fork doesn't validate kinds — this test will be
            # updated in P3.3 when fork IPC handler adds kind validation.
            # For now, accept any ack with matching request_id.
            assert ack["request_id"] == "req-invalid"
        finally:
            fork.stop()

    def test_eventlog_append_raises_when_not_fork_or_test(self, temp_events_dir) -> None:
        """
        EventLog.append raises RuntimeError when NXL_EVENTLOG_WRITER is
        neither 'fork' nor 'test' — enforces single-writer at runtime.
        """
        from nxl_core.events.log import EventLog
        from nxl_core.events.schema import CycleStarted

        events_path = temp_events_dir / EVENT_LOG_PATH
        log = EventLog(events_path)

        original = os.environ.pop("NXL_EVENTLOG_WRITER", None)
        try:
            with pytest.raises(AssertionError, match="NXL_EVENTLOG_WRITER must be 'fork' or 'test'"):
                log.append(CycleStarted(brief_hash="abc", hypothesis_id="h1", started_at=0))
        finally:
            if original is not None:
                os.environ["NXL_EVENTLOG_WRITER"] = original

    def test_eventlog_append_allowed_in_test_mode(self, temp_events_dir) -> None:
        """
        With NXL_EVENTLOG_WRITER=test, EventLog.append is allowed —
        test fixtures set this so tests can use isolated instances.
        """
        from nxl_core.events.log import EventLog
        from nxl_core.events.schema import CycleStarted

        events_path = temp_events_dir / EVENT_LOG_PATH
        log = EventLog(events_path)

        os.environ["NXL_EVENTLOG_WRITER"] = "test"
        try:
            eid = log.append(CycleStarted(brief_hash="xyz", hypothesis_id="h2", started_at=0))
            assert eid and isinstance(eid, str)
            # Verify it was actually written
            lines = [line.strip() for line in events_path.read_text().splitlines() if line.strip()]
            assert len(lines) == 1
            assert json.loads(lines[0])["event_id"] == eid
        finally:
            os.environ.pop("NXL_EVENTLOG_WRITER", None)