import type {
  WakeSchedulerNavigationWriteAuthorityGate,
  WakeSchedulerNavigationWriteRisk,
} from "./wake-scheduler-navigation-write-preview-types"

export type WakeSchedulerNavigationWriteExecutionKind = "wake_tick_dry_run" | "staged_safe_read" | "blocked"
export type WakeSchedulerNavigationWriteRunStatus = "succeeded" | "failed" | "blocked"

export interface WakeSchedulerNavigationWriteRunPreview {
  staged_write_id: string
  command: string
  command_name: string
  can_execute: boolean
  risk: WakeSchedulerNavigationWriteRisk
  authority_gate: WakeSchedulerNavigationWriteAuthorityGate
  target_kind: string
  target_id?: string
  execution_kind: WakeSchedulerNavigationWriteExecutionKind
  blockers: string[]
  warnings: string[]
  redacted_summary_preview: string
}

export interface WakeSchedulerNavigationWriteRunResult {
  run_id: string
  staged_write_id: string
  command: string
  command_name: string
  execution_kind: WakeSchedulerNavigationWriteExecutionKind
  risk: WakeSchedulerNavigationWriteRisk
  authority_gate: WakeSchedulerNavigationWriteAuthorityGate
  target_kind: string
  target_id?: string
  status: WakeSchedulerNavigationWriteRunStatus
  result_kind?: string
  result_summary?: string
  downstream_run_id?: string
  error?: string
  started_at: string
  completed_at: string
  requested_by: string
  result_hash: string
}

export interface WakeSchedulerNavigationWriteRunRecord {
  run_id: string
  staged_write_id: string
  command: string
  execution_kind: WakeSchedulerNavigationWriteExecutionKind
  status: WakeSchedulerNavigationWriteRunStatus
  completed_at: string
  summary_preview: string
}

export interface WakeSchedulerNavigationLowRiskWriteExecution {
  execution_kind: Exclude<WakeSchedulerNavigationWriteExecutionKind, "blocked">
  result_kind: string
  result_summary: string
  downstream_run_id?: string
  warnings?: string[]
}

export interface WakeSchedulerNavigationWriteRunInput {
  staged_write_id?: string
  stagedWriteId?: string
  requested_by?: string
  requestedBy?: string
  dry_run?: boolean
  dryRun?: boolean
}

export interface WakeSchedulerNavigationWriteRunListInput {
  limit?: number
  staged_write_id?: string
  stagedWriteId?: string
}
