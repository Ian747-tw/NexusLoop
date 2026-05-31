from __future__ import annotations

import json
from hashlib import sha256

import pytest


def _stable_json(value) -> str:
    if isinstance(value, list):
        return "[" + ",".join(_stable_json(item) for item in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(key) + ":" + _stable_json(value[key]) for key in sorted(value)) + "}"
    return json.dumps(value, separators=(",", ":"))


@pytest.mark.phase_m4
def test_user_tracks_wake_scheduler_recovery_workflow_through_tui(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"

    project = sandbox.make_empty_project_dir("wake_scheduler_recovery_workflow_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_wake_scheduler_recovery_workflow_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise scheduler recovery workflow through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["scheduler recovery workflow renders"],
                "evaluation_protocol": "run headless TUI",
                "approved_by": "e2e",
                "approved_at": "2026-05-10T00:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    prior_event_id = "e2e_stale_scheduler_workflow_start"
    prior_started_at = "2026-05-11T15:00:00.000Z"
    prior_tick_id = "e2e_stale_workflow_tick"
    recovery_hash = sha256("\n".join([prior_event_id, prior_started_at, prior_tick_id]).encode("utf-8")).hexdigest()
    recovery_id = "wake_scheduler_recovery_" + recovery_hash[:16]
    commands = [
        "/scheduler-status",
        "/scheduler-bootstrap",
        "/wake-tick-preview",
        "/wake-tick-dry-run",
        "/wake-schedules",
        "/scheduler-start dry-run every=60s",
        f"/scheduler-recovery-ack {recovery_id}",
    ]
    workflow_hash_input = {"commands": commands, "recoveryHash": recovery_hash, "recoveryId": recovery_id}
    workflow_id = "wake_scheduler_recovery_workflow_" + sha256(_stable_json(workflow_hash_input).encode("utf-8")).hexdigest()[:16]

    events_path = project / ".nxl" / "events.jsonl"
    with events_path.open("a", encoding="utf-8") as handle:
        handle.write(
            json.dumps(
                {
                    "kind": "runtime_wake_scheduler_started",
                    "event_id": prior_event_id,
                    "created_at": prior_started_at,
                    "scheduler_status": "running",
                    "tick_id": prior_tick_id,
                    "requested_by": "e2e token=workflow-secret",
                },
                separators=(",", ":"),
            )
            + "\n"
        )

    keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-recovery"},
        {"type": "submit"},
        {"type": "insert", "text": f"/scheduler-recovery-workflow-preview {recovery_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/scheduler-recovery-workflow {recovery_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/scheduler-recovery-step-done {workflow_id} 0 token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/scheduler-recovery-workflow-verify {workflow_id}"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-recovery-workflows"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.env["NXL_SECRET_WORKFLOW_TOKEN"] = "workflow-secret-abc123"
    sandbox.runner.env["NXL_SECRET_WORKFLOW_TOKEN"] = "workflow-secret-abc123"

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "Wake scheduler" in result.stdout
    assert "recovery_workflow" in result.stdout
    assert f"recovery_id={recovery_id}" in result.stdout
    assert f"selected_workflow={workflow_id}" in result.stdout
    assert "progress done=1" in result.stdout
    assert "recent_recovery_workflows" in result.stdout
    assert "runtime_wake_schedule_tick_completed" not in result.stdout
    assert "runtime_wake_scheduler_started status=running" not in result.stdout
    assert "last_step=" not in result.stdout
    assert "handoff_sent=true" not in result.stdout
    assert "opencode process" not in result.stdout.lower()
    assert "workflow-secret" not in result.stdout
    assert "workflow-secret-abc123" not in result.stdout
    assert "token=abc123" not in result.stdout

