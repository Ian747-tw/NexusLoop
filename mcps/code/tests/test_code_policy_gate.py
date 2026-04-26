"""mcps/code/tests/test_code_policy_gate.py — Policy gate smoke tests for code MCP."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from mcps.code.server import CodeMCP
from nxl_core.policy.engine import PolicyDecision


@pytest.fixture
def code_mcp(tmp_path: Path) -> CodeMCP:
    return CodeMCP(project_root=tmp_path)


class TestCodePolicyGate:
    @pytest.mark.asyncio
    async def test_policy_denied_returns_error(
        self, tmp_path: Path, code_mcp: CodeMCP
    ) -> None:
        with patch.object(code_mcp._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=False,
                requires_confirmation=False,
                reason="Denied by policy",
                violated_rules=["test_rule"],
            )
            result = await code_mcp.handle_tool("code.read_file", {"path": "f.txt"})
        assert result["ok"] is False
        assert "Policy denied" in result["error"]