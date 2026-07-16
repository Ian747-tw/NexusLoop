import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { generateText, jsonSchema, Output, streamText, tool, type ModelMessage } from "ai"
import { fixtureCase, fixtureStream, normalizeFixtureResult } from "../fixture-model"
import { runJsonFallbackProbe } from "../probes/json-fallback-probe"
import { finalizeResult, makeToolCall, toolForSdkName, toolNameFor, type CommanderModelStepAdapter, type CommanderModelStepRequest, type CommanderModelStreamEvent, type CommanderModelUsage } from "../contracts"

export type AiSdkAdapterOptions = {
  baseURL?: string
  apiKey?: string
  fetch?: typeof fetch
}

export function createVercelAiSdkCoreAdapter(options: AiSdkAdapterOptions = {}): CommanderModelStepAdapter {
  return {
    candidate_id: "vercel_ai_sdk_core",
    candidate_version: "ai@7.0.29/@ai-sdk/openai-compatible@3.0.11",
    supports_streaming: true,
    supports_native_tools: true,
    supports_json_fallback: true,
    supports_structured_output: true,
    supports_abort_signal: true,
    supports_usage: true,
    supports_openai_compatible: true,
    async executeOneStep(request: CommanderModelStepRequest) {
      if (!options.baseURL) {
        await maybeWaitForAbort(request)
        return normalizeFixtureResult("vercel_ai_sdk_core", request, fixtureCase(request), 1)
      }
      const measured = providerForCall(options)
      try {
        const result = await generateText({
          model: measured.provider.chatModel(request.model_id),
          messages: chatMessages(request),
          tools: aiSdkTools(request),
          toolChoice: toolChoice(request),
          output: structuredOutput(request),
          maxOutputTokens: request.max_output_tokens,
          temperature: request.temperature,
          abortSignal: request.abort_signal,
          maxRetries: 0,
        })
        const toolCalls = (result.toolCalls ?? []).map((call) => {
          const schema = toolForSdkName(request.tools, call.toolName)
          return makeToolCall(schema, call.toolName, JSON.stringify(call.input ?? {}), "native", call.toolCallId)
        })
        const fallback = toolCalls.length ? null : fallbackFromText(request, result.text)
        if (fallback?.status === "tool_call") {
          return finalizeResult({
            request_id: request.request_id,
            candidate_id: "vercel_ai_sdk_core",
            status: "tool_call",
            tool_calls: [fallback.call],
            finish_reason: result.finishReason,
            usage: aiSdkUsage(result.usage),
            provider_metadata: { request_count: measured.requestCount(), sdk: "ai", fallback: "json" },
            duration_ms: 1,
            warnings: [],
          })
        }
        if (fallback?.status === "malformed" || fallback?.status === "blocked") {
          return finalizeResult({
            request_id: request.request_id,
            candidate_id: "vercel_ai_sdk_core",
            status: "malformed",
            text: result.text?.slice(0, 256),
            tool_calls: [],
            finish_reason: result.finishReason,
            usage: aiSdkUsage(result.usage),
            provider_metadata: { request_count: measured.requestCount(), sdk: "ai", fallback: "json" },
            duration_ms: 1,
            warnings: [],
            error: fallback.reason,
          })
        }
        const status = toolCalls.length ? "tool_call" : result.finishReason === "content-filter" ? "refusal" : "final"
        const text = toolCalls.length ? undefined : request.structured_output_schema ? JSON.stringify(result.output) : result.text
        return finalizeResult({
          request_id: request.request_id,
          candidate_id: "vercel_ai_sdk_core",
          status,
          text,
          tool_calls: toolCalls,
          finish_reason: result.finishReason,
          usage: aiSdkUsage(result.usage),
          provider_metadata: { request_count: measured.requestCount(), sdk: "ai" },
          duration_ms: 1,
          warnings: [],
        })
      } catch (error) {
        const requestCount = measured.requestCount()
        if (request.abort_signal?.aborted) {
          return finalizeResult({ request_id: request.request_id, candidate_id: "vercel_ai_sdk_core", status: "cancelled", tool_calls: [], usage: { provider_reported: false }, provider_metadata: { request_count: requestCount, sdk: "ai" }, duration_ms: 1, warnings: [], error: "request was cancelled" })
        }
        return finalizeResult({ request_id: request.request_id, candidate_id: "vercel_ai_sdk_core", status: "failed", tool_calls: [], usage: { provider_reported: false }, provider_metadata: { request_count: requestCount, sdk: "ai" }, duration_ms: 1, warnings: [], error: error instanceof Error ? error.message.slice(0, 240) : "AI SDK request failed" })
      }
    },
    async *executeOneStreamedStep(request: CommanderModelStepRequest): AsyncIterable<CommanderModelStreamEvent> {
      if (!options.baseURL) {
        yield* fixtureStream("vercel_ai_sdk_core", request, fixtureCase(request))
        return
      }
      const measured = providerForCall(options)
      try {
        const result = streamText({
          model: measured.provider.chatModel(request.model_id),
          messages: chatMessages(request),
          tools: aiSdkTools(request),
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
        let streamError: string | undefined
        const toolCalls = new Map<string, ReturnType<typeof makeToolCall>>()
        const startedToolCalls = new Set<string>()
        for await (const event of result.fullStream) {
          const part = event as StreamPart
          const eventType = part.type
          if (event.type === "error") {
            streamError = stringifyStreamError(part.error)
            yield { type: "error", error: streamError }
          }
          if (eventType === "abort") {
            streamError = "request was cancelled"
            yield { type: "error", error: streamError }
          }
          if (eventType === "text" || eventType === "text-delta") {
            const delta = typeof part.text === "string" ? part.text : typeof part.delta === "string" ? part.delta : ""
            text += delta
            yield { type: "text_delta", text: delta }
          }
          if (eventType === "tool-input-start" || eventType === "tool-call-streaming-start") {
            const toolCallId = part.toolCallId ?? part.id ?? "missing_tool_call_id"
            const toolName = part.toolName ?? "unknown_tool"
            if (!startedToolCalls.has(toolCallId)) {
              startedToolCalls.add(toolCallId)
              yield { type: "tool_call_start", tool_call_id: toolCallId, tool_id: toolForSdkName(request.tools, toolName)?.tool_id ?? toolName }
            }
          }
          if (eventType === "tool-input-delta" || eventType === "tool-call-delta") {
            const toolCallId = part.toolCallId ?? part.id ?? "missing_tool_call_id"
            const delta = part.inputTextDelta ?? part.argsTextDelta ?? part.delta ?? ""
            yield { type: "tool_call_arguments_delta", tool_call_id: toolCallId, delta }
          }
          if (eventType === "tool-input-available") {
            const rawArguments = JSON.stringify(part.input ?? {})
            const toolName = part.toolName ?? "unknown_tool"
            const toolCallId = part.toolCallId ?? "missing_tool_call_id"
            const tool = toolForSdkName(request.tools, toolName)
            const call = makeToolCall(tool, toolName, rawArguments, "native", toolCallId)
            toolCalls.set(toolCallId, call)
            if (!startedToolCalls.has(toolCallId)) {
              startedToolCalls.add(toolCallId)
              yield { type: "tool_call_start", tool_call_id: toolCallId, tool_id: call.tool_id }
            }
            yield { type: "tool_call_complete", tool_call: call }
          }
          if (event.type === "tool-call") {
            const rawArguments = JSON.stringify(event.input ?? {})
            const tool = toolForSdkName(request.tools, event.toolName)
            const call = makeToolCall(tool, event.toolName, rawArguments, "native", event.toolCallId)
            toolCalls.set(event.toolCallId, call)
            if (!startedToolCalls.has(event.toolCallId)) {
              startedToolCalls.add(event.toolCallId)
              yield { type: "tool_call_start", tool_call_id: event.toolCallId, tool_id: call.tool_id }
            }
            yield { type: "tool_call_complete", tool_call: call }
          }
          if (event.type === "finish") {
            finishReason = event.finishReason
            usage = {
              input_tokens: event.totalUsage?.inputTokens,
              output_tokens: event.totalUsage?.outputTokens,
              total_tokens: event.totalUsage?.totalTokens,
              provider_reported: Boolean(event.totalUsage),
              raw_usage_summary: event.totalUsage ? { inputTokens: event.totalUsage.inputTokens ?? 0, outputTokens: event.totalUsage.outputTokens ?? 0, totalTokens: event.totalUsage.totalTokens ?? 0 } : undefined,
            }
            yield { type: "usage", usage }
          }
        }
        if (streamError) return
        const completedToolCalls = Array.from(toolCalls.values())
        const fallback = completedToolCalls.length ? null : fallbackFromText(request, text)
        if (fallback?.status === "tool_call") {
          yield { type: "tool_call_start", tool_call_id: fallback.call.tool_call_id, tool_id: fallback.call.tool_id }
          yield { type: "tool_call_complete", tool_call: fallback.call }
          yield { type: "completed", result: finalizeResult({ request_id: request.request_id, candidate_id: "vercel_ai_sdk_core", status: "tool_call", tool_calls: [fallback.call], finish_reason: finishReason, usage, provider_metadata: { request_count: measured.requestCount(), sdk: "ai", streamed: true, fallback: "json" }, duration_ms: 1, warnings: [] }) }
          return
        }
        if (fallback?.status === "malformed" || fallback?.status === "blocked") {
          yield { type: "completed", result: finalizeResult({ request_id: request.request_id, candidate_id: "vercel_ai_sdk_core", status: "malformed", text: text.slice(0, 256), tool_calls: [], finish_reason: finishReason, usage, provider_metadata: { request_count: measured.requestCount(), sdk: "ai", streamed: true, fallback: "json" }, duration_ms: 1, warnings: [], error: fallback.reason }) }
          return
        }
        yield { type: "completed", result: finalizeResult({ request_id: request.request_id, candidate_id: "vercel_ai_sdk_core", status: completedToolCalls.length ? "tool_call" : finishReason === "content-filter" ? "refusal" : "final", text: completedToolCalls.length ? undefined : text, tool_calls: completedToolCalls, finish_reason: finishReason, usage, provider_metadata: { request_count: measured.requestCount(), sdk: "ai", streamed: true }, duration_ms: 1, warnings: [] }) }
      } catch (error) {
        yield { type: "error", error: error instanceof Error ? error.message.slice(0, 240) : "AI SDK stream failed" }
      }
    },
  }
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
  error?: unknown
}

function providerForCall(options: AiSdkAdapterOptions) {
  let requestCount = 0
  const providerFetch = (async (input, init) => {
    requestCount += 1
    return (options.fetch ?? fetch)(input, init)
  }) as typeof fetch
  return {
    provider: createOpenAICompatible({
      name: "nxl-fixture",
      baseURL: options.baseURL ?? "",
      apiKey: options.apiKey ?? "fixture-key",
      fetch: providerFetch,
      supportsStructuredOutputs: true,
    }),
    requestCount: () => requestCount,
  }
}

function aiSdkTools(request: CommanderModelStepRequest) {
  return Object.fromEntries(request.tools.map((item) => [
    toolNameFor(item.tool_id),
    tool({
      description: item.description,
      inputSchema: jsonSchema(item.input_schema),
    }),
  ]))
}

function structuredOutput(request: CommanderModelStepRequest) {
  return request.structured_output_schema ? Output.object({
    schema: jsonSchema(request.structured_output_schema),
    name: "nexusloop_structured_output",
  }) : undefined
}

function fallbackFromText(request: CommanderModelStepRequest, text: string | undefined): ReturnType<typeof runJsonFallbackProbe> | null {
  const trimmed = text?.trim() ?? ""
  if (!trimmed.startsWith("{") || !trimmed.includes("\"type\"")) return null
  return runJsonFallbackProbe(request, trimmed)
}

function aiSdkUsage(usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined): CommanderModelUsage {
  return {
    input_tokens: usage?.inputTokens,
    output_tokens: usage?.outputTokens,
    total_tokens: usage?.totalTokens,
    provider_reported: Boolean(usage),
    raw_usage_summary: usage ? { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0, totalTokens: usage.totalTokens ?? 0 } : undefined,
  }
}

function toolChoice(request: CommanderModelStepRequest): "auto" | "none" | "required" {
  if (request.tool_choice === "required") return "required"
  if (request.tool_choice === "none") return "none"
  return "auto"
}

async function maybeWaitForAbort(request: CommanderModelStepRequest): Promise<void> {
  if (!request.messages.some((message) => message.content.toLowerCase().includes("slow"))) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 50)
    request.abort_signal?.addEventListener("abort", () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}

function chatMessages(request: CommanderModelStepRequest): ModelMessage[] {
  const messages: ModelMessage[] = []
  for (const message of request.messages) {
    if (message.role === "assistant" && message.tool_call_id && message.tool_name) {
      messages.push({
        role: "assistant",
        content: [{
          type: "tool-call",
          toolCallId: message.tool_call_id,
          toolName: toolNameFor(message.tool_name),
          input: parseToolInput(message.content),
        }],
      })
      continue
    }
    if (message.role === "system" || message.role === "user" || message.role === "assistant") {
      messages.push({ role: message.role, content: message.content })
      continue
    }
    if (message.role === "tool") {
      messages.push({
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: message.tool_call_id ?? "missing_tool_call_id",
          toolName: message.tool_name ? toolNameFor(message.tool_name) : "unknown_tool",
          output: { type: "text", value: message.content },
        }],
      })
    }
  }
  return messages
}

function parseToolInput(content: string): Record<string, unknown> {
  try {
    const parsed: unknown = content ? JSON.parse(content) : {}
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function stringifyStreamError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 240)
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message.slice(0, 240)
  }
  return "AI SDK stream failed"
}
