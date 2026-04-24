"""
nxl_core.research.score
----------------------
ScoreVector (8-dim), dominates(), frontier(), and 4 ParetoRankers.
"""
from __future__ import annotations

from abc import ABC, abstractmethod

from pydantic import BaseModel


class ScoreVector(BaseModel):
    """8-dimensional preference vector.

    Higher-is-better fields: accuracy, precision, recall, f1, robustness, fairness
    Lower-is-better fields:  latency_ms, memory_mb
    """
    accuracy: float
    precision: float
    recall: float
    f1: float
    latency_ms: float
    memory_mb: float
    robustness: float
    fairness: float

    model_config = {"frozen": True}


# Fields where higher is better vs lower is better
_HIGHER_BETTER = {"accuracy", "precision", "recall", "f1", "robustness", "fairness"}
_LOWER_BETTER = {"latency_ms", "memory_mb"}

_ALL_FIELDS = list(ScoreVector.model_fields.keys())


def dominates(a: ScoreVector, b: ScoreVector) -> bool:
    """True when a strictly dominates b (a better in ≥1 dim, no worse in any)."""
    better_in_any = False
    for field in _ALL_FIELDS:
        a_val = getattr(a, field)
        b_val = getattr(b, field)
        if a_val == b_val:
            continue
        if field in _HIGHER_BETTER:
            if a_val < b_val:
                return False
        else:
            if a_val > b_val:
                return False
        better_in_any = True
    return better_in_any


def frontier(scores: list[ScoreVector]) -> list[ScoreVector]:
    """Return the Pareto frontier (non-dominated vectors)."""
    return [s for s in scores if not any(dominates(other, s) for other in scores if other is not s)]


class ParetoRanker(ABC):
    """Abstract ranker returning scores sorted best-to-worst."""

    @abstractmethod
    def rank(self, scores: list[ScoreVector]) -> list[ScoreVector]:
        ...


class WeightedSumRanker(ParetoRanker):
    """Rank by weighted sum of normalized [0,1] values.

    Normalization: (val - min) / (max - min) for each field independently.
    Higher-is-better fields: use raw value.
    Lower-is-better fields: use 1 - normalized (so lower latency → higher score).
    """
    def __init__(self, weights: dict[str, float]) -> None:
        self.weights = weights

    def rank(self, scores: list[ScoreVector]) -> list[ScoreVector]:
        if not scores:
            return []
        if len(scores) == 1:
            return list(scores)

        # Compute min/max per field
        mins = {f: min(getattr(s, f) for s in scores) for f in _ALL_FIELDS}
        maxs = {f: max(getattr(s, f) for s in scores) for f in _ALL_FIELDS}

        def weighted_sum(s: ScoreVector) -> float:
            total = 0.0
            for field in _ALL_FIELDS:
                w = self.weights.get(field, 0.0)
                if w == 0.0:
                    continue
                val = getattr(s, field)
                mn, mx = mins[field], maxs[field]
                if mx == mn:
                    norm = 1.0
                else:
                    norm = (val - mn) / (mx - mn)
                if field in _LOWER_BETTER:
                    norm = 1.0 - norm
                total += w * norm
            return total

        return sorted(scores, key=weighted_sum, reverse=True)


class LexicographicRanker(ParetoRanker):
    """Rank by keys in order: first key ties broken by second, etc."""
    def __init__(self, keys: list[str]) -> None:
        self.keys = keys

    def rank(self, scores: list[ScoreVector]) -> list[ScoreVector]:
        def sort_key(s: ScoreVector):
            # For lower-is-better, negate so ascending sort gives best first
            parts = []
            for k in self.keys:
                val = getattr(s, k)
                if k in _LOWER_BETTER:
                    parts.append(-val)
                else:
                    parts.append(-val)
            return tuple(parts)

        # Sort descending (best first) by each key in order
        def lex_compare(s: ScoreVector):
            return tuple(-getattr(s, k) for k in self.keys)

        return sorted(scores, key=lex_compare)


class EloRanker(ParetoRanker):
    """Rank by Elo pairwise win rate. Each vector's score is its expected win rate vs others."""
    K = 32

    def rank(self, scores: list[ScoreVector]) -> list[ScoreVector]:
        if not scores:
            return []
        if len(scores) == 1:
            return list(scores)

        # Initialize Elo ratings
        ratings: dict[ScoreVector, float] = {s: 1500.0 for s in scores}

        # Run pairwise comparisons based on dominates relation
        for _ in range(100):  # iterate to converge
            for a in scores:
                for b in scores:
                    if a is b:
                        continue
                    # Expected score: higher is better
                    exp_a = 1.0 / (1.0 + 10 ** ((ratings[b] - ratings[a]) / 400))
                    # Actual: 1 if a dominates b, 0 if b dominates a, 0.5 if neither
                    if dominates(a, b):
                        actual = 1.0
                    elif dominates(b, a):
                        actual = 0.0
                    else:
                        actual = 0.5
                    ratings[a] += self.K * (actual - exp_a)

        return sorted(scores, key=ratings.__getitem__, reverse=True)


class ConstraintRanker(ParetoRanker):
    """Rank: first filter by minimum thresholds, then sort by weighted sum."""
    def __init__(self, constraints: dict[str, float]) -> None:
        self.constraints = constraints  # key -> minimum required value

    def rank(self, scores: list[ScoreVector]) -> list[ScoreVector]:
        def passes(s: ScoreVector) -> bool:
            for field, min_val in self.constraints.items():
                val = getattr(s, field)
                if val < min_val:
                    return False
            return True

        passing = [s for s in scores if passes(s)]
        failing = [s for s in scores if not passes(s)]
        # Sort both groups by weighted sum
        ws = WeightedSumRanker(weights={f: 1.0 for f in _ALL_FIELDS})
        return ws.rank(passing) + ws.rank(failing)
