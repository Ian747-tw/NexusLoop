"""mcps.policy.tests.test_policy_mcp — unit tests for policy MCP server."""
from __future__ import annotations

import asyncio

from mcps.policy.server import PolicyMCPServer


class TestPolicyMCPServer:
    """Tests for policy MCP server."""

    def test_check_allowed_action_returns_allow(self) -> None:
        """policy.check should return allow for actions that pass policy."""
        server = PolicyMCPServer()
        result = asyncio.run(server.handle_tool(
            "policy.check",
            {
                "tool_name": "spec.get_project",
                "args": {},
            },
        ))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert data["decision"] in ("allow", "ask")
        assert data["allowed"] is True
        assert "reason" in data

    def test_check_unknown_action_defaults_to_allow(self) -> None:
        """policy.check should allow actions with no matching rules by default."""
        server = PolicyMCPServer()
        result = asyncio.run(server.handle_tool(
            "policy.check",
            {
                "tool_name": "completely.unknown.action",
                "args": {},
            },
        ))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert data["allowed"] is True
        assert data["decision"] == "allow"

    def test_get_mode_returns_typed_rules(self) -> None:
        """policy.get_mode should return the current policy mode."""
        server = PolicyMCPServer()
        result = asyncio.run(server.handle_tool(
            "policy.get_mode",
            {},
        ))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert "mode" in data
        # The typed_rules engine uses mode="typed_rules"
        assert data["mode"] == "typed_rules"

    def test_get_allow_list_returns_mode_info(self) -> None:
        """policy.get_allow_list should return information about allowed actions."""
        server = PolicyMCPServer()
        result = asyncio.run(server.handle_tool(
            "policy.get_allow_list",
            {},
        ))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert "mode" in data
        assert data["mode"] == "typed_rules"

    def test_get_tools_returns_three_tools(self) -> None:
        """policy.get_tools should return definitions for all three policy tools."""
        server = PolicyMCPServer()
        tools = server.get_tools()
        assert len(tools) == 3
        names = {t["name"] for t in tools}
        assert names == {"policy.check", "policy.get_mode", "policy.get_allow_list"}

    def test_handle_tool_unknown_returns_error(self) -> None:
        """handle_tool should return error for unknown tool names."""
        server = PolicyMCPServer()
        result = asyncio.run(server.handle_tool("policy.unknown", {}))
        assert result["ok"] is False
        assert "Unknown tool" in result["error"]  # type: ignore[index]

    def test_check_includes_violated_rules_when_denied(self) -> None:
        """policy.check should include violated_rules when action is denied."""
        server = PolicyMCPServer()
        # Test with an action that might match a rule (e.g., delete outside allowed dirs)
        result = asyncio.run(server.handle_tool(
            "policy.check",
            {
                "tool_name": "delete_file",
                "args": {"path": "/etc/passwd"},
            },
        ))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        # delete_file outside allowed dirs should be denied
        assert "violated_rules" in data
