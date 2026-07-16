import { protocol, setTracingDisabled, Usage, type AgentOutputItem, type Model, type ModelProvider, type ModelRequest, type ModelResponse } from "@openai/agents"
import { fixtureCase, fixtureStream, normalizeFixtureResult } from "../fixture-model"
import { finalizeResult, makeToolCall, type CommanderModelStepAdapter, type CommanderModelStepRequest, type CommanderModelStreamEvent } from "../contracts"

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
          const tool = request.tools.find((candidate) => candidate.tool_id === item.name)
          return makeToolCall(tool, item.name, item.arguments, "native", item.callId)
        })
      const message = response.output.find((item): item is Extract<AgentOutputItem, { type: "message" }> => item.type === "message")
      return finalizeResult({
        request_id: request.request_id,
        candidate_id: "openai_agents_core",
        status: toolCalls.length ? "tool_call" : fixtureCase(request) === "refusal" ? "refusal" : "final",
        text: toolCalls.length ? undefined : extractMessageText(message) ?? normalizeFixtureResult("openai_agents_core", request, fixtureCase(request), 1).text,
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
    executeOneStreamedStep(request: CommanderModelStepRequest): AsyncIterable<CommanderModelStreamEvent> {
      return fixtureStream("openai_agents_core", request, fixtureCase(request))
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
          if (kind === "tool" || kind === "multi_tool" || kind === "malformed_tool") {
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
              content: [{ type: "output_text", text: kind === "structured" ? "{\"type\":\"final\",\"final\":{\"summary\":\"structured fixture\"}}" : kind === "refusal" ? "fixture refusal" : "plain fixture response" }],
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
        async *getStreamedResponse(): AsyncIterable<never> {
          return
        },
      }
    },
  }
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
      name: tool.tool_id,
      description: tool.description,
      parameters: tool.input_schema,
      strict: tool.strict_requested,
    })),
    toolsExplicitlyProvided: true,
    outputType: "text",
    handoffs: [],
    tracing: false,
    signal: request.abort_signal,
  }
}

function extractMessageText(message: AgentOutputItem | undefined): string | undefined {
  if (!message || message.type !== "message") return undefined
  const content = "content" in message && Array.isArray(message.content) ? message.content : []
  const first = content.find((item: { type?: string }) => item.type === "output_text")
  return first && "text" in first ? first.text : undefined
}
