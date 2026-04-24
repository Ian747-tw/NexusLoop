"""test_mcp_policy_denies_on_rule_violation.py — E2E: policy denies shell.exec with ttl > 300."""
from __future__ import annotations

import pytest


@pytest.mark.phase_m2
def test_mcp_policy_denies_on_rule_violation(sandbox) -> None:
    """Verify policy engine denies shell.exec with ttl > 300 and cwd outside scratch.

    Two policy rules must be enforced:
    1. shell.exec with ttl > 300 must be denied (TTL limit)
    2. shell.exec with cwd outside scratch directory must be denied (path restriction)

    These are core NON_NEGOTIABLE constraints that the policy engine must enforce.
    """
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    project = sandbox.init_project(mode="improve")

    # Create a minimal project.yaml
    (project / "project.yaml").write_text(
        "name: test-project\nmode: explore\nmetric: reward\n"
    )

    # Test 1: shell.exec with ttl > 300 should be denied
    # (This tests the TTL limit rule)
    result_ttl = sandbox.run_cli(
        [
            "check",
            "--action",
            "shell.exec",
            "--details",
            '{"ttl": 400, "cmd": "echo test"}',
        ],
        cwd=project,
    )
    assert result_ttl.exit_code != 0, (
        f"shell.exec with ttl=400 should be denied, but got exit_code={result_ttl.exit_code}. "
        f"stdout: {result_ttl.stdout}, stderr: {result_ttl.stderr}"
    )
    combined = f"{result_ttl.stdout}\n{result_ttl.stderr}".lower()
    assert any(word in combined for word in ["denied", "blocked", "forbidden", "policy"]), (
        f"Expected policy denial message for ttl=400, got: {combined}"
    )

    # Test 2: shell.exec with cwd outside scratch should be denied
    result_cwd = sandbox.run_cli(
        [
            "check",
            "--action",
            "shell.exec",
            "--details",
            '{"cwd": "/tmp", "cmd": "echo test"}',
        ],
        cwd=project,
    )
    assert result_cwd.exit_code != 0, (
        f"shell.exec with cwd=/tmp should be denied, but got exit_code={result_cwd.exit_code}. "
        f"stdout: {result_cwd.stdout}, stderr: {result_cwd.stderr}"
    )
    combined_cwd = f"{result_cwd.stdout}\n{result_cwd.stderr}".lower()
    assert any(word in combined_cwd for word in ["denied", "blocked", "forbidden", "policy", "cwd", "scratch"]), (
        f"Expected policy denial message for cwd=/tmp, got: {combined_cwd}"
    )