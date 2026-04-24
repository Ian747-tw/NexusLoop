"""mcps.experiment.responses — Pydantic response models for experiment MCP."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class ExperimentSubmitResponse(BaseModel):
    """Response for experiment.submit."""
    trial_id: str
    status: str = Field(default="pending")


class ExperimentStatusResponse(BaseModel):
    """Response for experiment.status."""
    trial_id: str
    status: str
    metrics: dict = Field(default_factory=dict)
    created_at: datetime


class ExperimentCancelResponse(BaseModel):
    """Response for experiment.cancel."""
    cancelled: bool
    trial_id: str


class ExperimentListResponse(BaseModel):
    """Response for experiment.list."""
    trials: list[ExperimentStatusResponse]
