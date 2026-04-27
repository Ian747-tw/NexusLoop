"""mcps.policy.server — PolicyMCPServer implementation."""
from __future__ import annotations

from typing import Any

from mcps._shared.base import BaseMCPServer
from nxl_core.events.schema import PolicyDecision as PolicyDecisionEvent
from nxl_core.events.singletons import journal_log
from nxl_core.policy.engine import PolicyDecision, PolicyEngine


# Valid policy modes as per task specification
VALID_POLICY_MODES = frozenset({
    "locked",
    "prompted",
    "bootstrap-only",
    "open",
    "project-only",
})


class PolicyMCPServer(BaseMCPServer):
    """MCP server for querying policy decisions."""

    def __init__(self, project_dir: str | None = None) -> None:
        super().__init__("policy")
        self._engine = PolicyEngine()

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "name": "policy.check",
                "description": "Check if a tool call is allowed by the policy engine.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "tool_name": {
                            "type": "string",
                            "description": "Name of the tool to check",
                        },
                        "args": {
                            "type": "object",
                            "description": "Arguments passed to the tool",
                            "additionalProperties": True,
                        },
                    },
                    "required": ["tool_name", "args"],
                    "additionalProperties": False,
                },
            },
            {
                "name": "policy.get_mode",
                "description": "Get the current policy mode.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": False,
                },
            },
            {
                "name": "policy.get_allow_list",
                "description": "Get list of allowed actions in the current policy mode.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": False,
                },
            },
        ]

    async def handle_tool(self, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        decision = self._engine.check(tool_name, args)
        if not decision.allowed:
            return {"ok": False, "error": f"Policy denied: {decision.reason}"}
        if tool_name == "policy.check":
            return await self._check(args)
        elif tool_name == "policy.get_mode":
            return await self._get_mode()
        elif tool_name == "policy.get_allow_list":
            return await self._get_allow_list()
        else:
            return {"ok": False, "error": f"Unknown tool: {tool_name}"}

    async def _check(self, args: dict[str, Any]) -> dict[str, Any]:
        """Handle policy.check tool call."""
        tool_name: str = args["tool_name"]
        tool_args: dict[str, Any] = args.get("args", {})

        decision = self._engine.check(tool_name, tool_args)

        # Emit PolicyDecision event
        self._emit_policy_decision_event(tool_name, decision)

        # Map PolicyEngine decision to MCP response
        # Note: deny_non_negotiable uses discriminated union to carry rule_id
        if decision.non_negotiable_violated:
            # NON_NEGOTIABLE rule violated — tripwire fires
            result_data: dict[str, object] = {
                "tool_name": tool_name,
                "allowed": False,
                "decision": {"kind": "deny_non_negotiable", "rule_id": decision.non_negotiable_rule_id or "", "reason": decision.reason},
                "reason": decision.reason,
                "mode": decision.mode,
                "violated_rules": decision.violated_rules,
                "rule_id": decision.non_negotiable_rule_id or "",
            }
            return {"ok": True, "data": result_data}

        if decision.allowed:
            if decision.requires_confirmation:
                mcp_decision = "ask"
            else:
                mcp_decision = "allow"
        else:
            mcp_decision = "deny"

        return {
            "ok": True,
            "data": {
                "tool_name": tool_name,
                "allowed": decision.allowed,
                "decision": mcp_decision,
                "reason": decision.reason,
                "mode": decision.mode,
                "violated_rules": decision.violated_rules,
            },
        }

    async def _get_mode(self) -> dict[str, Any]:
        """Handle policy.get_mode tool call."""
        mode = self._engine.check("__mode_check__", {}).mode
        return {
            "ok": True,
            "data": {
                "mode": mode,
            },
        }

    async def _get_allow_list(self) -> dict[str, Any]:
        """Handle policy.get_allow_list tool call."""
        # The typed_rules engine doesn't maintain a static allowlist;
        # it evaluates rules dynamically. Return the mode identifier
        # since that characterizes what actions are allowed.
        mode = self._engine.check("__allow_list_check__", {}).mode
        return {
            "ok": True,
            "data": {
                "mode": mode,
                "description": "Policy evaluation is rule-based; use policy.check for specific actions.",
            },
        }

    def _emit_policy_decision_event(self, action: str, decision: "PolicyDecision") -> None:
        """Emit a PolicyDecision event via journal_log."""
        if decision.allowed:
            if decision.requires_confirmation:
                decision_str: str = "ask"
            else:
                decision_str = "allow"
        elif decision.non_negotiable_violated:
            decision_str = "deny_non_negotiable"
        else:
            decision_str = "deny"

        violated_rule_id = decision.non_negotiable_rule_id or ""

        event = PolicyDecisionEvent(
            action=action,
            decision=decision_str,  # type: ignore[arg-type]
            reason=decision.reason,
            rule_id=violated_rule_id or None,
        )
        journal_log().append(event)
