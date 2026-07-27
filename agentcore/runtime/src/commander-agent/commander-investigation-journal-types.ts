import type { CommanderEvidenceCard } from "../commander-tools/commander-read-types"
import type { CommanderToolPhase, CommanderToolTrustClass } from "../commander-tools/commander-tool-types"
import type { JsonlEvent } from "../events/event-types"
import type { CommanderInvestigationProviderAuditSummary } from "./commander-investigation-provider-types"
import type { CommanderModelToolCallPart, CommanderModelToolProtocol } from "./commander-model-types"
import type {
  CommanderInvestigationBudget,
  CommanderInvestigationInput,
  CommanderInvestigationRecentResultSignature,
  CommanderInvestigationStatus,
  CommanderInvestigationStopReason,
  CommanderInvestigationTurnSummary,
} from "./commander-investigation-types"

export const COMMANDER_INVESTIGATION_EVENT_KINDS = [
  "runtime_commander_investigation_started",
  "runtime_commander_investigation_model_step_started",
  "runtime_commander_investigation_checkpointed",
  "runtime_commander_investigation_finished",
] as const

export type CommanderInvestigationJournalEventKind = typeof COMMANDER_INVESTIGATION_EVENT_KINDS[number]

export type CommanderInvestigationCheckpointKind = "initial" | "turn_complete"

export type CommanderInvestigationLoadedToolRef = {
  tool_id: string
  descriptor_version: string
  authority_id: string
  input_schema_hash: string
  output_schema_hash: string
  load_policy: string
  trust_class: CommanderToolTrustClass
  instruction_semantics: "none"
}

export type CommanderInvestigationJournalIdentity = {
  investigation_id: string
  phase: CommanderToolPhase
  objective_hash: string
  provider_id: string
  provider_kind: string
  model_id: string
  tool_protocol: CommanderModelToolProtocol
  bootstrap_id: string
  bootstrap_hash: string
  budget_id: string
  budget_hash: string
}

export type CommanderDurableModelTextFingerprint = {
  text_persisted: false
  text_hash: string
  text_chars: number
}

export type CommanderInvestigationConclusionCard = {
  status: CommanderInvestigationStatus
  stop_reason: CommanderInvestigationStopReason
  evidence_ids: string[]
  evidence_titles: string[]
  safe_evidence_summaries: string[]
  blockers: string[]
  warnings: string[]
  final_output_text_hash?: string
}

export type CommanderDurableAssistantTextFingerprintPart = CommanderDurableModelTextFingerprint & {
  type: "text_fingerprint"
}

export type CommanderDurableAssistantToolCallPart = Omit<CommanderModelToolCallPart, "raw_arguments"> & {
  raw_arguments?: string
}

export type CommanderDurableAssistantMessage = {
  role: "assistant"
  content: Array<CommanderDurableAssistantTextFingerprintPart | CommanderDurableAssistantToolCallPart>
}

export type CommanderInvestigationDurableWorkingSet = {
  objective_preview: string
  phase: CommanderToolPhase
  loaded_tool_ids: string[]
  evidence_cards: CommanderEvidenceCard[]
  recent_execution_digests: Array<Record<string, unknown>>
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

export type CommanderInvestigationReplayExchange = {
  turn_index: number
  assistant_message: CommanderDurableAssistantMessage
  tool_result_messages: CommanderDurableToolResultSummaryMessage[]
  exchange_hash: string
  summary_only: true
  assistant_text_persisted: false
  exact_replay_supported: false
  protocol_relationship_preserved: true
  full_tool_results_persisted: false
}

export type CommanderDurableToolResultSummaryMessage = {
  role: "tool"
  tool_call_id: string
  tool_id: string
  content: string
  content_hash: string
  truncated: boolean
  durable_summary_only: true
  source_execution_id?: string
}

export type CommanderInvestigationCheckpoint = {
  schema_version: 1
  checkpoint_id: string
  investigation_id: string
  checkpoint_sequence: number
  checkpoint_kind: CommanderInvestigationCheckpointKind
  turn_index: number
  next_turn_index: number
  phase: CommanderToolPhase
  objective_hash: string
  provider_id: string
  provider_kind: string
  model_id: string
  tool_protocol: CommanderModelToolProtocol
  bootstrap_ref: { bootstrap_id: string; bootstrap_hash: string }
  budget: CommanderInvestigationBudget
  loaded_tools: CommanderInvestigationLoadedToolRef[]
  working_set: CommanderInvestigationDurableWorkingSet
  turn_summaries: CommanderInvestigationTurnSummary[]
  replay_exchange?: CommanderInvestigationReplayExchange
  provider_request_count: number
  external_api_audit_count: number
  elapsed_active_ms: number
  previous_checkpoint_id?: string
  previous_checkpoint_hash?: string
  created_at: string
  created_by: string
  semantic_state_hash: string
  checkpoint_hash: string
  resume_supported: false
  full_transcript_persisted: false
  raw_tool_results_persisted: false
  chain_of_thought_persisted: false
}

export type CommanderInvestigationStartedPayload = {
  schema_version: 1
  investigation_id: string
  journal_sequence: 0
  requested_by: string
  occurred_at: string
  normalized_input: Omit<CommanderInvestigationInput, "abort_signal">
  input_hash: string
  phase: CommanderToolPhase
  objective: string
  objective_hash: string
  mission_id?: string
  session_id?: string
  launch_id?: string
  provider_id: string
  provider_kind: string
  model_id: string
  tool_protocol: CommanderModelToolProtocol
  budget: CommanderInvestigationBudget
  budget_hash: string
  bootstrap_ref: { bootstrap_id: string; bootstrap_hash: string }
  initial_loaded_tool_refs: CommanderInvestigationLoadedToolRef[]
  initial_checkpoint: CommanderInvestigationCheckpoint
  started_at: string
  summary_preview: string
  event_payload_hash: string
}

export type CommanderInvestigationModelStepStartedPayload = {
  schema_version: 1
  investigation_id: string
  journal_sequence: number
  turn_index: number
  model_request_id: string
  provider_id: string
  provider_kind: string
  model_id: string
  tool_protocol: CommanderModelToolProtocol
  base_checkpoint_id: string
  base_checkpoint_sequence: number
  base_checkpoint_hash: string
  working_set_hash: string
  context_hash: string
  input_bytes: number
  estimated_input_tokens: number
  loaded_tool_refs: CommanderInvestigationLoadedToolRef[]
  provider_request_count_before: number
  external_api_audit_count_before: number
  started_at: string
  requested_by: string
  occurred_at: string
  event_payload_hash: string
}

export type CommanderInvestigationCheckpointedPayload = {
  schema_version: 1
  investigation_id: string
  journal_sequence: number
  requested_by: string
  occurred_at: string
  checkpoint: CommanderInvestigationCheckpoint
  event_payload_hash: string
}

export type CommanderInvestigationTerminalRecord = {
  schema_version: 1
  investigation_id: string
  status: CommanderInvestigationStatus
  stop_reason: CommanderInvestigationStopReason
  phase: CommanderToolPhase
  objective_hash: string
  provider_id: string
  provider_kind: string
  model_id: string
  tool_protocol: CommanderModelToolProtocol
  final_output?: CommanderDurableModelTextFingerprint
  conclusion: CommanderInvestigationConclusionCard
  bootstrap_id: string
  bootstrap_hash: string
  budget_id: string
  budget_hash: string
  last_checkpoint_id: string
  last_checkpoint_sequence: number
  last_checkpoint_hash: string
  pending_model_request_id?: string
  model_turn_count: number
  provider_request_count: number
  tool_call_count: number
  tool_search_call_count: number
  loaded_tool_ids: string[]
  evidence_cards: CommanderEvidenceCard[]
  turn_summaries: CommanderInvestigationTurnSummary[]
  omitted_evidence_count: number
  omitted_turn_count: number
  provider_audit: CommanderInvestigationProviderAuditSummary
  blockers: string[]
  warnings: string[]
  semantic_result_hash: string
  started_at: string
  completed_at: string
  terminal_hash: string
  transcript_persisted: false
  raw_tool_results_persisted: false
  chain_of_thought_persisted: false
}

export type CommanderInvestigationFinishedPayload = {
  schema_version: 1
  investigation_id: string
  journal_sequence: number
  requested_by: string
  occurred_at: string
  terminal: CommanderInvestigationTerminalRecord
  event_payload_hash: string
}

export type CommanderInvestigationJournalPayload =
  | CommanderInvestigationStartedPayload
  | CommanderInvestigationModelStepStartedPayload
  | CommanderInvestigationCheckpointedPayload
  | CommanderInvestigationFinishedPayload

export type CommanderInvestigationJsonlEvent = JsonlEvent & {
  kind: CommanderInvestigationJournalEventKind
  schema_version: 1
  investigation_id: string
  journal_sequence: number
  event_payload_hash: string
}

export type CommanderInvestigationJournalProjectionStatus = "ready" | "corrupt" | "unsupported_version"
export type CommanderInvestigationJournalLastTransition = "started" | "model_step_started" | "checkpointed" | "finished"
export type CommanderInvestigationRecoveryState = "not_required" | "checkpoint_available_resume_not_implemented" | "uncertain_provider_outcome_resume_not_implemented" | "no_checkpoint_resume_not_implemented"

export type CommanderInvestigationRecord = {
  investigation_id: string
  status: "running" | CommanderInvestigationStatus
  stop_reason?: CommanderInvestigationStopReason
  phase: CommanderToolPhase
  objective_preview: string
  objective_hash: string
  requested_by: string
  mission_id?: string
  session_id?: string
  launch_id?: string
  provider_id: string
  provider_kind: string
  model_id: string
  tool_protocol: CommanderModelToolProtocol
  started_at: string
  updated_at: string
  completed_at?: string
  budget_id: string
  budget_hash: string
  bootstrap_id: string
  bootstrap_hash: string
  model_turn_count: number
  provider_request_count: number
  tool_call_count: number
  tool_search_call_count: number
  loaded_tool_ids: string[]
  evidence_ids: string[]
  evidence_count: number
  final_summary_preview?: string
  evidence_previews: string[]
  latest_checkpoint_id?: string
  latest_checkpoint_sequence?: number
  latest_checkpoint_hash?: string
  pending_model_request_id?: string
  pending_turn_index?: number
  last_transition: CommanderInvestigationJournalLastTransition
  checkpoint_available: boolean
  uncertain_provider_outcome: boolean
  resume_supported: false
  recovery_state: CommanderInvestigationRecoveryState
  investigation_event_count: number
  external_api_audit_event_count: number
  semantic_result_hash?: string
  projection_status: CommanderInvestigationJournalProjectionStatus
  integrity_errors: string[]
  warnings: string[]
  record_hash: string
}

export type CommanderInvestigationJournalSummary = {
  total: number
  running_count: number
  terminal_count: number
  final_count: number
  failed_count: number
  cancelled_count: number
  needs_human_review_count: number
  checkpoint_available_count: number
  uncertain_provider_outcome_count: number
  corrupt_count: number
  last_investigation_id?: string
  last_checkpoint_id?: string
  generated_at: string
}
