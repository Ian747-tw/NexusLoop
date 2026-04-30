from __future__ import annotations

import json
from pathlib import Path

from nxl_core.events.snapshot import (
    find_latest_snapshot,
    replay_from_snapshot,
    should_snapshot,
    write_snapshot,
)


def _event_id(n: int) -> str:
    return f"01H{n:022d}"


def _write_events(path: Path, count: int) -> None:
    lines: list[str] = []
    for i in range(1, count + 1):
        event = (
            {"event_id": _event_id(i), "kind": "hypothesis_created", "hypothesis_id": "h-1"}
            if i == 1
            else {"event_id": _event_id(i), "kind": "evidence_collected", "hypothesis_id": "h-1", "value": 1}
            if i == 2
            else {"event_id": _event_id(i), "kind": "zone_entered", "zone": "B", "reason": "promote"}
            if i == 3
            else {"event_id": _event_id(i), "kind": "subagent_completed", "subagent_type": "noop"}
        )
        if i % 2 == 0:
            lines.append(json.dumps({"event_id": event["event_id"], "event": event}))
        else:
            lines.append(json.dumps(event))
    path.write_text("\n".join(lines) + "\n")


def test_should_snapshot_default_interval() -> None:
    assert not should_snapshot(999)
    assert should_snapshot(1000)


def test_write_and_find_latest_snapshot(tmp_path: Path) -> None:
    events_path = tmp_path / ".nxl" / "events.jsonl"
    events_path.parent.mkdir(parents=True, exist_ok=True)
    write_snapshot(events_path, {"program_state": "cold_start"}, _event_id(10), 10)
    write_snapshot(events_path, {"program_state": "paused"}, _event_id(20), 20)

    latest = find_latest_snapshot(events_path.parent / "snapshots")
    assert latest is not None
    path, cursor = latest
    assert path.name == f"{_event_id(20)}.json"
    assert cursor == _event_id(20)


def test_replay_from_snapshot_applies_delta_events(tmp_path: Path) -> None:
    events_path = tmp_path / ".nxl" / "events.jsonl"
    events_path.parent.mkdir(parents=True, exist_ok=True)
    _write_events(events_path, 10)

    snapshot_path = write_snapshot(
        events_path,
        {
            "current_cycle": None,
            "program_state": "cold_start",
            "registry_projection": {
                "hypotheses": {"h-1": {"tier": "T0", "score": None, "last_evidence_event_id": None}},
                "cursor": None,
            },
            "tier_state": {},
            "capsule_cursor": None,
            "scheduler_queue": [],
        },
        _event_id(1),
        1,
    )

    replayed = replay_from_snapshot(snapshot_path, events_path)
    assert replayed["program_state"] == "exploiting"
    assert replayed["registry_projection"]["hypotheses"]["h-1"]["last_evidence_event_id"] == _event_id(2)
