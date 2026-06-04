import type {
  WakeSchedulerNavigationFutureStagePolicy,
  WakeSchedulerNavigationWriteAuthorityGate,
  WakeSchedulerNavigationWriteCommand,
  WakeSchedulerNavigationWriteEligibilityStatus,
  WakeSchedulerNavigationWritePrerequisite,
  WakeSchedulerNavigationWriteRisk,
} from "./wake-scheduler-navigation-write-preview-types"

export type WakeSchedulerNavigationWriteStageStatus = "staged" | "removed" | "cleared"

export interface WakeSchedulerNavigationWriteStageEligibility {
  can_stage: boolean
  command: string
  command_name: string
  risk: WakeSchedulerNavigationWriteRisk
  authority_gate: WakeSchedulerNavigationWriteAuthorityGate
  status: WakeSchedulerNavigationWriteEligibilityStatus
  target_kind: string
  target_id?: string
  blockers: string[]
  warnings: string[]
  prerequisites: WakeSchedulerNavigationWritePrerequisite[]
  safer_read_commands: WakeSchedulerNavigationWriteCommand[]
  future_stage_policy?: WakeSchedulerNavigationFutureStagePolicy
  redacted_summary_preview: string
}

export interface WakeSchedulerNavigationWriteStagePreview {
  command: string
  eligibility: WakeSchedulerNavigationWriteStageEligibility
  existing_staged_id?: string
  blockers: string[]
  warnings: string[]
}

export interface WakeSchedulerNavigationStagedWriteCommand {
  staged_write_id: string
  command: string
  command_name: string
  risk: WakeSchedulerNavigationWriteRisk
  authority_gate: WakeSchedulerNavigationWriteAuthorityGate
  target_kind: string
  target_id?: string
  equivalent_runtime_command?: string
  prerequisites: WakeSchedulerNavigationWritePrerequisite[]
  safer_read_commands: WakeSchedulerNavigationWriteCommand[]
  future_stage_policy?: WakeSchedulerNavigationFutureStagePolicy
  source_preview_hash: string
  source_related_id?: string
  source_incident_id?: string
  source_staged_id?: string
  source_board_id?: string
  staged_at: string
  staged_by: string
  status: "staged"
  stage_hash: string
  summary_preview: string
}

export interface WakeSchedulerNavigationStagedWriteCommandRecord {
  staged_write_id: string
  command: string
  risk: WakeSchedulerNavigationWriteRisk
  authority_gate: WakeSchedulerNavigationWriteAuthorityGate
  target_kind: string
  target_id?: string
  staged_at: string
  staged_by: string
  summary_preview: string
  stage_hash: string
}

export interface WakeSchedulerNavigationWriteStageInput {
  command: string
  allow_medium_risk?: boolean
  allowMediumRisk?: boolean
  source_related_id?: string
  sourceRelatedId?: string
  source_incident_id?: string
  sourceIncidentId?: string
  source_staged_id?: string
  sourceStagedId?: string
  source_board_id?: string
  sourceBoardId?: string
  requested_by?: string
  requestedBy?: string
}

export interface WakeSchedulerNavigationWriteStageRemoveInput {
  staged_write_id: string
  stagedWriteId?: string
  reason?: string
  requested_by?: string
  requestedBy?: string
}

export interface WakeSchedulerNavigationWriteStageClearInput {
  reason?: string
  requested_by?: string
  requestedBy?: string
}
