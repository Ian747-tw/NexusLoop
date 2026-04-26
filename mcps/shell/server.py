"""mcps.shell.server — TTL-bounded shell command execution."""
from __future__ import annotations

import subprocess
import time
from pathlib import Path
from typing import Any

from mcps._shared.base import BaseMCPServer

from .requests import ShellExec


class ShellMCP(BaseMCPServer):
    """Shell command execution with TTL and cwd restrictions."""

    def __init__(self, project_root: Path | None = None) -> None:
        super().__init__("shell")
        self.project_root = project_root or Path.cwd()

    # ------------------------------------------------------------------
    # Tool definitions
    # ------------------------------------------------------------------

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "name": "shell.exec",
                "description": "Execute a shell command with TTL and cwd restrictions.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "cmd": {
                            "type": "string",
                            "description": "Shell command to execute",
                        },
                        "ttl": {
                            "type": "integer",
                            "default": 300,
                            "description": "Time-to-live in seconds (max 300)",
                        },
                        "cwd": {
                            "type": "string",
                            "description": "Working directory for the command",
                        },
                        "tag": {
                            "type": "string",
                            "description": "Tag for the shell session",
                        },
                        "capture": {
                            "type": "boolean",
                            "default": True,
                            "description": "Whether to capture and return output",
                        },
                    },
                    "required": ["cmd"],
                },
            },
        ]

    # ------------------------------------------------------------------
    # Handler
    # ------------------------------------------------------------------

    async def handle_tool(
        self, tool_name: str, args: dict[str, Any]
    ) -> dict[str, Any]:
        # Policy gate
        decision = self._policy.check(tool_name, args)
        if not decision.allowed:
            return {
                "ok": False,
                "error": f"Policy denied: {decision.reason}",
                "cmd": args.get("cmd", ""),
            }

        if tool_name == "shell.exec":
            return await self._exec(ShellExec(**args))
        return {"ok": False, "error": f"Unknown tool: {tool_name}"}

    # ------------------------------------------------------------------
    # Tool implementations
    # ------------------------------------------------------------------

    async def _exec(self, req: ShellExec) -> dict[str, Any]:
        """Execute a shell command with TTL and cwd restrictions."""
        start_time = time.time()

        # Determine working directory
        if req.cwd:
            cwd = self._resolve_cwd(req.cwd)
        else:
            cwd = self.project_root

        try:
            result = subprocess.run(
                req.cmd,
                shell=True,
                cwd=str(cwd),
                capture_output=req.capture,
                text=True,
                timeout=min(req.ttl, 300),  # Hard cap at 300
            )
            duration_ms = int((time.time() - start_time) * 1000)

            return {
                "ok": result.returncode == 0,
                "cmd": req.cmd,
                "exit_code": result.returncode,
                "stdout": result.stdout if req.capture else None,
                "stderr": result.stderr if req.capture else None,
                "duration_ms": duration_ms,
            }
        except subprocess.TimeoutExpired:
            duration_ms = int((time.time() - start_time) * 1000)
            return {
                "ok": False,
                "cmd": req.cmd,
                "exit_code": -1,
                "stdout": None,
                "stderr": f"Command timed out after {req.ttl}s",
                "duration_ms": duration_ms,
                "error": f"Command timed out after {req.ttl}s",
            }
        except Exception as e:
            duration_ms = int((time.time() - start_time) * 1000)
            return {
                "ok": False,
                "cmd": req.cmd,
                "exit_code": -1,
                "stdout": None,
                "stderr": None,
                "duration_ms": duration_ms,
                "error": str(e),
            }

    # ------------------------------------------------------------------
    # Path helpers
    # ------------------------------------------------------------------

    def _resolve_cwd(self, cwd: str) -> Path:
        """Resolve cwd, must be inside scratch/* or project root."""
        abs_path = (self.project_root / cwd).resolve()
        # Security: cwd must be inside scratch/* or project root
        scratch_root = self.project_root / "scratch"
        if str(abs_path).startswith(str(scratch_root)) or str(abs_path).startswith(
            str(self.project_root)
        ):
            return abs_path
        raise ValueError(
            f"cwd '{cwd}' is outside scratch/ and project root"
        )
