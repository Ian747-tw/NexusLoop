from __future__ import annotations

import json
import re

import pytest


@pytest.mark.phase_m4
def test_user_runs_hybrid_research_memory_search_without_side_effects(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.env["NXL_SECRET_HYBRID_SEARCH_TOKEN"] = "hybrid-search-secret-abc123"
    sandbox.runner.env["NXL_SECRET_HYBRID_SEARCH_TOKEN"] = "hybrid-search-secret-abc123"

    project = sandbox.make_empty_project_dir("research_memory_hybrid_search_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_research_memory_hybrid_search_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise hybrid research memory search through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["hybrid research memory search surface renders"],
                "evaluation_protocol": "run headless TUI",
                "approved_by": "e2e",
                "approved_at": "2026-07-01T00:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    def run_keys(keys: list[dict[str, str]]) -> str:
        sandbox.env["NXL_TUI_KEYS"] = json.dumps(keys)
        sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(keys)
        result = sandbox.run_cli([], cwd=project)
        assert result.exit_code == 0, result.stdout + result.stderr
        return result.stdout

    plan_stdout = run_keys([
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-session-plan objective=hybrid research memory search token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-sessions"},
        {"type": "submit"},
    ])
    session_match = re.search(r"latest=(opencode_session_[A-Za-z0-9._-]+)", plan_stdout)
    assert session_match, plan_stdout
    session_id = session_match.group(1)

    launch_stdout = run_keys([
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-session-instruction-pack-write session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-launch-readiness session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-launch session={session_id}"},
        {"type": "submit"},
    ])
    assert "status=launched" in launch_stdout

    report_stdout = run_keys([
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-progress session={session_id} summary=done with hybrid memory search token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-result-report session={session_id} kind=completion_report summary=hybrid memory search token=abc123 outcome=tests passed changed_files=fileA.ts tests_run=bun-test claims=hybrid-search-works followups=proposal-gate"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-result-reports session={session_id}"},
        {"type": "submit"},
    ])
    report_match = re.search(r"latest_result=(opencode_result_report_[A-Za-z0-9._-]+)", report_stdout) or re.search(r"report=(opencode_result_report_[A-Za-z0-9._-]+)", report_stdout)
    assert report_match, report_stdout
    report_id = report_match.group(1)

    review_stdout = run_keys([
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-result-review report={report_id} decision=accepted rationale=bounded evidence suitable for hybrid search token=abc123 accepted_claims=hybrid-search-works"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-result-reviews report={report_id}"},
        {"type": "submit"},
    ])
    review_match = re.search(r"latest_result=(opencode_result_review_[A-Za-z0-9._-]+)", review_stdout) or re.search(r"review=(opencode_result_review_[A-Za-z0-9._-]+)", review_stdout)
    assert review_match, review_stdout
    review_id = review_match.group(1)

    run_keys([
        {"type": "submit"},
        {"type": "insert", "text": f"/research-ingestion review={review_id} tags=hybrid,search"},
        {"type": "submit"},
        {"type": "insert", "text": f"/research-ingestions review={review_id}"},
        {"type": "submit"},
    ])

    events_path = project / ".nxl" / "events.jsonl"
    events_before_search = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds_before = [event["kind"] for event in events_before_search]

    stdout = run_keys([
        {"type": "submit"},
        {"type": "insert", "text": "/research-memory-profile"},
        {"type": "submit"},
        {"type": "insert", "text": "/research-memory-search query=hybrid search token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/research-memory-search query=hybrid search labels=finding"},
        {"type": "submit"},
        {"type": "insert", "text": "/research-memory-near-duplicates query=hybrid memory search token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/commander-continuity-preview objective=next hybrid-search-safe proposal token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /research-memory-search"},
        {"type": "submit"},
    ])

    assert "Research memory and novelty" in stdout
    assert "search_profile=" in stdout
    assert ("engine=hybrid_fts_lexical" in stdout) or ("engine=bounded_lexical" in stdout and "fts_fallback_reason=" in stdout)
    assert "semantic_search_enabled=false" in stdout
    assert "vector_index_enabled=false" in stdout
    assert "embedding_search_enabled=false" in stdout
    assert "fts_index_enabled=" in stdout
    assert "retrieval_candidates" in stdout
    assert "rank_source=" in stdout
    assert "scoring=" in stdout
    assert "near_duplicates=" in stdout
    assert "risk=" in stdout
    assert "Commander continuity" in stdout
    assert "research_memory=" in stdout
    assert "selected=/research-memory-search risk=safe_read" in stdout
    assert "hybrid-search-secret" not in stdout
    assert "hybrid-search-secret-abc123" not in stdout
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

    new_events = events_after_search[len(events_before_search) :]
    metadata_new_event_kinds = [
        event["kind"]
        for event in new_events
        if event["kind"] not in {"runtime_started", "runtime_ready", "runtime_shutdown"}
    ]
    assert metadata_new_event_kinds == []
    forbidden_events = {
        "research_memory_ingestion_recorded",
        "commander_proposal_created",
        "commander_proposal_applied",
        "runtime_checkpoint_created",
        "followup_mission_created",
        "opencode_prompt_sent",
        "opencode_session_launch_started",
        "opencode_session_process_paused",
        "opencode_session_process_killed",
        "mission_created",
        "mission_completed",
        "mission_failed",
    }
    assert not (set(metadata_new_event_kinds) & forbidden_events)
