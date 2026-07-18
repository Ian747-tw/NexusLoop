import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { generateText, jsonSchema, Output, streamText, tool, type ModelMessage } from "ai"
import { redactText, redactValue } from "../security/redaction"
import { buildProviderToolMap, makeCommanderToolCall, parseJsonFallback, providerJsonSchema, stableHash, validateCommanderToolArguments } from "./commander-model-schema"
import type { CommanderModelAssistantMessage, CommanderModelStepAdapter, CommanderModelStepRequest, CommanderModelStepResult, CommanderModelStreamEvent, CommanderModelToolCallPart, CommanderModelUsage } from "./commander-model-types"

export type AiSdkCommanderModelAdapterOptions = {
  provider_name: string
  base_url: string
  api_key: string
  fetch: typeof fetch
  default_headers?: Record<string, string>
  now?: () => Date
}

export class AiSdkCommanderModelStepAdapter implements CommanderModelStepAdapter {
  readonly adapter_id = "ai_sdk_core" as const
  readonly adapter_version = "ai@7.0.29/@ai-sdk/openai-compatible@3.0.11"
  readonly supports_streaming = true as const
  readonly supports_native_tools = true as const
  readonly supports_json_fallback = true as const
  readonly supports_structured_output = true as const
  readonly supports_abort_signal = true as const
  readonly supports_usage = true as const
  readonly supports_openai_compatible = true as const

  private readonly now: () => Date

  constructor(private readonly options: AiSdkCommanderModelAdapterOptions) {
    validateOptions(options)
    this.now = options.now ?? (() => new Date())
  }

  async executeOneStep(request: CommanderModelStepRequest): Promise<CommanderModelStepResult> {
    const started = Date.now()
    const measured = this.providerForCall()
    try {
      const result = await generateText({
        model: measured.provider.chatModel(boundIdentifier(request.model_id, "model_id")),
        messages: toAiSdkMessages(request),
        tools: request.tool_protocol === "native" ? aiSdkTools(request) : undefined,
        toolChoice: toolChoice(request),
        output: structuredOutput(request),
        maxOutputTokens: request.max_output_tokens,
        temperature: request.temperature,
        abortSignal: request.abort_signal,
        maxRetries: 0,
      })
      const toolCalls = request.tool_protocol === "native" ? normalizeToolCalls(request, result.toolCalls ?? []) : []
      if (request.tool_protocol === "json_fallback" && toolCalls.length === 0) {
        if (isRefusalFinishReason(result.finishReason)) return finalizeStep(request, "refusal", { text: result.text, usage: aiSdkUsage(result.usage), finishReason: result.finishReason, requestCount: measured.requestCount(), durationMs: Date.now() - started })
        const fallback = parseJsonFallback(result.text ?? "", request.tools)
        if (fallback.status === "tool_call") toolCalls.push(fallback.call)
        else if (fallback.status === "final") return finalizeStep(request, "final", { text: fallback.summary, usage: aiSdkUsage(result.usage), finishReason: result.finishReason, requestCount: measured.requestCount(), durationMs: Date.now() - started })
        else return finalizeStep(request, "malformed", { text: result.text?.slice(0, 256), usage: aiSdkUsage(result.usage), finishReason: result.finishReason, requestCount: measured.requestCount(), durationMs: Date.now() - started, error: fallback.error })
      }
      if (request.structured_output_schema && toolCalls.length === 0) {
        const validation = validateCommanderToolArguments(request.structured_output_schema, result.output)
        if (!validation.valid) return finalizeStep(request, "malformed", { text: result.text?.slice(0, 256), usage: aiSdkUsage(result.usage), finishReason: result.finishReason, requestCount: measured.requestCount(), durationMs: Date.now() - started, error: validation.errors.join("; ") })
      }
      const text = toolCalls.length ? undefined : request.structured_output_schema ? JSON.stringify(result.output) : result.text
      const status = toolCalls.length ? "tool_call" : isRefusalFinishReason(result.finishReason) ? "refusal" : "final"
      return finalizeStep(request, status, { text, toolCalls, usage: aiSdkUsage(result.usage), finishReason: result.finishReason, requestCount: measured.requestCount(), durationMs: Date.now() - started })
    } catch (error) {
      const status = request.abort_signal?.aborted ? "cancelled" : request.structured_output_schema && isStructuredOutputValidationError(error) ? "malformed" : "failed"
      return finalizeStep(request, status, { usage: { provider_reported: false }, requestCount: measured.requestCount(), durationMs: Date.now() - started, error: boundedError(error, status === "cancelled" ? "request was cancelled" : status === "malformed" ? "structured output failed validation" : "AI SDK request failed") })
    }
  }

  async *executeOneStreamedStep(request: CommanderModelStepRequest): AsyncIterable<CommanderModelStreamEvent> {
    const started = Date.now()
    const measured = this.providerForCall()
    let completed = false
    try {
      const result = streamText({
        model: measured.provider.chatModel(boundIdentifier(request.model_id, "model_id")),
        messages: toAiSdkMessages(request),
        tools: request.tool_protocol === "native" ? aiSdkTools(request) : undefined,
        toolChoice: toolChoice(request),
        output: structuredOutput(request),
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
          yield { type: "text_delta", text: delta }
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
        if (isRefusalFinishReason(finishReason)) {
          yield { type: "completed", result: finalizeStep(request, "refusal", { text, usage, finishReason, requestCount: measured.requestCount(), durationMs: Date.now() - started, streamed: true }) }
          completed = true
          return
        }
        const fallback = parseJsonFallback(text, request.tools)
        if (fallback.status === "tool_call") {
          yield { type: "tool_call_start", tool_call_id: fallback.call.tool_call_id, tool_id: fallback.call.tool_id }
          yield { type: "tool_call_complete", tool_call: fallback.call }
          toolCalls.push(fallback.call)
        } else if (fallback.status === "malformed") {
          yield { type: "completed", result: finalizeStep(request, "malformed", { text: text.slice(0, 256), usage, finishReason, requestCount: measured.requestCount(), durationMs: Date.now() - started, error: fallback.error, streamed: true }) }
          completed = true
          return
        } else {
          text = fallback.summary
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
      const status = toolCalls.length ? "tool_call" : isRefusalFinishReason(finishReason) ? "refusal" : "final"
      yield { type: "completed", result: finalizeStep(request, status, { text: toolCalls.length ? undefined : text, toolCalls, usage, finishReason, requestCount: measured.requestCount(), durationMs: Date.now() - started, streamed: true }) }
      completed = true
    } catch (error) {
      if (request.abort_signal?.aborted) {
        yield { type: "cancelled", error: "request was cancelled" }
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
    return {
      provider: createOpenAICompatible({
        name: boundIdentifier(this.options.provider_name, "provider_name"),
        baseURL: this.options.base_url,
        apiKey: this.options.api_key,
        headers: this.options.default_headers,
        fetch: guardedFetch,
        supportsStructuredOutputs: true,
      }),
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

function toAiSdkMessages(request: CommanderModelStepRequest): ModelMessage[] {
  const messages: ModelMessage[] = []
  const toolCallIds = new Set<string>()
  for (const message of request.messages) {
    if (message.role === "system" || message.role === "user") messages.push({ role: message.role, content: message.content })
    if (message.role === "assistant") {
      const content = message.content.map((part) => {
        if (part.type === "text") return { type: "text", text: part.text }
        toolCallIds.add(part.tool_call_id)
        return { type: "tool-call", toolCallId: part.tool_call_id, toolName: providerToolNameFromRequest(request, part.tool_id), input: part.arguments }
      })
      messages.push({ role: "assistant", content } as ModelMessage)
    }
    if (message.role === "tool") {
      if (!toolCallIds.has(message.tool_call_id)) throw new Error("tool result message does not follow matching assistant tool call")
      messages.push({ role: "tool", content: [{ type: "tool-result", toolCallId: message.tool_call_id, toolName: providerToolNameFromRequest(request, message.tool_id), output: { type: "text", value: message.content } }] } as ModelMessage)
    }
  }
  return messages
}

function providerToolNameFromRequest(request: CommanderModelStepRequest, toolId: string): string {
  const found = request.tools.find((item) => item.tool_id === toolId)
  if (!found) throw new Error(`unknown message tool_id ${toolId}`)
  return found.provider_tool_name
}

function finalizeStep(request: CommanderModelStepRequest, status: CommanderModelStepResult["status"], input: { text?: string; toolCalls?: CommanderModelToolCallPart[]; usage: CommanderModelUsage; finishReason?: string; requestCount: number; durationMs: number; error?: string; streamed?: boolean }): CommanderModelStepResult {
  const toolCalls = (input.toolCalls ?? []).map((call) => ({
    ...call,
    arguments: redactValue(call.arguments),
    raw_arguments: call.raw_arguments ? redactText(call.raw_arguments).slice(0, 4096) : call.raw_arguments,
  }))
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

function aiSdkUsage(usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number; cachedInputTokens?: number } | undefined): CommanderModelUsage {
  const providerReported = usage !== undefined && [usage.inputTokens, usage.outputTokens, usage.totalTokens, usage.cachedInputTokens].some((value) => typeof value === "number")
  return { input_tokens: usage?.inputTokens, output_tokens: usage?.outputTokens, total_tokens: usage?.totalTokens, cached_input_tokens: usage?.cachedInputTokens, provider_reported: providerReported, raw_usage_summary: providerReported ? { inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0, totalTokens: usage?.totalTokens ?? 0 } : undefined }
}

function toolChoice(request: CommanderModelStepRequest): "auto" | "none" | "required" {
  return request.tool_choice
}

function isRefusalFinishReason(reason: string | undefined): boolean {
  return reason === "content-filter" || reason === "content_filter"
}

function isStructuredOutputValidationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const text = `${error.name} ${error.message}`
  if (/(HTTP|status code|statusCode|429|500|rate limit|fetch failed|network|ECONN|ETIMEDOUT)/i.test(text)) return false
  return /(structured|schema|validation|NoObjectGenerated|TypeValidation|object generated)/i.test(text)
}

function validateOptions(options: AiSdkCommanderModelAdapterOptions): void {
  if (typeof options.fetch !== "function") throw new Error("AiSdkCommanderModelStepAdapter requires explicit fetch")
  const parsed = new URL(options.base_url)
  if (parsed.username || parsed.password) throw new Error("AI SDK base_url credentials are not allowed")
  boundIdentifier(options.provider_name, "provider_name")
  if (!options.api_key || options.api_key.length > 4096) throw new Error("AI SDK api_key is required and bounded")
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
