"""mcps/fs/tests/test_unit.py — Unit tests for fs MCP."""
from __future__ import annotations

import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

from mcps.fs.server import FsMCP


@pytest.fixture
def fs_mcp(tmp_path: Path) -> FsMCP:
    return FsMCP(project_root=tmp_path)


class TestFsTools:
    """Test tool definitions."""

    def test_get_tools_returns_six_tools(self, fs_mcp: FsMCP) -> None:
        tools = fs_mcp.get_tools()
        assert len(tools) == 6
        tool_names = {t["name"] for t in tools}
        assert "fs.move" in tool_names
        assert "fs.archive" in tool_names
        assert "fs.restore" in tool_names
        assert "fs.workspace_new" in tool_names
        assert "fs.stage" in tool_names
        assert "fs.unstage" in tool_names


class TestFsMove:
    """Test fs.move tool."""

    @pytest.mark.asyncio
    async def test_move_renames_file(self, fs_mcp: FsMCP, tmp_path: Path) -> None:
        (tmp_path / "old.txt").write_text("content")
        result = await fs_mcp.handle_tool(
            "fs.move", {"src": "old.txt", "dst": "new.txt"}
        )
        assert result["ok"] is True
        assert (tmp_path / "new.txt").exists()
        assert not (tmp_path / "old.txt").exists()

    @pytest.mark.asyncio
    async def test_move_nonexistent_returns_error(
        self, fs_mcp: FsMCP, tmp_path: Path
    ) -> None:
        result = await fs_mcp.handle_tool(
            "fs.move", {"src": "nonexistent.txt", "dst": "new.txt"}
        )
        assert result["ok"] is False
        assert "does not exist" in result["error"]

    @pytest.mark.asyncio
    async def test_move_outside_root_rejected(self, fs_mcp: FsMCP) -> None:
        result = await fs_mcp.handle_tool(
            "fs.move", {"src": "../etc/passwd", "dst": "evil.txt"}
        )
        assert result["ok"] is False


class TestFsArchive:
    """Test fs.archive tool."""

    @pytest.mark.asyncio
    async def test_archive_moves_to_nxl_archive(
        self, fs_mcp: FsMCP, tmp_path: Path
    ) -> None:
        (tmp_path / "file.txt").write_text("content")
        result = await fs_mcp.handle_tool(
            "fs.archive", {"path": "file.txt", "tag": "v1"}
        )
        assert result["ok"] is True
        assert result["tag"] == "v1"
        assert not (tmp_path / "file.txt").exists()
        assert (tmp_path / ".nxl" / "archive" / "v1" / "file.txt").exists()

    @pytest.mark.asyncio
    async def test_archive_nonexistent_returns_error(
        self, fs_mcp: FsMCP, tmp_path: Path
    ) -> None:
        result = await fs_mcp.handle_tool(
            "fs.archive", {"path": "nonexistent.txt", "tag": "v1"}
        )
        assert result["ok"] is False
        assert "does not exist" in result["error"]


class TestFsRestore:
    """Test fs.restore tool."""

    @pytest.mark.asyncio
    async def test_restore_from_archive(self, fs_mcp: FsMCP, tmp_path: Path) -> None:
        # Setup: create archive
        archive_dir = tmp_path / ".nxl" / "archive" / "v1"
        archive_dir.mkdir(parents=True)
        (archive_dir / "file.txt").write_text("content")

        result = await fs_mcp.handle_tool(
            "fs.restore", {"path": "file.txt", "from_tag": "v1"}
        )
        assert result["ok"] is True
        assert (tmp_path / "file.txt").exists()
        assert not (archive_dir / "file.txt").exists()


class TestFsWorkspaceNew:
    """Test fs.workspace_new tool."""

    @pytest.mark.asyncio
    async def test_workspace_new_creates_scratch_dir(
        self, fs_mcp: FsMCP, tmp_path: Path
    ) -> None:
        result = await fs_mcp.handle_tool(
            "fs.workspace_new", {"owner": "alice"}
        )
        assert result["ok"] is True
        assert result["owner"] == "alice"
        assert result["workspace_path"].startswith("scratch/alice/")


class TestFsStage:
    """Test fs.stage tool."""

    @pytest.mark.asyncio
    async def test_stage_calls_git_add(self, fs_mcp: FsMCP, tmp_path: Path) -> None:
        (tmp_path / "file.txt").write_text("content")
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
            result = await fs_mcp.handle_tool("fs.stage", {"path": "file.txt"})
        assert result["ok"] is True


class TestFsUnstage:
    """Test fs.unstage tool."""

    @pytest.mark.asyncio
    async def test_unstage_calls_git_reset(self, fs_mcp: FsMCP, tmp_path: Path) -> None:
        (tmp_path / "file.txt").write_text("content")
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
            result = await fs_mcp.handle_tool("fs.unstage", {"path": "file.txt"})
        assert result["ok"] is True
