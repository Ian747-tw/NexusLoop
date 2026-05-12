import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import {
  MISSION_PROTOCOL_VERSION,
  type ClaimMissionInput,
  type CompleteMissionInput,
  type ExecutorClaim,
  type MissionCreatedResult,
  type MissionPacket,
  type MissionProgress,
  type MissionProgressInput,
  type MissionRecord,
  type MissionResult,
  type MissionResultInput,
  type MissionStatusSummary,
  type WorkIntent,
} from "./mission-types"

export interface MissionRegistryOptions {
  eventStore: EventStore
  projectDir: string
  idFactory?: (prefix: "intent" | "mission" | "claim" | "progress" | "result") => string
  now?: () => Date
}

type MissionEvent =
  | { kind: "work_intent_created"; intent: WorkIntent }
  | { kind: "mission_created"; mission: MissionRecord }
  | { kind: "mission_sent"; mission_id: string; intent_id: string; sent_at: string }
  | { kind: "mission_claimed"; claim: ExecutorClaim }
  | { kind: "mission_progress_recorded"; progress: MissionProgress }
  | { kind: "mission_result_submitted"; result: MissionResult }
  | { kind: "mission_completed"; mission_id: string; intent_id: string; completed_at: string; result_id?: string; summary?: string }
  | { kind: "mission_failed"; mission_id: string; intent_id: string; failed_at: string; failure_reason: string }
  | { kind: "mission_cancelled"; mission_id: string; intent_id: string; cancelled_at: string; cancellation_reason?: string }
  | { kind: "mission_claim_released"; claim_id: string; mission_id: string; released_at: string; release_reason?: string }

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"])

export class MissionRegistry {
  private readonly eventStore: EventStore
  private readonly projectDir: string
  private readonly idFactory: (prefix: "intent" | "mission" | "claim" | "progress" | "result") => string
  private readonly now: () => Date
  private hydrated = false
  private generatedIds = 0
  private readonly intents = new Map<string, WorkIntent>()
  private readonly missions = new Map<string, MissionRecord>()
  private readonly missionOrder: string[] = []
  private readonly claims = new Map<string, ExecutorClaim>()
  private readonly claimsByMission = new Map<string, string[]>()
  private readonly progress = new Map<string, MissionProgress>()
  private readonly progressByMission = new Map<string, string[]>()
  private readonly results = new Map<string, MissionResult>()
  private readonly resultsByMission = new Map<string, string[]>()
  private hydrateTask: Promise<void> | null = null
  private mutationTask: Promise<void> = Promise.resolve()

  constructor(options: MissionRegistryOptions) {
    this.eventStore = options.eventStore
    this.projectDir = options.projectDir
    this.idFactory = options.idFactory ?? ((prefix) => `${prefix}_${Date.now().toString(36)}_${++this.generatedIds}`)
    this.now = options.now ?? (() => new Date())
  }

  async createUserMessageMission(message: string): Promise<MissionCreatedResult> {
    await this.hydrate()
    const createdAt = this.isoNow()
    const intent: WorkIntent = {
      intent_id: this.idFactory("intent"),
      kind: "user_message",
      message: redactText(message),
      created_at: createdAt,
      status: "created",
    }
    const mission: MissionRecord = {
      mission_id: this.idFactory("mission"),
      intent_id: intent.intent_id,
      project_dir: this.projectDir,
      objective: redactText(message),
      status: "created",
      created_at: createdAt,
      updated_at: createdAt,
    }

    await this.appendAndApply({ kind: "work_intent_created", intent })
    await this.appendAndApply({ kind: "mission_created", mission })
    return redactValue({ intent, mission })
  }

  createPacket(mission: MissionRecord, message: string): MissionPacket {
    return {
      missionId: mission.mission_id,
      intentId: mission.intent_id,
      message,
      objective: message,
      createdAt: mission.created_at,
      protocolVersion: MISSION_PROTOCOL_VERSION,
    }
  }

  async markMissionSent(missionId: string): Promise<MissionRecord> {
    await this.hydrate()
    const mission = this.requireMission(missionId)
    if (mission.status !== "created") throw new Error(`mission must be created before sent: ${missionId}`)
    const sentAt = this.isoNow()
    await this.appendAndApply({ kind: "mission_sent", mission_id: mission.mission_id, intent_id: mission.intent_id, sent_at: sentAt })
    return redactValue(this.requireMission(missionId))
  }

  async claimMission(input: ClaimMissionInput): Promise<ExecutorClaim> {
    return this.serializeMutation(async () => {
      await this.hydrate()
      const missionId = cleanRequiredString(input.mission_id, "mission_id")
      const executorId = cleanRequiredString(input.executor_id, "executor_id")
      const mission = this.requireMission(missionId)
      this.assertNotTerminal(mission, "claim")
      if (this.activeClaimForMission(missionId)) throw new Error(`mission already has an active claim: ${missionId}`)
      if (mission.status !== "sent") throw new Error(`mission must be sent before claim: ${missionId}`)
      const claimedAt = this.isoNow()
      const claim: ExecutorClaim = {
        claim_id: this.idFactory("claim"),
        mission_id: missionId,
        executor_id: redactText(executorId),
        claimed_at: claimedAt,
        status: "active",
      }
      await this.appendAndApply({ kind: "mission_claimed", claim })
      return redactValue(this.requireClaim(claim.claim_id))
    })
  }

  async getMissionClaim(claimId: string): Promise<ExecutorClaim | null> {
    await this.hydrate()
    return redactValue(this.claims.get(cleanRequiredString(claimId, "claim_id")) ?? null)
  }

  async listMissionClaims(missionId: string): Promise<ExecutorClaim[]> {
    await this.hydrate()
    return redactValue((this.claimsByMission.get(cleanRequiredString(missionId, "mission_id")) ?? []).map((claimId) => this.requireClaim(claimId)))
  }

  async recordMissionProgress(input: MissionProgressInput): Promise<MissionProgress> {
    await this.hydrate()
    const missionId = cleanRequiredString(input.mission_id, "mission_id")
    const claimId = cleanRequiredString(input.claim_id, "claim_id")
    const message = cleanRequiredString(input.message, "message")
    const mission = this.requireMission(missionId)
    this.assertNotTerminal(mission, "record progress")
    this.requireActiveClaim(missionId, claimId)
    const createdAt = this.isoNow()
    const progress: MissionProgress = {
      progress_id: this.idFactory("progress"),
      mission_id: missionId,
      claim_id: claimId,
      message: redactText(message),
      created_at: createdAt,
    }
    await this.appendAndApply({ kind: "mission_progress_recorded", progress })
    return redactValue(this.requireProgress(progress.progress_id))
  }

  async listMissionProgress(missionId: string): Promise<MissionProgress[]> {
    await this.hydrate()
    return redactValue((this.progressByMission.get(cleanRequiredString(missionId, "mission_id")) ?? []).map((progressId) => this.requireProgress(progressId)))
  }

  async submitMissionResult(input: MissionResultInput): Promise<MissionResult> {
    await this.hydrate()
    const missionId = cleanRequiredString(input.mission_id, "mission_id")
    const claimId = cleanRequiredString(input.claim_id, "claim_id")
    const summary = cleanRequiredString(input.summary, "summary")
    const mission = this.requireMission(missionId)
    this.assertNotTerminal(mission, "submit result")
    this.requireActiveClaim(missionId, claimId)
    const createdAt = this.isoNow()
    const result: MissionResult = {
      result_id: this.idFactory("result"),
      mission_id: missionId,
      claim_id: claimId,
      summary: redactText(summary),
      artifacts: cleanOptionalStringArray(input.artifacts, "artifacts"),
      research_result_ids: cleanOptionalStringArray(input.research_result_ids, "research_result_ids"),
      created_at: createdAt,
      status: "submitted",
    }
    await this.appendAndApply({ kind: "mission_result_submitted", result })
    return redactValue(this.requireResult(result.result_id))
  }

  async getMissionResult(resultId: string): Promise<MissionResult | null> {
    await this.hydrate()
    return redactValue(this.results.get(cleanRequiredString(resultId, "result_id")) ?? null)
  }

  async listMissionResults(missionId: string): Promise<MissionResult[]> {
    await this.hydrate()
    return redactValue((this.resultsByMission.get(cleanRequiredString(missionId, "mission_id")) ?? []).map((resultId) => this.requireResult(resultId)))
  }

  async completeMission(missionId: string, input: CompleteMissionInput = {}): Promise<MissionRecord> {
    return this.serializeMutation(async () => {
      await this.hydrate()
      const id = cleanRequiredString(missionId, "mission_id")
      const mission = this.requireMission(id)
      const resultId = input.result_id === undefined ? undefined : cleanRequiredString(input.result_id, "result_id")
      const summary = input.summary === undefined ? undefined : redactText(cleanRequiredString(input.summary, "summary"))
      if (mission.status === "completed") return redactValue(this.idempotentCompleted(mission, resultId ?? mission.completion_result_id, summary))
      this.assertNotTerminal(mission, "complete")
      const activeClaim = this.activeClaimForMission(id)
      if (!activeClaim) throw new Error(`mission completion requires an active claim: ${id}`)
      const result = resultId ? this.requireResult(resultId) : this.firstSubmittedResultForClaim(id, activeClaim.claim_id)
      if (!result || result.mission_id !== id || result.status !== "submitted") throw new Error(`mission completion requires a submitted result: ${id}`)
      if (result.claim_id !== activeClaim.claim_id) throw new Error(`mission completion result must belong to active claim: ${id}`)
      await this.appendAndApply({
        kind: "mission_completed",
        mission_id: mission.mission_id,
        intent_id: mission.intent_id,
        completed_at: this.isoNow(),
        result_id: result.result_id,
        summary,
      })
      return redactValue(this.requireMission(id))
    })
  }

  async failMission(missionId: string, reason: string): Promise<MissionRecord> {
    await this.hydrate()
    const id = cleanRequiredString(missionId, "mission_id")
    const failureReason = redactText(cleanRequiredString(reason, "reason"))
    const mission = this.requireMission(id)
    if (mission.status === "failed") return redactValue(this.idempotentFailed(mission, failureReason))
    this.assertNotTerminal(mission, "fail")
    if (!["sent", "claimed", "running"].includes(mission.status)) throw new Error(`mission can only fail from sent, claimed, or running: ${id}`)
    await this.appendAndApply({
      kind: "mission_failed",
      mission_id: mission.mission_id,
      intent_id: mission.intent_id,
      failed_at: this.isoNow(),
      failure_reason: failureReason,
    })
    return redactValue(this.requireMission(id))
  }

  async markMissionFailed(missionId: string, reason: string): Promise<MissionRecord> {
    await this.hydrate()
    const id = cleanRequiredString(missionId, "mission_id")
    const failureReason = redactText(cleanRequiredString(reason, "reason"))
    const mission = this.requireMission(id)
    if (mission.status === "failed") return redactValue(this.idempotentFailed(mission, failureReason))
    this.assertNotTerminal(mission, "fail")
    await this.appendAndApply({
      kind: "mission_failed",
      mission_id: mission.mission_id,
      intent_id: mission.intent_id,
      failed_at: this.isoNow(),
      failure_reason: failureReason,
    })
    return redactValue(this.requireMission(id))
  }

  async cancelMission(missionId: string, reason?: string): Promise<MissionRecord> {
    await this.hydrate()
    const id = cleanRequiredString(missionId, "mission_id")
    const cancellationReason = reason === undefined ? undefined : redactText(cleanRequiredString(reason, "reason"))
    const mission = this.requireMission(id)
    if (mission.status === "cancelled") return redactValue(this.idempotentCancelled(mission, cancellationReason))
    this.assertNotTerminal(mission, "cancel")
    await this.appendAndApply({
      kind: "mission_cancelled",
      mission_id: mission.mission_id,
      intent_id: mission.intent_id,
      cancelled_at: this.isoNow(),
      cancellation_reason: cancellationReason,
    })
    return redactValue(this.requireMission(id))
  }

  async releaseMissionClaim(claimId: string, reason?: string): Promise<ExecutorClaim> {
    await this.hydrate()
    const id = cleanRequiredString(claimId, "claim_id")
    const releaseReason = reason === undefined ? undefined : redactText(cleanRequiredString(reason, "reason"))
    const claim = this.requireClaim(id)
    if (claim.status !== "active") throw new Error(`mission claim is not active: ${id}`)
    this.assertNotTerminal(this.requireMission(claim.mission_id), "release claim")
    await this.appendAndApply({
      kind: "mission_claim_released",
      claim_id: claim.claim_id,
      mission_id: claim.mission_id,
      released_at: this.isoNow(),
      release_reason: releaseReason,
    })
    return redactValue(this.requireClaim(id))
  }

  async getMission(missionId: string): Promise<MissionRecord | null> {
    await this.hydrate()
    return redactValue(this.missions.get(cleanRequiredString(missionId, "mission_id")) ?? null)
  }

  async listRecentMissions(limit = 10): Promise<MissionRecord[]> {
    await this.hydrate()
    if (!Number.isInteger(limit) || limit < 1) throw new Error("mission list limit must be a positive integer")
    return redactValue(
      this.missionOrder
        .slice(-limit)
        .reverse()
        .map((missionId) => this.missions.get(missionId))
        .filter((mission): mission is MissionRecord => mission !== undefined),
    )
  }

  async statusSummary(): Promise<MissionStatusSummary> {
    await this.hydrate()
    const missions = [...this.missions.values()]
    const lastMissionId = this.missionOrder.at(-1)
    return {
      pending_count: missions.filter((mission) => mission.status === "created").length,
      failed_count: missions.filter((mission) => mission.status === "failed").length,
      active_claim_count: [...this.claims.values()].filter((claim) => claim.status === "active").length,
      completed_count: missions.filter((mission) => mission.status === "completed").length,
      cancelled_count: missions.filter((mission) => mission.status === "cancelled").length,
      last_mission_id: lastMissionId,
    }
  }

  private async hydrate(): Promise<void> {
    if (this.hydrated) return
    if (this.hydrateTask) return this.hydrateTask
    this.hydrateTask = (async () => {
      for (const event of await this.eventStore.readAll()) this.applyEvent(event)
      this.hydrated = true
    })()
    try {
      await this.hydrateTask
    } finally {
      this.hydrateTask = null
    }
  }

  private async appendAndApply(event: MissionEvent): Promise<void> {
    const safeEvent = redactValue(event)
    await this.eventStore.append(safeEvent)
    this.applyEvent(safeEvent)
  }

  private async serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTask
    let release!: () => void
    this.mutationTask = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  private applyEvent(event: JsonlEvent | MissionEvent): void {
    switch (event.kind) {
      case "work_intent_created":
        this.applyIntent(event.intent as WorkIntent)
        break
      case "mission_created":
        this.applyMission(event.mission as MissionRecord)
        break
      case "mission_sent":
        this.applyMissionSent(String(event.mission_id), String(event.sent_at))
        break
      case "mission_claimed":
        this.applyMissionClaimed(event.claim as ExecutorClaim)
        break
      case "mission_progress_recorded":
        this.applyMissionProgress(event.progress as MissionProgress)
        break
      case "mission_result_submitted":
        this.applyMissionResult(event.result as MissionResult)
        break
      case "mission_completed":
        this.applyMissionCompleted(String(event.mission_id), String(event.completed_at), optionalEventString(event.result_id), optionalEventString(event.summary))
        break
      case "mission_failed":
        this.applyMissionFailed(String(event.mission_id), String(event.failed_at), String(event.failure_reason))
        break
      case "mission_cancelled":
        this.applyMissionCancelled(String(event.mission_id), String(event.cancelled_at), optionalEventString(event.cancellation_reason))
        break
      case "mission_claim_released":
        this.applyMissionClaimReleased(String(event.claim_id), String(event.released_at), optionalEventString(event.release_reason))
        break
    }
  }

  private applyIntent(intent: WorkIntent): void {
    this.intents.set(intent.intent_id, redactValue(intent))
  }

  private applyMission(mission: MissionRecord): void {
    if (!this.missions.has(mission.mission_id)) this.missionOrder.push(mission.mission_id)
    this.missions.set(mission.mission_id, redactValue(mission))
  }

  private applyMissionSent(missionId: string, sentAt: string): void {
    const mission = this.requireMission(missionId)
    this.missions.set(missionId, redactValue({ ...mission, status: "sent", sent_at: sentAt, updated_at: sentAt }))
    this.updateIntentStatus(mission.intent_id, "sent")
  }

  private applyMissionClaimed(claim: ExecutorClaim): void {
    const safeClaim = redactValue(claim)
    const mission = this.requireMission(safeClaim.mission_id)
    this.claims.set(safeClaim.claim_id, safeClaim)
    pushUnique(this.claimsByMission, safeClaim.mission_id, safeClaim.claim_id)
    this.missions.set(safeClaim.mission_id, redactValue({ ...mission, status: "claimed", claimed_at: safeClaim.claimed_at, updated_at: safeClaim.claimed_at }))
  }

  private applyMissionProgress(progress: MissionProgress): void {
    const safeProgress = redactValue(progress)
    const mission = this.requireMission(safeProgress.mission_id)
    this.progress.set(safeProgress.progress_id, safeProgress)
    pushUnique(this.progressByMission, safeProgress.mission_id, safeProgress.progress_id)
    this.missions.set(safeProgress.mission_id, redactValue({ ...mission, status: "running", running_at: safeProgress.created_at, updated_at: safeProgress.created_at }))
  }

  private applyMissionResult(result: MissionResult): void {
    const safeResult = redactValue(result)
    const mission = this.requireMission(safeResult.mission_id)
    this.results.set(safeResult.result_id, safeResult)
    pushUnique(this.resultsByMission, safeResult.mission_id, safeResult.result_id)
    this.missions.set(safeResult.mission_id, redactValue({ ...mission, status: "running", running_at: mission.running_at ?? safeResult.created_at, updated_at: safeResult.created_at }))
  }

  private applyMissionCompleted(missionId: string, completedAt: string, resultId?: string, summary?: string): void {
    const mission = this.requireMission(missionId)
    this.missions.set(missionId, redactValue({ ...mission, status: "completed", updated_at: completedAt, completed_at: completedAt, completion_result_id: resultId, completion_summary: summary }))
    this.updateIntentStatus(mission.intent_id, "sent")
    const claim = this.activeClaimForMission(missionId)
    if (claim) this.claims.set(claim.claim_id, redactValue({ ...claim, status: "completed", completed_at: completedAt }))
  }

  private applyMissionFailed(missionId: string, failedAt: string, failureReason: string): void {
    const mission = this.requireMission(missionId)
    this.missions.set(missionId, redactValue({ ...mission, status: "failed", updated_at: failedAt, failure_reason: failureReason }))
    this.updateIntentStatus(mission.intent_id, "failed")
    const claim = this.activeClaimForMission(missionId)
    if (claim) this.claims.set(claim.claim_id, redactValue({ ...claim, status: "failed", failed_at: failedAt, failure_reason: failureReason }))
  }

  private applyMissionCancelled(missionId: string, cancelledAt: string, cancellationReason?: string): void {
    const mission = this.requireMission(missionId)
    this.missions.set(missionId, redactValue({ ...mission, status: "cancelled", updated_at: cancelledAt, cancelled_at: cancelledAt, cancellation_reason: cancellationReason }))
    this.updateIntentStatus(mission.intent_id, "cancelled")
    const claim = this.activeClaimForMission(missionId)
    if (claim) this.claims.set(claim.claim_id, redactValue({ ...claim, status: "cancelled", cancelled_at: cancelledAt, cancellation_reason: cancellationReason }))
  }

  private applyMissionClaimReleased(claimId: string, releasedAt: string, releaseReason?: string): void {
    const claim = this.requireClaim(claimId)
    this.claims.set(claimId, redactValue({ ...claim, status: "released", released_at: releasedAt, release_reason: releaseReason }))
    const mission = this.requireMission(claim.mission_id)
    if (!TERMINAL_STATUSES.has(mission.status)) this.missions.set(mission.mission_id, redactValue({ ...mission, status: "sent", updated_at: releasedAt }))
  }

  private updateIntentStatus(intentId: string, status: WorkIntent["status"]): void {
    const intent = this.intents.get(intentId)
    if (intent) this.intents.set(intentId, { ...intent, status })
  }

  private requireMission(missionId: string): MissionRecord {
    const mission = this.missions.get(missionId)
    if (!mission) throw new Error(`mission not found: ${missionId}`)
    return mission
  }

  private requireClaim(claimId: string): ExecutorClaim {
    const claim = this.claims.get(claimId)
    if (!claim) throw new Error(`mission claim not found: ${claimId}`)
    return claim
  }

  private requireProgress(progressId: string): MissionProgress {
    const progress = this.progress.get(progressId)
    if (!progress) throw new Error(`mission progress not found: ${progressId}`)
    return progress
  }

  private requireResult(resultId: string): MissionResult {
    const result = this.results.get(resultId)
    if (!result) throw new Error(`mission result not found: ${resultId}`)
    return result
  }

  private requireActiveClaim(missionId: string, claimId: string): ExecutorClaim {
    const claim = this.requireClaim(claimId)
    if (claim.mission_id !== missionId) throw new Error(`mission claim does not belong to mission: ${claimId}`)
    if (claim.status !== "active") throw new Error(`mission claim is not active: ${claimId}`)
    return claim
  }

  private activeClaimForMission(missionId: string): ExecutorClaim | undefined {
    for (const claimId of this.claimsByMission.get(missionId) ?? []) {
      const claim = this.claims.get(claimId)
      if (claim?.status === "active") return claim
    }
    return undefined
  }

  private firstSubmittedResult(missionId: string): MissionResult | undefined {
    for (const resultId of this.resultsByMission.get(missionId) ?? []) {
      const result = this.results.get(resultId)
      if (result?.status === "submitted") return result
    }
    return undefined
  }

  private firstSubmittedResultForClaim(missionId: string, claimId: string): MissionResult | undefined {
    for (const resultId of this.resultsByMission.get(missionId) ?? []) {
      const result = this.results.get(resultId)
      if (result?.status === "submitted" && result.claim_id === claimId) return result
    }
    return undefined
  }

  private assertNotTerminal(mission: MissionRecord, action: string): void {
    if (TERMINAL_STATUSES.has(mission.status)) throw new Error(`terminal mission cannot ${action}: ${mission.mission_id}`)
  }

  private idempotentCompleted(mission: MissionRecord, resultId?: string, summary?: string): MissionRecord {
    const sameResult = resultId === undefined || resultId === mission.completion_result_id
    const sameSummary = summary === undefined || summary === mission.completion_summary
    if (sameResult && sameSummary) return mission
    throw new Error(`terminal mission completion conflicts with existing completed payload: ${mission.mission_id}`)
  }

  private idempotentFailed(mission: MissionRecord, failureReason: string): MissionRecord {
    if (mission.failure_reason === failureReason) return mission
    throw new Error(`terminal mission failure conflicts with existing failed payload: ${mission.mission_id}`)
  }

  private idempotentCancelled(mission: MissionRecord, cancellationReason?: string): MissionRecord {
    if (mission.cancellation_reason === cancellationReason) return mission
    throw new Error(`terminal mission cancellation conflicts with existing cancelled payload: ${mission.mission_id}`)
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}

function cleanRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function cleanOptionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value.map((item, index) => cleanRequiredString(item, `${field}[${index}]`)).map((item) => redactText(item))
}

function optionalEventString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function pushUnique(map: Map<string, string[]>, key: string, value: string): void {
  const values = map.get(key) ?? []
  if (!values.includes(value)) values.push(value)
  map.set(key, values)
}
