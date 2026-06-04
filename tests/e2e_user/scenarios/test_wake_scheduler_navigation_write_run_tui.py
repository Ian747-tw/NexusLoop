from __future__ import annotations

import hashlib
import json

import pytest


def staged_write_id(command: str, authority_gate: str, risk: str) -> str:
    payload = json.dumps(
        {"command": command, "authority_gate": authority_gate, "risk": risk},
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return f"wake_scheduler_navigation_write_staged_{digest[:16]}"


@pytest.mark.phase_m4
def test_user_runs_one_low_risk_staged_write_through_tui(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"

    project = sandbox.make_empty_project_dir("wake_scheduler_navigation_write_run_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_wake_scheduler_navigation_write_run_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise scheduler navigation write runs through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["scheduler navigation write runs render"],
                "evaluation_protocol": "run headless TUI",
                "approved_by": "e2e",
                "approved_at": "2026-05-10T00:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    dry_run_staged_id = staged_write_id("/wake-tick-dry-run", "wake_schedule_tick", "low_risk_write")
    checkpoint_staged_id = staged_write_id("/checkpoint full [REDACTED]", "checkpoint_runtime", "medium_risk_write")
    keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-nav-write-stage /wake-tick-dry-run"},
        {"type": "submit"},
        {"type": "insert", "text": f"/scheduler-nav-write-run-preview {dry_run_staged_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/scheduler-nav-write-run-dry-run {dry_run_staged_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/scheduler-nav-write-run {dry_run_staged_id}"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-nav-write-runs"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-nav-write-stage-medium /checkpoint full token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/scheduler-nav-write-run {checkpoint_staged_id}"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.env["NXL_SECRET_WRITE_RUN_TOKEN"] = "navigation-write-run-secret-abc123"
    sandbox.runner.env["NXL_SECRET_WRITE_RUN_TOKEN"] = "navigation-write-run-secret-abc123"

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "Wake scheduler" in result.stdout
    assert "scheduler_write_staging" in result.stdout
    assert "scheduler_write_runs" in result.stdout
    assert "wake_tick_dry_run" in result.stdout
    assert "write_runs=2" in result.stdout
    assert "only low-risk staged writes execute in 7V" in result.stdout
    assert "blocked" in result.stdout
    assert "runtime_wake_schedule_tick_completed" not in result.stdout
    assert "runtime_checkpoint_created" not in result.stdout
    assert "runtime_wake_scheduler_started" not in result.stdout
    assert "runtime_continuation_step_started" not in result.stdout
    assert "runtime_wake_scheduler_recovery_recorded" not in result.stdout
    assert "runtime_wake_scheduler_recovery_workflow_step_recorded" not in result.stdout
    assert "handoff_sent=true" not in result.stdout
    assert "opencode process" not in result.stdout.lower()
    assert "navigation-write-run-secret" not in result.stdout
    assert "navigation-write-run-secret-abc123" not in result.stdout
    assert "token=abc123" not in result.stdout

    events_path = project / ".nxl" / "events.jsonl"
    events = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds = [event["kind"] for event in events]
    assert event_kinds.count("runtime_wake_scheduler_navigation_write_command_staged") == 2
    assert event_kinds.count("runtime_wake_scheduler_navigation_write_run_started") == 1
    assert event_kinds.count("runtime_wake_scheduler_navigation_write_run_succeeded") == 1
    assert event_kinds.count("runtime_wake_scheduler_navigation_write_run_blocked") == 1

    forbidden = {
        "runtime_wake_scheduler_started",
        "runtime_wake_scheduler_stopped",
        "runtime_wake_schedule_tick_completed",
        "runtime_checkpoint_created",
        "runtime_wake_assessment_created",
        "runtime_continuation_plan_created",
        "runtime_continuation_step_started",
        "runtime_wake_scheduler_recovery_recorded",
        "runtime_wake_scheduler_recovery_workflow_created",
        "runtime_wake_scheduler_recovery_workflow_step_recorded",
        "runtime_opencode_handoff_sent",
        "runtime_mission_completed",
        "runtime_mission_failed",
        "runtime_proposal_review_created",
        "runtime_proposal_applied",
    }
    assert forbidden.isdisjoint(event_kinds)
    write_run_kinds = {
        kind
        for kind in event_kinds
        if kind.startswith("runtime_wake_scheduler_navigation_write_run_")
    }
    assert write_run_kinds == {
        "runtime_wake_scheduler_navigation_write_run_started",
        "runtime_wake_scheduler_navigation_write_run_succeeded",
        "runtime_wake_scheduler_navigation_write_run_blocked",
    }
    low_risk_successes = [
        event
        for event in events
        if event["kind"] == "runtime_wake_scheduler_navigation_write_run_succeeded"
    ]
    assert len(low_risk_successes) == 1
    assert low_risk_successes[0]["staged_write_id"] == dry_run_staged_id
    assert low_risk_successes[0]["execution_kind"] == "wake_tick_dry_run"
    assert low_risk_successes[0]["result_kind"] == "wake_tick_dry_run"
    serialized_events = json.dumps(events)
    assert "navigation-write-run-secret" not in serialized_events
    assert "navigation-write-run-secret-abc123" not in serialized_events
    assert "token=abc123" not in serialized_events
