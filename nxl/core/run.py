#!/usr/bin/env python3
"""nxl.core.run — entry point only (≤80 lines)."""
from __future__ import annotations

import signal
import sys
from pathlib import Path

from nxl.cli import console
from nxl.core.orchestrator.bootstrap import bootstrap, setup_sigint_handler
from nxl.core.orchestrator.loop import OrchestrationLoop
from nxl.core.orchestrator.cycle_adapter import CycleAdapter
from nxl.core.state import ProjectState


def main() -> int:
    project_dir = Path.cwd()

    config_dir = project_dir / ".nxl"
    if not config_dir.is_dir():
        console("Project not initialised. Run `nxl init` first.", "error")
        return 1

    bootstrap(config_dir)
    state = ProjectState.load(project_dir)

    _, old_handler = setup_sigint_handler()

    adapter = CycleAdapter()
    loop = OrchestrationLoop(adapter)

    brief = state.flags.get("brief", "")
    result = loop.run_cycle(brief)

    signal.signal(signal.SIGINT, old_handler)
    return 0


if __name__ == '__main__':
    sys.exit(main() or 0)