from __future__ import annotations

from pathlib import Path
from typing import Iterator

import pytest

from .sandbox import Sandbox


@pytest.fixture
def sandbox() -> Iterator[Sandbox]:
    repo_root = Path(__file__).resolve().parents[2]
    recorded_dir = Path(__file__).resolve().parent / "recorded"
    box = Sandbox(repo_root=repo_root, recorded_dir=recorded_dir)
    try:
        yield box
    finally:
        box.cleanup()
