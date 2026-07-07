from __future__ import annotations

import json
import re

import pytest


@pytest.mark.phase_m4
def test_user_records_opencode_wake_action_execution_metadata_only(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.env["NXL_SECRET_WAKE_ACTION_TOKEN"] = "wake-action-secret-abc123"
    sandbox.runner.env["NXL_SECRET_WAKE_ACTION_TOKEN"] = "wake-action-secret-abc123"

    project = sandbox.make_empty_project_dir("opencode_wake_action_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_opencode_wake_action_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise OpenCode wake action execution through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["wake action execution renders"],
                "evaluation_protocol": "run headless TUI",
                "approved_by": "e2e",
                "approved_at": "2026-07-01T00:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    plan_keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-session-plan objective=wake action execution test token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-sessions"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(plan_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(plan_keys)
    plan_result = sandbox.run_cli([], cwd=project)
    assert plan_result.exit_code == 0, plan_result.stdout + plan_result.stderr
    session_match = re.search(r"latest=(opencode_session_[A-Za-z0-9._-]+)", plan_result.stdout)
    assert session_match, plan_result.stdout
    session_id = session_match.group(1)

    launch_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-session-instruction-pack-write session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-launch-readiness session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-launch session={session_id}"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(launch_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(launch_keys)
    launch_result = sandbox.run_cli([], cwd=project)
    assert launch_result.exit_code == 0, launch_result.stdout + launch_result.stderr
    assert "status=launched" in launch_result.stdout

    execution_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-heartbeat session={session_id} summary=alive token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-watchdog-record session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-wake-supervisor-preview session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-wake-execution-record session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-wake-executions session={session_id}"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(execution_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(execution_keys)
    execution_result = sandbox.run_cli([], cwd=project)
    assert execution_result.exit_code == 0, execution_result.stdout + execution_result.stderr
    execution_match = re.search(r"- (opencode_wake_execution_[A-Za-z0-9._-]+)", execution_result.stdout)
    assert execution_match, execution_result.stdout
    execution_id = execution_match.group(1)

    events_path = project / ".nxl" / "events.jsonl"
    events_before_action = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds_before = [event["kind"] for event in events_before_action]

    action_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-wake-action-preview execution={execution_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-wake-action-dry-run execution={execution_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-wake-action-record execution={execution_id} action=record_watchdog"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-wake-actions execution={execution_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-wake-action-latest execution={execution_id}"},
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-wake-action-summary"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /opencode-wake-action-record"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(action_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(action_keys)
    action_result = sandbox.run_cli([], cwd=project)
    assert action_result.exit_code == 0, action_result.stdout + action_result.stderr

    assert "OpenCode wake action executions" in action_result.stdout
    assert "latest_result=" in action_result.stdout
    assert "action=record_watchdog" in action_result.stdout
    assert "metadata_event=opencode_session_watchdog_recorded" in action_result.stdout
    assert "will_call_provider=false" in action_result.stdout
    assert "will_send_opencode_prompt=false" in action_result.stdout
    assert "will_control_process=false" in action_result.stdout
    assert "will_mutate_mission=false" in action_result.stdout
    assert "no arbitrary commands are executed" in action_result.stdout
    assert "selected=/opencode-wake-action-record risk=medium_risk_write" in action_result.stdout
    assert "wake-action-secret" not in action_result.stdout
    assert "wake-action-secret-abc123" not in action_result.stdout
    assert "token=abc123" not in action_result.stdout

    events = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds = [event["kind"] for event in events]
    assert event_kinds.count("opencode_wake_action_execution_recorded") == event_kinds_before.count("opencode_wake_action_execution_recorded") + 1
    assert event_kinds.count("opencode_session_watchdog_recorded") == event_kinds_before.count("opencode_session_watchdog_recorded") + 1

    new_events = events[len(events_before_action) :]
    new_event_kinds = [event["kind"] for event in new_events]
    metadata_new_event_kinds = [
        kind
        for kind in new_event_kinds
        if kind not in {"runtime_started", "runtime_ready", "runtime_shutdown"}
    ]
    assert metadata_new_event_kinds == ["opencode_session_watchdog_recorded", "opencode_wake_action_execution_recorded"]
    forbidden_new_events = {
        "opencode_prompt_sent",
        "opencode_commander_guidance_delivered",
        "opencode_session_process_paused",
        "opencode_session_process_resumed",
        "opencode_session_process_killed",
        "opencode_session_process_stopped",
        "opencode_session_launch_started",
        "opencode_session_launch_succeeded",
        "runtime_wake_scheduler_started",
        "runtime_wake_schedule_tick_completed",
        "mission_created",
        "mission_claimed",
        "mission_progress_recorded",
        "mission_result_submitted",
        "mission_completed",
        "mission_failed",
        "review_request_created",
        "commander_proposal_created",
        "commander_proposal_applied",
        "external_api_request_executed",
        "external_api_research_ingestion_created",
        "research_result_ingested",
        "research_db_written",
        "runtime_checkpoint_created",
    }
    assert forbidden_new_events.isdisjoint(new_event_kinds)
    serialized_new_events = json.dumps(new_events)
    assert "wake-action-secret" not in serialized_new_events
    assert "token=abc123" not in serialized_new_events
    assert "stdout" not in serialized_new_events
    assert "stderr" not in serialized_new_events
    assert "file contents" not in serialized_new_events
