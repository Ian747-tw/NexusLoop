"""mcps.shell.requests — Request models for shell MCP."""
from __future__ import annotations

from pydantic import BaseModel, Field


class ShellExec(BaseModel):
    """Request to execute a shell command."""
    cmd: str = Field(description="Shell command to execute")
    ttl: int = Field(
        default=300,
        description="Time-to-live in seconds (max 300)",
    )
    cwd: str | None = Field(
        default=None,
        description="Working directory for the command",
    )
    tag: str | None = Field(
        default=None,
        description="Tag for the shell session",
    )
    capture: bool = Field(
        default=True,
        description="Whether to capture and return output",
    )
