"""mcps/literature/tests/test_literature_policy_gate.py"""
from __future__ import annotations

from unittest.mock import patch

import pytest

from mcps.literature.server import LiteratureMCP
from nxl_core.policy.engine import PolicyDecision


@pytest.fixture
def lit_mcp() -> LiteratureMCP:
    return LiteratureMCP()


class TestLiteraturePolicyGate:
    @pytest.mark.asyncio
    async def test_tool_requested_event_emitted(self, lit_mcp: LiteratureMCP) -> None:
        # Smoke test: event is emitted without error
        await lit_mcp.handle_tool("literature.put", {"paper_id": "p1", "metadata": {}})

    @pytest.mark.asyncio
    async def test_policy_denied_returns_error(self, lit_mcp: LiteratureMCP) -> None:
        with patch.object(lit_mcp._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=False,
                requires_confirmation=False,
                reason="Denied by policy",
                violated_rules=["test_rule"],
            )
            result = await lit_mcp.handle_tool("literature.put", {
                "paper_id": "p1",
                "metadata": {"title": "test"},
            })
        assert result["ok"] is False
        assert "Policy denied" in result["error"]