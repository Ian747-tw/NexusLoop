from __future__ import annotations

import json

import pytest


@pytest.mark.phase_m4
def test_user_runs_wake_scheduler_commands_through_tui(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    project = sandbox.make_empty_project_dir("wake_scheduler_project")
    keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/checkpoint full e2e scheduler checkpoint secret-looking token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/resume-mark fake-checkpoint-1"},
        {"type": "submit"},
        {"type": "insert", "text": "/schedule-wake resume=fake-resume-1 every=60s e2e scheduler token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-preview dry-run every=60s"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-start dry-run every=60s"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-status"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-events"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-stop e2e stop reason token=abc123"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "Wake scheduler" in result.stdout
    assert "preview can_start=true" in result.stdout
    assert "status=stopped" in result.stdout
    assert "runtime_wake_scheduler_started" in result.stdout
    assert "runtime_wake_scheduler_stopped" in result.stdout
    assert "token=abc123" not in result.stdout
    assert "secret-looking token=abc123" not in result.stdout
    assert "last_step=" not in result.stdout
    assert "proposal_applied" not in result.stdout
    assert "handoff_sent=true" not in result.stdout
    assert "opencode process" not in result.stdout.lower()
