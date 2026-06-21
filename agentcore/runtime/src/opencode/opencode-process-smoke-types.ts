export type OpenCodeProcessSmokeStatus = "not_configured" | "blocked" | "ready" | "succeeded" | "failed" | "skipped"

export type OpenCodeProcessSmokeCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type OpenCodeProcessSmokePreview = {
  smoke_id?: string
  status: OpenCodeProcessSmokeStatus
  can_execute: boolean
  adapter_kind?: string
  project_dir: string
  binary_path?: string
  binary_detected: boolean
  opt_in_required: boolean
  opt_in_present: boolean
  timeout_ms: number
  blockers: string[]
  warnings: string[]
  redacted_summary_preview: string
  recommended_commands: OpenCodeProcessSmokeCommand[]
}

export type OpenCodeProcessSmokeResult = {
  smoke_id: string
  status: "succeeded" | "failed" | "blocked" | "skipped"
  adapter_kind?: string
  project_dir: string
  binary_path?: string
  started_at: string
  completed_at: string
  duration_ms?: number
  exit_code?: number
  signal?: string
  stdout_preview?: string
  stderr_preview?: string
  diagnostics: string[]
  error?: string
  requested_by: string
  smoke_hash: string
}

export type OpenCodeProcessSmokeRecord = {
  smoke_id: string
  status: "succeeded" | "failed" | "blocked" | "skipped"
  adapter_kind?: string
  completed_at: string
  duration_ms?: number
  exit_code?: number
  summary_preview: string
  smoke_hash: string
}

export type OpenCodeProcessSmokeExecuteInput = {
  requested_by?: string
  timeout_ms?: number
  dry_run?: boolean
}
