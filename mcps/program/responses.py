"""mcps.program.responses — Pydantic response types for program MCP."""
from __future__ import annotations

from pydantic import BaseModel


class GetStateResponse(BaseModel):
    phase: str
    step: int
    status: str


class GetQueueResponse(BaseModel):
    queue: list[dict]