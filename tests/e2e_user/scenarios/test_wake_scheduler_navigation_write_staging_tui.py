from __future__ import annotations

import json

import pytest


@pytest.mark.phase_m4
def test_user_stages_scheduler_navigation_writes_without_execution(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"

    project = sandbox.make_empty_project_dir("wake_scheduler_navigation_write_staging_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_wake_scheduler_navigation_write_staging_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise scheduler navigation write staging through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["scheduler navigation write staging renders"],
                "evaluation_protocol": "run headless TUI",
                "approved_by": "e2e",
                "approved_at": "2026-05-10T00:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-nav-write-stage-preview /wake-tick-dry-run"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-nav-write-stage /wake-tick-dry-run"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-nav-write-stage /checkpoint full token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-nav-write-stage-medium /checkpoint full token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-nav-write-stage /wake-tick"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-nav-write-stage /proposal-review proposal_1 token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-nav-write-staged"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-nav-write-stage-clear token=abc123"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.env["NXL_SECRET_WRITE_STAGE_TOKEN"] = "navigation-write-stage-secret-abc123"
    sandbox.runner.env["NXL_SECRET_WRITE_STAGE_TOKEN"] = "navigation-write-stage-secret-abc123"

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "Wake scheduler" in result.stdout
    assert "scheduler_write_staging" in result.stdout
    assert "staged_writes=0" in result.stdout
    assert "staged write commands are operator intent only and are not executed by 7U" in result.stdout
    assert "runtime_wake_scheduler_started" not in result.stdout
    assert "runtime_wake_schedule_tick_completed" not in result.stdout
    assert "runtime_checkpoint_created" not in result.stdout
    assert "runtime_wake_scheduler_recovery_recorded" not in result.stdout
    assert "runtime_wake_scheduler_recovery_workflow_step_recorded" not in result.stdout
    assert "runtime_continuation_step_started" not in result.stdout
    assert "handoff_sent=true" not in result.stdout
    assert "opencode process" not in result.stdout.lower()
    assert "navigation-write-stage-secret" not in result.stdout
    assert "navigation-write-stage-secret-abc123" not in result.stdout
    assert "token=abc123" not in result.stdout

    events_path = project / ".nxl" / "events.jsonl"
    events = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds = [event["kind"] for event in events]
    assert event_kinds.count("runtime_wake_scheduler_navigation_write_command_staged") == 2
    assert event_kinds.count("runtime_wake_scheduler_navigation_write_commands_cleared") == 1

    staging_kinds = {
        "runtime_wake_scheduler_navigation_write_command_staged",
        "runtime_wake_scheduler_navigation_write_command_removed",
        "runtime_wake_scheduler_navigation_write_commands_cleared",
    }
    lifecycle_kinds = {
        "runtime_started",
        "runtime_ready",
        "runtime_shutdown",
    }
    forbidden = {
        "runtime_wake_scheduler_started",
        "runtime_wake_scheduler_stopped",
        "runtime_wake_schedule_tick_completed",
        "runtime_checkpoint_created",
        "runtime_wake_scheduler_recovery_recorded",
        "runtime_wake_scheduler_recovery_workflow_created",
        "runtime_wake_scheduler_recovery_workflow_step_recorded",
        "runtime_continuation_plan_created",
        "runtime_continuation_step_started",
        "runtime_opencode_handoff_sent",
        "runtime_mission_completed",
        "runtime_mission_failed",
        "runtime_proposal_review_created",
        "runtime_proposal_applied",
    }
    assert forbidden.isdisjoint(event_kinds)
    non_lifecycle_kinds = {
        kind
        for kind in event_kinds
        if kind.startswith("runtime_wake_scheduler_navigation_write_") or kind in forbidden
    }
    assert non_lifecycle_kinds.issubset(staging_kinds)
    assert lifecycle_kinds.intersection(event_kinds)
    serialized_events = json.dumps(events)
    assert "navigation-write-stage-secret" not in serialized_events
    assert "navigation-write-stage-secret-abc123" not in serialized_events
    assert "token=abc123" not in serialized_events
