from __future__ import annotations

import json
import re

import pytest


@pytest.mark.phase_m4
def test_user_records_opencode_watchdog_and_forced_report_without_process_control(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.env["NXL_SECRET_WATCHDOG_TOKEN"] = "watchdog-secret-abc123"
    sandbox.runner.env["NXL_SECRET_WATCHDOG_TOKEN"] = "watchdog-secret-abc123"

    project = sandbox.make_empty_project_dir("opencode_timeout_watchdog_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_opencode_watchdog_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise OpenCode timeout watchdog records through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["watchdog surface renders"],
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
        {"type": "insert", "text": "/opencode-session-plan objective=timeout watchdog test token=abc123"},
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
        {"type": "insert", "text": "/opencode-launches"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(launch_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(launch_keys)
    launch_result = sandbox.run_cli([], cwd=project)
    assert launch_result.exit_code == 0, launch_result.stdout + launch_result.stderr
    assert "status=launched" in launch_result.stdout

    watchdog_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-heartbeat session={session_id} summary=alive token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-watchdog-preview session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-watchdog-dry-run session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-watchdog-record session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-blocker session={session_id} summary=blocked blocker=needs report token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-watchdog-preview session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-force-report session={session_id} reason=operator requested report after blocker token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-watchdogs session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-force-report-requests session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-watchdog-summary"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /opencode-force-report"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(watchdog_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(watchdog_keys)
    watchdog_result = sandbox.run_cli([], cwd=project)
    assert watchdog_result.exit_code == 0, watchdog_result.stdout + watchdog_result.stderr

    assert "OpenCode watchdog" in watchdog_result.stdout
    assert f"session={session_id}" in watchdog_result.stdout
    assert "watchdog_status=healthy" in watchdog_result.stdout
    assert "watchdog_status=blocked" in watchdog_result.stdout
    assert "forced_report_requests" in watchdog_result.stdout
    assert "process_paused=false" in watchdog_result.stdout
    assert "watchdog does not pause/kill OpenCode" in watchdog_result.stdout
    assert "Commander guidance/answer" in watchdog_result.stdout
    assert "selected=/opencode-force-report risk=medium_risk_write" in watchdog_result.stdout
    assert "process_paused=false" in watchdog_result.stdout
    assert "watchdog-secret" not in watchdog_result.stdout
    assert "watchdog-secret-abc123" not in watchdog_result.stdout
    assert "token=abc123" not in watchdog_result.stdout

    events_path = project / ".nxl" / "events.jsonl"
    events = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds = [event["kind"] for event in events]
    assert event_kinds.count("opencode_session_planned") == 1
    assert event_kinds.count("opencode_session_instruction_pack_written") == 1
    assert event_kinds.count("opencode_session_launch_started") == 1
    assert event_kinds.count("opencode_session_launch_succeeded") == 1
    assert event_kinds.count("opencode_session_progress_recorded") == 2
    assert event_kinds.count("opencode_session_watchdog_recorded") == 1
    assert event_kinds.count("opencode_session_forced_report_requested") == 1
    forbidden = {
        "opencode_session_timeout_recorded",
        "opencode_session_forced_pause_recorded",
        "opencode_session_process_paused",
        "opencode_session_process_killed",
        "opencode_session_process_stopped",
        "commander_guidance_recorded",
        "commander_guidance_sent",
        "opencode_commander_question_answered",
        "opencode_commander_question_created",
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
    assert "watchdog-secret" not in serialized_events
    assert "token=abc123" not in serialized_events
    assert "stdout" not in serialized_events
    assert "stderr" not in serialized_events
    assert '"process_paused": false' in serialized_events
