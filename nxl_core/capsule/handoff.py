"""
nxl_core.capsule.handoff
------------------------
HandoffRecord: agent-to-agent context transfer with token limits.

summary ≤ 500 tokens, hints ≤ 200 tokens.
Token estimate: len(text) // 4 (≈4 chars/token).
"""
from __future__ import annotations

from pydantic import BaseModel, model_validator


class HandoffRecord(BaseModel):
    """Agent-to-agent handoff record with enforced token budgets."""

    from_agent: str
    to_agent: str
    reason: str
    summary: str = ""
    hints: str = ""

    @model_validator(mode="after")
    def check_token_limits(self) -> "HandoffRecord":
        summary_tokens = len(self.summary) // 4
        if summary_tokens > 500:
            raise ValueError(f"summary exceeds 500-token budget ({summary_tokens}t)")
        hints_tokens = len(self.hints) // 4
        if hints_tokens > 200:
            raise ValueError(f"hints exceeds 200-token budget ({hints_tokens}t)")
        return self
