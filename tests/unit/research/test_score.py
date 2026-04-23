"""
M0.2 Step 4: ScoreVector + ParetoRanker.

ScoreVector is an 8-dimensional preference vector.
dominates(a, b) returns True when a strictly dominates b.
frontier(scores) returns the Pareto frontier.
4 pluggable rankers: weighted_sum, lex, elo, constraint.
"""
from __future__ import annotations

import math

import pytest

from nxl_core.research.score import (
    ScoreVector,
    dominates,
    frontier,
    WeightedSumRanker,
    LexicographicRanker,
    EloRanker,
    ConstraintRanker,
)


class TestScoreVector:
    def test_construct(self) -> None:
        sv = ScoreVector(
            accuracy=0.9,
            precision=0.85,
            recall=0.8,
            f1=0.82,
            latency_ms=10.0,
            memory_mb=512.0,
            robustness=0.95,
            fairness=0.88,
        )
        assert sv.accuracy == 0.9
        assert sv.f1 == 0.82

    def test_roundtrip(self) -> None:
        sv = ScoreVector(
            accuracy=0.9, precision=0.85, recall=0.8, f1=0.82,
            latency_ms=10.0, memory_mb=512.0, robustness=0.95, fairness=0.88,
        )
        blob = sv.model_dump_json()
        parsed = ScoreVector.model_validate_json(blob)
        assert parsed == sv


class TestDominates:
    def test_strictly_dominates(self) -> None:
        a = ScoreVector(accuracy=0.9, precision=0.85, recall=0.8, f1=0.82,
                         latency_ms=10.0, memory_mb=512.0, robustness=0.95, fairness=0.88)
        b = ScoreVector(accuracy=0.8, precision=0.75, recall=0.7, f1=0.72,
                         latency_ms=20.0, memory_mb=1024.0, robustness=0.85, fairness=0.78)
        assert dominates(a, b) is True
        assert dominates(b, a) is False

    def test_no_dominance_equal(self) -> None:
        a = ScoreVector(accuracy=0.9, precision=0.85, recall=0.8, f1=0.82,
                         latency_ms=10.0, memory_mb=512.0, robustness=0.95, fairness=0.88)
        b = ScoreVector(accuracy=0.9, precision=0.85, recall=0.8, f1=0.82,
                         latency_ms=10.0, memory_mb=512.0, robustness=0.95, fairness=0.88)
        assert dominates(a, b) is False
        assert dominates(b, a) is False

    def test_no_dominance_incomparable(self) -> None:
        # a better in accuracy, b better in latency
        a = ScoreVector(accuracy=0.95, precision=0.85, recall=0.8, f1=0.82,
                         latency_ms=20.0, memory_mb=512.0, robustness=0.95, fairness=0.88)
        b = ScoreVector(accuracy=0.85, precision=0.85, recall=0.8, f1=0.82,
                         latency_ms=5.0, memory_mb=512.0, robustness=0.95, fairness=0.88)
        assert dominates(a, b) is False
        assert dominates(b, a) is False


class TestFrontier:
    def test_frontier_single(self) -> None:
        scores = [
            ScoreVector(accuracy=0.9, precision=0.85, recall=0.8, f1=0.82,
                        latency_ms=10.0, memory_mb=512.0, robustness=0.95, fairness=0.88),
        ]
        f = frontier(scores)
        assert len(f) == 1

    def test_frontier_two_independent(self) -> None:
        # Neither dominates the other — both on frontier
        a = ScoreVector(accuracy=0.95, precision=0.85, recall=0.8, f1=0.82,
                        latency_ms=20.0, memory_mb=512.0, robustness=0.95, fairness=0.88)
        b = ScoreVector(accuracy=0.85, precision=0.85, recall=0.8, f1=0.82,
                        latency_ms=5.0, memory_mb=512.0, robustness=0.95, fairness=0.88)
        f = frontier([a, b])
        assert len(f) == 2

    def test_frontier_one_dominates_other(self) -> None:
        a = ScoreVector(accuracy=0.9, precision=0.85, recall=0.8, f1=0.82,
                        latency_ms=10.0, memory_mb=512.0, robustness=0.95, fairness=0.88)
        b = ScoreVector(accuracy=0.8, precision=0.75, recall=0.7, f1=0.72,
                        latency_ms=20.0, memory_mb=1024.0, robustness=0.85, fairness=0.78)
        f = frontier([a, b])
        assert len(f) == 1
        assert f[0] == a


class TestWeightedSumRanker:
    def test_rank(self) -> None:
        weights = {"accuracy": 0.4, "precision": 0.2, "recall": 0.2, "f1": 0.2,
                   "latency_ms": 0.0, "memory_mb": 0.0, "robustness": 0.0, "fairness": 0.0}
        ranker = WeightedSumRanker(weights=weights)
        scores = [
            ScoreVector(accuracy=0.9, precision=0.85, recall=0.8, f1=0.82,
                        latency_ms=10.0, memory_mb=512.0, robustness=0.95, fairness=0.88),
            ScoreVector(accuracy=0.95, precision=0.90, recall=0.85, f1=0.87,
                        latency_ms=10.0, memory_mb=512.0, robustness=0.95, fairness=0.88),
        ]
        ranked = ranker.rank(scores)
        assert ranked[0] == scores[1]  # higher accuracy wins
        assert ranked[1] == scores[0]


class TestLexicographicRanker:
    def test_rank(self) -> None:
        ranker = LexicographicRanker(keys=["accuracy", "f1", "recall"])
        scores = [
            ScoreVector(accuracy=0.9, precision=0.85, recall=0.8, f1=0.82,
                        latency_ms=10.0, memory_mb=512.0, robustness=0.95, fairness=0.88),
            ScoreVector(accuracy=0.95, precision=0.90, recall=0.85, f1=0.87,
                        latency_ms=10.0, memory_mb=512.0, robustness=0.95, fairness=0.88),
        ]
        ranked = ranker.rank(scores)
        assert ranked[0] == scores[1]


class TestEloRanker:
    def test_rank(self) -> None:
        ranker = EloRanker()
        scores = [
            ScoreVector(accuracy=0.9, precision=0.85, recall=0.8, f1=0.82,
                        latency_ms=10.0, memory_mb=512.0, robustness=0.95, fairness=0.88),
            ScoreVector(accuracy=0.95, precision=0.90, recall=0.85, f1=0.87,
                        latency_ms=10.0, memory_mb=512.0, robustness=0.95, fairness=0.88),
            ScoreVector(accuracy=0.5, precision=0.5, recall=0.5, f1=0.5,
                        latency_ms=10.0, memory_mb=512.0, robustness=0.5, fairness=0.5),
        ]
        ranked = ranker.rank(scores)
        # scores[1] (highest) should be first
        assert ranked[0] == scores[1]
        # scores[2] (lowest) should be last
        assert ranked[2] == scores[2]


class TestConstraintRanker:
    def test_rank(self) -> None:
        constraints = {"accuracy": 0.8, "f1": 0.75}
        ranker = ConstraintRanker(constraints=constraints)
        scores = [
            ScoreVector(accuracy=0.9, precision=0.85, recall=0.8, f1=0.82,
                        latency_ms=10.0, memory_mb=512.0, robustness=0.95, fairness=0.88),
            ScoreVector(accuracy=0.7, precision=0.7, recall=0.7, f1=0.72,
                        latency_ms=10.0, memory_mb=512.0, robustness=0.7, fairness=0.7),
        ]
        ranked = ranker.rank(scores)
        assert ranked[0] == scores[0]  # passes both constraints
        assert ranked[1] == scores[1]  # fails accuracy constraint
