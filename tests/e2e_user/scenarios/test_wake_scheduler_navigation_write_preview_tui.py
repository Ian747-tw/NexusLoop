from __future__ import annotations

import json

import pytest

from tests.e2e_user.snapshot_assertions import assert_opencode_process_smoke_idle


@pytest.mark.phase_m4
def test_user_previews_scheduler_navigation_write_eligibility_without_writes(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"

    project = sandbox.make_empty_project_dir("wake_scheduler_navigation_write_preview_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_wake_scheduler_navigation_write_preview_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise scheduler navigation write eligibility preview through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["scheduler navigation write preview renders"],
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
        {"type": "insert", "text": "/scheduler-nav-write-preview /wake-tick-dry-run"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-nav-write-preview /scheduler-start dry-run every=60s"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-nav-write-preview /handoff token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-nav-write-preview /proposal-review proposal_1 token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-nav-write-preview /tmp/repro"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-nav-write-board"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.env["NXL_SECRET_WRITE_PREVIEW_TOKEN"] = "navigation-write-preview-secret-abc123"
    sandbox.runner.env["NXL_SECRET_WRITE_PREVIEW_TOKEN"] = "navigation-write-preview-secret-abc123"

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "Wake scheduler" in result.stdout
    assert "scheduler_write_eligibility" in result.stdout
    assert "can_stage_now=false" in result.stdout
    assert "can_execute_now=false" in result.stdout
    assert "gate=wake_scheduler_runtime" in result.stdout
    assert "gate=proposal_review_runtime" in result.stdout
    assert "high_impact_blocked" in result.stdout
    assert "unsupported" in result.stdout
    assert "preview only; no write staging or execution" in result.stdout
    assert "runtime_wake_scheduler_started" not in result.stdout
    assert "runtime_wake_schedule_tick_completed" not in result.stdout
    assert "runtime_checkpoint_created" not in result.stdout
    assert "runtime_wake_scheduler_recovery_recorded" not in result.stdout
    assert "runtime_wake_scheduler_recovery_workflow_step_recorded" not in result.stdout
    assert "runtime_continuation_step_started" not in result.stdout
    assert "handoff_sent=true" not in result.stdout
    assert_opencode_process_smoke_idle(result.stdout)
    assert "navigation-write-preview-secret" not in result.stdout
    assert "navigation-write-preview-secret-abc123" not in result.stdout
    assert "token=abc123" not in result.stdout

    events_path = project / ".nxl" / "events.jsonl"
    events = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds = [event["kind"] for event in events]
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
    }
    assert forbidden.isdisjoint(event_kinds)
    assert "navigation-write-preview-secret" not in json.dumps(events)
    assert "token=abc123" not in json.dumps(events)
