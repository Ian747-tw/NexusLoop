from __future__ import annotations

import pytest


@pytest.mark.phase_m1
def test_user_can_resume_after_session_death(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr
    project = sandbox.init_project(mode="improve")

    before = sandbox.run_cli(["status"], cwd=project)
    assert before.exit_code == 0, before.stdout + before.stderr

    result = sandbox.run_cli(["resume", "--project-dir", str(project), "--no-run"], cwd=project)
    assert result.exit_code == 0, result.stdout + result.stderr
    assert "resume" in result.stdout.lower() or "checkpoint" in result.stdout.lower()
