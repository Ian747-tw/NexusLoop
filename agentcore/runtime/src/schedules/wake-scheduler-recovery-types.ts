import type { WakeSchedulerBootstrapStatus } from "./wake-scheduler-bootstrap-types"
import type { WakeSchedulerStatus } from "./wake-scheduler-types"

export type WakeSchedulerRecoveryStatus = "none" | "detected" | "acknowledged" | "resolved" | "dismissed"

export type WakeSchedulerRecoveryCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type WakeSchedulerRecoveryPreview = {
  recovery_id?: string
  stale_detected: boolean
  status: WakeSchedulerRecoveryStatus
  prior_started_at?: string
  prior_event_id?: string
  prior_tick_id?: string
  scheduler_status: WakeSchedulerStatus
  bootstrap_status?: WakeSchedulerBootstrapStatus
  current_event_count: number
  due_schedule_count: number
  eligible_due_schedule_count: number
  blocked_due_schedule_count: number
  missed_window_estimate_count?: number
  warnings: string[]
  blockers: string[]
  recommended_commands: WakeSchedulerRecoveryCommand[]
  redacted_summary_preview: string
}

export type WakeSchedulerRecovery = WakeSchedulerRecoveryPreview & {
  recovery_id: string
  stale_detected: boolean
  acknowledged_at?: string
  acknowledged_by?: string
  resolution_reason?: string
  created_at: string
  updated_at: string
  recovery_hash: string
}

export type WakeSchedulerRecoveryRecord = {
  recovery_id: string
  status: WakeSchedulerRecoveryStatus
  stale_detected: boolean
  prior_started_at?: string
  acknowledged_at?: string
  updated_at: string
  summary_preview: string
  recovery_hash: string
}

export type WakeSchedulerRecoveryAcknowledgeInput = {
  recovery_id?: string
  recoveryId?: string
  reason?: string
  resolution: "acknowledged" | "resolved" | "dismissed"
  requested_by?: string
  requestedBy?: string
}

export type WakeSchedulerRecoveryRecordedEvent = {
  kind: "runtime_wake_scheduler_recovery_recorded"
  recovery_id: string
  resolution: "acknowledged" | "resolved" | "dismissed"
  reason?: string
  stale_prior_event_id?: string
  prior_started_at?: string
  prior_tick_id?: string
  recorded_at: string
  requested_by: string
  recovery_hash: string
  summary_preview: string
}
