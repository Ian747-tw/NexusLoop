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
import { MissionRegistry } from "./missions/mission-registry"
import { MissionToolRouter } from "./missions/mission-tool-router"
import { SpecService } from "./spec/spec-service"
import { FakeOpenCodeAdapter } from "./opencode/fake-adapter"
import { ProcessOpenCodeAdapter, type OpenCodeSpawnedProcess, type OpenCodeProcessEventSource } from "./opencode/process-adapter"
import type { MissionPacket } from "./missions/mission-types"
import type { ExecutorToolHandler, ExecutorToolHandlerAdapter, MissionUpdate, OpenCodeRuntimeAdapter, SessionSpec } from "./opencode/adapter"
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

async function readJsonlEvents(dir: string): Promise<Record<string, unknown>[]> {
  try {
    return (await readFile(join(dir, ".nxl", "events.jsonl"), "utf8"))
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
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

function testMissionPacket(overrides: Partial<MissionPacket> = {}): MissionPacket {
  return {
    missionId: "mission_test",
    intentId: "intent_test",
    message: "hello",
    objective: "hello",
    createdAt: "2026-05-10T12:00:00.000Z",
    protocolVersion: 1,
    ...overrides,
  }
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

class ThrowingMissionAdapter extends LongLivedAdapter {
  override async sendMissionPacket(_packet: MissionPacket): Promise<void> {
    throw new Error("adapter send failed token=adapter-secret")
  }
}

class DelayedShutdownEventAdapter implements OpenCodeRuntimeAdapter {
  private shutdownStarted: Promise<void>
  private releaseShutdown!: () => void

  constructor() {
    this.shutdownStarted = new Promise((resolve) => {
      this.releaseShutdown = resolve
    })
  }

  async startSession(_sessionSpec: SessionSpec): Promise<void> {}

  async sendMissionPacket(_packet: MissionPacket): Promise<void> {}

  async pauseAtSafeBoundary(_reason: string): Promise<void> {}

  async resumeWithMissionUpdate(_update: MissionUpdate): Promise<void> {}

  async *streamExecutorEvents(): AsyncIterable<RuntimeEvent> {
    await this.shutdownStarted
    await new Promise((resolve) => setTimeout(resolve, 0))
    yield { type: "ExecutorLifecycle", phase: "delayed-shutdown-event", message: "shutdown telemetry drained" }
  }

  async shutdown(): Promise<void> {
    this.releaseShutdown()
  }

  async getStatus(): Promise<Record<string, unknown>> {
    return { adapter: "delayed-shutdown-event", message: "delayed shutdown telemetry adapter" }
  }
}

class HangingShutdownStreamAdapter implements OpenCodeRuntimeAdapter {
  async startSession(_sessionSpec: SessionSpec): Promise<void> {}

  async sendMissionPacket(_packet: MissionPacket): Promise<void> {}

  async pauseAtSafeBoundary(_reason: string): Promise<void> {}

  async resumeWithMissionUpdate(_update: MissionUpdate): Promise<void> {}

  async *streamExecutorEvents(): AsyncIterable<RuntimeEvent> {
    yield { type: "ExecutorLifecycle", phase: "hanging-stream-started", message: "stream started" }
    await new Promise<never>(() => {})
  }

  async shutdown(): Promise<void> {}

  async getStatus(): Promise<Record<string, unknown>> {
    return { adapter: "hanging-shutdown-stream", message: "hanging shutdown stream adapter" }
  }
}

type ProcessEventName = "close" | "exit" | "error" | "spawn"
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
  stdinWriteError: Error | null
  private spawned = false
  private readonly autoClose: boolean
  private readonly spawnListeners: Array<() => void> = []
  private readonly closeListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = []
  private readonly exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = []
  private readonly errorListeners: Array<(error: Error) => void> = []

  constructor(readonly pid = 4242, options: { autoClose?: boolean; spawned?: boolean; stdinWriteError?: Error } = {}) {
    this.spawned = options.spawned ?? true
    this.autoClose = options.autoClose ?? true
    this.stdinWriteError = options.stdinWriteError ?? null
  }

  stdin = {
    write: (data: string) => {
      if (this.stdinWriteError) throw this.stdinWriteError
      this.stdinWrites.push(data)
      return true
    },
    end: () => {
      this.stdinEnded = true
    },
  }

  on(event: "spawn", listener: () => void): void
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void
  on(event: "error", listener: (error: Error) => void): void
  on(event: ProcessEventName, listener: (() => void) | ((code: number | null, signal: NodeJS.Signals | null) => void) | ((error: Error) => void)): void {
    if (event === "spawn") {
      if (this.spawned) queueMicrotask(listener as () => void)
      else this.spawnListeners.push(listener as () => void)
    } else if (event === "close") this.closeListeners.push(listener as (code: number | null, signal: NodeJS.Signals | null) => void)
    else if (event === "exit") this.exitListeners.push(listener as (code: number | null, signal: NodeJS.Signals | null) => void)
    else this.errorListeners.push(listener as (error: Error) => void)
  }

  kill(signal?: NodeJS.Signals): void {
    this.killedWith = signal
  }

  emitSpawn(): void {
    this.spawned = true
    for (const listener of this.spawnListeners) listener()
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null): void {
    for (const listener of this.exitListeners) listener(code, signal)
    if (this.autoClose) this.emitClose(code, signal)
  }

  emitClose(code: number | null, signal: NodeJS.Signals | null): void {
    for (const listener of this.closeListeners) listener(code, signal)
  }

  emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error)
  }
}

class HandlerCapableAdapter extends LongLivedAdapter implements ExecutorToolHandlerAdapter {
  handler: ExecutorToolHandler | null = null

  setExecutorToolHandler(handler: ExecutorToolHandler): void {
    this.handler = handler
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
    expect((await readJsonlEvents(dir)).map((event) => event.kind)).not.toContain("work_intent_created")
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
    const result = await server.submitUserMessage("hello")

    expect(result).toMatchObject({ accepted: true })
    expect(result.missionId).toMatch(/^mission_/)
    expect(result.intentId).toMatch(/^intent_/)
    expect(adapter.packets).toEqual([
      {
        missionId: result.missionId,
        intentId: result.intentId,
        message: "hello",
        objective: "hello",
        createdAt: expect.any(String),
        protocolVersion: 1,
      },
    ])
    await server.shutdown()
  })

  test("submitUserMessage creates durable redacted intent and mission before adapter delivery", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const adapter = new LongLivedAdapter()
    const server = new RuntimeServer({ projectDir: dir, adapter })

    await server.start()
    const result = await server.submitUserMessage("use token=mission-secret")
    const events = await readJsonlEvents(dir)
    const mission = await server.getMission(result.missionId)

    expect(events.map((event) => event.kind)).toEqual(
      expect.arrayContaining(["work_intent_created", "mission_created", "mission_sent"]),
    )
    expect(mission).toMatchObject({ mission_id: result.missionId, intent_id: result.intentId, objective: "use [REDACTED]", status: "sent" })
    expect(JSON.stringify(events)).not.toContain("mission-secret")
    expect(adapter.packets[0]).toMatchObject({ message: "use token=mission-secret", objective: "use token=mission-secret" })
    await server.shutdown()
  })

  test("adapter send failure marks mission failed with redacted reason", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir, adapter: new ThrowingMissionAdapter() })

    await server.start()
    await expect(server.submitUserMessage("secret=payload-secret")).rejects.toThrow("mission ")
    const missions = await server.listRecentMissions()
    const events = await readJsonlEvents(dir)

    expect(missions).toHaveLength(1)
    expect(missions[0]).toMatchObject({ status: "failed", failure_reason: "adapter send failed [REDACTED]" })
    expect(JSON.stringify({ events, missions })).not.toContain("adapter-secret")
    expect(JSON.stringify({ events, missions })).not.toContain("payload-secret")
    await server.shutdown()
  })

  test("sent-state persistence failure is not marked as adapter delivery failure", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const adapter = new LongLivedAdapter()
    const server = new RuntimeServer({ projectDir: dir, adapter })

    await server.start()
    const append = server.eventStore.append.bind(server.eventStore)
    server.eventStore.append = async (event: Parameters<EventStore["append"]>[0]): Promise<string> => {
      if (event.kind === "mission_sent") throw new Error("mission_sent append failed token=sent-secret")
      return append(event)
    }

    await expect(server.submitUserMessage("deliver token=payload-secret")).rejects.toThrow("adapter delivery succeeded but sent-state persistence failed")
    const events = await readJsonlEvents(dir)
    const missions = await server.listRecentMissions()

    expect(adapter.packets).toHaveLength(1)
    expect(events.map((event) => event.kind)).toEqual(expect.arrayContaining(["work_intent_created", "mission_created"]))
    expect(events.map((event) => event.kind)).not.toContain("mission_failed")
    expect(events.map((event) => event.kind)).not.toContain("mission_sent")
    expect(missions[0]).toMatchObject({ status: "created", objective: "deliver [REDACTED]" })
    expect(JSON.stringify({ events, missions })).not.toContain("sent-secret")
    expect(JSON.stringify({ events, missions })).not.toContain("payload-secret")
    await server.shutdown()
  })

  test("inactive modes reject before mission creation", async () => {
    for (const mode of ["status", "view-records"] as const) {
      const dir = await tempProject()
      await makeProject(dir)
      const adapter = new LongLivedAdapter()
      const server = new RuntimeServer({ projectDir: dir, mode, adapter })

      await server.start()
      await expect(server.submitUserMessage("hello token=mode-secret")).rejects.toThrow("runtime.submit_user_message requires active mode")

      expect(adapter.packets).toHaveLength(0)
      expect((await readJsonlEvents(dir)).map((event) => event.kind)).not.toContain("work_intent_created")
      await server.shutdown()
    }
  })

  test("mission commands list and get recent missions with redacted text", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter() })

    await server.start()
    const first = await server.submitUserMessage("first api_key=first-secret")
    const second = await server.submitUserMessage("second")

    await expect(server.command("runtime.get_mission", { missionId: first.missionId })).resolves.toMatchObject({
      mission_id: first.missionId,
      objective: "first [REDACTED]",
      status: "sent",
    })
    await expect(server.command("runtime.list_recent_missions", { limit: 1 })).resolves.toMatchObject([{ mission_id: second.missionId }])
    expect(JSON.stringify(await server.listRecentMissions())).not.toContain("first-secret")
    await server.shutdown()
  })

  test("runtime status includes accurate redacted mission summary", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir, adapter: new ThrowingMissionAdapter() })

    await server.start()
    await expect(server.submitUserMessage("token=status-secret")).rejects.toThrow("mission ")
    const status = await server.status()

    expect(status.missions).toMatchObject({ pending_count: 0, failed_count: 1, last_mission_id: expect.any(String) })
    expect(JSON.stringify(status)).not.toContain("status-secret")
    await server.shutdown()
  })

  test("mission execution runtime commands validate payloads and return typed redacted records", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter() })

    await server.start()
    const submitted = await server.submitUserMessage("command mission")
    await expect(server.command("runtime.claim_mission", { missionId: "  ", executorId: "executor_1" })).rejects.toThrow("missionId is required")
    await expect(server.command("runtime.list_recent_missions", { limit: 101 })).rejects.toThrow("limit must be no greater than 100")

    const claim = await server.command("runtime.claim_mission", { missionId: submitted.missionId, executorId: "token=executor-secret" })
    const claimId = String((claim as { claim_id: string }).claim_id)
    expect(claim).toMatchObject({ claim_id: expect.any(String), mission_id: submitted.missionId, executor_id: "[REDACTED]", status: "active" })

    await expect(server.command("runtime.record_mission_progress", { missionId: submitted.missionId, claimId, message: "" })).rejects.toThrow("message is required")
    const progress = await server.command("runtime.record_mission_progress", { missionId: submitted.missionId, claimId, message: "working api_key=progress-secret" })
    expect(progress).toMatchObject({ progress_id: expect.any(String), message: "working [REDACTED]" })

    const result = await server.command("runtime.submit_mission_result", {
      missionId: submitted.missionId,
      claimId,
      summary: "summary secret=result-secret",
      artifacts: ["artifact_1"],
      researchResultIds: ["research_1"],
    })
    expect(result).toMatchObject({ result_id: expect.any(String), summary: "summary [REDACTED]", artifacts: ["artifact_1"], research_result_ids: ["research_1"] })

    await expect(server.command("runtime.complete_mission", { missionId: submitted.missionId })).resolves.toMatchObject({ status: "completed" })
    const serialized = JSON.stringify({ status: await server.status(), events: await readJsonlEvents(dir) })
    expect(serialized).not.toContain("executor-secret")
    expect(serialized).not.toContain("progress-secret")
    expect(serialized).not.toContain("result-secret")
    expect(await server.status()).toMatchObject({ missions: { active_claim_count: 0, completed_count: 1, cancelled_count: 0 } })
    await server.shutdown()
  })

  test("mission execution runtime commands require active started runtime", async () => {
    const notStartedDir = await tempProject()
    await makeProject(notStartedDir, { approvedSpec: true })
    const notStarted = new RuntimeServer({ projectDir: notStartedDir, adapter: new LongLivedAdapter() })

    await expect(notStarted.command("runtime.claim_mission", { missionId: "mission_1", executorId: "executor_1" })).rejects.toThrow("runtime must be started before mission execution writes")

    const statusDir = await tempProject()
    await makeProject(statusDir)
    const statusServer = new RuntimeServer({ projectDir: statusDir, mode: "status", adapter: new LongLivedAdapter() })
    await statusServer.start()

    await expect(statusServer.command("runtime.claim_mission", { missionId: "mission_1", executorId: "executor_1" })).rejects.toThrow("runtime.claim_mission requires active mode")
    await expect(statusServer.command("runtime.cancel_mission", { missionId: "mission_1" })).rejects.toThrow("runtime.cancel_mission requires active mode")
    await statusServer.shutdown()
  })

  test("executor mission tool router dispatches read tools", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter() })

    await server.start()
    const first = await server.submitUserMessage("router first token=router-read-secret")
    const second = await server.submitUserMessage("router second")

    await expect(server.executeMissionTool({ call_id: "call_get", tool: "mission.get", payload: { mission_id: first.missionId } })).resolves.toMatchObject({
      call_id: "call_get",
      tool: "mission.get",
      ok: true,
      result: { mission_id: first.missionId, objective: "router first [REDACTED]" },
    })
    await expect(server.executeMissionTool({ call_id: "call_list", tool: "mission.list_recent", payload: { limit: 1 } })).resolves.toMatchObject({
      call_id: "call_list",
      tool: "mission.list_recent",
      ok: true,
      result: [{ mission_id: second.missionId }],
    })
    expect(JSON.stringify(await server.executeMissionTool({ call_id: "call_secret", tool: "mission.get", payload: { mission_id: first.missionId } }))).not.toContain("router-read-secret")
    await server.shutdown()
  })

  test("executor mission tool router dispatches lifecycle writes and collection reads", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter() })

    await server.start()
    const submitted = await server.submitUserMessage("router lifecycle")
    const claim = await server.executeMissionTool({
      call_id: "call_claim",
      tool: "mission.claim",
      payload: { mission_id: submitted.missionId, executor_id: "executor_1" },
    })
    expect(claim).toMatchObject({ ok: true, result: { mission_id: submitted.missionId, status: "active" } })
    const claimId = String(((claim.result as Record<string, unknown>).claim_id))

    const progress = await server.executeMissionTool({
      call_id: "call_progress",
      tool: "mission.record_progress",
      payload: { mission_id: submitted.missionId, claim_id: claimId, message: "halfway" },
    })
    expect(progress).toMatchObject({ ok: true, result: { mission_id: submitted.missionId, claim_id: claimId, message: "halfway" } })

    const result = await server.executeMissionTool({
      call_id: "call_result",
      tool: "mission.submit_result",
      payload: { mission_id: submitted.missionId, claim_id: claimId, summary: "done", artifacts: ["artifact_1"], research_result_ids: ["research_1"] },
    })
    expect(result).toMatchObject({
      ok: true,
      result: { mission_id: submitted.missionId, claim_id: claimId, summary: "done", artifacts: ["artifact_1"], research_result_ids: ["research_1"] },
    })

    await expect(server.executeMissionTool({ call_id: "call_claims", tool: "mission.list_claims", payload: { mission_id: submitted.missionId } })).resolves.toMatchObject({
      ok: true,
      result: [{ claim_id: claimId }],
    })
    await expect(server.executeMissionTool({ call_id: "call_progress_list", tool: "mission.list_progress", payload: { mission_id: submitted.missionId } })).resolves.toMatchObject({
      ok: true,
      result: [{ claim_id: claimId }],
    })
    await expect(server.executeMissionTool({ call_id: "call_results", tool: "mission.list_results", payload: { mission_id: submitted.missionId } })).resolves.toMatchObject({
      ok: true,
      result: [{ claim_id: claimId }],
    })
    await expect(server.executeMissionTool({ call_id: "call_complete", tool: "mission.complete", payload: { mission_id: submitted.missionId } })).resolves.toMatchObject({
      ok: true,
      result: { status: "completed", completion_result_id: (result.result as Record<string, unknown>).result_id },
    })
    await server.shutdown()
  })

  test("executor mission tool router dispatches release fail and cancel writes", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter() })

    await server.start()
    const releasable = await server.submitUserMessage("router release")
    const releaseClaim = await server.executeMissionTool({
      call_id: "call_release_claim",
      tool: "mission.claim",
      payload: { mission_id: releasable.missionId, executor_id: "executor_release" },
    })
    const releaseClaimId = String((releaseClaim.result as Record<string, unknown>).claim_id)
    await expect(server.executeMissionTool({
      call_id: "call_release",
      tool: "mission.release_claim",
      payload: { claim_id: releaseClaimId, reason: "requeue" },
    })).resolves.toMatchObject({ ok: true, result: { claim_id: releaseClaimId, status: "released" } })

    const failing = await server.submitUserMessage("router fail")
    const failClaim = await server.executeMissionTool({
      call_id: "call_fail_claim",
      tool: "mission.claim",
      payload: { mission_id: failing.missionId, executor_id: "executor_fail" },
    })
    await expect(server.executeMissionTool({
      call_id: "call_fail",
      tool: "mission.fail",
      payload: { mission_id: failing.missionId, reason: "failed" },
    })).resolves.toMatchObject({ ok: true, result: { mission_id: failing.missionId, status: "failed" } })
    await expect(server.executeMissionTool({ call_id: "call_fail_claims", tool: "mission.list_claims", payload: { mission_id: failing.missionId } })).resolves.toMatchObject({
      ok: true,
      result: [{ claim_id: (failClaim.result as Record<string, unknown>).claim_id, status: "failed" }],
    })

    const cancelling = await server.submitUserMessage("router cancel")
    const cancelClaim = await server.executeMissionTool({
      call_id: "call_cancel_claim",
      tool: "mission.claim",
      payload: { mission_id: cancelling.missionId, executor_id: "executor_cancel" },
    })
    await expect(server.executeMissionTool({
      call_id: "call_cancel",
      tool: "mission.cancel",
      payload: { mission_id: cancelling.missionId, reason: "cancelled" },
    })).resolves.toMatchObject({ ok: true, result: { mission_id: cancelling.missionId, status: "cancelled" } })
    await expect(server.executeMissionTool({ call_id: "call_cancel_claims", tool: "mission.list_claims", payload: { mission_id: cancelling.missionId } })).resolves.toMatchObject({
      ok: true,
      result: [{ claim_id: (cancelClaim.result as Record<string, unknown>).claim_id, status: "cancelled" }],
    })
    await server.shutdown()
  })

  test("executor mission tool router enforces mission transition rules", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter() })

    await server.start()
    const unsent = await server.missionRegistry.createUserMessageMission("unsent")
    await expect(server.executeMissionTool({
      call_id: "call_unsent",
      tool: "mission.claim",
      payload: { mission_id: unsent.mission.mission_id, executor_id: "executor_1" },
    })).resolves.toMatchObject({ ok: false, error: expect.stringContaining("mission must be sent before claim") })

    const submitted = await server.submitUserMessage("invalid transition")
    const claim = await server.executeMissionTool({ call_id: "call_claim", tool: "mission.claim", payload: { mission_id: submitted.missionId, executor_id: "executor_1" } })
    expect(claim.ok).toBe(true)
    await expect(server.executeMissionTool({
      call_id: "call_duplicate",
      tool: "mission.claim",
      payload: { mission_id: submitted.missionId, executor_id: "executor_2" },
    })).resolves.toMatchObject({ ok: false, error: expect.stringContaining("mission already has an active claim") })
    await expect(server.executeMissionTool({ call_id: "call_complete", tool: "mission.complete", payload: { mission_id: submitted.missionId } })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("mission completion requires a submitted result"),
    })
    await server.shutdown()
  })

  test("executor mission tool router validates payloads and rejects unknown tools", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter() })

    await server.start()
    await expect(server.executeMissionTool({ call_id: "call_unknown", tool: "mission.nope", payload: {} })).resolves.toMatchObject({
      ok: false,
      error: "unknown executor tool: mission.nope",
    })
    await expect(server.executeMissionTool({ call_id: "call_invalid", tool: "mission.get", payload: { mission_id: "  " } })).resolves.toMatchObject({
      ok: false,
      error: "mission_id is required",
    })
    await expect(server.executeMissionTool({ call_id: "call_bad_limit", tool: "mission.list_recent", payload: { limit: 0 } })).resolves.toMatchObject({
      ok: false,
      error: "limit must be a positive integer",
    })
    await expect(server.executeMissionTool({ call_id: "call_null_payload", tool: "mission.get", payload: null as unknown as Record<string, unknown> })).resolves.toMatchObject({
      call_id: "call_null_payload",
      tool: "mission.get",
      ok: false,
      error: "payload must be an object",
    })
    await expect(server.executeMissionTool({ tool: "mission.get", payload: {} } as unknown as Parameters<RuntimeServer["executeMissionTool"]>[0])).resolves.toMatchObject({
      call_id: "invalid_call",
      tool: "mission.get",
      ok: false,
      error: "call_id is required",
    })
    await server.shutdown()
  })

  test("executor mission tool router caps list limits", async () => {
    let capturedLimit: number | undefined
    const router = new MissionToolRouter({
      handlers: {
        getMission: async () => null,
        listRecentMissions: async (limit) => {
          capturedLimit = limit
          return []
        },
        claimMission: async () => {
          throw new Error("unused")
        },
        recordMissionProgress: async () => {
          throw new Error("unused")
        },
        submitMissionResult: async () => {
          throw new Error("unused")
        },
        completeMission: async () => {
          throw new Error("unused")
        },
        failMission: async () => {
          throw new Error("unused")
        },
        cancelMission: async () => {
          throw new Error("unused")
        },
        releaseMissionClaim: async () => {
          throw new Error("unused")
        },
        listMissionClaims: async () => [],
        listMissionProgress: async () => [],
        listMissionResults: async () => [],
      },
    })

    await expect(router.handle({ call_id: "call_list", tool: "mission.list_recent", payload: { limit: 1000 } })).resolves.toMatchObject({ ok: true, result: [] })
    expect(capturedLimit).toBe(100)
  })

  test("executor mission tool router redacts results errors and persisted events", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter() })

    await server.start()
    const submitted = await server.submitUserMessage("router redaction")
    const claim = await server.executeMissionTool({
      call_id: "call_claim",
      tool: "mission.claim",
      payload: { mission_id: submitted.missionId, executor_id: "token=executor-router-secret" },
    })
    expect(claim).toMatchObject({ ok: true, result: { executor_id: "[REDACTED]" } })
    const claimId = String((claim.result as Record<string, unknown>).claim_id)
    await expect(server.executeMissionTool({
      call_id: "call_progress",
      tool: "mission.record_progress",
      payload: { mission_id: submitted.missionId, claim_id: claimId, message: "working api_key=progress-router-secret" },
    })).resolves.toMatchObject({ ok: true, result: { message: "working [REDACTED]" } })
    await expect(server.executeMissionTool({
      call_id: "call_result",
      tool: "mission.submit_result",
      payload: { mission_id: submitted.missionId, claim_id: claimId, summary: "summary secret=result-router-secret" },
    })).resolves.toMatchObject({ ok: true, result: { summary: "summary [REDACTED]" } })
    const unknown = await server.executeMissionTool({ call_id: "call_error", tool: "mission.token=error-router-secret", payload: {} })
    expect(unknown).toMatchObject({ ok: false })
    const serialized = JSON.stringify({ unknown, events: await readJsonlEvents(dir), status: await server.status() })
    expect(serialized).not.toContain("executor-router-secret")
    expect(serialized).not.toContain("progress-router-secret")
    expect(serialized).not.toContain("result-router-secret")
    expect(serialized).not.toContain("error-router-secret")
    await server.shutdown()
  })

  test("executor mission write tools require active started runtime and held lock", async () => {
    const notStartedDir = await tempProject()
    await makeProject(notStartedDir, { approvedSpec: true })
    const notStarted = new RuntimeServer({ projectDir: notStartedDir, adapter: new LongLivedAdapter() })

    await expect(notStarted.executeMissionTool({
      call_id: "call_claim",
      tool: "mission.claim",
      payload: { mission_id: "mission_1", executor_id: "executor_1" },
    })).resolves.toMatchObject({ ok: false, error: "runtime must be started before mission execution writes" })

    const statusDir = await tempProject()
    await makeProject(statusDir)
    const statusServer = new RuntimeServer({ projectDir: statusDir, mode: "status", adapter: new LongLivedAdapter() })
    await statusServer.start()
    await expect(statusServer.executeMissionTool({
      call_id: "call_cancel",
      tool: "mission.cancel",
      payload: { mission_id: "mission_1" },
    })).resolves.toMatchObject({ ok: false, error: "runtime.cancel_mission requires active mode" })
    await statusServer.shutdown()
  })

  test("RuntimeServer registers executeMissionTool with handler-capable adapter", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const adapter = new HandlerCapableAdapter()
    const server = new RuntimeServer({ projectDir: dir, adapter })

    expect(typeof adapter.handler).toBe("function")
    await expect(adapter.handler?.({ call_id: "call_registered", tool: "mission.list_recent", payload: { limit: 1 } })).resolves.toMatchObject({
      call_id: "call_registered",
      tool: "mission.list_recent",
      ok: true,
      result: [],
    })
    await server.shutdown()
  })

  test("process-originated mission.get works through RuntimeServer executeMissionTool", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: dir, spawn: () => process })
    const server = new RuntimeServer({ projectDir: dir, adapter })
    const created = await server.missionRegistry.createUserMessageMission("process get")

    await server.start()
    process.stdout.emitData(`${JSON.stringify({ type: "nxl.executor_tool_call", call_id: "call_get", tool: "mission.get", payload: { mission_id: created.mission.mission_id } })}\n`)

    expect(readToolResultLine((await waitForStdinWrite(process))[0] ?? "")).toMatchObject({
      type: "nxl.executor_tool_result",
      call_id: "call_get",
      tool: "mission.get",
      ok: true,
      result: { mission_id: created.mission.mission_id, objective: "process get" },
    })
    const shutdown = server.shutdown()
    process.emitExit(0, null)
    await shutdown
  })

  test("process-originated mission write fails before runtime start or without active authority", async () => {
    const notStartedDir = await tempProject()
    await makeProject(notStartedDir, { approvedSpec: true })
    const notStartedProcess = new FakeSpawnedProcess()
    const notStartedAdapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: notStartedDir, spawn: () => notStartedProcess })
    const notStarted = new RuntimeServer({ projectDir: notStartedDir, adapter: notStartedAdapter })
    const notStartedMission = await notStarted.missionRegistry.createUserMessageMission("not started process claim")
    await notStarted.missionRegistry.markMissionSent(notStartedMission.mission.mission_id)

    await notStartedAdapter.startSession({ projectDir: notStartedDir, objective: "manual process boundary" })
    notStartedProcess.stdout.emitData(`${JSON.stringify({
      type: "nxl.executor_tool_call",
      call_id: "call_before_start",
      tool: "mission.claim",
      payload: { mission_id: notStartedMission.mission.mission_id, executor_id: "executor_1" },
    })}\n`)
    expect(readToolResultLine((await waitForStdinWrite(notStartedProcess))[0] ?? "")).toMatchObject({
      call_id: "call_before_start",
      ok: false,
      error: "runtime must be started before mission execution writes",
    })
    const notStartedShutdown = notStartedAdapter.shutdown()
    notStartedProcess.emitExit(0, null)
    await notStartedShutdown

    const statusDir = await tempProject()
    await makeProject(statusDir)
    const statusProcess = new FakeSpawnedProcess()
    const statusAdapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: statusDir, spawn: () => statusProcess })
    const statusServer = new RuntimeServer({ projectDir: statusDir, mode: "status", adapter: statusAdapter })
    await statusServer.start()
    await statusAdapter.startSession({ projectDir: statusDir, objective: "manual status process boundary" })
    statusProcess.stdout.emitData(`${JSON.stringify({
      type: "nxl.executor_tool_call",
      call_id: "call_status_mode",
      tool: "mission.cancel",
      payload: { mission_id: "mission_1" },
    })}\n`)

    expect(readToolResultLine((await waitForStdinWrite(statusProcess))[0] ?? "")).toMatchObject({
      call_id: "call_status_mode",
      ok: false,
      error: "runtime.cancel_mission requires active mode",
    })
    const statusShutdown = statusServer.shutdown()
    statusProcess.emitExit(0, null)
    await statusShutdown
  })

  test("process-originated claim progress result and complete happy path works after started active runtime", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: dir, spawn: () => process })
    const server = new RuntimeServer({ projectDir: dir, adapter })
    const created = await server.missionRegistry.createUserMessageMission("process lifecycle")
    await server.missionRegistry.markMissionSent(created.mission.mission_id)

    await server.start()
    process.stdout.emitData(`${JSON.stringify({
      type: "nxl.executor_tool_call",
      call_id: "call_claim",
      tool: "mission.claim",
      payload: { mission_id: created.mission.mission_id, executor_id: "executor_1" },
    })}\n`)
    const claimResult = readToolResultLine((await waitForStdinWrite(process, 1))[0] ?? "")
    const claimId = String((claimResult.result as Record<string, unknown>).claim_id)

    process.stdout.emitData(`${JSON.stringify({
      type: "nxl.executor_tool_call",
      call_id: "call_progress",
      tool: "mission.record_progress",
      payload: { mission_id: created.mission.mission_id, claim_id: claimId, message: "halfway" },
    })}\n`)
    process.stdout.emitData(`${JSON.stringify({
      type: "nxl.executor_tool_call",
      call_id: "call_result",
      tool: "mission.submit_result",
      payload: { mission_id: created.mission.mission_id, claim_id: claimId, summary: "done" },
    })}\n`)
    await waitForStdinWrite(process, 3)
    const submittedResult = readToolResultLine(process.stdinWrites[2] ?? "")

    process.stdout.emitData(`${JSON.stringify({
      type: "nxl.executor_tool_call",
      call_id: "call_complete",
      tool: "mission.complete",
      payload: { mission_id: created.mission.mission_id, result_id: (submittedResult.result as Record<string, unknown>).result_id },
    })}\n`)
    await waitForStdinWrite(process, 4)

    expect(claimResult).toMatchObject({ call_id: "call_claim", ok: true, result: { mission_id: created.mission.mission_id, status: "active" } })
    expect(readToolResultLine(process.stdinWrites[1] ?? "")).toMatchObject({ call_id: "call_progress", ok: true, result: { claim_id: claimId, message: "halfway" } })
    expect(submittedResult).toMatchObject({ call_id: "call_result", ok: true, result: { claim_id: claimId, summary: "done" } })
    expect(readToolResultLine(process.stdinWrites[3] ?? "")).toMatchObject({ call_id: "call_complete", ok: true, result: { status: "completed" } })

    const shutdown = server.shutdown()
    process.emitExit(0, null)
    await shutdown
  })

  test("executor mission read tools work in status and view-records modes", async () => {
    const storeDir = await tempProject()
    const store = new EventStore(join(storeDir, ".nxl", "events.jsonl"))
    const registry = new MissionRegistry({ eventStore: store, projectDir: storeDir })
    const created = await registry.createUserMessageMission("read-only mode mission")

    for (const mode of ["status", "view-records"] as const) {
      const dir = await tempProject()
      await makeProject(dir)
      const server = new RuntimeServer({ projectDir: dir, mode, adapter: new LongLivedAdapter(), missionRegistry: registry })
      await expect(server.executeMissionTool({ call_id: `call_${mode}`, tool: "mission.get", payload: { mission_id: created.mission.mission_id } })).resolves.toMatchObject({
        ok: true,
        result: { mission_id: created.mission.mission_id },
      })
    }
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
    expect((await readJsonlEvents(dir)).map((event) => event.kind)).not.toContain("work_intent_created")
  })

  test("shutdown waits for executor event pump to drain adapter shutdown telemetry", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir, adapter: new DelayedShutdownEventAdapter() })

    await server.start()
    await server.shutdown()

    expect(server.eventBus.snapshot()).toContainEqual({
      type: "ExecutorLifecycle",
      phase: "delayed-shutdown-event",
      message: "shutdown telemetry drained",
    })
  })

  test("shutdown does not hang when executor event stream does not finish", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir, adapter: new HangingShutdownStreamAdapter() })

    await server.start()
    const result = await Promise.race([server.shutdown().then(() => "shutdown" as const), timeout(NON_BLOCKING_START_TIMEOUT_MS)])

    expect(result).toBe("shutdown")
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

describe("MissionRegistry", () => {
  test("uses deterministic id and time hooks and rebuilds projection from events", async () => {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    let nextId = 0
    let nextMs = 0
    const registry = new MissionRegistry({
      eventStore: store,
      projectDir: dir,
      idFactory: (prefix) => `${prefix}_${++nextId}`,
      now: () => new Date(Date.UTC(2026, 4, 10, 12, 0, 0, nextMs++)),
    })

    const created = await registry.createUserMessageMission("run password=secret-password")
    await registry.markMissionSent(created.mission.mission_id)
    const rebuilt = new MissionRegistry({ eventStore: store, projectDir: dir })

    expect(created.intent.intent_id).toBe("intent_1")
    expect(created.mission).toMatchObject({
      mission_id: "mission_2",
      intent_id: "intent_1",
      objective: "run [REDACTED]",
      created_at: "2026-05-10T12:00:00.000Z",
    })
    await expect(rebuilt.getMission("mission_2")).resolves.toMatchObject({ status: "sent", sent_at: "2026-05-10T12:00:00.001Z" })
    await expect(rebuilt.statusSummary()).resolves.toMatchObject({ pending_count: 0, failed_count: 0, last_mission_id: "mission_2" })
    expect(JSON.stringify(await readJsonlEvents(dir))).not.toContain("secret-password")
  })

  test("fails loudly when mission event persistence fails", async () => {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    store.append = async () => {
      throw new Error("mission append failed")
    }
    const registry = new MissionRegistry({ eventStore: store, projectDir: dir })

    await expect(registry.createUserMessageMission("hello")).rejects.toThrow("mission append failed")
    await expect(registry.listRecentMissions()).resolves.toHaveLength(0)
  })

  test("orphan work intents from failed mission creation do not affect mission summaries or hydration", async () => {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    const append = store.append.bind(store)
    store.append = async (event: Parameters<EventStore["append"]>[0]): Promise<string> => {
      if (event.kind === "mission_created") throw new Error("mission_created append failed token=orphan-secret")
      return append(event)
    }
    const registry = new MissionRegistry({ eventStore: store, projectDir: dir })

    await expect(registry.createUserMessageMission("orphan api_key=orphan-payload-secret")).rejects.toThrow("mission_created append failed")
    await expect(registry.listRecentMissions()).resolves.toEqual([])
    await expect(registry.statusSummary()).resolves.toMatchObject({ pending_count: 0, failed_count: 0, last_mission_id: undefined })

    const events = await readJsonlEvents(dir)
    expect(events.map((event) => event.kind)).toEqual(["work_intent_created"])
    expect(JSON.stringify(events)).not.toContain("orphan-payload-secret")
    const rebuilt = new MissionRegistry({ eventStore: store, projectDir: dir })
    await expect(rebuilt.listRecentMissions()).resolves.toEqual([])
    await expect(rebuilt.statusSummary()).resolves.toMatchObject({ pending_count: 0, failed_count: 0, last_mission_id: undefined })
  })

  test("serializes first-time hydration across concurrent readers", async () => {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    const writer = new MissionRegistry({
      eventStore: store,
      projectDir: dir,
      idFactory: (prefix) => `${prefix}_1`,
      now: () => new Date("2026-05-10T12:00:00.000Z"),
    })
    const created = await writer.createUserMessageMission("hello")
    await writer.markMissionSent(created.mission.mission_id)

    const readAll = store.readAll.bind(store)
    let readCalls = 0
    let releaseRead!: () => void
    const readStarted = new Promise<void>((resolve) => {
      store.readAll = async () => {
        readCalls += 1
        resolve()
        await new Promise<void>((release) => {
          releaseRead = release
        })
        return readAll()
      }
    })
    const reader = new MissionRegistry({ eventStore: store, projectDir: dir })

    const mission = reader.getMission(created.mission.mission_id)
    const recent = reader.listRecentMissions()
    const summary = reader.statusSummary()
    await readStarted
    expect(readCalls).toBe(1)
    releaseRead()

    await expect(mission).resolves.toMatchObject({ status: "sent" })
    await expect(recent).resolves.toMatchObject([{ status: "sent" }])
    await expect(summary).resolves.toMatchObject({ pending_count: 0, failed_count: 0, last_mission_id: created.mission.mission_id })
    expect(readCalls).toBe(1)
  })

  test("claims sent missions and rejects unsent duplicate or terminal claims", async () => {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    let nextId = 0
    const registry = new MissionRegistry({
      eventStore: store,
      projectDir: dir,
      idFactory: (prefix) => `${prefix}_${++nextId}`,
      now: () => new Date("2026-05-10T12:00:00.000Z"),
    })

    const unsent = await registry.createUserMessageMission("unsent")
    await expect(registry.claimMission({ mission_id: unsent.mission.mission_id, executor_id: "executor_1" })).rejects.toThrow("mission must be sent before claim")

    const sent = await registry.createUserMessageMission("sent")
    await registry.markMissionSent(sent.mission.mission_id)
    const claim = await registry.claimMission({ mission_id: sent.mission.mission_id, executor_id: "executor_1" })

    expect(claim).toMatchObject({ claim_id: "claim_5", mission_id: sent.mission.mission_id, status: "active" })
    await expect(registry.getMission(sent.mission.mission_id)).resolves.toMatchObject({ status: "claimed" })
    await expect(registry.claimMission({ mission_id: sent.mission.mission_id, executor_id: "executor_2" })).rejects.toThrow("mission already has an active claim")

    await registry.cancelMission(sent.mission.mission_id, "done")
    await expect(registry.claimMission({ mission_id: sent.mission.mission_id, executor_id: "executor_3" })).rejects.toThrow("terminal mission cannot claim")
  })

  test("concurrent mission claims preserve the single active claim invariant", async () => {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    let nextId = 0
    const registry = new MissionRegistry({
      eventStore: store,
      projectDir: dir,
      idFactory: (prefix) => `${prefix}_${++nextId}`,
      now: () => new Date("2026-05-10T12:00:00.000Z"),
    })
    const created = await registry.createUserMessageMission("race")
    await registry.markMissionSent(created.mission.mission_id)

    const results = await Promise.allSettled([
      registry.claimMission({ mission_id: created.mission.mission_id, executor_id: "executor_1" }),
      registry.claimMission({ mission_id: created.mission.mission_id, executor_id: "executor_2" }),
    ])

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
    await expect(registry.listMissionClaims(created.mission.mission_id)).resolves.toMatchObject([{ status: "active" }])
    await expect(registry.statusSummary()).resolves.toMatchObject({ active_claim_count: 1 })
  })

  test("progress result and completion require active claim and submitted result", async () => {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    let nextId = 0
    let nextMs = 0
    const registry = new MissionRegistry({
      eventStore: store,
      projectDir: dir,
      idFactory: (prefix) => `${prefix}_${++nextId}`,
      now: () => new Date(Date.UTC(2026, 4, 10, 12, 0, 0, nextMs++)),
    })
    const created = await registry.createUserMessageMission("run")
    await registry.markMissionSent(created.mission.mission_id)

    await expect(registry.recordMissionProgress({ mission_id: created.mission.mission_id, claim_id: "missing", message: "working" })).rejects.toThrow("mission claim not found")
    await expect(registry.submitMissionResult({ mission_id: created.mission.mission_id, claim_id: "missing", summary: "done" })).rejects.toThrow("mission claim not found")
    await expect(registry.completeMission(created.mission.mission_id)).rejects.toThrow("mission completion requires an active claim")

    const claim = await registry.claimMission({ mission_id: created.mission.mission_id, executor_id: "executor_1" })
    await expect(registry.completeMission(created.mission.mission_id)).rejects.toThrow("mission completion requires a submitted result")
    const progress = await registry.recordMissionProgress({ mission_id: created.mission.mission_id, claim_id: claim.claim_id, message: "halfway token=progress-secret" })
    const result = await registry.submitMissionResult({
      mission_id: created.mission.mission_id,
      claim_id: claim.claim_id,
      summary: "finished secret=result-secret",
      artifacts: ["log.txt"],
      research_result_ids: ["research_1"],
    })
    const completed = await registry.completeMission(created.mission.mission_id, { result_id: result.result_id })

    expect(progress).toMatchObject({ message: "halfway [REDACTED]" })
    expect(result).toMatchObject({ summary: "finished [REDACTED]", status: "submitted", artifacts: ["log.txt"], research_result_ids: ["research_1"] })
    expect(completed).toMatchObject({ status: "completed", completion_result_id: result.result_id })
    await expect(registry.getMissionClaim(claim.claim_id)).resolves.toMatchObject({ status: "completed" })
    await expect(registry.completeMission(created.mission.mission_id, { result_id: result.result_id })).resolves.toMatchObject({ status: "completed" })
    await expect(registry.completeMission(created.mission.mission_id, { result_id: result.result_id, summary: "different" })).rejects.toThrow("terminal mission completion conflicts")
    expect(JSON.stringify(await readJsonlEvents(dir))).not.toContain("progress-secret")
    expect(JSON.stringify(await readJsonlEvents(dir))).not.toContain("result-secret")
  })

  test("completed mission retry without result id preserves the original completion result", async () => {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    let nextId = 0
    const registry = new MissionRegistry({
      eventStore: store,
      projectDir: dir,
      idFactory: (prefix) => `${prefix}_${++nextId}`,
      now: () => new Date("2026-05-10T12:00:00.000Z"),
    })
    const created = await registry.createUserMessageMission("multi-result")
    await registry.markMissionSent(created.mission.mission_id)
    const claim = await registry.claimMission({ mission_id: created.mission.mission_id, executor_id: "executor_1" })
    const first = await registry.submitMissionResult({ mission_id: created.mission.mission_id, claim_id: claim.claim_id, summary: "first" })
    const second = await registry.submitMissionResult({ mission_id: created.mission.mission_id, claim_id: claim.claim_id, summary: "second" })

    await expect(registry.completeMission(created.mission.mission_id, { result_id: second.result_id })).resolves.toMatchObject({ status: "completed", completion_result_id: second.result_id })
    await expect(registry.completeMission(created.mission.mission_id)).resolves.toMatchObject({ status: "completed", completion_result_id: second.result_id })
    await expect(registry.completeMission(created.mission.mission_id, { result_id: first.result_id })).rejects.toThrow("terminal mission completion conflicts")
  })

  test("completed mission retry may omit an already persisted summary", async () => {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    let nextId = 0
    const registry = new MissionRegistry({
      eventStore: store,
      projectDir: dir,
      idFactory: (prefix) => `${prefix}_${++nextId}`,
      now: () => new Date("2026-05-10T12:00:00.000Z"),
    })
    const created = await registry.createUserMessageMission("summary-retry")
    await registry.markMissionSent(created.mission.mission_id)
    const claim = await registry.claimMission({ mission_id: created.mission.mission_id, executor_id: "executor_1" })
    const result = await registry.submitMissionResult({ mission_id: created.mission.mission_id, claim_id: claim.claim_id, summary: "done" })

    await expect(registry.completeMission(created.mission.mission_id, { result_id: result.result_id, summary: "accepted" })).resolves.toMatchObject({
      completion_summary: "accepted",
    })
    await expect(registry.completeMission(created.mission.mission_id, { result_id: result.result_id })).resolves.toMatchObject({
      completion_summary: "accepted",
    })
    await expect(registry.completeMission(created.mission.mission_id, { result_id: result.result_id, summary: "different" })).rejects.toThrow("terminal mission completion conflicts")
  })

  test("concurrent mission completions preserve a single terminal event", async () => {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    let nextId = 0
    const registry = new MissionRegistry({
      eventStore: store,
      projectDir: dir,
      idFactory: (prefix) => `${prefix}_${++nextId}`,
      now: () => new Date("2026-05-10T12:00:00.000Z"),
    })
    const created = await registry.createUserMessageMission("complete-race")
    await registry.markMissionSent(created.mission.mission_id)
    const claim = await registry.claimMission({ mission_id: created.mission.mission_id, executor_id: "executor_1" })
    const first = await registry.submitMissionResult({ mission_id: created.mission.mission_id, claim_id: claim.claim_id, summary: "first" })
    const second = await registry.submitMissionResult({ mission_id: created.mission.mission_id, claim_id: claim.claim_id, summary: "second" })

    const results = await Promise.allSettled([
      registry.completeMission(created.mission.mission_id, { result_id: first.result_id, summary: "first accepted" }),
      registry.completeMission(created.mission.mission_id, { result_id: second.result_id, summary: "second accepted" }),
    ])

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    const rejected = results.filter((result) => result.status === "rejected")
    expect(rejected).toHaveLength(1)
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toContain("terminal mission completion conflicts")
    await expect(registry.getMission(created.mission.mission_id)).resolves.toMatchObject({ status: "completed" })
    const events = await readJsonlEvents(dir)
    expect(events.filter((event) => event.kind === "mission_completed")).toHaveLength(1)
  })

  test("released claims are no longer active and allow a later claim", async () => {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    let nextId = 0
    const registry = new MissionRegistry({
      eventStore: store,
      projectDir: dir,
      idFactory: (prefix) => `${prefix}_${++nextId}`,
      now: () => new Date("2026-05-10T12:00:00.000Z"),
    })
    const created = await registry.createUserMessageMission("release")
    await registry.markMissionSent(created.mission.mission_id)
    const first = await registry.claimMission({ mission_id: created.mission.mission_id, executor_id: "executor_1" })

    await expect(registry.releaseMissionClaim(first.claim_id, "secret=release-secret")).resolves.toMatchObject({ status: "released", release_reason: "[REDACTED]" })
    await expect(registry.recordMissionProgress({ mission_id: created.mission.mission_id, claim_id: first.claim_id, message: "late" })).rejects.toThrow("mission claim is not active")
    const second = await registry.claimMission({ mission_id: created.mission.mission_id, executor_id: "executor_2" })

    expect(second).toMatchObject({ claim_id: "claim_4", status: "active" })
    await expect(registry.statusSummary()).resolves.toMatchObject({ active_claim_count: 1 })
    expect(JSON.stringify(await readJsonlEvents(dir))).not.toContain("release-secret")
  })

  test("concurrent claim release blocks progress and result writes after release wins", async () => {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    let nextId = 0
    const registry = new MissionRegistry({
      eventStore: store,
      projectDir: dir,
      idFactory: (prefix) => `${prefix}_${++nextId}`,
      now: () => new Date("2026-05-10T12:00:00.000Z"),
    })
    const progressMission = await registry.createUserMessageMission("progress-release-race")
    await registry.markMissionSent(progressMission.mission.mission_id)
    const progressClaim = await registry.claimMission({ mission_id: progressMission.mission.mission_id, executor_id: "executor_1" })

    const progressResults = await Promise.allSettled([
      registry.releaseMissionClaim(progressClaim.claim_id),
      registry.recordMissionProgress({ mission_id: progressMission.mission.mission_id, claim_id: progressClaim.claim_id, message: "late progress" }),
    ])

    expect(progressResults.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    const rejectedProgress = progressResults.filter((result) => result.status === "rejected")
    expect(rejectedProgress).toHaveLength(1)
    expect(String((rejectedProgress[0] as PromiseRejectedResult).reason)).toContain("mission claim is not active")
    await expect(registry.listMissionProgress(progressMission.mission.mission_id)).resolves.toEqual([])

    const resultMission = await registry.createUserMessageMission("result-release-race")
    await registry.markMissionSent(resultMission.mission.mission_id)
    const resultClaim = await registry.claimMission({ mission_id: resultMission.mission.mission_id, executor_id: "executor_2" })

    const resultResults = await Promise.allSettled([
      registry.releaseMissionClaim(resultClaim.claim_id),
      registry.submitMissionResult({ mission_id: resultMission.mission.mission_id, claim_id: resultClaim.claim_id, summary: "late result" }),
    ])

    expect(resultResults.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    const rejectedResult = resultResults.filter((result) => result.status === "rejected")
    expect(rejectedResult).toHaveLength(1)
    expect(String((rejectedResult[0] as PromiseRejectedResult).reason)).toContain("mission claim is not active")
    await expect(registry.listMissionResults(resultMission.mission.mission_id)).resolves.toEqual([])
  })

  test("completion result must belong to the active claim", async () => {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    let nextId = 0
    const registry = new MissionRegistry({
      eventStore: store,
      projectDir: dir,
      idFactory: (prefix) => `${prefix}_${++nextId}`,
      now: () => new Date("2026-05-10T12:00:00.000Z"),
    })
    const created = await registry.createUserMessageMission("claim-attribution")
    await registry.markMissionSent(created.mission.mission_id)
    const firstClaim = await registry.claimMission({ mission_id: created.mission.mission_id, executor_id: "executor_1" })
    const staleResult = await registry.submitMissionResult({ mission_id: created.mission.mission_id, claim_id: firstClaim.claim_id, summary: "stale" })
    await registry.releaseMissionClaim(firstClaim.claim_id)
    const activeClaim = await registry.claimMission({ mission_id: created.mission.mission_id, executor_id: "executor_2" })

    await expect(registry.completeMission(created.mission.mission_id, { result_id: staleResult.result_id })).rejects.toThrow("mission completion result must belong to active claim")
    const activeResult = await registry.submitMissionResult({ mission_id: created.mission.mission_id, claim_id: activeClaim.claim_id, summary: "active" })
    await expect(registry.completeMission(created.mission.mission_id, { result_id: activeResult.result_id })).resolves.toMatchObject({
      status: "completed",
      completion_result_id: activeResult.result_id,
    })
    await expect(registry.getMissionClaim(activeClaim.claim_id)).resolves.toMatchObject({ status: "completed" })
  })

  test("completion without result id selects a submitted result from the active claim", async () => {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    let nextId = 0
    const registry = new MissionRegistry({
      eventStore: store,
      projectDir: dir,
      idFactory: (prefix) => `${prefix}_${++nextId}`,
      now: () => new Date("2026-05-10T12:00:00.000Z"),
    })
    const created = await registry.createUserMessageMission("active-default-result")
    await registry.markMissionSent(created.mission.mission_id)
    const firstClaim = await registry.claimMission({ mission_id: created.mission.mission_id, executor_id: "executor_1" })
    await registry.submitMissionResult({ mission_id: created.mission.mission_id, claim_id: firstClaim.claim_id, summary: "stale" })
    await registry.releaseMissionClaim(firstClaim.claim_id)
    const activeClaim = await registry.claimMission({ mission_id: created.mission.mission_id, executor_id: "executor_2" })
    await registry.submitMissionResult({ mission_id: created.mission.mission_id, claim_id: activeClaim.claim_id, summary: "active draft" })
    const activeResult = await registry.submitMissionResult({ mission_id: created.mission.mission_id, claim_id: activeClaim.claim_id, summary: "active final" })

    await expect(registry.completeMission(created.mission.mission_id)).resolves.toMatchObject({
      status: "completed",
      completion_result_id: activeResult.result_id,
    })
  })

  test("claim release clears prior running timestamp before the next result", async () => {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    let nextId = 0
    let nextMs = 0
    const registry = new MissionRegistry({
      eventStore: store,
      projectDir: dir,
      idFactory: (prefix) => `${prefix}_${++nextId}`,
      now: () => new Date(Date.UTC(2026, 4, 10, 12, 0, 0, nextMs++)),
    })
    const created = await registry.createUserMessageMission("running-handoff")
    await registry.markMissionSent(created.mission.mission_id)
    const firstClaim = await registry.claimMission({ mission_id: created.mission.mission_id, executor_id: "executor_1" })
    const progress = await registry.recordMissionProgress({ mission_id: created.mission.mission_id, claim_id: firstClaim.claim_id, message: "first attempt" })
    await expect(registry.getMission(created.mission.mission_id)).resolves.toMatchObject({ running_at: progress.created_at })
    await registry.releaseMissionClaim(firstClaim.claim_id)
    await expect(registry.getMission(created.mission.mission_id)).resolves.not.toHaveProperty("running_at")

    const activeClaim = await registry.claimMission({ mission_id: created.mission.mission_id, executor_id: "executor_2" })
    const result = await registry.submitMissionResult({ mission_id: created.mission.mission_id, claim_id: activeClaim.claim_id, summary: "second attempt" })

    await expect(registry.getMission(created.mission.mission_id)).resolves.toMatchObject({ running_at: result.created_at })
  })

  test("failure and cancellation mark active claims and terminal rewrites are idempotent only for matching payloads", async () => {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    let nextId = 0
    const registry = new MissionRegistry({
      eventStore: store,
      projectDir: dir,
      idFactory: (prefix) => `${prefix}_${++nextId}`,
      now: () => new Date("2026-05-10T12:00:00.000Z"),
    })

    const failing = await registry.createUserMessageMission("fail")
    await registry.markMissionSent(failing.mission.mission_id)
    const failedClaim = await registry.claimMission({ mission_id: failing.mission.mission_id, executor_id: "executor_1" })
    await expect(registry.failMission(failing.mission.mission_id, "token=fail-secret")).resolves.toMatchObject({ status: "failed", failure_reason: "[REDACTED]" })
    await expect(registry.getMissionClaim(failedClaim.claim_id)).resolves.toMatchObject({ status: "failed", failure_reason: "[REDACTED]" })
    await expect(registry.failMission(failing.mission.mission_id, "token=fail-secret")).resolves.toMatchObject({ status: "failed" })
    await expect(registry.failMission(failing.mission.mission_id, "different")).rejects.toThrow("terminal mission failure conflicts")
    await expect(registry.cancelMission(failing.mission.mission_id, "late")).rejects.toThrow("terminal mission cannot cancel")

    const cancelling = await registry.createUserMessageMission("cancel")
    await registry.markMissionSent(cancelling.mission.mission_id)
    const cancelledClaim = await registry.claimMission({ mission_id: cancelling.mission.mission_id, executor_id: "executor_2" })
    await expect(registry.cancelMission(cancelling.mission.mission_id, "secret=cancel-secret")).resolves.toMatchObject({ status: "cancelled", cancellation_reason: "[REDACTED]" })
    await expect(registry.getMissionClaim(cancelledClaim.claim_id)).resolves.toMatchObject({ status: "cancelled", cancellation_reason: "[REDACTED]" })
    await expect(registry.cancelMission(cancelling.mission.mission_id, "secret=cancel-secret")).resolves.toMatchObject({ status: "cancelled" })
    await expect(registry.cancelMission(cancelling.mission.mission_id, "different")).rejects.toThrow("terminal mission cancellation conflicts")

    expect(JSON.stringify(await readJsonlEvents(dir))).not.toContain("fail-secret")
    expect(JSON.stringify(await readJsonlEvents(dir))).not.toContain("cancel-secret")
  })

  test("concurrent failure and cancellation preserve a single terminal event", async () => {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    let nextId = 0
    const registry = new MissionRegistry({
      eventStore: store,
      projectDir: dir,
      idFactory: (prefix) => `${prefix}_${++nextId}`,
      now: () => new Date("2026-05-10T12:00:00.000Z"),
    })
    const created = await registry.createUserMessageMission("terminal-race")
    await registry.markMissionSent(created.mission.mission_id)
    const claim = await registry.claimMission({ mission_id: created.mission.mission_id, executor_id: "executor_1" })

    const results = await Promise.allSettled([registry.failMission(created.mission.mission_id, "failed"), registry.cancelMission(created.mission.mission_id, "cancelled")])

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    const rejected = results.filter((result) => result.status === "rejected")
    expect(rejected).toHaveLength(1)
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toContain("terminal mission cannot")
    const mission = await registry.getMission(created.mission.mission_id)
    expect(mission).not.toBeNull()
    const terminalStatus = mission!.status
    expect(["failed", "cancelled"]).toContain(terminalStatus)
    if (mission?.status === "failed") expect(mission.cancelled_at).toBeUndefined()
    if (mission?.status === "cancelled") expect(mission.failure_reason).toBeUndefined()
    await expect(registry.getMissionClaim(claim.claim_id)).resolves.toMatchObject({ status: terminalStatus })
    const events = await readJsonlEvents(dir)
    expect(events.filter((event) => event.kind === "mission_failed" || event.kind === "mission_cancelled")).toHaveLength(1)
  })

  test("event-log hydration rebuilds claim progress result and mission status projections", async () => {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    let nextId = 0
    let nextMs = 0
    const writer = new MissionRegistry({
      eventStore: store,
      projectDir: dir,
      idFactory: (prefix) => `${prefix}_${++nextId}`,
      now: () => new Date(Date.UTC(2026, 4, 10, 12, 0, 0, nextMs++)),
    })
    const created = await writer.createUserMessageMission("hydrate")
    await writer.markMissionSent(created.mission.mission_id)
    const claim = await writer.claimMission({ mission_id: created.mission.mission_id, executor_id: "executor_1" })
    const progress = await writer.recordMissionProgress({ mission_id: created.mission.mission_id, claim_id: claim.claim_id, message: "working" })
    const result = await writer.submitMissionResult({ mission_id: created.mission.mission_id, claim_id: claim.claim_id, summary: "done" })
    await writer.completeMission(created.mission.mission_id)

    const rebuilt = new MissionRegistry({ eventStore: store, projectDir: dir })

    await expect(rebuilt.getMission(created.mission.mission_id)).resolves.toMatchObject({ status: "completed", completion_result_id: result.result_id })
    await expect(rebuilt.listMissionClaims(created.mission.mission_id)).resolves.toMatchObject([{ claim_id: claim.claim_id, status: "completed" }])
    await expect(rebuilt.listMissionProgress(created.mission.mission_id)).resolves.toMatchObject([{ progress_id: progress.progress_id, message: "working" }])
    await expect(rebuilt.listMissionResults(created.mission.mission_id)).resolves.toMatchObject([{ result_id: result.result_id, status: "submitted" }])
    await expect(rebuilt.statusSummary()).resolves.toMatchObject({ active_claim_count: 0, completed_count: 1, cancelled_count: 0, failed_count: 0 })
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
    await adapter.sendMissionPacket(testMissionPacket({ missionId: "m1" }))

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

    await adapter.sendMissionPacket(testMissionPacket({ missionId: "m2", message: "next", objective: "next" }))
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

async function waitForStdinWrite(process: FakeSpawnedProcess, count = 1): Promise<string[]> {
  const deadline = Date.now() + NON_BLOCKING_START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (process.stdinWrites.length >= count) return process.stdinWrites
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${count} stdin writes`)
}

function readToolResultLine(line: string): Record<string, unknown> {
  expect(line.endsWith("\n")).toBe(true)
  return JSON.parse(line) as Record<string, unknown>
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

  test("async spawn error rejects RuntimeServer start before readiness", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const process = new FakeSpawnedProcess(4242, { spawned: false })
    const adapter = new ProcessOpenCodeAdapter({
      command: "missing-opencode",
      cwd: dir,
      spawn: () => {
        queueMicrotask(() => process.emitError(new Error("ENOENT token=spawn-secret")))
        return process
      },
    })
    const server = new RuntimeServer({ projectDir: dir, adapter })

    await expect(server.start()).rejects.toThrow("OpenCode process spawn failed: ENOENT [REDACTED]")
    expect(server.eventBus.snapshot().map((event) => event.type)).not.toContain("RuntimeReady")
    expect(JSON.stringify(await adapter.getStatus())).not.toContain("spawn-secret")
  })

  test("immediate post-spawn exit rejects startSession before readiness", async () => {
    const process = new FakeSpawnedProcess(4242, { spawned: false })
    const adapter = new ProcessOpenCodeAdapter({
      command: "opencode",
      cwd: "/tmp/demo",
      spawn: () => process,
    })

    const started = adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    process.emitSpawn()
    process.emitExit(2, null)

    await expect(started).rejects.toThrow("OpenCode process spawn failed: OpenCode process exited with code 2")
    await expect(adapter.getStatus()).resolves.toMatchObject({ adapter: "process", phase: "failed", pid: undefined })
  })

  test("spawn readiness timeout terminates child and remains shutdown-drainable", async () => {
    const process = new FakeSpawnedProcess(4242, { spawned: false })
    const adapter = new ProcessOpenCodeAdapter({
      command: "opencode",
      cwd: "/tmp/demo",
      spawnTimeoutMs: 1,
      spawn: () => process,
    })

    await expect(adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })).rejects.toThrow("OpenCode process spawn failed: timed out after 1ms")
    expect(process.stdinEnded).toBe(true)
    expect(process.killedWith).toBe("SIGTERM")
    await expect(adapter.getStatus()).resolves.toMatchObject({ phase: "failed", pid: undefined, terminatingPids: [4242] })

    const shutdown = adapter.shutdown()
    process.emitExit(0, null)
    await expect(shutdown).resolves.toBeUndefined()
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
    const shutdown = adapter.shutdown()
    process.emitExit(0, null)
    await shutdown
    await adapter.shutdown()

    expect(process.stdinEnded).toBe(true)
    expect(process.killedWith).toBe("SIGTERM")
    await expect(adapter.getStatus()).resolves.toMatchObject({ phase: "shutdown" })
  })

  test("shutdown waits for process exit before resolving", async () => {
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => process })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    const pendingShutdown = adapter.shutdown()
    const shutdownRace = Promise.race([pendingShutdown.then(() => "shutdown" as const), timeout(20)])

    expect(process.stdinEnded).toBe(true)
    expect(process.killedWith).toBe("SIGTERM")
    await expect(shutdownRace).resolves.toBe("timeout")

    process.emitExit(0, null)
    await expect(pendingShutdown).resolves.toBeUndefined()
    await expect(adapter.shutdown()).resolves.toBeUndefined()
    await expect(adapter.getStatus()).resolves.toMatchObject({ phase: "shutdown" })
  })

  test("concurrent shutdown calls share the same process exit", async () => {
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", shutdownTimeoutMs: 50, spawn: () => process })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    const firstShutdown = adapter.shutdown()
    const secondShutdown = adapter.shutdown()

    process.emitExit(0, null)

    await expect(firstShutdown).resolves.toBeUndefined()
    await expect(secondShutdown).resolves.toBeUndefined()
    await expect(adapter.getStatus()).resolves.toMatchObject({ phase: "shutdown", pid: undefined, terminatingPids: [] })
  })

  test("shutdown timeout fails clearly and redacts status error", async () => {
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", shutdownTimeoutMs: 1, spawn: () => process })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    await expect(adapter.shutdown()).rejects.toThrow("OpenCode process shutdown failed: timed out after 1ms")
    await expect(adapter.getStatus()).resolves.toMatchObject({
      phase: "shutdown",
      pid: 4242,
      terminatingPids: [4242],
      lastError: "OpenCode process shutdown failed: timed out after 1ms",
    })

    const retry = adapter.shutdown()
    process.emitExit(0, null)
    await expect(retry).resolves.toBeUndefined()
    await expect(adapter.getStatus()).resolves.toMatchObject({ phase: "shutdown", pid: undefined, terminatingPids: [] })
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

  test("streamExecutorEvents compacts drained process events", async () => {
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => process })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    process.stdout.emitData("one")
    process.stderr.emitData("two")
    await readProcessEvents(adapter, 3)

    expect((adapter as unknown as { events: RuntimeEvent[] }).events).toHaveLength(0)

    process.stdout.emitData("three")
    const next = await readProcessEvents(adapter, 1)

    expect(next).toEqual([{ type: "ExecutorLifecycle", phase: "process-stdout", message: "three" }])
    expect((adapter as unknown as { events: RuntimeEvent[] }).events).toHaveLength(0)
  })

  test("parses executor tool call stdout JSONL and invokes injected handler", async () => {
    const process = new FakeSpawnedProcess()
    const calls: unknown[] = []
    const adapter = new ProcessOpenCodeAdapter({
      command: "opencode",
      cwd: "/tmp/demo",
      spawn: () => process,
      toolHandler: async (call) => {
        calls.push(call)
        return { call_id: call.call_id, tool: call.tool, ok: true, result: { mission_id: call.payload.mission_id }, created_at: "2026-05-13T00:00:00.000Z" }
      },
    })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    process.stdout.emitData(JSON.stringify({ type: "nxl.executor_tool_call", call_id: "call_1", tool: "mission.get", payload: { mission_id: "mission_1" } }) + "\n")

    const [write] = await waitForStdinWrite(process)
    expect(calls).toEqual([{ type: "nxl.executor_tool_call", call_id: "call_1", tool: "mission.get", payload: { mission_id: "mission_1" } }])
    expect(readToolResultLine(write)).toEqual({
      type: "nxl.executor_tool_result",
      call_id: "call_1",
      tool: "mission.get",
      ok: true,
      result: { mission_id: "mission_1" },
      created_at: "2026-05-13T00:00:00.000Z",
    })
  })

  test("writes exactly one newline-terminated executor tool result JSON line", async () => {
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({
      command: "opencode",
      cwd: "/tmp/demo",
      spawn: () => process,
      toolHandler: async (call) => ({ call_id: call.call_id, tool: call.tool, ok: true, result: { ok: true }, created_at: "2026-05-13T00:00:00.000Z" }),
    })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    process.stdout.emitData(`${JSON.stringify({ type: "nxl.executor_tool_call", call_id: "call_single", tool: "mission.get", payload: {} })}\n`)
    await waitForStdinWrite(process)

    expect(process.stdinWrites).toHaveLength(1)
    expect(process.stdinWrites[0]?.endsWith("\n")).toBe(true)
    expect(process.stdinWrites[0]?.split("\n")).toHaveLength(2)
    expect(readToolResultLine(process.stdinWrites[0] ?? "")).toMatchObject({ type: "nxl.executor_tool_result", call_id: "call_single", ok: true })
  })

  test("non-tool stdout and non-tool JSON remain process stdout events", async () => {
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => process })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    await readProcessEvents(adapter, 1)
    process.stdout.emitData("plain output\n")
    process.stdout.emitData(`${JSON.stringify({ type: "nxl.not_a_tool", call_id: "call_ignored" })}\n`)

    const events = await readProcessEvents(adapter, 2)

    expect(events).toEqual([
      { type: "ExecutorLifecycle", phase: "process-stdout", message: "plain output" },
      { type: "ExecutorLifecycle", phase: "process-stdout", message: JSON.stringify({ type: "nxl.not_a_tool", call_id: "call_ignored" }) },
    ])
    expect(process.stdinWrites).toHaveLength(0)
  })

  test("malformed JSON stdout does not crash adapter", async () => {
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => process })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    await readProcessEvents(adapter, 1)
    process.stdout.emitData("{not-json\n")

    expect(await readProcessEvents(adapter, 1)).toEqual([{ type: "ExecutorLifecycle", phase: "process-stdout", message: "{not-json" }])
    await expect(adapter.getStatus()).resolves.toMatchObject({ phase: "running" })
  })

  test("unknown tool result is written as ok false and redacted", async () => {
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({
      command: "opencode",
      cwd: "/tmp/demo",
      spawn: () => process,
      toolHandler: async (call) => ({
        call_id: call.call_id,
        tool: call.tool,
        ok: false,
        error: `unknown executor tool: ${call.tool}`,
        created_at: "2026-05-13T00:00:00.000Z",
      }),
    })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    process.stdout.emitData(`${JSON.stringify({ type: "nxl.executor_tool_call", call_id: "call_unknown", tool: "mission.token=secret-tool", payload: {} })}\n`)

    const [write] = await waitForStdinWrite(process)
    const result = readToolResultLine(write)

    expect(result).toMatchObject({ type: "nxl.executor_tool_result", call_id: "call_unknown", ok: false })
    expect(JSON.stringify(result)).toContain("[REDACTED]")
    expect(JSON.stringify(result)).not.toContain("secret-tool")
  })

  test("malformed tool envelope returns ok false result when fallback fields are possible", async () => {
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({
      command: "opencode",
      cwd: "/tmp/demo",
      spawn: () => process,
      toolHandler: async (call) => ({
        call_id: typeof call.call_id === "string" ? call.call_id : "invalid_call",
        tool: typeof call.tool === "string" ? call.tool : "invalid_tool",
        ok: false,
        error: "payload must be an object",
        created_at: "2026-05-13T00:00:00.000Z",
      }),
    })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    process.stdout.emitData(`${JSON.stringify({ type: "nxl.executor_tool_call", call_id: "call_bad", tool: "mission.get", payload: null })}\n`)

    expect(readToolResultLine((await waitForStdinWrite(process))[0] ?? "")).toMatchObject({
      type: "nxl.executor_tool_result",
      call_id: "call_bad",
      tool: "mission.get",
      ok: false,
      error: "payload must be an object",
    })
  })

  test("tool handler rejection returns ok false result and does not crash stream", async () => {
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({
      command: "opencode",
      cwd: "/tmp/demo",
      spawn: () => process,
      toolHandler: async () => {
        throw new Error("handler failed token=handler-secret")
      },
    })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    await readProcessEvents(adapter, 1)
    process.stdout.emitData(`${JSON.stringify({ type: "nxl.executor_tool_call", call_id: "call_reject", tool: "mission.get", payload: {} })}\n`)
    const result = readToolResultLine((await waitForStdinWrite(process))[0] ?? "")
    process.stdout.emitData("after rejection\n")

    expect(result).toMatchObject({ type: "nxl.executor_tool_result", call_id: "call_reject", tool: "mission.get", ok: false })
    expect(JSON.stringify(result)).not.toContain("handler-secret")
    expect(await readProcessEvents(adapter, 1)).toEqual([{ type: "ExecutorLifecycle", phase: "process-stdout", message: "after rejection" }])
    await expect(adapter.getStatus()).resolves.toMatchObject({ phase: "running" })
  })

  test("stdin write failure emits lifecycle error and updates adapter status", async () => {
    const process = new FakeSpawnedProcess(4242, { stdinWriteError: new Error("stdin failed token=stdin-secret") })
    const adapter = new ProcessOpenCodeAdapter({
      command: "opencode",
      cwd: "/tmp/demo",
      spawn: () => process,
      toolHandler: async (call) => ({ call_id: call.call_id, tool: call.tool, ok: true, result: {}, created_at: "2026-05-13T00:00:00.000Z" }),
    })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    await readProcessEvents(adapter, 1)
    process.stdout.emitData(`${JSON.stringify({ type: "nxl.executor_tool_call", call_id: "call_write", tool: "mission.get", payload: {} })}\n`)

    const events = await readProcessEvents(adapter, 1)
    const status = await adapter.getStatus()

    expect(events).toEqual([{ type: "ExecutorLifecycle", phase: "process-tool-result-write-failed", message: "OpenCode tool result write failed: stdin failed [REDACTED]" }])
    expect(status).toMatchObject({ phase: "failed", lastError: "OpenCode tool result write failed: stdin failed [REDACTED]" })
    expect(JSON.stringify({ events, status })).not.toContain("stdin-secret")
  })

  test("tool call without installed handler returns clear failure result", async () => {
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => process })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    process.stdout.emitData(`${JSON.stringify({ type: "nxl.executor_tool_call", call_id: "call_no_handler", tool: "mission.get", payload: {} })}\n`)

    expect(readToolResultLine((await waitForStdinWrite(process))[0] ?? "")).toMatchObject({
      type: "nxl.executor_tool_result",
      call_id: "call_no_handler",
      tool: "mission.get",
      ok: false,
      error: "executor tool handler is not installed",
    })
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

    await expect(adapter.sendMissionPacket(testMissionPacket({ missionId: "m1" }))).rejects.toThrow("real mission packet transport not implemented")
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
    const shutdown = server.shutdown()
    process.emitExit(0, null)
    await shutdown
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

  test("RuntimeServer process event pump keeps stdio open between exit and close", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const process = new FakeSpawnedProcess(4242, { autoClose: false })
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: dir, spawn: () => process })
    const server = new RuntimeServer({ projectDir: dir, adapter })

    await server.start()
    process.emitExit(7, null)
    process.stderr.emitData("trailing stderr token=stdio-secret")
    process.emitClose(7, null)

    const stderr = await waitForRuntimeEvent(
      server,
      (event) => event.type === "ExecutorLifecycle" && event.phase === "process-stderr" && event.message.includes("trailing stderr"),
    )

    expect(stderr.type === "ExecutorLifecycle" ? stderr.message : "").toContain("[REDACTED]")
    expect(JSON.stringify(server.eventBus.snapshot())).not.toContain("stdio-secret")
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
    processes[0]?.emitError(new Error("late superseded error token=old-secret"))
    expect(await adapter.getStatus()).toMatchObject({ phase: "running", pid: 5001 })
    expect(JSON.stringify(server.eventBus.snapshot())).not.toContain("old-secret")

    const shutdown = server.shutdown()
    processes[1]?.emitExit(0, null)
    await shutdown
  })

  test("RuntimeServer keeps process event pump open after failed replacement spawn", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const firstProcess = new FakeSpawnedProcess(6200)
    const failedReplacement = new FakeSpawnedProcess(6201, { spawned: false })
    const adapter = new ProcessOpenCodeAdapter({
      command: "opencode",
      cwd: dir,
      spawn: () => (firstProcess.stdinEnded ? failedReplacement : firstProcess),
    })
    const server = new RuntimeServer({ projectDir: dir, adapter })

    await server.start()
    const replacement = server.startNewSession()
    failedReplacement.emitError(new Error("ENOENT token=replacement-secret"))
    await expect(replacement).rejects.toThrow("OpenCode process spawn failed: ENOENT [REDACTED]")

    firstProcess.stdout.emitData("preserved child output token=preserved-secret")
    firstProcess.emitExit(0, null)

    const stdout = await waitForRuntimeEvent(
      server,
      (event) => event.type === "ExecutorLifecycle" && event.phase === "process-stdout" && event.message.includes("preserved child output"),
    )
    const exit = await waitForRuntimeEvent(
      server,
      (event) => event.type === "ExecutorLifecycle" && event.phase === "process-exited" && event.message.includes("with code 0"),
    )

    expect(stdout.type === "ExecutorLifecycle" ? stdout.message : "").toContain("[REDACTED]")
    expect(JSON.stringify(server.eventBus.snapshot())).not.toContain("preserved-secret")
    expect(exit).toMatchObject({ type: "ExecutorLifecycle", phase: "process-exited" })
    await server.shutdown()
  })

  test("RuntimeServer keeps process event pump open until all shutdown children exit", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const processes: FakeSpawnedProcess[] = []
    const adapter = new ProcessOpenCodeAdapter({
      command: "opencode",
      cwd: dir,
      spawn: () => {
        const process = new FakeSpawnedProcess(6300 + processes.length)
        processes.push(process)
        return process
      },
    })
    const server = new RuntimeServer({ projectDir: dir, adapter })

    await server.start()
    await server.startNewSession()
    const shutdown = server.shutdown()
    processes[1]?.emitExit(0, null)
    processes[0]?.stdout.emitData("terminating child output token=old-child-secret")

    const stdout = await waitForRuntimeEvent(
      server,
      (event) => event.type === "ExecutorLifecycle" && event.phase === "process-stdout" && event.message.includes("terminating child output"),
    )

    processes[0]?.emitExit(0, null)
    await expect(shutdown).resolves.toBeUndefined()
    expect(stdout.type === "ExecutorLifecycle" ? stdout.message : "").toContain("[REDACTED]")
    expect(JSON.stringify(server.eventBus.snapshot())).not.toContain("old-child-secret")
  })

  test("failed replacement spawn preserves prior child handle for shutdown", async () => {
    const firstProcess = new FakeSpawnedProcess(6100)
    const failedReplacement = new FakeSpawnedProcess(6101, { spawned: false })
    const adapter = new ProcessOpenCodeAdapter({
      command: "opencode",
      cwd: "/tmp/demo",
      spawn: () => (firstProcess.stdinEnded ? failedReplacement : firstProcess),
    })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "first" })
    const replacement = adapter.startSession({ projectDir: "/tmp/demo", objective: "second" })
    failedReplacement.emitError(new Error("ENOENT token=replacement-secret"))

    await expect(replacement).rejects.toThrow("OpenCode process spawn failed: ENOENT [REDACTED]")
    await expect(adapter.getStatus()).resolves.toMatchObject({ phase: "failed", pid: 6100, terminatingPids: [6100] })

    const shutdown = adapter.shutdown()
    firstProcess.emitExit(0, null)
    await expect(shutdown).resolves.toBeUndefined()
    expect(JSON.stringify(await adapter.getStatus())).not.toContain("replacement-secret")
  })
})
