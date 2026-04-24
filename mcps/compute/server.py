"""mcps.compute.server — GPU/CPU/disk/budget query MCP server."""
from __future__ import annotations

import os
import shutil
from typing import Any

from mcps._shared.base import BaseMCPServer
from mcps.compute.requests import (
    ComputeDiskStatusRequest,
)
from mcps.compute.responses import (
    ComputeBudgetStatusResponse,
    ComputeCPUStatusResponse,
    ComputeDiskStatusResponse,
    ComputeGPUStatusResponse,
)
from nxl_core.events.schema import ToolRequested


def _get_gpu_info() -> tuple[bool, str, int]:
    """Attempt to get GPU info via nvidia-smi."""
    try:
        import subprocess

        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.free", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            lines = result.stdout.strip().split("\n")
            if lines:
                parts = lines[0].split(",")
                name = parts[0].strip()
                free_mb = int(parts[1].strip().split()[0])
                return True, name, free_mb
    except Exception:
        pass
    return False, "", 0


def _get_cpu_cores() -> int:
    """Return number of CPU cores."""
    return os.cpu_count() or 1


def _get_cpu_usage() -> float:
    """Return CPU usage percent (0-100)."""
    try:
        import subprocess

        result = subprocess.run(
            ["top", "-bn1"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            for line in result.stdout.split("\n"):
                if "Cpu(s)" in line or "%Cpu(s)" in line:
                    parts = line.split()
                    for i, part in enumerate(parts):
                        if part == "id,":
                            idle = float(parts[i - 1].rstrip(","))
                            return round(100.0 - idle, 1)
    except Exception:
        pass
    # Fallback using /proc/stat
    try:
        with open("/proc/stat", "r") as f:
            line = f.readline()
            fields = line.split()[1:]
            total = sum(int(x) for x in fields)
            idle = int(fields[3])
            usage = 100.0 * (1 - idle / total)
            return round(usage, 1)
    except Exception:
        pass
    return 0.0


def _get_disk_info(path: str) -> tuple[int, int]:
    """Return (free_gb, total_gb) for the given path."""
    try:
        usage = shutil.disk_usage(path)
        return int(usage.free / (1024**3)), int(usage.total / (1024**3))
    except Exception:
        return 0, 0


class ComputeServer(BaseMCPServer):
    """MCP server for compute resource queries."""

    name = "compute"

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "name": "compute.gpu_status",
                "description": "Check GPU availability and memory",
                "inputSchema": {"type": "object", "properties": {}},
            },
            {
                "name": "compute.cpu_status",
                "description": "Check CPU cores and usage",
                "inputSchema": {"type": "object", "properties": {}},
            },
            {
                "name": "compute.disk_status",
                "description": "Check disk space for a path",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Path to check", "default": "/"},
                    },
                    "required": [],
                },
            },
            {
                "name": "compute.budget_status",
                "description": "Check token budget and cycle usage",
                "inputSchema": {"type": "object", "properties": {}},
            },
        ]

    def _emit(self, tool_name: str, args: dict[str, Any]) -> None:
        from nxl_core.events.singletons import journal_log

        event_log = journal_log()
        event_log.append(
            ToolRequested(
                tool_name=tool_name,
                args_hash=str(hash(frozenset(args.items()))),
                requesting_skill=None,
            )
        )

    async def handle_tool(self, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        if tool_name == "compute.gpu_status":
            return await self._gpu_status(args)
        elif tool_name == "compute.cpu_status":
            return await self._cpu_status(args)
        elif tool_name == "compute.disk_status":
            return await self._disk_status(args)
        elif tool_name == "compute.budget_status":
            return await self._budget_status(args)
        else:
            return {"ok": False, "error": f"Unknown tool: {tool_name}"}

    async def _gpu_status(self, args: dict[str, Any]) -> dict[str, Any]:
        if not self.check_policy("compute.gpu_status", args):
            return {"ok": False, "error": "Policy denied"}
        self._emit("compute.gpu_status", args)

        available, name, memory_free_mb = _get_gpu_info()
        return {
            "ok": True,
            "data": ComputeGPUStatusResponse(
                available=available,
                name=name,
                memory_free_mb=memory_free_mb,
            ).model_dump(),
        }

    async def _cpu_status(self, args: dict[str, Any]) -> dict[str, Any]:
        if not self.check_policy("compute.cpu_status", args):
            return {"ok": False, "error": "Policy denied"}
        self._emit("compute.cpu_status", args)

        cores = _get_cpu_cores()
        usage = _get_cpu_usage()
        return {
            "ok": True,
            "data": ComputeCPUStatusResponse(
                cores=cores,
                usage_percent=usage,
            ).model_dump(),
        }

    async def _disk_status(self, args: dict[str, Any]) -> dict[str, Any]:
        if not self.check_policy("compute.disk_status", args):
            return {"ok": False, "error": "Policy denied"}
        self._emit("compute.disk_status", args)

        req = ComputeDiskStatusRequest(**args)
        free_gb, total_gb = _get_disk_info(req.path)
        return {
            "ok": True,
            "data": ComputeDiskStatusResponse(
                free_gb=free_gb,
                total_gb=total_gb,
            ).model_dump(),
        }

    async def _budget_status(self, args: dict[str, Any]) -> dict[str, Any]:
        if not self.check_policy("compute.budget_status", args):
            return {"ok": False, "error": "Policy denied"}
        self._emit("compute.budget_status", args)

        # Token budget tracking — defaults, replace with real tracking
        return {
            "ok": True,
            "data": ComputeBudgetStatusResponse(
                tokens_spent=0,
                tokens_budget=1_000_000,
                cycles_used=0,
            ).model_dump(),
        }
