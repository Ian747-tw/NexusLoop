"""mcps.journal.requests — Pydantic request types for journal MCP."""
from __future__ import annotations

from pydantic import BaseModel, Field


class AppendRequest(BaseModel):
    event: dict


class TailRequest(BaseModel):
    n: int = Field(gt=0)


class QueryRequest(BaseModel):
    kind: str
    limit: int = Field(gt=0)