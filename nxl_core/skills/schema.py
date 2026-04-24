"""
nxl_core.skills.schema
----------------------
SkillDef — Pydantic model for YAML skill definitions.

Supports validation, YAML round-trips, and step-count enforcement.
"""
from __future__ import annotations

from typing import Literal

import yaml

from pydantic import BaseModel, Field, model_validator


class SkillStep(BaseModel):
    """A single step within a skill definition."""

    action: str
    args: dict[str, str] = Field(default_factory=dict)
    description: str = ""


class SkillDef(BaseModel):
    """YAML skill definition schema — matches skills/*.yaml files."""

    name: str  # must match filename stem
    description: str
    triggers: list[Literal["manual", "auto_on_plateau", "auto_on_failure"]]
    inputs: dict[str, str]  # {param: type}
    outputs: dict[str, str]
    steps: list[SkillStep]  # max 40
    budgets: dict = Field(default_factory=dict)  # budget allocations

    @model_validator(mode="after")
    def validate_step_count(self) -> "SkillDef":
        """Reject skills with more than 40 steps."""
        if len(self.steps) > 40:
            raise ValueError(f"Skill {self.name} has {len(self.steps)} steps (max 40)")
        return self

    @classmethod
    def from_yaml(cls, yaml_text: str) -> "SkillDef":
        """Parse a SkillDef from YAML text."""
        data = yaml.safe_load(yaml_text)
        return cls.model_validate(data)