from __future__ import annotations

import json

import pytest


@pytest.mark.phase_m4
def test_user_plans_opencode_session_without_launching_execution(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.env["NXL_SECRET_OPENCODE_SESSION_TOKEN"] = "opencode-session-secret-abc123"
    sandbox.runner.env["NXL_SECRET_OPENCODE_SESSION_TOKEN"] = "opencode-session-secret-abc123"

    project = sandbox.make_empty_project_dir("opencode_session_model_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_opencode_session_model_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise durable planned OpenCode session modeling through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["planned session metadata renders"],
                "evaluation_protocol": "run headless TUI",
                "approved_by": "e2e",
                "approved_at": "2026-06-27T00:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-session-preview objective=inspect training progress token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-session-plan-dry-run objective=inspect training progress token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-session-plan objective=inspect training progress token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-sessions"},
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-session-summary"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /opencode-session-plan"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "OpenCode sessions" in result.stdout
    assert "latest=opencode_session_" in result.stdout
    assert "status=planned" in result.stdout
    assert "records=1" in result.stdout
    assert "summary total=1 planned=1" in result.stdout
    assert "commander_context=" in result.stdout
    assert "opencode_context_seed=" in result.stdout
    assert "timeout wall_ms=" in result.stdout
    assert "question_policy questions=true" in result.stdout
    assert "human_control pause=true" in result.stdout
    assert "note=session planning does not launch OpenCode or mutate missions" in result.stdout
    assert "selected=/opencode-session-plan risk=high_impact_write" in result.stdout
    assert "Creates exactly one durable planned OpenCode session intent" in result.stdout
    assert "out_of_scope=OpenCode launch" in result.stdout
    assert "opencode-session-secret" not in result.stdout
    assert "opencode-session-secret-abc123" not in result.stdout
    assert "token=abc123" not in result.stdout

    events_path = project / ".nxl" / "events.jsonl"
    events = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds = [event["kind"] for event in events]
    assert event_kinds.count("opencode_session_planned") == 1
    assert event_kinds.count("opencode_session_plan_blocked") == 0
    assert event_kinds.count("opencode_session_plan_failed") == 0
    forbidden = {
        "opencode_handoff_started",
        "opencode_handoff_created",
        "opencode_handoff_failed",
        "opencode_process_smoke_started",
        "opencode_process_smoke_succeeded",
        "opencode_process_smoke_failed",
        "opencode_process_smoke_blocked",
        "external_api_request_executed",
        "research_synthesis_created",
        "commander_cycle_completed",
        "mission_progress_recorded",
        "mission_result_submitted",
        "mission_completed",
        "mission_failed",
        "mission_cancelled",
        "review_request_created",
        "review_request_cancelled",
        "commander_proposal_review_requested",
        "commander_proposal_applied",
        "commander_proposal_apply_failed",
        "runtime_checkpoint_created",
        "runtime_wake_scheduler_started",
        "runtime_wake_scheduler_stopped",
        "runtime_wake_schedule_tick_completed",
        "runtime_continuation_plan_created",
        "runtime_continuation_step_started",
        "runtime_wake_scheduler_recovery_recorded",
        "runtime_wake_scheduler_recovery_workflow_created",
        "runtime_wake_scheduler_recovery_workflow_step_recorded",
    }
    assert forbidden.isdisjoint(event_kinds)
    serialized_events = json.dumps(events)
    assert "opencode-session-secret" not in serialized_events
    assert "opencode-session-secret-abc123" not in serialized_events
    assert "token=abc123" not in serialized_events
