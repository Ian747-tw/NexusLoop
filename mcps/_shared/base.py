"""mcps._shared.base — FastMCP wrapper + policy hook. Every MCP server inherits from this."""
from __future__ import annotations

from typing import Any, TYPE_CHECKING
from abc import ABC, abstractmethod

from nxl_core.policy.engine import PolicyEngine

if TYPE_CHECKING:
    pass


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
