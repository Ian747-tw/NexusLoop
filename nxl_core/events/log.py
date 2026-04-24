"""
nxl_core.events.log
-------------------
Append-only event log with file-level locking and cursor-based reading.

Only `append()` is permitted to write to events.jsonl (enforced by CI grep).
Reads use cursors (event IDs) to stream events forward-only.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Iterator

import portalocker

from nxl_core.events.schema import Event


class EventLog:
    """
    Append-only event log with portalocker file lock.

    Parameters
    ----------
    path:
        Path to the events.jsonl file (created on first append if missing).

    Lock file
    ---------
    A companion `.lock` file is kept alongside the log. The lock is acquired
    exclusively for the duration of each write operation only.
    """

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self._lock_path = self.path.with_suffix(".lock")

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------

    def append(self, event: Event) -> str:
        """
        Append one event to the log, returning its event_id.

        The write is performed under an exclusive file lock (portalocker)
        with fsync to ensure durability on the current filesystem.

        Returns
        -------
        event_id: str — the ULID of the appended event.
        """
        line = event.model_dump_json() + "\n"
        with portalocker.Lock(self._lock_path, timeout=10, mode="w") as _lock:
            with self.path.open("a") as f:
                f.write(line)
                f.flush()
                os.fsync(f.fileno())
        return event.event_id

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    def read_from(self, cursor: str | None = None) -> Iterator[Event]:
        """
        Stream events after the given cursor (event_id).

        If cursor is None, yields all events from the beginning.
        If cursor points to a line not found, yields nothing.
        Cursor matching is by exact event_id comparison on the read line.

        Yields
        ------
        Event — each event in ascending file order.
        """
        if not self.path.exists():
            return

        from pydantic import TypeAdapter
        adapter = TypeAdapter(Event)

        with self.path.open("r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                # Parse just the event_id field without full validation for speed
                try:
                    raw = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if cursor is not None:
                    if raw.get("event_id") != cursor:
                        continue
                    # Cursor line found — stop filtering; subsequent lines all pass
                    cursor = None  # type: ignore[assignment]
                    continue
                try:
                    yield adapter.validate_json(line)
                except Exception:
                    # Skip malformed lines silently in read path
                    pass

    def read_all(self) -> Iterator[Event]:
        """Shorthand for read_from(None)."""
        yield from self.read_from(None)

    # ------------------------------------------------------------------
    # Cursor helpers
    # ------------------------------------------------------------------

    def latest_event_id(self) -> str | None:
        """Return the event_id of the last line in the log, or None if empty."""
        if not self.path.exists():
            return None
        lines = self.path.read_text().splitlines()
        if not lines:
            return None
        last = lines[-1].strip()
        if not last:
            return None
        try:
            return json.loads(last)["event_id"]
        except (json.JSONDecodeError, KeyError):
            return None