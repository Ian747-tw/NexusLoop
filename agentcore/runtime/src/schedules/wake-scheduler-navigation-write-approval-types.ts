import type {
  WakeSchedulerNavigationFutureStagePolicy,
  WakeSchedulerNavigationWriteAuthorityGate,
  WakeSchedulerNavigationWriteCommand,
  WakeSchedulerNavigationWritePrerequisite,
  WakeSchedulerNavigationWriteRisk,
} from "./wake-scheduler-navigation-write-preview-types"

export type WakeSchedulerNavigationWriteApprovalStatus = "pending" | "approved" | "rejected" | "revoked" | "expired"

export type WakeSchedulerNavigationWriteReadinessStatus =
  | "ready_for_approval"
  | "blocked"
  | "needs_evidence"
  | "unsupported"
  | "high_impact_blocked"

export type WakeSchedulerNavigationWriteEvidenceKind =
  | "safe_read_run"
  | "safe_read_comparison"
  | "low_risk_write_run"
  | "low_risk_write_comparison"
  | "audit_chain"
  | "manual_note"

export interface WakeSchedulerNavigationWriteEvidence {
  evidence_id: string
  kind: WakeSchedulerNavigationWriteEvidenceKind
  related_id?: string
  command?: string
  status?: string
  completed_at?: string
  fresh: boolean
  age_ms?: number
  summary_preview: string
  blockers: string[]
  warnings: string[]
}

export interface WakeSchedulerNavigationWriteApprovalCommand extends WakeSchedulerNavigationWriteCommand {}

export interface WakeSchedulerNavigationWriteReadinessPreview {
  staged_write_id: string
  command: string
  command_name: string
  risk: WakeSchedulerNavigationWriteRisk
  authority_gate: WakeSchedulerNavigationWriteAuthorityGate
  target_kind: string
  target_id?: string
  readiness_status: WakeSchedulerNavigationWriteReadinessStatus
  can_approve: boolean
  can_execute_now: false
  blockers: string[]
  warnings: string[]
  required_evidence: WakeSchedulerNavigationWriteEvidence[]
  optional_evidence: WakeSchedulerNavigationWriteEvidence[]
  existing_approval?: WakeSchedulerNavigationWriteApprovalRecord
  recommended_commands: WakeSchedulerNavigationWriteApprovalCommand[]
  redacted_summary_preview: string
}

export interface WakeSchedulerNavigationWriteApproval {
  approval_id: string
  staged_write_id: string
  command: string
  command_name: string
  risk: WakeSchedulerNavigationWriteRisk
  authority_gate: WakeSchedulerNavigationWriteAuthorityGate
  target_kind: string
  target_id?: string
  status: WakeSchedulerNavigationWriteApprovalStatus
  approved_at?: string
  rejected_at?: string
  revoked_at?: string
  updated_at: string
  requested_by: string
  reason?: string
  evidence: WakeSchedulerNavigationWriteEvidence[]
  approval_hash: string
  expires_at?: string
  summary_preview: string
}

export interface WakeSchedulerNavigationWriteApprovalRecord {
  approval_id: string
  staged_write_id: string
  command: string
  risk: WakeSchedulerNavigationWriteRisk
  authority_gate: WakeSchedulerNavigationWriteAuthorityGate
  status: WakeSchedulerNavigationWriteApprovalStatus
  updated_at: string
  summary_preview: string
  approval_hash: string
}

export interface WakeSchedulerNavigationWriteReadinessInput {
  staged_write_id: string
  stagedWriteId?: string
  max_evidence_age_ms?: number
  maxEvidenceAgeMs?: number
}

export interface WakeSchedulerNavigationWriteApprovalInput {
  staged_write_id: string
  stagedWriteId?: string
  requested_by?: string
  requestedBy?: string
  reason?: string
  expires_at?: string
  expiresAt?: string
  max_evidence_age_ms?: number
  maxEvidenceAgeMs?: number
}

export interface WakeSchedulerNavigationWriteApprovalRejectInput {
  staged_write_id: string
  stagedWriteId?: string
  requested_by?: string
  requestedBy?: string
  reason?: string
}

export interface WakeSchedulerNavigationWriteApprovalRevokeInput {
  approval_id: string
  approvalId?: string
  requested_by?: string
  requestedBy?: string
  reason?: string
}

export interface WakeSchedulerNavigationWriteApprovalListInput {
  limit?: number
  staged_write_id?: string
  stagedWriteId?: string
  status?: WakeSchedulerNavigationWriteApprovalStatus
}

export interface WakeSchedulerNavigationWriteApprovalRuntimePolicy {
  future_stage_policy?: WakeSchedulerNavigationFutureStagePolicy
}
