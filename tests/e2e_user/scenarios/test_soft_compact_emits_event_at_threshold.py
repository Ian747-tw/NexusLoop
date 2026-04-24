"""Test that soft compaction emits CompactRequested event at threshold."""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from nxl_core.events.log import EventLog
from nxl_core.events.schema import CompactRequested


@pytest.mark.phase_m2
def test_soft_compact_emits_event_at_threshold(fake_journal_log: EventLog) -> None:
    """Soft trigger should emit CompactRequested(tier_hint='soft') when:
    - events > 40 since last compact, OR
    - token_estimate > 0.6

    This test verifies the soft trigger logic in CycleAdapter.
    """
    from nxl.core.orchestrator.cycle_adapter import (
        CycleAdapter,
        EVENTS_SOFT_THRESHOLD,
        SOFT_TOKEN_THRESHOLD,
    )

    adapter = CycleAdapter()

    # Manually set thresholds to trigger soft compact
    adapter._events_since_compact = EVENTS_SOFT_THRESHOLD + 1
    adapter._token_estimate = 0.3  # Below threshold, but events > 40

    # Check soft trigger
    adapter._check_soft_trigger()

    # Verify CompactRequested event was emitted
    events = list(fake_journal_log.read_all())
    compact_events = [e for e in events if e.kind == "compact_requested"]

    assert len(compact_events) == 1, f"Expected 1 compact event, got {len(compact_events)}"
    assert compact_events[0].tier_hint == "soft"
    assert compact_events[0].events_since_compact == EVENTS_SOFT_THRESHOLD + 1

    # Verify counters were reset
    assert adapter._events_since_compact == 0
    assert adapter._token_estimate == 0.0


@pytest.mark.phase_m2
def test_soft_compact_triggers_on_token_threshold(fake_journal_log: EventLog) -> None:
    """Soft trigger should also fire when token_estimate > 0.6."""
    from nxl.core.orchestrator.cycle_adapter import (
        CycleAdapter,
        SOFT_TOKEN_THRESHOLD,
    )

    adapter = CycleAdapter()

    # Set token estimate above threshold
    adapter._events_since_compact = 10  # Below 40
    adapter._token_estimate = SOFT_TOKEN_THRESHOLD + 0.1

    # Check soft trigger
    adapter._check_soft_trigger()

    # Verify CompactRequested event was emitted
    events = list(fake_journal_log.read_all())
    compact_events = [e for e in events if e.kind == "compact_requested"]

    assert len(compact_events) == 1
    assert compact_events[0].tier_hint == "soft"
    assert compact_events[0].token_estimate == SOFT_TOKEN_THRESHOLD + 0.1


@pytest.mark.phase_m2
def test_soft_compact_does_not_fire_below_threshold(fake_journal_log: EventLog) -> None:
    """Soft trigger should NOT fire when below both thresholds."""
    from nxl.core.orchestrator.cycle_adapter import CycleAdapter

    adapter = CycleAdapter()

    # Set values below both thresholds
    adapter._events_since_compact = 20  # Below 40
    adapter._token_estimate = 0.3  # Below 0.6

    # Check soft trigger
    adapter._check_soft_trigger()

    # Verify no CompactRequested event was emitted
    events = list(fake_journal_log.read_all())
    compact_events = [e for e in events if e.kind == "compact_requested"]

    assert len(compact_events) == 0

    # Verify counters were NOT reset
    assert adapter._events_since_compact == 20
    assert adapter._token_estimate == 0.3
