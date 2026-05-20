export type CommanderProposalBundleStatus =
  | "open"
  | "review_requested"
  | "partially_approved"
  | "approved"
  | "partially_applied"
  | "applied"
  | "cancelled"

export interface CommanderProposalBundle {
  bundle_id: string
  title: string
  summary: string
  created_by: string
  status: CommanderProposalBundleStatus
  proposal_ids: string[]
  created_at: string
  updated_at: string
  cancelled_at?: string
  cancellation_reason?: string
  applied_at?: string
  failure_reason?: string
}

export interface CommanderProposalBundleSummary {
  open_count: number
  review_requested_count: number
  approved_count: number
  partially_approved_count: number
  applied_count: number
  partially_applied_count: number
  cancelled_count: number
  last_bundle_id?: string
}

export interface CommanderProposalBundleReadiness {
  bundle_id: string
  proposal_count: number
  proposed_count: number
  review_requested_count: number
  approved_count: number
  rejected_count: number
  cancelled_count: number
  applied_count: number
  blocked_count: number
  ready_to_apply: boolean
  blockers: string[]
}

export interface CommanderProposalBundleInput {
  title: string
  summary: string
  created_by: string
}
