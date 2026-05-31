export type WakeSchedulerAuditEventKind =
  | "checkpoint"
  | "resume_anchor"
  | "wake_assessment"
  | "continuation_plan"
  | "continuation_step"
  | "wake_schedule"
  | "wake_tick"
  | "scheduler_lifecycle"
  | "scheduler_bootstrap"
  | "scheduler_recovery"
  | "scheduler_recovery_workflow"
  | "incident"
  | "other"

export type WakeSchedulerAuditSeverity = "info" | "warning" | "error"

export interface WakeSchedulerAuditCommand {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export interface WakeSchedulerAuditTimelineEntry {
  audit_id: string
  event_id?: string
  source_kind: WakeSchedulerAuditEventKind
  source_event_kind: string
  severity: WakeSchedulerAuditSeverity
  created_at: string
  title: string
  summary: string
  related_ids: Record<string, string[]>
  recommended_commands: WakeSchedulerAuditCommand[]
}

export interface WakeSchedulerAuditSummary {
  event_count: number
  checkpoint_count: number
  resume_anchor_count: number
  wake_assessment_count: number
  continuation_plan_count: number
  continuation_step_count: number
  schedule_count: number
  tick_count: number
  scheduler_start_count: number
  scheduler_stop_count: number
  scheduler_failure_count: number
  bootstrap_blocked_count: number
  stale_recovery_count: number
  recovery_workflow_count: number
  unresolved_incident_count: number
  last_event_at?: string
  latest_scheduler_status?: string
  latest_bootstrap_status?: string
  latest_recovery_status?: string
}

export interface WakeSchedulerAuditGap {
  severity: WakeSchedulerAuditSeverity
  message: string
  related_ids?: Record<string, string[]>
}

export interface WakeSchedulerAuditChain {
  chain_id: string
  root_kind: WakeSchedulerAuditEventKind
  root_id: string
  entries: WakeSchedulerAuditTimelineEntry[]
  related_ids: Record<string, string[]>
  gaps: WakeSchedulerAuditGap[]
  recommended_commands: WakeSchedulerAuditCommand[]
}

export interface WakeSchedulerAuditIncident {
  incident_id: string
  severity: WakeSchedulerAuditSeverity
  status: "open" | "acknowledged" | "resolved" | "unknown"
  title: string
  summary: string
  first_seen_at?: string
  last_seen_at?: string
  related_entries: WakeSchedulerAuditTimelineEntry[]
  recommended_commands: WakeSchedulerAuditCommand[]
}

export interface WakeSchedulerAuditQuery {
  limit?: number
  since?: string
  until?: string
  kinds?: WakeSchedulerAuditEventKind[]
  severity?: WakeSchedulerAuditSeverity
  related_id?: string
  include_commands?: boolean
}
