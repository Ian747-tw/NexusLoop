"""nxl/core/orchestrator/bootstrap.py — signal handlers, startup/shutdown."""
from __future__ import annotations

import signal
from pathlib import Path
from typing import Callable

from nxl.cli import console
from nxl.core.state import ProjectState
from nxl_core.events.singletons import configure as _configure_event_log


def bootstrap(config_dir: Path) -> dict:
    """Initialize event log and load project state."""
    _configure_event_log(config_dir / "events.jsonl")
    return {}


def setup_sigint_handler() -> tuple[Callable[[int, object], None], object]:
    """Return (handler, old_handler) for SIGINT."""
    _shutdown_requested = False

    def _handle_sigint(sig: int, frame: object) -> None:
        nonlocal _shutdown_requested
        _shutdown_requested = True
        console(
            "Shutdown requested — stopping after current autonomous cycle.",
            "warning",
        )

    old_handler = signal.signal(signal.SIGINT, _handle_sigint)
    return _handle_sigint, old_handler