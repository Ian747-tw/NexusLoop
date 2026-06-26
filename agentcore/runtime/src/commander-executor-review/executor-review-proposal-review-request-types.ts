export type ExecutorReviewProposalReviewRequestStatus =
  | "ready"
  | "blocked"
  | "requested"
  | "failed"
  | "dry_run"

export type ExecutorReviewProposalReviewRequestCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type ExecutorReviewProposalReviewRequestPreview = {
  preview_id: string
  status: "ready" | "blocked"
  can_request: boolean
  proposal_id: string
  create_id?: string
  review_id?: string
  draft_id?: string
  source_packet_id?: string
  proposal_status?: string
  proposal_title_preview: string
  proposal_summary_preview: string
  action_kind?: string
  mission_id?: string
  result_id?: string
  source_evidence_ids: string[]
  source_finding_ids: string[]
  source_confidence?: number
  risk?: string
  existing_review_request_id?: string
  existing_review_request_status?: string
  blockers: string[]
  warnings: string[]
  recommended_commands: ExecutorReviewProposalReviewRequestCommand[]
  generated_at: string
  redacted_summary_preview: string
}

export type ExecutorReviewProposalReviewRequestResult = {
  request_gate_id: string
  status: "requested" | "blocked" | "failed" | "dry_run"
  review_request_id?: string
  proposal_id: string
  create_id?: string
  review_id?: string
  draft_id?: string
  source_packet_id?: string
  mission_id?: string
  result_id?: string
  requested_at: string
  requested_by: string
  error?: string
  request_hash: string
  recommended_commands: ExecutorReviewProposalReviewRequestCommand[]
}

export type ExecutorReviewProposalReviewRequestRecord = {
  request_gate_id: string
  status: string
  review_request_id?: string
  proposal_id: string
  create_id?: string
  review_id?: string
  draft_id?: string
  requested_at: string
  summary_preview: string
  request_hash: string
}

export type ExecutorReviewProposalReviewRequestPreviewInput = {
  proposal_id: string
  create_id?: string
  include_authority?: boolean
}

export type ExecutorReviewProposalReviewRequestInput = ExecutorReviewProposalReviewRequestPreviewInput & {
  requested_by?: string
  dry_run?: boolean
}
