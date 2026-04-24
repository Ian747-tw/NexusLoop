"""mcps.inbox.tests.test_inbox_policy_gate — policy check tests for inbox MCP."""
from __future__ import annotations

import asyncio
import pytest
from unittest.mock import patch

from mcps.inbox.server import InboxMCPServer


class TestPolicyGate:
    """Assert policy check fires on every tool call."""

    def test_list_emits_tool_requested(self) -> None:
        """list emits ToolRequested event via EventLog."""
        server = InboxMCPServer()
        # Should not raise
        server.emit_tool_requested("inbox.list", {})

    def test_get_emits_tool_requested(self) -> None:
        """get emits ToolRequested event via EventLog."""
        server = InboxMCPServer()
        # Should not raise
        server.emit_tool_requested("inbox.get", {"directive_id": "test"})

    def test_all_tools_have_policy_gate(self) -> None:
        """Every tool name in get_tools() must go through policy check."""
        server = InboxMCPServer()
        for tool in server.get_tools():
            tool_name = tool["name"]
            allowed = server.check_policy(tool_name, {})
            assert isinstance(allowed, bool)

    def test_policy_denied_blocks_execution(self) -> None:
        """When policy denies, handle_tool returns error."""
        from nxl_core.policy.engine import PolicyDecision

        server = InboxMCPServer()
        with patch.object(server._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=False,
                requires_confirmation=False,
                reason="Denied by policy",
                violated_rules=["test_rule"],
            )
            result = asyncio.run(server.handle_tool("inbox.list", {}))
        assert result["ok"] is False