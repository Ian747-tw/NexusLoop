from __future__ import annotations

import json
import hashlib
import re

import pytest


@pytest.mark.phase_m4
def test_user_writes_opencode_session_instruction_pack_without_launching(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.env["NXL_SECRET_INSTRUCTION_PACK_TOKEN"] = "instruction-pack-secret-abc123"
    sandbox.runner.env["NXL_SECRET_INSTRUCTION_PACK_TOKEN"] = "instruction-pack-secret-abc123"

    project = sandbox.make_empty_project_dir("opencode_session_instruction_pack_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_opencode_session_instruction_pack_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise OpenCode session instruction-pack writing through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["instruction pack files render and write"],
                "evaluation_protocol": "run headless TUI",
                "approved_by": "e2e",
                "approved_at": "2026-06-29T00:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    plan_keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-session-plan objective=instruction pack test token=abc123"},
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
    target_dir = project / ".nxl" / "opencode" / "sessions" / session_id
    assert not target_dir.exists()

    pack_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/context-packet-preview purpose=opencode_executor_session session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-session-instruction-pack-preview session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-session-instruction-pack-dry-run session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-session-instruction-pack-write session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-session-instruction-packs"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /opencode-session-instruction-pack-write"},
        {"type": "submit"},
    ]
    encoded_pack_keys = json.dumps(pack_keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_pack_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_pack_keys

    pack_result = sandbox.run_cli([], cwd=project)

    assert pack_result.exit_code == 0, pack_result.stdout + pack_result.stderr
    assert "screen=main" in pack_result.stdout
    assert "OpenCode session instruction packs" in pack_result.stdout
    assert "Context packet compiler" in pack_result.stdout
    assert f"session={session_id}" in pack_result.stdout
    assert "TASK.md" in pack_result.stdout
    assert "CONTEXT.md" in pack_result.stdout
    assert "GUIDANCE.md" in pack_result.stdout
    assert "SESSION_MEMORY.md" in pack_result.stdout
    assert "POLICY.md" in pack_result.stdout
    assert "MANIFEST.json" in pack_result.stdout
    assert "opencode-session-config.json" in pack_result.stdout
    assert "records=1" in pack_result.stdout
    assert "selected=/opencode-session-instruction-pack-write risk=high_impact_write" in pack_result.stdout
    assert "instruction-pack writing does not launch OpenCode" in pack_result.stdout
    assert "instruction-pack-secret" not in pack_result.stdout
    assert "instruction-pack-secret-abc123" not in pack_result.stdout
    assert "token=abc123" not in pack_result.stdout

    assert target_dir.exists()
    expected_files = {
        "TASK.md",
        "CONTEXT.md",
        "GUIDANCE.md",
        "SESSION_MEMORY.md",
        "POLICY.md",
        "MANIFEST.json",
        "opencode-session-config.json",
    }
    assert expected_files.issubset({path.name for path in target_dir.iterdir()})

    file_text = "\n".join((target_dir / name).read_text(encoding="utf-8") for name in sorted(expected_files))
    assert "instruction-pack-secret" not in file_text
    assert "token=abc123" not in file_text
    assert "raw_logs status=included" not in file_text
    assert "tool_or_mcp_schema status=included" not in file_text
    assert "full research.db dump" not in file_text
    assert "raw event log content" not in file_text

    manifest = json.loads((target_dir / "MANIFEST.json").read_text(encoding="utf-8"))
    assert manifest["session_id"] == session_id
    assert manifest["launch_ready"] is False
    assert manifest["generated_for_future_launch"] is True
    assert len(manifest["files"]) >= len(expected_files) - 1
    manifest_paths = {item["relative_path"] for item in manifest["files"]}
    assert expected_files - {"MANIFEST.json"} <= manifest_paths
    for item in manifest["files"]:
        file_path = target_dir / item["relative_path"]
        assert file_path.exists()
        content = file_path.read_text(encoding="utf-8")
        assert hashlib.sha256(content.encode("utf-8")).hexdigest() == item["sha256"]
        assert len(content.encode("utf-8")) == item["size_bytes"]

    config = json.loads((target_dir / "opencode-session-config.json").read_text(encoding="utf-8"))
    assert config["session_id"] == session_id
    assert config["launch_ready"] is False
    assert config["generated_for_future_launch"] is True
    assert "launch_command" not in config

    events_path = project / ".nxl" / "events.jsonl"
    events = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds = [event["kind"] for event in events]
    assert event_kinds.count("opencode_session_planned") == 1
    assert event_kinds.count("opencode_session_instruction_pack_written") == 1
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
    assert "instruction-pack-secret" not in serialized_events
    assert "token=abc123" not in serialized_events
