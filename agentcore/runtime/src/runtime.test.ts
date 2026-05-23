import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { RuntimeServer } from "./server"
import type { RuntimeResearchDbProjection } from "./server"
import { createRuntimeServerFromLaunchConfig, readRuntimeServerLaunchOptionsFromEnv } from "./launch-config"
import { RuntimeServerClient } from "./tui/runtime-server-client"
import { EventStore } from "./events/event-store"
import { RuntimeEventBus } from "./events/event-bus"
import type { RuntimeEvent } from "./events/event-types"
import { MissionRegistry } from "./missions/mission-registry"
import { ReviewRegistry } from "./missions/review-registry"
import { ProposalRegistry } from "./missions/proposal-registry"
import { ProposalBundleRegistry } from "./missions/proposal-bundle-registry"
import { CommanderPlaybookDraftRegistry } from "./missions/commander-playbook-draft-registry"
import { CommanderQueueService } from "./missions/commander-queue-service"
import { MissionToolRouter } from "./missions/mission-tool-router"
import { MISSION_TOOL_NAMES } from "./missions/mission-tool-types"
import { ExternalApiConnectorRegistry, readExternalApiConnectorsFromEnv } from "./external-api/api-connector-registry"
import { FakeExternalApiTransport, FetchExternalApiTransport } from "./external-api/api-transport"
import { SpecService } from "./spec/spec-service"
import { FakeOpenCodeAdapter } from "./opencode/fake-adapter"
import { ProcessOpenCodeAdapter, type OpenCodeSpawnedProcess, type OpenCodeProcessEventSource } from "./opencode/process-adapter"
import { createOpenCodeAdapter, readOpenCodeAdapterConfigFromEnv, redactOpenCodeAdapterConfig, validateOpenCodeAdapterConfig } from "./opencode/adapter-config"
import { buildOpenCodeSessionContract } from "./opencode/session-contract"
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
  stdinAsyncWriteError: Error | null
  stdinErrorAfterAck: Error | null
  neverAckStdinWrite: boolean
  stdinWritable: boolean
  stdinDestroyed: boolean
  onStdinWriteBeforeAck: (() => void) | null = null
  private spawned = false
  private readonly autoClose: boolean
  private readonly spawnListeners: Array<() => void> = []
  private readonly closeListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = []
  private readonly exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = []
  private readonly errorListeners: Array<(error: Error) => void> = []
  private readonly stdinErrorListeners: Array<(error: Error) => void> = []
  stdin: OpenCodeSpawnedProcess["stdin"]

  constructor(readonly pid = 4242, options: { autoClose?: boolean; spawned?: boolean; stdinWriteError?: Error; stdinAsyncWriteError?: Error; stdinErrorAfterAck?: Error; neverAckStdinWrite?: boolean; stdinWritable?: boolean; stdinDestroyed?: boolean; missingStdin?: boolean } = {}) {
    this.spawned = options.spawned ?? true
    this.autoClose = options.autoClose ?? true
    this.stdinWriteError = options.stdinWriteError ?? null
    this.stdinAsyncWriteError = options.stdinAsyncWriteError ?? null
    this.stdinErrorAfterAck = options.stdinErrorAfterAck ?? null
    this.neverAckStdinWrite = options.neverAckStdinWrite ?? false
    this.stdinWritable = options.stdinWritable ?? true
    this.stdinDestroyed = options.stdinDestroyed ?? false
    const owner = this
    this.stdin = options.missingStdin ? undefined : {
      write: (data: string, callback?: (error?: Error | null) => void) => {
        if (owner.stdinWriteError) throw owner.stdinWriteError
        owner.stdinWrites.push(data)
        owner.onStdinWriteBeforeAck?.()
        if (!owner.neverAckStdinWrite) {
          queueMicrotask(() => {
            callback?.(owner.stdinAsyncWriteError)
            if (!owner.stdinAsyncWriteError && owner.stdinErrorAfterAck) queueMicrotask(() => owner.emitStdinError(owner.stdinErrorAfterAck!))
          })
        }
        return true
      },
      end: () => {
        owner.stdinEnded = true
      },
      on: (_event: "error", listener: (error: Error) => void) => {
        owner.stdinErrorListeners.push(listener)
      },
      off: (_event: "error", listener: (error: Error) => void) => {
        const index = owner.stdinErrorListeners.indexOf(listener)
        if (index >= 0) owner.stdinErrorListeners.splice(index, 1)
      },
      get writable() {
        return owner.stdinWritable
      },
      get destroyed() {
        return owner.stdinDestroyed
      },
    }
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

  emitStdinError(error: Error): void {
    for (const listener of [...this.stdinErrorListeners]) listener(error)
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
    await expect(server.command("runtime.list_mission_claims", { missionId: submitted.missionId })).resolves.toMatchObject([
      { claim_id: claimId, status: "active" },
    ])
    await expect(server.command("runtime.list_mission_progress", { missionId: submitted.missionId })).resolves.toMatchObject([
      { progress_id: (progress as { progress_id: string }).progress_id, message: "working [REDACTED]" },
    ])

    const result = await server.command("runtime.submit_mission_result", {
      missionId: submitted.missionId,
      claimId,
      summary: "summary secret=result-secret",
      artifacts: ["artifact_1"],
      researchResultIds: ["research_1"],
    })
    expect(result).toMatchObject({ result_id: expect.any(String), summary: "summary [REDACTED]", artifacts: ["artifact_1"], research_result_ids: ["research_1"] })
    await expect(server.command("runtime.list_mission_results", { missionId: submitted.missionId })).resolves.toMatchObject([
      { result_id: (result as { result_id: string }).result_id, summary: "summary [REDACTED]" },
    ])

    await expect(server.command("runtime.complete_mission", { missionId: submitted.missionId })).resolves.toMatchObject({ status: "completed" })
    const releaseSubmitted = await server.submitUserMessage("release claim mission")
    const releaseClaim = await server.command("runtime.claim_mission", { missionId: releaseSubmitted.missionId, executorId: "release_executor" })
    await expect(server.command("runtime.release_mission_claim", {
      claimId: (releaseClaim as { claim_id: string }).claim_id,
      reason: "release secret=release-secret",
    })).resolves.toMatchObject({ status: "released", release_reason: "release [REDACTED]" })
    const serialized = JSON.stringify({ status: await server.status(), events: await readJsonlEvents(dir) })
    expect(serialized).not.toContain("executor-secret")
    expect(serialized).not.toContain("progress-secret")
    expect(serialized).not.toContain("result-secret")
    expect(serialized).not.toContain("release-secret")
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

  test("review runtime commands create list decide and hydrate durable redacted records", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    let nextReview = 0
    let nextMs = 0
    const server = new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter() })
    const reviewRegistry = new ReviewRegistry({
      eventStore: server.eventStore,
      missionRegistry: server.missionRegistry,
      idFactory: () => `review_${++nextReview}`,
      now: () => new Date(Date.UTC(2026, 4, 10, 12, 0, 0, nextMs++)),
    })
    const reviewServer = new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter(), reviewRegistry })

    await reviewServer.start()
    const submitted = await reviewServer.submitUserMessage("review mission")
    const review = await reviewServer.command("runtime.create_review_request", {
      missionId: submitted.missionId,
      requestType: "mission_completion",
      title: "approve token=review-title-secret",
      summary: "summary api_key=review-summary-secret",
      requestedBy: "operator password=review-requester-secret",
    })

    expect(review).toMatchObject({
      review_id: "review_1",
      mission_id: submitted.missionId,
      request_type: "mission_completion",
      title: "approve [REDACTED]",
      summary: "summary [REDACTED]",
      requested_by: "operator [REDACTED]",
      status: "pending",
    })
    await expect(reviewServer.command("runtime.get_review_request", { reviewId: "review_1" })).resolves.toMatchObject({ review_id: "review_1", status: "pending" })
    await expect(reviewServer.command("runtime.list_review_requests", { status: "pending" })).resolves.toMatchObject([{ review_id: "review_1" }])
    await expect(reviewServer.command("runtime.review_status")).resolves.toMatchObject({ pending_count: 1, approved_count: 0, last_review_id: "review_1" })

    await expect(reviewServer.command("runtime.approve_review_request", {
      reviewId: "review_1",
      decidedBy: "operator token=review-decider-secret",
      reason: "ok secret=review-reason-secret",
    })).resolves.toMatchObject({
      review_id: "review_1",
      status: "approved",
      decision_by: "operator [REDACTED]",
      decision_reason: "ok [REDACTED]",
    })
    await expect(reviewServer.command("runtime.review_status")).resolves.toMatchObject({ pending_count: 0, approved_count: 1 })

    const rejected = await reviewServer.command("runtime.create_review_request", {
      title: "reject",
      summary: "summary",
      requestedBy: "operator",
    }) as { review_id: string }
    await expect(reviewServer.command("runtime.reject_review_request", {
      reviewId: rejected.review_id,
      decidedBy: "operator",
      reason: "no",
    })).resolves.toMatchObject({ review_id: rejected.review_id, status: "rejected", decision_reason: "no" })

    const cancelled = await reviewServer.command("runtime.create_review_request", {
      title: "cancel",
      summary: "summary",
      requestedBy: "operator",
    }) as { review_id: string }
    await expect(reviewServer.command("runtime.cancel_review_request", {
      reviewId: cancelled.review_id,
      decidedBy: "operator",
    })).resolves.toMatchObject({ review_id: cancelled.review_id, status: "cancelled" })

    const rebuilt = new ReviewRegistry({ eventStore: reviewServer.eventStore, missionRegistry: reviewServer.missionRegistry })
    await expect(rebuilt.getReviewRequest("review_1")).resolves.toMatchObject({ status: "approved", decision_reason: "ok [REDACTED]" })
    expect((await readJsonlEvents(dir)).map((event) => event.kind)).toContain("review_request_created")
    expect((await readJsonlEvents(dir)).map((event) => event.kind)).toContain("review_request_approved")
    const serialized = JSON.stringify({ status: await reviewServer.status(), events: await readJsonlEvents(dir) })
    expect(serialized).not.toContain("review-title-secret")
    expect(serialized).not.toContain("review-summary-secret")
    expect(serialized).not.toContain("review-requester-secret")
    expect(serialized).not.toContain("review-decider-secret")
    expect(serialized).not.toContain("review-reason-secret")
    await reviewServer.shutdown()
  })

  test("review runtime commands enforce write gates and allow read surfaces", async () => {
    const notStartedDir = await tempProject()
    await makeProject(notStartedDir, { approvedSpec: true })
    const notStarted = new RuntimeServer({ projectDir: notStartedDir, adapter: new LongLivedAdapter() })

    await expect(notStarted.command("runtime.create_review_request", {
      title: "title",
      summary: "summary",
      requestedBy: "operator",
    })).rejects.toThrow("runtime must be started before review writes")
    await expect(notStarted.command("runtime.review_status")).resolves.toMatchObject({ pending_count: 0 })

    const statusDir = await tempProject()
    await makeProject(statusDir)
    const statusServer = new RuntimeServer({ projectDir: statusDir, mode: "status", adapter: new LongLivedAdapter() })
    await statusServer.start()

    await expect(statusServer.command("runtime.create_review_request", {
      title: "title",
      summary: "summary",
      requestedBy: "operator",
    })).rejects.toThrow("runtime.create_review_request requires active mode")
    await expect(statusServer.command("runtime.list_review_requests")).resolves.toEqual([])
    await statusServer.shutdown()
  })

  test("proposal runtime commands create review approve and apply through mission authority", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter(), researchProjectionMode: "disabled" })

    await server.start()
    const submitted = await server.submitUserMessage("proposal runtime mission")
    const claim = await server.command("runtime.claim_mission", { missionId: submitted.missionId, executorId: "executor" }) as { claim_id: string }
    const proposal = await server.command("runtime.create_commander_proposal", {
      missionId: submitted.missionId,
      claimId: claim.claim_id,
      actionKind: "record_progress",
      title: "record token=proposal-title-secret",
      summary: "summary token=proposal-summary-secret",
      proposedBy: "commander",
      actionPayload: {
        mission_id: submitted.missionId,
        claim_id: claim.claim_id,
        message: "progress token=proposal-payload-secret",
      },
    }) as { proposal_id: string }

    await expect(server.command("runtime.get_commander_proposal", { proposalId: proposal.proposal_id })).resolves.toMatchObject({
      proposal_id: proposal.proposal_id,
      status: "proposed",
      title: "record [REDACTED]",
    })
    const reviewed = await server.command("runtime.request_proposal_review", {
      proposalId: proposal.proposal_id,
      title: "review",
      summary: "approve",
      requestedBy: "operator",
    }) as { review_id: string }
    await expect(server.command("runtime.apply_commander_proposal", { proposalId: proposal.proposal_id })).rejects.toThrow("approved linked review")
    await server.command("runtime.approve_review_request", { reviewId: reviewed.review_id, decidedBy: "operator", reason: "ok" })
    await expect(server.command("runtime.get_commander_proposal", { proposalId: proposal.proposal_id })).resolves.toMatchObject({
      proposal_id: proposal.proposal_id,
      status: "approved",
    })
    await expect(server.command("runtime.proposal_status")).resolves.toMatchObject({ approved_count: 1, applied_count: 0 })
    await expect(server.command("runtime.apply_commander_proposal", { proposalId: proposal.proposal_id })).resolves.toMatchObject({
      proposal_id: proposal.proposal_id,
      status: "applied",
      application_result: expect.stringContaining("mission_progress_recorded"),
    })
    await expect(server.command("runtime.list_mission_progress", { missionId: submitted.missionId })).resolves.toMatchObject([
      { claim_id: claim.claim_id, message: "progress [REDACTED]" },
    ])
    await expect(server.command("runtime.proposal_status")).resolves.toMatchObject({ applied_count: 1, last_proposal_id: proposal.proposal_id })
    const serialized = JSON.stringify({ status: await server.status(), events: await readJsonlEvents(dir) })
    expect(serialized).not.toContain("proposal-title-secret")
    expect(serialized).not.toContain("proposal-summary-secret")
    expect(serialized).not.toContain("proposal-payload-secret")
    await server.shutdown()
  })

  test("proposal runtime review rejection synchronizes linked proposal state", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter(), researchProjectionMode: "disabled" })

    await server.start()
    const submitted = await server.submitUserMessage("proposal rejection mission")
    const claim = await server.command("runtime.claim_mission", { missionId: submitted.missionId, executorId: "executor" }) as { claim_id: string }
    const proposal = await server.command("runtime.create_commander_proposal", {
      missionId: submitted.missionId,
      claimId: claim.claim_id,
      actionKind: "record_progress",
      title: "record",
      summary: "summary",
      proposedBy: "commander",
      actionPayload: { message: "progress" },
    }) as { proposal_id: string }
    const reviewed = await server.command("runtime.request_proposal_review", {
      proposalId: proposal.proposal_id,
      requestedBy: "operator",
    }) as { review_id: string }

    await server.command("runtime.reject_review_request", { reviewId: reviewed.review_id, decidedBy: "operator", reason: "no" })

    await expect(server.command("runtime.get_commander_proposal", { proposalId: proposal.proposal_id })).resolves.toMatchObject({
      proposal_id: proposal.proposal_id,
      status: "rejected",
      failure_reason: "no",
    })
    await expect(server.command("runtime.proposal_status")).resolves.toMatchObject({ rejected_count: 1, review_requested_count: 0 })
    await expect(server.command("runtime.apply_commander_proposal", { proposalId: proposal.proposal_id })).rejects.toThrow("terminal proposal cannot apply")
    await server.shutdown()
  })

  test("proposal runtime commands enforce write gates and allow read surfaces", async () => {
    const notStartedDir = await tempProject()
    await makeProject(notStartedDir, { approvedSpec: true })
    const notStarted = new RuntimeServer({ projectDir: notStartedDir, adapter: new LongLivedAdapter(), researchProjectionMode: "disabled" })

    await expect(notStarted.command("runtime.create_commander_proposal", {
      actionKind: "other",
      title: "title",
      summary: "summary",
      proposedBy: "operator",
    })).rejects.toThrow("runtime must be started before proposal writes")
    await expect(notStarted.command("runtime.proposal_status")).resolves.toMatchObject({ proposed_count: 0 })

    const statusDir = await tempProject()
    await makeProject(statusDir)
    const statusServer = new RuntimeServer({ projectDir: statusDir, mode: "status", adapter: new LongLivedAdapter(), researchProjectionMode: "disabled" })
    await statusServer.start()

    await expect(statusServer.command("runtime.create_commander_proposal", {
      actionKind: "other",
      title: "title",
      summary: "summary",
      proposedBy: "operator",
    })).rejects.toThrow("runtime.create_commander_proposal requires active mode")
    await expect(statusServer.command("runtime.list_commander_proposals")).resolves.toEqual([])
    await statusServer.shutdown()
  })

  test("proposal bundle runtime commands persist ordered redacted bundles and hydrate readiness", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const bundleServer = new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter(), researchProjectionMode: "disabled" })

    await bundleServer.start()
    const submitted = await bundleServer.submitUserMessage("bundle mission")
    const claim = await bundleServer.command("runtime.claim_mission", { missionId: submitted.missionId, executorId: "executor" }) as { claim_id: string }
    const first = await bundleServer.command("runtime.create_commander_proposal", {
      missionId: submitted.missionId,
      claimId: claim.claim_id,
      actionKind: "record_progress",
      title: "first",
      summary: "summary",
      proposedBy: "commander",
      actionPayload: { mission_id: submitted.missionId, claim_id: claim.claim_id, message: "first progress" },
    }) as { proposal_id: string }
    const second = await bundleServer.command("runtime.create_commander_proposal", {
      missionId: submitted.missionId,
      claimId: claim.claim_id,
      actionKind: "record_progress",
      title: "second",
      summary: "summary",
      proposedBy: "commander",
      actionPayload: { mission_id: submitted.missionId, claim_id: claim.claim_id, message: "second progress" },
    }) as { proposal_id: string }
    const bundle = await bundleServer.command("runtime.create_proposal_bundle", {
      title: "bundle token=bundle-title-secret",
      summary: "summary token=bundle-summary-secret",
      createdBy: "operator token=bundle-owner-secret",
    }) as { bundle_id: string }

    const bundleId = String((bundle as Record<string, unknown>).bundle_id ?? "")
    expect(bundleId).toBeTruthy()
    expect(bundle).toMatchObject({ status: "open", title: "bundle [REDACTED]", proposal_ids: [] })
    await bundleServer.command("runtime.add_proposal_to_bundle", { bundleId, proposalId: first.proposal_id })
    await bundleServer.command("runtime.add_proposal_to_bundle", { bundleId, proposalId: first.proposal_id })
    await expect(bundleServer.command("runtime.add_proposal_to_bundle", { bundleId, proposalId: second.proposal_id })).resolves.toMatchObject({
      bundle_id: bundleId,
      proposal_ids: [first.proposal_id, second.proposal_id],
    })
    await expect(bundleServer.command("runtime.add_proposal_to_bundle", { bundleId, proposalId: "missing-proposal" })).rejects.toThrow("commander proposal not found")
    await expect(bundleServer.command("runtime.proposal_bundle_readiness", { bundleId })).resolves.toMatchObject({
      proposal_count: 2,
      proposed_count: 2,
      ready_to_apply: false,
      blocked_count: 2,
    })
    await expect(bundleServer.command("runtime.request_proposal_bundle_reviews", { bundleId, requestedBy: "operator" })).resolves.toMatchObject({
      bundle_id: bundleId,
      status: "review_requested",
    })
    await expect(bundleServer.command("runtime.request_proposal_bundle_reviews", { bundleId, requestedBy: "operator" })).resolves.toMatchObject({
      bundle_id: bundleId,
      status: "review_requested",
    })
    await expect(bundleServer.command("runtime.apply_proposal_bundle", { bundleId })).rejects.toThrow("not ready to apply")
    const reviews = await bundleServer.command("runtime.list_review_requests", { limit: 10 }) as Array<{ review_id: string }>
    expect(reviews).toHaveLength(2)
    for (const review of reviews) await bundleServer.command("runtime.approve_review_request", { reviewId: review.review_id, decidedBy: "operator", reason: "ok" })
    await expect(bundleServer.command("runtime.proposal_bundle_readiness", { bundleId })).resolves.toMatchObject({
      approved_count: 2,
      ready_to_apply: true,
      blocked_count: 0,
    })
    await expect(bundleServer.command("runtime.apply_proposal_bundle", { bundleId })).resolves.toMatchObject({
      bundle_id: bundleId,
      status: "applied",
      proposal_ids: [first.proposal_id, second.proposal_id],
    })
    await expect(bundleServer.command("runtime.add_proposal_to_bundle", { bundleId, proposalId: first.proposal_id })).rejects.toThrow("terminal proposal bundle")
    await expect(bundleServer.command("runtime.list_mission_progress", { missionId: submitted.missionId })).resolves.toMatchObject([
      { message: "first progress" },
      { message: "second progress" },
    ])

    const rebuilt = new ProposalBundleRegistry({ eventStore: bundleServer.eventStore, proposalRegistry: bundleServer.proposalRegistry })
    await expect(rebuilt.getBundle(bundleId)).resolves.toMatchObject({ status: "applied", proposal_ids: [first.proposal_id, second.proposal_id] })
    expect(await readEventKinds(dir)).toEqual(expect.arrayContaining([
      "commander_proposal_bundle_created",
      "commander_proposal_bundle_proposal_added",
      "commander_proposal_bundle_review_requested",
      "commander_proposal_bundle_applied",
    ]))
    const serialized = JSON.stringify({ status: await bundleServer.status(), events: await readJsonlEvents(dir) })
    expect(serialized).not.toContain("bundle-title-secret")
    expect(serialized).not.toContain("bundle-summary-secret")
    expect(serialized).not.toContain("bundle-owner-secret")
    await bundleServer.shutdown()
  })

  test("commander playbook runtime commands list get draft proposals bundles and reviews without applying", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter(), researchProjectionMode: "disabled" })

    await expect(server.command("runtime.list_commander_playbooks")).resolves.toMatchObject([
      { playbook_id: "complete-from-result", generated_action_kinds: ["complete_mission"], creates_bundle: false },
      { playbook_id: "submit-result-and-complete", generated_action_kinds: ["submit_result", "complete_mission"], creates_bundle: true },
      { playbook_id: "record-progress", generated_action_kinds: ["record_progress"] },
      { playbook_id: "fail-mission", generated_action_kinds: ["fail_mission"] },
      { playbook_id: "cancel-mission", generated_action_kinds: ["cancel_mission"] },
      { playbook_id: "release-claim", generated_action_kinds: ["release_claim"] },
    ])
    await expect(server.command("runtime.get_commander_playbook", { playbookId: "fail-mission" })).resolves.toMatchObject({ playbook_id: "fail-mission" })
    await expect(server.command("runtime.get_commander_playbook", { playbookId: "missing-playbook" })).rejects.toThrow("unknown commander playbook")
    await expect(server.command("runtime.draft_commander_playbook", {
      playbookId: "missing-playbook",
      proposedBy: "operator",
      fields: {},
    })).rejects.toThrow("runtime must be started before commander playbook writes")

    await server.start()
    const submitted = await server.submitUserMessage("playbook mission")
    const claim = await server.command("runtime.claim_mission", { missionId: submitted.missionId, executorId: "executor" }) as { claim_id: string }
    const result = await server.command("runtime.submit_mission_result", { missionId: submitted.missionId, claimId: claim.claim_id, summary: "result" }) as { result_id: string }

    await expect(server.command("runtime.draft_commander_playbook", {
      playbookId: "missing-playbook",
      proposedBy: "operator",
      fields: {},
    })).rejects.toThrow("unknown commander playbook")
    await expect(server.command("runtime.draft_commander_playbook", {
      playbookId: "complete-from-result",
      proposedBy: "operator",
      fields: { mission_id: submitted.missionId, result_id: result.result_id, title: "Complete" },
    })).rejects.toThrow("summary is required")

    const completeDraft = await server.command("runtime.draft_commander_playbook", {
      playbookId: "complete-from-result",
      proposedBy: "operator token=playbook-operator-secret",
      fields: {
        mission_id: submitted.missionId,
        result_id: result.result_id,
        title: "Complete token=playbook-title-secret",
        summary: "Done token=playbook-summary-secret",
      },
    }) as { draft_id: string; proposal_ids: string[]; bundle_id?: string; review_ids?: string[] }
    expect(completeDraft.draft_id).toBeTruthy()
    expect(completeDraft.proposal_ids).toHaveLength(1)
    expect(completeDraft.bundle_id).toBeUndefined()
    expect(completeDraft.review_ids).toBeUndefined()
    await expect(server.command("runtime.get_commander_proposal", { proposalId: completeDraft.proposal_ids[0] })).resolves.toMatchObject({
      action_kind: "complete_mission",
      status: "proposed",
      mission_id: submitted.missionId,
      result_id: result.result_id,
    })

    const bundledDraft = await server.command("runtime.draft_commander_playbook", {
      playbookId: "submit-result-and-complete",
      proposedBy: "operator",
      requestedBy: "operator",
      requestReviews: true,
      fields: {
        mission_id: submitted.missionId,
        claim_id: claim.claim_id,
        title: "Submit and complete",
        result_summary: "fresh result",
        completion_summary: "complete after result",
      },
    }) as { draft_id: string; proposal_ids: string[]; bundle_id?: string; review_ids?: string[] }
    expect(bundledDraft.draft_id).toBeTruthy()
    expect(bundledDraft.proposal_ids).toHaveLength(2)
    expect(bundledDraft.bundle_id).toBeTruthy()
    expect(bundledDraft.review_ids).toHaveLength(2)
    await expect(server.command("runtime.list_commander_proposals", { limit: 2 })).resolves.toMatchObject([
      { proposal_id: bundledDraft.proposal_ids[1], action_kind: "complete_mission", status: "review_requested" },
      { proposal_id: bundledDraft.proposal_ids[0], action_kind: "submit_result", status: "review_requested" },
    ])
    await expect(server.command("runtime.get_proposal_bundle", { bundleId: bundledDraft.bundle_id })).resolves.toMatchObject({
      proposal_ids: bundledDraft.proposal_ids,
      status: "review_requested",
    })

    for (const [playbookId, actionKind, fields] of [
      ["fail-mission", "fail_mission", { mission_id: submitted.missionId, reason: "bad", title: "Fail" }],
      ["cancel-mission", "cancel_mission", { mission_id: submitted.missionId, reason: "stop", title: "Cancel" }],
      ["release-claim", "release_claim", { claim_id: claim.claim_id, reason: "done", title: "Release" }],
      ["record-progress", "record_progress", { mission_id: submitted.missionId, claim_id: claim.claim_id, message: "progress", title: "Progress" }],
    ] as const) {
      const draft = await server.command("runtime.draft_commander_playbook", { playbookId, proposedBy: "operator", fields }) as { draft_id: string; proposal_ids: string[]; review_ids?: string[] }
      expect(draft.draft_id).toBeTruthy()
      expect(draft.review_ids).toBeUndefined()
      await expect(server.command("runtime.get_commander_proposal", { proposalId: draft.proposal_ids[0] })).resolves.toMatchObject({ action_kind: actionKind, status: "proposed" })
    }

    await expect(server.command("runtime.get_mission", { missionId: submitted.missionId })).resolves.toMatchObject({ status: "running" })
    const serialized = JSON.stringify({ status: await server.status(), events: await readJsonlEvents(dir) })
    expect(serialized).not.toContain("playbook-operator-secret")
    expect(serialized).not.toContain("playbook-title-secret")
    expect(serialized).not.toContain("playbook-summary-secret")
    await server.shutdown()
  })

  test("commander playbook draft enforces active started runtime gates while read commands stay available", async () => {
    const notStartedDir = await tempProject()
    await makeProject(notStartedDir, { approvedSpec: true })
    const notStarted = new RuntimeServer({ projectDir: notStartedDir, adapter: new LongLivedAdapter(), researchProjectionMode: "disabled" })
    await expect(notStarted.command("runtime.list_commander_playbooks")).resolves.toHaveLength(6)
    await expect(notStarted.command("runtime.draft_commander_playbook", {
      playbookId: "fail-mission",
      proposedBy: "operator",
      fields: { mission_id: "mission-1", reason: "reason", title: "title" },
    })).rejects.toThrow("runtime must be started before commander playbook writes")

    const statusDir = await tempProject()
    await makeProject(statusDir, { approvedSpec: true })
    const statusServer = new RuntimeServer({ projectDir: statusDir, mode: "status", adapter: new LongLivedAdapter(), researchProjectionMode: "disabled" })
    await statusServer.start()
    await expect(statusServer.command("runtime.get_commander_playbook", { playbookId: "cancel-mission" })).resolves.toMatchObject({ playbook_id: "cancel-mission" })
    await expect(statusServer.command("runtime.draft_commander_playbook", {
      playbookId: "fail-mission",
      proposedBy: "operator",
      fields: { mission_id: "mission-1", reason: "reason", title: "title" },
    })).rejects.toThrow("runtime.draft_commander_playbook requires active mode")
    await statusServer.shutdown()
  })

  test("commander playbook draft history lists readiness review requests cancellation and redaction", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter(), researchProjectionMode: "disabled" })
    await expect(server.command("runtime.list_commander_playbook_drafts")).resolves.toEqual([])
    await expect(server.command("runtime.commander_playbook_draft_status")).resolves.toMatchObject({ drafted_count: 0 })
    await expect(server.command("runtime.request_commander_playbook_draft_reviews", { draftId: "missing", requestedBy: "operator" })).rejects.toThrow("runtime must be started before commander playbook writes")

    await server.start()
    const submitted = await server.submitUserMessage("workbench mission")
    const claim = await server.command("runtime.claim_mission", { missionId: submitted.missionId, executorId: "executor" }) as { claim_id: string }
    const result = await server.command("runtime.submit_mission_result", { missionId: submitted.missionId, claimId: claim.claim_id, summary: "result" }) as { result_id: string }

    await expect(server.command("runtime.draft_commander_playbook", {
      playbookId: "complete-from-result",
      proposedBy: "operator",
      fields: { mission_id: submitted.missionId, result_id: "missing-result", title: "bad", summary: "bad" },
    })).rejects.toThrow("mission result does not belong to mission")
    await expect(server.command("runtime.list_commander_playbook_drafts")).resolves.toHaveLength(0)

    const completeDraft = await server.command("runtime.draft_commander_playbook", {
      playbookId: "complete-from-result",
      proposedBy: "operator token=history-operator-secret",
      fields: {
        mission_id: submitted.missionId,
        result_id: result.result_id,
        title: "Complete token=history-title-secret",
        summary: "Done token=history-summary-secret",
      },
    }) as { draft_id: string; proposal_ids: string[] }
    await expect(server.command("runtime.get_commander_playbook_draft", { draftId: completeDraft.draft_id })).resolves.toMatchObject({
      draft_id: completeDraft.draft_id,
      status: "drafted",
      proposal_ids: completeDraft.proposal_ids,
    })
    await expect(server.command("runtime.commander_playbook_draft_readiness", { draftId: completeDraft.draft_id })).resolves.toMatchObject({
      draft_id: completeDraft.draft_id,
      proposal_count: 1,
      review_count: 0,
      missing_review_count: 1,
      ready_to_apply: false,
    })

    const reviewed = await server.command("runtime.request_commander_playbook_draft_reviews", { draftId: completeDraft.draft_id, requestedBy: "operator" }) as { review_ids?: string[] }
    expect(reviewed.review_ids).toHaveLength(1)
    await expect(server.command("runtime.request_commander_playbook_draft_reviews", { draftId: completeDraft.draft_id, requestedBy: "operator" })).resolves.toMatchObject({
      review_ids: reviewed.review_ids,
    })
    await server.command("runtime.approve_review_request", { reviewId: reviewed.review_ids?.[0], decidedBy: "operator", reason: "ok" })
    await expect(server.command("runtime.commander_playbook_draft_readiness", { draftId: completeDraft.draft_id })).resolves.toMatchObject({
      review_count: 1,
      approved_review_count: 1,
      ready_to_apply: true,
    })

    const bundledDraft = await server.command("runtime.draft_commander_playbook", {
      playbookId: "submit-result-and-complete",
      proposedBy: "operator",
      fields: {
        mission_id: submitted.missionId,
        claim_id: claim.claim_id,
        title: "Submit and complete",
        result_summary: "fresh result",
        completion_summary: "complete after result",
      },
    }) as { draft_id: string; proposal_ids: string[]; bundle_id?: string; review_ids?: string[] }
    expect(bundledDraft.bundle_id).toBeTruthy()
    expect(bundledDraft.review_ids).toBeUndefined()
    const bundledReviewed = await server.command("runtime.request_commander_playbook_draft_reviews", { draftId: bundledDraft.draft_id, requestedBy: "operator" }) as { review_ids?: string[] }
    expect(bundledReviewed.review_ids).toHaveLength(2)
    await expect(server.command("runtime.get_proposal_bundle", { bundleId: bundledDraft.bundle_id })).resolves.toMatchObject({ status: "review_requested" })

    const cancelled = await server.command("runtime.cancel_commander_playbook_draft", { draftId: bundledDraft.draft_id, reason: "reason token=history-cancel-secret" }) as { status: string; cancellation_reason?: string }
    expect(cancelled.status).toBe("cancelled")
    await expect(server.command("runtime.cancel_commander_playbook_draft", { draftId: bundledDraft.draft_id, reason: "reason token=history-cancel-secret" })).resolves.toMatchObject({ status: "cancelled" })
    await expect(server.command("runtime.cancel_commander_playbook_draft", { draftId: bundledDraft.draft_id, reason: "different" })).rejects.toThrow("terminal playbook draft cancellation conflicts")
    await expect(server.command("runtime.get_proposal_bundle", { bundleId: bundledDraft.bundle_id })).resolves.not.toMatchObject({ status: "cancelled" })
    await expect(server.command("runtime.commander_playbook_draft_status")).resolves.toMatchObject({
      review_requested_count: 1,
      cancelled_count: 1,
      last_draft_id: bundledDraft.draft_id,
    })
    const rebuilt = new CommanderPlaybookDraftRegistry({
      eventStore: server.eventStore,
      proposalRegistry: server.proposalRegistry,
      proposalBundleRegistry: server.proposalBundleRegistry,
      reviewRegistry: server.reviewRegistry,
    })
    await expect(rebuilt.getDraft(completeDraft.draft_id)).resolves.toMatchObject({ draft_id: completeDraft.draft_id, proposal_ids: completeDraft.proposal_ids })

    const serialized = JSON.stringify({ status: await server.status(), events: await readJsonlEvents(dir) })
    expect(serialized).not.toContain("history-operator-secret")
    expect(serialized).not.toContain("history-title-secret")
    expect(serialized).not.toContain("history-summary-secret")
    expect(serialized).not.toContain("history-cancel-secret")
    expect(await readEventKinds(dir)).toEqual(expect.arrayContaining([
      "commander_playbook_draft_created",
      "commander_playbook_draft_reviews_requested",
      "commander_playbook_draft_cancelled",
    ]))
    await server.shutdown()
  })

  test("commander apply workbench previews and applies proposals bundles and drafts through existing authority", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter(), researchProjectionMode: "disabled" })
    await expect(server.command("runtime.commander_apply_preview", { targetType: "missing", targetId: "x" })).rejects.toThrow("commander apply target_type is invalid")
    await expect(server.command("runtime.apply_commander_target", { targetType: "proposal", targetId: "proposal-1" })).rejects.toThrow("runtime must be started before commander apply writes")

    await server.start()
    const submitted = await server.submitUserMessage("apply mission")
    const claim = await server.command("runtime.claim_mission", { missionId: submitted.missionId, executorId: "executor" }) as { claim_id: string }
    const blocked = await server.command("runtime.create_commander_proposal", {
      missionId: submitted.missionId,
      claimId: claim.claim_id,
      actionKind: "record_progress",
      title: "Blocked token=apply-blocked-secret",
      summary: "blocked",
      proposedBy: "operator",
      actionPayload: { mission_id: submitted.missionId, claim_id: claim.claim_id, message: "blocked" },
    }) as { proposal_id: string }
    await expect(server.command("runtime.commander_apply_preview", { targetType: "proposal", targetId: blocked.proposal_id })).resolves.toMatchObject({
      ready_to_apply: false,
      would_apply: [],
      blocked_count: 1,
    })
    await expect(server.command("runtime.apply_commander_target", { targetType: "proposal", targetId: blocked.proposal_id })).rejects.toThrow("commander apply target is not ready")

    const approved = await server.command("runtime.create_commander_proposal", {
      missionId: submitted.missionId,
      claimId: claim.claim_id,
      actionKind: "record_progress",
      title: "Approved",
      summary: "approved",
      proposedBy: "operator",
      actionPayload: { mission_id: submitted.missionId, claim_id: claim.claim_id, message: "approved progress" },
    }) as { proposal_id: string }
    const review = await server.command("runtime.request_proposal_review", { proposalId: approved.proposal_id, requestedBy: "operator" }) as { review_id: string }
    await server.command("runtime.approve_review_request", { reviewId: review.review_id, decidedBy: "operator", reason: "ok" })
    await expect(server.command("runtime.commander_apply_preview", { targetType: "proposal", targetId: approved.proposal_id })).resolves.toMatchObject({
      ready_to_apply: true,
      would_apply: [approved.proposal_id],
    })
    await expect(server.command("runtime.apply_commander_target", { targetType: "proposal", targetId: approved.proposal_id, dryRun: true })).resolves.toMatchObject({
      applied: false,
      applied_proposal_ids: [],
      skipped_proposal_ids: [approved.proposal_id],
      result_summary: "dry run; no proposals applied",
    })
    await expect(server.command("runtime.commander_apply_preview", { targetType: "proposal", targetId: approved.proposal_id })).resolves.toMatchObject({
      ready_to_apply: true,
      would_apply: [approved.proposal_id],
    })
    await expect(server.command("runtime.apply_commander_target", { targetType: "proposal", targetId: approved.proposal_id })).resolves.toMatchObject({
      applied: true,
      applied_proposal_ids: [approved.proposal_id],
    })
    await expect(server.command("runtime.commander_apply_preview", { targetType: "proposal", targetId: approved.proposal_id })).resolves.toMatchObject({
      ready_to_apply: true,
      would_apply: [],
      would_skip: [approved.proposal_id],
    })

    const bundleReady = await server.command("runtime.create_commander_proposal", {
      missionId: submitted.missionId,
      claimId: claim.claim_id,
      actionKind: "record_progress",
      title: "Bundle ready",
      summary: "bundle ready",
      proposedBy: "operator",
      actionPayload: { mission_id: submitted.missionId, claim_id: claim.claim_id, message: "bundle ready" },
    }) as { proposal_id: string }
    const bundleReview = await server.command("runtime.request_proposal_review", { proposalId: bundleReady.proposal_id, requestedBy: "operator" }) as { review_id: string }
    await server.command("runtime.approve_review_request", { reviewId: bundleReview.review_id, decidedBy: "operator", reason: "ok" })
    const bundle = await server.command("runtime.create_proposal_bundle", { title: "Bundle", summary: "Bundle", createdBy: "operator" }) as { bundle_id: string }
    await server.command("runtime.add_proposal_to_bundle", { bundleId: bundle.bundle_id, proposalId: bundleReady.proposal_id })
    await server.command("runtime.add_proposal_to_bundle", { bundleId: bundle.bundle_id, proposalId: blocked.proposal_id })
    await expect(server.command("runtime.commander_apply_preview", { targetType: "bundle", targetId: bundle.bundle_id })).resolves.toMatchObject({
      ready_to_apply: false,
      would_apply: [bundleReady.proposal_id],
    })
    await expect(server.command("runtime.apply_commander_target", { targetType: "bundle", targetId: bundle.bundle_id })).rejects.toThrow("commander apply target is not ready")
    await expect(server.command("runtime.apply_commander_target", { targetType: "bundle", targetId: bundle.bundle_id, allowPartial: true })).resolves.toMatchObject({
      applied: true,
      applied_proposal_ids: [bundleReady.proposal_id],
      skipped_proposal_ids: [blocked.proposal_id],
    })
    await expect(server.command("runtime.apply_commander_target", { targetType: "bundle", targetId: bundle.bundle_id, allowPartial: true })).rejects.toThrow("partial commander apply did not have any approved proposals")

    const draft = await server.command("runtime.draft_commander_playbook", {
      playbookId: "record-progress",
      proposedBy: "operator",
      requestedBy: "operator",
      requestReviews: true,
      fields: { mission_id: submitted.missionId, claim_id: claim.claim_id, title: "Draft", message: "draft progress" },
    }) as { draft_id: string; proposal_ids: string[]; review_ids?: string[] }
    await server.command("runtime.approve_review_request", { reviewId: draft.review_ids?.[0], decidedBy: "operator", reason: "ok" })
    await expect(server.command("runtime.commander_apply_preview", { targetType: "draft", targetId: draft.draft_id })).resolves.toMatchObject({
      ready_to_apply: true,
      apply_mode: "draft_proposals",
      would_apply: draft.proposal_ids,
    })
    await expect(server.command("runtime.apply_commander_target", { targetType: "draft", targetId: draft.draft_id })).resolves.toMatchObject({
      applied: true,
      applied_proposal_ids: draft.proposal_ids,
    })

    const bundledDraft = await server.command("runtime.draft_commander_playbook", {
      playbookId: "submit-result-and-complete",
      proposedBy: "operator",
      requestedBy: "operator",
      requestReviews: true,
      fields: {
        mission_id: submitted.missionId,
        claim_id: claim.claim_id,
        title: "Cancelled bundle draft",
        result_summary: "cancelled draft result",
        completion_summary: "cancelled draft completion",
      },
    }) as { draft_id: string; proposal_ids: string[]; bundle_id?: string; review_ids?: string[] }
    for (const reviewId of bundledDraft.review_ids ?? []) {
      await server.command("runtime.approve_review_request", { reviewId, decidedBy: "operator", reason: "ok" })
    }
    await server.command("runtime.cancel_commander_playbook_draft", { draftId: bundledDraft.draft_id, reason: "operator cancelled" })
    await expect(server.command("runtime.commander_apply_preview", { targetType: "draft", targetId: bundledDraft.draft_id })).resolves.toMatchObject({
      ready_to_apply: false,
      apply_mode: "draft_bundle",
      would_apply: [],
      blockers: [`draft ${bundledDraft.draft_id} is cancelled`],
    })
    await expect(server.command("runtime.apply_commander_target", { targetType: "draft", targetId: bundledDraft.draft_id })).rejects.toThrow("commander apply target is not ready")
    await expect(server.command("runtime.apply_commander_target", { targetType: "draft", targetId: bundledDraft.draft_id, allowPartial: true })).rejects.toThrow("partial commander apply did not have any approved proposals")

    const serialized = JSON.stringify({ events: await readJsonlEvents(dir), preview: await server.command("runtime.commander_apply_preview", { targetType: "proposal", targetId: blocked.proposal_id }) })
    expect(serialized).not.toContain("apply-blocked-secret")
    await server.shutdown()
  })

  test("commander audit timeline and authority chains read durable commander event history", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter(), researchProjectionMode: "disabled" })
    await server.start()
    const submitted = await server.submitUserMessage("audit mission token=audit-secret")
    const claim = await server.command("runtime.claim_mission", { missionId: submitted.missionId, executorId: "executor" }) as { claim_id: string }
    const draft = await server.command("runtime.draft_commander_playbook", {
      playbookId: "submit-result-and-complete",
      proposedBy: "operator",
      requestedBy: "operator",
      requestReviews: true,
      fields: {
        mission_id: submitted.missionId,
        claim_id: claim.claim_id,
        title: "Audit token=audit-secret",
        result_summary: "result token=audit-secret",
        completion_summary: "complete token=audit-secret",
      },
    }) as { draft_id: string; proposal_ids: string[]; bundle_id?: string; review_ids?: string[] }
    expect(draft.bundle_id).toBeTruthy()
    const bundleId = draft.bundle_id as string
    for (const reviewId of draft.review_ids ?? []) await server.command("runtime.approve_review_request", { reviewId, decidedBy: "operator", reason: "ok token=audit-secret" })

    const timeline = await server.command("runtime.commander_audit_timeline", { limit: 1000 }) as { events: Array<{ kind: string; event_index: number; summary: string }>; total_considered: number }
    expect(timeline.events.length).toBeLessThanOrEqual(100)
    expect(timeline.total_considered).toBeGreaterThan(0)
    expect(timeline.events.map((event) => event.event_index)).toEqual([...timeline.events.map((event) => event.event_index)].sort((a, b) => b - a))
    expect(timeline.events.map((event) => event.kind)).toContain("commander_playbook_draft_created")
    const firstPage = await server.command("runtime.commander_audit_timeline", { limit: 2 }) as { events: Array<{ event_id?: string; event_index: number }>; next_after_event_id?: string; next_before_event_id?: string }
    expect(firstPage.next_after_event_id).toBe(firstPage.events[0]?.event_id)
    expect(firstPage.next_before_event_id).toBe(firstPage.events.at(-1)?.event_id)
    const secondPage = await server.command("runtime.commander_audit_timeline", { limit: 2, beforeEventId: firstPage.next_before_event_id }) as { events: Array<{ event_id?: string; event_index: number }> }
    expect(secondPage.events.every((event) => event.event_index < firstPage.events.at(-1)!.event_index)).toBe(true)
    expect(secondPage.events.map((event) => event.event_id).some((eventId) => firstPage.events.map((event) => event.event_id).includes(eventId))).toBe(false)
    await expect(server.command("runtime.commander_audit_timeline", { beforeEventId: "missing-event" })).rejects.toThrow("audit event cursor not found")

    const proposalTimeline = await server.command("runtime.commander_audit_timeline", { category: "proposal", limit: 25 }) as { events: Array<{ category: string }> }
    expect(proposalTimeline.events.length).toBeGreaterThan(0)
    expect(proposalTimeline.events.every((event) => event.category === "proposal")).toBe(true)

    const targetTimeline = await server.command("runtime.commander_audit_timeline", { targetType: "proposal", targetId: draft.proposal_ids[0], limit: 25 }) as { events: Array<{ related_ids: Record<string, string[]> }> }
    expect(targetTimeline.events.length).toBeGreaterThan(0)
    expect(targetTimeline.events.every((event) => event.related_ids.proposal_id?.includes(draft.proposal_ids[0]))).toBe(true)

    const proposalChain = await server.command("runtime.commander_authority_chain", { targetType: "proposal", targetId: draft.proposal_ids[0] }) as { events: Array<{ kind: string }>; related_ids: Record<string, string[]>; missing_links: string[] }
    expect(proposalChain.missing_links).toEqual([])
    expect(proposalChain.related_ids.review_id?.length).toBeGreaterThan(0)
    expect(proposalChain.events.map((event) => event.kind)).toContain("commander_proposal_created")
    expect(proposalChain.events.map((event) => event.kind)).toContain("review_request_created")

	    const bundleChain = await server.command("runtime.commander_authority_chain", { targetType: "bundle", targetId: bundleId }) as { events: Array<{ kind: string }>; related_ids: Record<string, string[]> }
    expect(bundleChain.related_ids.proposal_id).toEqual(draft.proposal_ids)
    expect(bundleChain.events.map((event) => event.kind)).toContain("commander_proposal_bundle_created")

    const draftChain = await server.command("runtime.commander_authority_chain", { targetType: "draft", targetId: draft.draft_id }) as { events: Array<{ kind: string }>; related_ids: Record<string, string[]> }
    expect(draftChain.related_ids.proposal_id).toEqual(draft.proposal_ids)
    expect(draftChain.related_ids.bundle_id).toEqual([bundleId])
    expect(draftChain.events.map((event) => event.kind)).toContain("commander_playbook_draft_created")
    const singleSubmitted = await server.submitUserMessage("audit single draft")
    const singleClaim = await server.command("runtime.claim_mission", { missionId: singleSubmitted.missionId, executorId: "executor" }) as { claim_id: string }
    const singleDraft = await server.command("runtime.draft_commander_playbook", {
      playbookId: "record-progress",
      proposedBy: "operator",
      fields: {
        mission_id: singleSubmitted.missionId,
        claim_id: singleClaim.claim_id,
        title: "Single audit",
        message: "progress",
      },
    }) as { draft_id: string; proposal_ids: string[] }
    const singleDraftChain = await server.command("runtime.commander_authority_chain", { targetType: "draft", targetId: singleDraft.draft_id }) as { events: Array<{ kind: string }>; related_ids: Record<string, string[]> }
    expect(singleDraftChain.related_ids.proposal_id).toEqual(singleDraft.proposal_ids)
    expect(singleDraftChain.events.map((event) => event.kind)).toContain("commander_proposal_created")

    const missionChain = await server.command("runtime.commander_authority_chain", { targetType: "mission", targetId: submitted.missionId }) as { events: Array<{ kind: string }>; related_ids: Record<string, string[]> }
    expect(missionChain.related_ids.draft_id).toEqual([draft.draft_id])
    expect(missionChain.events.map((event) => event.kind)).toContain("mission_created")

    const missing = await server.command("runtime.commander_authority_chain", { targetType: "proposal", targetId: "missing-proposal" }) as { events: unknown[]; missing_links: string[] }
    expect(missing.events).toEqual([])
    expect(missing.missing_links[0]).toContain("missing-proposal")
    await expect(server.command("runtime.commander_authority_chain", { targetType: "unknown", targetId: "x" })).rejects.toThrow("targetType is invalid")
    await expect(server.command("runtime.commander_audit_timeline", { limit: 0 })).rejects.toThrow("limit must be a positive integer")

    const serialized = JSON.stringify({ timeline, proposalChain, bundleChain, draftChain, missionChain, events: await readJsonlEvents(dir) })
    expect(serialized).not.toContain("audit-secret")
    await server.shutdown()

    const statusServer = new RuntimeServer({ projectDir: dir, mode: "status", adapter: new LongLivedAdapter(), researchProjectionMode: "disabled" })
    await expect(statusServer.command("runtime.commander_audit_timeline", { limit: 5 })).resolves.toMatchObject({ total_considered: expect.any(Number) })
  })

  test("proposal bundle cancellation and partial apply rules are explicit", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter(), researchProjectionMode: "disabled" })

    await server.start()
    const submitted = await server.submitUserMessage("bundle partial mission")
    const claim = await server.command("runtime.claim_mission", { missionId: submitted.missionId, executorId: "executor" }) as { claim_id: string }
    const approvedCandidate = await server.command("runtime.create_commander_proposal", {
      missionId: submitted.missionId,
      claimId: claim.claim_id,
      actionKind: "record_progress",
      title: "approved",
      summary: "summary",
      proposedBy: "commander",
      actionPayload: { mission_id: submitted.missionId, claim_id: claim.claim_id, message: "approved progress" },
    }) as { proposal_id: string }
    const blockedCandidate = await server.command("runtime.create_commander_proposal", {
      missionId: submitted.missionId,
      claimId: claim.claim_id,
      actionKind: "record_progress",
      title: "blocked",
      summary: "summary",
      proposedBy: "commander",
      actionPayload: { mission_id: submitted.missionId, claim_id: claim.claim_id, message: "blocked progress" },
    }) as { proposal_id: string }
    const bundle = await server.command("runtime.create_proposal_bundle", { title: "partial", summary: "summary", createdBy: "operator" }) as { bundle_id: string }
    await server.command("runtime.add_proposal_to_bundle", { bundleId: bundle.bundle_id, proposalId: approvedCandidate.proposal_id })
    await server.command("runtime.add_proposal_to_bundle", { bundleId: bundle.bundle_id, proposalId: blockedCandidate.proposal_id })
    const reviewed = await server.command("runtime.request_proposal_review", { proposalId: approvedCandidate.proposal_id, requestedBy: "operator" }) as { review_id: string }
    await server.command("runtime.approve_review_request", { reviewId: reviewed.review_id, decidedBy: "operator" })

    await expect(server.command("runtime.apply_proposal_bundle", { bundleId: bundle.bundle_id })).rejects.toThrow("not ready to apply")
    const partialApply = await server.command("runtime.apply_proposal_bundle", { bundleId: bundle.bundle_id, allowPartial: true }) as Record<string, unknown>
    expect(partialApply).toMatchObject({
      status: "partially_applied",
    })
    expect(partialApply).not.toHaveProperty("failure_reason")
    await expect(server.command("runtime.get_commander_proposal", { proposalId: approvedCandidate.proposal_id })).resolves.toMatchObject({ status: "applied" })
    await expect(server.command("runtime.get_commander_proposal", { proposalId: blockedCandidate.proposal_id })).resolves.toMatchObject({ status: "proposed" })

    const noOp = await server.command("runtime.create_proposal_bundle", { title: "noop", summary: "summary", createdBy: "operator" }) as { bundle_id: string }
    await server.command("runtime.add_proposal_to_bundle", { bundleId: noOp.bundle_id, proposalId: blockedCandidate.proposal_id })
    await expect(server.command("runtime.apply_proposal_bundle", { bundleId: noOp.bundle_id, allowPartial: true })).rejects.toThrow("did not apply any proposals")
    const empty = await server.command("runtime.create_proposal_bundle", { title: "empty", summary: "summary", createdBy: "operator" }) as { bundle_id: string }
    await expect(server.command("runtime.apply_proposal_bundle", { bundleId: empty.bundle_id, allowPartial: true })).rejects.toThrow("has no proposals to apply")

    const cancellable = await server.command("runtime.create_proposal_bundle", { title: "cancel token=cancel-title-secret", summary: "summary", createdBy: "operator" }) as { bundle_id: string }
    await server.command("runtime.add_proposal_to_bundle", { bundleId: cancellable.bundle_id, proposalId: blockedCandidate.proposal_id })
    await expect(server.command("runtime.cancel_proposal_bundle", { bundleId: cancellable.bundle_id, reason: "reason token=cancel-reason-secret" })).resolves.toMatchObject({
      status: "cancelled",
      cancellation_reason: "reason [REDACTED]",
    })
    await expect(server.command("runtime.cancel_proposal_bundle", { bundleId: cancellable.bundle_id, reason: "reason token=cancel-reason-secret" })).resolves.toMatchObject({ status: "cancelled" })
    await expect(server.command("runtime.add_proposal_to_bundle", { bundleId: cancellable.bundle_id, proposalId: approvedCandidate.proposal_id })).rejects.toThrow("terminal proposal bundle")
    await expect(server.command("runtime.get_commander_proposal", { proposalId: blockedCandidate.proposal_id })).resolves.toMatchObject({ status: "proposed" })

    const externallyApplied = await server.command("runtime.create_commander_proposal", {
      missionId: submitted.missionId,
      claimId: claim.claim_id,
      actionKind: "record_progress",
      title: "external",
      summary: "summary",
      proposedBy: "commander",
      actionPayload: { mission_id: submitted.missionId, claim_id: claim.claim_id, message: "external progress" },
    }) as { proposal_id: string }
    const externalBundle = await server.command("runtime.create_proposal_bundle", { title: "external", summary: "summary", createdBy: "operator" }) as { bundle_id: string }
    await server.command("runtime.add_proposal_to_bundle", { bundleId: externalBundle.bundle_id, proposalId: externallyApplied.proposal_id })
    const externalReview = await server.command("runtime.request_proposal_review", { proposalId: externallyApplied.proposal_id, requestedBy: "operator" }) as { review_id: string }
    await server.command("runtime.approve_review_request", { reviewId: externalReview.review_id, decidedBy: "operator" })
    await server.command("runtime.apply_commander_proposal", { proposalId: externallyApplied.proposal_id })
    await expect(server.command("runtime.cancel_proposal_bundle", { bundleId: externalBundle.bundle_id, reason: "late" })).rejects.toThrow("applied proposal bundle cannot cancel")

    const events = await readJsonlEvents(dir)
    expect(events.map((event) => event.kind)).toEqual(expect.arrayContaining([
      "commander_proposal_bundle_apply_failed",
      "commander_proposal_bundle_cancelled",
    ]))
    expect(JSON.stringify(events)).not.toContain("cancel-title-secret")
    expect(JSON.stringify(events)).not.toContain("cancel-reason-secret")
    await server.shutdown()
  })

  test("proposal bundle runtime commands enforce write gates and allow read surfaces", async () => {
    const notStartedDir = await tempProject()
    await makeProject(notStartedDir, { approvedSpec: true })
    const notStarted = new RuntimeServer({ projectDir: notStartedDir, adapter: new LongLivedAdapter(), researchProjectionMode: "disabled" })

    await expect(notStarted.command("runtime.create_proposal_bundle", {
      title: "title",
      summary: "summary",
      createdBy: "operator",
    })).rejects.toThrow("runtime must be started before proposal bundle writes")
    await expect(notStarted.command("runtime.proposal_bundle_status")).resolves.toMatchObject({ open_count: 0 })

    const statusDir = await tempProject()
    await makeProject(statusDir)
    const statusServer = new RuntimeServer({ projectDir: statusDir, mode: "status", adapter: new LongLivedAdapter(), researchProjectionMode: "disabled" })
    await statusServer.start()

    await expect(statusServer.command("runtime.create_proposal_bundle", {
      title: "title",
      summary: "summary",
      createdBy: "operator",
    })).rejects.toThrow("runtime.create_proposal_bundle requires active mode")
    await expect(statusServer.command("runtime.list_proposal_bundles")).resolves.toEqual([])
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

    expect(await waitForToolResult(process)).toMatchObject({
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
    expect(await waitForToolResult(notStartedProcess)).toMatchObject({
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

    expect(await waitForToolResult(statusProcess)).toMatchObject({
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
    const claimResult = await waitForToolResult(process)
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
    await waitForStdinWrite(process, 4)
    const firstResults = readToolResultWrites(process)
    const submittedResult = firstResults[2] ?? {}

    process.stdout.emitData(`${JSON.stringify({
      type: "nxl.executor_tool_call",
      call_id: "call_complete",
      tool: "mission.complete",
      payload: { mission_id: created.mission.mission_id, result_id: (submittedResult.result as Record<string, unknown>).result_id },
    })}\n`)
    await waitForStdinWrite(process, 5)
    const results = readToolResultWrites(process)

    expect(claimResult).toMatchObject({ call_id: "call_claim", ok: true, result: { mission_id: created.mission.mission_id, status: "active" } })
    expect(results[1]).toMatchObject({ call_id: "call_progress", ok: true, result: { claim_id: claimId, message: "halfway" } })
    expect(submittedResult).toMatchObject({ call_id: "call_result", ok: true, result: { claim_id: claimId, summary: "done" } })
    expect(results[3]).toMatchObject({ call_id: "call_complete", ok: true, result: { status: "completed" } })

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

  test("external API connectors preview, execute, audit, and redact secrets", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const transport = new FakeExternalApiTransport([
      { status_code: 200, body: "token=response-secret api_key=response-key value=ok" },
      { status_code: 200, body: "{\"ok\":true}" },
      { status_code: 200, body: "語".repeat(600) },
    ])
    const server = new RuntimeServer({
      projectDir: dir,
      mode: "active",
      researchProjectionMode: "disabled",
      externalApiTransport: transport,
      externalApiEnv: { NXL_TEST_API_KEY: "raw-secret-token" },
      externalApiRequestId: () => "api_req_test",
      externalApiNow: () => new Date("2026-05-24T00:00:00.000Z"),
      externalApiConnectorRegistry: new ExternalApiConnectorRegistry([
        {
          connector_id: "with-credential",
          title: "With credential token=title-secret",
          base_url: "https://api.example.test",
          allowed_hosts: ["api.example.test"],
          allowed_methods: ["GET", "POST"],
          credential_refs: [{ name: "test-key", source: "env", env_name: "NXL_TEST_API_KEY", inject_as: "header", target_name: "Authorization", prefix: "Bearer " }],
          timeout_ms: 5000,
          max_response_bytes: 4096,
          created_at: "1970-01-01T00:00:00.000Z",
          updated_at: "1970-01-01T00:00:00.000Z",
        },
        {
          connector_id: "with-custom-credential-header",
          title: "With custom credential header",
          base_url: "https://api.example.test",
          allowed_hosts: ["api.example.test"],
          allowed_methods: ["GET"],
          credential_refs: [{ name: "custom-key", source: "env", env_name: "NXL_TEST_API_KEY", inject_as: "header", target_name: "X-Api-Key" }],
          timeout_ms: 5000,
          max_response_bytes: 4096,
          created_at: "1970-01-01T00:00:00.000Z",
          updated_at: "1970-01-01T00:00:00.000Z",
        },
      ]),
    })

    const connectors = await server.command("runtime.list_external_api_connectors") as Array<{ connector_id: string; title: string }>
    expect(connectors).toHaveLength(2)
    expect(JSON.stringify(connectors)).not.toContain("title-secret")

    const preview = await server.command("runtime.preview_external_api_request", {
      connectorId: "with-credential",
      method: "GET",
      path: "/search",
      query: { q: "token=query-secret" },
      requestedBy: "operator",
    }) as { allowed: boolean; url: string; redacted_headers: Record<string, string>; credential_refs_used: string[] }
    expect(preview.allowed).toBe(true)
    expect(preview.url).not.toContain("query-secret")
    expect(preview.redacted_headers.Authorization).toBe("[REDACTED]")
    expect(preview.credential_refs_used).toEqual(["test-key"])
    expect((await readJsonlEvents(dir)).map((event) => event.kind)).not.toContain("external_api_request_executed")

    const blockedCredentialHeader = await server.command("runtime.preview_external_api_request", {
      connectorId: "with-credential",
      method: "GET",
      path: "/search",
      headers: { authorization: "Bearer user-secret-token" },
      requestedBy: "operator",
    }) as { allowed: boolean; blockers: string[] }
    expect(blockedCredentialHeader.allowed).toBe(false)
    expect(blockedCredentialHeader.blockers.join(" ")).toContain("header is not allowed")
    expect(JSON.stringify(blockedCredentialHeader)).not.toContain("user-secret-token")

    const blockedCustomCredentialHeader = await server.command("runtime.preview_external_api_request", {
      connectorId: "with-custom-credential-header",
      method: "GET",
      path: "/search",
      headers: { "x-api-key": "user-secret-token" },
      requestedBy: "operator",
    }) as { allowed: boolean; blockers: string[] }
    expect(blockedCustomCredentialHeader.allowed).toBe(false)
    expect(blockedCustomCredentialHeader.blockers.join(" ")).toContain("credential header is not allowed")
    expect(JSON.stringify(blockedCustomCredentialHeader)).not.toContain("user-secret-token")

    await expect(server.command("runtime.execute_external_api_request", {
      connectorId: "with-credential",
      method: "GET",
      path: "/search",
      requestedBy: "operator",
    })).rejects.toThrow("runtime must be started before external API requests")

    await server.start()
    const result = await server.command("runtime.execute_external_api_request", {
      connectorId: "with-credential",
      method: "GET",
      path: "/search",
      requestedBy: "operator token=requester-secret",
    }) as { ok: boolean; response_preview: string }
    expect(result.ok).toBe(true)
    expect(result.response_preview).not.toContain("response-secret")
    expect(transport.requests).toHaveLength(1)
    expect(transport.requests[0].headers.Authorization).toBe("Bearer raw-secret-token")

    await server.command("runtime.execute_external_api_request", {
      connectorId: "with-credential",
      method: "POST",
      path: "/submit",
      body: "  exact body\n",
      requestedBy: "operator",
    })
    expect(transport.requests[1].body).toBe("  exact body\n")

    const longPreview = await server.command("runtime.execute_external_api_request", {
      connectorId: "with-credential",
      method: "GET",
      path: "/long",
      requestedBy: "operator",
    }) as { response_preview: string }
    expect(new TextEncoder().encode(longPreview.response_preview).byteLength).toBeLessThanOrEqual(512)

    const audit = await server.command("runtime.list_external_api_audit") as Array<{ request_id: string; requested_by: string; ok: boolean }>
    expect(audit).toContainEqual(expect.objectContaining({ request_id: "api_req_test", ok: true }))
    expect(new TextEncoder().encode(JSON.stringify(audit)).byteLength).toBeLessThan(4096)
    expect(JSON.stringify(audit)).not.toContain("requester-secret")
    expect(JSON.stringify(await readJsonlEvents(dir))).not.toContain("raw-secret-token")
    await server.shutdown()
  })

  test("external API safety rejects disallowed requests and dry-run skips transport", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const transport = new FakeExternalApiTransport()
    const server = new RuntimeServer({ projectDir: dir, mode: "active", researchProjectionMode: "disabled", externalApiTransport: transport })

    const blocked = await server.command("runtime.preview_external_api_request", {
      connectorId: "mock-research-api",
      method: "POST",
      path: "https://evil.example.test/data",
      headers: { Authorization: "Bearer secret-token" },
      requestedBy: "operator",
    }) as { allowed: boolean; blockers: string[] }
    expect(blocked.allowed).toBe(false)
    expect(blocked.blockers.join(" ")).toContain("host not allowed")
    expect(blocked.blockers.join(" ")).toContain("header is not allowed")

    const emptyValues = await server.command("runtime.preview_external_api_request", {
      connectorId: "mock-research-api",
      method: "GET",
      path: "/empty",
      query: { flag: "" },
      headers: { "X-Empty": "" },
      requestedBy: "operator",
    }) as { allowed: boolean; url: string; redacted_headers: Record<string, string> }
    expect(emptyValues.allowed).toBe(true)
    expect(emptyValues.url).toContain("flag=")
    expect(emptyValues.redacted_headers["X-Empty"]).toBe("")

    const ipv6Server = new RuntimeServer({
      projectDir: dir,
      mode: "view-records",
      researchProjectionMode: "disabled",
      externalApiConnectorRegistry: new ExternalApiConnectorRegistry([{
        connector_id: "ipv6-local",
        title: "IPv6 local",
        base_url: "https://[::1]",
        allowed_hosts: ["[::1]"],
        allowed_methods: ["GET"],
        timeout_ms: 5000,
        max_response_bytes: 4096,
        created_at: "1970-01-01T00:00:00.000Z",
        updated_at: "1970-01-01T00:00:00.000Z",
      }]),
      externalApiTransport: new FakeExternalApiTransport(),
    })
    const blockedIpv6 = await ipv6Server.command("runtime.preview_external_api_request", {
      connectorId: "ipv6-local",
      method: "GET",
      path: "/status",
      requestedBy: "operator",
    }) as { allowed: boolean; blockers: string[] }
    expect(blockedIpv6.allowed).toBe(false)
    expect(blockedIpv6.blockers.join(" ")).toContain("local/private host is not allowed")

    await server.start()
    const dryRun = await server.command("runtime.execute_external_api_request", {
      connectorId: "mock-research-api",
      method: "GET",
      path: "/dry",
      dryRun: true,
      requestedBy: "operator",
    }) as { ok: boolean; dry_run: boolean }
    expect(dryRun).toMatchObject({ ok: true, dry_run: true })
    expect(transport.requests).toHaveLength(0)
    expect(await server.command("runtime.list_external_api_audit")).toEqual([])
    await expect(server.command("runtime.execute_external_api_request", {
      connectorId: "mock-research-api",
      method: "GET",
      path: "https://evil.example.test/dry",
      dryRun: true,
      requestedBy: "operator",
    })).rejects.toThrow("host not allowed")
    expect(transport.requests).toHaveLength(0)
    expect(await server.command("runtime.list_external_api_audit")).toEqual([])
    await server.shutdown()
  })

  test("external API connector env config validation fails clearly", () => {
    expect(() => readExternalApiConnectorsFromEnv({ NXL_EXTERNAL_API_CONNECTORS_JSON: "not-json" })).toThrow("must be valid JSON")
    expect(() => readExternalApiConnectorsFromEnv({
      NXL_EXTERNAL_API_CONNECTORS_JSON: JSON.stringify([{ connector_id: "bad", title: "Bad", base_url: "ftp://example.test", allowed_hosts: ["example.test"], allowed_methods: ["GET"], timeout_ms: 1, max_response_bytes: 1, created_at: "now", updated_at: "now" }]),
    })).toThrow("base_url must use https")
  })

  test("fetch external API transport enforces response max bytes for multibyte text", async () => {
    const originalFetch = globalThis.fetch
    let streamCanceled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode("abc"))
        controller.enqueue(encoder.encode("def"))
      },
      cancel() {
        streamCanceled = true
      },
    })
    const responses: Array<string | ReadableStream<Uint8Array>> = ["日本語abc", "😀abc", stream]
    globalThis.fetch = (async () => new Response(responses.shift() ?? "", { status: 200 })) as unknown as typeof fetch
    try {
      const transport = new FetchExternalApiTransport()
      const result = await transport.request({
        method: "GET",
        url: "https://api.example.test/text",
        headers: {},
        timeout_ms: 1000,
        max_response_bytes: 6,
      })
      expect(new TextEncoder().encode(result.body).byteLength).toBeLessThanOrEqual(6)
      const splitCodepoint = await transport.request({
        method: "GET",
        url: "https://api.example.test/emoji",
        headers: {},
        timeout_ms: 1000,
        max_response_bytes: 1,
      })
      expect(splitCodepoint.body).toBe("")
      expect(new TextEncoder().encode(splitCodepoint.body).byteLength).toBeLessThanOrEqual(1)
      const streamed = await transport.request({
        method: "GET",
        url: "https://api.example.test/stream",
        headers: {},
        timeout_ms: 1000,
        max_response_bytes: 3,
      })
      expect(streamed.body).toBe("abc")
      expect(streamCanceled).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
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

  test("release removes owned lock restored after stale-file cleanup", async () => {
    const dir = await tempProject()
    const lockPath = join(dir, ".nxl", "run.lock")
    const stalePath = `${lockPath}.released-owner.stale`
    const lock = new RunLock(lockPath, {
      now: lockNow,
      beforeSecondOwnedLockPathCheck: async () => {
        await writeFile(lockPath, JSON.stringify(record) + "\n")
      },
    })

    await lock.acquire()
    const record = JSON.parse(await readFile(lockPath, "utf8"))
    await rm(lockPath, { force: true })
    await writeFile(stalePath, JSON.stringify(record) + "\n")
    await lock.release()

    expect(existsSync(lockPath)).toBe(false)
    expect(existsSync(stalePath)).toBe(false)
  })

  test("release preserves another owner lock restored after stale-file cleanup", async () => {
    const dir = await tempProject()
    const lockPath = join(dir, ".nxl", "run.lock")
    const stalePath = `${lockPath}.released-owner.stale`
    const restored = { pid: process.pid, acquired_at: lockNow().toISOString(), token: "other-owner-token" }
    const lock = new RunLock(lockPath, {
      now: lockNow,
      beforeSecondOwnedLockPathCheck: async () => {
        await writeFile(lockPath, JSON.stringify(restored) + "\n")
      },
    })

    await lock.acquire()
    const record = JSON.parse(await readFile(lockPath, "utf8"))
    await rm(lockPath, { force: true })
    await writeFile(stalePath, JSON.stringify(record) + "\n")
    await lock.release()

    expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual(restored)
    expect(existsSync(stalePath)).toBe(false)
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

  test("stale cleanup rollback does not clobber a fresh lock winner", async () => {
    const dir = await tempProject()
    const lockPath = join(dir, ".nxl", "run.lock")
    const replacement = { pid: 99999999, acquired_at: lockNow().toISOString(), token: "replacement-token" }
    const winner = { pid: process.pid, acquired_at: lockNow().toISOString(), token: "winner-token" }
    await mkdir(join(dir, ".nxl"), { recursive: true })
    await writeFile(lockPath, JSON.stringify({ pid: 99999999, acquired_at: "2026-05-09T11:59:59Z", token: "old-token" }) + "\n")
    const lock = new RunLock(lockPath, {
      now: lockNow,
      beforeStaleRename: async () => {
        await writeFile(lockPath, JSON.stringify(replacement) + "\n")
      },
      beforeRestoreMovedLock: async () => {
        await writeFile(lockPath, JSON.stringify(winner) + "\n")
      },
    })

    await expect(lock.acquire()).rejects.toThrow("runtime lock already held")
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual(winner)
  })

  test("stale cleanup rollback does not resurrect a fresh winner released while moved", async () => {
    const dir = await tempProject()
    const lockPath = join(dir, ".nxl", "run.lock")
    await mkdir(join(dir, ".nxl"), { recursive: true })
    await writeFile(lockPath, JSON.stringify({ pid: 99999999, acquired_at: "2026-05-09T11:59:59Z", token: "old-token" }) + "\n")
    const winner = new RunLock(lockPath, { now: lockNow })
    const lock = new RunLock(lockPath, {
      now: lockNow,
      beforeStaleRename: async () => {
        await winner.acquire()
      },
      beforeRestoreMovedLock: async () => {
        await winner.release()
      },
    })

    await expect(lock.acquire()).rejects.toThrow("runtime lock already held")
    expect(existsSync(lockPath)).toBe(false)

    const next = new RunLock(lockPath, { now: lockNow })
    await next.acquire()
    expect(next.isHeld()).toBe(true)
    await next.release()
  })

  test("stale cleanup rollback treats unsupported hard links as lock contention", async () => {
    const dir = await tempProject()
    const lockPath = join(dir, ".nxl", "run.lock")
    const replacement = { pid: process.pid, acquired_at: lockNow().toISOString(), token: "replacement-token" }
    await mkdir(join(dir, ".nxl"), { recursive: true })
    await writeFile(lockPath, JSON.stringify({ pid: 99999999, acquired_at: "2026-05-09T11:59:59Z", token: "old-token" }) + "\n")
    const lock = new RunLock(lockPath, {
      now: lockNow,
      beforeStaleRename: async () => {
        await writeFile(lockPath, JSON.stringify(replacement) + "\n")
      },
      linkMovedLock: async () => {
        const error = new Error("hard links unsupported") as NodeJS.ErrnoException
        error.code = "EOPNOTSUPP"
        throw error
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

describe("ReviewRegistry", () => {
  test("uses deterministic hooks, validates mission references, and rebuilds from events", async () => {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    const missionRegistry = new MissionRegistry({
      eventStore: store,
      projectDir: dir,
      idFactory: (prefix) => `${prefix}_1`,
      now: () => new Date("2026-05-10T12:00:00.000Z"),
    })
    const mission = await missionRegistry.createUserMessageMission("review target")
    await missionRegistry.markMissionSent(mission.mission.mission_id)
    const claim = await missionRegistry.claimMission({ mission_id: mission.mission.mission_id, executor_id: "executor" })
    const result = await missionRegistry.submitMissionResult({ mission_id: mission.mission.mission_id, claim_id: claim.claim_id, summary: "result" })

    let nextReview = 0
    let nextMs = 0
    const registry = new ReviewRegistry({
      eventStore: store,
      missionRegistry,
      idFactory: () => `review_${++nextReview}`,
      now: () => new Date(Date.UTC(2026, 4, 10, 13, 0, 0, nextMs++)),
    })

    await expect(registry.createReviewRequest({
      mission_id: "missing",
      title: "title",
      summary: "summary",
      requested_by: "operator",
    })).rejects.toThrow("mission not found")
    const review = await registry.createReviewRequest({
      mission_id: mission.mission.mission_id,
      claim_id: claim.claim_id,
      result_id: result.result_id,
      request_type: "result_acceptance",
      title: "Accept result",
      summary: "Looks good",
      requested_by: "operator",
    })
    await registry.rejectReviewRequest(review.review_id, "operator", "not enough evidence")
    const rebuilt = new ReviewRegistry({ eventStore: store, missionRegistry })

    await expect(rebuilt.getReviewRequest("review_1")).resolves.toMatchObject({
      review_id: "review_1",
      status: "rejected",
      decision_reason: "not enough evidence",
    })
    await expect(rebuilt.statusSummary()).resolves.toMatchObject({ pending_count: 0, rejected_count: 1, last_review_id: "review_1" })
  })

  test("terminal decisions are idempotent only for matching payloads", async () => {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    const registry = new ReviewRegistry({
      eventStore: store,
      idFactory: () => "review_1",
      now: () => new Date("2026-05-10T12:00:00.000Z"),
    })

    const review = await registry.createReviewRequest({
      title: "Cancel checkpoint secret=review-terminal-secret",
      summary: "summary",
      requested_by: "operator",
    })
    await expect(registry.cancelReviewRequest(review.review_id, "operator", "same")).resolves.toMatchObject({ status: "cancelled", decision_reason: "same" })
    await expect(registry.cancelReviewRequest(review.review_id, "operator", "same")).resolves.toMatchObject({ status: "cancelled" })
    await expect(registry.approveReviewRequest(review.review_id, "operator", "same")).rejects.toThrow("terminal review decision conflicts")
    await expect(registry.cancelReviewRequest(review.review_id, "operator", "different")).rejects.toThrow("terminal review decision conflicts")
    expect(JSON.stringify(await readJsonlEvents(dir))).not.toContain("review-terminal-secret")
  })

  test("malformed review events fail hydration clearly", async () => {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    await store.append({ kind: "review_request_created", review: { review_id: "review_bad" } })
    const registry = new ReviewRegistry({ eventStore: store })

    await expect(registry.listReviewRequests()).rejects.toThrow("request_type is invalid")
  })

  test("created review events must replay as pending", async () => {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    await store.append({
      kind: "review_request_created",
      review: {
        review_id: "review_bad_status",
        request_type: "other",
        title: "title",
        summary: "summary",
        requested_by: "operator",
        status: "approved",
        created_at: "2026-05-10T12:00:00.000Z",
        updated_at: "2026-05-10T12:00:00.000Z",
      },
    })
    const registry = new ReviewRegistry({ eventStore: store })

    await expect(registry.listReviewRequests()).rejects.toThrow("review_request_created must start pending")
  })

  test("hydration rejects conflicting terminal review decisions", async () => {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    await store.append({
      kind: "review_request_created",
      review: {
        review_id: "review_conflict",
        request_type: "other",
        title: "title",
        summary: "summary",
        requested_by: "operator",
        status: "pending",
        created_at: "2026-05-10T12:00:00.000Z",
        updated_at: "2026-05-10T12:00:00.000Z",
      },
    })
    await store.append({
      kind: "review_request_approved",
      decision: {
        review_id: "review_conflict",
        decision: "approved",
        decided_by: "operator",
        reason: "ok",
        decided_at: "2026-05-10T12:00:01.000Z",
      },
    })
    await store.append({
      kind: "review_request_rejected",
      decision: {
        review_id: "review_conflict",
        decision: "rejected",
        decided_by: "operator",
        reason: "no",
        decided_at: "2026-05-10T12:00:02.000Z",
      },
    })
    const registry = new ReviewRegistry({ eventStore: store })

    await expect(registry.getReviewRequest("review_conflict")).rejects.toThrow("terminal review decision conflicts")
  })

  test("hydration rejects review decision event kind mismatches", async () => {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    await store.append({
      kind: "review_request_created",
      review: {
        review_id: "review_kind_mismatch",
        request_type: "other",
        title: "title",
        summary: "summary",
        requested_by: "operator",
        status: "pending",
        created_at: "2026-05-10T12:00:00.000Z",
        updated_at: "2026-05-10T12:00:00.000Z",
      },
    })
    await store.append({
      kind: "review_request_approved",
      decision: {
        review_id: "review_kind_mismatch",
        decision: "rejected",
        decided_by: "operator",
        reason: "mismatch",
        decided_at: "2026-05-10T12:00:01.000Z",
      },
    })
    const registry = new ReviewRegistry({ eventStore: store })

    await expect(registry.getReviewRequest("review_kind_mismatch")).rejects.toThrow("review decision event kind conflicts")
  })
})

describe("ProposalRegistry", () => {
  async function proposalFixture() {
    const dir = await tempProject()
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    let next = 0
    const missionRegistry = new MissionRegistry({
      eventStore: store,
      projectDir: dir,
      idFactory: (prefix) => `${prefix}_${++next}`,
      now: () => new Date("2026-05-10T12:00:00.000Z"),
    })
    const mission = await missionRegistry.createUserMessageMission("proposal target")
    await missionRegistry.markMissionSent(mission.mission.mission_id)
    const claim = await missionRegistry.claimMission({ mission_id: mission.mission.mission_id, executor_id: "executor" })
    const reviewRegistry = new ReviewRegistry({
      eventStore: store,
      missionRegistry,
      idFactory: () => `review_${++next}`,
      now: () => new Date("2026-05-10T12:00:00.000Z"),
    })
    const proposalRegistry = new ProposalRegistry({
      eventStore: store,
      missionRegistry,
      reviewRegistry,
      idFactory: () => `proposal_${++next}`,
      now: () => new Date("2026-05-10T12:00:00.000Z"),
    })
    return { dir, store, missionRegistry, reviewRegistry, proposalRegistry, missionId: mission.mission.mission_id, claimId: claim.claim_id }
  }

  test("creates durable proposals and rebuilds summaries from events", async () => {
    const { dir, store, missionRegistry, reviewRegistry, proposalRegistry, missionId, claimId } = await proposalFixture()
    const proposal = await proposalRegistry.createProposal({
      mission_id: missionId,
      claim_id: claimId,
      action_kind: "record_progress",
      title: "Record secret=proposal-title",
      summary: "Progress secret=proposal-summary",
      proposed_by: "commander",
      action_payload: { mission_id: missionId, claim_id: claimId, message: "working secret=payload" },
    })

    expect(proposal).toMatchObject({ status: "proposed", title: "Record [REDACTED]", action_payload: { message: "working [REDACTED]" } })
    await expect(proposalRegistry.listProposals()).resolves.toMatchObject([{ proposal_id: proposal.proposal_id, status: "proposed" }])
    await expect(proposalRegistry.statusSummary()).resolves.toMatchObject({ proposed_count: 1, last_proposal_id: proposal.proposal_id })
    const rebuilt = new ProposalRegistry({ eventStore: store, missionRegistry, reviewRegistry })
    await expect(rebuilt.getProposal(proposal.proposal_id)).resolves.toMatchObject({ proposal_id: proposal.proposal_id, summary: "Progress [REDACTED]" })
    expect(JSON.stringify(await readJsonlEvents(dir))).not.toContain("proposal-title")
    expect(JSON.stringify(await readJsonlEvents(dir))).not.toContain("proposal-summary")
    expect(JSON.stringify(await readJsonlEvents(dir))).not.toContain("secret=payload")
  })

  test("links review requests and requires approved review before apply", async () => {
    const { proposalRegistry, reviewRegistry, missionId, claimId } = await proposalFixture()
    const proposal = await proposalRegistry.createProposal({
      mission_id: missionId,
      claim_id: claimId,
      action_kind: "record_progress",
      title: "Progress",
      summary: "Working",
      proposed_by: "commander",
      action_payload: { mission_id: missionId, claim_id: claimId, message: "working" },
    })
    const requested = await proposalRegistry.requestReview(proposal.proposal_id, { title: "Review progress", summary: "Approve progress", requested_by: "operator" })
    expect(requested).toMatchObject({ status: "review_requested" })
    await expect(proposalRegistry.applyProposal(proposal.proposal_id)).rejects.toThrow("approved linked review")
    await reviewRegistry.approveReviewRequest(requested.review_id!, "operator", "ok")
    await expect(proposalRegistry.applyProposal(proposal.proposal_id)).resolves.toMatchObject({
      status: "applied",
      application_result: expect.stringContaining("mission_progress_recorded:progress_"),
    })
    await expect(proposalRegistry.applyProposal(proposal.proposal_id)).resolves.toMatchObject({ status: "applied" })
  })

  test("rejected linked reviews persist terminal rejected proposal state", async () => {
    const { proposalRegistry, reviewRegistry, missionId, claimId } = await proposalFixture()
    const proposal = await proposalRegistry.createProposal({
      mission_id: missionId,
      claim_id: claimId,
      action_kind: "record_progress",
      title: "Progress",
      summary: "Working",
      proposed_by: "commander",
      action_payload: { mission_id: missionId, claim_id: claimId, message: "working" },
    })
    const requested = await proposalRegistry.requestReview(proposal.proposal_id, { title: "Review progress", summary: "Approve progress", requested_by: "operator" })
    await reviewRegistry.rejectReviewRequest(requested.review_id!, "operator", "not approved")

    await expect(proposalRegistry.applyProposal(proposal.proposal_id)).rejects.toThrow("linked review is rejected")
    await expect(proposalRegistry.getProposal(proposal.proposal_id)).resolves.toMatchObject({
      status: "rejected",
      failure_reason: "not approved",
    })
    await expect(proposalRegistry.statusSummary()).resolves.toMatchObject({ rejected_count: 1, review_requested_count: 0 })
    await expect(proposalRegistry.applyProposal(proposal.proposal_id)).rejects.toThrow("terminal proposal cannot apply")
  })

  test("rejected proposals cannot request another review", async () => {
    const { proposalRegistry, reviewRegistry, missionId, claimId } = await proposalFixture()
    const proposal = await proposalRegistry.createProposal({
      mission_id: missionId,
      claim_id: claimId,
      action_kind: "record_progress",
      title: "Progress",
      summary: "Working",
      proposed_by: "commander",
      action_payload: { mission_id: missionId, claim_id: claimId, message: "working" },
    })
    const requested = await proposalRegistry.requestReview(proposal.proposal_id, { requested_by: "operator" })
    await reviewRegistry.rejectReviewRequest(requested.review_id!, "operator", "no")
    await proposalRegistry.syncReviewDecision(requested.review_id!)

    await expect(proposalRegistry.requestReview(proposal.proposal_id, { requested_by: "operator" })).rejects.toThrow("terminal proposal cannot request review")
  })

  test("review decision sync approves proposals and apply accepts proposal-level ids", async () => {
    const { proposalRegistry, reviewRegistry, missionRegistry, missionId, claimId } = await proposalFixture()
    const proposal = await proposalRegistry.createProposal({
      mission_id: missionId,
      claim_id: claimId,
      action_kind: "record_progress",
      title: "Progress",
      summary: "Working",
      proposed_by: "commander",
      action_payload: { message: "working" },
    })
    const requested = await proposalRegistry.requestReview(proposal.proposal_id, { title: "Review progress", summary: "Approve progress", requested_by: "operator" })
    await reviewRegistry.approveReviewRequest(requested.review_id!, "operator", "ok")

    await expect(proposalRegistry.syncReviewDecision(requested.review_id!)).resolves.toMatchObject([{ proposal_id: proposal.proposal_id, status: "approved" }])
    await expect(proposalRegistry.getProposal(proposal.proposal_id)).resolves.toMatchObject({ status: "approved" })
    await expect(proposalRegistry.applyProposal(proposal.proposal_id)).resolves.toMatchObject({
      status: "applied",
      application_result: expect.stringContaining("mission_progress_recorded:progress_"),
    })
    await expect(missionRegistry.listMissionProgress(missionId)).resolves.toMatchObject([{ claim_id: claimId, message: "working" }])
  })

  test("apply rejects payload ids that conflict with reviewed proposal targets", async () => {
    const { proposalRegistry, reviewRegistry, missionRegistry, missionId, claimId } = await proposalFixture()
    const otherMission = await missionRegistry.createUserMessageMission("other proposal target")
    await missionRegistry.markMissionSent(otherMission.mission.mission_id)
    const otherClaim = await missionRegistry.claimMission({ mission_id: otherMission.mission.mission_id, executor_id: "executor" })
    const proposal = await proposalRegistry.createProposal({
      mission_id: missionId,
      claim_id: claimId,
      action_kind: "record_progress",
      title: "Progress",
      summary: "Working",
      proposed_by: "commander",
      action_payload: {
        mission_id: otherMission.mission.mission_id,
        claim_id: otherClaim.claim_id,
        message: "wrong target",
      },
    })
    const requested = await proposalRegistry.requestReview(proposal.proposal_id, { requested_by: "operator" })
    await reviewRegistry.approveReviewRequest(requested.review_id!, "operator", "ok")
    await proposalRegistry.syncReviewDecision(requested.review_id!)

    await expect(proposalRegistry.applyProposal(proposal.proposal_id)).rejects.toThrow("mission_id conflicts with reviewed proposal target")
    await expect(missionRegistry.listMissionProgress(otherMission.mission.mission_id)).resolves.toEqual([])
    await expect(proposalRegistry.getProposal(proposal.proposal_id)).resolves.toMatchObject({
      status: "approved",
      failure_reason: expect.stringContaining("mission_id conflicts"),
    })
  })

  test("applied proposal replay clears stale apply failure reason", async () => {
    const { store, missionRegistry, reviewRegistry } = await proposalFixture()
    await store.append({
      kind: "commander_proposal_created",
      proposal: {
        proposal_id: "proposal_replay",
        action_kind: "record_progress",
        title: "title",
        summary: "summary",
        proposed_by: "commander",
        status: "proposed",
        action_payload: {},
        created_at: "2026-05-10T12:00:00.000Z",
        updated_at: "2026-05-10T12:00:00.000Z",
      },
    })
    await store.append({
      kind: "commander_proposal_review_requested",
      proposal_id: "proposal_replay",
      review_id: "review_replay",
      requested_at: "2026-05-10T12:00:01.000Z",
    })
    await store.append({
      kind: "commander_proposal_approved",
      proposal_id: "proposal_replay",
      review_id: "review_replay",
      approved_at: "2026-05-10T12:00:02.000Z",
    })
    await store.append({
      kind: "commander_proposal_apply_failed",
      proposal_id: "proposal_replay",
      failed_at: "2026-05-10T12:00:03.000Z",
      failure_reason: "transient failure",
    })
    await store.append({
      kind: "commander_proposal_applied",
      proposal_id: "proposal_replay",
      applied_at: "2026-05-10T12:00:04.000Z",
      application_result: "mission_progress_recorded:progress_replay",
    })

    const rebuilt = new ProposalRegistry({ eventStore: store, missionRegistry, reviewRegistry })
    const replayed = await rebuilt.getProposal("proposal_replay")
    expect(replayed).toMatchObject({
      status: "applied",
      application_result: "mission_progress_recorded:progress_replay",
    })
    expect(replayed).not.toHaveProperty("failure_reason")
  })

  test("applies supported mission actions through MissionRegistry and rejects unsupported kinds", async () => {
    for (const actionKind of ["submit_result", "complete_mission", "fail_mission", "cancel_mission", "release_claim"] as const) {
      const { proposalRegistry, reviewRegistry, missionRegistry, missionId, claimId } = await proposalFixture()
      const result = actionKind === "complete_mission"
        ? await missionRegistry.submitMissionResult({ mission_id: missionId, claim_id: claimId, summary: "done" })
        : undefined
      const payload = actionKind === "submit_result"
        ? { mission_id: missionId, claim_id: claimId, summary: "result" }
        : actionKind === "complete_mission"
          ? { mission_id: missionId, result_id: result!.result_id, summary: "complete" }
          : actionKind === "fail_mission"
            ? { mission_id: missionId, reason: "failed" }
            : actionKind === "cancel_mission"
              ? { mission_id: missionId, reason: "cancelled" }
              : { claim_id: claimId, reason: "release" }
      const proposal = await proposalRegistry.createProposal({
        mission_id: actionKind === "release_claim" ? undefined : missionId,
        claim_id: actionKind === "release_claim" ? claimId : undefined,
        result_id: result?.result_id,
        action_kind: actionKind,
        title: actionKind,
        summary: actionKind,
        proposed_by: "commander",
        action_payload: payload,
      })
      const requested = await proposalRegistry.requestReview(proposal.proposal_id, { requested_by: "operator" })
      await reviewRegistry.approveReviewRequest(requested.review_id!, "operator", "ok")
      await expect(proposalRegistry.applyProposal(proposal.proposal_id)).resolves.toMatchObject({ status: "applied" })
    }

    const { proposalRegistry, reviewRegistry, missionId } = await proposalFixture()
    const unsupported = await proposalRegistry.createProposal({
      mission_id: missionId,
      action_kind: "other",
      title: "Other",
      summary: "Other",
      proposed_by: "commander",
      action_payload: { mission_id: missionId },
    })
    const requested = await proposalRegistry.requestReview(unsupported.proposal_id, { requested_by: "operator" })
    await reviewRegistry.approveReviewRequest(requested.review_id!, "operator", "ok")
    await expect(proposalRegistry.applyProposal(unsupported.proposal_id)).rejects.toThrow("unsupported proposal action kind")
    await expect(proposalRegistry.getProposal(unsupported.proposal_id)).resolves.toMatchObject({ status: "approved", failure_reason: expect.stringContaining("unsupported") })
  })

  test("cancelled proposals are terminal and idempotent only for matching reason", async () => {
    const { proposalRegistry, missionId } = await proposalFixture()
    const proposal = await proposalRegistry.createProposal({
      mission_id: missionId,
      action_kind: "cancel_mission",
      title: "Cancel",
      summary: "Cancel",
      proposed_by: "commander",
      action_payload: { mission_id: missionId, reason: "no longer needed" },
    })
    await expect(proposalRegistry.cancelProposal(proposal.proposal_id, "same")).resolves.toMatchObject({ status: "cancelled", failure_reason: "same" })
    await expect(proposalRegistry.cancelProposal(proposal.proposal_id, "same")).resolves.toMatchObject({ status: "cancelled" })
    await expect(proposalRegistry.cancelProposal(proposal.proposal_id, "different")).rejects.toThrow("terminal proposal cancellation conflicts")
    await expect(proposalRegistry.applyProposal(proposal.proposal_id)).rejects.toThrow("terminal proposal cannot apply")
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

async function waitForJsonlWrite(process: FakeSpawnedProcess, type: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + NON_BLOCKING_START_TIMEOUT_MS
  while (Date.now() < deadline) {
    for (const line of process.stdinWrites) {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (parsed.type === type) {
        expect(line.endsWith("\n")).toBe(true)
        return parsed
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${type} stdin write`)
}

async function waitForToolResult(process: FakeSpawnedProcess): Promise<Record<string, unknown>> {
  return waitForJsonlWrite(process, "nxl.executor_tool_result")
}

function readToolResultWrites(process: FakeSpawnedProcess): Record<string, unknown>[] {
  return process.stdinWrites
    .map((line) => readToolResultLine(line))
    .filter((line) => line.type === "nxl.executor_tool_result")
}

function sessionContractFromWrite(process: FakeSpawnedProcess): Record<string, unknown> {
  const session = JSON.parse(process.stdinWrites[0] ?? "{}") as Record<string, unknown>
  return session.contract as Record<string, unknown>
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

describe("OpenCode adapter config", () => {
  test("RuntimeServer defaults to FakeOpenCodeAdapter when no adapter config or injection is provided", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir })

    expect(server.adapter).toBeInstanceOf(FakeOpenCodeAdapter)
    await server.start()
    expect(await server.status()).toMatchObject({
      fakeOpenCode: "Real OpenCode runtime integration is intentionally not implemented in R3.",
      adapterStatus: { adapter: "fake", phase: "started" },
    })
    await server.shutdown()
  })

  test("direct injected adapter takes precedence over adapter config", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const adapter = new LongLivedAdapter()
    const server = new RuntimeServer({
      projectDir: dir,
      adapter,
      openCodeAdapterConfig: { kind: "process", command: "" },
    })

    expect(server.adapter).toBe(adapter)
    await server.start()
    expect(adapter.startCalls).toBe(1)
    await server.shutdown()
  })

  test("factory creates FakeOpenCodeAdapter for fake config and rejects process-only fake fields", () => {
    expect(createOpenCodeAdapter({ kind: "fake" })).toBeInstanceOf(FakeOpenCodeAdapter)
    expect(() => createOpenCodeAdapter({ kind: "fake", command: "opencode" })).toThrow("process-only field: command")
  })

  test("factory creates ProcessOpenCodeAdapter for process config without spawning", () => {
    let spawnCalls = 0
    const adapter = createOpenCodeAdapter(
      { kind: "process", command: "opencode", args: ["--stdio"], cwd: "/tmp/demo", spawnTimeoutMs: 1000, writeTimeoutMs: 1000, shutdownTimeoutMs: 5000 },
      {
        spawn: () => {
          spawnCalls += 1
          return new FakeSpawnedProcess()
        },
      },
    )

    expect(adapter).toBeInstanceOf(ProcessOpenCodeAdapter)
    expect(spawnCalls).toBe(0)
  })

  test("process config validates blank command args env and timeouts", () => {
    expect(() => validateOpenCodeAdapterConfig({ kind: "process", command: "" })).toThrow("command must be a nonblank string")
    expect(() => validateOpenCodeAdapterConfig({ kind: "process", command: "opencode", args: ["--stdio", 7] as unknown as string[] })).toThrow("args must be an array of strings")
    expect(() => validateOpenCodeAdapterConfig({ kind: "process", command: "opencode", env: { NXL_TOKEN: 7 } as unknown as Record<string, string> })).toThrow("env keys and values must be strings")
    expect(() => validateOpenCodeAdapterConfig({ kind: "process", command: "opencode", spawnTimeoutMs: 0 })).toThrow("spawnTimeoutMs must be a positive integer")
    expect(() => validateOpenCodeAdapterConfig({ kind: "process", command: "opencode", writeTimeoutMs: 1.5 })).toThrow("writeTimeoutMs must be a positive integer")
    expect(() => validateOpenCodeAdapterConfig({ kind: "process", command: "opencode", shutdownTimeoutMs: -1 })).toThrow("shutdownTimeoutMs must be a positive integer")
  })

  test("RuntimeServer with process config and fake spawn starts writes session contract and registers tool handler", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const process = new FakeSpawnedProcess()
    const server = new RuntimeServer({
      projectDir: dir,
      openCodeAdapterConfig: { kind: "process", command: "opencode", args: ["--stdio"] },
      openCodeAdapterFactoryOptions: { spawn: () => process },
    })

    await server.start()
    expect(process.stdinWrites).toHaveLength(1)
    expect(sessionContractFromWrite(process)).toMatchObject({
      allowedToolNames: [...MISSION_TOOL_NAMES],
      inputEnvelopeTypes: ["nxl.session_start", "nxl.mission_packet", "nxl.executor_tool_result"],
    })

    process.stdout.emitData(`${JSON.stringify({ type: "nxl.executor_tool_call", call_id: "call_registered", tool: "mission.list_recent", payload: { limit: 1 } })}\n`)
    expect(await waitForToolResult(process)).toMatchObject({
      type: "nxl.executor_tool_result",
      call_id: "call_registered",
      tool: "mission.list_recent",
      ok: true,
      result: [],
    })

    const shutdown = server.shutdown()
    process.emitExit(0, null)
    await shutdown
  })

  test("RuntimeServer with process config can submit a message and write mission packet", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const process = new FakeSpawnedProcess()
    const server = new RuntimeServer({
      projectDir: dir,
      openCodeAdapterConfig: { kind: "process", command: "opencode" },
      openCodeAdapterFactoryOptions: { spawn: () => process },
    })

    await server.start()
    const result = await server.submitUserMessage("configured transport message")
    const missionEnvelope = await waitForJsonlWrite(process, "nxl.mission_packet")

    expect(missionEnvelope).toMatchObject({ type: "nxl.mission_packet", missionId: result.missionId, intentId: result.intentId, message: "configured transport message" })
    expect(await server.getMission(result.missionId)).toMatchObject({ status: "sent" })

    const shutdown = server.shutdown()
    process.emitExit(0, null)
    await shutdown
  })

  test("config and status redacts secret-looking command env and args values", async () => {
    const config = {
      kind: "process" as const,
      command: "/tmp/token=command-secret/opencode",
      args: ["--api-key=arg-secret", "--stdio"],
      env: { NXL_TOKEN: "env-secret", SAFE: "value" },
    }
    const redactedConfig = redactOpenCodeAdapterConfig(config)

    expect(JSON.stringify(redactedConfig)).toContain("[REDACTED]")
    expect(JSON.stringify(redactedConfig)).not.toContain("command-secret")
    expect(JSON.stringify(redactedConfig)).not.toContain("arg-secret")
    expect(JSON.stringify(redactedConfig)).not.toContain("env-secret")

    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const process = new FakeSpawnedProcess()
    const server = new RuntimeServer({
      projectDir: dir,
      openCodeAdapterConfig: config,
      openCodeAdapterFactoryOptions: { spawn: () => process },
    })
    await server.start()
    const statusAndEvents = JSON.stringify({ status: await server.status(), events: server.eventBus.snapshot() })

    expect(statusAndEvents).not.toContain("command-secret")
    expect(statusAndEvents).not.toContain("arg-secret")
    expect(statusAndEvents).not.toContain("env-secret")
    const shutdown = server.shutdown()
    process.emitExit(0, null)
    await shutdown
  })

  test("env parser works for valid fake and process configs", () => {
    expect(readOpenCodeAdapterConfigFromEnv({ NXL_OPENCODE_ADAPTER: "fake" })).toEqual({ kind: "fake" })
    expect(readOpenCodeAdapterConfigFromEnv({
      NXL_OPENCODE_ADAPTER: "process",
      NXL_OPENCODE_COMMAND: "opencode",
      NXL_OPENCODE_ARGS_JSON: "[\"--stdio\"]",
      NXL_OPENCODE_SPAWN_TIMEOUT_MS: "1000",
      NXL_OPENCODE_WRITE_TIMEOUT_MS: "1001",
      NXL_OPENCODE_SHUTDOWN_TIMEOUT_MS: "5000",
    })).toEqual({
      kind: "process",
      command: "opencode",
      args: ["--stdio"],
      cwd: undefined,
      env: undefined,
      spawnTimeoutMs: 1000,
      writeTimeoutMs: 1001,
      shutdownTimeoutMs: 5000,
    })
  })

  test("env parser fails clearly for invalid kind invalid args JSON and bad timeouts", () => {
    expect(() => readOpenCodeAdapterConfigFromEnv({ NXL_OPENCODE_ADAPTER: "real" })).toThrow("unknown OpenCode adapter kind")
    expect(() => readOpenCodeAdapterConfigFromEnv({ NXL_OPENCODE_ADAPTER: "process", NXL_OPENCODE_COMMAND: "opencode", NXL_OPENCODE_ARGS_JSON: "not-json" })).toThrow("NXL_OPENCODE_ARGS_JSON must be valid JSON")
    expect(() => readOpenCodeAdapterConfigFromEnv({ NXL_OPENCODE_ADAPTER: "process", NXL_OPENCODE_COMMAND: "opencode", NXL_OPENCODE_WRITE_TIMEOUT_MS: "0" })).toThrow("NXL_OPENCODE_WRITE_TIMEOUT_MS must be a positive integer")
  })
})

describe("RuntimeServer launch OpenCode env wiring", () => {
  test("no env config preserves fake default launch behavior", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = createRuntimeServerFromLaunchConfig({ projectDir: dir, env: {} })

    expect(server.adapter).toBeInstanceOf(FakeOpenCodeAdapter)
    await server.start()
    expect(await server.status()).toMatchObject({ adapterStatus: { adapter: "fake", phase: "started" } })
    await server.shutdown()
  })

  test("env fake explicitly selects fake adapter", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const options = readRuntimeServerLaunchOptionsFromEnv({ NXL_OPENCODE_ADAPTER: "fake" }, { projectDir: dir })
    const server = createRuntimeServerFromLaunchConfig({ ...options })

    expect(options.openCodeAdapterConfig).toEqual({ kind: "fake" })
    expect(server.adapter).toBeInstanceOf(FakeOpenCodeAdapter)
    await server.start()
    expect(await server.status()).toMatchObject({ adapterStatus: { adapter: "fake", phase: "started" } })
    await server.shutdown()
  })

  test("env process config with fake spawn creates process adapter through launch wiring", () => {
    const process = new FakeSpawnedProcess()
    let spawnCalls = 0
    const server = createRuntimeServerFromLaunchConfig({
      projectDir: "/tmp/demo",
      env: {
        NXL_OPENCODE_ADAPTER: "process",
        NXL_OPENCODE_COMMAND: "opencode",
        NXL_OPENCODE_ARGS_JSON: "[\"--stdio\"]",
      },
      openCodeAdapterFactoryOptions: {
        spawn: () => {
          spawnCalls += 1
          return process
        },
      },
    })

    expect(server.adapter).toBeInstanceOf(ProcessOpenCodeAdapter)
    expect(spawnCalls).toBe(0)
  })

  test("env external API config and credentials are wired through launch boundary", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const transport = new FakeExternalApiTransport([{ status_code: 200, body: "{\"ok\":true}" }])
    const server = createRuntimeServerFromLaunchConfig({
      projectDir: dir,
      mode: "active",
      env: {
        NXL_EXTERNAL_API_CONNECTORS_JSON: JSON.stringify([{
          connector_id: "env-api",
          title: "Env API",
          base_url: "https://api.example.test",
          allowed_hosts: ["api.example.test"],
          allowed_methods: ["GET"],
          credential_refs: [{ name: "env-key", source: "env", env_name: "NXL_ENV_API_KEY", inject_as: "header", target_name: "Authorization", prefix: "Bearer " }],
          timeout_ms: 5000,
          max_response_bytes: 4096,
          created_at: "1970-01-01T00:00:00.000Z",
          updated_at: "1970-01-01T00:00:00.000Z",
        }]),
        NXL_ENV_API_KEY: "raw-env-launch-secret",
      },
      externalApiTransport: transport,
    })

    expect(await server.command("runtime.list_external_api_connectors")).toContainEqual(expect.objectContaining({ connector_id: "env-api" }))
    const preview = await server.command("runtime.preview_external_api_request", {
      connectorId: "env-api",
      method: "GET",
      path: "/status",
      requestedBy: "operator",
    }) as { allowed: boolean; redacted_headers: Record<string, string> }
    expect(preview).toMatchObject({ allowed: true, redacted_headers: { Authorization: "[REDACTED]" } })

    await server.start()
    await server.command("runtime.execute_external_api_request", {
      connectorId: "env-api",
      method: "GET",
      path: "/status",
      requestedBy: "operator",
    })
    expect(transport.requests[0].headers.Authorization).toBe("Bearer raw-env-launch-secret")
    expect(JSON.stringify(await server.command("runtime.list_external_api_audit"))).not.toContain("raw-env-launch-secret")
    await server.shutdown()
  })

  test("env process config starts runtime with fake spawn and writes session start", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const process = new FakeSpawnedProcess()
    const server = createRuntimeServerFromLaunchConfig({
      projectDir: dir,
      env: {
        NXL_OPENCODE_ADAPTER: "process",
        NXL_OPENCODE_COMMAND: "opencode",
        NXL_OPENCODE_ARGS_JSON: "[\"--stdio\"]",
      },
      openCodeAdapterFactoryOptions: { spawn: () => process },
    })

    await server.start()
    expect(await waitForJsonlWrite(process, "nxl.session_start")).toMatchObject({
      type: "nxl.session_start",
      protocolVersion: 1,
    })
    expect(sessionContractFromWrite(process)).toMatchObject({
      inputEnvelopeTypes: ["nxl.session_start", "nxl.mission_packet", "nxl.executor_tool_result"],
    })

    const shutdown = server.shutdown()
    process.emitExit(0, null)
    await shutdown
  })

  test("env process config allows submitUserMessage and writes mission packet", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const process = new FakeSpawnedProcess()
    const server = createRuntimeServerFromLaunchConfig({
      projectDir: dir,
      env: {
        NXL_OPENCODE_ADAPTER: "process",
        NXL_OPENCODE_COMMAND: "opencode",
      },
      openCodeAdapterFactoryOptions: { spawn: () => process },
    })

    await server.start()
    const result = await server.submitUserMessage("env launch message")
    expect(await waitForJsonlWrite(process, "nxl.mission_packet")).toMatchObject({
      type: "nxl.mission_packet",
      missionId: result.missionId,
      intentId: result.intentId,
      message: "env launch message",
    })

    const shutdown = server.shutdown()
    process.emitExit(0, null)
    await shutdown
  })

  test("invalid env adapter kind fails clearly before runtime start", () => {
    expect(() => createRuntimeServerFromLaunchConfig({
      projectDir: "/tmp/demo",
      env: { NXL_OPENCODE_ADAPTER: "real" },
    })).toThrow("unknown OpenCode adapter kind")
  })

  test("invalid env args JSON fails clearly before runtime start", () => {
    expect(() => createRuntimeServerFromLaunchConfig({
      projectDir: "/tmp/demo",
      env: {
        NXL_OPENCODE_ADAPTER: "process",
        NXL_OPENCODE_COMMAND: "opencode",
        NXL_OPENCODE_ARGS_JSON: "not-json",
      },
    })).toThrow("NXL_OPENCODE_ARGS_JSON must be valid JSON")
  })

  test("invalid env timeout fails clearly before runtime start", () => {
    expect(() => createRuntimeServerFromLaunchConfig({
      projectDir: "/tmp/demo",
      env: {
        NXL_OPENCODE_ADAPTER: "process",
        NXL_OPENCODE_COMMAND: "opencode",
        NXL_OPENCODE_WRITE_TIMEOUT_MS: "0",
      },
    })).toThrow("NXL_OPENCODE_WRITE_TIMEOUT_MS must be a positive integer")
  })

  test("secret-looking env launch values do not leak into runtime status events or errors", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const process = new FakeSpawnedProcess()
    const server = createRuntimeServerFromLaunchConfig({
      projectDir: dir,
      env: {
        NXL_OPENCODE_ADAPTER: "process",
        NXL_OPENCODE_COMMAND: "/tmp/token=command-secret/opencode",
        NXL_OPENCODE_ARGS_JSON: "[\"--api-key=arg-secret\",\"--stdio\"]",
        NXL_TOKEN: "env-secret",
      },
      openCodeAdapterFactoryOptions: { spawn: () => process },
    })

    await server.start()
    const serialized = JSON.stringify({ status: await server.status(), events: server.eventBus.snapshot() })
    expect(serialized).not.toContain("command-secret")
    expect(serialized).not.toContain("arg-secret")
    expect(serialized).not.toContain("env-secret")

    const shutdown = server.shutdown()
    process.emitExit(0, null)
    await shutdown
  })

  test("direct adapter injection still takes precedence over env launch config", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const adapter = new LongLivedAdapter()
    const server = createRuntimeServerFromLaunchConfig({
      projectDir: dir,
      adapter,
      env: {
        NXL_OPENCODE_ADAPTER: "process",
        NXL_OPENCODE_COMMAND: "",
      },
    })

    expect(server.adapter).toBe(adapter)
    await server.start()
    expect(adapter.startCalls).toBe(1)
    await server.shutdown()
  })
})

describe("RuntimeServerClient", () => {
  test("delegates runtime.status", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter() })
    const client = new RuntimeServerClient({ server, autoStart: true, ownsServer: true })

    const status = await client.command("runtime.status")
    expect(status).toMatchObject({ runtimeStatus: "started", lockHeld: true })
    await client.shutdown()
  })

  test("delegates runtime.submit_user_message command and submitUserMessage", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const adapter = new LongLivedAdapter()
    const client = new RuntimeServerClient({
      server: new RuntimeServer({ projectDir: dir, adapter }),
      autoStart: true,
      ownsServer: true,
    })

    const commandResult = await client.command("runtime.submit_user_message", { message: "from command" })
    const submitResult = await client.submitUserMessage("from method")

    expect(commandResult).toMatchObject({ accepted: true, missionId: expect.any(String), intentId: expect.any(String) })
    expect(submitResult).toMatchObject({ accepted: true, missionId: expect.any(String), intentId: expect.any(String) })
    expect(adapter.packets.map((packet) => packet.message)).toEqual(["from command", "from method"])
    await client.shutdown()
  })

  test("streams runtime events from RuntimeServer", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const client = new RuntimeServerClient({
      server: new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter() }),
      autoStart: true,
      ownsServer: true,
    })
    const iterator = client.stream()[Symbol.asyncIterator]()

    const events: RuntimeEvent[] = []
    for (let index = 0; index < 5; index += 1) {
      const next = await Promise.race([
        iterator.next(),
        timeout(NON_BLOCKING_START_TIMEOUT_MS).then(() => {
          throw new Error("timed out waiting for client stream event")
        }),
      ])
      if (next.done) break
      events.push(next.value)
      if (next.value.type === "RuntimeReady") break
    }

    expect(events.map((event) => event.type)).toContain("RuntimeReady")
    await iterator.return?.()
    await client.shutdown()
  })

  test("auto-start stream does not replay queued startup events after synthetic boot state", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const client = new RuntimeServerClient({
      server: new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter() }),
      autoStart: true,
      ownsServer: true,
    })
    const iterator = client.stream()[Symbol.asyncIterator]()

    const events: RuntimeEvent[] = []
    for (let index = 0; index < 2; index += 1) {
      const next = await Promise.race([
        iterator.next(),
        timeout(NON_BLOCKING_START_TIMEOUT_MS).then(() => {
          throw new Error("timed out waiting for client stream startup event")
        }),
      ])
      expect(next.done).toBe(false)
      events.push(next.value)
    }

    expect(events.map((event) => event.type)).toEqual(["RuntimeReady", "ProjectInitialized"])
    const nextEvent = iterator.next()
    await client.command("runtime.resume")
    const possibleQueuedDuplicate = await Promise.race([
      nextEvent.then((next) => next.value?.type ?? "done"),
      timeout(NON_BLOCKING_START_TIMEOUT_MS).then(() => {
        throw new Error("timed out waiting for client stream post-start event")
      }),
    ])
    expect(possibleQueuedDuplicate).toBe("ResumeSummaryLoaded")

    await iterator.return?.()
    await client.shutdown()
  })

  test("auto-start serializes concurrent commands and starts once", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const adapter = new LongLivedAdapter()
    const client = new RuntimeServerClient({
      server: new RuntimeServer({ projectDir: dir, adapter }),
      autoStart: true,
      ownsServer: true,
    })

    const [first, second] = await Promise.all([
      client.command("runtime.status"),
      client.command("runtime.status"),
    ])

    expect(first).toMatchObject({ runtimeStatus: "started" })
    expect(second).toMatchObject({ runtimeStatus: "started" })
    expect(adapter.startCalls).toBe(1)
    await client.shutdown()
  })

  test("auto-start serializes concurrent clients sharing one server", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const adapter = new LongLivedAdapter()
    const server = new RuntimeServer({ projectDir: dir, adapter })
    const firstClient = new RuntimeServerClient({ server, autoStart: true, ownsServer: false })
    const secondClient = new RuntimeServerClient({ server, autoStart: true, ownsServer: false })

    const [first, second] = await Promise.all([
      firstClient.command("runtime.status"),
      secondClient.command("runtime.status"),
    ])

    expect(first).toMatchObject({ runtimeStatus: "started" })
    expect(second).toMatchObject({ runtimeStatus: "started" })
    expect(adapter.startCalls).toBe(1)
    await firstClient.shutdown({ force: true })
  })

  test("auto-start rechecks shared server state after another client shuts it down", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const adapter = new LongLivedAdapter()
    const server = new RuntimeServer({ projectDir: dir, adapter })
    const owner = new RuntimeServerClient({ server, autoStart: true, ownsServer: false })
    const attached = new RuntimeServerClient({ server, autoStart: true, ownsServer: false })

    await expect(owner.command("runtime.status")).resolves.toMatchObject({ runtimeStatus: "started" })
    await expect(attached.command("runtime.status")).resolves.toMatchObject({ runtimeStatus: "started" })

    await owner.shutdown({ force: true })

    await expect(attached.command("runtime.status")).resolves.toMatchObject({ runtimeStatus: "started" })
    expect(adapter.startCalls).toBe(2)
    await attached.shutdown({ force: true })
  })

  test("auto-start attaches to an already-started server without restarting", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const adapter = new LongLivedAdapter()
    const server = new RuntimeServer({ projectDir: dir, adapter })
    await server.start()
    const client = new RuntimeServerClient({ server, autoStart: true, ownsServer: false })

    await expect(client.command("runtime.status")).resolves.toMatchObject({ runtimeStatus: "started", lockHeld: true })

    expect(adapter.startCalls).toBe(1)
    await client.shutdown({ force: true })
  })

  test("stream attached to an already-started server yields current boot state", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter() })
    await server.start()
    const client = new RuntimeServerClient({ server, autoStart: true, ownsServer: false })
    const iterator = client.stream()[Symbol.asyncIterator]()

    const first = await iterator.next()
    const second = await iterator.next()

    expect(first.value).toMatchObject({ type: "RuntimeReady", runtimeStatus: "started" })
    expect(second.value).toMatchObject({ type: "ProjectInitialized", projectDir: dir })

    await iterator.return?.()
    await client.shutdown({ force: true })
  })

  test("stream attached to an already-started status-mode server yields initialized state", async () => {
    const dir = await tempProject()
    await makeProject(dir)
    const server = new RuntimeServer({ projectDir: dir, mode: "status", adapter: new LongLivedAdapter() })
    await server.start()
    const client = new RuntimeServerClient({ server, autoStart: true, ownsServer: false })
    const iterator = client.stream()[Symbol.asyncIterator]()

    const first = await iterator.next()
    const second = await iterator.next()

    expect(first.value).toMatchObject({ type: "RuntimeReady", runtimeStatus: "started" })
    expect(second.value).toMatchObject({ type: "ProjectInitialized", projectDir: dir })

    await iterator.return?.()
    await client.shutdown({ force: true })
  })

  test("runtime.shutdown command resets auto-start state", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const adapter = new LongLivedAdapter()
    const client = new RuntimeServerClient({
      server: new RuntimeServer({ projectDir: dir, adapter }),
      autoStart: true,
      ownsServer: true,
    })

    await expect(client.command("runtime.status")).resolves.toMatchObject({ runtimeStatus: "started" })
    await client.command("runtime.shutdown", { reason: "test command" })
    await expect(client.command("runtime.status")).resolves.toMatchObject({ runtimeStatus: "started" })

    expect(adapter.startCalls).toBe(2)
    await client.shutdown()
  })

  test("runtime.shutdown command does not auto-start an unstarted server", async () => {
    const dir = await tempProject()
    await makeProject(dir)
    const adapter = new LongLivedAdapter()
    const client = new RuntimeServerClient({
      server: new RuntimeServer({ projectDir: dir, adapter }),
      autoStart: true,
      ownsServer: true,
    })

    await expect(client.command("runtime.shutdown", { reason: "pre-start cleanup" })).resolves.toBeUndefined()

    expect(adapter.startCalls).toBe(0)
    await expect(client.command("runtime.status")).rejects.toThrow("approved spec")
  })

  test("shutdown is idempotent for owned server", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const client = new RuntimeServerClient({
      server: new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter() }),
      autoStart: true,
      ownsServer: true,
    })

    await client.command("runtime.status")
    await client.shutdown()
    await client.shutdown()
    expect(await client.server.status()).toMatchObject({ lockHeld: false, runtimeStatus: "created" })
  })

  test("owned client rejects command and submit after shutdown", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const client = new RuntimeServerClient({
      server: new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter() }),
      autoStart: true,
      ownsServer: true,
    })

    await client.command("runtime.status")
    await client.shutdown()

    await expect(client.command("runtime.status")).rejects.toThrow("runtime client has been shut down")
    await expect(client.submitUserMessage("after shutdown")).rejects.toThrow("runtime client has been shut down")
  })

  test("caller-owned server is not shut down unless forced", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter() })
    await server.start()
    const client = new RuntimeServerClient({ server, ownsServer: false })

    await client.shutdown()
    expect(await server.status()).toMatchObject({ lockHeld: true, runtimeStatus: "started" })
    await client.shutdown({ force: true })
    expect(await server.status()).toMatchObject({ lockHeld: false, runtimeStatus: "created" })
  })

  test("errors from RuntimeServer propagate clearly and redacted", async () => {
    const dir = await tempProject()
    await makeProject(dir, { draftSpec: true })
    const client = new RuntimeServerClient({
      server: new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter() }),
      autoStart: true,
      ownsServer: true,
    })

    await expect(client.command("runtime.status")).rejects.toThrow("approved spec required")
  })
})

describe("OpenCode session contract", () => {
  test("includes all supported mission tool names", () => {
    const contract = buildOpenCodeSessionContract({ projectDir: "/tmp/demo", objective: "demo objective" })

    expect(contract.allowedToolNames).toEqual([...MISSION_TOOL_NAMES])
  })

  test("describes JSONL input and output envelope types", () => {
    const contract = buildOpenCodeSessionContract({ projectDir: "/tmp/demo", objective: "demo objective" })

    expect(contract.inputEnvelopeTypes).toEqual(["nxl.session_start", "nxl.mission_packet", "nxl.executor_tool_result"])
    expect(contract.outputEnvelopeTypes).toEqual(["nxl.executor_tool_call"])
    expect(contract.prompt).toContain("one JSON object per line")
    expect(contract.prompt).toContain("nxl.session_start")
    expect(contract.prompt).toContain("nxl.mission_packet")
    expect(contract.prompt).toContain("nxl.executor_tool_result")
    expect(contract.prompt).toContain("nxl.executor_tool_call")
  })

  test("states RuntimeServer and MissionRegistry own mission authority", () => {
    const contract = buildOpenCodeSessionContract({ projectDir: "/tmp/demo", objective: "demo objective" })

    expect(contract.prompt).toContain("Do not invent mission state")
    expect(contract.prompt).toContain("Mission authority belongs to RuntimeServer/MissionRegistry")
  })

  test("states child prose stdout is diagnostic only", () => {
    const contract = buildOpenCodeSessionContract({ projectDir: "/tmp/demo", objective: "demo objective" })

    expect(contract.prompt).toContain("Child prose/stdout is diagnostic only")
    expect(contract.prompt).toContain("not authoritative")
  })

  test("states mission completion flow", () => {
    const contract = buildOpenCodeSessionContract({ projectDir: "/tmp/demo", objective: "demo objective" })

    expect(contract.prompt).toContain("mission.claim -> mission.record_progress/mission.submit_result -> mission.complete")
    expect(contract.prompt).toContain("Use mission.record_progress")
    expect(contract.prompt).toContain("mission.submit_result")
    expect(contract.prompt).toContain("Use mission.fail")
    expect(contract.prompt).toContain("Use mission.cancel")
    expect(contract.prompt).toContain("Unknown tools are invalid")
  })

  test("is deterministic under fixed inputs", () => {
    const input = { projectDir: "/tmp/demo", objective: "demo objective" }

    expect(buildOpenCodeSessionContract(input)).toEqual(buildOpenCodeSessionContract(input))
  })

  test("redacts secret-looking values from contract and prompt", () => {
    const contract = buildOpenCodeSessionContract({
      projectDir: "/tmp/token=project-secret",
      objective: "handle token=objective-secret password=objective-password",
    })
    const serialized = JSON.stringify(contract)

    expect(serialized).toContain("[REDACTED]")
    expect(serialized).not.toContain("project-secret")
    expect(serialized).not.toContain("objective-secret")
    expect(serialized).not.toContain("objective-password")
  })
})

describe("ProcessOpenCodeAdapter", () => {
  test("starts with fake spawn and emits lifecycle start event with session contract", async () => {
    const process = new FakeSpawnedProcess(1234)
    const adapter = new ProcessOpenCodeAdapter({
      command: "opencode",
      cwd: "/tmp/demo",
      spawn: () => process,
    })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test objective" })

    const events = await readProcessEvents(adapter, 1)
    const session = JSON.parse(process.stdinWrites[0] ?? "{}") as Record<string, unknown>

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: "ExecutorLifecycle", phase: "process-started" })
    expect(events[0]?.type === "ExecutorLifecycle" ? events[0].message : "").toContain("pid 1234")
    expect(process.stdinWrites).toHaveLength(1)
    expect(process.stdinWrites[0]?.endsWith("\n")).toBe(true)
    expect(session).toMatchObject({
      type: "nxl.session_start",
      projectDir: "/tmp/demo",
      objective: "test objective",
      protocolVersion: 1,
      createdAt: expect.any(String),
    })
    expect(session.contract).toMatchObject({
      protocolVersion: 1,
      projectDir: "/tmp/demo",
      objective: "test objective",
      allowedToolNames: [...MISSION_TOOL_NAMES],
      inputEnvelopeTypes: ["nxl.session_start", "nxl.mission_packet", "nxl.executor_tool_result"],
      outputEnvelopeTypes: ["nxl.executor_tool_call"],
    })
    expect(((session.contract as Record<string, unknown>).prompt as string)).toContain("Mission authority belongs to RuntimeServer/MissionRegistry")
    await expect(adapter.getStatus()).resolves.toMatchObject({ adapter: "process", phase: "running", pid: 1234, command: "opencode", transport: "jsonl", sessionStarted: true })
  })

  test("session bootstrap contract redacts secrets while transport objective remains original", async () => {
    const process = new FakeSpawnedProcess(1234)
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/token=project-secret", spawn: () => process })

    await adapter.startSession({ projectDir: "/tmp/token=project-secret", objective: "run token=objective-secret" })
    const session = JSON.parse(process.stdinWrites[0] ?? "{}") as Record<string, unknown>
    const contract = session.contract as Record<string, unknown>
    const events = await readProcessEvents(adapter, 1)
    const status = await adapter.getStatus()

    expect(session).toMatchObject({ type: "nxl.session_start", objective: "run token=objective-secret" })
    expect(JSON.stringify(contract)).toContain("[REDACTED]")
    expect(JSON.stringify(contract)).not.toContain("project-secret")
    expect(JSON.stringify(contract)).not.toContain("objective-secret")
    expect(JSON.stringify({ events, status })).not.toContain("project-secret")
    expect(JSON.stringify({ events, status })).not.toContain("objective-secret")
  })

  test("session bootstrap write failure rejects startSession and records redacted status", async () => {
    const process = new FakeSpawnedProcess(4242, { stdinWriteError: new Error("stdin failed token=session-secret") })
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => process })

    await expect(adapter.startSession({ projectDir: "/tmp/demo", objective: "secret=objective-secret" })).rejects.toThrow("OpenCode session bootstrap failed: OpenCode session bootstrap write failed: stdin failed [REDACTED]")
    const status = await adapter.getStatus()

    expect(process.stdinEnded).toBe(true)
    expect(process.killedWith).toBe("SIGTERM")
    expect(status).toMatchObject({
      adapter: "process",
      phase: "failed",
      pid: undefined,
      sessionStarted: false,
      lastWriteError: "OpenCode session bootstrap write failed: stdin failed [REDACTED]",
      lastError: "OpenCode session bootstrap failed: OpenCode session bootstrap write failed: stdin failed [REDACTED]",
    })
    expect(JSON.stringify(status)).not.toContain("session-secret")
    expect(JSON.stringify(status)).not.toContain("objective-secret")
  })

  test("session bootstrap async write failure rejects startSession before readiness", async () => {
    const process = new FakeSpawnedProcess(4242, { stdinAsyncWriteError: new Error("async stdin failed token=session-async-secret") })
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => process })

    await expect(adapter.startSession({ projectDir: "/tmp/demo", objective: "secret=async-objective-secret" })).rejects.toThrow("OpenCode session bootstrap failed: OpenCode session bootstrap write failed: async stdin failed [REDACTED]")
    const status = await adapter.getStatus()

    expect(status).toMatchObject({ phase: "failed", sessionStarted: false, lastWriteError: "OpenCode session bootstrap write failed: async stdin failed [REDACTED]" })
    expect(JSON.stringify(status)).not.toContain("session-async-secret")
    expect(JSON.stringify(status)).not.toContain("async-objective-secret")
  })

  test("session bootstrap stdin error after write callback rejects startSession before readiness", async () => {
    const process = new FakeSpawnedProcess(4242, { stdinErrorAfterAck: new Error("EPIPE token=session-epipe-secret") })
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => process })

    await expect(adapter.startSession({ projectDir: "/tmp/demo", objective: "secret=session-epipe-objective" })).rejects.toThrow("OpenCode session bootstrap failed: OpenCode session bootstrap write failed: EPIPE [REDACTED]")
    const status = await adapter.getStatus()

    expect(status).toMatchObject({ phase: "failed", sessionStarted: false, lastWriteError: "OpenCode session bootstrap write failed: EPIPE [REDACTED]" })
    expect(JSON.stringify(status)).not.toContain("session-epipe-secret")
    expect(JSON.stringify(status)).not.toContain("session-epipe-objective")
  })

  test("session bootstrap write acknowledgement timeout rejects startSession", async () => {
    const process = new FakeSpawnedProcess(4242, { neverAckStdinWrite: true })
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", writeTimeoutMs: 1, spawn: () => process })

    await expect(adapter.startSession({ projectDir: "/tmp/demo", objective: "secret=timeout-objective-secret" })).rejects.toThrow("OpenCode session bootstrap failed: OpenCode session bootstrap write failed: timed out after 1ms")
    const status = await adapter.getStatus()

    expect(status).toMatchObject({ phase: "failed", sessionStarted: false, lastWriteError: "OpenCode session bootstrap write failed: timed out after 1ms" })
    expect(JSON.stringify(status)).not.toContain("timeout-objective-secret")
  })

  test("session bootstrap rejects if child exits before write acknowledgement completes", async () => {
    const process = new FakeSpawnedProcess(4242)
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => process })
    process.onStdinWriteBeforeAck = () => process.emitExit(7, null)

    await expect(adapter.startSession({ projectDir: "/tmp/demo", objective: "secret=exit-during-bootstrap-objective" })).rejects.toThrow("OpenCode session bootstrap failed: OpenCode process exited with code 7")
    const status = await adapter.getStatus()

    expect(status).toMatchObject({ phase: "failed", pid: undefined, sessionStarted: false, lastError: "OpenCode session bootstrap failed: OpenCode process exited with code 7" })
    expect(JSON.stringify(status)).not.toContain("exit-during-bootstrap-objective")
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
    await expect(adapter.getStatus()).resolves.toMatchObject({ phase: "shutdown", sessionStarted: false })
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
    await expect(adapter.getStatus()).resolves.toMatchObject({ phase: "shutdown", sessionStarted: false })
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
    expect(status).toMatchObject({ phase: "exited", sessionStarted: false, lastError: "OpenCode process exited unexpectedly with code 7" })
  })

  test("streamExecutorEvents drains only new events", async () => {
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => process })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    const first = await readProcessEvents(adapter, 1)

    process.stdout.emitData("hello\n")
    const second = await readProcessEvents(adapter, 1)

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    expect(second[0]).toMatchObject({ type: "ExecutorLifecycle", phase: "process-stdout", message: "hello" })
  })

  test("streamExecutorEvents compacts drained process events", async () => {
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => process })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    process.stdout.emitData("one\n")
    process.stderr.emitData("two")
    await readProcessEvents(adapter, 3)

    expect((adapter as unknown as { events: RuntimeEvent[] }).events).toHaveLength(0)

    process.stdout.emitData("three\n")
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

    const result = await waitForToolResult(process)
    expect(calls).toEqual([{ type: "nxl.executor_tool_call", call_id: "call_1", tool: "mission.get", payload: { mission_id: "mission_1" } }])
    expect(result).toEqual({
      type: "nxl.executor_tool_result",
      call_id: "call_1",
      tool: "mission.get",
      ok: true,
      result: { mission_id: "mission_1" },
      created_at: "2026-05-13T00:00:00.000Z",
    })
  })

  test("parses split executor tool-call JSONL exactly once", async () => {
    const process = new FakeSpawnedProcess()
    const calls: unknown[] = []
    const line = JSON.stringify({ type: "nxl.executor_tool_call", call_id: "call_split", tool: "mission.get", payload: { mission_id: "mission_split" } })
    const adapter = new ProcessOpenCodeAdapter({
      command: "opencode",
      cwd: "/tmp/demo",
      spawn: () => process,
      toolHandler: async (call) => {
        calls.push(call)
        return { call_id: call.call_id, tool: call.tool, ok: true, result: { handled: true }, created_at: "2026-05-13T00:00:00.000Z" }
      },
    })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    process.stdout.emitData(line.slice(0, 17))
    await timeout(20)
    expect(process.stdinWrites).toHaveLength(1)
    process.stdout.emitData(line.slice(17, 58))
    process.stdout.emitData(`${line.slice(58)}\n`)

    const result = await waitForToolResult(process)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ call_id: "call_split", tool: "mission.get", payload: { mission_id: "mission_split" } })
    expect(process.stdinWrites).toHaveLength(2)
    expect(result).toMatchObject({ type: "nxl.executor_tool_result", call_id: "call_split", ok: true })
  })

  test("buffers split non-tool stdout until line completion and emits it once", async () => {
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => process })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    await readProcessEvents(adapter, 1)
    process.stdout.emitData("split ")
    await timeout(20)
    expect((adapter as unknown as { events: RuntimeEvent[] }).events).toHaveLength(0)
    process.stdout.emitData("stdout\n")

    expect(await readProcessEvents(adapter, 1)).toEqual([{ type: "ExecutorLifecycle", phase: "process-stdout", message: "split stdout" }])
  })

  test("malformed split JSON stdout does not crash adapter", async () => {
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => process })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    await readProcessEvents(adapter, 1)
    process.stdout.emitData("{bad")
    await timeout(20)
    expect((adapter as unknown as { events: RuntimeEvent[] }).events).toHaveLength(0)
    process.stdout.emitData("-json\n")

    expect(await readProcessEvents(adapter, 1)).toEqual([{ type: "ExecutorLifecycle", phase: "process-stdout", message: "{bad-json" }])
    await expect(adapter.getStatus()).resolves.toMatchObject({ phase: "running" })
  })

  test("flushes final buffered tool-call line on child close without newline", async () => {
    const process = new FakeSpawnedProcess(4242, { autoClose: false })
    const adapter = new ProcessOpenCodeAdapter({
      command: "opencode",
      cwd: "/tmp/demo",
      spawn: () => process,
      toolHandler: async (call) => ({ call_id: call.call_id, tool: call.tool, ok: true, result: { closed: true }, created_at: "2026-05-13T00:00:00.000Z" }),
    })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    process.stdout.emitData(JSON.stringify({ type: "nxl.executor_tool_call", call_id: "call_close_flush", tool: "mission.get", payload: {} }))
    await timeout(20)
    expect(process.stdinWrites).toHaveLength(1)
    process.emitClose(0, null)

    expect(await waitForToolResult(process)).toMatchObject({
      type: "nxl.executor_tool_result",
      call_id: "call_close_flush",
      ok: true,
      result: { closed: true },
    })
  })

  test("ignores final buffered tool-call line after child exit", async () => {
    const process = new FakeSpawnedProcess()
    const calls: unknown[] = []
    const adapter = new ProcessOpenCodeAdapter({
      command: "opencode",
      cwd: "/tmp/demo",
      spawn: () => process,
      toolHandler: async (call) => {
        calls.push(call)
        return { call_id: call.call_id, tool: call.tool, ok: true, result: { exited: true }, created_at: "2026-05-13T00:00:00.000Z" }
      },
    })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    await readProcessEvents(adapter, 1)
    process.stdout.emitData(JSON.stringify({ type: "nxl.executor_tool_call", call_id: "call_after_exit", tool: "mission.get", payload: {} }))
    process.emitExit(0, null)

    const events = await readProcessEvents(adapter, 2)
    const status = await adapter.getStatus()

    expect(calls).toHaveLength(0)
    expect(process.stdinWrites).toHaveLength(1)
    expect(status).toMatchObject({ phase: "exited", lastError: "OpenCode process exited unexpectedly with code 0" })
    expect(events).toEqual([
      { type: "ExecutorLifecycle", phase: "process-exited", message: "OpenCode process exited unexpectedly with code 0" },
      { type: "ExecutorLifecycle", phase: "process-superseded-tool-call-ignored", message: "Ignored executor tool call from superseded process: call_after_exit mission.get" },
    ])
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
    await waitForToolResult(process)

    expect(process.stdinWrites).toHaveLength(2)
    const toolResultWrite = process.stdinWrites.find((line) => (JSON.parse(line) as Record<string, unknown>).type === "nxl.executor_tool_result") ?? ""
    expect(toolResultWrite.endsWith("\n")).toBe(true)
    expect(toolResultWrite.split("\n")).toHaveLength(2)
    expect(readToolResultLine(toolResultWrite)).toMatchObject({ type: "nxl.executor_tool_result", call_id: "call_single", ok: true })
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
    expect(process.stdinWrites).toHaveLength(1)
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

    const result = await waitForToolResult(process)

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

    expect(await waitForToolResult(process)).toMatchObject({
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
    const result = await waitForToolResult(process)
    process.stdout.emitData("after rejection\n")

    expect(result).toMatchObject({ type: "nxl.executor_tool_result", call_id: "call_reject", tool: "mission.get", ok: false })
    expect(JSON.stringify(result)).not.toContain("handler-secret")
    expect(await readProcessEvents(adapter, 1)).toEqual([{ type: "ExecutorLifecycle", phase: "process-stdout", message: "after rejection" }])
    await expect(adapter.getStatus()).resolves.toMatchObject({ phase: "running" })
  })

  test("stdin write failure emits lifecycle error and updates adapter status", async () => {
    const process = new FakeSpawnedProcess(4242)
    const adapter = new ProcessOpenCodeAdapter({
      command: "opencode",
      cwd: "/tmp/demo",
      spawn: () => process,
      toolHandler: async (call) => ({ call_id: call.call_id, tool: call.tool, ok: true, result: {}, created_at: "2026-05-13T00:00:00.000Z" }),
    })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    process.stdinWriteError = new Error("stdin failed token=stdin-secret")
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

    expect(await waitForToolResult(process)).toMatchObject({
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
    process.stdout.emitData("stdout token=stdout-secret\n")
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

  test("sendMissionPacket fails clearly when process is not running", async () => {
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => new FakeSpawnedProcess() })

    await expect(adapter.sendMissionPacket(testMissionPacket({ missionId: "m1" }))).rejects.toThrow("OpenCode mission packet write failed: OpenCode process is not running")
    await expect(adapter.getStatus()).resolves.toMatchObject({ phase: "failed", lastWriteError: "OpenCode mission packet write failed: OpenCode process is not running" })
  })

  test("sendMissionPacket writes one newline-terminated mission packet JSONL line", async () => {
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => process })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "session objective" })
    await adapter.sendMissionPacket(testMissionPacket({ missionId: "mission_1", intentId: "intent_1", message: "use token=payload-secret", objective: "use token=payload-secret", createdAt: "2026-05-10T12:34:56.000Z" }))
    const missionLine = process.stdinWrites[1] ?? ""
    const mission = JSON.parse(missionLine) as Record<string, unknown>
    const events = await readProcessEvents(adapter, 2)
    const status = await adapter.getStatus()

    expect(process.stdinWrites).toHaveLength(2)
    expect(missionLine.endsWith("\n")).toBe(true)
    expect(mission).toMatchObject({
      type: "nxl.mission_packet",
      missionId: "mission_1",
      intentId: "intent_1",
      message: "use token=payload-secret",
      objective: "use token=payload-secret",
      protocolVersion: 1,
      createdAt: "2026-05-10T12:34:56.000Z",
    })
    expect(events).toContainEqual({ type: "ExecutorLifecycle", phase: "process-mission-packet-sent", message: "OpenCode mission packet sent: mission_1" })
    expect(JSON.stringify({ events, status })).not.toContain("payload-secret")
  })

  test("sendMissionPacket fails when stdin is missing or non-writable", async () => {
    const missing = new FakeSpawnedProcess(4242)
    const missingAdapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => missing })
    await missingAdapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    missing.stdin = undefined
    await expect(missingAdapter.sendMissionPacket(testMissionPacket({ missionId: "m_missing" }))).rejects.toThrow("OpenCode mission packet write failed: child stdin is missing")

    const nonWritable = new FakeSpawnedProcess(4243)
    const nonWritableAdapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => nonWritable })
    await nonWritableAdapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    nonWritable.stdinWritable = false

    await expect(nonWritableAdapter.sendMissionPacket(testMissionPacket({ missionId: "m_non_writable" }))).rejects.toThrow("OpenCode mission packet write failed: child stdin is not writable")
    await expect(nonWritableAdapter.getStatus()).resolves.toMatchObject({ phase: "failed", lastWriteError: "OpenCode mission packet write failed: child stdin is not writable" })
  })

  test("sendMissionPacket fails when stdin.write throws and redacts lifecycle status", async () => {
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => process })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    await readProcessEvents(adapter, 1)
    process.stdinWriteError = new Error("write exploded token=write-secret")

    await expect(adapter.sendMissionPacket(testMissionPacket({ missionId: "m_throw", message: "secret=message-secret", objective: "secret=message-secret" }))).rejects.toThrow("OpenCode mission packet write failed: write exploded [REDACTED]")
    const events = await readProcessEvents(adapter, 1)
    const status = await adapter.getStatus()

    expect(events).toEqual([{ type: "ExecutorLifecycle", phase: "process-mission-packet-write-failed", message: "OpenCode mission packet write failed: write exploded [REDACTED]" }])
    expect(status).toMatchObject({ phase: "failed", lastWriteError: "OpenCode mission packet write failed: write exploded [REDACTED]" })
    expect(JSON.stringify({ events, status })).not.toContain("write-secret")
    expect(JSON.stringify({ events, status })).not.toContain("message-secret")
  })

  test("sendMissionPacket waits for async stdin write failure before reporting success", async () => {
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => process })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    await readProcessEvents(adapter, 1)
    process.stdinAsyncWriteError = new Error("async mission failed token=async-mission-secret")

    await expect(adapter.sendMissionPacket(testMissionPacket({ missionId: "m_async", message: "secret=async-message-secret", objective: "secret=async-message-secret" }))).rejects.toThrow("OpenCode mission packet write failed: async mission failed [REDACTED]")
    const events = await readProcessEvents(adapter, 1)
    const status = await adapter.getStatus()

    expect(events).toEqual([{ type: "ExecutorLifecycle", phase: "process-mission-packet-write-failed", message: "OpenCode mission packet write failed: async mission failed [REDACTED]" }])
    expect(status).toMatchObject({ phase: "failed", lastWriteError: "OpenCode mission packet write failed: async mission failed [REDACTED]" })
    expect(JSON.stringify({ events, status })).not.toContain("async-mission-secret")
    expect(JSON.stringify({ events, status })).not.toContain("async-message-secret")
  })

  test("sendMissionPacket waits for stdin error after write callback before reporting success", async () => {
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => process })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    await readProcessEvents(adapter, 1)
    process.stdinErrorAfterAck = new Error("EPIPE token=mission-epipe-secret")

    await expect(adapter.sendMissionPacket(testMissionPacket({ missionId: "m_epipe", message: "secret=epipe-message-secret", objective: "secret=epipe-message-secret" }))).rejects.toThrow("OpenCode mission packet write failed: EPIPE [REDACTED]")
    const events = await readProcessEvents(adapter, 1)
    const status = await adapter.getStatus()

    expect(events).toEqual([{ type: "ExecutorLifecycle", phase: "process-mission-packet-write-failed", message: "OpenCode mission packet write failed: EPIPE [REDACTED]" }])
    expect(status).toMatchObject({ phase: "failed", lastWriteError: "OpenCode mission packet write failed: EPIPE [REDACTED]" })
    expect(JSON.stringify({ events, status })).not.toContain("mission-epipe-secret")
    expect(JSON.stringify({ events, status })).not.toContain("epipe-message-secret")
  })

  test("sendMissionPacket write acknowledgement timeout rejects before mission success", async () => {
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", writeTimeoutMs: 10, spawn: () => process })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    await readProcessEvents(adapter, 1)
    process.neverAckStdinWrite = true

    await expect(adapter.sendMissionPacket(testMissionPacket({ missionId: "m_timeout", message: "secret=timeout-message-secret", objective: "secret=timeout-message-secret" }))).rejects.toThrow("OpenCode mission packet write failed: timed out after 10ms")
    const events = await readProcessEvents(adapter, 1)
    const status = await adapter.getStatus()

    expect(events).toEqual([{ type: "ExecutorLifecycle", phase: "process-mission-packet-write-failed", message: "OpenCode mission packet write failed: timed out after 10ms" }])
    expect(status).toMatchObject({ phase: "failed", lastWriteError: "OpenCode mission packet write failed: timed out after 10ms" })
    expect(JSON.stringify({ events, status })).not.toContain("timeout-message-secret")
  })

  test("sendMissionPacket fails if child exits before write acknowledgement completes", async () => {
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", spawn: () => process })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    await readProcessEvents(adapter, 1)
    process.onStdinWriteBeforeAck = () => process.emitExit(9, null)

    await expect(adapter.sendMissionPacket(testMissionPacket({ missionId: "m_exit", message: "secret=exit-message-secret", objective: "secret=exit-message-secret" }))).rejects.toThrow("OpenCode mission packet write failed: OpenCode process exited with code 9")
    const events = await readProcessEvents(adapter, 2)
    const status = await adapter.getStatus()

    expect(events).toContainEqual({ type: "ExecutorLifecycle", phase: "process-exited", message: "OpenCode process exited unexpectedly with code 9" })
    expect(events).toContainEqual({ type: "ExecutorLifecycle", phase: "process-mission-packet-write-failed", message: "OpenCode mission packet write failed: OpenCode process exited with code 9" })
    expect(status).toMatchObject({ phase: "failed", pid: undefined, lastWriteError: "OpenCode mission packet write failed: OpenCode process exited with code 9" })
    expect(JSON.stringify({ events, status })).not.toContain("exit-message-secret")
  })

  test("sendMissionPacket supports legacy one-argument stdin writers without false timeout", async () => {
    const process = new FakeSpawnedProcess()
    process.stdin = {
      write: (data: string) => {
        process.stdinWrites.push(data)
        return true
      },
      end: () => {
        process.stdinEnded = true
      },
      writable: true,
      destroyed: false,
    }
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: "/tmp/demo", writeTimeoutMs: 10, spawn: () => process })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "test" })
    await adapter.sendMissionPacket(testMissionPacket({ missionId: "m_legacy" }))
    const writes = process.stdinWrites.map((line) => JSON.parse(line) as Record<string, unknown>)

    expect(writes).toMatchObject([{ type: "nxl.session_start" }, { type: "nxl.mission_packet", missionId: "m_legacy" }])
    await expect(adapter.getStatus()).resolves.toMatchObject({ phase: "running", lastWriteError: undefined })
  })

  test("RuntimeServer startup with process adapter bootstrap failure releases run lock", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const process = new FakeSpawnedProcess(4242, { stdinWriteError: new Error("bootstrap failed token=bootstrap-secret") })
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: dir, spawn: () => process })
    const server = new RuntimeServer({ projectDir: dir, adapter })

    const start = server.start()
    const deadline = Date.now() + NON_BLOCKING_START_TIMEOUT_MS
    while (!process.killedWith && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
    process.emitExit(0, null)
    await expect(start).rejects.toThrow("OpenCode session bootstrap failed")
    expect(existsSync(join(dir, ".nxl", "run.lock"))).toBe(false)
    expect(server.eventBus.snapshot().map((event) => event.type)).not.toContain("RuntimeReady")
    expect(JSON.stringify(await adapter.getStatus())).not.toContain("bootstrap-secret")
  })

  test("RuntimeServer submitUserMessage with process adapter writes mission packet and marks sent", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: dir, spawn: () => process })
    const server = new RuntimeServer({ projectDir: dir, adapter })

    await server.start()
    const result = await server.submitUserMessage("transport secret=runtime-message-secret")
    const mission = await server.getMission(result.missionId)
    const missionEnvelope = process.stdinWrites.map((line) => JSON.parse(line) as Record<string, unknown>).find((line) => line.type === "nxl.mission_packet")

    expect(mission).toMatchObject({ mission_id: result.missionId, status: "sent", objective: "transport [REDACTED]" })
    expect(missionEnvelope).toMatchObject({ type: "nxl.mission_packet", missionId: result.missionId, intentId: result.intentId, message: "transport secret=runtime-message-secret" })
    expect(JSON.stringify({ status: await server.status(), events: server.eventBus.snapshot() })).not.toContain("runtime-message-secret")

    const shutdown = server.shutdown()
    process.emitExit(0, null)
    await shutdown
  })

  test("RuntimeServer submitUserMessage with process adapter write failure marks mission failed", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: dir, spawn: () => process })
    const server = new RuntimeServer({ projectDir: dir, adapter })

    await server.start()
    process.stdinWriteError = new Error("mission write failed token=mission-write-secret")
    await expect(server.submitUserMessage("secret=failed-message-secret")).rejects.toThrow("adapter delivery failed")
    const missions = await server.listRecentMissions()

    expect(missions[0]).toMatchObject({ status: "failed", failure_reason: "OpenCode mission packet write failed: mission write failed [REDACTED]" })
    expect(JSON.stringify({ missions, status: await server.status(), events: server.eventBus.snapshot() })).not.toContain("mission-write-secret")
    expect(JSON.stringify({ missions, status: await server.status(), events: server.eventBus.snapshot() })).not.toContain("failed-message-secret")

    const shutdown = server.shutdown()
    process.emitExit(0, null)
    await shutdown
  })

  test("RuntimeServer submitUserMessage waits for async process write failure before marking mission sent", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: dir, spawn: () => process })
    const server = new RuntimeServer({ projectDir: dir, adapter })

    await server.start()
    process.stdinAsyncWriteError = new Error("async runtime write failed token=async-runtime-secret")
    await expect(server.submitUserMessage("secret=async-runtime-message-secret")).rejects.toThrow("adapter delivery failed")
    const missions = await server.listRecentMissions()

    expect(missions[0]).toMatchObject({ status: "failed", failure_reason: "OpenCode mission packet write failed: async runtime write failed [REDACTED]" })
    expect(missions[0]).not.toMatchObject({ status: "sent" })
    expect(JSON.stringify({ missions, status: await server.status(), events: server.eventBus.snapshot() })).not.toContain("async-runtime-secret")
    expect(JSON.stringify({ missions, status: await server.status(), events: server.eventBus.snapshot() })).not.toContain("async-runtime-message-secret")

    const shutdown = server.shutdown()
    process.emitExit(0, null)
    await shutdown
  })

  test("RuntimeServer submitUserMessage waits for stdin error after callback before marking mission sent", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: dir, spawn: () => process })
    const server = new RuntimeServer({ projectDir: dir, adapter })

    await server.start()
    process.stdinErrorAfterAck = new Error("EPIPE token=runtime-epipe-secret")
    await expect(server.submitUserMessage("secret=runtime-epipe-message-secret")).rejects.toThrow("adapter delivery failed")
    const missions = await server.listRecentMissions()

    expect(missions[0]).toMatchObject({ status: "failed", failure_reason: "OpenCode mission packet write failed: EPIPE [REDACTED]" })
    expect(missions[0]).not.toMatchObject({ status: "sent" })
    expect(JSON.stringify({ missions, status: await server.status(), events: server.eventBus.snapshot() })).not.toContain("runtime-epipe-secret")
    expect(JSON.stringify({ missions, status: await server.status(), events: server.eventBus.snapshot() })).not.toContain("runtime-epipe-message-secret")

    const shutdown = server.shutdown()
    process.emitExit(0, null)
    await shutdown
  })

  test("RuntimeServer submitUserMessage fails mission if process exits before write acknowledgement", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const process = new FakeSpawnedProcess()
    const adapter = new ProcessOpenCodeAdapter({ command: "opencode", cwd: dir, spawn: () => process })
    const server = new RuntimeServer({ projectDir: dir, adapter })

    await server.start()
    process.onStdinWriteBeforeAck = () => process.emitExit(11, null)
    await expect(server.submitUserMessage("secret=exit-runtime-message-secret")).rejects.toThrow("adapter delivery failed")
    const missions = await server.listRecentMissions()

    expect(missions[0]).toMatchObject({ status: "failed", failure_reason: "OpenCode mission packet write failed: OpenCode process exited with code 11" })
    expect(missions[0]).not.toMatchObject({ status: "sent" })
    expect(JSON.stringify({ missions, status: await server.status(), events: server.eventBus.snapshot() })).not.toContain("exit-runtime-message-secret")
    await server.shutdown()
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
    expect(sessionContractFromWrite(process)).toMatchObject({
      allowedToolNames: [...MISSION_TOOL_NAMES],
      inputEnvelopeTypes: ["nxl.session_start", "nxl.mission_packet", "nxl.executor_tool_result"],
      outputEnvelopeTypes: ["nxl.executor_tool_call"],
    })
    expect(String(sessionContractFromWrite(process).prompt)).toContain("Child prose/stdout is diagnostic only")
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
    expect(JSON.parse(processes[0]?.stdinWrites[0] ?? "{}")).toMatchObject({ type: "nxl.session_start" })
    expect(JSON.parse(processes[1]?.stdinWrites[0] ?? "{}")).toMatchObject({ type: "nxl.session_start" })
    expect(sessionContractFromWrite(processes[0]!)).toMatchObject({ allowedToolNames: [...MISSION_TOOL_NAMES] })
    expect(sessionContractFromWrite(processes[1]!)).toMatchObject({ allowedToolNames: [...MISSION_TOOL_NAMES] })
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

  test("superseded child structured tool calls are ignored while active child calls still work", async () => {
    const processes: FakeSpawnedProcess[] = []
    const calls: unknown[] = []
    const adapter = new ProcessOpenCodeAdapter({
      command: "opencode",
      cwd: "/tmp/demo",
      spawn: () => {
        const process = new FakeSpawnedProcess(6400 + processes.length)
        processes.push(process)
        return process
      },
      toolHandler: async (call) => {
        calls.push(call)
        return { call_id: call.call_id, tool: call.tool, ok: true, result: { handled: call.call_id }, created_at: "2026-05-13T00:00:00.000Z" }
      },
    })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "first" })
    await adapter.startSession({ projectDir: "/tmp/demo", objective: "second" })
    processes[0]?.stdout.emitData(`${JSON.stringify({ type: "nxl.executor_tool_call", call_id: "call_old", tool: "mission.claim", payload: { token: "old-secret" } })}\n`)
    processes[1]?.stdout.emitData(`${JSON.stringify({ type: "nxl.executor_tool_call", call_id: "call_new", tool: "mission.get", payload: {} })}\n`)

    const result = await waitForToolResult(processes[1]!)
    const events = await readProcessEvents(adapter, 4)
    const status = await adapter.getStatus()

    expect(calls).toEqual([{ type: "nxl.executor_tool_call", call_id: "call_new", tool: "mission.get", payload: {} }])
    expect(processes[0]?.stdinWrites).toHaveLength(1)
    expect(result).toMatchObject({ type: "nxl.executor_tool_result", call_id: "call_new", ok: true })
    expect(status).toMatchObject({ phase: "running", pid: 6401 })
    expect(events).toContainEqual({
      type: "ExecutorLifecycle",
      phase: "process-superseded-tool-call-ignored",
      message: "Ignored executor tool call from superseded process: call_old mission.claim",
    })
    expect(JSON.stringify({ events, status })).not.toContain("old-secret")

    processes[0]?.emitExit(0, null)
    const shutdown = adapter.shutdown()
    processes[1]?.emitExit(0, null)
    await shutdown
  })

  test("superseded child async tool results are ignored before stale stdin write", async () => {
    const processes: FakeSpawnedProcess[] = []
    let releaseHandler!: () => void
    const handlerReleased = new Promise<void>((resolve) => {
      releaseHandler = resolve
    })
    const adapter = new ProcessOpenCodeAdapter({
      command: "opencode",
      cwd: "/tmp/demo",
      spawn: () => {
        const process = new FakeSpawnedProcess(6500 + processes.length)
        processes.push(process)
        return process
      },
      toolHandler: async (call) => {
        if (call.call_id === "call_old_async") await handlerReleased
        return { call_id: call.call_id, tool: call.tool, ok: true, result: { handled: call.call_id }, created_at: "2026-05-13T00:00:00.000Z" }
      },
    })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "first" })
    processes[0]?.stdout.emitData(`${JSON.stringify({ type: "nxl.executor_tool_call", call_id: "call_old_async", tool: "mission.get", payload: {} })}\n`)
    await adapter.startSession({ projectDir: "/tmp/demo", objective: "second" })
    releaseHandler()
    await timeout(20)
    processes[1]?.stdout.emitData(`${JSON.stringify({ type: "nxl.executor_tool_call", call_id: "call_new_async", tool: "mission.get", payload: {} })}\n`)

    const result = await waitForToolResult(processes[1]!)
    const events = await readProcessEvents(adapter, 4)
    const status = await adapter.getStatus()

    expect(processes[0]?.stdinWrites).toHaveLength(1)
    expect(result).toMatchObject({ type: "nxl.executor_tool_result", call_id: "call_new_async", ok: true })
    expect(status).toMatchObject({ phase: "running", pid: 6501 })
    expect(JSON.stringify({ events, status })).not.toContain("old-secret")
    expect(events).toContainEqual({
      type: "ExecutorLifecycle",
      phase: "process-superseded-tool-call-ignored",
      message: "Ignored executor tool result from superseded process: call_old_async mission.get",
    })

    processes[0]?.emitExit(0, null)
    const shutdown = adapter.shutdown()
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
    processes[0]?.stdout.emitData("terminating child output token=old-child-secret\n")

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

  test("failed replacement bootstrap terminates replacement and preserves shutdown cleanup", async () => {
    const processes: FakeSpawnedProcess[] = []
    const adapter = new ProcessOpenCodeAdapter({
      command: "opencode",
      cwd: "/tmp/demo",
      spawn: () => {
        const process = new FakeSpawnedProcess(6600 + processes.length, {
          stdinWriteError: processes.length === 1 ? new Error("replacement stdin failed token=replacement-bootstrap-secret") : undefined,
        })
        processes.push(process)
        return process
      },
    })

    await adapter.startSession({ projectDir: "/tmp/demo", objective: "first" })

    await expect(adapter.startSession({ projectDir: "/tmp/demo", objective: "second secret=second-objective-secret" })).rejects.toThrow("OpenCode session bootstrap failed")
    const status = await adapter.getStatus()

    expect(processes[0]?.stdinEnded).toBe(true)
    expect(processes[0]?.killedWith).toBe("SIGTERM")
    expect(processes[1]?.stdinEnded).toBe(true)
    expect(processes[1]?.killedWith).toBe("SIGTERM")
    expect(status).toMatchObject({ phase: "failed", pid: 6600, terminatingPids: [6600, 6601], sessionStarted: false })
    expect(JSON.stringify(status)).not.toContain("replacement-bootstrap-secret")
    expect(JSON.stringify(status)).not.toContain("second-objective-secret")

    const shutdown = adapter.shutdown()
    processes[0]?.emitExit(0, null)
    processes[1]?.emitExit(0, null)
    await shutdown
  })

  test("commander operator queue commands project read-only review apply failure stale and redacted state", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({
      projectDir: dir,
      adapter: new LongLivedAdapter(),
      researchProjectionMode: "disabled",
      commanderQueueNow: () => new Date("2026-05-25T00:00:00.000Z"),
    })

    await server.start()
    const submitted = await server.submitUserMessage("queue mission")
    const claim = await server.command("runtime.claim_mission", { missionId: submitted.missionId, executorId: "executor" }) as { claim_id: string }
    const pendingReview = await server.command("runtime.create_review_request", {
      missionId: submitted.missionId,
      title: "review token=queue-review-secret",
      summary: "summary api_key=queue-review-summary-secret",
      requestedBy: "operator",
    }) as { review_id: string }
    const blocked = await server.command("runtime.create_commander_proposal", {
      missionId: submitted.missionId,
      claimId: claim.claim_id,
      actionKind: "record_progress",
      title: "blocked token=queue-blocked-secret",
      summary: "missing review",
      proposedBy: "operator",
      actionPayload: { mission_id: submitted.missionId, claim_id: claim.claim_id, message: "blocked" },
    }) as { proposal_id: string }
    const ready = await server.command("runtime.create_commander_proposal", {
      missionId: submitted.missionId,
      claimId: claim.claim_id,
      actionKind: "record_progress",
      title: "ready",
      summary: "ready",
      proposedBy: "operator",
      actionPayload: { mission_id: submitted.missionId, claim_id: claim.claim_id, message: "ready" },
    }) as { proposal_id: string }
    const readyReview = await server.command("runtime.request_proposal_review", { proposalId: ready.proposal_id, requestedBy: "operator" }) as { review_id: string }
    await server.command("runtime.approve_review_request", { reviewId: readyReview.review_id, decidedBy: "operator" })
    const failed = await server.command("runtime.create_commander_proposal", {
      actionKind: "other",
      title: "failed",
      summary: "failed",
      proposedBy: "operator",
    }) as { proposal_id: string }
    const failedReview = await server.command("runtime.request_proposal_review", { proposalId: failed.proposal_id, requestedBy: "operator" }) as { review_id: string }
    await server.command("runtime.approve_review_request", { reviewId: failedReview.review_id, decidedBy: "operator" })
    await expect(server.command("runtime.apply_commander_target", { targetType: "proposal", targetId: failed.proposal_id })).rejects.toThrow("proposal apply failed")
    const cancelled = await server.command("runtime.create_commander_proposal", {
      actionKind: "other",
      title: "cancelled",
      summary: "cancelled",
      proposedBy: "operator",
    }) as { proposal_id: string }
    await server.command("runtime.cancel_commander_proposal", { proposalId: cancelled.proposal_id, reason: "operator cancelled" })
    const rejected = await server.command("runtime.create_commander_proposal", {
      actionKind: "other",
      title: "rejected",
      summary: "rejected",
      proposedBy: "operator",
    }) as { proposal_id: string }
    const rejectedReview = await server.command("runtime.request_proposal_review", { proposalId: rejected.proposal_id, requestedBy: "operator" }) as { review_id: string }
    await server.command("runtime.reject_review_request", { reviewId: rejectedReview.review_id, decidedBy: "operator", reason: "operator rejected" })
    const failedBundle = await server.command("runtime.create_proposal_bundle", { title: "failed bundle", summary: "failed bundle", createdBy: "operator" }) as { bundle_id: string }
    await expect(server.command("runtime.apply_proposal_bundle", { bundleId: failedBundle.bundle_id, allowPartial: true })).rejects.toThrow("has no proposals to apply")
    const bundle = await server.command("runtime.create_proposal_bundle", { title: "bundle", summary: "bundle", createdBy: "operator" }) as { bundle_id: string }
    await server.command("runtime.add_proposal_to_bundle", { bundleId: bundle.bundle_id, proposalId: blocked.proposal_id })
    const cancelledBundle = await server.command("runtime.create_proposal_bundle", { title: "cancelled bundle", summary: "cancelled bundle", createdBy: "operator" }) as { bundle_id: string }
    await server.command("runtime.add_proposal_to_bundle", { bundleId: cancelledBundle.bundle_id, proposalId: blocked.proposal_id })
    await server.command("runtime.cancel_proposal_bundle", { bundleId: cancelledBundle.bundle_id, reason: "operator cancelled" })
    const draft = await server.command("runtime.draft_commander_playbook", {
      playbookId: "record-progress",
      proposedBy: "operator",
      fields: { mission_id: submitted.missionId, claim_id: claim.claim_id, title: "draft", message: "draft" },
    }) as { draft_id: string }
    const cancelledDraft = await server.command("runtime.draft_commander_playbook", {
      playbookId: "record-progress",
      proposedBy: "operator",
      fields: { mission_id: submitted.missionId, claim_id: claim.claim_id, title: "cancelled draft", message: "cancelled draft" },
    }) as { draft_id: string }
    await server.command("runtime.cancel_commander_playbook_draft", { draftId: cancelledDraft.draft_id, reason: "operator cancelled" })

    await expect(server.command("runtime.commander_queue_summary")).resolves.toMatchObject({
      needs_review_count: 1,
      ready_to_apply_count: 2,
      blocked_count: expect.any(Number),
      failed_apply_count: 2,
      drafts_needing_review_count: 1,
      bundles_needing_review_count: 1,
      stale_open_count: expect.any(Number),
    })
    await expect(server.command("runtime.commander_queue", { queue: "needs_review", limit: 20 })).resolves.toMatchObject({
      queue: "needs_review",
      items: [expect.objectContaining({ target_type: "review", target_id: pendingReview.review_id, status: "pending" })],
    })
    await expect(server.command("runtime.commander_queue", { queue: "ready_to_apply", limit: 20 })).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ target_type: "proposal", target_id: ready.proposal_id, status: "approved" })]),
    })
    const blockedQueue = await server.command("runtime.commander_queue", { queue: "blocked", limit: 20 }) as { items: Array<{ target_id: string; target_type: string; blockers?: string[] }> }
    expect(blockedQueue.items).toEqual(expect.arrayContaining([expect.objectContaining({ target_type: "proposal", target_id: blocked.proposal_id, blockers: expect.arrayContaining([expect.stringContaining("no linked review")]) })]))
    expect(blockedQueue.items.map((item) => item.target_id)).not.toContain(cancelled.proposal_id)
    expect(blockedQueue.items.map((item) => item.target_id)).not.toContain(rejected.proposal_id)
    expect(blockedQueue.items.map((item) => item.target_id)).not.toContain(cancelledBundle.bundle_id)
    expect(blockedQueue.items.map((item) => item.target_id)).not.toContain(cancelledDraft.draft_id)
    await expect(server.command("runtime.commander_queue", { queue: "failed_apply", limit: 20 })).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ target_type: "proposal", target_id: failed.proposal_id }),
        expect.objectContaining({ target_type: "bundle", target_id: failedBundle.bundle_id }),
      ]),
    })
    const failedApply = await server.command("runtime.commander_queue", { queue: "failed_apply", limit: 20 }) as { items: Array<{ target_id: string }> }
    expect(failedApply.items.map((item) => item.target_id)).not.toContain(cancelled.proposal_id)
    expect(failedApply.items.map((item) => item.target_id)).not.toContain(rejected.proposal_id)
    const dryRunStartedAt = Date.now()
    const dryRunApply = await server.command("runtime.apply_commander_target", { targetType: "proposal", targetId: ready.proposal_id, dryRun: true }) as { created_at: string }
    const dryRunFinishedAt = Date.now()
    expect(dryRunApply.created_at).not.toBe("2026-05-25T00:00:00.000Z")
    expect(Date.parse(dryRunApply.created_at)).toBeGreaterThanOrEqual(dryRunStartedAt - 1000)
    expect(Date.parse(dryRunApply.created_at)).toBeLessThanOrEqual(dryRunFinishedAt + 1000)
    await server.command("runtime.apply_commander_target", { targetType: "proposal", targetId: ready.proposal_id })
    await expect(server.command("runtime.commander_queue", { queue: "recently_applied", limit: 20 })).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ target_type: "proposal", target_id: ready.proposal_id, status: "applied" })]),
    })
    await expect(server.command("runtime.commander_queue", { queue: "drafts_needing_review", limit: 20 })).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ target_type: "draft", target_id: draft.draft_id })]),
    })
    await expect(server.command("runtime.commander_queue", { queue: "bundles_needing_review", limit: 20 })).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ target_type: "bundle", target_id: bundle.bundle_id })]),
    })
    await expect(server.command("runtime.commander_queue", { queue: "stale_open", limit: 1, staleAfterMs: 1 })).resolves.toMatchObject({ limit: 1, total_considered: expect.any(Number) })
    await expect(server.command("runtime.commander_queue", { queue: "needs_review", limit: 1000 })).resolves.toMatchObject({ limit: 100 })
    await expect(server.command("runtime.commander_queue", { queue: "unknown", limit: 20 })).rejects.toThrow("commander queue kind is invalid")
    await expect(server.command("runtime.commander_queue", { queue: "needs_review", limit: 0 })).rejects.toThrow("commander queue limit must be a positive integer")
    await expect(server.command("runtime.commander_queue", { queue: "needs_review", limit: null })).rejects.toThrow("commander queue limit must be a positive integer")
    await expect(server.command("runtime.commander_queue", { queue: "needs_review", staleAfterMs: null })).rejects.toThrow("staleAfterMs")
    await expect(server.command("runtime.commander_queue_summary", { staleAfterMs: 0 })).rejects.toThrow("staleAfterMs")
    await expect(server.command("runtime.commander_queue_summary", { staleAfterMs: null })).rejects.toThrow("staleAfterMs")
    const serialized = JSON.stringify(await server.command("runtime.commander_queue", { queue: "blocked", limit: 20 }))
    expect(serialized).not.toContain("queue-blocked-secret")
    expect(serialized).not.toContain("queue-review-secret")
    expect(serialized).not.toContain("queue-review-summary-secret")

    await server.shutdown()

    const reader = new RuntimeServer({ projectDir: dir, mode: "view-records", researchProjectionMode: "disabled" })
    await expect(reader.command("runtime.commander_queue", { queue: "ready_to_apply", limit: 20 })).resolves.toMatchObject({ queue: "ready_to_apply" })
  })

  test("commander operator queues scan full registries beyond public list caps", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const eventStore = new EventStore(join(dir, ".nxl", "events.jsonl"))
    let reviewIds = 0
    let nowMs = 0
    const base = Date.UTC(2026, 4, 1, 0, 0, 0, 0)
    const reviewRegistry = new ReviewRegistry({
      eventStore,
      idFactory: () => `review_${++reviewIds}`,
      now: () => new Date(base + nowMs++),
    })
    const server = new RuntimeServer({
      projectDir: dir,
      reviewRegistry,
      researchProjectionMode: "disabled",
    })

    for (let index = 0; index < 105; index++) {
      await server.reviewRegistry.createReviewRequest({
        title: `review ${index}`,
        summary: `summary ${index}`,
        requested_by: "operator",
      })
    }

    await expect(server.command("runtime.list_review_requests", { status: "pending", limit: 1000 })).resolves.toHaveLength(100)
    await expect(server.command("runtime.commander_queue_summary")).resolves.toMatchObject({
      needs_review_count: 105,
      last_updated_at: "2026-05-01T00:00:00.104Z",
    })
    await expect(server.command("runtime.commander_queue", { queue: "needs_review", limit: 100 })).resolves.toMatchObject({
      queue: "needs_review",
      total_considered: 105,
      limit: 100,
      items: expect.arrayContaining([expect.objectContaining({ target_id: "review_1" })]),
    })
  })

  test("commander queue membership reuses one registry snapshot", async () => {
    const calls = { reviews: 0, proposals: 0, bundles: 0, drafts: 0, previews: 0 }
    const service = new CommanderQueueService({
      reviewRegistry: {
        listAllReviewRequests: async () => {
          calls.reviews += 1
          return [{
            review_id: "review_1",
            title: "Review",
            summary: "Review",
            status: "pending",
            requested_by: "operator",
            created_at: "2026-05-01T00:00:00.000Z",
            updated_at: "2026-05-01T00:00:00.000Z",
          }]
        },
      } as ReviewRegistry,
      proposalRegistry: {
        listAllProposals: async () => {
          calls.proposals += 1
          return [{
            proposal_id: "proposal_1",
            title: "Proposal",
            summary: "Proposal",
            status: "proposed",
            action_kind: "record_progress",
            action_payload: {},
            proposed_by: "operator",
            created_at: "2026-05-01T00:00:00.000Z",
            updated_at: "2026-05-01T00:00:00.000Z",
          }]
        },
      } as ProposalRegistry,
      proposalBundleRegistry: {
        listAllBundles: async () => {
          calls.bundles += 1
          return [{
            bundle_id: "bundle_1",
            title: "Bundle",
            summary: "Bundle",
            status: "open",
            proposal_ids: ["proposal_1"],
            created_by: "operator",
            created_at: "2026-05-01T00:00:00.000Z",
            updated_at: "2026-05-01T00:00:00.000Z",
          }]
        },
      } as ProposalBundleRegistry,
      commanderPlaybookDraftRegistry: {
        listAllDrafts: async () => {
          calls.drafts += 1
          return [{
            draft_id: "draft_1",
            playbook_id: "record-progress",
            status: "drafted",
            field_values: {},
            proposal_ids: ["proposal_1"],
            review_ids: [],
            created_by: "operator",
            created_at: "2026-05-01T00:00:00.000Z",
            updated_at: "2026-05-01T00:00:00.000Z",
          }]
        },
      } as unknown as CommanderPlaybookDraftRegistry,
      applyService: {
        preview: async (target: { target_type: string; target_id: string }) => {
          calls.previews += 1
          return {
            target_type: target.target_type,
            target_id: target.target_id,
            ready_to_apply: false,
            proposal_ids: target.target_type === "proposal" ? [target.target_id] : ["proposal_1"],
            approved_count: 0,
            applied_count: 0,
            blocked_count: 1,
            blockers: ["not approved"],
            apply_mode: target.target_type === "proposal" ? "single" : target.target_type,
            would_apply: [],
            would_skip: [],
          }
        },
      } as never,
      now: () => new Date("2026-05-01T00:00:00.000Z"),
    })

    await expect(service.membership("proposal", "proposal_1")).resolves.toContain("blocked")
    expect(calls).toMatchObject({ reviews: 1, proposals: 1, bundles: 1, drafts: 1, previews: 6 })
  })

  test("commander target context is read-only redacted and spans proposal bundle draft review mission navigation", async () => {
    const dir = await tempProject()
    await makeProject(dir, { approvedSpec: true })
    const server = new RuntimeServer({ projectDir: dir, adapter: new LongLivedAdapter(), researchProjectionMode: "disabled" })

    await server.start()
    const beforeEvents = (await readJsonlEvents(dir)).length
    const submitted = await server.submitUserMessage("target context mission")
    const claim = await server.command("runtime.claim_mission", { missionId: submitted.missionId, executorId: "executor" }) as { claim_id: string }
    await server.command("runtime.record_mission_progress", { missionId: submitted.missionId, claimId: claim.claim_id, message: "progress" })
    const result = await server.command("runtime.submit_mission_result", { missionId: submitted.missionId, claimId: claim.claim_id, summary: "result summary" }) as { result_id: string }
    const proposal = await server.command("runtime.create_commander_proposal", {
      missionId: submitted.missionId,
      claimId: claim.claim_id,
      actionKind: "record_progress",
      title: "proposal token=target-title-secret",
      summary: "summary api_key=target-summary-secret",
      proposedBy: "operator",
      actionPayload: { mission_id: submitted.missionId, claim_id: claim.claim_id, message: "progress" },
    }) as { proposal_id: string }
    const review = await server.command("runtime.request_proposal_review", { proposalId: proposal.proposal_id, requestedBy: "operator" }) as { review_id: string }
    const bundle = await server.command("runtime.create_proposal_bundle", { title: "bundle", summary: "bundle", createdBy: "operator" }) as { bundle_id: string }
    await server.command("runtime.add_proposal_to_bundle", { bundleId: bundle.bundle_id, proposalId: proposal.proposal_id })
    const draft = await server.command("runtime.draft_commander_playbook", {
      playbookId: "record-progress",
      proposedBy: "operator",
      fields: { mission_id: submitted.missionId, claim_id: claim.claim_id, title: "draft", message: "draft" },
      createBundle: true,
      requestReviews: true,
    }) as { draft_id: string; bundle_id: string; proposal_ids: string[]; review_ids: string[] }

    const proposalContext = await server.command("runtime.commander_target_context", { targetType: "proposal", targetId: proposal.proposal_id }) as Record<string, unknown>
    expect(proposalContext.target_type).toBe("proposal")
    expect(proposalContext.target_id).toBe(proposal.proposal_id)
    expect(proposalContext.found).toBe(true)
    expect(proposalContext.status).toBe("review_requested")
    const proposalRelated = proposalContext.related_ids as Record<string, string[]>
    expect(proposalRelated.mission_id).toContain(submitted.missionId)
    expect(proposalRelated.claim_id).toContain(claim.claim_id)
    expect(proposalRelated.review_id).toContain(review.review_id)
    expect(proposalRelated.bundle_id).toContain(bundle.bundle_id)
    expect(proposalContext.queue_membership as string[]).toContain("blocked")
    expect(Number(proposalContext.audit_event_count)).toBeGreaterThan(0)
    expect(proposalContext.suggested_commands as Array<{ command: string; command_type: string }>).toContainEqual(expect.objectContaining({ command: `/apply-preview proposal ${proposal.proposal_id}`, command_type: "read" }))
    expect(JSON.stringify(proposalContext)).not.toContain("target-title-secret")
    expect(JSON.stringify(proposalContext)).not.toContain("target-summary-secret")

    const bundleContext = await server.command("runtime.commander_target_context", { target_type: "bundle", target_id: bundle.bundle_id }) as { target_type: string; related_ids: Record<string, string[]>; queue_membership: string[] }
    expect(bundleContext.target_type).toBe("bundle")
    expect(bundleContext.related_ids.proposal_id).toContain(proposal.proposal_id)
    expect(bundleContext.queue_membership).toContain("blocked")
    const draftContext = await server.command("runtime.commander_target_context", { targetType: "draft", targetId: draft.draft_id }) as { target_type: string; related_ids: Record<string, string[]>; queue_membership: string[] }
    expect(draftContext.target_type).toBe("draft")
    for (const proposalId of draft.proposal_ids) expect(draftContext.related_ids.proposal_id).toContain(proposalId)
    expect(draftContext.related_ids.bundle_id).toContain(draft.bundle_id)
    for (const reviewId of draft.review_ids) expect(draftContext.related_ids.review_id).toContain(reviewId)
    expect(draftContext.queue_membership).toContain("blocked")
    const reviewContext = await server.command("runtime.commander_target_context", { targetType: "review", targetId: review.review_id }) as { target_type: string; status: string; related_ids: Record<string, string[]>; suggested_commands: Array<{ command: string; command_type: string }> }
    expect(reviewContext.target_type).toBe("review")
    expect(reviewContext.status).toBe("pending")
    expect(reviewContext.related_ids.proposal_id).toContain(proposal.proposal_id)
    expect(reviewContext.suggested_commands).toContainEqual(expect.objectContaining({ command: `/approve ${review.review_id}`, command_type: "write" }))
    const missionContext = await server.command("runtime.commander_target_context", { targetType: "mission", targetId: submitted.missionId }) as { target_type: string; status: string; related_ids: Record<string, string[]>; audit_event_count: number }
    expect(missionContext.target_type).toBe("mission")
    expect(missionContext.status).toBeTruthy()
    expect(missionContext.related_ids.claim_id).toContain(claim.claim_id)
    expect(missionContext.audit_event_count).toBeGreaterThan(0)
    const claimContext = await server.command("runtime.commander_target_context", { targetType: "claim", targetId: claim.claim_id }) as { suggested_commands: Array<{ command: string }> }
    expect(claimContext.suggested_commands).toContainEqual(expect.objectContaining({ command: `/claims ${submitted.missionId}` }))
    const resultContext = await server.command("runtime.commander_target_context", { targetType: "result", targetId: result.result_id }) as { suggested_commands: Array<{ command: string }> }
    expect(resultContext.suggested_commands).toContainEqual(expect.objectContaining({ command: `/results ${submitted.missionId}` }))
    expect(resultContext.suggested_commands).toContainEqual(expect.objectContaining({ command: `/draft-complete ${submitted.missionId} ${result.result_id} <title> -- <summary>` }))
    await expect(server.command("runtime.commander_target_context", { targetType: "proposal", targetId: "proposal_missing" })).resolves.toMatchObject({
      found: false,
      missing_links: expect.arrayContaining([expect.stringContaining("proposal record not found")]),
    })
    await expect(server.command("runtime.commander_target_context", { targetType: "bogus", targetId: "x" })).rejects.toThrow("unknown commander target type")
    await expect(server.command("runtime.commander_target_context", { targetType: "proposal" })).rejects.toThrow("targetId is required")

    const afterEvents = (await readJsonlEvents(dir)).length
    await server.command("runtime.commander_target_context", { targetType: "proposal", targetId: proposal.proposal_id })
    expect((await readJsonlEvents(dir)).length).toBe(afterEvents)
    expect(afterEvents).toBeGreaterThan(beforeEvents)

    await server.shutdown()
    const reader = new RuntimeServer({ projectDir: dir, mode: "view-records", researchProjectionMode: "disabled" })
    await expect(reader.command("runtime.commander_target_context", { targetType: "proposal", targetId: proposal.proposal_id })).resolves.toMatchObject({ found: true })
  })
})
