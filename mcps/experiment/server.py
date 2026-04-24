"""mcps.experiment.server — Trial submit/cancel/read MCP server."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from mcps._shared.base import BaseMCPServer
from mcps.experiment.requests import (
    ExperimentCancelRequest,
    ExperimentStatusRequest,
    ExperimentSubmitRequest,
)
from mcps.experiment.responses import (
    ExperimentCancelResponse,
    ExperimentListResponse,
    ExperimentStatusResponse,
    ExperimentSubmitResponse,
)
from nxl_core.events.schema import ToolRequested

# In-memory trial store
_trials: dict[str, dict[str, Any]] = {}


def _generate_trial_id() -> str:
    return "trial_" + uuid.uuid4().hex[:12]


class ExperimentServer(BaseMCPServer):
    """MCP server for Trial management operations."""

    name = "experiment"

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "name": "experiment.submit",
                "description": "Submit a new trial",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "config": {
                            "type": "object",
                            "description": "Trial configuration dict",
                        },
                    },
                    "required": ["config"],
                },
            },
            {
                "name": "experiment.status",
                "description": "Get status of a trial",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "trial_id": {"type": "string"},
                    },
                    "required": ["trial_id"],
                },
            },
            {
                "name": "experiment.cancel",
                "description": "Cancel a running trial",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "trial_id": {"type": "string"},
                    },
                    "required": ["trial_id"],
                },
            },
            {
                "name": "experiment.list",
                "description": "List all trials",
                "inputSchema": {"type": "object", "properties": {}},
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
        if tool_name == "experiment.submit":
            return await self._submit(args)
        elif tool_name == "experiment.status":
            return await self._status(args)
        elif tool_name == "experiment.cancel":
            return await self._cancel(args)
        elif tool_name == "experiment.list":
            return await self._list(args)
        else:
            return {"ok": False, "error": f"Unknown tool: {tool_name}"}

    async def _submit(self, args: dict[str, Any]) -> dict[str, Any]:
        if not self.check_policy("experiment.submit", args):
            return {"ok": False, "error": "Policy denied"}
        self._emit("experiment.submit", args)

        req = ExperimentSubmitRequest(**args)
        trial_id = _generate_trial_id()
        now = datetime.now(timezone.utc)

        trial = {
            "trial_id": trial_id,
            "config": req.config,
            "status": "pending",
            "metrics": {},
            "created_at": now,
        }
        _trials[trial_id] = trial

        return {
            "ok": True,
            "data": ExperimentSubmitResponse(
                trial_id=trial_id, status="pending"
            ).model_dump(),
        }

    async def _status(self, args: dict[str, Any]) -> dict[str, Any]:
        if not self.check_policy("experiment.status", args):
            return {"ok": False, "error": "Policy denied"}
        self._emit("experiment.status", args)

        req = ExperimentStatusRequest(**args)
        trial = _trials.get(req.trial_id)
        if trial is None:
            return {"ok": False, "error": f"Trial {req.trial_id} not found"}

        return {
            "ok": True,
            "data": ExperimentStatusResponse(
                trial_id=trial["trial_id"],
                status=trial["status"],
                metrics=trial.get("metrics", {}),
                created_at=trial["created_at"],
            ).model_dump(),
        }

    async def _cancel(self, args: dict[str, Any]) -> dict[str, Any]:
        if not self.check_policy("experiment.cancel", args):
            return {"ok": False, "error": "Policy denied"}
        self._emit("experiment.cancel", args)

        req = ExperimentCancelRequest(**args)
        trial = _trials.get(req.trial_id)
        if trial is None:
            return {"ok": False, "error": f"Trial {req.trial_id} not found"}

        trial["status"] = "cancelled"
        return {
            "ok": True,
            "data": ExperimentCancelResponse(
                cancelled=True, trial_id=req.trial_id
            ).model_dump(),
        }

    async def _list(self, args: dict[str, Any]) -> dict[str, Any]:
        if not self.check_policy("experiment.list", args):
            return {"ok": False, "error": "Policy denied"}
        self._emit("experiment.list", args)

        trials = [
            ExperimentStatusResponse(
                trial_id=t["trial_id"],
                status=t["status"],
                metrics=t.get("metrics", {}),
                created_at=t["created_at"],
            )
            for t in _trials.values()
        ]
        return {
            "ok": True,
            "data": ExperimentListResponse(trials=trials).model_dump(),
        }
