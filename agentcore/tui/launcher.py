"""Python shim for launching the TypeScript OpenTUI shell."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path


def run(project_dir: Path) -> int:
    """Launch the NexusLoop OpenTUI shell for ``project_dir``."""
    if shutil.which("bun") is None:
        print("NexusLoop OpenTUI requires `bun` to launch.", flush=True)
        return 1

    tui_dir = Path(__file__).resolve().parent
    entry = tui_dir / "src" / "index.tsx"
    if not (tui_dir / "node_modules").is_dir():
        install = subprocess.run(
            ["bun", "install", "--frozen-lockfile"],
            cwd=str(tui_dir),
            env=os.environ.copy(),
            check=False,
        )
        if install.returncode != 0:
            return install.returncode

    env = os.environ.copy()
    env["NXL_PROJECT_DIR"] = str(project_dir)

    return subprocess.call(["bun", "run", str(entry)], cwd=str(tui_dir), env=env)
