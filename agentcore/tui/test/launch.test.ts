import { describe, expect, test } from "bun:test"
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

  async shutdown(): Promise<void> {
    this.shutdownCount += 1
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

describe("TUI launch boundary", () => {
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
