"""mcps.web.server — WebMCP implementation."""
from __future__ import annotations

import time
from typing import Any

import requests

from mcps._shared.base import BaseMCPServer

from .requests import WebFetch, WebSearch
from .responses import SearchResult


class WebMCP(BaseMCPServer):
    """MCP for web fetch and search with allowlist and simple TTL cache."""

    def __init__(self) -> None:
        super().__init__("web")
        self._cache: dict[str, tuple[str, int, float]] = {}
        self._cache_ttl = 300.0  # 5 minutes

    # ------------------------------------------------------------------
    # Tool definitions
    # ------------------------------------------------------------------

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "name": "web.fetch",
                "description": "Fetch a URL (http/https only) with in-memory cache.",
                "inputSchema": {
                    "type": "object",
                    "properties": {"url": {"type": "string"}},
                    "required": ["url"],
                },
            },
            {
                "name": "web.search",
                "description": "Search the web for a query.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "num_results": {"type": "integer", "default": 5},
                    },
                    "required": ["query"],
                },
            },
        ]

    # ------------------------------------------------------------------
    # Handler
    # ------------------------------------------------------------------

    async def handle_tool(
        self, tool_name: str, args: dict[str, Any]
    ) -> dict[str, Any]:
        self.emit_tool_requested(tool_name, args)
        decision = self._policy.check(tool_name, args)
        if not decision.allowed:
            return {"ok": False, "error": f"Policy denied: {decision.reason}"}

        if tool_name == "web.fetch":
            return await self._fetch(WebFetch(**args))
        if tool_name == "web.search":
            return await self._search(WebSearch(**args))
        return {"ok": False, "error": f"Unknown tool: {tool_name}"}

    # ------------------------------------------------------------------
    # Allowlist
    # ------------------------------------------------------------------

    def _is_allowed(self, url: str) -> bool:
        """Only allow http:// and https:// URLs."""
        try:
            from urllib.parse import urlparse
            parsed = urlparse(url)
            return parsed.scheme in ("http", "https")
        except Exception:
            return False

    # ------------------------------------------------------------------
    # Cache
    # ------------------------------------------------------------------

    def _get_cached(self, url: str) -> tuple[str, bool] | None:
        """Return (content, True) if cached and fresh, else None."""
        entry = self._cache.get(url)
        if entry is None:
            return None
        content, status, timestamp = entry
        if time.monotonic() - timestamp > self._cache_ttl:
            del self._cache[url]
            return None
        return content, True

    def _set_cached(self, url: str, content: str, status: int) -> None:
        """Store response in cache."""
        self._cache[url] = (content, status, time.monotonic())

    # ------------------------------------------------------------------
    # Tool implementations
    # ------------------------------------------------------------------

    async def _fetch(self, req: WebFetch) -> dict[str, Any]:
        if not self._is_allowed(req.url):
            return {"ok": False, "error": "URL scheme not allowed: only http/https permitted"}

        cached = self._get_cached(req.url)
        if cached:
            content, _ = cached
            return {"ok": True, "data": {"content": content, "status": 200, "cached": True}}

        try:
            resp = requests.get(req.url, timeout=10, headers={"User-Agent": "NexusLoop/1.0"})
            content = resp.text
            self._set_cached(req.url, content, resp.status_code)
            return {"ok": True, "data": {"content": content, "status": resp.status_code, "cached": False}}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def _search(self, req: WebSearch) -> dict[str, Any]:
        try:
            # Simple web search using DuckDuckGo HTML
            params = {"q": req.query, "kl": "en-us"}
            resp = requests.get(
                "https://html.duckduckgo.com/html/",
                params=params,
                timeout=10,
                headers={"User-Agent": "NexusLoop/1.0"},
            )
            if not resp.ok:
                return {"ok": False, "error": f"Search failed with status {resp.status_code}"}

            from bs4 import BeautifulSoup
            soup = BeautifulSoup(resp.text, "html.parser")
            results: list[SearchResult] = []
            for result in soup.select(".result")[: req.num_results]:
                a = result.select_one("a.result__a")
                snippet_elem = result.select_one("a.result__snippet")
                if a and a.get("href"):
                    results.append(SearchResult(
                        url=a["href"],
                        title=a.get_text(strip=True),
                        snippet=snippet_elem.get_text(strip=True) if snippet_elem else "",
                    ))
            return {"ok": True, "data": {"results": [r.model_dump() for r in results]}}
        except Exception as e:
            return {"ok": False, "error": str(e)}