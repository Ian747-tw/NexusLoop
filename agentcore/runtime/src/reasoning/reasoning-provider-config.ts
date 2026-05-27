import { redactValue } from "../security/redaction"

export type ReasoningProviderKind = "fake" | "minimax"
export type ReasoningProviderSurface = "research_synthesis" | "commander_cycle"

export interface ReasoningProviderConfig {
  kind: ReasoningProviderKind
  provider_id: string
  connector_id?: string
  model?: string
  max_input_bytes: number
  max_output_bytes: number
  timeout_ms?: number
  system_prompt_version?: string
  enabled_for: ReasoningProviderSurface[]
}

export interface ReasoningProviderStatus {
  kind: ReasoningProviderKind
  provider_id: string
  connector_id?: string
  model?: string
  max_input_bytes: number
  max_output_bytes: number
  timeout_ms?: number
  system_prompt_version?: string
  enabled_for: ReasoningProviderSurface[]
}

const DEFAULT_MAX_INPUT_BYTES = 32 * 1024
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024
const HARD_MAX_INPUT_BYTES = 96 * 1024
const HARD_MAX_OUTPUT_BYTES = 32 * 1024

export function defaultReasoningProviderConfig(): ReasoningProviderConfig {
  return {
    kind: "fake",
    provider_id: "fake-reasoning",
    max_input_bytes: DEFAULT_MAX_INPUT_BYTES,
    max_output_bytes: DEFAULT_MAX_OUTPUT_BYTES,
    enabled_for: ["research_synthesis", "commander_cycle"],
  }
}

export function readReasoningProviderConfigFromEnv(env: Record<string, string | undefined>): ReasoningProviderConfig | undefined {
  const rawKind = env.NXL_REASONING_PROVIDER_KIND?.trim()
  if (!rawKind) return undefined
  const kind = readKind(rawKind)
  const enabled = readEnabledSurfaces(env)
  const config: ReasoningProviderConfig = {
    kind,
    provider_id: readString(env.NXL_REASONING_PROVIDER_ID, "NXL_REASONING_PROVIDER_ID", kind === "fake" ? "fake-reasoning" : "minimax-reasoning"),
    connector_id: optionalString(env.NXL_REASONING_CONNECTOR_ID, "NXL_REASONING_CONNECTOR_ID"),
    model: optionalString(env.NXL_REASONING_MODEL, "NXL_REASONING_MODEL"),
    max_input_bytes: readPositiveInt(env.NXL_REASONING_MAX_INPUT_BYTES, "NXL_REASONING_MAX_INPUT_BYTES", DEFAULT_MAX_INPUT_BYTES, HARD_MAX_INPUT_BYTES),
    max_output_bytes: readPositiveInt(env.NXL_REASONING_MAX_OUTPUT_BYTES, "NXL_REASONING_MAX_OUTPUT_BYTES", DEFAULT_MAX_OUTPUT_BYTES, HARD_MAX_OUTPUT_BYTES),
    timeout_ms: optionalPositiveInt(env.NXL_REASONING_TIMEOUT_MS, "NXL_REASONING_TIMEOUT_MS", 60_000),
    system_prompt_version: optionalString(env.NXL_REASONING_SYSTEM_PROMPT_VERSION, "NXL_REASONING_SYSTEM_PROMPT_VERSION"),
    enabled_for: enabled,
  }
  return validateReasoningProviderConfig(config)
}

export function validateReasoningProviderConfig(config: ReasoningProviderConfig): ReasoningProviderConfig {
  const kind = readKind(config.kind)
  const enabled = [...new Set(config.enabled_for.map(readSurface))]
  if (enabled.length === 0) throw new Error("reasoning provider enabled_for must include at least one surface")
  const normalized: ReasoningProviderConfig = {
    kind,
    provider_id: readString(config.provider_id, "reasoningProviderConfig.provider_id", kind === "fake" ? "fake-reasoning" : "minimax-reasoning"),
    connector_id: config.connector_id === undefined ? undefined : readString(config.connector_id, "reasoningProviderConfig.connector_id"),
    model: config.model === undefined ? undefined : readString(config.model, "reasoningProviderConfig.model"),
    max_input_bytes: clampPositive(config.max_input_bytes, "reasoningProviderConfig.max_input_bytes", HARD_MAX_INPUT_BYTES),
    max_output_bytes: clampPositive(config.max_output_bytes, "reasoningProviderConfig.max_output_bytes", HARD_MAX_OUTPUT_BYTES),
    timeout_ms: config.timeout_ms === undefined ? undefined : clampPositive(config.timeout_ms, "reasoningProviderConfig.timeout_ms", 60_000),
    system_prompt_version: config.system_prompt_version === undefined ? undefined : readString(config.system_prompt_version, "reasoningProviderConfig.system_prompt_version"),
    enabled_for: enabled,
  }
  if (kind === "minimax") {
    if (!normalized.connector_id) throw new Error("minimax reasoning provider requires connector_id")
    if (!normalized.model) throw new Error("minimax reasoning provider requires model")
  }
  return normalized
}

export function reasoningProviderStatus(config: ReasoningProviderConfig): ReasoningProviderStatus {
  return redactValue(validateReasoningProviderConfig(config))
}

function readEnabledSurfaces(env: Record<string, string | undefined>): ReasoningProviderSurface[] {
  const enabled: ReasoningProviderSurface[] = []
  if (env.NXL_REASONING_ENABLE_RESEARCH_SYNTHESIS === "1") enabled.push("research_synthesis")
  if (env.NXL_REASONING_ENABLE_COMMANDER_CYCLE === "1") enabled.push("commander_cycle")
  return enabled.length > 0 ? enabled : ["research_synthesis", "commander_cycle"]
}

function readKind(value: unknown): ReasoningProviderKind {
  if (value === "fake" || value === "minimax") return value
  throw new Error("reasoning provider kind must be fake or minimax")
}

function readSurface(value: unknown): ReasoningProviderSurface {
  if (value === "research_synthesis" || value === "commander_cycle") return value
  throw new Error("reasoning provider enabled_for supports research_synthesis and commander_cycle only")
}

function readString(value: unknown, field: string, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === "") return undefined
  return readString(value, field)
}

function readPositiveInt(value: unknown, field: string, fallback: number, max: number): number {
  if (value === undefined || value === "") return fallback
  const parsed = Number(value)
  return clampPositive(parsed, field, max)
}

function optionalPositiveInt(value: unknown, field: string, max: number): number | undefined {
  if (value === undefined || value === "") return undefined
  const parsed = Number(value)
  return clampPositive(parsed, field, max)
}

function clampPositive(value: unknown, field: string, max: number): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${field} must be a positive integer`)
  return Math.min(Number(value), max)
}
