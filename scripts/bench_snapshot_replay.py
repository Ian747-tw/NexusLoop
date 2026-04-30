from __future__ import annotations

import json
import tempfile
import time
from pathlib import Path

from nxl_core.events.snapshot import project_event_log, replay_from_snapshot, write_snapshot


def event_id(n: int) -> str:
    return f"01H{n:022d}"


def write_events(path: Path, count: int) -> None:
    lines: list[str] = []
    for i in range(1, count + 1):
        event = (
            {"event_id": event_id(i), "kind": "hypothesis_created", "hypothesis_id": "h-1"}
            if i == 1
            else {"event_id": event_id(i), "kind": "evidence_collected", "hypothesis_id": "h-1", "value": 1}
            if i == 2
            else {"event_id": event_id(i), "kind": "zone_entered", "zone": "B", "reason": "promote"}
            if i == 3
            else {"event_id": event_id(i), "kind": "subagent_completed", "subagent_type": "noop"}
        )
        if i % 2 == 0:
            lines.append(json.dumps({"event_id": event["event_id"], "event": event}))
        else:
            lines.append(json.dumps(event))
    path.write_text("\n".join(lines) + "\n")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="nxl-bench-snapshot-") as tmp:
        project = Path(tmp)
        events_path = project / ".nxl" / "events.jsonl"
        events_path.parent.mkdir(parents=True, exist_ok=True)
        write_events(events_path, 10_000)

        lines = events_path.read_text().splitlines()
        prefix_events_path = project / ".nxl" / "events-prefix.jsonl"
        prefix_events_path.write_text("\n".join(lines[:9000]) + "\n")
        prefix_state = project_event_log(prefix_events_path)
        snapshot_path = write_snapshot(events_path, prefix_state, event_id(9000), 9000)

        start_full = time.perf_counter()
        full_state = project_event_log(events_path)
        full_ms = (time.perf_counter() - start_full) * 1000

        start_snapshot = time.perf_counter()
        snap_state = replay_from_snapshot(snapshot_path, events_path)
        snapshot_ms = (time.perf_counter() - start_snapshot) * 1000

        print(f"full_replay_ms={full_ms:.2f}")
        print(f"snapshot_replay_ms={snapshot_ms:.2f}")
        print(f"states_equal={full_state == snap_state}")

        if full_state != snap_state:
            return 1
        if snapshot_ms >= 500:
            return 2
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
