from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from nxl_core.events.log import EventLog
from nxl_core.spec.backend import SpecStore


os.environ["NXL_EVENTLOG_WRITER"] = "test"


def _extractor(text: str) -> dict:
    if "ambiguous" in text:
        return {
            "objective": "",
            "project_mode": "build",
            "success_metrics": [],
            "evaluation_protocol": "",
        }
    if "30 min" in text:
        return {
            "wake_hook_policy": {"default_training_period_minutes": 30},
            "forbidden_actions": ["use imitation learning"],
        }
    return {
        "objective": "Train a CartPole policy",
        "project_mode": "build",
        "domain": "reinforcement learning",
        "environment": "CartPole-v1",
        "success_metrics": ["mean_reward >= 475"],
        "evaluation_protocol": "Run 100 evaluation episodes with fixed seeds.",
        "compute_policy": {
            "gpu_allowed": False,
            "gpu_memory_limit_gb": None,
            "cpu_worker_limit": 2,
            "max_parallel_training_runs": 1,
            "checkpoint_disk_limit_gb": 1,
        },
        "wake_hook_policy": {
            "enabled": True,
            "user_min_period_minutes": 15,
            "user_max_period_minutes": 120,
            "default_training_period_minutes": 60,
            "allow_agent_suggested_hooks": False,
            "require_approval_below_minutes": 30,
        },
        "user_rules": ["Do not use cloud GPUs."],
        "forbidden_actions": ["delete checkpoints"],
    }


def test_plain_text_draft_approval_writes_current_and_events(tmp_path: Path) -> None:
    events = EventLog(tmp_path / ".nxl" / "events.jsonl")
    store = SpecStore(tmp_path, event_log=events, extractor=_extractor)

    result = store.createDraftFromPlainText("Build CartPole agent sk-test-SECRET123")
    assert result.requires_clarification is False
    assert result.spec.objective == "Train a CartPole policy"
    assert result.spec.status == "draft"

    approved = store.approveDraft(result.spec.spec_id, approved_by="tester")

    current_json = tmp_path / ".nxl" / "spec" / "current.json"
    current_md = tmp_path / ".nxl" / "spec" / "current.md"
    version_json = tmp_path / ".nxl" / "spec" / "versions" / f"{approved.spec_id}.json"
    assert current_json.exists()
    assert current_md.exists()
    assert version_json.exists()
    assert json.loads(current_json.read_text())["status"] == "approved"
    assert store.getCurrentSpec() == approved

    kinds = [json.loads(line)["kind"] for line in (tmp_path / ".nxl" / "events.jsonl").read_text().splitlines()]
    assert "user_plain_spec_received" in kinds
    assert "spec_draft_created" in kinds
    assert "spec_approval_requested" in kinds
    assert "spec_approved" in kinds
    assert "sk-test-SECRET123" not in (tmp_path / ".nxl" / "events.jsonl").read_text()


def test_ambiguous_text_requests_clarification_and_answer_updates_draft(tmp_path: Path) -> None:
    store = SpecStore(tmp_path, event_log=EventLog(tmp_path / ".nxl" / "events.jsonl"), extractor=_extractor)

    result = store.createDraftFromPlainText("ambiguous project")
    assert result.requires_clarification is True
    assert result.clarifications

    updated = store.requestClarification(
        result.spec.spec_id,
        question_id=result.clarifications[0].question_id,
        answer="Optimize CartPole for reward >= 475",
    )

    answered = next(
        item
        for item in updated.clarification_history
        if item.question_id == result.clarifications[0].question_id
    )
    assert answered.answer == "Optimize CartPole for reward >= 475"
    kinds = [json.loads(line)["kind"] for line in (tmp_path / ".nxl" / "events.jsonl").read_text().splitlines()]
    assert "spec_clarification_requested" in kinds
    assert "spec_clarification_answered" in kinds
    assert "spec_draft_updated" in kinds


def test_runtime_requires_approved_spec(tmp_path: Path) -> None:
    store = SpecStore(tmp_path, event_log=EventLog(tmp_path / ".nxl" / "events.jsonl"), extractor=_extractor)
    assert store.runtimeReady() is False
    draft = store.createDraftFromPlainText("Build CartPole agent").spec
    assert store.runtimeReady() is False
    store.approveDraft(draft.spec_id, approved_by="tester")
    assert store.runtimeReady() is True


def test_spec_change_during_runtime_is_staged_until_approved(tmp_path: Path) -> None:
    store = SpecStore(tmp_path, event_log=EventLog(tmp_path / ".nxl" / "events.jsonl"), extractor=_extractor)
    first = store.createDraftFromPlainText("Build CartPole agent").spec
    approved = store.approveDraft(first.spec_id, approved_by="tester")

    change = store.proposeSpecChange("Change wake hook to 30 min and don't use imitation learning.")

    assert change.status == "draft"
    assert store.getCurrentSpec() == approved
    assert change.wake_hook_policy.default_training_period_minutes == 30
    assert "use imitation learning" in change.forbidden_actions

    second = store.approveDraft(change.spec_id, approved_by="tester")
    assert second.status == "approved"
    assert second.spec_id != approved.spec_id
    assert store.getCurrentSpec() == second

    kinds = [json.loads(line)["kind"] for line in (tmp_path / ".nxl" / "events.jsonl").read_text().splitlines()]
    assert "spec_change_intent_detected" in kinds
    assert "spec_superseded" in kinds


def test_wake_hook_policy_validation_rejects_invalid_values(tmp_path: Path) -> None:
    def bad_extractor(_: str) -> dict:
        data = _extractor("")
        data["wake_hook_policy"] = {
            "enabled": True,
            "user_min_period_minutes": 60,
            "user_max_period_minutes": 30,
            "default_training_period_minutes": 45,
            "allow_agent_suggested_hooks": False,
            "require_approval_below_minutes": 30,
        }
        return data

    store = SpecStore(tmp_path, event_log=EventLog(tmp_path / ".nxl" / "events.jsonl"), extractor=bad_extractor)
    with pytest.raises(ValueError, match="wake hook"):
        store.createDraftFromPlainText("bad")


def test_reopen_project_loads_current_approved_spec(tmp_path: Path) -> None:
    store = SpecStore(tmp_path, event_log=EventLog(tmp_path / ".nxl" / "events.jsonl"), extractor=_extractor)
    draft = store.createDraftFromPlainText("Build CartPole agent").spec
    approved = store.approveDraft(draft.spec_id, approved_by="tester")

    reopened = SpecStore(tmp_path, event_log=EventLog(tmp_path / ".nxl" / "events.jsonl"), extractor=_extractor)
    assert reopened.getCurrentSpec() == approved
