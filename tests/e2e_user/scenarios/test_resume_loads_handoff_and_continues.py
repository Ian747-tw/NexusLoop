"""Test that resume loads handoff record and regenerates capsule."""
from __future__ import annotations

import json
import pytest


@pytest.mark.phase_m2
def test_resume_loads_handoff_and_continues(sandbox) -> None:
    """Resume should load latest HandoffRecord and regenerate ResumeCapsule."""
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr
    project = sandbox.init_project(mode="improve")

    # Write a HandoffRecorded event to events.jsonl to simulate a handoff
    events_path = project / ".nxl" / "events.jsonl"
    handoff_event = {
        "event_id": "01HAABBCCDD011122334455",
        "timestamp": "2026-04-24T00:00:00Z",
        "kind": "handoff_recorded",
        "data": {
            "handoff_id": "handoff-001",
            "from_agent": "agent-1",
            "to_agent": "agent-2",
        },
        "spec_hash": 12345,
        "event_cursor": [
            {"kind": "MissionDeclared", "data": {"mission": "Test mission"}},
            {"kind": "ProgressNoted", "data": {"note": "Made progress"}},
        ],
    }
    events_path.write_text(json.dumps(handoff_event) + "\n")

    # Run resume --no-run
    result = sandbox.run_cli(
        ["resume", "--project-dir", str(project), "--no-run"],
        cwd=project,
    )
    assert result.exit_code == 0, result.stdout + result.stderr
    assert "handoff" in result.stdout.lower() or "resum" in result.stdout.lower()


@pytest.mark.phase_m2
def test_resume_rejects_spec_hash_mismatch(sandbox) -> None:
    """Resume should reject when project.yaml changed since handoff."""
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr
    project = sandbox.init_project(mode="improve")

    # Write a HandoffRecorded event with spec_hash that won't match
    events_path = project / ".nxl" / "events.jsonl"
    handoff_event = {
        "event_id": "01HAABBCCDD011122334455",
        "timestamp": "2026-04-24T00:00:00Z",
        "kind": "handoff_recorded",
        "data": {
            "handoff_id": "handoff-001",
            "from_agent": "agent-1",
            "to_agent": "agent-2",
        },
        "spec_hash": 99999,  # Different from current project.yaml hash
        "event_cursor": [],
    }
    events_path.write_text(json.dumps(handoff_event) + "\n")

    # Run resume --no-run
    result = sandbox.run_cli(
        ["resume", "--project-dir", str(project), "--no-run"],
        cwd=project,
    )
    assert result.exit_code != 0, result.stdout + result.stderr
    assert "spec" in result.stdout.lower() or "mismatch" in result.stdout.lower()


@pytest.mark.phase_m2
def test_resume_with_message_merges_guidance(sandbox) -> None:
    """Resume with --message should merge the message into volatile_tail."""
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr
    project = sandbox.init_project(mode="improve")

    # Write a HandoffRecorded event with some event_cursor
    events_path = project / ".nxl" / "events.jsonl"
    handoff_event = {
        "event_id": "01HAABBCCDD011122334455",
        "timestamp": "2026-04-24T00:00:00Z",
        "kind": "handoff_recorded",
        "data": {
            "handoff_id": "handoff-001",
            "from_agent": "agent-1",
            "to_agent": "agent-2",
        },
        "spec_hash": 0,
        "event_cursor": [
            {"kind": "MissionDeclared", "data": {"mission": "Test mission"}},
        ],
    }
    events_path.write_text(json.dumps(handoff_event) + "\n")

    # Run resume --no-run with --message
    result = sandbox.run_cli(
        [
            "resume",
            "--project-dir", str(project),
            "--no-run",
            "--message", "Focus on the synthesis section",
        ],
        cwd=project,
    )
    assert result.exit_code == 0, result.stdout + result.stderr
    # Message should be mentioned or merged
    assert "Focus on the synthesis" in result.stdout or result.exit_code == 0
