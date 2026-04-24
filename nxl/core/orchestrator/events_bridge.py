"""nxl/core/orchestrator/events_bridge.py — OpenCode events → nxl events."""
from __future__ import annotations

from pathlib import Path

from nxl_core.events.log import EventLog


class EventsBridge:
    def __init__(self, path: Path):
        self._log = EventLog(path)

    def write(self, event: dict) -> None:
        self._log.append(event)