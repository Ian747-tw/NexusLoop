"""
nxl_core.skills.registry
------------------------
SkillRegistry — loads and validates all YAML skills from a directory.
"""
from __future__ import annotations

from pathlib import Path

import yaml

from nxl_core.skills.schema import SkillDef


class DuplicateSkillNameError(Exception):
    """Raised when two skills have the same name."""

    def __init__(self, name: str, files: list[str]) -> None:
        self.name = name
        self.files = files
        super().__init__(
            f"Duplicate skill name '{name}' found in multiple files: {files}"
        )


class SkillLoadError(Exception):
    """Raised when a skill YAML is malformed."""

    def __init__(self, filename: str, reason: str) -> None:
        self.filename = filename
        self.reason = reason
        super().__init__(f"Failed to load skill from '{filename}': {reason}")


class SkillRegistry:
    """Loads and validates all YAML skills from a directory."""

    _skills: dict[str, SkillDef] = {}  # class-level shared registry

    def __init__(self) -> None:
        pass

    @classmethod
    def reset(cls) -> None:
        """Clear the shared registry — used in tests."""
        cls._skills.clear()

    @classmethod
    def load_directory(cls, path: str | Path) -> dict[str, SkillDef]:
        """Load all .yaml skills from directory (recursively).

        Returns dict[name -> SkillDef] for all valid skills.
        Raises DuplicateSkillNameError if name appears in multiple files.
        Raises SkillLoadError if a file cannot be parsed.
        Emits SkillRegistered events via nxl_core.events.EventLog.
        """
        directory = Path(path)
        if not directory.exists():
            return {}

        result: dict[str, SkillDef] = {}
        seen_names: dict[str, Path] = {}  # name -> first file path

        for file_path in sorted(directory.rglob("*.yaml")):
            if file_path.suffix != ".yaml":
                continue

            name = file_path.stem

            try:
                yaml_text = file_path.read_text(encoding="utf-8")
                skill_def = SkillDef.from_yaml(yaml_text)
            except yaml.YAMLError as e:
                raise SkillLoadError(file_path.name, str(e)) from e
            except Exception as e:
                raise SkillLoadError(file_path.name, str(e)) from e

            # Enforce name == filename stem invariant
            if skill_def.name != name:
                raise SkillLoadError(
                    file_path.name,
                    f"skill name '{skill_def.name}' does not match filename stem '{name}'",
                )

            if name in seen_names:
                dup_file = seen_names[name]
                raise DuplicateSkillNameError(
                    name, [str(dup_file), str(file_path)]
                )

            seen_names[name] = file_path
            result[name] = skill_def
            cls._skills[name] = skill_def

            # Emit SkillRegistered event
            from nxl_core.events.schema import SkillRegistered
            from nxl_core.events.ipc import EventEmissionClient

            EventEmissionClient().emit(SkillRegistered(
                skill_name=name,
                skill_def=skill_def.model_dump(),
            ), origin_mcp="skills")

        return result

    def get(self, name: str) -> SkillDef | None:
        """Return the SkillDef for the given name, or None if not found."""
        return SkillRegistry._skills.get(name)

    def list_skills(self) -> list[str]:
        """Return sorted list of all registered skill names."""
        return sorted(SkillRegistry._skills.keys())