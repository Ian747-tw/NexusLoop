import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { WakeScheduleTickPreview } from "./wake-schedule-types"
import type { WakeScheduleService } from "./wake-schedule-service"
import type { WakeSchedulerBootstrapService } from "./wake-scheduler-bootstrap-service"
import type { WakeSchedulerBootstrapStatus, WakeSchedulerStaleRunInfo } from "./wake-scheduler-bootstrap-types"
import type { WakeSchedulerService } from "./wake-scheduler-service"
import type { WakeSchedulerStatus } from "./wake-scheduler-types"
import type {
  WakeSchedulerRecovery,
  WakeSchedulerRecoveryAcknowledgeInput,
  WakeSchedulerRecoveryCommand,
  WakeSchedulerRecoveryPreview,
  WakeSchedulerRecoveryRecord,
  WakeSchedulerRecoveryRecordedEvent,
  WakeSchedulerRecoveryStatus,
} from "./wake-scheduler-recovery-types"

const PREVIEW_CHARS = 360
const MAX_LIST_LIMIT = 100
const MAX_MISSED_WINDOW_ESTIMATE = 1000

export interface WakeSchedulerRecoveryServiceOptions {
  eventStore: EventStore
  scheduler: WakeSchedulerService
  bootstrap: WakeSchedulerBootstrapService
  wakeScheduleService: WakeScheduleService
  now?: () => Date
}

type SchedulerEvent = JsonlEvent & {
  scheduler_status?: WakeSchedulerStatus
  tick_id?: string
  created_at?: string
}

type RecoveryEvent = JsonlEvent & WakeSchedulerRecoveryRecordedEvent

type ScheduleProjection = {
  schedule_id: string
  status: string
  interval_ms: number
  next_due_at: string
}

export class WakeSchedulerRecoveryService {
  constructor(private readonly options: WakeSchedulerRecoveryServiceOptions) {}

  async preview(): Promise<WakeSchedulerRecoveryPreview> {
    return this.buildPreview()
  }

  async get(recoveryId: string): Promise<WakeSchedulerRecovery | null> {
    const id = cleanString(recoveryId, "recovery_id")
    const preview = await this.buildPreview()
    if (preview.recovery_id === id && preview.stale_detected) return this.recoveryFromPreview(preview)
    return (await this.projectRecoveries()).find((record) => record.recovery_id === id) ?? null
  }

  async list(limit = 20): Promise<WakeSchedulerRecoveryRecord[]> {
    const cleanLimit = readLimit(limit)
    const byId = new Map<string, WakeSchedulerRecoveryRecord>()
    for (const recovery of await this.projectRecoveries()) byId.set(recovery.recovery_id, recordFromRecovery(recovery))
    const preview = await this.buildPreview()
    if (preview.recovery_id && preview.stale_detected) {
      const recovery = await this.recoveryFromPreview(preview)
      byId.set(recovery.recovery_id, recordFromRecovery(recovery))
    }
    return redactValue([...byId.values()].sort((left, right) => right.updated_at.localeCompare(left.updated_at)).slice(0, cleanLimit))
  }

  async acknowledge(input: WakeSchedulerRecoveryAcknowledgeInput): Promise<WakeSchedulerRecovery> {
    const normalized = normalizeAcknowledgeInput(input)
    const preview = await this.buildPreview()
    if (!preview.stale_detected || !preview.recovery_id) throw new Error("wake scheduler recovery has no stale prior run to record")
    if (normalized.recovery_id && normalized.recovery_id !== preview.recovery_id) throw new Error("wake scheduler recovery_id does not match current stale prior run")
    const now = this.now()
    const recoveryHash = recoveryHashFromPreview(preview)
    await this.options.eventStore.append({
      kind: "runtime_wake_scheduler_recovery_recorded",
      recovery_id: preview.recovery_id,
      resolution: normalized.resolution,
      reason: normalized.reason,
      stale_prior_event_id: preview.prior_event_id,
      prior_started_at: preview.prior_started_at,
      prior_tick_id: preview.prior_tick_id,
      recorded_at: now,
      requested_by: normalized.requested_by,
      recovery_hash: recoveryHash,
      summary_preview: summaryPreview(preview, normalized.resolution),
    })
    return redactValue({
      ...await this.recoveryFromPreview({ ...preview, status: normalized.resolution }),
      status: normalized.resolution,
      acknowledged_at: now,
      acknowledged_by: normalized.requested_by,
      resolution_reason: normalized.reason,
      updated_at: now,
      recovery_hash: recoveryHash,
    })
  }

  private async buildPreview(): Promise<WakeSchedulerRecoveryPreview> {
    const schedulerStatus = this.options.scheduler.status()
    const bootstrapStatus = await this.options.bootstrap.status()
    const eventCount = (await this.options.eventStore.readAll()).length
    const stale = await this.detectStaleRun(bootstrapStatus)
    const duePreview = await this.previewDueSchedules()
    const warnings: string[] = []
    const blockers: string[] = []
    if (stale.detected && stale.reason) warnings.push(stale.reason)
    if (!stale.detected && schedulerStatus.status === "running") warnings.push("current in-process scheduler is running; stale prior-run recovery is not active")

    const recoveryId = stale.detected ? recoveryIdFor(stale) : undefined
    const recoveryHash = stale.detected ? recoveryHashFor(stale) : undefined
    const priorResolution = recoveryHash ? await this.latestResolution(recoveryHash) : null
    const status: WakeSchedulerRecoveryStatus = stale.detected ? priorResolution?.resolution ?? "detected" : "none"
    const missedEstimate = stale.detected && stale.prior_started_at ? await this.estimateMissedWindows(stale.prior_started_at) : undefined
    const commandRecommendations = recommendedCommands(recoveryId, stale.detected, status)

    return redactValue({
      recovery_id: recoveryId,
      stale_detected: stale.detected,
      status,
      prior_started_at: stale.prior_started_at,
      prior_event_id: stale.prior_event_id,
      prior_tick_id: stale.prior_tick_id,
      scheduler_status: schedulerStatus.status,
      bootstrap_status: bootstrapStatus,
      current_event_count: eventCount,
      due_schedule_count: duePreview.due_count,
      eligible_due_schedule_count: duePreview.eligible_count,
      blocked_due_schedule_count: duePreview.blocked_count,
      missed_window_estimate_count: missedEstimate,
      warnings: unique(warnings),
      blockers: unique(blockers),
      recommended_commands: commandRecommendations,
      redacted_summary_preview: previewText(JSON.stringify({
        status,
        stale_detected: stale.detected,
        prior_event_id: stale.prior_event_id,
        due_schedule_count: duePreview.due_count,
        missed_window_estimate_count: missedEstimate,
      })),
    })
  }

  private async recoveryFromPreview(preview: WakeSchedulerRecoveryPreview): Promise<WakeSchedulerRecovery> {
    if (!preview.recovery_id) throw new Error("wake scheduler recovery preview has no recovery_id")
    const hash = recoveryHashFromPreview(preview)
    const recorded = await this.latestResolution(hash)
    const createdAt = preview.prior_started_at ?? recorded?.recorded_at ?? this.now()
    const updatedAt = recorded?.recorded_at ?? createdAt
    return redactValue({
      ...preview,
      recovery_id: preview.recovery_id,
      status: recorded?.resolution ?? preview.status,
      acknowledged_at: recorded?.recorded_at,
      acknowledged_by: recorded?.requested_by,
      resolution_reason: recorded?.reason,
      created_at: createdAt,
      updated_at: updatedAt,
      recovery_hash: hash,
    })
  }

  private async detectStaleRun(bootstrapStatus: WakeSchedulerBootstrapStatus): Promise<WakeSchedulerStaleRunInfo> {
    if (this.options.scheduler.status().status === "running") return { detected: false }
    if (bootstrapStatus.stale_prior_run?.detected) return bootstrapStatus.stale_prior_run
    const events = (await this.options.eventStore.readAll()) as SchedulerEvent[]
    let openStart: SchedulerEvent | null = null
    let staleCandidate: SchedulerEvent | null = null
    let runtimeStartedAfterOpenStart = false
    for (const event of events) {
      if (event.kind === "runtime_wake_scheduler_started") {
        if (openStart && !staleCandidate) staleCandidate = openStart
        openStart = event
        runtimeStartedAfterOpenStart = false
      } else if (event.kind === "runtime_started" && openStart) {
        runtimeStartedAfterOpenStart = true
      } else if ((event.kind === "runtime_wake_scheduler_tick_succeeded" || event.kind === "runtime_wake_scheduler_tick_failed") && openStart && typeof event.tick_id === "string") {
        openStart = Object.assign({}, openStart, { tick_id: event.tick_id })
      } else if (event.kind === "runtime_wake_scheduler_stopped") {
        openStart = null
        runtimeStartedAfterOpenStart = false
      } else if (event.kind === "runtime_shutdown" && openStart && !runtimeStartedAfterOpenStart) {
        openStart = null
      }
    }
    openStart = staleCandidate ?? openStart
    if (!openStart) return { detected: false }
    return redactValue({
      detected: true,
      prior_started_at: typeof openStart.created_at === "string" ? openStart.created_at : typeof openStart.timestamp === "string" ? openStart.timestamp : undefined,
      prior_status: openStart.scheduler_status ?? "running",
      prior_tick_id: typeof openStart.tick_id === "string" ? openStart.tick_id : undefined,
      prior_event_id: typeof openStart.event_id === "string" ? openStart.event_id : undefined,
      reason: "previous scheduler start has no matching stop or correlated shutdown event",
    })
  }

  private async previewDueSchedules(): Promise<WakeScheduleTickPreview> {
    return this.options.wakeScheduleService.previewTick({ dry_run: true, max_due_items: 20, requested_by: "scheduler-recovery" })
  }

  private async estimateMissedWindows(priorStartedAt: string): Promise<number> {
    const priorMs = Date.parse(priorStartedAt)
    const nowMs = Date.parse(this.now())
    if (!Number.isFinite(priorMs) || !Number.isFinite(nowMs) || nowMs <= priorMs) return 0
    let total = 0
    for (const schedule of await this.projectSchedules()) {
      if (schedule.status !== "active") continue
      if (!Number.isInteger(schedule.interval_ms) || schedule.interval_ms < 1) continue
      const nextDueMs = Date.parse(schedule.next_due_at)
      if (!Number.isFinite(nextDueMs)) continue
      const firstMissedMs = Math.max(priorMs, nextDueMs)
      if (firstMissedMs > nowMs) continue
      total += Math.floor((nowMs - firstMissedMs) / schedule.interval_ms) + 1
      if (total >= MAX_MISSED_WINDOW_ESTIMATE) return MAX_MISSED_WINDOW_ESTIMATE
    }
    return total
  }

  private async projectSchedules(): Promise<ScheduleProjection[]> {
    const schedules = new Map<string, ScheduleProjection>()
    for (const event of await this.options.eventStore.readAll()) {
      if (event.kind === "runtime_wake_schedule_created" && isRecord(event.schedule) && typeof event.schedule.schedule_id === "string") {
        schedules.set(event.schedule.schedule_id, {
          schedule_id: event.schedule.schedule_id,
          status: typeof event.schedule.status === "string" ? event.schedule.status : "active",
          interval_ms: typeof event.schedule.interval_ms === "number" ? event.schedule.interval_ms : 0,
          next_due_at: typeof event.schedule.next_due_at === "string" ? event.schedule.next_due_at : "",
        })
      } else if ((event.kind === "runtime_wake_schedule_paused" || event.kind === "runtime_wake_schedule_resumed" || event.kind === "runtime_wake_schedule_cancelled") && typeof event.schedule_id === "string") {
        const schedule = schedules.get(event.schedule_id)
        if (schedule) schedule.status = event.kind === "runtime_wake_schedule_resumed" ? "active" : event.kind === "runtime_wake_schedule_paused" ? "paused" : "cancelled"
      } else if (event.kind === "runtime_wake_schedule_tick_completed" && Array.isArray(event.processed_schedules)) {
        for (const item of event.processed_schedules) {
          if (!isRecord(item) || typeof item.schedule_id !== "string" || typeof item.next_due_at !== "string") continue
          const schedule = schedules.get(item.schedule_id)
          if (schedule) schedule.next_due_at = item.next_due_at
        }
      }
    }
    return [...schedules.values()]
  }

  private async projectRecoveries(): Promise<WakeSchedulerRecovery[]> {
    const byHash = new Map<string, RecoveryEvent>()
    for (const event of await this.options.eventStore.readAll()) {
      if (event.kind !== "runtime_wake_scheduler_recovery_recorded" || typeof event.recovery_hash !== "string") continue
      const current = byHash.get(event.recovery_hash)
      const recordedAt = typeof event.recorded_at === "string" ? event.recorded_at : typeof event.timestamp === "string" ? event.timestamp : ""
      const currentAt = current ? (typeof current.recorded_at === "string" ? current.recorded_at : typeof current.timestamp === "string" ? current.timestamp : "") : ""
      if (!current || recordedAt >= currentAt) byHash.set(event.recovery_hash, event as RecoveryEvent)
    }
    return redactValue([...byHash.values()].map((event) => recoveryFromRecordedEvent(event)))
  }

  private async latestResolution(recoveryHash: string): Promise<RecoveryEvent | null> {
    let latest: RecoveryEvent | null = null
    for (const event of await this.options.eventStore.readAll()) {
      if (event.kind !== "runtime_wake_scheduler_recovery_recorded" || event.recovery_hash !== recoveryHash) continue
      latest = event as RecoveryEvent
    }
    return latest
  }

  private now(): string {
    return (this.options.now ?? (() => new Date()))().toISOString()
  }
}

export function readWakeSchedulerRecoveryAcknowledgeInput(payload: Record<string, unknown>): WakeSchedulerRecoveryAcknowledgeInput {
  return normalizeAcknowledgeInput({
    recovery_id: optionalString(payload.recoveryId ?? payload.recovery_id, "recoveryId"),
    reason: optionalString(payload.reason, "reason"),
    resolution: requiredResolution(payload.resolution),
    requested_by: optionalString(payload.requestedBy ?? payload.requested_by, "requestedBy"),
  })
}

function normalizeAcknowledgeInput(input: WakeSchedulerRecoveryAcknowledgeInput): { recovery_id?: string; resolution: "acknowledged" | "resolved" | "dismissed"; reason?: string; requested_by: string } {
  return {
    recovery_id: input.recovery_id ?? input.recoveryId,
    resolution: requiredResolution(input.resolution),
    reason: input.reason ? previewText(input.reason) : undefined,
    requested_by: previewText(input.requested_by ?? input.requestedBy ?? "operator"),
  }
}

function recoveryFromRecordedEvent(event: RecoveryEvent): WakeSchedulerRecovery {
  const recordedAt = typeof event.recorded_at === "string" ? event.recorded_at : typeof event.timestamp === "string" ? event.timestamp : ""
  return {
    recovery_id: event.recovery_id,
    status: event.resolution,
    stale_detected: true,
    prior_started_at: event.prior_started_at,
    prior_event_id: event.stale_prior_event_id,
    prior_tick_id: event.prior_tick_id,
    scheduler_status: "stopped",
    current_event_count: 0,
    due_schedule_count: 0,
    eligible_due_schedule_count: 0,
    blocked_due_schedule_count: 0,
    warnings: [],
    blockers: [],
    recommended_commands: recommendedCommands(event.recovery_id, true, event.resolution),
    redacted_summary_preview: event.summary_preview,
    acknowledged_at: recordedAt,
    acknowledged_by: event.requested_by,
    resolution_reason: event.reason,
    created_at: event.prior_started_at ?? recordedAt,
    updated_at: recordedAt,
    recovery_hash: event.recovery_hash,
  }
}

function recordFromRecovery(recovery: WakeSchedulerRecovery): WakeSchedulerRecoveryRecord {
  return {
    recovery_id: recovery.recovery_id,
    status: recovery.status,
    stale_detected: recovery.stale_detected,
    prior_started_at: recovery.prior_started_at,
    acknowledged_at: recovery.acknowledged_at,
    updated_at: recovery.updated_at,
    summary_preview: previewText(recovery.redacted_summary_preview),
    recovery_hash: recovery.recovery_hash,
  }
}

function recommendedCommands(recoveryId: string | undefined, staleDetected: boolean, status: WakeSchedulerRecoveryStatus): WakeSchedulerRecoveryCommand[] {
  const commands: WakeSchedulerRecoveryCommand[] = [
    { label: "Inspect scheduler status", command: "/scheduler-status", command_type: "read" },
    { label: "Inspect bootstrap status", command: "/scheduler-bootstrap", command_type: "read" },
    { label: "Preview due wake schedules", command: "/wake-tick-preview", command_type: "read" },
    { label: "List wake schedules", command: "/wake-schedules", command_type: "read" },
  ]
  if (staleDetected && recoveryId && status === "detected") commands.push({ label: "Acknowledge stale run", command: `/scheduler-recovery-ack ${recoveryId}`, command_type: "write", requires_active_runtime: true, notes: "records acknowledgement only" })
  commands.push({ label: "Dry-run wake tick", command: "/wake-tick-dry-run", command_type: "write", requires_active_runtime: true, notes: "existing explicit command; not executed by recovery" })
  commands.push({ label: "Start scheduler", command: "/scheduler-start dry-run every=60s", command_type: "write", requires_active_runtime: true, notes: "existing explicit command; not executed by recovery" })
  return commands
}

function recoveryIdFor(stale: WakeSchedulerStaleRunInfo): string {
  return `wake_scheduler_recovery_${recoveryHashFor(stale).slice(0, 16)}`
}

function recoveryHashFor(stale: WakeSchedulerStaleRunInfo): string {
  return hashParts([stale.prior_event_id, stale.prior_started_at, stale.prior_tick_id])
}

function recoveryHashFromPreview(preview: WakeSchedulerRecoveryPreview): string {
  return hashParts([preview.prior_event_id, preview.prior_started_at, preview.prior_tick_id])
}

function hashParts(parts: Array<string | undefined>): string {
  return createHash("sha256").update(parts.filter(Boolean).join("\n") || "wake-scheduler-recovery").digest("hex")
}

function summaryPreview(preview: WakeSchedulerRecoveryPreview, resolution: string): string {
  return previewText(JSON.stringify({
    resolution,
    recovery_id: preview.recovery_id,
    prior_event_id: preview.prior_event_id,
    prior_started_at: preview.prior_started_at,
    due_schedule_count: preview.due_schedule_count,
  }))
}

function requiredResolution(value: unknown): "acknowledged" | "resolved" | "dismissed" {
  if (value === "acknowledged" || value === "resolved" || value === "dismissed") return value
  throw new Error("wake scheduler recovery resolution must be acknowledged, resolved, or dismissed")
}

function readLimit(value: unknown): number {
  const limit = typeof value === "number" ? value : 20
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) throw new Error(`limit must be an integer from 1 to ${MAX_LIST_LIMIT}`)
  return limit
}

function cleanString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} is required`)
  return previewText(value.trim())
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined
  return cleanString(value, field)
}

function previewText(value: string): string {
  return redactText(value).slice(0, PREVIEW_CHARS)
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => previewText(value)).filter(Boolean))]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
