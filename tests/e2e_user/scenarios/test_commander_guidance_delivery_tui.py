from __future__ import annotations

import json
import re

import pytest


@pytest.mark.phase_m4
def test_user_requests_commander_guidance_delivery_handoff(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.env["NXL_SECRET_GUIDANCE_DELIVERY_TOKEN"] = "guidance-delivery-secret-abc123"
    sandbox.runner.env["NXL_SECRET_GUIDANCE_DELIVERY_TOKEN"] = "guidance-delivery-secret-abc123"

    project = sandbox.make_empty_project_dir("commander_guidance_delivery_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_commander_guidance_delivery_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise Commander guidance delivery records through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["guidance delivery surface renders"],
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
        {"type": "insert", "text": "/opencode-session-plan objective=guidance delivery test token=abc123"},
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
    ask_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-question session={session_id} question={question_text}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-ask-commander session={session_id} question={question_text}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-commander-question-latest session={session_id}"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(ask_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(ask_keys)
    ask_result = sandbox.run_cli([], cwd=project)
    assert ask_result.exit_code == 0, ask_result.stdout + ask_result.stderr
    question_match = re.search(r"latest=(fake_commander_question_[A-Za-z0-9._-]+|opencode_commander_question_[A-Za-z0-9._-]+)", ask_result.stdout)
    if not question_match:
        question_match = re.search(r"latest_result=(fake_commander_question_[A-Za-z0-9._-]+|opencode_commander_question_[A-Za-z0-9._-]+)", ask_result.stdout)
    assert question_match, ask_result.stdout
    question_id = question_match.group(1)

    answer_text = "choose option A because it is safer token=abc123"
    guidance_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/commander-guidance question={question_id} answer={answer_text}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/commander-guidance-latest question={question_id}"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(guidance_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(guidance_keys)
    guidance_result = sandbox.run_cli([], cwd=project)
    assert guidance_result.exit_code == 0, guidance_result.stdout + guidance_result.stderr
    guidance_match = re.search(r"latest=(commander_guidance_[A-Za-z0-9._-]+|fake_commander_guidance_[A-Za-z0-9._-]+)", guidance_result.stdout)
    if not guidance_match:
        guidance_match = re.search(r"latest_result=(commander_guidance_[A-Za-z0-9._-]+|fake_commander_guidance_[A-Za-z0-9._-]+)", guidance_result.stdout)
    assert guidance_match, guidance_result.stdout
    guidance_id = guidance_match.group(1)

    events_path = project / ".nxl" / "events.jsonl"
    events_before_delivery = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    runtime_started_before_delivery = sum(
        1 for event in events_before_delivery if event["kind"] == "runtime_started"
    )
    delivery_requested_before = sum(
        1 for event in events_before_delivery if event["kind"] == "opencode_commander_guidance_delivery_requested"
    )

    delivery_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/commander-guidance-delivery-preview guidance={guidance_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/commander-guidance-delivery-dry-run guidance={guidance_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/commander-guidance-deliver guidance={guidance_id} mode=operator_handoff"},
        {"type": "submit"},
        {"type": "insert", "text": f"/commander-guidance-deliveries guidance={guidance_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/commander-guidance-delivery-latest guidance={guidance_id}"},
        {"type": "submit"},
        {"type": "insert", "text": "/commander-guidance-delivery-summary"},
        {"type": "submit"},
        {"type": "insert", "text": f"/commander-guidance-show {guidance_id}"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /commander-guidance-deliver"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(delivery_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(delivery_keys)
    delivery_result = sandbox.run_cli([], cwd=project)
    assert delivery_result.exit_code == 0, delivery_result.stdout + delivery_result.stderr

    assert "Commander guidance delivery" in delivery_result.stdout
    assert "delivery_requested" in delivery_result.stdout
    assert "pending_delivery" in delivery_result.stdout
    assert "operator_handoff does not send a prompt" in delivery_result.stdout
    assert "delivery is separate from answer creation" in delivery_result.stdout
    assert "selected=/commander-guidance-deliver risk=medium_risk_write" in delivery_result.stdout
    assert "guidance-delivery-secret" not in delivery_result.stdout
    assert "guidance-delivery-secret-abc123" not in delivery_result.stdout
    assert "token=abc123" not in delivery_result.stdout

    events = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds = [event["kind"] for event in events]
    assert event_kinds.count("runtime_started") == runtime_started_before_delivery
    assert event_kinds.count("opencode_commander_guidance_delivery_requested") == delivery_requested_before + 1
    assert event_kinds.count("opencode_commander_guidance_delivered") == 0
    assert event_kinds.count("opencode_commander_guidance_delivery_failed") == 0
    assert event_kinds.count("opencode_commander_guidance_created") == 1
    assert event_kinds.count("opencode_commander_question_answered") == 1
    forbidden = {
        "commander_guidance_sent",
        "opencode_prompt_sent",
        "opencode_session_process_paused",
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
    assert "guidance-delivery-secret" not in serialized_events
    assert "token=abc123" not in serialized_events
    assert "stdout" not in serialized_events
    assert "stderr" not in serialized_events
    delivery_events = [
        event for event in events if event["kind"] == "opencode_commander_guidance_delivery_requested"
    ]
    serialized_delivery_events = json.dumps(delivery_events)
    assert "full research.db" not in serialized_delivery_events.lower()
    assert "raw_logs" not in serialized_delivery_events
