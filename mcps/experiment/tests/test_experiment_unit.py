"""mcps.experiment.tests.test_experiment_unit — Unit tests for experiment MCP."""
from __future__ import annotations

from unittest.mock import patch

import pytest

from mcps.experiment.server import ExperimentServer, _trials


@pytest.fixture(autouse=True)
def reset_store() -> None:
    """Clear the in-memory trial store before each test."""
    _trials.clear()
    yield
    _trials.clear()


@pytest.fixture
def server() -> ExperimentServer:
    return ExperimentServer("experiment")


class TestExperimentServer:
    def test_get_tools_returns_four_tools(self, server: ExperimentServer) -> None:
        tools = server.get_tools()
        assert len(tools) == 4
        names = {t["name"] for t in tools}
        assert "experiment.submit" in names
        assert "experiment.status" in names
        assert "experiment.cancel" in names
        assert "experiment.list" in names

    @pytest.mark.asyncio
    async def test_submit_returns_trial_id_and_status(self, server: ExperimentServer) -> None:
        with patch.object(server, "_emit"):
            result = await server.handle_tool(
                "experiment.submit",
                {"config": {"lr": 0.001, "epochs": 10}},
            )
        assert result["ok"] is True
        data = result["data"]
        assert "trial_id" in data
        assert data["trial_id"].startswith("trial_")
        assert data["status"] == "pending"

    @pytest.mark.asyncio
    async def test_submit_then_status_round_trip(self, server: ExperimentServer) -> None:
        with patch.object(server, "_emit"):
            submit_result = await server.handle_tool(
                "experiment.submit",
                {"config": {"optimizer": "adam"}},
            )
        trial_id = submit_result["data"]["trial_id"]

        with patch.object(server, "_emit"):
            status_result = await server.handle_tool(
                "experiment.status",
                {"trial_id": trial_id},
            )
        assert status_result["ok"] is True
        assert status_result["data"]["trial_id"] == trial_id
        assert status_result["data"]["status"] == "pending"

    @pytest.mark.asyncio
    async def test_status_nonexistent_returns_error(self, server: ExperimentServer) -> None:
        with patch.object(server, "_emit"):
            result = await server.handle_tool(
                "experiment.status",
                {"trial_id": "does_not_exist"},
            )
        assert result["ok"] is False
        assert "not found" in result["error"]

    @pytest.mark.asyncio
    async def test_cancel_marks_trial_cancelled(self, server: ExperimentServer) -> None:
        with patch.object(server, "_emit"):
            submit_result = await server.handle_tool(
                "experiment.submit",
                {"config": {"lr": 0.01}},
            )
        trial_id = submit_result["data"]["trial_id"]

        with patch.object(server, "_emit"):
            cancel_result = await server.handle_tool(
                "experiment.cancel",
                {"trial_id": trial_id},
            )
        assert cancel_result["ok"] is True
        assert cancel_result["data"]["cancelled"] is True

        with patch.object(server, "_emit"):
            status_result = await server.handle_tool(
                "experiment.status",
                {"trial_id": trial_id},
            )
        assert status_result["data"]["status"] == "cancelled"

    @pytest.mark.asyncio
    async def test_cancel_nonexistent_returns_error(self, server: ExperimentServer) -> None:
        with patch.object(server, "_emit"):
            result = await server.handle_tool(
                "experiment.cancel",
                {"trial_id": "nonexistent_trial"},
            )
        assert result["ok"] is False
        assert "not found" in result["error"]

    @pytest.mark.asyncio
    async def test_list_returns_all_trials(self, server: ExperimentServer) -> None:
        with patch.object(server, "_emit"):
            await server.handle_tool(
                "experiment.submit",
                {"config": {"trial": "A"}},
            )
            await server.handle_tool(
                "experiment.submit",
                {"config": {"trial": "B"}},
            )

        with patch.object(server, "_emit"):
            result = await server.handle_tool("experiment.list", {})
        assert result["ok"] is True
        trials = result["data"]["trials"]
        assert len(trials) == 2

    @pytest.mark.asyncio
    async def test_policy_denied_returns_error(self, server: ExperimentServer) -> None:
        with patch.object(server, "check_policy", return_value=False):
            result = await server.handle_tool(
                "experiment.submit",
                {"config": {"test": True}},
            )
        assert result["ok"] is False
        assert "denied" in result["error"]

