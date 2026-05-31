from __future__ import annotations

import json

import pytest


@pytest.mark.phase_m4
def test_user_navigates_wake_scheduler_audit_guidance_through_tui(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"

    project = sandbox.make_empty_project_dir("wake_scheduler_navigation_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_wake_scheduler_navigation_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise scheduler navigation through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["scheduler navigation renders"],
                "evaluation_protocol": "run headless TUI",
                "approved_by": "e2e",
                "approved_at": "2026-05-10T00:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    recovery_id = "e2e_nav_recovery"
    workflow_id = "e2e_nav_workflow"
    schedule_id = "e2e_nav_schedule"
    events_path = project / ".nxl" / "events.jsonl"
    events_path.parent.mkdir(parents=True, exist_ok=True)
    seeded_events = [
        {
            "kind": "runtime_wake_schedule_created",
            "event_id": "e2e_nav_schedule_created",
            "created_at": "2026-05-11T15:00:00.000Z",
            "schedule_id": schedule_id,
            "schedule": {"schedule_id": schedule_id},
        },
        {
            "kind": "runtime_wake_scheduler_tick_failed",
            "event_id": "e2e_nav_tick_failed",
            "created_at": "2026-05-11T15:01:00.000Z",
            "scheduler_status": "stopped",
            "tick_id": "e2e_nav_failed_tick",
            "schedule_id": schedule_id,
            "error": "failed token=navigation-secret",
        },
        {
            "kind": "runtime_wake_scheduler_stale_run_detected",
            "event_id": "e2e_nav_stale_detected",
            "created_at": "2026-05-11T15:02:00.000Z",
            "recovery_id": recovery_id,
            "stale_prior_event_id": "e2e_nav_prior_start",
        },
        {
            "kind": "runtime_wake_scheduler_recovery_workflow_created",
            "event_id": "e2e_nav_workflow_created",
            "created_at": "2026-05-11T15:03:00.000Z",
            "workflow_id": workflow_id,
            "recovery_id": recovery_id,
            "workflow": {"workflow_id": workflow_id, "recovery_id": recovery_id},
        },
    ]
    with events_path.open("a", encoding="utf-8") as handle:
        for event in seeded_events:
            handle.write(json.dumps(event, separators=(",", ":")) + "\n")

    keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-nav"},
        {"type": "submit"},
        {"type": "insert", "text": f"/scheduler-nav related={recovery_id}"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-nav-command /wake-tick-dry-run token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-nav-command /scheduler-status"},
        {"type": "submit"},
        {"type": "insert", "text": f"/scheduler-nav-target recovery {recovery_id}"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.env["NXL_SECRET_NAVIGATION_TOKEN"] = "navigation-secret-abc123"
    sandbox.runner.env["NXL_SECRET_NAVIGATION_TOKEN"] = "navigation-secret-abc123"

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "Wake scheduler" in result.stdout
    assert "scheduler_navigation" in result.stdout
    assert "board=" in result.stdout
    assert "command_preview=safe_read/read target=scheduler_status" in result.stdout
    assert f"target=scheduler_recovery:{recovery_id}" in result.stdout
    assert "runtime_wake_schedule_tick_completed" not in result.stdout
    assert "runtime_wake_scheduler_started" not in result.stdout
    assert "runtime_wake_scheduler_recovery_recorded" not in result.stdout
    assert "runtime_wake_scheduler_recovery_workflow_step_recorded" not in result.stdout
    assert "last_step=" not in result.stdout
    assert "handoff_sent=true" not in result.stdout
    assert "opencode process" not in result.stdout.lower()
    assert "navigation-secret" not in result.stdout
    assert "navigation-secret-abc123" not in result.stdout
    assert "token=abc123" not in result.stdout
