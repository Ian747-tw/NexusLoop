import type {
  WakeSchedulerNavigationWriteAuthorityGate,
  WakeSchedulerNavigationWriteRisk,
} from "./wake-scheduler-navigation-write-preview-types"
import type { WakeSchedulerNavigationWriteExecutionKind, WakeSchedulerNavigationWriteRunStatus } from "./wake-scheduler-navigation-write-run-types"

export type WakeSchedulerNavigationWriteRunComparisonStatus = "unchanged" | "changed" | "first_run" | "failed" | "blocked" | "unknown"

export interface WakeSchedulerNavigationWriteRunOutcomeHash {
  outcome_hash: string
  hash_basis: {
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
    error?: string
  }
}

export interface WakeSchedulerNavigationWriteRunCompareCommand {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export interface WakeSchedulerNavigationWriteRunGroup {
  group_id: string
  staged_write_id: string
  command: string
  command_name: string
  execution_kind: WakeSchedulerNavigationWriteExecutionKind
  risk: WakeSchedulerNavigationWriteRisk
  authority_gate: WakeSchedulerNavigationWriteAuthorityGate
  target_kind: string
  target_id?: string
  run_count: number
  succeeded_count: number
  failed_count: number
  blocked_count: number
  latest_run_id?: string
  latest_completed_at?: string
  latest_status?: WakeSchedulerNavigationWriteRunStatus
  latest_outcome_hash?: string
  previous_run_id?: string
  previous_outcome_hash?: string
  downstream_run_ids: string[]
  comparison_status: WakeSchedulerNavigationWriteRunComparisonStatus
  summary_preview: string
  recommended_commands: WakeSchedulerNavigationWriteRunCompareCommand[]
}

export interface WakeSchedulerNavigationWriteRunPairComparison {
  comparison_id: string
  staged_write_id: string
  command: string
  left_run_id: string
  right_run_id: string
  left_completed_at?: string
  right_completed_at?: string
  left_status: WakeSchedulerNavigationWriteRunStatus
  right_status: WakeSchedulerNavigationWriteRunStatus
  left_outcome_hash: string
  right_outcome_hash: string
  comparison_status: WakeSchedulerNavigationWriteRunComparisonStatus
  summary_delta: string
  downstream_delta?: string
  warnings: string[]
  recommended_commands: WakeSchedulerNavigationWriteRunCompareCommand[]
}

export interface WakeSchedulerNavigationWriteRunHistory {
  staged_write_id?: string
  command?: string
  groups: WakeSchedulerNavigationWriteRunGroup[]
  total_runs: number
  total_groups: number
  changed_groups: number
  failed_groups: number
  stale_groups: number
  generated_at: string
}

export interface WakeSchedulerNavigationWriteRunStaleItem {
  staged_write_id: string
  command: string
  command_name: string
  risk: WakeSchedulerNavigationWriteRisk
  authority_gate: WakeSchedulerNavigationWriteAuthorityGate
  target_kind: string
  target_id?: string
  latest_run_id?: string
  latest_completed_at?: string
  age_ms?: number
  stale_after_ms: number
  stale: boolean
  recommended_commands: WakeSchedulerNavigationWriteRunCompareCommand[]
}

export interface WakeSchedulerNavigationWriteRunHistoryInput {
  staged_write_id?: string
  stagedWriteId?: string
  command?: string
  limit?: number
  stale_after_ms?: number
  staleAfterMs?: number
}

export interface WakeSchedulerNavigationWriteRunCompareInput {
  staged_write_id?: string
  stagedWriteId?: string
  left_run_id?: string
  leftRunId?: string
  right_run_id?: string
  rightRunId?: string
  latest?: boolean
}

export interface WakeSchedulerNavigationWriteRunStaleInput {
  stale_after_ms?: number
  staleAfterMs?: number
  limit?: number
}

export interface WakeSchedulerNavigationWriteRunGroupInput {
  staged_write_id?: string
  stagedWriteId?: string
  command?: string
  limit?: number
}
