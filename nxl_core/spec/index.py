"""
nxl_core.spec.index
------------------
Generators: spec_compact_md() and spec_index_json() from ProjectSpec.
"""
from __future__ import annotations

import json
from pathlib import Path

from nxl_core.spec.model import ProjectSpec


def spec_compact_md(spec: ProjectSpec) -> str:
    """Generate a compact markdown summary from ProjectSpec."""
    lines = [
        f"# {spec.name}",
        "",
        f"**Mode:** {spec.mode}",
        f"**Metric:** {spec.metric}",
    ]
    return "\n".join(lines)


def spec_index_json(spec: ProjectSpec, *, out_path: Path | None = None) -> str:
    """
    Generate a structured JSON index from ProjectSpec.

    If out_path is given, writes to that file as well.
    Returns the JSON string.
    """
    data = {
        "name": spec.name,
        "mode": spec.mode,
        "metric": spec.metric,
    }
    output = json.dumps(data, indent=2)
    if out_path is not None:
        Path(out_path).write_text(output)
    return output
