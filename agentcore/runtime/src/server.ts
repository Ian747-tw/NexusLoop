import { join } from "node:path"
import { EventStore } from "./events/event-store"
import { RuntimeEventBus } from "./events/event-bus"
import type { RuntimeMode, RuntimeStatus } from "./events/event-types"
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
  type ResearchEvent,
  type SearchOptions,
  type Topic,
  type TopicSnapshot,
} from "./research-db/research-db"

export interface RuntimeServerOptions {
  projectDir?: string
  mode?: RuntimeMode
  adapter?: OpenCodeRuntimeAdapter
  researchDb?: RuntimeResearchDbReader
  researchDbFactory?: (projectDir: string) => RuntimeResearchDbReader
}

export interface RuntimeResearchDbReader {
  close(): void
  listTopics(): Topic[]
  searchTopics(query: string, options?: SearchOptions): Topic[]
  getTopicSnapshot(topicId: string): TopicSnapshot | null
  listResearchEvents(options?: ListResearchEventsOptions): ResearchEvent[]
  searchNotes(topicId: string, query: string, options?: SearchOptions): Note[]
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
  private readonly researchDbFactory: (projectDir: string) => RuntimeResearchDbReader
  private readonly ownsResearchDb: boolean
  private researchDb: RuntimeResearchDbReader | null = null
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
    this.researchDb = options.researchDb ?? null
    this.ownsResearchDb = options.researchDb === undefined
    this.researchDbFactory = options.researchDbFactory ?? ((projectDir) => ResearchDb.open(projectDir))
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
      case "runtime.submit_user_message":
        return this.submitUserMessage(String(payload.message ?? ""))
      case "runtime.shutdown":
        return this.shutdown(String(payload.reason ?? "command"))
      default:
        throw new Error(`unknown runtime command: ${name}`)
    }
  }

  async status(): Promise<RuntimeStatus> {
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
    const db = this.getResearchDb()
    const topics = query === undefined ? db.listTopics() : db.searchTopics(query, options)
    return redactValue(topics)
  }

  getResearchTopicSnapshot(topicId: string): TopicSnapshot | null {
    return redactValue(this.getResearchDb().getTopicSnapshot(topicId))
  }

  listResearchEvents(options?: ListResearchEventsOptions): ResearchEvent[] {
    return redactValue(this.getResearchDb().listResearchEvents(options))
  }

  searchResearchNotes(topicId: string, query: string, options?: SearchOptions): Note[] {
    return redactValue(this.getResearchDb().searchNotes(topicId, query, options))
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
    this.executorStreamAbort = true
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
    }
    this.closeOwnedResearchDb(firstError)
    if (firstError) throw firstError
  }

  private getResearchDb(): RuntimeResearchDbReader {
    if (!this.researchDb) this.researchDb = this.researchDbFactory(this.projectDir)
    return this.researchDb
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
