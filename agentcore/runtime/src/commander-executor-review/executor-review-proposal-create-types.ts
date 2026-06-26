import type { ExecutorReviewProposalDraftKind } from "./executor-review-proposal-draft-types"

export type ExecutorReviewProposalCreateStatus =
  | "ready"
  | "blocked"
  | "created"
  | "failed"
  | "dry_run"

export type ExecutorReviewProposalCreateCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type ExecutorReviewProposalCreatePreview = {
  preview_id: string
  status: "ready" | "blocked"
  can_create: boolean
  review_id: string
  draft_id: string
  source_packet_id?: string
  draft_kind: ExecutorReviewProposalDraftKind | string
  title_preview: string
  summary_preview: string
  proposed_action_kind: string
  target_mission_id?: string
  target_result_id?: string
  target_handoff_id?: string
  target_proposal_id?: string
  evidence_ids: string[]
  finding_ids: string[]
  source_confidence: number
  risk: "low" | "medium" | "high" | string
  existing_proposal_id?: string
  blockers: string[]
  warnings: string[]
  recommended_commands: ExecutorReviewProposalCreateCommand[]
  generated_at: string
  redacted_summary_preview: string
}

export type ExecutorReviewProposalCreateResult = {
  create_id: string
  status: "created" | "blocked" | "failed" | "dry_run"
  proposal_id?: string
  review_id: string
  draft_id: string
  source_packet_id?: string
  draft_kind: ExecutorReviewProposalDraftKind | string
  proposed_action_kind: string
  title_preview: string
  summary_preview: string
  evidence_ids: string[]
  finding_ids: string[]
  created_at: string
  requested_by: string
  error?: string
  create_hash: string
  recommended_commands: ExecutorReviewProposalCreateCommand[]
}

export type ExecutorReviewProposalCreateRecord = {
  create_id: string
  status: string
  proposal_id?: string
  review_id: string
  draft_id: string
  draft_kind: string
  created_at: string
  summary_preview: string
  create_hash: string
}

export type ExecutorReviewProposalCreatePreviewInput = {
  review_id: string
  draft_id: string
  include_validation_evidence?: boolean
}

export type ExecutorReviewProposalCreateInput = ExecutorReviewProposalCreatePreviewInput & {
  requested_by?: string
  dry_run?: boolean
}
