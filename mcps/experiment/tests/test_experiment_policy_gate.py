"""mcps.experiment.tests.test_experiment_policy_gate — Policy gate tests for experiment MCP."""
from __future__ import annotations

from unittest.mock import patch

import pytest

from mcps.experiment.server import ExperimentServer, _trials


@pytest.fixture(autouse=True)
def reset_store() -> None:
    _trials.clear()
    yield
    _trials.clear()


@pytest.fixture
def server() -> ExperimentServer:
    return ExperimentServer("experiment")


class TestExperimentPolicyGate:
    @pytest.mark.asyncio
    async def test_submit_blocked_when_policy_denies(self, server: ExperimentServer) -> None:
        with patch.object(server, "check_policy", return_value=False):
            result = await server.handle_tool(
                "experiment.submit",
                {"config": {}},
            )
        assert result["ok"] is False
        assert "denied" in result["error"]

    @pytest.mark.asyncio
    async def test_status_blocked_when_policy_denies(self, server: ExperimentServer) -> None:
        with patch.object(server, "check_policy", return_value=False):
            result = await server.handle_tool(
                "experiment.status",
                {"trial_id": "any_id"},
            )
        assert result["ok"] is False
        assert "denied" in result["error"]

    @pytest.mark.asyncio
    async def test_cancel_blocked_when_policy_denies(self, server: ExperimentServer) -> None:
        with patch.object(server, "check_policy", return_value=False):
            result = await server.handle_tool(
                "experiment.cancel",
                {"trial_id": "any_id"},
            )
        assert result["ok"] is False
        assert "denied" in result["error"]

    @pytest.mark.asyncio
    async def test_list_blocked_when_policy_denies(self, server: ExperimentServer) -> None:
        with patch.object(server, "check_policy", return_value=False):
            result = await server.handle_tool("experiment.list", {})
        assert result["ok"] is False
        assert "denied" in result["error"]
