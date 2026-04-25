"""mcps.calibration.tests.test_calibration_mcp — unit tests for calibration MCP server."""
from __future__ import annotations

import asyncio

from mcps.calibration.server import CalibrationMCPServer


class TestCalibrationMCPServer:
    """Tests for calibration MCP server."""

    def test_record_stores_calibration_point(self) -> None:
        server = CalibrationMCPServer()
        result = asyncio.run(server.handle_tool(
            "calibration.record",
            {
                "hypothesis_id": "hyp-1",
                "confidence": 0.85,
                "actual_outcome": "success",
            },
        ))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert data["confidence"] == 0.85
        assert data["actual_outcome"] == "success"
        assert "timestamp" in data

    def test_record_multiple_points_for_same_hypothesis(self) -> None:
        server = CalibrationMCPServer()
        for confidence in [0.9, 0.7, 0.5]:
            asyncio.run(server.handle_tool(
                "calibration.record",
                {
                    "hypothesis_id": "hyp-1",
                    "confidence": confidence,
                    "actual_outcome": "success",
                },
            ))
        result = asyncio.run(server.handle_tool(
            "calibration.get",
            {"hypothesis_id": "hyp-1"},
        ))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert len(data["history"]) == 3

    def test_get_empty_for_unknown_hypothesis(self) -> None:
        server = CalibrationMCPServer()
        result = asyncio.run(server.handle_tool(
            "calibration.get",
            {"hypothesis_id": "unknown"},
        ))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert data["history"] == []

    def test_check_tier_emits_event_on_tier_change(self) -> None:
        server = CalibrationMCPServer()
        # Record a point first
        asyncio.run(server.handle_tool(
            "calibration.record",
            {
                "hypothesis_id": "hyp-1",
                "confidence": 0.85,
                "actual_outcome": "success",
            },
        ))
        # check_tier on the same hypothesis — should NOT change tier on first call
        result = asyncio.run(server.handle_tool(
            "calibration.check_tier",
            {"hypothesis_id": "hyp-1"},
        ))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert data["changed"] is False

    def test_check_tier_unknown_hypothesis_returns_default_tier(self) -> None:
        server = CalibrationMCPServer()
        result = asyncio.run(server.handle_tool(
            "calibration.check_tier",
            {"hypothesis_id": "hyp-unknown"},
        ))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert data["tier"] == "soft"
        assert data["changed"] is False

    def test_get_tools_returns_three_tools(self) -> None:
        server = CalibrationMCPServer()
        tools = server.get_tools()
        assert len(tools) == 3
        names = {t["name"] for t in tools}
        assert names == {"calibration.record", "calibration.get", "calibration.check_tier"}

    def test_handle_tool_unknown_returns_error(self) -> None:
        server = CalibrationMCPServer()
        result = asyncio.run(server.handle_tool("calibration.unknown", {}))
        assert result["ok"] is False
