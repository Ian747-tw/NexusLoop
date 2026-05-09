"""Python shim for launching the TypeScript OpenTUI shell."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path


def _ensure_dependencies(tui_dir: Path, env: dict[str, str]) -> int:
    if shutil.which("bun") is None:
        print("NexusLoop OpenTUI requires `bun` to launch.", flush=True)
        return 1

    if (tui_dir / "node_modules").is_dir():
        return 0

    if env.get("NXL_TUI_AUTO_INSTALL") == "1":
        result = subprocess.run(
            ["bun", "install", "--frozen-lockfile"],
            cwd=str(tui_dir),
            env=env,
            check=False,
        )
        return result.returncode

    print(
        "NexusLoop OpenTUI dependencies are not installed. "
        "Run: cd agentcore/tui && bun install --frozen-lockfile",
        flush=True,
    )
    return 1


def run(project_dir: Path) -> int:
    """Launch the NexusLoop OpenTUI shell for ``project_dir``."""
    tui_dir = Path(__file__).resolve().parent
    env = os.environ.copy()
    dependency_status = _ensure_dependencies(tui_dir, env)
    if dependency_status != 0:
        return dependency_status

    entry = tui_dir / "src" / "index.tsx"
    env["NXL_PROJECT_DIR"] = str(project_dir)

    return subprocess.call(["bun", "run", str(entry)], cwd=str(tui_dir), env=env)
