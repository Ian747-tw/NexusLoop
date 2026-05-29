import { createHash } from "node:crypto"
import type { RuntimeRestoreService } from "../checkpoints/runtime-restore-service"
import type { ContinuationService } from "../continuation/continuation-service"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { WakeAssessmentService } from "../wake/wake-hook-service"
import type {
  WakeSchedule,
  WakeScheduleDecisionInput,
  WakeScheduleDueItem,
  WakeScheduleInput,
  WakeSchedulePolicy,
  WakeSchedulePreview,
  WakeScheduleRecord,
  WakeScheduleStatus,
  WakeScheduleTickInput,
  WakeScheduleTickPreview,
  WakeScheduleTickResult,
} from "./wake-schedule-types"

const DEFAULT_MIN_INTERVAL_MS = 60_000
const MAX_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_MAX_DUE_ITEMS = 5
const HARD_MAX_DUE_ITEMS = 20
const MAX_LIST_LIMIT = 100
const PREVIEW_CHARS = 360

export interface WakeScheduleServiceOptions {
  eventStore: EventStore
  restoreService: RuntimeRestoreService
  wakeService: WakeAssessmentService
  continuationService: ContinuationService
  idFactory?: () => string
  tickIdFactory?: () => string
  now?: () => Date
}

type WakeScheduleEvent = JsonlEvent & {
  kind:
    | "runtime_wake_schedule_created"
    | "runtime_wake_schedule_paused"
    | "runtime_wake_schedule_resumed"
    | "runtime_wake_schedule_cancelled"
    | "runtime_wake_schedule_tick_completed"
  schedule?: WakeSchedule
  tick?: WakeScheduleTickResult
  processed_schedules?: Array<{ schedule_id: string; next_due_at: string; last_wake_id?: string; last_plan_id?: string }>
}

type NormalizedScheduleInput = {
  resume_id: string
  title: string
  interval_ms: number
  next_due_at?: string
  reason?: string
  policy: WakeSchedulePolicy
  created_by: string
}

type NormalizedDecisionInput = {
  schedule_id: string
  reason?: string
  requested_by: string
}

type NormalizedTickInput = {
  now: string
  dry_run: boolean
  max_due_items: number
  requested_by: string
}

export class WakeScheduleService {
  private generatedScheduleIds = 0
  private generatedTickIds = 0
  private tickLock: Promise<void> = Promise.resolve()

  constructor(private readonly options: WakeScheduleServiceOptions) {}

  async preview(input: WakeScheduleInput): Promise<WakeSchedulePreview> {
    const normalized = normalizeScheduleInput(input, this.now())
    return this.previewNormalized(normalized)
  }

  async create(input: WakeScheduleInput): Promise<WakeSchedule> {
    const normalized = normalizeScheduleInput(input, this.now())
    const preview = await this.previewNormalized(normalized)
    if (!preview.can_create) throw new Error(preview.blockers[0] ?? "wake schedule is blocked")
    const createdAt = this.now()
    const scheduleId = this.options.idFactory ? this.options.idFactory() : `wake_schedule_${Date.now().toString(36)}_${++this.generatedScheduleIds}`
    const schedule = finalizeSchedule({
      schedule_id: scheduleId,
      resume_id: preview.resume_id,
      checkpoint_id: preview.checkpoint_id,
      status: "active",
      title: preview.title,
      interval_ms: preview.interval_ms,
      next_due_at: preview.next_due_at,
      created_at: createdAt,
      created_by: normalized.created_by,
      updated_at: createdAt,
      policy: preview.policy,
      reason: normalized.reason,
      warnings: preview.warnings,
    })
    await this.options.eventStore.append({ kind: "runtime_wake_schedule_created", schedule_id: schedule.schedule_id, resume_id: schedule.resume_id, schedule })
    return redactValue(schedule)
  }

  async get(scheduleId: string): Promise<WakeSchedule | null> {
    const id = cleanString(scheduleId, "schedule_id")
    return redactValue((await this.schedules()).find((schedule) => schedule.schedule_id === id) ?? null)
  }

  async list(limit = 20): Promise<WakeScheduleRecord[]> {
    const cleanLimit = readLimit(limit)
    return redactValue((await this.schedules()).slice().reverse().slice(0, cleanLimit).map(recordFromSchedule))
  }

  async pause(input: WakeScheduleDecisionInput): Promise<WakeSchedule> {
    const normalized = normalizeDecisionInput(input)
    const schedule = await this.requireSchedule(normalized.schedule_id)
    if (schedule.status === "cancelled") throw new Error("wake schedule is cancelled")
    await this.options.eventStore.append({
      kind: "runtime_wake_schedule_paused",
      schedule_id: schedule.schedule_id,
      paused_at: this.now(),
      requested_by: normalized.requested_by,
      reason: normalized.reason,
    })
    return redactValue(await this.requireSchedule(schedule.schedule_id))
  }

  async resume(input: WakeScheduleDecisionInput): Promise<WakeSchedule> {
    const normalized = normalizeDecisionInput(input)
    const schedule = await this.requireSchedule(normalized.schedule_id)
    if (schedule.status === "cancelled") throw new Error("wake schedule is cancelled")
    await this.options.eventStore.append({
      kind: "runtime_wake_schedule_resumed",
      schedule_id: schedule.schedule_id,
      resumed_at: this.now(),
      requested_by: normalized.requested_by,
      reason: normalized.reason,
    })
    return redactValue(await this.requireSchedule(schedule.schedule_id))
  }

  async cancel(input: WakeScheduleDecisionInput): Promise<WakeSchedule> {
    const normalized = normalizeDecisionInput(input)
    const schedule = await this.requireSchedule(normalized.schedule_id)
    if (schedule.status === "cancelled") throw new Error("wake schedule is cancelled")
    await this.options.eventStore.append({
      kind: "runtime_wake_schedule_cancelled",
      schedule_id: schedule.schedule_id,
      cancelled_at: this.now(),
      requested_by: normalized.requested_by,
      reason: normalized.reason,
    })
    return redactValue(await this.requireSchedule(schedule.schedule_id))
  }

  async previewTick(input: WakeScheduleTickInput = {}): Promise<WakeScheduleTickPreview> {
    const normalized = normalizeTickInput(input, this.now())
    return this.previewTickNormalized(normalized)
  }

  async executeTick(input: WakeScheduleTickInput = {}): Promise<WakeScheduleTickResult> {
    const normalized = normalizeTickInput(input, this.now())
    return this.withTickLock(() => this.executeTickLocked(normalized))
  }

  async getTick(tickId: string): Promise<WakeScheduleTickResult | null> {
    const id = cleanString(tickId, "tick_id")
    return redactValue((await this.ticks()).find((tick) => tick.tick_id === id) ?? null)
  }

  async listTicks(limit = 20): Promise<WakeScheduleTickResult[]> {
    const cleanLimit = readLimit(limit)
    return redactValue((await this.ticks()).slice().reverse().slice(0, cleanLimit))
  }

  private async previewNormalized(input: NormalizedScheduleInput): Promise<WakeSchedulePreview> {
    const blockers: string[] = []
    const warnings: string[] = []
    const anchor = await this.options.restoreService.get(input.resume_id)
    if (!anchor) blockers.push("runtime resume anchor not found")
    if (anchor) {
      const restorePreview = await this.options.restoreService.preview({ checkpoint_id: anchor.checkpoint_id })
      blockers.push(...restorePreview.verification.blockers)
      warnings.push(...restorePreview.verification.warnings)
      if (!restorePreview.verification.hash_ok) blockers.push("runtime checkpoint hash verification failed")
      if (restorePreview.verification.drift_status === "forked") blockers.push("runtime checkpoint event cursor is forked")
      if (restorePreview.verification.drift_status === "advanced") warnings.push("new events exist after checkpoint")
    }
    const now = this.now()
    const nextDueAt = input.next_due_at ?? new Date(Date.parse(now) + input.interval_ms).toISOString()
    const uniqueBlockers = unique(blockers)
    const uniqueWarnings = unique(warnings)
    return redactValue({
      resume_id: input.resume_id,
      checkpoint_id: anchor?.checkpoint_id,
      title: input.title,
      interval_ms: input.interval_ms,
      next_due_at: nextDueAt,
      policy: input.policy,
      can_create: uniqueBlockers.length === 0,
      blockers: uniqueBlockers,
      warnings: uniqueWarnings,
      redacted_summary_preview: previewText(stableStringify({
        resume_id: input.resume_id,
        checkpoint_id: anchor?.checkpoint_id,
        interval_ms: input.interval_ms,
        next_due_at: nextDueAt,
        can_create: uniqueBlockers.length === 0,
      })),
    })
  }

  private async previewTickNormalized(input: NormalizedTickInput): Promise<WakeScheduleTickPreview> {
    const schedules = await this.schedules()
    const allItems = await this.dueItems(schedules, input.now)
    const items = allItems.slice(0, input.max_due_items)
    const dueCount = allItems.filter((item) => item.due).length
    const eligibleCount = allItems.filter((item) => item.due && item.blockers.length === 0).length
    const blockedCount = allItems.filter((item) => item.due && item.blockers.length > 0).length
    return redactValue({
      now: input.now,
      due_count: dueCount,
      eligible_count: eligibleCount,
      blocked_count: blockedCount,
      items,
      max_items: input.max_due_items,
      blockers: [],
      warnings: dueCount > input.max_due_items ? [`tick preview capped at ${input.max_due_items} due schedules`] : [],
    })
  }

  private async executeTickLocked(input: NormalizedTickInput): Promise<WakeScheduleTickResult> {
    const preview = await this.previewTickNormalized(input)
    const eligible = preview.items.filter((item) => item.due && item.blockers.length === 0).slice(0, input.max_due_items)
    const skipped: WakeScheduleDueItem[] = preview.items.filter((item) => !item.due || item.blockers.length > 0)
    const tickId = this.options.tickIdFactory ? this.options.tickIdFactory() : `wake_tick_${Date.now().toString(36)}_${++this.generatedTickIds}`
    const createdAt = this.now()
    const wakeIds: string[] = []
    const planIds: string[] = []
    const processed: Array<{ schedule_id: string; next_due_at: string; last_wake_id?: string; last_plan_id?: string }> = []
    if (!input.dry_run) {
      for (const item of eligible) {
        const schedule = await this.get(item.schedule_id)
        if (!schedule || schedule.status !== "active") continue
        let wakeId: string | undefined
        let planId: string | undefined
        try {
          if (schedule.policy.create_wake_assessment && schedule.policy.max_wake_assessments_per_tick > 0) {
            const wake = await this.options.wakeService.create({ resume_id: schedule.resume_id, requested_by: input.requested_by })
            wakeId = wake.wake_id
            wakeIds.push(wake.wake_id)
          }
          if (wakeId && schedule.policy.create_continuation_plan && schedule.policy.max_continuation_plans_per_tick > 0) {
            const plan = await this.options.continuationService.create({
              wake_id: wakeId,
              requested_by: input.requested_by,
              include_write_steps: schedule.policy.include_write_steps,
            })
            planId = plan.plan_id
            planIds.push(plan.plan_id)
          }
          processed.push({
            schedule_id: schedule.schedule_id,
            next_due_at: advanceDueAt(schedule.next_due_at, schedule.interval_ms, input.now),
            last_wake_id: wakeId,
            last_plan_id: planId,
          })
        } catch (error) {
          skipped.push({
            ...item,
            blockers: unique([...item.blockers, error instanceof Error ? error.message : String(error)]),
          })
        }
      }
    }
    const result: WakeScheduleTickResult = {
      tick_id: tickId,
      now: input.now,
      processed_count: input.dry_run ? eligible.length : processed.length,
      wake_ids: input.dry_run ? [] : wakeIds,
      plan_ids: input.dry_run ? [] : planIds,
      skipped: input.dry_run ? preview.items.filter((item) => item.blockers.length > 0) : skipped,
      created_at: createdAt,
      requested_by: input.requested_by,
      dry_run: input.dry_run,
    }
    if (!input.dry_run) {
      await this.options.eventStore.append({
        kind: "runtime_wake_schedule_tick_completed",
        tick_id: result.tick_id,
        now: result.now,
        created_at: result.created_at,
        requested_by: result.requested_by,
        tick: result,
        processed_schedules: processed,
      })
    }
    return redactValue(result)
  }

  private async dueItems(schedules: WakeSchedule[], now: string): Promise<WakeScheduleDueItem[]> {
    const dueItems: WakeScheduleDueItem[] = []
    const otherItems: WakeScheduleDueItem[] = []
    for (const schedule of schedules.slice().sort((left, right) => left.next_due_at.localeCompare(right.next_due_at) || left.schedule_id.localeCompare(right.schedule_id))) {
      const due = schedule.status === "active" && Date.parse(schedule.next_due_at) <= Date.parse(now)
      const blockers: string[] = []
      const warnings: string[] = []
      if (schedule.status !== "active") blockers.push(`wake schedule is ${schedule.status}`)
      if (due) {
        try {
          const wakePreview = await this.options.wakeService.preview({ resume_id: schedule.resume_id, requested_by: "schedule-preview" })
          blockers.push(...wakePreview.blockers)
          warnings.push(...wakePreview.warnings)
          if (!wakePreview.allowed) blockers.push("wake assessment is blocked")
        } catch (error) {
          blockers.push(error instanceof Error ? error.message : String(error))
        }
      }
      const item: WakeScheduleDueItem = {
        schedule_id: schedule.schedule_id,
        resume_id: schedule.resume_id,
        checkpoint_id: schedule.checkpoint_id,
        due,
        status: schedule.status,
        next_due_at: schedule.next_due_at,
        last_tick_at: schedule.last_tick_at,
        blockers: unique(blockers),
        warnings: unique(warnings),
        would_create_wake: due && schedule.policy.create_wake_assessment && schedule.policy.max_wake_assessments_per_tick > 0 && blockers.length === 0,
        would_create_continuation_plan: due && schedule.policy.create_wake_assessment && schedule.policy.max_wake_assessments_per_tick > 0 && schedule.policy.create_continuation_plan && schedule.policy.max_continuation_plans_per_tick > 0 && blockers.length === 0,
      }
      if (due) dueItems.push(item)
      else otherItems.push(item)
    }
    return [...dueItems, ...otherItems]
  }

  private async schedules(): Promise<WakeSchedule[]> {
    const schedules = new Map<string, WakeSchedule>()
    for (const event of await this.options.eventStore.readAll()) {
      if (!String(event.kind ?? "").startsWith("runtime_wake_schedule_")) continue
      applyScheduleEvent(schedules, event as WakeScheduleEvent)
    }
    return [...schedules.values()]
  }

  private async ticks(): Promise<WakeScheduleTickResult[]> {
    const out: WakeScheduleTickResult[] = []
    for (const event of await this.options.eventStore.readAll()) {
      if (event.kind === "runtime_wake_schedule_tick_completed" && isRecord(event.tick)) out.push(redactValue(event.tick as WakeScheduleTickResult))
    }
    return out
  }

  private async requireSchedule(scheduleId: string): Promise<WakeSchedule> {
    const schedule = await this.get(scheduleId)
    if (!schedule) throw new Error("wake schedule not found")
    return schedule
  }

  private now(): string {
    return (this.options.now ?? (() => new Date()))().toISOString()
  }

  private async withTickLock<T>(run: () => Promise<T>): Promise<T> {
    const previous = this.tickLock
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const chain = previous.catch(() => undefined).then(() => current)
    this.tickLock = chain
    await previous.catch(() => undefined)
    try {
      return await run()
    } finally {
      release()
      if (this.tickLock === chain) this.tickLock = Promise.resolve()
    }
  }
}

export function readWakeScheduleInput(payload: Record<string, unknown>): WakeScheduleInput {
  return {
    resume_id: optionalString(payload.resumeId ?? payload.resume_id, "resumeId"),
    title: optionalString(payload.title, "title"),
    interval_ms: optionalPositiveInteger(payload.intervalMs ?? payload.interval_ms, "intervalMs", MAX_INTERVAL_MS),
    next_due_at: optionalString(payload.nextDueAt ?? payload.next_due_at, "nextDueAt"),
    reason: optionalString(payload.reason, "reason"),
    policy: isRecord(payload.policy) ? readPolicy(payload.policy) : undefined,
    created_by: optionalString(payload.createdBy ?? payload.created_by, "createdBy"),
    requested_by: optionalString(payload.requestedBy ?? payload.requested_by, "requestedBy"),
  }
}

export function readWakeScheduleDecisionInput(payload: Record<string, unknown>): WakeScheduleDecisionInput {
  return {
    schedule_id: optionalString(payload.scheduleId ?? payload.schedule_id, "scheduleId"),
    reason: optionalString(payload.reason, "reason"),
    requested_by: optionalString(payload.requestedBy ?? payload.requested_by, "requestedBy"),
  }
}

export function readWakeScheduleTickInput(payload: Record<string, unknown>): WakeScheduleTickInput {
  return {
    now: optionalString(payload.now, "now"),
    dry_run: optionalBoolean(payload.dryRun ?? payload.dry_run, "dryRun"),
    max_due_items: optionalPositiveInteger(payload.maxDueItems ?? payload.max_due_items, "maxDueItems", HARD_MAX_DUE_ITEMS),
    requested_by: optionalString(payload.requestedBy ?? payload.requested_by, "requestedBy"),
  }
}

function applyScheduleEvent(schedules: Map<string, WakeSchedule>, event: WakeScheduleEvent): void {
  if (event.kind === "runtime_wake_schedule_created" && isRecord(event.schedule) && typeof event.schedule.schedule_id === "string") {
    schedules.set(event.schedule.schedule_id, redactValue(event.schedule as WakeSchedule))
    return
  }
  const scheduleId = typeof event.schedule_id === "string" ? event.schedule_id : undefined
  if (!scheduleId) {
    if (event.kind === "runtime_wake_schedule_tick_completed" && Array.isArray(event.processed_schedules)) {
      for (const processed of event.processed_schedules) updateProcessedSchedule(schedules, processed, stringField(event.created_at) ?? stringField(event.now))
    }
    return
  }
  const schedule = schedules.get(scheduleId)
  if (!schedule) return
  if (event.kind === "runtime_wake_schedule_paused") schedule.status = "paused"
  if (event.kind === "runtime_wake_schedule_resumed") schedule.status = "active"
  if (event.kind === "runtime_wake_schedule_cancelled") schedule.status = "cancelled"
  schedule.updated_at = stringField(event.paused_at) ?? stringField(event.resumed_at) ?? stringField(event.cancelled_at) ?? stringField(event.timestamp) ?? schedule.updated_at
}

function updateProcessedSchedule(schedules: Map<string, WakeSchedule>, processed: unknown, tickAt: string | undefined): void {
  if (!isRecord(processed) || typeof processed.schedule_id !== "string") return
  const schedule = schedules.get(processed.schedule_id)
  if (!schedule) return
  schedule.last_tick_at = tickAt
  schedule.updated_at = tickAt ?? schedule.updated_at
  if (typeof processed.next_due_at === "string") schedule.next_due_at = processed.next_due_at
  if (typeof processed.last_wake_id === "string") schedule.last_wake_id = redactText(processed.last_wake_id)
  if (typeof processed.last_plan_id === "string") schedule.last_plan_id = redactText(processed.last_plan_id)
  schedule.schedule_hash = sha256(stableStringify({ ...schedule, schedule_hash: undefined }))
}

function normalizeScheduleInput(input: WakeScheduleInput, now: string): NormalizedScheduleInput {
  const resumeId = input.resume_id ?? input.resumeId
  if (!resumeId) throw new Error("resume_id is required")
  const intervalMs = input.interval_ms ?? input.intervalMs
  if (!Number.isInteger(intervalMs) || Number(intervalMs) < DEFAULT_MIN_INTERVAL_MS) throw new Error(`interval_ms must be at least ${DEFAULT_MIN_INTERVAL_MS}`)
  if (Number(intervalMs) > MAX_INTERVAL_MS) throw new Error(`interval_ms must be no greater than ${MAX_INTERVAL_MS}`)
  const nextDueAt = input.next_due_at ?? input.nextDueAt
  if (nextDueAt !== undefined) validateDate(nextDueAt, "next_due_at")
  return {
    resume_id: cleanString(resumeId, "resume_id"),
    title: boundedText(input.title ? cleanString(input.title, "title") : "Manual wake schedule", 160),
    interval_ms: Number(intervalMs),
    next_due_at: nextDueAt ? new Date(Date.parse(nextDueAt)).toISOString() : new Date(Date.parse(now) + Number(intervalMs)).toISOString(),
    reason: input.reason ? boundedText(cleanString(input.reason, "reason"), 300) : undefined,
    policy: normalizePolicy(input.policy),
    created_by: boundedText(cleanString(input.created_by ?? input.createdBy ?? input.requested_by ?? input.requestedBy ?? "operator", "created_by"), 128),
  }
}

function normalizeDecisionInput(input: WakeScheduleDecisionInput): NormalizedDecisionInput {
  const scheduleId = input.schedule_id ?? input.scheduleId
  if (!scheduleId) throw new Error("schedule_id is required")
  return {
    schedule_id: cleanString(scheduleId, "schedule_id"),
    reason: input.reason ? boundedText(cleanString(input.reason, "reason"), 300) : undefined,
    requested_by: boundedText(cleanString(input.requested_by ?? input.requestedBy ?? "operator", "requested_by"), 128),
  }
}

function normalizeTickInput(input: WakeScheduleTickInput, now: string): NormalizedTickInput {
  const requestedNow = input.now
  if (requestedNow !== undefined) validateDate(requestedNow, "now")
  const maxDueItems = input.max_due_items ?? input.maxDueItems ?? DEFAULT_MAX_DUE_ITEMS
  if (!Number.isInteger(maxDueItems) || Number(maxDueItems) < 1) throw new Error("max_due_items must be a positive integer")
  if (Number(maxDueItems) > HARD_MAX_DUE_ITEMS) throw new Error(`max_due_items must be no greater than ${HARD_MAX_DUE_ITEMS}`)
  return {
    now: requestedNow ? new Date(Date.parse(requestedNow)).toISOString() : now,
    dry_run: input.dry_run === true || input.dryRun === true,
    max_due_items: Number(maxDueItems),
    requested_by: boundedText(cleanString(input.requested_by ?? input.requestedBy ?? "operator", "requested_by"), 128),
  }
}

function normalizePolicy(input: Partial<WakeSchedulePolicy> | undefined): WakeSchedulePolicy {
  const base: WakeSchedulePolicy = {
    create_wake_assessment: true,
    create_continuation_plan: false,
    include_write_steps: false,
    max_wake_assessments_per_tick: 1,
    max_continuation_plans_per_tick: 0,
  }
  if (!input) return base
  return {
    create_wake_assessment: input.create_wake_assessment !== false,
    create_continuation_plan: input.create_continuation_plan === true,
    include_write_steps: input.include_write_steps === true,
    max_wake_assessments_per_tick: readPolicyLimit(input.max_wake_assessments_per_tick, "max_wake_assessments_per_tick"),
    max_continuation_plans_per_tick: readPolicyLimit(input.max_continuation_plans_per_tick, "max_continuation_plans_per_tick", input.create_continuation_plan === true ? 1 : 0),
  }
}

function readPolicy(input: Record<string, unknown>): Partial<WakeSchedulePolicy> {
  return {
    create_wake_assessment: optionalBoolean(input.createWakeAssessment ?? input.create_wake_assessment, "createWakeAssessment"),
    create_continuation_plan: optionalBoolean(input.createContinuationPlan ?? input.create_continuation_plan, "createContinuationPlan"),
    include_write_steps: optionalBoolean(input.includeWriteSteps ?? input.include_write_steps, "includeWriteSteps"),
    max_wake_assessments_per_tick: optionalPositiveInteger(input.maxWakeAssessmentsPerTick ?? input.max_wake_assessments_per_tick, "maxWakeAssessmentsPerTick", HARD_MAX_DUE_ITEMS),
    max_continuation_plans_per_tick: optionalPositiveInteger(input.maxContinuationPlansPerTick ?? input.max_continuation_plans_per_tick, "maxContinuationPlansPerTick", HARD_MAX_DUE_ITEMS),
  }
}

function readPolicyLimit(value: unknown, field: string, fallback = 1): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`${field} must be a nonnegative integer`)
  return Math.min(Number(value), HARD_MAX_DUE_ITEMS)
}

function finalizeSchedule(input: Omit<WakeSchedule, "schedule_hash">): WakeSchedule {
  return { ...input, schedule_hash: sha256(stableStringify(input)) }
}

function recordFromSchedule(schedule: WakeSchedule): WakeScheduleRecord {
  return {
    schedule_id: schedule.schedule_id,
    resume_id: schedule.resume_id,
    status: schedule.status,
    title: schedule.title,
    next_due_at: schedule.next_due_at,
    last_tick_at: schedule.last_tick_at,
    last_wake_id: schedule.last_wake_id,
    last_plan_id: schedule.last_plan_id,
    summary_preview: previewText(stableStringify({ schedule_id: schedule.schedule_id, status: schedule.status, next_due_at: schedule.next_due_at })),
  }
}

function advanceDueAt(previousDueAt: string, intervalMs: number, now: string): string {
  let next = Date.parse(previousDueAt)
  const nowMs = Date.parse(now)
  do {
    next += intervalMs
  } while (next <= nowMs)
  return new Date(next).toISOString()
}

function validateDate(value: string, field: string): void {
  if (Number.isNaN(Date.parse(value))) throw new Error(`${field} must be a valid date`)
}

function readLimit(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error("wake schedule list limit must be a positive integer")
  return Math.min(Number(value), MAX_LIST_LIMIT)
}

function optionalPositiveInteger(value: unknown, field: string, max: number): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${field} must be a positive integer`)
  if (Number(value) > max) throw new Error(`${field} must be no greater than ${max}`)
  return Number(value)
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`)
  return value
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${field} must be a string`)
  if (!value.trim()) throw new Error(`${field} must be nonblank`)
  return value.trim()
}

function cleanString(value: string, field: string): string {
  const trimmed = String(value).trim()
  if (!trimmed) throw new Error(`${field} must be nonblank`)
  return redactText(trimmed)
}

function boundedText(value: string, maxChars: number): string {
  return redactText(value).slice(0, maxChars)
}

function previewText(value: string): string {
  return boundedText(value, PREVIEW_CHARS)
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortValue(item)]))
  return value
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? redactText(value) : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => redactText(value)).filter(Boolean))]
}
