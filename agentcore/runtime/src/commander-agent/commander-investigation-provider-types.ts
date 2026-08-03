import type { CommanderToolPhase } from "../commander-tools/commander-tool-types"
import type { CommanderConnectorModelTransportConfig } from "./commander-connector-transport-types"

export type CommanderInvestigationProviderConfig = CommanderConnectorModelTransportConfig & {
  provider_kind: string
  enabled_phases: CommanderToolPhase[]
  max_context_bytes: number
  max_context_tokens?: number
  max_output_tokens: number
  supports_tools: boolean | "unknown"
  supports_json_schema: boolean | "unknown"
  supports_long_context: boolean | "unknown"
  supports_local_execution: boolean | "unknown"
}

export type CommanderInvestigationProviderReadinessStatus = "disabled" | "ready" | "blocked"
export type CommanderInvestigationProviderSource = "configured_connector" | "injected_adapter" | "none"
export type CommanderInvestigationProviderDefaultToolProtocol = "native" | "json_fallback" | "unavailable"
export type CommanderRuntimeLifecycleState = "created" | "starting" | "ready" | "stopping" | "stopped"

export type CommanderInvestigationProviderReadinessCheck = {
  name: string
  ok: boolean
  severity: "info" | "warning" | "error"
  summary: string
  redacted_detail?: string
}

export type CommanderInvestigationProviderReadiness = {
  readiness_id: string
  status: CommanderInvestigationProviderReadinessStatus
  configuration_ready: boolean
  execution_ready: boolean
  provider_source: CommanderInvestigationProviderSource
  provider_id?: string
  provider_kind?: string
  connector_id?: string
  model_id?: string
  enabled_phases: CommanderToolPhase[]
  capability_id?: string
  default_tool_protocol: CommanderInvestigationProviderDefaultToolProtocol
  runtime_mode: string
  runtime_lifecycle_state: CommanderRuntimeLifecycleState
  runtime_started: boolean
  run_lock_required: boolean
  run_lock_held: boolean
  adapter_id?: string
  supports_streaming: boolean
  would_call_network: boolean
  would_append_external_api_audit: boolean
  checks: CommanderInvestigationProviderReadinessCheck[]
  blockers: string[]
  warnings: string[]
  generated_at: string
  network_called: false
  events_appended: false
  readiness_hash: string
}

export type CommanderInvestigationProviderReadinessInput = {
  phase?: CommanderToolPhase
  provider_id?: string
  provider_kind?: string
  model_id?: string
}

export type CommanderInvestigationProviderPreflightSnapshot = {
  ready: boolean
  source_kind: CommanderInvestigationProviderSource
  checks: CommanderInvestigationProviderReadinessCheck[]
  blockers: string[]
  warnings: string[]
  checked_at: string
  snapshot_hash: string
}

export type CommanderInvestigationProviderGate = {
  check(input: {
    phase: CommanderToolPhase
    provider_id: string
    provider_kind: string
    model_id: string
    before: "investigation" | "model_step"
    turn_index?: number
  }): Promise<CommanderInvestigationProviderPreflightSnapshot> | CommanderInvestigationProviderPreflightSnapshot
}

export type CommanderInvestigationProviderAuditPolicy = {
  required: boolean
  transport_kind: "external_api_connector"
  connector_id: string
} | {
  required: false
  transport_kind: "none"
}

export type CommanderInvestigationProviderAuditSummary = {
  audit_required: boolean
  transport_kind: "none" | "external_api_connector"
  connector_ids: string[]
  provider_request_count: number
  external_api_audit_event_count: number
  transport_dispatch_count?: number
  successful_audit_count: number
  failed_audit_count: number
  audit_request_ids: string[]
  audit_event_kinds: string[]
  omitted_request_id_count: number
  all_provider_requests_audited: boolean
  request_body_persisted: false
  response_body_persisted: false
  credentials_persisted: false
  warnings: string[]
}
