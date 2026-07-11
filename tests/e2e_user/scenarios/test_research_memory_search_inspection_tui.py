from __future__ import annotations

import json
import re

import pytest


@pytest.mark.phase_m4
def test_user_searches_inspects_and_profiles_research_memory_without_writes(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.env["NXL_SECRET_RESEARCH_SEARCH_TOKEN"] = "research-search-secret-abc123"
    sandbox.runner.env["NXL_SECRET_RESEARCH_SEARCH_TOKEN"] = "research-search-secret-abc123"

    project = sandbox.make_empty_project_dir("research_memory_search_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_research_memory_search_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise research memory search inspection through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["research memory search surface renders"],
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
        {"type": "insert", "text": "/opencode-session-plan objective=research memory search expansion token=abc123"},
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

    report_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-progress session={session_id} summary=done with search memory candidate token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-result-report session={session_id} kind=completion_report summary=search memory candidate token=abc123 outcome=tests passed changed_files=fileA.ts tests_run=bun-test claims=memory-search-works followups=inspect-memory"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-result-reports session={session_id}"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(report_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(report_keys)
    report_result = sandbox.run_cli([], cwd=project)
    assert report_result.exit_code == 0, report_result.stdout + report_result.stderr
    report_match = re.search(r"latest_result=(opencode_result_report_[A-Za-z0-9._-]+)", report_result.stdout)
    if not report_match:
        report_match = re.search(r"report=(opencode_result_report_[A-Za-z0-9._-]+)", report_result.stdout)
    assert report_match, report_result.stdout
    report_id = report_match.group(1)

    review_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-result-review report={report_id} decision=accepted rationale=bounded evidence suitable for memory token=abc123 accepted_claims=memory-search-works"},
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
        {"type": "insert", "text": f"/research-ingestion review={review_id} tags=memory,search"},
        {"type": "submit"},
        {"type": "insert", "text": f"/research-ingestions review={review_id}"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(ingestion_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(ingestion_keys)
    ingestion_result = sandbox.run_cli([], cwd=project)
    assert ingestion_result.exit_code == 0, ingestion_result.stdout + ingestion_result.stderr
    memory_match = re.search(r"research_memory_id=(research_memory_[A-Za-z0-9._-]+)", ingestion_result.stdout)
    if not memory_match:
        memory_match = re.search(r"memory=(research_memory_[A-Za-z0-9._-]+)", ingestion_result.stdout)
    assert memory_match, ingestion_result.stdout
    memory_id = memory_match.group(1)

    events_path = project / ".nxl" / "events.jsonl"
    events_before_search = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds_before = [event["kind"] for event in events_before_search]

    search_keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/research-memory-summary"},
        {"type": "submit"},
        {"type": "insert", "text": "/research-memory-search query=memory search token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/research-memory-search query=memory search labels=finding"},
        {"type": "submit"},
        {"type": "insert", "text": "/research-memory-near-duplicates query=memory search expansion token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/research-memory-profile"},
        {"type": "submit"},
        {"type": "insert", "text": f"/research-memory-show {memory_id}"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /research-memory-search"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /research-memory-near-duplicates"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(search_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(search_keys)
    search_result = sandbox.run_cli([], cwd=project)
    assert search_result.exit_code == 0, search_result.stdout + search_result.stderr

    stdout = search_result.stdout
    assert "Research memory and novelty" in stdout
    assert "retrieval_candidates" in stdout
    assert "scoring=" in stdout
    assert "rank_source=" in stdout
    assert "fields=" in stdout
    assert "matched" in stdout
    assert "near_duplicates=" in stdout
    assert "risk=" in stdout
    assert "search_profile=" in stdout
    assert ("engine=hybrid_fts_lexical" in stdout) or ("engine=bounded_lexical" in stdout)
    assert "semantic_search_enabled=false" in stdout
    assert "vector_index_enabled=false" in stdout
    assert "fts_index_enabled=" in stdout
    assert f"selected={memory_id}" in stdout
    assert "selected_refs artifacts=" in stdout
    assert "provenance=" in stdout
    assert "previews do not include raw research records" in stdout
    assert "full research.db" in stdout
    assert "selected=/research-memory-near-duplicates risk=safe_read" in stdout
    assert "lexical" in stdout
    assert "research-search-secret" not in stdout
    assert "research-search-secret-abc123" not in stdout
    assert "token=abc123" not in stdout

    events_after_search = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds_after = [event["kind"] for event in events_after_search]
    assert event_kinds_after.count("research_memory_ingestion_recorded") == event_kinds_before.count("research_memory_ingestion_recorded")
    assert event_kinds_after.count("opencode_result_review_recorded") == event_kinds_before.count("opencode_result_review_recorded")
    assert event_kinds_after.count("opencode_result_report_recorded") == event_kinds_before.count("opencode_result_report_recorded")
    assert event_kinds_after.count("opencode_session_launch_started") == event_kinds_before.count("opencode_session_launch_started")
    assert event_kinds_after.count("opencode_session_launch_succeeded") == event_kinds_before.count("opencode_session_launch_succeeded")

    new_events = events_after_search[len(events_before_search) :]
    metadata_new_event_kinds = [
        event["kind"]
        for event in new_events
        if event["kind"] not in {"runtime_started", "runtime_ready", "runtime_shutdown"}
    ]
    assert metadata_new_event_kinds == []

    forbidden_events = {
        "research_memory_ingestion_recorded",
        "runtime_checkpoint_created",
        "followup_mission_created",
        "opencode_prompt_sent",
        "opencode_commander_guidance_delivered",
        "opencode_session_process_paused",
        "opencode_session_process_resumed",
        "opencode_session_process_killed",
        "opencode_session_process_stopped",
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
    }
    assert not (set(metadata_new_event_kinds) & forbidden_events)
