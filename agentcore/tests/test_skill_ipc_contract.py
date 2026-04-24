"""
agentcore/tests/test_skill_ipc_contract.py
--------------------------------------------
Skill IPC round-trip contract tests:
  - SkillRegistration: Python→TS→Python (bytes identical)
  - SkillInvoked: TS→Python→TS (round-trip deserialization)
  - SkillCompleted: TS→Python→TS (round-trip deserialization)

These tests validate that the new skill message types in
agentcore/client_py/protocol.py produce identical JSON when
round-tripped through model_validate_json / model_dump_json.

Run: pytest agentcore/tests/test_skill_ipc_contract.py
"""
import json

from agentcore.client_py.protocol import (
    SkillCompleted,
    SkillInvoked,
    SkillRegistration,
)


class TestSkillRegistrationRoundTrip:
    """SkillRegistration: Python → TS → Python bytes identical."""

    def test_basic_round_trip(self) -> None:
        msg = {
            "name": "read-file-skill",
            "description": "Reads a file safely",
            "triggers": ["/read", "read_file"],
            "inputs": {"path": "string", "encoding": "string"},
            "outputs": {"content": "string", "lines": "int"},
            "steps_count": 3,
            "budgets": {"tokens": 5000},
        }
        decoded = SkillRegistration.model_validate_json(json.dumps(msg))
        assert decoded.name == "read-file-skill"
        assert decoded.triggers == ["/read", "read_file"]
        assert decoded.steps_count == 3
        assert decoded.budgets == {"tokens": 5000}
        re_encoded = decoded.model_dump_json()
        assert json.loads(re_encoded) == msg

    def test_minimal_round_trip(self) -> None:
        """Required fields only; budgets defaults to {}."""
        msg = {
            "name": "minimal-skill",
            "description": "A skill with only required fields",
            "triggers": [],
            "inputs": {},
            "outputs": {},
            "steps_count": 1,
        }
        decoded = SkillRegistration.model_validate_json(json.dumps(msg))
        assert decoded.name == "minimal-skill"
        assert decoded.budgets == {}
        re_encoded = decoded.model_dump_json()
        assert json.loads(re_encoded) == msg


class TestSkillInvokedRoundTrip:
    """SkillInvoked: TS → Python → TS (round-trip)."""

    def test_basic_round_trip(self) -> None:
        msg = {
            "skill_name": "read-file-skill",
            "invocation_id": "skill-read-file-skill-1740000000000",
            "args": {"path": "/tmp/foo", "encoding": "utf-8"},
        }
        decoded = SkillInvoked.model_validate_json(json.dumps(msg))
        assert decoded.skill_name == "read-file-skill"
        assert decoded.invocation_id == "skill-read-file-skill-1740000000000"
        assert decoded.args == {"path": "/tmp/foo", "encoding": "utf-8"}
        re_encoded = decoded.model_dump_json()
        assert json.loads(re_encoded) == msg

    def test_empty_args_round_trip(self) -> None:
        msg = {
            "skill_name": "no-args-skill",
            "invocation_id": "skill-no-args-1740000000001",
            "args": {},
        }
        decoded = SkillInvoked.model_validate_json(json.dumps(msg))
        assert decoded.args == {}
        re_encoded = decoded.model_dump_json()
        assert json.loads(re_encoded) == msg


class TestSkillCompletedRoundTrip:
    """SkillCompleted: TS → Python → TS (round-trip)."""

    def test_success_round_trip(self) -> None:
        msg = {
            "skill_name": "read-file-skill",
            "invocation_id": "skill-read-file-skill-1740000000000",
            "success": True,
            "result": {"content": "hello world", "lines": 1},
            # error omitted: TS schema omits null-valued optional fields
        }
        decoded = SkillCompleted.model_validate_json(json.dumps(msg))
        assert decoded.skill_name == "read-file-skill"
        assert decoded.success is True
        assert decoded.result == {"content": "hello world", "lines": 1}
        re_encoded = decoded.model_dump_json()
        assert json.loads(re_encoded) == msg

    def test_failure_round_trip(self) -> None:
        msg = {
            "skill_name": "read-file-skill",
            "invocation_id": "skill-read-file-skill-1740000000000",
            "success": False,
            "error": "File not found",
            # result omitted: TS schema omits null-valued optional fields
        }
        decoded = SkillCompleted.model_validate_json(json.dumps(msg))
        assert decoded.success is False
        assert decoded.error == "File not found"
        re_encoded = decoded.model_dump_json()
        assert json.loads(re_encoded) == msg

    def test_minimal_round_trip(self) -> None:
        """Only required fields; result/error optional."""
        msg = {
            "skill_name": "simple-skill",
            "invocation_id": "skill-simple-1740000000002",
            "success": True,
        }
        decoded = SkillCompleted.model_validate_json(json.dumps(msg))
        assert decoded.success is True
        assert decoded.result is None
        assert decoded.error is None
        re_encoded = decoded.model_dump_json()
        assert json.loads(re_encoded) == msg