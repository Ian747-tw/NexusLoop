import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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
import { RunLock } from "./project/run-lock"

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

async function readEventKinds(dir: string): Promise<string[]> {
  try {
    return (await readFile(join(dir, ".nxl", "events.jsonl"), "utf8"))
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line).kind)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

function instrumentStartupOrder(server: RuntimeServer): string[] {
  const order: string[] = []
  const append = server.eventStore.append.bind(server.eventStore)
  server.eventStore.append = async (event: Parameters<EventStore["append"]>[0]): Promise<string> => {
    order.push(`append:${String(event.kind ?? event.type ?? "unknown")}`)
    return append(event)
  }
  const emit = server.eventBus.emit.bind(server.eventBus)
  server.eventBus.emit = (event: RuntimeEvent): RuntimeEvent => {
    order.push(`emit:${event.type}`)
    return emit(event)
  }
  return order
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
  packets: MissionPacket[] = []
  private releaseStream: (() => void) | null = null

  async startSession(_sessionSpec: SessionSpec): Promise<void> {
    this.startCalls += 1
  }

  async sendMissionPacket(packet: MissionPacket): Promise<void> {
    this.packets.push(packet)
  }

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
    expect(await readEventKinds(dir)).toContain("runtime_started")
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
    expect(await readEventKinds(viewDir)).toContain("runtime_started")
    await viewServer.shutdown()

    const statusDir = await tempProject()
    await makeProject(statusDir)
    const statusServer = new RuntimeServer({ projectDir: statusDir, mode: "status" })
    await statusServer.start()
    expect((await statusServer.status()).mode).toBe("status")
    expect(await readEventKinds(statusDir)).toContain("runtime_started")
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
    expect(await readEventKinds(dir)).not.toContain("runtime_started")
    expect(server.eventBus.snapshot().map((event) => event.type)).not.toContain("RuntimeReady")

    const next = new RuntimeServer({ projectDir: dir })
    await next.start()
    expect((await next.status()).lockHeld).toBe(true)
    await next.shutdown()
  })

  test("eventStore.append failure does not emit RuntimeReady and releases lock", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir })
    server.eventStore.append = async (): Promise<string> => {
      throw new Error("append failed")
    }

    await expect(server.start()).rejects.toThrow("append failed")

    expect(existsSync(join(dir, ".nxl", "run.lock"))).toBe(false)
    expect(server.eventBus.snapshot().map((event) => event.type)).not.toContain("RuntimeReady")
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

  test("startNewSession before start rejects without leaking adapter session", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const adapter = new LongLivedAdapter()
    const server = new RuntimeServer({ projectDir: dir, adapter })

    await expect(server.startNewSession()).rejects.toThrow("runtime must be started before starting a new session")
    expect(adapter.startCalls).toBe(0)
    expect(existsSync(join(dir, ".nxl", "run.lock"))).toBe(false)
  })

  test("startNewSession in status mode after start rejects", async () => {
    const dir = await tempProject()
    await makeProject(dir)
    const adapter = new LongLivedAdapter()
    const server = new RuntimeServer({ projectDir: dir, mode: "status", adapter })

    await server.start()
    await expect(server.startNewSession()).rejects.toThrow("runtime.start_new_session requires active mode")

    expect(adapter.startCalls).toBe(0)
    await server.shutdown()
  })

  test("startNewSession in view-records mode after start rejects", async () => {
    const dir = await tempProject()
    await makeProject(dir)
    const adapter = new LongLivedAdapter()
    const server = new RuntimeServer({ projectDir: dir, mode: "view-records", adapter })

    await server.start()
    await expect(server.startNewSession()).rejects.toThrow("runtime.start_new_session requires active mode")

    expect(adapter.startCalls).toBe(0)
    await server.shutdown()
  })

  test("submitUserMessage before start rejects without sending packet", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const adapter = new LongLivedAdapter()
    const server = new RuntimeServer({ projectDir: dir, adapter })

    await expect(server.submitUserMessage("hello")).rejects.toThrow("runtime must be started before accepting user messages")

    expect(adapter.packets).toHaveLength(0)
    expect(existsSync(join(dir, ".nxl", "run.lock"))).toBe(false)
  })

  test("submitUserMessage in status mode after start rejects", async () => {
    const dir = await tempProject()
    await makeProject(dir)
    const adapter = new LongLivedAdapter()
    const server = new RuntimeServer({ projectDir: dir, mode: "status", adapter })

    await server.start()
    await expect(server.submitUserMessage("hello")).rejects.toThrow("runtime.submit_user_message requires active mode")

    expect(adapter.packets).toHaveLength(0)
    await server.shutdown()
  })

  test("submitUserMessage in view-records mode after start rejects", async () => {
    const dir = await tempProject()
    await makeProject(dir)
    const adapter = new LongLivedAdapter()
    const server = new RuntimeServer({ projectDir: dir, mode: "view-records", adapter })

    await server.start()
    await expect(server.submitUserMessage("hello")).rejects.toThrow("runtime.submit_user_message requires active mode")

    expect(adapter.packets).toHaveLength(0)
    await server.shutdown()
  })

  test("submitUserMessage in active started mode succeeds", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const adapter = new LongLivedAdapter()
    const server = new RuntimeServer({ projectDir: dir, adapter })

    await server.start()
    await expect(server.submitUserMessage("hello")).resolves.toEqual({ accepted: true })

    expect(adapter.packets).toEqual([{ missionId: "runtime-message", message: "hello" }])
    await server.shutdown()
  })

  test("shutdown then submitUserMessage rejects without sending packet", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const adapter = new LongLivedAdapter()
    const server = new RuntimeServer({ projectDir: dir, adapter })

    await server.start()
    await server.shutdown()
    await expect(server.submitUserMessage("after shutdown")).rejects.toThrow("runtime must be started before accepting user messages")

    expect(adapter.packets).toHaveLength(0)
  })

  test("successful active start appends runtime_started before readiness events", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir })
    const order = instrumentStartupOrder(server)

    await server.start()

    const runtimeStartedIndex = order.indexOf("append:runtime_started")
    expect(runtimeStartedIndex).toBeGreaterThanOrEqual(0)
    for (const eventType of ["RuntimeReady", "ProjectInitialized", "ResumeSummaryLoaded"]) {
      expect(order.indexOf(`emit:${eventType}`)).toBeGreaterThan(runtimeStartedIndex)
    }
    expect(await readEventKinds(dir)).toContain("runtime_started")
    await server.shutdown()
  })

  test("successful status and view-records starts append runtime_started before readiness events", async () => {
    for (const mode of ["status", "view-records"] as const) {
      const dir = await tempProject()
      await makeProject(dir)
      const server = new RuntimeServer({ projectDir: dir, mode })
      const order = instrumentStartupOrder(server)

      await server.start()

      const runtimeStartedIndex = order.indexOf("append:runtime_started")
      expect(runtimeStartedIndex).toBeGreaterThanOrEqual(0)
      for (const eventType of ["RuntimeReady", "ProjectInitialized", "ResumeSummaryLoaded"]) {
        expect(order.indexOf(`emit:${eventType}`)).toBeGreaterThan(runtimeStartedIndex)
      }
      expect(await readEventKinds(dir)).toContain("runtime_started")
      await server.shutdown()
    }
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

describe("RunLock", () => {
  const lockNow = () => new Date("2026-05-10T12:00:00Z")

  test("acquire creates lock", async () => {
    const dir = await tempProject()
    const lockPath = join(dir, ".nxl", "run.lock")
    const lock = new RunLock(lockPath, { now: lockNow })

    await lock.acquire()
    const record = JSON.parse(await readFile(lockPath, "utf8"))

    expect(record.pid).toBe(process.pid)
    expect(typeof record.acquired_at).toBe("string")
    expect(typeof record.token).toBe("string")
    await lock.release()
  })

  test("release deletes lock when token matches", async () => {
    const dir = await tempProject()
    const lockPath = join(dir, ".nxl", "run.lock")
    const lock = new RunLock(lockPath, { now: lockNow })

    await lock.acquire()
    await lock.release()

    expect(existsSync(lockPath)).toBe(false)
  })

  test("release does not delete lock when token does not match", async () => {
    const dir = await tempProject()
    const lockPath = join(dir, ".nxl", "run.lock")
    const lock = new RunLock(lockPath, { now: lockNow })
    const replacement = { pid: process.pid, acquired_at: lockNow().toISOString(), token: "replacement-token" }

    await lock.acquire()
    await writeFile(lockPath, JSON.stringify(replacement) + "\n")
    await lock.release()

    expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual(replacement)
  })

  test("second live lock fails", async () => {
    const dir = await tempProject()
    const lockPath = join(dir, ".nxl", "run.lock")
    const first = new RunLock(lockPath)
    const second = new RunLock(lockPath)

    await first.acquire()
    await expect(second.acquire()).rejects.toThrow("runtime lock already held")
    await first.release()
  })

  test("stale lock with dead pid is replaced", async () => {
    const dir = await tempProject()
    const lockPath = join(dir, ".nxl", "run.lock")
    await mkdir(join(dir, ".nxl"), { recursive: true })
    await writeFile(lockPath, JSON.stringify({ pid: 99999999, acquired_at: "2026-05-10T00:00:00Z", token: "dead-token" }) + "\n")
    const lock = new RunLock(lockPath, { now: lockNow })

    await lock.acquire()
    const record = JSON.parse(await readFile(lockPath, "utf8"))

    expect(record.pid).toBe(process.pid)
    await lock.release()
  })

  test("corrupt lock is treated as stale and replaced", async () => {
    const dir = await tempProject()
    const lockPath = join(dir, ".nxl", "run.lock")
    await mkdir(join(dir, ".nxl"), { recursive: true })
    await writeFile(lockPath, "not json\n")
    const lock = new RunLock(lockPath, { now: lockNow })

    await lock.acquire()
    const record = JSON.parse(await readFile(lockPath, "utf8"))

    expect(record.pid).toBe(process.pid)
    await lock.release()
  })

  test("fresh lock with current process pid is live and rejected", async () => {
    const dir = await tempProject()
    const lockPath = join(dir, ".nxl", "run.lock")
    await mkdir(join(dir, ".nxl"), { recursive: true })
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, acquired_at: lockNow().toISOString(), token: "fresh-token" }) + "\n")
    const lock = new RunLock(lockPath, { now: lockNow })

    await expect(lock.acquire()).rejects.toThrow("runtime lock already held")
  })

  test("old live pid lock is treated as stale and replaced", async () => {
    const dir = await tempProject()
    const lockPath = join(dir, ".nxl", "run.lock")
    await mkdir(join(dir, ".nxl"), { recursive: true })
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, acquired_at: "2026-05-09T11:59:59Z", token: "old-token" }) + "\n")
    const lock = new RunLock(lockPath, { now: lockNow })

    await lock.acquire()
    const record = JSON.parse(await readFile(lockPath, "utf8"))

    expect(record.pid).toBe(process.pid)
    expect(record.acquired_at).toBe(lockNow().toISOString())
    await lock.release()
  })

  test("invalid acquired_at is treated as stale and replaced", async () => {
    const dir = await tempProject()
    const lockPath = join(dir, ".nxl", "run.lock")
    await mkdir(join(dir, ".nxl"), { recursive: true })
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, acquired_at: "not a date", token: "invalid-date-token" }) + "\n")
    const lock = new RunLock(lockPath, { now: lockNow })

    await lock.acquire()
    const record = JSON.parse(await readFile(lockPath, "utf8"))

    expect(record.pid).toBe(process.pid)
    expect(record.acquired_at).toBe(lockNow().toISOString())
    await lock.release()
  })

  test("stale cleanup does not delete fresh replacement lock", async () => {
    const dir = await tempProject()
    const lockPath = join(dir, ".nxl", "run.lock")
    const replacement = { pid: process.pid, acquired_at: lockNow().toISOString(), token: "replacement-token" }
    await mkdir(join(dir, ".nxl"), { recursive: true })
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, acquired_at: "2026-05-09T11:59:59Z", token: "old-token" }) + "\n")
    const lock = new RunLock(lockPath, {
      now: lockNow,
      beforeRemoveStale: async () => {
        await writeFile(lockPath, JSON.stringify(replacement) + "\n")
      },
    })

    await expect(lock.acquire()).rejects.toThrow("runtime lock already held")
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual(replacement)
  })

  test("concurrent stale recovery leaves one fresh lock winner", async () => {
    const dir = await tempProject()
    const lockPath = join(dir, ".nxl", "run.lock")
    await mkdir(join(dir, ".nxl"), { recursive: true })
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, acquired_at: "2026-05-09T11:59:59Z", token: "old-token" }) + "\n")
    const first = new RunLock(lockPath, { now: lockNow })
    const second = new RunLock(lockPath, { now: lockNow })

    const results = await Promise.allSettled([first.acquire(), second.acquire()])
    const fulfilled = results.filter((result) => result.status === "fulfilled")
    const rejected = results.filter((result) => result.status === "rejected")

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toContain("runtime lock already held")
    if (first.isHeld()) await first.release()
    if (second.isHeld()) await second.release()
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
