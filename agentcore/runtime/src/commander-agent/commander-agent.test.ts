import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { $ } from "bun"
import { NoSuchToolError } from "ai"
import { RuntimeServer } from "../server"
import { createRuntimeServerFromLaunchConfig, readRuntimeServerLaunchOptionsFromEnv } from "../launch-config"
import { EventStore } from "../events/event-store"
import { ExternalApiConnectorRegistry } from "../external-api/api-connector-registry"
import { ExternalApiRequestService } from "../external-api/api-request-service"
import { FakeExternalApiTransport, FetchExternalApiTransport, type ExternalApiTransport } from "../external-api/api-transport"
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
  CommanderInvestigationJournalService,
  CommanderToolExecutor,
  ScriptedCommanderModelStepAdapter,
  buildProviderToolMap,
  commanderInvestigationModelCapability,
  commanderToolSchemaFromDescriptor,
  connectorChatCompletionsUrl,
  createExternalApiConnectorFetch,
  createCommanderToolBindingRegistry,
  parseJsonFallback,
  providerJsonSchema,
  providerToolNameFor,
  stableHash,
  toCommanderToolResultMessage,
  validateCommanderInvestigationProviderConfig,
  validateCommanderConnectorModelTransportConfig,
  validateCommanderToolArguments,
  type CommanderInvestigationCheckpointSnapshot,
  type CommanderInvestigationStartedSnapshot,
  type CommanderModelStepAdapter,
  type CommanderModelStepRequest,
  type CommanderModelStepResult,
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
    const noPublicActivationGrep = await $`bash -lc "rg -n 'run_commander_investigation|commander-investigation|provider_tool_loop_enabled: true' src/server.ts src/launch-config.ts ../tui/src || true"`.cwd(process.cwd()).text()
    expect(noPublicActivationGrep.trim()).toBe("")
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
    await expect(bridgeFetch(expected, { method: "POST", headers: { "Content-Type": "application/json", "x-auth-token": "real-secret" }, body: validBody })).rejects.toThrow("credential header")
    await expect(bridgeFetch(expected, { method: "POST", headers: { "Content-Type": "application/json", "x-access-token": "real-secret" }, body: validBody })).rejects.toThrow("credential header")
    await expect(bridgeFetch(expected, { method: "POST", headers: { "Content-Type": "application/json", "openai-api-key": "real-secret" }, body: validBody })).rejects.toThrow("credential header")
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

  test("connector-backed adapter rejects transport timeouts above connector policy before AI SDK fetch", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w2b1-timeout-preflight-"))
    const transport = new FakeExternalApiTransport([{ status_code: 200, body: JSON.stringify(chatBody("tool")) }])
    const registry = new ExternalApiConnectorRegistry([connector("openai-test", "https://api.example.test/v1", { timeoutMs: 5 })])
    const requestService = new ExternalApiRequestService({
      registry,
      transport,
      eventStore: new EventStore(join(projectDir, ".nxl", "events.jsonl")),
      env: { NXL_TEST_MODEL_KEY: "real-provider-key" },
      requestId: () => "api_timeout_preflight",
      now: () => new Date("2026-07-21T00:00:00.000Z"),
    })
    const adapter = new ConnectorBackedCommanderModelStepAdapter({ config: connectorConfig({ timeout_ms: 120_000 }), registry, requestService })
    const request = baseRequest({ baseUrl: "http://127.0.0.1:1" }).request
    const result = await adapter.executeOneStep({ ...request, provider_id: "fixture_provider", model_id: "fixture-model" })
    expect(result).toMatchObject({ status: "failed", request_count: 0 })
    expect(result.error ?? "").toContain("timeout_ms exceeds connector limit")
    expect(transport.requests).toHaveLength(0)
    expect(await eventText(projectDir)).toBe("")
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
    const transport = new FakeExternalApiTransport([{ status_code: 200, body: "ok" }, { status_code: 200, body: "ok-2" }, { status_code: 200, body: "ok-3" }])
    const registry = new ExternalApiConnectorRegistry([connector("openai-test", "https://api.example.test/v1", { maxResponseBytes: 20, timeoutMs: 20 })])
    const observed: string[] = []
    const requestService = new ExternalApiRequestService({
      registry,
      transport,
      eventStore: new EventStore(join(projectDir, ".nxl", "events.jsonl")),
      env: { NXL_TEST_MODEL_KEY: "real-provider-key" },
      requestId: () => `api_internal_${observed.length + 1}`,
      now: () => new Date("2026-07-21T00:00:00.000Z"),
    })
    await expect(requestService.executeForInternalUse({
      connector_id: "openai-test",
      method: "POST",
      path: "/v1/chat/completions",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      requested_by: "tester",
    }, { timeout_ms: 21, on_audit_persisted: (record) => observed.push(record.event_kind) })).rejects.toThrow("timeout_ms")
    expect(transport.requests).toHaveLength(0)
    await expect(requestService.executeForInternalUse({
      connector_id: "openai-test",
      method: "POST",
      path: "/v1/chat/completions",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      requested_by: "tester",
    }, { timeout_ms: 20, on_audit_persisted: (record) => observed.push(record.event_kind) })).resolves.toMatchObject({ ok: true })
    await expect(requestService.executeForInternalUse({
      connector_id: "openai-test",
      method: "POST",
      path: "/v1/chat/completions",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      requested_by: "tester",
    }, { timeout_ms: 5, on_audit_persisted: (record) => observed.push(record.event_kind) })).resolves.toMatchObject({ ok: true })
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
    expect(transport.requests[0].timeout_ms).toBe(20)
    expect(transport.requests[1].timeout_ms).toBe(5)
    expect(transport.requests[2].max_response_bytes).toBe(5)
    expect(transport.requests[2].fail_on_response_overflow).toBe(true)
    expect(observed).toEqual(["external_api_request_failed", "external_api_request_executed", "external_api_request_executed", "external_api_request_executed"])
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
    expect(transport.requests).toHaveLength(3)
    const events = await eventText(projectDir)
    expect(events).toContain("external_api_request_executed")
    expect(events).toContain("external_api_request_failed")
    expect((events.match(/external_api_request_failed/g) ?? []).length).toBe(3)
    expect(events).not.toContain("real-provider-key")
  })

  test("external API internal requests honor timeout and abort during service-level host validation", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w2b1-service-host-abort-"))
    let resolverStarted = false
    const transport = new FakeExternalApiTransport([{ status_code: 200, body: "ok" }])
    const requestService = new ExternalApiRequestService({
      registry: new ExternalApiConnectorRegistry([connector("openai-test", "https://api.example.test/v1", { timeoutMs: 5 })]),
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
    await expect(requestService.executeForInternalUse({
      connector_id: "openai-test",
      method: "POST",
      path: "/v1/chat/completions",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      requested_by: "tester",
    })).rejects.toThrow("timed out")
    expect(resolverStarted).toBe(true)
    expect(transport.requests).toHaveLength(0)
    expect(await eventText(projectDir)).toContain("external API request timed out")

    resolverStarted = false
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
    expect(events).toContain("external API request timed out")
    expect(events).not.toContain("real-provider-key")
  })

  test("external API operation deadline keeps timeout reason through transport DNS validation", async () => {
    const originalFetch = globalThis.fetch
    let fetchCalls = 0
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      void input
      void init
      fetchCalls += 1
      return Promise.reject(new Error("fetch should not run after DNS stop"))
    }) as typeof fetch
    try {
      for (const mode of ["timeout", "cancel"] as const) {
        const projectDir = await mkdtemp(join(tmpdir(), `nxl-9w2b1-cross-layer-${mode}-`))
        let serviceResolverCalls = 0
        let transportResolverCalls = 0
        const transport = new FetchExternalApiTransport({
          resolveHostAddresses: async () => {
            transportResolverCalls += 1
            return new Promise(() => undefined)
          },
        })
        const requestService = new ExternalApiRequestService({
          registry: new ExternalApiConnectorRegistry([connector("openai-test", "https://api.example.test/v1", { timeoutMs: mode === "timeout" ? 20 : 100 })]),
          transport,
          eventStore: new EventStore(join(projectDir, ".nxl", "events.jsonl")),
          env: { NXL_TEST_MODEL_KEY: "real-provider-key" },
          resolveHostAddresses: async () => {
            serviceResolverCalls += 1
            await new Promise((resolve) => setTimeout(resolve, 1))
            return [{ address: "93.184.216.34" }]
          },
          requestId: () => `api_cross_layer_${mode}`,
          now: () => new Date("2026-07-21T00:00:00.000Z"),
        })
        const controller = new AbortController()
        const promise = requestService.executeForInternalUse({
          connector_id: "openai-test",
          method: "POST",
          path: "/v1/chat/completions",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: `secret prompt ${mode}`, api_key: CONNECTOR_MANAGED_API_KEY_SENTINEL }),
          requested_by: "tester",
        }, { abort_signal: mode === "cancel" ? controller.signal : undefined, omit_response_preview_from_audit: true })
        if (mode === "cancel") {
          await waitFor(() => transportResolverCalls === 1)
          controller.abort()
        }
        await expect(promise).rejects.toThrow(mode === "timeout" ? "timed out" : "cancelled")
        expect(serviceResolverCalls).toBe(1)
        expect(transportResolverCalls).toBe(1)
        expect(fetchCalls).toBe(0)
        const events = await eventText(projectDir)
        expect((events.match(/external_api_request_failed/g) ?? [])).toHaveLength(1)
        expect(events).toContain(mode === "timeout" ? "external API request timed out" : "external API request cancelled")
        expect(events).not.toContain(mode === "timeout" ? "external API request cancelled" : "external API request timed out")
        expect(events).not.toContain("secret prompt")
        expect(events).not.toContain("real-provider-key")
        expect(events).not.toContain(CONNECTOR_MANAGED_API_KEY_SENTINEL)
      }
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("fetch external API transport bounds DNS validation with timeout and parent cancellation", async () => {
    const originalFetch = globalThis.fetch
    let fetchCalled = false
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      void input
      void init
      fetchCalled = true
      return Promise.reject(new Error("fetch should not run after DNS timeout"))
    }) as typeof fetch
    try {
      const timeoutTransport = new FetchExternalApiTransport({
        resolveHostAddresses: async () => new Promise(() => undefined),
      })
      await expect(timeoutTransport.request({
        method: "POST",
        url: "https://api.example.test/v1/chat/completions",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        timeout_ms: 5,
        max_response_bytes: 100,
      })).rejects.toThrow("timed out")
      expect(fetchCalled).toBe(false)

      let resolverStarted = false
      const cancelTransport = new FetchExternalApiTransport({
        resolveHostAddresses: async () => {
          resolverStarted = true
          return new Promise(() => undefined)
        },
      })
      const controller = new AbortController()
      const promise = cancelTransport.request({
        method: "POST",
        url: "https://api.example.test/v1/chat/completions",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        timeout_ms: 50,
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
      expect(result).toMatchObject({ status: "failed", stop_reason: "controller_error", provider_request_count: request_count === 2 ? 2 : 0, tool_call_count: 0 })
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

  test("Commander provider env config requires explicit opt-in and remains credential-free", () => {
    expect(readRuntimeServerLaunchOptionsFromEnv({}).commanderInvestigationProviderConfig).toBeUndefined()
    expect(readRuntimeServerLaunchOptionsFromEnv({ NXL_COMMANDER_INVESTIGATION_PROVIDER_ENABLED: "0" }).commanderInvestigationProviderConfig).toBeUndefined()
    expect(() => readRuntimeServerLaunchOptionsFromEnv({ NXL_COMMANDER_INVESTIGATION_PROVIDER_ID: "provider" })).toThrow("ENABLED")
    expect(() => readRuntimeServerLaunchOptionsFromEnv({ NXL_COMMANDER_INVESTIGATION_PROVIDER_ENABLED: "0", NXL_COMMANDER_INVESTIGATION_PROVIDER_ID: "provider" })).toThrow("cannot be combined")
    expect(() => readRuntimeServerLaunchOptionsFromEnv({ ...providerEnv(), NXL_COMMANDER_INVESTIGATION_ENABLED_PHASES: "proposal_investigation,,general_read" })).toThrow("blank")
    expect(() => readRuntimeServerLaunchOptionsFromEnv({ ...providerEnv(), NXL_COMMANDER_INVESTIGATION_SUPPORTS_TOOLS: "maybe" })).toThrow("must be 1, 0, or unknown")
    const options = readRuntimeServerLaunchOptionsFromEnv(providerEnv())
    expect(options.commanderInvestigationProviderConfig).toMatchObject({
      provider_id: "fixture_provider",
      provider_kind: "openai",
      connector_id: "openai-test",
      model_id: "fixture-model",
      enabled_phases: ["general_read", "proposal_investigation"],
      supports_tools: true,
    })
    expect(JSON.stringify(options.commanderInvestigationProviderConfig)).not.toContain("real-provider-key")
    expect(() => validateCommanderInvestigationProviderConfig({ ...options.commanderInvestigationProviderConfig, api_key: "secret" })).toThrow("unknown")
    expect(() => validateCommanderInvestigationProviderConfig({ ...options.commanderInvestigationProviderConfig, provider_id: "https://api.example.test" })).toThrow("URLs")
    expect(() => validateCommanderInvestigationProviderConfig({ ...options.commanderInvestigationProviderConfig, provider_kind: "sk-provider-secret" })).toThrow("credential-looking")
    expect(() => readRuntimeServerLaunchOptionsFromEnv({ ...providerEnv(), NXL_COMMANDER_INVESTIGATION_PROVIDER_KIND: "Bearer provider-secret" })).toThrow("credential-looking")
    expect(() => new RuntimeServer({ projectDir: "/tmp/nxl-conflict", commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "x" }]), commanderInvestigationProviderConfig: options.commanderInvestigationProviderConfig })).toThrow("cannot be combined")
    expect(() => readRuntimeServerLaunchOptionsFromEnv(providerEnv(), { commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "x" }]) })).toThrow("cannot be combined")
  })

  test("configured Commander capability is registered and selected for budgets and protocol", async () => {
    const config = validateCommanderInvestigationProviderConfig(providerConfig({ max_context_bytes: 20_000, max_context_tokens: 8000, max_output_tokens: 512, supports_tools: false }))
    const capability = commanderInvestigationModelCapability(config)
    expect(capability).toMatchObject({ provider_id: "fixture_provider", provider_kind: "openai", model_id: "fixture-model", role_support: ["commander"], max_context_bytes: 20_000, max_context_tokens: 8000, max_output_tokens: 512, supports_tools: false, supports_streaming: false, supports_mcp: false })
    const registry = new ModelCapabilityRegistry({ runtimeCapabilities: [capability] })
    expect(registry.get({ provider_kind: "openai", model_id: "fixture-model" }).capability_id).toBe(capability.capability_id)
    const sharedProviderConfig = validateCommanderInvestigationProviderConfig(providerConfig({ provider_kind: "minimax" }))
    const sharedCommanderCapability = commanderInvestigationModelCapability(sharedProviderConfig)
    const sharedRegistry = new ModelCapabilityRegistry({
      runtimeCapabilities: [sharedCommanderCapability],
      reasoningProviderConfig: { kind: "minimax", provider_id: "minimax-reasoning", connector_id: "minimax-connector", model: "fixture-model", max_input_bytes: 32_768, max_output_bytes: 4096, enabled_for: ["research_synthesis"] },
    })
    expect(sharedRegistry.get({ provider_kind: "minimax", model_id: "fixture-model", role: "commander" }).capability_id).toBe(sharedCommanderCapability.capability_id)
    expect(sharedRegistry.get({ provider_kind: "minimax", model_id: "fixture-model", role: "research" }).role_support).toContain("research")
    const researchBudget = await new ContextBudgetService({ registry: sharedRegistry }).preview({ purpose: "research_retrieval", role: "research", provider_kind: "minimax", model_id: "fixture-model" })
    expect(researchBudget.blockers).not.toContain("selected model capability does not support requested role")
    const captured: CommanderModelStepRequest[] = []
    const server = new RuntimeServer({
      projectDir: await mkdtemp(join(tmpdir(), "nxl-9w2b2-cap-")),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "fallback final", assert_request: (request) => captured.push(request) }]),
    })
    ;(server as unknown as { modelCapabilityRegistry: ModelCapabilityRegistry }).modelCapabilityRegistry = registry
    const result = await server.runCommanderInvestigationInMemory(baseInvestigation({ provider_kind: "openai", model_id: "fixture-model", provider_id: "fixture_provider" }))
    expect(result.status).toBe("final")
    expect(result.tool_protocol).toBe("json_fallback")
    expect(result.budget.max_context_bytes).toBeLessThanOrEqual(20_000)
    expect(captured[0].max_output_tokens).toBe(512)

    const expandedConfig = validateCommanderInvestigationProviderConfig(providerConfig({ max_output_tokens: 4096 }))
    const expandedRegistry = new ModelCapabilityRegistry({ runtimeCapabilities: [commanderInvestigationModelCapability(expandedConfig)] })
    const expandedCaptured: CommanderModelStepRequest[] = []
    const expandedServer = new RuntimeServer({
      projectDir: await mkdtemp(join(tmpdir(), "nxl-9w2b2-cap-expanded-")),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "expanded final", assert_request: (request) => expandedCaptured.push(request) }]),
    })
    ;(expandedServer as unknown as { modelCapabilityRegistry: ModelCapabilityRegistry }).modelCapabilityRegistry = expandedRegistry
    await expect(expandedServer.runCommanderInvestigationInMemory(baseInvestigation())).resolves.toMatchObject({ status: "final" })
    expect(expandedCaptured[0].max_output_tokens).toBe(1024)
  })

  test("configured provider readiness requires start, active mode, run lock, connector credentials, and exact identity", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w2b2-ready-"))
    await writeApprovedSpec(projectDir)
    const server = createRuntimeServerFromLaunchConfig({ projectDir, env: providerLaunchEnv("http://localhost:1/v1") })
    const beforeStart = server.previewCommanderInvestigationProviderReadiness({ phase: "proposal_investigation", provider_id: "fixture_provider", provider_kind: "openai", model_id: "fixture-model" })
    expect(beforeStart.configuration_ready).toBe(true)
    expect(beforeStart.execution_ready).toBe(false)
    expect(beforeStart.blockers.join(" ")).toContain("RuntimeServer is started")
    expect(beforeStart.network_called).toBe(false)
    expect(beforeStart.events_appended).toBe(false)
    await server.start()
    servers.push({ stop: () => server.shutdown() })
    const ready = server.previewCommanderInvestigationProviderReadiness({ phase: "proposal_investigation", provider_id: "fixture_provider", provider_kind: "openai", model_id: "fixture-model" })
    expect(ready.status).toBe("ready")
    expect(ready.execution_ready).toBe(true)
    expect(ready.would_call_network).toBe(true)
    expect(ready.would_append_external_api_audit).toBe(true)
    expect(JSON.stringify(ready)).not.toContain("NXL_TEST_MODEL_KEY")
    expect(JSON.stringify(ready)).not.toContain("real-provider-key")
    await expect(server.start()).rejects.toThrow("runtime lock already held")
    const afterDuplicateStart = server.previewCommanderInvestigationProviderReadiness({ phase: "proposal_investigation", provider_id: "fixture_provider", provider_kind: "openai", model_id: "fixture-model" })
    expect(afterDuplicateStart.runtime_lifecycle_state).toBe("ready")
    expect(afterDuplicateStart.execution_ready).toBe(true)
    const wrongPhase = server.previewCommanderInvestigationProviderReadiness({ phase: "emergency_inspection", provider_id: "fixture_provider", provider_kind: "openai", model_id: "fixture-model" })
    expect(wrongPhase.execution_ready).toBe(false)
    expect(wrongPhase.blockers.join(" ")).toContain("requested phase is enabled")
    const statusMode = createRuntimeServerFromLaunchConfig({ projectDir: await mkdtemp(join(tmpdir(), "nxl-9w2b2-status-")), mode: "status", env: providerLaunchEnv("http://localhost:1/v1") })
    await statusMode.start()
    servers.push({ stop: () => statusMode.shutdown() })
    expect(statusMode.previewCommanderInvestigationProviderReadiness({ phase: "proposal_investigation", provider_id: "fixture_provider", provider_kind: "openai", model_id: "fixture-model" }).execution_ready).toBe(false)
  })

  test("configured provider readiness stays blocked until RuntimeServer startup is fully ready", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w2b2-start-race-"))
    await writeApprovedSpec(projectDir)
    const adapter = new DelayedStartOpenCodeAdapter()
    const server = configuredProviderRuntimeServer(projectDir, { adapter, transport: new FakeExternalApiTransport([{ status_code: 200, body: chatCompletionText("should not run during startup") }]) })
    const start = server.start()
    await waitFor(() => adapter.startRequested)

    const readiness = server.previewCommanderInvestigationProviderReadiness({ phase: "proposal_investigation", provider_id: "fixture_provider", provider_kind: "openai", model_id: "fixture-model" })
    expect(readiness.runtime_started).toBe(true)
    expect(readiness.runtime_lifecycle_state).toBe("starting")
    expect(readiness.execution_ready).toBe(false)
    expect(readiness.blockers.join(" ")).toContain("RuntimeServer lifecycle is ready")

    const blocked = await server.runCommanderInvestigationInMemory(baseInvestigation({ provider_id: "fixture_provider", provider_kind: "openai", model_id: "fixture-model", tool_protocol: "native" }))
    expect(blocked).toMatchObject({ status: "blocked", stop_reason: "provider_preflight_blocked", provider_request_count: 0, external_api_audit_events_appended: 0, events_appended: false })
    expect(await eventText(projectDir)).toBe("")

    adapter.releaseStart()
    await start
    servers.push({ stop: () => server.shutdown() })
    const ready = server.previewCommanderInvestigationProviderReadiness({ phase: "proposal_investigation", provider_id: "fixture_provider", provider_kind: "openai", model_id: "fixture-model" })
    expect(ready.runtime_lifecycle_state).toBe("ready")
    expect(ready.execution_ready).toBe(true)
  })

  test("provider audit policy fails closed before tool execution when metadata is missing or malformed", async () => {
    const calls: string[] = []
    const controller = new CommanderInvestigationController({
      modelAdapter: new ScriptedCommanderModelStepAdapter([{ status: "tool_call", tool_calls: [toolCall("call_search", "commander.tool_search", { query: "research" })], provider_metadata: { scripted: true } }]),
      toolExecutor: { execute: async () => { calls.push("tool"); throw new Error("must not execute") } },
      toolService: new CommanderToolService({ contextBudgetService: new ContextBudgetService({ registry: new ModelCapabilityRegistry() }) }),
      descriptors: COMMANDER_TOOL_REGISTRY,
      boundToolIds: COMMANDER_BOUND_TOOL_IDS,
      bootstrapService: { compile: async () => minimalTestBootstrap() },
      contextService: new CommanderInvestigationContextService(),
      capabilityRegistry: new ModelCapabilityRegistry(),
      contextBudgetService: new ContextBudgetService({ registry: new ModelCapabilityRegistry() }),
      providerAuditPolicy: { required: true, transport_kind: "external_api_connector", connector_id: "openai-test" },
    })
    const result = await controller.run(baseInvestigation())
    expect(result).toMatchObject({ status: "failed", stop_reason: "provider_audit_incomplete", provider_request_count: 1, tool_call_count: 0, events_appended: false, external_api_audit_events_appended: 0 })
    expect(calls).toEqual([])

    const abortController = new AbortController()
    setTimeout(() => abortController.abort(new Error("operator cancelled")), 1)
    const cancelled = await controllerWithAuditAdapter(new ScriptedCommanderModelStepAdapter([{ status: "final", text: "cancel race", delay_ms: 10 }])).run(baseInvestigation({ abort_signal: abortController.signal }))
    expect(cancelled).toMatchObject({ status: "cancelled", stop_reason: "caller_cancelled", provider_request_count: 1, external_api_audit_events_appended: 0 })
    expect(cancelled.stop_reason).not.toBe("provider_audit_incomplete")

    const timedOut = await controllerWithAuditAdapter(new ScriptedCommanderModelStepAdapter([{ status: "final", text: "timeout race", delay_ms: 15 }])).run(baseInvestigation({ max_wall_time_ms: 5 }))
    expect(timedOut).toMatchObject({ status: "budget_exhausted", stop_reason: "wall_time_exhausted", provider_request_count: 1, external_api_audit_events_appended: 0 })
    expect(timedOut.stop_reason).not.toBe("provider_audit_incomplete")

    const goodMetadata = { nexusloop_transport: { transport_kind: "external_api_connector", connector_id: "openai-test", request_ids: ["volatile_a"], audit_event_kinds: ["external_api_request_executed"], audit_event_count: 1, successful_audit_count: 1, failed_audit_count: 0, dropped_header_names: [], request_body_persisted: false, response_body_persisted: false, credentials_persisted: false } }
    const badMetadata = { nexusloop_transport: { ...goodMetadata.nexusloop_transport, request_ids: [], audit_event_count: 0 } }
    const finalA = await controllerWithAuditMetadata(goodMetadata, "semantic final").run(baseInvestigation({ investigation_id: "inv_audit_hash" }))
    const finalB = await controllerWithAuditMetadata({ nexusloop_transport: { ...goodMetadata.nexusloop_transport, request_ids: ["volatile_b"] } }, "semantic final").run(baseInvestigation({ investigation_id: "inv_audit_hash" }))
    const missing = await controllerWithAuditMetadata(badMetadata, "semantic final").run(baseInvestigation({ investigation_id: "inv_audit_hash" }))
    expect(finalA.status).toBe("final")
    expect(finalA.events_appended).toBe(true)
    expect(finalA.external_api_audit_events_appended).toBe(1)
    expect(finalA.provider_audit.all_provider_requests_audited).toBe(true)
    expect(finalA.result_hash).toBe(finalB.result_hash)
    expect(missing).toMatchObject({ status: "failed", stop_reason: "provider_audit_incomplete" })
    expect(missing.result_hash).not.toBe(finalA.result_hash)

    const interruptedAbort = new AbortController()
    const cancelledWithAudit = await controllerWithAuditAdapter(interruptedAdapter({ status: "cancelled", error: "request cancelled", provider_metadata: goodMetadata, abortController: interruptedAbort })).run(baseInvestigation({ abort_signal: interruptedAbort.signal }))
    expect(cancelledWithAudit).toMatchObject({ status: "cancelled", stop_reason: "caller_cancelled", provider_request_count: 1, external_api_audit_events_appended: 1, events_appended: true })
    expect(cancelledWithAudit.provider_audit).toMatchObject({ audit_required: true, external_api_audit_event_count: 1, successful_audit_count: 1, failed_audit_count: 0, all_provider_requests_audited: true })

    const timedOutWithAudit = await controllerWithAuditAdapter(interruptedAdapter({ status: "failed", error: "request timed out", provider_metadata: { nexusloop_transport: { ...goodMetadata.nexusloop_transport, request_ids: ["volatile_timeout"], audit_event_kinds: ["external_api_request_failed"], successful_audit_count: 0, failed_audit_count: 1 } }, delay_ms: 10 })).run(baseInvestigation({ max_wall_time_ms: 5 }))
    expect(timedOutWithAudit).toMatchObject({ status: "budget_exhausted", stop_reason: "wall_time_exhausted", provider_request_count: 1, external_api_audit_events_appended: 1, events_appended: true })
    expect(timedOutWithAudit.provider_audit).toMatchObject({ audit_required: true, external_api_audit_event_count: 1, successful_audit_count: 0, failed_audit_count: 1, all_provider_requests_audited: true })

    const overRequestMetadata = { nexusloop_transport: { ...goodMetadata.nexusloop_transport, request_ids: ["volatile_over_a", "volatile_over_b"], audit_event_kinds: ["external_api_request_executed", "external_api_request_failed"], audit_event_count: 2, successful_audit_count: 1, failed_audit_count: 1 } }
    const overRequestCount = await controllerWithAuditAdapter(new ScriptedCommanderModelStepAdapter([{ status: "final", text: "bad count with audits", request_count: 2, provider_metadata: overRequestMetadata }])).run(baseInvestigation({ investigation_id: "inv_over_request_audit" }))
    expect(overRequestCount).toMatchObject({ status: "failed", stop_reason: "controller_error", provider_request_count: 2, external_api_audit_events_appended: 2, events_appended: true })
    expect(overRequestCount.blockers.join(" ")).toContain("one-request contract")
  })

  test("injected connector-backed adapters count optional external API audits truthfully", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w2b2-optional-audit-"))
    const adapter = connectorBackedAdapter(projectDir, new FakeExternalApiTransport([{ status_code: 200, body: chatCompletionText("optional connector final") }]), "api_optional_audit")
    const result = await controllerWithOptionalAuditAdapter(adapter).run(baseInvestigation({ provider_id: "fixture_provider", provider_kind: "openai_compatible", model_id: "fixture-model", tool_protocol: "native" }))

    expect(result).toMatchObject({
      status: "final",
      provider_request_count: 1,
      external_api_audit_events_appended: 1,
      events_appended: true,
      investigation_events_appended: false,
    })
    expect(result.provider_audit).toMatchObject({
      audit_required: false,
      transport_kind: "external_api_connector",
      provider_request_count: 1,
      external_api_audit_event_count: 1,
      successful_audit_count: 1,
      failed_audit_count: 0,
      all_provider_requests_audited: true,
      request_body_persisted: false,
      response_body_persisted: false,
      credentials_persisted: false,
    })
    const text = await eventText(projectDir)
    expect(text).toContain("external_api_request_executed")
    expect(text).not.toContain("optional connector final")
    expect(text).not.toContain("real-provider-key")
    expect(text).not.toContain(CONNECTOR_MANAGED_API_KEY_SENTINEL)
  })

  test("configured RuntimeServer loopback provider runs only after start and records one external API audit per request", async () => {
    const mock = startInvestigationMockServer()
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w2b2-loopback-"))
    await writeApprovedSpec(projectDir)
    const server = createRuntimeServerFromLaunchConfig({ projectDir, env: providerLaunchEnv(`${mock.url.replace("127.0.0.1", "localhost")}/v1`) })
    expect(mock.requests).toHaveLength(0)
    const blocked = await server.runCommanderInvestigationInMemory(baseInvestigation({ provider_id: "fixture_provider", provider_kind: "openai", model_id: "fixture-model", tool_protocol: "native" }))
    expect(blocked).toMatchObject({ status: "blocked", stop_reason: "provider_preflight_blocked", provider_request_count: 0, external_api_audit_events_appended: 0, events_appended: false })
    expect(mock.requests).toHaveLength(0)
    expect(await eventText(projectDir)).toBe("")
    await server.start()
    servers.push({ stop: () => server.shutdown() })
    const ready = server.previewCommanderInvestigationProviderReadiness({ phase: "proposal_investigation", provider_id: "fixture_provider", provider_kind: "openai", model_id: "fixture-model" })
    expect(ready.status).toBe("ready")
    const blankKind = await server.runCommanderInvestigationInMemory(baseInvestigation({ provider_id: "fixture_provider", provider_kind: "", model_id: "fixture-model", tool_protocol: "native" }))
    expect(blankKind).toMatchObject({ status: "blocked", stop_reason: "controller_error", provider_request_count: 0, external_api_audit_events_appended: 0, events_appended: false })
    expect(blankKind.blockers.join(" ")).toContain("provider_kind is required")
    expect(mock.requests).toHaveLength(0)
    const missingKind = await server.runCommanderInvestigationInMemory(baseInvestigation({ provider_id: "fixture_provider", provider_kind: undefined as unknown as string, model_id: "fixture-model", tool_protocol: "native" }))
    expect(missingKind).toMatchObject({ status: "blocked", stop_reason: "controller_error", provider_request_count: 0, external_api_audit_events_appended: 0, events_appended: false })
    expect(missingKind.blockers.join(" ")).toContain("provider_kind is required")
    expect(mock.requests).toHaveLength(0)
    const result = await server.runCommanderInvestigationInMemory(baseInvestigation({ investigation_id: "inv_configured_loopback", requested_by: "runtime_provider_test", provider_id: "fixture_provider", provider_kind: "openai", model_id: "fixture-model", tool_protocol: "native" }))
    expect(result.status).toBe("final")
    expect(result.provider_request_count).toBe(4)
    expect(result.model_turn_count).toBe(4)
    expect(result.tool_search_call_count).toBe(1)
    expect(result.loaded_tool_ids).toContain("memory.search")
    expect(result.provider_audit).toMatchObject({ audit_required: true, transport_kind: "external_api_connector", provider_request_count: 4, external_api_audit_event_count: 4, successful_audit_count: 4, failed_audit_count: 0, all_provider_requests_audited: true, request_body_persisted: false, response_body_persisted: false, credentials_persisted: false })
    expect(result.events_appended).toBe(true)
    expect(result.investigation_events_appended).toBe(false)
    expect(mock.requests).toHaveLength(4)
    expect(JSON.stringify(mock.requests[0].body)).not.toContain("memory__search")
    expect(JSON.stringify(mock.requests[2].body)).toContain("memory__search")
    const events = await eventText(projectDir)
    expect((events.match(/external_api_request_executed/g) ?? []).length).toBe(4)
    expect(events).toContain("runtime_provider_test")
    expect(events).not.toContain("commander_model_adapter")
    expect(events).not.toContain("Final after dynamic reads")
    expect(events).not.toContain("real-provider-key")
    expect(events).not.toContain(CONNECTOR_MANAGED_API_KEY_SENTINEL)
    await server.shutdown()
    await expect(server.runCommanderInvestigationInMemory(baseInvestigation({ provider_id: "fixture_provider", provider_kind: "openai", model_id: "fixture-model" }))).resolves.toMatchObject({ status: "blocked", stop_reason: "provider_preflight_blocked", provider_request_count: 0 })
  })

  test("configured provider shutdown aborts in-flight request and writes audit before runtime shutdown", async () => {
    const mock = startStalledInvestigationMockServer()
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w2b2-shutdown-drain-"))
    await writeApprovedSpec(projectDir)
    const server = createRuntimeServerFromLaunchConfig({ projectDir, env: providerLaunchEnv(`${mock.url.replace("127.0.0.1", "localhost")}/v1`) })
    await server.start()

    const investigation = server.runCommanderInvestigationInMemory(baseInvestigation({ investigation_id: "inv_shutdown_drain", requested_by: "runtime_shutdown_test", provider_id: "fixture_provider", provider_kind: "openai", model_id: "fixture-model", tool_protocol: "native" }))
    await waitFor(() => mock.requests.length === 1)
    const shutdown = server.shutdown("shutdown during Commander provider request")
    const blockedDuringShutdown = await server.runCommanderInvestigationInMemory(baseInvestigation({ provider_id: "fixture_provider", provider_kind: "openai", model_id: "fixture-model", tool_protocol: "native" }))
    expect(blockedDuringShutdown).toMatchObject({ status: "blocked", stop_reason: "provider_preflight_blocked", provider_request_count: 0, external_api_audit_events_appended: 0, events_appended: false })

    const result = await investigation
    await shutdown
    expect(result.status).toBe("cancelled")
    expect(result.provider_request_count).toBe(1)
    expect(result.external_api_audit_events_appended).toBe(1)
    expect(result.events_appended).toBe(true)
    expect(mock.requests).toHaveLength(1)

    const events = await eventText(projectDir)
    const kinds = eventKinds(events)
    expect((events.match(/external_api_request_failed/g) ?? []).length).toBe(1)
    expect(kinds.indexOf("external_api_request_failed")).toBeGreaterThan(-1)
    expect(kinds.indexOf("external_api_request_failed")).toBeLessThan(kinds.indexOf("runtime_shutdown"))
    expect(kinds[kinds.length - 1]).toBe("runtime_shutdown")
    expect(events).toContain("external API request cancelled")
    expect(events).not.toContain("Investigate bounded Commander reads")
    expect(events).not.toContain("Final after dynamic reads")
    expect(events).not.toContain("memory__search")
    expect(events).not.toContain("real-provider-key")
    expect(events).not.toContain(CONNECTOR_MANAGED_API_KEY_SENTINEL)
  })

  test("configured provider shutdown retains run lock until active investigation drain completes", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w2b2-lock-drain-"))
    await writeApprovedSpec(projectDir)
    let releaseTransport!: () => void
    const transportReleased = new Promise<void>((resolve) => {
      releaseTransport = resolve
    })
    const transport = delayedAbortTransport(transportReleased)
    const first = configuredProviderRuntimeServer(projectDir, { transport })
    await first.start()
    const investigation = first.runCommanderInvestigationInMemory(baseInvestigation({ provider_id: "fixture_provider", provider_kind: "openai", model_id: "fixture-model", tool_protocol: "native" }))
    await waitFor(() => transport.requests === 1)

    const shutdown = first.shutdown("drain lock test")
    await waitFor(() => transport.aborted)
    const second = configuredProviderRuntimeServer(projectDir, { transport: new FakeExternalApiTransport([{ status_code: 200, body: chatCompletionText("second") }]) })
    await expect(second.start()).rejects.toThrow("runtime lock already held")

    releaseTransport()
    const result = await investigation
    await shutdown
    expect(result).toMatchObject({ status: "cancelled", provider_request_count: 1, external_api_audit_events_appended: 1 })
    const third = configuredProviderRuntimeServer(projectDir, { transport: new FakeExternalApiTransport([{ status_code: 200, body: chatCompletionText("third") }]) })
    await third.start()
    servers.push({ stop: () => third.shutdown() })
    expect(third.previewCommanderInvestigationProviderReadiness({ phase: "proposal_investigation", provider_id: "fixture_provider", provider_kind: "openai", model_id: "fixture-model" }).execution_ready).toBe(true)
  })

  test("durable Commander investigation journal writes start model-step checkpoint and terminal records without raw transcript", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-durable-journal-"))
    await writeApprovedSpec(projectDir)
    const server = new RuntimeServer({
      projectDir,
      adapter: new FakeOpenCodeAdapter(),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([
        { status: "tool_call", tool_calls: [toolCall("durable_search", "commander.tool_search", { query: "durable memory" })] },
        { status: "final", text: "Durable final summary." },
      ]),
    })
    servers.push({ stop: () => server.shutdown() })
    await server.start()
    const durableObjective = "Investigate durable records with token=durable-secret"
    const inMemory = await new RuntimeServer({
      projectDir: await mkdtemp(join(tmpdir(), "nxl-9w3a-in-memory-compare-")),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([
        { status: "tool_call", tool_calls: [toolCall("durable_search", "commander.tool_search", { query: "durable memory" })] },
        { status: "final", text: "Durable final summary." },
      ]),
    }).runCommanderInvestigationInMemory(baseInvestigation({ investigation_id: "inv_durable_compare", objective: durableObjective, requested_by: "durable_tester" }))
    const beforeDurableEvents = await eventText(projectDir)
    expect(beforeDurableEvents).not.toContain("runtime_commander_investigation_")

    const result = await server.runCommanderInvestigationDurable(baseInvestigation({ investigation_id: "inv_durable_journal", objective: durableObjective, requested_by: "durable_tester" }))
    expect(result).toMatchObject({
      status: "final",
      stop_reason: "model_final",
      in_memory_only: false,
      working_set_persisted: true,
      investigation_events_appended: true,
      transcript_persisted: false,
      investigation_event_count: 5,
    })
    expect(result.events_appended).toBe(true)
    expect(result.result_hash).toBe(inMemory.result_hash)
    expect(result.durability).toMatchObject({ mode: "event_journal", started_persisted: true, initial_checkpoint_persisted: true, terminal_persisted: true, checkpoint_count: 2, resume_supported: false })

    const events = await eventText(projectDir)
    const kinds = eventKinds(events).filter((kind) => kind.startsWith("runtime_commander_investigation_"))
    expect(kinds).toEqual([
      "runtime_commander_investigation_started",
      "runtime_commander_investigation_model_step_started",
      "runtime_commander_investigation_checkpointed",
      "runtime_commander_investigation_model_step_started",
      "runtime_commander_investigation_finished",
    ])
    expect(events).toContain("\"journal_sequence\":0")
    expect(events).toContain("\"checkpoint_sequence\":0")
    expect(events).toContain("\"checkpoint_kind\":\"initial\"")
    expect(events).toContain("\"checkpoint_kind\":\"turn_complete\"")
    expect(events).toContain("\"recent_result_signatures\"")
    expect(events).toContain("\"durable_summary_only\":true")
    expect(events).not.toContain("\"output_tokens\":\"[REDACTED]\"")
    expect(events).not.toContain("durable-secret")
    expect(events).not.toContain("execution_arguments")
    expect(events).not.toContain("raw_provider")
    expect(events).not.toContain("reasoning_content")

    const record = await server.getCommanderInvestigationRecord("inv_durable_journal")
    expect(record).toMatchObject({ status: "final", stop_reason: "model_final", checkpoint_available: true, resume_supported: false, recovery_state: "not_required", projection_status: "ready" })
    expect(record?.investigation_event_count).toBe(5)
    const checkpoint = await server.getLatestCommanderInvestigationCheckpoint("inv_durable_journal")
    expect(checkpoint).toMatchObject({ checkpoint_kind: "turn_complete", resume_supported: false, full_transcript_persisted: false, raw_tool_results_persisted: false, chain_of_thought_persisted: false })
    expect(checkpoint?.loaded_tools.every((tool) => !("input_schema" in tool))).toBe(true)
    const summary = await server.commanderInvestigationJournalSummary()
    expect(summary).toMatchObject({ total: 1, final_count: 1, checkpoint_available_count: 1 })
  })

  test("durable checkpoint working-set hash is refreshed after turn summary eviction", async () => {
    const contextBudgetService = new ContextBudgetService({ registry: new ModelCapabilityRegistry() })
    const checkpoints: CommanderInvestigationCheckpointSnapshot[] = []
    const controller = new CommanderInvestigationController({
      modelAdapter: new ScriptedCommanderModelStepAdapter([
        { status: "tool_call", tool_calls: [toolCall("working_hash_search_1", "commander.tool_search", { query: "working hash alpha" })] },
        { status: "tool_call", tool_calls: [toolCall("working_hash_search_2", "commander.tool_search", { query: "working hash beta" })] },
        { status: "final", text: "Working hash final." },
      ]),
      toolExecutor: executorFixture().executor,
      toolService: new CommanderToolService({ contextBudgetService }),
      descriptors: COMMANDER_TOOL_REGISTRY,
      boundToolIds: COMMANDER_BOUND_TOOL_IDS,
      bootstrapService: { compile: async () => minimalTestBootstrap() },
      contextService: new CommanderInvestigationContextService(),
      capabilityRegistry: new ModelCapabilityRegistry(),
      contextBudgetService,
      persistenceObserver: {
        onStarted: () => undefined,
        onModelStepStarted: () => undefined,
        onCheckpoint: (snapshot) => {
          checkpoints.push(snapshot)
        },
      },
    })
    const result = await controller.run(baseInvestigation({
      investigation_id: "inv_working_hash_eviction",
      objective: "checkpoint working set hash after turn summary cap",
      max_turn_summaries: 1,
    }))
    expect(result.status).toBe("final")
    expect(checkpoints).toHaveLength(2)
    const workingSet = checkpoints.at(-1)!.working_set
    expect(workingSet.omitted_turn_count).toBeGreaterThan(0)
    expect(checkpoints.at(-1)!.turn_summaries).toHaveLength(1)
    const { working_set_hash: _workingSetHash, ...stableWorkingSetFields } = workingSet
    expect(workingSet.working_set_hash).toBe(stableHash({
      ...stableWorkingSetFields,
      evidence_cards: workingSet.evidence_cards.map((item) => ({ ...item, observed_at: "" })),
      provider_audit: { ...workingSet.provider_audit, audit_request_ids: [] },
    }))
  })

  test("durable started observer receives a refreshed initial working-set hash after warnings", async () => {
    const contextBudgetService = new ContextBudgetService({ registry: new ModelCapabilityRegistry() })
    let startedWorkingSet: CommanderInvestigationStartedSnapshot["working_set"] | undefined
    const controller = new CommanderInvestigationController({
      modelAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "Initial hash final." }]),
      toolExecutor: executorFixture().executor,
      toolService: new CommanderToolService({ contextBudgetService }),
      descriptors: COMMANDER_TOOL_REGISTRY,
      boundToolIds: COMMANDER_BOUND_TOOL_IDS,
      bootstrapService: { compile: async () => minimalTestBootstrap() },
      contextService: new CommanderInvestigationContextService(),
      capabilityRegistry: new ModelCapabilityRegistry(),
      contextBudgetService,
      persistenceObserver: {
        onStarted: (snapshot) => {
          startedWorkingSet = snapshot.working_set
        },
        onModelStepStarted: () => undefined,
        onCheckpoint: () => undefined,
      },
    })
    const result = await controller.run(baseInvestigation({
      investigation_id: "inv_started_hash_warning",
      objective: "started hash includes initial warnings",
    }))
    expect(result.status).toBe("final")
    expect(startedWorkingSet?.current_warnings.some((warning) => warning.includes("json_fallback"))).toBe(true)
    const { working_set_hash: _workingSetHash, ...stableWorkingSetFields } = startedWorkingSet!
    expect(startedWorkingSet!.working_set_hash).toBe(stableHash({
      ...stableWorkingSetFields,
      evidence_cards: startedWorkingSet!.evidence_cards.map((item) => ({ ...item, observed_at: "" })),
      provider_audit: { ...startedWorkingSet!.provider_audit, audit_request_ids: [] },
    }))
  })

  test("durable journal rejects duplicate ids and terminal persistence failures leave nonterminal projection", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-durable-failures-"))
    await writeApprovedSpec(projectDir)
    const server = new RuntimeServer({
      projectDir,
      adapter: new FakeOpenCodeAdapter(),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "first final" }, { status: "final", text: "second final" }]),
    })
    servers.push({ stop: () => server.shutdown() })
    await server.start()
    const first = await server.runCommanderInvestigationDurable(baseInvestigation({ investigation_id: "inv_duplicate" }))
    expect(first.status).toBe("final")
    const duplicate = await server.runCommanderInvestigationDurable(baseInvestigation({ investigation_id: "inv_duplicate" }))
    expect(duplicate).toMatchObject({ status: "blocked", stop_reason: "durable_state_conflict", provider_request_count: 0 })
    const duplicateAbort = new AbortController()
    duplicateAbort.abort(new Error("durable Commander investigation journal conflict"))
    const preOverride = await server.runCommanderInvestigationInMemory(baseInvestigation({ investigation_id: "inv_duplicate", abort_signal: duplicateAbort.signal }))
    expect(duplicate.result_hash).toBe(stableHash({
      semantic: preOverride.result_hash,
      status: duplicate.status,
      stop_reason: duplicate.stop_reason,
      blockers: duplicate.blockers,
      provider_request_count: duplicate.provider_request_count,
      tool_call_count: duplicate.tool_call_count,
      investigation_event_count: duplicate.investigation_event_count,
      external_api_audit_events_appended: duplicate.external_api_audit_events_appended,
    }))
    expect(duplicate.result_hash).not.toBe(preOverride.result_hash)
    await server.shutdown()
    const stopped = await server.runCommanderInvestigationDurable(baseInvestigation({ investigation_id: "inv_stopped_preflight" }))
    expect(stopped).toMatchObject({ status: "blocked", stop_reason: "provider_preflight_blocked", provider_request_count: 0 })
    const preflightAbort = new AbortController()
    preflightAbort.abort(new Error("durable Commander investigation requires active ready runtime with run lock"))
    const stoppedPreOverride = await server.runCommanderInvestigationInMemory(baseInvestigation({ investigation_id: "inv_stopped_preflight", abort_signal: preflightAbort.signal }))
    expect(stopped.result_hash).toBe(stableHash({
      semantic: stoppedPreOverride.result_hash,
      status: stopped.status,
      stop_reason: stopped.stop_reason,
      blockers: stopped.blockers,
      provider_request_count: stopped.provider_request_count,
      tool_call_count: stopped.tool_call_count,
      investigation_event_count: stopped.investigation_event_count,
      external_api_audit_events_appended: stopped.external_api_audit_events_appended,
    }))

    const failingServer = new RuntimeServer({
      projectDir,
      adapter: new FakeOpenCodeAdapter(),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "terminal will fail" }]),
    })
    servers.push({ stop: () => failingServer.shutdown() })
    await failingServer.start()
    const failingAppend = failingServer.eventStore.append.bind(failingServer.eventStore)
    failingServer.eventStore.append = async (event: Parameters<EventStore["append"]>[0]): Promise<string> => {
      if ((event as { kind?: string }).kind === "runtime_commander_investigation_finished") throw new Error("terminal append failed")
      return failingAppend(event)
    }
    const terminalFailure = await failingServer.runCommanderInvestigationDurable(baseInvestigation({ investigation_id: "inv_terminal_fail" }))
    expect(terminalFailure).toMatchObject({ status: "failed", stop_reason: "persistence_failed", in_memory_only: false, investigation_events_appended: true })
    expect(terminalFailure.durability).toMatchObject({ terminal_persisted: false, original_terminal_status_if_persistence_failed: "final" })
    const comparisonDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-terminal-fail-semantic-"))
    await writeApprovedSpec(comparisonDir)
    const comparisonServer = new RuntimeServer({
      projectDir: comparisonDir,
      adapter: new FakeOpenCodeAdapter(),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "terminal will fail" }]),
    })
    servers.push({ stop: () => comparisonServer.shutdown() })
    await comparisonServer.start()
    const semantic = await comparisonServer.runCommanderInvestigationInMemory(baseInvestigation({ investigation_id: "inv_terminal_fail" }))
    expect(terminalFailure.result_hash).toBe(semantic.result_hash)
    const projected = await failingServer.getCommanderInvestigationRecord("inv_terminal_fail")
    expect(projected).toMatchObject({ status: "running", recovery_state: "uncertain_provider_outcome_resume_not_implemented", uncertain_provider_outcome: true, resume_supported: false })
  })

  test("durable adapter rejection after model-step start preserves pending uncertainty", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-durable-controller-reject-"))
    await writeApprovedSpec(projectDir)
    const server = new RuntimeServer({
      projectDir,
      adapter: new FakeOpenCodeAdapter(),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{
        assert_request: () => {
          throw new Error("scripted adapter rejected after durable boundary")
        },
      }]),
    })
    servers.push({ stop: () => server.shutdown() })
    await server.start()

    const result = await server.runCommanderInvestigationDurable(baseInvestigation({ investigation_id: "inv_controller_reject" }))
    expect(result).toMatchObject({ status: "failed", stop_reason: "persistence_failed", in_memory_only: false, investigation_events_appended: true })
    expect(result.durability).toMatchObject({ terminal_persisted: false, pending_model_request_id: expect.any(String), resume_supported: false })
    const record = await server.getCommanderInvestigationRecord("inv_controller_reject")
    expect(record).toMatchObject({ status: "running", recovery_state: "uncertain_provider_outcome_resume_not_implemented", uncertain_provider_outcome: true, pending_model_request_id: expect.any(String) })
    const kinds = eventKinds(await eventText(projectDir)).filter((kind) => kind.startsWith("runtime_commander_investigation_"))
    expect(kinds).toEqual([
      "runtime_commander_investigation_started",
      "runtime_commander_investigation_model_step_started",
    ])
  })

  test("durable controller rejection after a checkpoint preserves original start time", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-durable-controller-reject-started-at-"))
    await writeApprovedSpec(projectDir)
    let tick = 0
    const server = new RuntimeServer({
      projectDir,
      adapter: new FakeOpenCodeAdapter(),
      researchSynthesisNow: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([
        { status: "tool_call", tool_calls: [toolCall("controller_reject_after_checkpoint_search", "commander.tool_search", { query: "durable controller rejection" })] },
        {
          assert_request: () => {
            throw new Error("scripted adapter rejected after durable checkpoint")
          },
        },
      ]),
    })
    servers.push({ stop: () => server.shutdown() })
    await server.start()

    const result = await server.runCommanderInvestigationDurable(baseInvestigation({ investigation_id: "inv_controller_reject_after_checkpoint" }))
    expect(result).toMatchObject({ status: "failed", stop_reason: "persistence_failed", in_memory_only: false, investigation_events_appended: true })
    expect(result.durability).toMatchObject({ terminal_persisted: false, pending_model_request_id: expect.any(String) })
    const events = await server.eventStore.readAll()
    const started = events.find((event) => event.kind === "runtime_commander_investigation_started" && event.investigation_id === "inv_controller_reject_after_checkpoint") as { started_at?: string } | undefined
    const checkpointed = events.find((event) => event.kind === "runtime_commander_investigation_checkpointed" && event.investigation_id === "inv_controller_reject_after_checkpoint") as { checkpoint?: { created_at?: string } } | undefined
    expect(started?.started_at).toBeDefined()
    expect(checkpointed?.checkpoint?.created_at).toBeDefined()
    const startedAt = started!.started_at!
    const checkpointCreatedAt = checkpointed!.checkpoint!.created_at!
    expect(checkpointCreatedAt).not.toBe(startedAt)
    expect(result.started_at).toBe(startedAt)
    expect(result.started_at).not.toBe(checkpointCreatedAt)
    const record = await server.getCommanderInvestigationRecord("inv_controller_reject_after_checkpoint")
    expect(record).toMatchObject({ status: "running", started_at: startedAt, uncertain_provider_outcome: true, pending_model_request_id: expect.any(String) })
    const kinds = events.filter((event) => typeof event.kind === "string" && event.kind.startsWith("runtime_commander_investigation_") && event.investigation_id === "inv_controller_reject_after_checkpoint").map((event) => event.kind)
    expect(kinds).toEqual([
      "runtime_commander_investigation_started",
      "runtime_commander_investigation_model_step_started",
      "runtime_commander_investigation_checkpointed",
      "runtime_commander_investigation_model_step_started",
    ])
  })

  test("durable generated investigation ids remain unique with fixed clock", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-durable-generated-id-"))
    await writeApprovedSpec(projectDir)
    const server = new RuntimeServer({
      projectDir,
      adapter: new FakeOpenCodeAdapter(),
      researchSynthesisNow: () => new Date("2026-01-01T00:00:00.000Z"),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "first generated" }, { status: "final", text: "second generated" }]),
    })
    servers.push({ stop: () => server.shutdown() })
    await server.start()
    const first = await server.runCommanderInvestigationDurable(baseInvestigation({ objective: "fixed-clock generated durable id" }))
    const second = await server.runCommanderInvestigationDurable(baseInvestigation({ objective: "fixed-clock generated durable id" }))
    expect(first.status).toBe("final")
    expect(second.status).toBe("final")
    expect(first.investigation_id).toStartWith("commander_investigation_")
    expect(second.investigation_id).toStartWith("commander_investigation_")
    expect(first.investigation_id).not.toBe(second.investigation_id)
    const records = await server.listCommanderInvestigationRecords({ limit: 10 })
    expect(records.map((record) => record.investigation_id)).toContain(first.investigation_id)
    expect(records.map((record) => record.investigation_id)).toContain(second.investigation_id)
  })

  test("durable terminal records compact evidence and turn summaries before the terminal cap", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-durable-terminal-compact-"))
    await writeApprovedSpec(projectDir)
    const longModelId = `model_${"m".repeat(175)}`
    const input = baseInvestigation({ investigation_id: "inv_terminal_compact", objective: "compact terminal payload", model_id: longModelId })
    const controllerServer = new RuntimeServer({
      projectDir,
      adapter: new FakeOpenCodeAdapter(),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "terminal compact final" }]),
    })
    servers.push({ stop: () => controllerServer.shutdown() })
    const baseResult = await controllerServer.runCommanderInvestigationInMemory(input)
    const store = new EventStore(join(projectDir, ".nxl", "events.jsonl"))
    const service = new CommanderInvestigationJournalService({ eventStore: store })
    const run = await service.createObserver(input)
    await run.observer.onStarted(durableStartedSnapshot(input, 0, "inv_terminal_compact") as Parameters<typeof run.observer.onStarted>[0])
    const largeTurns = Array.from({ length: 12 }, (_, index) => ({
      ...baseResult.turn_summaries[0],
      turn_index: index + 1,
      model_request_id: `model_request_large_terminal_${index}`,
      assistant_text_preview: "assistant terminal summary ".repeat(30),
      warnings: Array.from({ length: 8 }, (__, warningIndex) => `terminal warning ${index}-${warningIndex} ${"w".repeat(220)}`),
      turn_hash: `turn_hash_large_terminal_${index}`,
    }))
    const largeResult = {
      ...baseResult,
      evidence: Array.from({ length: 24 }, (_, index) => largeEvidenceCard(index)),
      turn_summaries: largeTurns,
      omitted_evidence_count: 0,
      omitted_turn_count: 0,
      budget: { ...baseResult.budget, max_evidence_cards: 24, max_turn_summaries: 12 },
      final_summary: "terminal final summary ".repeat(240),
    }
    const durability = await service.finish(run, largeResult)
    expect(durability.terminal_persisted).toBe(true)
    service.release(run)
    const record = await service.get("inv_terminal_compact")
    expect(record).toMatchObject({ status: "final", projection_status: "ready", recovery_state: "not_required" })
    const finished = (await store.readAll()).find((event) => event.kind === "runtime_commander_investigation_finished")
    expect(finished).toBeDefined()
    expect(Buffer.byteLength(JSON.stringify(finished))).toBeLessThanOrEqual(48_000)
    const terminal = (finished as { terminal?: { model_id?: string; evidence_cards?: unknown[]; turn_summaries?: unknown[]; omitted_evidence_count?: number; omitted_turn_count?: number } }).terminal
    expect(terminal?.model_id).toBe(longModelId)
    expect(terminal?.omitted_evidence_count).toBeGreaterThan(0)
    expect(record?.evidence_count).toBe((terminal?.evidence_cards?.length ?? 0) + (terminal?.omitted_evidence_count ?? 0))
    expect(record?.evidence_count).toBeGreaterThan(terminal?.evidence_cards?.length ?? 0)
  })

  test("durable journal reserves ids across awaited lookup and exact get bypasses list pagination", async () => {
    const raceDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-durable-race-"))
    const raceStore = new EventStore(join(raceDir, ".nxl", "events.jsonl"))
    const service = new CommanderInvestigationJournalService({ eventStore: raceStore })
    const originalReadAll = raceStore.readAll.bind(raceStore)
    let releaseLookup!: () => void
    const lookupGate = new Promise<void>((resolve) => {
      releaseLookup = resolve
    })
    raceStore.readAll = async () => {
      await lookupGate
      return originalReadAll()
    }
    const first = service.createObserver(baseInvestigation({ investigation_id: "inv_concurrent_reserved" }))
    await Promise.resolve()
    const second = service.createObserver(baseInvestigation({ investigation_id: "inv_concurrent_reserved" }))
    releaseLookup()
    const results = await Promise.allSettled([first, second])
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
    const fulfilled = results.find((result): result is PromiseFulfilledResult<Awaited<typeof first>> => result.status === "fulfilled")
    expect(fulfilled).toBeDefined()
    service.release(fulfilled!.value)

    const journalDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-durable-pagination-"))
    const journalService = new CommanderInvestigationJournalService({ eventStore: new EventStore(join(journalDir, ".nxl", "events.jsonl")) })
    for (let index = 0; index < 101; index += 1) {
      const investigationId = index === 0 ? "inv_oldest_exact_lookup" : `inv_newer_${index}`
      const input = baseInvestigation({ investigation_id: investigationId, objective: `durable lookup ${index}` })
      const run = await journalService.createObserver(input)
      await run.observer.onStarted(durableStartedSnapshot(input, index, investigationId) as Parameters<typeof run.observer.onStarted>[0])
      journalService.release(run)
    }
    const oldest = await journalService.get("inv_oldest_exact_lookup")
    expect(oldest).toMatchObject({ investigation_id: "inv_oldest_exact_lookup", status: "running", recovery_state: "checkpoint_available_resume_not_implemented" })
    const visibleList = await journalService.list({ limit: 100 })
    expect(visibleList).toHaveLength(100)
    expect(visibleList.some((record) => record.investigation_id === "inv_oldest_exact_lookup")).toBe(false)
    const summary = await journalService.summary()
    expect(summary).toMatchObject({ total: 101, running_count: 101, checkpoint_available_count: 101 })
    await expect(journalService.createObserver(baseInvestigation({ investigation_id: "inv_oldest_exact_lookup", objective: "duplicate oldest durable lookup" }))).rejects.toThrow("9W3B recovery")
  })

  test("durable journal hashes the redacted persisted payload", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-redacted-payload-hash-"))
    const store = new EventStore(join(projectDir, ".nxl", "events.jsonl"))
    const service = new CommanderInvestigationJournalService({ eventStore: store })
    const input = baseInvestigation({
      investigation_id: "inv_redacted_payload_hash",
      objective: "Review token sk-test-secret before durable persistence",
      requested_by: "sk-requester-secret",
      session_id: "sk-session-secret",
      mission_id: "mission_redacted_hash",
    })
    const run = await service.createObserver(input)
    await run.observer.onStarted(durableStartedSnapshot(input, 0, "inv_redacted_payload_hash") as Parameters<typeof run.observer.onStarted>[0])
    service.release(run)
    const eventTextValue = await eventText(projectDir)
    expect(eventTextValue).not.toContain("sk-test-secret")
    expect(eventTextValue).not.toContain("sk-requester-secret")
    expect(eventTextValue).not.toContain("sk-session-secret")
    const record = await service.get("inv_redacted_payload_hash")
    expect(record).toMatchObject({ projection_status: "ready", checkpoint_available: true })
    expect(record?.integrity_errors).toEqual([])
  })

  test("durable journal rejects checkpoints without a pending model-step boundary", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-checkpoint-boundary-"))
    const service = new CommanderInvestigationJournalService({ eventStore: new EventStore(join(projectDir, ".nxl", "events.jsonl")) })
    const input = baseInvestigation({ investigation_id: "inv_checkpoint_without_pending_model", objective: "checkpoint requires pending model step" })
    const run = await service.createObserver(input)
    await run.observer.onStarted(durableStartedSnapshot(input, 0, "inv_checkpoint_without_pending_model") as Parameters<typeof run.observer.onStarted>[0])
    await expect(run.observer.onCheckpoint({
      ...durableStartedSnapshot(input, 1, "inv_checkpoint_without_pending_model"),
      turn_index: 1,
      next_turn_index: 2,
      turn_summaries: [],
      latest_tool_results: [],
      provider_request_count: 0,
      elapsed_active_ms: 10,
      created_at: "2026-01-01T00:00:02.000Z",
    } as Parameters<typeof run.observer.onCheckpoint>[0])).rejects.toThrow("pending model-step boundary")
    service.release(run)
  })

  test("durable journal projection rejects model-step and checkpoint boundary mismatches", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-pending-boundary-"))
    const store = new EventStore(join(projectDir, ".nxl", "events.jsonl"))
    const service = new CommanderInvestigationJournalService({ eventStore: store })

    const badModelInput = baseInvestigation({ investigation_id: "inv_bad_pending_working_hash", objective: "bad pending working hash" })
    const badModelRun = await service.createObserver(badModelInput)
    await badModelRun.observer.onStarted(durableStartedSnapshot(badModelInput, 0, "inv_bad_pending_working_hash") as Parameters<typeof badModelRun.observer.onStarted>[0])
    await badModelRun.observer.onModelStepStarted({
      investigation_id: "inv_bad_pending_working_hash",
      input: badModelInput,
      turn_index: 1,
      model_request_id: "model_request_bad_pending_working_hash",
      tool_protocol: "native",
      working_set_hash: "wrong_working_set_hash",
      context_hash: "context_hash_bad_pending_working_hash",
      input_bytes: 128,
      estimated_input_tokens: 32,
      loaded_tools: [],
      provider_request_count_before: 0,
      external_api_audit_count_before: 0,
      started_at: "2026-01-01T00:00:01.000Z",
    })
    service.release(badModelRun)
    const badModelRecord = await service.get("inv_bad_pending_working_hash")
    expect(badModelRecord).toMatchObject({ projection_status: "corrupt" })
    expect(badModelRecord?.integrity_errors).toContain("model-step working-set hash mismatch at sequence 1")

    const badCheckpointInput = baseInvestigation({ investigation_id: "inv_bad_pending_checkpoint", objective: "bad pending checkpoint" })
    const badCheckpointRun = await service.createObserver(badCheckpointInput)
    await badCheckpointRun.observer.onStarted(durableStartedSnapshot(badCheckpointInput, 1, "inv_bad_pending_checkpoint") as Parameters<typeof badCheckpointRun.observer.onStarted>[0])
    const initial = await service.latestCheckpoint("inv_bad_pending_checkpoint")
    expect(initial).toBeDefined()
    await badCheckpointRun.observer.onModelStepStarted({
      investigation_id: "inv_bad_pending_checkpoint",
      input: badCheckpointInput,
      turn_index: 1,
      model_request_id: "model_request_bad_pending_checkpoint",
      tool_protocol: "native",
      working_set_hash: initial!.working_set.working_set_hash,
      context_hash: "context_hash_bad_pending_checkpoint",
      input_bytes: 128,
      estimated_input_tokens: 32,
      loaded_tools: [],
      provider_request_count_before: 0,
      external_api_audit_count_before: 0,
      started_at: "2026-01-01T00:00:02.000Z",
    })
    service.release(badCheckpointRun)
    const badCheckpoint = {
      ...initial!,
      checkpoint_id: "checkpoint_bad_pending_counter",
      checkpoint_sequence: 1,
      checkpoint_kind: "turn_complete" as const,
      turn_index: 1,
      next_turn_index: 2,
      previous_checkpoint_id: initial!.checkpoint_id,
      previous_checkpoint_hash: initial!.checkpoint_hash,
      working_set: { ...initial!.working_set, model_turn_count: 1 },
      provider_request_count: 0,
      created_at: "2026-01-01T00:00:03.000Z",
      checkpoint_hash: "",
    }
    badCheckpoint.checkpoint_hash = stableHash({ ...badCheckpoint, checkpoint_hash: "" })
    const badCheckpointEvent = {
      kind: "runtime_commander_investigation_checkpointed",
      schema_version: 1,
      investigation_id: "inv_bad_pending_checkpoint",
      journal_sequence: 2,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:03.000Z",
      checkpoint: badCheckpoint,
      event_payload_hash: "",
    }
    badCheckpointEvent.event_payload_hash = journalPayloadHash(badCheckpointEvent)
    await store.append(badCheckpointEvent as Parameters<EventStore["append"]>[0])
    const badCheckpointRecord = await service.get("inv_bad_pending_checkpoint")
    expect(badCheckpointRecord).toMatchObject({ projection_status: "corrupt", pending_model_request_id: "model_request_bad_pending_checkpoint" })
    expect(badCheckpointRecord?.integrity_errors).toContain("checkpoint provider_request_count does not match pending model step")
  })

  test("durable checkpoint compaction rehashes replay tool messages", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-replay-rehash-"))
    const service = new CommanderInvestigationJournalService({
      eventStore: new EventStore(join(projectDir, ".nxl", "events.jsonl")),
      checkpointPayloadCapBytes: 16_000,
    })
    const input = baseInvestigation({ investigation_id: "inv_replay_rehash", objective: "compact replay exchange hashes" })
    const run = await service.createObserver(input)
    await run.observer.onStarted(durableStartedSnapshot(input, 0, "inv_replay_rehash") as Parameters<typeof run.observer.onStarted>[0])
    await run.observer.onModelStepStarted({
      investigation_id: "inv_replay_rehash",
      input,
      turn_index: 1,
      model_request_id: "model_request_replay_rehash",
      tool_protocol: "native",
      working_set_hash: run.state.latest_checkpoint!.working_set.working_set_hash,
      context_hash: "context_hash_replay_rehash",
      input_bytes: 512,
      estimated_input_tokens: 128,
      loaded_tools: [],
      provider_request_count_before: 0,
      external_api_audit_count_before: 0,
      started_at: "2026-01-01T00:00:01.000Z",
    })
    const checkpointSnapshot = durableStartedSnapshot(input, 1, "inv_replay_rehash") as unknown as CommanderInvestigationCheckpointSnapshot
    checkpointSnapshot.working_set.current_warnings = Array.from({ length: 24 }, (_, index) => `replay checkpoint warning ${index} ${"w".repeat(120)}`)
    checkpointSnapshot.working_set.model_turn_count = 1
    await run.observer.onCheckpoint({
      ...checkpointSnapshot,
      turn_index: 1,
      next_turn_index: 2,
      turn_summaries: [],
      latest_assistant: {
        role: "assistant",
        content: [
          {
            type: "tool_call",
            tool_call_id: "call_replay_rehash",
            tool_id: "memory.search",
            arguments: { query: "replay rehash" },
            arguments_valid: true,
            validation_errors: [],
            call_hash: "call_hash_replay_rehash",
          },
          {
            type: "tool_call",
            tool_call_id: "call_replay_rehash_2",
            tool_id: "memory.search",
            arguments: { query: "replay rehash 2" },
            arguments_valid: true,
            validation_errors: [],
            call_hash: "call_hash_replay_rehash_2",
          },
          {
            type: "tool_call",
            tool_call_id: "call_replay_rehash_3",
            tool_id: "memory.search",
            arguments: { query: "replay rehash 3" },
            arguments_valid: true,
            validation_errors: [],
            call_hash: "call_hash_replay_rehash_3",
          },
          {
            type: "tool_call",
            tool_call_id: "call_replay_rehash_4",
            tool_id: "memory.search",
            arguments: { query: "replay rehash 4" },
            arguments_valid: true,
            validation_errors: [],
            call_hash: "call_hash_replay_rehash_4",
          },
        ],
      },
      latest_tool_results: [1, 2, 3, 4].map((index) => ({
        role: "tool" as const,
        tool_call_id: index === 1 ? "call_replay_rehash" : `call_replay_rehash_${index}`,
        tool_id: "memory.search",
        content: "bounded replay result",
        content_hash: `large_replay_hash_${index}_`.repeat(1_000),
        truncated: false,
      })),
      provider_request_count: 1,
      elapsed_active_ms: 10,
      created_at: "2026-01-01T00:00:02.000Z",
    } as Parameters<typeof run.observer.onCheckpoint>[0])
    service.release(run)
    const checkpoint = await service.latestCheckpoint("inv_replay_rehash")
    const replay = checkpoint?.replay_exchange
    expect(replay).toBeDefined()
    expect(replay!.tool_result_messages[0].content).toContain("omitted_for_checkpoint_budget")
    expect(replay!.tool_result_messages[0].content_hash).toBe(stableHash(replay!.tool_result_messages[0].content))
    expect(replay!.exchange_hash).toBe(stableHash({ ...replay!, exchange_hash: "" }))
    expect(Buffer.byteLength(JSON.stringify((await service.get("inv_replay_rehash"))))).toBeGreaterThan(0)
  })

  test("durable journal projection isolates malformed unsupported payloads", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-durable-malformed-"))
    const store = new EventStore(join(projectDir, ".nxl", "events.jsonl"))
    await store.append({
      kind: "runtime_commander_investigation_started",
      schema_version: 2,
      investigation_id: "inv_malformed_unsupported",
      journal_sequence: 0,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:00.000Z",
      event_payload_hash: "bad_payload_hash",
    } as Parameters<EventStore["append"]>[0])
    const service = new CommanderInvestigationJournalService({ eventStore: store })
    const input = baseInvestigation({ investigation_id: "inv_valid_after_malformed", objective: "valid after malformed" })
    const run = await service.createObserver(input)
    await run.observer.onStarted(durableStartedSnapshot(input, 0, "inv_valid_after_malformed") as Parameters<typeof run.observer.onStarted>[0])
    service.release(run)
    const badCheckpointInput = baseInvestigation({ investigation_id: "inv_malformed_checkpoint", objective: "malformed checkpoint" })
    const badCheckpointRun = await service.createObserver(badCheckpointInput)
    await badCheckpointRun.observer.onStarted(durableStartedSnapshot(badCheckpointInput, 1, "inv_malformed_checkpoint") as Parameters<typeof badCheckpointRun.observer.onStarted>[0])
    const validInitialCheckpoint = await service.latestCheckpoint("inv_malformed_checkpoint")
    expect(validInitialCheckpoint?.checkpoint_sequence).toBe(0)
    service.release(badCheckpointRun)
    await store.append({
      kind: "runtime_commander_investigation_checkpointed",
      schema_version: 1,
      investigation_id: "inv_malformed_checkpoint",
      journal_sequence: 1,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:02.000Z",
      checkpoint: {
        schema_version: 1,
        checkpoint_id: "bad_checkpoint",
        investigation_id: "inv_malformed_checkpoint",
        checkpoint_sequence: 1,
        checkpoint_kind: "turn_complete",
        working_set: { evidence_cards: "bad" },
        checkpoint_hash: "bad_checkpoint_hash",
      },
      event_payload_hash: "bad_checkpoint_payload_hash",
    } as Parameters<EventStore["append"]>[0])
    await store.append({
      kind: "runtime_commander_investigation_finished",
      schema_version: 1,
      investigation_id: "inv_malformed_terminal",
      journal_sequence: 0,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:03.000Z",
      terminal: {
        schema_version: 1,
        investigation_id: "inv_malformed_terminal",
        last_checkpoint_id: "missing",
        last_checkpoint_hash: "missing_hash",
        terminal_hash: "bad_terminal_hash",
        completed_at: "2026-01-01T00:00:03.000Z",
        model_turn_count: 0,
        provider_request_count: 0,
        tool_call_count: 0,
        tool_search_call_count: 0,
        loaded_tool_ids: [],
        evidence_cards: [],
        provider_audit: {},
      },
      event_payload_hash: "bad_terminal_payload_hash",
    } as Parameters<EventStore["append"]>[0])
    const corruptTerminalInput = baseInvestigation({ investigation_id: "inv_corrupt_terminal", objective: "corrupt terminal" })
    const corruptTerminalRun = await service.createObserver(corruptTerminalInput)
    await corruptTerminalRun.observer.onStarted(durableStartedSnapshot(corruptTerminalInput, 3, "inv_corrupt_terminal") as Parameters<typeof corruptTerminalRun.observer.onStarted>[0])
    const corruptTerminalCheckpoint = await service.latestCheckpoint("inv_corrupt_terminal")
    expect(corruptTerminalCheckpoint?.checkpoint_sequence).toBe(0)
    service.release(corruptTerminalRun)
    await store.append({
      kind: "runtime_commander_investigation_finished",
      schema_version: 1,
      investigation_id: "inv_corrupt_terminal",
      journal_sequence: 1,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:04.000Z",
      terminal: {
        schema_version: 1,
        investigation_id: "inv_corrupt_terminal",
        status: "final",
        stop_reason: "model_final",
        phase: "proposal_investigation",
        objective_hash: "objective_hash_3",
        provider_id: "fixture",
        provider_kind: "unknown",
        model_id: "cloud-long-context",
        tool_protocol: "native",
        final_summary: "corrupt terminal should not complete",
        bootstrap_id: "bootstrap_3",
        bootstrap_hash: "bootstrap_hash_3",
        budget_id: "budget_3",
        budget_hash: "budget_hash_3",
        last_checkpoint_id: corruptTerminalCheckpoint?.checkpoint_id,
        last_checkpoint_sequence: corruptTerminalCheckpoint?.checkpoint_sequence,
        last_checkpoint_hash: corruptTerminalCheckpoint?.checkpoint_hash,
        pending_model_request_id: undefined,
        model_turn_count: 1,
        provider_request_count: 1,
        tool_call_count: 0,
        tool_search_call_count: 0,
        loaded_tool_ids: [],
        evidence_cards: [],
        turn_summaries: [],
        omitted_evidence_count: 0,
        omitted_turn_count: 0,
        provider_audit: { audit_required: false, transport_kind: "none", connector_ids: [], provider_request_count: 0, external_api_audit_event_count: 0, successful_audit_count: 0, failed_audit_count: 0, audit_request_ids: [], audit_event_kinds: [], omitted_request_id_count: 0, all_provider_requests_audited: true, request_body_persisted: false, response_body_persisted: false, credentials_persisted: false, warnings: [] },
        blockers: [],
        warnings: [],
        semantic_result_hash: "semantic_corrupt_terminal",
        started_at: "2026-01-01T00:00:03.000Z",
        completed_at: "2026-01-01T00:00:04.000Z",
        terminal_hash: "bad_terminal_hash",
        transcript_persisted: false,
        raw_tool_results_persisted: false,
        chain_of_thought_persisted: false,
      },
      event_payload_hash: "bad_corrupt_terminal_payload_hash",
    } as Parameters<EventStore["append"]>[0])
    const nestedBadTerminalInput = baseInvestigation({ investigation_id: "inv_nested_bad_terminal", objective: "nested bad terminal evidence" })
    const nestedBadTerminalRun = await service.createObserver(nestedBadTerminalInput)
    await nestedBadTerminalRun.observer.onStarted(durableStartedSnapshot(nestedBadTerminalInput, 4, "inv_nested_bad_terminal") as Parameters<typeof nestedBadTerminalRun.observer.onStarted>[0])
    const nestedBadTerminalCheckpoint = await service.latestCheckpoint("inv_nested_bad_terminal")
    service.release(nestedBadTerminalRun)
    await store.append({
      kind: "runtime_commander_investigation_finished",
      schema_version: 1,
      investigation_id: "inv_nested_bad_terminal",
      journal_sequence: 1,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:05.000Z",
      terminal: {
        schema_version: 1,
        investigation_id: "inv_nested_bad_terminal",
        status: "final",
        stop_reason: "model_final",
        phase: "proposal_investigation",
        objective_hash: "objective_hash_4",
        provider_id: "fixture",
        provider_kind: "unknown",
        model_id: "cloud-long-context",
        tool_protocol: "native",
        bootstrap_id: "bootstrap_4",
        bootstrap_hash: "bootstrap_hash_4",
        budget_id: "budget_4",
        budget_hash: "budget_hash_4",
        last_checkpoint_id: nestedBadTerminalCheckpoint?.checkpoint_id,
        last_checkpoint_sequence: nestedBadTerminalCheckpoint?.checkpoint_sequence,
        last_checkpoint_hash: nestedBadTerminalCheckpoint?.checkpoint_hash,
        model_turn_count: 1,
        provider_request_count: 1,
        tool_call_count: 0,
        tool_search_call_count: 0,
        loaded_tool_ids: [],
        evidence_cards: [null],
        turn_summaries: [],
        omitted_evidence_count: 0,
        omitted_turn_count: 0,
        provider_audit: { audit_required: false, transport_kind: "none", connector_ids: [], provider_request_count: 0, external_api_audit_event_count: 0, successful_audit_count: 0, failed_audit_count: 0, audit_request_ids: [], audit_event_kinds: [], omitted_request_id_count: 0, all_provider_requests_audited: true, request_body_persisted: false, response_body_persisted: false, credentials_persisted: false, warnings: [] },
        blockers: [],
        warnings: [],
        semantic_result_hash: "semantic_nested_bad_terminal",
        started_at: "2026-01-01T00:00:04.000Z",
        completed_at: "2026-01-01T00:00:05.000Z",
        terminal_hash: "nested_bad_terminal_hash",
        transcript_persisted: false,
        raw_tool_results_persisted: false,
        chain_of_thought_persisted: false,
      },
      event_payload_hash: "bad_nested_terminal_payload_hash",
    } as Parameters<EventStore["append"]>[0])
    const wrongOwnerTerminalInput = baseInvestigation({ investigation_id: "inv_wrong_owner_terminal", objective: "wrong owner terminal" })
    const wrongOwnerTerminalRun = await service.createObserver(wrongOwnerTerminalInput)
    await wrongOwnerTerminalRun.observer.onStarted(durableStartedSnapshot(wrongOwnerTerminalInput, 10, "inv_wrong_owner_terminal") as Parameters<typeof wrongOwnerTerminalRun.observer.onStarted>[0])
    const wrongOwnerTerminalCheckpoint = await service.latestCheckpoint("inv_wrong_owner_terminal")
    service.release(wrongOwnerTerminalRun)
    const wrongOwnerTerminal = {
      schema_version: 1,
      investigation_id: "other_investigation",
      status: "final" as const,
      stop_reason: "model_final" as const,
      phase: "proposal_investigation",
      objective_hash: "objective_hash_wrong_owner_terminal",
      provider_id: "fixture",
      provider_kind: "unknown",
      model_id: "cloud-long-context",
      tool_protocol: "native",
      final_summary: "wrong owner terminal should not complete",
      bootstrap_id: "bootstrap_10",
      bootstrap_hash: "bootstrap_hash_10",
      budget_id: "budget_10",
      budget_hash: "budget_hash_10",
      last_checkpoint_id: wrongOwnerTerminalCheckpoint!.checkpoint_id,
      last_checkpoint_sequence: wrongOwnerTerminalCheckpoint!.checkpoint_sequence,
      last_checkpoint_hash: wrongOwnerTerminalCheckpoint!.checkpoint_hash,
      pending_model_request_id: undefined,
      model_turn_count: 1,
      provider_request_count: 1,
      tool_call_count: 0,
      tool_search_call_count: 0,
      loaded_tool_ids: [],
      evidence_cards: [],
      turn_summaries: [],
      omitted_evidence_count: 0,
      omitted_turn_count: 0,
      provider_audit: { audit_required: false, transport_kind: "none", connector_ids: [], provider_request_count: 0, external_api_audit_event_count: 0, successful_audit_count: 0, failed_audit_count: 0, audit_request_ids: [], audit_event_kinds: [], omitted_request_id_count: 0, all_provider_requests_audited: true, request_body_persisted: false, response_body_persisted: false, credentials_persisted: false, warnings: [] },
      blockers: [],
      warnings: [],
      semantic_result_hash: "semantic_wrong_owner_terminal",
      started_at: "2026-01-01T00:00:10.000Z",
      completed_at: "2026-01-01T00:00:11.000Z",
      terminal_hash: "",
      transcript_persisted: false,
      raw_tool_results_persisted: false,
      chain_of_thought_persisted: false,
    }
    wrongOwnerTerminal.terminal_hash = stableHash({ ...wrongOwnerTerminal, terminal_hash: "" })
    const wrongOwnerTerminalEvent = {
      kind: "runtime_commander_investigation_finished",
      schema_version: 1,
      investigation_id: "inv_wrong_owner_terminal",
      journal_sequence: 1,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:11.000Z",
      terminal: wrongOwnerTerminal,
      event_payload_hash: "",
    }
    wrongOwnerTerminalEvent.event_payload_hash = journalPayloadHash(wrongOwnerTerminalEvent)
    await store.append(wrongOwnerTerminalEvent as Parameters<EventStore["append"]>[0])
    const wrongSequenceTerminalInput = baseInvestigation({ investigation_id: "inv_wrong_terminal_sequence", objective: "wrong terminal checkpoint sequence" })
    const wrongSequenceTerminalRun = await service.createObserver(wrongSequenceTerminalInput)
    await wrongSequenceTerminalRun.observer.onStarted(durableStartedSnapshot(wrongSequenceTerminalInput, 11, "inv_wrong_terminal_sequence") as Parameters<typeof wrongSequenceTerminalRun.observer.onStarted>[0])
    const wrongSequenceTerminalCheckpoint = await service.latestCheckpoint("inv_wrong_terminal_sequence")
    service.release(wrongSequenceTerminalRun)
    const wrongSequenceTerminal = {
      ...wrongOwnerTerminal,
      investigation_id: "inv_wrong_terminal_sequence",
      objective_hash: "objective_hash_wrong_terminal_sequence",
      last_checkpoint_id: wrongSequenceTerminalCheckpoint!.checkpoint_id,
      last_checkpoint_sequence: wrongSequenceTerminalCheckpoint!.checkpoint_sequence + 1,
      last_checkpoint_hash: wrongSequenceTerminalCheckpoint!.checkpoint_hash,
      semantic_result_hash: "semantic_wrong_terminal_sequence",
      terminal_hash: "",
    }
    wrongSequenceTerminal.terminal_hash = stableHash({ ...wrongSequenceTerminal, terminal_hash: "" })
    const wrongSequenceTerminalEvent = {
      kind: "runtime_commander_investigation_finished",
      schema_version: 1,
      investigation_id: "inv_wrong_terminal_sequence",
      journal_sequence: 1,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:12.000Z",
      terminal: wrongSequenceTerminal,
      event_payload_hash: "",
    }
    wrongSequenceTerminalEvent.event_payload_hash = journalPayloadHash(wrongSequenceTerminalEvent)
    await store.append(wrongSequenceTerminalEvent as Parameters<EventStore["append"]>[0])
    const checkpointWithoutBoundaryInput = baseInvestigation({ investigation_id: "inv_projected_checkpoint_without_boundary", objective: "project checkpoint without model step" })
    const checkpointWithoutBoundaryRun = await service.createObserver(checkpointWithoutBoundaryInput)
    await checkpointWithoutBoundaryRun.observer.onStarted(durableStartedSnapshot(checkpointWithoutBoundaryInput, 12, "inv_projected_checkpoint_without_boundary") as Parameters<typeof checkpointWithoutBoundaryRun.observer.onStarted>[0])
    const checkpointWithoutBoundaryInitial = await service.latestCheckpoint("inv_projected_checkpoint_without_boundary")
    service.release(checkpointWithoutBoundaryRun)
    const checkpointWithoutBoundary = {
      ...checkpointWithoutBoundaryInitial!,
      checkpoint_id: "checkpoint_without_model_step_boundary",
      checkpoint_sequence: 1,
      checkpoint_kind: "turn_complete" as const,
      previous_checkpoint_id: checkpointWithoutBoundaryInitial!.checkpoint_id,
      previous_checkpoint_hash: checkpointWithoutBoundaryInitial!.checkpoint_hash,
    }
    checkpointWithoutBoundary.checkpoint_hash = stableHash({ ...checkpointWithoutBoundary, checkpoint_hash: "" })
    const checkpointWithoutBoundaryEvent = {
      kind: "runtime_commander_investigation_checkpointed",
      schema_version: 1,
      investigation_id: "inv_projected_checkpoint_without_boundary",
      journal_sequence: 1,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:13.000Z",
      checkpoint: checkpointWithoutBoundary,
      event_payload_hash: "",
    }
    checkpointWithoutBoundaryEvent.event_payload_hash = journalPayloadHash(checkpointWithoutBoundaryEvent)
    await store.append(checkpointWithoutBoundaryEvent as Parameters<EventStore["append"]>[0])
    const badInitialInput = baseInvestigation({ investigation_id: "inv_bad_initial_chain", objective: "bad initial chain" })
    const badInitialSeedInput = baseInvestigation({ investigation_id: "inv_bad_initial_seed", objective: "bad initial seed" })
    const badInitialRun = await service.createObserver(badInitialSeedInput)
    await badInitialRun.observer.onStarted(durableStartedSnapshot(badInitialSeedInput, 6, "inv_bad_initial_seed") as Parameters<typeof badInitialRun.observer.onStarted>[0])
    service.release(badInitialRun)
    const seedStarted = (await store.readAll()).find((event) => event.kind === "runtime_commander_investigation_started" && event.investigation_id === "inv_bad_initial_seed")
    expect(seedStarted).toBeDefined()
    const badInitial = structuredClone(seedStarted!) as Record<string, unknown>
    badInitial.investigation_id = "inv_bad_initial_chain"
    badInitial.journal_sequence = 0
    badInitial.objective = badInitialInput.objective
    badInitial.objective_hash = stableHash(badInitialInput.objective)
    badInitial.requested_by = badInitialInput.requested_by
    badInitial.occurred_at = "2026-01-01T00:00:08.000Z"
    const badInitialCheckpoint = badInitial.initial_checkpoint as Record<string, unknown>
    badInitialCheckpoint.investigation_id = "other_investigation"
    badInitialCheckpoint.checkpoint_sequence = 1
    badInitialCheckpoint.previous_checkpoint_id = "previous_checkpoint"
    badInitialCheckpoint.previous_checkpoint_hash = "previous_hash"
    badInitialCheckpoint.checkpoint_hash = stableHash({ ...badInitialCheckpoint, checkpoint_hash: "" })
    badInitial.event_payload_hash = journalPayloadHash(badInitial)
    await store.append(badInitial as Parameters<EventStore["append"]>[0])
    const badModelStepInput = baseInvestigation({ investigation_id: "inv_bad_model_step_base", objective: "bad model step base" })
    const badModelStepRun = await service.createObserver(badModelStepInput)
    await badModelStepRun.observer.onStarted(durableStartedSnapshot(badModelStepInput, 7, "inv_bad_model_step_base") as Parameters<typeof badModelStepRun.observer.onStarted>[0])
    service.release(badModelStepRun)
    const badModelStepCheckpoint = await service.latestCheckpoint("inv_bad_model_step_base")
    expect(badModelStepCheckpoint).toBeDefined()
    const badModelStep = {
      kind: "runtime_commander_investigation_model_step_started",
      schema_version: 1,
      investigation_id: "inv_bad_model_step_base",
      journal_sequence: 1,
      turn_index: 1,
      model_request_id: "model_request_bad_base",
      provider_id: "fixture",
      provider_kind: "unknown",
      model_id: "cloud-long-context",
      tool_protocol: "native",
      base_checkpoint_id: "wrong_checkpoint",
      base_checkpoint_sequence: 99,
      base_checkpoint_hash: "wrong_hash",
      working_set_hash: "working_set_hash_7",
      context_hash: "context_hash_bad_base",
      input_bytes: 128,
      estimated_input_tokens: 32,
      loaded_tool_refs: [],
      provider_request_count_before: 0,
      external_api_audit_count_before: 0,
      started_at: "2026-01-01T00:00:09.000Z",
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:09.000Z",
      event_payload_hash: "",
    }
    badModelStep.event_payload_hash = journalPayloadHash(badModelStep)
    await store.append(badModelStep as Parameters<EventStore["append"]>[0])
    const missingTimestampModelStepInput = baseInvestigation({ investigation_id: "inv_model_step_missing_time", objective: "missing model step time" })
    const missingTimestampModelStepRun = await service.createObserver(missingTimestampModelStepInput)
    await missingTimestampModelStepRun.observer.onStarted(durableStartedSnapshot(missingTimestampModelStepInput, 8, "inv_model_step_missing_time") as Parameters<typeof missingTimestampModelStepRun.observer.onStarted>[0])
    const missingTimestampCheckpoint = await service.latestCheckpoint("inv_model_step_missing_time")
    service.release(missingTimestampModelStepRun)
    const missingTimestampModelStep = {
      kind: "runtime_commander_investigation_model_step_started",
      schema_version: 1,
      investigation_id: "inv_model_step_missing_time",
      journal_sequence: 1,
      turn_index: 1,
      model_request_id: "model_request_missing_time",
      provider_id: "fixture",
      provider_kind: "unknown",
      model_id: "cloud-long-context",
      tool_protocol: "native",
      base_checkpoint_id: missingTimestampCheckpoint!.checkpoint_id,
      base_checkpoint_sequence: missingTimestampCheckpoint!.checkpoint_sequence,
      base_checkpoint_hash: missingTimestampCheckpoint!.checkpoint_hash,
      working_set_hash: "working_set_hash_8",
      context_hash: "context_hash_missing_time",
      input_bytes: 128,
      estimated_input_tokens: 32,
      loaded_tool_refs: [],
      provider_request_count_before: 0,
      external_api_audit_count_before: 0,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:10.000Z",
      event_payload_hash: "",
    }
    missingTimestampModelStep.event_payload_hash = journalPayloadHash(missingTimestampModelStep)
    await store.append(missingTimestampModelStep as Parameters<EventStore["append"]>[0])
    const doublePendingModelStepInput = baseInvestigation({ investigation_id: "inv_double_pending_model_step", objective: "double pending model step" })
    const doublePendingRun = await service.createObserver(doublePendingModelStepInput)
    await doublePendingRun.observer.onStarted(durableStartedSnapshot(doublePendingModelStepInput, 13, "inv_double_pending_model_step") as Parameters<typeof doublePendingRun.observer.onStarted>[0])
    const doublePendingCheckpoint = await service.latestCheckpoint("inv_double_pending_model_step")
    service.release(doublePendingRun)
    const firstPendingModelStep = {
      kind: "runtime_commander_investigation_model_step_started",
      schema_version: 1,
      investigation_id: "inv_double_pending_model_step",
      journal_sequence: 1,
      turn_index: 1,
      model_request_id: "model_request_first_pending",
      provider_id: "fixture",
      provider_kind: "unknown",
      model_id: "cloud-long-context",
      tool_protocol: "native",
      base_checkpoint_id: doublePendingCheckpoint!.checkpoint_id,
      base_checkpoint_sequence: doublePendingCheckpoint!.checkpoint_sequence,
      base_checkpoint_hash: doublePendingCheckpoint!.checkpoint_hash,
      working_set_hash: "working_set_hash_double_pending",
      context_hash: "context_hash_first_pending",
      input_bytes: 128,
      estimated_input_tokens: 32,
      loaded_tool_refs: [],
      provider_request_count_before: 0,
      external_api_audit_count_before: 0,
      started_at: "2026-01-01T00:00:10.500Z",
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:10.500Z",
      event_payload_hash: "",
    }
    firstPendingModelStep.event_payload_hash = journalPayloadHash(firstPendingModelStep)
    await store.append(firstPendingModelStep as Parameters<EventStore["append"]>[0])
    const secondPendingModelStep = {
      ...firstPendingModelStep,
      journal_sequence: 2,
      model_request_id: "model_request_second_pending",
      context_hash: "context_hash_second_pending",
      started_at: "2026-01-01T00:00:10.750Z",
      occurred_at: "2026-01-01T00:00:10.750Z",
      event_payload_hash: "",
    }
    secondPendingModelStep.event_payload_hash = journalPayloadHash(secondPendingModelStep)
    await store.append(secondPendingModelStep as Parameters<EventStore["append"]>[0])
    const wrongOwnerCheckpointInput = baseInvestigation({ investigation_id: "inv_wrong_owner_checkpoint", objective: "wrong owner checkpoint" })
    const wrongOwnerCheckpointRun = await service.createObserver(wrongOwnerCheckpointInput)
    await wrongOwnerCheckpointRun.observer.onStarted(durableStartedSnapshot(wrongOwnerCheckpointInput, 9, "inv_wrong_owner_checkpoint") as Parameters<typeof wrongOwnerCheckpointRun.observer.onStarted>[0])
    const wrongOwnerInitial = await service.latestCheckpoint("inv_wrong_owner_checkpoint")
    service.release(wrongOwnerCheckpointRun)
    const wrongOwnerCheckpoint = {
      ...wrongOwnerInitial!,
      checkpoint_id: "wrong_owner_checkpoint",
      investigation_id: "other_investigation",
      checkpoint_sequence: 1,
      checkpoint_kind: "turn_complete" as const,
      previous_checkpoint_id: wrongOwnerInitial!.checkpoint_id,
      previous_checkpoint_hash: wrongOwnerInitial!.checkpoint_hash,
    }
    wrongOwnerCheckpoint.checkpoint_hash = stableHash({ ...wrongOwnerCheckpoint, checkpoint_hash: "" })
    const wrongOwnerCheckpointEvent = {
      kind: "runtime_commander_investigation_checkpointed",
      schema_version: 1,
      investigation_id: "inv_wrong_owner_checkpoint",
      journal_sequence: 1,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:11.000Z",
      checkpoint: wrongOwnerCheckpoint,
      event_payload_hash: "",
    }
    wrongOwnerCheckpointEvent.event_payload_hash = journalPayloadHash(wrongOwnerCheckpointEvent)
    await store.append(wrongOwnerCheckpointEvent as Parameters<EventStore["append"]>[0])
    const postTerminalInput = baseInvestigation({ investigation_id: "inv_post_terminal_checkpoint", objective: "post terminal checkpoint" })
    const postTerminalRun = await service.createObserver(postTerminalInput)
    await postTerminalRun.observer.onStarted(durableStartedSnapshot(postTerminalInput, 5, "inv_post_terminal_checkpoint") as Parameters<typeof postTerminalRun.observer.onStarted>[0])
    const postTerminalInitial = await service.latestCheckpoint("inv_post_terminal_checkpoint")
    expect(postTerminalInitial).toBeDefined()
    const postTerminalBaseResult: Awaited<ReturnType<RuntimeServer["runCommanderInvestigationInMemory"]>> = {
      investigation_id: "inv_post_terminal_checkpoint",
      status: "final" as const,
      stop_reason: "model_final" as const,
      phase: "proposal_investigation" as const,
      objective_preview: "post terminal checkpoint",
      provider_id: "fixture",
      provider_kind: "unknown",
      model_id: "cloud-long-context",
      tool_protocol: "native" as const,
      final_summary: "finished before corrupt checkpoint",
      bootstrap_id: "bootstrap_5",
      bootstrap_hash: "bootstrap_hash_5",
      context_budget_id: "ctx_5",
      budget: postTerminalInitial!.budget,
      model_turn_count: 1,
      provider_request_count: 1,
      tool_call_count: 0,
      tool_search_call_count: 0,
      loaded_tool_ids: [],
      loaded_schema_bytes: 0,
      loaded_schema_tokens: 0,
      cumulative_tool_result_bytes: 0,
      evidence: [],
      turn_summaries: [],
      omitted_evidence_count: 0,
      omitted_turn_count: 0,
      provider_audit: { audit_required: false, transport_kind: "none" as const, connector_ids: [], provider_request_count: 0, external_api_audit_event_count: 0, successful_audit_count: 0, failed_audit_count: 0, audit_request_ids: [], audit_event_kinds: [], omitted_request_id_count: 0, all_provider_requests_audited: true, request_body_persisted: false, response_body_persisted: false, credentials_persisted: false, warnings: [] },
      blockers: [],
      warnings: [],
      started_at: "2026-01-01T00:00:05.000Z",
      completed_at: "2026-01-01T00:00:06.000Z",
      duration_ms: 1000,
      investigation_event_count: 1,
      in_memory_only: false,
      transcript_persisted: false as const,
      working_set_persisted: true,
      investigation_events_appended: true,
      external_api_audit_events_appended: 0,
      events_appended: true,
      files_written: false as const,
      research_db_written: false as const,
      mission_mutated: false as const,
      proposal_mutated: false as const,
      opencode_action_performed: false as const,
      github_action_performed: false as const,
      mcp_called: false as const,
      external_research_called: false as const,
      result_hash: stableHash({ result: "post_terminal" }),
    }
    await service.finish(postTerminalRun, postTerminalBaseResult)
    service.release(postTerminalRun)
    await store.append({
      kind: "runtime_commander_investigation_checkpointed",
      schema_version: 1,
      investigation_id: "inv_post_terminal_checkpoint",
      journal_sequence: 2,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:07.000Z",
      checkpoint: { ...postTerminalInitial!, checkpoint_id: "post_terminal_bad_checkpoint", checkpoint_sequence: 1, previous_checkpoint_id: postTerminalInitial!.checkpoint_id, previous_checkpoint_hash: postTerminalInitial!.checkpoint_hash },
      event_payload_hash: "bad_post_terminal_checkpoint_payload_hash",
    } as Parameters<EventStore["append"]>[0])

    const malformed = await service.get("inv_malformed_unsupported")
    expect(malformed).toMatchObject({
      investigation_id: "inv_malformed_unsupported",
      projection_status: "unsupported_version",
      recovery_state: "no_checkpoint_resume_not_implemented",
    })
    expect(malformed?.integrity_errors.join("\n")).toContain("malformed started payload")
    const malformedCheckpoint = await service.get("inv_malformed_checkpoint")
    expect(malformedCheckpoint).toMatchObject({ investigation_id: "inv_malformed_checkpoint", projection_status: "corrupt", checkpoint_available: true })
    expect(malformedCheckpoint?.integrity_errors.join("\n")).toContain("malformed checkpoint payload")
    expect(await service.latestCheckpoint("inv_malformed_checkpoint")).toEqual(validInitialCheckpoint)
    expect(await service.getCheckpoint("bad_checkpoint")).toBeUndefined()
    const malformedTerminal = await service.get("inv_malformed_terminal")
    expect(malformedTerminal).toMatchObject({ projection_status: "corrupt", status: "running", recovery_state: "no_checkpoint_resume_not_implemented" })
    expect(malformedTerminal?.integrity_errors.join("\n")).toContain("malformed terminal payload")
    const corruptTerminal = await service.get("inv_corrupt_terminal")
    expect(corruptTerminal).toMatchObject({ projection_status: "corrupt", status: "running", recovery_state: "checkpoint_available_resume_not_implemented", checkpoint_available: true })
    expect(corruptTerminal?.integrity_errors.join("\n")).toContain("terminal hash mismatch")
    const nestedBadTerminal = await service.get("inv_nested_bad_terminal")
    expect(nestedBadTerminal).toMatchObject({ projection_status: "corrupt", status: "running", recovery_state: "checkpoint_available_resume_not_implemented", checkpoint_available: true })
    expect(nestedBadTerminal?.integrity_errors.join("\n")).toContain("malformed terminal payload")
    const wrongOwnerTerminalRecord = await service.get("inv_wrong_owner_terminal")
    expect(wrongOwnerTerminalRecord).toMatchObject({ projection_status: "corrupt", status: "running", recovery_state: "checkpoint_available_resume_not_implemented", checkpoint_available: true })
    expect(wrongOwnerTerminalRecord?.integrity_errors.join("\n")).toContain("terminal investigation_id mismatch")
    const wrongSequenceTerminalRecord = await service.get("inv_wrong_terminal_sequence")
    expect(wrongSequenceTerminalRecord).toMatchObject({ projection_status: "corrupt", status: "running", recovery_state: "checkpoint_available_resume_not_implemented", checkpoint_available: true })
    expect(wrongSequenceTerminalRecord?.integrity_errors.join("\n")).toContain("terminal last-checkpoint reference mismatch")
    const checkpointWithoutBoundaryRecord = await service.get("inv_projected_checkpoint_without_boundary")
    expect(checkpointWithoutBoundaryRecord).toMatchObject({ projection_status: "corrupt", latest_checkpoint_id: checkpointWithoutBoundaryInitial!.checkpoint_id, checkpoint_available: true })
    expect(checkpointWithoutBoundaryRecord?.integrity_errors.join("\n")).toContain("checkpoint missing model-step boundary")
    expect(await service.getCheckpoint("checkpoint_without_model_step_boundary")).toBeUndefined()
    const badInitialRecord = await service.get("inv_bad_initial_chain")
    expect(badInitialRecord).toMatchObject({ projection_status: "corrupt", checkpoint_available: false, recovery_state: "no_checkpoint_resume_not_implemented" })
    expect(badInitialRecord?.integrity_errors.join("\n")).toContain("initial checkpoint investigation_id mismatch")
    expect(await service.latestCheckpoint("inv_bad_initial_chain")).toBeUndefined()
    const badModelStepRecord = await service.get("inv_bad_model_step_base")
    expect(badModelStepRecord).toMatchObject({ projection_status: "corrupt", uncertain_provider_outcome: true, recovery_state: "uncertain_provider_outcome_resume_not_implemented" })
    expect(badModelStepRecord?.integrity_errors.join("\n")).toContain("model-step base checkpoint mismatch")
    const missingTimestampModelStepRecord = await service.get("inv_model_step_missing_time")
    expect(missingTimestampModelStepRecord).toMatchObject({ projection_status: "corrupt", checkpoint_available: true, uncertain_provider_outcome: false })
    expect(missingTimestampModelStepRecord?.integrity_errors.join("\n")).toContain("malformed model-step payload")
    const doublePendingModelStepRecord = await service.get("inv_double_pending_model_step")
    expect(doublePendingModelStepRecord).toMatchObject({
      projection_status: "corrupt",
      checkpoint_available: true,
      uncertain_provider_outcome: true,
      pending_model_request_id: "model_request_first_pending",
    })
    expect(doublePendingModelStepRecord?.integrity_errors.join("\n")).toContain("model-step started while previous model step pending")
    const wrongOwnerCheckpointRecord = await service.get("inv_wrong_owner_checkpoint")
    expect(wrongOwnerCheckpointRecord).toMatchObject({ projection_status: "corrupt", latest_checkpoint_id: wrongOwnerInitial!.checkpoint_id })
    expect(wrongOwnerCheckpointRecord?.integrity_errors.join("\n")).toContain("checkpoint investigation_id mismatch")
    expect(await service.getCheckpoint("wrong_owner_checkpoint")).toBeUndefined()
    const postTerminal = await service.get("inv_post_terminal_checkpoint")
    expect(postTerminal).toMatchObject({ projection_status: "corrupt", status: "final", recovery_state: "not_required", latest_checkpoint_id: postTerminalInitial!.checkpoint_id })
    expect(postTerminal?.integrity_errors.join("\n")).toContain("investigation event appears after terminal event")
    expect(await service.latestCheckpoint("inv_post_terminal_checkpoint")).toEqual(postTerminalInitial)
    expect(await service.getCheckpoint("post_terminal_bad_checkpoint")).toBeUndefined()
    const valid = await service.get("inv_valid_after_malformed")
    expect(valid).toMatchObject({ investigation_id: "inv_valid_after_malformed", projection_status: "ready", checkpoint_available: true })
    const summary = await service.summary()
    expect(summary).toMatchObject({ total: 16, running_count: 15, terminal_count: 1, final_count: 1, checkpoint_available_count: 13, uncertain_provider_outcome_count: 2, corrupt_count: 13 })
  })

  test("durable journal pending model-step start advances running record updated_at", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-durable-pending-updated-"))
    const service = new CommanderInvestigationJournalService({
      eventStore: new EventStore(join(projectDir, ".nxl", "events.jsonl")),
      now: () => new Date("2026-01-01T00:00:30.000Z"),
    })
    const input = baseInvestigation({ investigation_id: "inv_pending_updated_at", objective: "pending step updated at" })
    const run = await service.createObserver(input)
    await run.observer.onStarted(durableStartedSnapshot(input, 0, "inv_pending_updated_at") as Parameters<typeof run.observer.onStarted>[0])
    await run.observer.onModelStepStarted({
      investigation_id: "inv_pending_updated_at",
      input,
      turn_index: 1,
      model_request_id: "model_request_pending_updated_at",
      tool_protocol: "native",
      working_set_hash: "working_hash_pending",
      context_hash: "context_hash_pending",
      input_bytes: 512,
      estimated_input_tokens: 128,
      loaded_tools: [],
      provider_request_count_before: 0,
      external_api_audit_count_before: 0,
      started_at: "2026-01-01T00:00:45.000Z",
    })
    service.release(run)
    const record = await service.get("inv_pending_updated_at")
    expect(record).toMatchObject({
      updated_at: "2026-01-01T00:00:45.000Z",
      pending_model_request_id: "model_request_pending_updated_at",
      uncertain_provider_outcome: true,
      recovery_state: "uncertain_provider_outcome_resume_not_implemented",
    })
  })

  test("durable Commander investigations are searchable through typed operational memory projection", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-operational-memory-"))
    await writeApprovedSpec(projectDir)
    const server = new RuntimeServer({
      projectDir,
      adapter: new FakeOpenCodeAdapter(),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "completed durable objective summary" }]),
    })
    servers.push({ stop: () => server.shutdown() })
    await server.start()
    await server.runCommanderInvestigationDurable(baseInvestigation({ investigation_id: "inv_searchable", objective: "Find prior durable investigation needle", session_id: "session_search", mission_id: "mission_search" }))
    const search = await server.searchCommanderOperationalMemory({ query: "durable investigation needle", source_kinds: ["commander_investigation"], session_id: "session_search" })
    expect(search).toMatchObject({ status: "ready", events_appended: false })
    expect(search.result?.candidates).toEqual([expect.objectContaining({ source_kind: "commander_investigation", source_id: "inv_searchable", pointer_only: true, session_id: "session_search" })])
    const finalSearch = await server.searchCommanderOperationalMemory({ query: "completed durable objective summary", source_kinds: ["commander_investigation"], session_id: "session_search" })
    expect(finalSearch.result?.candidates).toEqual([expect.objectContaining({ source_kind: "commander_investigation", source_id: "inv_searchable" })])

    const service = new CommanderInvestigationJournalService({ eventStore: server.eventStore })
    const evidenceInput = baseInvestigation({ investigation_id: "inv_searchable_evidence", objective: "Generic durable investigation objective", session_id: "session_search" })
    const evidenceRun = await service.createObserver(evidenceInput)
    await evidenceRun.observer.onStarted(durableStartedSnapshot(evidenceInput, 0, "inv_searchable_evidence") as Parameters<typeof evidenceRun.observer.onStarted>[0])
    const baseResult = await server.runCommanderInvestigationInMemory(evidenceInput)
    await service.finish(evidenceRun, {
      ...baseResult,
      investigation_id: "inv_searchable_evidence",
      final_summary: "Generic final summary",
      evidence: [{ ...evidenceCard("evidence_rare_amber"), title: "Rare amber conclusion", summary_preview: "rare amber finding lives only in evidence preview" }],
    })
    service.release(evidenceRun)
    const evidenceSearch = await server.searchCommanderOperationalMemory({ query: "rare amber finding", source_kinds: ["commander_investigation"], session_id: "session_search" })
    expect(evidenceSearch.result?.candidates).toEqual([expect.objectContaining({ source_kind: "commander_investigation", source_id: "inv_searchable_evidence" })])

    const corruptInput = baseInvestigation({ investigation_id: "inv_corrupt_searchable", objective: "Generic corrupt durable objective", session_id: "session_search" })
    const corruptRun = await service.createObserver(corruptInput)
    await corruptRun.observer.onStarted(durableStartedSnapshot(corruptInput, 1, "inv_corrupt_searchable") as Parameters<typeof corruptRun.observer.onStarted>[0])
    await service.finish(corruptRun, {
      ...baseResult,
      investigation_id: "inv_corrupt_searchable",
      final_summary: "quarantinedxyz finding must stay quarantined",
      evidence: [{ ...evidenceCard("evidence_corrupt_searchable"), title: "Corrupt searchable evidence", summary_preview: "quarantinedxyz evidence preview must stay quarantined" }],
    })
    service.release(corruptRun)
    const corruptInitial = await service.latestCheckpoint("inv_corrupt_searchable")
    expect(corruptInitial).toBeDefined()
    await server.eventStore.append({
      kind: "runtime_commander_investigation_checkpointed",
      schema_version: 1,
      investigation_id: "inv_corrupt_searchable",
      journal_sequence: 2,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:07.000Z",
      checkpoint: { ...corruptInitial!, checkpoint_id: "corrupt_searchable_post_terminal_checkpoint", checkpoint_sequence: 1, previous_checkpoint_id: corruptInitial!.checkpoint_id, previous_checkpoint_hash: corruptInitial!.checkpoint_hash },
      event_payload_hash: "bad_corrupt_searchable_post_terminal_payload_hash",
    } as Parameters<EventStore["append"]>[0])
    const corruptRecord = await service.get("inv_corrupt_searchable")
    expect(corruptRecord).toMatchObject({ projection_status: "corrupt" })
    const corruptSearch = await server.searchCommanderOperationalMemory({ query: "quarantinedxyz", source_kinds: ["commander_investigation"], session_id: "session_search" })
    expect(corruptSearch.result?.candidates).toEqual([])
    expect(JSON.stringify(search)).not.toContain("runtime_commander_investigation_started")
  })

  test("operational memory search includes Commander investigations before the global scan cap", async () => {
    const filler = Array.from({ length: 800 }, (_, index) => ({
      source_kind: "wake_supervision",
      source_id: `wake_filler_${String(index).padStart(3, "0")}`,
      label: `Wake filler ${index}`,
      status: "ready",
      summary_preview: "wake scheduler unrelated filler",
      occurred_at: "2026-01-01T00:00:00.000Z",
      fields: { phase: "mid_mission_supervision" },
    }))
    const service = new CommanderOperationalMemorySearchService({
      collectRecords: async () => [
        ...filler,
        {
          source_kind: "commander_investigation",
          source_id: "inv_scan_cap_visible",
          label: "Commander investigation",
          status: "final",
          summary_preview: "durable investigation scan cap needle",
          occurred_at: "2026-01-01T00:00:01.000Z",
          fields: { phase: "proposal_investigation", recovery_state: "not_required" },
        },
      ],
    })
    const search = await service.search({ query: "scan cap needle" })
    expect(search).toMatchObject({ status: "ready", scanned_items: 800 })
    expect(search.result?.candidates).toEqual([expect.objectContaining({ source_kind: "commander_investigation", source_id: "inv_scan_cap_visible" })])
    expect(search.warnings).toContain("operational memory scan capped at 800 filtered typed records")
  })

  test("durable shutdown drains terminal journal event before runtime shutdown", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-shutdown-drain-"))
    await writeApprovedSpec(projectDir)
    const server = new RuntimeServer({
      projectDir,
      adapter: new FakeOpenCodeAdapter(),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "late final", delay_ms: 50 }]),
    })
    await server.start()
    const investigation = server.runCommanderInvestigationDurable(baseInvestigation({ investigation_id: "inv_durable_shutdown" }))
    await waitForEventText(projectDir, "runtime_commander_investigation_model_step_started")
    const shutdown = server.shutdown("durable drain")
    const result = await investigation
    await shutdown
    expect(result.investigation_events_appended).toBe(true)
    const kinds = eventKinds(await eventText(projectDir))
    expect(kinds.indexOf("runtime_commander_investigation_finished")).toBeGreaterThan(-1)
    expect(kinds.indexOf("runtime_commander_investigation_finished")).toBeLessThan(kinds.indexOf("runtime_shutdown"))
    expect(kinds[kinds.length - 1]).toBe("runtime_shutdown")
  })

  test("durable shutdown waits for journal observer reservation before runtime shutdown", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-shutdown-observer-race-"))
    await writeApprovedSpec(projectDir)
    const server = new RuntimeServer({
      projectDir,
      adapter: new FakeOpenCodeAdapter(),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "should not run" }]),
    })
    await server.start()
    const store = (server as unknown as { eventStore: EventStore }).eventStore
    const originalReadAll = store.readAll.bind(store)
    let releaseLookup!: () => void
    let lookupEntered!: () => void
    const lookupStarted = new Promise<void>((resolve) => {
      lookupEntered = resolve
    })
    const lookupGate = new Promise<void>((resolve) => {
      releaseLookup = resolve
    })
    let blockedLookup = true
    store.readAll = async () => {
      if (blockedLookup) {
        blockedLookup = false
        lookupEntered()
        await lookupGate
      }
      return originalReadAll()
    }
    const investigation = server.runCommanderInvestigationDurable(baseInvestigation({ investigation_id: "inv_shutdown_before_observer" }))
    await lookupStarted
    const shutdown = server.shutdown("durable observer race")
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(eventKinds(await eventText(projectDir))).not.toContain("runtime_shutdown")
    releaseLookup()
    const result = await investigation
    await shutdown
    expect(result).toMatchObject({ status: "blocked", stop_reason: "provider_preflight_blocked", provider_request_count: 0, investigation_event_count: 0 })
    const kinds = eventKinds(await eventText(projectDir))
    expect(kinds).not.toContain("runtime_commander_investigation_started")
    expect(kinds[kinds.length - 1]).toBe("runtime_shutdown")
  })

  test("durable shutdown timeout fences late journal writes and retains the run lock until the investigation settles", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-shutdown-hung-durable-"))
    await writeApprovedSpec(projectDir)
    const adapter = new LateSettlingCommanderModelStepAdapter()
    const server = new RuntimeServer({
      projectDir,
      adapter: new FakeOpenCodeAdapter(),
      commanderModelStepAdapter: adapter,
    })
    await server.start()
    const investigation = server.runCommanderInvestigationDurable(baseInvestigation({ investigation_id: "inv_hung_durable_shutdown" }))
    await waitForEventText(projectDir, "runtime_commander_investigation_model_step_started")
    await expect(server.shutdown("hung durable drain")).rejects.toThrow("run lock retained")
    const eventsAtFailedShutdown = await eventText(projectDir)
    expect(eventKinds(eventsAtFailedShutdown)).not.toContain("runtime_shutdown")
    adapter.resolve("late final after shutdown")
    const result = await investigation
    expect(result).toMatchObject({ status: "failed", stop_reason: "persistence_failed" })
    const eventsAfterLateSettle = await eventText(projectDir)
    expect(eventsAfterLateSettle).toBe(eventsAtFailedShutdown)
    expect(eventKinds(eventsAfterLateSettle)).not.toContain("runtime_commander_investigation_finished")
    await server.shutdown("hung durable drain after settle")
    const finalEvents = await eventText(projectDir)
    const finalKinds = eventKinds(finalEvents)
    expect(finalKinds[finalKinds.length - 1]).toBe("runtime_shutdown")
    const next = new RuntimeServer({ projectDir, adapter: new FakeOpenCodeAdapter(), commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "after hung drain" }]) })
    await next.start()
    servers.push({ stop: () => next.shutdown() })
    expect(next.previewCommanderInvestigationProviderReadiness().runtime_started).toBe(true)
  })

  test("durable shutdown fails closed while a journal append is in flight", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-shutdown-inflight-journal-"))
    await writeApprovedSpec(projectDir)
    const server = new RuntimeServer({
      projectDir,
      adapter: new FakeOpenCodeAdapter(),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "terminal append waits" }]),
    })
    const store = server.eventStore
    const originalAppend = store.append.bind(store)
    let terminalAppendStarted!: () => void
    let releaseTerminalAppend!: () => void
    const terminalAppendStartedPromise = new Promise<void>((resolve) => {
      terminalAppendStarted = resolve
    })
    const terminalAppendGate = new Promise<void>((resolve) => {
      releaseTerminalAppend = resolve
    })
    store.append = async (event) => {
      if ((event as { kind?: string }).kind === "runtime_commander_investigation_finished") {
        terminalAppendStarted()
        await terminalAppendGate
      }
      return originalAppend(event)
    }
    await server.start()
    const investigation = server.runCommanderInvestigationDurable(baseInvestigation({ investigation_id: "inv_inflight_journal_shutdown", objective: "in-flight terminal journal append" }))
    await terminalAppendStartedPromise
    await expect(server.shutdown("in-flight durable journal")).rejects.toThrow("durable investigation persistence did not settle")
    const eventsBeforeRelease = await eventText(projectDir)
    expect(eventKinds(eventsBeforeRelease)).not.toContain("runtime_shutdown")
    expect(server.previewCommanderInvestigationProviderReadiness().run_lock_held).toBe(true)
    releaseTerminalAppend()
    const result = await investigation
    expect(result).toMatchObject({ status: "final", stop_reason: "model_final" })
    await server.shutdown("after in-flight durable journal")
    const kinds = eventKinds(await eventText(projectDir))
    expect(kinds.indexOf("runtime_commander_investigation_finished")).toBeGreaterThan(-1)
    expect(kinds.indexOf("runtime_commander_investigation_finished")).toBeLessThan(kinds.indexOf("runtime_shutdown"))
  })
})

function modelTool(toolId: string) {
  const descriptor = COMMANDER_TOOL_REGISTRY.find((tool) => tool.tool_id === toolId)
  if (!descriptor) throw new Error(`missing descriptor ${toolId}`)
  return commanderToolSchemaFromDescriptor(descriptor)
}

function connector(id: string, baseUrl: string, overrides: { allowLocalHttp?: boolean; allowedHosts?: string[]; maxResponseBytes?: number; timeoutMs?: number } = {}) {
  return {
    connector_id: id,
    title: "OpenAI-compatible connector",
    base_url: baseUrl,
    allowed_hosts: overrides.allowedHosts ?? [new URL(baseUrl).hostname],
    allowed_methods: ["POST" as const],
    credential_refs: [{ name: "model-key", source: "env" as const, env_name: "NXL_TEST_MODEL_KEY", inject_as: "header" as const, target_name: "Authorization", prefix: "Bearer " }],
    timeout_ms: overrides.timeoutMs ?? 5000,
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

function providerConfig(overrides: Record<string, unknown> = {}) {
  return {
    transport_kind: "openai_compatible_connector",
    provider_id: "fixture_provider",
    provider_kind: "openai_compatible",
    connector_id: "openai-test",
    model_id: "fixture-model",
    enabled_phases: ["proposal_investigation", "general_read"],
    timeout_ms: 5000,
    max_request_bytes: 65_536,
    max_response_bytes: 65_536,
    max_context_bytes: 65_536,
    max_output_tokens: 1024,
    supports_tools: true,
    supports_json_schema: "unknown",
    supports_long_context: "unknown",
    supports_local_execution: false,
    ...overrides,
  }
}

function providerEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NXL_COMMANDER_INVESTIGATION_PROVIDER_ENABLED: "1",
    NXL_COMMANDER_INVESTIGATION_TRANSPORT_KIND: "openai_compatible_connector",
    NXL_COMMANDER_INVESTIGATION_PROVIDER_ID: "fixture_provider",
    NXL_COMMANDER_INVESTIGATION_PROVIDER_KIND: "openai_compatible",
    NXL_COMMANDER_INVESTIGATION_CONNECTOR_ID: "openai-test",
    NXL_COMMANDER_INVESTIGATION_MODEL_ID: "fixture-model",
    NXL_COMMANDER_INVESTIGATION_ENABLED_PHASES: "general_read, proposal_investigation",
    NXL_COMMANDER_INVESTIGATION_TIMEOUT_MS: "5000",
    NXL_COMMANDER_INVESTIGATION_MAX_REQUEST_BYTES: "65536",
    NXL_COMMANDER_INVESTIGATION_MAX_RESPONSE_BYTES: "65536",
    NXL_COMMANDER_INVESTIGATION_MAX_CONTEXT_BYTES: "65536",
    NXL_COMMANDER_INVESTIGATION_MAX_OUTPUT_TOKENS: "1024",
    NXL_COMMANDER_INVESTIGATION_SUPPORTS_TOOLS: "1",
    NXL_COMMANDER_INVESTIGATION_SUPPORTS_JSON_SCHEMA: "unknown",
    NXL_COMMANDER_INVESTIGATION_SUPPORTS_LONG_CONTEXT: "unknown",
    NXL_COMMANDER_INVESTIGATION_SUPPORTS_LOCAL_EXECUTION: "0",
    ...overrides,
  }
}

function providerLaunchEnv(baseUrl: string) {
  return {
    ...providerEnv(),
    NXL_EXTERNAL_API_CONNECTORS_JSON: JSON.stringify([connector("openai-test", baseUrl, { allowLocalHttp: baseUrl.startsWith("http://"), allowedHosts: [new URL(baseUrl).hostname], maxResponseBytes: 65_536 })]),
    NXL_TEST_MODEL_KEY: "real-provider-key",
  }
}

function configuredProviderRuntimeServer(projectDir: string, options: { adapter?: FakeOpenCodeAdapter; transport?: ExternalApiTransport } = {}) {
  return new RuntimeServer({
    projectDir,
    adapter: options.adapter ?? new FakeOpenCodeAdapter(),
    commanderInvestigationProviderConfig: validateCommanderInvestigationProviderConfig(providerConfig()),
    externalApiConnectors: [connector("openai-test", "https://api.example.test/v1")],
    externalApiTransport: options.transport ?? new FakeExternalApiTransport([{ status_code: 200, body: chatCompletionText("configured final") }]),
    externalApiEnv: { NXL_TEST_MODEL_KEY: "real-provider-key" },
    externalApiRequestId: (() => {
      let index = 0
      return () => {
        index += 1
        return `api_configured_${index}`
      }
    })(),
  })
}

class DelayedStartOpenCodeAdapter extends FakeOpenCodeAdapter {
  startRequested = false
  private release?: () => void

  override async startSession(sessionSpec: Parameters<FakeOpenCodeAdapter["startSession"]>[0]): Promise<void> {
    this.startRequested = true
    await new Promise<void>((resolve) => {
      this.release = resolve
    })
    await super.startSession(sessionSpec)
  }

  releaseStart(): void {
    this.release?.()
  }
}

function delayedAbortTransport(released: Promise<void>): ExternalApiTransport & { requests: number; aborted: boolean } {
  const transport: ExternalApiTransport & { requests: number; aborted: boolean } = {
    requests: 0,
    aborted: false,
    async request(input) {
      transport.requests += 1
      await new Promise<void>((resolve) => {
        const onAbort = () => {
          transport.aborted = true
          input.abort_signal?.removeEventListener("abort", onAbort)
          resolve()
        }
        if (input.abort_signal?.aborted) onAbort()
        else input.abort_signal?.addEventListener("abort", onAbort, { once: true })
      })
      await released
      throw new Error("external API request cancelled")
    },
  }
  return transport
}

function minimalTestBootstrap() {
  return {
    bootstrap_id: "bootstrap_provider_audit_test",
    phase: "proposal_investigation" as const,
    objective_preview: "provider audit test",
    authority_kernel: "authority kernel",
    continuity_kind: "summary" as const,
    readiness: "ready",
    current_project_summary: "project",
    open_loops: [],
    source_refs: [],
    blockers: [],
    warnings: [],
    estimated_bytes: 100,
    estimated_tokens: 25,
    bootstrap_hash: "bootstrap_hash",
  }
}

function controllerWithAuditMetadata(provider_metadata: Record<string, unknown>, text: string) {
  return controllerWithAuditAdapter(new ScriptedCommanderModelStepAdapter([{ status: "final", text, provider_metadata }]))
}

function interruptedAdapter(input: { status: "cancelled" | "failed"; error: string; provider_metadata: Record<string, unknown>; abortController?: AbortController; delay_ms?: number }): CommanderModelStepAdapter {
  return {
    adapter_id: "interrupted-test",
    adapter_version: "interrupted-test",
    supports_streaming: false,
    supports_native_tools: true,
    supports_json_fallback: true,
    supports_structured_output: true,
    supports_abort_signal: true,
    supports_usage: true,
    supports_openai_compatible: true,
    async executeOneStep(request: CommanderModelStepRequest): Promise<CommanderModelStepResult> {
      if (input.delay_ms) await new Promise((resolve) => setTimeout(resolve, input.delay_ms))
      input.abortController?.abort(new Error("operator cancelled"))
      return {
        request_id: request.request_id,
        provider_id: request.provider_id,
        adapter_id: "interrupted-test",
        status: input.status,
        tool_calls: [],
        usage: { provider_reported: false },
        provider_metadata: input.provider_metadata,
        request_count: 1,
        raw_provider_payload_included: false,
        duration_ms: 0,
        warnings: [],
        error: input.error,
        result_hash: `interrupted_${input.status}`,
      }
    },
    async *executeOneStreamedStep(): AsyncIterable<never> {},
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > 1000) throw new Error("condition was not reached before timeout")
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

async function waitForEventText(projectDir: string, needle: string): Promise<void> {
  const started = performance.now()
  while (!(await eventText(projectDir)).includes(needle)) {
    if (performance.now() - started > 1000) throw new Error(`event text did not contain ${needle}`)
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

function controllerWithAuditAdapter(modelAdapter: CommanderModelStepAdapter) {
  return new CommanderInvestigationController({
    modelAdapter,
    toolExecutor: { execute: async () => { throw new Error("tool executor should not run") } },
    toolService: new CommanderToolService({ contextBudgetService: new ContextBudgetService({ registry: new ModelCapabilityRegistry() }) }),
    descriptors: COMMANDER_TOOL_REGISTRY,
    boundToolIds: COMMANDER_BOUND_TOOL_IDS,
    bootstrapService: { compile: async () => minimalTestBootstrap() },
    contextService: new CommanderInvestigationContextService(),
    capabilityRegistry: new ModelCapabilityRegistry(),
    contextBudgetService: new ContextBudgetService({ registry: new ModelCapabilityRegistry() }),
    providerAuditPolicy: { required: true, transport_kind: "external_api_connector", connector_id: "openai-test" },
  })
}

function controllerWithOptionalAuditAdapter(modelAdapter: CommanderModelStepAdapter) {
  return new CommanderInvestigationController({
    modelAdapter,
    toolExecutor: { execute: async () => { throw new Error("tool executor should not run") } },
    toolService: new CommanderToolService({ contextBudgetService: new ContextBudgetService({ registry: new ModelCapabilityRegistry() }) }),
    descriptors: COMMANDER_TOOL_REGISTRY,
    boundToolIds: COMMANDER_BOUND_TOOL_IDS,
    bootstrapService: { compile: async () => minimalTestBootstrap() },
    contextService: new CommanderInvestigationContextService(),
    capabilityRegistry: new ModelCapabilityRegistry(),
    contextBudgetService: new ContextBudgetService({ registry: new ModelCapabilityRegistry() }),
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

class LateSettlingCommanderModelStepAdapter implements CommanderModelStepAdapter {
  readonly adapter_id = "late_settling"
  readonly adapter_version = "test"
  readonly supports_streaming = false as const
  readonly supports_native_tools = true as const
  readonly supports_json_fallback = true as const
  readonly supports_structured_output = true as const
  readonly supports_abort_signal = true as const
  readonly supports_usage = true as const
  readonly supports_openai_compatible = true as const
  private resolveStep!: (text: string) => void
  private readonly step = new Promise<string>((resolve) => {
    this.resolveStep = resolve
  })

  async executeOneStep(): Promise<CommanderModelStepResult> {
    const text = await this.step
    return {
      request_id: "late_settling_request",
      provider_id: "fixture",
      adapter_id: this.adapter_id,
      status: "final",
      text,
      tool_calls: [],
      usage: { provider_reported: false },
      provider_metadata: {},
      request_count: 1,
      raw_provider_payload_included: false,
      duration_ms: 0,
      warnings: [],
      result_hash: stableHash({ text }),
    }
  }

  async *executeOneStreamedStep(): AsyncIterable<never> {}

  resolve(text: string): void {
    this.resolveStep(text)
  }
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

function startStalledInvestigationMockServer() {
  const requests: Array<{ body: unknown; headers: Record<string, string> }> = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const text = await request.text()
      const body = text ? JSON.parse(text) : {}
      requests.push({ body, headers: Object.fromEntries([...request.headers].map(([key, value]) => [key, /authorization/i.test(key) ? "[REDACTED]" : value])) })
      return new Response(new ReadableStream({
        start() {},
      }), { headers: { "content-type": "application/json" } })
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

function durableStartedSnapshot(input: ReturnType<typeof baseInvestigation>, index: number, investigationId: string) {
  const occurred = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
  return {
    investigation_id: investigationId,
    input,
    bootstrap: {
      bootstrap_id: `bootstrap_${index}`,
      phase: input.phase,
      objective_preview: input.objective,
      authority_kernel: "bounded authority",
      continuity_kind: "summary",
      readiness: "ready",
      current_project_summary: "project summary",
      open_loops: [],
      source_refs: [],
      blockers: [],
      warnings: [],
      estimated_bytes: 128,
      estimated_tokens: 32,
      bootstrap_hash: `bootstrap_hash_${index}`,
    },
    budget: {
      budget_id: `budget_${index}`,
      phase: input.phase,
      max_model_turns: 4,
      max_tool_calls: 4,
      max_tool_search_calls: 1,
      max_loaded_schemas: 4,
      max_tool_calls_per_turn: 1,
      max_cumulative_tool_result_bytes: 4096,
      max_wall_time_ms: 10_000,
      max_consecutive_no_progress_turns: 2,
      max_evidence_cards: 4,
      max_turn_summaries: 4,
      max_context_tokens: 4096,
      max_context_bytes: 4096,
      source_profile_id: "profile",
      source_context_budget_id: "context_budget",
      warnings: [],
      budget_hash: `budget_hash_${index}`,
    },
    tool_protocol: "native",
    loaded_tools: [],
    working_set: {
      objective_preview: input.objective,
      phase: input.phase,
      loaded_tool_ids: [],
      evidence_cards: [],
      recent_execution_digests: [],
      recent_load_outcomes: [],
      current_blockers: [],
      current_warnings: [],
      provider_audit: {
        audit_required: false,
        transport_kind: "none",
        connector_ids: [],
        provider_request_count: 0,
        external_api_audit_event_count: 0,
        successful_audit_count: 0,
        failed_audit_count: 0,
        audit_request_ids: [],
        audit_event_kinds: [],
        omitted_request_id_count: 0,
        all_provider_requests_audited: true,
        request_body_persisted: false,
        response_body_persisted: false,
        credentials_persisted: false,
        warnings: [],
      },
      omitted_evidence_count: 0,
      omitted_digest_count: 0,
      omitted_turn_count: 0,
      consecutive_no_progress_turns: 0,
      cumulative_tool_result_bytes: 0,
      model_turn_count: 0,
      tool_call_count: 0,
      tool_search_call_count: 0,
      recent_result_signatures: [],
      working_set_hash: `working_set_hash_${index}`,
    },
    started_at: occurred,
  }
}

function largeEvidenceCard(index: number) {
  return {
    evidence_id: `evidence_large_terminal_${index}`,
    tool_id: "memory.search",
    source_kind: "operational_memory" as const,
    source_id: `source_large_terminal_${index}`,
    title: `Large terminal evidence ${index} ${"t".repeat(220)}`,
    summary_preview: `Large terminal evidence summary ${index} ${"s".repeat(1_200)}`,
    trust_class: "research_projection" as const,
    instruction_semantics: "none" as const,
    source_refs: Array.from({ length: 8 }, (_, refIndex) => ({
      source_kind: "operational_memory",
      source_id: `source_large_terminal_${index}_${refIndex}`,
      label: `Large source ref ${index}-${refIndex} ${"l".repeat(220)}`,
      summary_preview: `Large source summary ${index}-${refIndex} ${"r".repeat(500)}`,
      pointer_only: true as const,
    })),
    content_included: false,
    content_truncated: true,
    observed_at: "2026-01-01T00:00:00.000Z",
    warnings: Array.from({ length: 6 }, (_, warningIndex) => `large warning ${index}-${warningIndex} ${"w".repeat(240)}`),
    evidence_hash: stableHash({ evidence: index }),
  }
}

function journalPayloadHash(event: Record<string, unknown>): string {
  const { event_id: _eventId, timestamp: _timestamp, kind: _kind, ...payload } = event
  return stableHash({ ...payload, event_payload_hash: "" })
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

function eventKinds(text: string): string[] {
  return text.trim().split(/\n+/).filter(Boolean).map((line) => (JSON.parse(line) as { kind?: string }).kind ?? "")
}
