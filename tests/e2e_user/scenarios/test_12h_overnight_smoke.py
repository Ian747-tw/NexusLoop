from __future__ import annotations

import pytest


@pytest.mark.phase_m4
@pytest.mark.slow
def test_overnight_smoke_uses_short_ci_budget(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr
    project = sandbox.init_project(mode="improve")

    result = sandbox.run_cli(["run", "--once", "--dry-run"], cwd=project, timeout=600)

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "NexusLoop" in result.stdout or "dry" in result.stdout.lower()
