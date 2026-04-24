"""
nxl_core.policy.rules
---------------------
Typed Rule objects — one per NON_NEGOTIABLE rule.

Each Rule has:
- id: unique identifier
- scope_pattern: regex or None (matches any)
- predicate: callable(ctx) -> bool — returns True when rule is triggered
- effect: RuleEffect.ALLOW | RuleEffect.DENY
- reason_template: human-readable message with {action}, {detail} placeholders
- priority: int — higher priority rules are evaluated first

ALL_RULES is the ordered list of all 14 rules.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import Any, Callable


class RuleEffect(Enum):
    ALLOW = "allow"
    DENY = "deny"


@dataclass(frozen=True, slots=True)
class Rule:
    id: str
    scope_pattern: str | None  # regex string; None = always matches scope
    predicate: Callable[[dict[str, Any]], bool]
    effect: RuleEffect
    reason_template: str
    priority: int  # higher = evaluated first


# ---------------------------------------------------------------------------
# Scope helpers
# ---------------------------------------------------------------------------

def _match_scope(scope_pattern: str | None, ctx: dict[str, Any]) -> bool:
    """Return True if the ctx's path/action matches the scope pattern."""
    if scope_pattern is None:
        return True
    path = ctx.get("path", "")
    action = ctx.get("action", "")
    target = f"{action} {path}"
    return bool(re.search(scope_pattern, target))


# ---------------------------------------------------------------------------
# Rule 1: Never delete source code outside logs/ or skills/
# ---------------------------------------------------------------------------

_R1 = Rule(
    id="no_source_code_deletion",
    scope_pattern=r"(?i)\b(delete_file|remove_file)\b",
    predicate=lambda ctx: (
        ctx.get("action") in ("delete_file", "remove_file")
        and not _in_allowed_dirs(ctx.get("path", ""))
        and "checkpoint" not in ctx.get("path", "").lower()
        and "non_negotiable" not in ctx.get("path", "").lower()
    ),
    effect=RuleEffect.DENY,
    reason_template="Rule 1: Deleting source code outside logs/ or skills/ is forbidden.",
    priority=10,
)


def _in_allowed_dirs(path: str) -> bool:
    """Return True if path is inside logs/ or skills/."""
    normalized = path.replace("\\", "/")
    return normalized.startswith("logs/") or normalized.startswith("skills/")


# ---------------------------------------------------------------------------
# Rule 2: Never modify NON_NEGOTIABLE_RULES.md
# ---------------------------------------------------------------------------

_R2 = Rule(
    id="no_non_negotiable_modification",
    scope_pattern=r"(?i)\b(edit_file|modify_file)\b",
    predicate=lambda ctx: "non_negotiable" in ctx.get("path", "").lower().replace("-", "_"),
    effect=RuleEffect.DENY,
    reason_template="Rule 2: Modifying NON_NEGOTIABLE_RULES.md is strictly forbidden.",
    priority=10,
)


# ---------------------------------------------------------------------------
# Rule 3: Never disable permission check (drl-autoresearch)
# ---------------------------------------------------------------------------

_R3 = Rule(
    id="no_permission_check_disabled",
    scope_pattern=None,
    predicate=lambda ctx: (
        bool(ctx.get("disable_permission_check")) is True
        or ctx.get("key") == "disable_permission_check"
    ),
    effect=RuleEffect.DENY,
    reason_template="Rule 3: Disabling the permission check (drl-autoresearch) is forbidden.",
    priority=10,
)


# ---------------------------------------------------------------------------
# Rule 4: Never perform global package installs
# ---------------------------------------------------------------------------

_R4 = Rule(
    id="no_global_installs",
    scope_pattern=r"(?i)\binstall_package\b",
    predicate=lambda ctx: ctx.get("scope") == "global",
    effect=RuleEffect.DENY,
    reason_template="Rule 4: Global package installs are forbidden.",
    priority=9,
)


# ---------------------------------------------------------------------------
# Rule 5: All experiment results must be logged before updating plan
# ---------------------------------------------------------------------------

_R5 = Rule(
    id="experiment_results_logged",
    scope_pattern=r"(?i)\b(update_plan|revise_plan)\b",
    predicate=lambda ctx: ctx.get("has_log_entry") is False,
    effect=RuleEffect.DENY,
    reason_template="Rule 5: Experiment results must be logged to experiment_registry.tsv before updating the plan.",
    priority=8,
)


# ---------------------------------------------------------------------------
# Rule 6: Metrics recorded as-measured, no post-hoc manipulation
# ---------------------------------------------------------------------------

_R6 = Rule(
    id="metrics_as_measured",
    scope_pattern=r"(?i)\bupdate_metrics\b",
    predicate=lambda ctx: ctx.get("manipulated", False) is True,
    effect=RuleEffect.DENY,
    reason_template="Rule 6: Metrics must be recorded as-measured; post-hoc manipulation is forbidden.",
    priority=8,
)


# ---------------------------------------------------------------------------
# Rule 7: Crashed runs recorded with status=crashed; no use of incomplete runs
# ---------------------------------------------------------------------------

_R7 = Rule(
    id="crash_recorded",
    scope_pattern=None,
    predicate=lambda ctx: (
        ctx.get("incomplete") is True and ctx.get("run_status") != "crashed"
    ),
    effect=RuleEffect.DENY,
    reason_template="Rule 7: Incomplete runs (non-crashed) must not influence best-model selection.",
    priority=8,
)


# ---------------------------------------------------------------------------
# Rule 8: Never modify eval code/protocol without human approval
# ---------------------------------------------------------------------------

_R8 = Rule(
    id="no_eval_protocol_change",
    scope_pattern=r"(?i)\b(edit_file|modify_file)\b",
    predicate=lambda ctx: _is_eval_path(ctx.get("path", "")),
    effect=RuleEffect.DENY,
    reason_template="Rule 8: Evaluation code/protocol cannot be modified without explicit human approval.",
    priority=8,
)


def _is_eval_path(path: str) -> bool:
    p = path.lower()
    return p in ("eval.py", "evaluate.py", "eval/", "evaluation/") or "eval" in p


# ---------------------------------------------------------------------------
# Rule 9: GPU/CPU usage within configured project limits
# ---------------------------------------------------------------------------

_R9 = Rule(
    id="resource_limits",
    scope_pattern=None,
    predicate=lambda ctx: (
        ctx.get("gpu_memory_gb", 0) > ctx.get("project_limit_gb", float("inf"))
    ),
    effect=RuleEffect.DENY,
    reason_template="Rule 9: GPU/CPU usage must stay within configured project limits.",
    priority=7,
)


# ---------------------------------------------------------------------------
# Rule 10: Disk usage for checkpoints within project limits
# ---------------------------------------------------------------------------

_R10 = Rule(
    id="checkpoint_disk_limits",
    scope_pattern=r"(?i)\bsave_checkpoint\b",
    predicate=lambda ctx: ctx.get("disk_mb", 0) > ctx.get("project_limit_mb", float("inf")),
    effect=RuleEffect.DENY,
    reason_template="Rule 10: Checkpoint disk usage must stay within configured project limits.",
    priority=7,
)


# ---------------------------------------------------------------------------
# Rule 11: GPU/CPU decision recorded at session start
# ---------------------------------------------------------------------------

_R11 = Rule(
    id="gpu_decision_recorded",
    scope_pattern=None,
    predicate=lambda ctx: (
        ctx.get("action") == "start_training"
        and ctx.get("gpu_decision_recorded") is False
    ),
    effect=RuleEffect.DENY,
    reason_template="Rule 11: GPU/CPU decision must be recorded at session start.",
    priority=6,
)


# ---------------------------------------------------------------------------
# Rule 12: Never edit policy/permission config files without human approval
# ---------------------------------------------------------------------------

_R12 = Rule(
    id="no_policy_file_edit",
    scope_pattern=r"(?i)\b(edit_file|modify_file)\b",
    predicate=lambda ctx: _is_policy_file(ctx.get("path", "")),
    effect=RuleEffect.DENY,
    reason_template="Rule 12: Policy/permission config files cannot be edited without explicit human approval.",
    priority=10,
)


def _is_checkpoint_path(path: str) -> bool:
    """True only for paths in checkpoints/ or models/checkpoints/ (not logs/)."""
    p = path.replace("\\", "/").lower()
    return (
        p.startswith("checkpoints/")
        or p.startswith("models/checkpoints/")
        or p == "checkpoints"
    )


def _is_policy_file(path: str) -> bool:
    p = path.replace("\\", "/").lower()
    # exclude vim swap files and backup files
    if p.endswith(".swp") or p.endswith("~"):
        return False
    return ".nxl/permissions" in p or ".nxl/policy" in p


# ---------------------------------------------------------------------------
# Rule 13: Never delete checkpoints without human approval
# ---------------------------------------------------------------------------

_R13 = Rule(
    id="no_checkpoint_deletion",
    scope_pattern=r"(?i)\b(delete_file|remove_file)\b",
    predicate=lambda ctx: (
        ctx.get("action") in ("delete_file", "remove_file")
        and _is_checkpoint_path(ctx.get("path", ""))
    ),
    effect=RuleEffect.DENY,
    reason_template="Rule 13: Checkpoint deletion requires explicit human approval.",
    priority=9,
)


# ---------------------------------------------------------------------------
# Rule 14: No ad hoc shell commands without human approval
# ---------------------------------------------------------------------------

_R14 = Rule(
    id="no_ad_hoc_shell",
    scope_pattern=r"(?i)\brun_shell\b",
    predicate=lambda ctx: ctx.get("is_ad_hoc", False) is True,
    effect=RuleEffect.DENY,
    reason_template="Rule 14: Ad hoc shell commands require explicit human approval.",
    priority=9,
)


# ---------------------------------------------------------------------------
# All rules (ordered by priority descending)
# ---------------------------------------------------------------------------

ALL_RULES: list[Rule] = sorted(
    [_R1, _R2, _R3, _R4, _R5, _R6, _R7, _R8, _R9, _R10, _R11, _R12, _R13, _R14],
    key=lambda r: -r.priority,
)
