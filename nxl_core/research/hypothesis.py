"""
nxl_core.research.hypothesis
----------------------------
Hypothesis with canonical hash for duplicate detection.

The hash is a deterministic 16-char hex string computed from:
  {axis_family, hyperparam_diff (sorted), evaluator, dataset_rev}

Duplicate detection: two Hypotheses with identical hashes describe the
same experimental space and should not be run in parallel.
"""
from __future__ import annotations

import hashlib
import json
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class HypothesisStatus(str, Enum):
    ACTIVE = "active"
    COMPLETED = "completed"
    DISCARDED = "discarded"
    ABANDONED = "abandoned"


class Decision(BaseModel):
    timestamp: str
    decision: str
    reason: str


class EvidenceShape(BaseModel):
    axis_family: str
    hyperparam_diff: dict
    evaluator: str
    dataset_rev: str


class ResourceBudget(BaseModel):
    trial_count: int = 1
    max_tokens: int = 1_000_000


class Hypothesis(BaseModel):
    id: str
    claim: str
    rationale: str
    source: Literal["human", "literature", "surrogate", "ablation", "diversification", "failure"]
    evidence_shape: EvidenceShape
    prerequisites: list[str] = Field(default_factory=list)
    budget: ResourceBudget = Field(default_factory=ResourceBudget)
    seeds_required: int = 1
    priority: float = 0.5
    status: HypothesisStatus = HypothesisStatus.ACTIVE
    trials: list[str] = Field(default_factory=list)
    decision_log: list[Decision] = Field(default_factory=list)
    citations: list[str] = Field(default_factory=list)
    hash: str = ""

    @model_validator(mode="after")
    def compute_hash(self) -> "Hypothesis":
        """Compute canonical hash from evidence_shape fields (hyperparam_diff sorted)."""
        hyperparam_sorted = dict(sorted(self.evidence_shape.hyperparam_diff.items()))
        canonical = json.dumps(
            {
                "axis_family": self.evidence_shape.axis_family,
                "hyperparam_diff": hyperparam_sorted,
                "evaluator": self.evidence_shape.evaluator,
                "dataset_rev": self.evidence_shape.dataset_rev,
            },
            sort_keys=True,
        )
        self.hash = hashlib.sha256(canonical.encode()).hexdigest()[:16]
        return self