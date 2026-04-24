"""mcps.compute.requests — Pydantic request models for compute MCP."""
from __future__ import annotations

from pydantic import BaseModel, Field


class ComputeDiskStatusRequest(BaseModel):
    """Request for compute.disk_status."""
    path: str = Field(description="Path to check disk usage for", default="/")


class ComputeGPUStatusRequest(BaseModel):
    """Request for compute.gpu_status — no args needed."""


class ComputeCPUStatusRequest(BaseModel):
    """Request for compute.cpu_status — no args needed."""


class ComputeBudgetStatusRequest(BaseModel):
    """Request for compute.budget_status — no args needed."""
