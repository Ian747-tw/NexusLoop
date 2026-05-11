import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { RuntimeServer } from "./server"
import type { RuntimeResearchDbProjection } from "./server"
import { EventStore } from "./events/event-store"
import { RuntimeEventBus } from "./events/event-bus"
import type { RuntimeEvent } from "./events/event-types"
import { SpecService } from "./spec/spec-service"
import { FakeOpenCodeAdapter } from "./opencode/fake-adapter"
import { ProcessOpenCodeAdapter, type OpenCodeSpawnedProcess, type OpenCodeProcessEventSource } from "./opencode/process-adapter"
import type { MissionPacket, MissionUpdate, OpenCodeRuntimeAdapter, SessionSpec } from "./opencode/adapter"
import { makeProject } from "./test/fixtures"
import { RunLock } from "./project/run-lock"
import {
  ResearchDb,
  type ListResearchEventsOptions,
  type Note,
  type ResearchEvent,
  type ResearchProjectionIntegrity,
  type ResearchProjectionStatus,
  type SearchOptions,
  type Topic,
  type TopicSnapshot,
} from "./research-db/research-db"

const cleanup: string[] = []
const NON_BLOCKING_START_TIMEOUT_MS = 1000

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

type ProcessEventName = "exit" | "error"
type ProcessListener = (...args: unknown[]) => void

class FakeProcessEventSource implements OpenCodeProcessEventSource {
  private readonly listeners = new Map<string, ProcessListener[]>()

  on(event: "data", listener: (data: unknown) => void): void {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener as ProcessListener)
    this.listeners.set(event, listeners)
  }

  emitData(data: unknown): void {
    for (const listener of this.listeners.get("data") ?? []) listener(data)
  }
}

class FakeSpawnedProcess implements OpenCodeSpawnedProcess {
  readonly stdout = new FakeProcessEventSource()
  readonly stderr = new FakeProcessEventSource()
  readonly stdinWrites: string[] = []
  stdinEnded = false
  killedWith: NodeJS.Signals | undefined
  private readonly exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = []
  private readonly errorListeners: Array<(error: Error) => void> = []

  constructor(readonly pid = 4242) {}

  stdin = {
    write: (data: string) => {
      this.stdinWrites.push(data)
      return true
    },
    end: () => {
      this.stdinEnded = true
    },
  }

  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void
  on(event: "error", listener: (error: Error) => void): void
  on(event: ProcessEventName, listener: ((code: number | null, signal: NodeJS.Signals | null) => void) | ((error: Error) => void)): void {
    if (event === "exit") this.exitListeners.push(listener as (code: number | null, signal: NodeJS.Signals | null) => void)
    else this.errorListeners.push(listener as (error: Error) => void)
  }

  kill(signal?: NodeJS.Signals): void {
    this.killedWith = signal
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null): void {
    for (const listener of this.exitListeners) listener(code, signal)
  }

  emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error)
  }
}

class TrackingResearchDb implements RuntimeResearchDbProjection {
  closeCalls = 0

  constructor(private readonly db: ResearchDb) {}

  listTopics(): Topic[] {
    return this.db.listTopics()
  }

  searchTopics(query: string, options?: SearchOptions): Topic[] {
    return this.db.searchTopics(query, options)
  }

  getTopicSnapshot(topicId: string): TopicSnapshot | null {
    return this.db.getTopicSnapshot(topicId)
  }

  listResearchEvents(options?: ListResearchEventsOptions): ResearchEvent[] {
    return this.db.listResearchEvents(options)
  }

  searchNotes(topicId: string, query: string, options?: SearchOptions): Note[] {
    return this.db.searchNotes(topicId, query, options)
  }

  checkProjectionIntegrity(eventsPath?: string): ResearchProjectionIntegrity {
    return this.db.checkProjectionIntegrity(eventsPath)
  }

  rebuildFromEvents(eventsPath?: string): void {
    this.db.rebuildFromEvents(eventsPath)
  }

  getProjectionStatus(): ResearchProjectionStatus {
    return this.db.getProjectionStatus()
  }

  close(): void {
    this.closeCalls += 1
    this.db.close()
  }
}

function seedResearchDb(dir: string): void {
  const db = ResearchDb.open(dir, {
    now: (() => {
      let nextMs = 0
      return () => new Date(Date.UTC(2026, 4, 10, 12, 0, 0, nextMs++))
    })(),
    idFactory: () => "unused",
  })
  try {
    db.createTopic({ id: "topic_1", title: "Runtime records", status: "active" })
    db.createTopic({ id: "topic_2", title: "Other topic" })
    db.addSource({
      id: "source_1",
      topic_id: "topic_1",
      locator: "file://runtime.md",
      title: "Runtime note source",
      source_type: "file",
      status: "reviewed",
    })
    db.addNote({ id: "note_1", topic_id: "topic_1", source_id: "source_1", content: "Projected research note", tags: ["finding"] })
    db.addArtifact({ id: "artifact_1", topic_id: "topic_1", kind: "report", content: "Projected report" })
  } finally {
    db.close()
  }
}

async function deleteResearchDb(dir: string): Promise<void> {
  await rm(join(dir, ".nxl", "research.db"), { force: true })
  await rm(join(dir, ".nxl", "research.db-shm"), { force: true })
  await rm(join(dir, ".nxl", "research.db-wal"), { force: true })
}

async function appendJsonlLine(dir: string, event: unknown): Promise<void> {
  const path = join(dir, ".nxl", "events.jsonl")
  let existing = ""
  try {
    existing = await readFile(path, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  await writeFile(path, existing + JSON.stringify(event) + "\n")
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

    const result = await Promise.race([server.start().then(() => "started" as const), timeout(NON_BLOCKING_START_TIMEOUT_MS)])

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
    const result = await Promise.race([server.startNewSession().then(() => "started" as const), timeout(NON_BLOCKING_START_TIMEOUT_MS)])

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

  test("research records read surface works in active mode without starting executor sessions", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    seedResearchDb(dir)
    const adapter = new LongLivedAdapter()
    const server = new RuntimeServer({ projectDir: dir, adapter })

    expect(server.listResearchTopics().map((topic) => topic.id)).toEqual(["topic_1", "topic_2"])
    const snapshot = server.getResearchTopicSnapshot("topic_1")
    expect(snapshot?.topic.id).toBe("topic_1")
    expect(snapshot?.stats).toMatchObject({ source_count: 1, note_count: 1, artifact_count: 1, report_count: 1 })
    expect(server.searchResearchNotes("topic_1", "Projected")).toHaveLength(1)
    expect(server.listResearchEvents({ entity_type: "note" }).map((event) => event.event_type)).toEqual(["note_added"])

    expect(adapter.startCalls).toBe(0)
    await server.shutdown()
  })

  test("research records read surface works in status mode without approved spec", async () => {
    const dir = await tempProject()
    await makeProject(dir)
    seedResearchDb(dir)
    const adapter = new LongLivedAdapter()
    const server = new RuntimeServer({ projectDir: dir, mode: "status", adapter })

    await server.start()
    expect(server.getResearchTopicSnapshot("topic_1")?.notes[0]?.content).toBe("Projected research note")
    expect(adapter.startCalls).toBe(0)
    await server.shutdown()
  })

  test("research records read surface works in view-records mode without approved spec", async () => {
    const dir = await tempProject()
    await makeProject(dir)
    seedResearchDb(dir)
    const adapter = new LongLivedAdapter()
    const server = new RuntimeServer({ projectDir: dir, mode: "view-records", adapter })

    await server.start()
    expect(await server.command("research.get_topic_snapshot", { topicId: "topic_1" })).toMatchObject({
      topic: { id: "topic_1" },
      stats: { note_count: 1 },
    })
    expect(adapter.startCalls).toBe(0)
    await server.shutdown()
  })

  test("missing research topic snapshot returns null", async () => {
    const dir = await tempProject()
    await makeProject(dir)
    seedResearchDb(dir)
    const server = new RuntimeServer({ projectDir: dir, mode: "view-records" })

    expect(server.getResearchTopicSnapshot("missing")).toBeNull()
    await server.shutdown()
  })

  test("research event reads return parsed redacted events", async () => {
    const dir = await tempProject()
    await makeProject(dir)
    const db = ResearchDb.open(dir)
    try {
      db.createTopic({ id: "topic_secret", title: "token=topicSecret123" })
    } finally {
      db.close()
    }
    const server = new RuntimeServer({ projectDir: dir, mode: "view-records" })

    const events = server.listResearchEvents({ entity_type: "topic" })

    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toMatchObject({ title: "[REDACTED]" })
    expect(JSON.stringify(events)).not.toContain("topicSecret123")
    await server.shutdown()
  })

  test("research records commands fail clearly on invalid input", async () => {
    const dir = await tempProject()
    await makeProject(dir)
    seedResearchDb(dir)
    const server = new RuntimeServer({ projectDir: dir, mode: "view-records" })

    await expect(server.command("research.get_topic_snapshot", {})).rejects.toThrow("topicId is required")
    await expect(server.command("research.search_notes", { topicId: "topic_1", query: "" })).rejects.toThrow("query is required")
    await expect(server.command("research.list_events", { options: [] })).rejects.toThrow("options must be an object")
    await expect(server.command("research.list_events", { options: { entity_type: "bad" } })).rejects.toThrow("invalid research event entity_type: bad")

    await server.shutdown()
  })

  test("owned ResearchDb handle is opened lazily reused and closed on shutdown", async () => {
    const dir = await tempProject()
    await makeProject(dir)
    seedResearchDb(dir)
    let factoryCalls = 0
    const opened: { current: TrackingResearchDb | null } = { current: null }
    const server = new RuntimeServer({
      projectDir: dir,
      mode: "view-records",
      researchDbFactory: (projectDir) => {
        factoryCalls += 1
        opened.current = new TrackingResearchDb(ResearchDb.open(projectDir))
        return opened.current
      },
    })

    expect(server.getResearchTopicSnapshot("topic_1")?.topic.id).toBe("topic_1")
    expect(server.listResearchEvents()).not.toHaveLength(0)
    expect(factoryCalls).toBe(1)

    await server.shutdown()

    expect(opened.current?.closeCalls).toBe(1)
  })

  test("injected ResearchDb handle is caller-owned and not closed on shutdown", async () => {
    const dir = await tempProject()
    await makeProject(dir)
    seedResearchDb(dir)
    const injected = new TrackingResearchDb(ResearchDb.open(dir))
    const server = new RuntimeServer({ projectDir: dir, mode: "view-records", researchDb: injected })

    expect(server.getResearchTopicSnapshot("topic_1")?.topic.id).toBe("topic_1")
    await server.shutdown()

    expect(injected.closeCalls).toBe(0)
    expect(injected.listTopics().map((topic) => topic.id)).toContain("topic_1")
    injected.close()
  })

  test("injected ResearchDb without Branch 4D projection APIs fails clearly", async () => {
    const dir = await tempProject()
    await makeProject(dir)
    const db = {
      close() {},
      listTopics: () => [],
      searchTopics: () => [],
      getTopicSnapshot: () => null,
      listResearchEvents: () => [],
      searchNotes: () => [],
    } as unknown as RuntimeResearchDbProjection
    const server = new RuntimeServer({ projectDir: dir, mode: "view-records", researchDb: db })

    expect(() => server.listResearchTopics()).toThrow("researchDb must support Branch 4D projection API: missing checkProjectionIntegrity")
    await server.shutdown()
  })

  test("status mode checks projection without approved spec and does not start adapter", async () => {
    const dir = await tempProject()
    await makeProject(dir)
    seedResearchDb(dir)
    const adapter = new LongLivedAdapter()
    const server = new RuntimeServer({ projectDir: dir, mode: "status", adapter })

    await server.start()
    const status = await server.status()

    expect(status.researchProjection).toMatchObject({ mode: "auto_rebuild", ok: true, stale: false, pending_count: 0 })
    expect(adapter.startCalls).toBe(0)
    await server.shutdown()
  })

  test("runtime.status projection check is read-only for event bus history", async () => {
    const dir = await tempProject()
    await makeProject(dir)
    seedResearchDb(dir)
    const server = new RuntimeServer({ projectDir: dir, mode: "status" })

    await server.status()
    await server.status()

    expect(server.eventBus.snapshot().filter((event) => event.type.startsWith("ResearchProjection"))).toHaveLength(0)
    await server.shutdown()
  })

  test("active startup checks projection after approved spec load and before adapter start", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    seedResearchDb(dir)
    const server = new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter() })
    const order = instrumentStartupOrder(server)

    await server.start()

    expect(order.findIndex((item) => item === "emit:ResearchProjectionChecked")).toBeLessThan(order.findIndex((item) => item === "append:runtime_started"))
    expect(server.eventBus.snapshot().map((event) => event.type)).toContain("RuntimeReady")
    await server.shutdown()
  })

  test("missing research.db with events.jsonl auto rebuilds before read surfaces", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    seedResearchDb(dir)
    await deleteResearchDb(dir)
    const server = new RuntimeServer({ projectDir: dir, mode: "view-records" })

    await server.start()
    expect(server.listResearchTopics().map((topic) => topic.id)).toEqual(["topic_1", "topic_2"])
    expect(server.getResearchTopicSnapshot("topic_1")?.notes[0]?.content).toBe("Projected research note")
    expect(server.listResearchEvents({ entity_type: "note" }).map((event) => event.payload)).toMatchObject([{ content: "Projected research note" }])
    expect(server.searchResearchNotes("topic_1", "Projected")).toHaveLength(1)
    expect(server.eventBus.snapshot().map((event) => event.type)).toEqual(
      expect.arrayContaining(["ResearchProjectionRebuildStarted", "ResearchProjectionRebuilt"]),
    )
    await server.shutdown()
  })

  test("stale projection auto rebuilds before serving rows", async () => {
    const dir = await tempProject()
    await makeProject(dir)
    seedResearchDb(dir)
    await appendJsonlLine(dir, {
      kind: "research_event",
      event_id: "manual_topic_event",
      timestamp: "2026-05-10T12:00:10.000Z",
      event_type: "topic_created",
      entity_type: "topic",
      entity_id: "topic_manual",
      payload: { id: "topic_manual", title: "Manual topic", status: "open", created_at: "2026-05-10T12:00:10.000Z", updated_at: "2026-05-10T12:00:10.000Z" },
    })
    const server = new RuntimeServer({ projectDir: dir, mode: "view-records" })

    await server.start()
    expect(server.listResearchTopics().map((topic) => topic.id)).toEqual(["topic_1", "topic_2", "topic_manual"])
    expect(server.researchProjectionStatus()).toMatchObject({ ok: true, stale: false, pending_count: 0 })
    await server.shutdown()
  })

  test("corrupt JSONL causes clear startup read and rebuild failures without leaking run lock", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    await writeFile(join(dir, ".nxl", "events.jsonl"), "{not json}\n")
    const adapter = new LongLivedAdapter()
    const active = new RuntimeServer({ projectDir: dir, adapter })

    await expect(active.start()).rejects.toThrow("research projection corrupt: corrupt JSONL line 1")
    expect(existsSync(join(dir, ".nxl", "run.lock"))).toBe(false)
    expect(adapter.startCalls).toBe(0)

    const reader = new RuntimeServer({ projectDir: dir, mode: "view-records" })
    expect(() => reader.listResearchTopics()).toThrow("research projection corrupt: corrupt JSONL line 1")
    await expect(reader.command("research.rebuild_projection", { force: true })).rejects.toThrow("research projection rebuild failed: corrupt JSONL line 1")
    await reader.shutdown()
  })

  test("unsupported research event fails clearly while non-research events are ignored", async () => {
    const dir = await tempProject()
    await makeProject(dir)
    await appendJsonlLine(dir, { kind: "runtime_started", mode: "status" })
    await appendJsonlLine(dir, {
      kind: "research_event",
      event_id: "unsupported",
      timestamp: "2026-05-10T12:00:00.000Z",
      event_type: "unknown_research_event",
      entity_type: "topic",
      entity_id: "topic_1",
      payload: {},
    })
    const server = new RuntimeServer({ projectDir: dir, mode: "view-records" })

    expect(() => server.listResearchTopics()).toThrow("research projection corrupt: unsupported research event: unknown_research_event")
    expect(server.researchProjectionStatus()).toMatchObject({ ok: false, stale: false, reason: "unsupported research event: unknown_research_event" })
    await server.shutdown()
  })

  test("runtime status redacts projection health values", async () => {
    const dir = await tempProject()
    await makeProject(dir)
    seedResearchDb(dir)
    const injected = new TrackingResearchDb(ResearchDb.open(dir))
    injected.checkProjectionIntegrity = () => ({ ok: false, stale: false, reason: "token=sk-test-SECRET123456" })
    const server = new RuntimeServer({ projectDir: dir, mode: "view-records", researchDb: injected })

    const serialized = JSON.stringify(await server.status())

    expect(serialized).not.toContain("sk-test-SECRET123456")
    expect(serialized).toContain("[REDACTED]")
    await server.shutdown()
    injected.close()
  })

  test("projection commands return structured status rebuild and validate input without starting adapter", async () => {
    const dir = await tempProject()
    await makeProject(dir)
    seedResearchDb(dir)
    await deleteResearchDb(dir)
    const adapter = new LongLivedAdapter()
    const server = new RuntimeServer({ projectDir: dir, mode: "status", adapter })

    await server.start()
    const before = await server.command("research.projection_status")
    expect(before).toMatchObject({ ok: true, stale: false })
    const after = await server.command("research.rebuild_projection", { force: true })
    expect(after).toMatchObject({ ok: true, stale: false, pending_count: 0 })
    await expect(server.command("research.rebuild_projection", { force: "yes" })).rejects.toThrow("force must be a boolean")
    expect(adapter.startCalls).toBe(0)
    await server.shutdown()
  })

  test("read-triggered auto rebuild requires run lock before mutating projection", async () => {
    const dir = await tempProject()
    await makeProject(dir)
    seedResearchDb(dir)
    await deleteResearchDb(dir)
    const server = new RuntimeServer({ projectDir: dir, mode: "view-records" })

    expect(() => server.listResearchTopics()).toThrow("research projection auto-rebuild during read requires runtime start with run lock held")
    expect(existsSync(join(dir, ".nxl", "run.lock"))).toBe(false)
    await server.shutdown()
  })

  test("projection rebuild command acquires temporary run lock without starting adapter", async () => {
    const dir = await tempProject()
    await makeProject(dir)
    seedResearchDb(dir)
    await deleteResearchDb(dir)
    const adapter = new LongLivedAdapter()
    const server = new RuntimeServer({ projectDir: dir, mode: "status", adapter })

    await expect(server.command("research.rebuild_projection", { force: true })).resolves.toMatchObject({ ok: true, stale: false })
    expect(existsSync(join(dir, ".nxl", "run.lock"))).toBe(false)
    expect(adapter.startCalls).toBe(0)
    await server.shutdown()
  })

  test("check-only stale projection refuses reads without rebuilding", async () => {
    const dir = await tempProject()
    await makeProject(dir)
    seedResearchDb(dir)
    await deleteResearchDb(dir)
    const server = new RuntimeServer({ projectDir: dir, mode: "view-records", researchProjectionMode: "check_only" })

    expect(() => server.listResearchTopics()).toThrow("research projection stale: missing projection metadata")
    expect(server.researchProjectionStatus()).toMatchObject({ mode: "check_only", ok: false, stale: true })
    expect(server.eventBus.snapshot().map((event) => event.type)).toContain("ResearchProjectionStale")
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

  test("expired lock with dead pid is replaced", async () => {
    const dir = await tempProject()
    const lockPath = join(dir, ".nxl", "run.lock")
    await mkdir(join(dir, ".nxl"), { recursive: true })
    await writeFile(lockPath, JSON.stringify({ pid: 99999999, acquired_at: "2026-05-09T11:59:59Z", token: "dead-token" }) + "\n")
    const lock = new RunLock(lockPath, { now: lockNow })

    await lock.acquire()
    const record = JSON.parse(await readFile(lockPath, "utf8"))

    expect(record.pid).toBe(process.pid)
    await lock.release()
  })

  test("fresh modern lock with dead pid is replaced", async () => {
    const dir = await tempProject()
    const lockPath = join(dir, ".nxl", "run.lock")
    await mkdir(join(dir, ".nxl"), { recursive: true })
    await writeFile(lockPath, JSON.stringify({ pid: 99999999, acquired_at: lockNow().toISOString(), token: "fresh-dead-token" }) + "\n")
    const lock = new RunLock(lockPath, { now: lockNow })

    await lock.acquire()
    const record = JSON.parse(await readFile(lockPath, "utf8"))

    expect(record.pid).toBe(process.pid)
    expect(record.acquired_at).toBe(lockNow().toISOString())
    expect(typeof record.token).toBe("string")
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

  test("old live pid lock is preserved", async () => {
    const dir = await tempProject()
    const lockPath = join(dir, ".nxl", "run.lock")
    const oldLiveRecord = { pid: process.pid, acquired_at: "2026-05-09T11:59:59Z", token: "old-live-token" }
    await mkdir(join(dir, ".nxl"), { recursive: true })
    await writeFile(lockPath, JSON.stringify(oldLiveRecord) + "\n")
    const lock = new RunLock(lockPath, { now: lockNow })

    await expect(lock.acquire()).rejects.toThrow("runtime lock already held")

    expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual(oldLiveRecord)
  })

  test("legacy live pid lock is preserved", async () => {
    const dir = await tempProject()
    const lockPath = join(dir, ".nxl", "run.lock")
    const legacyLock = `${process.pid}\n`
    await mkdir(join(dir, ".nxl"), { recursive: true })
    await writeFile(lockPath, legacyLock)
    const lock = new RunLock(lockPath, { now: lockNow })

    await expect(lock.acquire()).rejects.toThrow("runtime lock already held")

    expect(await readFile(lockPath, "utf8")).toBe(legacyLock)
  })

  test("legacy dead pid lock is replaced", async () => {
    const dir = await tempProject()
    const lockPath = join(dir, ".nxl", "run.lock")
    await mkdir(join(dir, ".nxl"), { recursive: true })
    await writeFile(lockPath, "99999999\n")
    const lock = new RunLock(lockPath, { now: lockNow })

    await lock.acquire()
    const record = JSON.parse(await readFile(lockPath, "utf8"))

    expect(record.pid).toBe(process.pid)
    expect(typeof record.token).toBe("string")
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
    await writeFile(lockPath, JSON.stringify({ pid: 99999999, acquired_at: "2026-05-09T11:59:59Z", token: "old-token" }) + "\n")
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
    await writeFile(lockPath, JSON.stringify({ pid: 99999999, acquired_at: "2026-05-09T11:59:59Z", token: "old-token" }) + "\n")
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

  test("streams only new fake events per stream session", async () => {
    const adapter = new FakeOpenCodeAdapter()
    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })

    const first = []
    for await (const event of adapter.streamExecutorEvents()) first.push(event)

    await adapter.sendMissionPacket({ missionId: "m2", message: "next" })
    const second = []
    for await (const event of adapter.streamExecutorEvents()) second.push(event)

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    expect(second[0]?.type).toBe("ExecutorLifecycle")
    if (second[0]?.type === "ExecutorLifecycle") {
      expect(second[0].phase).toBe("fake-mission-packet")
    }
  })
})

async function readProcessEvents(adapter: ProcessOpenCodeAdapter, count: number): Promise<RuntimeEvent[]> {
  const iterator = adapter.streamExecutorEvents()[Symbol.asyncIterator]()
  const events: RuntimeEvent[] = []
  try {
    for (let index = 0; index < count; index += 1) {
      const result = await Promise.race([
        iterator.next(),
        timeout(NON_BLOCKING_START_TIMEOUT_MS).then(() => {
          throw new Error(`timed out waiting for process event ${index + 1}`)
        }),
      ])
      if (result.done) break
      events.push(result.value)
    }
  } finally {
    await iterator.return?.()
  }
  return events
}

async function waitForRuntimeEvent(server: RuntimeServer, predicate: (event: RuntimeEvent) => boolean): Promise<RuntimeEvent> {
  const deadline = Date.now() + NON_BLOCKING_START_TIMEOUT_MS
  while (Date.now() < deadline) {
    const event = server.eventBus.snapshot().find(predicate)
    if (event) return event
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("timed out waiting for runtime event")
}

describe("ProcessOpenCodeAdapter", () => {
  test("starts with fake spawn and emits lifecycle start event", async () => {
    const process = new FakeSpawnedProcess(1234)
    const adapter = new ProcessOpenCodeAdapter({
      command: "opencode",
      cwd: "/tmp/demo",
      spawn: () => process,
    })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test objective" })

    const events = await readProcessEvents(adapter, 1)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: "ExecutorLifecycle", phase: "process-started" })
    expect(events[0]?.type === "ExecutorLifecycle" ? events[0].message : "").toContain("pid 1234")
    await expect(adapter.getStatus()).resolves.toMatchObject({ adapter: "process", phase: "running", pid: 1234, command: "opencode" })
  })

  test("spawn failure rejects startSession and records redacted error in status", async () => {
    const adapter = new ProcessOpenCodeAdapter({
      command: "/usr/bin/opencode",
      cwd: "/tmp/demo",
      spawn: () => {
        throw new Error("spawn failed token=super-secret-token")
      },
    })

    await expect(adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })).rejects.toThrow("OpenCode process spawn failed: spawn failed [REDACTED]")
    const status = await adapter.getStatus()

    expect(status).toMatchObject({ adapter: "process", phase: "failed", command: "opencode", lastError: "OpenCode process spawn failed: spawn failed [REDACTED]" })
    expect(JSON.stringify(status)).not.toContain("super-secret-token")
  })

  test("shutdown before start is safe", async () => {
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => new FakeSpawnedProcess() })

    await expect(adapter.shutdown()).resolves.toBeUndefined()
    await expect(adapter.getStatus()).resolves.toMatchObject({ phase: "shutdown" })
  })

  test("shutdown twice is safe", async () => {
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => process })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    await adapter.shutdown()
    await adapter.shutdown()

    expect(process.stdinEnded).toBe(true)
    expect(process.killedWith).toBe("SIGTERM")
    await expect(adapter.getStatus()).resolves.toMatchObject({ phase: "shutdown" })
  })

  test("unexpected process exit surfaces lifecycle event and status error", async () => {
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => process })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    await readProcessEvents(adapter, 1)
    process.emitExit(7, null)

    const events = await readProcessEvents(adapter, 1)
    const status = await adapter.getStatus()

    expect(events).toEqual([{ type: "ExecutorLifecycle", phase: "process-exited", message: "OpenCode process exited unexpectedly with code 7" }])
    expect(status).toMatchObject({ phase: "exited", lastError: "OpenCode process exited unexpectedly with code 7" })
  })

  test("streamExecutorEvents drains only new events", async () => {
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => process })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    const first = await readProcessEvents(adapter, 1)

    process.stdout.emitData("hello")
    const second = await readProcessEvents(adapter, 1)

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    expect(second[0]).toMatchObject({ type: "ExecutorLifecycle", phase: "process-stdout", message: "hello" })
  })

  test("stdout stderr and status text are redacted", async () => {
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({
      command: "/opt/opencode",
      cwd: "/tmp/demo",
      spawn: () => process,
    })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "secret=objective-secret" })
    process.stdout.emitData("stdout token=stdout-secret")
    process.stderr.emitData("stderr Bearer abc.def.ghi12345")
    process.emitError(new Error("process error api_key=error-secret"))

    const events = await readProcessEvents(adapter, 4)
    const serialized = JSON.stringify({ events, status: await adapter.getStatus() })

    expect(serialized).toContain("[REDACTED]")
    expect(serialized).not.toContain("objective-secret")
    expect(serialized).not.toContain("stdout-secret")
    expect(serialized).not.toContain("abc.def.ghi12345")
    expect(serialized).not.toContain("error-secret")
    expect(serialized).not.toContain("/opt/opencode")
  })

  test("sendMissionPacket fails clearly when real transport is not implemented", async () => {
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => new FakeSpawnedProcess() })

    await expect(adapter.sendMissionPacket({ missionId: "m1", message: "hello" })).rejects.toThrow("real mission packet transport not implemented")
  })

  test("RuntimeServer can use injected process adapter with fake spawn without blocking start", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: dir, spawn: () => process })
    const server = new RuntimeServer({ projectDir: dir, adapter })

    const result = await Promise.race([server.start().then(() => "started" as const), timeout(NON_BLOCKING_START_TIMEOUT_MS)])

    expect(result).toBe("started")
    expect(await server.status()).toMatchObject({ runtimeStatus: "started", lockHeld: true })
    expect(server.eventBus.snapshot().map((event) => event.type)).toContain("RuntimeReady")
    await server.shutdown()
  })

  test("RuntimeServer process event pump stays open for late process output and exit", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: dir, spawn: () => process })
    const server = new RuntimeServer({ projectDir: dir, adapter })

    await server.start()
    process.stdout.emitData("late stdout token=late-secret")
    process.emitExit(9, null)

    const stdout = await waitForRuntimeEvent(
      server,
      (event) => event.type === "ExecutorLifecycle" && event.phase === "process-stdout" && event.message.includes("late stdout"),
    )
    const exit = await waitForRuntimeEvent(
      server,
      (event) => event.type === "ExecutorLifecycle" && event.phase === "process-exited" && event.message.includes("unexpectedly with code 9"),
    )

    expect(stdout.type === "ExecutorLifecycle" ? stdout.message : "").toContain("[REDACTED]")
    expect(JSON.stringify(server.eventBus.snapshot())).not.toContain("late-secret")
    expect(exit).toMatchObject({ type: "ExecutorLifecycle", phase: "process-exited" })
    await server.shutdown()
  })

  test("RuntimeServer startNewSession restarts process adapter boundary", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const processes: FakeSpawnedProcess[] = []
    const adapter = new ProcessOpenCodeAdapter({
      command: "opencode",
      cwd: dir,
      spawn: () => {
        const process = new FakeSpawnedProcess(5000 + processes.length)
        processes.push(process)
        return process
      },
    })
    const server = new RuntimeServer({ projectDir: dir, adapter })

    await server.start()
    const result = await server.startNewSession()

    expect(processes).toHaveLength(2)
    expect(processes[0]?.stdinEnded).toBe(true)
    expect(processes[0]?.killedWith).toBe("SIGTERM")
    expect(result.adapter).toMatchObject({ adapter: "process", phase: "running", pid: 5001 })

    processes[0]?.emitExit(0, null)
    expect(await adapter.getStatus()).toMatchObject({ phase: "running", pid: 5001 })
    await server.shutdown()
  })
})
