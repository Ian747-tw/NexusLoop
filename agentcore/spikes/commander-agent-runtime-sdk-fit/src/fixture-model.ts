import { finalizeResult, makeToolCall, type CandidateId, type CommanderModelStepRequest, type CommanderModelStepResult, type CommanderModelStreamEvent } from "./contracts"

export type FixtureCase =
  | "text"
  | "tool"
  | "multi_tool"
  | "malformed_tool"
  | "refusal"
  | "structured"
  | "stream_text"
  | "stream_tool"
  | "usage"
  | "slow"
  | "http_429"
  | "http_500"
  | "invalid_json"
  | "premature_stream"

export type FixtureResponse = {
  statusCode: number
  body: Record<string, unknown> | string
  stream?: boolean
}

export function fixtureCase(request: CommanderModelStepRequest): FixtureCase {
  const content = request.messages.map((message) => message.content).join(" ").toLowerCase()
  if (content.includes("multi tool")) return "multi_tool"
  if (content.includes("malformed")) return "malformed_tool"
  if (content.includes("refusal")) return "refusal"
  if (content.includes("structured")) return "structured"
  if (content.includes("usage")) return "usage"
  if (content.includes("slow")) return "slow"
  if (content.includes("429")) return "http_429"
  if (content.includes("500")) return "http_500"
  if (content.includes("invalid json")) return "invalid_json"
  if (content.includes("premature")) return "premature_stream"
  if (content.includes("stream tool")) return "stream_tool"
  if (content.includes("stream")) return "stream_text"
  if (content.includes("tool")) return "tool"
  return "text"
}

export function fixtureOpenAIResponse(kind: FixtureCase): FixtureResponse {
  if (kind === "http_429") return { statusCode: 429, body: { error: { message: "rate limited", type: "rate_limit" } } }
  if (kind === "http_500") return { statusCode: 500, body: { error: { message: "server failed", type: "server_error" } } }
  if (kind === "invalid_json") return { statusCode: 200, body: "{not-json" }
  const base = {
    id: `chatcmpl_${kind}`,
    object: "chat.completion",
    created: 1784160000,
    model: "fixture-model",
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
  }
  if (kind === "tool" || kind === "multi_tool" || kind === "malformed_tool") {
    const calls = [
      {
        id: "call_memory",
        type: "function",
        function: {
          name: "memory__search",
          arguments: kind === "malformed_tool" ? "{\"query\":7}" : JSON.stringify({ query: "research memory", limit: 3 }),
        },
      },
    ]
    if (kind === "multi_tool") {
      calls.push({ id: "call_git", type: "function", function: { name: "repo__git_status", arguments: "{}" } })
    }
    return { statusCode: 200, body: { ...base, choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: calls } }] } }
  }
  if (kind === "refusal") {
    return { statusCode: 200, body: { ...base, choices: [{ index: 0, finish_reason: "content_filter", message: { role: "assistant", content: "fixture refusal" } }] } }
  }
  if (kind === "structured") {
    return { statusCode: 200, body: { ...base, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ type: "final", final: { summary: "structured fixture" } }) } }] } }
  }
  return { statusCode: 200, body: { ...base, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "plain fixture response" } }] } }
}

export function normalizeFixtureResult(candidateId: CandidateId, request: CommanderModelStepRequest, kind = fixtureCase(request), requestCount = 1, durationMs = 1): CommanderModelStepResult {
  const started = Date.now()
  if (request.abort_signal?.aborted) {
    return finalizeResult({ request_id: request.request_id, candidate_id: candidateId, status: "cancelled", tool_calls: [], usage: missingUsage(), provider_metadata: { request_count: requestCount }, duration_ms: Date.now() - started, warnings: [], error: "request was cancelled" })
  }
  if (kind === "http_429" || kind === "http_500") {
    return finalizeResult({ request_id: request.request_id, candidate_id: candidateId, status: "failed", tool_calls: [], finish_reason: kind, usage: missingUsage(), provider_metadata: { request_count: requestCount }, duration_ms: durationMs, warnings: [], error: kind === "http_429" ? "rate limited" : "server failed" })
  }
  if (kind === "invalid_json" || kind === "premature_stream") {
    return finalizeResult({ request_id: request.request_id, candidate_id: candidateId, status: "malformed", tool_calls: [], usage: missingUsage(), provider_metadata: { request_count: requestCount }, duration_ms: durationMs, warnings: ["provider payload was malformed"], error: "malformed fixture response" })
  }
  if (kind === "refusal") {
    return finalizeResult({ request_id: request.request_id, candidate_id: candidateId, status: "refusal", text: "fixture refusal", tool_calls: [], finish_reason: "stop", usage: reportedUsage(), provider_metadata: { request_count: requestCount }, duration_ms: durationMs, warnings: [] })
  }
  if (kind === "tool" || kind === "multi_tool" || kind === "malformed_tool") {
    const memory = request.tools.find((tool) => tool.tool_id === "memory.search")
    const git = request.tools.find((tool) => tool.tool_id === "repo.git_status")
    const calls = [
      makeToolCall(memory, "memory_search", kind === "malformed_tool" ? "{\"query\":7}" : JSON.stringify({ query: "research memory", limit: 3 }), "native", "call_memory"),
    ]
    if (kind === "multi_tool") calls.push(makeToolCall(git, "repo_git_status", "{}", "native", "call_git"))
    return finalizeResult({ request_id: request.request_id, candidate_id: candidateId, status: "tool_call", tool_calls: calls, finish_reason: "tool_calls", usage: reportedUsage(), provider_metadata: { request_count: requestCount }, duration_ms: durationMs, warnings: [] })
  }
  if (kind === "structured") {
    return finalizeResult({ request_id: request.request_id, candidate_id: candidateId, status: "final", text: "{\"type\":\"final\",\"final\":{\"summary\":\"structured fixture\"}}", tool_calls: [], finish_reason: "stop", usage: reportedUsage(), provider_metadata: { request_count: requestCount, structured: true }, duration_ms: durationMs, warnings: [] })
  }
  return finalizeResult({ request_id: request.request_id, candidate_id: candidateId, status: "final", text: "plain fixture response", tool_calls: [], finish_reason: "stop", usage: reportedUsage(), provider_metadata: { request_count: requestCount }, duration_ms: durationMs, warnings: [] })
}

export async function* fixtureStream(candidateId: CandidateId, request: CommanderModelStepRequest, kind = fixtureCase(request)): AsyncIterable<CommanderModelStreamEvent> {
  if (request.abort_signal?.aborted) {
    yield { type: "error", error: "request was cancelled" }
    return
  }
  if (kind === "slow") {
    await waitForAbortWindow(request)
    if (request.abort_signal?.aborted) {
      yield { type: "error", error: "request was cancelled" }
      return
    }
  }
  if (kind === "stream_tool") {
    yield { type: "tool_call_start", tool_call_id: "call_memory", tool_id: "memory.search" }
    yield { type: "tool_call_arguments_delta", tool_call_id: "call_memory", delta: "{\"query\":\"research" }
    yield { type: "tool_call_arguments_delta", tool_call_id: "call_memory", delta: " memory\",\"limit\":3}" }
    const tool = request.tools.find((item) => item.tool_id === "memory.search")
    yield { type: "tool_call_complete", tool_call: makeToolCall(tool, "memory_search", JSON.stringify({ query: "research memory", limit: 3 }), "native", "call_memory") }
    yield { type: "usage", usage: reportedUsage() }
    yield { type: "completed", result: normalizeFixtureResult(candidateId, request, "tool") }
    return
  }
  if (kind === "premature_stream") {
    yield { type: "text_delta", text: "partial" }
    yield { type: "error", error: "premature stream termination" }
    return
  }
  yield { type: "text_delta", text: "plain " }
  yield { type: "text_delta", text: "fixture" }
  yield { type: "usage", usage: reportedUsage() }
  yield { type: "completed", result: normalizeFixtureResult(candidateId, request, "text") }
}

export function reportedUsage() {
  return { input_tokens: 11, output_tokens: 7, total_tokens: 18, provider_reported: true, raw_usage_summary: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } }
}

export function missingUsage() {
  return { provider_reported: false }
}

async function waitForAbortWindow(request: CommanderModelStepRequest): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 50)
    request.abort_signal?.addEventListener("abort", () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}
