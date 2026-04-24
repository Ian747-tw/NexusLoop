"""mcps.pkg.responses — Response models for pkg MCP."""
from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Any


class AddResponse(BaseModel):
    """Response from pkg.add."""
    ok: bool
    package_name: str
    version_installed: str | None = None
    lockfile_diff: dict[str, Any] | None = None
    error: str | None = None


class RemoveResponse(BaseModel):
    """Response from pkg.remove."""
    ok: bool
    package_name: str
    lockfile_diff: dict[str, Any] | None = None
    error: str | None = None


class FreezeResponse(BaseModel):
    """Response from pkg.freeze."""
    ok: bool
    lockfile_diff: dict[str, Any] | None = None
    error: str | None = None
