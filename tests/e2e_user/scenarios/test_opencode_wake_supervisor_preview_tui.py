from __future__ import annotations

import json
import re

import pytest


@pytest.mark.phase_m4
def test_user_previews_opencode_wake_supervisor_without_execution(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.env["NXL_SECRET_WAKE_SUPERVISOR_TOKEN"] = "wake-supervisor-secret-abc123"
    sandbox.runner.env["NXL_SECRET_WAKE_SUPERVISOR_TOKEN"] = "wake-supervisor-secret-abc123"

    project = sandbox.make_empty_project_dir("opencode_wake_supervisor_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_opencode_wake_supervisor_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise OpenCode wake supervisor preview through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["wake supervisor preview renders"],
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
        {"type": "insert", "text": "/opencode-session-plan objective=wake supervisor preview test token=abc123"},
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

    question_text = "should I choose option A or B token=abc123"
    evidence_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-heartbeat session={session_id} summary=alive token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-watchdog-preview session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-question session={session_id} question={question_text}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-ask-commander session={session_id} question={question_text}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-commander-question-latest session={session_id}"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(evidence_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(evidence_keys)
    evidence_result = sandbox.run_cli([], cwd=project)
    assert evidence_result.exit_code == 0, evidence_result.stdout + evidence_result.stderr
    question_match = re.search(
        r"latest=(fake_commander_question_[A-Za-z0-9._-]+|opencode_commander_question_[A-Za-z0-9._-]+)",
        evidence_result.stdout,
    )
    if not question_match:
        question_match = re.search(
            r"latest_result=(fake_commander_question_[A-Za-z0-9._-]+|opencode_commander_question_[A-Za-z0-9._-]+)",
            evidence_result.stdout,
        )
    assert question_match, evidence_result.stdout
    question_id = question_match.group(1)

    guidance_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/commander-guidance question={question_id} answer=choose option A token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/commander-guidance-latest question={question_id}"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(guidance_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(guidance_keys)
    guidance_result = sandbox.run_cli([], cwd=project)
    assert guidance_result.exit_code == 0, guidance_result.stdout + guidance_result.stderr
    guidance_match = re.search(
        r"latest=(commander_guidance_[A-Za-z0-9._-]+|fake_commander_guidance_[A-Za-z0-9._-]+)",
        guidance_result.stdout,
    )
    if not guidance_match:
        guidance_match = re.search(
            r"latest_result=(commander_guidance_[A-Za-z0-9._-]+|fake_commander_guidance_[A-Za-z0-9._-]+)",
            guidance_result.stdout,
        )
    assert guidance_match, guidance_result.stdout
    guidance_id = guidance_match.group(1)

    delivery_and_human_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/commander-guidance-deliver guidance={guidance_id} mode=operator_handoff"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-human-pause session={session_id} reason=operator wants review token=abc123"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(delivery_and_human_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(delivery_and_human_keys)
    delivery_and_human_result = sandbox.run_cli([], cwd=project)
    assert delivery_and_human_result.exit_code == 0, delivery_and_human_result.stdout + delivery_and_human_result.stderr
    assert "pending_delivery" in delivery_and_human_result.stdout
    assert "pause_request" in delivery_and_human_result.stdout

    events_path = project / ".nxl" / "events.jsonl"
    events_before_supervisor = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds_before = [event["kind"] for event in events_before_supervisor]

    supervisor_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-wake-supervisor-preview session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-wake-supervisor-summary"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /opencode-wake-supervisor-preview"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(supervisor_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(supervisor_keys)
    supervisor_result = sandbox.run_cli([], cwd=project)
    assert supervisor_result.exit_code == 0, supervisor_result.stdout + supervisor_result.stderr

    assert "OpenCode wake supervisor" in supervisor_result.stdout
    assert "supervisor_status=human_paused" in supervisor_result.stdout
    assert "recommended_action=review_human_control" in supervisor_result.stdout
    assert "pending_delivery=1" in supervisor_result.stdout
    assert "pause=true" in supervisor_result.stdout
    assert "human_state=pause_requested" in supervisor_result.stdout
    assert "checks" in supervisor_result.stdout
    assert "context_sections" in supervisor_result.stdout
    assert "evidence_refs" in supervisor_result.stdout
    assert "recommended=/opencode-progress-latest" in supervisor_result.stdout
    assert "wake supervisor preview is read-only" in supervisor_result.stdout
    assert "selected=/opencode-wake-supervisor-preview risk=safe_read" in supervisor_result.stdout
    assert "wake-supervisor-secret" not in supervisor_result.stdout
    assert "wake-supervisor-secret-abc123" not in supervisor_result.stdout
    assert "token=abc123" not in supervisor_result.stdout

    events = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds = [event["kind"] for event in events]
    assert event_kinds == event_kinds_before
    assert event_kinds.count("opencode_session_launch_started") == 1
    assert event_kinds.count("opencode_session_launch_succeeded") == 1
    assert event_kinds.count("opencode_session_progress_recorded") == 2
    assert event_kinds.count("opencode_commander_question_created") == 1
    assert event_kinds.count("opencode_commander_guidance_created") == 1
    assert event_kinds.count("opencode_commander_guidance_delivery_requested") == 1
    assert event_kinds.count("opencode_human_control_recorded") == 1
    forbidden = {
        "opencode_wake_supervisor_previewed",
        "runtime_wake_scheduler_started",
        "runtime_wake_schedule_tick_completed",
        "runtime_continuation_plan_created",
        "runtime_continuation_step_started",
        "commander_guidance_sent",
        "opencode_prompt_sent",
        "opencode_commander_guidance_delivered",
        "opencode_session_process_paused",
        "opencode_session_process_resumed",
        "opencode_session_process_killed",
        "opencode_session_process_stopped",
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
    assert "wake-supervisor-secret" not in serialized_events
    assert "token=abc123" not in serialized_events
    assert "stdout" not in serialized_events
    assert "stderr" not in serialized_events
    assert "raw_logs" not in serialized_events
