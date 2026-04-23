"""
M0.3 Step 1: Typed Rule objects.

Each NON_NEGOTIABLE rule becomes a typed Rule object with:
- scope_pattern: regex over action context
- predicate: callable(decision_context) -> bool
- effect: ALLOW | DENY
- reason_template: human-readable message
- priority: int (higher = evaluated first)

Test: each rule has its own test case; synthetic violation triggers correct rule.
"""
from __future__ import annotations

import re
from typing import Any

import pytest

from nxl_core.policy.rules import Rule, RuleEffect, ALL_RULES


class TestRuleStructure:
    """Every rule has required fields."""

    def test_all_rules_have_required_fields(self) -> None:
        for rule in ALL_RULES:
            assert rule.id, f"Rule {rule} missing id"
            assert rule.effect in (RuleEffect.ALLOW, RuleEffect.DENY)
            assert rule.reason_template, f"Rule {rule.id} missing reason_template"
            assert isinstance(rule.priority, int)


class TestNoSourceCodeDeletionOutsideLogs:
    """Rule 1: Never delete source code outside logs/ or skills/."""

    def test_blocks_delete_in_src(self) -> None:
        rule = _find_rule("no_source_code_deletion")
        ctx = _make_ctx(action="delete_file", path="src/model.py")
        assert rule.predicate(ctx) is True

    def test_allows_delete_in_logs(self) -> None:
        rule = _find_rule("no_source_code_deletion")
        ctx = _make_ctx(action="delete_file", path="logs/run_001/results.jsonl")
        assert rule.predicate(ctx) is False

    def test_allows_delete_in_skills(self) -> None:
        rule = _find_rule("no_source_code_deletion")
        ctx = _make_ctx(action="delete_file", path="skills/my_skill/tool.py")
        assert rule.predicate(ctx) is False


class TestNoNonNegotiableModification:
    """Rule 2: Never modify NON_NEGOTIABLE_RULES.md."""

    def test_blocks_modify_non_negotiable(self) -> None:
        rule = _find_rule("no_non_negotiable_modification")
        ctx = _make_ctx(action="edit_file", path="NON_NEGOTIABLE_RULES.md")
        assert rule.predicate(ctx) is True

    def test_allows_modify_other_md(self) -> None:
        rule = _find_rule("no_non_negotiable_modification")
        ctx = _make_ctx(action="edit_file", path="README.md")
        assert rule.predicate(ctx) is False


class TestNoPermissionCheckDisabled:
    """Rule 3: Never disable permission check (drl-autoresearch)."""

    def test_blocks_disable_permission_check(self) -> None:
        rule = _find_rule("no_permission_check_disabled")
        ctx = _make_ctx(action="modify_config", key="disable_permission_check", value=True)
        assert rule.predicate(ctx) is True

    def test_allows_other_config_changes(self) -> None:
        rule = _find_rule("no_permission_check_disabled")
        ctx = _make_ctx(action="modify_config", key="max_retries", value=3)
        assert rule.predicate(ctx) is False


class TestNoGlobalInstalls:
    """Rule 4: Never perform global package installs."""

    def test_blocks_global_install(self) -> None:
        rule = _find_rule("no_global_installs")
        ctx = _make_ctx(action="install_package", scope="global")
        assert rule.predicate(ctx) is True

    def test_allows_local_install(self) -> None:
        rule = _find_rule("no_global_installs")
        ctx = _make_ctx(action="install_package", scope="local")
        assert rule.predicate(ctx) is False


class TestExperimentResultsLogged:
    """Rule 5: All experiment results must be logged before updating plan."""

    def test_blocks_update_plan_without_log(self) -> None:
        rule = _find_rule("experiment_results_logged")
        ctx = _make_ctx(action="update_plan", has_log_entry=False)
        assert rule.predicate(ctx) is True

    def test_allows_update_plan_with_log(self) -> None:
        rule = _find_rule("experiment_results_logged")
        ctx = _make_ctx(action="update_plan", has_log_entry=True)
        assert rule.predicate(ctx) is False


class TestMetricsAsMeasured:
    """Rule 6: Metrics recorded as-measured, no post-hoc manipulation."""

    def test_blocks_metric_manipulation(self) -> None:
        rule = _find_rule("metrics_as_measured")
        ctx = _make_ctx(action="update_metrics", manipulated=True)
        assert rule.predicate(ctx) is True

    def test_allows_genuine_metrics(self) -> None:
        rule = _find_rule("metrics_as_measured")
        ctx = _make_ctx(action="update_metrics", manipulated=False)
        assert rule.predicate(ctx) is False


class TestCrashRecorded:
    """Rule 7: Crashed runs recorded with status=crashed."""

    def test_blocks_use_of_uncrashed_incomplete_run(self) -> None:
        rule = _find_rule("crash_recorded")
        ctx = _make_ctx(action="use_results", run_status="crashed", incomplete=True)
        assert rule.predicate(ctx) is False  # crashed status is OK

    def test_blocks_best_model_selection_from_incomplete(self) -> None:
        rule = _find_rule("crash_recorded")
        ctx = _make_ctx(action="select_best", run_status="completed", incomplete=True)
        assert rule.predicate(ctx) is True


class TestNoEvalProtocolChange:
    """Rule 8: Never modify eval code/protocol without human approval."""

    def test_blocks_eval_protocol_change(self) -> None:
        rule = _find_rule("no_eval_protocol_change")
        ctx = _make_ctx(action="edit_eval", path="eval.py")
        assert rule.predicate(ctx) is True

    def test_allows_non_eval_changes(self) -> None:
        rule = _find_rule("no_eval_protocol_change")
        ctx = _make_ctx(action="edit_file", path="train.py")
        assert rule.predicate(ctx) is False


class TestResourceLimitsGPU:
    """Rule 9: GPU/CPU usage within configured project limits."""

    def test_blocks_exceed_resource_limits(self) -> None:
        rule = _find_rule("resource_limits")
        ctx = _make_ctx(action="train", gpu_memory_gb=200, project_limit_gb=100)
        assert rule.predicate(ctx) is True

    def test_allows_within_limits(self) -> None:
        rule = _find_rule("resource_limits")
        ctx = _make_ctx(action="train", gpu_memory_gb=80, project_limit_gb=100)
        assert rule.predicate(ctx) is False


class TestCheckpointDiskLimits:
    """Rule 10: Disk usage for checkpoints within project limits."""

    def test_blocks_checkpoint_exceed_disk(self) -> None:
        rule = _find_rule("checkpoint_disk_limits")
        ctx = _make_ctx(action="save_checkpoint", disk_mb=500, project_limit_mb=200)
        assert rule.predicate(ctx) is True

    def test_allows_checkpoint_within_limits(self) -> None:
        rule = _find_rule("checkpoint_disk_limits")
        ctx = _make_ctx(action="save_checkpoint", disk_mb=100, project_limit_mb=200)
        assert rule.predicate(ctx) is False


class TestGPUDecisionRecorded:
    """Rule 11: GPU/CPU decision recorded at session start."""

    def test_blocks_missing_gpu_decision_record(self) -> None:
        rule = _find_rule("gpu_decision_recorded")
        ctx = _make_ctx(action="start_training", gpu_decision_recorded=False)
        assert rule.predicate(ctx) is True

    def test_allows_with_gpu_decision_record(self) -> None:
        rule = _find_rule("gpu_decision_recorded")
        ctx = _make_ctx(action="start_training", gpu_decision_recorded=True)
        assert rule.predicate(ctx) is False


class TestNoPolicyFileEdit:
    """Rule 12: Never edit policy/permission files without human approval."""

    def test_blocks_edit_permissions_yaml(self) -> None:
        rule = _find_rule("no_policy_file_edit")
        ctx = _make_ctx(action="edit_file", path=".nxl/permissions.yaml")
        assert rule.predicate(ctx) is True

    def test_blocks_edit_policy_yaml(self) -> None:
        rule = _find_rule("no_policy_file_edit")
        ctx = _make_ctx(action="edit_file", path=".nxl/policy.yaml")
        assert rule.predicate(ctx) is True

    def test_allows_edit_other_files(self) -> None:
        rule = _find_rule("no_policy_file_edit")
        ctx = _make_ctx(action="edit_file", path="src/main.py")
        assert rule.predicate(ctx) is False


class TestNoCheckpointDeletion:
    """Rule 13: Never delete checkpoints without human approval."""

    def test_blocks_delete_checkpoint(self) -> None:
        rule = _find_rule("no_checkpoint_deletion")
        ctx = _make_ctx(action="delete_file", path="checkpoints/model_v1.pt")
        assert rule.predicate(ctx) is True

    def test_allows_delete_other(self) -> None:
        rule = _find_rule("no_checkpoint_deletion")
        ctx = _make_ctx(action="delete_file", path="logs/results.jsonl")
        assert rule.predicate(ctx) is False


class TestNoAdHocShell:
    """Rule 14: No ad hoc shell commands without human approval."""

    def test_blocks_ad_hoc_shell(self) -> None:
        rule = _find_rule("no_ad_hoc_shell")
        ctx = _make_ctx(action="run_shell", is_ad_hoc=True)
        assert rule.predicate(ctx) is True

    def test_allows_normal_execution(self) -> None:
        rule = _find_rule("no_ad_hoc_shell")
        ctx = _make_ctx(action="run_shell", is_ad_hoc=False)
        assert rule.predicate(ctx) is False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _find_rule(rule_id: str) -> Rule:
    for rule in ALL_RULES:
        if rule.id == rule_id:
            return rule
    raise KeyError(f"Rule {rule_id!r} not found in ALL_RULES")


def _make_ctx(**kwargs: Any) -> dict[str, Any]:
    defaults: dict[str, Any] = {
        "action": "unknown",
        "path": "",
        "scope": "local",
        "disable_permission_check": False,
        "has_log_entry": False,
        "manipulated": False,
        "run_status": "completed",
        "incomplete": False,
        "gpu_memory_gb": 0,
        "project_limit_gb": 100,
        "disk_mb": 0,
        "project_limit_mb": 1000,
        "gpu_decision_recorded": True,
        "is_ad_hoc": False,
        "value": None,
        "key": "",
    }
    defaults.update(kwargs)
    return defaults
