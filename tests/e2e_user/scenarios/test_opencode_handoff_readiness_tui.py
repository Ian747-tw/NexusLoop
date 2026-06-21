from __future__ import annotations

import json

import pytest


@pytest.mark.phase_m4
def test_user_inspects_opencode_handoff_readiness_without_execution(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.env.pop("NXL_REAL_OPENCODE_SMOKE", None)
    sandbox.runner.env.pop("NXL_REAL_OPENCODE_SMOKE", None)

    project = sandbox.make_empty_project_dir("opencode_handoff_readiness_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_opencode_handoff_readiness_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise OpenCode handoff readiness diagnostics through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["handoff readiness diagnostics render"],
                "evaluation_protocol": "run headless TUI",
                "approved_by": "e2e",
                "approved_at": "2026-06-21T00:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/handoff-readiness"},
        {"type": "submit"},
        {"type": "insert", "text": "/handoff-readiness-summary"},
        {"type": "submit"},
        {"type": "insert", "text": "/handoff-readiness proposal=proposal_test"},
        {"type": "submit"},
        {"type": "insert", "text": "/handoff-readiness proposal=proposal_test token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /handoff-readiness"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /handoff"},
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-smoke-preview"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.env["NXL_SECRET_HANDOFF_READINESS_TOKEN"] = "handoff-readiness-secret-abc123"
    sandbox.runner.env["NXL_SECRET_HANDOFF_READINESS_TOKEN"] = "handoff-readiness-secret-abc123"

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "OpenCode handoff readiness" in result.stdout
    assert "can_execute_now=false" in result.stdout
    assert "authority=/handoff risk=high_impact_write gate=handoff_runtime" in result.stdout
    assert "note=readiness preview does not execute handoff or launch OpenCode" in result.stdout
    assert "Command authority" in result.stdout
    assert "selected=/handoff risk=high_impact_write" in result.stdout
    assert "OpenCode process smoke" in result.stdout
    assert "handoff-readiness-secret" not in result.stdout
    assert "handoff-readiness-secret-abc123" not in result.stdout
    assert "abc123" not in result.stdout

    events_path = project / ".nxl" / "events.jsonl"
    events = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ] if events_path.exists() else []
    event_kinds = [event["kind"] for event in events]
    forbidden = {
        "opencode_handoff_started",
        "opencode_handoff_created",
        "opencode_handoff_failed",
        "opencode_process_smoke_started",
        "opencode_process_smoke_succeeded",
        "opencode_process_smoke_failed",
        "opencode_process_smoke_blocked",
        "mission_completed",
        "mission_failed",
        "mission_cancelled",
        "review_request_created",
        "review_request_cancelled",
        "commander_proposal_review_requested",
        "commander_proposal_applied",
        "commander_proposal_apply_failed",
        "external_api_request_executed",
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
    assert "handoff-readiness-secret" not in serialized_events
    assert "handoff-readiness-secret-abc123" not in serialized_events
    assert "abc123" not in serialized_events
