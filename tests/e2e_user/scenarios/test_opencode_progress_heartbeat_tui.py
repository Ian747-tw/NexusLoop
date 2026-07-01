from __future__ import annotations

import json
import re

import pytest


@pytest.mark.phase_m4
def test_user_records_opencode_progress_and_heartbeat_without_supervision_or_mutation(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.env["NXL_SECRET_PROGRESS_TOKEN"] = "progress-secret-abc123"
    sandbox.runner.env["NXL_SECRET_PROGRESS_TOKEN"] = "progress-secret-abc123"

    project = sandbox.make_empty_project_dir("opencode_progress_heartbeat_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_opencode_progress_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise OpenCode progress and heartbeat records through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["progress surface renders"],
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
        {"type": "insert", "text": "/opencode-session-plan objective=progress heartbeat test token=abc123"},
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

    pack_launch_keys = [
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
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(pack_launch_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(pack_launch_keys)
    launch_result = sandbox.run_cli([], cwd=project)
    assert launch_result.exit_code == 0, launch_result.stdout + launch_result.stderr
    launch_match = re.search(r"latest=(opencode_launch_[A-Za-z0-9._-]+|fake_launch_[A-Za-z0-9._-]+|launch_[A-Za-z0-9._-]+) status=launched", launch_result.stdout)
    if not launch_match:
        launch_match = re.search(r"- (opencode_launch_[A-Za-z0-9._-]+|fake_launch_[A-Za-z0-9._-]+|launch_[A-Za-z0-9._-]+) status=launched", launch_result.stdout)
    assert launch_match, launch_result.stdout
    launch_id = launch_match.group(1)

    progress_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-progress-preview session={session_id} summary=working through first step token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-progress-dry-run session={session_id} summary=dry run progress token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-heartbeat session={session_id} summary=alive and working token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-progress session={session_id} summary=implemented first change files=fileA.ts tests=bun-test"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-blocker session={session_id} summary=blocked on ambiguity blocker=needs commander clarification"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-question session={session_id} question=should I prefer option A or B"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-progress-list session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-progress-latest session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-progress-summary"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /opencode-progress"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(progress_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(progress_keys)
    progress_result = sandbox.run_cli([], cwd=project)
    assert progress_result.exit_code == 0, progress_result.stdout + progress_result.stderr

    assert "OpenCode progress" in progress_result.stdout
    assert f"session={session_id}" in progress_result.stdout
    assert launch_id in launch_result.stdout
    assert "kind=heartbeat" in progress_result.stdout
    assert "kind=progress" in progress_result.stdout
    assert "kind=blocker" in progress_result.stdout
    assert "kind=question" in progress_result.stdout
    assert "summary total=4" in progress_result.stdout
    assert "heartbeat=1" in progress_result.stdout
    assert "questions=1" in progress_result.stdout
    assert "selected=/opencode-progress risk=medium_risk_write" in progress_result.stdout
    assert "metadata" in progress_result.stdout
    assert "heartbeat does not mean task success" in progress_result.stdout
    assert "question reports do not ask Commander yet" in progress_result.stdout
    assert "progress-secret" not in progress_result.stdout
    assert "progress-secret-abc123" not in progress_result.stdout
    assert "token=abc123" not in progress_result.stdout

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
    assert event_kinds.count("opencode_session_progress_recorded") == 4
    assert event_kinds.count("opencode_session_heartbeat_recorded") == 0
    forbidden = {
        "opencode_session_timeout_recorded",
        "opencode_session_forced_pause_recorded",
        "commander_guidance_recorded",
        "opencode_commander_question_created",
        "runtime_wake_scheduler_started",
        "runtime_wake_schedule_tick_completed",
        "runtime_continuation_plan_created",
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
    assert "progress-secret" not in serialized_events
    assert "token=abc123" not in serialized_events
    assert "stdout" not in serialized_events
    assert "stderr" not in serialized_events
