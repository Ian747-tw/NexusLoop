from __future__ import annotations

import pytest


@pytest.mark.phase_m1
def test_user_can_run_once_dry_run(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr
    project = sandbox.init_project(mode="improve")

    result = sandbox.run_cli(["run", "--once", "--dry-run"], cwd=project, timeout=600)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "dry" in result.stdout.lower() or "would" in result.stdout.lower()
