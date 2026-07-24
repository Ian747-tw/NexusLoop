from __future__ import annotations

import json

import pytest

from tests.e2e_user.snapshot_assertions import assert_opencode_process_smoke_idle


@pytest.mark.phase_m4
def test_user_runs_continuation_commands_through_tui(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    project = sandbox.make_empty_project_dir("continuation_project")
    keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/checkpoint full e2e continuation checkpoint secret-looking token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/resume-mark fake-checkpoint-1"},
        {"type": "submit"},
        {"type": "insert", "text": "/wake resume=fake-resume-1"},
        {"type": "submit"},
        {"type": "insert", "text": "/continue-preview wake=fake-wake-1"},
        {"type": "submit"},
        {"type": "insert", "text": "/continue-plan wake=fake-wake-1"},
        {"type": "submit"},
        {"type": "insert", "text": "/continue-dry-run fake-continuation-1"},
        {"type": "submit"},
        {"type": "insert", "text": "/continue-step fake-continuation-1"},
        {"type": "submit"},
        {"type": "insert", "text": "/continuations"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "screen=main" in result.stdout
    assert "Continuation" in result.stdout
    assert "preview_wake=fake-wake-1" in result.stdout
    assert "selected_plan=fake-continuation-1" in result.stdout
    assert "last_step=fake-continuation-step-1-1" in result.stdout
    assert "recent_plans" in result.stdout
    assert "token=abc123" not in result.stdout
    assert "secret-looking token=abc123" not in result.stdout
    assert "proposal_applied" not in result.stdout
    assert "handoff_sent=true" not in result.stdout
    assert_opencode_process_smoke_idle(result.stdout)
