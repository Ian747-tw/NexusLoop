import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { WakeScheduleService } from "./wake-schedule-service"
import type {
  WakeSchedulerConfig,
  WakeSchedulerEventKind,
  WakeSchedulerEventRecord,
  WakeSchedulerPreview,
  WakeSchedulerStartInput,
  WakeSchedulerState,
  WakeSchedulerStatus,
  WakeSchedulerStopInput,
} from "./wake-scheduler-types"

const DEFAULT_INTERVAL_MS = 60_000
const DEFAULT_MAX_DUE_ITEMS = 5
const HARD_MAX_DUE_ITEMS = 20
const MAX_LIST_LIMIT = 100
const PREVIEW_CHARS = 360

export interface WakeSchedulerServiceOptions {
  eventStore: EventStore
  wakeScheduleService: WakeScheduleService
  now?: () => Date
  setTimer?: (callback: () => void, delayMs: number) => unknown
  clearTimer?: (timer: unknown) => void
  minIntervalMs?: number
  minHeartbeatIntervalMs?: number
  canRun?: () => boolean
}

type SchedulerEvent = JsonlEvent & {
  kind: WakeSchedulerEventKind
  scheduler_status?: WakeSchedulerStatus
  scheduler_config?: WakeSchedulerConfig
  tick_id?: string
  message?: string
  created_at?: string
  requested_by?: string
  stopped_by?: string
}

type SchedulerEventInput = {
  scheduler_status: WakeSchedulerStatus
  scheduler_config?: WakeSchedulerConfig
  tick_id?: string
  message?: string
  requested_by?: string
}

type NormalizedStartInput = {
  config: WakeSchedulerConfig
  requested_by: string
}

type NormalizedStopInput = {
  reason?: string
  requested_by: string
}

export class WakeSchedulerService {
  private state: WakeSchedulerState
  private timer: unknown | null = null
  private tickInFlight = false
  private activeTick: Promise<void> | null = null
  private lifecycleTransition: Promise<void> = Promise.resolve()

  constructor(private readonly options: WakeSchedulerServiceOptions) {
    this.state = {
      status: "stopped",
      config: defaultConfig(),
      tick_count: 0,
      heartbeat_count: 0,
    }
  }

  async previewStart(input: WakeSchedulerStartInput = {}): Promise<WakeSchedulerPreview> {
    const normalized = normalizeStartInput(input, this.minIntervalMs(), this.minHeartbeatIntervalMs())
    const blockers: string[] = []
    const warnings: string[] = []
    if (this.state.status === "starting" || this.state.status === "running" || this.state.status === "stopping") blockers.push("wake scheduler is already running or stopping")
    if (this.options.canRun && !this.options.canRun()) blockers.push("wake scheduler requires active started runtime with run lock")
    const duePreview = await this.options.wakeScheduleService.previewTick({
      max_due_items: normalized.config.max_due_items,
      dry_run: true,
      requested_by: normalized.requested_by,
    })
    return redactValue({
      can_start: blockers.length === 0,
      status: this.state.status,
      config: normalized.config,
      blockers: unique(blockers),
      warnings: unique(warnings),
      due_preview: duePreview,
      redacted_summary_preview: previewText(JSON.stringify({
        status: this.state.status,
        interval_ms: normalized.config.interval_ms,
        dry_run: normalized.config.dry_run,
        max_due_items: normalized.config.max_due_items,
      })),
    })
  }

  async start(input: WakeSchedulerStartInput = {}): Promise<WakeSchedulerState> {
    if (this.state.status === "stopping") throw new Error("wake scheduler is already running or stopping")
    return await this.withLifecycleLock(async () => {
      const normalized = normalizeStartInput(input, this.minIntervalMs(), this.minHeartbeatIntervalMs())
      const preview = await this.previewStart(input)
      if (!preview.can_start) throw new Error(preview.blockers[0] ?? "wake scheduler cannot start")
      const startedAt = this.now()
      this.state = {
        status: "starting",
        config: normalized.config,
        started_at: startedAt,
        tick_count: 0,
        heartbeat_count: 0,
        next_tick_at: new Date(Date.parse(startedAt) + normalized.config.interval_ms).toISOString(),
        started_by: normalized.requested_by,
      }
      await this.appendSchedulerEvent("runtime_wake_scheduler_started", {
        scheduler_status: "running",
        scheduler_config: normalized.config,
        message: "wake scheduler started",
        requested_by: normalized.requested_by,
      })
      this.state.status = "running"
      this.scheduleNext(normalized.config.interval_ms)
      return redactValue(this.state)
    })
  }

  async stop(input: WakeSchedulerStopInput = {}): Promise<WakeSchedulerState> {
    return await this.withLifecycleLock(async () => {
      const normalized = normalizeStopInput(input)
      return await this.stopScheduler(normalized, true)
    })
  }

  private async stopScheduler(normalized: NormalizedStopInput, waitForTick: boolean): Promise<WakeSchedulerState> {
    if (this.state.status === "stopped") return redactValue(this.state)
    this.clearScheduledTimer()
    const stoppedAt = this.now()
    const tickToWait = waitForTick ? this.activeTick : null
    this.state = {
      ...this.state,
      status: "stopping",
      stopped_at: stoppedAt,
      stopped_by: normalized.requested_by,
    }
    if (tickToWait) {
      await tickToWait.catch(() => undefined)
    }
    await this.appendSchedulerEvent("runtime_wake_scheduler_stopped", {
      scheduler_status: "stopped",
      scheduler_config: this.state.config,
      message: normalized.reason ?? "wake scheduler stopped",
      requested_by: normalized.requested_by,
    })
    this.state.status = "stopped"
    return redactValue(this.state)
  }

  status(): WakeSchedulerState {
    return redactValue(this.state)
  }

  async listEvents(limit = 20): Promise<WakeSchedulerEventRecord[]> {
    const cleanLimit = readLimit(limit)
    const out: WakeSchedulerEventRecord[] = []
    for (const event of await this.options.eventStore.readAll()) {
      if (!isSchedulerEventKind(event.kind)) continue
      out.push(recordFromEvent(event as SchedulerEvent))
    }
    return redactValue(out.slice().reverse().slice(0, cleanLimit))
  }

  async shutdown(reason = "runtime shutdown"): Promise<void> {
    if (this.state.status === "stopped") return
    await this.stop({ reason, requested_by: "runtime-shutdown" })
  }

  private scheduleNext(delayMs: number): void {
    this.clearScheduledTimer()
    if (this.state.status !== "running") return
    const setTimer = this.options.setTimer ?? ((callback: () => void, delay: number) => setTimeout(callback, delay))
    this.timer = setTimer(() => {
      const activeTick = this.runScheduledTick()
      this.activeTick = activeTick
      void activeTick.finally(() => {
        if (this.activeTick === activeTick) this.activeTick = null
      }).catch(() => undefined)
    }, delayMs)
  }

  private async runScheduledTick(): Promise<void> {
    if (this.state.status !== "running") return
    if (this.tickInFlight) {
      this.scheduleNext(this.state.config.interval_ms)
      return
    }
    if (this.options.canRun && !this.options.canRun()) {
      await this.failAndMaybeStop("wake scheduler lost active runtime/run lock", true)
      return
    }

    this.tickInFlight = true
    let reachedTickAttempt = false
    let countedTickAttempt = false
    try {
      reachedTickAttempt = true
      const tick = await this.options.wakeScheduleService.executeTick({
        max_due_items: this.state.config.max_due_items,
        dry_run: this.state.config.dry_run,
        requested_by: "wake-scheduler",
      })
      if (this.state.status !== "running") return
      this.state.tick_count += 1
      countedTickAttempt = true
      this.state.last_tick_id = tick.tick_id
      this.state.last_tick_at = tick.created_at
      await this.appendSchedulerEvent("runtime_wake_scheduler_tick_succeeded", {
        scheduler_status: this.state.status,
        scheduler_config: this.state.config,
        tick_id: tick.tick_id,
        message: `wake scheduler tick processed ${tick.processed_count} schedule(s)`,
        requested_by: this.state.started_by,
      })
      await this.maybeHeartbeat()
      if (this.state.config.max_ticks_per_run !== undefined && this.state.tick_count >= this.state.config.max_ticks_per_run) {
        await this.stopScheduler({ reason: "wake scheduler max_ticks_per_run reached", requested_by: "wake-scheduler" }, false)
        return
      }
    } catch (error) {
      if (this.state.status !== "running") return
      if (reachedTickAttempt && !countedTickAttempt) {
        this.state.tick_count += 1
        countedTickAttempt = true
      }
      const maxTicksReached = this.state.config.max_ticks_per_run !== undefined && this.state.tick_count >= this.state.config.max_ticks_per_run
      await this.failAndMaybeStop(error instanceof Error ? error.message : String(error), this.state.config.stop_on_error || maxTicksReached)
      return
    } finally {
      this.tickInFlight = false
    }

    if (this.state.status === "running") {
      const now = this.now()
      this.state.next_tick_at = new Date(Date.parse(now) + this.state.config.interval_ms).toISOString()
      this.scheduleNext(this.state.config.interval_ms)
    }
  }

  private async failAndMaybeStop(message: string, stop: boolean): Promise<void> {
    const safeMessage = previewText(message)
    this.state.last_error = safeMessage
    await this.appendSchedulerEvent("runtime_wake_scheduler_tick_failed", {
      scheduler_status: stop ? "failed" : this.state.status,
      scheduler_config: this.state.config,
      message: safeMessage,
      requested_by: this.state.started_by,
    })
    if (stop) {
      this.clearScheduledTimer()
      this.state.status = "failed"
      this.state.stopped_at = this.now()
      await this.appendSchedulerEvent("runtime_wake_scheduler_stopped", {
        scheduler_status: "failed",
        scheduler_config: this.state.config,
        message: safeMessage,
        requested_by: "wake-scheduler",
      })
      return
    }
    this.scheduleNext(this.state.config.interval_ms)
  }

  private async maybeHeartbeat(): Promise<void> {
    const heartbeatInterval = this.state.config.heartbeat_interval_ms ?? this.state.config.interval_ms
    if (this.state.heartbeat_count > 0 && this.state.last_tick_at) {
      const started = Date.parse(this.state.started_at ?? this.state.last_tick_at)
      const elapsed = Date.parse(this.state.last_tick_at) - started
      if (elapsed < heartbeatInterval * this.state.heartbeat_count) return
    }
    this.state.heartbeat_count += 1
    await this.appendSchedulerEvent("runtime_wake_scheduler_heartbeat", {
      scheduler_status: this.state.status,
      scheduler_config: this.state.config,
      message: "wake scheduler heartbeat",
      requested_by: this.state.started_by,
    })
  }

  private async appendSchedulerEvent(kind: WakeSchedulerEventKind, event: SchedulerEventInput): Promise<void> {
    await this.options.eventStore.append({
      kind,
      created_at: this.now(),
      scheduler_status: event.scheduler_status,
      scheduler_config: event.scheduler_config ? configSummary(event.scheduler_config) : undefined,
      tick_id: event.tick_id,
      message: event.message ? previewText(event.message) : undefined,
      requested_by: event.requested_by ? previewText(event.requested_by) : undefined,
    })
  }

  private clearScheduledTimer(): void {
    if (this.timer === null) return
    const clearTimer = this.options.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>))
    clearTimer(this.timer)
    this.timer = null
  }

  private now(): string {
    return (this.options.now ?? (() => new Date()))().toISOString()
  }

  private minIntervalMs(): number {
    return this.options.minIntervalMs ?? DEFAULT_INTERVAL_MS
  }

  private minHeartbeatIntervalMs(): number {
    return this.options.minHeartbeatIntervalMs ?? this.minIntervalMs()
  }

  private async withLifecycleLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.lifecycleTransition
    let release!: () => void
    this.lifecycleTransition = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

export function readWakeSchedulerStartInput(payload: Record<string, unknown>): WakeSchedulerStartInput {
  return {
    interval_ms: optionalPositiveInteger(payload.intervalMs ?? payload.interval_ms, "intervalMs"),
    max_due_items: optionalPositiveInteger(payload.maxDueItems ?? payload.max_due_items, "maxDueItems"),
    dry_run: optionalBoolean(payload.dryRun ?? payload.dry_run, "dryRun"),
    heartbeat_interval_ms: optionalPositiveInteger(payload.heartbeatIntervalMs ?? payload.heartbeat_interval_ms, "heartbeatIntervalMs"),
    max_ticks_per_run: optionalPositiveInteger(payload.maxTicksPerRun ?? payload.max_ticks_per_run, "maxTicksPerRun"),
    stop_on_error: optionalBoolean(payload.stopOnError ?? payload.stop_on_error, "stopOnError"),
    requested_by: optionalString(payload.requestedBy ?? payload.requested_by, "requestedBy"),
  }
}

export function readWakeSchedulerStopInput(payload: Record<string, unknown>): WakeSchedulerStopInput {
  return {
    reason: optionalString(payload.reason, "reason"),
    requested_by: optionalString(payload.requestedBy ?? payload.requested_by, "requestedBy"),
  }
}

function normalizeStartInput(input: WakeSchedulerStartInput, minIntervalMs: number, minHeartbeatIntervalMs: number): NormalizedStartInput {
  const intervalMs = input.interval_ms ?? input.intervalMs ?? DEFAULT_INTERVAL_MS
  if (!Number.isInteger(intervalMs) || Number(intervalMs) < minIntervalMs) throw new Error(`interval_ms must be at least ${minIntervalMs}`)
  const maxDueItems = input.max_due_items ?? input.maxDueItems ?? DEFAULT_MAX_DUE_ITEMS
  if (!Number.isInteger(maxDueItems) || Number(maxDueItems) < 1) throw new Error("max_due_items must be a positive integer")
  if (Number(maxDueItems) > HARD_MAX_DUE_ITEMS) throw new Error(`max_due_items must be no greater than ${HARD_MAX_DUE_ITEMS}`)
  const heartbeatIntervalMs = input.heartbeat_interval_ms ?? input.heartbeatIntervalMs ?? Number(intervalMs)
  if (!Number.isInteger(heartbeatIntervalMs) || Number(heartbeatIntervalMs) < minHeartbeatIntervalMs) throw new Error(`heartbeat_interval_ms must be at least ${minHeartbeatIntervalMs}`)
  const maxTicksPerRun = input.max_ticks_per_run ?? input.maxTicksPerRun
  if (maxTicksPerRun !== undefined && (!Number.isInteger(maxTicksPerRun) || Number(maxTicksPerRun) < 1)) throw new Error("max_ticks_per_run must be a positive integer")
  const requestedBy = previewText(cleanString(input.requested_by ?? input.requestedBy ?? "operator", "requested_by"))
  return {
    requested_by: requestedBy,
    config: {
      enabled: true,
      interval_ms: Number(intervalMs),
      max_due_items: Number(maxDueItems),
      dry_run: input.dry_run === true || input.dryRun === true,
      heartbeat_interval_ms: Number(heartbeatIntervalMs),
      max_ticks_per_run: maxTicksPerRun === undefined ? undefined : Number(maxTicksPerRun),
      stop_on_error: input.stop_on_error === true || input.stopOnError === true,
      started_by: requestedBy,
    },
  }
}

function normalizeStopInput(input: WakeSchedulerStopInput): NormalizedStopInput {
  return {
    reason: input.reason ? previewText(cleanString(input.reason, "reason")) : undefined,
    requested_by: previewText(cleanString(input.requested_by ?? input.requestedBy ?? "operator", "requested_by")),
  }
}

function defaultConfig(): WakeSchedulerConfig {
  return {
    enabled: false,
    interval_ms: DEFAULT_INTERVAL_MS,
    max_due_items: DEFAULT_MAX_DUE_ITEMS,
    dry_run: false,
    heartbeat_interval_ms: DEFAULT_INTERVAL_MS,
    stop_on_error: false,
  }
}

function configSummary(config: WakeSchedulerConfig): WakeSchedulerConfig {
  return redactValue({
    enabled: config.enabled,
    interval_ms: config.interval_ms,
    max_due_items: config.max_due_items,
    dry_run: config.dry_run,
    heartbeat_interval_ms: config.heartbeat_interval_ms,
    max_ticks_per_run: config.max_ticks_per_run,
    stop_on_error: config.stop_on_error,
    started_by: config.started_by,
  })
}

function recordFromEvent(event: SchedulerEvent): WakeSchedulerEventRecord {
  return {
    event_id: typeof event.event_id === "string" ? event.event_id : undefined,
    kind: event.kind,
    scheduler_status: event.scheduler_status ?? "stopped",
    tick_id: typeof event.tick_id === "string" ? redactText(event.tick_id) : undefined,
    message: typeof event.message === "string" ? previewText(event.message) : undefined,
    created_at: typeof event.created_at === "string" ? redactText(event.created_at) : typeof event.timestamp === "string" ? redactText(event.timestamp) : new Date(0).toISOString(),
    requested_by: typeof event.requested_by === "string" ? previewText(event.requested_by) : undefined,
  }
}

function readLimit(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error("wake scheduler event limit must be a positive integer")
  return Math.min(Number(value), MAX_LIST_LIMIT)
}

function optionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${field} must be a positive integer`)
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

function previewText(value: string): string {
  return redactText(value).slice(0, PREVIEW_CHARS)
}

function isSchedulerEventKind(value: unknown): value is WakeSchedulerEventKind {
  return value === "runtime_wake_scheduler_started"
    || value === "runtime_wake_scheduler_stopped"
    || value === "runtime_wake_scheduler_tick_succeeded"
    || value === "runtime_wake_scheduler_tick_failed"
    || value === "runtime_wake_scheduler_heartbeat"
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => redactText(value)).filter(Boolean))]
}
