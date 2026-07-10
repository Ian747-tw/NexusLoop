import type { ResearchMemoryCandidate, ResearchMemoryInspectionPreview, ResearchMemoryNearDuplicatePreview, ResearchMemorySearchProfile } from "../research-memory/research-memory-types"

export type CommanderContinuityPacketKind = "proposal" | "mid_mission" | "wake" | "result_review" | "summary"
export type CommanderContinuityPacketStatus = "ready" | "partial" | "blocked" | "empty"
export type CommanderContinuityDecisionReadiness = "ready" | "blocked" | "needs_research_memory" | "needs_human_review" | "duplicate_risk_high" | "open_loops_pending" | "unknown"

export type CommanderContinuityOpenLoopKind =
  | "pending_commander_question"
  | "pending_guidance_delivery"
  | "human_pause"
  | "human_stop"
  | "human_correction"
  | "human_override"
  | "result_report_needs_review"
  | "accepted_review_not_ingested"
  | "research_ingestion_failed"
  | "watchdog_timed_out"
  | "forced_report_requested"
  | "wake_action_blocked"
  | "wake_action_manual_required"
  | "session_stale"
  | "unknown"

export type CommanderContinuityOpenLoopSeverity = "info" | "warning" | "blocking" | "critical"
export type CommanderContinuitySectionStatus = "included" | "pointer_only" | "missing" | "excluded" | "truncated"

export type CommanderContinuitySourceRef = {
  source_kind: string
  source_id: string
  label?: string
  summary_preview?: string
  status?: string
  pointer_only: true
}

export type CommanderContinuityCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type CommanderContinuitySection = {
  section_id: string
  section_kind: string
  status: CommanderContinuitySectionStatus
  title: string
  summary_preview: string
  source_refs: CommanderContinuitySourceRef[]
  item_count: number
  omitted_count: number
  warnings: string[]
}

export type CommanderContinuityPacketBudget = {
  target_token_budget: number
  estimated_token_count: number
  section_budgets: Record<string, number>
  omitted_sections: string[]
  truncation_warnings: string[]
}

export type CommanderContinuityOpenLoop = {
  loop_id: string
  loop_kind: CommanderContinuityOpenLoopKind
  severity: CommanderContinuityOpenLoopSeverity
  blocking: boolean
  session_id?: string
  launch_id?: string
  source_ref: CommanderContinuitySourceRef
  summary_preview: string
  recommended_command?: string
  created_at?: string
}

export type CommanderProposalContinuityPacket = {
  packet_id: string
  packet_kind: "proposal"
  status: CommanderContinuityPacketStatus
  objective_preview: string
  normalized_objective_preview: string
  readiness: CommanderContinuityDecisionReadiness
  authority_summary: string
  project_direction_summary: string
  proposal_lineage_summary: string
  recent_execution_summary: string
  open_loops: CommanderContinuityOpenLoop[]
  research_memory_summary: string
  research_search_profile_summary: string
  research_queries_executed: string[]
  research_candidates_summary: string
  near_duplicate_summary: string
  inspected_memory_refs: CommanderContinuitySourceRef[]
  novelty_risk?: string
  missing_memory_warning: boolean
  why_not_duplicate_required: boolean
  blockers: string[]
  warnings: string[]
  sections: CommanderContinuitySection[]
  source_refs: CommanderContinuitySourceRef[]
  recommended_commands: CommanderContinuityCommand[]
  budget: CommanderContinuityPacketBudget
  generated_at: string
  redacted_summary_preview: string
  packet_hash: string
}

export type CommanderMidMissionContinuityPacket = {
  packet_id: string
  packet_kind: "mid_mission"
  status: CommanderContinuityPacketStatus
  session_id: string
  launch_id?: string
  objective_preview: string
  readiness: CommanderContinuityDecisionReadiness
  active_session_summary: string
  latest_progress_summary: string
  watchdog_summary: string
  commander_dialogue_summary: string
  guidance_delivery_summary: string
  human_control_summary: string
  wake_supervision_summary: string
  result_state_summary: string
  local_session_working_memory_summary: string
  research_memory_summary?: string
  open_loops: CommanderContinuityOpenLoop[]
  blockers: string[]
  warnings: string[]
  sections: CommanderContinuitySection[]
  source_refs: CommanderContinuitySourceRef[]
  recommended_commands: CommanderContinuityCommand[]
  budget: CommanderContinuityPacketBudget
  generated_at: string
  redacted_summary_preview: string
  packet_hash: string
}

export type CommanderContinuityThreadCard = {
  thread_id: string
  session_id?: string
  launch_id?: string
  mission_id?: string
  objective_preview: string
  latest_status: string
  latest_result_report_id?: string
  latest_result_review_id?: string
  latest_research_ingestion_id?: string
  open_loop_count: number
  last_updated_at?: string
  summary_preview: string
}

export type CommanderContinuitySummary = {
  total_recent_sessions: number
  active_session_count: number
  stale_or_timed_out_count: number
  pending_question_count: number
  pending_guidance_delivery_count: number
  human_attention_count: number
  result_reports_needing_review_count: number
  accepted_reviews_not_ingested_count: number
  open_loop_count: number
  latest_threads: CommanderContinuityThreadCard[]
  generated_at: string
}

export type CommanderContinuityResearchSection = {
  profile: ResearchMemorySearchProfile
  main: ResearchMemoryCandidate[]
  failures: ResearchMemoryCandidate[]
  probes: ResearchMemoryCandidate[]
  near_duplicates?: ResearchMemoryNearDuplicatePreview
  inspected: ResearchMemoryInspectionPreview[]
}

export type CommanderProposalContinuityInput = {
  objective?: string
  mission_id?: string
  session_id?: string
  include_research_memory?: boolean
  include_near_duplicates?: boolean
  include_open_loops?: boolean
  include_recent_sessions?: boolean
  max_recent_sessions?: number
  max_open_loops?: number
  max_research_candidates?: number
  max_inspected_memory?: number
  target_token_budget?: number
  model_id?: string
}

export type CommanderMidMissionContinuityInput = {
  session_id?: string
  launch_id?: string
  include_research_memory?: boolean
  include_open_loops?: boolean
  include_local_working_memory?: boolean
  max_open_loops?: number
  max_research_candidates?: number
  target_token_budget?: number
  model_id?: string
}

export type CommanderContinuitySummaryInput = {
  limit?: number
  include_closed?: boolean
}

export type CommanderContinuityOpenLoopInput = {
  session_id?: string
  launch_id?: string
  mission_id?: string
  severity?: string
  kind?: string
  limit?: number
}

export type CommanderContinuityThreadInput = {
  thread_id?: string
  session_id?: string
  launch_id?: string
  mission_id?: string
  objective?: string
}
