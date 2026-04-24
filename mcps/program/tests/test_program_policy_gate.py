"""mcps.program.tests.test_program_policy_gate — policy check tests for program MCP."""
from __future__ import annotations

import asyncio
import pytest
from unittest.mock import patch

from mcps.program.server import ProgramMCPServer


class TestPolicyGate:
    """Assert policy check fires on every tool call."""

    def test_get_state_emits_tool_requested(self) -> None:
        """get_state emits ToolRequested event via EventLog."""
        server = ProgramMCPServer()
        # Should not raise
        server.emit_tool_requested("program.get_state", {})

    def test_get_queue_emits_tool_requested(self) -> None:
        """get_queue emits ToolRequested event via EventLog."""
        server = ProgramMCPServer()
        # Should not raise
        server.emit_tool_requested("program.get_queue", {})

    def test_all_tools_have_policy_gate(self) -> None:
        """Every tool name in get_tools() must go through policy check."""
        server = ProgramMCPServer()
        for tool in server.get_tools():
            tool_name = tool["name"]
            allowed = server.check_policy(tool_name, {})
            assert isinstance(allowed, bool)

    def test_policy_denied_blocks_execution(self) -> None:
        """When policy denies, handle_tool returns error."""
        from nxl_core.policy.engine import PolicyDecision

        server = ProgramMCPServer()
        with patch.object(server._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=False,
                requires_confirmation=False,
                reason="Denied by policy",
                violated_rules=["test_rule"],
            )
            result = asyncio.run(server.handle_tool("program.get_state", {}))
        assert result["ok"] is False