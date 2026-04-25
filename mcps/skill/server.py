"""mcps.skill.server — SkillMCPServer implementation."""
from __future__ import annotations

import yaml
from pathlib import Path
from typing import Any

from mcps._shared.base import BaseMCPServer
from nxl_core.events.singletons import journal_log
from nxl_core.events.schema import SkillRegistered


class SkillMCPServer(BaseMCPServer):
    """MCP server for listing, retrieving, and registering YAML skills."""

    def __init__(self, project_dir: Path | None = None) -> None:
        super().__init__("skill")
        self._project_dir = project_dir or Path.cwd()
        self._skills_dir = self._project_dir / "skills"

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "name": "skill.list",
                "description": "List all available skills from the skills/ directory.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": False,
                },
            },
            {
                "name": "skill.get_definition",
                "description": "Get the full skill definition YAML for a named skill.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "skill_name": {
                            "type": "string",
                            "description": "Name of the skill to retrieve.",
                        },
                    },
                    "required": ["skill_name"],
                    "additionalProperties": False,
                },
            },
            {
                "name": "skill.register",
                "description": "Register a new skill (emit SkillRegistered event).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "skill_name": {
                            "type": "string",
                            "description": "Name of the skill to register.",
                        },
                        "definition": {
                            "type": "object",
                            "description": "Full skill definition dictionary.",
                        },
                    },
                    "required": ["skill_name", "definition"],
                    "additionalProperties": False,
                },
            },
        ]

    async def handle_tool(
        self, tool_name: str, args: dict[str, Any]
    ) -> dict[str, Any]:
        self.emit_tool_requested(tool_name, args)
        decision = self._policy.check(tool_name, args)
        if not decision.allowed:
            return {"ok": False, "error": f"Policy denied: {decision.reason}"}

        if tool_name == "skill.list":
            return {"ok": True, "data": self._list_skills()}
        elif tool_name == "skill.get_definition":
            return {"ok": True, "data": self._get_definition(args["skill_name"])}
        elif tool_name == "skill.register":
            return {"ok": True, "data": self._register_skill(args["skill_name"], args["definition"])}
        else:
            return {"ok": False, "error": f"Unknown tool: {tool_name}"}

    def _list_skills(self) -> list[dict[str, str]]:
        """List all available skills from the skills/ directory."""
        if not self._skills_dir.is_dir():
            return []
        skills = []
        for path in sorted(self._skills_dir.iterdir()):
            if path.suffix == ".yaml" and not path.name.startswith("_"):
                skill_name = path.stem
                try:
                    with path.open() as fh:
                        data = yaml.safe_load(fh) or {}
                    skills.append({
                        "name": skill_name,
                        "description": data.get("description", ""),
                        "file": str(path.name),
                    })
                except Exception:
                    skills.append({
                        "name": skill_name,
                        "description": "",
                        "file": str(path.name),
                    })
        return skills

    def _get_definition(self, skill_name: str) -> dict[str, Any]:
        """Get the full skill definition YAML for a named skill."""
        skill_file = self._skills_dir / f"{skill_name}.yaml"
        if not skill_file.exists():
            return {}
        with skill_file.open() as fh:
            return yaml.safe_load(fh) or {}

    def _register_skill(self, skill_name: str, definition: dict) -> dict[str, Any]:
        """Register a new skill by emitting a SkillRegistered event."""
        event_log = journal_log()
        event_log.append(SkillRegistered(skill_name=skill_name, skill_def=definition))
        return {"skill_name": skill_name, "registered": True}