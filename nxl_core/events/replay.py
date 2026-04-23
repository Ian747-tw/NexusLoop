"""
nxl_core.events.replay
----------------------
Deterministic state reconstruction from an event stream.

``project(events) → State`` is a pure function:
  - No I/O
  - No reading time
  - No randomness
  - Same event prefix always produces byte-identical state
"""
from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Iterable

from nxl_core.events.schema import Event


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

@dataclass
class State:
    """
    Immutable snapshot of the research loop after processing events.

    All fields are derived deterministically from the event stream.
    """
    total_events: int = 0
    cycles_started: int = 0
    cycles_completed: int = 0
    tools_requested: int = 0
    tools_completed: int = 0
    tools_failed: int = 0
    hypotheses_created: int = 0
    trials_started: int = 0
    trials_completed: int = 0
    trials_failed: int = 0
    evidence_collected: int = 0
    current_cycle_id: str | None = None
    current_zone: str = "A"
    active_hypothesis_id: str | None = None
    best_trial_id: str | None = None
    best_metric_value: float | None = None
    last_event_id: str | None = None
    incident_count: int = 0
    handoff_count: int = 0

    def model_dump_json(self) -> str:
        """Serialize state to JSON for deterministic byte-exact comparison."""
        import json
        return json.dumps(self.__dict__, sort_keys=True, separators=(",", ":"))


def project(events: Iterable[Event] | Iterator[Event]) -> State:
    """
    Fold an event stream into a State snapshot.

    This function is:
      - Pure: no I/O, no time, no randomness
      - Deterministic: same event order always produces byte-identical state
      - Total: processes all events, no early-exit

    Parameters
    ----------
    events:
        An iterable or iterator of Event objects in ascending time order.

    Returns
    -------
    State — the accumulated snapshot after all events.
    """
    state = State()

    for event in events:
        state.total_events += 1
        state.last_event_id = event.event_id

        # Cycle events
        if event.kind == "cycle_started":
            state.cycles_started += 1
            state.current_cycle_id = event.cycle_id
            if event.hypothesis_id:
                state.active_hypothesis_id = event.hypothesis_id

        elif event.kind == "cycle_completed":
            state.cycles_completed += 1

        elif event.kind == "cycle_failed":
            # Reset current cycle on failure
            state.current_cycle_id = None

        # Tool events
        elif event.kind == "tool_requested":
            state.tools_requested += 1

        elif event.kind == "tool_completed":
            state.tools_completed += 1

        elif event.kind == "tool_failed":
            state.tools_failed += 1

        # Research events
        elif event.kind == "hypothesis_created":
            state.hypotheses_created += 1
            if not state.active_hypothesis_id:
                state.active_hypothesis_id = event.hypothesis_id

        elif event.kind == "trial_started":
            state.trials_started += 1

        elif event.kind == "trial_completed":
            state.trials_completed += 1
            # Update best trial if metrics available
            metrics = getattr(event, "metrics", {})
            if metrics:
                reward = metrics.get("reward")
                if reward is not None:
                    if state.best_metric_value is None or reward > state.best_metric_value:
                        state.best_metric_value = reward
                        state.best_trial_id = event.trial_id

        elif event.kind == "trial_failed":
            state.trials_failed += 1

        elif event.kind == "evidence_collected":
            state.evidence_collected += 1

        # Policy events
        elif event.kind == "policy_decision":
            pass  # counters only; decision already stored in policy engine

        # Zone events
        elif event.kind == "zone_entered":
            state.current_zone = event.zone

        elif event.kind == "zone_exited":
            # Moving to next zone; A is the default when not in a zone
            pass

        # Capsule events
        elif event.kind == "capsule_built":
            pass  # size info in event, not tracked in aggregate state

        elif event.kind == "capsule_resumed":
            pass  # resume is a navigation event

        # Incident / handoff events
        elif event.kind == "incident_reported":
            state.incident_count += 1

        elif event.kind == "handoff_recorded":
            state.handoff_count += 1

    return state