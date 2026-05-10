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
        {"type": "insert", "text": "approve spec"},
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

    current_json = project / ".nxl" / "spec" / "current.json"
    current_md = project / ".nxl" / "spec" / "current.md"
    events_jsonl = project / ".nxl" / "events.jsonl"
    assert current_json.exists()
    assert current_md.exists()
    assert events_jsonl.exists()

    current = json.loads(current_json.read_text(encoding="utf-8"))
    assert current["status"] == "approved"
    assert (project / ".nxl" / "spec" / "versions" / f"{current['spec_id']}.json").exists()

    event_kinds = [
        json.loads(line)["kind"]
        for line in events_jsonl.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert "user_plain_spec_received" in event_kinds
    assert "spec_draft_created" in event_kinds
    assert "spec_approval_requested" in event_kinds
    assert "spec_approved" in event_kinds

    persisted_text = "\n".join(
        path.read_text(encoding="utf-8")
        for path in [
            current_json,
            current_md,
            events_jsonl,
            project / ".nxl" / "spec" / "versions" / f"{current['spec_id']}.json",
        ]
    )
    assert "sk-test-SECRET123" not in persisted_text
