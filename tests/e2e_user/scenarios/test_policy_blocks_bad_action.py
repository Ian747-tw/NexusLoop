from __future__ import annotations

import pytest


@pytest.mark.phase_m1
def test_policy_engine_blocks_rule_violation(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr
    project = sandbox.init_project(mode="improve")

    result = sandbox.run_cli(
        [
            "check",
            "--action",
            "edit_file",
            "--details",
            '{"path": "NON_NEGOTIABLE_RULES.md"}',
        ],
        cwd=project,
    )

    assert result.exit_code != 0
    combined = f"{result.stdout}\n{result.stderr}".lower()
    assert "blocked" in combined or "denied" in combined
