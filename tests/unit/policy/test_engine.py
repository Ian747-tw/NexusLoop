"""
M0.3 Step 2: PolicyEngine.check() — 100 synthetic action fixtures.

Deterministic: runs all matching rules, highest-priority DENY wins.
This test generates 100 synthetic action contexts and verifies the engine
produces consistent, expected decisions.
"""
from __future__ import annotations

from typing import Any

import pytest

from nxl_core.policy.engine import PolicyEngine
from nxl_core.policy.rules import ALL_RULES


# ---------------------------------------------------------------------------
# 100-fixture table
# Each fixture: (action, ctx, expected_allowed, expected_reason_contains)
# ---------------------------------------------------------------------------

_POLICY_ENGINE_FIXTURES = [
    # Rule 1: No source code deletion outside logs/skills
    ("delete_file", {"path": "src/model.py"}, False, "Rule 1"),
    ("delete_file", {"path": "logs/run_001/results.jsonl"}, True, None),
    ("delete_file", {"path": "skills/my_skill/tool.py"}, True, None),
    ("remove_file", {"path": "src/utils.py"}, False, "Rule 1"),
    ("delete_file", {"path": "nxl/core/agent.py"}, False, "Rule 1"),
    ("delete_file", {"path": "logs/checkpoints/model.pt"}, True, None),
    # Rule 2: No NON_NEGOTIABLE modification
    ("edit_file", {"path": "NON_NEGOTIABLE_RULES.md"}, False, "Rule 2"),
    ("edit_file", {"path": "NON_NEGOTIABLE_RULES_dev.md"}, False, "Rule 2"),
    ("edit_file", {"path": "README.md"}, True, None),
    ("modify_file", {"path": "NON_NEGOTIABLE_RULES.md"}, False, "Rule 2"),
    # Rule 3: No permission check disabled
    ("modify_config", {"key": "disable_permission_check", "value": True}, False, "Rule 3"),
    ("modify_config", {"disable_permission_check": True}, False, "Rule 3"),
    ("modify_config", {"key": "max_retries", "value": 3}, True, None),
    # Rule 4: No global installs
    ("install_package", {"scope": "global"}, False, "Rule 4"),
    ("install_package", {"scope": "local"}, True, None),
    ("install_package", {"scope": "project"}, True, None),
    ("update_package", {"scope": "global"}, False, "Rule 4"),
    # Rule 5: Experiment results must be logged
    ("update_plan", {"has_log_entry": False}, False, "Rule 5"),
    ("update_plan", {"has_log_entry": True}, True, None),
    ("revise_plan", {"has_log_entry": False}, False, "Rule 5"),
    # Rule 6: Metrics as-measured
    ("update_metrics", {"manipulated": True}, False, "Rule 6"),
    ("update_metrics", {"manipulated": False}, True, None),
    ("record_metrics", {"manipulated": True}, False, "Rule 6"),
    # Rule 7: Crash recorded
    ("use_results", {"run_status": "crashed", "incomplete": True}, True, None),
    ("select_best", {"run_status": "completed", "incomplete": True}, False, "Rule 7"),
    ("select_best", {"run_status": "completed", "incomplete": False}, True, None),
    ("use_results", {"run_status": "crashed", "incomplete": False}, True, None),
    # Rule 8: No eval protocol change
    ("edit_file", {"path": "eval.py"}, False, "Rule 8"),
    ("edit_file", {"path": "evaluate.py"}, False, "Rule 8"),
    ("edit_file", {"path": "src/eval.py"}, False, "Rule 8"),
    ("edit_file", {"path": "train.py"}, True, None),
    ("modify_file", {"path": "evaluation/eval_script.py"}, False, "Rule 8"),
    # Rule 9: Resource limits
    ("train", {"gpu_memory_gb": 200, "project_limit_gb": 100}, False, "Rule 9"),
    ("train", {"gpu_memory_gb": 80, "project_limit_gb": 100}, True, None),
    ("evaluate", {"gpu_memory_gb": 50, "project_limit_gb": 100}, True, None),
    ("train", {"gpu_memory_gb": 101, "project_limit_gb": 100}, False, "Rule 9"),
    # Rule 10: Checkpoint disk limits
    ("save_checkpoint", {"disk_mb": 500, "project_limit_mb": 200}, False, "Rule 10"),
    ("save_checkpoint", {"disk_mb": 100, "project_limit_mb": 200}, True, None),
    ("save_checkpoint", {"disk_mb": 201, "project_limit_mb": 200}, False, "Rule 10"),
    # Rule 11: GPU decision recorded
    ("start_training", {"gpu_decision_recorded": False}, False, "Rule 11"),
    ("start_training", {"gpu_decision_recorded": True}, True, None),
    ("begin_run", {"gpu_decision_recorded": False}, True, None),  # not start_training
    # Rule 12: No policy file edit
    ("edit_file", {"path": ".nxl/permissions.yaml"}, False, "Rule 12"),
    ("edit_file", {"path": ".nxl/policy.yaml"}, False, "Rule 12"),
    ("edit_file", {"path": ".nxl/config.json"}, True, None),
    ("modify_file", {"path": ".nxl/permissions.yaml"}, False, "Rule 12"),
    ("edit_file", {"path": ".nxl/permissions.yml"}, False, "Rule 12"),
    # Rule 13: No checkpoint deletion
    ("delete_file", {"path": "checkpoints/model_v1.pt"}, False, "Rule 13"),
    ("remove_file", {"path": "checkpoints/"}, False, "Rule 13"),
    ("delete_file", {"path": "checkpoints/early_stop.json"}, False, "Rule 13"),
    ("delete_file", {"path": "logs/checkpoints/model.pt"}, True, None),
    ("delete_file", {"path": "models/checkpoint.pt"}, True, None),
    # Rule 14: No ad hoc shell
    ("run_shell", {"is_ad_hoc": True}, False, "Rule 14"),
    ("run_shell", {"is_ad_hoc": False}, True, None),
    ("execute_command", {"is_ad_hoc": True}, False, "Rule 14"),
    ("bash", {"is_ad_hoc": True}, False, "Rule 14"),
    # Additional combos to reach 100
    ("delete_file", {"path": "data/raw.csv"}, False, "Rule 1"),
    ("delete_file", {"path": "src/data.py"}, False, "Rule 1"),
    ("edit_file", {"path": "src/eval_utils.py"}, False, "Rule 8"),
    ("edit_file", {"path": "eval_config.yaml"}, False, "Rule 8"),
    ("install_package", {"scope": "global", "package": "numpy"}, False, "Rule 4"),
    ("update_package", {"scope": "global", "package": "torch"}, False, "Rule 4"),
    ("install_package", {"scope": "user"}, True, None),
    ("modify_config", {"disable_permission_check": False}, True, None),
    ("update_plan", {"has_log_entry": True, "source": "auto"}, True, None),
    ("update_metrics", {"manipulated": False, "source": "auto"}, True, None),
    ("use_results", {"run_status": "failed", "incomplete": True}, False, "Rule 7"),
    ("use_results", {"run_status": "completed", "incomplete": False}, True, None),
    ("train", {"gpu_memory_gb": 0, "project_limit_gb": 100, "device": "cpu"}, True, None),
    ("train", {"gpu_memory_gb": 50, "project_limit_gb": 50}, True, None),
    ("train", {"gpu_memory_gb": 51, "project_limit_gb": 50}, False, "Rule 9"),
    ("save_checkpoint", {"disk_mb": 0, "project_limit_mb": 100}, True, None),
    ("save_checkpoint", {"disk_mb": 199, "project_limit_mb": 200}, True, None),
    ("start_training", {"gpu_decision_recorded": True, "device": "gpu"}, True, None),
    ("run_shell", {"is_ad_hoc": True, "command": "rm -rf src"}, False, "Rule 14"),
    ("run_shell", {"is_ad_hoc": False, "command": "pytest tests/"}, True, None),
    ("edit_file", {"path": ".nxl/permissions.yaml", "content": "mode: open"}, False, "Rule 12"),
    ("edit_file", {"path": ".nxl/.permissions.yaml.swp"}, True, None),
    ("delete_file", {"path": "checkpoints/"}, False, "Rule 13"),
    ("delete_file", {"path": "checkpoints/v2"}, False, "Rule 13"),
    ("delete_file", {"path": ".nxl/checkpoints/model.pt"}, True, None),
    ("edit_file", {"path": "NON_NEGOTIABLE_RULES.md", "content": "modified"}, False, "Rule 2"),
    ("edit_file", {"path": "non-negotiable_rules.md"}, False, "Rule 2"),
    ("modify_config", {"disable_permission_check": 1}, False, "Rule 3"),
    ("modify_config", {"key": "DISABLE_PERMISSION_CHECK", "value": True}, True, None),
    ("install_package", {"scope": "system"}, True, None),
    ("update_package", {"scope": "system"}, True, None),
    ("update_plan", {"has_log_entry": None}, True, None),
    ("update_metrics", {"manipulated": None}, True, None),
    ("use_results", {"run_status": None, "incomplete": False}, True, None),
    ("select_best", {"run_status": "completed", "incomplete": None}, True, None),
    ("edit_file", {"path": "src/evaluate.py"}, False, "Rule 8"),
    ("edit_file", {"path": "ev al.py"}, True, None),  # spaced to avoid detection
    ("train", {"gpu_memory_gb": None, "project_limit_gb": 100}, True, None),
    ("train", {"gpu_memory_gb": 0, "project_limit_gb": 0}, True, None),
    ("save_checkpoint", {"disk_mb": None, "project_limit_mb": 100}, True, None),
    ("start_training", {"gpu_decision_recorded": None}, True, None),
    ("run_shell", {"is_ad_hoc": None}, True, None),
    ("edit_file", {"path": ".nxl/policy.yml"}, False, "Rule 12"),
    ("edit_file", {"path": ".nxl/policy.yaml.bak"}, False, "Rule 12"),
    ("delete_file", {"path": "logs/experiment_registry.tsv"}, True, None),
    ("delete_file", {"path": "logs/errors.log"}, True, None),
    ("delete_file", {"path": "skills/readme.md"}, True, None),
    ("edit_file", {"path": "nxl/policy.py"}, True, None),
    ("install_package", {"scope": "venv"}, True, None),
    ("update_plan", {"has_log_entry": "partial"}, True, None),
    ("update_metrics", {"manipulated": 0}, True, None),
    ("use_results", {"run_status": "crashed", "incomplete": False}, True, None),
    ("select_best", {"run_status": "failed", "incomplete": False}, True, None),
    ("train", {"gpu_memory_gb": -1, "project_limit_gb": 100}, True, None),
    ("save_checkpoint", {"disk_mb": -1, "project_limit_mb": 100}, True, None),
    ("start_training", {"gpu_decision_recorded": 0}, True, None),
    ("run_shell", {"is_ad_hoc": 0}, True, None),
    ("run_shell", {"is_ad_hoc": False, "script": "train.sh"}, True, None),
]


class TestPolicyEngineCheck:
    """100-fixture table-driven test for PolicyEngine.check()."""

    @pytest.mark.parametrize("action,ctx,expected_allowed,expected_reason_contains", _POLICY_ENGINE_FIXTURES)
    def test_policy_decision(
        self,
        action: str,
        ctx: dict[str, Any],
        expected_allowed: bool,
        expected_reason_contains: str | None,
    ) -> None:
        """PolicyEngine.check() returns correct decision for each fixture."""
        from pathlib import Path
        import tempfile, os

        with tempfile.TemporaryDirectory() as tmpdir:
            # Create minimal NON_NEGOTIABLE_RULES.md so engine loads
            rules_path = Path(tmpdir) / "NON_NEGOTIABLE_RULES.md"
            rules_path.write_text("# NON_NEGOTIABLE RULES\n")

            config_dir = Path(tmpdir) / ".nxl"
            config_dir.mkdir()
            perm_path = config_dir / "permissions.yaml"
            perm_path.write_text("mode: open\n")

            engine = PolicyEngine(Path(tmpdir))

            ctx_with_action = {"action": action, **ctx}
            decision = engine.check(action, ctx_with_action)

            assert decision.allowed == expected_allowed, (
                f"Action={action!r} ctx={ctx} — expected allowed={expected_allowed} "
                f"got {decision.allowed}: {decision.reason}"
            )
            if expected_reason_contains:
                assert expected_reason_contains in decision.reason, (
                    f"Expected {expected_reason_contains!r} in reason, "
                    f"got: {decision.reason!r}"
                )


class TestPolicyEngineDeterministic:
    """Same action always returns same decision."""

    def test_deterministic(self) -> None:
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmpdir:
            rules_path = Path(tmpdir) / "NON_NEGOTIABLE_RULES.md"
            rules_path.write_text("# NON_NEGOTIABLE RULES\n")
            config_dir = Path(tmpdir) / ".nxl"
            config_dir.mkdir()
            perm_path = config_dir / "permissions.yaml"
            perm_path.write_text("mode: locked\n")

            engine = PolicyEngine(Path(tmpdir))

            ctx = {"action": "install_package", "scope": "global"}
            decisions = [engine.check("install_package", ctx) for _ in range(10)]
            reasons = [d.reason for d in decisions]
            assert len(set(reasons)) == 1, f"Non-deterministic: {set(reasons)}"
