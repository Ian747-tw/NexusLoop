from __future__ import annotations

import hashlib
import json

import pytest


@pytest.mark.phase_m4
def test_user_compares_scheduler_navigation_staged_reads_without_rerun(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"

    project = sandbox.make_empty_project_dir("wake_scheduler_navigation_staged_read_compare_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_wake_scheduler_navigation_staged_read_compare_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise scheduler navigation staged read comparison through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["scheduler navigation staged read comparison renders"],
                "evaluation_protocol": "run headless TUI",
                "approved_by": "e2e",
                "approved_at": "2026-05-10T00:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    staged_hash = hashlib.sha256(b"/scheduler-status").hexdigest()
    staged_id = f"wake_scheduler_navigation_staged_{staged_hash[:16]}"
    keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-nav-stage /scheduler-status"},
        {"type": "submit"},
        {"type": "insert", "text": f"/scheduler-nav-run {staged_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/scheduler-nav-run {staged_id}"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-nav-read-history"},
        {"type": "submit"},
        {"type": "insert", "text": f"/scheduler-nav-read-compare {staged_id}"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-nav-read-stale after=1h"},
        {"type": "submit"},
        {"type": "insert", "text": f"/scheduler-nav-read-group {staged_id}"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.env["NXL_SECRET_NAV_COMPARE_TOKEN"] = "navigation-compare-secret-abc123"
    sandbox.runner.env["NXL_SECRET_NAV_COMPARE_TOKEN"] = "navigation-compare-secret-abc123"

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "Wake scheduler" in result.stdout
    assert "scheduler_navigation_staged_reads" in result.stdout
    assert "scheduler_navigation_read_comparison" in result.stdout
    assert "history=groups=1 runs=2" in result.stdout
    assert "comparison=unchanged" in result.stdout
    assert f"selected_group={staged_id} unchanged runs=2" in result.stdout
    assert "comparison uses bounded summaries and does not execute staged reads" in result.stdout
    assert "runtime_wake_schedule_tick_completed" not in result.stdout
    assert "runtime_wake_scheduler_started" not in result.stdout
    assert "runtime_continuation_step_started" not in result.stdout
    assert "runtime_wake_scheduler_recovery_recorded" not in result.stdout
    assert "runtime_wake_scheduler_recovery_workflow_step_recorded" not in result.stdout
    assert "handoff_sent=true" not in result.stdout
    assert "opencode process" not in result.stdout.lower()
    assert "navigation-compare-secret" not in result.stdout
    assert "navigation-compare-secret-abc123" not in result.stdout
    assert "token=abc123" not in result.stdout

    events_path = project / ".nxl" / "events.jsonl"
    events = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds = [event["kind"] for event in events]
    assert event_kinds.count("runtime_wake_scheduler_navigation_command_staged") == 1
    assert event_kinds.count("runtime_wake_scheduler_navigation_staged_read_started") == 2
    assert event_kinds.count("runtime_wake_scheduler_navigation_staged_read_succeeded") == 2
    assert "runtime_wake_scheduler_navigation_command_removed" not in event_kinds
    assert "runtime_wake_scheduler_navigation_commands_cleared" not in event_kinds
    assert "runtime_wake_scheduler_started" not in event_kinds
    assert "runtime_wake_schedule_tick_completed" not in event_kinds
    assert "runtime_continuation_step_started" not in event_kinds
    assert "runtime_wake_scheduler_recovery_recorded" not in event_kinds
    assert "runtime_wake_scheduler_recovery_workflow_step_recorded" not in event_kinds
    assert "navigation-compare-secret" not in json.dumps(events)
