import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { $ } from "bun"
import { NoSuchToolError } from "ai"
import { RuntimeServer } from "../server"
import { EventStore } from "../events/event-store"
import { ExternalApiConnectorRegistry } from "../external-api/api-connector-registry"
import { ExternalApiRequestService } from "../external-api/api-request-service"
import { FakeExternalApiTransport, FetchExternalApiTransport } from "../external-api/api-transport"
import { FakeOpenCodeAdapter } from "../opencode/fake-adapter"
import { COMMAND_AUTHORITY_REGISTRY } from "../authority/command-authority-registry"
import { COMMANDER_TOOL_REGISTRY } from "../commander-tools/commander-tool-registry"
import { CommanderToolService } from "../commander-tools/commander-tool-service"
import { CommandAuthorityService } from "../authority/command-authority-service"
import { ContextBudgetService } from "../context/context-budget-service"
import { ModelCapabilityRegistry } from "../context/model-capability-registry"
import { ResearchMemoryService } from "../research-memory/research-memory-service"
import { CommanderOperationalMemorySearchService } from "../commander-tools/commander-operational-memory-search-service"
import { CommanderRepoReadService } from "../commander-tools/commander-repo-read-service"
import {
  AiSdkCommanderModelStepAdapter,
  COMMANDER_BOUND_TOOL_IDS,
  CONNECTOR_MANAGED_API_KEY_SENTINEL,
  ConnectorBackedCommanderModelStepAdapter,
  CommanderInvestigationContextService,
  CommanderInvestigationController,
  CommanderToolExecutor,
  ScriptedCommanderModelStepAdapter,
  buildProviderToolMap,
  commanderToolSchemaFromDescriptor,
  connectorChatCompletionsUrl,
  createExternalApiConnectorFetch,
  createCommanderToolBindingRegistry,
  parseJsonFallback,
  providerJsonSchema,
  providerToolNameFor,
  toCommanderToolResultMessage,
  validateCommanderConnectorModelTransportConfig,
  validateCommanderToolArguments,
  type CommanderModelStepAdapter,
  type CommanderModelStepRequest,
} from "."

const servers: Array<{ stop(force?: boolean): Promise<void> | void }> = []

afterEach(async () => {
  while (servers.length) await servers.pop()?.stop(true)
})

describe("Commander AI SDK model adapter", () => {
  test("runtime package pins exact AI SDK versions and production does not import spike or OpenAI Agents", async () => {
    const pkg = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as { dependencies?: Record<string, string> }
    expect(pkg.dependencies?.ai).toBe("7.0.29")
    expect(pkg.dependencies?.["@ai-sdk/openai-compatible"]).toBe("3.0.11")
    expect(pkg.dependencies?.["@openai/agents"]).toBeUndefined()
    const grep = await $`bash -lc "rg -n 'commander-agent-runtime-sdk-fit|@openai/agents' src package.json -g '!src/commander-agent/commander-agent.test.ts' || true"`.cwd(process.cwd()).text()
    expect(grep.trim()).toBe("")
    const serverActivationGrep = await $`bash -lc "rg -n 'ConnectorBackedCommanderModelStepAdapter|commanderInvestigationProviderConfig' src/server.ts src/launch-config.ts || true"`.cwd(process.cwd()).text()
    expect(serverActivationGrep.trim()).toBe("")
  })

  test("connector transport config and chat-completions URL policy are strict and credential-free", () => {
    const config = validateCommanderConnectorModelTransportConfig({
      transport_kind: "openai_compatible_connector",
      provider_id: "provider",
      connector_id: "connector",
      model_id: "model",
      timeout_ms: 5000,
      max_request_bytes: 4096,
      max_response_bytes: 8192,
    })
    expect(config.transport_kind).toBe("openai_compatible_connector")
    expect(() => validateCommanderConnectorModelTransportConfig({ ...config, api_key: "secret" })).toThrow("unknown")
    expect(() => validateCommanderConnectorModelTransportConfig({ ...config, base_url: "https://api.example.test" })).toThrow("unknown")
    expect(() => validateCommanderConnectorModelTransportConfig({ ...config, provider_id: "" })).toThrow("provider_id is required")
    expect(() => validateCommanderConnectorModelTransportConfig({ ...config, timeout_ms: 120_001 })).toThrow("timeout_ms")
    expect(() => validateCommanderConnectorModelTransportConfig({ ...config, max_request_bytes: 65_537 })).toThrow("max_request_bytes")
    expect(() => validateCommanderConnectorModelTransportConfig({ ...config, max_response_bytes: 262_145 })).toThrow("max_response_bytes")
    expect(connectorChatCompletionsUrl(connector("nested", "https://api.example.test/custom/openai/v1/")).toString()).toBe("https://api.example.test/custom/openai/v1/chat/completions")
    expect(connectorChatCompletionsUrl(connector("plain", "https://api.example.test/v1")).toString()).toBe("https://api.example.test/v1/chat/completions")
  })

  test("connector-managed AI SDK credential mode rejects real credentials and uses a non-secret sentinel only internally", () => {
    expect(() => new AiSdkCommanderModelStepAdapter({ provider_name: "fixture", base_url: "http://127.0.0.1:1/v1", fetch: loopbackFetch("http://127.0.0.1:1") })).toThrow("api_key is required")
    expect(() => new AiSdkCommanderModelStepAdapter({ provider_name: "fixture", base_url: "http://127.0.0.1:1/v1", credential_mode: "connector_managed", api_key: "real-secret", fetch: loopbackFetch("http://127.0.0.1:1") })).toThrow("must not receive api_key")
    expect(() => new AiSdkCommanderModelStepAdapter({ provider_name: "fixture", base_url: "http://127.0.0.1:1/v1", credential_mode: "connector_managed", default_headers: { Authorization: "Bearer real-secret" }, fetch: loopbackFetch("http://127.0.0.1:1") })).toThrow("credential-like header")
    expect(CONNECTOR_MANAGED_API_KEY_SENTINEL).not.toMatch(/sk-|Bearer|token|secret/i)
  })

  test("connector fetch bridge accepts only exact chat completions JSON POST and strips sentinel credentials", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w2b1-bridge-"))
    const transport = new FakeExternalApiTransport([{ status_code: 200, body: chatCompletionText("bridge ok") }])
    const registry = new ExternalApiConnectorRegistry([connector("openai-test", "https://api.example.test/v1")])
    const requestService = new ExternalApiRequestService({
      registry,
      transport,
      eventStore: new EventStore(join(projectDir, ".nxl", "events.jsonl")),
      env: { NXL_TEST_MODEL_KEY: "real-provider-key" },
      requestId: () => "api_bridge",
      now: () => new Date("2026-07-21T00:00:00.000Z"),
    })
    const { fetch: bridgeFetch, metadata } = createExternalApiConnectorFetch({
      registry,
      requestService,
      config: connectorConfig(),
      context: { commander_model_request_id: "req_bridge", requested_by: "tester", provider_id: "fixture_provider", model_id: "fixture-model" },
    })
    const expected = "https://api.example.test/v1/chat/completions"
    await expect(bridgeFetch(expected.replace("/chat/completions", "/responses"), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).rejects.toThrow("chat completions")
    await expect(bridgeFetch(`${expected}?q=1`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).rejects.toThrow("query")
    await expect(bridgeFetch(expected.replace("https://", "https://user:secret@"), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).rejects.toThrow("URL credentials")
    await expect(bridgeFetch(expected, { method: "GET", headers: { "Content-Type": "application/json" }, body: "{}" })).rejects.toThrow("POST")
    const validBody = JSON.stringify({ model: "fixture-model", messages: [] })
    await expect(bridgeFetch(expected, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer real-secret" }, body: validBody })).rejects.toThrow("Authorization")
    await expect(bridgeFetch(expected, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": "real-secret" }, body: validBody })).rejects.toThrow("credential header")
    await expect(bridgeFetch(expected, { method: "POST", headers: { "Content-Type": "application/json" }, body: new URLSearchParams({ q: "x" }) })).rejects.toThrow("URLSearchParams")
    await expect(bridgeFetch(expected, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "other-model", messages: [] }) })).rejects.toThrow("model_id")
    expect(transport.requests).toHaveLength(0)

    const longHeaderName = `x-${"a".repeat(200)}`
    const response = await bridgeFetch(expected, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${CONNECTOR_MANAGED_API_KEY_SENTINEL}`, "user-agent": "sdk-test/1", "x-ai-sdk-version": "7", [longHeaderName]: "dropped" },
      body: JSON.stringify({ model: "fixture-model", messages: [{ role: "user", content: "prompt secret_should_not_persist" }] }),
    })
    expect(response.status).toBe(200)
    expect(transport.requests).toHaveLength(1)
    expect(transport.requests[0].url).toBe("https://api.example.test/v1/chat/completions")
    expect(transport.requests[0].headers.Authorization).toBe("Bearer real-provider-key")
    expect(JSON.stringify(transport.requests[0].headers)).not.toContain(CONNECTOR_MANAGED_API_KEY_SENTINEL)
    expect(metadata.dropped_header_names).toEqual(expect.arrayContaining(["user-agent", "x-ai-sdk-version"]))
    const boundedLongHeader = metadata.dropped_header_names.find((name) => name.startsWith("x-aaaa"))
    expect(boundedLongHeader).toBeDefined()
    expect(boundedLongHeader!.length).toBeLessThanOrEqual(80)
    expect(metadata.dropped_header_names.join(" ")).not.toContain("a".repeat(120))
    const events = await eventText(projectDir)
    expect(events).toContain("external_api_request_executed")
    expect(events).not.toContain("secret_should_not_persist")
    expect(events).not.toContain("real-provider-key")
    expect(events).not.toContain(CONNECTOR_MANAGED_API_KEY_SENTINEL)
  })

  test("connector-backed model adapter normalizes tool calls and carries bounded audit metadata without changing output hash", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w2b1-adapter-"))
    const transport = new FakeExternalApiTransport([{ status_code: 200, body: JSON.stringify(chatBody("tool")) }])
    const adapter = connectorBackedAdapter(projectDir, transport)
    const request = baseRequest({ baseUrl: "http://127.0.0.1:1" }).request
    const result = await adapter.executeOneStep({ ...request, provider_id: "fixture_provider", model_id: "fixture-model", metadata: { requested_by: "tester", investigation_id: "inv_1" } })
    expect(result.adapter_id).toBe("external_api_connector_ai_sdk_core")
    expect(result.status).toBe("tool_call")
    expect(result.request_count).toBe(1)
    expect(result.tool_calls[0].tool_id).toBe("memory.search")
    const metadata = result.provider_metadata.nexusloop_transport as { connector_id: string; request_ids: string[]; audit_event_count: number; request_body_persisted: boolean; response_body_persisted: boolean; credentials_persisted: boolean }
    expect(metadata.connector_id).toBe("openai-test")
    expect(metadata.request_ids).toEqual(["api_connector_1"])
    expect(metadata.audit_event_count).toBe(1)
    expect(metadata.request_body_persisted).toBe(false)
    expect(metadata.response_body_persisted).toBe(false)
    expect(metadata.credentials_persisted).toBe(false)
    const sameOutputDifferentAudit = await connectorBackedAdapter(projectDir, new FakeExternalApiTransport([{ status_code: 200, body: JSON.stringify(chatBody("tool")) }]), "api_connector_2").executeOneStep({ ...request, provider_id: "fixture_provider", model_id: "fixture-model" })
    expect(sameOutputDifferentAudit.result_hash).toBe(result.result_hash)
    const events = await eventText(projectDir)
    expect(events).not.toContain("research memory")
    expect(events).not.toContain("real-provider-key")
    expect(events).not.toContain(CONNECTOR_MANAGED_API_KEY_SENTINEL)
  })

  test("connector-backed provider errors return sanitized bodies to the AI SDK", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w2b1-sanitized-error-"))
    const echoedSecret = "prompt-secret-should-not-leak"
    const transport = new FakeExternalApiTransport([{
      status_code: 429,
      body: JSON.stringify({ error: { message: `rate limited after seeing ${echoedSecret}` } }),
    }])
    const adapter = connectorBackedAdapter(projectDir, transport)
    const request = baseRequest({ baseUrl: "http://127.0.0.1:1", content: `objective ${echoedSecret}` }).request
    const result = await adapter.executeOneStep({ ...request, provider_id: "fixture_provider", model_id: "fixture-model" })
    expect(result.status).toBe("failed")
    expect(result.request_count).toBe(1)
    expect(result.error ?? "").toContain("connector-backed provider request failed")
    expect(JSON.stringify(result)).not.toContain(echoedSecret)
    const events = await eventText(projectDir)
    expect(events).toContain("external_api_request_failed")
    expect(events).not.toContain(echoedSecret)
    expect(events).not.toContain("rate limited after seeing")
    expect(events).not.toContain("real-provider-key")
    expect(events).not.toContain(CONNECTOR_MANAGED_API_KEY_SENTINEL)
  })

  test("connector-backed adapter mismatch and streaming perform zero connector requests", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w2b1-zero-"))
    const transport = new FakeExternalApiTransport([{ status_code: 200, body: JSON.stringify(chatBody("tool")) }])
    const adapter = connectorBackedAdapter(projectDir, transport)
    const request = baseRequest({ baseUrl: "http://127.0.0.1:1" }).request
    const mismatch = await adapter.executeOneStep({ ...request, provider_id: "wrong" })
    expect(mismatch.status).toBe("failed")
    expect(mismatch.request_count).toBe(0)
    expect(transport.requests).toHaveLength(0)
    const events = []
    for await (const event of adapter.executeOneStreamedStep(request)) events.push(event)
    expect(events).toEqual([{ type: "error", error: "connector-backed Commander model streaming is not enabled for request req_test" }])
    expect(transport.requests).toHaveLength(0)
  })

  test("connector-backed loopback integration uses ExternalApiTransport and persists metadata-only audit", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w2b1-loopback-"))
    let serverCredential = ""
    let serverBody = ""
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        serverCredential = request.headers.get("authorization") ?? ""
        serverBody = await request.text()
        return Response.json(chatBody("tool"))
      },
    })
    servers.push(server)
    const origin = `http://localhost:${server.port}`
    const registry = new ExternalApiConnectorRegistry([connector("openai-test", `${origin}/v1`, { allowLocalHttp: true, allowedHosts: ["localhost"] })])
    const requestService = new ExternalApiRequestService({
      registry,
      transport: new FetchExternalApiTransport({ resolveHostAddresses: async () => [{ address: "127.0.0.1" }] }),
      eventStore: new EventStore(join(projectDir, ".nxl", "events.jsonl")),
      env: { NXL_TEST_MODEL_KEY: "real-provider-key" },
      requestId: () => "api_loopback",
      now: () => new Date("2026-07-21T00:00:00.000Z"),
    })
    const adapter = new ConnectorBackedCommanderModelStepAdapter({ config: connectorConfig({ max_response_bytes: 32_000 }), registry, requestService })
    const request = baseRequest({ baseUrl: "http://127.0.0.1:1", content: "loopback prompt secret_prompt_value" }).request
    const result = await adapter.executeOneStep({ ...request, provider_id: "fixture_provider", model_id: "fixture-model" })
    expect(result.status).toBe("tool_call")
    expect(result.request_count).toBe(1)
    expect(result.tool_calls).toHaveLength(1)
    expect(serverCredential).toBe("Bearer real-provider-key")
    expect(serverBody).toContain("memory__search")
    const serializedResult = JSON.stringify(result)
    expect(serializedResult).not.toContain("real-provider-key")
    expect(serializedResult).not.toContain(CONNECTOR_MANAGED_API_KEY_SENTINEL)
    const events = await eventText(projectDir)
    expect(events).toContain("external_api_request_executed")
    expect(events).toContain("[internal response preview omitted]")
    expect(events).not.toContain("secret_prompt_value")
    expect(events).not.toContain("memory__search")
    expect(events).not.toContain("real-provider-key")
    expect(events).not.toContain(CONNECTOR_MANAGED_API_KEY_SENTINEL)
  })

  test("external API internal request extensions cap responses, propagate aborts, and observe persisted audits", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w2b1-internal-api-"))
    const transport = new FakeExternalApiTransport([{ status_code: 200, body: "ok" }, { status_code: 200, body: "too-large" }])
    const registry = new ExternalApiConnectorRegistry([connector("openai-test", "https://api.example.test/v1", { maxResponseBytes: 20 })])
    const observed: string[] = []
    const requestService = new ExternalApiRequestService({
      registry,
      transport,
      eventStore: new EventStore(join(projectDir, ".nxl", "events.jsonl")),
      env: { NXL_TEST_MODEL_KEY: "real-provider-key" },
      requestId: () => `api_internal_${observed.length + 1}`,
      now: () => new Date("2026-07-21T00:00:00.000Z"),
    })
    const result = await requestService.executeForInternalUse({
      connector_id: "openai-test",
      method: "POST",
      path: "/v1/chat/completions",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      requested_by: "tester",
    }, {
      max_response_bytes: 5,
      redact_response_body: false,
      omit_response_preview_from_audit: true,
      on_audit_persisted: (record) => {
        observed.push(record.event_kind)
        throw new Error("observer failure should not corrupt execution")
      },
    })
    expect(result.ok).toBe(true)
    expect(transport.requests[0].max_response_bytes).toBe(5)
    expect(transport.requests[0].fail_on_response_overflow).toBe(true)
    expect(observed).toEqual(["external_api_request_executed"])
    await expect(requestService.executeForInternalUse({
      connector_id: "openai-test",
      method: "POST",
      path: "/v1/chat/completions",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      requested_by: "tester",
    }, { max_response_bytes: 25, on_audit_persisted: (record) => observed.push(record.event_kind) })).rejects.toThrow("max_response_bytes")
    const controller = new AbortController()
    controller.abort()
    await expect(requestService.executeForInternalUse({
      connector_id: "openai-test",
      method: "POST",
      path: "/v1/chat/completions",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      requested_by: "tester",
    }, { abort_signal: controller.signal, on_audit_persisted: (record) => observed.push(record.event_kind) })).rejects.toThrow("cancelled")
    expect(transport.requests).toHaveLength(1)
    const events = await eventText(projectDir)
    expect(events).toContain("external_api_request_executed")
    expect(events).toContain("external_api_request_failed")
    expect(events).not.toContain("real-provider-key")
  })

  test("external API internal requests honor abort during service-level host validation", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w2b1-service-host-abort-"))
    let resolverStarted = false
    const transport = new FakeExternalApiTransport([{ status_code: 200, body: "ok" }])
    const requestService = new ExternalApiRequestService({
      registry: new ExternalApiConnectorRegistry([connector("openai-test", "https://api.example.test/v1")]),
      transport,
      eventStore: new EventStore(join(projectDir, ".nxl", "events.jsonl")),
      env: { NXL_TEST_MODEL_KEY: "real-provider-key" },
      resolveHostAddresses: async () => {
        resolverStarted = true
        return new Promise(() => undefined)
      },
      requestId: () => "api_service_abort",
      now: () => new Date("2026-07-21T00:00:00.000Z"),
    })
    const controller = new AbortController()
    const promise = requestService.executeForInternalUse({
      connector_id: "openai-test",
      method: "POST",
      path: "/v1/chat/completions",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      requested_by: "tester",
    }, { abort_signal: controller.signal })
    await Promise.resolve()
    expect(resolverStarted).toBe(true)
    controller.abort()
    await expect(promise).rejects.toThrow("cancelled")
    expect(transport.requests).toHaveLength(0)
    const events = await eventText(projectDir)
    expect(events).toContain("external_api_request_failed")
    expect(events).toContain("external API request cancelled")
    expect(events).not.toContain("real-provider-key")
  })

  test("fetch external API transport cancels parent aborts without following redirects", async () => {
    const originalFetch = globalThis.fetch
    let capturedSignal: AbortSignal | undefined
    let capturedRedirect: RequestRedirect | undefined
    let rejectFetch: ((error: Error) => void) | undefined
    let markFetchStarted: (() => void) | undefined
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve
    })
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined
      capturedRedirect = init?.redirect
      markFetchStarted?.()
      return new Promise<Response>((_resolve, reject) => {
        rejectFetch = reject
        init?.signal?.addEventListener("abort", () => reject(new Error("fetch aborted")), { once: true })
        void input
      })
    }) as typeof fetch
    try {
      const transport = new FetchExternalApiTransport({ resolveHostAddresses: async () => [{ address: "93.184.216.34" }] })
      const controller = new AbortController()
      const promise = transport.request({
        method: "POST",
        url: "https://api.example.test/v1/chat/completions",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        timeout_ms: 5000,
        max_response_bytes: 100,
        abort_signal: controller.signal,
      })
      await fetchStarted
      controller.abort()
      await expect(promise).rejects.toThrow("cancelled")
      expect(capturedSignal?.aborted).toBe(true)
      expect(capturedRedirect).toBe("manual")
      rejectFetch?.(new Error("late reject"))
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("fetch external API transport honors abort while resolving connector hosts", async () => {
    const originalFetch = globalThis.fetch
    let resolverStarted = false
    let fetchCalled = false
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      void input
      void init
      fetchCalled = true
      return Promise.reject(new Error("fetch should not start while host resolution is cancelled"))
    }) as typeof fetch
    try {
      const transport = new FetchExternalApiTransport({
        resolveHostAddresses: async () => {
          resolverStarted = true
          return new Promise(() => undefined)
        },
      })
      const controller = new AbortController()
      const promise = transport.request({
        method: "POST",
        url: "https://api.example.test/v1/chat/completions",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        timeout_ms: 5000,
        max_response_bytes: 100,
        abort_signal: controller.signal,
      })
      await Promise.resolve()
      expect(resolverStarted).toBe(true)
      controller.abort()
      await expect(promise).rejects.toThrow("cancelled")
      expect(fetchCalled).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("fetch external API transport throws when abort cancels a stalled response body", async () => {
    const originalFetch = globalThis.fetch
    let markFetchStarted: (() => void) | undefined
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve
    })
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      void input
      markFetchStarted?.()
      init?.signal?.throwIfAborted?.()
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
        start() {
          // Leave the body pending until the parent abort cancels the reader.
        },
      }), { status: 200 }))
    }) as typeof fetch
    try {
      const transport = new FetchExternalApiTransport({ resolveHostAddresses: async () => [{ address: "93.184.216.34" }] })
      const controller = new AbortController()
      const promise = transport.request({
        method: "POST",
        url: "https://api.example.test/v1/chat/completions",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        timeout_ms: 5000,
        max_response_bytes: 100,
        abort_signal: controller.signal,
      })
      await fetchStarted
      controller.abort()
      await expect(promise).rejects.toThrow("cancelled")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("adapter requires injected fetch and performs one native request without executing tools", async () => {
    expect(() => new AiSdkCommanderModelStepAdapter({ provider_name: "fixture", base_url: "http://127.0.0.1:1/v1", api_key: "key", fetch: undefined as unknown as typeof fetch })).toThrow()
    const mock = startMockServer("tool")
    const request = baseRequest({ baseUrl: mock.url, content: "please use a tool" })
    const result = await request.adapter.executeOneStep(request.request)
    expect(result.status).toBe("tool_call")
    expect(result.request_count).toBe(1)
    expect(result.raw_provider_payload_included).toBe(false)
    expect(result.tool_calls.map((call) => call.tool_id)).toEqual(["memory.search"])
    expect(result.tool_calls[0].arguments_valid).toBe(true)
    expect(JSON.stringify(result)).not.toContain("secret-api-key")
    expect(mock.requests).toHaveLength(1)
    expect(JSON.stringify(mock.requests[0].body)).toContain("memory__search")
    expect(JSON.stringify(mock.requests[0].body)).not.toContain("execute")
  })

  test("adapter preserves raw execution arguments without serializing secret-like literals", async () => {
    const secretQuery = "sk-investigateLiteral123456"
    const mock = startMockServer("secret_tool")
    const request = baseRequest({ baseUrl: mock.url, content: "search exact suspected key", overrides: { metadata: { secret_query: secretQuery } } })
    const result = await request.adapter.executeOneStep(request.request)
    expect(result.status).toBe("tool_call")
    const call = result.tool_calls[0]
    expect(call.tool_id).toBe("repo.search_text")
    expect(call.arguments.query).toBe("[REDACTED]")
    expect(call.execution_arguments?.query).toBe(secretQuery)
    expect(Object.keys(call)).not.toContain("execution_arguments")
    expect(JSON.stringify(result)).not.toContain(secretQuery)
    expect(result.result_hash).not.toContain(secretQuery)
  })

  test("native adapter preserves multiple tool calls order ids and canonical underscore IDs", async () => {
    const mock = startMockServer("multi_tool")
    const request = baseRequest({ baseUrl: mock.url, content: "multi tool" })
    const result = await request.adapter.executeOneStep(request.request)
    expect(result.status).toBe("tool_call")
    expect(result.assistant_message?.content.map((part) => part.type === "text" ? part.text : part.tool_call_id)).toEqual(["checking tools", "call_memory", "call_git"])
    expect(providerToolNameFor("repo.git_status")).toBe("repo__git_status")
    expect(providerToolNameFor("repo.some_tool")).toBe("repo__some_tool")
  })

  test("provider names use request scoped maps and collisions or unknown provider names fail closed", () => {
    const memory = modelTool("memory.search")
    expect(buildProviderToolMap([memory]).get("memory__search")?.tool_id).toBe("memory.search")
    expect(() => buildProviderToolMap([memory, { ...modelTool("memory.near_duplicates"), provider_tool_name: "memory__search" }])).toThrow()
    const call = parseJsonFallback(JSON.stringify({ type: "tool_call", tool_id: "missing.tool", arguments: {} }), [memory])
    expect(call.status).toBe("malformed")
  })

  test("canonical schema validation covers required unknown nested array enum and integer rules", () => {
    const schema = {
      schema_version: "nxl-commander-tool-v1" as const,
      type: "object" as const,
      additionalProperties: false as const,
      required: ["query", "nested"],
      properties: {
        query: { type: "string" as const, maxLength: 5 },
        count: { type: "integer" as const, minimum: 1, maximum: 2 },
        nested: { type: "object" as const, required: ["kind"], additionalProperties: false as const, properties: { kind: { type: "string" as const, enum: ["a"] }, values: { type: "array" as const, items: { type: "number" as const } } } },
      },
    }
    expect(validateCommanderToolArguments(schema, { query: "abc", count: 2, nested: { kind: "a", values: [1] } }).valid).toBe(true)
    const invalid = validateCommanderToolArguments(schema, { query: "abcdef", count: 1.5, nested: { kind: "b", extra: true }, extra: false })
    expect(invalid.valid).toBe(false)
    expect(invalid.errors.join(" ")).toContain("unknown")
  })

  test("tool choices, temperature zero, output caps, structured schemas, and schema_version stripping reach provider", async () => {
    const mock = startMockServer("text")
    const request = baseRequest({ baseUrl: mock.url, content: "plain", overrides: { tool_choice: "required", temperature: 0, max_output_tokens: 33, structured_output_schema: modelTool("memory.search").input_schema } })
    await request.adapter.executeOneStep(request.request)
    const body = mock.requests[0].body as Record<string, unknown>
    expect(JSON.stringify(body)).toContain("required")
    expect(JSON.stringify(body)).toContain("\"temperature\":0")
    expect(JSON.stringify(body)).toContain("33")
    expect(JSON.stringify(body)).not.toContain("schema_version")
    expect(providerJsonSchema(modelTool("memory.search").input_schema)).not.toHaveProperty("schema_version")
  })

  test("structured validation failures refusals and missing usage normalize without fabricated usage", async () => {
    const invalid = startMockServer("structured_invalid")
    const invalidRequest = baseRequest({ baseUrl: invalid.url, overrides: { structured_output_schema: modelTool("memory.search").input_schema } })
    const invalidResult = await invalidRequest.adapter.executeOneStep(invalidRequest.request)
    expect(invalidResult.status).toBe("malformed")
    expect(invalidResult.request_count).toBe(1)

    const refusal = startMockServer("refusal")
    const refusalRequest = baseRequest({ baseUrl: refusal.url })
    const refusalResult = await refusalRequest.adapter.executeOneStep(refusalRequest.request)
    expect(refusalResult.status).toBe("refusal")
    expect(refusalResult.request_count).toBe(1)

    const noUsage = startMockServer("no_usage")
    const noUsageRequest = baseRequest({ baseUrl: noUsage.url })
    const noUsageResult = await noUsageRequest.adapter.executeOneStep(noUsageRequest.request)
    expect(noUsageResult.status).toBe("final")
    expect(noUsageResult.usage.provider_reported).toBe(false)
    expect(noUsageResult.usage.total_tokens).toBeUndefined()

    const cacheUsage = startMockServer("cache_usage")
    const cacheUsageRequest = baseRequest({ baseUrl: cacheUsage.url })
    const cacheUsageResult = await cacheUsageRequest.adapter.executeOneStep(cacheUsageRequest.request)
    expect(cacheUsageResult.usage.cached_input_tokens).toBe(5)
    expect(cacheUsageResult.usage.raw_usage_summary).toMatchObject({ cacheReadTokens: 5 })

    const structuredRate = startMockServer("http_429")
    const structuredRateRequest = baseRequest({ baseUrl: structuredRate.url, overrides: { structured_output_schema: modelTool("memory.search").input_schema } })
    const structuredRateResult = await structuredRateRequest.adapter.executeOneStep(structuredRateRequest.request)
    expect(structuredRateResult.status).toBe("failed")
    expect(structuredRateResult.request_count).toBe(1)
  })

  test("invalid native arguments are malformed at call level and native mode does not reinterpret JSON finals", async () => {
    const malformed = startMockServer("malformed_tool")
    const malformedResult = await baseRequest({ baseUrl: malformed.url, content: "malformed tool" }).adapter.executeOneStep(baseRequest({ baseUrl: malformed.url, content: "malformed tool" }).request)
    expect(malformedResult.status).toBe("tool_call")
    expect(malformedResult.tool_calls[0].arguments_valid).toBe(false)

    const fallback = startMockServer("json_fallback")
    const nativeRequest = baseRequest({ baseUrl: fallback.url, content: "fallback", overrides: { tool_protocol: "native" } })
    const nativeResult = await nativeRequest.adapter.executeOneStep(nativeRequest.request)
    expect(nativeResult.status).toBe("final")
    expect(nativeResult.tool_calls).toHaveLength(0)
  })

  test("strict JSON fallback parses tool and final envelopes only in fallback mode", async () => {
    const mock = startMockServer("json_fallback")
    const req = baseRequest({ baseUrl: mock.url, content: "fallback", overrides: { tool_protocol: "json_fallback" } })
    const result = await req.adapter.executeOneStep(req.request)
    expect(result.status).toBe("tool_call")
    expect(result.tool_calls[0]).toMatchObject({ tool_id: "memory.search", arguments_valid: true })
    expect(parseJsonFallback(JSON.stringify({ type: "final", final: { summary: "done" }, extra: true }), req.request.tools)).toMatchObject({ status: "malformed" })
    expect(parseJsonFallback("x".repeat(5000), req.request.tools)).toMatchObject({ status: "malformed" })

    const refusal = startMockServer("refusal")
    const refusalReq = baseRequest({ baseUrl: refusal.url, overrides: { tool_protocol: "json_fallback" } })
    await expect(refusalReq.adapter.executeOneStep(refusalReq.request)).resolves.toMatchObject({ status: "refusal", request_count: 1 })

    const forbiddenTool = startMockServer("json_fallback")
    const forbiddenToolReq = baseRequest({ baseUrl: forbiddenTool.url, content: "fallback", overrides: { tool_protocol: "json_fallback", tool_choice: "none" } })
    await expect(forbiddenToolReq.adapter.executeOneStep(forbiddenToolReq.request)).resolves.toMatchObject({ status: "malformed", request_count: 1 })

    const missingTool = startMockServer("json_fallback_final")
    const missingToolReq = baseRequest({ baseUrl: missingTool.url, content: "fallback", overrides: { tool_protocol: "json_fallback", tool_choice: "required" } })
    await expect(missingToolReq.adapter.executeOneStep(missingToolReq.request)).resolves.toMatchObject({ status: "malformed", request_count: 1 })
    expect(JSON.stringify(missingTool.requests[0].body)).not.toContain("required")
  })

  test("native mode enforces tool_choice postconditions after provider output", async () => {
    const ignoredNone = startMockServer("tool")
    const noTools = baseRequest({ baseUrl: ignoredNone.url, content: "tool despite none", overrides: { tool_choice: "none" } })
    await expect(noTools.adapter.executeOneStep(noTools.request)).resolves.toMatchObject({ status: "malformed", request_count: 1 })

    const ignoredRequired = startMockServer("text")
    const required = baseRequest({ baseUrl: ignoredRequired.url, content: "text despite required", overrides: { tool_choice: "required" } })
    await expect(required.adapter.executeOneStep(required.request)).resolves.toMatchObject({ status: "malformed", request_count: 1 })

    const droppedTool = startMockServer("empty_tool_finish")
    const dropped = baseRequest({ baseUrl: droppedTool.url, content: "tool finish without call" })
    await expect(dropped.adapter.executeOneStep(dropped.request)).resolves.toMatchObject({ status: "malformed", request_count: 1 })
  })

  test("streaming emits text, tool call events, usage, completed result, and uses the same request", async () => {
    const mock = startMockServer("stream_tool")
    const request = baseRequest({ baseUrl: mock.url, content: "stream tool" })
    const events = []
    for await (const event of request.adapter.executeOneStreamedStep(request.request)) events.push(event)
    expect(events.map((event) => event.type)).toContain("tool_call_start")
    expect(events.map((event) => event.type)).toContain("tool_call_arguments_delta")
    expect(events.map((event) => event.type)).toContain("tool_call_complete")
    const completed = events.find((event) => event.type === "completed")
    expect(completed?.type === "completed" ? completed.result.request_count : 0).toBe(1)
    expect(mock.requests).toHaveLength(1)
    expect(JSON.stringify(mock.requests[0].body)).toContain("include_usage")

    const refusal = startMockServer("stream_refusal")
    const refusalRequest = baseRequest({ baseUrl: refusal.url, overrides: { tool_protocol: "json_fallback" } })
    const refusalEvents = []
    for await (const event of refusalRequest.adapter.executeOneStreamedStep(refusalRequest.request)) refusalEvents.push(event)
    const refusalCompleted = refusalEvents.find((event) => event.type === "completed")
    expect(refusalCompleted?.type === "completed" ? refusalCompleted.result.status : "").toBe("refusal")

    const fallbackTool = startMockServer("stream_json_fallback_tool")
    const fallbackRequest = baseRequest({ baseUrl: fallbackTool.url, overrides: { tool_protocol: "json_fallback" } })
    const fallbackEvents = []
    for await (const event of fallbackRequest.adapter.executeOneStreamedStep(fallbackRequest.request)) fallbackEvents.push(event)
    expect(fallbackEvents.map((event) => event.type)).not.toContain("text_delta")
    expect(fallbackEvents.map((event) => event.type)).toContain("tool_call_complete")
    expect(fallbackEvents.filter((event) => event.type === "text_delta").map((event) => event.text).join("")).not.toContain("\"tool_id\"")
  })

  test("non-stream and stream provider failures and aborts remain one request", async () => {
    const rate = startMockServer("http_429")
    const rateReq = baseRequest({ baseUrl: rate.url, content: "429" })
    const rateResult = await rateReq.adapter.executeOneStep(rateReq.request)
    expect(rateResult.status).toBe("failed")
    expect(rateResult.request_count).toBe(1)

    const slow = startMockServer("slow")
    const controller = new AbortController()
    const slowReq = baseRequest({ baseUrl: slow.url, content: "slow", overrides: { abort_signal: controller.signal } })
    const promise = slowReq.adapter.executeOneStep(slowReq.request)
    controller.abort()
    const cancelled = await promise
    expect(cancelled.status).toBe("cancelled")
    expect(cancelled.request_count).toBeLessThanOrEqual(1)

    const noSuchTool = baseRequest({ baseUrl: "http://127.0.0.1:1" })
    const adapter = new AiSdkCommanderModelStepAdapter({ provider_name: "fixture_provider", base_url: "http://127.0.0.1:1", api_key: "fixture-key", fetch: (async () => { throw new NoSuchToolError({ toolName: "repo__missing" }) }) as unknown as typeof fetch })
    await expect(adapter.executeOneStep(noSuchTool.request)).resolves.toMatchObject({ status: "malformed", request_count: 1 })
  })

  test("message conversion replays multiple assistant tool calls and rejects mismatched tool results", async () => {
    const mock = startMockServer("text")
    const tool1 = modelTool("memory.search")
    const tool2 = modelTool("repo.git_status")
    const request = baseRequest({
      baseUrl: mock.url,
      content: "after tool",
      overrides: {
        messages: [
          { role: "user", content: "call tools" },
          { role: "assistant", content: [
            { type: "text", text: "using tools" },
            { type: "tool_call", tool_call_id: "call_a", tool_id: "memory.search", arguments: { query: "x" }, arguments_valid: true, validation_errors: [], call_hash: "h1" },
            { type: "tool_call", tool_call_id: "call_b", tool_id: "repo.git_status", arguments: {}, arguments_valid: true, validation_errors: [], call_hash: "h2" },
          ] },
          { role: "tool", tool_call_id: "call_a", tool_id: "memory.search", content: "{}", content_hash: "ha", truncated: false },
          { role: "tool", tool_call_id: "call_b", tool_id: "repo.git_status", content: "{}", content_hash: "hb", truncated: false },
        ],
        tools: [tool1, tool2],
      },
    })
    await request.adapter.executeOneStep(request.request)
    expect(mock.requests).toHaveLength(1)
    const body = mock.requests[0].body as { messages: Array<{ tool_calls?: Array<{ function?: { arguments?: string } }>; role?: string; content?: string; tool_call_id?: string }> }
    expect(body.messages[1].tool_calls?.[0].function?.arguments).toBe(JSON.stringify({ query: "x" }))
    expect(body.messages[2]).toMatchObject({ role: "tool", tool_call_id: "call_a", content: "{}" })
    expect(body.messages[3]).toMatchObject({ role: "tool", tool_call_id: "call_b", content: "{}" })
    const bad = baseRequest({ baseUrl: mock.url, overrides: { messages: [{ role: "tool", tool_call_id: "missing", tool_id: "memory.search", content: "{}", content_hash: "x", truncated: false }] } })
    await expect(bad.adapter.executeOneStep(bad.request)).resolves.toMatchObject({ status: "failed" })
    const wrongTool = baseRequest({ baseUrl: mock.url, overrides: {
      messages: [
        { role: "user", content: "call tool" },
        { role: "assistant", content: [{ type: "tool_call", tool_call_id: "call_a", tool_id: "memory.search", arguments: { query: "x" }, arguments_valid: true, validation_errors: [], call_hash: "h1" }] },
        { role: "tool", tool_call_id: "call_a", tool_id: "repo.git_status", content: "{}", content_hash: "wrong", truncated: false },
      ],
      tools: [tool1, tool2],
    } })
    await expect(wrongTool.adapter.executeOneStep(wrongTool.request)).resolves.toMatchObject({ status: "failed" })
    const stale = baseRequest({ baseUrl: mock.url, overrides: {
      messages: [
        { role: "assistant", content: [{ type: "tool_call", tool_call_id: "call_a", tool_id: "memory.search", arguments: { query: "x" }, arguments_valid: true, validation_errors: [], call_hash: "h1" }] },
        { role: "user", content: "intervening turn" },
        { role: "tool", tool_call_id: "call_a", tool_id: "memory.search", content: "{}", content_hash: "stale", truncated: false },
      ],
      tools: [tool1, tool2],
    } })
    await expect(stale.adapter.executeOneStep(stale.request)).resolves.toMatchObject({ status: "failed" })
    const duplicate = baseRequest({ baseUrl: mock.url, overrides: {
      messages: [
        { role: "assistant", content: [{ type: "tool_call", tool_call_id: "call_a", tool_id: "memory.search", arguments: { query: "x" }, arguments_valid: true, validation_errors: [], call_hash: "h1" }] },
        { role: "tool", tool_call_id: "call_a", tool_id: "memory.search", content: "{}", content_hash: "first", truncated: false },
        { role: "tool", tool_call_id: "call_a", tool_id: "memory.search", content: "{}", content_hash: "duplicate", truncated: false },
      ],
      tools: [tool1, tool2],
    } })
    await expect(duplicate.adapter.executeOneStep(duplicate.request)).resolves.toMatchObject({ status: "failed" })
    const unanswered = baseRequest({ baseUrl: mock.url, overrides: {
      messages: [
        { role: "assistant", content: [
          { type: "tool_call", tool_call_id: "call_a", tool_id: "memory.search", arguments: { query: "x" }, arguments_valid: true, validation_errors: [], call_hash: "h1" },
          { type: "tool_call", tool_call_id: "call_b", tool_id: "repo.git_status", arguments: {}, arguments_valid: true, validation_errors: [], call_hash: "h2" },
        ] },
        { role: "tool", tool_call_id: "call_a", tool_id: "memory.search", content: "{}", content_hash: "first", truncated: false },
        { role: "user", content: "next turn before call_b result" },
      ],
      tools: [tool1, tool2],
    } })
    await expect(unanswered.adapter.executeOneStep(unanswered.request)).resolves.toMatchObject({ status: "failed" })
    const trailingUnanswered = baseRequest({ baseUrl: mock.url, overrides: {
      messages: [
        { role: "assistant", content: [
          { type: "tool_call", tool_call_id: "call_a", tool_id: "memory.search", arguments: { query: "x" }, arguments_valid: true, validation_errors: [], call_hash: "h1" },
        ] },
      ],
      tools: [tool1, tool2],
    } })
    await expect(trailingUnanswered.adapter.executeOneStep(trailingUnanswered.request)).resolves.toMatchObject({ status: "failed" })
  })
})

describe("Commander tool executor", () => {
  test("binding registry contains exactly the declared ten tools", () => {
    const registry = testBindingRegistry()
    expect(registry.validation_summary.tool_ids).toEqual([...COMMANDER_BOUND_TOOL_IDS])
    expect(registry.validation_summary.duplicate_tool_ids).toEqual([])
  })

  test("executor preflight blocks unknown, unbound, future, off-phase, and malformed calls before handlers", async () => {
    const { executor, calls } = executorFixture()
    await expect(executor.execute(baseExecution({ tool_id: "missing.tool" }))).resolves.toMatchObject({ status: "blocked", handler_invoked: false })
    await expect(executor.execute(baseExecution({ tool_id: "repo.git_log" }))).resolves.toMatchObject({ status: "blocked", handler_invoked: false })
    await expect(executor.execute(baseExecution({ tool_id: "github.pr_read" }))).resolves.toMatchObject({ status: "blocked", handler_invoked: false })
    await expect(executor.execute(baseExecution({ tool_id: "repo.git_diff", phase: "emergency_inspection" }))).resolves.toMatchObject({ status: "blocked", handler_invoked: false, external_process_invoked: false })
    await expect(executor.execute(baseExecution({ tool_id: "memory.search", arguments: { query: 7 }, modelSaidValid: true }))).resolves.toMatchObject({ status: "blocked", handler_invoked: false })
    expect(calls).toEqual([])
  })

  test("executor invokes valid handlers once and preserves trust, flags, hashes, and bounded result messages", async () => {
    const { executor, calls } = executorFixture()
    const result = await executor.execute(baseExecution({ tool_id: "repo.read_lines", arguments: { path: "src/index.ts" }, tool_call_id: "call_read" }))
    expect(result.status).toBe("ready")
    expect(result.handler_invoked).toBe(true)
    expect(result.external_process_invoked).toBe(false)
    expect(result.trust_class).toBe("repository_content_untrusted")
    expect(result.events_appended).toBe(false)
    expect(result.provider_called).toBe(false)
    expect(result.mcp_called).toBe(false)
    expect(calls).toEqual(["repo.read_lines"])
    expect(result.result_hash).toBe((await executor.execute(baseExecution({ tool_id: "repo.read_lines", arguments: { path: "src/index.ts" }, tool_call_id: "call_read" }))).result_hash)
    const message = toCommanderToolResultMessage(result)
    expect(message.tool_call_id).toBe("call_read")
    expect(Buffer.byteLength(message.content)).toBeLessThanOrEqual(12_000)
  })

  test("executor hashes ignore nested volatile handler timestamps", async () => {
    const { executor } = executorFixture({ volatileReadLinesTool: "repo.read_lines" })
    const first = await executor.execute(baseExecution({ tool_id: "repo.read_lines", arguments: { path: "src/index.ts" }, tool_call_id: "call_read" }))
    const second = await executor.execute(baseExecution({ tool_id: "repo.read_lines", arguments: { path: "src/index.ts" }, tool_call_id: "call_read" }))
    expect(first.result_hash).toBe(second.result_hash)
    expect(JSON.stringify(first.result)).not.toBe(JSON.stringify(second.result))
  })

  test("executor propagates handler blockers instead of masking them as ready", async () => {
    const { executor } = executorFixture({ blockedTool: "memory.search" })
    const result = await executor.execute(baseExecution({ tool_id: "memory.search", arguments: { query: "x" }, tool_call_id: "call_blocked" }))
    expect(result).toMatchObject({ status: "blocked", handler_invoked: true, result: undefined })
    expect(result.blockers).toContain("handler denied bounded read")
    expect(result.warnings).toContain("handler warning")
    const message = toCommanderToolResultMessage(result)
    expect(message.tool_call_id).toBe("call_blocked")
    expect(message.content).toContain("\"status\":\"blocked\"")
    expect(message.content).toContain("handler denied bounded read")
  })

  test("memory search binding normalizes descriptor string labels before preview", async () => {
    const { executor, calls } = executorFixture()
    await expect(executor.execute(baseExecution({ tool_id: "memory.search", arguments: { query: "x", labels: "finding, failure" } }))).resolves.toMatchObject({ status: "ready" })
    expect(calls).toContain("memory.labels:finding|failure")
  })

  test("executor treats handler empty results as successful bounded execution", async () => {
    const { executor } = executorFixture({ emptyTool: "memory.search" })
    await expect(executor.execute(baseExecution({ tool_id: "memory.search", arguments: { query: "x" } }))).resolves.toMatchObject({ status: "ready", handler_invoked: true })
  })

  test("executor accepts already bounded domain results near descriptor caps", async () => {
    const { executor } = executorFixture({ boundedLargeTool: "repo.read_lines" })
    const result = await executor.execute(baseExecution({ tool_id: "repo.read_lines", arguments: { path: "src/index.ts" } }))
    expect(result.status).toBe("ready")
    expect(result.result).toBeDefined()
    expect(result.output_bytes).toBeLessThanOrEqual(result.max_output_bytes)
  })

  test("executor allows only fixed Git status and diff process-backed bindings", async () => {
    const { executor } = executorFixture()
    await expect(executor.execute(baseExecution({ tool_id: "repo.git_status", phase: "proposal_investigation", arguments: {} }))).resolves.toMatchObject({ status: "ready", external_process_invoked: true, process_policy: "fixed_git_read_only" })
    await expect(executor.execute(baseExecution({ tool_id: "repo.git_diff", phase: "proposal_investigation", arguments: {} }))).resolves.toMatchObject({ status: "ready", external_process_invoked: true, process_policy: "fixed_git_read_only" })
  })

  test("executor blocks pre-aborted signals, timeout, handler exceptions, and oversized results boundedly", async () => {
    const aborted = new AbortController()
    aborted.abort()
    let timeoutSignal: AbortSignal | undefined
    const { executor } = executorFixture({ timeout: (ms, signal) => {
      timeoutSignal = signal
      return new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}`)), 1)) as Promise<never>
    } })
    await expect(executor.execute(baseExecution({ tool_id: "memory.search", abort_signal: aborted.signal }))).resolves.toMatchObject({ status: "blocked", handler_invoked: false })
    await expect(executor.execute(baseExecution({ tool_id: "continuity.search" }))).resolves.toMatchObject({ status: "cancelled", handler_invoked: true })
    expect(timeoutSignal?.aborted).toBe(true)
    const failure = executorFixture({ failTool: "memory.search" }).executor
    await expect(failure.execute(baseExecution({ tool_id: "memory.search", arguments: { query: "x" } }))).resolves.toMatchObject({ status: "failed", handler_invoked: true })
    const oversized = executorFixture({ oversizedTool: "memory.search" }).executor
    const oversizedResult = await oversized.execute(baseExecution({ tool_id: "memory.search", arguments: { query: "x" } }))
    expect(oversizedResult).toMatchObject({ status: "failed", result: undefined })
    const oversizedMessage = toCommanderToolResultMessage({ ...oversizedResult, warnings: ["x".repeat(50_000)] })
    expect(Buffer.byteLength(oversizedMessage.content)).toBeLessThanOrEqual(12_000)
    expect(oversizedMessage.truncated).toBe(true)
    const staleLowBytes = executorFixture({ staleLowOutputBytesTool: "repo.read_lines" }).executor
    await expect(staleLowBytes.execute(baseExecution({ tool_id: "repo.read_lines", arguments: { path: "src/index.ts" } }))).resolves.toMatchObject({ status: "failed", result: undefined, output_bytes: 0 })
  })

  test("executor cancels tool timeout after a fast handler wins", async () => {
    let cancelled = 0
    const { executor } = executorFixture({
      timeout: () => ({
        promise: new Promise<never>(() => undefined),
        cancel: () => { cancelled += 1 },
      }),
    })
    await expect(executor.execute(baseExecution({ tool_id: "repo.read_lines", arguments: { path: "src/index.ts" } }))).resolves.toMatchObject({ status: "ready" })
    expect(cancelled).toBe(1)
  })

  test("RuntimeServer internal executor executes bound reads without appending events and rejects unbound implemented tools", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w1-"))
    await writeFile(join(projectDir, "safe.ts"), "export const safeValue = 1\n")
    await $`git init -q`.cwd(projectDir)
    await $`git config user.email test@example.com`.cwd(projectDir)
    await $`git config user.name Test`.cwd(projectDir)
    await $`git add safe.ts && git commit -q -m init`.cwd(projectDir)
    const server = new RuntimeServer({ projectDir })
    const before = await eventText(projectDir)
    await expect(server.executeCommanderBoundReadTool(baseExecution({ tool_id: "commander.tool_search", arguments: { query: "research memory" } }))).resolves.toMatchObject({ status: "ready" })
    await expect(server.executeCommanderBoundReadTool(baseExecution({ tool_id: "repo.read_lines", arguments: { path: "safe.ts", start_line: 1, end_line: 1 } }))).resolves.toMatchObject({ status: "ready" })
    await expect(server.executeCommanderBoundReadTool(baseExecution({ tool_id: "repo.git_diff", phase: "emergency_inspection" }))).resolves.toMatchObject({ status: "blocked", external_process_invoked: false })
    await expect(server.executeCommanderBoundReadTool(baseExecution({ tool_id: "repo.git_log", phase: "proposal_investigation" }))).resolves.toMatchObject({ status: "blocked" })
    await expect(server.executeCommanderBoundReadTool(baseExecution({ tool_id: "repo.git_status", phase: "proposal_investigation", arguments: {} }))).resolves.toMatchObject({ status: "ready", external_process_invoked: true })
    expect(await eventText(projectDir)).toBe(before)
  })
})

describe("Commander in-memory investigation controller", () => {
  test("RuntimeServer returns adapter_not_configured without public command dispatch", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w2a-no-adapter-"))
    const server = new RuntimeServer({ projectDir })
    const before = await eventText(projectDir)
    const result = await server.runCommanderInvestigationInMemory(baseInvestigation())
    expect(result).toMatchObject({ status: "blocked", stop_reason: "adapter_not_configured", in_memory_only: true, events_appended: false })
    expect(await eventText(projectDir)).toBe(before)
    await expect(server.command("runtime.run_commander_investigation", {})).rejects.toThrow()
  })

  test("model may finalize on first turn with bounded warning and one provider request", async () => {
    const adapter = new ScriptedCommanderModelStepAdapter([{ status: "final", text: "No tools needed for this bounded answer.", warnings: ["adapter degraded mode warning"] }])
    const server = new RuntimeServer({ projectDir: await mkdtemp(join(tmpdir(), "nxl-9w2a-final-")), commanderModelStepAdapter: adapter })
    const result = await server.runCommanderInvestigationInMemory(baseInvestigation({ investigation_id: "inv_final" }))
    expect(result.status).toBe("final")
    expect(result.stop_reason).toBe("model_final")
    expect(result.provider_request_count).toBe(1)
    expect(result.tool_call_count).toBe(0)
    expect(result.warnings.join(" ")).toContain("adapter degraded mode warning")
    expect(result.warnings.join(" ")).toContain("without acquired evidence")
    expect(result.loaded_tool_ids).toContain("commander.tool_search")
    expect(result.loaded_tool_ids).not.toContain("memory.search")
  })

  test("budget preflight blocks unsupported Commander models and preserves minimum discovery under pressure", async () => {
    const unsupported = new RuntimeServer({
      projectDir: await mkdtemp(join(tmpdir(), "nxl-9w2a-budget-block-")),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "should not run" }]),
    })
    await expect(unsupported.runCommanderInvestigationInMemory(baseInvestigation({ provider_kind: "opencode", model_id: "opencode-default" }))).resolves.toMatchObject({ status: "blocked", stop_reason: "context_budget_exhausted", provider_request_count: 0 })

    const constrainedAdapter = new ScriptedCommanderModelStepAdapter([{ status: "final", text: "bounded final", assert_request: (request) => {
      expect(request.tools.map((tool) => tool.tool_id)).toContain("commander.tool_search")
    } }])
    const constrained = new RuntimeServer({ projectDir: await mkdtemp(join(tmpdir(), "nxl-9w2a-min-discovery-")), commanderModelStepAdapter: constrainedAdapter })
    const result = await constrained.runCommanderInvestigationInMemory(baseInvestigation({ provider_kind: "local", model_id: "local-small" }))
    expect(result.status).toBe("final")
    expect(result.loaded_tool_ids).toContain("commander.tool_search")
  })

  test("wall-time budget uses real elapsed time and aborts slow model requests", async () => {
    const fixedClock = new Date("1970-01-01T00:00:00.000Z")
    const deterministic = new RuntimeServer({
      projectDir: await mkdtemp(join(tmpdir(), "nxl-9w2a-wall-clock-")),
      researchSynthesisNow: () => fixedClock,
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "fixed timestamps should not exhaust wall time" }]),
    })
    await expect(deterministic.runCommanderInvestigationInMemory(baseInvestigation({ max_wall_time_ms: 1000 }))).resolves.toMatchObject({ status: "final", stop_reason: "model_final", provider_request_count: 1 })

    const slow = new RuntimeServer({
      projectDir: await mkdtemp(join(tmpdir(), "nxl-9w2a-wall-timeout-")),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "too late", delay_ms: 250 }]),
    })
    await expect(slow.runCommanderInvestigationInMemory(baseInvestigation({ max_wall_time_ms: 100 }))).resolves.toMatchObject({ status: "budget_exhausted", stop_reason: "wall_time_exhausted", provider_request_count: 1 })

    const capabilityRegistry = new ModelCapabilityRegistry()
    const contextBudgetService = new ContextBudgetService({ registry: capabilityRegistry })
    const toolService = new CommanderToolService({ contextBudgetService })
    const adapter = new ScriptedCommanderModelStepAdapter([{ status: "final", text: "must not dispatch" }])
    const contextService = new CommanderInvestigationContextService()
    const expiresAfterContext = new CommanderInvestigationController({
      modelAdapter: adapter,
      toolExecutor: { execute: async () => { throw new Error("tool executor should not run") } },
      toolService,
      descriptors: COMMANDER_TOOL_REGISTRY,
      boundToolIds: COMMANDER_BOUND_TOOL_IDS,
      bootstrapService: { compile: async () => ({
        bootstrap_id: "bootstrap_context_deadline",
        phase: "proposal_investigation",
        objective_preview: "deadline",
        authority_kernel: "authority kernel",
        continuity_kind: "summary",
        readiness: "ready",
        current_project_summary: "summary",
        open_loops: [],
        source_refs: [],
        blockers: [],
        warnings: [],
        estimated_bytes: 10,
        estimated_tokens: 3,
        bootstrap_hash: "bootstrap_hash",
      }) },
      contextService: {
        build: (input) => {
          const started = performance.now()
          while (performance.now() - started < 20) {}
          return contextService.build(input)
        },
      },
      capabilityRegistry,
      contextBudgetService,
    })
    const expired = await expiresAfterContext.run(baseInvestigation({ max_wall_time_ms: 10 }))
    expect(expired).toMatchObject({ status: "budget_exhausted", stop_reason: "wall_time_exhausted", provider_request_count: 0 })
    expect(adapter.request_summaries).toHaveLength(0)
  })

  test("discovery search does not autoload and tool_get loads only eligible bound schemas", async () => {
    const adapter = new ScriptedCommanderModelStepAdapter([
      { status: "tool_call", tool_calls: [toolCall("c1", "commander.tool_search", { query: "research memory", limit: 20 })], assert_request: (request) => {
        expect(request.tools.map((tool) => tool.tool_id)).not.toContain("memory.search")
        const workingSet = request.messages.find((message) => message.role === "user" && message.content.includes("commander_investigation_working_set"))
        expect(workingSet?.content).toContain("json_fallback")
        expect(workingSet?.content).toContain("commander.tool_search")
        expect(workingSet?.content).toContain("response_contract")
      } },
      { status: "tool_call", tool_calls: [toolCall("c2", "commander.tool_get", { tool_id: "memory.search" })], assert_request: (request) => {
        expect(request.tools.map((tool) => tool.tool_id)).not.toContain("memory.search")
      } },
      { status: "tool_call", tool_calls: [toolCall("c3", "memory.search", { query: "research memory", limit: 3 })], assert_request: (request) => {
        expect(request.tools.map((tool) => tool.tool_id)).toContain("memory.search")
      } },
      { status: "final", text: "Finished after model-selected memory lookup." },
    ])
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w2a-discovery-"))
    const server = new RuntimeServer({ projectDir, commanderModelStepAdapter: adapter })
    const before = await eventText(projectDir)
    const result = await server.runCommanderInvestigationInMemory(baseInvestigation({ investigation_id: "inv_discovery" }))
    expect(result.status).toBe("final")
    expect(result.loaded_tool_ids).toContain("memory.search")
    expect(result.tool_search_call_count).toBe(1)
    expect(result.provider_request_count).toBe(4)
    expect(result.model_turn_count).toBe(4)
    expect(result.turn_summaries[0].tool_ids).toEqual(["commander.tool_search"])
    expect(result.turn_summaries[1].newly_loaded_tool_ids).toEqual(["memory.search"])
    expect(await eventText(projectDir)).toBe(before)
  })

  test("tool_get for an ineligible target does not replay descriptor schema", async () => {
    const adapter = new ScriptedCommanderModelStepAdapter([
      { status: "tool_call", tool_calls: [toolCall("c1", "commander.tool_get", { tool_id: "repo.git_log" })] },
      { status: "final", text: "chose another path", assert_request: (request) => {
        const toolResult = request.messages.find((message) => message.role === "user" && message.content.includes("previous_tool_exchange_summary"))
        expect(toolResult?.content).toContain("not eligible")
        expect(toolResult?.content).toContain("text_only_json_fallback")
        expect(toolResult?.content).not.toContain("input_schema")
        expect(toolResult?.content).not.toContain("Git commit history")
        expect(request.messages.some((message) => message.role === "tool")).toBe(false)
      } },
    ])
    const server = new RuntimeServer({ projectDir: await mkdtemp(join(tmpdir(), "nxl-9w2a-tool-get-block-")), commanderModelStepAdapter: adapter })
    const result = await server.runCommanderInvestigationInMemory(baseInvestigation({ investigation_id: "inv_tool_get_block" }))
    expect(result.status).toBe("final")
    expect(result.loaded_tool_ids).not.toContain("repo.git_log")
    expect(result.turn_summaries[0].tool_execution_statuses).toEqual(["blocked"])
    expect(result.turn_summaries[0].newly_loaded_tool_ids).toEqual([])
  })

  test("mid-mission investigations require session or launch identity before bootstrap or provider execution", async () => {
    const missing = new RuntimeServer({
      projectDir: await mkdtemp(join(tmpdir(), "nxl-9w2a-mid-missing-")),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "must not run" }]),
    })
    await expect(missing.runCommanderInvestigationInMemory(baseInvestigation({ phase: "mid_mission_supervision" }))).resolves.toMatchObject({ status: "blocked", stop_reason: "bootstrap_blocked", provider_request_count: 0 })
    await expect(missing.runCommanderInvestigationInMemory(baseInvestigation({ phase: "mid_mission_supervision", include_continuity: false }))).resolves.toMatchObject({ status: "blocked", stop_reason: "bootstrap_blocked", provider_request_count: 0 })

    const invalid = new RuntimeServer({
      projectDir: await mkdtemp(join(tmpdir(), "nxl-9w2a-mid-invalid-")),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "must not run" }]),
    })
    await expect(invalid.runCommanderInvestigationInMemory(baseInvestigation({ phase: "mid_mission_supervision", session_id: "missing_session" }))).resolves.toMatchObject({ status: "blocked", stop_reason: "bootstrap_blocked", provider_request_count: 0 })
    await expect(invalid.runCommanderInvestigationInMemory(baseInvestigation({ phase: "mid_mission_supervision", launch_id: "missing_launch" }))).resolves.toMatchObject({ status: "blocked", stop_reason: "bootstrap_blocked", provider_request_count: 0 })

    const launched = await investigationServerWithSession("nxl-9w2a-mid-mismatch-a")
    const other = await investigationServerWithSession("nxl-9w2a-mid-mismatch-b")
    await expect(launched.server.runCommanderInvestigationInMemory(baseInvestigation({ phase: "mid_mission_supervision", session_id: launched.sessionId, launch_id: other.launchId }))).resolves.toMatchObject({ status: "blocked", stop_reason: "bootstrap_blocked", provider_request_count: 0 })
  })

  test("tool execution receives the investigation wall-time deadline", async () => {
    const capabilityRegistry = new ModelCapabilityRegistry()
    const contextBudgetService = new ContextBudgetService({ registry: capabilityRegistry })
    const toolService = new CommanderToolService({ contextBudgetService })
    const descriptor = COMMANDER_TOOL_REGISTRY.find((tool) => tool.tool_id === "commander.tool_search")
    if (!descriptor) throw new Error("missing commander.tool_search descriptor")
    let sawAbort = false
    const controller = new CommanderInvestigationController({
      modelAdapter: new ScriptedCommanderModelStepAdapter([{ status: "tool_call", tool_calls: [toolCall("slow", "commander.tool_search", { query: "research" })] }]),
      toolExecutor: {
        execute: async (request) => {
          await new Promise<void>((resolve) => {
            request.abort_signal?.addEventListener("abort", () => {
              sawAbort = true
              resolve()
            }, { once: true })
            setTimeout(resolve, 500)
          })
          return {
            execution_id: request.execution_id,
            call_id: request.call_id,
            tool_call_id: request.tool_call_id,
            tool_id: request.tool_id,
            phase: request.phase,
            status: "cancelled",
            descriptor_version: descriptor.version,
            authority_id: descriptor.authority_id,
            trust_class: descriptor.trust_class,
            instruction_semantics: "none",
            evidence: [],
            output_bytes: 0,
            max_output_bytes: descriptor.max_output_bytes,
            truncated: false,
            handler_invoked: true,
            external_process_invoked: false,
            process_policy: "none",
            events_appended: false,
            provider_called: false,
            mcp_called: false,
            network_called: false,
            research_db_written: false,
            mission_mutated: false,
            proposal_mutated: false,
            opencode_action_performed: false,
            blockers: ["deadline reached"],
            warnings: [],
            duration_ms: 0,
            generated_at: "2026-07-19T00:00:00.000Z",
            result_hash: "slow_result",
          }
        },
      },
      toolService,
      descriptors: COMMANDER_TOOL_REGISTRY,
      boundToolIds: COMMANDER_BOUND_TOOL_IDS,
      bootstrapService: { compile: async () => ({
        bootstrap_id: "bootstrap_deadline",
        phase: "proposal_investigation",
        objective_preview: "deadline",
        authority_kernel: "authority kernel",
        continuity_kind: "summary",
        readiness: "ready",
        current_project_summary: "summary",
        open_loops: [],
        source_refs: [],
        blockers: [],
        warnings: [],
        estimated_bytes: 10,
        estimated_tokens: 3,
        bootstrap_hash: "bootstrap_hash",
      }) },
      contextService: new CommanderInvestigationContextService(),
      capabilityRegistry,
      contextBudgetService,
    })
    const result = await controller.run(baseInvestigation({ max_wall_time_ms: 100 }))
    expect(result).toMatchObject({ status: "budget_exhausted", stop_reason: "wall_time_exhausted", provider_request_count: 1 })
    expect(sawAbort).toBe(true)
  })

  test("unloaded and off-phase tool calls fail before execution", async () => {
    const unloaded = new RuntimeServer({
      projectDir: await mkdtemp(join(tmpdir(), "nxl-9w2a-unloaded-")),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "tool_call", tool_calls: [toolCall("c1", "memory.search", { query: "early" })] }]),
    })
    await expect(unloaded.runCommanderInvestigationInMemory(baseInvestigation())).resolves.toMatchObject({ status: "blocked", stop_reason: "unloaded_tool_call", tool_call_count: 0 })

    const offPhase = new RuntimeServer({
      projectDir: await mkdtemp(join(tmpdir(), "nxl-9w2a-offphase-")),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([
        { status: "tool_call", tool_calls: [toolCall("c1", "commander.tool_get", { tool_id: "repo.git_diff" })] },
        { status: "tool_call", tool_calls: [toolCall("c2", "repo.git_diff", { scope: "working_tree" })] },
      ]),
    })
    const result = await offPhase.runCommanderInvestigationInMemory(baseInvestigation({ phase: "emergency_inspection" }))
    expect(result.loaded_tool_ids).not.toContain("repo.git_diff")
    expect(result.status).toBe("blocked")
    expect(result.stop_reason).toBe("unloaded_tool_call")
  })

  test("multiple loaded tool calls execute sequentially and keep distinct call IDs", async () => {
    const adapter = new ScriptedCommanderModelStepAdapter([
      { status: "tool_call", tool_calls: [toolCall("a", "commander.tool_search", { query: "tools" }), toolCall("b", "commander.tool_profile", { phase: "proposal_investigation" })] },
      { status: "final", text: "done" },
    ])
    const server = new RuntimeServer({ projectDir: await mkdtemp(join(tmpdir(), "nxl-9w2a-multi-")), commanderModelStepAdapter: adapter })
    const result = await server.runCommanderInvestigationInMemory(baseInvestigation())
    expect(result.status).toBe("final")
    expect(result.tool_call_count).toBe(2)
    expect(result.turn_summaries[0].tool_call_ids).toEqual(["a", "b"])
    expect(result.turn_summaries[0].tool_ids).toEqual(["commander.tool_search", "commander.tool_profile"])
    expect(result.turn_summaries[0].tool_execution_statuses).toEqual(["ready", "ready"])
  })

  test("same-turn tool executions receive distinct binding call IDs", async () => {
    const capabilityRegistry = new ModelCapabilityRegistry()
    const contextBudgetService = new ContextBudgetService({ registry: capabilityRegistry })
    const toolService = new CommanderToolService({ contextBudgetService })
    const capturedCallIds: string[] = []
    const controller = new CommanderInvestigationController({
      modelAdapter: new ScriptedCommanderModelStepAdapter([
        { status: "tool_call", tool_calls: [toolCall("first", "commander.tool_search", { query: "tools" }), toolCall("second", "commander.tool_profile", { phase: "proposal_investigation" })] },
        { status: "final", text: "done" },
      ]),
      toolExecutor: {
        execute: async (request) => {
          capturedCallIds.push(request.call_id)
          const descriptor = COMMANDER_TOOL_REGISTRY.find((tool) => tool.tool_id === request.tool_id)
          if (!descriptor) throw new Error(`missing descriptor ${request.tool_id}`)
          return {
            execution_id: request.execution_id,
            call_id: request.call_id,
            tool_call_id: request.tool_call_id,
            tool_id: request.tool_id,
            phase: request.phase,
            status: "ready",
            descriptor_version: descriptor.version,
            authority_id: descriptor.authority_id,
            trust_class: descriptor.trust_class,
            instruction_semantics: "none",
            result: { status: "ready", tool_id: request.tool_id },
            evidence: [],
            output_bytes: 128,
            max_output_bytes: descriptor.max_output_bytes,
            truncated: false,
            handler_invoked: true,
            external_process_invoked: false,
            process_policy: "none",
            events_appended: false,
            provider_called: false,
            mcp_called: false,
            network_called: false,
            research_db_written: false,
            mission_mutated: false,
            proposal_mutated: false,
            opencode_action_performed: false,
            blockers: [],
            warnings: [],
            duration_ms: 0,
            generated_at: "2026-07-19T00:00:00.000Z",
            result_hash: `result_${request.tool_id}`,
          }
        },
      },
      toolService,
      descriptors: COMMANDER_TOOL_REGISTRY,
      boundToolIds: COMMANDER_BOUND_TOOL_IDS,
      bootstrapService: { compile: async () => ({
        bootstrap_id: "bootstrap_distinct_call_ids",
        phase: "proposal_investigation",
        objective_preview: "distinct call ids",
        authority_kernel: "authority kernel",
        continuity_kind: "summary",
        readiness: "ready",
        current_project_summary: "summary",
        open_loops: [],
        source_refs: [],
        blockers: [],
        warnings: [],
        estimated_bytes: 10,
        estimated_tokens: 3,
        bootstrap_hash: "bootstrap_hash",
      }) },
      contextService: new CommanderInvestigationContextService(),
      capabilityRegistry,
      contextBudgetService,
    })
    const result = await controller.run(baseInvestigation())
    expect(result.status).toBe("final")
    expect(capturedCallIds).toHaveLength(2)
    expect(capturedCallIds[0]).not.toBe(capturedCallIds[1])
    expect(capturedCallIds[0]).toContain("_call_1_1_first")
    expect(capturedCallIds[1]).toContain("_call_1_2_second")
  })

  test("same-turn tool-result caps deduct bytes already reserved in the turn", async () => {
    const capabilityRegistry = new ModelCapabilityRegistry()
    const contextBudgetService = new ContextBudgetService({ registry: capabilityRegistry })
    const toolService = new CommanderToolService({ contextBudgetService })
    const descriptor = COMMANDER_TOOL_REGISTRY.find((tool) => tool.tool_id === "commander.tool_search")
    if (!descriptor) throw new Error("missing commander.tool_search descriptor")
    let secondTurnToolMessages: Array<{ content: string; truncated: boolean }> = []
    const controller = new CommanderInvestigationController({
      modelAdapter: new ScriptedCommanderModelStepAdapter([
        { status: "tool_call", tool_calls: [toolCall("search_one", "commander.tool_search", { query: "alpha" }), toolCall("search_two", "commander.tool_search", { query: "beta" })] },
        {
          status: "final",
          text: "done",
          assert_request: (request) => {
            secondTurnToolMessages = request.messages
              .flatMap((message) => {
                if (message.role === "tool") return [{ content: message.content, truncated: message.truncated }]
                if (message.role !== "user" || !message.content.includes("previous_tool_exchange_summary")) return []
                const payload = JSON.parse(message.content) as { tool_results?: Array<{ content?: string; content_preview?: string; truncated: boolean }> }
                return payload.tool_results?.map((result) => ({ content: result.content ?? result.content_preview ?? "", truncated: result.truncated })) ?? []
              })
          },
        },
      ]),
      toolExecutor: {
        execute: async (request) => ({
          execution_id: request.execution_id,
          call_id: request.call_id,
          tool_call_id: request.tool_call_id,
          tool_id: request.tool_id,
          phase: request.phase,
          status: "ready",
          descriptor_version: descriptor.version,
          authority_id: descriptor.authority_id,
          trust_class: descriptor.trust_class,
          instruction_semantics: "none",
          result: { status: "ready", payload: "x".repeat(1_620) },
          evidence: [],
          output_bytes: 1_720,
          max_output_bytes: descriptor.max_output_bytes,
          truncated: false,
          handler_invoked: true,
          external_process_invoked: false,
          process_policy: "none",
          events_appended: false,
          provider_called: false,
          mcp_called: false,
          network_called: false,
          research_db_written: false,
          mission_mutated: false,
          proposal_mutated: false,
          opencode_action_performed: false,
          blockers: [],
          warnings: [],
          duration_ms: 0,
          generated_at: "2026-07-19T00:00:00.000Z",
          result_hash: `result_${request.tool_call_id}`,
        }),
      },
      toolService,
      descriptors: COMMANDER_TOOL_REGISTRY,
      boundToolIds: COMMANDER_BOUND_TOOL_IDS,
      bootstrapService: { compile: async () => ({
        bootstrap_id: "bootstrap_same_turn_caps",
        phase: "proposal_investigation",
        objective_preview: "same-turn caps",
        authority_kernel: "authority kernel",
        continuity_kind: "summary",
        readiness: "ready",
        current_project_summary: "summary",
        open_loops: [],
        source_refs: [],
        blockers: [],
        warnings: [],
        estimated_bytes: 10,
        estimated_tokens: 3,
        bootstrap_hash: "bootstrap_hash",
      }) },
      contextService: new CommanderInvestigationContextService(),
      capabilityRegistry,
      contextBudgetService,
    })
    const result = await controller.run(baseInvestigation({ max_context_bytes: 5_500, max_tool_search_calls: 4, max_consecutive_no_progress_turns: 3 }))
    expect(result.status).toBe("final")
    expect(result.provider_request_count).toBe(2)
    expect(result.tool_call_count).toBe(2)
    expect(secondTurnToolMessages).toHaveLength(2)
  })

  test("controller executes transient raw arguments while keeping transcript arguments redacted", async () => {
    const secretQuery = "sk-controllerLiteral123456"
    const capabilityRegistry = new ModelCapabilityRegistry()
    const contextBudgetService = new ContextBudgetService({ registry: capabilityRegistry })
    const toolService = new CommanderToolService({ contextBudgetService })
    const call = toolCall("secret", "commander.tool_search", { query: "[REDACTED]" })
    Object.defineProperty(call, "execution_arguments", {
      value: { query: secretQuery },
      enumerable: false,
      configurable: false,
      writable: false,
    })
    let executedQuery: unknown
    const descriptor = COMMANDER_TOOL_REGISTRY.find((tool) => tool.tool_id === "commander.tool_search")
    if (!descriptor) throw new Error("missing commander.tool_search descriptor")
    const controller = new CommanderInvestigationController({
      modelAdapter: new ScriptedCommanderModelStepAdapter([
        { status: "tool_call", tool_calls: [call] },
        { status: "final", text: "done" },
      ]),
      toolExecutor: {
        execute: async (request) => {
          executedQuery = request.arguments.query
          return {
            execution_id: request.execution_id,
            call_id: request.call_id,
            tool_call_id: request.tool_call_id,
            tool_id: request.tool_id,
            phase: request.phase,
            status: "ready",
            descriptor_version: descriptor.version,
            authority_id: descriptor.authority_id,
            trust_class: descriptor.trust_class,
            instruction_semantics: "none",
            result: { status: "ready" },
            evidence: [],
            output_bytes: 128,
            max_output_bytes: descriptor.max_output_bytes,
            truncated: false,
            handler_invoked: true,
            external_process_invoked: false,
            process_policy: "none",
            events_appended: false,
            provider_called: false,
            mcp_called: false,
            network_called: false,
            research_db_written: false,
            mission_mutated: false,
            proposal_mutated: false,
            opencode_action_performed: false,
            blockers: [],
            warnings: [],
            duration_ms: 0,
            generated_at: "2026-07-19T00:00:00.000Z",
            result_hash: "result_secret_search",
          }
        },
      },
      toolService,
      descriptors: COMMANDER_TOOL_REGISTRY,
      boundToolIds: COMMANDER_BOUND_TOOL_IDS,
      bootstrapService: { compile: async () => ({
        bootstrap_id: "bootstrap_raw_args",
        phase: "proposal_investigation",
        objective_preview: "raw args",
        authority_kernel: "authority kernel",
        continuity_kind: "summary",
        readiness: "ready",
        current_project_summary: "summary",
        open_loops: [],
        source_refs: [],
        blockers: [],
        warnings: [],
        estimated_bytes: 10,
        estimated_tokens: 3,
        bootstrap_hash: "bootstrap_hash",
      }) },
      contextService: new CommanderInvestigationContextService(),
      capabilityRegistry,
      contextBudgetService,
    })
    const result = await controller.run(baseInvestigation())
    expect(result.status).toBe("final")
    expect(executedQuery).toBe(secretQuery)
    expect(JSON.stringify(result)).not.toContain(secretQuery)
  })

  test("budgets stop search caps context caps duplicate IDs and repeated no-progress", async () => {
    const duplicate = new RuntimeServer({
      projectDir: await mkdtemp(join(tmpdir(), "nxl-9w2a-duplicate-id-")),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "tool_call", tool_calls: [toolCall("same", "commander.tool_search", { query: "a" }), toolCall("same", "commander.tool_profile", { phase: "proposal_investigation" })] }]),
    })
    await expect(duplicate.runCommanderInvestigationInMemory(baseInvestigation())).resolves.toMatchObject({ status: "blocked", stop_reason: "duplicate_tool_call_id" })

    const searchCap = new RuntimeServer({
      projectDir: await mkdtemp(join(tmpdir(), "nxl-9w2a-search-cap-")),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([
        { status: "tool_call", tool_calls: [toolCall("s1", "commander.tool_search", { query: "a" })] },
        { status: "tool_call", tool_calls: [toolCall("s2", "commander.tool_search", { query: "b" })] },
      ]),
    })
    const searchCapResult = await searchCap.runCommanderInvestigationInMemory(baseInvestigation({ max_tool_search_calls: 1 }))
    expect(searchCapResult).toMatchObject({ status: "budget_exhausted", stop_reason: "max_tool_search_calls", tool_search_call_count: 1, tool_call_count: 1 })

    const contextCap = new RuntimeServer({
      projectDir: await mkdtemp(join(tmpdir(), "nxl-9w2a-context-cap-")),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "will not be called" }]),
    })
    await expect(contextCap.runCommanderInvestigationInMemory(baseInvestigation({ max_context_bytes: 1000 }))).resolves.toMatchObject({ status: "budget_exhausted", stop_reason: "context_budget_exhausted", provider_request_count: 0 })

    const repeated = new RuntimeServer({
      projectDir: await mkdtemp(join(tmpdir(), "nxl-9w2a-repeat-")),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([
        { status: "tool_call", tool_calls: [toolCall("r1", "commander.tool_search", { query: "same" })] },
        { status: "tool_call", tool_calls: [toolCall("r2", "commander.tool_search", { query: "same" })] },
        { status: "tool_call", tool_calls: [toolCall("r3", "commander.tool_search", { query: "same" })] },
      ]),
    })
    await expect(repeated.runCommanderInvestigationInMemory(baseInvestigation({ max_consecutive_no_progress_turns: 3 }))).resolves.toMatchObject({ status: "no_progress", stop_reason: "repeated_identical_call", tool_call_count: 3 })

    const omittedTurns = new RuntimeServer({
      projectDir: await mkdtemp(join(tmpdir(), "nxl-9w2a-omitted-turns-")),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([
        { status: "tool_call", tool_calls: [toolCall("o1", "commander.tool_get", { tool_id: "memory.search" })] },
        { status: "tool_call", tool_calls: [toolCall("o2", "commander.tool_get", { tool_id: "continuity.search" })] },
        { status: "final", text: "done" },
      ]),
    })
    const omitted = await omittedTurns.runCommanderInvestigationInMemory(baseInvestigation({ max_turn_summaries: 1, max_consecutive_no_progress_turns: 3 }))
    expect(omitted.status).toBe("final")
    expect(omitted.provider_request_count).toBe(3)
    expect(omitted.model_turn_count).toBe(3)
    expect(omitted.turn_summaries).toHaveLength(1)
    expect(omitted.omitted_turn_count).toBe(2)
  })

  test("controller rejects impossible model request counts before final or tool execution", async () => {
    for (const status of ["final", "tool_call", "refusal", "malformed", "failed"] as const) {
      const result = await new RuntimeServer({
        projectDir: await mkdtemp(join(tmpdir(), `nxl-9w2a-zero-${status}-`)),
        commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{
          status,
          text: status === "final" ? "invalid zero request" : undefined,
          error: status === "malformed" || status === "failed" ? "invalid zero request" : undefined,
          tool_calls: status === "tool_call" ? [toolCall("zero", "commander.tool_search", { query: "zero" })] : undefined,
          request_count: 0,
        }]),
      }).runCommanderInvestigationInMemory(baseInvestigation())
      expect(result).toMatchObject({ status: "failed", stop_reason: "controller_error", provider_request_count: 0, tool_call_count: 0 })
      expect(result.blockers.join(" ")).toContain("zero-request")
    }

    for (const request_count of [-1, 1.5, 2]) {
      const result = await new RuntimeServer({
        projectDir: await mkdtemp(join(tmpdir(), `nxl-9w2a-bad-count-${String(request_count).replace(".", "-")}-`)),
        commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "bad count", request_count }]),
      }).runCommanderInvestigationInMemory(baseInvestigation())
      expect(result).toMatchObject({ status: "failed", stop_reason: "controller_error", provider_request_count: 0, tool_call_count: 0 })
    }

    await expect(new RuntimeServer({
      projectDir: await mkdtemp(join(tmpdir(), "nxl-9w2a-cancel-zero-")),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "cancelled", request_count: 0, error: "cancelled before request" }]),
    }).runCommanderInvestigationInMemory(baseInvestigation())).resolves.toMatchObject({ status: "cancelled", stop_reason: "caller_cancelled", provider_request_count: 0 })
  })

  test("new evidence is reported when the evidence cap evicts older cards", async () => {
    const descriptor = COMMANDER_TOOL_REGISTRY.find((tool) => tool.tool_id === "commander.tool_search")
    if (!descriptor) throw new Error("missing commander.tool_search descriptor")
    let evidenceIndex = 0
    const capabilityRegistry = new ModelCapabilityRegistry()
    const contextBudgetService = new ContextBudgetService({ registry: capabilityRegistry })
    const toolService = new CommanderToolService({ contextBudgetService })
    const controller = new CommanderInvestigationController({
      modelAdapter: new ScriptedCommanderModelStepAdapter([
        { status: "tool_call", tool_calls: [toolCall("ev1", "commander.tool_search", { query: "first" })] },
        { status: "tool_call", tool_calls: [toolCall("ev2", "commander.tool_search", { query: "second" })] },
        { status: "final", text: "done" },
      ]),
      toolExecutor: {
        execute: async (request) => {
          evidenceIndex += 1
          const evidenceId = `ev_window_${evidenceIndex}`
          return {
            execution_id: request.execution_id,
            call_id: request.call_id,
            tool_call_id: request.tool_call_id,
            tool_id: request.tool_id,
            phase: request.phase,
            status: "ready",
            descriptor_version: descriptor.version,
            authority_id: descriptor.authority_id,
            trust_class: descriptor.trust_class,
            instruction_semantics: "none",
            result: { status: "ready", evidence_id: evidenceId },
            evidence: [evidenceCard(evidenceId)],
            output_bytes: 256,
            max_output_bytes: descriptor.max_output_bytes,
            truncated: false,
            handler_invoked: true,
            external_process_invoked: false,
            process_policy: "none",
            events_appended: false,
            provider_called: false,
            mcp_called: false,
            network_called: false,
            research_db_written: false,
            mission_mutated: false,
            proposal_mutated: false,
            opencode_action_performed: false,
            blockers: [],
            warnings: [],
            duration_ms: 0,
            generated_at: "2026-07-19T00:00:00.000Z",
            result_hash: `result_${evidenceId}`,
          }
        },
      },
      toolService,
      descriptors: COMMANDER_TOOL_REGISTRY,
      boundToolIds: COMMANDER_BOUND_TOOL_IDS,
      bootstrapService: { compile: async () => ({
        bootstrap_id: "bootstrap_evidence_window",
        phase: "proposal_investigation",
        objective_preview: "evidence cap",
        authority_kernel: "authority kernel",
        continuity_kind: "summary",
        readiness: "ready",
        current_project_summary: "summary",
        open_loops: [],
        source_refs: [],
        blockers: [],
        warnings: [],
        estimated_bytes: 10,
        estimated_tokens: 3,
        bootstrap_hash: "bootstrap_hash",
      }) },
      contextService: new CommanderInvestigationContextService(),
      capabilityRegistry,
      contextBudgetService,
    })
    const result = await controller.run(baseInvestigation({ max_evidence_cards: 1, max_consecutive_no_progress_turns: 3 }))
    expect(result.status).toBe("final")
    expect(result.evidence.map((item) => item.evidence_id)).toEqual(["ev_window_2"])
    expect(result.omitted_evidence_count).toBe(1)
    expect(result.turn_summaries[0].new_evidence_ids).toEqual(["ev_window_1"])
    expect(result.turn_summaries[1].new_evidence_ids).toEqual(["ev_window_2"])
    expect(result.turn_summaries[1].progress_made).toBe(true)
  })

  test("context compaction warnings propagate into final investigation results", async () => {
    const descriptor = COMMANDER_TOOL_REGISTRY.find((tool) => tool.tool_id === "commander.tool_search")
    if (!descriptor) throw new Error("missing commander.tool_search descriptor")
    const capabilityRegistry = new ModelCapabilityRegistry()
    const contextBudgetService = new ContextBudgetService({ registry: capabilityRegistry })
    const toolService = new CommanderToolService({ contextBudgetService })
    const controller = new CommanderInvestigationController({
      modelAdapter: new ScriptedCommanderModelStepAdapter([
        { status: "tool_call", tool_calls: [toolCall("compact", "commander.tool_search", { query: "compact" })] },
        { status: "final", text: "done" },
      ]),
      toolExecutor: {
        execute: async (request) => ({
          execution_id: request.execution_id,
          call_id: request.call_id,
          tool_call_id: request.tool_call_id,
          tool_id: request.tool_id,
          phase: request.phase,
          status: "ready",
          descriptor_version: descriptor.version,
          authority_id: descriptor.authority_id,
          trust_class: descriptor.trust_class,
          instruction_semantics: "none",
          result: { status: "ready" },
          evidence: [{ ...evidenceCard("compact_evidence"), summary_preview: "x".repeat(3_000) }],
          output_bytes: 128,
          max_output_bytes: descriptor.max_output_bytes,
          truncated: false,
          handler_invoked: true,
          external_process_invoked: false,
          process_policy: "none",
          events_appended: false,
          provider_called: false,
          mcp_called: false,
          network_called: false,
          research_db_written: false,
          mission_mutated: false,
          proposal_mutated: false,
          opencode_action_performed: false,
          blockers: [],
          warnings: [],
          duration_ms: 0,
          generated_at: "2026-07-19T00:00:00.000Z",
          result_hash: "result_compact_evidence",
        }),
      },
      toolService,
      descriptors: COMMANDER_TOOL_REGISTRY,
      boundToolIds: COMMANDER_BOUND_TOOL_IDS,
      bootstrapService: { compile: async () => ({
        bootstrap_id: "bootstrap_compaction_warning",
        phase: "proposal_investigation",
        objective_preview: "compaction warnings",
        authority_kernel: "authority kernel",
        continuity_kind: "summary",
        readiness: "ready",
        current_project_summary: "summary",
        open_loops: [],
        source_refs: [],
        blockers: [],
        warnings: [],
        estimated_bytes: 10,
        estimated_tokens: 3,
        bootstrap_hash: "bootstrap_hash",
      }) },
      contextService: new CommanderInvestigationContextService(),
      capabilityRegistry,
      contextBudgetService,
    })
    const result = await controller.run(baseInvestigation({ max_context_bytes: 5_000, max_tool_search_calls: 2, max_consecutive_no_progress_turns: 3 }))
    expect(result.status).toBe("final")
    expect(result.warnings.join(" ")).toContain("oldest evidence card omitted during deterministic context compaction")
  })

  test("caller abort and human-control stop halt before model or remaining tool execution", async () => {
    const abortedSignal = new AbortController()
    abortedSignal.abort()
    const aborted = new RuntimeServer({
      projectDir: await mkdtemp(join(tmpdir(), "nxl-9w2a-abort-")),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "no" }]),
    })
    await expect(aborted.runCommanderInvestigationInMemory(baseInvestigation({ abort_signal: abortedSignal.signal }))).resolves.toMatchObject({ status: "cancelled", stop_reason: "caller_cancelled", provider_request_count: 0 })

    const inFlightAbort = new AbortController()
    const abortIgnoringAdapter: CommanderModelStepAdapter = {
      adapter_id: "abort_ignoring",
      adapter_version: "test",
      supports_streaming: true,
      supports_native_tools: true,
      supports_json_fallback: true,
      supports_structured_output: true,
      supports_abort_signal: true,
      supports_usage: true,
      supports_openai_compatible: true,
      executeOneStep: async (request) => {
        inFlightAbort.abort()
        return {
          request_id: request.request_id,
          provider_id: request.provider_id,
          adapter_id: "abort_ignoring",
          status: "final",
          assistant_message: { role: "assistant", content: [{ type: "text", text: "ignored abort" }] },
          text: "ignored abort",
          tool_calls: [],
          finish_reason: "stop",
          usage: { provider_reported: false },
          provider_metadata: {},
          request_count: 1,
          raw_provider_payload_included: false,
          duration_ms: 0,
          warnings: [],
          result_hash: "ignored_abort_result",
        }
      },
      executeOneStreamedStep: async function* () {},
    }
    const abortDuringModel = new RuntimeServer({
      projectDir: await mkdtemp(join(tmpdir(), "nxl-9w2a-abort-during-model-")),
      commanderModelStepAdapter: abortIgnoringAdapter,
    })
    await expect(abortDuringModel.runCommanderInvestigationInMemory(baseInvestigation({ abort_signal: inFlightAbort.signal }))).resolves.toMatchObject({ status: "cancelled", stop_reason: "caller_cancelled", provider_request_count: 1 })

    const humanPause = new RuntimeServer({
      projectDir: await mkdtemp(join(tmpdir(), "nxl-9w2a-human-")),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "no" }]),
      commanderInvestigationControlGate: { check: () => ({ action: "needs_human_review", source_kind: "human_control", projected_state: "correction_pending", summary_preview: "pending correction", checked_at: "2026-07-19T00:00:00.000Z", warnings: [] }) },
    })
    await expect(humanPause.runCommanderInvestigationInMemory(baseInvestigation({ session_id: "session_1" }))).resolves.toMatchObject({ status: "needs_human_review", stop_reason: "human_correction", provider_request_count: 0 })
  })

  test("ordinary RuntimeServer reads durable human controls and halts without appending investigation events", async () => {
    for (const item of [
      { kind: "stop_request", payload: { reason: "operator stop" }, stop_reason: "human_stop" },
      { kind: "pause_request", payload: { reason: "operator pause" }, stop_reason: "human_pause" },
      { kind: "correction", payload: { correction: "inspect safer evidence" }, stop_reason: "human_correction" },
    ]) {
      const { server, sessionId, launchId, projectDir } = await investigationServerWithSession(`nxl-9w2a-human-${item.kind}-`)
      await expect(server.command("runtime.record_opencode_human_control", { sessionId, launchId, kind: item.kind, ...item.payload })).resolves.toMatchObject({ status: "recorded" })
      const before = await eventText(projectDir)
      const result = await server.runCommanderInvestigationInMemory(baseInvestigation({ session_id: sessionId }))
      expect(result).toMatchObject({ status: "needs_human_review", stop_reason: item.stop_reason, provider_request_count: 0 })
      expect(await eventText(projectDir)).toBe(before)
    }
  })

  test("ordinary RuntimeServer does not let later notes mask unresolved stop controls", async () => {
    const { server, sessionId, launchId, projectDir } = await investigationServerWithSession("nxl-9w2a-human-note-after-stop-")
    await expect(server.command("runtime.record_opencode_human_control", { sessionId, launchId, kind: "stop_request", reason: "operator stop" })).resolves.toMatchObject({ status: "recorded" })
    await expect(server.command("runtime.record_opencode_human_control", { sessionId, launchId, kind: "note", note: "operator note after stop" })).resolves.toMatchObject({ status: "recorded" })
    const before = await eventText(projectDir)
    const result = await server.runCommanderInvestigationInMemory(baseInvestigation({ session_id: sessionId }))
    expect(result).toMatchObject({ status: "needs_human_review", stop_reason: "human_stop", provider_request_count: 0 })
    expect(await eventText(projectDir)).toBe(before)
  })

  test("ordinary RuntimeServer applies session-level human stops to launch-bound investigations", async () => {
    const { server, sessionId, launchId, projectDir } = await investigationServerWithSession("nxl-9w2a-human-session-stop-")
    await expect(server.command("runtime.record_opencode_human_control", { sessionId, kind: "stop_request", reason: "session-level operator stop" })).resolves.toMatchObject({ status: "recorded" })
    const before = await eventText(projectDir)
    const result = await server.runCommanderInvestigationInMemory(baseInvestigation({ session_id: sessionId, launch_id: launchId }))
    expect(result).toMatchObject({ status: "needs_human_review", stop_reason: "human_stop", provider_request_count: 0 })
    expect(await eventText(projectDir)).toBe(before)
  })

  test("ordinary RuntimeServer resolves launch-only investigations to session-level human stops", async () => {
    const { server, sessionId, launchId, projectDir } = await investigationServerWithSession("nxl-9w2a-human-launch-only-stop-")
    await expect(server.command("runtime.record_opencode_human_control", { sessionId, kind: "stop_request", reason: "session-level operator stop" })).resolves.toMatchObject({ status: "recorded" })
    const before = await eventText(projectDir)
    const result = await server.runCommanderInvestigationInMemory(baseInvestigation({ launch_id: launchId }))
    expect(result).toMatchObject({ status: "needs_human_review", stop_reason: "human_stop", provider_request_count: 0 })
    expect(await eventText(projectDir)).toBe(before)
  })

  test("ordinary RuntimeServer permits resume and note controls with warnings", async () => {
    for (const item of [
      { kind: "resume_request", payload: { reason: "operator resumes" }, state: "resume_requested" },
      { kind: "note", payload: { note: "operator note" }, state: "noted" },
    ]) {
      const { server, sessionId, launchId, projectDir } = await investigationServerWithSession(`nxl-9w2a-human-${item.kind}-`)
      await expect(server.command("runtime.record_opencode_human_control", { sessionId, launchId, kind: item.kind, ...item.payload })).resolves.toMatchObject({ status: "recorded" })
      const before = await eventText(projectDir)
      const result = await server.runCommanderInvestigationInMemory(baseInvestigation({ session_id: sessionId }))
      expect(result).toMatchObject({ status: "final", stop_reason: "model_final", provider_request_count: 1 })
      expect(result.warnings.join(" ")).toContain(item.state)
      expect(await eventText(projectDir)).toBe(before)
    }
  })

  test("real AI SDK loopback controller sequence uses model-selected search get memory final path", async () => {
    const mock = startInvestigationMockServer()
    const adapter = new AiSdkCommanderModelStepAdapter({ provider_name: "fixture", base_url: `${mock.url}/v1`, api_key: "secret-api-key", fetch: loopbackFetch(mock.url) })
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w2a-loopback-"))
    const server = new RuntimeServer({ projectDir, commanderModelStepAdapter: adapter })
    const before = await eventText(projectDir)
    const result = await server.runCommanderInvestigationInMemory(baseInvestigation({ investigation_id: "inv_loopback", tool_protocol: "native" }))
    expect(result.status).toBe("final")
    expect(result.provider_request_count).toBe(4)
    expect(result.model_turn_count).toBe(4)
    expect(result.tool_search_call_count).toBe(1)
    expect(result.loaded_tool_ids).toContain("memory.search")
    expect(mock.requests).toHaveLength(4)
    expect(JSON.stringify(mock.requests[0].body)).not.toContain("memory__search")
    expect(JSON.stringify(mock.requests[2].body)).toContain("memory__search")
    for (const request of mock.requests) {
      const tools = (request.body as { tools?: Array<{ function?: Record<string, unknown> }> }).tools ?? []
      for (const tool of tools) expect(tool.function).not.toHaveProperty("execute")
    }
    expect(await eventText(projectDir)).toBe(before)
  })
})

function modelTool(toolId: string) {
  const descriptor = COMMANDER_TOOL_REGISTRY.find((tool) => tool.tool_id === toolId)
  if (!descriptor) throw new Error(`missing descriptor ${toolId}`)
  return commanderToolSchemaFromDescriptor(descriptor)
}

function connector(id: string, baseUrl: string, overrides: { allowLocalHttp?: boolean; allowedHosts?: string[]; maxResponseBytes?: number } = {}) {
  return {
    connector_id: id,
    title: "OpenAI-compatible connector",
    base_url: baseUrl,
    allowed_hosts: overrides.allowedHosts ?? [new URL(baseUrl).hostname],
    allowed_methods: ["POST" as const],
    credential_refs: [{ name: "model-key", source: "env" as const, env_name: "NXL_TEST_MODEL_KEY", inject_as: "header" as const, target_name: "Authorization", prefix: "Bearer " }],
    timeout_ms: 5000,
    max_response_bytes: overrides.maxResponseBytes ?? 65_536,
    created_at: "1970-01-01T00:00:00.000Z",
    updated_at: "1970-01-01T00:00:00.000Z",
    allow_local_http: overrides.allowLocalHttp === true ? true : undefined,
  }
}

function connectorConfig(overrides: Partial<ReturnType<typeof validateCommanderConnectorModelTransportConfig>> = {}) {
  return validateCommanderConnectorModelTransportConfig({
    transport_kind: "openai_compatible_connector",
    provider_id: "fixture_provider",
    connector_id: "openai-test",
    model_id: "fixture-model",
    timeout_ms: 5000,
    max_request_bytes: 65_536,
    max_response_bytes: 65_536,
    ...overrides,
  })
}

function connectorBackedAdapter(projectDir: string, transport: FakeExternalApiTransport, requestId = "api_connector_1") {
  const registry = new ExternalApiConnectorRegistry([connector("openai-test", "https://api.example.test/v1")])
  const requestService = new ExternalApiRequestService({
    registry,
    transport,
    eventStore: new EventStore(join(projectDir, ".nxl", "events.jsonl")),
    env: { NXL_TEST_MODEL_KEY: "real-provider-key" },
    requestId: () => requestId,
    now: () => new Date("2026-07-21T00:00:00.000Z"),
  })
  return new ConnectorBackedCommanderModelStepAdapter({ config: connectorConfig(), registry, requestService })
}

function chatCompletionText(text: string) {
  return JSON.stringify({
    id: "chatcmpl_bridge",
    object: "chat.completion",
    created: 1784160000,
    model: "fixture-model",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: text } }],
  })
}

function baseRequest(input: { baseUrl: string; content?: string; overrides?: Partial<CommanderModelStepRequest> }) {
  const adapter = new AiSdkCommanderModelStepAdapter({ provider_name: "fixture", base_url: `${input.baseUrl}/v1`, api_key: "secret-api-key", fetch: loopbackFetch(input.baseUrl) })
  const request: CommanderModelStepRequest = {
    request_id: "req_test",
    provider_id: "fixture_provider",
    provider_kind: "openai_compatible",
    model_id: "fixture-model",
    messages: [{ role: "user", content: input.content ?? "plain" }],
    tools: ["commander.tool_search", "memory.search", "continuity.search", "repo.search_text", "repo.read_lines", "repo.git_status", "repo.git_diff", "repo.some_tool"].filter((id) => id !== "repo.some_tool").map(modelTool),
    tool_protocol: "native",
    tool_choice: "auto",
    requested_at: "2026-07-19T00:00:00.000Z",
    metadata: {},
    ...input.overrides,
  }
  return { adapter, request }
}

function loopbackFetch(origin: string): typeof fetch {
  return (async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    if (url.origin !== origin) throw new Error(`external network blocked: ${url.origin}`)
    return fetch(input, init)
  }) as typeof fetch
}

function startMockServer(kind: "text" | "tool" | "secret_tool" | "multi_tool" | "malformed_tool" | "empty_tool_finish" | "json_fallback" | "json_fallback_final" | "stream_tool" | "stream_json_fallback_tool" | "stream_refusal" | "http_429" | "slow" | "structured_invalid" | "refusal" | "no_usage" | "cache_usage") {
  const requests: Array<{ body: unknown; headers: Record<string, string> }> = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const text = await request.text()
      const body = text ? JSON.parse(text) : {}
      requests.push({ body, headers: Object.fromEntries([...request.headers].map(([key, value]) => [key, /authorization/i.test(key) ? "[REDACTED]" : value])) })
      if (kind === "slow") await new Promise((resolve) => setTimeout(resolve, 50))
      if ((body as { stream?: boolean }).stream) return new Response(streamBody(kind), { headers: { "content-type": "text/event-stream" } })
      if (kind === "http_429") return Response.json({ error: { message: "rate limited" } }, { status: 429 })
      return Response.json(chatBody(kind))
    },
  })
  servers.push(server)
  return { url: `http://${server.hostname}:${server.port}`, requests }
}

function startInvestigationMockServer() {
  const requests: Array<{ body: unknown; headers: Record<string, string> }> = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const text = await request.text()
      const body = text ? JSON.parse(text) : {}
      requests.push({ body, headers: Object.fromEntries([...request.headers].map(([key, value]) => [key, /authorization/i.test(key) ? "[REDACTED]" : value])) })
      const toolNames = JSON.stringify(body)
      const index = requests.length
      if (index === 1) {
        expect(toolNames).toContain("commander__tool_search")
        expect(toolNames).not.toContain("memory__search")
        return Response.json(openAiToolBody("call_search", "commander__tool_search", { query: "research memory", limit: 10 }))
      }
      if (index === 2) {
        expect(toolNames).not.toContain("memory__search")
        return Response.json(openAiToolBody("call_get", "commander__tool_get", { tool_id: "memory.search" }))
      }
      if (index === 3) {
        expect(toolNames).toContain("memory__search")
        return Response.json(openAiToolBody("call_memory", "memory__search", { query: "research memory", limit: 3 }))
      }
      return Response.json({ id: "chatcmpl_final", object: "chat.completion", created: 1784160000, model: "fixture-model", usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Final after dynamic reads." } }] })
    },
  })
  servers.push(server)
  return { url: `http://${server.hostname}:${server.port}`, requests }
}

function openAiToolBody(id: string, name: string, args: Record<string, unknown>) {
  return {
    id: `chatcmpl_${id}`,
    object: "chat.completion",
    created: 1784160000,
    model: "fixture-model",
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }],
  }
}

function chatBody(kind: string) {
  const base = { id: `chatcmpl_${kind}`, object: "chat.completion", created: 1784160000, model: "fixture-model", usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } }
  if (kind === "tool" || kind === "multi_tool" || kind === "malformed_tool") {
    const tool_calls = [{ id: "call_memory", type: "function", function: { name: "memory__search", arguments: kind === "malformed_tool" ? JSON.stringify({ query: 7 }) : JSON.stringify({ query: "research memory", limit: 3 }) } }]
    if (kind === "multi_tool") tool_calls.push({ id: "call_git", type: "function", function: { name: "repo__git_status", arguments: "{}" } })
    return { ...base, choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: kind === "multi_tool" ? "checking tools" : null, tool_calls } }] }
  }
  if (kind === "secret_tool") {
    return { ...base, choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "call_secret", type: "function", function: { name: "repo__search_text", arguments: JSON.stringify({ query: "sk-investigateLiteral123456", path: "src", limit: 5 }) } }] } }] }
  }
  if (kind === "empty_tool_finish") return { ...base, choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [] } }] }
  if (kind === "json_fallback") return { ...base, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ type: "tool_call", tool_id: "memory.search", arguments: { query: "research memory", limit: 3 } }) } }] }
  if (kind === "json_fallback_final") return { ...base, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ type: "final", final: { summary: "done" } }) } }] }
  if (kind === "structured_invalid") return { ...base, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "{}" } }] }
  if (kind === "refusal") return { ...base, choices: [{ index: 0, finish_reason: "content_filter", message: { role: "assistant", content: "" } }] }
  if (kind === "no_usage") return { id: "chatcmpl_no_usage", object: "chat.completion", created: 1784160000, model: "fixture-model", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "plain fixture" } }] }
  if (kind === "cache_usage") return { ...base, usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, prompt_tokens_details: { cached_tokens: 5, cache_write_tokens: 2 } }, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "plain fixture" } }] }
  return { ...base, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "plain fixture" } }] }
}

function streamBody(kind: string) {
  const encoder = new TextEncoder()
  const chunks = kind === "stream_tool"
    ? [
        { choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_memory", type: "function", function: { name: "memory__search", arguments: "" } }] }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "{\"query\":\"research" } }] }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: " memory\",\"limit\":3}" } }] }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } },
      ]
    : kind === "stream_json_fallback_tool"
      ? [
        { choices: [{ index: 0, delta: { role: "assistant", content: "{\"type\":\"tool_call\"," }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { content: "\"tool_id\":\"memory.search\"," }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { content: "\"arguments\":{\"query\":\"research memory\"}}" }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } },
      ]
      : kind === "stream_refusal"
      ? [
        { choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: "content_filter" }], usage: { prompt_tokens: 11, completion_tokens: 0, total_tokens: 11 } },
      ]
      : [
        { choices: [{ index: 0, delta: { role: "assistant", content: "plain " }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { content: "fixture" }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } },
      ]
  return new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: "chunk", object: "chat.completion.chunk", created: 1, model: "fixture-model", ...chunk })}\n\n`)); controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close() } })
}

function testBindingRegistry(options: { failTool?: string; oversizedTool?: string; blockedTool?: string; emptyTool?: string; boundedLargeTool?: string; staleLowOutputBytesTool?: string; volatileReadLinesTool?: string; calls?: string[] } = {}) {
  const calls = options.calls ?? []
  return createPatchedRegistry(options, calls)
}

function createPatchedRegistry(options: { failTool?: string; oversizedTool?: string; blockedTool?: string; emptyTool?: string; boundedLargeTool?: string; staleLowOutputBytesTool?: string; volatileReadLinesTool?: string }, calls: string[]) {
  let volatileCounter = 0
  const registry = createCommanderToolBindingRegistry({
    commanderToolService: new CommanderToolService({ contextBudgetService: new ContextBudgetService({ registry: new ModelCapabilityRegistry() }) }),
    commandAuthorityService: new CommandAuthorityService(),
    researchMemoryService: { preview: (args: { labels?: unknown }) => {
      if (options.failTool === "memory.search") throw new Error("boom secret-api-key")
      if (options.blockedTool === "memory.search") return { status: "blocked", blockers: ["handler denied bounded read"], warnings: ["handler warning"], evidence: [] }
      if (options.emptyTool === "memory.search") return { status: "empty", blockers: [], warnings: ["empty warning"], evidence: [] }
      if (Array.isArray(args.labels)) calls.push(`memory.labels:${args.labels.join("|")}`)
      return options.oversizedTool === "memory.search" ? { value: "x".repeat(100_000) } : { tool_id: "memory.search", evidence: [] }
    } } as unknown as ResearchMemoryService,
    operationalMemorySearchService: { search: async () => new Promise((resolve) => setTimeout(() => resolve({ tool_id: "continuity.search" }), 5)) } as unknown as CommanderOperationalMemorySearchService,
    repoReadService: {
      searchText: async () => ({ tool_id: "repo.search_text", result: { matches: [] }, git_process_invoked: false, evidence: [] }),
      readLines: async () => {
        calls.push("repo.read_lines")
        if (options.boundedLargeTool === "repo.read_lines") {
          return { tool_id: "repo.read_lines", status: "ready", result: { lines: [{ line_number: 1, text: "x".repeat(17_000) }] }, output_bytes: 17_900, max_output_bytes: 18_000, git_process_invoked: false, evidence: [], warnings: ["domain result trimmed near cap"] }
        }
        if (options.staleLowOutputBytesTool === "repo.read_lines") {
          return { tool_id: "repo.read_lines", status: "ready", result: { lines: [{ line_number: 1, text: "x".repeat(100_000) }] }, output_bytes: 1, max_output_bytes: 18_000, git_process_invoked: false, evidence: [], warnings: ["stale low byte count"] }
        }
        if (options.volatileReadLinesTool === "repo.read_lines") {
          volatileCounter += 1
          return { tool_id: "repo.read_lines", result: { generated_at: `2026-07-19T00:00:0${volatileCounter}.000Z`, lines: [{ line_number: 1, text: "x" }] }, git_process_invoked: false, evidence: [{ evidence_id: "ev_read", observed_at: `2026-07-19T00:00:1${volatileCounter}.000Z` }] }
        }
        return { tool_id: "repo.read_lines", result: { lines: [{ line_number: 1, text: "x" }] }, git_process_invoked: false, evidence: [] }
      },
      gitStatus: async () => ({ tool_id: "repo.git_status", result: { is_git_repository: true }, git_process_invoked: true, evidence: [] }),
      gitDiff: async () => ({ tool_id: "repo.git_diff", result: { files: [] }, git_process_invoked: true, evidence: [] }),
    } as unknown as CommanderRepoReadService,
  }, COMMANDER_TOOL_REGISTRY)
  return registry
}

function executorFixture(options: { failTool?: string; oversizedTool?: string; blockedTool?: string; emptyTool?: string; boundedLargeTool?: string; staleLowOutputBytesTool?: string; volatileReadLinesTool?: string; timeout?: (ms: number, signal?: AbortSignal) => Promise<never> | { promise: Promise<never>; cancel: () => void } } = {}) {
  const calls: string[] = []
  const registry = createPatchedRegistry(options, calls)
  return { calls, executor: new CommanderToolExecutor({ descriptors: COMMANDER_TOOL_REGISTRY, authorityRecords: COMMAND_AUTHORITY_REGISTRY, bindingRegistry: registry, timeout: options.timeout }) }
}

function baseExecution(overrides: Partial<Parameters<CommanderToolExecutor["execute"]>[0]> & { modelSaidValid?: boolean } = {}): Parameters<CommanderToolExecutor["execute"]>[0] {
  return {
    execution_id: "exec_test",
    call_id: "call_test",
    tool_call_id: "tool_call_test",
    tool_id: "memory.search",
    phase: "proposal_investigation",
    arguments: { query: "research memory" },
    requested_by: "test",
    ...overrides,
  }
}

function baseInvestigation(overrides: Partial<Parameters<RuntimeServer["runCommanderInvestigationInMemory"]>[0]> = {}): Parameters<RuntimeServer["runCommanderInvestigationInMemory"]>[0] {
  return {
    phase: "proposal_investigation",
    objective: "Investigate bounded Commander reads",
    requested_by: "test",
    provider_id: "fixture",
    provider_kind: "unknown",
    model_id: "cloud-long-context",
    ...overrides,
  }
}

async function investigationServerWithSession(prefix: string): Promise<{ server: RuntimeServer; projectDir: string; sessionId: string; launchId: string }> {
  const projectDir = await mkdtemp(join(tmpdir(), prefix))
  await writeApprovedSpec(projectDir)
  const server = new RuntimeServer({
    projectDir,
    adapter: new FakeOpenCodeAdapter(),
    openCodeAdapterConfig: { kind: "process", command: "/bin/echo", args: ["opencode"] },
    commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "continued after neutral control" }]),
  })
  servers.push({ stop: () => server.shutdown() })
  await server.start()
  const session = await server.command("runtime.create_opencode_session_plan", { objective: "session-bound investigation control" }) as { session_id: string }
  const launch = await launchSessionForInvestigation(server, session.session_id)
  return { server, projectDir, sessionId: session.session_id, launchId: launch.launch_id }
}

async function writeApprovedSpec(projectDir: string): Promise<void> {
  await mkdir(join(projectDir, ".nxl", "spec"), { recursive: true })
  await writeFile(join(projectDir, ".nxl", "spec", "current.json"), JSON.stringify({
    spec_id: "spec_commander_investigation_test",
    version: 1,
    status: "approved",
    objective: "Test Commander investigation human-control gate",
    success_metrics: ["bounded investigation"],
    approved_by: "test",
    approved_at: "2026-07-19T00:00:00.000Z",
  }))
}

async function launchSessionForInvestigation(server: RuntimeServer, sessionId: string): Promise<{ launch_id: string }> {
  const pack = await server.command("runtime.write_opencode_session_instruction_pack", { sessionId, providerKind: "local", modelId: "local-medium" }) as { pack_id: string }
  const readiness = await server.command("runtime.preview_opencode_launch_readiness", { sessionId, packId: pack.pack_id, providerKind: "local", modelId: "local-medium" }) as { status: string; readiness_hash: string }
  expect(readiness.status).toBe("ready")
  const launch = await server.command("runtime.launch_opencode_session", { sessionId, packId: pack.pack_id, readinessHash: readiness.readiness_hash, providerKind: "local", modelId: "local-medium" }) as { launch_id: string; status: string }
  expect(launch.status).toMatch(/^(launched|launch_started)$/)
  return launch
}

function toolCall(toolCallId: string, toolId: string, args: Record<string, unknown>) {
  const schema = modelTool(toolId)
  const validation = validateCommanderToolArguments(schema.input_schema, args)
  return {
    type: "tool_call" as const,
    tool_call_id: toolCallId,
    tool_id: toolId,
    arguments: validation.arguments,
    raw_arguments: JSON.stringify(args),
    arguments_valid: validation.valid,
    validation_errors: validation.errors,
    call_hash: `hash_${toolCallId}_${toolId}`,
  }
}

function evidenceCard(evidenceId: string) {
  return {
    evidence_id: evidenceId,
    tool_id: "commander.tool_search",
    source_kind: "operational_memory" as const,
    source_id: evidenceId,
    title: `Evidence ${evidenceId}`,
    summary_preview: `bounded evidence ${evidenceId}`,
    trust_class: "runtime_authoritative" as const,
    instruction_semantics: "none" as const,
    source_refs: [],
    content_included: false,
    content_truncated: false,
    observed_at: "2026-07-19T00:00:00.000Z",
    warnings: [],
    evidence_hash: `hash_${evidenceId}`,
  }
}

async function eventText(projectDir: string): Promise<string> {
  try {
    return await readFile(join(projectDir, ".nxl", "events.jsonl"), "utf8")
  } catch {
    return ""
  }
}
