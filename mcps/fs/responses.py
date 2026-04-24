"""mcps.fs.responses — Response models for fs MCP."""
from __future__ import annotations

from pydantic import BaseModel


class MoveResponse(BaseModel):
    """Response from fs.move."""
    ok: bool
    src: str
    dst: str
    error: str | None = None


class ArchiveResponse(BaseModel):
    """Response from fs.archive."""
    ok: bool
    original_path: str
    archive_path: str
    tag: str
    error: str | None = None


class RestoreResponse(BaseModel):
    """Response from fs.restore."""
    ok: bool
    archive_path: str
    restored_path: str
    from_tag: str
    error: str | None = None


class WorkspaceNewResponse(BaseModel):
    """Response from fs.workspace_new."""
    ok: bool
    workspace_path: str
    owner: str
    error: str | None = None


class StageResponse(BaseModel):
    """Response from fs.stage."""
    ok: bool
    path: str
    error: str | None = None


class UnstageResponse(BaseModel):
    """Response from fs.unstage."""
    ok: bool
    path: str
    error: str | None = None
