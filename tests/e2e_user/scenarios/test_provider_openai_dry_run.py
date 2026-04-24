"""test_provider_openai_dry_run.py — E2E smoke: openai provider dry-run."""
from __future__ import annotations

import pytest


@pytest.mark.phase_m2
def test_provider_openai_dry_run(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr
    project = sandbox.init_project(mode="improve")

    result = sandbox.run_cli(
        ["run", "--once", "--provider", "openai", "--dry-run"],
        cwd=project,
        timeout=300,
    )
    assert result.exit_code == 0, result.stdout + result.stderr
    events = sandbox.list_events(project)
    assert any(e.get("kind") == "cycle_started" for e in events), \
        "Expected cycle_started event in events.jsonl"