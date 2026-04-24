"""mcps/shell/tests/test_policy_gate.py — Policy gate tests for shell MCP."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from mcps.shell.server import ShellMCP
from nxl_core.policy.engine import PolicyDecision


@pytest.fixture
def shell_mcp(tmp_path: Path) -> ShellMCP:
    return ShellMCP(project_root=tmp_path)


class TestShellPolicyGate:
    """Policy gate tests for shell MCP."""

    @pytest.mark.asyncio
    async def test_exec_requires_policy_check(self, shell_mcp: ShellMCP) -> None:
        """Every shell.exec must go through policy check."""
        with patch.object(shell_mcp._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=True,
                requires_confirmation=False,
                reason="Allowed",
                violated_rules=[],
            )
            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
                await shell_mcp.handle_tool("shell.exec", {"cmd": "echo hello"})
            assert mock_check.called

    @pytest.mark.asyncio
    async def test_policy_denied_blocks_exec(self, shell_mcp: ShellMCP) -> None:
        """Policy denial must block shell.exec."""
        with patch.object(shell_mcp._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=False,
                requires_confirmation=False,
                reason="cwd must be in scratch/",
                violated_rules=["shell_exec_cwd_must_be_scratch_or_allowlisted"],
            )
            result = await shell_mcp.handle_tool(
                "shell.exec", {"cmd": "rm -rf /"}
            )
        assert result["ok"] is False
        assert "Policy denied" in result["error"]

    @pytest.mark.asyncio
    async def test_capability_token_required(self, shell_mcp: ShellMCP) -> None:
        """Every call requires capability token check via policy gate."""
        with patch.object(shell_mcp._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=False,
                requires_confirmation=False,
                reason="Capability required",
                violated_rules=["capability_required"],
            )
            result = await shell_mcp.handle_tool(
                "shell.exec", {"cmd": "echo hello"}
            )
        assert result["ok"] is False
        assert "Policy denied" in result["error"]

    @pytest.mark.asyncio
    async def test_ttl_over_300_policy_denied(self, shell_mcp: ShellMCP) -> None:
        """TTL > 300s should be denied by policy."""
        with patch.object(shell_mcp._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=False,
                requires_confirmation=False,
                reason="TTL max 300s",
                violated_rules=["shell_exec_ttl_max_300s"],
            )
            result = await shell_mcp.handle_tool(
                "shell.exec", {"cmd": "sleep 500", "ttl": 500}
            )
        assert result["ok"] is False
        assert "Policy denied" in result["error"]

    @pytest.mark.asyncio
    async def test_cwd_outside_scratch_denied(self, shell_mcp: ShellMCP) -> None:
        """cwd outside scratch/* should be denied by policy."""
        with patch.object(shell_mcp._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=False,
                requires_confirmation=False,
                reason="cwd must be in scratch/",
                violated_rules=["shell_exec_cwd_must_be_scratch_or_allowlisted"],
            )
            result = await shell_mcp.handle_tool(
                "shell.exec", {"cmd": "echo hello", "cwd": "/etc"}
            )
        assert result["ok"] is False
        assert "Policy denied" in result["error"]
