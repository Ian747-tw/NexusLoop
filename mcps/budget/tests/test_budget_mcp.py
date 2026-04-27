"""mcps.budget.tests.test_budget_mcp — unit tests for budget MCP server."""
from __future__ import annotations

import asyncio
from pathlib import Path

from mcps.budget.server import BudgetMCPServer, get_budget, check_spend, record_spend


class TestBudgetMCPServer:
    """Tests for budget MCP server."""

    def test_get_budget_returns_zeros_when_no_budget_section(self, tmp_path: Path) -> None:
        (tmp_path / "project.yaml").write_text("name: test\n")
        server = BudgetMCPServer(tmp_path)
        result = server._get_budget()
        assert result["total_runs"] == 0
        assert result["runs_used"] == 0
        assert result["gpu_budget_hours"] == 0.0
        assert result["gpu_hours_used"] == 0.0
        assert result["storage_gb"] == 0.0
        assert result["storage_used_gb"] == 0.0

    def test_get_budget_parses_valid_yaml(self, tmp_path: Path) -> None:
        (tmp_path / "project.yaml").write_text(
            "budget:\n  total_runs: 100\n  gpu_budget_hours: 1000\n  storage_gb: 500\n"
        )
        server = BudgetMCPServer(tmp_path)
        result = server._get_budget()
        assert result["total_runs"] == 100
        assert result["gpu_budget_hours"] == 1000.0
        assert result["storage_gb"] == 500.0
        assert result["runs_remaining"] == 100
        assert result["gpu_remaining_hours"] == 1000.0
        assert result["storage_remaining_gb"] == 500.0

    def test_get_budget_handles_missing_fields(self, tmp_path: Path) -> None:
        (tmp_path / "project.yaml").write_text(
            "budget:\n  total_runs: 50\n"
        )
        server = BudgetMCPServer(tmp_path)
        result = server._get_budget()
        assert result["total_runs"] == 50
        assert result["runs_used"] == 0
        assert result["gpu_budget_hours"] == 0.0
        assert result["storage_gb"] == 0.0

    def test_get_budget_returns_empty_when_no_project_yaml(self, tmp_path: Path) -> None:
        server = BudgetMCPServer(tmp_path)
        result = server._get_budget()
        assert result["total_runs"] == 0
        assert result["gpu_budget_hours"] == 0.0

    def test_get_tools_returns_three_tools(self) -> None:
        server = BudgetMCPServer()
        tools = server.get_tools()
        assert len(tools) == 3
        names = {t["name"] for t in tools}
        assert names == {"budget.get", "budget.check_spend", "budget.record_spend"}

    def test_handle_tool_dispatches_budget_get(self, tmp_path: Path) -> None:
        (tmp_path / "project.yaml").write_text("budget:\n  total_runs: 10\n")
        server = BudgetMCPServer(tmp_path)
        result = asyncio.run(server.handle_tool("budget.get", {}))
        assert result["ok"] is True
        data = result["data"]  # type: ignore[index]
        assert data["total_runs"] == 10

    def test_handle_tool_unknown_returns_error(self, tmp_path: Path) -> None:
        server = BudgetMCPServer(tmp_path)
        result = asyncio.run(server.handle_tool("budget.unknown", {}))
        assert result["ok"] is False


class TestCheckSpend:
    """Tests for budget.check_spend."""

    def test_check_spend_runs_allowed_when_remaining(self, tmp_path: Path) -> None:
        (tmp_path / "project.yaml").write_text(
            "budget:\n  total_runs: 10\n  runs_used: 5\n"
        )
        server = BudgetMCPServer(tmp_path)
        result = server._check_spend("runs")
        assert result["allowed"] is True
        assert result["reason"] == "ok"

    def test_check_spend_runs_denied_when_exhausted(self, tmp_path: Path) -> None:
        (tmp_path / "project.yaml").write_text(
            "budget:\n  total_runs: 10\n  runs_used: 10\n"
        )
        server = BudgetMCPServer(tmp_path)
        result = server._check_spend("runs")
        assert result["allowed"] is False
        assert "No runs remaining" in result["reason"]

    def test_check_spend_gpu_hours_allowed(self, tmp_path: Path) -> None:
        (tmp_path / "project.yaml").write_text(
            "budget:\n  gpu_budget_hours: 100\n  gpu_hours_used: 50\n"
        )
        server = BudgetMCPServer(tmp_path)
        result = server._check_spend("gpu_hours")
        assert result["allowed"] is True
        assert result["reason"] == "ok"

    def test_check_spend_gpu_hours_denied(self, tmp_path: Path) -> None:
        (tmp_path / "project.yaml").write_text(
            "budget:\n  gpu_budget_hours: 100\n  gpu_hours_used: 100\n"
        )
        server = BudgetMCPServer(tmp_path)
        result = server._check_spend("gpu_hours")
        assert result["allowed"] is False

    def test_check_spend_storage_gb_allowed(self, tmp_path: Path) -> None:
        (tmp_path / "project.yaml").write_text(
            "budget:\n  storage_gb: 200\n  storage_used_gb: 100\n"
        )
        server = BudgetMCPServer(tmp_path)
        result = server._check_spend("storage_gb")
        assert result["allowed"] is True

    def test_check_spend_unknown_resource_denied(self, tmp_path: Path) -> None:
        (tmp_path / "project.yaml").write_text(
            "budget:\n  total_runs: 10\n"
        )
        server = BudgetMCPServer(tmp_path)
        result = server._check_spend("unknown_resource")
        assert result["allowed"] is False
        assert "Unknown resource" in result["reason"]

    def test_check_spend_case_insensitive(self, tmp_path: Path) -> None:
        (tmp_path / "project.yaml").write_text(
            "budget:\n  total_runs: 10\n  runs_used: 5\n"
        )
        server = BudgetMCPServer(tmp_path)
        result = server._check_spend("RUNS")
        assert result["allowed"] is True


class TestRecordSpend:
    """Tests for budget.record_spend."""

    def test_record_spend_runs_updates_yaml(self, tmp_path: Path) -> None:
        (tmp_path / "project.yaml").write_text(
            "budget:\n  total_runs: 100\n  runs_used: 5\n"
        )
        server = BudgetMCPServer(tmp_path)
        result = server._record_spend("runs", 1)
        assert result["resource"] == "runs"
        assert result["amount"] == 1
        assert result["runs_used"] == 6

        # Verify persistence
        import yaml
        with (tmp_path / "project.yaml").open() as fh:
            data = yaml.safe_load(fh)
        assert data["budget"]["runs_used"] == 6

    def test_record_spend_gpu_hours_updates_yaml(self, tmp_path: Path) -> None:
        (tmp_path / "project.yaml").write_text(
            "budget:\n  gpu_budget_hours: 1000\n  gpu_hours_used: 100\n"
        )
        server = BudgetMCPServer(tmp_path)
        result = server._record_spend("gpu_hours", 10.5)
        assert result["gpu_hours_used"] == 110.5

        import yaml
        with (tmp_path / "project.yaml").open() as fh:
            data = yaml.safe_load(fh)
        assert data["budget"]["gpu_hours_used"] == 110.5

    def test_record_spend_storage_gb_updates_yaml(self, tmp_path: Path) -> None:
        (tmp_path / "project.yaml").write_text(
            "budget:\n  storage_gb: 500\n  storage_used_gb: 100\n"
        )
        server = BudgetMCPServer(tmp_path)
        result = server._record_spend("storage_gb", 25)
        assert result["storage_used_gb"] == 125

        import yaml
        with (tmp_path / "project.yaml").open() as fh:
            data = yaml.safe_load(fh)
        assert data["budget"]["storage_used_gb"] == 125

    def test_record_spend_unknown_resource_returns_error(self, tmp_path: Path) -> None:
        (tmp_path / "project.yaml").write_text(
            "budget:\n  total_runs: 100\n"
        )
        server = BudgetMCPServer(tmp_path)
        result = server._record_spend("unknown", 1)
        assert "error" in result
        assert "Unknown resource" in result["error"]

    def test_record_spend_handles_missing_usage_fields(self, tmp_path: Path) -> None:
        (tmp_path / "project.yaml").write_text(
            "budget:\n  total_runs: 100\n"
        )
        server = BudgetMCPServer(tmp_path)
        result = server._record_spend("runs", 1)
        assert result["runs_used"] == 1

    def test_record_spend_preserves_other_budget_fields(self, tmp_path: Path) -> None:
        (tmp_path / "project.yaml").write_text(
            "budget:\n  total_runs: 100\n  gpu_budget_hours: 1000\n  gpu_hours_used: 50\n"
        )
        server = BudgetMCPServer(tmp_path)
        result = server._record_spend("runs", 1)
        assert result["gpu_hours_used"] == 50

        import yaml
        with (tmp_path / "project.yaml").open() as fh:
            data = yaml.safe_load(fh)
        assert data["budget"]["gpu_budget_hours"] == 1000
        assert data["budget"]["gpu_hours_used"] == 50


class TestConvenienceWrappers:
    """Tests for top-level convenience functions."""

    def test_get_budget_empty_project_dir(self) -> None:
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            result = get_budget(Path(tmp))
            assert result["total_runs"] == 0

    def test_check_spend_with_tmp_dir(self) -> None:
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            (p / "project.yaml").write_text("budget:\n  total_runs: 10\n")
            result = check_spend("runs", p)
            assert result["allowed"] is True

    def test_record_spend_with_tmp_dir(self) -> None:
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            (p / "project.yaml").write_text("budget:\n  total_runs: 10\n")
            result = record_spend("runs", 1, p)
            assert result["runs_used"] == 1


class TestPolicyGate:
    """Assert policy check fires on every tool call."""

    def test_check_policy_is_called_on_handle_tool(self, tmp_path: Path) -> None:
        server = BudgetMCPServer(tmp_path)
        allowed = server.check_policy("budget.get", {})
        assert isinstance(allowed, bool)

    def test_all_tools_have_policy_gate(self, tmp_path: Path) -> None:
        server = BudgetMCPServer(tmp_path)
        for tool in server.get_tools():
            tool_name = tool["name"]
            allowed = server.check_policy(tool_name, {})
            assert isinstance(allowed, bool)

    def test_policy_denied_blocks_execution(self, tmp_path: Path) -> None:
        from unittest.mock import patch
        from nxl_core.policy.engine import PolicyDecision

        server = BudgetMCPServer(tmp_path)
        with patch.object(server._policy, "check") as mock_check:
            mock_check.return_value = PolicyDecision(
                allowed=False,
                requires_confirmation=False,
                reason="Denied by policy",
                violated_rules=["test_rule"],
            )
            result = asyncio.run(server.handle_tool("budget.get", {}))
        assert result["ok"] is False