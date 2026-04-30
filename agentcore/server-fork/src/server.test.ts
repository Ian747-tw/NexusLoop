// @ts-ignore
import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

const SERVER_PATH = resolve(import.meta.dir, "server.ts");

type ServerProc = ReturnType<typeof Bun.spawn>;

const spawned: ServerProc[] = [];
const tempDirs: string[] = [];

function createProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "nxl-server-test-"));
  mkdirSync(join(dir, ".nxl"), { recursive: true });
  tempDirs.push(dir);
  return dir;
}

async function readLine(stream: ReadableStream<Uint8Array> | null | undefined): Promise<string> {
  if (!stream) throw new Error("stream unavailable");
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const newline = buffer.indexOf("\n");
    if (newline !== -1) {
      reader.releaseLock();
      return buffer.slice(0, newline);
    }
  }
  reader.releaseLock();
  return buffer;
}

async function waitForReady(proc: ServerProc): Promise<Record<string, unknown>> {
  const line = await readLine(proc.stdout as ReadableStream<Uint8Array> | null | undefined);
  return JSON.parse(line);
}

function spawnServer(projectDir: string, env: Record<string, string> = {}): ServerProc {
  const proc = Bun.spawn(["bun", "run", SERVER_PATH], {
    cwd: projectDir,
    env: { ...process.env, ...env },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  spawned.push(proc);
  return proc;
}

function pidfilePath(projectDir: string): string {
  return join(projectDir, ".nxl", "run.lock");
}

async function waitForExit(proc: ServerProc): Promise<number> {
  return await proc.exited;
}

afterEach(async () => {
  for (const proc of spawned.splice(0)) {
    if (proc.exitCode === null) {
      proc.kill("SIGTERM");
      await proc.exited;
    }
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("server.ts", () => {
  it("creates .nxl/run.lock containing the server PID", async () => {
    const projectDir = createProjectDir();
    const proc = spawnServer(projectDir);
    const ready = await waitForReady(proc);
    const pidfile = pidfilePath(projectDir);

    expect(ready.type).toBe("ready");
    expect(existsSync(pidfile)).toBe(true);
    expect(readFileSync(pidfile, "utf-8").trim()).toBe(String(proc.pid));
  });

  it("rejects a second server against the same project dir", async () => {
    const projectDir = createProjectDir();
    const first = spawnServer(projectDir);
    await waitForReady(first);

    const pidfile = pidfilePath(projectDir);
    const original = readFileSync(pidfile, "utf-8").trim();

    const second = spawnServer(projectDir);
    const stderr = await readLine(second.stderr as ReadableStream<Uint8Array> | null | undefined);
    const rc = await waitForExit(second);

    expect(rc).not.toBe(0);
    expect(stderr).toContain("another nxl run is active");
    expect(readFileSync(pidfile, "utf-8").trim()).toBe(original);
  });

  it("releases the pidfile on SIGTERM so a later server can start", async () => {
    const projectDir = createProjectDir();
    const first = spawnServer(projectDir);
    await waitForReady(first);

    first.kill("SIGTERM");
    await waitForExit(first);

    const second = spawnServer(projectDir);
    const ready = await waitForReady(second);

    expect(ready.type).toBe("ready");
    expect(readFileSync(pidfilePath(projectDir), "utf-8").trim()).toBe(String(second.pid));
  });

  it("takes ownership when run.lock contains a stale PID and no flock holder exists", async () => {
    const projectDir = createProjectDir();
    writeFileSync(pidfilePath(projectDir), "999999\n");

    const proc = spawnServer(projectDir);
    const ready = await waitForReady(proc);

    expect(ready.type).toBe("ready");
    expect(readFileSync(pidfilePath(projectDir), "utf-8").trim()).toBe(String(proc.pid));
  });

  it("sets NXL_EVENTLOG_WRITER=fork before spawning a stub MCP", async () => {
    const projectDir = createProjectDir();
    const envPath = join(projectDir, ".nxl", "stub-mcp-env.txt");
    const proc = spawnServer(projectDir, {
      NXL_TEST_STUB_MCP_ENV_PATH: envPath,
    });
    await waitForReady(proc);

    expect(readFileSync(envPath, "utf-8")).toBe("fork");
  });
});
