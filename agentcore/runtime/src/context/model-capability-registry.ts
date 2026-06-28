import { createHash } from "node:crypto"
import { redactText } from "../security/redaction"
import type { ReasoningProviderConfig } from "../reasoning/reasoning-provider-config"
import type { ModelCapability, ModelCapabilityProviderKind, ModelCapabilityRole } from "./model-capability-types"

const NOW = "1970-01-01T00:00:00.000Z"
const DEFAULT_SAFETY_MARGIN = 0.18

export type ModelCapabilityRegistryOptions = {
  reasoningProviderConfig?: ReasoningProviderConfig
}

export class ModelCapabilityRegistry {
  private readonly capabilities: ModelCapability[]

  constructor(options: ModelCapabilityRegistryOptions = {}) {
    this.capabilities = [
      ...defaultCapabilities(),
      ...runtimeConfigCapabilities(options.reasoningProviderConfig),
    ]
  }

  list(input: { provider_kind?: string; role?: string; limit?: number } = {}): ModelCapability[] {
    const limit = clampInteger(input.limit, 20, 1, 100)
    return redactStringsOnly(this.capabilities
      .filter((item) => !input.provider_kind || item.provider_kind === input.provider_kind)
      .filter((item) => !input.role || item.role_support.includes(input.role as ModelCapabilityRole))
      .slice(0, limit))
  }

  get(input: { capability_id?: string; provider_kind?: string; model_id?: string } = {}): ModelCapability {
    const capabilityId = optional(input.capability_id)
    if (capabilityId) {
      const found = this.capabilities.find((item) => item.capability_id === capabilityId)
      if (found) return redactStringsOnly(found)
      return fallbackCapability({ provider_kind: "unknown", model_id: capabilityId })
    }
    const providerKind = optional(input.provider_kind) ?? "unknown"
    const modelId = optional(input.model_id) ?? "unknown"
    const found = this.capabilities.find((item) => item.provider_kind === providerKind && item.model_id === modelId)
    return redactStringsOnly(found ?? fallbackCapability({ provider_kind: providerKind, model_id: modelId }))
  }

  summary(now = new Date()): {
    total_capabilities: number
    known_context_count: number
    unknown_context_count: number
    local_model_count: number
    cloud_model_count: number
    long_context_count: number
    generated_at: string
  } {
    const localKinds = new Set(["local", "ollama", "lmstudio"])
    return redactStringsOnly({
      total_capabilities: this.capabilities.length,
      known_context_count: this.capabilities.filter((item) => item.max_context_tokens || item.max_context_bytes).length,
      unknown_context_count: this.capabilities.filter((item) => !item.max_context_tokens && !item.max_context_bytes).length,
      local_model_count: this.capabilities.filter((item) => localKinds.has(String(item.provider_kind))).length,
      cloud_model_count: this.capabilities.filter((item) => !localKinds.has(String(item.provider_kind))).length,
      long_context_count: this.capabilities.filter((item) => item.supports_long_context === true).length,
      generated_at: now.toISOString(),
    })
  }
}

export function defaultCapabilities(): ModelCapability[] {
  return [
    {
      capability_id: "default-minimax-validation",
      provider_kind: "minimax",
      provider_id: "minimax",
      model_id: "minimax-validation-default",
      display_name: "MiniMax validation placeholder",
      role_support: ["commander", "research"],
      max_context_bytes: 32_768,
      max_output_tokens: 4096,
      supports_tools: "unknown",
      supports_json_schema: "unknown",
      supports_mcp: false,
      supports_long_context: "unknown",
      supports_streaming: "unknown",
      supports_local_execution: false,
      safety_margin_ratio: DEFAULT_SAFETY_MARGIN,
      source: "default_registry",
      warnings: ["MiniMax is a validation provider profile, not a product-wide model assumption"],
      created_at: NOW,
    },
    {
      capability_id: "default-opencode-executor-unknown",
      provider_kind: "opencode",
      provider_id: "opencode",
      model_id: "opencode-default",
      display_name: "OpenCode executor default model",
      role_support: ["executor"],
      supports_tools: true,
      supports_json_schema: "unknown",
      supports_mcp: "unknown",
      supports_long_context: "unknown",
      supports_streaming: true,
      supports_local_execution: "unknown",
      safety_margin_ratio: 0.2,
      source: "default_registry",
      warnings: ["unknown context window; using conservative budget"],
      created_at: NOW,
    },
    {
      capability_id: "default-local-small",
      provider_kind: "local",
      model_id: "local-small",
      display_name: "Generic local small model",
      role_support: ["commander", "executor", "research"],
      max_context_tokens: 4096,
      max_output_tokens: 1024,
      max_context_bytes: 16_384,
      supports_tools: "unknown",
      supports_json_schema: "unknown",
      supports_mcp: false,
      supports_long_context: false,
      supports_streaming: "unknown",
      supports_local_execution: true,
      safety_margin_ratio: 0.25,
      source: "default_registry",
      warnings: ["generic local profile; verify concrete model before launch"],
      created_at: NOW,
    },
    {
      capability_id: "default-local-medium",
      provider_kind: "local",
      model_id: "local-medium",
      display_name: "Generic local medium model",
      role_support: ["commander", "executor", "research", "wake_supervisor"],
      max_context_tokens: 16_384,
      max_output_tokens: 2048,
      max_context_bytes: 65_536,
      supports_tools: "unknown",
      supports_json_schema: "unknown",
      supports_mcp: false,
      supports_long_context: false,
      supports_streaming: "unknown",
      supports_local_execution: true,
      safety_margin_ratio: 0.22,
      source: "default_registry",
      warnings: ["generic local profile; verify concrete model before launch"],
      created_at: NOW,
    },
    {
      capability_id: "default-cloud-long-context",
      provider_kind: "unknown",
      model_id: "cloud-long-context",
      display_name: "Generic long-context cloud model",
      role_support: ["commander", "executor", "research", "wake_supervisor"],
      max_context_tokens: 128_000,
      max_output_tokens: 8192,
      max_context_bytes: 512_000,
      supports_tools: "unknown",
      supports_json_schema: "unknown",
      supports_mcp: "unknown",
      supports_long_context: true,
      supports_streaming: "unknown",
      supports_local_execution: false,
      safety_margin_ratio: 0.15,
      source: "default_registry",
      warnings: ["generic cloud profile; do not assume provider-specific behavior"],
      created_at: NOW,
    },
    fallbackCapability({ provider_kind: "unknown", model_id: "unknown" }),
  ]
}

function runtimeConfigCapabilities(config?: ReasoningProviderConfig): ModelCapability[] {
  if (!config || config.kind === "fake") return []
  const providerKind = normalizeProviderKind(config.kind)
  const modelId = optional(config.model ?? (config as { model_id?: string }).model_id) ?? `${providerKind}-runtime-config`
  return [{
    capability_id: `runtime-${hash(`${providerKind}:${modelId}`).slice(0, 16)}`,
    provider_kind: providerKind,
    provider_id: optional((config as { connector_id?: string }).connector_id) ?? providerKind,
    model_id: modelId,
    display_name: `${providerKind} runtime config model`,
    role_support: ["commander", "research"],
    max_context_bytes: optionalNumber((config as { max_input_bytes?: number }).max_input_bytes),
    max_output_tokens: undefined,
    supports_tools: "unknown",
    supports_json_schema: "unknown",
    supports_mcp: false,
    supports_long_context: "unknown",
    supports_streaming: "unknown",
    supports_local_execution: false,
    safety_margin_ratio: DEFAULT_SAFETY_MARGIN,
    source: "runtime_config",
    warnings: ["runtime config capability is metadata only; no provider call was made"],
    created_at: NOW,
  }]
}

export function fallbackCapability(input: { provider_kind?: string; model_id?: string }): ModelCapability {
  const providerKind = normalizeProviderKind(input.provider_kind ?? "unknown")
  const modelId = redactText(optional(input.model_id) ?? "unknown")
  return {
    capability_id: `fallback-${hash(`${providerKind}:${modelId}`).slice(0, 16)}`,
    provider_kind: providerKind,
    model_id: modelId,
    display_name: `Unknown model ${modelId}`,
    role_support: ["unknown"],
    supports_tools: "unknown",
    supports_json_schema: "unknown",
    supports_mcp: "unknown",
    supports_long_context: "unknown",
    supports_streaming: "unknown",
    supports_local_execution: providerKind === "local" || providerKind === "ollama" || providerKind === "lmstudio" ? true : "unknown",
    safety_margin_ratio: 0.25,
    source: "unknown",
    warnings: ["unknown context window; using conservative budget"],
    created_at: NOW,
  }
}

export function normalizeProviderKind(value: string): ModelCapabilityProviderKind {
  const safe = redactText(value.trim().toLowerCase() || "unknown")
  if (safe.includes("ollama")) return "ollama"
  if (safe.includes("lmstudio")) return "lmstudio"
  if (safe.includes("local")) return "local"
  if (safe.includes("minimax")) return "minimax"
  if (safe.includes("openai")) return "openai"
  if (safe.includes("anthropic")) return "anthropic"
  if (safe.includes("opencode")) return "opencode"
  return safe as ModelCapabilityProviderKind
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? redactText(value.trim()) : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(Math.floor(n), max))
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function redactStringsOnly<T>(value: T): T {
  if (typeof value === "string") return redactText(value) as T
  if (Array.isArray(value)) return value.map((item) => redactStringsOnly(item)) as T
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) out[key] = redactStringsOnly(item)
    return out as T
  }
  return value
}
