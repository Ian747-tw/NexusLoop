import { redactText } from "../security/redaction"
import type { ExternalApiConnector } from "../external-api/api-connector-types"

export type CommanderConnectorModelTransportKind = "openai_compatible_connector" | "anthropic_messages_connector"

export const CONNECTOR_MANAGED_API_KEY_SENTINEL = "NEXUSLOOP_CONNECTOR_MANAGED_CREDENTIAL"
export const ANTHROPIC_MESSAGES_PROTOCOL_VERSION = "2023-06-01" as const
export const ANTHROPIC_MESSAGES_PROVIDER_ADAPTER_VERSION = "ai@7.0.29/@ai-sdk/anthropic@4.0.15" as const
export const ANTHROPIC_MESSAGES_REQUEST_SHAPE_POLICY_VERSION = "anthropic_messages_v1" as const

type CommanderConnectorModelTransportConfigBase = {
  provider_id: string
  connector_id: string
  model_id: string
  timeout_ms: number
  max_request_bytes: number
  max_response_bytes: number
}

export type CommanderConnectorModelTransportConfig = CommanderConnectorModelTransportConfigBase & (
  | { transport_kind: "openai_compatible_connector" }
  | { transport_kind: "anthropic_messages_connector" }
)

export type CommanderConnectorModelTransportMetadata = {
  transport_kind: "external_api_connector"
  connector_id: string
  request_ids: string[]
  audit_event_kinds: Array<"external_api_request_executed" | "external_api_request_failed">
  audit_event_count: number
  successful_audit_count: number
  failed_audit_count: number
  transport_dispatch_count?: number
  dropped_header_names: string[]
  request_body_persisted: false
  response_body_persisted: false
  credentials_persisted: false
}

const CONFIG_KEYS = new Set(["transport_kind", "provider_id", "connector_id", "model_id", "timeout_ms", "max_request_bytes", "max_response_bytes"])
const CREDENTIAL_OR_URL_KEYS = [/api[_-]?key/i, /authorization/i, /credential/i, /secret/i, /token/i, /base[_-]?url/i, /^url$/i, /header/i]

export function validateCommanderConnectorModelTransportConfig(value: unknown): CommanderConnectorModelTransportConfig {
  if (!isRecord(value)) throw new Error("Commander connector transport config must be an object")
  for (const key of Object.keys(value)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`unknown Commander connector transport config key: ${redactText(key)}`)
    if (CREDENTIAL_OR_URL_KEYS.some((pattern) => pattern.test(key)) && !CONFIG_KEYS.has(key)) throw new Error(`credential or URL config key is not allowed: ${redactText(key)}`)
  }
  if (value.transport_kind !== "openai_compatible_connector" && value.transport_kind !== "anthropic_messages_connector") {
    throw new Error("transport_kind must be openai_compatible_connector or anthropic_messages_connector")
  }
  const config: CommanderConnectorModelTransportConfig = {
    transport_kind: value.transport_kind,
    provider_id: boundedString(value.provider_id, "provider_id", 120),
    connector_id: boundedString(value.connector_id, "connector_id", 120),
    model_id: boundedString(value.model_id, "model_id", 200),
    timeout_ms: positiveInteger(value.timeout_ms, "timeout_ms", 120_000),
    max_request_bytes: positiveInteger(value.max_request_bytes, "max_request_bytes", 65_536),
    max_response_bytes: positiveInteger(value.max_response_bytes, "max_response_bytes", 262_144),
  }
  for (const item of Object.values(config)) {
    if (typeof item === "string" && /https?:\/\//i.test(item)) throw new Error("Commander connector transport config must not contain URLs")
  }
  return config
}

export function connectorChatCompletionsUrl(connector: ExternalApiConnector): URL {
  const base = new URL(connector.base_url)
  if (base.search || base.hash) throw new Error("connector base_url must not include query or fragment")
  const pathname = `${base.pathname.replace(/\/+$/, "")}/chat/completions`.replace(/^\/?/, "/")
  return new URL(pathname, `${base.protocol}//${base.host}`)
}

export function connectorAnthropicMessagesUrl(connector: ExternalApiConnector): URL {
  return connectorProtocolUrl(connector, "messages")
}

export function connectorModelRequestUrl(connector: ExternalApiConnector, transportKind: CommanderConnectorModelTransportKind): URL {
  return transportKind === "anthropic_messages_connector" ? connectorAnthropicMessagesUrl(connector) : connectorChatCompletionsUrl(connector)
}

export function validateCommanderConnectorProtocolPolicy(config: CommanderConnectorModelTransportConfig, connector: ExternalApiConnector): void {
  connectorModelRequestUrl(connector, config.transport_kind)
  if (!connector.allowed_methods.includes("POST")) throw new Error("connector must permit POST")
  if (config.timeout_ms > connector.timeout_ms) throw new Error(`transport timeout_ms exceeds connector limit: ${connector.timeout_ms}`)
  if (config.max_response_bytes > connector.max_response_bytes) throw new Error(`transport max_response_bytes exceeds connector limit: ${connector.max_response_bytes}`)
  if (config.transport_kind !== "anthropic_messages_connector") return
  const base = new URL(connector.base_url)
  const allowedHosts = connector.allowed_hosts.map((host) => host.trim().toLowerCase())
  if (allowedHosts.length !== 1 || allowedHosts[0] !== base.hostname.toLowerCase()) throw new Error("Anthropic connector must allow exactly its configured base host")
  if (connector.allowed_methods.length !== 1 || connector.allowed_methods[0] !== "POST") throw new Error("Anthropic connector method policy must be exactly POST")
  if (Object.keys(connector.default_headers ?? {}).length > 0) throw new Error("Anthropic connector default headers are not allowed")
  const refs = connector.credential_refs ?? []
  if (refs.length !== 1) throw new Error("Anthropic connector requires exactly one credential reference")
  const ref = refs[0]
  if (ref.source !== "env" || ref.inject_as !== "header" || ref.target_name.toLowerCase() !== "x-api-key" || (ref.prefix ?? "") !== "") {
    throw new Error("Anthropic connector credential reference must inject exactly one unprefixed x-api-key header")
  }
}

function connectorProtocolUrl(connector: ExternalApiConnector, suffix: string): URL {
  const base = new URL(connector.base_url)
  if (base.username || base.password) throw new Error("connector base_url credentials are not allowed")
  if (base.search || base.hash) throw new Error("connector base_url must not include query or fragment")
  const pathname = `${base.pathname.replace(/\/+$/, "")}/${suffix}`.replace(/^\/?/, "/")
  return new URL(pathname, `${base.protocol}//${base.host}`)
}

function boundedString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  const trimmed = value.trim()
  if (trimmed.length > maxLength) throw new Error(`${field} must be no longer than ${maxLength} characters`)
  return trimmed
}

function positiveInteger(value: unknown, field: string, max: number): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${field} must be a positive integer`)
  if (Number(value) > max) throw new Error(`${field} must be no greater than ${max}`)
  return Number(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
