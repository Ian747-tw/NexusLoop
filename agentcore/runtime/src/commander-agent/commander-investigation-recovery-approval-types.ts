import type { CommanderInvestigationRecoveryBasis } from "./commander-investigation-recovery-basis"
import type {
  CommanderInvestigationRecoveryKind,
  CommanderInvestigationRecoveryPreview,
} from "./commander-investigation-recovery-types"

export type CommanderInvestigationRecoveryApprovalDecision =
  | "approve_resume_from_checkpoint"
  | "approve_continue_after_uncertain_provider_outcome"

export type CommanderInvestigationRecoveryApprovalAcknowledgements = {
  fresh_context_required: true
  exact_replay_unavailable: true
  provider_request_replay_forbidden: true
  tool_execution_replay_forbidden: true
  uncertain_provider_outcome?: true
}

export type CommanderInvestigationRecoveryApprovalInput = {
  investigation_id: string
  recovery_plan_hash: string
  decision: CommanderInvestigationRecoveryApprovalDecision
  approved_by: string
  human_note?: string
  acknowledgements: CommanderInvestigationRecoveryApprovalAcknowledgements
}

export type CommanderInvestigationRecoveryCheckpointApprovalRef = {
  checkpoint_id: string
  checkpoint_sequence: number
  checkpoint_hash: string
}

export type CommanderInvestigationRecoveryPendingApprovalRef = {
  model_request_id: string
  turn_index: number
  base_checkpoint_id: string
  base_checkpoint_sequence: number
  base_checkpoint_hash: string
  working_set_hash: string
  context_hash: string
  provider_request_may_have_been_sent: true
  provider_response_available: false
  provider_outcome_remains_unknown: true
  tool_execution_known_to_have_occurred: false
  provider_request_replay_forbidden: true
  tool_execution_replay_forbidden: true
  fresh_request_required_later: true
}

export type CommanderInvestigationRecoveryApprovalSummary = {
  approval_id: string
  approval_sequence: number
  decision: CommanderInvestigationRecoveryApprovalDecision
  approved_by: string
  approved_at: string
  human_note_hash?: string
  recovery_basis_hash: string
  recovery_plan_hash: string
  recovery_packet_hash: string
  checkpoint_ref: CommanderInvestigationRecoveryCheckpointApprovalRef
  pending_model_step_ref?: CommanderInvestigationRecoveryPendingApprovalRef
  pending_model_request_id?: string
  provider_execution_envelope_hash: string
  tool_compatibility_hash: string
  provider_compatibility_hash: string
  budget_compatibility_hash: string
  context_compatibility_hash: string
  continuity_compatibility_hash: string
  human_control_compatibility_hash: string
  approval_hash: string
}

export type CommanderInvestigationRecoveryApprovalState = "none" | "current" | "stale"

export type CommanderInvestigationRecoveryApprovalRecord = {
  schema_version: 1
  approval_version: 1
  approval_id: string
  approval_sequence: number
  investigation_id: string
  recovery_kind: CommanderInvestigationRecoveryKind
  decision: CommanderInvestigationRecoveryApprovalDecision
  approved_by: string
  approval_source: "human"
  human_note_preview?: string
  human_note_hash?: string
  acknowledgements: CommanderInvestigationRecoveryApprovalAcknowledgements
  recovery_basis_hash: string
  recovery_plan_hash: string
  recovery_packet_hash: string
  preview_hash: string
  checkpoint_ref: CommanderInvestigationRecoveryCheckpointApprovalRef
  pending_model_step_ref?: CommanderInvestigationRecoveryPendingApprovalRef
  provider_execution_envelope_hash: string
  tool_compatibility_hash: string
  provider_compatibility_hash: string
  budget_compatibility_hash: string
  context_compatibility_hash: string
  continuity_compatibility_hash: string
  human_control_compatibility_hash: string
  one_shot: true
  automatic: false
  fresh_context_required: true
  exact_replay_supported: false
  provider_request_replay_allowed: false
  tool_execution_replay_allowed: false
  execution_supported_in_this_branch: false
  approved_at: string
  approval_hash: string
}

export type CommanderInvestigationRecoveryApprovedPayload = {
  schema_version: 1
  investigation_id: string
  journal_sequence: number
  requested_by: string
  occurred_at: string
  approval: CommanderInvestigationRecoveryApprovalRecord
  event_payload_hash: string
}

export type CommanderInvestigationRecoveryApprovalPreviewStatus =
  | "ready"
  | "blocked"
  | "already_recorded"

export type CommanderInvestigationRecoveryApprovalPreview = {
  preview_id: string
  preview_version: 1
  status: CommanderInvestigationRecoveryApprovalPreviewStatus
  investigation_id: string
  decision?: CommanderInvestigationRecoveryApprovalDecision
  approved_by_preview?: string
  human_note_preview?: string
  supplied_recovery_plan_hash?: string
  current_recovery_plan_hash?: string
  recovery_plan_hash_match: boolean
  recovery_basis_hash?: string
  recovery_kind?: CommanderInvestigationRecoveryKind
  checkpoint_ref?: CommanderInvestigationRecoveryCheckpointApprovalRef
  pending_model_step_ref?: CommanderInvestigationRecoveryPendingApprovalRef
  provider_execution_envelope_hash?: string
  recovery_packet_hash?: string
  tool_compatibility_hash?: string
  provider_compatibility_hash?: string
  budget_compatibility_hash?: string
  context_compatibility_hash?: string
  continuity_compatibility_hash?: string
  human_control_compatibility_hash?: string
  acknowledgement_complete: boolean
  existing_current_approval?: CommanderInvestigationRecoveryApprovalSummary
  would_append_event: boolean
  blockers: string[]
  warnings: string[]
  generated_at: string
  provider_called: false
  tool_executed: false
  network_called: false
  events_appended: false
  files_written: false
  research_db_written: false
  mission_mutated: false
  proposal_mutated: false
  opencode_action_performed: false
  github_action_performed: false
  mcp_called: false
  preview_hash: string
}

export type CommanderInvestigationRecoveryApprovalResultStatus =
  | "recorded"
  | "already_recorded"
  | "blocked"
  | "failed"

export type CommanderInvestigationRecoveryApprovalResult = {
  result_id: string
  status: CommanderInvestigationRecoveryApprovalResultStatus
  investigation_id: string
  decision?: CommanderInvestigationRecoveryApprovalDecision
  approval?: CommanderInvestigationRecoveryApprovalRecord
  approval_state: CommanderInvestigationRecoveryApprovalState
  recovery_basis_hash?: string
  recovery_plan_hash?: string
  checkpoint_ref?: CommanderInvestigationRecoveryCheckpointApprovalRef
  pending_model_step_ref?: CommanderInvestigationRecoveryPendingApprovalRef
  event_id?: string
  events_appended: boolean
  provider_called: false
  tool_executed: false
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

export type CommanderInvestigationRecoveryApprovalServiceOptions = {
  recoveryPreview(input: { investigation_id: string; include_current_continuity?: boolean }): Promise<CommanderInvestigationRecoveryPreview>
  recoverySource(investigationId: string): Promise<import("./commander-investigation-recovery-source").CommanderInvestigationRecoverySource | undefined>
  journalService: import("./commander-investigation-journal-service").CommanderInvestigationJournalService
  now?: () => Date
}

export type CommanderInvestigationRecoveryApprovalAppendInput = {
  expected_basis: CommanderInvestigationRecoveryBasis
  approval: CommanderInvestigationRecoveryApprovalRecord
}
