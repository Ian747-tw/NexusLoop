import { dlopen, FFIType, suffix } from "bun:ffi";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

const LIBC_PATHS = [
  "/usr/lib/x86_64-linux-gnu/libc.so.6",
  "/lib/x86_64-linux-gnu/libc.so.6",
  "/usr/lib/libc.so.6",
  "/lib/libc.so.6",
];

function findLibC(): string {
  for (const candidate of LIBC_PATHS) {
    if (existsSync(candidate)) return candidate;
  }
  return `libc.${suffix}`;
}

const libc = dlopen(findLibC(), {
  flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
});

const LOCK_EX = 2;
const LOCK_UN = 8;
const LOCK_NB = 4;

export interface PidfileHandle {
  fd: number;
  path: string;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readOwnerPid(path: string): number | null {
  try {
    const raw = readFileSync(path, "utf-8").trim();
    if (!raw) return null;
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function acquire(path: string): PidfileHandle | null {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    writeFileSync(path, "");
  }

  const fd = openSync(path, "r+");
  const rc = libc.symbols.flock(fd, LOCK_EX | LOCK_NB);
  if (rc !== 0) {
    closeSync(fd);
    return null;
  }

  const previousPid = readOwnerPid(path);
  if (previousPid !== null && !isPidAlive(previousPid)) {
    // Stale pidfile content is harmless once this process owns the flock.
  }

  writeFileSync(path, `${process.pid}\n`);
  const syncFd = openSync(path, "r");
  fsyncSync(syncFd);
  closeSync(syncFd);
  return { fd, path };
}

export function release(handle: PidfileHandle | null): void {
  if (!handle) return;
  try {
    libc.symbols.flock(handle.fd, LOCK_UN);
  } finally {
    closeSync(handle.fd);
  }
}
