"""
M0.4 Step 1: ResumeCapsule deterministic builder.

build(event_cursor) must be a pure function: same cursor always produces
byte-identical capsule. Verified by running 10 times and asserting equality.
"""
from __future__ import annotations

import tempfile
from pathlib import Path


from nxl_core.capsule.resume import ResumeCapsule, build


class TestResumeCapsuleStructure:
    """ResumeCapsule has 10 sections and respects token limit."""

    def test_has_10_sections(self) -> None:
        assert len(ResumeCapsule.SECTIONS) == 10

    def test_section_names(self) -> None:
        expected = (
            "mission",
            "current_hypothesis",
            "progress_notes",
            "pending_tasks",
            "blocked_by",
            "next_steps_3",
            "tool_results",
            "decision_log",
            "quality_notes",
            "synthesis",
        )
        assert ResumeCapsule.SECTIONS == expected


class TestBuildDeterminism:
    """build(event_cursor) is pure: same cursor → byte-identical output ×10."""

    def test_same_cursor_produces_identical_capsule_10_runs(self) -> None:
        """Run build() 10 times with same cursor; all results must be byte-identical."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cursor_path = Path(tmpdir) / "cursor"
            cursor_path.write_text("0")

            results = []
            for _ in range(10):
                capsule_bytes = build(cursor_path)
                results.append(capsule_bytes)

            first = results[0]
            for i, result in enumerate(results[1:], start=2):
                assert result == first, (
                    f"Run {i} differed from run 1 — build() is not deterministic. "
                    f"Length diff: {len(result)} vs {len(first)}"
                )

    def test_different_cursors_produce_different_capsules(self) -> None:
        """Different cursors + different event content must produce different capsules."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cursor_a = Path(tmpdir) / "cursor_a"
            cursor_b = Path(tmpdir) / "cursor_b"
            # cursor_a: index 0, one event
            cursor_a.write_text(
                '0\n{"kind":"MissionDeclared","data":{"mission":"Explore AI safety"}}\n'
            )
            # cursor_b: index 0, different event
            cursor_b.write_text(
                '0\n{"kind":"MissionDeclared","data":{"mission":"Build a compiler"}}\n'
            )

            cap_a = build(cursor_a)
            cap_b = build(cursor_b)

            assert cap_a != cap_b, "Different event content must produce different capsules"


class TestResumeCapsuleTokenLimit:
    """ResumeCapsule output must be ≤2000 tokens."""

    def test_capsule_under_2000_tokens(self) -> None:
        """A typical capsule must not exceed 2000-token budget."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cursor_path = Path(tmpdir) / "cursor"
            cursor_path.write_text("0")

            capsule_bytes = build(cursor_path)
            capsule_text = capsule_bytes.decode("utf-8")
            # Rough token count: ~4 chars per token
            token_estimate = len(capsule_text) // 4
            assert token_estimate <= 2000, (
                f"Capsule estimated at {token_estimate}t (>{2000}t budget)"
            )
