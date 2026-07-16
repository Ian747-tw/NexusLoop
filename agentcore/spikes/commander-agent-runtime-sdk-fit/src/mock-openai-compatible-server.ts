import { fixtureOpenAIResponse, type FixtureCase } from "./fixture-model"

export type MockServer = {
  url: string
  requests: Array<{ method: string; pathname: string; headers: Record<string, string>; body_bytes: number; body: unknown }>
  close(): Promise<void>
}

export async function startMockOpenAICompatibleServer(selectCase: (body: unknown) => FixtureCase = defaultCase): Promise<MockServer> {
  const requests: MockServer["requests"] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const text = await request.text()
      let body: unknown = {}
      try {
        body = text ? JSON.parse(text) : {}
      } catch {
        body = {}
      }
      requests.push({
        method: request.method,
        pathname: url.pathname,
        headers: sanitizeHeaders(request.headers),
        body_bytes: Buffer.byteLength(text),
        body,
      })
      const response = fixtureOpenAIResponse(selectCase(body))
      if (isRecord(body) && body.stream === true) {
        return new Response(streamFixture(selectCase(body)), {
          status: response.statusCode,
          headers: { "content-type": "text/event-stream" },
        })
      }
      if (typeof response.body === "string") {
        return new Response(response.body, { status: response.statusCode, headers: { "content-type": "application/json" } })
      }
      return Response.json(response.body, { status: response.statusCode })
    },
  })
  return {
    url: `http://${server.hostname}:${server.port}`,
    requests,
    async close() {
      await server.stop(true)
    },
  }
}

function streamFixture(kind: FixtureCase): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const chunks = openAIStreamChunks(kind).map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
  chunks.push("data: [DONE]\n\n")
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

function openAIStreamChunks(kind: FixtureCase): Record<string, unknown>[] {
  const base = { id: `chatcmpl_stream_${kind}`, object: "chat.completion.chunk", created: 1784160000, model: "fixture-model" }
  if (kind === "tool" || kind === "stream_tool" || kind === "multi_tool" || kind === "malformed_tool") {
    const args = kind === "malformed_tool" ? "{\"query\":7}" : JSON.stringify({ query: "research memory", limit: 3 })
    return [
      { ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_memory", type: "function", function: { name: "memory__search", arguments: "" } }] }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(0, 12) } }] }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(12) } }] }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } },
    ]
  }
  return [
    { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "plain " }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: { content: "fixture" }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } },
  ]
}

function defaultCase(body: unknown): FixtureCase {
  const serialized = JSON.stringify(body).toLowerCase()
  if (serialized.includes("multi tool")) return "multi_tool"
  if (serialized.includes("malformed")) return "malformed_tool"
  if (serialized.includes("refusal")) return "refusal"
  if (serialized.includes("structured")) return "structured"
  if (serialized.includes("stream tool")) return "stream_tool"
  if (serialized.includes("stream")) return "stream_text"
  if (serialized.includes("slow")) return "slow"
  if (serialized.includes("429")) return "http_429"
  if (serialized.includes("500")) return "http_500"
  if (serialized.includes("invalid json")) return "invalid_json"
  if (serialized.includes("premature")) return "premature_stream"
  if (serialized.includes("tool")) return "tool"
  return "text"
}

function sanitizeHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of headers.entries()) {
    out[key] = /authorization|api[-_]key|token/i.test(key) ? "[REDACTED]" : value.slice(0, 120)
  }
  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
