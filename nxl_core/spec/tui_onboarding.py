"""Minimal real TUI-to-spec backend bridge.

This is intentionally deterministic. It provides a fake extractor suitable for
local onboarding tests and does not call an LLM or start commander/executor.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from nxl_core.events.log import event_writer
from nxl_core.spec.backend import SpecStore


PENDING_PATH = Path(".nxl/spec/pending.json")


def _mock_extractor(text: str) -> dict[str, Any]:
    return {
        "objective": text,
        "project_mode": "build",
        "domain": "unspecified",
        "environment": "unspecified",
        "success_metrics": ["user-approved onboarding objective captured"],
        "evaluation_protocol": "User-approved plain-text onboarding spec.",
        "compute_policy": {
            "gpu_allowed": False,
            "gpu_memory_limit_gb": None,
            "cpu_worker_limit": 1,
            "max_parallel_training_runs": 1,
            "checkpoint_disk_limit_gb": 1,
        },
        "wake_hook_policy": {
            "enabled": True,
            "user_min_period_minutes": 15,
            "user_max_period_minutes": 240,
            "default_training_period_minutes": 60,
            "allow_agent_suggested_hooks": False,
            "require_approval_below_minutes": 30,
        },
        "user_rules": [],
        "forbidden_actions": [],
    }


def _pending_path(project_dir: Path) -> Path:
    return project_dir / PENDING_PATH


def _write_pending(project_dir: Path, spec_id: str) -> None:
    path = _pending_path(project_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"spec_id": spec_id}, indent=2), encoding="utf-8")


def _read_pending(project_dir: Path) -> str | None:
    path = _pending_path(project_dir)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    spec_id = data.get("spec_id")
    return spec_id if isinstance(spec_id, str) else None


def _clear_pending(project_dir: Path) -> None:
    try:
        _pending_path(project_dir).unlink()
    except FileNotFoundError:
        pass


def handle_message(project_dir: Path, message: str) -> dict[str, Any]:
    project_dir = project_dir.resolve()
    store = SpecStore(project_dir, extractor=_mock_extractor)
    normalized = message.strip().lower()
    with event_writer("cli"):
        if normalized in {"approve", "approve spec", "approved", "yes", "yes approve"}:
            spec_id = _read_pending(project_dir)
            if spec_id is None:
                return {"status": "no_pending_spec"}
            approved = store.approveDraft(spec_id, approved_by="tui-user")
            _clear_pending(project_dir)
            return {"status": "approved", "spec_id": approved.spec_id}

        result = store.createDraftFromPlainText(message)
        _write_pending(project_dir, result.spec.spec_id)
        return {
            "status": "draft_created",
            "spec_id": result.spec.spec_id,
            "requires_clarification": result.requires_clarification,
        }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-dir", required=True)
    parser.add_argument("--message", required=True)
    args = parser.parse_args(argv)
    result = handle_message(Path(args.project_dir), args.message)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
