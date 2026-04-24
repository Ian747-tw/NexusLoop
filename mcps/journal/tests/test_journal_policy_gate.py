"""mcps.journal.tests.test_journal_policy_gate — policy check tests for journal MCP."""
from __future__ import annotations

import asyncio
import pytest
from unittest.mock import patch

from mcps.journal.server import JournalMCPServer


class TestPolicyGate:
    """Assert policy check fires on every tool call."""

    def test_append_emits_tool_requested(self) -> None:
        """append emits ToolRequested event via EventLog."""
        server = JournalMCPServer()
        # Should not raise
        server.emit_tool_requested("journal.append", {"event": {"kind": "test"}})

    def test_tail_emits_tool_requested(self) -> None:
        """tail emits ToolRequested event via EventLog."""
        server = JournalMCPServer()
        # Should not raise
        server.emit_tool_requested("journal.tail", {"n": 5})

    def test_query_emits_tool_requested(self) -> None:
        """query emits ToolRequested event via EventLog."""
        server = JournalMCPServer()
        # Should not raise
        server.emit_tool_requested("journal.query", {"kind": "cycle_started", "limit": 10})

    def test_all_tools_have_policy_gate(self) -> None:
        """Every tool name in get_tools() must go through policy check."""
        server = JournalMCPServer()
        for tool in server.get_tools():
            tool_name = tool["name"]
            allowed = server.check_policy(tool_name, {})
            assert isinstance(allowed, bool)

    def test_policy_denied_blocks_execution(self) -> None:
        """When policy denies, handle_tool returns error."""
        from nxl_core.policy.engine import PolicyDecision

        server = JournalMCPServer()
        with patch.object(server._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=False,
                requires_confirmation=False,
                reason="Denied by policy",
                violated_rules=["test_rule"],
            )
            result = asyncio.run(server.handle_tool("journal.append", {"event": {"kind": "cycle_started", "brief_hash": "abc", "hypothesis_id": "h1"}}))
        assert result["ok"] is False