from __future__ import annotations

import hashlib
import json
import re

import pytest


@pytest.mark.phase_m4
def test_user_writes_bounded_opencode_context_refresh_without_delivery(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr
    for env in (sandbox.env, sandbox.runner.env):
        env["NXL_TUI_HEADLESS"] = "1"
        env["NXL_RUNTIME_CLIENT"] = "real"
        env["NXL_OPENCODE_ADAPTER"] = "fake"
        env["NXL_SECRET_CONTINUITY_REFRESH_TOKEN"] = "continuity-refresh-secret-abc123"

    project = sandbox.make_empty_project_dir("opencode_session_continuity_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(json.dumps({
        "spec_id": "spec_opencode_continuity_e2e", "version": 1, "status": "approved",
        "objective": "Exercise OpenCode session continuity refresh through the real runtime TUI",
        "project_mode": "build", "domain": "test", "success_metrics": ["refresh surface renders"],
        "evaluation_protocol": "run headless TUI", "approved_by": "e2e", "approved_at": "2026-07-11T00:00:00Z",
    }, indent=2), encoding="utf-8")

    def run(commands: list[str]) -> str:
        keys = [{"type": "submit"}]
        for command in commands:
            keys.extend([{"type": "insert", "text": command}, {"type": "submit"}])
        sandbox.env["NXL_TUI_KEYS"] = json.dumps(keys)
        sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(keys)
        result = sandbox.run_cli([], cwd=project)
        assert result.exit_code == 0, result.stdout + result.stderr
        return result.stdout

    plan = run(["/opencode-session-plan objective=continuity refresh test token=abc123", "/opencode-sessions"])
    session_match = re.search(r"latest=(opencode_session_[A-Za-z0-9._-]+)", plan)
    assert session_match, plan
    session_id = session_match.group(1)
    launch = run([
        f"/opencode-session-instruction-pack-write session={session_id}",
        f"/opencode-launch-readiness session={session_id}",
        f"/opencode-launch session={session_id}",
    ])
    assert "status=launched" in launch

    base_dir = project / ".nxl" / "opencode" / "sessions" / session_id
    base_names = ["TASK.md", "CONTEXT.md", "GUIDANCE.md", "SESSION_MEMORY.md", "POLICY.md", "MANIFEST.json", "opencode-session-config.json"]
    base_hashes = {name: hashlib.sha256((base_dir / name).read_bytes()).hexdigest() for name in base_names}

    evidence = run([
        f"/opencode-heartbeat session={session_id} summary=continuity heartbeat",
        f"/opencode-progress session={session_id} summary=working on continuity files=fileA.ts tests=bun-test",
        f"/opencode-question session={session_id} question=need continuity guidance",
        f"/opencode-ask-commander session={session_id} question=need continuity guidance",
        f"/opencode-human-correction session={session_id} correction=do not lose prior attempt",
        f"/opencode-continuity-preview session={session_id}",
        f"/opencode-context-refresh-preview session={session_id}",
        f"/opencode-context-refresh-dry-run session={session_id}",
    ])
    assert "OpenCode session continuity" in evidence
    assert "packet_kind=session_refresh" in evidence
    assert "context_strategy=immutable_base_plus_latest_snapshot_and_delta" in evidence
    assert "delta=initial_snapshot" in evidence
    assert "consumption_status=not_delivered" in evidence
    assert "opencode_prompt_sent=false" in evidence
    assert "native_session_action_performed=false" in evidence
    assert "process_control_performed=false" in evidence
    assert "CONTEXT_REFRESH.md" in evidence
    assert "DELTA.md" in evidence
    assert "REFRESH_MANIFEST.json" in evidence
    events_path = project / ".nxl" / "events.jsonl"
    events_after_dry = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert not [event for event in events_after_dry if event["kind"] == "opencode_session_context_refresh_written"]

    first = run([f"/opencode-context-refresh-write session={session_id}", f"/opencode-context-refreshes session={session_id}"])
    refresh_match = re.search(r"(?:latest_result|record)=(opencode_refresh_[A-Za-z0-9._-]+)", first)
    assert refresh_match, first
    refresh_id = refresh_match.group(1)
    assert "consumption_status=not_delivered" in first

    second_preview = run([
        f"/opencode-progress session={session_id} summary=second bounded continuity attempt files=fileB.ts tests=bun-test",
        f"/opencode-context-refresh-preview session={session_id} previous_refresh={refresh_id}",
        f"/opencode-context-refresh-write session={session_id} previous_refresh={refresh_id}",
    ])
    assert "delta=incremental" in second_preview
    second = run([
        f"/opencode-context-refreshes session={session_id}",
        f"/opencode-context-refresh-latest session={session_id}",
        "/opencode-context-refresh-summary",
    ])
    assert "not_delivered_count" in second or "not_delivered=2" in second
    authority = run(["/authority-show /opencode-context-refresh-write"])
    assert "selected=/opencode-context-refresh-write risk=medium_risk_write" in authority
    assert "continuity-refresh-secret" not in second
    assert "token=abc123" not in second

    assert {name: hashlib.sha256((base_dir / name).read_bytes()).hexdigest() for name in base_names} == base_hashes
    events = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    refresh_events = [event for event in events if event["kind"] == "opencode_session_context_refresh_written"]
    assert len(refresh_events) == 2, second_preview
    for event in refresh_events:
        assert event["consumption_status"] == "not_delivered"
        for key in ["delivery_performed", "opencode_prompt_sent", "native_session_action_performed", "process_control_performed", "session_state_mutated", "mission_mutated", "provider_called", "mcp_called", "research_db_written"]:
            assert event[key] is False
    forbidden = {"opencode_prompt_sent", "opencode_commander_guidance_delivered", "opencode_session_process_paused", "opencode_session_process_resumed", "opencode_session_process_killed", "opencode_session_process_stopped", "runtime_checkpoint_created", "followup_mission_created", "commander_proposal_created"}
    assert forbidden.isdisjoint({event["kind"] for event in events})
    serialized = json.dumps(refresh_events)
    assert "continuity-refresh-secret" not in serialized
    assert "token=abc123" not in serialized
