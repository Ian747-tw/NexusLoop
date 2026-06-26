from __future__ import annotations

import hashlib
import json

import pytest


@pytest.mark.phase_m4
def test_user_requests_review_for_executor_review_created_proposal(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"

    project = sandbox.make_empty_project_dir("executor_review_proposal_review_request_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_executor_review_proposal_review_request_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise executor review proposal review-request gate through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["executor review proposal review request renders"],
                "evaluation_protocol": "run headless TUI",
                "approved_by": "e2e",
                "approved_at": "2026-06-26T00:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    review_id = "executor_review_request_test"
    review_hash = "executor-review-request-hash"
    draft_id = "draft_" + hashlib.sha256(f"{review_id}:mission_result:{review_hash}".encode("utf-8")).hexdigest()[:16]
    proposal_id = "proposal_review_request_test"
    create_hash = "executor-review-create-hash-request"
    events_path = project / ".nxl" / "events.jsonl"
    events_path.parent.mkdir(parents=True, exist_ok=True)
    initial_events = [
        {
            "kind": "work_intent_created",
            "intent": {
                "intent_id": "intent_review_request_test",
                "kind": "user_message",
                "message": "executor review proposal review request fixture",
                "created_at": "2026-06-26T00:00:00Z",
                "status": "created",
            },
        },
        {
            "kind": "mission_created",
            "mission": {
                "mission_id": "mission_review_request_test",
                "intent_id": "intent_review_request_test",
                "project_dir": str(project),
                "objective": "executor review proposal review request fixture",
                "status": "sent",
                "created_at": "2026-06-26T00:00:00Z",
                "updated_at": "2026-06-26T00:00:00Z",
                "sent_at": "2026-06-26T00:00:00Z",
            },
        },
        {
            "kind": "mission_claimed",
            "claim": {
                "claim_id": "claim_review_request_test",
                "mission_id": "mission_review_request_test",
                "executor_id": "e2e",
                "claimed_at": "2026-06-26T00:00:00Z",
                "status": "active",
            },
        },
        {
            "kind": "mission_result_submitted",
            "result": {
                "result_id": "result_review_request_test",
                "mission_id": "mission_review_request_test",
                "claim_id": "claim_review_request_test",
                "summary": "executor result fixture",
                "created_at": "2026-06-26T00:00:00Z",
                "status": "submitted",
            },
        },
        {
            "kind": "commander_executor_review_succeeded",
            "review_id": review_id,
            "packet_id": "packet_review_request_test",
            "packet_status": "ready_for_commander_review",
            "status": "succeeded",
            "provider_kind": "fake-commander-executor-review",
            "decision": "accept_result",
            "confidence": 0.82,
            "summary": "Accepted executor result for proposal review request.",
            "findings": [
                {
                    "finding_id": "finding_review_request_test",
                    "severity": "info",
                    "title": "Executor result accepted",
                    "summary": "Bounded executor evidence supports a manual proposal.",
                    "evidence_ids": ["mission_result:result_review_request_test"],
                    "recommended_commands": [],
                }
            ],
            "evidence_ids": ["mission_result:result_review_request_test"],
            "recommended_commands": [],
            "started_at": "2026-06-26T00:00:00Z",
            "completed_at": "2026-06-26T00:00:01Z",
            "requested_by": "e2e",
            "review_hash": review_hash,
            "mission_id": "mission_review_request_test",
            "result_id": "result_review_request_test",
            "handoff_id": "handoff_review_request_test",
        },
        {
            "kind": "commander_proposal_created",
            "proposal": {
                "proposal_id": proposal_id,
                "mission_id": "mission_review_request_test",
                "result_id": "result_review_request_test",
                "action_kind": "other",
                "title": "Draft accepted executor result",
                "summary": "Generic manual proposal content should remain review-requestable.",
                "proposed_by": "e2e",
                "status": "proposed",
                "action_payload": {
                    "source": "executor_review_proposal_create",
                    "review_id": review_id,
                    "draft_id": draft_id,
                    "source_packet_id": "packet_review_request_test",
                    "draft_kind": "mission_result",
                    "proposed_action_kind": "other",
                    "target_mission_id": "mission_review_request_test",
                    "target_result_id": "result_review_request_test",
                    "evidence_ids": ["mission_result:result_review_request_test"],
                    "finding_ids": ["finding_review_request_test"],
                    "source_confidence": 0.82,
                    "risk": "medium",
                    "create_hash": create_hash,
                },
                "created_at": "2026-06-26T00:00:02Z",
                "updated_at": "2026-06-26T00:00:02Z",
            },
        },
    ]
    events_path.write_text("\n".join(json.dumps(event) for event in initial_events) + "\n", encoding="utf-8")

    keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/status"},
        {"type": "submit"},
        {"type": "insert", "text": f"/executor-review-draft-preview review={review_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/executor-review-proposal-create-preview review={review_id} draft={draft_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/executor-review-proposal-create review={review_id} draft={draft_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/executor-review-proposal-review-preview proposal={proposal_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/executor-review-proposal-review-dry-run proposal={proposal_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/executor-review-proposal-review-request proposal={proposal_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/executor-review-proposal-review-request proposal={proposal_id}"},
        {"type": "submit"},
        {"type": "insert", "text": "/executor-review-proposal-review-requests"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /executor-review-proposal-review-request"},
        {"type": "submit"},
        {"type": "insert", "text": "/reviews"},
        {"type": "submit"},
        {"type": "insert", "text": f"/executor-review-proposal-review-preview proposal={proposal_id} token=abc123"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.env["NXL_SECRET_EXECUTOR_REVIEW_REQUEST_TOKEN"] = "executor-review-request-secret-abc123"
    sandbox.runner.env["NXL_SECRET_EXECUTOR_REVIEW_REQUEST_TOKEN"] = "executor-review-request-secret-abc123"

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "Executor review proposal review request" in result.stdout
    assert "note=review request does not approve, reject, apply, mutate mission, call provider, or launch OpenCode" in result.stdout
    assert "status=requested" in result.stdout
    assert "review_request=review_" in result.stdout
    assert "Command authority" in result.stdout
    assert "selected=/executor-review-proposal-review-request risk=high_impact_write" in result.stdout
    assert "Reviews" in result.stdout
    assert "Generic manual proposal content should remain review-requestable" in result.stdout
    assert "executor review proposal review request arg is unsupported" in result.stdout
    assert "executor-review-request-secret" not in result.stdout
    assert "executor-review-request-secret-abc123" not in result.stdout
    assert "abc123" not in result.stdout

    events = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds = [event["kind"] for event in events]
    appended_event_kinds = event_kinds[len(initial_events):]
    assert event_kinds.count("review_request_created") == 1
    assert event_kinds.count("commander_proposal_review_requested") == 1
    assert event_kinds.count("commander_executor_review_proposal_review_requested") == 1
    forbidden = {
        "opencode_handoff_started",
        "opencode_handoff_created",
        "opencode_handoff_failed",
        "opencode_process_smoke_started",
        "commander_executor_review_started",
        "commander_executor_review_succeeded",
        "review_request_approved",
        "review_request_rejected",
        "review_request_cancelled",
        "commander_proposal_applied",
        "commander_proposal_apply_failed",
        "mission_progress_recorded",
        "mission_result_submitted",
        "mission_completed",
        "mission_failed",
        "mission_cancelled",
        "external_api_request_executed",
        "research_synthesis_created",
        "commander_cycle_completed",
        "runtime_wake_scheduler_started",
        "runtime_wake_scheduler_stopped",
        "runtime_wake_schedule_tick_completed",
        "runtime_checkpoint_created",
        "runtime_continuation_plan_created",
        "runtime_continuation_step_started",
        "runtime_wake_scheduler_recovery_recorded",
        "runtime_wake_scheduler_recovery_workflow_created",
        "runtime_wake_scheduler_recovery_workflow_step_recorded",
    }
    assert forbidden.isdisjoint(appended_event_kinds)
    serialized_events = json.dumps(events)
    assert "executor-review-request-secret" not in serialized_events
    assert "abc123" not in serialized_events
