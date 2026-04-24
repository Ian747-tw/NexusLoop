"""mcps.inbox — read pending human directives from .nxl/inbox/."""
from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel

from mcps._shared.base import BaseMCPServer


class ListResponse(BaseModel):
    directives: list[dict]


class GetResponse(BaseModel):
    directive_id: str
    content: str
    created_at: str | None = None


class InboxMCPServer(BaseMCPServer):
    """Read pending human directives from .nxl/inbox/."""

    def __init__(self, inbox_dir: Path | None = None) -> None:
        super().__init__("inbox")
        self._inbox_dir = inbox_dir or Path.cwd() / ".nxl" / "inbox"

    def get_tools(self) -> list[dict[str, object]]:
        return [
            {
                "name": "inbox.list",
                "description": "Return list of pending directives from .nxl/inbox/",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": False,
                },
            },
            {
                "name": "inbox.get",
                "description": "Return a single directive's content by ID",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "directive_id": {
                            "type": "string",
                            "description": "Directive ID (filename without extension)",
                        },
                    },
                    "required": ["directive_id"],
                    "additionalProperties": False,
                },
            },
        ]

    async def handle_tool(self, tool_name: str, args: dict[str, object]) -> dict[str, object]:
        self.emit_tool_requested(tool_name, args)
        decision = self._policy.check(tool_name, args)
        if not decision.allowed:
            return {"ok": False, "error": f"Policy denied: {decision.reason}"}
        if tool_name == "inbox.list":
            return {"ok": True, "data": self._list()}
        elif tool_name == "inbox.get":
            directive_id = str(args.get("directive_id", ""))
            return {"ok": True, "data": self._get(directive_id)}
        else:
            return {"ok": False, "error": f"Unknown tool: {tool_name}"}

    def _list(self) -> dict[str, object]:
        inbox_path = Path(self._inbox_dir)
        if not inbox_path.is_dir():
            return {"directives": []}

        directives = []
        for file_path in inbox_path.iterdir():
            if file_path.is_file() and not file_path.name.startswith("."):
                directives.append({
                    "directive_id": file_path.stem,
                    "filename": file_path.name,
                })
        return {"directives": directives}

    def _get(self, directive_id: str) -> dict[str, object]:
        inbox_path = Path(self._inbox_dir)
        # Try common extensions
        for ext in ("", ".txt", ".md", ".nxl"):
            file_path = inbox_path / f"{directive_id}{ext}"
            if file_path.is_file():
                content = file_path.read_text(encoding="utf-8")
                return {
                    "directive_id": directive_id,
                    "content": content,
                    "filename": file_path.name,
                }
        return {"directive_id": directive_id, "content": "", "error": "not found"}


# Convenience synchronous wrappers
def list_directives(inbox_dir: Path | None = None) -> list[dict]:
    server = InboxMCPServer(inbox_dir)
    result = server._list()
    return result.get("directives", [])


def get_directive(directive_id: str, inbox_dir: Path | None = None) -> dict:
    server = InboxMCPServer(inbox_dir)
    return server._get(directive_id)