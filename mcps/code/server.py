"""mcps.code.server — CodeMCP implementation."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from mcps._shared.base import BaseMCPServer

from .requests import CodeEditFile, CodeListFiles, CodeReadFile, CodeSearch


class CodeMCP(BaseMCPServer):
    """MCP for scoped read/edit of project files. Never deletes."""

    def __init__(self, project_root: Path | None = None) -> None:
        super().__init__("code")
        self.project_root = project_root or Path.cwd()

    # ------------------------------------------------------------------
    # Tool definitions
    # ------------------------------------------------------------------

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "name": "code.read_file",
                "description": "Read contents of a file within the project.",
                "inputSchema": {
                    "type": "object",
                    "properties": {"path": {"type": "string"}},
                    "required": ["path"],
                },
            },
            {
                "name": "code.list_files",
                "description": "List files matching a glob pattern within the project.",
                "inputSchema": {
                    "type": "object",
                    "properties": {"glob_pattern": {"type": "string"}},
                    "required": ["glob_pattern"],
                },
            },
            {
                "name": "code.edit_file",
                "description": "Edit a file by replacing exact text.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "old_text": {"type": "string"},
                        "new_text": {"type": "string"},
                    },
                    "required": ["path", "old_text", "new_text"],
                },
            },
            {
                "name": "code.search",
                "description": "Search for lines matching a query.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "path_filter": {"type": "string"},
                    },
                    "required": ["query"],
                },
            },
        ]

    # ------------------------------------------------------------------
    # Handler
    # ------------------------------------------------------------------

    async def handle_tool(
        self, tool_name: str, args: dict[str, Any]
    ) -> dict[str, Any]:
        decision = self._policy.check(tool_name, args)
        if not decision.allowed:
            return {"ok": False, "error": f"Policy denied: {decision.reason}"}

        if tool_name == "code.read_file":
            return await self._read_file(CodeReadFile(**args))
        if tool_name == "code.list_files":
            return await self._list_files(CodeListFiles(**args))
        if tool_name == "code.edit_file":
            return await self._edit_file(CodeEditFile(**args))
        if tool_name == "code.search":
            return await self._search(CodeSearch(**args))
        return {"ok": False, "error": f"Unknown tool: {tool_name}"}

    # ------------------------------------------------------------------
    # Path helpers
    # ------------------------------------------------------------------

    def _resolve(self, rel_path: str) -> Path:
        """Resolve a relative path within project root; reject anything outside."""
        abs_path = (self.project_root / rel_path).resolve()
        if not str(abs_path).startswith(str(self.project_root.resolve())):
            raise ValueError(f"Path '{rel_path}' is outside project root")
        return abs_path

    # ------------------------------------------------------------------
    # Tool implementations
    # ------------------------------------------------------------------

    async def _read_file(self, req: CodeReadFile) -> dict[str, Any]:
        try:
            path = self._resolve(req.path)
            content = path.read_text(encoding="utf-8")
            lines = content.count("\n") + (1 if content and not content.endswith("\n") else 0)
            return {"ok": True, "data": {"content": content, "lines": lines}}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def _list_files(self, req: CodeListFiles) -> dict[str, Any]:
        try:
            matches: list[str] = []
            for p in self.project_root.rglob(req.glob_pattern):
                if p.is_file() and str(p).startswith(str(self.project_root.resolve())):
                    matches.append(str(p.relative_to(self.project_root)))
            return {"ok": True, "data": {"paths": sorted(matches)}}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def _edit_file(self, req: CodeEditFile) -> dict[str, Any]:
        try:
            path = self._resolve(req.path)
            original = path.read_text(encoding="utf-8")
            if req.old_text not in original:
                return {"ok": False, "error": "old_text not found in file"}
            new_content = original.replace(req.old_text, req.new_text, 1)
            path.write_text(new_content, encoding="utf-8")
            # Count changed lines
            old_lines = original.count("\n")
            new_lines = new_content.count("\n")
            return {"ok": True, "data": {"success": True, "lines_changed": abs(new_lines - old_lines)}}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def _search(self, req: CodeSearch) -> dict[str, Any]:
        try:
            pattern = re.compile(re.escape(req.query), re.IGNORECASE)
            matches: list[str] = []
            search_root = self.project_root
            if req.path_filter:
                search_root = self._resolve(req.path_filter)
            for p in search_root.rglob("*"):
                if p.is_file() and not p.is_dir():
                    try:
                        text = p.read_text(encoding="utf-8")
                        for line_no, line in enumerate(text.splitlines(), 1):
                            if pattern.search(line):
                                matches.append(f"{p}:{line_no}: {line.rstrip()}")
                    except Exception:
                        continue
            return {"ok": True, "data": {"matches": matches}}
        except Exception as e:
            return {"ok": False, "error": str(e)}