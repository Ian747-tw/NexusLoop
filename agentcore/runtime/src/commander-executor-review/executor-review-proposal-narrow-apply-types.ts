import type { ExecutorReviewProposalApplyCandidateKind } from "./executor-review-proposal-apply-readiness-types"

export type ExecutorReviewProposalNarrowApplyStatus =
  | "ready"
  | "blocked"
  | "applied"
  | "failed"
  | "dry_run"

export type ExecutorReviewProposalNarrowApplyCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type ExecutorReviewProposalNarrowApplyPreview = {
  preview_id: string
  status: "ready" | "blocked"
  can_apply: boolean
  proposal_id: string
  readiness_id?: string
  review_request_id?: string
  request_gate_id?: string
  decision_gate_id?: string
  create_id?: string
  source_executor_review_id?: string
  source_draft_id?: string
  source_packet_id?: string
  proposal_status?: string
  readiness_status?: string
  candidate_kind: ExecutorReviewProposalApplyCandidateKind
  candidate_risk: "low" | "medium" | "high"
  proposal_title_preview: string
  proposal_summary_preview: string
  action_kind?: string
  mission_id?: string
  result_id?: string
  source_evidence_ids: string[]
  source_finding_ids: string[]
  source_confidence?: number
  existing_apply_id?: string
  blockers: string[]
  warnings: string[]
  recommended_commands: ExecutorReviewProposalNarrowApplyCommand[]
  generated_at: string
  redacted_summary_preview: string
}

export type ExecutorReviewProposalNarrowApplyResult = {
  apply_id: string
  status: "applied" | "blocked" | "failed" | "dry_run"
  proposal_id: string
  readiness_id?: string
  review_request_id?: string
  request_gate_id?: string
  decision_gate_id?: string
  create_id?: string
  source_executor_review_id?: string
  source_draft_id?: string
  source_packet_id?: string
  candidate_kind: ExecutorReviewProposalApplyCandidateKind
  candidate_risk: "low" | "medium" | "high"
  applied_at: string
  applied_by: string
  reason_preview?: string
  error?: string
  apply_hash: string
  recommended_commands: ExecutorReviewProposalNarrowApplyCommand[]
}

export type ExecutorReviewProposalNarrowApplyRecord = {
  apply_id: string
  status: string
  proposal_id: string
  readiness_id?: string
  candidate_kind: ExecutorReviewProposalApplyCandidateKind
  candidate_risk: "low" | "medium" | "high"
  applied_at: string
  summary_preview: string
  apply_hash: string
}

export type ExecutorReviewProposalNarrowApplyPreviewInput = {
  proposal_id?: string
  readiness_id?: string
  reason?: string
  include_authority?: boolean
}

export type ExecutorReviewProposalNarrowApplyInput = ExecutorReviewProposalNarrowApplyPreviewInput & {
  applied_by?: string
  dry_run?: boolean
}
