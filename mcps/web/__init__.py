"""mcps.web — web fetch and search with allowlist and in-memory cache."""
from __future__ import annotations

from .server import WebMCP
from .requests import WebFetch, WebSearch
from .responses import FetchResponse, SearchResponse

__all__ = [
    "WebMCP",
    "WebFetch",
    "WebSearch",
    "FetchResponse",
    "SearchResponse",
]