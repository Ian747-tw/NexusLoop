from __future__ import annotations

import json

import pytest


@pytest.mark.phase_m4
def test_user_enters_plain_spec_through_tui_message_box_without_secret_leak(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    project = sandbox.make_empty_project_dir("spec_onboarding_project")
    keys = [
        {"type": "submit"},
        {"type": "insert", "text": "Build CartPole with provider key sk-test-SECRET123"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(keys)

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "Onboarding" in result.stdout
    assert "Message box" in result.stdout
    assert "sk-test-SECRET123" not in result.stdout
    assert "[REDACTED]" in result.stdout
