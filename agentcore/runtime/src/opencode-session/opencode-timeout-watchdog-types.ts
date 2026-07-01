export type OpenCodeWatchdogStatus =
  | "healthy"
  | "stale"
  | "timed_out"
  | "blocked"
  | "needs_report"
  | "unknown"

export type OpenCodeWatchdogAction =
  | "none"
  | "record_assessment"
  | "request_report"
  | "escalate_to_commander"
  | "escalate_to_human"

export type OpenCodeWatchdogResultStatus = "ready" | "blocked" | "recorded" | "dry_run" | "failed"

export type OpenCodeWatchdogCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeWatchdogPreview = {
  preview_id: string
  status: "ready" | "blocked"
  can_record: boolean
  session_id: string
  launch_id?: string
  launch_status?: string
  watchdog_status: OpenCodeWatchdogStatus
  recommended_action: OpenCodeWatchdogAction
  wall_clock_elapsed_ms?: number
  no_progress_elapsed_ms?: number
  heartbeat_elapsed_ms?: number
  max_wall_time_ms?: number
  max_no_progress_ms?: number
  heartbeat_interval_ms?: number
  forced_pause_enabled?: boolean
  report_required_on_timeout?: boolean
  latest_progress_id?: string
  latest_progress_kind?: string
  latest_progress_state?: string
  latest_progress_at?: string
  latest_report_summary_preview?: string
  has_blockers: boolean
  has_question: boolean
  blockers_preview: string[]
  question_preview?: string
  report_required: boolean
  forced_report_already_requested: boolean
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeWatchdogCommand[]
  generated_at: string
  redacted_summary_preview: string
  watchdog_hash: string
}

export type OpenCodeWatchdogRecord = {
  watchdog_id: string
  session_id: string
  launch_id?: string
  watchdog_status: OpenCodeWatchdogStatus
  recommended_action: OpenCodeWatchdogAction
  report_required: boolean
  recorded_at: string
  recorded_by: string
  latest_progress_id?: string
  watchdog_hash: string
}

export type OpenCodeWatchdogResult = {
  watchdog_id: string
  status: "recorded" | "blocked" | "dry_run" | "failed"
  session_id: string
  launch_id?: string
  watchdog_status: OpenCodeWatchdogStatus
  recommended_action: OpenCodeWatchdogAction
  report_required: boolean
  forced_report_requested: boolean
  forced_report_request_id?: string
  latest_progress_id?: string
  latest_progress_kind?: string
  latest_progress_state?: string
  latest_progress_at?: string
  wall_clock_elapsed_ms?: number
  no_progress_elapsed_ms?: number
  heartbeat_elapsed_ms?: number
  recorded_at: string
  recorded_by: string
  error?: string
  watchdog_hash: string
  recommended_commands: OpenCodeWatchdogCommand[]
}

export type OpenCodeForcedReportRequest = {
  request_id: string
  session_id: string
  launch_id?: string
  watchdog_id?: string
  reason: string
  requested_at: string
  requested_by: string
  latest_progress_id?: string
  report_due_after_ms?: number
  forced_pause_recommended: boolean
  process_paused: false
  command_to_operator_preview?: string
  request_hash: string
}

export type OpenCodeWatchdogSummary = {
  total_launched_sessions: number
  healthy_count: number
  stale_count: number
  timed_out_count: number
  needs_report_count: number
  blocked_count: number
  latest_records: OpenCodeWatchdogRecord[]
  generated_at: string
}

export type OpenCodeWatchdogPreviewInput = {
  session_id?: string
  launch_id?: string
  max_wall_time_ms?: number
  max_no_progress_ms?: number
  heartbeat_interval_ms?: number
  include_latest_progress?: boolean
}

export type OpenCodeWatchdogRecordInput = OpenCodeWatchdogPreviewInput & {
  dry_run?: boolean
  recorded_by?: string
  request_report?: boolean
}

export type OpenCodeForcedReportInput = {
  session_id?: string
  launch_id?: string
  reason?: string
  dry_run?: boolean
  requested_by?: string
}
