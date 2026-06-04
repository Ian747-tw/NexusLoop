export type WakeSchedulerNavigationWriteRisk = "low_risk_write" | "medium_risk_write" | "high_impact_write" | "unsupported"

export type WakeSchedulerNavigationWriteAuthorityGate =
  | "wake_scheduler_runtime"
  | "wake_schedule_tick"
  | "checkpoint_runtime"
  | "recovery_runtime"
  | "recovery_workflow_runtime"
  | "continuation_runtime"
  | "handoff_runtime"
  | "mission_runtime"
  | "proposal_review_runtime"
  | "reasoning_provider_runtime"
  | "unknown"

export type WakeSchedulerNavigationWriteEligibilityStatus =
  | "eligible_for_future_staging"
  | "blocked"
  | "unsupported"
  | "requires_human_approval"
  | "high_impact_blocked"

export interface WakeSchedulerNavigationWritePrerequisite {
  name: string
  satisfied: boolean
  severity: "info" | "warning" | "error"
  summary: string
}

export interface WakeSchedulerNavigationWriteCommand {
  label: string
  command: string
  command_type: "read" | "write"
  risk?: string
  requires_active_runtime?: boolean
  notes?: string
}

export interface WakeSchedulerNavigationFutureStagePolicy {
  would_require_active_runtime: boolean
  would_require_run_lock: boolean
  would_require_confirmation: boolean
  would_require_approval_record: boolean
  would_require_dry_run_first: boolean
  would_require_recent_read_evidence: boolean
  allowed_in_7t: false
}

export interface WakeSchedulerNavigationWritePreview {
  command: string
  command_name: string
  command_type: "write"
  risk: WakeSchedulerNavigationWriteRisk
  authority_gate: WakeSchedulerNavigationWriteAuthorityGate
  equivalent_runtime_command?: string
  status: WakeSchedulerNavigationWriteEligibilityStatus
  can_stage_now: false
  can_execute_now: false
  target_kind: string
  target_id?: string
  parsed_args: Record<string, string>
  prerequisites: WakeSchedulerNavigationWritePrerequisite[]
  blockers: string[]
  warnings: string[]
  safer_read_commands: WakeSchedulerNavigationWriteCommand[]
  future_stage_policy?: WakeSchedulerNavigationFutureStagePolicy
  redacted_summary_preview: string
}

export interface WakeSchedulerNavigationWriteBoard {
  board_id: string
  source: {
    kind: "command" | "navigation_board" | "related_id" | "incident" | "staged_read_group"
    related_id?: string
    incident_id?: string
    staged_id?: string
  }
  previews: WakeSchedulerNavigationWritePreview[]
  omitted_read_count: number
  unsupported_count: number
  high_impact_count: number
  blockers: string[]
  warnings: string[]
  generated_at: string
}

export interface WakeSchedulerNavigationWritePreviewInput {
  command: string
  source_related_id?: string
  sourceRelatedId?: string
  source_incident_id?: string
  sourceIncidentId?: string
}

export interface WakeSchedulerNavigationWriteBoardInput {
  command?: string
  related_id?: string
  relatedId?: string
  incident_id?: string
  incidentId?: string
  staged_id?: string
  stagedId?: string
  include_high_impact?: boolean
  includeHighImpact?: boolean
  limit?: number
}
