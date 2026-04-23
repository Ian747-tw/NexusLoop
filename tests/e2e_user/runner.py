from __future__ import annotations

import difflib
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence


@dataclass(frozen=True)
class CommandResult:
    args: list[str]
    cwd: Path
    exit_code: int
    stdout: str
    stderr: str


class BackgroundCommand:
    def __init__(self, process: subprocess.Popen[str]) -> None:
        self.process = process

    def __enter__(self) -> subprocess.Popen[str]:
        return self.process

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None:
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=10)


class CliRunner:
    def __init__(self, executable: Path, env: Mapping[str, str], recorded_dir: Path) -> None:
        self.executable = executable
        self.env = dict(env)
        self.recorded_dir = recorded_dir

    def run(
        self,
        args: Sequence[str],
        cwd: Path,
        *,
        stdin: str | None = None,
        timeout: int = 300,
        transcript_name: str | None = None,
    ) -> CommandResult:
        command = [str(self.executable), *args]
        completed = subprocess.run(
            command,
            cwd=cwd,
            env=self.env,
            input=stdin,
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
        result = CommandResult(
            args=list(args),
            cwd=Path(cwd),
            exit_code=completed.returncode,
            stdout=completed.stdout,
            stderr=completed.stderr,
        )
        if transcript_name:
            self.assert_or_record(transcript_name, result)
        return result

    def background(
        self,
        args: Sequence[str],
        cwd: Path,
        *,
        stdin: str | None = None,
    ) -> BackgroundCommand:
        command = [str(self.executable), *args]
        process = subprocess.Popen(
            command,
            cwd=cwd,
            env=self.env,
            stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if stdin is not None and process.stdin is not None:
            process.stdin.write(stdin)
            process.stdin.close()
        return BackgroundCommand(process)

    def assert_or_record(self, name: str, result: CommandResult) -> None:
        self.recorded_dir.mkdir(parents=True, exist_ok=True)
        path = self.recorded_dir / f"{name}.txt"
        transcript = self._format_transcript(result)
        if not path.exists():
            path.write_text(transcript, encoding="utf-8")
            return
        expected = path.read_text(encoding="utf-8")
        if expected != transcript:
            diff = "\n".join(
                difflib.unified_diff(
                    expected.splitlines(),
                    transcript.splitlines(),
                    fromfile=str(path),
                    tofile="current",
                    lineterm="",
                )
            )
            raise AssertionError(f"CLI transcript changed for {name}:\n{diff}")

    def _format_transcript(self, result: CommandResult) -> str:
        cwd = self._normalize(str(result.cwd))
        stdout = self._normalize(result.stdout.rstrip())
        stderr = self._normalize(result.stderr.rstrip())
        command = " ".join(["nxl", *result.args])
        return (
            f"$ cd {cwd}\n"
            f"$ {command}\n"
            f"exit_code={result.exit_code}\n"
            f"--- stdout ---\n{stdout}\n"
            f"--- stderr ---\n{stderr}\n"
        )

    def _normalize(self, text: str) -> str:
        normalized = text
        home = self.env.get("HOME")
        if home:
            normalized = normalized.replace(home, "<SANDBOX_HOME>")
        repo_root = os.environ.get("NXL_E2E_REPO_ROOT")
        if repo_root:
            normalized = normalized.replace(repo_root, "<REPO_ROOT>")
        sandbox_root = self.env.get("NXL_E2E_SANDBOX_ROOT")
        if sandbox_root:
            normalized = normalized.replace(sandbox_root, "<SANDBOX>")
        return normalized
