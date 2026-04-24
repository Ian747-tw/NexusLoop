"""tests/e2e_user/scenarios/test_shell_denies_write_outside_scratch.py — E2E test for shell MCP cwd restrictions."""
from __future__ import annotations

import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

from mcps.shell.server import ShellMCP
from nxl_core.policy.engine import PolicyDecision


@pytest.mark.phase_m2
class TestShellDeniesWriteOutsideScratch:
    """E2E test: shell.exec should deny dangerous operations outside scratch/."""

    @pytest.mark.asyncio
    async def test_shell_exec_in_scratch_allowed(self, tmp_path: Path) -> None:
        """shell.exec with cwd in scratch/* should be allowed."""
        shell_mcp = ShellMCP(project_root=tmp_path)

        # Create scratch workspace
        scratch_dir = tmp_path / "scratch" / "alice" / "ws1"
        scratch_dir.mkdir(parents=True)

        with patch.object(shell_mcp._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=True,
                requires_confirmation=False,
                reason="Allowed",
                violated_rules=[],
            )
            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(
                    returncode=0, stdout="file.txt", stderr=""
                )
                result = await shell_mcp.handle_tool(
                    "shell.exec",
                    {"cmd": "ls", "cwd": "scratch/alice/ws1"}
                )
        assert result["ok"] is True

    @pytest.mark.asyncio
    async def test_shell_exec_dangerous_cwd_denied(self, tmp_path: Path) -> None:
        """shell.exec with dangerous cwd outside scratch should be denied by policy."""
        shell_mcp = ShellMCP(project_root=tmp_path)

        with patch.object(shell_mcp._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=False,
                requires_confirmation=False,
                reason="cwd must be in scratch/",
                violated_rules=["shell_exec_cwd_must_be_scratch_or_allowlisted"],
            )
            result = await shell_mcp.handle_tool(
                "shell.exec",
                {"cmd": "rm -rf /", "cwd": "/tmp"}
            )
        assert result["ok"] is False
        assert "Policy denied" in result["error"]

    @pytest.mark.asyncio
    async def test_shell_exec_ttl_exceeds_limit_denied(self, tmp_path: Path) -> None:
        """shell.exec with TTL > 300s should be denied by policy."""
        shell_mcp = ShellMCP(project_root=tmp_path)

        with patch.object(shell_mcp._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=False,
                requires_confirmation=False,
                reason="TTL max 300s",
                violated_rules=["shell_exec_ttl_max_300s"],
            )
            result = await shell_mcp.handle_tool(
                "shell.exec",
                {"cmd": "sleep 600", "ttl": 600}
            )
        assert result["ok"] is False
        assert "Policy denied" in result["error"]

    @pytest.mark.asyncio
    async def test_shell_exec_allowlisted_commands_work(
        self, tmp_path: Path
    ) -> None:
        """Allowlisted commands (nvidia-smi, df, ps, uv pip list, git status) should work."""
        shell_mcp = ShellMCP(project_root=tmp_path)

        with patch.object(shell_mcp._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=True,
                requires_confirmation=False,
                reason="Allowlisted command",
                violated_rules=[],
            )
            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(
                    returncode=0, stdout="status output", stderr=""
                )
                result = await shell_mcp.handle_tool(
                    "shell.exec",
                    {"cmd": "git status"}
                )
        assert result["ok"] is True
