"""mcps.shell.responses — Response models for shell MCP."""
from __future__ import annotations

from pydantic import BaseModel


class ExecResponse(BaseModel):
    """Response from shell.exec."""
    ok: bool
    cmd: str
    exit_code: int | None = None
    stdout: str | None = None
    stderr: str | None = None
    duration_ms: int | None = None
    error: str | None = None
