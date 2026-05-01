"""
nxl_core.spec.model
------------------
ProjectSpec — Pydantic model matching project.yaml schema.

Round-trips through YAML via from_yaml / to_yaml class methods.

Phase C.1: Extensibility additions:
- Each typed section has a `custom: dict[str, Any]` field
- Sections: ProjectSection, BudgetsSection, OperationsSection, Context
- All custom fields included in `spec_hash` computation
- Each section uses `model_config = ConfigDict(extra="forbid")` for typed fields
"""
from __future__ import annotations

import hashlib
from typing import Any, Literal

import yaml

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Section models
# ---------------------------------------------------------------------------


class ProjectSection(BaseModel):
    """Project metadata section: name, mode, metric."""

    model_config = ConfigDict(extra="forbid")

    name: str
    mode: Literal["explore", "improve", "test"]
    metric: str
    custom: dict[str, Any] = Field(default_factory=dict)


class BudgetsSection(BaseModel):
    """Budget allocations section."""

    model_config = ConfigDict(extra="forbid")

    total_calls: int | None = None
    total_tokens: int | None = None
    custom: dict[str, Any] = Field(default_factory=dict)


class OperationsSection(BaseModel):
    """Operations configuration section."""

    model_config = ConfigDict(extra="forbid")

    default_provider: str | None = None
    custom: dict[str, Any] = Field(default_factory=dict)


class Context(BaseModel):
    """Context section with known issues, quirks, and prior work notes."""

    model_config = ConfigDict(extra="forbid")

    known_issues: list[str] = Field(default_factory=list)
    quirks: list[str] = Field(default_factory=list)
    prior_work_notes: str = ""
    custom: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# ProjectSpec
# ---------------------------------------------------------------------------


def canonical_spec_hash(data: Any) -> int:
    """Deterministic hash of canonical YAML content, stable across processes."""
    canonical_yaml = yaml.safe_dump(data, sort_keys=True)
    digest = hashlib.sha256(canonical_yaml.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big", signed=False)


class ProjectSpec(BaseModel):
    """Research project specification — matches project.yaml schema."""

    model_config = ConfigDict(extra="forbid")

    project: ProjectSection
    budgets: BudgetsSection | None = None
    operations: OperationsSection | None = None
    context: Context | None = None
    custom: dict[str, Any] = Field(default_factory=dict)

    @property
    def spec_hash(self) -> int:
        """
        Hash of the canonical YAML representation including all custom fields.

        Custom fields in any section affect the hash to detect configuration
        drift in handoff/resume scenarios.

        Uses the same deterministic algorithm as HandoffRecord.verify_spec.
        """
        data = self.model_dump()
        return canonical_spec_hash(data)

    @classmethod
    def from_yaml(cls, yaml_text: str) -> "ProjectSpec":
        """Parse a ProjectSpec from YAML text."""
        data = yaml.safe_load(yaml_text)
        return cls.model_validate(data)

    def to_yaml(self) -> str:
        """Serialize this ProjectSpec to YAML text."""
        return yaml.safe_dump(
            self.model_dump(),
            default_flow_style=False,
            sort_keys=False,
        )
