export type OpenCodeHumanControlKind =
  | "pause_request"
  | "resume_request"
  | "stop_request"
  | "correction"
  | "override"
  | "force_report"
  | "priority_change"
  | "note"
  | "escalation"
  | "unknown"

export type OpenCodeHumanControlStatus = "ready" | "blocked" | "dry_run" | "recorded" | "failed"

export type OpenCodeHumanControlProjectionState =
  | "none"
  | "pause_requested"
  | "resume_requested"
  | "stop_requested"
  | "correction_pending"
  | "override_pending"
  | "report_requested"
  | "escalated"
  | "noted"

export type OpenCodeHumanControlUrgency = "low" | "normal" | "high" | "urgent"

export type OpenCodeHumanControlCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeHumanControlPreview = {
  preview_id: string
  status: "ready" | "blocked"
  can_record: boolean
  session_id: string
  launch_id?: string
  control_kind: OpenCodeHumanControlKind
  projected_state_after: OpenCodeHumanControlProjectionState
  urgency: OpenCodeHumanControlUrgency
  human_note_preview?: string
  correction_preview?: string
  override_preview?: string
  reason_preview?: string
  linked_progress_id?: string
  linked_watchdog_id?: string
  linked_forced_report_request_id?: string
  linked_question_id?: string
  linked_guidance_id?: string
  linked_delivery_id?: string
  process_control_performed: false
  open_code_prompt_sent: false
  mission_mutated: false
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeHumanControlCommand[]
  generated_at: string
  redacted_summary_preview: string
  control_hash: string
}

export type OpenCodeHumanControlRecord = {
  control_id: string
  session_id: string
  launch_id?: string
  control_kind: OpenCodeHumanControlKind
  projected_state_after: OpenCodeHumanControlProjectionState
  urgency: OpenCodeHumanControlUrgency
  human_note_preview?: string
  recorded_at: string
  recorded_by: string
  linked_progress_id?: string
  linked_watchdog_id?: string
  linked_forced_report_request_id?: string
  linked_question_id?: string
  linked_guidance_id?: string
  linked_delivery_id?: string
  process_control_performed: false
  open_code_prompt_sent: false
  mission_mutated: false
  control_hash: string
}

export type OpenCodeHumanControlResult = {
  control_id: string
  status: "recorded" | "blocked" | "dry_run" | "failed"
  session_id: string
  launch_id?: string
  control_kind: OpenCodeHumanControlKind
  projected_state_after: OpenCodeHumanControlProjectionState
  urgency: OpenCodeHumanControlUrgency
  human_note_preview?: string
  correction_preview?: string
  override_preview?: string
  reason_preview?: string
  linked_progress_id?: string
  linked_watchdog_id?: string
  linked_forced_report_request_id?: string
  linked_question_id?: string
  linked_guidance_id?: string
  linked_delivery_id?: string
  process_control_performed: false
  open_code_prompt_sent: false
  mission_mutated: false
  recorded_at: string
  recorded_by: string
  error?: string
  control_hash: string
  recommended_commands: OpenCodeHumanControlCommand[]
}

export type OpenCodeHumanControlSummary = {
  total_controls: number
  session_count: number
  pause_requested_count: number
  stop_requested_count: number
  correction_pending_count: number
  override_pending_count: number
  report_requested_count: number
  escalation_count: number
  urgent_count: number
  latest_controls: OpenCodeHumanControlRecord[]
  generated_at: string
}

export type OpenCodeHumanControlPreviewInput = {
  session_id?: string
  launch_id?: string
  control_kind?: OpenCodeHumanControlKind | string
  urgency?: OpenCodeHumanControlUrgency | string
  human_note?: string
  correction?: string
  override?: string
  reason?: string
  progress_id?: string
  watchdog_id?: string
  forced_report_request_id?: string
  question_id?: string
  guidance_id?: string
  delivery_id?: string
}

export type OpenCodeHumanControlRecordInput = OpenCodeHumanControlPreviewInput & {
  dry_run?: boolean
  recorded_by?: string
}
