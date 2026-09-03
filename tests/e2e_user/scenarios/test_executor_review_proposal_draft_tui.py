from __future__ import annotations

import json

import pytest


@pytest.mark.phase_m4
def test_user_previews_executor_review_proposal_drafts_without_mutation(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"

    project = sandbox.make_empty_project_dir("executor_review_proposal_draft_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_executor_review_proposal_draft_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise executor review proposal draft preview through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["executor review proposal draft preview renders"],
                "evaluation_protocol": "run headless TUI",
                "approved_by": "e2e",
                "approved_at": "2026-06-26T00:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/executor-review-draft-preview"},
        {"type": "submit"},
        {"type": "insert", "text": "/executor-review-draft-summary"},
        {"type": "submit"},
        {"type": "insert", "text": "/executor-review-draft-preview review=executor_review_test token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /executor-review-draft-preview"},
        {"type": "submit"},
        {"type": "insert", "text": "/executor-review-preview"},
        {"type": "submit"},
        {"type": "insert", "text": "/result-review-packet"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.env["NXL_SECRET_EXECUTOR_DRAFT_TOKEN"] = "executor-draft-secret-abc123"
    sandbox.runner.env["NXL_SECRET_EXECUTOR_DRAFT_TOKEN"] = "executor-draft-secret-abc123"

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "Executor review proposal drafts" in result.stdout
    assert "note=draft preview does not create proposals, request reviews, or apply changes" in result.stdout
    assert "Command authority" in result.stdout
    assert "selected=/executor-review-draft-preview risk=safe_read" in result.stdout
    assert "Commander executor review" in result.stdout
    assert "OpenCode result review packet" in result.stdout
    assert "executor-draft-secret" not in result.stdout
    assert "executor-draft-secret-abc123" not in result.stdout
    assert "abc123" not in result.stdout

    events = sandbox.list_events(project)
    event_kinds = [event["kind"] for event in events]
    assert event_kinds.count("runtime_model_setup_committed") == 1
    forbidden = {
        "opencode_handoff_started",
        "opencode_handoff_created",
        "opencode_handoff_failed",
        "opencode_process_smoke_started",
        "opencode_process_smoke_succeeded",
        "opencode_process_smoke_failed",
        "opencode_process_smoke_blocked",
        "commander_executor_review_started",
        "commander_executor_review_succeeded",
        "commander_executor_review_failed",
        "commander_executor_review_blocked",
        "review_request_created",
        "review_request_cancelled",
        "commander_proposal_created",
        "commander_proposal_review_requested",
        "commander_proposal_applied",
        "commander_proposal_apply_failed",
        "mission_claimed",
        "mission_progress_recorded",
        "mission_result_submitted",
        "mission_completed",
        "mission_failed",
        "mission_cancelled",
        "external_api_request_executed",
        "research_synthesis_created",
        "commander_cycle_completed",
        "runtime_wake_scheduler_started",
        "runtime_wake_scheduler_stopped",
        "runtime_wake_schedule_tick_completed",
        "runtime_checkpoint_created",
        "runtime_continuation_plan_created",
        "runtime_continuation_step_started",
        "runtime_wake_scheduler_recovery_recorded",
        "runtime_wake_scheduler_recovery_workflow_created",
        "runtime_wake_scheduler_recovery_workflow_step_recorded",
    }
    assert forbidden.isdisjoint(event_kinds)
    assert "runtime_started" not in event_kinds
    assert event_kinds == ["runtime_model_setup_committed"]
    serialized_events = json.dumps(events)
    assert "executor-draft-secret" not in serialized_events
    assert "executor-draft-secret-abc123" not in serialized_events
    assert "abc123" not in serialized_events
