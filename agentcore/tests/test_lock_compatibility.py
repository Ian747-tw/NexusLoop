"""
agentcore/tests/test_lock_compatibility.py
-----------------------------------------
Lock-file parity test: verify proper-lockfile (TS) and portalocker (Python)
coordinate on the same events.jsonl.lock companion file.

Only if both lock implementations lock the same file can the single-writer
invariant hold at runtime when the fork (proper-lockfile) and Python fallback
paths both attempt concurrent writes.

Run: uv run pytest agentcore/tests/test_lock_compatibility.py -v
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

EVENT_LOG_PATH = "events.jsonl"
LOCK_PATH = str(EVENT_LOG_PATH) + ".lock"


class TestLockCompatibility:
    """Verify proper-lockfile (TS) and portalocker (Python) coordinate."""

    @pytest.fixture(autouse=True)
    def setup(self, tmp_path: Path) -> None:
        self.events_path = tmp_path / EVENT_LOG_PATH
        self.lock_path = tmp_path / (EVENT_LOG_PATH + ".lock")
        self.events_path.write_text("")
        # proper-lockfile requires the lock file to already exist
        self.lock_path.write_text("")
        self._ts_proc: subprocess.Popen | None = None

    def teardown_method(self) -> None:
        if self._ts_proc and self._ts_proc.poll() is None:
            self._ts_proc.terminate()
            self._ts_proc.wait()
        for f in self.events_path.parent.glob("_ts_*.mjs"):
            f.unlink(missing_ok=True)

    def _run_ts_lock_holder(self, duration_s: float) -> None:
        """Spawn a TS subprocess that holds the lock for `duration_s` seconds."""
        server_fork = str(Path(__file__).parent.parent / "server-fork")
        script_path = str(self.events_path.parent / "_ts_lock_holder.mjs")
        lock_path_str = str(self.lock_path)
        with open(script_path, "w") as f:
            f.write(f"""
import {{ lockSync, unlockSync }} from '{server_fork}/node_modules/proper-lockfile/index.js';
const lockPath = '{lock_path_str}';
const release = lockSync(lockPath, {{ stale: 1 }});
console.log('TS_LOCK_ACQUIRED');
setTimeout(() => {{
    try {{ unlockSync(release); }} catch (e) {{}}
    console.log('TS_LOCK_RELEASED');
    process.exit(0);
}}, {duration_s * 1000});
""")
        self._ts_proc = subprocess.Popen(
            ["bun", "run", script_path],
            cwd=str(self.events_path.parent),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def test_portalocker_blocks_when_ts_holds_lock(self, tmp_path: Path) -> None:
        """
        Python portalocker.Lock(...) blocks while TS holds the lock.

        This proves both implementations are competing on the same lock file.
        """
        import portalocker

        # Start TS lock holder (3 second hold)
        self._run_ts_lock_holder(duration_s=3.0)

        # Wait for TS to confirm lock acquisition
        assert self._ts_proc.stdout is not None
        line = self._ts_proc.stdout.readline().decode("utf-8")
        assert "TS_LOCK_ACQUIRED" in line, f"TS did not acquire lock: {line!r}"

        # Python portalocker should block (not acquire) while TS holds the lock.
        # Use a timeout of 0.5s to detect that the lock was NOT immediately acquired.
        start = time.monotonic()
        acquired = threading.Event()
        failed = threading.Event()

        def try_portalocker() -> None:
            try:
                with portalocker.Lock(str(self.lock_path), timeout=0.5, mode="w"):
                    acquired.set()
            except portalocker.LockException:
                failed.set()

        t = threading.Thread(target=try_portalocker)
        t.start()
        t.join(timeout=2.0)

        # Assert portalocker did NOT acquire (it should have timed out / blocked)
        # If it acquired, the locks are NOT coordinating.
        assert not acquired.is_set(), (
            "portalocker acquired the lock while TS held it — locks are NOT coordinating. "
            "Both implementations must lock the same file."
        )
        assert failed.is_set(), "portalocker thread did not complete within expected window"

        # Clean up TS holder
        if self._ts_proc.poll() is None:
            self._ts_proc.terminate()
            self._ts_proc.wait()

    def test_ts_blocks_when_portalocker_holds_lock(self, tmp_path: Path) -> None:
        """
        TypeScript proper-lockfile blocks while Python portalocker holds the lock.

        This is the reverse direction of the same coordination test.
        """
        # Acquire portalocker lock in a background thread first
        import portalocker

        portalocker_held = threading.Event()
        portalocker_released = threading.Event()

        def hold_with_portalocker() -> None:
            with portalocker.Lock(str(self.lock_path), timeout=10, mode="w") as _lock:
                portalocker_held.set()
                # Keep held for 3 seconds
                time.sleep(3)
            portalocker_released.set()

        blocker = threading.Thread(target=hold_with_portalocker)
        blocker.start()

        # Wait for portalocker to acquire
        acquired = portalocker_held.wait(timeout=2.0)
        assert acquired, "portalocker did not acquire lock"

        # Now spawn TS; it should block trying to acquire
        server_fork = str(Path(__file__).parent.parent / "server-fork")
        lock_path_str = str(self.lock_path)
        script_path = str(self.events_path.parent / "_ts_lock_test.mjs")
        with open(script_path, "w") as f:
            f.write(f"""
import {{ lockSync }} from '{server_fork}/node_modules/proper-lockfile/index.js';
const lockPath = '{lock_path_str}';
const start = Date.now();
try {{
    lockSync(lockPath, {{ stale: 1, timeout: 500 }});
    console.log('TS_ACQUIRED_AFTER_' + (Date.now() - start) + 'ms');
}} catch (e) {{
    console.log('TS_FAILED:' + e.code);
}}
""")
        ts_proc = subprocess.Popen(
            ["bun", "run", script_path],
            cwd=str(self.events_path.parent),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        try:
            # Wait up to 2 seconds for TS to either acquire or fail
            # If TS fails quickly (within ~500ms), portalocker blocked it properly.
            # If TS takes the full 2s, it's waiting for portalocker to release.
            stdout_lines: list[str] = []
            def read_stdout() -> None:
                assert ts_proc.stdout is not None
                for line in ts_proc.stdout:
                    stdout_lines.append(line.decode())

            reader = threading.Thread(target=read_stdout)
            reader.start()
            ts_proc.wait(timeout=2.0)
            reader.join(timeout=0.5)

            output = "".join(stdout_lines)
            # TS should have FAILED (not acquired) because portalocker was holding it
            # The TS lockSync call uses timeout:500 so it should fail fast.
            assert "TS_FAILED" in output, (
                f"TS acquired lock while portalocker held it — locks are NOT coordinating. "
                f"Got: {output!r}"
            )
        finally:
            if ts_proc.poll() is None:
                ts_proc.terminate()
                ts_proc.wait()
            portalocker_released.wait(timeout=2.0)
            blocker.join(timeout=2.0)
