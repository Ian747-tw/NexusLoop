import type { CommanderInvestigationJournalProjectionStatus, CommanderInvestigationRecoveryState } from "./commander-investigation-journal-types"
import type { CommanderInvestigationRecoveryApprovalState, CommanderInvestigationRecoveryApprovalSummary } from "./commander-investigation-recovery-approval-types"
import type { CommanderInvestigationRecoveryAttemptSummary, CommanderInvestigationRecoveryTransactionInput, CommanderInvestigationRecoveryTransactionResult } from "./commander-investigation-recovery-transaction-types"
import type { CommanderInvestigationRecoveryKind, CommanderInvestigationRecoveryPreview } from "./commander-investigation-recovery-types"

export type CommanderRecoveryOperatorListInput = {
  limit?: number
  status?: string
  recovery_state?: CommanderInvestigationRecoveryState
  approval_state?: CommanderInvestigationRecoveryApprovalState
}

export type CommanderRecoveryOperatorSummary = {
  investigation_id: string
  projection_status: CommanderInvestigationJournalProjectionStatus
  record_status: string
  recovery_state: CommanderInvestigationRecoveryState
  recovery_kind: CommanderInvestigationRecoveryKind
  objective_preview: string
  phase: string
  updated_at: string
  record_hash: string
  checkpoint_id?: string
  pending_model_request_id?: string
  terminal: boolean
  approval_state: CommanderInvestigationRecoveryApprovalState
  recovery_approval_count: number
  recovery_attempt_count: number
  recovery_execution_in_progress: boolean
  human_review_required: boolean
  current_compatibility_checked: false
}

export type CommanderRecoveryOperatorList = {
  items: CommanderRecoveryOperatorSummary[]
  count: number
  limit: number
  current_compatibility_checked: false
  observed_at: string
}

export type CommanderRecoveryOperatorShowInput = { investigation_id: string }

export type CommanderRecoveryOperatorMissing = {
  found: false
  investigation_id: string
  projection_status: "missing"
  recommended_next_operator_action: "none"
  blockers: string[]
  warnings: string[]
  observed_at: string
}

export type CommanderRecoveryOperatorDetail = CommanderRecoveryOperatorSummary & {
  found: true
  requested_by: string
  mission_id?: string
  session_id?: string
  launch_id?: string
  provider_id: string
  provider_kind: string
  model_id: string
  tool_protocol: string
  checkpoint_ref?: { checkpoint_id: string; checkpoint_sequence: number; checkpoint_hash: string }
  pending_model_step_ref?: { model_request_id: string; turn_index: number }
  latest_approval?: CommanderInvestigationRecoveryApprovalSummary
  latest_recovery_attempt?: CommanderInvestigationRecoveryAttemptSummary
  blockers: string[]
  warnings: string[]
  recommended_next_operator_action: string
  active_operation?: CommanderRecoveryOperation
  observed_at: string
}

export type CommanderRecoveryOperatorPreview = CommanderInvestigationRecoveryPreview & {
  current_continuity_required: true
}

export type CommanderRecoveryOperationStatus = "running" | "completed" | "already_started" | "blocked" | "failed"

export type CommanderRecoveryOperation = {
  operation_id: string
  operation_version: 1
  investigation_id: string
  approval_id: string
  approval_hash: string
  recovery_plan_hash: string
  execution_preparation_hash: string
  status: CommanderRecoveryOperationStatus
  cancellation_requested: boolean
  recovery_attempt_id?: string
  result?: CommanderInvestigationRecoveryTransactionResult
  error?: string
  started_at: string
  settled_at?: string
}

export type CommanderRecoveryExecuteInput = CommanderInvestigationRecoveryTransactionInput

export type CommanderRecoveryCancelInput = {
  investigation_id: string
  operation_id: string
  approval_id: string
  recovery_attempt_id?: string
}

export type CommanderRecoveryCancellationStatus =
  | "cancellation_requested"
  | "already_requested"
  | "not_active"
  | "operation_identity_mismatch"

export type CommanderRecoveryCancellationResult = {
  status: CommanderRecoveryCancellationStatus
  investigation_id: string
  operation_id: string
  approval_id: string
  recovery_attempt_id?: string
  cancellation_requested: boolean
  provider_outcome_known: false
  durable_state_changed: false
  generated_at: string
}
