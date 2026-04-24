"""nxl/core/orchestrator/cycle_adapter.py — calls agentcore.client_py."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from agentcore.client_py.client import OpenCodeClient
from nxl_core.events.schema import (
    CompactRequested,
    SessionClearing,
)
from nxl_core.events.singletons import journal_log
from nxl_core.capsule.handoff import HandoffRecord


# Token threshold constants
SOFT_TOKEN_THRESHOLD = 0.6  # 60% token usage
HARD_TOKEN_THRESHOLD = 0.8  # 80% token usage
EVENTS_SOFT_THRESHOLD = 40  # events since last compact
EVENTS_HARD_THRESHOLD = 150  # events since last compact
SESSION_CLEAR_AGE = timedelta(hours=6)  # 6 hours


class CycleAdapter:
    def __init__(self) -> None:
        self._client = OpenCodeClient()
        self._events_since_compact = 0
        self._token_estimate = 0.0
        self._session_start_time = datetime.now(timezone.utc)
        self._last_provider: str | None = None
        self._cycle_count = 0

    def run_cycle(self, brief: str, provider: str | None = None) -> dict[str, Any]:
        # Check for model switch (clear trigger)
        if self._last_provider is not None and provider is not None:
            if self._last_provider != provider:
                self._trigger_clear(
                    reason=f"model_switch: {self._last_provider} -> {provider}"
                )

        # Check session age (clear trigger)
        session_age = datetime.now(timezone.utc) - self._session_start_time
        if session_age > SESSION_CLEAR_AGE:
            self._trigger_clear(reason=f"session_age: {session_age.total_seconds():.0f}s > 6h")

        # Run the cycle
        result = self._client.run_cycle(
            brief, provider=provider, policy_endpoint='', events_endpoint=''
        )

        self._cycle_count += 1

        # Update token estimate from cycle result
        if hasattr(result, 'final_state') and result.final_state:
            # Estimate tokens from final_state bytes (rough: len / 4)
            self._token_estimate = len(result.final_state) / 10000.0

        # Track events since last compact
        if hasattr(result, 'events'):
            self._events_since_compact += len(result.events)

        # Check soft trigger thresholds
        self._check_soft_trigger()

        # Check hard trigger thresholds
        self._check_hard_trigger()

        return result.model_dump() if hasattr(result, 'model_dump') else dict(result)

    def _check_soft_trigger(self) -> None:
        """Emit CompactRequested(tier_hint='soft') if thresholds exceeded."""
        log = journal_log()

        # Check: tokens > 60% OR events > 40 since last compact
        if self._events_since_compact > EVENTS_SOFT_THRESHOLD or self._token_estimate > SOFT_TOKEN_THRESHOLD:
            reason = (
                f"events_since_compact={self._events_since_compact}, "
                f"token_estimate={self._token_estimate:.2f}"
            )
            log.append(
                CompactRequested(
                    tier_hint="soft",
                    reason=reason,
                    events_since_compact=self._events_since_compact,
                    token_estimate=self._token_estimate,
                )
            )
            self._events_since_compact = 0
            self._token_estimate = 0.0

    def _check_hard_trigger(self) -> None:
        """Emit CompactRequested(tier_hint='hard') if thresholds exceeded."""
        log = journal_log()

        # Check: tokens > 80% OR events > 150 since last compact
        if self._events_since_compact > EVENTS_HARD_THRESHOLD or self._token_estimate > HARD_TOKEN_THRESHOLD:
            reason = (
                f"events_since_compact={self._events_since_compact}, "
                f"token_estimate={self._token_estimate:.2f}"
            )
            log.append(
                CompactRequested(
                    tier_hint="hard",
                    reason=reason,
                    events_since_compact=self._events_since_compact,
                    token_estimate=self._token_estimate,
                )
            )
            self._events_since_compact = 0
            self._token_estimate = 0.0

    def _trigger_clear(self, reason: str) -> None:
        """Emit SessionClearing event and write HandoffRecord."""
        log = journal_log()
        handoff_id = f"handoff-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"

        # Emit SessionClearing event
        log.append(
            SessionClearing(
                handoff_id=handoff_id,
                reason=reason,
                from_agent="nexusloop",
                to_agent="nexusloop-next",
            )
        )

        # Write HandoffRecord (validated model, can be serialized)
        handoff = HandoffRecord(
            from_agent="nexusloop",
            to_agent="nexusloop-next",
            reason=reason,
            summary=f"Session cleared after {self._cycle_count} cycles",
            hints=f"reason={reason}",
        )
        # HandoffRecord is a validated Pydantic model — in production this
        # would be persisted to a handoff store; here we just validate it

        # Reset session state
        self._session_start_time = datetime.now(timezone.utc)
        self._events_since_compact = 0
        self._token_estimate = 0.0
        self._cycle_count = 0
