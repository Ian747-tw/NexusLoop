import type { WakeSchedulerNavigationStageTargetKind } from "./wake-scheduler-navigation-staging-types"

export type WakeSchedulerNavigationStagedReadComparisonStatus = "unchanged" | "changed" | "first_run" | "failed" | "blocked" | "unknown"

export interface WakeSchedulerNavigationStagedReadComparisonHash {
  comparison_hash: string
  hash_basis: {
    command: string
    target_kind: WakeSchedulerNavigationStageTargetKind
    target_id?: string
    status: "succeeded" | "failed" | "blocked"
    result_kind?: string
    result_summary?: string
    error?: string
  }
}

export interface WakeSchedulerNavigationStagedReadCompareCommand {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export interface WakeSchedulerNavigationStagedReadGroup {
  group_id: string
  staged_id: string
  command: string
  target_kind: WakeSchedulerNavigationStageTargetKind
  target_id?: string
  run_count: number
  succeeded_count: number
  failed_count: number
  blocked_count: number
  latest_run_id?: string
  latest_completed_at?: string
  latest_status?: "succeeded" | "failed" | "blocked"
  latest_comparison_hash?: string
  previous_run_id?: string
  previous_comparison_hash?: string
  comparison_status: WakeSchedulerNavigationStagedReadComparisonStatus
  summary_preview: string
  recommended_commands: WakeSchedulerNavigationStagedReadCompareCommand[]
}

export interface WakeSchedulerNavigationStagedReadPairComparison {
  comparison_id: string
  staged_id: string
  command: string
  left_run_id: string
  right_run_id: string
  left_completed_at?: string
  right_completed_at?: string
  left_status: "succeeded" | "failed" | "blocked"
  right_status: "succeeded" | "failed" | "blocked"
  left_comparison_hash: string
  right_comparison_hash: string
  comparison_status: WakeSchedulerNavigationStagedReadComparisonStatus
  summary_delta: string
  warnings: string[]
  recommended_commands: WakeSchedulerNavigationStagedReadCompareCommand[]
}

export interface WakeSchedulerNavigationStagedReadHistory {
  staged_id?: string
  command?: string
  groups: WakeSchedulerNavigationStagedReadGroup[]
  total_runs: number
  total_groups: number
  changed_groups: number
  failed_groups: number
  stale_groups: number
  generated_at: string
}

export interface WakeSchedulerNavigationStagedReadStaleItem {
  staged_id: string
  command: string
  target_kind: WakeSchedulerNavigationStageTargetKind
  target_id?: string
  latest_run_id?: string
  latest_completed_at?: string
  age_ms?: number
  stale_after_ms: number
  stale: boolean
  recommended_commands: WakeSchedulerNavigationStagedReadCompareCommand[]
}

export interface WakeSchedulerNavigationStagedReadHistoryInput {
  staged_id?: string
  stagedId?: string
  command?: string
  limit?: number
  stale_after_ms?: number
  staleAfterMs?: number
}

export interface WakeSchedulerNavigationStagedReadCompareInput {
  staged_id?: string
  stagedId?: string
  left_run_id?: string
  leftRunId?: string
  right_run_id?: string
  rightRunId?: string
  latest?: boolean
}

export interface WakeSchedulerNavigationStagedReadStaleInput {
  stale_after_ms?: number
  staleAfterMs?: number
  limit?: number
}

export interface WakeSchedulerNavigationStagedReadGroupInput {
  staged_id?: string
  stagedId?: string
  command?: string
  limit?: number
}
