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
      expect(events.some((event) => event.type === "completed")).toBe(true)
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
