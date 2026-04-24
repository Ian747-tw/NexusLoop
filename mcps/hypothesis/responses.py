"""mcps.hypothesis.responses — Pydantic response models for hypothesis MCP."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class HypothesisCreateResponse(BaseModel):
    """Response for hypothesis.create."""
    id: str
    spec_hash: str


class HypothesisDataResponse(BaseModel):
    """Response for hypothesis.get / hypothesis.list."""
    id: str
    claim: str
    status: str
    source: str
    hash: str  # no alias — matches store key directly
    trials: list[str] = Field(default_factory=list)
    decision_log: list[dict[str, Any]] = Field(default_factory=list)


class HypothesisCloseResponse(BaseModel):
    """Response for hypothesis.close."""
    id: str
    verdict: str
    status: str = Field(default="closed")


class HypothesisListResponse(BaseModel):
    """Response for hypothesis.list."""
    hypotheses: list[HypothesisDataResponse]
