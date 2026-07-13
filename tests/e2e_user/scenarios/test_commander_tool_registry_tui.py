from __future__ import annotations

import json

import pytest


@pytest.mark.phase_m4
def test_user_inspects_commander_tool_registry_without_execution(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr
    for env in (sandbox.env, sandbox.runner.env):
        env["NXL_TUI_HEADLESS"] = "1"
        env["NXL_RUNTIME_CLIENT"] = "real"
        env["NXL_OPENCODE_ADAPTER"] = "fake"
        env["NXL_SECRET_COMMANDER_TOOL_TOKEN"] = "commander-tool-secret-abc123"

    project = sandbox.make_empty_project_dir("commander_tool_registry_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_commander_tool_registry_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise Commander tool registry through the real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["Commander tool registry renders"],
                "evaluation_protocol": "run headless TUI",
                "approved_by": "e2e",
                "approved_at": "2026-07-13T00:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    def run(commands: list[str]) -> str:
        keys = [{"type": "submit"}]
        for command in commands:
            keys.extend([{"type": "insert", "text": command}, {"type": "submit"}])
        sandbox.env["NXL_TUI_KEYS"] = json.dumps(keys)
        sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(keys)
        result = sandbox.run_cli([], cwd=project)
        assert result.exit_code == 0, result.stdout + result.stderr
        return result.stdout

    run(["/runtime-status"])
    events_path = project / ".nxl" / "events.jsonl"
    events_before = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]

    stdout = run(
        [
            "/commander-tool-registry-validate",
            "/commander-tool-summary",
            "/commander-tool-bootstrap phase=proposal_investigation provider=local model=local-medium",
            "/commander-tool-search query=research memory phase=proposal_investigation",
            "/commander-tool-show memory.search",
            "/commander-tool-profile phase=mid_mission_supervision",
            "/authority-show /commander-tool-search",
        ]
    )
    repo_stdout = run(["/commander-tools namespace=repo_read"])
    github_stdout = run(["/commander-tools namespace=github_read"])
    governance_stdout = run(["/commander-tools namespace=governance"])
    combined_stdout = "\n".join([stdout, repo_stdout, github_stdout, governance_stdout])

    assert "Commander tools" in stdout
    assert "validation status=ready" in stdout
    assert "execution_enabled=false" in stdout
    assert "always_loaded=" in stdout
    assert "deferred_namespaces=" in stdout
    assert "memory.search" in stdout
    assert "availability=implemented_read_surface" in stdout
    assert "repo.tree" in repo_stdout
    assert "availability=future_internal_read" in repo_stdout
    assert "github.pr_read" in github_stdout
    assert "availability=future_external_read" in github_stdout
    assert "governance.stage_pr_merge" in governance_stdout
    assert "availability=future_governance_intent" in governance_stdout
    assert "schema_loaded=false" in stdout
    assert "selected=memory.search" in stdout
    assert "schema_loaded=true" in stdout
    assert "schema_tokens=" in stdout
    assert "selected=/commander-tool-search risk=safe_read" in stdout
    assert "no tool execution" in stdout
    assert "provider/MCP/network call" in stdout
    assert "proposal/mission mutation" in stdout
    assert "OpenCode action" in stdout

    forbidden_fragments = [
        "github.merge",
        "github.approve",
        "repo.shell",
        "repo.edit",
        "repo.patch",
        "repo.commit",
        "repo.push",
        "commander-tool-secret",
        "commander-tool-secret-abc123",
    ]
    for fragment in forbidden_fragments:
        assert fragment not in combined_stdout

    events_after = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    new_events = events_after[len(events_before) :]
    metadata_events = [event for event in new_events if event["kind"] not in {"runtime_started", "runtime_ready", "runtime_shutdown"}]
    assert metadata_events == []
    assert not {
        "commander_proposal_created",
        "commander_proposal_applied",
        "research_memory_ingestion_recorded",
        "opencode_session_launch_started",
        "opencode_prompt_sent",
        "mission_created",
        "mission_completed",
        "mission_failed",
    } & {event["kind"] for event in new_events}
