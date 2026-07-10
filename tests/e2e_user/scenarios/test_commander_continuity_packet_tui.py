from __future__ import annotations

import json
import re

import pytest


@pytest.mark.phase_m4
def test_user_previews_commander_continuity_packets_without_writes(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.env["NXL_SECRET_CONTINUITY_TOKEN"] = "continuity-secret-abc123"
    sandbox.runner.env["NXL_SECRET_CONTINUITY_TOKEN"] = "continuity-secret-abc123"

    project = sandbox.make_empty_project_dir("commander_continuity_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_commander_continuity_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise Commander continuity packet preview through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["continuity packet surface renders"],
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
        {"type": "insert", "text": "/opencode-session-plan objective=continuity packet test token=abc123"},
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
        {"type": "insert", "text": f"/opencode-question session={session_id} question=need commander continuity decision token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-ask-commander session={session_id} question=need commander continuity decision token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-human-correction session={session_id} correction=preserve continuity token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-result-report session={session_id} kind=completion_report summary=continuity evidence token=abc123 outcome=tests passed claims=continuity-works"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-result-reports session={session_id}"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(evidence_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(evidence_keys)
    evidence_result = sandbox.run_cli([], cwd=project)
    assert evidence_result.exit_code == 0, evidence_result.stdout + evidence_result.stderr
    report_match = re.search(r"latest_result=(opencode_result_report_[A-Za-z0-9._-]+)", evidence_result.stdout)
    if not report_match:
        report_match = re.search(r"report=(opencode_result_report_[A-Za-z0-9._-]+)", evidence_result.stdout)
    assert report_match, evidence_result.stdout
    report_id = report_match.group(1)

    review_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-result-review report={report_id} decision=accepted rationale=bounded continuity evidence token=abc123 accepted_claims=continuity-works"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-result-reviews report={report_id}"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(review_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(review_keys)
    review_result = sandbox.run_cli([], cwd=project)
    assert review_result.exit_code == 0, review_result.stdout + review_result.stderr
    review_match = re.search(r"latest_result=(opencode_result_review_[A-Za-z0-9._-]+)", review_result.stdout)
    if not review_match:
        review_match = re.search(r"review=(opencode_result_review_[A-Za-z0-9._-]+)", review_result.stdout)
    assert review_match, review_result.stdout
    review_id = review_match.group(1)

    ingestion_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/research-ingestion review={review_id} tags=continuity,memory"},
        {"type": "submit"},
        {"type": "insert", "text": f"/research-ingestions review={review_id}"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(ingestion_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(ingestion_keys)
    ingestion_result = sandbox.run_cli([], cwd=project)
    assert ingestion_result.exit_code == 0, ingestion_result.stdout + ingestion_result.stderr
    assert "research_db_written=" in ingestion_result.stdout

    memory_keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/research-memory-search query=continuity packet token=abc123"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(memory_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(memory_keys)
    memory_result = sandbox.run_cli([], cwd=project)
    assert memory_result.exit_code == 0, memory_result.stdout + memory_result.stderr
    assert "Research memory and novelty" in memory_result.stdout

    events_path = project / ".nxl" / "events.jsonl"
    events_before_continuity = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds_before = [event["kind"] for event in events_before_continuity]

    continuity_keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/commander-continuity-preview objective=plan next continuity-safe research token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/commander-proposal-memory-packet objective=plan next continuity-safe research token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/commander-midmission-packet session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/commander-open-loops session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": "/commander-continuity-summary"},
        {"type": "submit"},
        {"type": "insert", "text": f"/commander-continuity-thread session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /commander-continuity-preview"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(continuity_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(continuity_keys)
    continuity_result = sandbox.run_cli([], cwd=project)
    assert continuity_result.exit_code == 0, continuity_result.stdout + continuity_result.stderr

    stdout = continuity_result.stdout
    assert "Commander continuity" in stdout
    assert "proposal_packet=" in stdout
    assert "mid_mission_packet=" in stdout
    assert f"session={session_id}" in stdout
    assert "launch=" in stdout
    assert "research_memory=" in stdout
    assert "search_profile=bounded_lexical" in stdout
    assert "semantic_search_enabled=false" in stdout
    assert "vector_index_enabled=false" in stdout
    assert "fts_index_enabled=false" in stdout
    assert "pending_commander_question" in stdout
    assert "human_correction" in stdout
    assert "source_refs" in stdout
    assert "budget target=" in stdout
    assert "omitted=" in stdout
    assert "continuity packet is read-only" in stdout
    assert "no Commander proposal was generated" in stdout
    assert "selected=/commander-continuity-preview risk=safe_read" in stdout
    assert "continuity-secret" not in stdout
    assert "continuity-secret-abc123" not in stdout
    assert "token=abc123" not in stdout

    events_after_continuity = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds_after = [event["kind"] for event in events_after_continuity]
    assert event_kinds_after.count("opencode_commander_question_created") == event_kinds_before.count("opencode_commander_question_created")
    assert event_kinds_after.count("opencode_human_control_recorded") == event_kinds_before.count("opencode_human_control_recorded")
    assert event_kinds_after.count("opencode_result_report_recorded") == event_kinds_before.count("opencode_result_report_recorded")
    assert event_kinds_after.count("opencode_result_review_recorded") == event_kinds_before.count("opencode_result_review_recorded")
    assert event_kinds_after.count("research_memory_ingestion_recorded") == event_kinds_before.count("research_memory_ingestion_recorded")

    new_events = events_after_continuity[len(events_before_continuity) :]
    metadata_new_event_kinds = [
        event["kind"]
        for event in new_events
        if event["kind"] not in {"runtime_started", "runtime_ready", "runtime_shutdown"}
    ]
    assert metadata_new_event_kinds == []

    forbidden_events = {
        "commander_continuity_packet_compiled",
        "commander_proposal_created",
        "commander_proposal_applied",
        "research_memory_ingestion_recorded",
        "research_db_written",
        "runtime_checkpoint_created",
        "followup_mission_created",
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
    }
    continuity_event_kinds = [event["kind"] for event in new_events]
    assert forbidden_events.isdisjoint(continuity_event_kinds)
    serialized_new_events = json.dumps(new_events)
    assert "continuity-secret" not in serialized_new_events
    assert "token=abc123" not in serialized_new_events
    assert "stdout" not in serialized_new_events
    assert "stderr" not in serialized_new_events
    assert "raw_logs" not in serialized_new_events
