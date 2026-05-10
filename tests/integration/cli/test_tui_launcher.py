from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from agentcore.tui import launcher


def test_launcher_auto_installs_by_default(
    tmp_path: Path,
    monkeypatch,
    capsys,
) -> None:
    calls: list[list[str]] = []
    monkeypatch.setattr(launcher.shutil, "which", lambda name: "/usr/bin/bun")
    monkeypatch.setattr(
        launcher.subprocess,
        "run",
        lambda args, **kwargs: calls.append(list(args)) or SimpleNamespace(returncode=0),
    )

    status = launcher._ensure_dependencies(tmp_path, {})

    assert status == 0
    assert calls == [["bun", "install", "--frozen-lockfile"]]
    assert "Installing NexusLoop OpenTUI dependencies with bun" in capsys.readouterr().out


def test_launcher_auto_install_can_be_disabled(tmp_path: Path, monkeypatch, capsys) -> None:
    calls: list[list[str]] = []
    monkeypatch.setattr(launcher.shutil, "which", lambda name: "/usr/bin/bun")
    monkeypatch.setattr(
        launcher.subprocess,
        "run",
        lambda args, **kwargs: calls.append(list(args)) or SimpleNamespace(returncode=0),
    )

    status = launcher._ensure_dependencies(tmp_path, {"NXL_TUI_AUTO_INSTALL": "0"})

    assert status == 1
    assert calls == []
    assert "cd agentcore/tui && bun install --frozen-lockfile" in capsys.readouterr().out


def test_launcher_skips_install_when_node_modules_exists(tmp_path: Path, monkeypatch) -> None:
    calls: list[list[str]] = []
    (tmp_path / "node_modules").mkdir()
    monkeypatch.setattr(launcher.shutil, "which", lambda name: "/usr/bin/bun")
    monkeypatch.setattr(
        launcher.subprocess,
        "run",
        lambda args, **kwargs: calls.append(list(args)) or SimpleNamespace(returncode=0),
    )

    status = launcher._ensure_dependencies(tmp_path, {})

    assert status == 0
    assert calls == []
