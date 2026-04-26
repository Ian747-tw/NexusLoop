"""
nxl_core/tests/test_fake_fork.py
--------------------------------
Tests for FakeFork — in-process IPC for EventEmissionClient unit tests.

Run: uv run pytest nxl_core/tests/test_fake_fork.py -v
"""
from __future__ import annotations

import json
import time

import pytest

from nxl_core.events.ipc import EventEmissionClient, EventEmissionTimeoutError
from nxl_core.events.log import EventLog
from nxl_core.events.schema import CycleStarted
from nxl_core.tests.fake_fork import FakeFork


class TestFakeFork:
    """Verify FakeFork correctly handles EventEmissionRequest/EventEmissionAck."""

    def test_event_emission_round_trip(self, tmp_path: pytest.fixture) -> None:
        """Client sends request, fork replies with ack, event is appended."""
        import os
        os.environ["NXL_EVENTLOG_WRITER"] = "test"
        events_file = tmp_path / "events.jsonl"
        log = EventLog(path=events_file)

        fork = FakeFork(log, timeout=2.0)
        fork.start()

        try:
            client = EventEmissionClient(
                stdout=fork.client_stdout(),
                stdin=fork.client_stdin(),
                timeout=2.0,
            )
            event = {
                "event_id": "01H00000000000000000000000",
                "timestamp": "2026-04-26T00:00:00.000Z",
                "kind": "cycle_started",
                "brief_hash": "abc",
                "hypothesis_id": "h1",
            }
            event_id = client.emit(event, origin_mcp="test")

            assert event_id.startswith("01H"), f"expected ULID event_id, got {event_id!r}"

            # Verify event was appended to the log
            lines = [l.strip() for l in events_file.read_text().splitlines() if l.strip()]
            assert len(lines) == 1
            written = json.loads(lines[0])
            assert written["kind"] == "cycle_started"
            assert written["event_id"] == event_id
        finally:
            fork.stop()

    def test_timeout_when_no_ack(self, tmp_path: pytest.fixture) -> None:
        """If fork never responds, client raises EventEmissionTimeoutError."""
        import os
        os.environ["NXL_EVENTLOG_WRITER"] = "test"
        events_file = tmp_path / "events.jsonl"
        log = EventLog(path=events_file)

        fork = FakeFork(log, timeout=0.1)
        # Don't start fork — no acks will come
        client = EventEmissionClient(
            stdout=fork.client_stdout(),
            stdin=fork.client_stdin(),
            timeout=0.5,
        )
        event = {
            "event_id": "01H00000000000000000000001",
            "timestamp": "2026-04-26T00:00:00.000Z",
            "kind": "cycle_started",
            "brief_hash": "def",
            "hypothesis_id": "h2",
        }
        with pytest.raises(EventEmissionTimeoutError):
            client.emit(event, origin_mcp="test")
