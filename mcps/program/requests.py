"""mcps.program.requests — Pydantic request types for program MCP."""
from __future__ import annotations

from pydantic import BaseModel


class GetStateRequest(BaseModel):
    """No args required."""
    pass


class GetQueueRequest(BaseModel):
    """No args required."""
    pass