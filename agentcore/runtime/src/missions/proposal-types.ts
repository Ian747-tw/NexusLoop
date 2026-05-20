export type ProposalActionKind =
  | "complete_mission"
  | "fail_mission"
  | "cancel_mission"
  | "release_claim"
  | "record_progress"
  | "submit_result"
  | "operator_checkpoint"
  | "other"

export type ProposalStatus =
  | "proposed"
  | "review_requested"
  | "approved"
  | "rejected"
  | "cancelled"
  | "applied"

export interface CommanderProposal {
  proposal_id: string
  mission_id?: string
  claim_id?: string
  result_id?: string
  review_id?: string
  action_kind: ProposalActionKind
  title: string
  summary: string
  proposed_by: string
  status: ProposalStatus
  action_payload?: Record<string, unknown>
  created_at: string
  updated_at: string
  decision_at?: string
  applied_at?: string
  application_result?: string
  failure_reason?: string
}

export interface CommanderProposalInput {
  mission_id?: string
  claim_id?: string
  result_id?: string
  action_kind: ProposalActionKind
  title: string
  summary: string
  proposed_by: string
  action_payload?: Record<string, unknown>
}

export interface ProposalStatusSummary {
  proposed_count: number
  review_requested_count: number
  approved_count: number
  rejected_count: number
  cancelled_count: number
  applied_count: number
  last_proposal_id?: string
}
