import { redactValue } from "../security/redaction"
import type { ExternalApiConnector, ExternalApiConnectorSummary, ExternalApiCredentialRef, ExternalApiMethod } from "./api-connector-types"

const FIXED_TIME = "1970-01-01T00:00:00.000Z"
const CREDENTIAL_DEFAULT_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "x-auth-token",
  "x-access-token",
])
const CREDENTIAL_DEFAULT_HEADER_PATTERNS = [/api[_-]?key/i, /token/i, /secret/i, /password/i, /authorization/i]

export const BUILTIN_EXTERNAL_API_CONNECTORS: ExternalApiConnector[] = [
  {
    connector_id: "generic-http-readonly",
    title: "Generic HTTP read-only",
    description: "Disabled placeholder until explicitly configured",
    base_url: "https://disabled.example.invalid",
    allowed_hosts: [],
    allowed_methods: ["GET"],
    timeout_ms: 5000,
    max_response_bytes: 4096,
    created_at: FIXED_TIME,
    updated_at: FIXED_TIME,
  },
  {
    connector_id: "mock-research-api",
    title: "Mock research API",
    description: "Deterministic connector for fake transport and tests",
    base_url: "https://api.example.test",
    allowed_hosts: ["api.example.test"],
    allowed_methods: ["GET", "POST"],
    timeout_ms: 5000,
    max_response_bytes: 4096,
    created_at: FIXED_TIME,
    updated_at: FIXED_TIME,
  },
]

export class ExternalApiConnectorRegistry {
  private readonly connectors: Map<string, ExternalApiConnector>

  constructor(connectors: ExternalApiConnector[] = BUILTIN_EXTERNAL_API_CONNECTORS) {
    this.connectors = new Map(connectors.map((connector) => [connector.connector_id, validateExternalApiConnector(connector)]))
  }

  list(): ExternalApiConnectorSummary[] {
    return Array.from(this.connectors.values()).map(summarizeConnector)
  }

  get(connectorId: string): ExternalApiConnector | null {
    return this.connectors.get(connectorId) ?? null
  }

  getSummary(connectorId: string): ExternalApiConnectorSummary | null {
    const connector = this.get(connectorId)
    return connector ? summarizeConnector(connector) : null
  }
}

export function readExternalApiConnectorsFromEnv(env: Record<string, string | undefined>): ExternalApiConnector[] {
  const raw = env.NXL_EXTERNAL_API_CONNECTORS_JSON
  if (!raw?.trim()) return BUILTIN_EXTERNAL_API_CONNECTORS
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("NXL_EXTERNAL_API_CONNECTORS_JSON must be valid JSON")
  }
  if (!Array.isArray(parsed)) throw new Error("NXL_EXTERNAL_API_CONNECTORS_JSON must be an array")
  return parsed.map((value, index) => validateExternalApiConnector(value, `connector[${index}]`))
}

export function summarizeConnector(connector: ExternalApiConnector): ExternalApiConnectorSummary {
  return redactValue({
    ...connector,
    credential_refs: (connector.credential_refs ?? []).map((ref) => ({
      name: ref.name,
      source: ref.source,
      inject_as: ref.inject_as,
      target_name: ref.target_name,
      prefix: ref.prefix,
      env_name: ref.env_name,
    })),
  })
}

function validateExternalApiConnector(value: unknown, field = "connector"): ExternalApiConnector {
  if (!isRecord(value)) throw new Error(`${field} must be an object`)
  const connector: ExternalApiConnector = {
    connector_id: requiredString(value.connector_id, `${field}.connector_id`),
    title: requiredString(value.title, `${field}.title`),
    description: optionalString(value.description, `${field}.description`),
    base_url: requiredString(value.base_url, `${field}.base_url`),
    allowed_hosts: stringArray(value.allowed_hosts, `${field}.allowed_hosts`, 100),
    allowed_methods: methodArray(value.allowed_methods, `${field}.allowed_methods`),
    default_headers: defaultHeaders(value.default_headers, `${field}.default_headers`),
    credential_refs: credentialRefs(value.credential_refs, `${field}.credential_refs`),
    timeout_ms: positiveInteger(value.timeout_ms, `${field}.timeout_ms`, 60_000),
    max_response_bytes: positiveInteger(value.max_response_bytes, `${field}.max_response_bytes`, 1_000_000),
    created_at: requiredString(value.created_at, `${field}.created_at`),
    updated_at: requiredString(value.updated_at, `${field}.updated_at`),
    allow_local_http: value.allow_local_http === true ? true : undefined,
  }
  const base = parseConnectorBaseUrl(connector.base_url, `${field}.base_url`)
  if (base.username || base.password) throw new Error(`${field}.base_url must not include credentials`)
  if (base.protocol !== "https:" && !(connector.allow_local_http && base.protocol === "http:")) throw new Error(`${field}.base_url must use https`)
  if (connector.allowed_hosts.some((host) => !host.trim())) throw new Error(`${field}.allowed_hosts must not include blank hosts`)
  return connector
}

function parseConnectorBaseUrl(value: string, field: string): URL {
  try {
    return new URL(value)
  } catch {
    throw new Error(`${field} must be a valid URL`)
  }
}

function defaultHeaders(value: unknown, field: string): Record<string, string> | undefined {
  const headers = recordOfStrings(value, field)
  if (!headers) return undefined
  for (const key of Object.keys(headers)) {
    const normalized = key.toLowerCase()
    if (CREDENTIAL_DEFAULT_HEADER_NAMES.has(normalized) || CREDENTIAL_DEFAULT_HEADER_PATTERNS.some((pattern) => pattern.test(key))) {
      throw new Error(`${field}.${redactHeaderNameForError(key)} must use credential_refs`)
    }
  }
  return headers
}

function redactHeaderNameForError(key: string): string {
  return key.replace(/[^A-Za-z0-9_-]/g, "_")
}

function credentialRefs(value: unknown, field: string): ExternalApiCredentialRef[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`${field}[${index}] must be an object`)
    const source = item.source
    const injectAs = item.inject_as
    if (source !== "env") throw new Error(`${field}[${index}].source must be env`)
    if (injectAs !== "header" && injectAs !== "query") throw new Error(`${field}[${index}].inject_as must be header or query`)
    return {
      name: requiredString(item.name, `${field}[${index}].name`),
      source,
      env_name: requiredString(item.env_name, `${field}[${index}].env_name`),
      inject_as: injectAs,
      target_name: requiredString(item.target_name, `${field}[${index}].target_name`),
      prefix: optionalRawString(item.prefix, `${field}[${index}].prefix`),
    }
  })
}

function methodArray(value: unknown, field: string): ExternalApiMethod[] {
  const methods = stringArray(value, field, 10)
  return methods.map((method) => {
    if (method !== "GET" && method !== "POST") throw new Error(`${field} supports GET and POST only`)
    return method
  })
}

function recordOfStrings(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`${field} must be an object`)
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) out[requiredString(key, `${field} key`)] = requiredString(item, `${field}.${key}`)
  return out
}

function stringArray(value: unknown, field: string, max: number): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  if (value.length > max) throw new Error(`${field} must have no more than ${max} entries`)
  return value.map((item, index) => requiredString(item, `${field}[${index}]`))
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  return requiredString(value, field)
}

function optionalRawString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${field} must be a string`)
  return value
}

function positiveInteger(value: unknown, field: string, max: number): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${field} must be a positive integer`)
  if (Number(value) > max) throw new Error(`${field} must be no greater than ${max}`)
  return Number(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
