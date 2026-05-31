import type { WakeSchedulerAuditTimelineEntry } from "./wake-scheduler-audit-types"

export type WakeSchedulerNavigationSourceKind = "summary" | "timeline" | "chain" | "incident" | "related_id" | "command"
export type WakeSchedulerNavigationCommandType = "read" | "write"
export type WakeSchedulerNavigationRisk = "safe_read" | "write_requires_operator" | "high_impact_write" | "unsupported"
export type WakeSchedulerNavigationTargetKind =
  | "scheduler_status"
  | "scheduler_bootstrap"
  | "scheduler_recovery"
  | "scheduler_recovery_workflow"
  | "scheduler_audit"
  | "wake_schedule"
  | "wake_tick"
  | "wake_assessment"
  | "continuation_plan"
  | "checkpoint"
  | "resume_anchor"
  | "handoff_followup"
  | "mission"
  | "unknown"

export interface WakeSchedulerNavigationSource {
  kind: WakeSchedulerNavigationSourceKind
  related_id?: string
  incident_id?: string
  audit_id?: string
}

export interface WakeSchedulerNavigationCard {
  card_id: string
  label: string
  command: string
  command_type: WakeSchedulerNavigationCommandType
  risk: WakeSchedulerNavigationRisk
  target_kind: WakeSchedulerNavigationTargetKind
  target_id?: string
  supported: boolean
  blockers: string[]
  notes: string[]
  recommended_order: number
}

export interface WakeSchedulerNavigationBoard {
  board_id: string
  source: WakeSchedulerNavigationSource
  title: string
  summary: string
  cards: WakeSchedulerNavigationCard[]
  related_ids: Record<string, string[]>
  warnings: string[]
  blockers: string[]
  generated_at: string
}

export interface WakeSchedulerNavigationCommandPreview {
  command: string
  command_type: WakeSchedulerNavigationCommandType
  risk: WakeSchedulerNavigationRisk
  target_kind: WakeSchedulerNavigationTargetKind
  target_id?: string
  supported: boolean
  blockers: string[]
  notes: string[]
  equivalent_runtime_command?: string
  redacted_summary_preview: string
}

export interface WakeSchedulerNavigationTarget {
  target_kind: WakeSchedulerNavigationTargetKind
  target_id: string
  title: string
  related_commands: WakeSchedulerNavigationCard[]
  related_ids: Record<string, string[]>
  audit_entries: WakeSchedulerAuditTimelineEntry[]
  warnings: string[]
}

export interface WakeSchedulerNavigationInput {
  related_id?: string
  relatedId?: string
  incident_id?: string
  incidentId?: string
  audit_id?: string
  auditId?: string
  command?: string
  limit?: number
  include_write?: boolean
  includeWrite?: boolean
}
