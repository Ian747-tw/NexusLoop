import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { generateText, InvalidToolInputError, jsonSchema, NoSuchToolError, Output, streamText, tool, type ModelMessage } from "ai"
import { redactText, redactValue } from "../security/redaction"
import { buildProviderToolMap, makeCommanderToolCall, parseJsonFallback, providerJsonSchema, stableHash, validateCommanderToolArguments } from "./commander-model-schema"
import type { CommanderModelAssistantMessage, CommanderModelStepAdapter, CommanderModelStepRequest, CommanderModelStepResult, CommanderModelStreamEvent, CommanderModelToolCallPart, CommanderModelUsage } from "./commander-model-types"
import { ANTHROPIC_MESSAGES_PROVIDER_ADAPTER_VERSION, type CommanderConnectorModelTransportKind } from "./commander-connector-transport-types"

export const CONNECTOR_MANAGED_API_KEY_SENTINEL = "NEXUSLOOP_CONNECTOR_MANAGED_CREDENTIAL"
export type AiSdkCommanderCredentialMode = "explicit_api_key" | "connector_managed"

export type AiSdkCommanderModelAdapterOptions = {
  transport_kind?: CommanderConnectorModelTransportKind
  provider_name: string
  base_url: string
  credential_mode?: AiSdkCommanderCredentialMode
  api_key?: string
  fetch: typeof fetch
  default_headers?: Record<string, string>
  now?: () => Date
}

export class AiSdkCommanderModelStepAdapter implements CommanderModelStepAdapter {
  readonly adapter_id = "ai_sdk_core" as const
  readonly adapter_version: string
  readonly supports_streaming = true as const
  readonly supports_native_tools = true as const
  readonly supports_json_fallback = true as const
  readonly supports_structured_output: boolean
  readonly supports_abort_signal = true as const
  readonly supports_usage = true as const
  readonly supports_openai_compatible: boolean

  private readonly now: () => Date
  private readonly transportKind: CommanderConnectorModelTransportKind

  constructor(private readonly options: AiSdkCommanderModelAdapterOptions) {
    validateOptions(options)
    this.transportKind = options.transport_kind ?? "openai_compatible_connector"
    this.adapter_version = this.transportKind === "anthropic_messages_connector"
      ? ANTHROPIC_MESSAGES_PROVIDER_ADAPTER_VERSION
      : "ai@7.0.29/@ai-sdk/openai-compatible@3.0.11"
    this.supports_structured_output = this.transportKind === "openai_compatible_connector"
    this.supports_openai_compatible = this.transportKind === "openai_compatible_connector"
    this.now = options.now ?? (() => new Date())
  }

  async executeOneStep(request: CommanderModelStepRequest): Promise<CommanderModelStepResult> {
    const started = Date.now()
    const measured = this.providerForCall()
    try {
      const result = await generateText({
        model: measured.model(boundIdentifier(request.model_id, "model_id")),
        instructions: instructionsFromRequest(request),
        messages: toAiSdkMessages(request),
        tools: request.tool_protocol === "native" ? aiSdkTools(request) : undefined,
        toolChoice: request.tool_protocol === "native" ? toolChoice(request) : undefined,
        output: this.transportKind === "openai_compatible_connector" ? structuredOutput(request) : undefined,
        maxOutputTokens: request.max_output_tokens,
        temperature: request.temperature,
        abortSignal: request.abort_signal,
        maxRetries: 0,
      })
      const toolCalls = request.tool_protocol === "native" ? normalizeToolCalls(request, result.toolCalls ?? []) : []
      if (request.tool_protocol === "json_fallback" && toolCalls.length === 0) {
        const fallback = finalizeJsonFallbackStep(request, {
          text: result.text ?? "",
          usage: aiSdkUsage(result.usage),
          finishReason: result.finishReason,
          requestCount: measured.requestCount(),
          durationMs: Date.now() - started,
        })
        if (fallback.status !== "tool_call") return fallback.result
        toolCalls.push(fallback.call)
      }
      if (request.structured_output_schema && toolCalls.length === 0) {
        const validation = validateCommanderToolArguments(request.structured_output_schema, result.output)
        if (!validation.valid) return finalizeStep(request, "malformed", { text: result.text?.slice(0, 256), usage: aiSdkUsage(result.usage), finishReason: result.finishReason, requestCount: measured.requestCount(), durationMs: Date.now() - started, error: validation.errors.join("; ") })
      }
      if (request.tool_protocol === "native") return finalizeNativeStep(request, toolCalls, result.text ?? "", request.structured_output_schema ? JSON.stringify(result.output) : result.text, aiSdkUsage(result.usage), result.finishReason, measured.requestCount(), Date.now() - started)
      const text = toolCalls.length ? undefined : request.structured_output_schema ? JSON.stringify(result.output) : result.text
      const status = toolCalls.length ? "tool_call" : isRefusalFinishReason(result.finishReason) ? "refusal" : "final"
      return finalizeStep(request, status, { text, toolCalls, usage: aiSdkUsage(result.usage), finishReason: result.finishReason, requestCount: measured.requestCount(), durationMs: Date.now() - started })
    } catch (error) {
      const toolValidationError = request.tool_protocol === "native" && isAiSdkToolCallValidationError(error)
      const status = request.abort_signal?.aborted ? "cancelled" : toolValidationError || request.structured_output_schema && isStructuredOutputValidationError(error) ? "malformed" : "failed"
      return finalizeStep(request, status, { usage: { provider_reported: false }, requestCount: measured.requestCount(), durationMs: Date.now() - started, error: boundedError(error, status === "cancelled" ? "request was cancelled" : toolValidationError ? "native tool call failed validation" : status === "malformed" ? "structured output failed validation" : "AI SDK request failed") })
    }
  }

  async *executeOneStreamedStep(request: CommanderModelStepRequest): AsyncIterable<CommanderModelStreamEvent> {
    const started = Date.now()
    const measured = this.providerForCall()
    let completed = false
    try {
      const result = streamText({
        model: measured.model(boundIdentifier(request.model_id, "model_id")),
        instructions: instructionsFromRequest(request),
        messages: toAiSdkMessages(request),
        tools: request.tool_protocol === "native" ? aiSdkTools(request) : undefined,
        toolChoice: request.tool_protocol === "native" ? toolChoice(request) : undefined,
        output: this.transportKind === "openai_compatible_connector" ? structuredOutput(request) : undefined,
        maxOutputTokens: request.max_output_tokens,
        temperature: request.temperature,
        abortSignal: request.abort_signal,
        maxRetries: 0,
      })
      let text = ""
      let finishReason: string | undefined
      let usage: CommanderModelUsage = { provider_reported: false }
      const calls = new Map<string, CommanderModelToolCallPart>()
      const startedCalls = new Set<string>()
      for await (const event of result.fullStream) {
        const part = event as StreamPart
        if (part.type === "text" || part.type === "text-delta") {
          const delta = typeof part.text === "string" ? part.text : typeof part.delta === "string" ? part.delta : ""
          text += delta
          if (Buffer.byteLength(text) > 64_000) throw new Error("stream buffer exceeded maximum bytes")
          if (request.tool_protocol !== "json_fallback") yield { type: "text_delta", text: delta }
        }
        if (part.type === "tool-input-start" || part.type === "tool-call-streaming-start") {
          const toolCallId = part.toolCallId ?? part.id ?? "missing_tool_call_id"
          const toolId = buildProviderToolMap(request.tools).get(part.toolName ?? "")?.tool_id ?? part.toolName ?? "unknown_tool"
          if (!startedCalls.has(toolCallId)) {
            startedCalls.add(toolCallId)
            yield { type: "tool_call_start", tool_call_id: toolCallId, tool_id: toolId }
          }
        }
        if (part.type === "tool-input-delta" || part.type === "tool-call-delta") {
          yield { type: "tool_call_arguments_delta", tool_call_id: part.toolCallId ?? part.id ?? "missing_tool_call_id", delta: String(part.inputTextDelta ?? part.argsTextDelta ?? part.delta ?? "") }
        }
        if (part.type === "tool-input-available" || part.type === "tool-call") {
          const toolCallId = part.toolCallId ?? part.id ?? "missing_tool_call_id"
          const call = normalizeToolCalls(request, [{ toolName: part.toolName ?? "unknown_tool", input: part.input ?? {}, toolCallId }])[0]
          calls.set(toolCallId, call)
          if (!startedCalls.has(toolCallId)) {
            startedCalls.add(toolCallId)
            yield { type: "tool_call_start", tool_call_id: toolCallId, tool_id: call.tool_id }
          }
          yield { type: "tool_call_complete", tool_call: call }
        }
        if (part.type === "finish") {
          finishReason = part.finishReason
          usage = aiSdkUsage(part.totalUsage)
          yield { type: "usage", usage }
        }
        if (part.type === "error") {
          const error = boundedError(part.error, "AI SDK stream failed")
          yield { type: "error", error }
          return
        }
        if (part.type === "abort") {
          yield { type: "cancelled", error: "request was cancelled" }
          return
        }
      }
      const toolCalls = Array.from(calls.values())
      if (request.tool_protocol === "json_fallback" && toolCalls.length === 0) {
        const fallback = finalizeJsonFallbackStep(request, { text, usage, finishReason, requestCount: measured.requestCount(), durationMs: Date.now() - started, streamed: true })
        if (fallback.status === "tool_call") {
          yield { type: "tool_call_start", tool_call_id: fallback.call.tool_call_id, tool_id: fallback.call.tool_id }
          yield { type: "tool_call_complete", tool_call: fallback.call }
          toolCalls.push(fallback.call)
        } else {
          yield { type: "completed", result: fallback.result }
          completed = true
          return
        }
      }
      if (request.structured_output_schema && toolCalls.length === 0) {
        try {
          const output = await result.output
          const validation = validateCommanderToolArguments(request.structured_output_schema, output)
          if (!validation.valid) {
            yield { type: "completed", result: finalizeStep(request, "malformed", { text: text.slice(0, 256), usage, finishReason, requestCount: measured.requestCount(), durationMs: Date.now() - started, error: validation.errors.join("; "), streamed: true }) }
            completed = true
            return
          }
          text = JSON.stringify(output)
        } catch {
          yield { type: "completed", result: finalizeStep(request, "malformed", { text: text.slice(0, 256), usage, finishReason, requestCount: measured.requestCount(), durationMs: Date.now() - started, error: "streamed structured output failed validation", streamed: true }) }
          completed = true
          return
        }
      }
      if (request.tool_protocol === "native") {
        yield { type: "completed", result: finalizeNativeStep(request, toolCalls, text, text, usage, finishReason, measured.requestCount(), Date.now() - started, true) }
        completed = true
        return
      }
      const status = toolCalls.length ? "tool_call" : isRefusalFinishReason(finishReason) ? "refusal" : "final"
      yield { type: "completed", result: finalizeStep(request, status, { text: toolCalls.length ? undefined : text, toolCalls, usage, finishReason, requestCount: measured.requestCount(), durationMs: Date.now() - started, streamed: true }) }
      completed = true
    } catch (error) {
      if (request.abort_signal?.aborted) {
        yield { type: "cancelled", error: "request was cancelled" }
        return
      }
      if (request.tool_protocol === "native" && isAiSdkToolCallValidationError(error)) {
        yield { type: "completed", result: finalizeStep(request, "malformed", { usage: { provider_reported: false }, requestCount: measured.requestCount(), durationMs: Date.now() - started, error: boundedError(error, "native tool call failed validation"), streamed: true }) }
        return
      }
      yield { type: "error", error: boundedError(error, "AI SDK stream failed") }
    } finally {
      void completed
    }
  }

  private providerForCall() {
    let requestCount = 0
    const guardedFetch = (async (input, init) => {
      requestCount += 1
      return this.options.fetch(input, redactRequestInit(init))
    }) as typeof fetch
    const apiKey = this.options.credential_mode === "connector_managed" ? CONNECTOR_MANAGED_API_KEY_SENTINEL : this.options.api_key
    if (this.transportKind === "anthropic_messages_connector") {
      const provider = createAnthropic({
        name: "nexusloop-commander-anthropic",
        baseURL: this.options.base_url,
        apiKey,
        fetch: guardedFetch,
      })
      return {
        model: (modelId: string) => provider.messages(modelId),
        requestCount: () => requestCount,
      }
    }
    const provider = createOpenAICompatible({
        name: boundIdentifier(this.options.provider_name, "provider_name"),
        baseURL: this.options.base_url,
        apiKey,
        headers: this.options.default_headers,
        fetch: guardedFetch,
        includeUsage: true,
        supportsStructuredOutputs: true,
      })
    return {
      model: (modelId: string) => provider.chatModel(modelId),
      requestCount: () => requestCount,
    }
  }
}

function aiSdkTools(request: CommanderModelStepRequest): Record<string, ReturnType<typeof tool>> | undefined {
  if (request.tools.length === 0) return undefined
  buildProviderToolMap(request.tools)
  return Object.fromEntries(request.tools.map((item) => [item.provider_tool_name, tool({ description: item.description, inputSchema: jsonSchema(providerJsonSchema(item.input_schema)) })]))
}

function structuredOutput(request: CommanderModelStepRequest) {
  return request.structured_output_schema ? Output.object({ schema: jsonSchema(providerJsonSchema(request.structured_output_schema)), name: "nexusloop_structured_output" }) : undefined
}

function normalizeToolCalls(request: CommanderModelStepRequest, calls: Array<{ toolName: string; input?: unknown; toolCallId: string }>): CommanderModelToolCallPart[] {
  const map = buildProviderToolMap(request.tools)
  return calls.map((call) => makeCommanderToolCall(map.get(call.toolName), call.toolName, call.input ?? {}, call.toolCallId, "native"))
}

function finalizeNativeStep(request: CommanderModelStepRequest, toolCalls: CommanderModelToolCallPart[], textForError: string, finalText: string | undefined, usage: CommanderModelUsage, finishReason: string | undefined, requestCount: number, durationMs: number, streamed = false): CommanderModelStepResult {
  if (toolCalls.length > 0 && request.tool_choice === "none") {
    return finalizeStep(request, "malformed", { text: textForError.slice(0, 256), usage, finishReason, requestCount, durationMs, error: "native provider returned tool calls while tool_choice=none", streamed })
  }
  if (toolCalls.length === 0 && request.tool_choice === "required" && !isRefusalFinishReason(finishReason)) {
    return finalizeStep(request, "malformed", { text: textForError.slice(0, 256), usage, finishReason, requestCount, durationMs, error: "native provider returned final output while tool_choice=required", streamed })
  }
  if (toolCalls.length === 0 && isToolCallsFinishReason(finishReason)) {
    return finalizeStep(request, "malformed", { text: textForError.slice(0, 256), usage, finishReason, requestCount, durationMs, error: "native provider ended with tool_calls but no valid tool call was normalized", streamed })
  }
  const status = toolCalls.length ? "tool_call" : isRefusalFinishReason(finishReason) ? "refusal" : "final"
  return finalizeStep(request, status, { text: finalText, toolCalls, usage, finishReason, requestCount, durationMs, streamed })
}

function finalizeJsonFallbackStep(request: CommanderModelStepRequest, input: { text: string; usage: CommanderModelUsage; finishReason?: string; requestCount: number; durationMs: number; streamed?: boolean }): { status: "tool_call"; call: CommanderModelToolCallPart } | { status: "final" | "refusal" | "malformed"; result: CommanderModelStepResult } {
  if (isRefusalFinishReason(input.finishReason)) {
    return { status: "refusal", result: finalizeStep(request, "refusal", { text: input.text, usage: input.usage, finishReason: input.finishReason, requestCount: input.requestCount, durationMs: input.durationMs, streamed: input.streamed }) }
  }
  const fallback = parseJsonFallback(input.text, request.tools)
  if (fallback.status === "tool_call") {
    if (request.tool_choice === "none") {
      return { status: "malformed", result: finalizeStep(request, "malformed", { text: input.text.slice(0, 256), usage: input.usage, finishReason: input.finishReason, requestCount: input.requestCount, durationMs: input.durationMs, error: "json_fallback returned a tool_call while tool_choice=none", streamed: input.streamed }) }
    }
    return { status: "tool_call", call: fallback.call }
  }
  if (fallback.status === "final") {
    if (request.tool_choice === "required") {
      return { status: "malformed", result: finalizeStep(request, "malformed", { text: fallback.summary, usage: input.usage, finishReason: input.finishReason, requestCount: input.requestCount, durationMs: input.durationMs, error: "json_fallback returned final output while tool_choice=required", streamed: input.streamed }) }
    }
    return { status: "final", result: finalizeStep(request, "final", { text: fallback.summary, usage: input.usage, finishReason: input.finishReason, requestCount: input.requestCount, durationMs: input.durationMs, streamed: input.streamed }) }
  }
  return { status: "malformed", result: finalizeStep(request, "malformed", { text: input.text.slice(0, 256), usage: input.usage, finishReason: input.finishReason, requestCount: input.requestCount, durationMs: input.durationMs, error: fallback.error, streamed: input.streamed }) }
}

function toAiSdkMessages(request: CommanderModelStepRequest): ModelMessage[] {
  const messages: ModelMessage[] = []
  let pendingToolCalls = new Map<string, string>()
  for (const message of request.messages) {
    if (message.role === "system") continue
    if (message.role === "user") {
      if (pendingToolCalls.size > 0) throw new Error("assistant tool call message has unanswered tool results")
      pendingToolCalls = new Map()
      messages.push({ role: "user", content: message.content })
    }
    if (message.role === "assistant") {
      if (pendingToolCalls.size > 0) throw new Error("assistant tool call message has unanswered tool results")
      pendingToolCalls = new Map()
      const content = message.content.map((part) => {
        if (part.type === "text") return { type: "text", text: part.text }
        pendingToolCalls.set(part.tool_call_id, part.tool_id)
        return { type: "tool-call", toolCallId: part.tool_call_id, toolName: providerToolNameFromRequest(request, part.tool_id), input: part.arguments, args: part.arguments }
      })
      messages.push({ role: "assistant", content } as ModelMessage)
    }
    if (message.role === "tool") {
      const expectedToolId = pendingToolCalls.get(message.tool_call_id)
      if (!expectedToolId) throw new Error("tool result message does not follow matching assistant tool call")
      if (expectedToolId !== message.tool_id) throw new Error("tool result message tool_id does not match originating assistant tool call")
      pendingToolCalls.delete(message.tool_call_id)
      // AI SDK v7 ModelMessage tool-result parts use `output`; the OpenAI-compatible transport serializes it to provider tool-message content.
      messages.push({ role: "tool", content: [{ type: "tool-result", toolCallId: message.tool_call_id, toolName: providerToolNameFromRequest(request, message.tool_id), output: { type: "text", value: message.content } }] } as ModelMessage)
    }
  }
  if (pendingToolCalls.size > 0) throw new Error("assistant tool call message has unanswered tool results")
  return messages
}

function instructionsFromRequest(request: CommanderModelStepRequest): string | undefined {
  const instructions = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n")
  return instructions ? redactText(instructions).slice(0, 12_000) : undefined
}

function providerToolNameFromRequest(request: CommanderModelStepRequest, toolId: string): string {
  const found = request.tools.find((item) => item.tool_id === toolId)
  if (!found) throw new Error(`unknown message tool_id ${toolId}`)
  return found.provider_tool_name
}

function finalizeStep(request: CommanderModelStepRequest, status: CommanderModelStepResult["status"], input: { text?: string; toolCalls?: CommanderModelToolCallPart[]; usage: CommanderModelUsage; finishReason?: string; requestCount: number; durationMs: number; error?: string; streamed?: boolean }): CommanderModelStepResult {
  const toolCalls = (input.toolCalls ?? []).map(redactedToolCallWithExecutionArguments)
  const assistantMessage: CommanderModelAssistantMessage | undefined = status === "failed" || status === "cancelled"
    ? undefined
    : { role: "assistant", content: [...(input.text ? [{ type: "text" as const, text: redactText(input.text).slice(0, 4000) }] : []), ...toolCalls] }
  const result: CommanderModelStepResult = {
    request_id: request.request_id,
    provider_id: request.provider_id,
    adapter_id: "ai_sdk_core",
    status,
    assistant_message: assistantMessage,
    text: input.text ? redactText(input.text).slice(0, 4000) : undefined,
    tool_calls: toolCalls,
    finish_reason: input.finishReason,
    usage: input.usage,
    provider_metadata: { sdk: "ai", streamed: input.streamed === true },
    request_count: input.requestCount,
    raw_provider_payload_included: false,
    duration_ms: Math.max(0, input.durationMs),
    warnings: [],
    error: input.error ? redactText(input.error).slice(0, 300) : undefined,
    result_hash: "",
  }
  result.result_hash = stableHash({ ...result, duration_ms: 0 })
  return result
}

function redactedToolCallWithExecutionArguments(call: CommanderModelToolCallPart): CommanderModelToolCallPart {
  const { execution_arguments: explicitExecutionArguments, ...rest } = call
  const safeCall = {
    ...rest,
    arguments: redactValue(call.arguments),
    raw_arguments: call.raw_arguments ? redactText(call.raw_arguments).slice(0, 4096) : call.raw_arguments,
  }
  if (call.arguments_valid) {
    Object.defineProperty(safeCall, "execution_arguments", {
      value: explicitExecutionArguments ?? call.arguments,
      enumerable: false,
      configurable: false,
      writable: false,
    })
  }
  return safeCall
}

function aiSdkUsage(usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number; cachedInputTokens?: number; inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number } } | undefined): CommanderModelUsage {
  const cacheReadTokens = usage?.inputTokenDetails?.cacheReadTokens
  const cacheWriteTokens = usage?.inputTokenDetails?.cacheWriteTokens
  const cachedInputTokens = usage?.cachedInputTokens ?? cacheReadTokens
  const providerReported = usage !== undefined && [usage.inputTokens, usage.outputTokens, usage.totalTokens, cachedInputTokens, cacheWriteTokens].some((value) => typeof value === "number")
  return { input_tokens: usage?.inputTokens, output_tokens: usage?.outputTokens, total_tokens: usage?.totalTokens, cached_input_tokens: cachedInputTokens, provider_reported: providerReported, raw_usage_summary: providerReported ? { inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0, totalTokens: usage?.totalTokens ?? 0, cacheReadTokens: cacheReadTokens ?? 0, cacheWriteTokens: cacheWriteTokens ?? 0 } : undefined }
}

function toolChoice(request: CommanderModelStepRequest): "auto" | "none" | "required" {
  return request.tool_choice
}

function isRefusalFinishReason(reason: string | undefined): boolean {
  return reason === "content-filter" || reason === "content_filter"
}

function isToolCallsFinishReason(reason: string | undefined): boolean {
  return reason === "tool-calls" || reason === "tool_calls"
}

function isStructuredOutputValidationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const text = `${error.name} ${error.message}`
  if (/(HTTP|status code|statusCode|429|500|rate limit|fetch failed|network|ECONN|ETIMEDOUT)/i.test(text)) return false
  return /(structured|schema|validation|NoObjectGenerated|TypeValidation|object generated)/i.test(text)
}

function isAiSdkToolCallValidationError(error: unknown): boolean {
  return NoSuchToolError.isInstance(error) || InvalidToolInputError.isInstance(error)
}

function validateOptions(options: AiSdkCommanderModelAdapterOptions): void {
  if (typeof options.fetch !== "function") throw new Error("AiSdkCommanderModelStepAdapter requires explicit fetch")
  const parsed = new URL(options.base_url)
  if (parsed.username || parsed.password) throw new Error("AI SDK base_url credentials are not allowed")
  boundIdentifier(options.provider_name, "provider_name")
  if (options.transport_kind !== undefined && options.transport_kind !== "openai_compatible_connector" && options.transport_kind !== "anthropic_messages_connector") throw new Error("AI SDK transport_kind is invalid")
  const credentialMode = options.credential_mode ?? "explicit_api_key"
  if (credentialMode !== "explicit_api_key" && credentialMode !== "connector_managed") throw new Error("AI SDK credential_mode is invalid")
  if (credentialMode === "explicit_api_key" && (!options.api_key || options.api_key.length > 4096)) throw new Error("AI SDK api_key is required and bounded")
  if (credentialMode === "connector_managed") {
    if (options.api_key) throw new Error("connector_managed credential mode must not receive api_key")
    for (const key of Object.keys(options.default_headers ?? {})) {
      if (/^(authorization|proxy-authorization|cookie|x-api-key|api-key)$/i.test(key) || /api[_-]?key|token|secret|password|authorization/i.test(key)) throw new Error(`connector_managed credential mode rejects credential-like header: ${key}`)
    }
  }
}

function boundIdentifier(value: string, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200) throw new Error(`${name} is required and bounded`)
  return value
}

function boundedError(error: unknown, fallback: string): string {
  if (error instanceof Error) return redactText(error.message).slice(0, 300)
  return fallback
}

function redactRequestInit(init: RequestInit | undefined): RequestInit | undefined {
  if (!init?.headers) return init
  return { ...init, headers: init.headers }
}

type StreamPart = {
  type: string
  text?: string
  delta?: string
  inputTextDelta?: string
  argsTextDelta?: string
  id?: string
  toolCallId?: string
  toolName?: string
  input?: unknown
  finishReason?: string
  totalUsage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
  error?: unknown
}
