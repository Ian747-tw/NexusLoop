import { protocol, setTracingDisabled, Usage, type AgentOutputItem, type JsonSchemaDefinition, type Model, type ModelProvider, type ModelRequest, type ModelResponse, type SerializedOutputType, type StreamEvent } from "@openai/agents"
import { fixtureCase, normalizeFixtureResult, reportedUsage } from "../fixture-model"
import { runJsonFallbackProbe } from "../probes/json-fallback-probe"
import { finalizeResult, makeToolCall, toolForSdkName, toolNameFor, type CommanderModelStepAdapter, type CommanderModelStepRequest, type CommanderModelStreamEvent, type CommanderModelUsage, type CommanderToolJsonSchema } from "../contracts"

setTracingDisabled(true)

export function createOpenAIAgentsCoreAdapter(): CommanderModelStepAdapter {
  const provider = createControlledModelProvider()
  return {
    candidate_id: "openai_agents_core",
    candidate_version: "0.13.4-controlled-lower-level",
    supports_streaming: true,
    supports_native_tools: true,
    supports_json_fallback: true,
    supports_structured_output: true,
    supports_abort_signal: true,
    supports_usage: true,
    supports_openai_compatible: false,
    async executeOneStep(request: CommanderModelStepRequest) {
      await maybeWaitForAbort(request)
      if (request.abort_signal?.aborted) return normalizeFixtureResult("openai_agents_core", request, "text", 1)
      const model = await provider.getModel(request.model_id)
      const response = await model.getResponse(toAgentsModelRequest(request))
      const toolCalls = response.output
        .filter((item): item is Extract<AgentOutputItem, { type: "function_call" }> => item.type === "function_call")
        .map((item) => {
          const tool = toolForSdkName(request.tools, item.name) ?? request.tools.find((candidate) => candidate.tool_id === item.name)
          return makeToolCall(tool, item.name, item.arguments, "native", item.callId)
        })
      const message = response.output.find((item): item is Extract<AgentOutputItem, { type: "message" }> => item.type === "message")
      const messageText = extractMessageText(message) ?? normalizeFixtureResult("openai_agents_core", request, fixtureCase(request), 1).text
      const fallback = toolCalls.length ? null : fallbackFromText(request, messageText)
      if (fallback?.status === "tool_call") {
        return finalizeResult({
          request_id: request.request_id,
          candidate_id: "openai_agents_core",
          status: "tool_call",
          tool_calls: [fallback.call],
          finish_reason: "stop",
          usage: usageFromAgents(response.usage),
          provider_metadata: { request_count: response.usage.requests, sdk: "openai-agents", lower_level_model_interface: true, fallback: "json" },
          duration_ms: 1,
          warnings: [],
        })
      }
      if (fallback?.status === "malformed" || fallback?.status === "blocked") {
        return finalizeResult({
          request_id: request.request_id,
          candidate_id: "openai_agents_core",
          status: "malformed",
          text: messageText?.slice(0, 256),
          tool_calls: [],
          finish_reason: "stop",
          usage: usageFromAgents(response.usage),
          provider_metadata: { request_count: response.usage.requests, sdk: "openai-agents", lower_level_model_interface: true, fallback: "json" },
          duration_ms: 1,
          warnings: [],
          error: fallback.reason,
        })
      }
      return finalizeResult({
        request_id: request.request_id,
        candidate_id: "openai_agents_core",
        status: toolCalls.length ? "tool_call" : fixtureCase(request) === "refusal" ? "refusal" : "final",
        text: toolCalls.length ? undefined : messageText,
        tool_calls: toolCalls,
        finish_reason: toolCalls.length ? "tool_calls" : "stop",
        usage: {
          input_tokens: response.usage.inputTokens,
          output_tokens: response.usage.outputTokens,
          total_tokens: response.usage.totalTokens,
          provider_reported: true,
          raw_usage_summary: { requests: response.usage.requests, inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens, totalTokens: response.usage.totalTokens },
        },
        provider_metadata: { request_count: response.usage.requests, sdk: "openai-agents", lower_level_model_interface: true },
        duration_ms: 1,
        warnings: [],
      })
    },
    async *executeOneStreamedStep(request: CommanderModelStepRequest): AsyncIterable<CommanderModelStreamEvent> {
      await maybeWaitForAbort(request)
      if (request.abort_signal?.aborted) {
        yield { type: "error", error: "request was cancelled" }
        return
      }
      const model = await provider.getModel(request.model_id)
      const toolCalls = new Map<string, ReturnType<typeof makeToolCall>>()
      let text = ""
      for await (const event of model.getStreamedResponse(toAgentsModelRequest(request))) {
        if (event.type === "output_text_delta") {
          text += event.delta
          yield { type: "text_delta", text: event.delta }
        }
        if (event.type === "model" && isRecord(event.event) && event.event.type === "function_call") {
          const name = typeof event.event.name === "string" ? event.event.name : "unknown_tool"
          const callId = typeof event.event.callId === "string" ? event.event.callId : "missing_tool_call_id"
          const args = typeof event.event.arguments === "string" ? event.event.arguments : "{}"
          const tool = toolForSdkName(request.tools, name) ?? request.tools.find((candidate) => candidate.tool_id === name)
          const call = makeToolCall(tool, name, args, "native", callId)
          toolCalls.set(callId, call)
          yield { type: "tool_call_start", tool_call_id: callId, tool_id: call.tool_id }
          yield { type: "tool_call_complete", tool_call: call }
        }
        if (event.type === "response_done") {
          const response = event.response as unknown as ModelResponse
          const usage = usageFromAgents(response.usage)
          yield { type: "usage", usage }
          const completedToolCalls = Array.from(toolCalls.values())
          const finishReason = typeof response.providerData?.finish_reason === "string" ? response.providerData.finish_reason : completedToolCalls.length ? "tool_calls" : fixtureCase(request) === "refusal" ? "content-filter" : "stop"
          const fallback = completedToolCalls.length ? null : fallbackFromText(request, text)
          if (fallback?.status === "tool_call") {
            yield { type: "tool_call_start", tool_call_id: fallback.call.tool_call_id, tool_id: fallback.call.tool_id }
            yield { type: "tool_call_complete", tool_call: fallback.call }
            yield { type: "completed", result: finalizeResult({ request_id: request.request_id, candidate_id: "openai_agents_core", status: "tool_call", tool_calls: [fallback.call], finish_reason: finishReason, usage, provider_metadata: { request_count: response.usage.requests, sdk: "openai-agents", lower_level_model_interface: true, streamed: true, fallback: "json" }, duration_ms: 1, warnings: [] }) }
            continue
          }
          if (fallback?.status === "malformed" || fallback?.status === "blocked") {
            yield { type: "completed", result: finalizeResult({ request_id: request.request_id, candidate_id: "openai_agents_core", status: "malformed", text: text.slice(0, 256), tool_calls: [], finish_reason: finishReason, usage, provider_metadata: { request_count: response.usage.requests, sdk: "openai-agents", lower_level_model_interface: true, streamed: true, fallback: "json" }, duration_ms: 1, warnings: [], error: fallback.reason }) }
            continue
          }
          yield { type: "completed", result: finalizeResult({ request_id: request.request_id, candidate_id: "openai_agents_core", status: completedToolCalls.length ? "tool_call" : finishReason === "content-filter" ? "refusal" : "final", text: completedToolCalls.length ? undefined : text, tool_calls: completedToolCalls, finish_reason: finishReason, usage, provider_metadata: { request_count: response.usage.requests, sdk: "openai-agents", lower_level_model_interface: true, streamed: true }, duration_ms: 1, warnings: [] }) }
        }
      }
    },
  }
}

export async function runControlledAgentsModelProbe(request: CommanderModelStepRequest) {
  const provider = createControlledModelProvider()
  const model = await provider.getModel(request.model_id)
  const response = await model.getResponse(toAgentsModelRequest(request))
  return {
    sdk_model_provider_used: true,
    request_count: response.usage.requests,
    output_types: response.output.map((item) => item.type),
    tool_choice: toAgentsModelRequest(request).modelSettings.toolChoice,
    tool_names: toAgentsModelRequest(request).tools?.map((tool) => "name" in tool ? tool.name : "unknown_tool") ?? [],
    output_type: toAgentsModelRequest(request).outputType,
    tracing_disabled_by_api: true,
  }
}

export async function runControlledAgentsStreamingProbe(request: CommanderModelStepRequest) {
  const provider = createControlledModelProvider()
  const model = await provider.getModel(request.model_id)
  const events = []
  for await (const event of model.getStreamedResponse(toAgentsModelRequest(request))) events.push(event)
  return {
    sdk_streaming_used: true,
    event_types: events.map((event) => event.type),
    text_delta_count: events.filter((event) => event.type === "output_text_delta").length,
    function_call_count: events.filter((event) => event.type === "model" && isRecord(event.event) && event.event.type === "function_call").length,
    response_done_count: events.filter((event) => event.type === "response_done").length,
    tracing_disabled_by_api: true,
  }
}

export function runnerOwnershipProbe() {
  return {
    runner_can_be_one_turn: "partial",
    function_tools_can_auto_execute: true,
    tool_execution_interception_before_invocation: "not accepted as NexusLoop production path in 9W0",
    max_turns_behavior: "Runner exposes turn limiting, but Runner still represents an agent loop abstraction.",
    session_state_expectation: "SDK supports agent/session concepts that are not NexusLoop durable memory.",
    tracing_disabled_by_api: true,
    production_runner_suitable: false,
    reason: "Full Runner would compete with NexusLoop Commander run controller/tool executor/persistence authority.",
  }
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

function createControlledModelProvider(): ModelProvider {
  return {
    getModel(): Model {
      return {
        async getResponse(request: ModelRequest): Promise<ModelResponse> {
          const text = typeof request.input === "string" ? request.input : JSON.stringify(request.input)
          const kind = fixtureCase({ ...request, messages: [{ role: "user", content: text }], tools: [], tool_choice: "auto", provider_kind: "fixture", model_id: "fixture", metadata: {}, requested_at: "2026-07-16T00:00:00.000Z", request_id: "agents_fixture" })
          const output: AgentOutputItem[] = []
          if (kind === "tool" || kind === "stream_tool" || kind === "multi_tool" || kind === "malformed_tool") {
            output.push(protocol.FunctionCallItem.parse({
              type: "function_call",
              callId: "call_memory",
              name: "memory.search",
              arguments: kind === "malformed_tool" ? "{\"query\":7}" : JSON.stringify({ query: "research memory", limit: 3 }),
              status: "completed",
            }))
            if (kind === "multi_tool") {
              output.push(protocol.FunctionCallItem.parse({
                type: "function_call",
                callId: "call_git",
                name: "repo.git_status",
                arguments: "{}",
                status: "completed",
              }))
            }
          } else {
            output.push({
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: kind === "json_fallback_tool" ? JSON.stringify({ type: "tool_call", tool_id: "memory.search", arguments: { query: "research memory", limit: 3 } }) : kind === "structured" ? "{\"type\":\"final\",\"final\":{\"summary\":\"structured fixture\"}}" : kind === "refusal" ? "fixture refusal" : "plain fixture response" }],
            } as AgentOutputItem)
          }
          return {
            usage: new Usage({ requests: 1, inputTokens: 11, outputTokens: 7, totalTokens: 18 }),
            output,
            responseId: "resp_controlled_agents_fixture",
            requestId: "req_controlled_agents_fixture",
            providerData: { controlled_fixture: true },
          }
        },
        async *getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
          const response = await this.getResponse(request)
          yield { type: "response_started" } as StreamEvent
          for (const item of response.output) {
            if (item.type === "function_call") {
              yield { type: "model", event: item } as StreamEvent
              continue
            }
            if (item.type === "message") {
              const text = extractMessageText(item) ?? ""
              const midpoint = Math.max(1, Math.floor(text.length / 2))
              yield { type: "output_text_delta", delta: text.slice(0, midpoint) } as StreamEvent
              yield { type: "output_text_delta", delta: text.slice(midpoint) } as StreamEvent
            }
          }
          yield { type: "response_done", response } as unknown as StreamEvent
        },
      }
    },
  }
}

function usageFromAgents(usage: Usage): CommanderModelUsage {
  return {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
    provider_reported: true,
    raw_usage_summary: { requests: usage.requests, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function fallbackFromText(request: CommanderModelStepRequest, text: string | undefined): ReturnType<typeof runJsonFallbackProbe> | null {
  const trimmed = text?.trim() ?? ""
  if (!trimmed.startsWith("{") || !trimmed.includes("\"type\"")) return null
  return runJsonFallbackProbe(request, trimmed)
}

function toAgentsModelRequest(request: CommanderModelStepRequest): ModelRequest {
  return {
    input: request.messages.map((message) => `${message.role}:${message.content}`).join("\n"),
    modelSettings: {
      toolChoice: request.tool_choice,
      temperature: request.temperature,
      maxTokens: request.max_output_tokens,
    },
    tools: request.tools.map((tool) => ({
      type: "function",
      name: toolNameFor(tool.tool_id),
      description: tool.description,
      parameters: tool.input_schema,
      strict: tool.strict_requested,
    })),
    toolsExplicitlyProvided: true,
    outputType: toAgentsOutputType(request.structured_output_schema),
    handoffs: [],
    tracing: false,
    signal: request.abort_signal,
  }
}

function toAgentsOutputType(schema: CommanderToolJsonSchema | undefined): SerializedOutputType {
  if (!schema) return "text"
  const { schema_version: _schemaVersion, ...jsonSchema } = schema
  return {
    type: "json_schema",
    name: "nexusloop_structured_output",
    strict: true,
    schema: jsonSchema,
  } as JsonSchemaDefinition
}

function extractMessageText(message: AgentOutputItem | undefined): string | undefined {
  if (!message || message.type !== "message") return undefined
  const content = "content" in message && Array.isArray(message.content) ? message.content : []
  const first = content.find((item: { type?: string }) => item.type === "output_text")
  return first && "text" in first ? first.text : undefined
}
