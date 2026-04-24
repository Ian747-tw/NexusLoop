"""mcps._shared.base — FastMCP wrapper + policy hook. Every MCP server inherits from this."""
from __future__ import annotations

from typing import Any, TYPE_CHECKING
from abc import ABC, abstractmethod

from nxl_core.policy.engine import PolicyEngine

if TYPE_CHECKING:
    from nxl_core.events.log import EventLog


class BaseMCPServer(ABC):
    """Base class for all NexusLoop MCPs. Provides policy-gate integration."""

    def __init__(self, name: str) -> None:
        self.name = name
        self._policy = PolicyEngine()

    @abstractmethod
    def get_tools(self) -> list[dict[str, Any]]:
        """Return list of tool definitions (name, description, inputSchema)."""
        ...

    @abstractmethod
    async def handle_tool(self, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        """Handle a tool call. Must go through policy gate."""
        ...

    def check_policy(self, tool_name: str, args: dict[str, Any]) -> bool:
        """Check if tool call is allowed by PolicyEngine."""
        decision = self._policy.check(tool_name, args)
        return decision.allowed

    def emit_tool_requested(self, tool_name: str, args: dict[str, Any]) -> None:
        """Emit ToolRequested event via EventLog."""
        from nxl_core.events.singletons import journal_log
        from nxl_core.events.schema import ToolRequested

        def _make_hashable(v: Any) -> Any:
            if isinstance(v, dict):
                return tuple((k, _make_hashable(v2)) for k, v2 in sorted(v.items()))
            if isinstance(v, list):
                return tuple(_make_hashable(x) for x in v)
            return v

        # Convert args.items() to a stable, hashable tuple
        items_tuple = tuple((k, _make_hashable(v)) for k, v in sorted(args.items(), key=str))
        args_hash = str(hash(items_tuple))

        event_log = journal_log()
        event_log.append(ToolRequested(
            tool_name=tool_name,
            args_hash=args_hash,
            requesting_skill=None,
        ))
