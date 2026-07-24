from __future__ import annotations

import hashlib
import json

import pytest

from tests.e2e_user.snapshot_assertions import assert_opencode_process_smoke_idle


def staged_write_id(command: str, authority_gate: str, risk: str) -> str:
    payload = json.dumps(
        {"command": command, "authority_gate": authority_gate, "risk": risk},
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return f"wake_scheduler_navigation_write_staged_{digest[:16]}"


@pytest.mark.phase_m4
def test_user_approves_scheduler_navigation_write_without_execution(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"

    project = sandbox.make_empty_project_dir("wake_scheduler_navigation_write_approval_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_wake_scheduler_navigation_write_approval_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise scheduler navigation write approval through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["scheduler navigation write approval renders"],
                "evaluation_protocol": "run headless TUI",
                "approved_by": "e2e",
                "approved_at": "2026-05-10T00:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    staged_id = staged_write_id("/checkpoint full [REDACTED]", "checkpoint_runtime", "medium_risk_write")
    first_keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-nav-write-stage-medium /checkpoint full token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/scheduler-nav-write-readiness {staged_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/scheduler-nav-write-approve {staged_id} token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-nav-write-approvals"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(first_keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.env["NXL_SECRET_WRITE_APPROVAL_TOKEN"] = "navigation-write-approval-secret-abc123"
    sandbox.runner.env["NXL_SECRET_WRITE_APPROVAL_TOKEN"] = "navigation-write-approval-secret-abc123"

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "Wake scheduler" in result.stdout
    assert "scheduler_write_approval" in result.stdout
    assert "readiness=none" not in result.stdout
    assert "approvals=" in result.stdout
    assert "approval records future operator intent only and does not execute staged writes" in result.stdout
    assert "runtime_checkpoint_created" not in result.stdout
    assert "runtime_wake_scheduler_started" not in result.stdout
    assert "runtime_wake_schedule_tick_completed" not in result.stdout
    assert "runtime_continuation_step_started" not in result.stdout
    assert "runtime_wake_scheduler_recovery_recorded" not in result.stdout
    assert "runtime_wake_scheduler_recovery_workflow_step_recorded" not in result.stdout
    assert "handoff_sent=true" not in result.stdout
    assert_opencode_process_smoke_idle(result.stdout)
    assert "navigation-write-approval-secret" not in result.stdout
    assert "navigation-write-approval-secret-abc123" not in result.stdout
    assert "token=abc123" not in result.stdout

    events_path = project / ".nxl" / "events.jsonl"
    events = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    approved_id = next(
        event["approval_id"]
        for event in events
        if event.get("kind") == "runtime_wake_scheduler_navigation_write_approval_recorded"
        and event.get("status") == "approved"
    )

    second_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/scheduler-nav-write-approval-show {approved_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/scheduler-nav-write-approval-revoke {approved_id} token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-nav-write-approvals"},
        {"type": "submit"},
    ]
    encoded_second_keys = json.dumps(second_keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_second_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_second_keys
    second_result = sandbox.run_cli([], cwd=project)

    assert second_result.exit_code == 0, second_result.stdout + second_result.stderr
    assert "scheduler_write_approval" in second_result.stdout
    assert "revoked" in second_result.stdout
    assert "navigation-write-approval-secret" not in second_result.stdout
    assert "navigation-write-approval-secret-abc123" not in second_result.stdout
    assert "token=abc123" not in second_result.stdout

    events = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds = [event["kind"] for event in events]
    assert event_kinds.count("runtime_wake_scheduler_navigation_write_command_staged") == 1
    assert event_kinds.count("runtime_wake_scheduler_navigation_write_approval_recorded") == 1
    assert event_kinds.count("runtime_wake_scheduler_navigation_write_approval_revoked") == 1

    approval_kinds = {
        "runtime_wake_scheduler_navigation_write_approval_recorded",
        "runtime_wake_scheduler_navigation_write_approval_revoked",
    }
    staging_kinds = {
        "runtime_wake_scheduler_navigation_write_command_staged",
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
    navigation_write_kinds = {
        kind
        for kind in event_kinds
        if kind.startswith("runtime_wake_scheduler_navigation_write_") or kind in forbidden
    }
    assert navigation_write_kinds.issubset(approval_kinds | staging_kinds)
    assert lifecycle_kinds.intersection(event_kinds)
    serialized_events = json.dumps(events)
    assert "navigation-write-approval-secret" not in serialized_events
    assert "navigation-write-approval-secret-abc123" not in serialized_events
    assert "token=abc123" not in serialized_events
