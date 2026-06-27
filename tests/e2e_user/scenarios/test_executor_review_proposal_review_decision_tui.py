from __future__ import annotations

import hashlib
import json

import pytest


@pytest.mark.phase_m4
def test_user_decides_executor_review_proposal_review_request(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"

    project = sandbox.make_empty_project_dir("executor_review_proposal_review_decision_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_executor_review_proposal_review_decision_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise executor review proposal review decision gate through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["executor review proposal review decision renders"],
                "evaluation_protocol": "run headless TUI",
                "approved_by": "e2e",
                "approved_at": "2026-06-26T00:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    events_path = project / ".nxl" / "events.jsonl"
    events_path.parent.mkdir(parents=True, exist_ok=True)

    def source_events(suffix: str, decision: str) -> list[dict]:
        review_id = f"executor_review_decision_{suffix}"
        review_hash = f"executor-review-decision-hash-{suffix}"
        draft_kind = "mission_result" if decision == "accept_result" else "human_review"
        draft_id = "draft_" + hashlib.sha256(f"{review_id}:{draft_kind}:{review_hash}".encode("utf-8")).hexdigest()[:16]
        proposal_id = f"proposal_decision_{suffix}"
        review_request_id = f"review_request_decision_{suffix}"
        request_gate_id = f"executor_review_proposal_review_request_{suffix}"
        request_hash = f"executor-review-request-hash-{suffix}"
        create_hash = f"executor-review-create-hash-{suffix}"
        return [
            {
                "kind": "work_intent_created",
                "intent": {
                    "intent_id": f"intent_decision_{suffix}",
                    "kind": "user_message",
                    "message": f"executor review proposal review decision fixture {suffix}",
                    "created_at": "2026-06-26T00:00:00Z",
                    "status": "created",
                },
            },
            {
                "kind": "mission_created",
                "mission": {
                    "mission_id": f"mission_decision_{suffix}",
                    "intent_id": f"intent_decision_{suffix}",
                    "project_dir": str(project),
                    "objective": f"generic manual executor review proposal {suffix}",
                    "status": "sent",
                    "created_at": "2026-06-26T00:00:00Z",
                    "updated_at": "2026-06-26T00:00:00Z",
                    "sent_at": "2026-06-26T00:00:00Z",
                },
            },
            {
                "kind": "mission_claimed",
                "claim": {
                    "claim_id": f"claim_decision_{suffix}",
                    "mission_id": f"mission_decision_{suffix}",
                    "executor_id": "e2e",
                    "claimed_at": "2026-06-26T00:00:00Z",
                    "status": "active",
                },
            },
            {
                "kind": "mission_result_submitted",
                "result": {
                    "result_id": f"result_decision_{suffix}",
                    "mission_id": f"mission_decision_{suffix}",
                    "claim_id": f"claim_decision_{suffix}",
                    "summary": f"executor result fixture {suffix}",
                    "created_at": "2026-06-26T00:00:00Z",
                    "status": "submitted",
                },
            },
            {
                "kind": "commander_executor_review_succeeded",
                "review_id": review_id,
                "packet_id": f"packet_decision_{suffix}",
                "packet_status": "ready_for_commander_review",
                "status": "succeeded",
                "provider_kind": "fake-commander-executor-review",
                "decision": decision,
                "confidence": 0.82,
                "summary": "Accepted executor result for proposal review decision.",
                "findings": [
                    {
                        "finding_id": f"finding_decision_{suffix}",
                        "severity": "info",
                        "title": "Executor result accepted",
                        "summary": "Bounded executor evidence supports a generic manual proposal.",
                        "evidence_ids": [f"mission_result:result_decision_{suffix}"],
                        "recommended_commands": [],
                    }
                ],
                "evidence_ids": [f"mission_result:result_decision_{suffix}"],
                "recommended_commands": [],
                "started_at": "2026-06-26T00:00:00Z",
                "completed_at": "2026-06-26T00:00:01Z",
                "requested_by": "e2e",
                "review_hash": review_hash,
                "mission_id": f"mission_decision_{suffix}",
                "result_id": f"result_decision_{suffix}",
            },
            {
                "kind": "commander_proposal_created",
                "proposal": {
                    "proposal_id": proposal_id,
                    "mission_id": f"mission_decision_{suffix}",
                    "result_id": f"result_decision_{suffix}",
                    "action_kind": "other",
                    "title": f"Generic executor review proposal {suffix}",
                    "summary": "Generic manual proposal content should remain decision-eligible.",
                    "proposed_by": "e2e",
                    "status": "proposed",
                    "action_payload": {
                        "source": "executor_review_proposal_create",
                        "review_id": review_id,
                        "draft_id": draft_id,
                        "source_packet_id": f"packet_decision_{suffix}",
                        "draft_kind": draft_kind,
                        "proposed_action_kind": "other",
                        "target_mission_id": f"mission_decision_{suffix}",
                        "target_result_id": f"result_decision_{suffix}",
                        "evidence_ids": [f"mission_result:result_decision_{suffix}"],
                        "finding_ids": [f"finding_decision_{suffix}"],
                        "source_confidence": 0.82,
                        "risk": "medium",
                        "create_hash": create_hash,
                    },
                    "created_at": "2026-06-26T00:00:02Z",
                    "updated_at": "2026-06-26T00:00:03Z",
                },
            },
            {
                "kind": "commander_executor_review_proposal_created",
                "create_id": f"executor_review_proposal_create_{suffix}",
                "status": "created",
                "proposal_id": proposal_id,
                "review_id": review_id,
                "draft_id": draft_id,
                "source_packet_id": f"packet_decision_{suffix}",
                "draft_kind": draft_kind,
                "proposed_action_kind": "other",
                "title_preview": f"Generic executor review proposal {suffix}",
                "summary_preview": "Generic manual proposal content should remain decision-eligible.",
                "evidence_ids": [f"mission_result:result_decision_{suffix}"],
                "finding_ids": [f"finding_decision_{suffix}"],
                "created_at": "2026-06-26T00:00:02Z",
                "requested_by": "e2e",
                "create_hash": create_hash,
                "recommended_commands": [],
            },
            {
                "kind": "review_request_created",
                "review": {
                    "review_id": review_request_id,
                    "mission_id": f"mission_decision_{suffix}",
                    "result_id": f"result_decision_{suffix}",
                    "request_type": "operator_checkpoint",
                    "title": f"Review generic executor review proposal {suffix}",
                    "summary": "Review request for generic manual executor proposal content.",
                    "requested_by": "e2e",
                    "status": "pending",
                    "created_at": "2026-06-26T00:00:03Z",
                    "updated_at": "2026-06-26T00:00:03Z",
                },
            },
            {
                "kind": "commander_proposal_review_requested",
                "proposal_id": proposal_id,
                "review_id": review_request_id,
                "requested_at": "2026-06-26T00:00:03Z",
            },
            {
                "kind": "commander_executor_review_proposal_review_requested",
                "request_gate_id": request_gate_id,
                "status": "requested",
                "review_request_id": review_request_id,
                "proposal_id": proposal_id,
                "create_id": f"executor_review_proposal_create_{suffix}",
                "review_id": review_id,
                "draft_id": draft_id,
                "source_packet_id": f"packet_decision_{suffix}",
                "mission_id": f"mission_decision_{suffix}",
                "result_id": f"result_decision_{suffix}",
                "requested_at": "2026-06-26T00:00:03Z",
                "requested_by": "e2e",
                "request_hash": request_hash,
                "recommended_commands": [],
            },
        ]

    initial_events = source_events("approve", "accept_result") + source_events("reject", "needs_human_review")
    events_path.write_text("\n".join(json.dumps(event) for event in initial_events) + "\n", encoding="utf-8")

    keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/status"},
        {"type": "submit"},
        {"type": "insert", "text": "/executor-review-draft-preview review=executor_review_decision_approve"},
        {"type": "submit"},
        {"type": "insert", "text": "/executor-review-proposal-create review=executor_review_decision_approve draft=draft_" + hashlib.sha256("executor_review_decision_approve:mission_result:executor-review-decision-hash-approve".encode("utf-8")).hexdigest()[:16]},
        {"type": "submit"},
        {"type": "insert", "text": "/executor-review-proposal-review-request proposal=proposal_decision_approve"},
        {"type": "submit"},
        {"type": "insert", "text": "/executor-review-proposal-review-decision-preview review=review_request_decision_approve decision=approve"},
        {"type": "submit"},
        {"type": "insert", "text": "/executor-review-proposal-review-decision-dry-run review=review_request_decision_approve decision=approve"},
        {"type": "submit"},
        {"type": "insert", "text": "/executor-review-proposal-review-approve review=review_request_decision_approve"},
        {"type": "submit"},
        {"type": "insert", "text": "/executor-review-proposal-review-reject review=review_request_decision_reject reason=needs human review"},
        {"type": "submit"},
        {"type": "insert", "text": "/executor-review-proposal-review-decisions"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /executor-review-proposal-review-approve"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /executor-review-proposal-review-reject"},
        {"type": "submit"},
        {"type": "insert", "text": "/reviews"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.env["NXL_SECRET_EXECUTOR_REVIEW_DECISION_TOKEN"] = "executor-review-decision-secret-abc123"
    sandbox.runner.env["NXL_SECRET_EXECUTOR_REVIEW_DECISION_TOKEN"] = "executor-review-decision-secret-abc123"

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "Executor review proposal review decision" in result.stdout
    assert "note=review decision does not apply proposals, mutate missions, call provider, or launch OpenCode" in result.stdout
    assert "status=approved decision=approve review_request=review_request_decision_approve" in result.stdout
    assert "status=rejected decision=reject review_request=review_request_decision_reject" in result.stdout
    assert "Command authority" in result.stdout
    assert "selected=/executor-review-proposal-review-reject risk=high_impact_write" in result.stdout
    assert "Reviews" in result.stdout
    assert "Generic manual proposal content should remain decision-eligible" in result.stdout
    assert "executor-review-decision-secret" not in result.stdout
    assert "executor-review-decision-secret-abc123" not in result.stdout
    assert "abc123" not in result.stdout

    events = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds = [event["kind"] for event in events]
    appended_event_kinds = event_kinds[len(initial_events):]
    assert event_kinds.count("review_request_approved") == 1
    assert event_kinds.count("review_request_rejected") == 1
    assert event_kinds.count("commander_executor_review_proposal_review_approved") == 1
    assert event_kinds.count("commander_executor_review_proposal_review_rejected") == 1
    assert event_kinds.count("commander_proposal_approved") == 1
    assert event_kinds.count("commander_proposal_rejected") == 1
    assert "review_request_approved" in appended_event_kinds
    assert "review_request_rejected" in appended_event_kinds
    forbidden = {
        "opencode_handoff_started",
        "opencode_handoff_created",
        "opencode_handoff_failed",
        "opencode_process_smoke_started",
        "commander_executor_review_started",
        "commander_executor_review_succeeded",
        "commander_proposal_applied",
        "commander_proposal_apply_failed",
        "mission_progress_recorded",
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
    assert "executor-review-decision-secret" not in serialized_events
    assert "abc123" not in serialized_events
