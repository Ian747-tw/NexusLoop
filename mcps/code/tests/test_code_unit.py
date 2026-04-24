"""mcps/code/tests/test_code_unit.py"""
from __future__ import annotations

import pytest
from pathlib import Path

from mcps.code.server import CodeMCP


@pytest.fixture
def code_mcp(tmp_path: Path) -> CodeMCP:
    return CodeMCP(project_root=tmp_path)


class TestCodeReadFile:
    @pytest.mark.asyncio
    async def test_read_file_returns_content_and_lines(self, tmp_path: Path, code_mcp: CodeMCP) -> None:
        (tmp_path / "hello.txt").write_text("line1\nline2\nline3\n")
        result = await code_mcp.handle_tool("code.read_file", {"path": "hello.txt"})
        assert result["ok"] is True
        assert result["data"]["content"] == "line1\nline2\nline3\n"
        assert result["data"]["lines"] == 3

    @pytest.mark.asyncio
    async def test_read_file_nonexistent_returns_error(self, tmp_path: Path, code_mcp: CodeMCP) -> None:
        result = await code_mcp.handle_tool("code.read_file", {"path": "nonexistent.txt"})
        assert result["ok"] is False
        assert "No such file" in result["error"]

    @pytest.mark.asyncio
    async def test_read_file_outside_root_rejected(self, tmp_path: Path, code_mcp: CodeMCP) -> None:
        result = await code_mcp.handle_tool("code.read_file", {"path": "../etc/passwd"})
        assert result["ok"] is False


class TestCodeListFiles:
    @pytest.mark.asyncio
    async def test_list_files_returns_matching_paths(self, tmp_path: Path, code_mcp: CodeMCP) -> None:
        (tmp_path / "a.txt").write_text("a")
        (tmp_path / "b.txt").write_text("b")
        (tmp_path / "sub").mkdir()
        (tmp_path / "sub" / "c.txt").write_text("c")
        result = await code_mcp.handle_tool("code.list_files", {"glob_pattern": "*.txt"})
        assert result["ok"] is True
        assert "a.txt" in result["data"]["paths"]
        assert "b.txt" in result["data"]["paths"]

    @pytest.mark.asyncio
    async def test_list_files_no_matches(self, tmp_path: Path, code_mcp: CodeMCP) -> None:
        result = await code_mcp.handle_tool("code.list_files", {"glob_pattern": "*.xyz"})
        assert result["ok"] is True
        assert result["data"]["paths"] == []


class TestCodeEditFile:
    @pytest.mark.asyncio
    async def test_edit_file_success(self, tmp_path: Path, code_mcp: CodeMCP) -> None:
        (tmp_path / "sample.txt").write_text("hello world")
        result = await code_mcp.handle_tool("code.edit_file", {
            "path": "sample.txt",
            "old_text": "world",
            "new_text": "NexusLoop",
        })
        assert result["ok"] is True
        assert result["data"]["success"] is True
        assert (tmp_path / "sample.txt").read_text() == "hello NexusLoop"

    @pytest.mark.asyncio
    async def test_edit_file_old_text_not_found(self, tmp_path: Path, code_mcp: CodeMCP) -> None:
        (tmp_path / "sample.txt").write_text("hello world")
        result = await code_mcp.handle_tool("code.edit_file", {
            "path": "sample.txt",
            "old_text": "nonexistent",
            "new_text": "replacement",
        })
        assert result["ok"] is False
        assert "not found" in result["error"]


class TestCodeSearch:
    @pytest.mark.asyncio
    async def test_search_finds_matching_lines(self, tmp_path: Path, code_mcp: CodeMCP) -> None:
        (tmp_path / "notes.txt").write_text("apple\nbanana\napricot\n")
        result = await code_mcp.handle_tool("code.search", {"query": "apri"})
        assert result["ok"] is True
        assert any("apricot" in m for m in result["data"]["matches"])

    @pytest.mark.asyncio
    async def test_search_case_insensitive(self, tmp_path: Path, code_mcp: CodeMCP) -> None:
        (tmp_path / "notes.txt").write_text("Hello World\n")
        result = await code_mcp.handle_tool("code.search", {"query": "hello"})
        assert result["ok"] is True
        assert any("Hello" in m for m in result["data"]["matches"])