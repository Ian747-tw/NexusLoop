export type OpenCodeWakeSupervisorStatus =
  | "healthy"
  | "watch"
  | "needs_report"
  | "needs_commander_answer"
  | "guidance_pending_delivery"
  | "human_attention"
  | "human_paused"
  | "stop_requested"
  | "blocked"
  | "stale"
  | "timed_out"
  | "unknown"

export type OpenCodeWakeSupervisorRecommendedAction =
  | "none"
  | "read_latest_progress"
  | "record_watchdog"
  | "request_forced_report"
  | "create_commander_question"
  | "answer_commander_question"
  | "deliver_guidance"
  | "review_human_control"
  | "escalate_to_human"
  | "prepare_result_review"
  | "unknown"

export type OpenCodeWakeSupervisorEvidenceKind =
  | "session_plan"
  | "launch"
  | "progress"
  | "watchdog"
  | "forced_report"
  | "commander_question"
  | "commander_guidance"
  | "guidance_delivery"
  | "human_control"
  | "research_memory"
  | "novelty"
  | "context_packet"
  | "unknown"

export type OpenCodeWakeSupervisorEvidenceRef = {
  evidence_kind: OpenCodeWakeSupervisorEvidenceKind
  evidence_id: string
  status?: string
  summary_preview?: string
  recorded_at?: string
  pointer_only: true
}

export type OpenCodeWakeSupervisorCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeWakeSupervisorCheck = {
  check_id: string
  label: string
  status: "pass" | "warn" | "fail" | "unknown"
  summary_preview: string
  evidence_refs: OpenCodeWakeSupervisorEvidenceRef[]
  recommended_commands: OpenCodeWakeSupervisorCommand[]
}

export type OpenCodeWakeSupervisorContextSection = {
  section: string
  status: "included" | "pointer_only" | "missing" | "excluded"
  summary_preview: string
  evidence_refs: OpenCodeWakeSupervisorEvidenceRef[]
  warnings: string[]
}

export type OpenCodeWakeSupervisorPreview = {
  preview_id: string
  status: "ready" | "blocked" | "partial"
  session_id: string
  launch_id?: string
  supervisor_status: OpenCodeWakeSupervisorStatus
  recommended_action: OpenCodeWakeSupervisorRecommendedAction
  active_launch_status?: string
  latest_progress_id?: string
  latest_progress_kind?: string
  latest_progress_state?: string
  latest_watchdog_id?: string
  latest_watchdog_status?: string
  latest_forced_report_request_id?: string
  pending_question_id?: string
  pending_question_count: number
  unanswered_question_count: number
  latest_guidance_id?: string
  latest_guidance_delivery_status?: string
  pending_delivery_count: number
  latest_human_control_id?: string
  latest_human_projected_state?: string
  human_pause_requested: boolean
  human_stop_requested: boolean
  human_correction_pending: boolean
  human_override_pending: boolean
  report_required: boolean
  timed_out: boolean
  stale: boolean
  blocked_by_human: boolean
  checks: OpenCodeWakeSupervisorCheck[]
  context_sections: OpenCodeWakeSupervisorContextSection[]
  evidence_refs: OpenCodeWakeSupervisorEvidenceRef[]
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeWakeSupervisorCommand[]
  generated_at: string
  redacted_summary_preview: string
  supervisor_hash: string
}

export type OpenCodeWakeSupervisorSessionCard = {
  session_id: string
  launch_id?: string
  supervisor_status: OpenCodeWakeSupervisorStatus
  recommended_action: OpenCodeWakeSupervisorRecommendedAction
  latest_progress_at?: string
  latest_watchdog_status?: string
  pending_question_count: number
  pending_delivery_count: number
  latest_human_projected_state?: string
  summary_preview: string
  supervisor_hash: string
}

export type OpenCodeWakeSupervisorSummary = {
  total_launched_sessions: number
  healthy_count: number
  stale_count: number
  timed_out_count: number
  needs_report_count: number
  needs_commander_answer_count: number
  guidance_pending_delivery_count: number
  human_attention_count: number
  stop_requested_count: number
  session_cards: OpenCodeWakeSupervisorSessionCard[]
  generated_at: string
}

export type OpenCodeWakeSupervisorPreviewInput = {
  session_id?: string
  launch_id?: string
  include_research_memory?: boolean
  include_context_packet?: boolean
  include_human_controls?: boolean
  include_guidance_delivery?: boolean
  limit_evidence?: number
}

export type OpenCodeWakeSupervisorSummaryInput = {
  limit?: number
  include_research_memory?: boolean
  include_human_controls?: boolean
  status_filter?: string
}
