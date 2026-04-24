"""mcps.spec.responses — Pydantic response types for spec MCP."""
from __future__ import annotations

from pydantic import BaseModel


class GetProjectResponse(BaseModel):
    name: str
    mode: str
    metric: str


class GetOperationsResponse(BaseModel):
    default_provider: str | None = None