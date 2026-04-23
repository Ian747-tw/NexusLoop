from __future__ import annotations

import pytest


@pytest.mark.phase_m_minus_1
def test_user_can_install_and_see_help(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    result = sandbox.run_cli(["--help"], transcript_name="first_install_help")
    assert result.exit_code == 0
    assert "nxl" in result.stdout
    assert "init" in result.stdout
    assert "run" in result.stdout


@pytest.mark.phase_m_minus_1
def test_user_sees_version(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    result = sandbox.run_cli(["--version"], transcript_name="first_install_version")
    assert result.exit_code == 0
    assert result.stdout.strip().startswith("nxl ")
