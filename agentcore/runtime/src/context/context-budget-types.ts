import type { ModelCapability, ModelCapabilityProviderKind, ModelCapabilityRole } from "./model-capability-types"

export type ContextBudgetPurpose =
  | "commander_research_decision"
  | "commander_executor_review"
  | "opencode_executor_session"
  | "wake_supervisor"
  | "research_retrieval"
  | "open_question_answer"
  | "unknown"

export type ContextBudgetSection =
  | "role_kernel"
  | "approved_spec"
  | "mission_state"
  | "research_memory"
  | "external_research"
  | "active_sessions"
  | "executor_progress"
  | "commander_guidance"
  | "human_interventions"
  | "recent_deltas"
  | "tool_or_mcp_schema"
  | "artifact_summaries"
  | "raw_logs"
  | "reserved_output"
  | "safety_margin"

export type ContextBudgetAllocation = {
  section: ContextBudgetSection
  max_tokens?: number
  max_bytes?: number
  priority: "required" | "high" | "medium" | "low" | "excluded"
  inclusion_policy: "always" | "if_relevant" | "pointer_only" | "excluded_by_default"
  notes?: string
}

export type ContextBudgetProfile = {
  budget_id: string
  purpose: ContextBudgetPurpose
  provider_kind: ModelCapabilityProviderKind
  model_id: string
  session_id?: string
  max_context_tokens?: number
  max_context_bytes?: number
  max_output_tokens?: number
  safety_margin_tokens?: number
  safety_margin_bytes?: number
  allocations: ContextBudgetAllocation[]
  warnings: string[]
  generated_at: string
}

export type ContextBudgetCommand = {
  label: string
  command: string
  command_type: "read" | "write"
  requires_active_runtime?: boolean
  notes?: string
}

export type ContextBudgetPreview = {
  preview_id: string
  purpose: ContextBudgetPurpose
  role: ModelCapabilityRole
  capability?: ModelCapability
  session_id?: string
  session_max_context_bytes?: number
  budget: ContextBudgetProfile
  blockers: string[]
  warnings: string[]
  recommended_commands: ContextBudgetCommand[]
  generated_at: string
  redacted_summary_preview: string
}

export type ContextBudgetSummary = {
  total_capabilities: number
  known_context_count: number
  unknown_context_count: number
  local_model_count: number
  cloud_model_count: number
  long_context_count: number
  generated_at: string
}

export type ContextBudgetPreviewInput = {
  purpose?: ContextBudgetPurpose | string
  role?: ModelCapabilityRole | string
  provider_kind?: ModelCapabilityProviderKind | string
  provider_id?: string
  model_id?: string
  session_id?: string
  max_context_tokens?: number
  max_context_bytes?: number
}
