export type OpenCodeLaunchGateStatus =
  | "ready"
  | "blocked"
  | "dry_run"
  | "launch_started"
  | "launch_failed"
  | "launched"

export type OpenCodeLaunchAdapterKind =
  | "fake"
  | "native_run_json"
  | "process_adapter"
  | "disabled"
  | "unknown"

export type OpenCodeLaunchMode = "fresh"

export type OpenCodeLaunchCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeLaunchPreview = {
  preview_id: string
  status: "ready" | "blocked"
  can_launch: boolean
  launch_performed: false
  adapter_kind: OpenCodeLaunchAdapterKind
  launch_mode: OpenCodeLaunchMode
  session_id: string
  pack_id?: string
  readiness_hash?: string
  readiness_status?: string
  packet_id?: string
  packet_hash?: string
  budget_id?: string
  target_dir?: string
  command_preview?: string
  env_preview?: string
  instruction_files: string[]
  blockers: string[]
  warnings: string[]
  recommended_commands: OpenCodeLaunchCommand[]
  generated_at: string
  redacted_summary_preview: string
  launch_hash: string
}

export type OpenCodeLaunchResult = {
  launch_id: string
  status: "dry_run" | "launched" | "launch_started" | "launch_failed" | "blocked"
  adapter_kind: OpenCodeLaunchAdapterKind
  launch_mode: OpenCodeLaunchMode
  session_id: string
  pack_id?: string
  readiness_hash?: string
  packet_id?: string
  packet_hash?: string
  budget_id?: string
  target_dir?: string
  process_id?: number
  native_session_id?: string
  command_preview?: string
  started_at?: string
  completed_at?: string
  exit_code?: number
  error?: string
  launch_performed: boolean
  output_summary_preview?: string
  event_count?: number
  launch_hash: string
  recommended_commands: OpenCodeLaunchCommand[]
}

export type OpenCodeLaunchRecord = {
  launch_id: string
  status: OpenCodeLaunchResult["status"]
  adapter_kind: OpenCodeLaunchAdapterKind
  launch_mode: OpenCodeLaunchMode
  session_id: string
  pack_id?: string
  native_session_id?: string
  process_id?: number
  started_at: string
  completed_at?: string
  exit_code?: number
  summary_preview: string
  launch_hash: string
}

export type OpenCodeLaunchPreviewInput = {
  session_id?: string
  pack_id?: string
  readiness_hash?: string
  adapter_kind?: OpenCodeLaunchAdapterKind
  provider_kind?: string
  model_id?: string
  allow_real_launch?: boolean
  launch_mode?: OpenCodeLaunchMode | string
}

export type OpenCodeLaunchInput = OpenCodeLaunchPreviewInput & {
  dry_run?: boolean
  launched_by?: string
}
