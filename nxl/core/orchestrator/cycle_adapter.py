"""nxl/core/orchestrator/cycle_adapter.py — calls agentcore.client_py."""
from __future__ import annotations

from agentcore.client_py.client import OpenCodeClient


class CycleAdapter:
    def __init__(self):
        self._client = OpenCodeClient()

    def run_cycle(self, brief: str, provider: str | None = None) -> dict:
        return self._client.run_cycle(brief, provider=provider, policy_endpoint='', events_endpoint='')