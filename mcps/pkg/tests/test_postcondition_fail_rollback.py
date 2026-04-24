"""mcps/pkg/tests/test_postcondition_fail_rollback.py — Rollback tests for pkg MCP."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from mcps.pkg.server import PkgMCP


@pytest.fixture
def pkg_mcp(tmp_path: Path) -> PkgMCP:
    return PkgMCP(project_root=tmp_path)


class TestPkgPostconditionFailRollback:
    """Test rollback on postcondition failure."""

    @pytest.mark.asyncio
    async def test_add_rollback_on_import_failure(
        self, pkg_mcp: PkgMCP
    ) -> None:
        """After failed postcondition (import check), verify rollback via uv remove."""
        with patch("subprocess.run") as mock_run:
            # First call: uv add succeeds
            # Second call: import check fails
            # Third call: uv remove for rollback
            mock_run.side_effect = [
                MagicMock(returncode=0, stdout="", stderr=""),  # uv add
                MagicMock(returncode=1, stdout="", stderr="ImportError"),  # import check
                MagicMock(returncode=0, stdout="", stderr=""),  # uv remove rollback
            ]
            result = await pkg_mcp.handle_tool(
                "pkg.add", {"name": "bad-package"}
            )

        assert result["ok"] is False
        assert "Postcondition failed" in result["error"]
        assert "rolled back" in result["error"]

        # Verify rollback: uv remove was called
        assert mock_run.call_count == 3
        remove_call = mock_run.call_args_list[2][0][0]
        assert "uv" in remove_call
        assert "remove" in remove_call

    @pytest.mark.asyncio
    async def test_import_check_uses_python_c_command(
        self, pkg_mcp: PkgMCP
    ) -> None:
        """Verify postcondition uses python -c 'import <name>'."""
        import sys

        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="1.0.0", stderr="")
            # uv add succeeds, import check returns version
            mock_run.side_effect = [
                MagicMock(returncode=0, stdout="", stderr=""),  # uv add
                MagicMock(returncode=0, stdout="1.0.0", stderr=""),  # import check
            ]
            result = await pkg_mcp.handle_tool(
                "pkg.add", {"name": "requests"}
            )

        assert result["ok"] is True
        assert result["version_installed"] == "1.0.0"

        # Check import command was correct - it's the second call (index 1)
        import_call = mock_run.call_args_list[1][0][0]
        assert sys.executable in import_call
        # The command is a list: [python_path, '-c', 'import requests; ...']
        # Check that 'import requests' is in the third element
        import_str = import_call[2]
        assert "import requests" in import_str
