"""
nxl_core/events/ipc.py
----------------------
EventEmissionClient — Python-side helper for sending EventEmissionRequest
to the fork over stdio (PROTOCOL_v1.1.md).

Usage:
    from nxl_core.events.ipc import EventEmissionClient
    client = EventEmissionClient()
    event_id = client.emit(event, origin_mcp="journal")

The client:
- Generates a ULID request_id to correlate the ack
- Writes JSON-line EventEmissionRequest to stdout
- Reads EventEmissionAck from stdin (blocking per call)
- Raises EventEmissionError on null event_id or timeout
- Is NOT thread-safe (use one client per thread/process)
"""
from __future__ import annotations

import sys
import threading
import time
from typing import Optional

# ULID generation
try:
    import ulid
except ImportError:
    ulid = None  # type: ignore


class EventEmissionError(Exception):
    """Raised when the fork rejects an EventEmissionRequest."""
    pass


class EventEmissionTimeoutError(EventEmissionError):
    """Raised when the fork does not respond within the configured timeout."""
    pass


def _generate_ulid() -> str:
    """Generate a ULID string. Uses the ulid library if available."""
    if ulid is not None:
        return str(ulid.ULID())
    # Fallback: 26-char Crockford base32 string
    import random
    chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
    return ''.join(random.choices(chars, k=26))


class EventEmissionClient:
    """
    Sends EventEmissionRequest to the fork over stdout/stdin.

    The fork's EventEmissionAck is returned as the event_id (string).
    On fork rejection (event_id: null), raises EventEmissionError with the
    error message from the ack.

    Parameters
    ----------
    stdout : file-like
        Writable stream for sending requests (default: sys.stdout).
        Must have a `.write()` and `.flush()` method.
    stdin : file-like
        Readable stream for receiving acks (default: sys.stdin).
        Must have a `.readline()` method.
    timeout : float
        Seconds to wait for an ack before raising EventEmissionTimeoutError.
        Default 5.0.
    """

    def __init__(
        self,
        stdout: Optional[object] = None,
        stdin: Optional[object] = None,
        timeout: float = 5.0,
    ) -> None:
        self._stdout = stdout if stdout is not None else sys.stdout
        self._stdin = stdin if stdin is not None else sys.stdin
        self._timeout = timeout
        self._lock = threading.Lock()

    def emit(self, event: dict, origin_mcp: str) -> str:
        """
        Emit an event through the fork's single-writer pipeline.

        Parameters
        ----------
        event : dict
            Event dict (must include 'event_id' and 'kind').
        origin_mcp : str
            Name of the originating MCP (e.g. "journal", "evidence").

        Returns
        -------
        event_id : str
            The ULID event_id from the event itself.

        Raises
        ------
        EventEmissionTimeoutError
            If no ack is received within `timeout` seconds.
        EventEmissionError
            If the fork returns event_id: null (validation failure or error).
        """
        request_id = _generate_ulid()
        msg = {
            "kind": "EventEmissionRequest",
            "request_id": request_id,
            "event": event,
            "origin_mcp": origin_mcp,
        }

        # Serialize and send
        line = (_json_dumps(msg) + "\n").encode("utf-8")
        with self._lock:
            self._stdout.write(line)
            self._stdout.flush()

            # Read ack — line is "kind": "EventEmissionAck" with matching request_id
            deadline = time.monotonic() + self._timeout
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise EventEmissionTimeoutError(
                        f"timeout after {self._timeout}s waiting for ack for request_id={request_id}"
                    )
                # Use a short read with timeout — readline() blocks indefinitely
                # We use select-style polling via a small buffer read
                ack_line = _read_line_with_timeout(self._stdin, remaining)
                if ack_line is None:
                    # Timeout on read — retry until deadline
                    continue
                if not ack_line.strip():
                    continue
                try:
                    ack = _json_loads(ack_line)
                except Exception:
                    # Malformed line — skip
                    continue
                if ack.get("request_id") == request_id:
                    if ack.get("event_id") is None:
                        error = ack.get("error", "unknown error")
                        raise EventEmissionError(
                            f"fork rejected event (event_id={event.get('event_id')}): {error}"
                        )
                    return ack["event_id"]


def _json_dumps(obj: dict) -> str:
    """Serialize a dict to JSON, matching the Python Pydantic encoder used elsewhere."""
    import json
    return json.dumps(obj, separators=(',', ':'))


def _json_loads(s: str) -> dict:
    import json
    return json.loads(s)


def _read_line_with_timeout(stdin: object, timeout: float) -> Optional[str]:
    """
    Read one line from stdin with a wall-clock timeout.

    Uses a background thread to read ahead so that we don't block
    indefinitely on the stdin.read() call.
    """
    result: list[str] = []
    error: list[Exception] = []

    def reader():
        try:
            result.append(stdin.readline())
        except Exception as e:
            error.append(e)

    t = threading.Thread(target=reader, daemon=True)
    t.start()
    t.join(timeout=timeout)
    if t.is_alive():
        # Timed out — the read is still pending (stdin.readline() is blocking)
        # The thread is daemon so it won't block process exit.
        return None
    if error:
        raise error[0]
    return result[0] if result else None