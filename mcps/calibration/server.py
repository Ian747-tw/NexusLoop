"""mcps.calibration.server — CalibrationMCPServer implementation."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from mcps._shared.base import BaseMCPServer


# ---------------------------------------------------------------------------
# Tier compaction logic
# ---------------------------------------------------------------------------

_TIER_THRESHOLDS = {
    "soft": 0.60,   # confidence >= 0.6 triggers soft compaction tier
    "hard": 0.30,   # confidence < 0.3 triggers hard compaction tier
    "clear": 0.0,   # reset / clear tier
}

_DEFAULT_TIER = "soft"


def _compute_tier(confidence: float, actual_outcome: str) -> str:
    """Compute the compaction tier from a calibration data point."""
    if actual_outcome.lower() == "success":
        # Good outcome: keep in soft tier (default)
        return "soft"
    error_rate = 1.0 - confidence
    if error_rate >= 0.70:
        return "hard"
    elif error_rate >= 0.40:
        return "soft"
    else:
        return "soft"


# ---------------------------------------------------------------------------
# CalibrationMCPServer
# ---------------------------------------------------------------------------


class CalibrationMCPServer(BaseMCPServer):
    """Track LLM calibration (confidence vs actual outcome) and emit tier events."""

    def __init__(self) -> None:
        super().__init__("calibration")
        # In-memory store: hypothesis_id -> list of {confidence, actual_outcome, timestamp}
        self._store: dict[str, list[dict[str, Any]]] = {}
        # Current tier per hypothesis
        self._tiers: dict[str, str] = {}

    # -------------------------------------------------------------------------
    # BaseMCPServer interface
    # -------------------------------------------------------------------------

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "name": "calibration.record",
                "description": "Record a calibration data point for a hypothesis.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "hypothesis_id": {
                            "type": "string",
                            "description": "Unique hypothesis identifier",
                        },
                        "confidence": {
                            "type": "number",
                            "minimum": 0.0,
                            "maximum": 1.0,
                            "description": "LLM confidence score (0.0–1.0)",
                        },
                        "actual_outcome": {
                            "type": "string",
                            "description": "Actual outcome ('success' or 'failure')",
                        },
                    },
                    "required": ["hypothesis_id", "confidence", "actual_outcome"],
                    "additionalProperties": False,
                },
            },
            {
                "name": "calibration.get",
                "description": "Get calibration history for a hypothesis.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "hypothesis_id": {
                            "type": "string",
                            "description": "Unique hypothesis identifier",
                        },
                    },
                    "required": ["hypothesis_id"],
                    "additionalProperties": False,
                },
            },
            {
                "name": "calibration.check_tier",
                "description": "Check and update compaction tier based on calibration history.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "hypothesis_id": {
                            "type": "string",
                            "description": "Unique hypothesis identifier",
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
        if tool_name == "calibration.record":
            return await self._record(args)
        elif tool_name == "calibration.get":
            return await self._get(args)
        elif tool_name == "calibration.check_tier":
            return await self._check_tier(args)
        else:
            return {"ok": False, "error": f"Unknown tool: {tool_name}"}

    # -------------------------------------------------------------------------
    # Tool handlers
    # -------------------------------------------------------------------------

    async def _record(self, args: dict[str, Any]) -> dict[str, Any]:
        hypothesis_id: str = args["hypothesis_id"]
        confidence: float = args["confidence"]
        actual_outcome: str = args["actual_outcome"]

        entry = {
            "confidence": confidence,
            "actual_outcome": actual_outcome,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        if hypothesis_id not in self._store:
            self._store[hypothesis_id] = []
        self._store[hypothesis_id].append(entry)
        return {"ok": True, "data": entry}

    async def _get(self, args: dict[str, Any]) -> dict[str, Any]:
        hypothesis_id: str = args["hypothesis_id"]
        history = self._store.get(hypothesis_id, [])
        return {"ok": True, "data": {"hypothesis_id": hypothesis_id, "history": history}}

    async def _check_tier(self, args: dict[str, Any]) -> dict[str, Any]:
        hypothesis_id: str = args["hypothesis_id"]
        history = self._store.get(hypothesis_id, [])
        if not history:
            return {"ok": True, "data": {"hypothesis_id": hypothesis_id, "tier": _DEFAULT_TIER, "changed": False}}

        # Use the most recent entry to determine tier
        latest = history[-1]
        new_tier = _compute_tier(latest["confidence"], latest["actual_outcome"])

        old_tier = self._tiers.get(hypothesis_id, _DEFAULT_TIER)
        changed = old_tier != new_tier

        if changed:
            self._tiers[hypothesis_id] = new_tier
            # Emit CompactionTierEntered event
            await self._emit_tier_event(hypothesis_id, new_tier, history)

        return {
            "ok": True,
            "data": {
                "hypothesis_id": hypothesis_id,
                "tier": new_tier,
                "changed": changed,
            },
        }

    async def _emit_tier_event(
        self, hypothesis_id: str, tier: str, history: list[dict[str, Any]]
    ) -> None:
        """Emit a CompactionTierEntered event via journal_log."""
        from nxl_core.events.schema import CompactionTierEntered
        from nxl_core.events.singletons import journal_log

        event = CompactionTierEntered(
            tier=tier,  # type: ignore[arg-type]
            reason=f"Calibration check for hypothesis {hypothesis_id}",
            events_active=len(history),
        )
        journal_log().append(event)
