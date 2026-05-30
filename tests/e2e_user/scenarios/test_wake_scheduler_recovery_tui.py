from __future__ import annotations

import json

import pytest


@pytest.mark.phase_m4
def test_user_inspects_wake_scheduler_recovery_through_tui(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_TUI_FAKE_WAKE_SCHEDULER_STALE"] = "1"
    sandbox.runner.env["NXL_TUI_FAKE_WAKE_SCHEDULER_STALE"] = "1"
    project = sandbox.make_empty_project_dir("wake_scheduler_recovery_project")
    keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-recovery"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-recovery-preview"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-recoveries"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-recovery-ack fake-recovery-1 token=recovery-secret"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-recoveries"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.env["NXL_SECRET_RECOVERY_TOKEN"] = "recovery-secret-abc123"
    sandbox.runner.env["NXL_SECRET_RECOVERY_TOKEN"] = "recovery-secret-abc123"

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "Wake scheduler" in result.stdout
    assert "recovery" in result.stdout
    assert "stale_detected=true" in result.stdout
    assert "recovery_id=fake-recovery-1" in result.stdout
    assert "status=acknowledged" in result.stdout
    assert "recent_recoveries" in result.stdout
    assert "runtime_wake_scheduler_tick_succeeded" not in result.stdout
    assert "last_step=" not in result.stdout
    assert "handoff_sent=true" not in result.stdout
    assert "opencode process" not in result.stdout.lower()
    assert "recovery-secret" not in result.stdout
    assert "recovery-secret-abc123" not in result.stdout
