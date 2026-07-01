from __future__ import annotations

import json
import re

import pytest


@pytest.mark.phase_m4
def test_user_launches_ready_opencode_session_through_explicit_gate_without_supervision(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.env["NXL_SECRET_LAUNCH_GATE_TOKEN"] = "launch-gate-secret-abc123"
    sandbox.runner.env["NXL_SECRET_LAUNCH_GATE_TOKEN"] = "launch-gate-secret-abc123"

    project = sandbox.make_empty_project_dir("opencode_launch_gate_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_opencode_launch_gate_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise explicit OpenCode launch gate through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["launch gate renders"],
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
        {"type": "insert", "text": "/opencode-session-plan objective=launch gate test token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-sessions"},
        {"type": "submit"},
    ]
    encoded_plan_keys = json.dumps(plan_keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_plan_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_plan_keys

    plan_result = sandbox.run_cli([], cwd=project)
    assert plan_result.exit_code == 0, plan_result.stdout + plan_result.stderr
    session_match = re.search(r"latest=(opencode_session_[A-Za-z0-9._-]+)", plan_result.stdout)
    assert session_match, plan_result.stdout
    session_id = session_match.group(1)

    pack_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-session-instruction-pack-write session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-session-instruction-packs"},
        {"type": "submit"},
    ]
    encoded_pack_keys = json.dumps(pack_keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_pack_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_pack_keys

    pack_result = sandbox.run_cli([], cwd=project)
    assert pack_result.exit_code == 0, pack_result.stdout + pack_result.stderr
    pack_match = re.search(r"latest=(fake-opencode-instruction-pack-[A-Za-z0-9._-]+|opencode_instruction_pack_[A-Za-z0-9._-]+)", pack_result.stdout)
    if not pack_match:
        pack_match = re.search(r"- (opencode_instruction_pack_[A-Za-z0-9._-]+) status=written", pack_result.stdout)
    assert pack_match, pack_result.stdout
    pack_id = pack_match.group(1)

    launch_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-launch-readiness session={session_id} pack={pack_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-launch-preview session={session_id} pack={pack_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-launch-dry-run session={session_id} pack={pack_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-launch session={session_id} pack={pack_id}"},
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-launches"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /opencode-launch"},
        {"type": "submit"},
    ]
    encoded_launch_keys = json.dumps(launch_keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_launch_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_launch_keys

    launch_result = sandbox.run_cli([], cwd=project)

    assert launch_result.exit_code == 0, launch_result.stdout + launch_result.stderr
    assert "screen=main" in launch_result.stdout
    assert "OpenCode launch readiness" in launch_result.stdout
    assert "OpenCode launches" in launch_result.stdout
    assert f"session={session_id}" in launch_result.stdout
    assert f"pack={pack_id}" in launch_result.stdout
    assert "preview/dry-run do not launch" in launch_result.stdout
    assert "9D does not supervise progress" in launch_result.stdout
    assert "launch_performed=false" in launch_result.stdout
    assert "status=dry_run" in launch_result.stdout
    assert "status=launched" in launch_result.stdout
    assert "adapter=fake" in launch_result.stdout
    assert "launch_records" in launch_result.stdout
    assert "selected=/opencode-launch risk=high_impact_write" in launch_result.stdout
    assert "creates_external_process=true" in launch_result.stdout
    assert "First real OpenCode launch gate" in launch_result.stdout
    assert "launch-gate-secret" not in launch_result.stdout
    assert "launch-gate-secret-abc123" not in launch_result.stdout
    assert "token=abc123" not in launch_result.stdout

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
    assert event_kinds.count("opencode_session_launch_failed") == 0
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
        "research_result_ingested",
        "research_db_written",
        "opencode_session_progress_recorded",
        "opencode_session_heartbeat_recorded",
        "opencode_session_timeout_recorded",
    }
    assert forbidden.isdisjoint(event_kinds)
    serialized_events = json.dumps(events)
    assert "launch-gate-secret" not in serialized_events
    assert "token=abc123" not in serialized_events
