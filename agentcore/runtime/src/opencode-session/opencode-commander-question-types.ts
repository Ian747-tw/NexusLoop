export type OpenCodeCommanderQuestionType =
  | "clarification"
  | "blocker"
  | "design_choice"
  | "permission"
  | "missing_context"
  | "conflict"
  | "status_report_request"
  | "timeout_report"
  | "unknown"

export type OpenCodeCommanderQuestionStatus =
  | "pending_commander"
  | "pending_human"
  | "withdrawn"
  | "superseded"
  | "answered"

export type OpenCodeCommanderQuestionUrgency = "low" | "normal" | "high" | "urgent"

export type OpenCodeCommanderQuestionSourceKind =
  | "manual"
  | "progress_question"
  | "watchdog"
  | "forced_report"
  | "fake"
  | "unknown"

export type OpenCodeCommanderQuestionCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeCommanderQuestionPreview = {
  preview_id: string
  status: "ready" | "blocked"
  can_create: boolean
  session_id: string
  launch_id?: string
  progress_id?: string
  watchdog_id?: string
  forced_report_request_id?: string
  question_type: OpenCodeCommanderQuestionType
  urgency: OpenCodeCommanderQuestionUrgency
  question_preview: string
  context_summary_preview: string
  options_considered_preview: string[]
  executor_recommendation_preview?: string
  evidence_summary_preview?: string
  source_kind: OpenCodeCommanderQuestionSourceKind
  duplicate_question_id?: string
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeCommanderQuestionCommand[]
  generated_at: string
  redacted_summary_preview: string
  question_hash: string
}

export type OpenCodeCommanderQuestionRecord = {
  question_id: string
  status: OpenCodeCommanderQuestionStatus
  session_id: string
  launch_id?: string
  question_type: OpenCodeCommanderQuestionType
  urgency: OpenCodeCommanderQuestionUrgency
  question_preview: string
  source_kind: OpenCodeCommanderQuestionSourceKind
  created_at: string
  created_by: string
  has_options: boolean
  has_recommendation: boolean
  linked_progress_id?: string
  linked_watchdog_id?: string
  linked_forced_report_request_id?: string
  question_hash: string
}

export type OpenCodeCommanderQuestionResult = {
  question_id: string
  status: "created" | "blocked" | "dry_run" | "failed"
  question_status: OpenCodeCommanderQuestionStatus
  session_id: string
  launch_id?: string
  progress_id?: string
  watchdog_id?: string
  forced_report_request_id?: string
  question_type: OpenCodeCommanderQuestionType
  urgency: OpenCodeCommanderQuestionUrgency
  question_preview: string
  context_summary_preview: string
  options_considered_preview: string[]
  executor_recommendation_preview?: string
  evidence_summary_preview?: string
  created_at: string
  created_by: string
  source_kind: OpenCodeCommanderQuestionSourceKind
  error?: string
  question_hash: string
  recommended_commands: OpenCodeCommanderQuestionCommand[]
}

export type OpenCodeCommanderQuestionSummary = {
  total_questions: number
  pending_commander_count: number
  pending_human_count: number
  withdrawn_count: number
  superseded_count: number
  answered_count: number
  urgent_count: number
  blocked_type_count: number
  latest_questions: OpenCodeCommanderQuestionRecord[]
  generated_at: string
}

export type OpenCodeCommanderQuestionPreviewInput = {
  session_id?: string
  launch_id?: string
  progress_id?: string
  watchdog_id?: string
  forced_report_request_id?: string
  question?: string
  question_type?: OpenCodeCommanderQuestionType | string
  urgency?: OpenCodeCommanderQuestionUrgency | string
  context_summary?: string
  options_considered?: string[]
  executor_recommendation?: string
  source_kind?: OpenCodeCommanderQuestionSourceKind | string
}

export type OpenCodeCommanderQuestionCreateInput = OpenCodeCommanderQuestionPreviewInput & {
  dry_run?: boolean
  created_by?: string
}
