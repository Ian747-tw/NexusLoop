"""mcps.pkg.server — Package management via uv — project venv only, never global."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any

from mcps._shared.base import BaseMCPServer

from .requests import PkgAdd, PkgFreeze, PkgRemove


class PkgMCP(BaseMCPServer):
    """Package management via uv — project venv only, never global."""

    def __init__(self, project_root: Path | None = None) -> None:
        super().__init__("pkg")
        self.project_root = project_root or Path.cwd()

    # ------------------------------------------------------------------
    # Tool definitions
    # ------------------------------------------------------------------

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "name": "pkg.add",
                "description": "Add a package to the project venv via uv. "
                               "Only pypi registry is allowed.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "Package name from PyPI",
                        },
                        "version_spec": {
                            "type": "string",
                            "description": "Version specifier (e.g. '>=1.0.0', '==2.3.1')",
                        },
                        "registry": {
                            "type": "string",
                            "default": "pypi",
                            "description": "Package registry (only 'pypi' is allowed)",
                        },
                    },
                    "required": ["name"],
                },
            },
            {
                "name": "pkg.remove",
                "description": "Remove a package from the project venv via uv.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "Package name to remove",
                        },
                    },
                    "required": ["name"],
                },
            },
            {
                "name": "pkg.freeze",
                "description": "Return the lockfile diff as JSON.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                },
            },
        ]

    # ------------------------------------------------------------------
    # Handler
    # ------------------------------------------------------------------

    async def handle_tool(
        self, tool_name: str, args: dict[str, Any]
    ) -> dict[str, Any]:
        # Policy gate — passes capability_token context if present
        decision = self._policy.check(tool_name, args)
        if not decision.allowed:
            return {"ok": False, "error": f"Policy denied: {decision.reason}"}

        if tool_name == "pkg.add":
            return await self._add(PkgAdd(**args))
        if tool_name == "pkg.remove":
            return await self._remove(PkgRemove(**args))
        if tool_name == "pkg.freeze":
            return await self._freeze(PkgFreeze())
        return {"ok": False, "error": f"Unknown tool: {tool_name}"}

    # ------------------------------------------------------------------
    # Tool implementations
    # ------------------------------------------------------------------

    async def _add(self, req: PkgAdd) -> dict[str, Any]:
        """Add a package via `uv add` in the project venv."""
        # TODO: CapabilityToken check will be added in M2.4 when the API is finalized
        try:
            cmd = ["uv", "add", req.name]
            if req.version_spec:
                cmd.append(req.version_spec)

            # Run uv add in project venv
            result = subprocess.run(
                cmd,
                cwd=str(self.project_root),
                capture_output=True,
                text=True,
                timeout=120,
            )

            if result.returncode != 0:
                return {
                    "ok": False,
                    "error": f"uv add failed: {result.stderr}",
                    "package_name": req.name,
                }

            # Get lockfile diff
            lockfile_diff = self._get_lockfile_diff()

            # Postcondition: verify import works
            import_check = self._verify_import(req.name)
            if not import_check["ok"]:
                # Rollback: uv remove on failure
                subprocess.run(
                    ["uv", "remove", req.name],
                    cwd=str(self.project_root),
                    capture_output=True,
                    text=True,
                    timeout=60,
                )
                return {
                    "ok": False,
                    "error": f"Postcondition failed: {import_check['error']}. Package rolled back.",
                    "package_name": req.name,
                }

            return {
                "ok": True,
                "package_name": req.name,
                "version_installed": import_check.get("version"),
                "lockfile_diff": lockfile_diff,
            }
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "uv add timed out", "package_name": req.name}
        except Exception as e:
            return {"ok": False, "error": str(e), "package_name": req.name}

    async def _remove(self, req: PkgRemove) -> dict[str, Any]:
        """Remove a package via `uv remove` in the project venv."""
        try:
            result = subprocess.run(
                ["uv", "remove", req.name],
                cwd=str(self.project_root),
                capture_output=True,
                text=True,
                timeout=60,
            )

            if result.returncode != 0:
                return {
                    "ok": False,
                    "error": f"uv remove failed: {result.stderr}",
                    "package_name": req.name,
                }

            lockfile_diff = self._get_lockfile_diff()
            return {
                "ok": True,
                "package_name": req.name,
                "lockfile_diff": lockfile_diff,
            }
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "uv remove timed out", "package_name": req.name}
        except Exception as e:
            return {"ok": False, "error": str(e), "package_name": req.name}

    async def _freeze(self, _req: PkgFreeze) -> dict[str, Any]:
        """Return the current lockfile diff."""
        try:
            lockfile_diff = self._get_lockfile_diff()
            return {"ok": True, "lockfile_diff": lockfile_diff}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _get_lockfile_diff(self) -> dict[str, Any]:
        """Return diff of current lockfile vs baseline."""
        # TODO: This will be implemented with actual lockfile diff logic in M2.4
        # For now, return empty diff structure
        return {"added": [], "removed": [], "changed": []}

    def _verify_import(self, package_name: str) -> dict[str, Any]:
        """Verify package is importable via postcondition check."""
        try:
            # Normalize package name for import (e.g., openai -> openai)
            result = subprocess.run(
                [sys.executable, "-c", f"import {package_name}; print({package_name}.__version__ if hasattr({package_name}, '__version__') else 'installed')"],
                cwd=str(self.project_root),
                capture_output=True,
                text=True,
                timeout=30,
            )
            if result.returncode == 0:
                version = result.stdout.strip()
                return {"ok": True, "version": version}
            return {"ok": False, "error": result.stderr.strip()}
        except Exception as e:
            return {"ok": False, "error": str(e)}
