"""
M0.2 Step 1: Hypothesis with canonical hash — duplicate detection.

Tests:
1. Two Hypotheses with same axis content but reordered keys → same hash
2. Different axis content → different hash
3. Hash is deterministic (same content → same hash on multiple calls)
4. Hypothesis model_dump_json round-trips
"""
from __future__ import annotations



from nxl_core.research.hypothesis import Hypothesis, HypothesisStatus


class TestHypothesisCanonicalHash:
    def test_same_content_reordered_keys_same_hash(self) -> None:
        """Two hypotheses with same axis content but reordered hyperparam_diff keys → same hash."""
        h1 = Hypothesis(
            id="hyp_001",
            claim="Adding attention improves score",
            rationale="Literature shows attention helps NLP tasks",
            source="literature",
            evidence_shape={
                "axis_family": "transformer_architecture",
                "hyperparam_diff": {"attention_heads": 8, "hidden_size": 256},
                "evaluator": "bleu_score",
                "dataset_rev": "squad_v1",
            },
            prerequisites=[],
            budget={"trial_count": 10, "max_tokens": 100000},
            seeds_required=3,
            priority=0.8,
            status=HypothesisStatus.ACTIVE,
            trials=[],
            decision_log=[],
            citations=["arxiv:1706.03762"],
        )
        h2 = Hypothesis(
            id="hyp_002",
            claim="Adding attention improves score",
            rationale="Literature shows attention helps NLP tasks",
            source="literature",
            evidence_shape={
                "axis_family": "transformer_architecture",
                "hyperparam_diff": {"hidden_size": 256, "attention_heads": 8},  # reordered
                "evaluator": "bleu_score",
                "dataset_rev": "squad_v1",
            },
            prerequisites=[],
            budget={"trial_count": 10, "max_tokens": 100000},
            seeds_required=3,
            priority=0.8,
            status=HypothesisStatus.ACTIVE,
            trials=[],
            decision_log=[],
            citations=["arxiv:1706.03762"],
        )
        assert h1.hash == h2.hash, (
            f"Same axis content with reordered hyperparam_diff should produce same hash: "
            f"{h1.hash} != {h2.hash}"
        )

    def test_different_content_different_hash(self) -> None:
        """Different axis_family → different hash."""
        h1 = _make_hypothesis(id="hyp_a", axis_family="transformer_architecture")
        h2 = _make_hypothesis(id="hyp_b", axis_family="cnn_architecture")
        assert h1.hash != h2.hash

    def test_hash_deterministic(self) -> None:
        """Same content → same hash on repeated calls."""
        h = _make_hypothesis(id="hyp_deterministic")
        hashes = [h.hash for _ in range(5)]
        assert len(set(hashes)) == 1, f"Hash should be deterministic: {hashes}"

    def test_hash_is_16_chars_hex(self) -> None:
        """Hash is a 16-character hexadecimal string."""
        h = _make_hypothesis()
        assert len(h.hash) == 16
        int(h.hash, 16)  # raises if not valid hex

    def test_roundtrip_json(self) -> None:
        """Hypothesis serializes and deserializes correctly."""
        h = _make_hypothesis(id="hyp_roundtrip")
        blob = h.model_dump_json()
        parsed = Hypothesis.model_validate_json(blob)
        assert parsed.id == h.id
        assert parsed.hash == h.hash


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def _make_hypothesis(
    id: str = "hyp_001",
    axis_family: str = "transformer_architecture",
) -> Hypothesis:
    return Hypothesis(
        id=id,
        claim="Adding attention improves score",
        rationale="Literature shows attention helps",
        source="literature",
        evidence_shape={
            "axis_family": axis_family,
            "hyperparam_diff": {"attention_heads": 8, "hidden_size": 256},
            "evaluator": "bleu_score",
            "dataset_rev": "squad_v1",
        },
        prerequisites=[],
        budget={"trial_count": 10, "max_tokens": 100000},
        seeds_required=3,
        priority=0.8,
        status=HypothesisStatus.ACTIVE,
        trials=[],
        decision_log=[],
        citations=[],
    )