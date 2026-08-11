import { redactText } from "../security/redaction"
import type { ExternalApiConnectorRegistry } from "../external-api/api-connector-registry"
import type { ExternalApiPersistedAuditRecord } from "../external-api/api-connector-types"
import type { ExternalApiRequestService } from "../external-api/api-request-service"
import { ANTHROPIC_MESSAGES_PROTOCOL_VERSION, CONNECTOR_MANAGED_API_KEY_SENTINEL, connectorModelRequestUrl, validateCommanderConnectorModelTransportConfig, validateCommanderConnectorProtocolPolicy, type CommanderConnectorModelTransportConfig } from "./commander-connector-transport-types"

export type ExternalApiConnectorFetchContext = {
  commander_model_request_id: string
  investigation_id?: string
  requested_by: string
  provider_id: string
  model_id: string
}

export type ExternalApiConnectorFetchMetadata = {
  readonly dropped_header_names: string[]
  readonly audit_records: ExternalApiPersistedAuditRecord[]
  readonly request_attempt_count: () => number
  readonly transport_dispatch_count: () => number
}

export type ExternalApiConnectorFetchOptions = {
  registry: ExternalApiConnectorRegistry
  requestService: ExternalApiRequestService
  config: CommanderConnectorModelTransportConfig
  context: ExternalApiConnectorFetchContext
}

export type ExternalApiConnectorFetchAuthority = Readonly<{
  transport_kind: CommanderConnectorModelTransportConfig["transport_kind"]
  provider_id: string
  connector_id: string
  model_id: string
  base_url: string
}>

const CREDENTIAL_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "x-api-key", "api-key"])
const ANTHROPIC_DROPPED_SDK_HEADERS = new Set(["user-agent", "x-ai-sdk-version", "x-vercel-ai-sdk"])
const ANTHROPIC_REQUEST_KEYS = new Set(["model", "max_tokens", "messages", "system", "tools", "tool_choice", "temperature", "stream"])
const MAX_DROPPED_HEADER_NAME_LENGTH = 80
const AUDITED_CONNECTOR_FETCHES = new WeakMap<typeof fetch, ExternalApiConnectorFetchAuthority>()

export function externalApiConnectorFetchAuthority(value: typeof fetch): ExternalApiConnectorFetchAuthority | undefined {
  return AUDITED_CONNECTOR_FETCHES.get(value)
}

export function createExternalApiConnectorFetch(options: ExternalApiConnectorFetchOptions): { fetch: typeof fetch; metadata: ExternalApiConnectorFetchMetadata } {
  const registry = options.registry
  const requestService = options.requestService
  const config = validateCommanderConnectorModelTransportConfig(options.config)
  const context = Object.freeze({ ...options.context })
  if (!requestService.usesConnectorRegistry(registry)) throw new Error("connector fetch bridge and request service must share one registry authority")
  const connector = registry.get(config.connector_id)
  if (!connector) throw new Error(`unknown connector: ${redactText(config.connector_id)}`)
  validateCommanderConnectorProtocolPolicy(config, connector)
  const expectedUrl = connectorModelRequestUrl(connector, config.transport_kind)
  const dropped = new Set<string>()
  const auditRecords: ExternalApiPersistedAuditRecord[] = []
  let attempts = 0
  let transportDispatches = 0
  const bridge = (async (input, init) => {
    attempts += 1
    const request = await parseBridgeRequest(input, init)
    validateBridgeRequest(request, expectedUrl, config)
    const headers = filterHeaders(request.headers, dropped, config)
    const result = await requestService.executeForInternalUse({
      connector_id: config.connector_id,
      method: "POST",
      path: expectedUrl.pathname,
      headers,
      body: request.body,
      requested_by: boundedRequestedBy(context),
    }, {
      timeout_ms: config.timeout_ms,
      max_response_bytes: config.max_response_bytes,
      abort_signal: request.signal ?? init?.signal ?? undefined,
      redact_response_body: false,
      omit_response_preview_from_audit: true,
      persist_audit: true,
      on_audit_persisted: (record) => auditRecords.push(record),
      on_transport_dispatched: () => { transportDispatches += 1 },
    })
    return new Response(providerResponseBody(result, config.transport_kind, config.model_id), {
      status: result.status_code ?? 500,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch
  AUDITED_CONNECTOR_FETCHES.set(bridge, Object.freeze({
    transport_kind: config.transport_kind,
    provider_id: config.provider_id,
    connector_id: config.connector_id,
    model_id: config.model_id,
    base_url: new URL(connector.base_url).toString(),
  }))
  return {
    fetch: bridge,
    metadata: {
      get dropped_header_names() {
        return Array.from(dropped).sort().slice(0, 8)
      },
      get audit_records() {
        return auditRecords.slice(0, 4)
      },
      request_attempt_count: () => attempts,
      transport_dispatch_count: () => transportDispatches,
    },
  }
}

type ParsedBridgeRequest = {
  url: URL
  method: string
  headers: Headers
  body: string
  signal?: AbortSignal | null
}

async function parseBridgeRequest(input: RequestInfo | URL, init?: RequestInit): Promise<ParsedBridgeRequest> {
  const fromRequest = input instanceof Request ? input : null
  const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url)
  const method = String(init?.method ?? fromRequest?.method ?? "GET").toUpperCase()
  const headers = new Headers(fromRequest?.headers)
  if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value))
  const rawBody = init?.body
  if (rawBody === undefined && fromRequest?.body) throw new Error("ReadableStream request bodies are not allowed")
  const body = await readAllowedBody(rawBody)
  return { url, method, headers, body, signal: init?.signal ?? fromRequest?.signal }
}

async function readAllowedBody(body: BodyInit | null | undefined): Promise<string> {
  if (body === null || body === undefined) return ""
  if (typeof body === "string") return body
  if (body instanceof Uint8Array) return decodeUtf8(body)
  if (body instanceof ArrayBuffer) return decodeUtf8(new Uint8Array(body))
  if (typeof FormData !== "undefined" && body instanceof FormData) throw new Error("FormData request bodies are not allowed")
  if (typeof Blob !== "undefined" && body instanceof Blob) throw new Error("Blob request bodies are not allowed")
  if (body instanceof URLSearchParams) throw new Error("URLSearchParams request bodies are not allowed")
  if (body instanceof ReadableStream) throw new Error("ReadableStream request bodies are not allowed")
  throw new Error("request body type is not allowed")
}

function validateBridgeRequest(request: ParsedBridgeRequest, expectedUrl: URL, config: CommanderConnectorModelTransportConfig): void {
  if (request.signal?.aborted) throw new Error("connector model request cancelled before dispatch")
  if (request.method !== "POST") throw new Error("connector model transport requires POST")
  if (request.url.username || request.url.password) throw new Error("connector model transport URL credentials are not allowed")
  if (request.url.origin !== expectedUrl.origin || request.url.pathname !== expectedUrl.pathname) {
    throw new Error(config.transport_kind === "anthropic_messages_connector"
      ? "connector model transport URL does not match Anthropic Messages endpoint"
      : "connector model transport URL does not match chat completions endpoint")
  }
  if (request.url.search) throw new Error("connector model transport query parameters are not allowed")
  if (request.url.hash) throw new Error("connector model transport fragments are not allowed")
  if (!request.body) throw new Error("connector model transport body is required")
  const bytes = new TextEncoder().encode(request.body).byteLength
  if (bytes > config.max_request_bytes) throw new Error(`connector model request exceeds max_request_bytes: ${config.max_request_bytes}`)
  const payload = JSON.parse(request.body) as unknown
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("connector model transport body must be a JSON object")
  const model = (payload as { model?: unknown }).model
  if (typeof model !== "string" || model !== config.model_id) throw new Error("connector model transport model does not match configured model_id")
  if (config.transport_kind === "anthropic_messages_connector") validateAnthropicMessagesBody(payload as Record<string, unknown>)
}

function filterHeaders(headers: Headers, dropped: Set<string>, config: CommanderConnectorModelTransportConfig): Record<string, string> {
  if (config.transport_kind === "anthropic_messages_connector") return filterAnthropicHeaders(headers, dropped)
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    const normalized = key.toLowerCase()
    if (normalized === "content-type") {
      if (!/^application\/json\b/i.test(value)) throw new Error("connector model transport requires application/json content type")
      out["Content-Type"] = "application/json"
      return
    }
    if (normalized === "accept") {
      if (!/(^|,\s*)application\/json\b|^\*\/\*$/i.test(value)) throw new Error("connector model transport accepts only JSON responses")
      out.Accept = "application/json"
      return
    }
    if (normalized === "authorization") {
      if (value === `Bearer ${CONNECTOR_MANAGED_API_KEY_SENTINEL}` || value === CONNECTOR_MANAGED_API_KEY_SENTINEL) return
      throw new Error("non-sentinel Authorization header is not allowed")
    }
    if (isCredentialLikeHeaderName(normalized)) throw new Error(`credential header is not allowed: ${redactText(key)}`)
    dropped.add(boundedHeaderName(key))
  })
  if (!out["Content-Type"]) throw new Error("connector model transport requires application/json content type")
  return out
}

function filterAnthropicHeaders(headers: Headers, dropped: Set<string>): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    const normalized = key.toLowerCase()
    if (normalized === "content-type") {
      if (!/^application\/json\b/i.test(value)) throw new Error("Anthropic Messages transport requires application/json content type")
      out["Content-Type"] = "application/json"
      return
    }
    if (normalized === "accept") {
      if (!/(^|,\s*)application\/json\b|^\*\/\*$/i.test(value)) throw new Error("Anthropic Messages transport accepts only JSON responses")
      out.Accept = "application/json"
      return
    }
    if (normalized === "x-api-key") {
      if (value !== CONNECTOR_MANAGED_API_KEY_SENTINEL) throw new Error("Anthropic x-api-key must contain the exact connector-managed sentinel")
      return
    }
    if (normalized === "anthropic-version") {
      if (value !== ANTHROPIC_MESSAGES_PROTOCOL_VERSION) throw new Error(`anthropic-version must be exactly ${ANTHROPIC_MESSAGES_PROTOCOL_VERSION}`)
      out["anthropic-version"] = ANTHROPIC_MESSAGES_PROTOCOL_VERSION
      return
    }
    if (normalized === "anthropic-beta") throw new Error("anthropic-beta is not allowed")
    if (normalized === "authorization") throw new Error("Authorization is not allowed for Anthropic Messages transport")
    if (isCredentialLikeHeaderName(normalized)) throw new Error(`credential header is not allowed: ${redactText(key)}`)
    if (!ANTHROPIC_DROPPED_SDK_HEADERS.has(normalized)) throw new Error(`Anthropic Messages header is not allowed: ${redactText(key)}`)
    dropped.add(boundedHeaderName(key))
  })
  if (!out["Content-Type"]) throw new Error("Anthropic Messages transport requires application/json content type")
  if (!out["anthropic-version"]) throw new Error("anthropic-version header is required")
  return out
}

function validateAnthropicMessagesBody(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (!ANTHROPIC_REQUEST_KEYS.has(key)) throw new Error(`Anthropic Messages field is not allowed: ${redactText(key)}`)
  }
  if (!Number.isInteger(payload.max_tokens) || Number(payload.max_tokens) < 1 || Number(payload.max_tokens) > 32_768) throw new Error("Anthropic Messages max_tokens must be an integer from 1 to 32768")
  if (payload.stream !== undefined && payload.stream !== false) throw new Error("Anthropic Messages streaming is not allowed")
  if (payload.temperature !== undefined && (typeof payload.temperature !== "number" || !Number.isFinite(payload.temperature) || payload.temperature < 0 || payload.temperature > 1)) throw new Error("Anthropic Messages temperature is invalid")
  validateAnthropicSystem(payload.system)
  if (!Array.isArray(payload.messages) || payload.messages.length === 0 || payload.messages.length > 256) throw new Error("Anthropic Messages messages must be a bounded nonempty array")
  for (const message of payload.messages) validateAnthropicMessage(message)
  if (payload.tools !== undefined) {
    if (!Array.isArray(payload.tools) || payload.tools.length === 0 || payload.tools.length > 64) throw new Error("Anthropic Messages tools must be a bounded nonempty array")
    for (const item of payload.tools) validateAnthropicClientTool(item)
  }
  validateAnthropicToolChoice(payload.tool_choice)
}

function validateAnthropicSystem(value: unknown): void {
  if (value === undefined) return
  if (typeof value === "string") {
    if (!value || Buffer.byteLength(value) > 12_000) throw new Error("Anthropic Messages system text is invalid")
    return
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) throw new Error("Anthropic Messages system must contain bounded text blocks")
  for (const block of value) {
    if (!isRecord(block) || !hasExactKeys(block, ["type", "text"]) || block.type !== "text" || typeof block.text !== "string") throw new Error("Anthropic Messages system contains a non-text or provider-option block")
  }
}

function validateAnthropicMessage(value: unknown): void {
  if (!isRecord(value) || !hasExactKeys(value, ["role", "content"])) throw new Error("Anthropic Messages message shape is invalid")
  if (value.role !== "user" && value.role !== "assistant") throw new Error("Anthropic Messages permits only user and assistant roles")
  if (typeof value.content === "string") {
    if (!value.content) throw new Error("Anthropic Messages text content must not be empty")
    return
  }
  if (!Array.isArray(value.content) || value.content.length === 0 || value.content.length > 128) throw new Error("Anthropic Messages content must be a bounded nonempty array")
  for (const block of value.content) validateAnthropicContentBlock(block, value.role)
}

function validateAnthropicContentBlock(value: unknown, role: "user" | "assistant"): void {
  if (!isRecord(value) || typeof value.type !== "string") throw new Error("Anthropic Messages content block is invalid")
  if (value.type === "text") {
    if (!hasExactKeys(value, ["type", "text"]) || typeof value.text !== "string") throw new Error("Anthropic Messages text block is invalid")
    return
  }
  if (value.type === "tool_use" && role === "assistant") {
    if (!hasExactKeys(value, ["type", "id", "name", "input"]) || !boundedIdentifier(value.id, 200) || !boundedIdentifier(value.name, 200) || !isRecord(value.input)) throw new Error("Anthropic Messages client tool_use block is invalid")
    return
  }
  if (value.type === "tool_result" && role === "user") {
    const allowed = new Set(["type", "tool_use_id", "content", "is_error"])
    if (Object.keys(value).some((key) => !allowed.has(key)) || !boundedIdentifier(value.tool_use_id, 200) || value.is_error !== undefined && typeof value.is_error !== "boolean") throw new Error("Anthropic Messages tool_result block is invalid")
    if (typeof value.content !== "string" && !isTextBlockArray(value.content)) throw new Error("Anthropic Messages tool_result content is invalid")
    return
  }
  throw new Error("Anthropic Messages content block type is not allowed")
}

function validateAnthropicClientTool(value: unknown): void {
  if (isRecord(value) && "type" in value) throw new Error("Anthropic server tool type is not allowed")
  if (!isRecord(value) || !hasExactKeys(value, ["name", "description", "input_schema"]) || !boundedIdentifier(value.name, 200) || typeof value.description !== "string" || !isRecord(value.input_schema)) throw new Error("Anthropic Messages client tool shape is invalid")
  if (/^(web_search|web_fetch|code_execution|computer|bash|str_replace|memory|tool_search|advisor)$/i.test(String(value.name))) throw new Error("Anthropic server tool is not allowed")
}

function validateAnthropicToolChoice(value: unknown): void {
  if (value === undefined) return
  if (!isRecord(value) || !hasExactKeys(value, ["type"]) || value.type !== "auto" && value.type !== "any") throw new Error("Anthropic Messages tool_choice is invalid")
}

function isTextBlockArray(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 64 && value.every((block) => isRecord(block) && hasExactKeys(block, ["type", "text"]) && block.type === "text" && typeof block.text === "string")
}

function hasExactKeys(value: Record<string, unknown>, allowedKeys: string[]): boolean {
  const allowed = new Set(allowedKeys)
  return Object.keys(value).every((key) => allowed.has(key)) && allowedKeys.every((key) => key in value)
}

function boundedIdentifier(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isCredentialLikeHeaderName(normalized: string): boolean {
  if (CREDENTIAL_HEADERS.has(normalized)) return true
  const compact = normalized.replace(/[^a-z0-9]/g, "")
  return (
    compact.includes("apikey") ||
    compact.includes("accesstoken") ||
    compact.includes("authtoken") ||
    compact.includes("credential") ||
    compact.includes("secret")
  )
}

function boundedHeaderName(name: string): string {
  const normalized = name.toLowerCase().replace(/[^\t\x20-\x7e]/g, "?")
  if (normalized.length <= MAX_DROPPED_HEADER_NAME_LENGTH) return normalized
  return `${normalized.slice(0, MAX_DROPPED_HEADER_NAME_LENGTH - 14)}...<truncated>`
}

function providerResponseBody(result: { ok: boolean; status_code?: number; request_id: string; response_body_for_internal_use?: string }, transportKind: CommanderConnectorModelTransportConfig["transport_kind"], expectedModelId: string): string {
  if (result.ok) {
    const body = result.response_body_for_internal_use ?? ""
    if (transportKind === "anthropic_messages_connector") validateAnthropicMessagesResponseBody(body, expectedModelId)
    return body
  }
  const status = typeof result.status_code === "number" ? result.status_code : 500
  if (transportKind === "anthropic_messages_connector") {
    return JSON.stringify({
      type: "error",
      error: {
        type: "api_error",
        message: `connector-backed Anthropic request failed with HTTP ${status}`,
      },
    })
  }
  return JSON.stringify({
    error: {
      message: `connector-backed provider request failed with HTTP ${status}`,
      type: "connector_backed_provider_http_error",
      code: `http_${status}`,
      request_id: result.request_id,
    },
  })
}

function validateAnthropicMessagesResponseBody(body: string, expectedModelId: string): void {
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    throw new Error("Anthropic Messages response must be valid JSON")
  }
  if (!isRecord(payload) || payload.type !== "message" || payload.role !== "assistant" || !boundedIdentifier(payload.id, 200) || !Array.isArray(payload.content) || payload.content.length === 0 || payload.content.length > 128) {
    throw new Error("Anthropic Messages response content is invalid")
  }
  if (payload.model !== expectedModelId) throw new Error("Anthropic Messages response model does not match configured authority")
  if (payload.stop_sequence !== null) throw new Error("Anthropic Messages response stop sequence is forbidden or unsupported")
  if (payload.stop_reason !== "end_turn" && payload.stop_reason !== "tool_use" && payload.stop_reason !== "refusal") {
    throw new Error("Anthropic Messages response stop reason is forbidden or unsupported")
  }
  let toolUseCount = 0
  let nonemptyTextCount = 0
  for (const block of payload.content) {
    if (!isRecord(block) || block.type !== "text" && block.type !== "tool_use") {
      throw new Error("Anthropic Messages response contains a forbidden or unsupported content block")
    }
    if (block.type === "text") {
      if (!hasExactKeys(block, ["type", "text"]) || typeof block.text !== "string" || !block.text.trim()) throw new Error("Anthropic Messages response text block is invalid")
      nonemptyTextCount += 1
    } else {
      if (!hasExactKeys(block, ["type", "id", "name", "input"]) || !boundedIdentifier(block.id, 200) || !boundedIdentifier(block.name, 200) || !isRecord(block.input)) throw new Error("Anthropic Messages response client tool block is invalid")
      toolUseCount += 1
    }
  }
  if ((payload.stop_reason === "tool_use") !== (toolUseCount > 0)) {
    throw new Error("Anthropic Messages response stop reason does not match client tool content")
  }
  if (payload.stop_reason !== "tool_use" && nonemptyTextCount === 0) throw new Error("Anthropic Messages final response requires nonempty text")
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
}

function boundedRequestedBy(context: ExternalApiConnectorFetchContext): string {
  return redactText(`${context.requested_by} commander_model_request_id=${context.commander_model_request_id} provider_id=${context.provider_id} model_id=${context.model_id}${context.investigation_id ? ` investigation_id=${context.investigation_id}` : ""}`).slice(0, 500)
}
