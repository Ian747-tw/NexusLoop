import type { RuntimeCheckpointDriftStatus, RuntimeCheckpointVerification } from "../checkpoints/runtime-restore-types"

export type WakeTriggerKind = "manual" | "startup_preview" | "external_signal"

export type WakeSuggestedCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  requires_review?: boolean
}

export type WakeResumeSection = {
  resume_id?: string
  checkpoint_id?: string
  checkpoint_hash?: string
  marked_at?: string
  drift_status?: RuntimeCheckpointDriftStatus
  warnings: string[]
}

export type WakeCommanderSection = {
  recent_cycle_ids: string[]
  recent_synthesis_ids: string[]
  proposal_ids: string[]
  review_ids: string[]
  bundle_ids: string[]
  queue_summary?: Record<string, unknown>
  warnings: string[]
}

export type WakeExecutorSection = {
  mission_ids: string[]
  active_mission_ids: string[]
  active_claim_ids: string[]
  result_ids: string[]
  progress_ids: string[]
  warnings: string[]
}

export type WakeHandoffSection = {
  handoff_ids: string[]
  active_handoff_ids: string[]
  needs_result_review_ids: string[]
  failed_handoff_ids: string[]
  followup_summary?: Record<string, unknown>
  warnings: string[]
}

export type WakeReasoningSection = {
  provider_id?: string
  provider_kind?: string
  health_status?: string
  warnings: string[]
}

export type WakeCheckpointSection = {
  checkpoint_id?: string
  checkpoint_hash?: string
  verification?: RuntimeCheckpointVerification
  warnings: string[]
}

export type WakeAssessmentSections = {
  resume?: WakeResumeSection
  commander?: WakeCommanderSection
  executor?: WakeExecutorSection
  handoff?: WakeHandoffSection
  reasoning?: WakeReasoningSection
  checkpoint?: WakeCheckpointSection
}

export type WakeAssessmentPreview = {
  wake_id?: string
  trigger_kind: WakeTriggerKind
  resume_id?: string
  checkpoint_id?: string
  allowed: boolean
  blockers: string[]
  warnings: string[]
  drift_status?: RuntimeCheckpointDriftStatus
  current_event_count: number
  checkpoint_event_count?: number
  new_event_count?: number
  reasoning_health_status?: string
  handoff_summary?: Record<string, unknown>
  commander_summary?: Record<string, unknown>
  executor_summary?: Record<string, unknown>
  suggested_commands: WakeSuggestedCommand[]
  redacted_summary_preview: string
}

export type WakeAssessment = {
  wake_id: string
  trigger_kind: WakeTriggerKind
  resume_id?: string
  checkpoint_id?: string
  checkpoint_hash?: string
  created_at: string
  requested_by: string
  dry_run?: boolean
  allowed: boolean
  blockers: string[]
  warnings: string[]
  drift_status?: RuntimeCheckpointDriftStatus
  current_event_count: number
  checkpoint_event_count?: number
  new_event_count?: number
  sections: WakeAssessmentSections
  suggested_commands: WakeSuggestedCommand[]
  assessment_hash: string
}

export type WakeAssessmentRecord = {
  wake_id: string
  trigger_kind: WakeTriggerKind
  resume_id?: string
  checkpoint_id?: string
  allowed: boolean
  drift_status?: RuntimeCheckpointDriftStatus
  created_at: string
  requested_by: string
  summary_preview: string
  assessment_hash: string
}

export type WakeAssessmentInput = {
  resume_id?: string
  resumeId?: string
  checkpoint_id?: string
  checkpointId?: string
  trigger_kind?: WakeTriggerKind
  triggerKind?: WakeTriggerKind
  requested_by?: string
  requestedBy?: string
  max_bytes?: number
  maxBytes?: number
  dry_run?: boolean
  dryRun?: boolean
}
