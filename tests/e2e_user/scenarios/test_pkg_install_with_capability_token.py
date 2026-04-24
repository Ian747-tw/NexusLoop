"""tests/e2e_user/scenarios/test_pkg_install_with_capability_token.py — E2E test for pkg MCP with capability token."""
from __future__ import annotations

import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

from mcps.pkg.server import PkgMCP
from nxl_core.policy.engine import PolicyDecision


@pytest.mark.phase_m2
class TestPkgInstallWithCapabilityToken:
    """E2E test: pkg.add requires capability token via policy gate."""

    @pytest.mark.asyncio
    async def test_pkg_add_with_valid_capability_token(
        self, tmp_path: Path
    ) -> None:
        """When policy allows, pkg.add should succeed with valid capability token."""
        pkg_mcp = PkgMCP(project_root=tmp_path)

        with patch.object(pkg_mcp._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=True,
                requires_confirmation=False,
                reason="Capability token valid",
                violated_rules=[],
            )
            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
                with patch.object(pkg_mcp, "_verify_import") as mock_verify:
                    mock_verify.return_value = {"ok": True, "version": "1.0.0"}
                    result = await pkg_mcp.handle_tool(
                        "pkg.add", {"name": "pytest"}
                    )
        assert result["ok"] is True
        assert result["package_name"] == "pytest"

    @pytest.mark.asyncio
    async def test_pkg_add_without_capability_token_denied(
        self, tmp_path: Path
    ) -> None:
        """When capability token is missing/invalid, policy should deny pkg.add."""
        pkg_mcp = PkgMCP(project_root=tmp_path)

        with patch.object(pkg_mcp._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=False,
                requires_confirmation=False,
                reason="Capability token required",
                violated_rules=["capability_required"],
            )
            result = await pkg_mcp.handle_tool(
                "pkg.add", {"name": "requests"}
            )
        assert result["ok"] is False
        assert "Policy denied" in result["error"]

    @pytest.mark.asyncio
    async def test_pkg_remove_with_capability_token(
        self, tmp_path: Path
    ) -> None:
        """pkg.remove should also require capability token."""
        pkg_mcp = PkgMCP(project_root=tmp_path)

        with patch.object(pkg_mcp._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=True,
                requires_confirmation=False,
                reason="Capability token valid",
                violated_rules=[],
            )
            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
                result = await pkg_mcp.handle_tool(
                    "pkg.remove", {"name": "pytest"}
                )
        assert result["ok"] is True
