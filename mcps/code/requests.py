"""mcps.code.requests — tool request models."""
from __future__ import annotations

from pydantic import BaseModel, Field


class CodeReadFile(BaseModel):
    """Request for code.read_file."""

    path: str = Field(description="Path to file relative to project root")


class CodeListFiles(BaseModel):
    """Request for code.list_files."""

    glob_pattern: str = Field(description="Glob pattern to match files")


class CodeEditFile(BaseModel):
    """Request for code.edit_file."""

    path: str = Field(description="Path to file relative to project root")
    old_text: str = Field(description="Exact text to replace")
    new_text: str = Field(description="Replacement text")


class CodeSearch(BaseModel):
    """Request for code.search."""

    query: str = Field(description="Search query string")
    path_filter: str | None = Field(
        default=None, description="Optional path filter to narrow search"
    )