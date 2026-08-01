import type { CommanderToolDescriptor } from "../commander-tools/commander-tool-types"
import type {
  CommanderInvestigationBootstrap,
  CommanderInvestigationBudget,
  CommanderInvestigationInput,
  CommanderInvestigationTurnSummary,
  CommanderInvestigationWorkingSet,
} from "./commander-investigation-types"
import type {
  CommanderInvestigationCheckpoint,
  CommanderInvestigationJournalIdentity,
  CommanderInvestigationLoadedToolRef,
  CommanderInvestigationReplayExchange,
} from "./commander-investigation-journal-types"
import type {
  CommanderInvestigationRecoveryApprovalSummary,
  CommanderInvestigationRecoveryCheckpointApprovalRef,
  CommanderInvestigationRecoveryPendingApprovalRef,
} from "./commander-investigation-recovery-approval-types"
import type {
  CommanderInvestigationRecoveryKind,
  CommanderInvestigationRecoveryPreview,
} from "./commander-investigation-recovery-types"
import type { CommanderModelAssistantMessage, CommanderModelToolProtocol, CommanderModelToolResultMessage } from "./commander-model-types"

export type CommanderInvestigationRecoveryExecutionPreparationInput = {
  investigation_id: string
  approval_id: string
  approval_hash: string
  recovery_plan_hash: string
}

export type CommanderInvestigationRecoveryExecutionPreparationStatus = "not_found" | "blocked" | "ready"

export type CommanderInvestigationRecoveryContinuationBudget = {
  original_budget_id: string
  original_budget_hash: string
  effective_budget: CommanderInvestigationBudget
  effective_budget_hash: string
  consumed: {
    model_turns: number
    provider_requests: number
    tool_calls: number
    tool_search_calls: number
    cumulative_tool_result_bytes: number
    elapsed_active_ms: number
    evidence_cards: number
    turn_summaries: number
    consecutive_no_progress_turns: number
    loaded_schemas: number
  }
  remaining: {
    model_turns: number
    tool_calls: number
    tool_search_calls: number
    cumulative_tool_result_bytes: number
    wall_time_ms: number
    evidence_cards: number
    turn_summaries: number
    loaded_schemas: number
  }
  uncertain_model_turn_charge: number
  unresolved_provider_attempt_count: number
  stricter_current_policy_dimensions: string[]
  exhausted_dimensions: string[]
  budget_hash: string
}

export type CommanderInvestigationRecoveryNotice = {
  notice_version: 1
  kind: "checkpoint_continuation" | "uncertain_provider_continuation"
  investigation_id: string
  checkpoint_id: string
  checkpoint_sequence: number
  checkpoint_hash: string
  original_bootstrap_hash: string
  current_bootstrap_hash: string
  continuity_drift_detected: boolean
  previous_provider_outcome: "not_pending" | "uncertain"
  previous_model_request_id?: string
  previous_provider_request_may_have_been_sent: boolean
  previous_provider_response_available: false
  previous_tool_execution_known: false
  previous_request_replay_forbidden: true
  previous_tool_execution_replay_forbidden: true
  exact_replay_supported: false
  original_assistant_text_available: false
  durable_tool_results_are_summary_only: true
  counters_preserved: true
  fresh_request_required: true
  next_turn_index: number
  warning: string
  notice_hash: string
}

export type CommanderInvestigationRecoveryFirstModelRequestPreview = {
  request_id: string
  provider_id: string
  provider_kind: string
  model_id: string
  turn_index: number
  tool_protocol: CommanderModelToolProtocol
  tool_choice: "auto"
  max_output_tokens?: number
  input_bytes: number
  estimated_input_tokens: number
  message_count: number
  message_roles: string[]
  loaded_tool_ids: string[]
  loaded_tool_schema_hash: string
  context_hash: string
  recovery_notice_hash: string
  old_pending_request_id?: string
  old_request_replayed: false
  tool_execution_replayed: false
  provider_called: false
  request_preview_hash: string
}

export type CommanderInvestigationRecoveryPreModelGateSnapshot = {
  snapshot_version: 1
  turn_index: number
  human_control_action: "continue"
  human_control_warnings: string[]
  provider_preflight_ready: boolean
  provider_preflight_warnings: string[]
  gate_snapshot_hash: string
}

export type CommanderInvestigationRecoveryReplaySummary = {
  replay_protocol_available: boolean
  tool_call_count: number
  tool_result_count: number
  replay_exchange_hash?: string
  assistant_text_persisted: false
  exact_replay_supported: false
  full_tool_results_persisted: false
}

export type CommanderInvestigationRecoveryContinuationSeed = {
  seed_version: 1
  investigation_id: string
  recovery_kind: Exclude<CommanderInvestigationRecoveryKind, "none">
  immutable_identity: CommanderInvestigationJournalIdentity
  normalized_input: Omit<CommanderInvestigationInput, "abort_signal">
  normalized_input_hash: string
  original_started_at: string
  recovery_basis_hash: string
  pending_model_boundary_hash?: string
  checkpoint_ref: CommanderInvestigationRecoveryCheckpointApprovalRef
  pending_model_step_ref?: CommanderInvestigationRecoveryPendingApprovalRef
  original_bootstrap_ref: { bootstrap_id: string; bootstrap_hash: string }
  current_bootstrap: CommanderInvestigationBootstrap
  current_bootstrap_hash: string
  continuity_drift_detected: boolean
  tool_protocol: CommanderModelToolProtocol
  loaded_tools: CommanderToolDescriptor[]
  loaded_tool_refs: CommanderInvestigationLoadedToolRef[]
  effective_budget: CommanderInvestigationRecoveryContinuationBudget
  effective_budget_hash: string
  consumed: CommanderInvestigationRecoveryContinuationBudget["consumed"]
  working_set: CommanderInvestigationWorkingSet
  working_set_hash: string
  turn_summaries: CommanderInvestigationTurnSummary[]
  latest_assistant?: CommanderModelAssistantMessage
  latest_tool_results: CommanderModelToolResultMessage[]
  replay_summary: CommanderInvestigationRecoveryReplaySummary
  replay_exchange?: CommanderInvestigationReplayExchange
  replay_exchange_hash?: string
  replay_message_hash: string
  recovery_notice: CommanderInvestigationRecoveryNotice
  recovery_notice_hash: string
  pre_model_gate_snapshot: CommanderInvestigationRecoveryPreModelGateSnapshot
  pre_model_gate_snapshot_hash: string
  next_turn_index: number
  elapsed_active_ms_before: number
  provider_request_count_before: number
  external_api_audit_count_before: number
  unresolved_provider_attempt_count: number
  uncertain_model_turn_charge: number
  request_id_prefix: string
  first_model_request_preview: CommanderInvestigationRecoveryFirstModelRequestPreview
  execution_preparation_hash: string
  exact_replay_supported: false
  original_assistant_text_available: false
  provider_request_replay_allowed: false
  tool_execution_replay_allowed: false
  fresh_context_required: true
  full_transcript_available: false
  raw_tool_results_available: false
}

export type CommanderInvestigationRecoveryExecutionPreparationSummary = {
  recovery_kind: Exclude<CommanderInvestigationRecoveryKind, "none">
  next_turn_index: number
  original_started_at: string
  checkpoint_id: string
  checkpoint_sequence: number
  checkpoint_hash: string
  pending_model_request_id?: string
  unresolved_provider_attempt_count: number
  uncertain_model_turn_charge: number
  model_turns_consumed: number
  tool_calls_consumed: number
  tool_search_calls_consumed: number
  cumulative_tool_result_bytes: number
  elapsed_active_ms_before: number
  loaded_tool_ids: string[]
  evidence_count: number
  repeat_signature_count: number
  no_progress_count: number
  replay_protocol_available: boolean
  recovery_notice_hash: string
  first_model_request_preview_hash: string
  execution_preparation_hash: string
  exact_replay_supported: false
  original_assistant_text_available: false
  fresh_context_required: true
}

export type CommanderInvestigationRecoveryExecutionPreparationPreview = {
  preview_id: string
  preview_version: 1
  status: CommanderInvestigationRecoveryExecutionPreparationStatus
  investigation_id: string
  recovery_kind?: CommanderInvestigationRecoveryKind
  recovery_basis_hash?: string
  recovery_plan_hash?: string
  recovery_packet_hash?: string
  approval_id?: string
  approval_hash?: string
  approval_sequence?: number
  approval_decision?: CommanderInvestigationRecoveryApprovalSummary["decision"]
  approval_current: boolean
  approval_consumed: false
  checkpoint_ref?: CommanderInvestigationRecoveryCheckpointApprovalRef
  pending_model_step_ref?: CommanderInvestigationRecoveryPendingApprovalRef
  continuation_summary?: CommanderInvestigationRecoveryExecutionPreparationSummary
  first_model_request?: CommanderInvestigationRecoveryFirstModelRequestPreview
  execution_preparation_hash?: string
  blockers: string[]
  warnings: string[]
  generated_at: string
  execution_supported_in_this_branch: false
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

export type CommanderInvestigationRecoveryContinuationBuilderInput = {
  source: import("./commander-investigation-recovery-source").CommanderInvestigationRecoverySource
  preview: CommanderInvestigationRecoveryPreview
  checkpoint: CommanderInvestigationCheckpoint
}

export type CommanderInvestigationRecoveryContinuationBuilderOptions = {
  descriptors: CommanderToolDescriptor[]
  currentBootstrap(input: Omit<CommanderInvestigationInput, "abort_signal">): Promise<CommanderInvestigationBootstrap>
  contextService: import("./commander-investigation-context-service").CommanderInvestigationContextService
  modelOutputTokens(input: { provider_kind: string; model_id: string }): number | undefined
  currentHumanControl?(input: { phase: import("../commander-tools/commander-tool-types").CommanderToolPhase; session_id?: string; launch_id?: string; turn_index: number }): Promise<import("./commander-investigation-types").CommanderInvestigationControlSnapshot>
  providerPreflight?(input: { phase: import("../commander-tools/commander-tool-types").CommanderToolPhase; provider_id: string; provider_kind: string; model_id: string; turn_index: number }): Promise<import("./commander-investigation-provider-types").CommanderInvestigationProviderPreflightSnapshot | undefined>
}
