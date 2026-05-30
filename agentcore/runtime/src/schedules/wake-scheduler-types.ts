import type { WakeScheduleTickPreview } from "./wake-schedule-types"

export type WakeSchedulerStatus = "stopped" | "starting" | "running" | "stopping" | "failed"

export type WakeSchedulerConfig = {
  enabled: boolean
  interval_ms: number
  max_due_items: number
  dry_run: boolean
  started_by?: string
  heartbeat_interval_ms?: number
  max_ticks_per_run?: number
  stop_on_error: boolean
}

export type WakeSchedulerPreview = {
  can_start: boolean
  status: WakeSchedulerStatus
  config: WakeSchedulerConfig
  blockers: string[]
  warnings: string[]
  due_preview?: WakeScheduleTickPreview
  redacted_summary_preview: string
}

export type WakeSchedulerState = {
  status: WakeSchedulerStatus
  config: WakeSchedulerConfig
  started_at?: string
  stopped_at?: string
  last_tick_id?: string
  last_tick_at?: string
  last_error?: string
  tick_count: number
  heartbeat_count: number
  next_tick_at?: string
  started_by?: string
  stopped_by?: string
}

export type WakeSchedulerEventKind =
  | "runtime_wake_scheduler_started"
  | "runtime_wake_scheduler_stopped"
  | "runtime_wake_scheduler_tick_succeeded"
  | "runtime_wake_scheduler_tick_failed"
  | "runtime_wake_scheduler_heartbeat"

export type WakeSchedulerEventRecord = {
  event_id?: string
  kind: WakeSchedulerEventKind
  scheduler_status: WakeSchedulerStatus
  tick_id?: string
  message?: string
  created_at: string
  requested_by?: string
}

export type WakeSchedulerStartInput = {
  interval_ms?: number
  intervalMs?: number
  max_due_items?: number
  maxDueItems?: number
  dry_run?: boolean
  dryRun?: boolean
  heartbeat_interval_ms?: number
  heartbeatIntervalMs?: number
  max_ticks_per_run?: number
  maxTicksPerRun?: number
  stop_on_error?: boolean
  stopOnError?: boolean
  requested_by?: string
  requestedBy?: string
}

export type WakeSchedulerStopInput = {
  reason?: string
  requested_by?: string
  requestedBy?: string
}
