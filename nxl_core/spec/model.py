"""
nxl_core.spec.model
------------------
ProjectSpec — Pydantic model matching project.yaml schema.

Round-trips through YAML via from_yaml / to_yaml class methods.
"""
from __future__ import annotations

from typing import Literal

import yaml

from pydantic import BaseModel


class ProjectSpec(BaseModel):
    """Research project specification — matches project.yaml schema."""

    name: str
    mode: Literal["explore", "improve", "test"]
    metric: str

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
