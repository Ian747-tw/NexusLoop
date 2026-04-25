"""
nxl_core.capsule.handoff
------------------------
HandoffRecord: agent-to-agent context transfer with token limits.

summary ≤ 500 tokens, hints ≤ 200 tokens.
Token estimate: len(text) // 4 (≈4 chars/token).
"""
from __future__ import annotations

import json
import yaml
from pathlib import Path

from pydantic import BaseModel, Field, model_validator


class HandoffRecord(BaseModel):
    """Agent-to-agent handoff record with enforced token budgets."""

    from_agent: str = ""
    to_agent: str = ""
    reason: str = ""
    summary: str = ""
    hints: str = ""
    id: str = Field(default="", description="Unique handoff identifier")
    spec_hash: int = Field(default=0, description="Hash of project.yaml at handoff time")
    event_cursor: list[dict] = Field(default_factory=list, description="Event log cursor for resume")

    @model_validator(mode="after")
    def check_token_limits(self) -> "HandoffRecord":
        summary_tokens = len(self.summary) // 4
        if summary_tokens > 500:
            raise ValueError(f"summary exceeds 500-token budget ({summary_tokens}t)")
        hints_tokens = len(self.hints) // 4
        if hints_tokens > 200:
            raise ValueError(f"hints exceeds 200-token budget ({hints_tokens}t)")
        return self

    @classmethod
    def load_latest(cls, events_path: Path) -> "HandoffRecord":
        """Load most recent HandoffRecord from events.jsonl (by event_id, not timestamp)."""
        if not events_path.exists():
            raise ValueError("No events.jsonl found")

        lines = events_path.read_text().splitlines()
        # Parse backwards (most recent first)
        for line in reversed(lines):
            line = line.strip()
            if not line:
                continue
            try:
                raw = json.loads(line)
                if raw.get("kind") == "handoff_recorded":
                    return cls(
                        id=raw["data"].get("handoff_id", ""),
                        from_agent=raw["data"].get("from_agent", ""),
                        to_agent=raw["data"].get("to_agent", ""),
                        event_cursor=raw.get("event_cursor", []),
                        spec_hash=raw.get("spec_hash", 0),
                    )
            except (json.JSONDecodeError, KeyError):
                continue

        raise ValueError("No handoff record found")

    def verify_spec(self, project_yaml: Path) -> bool:
        """Verify project.yaml spec_hash matches this HandoffRecord's spec_hash."""
        if not project_yaml.exists():
            if self.spec_hash == 0:
                return True  # spec_hash=0 means no project.yaml was used at handoff time
            return False  # spec_hash != 0 but project.yaml gone → treat as mismatch
        data = yaml.safe_load(project_yaml.read_text())
        spec_hash = hash(yaml.dump(data, sort_keys=True))
        return spec_hash == self.spec_hash
