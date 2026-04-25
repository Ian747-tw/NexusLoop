"""
Phase C.1: ProjectSpec extensibility tests.

Tests:
- custom fields in typed sections
- unknown top-level key rejected
- unknown field in typed section rejected
- context top-level section present
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from nxl_core.spec.model import (
    BudgetsSection,
    Context,
    OperationsSection,
    ProjectSection,
    ProjectSpec,
)


class TestContextSection:
    """Context section model with known_issues, quirks, prior_work_notes, custom."""

    def test_context_with_all_fields(self) -> None:
        """Context can be constructed with all known fields."""
        ctx = Context(
            known_issues=["issue1", "issue2"],
            quirks=["quirk1", "quirk2"],
            prior_work_notes="Some prior work notes",
            custom={"foo": "bar"},
        )
        assert ctx.known_issues == ["issue1", "issue2"]
        assert ctx.quirks == ["quirk1", "quirk2"]
        assert ctx.prior_work_notes == "Some prior work notes"
        assert ctx.custom == {"foo": "bar"}

    def test_context_custom_default_empty(self) -> None:
        """Context custom field defaults to empty dict."""
        ctx = Context()
        assert ctx.custom == {}

    def test_context_quirks_default_empty_list(self) -> None:
        """Context quirks field defaults to empty list."""
        ctx = Context()
        assert ctx.quirks == []

    def test_context_prior_work_notes_default_empty(self) -> None:
        """Context prior_work_notes defaults to empty string."""
        ctx = Context()
        assert ctx.prior_work_notes == ""


class TestProjectSpecSections:
    """ProjectSpec with typed sections: project, budgets, operations, context."""

    def test_project_section_with_custom(self) -> None:
        """Project section accepts custom fields."""
        spec = ProjectSpec(
            project={"name": "test", "mode": "explore", "metric": "reward"},
            custom={"project_extra": "value"},
        )
        assert spec.project.name == "test"
        assert spec.custom == {"project_extra": "value"}

    def test_budgets_section_with_custom(self) -> None:
        """Budgets section accepts custom fields."""
        spec = ProjectSpec(
            project={"name": "test", "mode": "explore", "metric": "reward"},
            budgets={"total_calls": 100, "custom": {"budget_extra": "value"}},
        )
        assert spec.budgets.total_calls == 100
        assert spec.budgets.custom == {"budget_extra": "value"}

    def test_operations_section_with_custom(self) -> None:
        """Operations section accepts custom fields."""
        spec = ProjectSpec(
            project={"name": "test", "mode": "explore", "metric": "reward"},
            operations={"default_provider": "anthropic", "custom": {"ops_extra": "value"}},
        )
        assert spec.operations.default_provider == "anthropic"
        assert spec.operations.custom == {"ops_extra": "value"}

    def test_context_section_in_project_spec(self) -> None:
        """ProjectSpec accepts context section."""
        spec = ProjectSpec(
            project={"name": "test", "mode": "explore", "metric": "reward"},
            context={
                "known_issues": ["bug1"],
                "quirks": ["quirk1"],
                "prior_work_notes": "notes",
                "custom": {"ctx_extra": "value"},
            },
        )
        assert spec.context is not None
        assert spec.context.known_issues == ["bug1"]
        assert spec.context.quirks == ["quirk1"]
        assert spec.context.prior_work_notes == "notes"
        assert spec.context.custom == {"ctx_extra": "value"}

    def test_minimal_spec_with_defaults(self) -> None:
        """Minimal spec still works with required fields."""
        spec = ProjectSpec(project={"name": "test", "mode": "explore", "metric": "reward"})
        assert spec.project.name == "test"


class TestExtraFieldsForbid:
    """Typed sections forbid unknown fields via extra='forbid'."""

    def test_unknown_top_level_key_rejected(self) -> None:
        """Unknown top-level keys in project.yaml are rejected."""
        yaml_content = """
name: test
mode: explore
metric: reward
unknown_top_level: true
"""
        with pytest.raises(ValidationError) as exc_info:
            ProjectSpec.from_yaml(yaml_content)
        # Should fail on unknown field
        assert "unknown_top_level" in str(exc_info.value)

    def test_unknown_project_field_rejected(self) -> None:
        """Unknown fields within project section are rejected."""
        yaml_content = """
project:
  name: test
  mode: explore
  metric: reward
  unknown_field: true
"""
        with pytest.raises(ValidationError) as exc_info:
            ProjectSpec.from_yaml(yaml_content)
        assert "unknown_field" in str(exc_info.value)

    def test_unknown_budgets_field_rejected(self) -> None:
        """Unknown fields within budgets section are rejected."""
        yaml_content = """
project:
  name: test
  mode: explore
  metric: reward
budgets:
  total_calls: 100
  unknown_budget_field: true
"""
        with pytest.raises(ValidationError) as exc_info:
            ProjectSpec.from_yaml(yaml_content)
        assert "unknown_budget_field" in str(exc_info.value)

    def test_unknown_operations_field_rejected(self) -> None:
        """Unknown fields within operations section are rejected."""
        yaml_content = """
project:
  name: test
  mode: explore
  metric: reward
operations:
  default_provider: anthropic
  unknown_ops_field: true
"""
        with pytest.raises(ValidationError) as exc_info:
            ProjectSpec.from_yaml(yaml_content)
        assert "unknown_ops_field" in str(exc_info.value)

    def test_unknown_context_field_rejected(self) -> None:
        """Unknown fields within context section are rejected."""
        yaml_content = """
project:
  name: test
  mode: explore
  metric: reward
context:
  known_issues: []
  unknown_context_field: true
"""
        with pytest.raises(ValidationError) as exc_info:
            ProjectSpec.from_yaml(yaml_content)
        assert "unknown_context_field" in str(exc_info.value)


class TestSpecHashCustomFields:
    """Custom fields are included in spec_hash computation."""

    def test_custom_fields_affect_hash(self) -> None:
        """Different custom fields produce different hashes."""
        spec1 = ProjectSpec(
            project={"name": "test", "mode": "explore", "metric": "reward"},
            custom={"key": "value1"},
        )
        spec2 = ProjectSpec(
            project={"name": "test", "mode": "explore", "metric": "reward"},
            custom={"key": "value2"},
        )
        # Custom fields are included in spec_hash
        assert spec1.spec_hash != spec2.spec_hash

    def test_nested_custom_fields_affect_hash(self) -> None:
        """Custom fields in nested sections affect hash."""
        spec1 = ProjectSpec(
            project={"name": "test", "mode": "explore", "metric": "reward"},
            budgets={"custom": {"budget_key": "value1"}},
        )
        spec2 = ProjectSpec(
            project={"name": "test", "mode": "explore", "metric": "reward"},
            budgets={"custom": {"budget_key": "value2"}},
        )
        assert spec1.spec_hash != spec2.spec_hash

    def test_identical_specs_same_hash(self) -> None:
        """Identical specs produce identical hashes."""
        spec1 = ProjectSpec(
            project={"name": "test", "mode": "explore", "metric": "reward"},
            custom={"key": "value"},
        )
        spec2 = ProjectSpec(
            project={"name": "test", "mode": "explore", "metric": "reward"},
            custom={"key": "value"},
        )
        assert spec1.spec_hash == spec2.spec_hash


class TestYamlRoundtrip:
    """Extensible ProjectSpec still round-trips through YAML."""

    def test_roundtrip_with_all_sections(self) -> None:
        """Full spec with all sections round-trips."""
        yaml_content = """
project:
  name: test-project
  mode: improve
  metric: accuracy
budgets:
  total_calls: 1000
  total_tokens: 50000
  custom:
    budget_extra: budget_value
operations:
  default_provider: anthropic
  custom:
    ops_extra: ops_value
context:
  known_issues:
    - issue1
    - issue2
  quirks:
    - quirk1
  prior_work_notes: Some notes
  custom:
    ctx_extra: ctx_value
custom:
  top_extra: top_value
"""
        spec = ProjectSpec.from_yaml(yaml_content)
        dumped = spec.to_yaml()
        reloaded = ProjectSpec.from_yaml(dumped)
        assert reloaded.project.name == spec.project.name
        assert reloaded.budgets.total_calls == spec.budgets.total_calls
        assert reloaded.operations.default_provider == spec.operations.default_provider
        assert reloaded.context.known_issues == spec.context.known_issues
        assert reloaded.custom == spec.custom

    def test_roundtrip_minimal(self) -> None:
        """Minimal spec round-trips."""
        yaml_content = """
project:
  name: minimal
  mode: explore
  metric: reward
"""
        spec = ProjectSpec.from_yaml(yaml_content)
        dumped = spec.to_yaml()
        reloaded = ProjectSpec.from_yaml(dumped)
        assert reloaded.project.name == spec.project.name
