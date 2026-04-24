"""mcps.literature.requests — tool request models."""
from __future__ import annotations

from pydantic import BaseModel, Field


class LiteraturePut(BaseModel):
    """Request for literature.put."""

    paper_id: str = Field(description="Unique paper identifier")
    metadata: dict[str, str] = Field(description="Paper metadata as key-value pairs")


class LiteratureGet(BaseModel):
    """Request for literature.get."""

    paper_id: str = Field(description="Unique paper identifier")


class LiteratureList(BaseModel):
    """Request for literature.list."""


class LiteratureSearch(BaseModel):
    """Request for literature.search."""

    query: str = Field(description="Query string to search in metadata")