"""mcps.spec.requests — Pydantic request types for spec MCP."""
from __future__ import annotations

from pydantic import BaseModel


class GetProjectRequest(BaseModel):
    """No args required."""
    pass


class GetOperationsRequest(BaseModel):
    """No args required."""
    pass