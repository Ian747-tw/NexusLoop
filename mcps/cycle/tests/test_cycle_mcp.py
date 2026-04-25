"""mcps.cycle.tests.test_cycle_mcp — unit tests for cycle MCP server."""
from __future__ import annotations

import asyncio

from mcps.cycle.server import CycleMCPServer


class TestCycleMCPServer:
    """Tests for cycle MCP server."""

    def test_cycle_start_emits_cycle_started_event(self) -> None:
        server = CycleMCPServer()
        result = asyncio.run(server.handle_tool(
            "cycle.start",
            {"hypothesis_id": "h1", "brief_hash": "abc123"}
        ))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert "event_id" in data

    def test_cycle_end_completed_emits_cycle_completed_event(self) -> None:
        server = CycleMCPServer()
        result = asyncio.run(server.handle_tool(
            "cycle.end",
            {"status": "completed", "hypothesis_id": "h1", "brief_hash": "abc123", "summary_tokens": 150}
        ))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert "event_id" in data

    def test_cycle_end_failed_emits_cycle_failed_event(self) -> None:
        server = CycleMCPServer()
        result = asyncio.run(server.handle_tool(
            "cycle.end",
            {"status": "failed", "hypothesis_id": "h1", "brief_hash": "abc123", "reason": "validation error"}
        ))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert "event_id" in data

    def test_cycle_end_invalid_status_returns_error(self) -> None:
        server = CycleMCPServer()
        result = asyncio.run(server.handle_tool(
            "cycle.end",
            {"status": "unknown", "hypothesis_id": "h1", "brief_hash": "abc123"}
        ))
        assert result["ok"] is False

    def test_cycle_end_completed_missing_summary_tokens_uses_default(self) -> None:
        server = CycleMCPServer()
        result = asyncio.run(server.handle_tool(
            "cycle.end",
            {"status": "completed", "hypothesis_id": "h1", "brief_hash": "abc123"}
        ))
        assert result["ok"] is True

    def test_get_tools_returns_two_tools(self) -> None:
        server = CycleMCPServer()
        tools = server.get_tools()
        assert len(tools) == 2
        names = {t["name"] for t in tools}
        assert names == {"cycle.start", "cycle.end"}

    def test_handle_tool_unknown_returns_error(self) -> None:
        server = CycleMCPServer()
        result = asyncio.run(server.handle_tool("cycle.unknown", {}))
        assert result["ok"] is False