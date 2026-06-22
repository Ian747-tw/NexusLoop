import type { CommandAuthorityRecord } from "../authority/command-authority-types"

export type OpenCodeResultReviewPacketStatus =
  | "ready_for_commander_review"
  | "needs_result"
  | "needs_handoff"
  | "blocked"
  | "failed"
  | "stale"
  | "unknown"

export type OpenCodeResultReviewEvidenceKind =
  | "handoff"
  | "handoff_followup"
  | "mission"
  | "mission_progress"
  | "mission_result"
  | "proposal"
  | "review"
  | "authority"
  | "handoff_readiness"
  | "process_smoke"
  | "manual_note"

export type OpenCodeResultReviewEvidence = {
  evidence_id: string
  kind: OpenCodeResultReviewEvidenceKind
  related_id?: string
  status: string
  fresh: boolean
  completed_at?: string
  age_ms?: number
  summary_preview: string
  blockers: string[]
  warnings: string[]
}

export type OpenCodeResultReviewCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeResultReviewPacket = {
  packet_id: string
  status: OpenCodeResultReviewPacketStatus
  handoff_id?: string
  followup_id?: string
  mission_id?: string
  result_id?: string
  claim_id?: string
  proposal_id?: string
  review_id?: string
  title: string
  objective_preview?: string
  executor_summary_preview?: string
  result_summary_preview?: string
  artifact_previews: string[]
  evidence: OpenCodeResultReviewEvidence[]
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeResultReviewCommand[]
  generated_at: string
  redacted_summary_preview: string
}

export type OpenCodeResultReviewPacketRecord = {
  packet_id: string
  status: OpenCodeResultReviewPacketStatus
  handoff_id?: string
  mission_id?: string
  result_id?: string
  proposal_id?: string
  generated_at: string
  summary_preview: string
}

export type OpenCodeResultReviewSummary = {
  total_considered: number
  ready_count: number
  needs_result_count: number
  failed_count: number
  blocked_count: number
  stale_count: number
  latest_handoff_id?: string
  latest_result_id?: string
  generated_at: string
}

export type OpenCodeResultReviewPacketInput = {
  handoff_id?: string
  followup_id?: string
  mission_id?: string
  result_id?: string
  proposal_id?: string
  limit?: number
  stale_after_ms?: number
  include_authority?: boolean
  include_readiness?: boolean
}

export type OpenCodeResultReviewAuthority = Pick<CommandAuthorityRecord, "slash_command" | "risk" | "gate" | "owner" | "blocked_by_default">
