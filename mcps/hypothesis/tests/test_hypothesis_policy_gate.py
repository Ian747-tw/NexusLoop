"""mcps.hypothesis.tests.test_hypothesis_policy_gate — Policy gate tests for hypothesis MCP."""
from __future__ import annotations

from unittest.mock import patch

import pytest

from mcps.hypothesis.server import HypothesisServer, _hypotheses


@pytest.fixture(autouse=True)
def reset_store() -> None:
    _hypotheses.clear()
    yield
    _hypotheses.clear()


@pytest.fixture
def server() -> HypothesisServer:
    return HypothesisServer("hypothesis")


class TestHypothesisPolicyGate:
    @pytest.mark.asyncio
    async def test_create_blocked_when_policy_denies(self, server: HypothesisServer) -> None:
        with patch.object(server, "_emit"), patch.object(server, "check_policy", return_value=False):
            result = await server.handle_tool(
                "hypothesis.create",
                {"text": "Should be blocked", "confidence": 0.5},
            )
        assert result["ok"] is False
        assert "denied" in result["error"]

    @pytest.mark.asyncio
    async def test_list_blocked_when_policy_denies(self, server: HypothesisServer) -> None:
        with patch.object(server, "_emit"), patch.object(server, "check_policy", return_value=False):
            result = await server.handle_tool("hypothesis.list", {})
        assert result["ok"] is False
        assert "denied" in result["error"]

    @pytest.mark.asyncio
    async def test_get_blocked_when_policy_denies(self, server: HypothesisServer) -> None:
        with patch.object(server, "_emit"), patch.object(server, "check_policy", return_value=False):
            result = await server.handle_tool("hypothesis.get", {"id": "any_id"})
        assert result["ok"] is False
        assert "denied" in result["error"]

    @pytest.mark.asyncio
    async def test_close_blocked_when_policy_denies(self, server: HypothesisServer) -> None:
        with patch.object(server, "_emit"), patch.object(server, "check_policy", return_value=False):
            result = await server.handle_tool(
                "hypothesis.close",
                {"id": "any_id", "verdict": "rejected"},
            )
        assert result["ok"] is False
        assert "denied" in result["error"]
