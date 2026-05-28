from __future__ import annotations

import json

import pytest


@pytest.mark.phase_m4
def test_user_runs_runtime_checkpoint_commands_through_tui(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    project = sandbox.make_empty_project_dir("runtime_checkpoint_project")
    keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/checkpoint-preview"},
        {"type": "submit"},
        {"type": "insert", "text": "/checkpoint full e2e checkpoint secret-looking token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/checkpoints"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "Runtime checkpoints" in result.stdout
    assert "preview_scope=full" in result.stdout
    assert "selected_checkpoint=fake-checkpoint" in result.stdout
    assert "recent_checkpoints" in result.stdout
    assert "restore_supported=false" in result.stdout
    assert "token=abc123" not in result.stdout
    assert "secret-looking token=abc123" not in result.stdout

