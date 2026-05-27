from __future__ import annotations

import json

import pytest


@pytest.mark.phase_m4
def test_user_runs_commander_cycle_commands_through_tui(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    project = sandbox.make_empty_project_dir("commander_cycle_project")
    keys = [
        {"type": "submit"},
        {
            "type": "insert",
            "text": "/cycle-preview topic=fake-topic-1 inspect evidence with sk-test-CYCLESECRET123",
        },
        {"type": "submit"},
        {"type": "insert", "text": "/cycle-proposals topic=fake-topic-1 draft operator checkpoint"},
        {"type": "submit"},
        {"type": "insert", "text": "/cycles"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "Commander cycle" in result.stdout
    assert "preview_topic=fake-topic-1" in result.stdout
    assert "selected_cycle=fake-cycle" in result.stdout
    assert "proposals=fake-proposal" in result.stdout
    assert "cycles=1" in result.stdout
    assert "sk-test-CYCLESECRET123" not in result.stdout
    assert "[REDACTED]" in result.stdout
