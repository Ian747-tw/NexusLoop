export type MiniMaxLiveValidationStatus = "not_configured" | "blocked" | "ready" | "succeeded" | "failed" | "skipped"

export type MiniMaxLiveValidationSurface =
  | "commander_executor_review"
  | "research_synthesis"
  | "commander_cycle"

export type MiniMaxLiveValidationCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type MiniMaxLiveValidationPreview = {
  validation_id?: string
  status: MiniMaxLiveValidationStatus
  can_execute: boolean
  provider_kind: string
  provider_id: string
  connector_id?: string
  model?: string
  enabled_surfaces: MiniMaxLiveValidationSurface[]
  requested_surfaces: MiniMaxLiveValidationSurface[]
  opt_in_required: true
  opt_in_present: boolean
  timeout_ms: number
  blockers: string[]
  warnings: string[]
  redacted_summary_preview: string
  recommended_commands: MiniMaxLiveValidationCommand[]
  generated_at: string
}

export type MiniMaxLiveValidationSurfaceResult = {
  surface: MiniMaxLiveValidationSurface
  status: "succeeded" | "failed" | "blocked" | "skipped"
  ok: boolean
  parsed: boolean
  request_id?: string
  summary_preview?: string
  error?: string
  duration_ms?: number
  schema_version?: string
}

export type MiniMaxLiveValidationResult = {
  validation_id: string
  status: "succeeded" | "failed" | "blocked" | "skipped"
  provider_kind: string
  provider_id: string
  connector_id?: string
  model?: string
  surfaces: MiniMaxLiveValidationSurfaceResult[]
  started_at: string
  completed_at: string
  duration_ms?: number
  requested_by: string
  validation_hash: string
  diagnostics: string[]
  error?: string
}

export type MiniMaxLiveValidationRecord = {
  validation_id: string
  status: "succeeded" | "failed" | "blocked" | "skipped"
  provider_id: string
  model?: string
  completed_at: string
  surface_count: number
  succeeded_count: number
  failed_count: number
  summary_preview: string
  validation_hash: string
}

export type MiniMaxLiveValidationInput = {
  surfaces?: MiniMaxLiveValidationSurface[]
  requested_by?: string
  timeout_ms?: number
  dry_run?: boolean
}
