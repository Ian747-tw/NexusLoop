import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import type { RuntimeEvent } from "../src/events"
import { runTuiEntrypoint } from "../src/launch"
import type { RuntimeClient } from "../src/runtime"

class TestRuntimeClient implements RuntimeClient {
  constructor(private readonly firstEventDelayMs = 0) {}

  shutdownCount = 0

  async *stream(): AsyncIterable<RuntimeEvent> {
    if (this.firstEventDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.firstEventDelayMs))
    }
    yield { type: "RuntimeReady", projectName: "launch-test", runtimeStatus: "started" }
  }

  async sendUserMessage(_message: string): Promise<void> {}

  async sendCommand(_command: string): Promise<void> {}

  async command(name: string): Promise<unknown> {
    if (name === "runtime.status") {
      return {
        runtimeStatus: "started",
        mode: "active",
        projectName: "launch-test",
        specApproved: true,
        lockHeld: false,
        adapterStatus: { kind: "test", phase: "idle" },
        missions: { pending_count: 0, failed_count: 0, active_claim_count: 0, completed_count: 0, cancelled_count: 0 },
        researchProjection: { mode: "disabled", ok: true, stale: false, pending_count: 0 },
      }
    }
    if (name === "runtime.list_recent_missions") return []
    return { ok: true }
  }

  async shutdown(): Promise<void> {
    this.shutdownCount += 1
  }
}

class ErroringRuntimeClient extends TestRuntimeClient {
  async command(name: string): Promise<unknown> {
    if (name === "runtime.status") throw new Error("runtime failed token=launch-secret")
    return super.command(name)
  }
}

class DelayedFiniteRuntimeClient extends TestRuntimeClient {
  async *stream(): AsyncIterable<RuntimeEvent> {
    yield { type: "RuntimeReady", projectName: "launch-test", runtimeStatus: "started" }
    await new Promise((resolve) => setTimeout(resolve, 75))
    yield { type: "ProjectInitialized", projectDir: "/tmp/nxl-launch-delayed-finite" }
  }
}

class BlockingLongLivedRuntimeClient extends TestRuntimeClient {
  readonly streamMode = "long-lived" as const
  returnCalls = 0

  stream(): AsyncIterable<RuntimeEvent> {
    const self = this
    let eventCount = 0
    return {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<RuntimeEvent>> {
            eventCount += 1
            if (eventCount === 1) {
              return { done: false, value: { type: "RuntimeReady", projectName: "launch-test", runtimeStatus: "started" } }
            }
            return await new Promise<IteratorResult<RuntimeEvent>>(() => {})
          },
          return(): Promise<IteratorResult<RuntimeEvent>> {
            self.returnCalls += 1
            return new Promise<IteratorResult<RuntimeEvent>>(() => {})
          },
        }
      },
    }
  }
}

const cleanup: string[] = []

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nxl-tui-launch-"))
  cleanup.push(dir)
  return dir
}

async function makeApprovedProject(dir: string): Promise<void> {
  await mkdir(join(dir, ".nxl", "spec"), { recursive: true })
  await writeFile(
    join(dir, ".nxl", "spec", "current.json"),
    JSON.stringify(
      {
        spec_id: "spec_launch",
        version: 1,
        status: "approved",
        objective: "TUI launch runtime surface test objective",
        project_mode: "build",
        domain: "test",
        success_metrics: ["snapshot includes runtime records"],
        evaluation_protocol: "run headless snapshot",
        approved_by: "tester",
        approved_at: "2026-05-10T00:00:00Z",
      },
      null,
      2,
    ),
  )
}

describe("TUI launch boundary", () => {
  afterEach(async () => {
    while (cleanup.length) await rm(cleanup.pop()!, { recursive: true, force: true })
  })

  test("headless entrypoint shuts down owning runtime client after snapshot", async () => {
    const runtime = new TestRuntimeClient()
    const output: string[] = []

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-headless",
      env: { NXL_TUI_HEADLESS: "1" },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    expect(output.join("\n")).toContain("launch-test")
    expect(runtime.shutdownCount).toBe(1)
  })

  test("default headless entrypoint keeps fake client behavior without env", async () => {
    const dir = await tempProject()
    const output: string[] = []

    await runTuiEntrypoint({
      projectDir: dir,
      env: { NXL_TUI_HEADLESS: "1" },
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("runtime=fake runtime connected")
    expect(snapshot).toContain("Project not initialized")
  })

  test("real headless runtime client shows status and mission summary", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const output: string[] = []

    await runTuiEntrypoint({
      projectDir: dir,
      env: { NXL_TUI_HEADLESS: "1", NXL_RUNTIME_CLIENT: "real", NXL_OPENCODE_ADAPTER: "fake" },
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("Runtime")
    expect(snapshot).toContain("status=started")
    expect(snapshot).toContain("mode=active")
    expect(snapshot).toContain("projection=ok stale=false pending=0")
    expect(snapshot).toContain("missions_pending=0")
    expect(snapshot).toContain("recent_missions")
  })

  test("real headless runtime client submits a message and refreshes mission records", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "run mission token=message-secret" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: dir,
      env: {
        NXL_TUI_HEADLESS: "1",
        NXL_TUI_KEYS: JSON.stringify(keys),
        NXL_RUNTIME_CLIENT: "real",
        NXL_OPENCODE_ADAPTER: "fake",
      },
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("mission submitted")
    expect(snapshot).toContain("last_mission=mission_")
    expect(snapshot).toContain("recent_missions")
    expect(snapshot).toContain("[sent]")
    expect(snapshot).not.toContain("message-secret")
  })

  test("status and missions commands update runtime panels", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/status" },
      { type: "submit" },
      { type: "insert", text: "/missions" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: dir,
      env: {
        NXL_TUI_HEADLESS: "1",
        NXL_TUI_KEYS: JSON.stringify(keys),
        NXL_RUNTIME_CLIENT: "real",
        NXL_OPENCODE_ADAPTER: "fake",
      },
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("user command -> runtime: status")
    expect(snapshot).toContain("user command -> runtime: missions")
    expect(snapshot).toContain("status=started")
    expect(snapshot).toContain("recent_missions")
  })

  test("runtime command errors are redacted in headless state and snapshot", async () => {
    const runtime = new ErroringRuntimeClient()
    const output: string[] = []

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-error-redaction",
      env: { NXL_TUI_HEADLESS: "1" },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("command_error=runtime failed [REDACTED]")
    expect(snapshot).not.toContain("launch-secret")
  })

  test("shutdown command does not report a false post-shutdown refresh error", async () => {
    const dir = await tempProject()
    await makeApprovedProject(dir)
    const output: string[] = []
    const keys = [
      { type: "submit" },
      { type: "insert", text: "/shutdown" },
      { type: "submit" },
    ]

    await runTuiEntrypoint({
      projectDir: dir,
      env: {
        NXL_TUI_HEADLESS: "1",
        NXL_TUI_KEYS: JSON.stringify(keys),
        NXL_RUNTIME_CLIENT: "real",
        NXL_OPENCODE_ADAPTER: "fake",
      },
      writeOutput: (snapshot) => output.push(snapshot),
    })

    const snapshot = output.join("\n")
    expect(snapshot).toContain("user command -> runtime: shutdown")
    expect(snapshot).not.toContain("command_error=")
    expect(snapshot).not.toContain("runtime client has been shut down")
  })

  test("headless entrypoint waits for the first runtime event before idle timeout", async () => {
    const runtime = new TestRuntimeClient(75)
    const output: string[] = []

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-delayed-headless",
      env: { NXL_TUI_HEADLESS: "1" },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    expect(output.join("\n")).toContain("launch-test")
    expect(runtime.shutdownCount).toBe(1)
  })

  test("headless entrypoint consumes a full finite stream before rendering", async () => {
    const runtime = new DelayedFiniteRuntimeClient()
    const output: string[] = []

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-delayed-finite",
      env: { NXL_TUI_HEADLESS: "1" },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    expect(output.join("\n")).toContain("screen=resume")
    expect(output.join("\n")).toContain("Resume previous run")
    expect(runtime.shutdownCount).toBe(1)
  })

  test("headless entrypoint does not hang when a long-lived stream idles with pending next", async () => {
    const runtime = new BlockingLongLivedRuntimeClient()
    const output: string[] = []

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-blocking-long-lived",
      env: { NXL_TUI_HEADLESS: "1" },
      runtime,
      writeOutput: (snapshot) => output.push(snapshot),
    })

    expect(output.join("\n")).toContain("launch-test")
    expect(runtime.returnCalls).toBe(1)
    expect(runtime.shutdownCount).toBe(1)
  })

  test("interactive entrypoint shuts down runtime client after OpenTUI returns", async () => {
    const runtime = new TestRuntimeClient()
    let called = false

    await runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-interactive",
      env: {},
      runtime,
      runOpenTui: async (client, projectDir) => {
        called = client === runtime && projectDir === "/tmp/nxl-launch-interactive"
      },
    })

    expect(called).toBe(true)
    expect(runtime.shutdownCount).toBe(1)
  })

  test("interactive entrypoint shuts down runtime client when OpenTUI fails", async () => {
    const runtime = new TestRuntimeClient()

    await expect(runTuiEntrypoint({
      projectDir: "/tmp/nxl-launch-failure",
      env: {},
      runtime,
      runOpenTui: async () => {
        throw new Error("render failed")
      },
    })).rejects.toThrow("render failed")

    expect(runtime.shutdownCount).toBe(1)
  })
})
