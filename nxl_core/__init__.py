"""
nxl_core
--------
Pure-Python event-sourced research primitives for NexusLoop.
No dependency on any fork — uses upstream Claude Code as subprocess.

Exports
-------
events.schema : Event union and all 18 event kind classes
events.log    : EventLog append-only interface
events.replay : Deterministic state reconstruction from event stream
"""
from nxl_core.events.schema import (
    CycleStarted,
    CycleCompleted,
    CycleFailed,
    ToolRequested,
    ToolCompleted,
    ToolFailed,
    HypothesisCreated,
    TrialStarted,
    TrialCompleted,
    TrialFailed,
    EvidenceCollected,
    PolicyDecision,
    ZoneEntered,
    ZoneExited,
    CapsuleBuilt,
    CapsuleResumed,
    IncidentReported,
    HandoffRecorded,
    Event,
)

__all__ = [
    "Event",
    "CycleStarted",
    "CycleCompleted",
    "CycleFailed",
    "ToolRequested",
    "ToolCompleted",
    "ToolFailed",
    "HypothesisCreated",
    "TrialStarted",
    "TrialCompleted",
    "TrialFailed",
    "EvidenceCollected",
    "PolicyDecision",
    "ZoneEntered",
    "ZoneExited",
    "CapsuleBuilt",
    "CapsuleResumed",
    "IncidentReported",
    "HandoffRecorded",
]