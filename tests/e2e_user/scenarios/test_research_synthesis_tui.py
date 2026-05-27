from __future__ import annotations

import json

import pytest


@pytest.mark.phase_m4
def test_user_runs_research_synthesis_commands_through_tui(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    project = sandbox.make_empty_project_dir("research_synthesis_project")
    keys = [
        {"type": "submit"},
        {
            "type": "insert",
            "text": "/synthesize-preview fake-topic-1 summarize evidence with sk-test-SYNTHSECRET123",
        },
        {"type": "submit"},
        {"type": "insert", "text": "/synthesize-proposals fake-topic-1 draft operator checkpoint"},
        {"type": "submit"},
        {"type": "insert", "text": "/syntheses"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "Research synthesis" in result.stdout
    assert "preview_topic=fake-topic-1" in result.stdout
    assert "selected_synthesis=fake-synthesis" in result.stdout
    assert "proposals=fake-proposal" in result.stdout
    assert "syntheses=1" in result.stdout
    assert "sk-test-SYNTHSECRET123" not in result.stdout
    assert "[REDACTED]" in result.stdout
