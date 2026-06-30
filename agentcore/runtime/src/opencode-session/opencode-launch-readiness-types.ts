export type OpenCodeLaunchReadinessStatus = "ready" | "blocked" | "partial" | "unknown"

export type OpenCodeLaunchReadinessCheckStatus = "pass" | "warn" | "fail" | "unknown"

export type OpenCodeLaunchSurface =
  | "native_run"
  | "native_run_json"
  | "native_server_sdk"
  | "process_adapter"
  | "unknown"

export type OpenCodeLaunchReadinessSourceKind =
  | "opencode_session"
  | "instruction_pack"
  | "context_packet"
  | "context_budget"
  | "research_memory"
  | "novelty_preview"
  | "filesystem"
  | "opencode_native_audit"
  | "runtime_config"
  | "authority"
  | "unknown"

export type OpenCodeLaunchReadinessSourceRef = {
  source_kind: OpenCodeLaunchReadinessSourceKind
  source_id: string
  label?: string
  summary_preview?: string
  pointer_only: true
}

export type OpenCodeLaunchReadinessCheck = {
  check_id: string
  label: string
  status: OpenCodeLaunchReadinessCheckStatus
  summary_preview: string
  blockers: string[]
  warnings: string[]
  source_refs: OpenCodeLaunchReadinessSourceRef[]
}

export type OpenCodeLaunchReadinessCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeLaunchReadinessPreview = {
  preview_id: string
  status: OpenCodeLaunchReadinessStatus
  can_launch_in_future: boolean
  launch_performed: false
  session_id: string
  pack_id?: string
  packet_id?: string
  budget_id?: string
  source_kind?: string
  mission_id?: string
  proposal_id?: string
  review_request_id?: string
  apply_id?: string
  target_dir?: string
  instruction_files_verified: boolean
  manifest_verified: boolean
  config_verified: boolean
  context_packet_status?: string
  context_budget_status?: string
  research_memory_status?: string
  novelty_risk?: string
  selected_launch_surface: OpenCodeLaunchSurface
  checks: OpenCodeLaunchReadinessCheck[]
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeLaunchReadinessCommand[]
  generated_at: string
  redacted_summary_preview: string
  readiness_hash: string
}

export type OpenCodeLaunchReadinessSummary = {
  total_planned_sessions: number
  ready_count: number
  blocked_count: number
  partial_count: number
  generated_at: string
}

export type OpenCodeLaunchReadinessPreviewInput = {
  session_id?: string
  pack_id?: string
  provider_kind?: string
  model_id?: string
  max_context_tokens?: number
  max_context_bytes?: number
  include_research_memory?: boolean
  include_native_config?: boolean
}

export type OpenCodeLaunchReadinessSummaryInput = {
  limit?: number
}
