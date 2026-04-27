"""nxl/core/orchestrator/events_bridge.py — OpenCode events → nxl events."""
from __future__ import annotations

from nxl_core.events.ipc import EventEmissionClient


class EventsBridge:
    def __init__(self) -> None:
        self._client = EventEmissionClient()

    def emit_event(self, event: dict) -> None:
        self._client.emit(event, origin_mcp="orchestrator")