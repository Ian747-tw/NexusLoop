from __future__ import annotations

import json
import re

import pytest


@pytest.mark.phase_m4
def test_user_records_opencode_wake_supervisor_execution_metadata_only(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.env["NXL_SECRET_WAKE_EXECUTION_TOKEN"] = "wake-execution-secret-abc123"
    sandbox.runner.env["NXL_SECRET_WAKE_EXECUTION_TOKEN"] = "wake-execution-secret-abc123"

    project = sandbox.make_empty_project_dir("opencode_wake_execution_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_opencode_wake_execution_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise OpenCode wake supervisor execution through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["wake supervisor execution renders"],
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
        {"type": "insert", "text": "/opencode-session-plan objective=wake supervisor execution test token=abc123"},
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

    evidence_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-heartbeat session={session_id} summary=alive token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-watchdog-record session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-human-pause session={session_id} reason=operator wants review token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-wake-supervisor-preview session={session_id}"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(evidence_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(evidence_keys)
    evidence_result = sandbox.run_cli([], cwd=project)
    assert evidence_result.exit_code == 0, evidence_result.stdout + evidence_result.stderr
    assert "OpenCode wake supervisor" in evidence_result.stdout
    assert "supervisor_status=human_paused" in evidence_result.stdout

    events_path = project / ".nxl" / "events.jsonl"
    events_before_execution = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds_before = [event["kind"] for event in events_before_execution]

    execution_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-wake-execution-preview session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-wake-execution-dry-run session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-wake-execution-record session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-wake-batch-preview"},
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-wake-batch-dry-run"},
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-wake-batch-record"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-wake-executions session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-wake-execution-latest session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-wake-execution-summary"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /opencode-wake-execution-record"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(execution_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(execution_keys)
    execution_result = sandbox.run_cli([], cwd=project)
    assert execution_result.exit_code == 0, execution_result.stdout + execution_result.stderr

    assert "OpenCode wake supervisor executions" in execution_result.stdout
    assert "latest_result=" in execution_result.stdout
    assert "batch_result=" in execution_result.stdout
    assert "supervisor_status=human_paused" in execution_result.stdout
    assert "recommended_action=review_human_control" in execution_result.stdout
    assert "action_execution_status=not_executed" in execution_result.stdout
    assert "recommended commands are previews and were not executed" in execution_result.stdout
    assert "selected=/opencode-wake-execution-record risk=medium_risk_write" in execution_result.stdout
    assert "wake-execution-secret" not in execution_result.stdout
    assert "wake-execution-secret-abc123" not in execution_result.stdout
    assert "token=abc123" not in execution_result.stdout

    events = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds = [event["kind"] for event in events]
    assert event_kinds.count("opencode_wake_supervisor_execution_recorded") == event_kinds_before.count("opencode_wake_supervisor_execution_recorded") + 2
    assert event_kinds.count("opencode_wake_supervisor_batch_recorded") == event_kinds_before.count("opencode_wake_supervisor_batch_recorded") + 1
    assert event_kinds.count("opencode_session_launch_started") == 1
    assert event_kinds.count("opencode_session_launch_succeeded") == 1

    new_events = events[len(events_before_execution) :]
    new_event_kinds = [event["kind"] for event in new_events]
    assert new_event_kinds == [
        "opencode_wake_supervisor_execution_recorded",
        "opencode_wake_supervisor_batch_recorded",
        "opencode_wake_supervisor_execution_recorded",
    ]
    assert all(event.get("action_execution_status") == "not_executed" for event in new_events)
    forbidden_new_events = {
        "opencode_session_forced_report_requested",
        "opencode_commander_question_created",
        "opencode_commander_guidance_created",
        "opencode_commander_guidance_delivery_requested",
        "opencode_commander_guidance_delivered",
        "opencode_prompt_sent",
        "opencode_session_process_paused",
        "opencode_session_process_resumed",
        "opencode_session_process_killed",
        "opencode_session_process_stopped",
        "opencode_session_launch_started",
        "opencode_session_launch_succeeded",
        "runtime_wake_scheduler_started",
        "runtime_wake_schedule_tick_completed",
        "runtime_continuation_plan_created",
        "runtime_continuation_step_started",
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
    assert "wake-execution-secret" not in serialized_new_events
    assert "token=abc123" not in serialized_new_events
    assert "stdout" not in serialized_new_events
    assert "stderr" not in serialized_new_events
    assert "file contents" not in serialized_new_events
