from __future__ import annotations

import json
import signal
import subprocess
import time
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SERVER_TS = REPO_ROOT / "agentcore/tests/fixtures/lifecycle_server.ts"


def _spawn_server(project_dir: Path) -> subprocess.Popen[str]:
    project_dir.joinpath(".nxl").mkdir(parents=True, exist_ok=True)
    return subprocess.Popen(
        ["bun", "run", str(SERVER_TS)],
        cwd=project_dir,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )


def _wait_for_message(proc: subprocess.Popen[str], expected_type: str, timeout: float = 10.0) -> dict[str, object]:
    assert proc.stdout is not None
    deadline = time.time() + timeout
    while time.time() < deadline:
        line = proc.stdout.readline()
        if not line:
            if proc.poll() is not None:
                stderr = proc.stderr.read() if proc.stderr is not None else ""
                raise AssertionError(f"server exited before {expected_type}: {stderr}")
            time.sleep(0.05)
            continue
        payload = json.loads(line)
        if payload.get("type") == expected_type:
            return payload
    raise AssertionError(f"timed out waiting for {expected_type}")


def _send_frame(proc: subprocess.Popen[str], frame: dict[str, object]) -> None:
    assert proc.stdin is not None
    proc.stdin.write(json.dumps(frame) + "\n")
    proc.stdin.flush()


def _read_events(project_dir: Path) -> list[dict[str, object]]:
    events_path = project_dir / ".nxl" / "events.jsonl"
    if not events_path.exists():
        return []
    out: list[dict[str, object]] = []
    for line in events_path.read_text().splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        if isinstance(payload, dict) and isinstance(payload.get("event"), dict):
            out.append(payload["event"])
        else:
            out.append(payload)
    return out


def test_sigterm_emits_session_shutdown(tmp_path: Path) -> None:
    proc = _spawn_server(tmp_path)
    try:
        ready = _wait_for_message(proc, "ready")
        assert isinstance(ready.get("pid"), int)

        proc.send_signal(signal.SIGTERM)
        rc = proc.wait(timeout=15)
        stderr = proc.stderr.read() if proc.stderr is not None else ""
        assert rc == 0, f"server shutdown failed with rc={rc}: {stderr}"

        events = _read_events(tmp_path)
        shutdown = [event for event in events if event.get("kind") == "session_shutdown"]
        assert shutdown, events
        assert shutdown[-1]["signal"] == "SIGTERM"
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=5)


def test_inflight_call_timeout_emits_tool_call_timed_out(tmp_path: Path) -> None:
    proc = _spawn_server(tmp_path)
    try:
        _wait_for_message(proc, "ready")
        _send_frame(proc, {"type": "hold_call", "call_id": "stuck-call"})
        _wait_for_message(proc, "call_held")

        started = time.time()
        proc.send_signal(signal.SIGTERM)
        rc = proc.wait(timeout=15)
        elapsed = time.time() - started

        stderr = proc.stderr.read() if proc.stderr is not None else ""
        assert rc == 0, f"server shutdown failed with rc={rc}: {stderr}"
        assert elapsed >= 4.8

        events = _read_events(tmp_path)
        timed_out = [event for event in events if event.get("kind") == "tool_call_timed_out"]
        assert timed_out, events
        assert timed_out[-1]["signal"] == "SIGTERM"
        assert timed_out[-1]["drain_timeout_ms"] == 5000
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=5)


def test_pidfile_released_after_sigterm_allows_next_run(tmp_path: Path) -> None:
    first = _spawn_server(tmp_path)
    try:
        _wait_for_message(first, "ready")
        first.send_signal(signal.SIGTERM)
        assert first.wait(timeout=15) == 0
    finally:
        if first.poll() is None:
            first.kill()
            first.wait(timeout=5)

    second = _spawn_server(tmp_path)
    try:
        ready = _wait_for_message(second, "ready")
        assert isinstance(ready.get("pid"), int)
    finally:
        if second.poll() is None:
            second.send_signal(signal.SIGTERM)
            second.wait(timeout=15)


def test_sigint_and_sighup_match_sigterm_shutdown_contract(tmp_path: Path) -> None:
    for sig, name in ((signal.SIGINT, "SIGINT"), (signal.SIGHUP, "SIGHUP")):
        project_dir = tmp_path / name.lower()
        proc = _spawn_server(project_dir)
        try:
            _wait_for_message(proc, "ready")
            proc.send_signal(sig)
            assert proc.wait(timeout=15) == 0

            events = _read_events(project_dir)
            shutdown = [event for event in events if event.get("kind") == "session_shutdown"]
            assert shutdown, events
            assert shutdown[-1]["signal"] == name
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait(timeout=5)
