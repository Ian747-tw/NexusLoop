"""
nxl_core/tests/fake_fork.py
--------------------------
In-process fake fork for testing EventEmissionClient without a real subprocess.

Provides synchronous IPC: client writes EventEmissionRequest to its stdout
(consumed by the fake fork thread), fake fork writes EventEmissionAck to its
stdin (read by the client). Uses the test's EventLog (NXL_EVENTLOG_WRITER=test)
to actually append events.

Run: uv run pytest nxl_core/tests/test_fake_fork.py -v
"""
from __future__ import annotations

import io
import json
import queue
import threading
import time
from typing import Optional

from nxl_core.events.ipc import (
    EventEmissionClient,
    EventEmissionError,
    EventEmissionTimeoutError,
)


class FakeFork:
    """
    In-process fake fork: client drives requests by writing to its stdout.
    Fake fork thread consumes those lines and writes acks to the client's stdin.

    Parameters
    ----------
    event_log
        EventLog instance to use for appending events (test fixture).
    timeout
        Seconds to wait for a request before raising timeout.
    """

    def __init__(self, event_log, timeout: float = 5.0):
        self._event_log = event_log
        self._timeout = timeout
        # Queue for request lines written by the client
        self._request_queue: queue.Queue[str] = queue.Queue()
        # Queue for ack lines to be read by the client
        self._ack_queue: queue.Queue[str] = queue.Queue()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def _write_ack(self, request_id: str, event_id: str, error: Optional[str] = None) -> None:
        """Write an EventEmissionAck to the client's stdin queue."""
        ack = {
            "kind": "EventEmissionAck",
            "request_id": request_id,
            "event_id": event_id if error is None else None,
            "error": error,
        }
        line = json.dumps(ack, separators=(",", ":")) + "\n"
        self._ack_queue.put(line)

    def _run_loop(self) -> None:
        """Consume request lines from queue, write acks back."""
        while not self._stop_event.is_set():
            try:
                line = self._request_queue.get(timeout=0.05)
            except queue.Empty:
                continue
            if line is None:  # sentinel
                break
            try:
                msg = json.loads(line.strip())
            except json.JSONDecodeError:
                continue
            if msg.get("kind") != "EventEmissionRequest":
                continue
            request_id = msg.get("request_id", "")
            event = msg.get("event", {})
            event_id = event.get("event_id", "")
            error: Optional[str] = None
            try:
                # Event may be a dict (IPC serialized) or a Pydantic model — handle both
                from pydantic import TypeAdapter
                from nxl_core.events.schema import Event
                ta = TypeAdapter(Event)
                validated = ta.validate_python(event)
                event_id = self._event_log.append(validated)
            except Exception as e:
                error = str(e)
                event_id = event.get("event_id", "") if isinstance(event, dict) else ""
            self._write_ack(request_id, event_id, error)

    def start(self) -> None:
        """Start the fake fork handler thread."""
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        """Stop the fake fork and wait for the handler thread to finish."""
        self._stop_event.set()
        self._request_queue.put(None)  # sentinel
        if self._thread:
            self._thread.join(timeout=2.0)

    # ------------------------------------------------------------------
    # File-like interface for EventEmissionClient
    # ------------------------------------------------------------------

    class _ClientWritesToStdout:
        """Wrapper: client's stdout (fake fork reads from this)."""

        def __init__(self, queue_: queue.Queue[str]):
            self._queue = queue_

        def write(self, s: str) -> int:
            self._queue.put(s)
            return len(s)

        def flush(self) -> None:
            pass

    class _ClientReadsFromStdin:
        """Wrapper: client's stdin (fake fork writes to this)."""

        def __init__(self, queue_: queue.Queue[str], timeout: float):
            self._queue = queue_
            self._timeout = timeout

        def readline(self) -> str:
            try:
                return self._queue.get(timeout=self._timeout)
            except queue.Empty:
                return ""

    def client_stdout(self) -> object:
        return self._ClientWritesToStdout(self._request_queue)

    def client_stdin(self) -> object:
        return self._ClientReadsFromStdin(self._ack_queue, self._timeout)
