"""mcps.trial.tests.test_trial_mcp — unit tests for trial MCP server."""
from __future__ import annotations

import asyncio

from mcps.trial.server import TrialMCPServer, VALID_TRIAL_KINDS


class TestTrialMCPServer:
    """Tests for trial MCP server."""

    def test_start_emits_trial_started_event(self) -> None:
        server = TrialMCPServer()
        result = asyncio.run(server.handle_tool(
            "trial.start",
            {
                "trial_id": "trial-1",
                "hypothesis_id": "hyp-1",
                "trial_kind": "baseline",
                "config": {"iterations": 10},
            }
        ))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert "event_id" in data

    def test_start_all_11_trial_kinds_accepted(self) -> None:
        server = TrialMCPServer()
        for kind in VALID_TRIAL_KINDS:
            result = asyncio.run(server.handle_tool(
                "trial.start",
                {"trial_id": f"trial-{kind}", "hypothesis_id": "hyp-1", "trial_kind": kind}
            ))
            assert result["ok"] is True, f"trial_kind {kind} should be accepted"

    def test_start_invalid_trial_kind_rejected(self) -> None:
        server = TrialMCPServer()
        result = asyncio.run(server.handle_tool(
            "trial.start",
            {"trial_id": "trial-1", "hypothesis_id": "hyp-1", "trial_kind": "not_a_kind"}
        ))
        assert result["ok"] is False
        assert "Invalid trial_kind" in result["error"]  # type: ignore[index]

    def test_complete_emits_trial_completed_event(self) -> None:
        server = TrialMCPServer()
        # Start a trial first
        asyncio.run(server.handle_tool(
            "trial.start",
            {"trial_id": "trial-1", "hypothesis_id": "hyp-1", "trial_kind": "baseline"}
        ))
        # Complete it
        result = asyncio.run(server.handle_tool(
            "trial.complete",
            {"trial_id": "trial-1", "metrics": {"accuracy": 0.95}}
        ))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert "event_id" in data

    def test_complete_unknown_trial_returns_error(self) -> None:
        server = TrialMCPServer()
        result = asyncio.run(server.handle_tool(
            "trial.complete",
            {"trial_id": "nonexistent", "metrics": {}}
        ))
        assert result["ok"] is False
        assert "Unknown trial_id" in result["error"]  # type: ignore[index]

    def test_fail_emits_trial_failed_event(self) -> None:
        server = TrialMCPServer()
        # Start a trial first
        asyncio.run(server.handle_tool(
            "trial.start",
            {"trial_id": "trial-1", "hypothesis_id": "hyp-1", "trial_kind": "baseline"}
        ))
        # Fail it
        result = asyncio.run(server.handle_tool(
            "trial.fail",
            {"trial_id": "trial-1", "reason": "crash"}
        ))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert "event_id" in data

    def test_fail_unknown_trial_returns_error(self) -> None:
        server = TrialMCPServer()
        result = asyncio.run(server.handle_tool(
            "trial.fail",
            {"trial_id": "nonexistent", "reason": "crash"}
        ))
        assert result["ok"] is False
        assert "Unknown trial_id" in result["error"]  # type: ignore[index]

    def test_list_empty_for_new_server(self) -> None:
        server = TrialMCPServer()
        result = asyncio.run(server.handle_tool("trial.list", {}))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert data["trials"] == []

    def test_list_returns_started_trials(self) -> None:
        server = TrialMCPServer()
        asyncio.run(server.handle_tool(
            "trial.start",
            {"trial_id": "trial-1", "hypothesis_id": "hyp-1", "trial_kind": "baseline"}
        ))
        asyncio.run(server.handle_tool(
            "trial.start",
            {"trial_id": "trial-2", "hypothesis_id": "hyp-2", "trial_kind": "ablation"}
        ))

        result = asyncio.run(server.handle_tool("trial.list", {}))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert len(data["trials"]) == 2

    def test_list_filters_by_hypothesis_id(self) -> None:
        server = TrialMCPServer()
        asyncio.run(server.handle_tool(
            "trial.start",
            {"trial_id": "trial-1", "hypothesis_id": "hyp-1", "trial_kind": "baseline"}
        ))
        asyncio.run(server.handle_tool(
            "trial.start",
            {"trial_id": "trial-2", "hypothesis_id": "hyp-2", "trial_kind": "ablation"}
        ))

        result = asyncio.run(server.handle_tool(
            "trial.list",
            {"hypothesis_id": "hyp-1"}
        ))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert len(data["trials"]) == 1
        assert data["trials"][0]["hypothesis_id"] == "hyp-1"

    def test_list_shows_status_after_complete(self) -> None:
        server = TrialMCPServer()
        asyncio.run(server.handle_tool(
            "trial.start",
            {"trial_id": "trial-1", "hypothesis_id": "hyp-1", "trial_kind": "baseline"}
        ))
        asyncio.run(server.handle_tool(
            "trial.complete",
            {"trial_id": "trial-1", "metrics": {}}
        ))

        result = asyncio.run(server.handle_tool("trial.list", {}))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert data["trials"][0]["status"] == "completed"

    def test_list_shows_status_after_fail(self) -> None:
        server = TrialMCPServer()
        asyncio.run(server.handle_tool(
            "trial.start",
            {"trial_id": "trial-1", "hypothesis_id": "hyp-1", "trial_kind": "baseline"}
        ))
        asyncio.run(server.handle_tool(
            "trial.fail",
            {"trial_id": "trial-1", "reason": "crash"}
        ))

        result = asyncio.run(server.handle_tool("trial.list", {}))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert data["trials"][0]["status"] == "failed"

    def test_get_tools_returns_four_tools(self) -> None:
        server = TrialMCPServer()
        tools = server.get_tools()
        assert len(tools) == 4
        names = {t["name"] for t in tools}
        assert names == {"trial.start", "trial.complete", "trial.fail", "trial.list"}

    def test_handle_tool_unknown_returns_error(self) -> None:
        server = TrialMCPServer()
        result = asyncio.run(server.handle_tool("trial.unknown", {}))
        assert result["ok"] is False