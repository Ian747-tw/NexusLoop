"""
M2.1.2: SkillRegistry tests.
"""
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
import yaml

from nxl_core.events.log import EventLog
from nxl_core.events.singletons import reset, set_shared
from nxl_core.skills.registry import (
    DuplicateSkillNameError,
    SkillLoadError,
    SkillRegistry,
)
from nxl_core.skills.schema import SkillDef


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def write_skill_file(dir_path: Path, filename: str, name: str, **overrides) -> Path:
    """Write a valid skill YAML file and return its path."""
    data = {
        "name": name,
        "description": "Test skill",
        "triggers": ["manual"],
        "inputs": {"query": "str"},
        "outputs": {"result": "str"},
        "steps": [{"action": "noop", "args": {}, "description": ""}],
        **overrides,
    }
    file_path = dir_path / filename
    file_path.write_text(yaml.safe_dump(data), encoding="utf-8")
    return file_path


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestLoadDirectory:
    def test_loads_4_valid_skills(self, tmp_path) -> None:
        """load_directory returns dict with all 4 valid skills."""
        for i in range(4):
            write_skill_file(tmp_path, f"skill_{i}.yaml", f"skill_{i}")

        log_path = tmp_path / "events.jsonl"
        set_shared(EventLog(path=log_path))
        try:
            registry = SkillRegistry()
            result = registry.load_directory(tmp_path)
        finally:
            reset()

        assert len(result) == 4
        for i in range(4):
            assert f"skill_{i}" in result
            assert isinstance(result[f"skill_{i}"], SkillDef)

    def test_duplicate_name_raises(self, tmp_path) -> None:
        """Two files with same skill name in YAML raises DuplicateSkillNameError.

        Uses subdirs so both files have stem 'noise' (passing filename-stem validation),
        but both contain `name: noise` in their YAML — triggering duplicate detection.
        """
        sub_a = tmp_path / "a"
        sub_b = tmp_path / "b"
        sub_a.mkdir()
        sub_b.mkdir()

        write_skill_file(sub_a, "noise.yaml", "noise")
        write_skill_file(sub_b, "noise.yaml", "noise")  # same stem "noise", same YAML name "noise"

        log_path = tmp_path / "events.jsonl"
        set_shared(EventLog(path=log_path))
        try:
            registry = SkillRegistry()
            with pytest.raises(DuplicateSkillNameError) as exc_info:
                registry.load_directory(tmp_path)

            assert "noise" in str(exc_info.value)
            assert "Duplicate skill name" in str(exc_info.value)
        finally:
            reset()

    def test_malformed_yaml_raises(self, tmp_path) -> None:
        """File with invalid YAML raises SkillLoadError with filename context."""
        bad_file = tmp_path / "bad_skill.yaml"
        bad_file.write_text("name: bad\n  indent: broken\n", encoding="utf-8")

        log_path = tmp_path / "events.jsonl"
        set_shared(EventLog(path=log_path))
        try:
            registry = SkillRegistry()
            with pytest.raises(SkillLoadError) as exc_info:
                registry.load_directory(tmp_path)

            assert "bad_skill.yaml" in str(exc_info.value)
            assert "Failed to load skill" in str(exc_info.value)
        finally:
            reset()

    def test_missing_dir_returns_empty(self) -> None:
        """Non-existent directory returns empty dict, does not raise."""
        registry = SkillRegistry()
        result = registry.load_directory("/this/path/does/not/exist")
        assert result == {}


class TestInstanceMethods:
    def setup_method(self) -> None:
        """Clear registry before each test to avoid cross-test pollution."""
        SkillRegistry.reset()

    def teardown_method(self) -> None:
        """Clear registry after each test."""
        SkillRegistry.reset()

    def test_get_returns_none_for_missing(self, tmp_path) -> None:
        """get() returns None for unknown skill name after loading other skills."""
        # Load some skills first
        write_skill_file(tmp_path, "existing.yaml", "existing")
        log_path = tmp_path / "events.jsonl"
        set_shared(EventLog(path=log_path))
        try:
            registry = SkillRegistry()
            registry.load_directory(tmp_path)
        finally:
            reset()

        assert registry.get("nonexistent") is None
        assert registry.get("existing") is not None

    def test_list_skills_returns_names(self, tmp_path) -> None:
        """list_skills() returns sorted list of skill names after loading."""
        write_skill_file(tmp_path, "zebra.yaml", "zebra")
        write_skill_file(tmp_path, "apple.yaml", "apple")
        log_path = tmp_path / "events.jsonl"
        set_shared(EventLog(path=log_path))
        try:
            registry = SkillRegistry()
            registry.load_directory(tmp_path)
        finally:
            reset()

        names = registry.list_skills()
        assert names == ["apple", "zebra"]