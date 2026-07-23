from __future__ import annotations

import json

import pytest


@pytest.mark.phase_m4
def test_user_inspects_context_budget_registry_without_launching_or_mutating(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.env["NXL_SECRET_CONTEXT_BUDGET_TOKEN"] = "context-budget-secret-abc123"
    sandbox.runner.env["NXL_SECRET_CONTEXT_BUDGET_TOKEN"] = "context-budget-secret-abc123"

    project = sandbox.make_empty_project_dir("context_budget_registry_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_context_budget_registry_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise read-only model capability and context budget registry through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["context budget registry renders"],
                "evaluation_protocol": "run headless TUI",
                "approved_by": "e2e",
                "approved_at": "2026-06-28T00:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/model-capabilities"},
        {"type": "submit"},
        {"type": "insert", "text": "/context-budget-summary"},
        {"type": "submit"},
        {"type": "insert", "text": "/context-budget-preview purpose=commander_research_decision provider=vendor-secret=abc123 model=model-secret=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/context-budget-preview purpose=opencode_executor_session"},
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-session-plan-dry-run objective=budget test token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/context-budget-preview purpose=opencode_executor_session max_context_bytes=4096"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /context-budget-preview"},
        {"type": "submit"},
        {"type": "insert", "text": "/model-capability provider=minimax model=minimax-validation-default role=research"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "Context budget registry" in result.stdout
    assert "model_capabilities" in result.stdout
    assert "default-minimax-validation minimax/minimax-validation-default" in result.stdout
    assert "selected=default-minimax-validation provider=minimax model=minimax-validation-default source=default" in result.stdout
    assert "selected_support tools=" in result.stdout
    assert "summary total=" in result.stdout
    assert "preview=context_budget_preview_" in result.stdout
    assert "purpose=opencode_executor_session" in result.stdout
    assert "raw_logs priority=excluded policy=excluded_by_default" in result.stdout
    assert "research_memory priority=low policy=pointer_only" in result.stdout
    assert "safety_margin_tokens=" in result.stdout
    assert "reserved_output priority=required policy=always" in result.stdout
    assert "max_context_bytes=4096" in result.stdout
    assert "note=budget preview does not compile context, call providers, launch OpenCode, query research.db, or mutate missions" in result.stdout
    assert "selected=/context-budget-preview risk=safe_read" in result.stdout
    assert "does not compile context packets" in result.stdout
    assert "context-budget-secret" not in result.stdout
    assert "context-budget-secret-abc123" not in result.stdout
    assert "token=abc123" not in result.stdout
    assert "vendor-secret" not in result.stdout
    assert "model-secret" not in result.stdout

    events_path = project / ".nxl" / "events.jsonl"
    events = (
        [
            json.loads(line)
            for line in events_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        if events_path.exists()
        else []
    )
    event_kinds = [event["kind"] for event in events]
    assert event_kinds.count("runtime_started") == 0
    assert event_kinds.count("opencode_session_planned") == 0
    forbidden = {
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
    }
    assert forbidden.isdisjoint(event_kinds)
    serialized_events = json.dumps(events)
    assert "context-budget-secret" not in serialized_events
    assert "token=abc123" not in serialized_events
