from __future__ import annotations

import json
import subprocess

import pytest


@pytest.mark.phase_m4
def test_user_runs_commander_internal_read_tools_without_mutation(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr
    for env in (sandbox.env, sandbox.runner.env):
        env["NXL_TUI_HEADLESS"] = "1"
        env["NXL_RUNTIME_CLIENT"] = "real"
        env["NXL_OPENCODE_ADAPTER"] = "fake"
        env["NXL_SECRET_INTERNAL_READ_TOKEN"] = "internal-read-secret-abc123"

    project = sandbox.make_empty_project_dir("commander_internal_reads_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_commander_internal_reads_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise Commander internal reads through the real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["Commander internal reads render"],
                "evaluation_protocol": "run headless TUI",
                "approved_by": "e2e",
                "approved_at": "2026-07-13T00:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    source_dir = project / "agentcore" / "runtime" / "src" / "commander-tools"
    source_dir.mkdir(parents=True)
    (source_dir / "commander-tool-service.ts").write_text(
        "\n".join(
            [
                "export class CommanderToolService {",
                "  search() { return 'bounded evidence'; }",
                "}",
                "export function CommanderToolServiceHelper() { return true }",
                "const api_key = 'internal-read-secret-abc123'",
            ]
        ),
        encoding="utf-8",
    )
    (project / "package.json").write_text(
        json.dumps({"scripts": {"test": "bun test", "typecheck": "tsc --noEmit"}, "dependencies": {"zod": "^3.0.0"}, "devDependencies": {"typescript": "^5.0.0"}}, indent=2),
        encoding="utf-8",
    )
    (project / "pyproject.toml").write_text("[tool.pytest.ini_options]\ntestpaths = ['tests']\n[project]\ndependencies = ['click>=8']\n", encoding="utf-8")
    (project / ".env").write_text("TOKEN=internal-read-secret-abc123\n", encoding="utf-8")

    subprocess.run(["git", "init"], cwd=project, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    subprocess.run(["git", "config", "user.email", "e2e@example.com"], cwd=project, check=True)
    subprocess.run(["git", "config", "user.name", "E2E"], cwd=project, check=True)
    subprocess.run(["git", "add", "agentcore/runtime/src/commander-tools/commander-tool-service.ts", "package.json", "pyproject.toml"], cwd=project, check=True)
    subprocess.run(["git", "commit", "-m", "initial internal read fixture"], cwd=project, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    with (source_dir / "commander-tool-service.ts").open("a", encoding="utf-8") as handle:
        handle.write("\nexport const changedFixture = 'working tree change'\n")

    def run(commands: list[str]) -> str:
        keys = [{"type": "submit"}]
        for command in commands:
            keys.extend([{"type": "insert", "text": command}, {"type": "submit"}])
        sandbox.env["NXL_TUI_KEYS"] = json.dumps(keys)
        sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(keys)
        result = sandbox.run_cli([], cwd=project)
        assert result.exit_code == 0, result.stdout + result.stderr
        return result.stdout

    setup = run(
        [
            "/opencode-session-plan objective=prior continuity decision",
            "/opencode-sessions",
        ]
    )
    assert "latest=opencode_session_" in setup
    session_id = setup.split("latest=", 1)[1].split()[0]
    run(
        [
            f"/opencode-session-instruction-pack-write session={session_id}",
            f"/opencode-launch-readiness session={session_id}",
            f"/opencode-launch session={session_id}",
            f"/opencode-progress session={session_id} summary=prior continuity decision files=agentcore/runtime/src/commander-tools/commander-tool-service.ts tests=bun-test",
        ]
    )

    run(["/runtime-status"])
    events_path = project / ".nxl" / "events.jsonl"
    events_before = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]

    stdout = run(
        [
            "/commander-tool-registry-validate",
            "/commander-tools namespace=repo_read phase=proposal_investigation",
            "/commander-continuity-search query=prior continuity decision",
            "/commander-repo-tree path=agentcore/runtime/src/commander-tools depth=2",
            "/commander-repo-search query=CommanderToolService path=agentcore/runtime/src",
            "/commander-repo-read path=agentcore/runtime/src/commander-tools/commander-tool-service.ts start=1 end=40",
            "/commander-repo-symbol symbol=CommanderToolService path=agentcore/runtime/src",
            "/commander-git-status",
            "/commander-git-diff scope=working_tree stat_only=true",
            "/commander-git-log limit=3",
            "/commander-test-manifest",
            "/commander-dependency-manifest",
            "/commander-tool-show repo.search_text",
        ]
    )
    authority_search_stdout = run(["/authority-show /commander-repo-search"])
    authority_git_stdout = run(["/authority-show /commander-git-diff"])

    assert "Commander internal reads" in stdout
    assert "repo.search_text" in stdout
    assert "continuity.search" in stdout
    assert "availability=implemented_read_surface" in stdout
    assert "trust_class=repository_content_untrusted" in stdout
    assert "trust_class=runtime_authoritative" in stdout
    assert "instruction_semantics=none" in stdout
    assert "agentcore/runtime/src/commander-tools/commander-tool-service.ts" in stdout
    assert "line=1:" in stdout
    assert "evidence=" in stdout
    assert "git_process_invoked=true" in stdout
    assert "filesystem_written=false" in stdout
    assert "events_appended=false" in stdout
    assert "network_called=false" in stdout
    assert "provider_called=false" in stdout
    assert "mcp_called=false" in stdout
    assert "research_db_written=false" in stdout
    assert "mission_mutated=false" in stdout
    assert "opencode_action_performed=false" in stdout
    assert "shell_used=false" in stdout
    assert "selected=/commander-repo-search risk=safe_read" in authority_search_stdout
    assert "selected=/commander-git-diff risk=safe_read" in authority_git_stdout
    assert "api_key" not in stdout
    assert "internal-read-secret" not in stdout
    assert "events.jsonl" not in stdout
    assert "package-lock" not in stdout
    assert "github.merge" not in stdout

    events_after = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    new_events = events_after[len(events_before) :]
    metadata_events = [event for event in new_events if event["kind"] not in {"runtime_started", "runtime_ready", "runtime_shutdown"}]
    assert metadata_events == []
    forbidden = {
        "commander_proposal_created",
        "commander_proposal_applied",
        "research_memory_ingestion_recorded",
        "opencode_session_launch_started",
        "opencode_prompt_sent",
        "mission_created",
        "mission_completed",
        "mission_failed",
    }
    assert forbidden.isdisjoint({event["kind"] for event in new_events})
