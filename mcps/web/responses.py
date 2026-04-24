"""mcps.web.responses — tool response models."""
from __future__ import annotations

from pydantic import BaseModel, Field


class FetchResponse(BaseModel):
    """Response for web.fetch."""

    content: str = Field(description="Response body as string")
    status: int = Field(description="HTTP status code")
    cached: bool = Field(description="Whether response was served from cache")


class SearchResult(BaseModel):
    """A single web search result."""

    url: str = Field(description="Result URL")
    title: str = Field(description="Page title")
    snippet: str = Field(description="Brief excerpt")


class SearchResponse(BaseModel):
    """Response for web.search."""

    results: list[SearchResult] = Field(description="List of search results")