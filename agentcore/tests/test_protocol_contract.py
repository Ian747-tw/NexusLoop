"""
agentcore/tests/test_protocol_contract.py
-----------------------------------------
Protocol round-trip contract tests: Python encodes → decodes → re-encodes.

These tests validate that the Python Pydantic models in nxl_core.policy.protocol
produce identical JSON when round-tripped through model_validate_json / model_dump_json.

Run: pytest agentcore/tests/test_protocol_contract.py
"""
import json

from agentcore.client_py.protocol import (
    CapsuleResponse,
    CompactRequest,
    CompactResponse,
    PolicyDecision,
    SessionCtx,
    ToolCallRequest,
)


class TestPolicyDecisionRoundTrip:
    """PolicyDecision discriminated union variants."""

    def test_allow_round_trip(self) -> None:
        msg = {"kind": "allow"}
        encoded = json.dumps(msg)
        decoded = PolicyDecision.model_validate_json(encoded)
        assert decoded.kind == "allow"
        re_encoded = decoded.model_dump_json()
        assert json.loads(re_encoded) == msg

    def test_deny_round_trip(self) -> None:
        msg = {"kind": "deny", "reason": "unsafe"}
        decoded = PolicyDecision.model_validate_json(json.dumps(msg))
        assert decoded.kind == "deny"
        assert decoded.reason == "unsafe"
        re_encoded = decoded.model_dump_json()
        assert json.loads(re_encoded) == msg

    def test_ask_round_trip(self) -> None:
        msg = {"kind": "ask", "verb": "confirm", "payload": {"tool": "write_file"}}
        decoded = PolicyDecision.model_validate_json(json.dumps(msg))
        assert decoded.kind == "ask"
        assert decoded.verb == "confirm"
        re_encoded = decoded.model_dump_json()
        assert json.loads(re_encoded) == msg

    def test_narrow_round_trip(self) -> None:
        msg = {"kind": "narrow", "narrowed_args": {"path": "/safe"}, "reason": "path sanitized"}
        decoded = PolicyDecision.model_validate_json(json.dumps(msg))
        assert decoded.kind == "narrow"
        re_encoded = decoded.model_dump_json()
        assert json.loads(re_encoded) == msg


class TestToolCallRequestRoundTrip:
    """ToolCallRequest + embedded SessionCtx."""

    def test_basic_round_trip(self) -> None:
        msg = {
            "id": "req-1",
            "name": "read_file",
            "args": {"path": "/tmp/foo"},
            "ctx": {
                "cycle_id": "cycle-42",
                "turn": 1,
                "capsule_bytes": "aGVsbG8=",
                "provider": "anthropic",
            },
        }
        decoded = ToolCallRequest.model_validate_json(json.dumps(msg))
        assert decoded.id == "req-1"
        assert decoded.name == "read_file"
        assert decoded.ctx.provider == "anthropic"
        re_encoded = decoded.model_dump_json()
        assert json.loads(re_encoded) == msg


class TestCapsuleResponseRoundTrip:
    """CapsuleResponse from Python → TS."""

    def test_round_trip(self) -> None:
        msg = {"prefix": "<session>...</session>", "cache_break": "<cache>..."}
        decoded = CapsuleResponse.model_validate_json(json.dumps(msg))
        assert decoded.prefix == "<session>...</session>"
        re_encoded = decoded.model_dump_json()
        assert json.loads(re_encoded) == msg


class TestCompactRequestRoundTrip:
    """CompactRequest from TS → Python."""

    def test_round_trip(self) -> None:
        msg = {
            "cycle_id": "cycle-42",
            "tier_hint": "soft",
            "current_token_count": 95000,
            "reason": "near limit",
        }
        decoded = CompactRequest.model_validate_json(json.dumps(msg))
        assert decoded.tier_hint == "soft"
        re_encoded = decoded.model_dump_json()
        assert json.loads(re_encoded) == msg


class TestCompactResponseRoundTrip:
    """CompactResponse from Python → TS."""

    def test_round_trip(self) -> None:
        msg = {"new_prefix": "<trimmed>...</trimmed>", "new_cache_break": "", "events_emitted": 3}
        decoded = CompactResponse.model_validate_json(json.dumps(msg))
        assert decoded.events_emitted == 3
        re_encoded = decoded.model_dump_json()
        assert json.loads(re_encoded) == msg