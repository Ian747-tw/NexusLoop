"""mcps.spec.tests.test_unit — unit tests for spec MCP."""
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from mcps.spec.server import SpecMCPServer, get_project, get_operations


class TestSpecMCPServer:
    """Tests for spec MCP server."""

    def test_get_project_returns_empty_when_no_project_yaml(self, tmp_path: Path) -> None:
        server = SpecMCPServer(tmp_path)
        result = server._get_project()
        assert result == {"name": "", "mode": "", "metric": ""}

    def test_get_project_parses_valid_yaml(self, tmp_path: Path) -> None:
        (tmp_path / "project.yaml").write_text(
            "name: test-project\nmode: explore\nmetric: reward\n"
        )
        server = SpecMCPServer(tmp_path)
        result = server._get_project()
        assert result == {"name": "test-project", "mode": "explore", "metric": "reward"}

    def test_get_project_handles_missing_fields(self, tmp_path: Path) -> None:
        (tmp_path / "project.yaml").write_text("name: only-name\n")
        server = SpecMCPServer(tmp_path)
        result = server._get_project()
        assert result["name"] == "only-name"
        assert result["mode"] == ""
        assert result["metric"] == ""

    def test_get_operations_returns_none_when_no_operations(self, tmp_path: Path) -> None:
        server = SpecMCPServer(tmp_path)
        result = server._get_operations()
        assert result == {"default_provider": None}

    def test_get_operations_parses_operations_section(self, tmp_path: Path) -> None:
        (tmp_path / "project.yaml").write_text(
            "operations:\n  default_provider: anthropic\n"
        )
        server = SpecMCPServer(tmp_path)
        result = server._get_operations()
        assert result == {"default_provider": "anthropic"}

    def test_get_tools_returns_two_tools(self) -> None:
        server = SpecMCPServer()
        tools = server.get_tools()
        assert len(tools) == 2
        names = {t["name"] for t in tools}
        assert names == {"spec.get_project", "spec.get_operations"}

    def test_handle_tool_dispatches_correctly(self) -> None:
        import asyncio
        server = SpecMCPServer()
        result = asyncio.run(server.handle_tool("spec.get_project", {}))
        assert result["ok"] is True
        assert "name" in result["data"]

    def test_handle_tool_unknown_returns_error(self) -> None:
        import asyncio
        server = SpecMCPServer()
        result = asyncio.run(server.handle_tool("spec.unknown", {}))
        assert result["ok"] is False


class TestConvenienceWrappers:
    """Tests for top-level convenience functions."""

    def test_get_project_empty_project_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = get_project(Path(tmp))
            assert result == {"name": "", "mode": "", "metric": ""}

    def test_get_operations_with_yaml(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            (p / "project.yaml").write_text("operations:\n  default_provider: openai\n")
            result = get_operations(p)
            assert result["default_provider"] == "openai"