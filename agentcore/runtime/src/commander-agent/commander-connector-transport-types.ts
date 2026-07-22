import { redactText } from "../security/redaction"
import type { ExternalApiConnector } from "../external-api/api-connector-types"

export type CommanderConnectorModelTransportConfig = {
  transport_kind: "openai_compatible_connector"
  provider_id: string
  connector_id: string
  model_id: string
  timeout_ms: number
  max_request_bytes: number
  max_response_bytes: number
}

export type CommanderConnectorModelTransportMetadata = {
  transport_kind: "external_api_connector"
  connector_id: string
  request_ids: string[]
  audit_event_kinds: Array<"external_api_request_executed" | "external_api_request_failed">
  audit_event_count: number
  successful_audit_count: number
  failed_audit_count: number
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
  if (value.transport_kind !== "openai_compatible_connector") throw new Error("transport_kind must be openai_compatible_connector")
  const config: CommanderConnectorModelTransportConfig = {
    transport_kind: "openai_compatible_connector",
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
