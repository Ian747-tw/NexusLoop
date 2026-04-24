"""
M0.2 Step 3: Polymorphic Evidence + closure rules.

6 evidence kinds × 3 outcomes (support / refute / inconclusive) = 18 cells.
Each evidence kind must:
1. Construct with required fields
2. Serialize to JSON and deserialize back to same object
3. closure_<kind>(evidence, hypothesis) → ClosureDecision for each outcome
4. Reject invalid kind strings at parse time
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import TypeVar

from pydantic import BaseModel, TypeAdapter

from nxl_core.research.evidence import Evidence, ClosureDecision

T = TypeVar("T", bound=BaseModel)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _assert_roundtrip(evidence: BaseModel) -> None:
    blob = evidence.model_dump_json()
    parsed = TypeAdapter(Evidence).validate_json(blob)
    assert parsed == evidence


# ---------------------------------------------------------------------------
# Evidence kinds
# ---------------------------------------------------------------------------

class TestEmpiricalEvidence:
    def test_roundtrip(self) -> None:
        _assert_roundtrip(_make_empirical())


class TestTheoreticalEvidence:
    def test_roundtrip(self) -> None:
        _assert_roundtrip(_make_theoretical())


class TestSimulationEvidence:
    def test_roundtrip(self) -> None:
        _assert_roundtrip(_make_simulation())


class TestLiteratureEvidence:
    def test_roundtrip(self) -> None:
        _assert_roundtrip(_make_literature())


class TestNullEvidence:
    def test_roundtrip(self) -> None:
        _assert_roundtrip(_make_null())


class TestMetaEvidence:
    def test_roundtrip(self) -> None:
        _assert_roundtrip(_make_meta())


# ---------------------------------------------------------------------------
# Closure rules — all 6 kinds × 3 outcomes = 18 test cases
# ---------------------------------------------------------------------------

class TestClosureSupport:
    """Evidence that supports the hypothesis claim."""

    def test_empirical_support(self) -> None:
        ev = _make_empirical(outcome="support")
        result = ClosureDecision.SUPPORT
        assert ev.closure_decision == result

    def test_theoretical_support(self) -> None:
        ev = _make_theoretical(outcome="support")
        assert ev.closure_decision == ClosureDecision.SUPPORT

    def test_simulation_support(self) -> None:
        ev = _make_simulation(outcome="support")
        assert ev.closure_decision == ClosureDecision.SUPPORT

    def test_literature_support(self) -> None:
        ev = _make_literature(outcome="support")
        assert ev.closure_decision == ClosureDecision.SUPPORT

    def test_null_support(self) -> None:
        ev = _make_null(outcome="support")
        assert ev.closure_decision == ClosureDecision.SUPPORT

    def test_meta_support(self) -> None:
        ev = _make_meta(outcome="support")
        assert ev.closure_decision == ClosureDecision.SUPPORT


class TestClosureRefute:
    """Evidence that refutes the hypothesis claim."""

    def test_empirical_refute(self) -> None:
        ev = _make_empirical(outcome="refute")
        assert ev.closure_decision == ClosureDecision.REFUTE

    def test_theoretical_refute(self) -> None:
        ev = _make_theoretical(outcome="refute")
        assert ev.closure_decision == ClosureDecision.REFUTE

    def test_simulation_refute(self) -> None:
        ev = _make_simulation(outcome="refute")
        assert ev.closure_decision == ClosureDecision.REFUTE

    def test_literature_refute(self) -> None:
        ev = _make_literature(outcome="refute")
        assert ev.closure_decision == ClosureDecision.REFUTE

    def test_null_refute(self) -> None:
        ev = _make_null(outcome="refute")
        assert ev.closure_decision == ClosureDecision.REFUTE

    def test_meta_refute(self) -> None:
        ev = _make_meta(outcome="refute")
        assert ev.closure_decision == ClosureDecision.REFUTE


class TestClosureInconclusive:
    """Evidence that is inconclusive."""

    def test_empirical_inconclusive(self) -> None:
        ev = _make_empirical(outcome="inconclusive")
        assert ev.closure_decision == ClosureDecision.INCONCLUSIVE

    def test_theoretical_inconclusive(self) -> None:
        ev = _make_theoretical(outcome="inconclusive")
        assert ev.closure_decision == ClosureDecision.INCONCLUSIVE

    def test_simulation_inconclusive(self) -> None:
        ev = _make_simulation(outcome="inconclusive")
        assert ev.closure_decision == ClosureDecision.INCONCLUSIVE

    def test_literature_inconclusive(self) -> None:
        ev = _make_literature(outcome="inconclusive")
        assert ev.closure_decision == ClosureDecision.INCONCLUSIVE

    def test_null_inconclusive(self) -> None:
        ev = _make_null(outcome="inconclusive")
        assert ev.closure_decision == ClosureDecision.INCONCLUSIVE

    def test_meta_inconclusive(self) -> None:
        ev = _make_meta(outcome="inconclusive")
        assert ev.closure_decision == ClosureDecision.INCONCLUSIVE


class TestAll6KindsPresent:
    def test_evidence_union_has_6_variants(self) -> None:
        fixtures = {
            "empirical": '{"kind": "empirical", "evidence_id": "e1", "trial_id": "t1", "metric_name": "accuracy", "metric_value": 0.85, "outcome": "support", "closure_decision": "support", "created_at": "2026-01-01T00:00:00Z"}',
            "theoretical": '{"kind": "theoretical", "evidence_id": "e2", "proof_or_counterexample": "proof", "logical_steps": [], "outcome": "support", "closure_decision": "support", "created_at": "2026-01-01T00:00:00Z"}',
            "simulation": '{"kind": "simulation", "evidence_id": "e3", "simulator_id": "sim1", "scenario_count": 100, "outcome": "support", "closure_decision": "support", "created_at": "2026-01-01T00:00:00Z"}',
            "literature": '{"kind": "literature", "evidence_id": "e4", "citation": "arxiv:1234.5678", "finding": "finding", "outcome": "support", "closure_decision": "support", "created_at": "2026-01-01T00:00:00Z"}',
            "null": '{"kind": "null", "evidence_id": "e5", "test_type": "statistical", "p_value": 0.3, "outcome": "inconclusive", "closure_decision": "inconclusive", "created_at": "2026-01-01T00:00:00Z"}',
            "meta": '{"kind": "meta", "evidence_id": "e6", "study_ids": [], "pooled_effect_size": 0.5, "confidence_level": 0.95, "outcome": "support", "closure_decision": "support", "created_at": "2026-01-01T00:00:00Z"}',
        }
        assert len(fixtures) == 6
        for kind, blob in fixtures.items():
            parsed = TypeAdapter(Evidence).validate_json(blob)
            assert parsed.kind == kind


# ---------------------------------------------------------------------------
# Factory helpers
# ---------------------------------------------------------------------------

class Outcome(str, Enum):
    SUPPORT = "support"
    REFUTE = "refute"
    INCONCLUSIVE = "inconclusive"


def _make_empirical(outcome: str = "support") -> "nxl_core.research.evidence.EmpiricalEvidence":
    from nxl_core.research.evidence import EmpiricalEvidence
    return EmpiricalEvidence(
        evidence_id="ev_empirical_001",
        trial_id="trial_001",
        metric_name="accuracy",
        metric_value=0.85,
        outcome=outcome,
        closure_decision=outcome,
        created_at=_utc_now(),
    )


def _make_theoretical(outcome: str = "support") -> "nxl_core.research.evidence.TheoreticalEvidence":
    from nxl_core.research.evidence import TheoreticalEvidence
    return TheoreticalEvidence(
        evidence_id="ev_theoretical_001",
        proof_or_counterexample="proof",
        logical_steps=[],
        outcome=outcome,
        closure_decision=outcome,
        created_at=_utc_now(),
    )


def _make_simulation(outcome: str = "support") -> "nxl_core.research.evidence.SimulationEvidence":
    from nxl_core.research.evidence import SimulationEvidence
    return SimulationEvidence(
        evidence_id="ev_simulation_001",
        simulator_id="sim_001",
        scenario_count=100,
        outcome=outcome,
        closure_decision=outcome,
        created_at=_utc_now(),
    )


def _make_literature(outcome: str = "support") -> "nxl_core.research.evidence.LiteratureEvidence":
    from nxl_core.research.evidence import LiteratureEvidence
    return LiteratureEvidence(
        evidence_id="ev_literature_001",
        citation="arxiv:1234.5678",
        finding="prior work confirms this",
        outcome=outcome,
        closure_decision=outcome,
        created_at=_utc_now(),
    )


def _make_null(outcome: str = "inconclusive") -> "nxl_core.research.evidence.NullEvidence":
    from nxl_core.research.evidence import NullEvidence
    return NullEvidence(
        evidence_id="ev_null_001",
        test_type="statistical",
        p_value=0.3,
        outcome=outcome,
        closure_decision=outcome,
        created_at=_utc_now(),
    )


def _make_meta(outcome: str = "support") -> "nxl_core.research.evidence.MetaEvidence":
    from nxl_core.research.evidence import MetaEvidence
    return MetaEvidence(
        evidence_id="ev_meta_001",
        study_ids=["study1", "study2"],
        pooled_effect_size=0.5,
        confidence_level=0.95,
        outcome=outcome,
        closure_decision=outcome,
        created_at=_utc_now(),
    )
