"""mcps/conftest.py — shared pytest fixtures for all MCP tests."""
from __future__ import annotations

import pytest
from pathlib import Path

from nxl_core.events.log import EventLog
from nxl_core.events.singletons import set_shared, reset


@pytest.fixture(autouse=True)
def fake_journal_log(tmp_path: Path) -> EventLog:
    """Replace the shared event log with a temp-file-backed one for every test."""
    events_file = tmp_path / "events.jsonl"
    log = EventLog(path=events_file)
    set_shared(log)
    yield log
    reset()