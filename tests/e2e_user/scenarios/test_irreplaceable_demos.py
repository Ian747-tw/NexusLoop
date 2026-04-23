from __future__ import annotations

import pytest


@pytest.mark.phase_m4
def test_irreplaceable_demo_status_flow(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr
    project = sandbox.init_project(mode="improve")

    status = sandbox.run_cli(["status", "--project-dir", str(project)], cwd=project)
    plan = sandbox.run_cli(["plan", "--project-dir", str(project)], cwd=project)

    assert status.exit_code == 0, status.stdout + status.stderr
    assert plan.exit_code == 0, plan.stdout + plan.stderr
    assert "Project Status" in status.stdout
    assert "Research Plan" in plan.stdout
