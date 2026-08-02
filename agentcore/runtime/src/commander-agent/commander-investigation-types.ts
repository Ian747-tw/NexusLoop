import type { CommanderEvidenceCard } from "../commander-tools/commander-read-types"
import type { CommanderToolDescriptor, CommanderToolPhase } from "../commander-tools/commander-tool-types"
import type { CommanderModelAssistantMessage, CommanderModelMessage, CommanderModelToolProtocol, CommanderModelToolResultMessage } from "./commander-model-types"
import type { CommanderToolExecutionResult } from "./commander-tool-execution-types"
import type { CommanderInvestigationProviderAuditPolicy, CommanderInvestigationProviderAuditSummary, CommanderInvestigationProviderGate } from "./commander-investigation-provider-types"
import type { CommanderInvestigationRecoveryNotice } from "./commander-investigation-recovery-execution-types"
import type { CommanderInvestigationRecoverySource } from "./commander-investigation-recovery-source"

export type CommanderInvestigationStatus = "final" | "refused" | "blocked" | "failed" | "cancelled" | "budget_exhausted" | "no_progress" | "needs_human_review"

export type CommanderInvestigationStopReason =
  | "model_final"
  | "model_refusal"
  | "model_malformed"
  | "provider_failed"
  | "caller_cancelled"
  | "human_pause"
  | "human_stop"
  | "human_correction"
  | "human_override"
  | "human_escalation"
  | "max_model_turns"
  | "max_tool_calls"
  | "max_tool_search_calls"
  | "max_tool_calls_per_turn"
  | "max_loaded_schemas"
  | "max_cumulative_tool_result_bytes"
  | "context_budget_exhausted"
  | "wall_time_exhausted"
  | "repeated_identical_call"
  | "consecutive_no_progress"
  | "invalid_tool_call"
  | "unloaded_tool_call"
  | "duplicate_tool_call_id"
  | "tool_execution_cancelled"
  | "controller_error"
  | "adapter_not_configured"
  | "bootstrap_blocked"
  | "provider_preflight_blocked"
  | "provider_audit_incomplete"
  | "persistence_failed"
  | "durable_state_conflict"

export type CommanderInvestigationToolProtocol = "auto" | CommanderModelToolProtocol
export type CommanderInvestigationControlAction = "continue" | "pause" | "stop" | "needs_human_review"

export type CommanderInvestigationInput = {
  investigation_id?: string
  phase: CommanderToolPhase
  objective: string
  requested_by: string
  mission_id?: string
  session_id?: string
  launch_id?: string
  provider_id: string
  provider_kind: string
  model_id: string
  tool_protocol?: CommanderInvestigationToolProtocol
  max_model_turns?: number
  max_tool_calls?: number
  max_tool_search_calls?: number
  max_loaded_schemas?: number
  max_tool_calls_per_turn?: number
  max_cumulative_tool_result_bytes?: number
  max_wall_time_ms?: number
  max_consecutive_no_progress_turns?: number
  max_evidence_cards?: number
  max_turn_summaries?: number
  max_context_tokens?: number
  max_context_bytes?: number
  include_continuity?: boolean
  abort_signal?: AbortSignal
}

export type CommanderInvestigationBudget = {
  budget_id: string
  phase: CommanderToolPhase
  max_model_turns: number
  max_tool_calls: number
  max_tool_search_calls: number
  max_loaded_schemas: number
  max_tool_calls_per_turn: number
  max_cumulative_tool_result_bytes: number
  max_wall_time_ms: number
  max_consecutive_no_progress_turns: number
  max_evidence_cards: number
  max_turn_summaries: number
  max_context_tokens?: number
  max_context_bytes?: number
  target_input_tokens?: number
  tool_schema_allocation_tokens?: number
  tool_schema_allocation_bytes?: number
  source_profile_id: string
  source_context_budget_id: string
  warnings: string[]
  budget_hash: string
}

export type CommanderInvestigationBootstrap = {
  bootstrap_id: string
  phase: CommanderToolPhase
  objective_preview: string
  authority_kernel: string
  continuity_kind: "proposal" | "mid_mission" | "summary" | "omitted"
  continuity_assessment_status?: "ready" | "omitted" | "degraded"
  continuity_packet_id?: string
  continuity_packet_hash?: string
  readiness: string
  current_project_summary: string
  current_execution_summary?: string
  human_control_summary?: string
  open_loops: Array<{ loop_id: string; loop_kind: string; severity: string; summary_preview: string; blocking: boolean }>
  source_refs: Array<{ source_kind: string; source_id: string; label?: string; summary_preview?: string; pointer_only: true }>
  blockers: string[]
  warnings: string[]
  estimated_bytes: number
  estimated_tokens: number
  bootstrap_hash: string
}

export type CommanderInvestigationControlSnapshot = {
  action: CommanderInvestigationControlAction
  control_id?: string
  source_kind: string
  summary_preview?: string
  projected_state?: string
  checked_at: string
  warnings: string[]
}

export type CommanderInvestigationControlGate = {
  check(input: {
    phase: CommanderToolPhase
    session_id?: string
    launch_id?: string
    before: "model_step" | "tool_execution"
    turn_index: number
    tool_id?: string
  }): Promise<CommanderInvestigationControlSnapshot> | CommanderInvestigationControlSnapshot
}

export type CommanderInvestigationWorkingSet = {
  objective_preview: string
  phase: CommanderToolPhase
  loaded_tool_ids: string[]
  evidence_cards: CommanderEvidenceCard[]
  recent_execution_digests: CommanderInvestigationExecutionDigest[]
  recent_load_outcomes: string[]
  current_blockers: string[]
  current_warnings: string[]
  provider_audit: CommanderInvestigationProviderAuditSummary
  omitted_evidence_count: number
  omitted_digest_count: number
  omitted_turn_count: number
  consecutive_no_progress_turns: number
  cumulative_tool_result_bytes: number
  model_turn_count: number
  tool_call_count: number
  tool_search_call_count: number
  recent_result_signatures: CommanderInvestigationRecentResultSignature[]
  working_set_hash: string
}

export type CommanderInvestigationRecentResultSignature = {
  signature_hash: string
  count: number
  last_turn_index: number
}

export type CommanderInvestigationExecutionDigest = {
  turn_index: number
  tool_id: string
  call_signature_hash: string
  execution_status: string
  result_hash: string
  evidence_ids: string[]
  loaded_tool_outcome?: string
  blocker_warning_summary: string
  order: number
}

export type CommanderInvestigationTurnSummary = {
  turn_index: number
  model_request_id: string
  model_result_hash?: string
  model_status: string
  provider_request_count: number
  assistant_text_preview?: string
  tool_call_ids: string[]
  tool_ids: string[]
  tool_execution_ids: string[]
  tool_execution_statuses: string[]
  newly_loaded_tool_ids: string[]
  new_evidence_ids: string[]
  input_estimated_tokens: number
  input_bytes: number
  output_tokens?: number
  cumulative_tool_calls: number
  progress_made: boolean
  no_progress_reasons: string[]
  warnings: string[]
  provider_transport_kind?: "external_api_connector"
  provider_connector_id?: string
  provider_audit_request_ids: string[]
  provider_audit_event_kinds: string[]
  provider_audit_event_count: number
  provider_audit_complete: boolean
  turn_hash: string
}

export type CommanderInvestigationContext = {
  messages: CommanderModelMessage[]
  tools: CommanderToolDescriptor[]
  input_bytes: number
  estimated_tokens: number
  warnings: string[]
  blocked: boolean
  blockers: string[]
}

export type CommanderInvestigationResult = {
  investigation_id: string
  status: CommanderInvestigationStatus
  stop_reason: CommanderInvestigationStopReason
  phase: CommanderToolPhase
  objective_preview: string
  provider_id: string
  provider_kind: string
  model_id: string
  tool_protocol: CommanderModelToolProtocol
  final_summary?: string
  bootstrap_id: string
  bootstrap_hash: string
  context_budget_id: string
  budget: CommanderInvestigationBudget
  model_turn_count: number
  provider_request_count: number
  tool_call_count: number
  tool_search_call_count: number
  loaded_tool_ids: string[]
  loaded_schema_bytes: number
  loaded_schema_tokens: number
  cumulative_tool_result_bytes: number
  evidence: CommanderEvidenceCard[]
  turn_summaries: CommanderInvestigationTurnSummary[]
  omitted_evidence_count: number
  omitted_turn_count: number
  provider_audit: CommanderInvestigationProviderAuditSummary
  blockers: string[]
  warnings: string[]
  started_at: string
  completed_at: string
  duration_ms: number
  durability?: CommanderInvestigationDurabilitySummary
  investigation_event_count: number
  in_memory_only: boolean
  transcript_persisted: false
  working_set_persisted: boolean
  investigation_events_appended: boolean
  external_api_audit_events_appended: number
  events_appended: boolean
  files_written: false
  research_db_written: false
  mission_mutated: false
  proposal_mutated: false
  opencode_action_performed: false
  github_action_performed: false
  mcp_called: false
  external_research_called: false
  result_hash: string
}

export type CommanderInvestigationDurabilitySummary = {
  mode: "none" | "event_journal"
  started_persisted: boolean
  initial_checkpoint_persisted: boolean
  terminal_persisted: boolean
  investigation_event_count: number
  started_event_id?: string
  latest_checkpoint_event_id?: string
  finished_event_id?: string
  latest_checkpoint_id?: string
  latest_checkpoint_sequence?: number
  latest_checkpoint_hash?: string
  checkpoint_count: number
  pending_model_request_id?: string
  projection_status?: "ready" | "corrupt" | "unsupported_version"
  resume_supported: false
  full_transcript_persisted: false
  raw_tool_results_persisted: false
  chain_of_thought_persisted: false
  original_terminal_status_if_persistence_failed?: CommanderInvestigationStatus
  warnings: string[]
  durability_hash: string
}

export type CommanderInvestigationPersistenceObserver = {
  onStarted(snapshot: CommanderInvestigationStartedSnapshot): Promise<void> | void
  onModelStepStarted(snapshot: CommanderInvestigationModelStepStartedSnapshot): Promise<void> | void
  onCheckpoint(snapshot: CommanderInvestigationCheckpointSnapshot): Promise<void> | void
}

export type CommanderInvestigationStartedSnapshot = {
  investigation_id: string
  input: CommanderInvestigationInput
  bootstrap: CommanderInvestigationBootstrap
  budget: CommanderInvestigationBudget
  tool_protocol: CommanderModelToolProtocol
  loaded_tools: CommanderToolDescriptor[]
  working_set: CommanderInvestigationWorkingSet
  started_at: string
}

export type CommanderInvestigationModelStepStartedSnapshot = {
  investigation_id: string
  input: CommanderInvestigationInput
  turn_index: number
  model_request_id: string
  tool_protocol: CommanderModelToolProtocol
  base_checkpoint_id?: string
  base_checkpoint_sequence?: number
  base_checkpoint_hash?: string
  working_set_hash: string
  context_hash: string
  input_bytes: number
  estimated_input_tokens: number
  loaded_tools: CommanderToolDescriptor[]
  provider_request_count_before: number
  external_api_audit_count_before: number
  started_at: string
}

export type CommanderInvestigationCheckpointSnapshot = {
  investigation_id: string
  input: CommanderInvestigationInput
  bootstrap: CommanderInvestigationBootstrap
  budget: CommanderInvestigationBudget
  tool_protocol: CommanderModelToolProtocol
  turn_index: number
  next_turn_index: number
  loaded_tools: CommanderToolDescriptor[]
  working_set: CommanderInvestigationWorkingSet
  turn_summaries: CommanderInvestigationTurnSummary[]
  latest_assistant?: CommanderModelAssistantMessage
  latest_tool_results: CommanderModelToolResultMessage[]
  provider_request_count: number
  elapsed_active_ms: number
  created_at: string
}

export type CommanderInvestigationControllerOptions = {
  modelAdapter?: import("./commander-model-types").CommanderModelStepAdapter
  toolExecutor: { execute(input: import("./commander-tool-execution-types").CommanderToolExecutionRequest): Promise<CommanderToolExecutionResult> }
  toolService: {
    profile(input: { phase?: string }): import("../commander-tools/commander-tool-types").CommanderToolProfile
    bootstrap(input: { phase?: string; provider_kind?: string; model_id?: string; max_context_tokens?: number; max_context_bytes?: number }): Promise<import("../commander-tools/commander-tool-types").CommanderToolBootstrapPreview>
    get(input: { tool_id?: string; include_schema?: boolean }): CommanderToolDescriptor
  }
  descriptors: CommanderToolDescriptor[]
  boundToolIds: readonly string[]
  bootstrapService: { compile(input: CommanderInvestigationInput): Promise<CommanderInvestigationBootstrap> }
  contextService: { build(input: { bootstrap: CommanderInvestigationBootstrap; workingSet: CommanderInvestigationWorkingSet; loadedTools: CommanderToolDescriptor[]; toolProtocol: CommanderModelToolProtocol; budget: CommanderInvestigationBudget; latestAssistant?: CommanderModelAssistantMessage; latestToolResults: CommanderModelToolResultMessage[]; recoveryNotice?: CommanderInvestigationRecoveryNotice }): CommanderInvestigationContext }
  controlGate?: CommanderInvestigationControlGate
  providerGate?: CommanderInvestigationProviderGate
  providerAuditPolicy?: CommanderInvestigationProviderAuditPolicy
  persistenceObserver?: CommanderInvestigationPersistenceObserver
  capabilityRegistry: { get(input: { provider_kind?: string; model_id?: string; role?: string }): { supports_tools: boolean | "unknown"; warnings: string[]; max_output_tokens?: number } }
  contextBudgetService: { preview(input: Record<string, unknown>): Promise<{ budget: { budget_id: string; max_context_tokens?: number; max_context_bytes?: number; max_output_tokens?: number; safety_margin_tokens?: number; safety_margin_bytes?: number; allocations: Array<{ section: string; max_tokens?: number; max_bytes?: number }> }; warnings: string[]; blockers: string[] }> }
  recoverySource?: (investigationId: string) => Promise<CommanderInvestigationRecoverySource | undefined> | CommanderInvestigationRecoverySource | undefined
  now?: () => Date
}
