import { join } from "node:path"
import { EventStore } from "./events/event-store"
import { RuntimeEventBus } from "./events/event-bus"
import type { RuntimeEvent, RuntimeMode, RuntimeResearchProjectionHealth, RuntimeResearchProjectionMode, RuntimeStatus } from "./events/event-types"
import { modeRequiresApprovedSpec } from "./project/project-status"
import { locateProjectRoot, projectName } from "./project/project-root"
import { RunLock } from "./project/run-lock"
import { FakeOpenCodeAdapter } from "./opencode/fake-adapter"
import type { OpenCodeRuntimeAdapter } from "./opencode/adapter"
import { PolicyService } from "./spec/policy-service"
import { SpecService, type SpecSummary } from "./spec/spec-service"
import { redactValue } from "./security/redaction"
import {
  ResearchDb,
  type ListResearchEventsOptions,
  type Note,
  type ResearchProjectionIntegrity,
  type ResearchProjectionStatus,
  type ResearchEvent,
  type SearchOptions,
  type Topic,
  type TopicSnapshot,
} from "./research-db/research-db"

export interface RuntimeServerOptions {
  projectDir?: string
  mode?: RuntimeMode
  adapter?: OpenCodeRuntimeAdapter
  researchProjectionMode?: RuntimeResearchProjectionMode
  researchDb?: RuntimeResearchDbProjection
  researchDbFactory?: (projectDir: string) => RuntimeResearchDbProjection
}

export interface RuntimeResearchDbReader {
  close(): void
  listTopics(): Topic[]
  searchTopics(query: string, options?: SearchOptions): Topic[]
  getTopicSnapshot(topicId: string): TopicSnapshot | null
  listResearchEvents(options?: ListResearchEventsOptions): ResearchEvent[]
  searchNotes(topicId: string, query: string, options?: SearchOptions): Note[]
}

export interface RuntimeResearchDbProjection extends RuntimeResearchDbReader {
  checkProjectionIntegrity(eventsPath?: string): ResearchProjectionIntegrity
  rebuildFromEvents(eventsPath?: string): void
  getProjectionStatus(): ResearchProjectionStatus
}

export class RuntimeServer {
  readonly projectDir: string
  readonly mode: RuntimeMode
  readonly eventStore: EventStore
  readonly eventBus = new RuntimeEventBus()
  readonly specService: SpecService
  readonly policyService: PolicyService
  readonly adapter: OpenCodeRuntimeAdapter
  private readonly runLock: RunLock
  private readonly researchProjectionMode: RuntimeResearchProjectionMode
  private readonly researchDbFactory: (projectDir: string) => RuntimeResearchDbProjection
  private readonly ownsResearchDb: boolean
  private researchDb: RuntimeResearchDbProjection | null = null
  private researchProjectionHealth: RuntimeResearchProjectionHealth
  private specSummary: SpecSummary | null = null
  private started = false
  private executorStreamTask: Promise<void> | null = null
  private executorStreamAbort = false
  private executorStreamError: string | null = null

  constructor(options: RuntimeServerOptions = {}) {
    this.projectDir = locateProjectRoot(options.projectDir)
    this.mode = options.mode ?? "active"
    this.eventStore = new EventStore(join(this.projectDir, ".nxl", "events.jsonl"))
    this.specService = new SpecService(this.projectDir)
    this.policyService = new PolicyService(this.projectDir)
    this.runLock = new RunLock(join(this.projectDir, ".nxl", "run.lock"))
    this.adapter = options.adapter ?? new FakeOpenCodeAdapter()
    this.researchProjectionMode = options.researchProjectionMode ?? "auto_rebuild"
    this.researchDb = options.researchDb ?? null
    this.ownsResearchDb = options.researchDb === undefined
    this.researchDbFactory = options.researchDbFactory ?? ((projectDir) => ResearchDb.open(projectDir))
    this.researchProjectionHealth = {
      mode: this.researchProjectionMode,
      ok: this.researchProjectionMode === "disabled",
      stale: false,
      reason: this.researchProjectionMode === "disabled" ? "disabled" : "not checked",
      pending_count: 0,
    }
  }

  async start(): Promise<void> {
    if (modeRequiresApprovedSpec(this.mode)) {
      this.specSummary = await this.specService.requireApproved()
    } else {
      const current = await this.specService.readCurrent()
      this.specSummary = current?.status === "approved" ? this.specService.toSummary(current) : null
    }
    await this.runLock.acquire()
    try {
      this.ensureResearchProjectionUsable("startup")
      this.started = true
      if (this.mode === "active") {
        await this.adapter.startSession({
          projectDir: this.projectDir,
          objective: this.specSummary?.objective ?? "",
        })
        this.startExecutorEventPump()
      }
      const recordsBeforeStart = await this.eventStore.readAll()
      const runtimeStartedId = await this.eventStore.append({ kind: "runtime_started", mode: this.mode })
      this.emitStartupReadyEvents(recordsBeforeStart.length + 1, runtimeStartedId)
    } catch (error) {
      await this.cleanupFailedStartup()
      throw error
    }
  }

  private emitStartupReadyEvents(recordsCount: number, lastRunId: string): void {
    this.eventBus.emit({
      type: "RuntimeReady",
      projectName: projectName(this.projectDir),
      runtimeStatus: this.mode === "active" ? "ready" : `${this.mode} ready`,
      providerLabel: this.specSummary?.approvedBy,
      modelLabel: "fake-opencode-adapter",
    })
    this.eventBus.emit({ type: "ProjectInitialized", projectDir: this.projectDir })
    this.eventBus.emit({ type: "ResumeSummaryLoaded", recordsCount, lastRunId })
  }

  private startExecutorEventPump(): void {
    if (this.executorStreamTask) return
    this.executorStreamAbort = false
    this.executorStreamError = null

    let task!: Promise<void>
    task = (async () => {
      try {
        for await (const event of this.adapter.streamExecutorEvents()) {
          if (this.executorStreamAbort) break
          this.eventBus.emit(event)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.executorStreamError = message
        this.eventBus.emit({
          type: "ExecutorLifecycle",
          phase: "runtime-event-pump-error",
          message,
        })
      } finally {
        if (this.executorStreamTask === task) this.executorStreamTask = null
      }
    })()

    this.executorStreamTask = task
  }

  private async cleanupFailedStartup(): Promise<void> {
    this.executorStreamAbort = true
    this.started = false
    try {
      await this.adapter.shutdown()
    } catch (error) {
      this.eventBus.emit({
        type: "ExecutorLifecycle",
        phase: "runtime-startup-cleanup-error",
        message: error instanceof Error ? error.message : String(error),
      })
    }
    try {
      await this.runLock.release()
    } catch (error) {
      this.eventBus.emit({
        type: "ExecutorLifecycle",
        phase: "runtime-lock-release-error",
        message: error instanceof Error ? error.message : String(error),
      })
    }
    try {
      this.closeOwnedResearchDb(null)
    } catch (error) {
      this.eventBus.emit({
        type: "ExecutorLifecycle",
        phase: "runtime-research-db-cleanup-error",
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async command(name: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    switch (name) {
      case "runtime.status":
        return this.status()
      case "runtime.resume":
        return this.resume()
      case "runtime.start_new_session":
        return this.startNewSession()
      case "runtime.view_records":
        return this.viewRecords()
      case "research.list_topics":
        return this.listResearchTopics(optionalString(payload.query, "query"))
      case "research.get_topic_snapshot":
        return this.getResearchTopicSnapshot(requiredString(payload.topicId, "topicId"))
      case "research.list_events":
        return this.listResearchEvents(readResearchEventsOptions(payload.options))
      case "research.search_notes":
        return this.searchResearchNotes(requiredString(payload.topicId, "topicId"), requiredString(payload.query, "query"), readSearchOptions(payload.options))
      case "research.projection_status":
        return this.researchProjectionStatus()
      case "research.rebuild_projection":
        return this.rebuildResearchProjection(readRebuildProjectionOptions(payload))
      case "runtime.submit_user_message":
        return this.submitUserMessage(String(payload.message ?? ""))
      case "runtime.shutdown":
        return this.shutdown(String(payload.reason ?? "command"))
      default:
        throw new Error(`unknown runtime command: ${name}`)
    }
  }

  async status(): Promise<RuntimeStatus> {
    this.checkResearchProjectionForStatus()
    const policy = await this.policyService.metadata()
    return redactValue({
      projectDir: this.projectDir,
      projectName: projectName(this.projectDir),
      mode: this.mode,
      specApproved: this.specSummary?.status === "approved",
      runtimeStatus: this.started ? "started" : "created",
      lockHeld: this.runLock.isHeld(),
      fakeOpenCode: String((await this.adapter.getStatus()).message ?? ""),
      executorStreamError: this.executorStreamError ?? undefined,
      researchProjection: this.researchProjectionHealth,
      policy,
    })
  }

  async resume(): Promise<{ events: number }> {
    const events = await this.eventStore.readAll()
    this.eventBus.emit({ type: "ResumeSummaryLoaded", recordsCount: events.length, lastRunId: await this.eventStore.latestEventId() ?? undefined })
    return { events: events.length }
  }

  async startNewSession(): Promise<{ adapter: Record<string, unknown> }> {
    if (this.mode !== "active") {
      throw new Error("runtime.start_new_session requires active mode")
    }
    if (!this.started || !this.runLock.isHeld()) {
      throw new Error("runtime must be started before starting a new session")
    }
    await this.adapter.startSession({ projectDir: this.projectDir, objective: this.specSummary?.objective ?? "" })
    this.startExecutorEventPump()
    return { adapter: await this.adapter.getStatus() }
  }

  async viewRecords(): Promise<{ events: unknown[] }> {
    return { events: redactValue(await this.eventStore.readAll()) }
  }

  listResearchTopics(query?: string, options?: SearchOptions): Topic[] {
    this.ensureResearchProjectionUsable("read")
    const db = this.getResearchDb()
    const topics = query === undefined ? db.listTopics() : db.searchTopics(query, options)
    return redactValue(topics)
  }

  getResearchTopicSnapshot(topicId: string): TopicSnapshot | null {
    this.ensureResearchProjectionUsable("read")
    return redactValue(this.getResearchDb().getTopicSnapshot(topicId))
  }

  listResearchEvents(options?: ListResearchEventsOptions): ResearchEvent[] {
    this.ensureResearchProjectionUsable("read")
    return redactValue(this.getResearchDb().listResearchEvents(options))
  }

  searchResearchNotes(topicId: string, query: string, options?: SearchOptions): Note[] {
    this.ensureResearchProjectionUsable("read")
    return redactValue(this.getResearchDb().searchNotes(topicId, query, options))
  }

  researchProjectionStatus(): RuntimeResearchProjectionHealth {
    this.checkResearchProjectionForStatus()
    return redactValue(this.researchProjectionHealth)
  }

  async rebuildResearchProjection(options: { force: boolean } = { force: false }): Promise<RuntimeResearchProjectionHealth> {
    if (this.researchProjectionMode === "disabled") {
      this.researchProjectionHealth = this.disabledProjectionHealth()
      return redactValue(this.researchProjectionHealth)
    }
    if (!options.force) {
      const integrity = this.checkResearchProjectionForStatus()
      if (integrity.ok && !integrity.stale) return redactValue(this.researchProjectionHealth)
      if (!integrity.stale) throw new Error(`research projection corrupt: ${integrity.reason ?? "unknown"}`)
    }
    await this.withProjectionWriteLock(() => this.rebuildProjection("command"))
    const integrity = this.checkResearchProjectionForStatus({ emit: true })
    if (!integrity.ok || integrity.stale) {
      throw new Error(`research projection rebuild did not produce a usable projection: ${integrity.reason ?? "unknown"}`)
    }
    return redactValue(this.researchProjectionHealth)
  }

  async submitUserMessage(message: string): Promise<{ accepted: true }> {
    if (this.mode !== "active") {
      throw new Error("runtime.submit_user_message requires active mode")
    }
    if (!this.started || !this.runLock.isHeld()) {
      throw new Error("runtime must be started before accepting user messages")
    }
    await this.adapter.sendMissionPacket({ missionId: "runtime-message", message })
    this.eventBus.emit({ type: "ExecutorLifecycle", phase: "fake-user-message", message })
    return { accepted: true }
  }

  async shutdown(reason = "shutdown"): Promise<void> {
    let firstError: unknown = null
    if (this.started || this.runLock.isHeld()) {
      this.eventBus.emit({ type: "RuntimeShutdown", reason })
      try {
        await this.adapter.shutdown()
      } catch (error) {
        firstError ??= error
        this.eventBus.emit({
          type: "ExecutorLifecycle",
          phase: "runtime-adapter-shutdown-error",
          message: error instanceof Error ? error.message : String(error),
        })
      }
      this.executorStreamAbort = true
      try {
        await this.eventStore.append({ kind: "runtime_shutdown", reason })
      } catch (error) {
        firstError ??= error
        this.eventBus.emit({
          type: "ExecutorLifecycle",
          phase: "runtime-shutdown-event-error",
          message: error instanceof Error ? error.message : String(error),
        })
      } finally {
        try {
          await this.runLock.release()
        } finally {
          this.started = false
        }
      }
    } else {
      this.executorStreamAbort = true
    }
    this.closeOwnedResearchDb(firstError)
    if (firstError) throw firstError
  }

  private getResearchDb(): RuntimeResearchDbProjection {
    if (!this.researchDb) this.researchDb = assertProjectionDb(this.researchDbFactory(this.projectDir))
    return assertProjectionDb(this.researchDb)
  }

  private ensureResearchProjectionUsable(operation: "startup" | "read"): void {
    if (this.researchProjectionMode === "disabled") {
      this.researchProjectionHealth = this.disabledProjectionHealth()
      return
    }

    const integrity = this.checkResearchProjectionForStatus({ emit: true })
    if (integrity.ok && !integrity.stale) return
    if (integrity.stale && this.researchProjectionMode === "auto_rebuild") {
      this.requireProjectionWriteLock(`research projection auto-rebuild during ${operation}`)
      this.rebuildProjection(operation)
      const rebuilt = this.checkResearchProjectionForStatus({ emit: true })
      if (rebuilt.ok && !rebuilt.stale) return
      throw new Error(`research projection rebuild did not produce a usable projection: ${rebuilt.reason ?? "unknown"}`)
    }

    const reason = integrity.reason ?? (integrity.stale ? "stale" : "unknown")
    if (integrity.stale) throw new Error(`research projection stale: ${reason}`)
    throw new Error(`research projection corrupt: ${reason}`)
  }

  private checkResearchProjectionForStatus(options: { emit?: boolean } = {}): ResearchProjectionIntegrity {
    if (this.researchProjectionMode === "disabled") {
      this.researchProjectionHealth = this.disabledProjectionHealth()
      return { ok: true, stale: false }
    }

    let integrity: ResearchProjectionIntegrity
    try {
      integrity = this.getResearchDb().checkProjectionIntegrity(this.eventStore.eventsPath)
    } catch (error) {
      integrity = { ok: false, stale: false, reason: error instanceof Error ? error.message : String(error) }
    }
    this.updateResearchProjectionHealth(integrity)
    if (options.emit) {
      this.emitResearchProjectionEvent(integrity.ok ? "ResearchProjectionChecked" : integrity.stale ? "ResearchProjectionStale" : "ResearchProjectionCorrupt")
    }
    return integrity
  }

  private rebuildProjection(operation: "startup" | "read" | "command"): void {
    this.emitResearchProjectionEvent("ResearchProjectionRebuildStarted", `research projection rebuild started during ${operation}`)
    try {
      this.getResearchDb().rebuildFromEvents(this.eventStore.eventsPath)
      const status = this.getResearchDb().getProjectionStatus()
      this.researchProjectionHealth = {
        ...this.researchProjectionHealth,
        ok: true,
        stale: false,
        reason: undefined,
        last_event_id: status.last_event_id ?? undefined,
        pending_count: 0,
        rebuilt_at: status.rebuilt_at ?? undefined,
        checked_at: new Date().toISOString(),
      }
      this.emitResearchProjectionEvent("ResearchProjectionRebuilt")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.researchProjectionHealth = {
        ...this.researchProjectionHealth,
        ok: false,
        stale: false,
        reason: message,
        checked_at: new Date().toISOString(),
      }
      this.emitResearchProjectionEvent("ResearchProjectionRebuildFailed")
      throw new Error(`research projection rebuild failed: ${message}`)
    }
  }

  private requireProjectionWriteLock(operation: string): void {
    if (!this.runLock.isHeld()) throw new Error(`${operation} requires runtime start with run lock held`)
  }

  private async withProjectionWriteLock<T>(operation: () => T): Promise<T> {
    if (this.runLock.isHeld()) return operation()
    await this.runLock.acquire()
    try {
      return operation()
    } finally {
      await this.runLock.release()
    }
  }

  private updateResearchProjectionHealth(integrity: ResearchProjectionIntegrity): void {
    let status: ResearchProjectionStatus | null = null
    try {
      status = this.getResearchDb().getProjectionStatus()
    } catch {
      status = null
    }
    this.researchProjectionHealth = {
      mode: this.researchProjectionMode,
      ok: integrity.ok,
      stale: integrity.stale,
      reason: integrity.reason,
      last_event_id: integrity.last_event_id ?? status?.last_event_id ?? undefined,
      pending_count: integrity.pending_count ?? 0,
      rebuilt_at: status?.rebuilt_at ?? undefined,
      checked_at: new Date().toISOString(),
    }
  }

  private emitResearchProjectionEvent(type: ResearchProjectionRuntimeEventType, reason?: string): void {
    this.eventBus.emit({
      type,
      mode: this.researchProjectionHealth.mode,
      ok: this.researchProjectionHealth.ok,
      stale: this.researchProjectionHealth.stale,
      reason: reason ?? this.researchProjectionHealth.reason,
      last_event_id: this.researchProjectionHealth.last_event_id,
      pending_count: this.researchProjectionHealth.pending_count,
      rebuilt_at: this.researchProjectionHealth.rebuilt_at,
      checked_at: this.researchProjectionHealth.checked_at ?? new Date().toISOString(),
    })
  }

  private disabledProjectionHealth(): RuntimeResearchProjectionHealth {
    return { mode: "disabled", ok: true, stale: false, reason: "disabled", pending_count: 0, checked_at: new Date().toISOString() }
  }

  private closeOwnedResearchDb(firstError: unknown): void {
    if (!this.researchDb || !this.ownsResearchDb) return
    try {
      this.researchDb.close()
      this.researchDb = null
    } catch (error) {
      if (!firstError) throw error
      this.eventBus.emit({
        type: "ExecutorLifecycle",
        phase: "runtime-research-db-close-error",
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

type ResearchProjectionRuntimeEventType = Extract<RuntimeEvent, { type: `ResearchProjection${string}` }>["type"]

function assertProjectionDb(db: RuntimeResearchDbProjection): RuntimeResearchDbProjection {
  const candidate = db as Partial<RuntimeResearchDbProjection>
  for (const method of ["checkProjectionIntegrity", "rebuildFromEvents", "getProjectionStatus"] as const) {
    if (typeof candidate[method] !== "function") throw new Error(`researchDb must support Branch 4D projection API: missing ${method}`)
  }
  return db
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return value
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${field} must be a string`)
  return value
}

function readResearchEventsOptions(value: unknown): ListResearchEventsOptions | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("options must be an object")
  return value as ListResearchEventsOptions
}

function readSearchOptions(value: unknown): SearchOptions | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("options must be an object")
  return value as SearchOptions
}

function readRebuildProjectionOptions(value: unknown): { force: boolean } {
  if (value === undefined) return { force: false }
  if (!isRecord(value)) throw new Error("options must be an object")
  if (value.force !== undefined && typeof value.force !== "boolean") throw new Error("force must be a boolean")
  return { force: value.force ?? false }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
