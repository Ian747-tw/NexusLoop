import { describe, expect, test } from "bun:test"
import { createVercelAiSdkCoreAdapter } from "../src/candidates/vercel-ai-sdk-core-adapter"
import { baseRequest } from "../src/contracts"
import { startMockOpenAICompatibleServer } from "../src/mock-openai-compatible-server"
import { installNetworkGuard } from "../src/probes/network-isolation-probe"

describe("network isolation", () => {
  test("default candidate requests are limited to the loopback mock server", async () => {
    const server = await startMockOpenAICompatibleServer()
    const guard = installNetworkGuard([new URL(server.url).origin])
    try {
      const adapter = createVercelAiSdkCoreAdapter({ baseURL: `${server.url}/v1`, apiKey: "fixture-key" })
      const result = await adapter.executeOneStep(baseRequest({ messages: [{ role: "user", content: "tool" }] }))
      expect(result.status).toBe("tool_call")
      expect(guard.attempted).toEqual([])
      expect(server.requests.length).toBe(1)
      expect(JSON.stringify(server.requests)).not.toContain("fixture-key")
    } finally {
      guard.restore()
      await server.close()
    }
  })

  test("provider-backed streaming completes without issuing a second request", async () => {
    const server = await startMockOpenAICompatibleServer(() => "text")
    const guard = installNetworkGuard([new URL(server.url).origin])
    try {
      const adapter = createVercelAiSdkCoreAdapter({ baseURL: `${server.url}/v1`, apiKey: "fixture-key" })
      const events = []
      for await (const event of adapter.executeOneStreamedStep(baseRequest({ messages: [{ role: "user", content: "stream" }] }))) events.push(event)
      expect(events.some((event) => event.type === "text_delta" && event.text === "plain ")).toBe(true)
      expect(events.some((event) => event.type === "completed")).toBe(true)
      const completed = events.find((event) => event.type === "completed")
      if (completed?.type === "completed") expect(completed.result.text).toBe("plain fixture")
      expect(server.requests.length).toBe(1)
      expect(guard.attempted).toEqual([])
    } finally {
      guard.restore()
      await server.close()
    }
  })

  test("provider-backed streaming preserves native tool calls", async () => {
    const server = await startMockOpenAICompatibleServer(() => "tool")
    const guard = installNetworkGuard([new URL(server.url).origin])
    try {
      const adapter = createVercelAiSdkCoreAdapter({ baseURL: `${server.url}/v1`, apiKey: "fixture-key" })
      const events = []
      for await (const event of adapter.executeOneStreamedStep(baseRequest({ messages: [{ role: "user", content: "stream tool" }] }))) events.push(event)
      expect(events.some((event) => event.type === "tool_call_start" && event.tool_id === "memory.search")).toBe(true)
      expect(events.some((event) => event.type === "tool_call_arguments_delta" && event.delta.length > 0)).toBe(true)
      expect(events.some((event) => event.type === "tool_call_complete")).toBe(true)
      const completed = events.find((event) => event.type === "completed")
      expect(completed?.type).toBe("completed")
      if (completed?.type === "completed") {
        expect(completed.result.status).toBe("tool_call")
        expect(completed.result.tool_calls[0].tool_id).toBe("memory.search")
        expect(completed.result.provider_metadata.request_count).toBe(1)
      }
      expect(server.requests.length).toBe(1)
      expect(guard.attempted).toEqual([])
    } finally {
      guard.restore()
      await server.close()
    }
  })

  test("provider-backed streaming sends structured output schema and reports measured request count", async () => {
    const server = await startMockOpenAICompatibleServer(() => "structured")
    const guard = installNetworkGuard([new URL(server.url).origin])
    try {
      const adapter = createVercelAiSdkCoreAdapter({ baseURL: `${server.url}/v1`, apiKey: "fixture-key" })
      const events = []
      for await (const event of adapter.executeOneStreamedStep(baseRequest({
        messages: [{ role: "user", content: "structured stream" }],
        structured_output_schema: {
          schema_version: "nxl-commander-tool-v1",
          type: "object",
          required: ["type", "final"],
          additionalProperties: false,
          properties: {
            type: { type: "string", enum: ["final"] },
            final: {
              type: "object",
              required: ["summary"],
              additionalProperties: false,
              properties: {
                summary: { type: "string", maxLength: 200 },
              },
            } as never,
          },
        },
      }))) events.push(event)
      const completed = events.find((event) => event.type === "completed")
      expect(completed?.type).toBe("completed")
      if (completed?.type === "completed") expect(completed.result.provider_metadata.request_count).toBe(server.requests.length)
      const body = JSON.stringify(server.requests[0].body)
      expect(body).toContain("response_format")
      expect(body).toContain("nexusloop_structured_output")
      expect(body).toContain("summary")
      expect(server.requests.length).toBe(1)
      expect(guard.attempted).toEqual([])
    } finally {
      guard.restore()
      await server.close()
    }
  })

  test("provider-backed JSON fallback tool calls normalize without execution", async () => {
    const server = await startMockOpenAICompatibleServer(() => "json_fallback_tool")
    const guard = installNetworkGuard([new URL(server.url).origin])
    try {
      const adapter = createVercelAiSdkCoreAdapter({ baseURL: `${server.url}/v1`, apiKey: "fixture-key" })
      const result = await adapter.executeOneStep(baseRequest({ messages: [{ role: "user", content: "fallback tool" }] }))
      expect(result.status).toBe("tool_call")
      expect(result.tool_calls[0].tool_id).toBe("memory.search")
      expect(result.tool_calls[0].source).toBe("json_fallback")
      expect(result.provider_metadata).toMatchObject({ request_count: 1, fallback: "json" })

      const events = []
      for await (const event of adapter.executeOneStreamedStep(baseRequest({ messages: [{ role: "user", content: "fallback tool stream" }] }))) events.push(event)
      expect(events.some((event) => event.type === "tool_call_complete" && event.tool_call.source === "json_fallback")).toBe(true)
      const completed = events.find((event) => event.type === "completed")
      expect(completed?.type).toBe("completed")
      if (completed?.type === "completed") {
        expect(completed.result.status).toBe("tool_call")
        expect(completed.result.tool_calls[0].source).toBe("json_fallback")
        expect(completed.result.provider_metadata).toMatchObject({ request_count: 1, streamed: true, fallback: "json" })
      }
      expect(server.requests.length).toBe(2)
      expect(guard.attempted).toEqual([])
    } finally {
      guard.restore()
      await server.close()
    }
  })

  test("provider-backed request counts are isolated per overlapping call", async () => {
    const server = await startMockOpenAICompatibleServer(() => "text")
    const guard = installNetworkGuard([new URL(server.url).origin])
    try {
      const adapter = createVercelAiSdkCoreAdapter({ baseURL: `${server.url}/v1`, apiKey: "fixture-key" })
      const [first, second] = await Promise.all([
        adapter.executeOneStep(baseRequest({ request_id: "overlap_first", messages: [{ role: "user", content: "plain first" }] })),
        adapter.executeOneStep(baseRequest({ request_id: "overlap_second", messages: [{ role: "user", content: "plain second" }] })),
      ])
      expect(first.provider_metadata.request_count).toBe(1)
      expect(second.provider_metadata.request_count).toBe(1)
      expect(server.requests.length).toBe(2)
      expect(guard.attempted).toEqual([])
    } finally {
      guard.restore()
      await server.close()
    }
  })

  test("provider-backed stream cancellation does not complete with partial text", async () => {
    const controller = new AbortController()
    let requestCount = 0
    const fetchFixture = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestCount += 1
      const encoder = new TextEncoder()
      return new Response(new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(encoder.encode(`data: ${JSON.stringify({
            id: "chatcmpl_abort",
            object: "chat.completion.chunk",
            choices: [{ index: 0, delta: { role: "assistant", content: "partial" }, finish_reason: null }],
          })}\n\n`))
          const timer = setTimeout(() => {
            streamController.enqueue(encoder.encode(`data: ${JSON.stringify({
              id: "chatcmpl_abort",
              object: "chat.completion.chunk",
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            })}\n\ndata: [DONE]\n\n`))
            streamController.close()
          }, 1000)
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timer)
            streamController.error(new DOMException("request was cancelled", "AbortError"))
          }, { once: true })
        },
      }), { status: 200, headers: { "content-type": "text/event-stream" } })
    }) as typeof fetch
    const adapter = createVercelAiSdkCoreAdapter({ baseURL: "http://127.0.0.1:18181/v1", apiKey: "fixture-key", fetch: fetchFixture })
    const events = []
    const stream = adapter.executeOneStreamedStep(baseRequest({ messages: [{ role: "user", content: "slow stream" }], abort_signal: controller.signal }))
    setTimeout(() => controller.abort(), 10)
    for await (const event of stream) events.push(event)
    expect(events.some((event) => event.type === "error" && event.error.toLowerCase().includes("cancel"))).toBe(true)
    expect(events.some((event) => event.type === "completed")).toBe(false)
    expect(requestCount).toBe(1)
  })

  test("provider-backed retryable failures are not retried by the adapter", async () => {
    const server = await startMockOpenAICompatibleServer(() => "http_429")
    const guard = installNetworkGuard([new URL(server.url).origin])
    const originalConsoleError = console.error
    try {
      console.error = () => {}
      const adapter = createVercelAiSdkCoreAdapter({ baseURL: `${server.url}/v1`, apiKey: "fixture-key" })
      const result = await adapter.executeOneStep(baseRequest({ messages: [{ role: "user", content: "429" }] }))
      expect(result.status).toBe("failed")
      expect(result.provider_metadata.request_count).toBe(server.requests.length)
      expect(server.requests.length).toBe(1)

      const events = []
      for await (const event of adapter.executeOneStreamedStep(baseRequest({ messages: [{ role: "user", content: "429 stream" }] }))) events.push(event)
      expect(events.some((event) => event.type === "error")).toBe(true)
      expect(server.requests.length).toBe(2)
      expect(guard.attempted).toEqual([])
    } finally {
      console.error = originalConsoleError
      guard.restore()
      await server.close()
    }
  })

  test("non-loopback network is blocked and redacted", async () => {
    const guard = installNetworkGuard(["http://127.0.0.1:1"])
    try {
      await expect(fetch("https://example.com/secret?token=abc")).rejects.toThrow("network guard blocked")
      expect(guard.attempted).toEqual(["https://example.com"])
    } finally {
      guard.restore()
    }
  })
})
