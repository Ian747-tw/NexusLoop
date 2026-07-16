import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { generateText, jsonSchema, streamText, tool } from "ai"
import { fixtureCase, fixtureStream, normalizeFixtureResult } from "../fixture-model"
import { makeToolCall, normalizeToolName, type CommanderModelStepAdapter, type CommanderModelStepRequest, type CommanderModelStreamEvent } from "../contracts"

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
          toolChoice: request.tool_choice === "none" ? "none" : "auto",
          maxOutputTokens: request.max_output_tokens,
          temperature: request.temperature,
          abortSignal: request.abort_signal,
        })
        const toolCalls = (result.toolCalls ?? []).map((call) => {
          const toolId = normalizeToolName(call.toolName)
          const schema = request.tools.find((item) => item.tool_id === toolId)
          return makeToolCall(schema, call.toolName, JSON.stringify(call.input ?? {}), "native", call.toolCallId)
        })
        const status = toolCalls.length ? "tool_call" : "final"
        return {
          ...normalizeFixtureResult("vercel_ai_sdk_core", request, status === "tool_call" ? "tool" : "text", 1),
          status,
          text: toolCalls.length ? undefined : result.text,
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
        }
      } catch (error) {
        if (request.abort_signal?.aborted) return normalizeFixtureResult("vercel_ai_sdk_core", request, "text", 1)
        return { ...normalizeFixtureResult("vercel_ai_sdk_core", request, "http_500", 1), error: error instanceof Error ? error.message.slice(0, 240) : "AI SDK request failed" }
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
          toolChoice: request.tool_choice === "none" ? "none" : "auto",
          abortSignal: request.abort_signal,
        })
        for await (const delta of result.textStream) yield { type: "text_delta", text: delta }
        yield { type: "completed", result: await this.executeOneStep(request) }
      } catch (error) {
        yield { type: "error", error: error instanceof Error ? error.message.slice(0, 240) : "AI SDK stream failed" }
      }
    },
  }
}

function aiSdkTools(request: CommanderModelStepRequest) {
  return Object.fromEntries(request.tools.map((item) => [
    item.tool_id.replace(".", "_"),
    tool({
      description: item.description,
      inputSchema: jsonSchema(item.input_schema),
    }),
  ]))
}

function chatMessages(request: CommanderModelStepRequest): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  return request.messages.flatMap((message) => {
    if (message.role !== "system" && message.role !== "user" && message.role !== "assistant") return []
    return [{ role: message.role, content: message.content }]
  })
}
