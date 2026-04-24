#!/usr/bin/env python3
"""Verify overnight run criteria from events.jsonl."""
import argparse
import json
import sys
from pathlib import Path


def verify(
    events_path: str,
    min_cycles: int,
    min_handoffs: int,
    max_violations: int,
    min_capability_flows: int,
    require_replay_match: bool,
) -> int:
    events = []
    with open(events_path) as f:
        for line in f:
            if line.strip():
                events.append(json.loads(line))

    cycles = sum(1 for e in events if e.get("kind") == "CycleCompleted")
    handoffs = sum(1 for e in events if e.get("kind") == "SessionClearing")
    violations = sum(1 for e in events if "NON_NEGOTIABLE" in str(e))
    cap_flows = sum(1 for e in events if e.get("kind") == "CapabilityCommitted")

    print(f"Cycles: {cycles} (min: {min_cycles})")
    print(f"Handoffs: {handoffs} (min: {min_handoffs})")
    print(f"Violations: {violations} (max: {max_violations})")
    print(f"Capability flows: {cap_flows} (min: {min_capability_flows})")

    ok = True
    if cycles < min_cycles:
        print(f"FAIL: cycles {cycles} < {min_cycles}")
        ok = False
    if handoffs < min_handoffs:
        print(f"FAIL: handoffs {handoffs} < {min_handoffs}")
        ok = False
    if violations > max_violations:
        print(f"FAIL: violations {violations} > {max_violations}")
        ok = False
    if cap_flows < min_capability_flows:
        print(f"FAIL: cap_flows {cap_flows} < {min_capability_flows}")
        ok = False

    return 0 if ok else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--events")
    parser.add_argument("--min-cycles", type=int, default=100)
    parser.add_argument("--min-handoffs", type=int, default=3)
    parser.add_argument("--max-violations", type=int, default=0)
    parser.add_argument("--min-capability-flows", type=int, default=5)
    parser.add_argument("--require-replay-match", action="store_true")
    args = parser.parse_args()

    if args.events:
        sys.exit(verify(args.events, args.min_cycles, args.min_handoffs,
                        args.max_violations, args.min_capability_flows,
                        args.require_replay_match))
    else:
        print("Usage: python verify_overnight_criteria.py --events <path>")
        sys.exit(1)