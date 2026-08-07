import type { CommandAuthorityRisk, CommandPhaseStatus } from "../authority/command-authority-types"
export type CommanderToolNamespace =
  | "core"
  | "authority"
  | "memory"
  | "continuity"
  | "runtime_read"
  | "opencode_read"
  | "repo_read"
  | "github_read"
  | "external_research"
  | "governance"

export type CommanderToolSideEffectClass = "none" | "internal_read" | "external_read" | "governance_intent" | "approved_external_write" | "forbidden"
export type CommanderToolTrustClass = "runtime_authoritative" | "research_projection" | "repository_content_untrusted" | "github_content_untrusted" | "external_content_untrusted" | "governance_metadata" | "unknown"
export type CommanderToolAvailability = "implemented_read_surface" | "registry_only" | "future_internal_read" | "future_external_read" | "future_governance_intent" | "blocked"
export type CommanderToolLoadPolicy = "always_loaded" | "deferred" | "never_exposed"
export type CommanderToolPhase = "general_read" | "proposal_investigation" | "mid_mission_supervision" | "result_review" | "governance_review" | "emergency_inspection"
export type CommanderToolInstructionSemantics = "none"
export type CommanderToolExecutionBackend = "runtime_service" | "filesystem_read" | "restricted_git_read" | "future_external_gateway" | "future_governance"
export type CommanderToolProcessPolicy = "none" | "fixed_git_read_only"

export type CommanderToolJsonSchemaProperty = {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object"
  description?: string
  enum?: string[]
  maxLength?: number
  minimum?: number
  maximum?: number
  items?: CommanderToolJsonSchemaProperty
  properties?: Record<string, CommanderToolJsonSchemaProperty>
  required?: string[]
  additionalProperties?: false
}

export type CommanderToolJsonSchema = {
  schema_version: "nxl-commander-tool-v1"
  type: "object"
  properties: Record<string, CommanderToolJsonSchemaProperty>
  required: string[]
  additionalProperties: false
}

export type CommanderToolSchemaMetadata = {
  input_schema_hash: string
  output_schema_hash: string
  input_schema_bytes: number
  output_schema_bytes: number
  estimated_schema_tokens: number
  schema_loaded: boolean
}

export type CommanderToolDescriptor = {
  tool_id: string
  namespace: CommanderToolNamespace
  name: string
  version: string
  description: string
  keywords: string[]
  authority_id?: string
  slash_command?: string
  runtime_command?: string
  risk: CommandAuthorityRisk
  side_effect_class: CommanderToolSideEffectClass
  trust_class: CommanderToolTrustClass
  instruction_semantics: CommanderToolInstructionSemantics
  availability: CommanderToolAvailability
  load_policy: CommanderToolLoadPolicy
  current_phase_status: CommandPhaseStatus
  allowed_phases: CommanderToolPhase[]
  requires_network: boolean
  requires_credentials: boolean
  requires_approval: boolean
  requires_run_lock: boolean
  creates_external_process: boolean
  execution_backend: CommanderToolExecutionBackend
  process_policy: CommanderToolProcessPolicy
  calls_provider: boolean
  mutates_events: boolean
  max_output_bytes: number
  timeout_ms: number
  input_schema?: CommanderToolJsonSchema
  output_schema?: CommanderToolJsonSchema
  schema_metadata: CommanderToolSchemaMetadata
  notes: string[]
  out_of_scope: string[]
}

export type CommanderToolDescriptorSummary = Omit<CommanderToolDescriptor, "input_schema" | "output_schema"> & {
  input_field_names: string[]
  output_field_names: string[]
}

export type CommanderToolNamespaceSummary = {
  namespace: CommanderToolNamespace
  title: string
  description: string
  implemented_count: number
  future_count: number
  blocked_count: number
  default_load_policy: CommanderToolLoadPolicy
  requires_network: boolean
  trust_class: CommanderToolTrustClass
  example_tool_ids: string[]
  estimated_catalog_tokens: number
}

export type CommanderToolSearchMatch = {
  tool_id: string
  namespace: CommanderToolNamespace
  name: string
  description_preview: string
  availability: CommanderToolAvailability
  risk: CommandAuthorityRisk
  side_effect_class: CommanderToolSideEffectClass
  load_policy: CommanderToolLoadPolicy
  allowed_in_phase: boolean
  score: number
  matched_fields: string[]
  schema_loaded: boolean
  input_field_names: string[]
  output_field_names: string[]
  schema_hash: string
  recommended_command: string
  descriptor?: CommanderToolDescriptor
}

export type CommanderToolSearchPreview = {
  preview_id: string
  status: "ready" | "empty" | "blocked"
  query_preview: string
  phase?: CommanderToolPhase
  namespace?: CommanderToolNamespace
  filters: Record<string, string | boolean | number>
  matches: CommanderToolSearchMatch[]
  total_matches: number
  returned_matches: number
  schema_bytes_returned: number
  estimated_schema_tokens_returned: number
  execution_enabled: false
  blockers: string[]
  warnings: string[]
  generated_at: string
  redacted_summary_preview: string
  search_hash: string
}

export type CommanderToolProfile = {
  profile_id: string
  phase: CommanderToolPhase
  status: "ready" | "blocked"
  execution_enabled: false
  allowed_namespaces: CommanderToolNamespace[]
  always_loaded_tool_ids: string[]
  deferred_tool_ids: string[]
  staged_intent_tool_ids: string[]
  unavailable_tool_ids: string[]
  forbidden_capabilities: string[]
  max_tool_calls_future: number
  max_tool_search_calls_future: number
  max_loaded_schemas: number
  max_initial_schema_tokens: number
  max_initial_schema_bytes: number
  max_cumulative_result_bytes_future: number
  max_wall_time_ms_future: number
  notes: string[]
  warnings: string[]
  generated_at: string
  profile_hash: string
  manual_internal_read_execution_enabled: boolean
  provider_tool_loop_enabled: false
  external_read_execution_enabled: false
  governance_execution_enabled: false
}

export type CommanderToolBootstrapPreview = {
  preview_id: string
  phase: CommanderToolPhase
  provider_kind: string
  model_id: string
  context_budget_id: string
  tool_schema_allocation_tokens?: number
  tool_schema_allocation_bytes?: number
  always_loaded_tools: CommanderToolDescriptor[]
  deferred_namespaces: CommanderToolNamespaceSummary[]
  deferred_tool_count: number
  initial_schema_tokens: number
  initial_schema_bytes: number
  over_budget: boolean
  omitted_core_tools: string[]
  execution_enabled: false
  manual_internal_read_execution_enabled?: boolean
  provider_tool_loop_enabled?: false
  external_read_execution_enabled?: false
  governance_execution_enabled?: false
  blockers: string[]
  warnings: string[]
  generated_at: string
  redacted_summary_preview: string
  bootstrap_hash: string
}

export type CommanderToolRegistrySummary = {
  total_tools: number
  implemented_tools: number
  future_tools: number
  blocked_tools: number
  namespace_counts: Record<string, number>
  risk_counts: Record<string, number>
  side_effect_counts: Record<string, number>
  always_loaded_count: number
  deferred_count: number
  governance_intent_count: number
  direct_external_write_count: number
  provider_call_count: number
  generated_at: string
  github_gateway?: import("./commander-github-read-types").CommanderGithubGatewayStatus
}

export type CommanderToolRegistryValidation = {
  validation_id: string
  status: "ready" | "blocked"
  descriptor_count: number
  profile_count: number
  namespace_count: number
  errors: string[]
  warnings: string[]
  invalid_tool_ids: string[]
  invalid_profile_ids: string[]
  unsafe_exposure_count: number
  authority_mismatch_count: number
  schema_violation_count: number
  generated_at: string
  redacted_summary_preview: string
  validation_hash: string
}

export type CommanderToolSearchInput = {
  query?: string
  phase?: CommanderToolPhase
  namespace?: CommanderToolNamespace
  risk?: CommandAuthorityRisk
  side_effect_class?: CommanderToolSideEffectClass
  availability?: CommanderToolAvailability
  implemented_only?: boolean
  allowed_in_phase_only?: boolean
  include_schema?: boolean
  limit?: number
}

export type CommanderToolListInput = Omit<CommanderToolSearchInput, "query" | "include_schema" | "allowed_in_phase_only"> & { limit?: number }
