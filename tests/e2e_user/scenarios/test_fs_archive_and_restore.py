"""tests/e2e_user/scenarios/test_fs_archive_and_restore.py — E2E test for fs MCP archive/restore."""
from __future__ import annotations

import pytest
from pathlib import Path
from unittest.mock import patch

from mcps.fs.server import FsMCP
from nxl_core.policy.engine import PolicyDecision


@pytest.mark.phase_m2
class TestFsArchiveAndRestore:
    """E2E test: fs.archive and fs.restore round-trip."""

    @pytest.mark.asyncio
    async def test_archive_and_restore_roundtrip(
        self, tmp_path: Path
    ) -> None:
        """Archive a file, then restore it - should round-trip correctly."""
        fs_mcp = FsMCP(project_root=tmp_path)

        # Create test file
        (tmp_path / "document.txt").write_text("important content")

        # Archive it
        with patch.object(fs_mcp._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=True,
                requires_confirmation=False,
                reason="Allowed",
                violated_rules=[],
            )
            archive_result = await fs_mcp.handle_tool(
                "fs.archive", {"path": "document.txt", "tag": "backup-v1"}
            )
        assert archive_result["ok"] is True
        assert not (tmp_path / "document.txt").exists()
        assert (tmp_path / ".nxl" / "archive" / "backup-v1" / "document.txt").exists()

        # Restore it
        with patch.object(fs_mcp._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=True,
                requires_confirmation=False,
                reason="Allowed",
                violated_rules=[],
            )
            restore_result = await fs_mcp.handle_tool(
                "fs.restore", {"path": "document.txt", "from_tag": "backup-v1"}
            )
        assert restore_result["ok"] is True
        assert (tmp_path / "document.txt").exists()
        assert (tmp_path / "document.txt").read_text() == "important content"

    @pytest.mark.asyncio
    async def test_archive_without_capability_denied(
        self, tmp_path: Path
    ) -> None:
        """Archive without capability token should be denied."""
        fs_mcp = FsMCP(project_root=tmp_path)
        (tmp_path / "file.txt").write_text("x")

        with patch.object(fs_mcp._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=False,
                requires_confirmation=False,
                reason="Capability required",
                violated_rules=["capability_required"],
            )
            result = await fs_mcp.handle_tool(
                "fs.archive", {"path": "file.txt", "tag": "v1"}
            )
        assert result["ok"] is False
        assert "Policy denied" in result["error"]

    @pytest.mark.asyncio
    async def test_workspace_new_creates_scratch_structure(
        self, tmp_path: Path
    ) -> None:
        """fs.workspace_new should create scratch/<owner>/<uuid>/ structure."""
        fs_mcp = FsMCP(project_root=tmp_path)

        with patch.object(fs_mcp._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=True,
                requires_confirmation=False,
                reason="Allowed",
                violated_rules=[],
            )
            result = await fs_mcp.handle_tool(
                "fs.workspace_new", {"owner": "researcher1"}
            )
        assert result["ok"] is True
        workspace_path = tmp_path / result["workspace_path"]
        assert workspace_path.exists()
        assert workspace_path.name  # UUID
        assert result["workspace_path"].startswith("scratch/researcher1/")
