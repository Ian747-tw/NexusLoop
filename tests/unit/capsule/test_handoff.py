"""
M0.4 Step 2: HandoffRecord with token count enforcement.

HandoffRecord: {from_agent, to_agent, reason, summary ≤500t, hints ≤200t}
Token counts are enforced at construction (ValueError if exceeded).
"""
from __future__ import annotations

import pytest

from nxl_core.capsule.handoff import HandoffRecord


class TestHandoffRecordConstruction:
    """HandoffRecord enforces token limits at construction."""

    def test_valid_record_accepted(self) -> None:
        record = HandoffRecord(
            from_agent="researcher",
            to_agent="reviewer",
            reason="Phase complete",
            summary="Achieved proof of concept for approach X.",
            hints="Check hypothesis section next.",
        )
        assert record.from_agent == "researcher"
        assert record.to_agent == "reviewer"
        assert record.reason == "Phase complete"

    def test_summary_at_exact_limit(self) -> None:
        """summary exactly at 500 tokens (chars/4) should be accepted."""
        # ~4 chars/token → 500 tokens ≈ 2000 chars
        summary = "word " * 400  # 400 words ≈ 2000 chars ≈ 500 tokens
        record = HandoffRecord(
            from_agent="a",
            to_agent="b",
            reason="r",
            summary=summary,
            hints="",
        )
        assert len(record.summary) == len(summary)

    def test_summary_over_limit_rejected(self) -> None:
        """summary > 500 tokens must raise ValueError."""
        # 501 tokens ≈ 2004+ chars
        summary = "word " * 501  # 501 words → 501*5=2505 chars → 626 tokens
        with pytest.raises(ValueError, match="summary.*500"):
            HandoffRecord(
                from_agent="a",
                to_agent="b",
                reason="r",
                summary=summary,
                hints="",
            )

    def test_hints_at_exact_limit(self) -> None:
        """hints exactly at 200 tokens should be accepted."""
        # ~4 chars/token → 200 tokens ≈ 800 chars
        hints = "hint " * 160  # 160 words → 800 chars ≈ 200 tokens
        record = HandoffRecord(
            from_agent="a",
            to_agent="b",
            reason="r",
            summary="",
            hints=hints,
        )
        assert len(record.hints) == len(hints)

    def test_hints_over_limit_rejected(self) -> None:
        """hints > 200 tokens must raise ValueError."""
        # 201 tokens ≈ 804+ chars
        hints = "hint " * 201  # 201 words → 1005 chars → 251 tokens
        with pytest.raises(ValueError, match="hints.*200"):
            HandoffRecord(
                from_agent="a",
                to_agent="b",
                reason="r",
                summary="",
                hints=hints,
            )


class TestHandoffRecordSerialization:
    """HandoffRecord round-trips through dict/JSON."""

    def test_roundtrip(self) -> None:
        record = HandoffRecord(
            from_agent="researcher",
            to_agent="reviewer",
            reason="Phase complete",
            summary="Proof of concept achieved.",
            hints="See section 3.",
        )
        blob = record.model_dump_json()
        parsed = HandoffRecord.model_validate_json(blob)
        assert parsed.from_agent == record.from_agent
        assert parsed.summary == record.summary
        assert parsed.hints == record.hints
