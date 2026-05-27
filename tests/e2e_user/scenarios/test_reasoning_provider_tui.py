from __future__ import annotations

import json

import pytest


@pytest.mark.phase_m4
def test_user_runs_reasoning_provider_commands_through_tui(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_MINIMAX_API_KEY"] = "sk-test-REASONINGSECRET123"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_MINIMAX_API_KEY"] = "sk-test-REASONINGSECRET123"
    project = sandbox.make_empty_project_dir("reasoning_provider_project")
    keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/reasoning"},
        {"type": "submit"},
        {"type": "insert", "text": "/reasoning-smoke-preview research"},
        {"type": "submit"},
        {"type": "insert", "text": "/reasoning-smoke-dry-run cycle"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "Reasoning provider" in result.stdout
    assert "provider=fake:fake-reasoning" in result.stdout
    assert "health=ok" in result.stdout
    assert "smoke_preview=research_synthesis network=no" in result.stdout
    assert "smoke_result=commander_cycle ok dry_run=true parsed=false" in result.stdout
    assert "sk-test-REASONINGSECRET123" not in result.stdout
