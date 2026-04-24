"""nxl/core/orchestrator/loop.py — extracted turn loop from run.py."""
from __future__ import annotations

from nxl.core.orchestrator.cycle_adapter import CycleAdapter


class OrchestrationLoop:
    def __init__(self, adapter: CycleAdapter):
        self._adapter = adapter

    def run_cycle(self, brief: str) -> dict:
        return self._adapter.run_cycle(brief)