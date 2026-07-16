import { fixtureOpenAIResponse, type FixtureCase } from "./fixture-model"

export type MockServer = {
  url: string
  requests: Array<{ method: string; pathname: string; headers: Record<string, string>; body_bytes: number }>
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
      requests.push({
        method: request.method,
        pathname: url.pathname,
        headers: sanitizeHeaders(request.headers),
        body_bytes: Buffer.byteLength(text),
      })
      let body: unknown = {}
      try {
        body = text ? JSON.parse(text) : {}
      } catch {
        body = {}
      }
      const response = fixtureOpenAIResponse(selectCase(body))
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
