from __future__ import annotations

import json

import pytest

from tests.e2e_user.snapshot_assertions import assert_opencode_process_smoke_idle


@pytest.mark.phase_m4
def test_user_inspects_wake_scheduler_audit_through_tui(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"

    project = sandbox.make_empty_project_dir("wake_scheduler_audit_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_wake_scheduler_audit_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise scheduler audit through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["scheduler audit renders"],
                "evaluation_protocol": "run headless TUI",
                "approved_by": "e2e",
                "approved_at": "2026-05-10T00:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    events_path = project / ".nxl" / "events.jsonl"
    events_path.parent.mkdir(parents=True, exist_ok=True)
    seeded_events = [
        {
            "kind": "runtime_wake_scheduler_started",
            "event_id": "e2e_audit_scheduler_start",
            "created_at": "2026-05-11T15:00:00.000Z",
            "scheduler_status": "running",
            "tick_id": "e2e_audit_prior_tick",
            "requested_by": "e2e token=audit-secret",
        },
        {
            "kind": "runtime_wake_scheduler_tick_failed",
            "event_id": "e2e_audit_scheduler_failed_tick",
            "created_at": "2026-05-11T15:01:00.000Z",
            "scheduler_status": "running",
            "tick_id": "e2e_audit_failed_tick",
            "error": "failed token=audit-secret",
        },
        {
            "kind": "runtime_wake_scheduler_bootstrap_blocked",
            "event_id": "e2e_audit_bootstrap_blocked",
            "created_at": "2026-05-11T15:02:00.000Z",
            "message": "blocked token=audit-secret",
        },
        {
            "kind": "runtime_wake_scheduler_stale_run_detected",
            "event_id": "e2e_audit_stale_detected",
            "created_at": "2026-05-11T15:03:00.000Z",
            "recovery_id": "e2e_audit_recovery",
            "stale_prior_event_id": "e2e_audit_scheduler_start",
        },
        {
            "kind": "runtime_wake_scheduler_recovery_workflow_created",
            "event_id": "e2e_audit_workflow_created",
            "created_at": "2026-05-11T15:04:00.000Z",
            "workflow_id": "e2e_audit_workflow",
            "recovery_id": "e2e_audit_recovery",
            "workflow": {"workflow_id": "e2e_audit_workflow", "recovery_id": "e2e_audit_recovery"},
        },
    ]
    with events_path.open("a", encoding="utf-8") as handle:
        for event in seeded_events:
            handle.write(json.dumps(event, separators=(",", ":")) + "\n")

    keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-audit"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-audit-summary"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-audit-timeline limit=5"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-audit-chain e2e_audit_recovery"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-audit-incidents"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.env["NXL_SECRET_AUDIT_TOKEN"] = "audit-secret-abc123"
    sandbox.runner.env["NXL_SECRET_AUDIT_TOKEN"] = "audit-secret-abc123"

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "Wake scheduler" in result.stdout
    assert "scheduler_audit" in result.stdout
    assert "summary events=" in result.stdout
    assert "timeline_rows" in result.stdout
    assert "selected_chain=e2e_audit_recovery" in result.stdout
    assert "incident_rows" in result.stdout
    assert "runtime_wake_schedule_tick_completed" not in result.stdout
    assert "runtime_wake_scheduler_started status=running" not in result.stdout
    assert "last_step=" not in result.stdout
    assert "handoff_sent=true" not in result.stdout
    assert_opencode_process_smoke_idle(result.stdout)
    assert "audit-secret" not in result.stdout
    assert "audit-secret-abc123" not in result.stdout
