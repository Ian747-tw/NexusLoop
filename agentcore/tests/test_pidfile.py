from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import textwrap
import time
from pathlib import Path

from nxl_core.runtime.pidfile import acquire, read_owner_pid, release


def _helper_script(contents: str) -> str:
    fd, path = tempfile.mkstemp(suffix=".py", prefix="nxl-pidfile-helper-")
    Path(path).write_text(contents)
    return path


def test_python_acquire_release_reacquire_works(tmp_path: Path) -> None:
    lock_path = tmp_path / ".nxl" / "run.lock"
    first = acquire(lock_path)
    assert first is not None
    assert read_owner_pid(lock_path) == os.getpid()
    release(first)

    second = acquire(lock_path)
    assert second is not None
    assert read_owner_pid(lock_path) == os.getpid()
    release(second)


def test_other_python_process_attempting_acquire_fails_while_held(tmp_path: Path) -> None:
    lock_path = tmp_path / ".nxl" / "run.lock"
    first = acquire(lock_path)
    assert first is not None

    script = _helper_script(
        textwrap.dedent(
            f"""
            from nxl_core.runtime.pidfile import acquire
            handle = acquire({str(lock_path)!r})
            print("failed" if handle is None else "acquired")
            """
        )
    )
    try:
        proc = subprocess.run([sys.executable, script], capture_output=True, text=True, check=True)
    finally:
        Path(script).unlink(missing_ok=True)
    assert proc.stdout.strip() == "failed"
    release(first)


def test_stale_pidfile_is_taken_over_when_no_process_holds_the_lock(tmp_path: Path) -> None:
    lock_path = tmp_path / ".nxl" / "run.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.write_text("999999\n")

    handle = acquire(lock_path)
    assert handle is not None
    assert read_owner_pid(lock_path) == os.getpid()
    release(handle)


def test_python_acquire_blocks_ts_acquire_and_ts_acquire_blocks_python(tmp_path: Path) -> None:
    lock_path = tmp_path / ".nxl" / "run.lock"
    holder = acquire(lock_path)
    assert holder is not None

    ts_proc = subprocess.run(
        [
            "bun",
            "run",
            "agentcore/server-fork/src/util/_pidfile-helper.ts",
            str(lock_path),
        ],
        cwd=str(Path(__file__).resolve().parents[2]),
        capture_output=True,
        text=True,
        check=True,
    )
    assert ts_proc.stdout.strip() == "acquire_failed"
    release(holder)

    ts_holder = subprocess.Popen(
        [
            "bun",
            "run",
            "agentcore/server-fork/src/util/_pidfile-hold.ts",
            str(lock_path),
            "1500",
        ],
        cwd=str(Path(__file__).resolve().parents[2]),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        assert ts_holder.stdout is not None
        assert ts_holder.stdout.readline().strip() == "holding"

        start = time.time()
        blocked = acquire(lock_path)
        elapsed = time.time() - start
        assert blocked is None
        assert elapsed < 1.0
    finally:
        ts_holder.terminate()
        ts_holder.wait(timeout=5)
