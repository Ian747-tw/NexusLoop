"""nxl/core/resume.py — thin wrapper over HandoffRecord + ResumeCapsule."""
from __future__ import annotations

from pathlib import Path
from nxl.cli import console
from nxl_core.capsule.handoff import HandoffRecord
from nxl_core.capsule.resume import ResumeCapsule


def run(
    project_dir: Path,
    parallel: int = 1,
    dry_run: bool = False,
    no_run: bool = False,
    agent_backend: str = "auto",
    message: str = "",
) -> int:
    """Resume a dropped session from HandoffRecord."""

    config_dir = project_dir / ".nxl"
    if not config_dir.is_dir():
        console("No .nxl/ directory found. Run `nxl init` first.", "error")
        return 1

    events_path = config_dir / "events.jsonl"
    if not events_path.exists() or events_path.stat().st_size == 0:
        console(
            "No resume checkpoint found yet. Run `nxl run` to start your first session.",
            "info",
        )
        return 0

    # Step 1: Load latest HandoffRecord (skip if file is empty)
    try:
        handoff = HandoffRecord.load_latest(events_path)
    except ValueError:
        console(
            "No handoff record found. Run `nxl run` to start a session.",
            "info",
        )
        return 0

    # Step 2: Verify spec_hash matches current project.yaml
    # Always verify - if project.yaml doesn't exist, treat as mismatch
    project_yaml = project_dir / "project.yaml"
    verified = handoff.verify_spec(project_yaml)
    if not verified:
        console(
            "Spec mismatch: project.yaml has changed since last session.\n"
            "Run `nxl run` to start fresh, or resolve the spec conflict.",
            "error",
        )
        return 1

    # Step 3: Regenerate ResumeCapsule from handoff.event_cursor
    capsule = ResumeCapsule.regenerate(handoff.event_cursor)

    # Step 4: If --message provided, append to volatile tail (conflict -> new wins)
    if message:
        capsule = _merge_message(capsule, message)

    # Step 5: If --no-run, just report and exit
    if no_run:
        console(f"Handoff {handoff.id} loaded. Resume capsule regenerated.", "info")
        return 0

    # Step 6: Inject synthetic /resume <handoff_id> and start cycle
    console("Resuming from handoff...", "info")
    # TODO: Wire to cycle via intervention-hook
    return 0


def _merge_message(capsule: ResumeCapsule, message: str) -> ResumeCapsule:
    """Append --message to volatile tail; conflict → new wins."""
    import dataclasses

    return dataclasses.replace(capsule, volatile_tail=message)
