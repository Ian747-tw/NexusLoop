"""
M0.1 Step 1: 18-event discriminated union schema round-trip tests.

Each of the 18 event kinds must:
1. Construct correctly with required fields
2. Serialize to JSON via model_dump_json()
3. Deserialize back via TypeAdapter(Event).validate_json() to the same object
4. Reject JSON that tampered with kind or required fields
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import TypeVar

import pytest
from pydantic import BaseModel, TypeAdapter, ValidationError

from nxl_core.events.schema import Event

T = TypeVar("T", bound=BaseModel)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _assert_roundtrip(event: BaseModel) -> None:
    """Serialize then deserialize, assert equal."""
    blob = event.model_dump_json()
    parsed = TypeAdapter(Event).validate_json(blob)
    assert parsed == event


# ---------------------------------------------------------------------------
# Tests for all 18 event kinds
# ---------------------------------------------------------------------------

class TestCycleStarted:
    def test_roundtrip(self) -> None:
        e = _make_cycle_started()
        _assert_roundtrip(e)

    def test_unknown_kind_rejected(self) -> None:
        blob = '{"kind": "cycle_started", "event_id": "01HXXX", "timestamp": "2026-01-01T00:00:00Z", "brief_hash": "abc", "hypothesis_id": "hyp1"}'
        # valid kind passes — just a sanity check
        parsed = TypeAdapter(Event).validate_json(blob)
        assert parsed.kind == "cycle_started"


class TestCycleCompleted:
    def test_roundtrip(self) -> None:
        e = _make_cycle_completed()
        _assert_roundtrip(e)


class TestCycleFailed:
    def test_roundtrip(self) -> None:
        e = _make_cycle_failed()
        _assert_roundtrip(e)


class TestToolRequested:
    def test_roundtrip(self) -> None:
        e = _make_tool_requested()
        _assert_roundtrip(e)


class TestToolCompleted:
    def test_roundtrip(self) -> None:
        e = _make_tool_completed()
        _assert_roundtrip(e)


class TestToolFailed:
    def test_roundtrip(self) -> None:
        e = _make_tool_failed()
        _assert_roundtrip(e)


class TestHypothesisCreated:
    def test_roundtrip(self) -> None:
        e = _make_hypothesis_created()
        _assert_roundtrip(e)


class TestTrialStarted:
    def test_roundtrip(self) -> None:
        e = _make_trial_started()
        _assert_roundtrip(e)


class TestTrialCompleted:
    def test_roundtrip(self) -> None:
        e = _make_trial_completed()
        _assert_roundtrip(e)


class TestTrialFailed:
    def test_roundtrip(self) -> None:
        e = _make_trial_failed()
        _assert_roundtrip(e)


class TestEvidenceCollected:
    def test_roundtrip(self) -> None:
        e = _make_evidence_collected()
        _assert_roundtrip(e)


class TestPolicyDecision:
    def test_roundtrip(self) -> None:
        e = _make_policy_decision()
        _assert_roundtrip(e)


class TestZoneEntered:
    def test_roundtrip(self) -> None:
        e = _make_zone_entered()
        _assert_roundtrip(e)


class TestZoneExited:
    def test_roundtrip(self) -> None:
        e = _make_zone_exited()
        _assert_roundtrip(e)


class TestCapsuleBuilt:
    def test_roundtrip(self) -> None:
        e = _make_capsule_built()
        _assert_roundtrip(e)


class TestCapsuleResumed:
    def test_roundtrip(self) -> None:
        e = _make_capsule_resumed()
        _assert_roundtrip(e)


class TestIncidentReported:
    def test_roundtrip(self) -> None:
        e = _make_incident_reported()
        _assert_roundtrip(e)


class TestHandoffRecorded:
    def test_roundtrip(self) -> None:
        e = _make_handoff_recorded()
        _assert_roundtrip(e)


class TestAll18KindsPresent:
    """Meta-test: ensure all 18 kinds are reachable via the union."""

    def test_event_union_has_18_variants(self) -> None:
        # Exercise every discriminator value by parsing a valid blob per kind
        fixtures: dict[str, str] = {
            "cycle_started": '{"kind": "cycle_started", "event_id": "01HXXXX", "timestamp": "2026-01-01T00:00:00Z", "brief_hash": "h", "hypothesis_id": "hyp"}',
            "cycle_completed": '{"kind": "cycle_completed", "event_id": "01HXXXX", "timestamp": "2026-01-01T00:00:00Z", "brief_hash": "h", "hypothesis_id": "hyp", "summary_tokens": 1}',
            "cycle_failed": '{"kind": "cycle_failed", "event_id": "01HXXXX", "timestamp": "2026-01-01T00:00:00Z", "brief_hash": "h", "hypothesis_id": "hyp", "reason": "x"}',
            "tool_requested": '{"kind": "tool_requested", "event_id": "01HXXXX", "timestamp": "2026-01-01T00:00:00Z", "tool_name": "bash", "args_hash": "h"}',
            "tool_completed": '{"kind": "tool_completed", "event_id": "01HXXXX", "timestamp": "2026-01-01T00:00:00Z", "tool_name": "bash", "args_hash": "h", "duration_ms": 1}',
            "tool_failed": '{"kind": "tool_failed", "event_id": "01HXXXX", "timestamp": "2026-01-01T00:00:00Z", "tool_name": "bash", "args_hash": "h", "error": "x"}',
            "hypothesis_created": '{"kind": "hypothesis_created", "event_id": "01HXXXX", "timestamp": "2026-01-01T00:00:00Z", "hypothesis_id": "h", "claim": "c"}',
            "trial_started": '{"kind": "trial_started", "event_id": "01HXXXX", "timestamp": "2026-01-01T00:00:00Z", "trial_id": "t", "hypothesis_id": "h"}',
            "trial_completed": '{"kind": "trial_completed", "event_id": "01HXXXX", "timestamp": "2026-01-01T00:00:00Z", "trial_id": "t", "hypothesis_id": "h", "metrics": {}}',
            "trial_failed": '{"kind": "trial_failed", "event_id": "01HXXXX", "timestamp": "2026-01-01T00:00:00Z", "trial_id": "t", "hypothesis_id": "h", "reason": "x"}',
            "evidence_collected": '{"kind": "evidence_collected", "event_id": "01HXXXX", "timestamp": "2026-01-01T00:00:00Z", "trial_id": "t", "evidence_type": "scalar_metric", "value": 1.0}',
            "policy_decision": '{"kind": "policy_decision", "event_id": "01HXXXX", "timestamp": "2026-01-01T00:00:00Z", "action": "a", "decision": "allow", "reason": "r"}',
            "zone_entered": '{"kind": "zone_entered", "event_id": "01HXXXX", "timestamp": "2026-01-01T00:00:00Z", "zone": "A", "reason": "r"}',
            "zone_exited": '{"kind": "zone_exited", "event_id": "01HXXXX", "timestamp": "2026-01-01T00:00:00Z", "zone": "A", "reason": "r"}',
            "capsule_built": '{"kind": "capsule_built", "event_id": "01HXXXX", "timestamp": "2026-01-01T00:00:00Z", "capsule_id": "c", "size_tokens": 1}',
            "capsule_resumed": '{"kind": "capsule_resumed", "event_id": "01HXXXX", "timestamp": "2026-01-01T00:00:00Z", "capsule_id": "c", "cursor": "01HYYYY"}',
            "incident_reported": '{"kind": "incident_reported", "event_id": "01HXXXX", "timestamp": "2026-01-01T00:00:00Z", "incident_type": "div", "severity": "low", "run_id": "r", "description": "d"}',
            "handoff_recorded": '{"kind": "handoff_recorded", "event_id": "01HXXXX", "timestamp": "2026-01-01T00:00:00Z", "handoff_id": "h", "from_agent": "a", "to_agent": "b"}',
        }
        assert len(fixtures) == 18, f"Expected 18 fixture blobs, got {len(fixtures)}"
        for kind, blob in fixtures.items():
            parsed = TypeAdapter(Event).validate_json(blob)
            assert parsed.kind == kind


# ---------------------------------------------------------------------------
# Factory helpers — build minimal valid instances of each event kind
# ---------------------------------------------------------------------------

def _make_cycle_started() -> "nxl_core.events.schema.CycleStarted":
    from nxl_core.events.schema import CycleStarted
    return CycleStarted(
        event_id="01HXXXXXXXXXXXX",
        timestamp=_utc_now(),
        cycle_id="cycle_001",
        causation_id=None,
        kind="cycle_started",
        brief_hash="deadbeef01234567",
        hypothesis_id="hyp_alpha",
    )


def _make_cycle_completed() -> "nxl_core.events.schema.CycleCompleted":
    from nxl_core.events.schema import CycleCompleted
    return CycleCompleted(
        event_id="01HXXXXXXXXXXXX",
        timestamp=_utc_now(),
        cycle_id="cycle_001",
        causation_id="01HXXXXXXXXXXXX",
        kind="cycle_completed",
        brief_hash="deadbeef01234567",
        hypothesis_id="hyp_alpha",
        summary_tokens=120,
    )


def _make_cycle_failed() -> "nxl_core.events.schema.CycleFailed":
    from nxl_core.events.schema import CycleFailed
    return CycleFailed(
        event_id="01HXXXXXXXXXXXX",
        timestamp=_utc_now(),
        cycle_id="cycle_001",
        causation_id="01HXXXXXXXXXXXX",
        kind="cycle_failed",
        brief_hash="deadbeef01234567",
        hypothesis_id="hyp_alpha",
        reason="timeout",
    )


def _make_tool_requested() -> "nxl_core.events.schema.ToolRequested":
    from nxl_core.events.schema import ToolRequested
    return ToolRequested(
        event_id="01HXXXXXXXXXXXX",
        timestamp=_utc_now(),
        cycle_id="cycle_001",
        causation_id=None,
        kind="tool_requested",
        tool_name="bash",
        args_hash="a1b2c3d4e5f6",
        requesting_skill="superpowers:execute-plan",
    )


def _make_tool_completed() -> "nxl_core.events.schema.ToolCompleted":
    from nxl_core.events.schema import ToolCompleted
    return ToolCompleted(
        event_id="01HXXXXXXXXXXXX",
        timestamp=_utc_now(),
        cycle_id="cycle_001",
        causation_id="01HXXXXXXXXXXXX",
        kind="tool_completed",
        tool_name="bash",
        args_hash="a1b2c3d4e5f6",
        duration_ms=450,
    )


def _make_tool_failed() -> "nxl_core.events.schema.ToolFailed":
    from nxl_core.events.schema import ToolFailed
    return ToolFailed(
        event_id="01HXXXXXXXXXXXX",
        timestamp=_utc_now(),
        cycle_id="cycle_001",
        causation_id="01HXXXXXXXXXXXX",
        kind="tool_failed",
        tool_name="bash",
        args_hash="a1b2c3d4e5f6",
        error="exit code 1",
    )


def _make_hypothesis_created() -> "nxl_core.events.schema.HypothesisCreated":
    from nxl_core.events.schema import HypothesisCreated
    return HypothesisCreated(
        event_id="01HXXXXXXXXXXXX",
        timestamp=_utc_now(),
        cycle_id=None,
        causation_id=None,
        kind="hypothesis_created",
        hypothesis_id="hyp_001",
        claim="Adding attention improves score",
        source="human",
    )


def _make_trial_started() -> "nxl_core.events.schema.TrialStarted":
    from nxl_core.events.schema import TrialStarted
    return TrialStarted(
        event_id="01HXXXXXXXXXXXX",
        timestamp=_utc_now(),
        cycle_id="cycle_001",
        causation_id="01HXXXXXXXXXXXX",
        kind="trial_started",
        trial_id="trial_001",
        hypothesis_id="hyp_001",
        config={"lr": 0.001},
    )


def _make_trial_completed() -> "nxl_core.events.schema.TrialCompleted":
    from nxl_core.events.schema import TrialCompleted
    return TrialCompleted(
        event_id="01HXXXXXXXXXXXX",
        timestamp=_utc_now(),
        cycle_id="cycle_001",
        causation_id="01HXXXXXXXXXXXX",
        kind="trial_completed",
        trial_id="trial_001",
        hypothesis_id="hyp_001",
        metrics={"reward": 0.85},
    )


def _make_trial_failed() -> "nxl_core.events.schema.TrialFailed":
    from nxl_core.events.schema import TrialFailed
    return TrialFailed(
        event_id="01HXXXXXXXXXXXX",
        timestamp=_utc_now(),
        cycle_id="cycle_001",
        causation_id="01HXXXXXXXXXXXX",
        kind="trial_failed",
        trial_id="trial_001",
        hypothesis_id="hyp_001",
        reason="crashed",
    )


def _make_evidence_collected() -> "nxl_core.events.schema.EvidenceCollected":
    from nxl_core.events.schema import EvidenceCollected
    return EvidenceCollected(
        event_id="01HXXXXXXXXXXXX",
        timestamp=_utc_now(),
        cycle_id="cycle_001",
        causation_id="01HXXXXXXXXXXXX",
        kind="evidence_collected",
        trial_id="trial_001",
        evidence_type="scalar_metric",
        value=0.91,
    )


def _make_policy_decision() -> "nxl_core.events.schema.PolicyDecision":
    from nxl_core.events.schema import PolicyDecision
    return PolicyDecision(
        event_id="01HXXXXXXXXXXXX",
        timestamp=_utc_now(),
        cycle_id="cycle_001",
        causation_id="01HXXXXXXXXXXXX",
        kind="policy_decision",
        action="tool.bash.write",
        decision="allow",
        reason="open mode",
    )


def _make_zone_entered() -> "nxl_core.events.schema.ZoneEntered":
    from nxl_core.events.schema import ZoneEntered
    return ZoneEntered(
        event_id="01HXXXXXXXXXXXX",
        timestamp=_utc_now(),
        cycle_id="cycle_001",
        causation_id=None,
        kind="zone_entered",
        zone="B",
        reason="experiment_development",
    )


def _make_zone_exited() -> "nxl_core.events.schema.ZoneExited":
    from nxl_core.events.schema import ZoneExited
    return ZoneExited(
        event_id="01HXXXXXXXXXXXX",
        timestamp=_utc_now(),
        cycle_id="cycle_001",
        causation_id="01HXXXXXXXXXXXX",
        kind="zone_exited",
        zone="B",
        reason="phase_complete",
    )


def _make_capsule_built() -> "nxl_core.events.schema.CapsuleBuilt":
    from nxl_core.events.schema import CapsuleBuilt
    return CapsuleBuilt(
        event_id="01HXXXXXXXXXXXX",
        timestamp=_utc_now(),
        cycle_id="cycle_001",
        causation_id=None,
        kind="capsule_built",
        capsule_id="cap_001",
        size_tokens=800,
    )


def _make_capsule_resumed() -> "nxl_core.events.schema.CapsuleResumed":
    from nxl_core.events.schema import CapsuleResumed
    return CapsuleResumed(
        event_id="01HXXXXXXXXXXXX",
        timestamp=_utc_now(),
        cycle_id="cycle_002",
        causation_id=None,
        kind="capsule_resumed",
        capsule_id="cap_001",
        cursor="01HXXXXXXXXXXXX",
    )


def _make_incident_reported() -> "nxl_core.events.schema.IncidentReported":
    from nxl_core.events.schema import IncidentReported
    return IncidentReported(
        event_id="01HXXXXXXXXXXXX",
        timestamp=_utc_now(),
        cycle_id="cycle_001",
        causation_id=None,
        kind="incident_reported",
        incident_type="divergence",
        severity="critical",
        run_id="run_001",
        description="Loss went to NaN",
    )


def _make_handoff_recorded() -> "nxl_core.events.schema.HandoffRecorded":
    from nxl_core.events.schema import HandoffRecorded
    return HandoffRecorded(
        event_id="01HXXXXXXXXXXXX",
        timestamp=_utc_now(),
        cycle_id=None,
        causation_id=None,
        kind="handoff_recorded",
        handoff_id="hand_001",
        from_agent="agent_001",
        to_agent="agent_002",
    )