"""mcps.literature.server — LiteratureMCP implementation."""
from __future__ import annotations

from typing import Any

from mcps._shared.base import BaseMCPServer

from .requests import LiteratureGet, LiteratureList, LiteraturePut, LiteratureSearch


class LiteratureMCP(BaseMCPServer):
    """MCP for paper metadata cache (get/put/list/search)."""

    def __init__(self) -> None:
        super().__init__("literature")
        self._store: dict[str, dict[str, str]] = {}

    # ------------------------------------------------------------------
    # Tool definitions
    # ------------------------------------------------------------------

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "name": "literature.put",
                "description": "Store metadata for a paper.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "paper_id": {"type": "string"},
                        "metadata": {"type": "object"},
                    },
                    "required": ["paper_id", "metadata"],
                },
            },
            {
                "name": "literature.get",
                "description": "Retrieve metadata for a paper.",
                "inputSchema": {
                    "type": "object",
                    "properties": {"paper_id": {"type": "string"}},
                    "required": ["paper_id"],
                },
            },
            {
                "name": "literature.list",
                "description": "List all known paper IDs.",
                "inputSchema": {"type": "object", "properties": {}},
            },
            {
                "name": "literature.search",
                "description": "Search for papers by metadata query.",
                "inputSchema": {
                    "type": "object",
                    "properties": {"query": {"type": "string"}},
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

        if tool_name == "literature.put":
            return await self._put(LiteraturePut(**args))
        if tool_name == "literature.get":
            return await self._get(LiteratureGet(**args))
        if tool_name == "literature.list":
            return await self._list(LiteratureList(**args))
        if tool_name == "literature.search":
            return await self._search(LiteratureSearch(**args))
        return {"ok": False, "error": f"Unknown tool: {tool_name}"}

    # ------------------------------------------------------------------
    # Tool implementations
    # ------------------------------------------------------------------

    async def _put(self, req: LiteraturePut) -> dict[str, Any]:
        self._store[req.paper_id] = req.metadata
        return {"ok": True, "data": {"success": True}}

    async def _get(self, req: LiteratureGet) -> dict[str, Any]:
        metadata = self._store.get(req.paper_id)
        return {"ok": True, "data": {"metadata": metadata}}

    async def _list(self, req: LiteratureList) -> dict[str, Any]:
        return {"ok": True, "data": {"paper_ids": sorted(self._store.keys())}}

    async def _search(self, req: LiteratureSearch) -> dict[str, Any]:
        q = req.query.lower()
        matches = [
            pid for pid, meta in self._store.items()
            if q in str(meta).lower()
        ]
        return {"ok": True, "data": {"paper_ids": sorted(matches)}}