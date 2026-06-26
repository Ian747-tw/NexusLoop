import type { ReasoningProviderKind, ReasoningProviderSurface } from "./reasoning-provider-config"

export type ReasoningProviderHealthStatus = "ok" | "degraded" | "blocked"
export type ReasoningProviderHealthCheckSeverity = "info" | "warning" | "error"

export interface ReasoningProviderHealthCheck {
  name: string
  ok: boolean
  severity: ReasoningProviderHealthCheckSeverity
  summary: string
  redacted_detail?: string
}

export interface ReasoningProviderHealth {
  provider_id: string
  kind: ReasoningProviderKind
  status: ReasoningProviderHealthStatus
  enabled_for: ReasoningProviderSurface[]
  connector_id?: string
  model?: string
  max_input_bytes: number
  max_output_bytes: number
  timeout_ms?: number
  checks: ReasoningProviderHealthCheck[]
  last_checked_at: string
}

export interface ReasoningProviderSmokePreview {
  provider_id: string
  kind: ReasoningProviderKind
  surface: ReasoningProviderSurface
  would_call_network: boolean
  connector_id?: string
  model?: string
  prompt_bytes: number
  max_output_bytes: number
  blockers: string[]
  redacted_request_preview: string
}

export interface ReasoningProviderSmokeResult {
  provider_id: string
  kind: ReasoningProviderKind
  surface: ReasoningProviderSurface
  ok: boolean
  dry_run: boolean
  connector_id?: string
  model?: string
  request_id?: string
  parsed: boolean
  summary: string
  error?: string
  created_at: string
}

export interface ReasoningProviderSmokeInput {
  surface?: ReasoningProviderSurface | "research" | "cycle"
  dry_run?: boolean
  requested_by?: string
  persist_event?: boolean
  require_real_smoke_gate?: boolean
  persist_external_api_audit?: boolean
}
