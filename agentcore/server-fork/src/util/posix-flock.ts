/**
 * POSIX flock(2) wrapper using Bun's native FFI.
 *
 * Why this exists:
 *   proper-lockfile uses mkdir-based locking; portalocker (Python) uses
 *   fcntl/flock. They don't coordinate. To make cross-language locks
 *   actually mutually exclude, both sides must call the SAME OS primitive
 *   on the SAME file. This module makes the TS side call flock(2)
 *   directly via FFI.
 *
 * Constraints:
 *   - Linux + macOS only (POSIX). On Windows, swap for LockFileEx via
 *     a separate shim. Project is POSIX-only today; revisit if Windows
 *     support is needed.
 *   - flock is ADVISORY: both sides must opt in. Both Python and TS
 *     paths in this codebase do. No third-party writer should exist.
 */
import { dlopen, FFIType, suffix } from "bun:ffi";
import { openSync, closeSync, existsSync, writeFileSync } from "fs";

// Find libc on this platform — try well-known paths before falling back
const LIBC_PATHS = [
  "/usr/lib/x86_64-linux-gnu/libc.so.6",
  "/lib/x86_64-linux-gnu/libc.so.6",
  "/usr/lib/libc.so.6",
  "/lib/libc.so.6",
];

function findLibC(): string {
  for (const p of LIBC_PATHS) {
    if (existsSync(p)) return p;
  }
  return `libc.${suffix}`;
}

const libc = dlopen(findLibC(), {
  flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
});

const LOCK_EX = 2;
const LOCK_UN = 8;
const LOCK_NB = 4; // non-blocking; flock returns -1 if would block

/**
 * Execute `fn` while holding an exclusive flock on `lockPath`.
 *
 * @param lockPath  - path to the lock file (created if missing)
 * @param fn       - callback to run under the lock
 * @param blocking - if false, use LOCK_EX | LOCK_NB (non-blocking); throws if contention
 */
export function withFlock<T>(
  lockPath: string,
  fn: () => T,
  blocking: boolean = true,
): T {
  if (!existsSync(lockPath)) {
    writeFileSync(lockPath, "");
  }
  const fd = openSync(lockPath, "r+");
  try {
    const flag = blocking ? LOCK_EX : LOCK_EX | LOCK_NB;
    const rc = libc.symbols.flock(fd, flag);
    if (rc !== 0) {
      throw new Error(
        `flock failed on ${lockPath} (rc=${rc}, blocking=${blocking})`,
      );
    }
    try {
      return fn();
    } finally {
      libc.symbols.flock(fd, LOCK_UN);
    }
  } finally {
    closeSync(fd);
  }
}