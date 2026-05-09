from __future__ import annotations

import pytest


@pytest.mark.phase_m3
def test_user_opens_tui_init_and_resume_states(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    project = sandbox.make_empty_project_dir("tui_project")

    init_result = sandbox.run_cli([], cwd=project)
    assert init_result.exit_code == 0, init_result.stdout + init_result.stderr
    assert "screen=init" in init_result.stdout
    assert "Project not initialized" in init_result.stdout
    assert "> Initialize" in init_result.stdout

    (project / ".nxl").mkdir()
    resume_result = sandbox.run_cli([], cwd=project)
    assert resume_result.exit_code == 0, resume_result.stdout + resume_result.stderr
    assert "screen=resume" in resume_result.stdout
    assert "> Resume previous run" in resume_result.stdout
