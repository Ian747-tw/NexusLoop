"""mcps.hypothesis.requests — Pydantic request models for hypothesis MCP."""
from __future__ import annotations

from pydantic import BaseModel, Field


class HypothesisCreateRequest(BaseModel):
    """Request for hypothesis.create."""
    text: str = Field(description="Hypothesis claim text")
    confidence: float = Field(description="Confidence score 0.0–1.0", ge=0.0, le=1.0)


class HypothesisGetRequest(BaseModel):
    """Request for hypothesis.get."""
    id: str = Field(description="Hypothesis ID")


class HypothesisCloseRequest(BaseModel):
    """Request for hypothesis.close."""
    id: str = Field(description="Hypothesis ID")
    verdict: str = Field(description="Verdict: confirmed, rejected, or inconclusive")


class HypothesisListRequest(BaseModel):
    """Request for hypothesis.list — no args needed."""
