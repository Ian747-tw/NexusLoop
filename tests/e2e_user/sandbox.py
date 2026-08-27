from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request
import venv
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from .runner import BackgroundCommand, CliRunner, CommandResult


@dataclass(frozen=True)
class HttpResponse:
    status_code: int
    text: str


class Sandbox:
    def __init__(self, repo_root: Path, recorded_dir: Path) -> None:
        self.repo_root = repo_root
        self._tempdir = tempfile.TemporaryDirectory(prefix="nxl-e2e-")
        self.root = Path(self._tempdir.name)
        self.home = self.root / "home"
        self.xdg_config_home = self.root / "xdg_config"
        self.venv = self.root / ".venv"
        self.home.mkdir(parents=True)
        self.xdg_config_home.mkdir(parents=True)
        self._create_venv()
        self.env = self._build_env()
        self.runner = CliRunner(self.nxl_executable, self.env, recorded_dir)
        self._automatic_model_setup = True
        self._model_setup_bootstrap_active = False

    @property
    def python(self) -> Path:
        return self.venv / "bin" / "python"

    @property
    def nxl_executable(self) -> Path:
        return self.venv / "bin" / "nxl"

    def _create_venv(self) -> None:
        uv = shutil.which("uv")
        if uv:
            subprocess.run([uv, "venv", str(self.venv)], check=True, capture_output=True, text=True)
        else:
            venv.EnvBuilder(with_pip=True).create(self.venv)

    def _build_env(self) -> dict[str, str]:
        env = os.environ.copy()
        env["HOME"] = str(self.home)
        env["XDG_CONFIG_HOME"] = str(self.xdg_config_home)
        env["PATH"] = f"{self.venv / 'bin'}:{env.get('PATH', '')}"
        env["NO_COLOR"] = "1"
        env["PYTHONUNBUFFERED"] = "1"
        env["NXL_E2E_REPO_ROOT"] = str(self.repo_root)
        env["NXL_E2E_SANDBOX_ROOT"] = str(self.root)
        return env

    def install_from_current_repo(self, *, editable: bool = True) -> CommandResult:
        uv = shutil.which("uv")
        if uv:
            args = [uv, "pip", "install", "--python", str(self.python)]
            if editable:
                args.append("-e")
            args.append(str(self.repo_root))
        else:
            args = [str(self.python), "-m", "pip", "install"]
            if editable:
                args.append("-e")
            args.append(str(self.repo_root))
        completed = subprocess.run(
            args,
            cwd=self.root,
            env=self.env,
            text=True,
            capture_output=True,
            timeout=300,
            check=False,
        )
        return CommandResult(
            args=args,
            cwd=self.root,
            exit_code=completed.returncode,
            stdout=completed.stdout,
            stderr=completed.stderr,
        )

    def run_cli(
        self,
        args: Sequence[str],
        *,
        cwd: Path | None = None,
        stdin: str | None = None,
        timeout: int = 300,
        transcript_name: str | None = None,
    ) -> CommandResult:
        target = cwd or self.root
        self._bootstrap_unconfigured_model_setup(target, args)
        return self.runner.run(
            args,
            cwd=target,
            stdin=stdin,
            timeout=timeout,
            transcript_name=transcript_name,
        )

    def require_manual_model_setup(self) -> None:
        """Keep a scenario on the genuine missing-setup first-run path."""
        self._automatic_model_setup = False

    def _bootstrap_unconfigured_model_setup(self, project: Path, args: Sequence[str]) -> None:
        """Give pre-9W4E scenarios explicit setup through the real TUI boundary."""
        if not self._automatic_model_setup or self._model_setup_bootstrap_active or args:
            return
        if self.env.get("NXL_TUI_HEADLESS") != "1" or self.env.get("NXL_RUNTIME_CLIENT") != "real":
            return
        if any(
            key.startswith("NXL_COMMANDER_INVESTIGATION_") and value not in (None, "0")
            for key, value in self.env.items()
        ):
            return
        spec_path = project / ".nxl" / "spec" / "current.json"
        try:
            spec = json.loads(spec_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return
        if not isinstance(spec, dict) or spec.get("status") != "approved":
            return
        events_path = project / ".nxl" / "events.jsonl"
        if events_path.exists() and '"kind":"runtime_model_setup_committed"' in events_path.read_text(encoding="utf-8"):
            return
        prior_keys = self.env.get("NXL_TUI_KEYS")
        prior_runner_keys = self.runner.env.get("NXL_TUI_KEYS")
        keys = json.dumps([{"type": "submit"}] * 4)
        self.env["NXL_TUI_KEYS"] = keys
        self.runner.env["NXL_TUI_KEYS"] = keys
        self._model_setup_bootstrap_active = True
        try:
            result = self.runner.run([], cwd=project, timeout=300)
        finally:
            self._model_setup_bootstrap_active = False
            if prior_keys is None:
                self.env.pop("NXL_TUI_KEYS", None)
            else:
                self.env["NXL_TUI_KEYS"] = prior_keys
            if prior_runner_keys is None:
                self.runner.env.pop("NXL_TUI_KEYS", None)
            else:
                self.runner.env["NXL_TUI_KEYS"] = prior_runner_keys
        if result.exit_code != 0:
            raise AssertionError(result.stdout + result.stderr)
        events = events_path.read_text(encoding="utf-8") if events_path.exists() else ""
        if '"kind":"runtime_model_setup_committed"' not in events:
            raise AssertionError("real TUI did not commit the historical scenario model setup prerequisite")

    def run_cli_background(
        self,
        args: Sequence[str],
        *,
        cwd: Path | None = None,
        stdin: str | None = None,
    ) -> BackgroundCommand:
        return self.runner.background(args, cwd=cwd or self.root, stdin=stdin)

    def make_empty_project_dir(self, name: str = "demo_proj") -> Path:
        project = self.root / name
        project.mkdir(parents=True, exist_ok=False)
        return project

    def init_project(self, *, mode: str = "improve", plugin: str = "none") -> Path:
        project = self.make_empty_project_dir()
        result = self.run_cli(
            [
                "init",
                "--auto",
                "--project-mode",
                mode,
                "--skill-pack",
                "drl",
                "--plugin",
                plugin,
            ],
            cwd=project,
            timeout=300,
        )
        assert result.exit_code == 0, result.stdout + result.stderr
        return project

    def read_file(self, path: Path) -> str:
        return path.read_text(encoding="utf-8")

    def list_events(self, project: Path) -> list[dict[str, object]]:
        events_path = project / ".nxl" / "events.jsonl"
        if not events_path.exists():
            return []
        events: list[dict[str, object]] = []
        for line in events_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                events.append(json.loads(line))
        return events

    def assert_file_exists(self, path: Path) -> None:
        assert path.exists(), f"Expected file to exist: {path}"

    def wait_for_port(self, port: int, *, timeout: int = 30) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.settimeout(0.25)
                if sock.connect_ex(("127.0.0.1", port)) == 0:
                    return
            time.sleep(0.1)
        raise TimeoutError(f"Port did not open: {port}")

    def http_get(self, url: str, *, timeout: int = 30) -> HttpResponse:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
            return HttpResponse(status_code=response.status, text=body)

    def cleanup(self) -> None:
        self._tempdir.cleanup()
