#!/usr/bin/env python3
"""Test compaction trajectory: 500-event stream with bounded tier counts.

This test simulates 500 events through the cycle adapter and verifies:
- soft compactions: bounded at ~20 or fewer
- hard compactions: bounded at ~3 or fewer
- clear compactions: bounded at ~1 or fewer
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _make_event(kind: str) -> dict:
    """Create a mock event dict with the given kind."""
    return {"kind": kind, "event_id": f"evt-{kind}", "timestamp": datetime.now(timezone.utc)}


def _simulate_500_events() -> list[dict]:
    """Simulate 500 events through the cycle adapter.

    Mix of critical and low-value events to test compaction behavior.
    """
    events = []

    # Emit critical events periodically (these must be preserved)
    critical_kinds = ["MissionDeclared", "HypothesisFormed", "TrialCompleted",
                       "DecisionRecorded", "QualityNote"]
    # Emit a critical event every 50 events
    for i in range(500):
        if i % 50 == 0 and i > 0:
            events.append(_make_event(critical_kinds[i % len(critical_kinds)]))
        else:
            # Mix of low-value and other events
            if i % 10 == 0:
                events.append(_make_event("ProgressNoted"))
            elif i % 10 == 1:
                events.append(_make_event("TaskSpawned"))
            elif i % 10 == 2:
                events.append(_make_event("TaskCompleted"))
            else:
                events.append(_make_event("ToolRequested"))

    return events


def _run_compaction_trajectory_test() -> tuple[int, int, int]:
    """Run 500 events through mock CycleAdapter and count compactions.

    Returns (soft_count, hard_count, clear_count).
    """
    from nxl_core.events.log import EventLog

    # Create mock EventLog that records appends
    class MockEventLog(EventLog):
        def __init__(self):
            super().__init__(Path("/tmp/mock_events.jsonl"))
            self._emitted: list[dict] = []

        def append(self, event) -> str:
            # Record the event
            self._emitted.append(event.model_dump() if hasattr(event, 'model_dump') else dict(event))
            return event.event_id if hasattr(event, 'event_id') else "mock-id"

    mock_log = MockEventLog()

    # Mock the journal_log singleton
    with patch('nxl.core.orchestrator.cycle_adapter.journal_log', return_value=mock_log):
        from nxl.core.orchestrator.cycle_adapter import CycleAdapter

        adapter = CycleAdapter()

        # Simulate events in chunks (each chunk is a "cycle")
        events = _simulate_500_events()

        # Process events in batches of ~40 to trigger soft compactions
        batch_size = 40
        for i in range(0, len(events), batch_size):
            batch = events[i:i + batch_size]

            # Simulate what happens when run_cycle is called
            # Track events since last compact
            adapter._events_since_compact += len(batch)

            # Simulate token estimate going up
            adapter._token_estimate = (i + len(batch)) / 500 * 0.7  # 0 to 0.7

            # Check triggers
            adapter._check_soft_trigger()
            adapter._check_hard_trigger()

        # After processing all events, check for session age clear
        adapter._session_start_time = datetime.now(timezone.utc) - timedelta(hours=7)
        adapter._trigger_clear(reason="session_age > 6h")

    # Count compaction events
    soft_count = sum(
        1 for e in mock_log._emitted
        if isinstance(e, dict) and e.get("kind") == "compact_requested"
        and e.get("tier_hint") == "soft"
    )
    hard_count = sum(
        1 for e in mock_log._emitted
        if isinstance(e, dict) and e.get("kind") == "compact_requested"
        and e.get("tier_hint") == "hard"
    )
    clear_count = sum(
        1 for e in mock_log._emitted
        if isinstance(e, dict) and e.get("kind") == "session_clearing"
    )

    return soft_count, hard_count, clear_count


def test_compaction_trajectory():
    """Test that 500 events produces bounded compaction counts."""
    soft_count, hard_count, clear_count = _run_compaction_trajectory_test()

    print(f"Compaction trajectory: soft={soft_count}, hard={hard_count}, clear={clear_count}")

    assert soft_count <= 20, f"Too many soft compactions: {soft_count} (max 20)"
    assert hard_count <= 3, f"Too many hard compactions: {hard_count} (max 3)"
    assert clear_count <= 1, f"Too many clear compactions: {clear_count} (max 1)"

    print("PASSED: Bounded compaction counts")


def test_tier_functions():
    """Test the underlying compaction functions directly."""
    from nxl_core.capsule.compact import soft_trim, hard_regen, clear_handoff, CompactionEvent

    # Test soft_trim
    events = [{"kind": "ProgressNoted", "data": {}}] * 100
    result = soft_trim(events)
    assert isinstance(result, CompactionEvent)
    assert result.compaction_type.value == "soft_trim"
    assert len(result.preserved_events) < 100  # Some should be trimmed

    # Test hard_regen
    events = [{"kind": "ProgressNoted", "data": {}}] * 500
    result = hard_regen(events)
    assert isinstance(result, CompactionEvent)
    assert result.compaction_type.value == "hard_regen"

    # Test clear_handoff
    events = [{"kind": "HandoffRecorded", "data": {}}] * 10
    result = clear_handoff(events)
    assert isinstance(result, CompactionEvent)
    assert result.compaction_type.value == "clear_handover"

    print("PASSED: Tier function tests")


if __name__ == "__main__":
    test_tier_functions()
    test_compaction_trajectory()
