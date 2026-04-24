"""nxl_core.capsule — ResumeCapsule, HandoffRecord, compaction."""
from nxl_core.capsule.compact import (
    CompactionEvent,
    CompactionType,
    clear_handoff,
    hard_regen,
    soft_trim,
)
from nxl_core.capsule.handoff import HandoffRecord
from nxl_core.capsule.resume import ResumeCapsule, build, _reconstruct_capsule

__all__ = [
    "clear_handoff",
    "CompactionEvent",
    "CompactionType",
    "hard_regen",
    "HandoffRecord",
    "ResumeCapsule",
    "soft_trim",
    "build",
    "_reconstruct_capsule",
]
