import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { RuntimeServer } from "./server"
import { EventStore } from "./events/event-store"
import { RuntimeEventBus } from "./events/event-bus"
import type { RuntimeEvent } from "./events/event-types"
import { SpecService } from "./spec/spec-service"
import { FakeOpenCodeAdapter } from "./opencode/fake-adapter"
import type { MissionPacket, MissionUpdate, OpenCodeRuntimeAdapter, SessionSpec } from "./opencode/adapter"
import { makeProject } from "./test/fixtures"

const cleanup: string[] = []

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nxl-runtime-"))
  cleanup.push(dir)
  return dir
}

afterEach(async () => {
  while (cleanup.length) await rm(cleanup.pop()!, { recursive: true, force: true })
})

function timeout(ms: number): Promise<"timeout"> {
  return new Promise((resolve) => setTimeout(() => resolve("timeout"), ms))
}

class ThrowingStartAdapter extends FakeOpenCodeAdapter {
  override async startSession(_sessionSpec: SessionSpec): Promise<void> {
    throw new Error("start failed")
  }
}

class ThrowingShutdownAdapter extends FakeOpenCodeAdapter {
  override async shutdown(): Promise<void> {
    throw new Error("shutdown failed")
  }
}

class LongLivedAdapter implements OpenCodeRuntimeAdapter {
  streamCalls = 0
  startCalls = 0
  private releaseStream: (() => void) | null = null

  async startSession(_sessionSpec: SessionSpec): Promise<void> {
    this.startCalls += 1
  }

  async sendMissionPacket(_packet: MissionPacket): Promise<void> {}

  async pauseAtSafeBoundary(_reason: string): Promise<void> {}

  async resumeWithMissionUpdate(_update: MissionUpdate): Promise<void> {}

  async *streamExecutorEvents(): AsyncIterable<RuntimeEvent> {
    this.streamCalls += 1
    yield { type: "ExecutorLifecycle", phase: "long-stream-started", message: "stream started" }
    await new Promise<void>((resolve) => {
      this.releaseStream = resolve
    })
  }

  async shutdown(): Promise<void> {
    this.releaseStream?.()
  }

  async getStatus(): Promise<Record<string, unknown>> {
    return { adapter: "long-lived", message: "long stream adapter" }
  }
}

describe("RuntimeServer core", () => {
  test("starts in initialized project with approved spec", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir })

    await server.start()
    const status = await server.status()

    expect(status.specApproved).toBe(true)
    expect(status.lockHeld).toBe(true)
    expect(server.eventBus.snapshot().map((event) => event.type)).toContain("RuntimeReady")
    await server.shutdown()
  })

  test("refuses active mode without approved spec", async () => {
    const dir = await tempProject()
    await makeProject(dir, { draftSpec: true })
    const server = new RuntimeServer({ projectDir: dir, mode: "active" })

    await expect(server.start()).rejects.toThrow("approved spec required")
  })

  test("allows view-records and status modes without approved spec", async () => {
    const viewDir = await tempProject()
    await makeProject(viewDir)
    const viewServer = new RuntimeServer({ projectDir: viewDir, mode: "view-records" })
    await viewServer.start()
    expect((await viewServer.status()).mode).toBe("view-records")
    await viewServer.shutdown()

    const statusDir = await tempProject()
    await makeProject(statusDir)
    const statusServer = new RuntimeServer({ projectDir: statusDir, mode: "status" })
    await statusServer.start()
    expect((await statusServer.status()).mode).toBe("status")
    await statusServer.shutdown()
  })

  test("creates and releases .nxl/run.lock", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir })

    await server.start()
    expect(existsSync(join(dir, ".nxl", "run.lock"))).toBe(true)
    await server.shutdown()
    expect(existsSync(join(dir, ".nxl", "run.lock"))).toBe(false)
  })

  test("second runtime instance fails due to lock", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const first = new RuntimeServer({ projectDir: dir })
    const second = new RuntimeServer({ projectDir: dir })

    await first.start()
    await expect(second.start()).rejects.toThrow("runtime lock already held")
    await first.shutdown()
  })

  test("startup failure after lock acquisition releases run lock", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir, adapter: new ThrowingStartAdapter() })

    await expect(server.start()).rejects.toThrow("start failed")
    expect(existsSync(join(dir, ".nxl", "run.lock"))).toBe(false)

    const next = new RuntimeServer({ projectDir: dir })
    await next.start()
    expect((await next.status()).lockHeld).toBe(true)
    await next.shutdown()
  })

  test("start returns while executor stream is long-lived", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const adapter = new LongLivedAdapter()
    const server = new RuntimeServer({ projectDir: dir, adapter })

    const result = await Promise.race([server.start().then(() => "started" as const), timeout(100)])

    expect(result).toBe("started")
    expect(adapter.startCalls).toBe(1)
    await server.shutdown()
  })

  test("startNewSession returns while executor stream is long-lived and avoids duplicate pumps", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const adapter = new LongLivedAdapter()
    const server = new RuntimeServer({ projectDir: dir, adapter })

    await server.start()
    const result = await Promise.race([server.startNewSession().then(() => "started" as const), timeout(100)])

    expect(result).toBe("started")
    expect(adapter.startCalls).toBe(2)
    expect(adapter.streamCalls).toBe(1)
    await server.shutdown()
  })

  test("shutdown releases lock even when adapter shutdown fails", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir, adapter: new ThrowingShutdownAdapter() })

    await server.start()
    await expect(server.shutdown()).rejects.toThrow("shutdown failed")
    expect(existsSync(join(dir, ".nxl", "run.lock"))).toBe(false)
  })

  test("status output redacts secret-looking strings", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true, policy: { api_key: "sk-test-SECRET123456", note: "Bearer abc.def.ghi12345" } })
    const server = new RuntimeServer({ projectDir: dir })
    await server.start()

    const serialized = JSON.stringify(await server.status())
    expect(serialized).not.toContain("sk-test-SECRET123456")
    expect(serialized).not.toContain("Bearer abc.def.ghi12345")
    expect(serialized).toContain("[REDACTED]")
    await server.shutdown()
  })
})

describe("EventStore and EventBus", () => {
  test("appends and reads JSONL", async () => {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    const first = await store.append({ kind: "test_event", value: 1 })
    await store.append({ kind: "test_event", value: 2 })

    expect((await store.readAll()).map((event) => event.value)).toEqual([1, 2])
    expect((await store.readSince(first)).map((event) => event.value)).toEqual([2])
    expect(await store.latestEventId()).not.toBeNull()
  })

  test("streams RuntimeReady ProjectInitialized ResumeSummaryLoaded", () => {
    const bus = new RuntimeEventBus()
    bus.emit({ type: "RuntimeReady", projectName: "demo", runtimeStatus: "ready" })
    bus.emit({ type: "ProjectInitialized", projectDir: "/tmp/demo" })
    bus.emit({ type: "ResumeSummaryLoaded", recordsCount: 0 })

    expect(bus.snapshot().map((event) => event.type)).toEqual(["RuntimeReady", "ProjectInitialized", "ResumeSummaryLoaded"])
  })
})

describe("SpecService", () => {
  test("loads approved R2 spec", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const summary = await new SpecService(dir).requireApproved()

    expect(summary.status).toBe("approved")
    expect(summary.specId).toBe("spec_test")
    expect(summary.objective).toContain("[REDACTED]")
  })

  test("rejects draft and missing spec", async () => {
    const draftDir = await tempProject()
    await makeProject(draftDir, { draftSpec: true })
    await expect(new SpecService(draftDir).requireApproved()).rejects.toThrow("approved spec required")

    const missingDir = await tempProject()
    await makeProject(missingDir)
    await expect(new SpecService(missingDir).requireApproved()).rejects.toThrow("approved spec missing")
  })
})

describe("FakeOpenCodeAdapter", () => {
  test("emits deterministic fake events", async () => {
    const adapter = new FakeOpenCodeAdapter()
    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    await adapter.sendMissionPacket({ missionId: "m1", message: "hello" })

    const events = []
    for await (const event of adapter.streamExecutorEvents()) events.push(event)
    expect(events.map((event) => event.type)).toEqual(["ExecutorLifecycle", "ExecutorLifecycle"])
    expect(events[0]?.type).toBe("ExecutorLifecycle")
    if (events[0]?.type === "ExecutorLifecycle") {
      expect(events[0].message).toContain("Real OpenCode session spawn is not implemented")
    }
  })
})
