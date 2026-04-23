from __future__ import annotations

import pytest


@pytest.mark.phase_m2
def test_user_can_install_package_through_documented_cli_surface(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    result = sandbox.run_cli(["install"])

    assert result.exit_code == 0, result.stdout + result.stderr
    assert "installed" in result.stdout.lower()
    assert "nxl init" in result.stdout
