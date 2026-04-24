"""mcps/web/tests/test_web_policy_gate.py"""
from __future__ import annotations

from unittest.mock import patch

import pytest

from mcps.web.server import WebMCP
from nxl_core.policy.engine import PolicyDecision


@pytest.fixture
def web_mcp() -> WebMCP:
    return WebMCP()


class TestWebPolicyGate:
    @pytest.mark.asyncio
    async def test_tool_requested_event_emitted(self, web_mcp: WebMCP) -> None:
        # Smoke test: event is emitted without error
        await web_mcp.handle_tool("web.fetch", {"url": "https://example.com"})

    @pytest.mark.asyncio
    async def test_policy_denied_returns_error(self, web_mcp: WebMCP) -> None:
        with patch.object(web_mcp._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=False,
                requires_confirmation=False,
                reason="Denied by policy",
                violated_rules=["test_rule"],
            )
            result = await web_mcp.handle_tool("web.fetch", {"url": "https://example.com"})
        assert result["ok"] is False
        assert "Policy denied" in result["error"]