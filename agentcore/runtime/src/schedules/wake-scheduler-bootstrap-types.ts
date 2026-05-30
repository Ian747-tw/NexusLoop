import type { WakeScheduleTickPreview } from "./wake-schedule-types"
import type { WakeSchedulerConfig, WakeSchedulerStatus } from "./wake-scheduler-types"

export type WakeSchedulerBootstrapConfig = {
  autostart_enabled: boolean
  interval_ms: number
  max_due_items: number
  dry_run: boolean
  heartbeat_interval_ms?: number
  max_ticks_per_run?: number
  stop_on_error: boolean
  require_due_schedule?: boolean
  requested_by?: string
}

export type WakeSchedulerStaleRunInfo = {
  detected: boolean
  prior_started_at?: string
  prior_status?: WakeSchedulerStatus
  prior_tick_id?: string
  prior_event_id?: string
  reason?: string
}

export type WakeSchedulerBootstrapStatus = {
  autostart_enabled: boolean
  configured: boolean
  can_bootstrap: boolean
  scheduler_status: WakeSchedulerStatus
  config: WakeSchedulerBootstrapConfig
  blockers: string[]
  warnings: string[]
  last_bootstrap_event_id?: string
  last_bootstrap_at?: string
  stale_prior_run?: WakeSchedulerStaleRunInfo
  due_preview?: WakeScheduleTickPreview
  redacted_summary_preview: string
}

export type WakeSchedulerBootstrapEventKind =
  | "runtime_wake_scheduler_bootstrap_skipped"
  | "runtime_wake_scheduler_bootstrap_started"
  | "runtime_wake_scheduler_bootstrap_blocked"
  | "runtime_wake_scheduler_stale_run_detected"

export type WakeSchedulerBootstrapEvent = {
  kind: WakeSchedulerBootstrapEventKind
  created_at: string
  autostart_enabled: boolean
  scheduler_status: WakeSchedulerStatus
  message: string
  requested_by: string
  scheduler_config: WakeSchedulerConfig
  stale_prior_run?: WakeSchedulerStaleRunInfo
}
