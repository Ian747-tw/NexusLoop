"""
nxl_core.policy.engine
---------------------
PolicyEngine — deterministic rule evaluation using typed Rule objects.

check(action, details) runs all matching rules (priority descending),
returns the decision from the highest-priority matching rule.
DENY always wins over ALLOW.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from nxl_core.policy.rules import ALL_RULES, Rule, RuleEffect


@dataclass
class PolicyDecision:
    allowed: bool
    requires_confirmation: bool
    reason: str
    violated_rules: list[str] = field(default_factory=list)
    mode: str = "typed_rules"


class PolicyEngine:
    """
    Evaluates actions against typed Rule objects.

    Deterministic: rules are sorted by priority descending; the first
    matching rule's effect wins. DENY always takes precedence.
    """

    def __init__(self, project_dir: Path | None = None) -> None:
        self.project_dir = project_dir or Path.cwd()

    def check(
        self,
        action: str,
        details: dict[str, Any] | None = None,
    ) -> PolicyDecision:
        """
        Evaluate an action against all rules.

        Returns PolicyDecision with the outcome from the highest-priority
        matching rule. DENY always wins.
        """
        details = details or {}
        ctx = {"action": action, **details}

        # Evaluate all rules in priority order
        for rule in ALL_RULES:
            if self._rule_matches(rule, ctx):
                if rule.effect == RuleEffect.DENY:
                    return PolicyDecision(
                        allowed=False,
                        requires_confirmation=False,
                        reason=self._format_reason(rule, ctx),
                        violated_rules=[rule.id],
                        mode="typed_rules",
                    )
                elif rule.effect == RuleEffect.ALLOW:
                    return PolicyDecision(
                        allowed=True,
                        requires_confirmation=False,
                        reason=self._format_reason(rule, ctx),
                        violated_rules=[],
                        mode="typed_rules",
                    )

        # No rule matched → allowed by default
        return PolicyDecision(
            allowed=True,
            requires_confirmation=False,
            reason=f"Action '{action}' permitted (no matching rules).",
            violated_rules=[],
            mode="typed_rules",
        )

    def _rule_matches(self, rule: Rule, ctx: dict[str, Any]) -> bool:
        """Return True if rule's predicate matches the context."""
        try:
            return rule.predicate(ctx)
        except Exception:
            return False

    def _format_reason(self, rule: Rule, ctx: dict[str, Any]) -> str:
        """Fill in reason_template with detail from context."""
        try:
            return rule.reason_template.format(**ctx)
        except (KeyError, ValueError):
            return rule.reason_template
