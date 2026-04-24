"""
nxl_core.events.schema
-----------------------
Pydantic models for all 18 event kinds in a discriminated union.

Each event carries:
  - event_id: ULID-formatted string (monotonic, URL-safe)
  - timestamp: UTC datetime
  - cycle_id: optional link to the cycle that produced this event
  - causation_id: optional link to the triggering event

The ``Event`` type is a Annotated Union with "kind" as the discriminator.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Base event
# ---------------------------------------------------------------------------


def _ulid() -> str:
    """Generate a ULID-formatted string (time-sortable, URL-safe)."""
    import time
    import random

    entropy = random.getrandbits(80)
    time_part = int(time.time() * 1000).to_bytes(8, "big").hex().lower().ljust(10, "0")[:10]
    rand_part = format(entropy % (2**64), "012x") + format(entropy >> 64, "012x")
    return f"01H{time_part}{rand_part[:12]}"


class _BaseEvent(BaseModel):
    event_id: str = Field(default_factory=_ulid, description="ULID-formatted event identifier")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    cycle_id: str | None = Field(default=None, description="Cycle that produced this event")
    causation_id: str | None = Field(
        default=None, description="Event that triggered this one"
    )


# ---------------------------------------------------------------------------
# Cycle events
# ---------------------------------------------------------------------------


class CycleStarted(_BaseEvent):
    kind: Literal["cycle_started"] = "cycle_started"
    brief_hash: str = Field(description="Hash of the cycle's brief")
    hypothesis_id: str = Field(description="Hypothesis being explored in this cycle")


class CycleCompleted(_BaseEvent):
    kind: Literal["cycle_completed"] = "cycle_completed"
    brief_hash: str
    hypothesis_id: str
    summary_tokens: int = Field(description="Token count of the cycle summary")


class CycleFailed(_BaseEvent):
    kind: Literal["cycle_failed"] = "cycle_failed"
    brief_hash: str
    hypothesis_id: str
    reason: str = Field(description="Why the cycle failed")


# ---------------------------------------------------------------------------
# Tool events
# ---------------------------------------------------------------------------


class ToolRequested(_BaseEvent):
    kind: Literal["tool_requested"] = "tool_requested"
    tool_name: str = Field(description="Name of the tool being invoked")
    args_hash: str = Field(description="Hash of the tool arguments (no secrets)")
    requesting_skill: str | None = Field(
        default=None, description="Skill that requested this tool, if any"
    )


class ToolCompleted(_BaseEvent):
    kind: Literal["tool_completed"] = "tool_completed"
    tool_name: str
    args_hash: str
    duration_ms: int = Field(description="Wall-clock duration in milliseconds")


class ToolFailed(_BaseEvent):
    kind: Literal["tool_failed"] = "tool_failed"
    tool_name: str
    args_hash: str
    error: str = Field(description="Error message from the tool")


# ---------------------------------------------------------------------------
# Research events
# ---------------------------------------------------------------------------


class HypothesisCreated(_BaseEvent):
    kind: Literal["hypothesis_created"] = "hypothesis_created"
    hypothesis_id: str = Field(description="Unique hypothesis identifier")
    claim: str = Field(description="The hypothesis claim in plain text")
    source: Literal["human", "literature", "surrogate", "ablation", "diversification", "failure"] = Field(
        default="human", description="Origin of this hypothesis"
    )


class TrialStarted(_BaseEvent):
    kind: Literal["trial_started"] = "trial_started"
    trial_id: str
    hypothesis_id: str
    config: dict = Field(default_factory=dict, description="Trial configuration")


class TrialCompleted(_BaseEvent):
    kind: Literal["trial_completed"] = "trial_completed"
    trial_id: str
    hypothesis_id: str
    metrics: dict = Field(default_factory=dict, description="Measured metrics")


class TrialFailed(_BaseEvent):
    kind: Literal["trial_failed"] = "trial_failed"
    trial_id: str
    hypothesis_id: str
    reason: str


class EvidenceCollected(_BaseEvent):
    kind: Literal["evidence_collected"] = "evidence_collected"
    trial_id: str
    evidence_type: Literal[
        "scalar_metric", "ordering_preference", "rubric", "threshold_check", "distributional", "informational"
    ] = Field(description="Kind of evidence collected")
    value: float | dict | str = Field(description="The evidence value")


# ---------------------------------------------------------------------------
# Policy events
# ---------------------------------------------------------------------------


class PolicyDecision(_BaseEvent):
    kind: Literal["policy_decision"] = "policy_decision"
    action: str = Field(description="Action that was evaluated")
    decision: Literal["allow", "deny", "ask", "narrow"] = Field(
        description="Policy decision"
    )
    reason: str = Field(description="Human-readable reason for the decision")


# ---------------------------------------------------------------------------
# Zone events
# ---------------------------------------------------------------------------


class ZoneEntered(_BaseEvent):
    kind: Literal["zone_entered"] = "zone_entered"
    zone: Literal["A", "B", "C"] = Field(description="Zone being entered")
    reason: str = Field(description="Why this zone was entered")


class ZoneExited(_BaseEvent):
    kind: Literal["zone_exited"] = "zone_exited"
    zone: Literal["A", "B", "C"]
    reason: str


# ---------------------------------------------------------------------------
# Capsule events
# ---------------------------------------------------------------------------


class CapsuleBuilt(_BaseEvent):
    kind: Literal["capsule_built"] = "capsule_built"
    capsule_id: str
    size_tokens: int


class CapsuleResumed(_BaseEvent):
    kind: Literal["capsule_resumed"] = "capsule_resumed"
    capsule_id: str
    cursor: str = Field(description="Event ID cursor for resume point")


# ---------------------------------------------------------------------------
# Incident / handoff events
# ---------------------------------------------------------------------------


class IncidentReported(_BaseEvent):
    kind: Literal["incident_reported"] = "incident_reported"
    incident_type: str
    severity: Literal["low", "medium", "high", "critical"]
    run_id: str
    description: str


class HandoffRecorded(_BaseEvent):
    kind: Literal["handoff_recorded"] = "handoff_recorded"
    handoff_id: str
    from_agent: str
    to_agent: str


# ---------------------------------------------------------------------------
# Skill events
# ---------------------------------------------------------------------------


class SkillRegistered(_BaseEvent):
    kind: Literal["skill_registered"] = "skill_registered"
    skill_name: str = Field(description="Name of the registered skill")
    skill_def: dict = Field(description="The SkillDef dictionary")


# ---------------------------------------------------------------------------
# Compaction events (M2.5)
# ---------------------------------------------------------------------------


class CompactRequested(_BaseEvent):
    """Emitted when a compaction threshold is reached."""
    kind: Literal["compact_requested"] = "compact_requested"
    tier_hint: Literal["soft", "hard", "clear"] = Field(
        description="Compaction urgency tier"
    )
    reason: str = Field(default="", description="Why compaction is being requested")
    events_since_compact: int = Field(
        default=0, description="Number of events since last compaction"
    )
    token_estimate: float = Field(
        default=0.0, description="Estimated token usage ratio (0.0-1.0)"
    )


class SoftTrimmed(_BaseEvent):
    """Emitted after a soft trim compaction."""
    kind: Literal["soft_trimmed"] = "soft_trimmed"
    preserved_count: int = Field(description="Number of events preserved")
    trimmed_count: int = Field(description="Number of events trimmed")


class HardRegenerated(_BaseEvent):
    """Emitted after a hard regen compaction."""
    kind: Literal["hard_regenerated"] = "hard_regenerated"
    preserved_count: int = Field(description="Number of critical events preserved")
    summary_tokens: int = Field(default=0, description="Token count of regeneration summary")


class SessionClearing(_BaseEvent):
    """Emitted when session is being cleared for handoff."""
    kind: Literal["session_clearing"] = "session_clearing"
    handoff_id: str = Field(description="Unique handoff identifier")
    reason: str = Field(default="", description="Why session is being cleared")
    from_agent: str = Field(default="", description="Agent handing off")
    to_agent: str = Field(default="", description="Agent receiving handoff")


# ---------------------------------------------------------------------------
# Discriminated union
# ---------------------------------------------------------------------------

Event = Annotated[
    Union[
        CycleStarted,
        CycleCompleted,
        CycleFailed,
        ToolRequested,
        ToolCompleted,
        ToolFailed,
        HypothesisCreated,
        TrialStarted,
        TrialCompleted,
        TrialFailed,
        EvidenceCollected,
        PolicyDecision,
        ZoneEntered,
        ZoneExited,
        CapsuleBuilt,
        CapsuleResumed,
        IncidentReported,
        HandoffRecorded,
        SkillRegistered,
        CompactRequested,
        SoftTrimmed,
        HardRegenerated,
        SessionClearing,
    ],
    Field(discriminator="kind"),
]
"""The top-level Event type — a discriminated union of all event kinds."""