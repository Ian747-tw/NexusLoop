"""test_mcp_code_read_edit_no_rm.py — E2E: code MCP read/edit allowed, rm not exposed."""
from __future__ import annotations

import pytest


@pytest.mark.phase_m2
def test_mcp_code_read_edit_no_rm(sandbox) -> None:
    """Verify code MCP exposes only read/list/search/edit — no delete/rm operations.

    The code MCP is read-first: it allows reading files, listing files by glob,
    searching file contents, and editing files (replace). It must never expose
    delete, rm, or write operations that could destroy project files.
    """
    # Install NexusLoop
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    project = sandbox.init_project(mode="improve")

    # Create a minimal project.yaml
    (project / "project.yaml").write_text(
        "name: test-project\nmode: explore\nmetric: reward\n"
    )

    result = sandbox.run_cli(["run", "--once", "--dry-run"], cwd=project, timeout=300)

    events = sandbox.list_events(project)

    # Check for code MCP tool events
    code_events = [
        e for e in events
        if e.get("kind") == "ToolRequested"
        and e.get("tool_name", "").startswith("code.")
    ]

    code_tool_names = {e.get("tool_name") for e in code_events}

    # Verify allowed operations are present
    allowed_ops = {"code.read_file", "code.list_files", "code.search", "code.edit_file"}
    present_allowed = code_tool_names & allowed_ops

    assert len(present_allowed) >= 1, (
        f"Expected at least one allowed code MCP operation, "
        f"got tools={code_tool_names}. Last 3 events: {events[-3:]}"
    )

    # Verify NO rm/delete operations are present
    forbidden_ops = {"code.delete_file", "code.remove_file", "code.rm", "code.delete"}
    exposed_forbidden = code_tool_names & forbidden_ops

    assert len(exposed_forbidden) == 0, (
        f"Code MCP must not expose delete/rm operations, but found: {exposed_forbidden}"
    )