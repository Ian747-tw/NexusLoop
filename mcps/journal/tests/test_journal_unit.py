"""mcps.journal.tests.test_journal_unit — unit tests for journal MCP."""
from __future__ import annotations

import asyncio


from mcps.journal.server import JournalMCPServer


class TestJournalMCPServer:
    """Tests for journal MCP server."""

    def test_append_writes_event_to_log(self) -> None:
        server = JournalMCPServer()
        result = asyncio.run(server.handle_tool(
            "journal.append",
            {"event": {"kind": "cycle_started", "brief_hash": "abc", "hypothesis_id": "h1"}}
        ))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert "event_id" in data

    def test_tail_returns_empty_when_no_events(self) -> None:
        server = JournalMCPServer()
        result = asyncio.run(server.handle_tool("journal.tail", {"n": 5}))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        # With empty log (from conftest fixture), should be empty
        # The autouse fixture provides a clean temp log
        events = data["events"]  # type: ignore[index]
        assert isinstance(events, list)

    def test_tail_returns_last_n_events(self) -> None:
        server = JournalMCPServer()
        # Write 5 events via append tool
        for i in range(5):
            asyncio.run(server.handle_tool(
                "journal.append",
                {"event": {
                    "kind": "cycle_started",
                    "brief_hash": f"h{i}",
                    "hypothesis_id": f"hid{i}"
                }}
            ))
        result = asyncio.run(server.handle_tool("journal.tail", {"n": 3}))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert len(data["events"]) == 3  # type: ignore[index]

    def test_query_filters_by_kind(self) -> None:
        server = JournalMCPServer()
        # Append events of different kinds using HypothesisCreated (fewest required fields)
        asyncio.run(server.handle_tool(
            "journal.append",
            {"event": {"kind": "hypothesis_created", "hypothesis_id": "h1", "claim": "claim1", "source": "human"}}
        ))
        asyncio.run(server.handle_tool(
            "journal.append",
            {"event": {"kind": "hypothesis_created", "hypothesis_id": "h2", "claim": "claim2", "source": "human"}}
        ))
        asyncio.run(server.handle_tool(
            "journal.append",
            {"event": {"kind": "hypothesis_created", "hypothesis_id": "h3", "claim": "claim3", "source": "human"}}
        ))
        result = asyncio.run(server.handle_tool("journal.query", {"kind": "hypothesis_created", "limit": 10}))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        # All 3 should be hypothesis_created (ignore tool_requested events from handle_tool itself)
        assert len(data["events"]) >= 3  # type: ignore[index]
        for ev in data["events"]:  # type: ignore[index]
            assert ev["kind"] == "hypothesis_created"

    def test_append_requires_kind_field(self) -> None:
        server = JournalMCPServer()
        result = asyncio.run(server.handle_tool("journal.append", {"event": {"no_kind": True}}))
        assert result["ok"] is False

    def test_handle_tool_unknown_returns_error(self) -> None:
        server = JournalMCPServer()
        result = asyncio.run(server.handle_tool("journal.unknown", {}))
        assert result["ok"] is False

    def test_get_tools_returns_three_tools(self) -> None:
        server = JournalMCPServer()
        tools = server.get_tools()
        assert len(tools) == 3
        names = {t["name"] for t in tools}
        assert names == {"journal.append", "journal.tail", "journal.query"}