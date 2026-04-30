// @ts-ignore
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { acquire, readOwnerPid, release } from "./pidfile";

const tempDirs: string[] = [];
const childProcs: Array<ReturnType<typeof Bun.spawn>> = [];

function makeLockPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "nxl-pidfile-ts-"));
  mkdirSync(join(dir, ".nxl"), { recursive: true });
  tempDirs.push(dir);
  return join(dir, ".nxl", "run.lock");
}

afterEach(async () => {
  for (const child of childProcs.splice(0)) {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await child.exited;
    }
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("pidfile.ts", () => {
  it("acquire -> release -> re-acquire works", () => {
    const path = makeLockPath();
    const first = acquire(path);
    expect(first).not.toBeNull();
    expect(readOwnerPid(path)).toBe(process.pid);

    release(first);

    const second = acquire(path);
    expect(second).not.toBeNull();
    expect(readOwnerPid(path)).toBe(process.pid);
    release(second);
  });

  it("another process attempting acquire while held fails", async () => {
    const path = makeLockPath();
    const first = acquire(path);
    expect(first).not.toBeNull();

    const helperPath = resolve(import.meta.dir, "_pidfile-helper.ts");
    const child = Bun.spawn(["bun", "run", helperPath, path], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    childProcs.push(child);
    const output = await new Response(child.stdout).text();
    const code = await child.exited;

    expect(code).toBe(0);
    expect(output.trim()).toBe("acquire_failed");
    release(first);
  });

  it("stale pidfile content without a live lock holder is taken over", () => {
    const path = makeLockPath();
    writeFileSync(path, "999999\n");

    const handle = acquire(path);
    expect(handle).not.toBeNull();
    expect(readOwnerPid(path)).toBe(process.pid);
    release(handle);
  });
});
