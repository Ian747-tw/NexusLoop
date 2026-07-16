import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { generateText, jsonSchema, Output, streamText, tool, type ModelMessage } from "ai"
import { fixtureCase, fixtureStream, normalizeFixtureResult } from "../fixture-model"
import { finalizeResult, makeToolCall, toolForSdkName, toolNameFor, type CommanderModelStepAdapter, type CommanderModelStepRequest, type CommanderModelStreamEvent, type CommanderModelUsage } from "../contracts"

export type AiSdkAdapterOptions = {
  baseURL?: string
  apiKey?: string
  fetch?: typeof fetch
}

export function createVercelAiSdkCoreAdapter(options: AiSdkAdapterOptions = {}): CommanderModelStepAdapter {
  const provider = options.baseURL ? createOpenAICompatible({
    name: "nxl-fixture",
    baseURL: options.baseURL,
    apiKey: options.apiKey ?? "fixture-key",
    fetch: options.fetch,
    supportsStructuredOutputs: true,
  }) : null
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
      if (!provider) return normalizeFixtureResult("vercel_ai_sdk_core", request, fixtureCase(request), 1)
      try {
        const result = await generateText({
          model: provider.chatModel(request.model_id),
          messages: chatMessages(request),
          tools: aiSdkTools(request),
          toolChoice: toolChoice(request),
          output: request.structured_output_schema ? Output.object({
            schema: jsonSchema(request.structured_output_schema),
            name: "nexusloop_structured_output",
          }) : undefined,
          maxOutputTokens: request.max_output_tokens,
          temperature: request.temperature,
          abortSignal: request.abort_signal,
        })
        const toolCalls = (result.toolCalls ?? []).map((call) => {
          const schema = toolForSdkName(request.tools, call.toolName)
          return makeToolCall(schema, call.toolName, JSON.stringify(call.input ?? {}), "native", call.toolCallId)
        })
        const status = toolCalls.length ? "tool_call" : "final"
        const text = toolCalls.length ? undefined : request.structured_output_schema ? JSON.stringify(result.output) : result.text
        return finalizeResult({
          request_id: request.request_id,
          candidate_id: "vercel_ai_sdk_core",
          status,
          text,
          tool_calls: toolCalls,
          finish_reason: result.finishReason,
          usage: {
            input_tokens: result.usage?.inputTokens,
            output_tokens: result.usage?.outputTokens,
            total_tokens: result.usage?.totalTokens,
            provider_reported: Boolean(result.usage),
            raw_usage_summary: result.usage ? { inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens ?? 0, totalTokens: result.usage.totalTokens ?? 0 } : undefined,
          },
          provider_metadata: { request_count: 1, sdk: "ai" },
          duration_ms: 1,
          warnings: [],
        })
      } catch (error) {
        if (request.abort_signal?.aborted) {
          return finalizeResult({ request_id: request.request_id, candidate_id: "vercel_ai_sdk_core", status: "cancelled", tool_calls: [], usage: { provider_reported: false }, provider_metadata: { request_count: 1, sdk: "ai" }, duration_ms: 1, warnings: [], error: "request was cancelled" })
        }
        return finalizeResult({ request_id: request.request_id, candidate_id: "vercel_ai_sdk_core", status: "failed", tool_calls: [], usage: { provider_reported: false }, provider_metadata: { request_count: 1, sdk: "ai" }, duration_ms: 1, warnings: [], error: error instanceof Error ? error.message.slice(0, 240) : "AI SDK request failed" })
      }
    },
    async *executeOneStreamedStep(request: CommanderModelStepRequest): AsyncIterable<CommanderModelStreamEvent> {
      if (!provider) {
        yield* fixtureStream("vercel_ai_sdk_core", request, fixtureCase(request))
        return
      }
      try {
        const result = streamText({
          model: provider.chatModel(request.model_id),
          messages: chatMessages(request),
          tools: aiSdkTools(request),
          toolChoice: toolChoice(request),
          abortSignal: request.abort_signal,
        })
        let text = ""
        let finishReason: string | undefined
        let usage: CommanderModelUsage = { provider_reported: false }
        const toolCalls = new Map<string, ReturnType<typeof makeToolCall>>()
        for await (const event of result.fullStream) {
          const part = event as StreamPart
          if (event.type === "text-delta") {
            const delta = typeof part.text === "string" ? part.text : typeof part.delta === "string" ? part.delta : ""
            text += delta
            yield { type: "text_delta", text: delta }
          }
          if (event.type === "tool-input-start") {
            const toolCallId = part.toolCallId ?? part.id ?? "missing_tool_call_id"
            const toolName = part.toolName ?? "unknown_tool"
            yield { type: "tool_call_start", tool_call_id: toolCallId, tool_id: toolForSdkName(request.tools, toolName)?.tool_id ?? toolName }
          }
          if (event.type === "tool-input-delta") {
            const toolCallId = part.toolCallId ?? part.id ?? "missing_tool_call_id"
            const delta = part.inputTextDelta ?? part.delta ?? ""
            yield { type: "tool_call_arguments_delta", tool_call_id: toolCallId, delta }
          }
          if (part.type === "tool-input-available") {
            const rawArguments = JSON.stringify(part.input ?? {})
            const toolName = part.toolName ?? "unknown_tool"
            const toolCallId = part.toolCallId ?? "missing_tool_call_id"
            const tool = toolForSdkName(request.tools, toolName)
            const call = makeToolCall(tool, toolName, rawArguments, "native", toolCallId)
            toolCalls.set(toolCallId, call)
            yield { type: "tool_call_complete", tool_call: call }
          }
          if (event.type === "tool-call") {
            const rawArguments = JSON.stringify(event.input ?? {})
            const tool = toolForSdkName(request.tools, event.toolName)
            const call = makeToolCall(tool, event.toolName, rawArguments, "native", event.toolCallId)
            toolCalls.set(event.toolCallId, call)
            yield { type: "tool_call_start", tool_call_id: event.toolCallId, tool_id: call.tool_id }
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
        const completedToolCalls = Array.from(toolCalls.values())
        yield { type: "completed", result: finalizeResult({ request_id: request.request_id, candidate_id: "vercel_ai_sdk_core", status: completedToolCalls.length ? "tool_call" : "final", text: completedToolCalls.length ? undefined : text, tool_calls: completedToolCalls, finish_reason: finishReason, usage, provider_metadata: { request_count: 1, sdk: "ai", streamed: true }, duration_ms: 1, warnings: [] }) }
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
  id?: string
  toolCallId?: string
  toolName?: string
  input?: unknown
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

function toolChoice(request: CommanderModelStepRequest): "auto" | "none" | "required" {
  if (request.tool_choice === "required") return "required"
  if (request.tool_choice === "none") return "none"
  return "auto"
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
