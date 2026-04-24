"""mcps.web.requests — tool request models."""
from __future__ import annotations

from pydantic import BaseModel, Field


class WebFetch(BaseModel):
    """Request for web.fetch."""

    url: str = Field(description="URL to fetch (http or https only)")


class WebSearch(BaseModel):
    """Request for web.search."""

    query: str = Field(description="Search query string")
    num_results: int = Field(default=5, description="Number of results to return")