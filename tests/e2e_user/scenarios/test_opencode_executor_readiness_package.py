from __future__ import annotations

import json
import platform
import subprocess
from pathlib import Path

import pytest


@pytest.mark.phase_m4
def test_user_runs_packaged_opencode_executor_readiness(sandbox) -> None:
    platform_name = "windows" if platform.system().lower() == "windows" else platform.system().lower()
    executable_name = "opencode.exe" if platform_name == "windows" else "opencode"
    architecture = {"x86_64": "x64", "amd64": "x64", "aarch64": "arm64"}.get(
        platform.machine().lower(), platform.machine().lower()
    )
    executable = (
        sandbox.repo_root
        / "agentcore"
        / "upstream"
        / "packages"
        / "opencode"
        / "dist"
        / f"opencode-{platform_name}-{architecture}"
        / "bin"
        / executable_name
    )
    assert executable.is_file(), "build:nexusloop-readiness must produce the packaged OpenCode executable"

    project = sandbox.make_empty_project_dir("readiness-project")
    auth_dir = sandbox.root / "xdg_data" / "opencode"
    auth_dir.mkdir(parents=True)
    (auth_dir / "auth.json").write_text(
        json.dumps({"openai": {"type": "api", "key": "sk-e2e-readiness-secret"}}),
        encoding="utf-8",
    )
    request = {
        "request_version": "nexusloop_opencode_executor_readiness_request_v1",
        "selection_projection_hash": "d" * 64,
        "provider_id": "openai",
        "model_id": "gpt-5",
        "credential_binding_id": "executor-primary",
    }
    env = dict(sandbox.env)
    env["XDG_DATA_HOME"] = str(sandbox.root / "xdg_data")
    result = subprocess.run(
        [str(executable), "nexusloop", "executor-readiness-v1"],
        cwd=project,
        env=env,
        input=json.dumps(request),
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stderr == ""
    observation = json.loads(result.stdout)
    assert observation["provider_availability_status"] == "available"
    assert observation["credential_connection_status"] == "connected"
    assert observation["provider_id"] == "openai"
    assert observation["model_id"] == "gpt-5"
    assert "sk-e2e-readiness-secret" not in result.stdout
    assert "auth.json" not in result.stdout

    malformed = subprocess.run(
        [str(executable), "nexusloop", "executor-readiness-v1"],
        cwd=project,
        env=env,
        input='{\"provider_id\":\"openai\",\"provider_id\":\"anthropic\"}',
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )
    assert malformed.returncode == 2
    assert malformed.stdout == ""
    assert malformed.stderr == "NexusLoop Executor readiness observation failed\n"
    durable = "\n".join(
        path.read_text(encoding="utf-8", errors="replace")
        for path in sandbox.root.rglob("*")
        if path.is_file() and path != auth_dir / "auth.json"
    )
    assert "sk-e2e-readiness-secret" not in durable
