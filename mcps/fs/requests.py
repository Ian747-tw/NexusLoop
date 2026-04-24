"""mcps.fs.requests — Request models for fs MCP."""
from __future__ import annotations

from pydantic import BaseModel, Field


class FsMove(BaseModel):
    """Request to atomically rename a file."""
    src: str = Field(description="Source path")
    dst: str = Field(description="Destination path")


class FsArchive(BaseModel):
    """Request to archive a file to .nxl/archive/<tag>/."""
    path: str = Field(description="Path to archive")
    tag: str = Field(description="Archive tag")


class FsRestore(BaseModel):
    """Request to restore a file from archive."""
    path: str = Field(description="Path to restore")
    from_tag: str = Field(description="Tag to restore from")


class FsWorkspaceNew(BaseModel):
    """Request to create a scratch workspace."""
    owner: str = Field(description="Owner of the workspace")


class FsStage(BaseModel):
    """Request to stage a file for commit."""
    path: str = Field(description="Path to stage")


class FsUnstage(BaseModel):
    """Request to unstage a file."""
    path: str = Field(description="Path to unstage")
