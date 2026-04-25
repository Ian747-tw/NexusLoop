"""mcps.evidence.server — record evidence at cycle boundaries."""
from __future__ import annotations

from typing import Any

from mcps._shared.base import BaseMCPServer


class EvidenceMCPServer(BaseMCPServer):
    """Record evidence at trial boundaries, emitted as EvidenceCollected events."""

    def __init__(self) -> None:
        super().__init__("evidence")

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "name": "evidence.record",
                "description": "Record evidence for a trial",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "trial_id": {
                            "type": "string",
                            "description": "ID of the trial this evidence belongs to",
                        },
                        "evidence_type": {
                            "type": "string",
                            "enum": [
                                "scalar_metric",
                                "ordering_preference",
                                "rubric",
                                "threshold_check",
                                "distributional",
                                "informational",
                            ],
                            "description": "Kind of evidence collected",
                        },
                        "value": {
                            "description": "The evidence value (float, dict, or str)",
                        },
                    },
                    "required": ["trial_id", "evidence_type", "value"],
                    "additionalProperties": False,
                },
            },
            {
                "name": "evidence.list",
                "description": "List evidence recorded for a trial",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "trial_id": {
                            "type": "string",
                            "description": "ID of the trial to list evidence for",
                        },
                    },
                    "required": ["trial_id"],
                    "additionalProperties": False,
                },
            },
        ]

    async def handle_tool(self, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        self.emit_tool_requested(tool_name, args)
        decision = self._policy.check(tool_name, args)
        if not decision.allowed:
            return {"ok": False, "error": f"Policy denied: {decision.reason}"}

        if tool_name == "evidence.record":
            return await self._record(args)
        elif tool_name == "evidence.list":
            return await self._list(args)
        else:
            return {"ok": False, "error": f"Unknown tool: {tool_name}"}

    async def _record(self, args: dict[str, Any]) -> dict[str, Any]:
        from nxl_core.events.schema import EvidenceCollected
        from nxl_core.events.singletons import journal_log

        trial_id = str(args["trial_id"])
        evidence_type = str(args["evidence_type"])
        value = args["value"]  # float | dict | str

        event = EvidenceCollected(
            trial_id=trial_id,
            evidence_type=evidence_type,  # type: ignore[arg-type]
            value=value,
        )
        log = journal_log()
        event_id = log.append(event)
        return {"ok": True, "data": {"event_id": event_id}}

    async def _list(self, args: dict[str, Any]) -> dict[str, Any]:
        from nxl_core.events.singletons import journal_log

        trial_id = str(args["trial_id"])
        log = journal_log()

        records = []
        for event in log.read_all():
            if hasattr(event, "kind") and event.kind == "evidence_collected":
                if hasattr(event, "trial_id") and event.trial_id == trial_id:
                    records.append({
                        "event_id": getattr(event, "event_id", None),
                        "evidence_type": event.evidence_type,
                        "value": event.value,
                    })

        return {"ok": True, "data": {"trial_id": trial_id, "records": records}}