"""mcps._shared.testing — per-MCP smoke harness."""
from __future__ import annotations

from mcps._shared.base import BaseMCPServer


def smoke_test(server: BaseMCPServer, tool_name: str, args: dict[str, object]) -> bool:
    """
    Run a smoke test: emit event + call policy check.

    Returns True if policy allows the tool call.
    """
    server.emit_tool_requested(tool_name, args)
    return server.check_policy(tool_name, args)
