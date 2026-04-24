"""mcps._shared.test_helpers — shared test fixtures for MCP tests."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

from nxl_core.events.log import EventLog


def make_fake_event_log(tmp_path: Path) -> EventLog:
    """Create a real EventLog pointing at a temp events file for tests."""
    events_file = tmp_path / "events.jsonl"
    return EventLog(path=events_file)


def mock_journal_log(event_log: EventLog) -> None:
    """Patch journal_log to return a specific EventLog instance."""
    import nxl_core.events.singletons
    nxl_core.events.singletons._shared_log = event_log