export type OpenCodeContinuityPacketKind = "session_refresh" | "continuation"
export type OpenCodeContinuityMode = "active_refresh" | "continue_same_session" | "fork_from_session" | "patch_session" | "resume_from_checkpoint"
export type OpenCodeContinuityPacketStatus = "ready" | "partial" | "blocked" | "empty"
export type OpenCodeContinuityReadiness = "ready_for_artifact" | "needs_base_instruction_pack" | "needs_launch" | "needs_native_session_id" | "needs_target_session" | "needs_checkpoint_binding" | "needs_human_review" | "blocked"
export type OpenCodeContinuityConsumptionStatus = "not_delivered"
export type OpenCodeNativeSessionLinkStatus = "linked" | "missing" | "unverified" | "not_applicable"
export type OpenCodeContinuitySectionStatus = "included" | "pointer_only" | "omitted" | "missing" | "excluded" | "truncated"
export type OpenCodeContinuityDeltaKind = "initial_snapshot" | "incremental"

export type OpenCodeContinuitySourceRef = {
  source_kind: string
  source_id: string
  label?: string
  status?: string
  summary_preview?: string
  pointer_only: true
}

export type OpenCodeContinuitySection = {
  section_id: string
  section_kind: string
  status: OpenCodeContinuitySectionStatus
  priority: "required" | "high" | "medium" | "low" | "excluded"
  summary_preview: string
  item_count: number
  omitted_count: number
  estimated_tokens: number
  estimated_bytes: number
  max_tokens?: number
  max_bytes?: number
  source_refs: OpenCodeContinuitySourceRef[]
  warnings: string[]
}

export type OpenCodeContinuityDelta = {
  delta_kind: OpenCodeContinuityDeltaKind
  previous_refresh_id?: string
  previous_packet_hash?: string
  changed_section_kinds: string[]
  new_progress_ids: string[]
  new_question_ids: string[]
  new_guidance_ids: string[]
  new_delivery_ids: string[]
  new_human_control_ids: string[]
  new_watchdog_ids: string[]
  new_wake_execution_ids: string[]
  new_wake_action_ids: string[]
  new_result_report_ids: string[]
  new_result_review_ids: string[]
  new_research_ingestion_ids: string[]
  new_research_memory_ids: string[]
  summary_preview: string
  delta_hash: string
}

export type OpenCodeContinuityBudget = {
  budget_id: string
  provider_kind: string
  model_id: string
  max_context_tokens?: number
  max_context_bytes?: number
  max_output_tokens?: number
  safety_margin_tokens?: number
  safety_margin_bytes?: number
  target_input_tokens?: number
  estimated_input_tokens: number
  estimated_input_bytes: number
  over_budget: boolean
  section_budgets: Record<string, number>
  omitted_sections: string[]
  truncation_warnings: string[]
}

export type OpenCodeContinuityCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeContinuitySafetyFlags = {
  delivery_performed: false
  opencode_prompt_sent: false
  native_session_action_performed: false
  process_control_performed: false
  session_state_mutated: false
  mission_mutated: false
  provider_called: false
  mcp_called: false
  research_db_written: false
}

export type OpenCodeSessionContinuityPacket = OpenCodeContinuitySafetyFlags & {
  packet_id: string
  packet_kind: "session_refresh"
  continuity_mode: "active_refresh"
  status: OpenCodeContinuityPacketStatus
  continuity_readiness: OpenCodeContinuityReadiness
  consumption_status: OpenCodeContinuityConsumptionStatus
  source_session_id: string
  target_session_id: string
  launch_id?: string
  native_session_id?: string
  native_session_link_status: OpenCodeNativeSessionLinkStatus
  base_pack_id?: string
  base_pack_hash?: string
  base_context_packet_id?: string
  base_context_packet_hash?: string
  previous_refresh_id?: string
  previous_refresh_hash?: string
  context_strategy: "immutable_base_plus_latest_snapshot_and_delta"
  objective_preview: string
  current_task_preview: string
  success_criteria: string[]
  constraints: string[]
  latest_progress_summary?: string
  current_blocker_summary?: string
  pending_question_count: number
  pending_guidance_count: number
  pending_delivery_count: number
  latest_human_control_state?: string
  watchdog_status?: string
  wake_status?: string
  result_state?: string
  research_memory_mode: "auto" | "include" | "omit"
  sections: OpenCodeContinuitySection[]
  delta: OpenCodeContinuityDelta
  source_refs: OpenCodeContinuitySourceRef[]
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeContinuityCommand[]
  budget: OpenCodeContinuityBudget
  generated_at: string
  redacted_summary_preview: string
  packet_hash: string
}

export type OpenCodeContinuationPacket = OpenCodeContinuitySafetyFlags & {
  packet_id: string
  packet_kind: "continuation"
  continuity_mode: Exclude<OpenCodeContinuityMode, "active_refresh">
  status: OpenCodeContinuityPacketStatus
  continuity_readiness: OpenCodeContinuityReadiness
  consumption_status: OpenCodeContinuityConsumptionStatus
  source_session_id: string
  source_launch_id?: string
  source_native_session_id?: string
  target_session_id?: string
  target_launch_id?: string
  checkpoint_id?: string
  continuation_reason_preview: string
  patch_reason_preview?: string
  fork_reason_preview?: string
  parent_child_summary: string
  preserve_summary: string[]
  discard_summary: string[]
  objective_delta_preview?: string
  base_pack_id?: string
  base_pack_hash?: string
  target_base_pack_id?: string
  target_base_pack_hash?: string
  previous_refresh_id?: string
  sections: OpenCodeContinuitySection[]
  delta: OpenCodeContinuityDelta
  source_refs: OpenCodeContinuitySourceRef[]
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeContinuityCommand[]
  budget: OpenCodeContinuityBudget
  generated_at: string
  redacted_summary_preview: string
  packet_hash: string
}

export type OpenCodeSessionContinuityInput = {
  session_id?: string
  launch_id?: string
  previous_refresh_id?: string
  provider_kind?: string
  model_id?: string
  max_context_tokens?: number
  max_context_bytes?: number
  research_memory_mode?: "auto" | "include" | "omit"
  max_progress_items?: number
  max_open_loops?: number
  max_research_candidates?: number
  include_result_state?: boolean
  include_human_controls?: boolean
  include_guidance?: boolean
  include_wake_state?: boolean
  include_artifact_refs?: boolean
}

export type OpenCodeContinuationInput = {
  source_session_id?: string
  source_launch_id?: string
  target_session_id?: string
  continuity_mode?: OpenCodeContinuityMode | string
  continuation_reason?: string
  patch_reason?: string
  fork_reason?: string
  checkpoint_id?: string
  previous_refresh_id?: string
  preserve?: string[]
  discard?: string[]
  objective_delta?: string
  provider_kind?: string
  model_id?: string
  max_context_tokens?: number
  max_context_bytes?: number
  research_memory_mode?: "auto" | "include" | "omit"
  max_progress_items?: number
  max_research_candidates?: number
}
