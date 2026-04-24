"""mcps.hypothesis.server — HypothesisRegistry CRUD MCP server."""
from __future__ import annotations

import uuid
from typing import Any

from mcps._shared.base import BaseMCPServer
from mcps.hypothesis.requests import (
    HypothesisCloseRequest,
    HypothesisCreateRequest,
    HypothesisGetRequest,
    HypothesisListRequest,
)
from mcps.hypothesis.responses import (
    HypothesisCloseResponse,
    HypothesisCreateResponse,
    HypothesisDataResponse,
    HypothesisListResponse,
)
from nxl_core.events.schema import ToolRequested

# In-memory hypothesis store (replace with real registry when available)
_hypotheses: dict[str, dict[str, Any]] = {}


def _generate_id() -> str:
    return uuid.uuid4().hex[:16]


class HypothesisServer(BaseMCPServer):
    """MCP server for Hypothesis CRUD operations."""

    name = "hypothesis"

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "name": "hypothesis.create",
                "description": "Create a new hypothesis",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "text": {"type": "string", "description": "Hypothesis claim text"},
                        "confidence": {
                            "type": "number",
                            "description": "Confidence score 0.0–1.0",
                        },
                    },
                    "required": ["text", "confidence"],
                },
            },
            {
                "name": "hypothesis.list",
                "description": "List all hypotheses",
                "inputSchema": {"type": "object", "properties": {}},
            },
            {
                "name": "hypothesis.get",
                "description": "Get a single hypothesis by ID",
                "inputSchema": {
                    "type": "object",
                    "properties": {"id": {"type": "string"}},
                    "required": ["id"],
                },
            },
            {
                "name": "hypothesis.close",
                "description": "Close a hypothesis with a verdict",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "verdict": {
                            "type": "string",
                            "enum": ["confirmed", "rejected", "inconclusive"],
                        },
                    },
                    "required": ["id", "verdict"],
                },
            },
        ]

    def _emit(self, tool_name: str, args: dict[str, Any]) -> None:
        from nxl_core.events.singletons import journal_log

        event_log = journal_log()
        event_log.append(
            ToolRequested(
                tool_name=tool_name,
                args_hash=str(hash(frozenset(args.items()))),
                requesting_skill=None,
            )
        )

    async def handle_tool(self, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        if tool_name == "hypothesis.create":
            return await self._create(args)
        elif tool_name == "hypothesis.list":
            return await self._list(args)
        elif tool_name == "hypothesis.get":
            return await self._get(args)
        elif tool_name == "hypothesis.close":
            return await self._close(args)
        else:
            return {"ok": False, "error": f"Unknown tool: {tool_name}"}

    async def _create(self, args: dict[str, Any]) -> dict[str, Any]:
        if not self.check_policy("hypothesis.create", args):
            return {"ok": False, "error": "Policy denied"}
        self._emit("hypothesis.create", args)

        req = HypothesisCreateRequest(**args)
        hyp_id = _generate_id()
        spec_hash = uuid.uuid4().hex[:16]

        hypo = {
            "id": hyp_id,
            "claim": req.text,
            "confidence": req.confidence,
            "status": "active",
            "hash": spec_hash,
            "trials": [],
            "decision_log": [],
        }
        _hypotheses[hyp_id] = hypo

        return {
            "ok": True,
            "data": HypothesisCreateResponse(id=hyp_id, spec_hash=spec_hash).model_dump(),
        }

    async def _list(self, args: dict[str, Any]) -> dict[str, Any]:
        if not self.check_policy("hypothesis.list", args):
            return {"ok": False, "error": "Policy denied"}
        self._emit("hypothesis.list", args)

        hypos = [
            HypothesisDataResponse(
                id=h["id"],
                claim=h["claim"],
                status=h["status"],
                source="human",
                hash=h["hash"],
                trials=h.get("trials", []),
                decision_log=h.get("decision_log", []),
            ).model_dump()
            for h in _hypotheses.values()
        ]
        return {
            "ok": True,
            "data": HypothesisListResponse(hypotheses=hypos).model_dump(),
        }

    async def _get(self, args: dict[str, Any]) -> dict[str, Any]:
        if not self.check_policy("hypothesis.get", args):
            return {"ok": False, "error": "Policy denied"}
        self._emit("hypothesis.get", args)

        req = HypothesisGetRequest(**args)
        hypo = _hypotheses.get(req.id)
        if hypo is None:
            return {"ok": False, "error": f"Hypothesis {req.id} not found"}

        return {
            "ok": True,
            "data": HypothesisDataResponse(
                id=hypo["id"],
                claim=hypo["claim"],
                status=hypo["status"],
                source="human",
                hash=hypo["hash"],
                trials=hypo.get("trials", []),
                decision_log=hypo.get("decision_log", []),
            ).model_dump(),
        }

    async def _close(self, args: dict[str, Any]) -> dict[str, Any]:
        if not self.check_policy("hypothesis.close", args):
            return {"ok": False, "error": "Policy denied"}
        self._emit("hypothesis.close", args)

        req = HypothesisCloseRequest(**args)
        hypo = _hypotheses.get(req.id)
        if hypo is None:
            return {"ok": False, "error": f"Hypothesis {req.id} not found"}

        hypo["status"] = "closed"
        hypo["verdict"] = req.verdict
        hypo["decision_log"].append(
            {"decision": req.verdict, "timestamp": "now", "reason": "closed via MCP"}
        )

        return {
            "ok": True,
            "data": HypothesisCloseResponse(
                id=req.id, verdict=req.verdict, status="closed"
            ).model_dump(),
        }
