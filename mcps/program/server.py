"""mcps.program — program state machine reads from .nxl/state.json."""
from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel

from mcps._shared.base import BaseMCPServer


class GetStateResponse(BaseModel):
    phase: str
    step: int
    status: str


class GetQueueResponse(BaseModel):
    queue: list[dict]


class ProgramMCPServer(BaseMCPServer):
    """Program state machine reads from .nxl/state.json via ProjectState."""

    def __init__(self, project_dir: Path | None = None) -> None:
        super().__init__("program")
        self._project_dir = project_dir or Path.cwd()

    def get_tools(self) -> list[dict[str, object]]:
        return [
            {
                "name": "program.get_state",
                "description": "Returns phase, step, status from .nxl/state.json",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": False,
                },
            },
            {
                "name": "program.get_queue",
                "description": "Returns pending experiments from state",
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
        if tool_name == "program.get_state":
            return {"ok": True, "data": self._get_state()}
        elif tool_name == "program.get_queue":
            return {"ok": True, "data": self._get_queue()}
        else:
            return {"ok": False, "error": f"Unknown tool: {tool_name}"}

    def _get_state(self) -> dict[str, object]:
        from nxl.core.state import ProjectState

        state = ProjectState.load(self._project_dir)
        return {
            "phase": state.current_phase,
            "step": 0,  # ProjectState doesn't have step; use 0 as placeholder
            "status": "running" if state.queue else "idle",
        }

    def _get_queue(self) -> dict[str, object]:
        from nxl.core.state import ProjectState

        state = ProjectState.load(self._project_dir)
        return {"queue": state.queue}


# Convenience synchronous wrappers
def get_state(project_dir: Path | None = None) -> dict[str, object]:
    server = ProgramMCPServer(project_dir)
    return server._get_state()


def get_queue(project_dir: Path | None = None) -> dict[str, object]:
    server = ProgramMCPServer(project_dir)
    return server._get_queue()