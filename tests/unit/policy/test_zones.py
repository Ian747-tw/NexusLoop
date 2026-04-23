"""
M0.3 Step 4: Zone A/B/C transitions.

Zone A = exploration (open research, free experimentation)
Zone B = exploitation (focused iteration on best-known approach)
Zone C = verification (human review before key actions)

enter_zone(zone, reason) emits a ZoneEntered event.
transitions between zones follow explicit rules.
"""
from __future__ import annotations

import pytest

from nxl_core.policy.zones import (
    Zone,
    ZoneEntered,
    enter_zone,
    get_current_zone,
    _reset_for_test,
)


class TestZoneEnum:
    def test_all_zones_present(self) -> None:
        assert set(Zone) == {"A", "B", "C"}


class TestZoneEntered:
    def test_roundtrip(self) -> None:
        ev = ZoneEntered(zone=Zone.B, reason="shifted to focused iteration")
        blob = ev.model_dump_json()
        parsed = ZoneEntered.model_validate_json(blob)
        assert parsed.zone == Zone.B
        assert parsed.reason == "shifted to focused iteration"


class TestEnterZone:
    def test_enter_zone_a(self) -> None:
        _reset_for_test()
        ev = enter_zone(Zone.A, "starting exploration")
        assert ev.zone == Zone.A
        assert get_current_zone() == Zone.A

    def test_enter_zone_b(self) -> None:
        _reset_for_test()
        ev = enter_zone(Zone.B, "shifting to exploitation")
        assert ev.zone == Zone.B
        assert get_current_zone() == Zone.B

    def test_enter_zone_c(self) -> None:
        _reset_for_test()
        ev = enter_zone(Zone.C, "human review required")
        assert ev.zone == Zone.C
        assert get_current_zone() == Zone.C

    def test_zone_transition_a_to_b(self) -> None:
        _reset_for_test()
        enter_zone(Zone.A, "exploring")
        ev = enter_zone(Zone.B, "found promising approach")
        assert ev.zone == Zone.B

    def test_zone_transition_b_to_a(self) -> None:
        _reset_for_test()
        enter_zone(Zone.B, "exploiting")
        ev = enter_zone(Zone.A, "new hypothesis")
        assert ev.zone == Zone.A

    def test_zone_transition_b_to_c(self) -> None:
        _reset_for_test()
        enter_zone(Zone.B, "exploiting")
        ev = enter_zone(Zone.C, "need human review")
        assert ev.zone == Zone.C

    def test_zone_transition_c_to_b(self) -> None:
        _reset_for_test()
        enter_zone(Zone.C, "review")
        ev = enter_zone(Zone.B, "review complete")
        assert ev.zone == Zone.B

    def test_enter_same_zone_allowed(self) -> None:
        _reset_for_test()
        enter_zone(Zone.A, "exploring")
        ev = enter_zone(Zone.A, "continuing exploration")
        assert ev.zone == Zone.A


class TestZoneMetrics:
    def test_zone_counters_increment(self) -> None:
        _reset_for_test()
        from nxl_core.policy.zones import _zone_metrics
        before = _zone_metrics.transition_count
        enter_zone(Zone.B, "test transition")
        after = _zone_metrics.transition_count
        assert after == before + 1
