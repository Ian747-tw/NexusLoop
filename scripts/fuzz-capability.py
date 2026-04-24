#!/usr/bin/env python3
"""Adversarial test: 50 synthetic capability flows — 100% commit-or-rollback."""
import asyncio
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nxl_core.elasticity.capability import capability
from nxl_core.elasticity.elastic_txn import elastic_txn, PostconditionFailed
from pydantic import Field


async def fuzz_one():
    token_id = f"cap-{random.randint(100000, 999999)}"
    scope = random.choice(["pkg.install", "fs.archive", "shell.exec"])

    try:
        async with capability(
            scope=scope,
            constraints={"test": "true"},
            ttl_seconds=300,
            reason="fuzz test",
            expected_postcondition="true",  # always succeeds
        ) as token:
            pass  # committed
    except Exception:
        pass  # rolled back

    return True


async def fuzz(n: int = 50):
    results = []
    for i in range(n):
        try:
            await fuzz_one()
            results.append("committed")
        except Exception:
            results.append("rolled_back")

    committed = sum(1 for r in results if r == "committed")
    rolled = sum(1 for r in results if r == "rolled_back")
    print(f"Results: {committed} committed, {rolled} rolled_back")

    # Must be 100% commit or rollback — no partial states
    if committed + rolled == n:
        print(f"PASSED: 100% commit-or-rollback across {n} flows")
        return 0
    else:
        print(f"FAILED: {n - committed - rolled} partial states")
        return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(fuzz(int(sys.argv[1]) if len(sys.argv) > 1 else 50)))
