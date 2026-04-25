"""mcps.cycle.server — cycle boundary marker MCP server."""
from __future__ import annotations

from typing import Any

from mcps._shared.base import BaseMCPServer


class CycleMCPServer(BaseMCPServer):
    """Mark cycle boundaries by emitting CycleStarted / CycleCompleted / CycleFailed events."""

    def __init__(self) -> None:
        super().__init__("cycle")

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "name": "cycle.start",
                "description": "Mark the start of a research cycle",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "hypothesis_id": {
                            "type": "string",
                            "description": "Hypothesis being explored in this cycle",
                        },
                        "brief_hash": {
                            "type": "string",
                            "description": "Hash of the cycle's brief",
                        },
                    },
                    "required": ["hypothesis_id", "brief_hash"],
                    "additionalProperties": False,
                },
            },
            {
                "name": "cycle.end",
                "description": "Mark the end of a research cycle",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "status": {
                            "type": "string",
                            "enum": ["completed", "failed"],
                            "description": "Whether the cycle succeeded or failed",
                        },
                        "hypothesis_id": {
                            "type": "string",
                            "description": "Hypothesis being explored in this cycle",
                        },
                        "brief_hash": {
                            "type": "string",
                            "description": "Hash of the cycle's brief",
                        },
                        "summary_tokens": {
                            "type": "integer",
                            "description": "Token count of the cycle summary (required when status is 'completed')",
                        },
                        "reason": {
                            "type": "string",
                            "description": "Why the cycle failed (required when status is 'failed')",
                        },
                    },
                    "required": ["status", "hypothesis_id", "brief_hash"],
                    "additionalProperties": False,
                },
            },
        ]

    async def handle_tool(self, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        self.emit_tool_requested(tool_name, args)
        decision = self._policy.check(tool_name, args)
        if not decision.allowed:
            return {"ok": False, "error": f"Policy denied: {decision.reason}"}

        if tool_name == "cycle.start":
            return await self._start(args)
        elif tool_name == "cycle.end":
            return await self._end(args)
        else:
            return {"ok": False, "error": f"Unknown tool: {tool_name}"}

    async def _start(self, args: dict[str, Any]) -> dict[str, Any]:
        from nxl_core.events.schema import CycleStarted
        from nxl_core.events.singletons import journal_log

        hypothesis_id = str(args["hypothesis_id"])
        brief_hash = str(args["brief_hash"])

        event = CycleStarted(brief_hash=brief_hash, hypothesis_id=hypothesis_id)
        log = journal_log()
        event_id = log.append(event)
        return {"ok": True, "data": {"event_id": event_id}}

    async def _end(self, args: dict[str, Any]) -> dict[str, Any]:
        from nxl_core.events.schema import CycleCompleted, CycleFailed
        from nxl_core.events.singletons import journal_log

        status = str(args["status"])
        hypothesis_id = str(args["hypothesis_id"])
        brief_hash = str(args["brief_hash"])

        log = journal_log()
        if status == "completed":
            summary_tokens = int(args.get("summary_tokens", 0))
            event = CycleCompleted(
                brief_hash=brief_hash,
                hypothesis_id=hypothesis_id,
                summary_tokens=summary_tokens,
            )
            event_id = log.append(event)
            return {"ok": True, "data": {"event_id": event_id}}
        elif status == "failed":
            reason = str(args.get("reason", "unknown"))
            event = CycleFailed(
                brief_hash=brief_hash,
                hypothesis_id=hypothesis_id,
                reason=reason,
            )
            event_id = log.append(event)
            return {"ok": True, "data": {"event_id": event_id}}
        else:
            return {"ok": False, "error": f"Invalid status: {status}"}