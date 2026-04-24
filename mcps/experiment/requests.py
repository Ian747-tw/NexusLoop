"""mcps.experiment.requests — Pydantic request models for experiment MCP."""
from __future__ import annotations

from pydantic import BaseModel, Field


class ExperimentSubmitRequest(BaseModel):
    """Request for experiment.submit."""
    config: dict = Field(description="Trial configuration dict")


class ExperimentStatusRequest(BaseModel):
    """Request for experiment.status."""
    trial_id: str = Field(description="Trial ID to check")


class ExperimentCancelRequest(BaseModel):
    """Request for experiment.cancel."""
    trial_id: str = Field(description="Trial ID to cancel")


class ExperimentListRequest(BaseModel):
    """Request for experiment.list — no args needed."""
