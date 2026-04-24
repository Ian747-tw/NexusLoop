"""nxl/core/agent_runner.py — rewritten as OpenCodeClient streaming adapter."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from agentcore.client_py.client import OpenCodeClient
from nxl_core.events.log import EventLog


@dataclass
class AgentRunResult:
    """Preserved for backward compatibility with nxl/core/run.py."""
    backend: str
    ok: bool
    exit_code: int
    stdout_log: Path
    stderr_log: Path
    command: list[str]


# -------------------------------------------------------------------------- #
# OpenCode backend (new path)
# -------------------------------------------------------------------------- #

class OpenCodeBackend:
    """Polymorphic backend: OpenCode as primary."""

    def __init__(self):
        self._client = OpenCodeClient()
        self._event_log = EventLog()

    def run_cycle(self, brief: str) -> dict:
        result = self._client.run_cycle(
            brief=brief,
            policy_endpoint='http://localhost:9001/policy',
            events_endpoint='http://localhost:9001/events',
        )
        # Write events to log
        for event in result.events:
            self._event_log.append(event)
        return {
            'cycle_id': result.cycle_id,
            'tool_calls': result.tool_calls,
            'blocked': result.blocked,
        }


def detect_backend() -> str:
    """Detect the best available backend (always opencode in new design)."""
    return 'opencode'


def run_agent_cycle(brief: str, backend: str = 'opencode') -> dict:
    """Run a single agent cycle using the specified backend."""
    if backend == 'opencode':
        return OpenCodeBackend().run_cycle(brief)
    raise ValueError(f'Unknown backend: {backend}')


# -------------------------------------------------------------------------- #
# Stubbed helpers — preserved for backward compatibility with nxl/core/run.py
# -------------------------------------------------------------------------- #

_AUTONOMOUS_POLICIES = {"open", "project-only", "bootstrap-only"}


def load_onboarding_context(project_dir: Path) -> dict[str, Any]:
    """Stub — load onboarding context from project directory."""
    config_dir = Path(project_dir) / ".nxl"
    import json
    for path in (config_dir / "onboarding.yaml", config_dir / "onboarding.json"):
        if not path.exists():
            continue
        try:
            import yaml  # type: ignore
            if path.suffix == ".yaml":
                data = yaml.safe_load(path.read_text(encoding="utf-8"))
            else:
                data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
        except Exception:
            continue
    return {}


def load_permission_policy(project_dir: Path) -> str:
    """Stub — load permission policy from project directory."""
    onboarding = load_onboarding_context(project_dir)
    permissions = onboarding.get("permissions", {})
    if isinstance(permissions, dict):
        policy = permissions.get("policy")
        if isinstance(policy, str) and policy.strip():
            return policy.strip()
    return "open"


def autonomous_policy_allowed(project_dir: Path) -> bool:
    """Stub — check if autonomous policy is allowed."""
    return load_permission_policy(project_dir) in _AUTONOMOUS_POLICIES


def build_agent_prompt(
    project_dir: Path,
    state: dict[str, Any],
    experiment: dict[str, Any],
    project_mode: str,
    resume_override_message: str = "",
) -> str:
    """Stub — build agent prompt (delegated to TS server in new design)."""
    # The TS server (OpenCode) handles prompt construction internally
    return ""
