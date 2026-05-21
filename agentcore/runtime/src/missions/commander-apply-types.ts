export type CommanderApplyTargetType = "proposal" | "bundle" | "draft"

export interface CommanderApplyTarget {
  target_type: CommanderApplyTargetType
  target_id: string
}

export interface CommanderApplyPreview {
  target_type: CommanderApplyTargetType
  target_id: string
  ready_to_apply: boolean
  proposal_ids: string[]
  bundle_id?: string
  draft_id?: string
  approved_count: number
  applied_count: number
  blocked_count: number
  blockers: string[]
  apply_mode: "single" | "bundle" | "draft_bundle" | "draft_proposals"
  would_apply: string[]
  would_skip: string[]
}

export interface CommanderApplyResult {
  target_type: CommanderApplyTargetType
  target_id: string
  applied: boolean
  applied_proposal_ids: string[]
  skipped_proposal_ids: string[]
  result_summary: string
  created_at: string
}

export interface CommanderApplyOptions {
  allow_partial?: boolean
  dry_run?: boolean
}
