"""mcps/literature/tests/test_literature_unit.py"""
from __future__ import annotations

import pytest

from mcps.literature.server import LiteratureMCP


@pytest.fixture
def lit_mcp() -> LiteratureMCP:
    return LiteratureMCP()


class TestLiteraturePut:
    @pytest.mark.asyncio
    async def test_put_stores_metadata(self, lit_mcp: LiteratureMCP) -> None:
        result = await lit_mcp.handle_tool("literature.put", {
            "paper_id": "paper-1",
            "metadata": {"title": "Test Paper", "year": "2024"},
        })
        assert result["ok"] is True
        assert result["data"]["success"] is True


class TestLiteratureGet:
    @pytest.mark.asyncio
    async def test_get_returns_metadata(self, lit_mcp: LiteratureMCP) -> None:
        await lit_mcp.handle_tool("literature.put", {
            "paper_id": "paper-1",
            "metadata": {"title": "Test Paper"},
        })
        result = await lit_mcp.handle_tool("literature.get", {"paper_id": "paper-1"})
        assert result["ok"] is True
        assert result["data"]["metadata"]["title"] == "Test Paper"

    @pytest.mark.asyncio
    async def test_get_missing_returns_none(self, lit_mcp: LiteratureMCP) -> None:
        result = await lit_mcp.handle_tool("literature.get", {"paper_id": "nonexistent"})
        assert result["ok"] is True
        assert result["data"]["metadata"] is None


class TestLiteratureList:
    @pytest.mark.asyncio
    async def test_list_returns_all_ids(self, lit_mcp: LiteratureMCP) -> None:
        await lit_mcp.handle_tool("literature.put", {"paper_id": "p1", "metadata": {}})
        await lit_mcp.handle_tool("literature.put", {"paper_id": "p2", "metadata": {}})
        result = await lit_mcp.handle_tool("literature.list", {})
        assert result["ok"] is True
        assert "p1" in result["data"]["paper_ids"]
        assert "p2" in result["data"]["paper_ids"]


class TestLiteratureSearch:
    @pytest.mark.asyncio
    async def test_search_finds_matching_papers(self, lit_mcp: LiteratureMCP) -> None:
        await lit_mcp.handle_tool("literature.put", {
            "paper_id": "paper-1",
            "metadata": {"title": "Deep Learning for NLP"},
        })
        await lit_mcp.handle_tool("literature.put", {
            "paper_id": "paper-2",
            "metadata": {"title": "Graph Neural Networks"},
        })
        result = await lit_mcp.handle_tool("literature.search", {"query": "deep learning"})
        assert result["ok"] is True
        assert "paper-1" in result["data"]["paper_ids"]
        assert "paper-2" not in result["data"]["paper_ids"]

    @pytest.mark.asyncio
    async def test_search_empty_query_returns_all(self, lit_mcp: LiteratureMCP) -> None:
        await lit_mcp.handle_tool("literature.put", {"paper_id": "p1", "metadata": {"x": "a"}})
        await lit_mcp.handle_tool("literature.put", {"paper_id": "p2", "metadata": {"x": "b"}})
        result = await lit_mcp.handle_tool("literature.search", {"query": ""})
        assert result["ok"] is True
        assert len(result["data"]["paper_ids"]) == 2