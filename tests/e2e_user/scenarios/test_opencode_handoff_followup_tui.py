from __future__ import annotations

import json

import pytest


@pytest.mark.phase_m4
def test_user_runs_opencode_handoff_followup_commands_through_tui(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    project = sandbox.make_empty_project_dir("opencode_handoff_followup_project")
    keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/handoff-followups"},
        {"type": "submit"},
        {"type": "insert", "text": "/handoff-followup-summary"},
        {"type": "submit"},
        {"type": "insert", "text": "/handoff-followup fake-handoff-2"},
        {"type": "submit"},
        {"type": "insert", "text": "/handoff-active"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "OpenCode follow-up" in result.stdout
    assert "summary sent=" in result.stdout
    assert "selected=fake-handoff" in result.stdout
    assert "queue=active" in result.stdout
    assert "mission=fake-mission" in result.stdout
    assert "sk-test-HANDOFFFOLLOWUPSECRET123" not in result.stdout
