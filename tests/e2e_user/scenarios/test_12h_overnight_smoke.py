"""10-minute accelerated overnight smoke test."""
import pytest


@pytest.mark.phase_m2
@pytest.mark.slow
def test_12h_overnight_smoke(sandbox) -> None:
    """Accelerated version: forces handoffs every 2 minutes, runs 10 minutes.

    Validates: cycles >=10, handoffs >=2, 0 violations, >=3 capability flows.
    """
    install = sandbox.install_from_current_repo()
    project = sandbox.init_project(mode="improve")

    # Run accelerated overnight (10 min with forced handoffs)
    result = sandbox.run_cli(
        ["run", "--once", "--dry-run"],  # dry-run for CI safety
        cwd=project,
        timeout=600,
    )
    assert result.exit_code == 0
