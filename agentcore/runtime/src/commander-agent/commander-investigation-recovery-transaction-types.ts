import type { CommanderInvestigationResult } from "./commander-investigation-types"
import type { CommanderInvestigationPersistenceObserver } from "./commander-investigation-types"
import type { CommanderInvestigationRecoveryContinuationSeed } from "./commander-investigation-recovery-execution-types"
import type {
  CommanderInvestigationRecoveryApprovalDecision,
  CommanderInvestigationRecoveryCheckpointApprovalRef,
  CommanderInvestigationRecoveryPendingApprovalRef,
} from "./commander-investigation-recovery-approval-types"
import type { CommanderInvestigationRecoveryKind } from "./commander-investigation-recovery-types"

export type CommanderInvestigationRecoveryPendingBoundaryDisposition =
  | "not_applicable"
  | "continue_from_checkpoint_with_fresh_request"

export type CommanderInvestigationRecoveryAttemptRef = {
  recovery_attempt_id: string
  recovery_attempt_sequence: number
  recovery_kind: Exclude<CommanderInvestigationRecoveryKind, "none">
  approval_id: string
  approval_hash: string
  approval_sequence: number
  recovery_basis_hash: string
  recovery_plan_hash: string
  recovery_packet_hash: string
  execution_preparation_hash: string
  first_model_request_preview_hash: string
  checkpoint_ref: CommanderInvestigationRecoveryCheckpointApprovalRef
  pending_model_step_ref?: CommanderInvestigationRecoveryPendingApprovalRef
  provider_execution_envelope_hash: string
  started_at: string
  attempt_hash: string
}

export type CommanderInvestigationResolvedPendingBoundary = {
  model_request_id: string
  turn_index: number
  base_checkpoint_ref: CommanderInvestigationRecoveryCheckpointApprovalRef
  working_set_hash: string
  context_hash: string
  disposition: "continue_from_checkpoint_with_fresh_request"
  resolved_by_recovery_attempt_id: string
  outcome_remains_unknown: true
  request_replayed: false
  tool_execution_replayed: false
}

export type CommanderInvestigationRecoveryAttempt = CommanderInvestigationRecoveryAttemptRef & {
  attempt_version: 1
  investigation_id: string
  execution_transport: "injected_scripted_adapter"
  approval_decision: CommanderInvestigationRecoveryApprovalDecision
  approved_by: string
  approval_consumed: true
  one_shot: true
  automatic: false
  pending_boundary_disposition: CommanderInvestigationRecoveryPendingBoundaryDisposition
  tool_compatibility_hash: string
  provider_compatibility_hash: string
  budget_compatibility_hash: string
  context_compatibility_hash: string
  continuity_compatibility_hash: string
  human_control_compatibility_hash: string
  fresh_context_required: true
  exact_replay_supported: false
  provider_request_replay_allowed: false
  tool_execution_replay_allowed: false
  previous_provider_outcome_inferred: false
}

export type CommanderInvestigationRecoveryStartedPayload = {
  schema_version: 1
  investigation_id: string
  journal_sequence: number
  requested_by: string
  occurred_at: string
  recovery_attempt: CommanderInvestigationRecoveryAttempt
  event_payload_hash: string
}

export type CommanderInvestigationRecoveryStartAppendInput = {
  recovery_attempt: CommanderInvestigationRecoveryAttempt
}

export type CommanderInvestigationRecoveryAttemptSummary = CommanderInvestigationRecoveryAttemptRef & {
  approval_decision: CommanderInvestigationRecoveryApprovalDecision
  pending_boundary_disposition: CommanderInvestigationRecoveryPendingBoundaryDisposition
  approval_consumed: true
}

export type CommanderInvestigationRecoveryTransactionInput = {
  investigation_id: string
  approval_id: string
  approval_hash: string
  recovery_plan_hash: string
  execution_preparation_hash: string
}

export type CommanderInvestigationRecoveryTransactionStatus =
  | "completed"
  | "already_started"
  | "blocked"
  | "failed"

export type CommanderInvestigationRecoveryTransactionResult = {
  result_id: string
  status: CommanderInvestigationRecoveryTransactionStatus
  investigation_id: string
  recovery_attempt_id?: string
  recovery_attempt_sequence?: number
  approval_id?: string
  approval_consumed: boolean
  approval_consumed_at?: string
  recovery_basis_hash?: string
  recovery_plan_hash?: string
  execution_preparation_hash?: string
  first_model_request_preview_hash?: string
  checkpoint_ref?: CommanderInvestigationRecoveryCheckpointApprovalRef
  pending_model_step_ref?: CommanderInvestigationRecoveryPendingApprovalRef
  pending_boundary_disposition?: CommanderInvestigationRecoveryPendingBoundaryDisposition
  controller_result?: CommanderInvestigationResult
  recovery_start_event_id?: string
  terminal_event_id?: string
  investigation_event_count: number
  model_step_event_count: number
  checkpoint_event_count: number
  terminal_event_count: number
  events_appended: boolean
  external_api_audit_events_appended: 0
  provider_called: false
  scripted_model_turn_count: number
  network_called: false
  files_written: false
  research_db_written: false
  mission_mutated: false
  proposal_mutated: false
  opencode_action_performed: false
  github_action_performed: false
  mcp_called: false
  blockers: string[]
  warnings: string[]
  generated_at: string
  result_hash: string
}

export type CommanderInvestigationRecoveryContinuationRunner = {
  run(input: {
    seed: CommanderInvestigationRecoveryContinuationSeed
    persistence_observer: CommanderInvestigationPersistenceObserver
    abort_signal?: AbortSignal
  }): Promise<CommanderInvestigationResult>
}
