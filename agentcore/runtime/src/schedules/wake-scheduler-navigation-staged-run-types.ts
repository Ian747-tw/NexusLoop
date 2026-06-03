import type { WakeSchedulerNavigationStageRisk, WakeSchedulerNavigationStageTargetKind } from "./wake-scheduler-navigation-staging-types"

export interface WakeSchedulerNavigationStagedRunPreview {
  staged_id: string
  command: string
  can_execute: boolean
  command_type: "read" | "write"
  risk: WakeSchedulerNavigationStageRisk
  target_kind: WakeSchedulerNavigationStageTargetKind
  target_id?: string
  blockers: string[]
  warnings: string[]
  redacted_summary_preview: string
}

export interface WakeSchedulerNavigationStagedRunResult {
  run_id: string
  staged_id: string
  command: string
  target_kind: WakeSchedulerNavigationStageTargetKind
  target_id?: string
  status: "succeeded" | "failed" | "blocked"
  result_summary?: string
  result_kind?: string
  error?: string
  started_at: string
  completed_at: string
  requested_by: string
  result_hash?: string
}

export interface WakeSchedulerNavigationStagedRunRecord {
  run_id: string
  staged_id: string
  command: string
  target_kind: WakeSchedulerNavigationStageTargetKind
  status: "succeeded" | "failed" | "blocked"
  completed_at: string
  summary_preview: string
}

export interface WakeSchedulerNavigationStagedRunInput {
  staged_id: string
  stagedId?: string
  requested_by?: string
  requestedBy?: string
}

export interface WakeSchedulerNavigationStagedRunListInput {
  limit?: number
  staged_id?: string
  stagedId?: string
}
