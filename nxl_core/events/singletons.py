"""
nxl_core.events.singletons
--------------------------
Module-level event log singleton used by nxl/logging/ modules.

A single EventLog instance is shared across all four accessors.
configure() / reset() manage it; tests can patch it directly.
"""
from __future__ import annotations

from pathlib import Path

from nxl_core.events.log import EventLog

# Default path used when nxl run is active
_DEFAULT_EVENT_LOG_PATH = Path(".nxl/events.jsonl")

# The single shared instance (created lazily or by configure)
_shared_log: EventLog | None = None


def _get_shared_log() -> EventLog:
    global _shared_log
    if _shared_log is None:
        _shared_log = EventLog(path=_DEFAULT_EVENT_LOG_PATH)
    return _shared_log


def journal_log() -> EventLog:
    return _get_shared_log()


def incident_log() -> EventLog:
    return _get_shared_log()


def handoff_log() -> EventLog:
    return _get_shared_log()


def registry_log() -> EventLog:
    return _get_shared_log()


def reset() -> None:
    """Reset the shared singleton — used in tests."""
    global _shared_log
    _shared_log = None


def configure(event_log_path: Path) -> None:
    """Configure the shared event log path."""
    global _shared_log
    _shared_log = EventLog(path=event_log_path)


def get_shared() -> EventLog:
    """Return the shared log instance (for direct patching in tests)."""
    return _get_shared_log()


def set_shared(log: EventLog) -> None:
    """Replace the shared log instance (used by tests)."""
    global _shared_log
    _shared_log = log