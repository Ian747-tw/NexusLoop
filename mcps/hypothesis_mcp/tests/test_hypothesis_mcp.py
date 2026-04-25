"""mcps.hypothesis_mcp.tests.test_hypothesis_mcp — unit tests for hypothesis MCP server."""
from __future__ import annotations

import asyncio

from mcps.hypothesis_mcp.server import HypothesisMCPServer, _hypotheses


class TestHypothesisMCPServer:
    """Tests for hypothesis MCP server."""

    def setup_method(self) -> None:
        """Clear the in-memory hypothesis store before each test."""
        _hypotheses.clear()

    def test_get_tools_returns_three_tools(self) -> None:
        server = HypothesisMCPServer()
        tools = server.get_tools()
        assert len(tools) == 3
        names = {t["name"] for t in tools}
        assert names == {"hypothesis.create", "hypothesis.list", "hypothesis.get"}

    def test_create_emits_hypothesis_created_event(self) -> None:
        server = HypothesisMCPServer()
        result = asyncio.run(server.handle_tool(
            "hypothesis.create",
            {"claim": "More layers improve accuracy", "source": "human"}
        ))
        assert result["ok"] is True
        data = result["data"]
        assert "hypothesis_id" in data
        assert data["hypothesis_id"] != ""

    def test_create_and_get_round_trip(self) -> None:
        server = HypothesisMCPServer()
        create_result = asyncio.run(server.handle_tool(
            "hypothesis.create",
            {"claim": "Dropout reduces overfitting", "source": "literature"}
        ))
        hyp_id = create_result["data"]["hypothesis_id"]

        get_result = asyncio.run(server.handle_tool(
            "hypothesis.get",
            {"hypothesis_id": hyp_id}
        ))
        assert get_result["ok"] is True
        assert get_result["data"]["claim"] == "Dropout reduces overfitting"
        assert get_result["data"]["source"] == "literature"

    def test_get_nonexistent_returns_error(self) -> None:
        server = HypothesisMCPServer()
        result = asyncio.run(server.handle_tool(
            "hypothesis.get",
            {"hypothesis_id": "does_not_exist"}
        ))
        assert result["ok"] is False
        assert "not found" in result["error"]

    def test_list_returns_all_hypotheses(self) -> None:
        server = HypothesisMCPServer()
        asyncio.run(server.handle_tool(
            "hypothesis.create",
            {"claim": "Hypothesis A", "source": "human"}
        ))
        asyncio.run(server.handle_tool(
            "hypothesis.create",
            {"claim": "Hypothesis B", "source": "surrogate"}
        ))

        result = asyncio.run(server.handle_tool("hypothesis.list", {}))
        assert result["ok"] is True
        hypos = result["data"]["hypotheses"]
        assert len(hypos) == 2

    def test_list_empty_when_no_hypotheses(self) -> None:
        server = HypothesisMCPServer()
        result = asyncio.run(server.handle_tool("hypothesis.list", {}))
        assert result["ok"] is True
        assert result["data"]["hypotheses"] == []

    def test_handle_tool_unknown_returns_error(self) -> None:
        server = HypothesisMCPServer()
        result = asyncio.run(server.handle_tool("hypothesis.unknown", {}))
        assert result["ok"] is False
        assert "Unknown tool" in result["error"]

    def test_create_with_all_sources(self) -> None:
        server = HypothesisMCPServer()
        sources = ["human", "literature", "surrogate", "ablation", "diversification", "failure"]
        for source in sources:
            result = asyncio.run(server.handle_tool(
                "hypothesis.create",
                {"claim": f"Hypothesis from {source}", "source": source}
            ))
            assert result["ok"] is True
            assert result["data"]["hypothesis_id"] != ""

        list_result = asyncio.run(server.handle_tool("hypothesis.list", {}))
        assert len(list_result["data"]["hypotheses"]) == 6