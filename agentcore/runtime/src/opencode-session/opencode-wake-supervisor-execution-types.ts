import type {
  OpenCodeWakeSupervisorRecommendedAction,
  OpenCodeWakeSupervisorStatus,
} from "./opencode-wake-supervisor-types"

export type OpenCodeWakeSupervisorExecutionStatus =
  | "ready"
  | "blocked"
  | "dry_run"
  | "recorded"
  | "failed"

export type OpenCodeWakeSupervisorExecutionMode =
  | "single_session"
  | "batch_active_sessions"

export type OpenCodeWakeSupervisorActionExecutionStatus = "not_executed"

export type OpenCodeWakeSupervisorExecutionEvidenceRef = {
  evidence_kind: string
  evidence_id: string
  status?: string
  summary_preview?: string
  pointer_only: true
}

export type OpenCodeWakeSupervisorExecutionCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeWakeSupervisorExecutionPreview = {
  preview_id: string
  status: "ready" | "blocked" | "partial"
  can_record: boolean
  execution_mode: OpenCodeWakeSupervisorExecutionMode
  session_id?: string
  launch_id?: string
  supervisor_preview_id?: string
  supervisor_hash?: string
  supervisor_status?: OpenCodeWakeSupervisorStatus
  recommended_action?: OpenCodeWakeSupervisorRecommendedAction
  action_execution_status: OpenCodeWakeSupervisorActionExecutionStatus
  recommended_commands_preview: OpenCodeWakeSupervisorExecutionCommand[]
  evidence_refs: OpenCodeWakeSupervisorExecutionEvidenceRef[]
  context_section_count: number
  blockers: string[]
  warnings: string[]
  generated_at: string
  redacted_summary_preview: string
  execution_hash: string
}

export type OpenCodeWakeSupervisorExecutionResult = {
  execution_id: string
  status: "recorded" | "blocked" | "dry_run" | "failed"
  execution_mode: OpenCodeWakeSupervisorExecutionMode
  session_id?: string
  launch_id?: string
  supervisor_preview_id?: string
  supervisor_hash?: string
  supervisor_status?: OpenCodeWakeSupervisorStatus
  recommended_action?: OpenCodeWakeSupervisorRecommendedAction
  action_execution_status: OpenCodeWakeSupervisorActionExecutionStatus
  recommended_commands_preview: OpenCodeWakeSupervisorExecutionCommand[]
  evidence_refs: OpenCodeWakeSupervisorExecutionEvidenceRef[]
  context_section_count: number
  recorded_at: string
  recorded_by: string
  error?: string
  execution_hash: string
  recommended_commands: OpenCodeWakeSupervisorExecutionCommand[]
}

export type OpenCodeWakeSupervisorExecutionRecord = {
  execution_id: string
  execution_mode: OpenCodeWakeSupervisorExecutionMode
  session_id?: string
  launch_id?: string
  supervisor_status?: OpenCodeWakeSupervisorStatus
  recommended_action?: OpenCodeWakeSupervisorRecommendedAction
  action_execution_status: OpenCodeWakeSupervisorActionExecutionStatus
  recorded_at: string
  recorded_by: string
  summary_preview: string
  execution_hash: string
}

export type OpenCodeWakeSupervisorBatchPreview = {
  preview_id: string
  status: "ready" | "blocked" | "partial"
  can_record: boolean
  execution_mode: "batch_active_sessions"
  total_candidate_sessions: number
  included_session_count: number
  skipped_session_count: number
  session_previews: OpenCodeWakeSupervisorExecutionPreview[]
  blockers: string[]
  warnings: string[]
  generated_at: string
  redacted_summary_preview: string
  execution_hash: string
}

export type OpenCodeWakeSupervisorBatchResult = {
  batch_id: string
  status: "recorded" | "blocked" | "dry_run" | "failed"
  execution_mode: "batch_active_sessions"
  total_candidate_sessions: number
  recorded_execution_count: number
  skipped_session_count: number
  execution_records: OpenCodeWakeSupervisorExecutionRecord[]
  action_execution_status: OpenCodeWakeSupervisorActionExecutionStatus
  recorded_at: string
  recorded_by: string
  error?: string
  batch_hash: string
  recommended_commands: OpenCodeWakeSupervisorExecutionCommand[]
}

export type OpenCodeWakeSupervisorExecutionSummary = {
  total_executions: number
  session_count: number
  batch_count: number
  healthy_count: number
  watch_count: number
  needs_report_count: number
  needs_commander_answer_count: number
  guidance_pending_delivery_count: number
  human_attention_count: number
  timed_out_count: number
  stale_count: number
  blocked_count: number
  action_executed_count: 0
  latest_executions: OpenCodeWakeSupervisorExecutionRecord[]
  generated_at: string
}

export type OpenCodeWakeSupervisorExecutionPreviewInput = {
  session_id?: string
  launch_id?: string
  include_research_memory?: boolean
  include_context_packet?: boolean
  include_human_controls?: boolean
  include_guidance_delivery?: boolean
  limit_evidence?: number
}

export type OpenCodeWakeSupervisorExecutionRecordInput =
  OpenCodeWakeSupervisorExecutionPreviewInput & {
    dry_run?: boolean
    recorded_by?: string
  }

export type OpenCodeWakeSupervisorBatchPreviewInput = {
  limit?: number
  status_filter?: string
  include_research_memory?: boolean
  include_human_controls?: boolean
  include_guidance_delivery?: boolean
  limit_evidence?: number
}

export type OpenCodeWakeSupervisorBatchRecordInput =
  OpenCodeWakeSupervisorBatchPreviewInput & {
    dry_run?: boolean
    recorded_by?: string
  }
