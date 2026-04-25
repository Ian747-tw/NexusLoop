"""mcps.skill.tests.test_skill_mcp — unit tests for skill MCP server."""
from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

from mcps.skill.server import SkillMCPServer


class TestSkillMCPServer:
    """Tests for skill MCP server."""

    def test_list_skills_returns_available_skills(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            project_dir = Path(tmpdir)
            skills_dir = project_dir / "skills"
            skills_dir.mkdir()
            # Create a sample skill file
            skill_yaml = skills_dir / "test_skill.yaml"
            skill_yaml.write_text(
                "name: test_skill\n"
                "description: A test skill\n"
                "triggers:\n  - manual\n"
                "inputs: {}\n"
                "outputs: {}\n"
                "steps: []\n"
            )
            server = SkillMCPServer(project_dir=project_dir)
            result = asyncio.run(server.handle_tool("skill.list", {}))
            assert result["ok"] is True
            data = result["data"]  # type: ignore[index]
            # Should find test_skill (not _schema which starts with _)
            names = [s["name"] for s in data]
            assert "test_skill" in names

    def test_list_skills_empty_dir_returns_empty_list(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            skills_dir = Path(tmpdir)
            server = SkillMCPServer(project_dir=skills_dir)
            result = asyncio.run(server.handle_tool("skill.list", {}))
            assert result["ok"] is True
            data = result["data"]  # type: ignore[index]
            assert data == []

    def test_get_definition_returns_yaml_content(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            project_dir = Path(tmpdir)
            skills_dir = project_dir / "skills"
            skills_dir.mkdir()
            skill_yaml = skills_dir / "my_skill.yaml"
            skill_yaml.write_text(
                "name: my_skill\n"
                "description: My skill description\n"
                "triggers:\n  - manual\n"
                "inputs: {num: int}\n"
                "outputs: {result: str}\n"
                "steps:\n  - action: do_something\n"
                "    args: {}\n"
            )
            server = SkillMCPServer(project_dir=project_dir)
            result = asyncio.run(server.handle_tool(
                "skill.get_definition", {"skill_name": "my_skill"}
            ))
            assert result["ok"] is True
            data = result["data"]  # type: ignore[index]
            assert data["name"] == "my_skill"
            assert data["description"] == "My skill description"

    def test_get_definition_missing_skill_returns_empty_dict(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            skills_dir = Path(tmpdir)
            server = SkillMCPServer(project_dir=skills_dir)
            result = asyncio.run(server.handle_tool(
                "skill.get_definition", {"skill_name": "nonexistent"}
            ))
            assert result["ok"] is True
            data = result["data"]  # type: ignore[index]
            assert data == {}

    def test_register_emits_skill_registered_event(self) -> None:
        server = SkillMCPServer()
        definition = {
            "name": "new_skill",
            "description": "A newly registered skill",
            "triggers": ["manual"],
            "inputs": {},
            "outputs": {},
            "steps": [],
        }
        result = asyncio.run(server.handle_tool(
            "skill.register",
            {"skill_name": "new_skill", "definition": definition}
        ))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert data["skill_name"] == "new_skill"
        assert data["registered"] is True

    def test_get_tools_returns_three_tools(self) -> None:
        server = SkillMCPServer()
        tools = server.get_tools()
        assert len(tools) == 3
        names = {t["name"] for t in tools}
        assert names == {"skill.list", "skill.get_definition", "skill.register"}

    def test_handle_tool_unknown_returns_error(self) -> None:
        server = SkillMCPServer()
        result = asyncio.run(server.handle_tool("skill.unknown", {}))
        assert result["ok"] is False