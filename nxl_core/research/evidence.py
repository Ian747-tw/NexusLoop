"""
nxl_core.research.evidence
-------------------------
Polymorphic Evidence — 6 discriminated union kinds.

Each Evidence carries a ``kind`` discriminator so that
``TypeAdapter(Evidence).validate_json(blob)`` dispatches to the
correct concrete model.

closure_decision is set at construction time based on the ``outcome`` field:
  outcome="support"    → ClosureDecision.SUPPORT
  outcome="refute"     → ClosureDecision.REFUTE
  outcome="inconclusive" → ClosureDecision.INCONCLUSIVE
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field


class ClosureDecision(str, Enum):
    SUPPORT = "support"
    REFUTE = "refute"
    INCONCLUSIVE = "inconclusive"


class _BaseEvidence(BaseModel):
    """Shared fields for all Evidence kinds."""
    evidence_id: str
    outcome: Literal["support", "refute", "inconclusive"]
    closure_decision: ClosureDecision
    created_at: datetime


class EmpiricalEvidence(_BaseEvidence):
    kind: Literal["empirical"] = "empirical"
    trial_id: str
    metric_name: str
    metric_value: float


class TheoreticalEvidence(_BaseEvidence):
    kind: Literal["theoretical"] = "theoretical"
    proof_or_counterexample: str
    logical_steps: list[str] = Field(default_factory=list)


class SimulationEvidence(_BaseEvidence):
    kind: Literal["simulation"] = "simulation"
    simulator_id: str
    scenario_count: int


class LiteratureEvidence(_BaseEvidence):
    kind: Literal["literature"] = "literature"
    citation: str
    finding: str


class NullEvidence(_BaseEvidence):
    kind: Literal["null"] = "null"
    test_type: str
    p_value: float


class MetaEvidence(_BaseEvidence):
    kind: Literal["meta"] = "meta"
    study_ids: list[str] = Field(default_factory=list)
    pooled_effect_size: float
    confidence_level: float


Evidence = Annotated[
    Union[
        EmpiricalEvidence,
        TheoreticalEvidence,
        SimulationEvidence,
        LiteratureEvidence,
        NullEvidence,
        MetaEvidence,
    ],
    Field(discriminator="kind"),
]
