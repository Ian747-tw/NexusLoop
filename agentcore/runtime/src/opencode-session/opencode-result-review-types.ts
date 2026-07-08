export type OpenCodeResultReviewDecision =
  | "accepted"
  | "rejected"
  | "needs_revision"
  | "needs_followup"
  | "inconclusive"
  | "needs_human_review"
  | "deferred"
  | "unknown"

export type OpenCodeResultReviewStatus = "ready" | "blocked" | "dry_run" | "recorded" | "failed"

export type OpenCodeResultReviewAuthorKind = "human" | "commander_manual" | "system" | "unknown"

export type OpenCodeResultReviewDisposition =
  | "accepted_as_evidence"
  | "rejected_as_evidence"
  | "revision_requested"
  | "followup_requested"
  | "inconclusive_evidence"
  | "human_review_required"
  | "deferred_review"
  | "unknown"

export type OpenCodeResultReviewNextStep =
  | "none"
  | "prepare_research_ingestion"
  | "request_revision"
  | "request_followup"
  | "ask_commander_question"
  | "escalate_to_human"
  | "inspect_artifacts"
  | "inspect_tests"
  | "unknown"

export type OpenCodeResultReviewProjectionState =
  | "unreviewed"
  | "reviewed_accepted"
  | "reviewed_rejected"
  | "reviewed_needs_revision"
  | "reviewed_needs_followup"
  | "reviewed_inconclusive"
  | "reviewed_needs_human"
  | "review_deferred"

export type OpenCodeResultReviewCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeResultReviewPreview = {
  preview_id: string
  status: "ready" | "blocked"
  can_record: boolean
  report_id: string
  session_id: string
  launch_id?: string
  result_kind?: string
  result_disposition?: string
  report_review_state?: string
  decision: OpenCodeResultReviewDecision
  review_disposition: OpenCodeResultReviewDisposition
  projection_state_after: OpenCodeResultReviewProjectionState
  next_step: OpenCodeResultReviewNextStep
  author_kind: OpenCodeResultReviewAuthorKind
  rationale_preview: string
  evidence_summary_preview?: string
  accepted_claims_preview: string[]
  rejected_claims_preview: string[]
  revision_requests_preview: string[]
  followup_requests_preview: string[]
  risk_flags_preview: string[]
  artifact_refs_preview: string[]
  test_refs_preview: string[]
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
  followup_mission_created: false
  provider_called: false
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeResultReviewCommand[]
  generated_at: string
  redacted_summary_preview: string
  review_hash: string
}

export type OpenCodeResultReviewResult = Omit<OpenCodeResultReviewPreview, "preview_id" | "status" | "can_record" | "generated_at" | "blockers" | "warnings" | "redacted_summary_preview"> & {
  review_id: string
  status: "recorded" | "blocked" | "dry_run" | "failed"
  recorded_at: string
  recorded_by: string
  error?: string
}

export type OpenCodeResultReviewRecord = {
  review_id: string
  report_id: string
  session_id: string
  launch_id?: string
  decision: OpenCodeResultReviewDecision
  review_disposition: OpenCodeResultReviewDisposition
  projection_state_after: OpenCodeResultReviewProjectionState
  next_step: OpenCodeResultReviewNextStep
  author_kind: OpenCodeResultReviewAuthorKind
  rationale_preview: string
  recorded_at: string
  recorded_by: string
  confidence?: string | number
  has_revision_requests: boolean
  has_followup_requests: boolean
  review_hash: string
}

export type OpenCodeResultReviewSummary = {
  total_reviews: number
  reviewed_report_count: number
  accepted_count: number
  rejected_count: number
  needs_revision_count: number
  needs_followup_count: number
  inconclusive_count: number
  needs_human_count: number
  deferred_count: number
  research_ingestion_recommended_count: number
  latest_reviews: OpenCodeResultReviewRecord[]
  generated_at: string
}

export type OpenCodeResultReviewPreviewInput = {
  report_id?: string
  decision?: string
  rationale?: string
  evidence_summary?: string
  accepted_claims?: string[]
  rejected_claims?: string[]
  revision_requests?: string[]
  followup_requests?: string[]
  risk_flags?: string[]
  artifact_refs?: string[]
  test_refs?: string[]
  confidence?: unknown
  author_kind?: string
  next_step?: string
  recorded_by?: string
}

export type OpenCodeResultReviewRecordInput = OpenCodeResultReviewPreviewInput & {
  dry_run?: boolean
  recorded_by?: string
}
