"""
agentcore.client_py.protocol
-----------------------------
Pydantic models for all IPC message types (Python↔TS protocol contract).

These models mirror the Zod schemas in agentcore/server-fork/bridge/protocol.ts
exactly — same field names, same types, same discriminated-union tag.

Run round-trip tests:
  pytest agentcore/tests/test_protocol_contract.py
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Session Context (carried in requests)
# ---------------------------------------------------------------------------


class SessionCtx(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    cycle_id: str
    turn: int = Field(ge=0, description="Turn number within the cycle")
    capsule_bytes: str = Field(description="Base64-encoded capsule")
    provider: Literal["anthropic", "openai", "ollama"]


# ---------------------------------------------------------------------------
# Python → TS (Decisions and State)
# ---------------------------------------------------------------------------


class PolicyDecisionAllow(BaseModel):
    """kind=allow: tool call permitted."""
    model_config = ConfigDict(populate_by_name=True)

    kind: Literal["allow"] = "allow"


class PolicyDecisionDeny(BaseModel):
    """kind=deny: tool call blocked; reason explains why."""
    model_config = ConfigDict(populate_by_name=True)

    kind: Literal["deny"] = "deny"
    reason: str = Field(default="", description="Why the tool call was denied")


class PolicyDecisionAsk(BaseModel):
    """kind=ask: confirmation required; verb names the confirmation type."""
    model_config = ConfigDict(populate_by_name=True)

    kind: Literal["ask"] = "ask"
    verb: str = Field(default="", description="Confirmation verb (e.g. 'confirm')")
    payload: object = Field(default_factory=dict, description="Confirmation payload")


class PolicyDecisionNarrow(BaseModel):
    """kind=narrow: args sanitized; narrowed_args are the safe subset."""
    model_config = ConfigDict(populate_by_name=True)

    kind: Literal["narrow"] = "narrow"
    narrowed_args: dict[str, object] = Field(default_factory=dict, description="Sanitized args")
    reason: str = Field(default="", description="Why args were narrowed")


class PolicyDecision(BaseModel):
    """
    Policy gate result — factory for discriminated union on `kind`.

    Variants:
      allow  — tool call permitted
      deny   — tool call blocked; reason explains why
      ask    — confirmation required; verb names the confirmation type
      narrow — args sanitized; narrowed_args are the safe subset

    Validation dispatches to concrete subclasses based on `kind`.
    Round-trip encode/decode is guaranteed by model_dump override.
    """
    model_config = ConfigDict(populate_by_name=True)

    kind: Literal["allow", "deny", "ask", "narrow"]

    @classmethod
    def model_validate(cls, data: Any, **kwargs: Any) -> "PolicyDecision":  # type: ignore[override]
        if isinstance(data, PolicyDecision):
            return data
        kind = data.get("kind") if isinstance(data, dict) else None
        if kind == "deny":
            return PolicyDecisionDeny.model_validate(data, **kwargs)
        if kind == "ask":
            return PolicyDecisionAsk.model_validate(data, **kwargs)
        if kind == "narrow":
            return PolicyDecisionNarrow.model_validate(data, **kwargs)
        return PolicyDecisionAllow.model_validate(data, **kwargs)

    @classmethod
    def model_validate_json(cls, json_data: str | bytes | bytearray, **kwargs: Any) -> "PolicyDecision":  # type: ignore[override]
        import json
        return cls.model_validate(json.loads(json_data), **kwargs)

    def model_dump(self, **kwargs: Any) -> dict[str, Any]:
        if self.kind == "allow":
            return {"kind": "allow"}
        if self.kind == "deny":
            return {"kind": "deny", "reason": self.reason}
        if self.kind == "ask":
            return {"kind": "ask", "verb": self.verb, "payload": self.payload}
        if self.kind == "narrow":
            return {"kind": "narrow", "narrowed_args": self.narrowed_args, "reason": self.reason}
        return {"kind": self.kind}


class CapsuleResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    prefix: str = Field(description="Pre-rendered session prefix")
    cache_break: str = Field(default="", description="Provider-specific cache breakpoint marker")


class CompactResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    new_prefix: str = Field(description="Trimmed session prefix")
    new_cache_break: str = Field(default="", description="Updated cache breakpoint marker")
    events_emitted: int = Field(ge=0, description="Number of CompactionEvents written")


class Intervention(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    verb: Literal[
        "ask",
        "warn",
        "narrow",
        "deny",
        "escalate",
        "trap",
        "scaffold",
        "redirect",
        "explain",
        "guide",
        "review",
        "confirm",
    ]
    payload: object = Field(default_factory=dict, description="Intervention payload")


class CycleControl(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    action: Literal["start", "pause", "resume", "halt"]
    provider: Literal["anthropic", "openai", "ollama"] | None = None


# ---------------------------------------------------------------------------
# TS → Python (Requests and Events)
# ---------------------------------------------------------------------------


class ToolCallRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(description="Unique request ID")
    name: str = Field(description="Tool name being called")
    args: dict[str, object] = Field(default_factory=dict, description="Tool arguments")
    ctx: SessionCtx


class ToolCallResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(description="Matches the ToolCallRequest.id")
    allowed: bool = Field(description="Whether the tool call was permitted")
    result: object | None = Field(default=None, description="Tool call return value")
    error: str | None = Field(default=None, description="Error message if call failed")


class CapsuleRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    cycle_id: str


class CompactRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    cycle_id: str
    tier_hint: Literal["soft", "hard", "clear"] = Field(description="Compaction urgency tier")
    current_token_count: int = Field(ge=0, description="Current token count")
    reason: str = Field(default="", description="Why compaction is being requested")


class EventEmission(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    event: dict[str, object] = Field(default_factory=dict, description="Event data")


class CycleResult(BaseModel):
    """Result of a full cycle run — returned by OpenCodeClient.run_cycle()."""

    cycle_id: str
    events: list[EventEmission] = Field(default_factory=list)
    final_state: bytes = b""
    tool_calls: int = 0
    blocked: int = 0