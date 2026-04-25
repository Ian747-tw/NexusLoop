"""mcps.hypothesis_mcp.server — MCP server for creating and retrieving hypotheses."""
from __future__ import annotations

import time
import random
from typing import Any

from mcps._shared.base import BaseMCPServer


def _ulid() -> str:
    """Generate a ULID-formatted string."""
    entropy = random.getrandbits(80)
    time_part = int(time.time() * 1000).to_bytes(8, "big").hex().lower().ljust(10, "0")[:10]
    rand_part = format(entropy % (2**64), "012x") + format(entropy >> 64, "012x")
    return f"01H{time_part}{rand_part[:12]}"


# Module-level in-memory store for hypotheses
_hypotheses: dict[str, dict[str, Any]] = {}


class HypothesisMCPServer(BaseMCPServer):
    """Create and retrieve research hypotheses."""

    def __init__(self) -> None:
        super().__init__("hypothesis")

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "name": "hypothesis.create",
                "description": "Create a new hypothesis",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "claim": {
                            "type": "string",
                            "description": "The hypothesis claim in plain text",
                        },
                        "source": {
                            "type": "string",
                            "enum": ["human", "literature", "surrogate", "ablation", "diversification", "failure"],
                            "description": "Origin of this hypothesis",
                        },
                    },
                    "required": ["claim", "source"],
                    "additionalProperties": False,
                },
            },
            {
                "name": "hypothesis.list",
                "description": "List all hypotheses",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": False,
                },
            },
            {
                "name": "hypothesis.get",
                "description": "Get a specific hypothesis by ID",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "hypothesis_id": {
                            "type": "string",
                            "description": "ID of the hypothesis to retrieve",
                        },
                    },
                    "required": ["hypothesis_id"],
                    "additionalProperties": False,
                },
            },
        ]

    async def handle_tool(self, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        self.emit_tool_requested(tool_name, args)
        decision = self._policy.check(tool_name, args)
        if not decision.allowed:
            return {"ok": False, "error": f"Policy denied: {decision.reason}"}

        if tool_name == "hypothesis.create":
            return await self._create(args)
        elif tool_name == "hypothesis.list":
            return await self._list(args)
        elif tool_name == "hypothesis.get":
            return await self._get(args)
        else:
            return {"ok": False, "error": f"Unknown tool: {tool_name}"}

    async def _create(self, args: dict[str, Any]) -> dict[str, Any]:
        from nxl_core.events.schema import HypothesisCreated
        from nxl_core.events.singletons import journal_log

        hypothesis_id = _ulid()
        claim = str(args["claim"])
        source = str(args["source"])

        # Store in memory
        _hypotheses[hypothesis_id] = {
            "id": hypothesis_id,
            "claim": claim,
            "source": source,
            "created_at": time.time(),
        }

        # Emit HypothesisCreated event
        event = HypothesisCreated(
            hypothesis_id=hypothesis_id,
            claim=claim,
            source=source,  # type: ignore[arg-type]
        )
        log = journal_log()
        log.append(event)

        return {"ok": True, "data": {"hypothesis_id": hypothesis_id}}

    async def _list(self, args: dict[str, Any]) -> dict[str, Any]:
        hypotheses = []
        for hyp in _hypotheses.values():
            hypotheses.append({
                "id": hyp["id"],
                "claim": hyp["claim"],
                "source": hyp["source"],
                "created_at": hyp["created_at"],
            })
        return {"ok": True, "data": {"hypotheses": hypotheses}}

    async def _get(self, args: dict[str, Any]) -> dict[str, Any]:
        hypothesis_id = str(args["hypothesis_id"])
        if hypothesis_id not in _hypotheses:
            return {"ok": False, "error": f"Hypothesis {hypothesis_id} not found"}
        hyp = _hypotheses[hypothesis_id]
        return {"ok": True, "data": {
            "id": hyp["id"],
            "claim": hyp["claim"],
            "source": hyp["source"],
            "created_at": hyp["created_at"],
        }}