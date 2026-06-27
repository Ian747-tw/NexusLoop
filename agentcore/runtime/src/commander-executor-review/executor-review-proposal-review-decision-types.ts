export type ExecutorReviewProposalReviewDecision = "approve" | "reject"

export type ExecutorReviewProposalReviewDecisionStatus =
  | "ready"
  | "blocked"
  | "approved"
  | "rejected"
  | "failed"
  | "dry_run"

export type ExecutorReviewProposalReviewDecisionCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type ExecutorReviewProposalReviewDecisionPreview = {
  preview_id: string
  status: "ready" | "blocked"
  can_decide: boolean
  decision: ExecutorReviewProposalReviewDecision
  review_request_id: string
  proposal_id?: string
  request_gate_id?: string
  create_id?: string
  source_executor_review_id?: string
  source_draft_id?: string
  source_packet_id?: string
  review_request_status?: string
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
  existing_decision?: "approved" | "rejected" | "cancelled"
  existing_decision_at?: string
  blockers: string[]
  warnings: string[]
  recommended_commands: ExecutorReviewProposalReviewDecisionCommand[]
  generated_at: string
  redacted_summary_preview: string
}

export type ExecutorReviewProposalReviewDecisionResult = {
  decision_gate_id: string
  status: "approved" | "rejected" | "blocked" | "failed" | "dry_run"
  decision: ExecutorReviewProposalReviewDecision
  review_request_id: string
  proposal_id?: string
  request_gate_id?: string
  create_id?: string
  source_executor_review_id?: string
  source_draft_id?: string
  source_packet_id?: string
  mission_id?: string
  result_id?: string
  decided_at: string
  decided_by: string
  reason_preview?: string
  error?: string
  decision_hash: string
  recommended_commands: ExecutorReviewProposalReviewDecisionCommand[]
}

export type ExecutorReviewProposalReviewDecisionRecord = {
  decision_gate_id: string
  status: string
  decision: ExecutorReviewProposalReviewDecision
  review_request_id: string
  proposal_id?: string
  request_gate_id?: string
  create_id?: string
  decided_at: string
  summary_preview: string
  decision_hash: string
}

export type ExecutorReviewProposalReviewDecisionPreviewInput = {
  review_request_id: string
  decision: ExecutorReviewProposalReviewDecision
  reason?: string
  request_gate_id?: string
  include_authority?: boolean
}

export type ExecutorReviewProposalReviewDecisionInput = ExecutorReviewProposalReviewDecisionPreviewInput & {
  decided_by?: string
  dry_run?: boolean
}
