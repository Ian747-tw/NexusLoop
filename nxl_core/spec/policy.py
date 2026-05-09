"""Durable custom policy backend for project-local user rules."""
from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from nxl_core.events.log import EventLog
from nxl_core.events.schema import (
    CustomPolicyRuleCreated,
    CustomPolicyRuleDisabled,
    CustomPolicyRuleUpdated,
)


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


class CustomPolicyRule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rule_id: str
    source: Literal["user", "system", "spec"]
    scope: str
    effect: Literal["deny", "allow", "requires_approval", "warn"]
    reason: str
    enabled: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    superseded_by: str | None = None

    @field_validator("reason")
    @classmethod
    def reason_required(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("custom policy rule requires reason")
        return value.strip()


class PolicyStore:
    def __init__(self, project_dir: Path, *, event_log: EventLog | None = None) -> None:
        self.project_dir = Path(project_dir)
        self.policy_path = self.project_dir / ".nxl" / "spec" / "policy.json"
        self.event_log = event_log or EventLog(self.project_dir / ".nxl" / "events.jsonl")

    def addRule(
        self,
        *,
        source: Literal["user", "system", "spec"],
        scope: str,
        effect: Literal["deny", "allow", "requires_approval", "warn"],
        reason: str,
        enabled: bool = True,
    ) -> CustomPolicyRule:
        rule = CustomPolicyRule(
            rule_id=f"rule_{uuid4().hex}",
            source=source,
            scope=scope,
            effect=effect,
            reason=reason,
            enabled=enabled,
        )
        rules = self.listRules()
        rules.append(rule)
        self._write_rules(rules)
        self.event_log.append(
            CustomPolicyRuleCreated(rule_id=rule.rule_id, source=rule.source, scope=rule.scope, effect=rule.effect)
        )
        if not enabled:
            self.event_log.append(CustomPolicyRuleDisabled(rule_id=rule.rule_id, reason="created_disabled"))
        return rule

    def updateRule(self, rule_id: str, **patch: object) -> CustomPolicyRule:
        rules = self.listRules()
        updated: CustomPolicyRule | None = None
        next_rules: list[CustomPolicyRule] = []
        for rule in rules:
            if rule.rule_id == rule_id:
                data = rule.model_dump()
                data.update(patch)
                updated = CustomPolicyRule.model_validate(data)
                next_rules.append(updated)
            else:
                next_rules.append(rule)
        if updated is None:
            raise KeyError(f"unknown custom policy rule: {rule_id}")
        self._write_rules(next_rules)
        self.event_log.append(CustomPolicyRuleUpdated(rule_id=rule_id, enabled=updated.enabled))
        if not updated.enabled:
            self.event_log.append(CustomPolicyRuleDisabled(rule_id=rule_id, reason="updated_disabled"))
        return updated

    def listRules(self, *, active_only: bool = False) -> list[CustomPolicyRule]:
        if not self.policy_path.exists():
            return []
        data = json.loads(self.policy_path.read_text(encoding="utf-8"))
        rules = [CustomPolicyRule.model_validate(item) for item in data.get("rules", [])]
        if active_only:
            return [rule for rule in rules if rule.enabled and rule.superseded_by is None]
        return rules

    def evaluateUserPolicyMetadata(self, scope: str) -> dict[str, list[str]]:
        result = {"deny": [], "allow": [], "requires_approval": [], "warn": []}
        for rule in self.listRules(active_only=True):
            if scope == rule.scope or scope.startswith(rule.scope) or rule.scope in scope:
                result[rule.effect].append(rule.rule_id)
        return result

    def _write_rules(self, rules: list[CustomPolicyRule]) -> None:
        data = {"rules": [rule.model_dump(mode="json") for rule in rules]}
        _atomic_write(self.policy_path, json.dumps(data, indent=2))
