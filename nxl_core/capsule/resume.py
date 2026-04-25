"""
nxl_core.capsule.resume
-----------------------
ResumeCapsule: 10-section context snapshot (≤2000t) for agent resumption.

build(event_cursor) reads events from cursor position and produces
a byte-identical capsule (pure function, deterministic).

regenerate(event_cursor) is the classmethod interface — same semantics.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SECTION_NAMES: tuple[str, ...] = (
    "mission",
    "current_hypothesis",
    "progress_notes",
    "pending_tasks",
    "blocked_by",
    "next_steps_3",
    "tool_results",
    "decision_log",
    "quality_notes",
    "synthesis",
)


@dataclass(frozen=True)
class ResumeCapsule:
    """10-section context snapshot for agent resumption."""

    SECTIONS: tuple[str, ...] = (
        "mission",
        "current_hypothesis",
        "progress_notes",
        "pending_tasks",
        "blocked_by",
        "next_steps_3",
        "tool_results",
        "decision_log",
        "quality_notes",
        "synthesis",
    )

    mission: str = ""
    current_hypothesis: str = ""
    progress_notes: str = ""
    pending_tasks: str = ""
    blocked_by: str = ""
    next_steps_3: str = ""
    tool_results: str = ""
    decision_log: str = ""
    quality_notes: str = ""
    synthesis: str = ""
    volatile_tail: str = ""

    def to_bytes(self) -> bytes:
        """Serialize capsule to bytes (for deterministic comparison)."""
        lines = [
            f"# {name}: {getattr(self, name) or '(empty)'}"
            for name in self.SECTIONS
        ]
        return "\n".join(lines).encode("utf-8")

    @classmethod
    def regenerate(cls, event_cursor: list[dict]) -> "ResumeCapsule":
        """Regenerate capsule from event cursor — byte-identical to original."""
        capsule = _reconstruct_capsule(event_cursor)
        return cls(
            mission=capsule.mission or "(not declared)",
            current_hypothesis=capsule.current_hypothesis or "(none)",
            progress_notes=capsule.progress_notes or "(no progress notes)",
            pending_tasks=capsule.pending_tasks or "(none)",
            blocked_by=capsule.blocked_by or "(none)",
            next_steps_3=capsule.next_steps_3 or "(not planned)",
            tool_results=capsule.tool_results or "(none)",
            decision_log=capsule.decision_log or "(none)",
            quality_notes=capsule.quality_notes or "(none)",
            synthesis=capsule.synthesis or "(not synthesized)",
            volatile_tail=capsule.volatile_tail or "",
        )


def _reconstruct_capsule(events: list[dict]) -> ResumeCapsule:
    """Reconstruct capsule state from event dicts."""
    mission = ""
    current_hypothesis = ""
    progress_notes = ""
    pending_tasks = ""
    blocked_by = ""
    next_steps_3 = ""
    tool_results: list[str] = []
    decision_log: list[str] = []
    quality_notes = ""
    synthesis = ""

    for event in events:
        kind = event.get("kind", "")
        data: dict[str, Any] = event.get("data", {})

        if kind == "MissionDeclared":
            mission = data.get("mission", "")
        elif kind == "HypothesisFormed":
            current_hypothesis = data.get("hypothesis", "")
        elif kind == "ProgressNoted":
            note = data.get("note", "")
            progress_notes = (progress_notes + "\n" + note).strip()
        elif kind == "TaskSpawned":
            task = data.get("description", "")
            pending_tasks = (pending_tasks + "\n- " + task).strip()
        elif kind == "TaskBlocked":
            blocker = data.get("reason", "")
            blocked_by = (blocked_by + "\n- " + blocker).strip()
        elif kind == "PathForward":
            steps = data.get("steps", [])
            steps_str = "\n".join(f"{i+1}. {s}" for i, s in enumerate(steps[:3]))
            next_steps_3 = steps_str
        elif kind == "ToolResult":
            tool = data.get("tool", "")
            result = data.get("result", "")
            tool_results.append(f"[{tool}] {result}")
        elif kind == "DecisionRecorded":
            decision = data.get("decision", "")
            rationale = data.get("rationale", "")
            decision_log.append(f"- {decision} ({rationale})")
        elif kind == "QualityNote":
            note = data.get("note", "")
            quality_notes = (quality_notes + "\n" + note).strip()
        elif kind == "SynthesisUpdated":
            synthesis = data.get("summary", "")

    # Truncate to last 5 entries
    tr = "\n".join(tool_results[-5:]) if tool_results else "(none)"
    dl = "\n".join(decision_log[-5:]) if decision_log else "(none)"

    return ResumeCapsule(
        mission=mission or "(not declared)",
        current_hypothesis=current_hypothesis or "(none)",
        progress_notes=progress_notes or "(no progress notes)",
        pending_tasks=("\n- " + pending_tasks).strip() if pending_tasks else "(none)",
        blocked_by=("\n- " + blocked_by).strip() if blocked_by else "(none)",
        next_steps_3=next_steps_3 or "(not planned)",
        tool_results=tr,
        decision_log=dl,
        quality_notes=quality_notes or "(none)",
        synthesis=synthesis or "(not synthesized)",
    )


def _reconstruct_capsule_from_lines(event_lines: list[str], cursor_index: int) -> ResumeCapsule:
    """Reconstruct capsule from JSON string lines (legacy file format)."""
    events_to_process = event_lines[cursor_index:]
    parsed = []
    for line in events_to_process:
        if not line.strip():
            continue
        try:
            parsed.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return _reconstruct_capsule(parsed)


def build(event_cursor: Path) -> bytes:
    """
    Read events from event_cursor position and build a ResumeCapsule.

    event_cursor: Path to a file containing:
      - Line 1: integer event index (0 = from beginning)
      - Remaining content: event log entries as JSON lines

    Returns capsule bytes — byte-identical for same cursor content.
    """
    content = event_cursor.read_text()
    if not content.strip():
        event_lines: list[str] = []
    else:
        first_line, *rest = content.splitlines()
        cursor_index = int(first_line.strip())
        event_lines = rest

    capsule = _reconstruct_capsule_from_lines(event_lines, cursor_index)
    return capsule.to_bytes()
