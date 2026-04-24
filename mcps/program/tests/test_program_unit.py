"""mcps.program.tests.test_unit — unit tests for program MCP."""
from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path

import pytest

from mcps.program.server import ProgramMCPServer, get_state, get_queue


class TestProgramMCPServer:
    """Tests for program MCP server."""

    def test_get_state_returns_defaults_when_no_state_file(self, tmp_path: Path) -> None:
        server = ProgramMCPServer(tmp_path)
        result = server._get_state()
        assert result["phase"] == "research"
        assert result["step"] == 0
        assert result["status"] == "idle"

    def test_get_state_parses_state_file(self, tmp_path: Path) -> None:
        # Create .nxl directory and state.json
        nxl_dir = tmp_path / ".nxl"
        nxl_dir.mkdir()
        state_path = nxl_dir / "state.json"
        state_path.write_text(json.dumps({
            "current_phase": "experimenting",
            "queue": [{"run_id": "r1", "config": {}}],
        }))
        server = ProgramMCPServer(tmp_path)
        result = server._get_state()
        assert result["phase"] == "experimenting"
        assert result["status"] == "running"

    def test_get_queue_returns_queue_from_state(self, tmp_path: Path) -> None:
        nxl_dir = tmp_path / ".nxl"
        nxl_dir.mkdir()
        state_path = nxl_dir / "state.json"
        state_path.write_text(json.dumps({
            "queue": [{"run_id": "r1"}, {"run_id": "r2"}],
        }))
        server = ProgramMCPServer(tmp_path)
        result = server._get_queue()
        assert len(result["queue"]) == 2

    def test_get_queue_returns_empty_when_no_queue(self, tmp_path: Path) -> None:
        nxl_dir = tmp_path / ".nxl"
        nxl_dir.mkdir()
        state_path = nxl_dir / "state.json"
        state_path.write_text(json.dumps({}))
        server = ProgramMCPServer(tmp_path)
        result = server._get_queue()
        assert result["queue"] == []

    def test_handle_tool_dispatches_correctly(self) -> None:
        server = ProgramMCPServer()
        result = asyncio.run(server.handle_tool("program.get_state", {}))
        assert result["ok"] is True
        assert "phase" in result["data"]

    def test_handle_tool_unknown_returns_error(self) -> None:
        server = ProgramMCPServer()
        result = asyncio.run(server.handle_tool("program.unknown", {}))
        assert result["ok"] is False

    def test_get_tools_returns_two_tools(self) -> None:
        server = ProgramMCPServer()
        tools = server.get_tools()
        assert len(tools) == 2
        names = {t["name"] for t in tools}
        assert names == {"program.get_state", "program.get_queue"}


class TestConvenienceWrappers:
    """Tests for top-level convenience functions."""

    def test_get_state_empty_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = get_state(Path(tmp))
            assert result["phase"] == "research"

    def test_get_queue_empty_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = get_queue(Path(tmp))
            assert result["queue"] == []