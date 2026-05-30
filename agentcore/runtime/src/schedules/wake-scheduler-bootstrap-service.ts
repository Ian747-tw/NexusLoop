import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { WakeSchedulerService } from "./wake-scheduler-service"
import type { WakeSchedulerConfig, WakeSchedulerEventKind, WakeSchedulerStartInput, WakeSchedulerStatus } from "./wake-scheduler-types"
import type {
  WakeSchedulerBootstrapConfig,
  WakeSchedulerBootstrapEvent,
  WakeSchedulerBootstrapEventKind,
  WakeSchedulerBootstrapStatus,
  WakeSchedulerStaleRunInfo,
} from "./wake-scheduler-bootstrap-types"

const DEFAULT_INTERVAL_MS = 60_000
const DEFAULT_MAX_DUE_ITEMS = 5
const PREVIEW_CHARS = 360

export interface WakeSchedulerBootstrapServiceOptions {
  eventStore: EventStore
  scheduler: WakeSchedulerService
  config?: WakeSchedulerBootstrapConfig
  now?: () => Date
}

type BootstrapEvent = JsonlEvent & WakeSchedulerBootstrapEvent
type SchedulerEvent = JsonlEvent & {
  kind?: WakeSchedulerEventKind | WakeSchedulerBootstrapEventKind | "runtime_shutdown"
  scheduler_status?: WakeSchedulerStatus
  tick_id?: string
  created_at?: string
}

export class WakeSchedulerBootstrapService {
  constructor(private readonly options: WakeSchedulerBootstrapServiceOptions) {}

  async status(): Promise<WakeSchedulerBootstrapStatus> {
    return this.buildStatus({ previewOnly: false })
  }

  async preview(): Promise<WakeSchedulerBootstrapStatus> {
    return this.buildStatus({ previewOnly: true })
  }

  async bootstrapOnRuntimeStart(): Promise<WakeSchedulerBootstrapStatus> {
    const status = await this.buildStatus({ previewOnly: true })
    if (!status.configured || !status.autostart_enabled) {
      if (status.configured) {
        await this.appendBootstrapEvent("runtime_wake_scheduler_bootstrap_skipped", status, "wake scheduler autostart disabled")
        return this.status()
      }
      return status
    }
    if (status.stale_prior_run?.detected) {
      await this.appendBootstrapEvent("runtime_wake_scheduler_stale_run_detected", status, status.stale_prior_run.reason ?? "stale prior scheduler run detected")
    }
    if (!status.can_bootstrap) {
      await this.appendBootstrapEvent("runtime_wake_scheduler_bootstrap_blocked", status, status.blockers[0] ?? "wake scheduler bootstrap blocked")
      return this.status()
    }

    await this.options.scheduler.start(startInputFromBootstrap(status.config))
    const started = await this.buildStatus({ previewOnly: true })
    await this.appendBootstrapEvent("runtime_wake_scheduler_bootstrap_started", started, "wake scheduler bootstrap started")
    return this.status()
  }

  private async buildStatus(options: { previewOnly: boolean }): Promise<WakeSchedulerBootstrapStatus> {
    const config = normalizeBootstrapConfig(this.options.config)
    const configured = this.options.config !== undefined
    const schedulerStatus = this.options.scheduler.status()
    const blockers: string[] = []
    const warnings: string[] = []
    let duePreview = undefined

    const stalePriorRun = await this.detectStalePriorRun()
    if (stalePriorRun.detected) warnings.push(stalePriorRun.reason ?? "stale prior scheduler run detected")

    try {
      const preview = await this.options.scheduler.previewStart(startInputFromBootstrap(config))
      duePreview = preview.due_preview
      blockers.push(...preview.blockers)
      warnings.push(...preview.warnings)
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : String(error))
    }

    if (!configured) warnings.push("wake scheduler bootstrap config absent")
    if (!config.autostart_enabled) blockers.push("wake scheduler autostart disabled")
    if (config.require_due_schedule && (duePreview?.eligible_count ?? 0) < 1) blockers.push("wake scheduler bootstrap requires an eligible due schedule")

    const lastBootstrap = await this.lastBootstrapEvent()
    return redactValue({
      autostart_enabled: config.autostart_enabled,
      configured,
      can_bootstrap: blockers.length === 0,
      scheduler_status: schedulerStatus.status,
      config,
      blockers: unique(blockers),
      warnings: unique(warnings),
      last_bootstrap_event_id: lastBootstrap?.event_id,
      last_bootstrap_at: lastBootstrap?.created_at,
      stale_prior_run: stalePriorRun,
      due_preview: duePreview,
      redacted_summary_preview: previewText(JSON.stringify({
        configured,
        autostart_enabled: config.autostart_enabled,
        scheduler_status: schedulerStatus.status,
        interval_ms: config.interval_ms,
        dry_run: config.dry_run,
        require_due_schedule: config.require_due_schedule === true,
        preview_only: options.previewOnly,
      })),
    })
  }

  private async appendBootstrapEvent(kind: WakeSchedulerBootstrapEventKind, status: WakeSchedulerBootstrapStatus, message: string): Promise<string> {
    return this.options.eventStore.append({
      kind,
      created_at: this.now(),
      autostart_enabled: status.autostart_enabled,
      scheduler_status: status.scheduler_status,
      message: previewText(message),
      requested_by: previewText(status.config.requested_by ?? "scheduler-bootstrap"),
      scheduler_config: schedulerConfigSummary(status.config),
      stale_prior_run: status.stale_prior_run?.detected ? status.stale_prior_run : undefined,
    })
  }

  private async lastBootstrapEvent(): Promise<{ event_id?: string; created_at?: string } | null> {
    const events = await this.options.eventStore.readAll()
    for (const event of events.slice().reverse()) {
      if (!isBootstrapEventKind(event.kind)) continue
      return {
        event_id: typeof event.event_id === "string" ? event.event_id : undefined,
        created_at: typeof event.created_at === "string" ? event.created_at : typeof event.timestamp === "string" ? event.timestamp : undefined,
      }
    }
    return null
  }

  private async detectStalePriorRun(): Promise<WakeSchedulerStaleRunInfo> {
    const events = (await this.options.eventStore.readAll()) as SchedulerEvent[]
    let openStart: SchedulerEvent | null = null
    for (const event of events) {
      if (event.kind === "runtime_wake_scheduler_started") openStart = event
      else if (event.kind === "runtime_wake_scheduler_tick_succeeded" || event.kind === "runtime_wake_scheduler_tick_failed") {
        if (openStart && typeof event.tick_id === "string") openStart = Object.assign({}, openStart, { tick_id: event.tick_id })
      } else if (event.kind === "runtime_wake_scheduler_stopped" || event.kind === "runtime_shutdown") {
        openStart = null
      }
    }
    if (!openStart) return { detected: false }
    const current = this.options.scheduler.status()
    const openStartedAt = typeof openStart.created_at === "string" ? openStart.created_at : typeof openStart.timestamp === "string" ? openStart.timestamp : undefined
    if (current.status === "running") return { detected: false }
    return redactValue({
      detected: true,
      prior_started_at: openStartedAt,
      prior_status: openStart.scheduler_status ?? "running",
      prior_tick_id: typeof openStart.tick_id === "string" ? openStart.tick_id : undefined,
      prior_event_id: typeof openStart.event_id === "string" ? openStart.event_id : undefined,
      reason: "previous scheduler start has no matching stop or runtime shutdown event",
    })
  }

  private now(): string {
    return (this.options.now ?? (() => new Date()))().toISOString()
  }
}

export function defaultWakeSchedulerBootstrapConfig(): WakeSchedulerBootstrapConfig {
  return {
    autostart_enabled: false,
    interval_ms: DEFAULT_INTERVAL_MS,
    max_due_items: DEFAULT_MAX_DUE_ITEMS,
    dry_run: false,
    stop_on_error: false,
    require_due_schedule: false,
    requested_by: "scheduler-bootstrap",
  }
}

export function normalizeBootstrapConfig(input: WakeSchedulerBootstrapConfig | undefined): WakeSchedulerBootstrapConfig {
  const config = input ?? defaultWakeSchedulerBootstrapConfig()
  if (!Number.isInteger(config.interval_ms) || config.interval_ms < 1) throw new Error("wake scheduler bootstrap interval_ms must be a positive integer")
  if (!Number.isInteger(config.max_due_items) || config.max_due_items < 1) throw new Error("wake scheduler bootstrap max_due_items must be a positive integer")
  if (config.heartbeat_interval_ms !== undefined && (!Number.isInteger(config.heartbeat_interval_ms) || config.heartbeat_interval_ms < 1)) throw new Error("wake scheduler bootstrap heartbeat_interval_ms must be a positive integer")
  if (config.max_ticks_per_run !== undefined && (!Number.isInteger(config.max_ticks_per_run) || config.max_ticks_per_run < 1)) throw new Error("wake scheduler bootstrap max_ticks_per_run must be a positive integer")
  return redactValue({
    autostart_enabled: config.autostart_enabled === true,
    interval_ms: Number(config.interval_ms),
    max_due_items: Number(config.max_due_items),
    dry_run: config.dry_run === true,
    heartbeat_interval_ms: config.heartbeat_interval_ms === undefined ? undefined : Number(config.heartbeat_interval_ms),
    max_ticks_per_run: config.max_ticks_per_run === undefined ? undefined : Number(config.max_ticks_per_run),
    stop_on_error: config.stop_on_error === true,
    require_due_schedule: config.require_due_schedule === true,
    requested_by: previewText(config.requested_by ?? "scheduler-bootstrap"),
  })
}

function startInputFromBootstrap(config: WakeSchedulerBootstrapConfig): WakeSchedulerStartInput {
  return {
    interval_ms: config.interval_ms,
    max_due_items: config.max_due_items,
    dry_run: config.dry_run,
    heartbeat_interval_ms: config.heartbeat_interval_ms,
    max_ticks_per_run: config.max_ticks_per_run,
    stop_on_error: config.stop_on_error,
    requested_by: config.requested_by ?? "scheduler-bootstrap",
  }
}

function schedulerConfigSummary(config: WakeSchedulerBootstrapConfig): WakeSchedulerConfig {
  return redactValue({
    enabled: config.autostart_enabled,
    interval_ms: config.interval_ms,
    max_due_items: config.max_due_items,
    dry_run: config.dry_run,
    heartbeat_interval_ms: config.heartbeat_interval_ms ?? config.interval_ms,
    max_ticks_per_run: config.max_ticks_per_run,
    stop_on_error: config.stop_on_error,
    started_by: config.requested_by ?? "scheduler-bootstrap",
  })
}

function isBootstrapEventKind(value: unknown): value is WakeSchedulerBootstrapEventKind {
  return value === "runtime_wake_scheduler_bootstrap_skipped"
    || value === "runtime_wake_scheduler_bootstrap_started"
    || value === "runtime_wake_scheduler_bootstrap_blocked"
    || value === "runtime_wake_scheduler_stale_run_detected"
}

function previewText(value: string): string {
  return redactText(value).slice(0, PREVIEW_CHARS)
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => previewText(value)).filter(Boolean))]
}
