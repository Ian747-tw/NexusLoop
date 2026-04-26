"""mcps.hypothesis.tests.test_hypothesis_unit — Unit tests for hypothesis MCP."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from mcps.hypothesis.server import HypothesisServer, _hypotheses


@pytest.fixture(autouse=True)
def reset_store() -> None:
    """Clear the in-memory hypothesis store before each test."""
    _hypotheses.clear()
    yield
    _hypotheses.clear()


@pytest.fixture
def server() -> HypothesisServer:
    return HypothesisServer("hypothesis")


@pytest.fixture
def mock_event_log() -> MagicMock:
    return MagicMock()


class TestHypothesisServer:
    def test_get_tools_returns_four_tools(self, server: HypothesisServer) -> None:
        tools = server.get_tools()
        assert len(tools) == 4
        names = {t["name"] for t in tools}
        assert "hypothesis.create" in names
        assert "hypothesis.list" in names
        assert "hypothesis.get" in names
        assert "hypothesis.close" in names

    @pytest.mark.asyncio
    async def test_create_returns_id_and_hash(self, server: HypothesisServer) -> None:
        result = await server.handle_tool(
            "hypothesis.create",
            {"text": "More layers improve accuracy", "confidence": 0.8},
        )
        assert result["ok"] is True
        data = result["data"]
        assert "id" in data
        assert "spec_hash" in data
        assert data["id"] != ""

    @pytest.mark.asyncio
    async def test_create_then_get_round_trip(self, server: HypothesisServer) -> None:
        create_result = await server.handle_tool(
            "hypothesis.create",
            {"text": "Dropout reduces overfitting", "confidence": 0.7},
        )
        hyp_id = create_result["data"]["id"]

        get_result = await server.handle_tool("hypothesis.get", {"id": hyp_id})
        assert get_result["ok"] is True
        assert get_result["data"]["claim"] == "Dropout reduces overfitting"
        assert get_result["data"]["status"] == "active"

    @pytest.mark.asyncio
    async def test_get_nonexistent_returns_error(self, server: HypothesisServer) -> None:
        result = await server.handle_tool("hypothesis.get", {"id": "does_not_exist"})
        assert result["ok"] is False
        assert "not found" in result["error"]

    @pytest.mark.asyncio
    async def test_list_returns_all_hypotheses(self, server: HypothesisServer) -> None:
        await server.handle_tool(
            "hypothesis.create",
            {"text": "Hypothesis A", "confidence": 0.5},
        )
        await server.handle_tool(
            "hypothesis.create",
            {"text": "Hypothesis B", "confidence": 0.6},
        )

        result = await server.handle_tool("hypothesis.list", {})
        assert result["ok"] is True
        hypos = result["data"]["hypotheses"]
        assert len(hypos) == 2

    @pytest.mark.asyncio
    async def test_close_updates_verdict_and_status(self, server: HypothesisServer) -> None:
        create_result = await server.handle_tool(
            "hypothesis.create",
            {"text": "Learning rate too high", "confidence": 0.9},
        )
        hyp_id = create_result["data"]["id"]

        close_result = await server.handle_tool(
            "hypothesis.close",
            {"id": hyp_id, "verdict": "confirmed"},
        )
        assert close_result["ok"] is True
        assert close_result["data"]["verdict"] == "confirmed"
        assert close_result["data"]["status"] == "closed"

        get_result = await server.handle_tool("hypothesis.get", {"id": hyp_id})
        assert get_result["data"]["status"] == "closed"

    @pytest.mark.asyncio
    async def test_policy_denied_returns_error(self, server: HypothesisServer) -> None:
        with patch.object(server, "check_policy", return_value=False):
            result = await server.handle_tool(
                "hypothesis.create",
                {"text": "Policy denied test", "confidence": 0.5},
            )
        assert result["ok"] is False
        assert "denied" in result["error"]

    @pytest.mark.asyncio
    async def test_close_nonexistent_returns_error(self, server: HypothesisServer) -> None:
        result = await server.handle_tool(
            "hypothesis.close",
            {"id": "nonexistent_id", "verdict": "rejected"},
        )
        assert result["ok"] is False
        assert "not found" in result["error"]

