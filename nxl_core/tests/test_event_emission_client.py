"""
nxl_core/tests/test_event_emission_client.py
---------------------------------------------
Tests for nxl_core.events.ipc EventEmissionClient.

Run: uv run pytest nxl_core/tests/test_event_emission_client.py -x -v
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time

import pytest

from nxl_core.events.ipc import (
    EventEmissionClient,
    EventEmissionError,
    EventEmissionTimeoutError,
)


# ---------------------------------------------------------------------------
# Fork subprocess helpers
# ---------------------------------------------------------------------------

def make_fork_handler(responses: list[dict]):
    """Generate a Python fork handler script that returns `responses` for requests."""
    # Build code line by line to avoid escape issues with \n in template
    responses_repr = str(responses)
    lines = [
        'import sys, json, threading, time',
        'idx = 0',
        'lock = threading.Lock()',
        'buf = ""',
        '',
        'def read_request():',
        '    global buf, idx',
        '    while True:',
        '        chunk = sys.stdin.read(1)',
        '        if not chunk:',
        '            return',
        '        buf += chunk',
        '        if chr(10) in buf:',
        '            line, buf = buf.split(chr(10), 1)',
        '            if not line.strip():',
        '                continue',
        '            try:',
        '                msg = json.loads(line)',
        '                rid = msg.get("request_id", "")',
        '                eid = str(msg.get("event", {}).get("event_id", ""))',
        '                error = None',
        '                if idx < len(' + responses_repr + '):',
        '                    r = ' + responses_repr + '[idx]',
        '                    eid = str(r.get("event_id", eid)) or eid',
        '                    error = r.get("error", "") or None',
        '                    idx += 1',
        '                ack = {"kind": "EventEmissionAck", "request_id": rid, "event_id": eid if not error else None, "error": error}',
        '                sys.stdout.write(json.dumps(ack) + chr(10))',
        '                sys.stdout.flush()',
        '            except Exception:',
        '                pass',
        '    time.sleep(3600)',
        '',
        't = threading.Thread(target=read_request, daemon=True)',
        't.start()',
        't.join(timeout=3600)',
    ]
    code = '\n'.join(lines) + '\n'
    fd, path = tempfile.mkstemp(suffix='.py')
    os.write(fd, code.encode('utf-8'))
    os.close(fd)
    return path


RESPONSES_LIST = [
    {'event_id': 'ev-123'},
]


class EventEmissionFork:
    """Subprocess fork that speaks the EventEmissionRequest/Ack protocol."""
    def __init__(self, responses: list[dict]):
        script_path = make_fork_handler(responses)
        self._proc = subprocess.Popen(
            [sys.executable, '-u', script_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        time.sleep(0.15)  # let subprocess start
        os.unlink(script_path)  # clean up temp file after fork started

    def emit(self, event: dict, origin_mcp: str) -> str:
        """Send event through EventEmissionClient using this fork's pipes."""
        client = EventEmissionClient(
            stdout=self._proc.stdin,
            stdin=self._proc.stdout,
            timeout=5.0,
        )
        return client.emit(event, origin_mcp)

    def stop(self) -> None:
        self._proc.terminate()
        self._proc.wait(timeout=5)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestEventEmissionClient:
    def test_valid_event_returns_event_id(self) -> None:
        """Valid event → ack with event_id matching the event."""
        fork = EventEmissionFork([{'event_id': 'ev-123'}])
        try:
            event_id = fork.emit(
                {'event_id': 'ev-123', 'kind': 'cycle_started', 'brief_hash': 'abc', 'hypothesis_id': 'h1', 'started_at': 0},
                origin_mcp='journal',
            )
            assert event_id == 'ev-123'
        finally:
            fork.stop()

    def test_rejected_event_raises_event_emission_error(self) -> None:
        """Fork returns event_id: null → EventEmissionError with error message."""
        fork = EventEmissionFork([{'event_id': None, 'error': 'unknown event kind'}])
        try:
            with pytest.raises(EventEmissionError) as exc:
                fork.emit({'event_id': 'ev-bad', 'kind': 'not_real'}, origin_mcp='journal')
            assert 'unknown event kind' in str(exc.value)
        finally:
            fork.stop()

    class NoResponseFork:
        """Subprocess fork that never responds (simulates hang)."""
        def __init__(self):
            self._proc = subprocess.Popen(
                [sys.executable, '-u', '-c', 'import time; time.sleep(3600)'],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            time.sleep(0.15)

        def emit(self, event, origin_mcp):
            client = EventEmissionClient(stdout=self._proc.stdin, stdin=self._proc.stdout, timeout=0.5)
            return client.emit(event, origin_mcp)

        def stop(self):
            self._proc.terminate()

    def test_timeout_raises_event_emission_timeout_error(self) -> None:
        """Fork that never responds → EventEmissionTimeoutError."""
        fork = self.NoResponseFork()
        try:
            start = time.monotonic()
            with pytest.raises(EventEmissionTimeoutError):
                fork.emit({'event_id': 'ev-1', 'kind': 'cycle_started'}, origin_mcp='journal')
            assert time.monotonic() - start < 2.0
        finally:
            fork.stop()

    def test_10_sequential_requests_all_succeed(self) -> None:
        """10 sequential emit calls all get their own correct ack."""
        fork = EventEmissionFork([{'event_id': f'ev-{i}'} for i in range(10)])
        try:
            for i in range(10):
                result = fork.emit(
                    {'event_id': f'ev-{i}', 'kind': 'trial_started', 'trial_id': f't-{i}'},
                    origin_mcp='journal',
                )
                assert result == f'ev-{i}'
        finally:
            fork.stop()

    def test_malformed_json_raises_timeout(self) -> None:
        """Fork that sends malformed JSON → timeout after retries."""
        class MalformedFork:
            def __init__(self):
                self._proc = subprocess.Popen(
                    [sys.executable, '-u', '-c', """
import sys
sys.stdout.write('not json\\n')
sys.stdout.flush()
"""],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                )
                time.sleep(0.05)

            def emit(self, event, origin_mcp):
                client = EventEmissionClient(stdout=self._proc.stdin, stdin=self._proc.stdout, timeout=0.5)
                return client.emit(event, origin_mcp)

            def stop(self):
                self._proc.terminate()

        fork = MalformedFork()
        try:
            start = time.monotonic()
            with pytest.raises(EventEmissionTimeoutError):
                fork.emit({'event_id': 'ev-1', 'kind': 'cycle_started'}, origin_mcp='journal')
            assert time.monotonic() - start < 2.0
        finally:
            fork.stop()