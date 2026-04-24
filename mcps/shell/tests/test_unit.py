"""mcps/shell/tests/test_unit.py — Unit tests for shell MCP."""
from __future__ import annotations

import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

from mcps.shell.server import ShellMCP
from nxl_core.policy.engine import PolicyDecision


@pytest.fixture
def shell_mcp(tmp_path: Path) -> ShellMCP:
    return ShellMCP(project_root=tmp_path)


class TestShellTools:
    """Test tool definitions."""

    def test_get_tools_returns_one_tool(self, shell_mcp: ShellMCP) -> None:
        tools = shell_mcp.get_tools()
        assert len(tools) == 1
        assert tools[0]["name"] == "shell.exec"

    def test_shell_exec_schema(self, shell_mcp: ShellMCP) -> None:
        tools = shell_mcp.get_tools()
        exec_tool = tools[0]
        props = exec_tool["inputSchema"]["properties"]
        assert "cmd" in props
        assert "ttl" in props
        assert "cwd" in props
        assert "tag" in props
        assert "capture" in props


class TestShellExec:
    """Test shell.exec tool."""

    @pytest.mark.asyncio
    async def test_exec_runs_command(self, shell_mcp: ShellMCP, tmp_path: Path) -> None:
        with patch.object(shell_mcp._policy, "check") as mock_policy:
            mock_policy.return_value = PolicyDecision(
                allowed=True,
                requires_confirmation=False,
                reason="Allowed",
                violated_rules=[],
            )
            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(
                    returncode=0,
                    stdout="hello",
                    stderr="",
                )
                result = await shell_mcp.handle_tool(
                    "shell.exec", {"cmd": "echo hello"}
                )
        assert result["ok"] is True
        assert result["cmd"] == "echo hello"
        assert result["exit_code"] == 0

    @pytest.mark.asyncio
    async def test_exec_with_cwd(self, shell_mcp: ShellMCP, tmp_path: Path) -> None:
        scratch_dir = tmp_path / "scratch" / "alice" / "ws1"
        scratch_dir.mkdir(parents=True)
        (scratch_dir / "file.txt").write_text("content")

        with patch.object(shell_mcp._policy, "check") as mock_policy:
            mock_policy.return_value = PolicyDecision(
                allowed=True,
                requires_confirmation=False,
                reason="Allowed",
                violated_rules=[],
            )
            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(returncode=0, stdout="ok", stderr="")
                result = await shell_mcp.handle_tool(
                    "shell.exec", {"cmd": "cat file.txt", "cwd": "scratch/alice/ws1"}
                )
        assert result["ok"] is True

    @pytest.mark.asyncio
    async def test_exec_returns_duration_ms(self, shell_mcp: ShellMCP) -> None:
        with patch.object(shell_mcp._policy, "check") as mock_policy:
            mock_policy.return_value = PolicyDecision(
                allowed=True,
                requires_confirmation=False,
                reason="Allowed",
                violated_rules=[],
            )
            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
                result = await shell_mcp.handle_tool(
                    "shell.exec", {"cmd": "true"}
                )
        assert result["ok"] is True
        assert "duration_ms" in result

    @pytest.mark.asyncio
    async def test_exec_timeout_returns_error(self, shell_mcp: ShellMCP) -> None:
        import subprocess

        with patch.object(shell_mcp._policy, "check") as mock_policy:
            mock_policy.return_value = PolicyDecision(
                allowed=True,
                requires_confirmation=False,
                reason="Allowed",
                violated_rules=[],
            )
            with patch("subprocess.run") as mock_run:
                mock_run.side_effect = subprocess.TimeoutExpired("cmd", 300)
                result = await shell_mcp.handle_tool(
                    "shell.exec", {"cmd": "sleep 500", "ttl": 300}
                )
        assert result["ok"] is False
        assert "timed out" in result["error"]

    @pytest.mark.asyncio
    async def test_exec_captures_stdout_stderr(self, shell_mcp: ShellMCP) -> None:
        with patch.object(shell_mcp._policy, "check") as mock_policy:
            mock_policy.return_value = PolicyDecision(
                allowed=True,
                requires_confirmation=False,
                reason="Allowed",
                violated_rules=[],
            )
            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(
                    returncode=0,
                    stdout="stdout content",
                    stderr="stderr content",
                )
                result = await shell_mcp.handle_tool(
                    "shell.exec", {"cmd": "echo test", "capture": True}
                )
        assert result["stdout"] == "stdout content"
        assert result["stderr"] == "stderr content"

    @pytest.mark.asyncio
    async def test_exec_without_capture(self, shell_mcp: ShellMCP) -> None:
        with patch.object(shell_mcp._policy, "check") as mock_policy:
            mock_policy.return_value = PolicyDecision(
                allowed=True,
                requires_confirmation=False,
                reason="Allowed",
                violated_rules=[],
            )
            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
                result = await shell_mcp.handle_tool(
                    "shell.exec", {"cmd": "echo test", "capture": False}
                )
        assert result["ok"] is True
        assert result["stdout"] is None


class TestShellPolicyGate:
    """Test policy gate integration."""

    @pytest.mark.asyncio
    async def test_policy_denied_blocks_exec(self, shell_mcp: ShellMCP) -> None:
        with patch.object(shell_mcp._policy, "check") as mock_check:
            from nxl_core.policy.engine import PolicyDecision
            mock_check.return_value = PolicyDecision(
                allowed=False,
                requires_confirmation=False,
                reason="Test deny",
                violated_rules=["test_rule"],
            )
            result = await shell_mcp.handle_tool(
                "shell.exec", {"cmd": "echo hello"}
            )
        assert result["ok"] is False
        assert "Policy denied" in result["error"]

    @pytest.mark.asyncio
    async def test_ttl_capped_at_300(self, shell_mcp: ShellMCP) -> None:
        """TTL is hard-capped at 300 seconds by the implementation."""
        with patch.object(shell_mcp._policy, "check") as mock_policy:
            mock_policy.return_value = PolicyDecision(
                allowed=True,
                requires_confirmation=False,
                reason="Allowed",
                violated_rules=[],
            )
            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
                result = await shell_mcp.handle_tool(
                    "shell.exec", {"cmd": "echo hello", "ttl": 600}
                )
        assert result["ok"] is True
        # Verify the timeout passed to subprocess.run
        call_args = mock_run.call_args
        assert call_args[1]["timeout"] == 300  # Capped at 300
