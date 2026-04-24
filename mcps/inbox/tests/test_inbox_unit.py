"""mcps.inbox.tests.test_unit — unit tests for inbox MCP."""
from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path


from mcps.inbox.server import InboxMCPServer, list_directives, get_directive


class TestInboxMCPServer:
    """Tests for inbox MCP server."""

    def test_list_returns_empty_when_no_inbox_dir(self, tmp_path: Path) -> None:
        server = InboxMCPServer(tmp_path / ".nxl" / "inbox")
        result = server._list()
        assert result["directives"] == []

    def test_list_returns_files_in_inbox_dir(self, tmp_path: Path) -> None:
        inbox_dir = tmp_path / ".nxl" / "inbox"
        inbox_dir.mkdir(parents=True)
        (inbox_dir / "directive1.txt").write_text("do something")
        (inbox_dir / "directive2.md").write_text("# directive")
        server = InboxMCPServer(inbox_dir)
        result = server._list()
        ids = [d["directive_id"] for d in result["directives"]]
        assert "directive1" in ids
        assert "directive2" in ids

    def test_get_returns_content(self, tmp_path: Path) -> None:
        inbox_dir = tmp_path / ".nxl" / "inbox"
        inbox_dir.mkdir(parents=True)
        (inbox_dir / "test.txt").write_text("hello world")
        server = InboxMCPServer(inbox_dir)
        result = server._get("test")
        assert result["content"] == "hello world"
        assert result["directive_id"] == "test"

    def test_get_returns_error_when_not_found(self, tmp_path: Path) -> None:
        inbox_dir = tmp_path / ".nxl" / "inbox"
        inbox_dir.mkdir(parents=True)
        server = InboxMCPServer(inbox_dir)
        result = server._get("nonexistent")
        assert result["content"] == ""
        assert "error" in result

    def test_handle_tool_list_dispatches_correctly(self) -> None:
        server = InboxMCPServer()
        result = asyncio.run(server.handle_tool("inbox.list", {}))
        assert result["ok"] is True
        assert "directives" in result["data"]

    def test_handle_tool_get_dispatches_correctly(self) -> None:
        server = InboxMCPServer()
        result = asyncio.run(server.handle_tool("inbox.get", {"directive_id": "anything"}))
        assert result["ok"] is True
        assert "directive_id" in result["data"]

    def test_get_tools_returns_two_tools(self) -> None:
        server = InboxMCPServer()
        tools = server.get_tools()
        assert len(tools) == 2
        names = {t["name"] for t in tools}
        assert names == {"inbox.list", "inbox.get"}


class TestConvenienceWrappers:
    """Tests for top-level convenience functions."""

    def test_list_directives_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = list_directives(Path(tmp))
            assert result == []

    def test_get_directive_not_found(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = get_directive("missing", Path(tmp))
            assert result.get("error") == "not found"