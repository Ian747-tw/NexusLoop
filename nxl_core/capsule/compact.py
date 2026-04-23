"""
nxl_core.capsule.compact
------------------------
Three-tier event stream compaction.

soft_trim()   — remove low-value events, preserve critical ones
hard_regen()  — aggressive rebuild, ≤3 per 500 events
clear_handoff() — reset handoff state, ≤1 per 500 events

Each emits a CompactionEvent.
"""
from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field

# Critical events that must never be lost during any compaction
_CRITICAL_KINDS: frozenset[str] = frozenset([
    "MissionDeclared",
    "HypothesisFormed",
    "TrialCompleted",
    "DecisionRecorded",
    "QualityNote",
])

# Low-value events that can be trimmed by soft_trim
_LOW_VALUE_KINDS: frozenset[str] = frozenset([
    "ProgressNoted",
    "TaskSpawned",
    "TaskCompleted",
    "TaskBlocked",
])


class CompactionType(str, Enum):
    SOFT_TRIM = "soft_trim"
    HARD_REGEN = "hard_regen"
    CLEAR_HANDOVER = "clear_handover"


class CompactionEvent(BaseModel):
    """Event emitted when compaction is performed."""
    compaction_type: CompactionType
    count: int = Field(description="Number of events processed in this compaction")
    preserved_events: list[dict] = Field(default_factory=list)


def soft_trim(events: list[dict]) -> CompactionEvent:
    """
    Remove low-value events while preserving all critical events.

    Critical events: MissionDeclared, HypothesisFormed, TrialCompleted,
    DecisionRecorded, QualityNote
    Low-value events: ProgressNoted, TaskSpawned, TaskCompleted, TaskBlocked
    All other events are preserved.
    """
    preserved: list[dict] = []
    trimmed_count = 0

    for event in events:
        kind = event.get("kind", "")
        if kind in _CRITICAL_KINDS:
            preserved.append(event)
        elif kind in _LOW_VALUE_KINDS:
            trimmed_count += 1
        else:
            preserved.append(event)

    return CompactionEvent(
        compaction_type=CompactionType.SOFT_TRIM,
        count=len(events) - trimmed_count,
        preserved_events=preserved,
    )


def hard_regen(events: list[dict]) -> CompactionEvent:
    """
    Aggressive rebuild: keep only critical events and a summary.

    Capped at 3 per 500 events (hard limit enforcement).
    """
    MAX_PER_500 = 3
    MAX_EVENTS = 3 * (len(events) // 500 + 1)

    preserved: list[dict] = []
    for event in events:
        kind = event.get("kind", "")
        if kind in _CRITICAL_KINDS:
            preserved.append(event)

    # Cap at hard limit
    hard_count = len(events) // 500 + 1
    count = min(hard_count, MAX_EVENTS)

    return CompactionEvent(
        compaction_type=CompactionType.HARD_REGEN,
        count=count,
        preserved_events=preserved,
    )


def clear_handoff(events: list[dict]) -> CompactionEvent:
    """
    Reset handoff state. Removes all HandoffRecorded events.

    Capped at 1 per 500 events.
    """
    MAX_PER_500 = 1

    preserved: list[dict] = [
        e for e in events
        if e.get("kind") != "HandoffRecorded"
    ]

    clear_count = len(events) // 500 + 1
    count = min(clear_count, MAX_PER_500)

    return CompactionEvent(
        compaction_type=CompactionType.CLEAR_HANDOVER,
        count=count,
        preserved_events=preserved,
    )
