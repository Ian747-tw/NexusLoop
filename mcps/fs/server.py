"""mcps.fs.server — File management — no rm, only archive and restore."""
from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import Any

from mcps._shared.base import BaseMCPServer

from .requests import (
    FsArchive,
    FsMove,
    FsRestore,
    FsStage,
    FsUnstage,
    FsWorkspaceNew,
)


class FsMCP(BaseMCPServer):
    """File management — no rm, only archive and restore."""

    def __init__(self, project_root: Path | None = None) -> None:
        super().__init__("fs")
        self.project_root = project_root or Path.cwd()
        self._archive_root = self.project_root / ".nxl" / "archive"

    # ------------------------------------------------------------------
    # Tool definitions
    # ------------------------------------------------------------------

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "name": "fs.move",
                "description": "Atomically rename a file within the project.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "src": {"type": "string", "description": "Source path"},
                        "dst": {"type": "string", "description": "Destination path"},
                    },
                    "required": ["src", "dst"],
                },
            },
            {
                "name": "fs.archive",
                "description": "Archive a file to .nxl/archive/<tag>/.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Path to archive"},
                        "tag": {"type": "string", "description": "Archive tag"},
                    },
                    "required": ["path", "tag"],
                },
            },
            {
                "name": "fs.restore",
                "description": "Restore a file from .nxl/archive/<tag>/.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Path to restore"},
                        "from_tag": {"type": "string", "description": "Tag to restore from"},
                    },
                    "required": ["path", "from_tag"],
                },
            },
            {
                "name": "fs.workspace_new",
                "description": "Create a scratch workspace at scratch/<owner>/<uuid>/.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "owner": {"type": "string", "description": "Owner of the workspace"},
                    },
                    "required": ["owner"],
                },
            },
            {
                "name": "fs.stage",
                "description": "Stage a file for commit (git add).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Path to stage"},
                    },
                    "required": ["path"],
                },
            },
            {
                "name": "fs.unstage",
                "description": "Unstage a file (git reset).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Path to unstage"},
                    },
                    "required": ["path"],
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
            return {"ok": False, "error": f"Policy denied: {decision.reason}"}

        if tool_name == "fs.move":
            return await self._move(FsMove(**args))
        if tool_name == "fs.archive":
            return await self._archive(FsArchive(**args))
        if tool_name == "fs.restore":
            return await self._restore(FsRestore(**args))
        if tool_name == "fs.workspace_new":
            return await self._workspace_new(FsWorkspaceNew(**args))
        if tool_name == "fs.stage":
            return await self._stage(FsStage(**args))
        if tool_name == "fs.unstage":
            return await self._unstage(FsUnstage(**args))
        return {"ok": False, "error": f"Unknown tool: {tool_name}"}

    # ------------------------------------------------------------------
    # Tool implementations
    # ------------------------------------------------------------------

    async def _move(self, req: FsMove) -> dict[str, Any]:
        """Atomically rename a file."""
        try:
            src_path = self._resolve(req.src)
            dst_path = self._resolve(req.dst)

            if not src_path.exists():
                return {"ok": False, "error": f"Source does not exist: {req.src}", "src": req.src, "dst": req.dst}

            src_path.rename(dst_path)
            return {"ok": True, "src": req.src, "dst": req.dst}
        except Exception as e:
            return {"ok": False, "error": str(e), "src": req.src, "dst": req.dst}

    async def _archive(self, req: FsArchive) -> dict[str, Any]:
        """Archive a file to .nxl/archive/<tag>/."""
        try:
            src_path = self._resolve(req.path)
            if not src_path.exists():
                return {
                    "ok": False,
                    "error": f"File does not exist: {req.path}",
                    "original_path": req.path,
                    "tag": req.tag,
                }

            # Create archive directory
            tag_dir = self._archive_root / req.tag
            tag_dir.mkdir(parents=True, exist_ok=True)

            # Destination in archive
            archive_path = tag_dir / src_path.name
            if archive_path.exists():
                # Avoid collision: append UUID
                archive_path = tag_dir / f"{src_path.stem}_{uuid.uuid4().hex[:8]}{src_path.suffix}"

            shutil.move(str(src_path), str(archive_path))
            return {
                "ok": True,
                "original_path": req.path,
                "archive_path": str(archive_path.relative_to(self.project_root)),
                "tag": req.tag,
            }
        except Exception as e:
            return {
                "ok": False,
                "error": str(e),
                "original_path": req.path,
                "tag": req.tag,
            }

    async def _restore(self, req: FsRestore) -> dict[str, Any]:
        """Restore a file from .nxl/archive/<tag>/."""
        try:
            # Find the file in the archive
            tag_dir = self._archive_root / req.from_tag
            if not tag_dir.exists():
                return {
                    "ok": False,
                    "error": f"No archive found for tag: {req.from_tag}",
                    "from_tag": req.from_tag,
                }

            # Find matching file (original name)
            src_path = self._resolve(req.path)
            archive_path = tag_dir / src_path.name
            if not archive_path.exists():
                # Try to find by pattern
                matches = list(tag_dir.glob(f"{src_path.stem}*{src_path.suffix}"))
                if not matches:
                    return {
                        "ok": False,
                        "error": f"No archived file found for: {req.path}",
                        "from_tag": req.from_tag,
                    }
                archive_path = matches[0]

            # Restore to original location
            if src_path.exists():
                return {
                    "ok": False,
                    "error": f"Cannot restore: destination already exists: {req.path}",
                    "from_tag": req.from_tag,
                }

            shutil.move(str(archive_path), str(src_path))
            return {
                "ok": True,
                "archive_path": str(archive_path.relative_to(self.project_root)),
                "restored_path": req.path,
                "from_tag": req.from_tag,
            }
        except Exception as e:
            return {
                "ok": False,
                "error": str(e),
                "from_tag": req.from_tag,
            }

    async def _workspace_new(self, req: FsWorkspaceNew) -> dict[str, Any]:
        """Create a scratch workspace at scratch/<owner>/<uuid>/."""
        try:
            workspace_id = uuid.uuid4().hex[:8]
            workspace_path = self.project_root / "scratch" / req.owner / workspace_id
            workspace_path.mkdir(parents=True, exist_ok=True)
            return {
                "ok": True,
                "workspace_path": str(workspace_path.relative_to(self.project_root)),
                "owner": req.owner,
            }
        except Exception as e:
            return {"ok": False, "error": str(e), "owner": req.owner}

    async def _stage(self, req: FsStage) -> dict[str, Any]:
        """Stage a file for commit (git add)."""
        try:
            import subprocess

            path = self._resolve(req.path)
            result = subprocess.run(
                ["git", "add", str(path)],
                cwd=str(self.project_root),
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode != 0:
                return {"ok": False, "error": result.stderr, "path": req.path}
            return {"ok": True, "path": req.path}
        except Exception as e:
            return {"ok": False, "error": str(e), "path": req.path}

    async def _unstage(self, req: FsUnstage) -> dict[str, Any]:
        """Unstage a file (git reset)."""
        try:
            import subprocess

            path = self._resolve(req.path)
            result = subprocess.run(
                ["git", "reset", "HEAD", str(path)],
                cwd=str(self.project_root),
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode != 0:
                return {"ok": False, "error": result.stderr, "path": req.path}
            return {"ok": True, "path": req.path}
        except Exception as e:
            return {"ok": False, "error": str(e), "path": req.path}

    # ------------------------------------------------------------------
    # Path helpers
    # ------------------------------------------------------------------

    def _resolve(self, rel_path: str) -> Path:
        """Resolve a relative path within project root."""
        abs_path = (self.project_root / rel_path).resolve()
        if not str(abs_path).startswith(str(self.project_root.resolve())):
            raise ValueError(f"Path '{rel_path}' is outside project root")
        return abs_path
