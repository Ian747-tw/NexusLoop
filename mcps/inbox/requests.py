"""mcps.inbox.requests — Pydantic request types for inbox MCP."""
from __future__ import annotations

from pydantic import BaseModel


class ListRequest(BaseModel):
    """No args required."""
    pass


class GetRequest(BaseModel):
    directive_id: str