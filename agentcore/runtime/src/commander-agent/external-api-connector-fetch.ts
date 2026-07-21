import { redactText } from "../security/redaction"
import type { ExternalApiConnectorRegistry } from "../external-api/api-connector-registry"
import type { ExternalApiPersistedAuditRecord } from "../external-api/api-connector-types"
import type { ExternalApiRequestService } from "../external-api/api-request-service"
import { CONNECTOR_MANAGED_API_KEY_SENTINEL } from "./ai-sdk-commander-model-adapter"
import { connectorChatCompletionsUrl, type CommanderConnectorModelTransportConfig } from "./commander-connector-transport-types"

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
}

export type ExternalApiConnectorFetchOptions = {
  registry: ExternalApiConnectorRegistry
  requestService: ExternalApiRequestService
  config: CommanderConnectorModelTransportConfig
  context: ExternalApiConnectorFetchContext
}

const CREDENTIAL_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "x-api-key", "api-key"])
const MAX_DROPPED_HEADER_NAME_LENGTH = 80

export function createExternalApiConnectorFetch(options: ExternalApiConnectorFetchOptions): { fetch: typeof fetch; metadata: ExternalApiConnectorFetchMetadata } {
  const connector = options.registry.get(options.config.connector_id)
  if (!connector) throw new Error(`unknown connector: ${redactText(options.config.connector_id)}`)
  const expectedUrl = connectorChatCompletionsUrl(connector)
  const dropped = new Set<string>()
  const auditRecords: ExternalApiPersistedAuditRecord[] = []
  let attempts = 0
  const bridge = (async (input, init) => {
    attempts += 1
    const request = await parseBridgeRequest(input, init)
    validateBridgeRequest(request, expectedUrl, options.config)
    const headers = filterHeaders(request.headers, dropped)
    const result = await options.requestService.executeForInternalUse({
      connector_id: options.config.connector_id,
      method: "POST",
      path: expectedUrl.pathname,
      headers,
      body: request.body,
      requested_by: boundedRequestedBy(options.context),
    }, {
      timeout_ms: options.config.timeout_ms,
      max_response_bytes: options.config.max_response_bytes,
      abort_signal: request.signal ?? init?.signal ?? undefined,
      redact_response_body: false,
      omit_response_preview_from_audit: true,
      persist_audit: true,
      on_audit_persisted: (record) => auditRecords.push(record),
    })
    return new Response(result.response_body_for_internal_use ?? "", {
      status: result.status_code ?? 500,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch
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
  if (request.url.origin !== expectedUrl.origin || request.url.pathname !== expectedUrl.pathname) throw new Error("connector model transport URL does not match chat completions endpoint")
  if (request.url.search) throw new Error("connector model transport query parameters are not allowed")
  if (request.url.hash) throw new Error("connector model transport fragments are not allowed")
  if (!request.body) throw new Error("connector model transport body is required")
  const bytes = new TextEncoder().encode(request.body).byteLength
  if (bytes > config.max_request_bytes) throw new Error(`connector model request exceeds max_request_bytes: ${config.max_request_bytes}`)
  JSON.parse(request.body)
}

function filterHeaders(headers: Headers, dropped: Set<string>): Record<string, string> {
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
    if (CREDENTIAL_HEADERS.has(normalized)) throw new Error(`credential header is not allowed: ${redactText(key)}`)
    dropped.add(boundedHeaderName(key))
  })
  if (!out["Content-Type"]) throw new Error("connector model transport requires application/json content type")
  return out
}

function boundedHeaderName(name: string): string {
  const normalized = name.toLowerCase().replace(/[^\t\x20-\x7e]/g, "?")
  if (normalized.length <= MAX_DROPPED_HEADER_NAME_LENGTH) return normalized
  return `${normalized.slice(0, MAX_DROPPED_HEADER_NAME_LENGTH - 14)}...<truncated>`
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
}

function boundedRequestedBy(context: ExternalApiConnectorFetchContext): string {
  return redactText(`${context.requested_by} commander_model_request_id=${context.commander_model_request_id} provider_id=${context.provider_id} model_id=${context.model_id}${context.investigation_id ? ` investigation_id=${context.investigation_id}` : ""}`).slice(0, 500)
}
