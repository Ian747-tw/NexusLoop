from __future__ import annotations

import json
from pathlib import Path

import pytest


@pytest.mark.phase_m4
def test_operator_controls_commander_recovery_through_real_tui(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"

    project = sandbox.make_empty_project_dir("commander_recovery_operator_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_commander_recovery_operator_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise human-approved Commander recovery controls",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["recovery controls remain truthful"],
                "evaluation_protocol": "real headless OpenTUI commands",
                "approved_by": "e2e",
                "approved_at": "2026-08-04T00:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    fixture = Path(__file__).resolve().parents[1] / "recorded" / "commander_recovery_operator_events.jsonl"
    (project / ".nxl" / "events.jsonl").write_text(fixture.read_text(encoding="utf-8"), encoding="utf-8")

    keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/commander-recoveries"},
        {"type": "submit"},
        {"type": "insert", "text": "/commander-recovery-show commander_recovery_checkpoint_e2e"},
        {"type": "submit"},
        {"type": "insert", "text": "/commander-recovery-preview commander_recovery_checkpoint_e2e"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /commander-recovery-execute"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /commander-recovery-cancel"},
        {"type": "submit"},
    ]
    encoded_keys = json.dumps(keys)
    sandbox.env["NXL_TUI_KEYS"] = encoded_keys
    sandbox.runner.env["NXL_TUI_KEYS"] = encoded_keys

    result = sandbox.run_cli([], cwd=project)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "Commander recovery" in result.stdout
    assert "fresh recovery continuation" in result.stdout
    assert "exact replay unavailable" in result.stdout
    assert "provider outcome unknown" in result.stdout
    assert "/commander-recovery-approve" in result.stdout
    assert "/commander-recovery-execute" in result.stdout
    assert "/commander-recovery-cancel" in result.stdout
    assert "connector_url" not in result.stdout
    assert "authorization" not in result.stdout.lower()
    assert "chain of thought" not in result.stdout.lower()

