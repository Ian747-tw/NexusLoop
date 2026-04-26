"""mcps.spec — read project.yaml and return pointers."""
from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel

from mcps._shared.base import BaseMCPServer


class GetProjectRequest(BaseModel):
    """No args required."""
    pass


class GetProjectResponse(BaseModel):
    name: str
    mode: str
    metric: str


class GetOperationsRequest(BaseModel):
    """No args required."""
    pass


class GetOperationsResponse(BaseModel):
    default_provider: str | None = None


class SpecMCPServer(BaseMCPServer):
    """Read project.yaml and return pointers."""

    def __init__(self, project_dir: Path | None = None) -> None:
        super().__init__("spec")
        self._project_dir = project_dir or Path.cwd()

    def get_tools(self) -> list[dict[str, object]]:
        return [
            {
                "name": "spec.get_project",
                "description": "Returns name, mode, metric from project.yaml",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": False,
                },
            },
            {
                "name": "spec.get_operations",
                "description": "Returns default_provider from operations section of project.yaml",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": False,
                },
            },
        ]

    async def handle_tool(self, tool_name: str, args: dict[str, object]) -> dict[str, object]:
        decision = self._policy.check(tool_name, args)
        if not decision.allowed:
            return {"ok": False, "error": f"Policy denied: {decision.reason}"}
        if tool_name == "spec.get_project":
            return {"ok": True, "data": self._get_project()}
        elif tool_name == "spec.get_operations":
            return {"ok": True, "data": self._get_operations()}
        else:
            return {"ok": False, "error": f"Unknown tool: {tool_name}"}

    def _get_project(self) -> dict[str, str]:
        import yaml
        project_yaml = self._project_dir / "project.yaml"
        if not project_yaml.exists():
            return {"name": "", "mode": "", "metric": ""}
        with project_yaml.open() as fh:
            data = yaml.safe_load(fh) or {}
        return {
            "name": data.get("name", ""),
            "mode": data.get("mode", ""),
            "metric": data.get("metric", ""),
        }

    def _get_operations(self) -> dict[str, object]:
        import yaml
        project_yaml = self._project_dir / "project.yaml"
        if not project_yaml.exists():
            return {"default_provider": None}
        with project_yaml.open() as fh:
            data = yaml.safe_load(fh) or {}
        ops = data.get("operations", {}) or {}
        return {"default_provider": ops.get("default_provider")}


# Convenience synchronous wrappers used by tests
def get_project(project_dir: Path | None = None) -> dict[str, str]:
    server = SpecMCPServer(project_dir)
    return server._get_project()  # type: ignore[return-value]


def get_operations(project_dir: Path | None = None) -> dict[str, object]:
    server = SpecMCPServer(project_dir)
    return server._get_operations()