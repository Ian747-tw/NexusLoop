export type RuntimeCheckpointDriftStatus = "none" | "advanced" | "forked" | "unknown"

export type RuntimeCheckpointVerification = {
  checkpoint_id: string
  exists: boolean
  hash_ok: boolean
  cursor_ok: boolean
  event_count_at_checkpoint: number
  current_event_count: number
  checkpoint_last_event_id?: string
  current_last_event_id?: string
  new_event_count: number
  drift_status: RuntimeCheckpointDriftStatus
  blockers: string[]
  warnings: string[]
}

export type RuntimeRestoreSuggestedCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
}

export type RuntimeRestoreCommanderContext = {
  recent_cycle_ids: string[]
  recent_synthesis_ids: string[]
  proposal_ids: string[]
  review_ids: string[]
  bundle_ids: string[]
  queue_summary?: Record<string, unknown>
  warnings: string[]
}

export type RuntimeRestoreExecutorContext = {
  mission_ids: string[]
  active_mission_ids: string[]
  active_claim_ids: string[]
  result_ids: string[]
  progress_ids: string[]
  warnings: string[]
}

export type RuntimeRestoreHandoffContext = {
  handoff_ids: string[]
  active_handoff_ids: string[]
  needs_result_review_ids: string[]
  failed_handoff_ids: string[]
  warnings: string[]
}

export type RuntimeRestoreReasoningContext = {
  provider_id?: string
  provider_kind?: string
  health_status?: string
  warnings: string[]
}

export type RuntimeRestorePreview = {
  checkpoint_id: string
  can_mark_resume: boolean
  verification: RuntimeCheckpointVerification
  commander_context: RuntimeRestoreCommanderContext
  executor_context: RuntimeRestoreExecutorContext
  handoff_context: RuntimeRestoreHandoffContext
  reasoning_context: RuntimeRestoreReasoningContext
  suggested_commands: RuntimeRestoreSuggestedCommand[]
  redacted_summary_preview: string
  created_at: string
}

export type RuntimeResumeAnchor = {
  resume_id: string
  checkpoint_id: string
  checkpoint_hash: string
  marked_at: string
  marked_by: string
  event_count_at_checkpoint: number
  current_event_count: number
  checkpoint_last_event_id?: string
  current_last_event_id?: string
  drift_status: RuntimeCheckpointDriftStatus
  summary_preview: string
}

export type RuntimeRestoreInput = {
  checkpoint_id?: string
  checkpointId?: string
  marked_by?: string
  markedBy?: string
  requested_by?: string
  requestedBy?: string
}
