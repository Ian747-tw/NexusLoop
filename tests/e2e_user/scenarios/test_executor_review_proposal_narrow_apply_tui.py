from __future__ import annotations

import hashlib
import json

import pytest


@pytest.mark.phase_m4
def test_user_narrow_applies_executor_review_proposal(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"

    project = sandbox.make_empty_project_dir("executor_review_proposal_narrow_apply_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_executor_review_proposal_narrow_apply_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise executor review proposal narrow apply through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["executor review proposal narrow apply renders"],
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

    review_id = "executor_review_narrow_apply"
    review_hash = "executor-review-narrow-apply-hash"
    draft_id = "draft_" + hashlib.sha256(f"{review_id}:human_review:{review_hash}".encode("utf-8")).hexdigest()[:16]
    proposal_id = "proposal_narrow_apply"
    review_request_id = "review_request_narrow_apply"
    request_gate_id = "executor_review_proposal_review_request_narrow_apply"
    create_id = "executor_review_proposal_create_narrow_apply"

    initial_events = [
        {
            "kind": "work_intent_created",
            "intent": {
                "intent_id": "intent_narrow_apply",
                "kind": "user_message",
                "message": "executor review proposal narrow apply fixture",
                "created_at": "2026-06-26T00:00:00Z",
                "status": "created",
            },
        },
        {
            "kind": "mission_created",
            "mission": {
                "mission_id": "mission_narrow_apply",
                "intent_id": "intent_narrow_apply",
                "project_dir": str(project),
                "objective": "generic manual executor review proposal narrow apply",
                "status": "sent",
                "created_at": "2026-06-26T00:00:00Z",
                "updated_at": "2026-06-26T00:00:00Z",
                "sent_at": "2026-06-26T00:00:00Z",
            },
        },
        {
            "kind": "mission_claimed",
            "claim": {
                "claim_id": "claim_narrow_apply",
                "mission_id": "mission_narrow_apply",
                "executor_id": "e2e",
                "claimed_at": "2026-06-26T00:00:00Z",
                "status": "active",
            },
        },
        {
            "kind": "commander_executor_review_succeeded",
            "review_id": review_id,
            "packet_id": "packet_narrow_apply",
            "packet_status": "ready_for_commander_review",
            "status": "succeeded",
            "provider_kind": "fake-commander-executor-review",
            "decision": "needs_human_review",
            "confidence": 0.82,
            "summary": "Human review requested for generic manual proposal content.",
            "findings": [
                {
                    "finding_id": "finding_narrow_apply",
                    "severity": "warning",
                    "title": "Human review requested",
                    "summary": "Bounded executor evidence supports a human-review proposal without mission mutation.",
                    "evidence_ids": ["manual_note:narrow_apply"],
                    "recommended_commands": [],
                }
            ],
            "evidence_ids": ["manual_note:narrow_apply"],
            "recommended_commands": [],
            "started_at": "2026-06-26T00:00:00Z",
            "completed_at": "2026-06-26T00:00:01Z",
            "requested_by": "e2e",
            "review_hash": review_hash,
            "mission_id": "mission_narrow_apply",
        },
        {
            "kind": "commander_proposal_created",
            "proposal": {
                "proposal_id": proposal_id,
                "mission_id": "mission_narrow_apply",
                "action_kind": "other",
                "title": "Generic executor review proposal narrow apply",
                "summary": "Generic manual proposal content should remain narrow-apply eligible.",
                "proposed_by": "e2e",
                "status": "proposed",
                "action_payload": {
                    "source": "executor_review_proposal_create",
                    "review_id": review_id,
                    "draft_id": draft_id,
                    "source_packet_id": "packet_narrow_apply",
                    "draft_kind": "human_review",
                    "proposed_action_kind": "other",
                    "target_mission_id": "mission_narrow_apply",
                    "evidence_ids": ["manual_note:narrow_apply"],
                    "finding_ids": ["finding_narrow_apply"],
                    "source_confidence": 0.82,
                    "risk": "medium",
                    "create_hash": "executor-review-create-hash-narrow-apply",
                },
                "created_at": "2026-06-26T00:00:02Z",
                "updated_at": "2026-06-26T00:00:03Z",
            },
        },
        {
            "kind": "commander_executor_review_proposal_created",
            "create_id": create_id,
            "status": "created",
            "proposal_id": proposal_id,
            "review_id": review_id,
            "draft_id": draft_id,
            "source_packet_id": "packet_narrow_apply",
            "draft_kind": "human_review",
            "proposed_action_kind": "other",
            "title_preview": "Generic executor review proposal narrow apply",
            "summary_preview": "Generic manual proposal content should remain narrow-apply eligible.",
            "evidence_ids": ["manual_note:narrow_apply"],
            "finding_ids": ["finding_narrow_apply"],
            "created_at": "2026-06-26T00:00:02Z",
            "requested_by": "e2e",
            "create_hash": "executor-review-create-hash-narrow-apply",
            "recommended_commands": [],
        },
        {
            "kind": "review_request_created",
            "review": {
                "review_id": review_request_id,
                "mission_id": "mission_narrow_apply",
                "request_type": "operator_checkpoint",
                "title": "Review generic executor review proposal narrow apply",
                "summary": "Review request for generic manual executor proposal content.",
                "requested_by": "e2e",
                "status": "pending",
                "created_at": "2026-06-26T00:00:03Z",
                "updated_at": "2026-06-26T00:00:03Z",
            },
        },
        {"kind": "commander_proposal_review_requested", "proposal_id": proposal_id, "review_id": review_request_id, "requested_at": "2026-06-26T00:00:03Z"},
        {
            "kind": "commander_executor_review_proposal_review_requested",
            "request_gate_id": request_gate_id,
            "status": "requested",
            "review_request_id": review_request_id,
            "proposal_id": proposal_id,
            "create_id": create_id,
            "review_id": review_id,
            "draft_id": draft_id,
            "source_packet_id": "packet_narrow_apply",
            "mission_id": "mission_narrow_apply",
            "requested_at": "2026-06-26T00:00:03Z",
            "requested_by": "e2e",
            "request_hash": "executor-review-request-hash-narrow-apply",
            "recommended_commands": [],
        },
    ]
    events_path.write_text("\n".join(json.dumps(event) for event in initial_events) + "\n", encoding="utf-8")

    keys = [
        {"type": "submit"},
        # Force normal real-runtime startup before explicit write commands.
        {"type": "insert", "text": "/status"},
        {"type": "submit"},
        {"type": "insert", "text": f"/executor-review-draft-preview review={review_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/executor-review-proposal-create review={review_id} draft={draft_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/executor-review-proposal-review-request proposal={proposal_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/executor-review-proposal-review-approve review={review_request_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/executor-review-proposal-apply-readiness proposal={proposal_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/executor-review-proposal-narrow-apply-preview proposal={proposal_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/executor-review-proposal-narrow-apply-dry-run proposal={proposal_id} reason=manual token=abc123 check"},
        {"type": "submit"},
        {"type": "insert", "text": f"/executor-review-proposal-narrow-apply proposal={proposal_id} reason=manual token=abc123 apply"},
        {"type": "submit"},
        {"type": "insert", "text": "/executor-review-proposal-narrow-applies"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /executor-review-proposal-narrow-apply"},
        {"type": "submit"},
        {"type": "insert", "text": f"/proposal {proposal_id}"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.env["NXL_SECRET_NARROW_APPLY_TOKEN"] = "executor-narrow-apply-secret-abc123"
    sandbox.runner.env["NXL_SECRET_NARROW_APPLY_TOKEN"] = "executor-narrow-apply-secret-abc123"

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "Executor review proposal narrow apply" in result.stdout
    assert "note=narrow apply marks the proposal applied only and does not mutate missions, submit results, call provider, or launch OpenCode" in result.stdout
    assert f"latest=executor_review_proposal_narrow_apply_" in result.stdout
    assert f"status=applied proposal={proposal_id} candidate=human_review risk=medium" in result.stdout
    assert "candidate=human_review risk=medium" in result.stdout
    assert "Command authority" in result.stdout
    assert "selected=/executor-review-proposal-narrow-apply risk=high_impact_write" in result.stdout
    assert "Commander proposals" in result.stdout
    assert f"selected_proposal={proposal_id} [applied] other" in result.stdout
    assert "Generic manual proposal content should remain narrow-apply eligible" in result.stdout
    assert "executor-narrow-apply-secret" not in result.stdout
    assert "executor-narrow-apply-secret-abc123" not in result.stdout
    assert "abc123" not in result.stdout

    events = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    event_kinds = [event["kind"] for event in events]
    appended_event_kinds = event_kinds[len(initial_events):]
    assert event_kinds.count("review_request_approved") == 1
    assert event_kinds.count("commander_executor_review_proposal_review_approved") == 1
    assert event_kinds.count("commander_proposal_approved") == 1
    assert event_kinds.count("commander_proposal_applied") == 1
    assert event_kinds.count("commander_executor_review_proposal_narrow_applied") == 1
    assert "commander_proposal_applied" in appended_event_kinds
    assert "commander_executor_review_proposal_narrow_applied" in appended_event_kinds
    assert "mission_result_submitted" not in event_kinds
    forbidden = {
        "opencode_handoff_started",
        "opencode_handoff_created",
        "opencode_handoff_failed",
        "opencode_process_smoke_started",
        "commander_executor_review_started",
        "commander_executor_review_succeeded",
        "commander_proposal_apply_failed",
        "mission_progress_recorded",
        "mission_result_submitted",
        "mission_completed",
        "mission_failed",
        "mission_cancelled",
        "runtime_checkpoint_created",
        "external_api_request_executed",
        "research_synthesis_created",
        "commander_cycle_completed",
        "runtime_wake_scheduler_started",
        "runtime_wake_scheduler_stopped",
        "runtime_wake_schedule_tick_completed",
        "runtime_continuation_plan_created",
        "runtime_continuation_step_started",
        "runtime_wake_scheduler_recovery_recorded",
        "runtime_wake_scheduler_recovery_workflow_created",
        "runtime_wake_scheduler_recovery_workflow_step_recorded",
    }
    assert forbidden.isdisjoint(appended_event_kinds)
    serialized_events = json.dumps(events)
    assert "executor-narrow-apply-secret" not in serialized_events
    assert "abc123" not in serialized_events
