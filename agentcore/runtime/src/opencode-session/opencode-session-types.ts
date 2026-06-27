export type OpenCodeSessionStatus =
  | "planned"
  | "launch_ready"
  | "running"
  | "paused"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown"

export type OpenCodeSessionSourceKind =
  | "manual"
  | "proposal"
  | "mission"
  | "executor_review"
  | "research"
  | "unknown"

export type OpenCodeSessionContextBoundary = {
  commander_context_summary: string
  opencode_context_seed: string
  shared_context_summary: string
  excluded_context_summary?: string
  max_context_bytes: number
  commander_context_hash: string
  opencode_context_hash: string
}

export type OpenCodeSessionTimeoutPolicy = {
  max_wall_time_ms: number
  max_no_progress_ms: number
  heartbeat_interval_ms: number
  max_tool_idle_ms?: number
  forced_pause_enabled: boolean
  report_required_on_timeout: boolean
  timeout_policy_hash: string
}

export type OpenCodeSessionQuestionPolicy = {
  allow_opencode_questions: boolean
  commander_answer_required_for_blockers: boolean
  human_escalation_allowed: boolean
  max_pending_questions: number
  question_policy_hash: string
}

export type OpenCodeSessionHumanControlPolicy = {
  allow_human_pause: boolean
  allow_human_override: boolean
  allow_human_stop: boolean
  allow_human_guidance_note: boolean
  require_reason_for_stop: boolean
  human_policy_hash: string
}

export type OpenCodeSessionPlan = {
  session_id: string
  status: "planned"
  mission_id?: string
  proposal_id?: string
  review_request_id?: string
  apply_id?: string
  source_kind: OpenCodeSessionSourceKind
  objective: string
  title: string
  commander_context_summary: string
  opencode_context_seed: string
  shared_context_summary: string
  success_criteria: string[]
  constraints: string[]
  artifact_expectations: string[]
  timeout_policy: OpenCodeSessionTimeoutPolicy
  question_policy: OpenCodeSessionQuestionPolicy
  human_control_policy: OpenCodeSessionHumanControlPolicy
  created_at: string
  created_by: string
  session_hash: string
}

export type OpenCodeSessionRecord = {
  session_id: string
  status: OpenCodeSessionStatus
  title: string
  mission_id?: string
  proposal_id?: string
  source_kind: OpenCodeSessionSourceKind
  created_at: string
  updated_at?: string
  summary_preview: string
  session_hash: string
}

export type OpenCodeSessionSummary = {
  total_sessions: number
  planned_count: number
  running_count: number
  paused_count: number
  blocked_count: number
  completed_count: number
  failed_count: number
  cancelled_count: number
  generated_at: string
}

export type OpenCodeSessionPreview = {
  preview_id: string
  can_create: boolean
  source_kind: OpenCodeSessionSourceKind
  mission_id?: string
  proposal_id?: string
  review_request_id?: string
  apply_id?: string
  title_preview: string
  objective_preview: string
  commander_context_summary_preview: string
  opencode_context_seed_preview: string
  success_criteria: string[]
  constraints: string[]
  timeout_policy: OpenCodeSessionTimeoutPolicy
  question_policy: OpenCodeSessionQuestionPolicy
  human_control_policy: OpenCodeSessionHumanControlPolicy
  existing_session_id?: string
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeSessionCommand[]
  generated_at: string
  redacted_summary_preview: string
}

export type OpenCodeSessionCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeSessionPreviewInput = {
  mission_id?: string
  proposal_id?: string
  review_request_id?: string
  apply_id?: string
  objective?: string
  title?: string
  source_kind?: OpenCodeSessionSourceKind
  max_context_bytes?: number
  max_wall_time_ms?: number
  max_no_progress_ms?: number
  heartbeat_interval_ms?: number
  created_by?: string
  include_authority?: boolean
}

export type OpenCodeSessionCreateInput = OpenCodeSessionPreviewInput & {
  dry_run?: boolean
  created_by?: string
}
