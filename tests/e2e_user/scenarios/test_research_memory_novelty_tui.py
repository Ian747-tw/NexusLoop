from __future__ import annotations

import json

import pytest


@pytest.mark.phase_m4
def test_user_previews_research_memory_and_novelty_without_execution_or_mutation(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.env["NXL_SECRET_RESEARCH_MEMORY_TOKEN"] = "research-memory-secret-abc123"
    sandbox.runner.env["NXL_SECRET_RESEARCH_MEMORY_TOKEN"] = "research-memory-secret-abc123"

    project = sandbox.make_empty_project_dir("research_memory_novelty_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_research_memory_novelty_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise read-only research memory retrieval and novelty planner through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["research memory novelty renders"],
                "evaluation_protocol": "run headless TUI",
                "approved_by": "e2e",
                "approved_at": "2026-06-29T00:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/research-memory-summary"},
        {"type": "submit"},
        {"type": "insert", "text": "/research-memory-search query=adapter timeout token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/research-novelty-preview question=adapter timeout method=watchdog config=short-interval"},
        {"type": "submit"},
        {"type": "insert", "text": "/research-novelty-preview question=adapter timeout method=watchdog config=short-interval reason=replication"},
        {"type": "submit"},
        {"type": "insert", "text": "/context-packet-preview purpose=commander_research_decision"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /research-novelty-preview"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "Research memory and novelty" in result.stdout
    assert "summary candidates=" in result.stdout
    assert "retrieval=" in result.stdout
    assert "status=empty" in result.stdout or "retrieval_candidates" in result.stdout
    assert "duplicate_risk=" in result.stdout
    assert "novelty_score=" in result.stdout
    assert "repetition_reason=replication" in result.stdout
    assert "external_research_recommended=" in result.stdout
    assert "previews do not include raw research records, full research.db" in result.stdout
    assert "retrieval/novelty previews do not call providers, call MCPs, launch OpenCode, write research.db" in result.stdout
    assert "Context packet compiler" in result.stdout
    assert "purpose=commander_research_decision" in result.stdout
    assert "selected=/research-novelty-preview risk=safe_read" in result.stdout
    assert "provider calls" in result.stdout
    assert "MCP/online research" in result.stdout or "MCP" in result.stdout
    assert "research.db writes" in result.stdout
    assert "mutate missions" in result.stdout
    assert "research-memory-secret" not in result.stdout
    assert "research-memory-secret-abc123" not in result.stdout
    assert "token=abc123" not in result.stdout

    events = sandbox.events_after_model_setup_bootstrap(project)
    event_kinds = [event["kind"] for event in events]
    assert event_kinds.count("runtime_started") == 0
    forbidden = {
        "opencode_session_planned",
        "opencode_session_instruction_pack_written",
        "opencode_handoff_started",
        "opencode_handoff_created",
        "opencode_handoff_failed",
        "opencode_process_smoke_started",
        "opencode_process_smoke_succeeded",
        "opencode_process_smoke_failed",
        "opencode_process_smoke_blocked",
        "external_api_request_executed",
        "external_api_research_ingestion_created",
        "research_synthesis_created",
        "commander_cycle_completed",
        "mission_created",
        "mission_claimed",
        "mission_progress_recorded",
        "mission_result_submitted",
        "mission_completed",
        "mission_failed",
        "mission_cancelled",
        "review_request_created",
        "review_request_cancelled",
        "commander_proposal_created",
        "commander_proposal_review_requested",
        "commander_proposal_applied",
        "commander_proposal_apply_failed",
        "runtime_checkpoint_created",
        "runtime_wake_scheduler_started",
        "runtime_wake_scheduler_stopped",
        "runtime_wake_schedule_tick_completed",
        "runtime_continuation_plan_created",
        "runtime_continuation_step_started",
        "runtime_wake_scheduler_recovery_recorded",
        "runtime_wake_scheduler_recovery_workflow_created",
        "runtime_wake_scheduler_recovery_workflow_step_recorded",
        "research_result_ingested",
        "research_db_written",
    }
    assert forbidden.isdisjoint(event_kinds)
    assert not any("research" in kind and ("created" in kind or "ingest" in kind or "write" in kind) for kind in event_kinds)
    serialized_events = json.dumps(events)
    assert "research-memory-secret" not in serialized_events
    assert "token=abc123" not in serialized_events
