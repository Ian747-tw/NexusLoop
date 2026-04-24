"""mcps.compute.responses — Pydantic response models for compute MCP."""
from __future__ import annotations

from pydantic import BaseModel


class ComputeGPUStatusResponse(BaseModel):
    """Response for compute.gpu_status."""
    available: bool
    name: str = ""
    memory_free_mb: int = 0


class ComputeCPUStatusResponse(BaseModel):
    """Response for compute.cpu_status."""
    cores: int
    usage_percent: float


class ComputeDiskStatusResponse(BaseModel):
    """Response for compute.disk_status."""
    free_gb: int
    total_gb: int


class ComputeBudgetStatusResponse(BaseModel):
    """Response for compute.budget_status."""
    tokens_spent: int = 0
    tokens_budget: int = 0
    cycles_used: int = 0
