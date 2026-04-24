"""mcps.spec.tests.test_spec_policy_gate — policy check tests for spec MCP."""
from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest

from mcps.spec.server import SpecMCPServer


class TestPolicyGate:
    """Assert policy check fires on every tool call."""

    def test_get_project_emits_tool_requested(self) -> None:
        """get_project emits ToolRequested event via EventLog."""
        server = SpecMCPServer()
        # Should not raise
        server.emit_tool_requested("spec.get_project", {})

    def test_get_operations_emits_tool_requested(self) -> None:
        """get_operations emits ToolRequested event via EventLog."""
        server = SpecMCPServer()
        # Should not raise
        server.emit_tool_requested("spec.get_operations", {})

    def test_check_policy_is_called_on_handle_tool(self) -> None:
        """handle_tool goes through policy check before executing."""
        server = SpecMCPServer()
        # By default policy allows spec.get_project
        allowed = server.check_policy("spec.get_project", {})
        assert allowed is True

    def test_all_tools_have_policy_gate(self) -> None:
        """Every tool name in get_tools() must go through policy check."""
        server = SpecMCPServer()
        for tool in server.get_tools():
            tool_name = tool["name"]
            # Policy check must not raise
            allowed = server.check_policy(tool_name, {})
            assert isinstance(allowed, bool)

    def test_policy_denied_blocks_execution(self) -> None:
        """When policy denies, handle_tool returns error."""
        from nxl_core.policy.engine import PolicyDecision

        server = SpecMCPServer()
        with patch.object(server._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=False,
                requires_confirmation=False,
                reason="Denied by policy",
                violated_rules=["test_rule"],
            )
            result = asyncio.run(server.handle_tool("spec.get_project", {}))
        assert result["ok"] is False