"""mcps.compute.tests.test_compute_policy_gate — Policy gate tests for compute MCP."""
from __future__ import annotations

from unittest.mock import patch

import pytest

from mcps.compute.server import ComputeServer


@pytest.fixture
def server() -> ComputeServer:
    return ComputeServer("compute")


class TestComputePolicyGate:
    @pytest.mark.asyncio
    async def test_gpu_status_blocked_when_policy_denies(self, server: ComputeServer) -> None:
        with patch.object(server, "check_policy", return_value=False):
            result = await server.handle_tool("compute.gpu_status", {})
        assert result["ok"] is False
        assert "denied" in result["error"]

    @pytest.mark.asyncio
    async def test_cpu_status_blocked_when_policy_denies(self, server: ComputeServer) -> None:
        with patch.object(server, "check_policy", return_value=False):
            result = await server.handle_tool("compute.cpu_status", {})
        assert result["ok"] is False
        assert "denied" in result["error"]

    @pytest.mark.asyncio
    async def test_disk_status_blocked_when_policy_denies(
        self, server: ComputeServer
    ) -> None:
        with patch.object(server, "check_policy", return_value=False):
            result = await server.handle_tool("compute.disk_status", {"path": "/tmp"})
        assert result["ok"] is False
        assert "denied" in result["error"]

    @pytest.mark.asyncio
    async def test_budget_status_blocked_when_policy_denies(
        self, server: ComputeServer
    ) -> None:
        with patch.object(server, "check_policy", return_value=False):
            result = await server.handle_tool("compute.budget_status", {})
        assert result["ok"] is False
        assert "denied" in result["error"]
