export type OpenCodeProgressKind =
  | "heartbeat"
  | "progress"
  | "blocker"
  | "question"
  | "checkpoint_note"
  | "completion_report"
  | "failure_report"

export type OpenCodeProgressStatus = "ready" | "blocked" | "recorded" | "failed" | "dry_run"

export type OpenCodeExecutionState =
  | "unknown"
  | "running"
  | "working"
  | "waiting"
  | "blocked"
  | "needs_commander"
  | "needs_human"
  | "reported_done"
  | "reported_failed"

export type OpenCodeProgressSourceKind = "manual" | "adapter" | "fake" | "unknown"

export type OpenCodeProgressCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeProgressPreview = {
  preview_id: string
  status: "ready" | "blocked"
  can_record: boolean
  session_id: string
  launch_id?: string
  launch_status?: string
  launch_started_at?: string
  kind: OpenCodeProgressKind
  execution_state: OpenCodeExecutionState
  report_summary_preview: string
  current_step_preview?: string
  files_touched_preview: string[]
  commands_run_preview: string[]
  tests_run_preview: string[]
  artifacts_preview: string[]
  blockers_preview: string[]
  question_preview?: string
  confidence?: number | "low" | "medium" | "high" | "unknown"
  next_action_preview?: string
  source_kind: OpenCodeProgressSourceKind
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeProgressCommand[]
  generated_at: string
  redacted_summary_preview: string
  progress_hash: string
}

export type OpenCodeProgressRecord = {
  progress_id: string
  session_id: string
  launch_id?: string
  kind: OpenCodeProgressKind
  execution_state: OpenCodeExecutionState
  report_summary_preview: string
  recorded_at: string
  recorded_by: string
  source_kind: OpenCodeProgressSourceKind
  confidence?: number | "low" | "medium" | "high" | "unknown"
  has_blockers: boolean
  has_question: boolean
  progress_hash: string
}

export type OpenCodeProgressResult = {
  progress_id: string
  status: "recorded" | "blocked" | "failed" | "dry_run"
  session_id: string
  launch_id?: string
  kind: OpenCodeProgressKind
  execution_state: OpenCodeExecutionState
  report_summary_preview: string
  current_step_preview?: string
  files_touched_preview: string[]
  commands_run_preview: string[]
  tests_run_preview: string[]
  artifacts_preview: string[]
  blockers_preview: string[]
  question_preview?: string
  confidence?: number | "low" | "medium" | "high" | "unknown"
  next_action_preview?: string
  recorded_at: string
  recorded_by: string
  source_kind: OpenCodeProgressSourceKind
  error?: string
  progress_hash: string
  recommended_commands: OpenCodeProgressCommand[]
}

export type OpenCodeProgressSummary = {
  total_records: number
  session_count: number
  launched_session_count: number
  latest_records: OpenCodeProgressRecord[]
  blocked_count: number
  question_count: number
  heartbeat_count: number
  generated_at: string
}

export type OpenCodeProgressPreviewInput = {
  session_id?: string
  launch_id?: string
  kind?: OpenCodeProgressKind | string
  execution_state?: OpenCodeExecutionState | string
  report_summary?: string
  current_step?: string
  files_touched?: string[]
  commands_run?: string[]
  tests_run?: string[]
  artifacts?: string[]
  blockers?: string[]
  question?: string
  confidence?: number | "low" | "medium" | "high" | "unknown" | string
  next_action?: string
  source_kind?: OpenCodeProgressSourceKind | string
}

export type OpenCodeProgressAppendInput = OpenCodeProgressPreviewInput & {
  dry_run?: boolean
  recorded_by?: string
}
