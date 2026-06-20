from __future__ import annotations

import json

import pytest


@pytest.mark.phase_m4
def test_user_inspects_command_authority_inventory_without_mutation(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"

    project = sandbox.make_empty_project_dir("command_authority_inventory_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_command_authority_inventory_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise read-only command authority inventory through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["command authority inventory renders"],
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
        {"type": "insert", "text": "/authority"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-summary"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-list risk=high_impact_write"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /scheduler-nav-checkpoint-run"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-profile /scheduler-nav-checkpoint-run"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /handoff token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /tmp/repro"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.env["NXL_SECRET_COMMAND_AUTHORITY_TOKEN"] = "command-authority-secret-abc123"
    sandbox.runner.env["NXL_SECRET_COMMAND_AUTHORITY_TOKEN"] = "command-authority-secret-abc123"

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "Command authority" in result.stdout
    assert "selected=/tmp/repro risk=unsupported" in result.stdout
    assert "risk=high_impact_write" in result.stdout
    assert "gate=checkpoint_runtime" in result.stdout
    assert "targeted_e2e=" in result.stdout
    assert "command-authority-secret" not in result.stdout
    assert "command-authority-secret-abc123" not in result.stdout
    assert "token=abc123" not in result.stdout

    events_path = project / ".nxl" / "events.jsonl"
    events = (
        [
            json.loads(line)
            for line in events_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        if events_path.exists()
        else []
    )
    event_kinds = [event["kind"] for event in events]
    forbidden = {
        "runtime_wake_scheduler_started",
        "runtime_wake_scheduler_stopped",
        "runtime_wake_schedule_tick_completed",
        "runtime_checkpoint_created",
        "runtime_continuation_plan_created",
        "runtime_continuation_step_started",
        "runtime_wake_scheduler_recovery_recorded",
        "runtime_wake_scheduler_recovery_workflow_created",
        "runtime_wake_scheduler_recovery_workflow_step_recorded",
        "opencode_handoff_started",
        "opencode_handoff_created",
        "opencode_handoff_failed",
        "mission_completed",
        "mission_failed",
        "mission_cancelled",
        "review_request_created",
        "review_request_cancelled",
        "commander_proposal_review_requested",
        "commander_proposal_applied",
        "commander_proposal_apply_failed",
        "commander_proposal_bundle_review_requested",
        "commander_proposal_bundle_applied",
        "commander_proposal_bundle_apply_failed",
        "runtime_wake_scheduler_navigation_command_staged",
        "runtime_wake_scheduler_navigation_write_command_staged",
        "runtime_wake_scheduler_navigation_write_approval_recorded",
        "runtime_wake_scheduler_navigation_checkpoint_write_run_started",
        "runtime_wake_scheduler_navigation_checkpoint_write_run_succeeded",
    }
    assert forbidden.isdisjoint(event_kinds)
    serialized_events = json.dumps(events)
    assert "command-authority-secret" not in serialized_events
    assert "token=abc123" not in serialized_events
