from __future__ import annotations

import json
import re

import pytest


@pytest.mark.phase_m4
def test_user_records_opencode_human_control_metadata_without_process_control(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.env["NXL_SECRET_HUMAN_CONTROL_TOKEN"] = "human-control-secret-abc123"
    sandbox.runner.env["NXL_SECRET_HUMAN_CONTROL_TOKEN"] = "human-control-secret-abc123"

    project = sandbox.make_empty_project_dir("opencode_human_control_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_opencode_human_control_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise OpenCode human control metadata through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["human control surface renders"],
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
        {"type": "insert", "text": "/opencode-session-plan objective=human control test token=abc123"},
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

    events_path = project / ".nxl" / "events.jsonl"
    events_before_controls = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    launch_started_before = sum(
        1 for event in events_before_controls if event["kind"] == "opencode_session_launch_started"
    )
    launch_succeeded_before = sum(
        1 for event in events_before_controls if event["kind"] == "opencode_session_launch_succeeded"
    )
    human_controls_before = sum(
        1 for event in events_before_controls if event["kind"] == "opencode_human_control_recorded"
    )

    human_control_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-human-control-preview session={session_id} kind=pause_request reason=operator wants review token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-human-control-dry-run session={session_id} kind=pause_request reason=operator wants review token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-human-pause session={session_id} reason=operator wants review token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-human-correction session={session_id} correction=prefer safer approach token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-human-force-report session={session_id} reason=please report current state token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-human-controls session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-human-control-latest session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-human-control-summary"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /opencode-human-pause"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(human_control_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(human_control_keys)
    human_control_result = sandbox.run_cli([], cwd=project)
    assert human_control_result.exit_code == 0, human_control_result.stdout + human_control_result.stderr

    assert "OpenCode human controls" in human_control_result.stdout
    assert "pause_request" in human_control_result.stdout
    assert "correction" in human_control_result.stdout
    assert "force_report" in human_control_result.stdout
    assert "process_control_performed=false" in human_control_result.stdout
    assert "open_code_prompt_sent=false" in human_control_result.stdout
    assert "mission_mutated=false" in human_control_result.stdout
    assert "human control was recorded only" in human_control_result.stdout
    assert "selected=/opencode-human-control risk=medium_risk_write" in human_control_result.stdout
    assert "human-control-secret" not in human_control_result.stdout
    assert "human-control-secret-abc123" not in human_control_result.stdout
    assert "token=abc123" not in human_control_result.stdout

    events = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds = [event["kind"] for event in events]
    assert event_kinds.count("opencode_session_launch_started") == launch_started_before
    assert event_kinds.count("opencode_session_launch_succeeded") == launch_succeeded_before
    assert event_kinds.count("opencode_human_control_recorded") == human_controls_before + 3
    forbidden = {
        "opencode_prompt_sent",
        "opencode_commander_guidance_delivered",
        "opencode_commander_guidance_delivery_requested",
        "opencode_session_process_paused",
        "opencode_session_process_resumed",
        "opencode_session_process_killed",
        "opencode_session_process_stopped",
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
    assert forbidden.isdisjoint(event_kinds)
    serialized_events = json.dumps(events)
    assert "human-control-secret" not in serialized_events
    assert "token=abc123" not in serialized_events
    assert "stdout" not in serialized_events
    assert "stderr" not in serialized_events
    control_events = [
        event for event in events if event["kind"] == "opencode_human_control_recorded"
    ]
    serialized_control_events = json.dumps(control_events)
    assert '"process_control_performed": false' in serialized_control_events
    assert '"open_code_prompt_sent": false' in serialized_control_events
    assert '"mission_mutated": false' in serialized_control_events
