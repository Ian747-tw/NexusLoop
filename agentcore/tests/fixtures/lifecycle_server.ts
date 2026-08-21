import { readFileSync } from "fs";
import { resolve } from "path";
import {
  onCallEnded,
  onCallStarted,
  registerShutdownHandlers,
} from "../../server-fork/src/seams/lifecycle-hooks";
import { acquire, release } from "../../server-fork/src/util/pidfile";

function writeMessage(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function waitForControlFrames(): Promise<void> {
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
        const message = JSON.parse(line) as { type?: string; call_id?: string };
        const callId = message.call_id ?? "held-call";
        if (message.type === "hold_call" && !heldCalls.has(callId)) {
          heldCalls.add(callId);
          onCallStarted(callId);
          writeMessage({ type: "call_held", call_id: callId });
        }
        if (message.type === "release_call" && heldCalls.delete(callId)) {
          onCallEnded(callId);
          writeMessage({ type: "call_released", call_id: callId });
        }
      }
    });
    process.stdin.on("end", resolvePromise);
  });
}

async function run(): Promise<void> {
  const lockPath = resolve(process.cwd(), ".nxl", "run.lock");
  const lockHandle = acquire(lockPath);
  if (!lockHandle) {
    const owner = readFileSync(lockPath, "utf-8").trim();
    throw new Error(`lifecycle fixture lock unavailable${owner ? ` for pid ${owner}` : ""}`);
  }
  process.env.NXL_EVENTLOG_WRITER = "fork";
  try {
    registerShutdownHandlers();
    writeMessage({ type: "ready", pid: process.pid });
    await waitForControlFrames();
  } finally {
    release(lockHandle);
  }
}

void run().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
