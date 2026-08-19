import { createHash } from "node:crypto"
import { COMMANDER_TOOL_PHASES } from "../commander-tools/commander-tool-registry"
import type { CommanderToolPhase } from "../commander-tools/commander-tool-types"
import { normalizeProviderKind } from "../context/model-capability-registry"
import type { ModelCapability } from "../context/model-capability-types"
import { redactText } from "../security/redaction"
import { validateCommanderConnectorModelTransportConfig } from "./commander-connector-transport-types"
import type { CommanderInvestigationProviderConfig } from "./commander-investigation-provider-types"

const PROVIDER_ENV_KEYS = [
  "NXL_COMMANDER_INVESTIGATION_PROVIDER_ENABLED",
  "NXL_COMMANDER_INVESTIGATION_TRANSPORT_KIND",
  "NXL_COMMANDER_INVESTIGATION_PROVIDER_ID",
  "NXL_COMMANDER_INVESTIGATION_PROVIDER_KIND",
  "NXL_COMMANDER_INVESTIGATION_CONNECTOR_ID",
  "NXL_COMMANDER_INVESTIGATION_MODEL_ID",
  "NXL_COMMANDER_INVESTIGATION_ENABLED_PHASES",
  "NXL_COMMANDER_INVESTIGATION_TIMEOUT_MS",
  "NXL_COMMANDER_INVESTIGATION_MAX_REQUEST_BYTES",
  "NXL_COMMANDER_INVESTIGATION_MAX_RESPONSE_BYTES",
  "NXL_COMMANDER_INVESTIGATION_MAX_CONTEXT_BYTES",
  "NXL_COMMANDER_INVESTIGATION_MAX_CONTEXT_TOKENS",
  "NXL_COMMANDER_INVESTIGATION_MAX_OUTPUT_TOKENS",
  "NXL_COMMANDER_INVESTIGATION_SUPPORTS_TOOLS",
  "NXL_COMMANDER_INVESTIGATION_SUPPORTS_JSON_SCHEMA",
  "NXL_COMMANDER_INVESTIGATION_SUPPORTS_LONG_CONTEXT",
  "NXL_COMMANDER_INVESTIGATION_SUPPORTS_LOCAL_EXECUTION",
] as const

const CONFIG_KEYS = new Set([
  "transport_kind",
  "provider_id",
  "provider_kind",
  "connector_id",
  "model_id",
  "enabled_phases",
  "timeout_ms",
  "max_request_bytes",
  "max_response_bytes",
  "max_context_bytes",
  "max_context_tokens",
  "max_output_tokens",
  "supports_tools",
  "supports_json_schema",
  "supports_long_context",
  "supports_local_execution",
])

const CREDENTIAL_OR_URL_KEYS = [/api[_-]?key/i, /authorization/i, /credential/i, /secret/i, /^token$/i, /base[_-]?url/i, /^url$/i, /header/i, /env[_-]?name/i]

export function validateCommanderInvestigationProviderConfig(value: unknown): CommanderInvestigationProviderConfig {
  if (!isRecord(value)) throw new Error("Commander investigation provider config must be an object")
  for (const key of Object.keys(value)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`unknown Commander investigation provider config key: ${redactText(key)}`)
    if (CREDENTIAL_OR_URL_KEYS.some((pattern) => pattern.test(key))) throw new Error(`credential or URL config key is not allowed: ${redactText(key)}`)
  }
  const transport = validateCommanderConnectorModelTransportConfig({
    transport_kind: value.transport_kind,
    provider_id: value.provider_id,
    connector_id: value.connector_id,
    model_id: value.model_id,
    timeout_ms: value.timeout_ms,
    max_request_bytes: value.max_request_bytes,
    max_response_bytes: value.max_response_bytes,
  })
  const rawProviderKind = boundedString(value.provider_kind, "provider_kind", 80)
  rejectCredentialOrUrlString(rawProviderKind)
  const providerKind = normalizeProviderKind(rawProviderKind)
  if (transport.transport_kind === "anthropic_messages_connector" && providerKind !== "anthropic") throw new Error("anthropic_messages_connector requires provider_kind anthropic")
  if (transport.transport_kind === "google_generative_ai_connector" && providerKind !== "google") throw new Error("google_generative_ai_connector requires provider_kind google")
  if (transport.transport_kind === "openai_compatible_connector" && providerKind === "anthropic") throw new Error("provider_kind anthropic requires anthropic_messages_connector")
  if (transport.transport_kind !== "google_generative_ai_connector" && providerKind === "google") throw new Error("provider_kind google requires google_generative_ai_connector")
  const enabledPhases = normalizePhases(value.enabled_phases)
  const maxContextBytes = positiveInteger(value.max_context_bytes, "max_context_bytes", 65_536)
  if (maxContextBytes > transport.max_request_bytes) throw new Error("max_context_bytes must not exceed max_request_bytes")
  const config: CommanderInvestigationProviderConfig = Object.freeze({
    ...transport,
    provider_kind: providerKind,
    enabled_phases: enabledPhases,
    max_context_bytes: maxContextBytes,
    max_context_tokens: value.max_context_tokens === undefined ? undefined : positiveInteger(value.max_context_tokens, "max_context_tokens", 1_000_000),
    max_output_tokens: positiveInteger(value.max_output_tokens, "max_output_tokens", 32_768),
    supports_tools: triStateValue(value.supports_tools, "supports_tools"),
    supports_json_schema: triStateValue(value.supports_json_schema, "supports_json_schema"),
    supports_long_context: triStateValue(value.supports_long_context, "supports_long_context"),
    supports_local_execution: triStateValue(value.supports_local_execution, "supports_local_execution"),
  })
  if (config.transport_kind === "anthropic_messages_connector" && config.supports_json_schema === true) throw new Error("native Anthropic JSON-schema structured output is not supported")
  if (config.transport_kind === "google_generative_ai_connector" && config.supports_json_schema === true) throw new Error("native Gemini JSON-schema structured output is not supported")
  for (const item of Object.values(config)) {
    if (typeof item === "string") {
      if (/https?:\/\//i.test(item)) throw new Error("Commander investigation provider config must not contain URLs")
      if (/(sk-|bearer\s+|api[_-]?key|secret|token)/i.test(item)) throw new Error("Commander investigation provider config must not contain credential-looking strings")
    }
  }
  return config
}

function rejectCredentialOrUrlString(value: string): void {
  if (/https?:\/\//i.test(value)) throw new Error("Commander investigation provider config must not contain URLs")
  if (/(sk-|bearer\s+|api[_-]?key|secret|token)/i.test(value)) throw new Error("Commander investigation provider config must not contain credential-looking strings")
}

export function readCommanderInvestigationProviderConfigFromEnv(env: Record<string, string | undefined>): CommanderInvestigationProviderConfig | undefined {
  const present = PROVIDER_ENV_KEYS.filter((key) => env[key] !== undefined)
  if (present.length === 0) return undefined
  const enabled = env.NXL_COMMANDER_INVESTIGATION_PROVIDER_ENABLED
  const otherKeys = present.filter((key) => key !== "NXL_COMMANDER_INVESTIGATION_PROVIDER_ENABLED")
  if (enabled === "0" && otherKeys.length === 0) return undefined
  if (enabled !== "1") {
    if (enabled === "0") throw new Error("NXL_COMMANDER_INVESTIGATION_PROVIDER_ENABLED=0 cannot be combined with provider fields")
    throw new Error("NXL_COMMANDER_INVESTIGATION_PROVIDER_ENABLED must be 1 when Commander investigation provider fields are set")
  }
  const raw: Record<string, unknown> = {
    transport_kind: requiredEnv(env, "NXL_COMMANDER_INVESTIGATION_TRANSPORT_KIND"),
    provider_id: requiredEnv(env, "NXL_COMMANDER_INVESTIGATION_PROVIDER_ID"),
    provider_kind: requiredEnv(env, "NXL_COMMANDER_INVESTIGATION_PROVIDER_KIND"),
    connector_id: requiredEnv(env, "NXL_COMMANDER_INVESTIGATION_CONNECTOR_ID"),
    model_id: requiredEnv(env, "NXL_COMMANDER_INVESTIGATION_MODEL_ID"),
    enabled_phases: parsePhaseEnv(requiredEnv(env, "NXL_COMMANDER_INVESTIGATION_ENABLED_PHASES")),
    timeout_ms: readPositiveEnv(env, "NXL_COMMANDER_INVESTIGATION_TIMEOUT_MS"),
    max_request_bytes: readPositiveEnv(env, "NXL_COMMANDER_INVESTIGATION_MAX_REQUEST_BYTES"),
    max_response_bytes: readPositiveEnv(env, "NXL_COMMANDER_INVESTIGATION_MAX_RESPONSE_BYTES"),
    max_context_bytes: readPositiveEnv(env, "NXL_COMMANDER_INVESTIGATION_MAX_CONTEXT_BYTES"),
    max_context_tokens: optionalPositiveEnv(env, "NXL_COMMANDER_INVESTIGATION_MAX_CONTEXT_TOKENS"),
    max_output_tokens: readPositiveEnv(env, "NXL_COMMANDER_INVESTIGATION_MAX_OUTPUT_TOKENS"),
    supports_tools: readTriStateEnv(env, "NXL_COMMANDER_INVESTIGATION_SUPPORTS_TOOLS"),
    supports_json_schema: readTriStateEnv(env, "NXL_COMMANDER_INVESTIGATION_SUPPORTS_JSON_SCHEMA"),
    supports_long_context: readTriStateEnv(env, "NXL_COMMANDER_INVESTIGATION_SUPPORTS_LONG_CONTEXT"),
    supports_local_execution: readTriStateEnv(env, "NXL_COMMANDER_INVESTIGATION_SUPPORTS_LOCAL_EXECUTION"),
  }
  if (raw.max_context_tokens === undefined) delete raw.max_context_tokens
  return validateCommanderInvestigationProviderConfig(raw)
}

export function commanderInvestigationModelCapability(config: CommanderInvestigationProviderConfig): ModelCapability {
  const providerKind = normalizeProviderKind(config.provider_kind)
  return {
    capability_id: `runtime-commander-${hash(`${providerKind}:${config.provider_id}:${config.model_id}`).slice(0, 16)}`,
    provider_kind: providerKind,
    provider_id: config.provider_id,
    model_id: config.model_id,
    display_name: `${providerKind} Commander investigation model`,
    role_support: ["commander"],
    max_context_tokens: config.max_context_tokens,
    max_context_bytes: config.max_context_bytes,
    max_output_tokens: config.max_output_tokens,
    supports_tools: config.supports_tools,
    supports_json_schema: config.supports_json_schema,
    supports_mcp: false,
    supports_long_context: config.supports_long_context,
    supports_streaming: false,
    supports_local_execution: config.supports_local_execution,
    safety_margin_ratio: 0.18,
    source: "runtime_config",
    warnings: ["connector-backed Commander investigation transport is nonstreaming and internal-only"],
    created_at: "1970-01-01T00:00:00.000Z",
  }
}

function parsePhaseEnv(value: string): CommanderToolPhase[] {
  const parts = value.split(",").map((item) => item.trim())
  if (parts.some((item) => !item)) throw new Error("NXL_COMMANDER_INVESTIGATION_ENABLED_PHASES must not contain blank entries")
  return normalizePhases(parts)
}

function normalizePhases(value: unknown): CommanderToolPhase[] {
  if (!Array.isArray(value)) throw new Error("enabled_phases must be an array")
  const set = new Set<string>()
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) throw new Error("enabled_phases entries must be nonblank strings")
    const phase = item.trim()
    if (!COMMANDER_TOOL_PHASES.includes(phase as CommanderToolPhase)) throw new Error(`unknown Commander investigation phase: ${redactText(phase)}`)
    set.add(phase)
  }
  const normalized = COMMANDER_TOOL_PHASES.filter((phase) => set.has(phase))
  if (normalized.length === 0) throw new Error("enabled_phases must not be empty")
  return normalized
}

function triStateValue(value: unknown, field: string): boolean | "unknown" {
  if (value === true || value === false || value === "unknown") return value
  throw new Error(`${field} must be true, false, or unknown`)
}

function readTriStateEnv(env: Record<string, string | undefined>, key: string): boolean | "unknown" {
  const value = requiredEnv(env, key)
  if (value === "1") return true
  if (value === "0") return false
  if (value === "unknown") return "unknown"
  throw new Error(`${key} must be 1, 0, or unknown`)
}

function readPositiveEnv(env: Record<string, string | undefined>, key: string): number {
  return positiveInteger(requiredEnv(env, key), key, Number.MAX_SAFE_INTEGER)
}

function optionalPositiveEnv(env: Record<string, string | undefined>, key: string): number | undefined {
  const value = env[key]
  return value === undefined ? undefined : positiveInteger(value, key, Number.MAX_SAFE_INTEGER)
}

function requiredEnv(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required`)
  return value.trim()
}

function boundedString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  const trimmed = value.trim()
  if (trimmed.length > maxLength) throw new Error(`${field} must be no longer than ${maxLength} characters`)
  return trimmed
}

function positiveInteger(value: unknown, field: string, max: number): number {
  const raw = typeof value === "string" ? Number(value) : value
  if (!Number.isInteger(raw) || Number(raw) < 1) throw new Error(`${field} must be a positive integer`)
  if (Number(raw) > max) throw new Error(`${field} must be no greater than ${max}`)
  return Number(raw)
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
