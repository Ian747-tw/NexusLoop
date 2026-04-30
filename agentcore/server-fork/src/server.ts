import { dlopen, FFIType, suffix } from "bun:ffi";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { dirname, resolve } from "path";
import { spawn } from "child_process";
import { registerShutdownHandlers } from "./seams/lifecycle-hooks";
import { initSubagentIsolation } from "./seams/subagent-isolation";
import { projectTripwiresFromEventLog } from "./seams/tripwire-gate";
import { projectFromEventLog } from "./seams/research-state";
import { startEventEmissionServer } from "./seams/event-emission-handler";

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

interface RunLockHandle {
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

function acquireRunLock(projectDir: string): RunLockHandle | null {
  const lockPath = resolve(projectDir, ".nxl", "run.lock");
  mkdirSync(dirname(lockPath), { recursive: true });
  if (!existsSync(lockPath)) {
    writeFileSync(lockPath, "");
  }

  const fd = openSync(lockPath, "r+");
  const rc = libc.symbols.flock(fd, LOCK_EX | LOCK_NB);
  if (rc !== 0) {
    closeSync(fd);
    return null;
  }

  try {
    const previous = readFileSync(lockPath, "utf-8").trim();
    if (previous) {
      const previousPid = Number(previous);
      if (Number.isFinite(previousPid) && previousPid > 0 && !isPidAlive(previousPid)) {
        // Stale pidfile content is expected after an ungraceful exit; we own the flock now.
      }
    }
  } catch {
    // Ignore unreadable stale content; flock ownership is authoritative.
  }

  writeFileSync(lockPath, `${process.pid}\n`);
  const verifyFd = openSync(lockPath, "r");
  fsyncSync(verifyFd);
  closeSync(verifyFd);
  return { fd, path: lockPath };
}

function releaseRunLock(handle: RunLockHandle | null): void {
  if (!handle) return;
  try {
    libc.symbols.flock(handle.fd, LOCK_UN);
  } finally {
    closeSync(handle.fd);
  }
}

async function spawnStubMcpIfRequested(): Promise<void> {
  const envPath = process.env.NXL_TEST_STUB_MCP_ENV_PATH;
  if (!envPath) return;

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      ["-e", "require('fs').writeFileSync(process.argv[1], String(process.env.NXL_EVENTLOG_WRITER || ''))", envPath],
      {
        env: process.env,
        stdio: "ignore",
      },
    );
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`stub MCP exited with code ${code ?? "null"}`));
    });
  });
}

function writeMessage(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function waitForShutdownSignal(): Promise<void> {
  await new Promise<void>((resolvePromise) => {
    let buffer = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as { type?: string };
          if (msg.type === "ping") {
            writeMessage({ type: "pong", pid: process.pid });
          }
          if (msg.type === "shutdown") {
            resolvePromise();
          }
        } catch {
          // Ignore malformed control frames; event-emission-handler sees the same stdin stream.
        }
      }
    });
    process.stdin.on("end", resolvePromise);
  });
}

async function run(): Promise<void> {
  const projectDir = process.cwd();
  const lockHandle = acquireRunLock(projectDir);
  if (!lockHandle) {
    let ownerPid: string | null = null;
    try {
      ownerPid = readFileSync(resolve(projectDir, ".nxl", "run.lock"), "utf-8").trim() || null;
    } catch {
      ownerPid = null;
    }
    const suffix = ownerPid ? ` (pid ${ownerPid})` : "";
    process.stderr.write(`another nxl run is active${suffix}\n`);
    process.exitCode = 1;
    return;
  }

  process.env.NXL_EVENTLOG_WRITER = "fork";

  try {
    await initSubagentIsolation();
    registerShutdownHandlers();
    await projectTripwiresFromEventLog(null);
    await projectFromEventLog(null);
    startEventEmissionServer();
    await spawnStubMcpIfRequested();
    writeMessage({ type: "ready", pid: process.pid });
    await waitForShutdownSignal();
  } finally {
    releaseRunLock(lockHandle);
  }
}

void run().catch((error) => {
  process.stderr.write(String(error) + "\n");
  process.exit(1);
});
