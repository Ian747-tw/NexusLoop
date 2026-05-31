export type WakeSchedulerNavigationStageStatus = "staged" | "removed" | "cleared"

export type WakeSchedulerNavigationStageRisk = "safe_read" | "write_requires_operator" | "high_impact_write" | "unsupported"

export type WakeSchedulerNavigationStageTargetKind =
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

export interface WakeSchedulerNavigationStageEligibility {
  can_stage: boolean
  command: string
  command_type: "read" | "write"
  risk: WakeSchedulerNavigationStageRisk
  target_kind: WakeSchedulerNavigationStageTargetKind
  target_id?: string
  blockers: string[]
  warnings: string[]
  redacted_summary_preview: string
}

export interface WakeSchedulerNavigationStagedCommand {
  staged_id: string
  command: string
  command_type: "read" | "write"
  risk: WakeSchedulerNavigationStageRisk
  target_kind: WakeSchedulerNavigationStageTargetKind
  target_id?: string
  source_board_id?: string
  source_card_id?: string
  source_audit_id?: string
  source_incident_id?: string
  source_related_id?: string
  label: string
  notes: string[]
  staged_at: string
  staged_by: string
  status: "staged"
  stage_hash: string
}

export interface WakeSchedulerNavigationStagedCommandRecord {
  staged_id: string
  command: string
  risk: WakeSchedulerNavigationStageRisk
  target_kind: WakeSchedulerNavigationStageTargetKind
  target_id?: string
  staged_at: string
  staged_by: string
  summary_preview: string
  stage_hash: string
}

export interface WakeSchedulerNavigationStagePreview {
  command: string
  source_card_id?: string
  source_board_id?: string
  eligibility: WakeSchedulerNavigationStageEligibility
  existing_staged_id?: string
  blockers: string[]
  warnings: string[]
}

export interface WakeSchedulerNavigationStageInput {
  command: string
  source_board_id?: string
  sourceBoardId?: string
  source_card_id?: string
  sourceCardId?: string
  source_audit_id?: string
  sourceAuditId?: string
  source_incident_id?: string
  sourceIncidentId?: string
  source_related_id?: string
  sourceRelatedId?: string
  requested_by?: string
  requestedBy?: string
}

export interface WakeSchedulerNavigationStageRemoveInput {
  staged_id: string
  stagedId?: string
  reason?: string
  requested_by?: string
  requestedBy?: string
}

export interface WakeSchedulerNavigationStageClearInput {
  reason?: string
  requested_by?: string
  requestedBy?: string
}
