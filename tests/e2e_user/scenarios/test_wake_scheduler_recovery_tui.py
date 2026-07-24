from __future__ import annotations

import json
from hashlib import sha256

import pytest

from tests.e2e_user.snapshot_assertions import assert_opencode_process_smoke_idle


@pytest.mark.phase_m4
def test_user_inspects_wake_scheduler_recovery_through_tui(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"
    project = sandbox.make_empty_project_dir("wake_scheduler_recovery_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_wake_scheduler_recovery_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise scheduler recovery through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["scheduler recovery renders"],
                "evaluation_protocol": "run headless TUI",
                "approved_by": "e2e",
                "approved_at": "2026-05-10T00:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    prior_event_id = "e2e_stale_scheduler_start"
    prior_started_at = "2026-05-11T15:00:00.000Z"
    prior_tick_id = "e2e_stale_tick"
    recovery_id = "wake_scheduler_recovery_" + sha256(
        "\n".join([prior_event_id, prior_started_at, prior_tick_id]).encode("utf-8")
    ).hexdigest()[:16]
    events_path = project / ".nxl" / "events.jsonl"
    with events_path.open("a", encoding="utf-8") as handle:
        handle.write(
            json.dumps(
                {
                    "kind": "runtime_wake_scheduler_started",
                    "event_id": prior_event_id,
                    "created_at": prior_started_at,
                    "scheduler_status": "running",
                    "tick_id": prior_tick_id,
                    "requested_by": "e2e token=recovery-secret",
                },
                separators=(",", ":"),
            )
            + "\n"
        )
    keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-recovery"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-recovery-preview"},
        {"type": "submit"},
        {"type": "insert", "text": "/scheduler-recoveries"},
        {"type": "submit"},
        {"type": "insert", "text": f"/scheduler-recovery-ack {recovery_id} token=recovery-secret"},
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
    assert f"recovery_id={recovery_id}" in result.stdout
    assert "status=acknowledged" in result.stdout
    assert "recent_recoveries" in result.stdout
    assert "runtime_wake_scheduler_tick_succeeded" not in result.stdout
    assert "last_step=" not in result.stdout
    assert "handoff_sent=true" not in result.stdout
    assert_opencode_process_smoke_idle(result.stdout)
    assert "recovery-secret" not in result.stdout
    assert "recovery-secret-abc123" not in result.stdout
