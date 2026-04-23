from __future__ import annotations

import pytest


@pytest.mark.phase_m3
def test_dashboard_serves_locally(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr
    project = sandbox.init_project(mode="improve")

    with sandbox.run_cli_background(
        ["dashboard", "--project-dir", str(project), "--port", "18765"],
        cwd=project,
    ):
        sandbox.wait_for_port(18765, timeout=30)
        response = sandbox.http_get("http://127.0.0.1:18765/")

    assert response.status_code == 200
    assert "Live" in response.text
    assert "Leaderboard" in response.text
    assert "Lineage" in response.text
