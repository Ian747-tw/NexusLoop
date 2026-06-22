import type { OpenCodeResultReviewPacketStatus } from "../opencode/opencode-result-review-packet-types"

export type CommanderExecutorReviewStatus = "preview_ready" | "blocked" | "succeeded" | "failed"

export type CommanderExecutorReviewFindingSeverity = "info" | "warning" | "risk" | "blocker"

export type CommanderExecutorReviewDecision =
  | "accept_result"
  | "needs_followup"
  | "needs_human_review"
  | "blocked"
  | "inconclusive"

export type CommanderExecutorReviewCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type CommanderExecutorReviewFinding = {
  finding_id: string
  severity: CommanderExecutorReviewFindingSeverity
  title: string
  summary: string
  evidence_ids: string[]
  recommended_commands: CommanderExecutorReviewCommand[]
}

export type CommanderExecutorReviewPreview = {
  review_id?: string
  packet_id?: string
  packet_status?: OpenCodeResultReviewPacketStatus
  can_execute: boolean
  provider_kind: string
  provider_ready: boolean
  blockers: string[]
  warnings: string[]
  packet_summary_preview?: string
  prompt_preview?: string
  recommended_commands: CommanderExecutorReviewCommand[]
  generated_at: string
}

export type CommanderExecutorReviewResult = {
  review_id: string
  packet_id: string
  packet_status: OpenCodeResultReviewPacketStatus
  status: "succeeded" | "failed" | "blocked"
  provider_kind: string
  decision: CommanderExecutorReviewDecision
  confidence: number
  summary: string
  findings: CommanderExecutorReviewFinding[]
  evidence_ids: string[]
  recommended_commands: CommanderExecutorReviewCommand[]
  error?: string
  started_at: string
  completed_at: string
  requested_by: string
  review_hash: string
  handoff_id?: string
  mission_id?: string
  result_id?: string
  proposal_id?: string
}

export type CommanderExecutorReviewRecord = {
  review_id: string
  packet_id: string
  status: "succeeded" | "failed" | "blocked"
  decision: CommanderExecutorReviewDecision
  confidence: number
  completed_at: string
  summary_preview: string
  review_hash: string
  handoff_id?: string
  mission_id?: string
  result_id?: string
}

export type CommanderExecutorReviewInput = {
  handoff_id?: string
  followup_id?: string
  mission_id?: string
  result_id?: string
  proposal_id?: string
  packet_id?: string
  requested_by?: string
  dry_run?: boolean
  max_packet_age_ms?: number
  include_authority?: boolean
}
