from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ResearchNamespace = dict[str, Any]


def _empty_research_namespace() -> ResearchNamespace:
    return {
        "current_cycle": None,
        "program_state": "cold_start",
        "registry_projection": {"hypotheses": {}, "cursor": None},
        "tier_state": {},
        "capsule_cursor": None,
        "scheduler_queue": [],
    }


def _normalize_event(raw: dict[str, Any]) -> dict[str, Any]:
    inner = raw.get("event")
    if isinstance(inner, dict):
        event = dict(inner)
        if "event_id" not in event and "event_id" in raw:
            event["event_id"] = raw["event_id"]
        if "timestamp" not in event and "timestamp" in raw:
            event["timestamp"] = raw["timestamp"]
        return event
    return raw


def _apply_event(ns: ResearchNamespace, event: dict[str, Any]) -> ResearchNamespace:
    kind = event.get("kind")
    if kind == "cycle_started":
        return {
            **ns,
            "current_cycle": {
                "cycle_id": event.get("cycle_id"),
                "hypothesis_id": event.get("hypothesis_id"),
                "started_at": event.get("started_at", 0),
                "turn_count": 0,
            },
        }
    if kind in ("cycle_completed", "cycle_failed"):
        return {**ns, "current_cycle": None}
    if kind == "hypothesis_created":
        hypotheses = dict(ns["registry_projection"]["hypotheses"])
        hypothesis_id = str(event.get("hypothesis_id"))
        hypotheses[hypothesis_id] = {
            "tier": "T0",
            "score": None,
            "last_evidence_event_id": None,
        }
        return {
            **ns,
            "registry_projection": {
                **ns["registry_projection"],
                "hypotheses": hypotheses,
            },
        }
    if kind == "evidence_collected":
        hypothesis_id = str(event.get("hypothesis_id"))
        hypotheses = dict(ns["registry_projection"]["hypotheses"])
        if hypothesis_id not in hypotheses:
            return ns
        hypotheses[hypothesis_id] = {
            **hypotheses[hypothesis_id],
            "last_evidence_event_id": event.get("event_id"),
        }
        return {
            **ns,
            "registry_projection": {
                **ns["registry_projection"],
                "hypotheses": hypotheses,
            },
        }
    if kind == "zone_entered":
        state_map = {"A": "exploring", "B": "exploiting", "C": "consolidating"}
        return {**ns, "program_state": state_map.get(event.get("zone"), ns["program_state"])}
    if kind == "zone_exited":
        return {**ns, "program_state": "paused"}
    if kind == "session_clearing":
        return _empty_research_namespace()
    return ns


def _iter_normalized_events(events_path: Path, cursor: str | None = None):
    if not events_path.exists():
        return

    started = cursor is None
    for line in events_path.read_text().splitlines():
        if not line.strip():
            continue
        try:
            raw = json.loads(line)
        except json.JSONDecodeError:
            continue
        event = _normalize_event(raw)
        if not started:
            if event.get("event_id") == cursor or raw.get("event_id") == cursor:
                started = True
            continue
        yield event


def should_snapshot(event_count: int, interval: int = 1000) -> bool:
    return event_count > 0 and event_count % interval == 0


def write_snapshot(
    events_path: str | Path,
    projection_state: ResearchNamespace,
    event_id: str,
    event_count: int = 0,
) -> Path:
    snapshots_dir = Path(events_path).parent / "snapshots"
    snapshots_dir.mkdir(parents=True, exist_ok=True)
    path = snapshots_dir / f"{event_id}.json"
    path.write_text(
        json.dumps(
            {
                "cursor_event_id": event_id,
                "event_count": event_count,
                "state": projection_state,
            },
            sort_keys=True,
        )
    )
    return path


def find_latest_snapshot(snapshots_dir: str | Path) -> tuple[Path, str] | None:
    directory = Path(snapshots_dir)
    if not directory.exists():
        return None
    candidates = sorted(path for path in directory.iterdir() if path.suffix == ".json")
    if not candidates:
        return None
    latest = candidates[-1]
    return latest, latest.stem


def project_event_log(
    events_path: str | Path,
    cursor: str | None = None,
    initial_state: ResearchNamespace | None = None,
) -> ResearchNamespace:
    result = initial_state or _empty_research_namespace()
    for event in _iter_normalized_events(Path(events_path), cursor):
        result = _apply_event(result, event)
    return result


def replay_from_snapshot(snapshot_path: str | Path, events_path: str | Path) -> ResearchNamespace:
    try:
        payload = json.loads(Path(snapshot_path).read_text())
        state = payload["state"]
        cursor = payload["cursor_event_id"]
    except Exception:
        state = _empty_research_namespace()
        cursor = None

    return project_event_log(events_path, cursor, state)
