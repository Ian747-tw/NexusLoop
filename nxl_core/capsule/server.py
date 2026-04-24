"""IPC server for capsule/compact requests from agentcore TS."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Union

from nxl_core.capsule.compact import soft_trim, hard_regen, clear_handoff, CompactionEvent
from nxl_core.capsule.resume import build as build_capsule_impl, ResumeCapsule


# Wrap build to return a capsule-like object with prefix/cache_break
def build_capsule(cycle_id: str) -> tuple[str, str]:
    """
    Build a capsule for the given cycle_id.

    cycle_id is used as a file path stem; the actual event source is
    resolved via the standard resume mechanism.
    Returns (prefix, cache_break) tuple.
    """
    # cycle_id is treated as a lightweight key; we construct a minimal
    # in-memory cursor for the build function
    from io import StringIO
    cursor_file = Path("/dev/stdin")  # placeholder; build() reads a Path
    # Actually use a temp file approach to avoid stdin issues in IPC
    import tempfile
    with tempfile.NamedTemporaryFile(mode='w', suffix='.evtcursor', delete=False) as f:
        f.write("0\n")  # cursor at 0
        f.write(json.dumps({"kind": "MissionDeclared", "data": {"mission": cycle_id}}) + "\n")
        temp_path = Path(f.name)

    try:
        capsule_bytes = build_capsule_impl(temp_path)
        capsule_str = capsule_bytes.decode("utf-8")
        # Build a simple prefix from the capsule sections
        prefix = capsule_str  # already formatted as # section: value lines
        return (prefix, "")
    finally:
        temp_path.unlink(missing_ok=True)


def handle_request(raw: str) -> dict:
    msg = json.loads(raw)
    action = msg.pop('action', None)

    if action == 'capsule':
        cycle_id = msg.get('cycle_id', '')
        prefix, cache_break = build_capsule(cycle_id)
        return {
            'prefix': prefix,
            'cache_break': cache_break,
        }

    elif action == 'compact':
        events = msg.get('events', [])
        tier = msg.get('tier_hint', 'soft')

        if tier == 'soft':
            result = soft_trim(events)
        elif tier == 'hard':
            result = hard_regen(events)
        elif tier == 'clear':
            result = clear_handoff(events)
        else:
            result = soft_trim(events)

        return {
            'new_prefix': _events_to_prefix(result.preserved_events),
            'new_cache_break': '',
            'events_emitted': result.count,
        }

    return {'error': 'unknown action'}


def _events_to_prefix(events: list[dict]) -> str:
    """Render events as XML-ish prefix string."""
    parts = [f'<events count="{len(events)}">']
    for e in events:
        parts.append(f'  <event kind="{e.get("kind","?")}"/>')
    parts.append('</events>')
    return '\n'.join(parts)


if __name__ == '__main__':
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        result = handle_request(line)
        print(json.dumps(result), flush=True)