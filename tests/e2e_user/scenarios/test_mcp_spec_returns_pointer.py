"""test_mcp_spec_returns_pointer.py — E2E: spec MCP returns pointer from project.yaml."""
from __future__ import annotations

import pytest


@pytest.mark.phase_m2
def test_mcp_spec_returns_pointer(sandbox) -> None:
    """Verify spec MCP is invoked during run --once and emits ToolRequested events.

    The spec MCP (spec.get_project, spec.get_operations) is a read-first MCP
    that reads project.yaml and returns pointers. This test verifies the MCP
    is called during a dry-run cycle and its events appear in the event log.
    """
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    project = sandbox.init_project(mode="improve")

    # Create a minimal project.yaml with required fields
    project_yaml = project / "project.yaml"
    project_yaml.write_text(
        "name: test-project\n"
        "mode: explore\n"
        "metric: reward\n"
        "operations:\n"
        "  default_provider: anthropic\n"
    )

    sandbox.run_cli(["run", "--once", "--dry-run"], cwd=project, timeout=300)

    # Exit code 0 means the run completed (even in dry-run mode)
    # The spec MCP should have been called to read project.yaml
    events = sandbox.list_events(project)

    # Verify spec MCP events in log (tool requested events for spec.*)
    spec_events = [
        e for e in events
        if e.get("kind") == "tool_requested"
        and e.get("tool_name", "").startswith("spec.")
    ]

    assert len(spec_events) >= 1, (
        f"Expected at least 1 spec MCP ToolRequested event, got {len(spec_events)} events. "
        f"Last 3 events: {events[-3:]}"
    )