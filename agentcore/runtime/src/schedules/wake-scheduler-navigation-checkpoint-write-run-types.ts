import type {
  WakeSchedulerNavigationWriteAuthorityGate,
  WakeSchedulerNavigationWriteRisk,
} from "./wake-scheduler-navigation-write-preview-types"

export interface WakeSchedulerNavigationCheckpointWriteRunPreview {
  staged_write_id: string
  approval_id?: string
  command: string
  command_name: string
  can_execute: boolean
  risk: WakeSchedulerNavigationWriteRisk
  authority_gate: WakeSchedulerNavigationWriteAuthorityGate
  target_kind: string
  target_id?: string
  execution_kind: "checkpoint_create" | "blocked"
  checkpoint_scope?: string
  checkpoint_reason_preview?: string
  blockers: string[]
  warnings: string[]
  redacted_summary_preview: string
}

export interface WakeSchedulerNavigationCheckpointWriteRunResult {
  run_id: string
  staged_write_id: string
  approval_id?: string
  command: string
  command_name: string
  execution_kind: "checkpoint_create" | "blocked"
  risk: WakeSchedulerNavigationWriteRisk
  authority_gate: WakeSchedulerNavigationWriteAuthorityGate
  status: "succeeded" | "failed" | "blocked"
  checkpoint_id?: string
  checkpoint_hash?: string
  event_count?: number
  result_kind?: string
  result_summary?: string
  error?: string
  started_at: string
  completed_at: string
  requested_by: string
  result_hash: string
}

export interface WakeSchedulerNavigationCheckpointWriteRunRecord {
  run_id: string
  staged_write_id: string
  approval_id?: string
  command: string
  status: "succeeded" | "failed" | "blocked"
  checkpoint_id?: string
  completed_at: string
  summary_preview: string
}

export interface WakeSchedulerNavigationCheckpointWriteRunInput {
  staged_write_id: string
  stagedWriteId?: string
  requested_by?: string
  requestedBy?: string
  dry_run?: boolean
  dryRun?: boolean
}

export interface WakeSchedulerNavigationCheckpointWriteRunListInput {
  limit?: number
  staged_write_id?: string
  stagedWriteId?: string
}
