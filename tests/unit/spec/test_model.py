"""
M0.5 Step 1: ProjectSpec Pydantic model with YAML round-trip.

ProjectSpec matches project.yaml schema and round-trips through YAML
with byte-identical output.

Phase C.1: Extended to use typed sections (project, budgets, operations, context).
"""
from __future__ import annotations

from pathlib import Path


from nxl_core.spec.model import ProjectSpec


class TestProjectSpecRoundTrip:
    """project.yaml loads → dumps → reloads → byte-identical."""

    def test_minimal_yaml_roundtrip(self) -> None:
        """A minimal project.yaml round-trips identically."""
        yaml_content = "project:\n  name: demo-project\n  mode: explore\n  metric: reward\n"
        spec = ProjectSpec.from_yaml(yaml_content)
        assert spec.project.name == "demo-project"
        assert spec.project.mode == "explore"
        dumped = spec.to_yaml()
        reloaded = ProjectSpec.from_yaml(dumped)
        assert reloaded.project.name == spec.project.name
        assert reloaded.project.mode == spec.project.mode
        assert reloaded.project.metric == spec.project.metric

    def test_full_yaml_roundtrip(self) -> None:
        """A full-featured project.yaml round-trips identically."""
        yaml_content = Path(
            "tests/e2e_user/fixtures/sample_project.yaml"
        ).read_text()
        spec = ProjectSpec.from_yaml(yaml_content)
        dumped = spec.to_yaml()
        reloaded = ProjectSpec.from_yaml(dumped)
        assert reloaded.project.name == spec.project.name
        assert reloaded.project.metric == spec.project.metric

    def test_roundtrip_byte_identical(self) -> None:
        """Dumped YAML must be byte-for-byte identical when reloaded."""
        yaml_content = (
            "project:\n  name: test-project\n  mode: improve\n  metric: accuracy\n"
        )
        spec = ProjectSpec.from_yaml(yaml_content)
        dumped = spec.to_yaml()
        reloaded = ProjectSpec.from_yaml(dumped)
        redumped = reloaded.to_yaml()
        assert redumped == dumped


class TestProjectSpecFields:
    """ProjectSpec has required fields: project section with name, mode, metric."""

    def test_required_fields(self) -> None:
        spec = ProjectSpec(
            project={"name": "my-project", "mode": "improve", "metric": "f1"},
        )
        assert spec.project.name == "my-project"
        assert spec.project.mode == "improve"
        assert spec.project.metric == "f1"

    def test_mode_values(self) -> None:
        for mode in ("explore", "improve", "test"):
            spec = ProjectSpec(project={"name": "p", "mode": mode, "metric": "m"})
            assert spec.project.mode == mode
