export type CommanderQueueKind =
  | "needs_review"
  | "ready_to_apply"
  | "blocked"
  | "failed_apply"
  | "recently_applied"
  | "drafts_needing_review"
  | "bundles_needing_review"
  | "stale_open"

export type CommanderQueueTargetType = "proposal" | "bundle" | "draft" | "review" | "mission"

export type CommanderQueuePriority = "low" | "normal" | "high"

export interface CommanderQueueItem {
  queue: CommanderQueueKind
  target_type: CommanderQueueTargetType
  target_id: string
  title: string
  summary: string
  status: string
  priority?: CommanderQueuePriority
  related_ids: Record<string, string[]>
  blockers?: string[]
  created_at?: string
  updated_at?: string
}

export interface CommanderQueueSummary {
  needs_review_count: number
  ready_to_apply_count: number
  blocked_count: number
  failed_apply_count: number
  recently_applied_count: number
  drafts_needing_review_count: number
  bundles_needing_review_count: number
  stale_open_count: number
  last_updated_at?: string
}

export interface CommanderQueueResult {
  queue: CommanderQueueKind
  items: CommanderQueueItem[]
  total_considered: number
  limit: number
}

export interface CommanderQueueOptions {
  limit?: number
  staleAfterMs?: number
}
