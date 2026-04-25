"""
nxl_core.research.trial
-----------------------
Polymorphic Trial — 9 discriminated union kinds.

Each Trial carries a ``kind`` discriminator so that
``TypeAdapter(Trial).validate_json(blob)`` dispatches to the
correct concrete model without explicit type tags.
"""
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field


class _BaseTrial(BaseModel):
    """Shared fields for all Trial kinds."""
    trial_id: str
    hypothesis_id: str
    config: dict
    created_at: datetime


class BaselineTrial(_BaseTrial):
    kind: Literal["baseline"] = "baseline"


class AblationTrial(_BaseTrial):
    kind: Literal["ablation"] = "ablation"
    removed_components: list[str] = Field(default_factory=list)


class DiversificationTrial(_BaseTrial):
    kind: Literal["diversification"] = "diversification"
    strategy: str = "random_search"


class SurrogateTrial(_BaseTrial):
    kind: Literal["surrogate"] = "surrogate"
    surrogate_model: str
    train_dataset: str


class FailureModeTrial(_BaseTrial):
    kind: Literal["failure_mode"] = "failure_mode"
    failure_hypothesis_id: str


class OptimizationTrial(_BaseTrial):
    kind: Literal["optimization"] = "optimization"
    optimizer: str = "adam"
    learning_rate: float = 0.001


class TransferTrial(_BaseTrial):
    kind: Literal["transfer"] = "transfer"
    source_dataset: str
    target_dataset: str


class MetaTrial(_BaseTrial):
    kind: Literal["meta"] = "meta"
    meta_method: str = "hyperband"


class ReplayTrial(_BaseTrial):
    kind: Literal["replay"] = "replay"
    replay_trial_id: str


class ChangeIntent(_BaseTrial):
    """Free-form research decision intent — no enforced structure.

    The LLM records what it decided to try and why, in its own words.
    Captured at cycle boundaries via ``cycle_mcp.start(hypothesis_id)``.
    """
    kind: Literal["change_intent"] = "change_intent"
    intent_text: str
    rationale: str = ""


class FreeFormTrial(_BaseTrial):
    """Catch-all for LLM-native research modes that don't fit other types."""
    kind: Literal["free_form"] = "free_form"
    description: str
    notes: list[str] = Field(default_factory=list)


Trial = Annotated[
    Union[
        BaselineTrial,
        AblationTrial,
        DiversificationTrial,
        SurrogateTrial,
        FailureModeTrial,
        OptimizationTrial,
        TransferTrial,
        MetaTrial,
        ReplayTrial,
        ChangeIntent,
        FreeFormTrial,
    ],
    Field(discriminator="kind"),
]
