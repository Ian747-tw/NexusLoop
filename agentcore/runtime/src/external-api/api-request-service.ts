import { randomUUID } from "node:crypto"
import type { EventStore } from "../events/event-store"
import { redactText, redactValue } from "../security/redaction"
import type {
  ExternalApiAuditRecord,
  ExternalApiConnector,
  ExternalApiMethod,
  ExternalApiRequestInput,
  ExternalApiRequestPreview,
  ExternalApiRequestResult,
} from "./api-connector-types"
import type { ExternalApiConnectorRegistry } from "./api-connector-registry"
import type { ExternalApiTransport } from "./api-transport"

const MAX_BODY_BYTES = 64 * 1024
const PREVIEW_BYTES = 512
const DANGEROUS_USER_HEADERS = new Set(["authorization", "cookie", "set-cookie", "proxy-authorization"])

export interface ExternalApiRequestServiceOptions {
  registry: ExternalApiConnectorRegistry
  transport: ExternalApiTransport
  eventStore: EventStore
  env?: Record<string, string | undefined>
  now?: () => Date
  requestId?: () => string
}

export class ExternalApiRequestService {
  private readonly env: Record<string, string | undefined>
  private readonly now: () => Date
  private readonly requestId: () => string

  constructor(private readonly options: ExternalApiRequestServiceOptions) {
    this.env = options.env ?? {}
    this.now = options.now ?? (() => new Date())
    this.requestId = options.requestId ?? (() => `api_${randomUUID()}`)
  }

  preview(input: ExternalApiRequestInput): ExternalApiRequestPreview {
    const built = this.build(input)
    return redactValue({
      connector_id: built.connector.connector_id,
      method: built.method,
      url: built.redactedUrl,
      allowed: built.blockers.length === 0,
      blockers: built.blockers.map(redactText),
      redacted_headers: built.redactedHeaders,
      has_body: built.body !== undefined,
      body_bytes: byteLength(built.body ?? ""),
      credential_refs_used: built.credentialRefsUsed,
    })
  }

  async execute(input: ExternalApiRequestInput): Promise<ExternalApiRequestResult> {
    const built = this.build(input)
    const createdAt = this.now().toISOString()
    const requestId = this.requestId()
    if (built.blockers.length > 0) {
      const result = this.result({
        requestId,
        connectorId: built.connector.connector_id,
        method: built.method,
        url: built.redactedUrl,
        ok: false,
        dryRun: input.dry_run === true,
        createdAt,
        error: built.blockers.join("; "),
      })
      await this.writeAudit("external_api_request_failed", result, input.requested_by)
      throw new Error(result.error ?? "external API request blocked")
    }
    if (input.dry_run === true) {
      return this.result({
        requestId,
        connectorId: built.connector.connector_id,
        method: built.method,
        url: built.redactedUrl,
        ok: true,
        dryRun: true,
        createdAt,
        responsePreview: "dry run: transport not called",
      })
    }
    try {
      const response = await this.options.transport.request({
        method: built.method,
        url: built.url.toString(),
        headers: built.headers,
        body: built.body,
        timeout_ms: built.connector.timeout_ms,
        max_response_bytes: built.connector.max_response_bytes,
      })
      const bodyBytes = byteLength(response.body)
      if (bodyBytes > built.connector.max_response_bytes) throw new Error(`response exceeded max_response_bytes: ${built.connector.max_response_bytes}`)
      const result = this.result({
        requestId,
        connectorId: built.connector.connector_id,
        method: built.method,
        url: built.redactedUrl,
        statusCode: response.status_code,
        ok: response.status_code >= 200 && response.status_code < 300,
        dryRun: false,
        createdAt,
        responseBytes: bodyBytes,
        responsePreview: preview(response.body),
      })
      await this.writeAudit(result.ok ? "external_api_request_executed" : "external_api_request_failed", result, input.requested_by)
      return result
    } catch (error) {
      const result = this.result({
        requestId,
        connectorId: built.connector.connector_id,
        method: built.method,
        url: built.redactedUrl,
        ok: false,
        dryRun: false,
        createdAt,
        error: error instanceof Error ? error.message : String(error),
      })
      await this.writeAudit("external_api_request_failed", result, input.requested_by)
      throw new Error(result.error ?? "external API request failed")
    }
  }

  async listAudit(limit = 20): Promise<ExternalApiAuditRecord[]> {
    const events = await this.options.eventStore.readAll()
    return events
      .filter((event) => event.kind === "external_api_request_executed" || event.kind === "external_api_request_failed")
      .reverse()
      .slice(0, Math.max(1, Math.min(limit, 100)))
      .map((event) => ({
        request_id: String(event.request_id ?? ""),
        connector_id: String(event.connector_id ?? ""),
        method: readMethod(String(event.method ?? "GET")),
        url: String(event.url ?? ""),
        status_code: typeof event.status_code === "number" ? event.status_code : undefined,
        ok: event.ok === true,
        dry_run: event.dry_run === true,
        requested_by: String(event.requested_by ?? "unknown"),
        error: typeof event.error === "string" ? event.error : undefined,
        created_at: String(event.created_at ?? event.timestamp ?? ""),
      }))
  }

  private build(input: ExternalApiRequestInput): BuiltRequest {
    const connector = this.options.registry.get(requiredString(input.connector_id, "connector_id"))
    if (!connector) throw new Error(`unknown external API connector: ${redactText(input.connector_id)}`)
    const method = readMethod(input.method)
    const blockers: string[] = []
    if (!connector.allowed_methods.includes(method)) blockers.push(`method not allowed: ${method}`)
    if (method === "GET" && input.body !== undefined) blockers.push("GET request body is not allowed")
    const bodyBytes = byteLength(input.body ?? "")
    if (bodyBytes > MAX_BODY_BYTES) blockers.push(`request body exceeds max bytes: ${MAX_BODY_BYTES}`)

    let url: URL
    try {
      url = resolveRequestUrl(connector, requiredString(input.path, "path"))
    } catch (error) {
      url = new URL(connector.base_url)
      blockers.push(error instanceof Error ? error.message : String(error))
    }
    if (!connector.allowed_hosts.includes(url.hostname)) blockers.push(`host not allowed: ${url.hostname}`)
    if (url.protocol !== "https:" && !(connector.allow_local_http && url.protocol === "http:" && isLocalTestHost(url.hostname))) blockers.push(`protocol not allowed: ${url.protocol}`)
    if (url.username || url.password) blockers.push("URL credentials are not allowed")
    if (isPrivateOrLocalHost(url.hostname) && !connector.allow_local_http) blockers.push(`local/private host is not allowed: ${url.hostname}`)
    for (const [key, value] of Object.entries(input.query ?? {})) {
      if (typeof value !== "string") blockers.push(`query value must be string: ${key}`)
      else url.searchParams.set(key, value)
    }

    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(connector.default_headers ?? {})) headers[key] = value
    for (const [key, value] of Object.entries(input.headers ?? {})) {
      if (typeof value !== "string") blockers.push(`header value must be string: ${key}`)
      else if (DANGEROUS_USER_HEADERS.has(key.toLowerCase())) blockers.push(`header is not allowed from user input: ${key}`)
      else headers[key] = value
    }

    const credentialRefsUsed: string[] = []
    const credentialTargets = new Set<string>()
    for (const ref of connector.credential_refs ?? []) {
      credentialRefsUsed.push(ref.name)
      credentialTargets.add(ref.inject_as === "header" ? `header:${ref.target_name.toLowerCase()}` : `query:${ref.target_name}`)
      const raw = this.env[ref.env_name]
      if (!raw) {
        blockers.push(`credential env var is missing: ${ref.name}`)
        continue
      }
      const injected = `${ref.prefix ?? ""}${raw}`
      if (ref.inject_as === "header") headers[ref.target_name] = injected
      else url.searchParams.set(ref.target_name, injected)
    }

    return {
      connector,
      method,
      url,
      redactedUrl: redactUrl(url, credentialTargets),
      headers,
      redactedHeaders: redactHeaders(headers, credentialTargets),
      body: input.body,
      blockers,
      credentialRefsUsed: credentialRefsUsed.map(redactText),
    }
  }

  private result(input: {
    requestId: string
    connectorId: string
    method: ExternalApiMethod
    url: string
    ok: boolean
    dryRun: boolean
    createdAt: string
    statusCode?: number
    responseBytes?: number
    responsePreview?: string
    error?: string
  }): ExternalApiRequestResult {
    return redactValue({
      request_id: input.requestId,
      connector_id: input.connectorId,
      method: input.method,
      url: input.url,
      status_code: input.statusCode,
      ok: input.ok,
      response_bytes: input.responseBytes,
      response_preview: input.responsePreview ? preview(input.responsePreview) : undefined,
      error: input.error ? redactText(input.error) : undefined,
      dry_run: input.dryRun,
      created_at: input.createdAt,
    })
  }

  private async writeAudit(kind: "external_api_request_executed" | "external_api_request_failed", result: ExternalApiRequestResult, requestedBy: string): Promise<void> {
    await this.options.eventStore.append({
      kind,
      request_id: result.request_id,
      connector_id: result.connector_id,
      method: result.method,
      url: result.url,
      status_code: result.status_code,
      ok: result.ok,
      dry_run: result.dry_run,
      requested_by: redactText(requestedBy),
      response_bytes: result.response_bytes,
      response_preview: result.response_preview,
      error: result.error,
      created_at: result.created_at,
    })
  }
}

interface BuiltRequest {
  connector: ExternalApiConnector
  method: ExternalApiMethod
  url: URL
  redactedUrl: string
  headers: Record<string, string>
  redactedHeaders: Record<string, string>
  body?: string
  blockers: string[]
  credentialRefsUsed: string[]
}

function resolveRequestUrl(connector: ExternalApiConnector, path: string): URL {
  if (path.startsWith("//")) throw new Error("protocol-relative URL is not allowed")
  const url = new URL(path, connector.base_url)
  if (["file:", "data:", "ftp:", "ssh:", "gopher:", "mailto:", "javascript:"].includes(url.protocol)) throw new Error(`protocol not allowed: ${url.protocol}`)
  return url
}

function redactUrl(url: URL, credentialTargets: Set<string>): string {
  const copy = new URL(url.toString())
  copy.username = ""
  copy.password = ""
  for (const key of Array.from(copy.searchParams.keys())) {
    if (credentialTargets.has(`query:${key}`) || /secret|token|api[_-]?key|password/i.test(key)) copy.searchParams.set(key, "[REDACTED]")
    else copy.searchParams.set(key, redactText(copy.searchParams.get(key) ?? ""))
  }
  return redactText(copy.toString())
}

function redactHeaders(headers: Record<string, string>, credentialTargets: Set<string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    out[key] = credentialTargets.has(`header:${key.toLowerCase()}`) || DANGEROUS_USER_HEADERS.has(key.toLowerCase())
      ? "[REDACTED]"
      : redactText(value)
  }
  return out
}

function isLocalTestHost(host: string): boolean {
  return host === "localhost" || host.endsWith(".test")
}

function isPrivateOrLocalHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[/, "").replace(/\]$/, "")
  return normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    /^f[cd][0-9a-f]{2}:/.test(normalized) ||
    /^fe[89ab][0-9a-f]:/.test(normalized) ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
}

function readMethod(value: unknown): ExternalApiMethod {
  if (value === "GET" || value === "POST") return value
  throw new Error("method must be GET or POST")
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function preview(value: string): string {
  const redacted = redactText(value)
  return truncateUtf8(redacted, PREVIEW_BYTES)
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(value)
  if (bytes.byteLength <= maxBytes) return value
  const decoder = new TextDecoder("utf-8", { fatal: true })
  for (let end = maxBytes; end > 0; end -= 1) {
    try {
      return decoder.decode(bytes.slice(0, end))
    } catch {
      // Keep backing off until the slice ends on a complete UTF-8 codepoint.
    }
  }
  return ""
}
