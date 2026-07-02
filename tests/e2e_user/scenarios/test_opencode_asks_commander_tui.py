from __future__ import annotations

import json
import re

import pytest


@pytest.mark.phase_m4
def test_user_creates_opencode_asks_commander_question_without_answer_or_guidance(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.env["NXL_SECRET_ASK_COMMANDER_TOKEN"] = "ask-commander-secret-abc123"
    sandbox.runner.env["NXL_SECRET_ASK_COMMANDER_TOKEN"] = "ask-commander-secret-abc123"

    project = sandbox.make_empty_project_dir("opencode_asks_commander_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_opencode_asks_commander_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise OpenCode asks Commander question records through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["asks Commander surface renders"],
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
        {"type": "insert", "text": "/opencode-session-plan objective=ask commander test token=abc123"},
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
    events_path = project / ".nxl" / "events.jsonl"
    events_before_ask = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    runtime_started_before_ask = sum(
        1 for event in events_before_ask if event["kind"] == "runtime_started"
    )

    question_text = "should I use option A or option B token=abc123"
    ask_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-question session={session_id} question={question_text}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-ask-commander-preview session={session_id} question={question_text}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-ask-commander-dry-run session={session_id} question={question_text}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-ask-commander session={session_id} question={question_text}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-commander-questions session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-commander-question-latest session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-commander-question-summary"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /opencode-ask-commander"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(ask_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(ask_keys)
    ask_result = sandbox.run_cli([], cwd=project)
    assert ask_result.exit_code == 0, ask_result.stdout + ask_result.stderr

    assert "OpenCode asks Commander" in ask_result.stdout
    assert f"session={session_id}" in ask_result.stdout
    assert "question_status=pending_commander" in ask_result.stdout
    assert "pending_commander=1" in ask_result.stdout
    assert "question records do not call Commander providers" in ask_result.stdout
    assert "answer questions, inject guidance" in ask_result.stdout
    assert "send OpenCode prompts" in ask_result.stdout
    assert "selected=/opencode-ask-commander risk=medium_risk_write" in ask_result.stdout
    assert "ask-commander-secret" not in ask_result.stdout
    assert "ask-commander-secret-abc123" not in ask_result.stdout
    assert "token=abc123" not in ask_result.stdout

    events = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds = [event["kind"] for event in events]
    assert event_kinds.count("runtime_started") == runtime_started_before_ask
    assert event_kinds.count("opencode_session_planned") == 1
    assert event_kinds.count("opencode_session_instruction_pack_written") == 1
    assert event_kinds.count("opencode_session_launch_started") == 1
    assert event_kinds.count("opencode_session_launch_succeeded") == 1
    assert event_kinds.count("opencode_session_progress_recorded") == 1
    assert event_kinds.count("opencode_commander_question_created") == 1
    forbidden = {
        "opencode_commander_question_answered",
        "commander_guidance_recorded",
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
    assert "ask-commander-secret" not in serialized_events
    assert "token=abc123" not in serialized_events
    assert "stdout" not in serialized_events
    assert "stderr" not in serialized_events
