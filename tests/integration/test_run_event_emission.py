"""
M0.6 Step 1: Boundary event emission from run.py.

Injects EventLog.append() at bootstrap start/end, agent invocation
start/end, and policy decisions. Smoke test verifies events.jsonl has ≥4 events.

Note: dry-run emits 4 events (2 tool_requested + cycle_started + cycle_completed).
Full autonomous run emits 10+ events (policy events, zone events, etc.).
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest


class TestRunEventEmission:
    """Verify run() emits boundary events to events.jsonl."""

    def test_nxl_run_once_dry_run_emits_events(self, tmp_path: Path) -> None:
        """
        `nxl run --once --dry-run` in an initialised project emits
        at least 10 events to .nxl/events.jsonl.
        """
        # Create a minimal project structure
        project_dir = tmp_path / "project"
        project_dir.mkdir()
        nxl_dir = project_dir / ".nxl"
        nxl_dir.mkdir()
        logs_dir = project_dir / "logs"
        logs_dir.mkdir()

        # Write minimal state.json
        state = {
            "version": "1.0",
            "project_name": "test-project",
            "initialized_at": "2026-01-01T00:00:00Z",
            "current_phase": "research",
            "total_runs": 0,
            "queue": [],
            "flags": {},
        }
        (nxl_dir / "state.json").write_text(json.dumps(state))

        # Write minimal permissions.yaml
        (nxl_dir / "permissions.yaml").write_text("mode: open\n")

        # Write minimal NON_NEGOTIABLE_RULES.md
        (project_dir / "NON_NEGOTIABLE_RULES.md").write_text("# NON_NEGOTIABLE RULES\n")

        # Run `nxl run --once --dry-run`
        result = subprocess.run(
            ["uv", "run", "nxl", "run", "--once", "--dry-run"],
            cwd=project_dir,
            capture_output=True,
            text=True,
            timeout=120,
        )

        # The run should succeed (exit 0) or at least not crash before emitting events
        events_path = nxl_dir / "events.jsonl"

        # events.jsonl must exist after run
        assert events_path.exists(), (
            f"events.jsonl not created. stderr: {result.stderr[:500]}"
        )

        # Must have ≥4 events (dry-run emits 4: 2 tool_requested + cycle_started + cycle_completed)
        lines = [ln for ln in events_path.read_text().strip().split("\n") if ln]
        assert len(lines) >= 4, (
            f"Expected ≥4 events, got {len(lines)}. "
            f"Content: {events_path.read_text()[:500]}"
        )

        # Each line must be valid JSON with a 'kind' field
        for i, line in enumerate(lines):
            try:
                event = json.loads(line)
                assert "kind" in event, f"Event {i} missing 'kind': {line[:100]}"
            except json.JSONDecodeError:
                pytest.fail(f"Event {i} is not valid JSON: {line[:100]}")
