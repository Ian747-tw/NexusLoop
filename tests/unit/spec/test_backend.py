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
    assert updated.objective == "Optimize CartPole for reward >= 475"
    kinds = [json.loads(line)["kind"] for line in (tmp_path / ".nxl" / "events.jsonl").read_text().splitlines()]
    assert "spec_clarification_requested" in kinds
    assert "spec_clarification_answered" in kinds
    assert "spec_draft_updated" in kinds


def test_multiple_clarifications_emit_answered_field_for_matched_question(tmp_path: Path) -> None:
    store = SpecStore(tmp_path, event_log=EventLog(tmp_path / ".nxl" / "events.jsonl"), extractor=_extractor)

    result = store.createDraftFromPlainText("ambiguous project")
    objective_question = next(item for item in result.clarifications if item.field == "objective")
    updated = store.requestClarification(
        result.spec.spec_id,
        question_id=objective_question.question_id,
        answer="Build a robust CartPole policy",
    )

    assert updated.objective == "Build a robust CartPole policy"
    answered_events = [
        json.loads(line)
        for line in (tmp_path / ".nxl" / "events.jsonl").read_text().splitlines()
        if json.loads(line)["kind"] == "spec_clarification_answered"
    ]
    assert answered_events[-1]["field"] == "objective"


def test_success_metrics_clarification_updates_target_field(tmp_path: Path) -> None:
    store = SpecStore(tmp_path, event_log=EventLog(tmp_path / ".nxl" / "events.jsonl"), extractor=_extractor)
    result = store.createDraftFromPlainText("ambiguous project")
    metrics_question = next(item for item in result.clarifications if item.field == "success_metrics")

    updated = store.requestClarification(
        result.spec.spec_id,
        question_id=metrics_question.question_id,
        answer="reward >= 475, no secret sk-test-SECRET123",
    )

    assert updated.success_metrics == ["reward >= 475", "no secret [REDACTED]"]


def test_clarification_rejected_after_spec_approval_without_changing_current_files(
    tmp_path: Path,
) -> None:
    store = SpecStore(tmp_path, event_log=EventLog(tmp_path / ".nxl" / "events.jsonl"), extractor=_extractor)
    result = store.createDraftFromPlainText("ambiguous project")
    objective_question = next(item for item in result.clarifications if item.field == "objective")
    completed = result.spec
    for clarification in result.clarifications:
        completed = store.requestClarification(
            completed.spec_id,
            question_id=clarification.question_id,
            answer=f"answer for {clarification.field}",
        )
    approved = store.approveDraft(completed.spec_id, approved_by="tester")
    current_json = tmp_path / ".nxl" / "spec" / "current.json"
    current_md = tmp_path / ".nxl" / "spec" / "current.md"
    before_json = current_json.read_text(encoding="utf-8")
    before_md = current_md.read_text(encoding="utf-8")

    with pytest.raises(ValueError, match="only draft specs can receive clarification answers"):
        store.requestClarification(
            approved.spec_id,
            question_id=objective_question.question_id,
            answer="mutate approved objective",
        )

    assert current_json.read_text(encoding="utf-8") == before_json
    assert current_md.read_text(encoding="utf-8") == before_md


def test_clarification_rejected_after_spec_superseded_without_changing_current_files(
    tmp_path: Path,
) -> None:
    store = SpecStore(tmp_path, event_log=EventLog(tmp_path / ".nxl" / "events.jsonl"), extractor=_extractor)
    result = store.createDraftFromPlainText("ambiguous project")
    objective_question = next(item for item in result.clarifications if item.field == "objective")
    completed = result.spec
    for clarification in result.clarifications:
        completed = store.requestClarification(
            completed.spec_id,
            question_id=clarification.question_id,
            answer=f"answer for {clarification.field}",
        )
    first = store.approveDraft(completed.spec_id, approved_by="tester")
    second_draft = store.createDraftFromPlainText("Build CartPole agent").spec
    second = store.approveDraft(second_draft.spec_id, approved_by="tester")
    current_json = tmp_path / ".nxl" / "spec" / "current.json"
    current_md = tmp_path / ".nxl" / "spec" / "current.md"
    before_json = current_json.read_text(encoding="utf-8")
    before_md = current_md.read_text(encoding="utf-8")

    with pytest.raises(ValueError, match="only draft specs can receive clarification answers"):
        store.requestClarification(
            first.spec_id,
            question_id=objective_question.question_id,
            answer="mutate superseded objective",
        )

    assert store.getCurrentSpec() == second
    assert current_json.read_text(encoding="utf-8") == before_json
    assert current_md.read_text(encoding="utf-8") == before_md


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


def test_extractor_free_text_is_redacted_before_spec_files_or_events(tmp_path: Path) -> None:
    def secret_extractor(_: str) -> dict:
        data = _extractor("")
        data["objective"] = "Use sk-test-SECRET123"
        data["domain"] = "secret domain sk-test-SECRET123"
        data["environment"] = "env sk-test-SECRET123"
        data["success_metrics"] = ["metric sk-test-SECRET123"]
        data["evaluation_protocol"] = "eval sk-test-SECRET123"
        data["user_rules"] = ["rule sk-test-SECRET123"]
        data["forbidden_actions"] = ["forbidden sk-test-SECRET123"]
        return data

    store = SpecStore(tmp_path, event_log=EventLog(tmp_path / ".nxl" / "events.jsonl"), extractor=secret_extractor)
    draft = store.createDraftFromPlainText("plain text").spec
    store.approveDraft(draft.spec_id, approved_by="tester")

    all_text = "\n".join(
        path.read_text(encoding="utf-8")
        for path in [
            tmp_path / ".nxl" / "events.jsonl",
            tmp_path / ".nxl" / "spec" / "current.json",
            tmp_path / ".nxl" / "spec" / "current.md",
            tmp_path / ".nxl" / "spec" / "versions" / f"{draft.spec_id}.json",
        ]
    )
    assert "sk-test-SECRET123" not in all_text
    assert "[REDACTED]" in all_text
