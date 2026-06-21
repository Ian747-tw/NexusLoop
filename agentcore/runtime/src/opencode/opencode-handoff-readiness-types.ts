import type { CommandAuthorityRecord } from "../authority/command-authority-types"
import type { OpenCodeProcessSmokeRecord } from "./opencode-process-smoke-types"

export type OpenCodeHandoffReadinessStatus = "ready" | "blocked" | "needs_review" | "needs_smoke" | "not_configured" | "unknown"

export type OpenCodeHandoffReadinessEvidenceKind =
  | "handoff_preview"
  | "process_smoke"
  | "authority_record"
  | "proposal"
  | "review"
  | "mission"
  | "handoff_followup"
  | "manual_note"

export type OpenCodeHandoffReadinessEvidence = {
  evidence_id: string
  kind: OpenCodeHandoffReadinessEvidenceKind
  related_id?: string
  status: string
  fresh: boolean
  completed_at?: string
  age_ms?: number
  summary_preview: string
  blockers: string[]
  warnings: string[]
}

export type OpenCodeHandoffReadinessCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeHandoffReadinessPreview = {
  readiness_id: string
  status: OpenCodeHandoffReadinessStatus
  can_execute_now: false
  proposal_id?: string
  review_id?: string
  mission_id?: string
  handoff_id?: string
  authority: Pick<CommandAuthorityRecord, "slash_command" | "risk" | "gate" | "owner" | "blocked_by_default"> & {
    command: string
  }
  latest_smoke?: OpenCodeProcessSmokeRecord
  handoff_preview_summary?: string
  required_evidence: OpenCodeHandoffReadinessEvidence[]
  optional_evidence: OpenCodeHandoffReadinessEvidence[]
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeHandoffReadinessCommand[]
  generated_at: string
  redacted_summary_preview: string
}

export type OpenCodeHandoffReadinessSummary = {
  total_considered: number
  ready_count: number
  blocked_count: number
  needs_smoke_count: number
  needs_review_count: number
  latest_smoke_status?: string
  latest_handoff_status?: string
  generated_at: string
}

export type OpenCodeHandoffReadinessInput = {
  proposal_id?: string
  review_id?: string
  mission_id?: string
  handoff_id?: string
  command?: string
  require_recent_smoke?: boolean
  max_smoke_age_ms?: number
  include_authority?: boolean
}
