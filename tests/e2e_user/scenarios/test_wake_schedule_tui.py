from __future__ import annotations

import json

import pytest


@pytest.mark.phase_m4
def test_user_runs_wake_schedule_commands_through_tui(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    project = sandbox.make_empty_project_dir("wake_schedule_project")
    keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/checkpoint full e2e schedule checkpoint secret-looking token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/resume-mark fake-checkpoint-1"},
        {"type": "submit"},
        {"type": "insert", "text": "/schedule-wake-preview resume=fake-resume-1 every=60s e2e schedule token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/schedule-wake resume=fake-resume-1 every=60s e2e schedule token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/wake-schedules"},
        {"type": "submit"},
        {"type": "insert", "text": "/wake-tick-preview"},
        {"type": "submit"},
        {"type": "insert", "text": "/wake-tick-dry-run"},
        {"type": "submit"},
        {"type": "insert", "text": "/wake-tick"},
        {"type": "submit"},
        {"type": "insert", "text": "/wake-ticks"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "Wake schedules" in result.stdout
    assert "preview_resume=fake-resume-1" in result.stdout
    assert "selected_schedule=fake-wake-schedule-1" in result.stdout
    assert "tick_preview due=1 eligible=1" in result.stdout
    assert "last_tick=fake-wake-tick-1" in result.stdout
    assert "recent_schedules" in result.stdout
    assert "recent_ticks" in result.stdout
    assert "token=abc123" not in result.stdout
    assert "secret-looking token=abc123" not in result.stdout
    assert "last_step=" not in result.stdout
    assert "proposal_applied" not in result.stdout
    assert "handoff_sent=true" not in result.stdout
    assert "opencode process" not in result.stdout.lower()
