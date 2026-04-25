"""mcps.trial.server — trial management MCP server."""
from __future__ import annotations

from typing import Any

from mcps._shared.base import BaseMCPServer

VALID_TRIAL_KINDS = frozenset([
    "baseline",
    "ablation",
    "diversification",
    "surrogate",
    "failure_mode",
    "optimization",
    "transfer",
    "meta",
    "replay",
    "change_intent",
    "free_form",
])


class TrialMCPServer(BaseMCPServer):
    """Manage trials — start, complete, fail, and list."""

    def __init__(self) -> None:
        super().__init__("trial")
        self._trials: dict[str, dict[str, Any]] = {}

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "name": "trial.start",
                "description": "Start a new trial",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "trial_id": {"type": "string", "description": "Unique trial identifier"},
                        "hypothesis_id": {"type": "string", "description": "ID of the hypothesis this trial tests"},
                        "trial_kind": {
                            "type": "string",
                            "enum": list(VALID_TRIAL_KINDS),
                            "description": "Kind of trial",
                        },
                        "config": {
                            "type": "object",
                            "description": "Trial configuration",
                            "additionalProperties": True,
                        },
                    },
                    "required": ["trial_id", "hypothesis_id", "trial_kind"],
                    "additionalProperties": False,
                },
            },
            {
                "name": "trial.complete",
                "description": "Mark a trial as completed with metrics",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "trial_id": {"type": "string", "description": "ID of the trial to complete"},
                        "metrics": {
                            "type": "object",
                            "description": "Measured metrics from the trial",
                            "additionalProperties": True,
                        },
                    },
                    "required": ["trial_id", "metrics"],
                    "additionalProperties": False,
                },
            },
            {
                "name": "trial.fail",
                "description": "Mark a trial as failed",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "trial_id": {"type": "string", "description": "ID of the trial to fail"},
                        "reason": {"type": "string", "description": "Why the trial failed"},
                    },
                    "required": ["trial_id", "reason"],
                    "additionalProperties": False,
                },
            },
            {
                "name": "trial.list",
                "description": "List trials, optionally filtered by hypothesis",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "hypothesis_id": {
                            "type": "string",
                            "description": "Filter trials by hypothesis ID",
                        },
                    },
                    "additionalProperties": False,
                },
            },
        ]

    async def handle_tool(self, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        self.emit_tool_requested(tool_name, args)
        decision = self._policy.check(tool_name, args)
        if not decision.allowed:
            return {"ok": False, "error": f"Policy denied: {decision.reason}"}

        if tool_name == "trial.start":
            return await self._start(args)
        elif tool_name == "trial.complete":
            return await self._complete(args)
        elif tool_name == "trial.fail":
            return await self._fail(args)
        elif tool_name == "trial.list":
            return await self._list(args)
        else:
            return {"ok": False, "error": f"Unknown tool: {tool_name}"}

    async def _start(self, args: dict[str, Any]) -> dict[str, Any]:
        from nxl_core.events.schema import TrialStarted
        from nxl_core.events.singletons import journal_log

        trial_id = str(args["trial_id"])
        hypothesis_id = str(args["hypothesis_id"])
        trial_kind = str(args["trial_kind"])
        config = args.get("config", {})

        if trial_kind not in VALID_TRIAL_KINDS:
            return {"ok": False, "error": f"Invalid trial_kind: {trial_kind}"}

        event = TrialStarted(
            trial_id=trial_id,
            hypothesis_id=hypothesis_id,
            config=config,
        )
        log = journal_log()
        event_id = log.append(event)

        self._trials[trial_id] = {
            "hypothesis_id": hypothesis_id,
            "trial_kind": trial_kind,
            "config": config,
            "status": "running",
        }

        return {"ok": True, "data": {"event_id": event_id}}

    async def _complete(self, args: dict[str, Any]) -> dict[str, Any]:
        from nxl_core.events.schema import TrialCompleted
        from nxl_core.events.singletons import journal_log

        trial_id = str(args["trial_id"])
        metrics = args.get("metrics", {})

        if trial_id not in self._trials:
            return {"ok": False, "error": f"Unknown trial_id: {trial_id}"}

        hypothesis_id = self._trials[trial_id]["hypothesis_id"]

        event = TrialCompleted(
            trial_id=trial_id,
            hypothesis_id=hypothesis_id,
            metrics=metrics,
        )
        log = journal_log()
        event_id = log.append(event)

        self._trials[trial_id]["status"] = "completed"

        return {"ok": True, "data": {"event_id": event_id}}

    async def _fail(self, args: dict[str, Any]) -> dict[str, Any]:
        from nxl_core.events.schema import TrialFailed
        from nxl_core.events.singletons import journal_log

        trial_id = str(args["trial_id"])
        reason = str(args["reason"])

        if trial_id not in self._trials:
            return {"ok": False, "error": f"Unknown trial_id: {trial_id}"}

        hypothesis_id = self._trials[trial_id]["hypothesis_id"]

        event = TrialFailed(
            trial_id=trial_id,
            hypothesis_id=hypothesis_id,
            reason=reason,
        )
        log = journal_log()
        event_id = log.append(event)

        self._trials[trial_id]["status"] = "failed"

        return {"ok": True, "data": {"event_id": event_id}}

    async def _list(self, args: dict[str, Any]) -> dict[str, Any]:
        hypothesis_id = args.get("hypothesis_id")

        trials = []
        for trial_id, info in self._trials.items():
            if hypothesis_id is None or info["hypothesis_id"] == hypothesis_id:
                trials.append({
                    "trial_id": trial_id,
                    "hypothesis_id": info["hypothesis_id"],
                    "trial_kind": info["trial_kind"],
                    "status": info["status"],
                })

        return {"ok": True, "data": {"trials": trials}}