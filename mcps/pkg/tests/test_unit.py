"""mcps/pkg/tests/test_unit.py — Unit tests for pkg MCP."""
from __future__ import annotations

import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

from mcps.pkg.server import PkgMCP


@pytest.fixture
def pkg_mcp(tmp_path: Path) -> PkgMCP:
    return PkgMCP(project_root=tmp_path)


class TestPkgTools:
    """Test tool definitions."""

    def test_get_tools_returns_three_tools(self, pkg_mcp: PkgMCP) -> None:
        tools = pkg_mcp.get_tools()
        assert len(tools) == 3
        tool_names = {t["name"] for t in tools}
        assert "pkg.add" in tool_names
        assert "pkg.remove" in tool_names
        assert "pkg.freeze" in tool_names

    def test_pkg_add_schema(self, pkg_mcp: PkgMCP) -> None:
        tools = pkg_mcp.get_tools()
        add_tool = next(t for t in tools if t["name"] == "pkg.add")
        props = add_tool["inputSchema"]["properties"]
        assert "name" in props
        assert "version_spec" in props
        assert "registry" in props


class TestPkgAdd:
    """Test pkg.add tool."""

    @pytest.mark.asyncio
    async def test_add_calls_uv_add(self, pkg_mcp: PkgMCP, tmp_path: Path) -> None:
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
            with patch.object(pkg_mcp, "_verify_import") as mock_verify:
                mock_verify.return_value = {"ok": True, "version": "1.0.0"}
                result = await pkg_mcp.handle_tool(
                    "pkg.add", {"name": "requests", "version_spec": ">=2.0.0"}
                )
        assert result["ok"] is True
        assert result["package_name"] == "requests"
        # Verify uv add was called
        call_args = mock_run.call_args[0][0]
        assert "uv" in call_args
        assert "add" in call_args
        assert "requests" in call_args

    @pytest.mark.asyncio
    async def test_add_with_pypi_registry_allowed(self, pkg_mcp: PkgMCP) -> None:
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
            with patch.object(pkg_mcp, "_verify_import") as mock_verify:
                mock_verify.return_value = {"ok": True, "version": "1.0.0"}
                result = await pkg_mcp.handle_tool(
                    "pkg.add", {"name": "pytest", "registry": "pypi"}
                )
        assert result["ok"] is True

    @pytest.mark.asyncio
    async def test_add_fails_on_uv_error(self, pkg_mcp: PkgMCP) -> None:
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(
                returncode=1, stdout="", stderr="Package not found"
            )
            result = await pkg_mcp.handle_tool(
                "pkg.add", {"name": "nonexistent-package-xyz"}
            )
        assert result["ok"] is False
        assert "uv add failed" in result["error"]


class TestPkgRemove:
    """Test pkg.remove tool."""

    @pytest.mark.asyncio
    async def test_remove_calls_uv_remove(self, pkg_mcp: PkgMCP) -> None:
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
            result = await pkg_mcp.handle_tool(
                "pkg.remove", {"name": "requests"}
            )
        assert result["ok"] is True
        call_args = mock_run.call_args[0][0]
        assert "uv" in call_args
        assert "remove" in call_args

    @pytest.mark.asyncio
    async def test_remove_fails_on_error(self, pkg_mcp: PkgMCP) -> None:
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(
                returncode=1, stdout="", stderr="Package not installed"
            )
            result = await pkg_mcp.handle_tool(
                "pkg.remove", {"name": "nonexistent"}
            )
        assert result["ok"] is False
        assert "uv remove failed" in result["error"]


class TestPkgFreeze:
    """Test pkg.freeze tool."""

    @pytest.mark.asyncio
    async def test_freeze_returns_lockfile_diff(self, pkg_mcp: PkgMCP) -> None:
        result = await pkg_mcp.handle_tool("pkg.freeze", {})
        assert result["ok"] is True
        assert "lockfile_diff" in result


class TestPkgPolicyGate:
    """Test policy gate integration."""

    @pytest.mark.asyncio
    async def test_policy_denied_blocks_add(self, pkg_mcp: PkgMCP) -> None:
        with patch.object(pkg_mcp._policy, "check") as mock_check:
            from nxl_core.policy.engine import PolicyDecision
            mock_check.return_value = PolicyDecision(
                allowed=False,
                requires_confirmation=False,
                reason="Test deny",
                violated_rules=["test_rule"],
            )
            result = await pkg_mcp.handle_tool(
                "pkg.add", {"name": "requests"}
            )
        assert result["ok"] is False
        assert "Policy denied" in result["error"]
