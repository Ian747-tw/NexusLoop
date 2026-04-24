"""
M0.5 Step 2: Compact + index generators.

spec_compact.md and spec_index.json generators from typed ProjectSpec.
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path


from nxl_core.spec.index import spec_compact_md, spec_index_json
from nxl_core.spec.model import ProjectSpec


class TestSpecCompactMd:
    """spec_compact_md() generates a compact markdown summary from ProjectSpec."""

    def test_contains_project_name(self) -> None:
        spec = ProjectSpec(name="my-project", mode="explore", metric="reward")
        output = spec_compact_md(spec)
        assert "my-project" in output

    def test_contains_mode(self) -> None:
        spec = ProjectSpec(name="p", mode="improve", metric="accuracy")
        output = spec_compact_md(spec)
        assert "improve" in output

    def test_returns_markdown(self) -> None:
        spec = ProjectSpec(name="test", mode="test", metric="loss")
        output = spec_compact_md(spec)
        assert output.startswith("#")


class TestSpecIndexJson:
    """spec_index_json() generates a structured JSON index from ProjectSpec."""

    def test_contains_name(self) -> None:
        spec = ProjectSpec(name="my-project", mode="explore", metric="reward")
        output = spec_index_json(spec)
        data = json.loads(output)
        assert data["name"] == "my-project"

    def test_contains_mode_and_metric(self) -> None:
        spec = ProjectSpec(name="p", mode="improve", metric="f1")
        output = spec_index_json(spec)
        data = json.loads(output)
        assert data["mode"] == "improve"
        assert data["metric"] == "f1"

    def test_is_valid_json(self) -> None:
        spec = ProjectSpec(name="test", mode="test", metric="m")
        output = spec_index_json(spec)
        # Must not raise
        json.loads(output)

    def test_writes_to_path(self) -> None:
        spec = ProjectSpec(name="p", mode="explore", metric="reward")
        with tempfile.TemporaryDirectory() as tmpdir:
            out_path = Path(tmpdir) / "index.json"
            spec_index_json(spec, out_path=out_path)
            assert out_path.exists()
            data = json.loads(out_path.read_text())
            assert data["name"] == "p"
