from __future__ import annotations

from pathlib import Path

from nxl.core import run as run_mod


def test_run_refuses_commander_executor_without_approved_spec(tmp_path: Path, monkeypatch) -> None:
    (tmp_path / ".nxl").mkdir()
    monkeypatch.chdir(tmp_path)

    assert run_mod.run(tmp_path, dry_run=False, provider="ollama") == 1


def test_run_dry_run_does_not_require_approved_spec(tmp_path: Path, monkeypatch) -> None:
    (tmp_path / ".nxl").mkdir()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("NXL_EVENTLOG_WRITER", "test")

    assert run_mod.run(tmp_path, dry_run=True, provider="ollama") == 0
