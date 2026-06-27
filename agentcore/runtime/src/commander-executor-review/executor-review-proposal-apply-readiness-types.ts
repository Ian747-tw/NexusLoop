export type ExecutorReviewProposalApplyReadinessStatus =
  | "ready"
  | "blocked"
  | "needs_review"
  | "rejected"
  | "unknown"

export type ExecutorReviewProposalApplyCandidateKind =
  | "manual_action"
  | "mission_progress"
  | "mission_result"
  | "human_review"
  | "checkpoint"
  | "followup_task"
  | "blocked_followup"
  | "generic"
  | "unsupported"

export type ExecutorReviewProposalApplyReadinessCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type ExecutorReviewProposalApplyReadinessPreview = {
  readiness_id: string
  status: ExecutorReviewProposalApplyReadinessStatus
  can_apply_in_future: boolean
  proposal_id: string
  review_request_id?: string
  request_gate_id?: string
  decision_gate_id?: string
  create_id?: string
  source_executor_review_id?: string
  source_draft_id?: string
  source_packet_id?: string
  proposal_status?: string
  review_request_status?: string
  review_decision?: "approve" | "reject"
  proposal_title_preview: string
  proposal_summary_preview: string
  action_kind?: string
  candidate_kind: ExecutorReviewProposalApplyCandidateKind
  candidate_risk: "low" | "medium" | "high"
  mission_id?: string
  result_id?: string
  source_evidence_ids: string[]
  source_finding_ids: string[]
  source_confidence?: number
  blockers: string[]
  warnings: string[]
  recommended_commands: ExecutorReviewProposalApplyReadinessCommand[]
  generated_at: string
  redacted_summary_preview: string
}

export type ExecutorReviewProposalApplyReadinessRecord = {
  readiness_id: string
  status: ExecutorReviewProposalApplyReadinessStatus
  proposal_id: string
  review_request_id?: string
  decision_gate_id?: string
  create_id?: string
  candidate_kind: ExecutorReviewProposalApplyCandidateKind
  candidate_risk: "low" | "medium" | "high"
  generated_at: string
  summary_preview: string
}

export type ExecutorReviewProposalApplyReadinessSummary = {
  total_considered: number
  ready_count: number
  blocked_count: number
  needs_review_count: number
  rejected_count: number
  generic_count: number
  high_risk_count: number
  generated_at: string
}

export type ExecutorReviewProposalApplyReadinessInput = {
  proposal_id?: string
  review_request_id?: string
  decision_gate_id?: string
  create_id?: string
  include_authority?: boolean
  limit?: number
}
