export type ExecutorReviewProposalDraftPreviewStatus =
  | "ready"
  | "blocked"
  | "needs_review"
  | "inconclusive"
  | "unknown"

export type ExecutorReviewProposalDraftKind =
  | "mission_progress"
  | "mission_result"
  | "followup_task"
  | "human_review"
  | "checkpoint"
  | "documentation"
  | "blocked_followup"
  | "other"

export type ExecutorReviewProposalDraftCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type ExecutorReviewProposalDraftCandidate = {
  draft_id: string
  draft_kind: ExecutorReviewProposalDraftKind
  title: string
  summary: string
  rationale: string
  source_review_id: string
  source_packet_id: string
  mission_id?: string
  result_id?: string
  handoff_id?: string
  proposal_id?: string
  evidence_ids: string[]
  finding_ids: string[]
  confidence: number
  risk: "low" | "medium" | "high"
  would_create_proposal: false
  would_mutate_mission: false
  recommended_commands: ExecutorReviewProposalDraftCommand[]
}

export type ExecutorReviewProposalDraftPreview = {
  preview_id: string
  status: ExecutorReviewProposalDraftPreviewStatus
  review_id?: string
  packet_id?: string
  review_decision?: string
  review_confidence?: number
  can_create_proposals_now: false
  candidates: ExecutorReviewProposalDraftCandidate[]
  blockers: string[]
  warnings: string[]
  recommended_commands: ExecutorReviewProposalDraftCommand[]
  generated_at: string
  redacted_summary_preview: string
}

export type ExecutorReviewProposalDraftSummary = {
  total_reviews_considered: number
  draftable_review_count: number
  blocked_review_count: number
  candidate_count: number
  latest_review_id?: string
  generated_at: string
}

export type ExecutorReviewProposalDraftPreviewInput = {
  review_id?: string
  packet_id?: string
  mission_id?: string
  result_id?: string
  handoff_id?: string
  proposal_id?: string
  limit?: number
  include_packet?: boolean
  include_authority?: boolean
}
