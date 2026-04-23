from __future__ import annotations

import pytest


@pytest.mark.phase_m0
def test_user_inits_empty_project_in_build_mode(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr
    project = sandbox.make_empty_project_dir()

    result = sandbox.run_cli(
        [
            "init",
            "--auto",
            "--project-mode",
            "build",
            "--skill-pack",
            "drl",
            "--plugin",
            "cc",
        ],
        cwd=project,
    )

    assert result.exit_code == 0, result.stdout + result.stderr
    sandbox.assert_file_exists(project / ".nxl" / "state.json")
    sandbox.assert_file_exists(project / ".nxl" / "spec_compact.md")
    sandbox.assert_file_exists(project / ".claude" / "commands" / "nxl-init.md")
