import type {
  OpenCodeWakeSupervisorRecommendedAction,
  OpenCodeWakeSupervisorStatus,
} from "./opencode-wake-supervisor-types"

export type OpenCodeWakeActionExecutionStatus =
  | "ready"
  | "blocked"
  | "dry_run"
  | "executed"
  | "skipped"
  | "failed"

export type OpenCodeWakeActionExecutionMode = "single_action"

export type OpenCodeWakeActionKind =
  | "none"
  | "read_latest_progress"
  | "record_watchdog"
  | "request_forced_report"
  | "create_commander_question"
  | "answer_commander_question"
  | "deliver_guidance"
  | "review_human_control"
  | "prepare_result_review"
  | "unsupported"

export type OpenCodeWakeActionEffectKind =
  | "no_effect"
  | "read_only_noop"
  | "metadata_event_appended"
  | "manual_action_required"
  | "blocked_unsupported"
  | "failed"

export type OpenCodeWakeActionExecutionEvidenceRef = {
  evidence_kind: string
  evidence_id: string
  status?: string
  summary_preview?: string
  pointer_only: true
}

export type OpenCodeWakeActionExecutionCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeWakeActionExecutionPreview = {
  preview_id: string
  status: "ready" | "blocked"
  can_execute: boolean
  execution_id: string
  session_id?: string
  launch_id?: string
  supervisor_status?: OpenCodeWakeSupervisorStatus
  recommended_action?: OpenCodeWakeSupervisorRecommendedAction
  action_kind: OpenCodeWakeActionKind
  effect_kind: OpenCodeWakeActionEffectKind
  action_execution_status_before: "not_executed"
  will_execute_metadata_write: boolean
  will_call_provider: false
  will_send_opencode_prompt: false
  will_control_process: false
  will_mutate_mission: false
  expected_event_kinds: string[]
  blocked_reason_preview?: string
  manual_action_preview?: string
  source_supervisor_hash?: string
  evidence_refs: OpenCodeWakeActionExecutionEvidenceRef[]
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeWakeActionExecutionCommand[]
  generated_at: string
  redacted_summary_preview: string
  action_hash: string
}

export type OpenCodeWakeActionExecutionResult = {
  action_execution_id: string
  status: "executed" | "skipped" | "blocked" | "dry_run" | "failed"
  execution_id: string
  session_id?: string
  launch_id?: string
  supervisor_status?: OpenCodeWakeSupervisorStatus
  recommended_action?: OpenCodeWakeSupervisorRecommendedAction
  action_kind: OpenCodeWakeActionKind
  effect_kind: OpenCodeWakeActionEffectKind
  action_execution_status_before: "not_executed"
  metadata_event_kind?: string
  metadata_record_id?: string
  metadata_result_preview?: string
  manual_action_preview?: string
  will_call_provider: false
  will_send_opencode_prompt: false
  will_control_process: false
  will_mutate_mission: false
  recorded_at: string
  recorded_by: string
  error?: string
  action_hash: string
  recommended_commands: OpenCodeWakeActionExecutionCommand[]
}

export type OpenCodeWakeActionExecutionRecord = {
  action_execution_id: string
  execution_id: string
  session_id?: string
  launch_id?: string
  recommended_action?: OpenCodeWakeSupervisorRecommendedAction
  action_kind: OpenCodeWakeActionKind
  status: OpenCodeWakeActionExecutionResult["status"]
  effect_kind: OpenCodeWakeActionEffectKind
  metadata_event_kind?: string
  metadata_record_id?: string
  recorded_at: string
  recorded_by: string
  summary_preview: string
  action_hash: string
}

export type OpenCodeWakeActionExecutionSummary = {
  total_actions: number
  executed_count: number
  skipped_count: number
  blocked_count: number
  failed_count: number
  metadata_event_count: number
  manual_action_required_count: number
  by_action_kind_counts: Record<string, number>
  latest_actions: OpenCodeWakeActionExecutionRecord[]
  generated_at: string
}

export type OpenCodeWakeActionExecutionPreviewInput = {
  execution_id?: string
  action_kind?: string
  allow_operator_handoff?: boolean
  answer?: string
  reason?: string
}

export type OpenCodeWakeActionExecutionRecordInput =
  OpenCodeWakeActionExecutionPreviewInput & {
    dry_run?: boolean
    recorded_by?: string
  }
