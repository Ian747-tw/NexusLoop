from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def _run_nxl_headless(project: Path, keys: str | None = None) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["NXL_TUI_HEADLESS"] = "1"
    repo_root = Path(__file__).resolve().parents[3]
    env["PYTHONPATH"] = f"{repo_root}{os.pathsep}{env.get('PYTHONPATH', '')}"
    if keys is not None:
        env["NXL_TUI_KEYS"] = keys
    return subprocess.run(
        [sys.executable, "-m", "nxl"],
        cwd=project,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def test_nxl_empty_project_opens_tui_init_state(tmp_path: Path) -> None:
    result = _run_nxl_headless(tmp_path)

    assert result.returncode == 0, result.stderr
    assert "NexusLoop OpenTUI shell" in result.stdout
    assert "screen=init" in result.stdout
    assert "Project not initialized" in result.stdout
    assert "> Initialize" in result.stdout


def test_nxl_initialized_project_opens_resume_state(tmp_path: Path) -> None:
    (tmp_path / ".nxl").mkdir()

    result = _run_nxl_headless(tmp_path)

    assert result.returncode == 0, result.stderr
    assert "screen=resume" in result.stdout
    assert "mission=mission-placeholder" in result.stdout
    assert "> Resume previous run" in result.stdout
    assert "Dashboard is deprecated" not in result.stdout


def test_nxl_headless_keyboard_select_initialize(tmp_path: Path) -> None:
    result = _run_nxl_headless(tmp_path, keys='[{"type":"submit"}]')

    assert result.returncode == 0, result.stderr
    assert "screen=main" in result.stdout
    assert "work_intent=TUI onboarding shell" in result.stdout
    assert "Initialize selected" in result.stdout
