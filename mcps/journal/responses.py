"""mcps.journal.responses — Pydantic response types for journal MCP."""
from __future__ import annotations

from pydantic import BaseModel


class AppendResponse(BaseModel):
    event_id: str


class TailResponse(BaseModel):
    events: list[dict]


class QueryResponse(BaseModel):
    events: list[dict]