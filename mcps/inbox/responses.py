"""mcps.inbox.responses — Pydantic response types for inbox MCP."""
from __future__ import annotations

from pydantic import BaseModel


class DirectiveSummary(BaseModel):
    directive_id: str
    filename: str


class ListResponse(BaseModel):
    directives: list[DirectiveSummary]


class GetResponse(BaseModel):
    directive_id: str
    content: str
    filename: str | None = None
    error: str | None = None