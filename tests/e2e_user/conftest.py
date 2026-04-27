from __future__ import annotations

import os
from pathlib import Path
from typing import Iterator

import pytest

from nxl_core.events.log import EventLog
from nxl_core.events.singletons import set_shared, reset
from .sandbox import Sandbox

os.environ["NXL_EVENTLOG_WRITER"] = "test"


@pytest.fixture(autouse=True)
def fake_journal_log(tmp_path: pytest.Fixture) -> EventLog:
    """Replace the shared event log with a temp-file-backed one for every test."""
    events_file = tmp_path / "events.jsonl"
    log = EventLog(path=events_file)
    set_shared(log)
    yield log
    reset()


@pytest.fixture
def sandbox() -> Iterator[Sandbox]:
    repo_root = Path(__file__).resolve().parents[2]
    recorded_dir = Path(__file__).resolve().parent / "recorded"
    box = Sandbox(repo_root=repo_root, recorded_dir=recorded_dir)
    try:
        yield box
    finally:
        box.cleanup()
