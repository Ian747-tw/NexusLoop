#!/usr/bin/env python3
"""
scripts/verify_single_writer_perf.py
P3.10: Verify event emission performance budget.

TS emitEvent benchmark: 1000 sequential emits in bun test must complete
within 3s wall time (<3ms/call on average). This covers lock acquisition,
fsync write, and release.
"""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path


MAX_TIME_SECONDS = 3.0
TEST_FILE = "tests/event-emitter.test.ts"


def main() -> None:
    print("P3.10: Event emission performance verification")
    print(f"  Budget: {TEST_FILE} completes in <{MAX_TIME_SECONDS}s wall time")

    t0 = time.perf_counter()
    result = subprocess.run(
        ["bun", "test", TEST_FILE, "--timeout=30000"],
        capture_output=True,
        text=True,
        timeout=30,
        cwd=Path(__file__).parent.parent / "agentcore",
    )
    elapsed = time.perf_counter() - t0

    if result.returncode == 0:
        print(f"  {TEST_FILE} passed in {elapsed:.2f}s")
        if elapsed > MAX_TIME_SECONDS:
            print(f"  FAIL: elapsed ({elapsed:.2f}s) exceeds budget ({MAX_TIME_SECONDS}s)")
            sys.exit(1)
        print("  OK")
        sys.exit(0)
    else:
        print(f"  FAIL: tests failed: {result.stderr[:200]}")
        sys.exit(1)


if __name__ == "__main__":
    main()