/**
 * server.ts — fork CLI entry point.
 *
 * CURRENT SCOPE (P5.0): pidfile acquisition + seam initialization +
 * stdin wait. Sufficient for lifecycle-hooks integration testing.
 *
 * DEFERRED: full OpenCode session spawn via upstream startup path.
 * Required for: subagent-isolation integration test (P7),
 * any test that exercises the actual cycle/turn lifecycle (P7+).
 *
 * Tracking: phases/M4/checklist.md "Deferred from P5.0 — server.ts session spawn"
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { spawn } from "child_process";
import {
  onCallEnded,
  onCallStarted,
  registerShutdownHandlers,
} from "./seams/lifecycle-hooks";
import { initSubagentIsolation } from "./seams/subagent-isolation";
import { projectTripwiresFromEventLog } from "./seams/tripwire-gate";
import { startEventEmissionServer } from "./seams/event-emission-handler";
import { acquire, release } from "./util/pidfile";
import {
  findLatestSnapshot,
  materializeSnapshots,
  replayEventLog,
  replayFromSnapshot,
} from "./util/snapshot";

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
    const heldCalls = new Set<string>();
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
          const msg = JSON.parse(line) as { type?: string; call_id?: string };
          if (msg.type === "ping") {
            writeMessage({ type: "pong", pid: process.pid });
          }
          if (msg.type === "hold_call") {
            const callID = msg.call_id ?? `held-call-${Date.now()}`;
            if (!heldCalls.has(callID)) {
              heldCalls.add(callID);
              onCallStarted(callID);
            }
            writeMessage({ type: "call_held", call_id: callID });
          }
          if (msg.type === "release_call") {
            const callID = msg.call_id ?? "";
            if (heldCalls.has(callID)) {
              heldCalls.delete(callID);
              onCallEnded(callID);
            }
            writeMessage({ type: "call_released", call_id: callID });
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
  const lockPath = resolve(projectDir, ".nxl", "run.lock");
  const lockHandle = acquire(lockPath);
  if (!lockHandle) {
    let ownerPid: string | null = null;
    try {
      ownerPid = readFileSync(lockPath, "utf-8").trim() || null;
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
    const eventsPath = resolve(projectDir, ".nxl", "events.jsonl");
    const snapshotsDir = resolve(projectDir, ".nxl", "snapshots");
    await materializeSnapshots(eventsPath, snapshotsDir);
    const latestSnapshot = findLatestSnapshot(snapshotsDir);
    if (latestSnapshot) {
      await replayFromSnapshot(latestSnapshot.path, eventsPath);
    } else {
      await replayEventLog(eventsPath);
    }
    startEventEmissionServer();
    await spawnStubMcpIfRequested();
    writeMessage({ type: "ready", pid: process.pid });
    await waitForShutdownSignal();
  } finally {
    release(lockHandle);
  }
}

void run().catch((error) => {
  process.stderr.write(String(error) + "\n");
  process.exit(1);
});
