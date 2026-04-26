"""mcps.compute.tests.test_compute_unit — Unit tests for compute MCP."""
from __future__ import annotations

from unittest.mock import patch

import pytest

from mcps.compute.server import ComputeServer


@pytest.fixture
def server() -> ComputeServer:
    return ComputeServer("compute")


class TestComputeServer:
    def test_get_tools_returns_four_tools(self, server: ComputeServer) -> None:
        tools = server.get_tools()
        assert len(tools) == 4
        names = {t["name"] for t in tools}
        assert "compute.gpu_status" in names
        assert "compute.cpu_status" in names
        assert "compute.disk_status" in names
        assert "compute.budget_status" in names

    @pytest.mark.asyncio
    async def test_gpu_status_returns_available_and_memory(self, server: ComputeServer) -> None:
        with patch(
            "mcps.compute.server._get_gpu_info",
            return_value=(True, "NVIDIA A100", 40000),
        ):
            result = await server.handle_tool("compute.gpu_status", {})
        assert result["ok"] is True
        data = result["data"]
        assert data["available"] is True
        assert data["name"] == "NVIDIA A100"
        assert data["memory_free_mb"] == 40000

    @pytest.mark.asyncio
    async def test_gpu_status_no_gpu(self, server: ComputeServer) -> None:
        with patch(
            "mcps.compute.server._get_gpu_info", return_value=(False, "", 0)
        ):
            result = await server.handle_tool("compute.gpu_status", {})
        assert result["ok"] is True
        assert result["data"]["available"] is False

    @pytest.mark.asyncio
    async def test_cpu_status_returns_cores_and_usage(self, server: ComputeServer) -> None:
        with patch(
            "mcps.compute.server._get_cpu_cores", return_value=8
        ), patch("mcps.compute.server._get_cpu_usage", return_value=45.2):
            result = await server.handle_tool("compute.cpu_status", {})
        assert result["ok"] is True
        assert result["data"]["cores"] == 8
        assert result["data"]["usage_percent"] == 45.2

    @pytest.mark.asyncio
    async def test_disk_status_returns_free_and_total(self, server: ComputeServer) -> None:
        with patch(
            "mcps.compute.server._get_disk_info", return_value=(500, 1000)
        ):
            result = await server.handle_tool(
                "compute.disk_status", {"path": "/tmp"}
            )
        assert result["ok"] is True
        assert result["data"]["free_gb"] == 500
        assert result["data"]["total_gb"] == 1000

    @pytest.mark.asyncio
    async def test_disk_status_defaults_to_root(self, server: ComputeServer) -> None:
        with patch(
            "mcps.compute.server._get_disk_info", return_value=(100, 500)
        ):
            result = await server.handle_tool("compute.disk_status", {})
        assert result["ok"] is True
        assert result["data"]["free_gb"] == 100

    @pytest.mark.asyncio
    async def test_budget_status_returns_defaults(self, server: ComputeServer) -> None:
        result = await server.handle_tool("compute.budget_status", {})
        assert result["ok"] is True
        assert "tokens_spent" in result["data"]
        assert "tokens_budget" in result["data"]
        assert "cycles_used" in result["data"]

    @pytest.mark.asyncio
    async def test_policy_denied_returns_error(self, server: ComputeServer) -> None:
        with patch.object(server, "check_policy", return_value=False):
            result = await server.handle_tool("compute.gpu_status", {})
        assert result["ok"] is False
        assert "denied" in result["error"]

