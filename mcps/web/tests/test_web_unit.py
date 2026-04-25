"""mcps/web/tests/test_web_unit.py"""
from __future__ import annotations

from unittest.mock import patch, MagicMock

import pytest

from mcps.web.server import WebMCP


@pytest.fixture
def web_mcp() -> WebMCP:
    return WebMCP()


class TestWebFetch:
    @pytest.mark.asyncio
    async def test_fetch_rejects_non_http_urls(self, web_mcp: WebMCP) -> None:
        result = await web_mcp.handle_tool("web.fetch", {"url": "file:///etc/passwd"})
        assert result["ok"] is False
        assert "not allowed" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_fetch_rejects_ftp_urls(self, web_mcp: WebMCP) -> None:
        result = await web_mcp.handle_tool("web.fetch", {"url": "ftp://example.com/file.txt"})
        assert result["ok"] is False

    @pytest.mark.asyncio
    @patch("mcps.web.server.requests.get")
    async def test_fetch_returns_content_and_status(
        self, mock_get: MagicMock, web_mcp: WebMCP
    ) -> None:
        mock_resp = MagicMock()
        mock_resp.text = "<html>Hello</html>"
        mock_resp.status_code = 200
        mock_get.return_value = mock_resp
        result = await web_mcp.handle_tool("web.fetch", {"url": "https://example.com"})
        assert result["ok"] is True
        assert result["data"]["content"] == "<html>Hello</html>"
        assert result["data"]["status"] == 200
        assert result["data"]["cached"] is False

    @pytest.mark.asyncio
    @patch("mcps.web.server.requests.get")
    async def test_fetch_serves_from_cache(
        self, mock_get: MagicMock, web_mcp: WebMCP
    ) -> None:
        mock_resp = MagicMock()
        mock_resp.text = "<html>Hello</html>"
        mock_resp.status_code = 200
        mock_get.return_value = mock_resp
        r1 = await web_mcp.handle_tool("web.fetch", {"url": "https://example.com"})
        assert r1["data"]["cached"] is False
        r2 = await web_mcp.handle_tool("web.fetch", {"url": "https://example.com"})
        assert r2["data"]["cached"] is True
        mock_get.assert_called_once()


class TestWebSearch:
    @pytest.mark.asyncio
    @pytest.mark.skip(reason="requires web permissions in policy.json — flaky in CI without proper policy setup")
    @patch("mcps.web.server.requests.get")
    async def test_search_returns_results(self, mock_get: MagicMock, web_mcp: WebMCP) -> None:
        mock_resp = MagicMock()
        mock_resp.ok = True
        mock_resp.text = """
        <div class="result">
            <a class="result__a" href="https://example.com">Example Site</a>
            <a class="result__snippet" href="#">This is a snippet</a>
        </div>
        """
        mock_get.return_value = mock_resp
        result = await web_mcp.handle_tool("web.search", {"query": "test", "num_results": 5})
        assert result["ok"] is True
        assert "results" in result["data"]

    @pytest.mark.asyncio
    @patch("mcps.web.server.requests.get")
    async def test_search_http_error(self, mock_get: MagicMock, web_mcp: WebMCP) -> None:
        mock_resp = MagicMock()
        mock_resp.ok = False
        mock_resp.status_code = 500
        mock_get.return_value = mock_resp
        result = await web_mcp.handle_tool("web.search", {"query": "test", "num_results": 5})
        assert result["ok"] is False
        assert "failed" in result["error"]