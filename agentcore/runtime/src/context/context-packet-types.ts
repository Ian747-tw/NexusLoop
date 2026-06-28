import type { ContextBudgetAllocation, ContextBudgetPurpose } from "./context-budget-types"
import type { ModelCapabilityProviderKind, ModelCapabilityRole } from "./model-capability-types"

export type ContextPacketRole =
  | "commander"
  | "executor"
  | "wake_supervisor"
  | "research"
  | "unknown"

export type ContextPacketPurpose = ContextBudgetPurpose

export type ContextPacketSectionStatus =
  | "included"
  | "pointer_only"
  | "omitted"
  | "missing"
  | "excluded"

export type ContextPacketSourceKind =
  | "event"
  | "spec"
  | "mission"
  | "proposal"
  | "review"
  | "apply"
  | "opencode_session"
  | "research_result"
  | "artifact"
  | "checkpoint"
  | "human_intervention"
  | "external_source"
  | "model_capability"
  | "budget"
  | "unknown"

export type ContextPacketSourceRef = {
  source_kind: ContextPacketSourceKind
  source_id: string
  label?: string
  summary_preview?: string
  event_kind?: string
  pointer_only: boolean
}

export type ContextPacketSection = {
  section: string
  status: ContextPacketSectionStatus
  priority: ContextBudgetAllocation["priority"]
  inclusion_policy: ContextBudgetAllocation["inclusion_policy"]
  max_tokens?: number
  max_bytes?: number
  estimated_tokens?: number
  estimated_bytes?: number
  summary_preview: string
  source_refs: ContextPacketSourceRef[]
  omitted_reason?: string
  warnings: string[]
}

export type ContextPacketBudgetSummary = {
  max_context_tokens?: number
  max_context_bytes?: number
  max_output_tokens?: number
  safety_margin_tokens?: number
  safety_margin_bytes?: number
  estimated_input_tokens?: number
  estimated_input_bytes?: number
  over_budget: boolean
}

export type ContextPacketCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type ContextPacketPreview = {
  packet_id: string
  role: ContextPacketRole
  purpose: ContextPacketPurpose
  budget_id: string
  provider_kind?: ModelCapabilityProviderKind
  model_id?: string
  session_id?: string
  mission_id?: string
  proposal_id?: string
  review_request_id?: string
  apply_id?: string
  packet_status: "ready" | "blocked" | "partial" | "unknown"
  can_compile_final_prompt: false
  sections: ContextPacketSection[]
  included_source_refs: ContextPacketSourceRef[]
  omitted_source_refs: ContextPacketSourceRef[]
  budget_summary: ContextPacketBudgetSummary
  blockers: string[]
  warnings: string[]
  recommended_commands: ContextPacketCommand[]
  generated_at: string
  redacted_summary_preview: string
  packet_hash: string
}

export type ContextPacketSummary = {
  supported_purposes: ContextPacketPurpose[]
  supported_roles: ContextPacketRole[]
  generated_at: string
}

export type ContextPacketPreviewInput = {
  purpose?: ContextPacketPurpose | string
  role?: ContextPacketRole | ModelCapabilityRole | string
  provider_kind?: ModelCapabilityProviderKind | string
  provider_id?: string
  model_id?: string
  session_id?: string
  mission_id?: string
  proposal_id?: string
  review_request_id?: string
  apply_id?: string
  max_context_tokens?: number
  max_context_bytes?: number
  include_authority?: boolean
}
