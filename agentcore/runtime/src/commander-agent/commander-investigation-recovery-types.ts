import type { CommanderEvidenceCard } from "../commander-tools/commander-read-types"
import type { CommanderToolPhase } from "../commander-tools/commander-tool-types"
import type { CommanderInvestigationProviderReadiness, CommanderInvestigationProviderSource } from "./commander-investigation-provider-types"
import type {
  CommanderInvestigationBudget,
  CommanderInvestigationControlSnapshot,
  CommanderInvestigationStatus,
  CommanderInvestigationStopReason,
} from "./commander-investigation-types"
import type {
  CommanderInvestigationCheckpointKind,
  CommanderInvestigationJournalIdentity,
  CommanderInvestigationJournalProjectionStatus,
  CommanderInvestigationLoadedToolRef,
  CommanderInvestigationRecoveryState,
} from "./commander-investigation-journal-types"
import type { CommanderModelToolProtocol } from "./commander-model-types"
import type {
  CommanderInvestigationRecoveryApprovalState,
  CommanderInvestigationRecoveryApprovalSummary,
} from "./commander-investigation-recovery-approval-types"
import type { CommanderInvestigationRecoveryExecutionPreparationSummary } from "./commander-investigation-recovery-execution-types"

export type CommanderInvestigationRecoveryPreviewInput = {
  investigation_id: string
  include_current_continuity?: boolean
}

export type CommanderInvestigationRecoveryPreviewStatus =
  | "not_found"
  | "not_applicable"
  | "blocked"
  | "human_review_required"
  | "ready_for_approval"
  | "approved_waiting_for_execution"
  | "recovery_in_progress"

export type CommanderInvestigationRecoveryKind = "none" | "checkpoint" | "uncertain_provider_outcome"

export type CommanderInvestigationRecoveryRecommendedAction =
  | "none"
  | "inspect_corrupt_record"
  | "reconfigure_runtime"
  | "review_uncertain_provider_outcome"
  | "approve_resume_from_checkpoint"
  | "await_recovery_execution"
  | "await_recovery_completion"
  | "start_new_investigation"

export type CommanderInvestigationRecoveryCheckpointSummary = {
  checkpoint_id: string
  checkpoint_sequence: number
  checkpoint_hash: string
  semantic_state_hash: string
  checkpoint_kind: CommanderInvestigationCheckpointKind
  turn_index: number
  next_turn_index: number
  created_at: string
  provider_request_count: number
  external_api_audit_count: number
  model_turn_count: number
  tool_call_count: number
  tool_search_call_count: number
  cumulative_tool_result_bytes: number
  consecutive_no_progress_turns: number
  loaded_tool_ids: string[]
  evidence_ids: string[]
  evidence_count: number
  omitted_evidence_count: number
  repeat_signature_count: number
  replay_protocol_available: boolean
  assistant_text_persisted: false
  exact_replay_supported: false
  full_tool_results_persisted: false
}

export type CommanderInvestigationRecoveryPendingModelStep = {
  model_request_id: string
  turn_index: number
  started_at: string
  base_checkpoint_id: string
  base_checkpoint_sequence: number
  base_checkpoint_hash: string
  working_set_hash: string
  context_hash: string
  input_bytes: number
  estimated_input_tokens: number
  provider_request_count_before: number
  external_api_audit_count_before: number
  loaded_tool_ids: string[]
  outcome: "uncertain"
  human_disposition_required: true
  provider_request_may_have_been_sent: true
  provider_response_available: false
  tool_execution_known_to_have_occurred: false
}

export type CommanderInvestigationRecoveryToolCompatibility = {
  tool_id: string
  stored_namespace?: string
  current_namespace?: string
  stored_descriptor_version: string
  current_descriptor_version?: string
  stored_authority_id: string
  current_authority_id?: string
  stored_description_hash?: string
  current_description_hash?: string
  stored_input_schema_hash: string
  current_input_schema_hash?: string
  stored_output_schema_hash: string
  current_output_schema_hash?: string
  stored_load_policy: string
  current_load_policy?: string
  stored_trust_class: string
  current_trust_class?: string
  stored_max_output_bytes?: number
  current_max_output_bytes?: number
  stored_timeout_ms?: number
  current_timeout_ms?: number
  stored_risk?: string
  current_risk?: string
  stored_side_effect_class?: string
  current_side_effect_class?: string
  stored_execution_backend?: string
  current_execution_backend?: string
  stored_process_policy?: string
  current_process_policy?: string
  binding_present: boolean
  implemented_read_surface: boolean
  allowed_in_phase: boolean
  authority_match: boolean
  safe_read_authority: boolean
  schema_match: boolean
  descriptor_match: boolean
  description_match: boolean
  capability_envelope_match: boolean
  compatible: boolean
  blockers: string[]
  warnings: string[]
  compatibility_hash: string
}

export type CommanderInvestigationRecoveryBoundToolAuthorityRef = {
  tool_id: string
  descriptor_present: boolean
  descriptor_version?: string
  authority_id?: string
  runtime_command?: string
  slash_command?: string
  input_schema_hash?: string
  output_schema_hash?: string
  load_policy?: string
  trust_class?: string
  instruction_semantics?: string
  namespace?: string
  allowed_in_phase?: boolean
  availability?: string
  risk?: string
  side_effect_class?: string
  execution_backend?: string
  process_policy?: string
  max_output_bytes?: number
  timeout_ms?: number
  creates_external_process?: boolean
  calls_provider?: boolean
  mutates_events?: boolean
  requires_network?: boolean
  requires_credentials?: boolean
  requires_approval?: boolean
  requires_run_lock?: boolean
  description_hash?: string
  binding_ref_hash: string
}

export type CommanderInvestigationRecoveryToolCompatibilitySummary = {
  tools: CommanderInvestigationRecoveryToolCompatibility[]
  binding_count: number
  current_bound_tool_refs: CommanderInvestigationRecoveryBoundToolAuthorityRef[]
  github_gateway_policy_hash?: string
  stored_subset_of_current_bindings: boolean
  compatible: boolean
  blockers: string[]
  warnings: string[]
  compatibility_hash: string
}

export type CommanderInvestigationRecoveryProviderCompatibility = {
  provider_source: CommanderInvestigationProviderSource
  stored_provider_id?: string
  stored_provider_kind?: string
  stored_model_id?: string
  configured_provider_id?: string
  configured_provider_kind?: string
  configured_model_id?: string
  identity_match: boolean
  phase_enabled: boolean
  configuration_ready: boolean
  execution_ready_now: boolean
  capability_id?: string
  commander_role_supported: boolean
  stored_tool_protocol_supported: boolean
  connector_available: boolean
  credentials_ready: boolean
  supports_streaming: false
  execution_envelope?: CommanderInvestigationRecoveryExecutionEnvelope
  compatible: boolean
  blockers: string[]
  warnings: string[]
  compatibility_hash: string
}

export type CommanderInvestigationRecoveryExecutionEnvelope = {
  envelope_version: 1
  transport_kind: "openai_compatible_connector" | "anthropic_messages_connector" | "google_generative_ai_connector"
  provider_id: string
  provider_kind: string
  connector_id: string
  model_id: string
  timeout_ms: number
  max_request_bytes: number
  max_response_bytes: number
  max_context_bytes: number
  max_context_tokens?: number
  max_output_tokens: number
  supports_tools: boolean | "unknown"
  supports_json_schema: boolean | "unknown"
  supports_long_context: boolean | "unknown"
  supports_local_execution: boolean | "unknown"
  supports_streaming: false
  connector_policy_hash: string
  provider_adapter_version?: string
  request_shape_policy_version?: string
  transient_continuation_policy_version?: string
  github_gateway_policy_hash?: string
  capability_envelope_hash: string
  execution_envelope_hash: string
}

export type CommanderInvestigationRecoveryBudgetCompatibility = {
  stored_budget_id?: string
  stored_budget_hash?: string
  current_profile_id?: string
  current_context_budget_id?: string
  stored_limits: Record<string, number | undefined>
  consumed: Record<string, number>
  stored_remaining: Record<string, number>
  current_policy_limits: Record<string, number | undefined>
  effective_remaining: Record<string, number>
  model_turns_remaining: number
  tool_calls_remaining: number
  tool_search_calls_remaining: number
  result_bytes_remaining: number
  wall_time_remaining_ms: number
  evidence_slots_remaining: number
  turn_summary_slots_remaining: number
  no_progress_count: number
  repeat_signature_count: number
  exhausted_dimensions: string[]
  stricter_current_policy_dimensions: string[]
  compatible: boolean
  blockers: string[]
  warnings: string[]
  compatibility_hash: string
}

export type CommanderInvestigationRecoveryCurrentContextBudget = {
  context_budget_id?: string
  input_context_bytes?: number
  input_context_tokens?: number
  tool_schema_allocation_bytes?: number
  tool_schema_allocation_tokens?: number
  blockers: string[]
  warnings: string[]
}

export type CommanderInvestigationRecoveryContextCompatibility = {
  current_context_budget_id?: string
  stored_checkpoint_bytes: number
  estimated_recovery_packet_bytes: number
  estimated_recovery_packet_tokens: number
  loaded_schema_bytes: number
  loaded_schema_tokens: number
  latest_protocol_summary_bytes: number
  evidence_summary_bytes: number
  current_bootstrap_bytes: number
  current_bootstrap_tokens: number
  current_input_context_bytes?: number
  current_input_context_tokens?: number
  within_current_context_budget: boolean
  exact_replay_supported: false
  fresh_context_required: true
  blockers: string[]
  warnings: string[]
  compatibility_hash: string
}

export type CommanderInvestigationRecoveryContinuityCompatibility = {
  original_bootstrap_id?: string
  original_bootstrap_hash?: string
  current_bootstrap_id?: string
  current_bootstrap_hash?: string
  current_bootstrap_ready: boolean
  continuity_drift_detected: boolean
  current_readiness?: string
  current_open_loop_count: number
  current_blocker_count: number
  current_bootstrap_bytes: number
  current_bootstrap_tokens: number
  human_control_summary?: string
  blockers: string[]
  warnings: string[]
  compatibility_hash: string
}

export type CommanderInvestigationRecoveryHumanControl = {
  checked: boolean
  source_kind: string
  control_id?: string
  projected_state?: string
  action: "continue" | "blocked" | "human_review_required"
  summary_preview?: string
  blockers: string[]
  warnings: string[]
  compatibility_hash: string
}

export type CommanderInvestigationRecoveryEvidencePointer = {
  evidence_id: string
  tool_id?: string
  source_kind: string
  source_id: string
  title: string
  summary_preview: string
  evidence_hash?: string
  source_refs: Array<{ source_kind: string; source_id: string; label?: string; summary_preview?: string; pointer_only: true }>
}

export type CommanderInvestigationRecoveryPacket = {
  packet_id: string
  packet_version: 1
  investigation_id: string
  recovery_kind: CommanderInvestigationRecoveryKind
  immutable_identity?: CommanderInvestigationJournalIdentity
  objective_preview?: string
  phase?: CommanderToolPhase
  original_bootstrap_ref?: { bootstrap_id: string; bootstrap_hash: string }
  current_continuity_ref?: { bootstrap_id: string; bootstrap_hash: string }
  checkpoint_ref?: { checkpoint_id: string; checkpoint_sequence: number; checkpoint_hash: string }
  pending_model_step_ref?: { model_request_id: string; turn_index: number; base_checkpoint_id: string; base_checkpoint_hash: string }
  loaded_tool_refs: CommanderInvestigationLoadedToolRef[]
  evidence_pointers: CommanderInvestigationRecoveryEvidencePointer[]
  execution_digests: Array<Record<string, unknown>>
  repeat_signatures: Array<{ signature_hash: string; count: number; last_turn_index: number }>
  no_progress_state: { consecutive_no_progress_turns: number; max_consecutive_no_progress_turns?: number }
  remaining_budget?: Pick<CommanderInvestigationRecoveryBudgetCompatibility, "effective_remaining" | "exhausted_dimensions">
  provider_execution_envelope_hash?: string
  execution_preparation_hash?: string
  first_model_request_preview_hash?: string
  uncertain_model_turn_charge?: number
  unresolved_provider_attempt_count?: number
  current_human_control?: CommanderInvestigationRecoveryHumanControl
  warnings: string[]
  blockers: string[]
  assistant_text_persisted: false
  exact_replay_supported: false
  raw_tool_results_persisted: false
  full_transcript_persisted: false
  provider_request_replay_allowed: false
  tool_execution_replay_allowed: false
  fresh_context_required: true
  packet_hash: string
}

export type CommanderInvestigationRecoveryPreview = {
  preview_id: string
  preview_version: 1
  status: CommanderInvestigationRecoveryPreviewStatus
  recovery_kind: CommanderInvestigationRecoveryKind
  recommended_action: CommanderInvestigationRecoveryRecommendedAction
  investigation_id: string
  record_status?: "running" | CommanderInvestigationStatus
  record_hash?: string
  projection_status?: CommanderInvestigationJournalProjectionStatus
  recovery_state?: CommanderInvestigationRecoveryState
  phase?: CommanderToolPhase
  objective_preview?: string
  mission_id?: string
  session_id?: string
  launch_id?: string
  provider_id?: string
  provider_kind?: string
  model_id?: string
  tool_protocol?: CommanderModelToolProtocol
  checkpoint?: CommanderInvestigationRecoveryCheckpointSummary
  pending_model_step?: CommanderInvestigationRecoveryPendingModelStep
  tool_compatibility: CommanderInvestigationRecoveryToolCompatibilitySummary
  provider_compatibility: CommanderInvestigationRecoveryProviderCompatibility
  budget_compatibility: CommanderInvestigationRecoveryBudgetCompatibility
  context_compatibility: CommanderInvestigationRecoveryContextCompatibility
  continuity_compatibility: CommanderInvestigationRecoveryContinuityCompatibility
  human_control: CommanderInvestigationRecoveryHumanControl
  recovery_packet?: CommanderInvestigationRecoveryPacket
  execution_preparation?: CommanderInvestigationRecoveryExecutionPreparationSummary
  execution_preparation_hash?: string
  approval_state: CommanderInvestigationRecoveryApprovalState
  current_approval?: CommanderInvestigationRecoveryApprovalSummary
  stale_approval_count: number
  recovery_approval_required: boolean
  recovery_approval_consumed: boolean
  current_recovery_attempt?: import("./commander-investigation-recovery-transaction-types").CommanderInvestigationRecoveryAttemptSummary
  automatic_resume_allowed: false
  human_approval_required: boolean
  exact_replay_supported: false
  original_assistant_text_available: false
  provider_request_replay_allowed: false
  tool_execution_replay_allowed: false
  fresh_context_required: true
  same_journal_resume_candidate: boolean
  terminal_continuation_requires_new_investigation: boolean
  recovery_basis_hash?: string
  recovery_plan_hash?: string
  blockers: string[]
  warnings: string[]
  generated_at: string
  network_called: false
  provider_called: false
  tool_executed: false
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

export type CommanderInvestigationRecoveryServiceOptions = {
  recoverySource(input: { investigation_id: string }): Promise<import("./commander-investigation-recovery-source").CommanderInvestigationRecoverySource | undefined>
  descriptors: import("../commander-tools/commander-tool-types").CommanderToolDescriptor[]
  boundToolIds: readonly string[]
  providerReadiness(input: { phase?: CommanderToolPhase; provider_id?: string; provider_kind?: string; model_id?: string }): CommanderInvestigationProviderReadiness
  providerExecutionEnvelope?(input: { phase?: CommanderToolPhase; provider_id?: string; provider_kind?: string; model_id?: string }): CommanderInvestigationRecoveryExecutionEnvelope | undefined
  githubGatewayStatus?(): { status: "ready" | "blocked"; transport_policy_hash?: string; blockers: string[] }
  modelCapability(input: { provider_kind?: string; model_id?: string; role?: string }): import("../context/model-capability-types").ModelCapability
  currentProfile(input: { phase?: string }): import("../commander-tools/commander-tool-types").CommanderToolProfile
  currentContextBudget(input: { phase: CommanderToolPhase; provider_kind: string; model_id: string; max_context_tokens?: number; max_context_bytes?: number }): Promise<CommanderInvestigationRecoveryCurrentContextBudget>
  currentBootstrap(input: Omit<import("./commander-investigation-types").CommanderInvestigationInput, "abort_signal">): Promise<import("./commander-investigation-types").CommanderInvestigationBootstrap>
  currentHumanControl(input: { phase: CommanderToolPhase; session_id?: string; launch_id?: string }): Promise<CommanderInvestigationControlSnapshot>
  continuationBuilder?: import("./commander-investigation-recovery-execution-types").CommanderInvestigationRecoveryContinuationBuilderOptions
  now?: () => Date
}

export type CommanderInvestigationRecoverySafeEvidence = Pick<CommanderEvidenceCard, "evidence_id" | "tool_id" | "source_kind" | "source_id" | "title" | "summary_preview" | "evidence_hash" | "source_refs">
export type CommanderInvestigationRecoveryStoredBudget = CommanderInvestigationBudget
