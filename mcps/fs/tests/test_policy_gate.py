"""mcps/fs/tests/test_policy_gate.py — Policy gate tests for fs MCP."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from mcps.fs.server import FsMCP
from nxl_core.policy.engine import PolicyDecision


@pytest.fixture
def fs_mcp(tmp_path: Path) -> FsMCP:
    return FsMCP(project_root=tmp_path)


class TestFsPolicyGate:
    """Policy gate tests for fs MCP."""

    @pytest.mark.asyncio
    async def test_all_tools_require_policy_check(self, fs_mcp: FsMCP) -> None:
        """Every tool call must go through policy check."""
        tools = [
            ("fs.move", {"src": "a.txt", "dst": "b.txt"}),
            ("fs.archive", {"path": "a.txt", "tag": "v1"}),
            ("fs.restore", {"path": "a.txt", "from_tag": "v1"}),
            ("fs.workspace_new", {"owner": "alice"}),
            ("fs.stage", {"path": "a.txt"}),
            ("fs.unstage", {"path": "a.txt"}),
        ]
        for tool_name, args in tools:
            with patch.object(fs_mcp._policy, "check") as mock_check:
                mock_check.return_value = PolicyDecision(
                    allowed=True,
                    requires_confirmation=False,
                    reason="Allowed",
                    violated_rules=[],
                )
                # Some need file to exist
                if tool_name in ("fs.move", "fs.archive", "fs.stage", "fs.unstage"):
                    (fs_mcp.project_root / args.get("path", args.get("src", "a.txt"))).write_text("x")
                await fs_mcp.handle_tool(tool_name, args)
                assert mock_check.called, f"{tool_name} did not call policy check"

    @pytest.mark.asyncio
    async def test_policy_denied_blocks_fs_delete(self, fs_mcp: FsMCP) -> None:
        """fs.delete/fs.rm/fs.unlink should always be denied by policy."""
        with patch.object(fs_mcp._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=False,
                requires_confirmation=False,
                reason="fs.delete always denied",
                violated_rules=["fs_delete_always_deny"],
            )
            result = await fs_mcp.handle_tool("fs.delete", {"path": "file.txt"})
        assert result["ok"] is False
        assert "Policy denied" in result["error"]

    @pytest.mark.asyncio
    async def test_capability_token_required_for_all_calls(
        self, fs_mcp: FsMCP
    ) -> None:
        """Every call requires capability token check via policy gate."""
        tools = [
            ("fs.move", {"src": "a.txt", "dst": "b.txt"}),
            ("fs.archive", {"path": "a.txt", "tag": "v1"}),
            ("fs.restore", {"path": "a.txt", "from_tag": "v1"}),
            ("fs.workspace_new", {"owner": "alice"}),
            ("fs.stage", {"path": "a.txt"}),
            ("fs.unstage", {"path": "a.txt"}),
        ]
        for tool_name, args in tools:
            with patch.object(fs_mcp._policy, "check") as mock_check:
                mock_check.return_value = PolicyDecision(
                    allowed=False,
                    requires_confirmation=False,
                    reason="Capability required",
                    violated_rules=["capability_required"],
                )
                result = await fs_mcp.handle_tool(tool_name, args)
                assert result["ok"] is False
                assert "Policy denied" in result["error"]
