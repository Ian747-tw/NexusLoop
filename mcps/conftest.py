"""mcps/conftest.py — shared pytest fixtures for all MCP tests."""
from __future__ import annotations

import os
import pytest
from pathlib import Path

from nxl_core.events.ipc import EventEmissionClient
from nxl_core.events.log import EventLog
from nxl_core.events.singletons import set_shared, reset
from nxl_core.tests.fake_fork import FakeFork

# Mark test mode so EventLog.append() is allowed
os.environ["NXL_EVENTLOG_WRITER"] = "test"


@pytest.fixture(autouse=True)
def fake_journal_log(tmp_path: Path) -> EventLog:
    """Replace the shared event log with a temp-file-backed one for every test."""
    events_file = tmp_path / "events.jsonl"
    log = EventLog(path=events_file)
    set_shared(log)
    yield log
    reset()


@pytest.fixture(autouse=True)
def fake_fork_ipc(fake_journal_log: EventLog, monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Provide an in-process fake fork for EventEmissionClient IPC in MCP unit tests.

    This exercises the full IPC serialization round-trip (request → fork handler →
    EventLog append → ack) without needing a real fork subprocess.

    Also resets module-level EventEmissionClient singletons so each test gets
    a fresh client wired to the fake fork.
    """
    import mcps.calibration.server as cal_module
    import mcps.policy.server as pol_module
    import mcps.journal.server as jrn_module

    fork = FakeFork(fake_journal_log, timeout=5.0)
    fork.start()

    _orig_init = EventEmissionClient.__init__

    def _patched_init(self, stdout=None, stdin=None, timeout=5.0):
        _orig_init(self, stdout=fork.client_stdout(), stdin=fork.client_stdin(), timeout=timeout)

    monkeypatch.setattr(EventEmissionClient, "__init__", _patched_init)

    # Reset module-level IPC client singletons so they pick up the patched init
    cal_module._calibration_client = None
    pol_module._policy_event_client = None
    jrn_module._client = None

    yield
    fork.stop()
