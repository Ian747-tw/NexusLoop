"""
nxl_core.policy.zones
----------------------
Zone A/B/C transition machinery.

Zone A = exploration (open research)
Zone B = exploitation (focused iteration)
Zone C = verification (human review required)

enter_zone(zone, reason) returns a ZoneEntered event.
Transitions are always allowed (A→B→C→B→A are all valid).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field


class Zone(str, Enum):
    A = "A"  # exploration
    B = "B"  # exploitation
    C = "C"  # verification


@dataclass
class ZoneMetrics:
    """Per-zone counters."""
    transition_count: int = 0
    last_zone: Zone | None = None


class ZoneEntered(BaseModel):
    """Event emitted when entering a zone."""
    zone: Zone
    reason: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# Module-level state
_current_zone: Zone = Zone.A
_zone_metrics: ZoneMetrics = ZoneMetrics()


def enter_zone(zone: Zone, reason: str) -> ZoneEntered:
    """Enter a zone and emit a ZoneEntered event."""
    global _current_zone
    ev = ZoneEntered(zone=zone, reason=reason)
    _current_zone = zone
    _zone_metrics.transition_count += 1
    _zone_metrics.last_zone = zone
    return ev


def get_current_zone() -> Zone:
    """Return the current zone."""
    return _current_zone


def get_zone_metrics() -> ZoneMetrics:
    """Return current zone metrics."""
    return _zone_metrics


def _reset_for_test() -> None:
    """Reset zone state for testing. Called by tests only."""
    global _current_zone, _zone_metrics
    _current_zone = Zone.A
    _zone_metrics = ZoneMetrics()
