"""
M0.5 Step 2: Compact + index generators.

spec_compact.md and spec_index.json generators from typed ProjectSpec.

Phase C.1: Extended to use typed sections (project, budgets, operations, context).
"""
from __future__ import annotations

import json
from pathlib import Path

from nxl_core.spec.model import ProjectSpec


def spec_compact_md(spec: ProjectSpec) -> str:
    """Generate a compact markdown summary from ProjectSpec."""
    lines = [
        f"# {spec.project.name}",
        "",
        f"**Mode:** {spec.project.mode}",
        f"**Metric:** {spec.project.metric}",
    ]
    return "\n".join(lines)


def spec_index_json(spec: ProjectSpec, *, out_path: Path | None = None) -> str:
    """
    Generate a structured JSON index from ProjectSpec.

    If out_path is given, writes to that file as well.
    Returns the JSON string.
    """
    data = {
        "name": spec.project.name,
        "mode": spec.project.mode,
        "metric": spec.project.metric,
    }
    output = json.dumps(data, indent=2)
    if out_path is not None:
        Path(out_path).write_text(output)
    return output
