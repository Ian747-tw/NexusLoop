"""
M2.1.1: SkillDef schema tests.
"""
from __future__ import annotations

import yaml

import pytest
from pydantic import ValidationError

from nxl_core.skills.schema import SkillDef


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_skill_yaml(
    *,
    name: str = "test-skill",
    description: str = "A test skill",
    triggers: list[str] | None = None,
    inputs: dict[str, str] | None = None,
    outputs: dict[str, str] | None = None,
    steps: list[dict] | None = None,
    budgets: dict | None = None,
) -> str:
    """Build a valid skill YAML string for testing using proper YAML serialization."""
    triggers = triggers or ["manual"]
    inputs = inputs or {"query": "str"}
    outputs = outputs or {"result": "str"}
    steps = steps or [{"action": "test_action", "args": {}, "description": ""}]
    budgets = budgets or {}

    data = {
        "name": name,
        "description": description,
        "triggers": triggers,
        "inputs": inputs,
        "outputs": outputs,
        "steps": [
            {
                "action": s["action"],
                "args": s.get("args", {}),
                "description": s.get("description", ""),
            }
            for s in steps
        ],
        "budgets": budgets,
    }

    return yaml.safe_dump(data, default_flow_style=False, sort_keys=False)


# ---------------------------------------------------------------------------
# Valid skill tests
# ---------------------------------------------------------------------------

class TestSkillDefValid:
    """Valid SkillDef instances pass validation and round-trip through YAML."""

    def test_minimal_skill(self) -> None:
        """A minimal valid skill passes validation."""
        yaml_text = make_skill_yaml(
            name="minimal",
            description="Minimal skill",
            triggers=["manual"],
            inputs={},
            outputs={},
            steps=[{"action": "noop", "args": {}, "description": ""}],
        )
        skill = SkillDef.from_yaml(yaml_text)
        assert skill.name == "minimal"
        assert skill.description == "Minimal skill"
        assert skill.triggers == ["manual"]
        assert len(skill.steps) == 1

    def test_all_trigger_values(self) -> None:
        """Each valid trigger value is accepted."""
        for trigger in ("manual", "auto_on_plateau", "auto_on_failure"):
            yaml_text = make_skill_yaml(triggers=[trigger])
            skill = SkillDef.from_yaml(yaml_text)
            assert skill.triggers == [trigger]

    def test_multiple_triggers(self) -> None:
        """Multiple triggers are accepted."""
        yaml_text = make_skill_yaml(triggers=["manual", "auto_on_plateau", "auto_on_failure"])
        skill = SkillDef.from_yaml(yaml_text)
        assert skill.triggers == ["manual", "auto_on_plateau", "auto_on_failure"]

    def test_steps_with_args(self) -> None:
        """Steps with arguments are accepted."""
        yaml_text = make_skill_yaml(
            steps=[
                {
                    "action": "search",
                    "args": {"query": "best framework", "limit": "10"},
                    "description": "Search the web",
                }
            ]
        )
        skill = SkillDef.from_yaml(yaml_text)
        assert skill.steps[0].action == "search"
        assert skill.steps[0].args == {"query": "best framework", "limit": "10"}

    def test_max_steps_ok(self) -> None:
        """A skill with exactly 40 steps passes validation."""
        steps = [{"action": f"step_{i}", "args": {}, "description": ""} for i in range(40)]
        yaml_text = make_skill_yaml(steps=steps)
        skill = SkillDef.from_yaml(yaml_text)
        assert len(skill.steps) == 40

    def test_valid_skill_roundtrips(self) -> None:
        """Valid skill → yaml → SkillDef round-trips cleanly."""
        yaml_text = make_skill_yaml(
            name="roundtrip-skill",
            description="Tests round-trip",
            triggers=["manual", "auto_on_plateau"],
            inputs={"query": "str", "limit": "int"},
            outputs={"result": "str"},
            steps=[
                {"action": "search", "args": {"q": "test"}, "description": "Search"},
                {"action": "format", "args": {}, "description": "Format results"},
            ],
        )
        skill = SkillDef.from_yaml(yaml_text)
        redumped = SkillDef.from_yaml(skill.model_dump_json())
        assert redumped.name == skill.name
        assert redumped.triggers == skill.triggers
        assert redumped.inputs == skill.inputs
        assert redumped.outputs == skill.outputs
        assert len(redumped.steps) == len(skill.steps)


# ---------------------------------------------------------------------------
# Invalid skill tests
# ---------------------------------------------------------------------------

class TestSkillDefRejects:
    """Invalid SkillDef YAML raises ValidationError or ValueError."""

    def test_rejects_step_count_over_40(self) -> None:
        """41 steps raises ValueError via validate_step_count."""
        steps = [{"action": f"step_{i}", "args": {}, "description": ""} for i in range(41)]
        yaml_text = make_skill_yaml(steps=steps)
        with pytest.raises(ValidationError) as exc_info:
            SkillDef.from_yaml(yaml_text)
        assert "steps" in str(exc_info.value).lower() or "41" in str(exc_info.value)

    def test_rejects_missing_name(self) -> None:
        """Missing `name` field raises ValidationError."""
        yaml_text = make_skill_yaml()
        yaml_text = yaml_text.replace("name: test-skill\n", "")
        with pytest.raises(ValidationError) as exc_info:
            SkillDef.from_yaml(yaml_text)
        assert "name" in str(exc_info.value).lower()

    def test_rejects_missing_description(self) -> None:
        """Missing `description` field raises ValidationError."""
        yaml_text = make_skill_yaml()
        yaml_text = yaml_text.replace("description: A test skill\n", "")
        with pytest.raises(ValidationError) as exc_info:
            SkillDef.from_yaml(yaml_text)
        assert "description" in str(exc_info.value).lower()

    def test_rejects_missing_triggers(self) -> None:
        """Missing `triggers` field raises ValidationError."""
        data = {
            "name": "test",
            "description": "test",
            "inputs": {"query": "str"},
            "outputs": {"result": "str"},
            "steps": [{"action": "noop", "args": {}, "description": ""}],
        }
        yaml_text = yaml.safe_dump(data, default_flow_style=False)
        with pytest.raises(ValidationError) as exc_info:
            SkillDef.from_yaml(yaml_text)
        assert "triggers" in str(exc_info.value).lower()

    def test_rejects_missing_steps(self) -> None:
        """Missing `steps` field raises ValidationError."""
        # Build YAML dict without steps and dump it
        data = {
            "name": "test",
            "description": "test",
            "triggers": ["manual"],
            "inputs": {},
            "outputs": {},
        }
        yaml_text = yaml.safe_dump(data, default_flow_style=False)
        with pytest.raises(ValidationError) as exc_info:
            SkillDef.from_yaml(yaml_text)
        assert "steps" in str(exc_info.value).lower()

    def test_rejects_unknown_trigger_value(self) -> None:
        """Invalid trigger value raises ValidationError."""
        yaml_text = make_skill_yaml(triggers=["manual", "invalid_trigger"])
        with pytest.raises(ValidationError) as exc_info:
            SkillDef.from_yaml(yaml_text)
        assert "trigger" in str(exc_info.value).lower()

    def test_rejects_invalid_yaml(self) -> None:
        """Malformed YAML raises an error (yaml.scanner.ScannerError)."""
        yaml_text = "name: bad\n  indent: broken"
        with pytest.raises(yaml.scanner.ScannerError):
            SkillDef.from_yaml(yaml_text)

    def test_rejects_missing_inputs(self) -> None:
        """Missing `inputs` field raises ValidationError."""
        data = {
            "name": "test",
            "description": "test",
            "triggers": ["manual"],
            "outputs": {"result": "str"},
            "steps": [{"action": "noop", "args": {}, "description": ""}],
        }
        yaml_text = yaml.safe_dump(data, default_flow_style=False)
        with pytest.raises(ValidationError) as exc_info:
            SkillDef.from_yaml(yaml_text)
        assert "inputs" in str(exc_info.value).lower()

    def test_rejects_missing_outputs(self) -> None:
        """Missing `outputs` field raises ValidationError."""
        data = {
            "name": "test",
            "description": "test",
            "triggers": ["manual"],
            "inputs": {"query": "str"},
            "steps": [{"action": "noop", "args": {}, "description": ""}],
        }
        yaml_text = yaml.safe_dump(data, default_flow_style=False)
        with pytest.raises(ValidationError) as exc_info:
            SkillDef.from_yaml(yaml_text)
        assert "outputs" in str(exc_info.value).lower()

    def test_rejects_non_dict_args_in_step(self) -> None:
        """Step `args` must be a dict; non-dict raises ValidationError."""
        yaml_text = make_skill_yaml(
            steps=[{"action": "bad", "args": "not-a-dict", "description": ""}]
        )
        with pytest.raises(ValidationError) as exc_info:
            SkillDef.from_yaml(yaml_text)
        assert "args" in str(exc_info.value).lower()
