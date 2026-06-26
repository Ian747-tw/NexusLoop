from __future__ import annotations

import json

import pytest


@pytest.mark.phase_m4
def test_user_previews_minimax_live_validation_without_live_calls(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.env["NXL_SECRET_MINIMAX_LIVE_TOKEN"] = "minimax-live-secret-abc123"
    sandbox.runner.env["NXL_SECRET_MINIMAX_LIVE_TOKEN"] = "minimax-live-secret-abc123"

    project = sandbox.make_empty_project_dir("minimax_live_validation_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_minimax_live_validation_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise MiniMax live validation through real runtime TUI without live calls",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["MiniMax live validation surface renders"],
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
        {"type": "insert", "text": "/minimax-live-preview"},
        {"type": "submit"},
        {"type": "insert", "text": "/minimax-live-preview surface=commander_executor_review"},
        {"type": "submit"},
        {"type": "insert", "text": "/minimax-live-dry-run"},
        {"type": "submit"},
        {"type": "insert", "text": "/minimax-live-validate"},
        {"type": "submit"},
        {"type": "insert", "text": "/minimax-live-validations"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /minimax-live-validate"},
        {"type": "submit"},
        {"type": "insert", "text": "/reasoning-smoke-preview commander_executor_review"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "MiniMax live validation" in result.stdout
    assert "preview=blocked can_execute=false opt_in=no" in result.stdout or "preview=not_configured can_execute=false opt_in=no" in result.stdout
    assert "note=live validation does not create proposals, run Commander cycle, launch OpenCode, or mutate missions" in result.stdout
    assert "Command authority" in result.stdout
    assert "selected=/minimax-live-validate risk=high_impact_write" in result.stdout
    assert "Reasoning provider" in result.stdout
    assert "smoke_preview=commander_executor_review network=no" in result.stdout
    assert "minimax-live-secret" not in result.stdout
    assert "minimax-live-secret-abc123" not in result.stdout
    assert "abc123" not in result.stdout

    events_path = project / ".nxl" / "events.jsonl"
    events = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ] if events_path.exists() else []
    event_kinds = [event["kind"] for event in events]
    forbidden = {
        "minimax_live_validation_started",
        "minimax_live_validation_succeeded",
        "minimax_live_validation_failed",
        "minimax_live_validation_blocked",
        "reasoning_provider_smoke_started",
        "reasoning_provider_smoke_succeeded",
        "reasoning_provider_smoke_failed",
        "external_api_request_executed",
        "external_api_request_failed",
        "opencode_handoff_started",
        "opencode_handoff_created",
        "opencode_handoff_failed",
        "opencode_process_smoke_started",
        "opencode_process_smoke_succeeded",
        "opencode_process_smoke_failed",
        "commander_executor_review_started",
        "commander_executor_review_succeeded",
        "commander_executor_review_failed",
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
    serialized_events = json.dumps(events)
    assert "minimax-live-secret" not in serialized_events
    assert "minimax-live-secret-abc123" not in serialized_events
    assert "abc123" not in serialized_events
