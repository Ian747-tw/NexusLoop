"""mcps.literature.responses — tool response models."""
from __future__ import annotations

from pydantic import BaseModel, Field


class PutResponse(BaseModel):
    """Response for literature.put."""

    success: bool = Field(description="Whether metadata was stored")


class GetResponse(BaseModel):
    """Response for literature.get."""

    metadata: dict[str, str] | None = Field(description="Stored metadata or None if not found")


class ListResponse(BaseModel):
    """Response for literature.list."""

    paper_ids: list[str] = Field(description="All known paper IDs")


class SearchResponse(BaseModel):
    """Response for literature.search."""

    paper_ids: list[str] = Field(description="Paper IDs matching the query")