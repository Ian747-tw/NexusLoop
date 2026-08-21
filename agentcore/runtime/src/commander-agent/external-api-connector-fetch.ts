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
const GOOGLE_DROPPED_SDK_HEADERS = new Set(["user-agent", "x-ai-sdk-version", "x-vercel-ai-sdk", "x-vercel-ai-sdk-version"])
const GOOGLE_REQUEST_KEYS = new Set(["contents", "systemInstruction", "generationConfig", "tools", "toolConfig"])
const OPENAI_RESPONSES_DROPPED_SDK_HEADERS = new Set(["user-agent", "x-ai-sdk-version", "x-vercel-ai-sdk", "x-vercel-ai-sdk-version"])
const OPENAI_RESPONSES_REQUEST_KEYS = new Set(["model", "input", "temperature", "top_p", "max_output_tokens", "store", "tools", "tool_choice"])
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
  const expectedUrl = connectorModelRequestUrl(connector, config.transport_kind, config.model_id)
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
      : config.transport_kind === "google_generative_ai_connector"
        ? "connector model transport URL does not match Google generateContent endpoint"
        : config.transport_kind === "openai_responses_connector"
          ? "connector model transport URL does not match OpenAI Responses endpoint"
        : "connector model transport URL does not match chat completions endpoint")
  }
  if (request.url.search) throw new Error("connector model transport query parameters are not allowed")
  if (request.url.hash) throw new Error("connector model transport fragments are not allowed")
  if (!request.body) throw new Error("connector model transport body is required")
  const bytes = new TextEncoder().encode(request.body).byteLength
  if (bytes > config.max_request_bytes) throw new Error(`connector model request exceeds max_request_bytes: ${config.max_request_bytes}`)
  const payload = JSON.parse(request.body) as unknown
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("connector model transport body must be a JSON object")
  if (config.transport_kind === "google_generative_ai_connector") {
    validateGoogleGenerateContentBody(payload as Record<string, unknown>, config.model_id)
    request.body = JSON.stringify(payload)
    if (new TextEncoder().encode(request.body).byteLength > config.max_request_bytes) throw new Error(`connector model request exceeds max_request_bytes: ${config.max_request_bytes}`)
  }
  else {
    const model = (payload as { model?: unknown }).model
    if (typeof model !== "string" || model !== config.model_id) throw new Error("connector model transport model does not match configured model_id")
    if (config.transport_kind === "anthropic_messages_connector") validateAnthropicMessagesBody(payload as Record<string, unknown>)
    if (config.transport_kind === "openai_responses_connector") validateOpenAIResponsesBody(payload as Record<string, unknown>)
  }
}

function filterHeaders(headers: Headers, dropped: Set<string>, config: CommanderConnectorModelTransportConfig): Record<string, string> {
  if (config.transport_kind === "anthropic_messages_connector") return filterAnthropicHeaders(headers, dropped)
  if (config.transport_kind === "google_generative_ai_connector") return filterGoogleHeaders(headers, dropped)
  if (config.transport_kind === "openai_responses_connector") return filterOpenAIResponsesHeaders(headers, dropped)
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

function filterOpenAIResponsesHeaders(headers: Headers, dropped: Set<string>): Record<string, string> {
  const out: Record<string, string> = {}
  let sentinelCount = 0
  headers.forEach((value, key) => {
    const normalized = key.toLowerCase()
    if (normalized === "content-type") {
      if (!/^application\/json\b/i.test(value)) throw new Error("OpenAI Responses transport requires application/json content type")
      out["Content-Type"] = "application/json"
      return
    }
    if (normalized === "accept") {
      if (!/(^|,\s*)application\/json\b|^\*\/\*$/i.test(value)) throw new Error("OpenAI Responses transport accepts only JSON responses")
      out.Accept = "application/json"
      return
    }
    if (normalized === "authorization") {
      if (value !== `Bearer ${CONNECTOR_MANAGED_API_KEY_SENTINEL}`) throw new Error("OpenAI Responses Authorization must contain the exact connector-managed bearer sentinel")
      sentinelCount += 1
      return
    }
    if (normalized === "cookie" || normalized === "openai-organization" || normalized === "openai-project") throw new Error("OpenAI Responses caller authentication or account headers are not allowed")
    if (isCredentialLikeHeaderName(normalized)) throw new Error(`credential header is not allowed: ${redactText(key)}`)
    if (!OPENAI_RESPONSES_DROPPED_SDK_HEADERS.has(normalized)) throw new Error(`OpenAI Responses header is not allowed: ${redactText(key)}`)
    dropped.add(boundedHeaderName(key))
  })
  if (!out["Content-Type"]) throw new Error("OpenAI Responses transport requires application/json content type")
  if (sentinelCount !== 1) throw new Error("OpenAI Responses transport requires one connector-managed bearer sentinel")
  return out
}

function validateOpenAIResponsesBody(payload: Record<string, unknown>): void {
  if (Object.keys(payload).some((key) => !OPENAI_RESPONSES_REQUEST_KEYS.has(key))) throw new Error("OpenAI Responses request contains a forbidden field")
  if (payload.store !== false) throw new Error("OpenAI Responses request must set store=false")
  if (!Number.isInteger(payload.max_output_tokens) || Number(payload.max_output_tokens) < 1 || Number(payload.max_output_tokens) > 1_000_000) throw new Error("OpenAI Responses max_output_tokens is invalid")
  if (payload.temperature !== undefined && (typeof payload.temperature !== "number" || !Number.isFinite(payload.temperature) || payload.temperature < 0 || payload.temperature > 2)) throw new Error("OpenAI Responses temperature is invalid")
  if (payload.top_p !== undefined && (typeof payload.top_p !== "number" || !Number.isFinite(payload.top_p) || payload.top_p < 0 || payload.top_p > 1)) throw new Error("OpenAI Responses top_p is invalid")
  if (!Array.isArray(payload.input) || payload.input.length === 0 || payload.input.length > 256) throw new Error("OpenAI Responses input must be a bounded nonempty array")
  for (const item of payload.input) validateOpenAIResponsesInputItem(item)
  if (payload.tools !== undefined) {
    if (!Array.isArray(payload.tools) || payload.tools.length > 64) throw new Error("OpenAI Responses tools must be a bounded array")
    for (const tool of payload.tools) {
      if (!isRecord(tool) || !hasOnlyKeys(tool, ["type", "name", "description", "parameters", "strict"]) || tool.type !== "function" || !boundedIdentifier(tool.name, 200) || tool.description !== undefined && typeof tool.description !== "string" || !isRecord(tool.parameters) || tool.strict !== undefined && typeof tool.strict !== "boolean") throw new Error("OpenAI Responses request contains a forbidden or malformed tool")
    }
  }
  const choice = payload.tool_choice
  if (choice !== undefined && choice !== "auto" && choice !== "none" && choice !== "required" && (!isRecord(choice) || !hasExactKeys(choice, ["type", "name"]) || choice.type !== "function" || !boundedIdentifier(choice.name, 200))) throw new Error("OpenAI Responses tool_choice is invalid")
}

function validateOpenAIResponsesInputItem(value: unknown): void {
  if (!isRecord(value)) throw new Error("OpenAI Responses input item is invalid")
  if (value.type === "function_call") {
    if (!hasExactKeys(value, ["type", "call_id", "name", "arguments"]) || !boundedIdentifier(value.call_id, 200) || !boundedIdentifier(value.name, 200) || typeof value.arguments !== "string" || Buffer.byteLength(value.arguments) > 32_768) throw new Error("OpenAI Responses function_call input is invalid")
    let argumentsValue: unknown
    try { argumentsValue = JSON.parse(value.arguments) } catch { throw new Error("OpenAI Responses function_call input arguments are malformed") }
    if (!isRecord(argumentsValue)) throw new Error("OpenAI Responses function_call input arguments must be an object")
    return
  }
  if (value.type === "function_call_output") {
    if (!hasExactKeys(value, ["type", "call_id", "output"]) || !boundedIdentifier(value.call_id, 200) || typeof value.output !== "string" || Buffer.byteLength(value.output) > 65_536) throw new Error("OpenAI Responses function_call_output input is invalid")
    return
  }
  if (!hasExactKeys(value, ["role", "content"]) || value.role !== "system" && value.role !== "developer" && value.role !== "user" && value.role !== "assistant") throw new Error("OpenAI Responses message input is invalid")
  if (value.role === "system" || value.role === "developer") {
    if (typeof value.content !== "string" || !value.content.trim() || Buffer.byteLength(value.content) > 12_000) throw new Error("OpenAI Responses system instruction is invalid")
    return
  }
  if (!Array.isArray(value.content) || value.content.length === 0 || value.content.length > 128) throw new Error("OpenAI Responses message input is invalid")
  for (const part of value.content) {
    const expectedType = value.role === "assistant" ? "output_text" : "input_text"
    if (!isRecord(part) || !hasExactKeys(part, ["type", "text"]) || part.type !== expectedType || typeof part.text !== "string" || Buffer.byteLength(part.text) > 65_536) throw new Error("OpenAI Responses message content is invalid")
  }
}

function filterGoogleHeaders(headers: Headers, dropped: Set<string>): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    const normalized = key.toLowerCase()
    if (normalized === "content-type") {
      if (!/^application\/json\b/i.test(value)) throw new Error("Google Generative AI transport requires application/json content type")
      out["Content-Type"] = "application/json"
      return
    }
    if (normalized === "accept") {
      if (!/(^|,\s*)application\/json\b|^\*\/\*$/i.test(value)) throw new Error("Google Generative AI transport accepts only JSON responses")
      out.Accept = "application/json"
      return
    }
    if (normalized === "x-goog-api-key") {
      if (value !== CONNECTOR_MANAGED_API_KEY_SENTINEL) throw new Error("Google x-goog-api-key must contain the exact connector-managed sentinel")
      return
    }
    if (normalized === "authorization" || normalized === "cookie") throw new Error("authorization and cookies are not allowed for Google Generative AI transport")
    if (isCredentialLikeHeaderName(normalized)) throw new Error(`credential header is not allowed: ${redactText(key)}`)
    if (!GOOGLE_DROPPED_SDK_HEADERS.has(normalized)) throw new Error(`Google Generative AI header is not allowed: ${redactText(key)}`)
    dropped.add(boundedHeaderName(key))
  })
  if (!out["Content-Type"]) throw new Error("Google Generative AI transport requires application/json content type")
  return out
}

function validateGoogleGenerateContentBody(payload: Record<string, unknown>, modelId: string): void {
  if (Object.keys(payload).some((key) => !GOOGLE_REQUEST_KEYS.has(key))) throw new Error("Google generateContent request contains a forbidden field")
  if (!Array.isArray(payload.contents) || payload.contents.length === 0 || payload.contents.length > 256) throw new Error("Google generateContent contents must be a bounded nonempty array")
  for (const content of payload.contents) validateGoogleContent(content, modelId)
  if (payload.systemInstruction !== undefined) validateGoogleSystemInstruction(payload.systemInstruction)
  if (!isRecord(payload.generationConfig)) throw new Error("Google generateContent generationConfig is required")
  const generationKeys = new Set(["maxOutputTokens", "temperature"])
  if (Object.keys(payload.generationConfig).some((key) => !generationKeys.has(key))) throw new Error("Google generateContent generationConfig contains a forbidden feature")
  if (!Number.isInteger(payload.generationConfig.maxOutputTokens) || Number(payload.generationConfig.maxOutputTokens) < 1 || Number(payload.generationConfig.maxOutputTokens) > 32_768) throw new Error("Google generateContent maxOutputTokens is invalid")
  if (payload.generationConfig.temperature !== undefined && (typeof payload.generationConfig.temperature !== "number" || !Number.isFinite(payload.generationConfig.temperature) || payload.generationConfig.temperature < 0 || payload.generationConfig.temperature > 2)) throw new Error("Google generateContent temperature is invalid")
  if (payload.tools !== undefined) validateGoogleClientTools(payload.tools)
  if (payload.toolConfig !== undefined) validateGoogleToolConfig(payload.toolConfig)
}

function validateGoogleSystemInstruction(value: unknown): void {
  if (!isRecord(value) || !hasExactKeys(value, ["parts"]) || !isTextParts(value.parts, 16)) throw new Error("Google systemInstruction must contain bounded text only")
}

function validateGoogleContent(value: unknown, modelId: string): void {
  if (!isRecord(value) || !hasExactKeys(value, ["role", "parts"]) || value.role !== "user" && value.role !== "model" || !Array.isArray(value.parts) || value.parts.length === 0 || value.parts.length > 128) throw new Error("Google content shape is invalid")
  let modelFunctionCalls = 0
  for (const part of value.parts) {
    if (!isRecord(part)) throw new Error("Google content part is invalid")
    if (hasExactKeys(part, ["text"]) && typeof part.text === "string" && part.text) continue
    if (value.role === "model" && (hasExactKeys(part, ["functionCall", "thoughtSignature"]) || hasExactKeys(part, ["functionCall"]))) {
      if (!isRecord(part.functionCall) || !hasExactKeys(part.functionCall, ["id", "name", "args"]) || !boundedIdentifier(part.functionCall.id, 200) || !boundedIdentifier(part.functionCall.name, 200) || !isRecord(part.functionCall.args)) throw new Error("Google client functionCall part is invalid")
      if (googleModelRequiresThoughtSignature(modelId) && modelFunctionCalls === 0 && (!boundedIdentifier(part.thoughtSignature, 4096) || part.thoughtSignature === "skip_thought_signature_validator")) throw new Error("Google first Gemini 3 function call requires an observed thought signature")
      if (googleModelRequiresThoughtSignature(modelId) && modelFunctionCalls > 0 && part.thoughtSignature === "skip_thought_signature_validator") delete part.thoughtSignature
      if (part.thoughtSignature !== undefined && (!boundedIdentifier(part.thoughtSignature, 4096) || part.thoughtSignature === "skip_thought_signature_validator")) throw new Error("Google thought signature is invalid")
      modelFunctionCalls += 1
      continue
    }
    if (value.role === "user" && hasExactKeys(part, ["functionResponse"])) {
      if (!isRecord(part.functionResponse) || !hasExactKeys(part.functionResponse, ["id", "name", "response"]) || !boundedIdentifier(part.functionResponse.id, 200) || !boundedIdentifier(part.functionResponse.name, 200) || !isRecord(part.functionResponse.response) || !hasExactKeys(part.functionResponse.response, ["name", "content"]) || part.functionResponse.response.name !== part.functionResponse.name || typeof part.functionResponse.response.content !== "string") throw new Error("Google client functionResponse part is invalid")
      continue
    }
    throw new Error("Google content contains a forbidden multimodal, reasoning, or server-tool part")
  }
}

function validateGoogleClientTools(value: unknown): void {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0]) || !hasExactKeys(value[0], ["functionDeclarations"]) || !Array.isArray(value[0].functionDeclarations) || value[0].functionDeclarations.length === 0 || value[0].functionDeclarations.length > 64) throw new Error("Google tools must contain one bounded client function declaration set")
  for (const declaration of value[0].functionDeclarations) {
    if (!isRecord(declaration)) throw new Error("Google client function declaration is invalid")
    const keys = declaration.parameters === undefined ? ["name", "description"] : ["name", "description", "parameters"]
    if (!hasExactKeys(declaration, keys) || !boundedIdentifier(declaration.name, 200) || typeof declaration.description !== "string" || declaration.parameters !== undefined && !isRecord(declaration.parameters)) throw new Error("Google client function declaration is invalid")
  }
}

function validateGoogleToolConfig(value: unknown): void {
  if (!isRecord(value) || !hasExactKeys(value, ["functionCallingConfig"]) || !isRecord(value.functionCallingConfig)) throw new Error("Google toolConfig is invalid")
  const config = value.functionCallingConfig
  if (config.mode !== "AUTO" && config.mode !== "NONE" && config.mode !== "ANY") throw new Error("Google function calling mode is invalid")
  const keys = config.mode === "ANY" && config.allowedFunctionNames !== undefined ? ["mode", "allowedFunctionNames"] : ["mode"]
  if (!hasExactKeys(config, keys)) throw new Error("Google function calling config is invalid")
  if (config.allowedFunctionNames !== undefined && (!Array.isArray(config.allowedFunctionNames) || config.allowedFunctionNames.length === 0 || config.allowedFunctionNames.some((item) => !boundedIdentifier(item, 200)))) throw new Error("Google allowed function names are invalid")
}

function isTextParts(value: unknown, max: number): boolean {
  return Array.isArray(value) && value.length > 0 && value.length <= max && value.every((part) => isRecord(part) && hasExactKeys(part, ["text"]) && typeof part.text === "string" && part.text.length > 0)
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

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: string[]): boolean {
  const allowed = new Set(allowedKeys)
  return Object.keys(value).every((key) => allowed.has(key))
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
    if (transportKind === "google_generative_ai_connector") return validateGoogleGenerateContentResponseBody(body, expectedModelId)
    if (transportKind === "openai_responses_connector") return validateOpenAIResponsesResponseBody(body, expectedModelId)
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
  if (transportKind === "google_generative_ai_connector") {
    return JSON.stringify({ error: { code: status, message: `connector-backed Google request failed with HTTP ${status}`, status: "UNKNOWN" } })
  }
  if (transportKind === "openai_responses_connector") {
    return JSON.stringify({ error: { message: `connector-backed OpenAI Responses request failed with HTTP ${status}`, type: "connector_backed_provider_http_error", code: `http_${status}` } })
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

function validateOpenAIResponsesResponseBody(body: string, expectedModelId: string): string {
  let payload: unknown
  try { payload = JSON.parse(body) } catch { throw new Error("OpenAI Responses response must be valid JSON") }
  const allowed = ["id", "object", "created_at", "status", "background", "error", "incomplete_details", "instructions", "max_output_tokens", "metadata", "model", "output", "parallel_tool_calls", "previous_response_id", "prompt_cache_key", "reasoning", "service_tier", "store", "temperature", "text", "tool_choice", "tools", "top_logprobs", "top_p", "truncation", "usage", "user"]
  if (!isRecord(payload) || !hasOnlyKeys(payload, allowed) || payload.object !== undefined && payload.object !== "response" || payload.status !== "completed" || payload.error !== null && payload.error !== undefined || payload.incomplete_details !== null && payload.incomplete_details !== undefined || !openAIResponsesModelMatches(expectedModelId, payload.model) || !validOpenAIResponsesInertEnvelope(payload) || !boundedIdentifier(payload.id, 200) || typeof payload.created_at !== "number" || !Number.isFinite(payload.created_at) || payload.background !== undefined && payload.background !== false || payload.previous_response_id !== undefined && payload.previous_response_id !== null || payload.store !== undefined && payload.store !== false) throw new Error("OpenAI Responses response identity or terminal state is invalid")
  if (payload.reasoning !== undefined && payload.reasoning !== null && (!isRecord(payload.reasoning) || !hasOnlyKeys(payload.reasoning, ["effort", "summary"]) || payload.reasoning.effort !== null && payload.reasoning.effort !== undefined || payload.reasoning.summary !== null && payload.reasoning.summary !== undefined)) throw new Error("OpenAI Responses reasoning output is forbidden")
  if (!validOpenAIResponsesUsage(payload.usage)) throw new Error("OpenAI Responses usage is invalid")
  if (!Array.isArray(payload.output) || payload.output.length === 0 || payload.output.length > 128) throw new Error("OpenAI Responses output is invalid")
  let hasText = false
  let hasRefusal = false
  let hasFunctionCall = false
  const normalizedOutput: unknown[] = []
  for (const item of payload.output) {
    if (!isRecord(item)) throw new Error("OpenAI Responses output item is invalid")
    if (item.type === "function_call") {
      if (!hasOnlyKeys(item, ["type", "id", "call_id", "name", "arguments", "status"]) || !boundedIdentifier(item.id, 200) || !boundedIdentifier(item.call_id, 200) || !boundedIdentifier(item.name, 200) || typeof item.arguments !== "string" || Buffer.byteLength(item.arguments) > 32_768 || item.status !== "completed") throw new Error("OpenAI Responses function call is invalid")
      let args: unknown
      try { args = JSON.parse(item.arguments) } catch { throw new Error("OpenAI Responses function call arguments are malformed") }
      if (!isRecord(args)) throw new Error("OpenAI Responses function call arguments must be an object")
      hasFunctionCall = true
      normalizedOutput.push(item)
      continue
    }
    if (item.type !== "message" || !hasOnlyKeys(item, ["type", "id", "status", "role", "content"]) || !boundedIdentifier(item.id, 200) || item.status !== "completed" || item.role !== "assistant" || !Array.isArray(item.content) || item.content.length === 0 || item.content.length > 64) throw new Error("OpenAI Responses message output is invalid")
    const content: unknown[] = []
    for (const part of item.content) {
      if (!isRecord(part) || part.type !== "output_text" && part.type !== "refusal" || !hasOnlyKeys(part, part.type === "output_text" ? ["type", "text", "annotations", "logprobs"] : ["type", "refusal"])) throw new Error("OpenAI Responses message content is invalid")
      const text = part.type === "refusal" ? part.refusal : part.text
      if (typeof text !== "string" || !text.trim() || Buffer.byteLength(text) > 65_536 || part.type === "output_text" && (!Array.isArray(part.annotations) || part.annotations.length !== 0 || part.logprobs !== undefined && part.logprobs !== null)) throw new Error("OpenAI Responses text or refusal content is invalid")
      hasRefusal ||= part.type === "refusal"
      hasText ||= part.type === "output_text"
      content.push({ type: "output_text", text, annotations: [] })
    }
    normalizedOutput.push({ type: "message", id: item.id, role: "assistant", content })
  }
  if (hasRefusal && (hasText || hasFunctionCall)) throw new Error("OpenAI Responses refusal cannot be combined with other output")
  if (!hasRefusal && !hasText && !hasFunctionCall) throw new Error("OpenAI Responses completed output is empty")
  return JSON.stringify({
    id: "nexusloop_response",
    created_at: 0,
    error: null,
    model: expectedModelId,
    output: normalizedOutput,
    reasoning: null,
    service_tier: null,
    incomplete_details: hasRefusal ? { reason: "content_filter" } : null,
    usage: payload.usage,
  })
}

function validOpenAIResponsesInertEnvelope(payload: Record<string, unknown>): boolean {
  if (payload.metadata !== undefined && payload.metadata !== null) {
    if (!isRecord(payload.metadata)) return false
    const entries = Object.entries(payload.metadata)
    if (entries.length > 16 || entries.some(([key, value]) => !boundedSafeMetadataString(key, 64) || typeof value !== "string" || value.length > 512)) return false
  }
  if (payload.user !== undefined && payload.user !== null && !boundedSafeMetadataString(payload.user, 256)) return false
  if (payload.prompt_cache_key !== undefined && payload.prompt_cache_key !== null && !boundedSafeMetadataString(payload.prompt_cache_key, 64)) return false
  if (payload.top_logprobs !== undefined && payload.top_logprobs !== null && (!nonnegativeInteger(payload.top_logprobs) || Number(payload.top_logprobs) > 20)) return false
  return true
}

function openAIResponsesModelMatches(expectedModelId: string, returnedModelId: unknown): boolean {
  if (returnedModelId === expectedModelId) return true
  if (typeof returnedModelId !== "string" || returnedModelId.length > 200) return false
  if (/\d{4}-\d{2}-\d{2}$/.test(expectedModelId)) return false
  const prefix = `${expectedModelId}-`
  if (!returnedModelId.startsWith(prefix)) return false
  const snapshot = returnedModelId.slice(prefix.length)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(snapshot)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function validOpenAIResponsesUsage(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ["input_tokens", "output_tokens", "total_tokens", "input_tokens_details", "output_tokens_details"]) || !nonnegativeInteger(value.input_tokens) || !nonnegativeInteger(value.output_tokens) || !nonnegativeInteger(value.total_tokens) || Number(value.total_tokens) !== Number(value.input_tokens) + Number(value.output_tokens)) return false
  if (value.input_tokens_details !== undefined && value.input_tokens_details !== null && (!isRecord(value.input_tokens_details) || !hasOnlyKeys(value.input_tokens_details, ["cached_tokens", "cache_write_tokens"]) || value.input_tokens_details.cached_tokens !== undefined && value.input_tokens_details.cached_tokens !== null && !nonnegativeInteger(value.input_tokens_details.cached_tokens) || value.input_tokens_details.cache_write_tokens !== undefined && value.input_tokens_details.cache_write_tokens !== null && !nonnegativeInteger(value.input_tokens_details.cache_write_tokens))) return false
  if (value.output_tokens_details !== undefined && value.output_tokens_details !== null && (!isRecord(value.output_tokens_details) || !hasOnlyKeys(value.output_tokens_details, ["reasoning_tokens"]) || value.output_tokens_details.reasoning_tokens !== undefined && value.output_tokens_details.reasoning_tokens !== null && value.output_tokens_details.reasoning_tokens !== 0)) return false
  return true
}

function validateGoogleGenerateContentResponseBody(body: string, expectedModelId: string): string {
  let payload: unknown
  try { payload = JSON.parse(body) } catch { throw new Error("Google generateContent response must be valid JSON") }
  if (!isRecord(payload) || !hasOnlyKeys(payload, ["candidates", "promptFeedback", "usageMetadata", "modelVersion", "responseId"]) || payload.modelVersion !== undefined && !boundedSafeMetadataString(payload.modelVersion, 200) || payload.responseId !== undefined && !boundedIdentifier(payload.responseId, 200) || payload.promptFeedback !== undefined && !validGooglePromptFeedback(payload.promptFeedback)) throw new Error("Google generateContent response identity or shape is invalid")
  const candidatesMissing = payload.candidates === undefined || Array.isArray(payload.candidates) && payload.candidates.length === 0
  const promptBlockFinishReason = candidatesMissing ? googlePromptBlockFinishReason(payload.promptFeedback) : undefined
  if (payload.usageMetadata === undefined) {
    if (promptBlockFinishReason === undefined) throw new Error("Google usage metadata is required")
  } else if (!validGoogleUsageMetadata(payload.usageMetadata, promptBlockFinishReason !== undefined)) throw new Error("Google usage metadata is invalid")
  if (candidatesMissing) {
    const finishReason = promptBlockFinishReason
    if (!finishReason) throw new Error("Google generateContent requires exactly one candidate or a bounded prompt block")
    return JSON.stringify({
      ...payload,
      candidates: [{ content: { role: "model", parts: [] }, finishReason, index: 0 }],
    })
  }
  if (!Array.isArray(payload.candidates) || payload.candidates.length !== 1) throw new Error("Google generateContent requires exactly one candidate")
  const candidate = payload.candidates[0]
  if (!isRecord(candidate) || !hasOnlyKeys(candidate, ["content", "finishReason", "finishMessage", "index", "safetyRatings", "avgLogprobs", "citationMetadata", "tokenCount"]) || !("finishReason" in candidate) || !("index" in candidate) || candidate.index !== 0 || !validGoogleCandidateMetadata(candidate)) throw new Error("Google generateContent candidate is invalid")
  if (candidate.finishReason !== "STOP" && candidate.finishReason !== "SAFETY" && candidate.finishReason !== "RECITATION" && candidate.finishReason !== "BLOCKLIST" && candidate.finishReason !== "PROHIBITED_CONTENT" && candidate.finishReason !== "SPII" && candidate.finishReason !== "IMAGE_SAFETY") throw new Error("Google generateContent finish reason is forbidden, ambiguous, or truncated")
  const blocked = candidate.finishReason !== "STOP"
  let parts: unknown[] = []
  if (candidate.content !== undefined) {
    if (!isRecord(candidate.content) || !hasExactKeys(candidate.content, ["role", "parts"]) || candidate.content.role !== "model" || !Array.isArray(candidate.content.parts) || candidate.content.parts.length > 128 || !blocked && candidate.content.parts.length === 0) throw new Error("Google generateContent candidate content is invalid")
    parts = candidate.content.parts
  } else if (!blocked) {
    throw new Error("Google final response requires candidate content")
  }
  let calls = 0
  let texts = 0
  for (const part of parts) {
    if (!isRecord(part)) throw new Error("Google generateContent response part is invalid")
    if (hasExactKeys(part, ["text"]) && typeof part.text === "string" && part.text.trim()) { texts += 1; continue }
    if (hasOnlyKeys(part, ["functionCall", "thoughtSignature"]) && "functionCall" in part) {
      const signatureRequired = googleModelRequiresThoughtSignature(expectedModelId) && calls === 0
      const signatureValid = boundedIdentifier(part.thoughtSignature, 4096) && part.thoughtSignature !== "skip_thought_signature_validator"
      if (!isRecord(part.functionCall) || !hasOnlyKeys(part.functionCall, ["id", "name", "args"]) || !("name" in part.functionCall) || !("args" in part.functionCall) || part.functionCall.id !== undefined && !boundedIdentifier(part.functionCall.id, 200) || !boundedIdentifier(part.functionCall.name, 200) || !isRecord(part.functionCall.args) || signatureRequired && !signatureValid || part.thoughtSignature !== undefined && !signatureValid) throw new Error("Google client function call response is invalid")
      calls += 1
      continue
    }
    throw new Error("Google response contains unsupported content, reasoning, media, grounding, or server tools")
  }
  if (candidate.finishReason === "STOP" && calls === 0 && texts === 0) throw new Error("Google final response requires bounded text or client function calls")
  if (blocked && calls > 0) throw new Error("Google blocked response cannot contain executable function calls")
  if (blocked) {
    return JSON.stringify({
      ...payload,
      candidates: [{ ...candidate, content: { role: "model", parts: [] } }],
    })
  }
  return body
}

function validGooglePromptFeedback(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ["blockReason", "blockReasonMessage", "safetyRatings"])) return false
  if (value.blockReason !== undefined && value.blockReason !== null && !boundedIdentifier(value.blockReason, 80)) return false
  if (value.blockReasonMessage !== undefined && value.blockReasonMessage !== null && (typeof value.blockReasonMessage !== "string" || value.blockReasonMessage.length === 0 || Buffer.byteLength(value.blockReasonMessage) > 1000)) return false
  return value.safetyRatings === undefined || value.safetyRatings === null || validGoogleSafetyRatings(value.safetyRatings)
}

function googlePromptBlockFinishReason(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  const reason = value.blockReason
  return reason === "SAFETY" || reason === "BLOCKLIST" || reason === "PROHIBITED_CONTENT" || reason === "IMAGE_SAFETY" || reason === "SPII" || reason === "RECITATION" ? reason : undefined
}

function googleModelRequiresThoughtSignature(modelId: string): boolean {
  return /^gemini-3(?:[.-]|$)/i.test(modelId)
}

function validGoogleCandidateMetadata(candidate: Record<string, unknown>): boolean {
  if (candidate.finishMessage !== undefined && candidate.finishMessage !== null && (typeof candidate.finishMessage !== "string" || candidate.finishMessage.length > 500)) return false
  if (candidate.avgLogprobs !== undefined && candidate.avgLogprobs !== null && (typeof candidate.avgLogprobs !== "number" || !Number.isFinite(candidate.avgLogprobs))) return false
  if (candidate.tokenCount !== undefined && candidate.tokenCount !== null && !nonnegativeInteger(candidate.tokenCount)) return false
  if (candidate.safetyRatings !== undefined && candidate.safetyRatings !== null && !validGoogleSafetyRatings(candidate.safetyRatings)) return false
  return candidate.citationMetadata === undefined || candidate.citationMetadata === null || validGoogleCitationMetadata(candidate.citationMetadata)
}

function validGoogleSafetyRatings(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 32) return false
  return value.every((rating) => {
    if (!isRecord(rating) || !hasOnlyKeys(rating, ["category", "probability", "probabilityScore", "severity", "severityScore", "blocked"])) return false
    for (const key of ["category", "probability", "severity"]) {
      if (rating[key] !== undefined && rating[key] !== null && !boundedIdentifier(rating[key], 80)) return false
    }
    for (const key of ["probabilityScore", "severityScore"]) {
      if (rating[key] !== undefined && rating[key] !== null && (typeof rating[key] !== "number" || !Number.isFinite(rating[key]))) return false
    }
    return rating.blocked === undefined || rating.blocked === null || typeof rating.blocked === "boolean"
  })
}

function validGoogleCitationMetadata(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["citationSources"]) || !Array.isArray(value.citationSources) || value.citationSources.length > 32) return false
  return value.citationSources.every((source) => {
    if (!isRecord(source) || !hasOnlyKeys(source, ["startIndex", "endIndex", "uri", "license"])) return false
    if (source.startIndex !== undefined && !nonnegativeInteger(source.startIndex)) return false
    if (source.endIndex !== undefined && !nonnegativeInteger(source.endIndex)) return false
    if (typeof source.startIndex === "number" && typeof source.endIndex === "number" && source.endIndex < source.startIndex) return false
    if (source.license !== undefined && source.license !== null && !boundedIdentifier(source.license, 200)) return false
    if (source.uri === undefined || source.uri === null) return true
    if (typeof source.uri !== "string" || source.uri.length === 0 || source.uri.length > 2048) return false
    try {
      const parsed = new URL(source.uri)
      return (parsed.protocol === "https:" || parsed.protocol === "http:") && !parsed.username && !parsed.password
    } catch {
      return false
    }
  })
}

function validGoogleUsageMetadata(value: unknown, allowMissingCandidateCount = false): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ["cachedContentTokenCount", "thoughtsTokenCount", "toolUsePromptTokenCount", "promptTokenCount", "candidatesTokenCount", "totalTokenCount", "trafficType", "serviceTier", "promptTokensDetails", "candidatesTokensDetails", "cacheTokensDetails", "toolUsePromptTokensDetails"])) return false
  for (const required of ["promptTokenCount", "totalTokenCount"]) {
    if (!(required in value) || !nonnegativeInteger(value[required])) return false
  }
  if (!allowMissingCandidateCount && (!("candidatesTokenCount" in value) || !nonnegativeInteger(value.candidatesTokenCount))) return false
  if (allowMissingCandidateCount && value.candidatesTokenCount !== undefined && value.candidatesTokenCount !== null && !nonnegativeInteger(value.candidatesTokenCount)) return false
  for (const optional of ["cachedContentTokenCount", "thoughtsTokenCount", "toolUsePromptTokenCount"]) {
    if (value[optional] !== undefined && value[optional] !== null && !nonnegativeInteger(value[optional])) return false
  }
  for (const optional of ["trafficType", "serviceTier"]) {
    if (value[optional] !== undefined && value[optional] !== null && !boundedIdentifier(value[optional], 80)) return false
  }
  return validGoogleTokenDetails(value.promptTokensDetails) && validGoogleTokenDetails(value.candidatesTokensDetails) && validGoogleTokenDetails(value.cacheTokensDetails) && validGoogleTokenDetails(value.toolUsePromptTokensDetails)
}

function boundedSafeMetadataString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && /^[\x20-\x7e]+$/.test(value)
}

function validGoogleTokenDetails(value: unknown): boolean {
  if (value === undefined || value === null) return true
  return Array.isArray(value) && value.length <= 16 && value.every((item) => isRecord(item) && hasExactKeys(item, ["modality", "tokenCount"]) && boundedIdentifier(item.modality, 80) && nonnegativeInteger(item.tokenCount))
}

function nonnegativeInteger(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) >= 0
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
