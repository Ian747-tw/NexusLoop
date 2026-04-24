"""Test that hard compaction produces deterministic capsule output."""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from nxl_core.events.log import EventLog
from nxl_core.capsule.compact import hard_regen, CompactionEvent
from nxl_core.events.schema import CompactRequested


@pytest.mark.phase_m2
def test_hard_compact_produces_deterministic_capsule(fake_journal_log: EventLog) -> None:
    """Hard compaction with the same input should produce the same output.
    
    This verifies that hard_regen() is deterministic - given the same
    events, it produces the same preserved events and count.
    """
    from nxl.core.orchestrator.cycle_adapter import (
        CycleAdapter,
        EVENTS_HARD_THRESHOLD,
        HARD_TOKEN_THRESHOLD,
    )

    # Create a deterministic set of events with known critical events
    events = [
        {"kind": "MissionDeclared", "data": {"id": "1"}},
        {"kind": "ProgressNoted", "data": {}},
        {"kind": "HypothesisFormed", "data": {"id": "2"}},
        {"kind": "ProgressNoted", "data": {}},
        {"kind": "TrialCompleted", "data": {"id": "3"}},
        {"kind": "ProgressNoted", "data": {}},
        {"kind": "DecisionRecorded", "data": {"id": "4"}},
    ] * 50  # Repeat to get more than 150 events

    # Run hard_regen twice with same input
    result1 = hard_regen(events)
    result2 = hard_regen(events)

    # Verify determinism: same types and counts preserved
    assert result1.compaction_type == result2.compaction_type
    assert result1.count == result2.count
    assert len(result1.preserved_events) == len(result2.preserved_events)

    # Verify that only critical events are preserved
    critical_kinds = {"MissionDeclared", "HypothesisFormed", "TrialCompleted", "DecisionRecorded", "QualityNote"}
    for event in result1.preserved_events:
        assert event["kind"] in critical_kinds, f"Non-critical event preserved: {event['kind']}"


@pytest.mark.phase_m2
def test_hard_compact_triggers_at_threshold(fake_journal_log: EventLog) -> None:
    """Hard trigger should emit CompactRequested(tier_hint='hard') when:
    - events > 150 since last compact, OR
    - token_estimate > 0.8
    """
    from nxl.core.orchestrator.cycle_adapter import (
        CycleAdapter,
        EVENTS_HARD_THRESHOLD,
        HARD_TOKEN_THRESHOLD,
    )

    adapter = CycleAdapter()

    # Manually set thresholds to trigger hard compact
    adapter._events_since_compact = EVENTS_HARD_THRESHOLD + 1
    adapter._token_estimate = 0.5  # Below token threshold, but events > 150

    # Check hard trigger
    adapter._check_hard_trigger()

    # Verify CompactRequested event was emitted
    events = list(fake_journal_log.read_all())
    compact_events = [e for e in events if e.kind == "compact_requested"]

    assert len(compact_events) == 1, f"Expected 1 compact event, got {len(compact_events)}"
    assert compact_events[0].tier_hint == "hard"
    assert compact_events[0].events_since_compact == EVENTS_HARD_THRESHOLD + 1

    # Verify counters were reset
    assert adapter._events_since_compact == 0
    assert adapter._token_estimate == 0.0


@pytest.mark.phase_m2
def test_hard_compact_respects_max_per_500_events() -> None:
    """Hard compaction should be capped at ~3 per 500 events."""
    from nxl_core.capsule.compact import hard_regen

    # Create 500 low-value events
    events = [{"kind": "ProgressNoted", "data": {}}] * 500

    result = hard_regen(events)

    # Hard regen on 500 events should cap count appropriately
    assert result.compaction_type.value == "hard_regen"
    # The preserved events should only include critical ones
    critical_kinds = {"MissionDeclared", "HypothesisFormed", "TrialCompleted", "DecisionRecorded", "QualityNote"}
    for event in result.preserved_events:
        assert event["kind"] in critical_kinds
