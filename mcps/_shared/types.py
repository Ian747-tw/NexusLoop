"""mcps._shared.types — shared Pydantic request/response types across all MCPs."""
from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Any


class MCPRequest(BaseModel):
    """Base request wrapper for all MCP calls."""
    tool: str
    args: dict[str, Any] = Field(default_factory=dict)


class MCPResponse(BaseModel):
    """Base response wrapper for all MCP calls."""
    ok: bool
    data: Any = None
    error: str | None = None


class MCPToolDefinition(BaseModel):
    """Tool definition for MCP registry."""
    name: str
    description: str
    input_schema: dict[str, Any]
