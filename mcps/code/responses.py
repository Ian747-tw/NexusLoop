"""mcps.code.responses — tool response models."""
from __future__ import annotations

from pydantic import BaseModel, Field


class ReadFileResponse(BaseModel):
    """Response for code.read_file."""

    content: str = Field(description="Full file content as string")
    lines: int = Field(description="Total number of lines in file")


class ListFilesResponse(BaseModel):
    """Response for code.list_files."""

    paths: list[str] = Field(description="List of matching file paths")


class EditFileResponse(BaseModel):
    """Response for code.edit_file."""

    success: bool = Field(description="Whether the edit was applied")
    lines_changed: int = Field(description="Number of lines modified")


class SearchResponse(BaseModel):
    """Response for code.search."""

    matches: list[str] = Field(description="Matching file lines")