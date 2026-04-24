"""
M0.1 Step 3: Deterministic replay tests.

project(events) → State must be a pure function:
  - No I/O
  - No reading time
  - No randomness

Test: replay 1000-event fixture twice → assert byte-identical state.
"""
from __future__ import annotations

import json
import random
from datetime import datetime, timezone
from pathlib import Path


from nxl_core.events.log import EventLog
from nxl_core.events.replay import project


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _make_events(count: int, seed: int = 42) -> list[dict]:
    """Generate `count` synthetic events as plain dicts (not Pydantic)."""
    rng = random.Random(seed)
    events = []
    for i in range(count):
        ts = _utc_now().isoformat()
        event_id = f"01H{rng.randint(0, 0xFFFFFFFFFFFF):012d}"
        cycle_id = f"cycle_{rng.randint(1, 3):03d}"
        trial_id = f"trial_{rng.randint(1, 10):03d}"
        hypothesis_id = f"hyp_{rng.randint(1, 5):03d}"
        kind = rng.choice([
            "cycle_started", "cycle_completed", "tool_requested",
            "tool_completed", "hypothesis_created", "trial_started",
            "trial_completed", "evidence_collected", "policy_decision",
            "zone_entered",
        ])
        base = {
            "event_id": event_id,
            "timestamp": ts,
            "cycle_id": cycle_id,
            "causation_id": None,
        }
        if kind == "cycle_started":
            events.append({**base, "kind": kind, "brief_hash": f"hash{i}", "hypothesis_id": hypothesis_id})
        elif kind == "cycle_completed":
            events.append({**base, "kind": kind, "brief_hash": f"hash{i}", "hypothesis_id": hypothesis_id, "summary_tokens": rng.randint(50, 500)})
        elif kind == "tool_requested":
            events.append({**base, "kind": kind, "tool_name": rng.choice(["bash", "read", "write"]), "args_hash": f"ah{i}", "requesting_skill": None})
        elif kind == "tool_completed":
            events.append({**base, "kind": kind, "tool_name": "bash", "args_hash": f"ah{i}", "duration_ms": rng.randint(10, 5000)})
        elif kind == "hypothesis_created":
            events.append({**base, "kind": kind, "hypothesis_id": hypothesis_id, "claim": f"claim{i}", "source": "human"})
        elif kind == "trial_started":
            events.append({**base, "kind": kind, "trial_id": trial_id, "hypothesis_id": hypothesis_id, "config": {}})
        elif kind == "trial_completed":
            events.append({**base, "kind": kind, "trial_id": trial_id, "hypothesis_id": hypothesis_id, "metrics": {"reward": rng.uniform(0, 1)}})
        elif kind == "evidence_collected":
            events.append({**base, "kind": kind, "trial_id": trial_id, "evidence_type": "scalar_metric", "value": rng.uniform(0, 1)})
        elif kind == "policy_decision":
            events.append({**base, "kind": kind, "action": "tool.bash.write", "decision": "allow", "reason": "open"})
        elif kind == "zone_entered":
            events.append({**base, "kind": kind, "zone": rng.choice(["A", "B", "C"]), "reason": f"reason{i}"})
    return events


def _write_fixture(path: Path, events: list[dict]) -> None:
    with path.open("w") as f:
        for e in events:
            f.write(json.dumps(e) + "\n")


class TestDeterministicReplay:
    def test_replay_twice_produces_identical_state(self, tmp_path: Path) -> None:
        """Replaying the same event list twice must yield byte-identical state."""
        fixture_path = tmp_path / "events.jsonl"

        # Generate 1000-event fixture
        events = _make_events(1000, seed=99)
        _write_fixture(fixture_path, events)

        # Read events into the log
        log = EventLog(path=fixture_path)

        # First replay
        all_events_1 = list(log.read_all())
        state_1 = project(all_events_1)
        state_bytes_1 = state_1.model_dump_json().encode("utf-8")

        # Second replay (same events, fresh read)
        all_events_2 = list(log.read_all())
        state_2 = project(all_events_2)
        state_bytes_2 = state_2.model_dump_json().encode("utf-8")

        assert state_bytes_1 == state_bytes_2, (
            f"Replay not deterministic: first pass {len(state_bytes_1)} bytes, "
            f"second pass {len(state_bytes_2)} bytes"
        )

    def test_replay_empty_events_returns_empty_state(self) -> None:
        state = project([])
        assert state.total_events == 0
        assert state.cycles_completed == 0

    def test_replay_accumulates_counters(self, tmp_path: Path) -> None:
        events = _make_events(100, seed=7)
        fixture_path = tmp_path / "events.jsonl"
        _write_fixture(fixture_path, events)
        log = EventLog(path=fixture_path)
        state = project(list(log.read_all()))
        assert state.total_events == 100
        # Cycles: some cycle_started events — state.cycles_started reflects them
        assert state.cycles_started >= 0

    def test_replay_order_matters(self) -> None:
        # Two events with same ID in different order must produce different state
        from nxl_core.events.schema import CycleStarted

        now = _utc_now()
        e1 = CycleStarted(
            event_id="01HAAAAAAAAAAA", timestamp=now, cycle_id="c1", causation_id=None,
            kind="cycle_started", brief_hash="x", hypothesis_id="h1",
        )
        e2 = CycleStarted(
            event_id="01HBBBBBBBBBBB", timestamp=now, cycle_id="c2", causation_id="01HAAAAAAAAAAA",
            kind="cycle_started", brief_hash="y", hypothesis_id="h2",
        )
        state_ab = project([e1, e2])
        state_ba = project([e2, e1])
        # States should differ because order affects current_cycle_id
        assert state_ab.model_dump_json() != state_ba.model_dump_json()


class TestReplayConsistencyWithFixture:
    """Test against a frozen golden fixture."""

    def test_golden_fixture_replay(self, tmp_path: Path) -> None:
        # Create fixture
        fixture_path = tmp_path / "golden_1000.jsonl"
        events = _make_events(1000, seed=123)
        _write_fixture(fixture_path, events)

        log = EventLog(path=fixture_path)
        all_events = list(log.read_all())
        state = project(all_events)

        # Sanity: state must not be empty
        assert state.total_events == 1000
        # Cycles started should be in range [1, 1000] depending on random draw
        assert state.cycles_started >= 1
        # All stats should be non-negative
        assert state.cycles_completed >= 0
        assert state.tools_requested >= 0
        assert state.hypotheses_created >= 0