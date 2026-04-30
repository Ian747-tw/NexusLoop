from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import portalocker


@dataclass
class PidfileHandle:
    path: Path
    fileobj: object


def read_owner_pid(path: str | Path) -> int | None:
    try:
        raw = Path(path).read_text().strip()
    except OSError:
        return None
    if not raw:
        return None
    try:
        pid = int(raw)
    except ValueError:
        return None
    return pid if pid > 0 else None


def acquire(path: str | Path) -> PidfileHandle | None:
    pidfile_path = Path(path)
    pidfile_path.parent.mkdir(parents=True, exist_ok=True)
    pidfile_path.touch(exist_ok=True)

    fileobj = pidfile_path.open("r+")
    try:
        portalocker.lock(fileobj, portalocker.LOCK_EX | portalocker.LOCK_NB)
    except portalocker.LockException:
        fileobj.close()
        return None

    fileobj.seek(0)
    fileobj.truncate()
    fileobj.write(f"{os.getpid()}\n")
    fileobj.flush()
    os.fsync(fileobj.fileno())
    return PidfileHandle(path=pidfile_path, fileobj=fileobj)


def release(handle: PidfileHandle | None) -> None:
    if handle is None:
        return
    fileobj = handle.fileobj
    try:
        portalocker.unlock(fileobj)
    finally:
        fileobj.close()
