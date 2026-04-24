#!/usr/bin/env python3
"""Benchmark nxl init on empty dir. Used as CI gate."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]


def run_init(td: Path, env: dict) -> float:
    """Run nxl init in temp dir, return elapsed seconds."""
    t0 = time.perf_counter()
    result = subprocess.run(
        ["uv", "run", "nxl", "init", "--auto", "--skip-onboarding"],
        cwd=td,
        env=env,
        capture_output=True,
        timeout=600,
    )
    elapsed = time.perf_counter() - t0
    if result.returncode != 0:
        raise RuntimeError(f"init failed ({elapsed:.1f}s): {result.stderr.decode()}")
    return elapsed


def run_once() -> float:
    """One full init run in fresh temp dir."""
    with tempfile.TemporaryDirectory(prefix="nxl-init-bench-") as td:
        env = os.environ.copy()
        home = Path(td) / "home"
        home.mkdir()
        config = Path(td) / "config"
        config.mkdir()
        env["HOME"] = str(home)
        env["XDG_CONFIG_HOME"] = str(config)
        env["NO_COLOR"] = "1"
        env["PYTHONUNBUFFERED"] = "1"
        # Don't inherit NXL_E2E_SANDBOX_ROOT since we're in fresh temp
        for k in list(env.keys()):
            if k.startswith("NXL_"):
                del env[k]
        return run_init(Path(td), env)


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    samples = []
    for i in range(n):
        print(f"  Run {i+1}/{n}...", file=sys.stderr, end=" ", flush=True)
        elapsed = run_once()
        print(f"{elapsed:.2f}s", file=sys.stderr)
        samples.append(elapsed)

    samples.sort()
    median = samples[n // 2]
    result = {
        "samples": [round(s, 3) for s in samples],
        "median": round(median, 3),
        "max": round(max(samples), 3),
        "min": round(min(samples), 3),
    }
    print(json.dumps(result, indent=2))
    print(
        f"median={median:.3f}s  min={min(samples):.3f}s  max={max(samples):.3f}s",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()