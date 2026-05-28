export type OpenCodeHandoffFollowupStatus =
  | "sent"
  | "claimed"
  | "running"
  | "result_submitted"
  | "completed"
  | "failed"
  | "cancelled"
  | "handoff_failed"
  | "blocked"
  | "unknown"

export type OpenCodeHandoffFollowupQueueKind =
  | "active"
  | "needs_result_review"
  | "completed"
  | "failed"
  | "blocked"
  | "stale"

export interface OpenCodeHandoffFollowupCommand {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  requires_review?: boolean
}

export interface OpenCodeHandoffFollowup {
  handoff_id: string
  proposal_id: string
  review_id?: string
  mission_id?: string
  intent_id?: string
  followup_status: OpenCodeHandoffFollowupStatus
  handoff_sent: boolean
  proposal_status?: string
  review_status?: string
  mission_status?: string
  active_claim_id?: string
  latest_progress_id?: string
  latest_result_id?: string
  result_count: number
  progress_count: number
  blockers: string[]
  suggested_commands: OpenCodeHandoffFollowupCommand[]
  source_cycle_id?: string
  source_synthesis_id?: string
  evidence_ids: string[]
  updated_at?: string
}

export interface OpenCodeHandoffFollowupSummary {
  sent_count: number
  running_count: number
  result_submitted_count: number
  completed_count: number
  failed_count: number
  blocked_count: number
  stale_count: number
  last_handoff_id?: string
}

export interface OpenCodeHandoffFollowupQueue {
  queue: OpenCodeHandoffFollowupQueueKind
  items: OpenCodeHandoffFollowup[]
  total_considered: number
  limit: number
}
