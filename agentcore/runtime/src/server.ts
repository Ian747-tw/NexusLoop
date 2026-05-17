import { join } from "node:path"
import { EventStore } from "./events/event-store"
import { RuntimeEventBus } from "./events/event-bus"
import type { RuntimeEvent, RuntimeMode, RuntimeResearchProjectionHealth, RuntimeResearchProjectionMode, RuntimeStatus } from "./events/event-types"
import { modeRequiresApprovedSpec } from "./project/project-status"
import { locateProjectRoot, projectName } from "./project/project-root"
import { RunLock } from "./project/run-lock"
import { FakeOpenCodeAdapter } from "./opencode/fake-adapter"
import type { ExecutorToolHandlerAdapter, OpenCodeRuntimeAdapter } from "./opencode/adapter"
import { createOpenCodeAdapter, type OpenCodeAdapterConfig, type OpenCodeAdapterFactoryOptions } from "./opencode/adapter-config"
import { MissionRegistry } from "./missions/mission-registry"
import type { ExecutorClaim, MissionProgress, MissionRecord, MissionResult, MissionStatusSummary } from "./missions/mission-types"
import { ReviewRegistry } from "./missions/review-registry"
import type { ReviewRequest, ReviewRequestInput, ReviewStatus, ReviewStatusSummary } from "./missions/review-types"
import { MissionToolRouter } from "./missions/mission-tool-router"
import type { ExecutorToolCall, ExecutorToolResult } from "./missions/mission-tool-types"
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

const EXECUTOR_SHUTDOWN_DRAIN_TIMEOUT_MS = 50

export interface RuntimeServerOptions {
  projectDir?: string
  mode?: RuntimeMode
  adapter?: OpenCodeRuntimeAdapter
  openCodeAdapterConfig?: OpenCodeAdapterConfig
  openCodeAdapterFactoryOptions?: Omit<OpenCodeAdapterFactoryOptions, "projectDir">
  missionRegistry?: MissionRegistry
  reviewRegistry?: ReviewRegistry
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
  readonly missionRegistry: MissionRegistry
  readonly reviewRegistry: ReviewRegistry
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
    this.adapter = options.adapter ?? (options.openCodeAdapterConfig ? createOpenCodeAdapter(options.openCodeAdapterConfig, { ...options.openCodeAdapterFactoryOptions, projectDir: this.projectDir }) : new FakeOpenCodeAdapter())
    this.registerExecutorToolHandler(this.adapter)
    this.missionRegistry = options.missionRegistry ?? new MissionRegistry({ eventStore: this.eventStore, projectDir: this.projectDir })
    this.reviewRegistry = options.reviewRegistry ?? new ReviewRegistry({ eventStore: this.eventStore, missionRegistry: this.missionRegistry })
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

  private async drainExecutorEventPumpAfterShutdown(): Promise<void> {
    const streamTask = this.executorStreamTask
    if (!streamTask) return
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const timedOut = Symbol("executor-shutdown-drain-timeout")
    const result = await Promise.race([
      streamTask.then(() => undefined),
      new Promise<typeof timedOut>((resolve) => {
        timeoutId = setTimeout(() => resolve(timedOut), EXECUTOR_SHUTDOWN_DRAIN_TIMEOUT_MS)
      }),
    ])
    if (timeoutId) clearTimeout(timeoutId)
    if (result === timedOut) this.executorStreamAbort = true
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
      case "runtime.get_mission":
        return this.getMission(requiredString(payload.missionId ?? payload.mission_id, "missionId"))
      case "runtime.list_recent_missions":
        return this.listRecentMissions(optionalPositiveInteger(payload.limit, "limit", 100))
      case "runtime.claim_mission":
        return this.claimMission({
          mission_id: requiredString(payload.missionId ?? payload.mission_id, "missionId"),
          executor_id: requiredString(payload.executorId ?? payload.executor_id, "executorId"),
        })
      case "runtime.record_mission_progress":
        return this.recordMissionProgress({
          mission_id: requiredString(payload.missionId ?? payload.mission_id, "missionId"),
          claim_id: requiredString(payload.claimId ?? payload.claim_id, "claimId"),
          message: requiredString(payload.message, "message"),
        })
      case "runtime.submit_mission_result":
        return this.submitMissionResult({
          mission_id: requiredString(payload.missionId ?? payload.mission_id, "missionId"),
          claim_id: requiredString(payload.claimId ?? payload.claim_id, "claimId"),
          summary: requiredString(payload.summary, "summary"),
          artifacts: optionalStringArray(payload.artifacts, "artifacts"),
          research_result_ids: optionalStringArray(payload.researchResultIds ?? payload.research_result_ids, "researchResultIds"),
        })
      case "runtime.complete_mission":
        return this.completeMission(requiredString(payload.missionId ?? payload.mission_id, "missionId"), {
          result_id: optionalString(payload.resultId ?? payload.result_id, "resultId"),
          summary: optionalString(payload.summary, "summary"),
        })
      case "runtime.fail_mission":
        return this.failMission(requiredString(payload.missionId ?? payload.mission_id, "missionId"), requiredString(payload.reason, "reason"))
      case "runtime.cancel_mission":
        return this.cancelMission(requiredString(payload.missionId ?? payload.mission_id, "missionId"), optionalString(payload.reason, "reason"))
      case "runtime.release_mission_claim":
        return this.releaseMissionClaim(requiredString(payload.claimId ?? payload.claim_id, "claimId"), optionalString(payload.reason, "reason"))
      case "runtime.list_mission_claims":
        return this.listMissionClaims(requiredString(payload.missionId ?? payload.mission_id, "missionId"))
      case "runtime.list_mission_progress":
        return this.listMissionProgress(requiredString(payload.missionId ?? payload.mission_id, "missionId"))
      case "runtime.list_mission_results":
        return this.listMissionResults(requiredString(payload.missionId ?? payload.mission_id, "missionId"))
      case "runtime.create_review_request":
        return this.createReviewRequest({
          mission_id: optionalString(payload.missionId ?? payload.mission_id, "missionId"),
          claim_id: optionalString(payload.claimId ?? payload.claim_id, "claimId"),
          result_id: optionalString(payload.resultId ?? payload.result_id, "resultId"),
          request_type: optionalString(payload.requestType ?? payload.request_type, "requestType") as ReviewRequestInput["request_type"],
          title: requiredString(payload.title, "title"),
          summary: requiredString(payload.summary, "summary"),
          requested_by: requiredString(payload.requestedBy ?? payload.requested_by, "requestedBy"),
        })
      case "runtime.get_review_request":
        return this.getReviewRequest(requiredString(payload.reviewId ?? payload.review_id, "reviewId"))
      case "runtime.list_review_requests":
        return this.listReviewRequests({
          status: optionalString(payload.status, "status") as ReviewStatus | undefined,
          limit: optionalPositiveInteger(payload.limit, "limit", 100),
        })
      case "runtime.approve_review_request":
        return this.approveReviewRequest(requiredString(payload.reviewId ?? payload.review_id, "reviewId"), requiredString(payload.decidedBy ?? payload.decided_by, "decidedBy"), optionalString(payload.reason, "reason"))
      case "runtime.reject_review_request":
        return this.rejectReviewRequest(requiredString(payload.reviewId ?? payload.review_id, "reviewId"), requiredString(payload.decidedBy ?? payload.decided_by, "decidedBy"), optionalString(payload.reason, "reason"))
      case "runtime.cancel_review_request":
        return this.cancelReviewRequest(requiredString(payload.reviewId ?? payload.review_id, "reviewId"), requiredString(payload.decidedBy ?? payload.decided_by, "decidedBy"), optionalString(payload.reason, "reason"))
      case "runtime.review_status":
        return this.reviewStatusSummary()
      case "runtime.shutdown":
        return this.shutdown(String(payload.reason ?? "command"))
      default:
        throw new Error(`unknown runtime command: ${name}`)
    }
  }

  async status(): Promise<RuntimeStatus> {
    this.checkResearchProjectionForStatus()
    const policy = await this.policyService.metadata()
    const adapterStatus = await this.adapter.getStatus()
    return redactValue({
      projectDir: this.projectDir,
      projectName: projectName(this.projectDir),
      mode: this.mode,
      specApproved: this.specSummary?.status === "approved",
      runtimeStatus: this.started ? "started" : "created",
      lockHeld: this.runLock.isHeld(),
      fakeOpenCode: String(adapterStatus.message ?? ""),
      adapterStatus,
      executorStreamError: this.executorStreamError ?? undefined,
      missions: await this.missionRegistry.statusSummary(),
      reviews: await this.reviewRegistry.statusSummary(),
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

  async submitUserMessage(message: string): Promise<{ accepted: true; missionId: string; intentId: string }> {
    if (this.mode !== "active") {
      throw new Error("runtime.submit_user_message requires active mode")
    }
    if (!this.started || !this.runLock.isHeld()) {
      throw new Error("runtime must be started before accepting user messages")
    }
    const { intent, mission } = await this.missionRegistry.createUserMessageMission(message)
    const packet = this.missionRegistry.createPacket(mission, message)
    try {
      await this.adapter.sendMissionPacket(packet)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.missionRegistry.markMissionFailed(mission.mission_id, message)
      throw new Error(`mission ${mission.mission_id} adapter delivery failed: ${redactValue(message)}`)
    }
    try {
      await this.missionRegistry.markMissionSent(mission.mission_id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`mission ${mission.mission_id} adapter delivery succeeded but sent-state persistence failed: ${redactValue(message)}`)
    }
    this.eventBus.emit({ type: "ExecutorLifecycle", phase: "mission-packet-sent", message: `Mission ${mission.mission_id} sent to adapter` })
    return { accepted: true, missionId: mission.mission_id, intentId: intent.intent_id }
  }

  async getMission(missionId: string): Promise<MissionRecord | null> {
    return this.missionRegistry.getMission(missionId)
  }

  async listRecentMissions(limit?: number): Promise<MissionRecord[]> {
    return this.missionRegistry.listRecentMissions(limit)
  }

  async missionStatusSummary(): Promise<MissionStatusSummary> {
    return this.missionRegistry.statusSummary()
  }

  async createReviewRequest(input: ReviewRequestInput): Promise<ReviewRequest> {
    this.requireReviewWriteRuntime("runtime.create_review_request")
    return this.reviewRegistry.createReviewRequest(input)
  }

  async getReviewRequest(reviewId: string): Promise<ReviewRequest | null> {
    return this.reviewRegistry.getReviewRequest(reviewId)
  }

  async listReviewRequests(options: { status?: ReviewStatus; limit?: number } = {}): Promise<ReviewRequest[]> {
    return this.reviewRegistry.listReviewRequests(options)
  }

  async approveReviewRequest(reviewId: string, decidedBy: string, reason?: string): Promise<ReviewRequest> {
    this.requireReviewWriteRuntime("runtime.approve_review_request")
    return this.reviewRegistry.approveReviewRequest(reviewId, decidedBy, reason)
  }

  async rejectReviewRequest(reviewId: string, decidedBy: string, reason?: string): Promise<ReviewRequest> {
    this.requireReviewWriteRuntime("runtime.reject_review_request")
    return this.reviewRegistry.rejectReviewRequest(reviewId, decidedBy, reason)
  }

  async cancelReviewRequest(reviewId: string, decidedBy: string, reason?: string): Promise<ReviewRequest> {
    this.requireReviewWriteRuntime("runtime.cancel_review_request")
    return this.reviewRegistry.cancelReviewRequest(reviewId, decidedBy, reason)
  }

  async reviewStatusSummary(): Promise<ReviewStatusSummary> {
    return this.reviewRegistry.statusSummary()
  }

  async executeMissionTool(call: ExecutorToolCall): Promise<ExecutorToolResult> {
    const router = new MissionToolRouter({
      handlers: {
        getMission: this.getMission.bind(this),
        listRecentMissions: this.listRecentMissions.bind(this),
        claimMission: this.claimMission.bind(this),
        recordMissionProgress: this.recordMissionProgress.bind(this),
        submitMissionResult: this.submitMissionResult.bind(this),
        completeMission: this.completeMission.bind(this),
        failMission: this.failMission.bind(this),
        cancelMission: this.cancelMission.bind(this),
        releaseMissionClaim: this.releaseMissionClaim.bind(this),
        listMissionClaims: this.listMissionClaims.bind(this),
        listMissionProgress: this.listMissionProgress.bind(this),
        listMissionResults: this.listMissionResults.bind(this),
      },
    })
    return router.handle(call)
  }

  private registerExecutorToolHandler(adapter: OpenCodeRuntimeAdapter): void {
    if (!isExecutorToolHandlerAdapter(adapter)) return
    adapter.setExecutorToolHandler((call) => this.executeMissionTool(call))
  }

  async claimMission(input: { mission_id: string; executor_id: string }): Promise<ExecutorClaim> {
    this.requireMissionWriteRuntime("runtime.claim_mission")
    return this.missionRegistry.claimMission(input)
  }

  async recordMissionProgress(input: { mission_id: string; claim_id: string; message: string }): Promise<MissionProgress> {
    this.requireMissionWriteRuntime("runtime.record_mission_progress")
    return this.missionRegistry.recordMissionProgress(input)
  }

  async submitMissionResult(input: { mission_id: string; claim_id: string; summary: string; artifacts?: string[]; research_result_ids?: string[] }): Promise<MissionResult> {
    this.requireMissionWriteRuntime("runtime.submit_mission_result")
    return this.missionRegistry.submitMissionResult(input)
  }

  async completeMission(missionId: string, input: { result_id?: string; summary?: string } = {}): Promise<MissionRecord> {
    this.requireMissionWriteRuntime("runtime.complete_mission")
    return this.missionRegistry.completeMission(missionId, input)
  }

  async failMission(missionId: string, reason: string): Promise<MissionRecord> {
    this.requireMissionWriteRuntime("runtime.fail_mission")
    return this.missionRegistry.failMission(missionId, reason)
  }

  async cancelMission(missionId: string, reason?: string): Promise<MissionRecord> {
    this.requireMissionWriteRuntime("runtime.cancel_mission")
    return this.missionRegistry.cancelMission(missionId, reason)
  }

  async releaseMissionClaim(claimId: string, reason?: string): Promise<ExecutorClaim> {
    this.requireMissionWriteRuntime("runtime.release_mission_claim")
    return this.missionRegistry.releaseMissionClaim(claimId, reason)
  }

  async listMissionClaims(missionId: string): Promise<ExecutorClaim[]> {
    return this.missionRegistry.listMissionClaims(missionId)
  }

  async listMissionProgress(missionId: string): Promise<MissionProgress[]> {
    return this.missionRegistry.listMissionProgress(missionId)
  }

  async listMissionResults(missionId: string): Promise<MissionResult[]> {
    return this.missionRegistry.listMissionResults(missionId)
  }

  async shutdown(reason = "shutdown"): Promise<void> {
    let firstError: unknown = null
    if (this.started || this.runLock.isHeld()) {
      this.eventBus.emit({ type: "RuntimeShutdown", reason })
      try {
        await this.adapter.shutdown()
        await this.drainExecutorEventPumpAfterShutdown()
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

  private requireMissionWriteRuntime(commandName: string): void {
    if (this.mode !== "active") throw new Error(`${commandName} requires active mode`)
    if (!this.started || !this.runLock.isHeld()) throw new Error("runtime must be started before mission execution writes")
  }

  private requireReviewWriteRuntime(commandName: string): void {
    if (this.mode !== "active") throw new Error(`${commandName} requires active mode`)
    if (!this.started || !this.runLock.isHeld()) throw new Error("runtime must be started before review writes")
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

function isExecutorToolHandlerAdapter(adapter: OpenCodeRuntimeAdapter): adapter is OpenCodeRuntimeAdapter & ExecutorToolHandlerAdapter {
  return typeof (adapter as Partial<ExecutorToolHandlerAdapter>).setExecutorToolHandler === "function"
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${field} must be a string`)
  if (!value.trim()) throw new Error(`${field} must be nonblank`)
  return value.trim()
}

function optionalPositiveInteger(value: unknown, field: string, max = 1000): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${field} must be a positive integer`)
  if (Number(value) > max) throw new Error(`${field} must be no greater than ${max}`)
  return Number(value)
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value.map((item, index) => requiredString(item, `${field}[${index}]`))
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
