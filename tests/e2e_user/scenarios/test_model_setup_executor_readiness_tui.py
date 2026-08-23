from __future__ import annotations

import json
import re
import shutil
import time
from pathlib import Path

import pytest


@pytest.mark.phase_m4
def test_first_run_model_setup_activates_exact_executor_through_production_observer(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    project = sandbox.make_empty_project_dir("model_setup_executor_readiness_project")
    secret = "executor-observer-secret-never-published"
    bun = shutil.which("bun")
    assert bun is not None
    sandbox.env.update({"NXL_TUI_HEADLESS": "1", "NXL_RUNTIME_CLIENT": "real"})
    sandbox.runner.env.update({"NXL_TUI_HEADLESS": "1", "NXL_RUNTIME_CLIENT": "real"})

    def run_tui(keys: list[dict[str, str]], *, timeout: int = 300):
        encoded = json.dumps(keys)
        sandbox.env["NXL_TUI_KEYS"] = encoded
        sandbox.runner.env["NXL_TUI_KEYS"] = encoded
        result = sandbox.run_cli([], cwd=project, timeout=timeout)
        assert result.exit_code == 0, result.stdout + result.stderr
        return result

    setup = run_tui([
        {"type": "submit"},
        {"type": "select-next"},
        {"type": "submit"},
        {"type": "select-next"},
        {"type": "submit"},
        {"type": "submit"},
        {"type": "submit"},
    ])
    assert "stage=committed" in setup.stdout
    assert "pending_restart=true" in setup.stdout
    assert "Anthropic Claude Sonnet 4.5" in setup.stdout

    initialized = sandbox.run_cli(
        ["init", "--auto", "--project-mode", "build", "--skill-pack", "drl", "--plugin", "none"],
        cwd=project,
        timeout=300,
    )
    assert initialized.exit_code == 0, initialized.stdout + initialized.stderr
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True, exist_ok=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_model_setup_executor_readiness_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Verify first-run model setup and exact Executor launch authority",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["one exact primary Executor model reaches launch"],
                "evaluation_protocol": "real headless OpenTUI setup and launch flow",
                "approved_by": "e2e",
                "approved_at": "2026-08-22T00:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    models_path = sandbox.root / "opencode-models.json"
    models = {
        "anthropic": {
            "id": "anthropic",
            "name": "Anthropic",
            "env": ["ANTHROPIC_API_KEY"],
            "models": {
                "claude-sonnet-4-5-20250929": {
                    "id": "claude-sonnet-4-5-20250929",
                    "name": "Claude Sonnet 4.5",
                }
            },
        }
    }
    models_path.write_text(json.dumps(models), encoding="utf-8")
    auth_content = json.dumps({"anthropic": {"type": "api", "key": secret}})
    capture = sandbox.root / "opencode-launch-args.json"
    opencode = sandbox.root / "opencode-fixture.ts"
    opencode.write_text(
        """
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args.includes("--model")) {
  writeFileSync(process.env.NXL_E2E_LAUNCH_CAPTURE, JSON.stringify(args));
  process.exit(0);
}
for await (const _chunk of Bun.stdin.stream()) {}
""",
        encoding="utf-8",
    )

    configured = {
        "NXL_TUI_HEADLESS": "1",
        "NXL_RUNTIME_CLIENT": "real",
        "NXL_OPENCODE_ADAPTER": "process",
        "NXL_OPENCODE_COMMAND": bun,
        "NXL_OPENCODE_ARGS_JSON": json.dumps([str(opencode), "--stdio"]),
        "HOME": str(sandbox.root / "opencode-home"),
        "XDG_CONFIG_HOME": str(sandbox.root / "opencode-config"),
        "XDG_DATA_HOME": str(sandbox.root / "opencode-data"),
        "OPENCODE_MODELS_PATH": str(models_path),
        "OPENCODE_AUTH_CONTENT": auth_content,
        "NXL_REAL_OPENCODE_LAUNCH": "1",
        "NXL_E2E_LAUNCH_CAPTURE": str(capture),
    }
    sandbox.env.update(configured)
    sandbox.runner.env.update(configured)

    def command_keys(commands: list[str]) -> list[dict[str, str]]:
        keys: list[dict[str, str]] = [{"type": "submit"}]
        for command in commands:
            keys.extend([{"type": "insert", "text": command}, {"type": "submit"}])
        return keys

    planned = run_tui(command_keys([
        "/opencode-session-plan objective=verify exact persisted model setup",
        "/opencode-sessions",
    ]))
    session_match = re.search(r"latest=(opencode_session_[A-Za-z0-9._-]+)", planned.stdout)
    assert session_match, planned.stdout
    session_id = session_match.group(1)

    packed = run_tui(command_keys([
        f"/opencode-session-instruction-pack-write session={session_id}",
        "/opencode-session-instruction-packs",
    ]))
    pack_match = re.search(r"latest=(opencode_instruction_pack_[A-Za-z0-9._-]+)", packed.stdout)
    if not pack_match:
        pack_match = re.search(r"- (opencode_instruction_pack_[A-Za-z0-9._-]+) status=written", packed.stdout)
    assert pack_match, packed.stdout
    pack_id = pack_match.group(1)

    sandbox.env.pop("OPENCODE_AUTH_CONTENT")
    sandbox.runner.env.pop("OPENCODE_AUTH_CONTENT")
    disconnected = run_tui(command_keys([
        f"/opencode-launch-preview session={session_id} pack={pack_id}",
        "/model-setup",
    ]))
    assert "commander=Anthropic Claude Sonnet 4.5" in disconnected.stdout
    assert "executor=Anthropic Claude Sonnet 4.5" in disconnected.stdout
    assert "pending_restart=false" in disconnected.stdout
    assert "credential disconnected" in disconnected.stdout
    assert "lifecycle unknown" in disconnected.stdout
    assert not capture.exists()

    models_path.write_text("{", encoding="utf-8")
    malformed = run_tui(command_keys([f"/opencode-launch-preview session={session_id} pack={pack_id}"]))
    assert "Executor role readiness is not ready for the selected model profile" in malformed.stdout
    assert not capture.exists()

    models_path.write_text(json.dumps(models), encoding="utf-8")
    sandbox.env["OPENCODE_AUTH_CONTENT"] = auth_content
    sandbox.runner.env["OPENCODE_AUTH_CONTENT"] = auth_content
    conflicting_args = json.dumps([str(opencode), "--stdio", "--model=wrong/provider"])
    sandbox.env["NXL_OPENCODE_ARGS_JSON"] = conflicting_args
    sandbox.runner.env["NXL_OPENCODE_ARGS_JSON"] = conflicting_args
    conflicting = run_tui(command_keys([f"/opencode-launch-preview session={session_id} pack={pack_id}"]))
    assert "preconfigured OpenCode primary model conflicts with runtime model-profile authority" in conflicting.stdout
    assert not capture.exists()

    exact_args = json.dumps([str(opencode), "--stdio"])
    sandbox.env["NXL_OPENCODE_ARGS_JSON"] = exact_args
    sandbox.runner.env["NXL_OPENCODE_ARGS_JSON"] = exact_args
    launched = run_tui([
        {"type": "submit"},
        {"type": "insert", "text": "start runtime for exact model launch verification"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-launch-readiness session={session_id} pack={pack_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-launch session={session_id} pack={pack_id}"},
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-launches"},
        {"type": "submit"},
    ])
    deadline = time.monotonic() + 2
    while not capture.exists() and time.monotonic() < deadline:
        time.sleep(0.02)
    assert capture.exists(), launched.stdout
    args = json.loads(capture.read_text(encoding="utf-8"))
    assert args.count("--model") == 1
    model_index = args.index("--model")
    assert args[model_index + 1] == "anthropic/claude-sonnet-4-5-20250929"
    assert not any(value.startswith("--model=") or value.startswith("-m") for value in args)
    assert not any(name in " ".join(args) for name in ["small_model", "title", "summary", "compaction", "subagent"])

    events_text = (project / ".nxl" / "events.jsonl").read_text(encoding="utf-8")
    durable = setup.stdout + initialized.stdout + planned.stdout + packed.stdout + disconnected.stdout + malformed.stdout + launched.stdout + events_text
    for forbidden in [
        secret,
        "NXL_E2E_LAUNCH_CAPTURE",
        "OPENCODE_AUTH_CONTENT",
        "OPENCODE_MODELS_PATH",
        "authorization",
        "api-key",
        "auth.json",
    ]:
        assert forbidden not in durable
    events = [json.loads(line) for line in events_text.splitlines() if line.strip()]
    assert sum(event.get("kind") == "runtime_model_setup_committed" for event in events) == 1
    assert sum(event.get("kind") == "opencode_session_launch_started" for event in events) == 1
    assert sum(event.get("kind") == "opencode_session_launch_succeeded" for event in events) == 1
    assert events[-1]["kind"] == "runtime_shutdown"
