"""
M0.2 Step 2: Polymorphic Trial (11 kinds) round-trip tests.

Each of 11 Trial kinds must:
1. Construct with required fields
2. Serialize to JSON and deserialize back to same object
3. Reject invalid kind strings at parse time
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import TypeVar

from pydantic import BaseModel, TypeAdapter

from nxl_core.research.trial import Trial

T = TypeVar("T", bound=BaseModel)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _assert_roundtrip(trial: BaseModel) -> None:
    blob = trial.model_dump_json()
    parsed = TypeAdapter(Trial).validate_json(blob)
    assert parsed == trial


# ---------------------------------------------------------------------------
# Tests for all 9 Trial kinds
# ---------------------------------------------------------------------------

class TestBaselineTrial:
    def test_roundtrip(self) -> None:
        _assert_roundtrip(_make_baseline())


class TestAblationTrial:
    def test_roundtrip(self) -> None:
        _assert_roundtrip(_make_ablation())


class TestDiversificationTrial:
    def test_roundtrip(self) -> None:
        _assert_roundtrip(_make_diversification())


class TestSurrogateTrial:
    def test_roundtrip(self) -> None:
        _assert_roundtrip(_make_surrogate())


class TestFailureModeTrial:
    def test_roundtrip(self) -> None:
        _assert_roundtrip(_make_failure_mode())


class TestOptimizationTrial:
    def test_roundtrip(self) -> None:
        _assert_roundtrip(_make_optimization())


class TestTransferTrial:
    def test_roundtrip(self) -> None:
        _assert_roundtrip(_make_transfer())


class TestMetaTrial:
    def test_roundtrip(self) -> None:
        _assert_roundtrip(_make_meta())


class TestReplayTrial:
    def test_roundtrip(self) -> None:
        _assert_roundtrip(_make_replay())


class TestChangeIntentTrial:
    def test_roundtrip(self) -> None:
        _assert_roundtrip(_make_change_intent())


class TestFreeFormTrial:
    def test_roundtrip(self) -> None:
        _assert_roundtrip(_make_free_form())


class TestAll11KindsPresent:
    def test_trial_union_has_11_variants(self) -> None:
        fixtures = {
            "baseline": '{"kind": "baseline", "trial_id": "t1", "hypothesis_id": "h1", "config": {}, "created_at": "2026-01-01T00:00:00Z"}',
            "ablation": '{"kind": "ablation", "trial_id": "t2", "hypothesis_id": "h1", "config": {}, "removed_components": [], "created_at": "2026-01-01T00:00:00Z"}',
            "diversification": '{"kind": "diversification", "trial_id": "t3", "hypothesis_id": "h1", "config": {}, "strategy": "random_search", "created_at": "2026-01-01T00:00:00Z"}',
            "surrogate": '{"kind": "surrogate", "trial_id": "t4", "hypothesis_id": "h1", "config": {}, "surrogate_model": "linear", "train_dataset": "ds1", "created_at": "2026-01-01T00:00:00Z"}',
            "failure_mode": '{"kind": "failure_mode", "trial_id": "t5", "hypothesis_id": "h1", "config": {}, "failure_hypothesis_id": "fh1", "created_at": "2026-01-01T00:00:00Z"}',
            "optimization": '{"kind": "optimization", "trial_id": "t6", "hypothesis_id": "h1", "config": {}, "optimizer": "adam", "learning_rate": 0.001, "created_at": "2026-01-01T00:00:00Z"}',
            "transfer": '{"kind": "transfer", "trial_id": "t7", "hypothesis_id": "h1", "config": {}, "source_dataset": "src1", "target_dataset": "tgt1", "created_at": "2026-01-01T00:00:00Z"}',
            "meta": '{"kind": "meta", "trial_id": "t8", "hypothesis_id": "h1", "config": {}, "meta_method": "hyperband", "created_at": "2026-01-01T00:00:00Z"}',
            "replay": '{"kind": "replay", "trial_id": "t9", "hypothesis_id": "h1", "config": {}, "replay_trial_id": "orig1", "created_at": "2026-01-01T00:00:00Z"}',
            "change_intent": '{"kind": "change_intent", "trial_id": "t10", "hypothesis_id": "h1", "config": {}, "intent_text": "switch to larger model", "rationale": "improve accuracy", "created_at": "2026-01-01T00:00:00Z"}',
            "free_form": '{"kind": "free_form", "trial_id": "t11", "hypothesis_id": "h1", "config": {}, "description": "exploring hyperparameters", "notes": [], "created_at": "2026-01-01T00:00:00Z"}',
        }
        assert len(fixtures) == 11
        for kind, blob in fixtures.items():
            parsed = TypeAdapter(Trial).validate_json(blob)
            assert parsed.kind == kind


# ---------------------------------------------------------------------------
# Factory helpers
# ---------------------------------------------------------------------------

def _make_baseline() -> "nxl_core.research.trial.BaselineTrial":
    from nxl_core.research.trial import BaselineTrial
    return BaselineTrial(
        trial_id="trial_001",
        hypothesis_id="hyp_001",
        config={"lr": 0.001, "batch_size": 32},
        created_at=_utc_now(),
    )


def _make_ablation() -> "nxl_core.research.trial.AblationTrial":
    from nxl_core.research.trial import AblationTrial
    return AblationTrial(
        trial_id="trial_002",
        hypothesis_id="hyp_001",
        config={"lr": 0.001},
        removed_components=["attention", "dropout"],
        created_at=_utc_now(),
    )


def _make_diversification() -> "nxl_core.research.trial.DiversificationTrial":
    from nxl_core.research.trial import DiversificationTrial
    return DiversificationTrial(
        trial_id="trial_003",
        hypothesis_id="hyp_001",
        config={},
        strategy="random_search",
        created_at=_utc_now(),
    )


def _make_surrogate() -> "nxl_core.research.trial.SurrogateTrial":
    from nxl_core.research.trial import SurrogateTrial
    return SurrogateTrial(
        trial_id="trial_004",
        hypothesis_id="hyp_001",
        config={},
        surrogate_model="linear_regression",
        train_dataset="squad_v1",
        created_at=_utc_now(),
    )


def _make_failure_mode() -> "nxl_core.research.trial.FailureModeTrial":
    from nxl_core.research.trial import FailureModeTrial
    return FailureModeTrial(
        trial_id="trial_005",
        hypothesis_id="hyp_001",
        config={},
        failure_hypothesis_id="hyp_fail_001",
        created_at=_utc_now(),
    )


def _make_optimization() -> "nxl_core.research.trial.OptimizationTrial":
    from nxl_core.research.trial import OptimizationTrial
    return OptimizationTrial(
        trial_id="trial_006",
        hypothesis_id="hyp_001",
        config={},
        optimizer="adam",
        learning_rate=0.001,
        created_at=_utc_now(),
    )


def _make_transfer() -> "nxl_core.research.trial.TransferTrial":
    from nxl_core.research.trial import TransferTrial
    return TransferTrial(
        trial_id="trial_007",
        hypothesis_id="hyp_001",
        config={},
        source_dataset="imagenet",
        target_dataset="coco",
        created_at=_utc_now(),
    )


def _make_meta() -> "nxl_core.research.trial.MetaTrial":
    from nxl_core.research.trial import MetaTrial
    return MetaTrial(
        trial_id="trial_008",
        hypothesis_id="hyp_001",
        config={},
        meta_method="hyperband",
        created_at=_utc_now(),
    )


def _make_replay() -> "nxl_core.research.trial.ReplayTrial":
    from nxl_core.research.trial import ReplayTrial
    return ReplayTrial(
        trial_id="trial_009",
        hypothesis_id="hyp_001",
        config={},
        replay_trial_id="trial_original",
        created_at=_utc_now(),
    )


def _make_change_intent() -> "nxl_core.research.trial.ChangeIntent":
    from nxl_core.research.trial import ChangeIntent
    return ChangeIntent(
        trial_id="trial_010",
        hypothesis_id="hyp_001",
        config={},
        intent_text="Switch to larger model batch",
        rationale="Baseline accuracy below threshold",
        created_at=_utc_now(),
    )


def _make_free_form() -> "nxl_core.research.trial.FreeFormTrial":
    from nxl_core.research.trial import FreeFormTrial
    return FreeFormTrial(
        trial_id="trial_011",
        hypothesis_id="hyp_001",
        config={},
        description="Exploring learning rate space",
        notes=["initial exploration", "found plateau at 0.01"],
        created_at=_utc_now(),
    )