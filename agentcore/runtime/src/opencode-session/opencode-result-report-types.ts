export type OpenCodeResultReportKind =
  | "completion_report"
  | "partial_report"
  | "failure_report"
  | "inconclusive_report"
  | "blocked_report"
  | "status_report"
  | "unknown"

export type OpenCodeResultReportStatus = "ready" | "blocked" | "dry_run" | "recorded" | "failed"

export type OpenCodeResultDisposition =
  | "reported_done"
  | "reported_partial"
  | "reported_failed"
  | "reported_inconclusive"
  | "reported_blocked"
  | "reported_status_only"

export type OpenCodeResultReviewState =
  | "needs_commander_review"
  | "needs_human_review"
  | "not_ready_for_review"
  | "review_not_required"
  | "unknown"

export type OpenCodeResultReportCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeResultReportPreview = {
  preview_id: string
  status: "ready" | "blocked"
  can_record: boolean
  session_id: string
  launch_id?: string
  result_kind: OpenCodeResultReportKind
  result_disposition: OpenCodeResultDisposition
  review_state: OpenCodeResultReviewState
  summary_preview: string
  outcome_preview?: string
  changed_files_preview: string[]
  tests_run_preview: string[]
  test_results_preview: string[]
  artifacts_preview: string[]
  metrics_preview: string[]
  claims_preview: string[]
  known_failures_preview: string[]
  followups_preview: string[]
  confidence?: string | number
  linked_progress_id?: string
  linked_watchdog_id?: string
  linked_question_id?: string
  linked_guidance_id?: string
  linked_delivery_id?: string
  linked_wake_execution_id?: string
  linked_wake_action_execution_id?: string
  mission_mutated: false
  research_db_written: false
  checkpoint_created: false
  commander_review_created: false
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeResultReportCommand[]
  generated_at: string
  redacted_summary_preview: string
  report_hash: string
}

export type OpenCodeResultReportResult = Omit<OpenCodeResultReportPreview, "preview_id" | "status" | "can_record" | "generated_at" | "blockers" | "warnings" | "redacted_summary_preview"> & {
  report_id: string
  status: "recorded" | "blocked" | "dry_run" | "failed"
  recorded_at: string
  recorded_by: string
  error?: string
}

export type OpenCodeResultReportRecord = {
  report_id: string
  session_id: string
  launch_id?: string
  result_kind: OpenCodeResultReportKind
  result_disposition: OpenCodeResultDisposition
  review_state: OpenCodeResultReviewState
  summary_preview: string
  recorded_at: string
  recorded_by: string
  confidence?: string | number
  has_failures: boolean
  has_artifacts: boolean
  has_metrics: boolean
  report_hash: string
}

export type OpenCodeResultReportSummary = {
  total_reports: number
  session_count: number
  completion_count: number
  partial_count: number
  failure_count: number
  inconclusive_count: number
  blocked_count: number
  needs_commander_review_count: number
  needs_human_review_count: number
  latest_reports: OpenCodeResultReportRecord[]
  generated_at: string
}

export type OpenCodeResultReportPreviewInput = {
  session_id?: string
  launch_id?: string
  result_kind?: string
  summary?: string
  outcome?: string
  changed_files?: string[]
  tests_run?: string[]
  test_results?: string[]
  artifacts?: string[]
  metrics?: string[]
  claims?: string[]
  known_failures?: string[]
  followups?: string[]
  confidence?: unknown
  progress_id?: string
  watchdog_id?: string
  question_id?: string
  guidance_id?: string
  delivery_id?: string
  wake_execution_id?: string
  wake_action_execution_id?: string
  review_state?: string
}

export type OpenCodeResultReportRecordInput = OpenCodeResultReportPreviewInput & {
  dry_run?: boolean
  recorded_by?: string
}
