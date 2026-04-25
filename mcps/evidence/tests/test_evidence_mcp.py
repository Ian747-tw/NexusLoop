"""mcps.evidence.tests.test_evidence_mcp — unit tests for evidence MCP server."""
from __future__ import annotations

import asyncio

from mcps.evidence.server import EvidenceMCPServer


class TestEvidenceMCPServer:
    """Tests for evidence MCP server."""

    def test_record_scalar_metric_emits_event(self) -> None:
        server = EvidenceMCPServer()
        result = asyncio.run(server.handle_tool(
            "evidence.record",
            {"trial_id": "trial-1", "evidence_type": "scalar_metric", "value": 0.95}
        ))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert "event_id" in data

    def test_record_ordering_preference_emits_event(self) -> None:
        server = EvidenceMCPServer()
        result = asyncio.run(server.handle_tool(
            "evidence.record",
            {"trial_id": "trial-1", "evidence_type": "ordering_preference", "value": "A > B"}
        ))
        assert result["ok"] is True

    def test_record_rubric_emits_event(self) -> None:
        server = EvidenceMCPServer()
        result = asyncio.run(server.handle_tool(
            "evidence.record",
            {
                "trial_id": "trial-1",
                "evidence_type": "rubric",
                "value": {"correctness": 1.0, "clarity": 0.9},
            }
        ))
        assert result["ok"] is True

    def test_record_threshold_check_emits_event(self) -> None:
        server = EvidenceMCPServer()
        result = asyncio.run(server.handle_tool(
            "evidence.record",
            {"trial_id": "trial-1", "evidence_type": "threshold_check", "value": True}
        ))
        assert result["ok"] is True

    def test_record_distributional_emits_event(self) -> None:
        server = EvidenceMCPServer()
        result = asyncio.run(server.handle_tool(
            "evidence.record",
            {
                "trial_id": "trial-1",
                "evidence_type": "distributional",
                "value": {"mean": 0.7, "std": 0.15},
            }
        ))
        assert result["ok"] is True

    def test_record_informational_emits_event(self) -> None:
        server = EvidenceMCPServer()
        result = asyncio.run(server.handle_tool(
            "evidence.record",
            {"trial_id": "trial-1", "evidence_type": "informational", "value": "note"}
        ))
        assert result["ok"] is True

    def test_list_returns_records_for_trial(self) -> None:
        server = EvidenceMCPServer()
        # Record two evidence items for trial-2
        asyncio.run(server.handle_tool(
            "evidence.record",
            {"trial_id": "trial-2", "evidence_type": "scalar_metric", "value": 0.8}
        ))
        asyncio.run(server.handle_tool(
            "evidence.record",
            {"trial_id": "trial-2", "evidence_type": "rubric", "value": {"score": 0.9}}
        ))
        # Record one for trial-3
        asyncio.run(server.handle_tool(
            "evidence.record",
            {"trial_id": "trial-3", "evidence_type": "informational", "value": "note"}
        ))

        result = asyncio.run(server.handle_tool(
            "evidence.list",
            {"trial_id": "trial-2"}
        ))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert data["trial_id"] == "trial-2"
        assert len(data["records"]) == 2

    def test_list_empty_for_unknown_trial(self) -> None:
        server = EvidenceMCPServer()
        result = asyncio.run(server.handle_tool(
            "evidence.list",
            {"trial_id": "nonexistent-trial"}
        ))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert data["records"] == []

    def test_get_tools_returns_two_tools(self) -> None:
        server = EvidenceMCPServer()
        tools = server.get_tools()
        assert len(tools) == 2
        names = {t["name"] for t in tools}
        assert names == {"evidence.record", "evidence.list"}

    def test_handle_tool_unknown_returns_error(self) -> None:
        server = EvidenceMCPServer()
        result = asyncio.run(server.handle_tool("evidence.unknown", {}))
        assert result["ok"] is False