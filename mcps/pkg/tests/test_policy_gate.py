"""mcps/pkg/tests/test_policy_gate.py — Policy gate tests for pkg MCP."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from mcps.pkg.server import PkgMCP
from nxl_core.policy.engine import PolicyDecision


@pytest.fixture
def pkg_mcp(tmp_path: Path) -> PkgMCP:
    return PkgMCP(project_root=tmp_path)


class TestPkgPolicyGate:
    """Policy gate tests for pkg MCP."""

    @pytest.mark.asyncio
    async def test_add_requires_policy_check(self, pkg_mcp: PkgMCP) -> None:
        with patch.object(pkg_mcp._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=True,
                requires_confirmation=False,
                reason="Allowed",
                violated_rules=[],
            )
            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
                with patch.object(pkg_mcp, "_verify_import") as mock_verify:
                    mock_verify.return_value = {"ok": True, "version": "1.0.0"}
                    await pkg_mcp.handle_tool("pkg.add", {"name": "pytest"})
            # Verify policy.check was called
            assert mock_check.called

    @pytest.mark.asyncio
    async def test_remove_requires_policy_check(self, pkg_mcp: PkgMCP) -> None:
        with patch.object(pkg_mcp._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=True,
                requires_confirmation=False,
                reason="Allowed",
                violated_rules=[],
            )
            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
                await pkg_mcp.handle_tool("pkg.remove", {"name": "pytest"})
            assert mock_check.called

    @pytest.mark.asyncio
    async def test_freeze_requires_policy_check(self, pkg_mcp: PkgMCP) -> None:
        with patch.object(pkg_mcp._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=True,
                requires_confirmation=False,
                reason="Allowed",
                violated_rules=[],
            )
            await pkg_mcp.handle_tool("pkg.freeze", {})
            assert mock_check.called

    @pytest.mark.asyncio
    async def test_all_tools_require_capability_token_check(
        self, pkg_mcp: PkgMCP
    ) -> None:
        """Every tool call must go through capability token check via policy gate."""
        tools = ["pkg.add", "pkg.remove", "pkg.freeze"]
        for tool in tools:
            with patch.object(pkg_mcp._policy, "check") as mock_check:
                mock_check.return_value = PolicyDecision(
                    allowed=False,
                    requires_confirmation=False,
                    reason="Capability required",
                    violated_rules=["capability_required"],
                )
                args = {"name": "test"} if tool != "pkg.freeze" else {}
                result = await pkg_mcp.handle_tool(tool, args)
                assert result["ok"] is False
                assert "Policy denied" in result["error"]


from unittest.mock import MagicMock
