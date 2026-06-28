export type ModelCapabilityProviderKind =
  | "minimax"
  | "opencode"
  | "openai"
  | "anthropic"
  | "local"
  | "ollama"
  | "lmstudio"
  | "unknown"
  | (string & {})

export type ModelCapabilityRole =
  | "commander"
  | "executor"
  | "research"
  | "wake_supervisor"
  | "unknown"

export type ModelCapabilitySource =
  | "default_registry"
  | "runtime_config"
  | "opencode_config"
  | "manual_override"
  | "unknown"

export type ModelCapability = {
  capability_id: string
  provider_kind: ModelCapabilityProviderKind
  provider_id?: string
  model_id: string
  display_name: string
  role_support: ModelCapabilityRole[]
  max_context_tokens?: number
  max_output_tokens?: number
  max_context_bytes?: number
  supports_tools: boolean | "unknown"
  supports_json_schema: boolean | "unknown"
  supports_mcp: boolean | "unknown"
  supports_long_context: boolean | "unknown"
  supports_streaming: boolean | "unknown"
  supports_local_execution: boolean | "unknown"
  default_temperature?: number
  safety_margin_ratio: number
  source: ModelCapabilitySource
  warnings: string[]
  created_at?: string
}
