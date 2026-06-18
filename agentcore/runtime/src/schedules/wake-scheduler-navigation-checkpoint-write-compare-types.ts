export type WakeSchedulerNavigationCheckpointWriteComparisonStatus = "unchanged" | "changed" | "first_run" | "failed" | "blocked" | "unknown"

export interface WakeSchedulerNavigationCheckpointWriteOutcomeHash {
  outcome_hash: string
  hash_basis: {
    command: string
    command_name: string
    execution_kind: "checkpoint_create" | "blocked"
    risk: string
    authority_gate: string
    status: "succeeded" | "failed" | "blocked"
    result_kind?: string
    result_summary?: string
    error?: string
    checkpoint_scope?: string
  }
}

export interface WakeSchedulerNavigationCheckpointArtifactHash {
  artifact_hash?: string
  checkpoint_id?: string
  checkpoint_hash?: string
  event_count?: number
  note: string
}

export interface WakeSchedulerNavigationCheckpointWriteCompareCommand {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export interface WakeSchedulerNavigationCheckpointWriteGroup {
  group_id: string
  staged_write_id: string
  command: string
  command_name: string
  approval_ids: string[]
  run_count: number
  succeeded_count: number
  failed_count: number
  blocked_count: number
  latest_run_id?: string
  latest_approval_id?: string
  latest_checkpoint_id?: string
  latest_checkpoint_hash?: string
  latest_event_count?: number
  latest_completed_at?: string
  latest_status?: "succeeded" | "failed" | "blocked"
  latest_outcome_hash?: string
  previous_run_id?: string
  previous_outcome_hash?: string
  comparison_status: WakeSchedulerNavigationCheckpointWriteComparisonStatus
  checkpoint_artifact_changed?: boolean
  summary_preview: string
  recommended_commands: WakeSchedulerNavigationCheckpointWriteCompareCommand[]
}

export interface WakeSchedulerNavigationCheckpointWritePairComparison {
  comparison_id: string
  staged_write_id: string
  command: string
  left_run_id: string
  right_run_id: string
  left_approval_id?: string
  right_approval_id?: string
  left_checkpoint_id?: string
  right_checkpoint_id?: string
  left_checkpoint_hash?: string
  right_checkpoint_hash?: string
  left_event_count?: number
  right_event_count?: number
  left_completed_at?: string
  right_completed_at?: string
  left_status: "succeeded" | "failed" | "blocked"
  right_status: "succeeded" | "failed" | "blocked"
  left_outcome_hash: string
  right_outcome_hash: string
  comparison_status: WakeSchedulerNavigationCheckpointWriteComparisonStatus
  checkpoint_artifact_delta?: string
  approval_delta?: string
  summary_delta: string
  warnings: string[]
  recommended_commands: WakeSchedulerNavigationCheckpointWriteCompareCommand[]
}

export interface WakeSchedulerNavigationCheckpointWriteHistory {
  staged_write_id?: string
  approval_id?: string
  command?: string
  groups: WakeSchedulerNavigationCheckpointWriteGroup[]
  total_runs: number
  total_groups: number
  changed_groups: number
  failed_groups: number
  artifact_changed_groups: number
  unused_approval_count: number
  stale_approval_count: number
  generated_at: string
}

export interface WakeSchedulerNavigationCheckpointApprovalUsage {
  approval_id: string
  staged_write_id: string
  command: string
  approval_status: "pending" | "approved" | "rejected" | "revoked" | "expired"
  approved_at?: string
  expires_at?: string
  revoked_at?: string
  used: boolean
  run_ids: string[]
  latest_run_id?: string
  latest_run_status?: "succeeded" | "failed" | "blocked"
  latest_run_at?: string
  stale: boolean
  expired_before_use: boolean
  revoked_before_use: boolean
  warnings: string[]
  recommended_commands: WakeSchedulerNavigationCheckpointWriteCompareCommand[]
}

export interface WakeSchedulerNavigationCheckpointApprovalUsageSummary {
  approvals: WakeSchedulerNavigationCheckpointApprovalUsage[]
  total_approvals: number
  used_count: number
  unused_count: number
  stale_count: number
  expired_unused_count: number
  revoked_unused_count: number
  generated_at: string
}

export interface WakeSchedulerNavigationCheckpointWriteStaleItem {
  staged_write_id: string
  approval_id?: string
  command: string
  latest_run_id?: string
  latest_completed_at?: string
  checkpoint_id?: string
  age_ms?: number
  stale_after_ms: number
  stale: boolean
  reason: string
  recommended_commands: WakeSchedulerNavigationCheckpointWriteCompareCommand[]
}

export interface WakeSchedulerNavigationCheckpointWriteHistoryInput {
  staged_write_id?: string
  stagedWriteId?: string
  approval_id?: string
  approvalId?: string
  command?: string
  limit?: number
  stale_after_ms?: number
  staleAfterMs?: number
}

export interface WakeSchedulerNavigationCheckpointWriteCompareInput {
  staged_write_id?: string
  stagedWriteId?: string
  left_run_id?: string
  leftRunId?: string
  right_run_id?: string
  rightRunId?: string
  latest?: boolean
}

export interface WakeSchedulerNavigationCheckpointWriteStaleInput {
  stale_after_ms?: number
  staleAfterMs?: number
  limit?: number
}

export interface WakeSchedulerNavigationCheckpointWriteGroupInput {
  staged_write_id?: string
  stagedWriteId?: string
  command?: string
  limit?: number
}

export interface WakeSchedulerNavigationCheckpointApprovalUsageInput {
  approval_id?: string
  approvalId?: string
  staged_write_id?: string
  stagedWriteId?: string
  limit?: number
  stale_after_ms?: number
  staleAfterMs?: number
}
