"""mcps.budget.server — budget tracking MCP server."""
from __future__ import annotations

import yaml
from pathlib import Path

from pydantic import BaseModel

from mcps._shared.base import BaseMCPServer


class GetBudgetRequest(BaseModel):
    """No args required."""
    pass


class GetBudgetResponse(BaseModel):
    total_runs: int = 0
    runs_used: int = 0
    gpu_budget_hours: float = 0.0
    gpu_hours_used: float = 0.0
    storage_gb: float = 0.0
    storage_used_gb: float = 0.0
    runs_remaining: int = 0
    gpu_remaining_hours: float = 0.0
    storage_remaining_gb: float = 0.0


class CheckSpendRequest(BaseModel):
    resource: str


class CheckSpendResponse(BaseModel):
    allowed: bool
    reason: str


class RecordSpendRequest(BaseModel):
    resource: str
    amount: float


class RecordSpendResponse(BaseModel):
    resource: str
    amount: float
    runs_used: int = 0
    gpu_hours_used: float = 0.0
    storage_used_gb: float = 0.0


class BudgetMCPServer(BaseMCPServer):
    """Track experiment budgets and spending from project.yaml."""

    def __init__(self, project_dir: Path | None = None) -> None:
        super().__init__("budget")
        self._project_dir = project_dir or Path.cwd()

    def get_tools(self) -> list[dict[str, object]]:
        return [
            {
                "name": "budget.get",
                "description": "Returns current budget and usage from project.yaml",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": False,
                },
            },
            {
                "name": "budget.check_spend",
                "description": "Check if a resource can be spent. Resources: runs, gpu_hours, storage_gb.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "resource": {
                            "type": "string",
                            "description": "Resource to check: runs, gpu_hours, or storage_gb",
                        },
                    },
                    "required": ["resource"],
                    "additionalProperties": False,
                },
            },
            {
                "name": "budget.record_spend",
                "description": "Record spending of a resource. Resources: runs, gpu_hours, storage_gb.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "resource": {
                            "type": "string",
                            "description": "Resource to record: runs, gpu_hours, or storage_gb",
                        },
                        "amount": {
                            "type": "number",
                            "description": "Amount of the resource spent",
                        },
                    },
                    "required": ["resource", "amount"],
                    "additionalProperties": False,
                },
            },
        ]

    async def handle_tool(self, tool_name: str, args: dict[str, object]) -> dict[str, object]:
        self.emit_tool_requested(tool_name, args)
        decision = self._policy.check(tool_name, args)
        if not decision.allowed:
            return {"ok": False, "error": f"Policy denied: {decision.reason}"}
        if tool_name == "budget.get":
            return {"ok": True, "data": self._get_budget()}
        elif tool_name == "budget.check_spend":
            return {"ok": True, "data": self._check_spend(args["resource"])}  # type: ignore[index]
        elif tool_name == "budget.record_spend":
            return {"ok": True, "data": self._record_spend(args["resource"], args["amount"])}  # type: ignore[index]
        else:
            return {"ok": False, "error": f"Unknown tool: {tool_name}"}

    def _read_budget_yaml(self) -> dict[str, object]:
        """Read and parse project.yaml budget section."""
        project_yaml = self._project_dir / "project.yaml"
        if not project_yaml.exists():
            return {}
        with project_yaml.open() as fh:
            data = yaml.safe_load(fh) or {}
        return data.get("budget", {}) or {}

    def _get_budget(self) -> dict[str, object]:
        b = self._read_budget_yaml()
        total_runs = int(b.get("total_runs", 0))
        gpu_budget_hours = float(b.get("gpu_budget_hours", 0.0))
        storage_gb = float(b.get("storage_gb", 0.0))
        runs_used = int(b.get("runs_used", 0))
        gpu_hours_used = float(b.get("gpu_hours_used", 0.0))
        storage_used_gb = float(b.get("storage_used_gb", 0.0))

        return {
            "total_runs": total_runs,
            "runs_used": runs_used,
            "gpu_budget_hours": gpu_budget_hours,
            "gpu_hours_used": gpu_hours_used,
            "storage_gb": storage_gb,
            "storage_used_gb": storage_used_gb,
            "runs_remaining": max(0, total_runs - runs_used),
            "gpu_remaining_hours": max(0.0, gpu_budget_hours - gpu_hours_used),
            "storage_remaining_gb": max(0.0, storage_gb - storage_used_gb),
        }

    def _check_spend(self, resource: str) -> dict[str, object]:
        budget = self._get_budget()
        resource = resource.lower()

        if resource == "runs":
            remaining = budget["runs_remaining"]
            allowed = remaining > 0
            reason = "ok" if allowed else f"No runs remaining ({budget['runs_used']}/{budget['total_runs']})"
        elif resource == "gpu_hours":
            remaining = budget["gpu_remaining_hours"]
            allowed = remaining > 0
            reason = "ok" if allowed else f"No GPU hours remaining ({budget['gpu_hours_used']:.1f}/{budget['gpu_budget_hours']:.1f})"
        elif resource == "storage_gb":
            remaining = budget["storage_remaining_gb"]
            allowed = remaining > 0
            reason = "ok" if allowed else f"No storage remaining ({budget['storage_used_gb']:.1f}/{budget['storage_gb']:.1f})"
        else:
            allowed = False
            reason = f"Unknown resource: {resource}. Valid: runs, gpu_hours, storage_gb"

        return {"allowed": allowed, "reason": reason}

    def _record_spend(self, resource: str, amount: float) -> dict[str, object]:
        b = self._read_budget_yaml()
        resource = resource.lower()

        # Read current usage
        runs_used = int(b.get("runs_used", 0))
        gpu_hours_used = float(b.get("gpu_hours_used", 0.0))
        storage_used_gb = float(b.get("storage_used_gb", 0.0))

        # Update usage
        if resource == "runs":
            runs_used = runs_used + int(amount)
        elif resource == "gpu_hours":
            gpu_hours_used = gpu_hours_used + float(amount)
        elif resource == "storage_gb":
            storage_used_gb = storage_used_gb + float(amount)
        else:
            return {"ok": False, "error": f"Unknown resource: {resource}"}

        # Write back to project.yaml
        b["runs_used"] = runs_used
        b["gpu_hours_used"] = gpu_hours_used
        b["storage_used_gb"] = storage_used_gb

        project_yaml = self._project_dir / "project.yaml"
        with project_yaml.open() as fh:
            data = yaml.safe_load(fh) or {}
        data["budget"] = b
        with project_yaml.open("w") as fh:
            yaml.safe_dump(data, fh)

        return {
            "resource": resource,
            "amount": amount,
            "runs_used": runs_used,
            "gpu_hours_used": gpu_hours_used,
            "storage_used_gb": storage_used_gb,
        }


# Convenience synchronous wrappers used by tests
def get_budget(project_dir: Path | None = None) -> dict[str, object]:
    server = BudgetMCPServer(project_dir)
    return server._get_budget()


def check_spend(resource: str, project_dir: Path | None = None) -> dict[str, object]:
    server = BudgetMCPServer(project_dir)
    return server._check_spend(resource)


def record_spend(resource: str, amount: float, project_dir: Path | None = None) -> dict[str, object]:
    server = BudgetMCPServer(project_dir)
    return server._record_spend(resource, amount)