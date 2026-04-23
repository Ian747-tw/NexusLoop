"""
M0.4 Step 3: Three-tier compaction.

soft_trim(), hard_regen(), clear_handoff() — each emits typed event.
500-event stream → ≤3 hard compactions, ≤1 clear.
No critical events lost after compaction.
"""
from __future__ import annotations

import pytest

from nxl_core.capsule.compact import (
    soft_trim,
    hard_regen,
    clear_handoff,
    CompactionEvent,
    CompactionType,
)


class TestSoftTrim:
    """soft_trim() removes low-value events but preserves critical events."""

    def test_returns_compaction_event(self) -> None:
        events = []  # empty stream
        result = soft_trim(events)
        assert isinstance(result, CompactionEvent)
        assert result.compaction_type == CompactionType.SOFT_TRIM

    def test_preserves_critical_events(self) -> None:
        """Critical events must survive soft_trim."""
        events = [
            {"kind": "MissionDeclared", "data": {"mission": "Test mission"}},
            {"kind": "HypothesisFormed", "data": {"hypothesis": "H1"}},
            {"kind": "ProgressNoted", "data": {"note": "Low value note"}},
        ]
        result = soft_trim(events)
        # Critical events should be preserved
        preserved_kinds = {e["kind"] for e in result.preserved_events}
        assert "MissionDeclared" in preserved_kinds
        assert "HypothesisFormed" in preserved_kinds


class TestHardRegen:
    """hard_regen() emits CompactionType.HARD_REGEN event, caps at ≤3 per 500 events."""

    def test_returns_compaction_event(self) -> None:
        events = [{"kind": "TaskSpawned", "data": {}}] * 100
        result = hard_regen(events)
        assert isinstance(result, CompactionEvent)
        assert result.compaction_type == CompactionType.HARD_REGEN

    def test_enforces_3_per_500_limit(self) -> None:
        """hard_regen must not be called more than 3 times per 500 events."""
        # Simulate a 500-event stream; hard_regen should cap itself
        events = [{"kind": "TaskSpawned", "data": {}}] * 500
        result = hard_regen(events)
        assert result.count <= 3, f"hard_regen called {result.count} times, limit is 3"


class TestClearHandoff:
    """clear_handoff() emits CompactionType.CLEAR_HANDOOK, caps at ≤1 per 500 events."""

    def test_returns_compaction_event(self) -> None:
        result = clear_handoff([])
        assert isinstance(result, CompactionEvent)
        assert result.compaction_type == CompactionType.CLEAR_HANDOVER

    def test_enforces_1_per_500_limit(self) -> None:
        """clear_handoff must not exceed 1 per 500 events."""
        events = [{"kind": "HandoffRecorded", "data": {}}] * 500
        result = clear_handoff(events)
        assert result.count <= 1, f"clear_handoff called {result.count} times, limit is 1"


class TestNoCriticalEventsLost:
    """Compaction must never drop MissionDeclared, HypothesisFormed, or TrialCompleted."""

    def test_mission_never_lost(self) -> None:
        events = [
            {"kind": "MissionDeclared", "data": {"mission": "X"}},
            {"kind": "TaskSpawned", "data": {}},
        ] * 200
        result = soft_trim(events)
        kinds = [e["kind"] for e in result.preserved_events]
        assert "MissionDeclared" in kinds

    def test_trial_completed_never_lost(self) -> None:
        events = [
            {"kind": "TrialCompleted", "data": {"trial_id": "t1"}},
            {"kind": "TaskSpawned", "data": {}},
        ] * 200
        result = hard_regen(events)
        kinds = [e["kind"] for e in result.preserved_events]
        assert "TrialCompleted" in kinds
