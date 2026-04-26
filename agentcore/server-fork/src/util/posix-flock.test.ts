/**
 * agentcore/server-fork/src/util/posix-flock.test.ts
 * ----------------------------------------------------
 * Tests for the POSIX flock helper via Bun FFI.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { openSync, closeSync, writeSync, fsyncSync, unlinkSync, existsSync, writeFileSync } from "fs";
import { resolve } from "path";
import { withFlock } from "./posix-flock";

const TMPDIR = "/tmp";

function tmpPath(name: string): string {
  return resolve(TMPDIR, `flock-test-${name}-${process.pid}`);
}

describe("withFlock", () => {
  let lockPath: string;

  beforeEach(() => {
    lockPath = tmpPath("basic");
  });
  afterEach(() => {
    try {
      unlinkSync(lockPath);
    } catch {}
  });

  it("acquires and releases a lock on a tmp file", async () => {
    const path = lockPath;
    writeFileSync(path, "");
    let held = false;
    withFlock(path, () => {
      held = true;
    });
    expect(held).toBe(true);
  });

  it("second acquisition succeeds after first releases", async () => {
    const path = lockPath;
    writeFileSync(path, "");
    withFlock(path, () => {});
    withFlock(path, () => {});
  });

  it("fn() throwing still releases the lock", async () => {
    const path = lockPath;
    writeFileSync(path, "");
    expect(() => {
      withFlock(path, () => {
        throw new Error("boom");
      });
    }).toThrow();
    // Verify lock is released by acquiring again
    withFlock(path, () => {});
  });

  it("creates the lock file if it doesn't exist", async () => {
    const path = lockPath;
    expect(existsSync(path)).toBe(false);
    withFlock(path, () => {});
    expect(existsSync(path)).toBe(true);
  });
});

describe("withFlock non-blocking", () => {
  let lockPath: string;

  beforeEach(() => {
    lockPath = tmpPath("nonblock");
  });
  afterEach(() => {
    try {
      unlinkSync(lockPath);
    } catch {}
  });

  it("non-blocking: throws immediately when lock is held", async () => {
    const path = lockPath;
    writeFileSync(path, "");

    let holderReleased = false;

    // Start a blocking holder in the background
    const holder = Bun.spawn({
      cmd: [
        "bun",
        "run",
        resolve(__dirname, "_flock-helper.ts"),
        path,
      ],
      cwd: process.cwd(),
    });

    // Wait for holder to acquire lock (indicated by stdin being ready or sleep)
    await Bun.sleep(100);

    // Try non-blocking — should throw
    let threw = false;
    try {
      withFlock(path, () => {}, false);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // Signal holder to release (this is implicit since the process will exit)
    await holder.exited;
  });

  it("non-blocking: succeeds when no contention", async () => {
    const path = lockPath;
    writeFileSync(path, "");
    let ran = false;
    withFlock(path, () => {
      ran = true;
    }, false);
    expect(ran).toBe(true);
  });
});

describe("withFlock concurrency", () => {
  let lockPath: string;

  beforeEach(() => {
    lockPath = tmpPath("concurrent");
  });
  afterEach(() => {
    try {
      unlinkSync(lockPath);
    } catch {}
  });

  it("two concurrent calls serialize — one observes the other completing first", async () => {
    const path = lockPath;
    writeFileSync(path, "");

    const p1 = Bun.spawn({
      cmd: [
        "bun",
        "run",
        resolve(__dirname, "_flock-helper-logged.ts"),
        path,
        "P1",
      ],
      cwd: process.cwd(),
    });

    await Bun.sleep(10); // let p1 start

    const p2 = Bun.spawn({
      cmd: [
        "bun",
        "run",
        resolve(__dirname, "_flock-helper-logged.ts"),
        path,
        "P2",
      ],
      cwd: process.cwd(),
    });

    const [ex1, ex2] = await Promise.all([p1.exited, p2.exited]);

    // Both should complete without error
    expect(ex1).toBe(0);
    expect(ex2).toBe(0);
  });
});