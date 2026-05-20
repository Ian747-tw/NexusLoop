export type CommanderPlaybookDraftStatus =
  | "drafted"
  | "review_requested"
  | "partially_review_requested"
  | "cancelled"

export interface CommanderPlaybookDraft {
  draft_id: string
  playbook_id: string
  status: CommanderPlaybookDraftStatus
  proposed_by: string
  field_values: Record<string, string>
  proposal_ids: string[]
  bundle_id?: string
  review_ids?: string[]
  created_at: string
  updated_at: string
  cancelled_at?: string
  cancellation_reason?: string
}

export interface CommanderPlaybookDraftSummary {
  drafted_count: number
  review_requested_count: number
  partially_review_requested_count: number
  cancelled_count: number
  last_draft_id?: string
}

export interface CommanderPlaybookDraftReadiness {
  draft_id: string
  proposal_count: number
  bundle_id?: string
  review_count: number
  missing_review_count: number
  approved_review_count: number
  rejected_review_count: number
  cancelled_review_count: number
  applied_proposal_count: number
  blockers: string[]
  ready_to_apply: boolean
}

export interface CreateCommanderPlaybookDraftRecordInput {
  playbook_id: string
  proposed_by: string
  field_values: Record<string, string>
  proposal_ids: string[]
  bundle_id?: string
  review_ids?: string[]
  created_at?: string
}
