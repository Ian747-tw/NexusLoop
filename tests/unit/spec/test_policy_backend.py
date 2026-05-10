from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from nxl_core.events.log import EventLog
from nxl_core.spec.policy import PolicyStore


os.environ["NXL_EVENTLOG_WRITER"] = "test"


def test_custom_policy_rule_validation_and_listing(tmp_path: Path) -> None:
    store = PolicyStore(tmp_path, event_log=EventLog(tmp_path / ".nxl" / "events.jsonl"))

    with pytest.raises(ValueError, match="reason"):
        store.addRule(source="user", scope="training", effect="deny", reason="")

    active = store.addRule(
        source="user",
        scope="training.full",
        effect="requires_approval",
        reason="Full training consumes GPU quota.",
    )
    disabled = store.addRule(
        source="user",
        scope="debug",
        effect="warn",
        reason="Debug runs are noisy.",
        enabled=False,
    )

    assert store.listRules() == [active, disabled]
    assert store.listRules(active_only=True) == [active]
    assert store.evaluateUserPolicyMetadata("training.full")["requires_approval"] == [active.rule_id]

    updated = store.updateRule(active.rule_id, enabled=False, superseded_by="replacement")
    assert updated.enabled is False
    assert updated.superseded_by == "replacement"
    assert store.evaluateUserPolicyMetadata("training.full")["requires_approval"] == []

    kinds = [json.loads(line)["kind"] for line in (tmp_path / ".nxl" / "events.jsonl").read_text().splitlines()]
    assert kinds.count("custom_policy_rule_created") == 2
    assert "custom_policy_rule_updated" in kinds
    assert "custom_policy_rule_disabled" in kinds


def test_custom_policy_scope_matching_is_delimiter_aware(tmp_path: Path) -> None:
    store = PolicyStore(tmp_path, event_log=EventLog(tmp_path / ".nxl" / "events.jsonl"))
    train = store.addRule(
        source="user",
        scope="train",
        effect="requires_approval",
        reason="Training launches require approval.",
    )
    store.addRule(
        source="user",
        scope="rain",
        effect="deny",
        reason="Rain scope should not match train.",
    )
    reward = store.addRule(
        source="user",
        scope="reward",
        effect="warn",
        reason="Reward root scope only.",
    )

    assert store.evaluateUserPolicyMetadata("train")["requires_approval"] == [train.rule_id]
    assert store.evaluateUserPolicyMetadata("train.launch")["requires_approval"] == [train.rule_id]
    assert store.evaluateUserPolicyMetadata("train/launch")["requires_approval"] == [train.rule_id]
    assert store.evaluateUserPolicyMetadata("train:launch")["requires_approval"] == [train.rule_id]

    assert store.evaluateUserPolicyMetadata("train.launch")["deny"] == []
    assert store.evaluateUserPolicyMetadata("training.reward_function")["warn"] == []
    assert store.evaluateUserPolicyMetadata("reward.metric")["warn"] == [reward.rule_id]

    store.updateRule(train.rule_id, enabled=False)
    assert store.evaluateUserPolicyMetadata("train.launch")["requires_approval"] == []
