from __future__ import annotations

import json

import pytest


@pytest.mark.phase_m4
def test_user_inspects_wake_scheduler_bootstrap_through_tui(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    project = sandbox.make_empty_project_dir("wake_scheduler_bootstrap_project")
    keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-bootstrap"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-bootstrap-preview"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-status"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.env["NXL_SECRET_BOOTSTRAP_TOKEN"] = "bootstrap-secret-abc123"
    sandbox.runner.env["NXL_SECRET_BOOTSTRAP_TOKEN"] = "bootstrap-secret-abc123"

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "Wake scheduler" in result.stdout
    assert "bootstrap autostart=disabled" in result.stdout
    assert "configured=false" in result.stdout
    assert "wake scheduler autostart disabled" in result.stdout
    assert "status=stopped" in result.stdout
    assert "runtime_wake_scheduler_started" not in result.stdout
    assert "runtime_wake_scheduler_tick_succeeded" not in result.stdout
    assert "last_step=" not in result.stdout
    assert "handoff_sent=true" not in result.stdout
    assert "opencode process" not in result.stdout.lower()
    assert "bootstrap-secret-abc123" not in result.stdout
