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
  CommanderInvestigationBootstrapService,
  CommanderInvestigationContextService,
  CommanderInvestigationController,
  CommanderInvestigationJournalService,
  CommanderInvestigationRecoveryContinuationBuilder,
  CommanderInvestigationRecoveryExecutionService,
	  CommanderInvestigationRecoveryApprovalService,
	  CommanderInvestigationRecoveryService,
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
	  stableCommanderInvestigationWorkingSet,
	  stableHash,
  toCommanderToolResultMessage,
  validateCommanderInvestigationProviderConfig,
  validateCommanderConnectorModelTransportConfig,
  validateCommanderToolArguments,
  type CommanderInvestigationCheckpointSnapshot,
  type CommanderInvestigationStartedSnapshot,
	  type CommanderInvestigationCheckpoint,
	  type CommanderInvestigationLoadedToolRef,
	  type CommanderInvestigationReplayExchange,
	  type CommanderInvestigationWorkingSet,
	  type CommanderInvestigationTerminalRecord,
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

  test("pre-request gate warnings survive context-budget exits without provider dispatch", async () => {
    const capabilityRegistry = new ModelCapabilityRegistry()
    const contextBudgetService = new ContextBudgetService({ registry: capabilityRegistry })
    const toolService = new CommanderToolService({ contextBudgetService })
    const adapter = new ScriptedCommanderModelStepAdapter([{ status: "final", text: "must not dispatch" }])
    const controller = new CommanderInvestigationController({
      modelAdapter: adapter,
      toolExecutor: { execute: async () => { throw new Error("tool executor should not run") } },
      toolService,
      descriptors: COMMANDER_TOOL_REGISTRY,
      boundToolIds: COMMANDER_BOUND_TOOL_IDS,
      bootstrapService: { compile: async () => minimalTestBootstrap() },
      contextService: {
        build: () => ({
          messages: [],
          tools: [],
          input_bytes: 1,
          estimated_tokens: 1,
          warnings: ["context warning before provider dispatch"],
          blocked: true,
          blockers: ["forced context budget block"],
        }),
      },
      controlGate: {
        check: () => ({
          action: "continue",
          source_kind: "human_control",
          projected_state: "resume_requested",
          checked_at: "2026-01-01T00:00:00.000Z",
          warnings: ["pre-request warning must survive context exit"],
        }),
      },
      capabilityRegistry,
      contextBudgetService,
    })
    const result = await controller.run(baseInvestigation({ session_id: "session_pre_request_warning" }))
    expect(result).toMatchObject({ status: "budget_exhausted", stop_reason: "context_budget_exhausted", provider_request_count: 0 })
    expect(result.warnings).toContain("pre-request warning must survive context exit")
    expect(result.warnings).toContain("context warning before provider dispatch")
    expect(adapter.request_summaries).toHaveLength(0)
  })

  test("pre-request gate warnings survive provider and wall-time early exits without provider dispatch", async () => {
    const capabilityRegistry = new ModelCapabilityRegistry()
    const contextBudgetService = new ContextBudgetService({ registry: capabilityRegistry })
    const baseOptions = {
      modelAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "must not dispatch" }]),
      toolExecutor: { execute: async () => { throw new Error("tool executor should not run") } },
      toolService: new CommanderToolService({ contextBudgetService }),
      descriptors: COMMANDER_TOOL_REGISTRY,
      boundToolIds: COMMANDER_BOUND_TOOL_IDS,
      bootstrapService: { compile: async () => minimalTestBootstrap() },
      contextService: new CommanderInvestigationContextService(),
      capabilityRegistry,
      contextBudgetService,
    }
    let providerGateChecks = 0
    const providerBlocked = new CommanderInvestigationController({
      ...baseOptions,
      controlGate: {
        check: () => ({
          action: "continue",
          source_kind: "human_control",
          checked_at: "2026-01-01T00:00:00.000Z",
          warnings: ["control warning before provider block"],
        }),
      },
      providerGate: {
        check: ({ before }) => {
          providerGateChecks += 1
          return {
            ready: before === "investigation",
            source_kind: "configured_connector",
            checks: [],
            blockers: before === "investigation" ? [] : ["provider blocked before model"],
            warnings: before === "investigation" ? [] : ["provider warning before model"],
            checked_at: "2026-01-01T00:00:01.000Z",
            snapshot_hash: `provider_block_hash_${providerGateChecks}`,
          }
        },
      },
    })
    const blocked = await providerBlocked.run(baseInvestigation({ session_id: "session_provider_warning" }))
    expect(blocked).toMatchObject({ status: "blocked", stop_reason: "provider_preflight_blocked", provider_request_count: 0 })
    expect(blocked.warnings).toContain("control warning before provider block")
    expect(blocked.warnings).toContain("provider warning before model")

    const wallTimed = new CommanderInvestigationController({
      ...baseOptions,
      controlGate: {
        check: () => {
          const started = performance.now()
          while (performance.now() - started < 20) {}
          return {
            action: "continue",
            source_kind: "human_control",
            checked_at: "2026-01-01T00:00:02.000Z",
            warnings: ["control warning before pre-context wall-time exit"],
          }
        },
      },
    })
    const exhausted = await wallTimed.run(baseInvestigation({ session_id: "session_wall_warning", max_wall_time_ms: 10 }))
    expect(exhausted).toMatchObject({ status: "budget_exhausted", stop_reason: "wall_time_exhausted", provider_request_count: 0 })
    expect(exhausted.warnings).toContain("control warning before pre-context wall-time exit")
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

  test("result hash preserves bootstrap semantic differences", async () => {
    const first = await controllerWithBootstrapHash("bootstrap_hash_continuity_a").run(baseInvestigation({ investigation_id: "inv_bootstrap_hash_a", objective: "same objective for bootstrap hash" }))
    const second = await controllerWithBootstrapHash("bootstrap_hash_continuity_b").run(baseInvestigation({ investigation_id: "inv_bootstrap_hash_b", objective: "same objective for bootstrap hash" }))

    expect(first).toMatchObject({ status: "final", final_summary: "same final" })
    expect(second).toMatchObject({ status: "final", final_summary: "same final" })
    expect(first.result_hash).not.toBe(second.result_hash)
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
      investigation_event_count: 6,
    })
    expect(result.events_appended).toBe(true)
    expect(result.result_hash).toBe(inMemory.result_hash)
    expect(result.durability).toMatchObject({ mode: "event_journal", started_persisted: true, initial_checkpoint_persisted: true, terminal_persisted: true, checkpoint_count: 3, resume_supported: false })

    const events = await eventText(projectDir)
    const kinds = eventKinds(events).filter((kind) => kind.startsWith("runtime_commander_investigation_"))
    expect(kinds).toEqual([
      "runtime_commander_investigation_started",
      "runtime_commander_investigation_model_step_started",
      "runtime_commander_investigation_checkpointed",
      "runtime_commander_investigation_model_step_started",
      "runtime_commander_investigation_checkpointed",
      "runtime_commander_investigation_finished",
    ])
    expect(events).toContain("\"journal_sequence\":0")
    expect(events).toContain("\"checkpoint_sequence\":0")
    expect(events).toContain("\"checkpoint_kind\":\"initial\"")
    expect(events).toContain("\"checkpoint_kind\":\"turn_complete\"")
    expect(events).toContain("\"recent_result_signatures\"")
    expect(events).toContain("\"durable_summary_only\":true")
    expect(events).toContain("\"final_output\"")
    expect(events).toContain("\"conclusion\"")
    expect(events).toContain("\"text_persisted\":false")
    expect(events).toContain("\"assistant_text_persisted\":false")
    expect(events).toContain("\"exact_replay_supported\":false")
    expect(events).not.toContain("Durable final summary.")
    expect(events).not.toContain("\"output_tokens\":\"[REDACTED]\"")
    expect(events).not.toContain("durable-secret")
    expect(events).not.toContain("execution_arguments")
    expect(events).not.toContain("raw_provider")
    expect(events).not.toContain("reasoning_content")

    const record = await server.getCommanderInvestigationRecord("inv_durable_journal")
    expect(record).toMatchObject({ status: "final", stop_reason: "model_final", checkpoint_available: true, resume_supported: false, recovery_state: "not_required", projection_status: "ready" })
    expect(record?.investigation_event_count).toBe(6)
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
    expect(checkpoints).toHaveLength(3)
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

  test("durable journal stores content-bearing evidence as pointer summaries only", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-pointer-evidence-"))
    await writeApprovedSpec(projectDir)
    const server = new RuntimeServer({
      projectDir,
      adapter: new FakeOpenCodeAdapter(),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "pointer-only final" }]),
    })
    servers.push({ stop: () => server.shutdown() })
    await server.start()
    const service = new CommanderInvestigationJournalService({ eventStore: server.eventStore })
    const input = baseInvestigation({ investigation_id: "inv_pointer_only_evidence", objective: "Persist only pointer evidence" })
    const run = await service.createObserver(input)
    await run.observer.onStarted(durableStartedSnapshot(input, 0, "inv_pointer_only_evidence") as Parameters<typeof run.observer.onStarted>[0])
    const baseResult = await server.runCommanderInvestigationInMemory(input)
    await service.finish(run, {
      ...baseResult,
      investigation_id: "inv_pointer_only_evidence",
      evidence: [{
        ...evidenceCard("evidence_raw_repo_content"),
        tool_id: "repo.read_lines",
        source_kind: "repository_file" as const,
        source_id: "src/raw-file.ts:1-2",
        title: "Repository file excerpt",
        summary_preview: "const durableRawRepoLine = 'DO_NOT_PERSIST_RAW_REPO_TEXT';",
        source_refs: [{
          source_kind: "repository_file",
          source_id: "src/raw-file.ts",
          label: "src/raw-file.ts",
          summary_preview: "const durableRawRepoLine = 'DO_NOT_PERSIST_RAW_REPO_TEXT';",
          pointer_only: true,
        }],
        content_included: true,
        content_truncated: false,
        evidence_hash: "hash_raw_repo_content",
      }, {
        ...evidenceCard("evidence_raw_repo_symbol"),
        tool_id: "repo.find_symbol",
        source_kind: "repository_symbol" as const,
        source_id: "src/raw-symbol.ts:7",
        title: "Repository symbol match",
        summary_preview: "function durableRawRepoSymbol() { return 'DO_NOT_PERSIST_RAW_SYMBOL_LINE'; }",
        source_refs: [{
          source_kind: "repository_symbol",
          source_id: "src/raw-symbol.ts:7",
          label: "durableRawRepoSymbol",
          summary_preview: "function durableRawRepoSymbol() { return 'DO_NOT_PERSIST_RAW_SYMBOL_LINE'; }",
          pointer_only: true,
        }],
        content_included: false,
        content_truncated: false,
        evidence_hash: "hash_raw_repo_symbol",
      }, {
        ...evidenceCard("evidence_raw_test_manifest"),
        tool_id: "repo.test_manifest",
        source_kind: "test_manifest" as const,
        source_id: "pyproject.toml",
        title: "Test manifest preview",
        summary_preview: "[tool.pytest.ini_options] addopts = '-q DO_NOT_PERSIST_RAW_TEST_CONFIG'",
        source_refs: [{
          source_kind: "test_manifest",
          source_id: "pyproject.toml",
          label: "pyproject.toml",
          summary_preview: "[tool.pytest.ini_options] addopts = '-q DO_NOT_PERSIST_RAW_TEST_CONFIG'",
          pointer_only: true,
        }],
        content_included: false,
        content_truncated: false,
        evidence_hash: "hash_raw_test_manifest",
      }],
    })
    service.release(run)

    const events = await eventText(projectDir)
    expect(events).not.toContain("DO_NOT_PERSIST_RAW_REPO_TEXT")
    expect(events).not.toContain("DO_NOT_PERSIST_RAW_SYMBOL_LINE")
    expect(events).not.toContain("DO_NOT_PERSIST_RAW_TEST_CONFIG")
    expect(events).toContain("repository_file evidence content omitted from durable journal")
    expect(events).toContain("repository_symbol evidence content omitted from durable journal")
    expect(events).toContain("test_manifest evidence content omitted from durable journal")
    expect(events).toContain("hash_raw_repo_content")
    expect(events).toContain("hash_raw_repo_symbol")
    expect(events).toContain("hash_raw_test_manifest")
    const record = await service.get("inv_pointer_only_evidence")
    expect(record?.evidence_previews.join("\n")).not.toContain("DO_NOT_PERSIST_RAW_REPO_TEXT")
    expect(record?.evidence_previews.join("\n")).not.toContain("DO_NOT_PERSIST_RAW_SYMBOL_LINE")
    expect(record?.evidence_previews.join("\n")).not.toContain("DO_NOT_PERSIST_RAW_TEST_CONFIG")
  })

  test("durable journal omits raw model text from replay and terminal summaries", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-model-text-omission-"))
    await writeApprovedSpec(projectDir)
    const server = new RuntimeServer({
      projectDir,
      adapter: new FakeOpenCodeAdapter(),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "const RAW_MODEL_QUOTED_FILE_LINE = 'DO_NOT_PERSIST_MODEL_TEXT';" }]),
    })
    servers.push({ stop: () => server.shutdown() })
    await server.start()
    const service = new CommanderInvestigationJournalService({ eventStore: server.eventStore })
    const input = baseInvestigation({ investigation_id: "inv_model_text_omission", objective: "Persist no raw model quoted text" })
    const run = await service.createObserver(input)
    const startedSnapshot = durableStartedSnapshot(input, 0, "inv_model_text_omission") as Parameters<typeof run.observer.onStarted>[0]
    await run.observer.onStarted(startedSnapshot)
    const initialCheckpoint = await service.latestCheckpoint("inv_model_text_omission")
    await run.observer.onModelStepStarted({
      investigation_id: "inv_model_text_omission",
      input,
      turn_index: 1,
      model_request_id: "model_request_model_text_omission",
      tool_protocol: "native",
      working_set_hash: initialCheckpoint!.working_set.working_set_hash,
      context_hash: "context_hash_model_text_omission",
      input_bytes: 128,
      estimated_input_tokens: 32,
      loaded_tools: [],
      provider_request_count_before: 0,
      external_api_audit_count_before: 0,
      started_at: "2026-01-01T00:00:01.000Z",
    })
    await run.observer.onCheckpoint({
      ...startedSnapshot,
      working_set: { ...startedSnapshot.working_set, model_turn_count: 1 },
      turn_index: 1,
      next_turn_index: 2,
      turn_summaries: [{
        turn_index: 1,
        model_request_id: "model_request_model_text_omission",
        model_status: "final",
        provider_request_count: 1,
        assistant_text_preview: "const RAW_MODEL_QUOTED_FILE_LINE = 'DO_NOT_PERSIST_MODEL_TEXT';",
        tool_call_ids: [],
        tool_ids: [],
        tool_execution_ids: [],
        tool_execution_statuses: [],
        newly_loaded_tool_ids: [],
        new_evidence_ids: [],
        input_estimated_tokens: 32,
        input_bytes: 128,
        cumulative_tool_calls: 0,
        progress_made: true,
        no_progress_reasons: [],
        warnings: [],
        provider_audit_request_ids: [],
        provider_audit_event_kinds: [],
        provider_audit_event_count: 0,
        provider_audit_complete: true,
        turn_hash: "turn_hash_model_text_omission",
      }],
      latest_assistant: {
        role: "assistant",
        content: [{ type: "text", text: "const RAW_MODEL_QUOTED_FILE_LINE = 'DO_NOT_PERSIST_MODEL_TEXT';" }],
      },
      latest_tool_results: [],
      provider_request_count: 1,
      elapsed_active_ms: 10,
      created_at: "2026-01-01T00:00:02.000Z",
    } as Parameters<typeof run.observer.onCheckpoint>[0])
    const baseResult = await server.runCommanderInvestigationInMemory(input)
    await service.finish(run, {
      ...baseResult,
      investigation_id: "inv_model_text_omission",
      final_summary: "const RAW_MODEL_QUOTED_FILE_LINE = 'DO_NOT_PERSIST_MODEL_TEXT';",
      model_turn_count: 1,
      provider_request_count: 1,
      turn_summaries: [],
    })
    service.release(run)

    const events = await eventText(projectDir)
    expect(events).not.toContain("DO_NOT_PERSIST_MODEL_TEXT")
    expect(events).toContain("\"text_persisted\":false")
    expect(events).toContain("\"assistant_text_persisted\":false")
    expect(events).toContain("\"exact_replay_supported\":false")
    expect(events).toContain("\"protocol_relationship_preserved\":true")
    const record = await service.get("inv_model_text_omission")
    expect(record).toMatchObject({ projection_status: "ready", status: "final", final_summary_preview: undefined })
    const checkpoint = await service.latestCheckpoint("inv_model_text_omission")
    expect(checkpoint?.replay_exchange).toMatchObject({ assistant_text_persisted: false, exact_replay_supported: false, protocol_relationship_preserved: true })
  })

  test("durable journal read APIs quarantine torn JSONL lines without hiding valid records", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-torn-jsonl-"))
    const store = new EventStore(join(projectDir, ".nxl", "events.jsonl"))
    const service = new CommanderInvestigationJournalService({ eventStore: store })
    const validInput = baseInvestigation({ investigation_id: "inv_valid_before_torn", objective: "valid before torn line" })
    const run = await service.createObserver(validInput)
    await run.observer.onStarted(durableStartedSnapshot(validInput, 0, "inv_valid_before_torn") as Parameters<typeof run.observer.onStarted>[0])
    service.release(run)
    await writeFile(store.eventsPath, '{\"kind\":\"runtime_commander_investigation_started\",\"schema_version\":1,\"investigation_id\":\"inv_torn_line\",\"journal_sequence\":0', { flag: "a" })

    const valid = await service.get("inv_valid_before_torn")
    expect(valid).toMatchObject({ projection_status: "ready", checkpoint_available: true })
    const torn = await service.get("inv_torn_line")
    expect(torn).toMatchObject({ projection_status: "corrupt", checkpoint_available: false, recovery_state: "no_checkpoint_resume_not_implemented" })
    expect(torn?.integrity_errors.join("\n")).toContain("malformed started payload")
    const list = await service.list({ limit: 10 })
    expect(list.map((record) => record.investigation_id)).toContain("inv_valid_before_torn")
    expect(list.map((record) => record.investigation_id)).toContain("inv_torn_line")
    const summary = await service.summary()
    expect(summary).toMatchObject({ total: 2, corrupt_count: 1, checkpoint_available_count: 1 })

    const afterTornInput = baseInvestigation({ investigation_id: "inv_after_torn_append", objective: "must not append after torn line" })
    const afterTornRun = await service.createObserver(afterTornInput)
    await expect(afterTornRun.observer.onStarted(durableStartedSnapshot(afterTornInput, 1, "inv_after_torn_append") as Parameters<typeof afterTornRun.observer.onStarted>[0])).rejects.toThrow("unterminated tail")
    service.release(afterTornRun)
    expect(await service.get("inv_after_torn_append")).toBeUndefined()
    expect(await eventText(projectDir)).not.toContain("inv_after_torn_append")
  })

  test("durable journal ignores torn JSONL lines that are not Commander investigation events", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-unrelated-torn-jsonl-"))
    const store = new EventStore(join(projectDir, ".nxl", "events.jsonl"))
    const service = new CommanderInvestigationJournalService({ eventStore: store })
    const validInput = baseInvestigation({ investigation_id: "inv_valid_before_unrelated_torn", objective: "valid before unrelated torn line" })
    const run = await service.createObserver(validInput)
    await run.observer.onStarted(durableStartedSnapshot(validInput, 0, "inv_valid_before_unrelated_torn") as Parameters<typeof run.observer.onStarted>[0])
    service.release(run)
    await writeFile(store.eventsPath, '{\"kind\":\"runtime_shutdown\",\"reason\":\"partial shutdown line without commander id\"', { flag: "a" })

    const list = await service.list({ limit: 10 })
    expect(list.map((record) => record.investigation_id)).toEqual(["inv_valid_before_unrelated_torn"])
    const summary = await service.summary()
    expect(summary).toMatchObject({ total: 1, corrupt_count: 0, checkpoint_available_count: 1 })
  })

  test("durable zero-request cancellation checkpoints project as terminal without uncertainty", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-zero-cancel-"))
    await writeApprovedSpec(projectDir)
    const server = new RuntimeServer({
      projectDir,
      adapter: new FakeOpenCodeAdapter(),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "cancelled", request_count: 0, error: "cancelled before transport" }]),
    })
    servers.push({ stop: () => server.shutdown() })
    await server.start()

    const result = await server.runCommanderInvestigationDurable(baseInvestigation({ investigation_id: "inv_zero_request_cancel" }))
    expect(result).toMatchObject({ status: "cancelled", stop_reason: "caller_cancelled", provider_request_count: 0, investigation_events_appended: true })
    const record = await server.getCommanderInvestigationRecord("inv_zero_request_cancel")
    expect(record).toMatchObject({ status: "cancelled", projection_status: "ready", uncertain_provider_outcome: false, recovery_state: "not_required" })
    expect(record?.pending_model_request_id).toBeUndefined()
    const kinds = eventKinds(await eventText(projectDir)).filter((kind) => kind.startsWith("runtime_commander_investigation_"))
    expect(kinds).toEqual([
      "runtime_commander_investigation_started",
      "runtime_commander_investigation_model_step_started",
      "runtime_commander_investigation_checkpointed",
      "runtime_commander_investigation_finished",
    ])
  })

  test("durable pre-model human-control warnings do not mutate checkpoint state before the model boundary", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-durable-human-warning-"))
    await writeApprovedSpec(projectDir)
    const server = new RuntimeServer({
      projectDir,
      adapter: new FakeOpenCodeAdapter(),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{
        status: "final",
        text: "continued after durable human note",
        assert_request: (request) => {
          const requestText = JSON.stringify(request.messages)
          expect(requestText).toContain("human control resume_requested")
        },
      }]),
      commanderInvestigationControlGate: {
        check: ({ before }) => ({
          action: "continue",
          source_kind: "human_control",
          projected_state: "resume_requested",
          summary_preview: before === "model_step" ? "resume requested before model" : "resume requested before tool",
          checked_at: "2026-01-01T00:00:01.000Z",
          warnings: before === "model_step" ? ["human control resume_requested"] : [],
        }),
      },
    })
    servers.push({ stop: () => server.shutdown() })
    await server.start()

    const result = await server.runCommanderInvestigationDurable(baseInvestigation({ investigation_id: "inv_durable_human_warning", session_id: "session_human_warning" }))
    expect(result).toMatchObject({ status: "final", stop_reason: "model_final", investigation_events_appended: true })
    expect(result.warnings.join(" ")).toContain("human control resume_requested")
    const events = (await server.eventStore.readAll()).filter((event) => event.investigation_id === "inv_durable_human_warning")
    const started = events.find((event) => event.kind === "runtime_commander_investigation_started") as { initial_checkpoint?: { working_set?: { working_set_hash?: string; current_warnings?: string[] } } } | undefined
    const modelStep = events.find((event) => event.kind === "runtime_commander_investigation_model_step_started") as { working_set_hash?: string } | undefined
    const checkpointed = events.find((event) => event.kind === "runtime_commander_investigation_checkpointed") as { checkpoint?: { working_set?: { current_warnings?: string[] } } } | undefined
    expect(started?.initial_checkpoint?.working_set?.current_warnings?.join(" ")).not.toContain("resume_requested")
    expect(modelStep?.working_set_hash).toBe(started?.initial_checkpoint?.working_set?.working_set_hash)
    expect(checkpointed?.checkpoint?.working_set?.current_warnings?.join(" ")).toContain("human control resume_requested")
    const record = await server.getCommanderInvestigationRecord("inv_durable_human_warning")
    expect(record).toMatchObject({ projection_status: "ready", status: "final", uncertain_provider_outcome: false })
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

    const startFailingServer = new RuntimeServer({
      projectDir,
      adapter: new FakeOpenCodeAdapter(),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "start will fail" }]),
    })
    servers.push({ stop: () => startFailingServer.shutdown() })
    await startFailingServer.start()
    const startFailingAppend = startFailingServer.eventStore.append.bind(startFailingServer.eventStore)
    startFailingServer.eventStore.append = async (event: Parameters<EventStore["append"]>[0]): Promise<string> => {
      if ((event as { kind?: string }).kind === "runtime_commander_investigation_started") throw new Error("started append failed")
      return startFailingAppend(event)
    }
    const startFailure = await startFailingServer.runCommanderInvestigationDurable(baseInvestigation({ investigation_id: "inv_started_fail" }))
    expect(startFailure).toMatchObject({ status: "failed", stop_reason: "persistence_failed", in_memory_only: false, investigation_event_count: 0, investigation_events_appended: false, events_appended: false })
    expect(startFailure.durability).toMatchObject({ mode: "event_journal", started_persisted: false, initial_checkpoint_persisted: false, terminal_persisted: false, investigation_event_count: 0, checkpoint_count: 0 })
    await startFailingServer.shutdown()

    const ambiguousDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-ambiguous-append-"))
    await writeApprovedSpec(ambiguousDir)
    const ambiguousServer = new RuntimeServer({
      projectDir: ambiguousDir,
      adapter: new FakeOpenCodeAdapter(),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "must not finish after ambiguous append" }]),
    })
    servers.push({ stop: () => ambiguousServer.shutdown() })
    await ambiguousServer.start()
    const ambiguousAppend = ambiguousServer.eventStore.append.bind(ambiguousServer.eventStore)
    ambiguousServer.eventStore.append = async (event: Parameters<EventStore["append"]>[0]): Promise<string> => {
      const eventId = await ambiguousAppend(event)
      if ((event as { kind?: string }).kind === "runtime_commander_investigation_model_step_started") {
        throw new Error("model-step append fsync status uncertain")
      }
      return eventId
    }
    const ambiguous = await ambiguousServer.runCommanderInvestigationDurable(baseInvestigation({ investigation_id: "inv_ambiguous_model_step_append" }))
    expect(ambiguous).toMatchObject({ status: "failed", stop_reason: "persistence_failed", in_memory_only: false, investigation_events_appended: true })
    expect(ambiguous.durability).toMatchObject({ terminal_persisted: false, pending_model_request_id: expect.any(String), projection_status: "ready", investigation_event_count: 2 })
    const ambiguousEvents = (await eventText(ambiguousDir)).trim().split(/\n+/).filter(Boolean)
      .map((line) => JSON.parse(line) as { kind?: string; investigation_id?: string })
      .filter((event) => event.investigation_id === "inv_ambiguous_model_step_append")
    expect(ambiguousEvents.map((event) => event.kind)).toEqual([
      "runtime_commander_investigation_started",
      "runtime_commander_investigation_model_step_started",
    ])
    const ambiguousRecord = await ambiguousServer.getCommanderInvestigationRecord("inv_ambiguous_model_step_append")
    expect(ambiguousRecord).toMatchObject({ status: "running", recovery_state: "uncertain_provider_outcome_resume_not_implemented", uncertain_provider_outcome: true, pending_model_request_id: expect.any(String) })
    await ambiguousServer.shutdown()

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
    expect(projected).toMatchObject({ status: "running", recovery_state: "checkpoint_available_resume_not_implemented", uncertain_provider_outcome: false, checkpoint_available: true, resume_supported: false })
    const terminalFailureKinds = (await eventText(projectDir)).trim().split(/\n+/).filter(Boolean)
      .map((line) => JSON.parse(line) as { kind?: string; investigation_id?: string })
      .filter((event) => event.investigation_id === "inv_terminal_fail")
      .map((event) => event.kind ?? "")
    expect(terminalFailureKinds.filter((kind) => kind === "runtime_commander_investigation_checkpointed")).toHaveLength(1)

    const ambiguousTerminalDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-ambiguous-terminal-append-"))
    await writeApprovedSpec(ambiguousTerminalDir)
    const ambiguousTerminalServer = new RuntimeServer({
      projectDir: ambiguousTerminalDir,
      adapter: new FakeOpenCodeAdapter(),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "terminal append is visible despite uncertain close" }]),
    })
    servers.push({ stop: () => ambiguousTerminalServer.shutdown() })
    await ambiguousTerminalServer.start()
    const ambiguousTerminalAppend = ambiguousTerminalServer.eventStore.append.bind(ambiguousTerminalServer.eventStore)
    ambiguousTerminalServer.eventStore.append = async (event: Parameters<EventStore["append"]>[0]): Promise<string> => {
      const eventId = await ambiguousTerminalAppend(event)
      if ((event as { kind?: string }).kind === "runtime_commander_investigation_finished") throw new Error("terminal append fsync status uncertain")
      return eventId
    }
    const ambiguousTerminal = await ambiguousTerminalServer.runCommanderInvestigationDurable(baseInvestigation({ investigation_id: "inv_ambiguous_terminal_append" }))
    expect(ambiguousTerminal).toMatchObject({ status: "failed", stop_reason: "persistence_failed", in_memory_only: false, investigation_events_appended: true })
    expect(ambiguousTerminal.durability).toMatchObject({ terminal_persisted: true, projection_status: "ready", original_terminal_status_if_persistence_failed: "final" })
    const ambiguousTerminalRecord = await ambiguousTerminalServer.getCommanderInvestigationRecord("inv_ambiguous_terminal_append")
    expect(ambiguousTerminalRecord).toMatchObject({ status: "final", stop_reason: "model_final", projection_status: "ready" })
    expect(ambiguousTerminal.investigation_event_count).toBe(ambiguousTerminalRecord!.investigation_event_count)
  })

  test("durable journal rejects identity fields the projection cannot read before start persistence", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-unpersistable-identity-"))
    await writeApprovedSpec(projectDir)
    const adapter = new ScriptedCommanderModelStepAdapter([{ status: "final", text: "must not be called" }])
    const server = new RuntimeServer({
      projectDir,
      adapter: new FakeOpenCodeAdapter(),
      commanderModelStepAdapter: adapter,
    })
    servers.push({ stop: () => server.shutdown() })
    await server.start()

    const badInputs = [
      ["empty_provider", { provider_id: "" }],
      ["long_model", { model_id: "m".repeat(201) }],
      ["long_session", { session_id: "s".repeat(201) }],
      ["long_mission", { mission_id: "m".repeat(201) }],
      ["long_launch", { launch_id: "l".repeat(201) }],
      ["high_model_turns", { max_model_turns: 25 }],
    ] as const

    for (const [name, override] of badInputs) {
      const investigationId = `inv_unpersistable_${name}`
      const result = await server.runCommanderInvestigationDurable(baseInvestigation({ investigation_id: investigationId, ...override }))
      expect(result).toMatchObject({
        status: "failed",
        stop_reason: "persistence_failed",
        provider_request_count: 0,
        tool_call_count: 0,
        investigation_event_count: 0,
        investigation_events_appended: false,
      })
      expect(await server.getCommanderInvestigationRecord(investigationId)).toBeUndefined()
      expect(await server.getLatestCommanderInvestigationCheckpoint(investigationId)).toBeUndefined()
    }

    expect(adapter.request_summaries).toHaveLength(0)
    const text = await eventText(projectDir)
    expect(text).not.toContain("runtime_commander_investigation_started")
    for (const [name] of badInputs) expect(text).not.toContain(`inv_unpersistable_${name}`)
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

    const projectDirRepeat = await mkdtemp(join(tmpdir(), "nxl-9w3a-durable-controller-reject-repeat-"))
    await writeApprovedSpec(projectDirRepeat)
    let repeatTick = 100
    const repeatServer = new RuntimeServer({
      projectDir: projectDirRepeat,
      adapter: new FakeOpenCodeAdapter(),
      researchSynthesisNow: () => new Date(Date.UTC(2026, 0, 1, 0, 0, repeatTick++)),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([
        { status: "tool_call", tool_calls: [toolCall("controller_reject_after_checkpoint_search", "commander.tool_search", { query: "durable controller rejection" })] },
        {
          assert_request: () => {
            throw new Error("scripted adapter rejected after durable checkpoint")
          },
        },
      ]),
    })
    servers.push({ stop: () => repeatServer.shutdown() })
    await repeatServer.start()
    const repeatResult = await repeatServer.runCommanderInvestigationDurable(baseInvestigation({ investigation_id: "inv_controller_reject_after_checkpoint_repeat" }))
    expect(repeatResult).toMatchObject({ status: "failed", stop_reason: "persistence_failed", in_memory_only: false, investigation_events_appended: true })
    expect(repeatResult.started_at).not.toBe(result.started_at)
    expect(repeatResult.result_hash).toBe(result.result_hash)
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

  test("durable journal projection accepts optional connector audit summaries inside checkpoints", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-optional-checkpoint-audit-"))
    const store = new EventStore(join(projectDir, ".nxl", "events.jsonl"))
    const service = new CommanderInvestigationJournalService({ eventStore: store })
    const input = baseInvestigation({ investigation_id: "inv_optional_checkpoint_audit", objective: "optional connector checkpoint audit" })
    const run = await service.createObserver(input)
    await run.observer.onStarted(durableStartedSnapshot(input, 0, "inv_optional_checkpoint_audit") as Parameters<typeof run.observer.onStarted>[0])
    const initial = await service.latestCheckpoint("inv_optional_checkpoint_audit")
    expect(initial).toBeDefined()
    await run.observer.onModelStepStarted({
      investigation_id: "inv_optional_checkpoint_audit",
      input,
      turn_index: 1,
      model_request_id: "model_request_optional_checkpoint_audit",
      tool_protocol: "native",
      working_set_hash: initial!.working_set.working_set_hash,
      context_hash: "context_hash_optional_checkpoint_audit",
      input_bytes: 128,
      estimated_input_tokens: 32,
      loaded_tools: [],
      provider_request_count_before: 0,
      external_api_audit_count_before: 0,
      started_at: "2026-01-01T00:00:01.000Z",
    })
    service.release(run)
    const optionalAuditWorkingSet = {
      ...initial!.working_set,
      provider_audit: {
        ...initial!.working_set.provider_audit,
        audit_required: false,
        transport_kind: "external_api_connector" as const,
        connector_ids: ["api_optional"],
        provider_request_count: 1,
        external_api_audit_event_count: 1,
        successful_audit_count: 1,
        audit_request_ids: ["external_api_request_optional_checkpoint"],
        audit_event_kinds: ["external_api_request_executed"],
        all_provider_requests_audited: true,
      },
      model_turn_count: 1,
    }
    optionalAuditWorkingSet.working_set_hash = stableHash({
      ...optionalAuditWorkingSet,
      working_set_hash: "",
      evidence_cards: optionalAuditWorkingSet.evidence_cards.map((item) => ({ ...item, observed_at: "" })),
      provider_audit: { ...optionalAuditWorkingSet.provider_audit, audit_request_ids: [] },
    })
    const checkpoint = finalizeTestCheckpoint({
      ...initial!,
      checkpoint_sequence: 1,
      checkpoint_kind: "turn_complete",
      turn_index: 1,
      next_turn_index: 2,
      previous_checkpoint_id: initial!.checkpoint_id,
      previous_checkpoint_hash: initial!.checkpoint_hash,
      working_set: optionalAuditWorkingSet,
      provider_request_count: 1,
      external_api_audit_count: 1,
    } as CommanderInvestigationCheckpoint)
    const event = {
      kind: "runtime_commander_investigation_checkpointed",
      schema_version: 1,
      investigation_id: "inv_optional_checkpoint_audit",
      journal_sequence: 2,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:02.000Z",
      checkpoint,
      event_payload_hash: "",
    }
    event.event_payload_hash = journalPayloadHash(event)
    await store.append(event as Parameters<EventStore["append"]>[0])

    const record = await service.get("inv_optional_checkpoint_audit")
    expect(record).toMatchObject({ projection_status: "ready", checkpoint_available: true, latest_checkpoint_id: checkpoint.checkpoint_id })
    expect(record?.integrity_errors).toEqual([])
    expect(await service.getCheckpoint(checkpoint.checkpoint_id)).toMatchObject({
      checkpoint_id: checkpoint.checkpoint_id,
      working_set: { provider_audit: { audit_required: false, transport_kind: "external_api_connector", external_api_audit_event_count: 1 } },
    })
  })

  test("durable journal projection accepts configured provider initial audit state before requests", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-required-initial-audit-"))
    const store = new EventStore(join(projectDir, ".nxl", "events.jsonl"))
    const service = new CommanderInvestigationJournalService({ eventStore: store })
    const input = baseInvestigation({ investigation_id: "inv_required_initial_audit", objective: "required initial audit" })
    const run = await service.createObserver(input)
    const started = durableStartedSnapshot(input, 0, "inv_required_initial_audit")
    ;(started.working_set as { provider_audit: unknown }).provider_audit = {
      audit_required: true,
      transport_kind: "external_api_connector",
      connector_ids: ["api_required"],
      provider_request_count: 0,
      external_api_audit_event_count: 0,
      successful_audit_count: 0,
      failed_audit_count: 0,
      audit_request_ids: [],
      audit_event_kinds: [],
      omitted_request_id_count: 0,
      all_provider_requests_audited: false,
      request_body_persisted: false,
      response_body_persisted: false,
      credentials_persisted: false,
      warnings: [],
    }
    await run.observer.onStarted(started as Parameters<typeof run.observer.onStarted>[0])
    service.release(run)

    const record = await service.get("inv_required_initial_audit")
    expect(record).toMatchObject({ projection_status: "ready", checkpoint_available: true, provider_request_count: 0, external_api_audit_event_count: 0 })
    expect(record?.integrity_errors).toEqual([])
    expect(await service.latestCheckpoint("inv_required_initial_audit")).toMatchObject({
      working_set: { provider_audit: { audit_required: true, transport_kind: "external_api_connector", all_provider_requests_audited: false } },
    })
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

    const malformedModelInput = baseInvestigation({ investigation_id: "inv_missing_model_step_fields", objective: "missing model step fields" })
    const malformedModelRun = await service.createObserver(malformedModelInput)
    await malformedModelRun.observer.onStarted(durableStartedSnapshot(malformedModelInput, 1, "inv_missing_model_step_fields") as Parameters<typeof malformedModelRun.observer.onStarted>[0])
    const malformedModelInitial = await service.latestCheckpoint("inv_missing_model_step_fields")
    expect(malformedModelInitial).toBeDefined()
    service.release(malformedModelRun)
    const incompleteModelStep = {
      kind: "runtime_commander_investigation_model_step_started",
      schema_version: 1,
      investigation_id: "inv_missing_model_step_fields",
      journal_sequence: 1,
      turn_index: 1,
      model_request_id: "model_request_missing_model_step_fields",
      started_at: "2026-01-01T00:00:01.500Z",
      base_checkpoint_id: malformedModelInitial!.checkpoint_id,
      base_checkpoint_sequence: malformedModelInitial!.checkpoint_sequence,
      base_checkpoint_hash: malformedModelInitial!.checkpoint_hash,
      event_payload_hash: "",
    }
    incompleteModelStep.event_payload_hash = journalPayloadHash(incompleteModelStep)
    await store.append(incompleteModelStep as Parameters<EventStore["append"]>[0])
    const malformedModelRecord = await service.get("inv_missing_model_step_fields")
    expect(malformedModelRecord).toMatchObject({ projection_status: "corrupt" })
    expect(malformedModelRecord?.integrity_errors).toContain("malformed model-step payload at sequence 1")

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
    expect(badCheckpointRecord?.integrity_errors).toContain("checkpoint hash mismatch at 1")

    const malformedCheckpointInput = baseInvestigation({ investigation_id: "inv_missing_checkpoint_fields", objective: "missing checkpoint fields" })
    const malformedRun = await service.createObserver(malformedCheckpointInput)
    await malformedRun.observer.onStarted(durableStartedSnapshot(malformedCheckpointInput, 1, "inv_missing_checkpoint_fields") as Parameters<typeof malformedRun.observer.onStarted>[0])
    const malformedInitial = await service.latestCheckpoint("inv_missing_checkpoint_fields")
    expect(malformedInitial).toBeDefined()
    await malformedRun.observer.onModelStepStarted({
      investigation_id: "inv_missing_checkpoint_fields",
      input: malformedCheckpointInput,
      turn_index: 1,
      model_request_id: "model_request_missing_checkpoint_fields",
      tool_protocol: "native",
      working_set_hash: malformedInitial!.working_set.working_set_hash,
      context_hash: "context_hash_missing_checkpoint_fields",
      input_bytes: 128,
      estimated_input_tokens: 32,
      loaded_tools: [],
      provider_request_count_before: 0,
      external_api_audit_count_before: 0,
      started_at: "2026-01-01T00:00:04.000Z",
    })
    service.release(malformedRun)
    const incompleteCheckpoint: Record<string, unknown> = {
      schema_version: 1,
      checkpoint_id: "checkpoint_missing_required_fields",
      investigation_id: "inv_missing_checkpoint_fields",
      checkpoint_sequence: 1,
      checkpoint_kind: "turn_complete",
      turn_index: 1,
      next_turn_index: 2,
      phase: malformedInitial!.phase,
      objective_hash: malformedInitial!.objective_hash,
      provider_id: malformedInitial!.provider_id,
      provider_kind: malformedInitial!.provider_kind,
      model_id: malformedInitial!.model_id,
      tool_protocol: malformedInitial!.tool_protocol,
      working_set: { ...malformedInitial!.working_set, model_turn_count: 1 },
      turn_summaries: [],
      provider_request_count: 0,
      external_api_audit_count: 0,
      elapsed_active_ms: 10,
      previous_checkpoint_id: malformedInitial!.checkpoint_id,
      previous_checkpoint_hash: malformedInitial!.checkpoint_hash,
      checkpoint_hash: "",
    }
    incompleteCheckpoint.checkpoint_hash = stableHash({ ...incompleteCheckpoint, checkpoint_hash: "" })
    const malformedCheckpointEvent = {
      kind: "runtime_commander_investigation_checkpointed",
      schema_version: 1,
      investigation_id: "inv_missing_checkpoint_fields",
      journal_sequence: 2,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:05.000Z",
      checkpoint: incompleteCheckpoint,
      event_payload_hash: "",
    }
    malformedCheckpointEvent.event_payload_hash = journalPayloadHash(malformedCheckpointEvent)
    await store.append(malformedCheckpointEvent as Parameters<EventStore["append"]>[0])
    const malformedRecord = await service.get("inv_missing_checkpoint_fields")
    expect(malformedRecord).toMatchObject({ projection_status: "corrupt", pending_model_request_id: "model_request_missing_checkpoint_fields" })
    expect(malformedRecord?.integrity_errors).toContain("malformed checkpoint payload at sequence 2")
    expect(await service.latestCheckpoint("inv_missing_checkpoint_fields")).toMatchObject({ checkpoint_sequence: 0 })
  })

  test("durable journal projection rejects stale checkpoint semantic hashes", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-checkpoint-semantic-hash-"))
    const store = new EventStore(join(projectDir, ".nxl", "events.jsonl"))
    const service = new CommanderInvestigationJournalService({ eventStore: store })
    const input = baseInvestigation({ investigation_id: "inv_bad_checkpoint_semantic_hash", objective: "bad checkpoint semantic hash" })
    const run = await service.createObserver(input)
    await run.observer.onStarted(durableStartedSnapshot(input, 0, "inv_bad_checkpoint_semantic_hash") as Parameters<typeof run.observer.onStarted>[0])
    const initial = await service.latestCheckpoint("inv_bad_checkpoint_semantic_hash")
    expect(initial).toBeDefined()
    await run.observer.onModelStepStarted({
      investigation_id: "inv_bad_checkpoint_semantic_hash",
      input,
      turn_index: 1,
      model_request_id: "model_request_bad_checkpoint_semantic_hash",
      tool_protocol: "native",
      working_set_hash: initial!.working_set.working_set_hash,
      context_hash: "context_hash_bad_checkpoint_semantic_hash",
      input_bytes: 128,
      estimated_input_tokens: 32,
      loaded_tools: [],
      provider_request_count_before: 0,
      external_api_audit_count_before: 0,
      started_at: "2026-01-01T00:00:01.000Z",
    })
    service.release(run)
    const staleSemanticCheckpoint = {
      ...initial!,
      checkpoint_sequence: 1,
      checkpoint_kind: "turn_complete" as const,
      turn_index: 1,
      next_turn_index: 2,
      previous_checkpoint_id: initial!.checkpoint_id,
      previous_checkpoint_hash: initial!.checkpoint_hash,
      working_set: { ...initial!.working_set, model_turn_count: 1 },
      provider_request_count: 1,
      created_at: "2026-01-01T00:00:02.000Z",
      semantic_state_hash: "stale_semantic_state_hash",
      checkpoint_hash: "",
    }
    staleSemanticCheckpoint.checkpoint_hash = stableHash({ ...staleSemanticCheckpoint, checkpoint_hash: "" })
    const staleSemanticEvent = {
      kind: "runtime_commander_investigation_checkpointed",
      schema_version: 1,
      investigation_id: "inv_bad_checkpoint_semantic_hash",
      journal_sequence: 2,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:02.000Z",
      checkpoint: staleSemanticCheckpoint,
      event_payload_hash: "",
    }
    staleSemanticEvent.event_payload_hash = journalPayloadHash(staleSemanticEvent)
    await store.append(staleSemanticEvent as Parameters<EventStore["append"]>[0])
    const record = await service.get("inv_bad_checkpoint_semantic_hash")
    expect(record).toMatchObject({ projection_status: "corrupt", pending_model_request_id: "model_request_bad_checkpoint_semantic_hash" })
    expect(record?.integrity_errors).toContain("checkpoint hash mismatch at 1")
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

  test("durable checkpoint compaction measures the full persisted checkpoint event envelope", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-checkpoint-envelope-cap-"))
    const service = new CommanderInvestigationJournalService({
      eventStore: new EventStore(join(projectDir, ".nxl", "events.jsonl")),
      checkpointPayloadCapBytes: 16_000,
    })
    const input = baseInvestigation({ investigation_id: "inv_checkpoint_envelope_cap", objective: "compact checkpoint against full envelope" })
    const run = await service.createObserver(input)
    await run.observer.onStarted(durableStartedSnapshot(input, 0, "inv_checkpoint_envelope_cap") as Parameters<typeof run.observer.onStarted>[0])
    await run.observer.onModelStepStarted({
      investigation_id: "inv_checkpoint_envelope_cap",
      input,
      turn_index: 1,
      model_request_id: "model_request_checkpoint_envelope_cap",
      tool_protocol: "native",
      working_set_hash: run.state.latest_checkpoint!.working_set.working_set_hash,
      context_hash: "context_hash_checkpoint_envelope_cap",
      input_bytes: 512,
      estimated_input_tokens: 128,
      loaded_tools: [],
      provider_request_count_before: 0,
      external_api_audit_count_before: 0,
      started_at: "2026-01-01T00:00:01.000Z",
    })
    const checkpointSnapshot = durableStartedSnapshot(input, 1, "inv_checkpoint_envelope_cap") as unknown as CommanderInvestigationCheckpointSnapshot
    checkpointSnapshot.working_set.model_turn_count = 1
    checkpointSnapshot.working_set.evidence_cards = Array.from({ length: 4 }, (_, index) => largeEvidenceCard(index))
    checkpointSnapshot.working_set.recent_execution_digests = Array.from({ length: 24 }, (_, index) => ({
      turn_index: index,
      tool_id: "memory.search",
      call_signature_hash: `call_signature_hash_envelope_${index}`,
      execution_status: "ready",
      result_hash: `result_hash_envelope_${index}`,
      evidence_ids: [`evidence_large_terminal_${index % 4}`],
      loaded_tool_outcome: `loaded outcome ${index}`,
      blocker_warning_summary: `checkpoint envelope digest ${index} ${"d".repeat(700)}`,
      order: index,
    }))
    const largeTurns = Array.from({ length: 12 }, (_, index) => ({
      turn_index: index + 1,
      model_request_id: `model_request_large_checkpoint_${index}`,
      model_result_hash: `model_result_hash_large_checkpoint_${index}`,
      model_status: "tool_call",
      provider_request_count: index + 1,
      assistant_text_preview: `large checkpoint turn ${index} ${"a".repeat(700)}`,
      tool_call_ids: [`call_${index}`],
      tool_ids: ["memory.search"],
      tool_execution_ids: [`exec_${index}`],
      tool_execution_statuses: ["ready"],
      newly_loaded_tool_ids: [],
      new_evidence_ids: [],
      input_estimated_tokens: 128,
      input_bytes: 512,
      output_tokens: 8,
      cumulative_tool_calls: index + 1,
      progress_made: true,
      no_progress_reasons: [],
      warnings: [`large checkpoint warning ${index} ${"w".repeat(700)}`],
      provider_audit_request_ids: [],
      provider_audit_event_kinds: [],
      provider_audit_event_count: 0,
      provider_audit_complete: true,
      turn_hash: `turn_hash_large_checkpoint_${index}`,
    }))
    await run.observer.onCheckpoint({
      ...checkpointSnapshot,
      turn_index: 1,
      next_turn_index: 2,
      turn_summaries: largeTurns,
      latest_tool_results: [],
      provider_request_count: 1,
      elapsed_active_ms: 10,
      created_at: "2026-01-01T00:00:02.000Z",
    })
    service.release(run)
    const checkpoint = await service.latestCheckpoint("inv_checkpoint_envelope_cap")
    expect(checkpoint).toMatchObject({ checkpoint_sequence: 1 })
    expect(checkpoint!.working_set.omitted_turn_count + checkpoint!.working_set.omitted_digest_count + checkpoint!.working_set.omitted_evidence_count).toBeGreaterThan(0)
    const events = (await eventText(projectDir)).trim().split(/\n+/).filter(Boolean).map((line) => JSON.parse(line) as { kind?: string; investigation_id?: string })
    const checkpointEvent = events.find((event) => event.kind === "runtime_commander_investigation_checkpointed" && event.investigation_id === "inv_checkpoint_envelope_cap")
    expect(checkpointEvent).toBeDefined()
    expect(Buffer.byteLength(JSON.stringify(checkpointEvent)) + 256).toBeLessThanOrEqual(16_000)
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
        tool_protocol: "native" as const,
        final_output: { text_persisted: false, text_hash: "text_hash_corrupt_terminal", text_chars: 36 },
        conclusion: { status: "final", stop_reason: "model_final", evidence_ids: [], evidence_titles: [], safe_evidence_summaries: [], blockers: [], warnings: [], final_output_text_hash: "text_hash_corrupt_terminal" },
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
        tool_protocol: "native" as const,
        final_output: { text_persisted: false, text_hash: "text_hash_nested_terminal", text_chars: 12 },
        conclusion: { status: "final", stop_reason: "model_final", evidence_ids: [], evidence_titles: [], safe_evidence_summaries: [], blockers: [], warnings: [], final_output_text_hash: "text_hash_nested_terminal" },
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
      final_output: { text_persisted: false, text_hash: "text_hash_wrong_owner_terminal", text_chars: 40 },
      conclusion: { status: "final", stop_reason: "model_final", evidence_ids: [], evidence_titles: [], safe_evidence_summaries: [], blockers: [], warnings: [], final_output_text_hash: "text_hash_wrong_owner_terminal" },
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
    const badFinalSummaryInput = baseInvestigation({ investigation_id: "inv_bad_final_summary_terminal", objective: "bad final summary terminal" })
    const badFinalSummaryRun = await service.createObserver(badFinalSummaryInput)
    await badFinalSummaryRun.observer.onStarted(durableStartedSnapshot(badFinalSummaryInput, 14, "inv_bad_final_summary_terminal") as Parameters<typeof badFinalSummaryRun.observer.onStarted>[0])
    const badFinalSummaryCheckpoint = await service.latestCheckpoint("inv_bad_final_summary_terminal")
    service.release(badFinalSummaryRun)
    const badFinalSummaryTerminal = {
      ...wrongOwnerTerminal,
      investigation_id: "inv_bad_final_summary_terminal",
      objective_hash: "objective_hash_bad_final_summary",
      final_output: { unexpected: "object summary" },
      last_checkpoint_id: badFinalSummaryCheckpoint!.checkpoint_id,
      last_checkpoint_sequence: badFinalSummaryCheckpoint!.checkpoint_sequence,
      last_checkpoint_hash: badFinalSummaryCheckpoint!.checkpoint_hash,
      semantic_result_hash: "semantic_bad_final_summary",
      terminal_hash: "",
    }
    badFinalSummaryTerminal.terminal_hash = stableHash({ ...badFinalSummaryTerminal, terminal_hash: "" })
    const badFinalSummaryEvent = {
      kind: "runtime_commander_investigation_finished",
      schema_version: 1,
      investigation_id: "inv_bad_final_summary_terminal",
      journal_sequence: 1,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:12.500Z",
      terminal: badFinalSummaryTerminal,
      event_payload_hash: "",
    }
    badFinalSummaryEvent.event_payload_hash = journalPayloadHash(badFinalSummaryEvent)
    await store.append(badFinalSummaryEvent as Parameters<EventStore["append"]>[0])
    const persistedTranscriptInput = baseInvestigation({ investigation_id: "inv_terminal_persisted_transcript", objective: "terminal persisted transcript flag" })
    const persistedTranscriptRun = await service.createObserver(persistedTranscriptInput)
    await persistedTranscriptRun.observer.onStarted(durableStartedSnapshot(persistedTranscriptInput, 15, "inv_terminal_persisted_transcript") as Parameters<typeof persistedTranscriptRun.observer.onStarted>[0])
    const persistedTranscriptCheckpoint = await service.latestCheckpoint("inv_terminal_persisted_transcript")
    service.release(persistedTranscriptRun)
    const persistedTranscriptTerminal = {
      ...wrongOwnerTerminal,
      investigation_id: "inv_terminal_persisted_transcript",
      phase: persistedTranscriptCheckpoint!.phase,
      objective_hash: persistedTranscriptCheckpoint!.objective_hash,
      provider_id: persistedTranscriptCheckpoint!.provider_id,
      provider_kind: persistedTranscriptCheckpoint!.provider_kind,
      model_id: persistedTranscriptCheckpoint!.model_id,
      tool_protocol: persistedTranscriptCheckpoint!.tool_protocol,
      bootstrap_id: persistedTranscriptCheckpoint!.bootstrap_ref.bootstrap_id,
      bootstrap_hash: persistedTranscriptCheckpoint!.bootstrap_ref.bootstrap_hash,
      budget_id: persistedTranscriptCheckpoint!.budget.budget_id,
      budget_hash: persistedTranscriptCheckpoint!.budget.budget_hash,
      final_output: undefined,
      last_checkpoint_id: persistedTranscriptCheckpoint!.checkpoint_id,
      last_checkpoint_sequence: persistedTranscriptCheckpoint!.checkpoint_sequence,
      last_checkpoint_hash: persistedTranscriptCheckpoint!.checkpoint_hash,
      semantic_result_hash: "semantic_persisted_transcript_terminal",
      transcript_persisted: true,
      terminal_hash: "",
    }
    persistedTranscriptTerminal.terminal_hash = stableHash({ ...persistedTranscriptTerminal, terminal_hash: "" })
    const persistedTranscriptEvent = {
      kind: "runtime_commander_investigation_finished",
      schema_version: 1,
      investigation_id: "inv_terminal_persisted_transcript",
      journal_sequence: 1,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:12.750Z",
      terminal: persistedTranscriptTerminal,
      event_payload_hash: "",
    }
    persistedTranscriptEvent.event_payload_hash = journalPayloadHash(persistedTranscriptEvent)
    await store.append(persistedTranscriptEvent as Parameters<EventStore["append"]>[0])
    const malformedTerminalMemberInput = baseInvestigation({ investigation_id: "inv_terminal_malformed_members", objective: "terminal malformed array members" })
    const malformedTerminalMemberRun = await service.createObserver(malformedTerminalMemberInput)
    await malformedTerminalMemberRun.observer.onStarted(durableStartedSnapshot(malformedTerminalMemberInput, 16, "inv_terminal_malformed_members") as Parameters<typeof malformedTerminalMemberRun.observer.onStarted>[0])
    const malformedTerminalMemberCheckpoint = await service.latestCheckpoint("inv_terminal_malformed_members")
    service.release(malformedTerminalMemberRun)
    const malformedTerminalMembers = {
      ...persistedTranscriptTerminal,
      investigation_id: "inv_terminal_malformed_members",
      phase: malformedTerminalMemberCheckpoint!.phase,
      objective_hash: malformedTerminalMemberCheckpoint!.objective_hash,
      provider_id: malformedTerminalMemberCheckpoint!.provider_id,
      provider_kind: malformedTerminalMemberCheckpoint!.provider_kind,
      model_id: malformedTerminalMemberCheckpoint!.model_id,
      tool_protocol: malformedTerminalMemberCheckpoint!.tool_protocol,
      bootstrap_id: malformedTerminalMemberCheckpoint!.bootstrap_ref.bootstrap_id,
      bootstrap_hash: malformedTerminalMemberCheckpoint!.bootstrap_ref.bootstrap_hash,
      budget_id: malformedTerminalMemberCheckpoint!.budget.budget_id,
      budget_hash: malformedTerminalMemberCheckpoint!.budget.budget_hash,
      last_checkpoint_id: malformedTerminalMemberCheckpoint!.checkpoint_id,
      last_checkpoint_sequence: malformedTerminalMemberCheckpoint!.checkpoint_sequence,
      last_checkpoint_hash: malformedTerminalMemberCheckpoint!.checkpoint_hash,
      semantic_result_hash: "semantic_malformed_terminal_members",
      turn_summaries: [{}],
      provider_audit: { audit_required: false },
      transcript_persisted: false,
      terminal_hash: "",
    }
    malformedTerminalMembers.terminal_hash = stableHash({ ...malformedTerminalMembers, terminal_hash: "" })
    const malformedTerminalMembersEvent = {
      kind: "runtime_commander_investigation_finished",
      schema_version: 1,
      investigation_id: "inv_terminal_malformed_members",
      journal_sequence: 1,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:12.850Z",
      terminal: malformedTerminalMembers,
      event_payload_hash: "",
    }
    malformedTerminalMembersEvent.event_payload_hash = journalPayloadHash(malformedTerminalMembersEvent)
    await store.append(malformedTerminalMembersEvent as Parameters<EventStore["append"]>[0])
    const rawAssistantTerminalInput = baseInvestigation({ investigation_id: "inv_terminal_raw_assistant_preview", objective: "terminal raw assistant preview" })
    const rawAssistantTerminalRun = await service.createObserver(rawAssistantTerminalInput)
    await rawAssistantTerminalRun.observer.onStarted(durableStartedSnapshot(rawAssistantTerminalInput, 17, "inv_terminal_raw_assistant_preview") as Parameters<typeof rawAssistantTerminalRun.observer.onStarted>[0])
    const rawAssistantTerminalCheckpoint = await service.latestCheckpoint("inv_terminal_raw_assistant_preview")
    service.release(rawAssistantTerminalRun)
    const completeTurnSummary = {
      turn_index: 1,
      model_request_id: "model_request_raw_assistant_preview",
      model_result_hash: "model_result_hash",
      model_status: "final",
      provider_request_count: 1,
      assistant_text_preview: "raw Commander model prose must not persist",
      tool_call_ids: [],
      tool_ids: [],
      tool_execution_ids: [],
      tool_execution_statuses: [],
      newly_loaded_tool_ids: [],
      new_evidence_ids: [],
      input_estimated_tokens: 10,
      input_bytes: 100,
      cumulative_tool_calls: 0,
      progress_made: true,
      no_progress_reasons: [],
      warnings: [],
      provider_audit_request_ids: [],
      provider_audit_event_kinds: [],
      provider_audit_event_count: 0,
      provider_audit_complete: true,
      turn_hash: "turn_hash",
    }
    const rawAssistantTerminal = {
      ...malformedTerminalMembers,
      investigation_id: "inv_terminal_raw_assistant_preview",
      phase: rawAssistantTerminalCheckpoint!.phase,
      objective_hash: rawAssistantTerminalCheckpoint!.objective_hash,
      provider_id: rawAssistantTerminalCheckpoint!.provider_id,
      provider_kind: rawAssistantTerminalCheckpoint!.provider_kind,
      model_id: rawAssistantTerminalCheckpoint!.model_id,
      tool_protocol: rawAssistantTerminalCheckpoint!.tool_protocol,
      bootstrap_id: rawAssistantTerminalCheckpoint!.bootstrap_ref.bootstrap_id,
      bootstrap_hash: rawAssistantTerminalCheckpoint!.bootstrap_ref.bootstrap_hash,
      budget_id: rawAssistantTerminalCheckpoint!.budget.budget_id,
      budget_hash: rawAssistantTerminalCheckpoint!.budget.budget_hash,
      last_checkpoint_id: rawAssistantTerminalCheckpoint!.checkpoint_id,
      last_checkpoint_sequence: rawAssistantTerminalCheckpoint!.checkpoint_sequence,
      last_checkpoint_hash: rawAssistantTerminalCheckpoint!.checkpoint_hash,
      semantic_result_hash: "semantic_raw_assistant_terminal",
      turn_summaries: [completeTurnSummary],
      provider_audit: { audit_required: false, transport_kind: "none", connector_ids: [], provider_request_count: 0, external_api_audit_event_count: 0, successful_audit_count: 0, failed_audit_count: 0, audit_request_ids: [], audit_event_kinds: [], omitted_request_id_count: 0, all_provider_requests_audited: true, request_body_persisted: false, response_body_persisted: false, credentials_persisted: false, warnings: [] },
      terminal_hash: "",
    }
    rawAssistantTerminal.terminal_hash = stableHash({ ...rawAssistantTerminal, terminal_hash: "" })
    const rawAssistantTerminalEvent = {
      kind: "runtime_commander_investigation_finished",
      schema_version: 1,
      investigation_id: "inv_terminal_raw_assistant_preview",
      journal_sequence: 1,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:12.900Z",
      terminal: rawAssistantTerminal,
      event_payload_hash: "",
    }
    rawAssistantTerminalEvent.event_payload_hash = journalPayloadHash(rawAssistantTerminalEvent)
    await store.append(rawAssistantTerminalEvent as Parameters<EventStore["append"]>[0])
    const badAuditTransportInput = baseInvestigation({ investigation_id: "inv_terminal_bad_audit_transport", objective: "terminal bad audit transport" })
    const badAuditTransportRun = await service.createObserver(badAuditTransportInput)
    await badAuditTransportRun.observer.onStarted(durableStartedSnapshot(badAuditTransportInput, 18, "inv_terminal_bad_audit_transport") as Parameters<typeof badAuditTransportRun.observer.onStarted>[0])
    const badAuditTransportCheckpoint = await service.latestCheckpoint("inv_terminal_bad_audit_transport")
    service.release(badAuditTransportRun)
    const badAuditTransportTerminal = {
      ...rawAssistantTerminal,
      investigation_id: "inv_terminal_bad_audit_transport",
      phase: badAuditTransportCheckpoint!.phase,
      objective_hash: badAuditTransportCheckpoint!.objective_hash,
      provider_id: badAuditTransportCheckpoint!.provider_id,
      provider_kind: badAuditTransportCheckpoint!.provider_kind,
      model_id: badAuditTransportCheckpoint!.model_id,
      tool_protocol: badAuditTransportCheckpoint!.tool_protocol,
      bootstrap_id: badAuditTransportCheckpoint!.bootstrap_ref.bootstrap_id,
      bootstrap_hash: badAuditTransportCheckpoint!.bootstrap_ref.bootstrap_hash,
      budget_id: badAuditTransportCheckpoint!.budget.budget_id,
      budget_hash: badAuditTransportCheckpoint!.budget.budget_hash,
      last_checkpoint_id: badAuditTransportCheckpoint!.checkpoint_id,
      last_checkpoint_sequence: badAuditTransportCheckpoint!.checkpoint_sequence,
      last_checkpoint_hash: badAuditTransportCheckpoint!.checkpoint_hash,
      semantic_result_hash: "semantic_bad_audit_transport_terminal",
      turn_summaries: [],
      provider_audit: { ...rawAssistantTerminal.provider_audit, transport_kind: "local" },
      terminal_hash: "",
    }
    badAuditTransportTerminal.terminal_hash = stableHash({ ...badAuditTransportTerminal, terminal_hash: "" })
    const badAuditTransportEvent = {
      kind: "runtime_commander_investigation_finished",
      schema_version: 1,
      investigation_id: "inv_terminal_bad_audit_transport",
      journal_sequence: 1,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:12.950Z",
      terminal: badAuditTransportTerminal,
      event_payload_hash: "",
    }
    badAuditTransportEvent.event_payload_hash = journalPayloadHash(badAuditTransportEvent)
    await store.append(badAuditTransportEvent as Parameters<EventStore["append"]>[0])
    const malformedCheckpointTurnInput = baseInvestigation({ investigation_id: "inv_checkpoint_malformed_turn_summary", objective: "checkpoint malformed turn summary" })
    const malformedCheckpointTurnRun = await service.createObserver(malformedCheckpointTurnInput)
    await malformedCheckpointTurnRun.observer.onStarted(durableStartedSnapshot(malformedCheckpointTurnInput, 19, "inv_checkpoint_malformed_turn_summary") as Parameters<typeof malformedCheckpointTurnRun.observer.onStarted>[0])
    const malformedCheckpointTurnInitial = await service.latestCheckpoint("inv_checkpoint_malformed_turn_summary")
    service.release(malformedCheckpointTurnRun)
    const malformedCheckpointTurn = finalizeTestCheckpoint({
      ...malformedCheckpointTurnInitial!,
      checkpoint_sequence: 1,
      checkpoint_kind: "turn_complete",
      turn_index: 1,
      next_turn_index: 2,
      previous_checkpoint_id: malformedCheckpointTurnInitial!.checkpoint_id,
      previous_checkpoint_hash: malformedCheckpointTurnInitial!.checkpoint_hash,
      working_set: { ...malformedCheckpointTurnInitial!.working_set, model_turn_count: 1 },
      turn_summaries: [{}],
    } as CommanderInvestigationCheckpoint)
    const malformedCheckpointTurnEvent = {
      kind: "runtime_commander_investigation_checkpointed",
      schema_version: 1,
      investigation_id: "inv_checkpoint_malformed_turn_summary",
      journal_sequence: 1,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:13.000Z",
      checkpoint: malformedCheckpointTurn,
      event_payload_hash: "",
    }
    malformedCheckpointTurnEvent.event_payload_hash = journalPayloadHash(malformedCheckpointTurnEvent)
    await store.append(malformedCheckpointTurnEvent as Parameters<EventStore["append"]>[0])
    const badCheckpointAuditInput = baseInvestigation({ investigation_id: "inv_checkpoint_bad_provider_audit", objective: "checkpoint bad provider audit" })
    const badCheckpointAuditRun = await service.createObserver(badCheckpointAuditInput)
    await badCheckpointAuditRun.observer.onStarted(durableStartedSnapshot(badCheckpointAuditInput, 20, "inv_checkpoint_bad_provider_audit") as Parameters<typeof badCheckpointAuditRun.observer.onStarted>[0])
    const badCheckpointAuditInitial = await service.latestCheckpoint("inv_checkpoint_bad_provider_audit")
    service.release(badCheckpointAuditRun)
    const badCheckpointAudit = finalizeTestCheckpoint({
      ...badCheckpointAuditInitial!,
      checkpoint_sequence: 1,
      checkpoint_kind: "turn_complete",
      turn_index: 1,
      next_turn_index: 2,
      previous_checkpoint_id: badCheckpointAuditInitial!.checkpoint_id,
      previous_checkpoint_hash: badCheckpointAuditInitial!.checkpoint_hash,
      working_set: {
        ...badCheckpointAuditInitial!.working_set,
        provider_audit: { ...badCheckpointAuditInitial!.working_set.provider_audit, transport_kind: "local" },
        model_turn_count: 1,
      },
    } as unknown as CommanderInvestigationCheckpoint)
    const badCheckpointAuditEvent = {
      kind: "runtime_commander_investigation_checkpointed",
      schema_version: 1,
      investigation_id: "inv_checkpoint_bad_provider_audit",
      journal_sequence: 1,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:13.250Z",
      checkpoint: badCheckpointAudit,
      event_payload_hash: "",
    }
    badCheckpointAuditEvent.event_payload_hash = journalPayloadHash(badCheckpointAuditEvent)
    await store.append(badCheckpointAuditEvent as Parameters<EventStore["append"]>[0])
    const inconsistentOptionalAuditInput = baseInvestigation({ investigation_id: "inv_checkpoint_inconsistent_optional_audit", objective: "checkpoint inconsistent optional audit" })
    const inconsistentOptionalAuditRun = await service.createObserver(inconsistentOptionalAuditInput)
    await inconsistentOptionalAuditRun.observer.onStarted(durableStartedSnapshot(inconsistentOptionalAuditInput, 21, "inv_checkpoint_inconsistent_optional_audit") as Parameters<typeof inconsistentOptionalAuditRun.observer.onStarted>[0])
    const inconsistentOptionalAuditInitial = await service.latestCheckpoint("inv_checkpoint_inconsistent_optional_audit")
    service.release(inconsistentOptionalAuditRun)
    const inconsistentOptionalAudit = finalizeTestCheckpoint({
      ...inconsistentOptionalAuditInitial!,
      checkpoint_sequence: 1,
      checkpoint_kind: "turn_complete",
      turn_index: 1,
      next_turn_index: 2,
      previous_checkpoint_id: inconsistentOptionalAuditInitial!.checkpoint_id,
      previous_checkpoint_hash: inconsistentOptionalAuditInitial!.checkpoint_hash,
      working_set: {
        ...inconsistentOptionalAuditInitial!.working_set,
        provider_audit: {
          ...inconsistentOptionalAuditInitial!.working_set.provider_audit,
          audit_required: false,
          transport_kind: "external_api_connector",
          connector_ids: ["api_inconsistent_optional"],
          provider_request_count: 1,
          external_api_audit_event_count: 1,
          successful_audit_count: 0,
          failed_audit_count: 0,
          audit_request_ids: [],
          audit_event_kinds: [],
          all_provider_requests_audited: true,
        },
        model_turn_count: 1,
      },
    } as CommanderInvestigationCheckpoint)
    const inconsistentOptionalAuditEvent = {
      kind: "runtime_commander_investigation_checkpointed",
      schema_version: 1,
      investigation_id: "inv_checkpoint_inconsistent_optional_audit",
      journal_sequence: 1,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:13.300Z",
      checkpoint: inconsistentOptionalAudit,
      event_payload_hash: "",
    }
    inconsistentOptionalAuditEvent.event_payload_hash = journalPayloadHash(inconsistentOptionalAuditEvent)
    await store.append(inconsistentOptionalAuditEvent as Parameters<EventStore["append"]>[0])
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
    const badLoadedRefs = structuredClone(seedStarted!) as Record<string, unknown>
    badLoadedRefs.investigation_id = "inv_bad_initial_loaded_refs"
    badLoadedRefs.journal_sequence = 0
    badLoadedRefs.objective = "bad initial loaded refs"
    badLoadedRefs.objective_hash = stableHash("bad initial loaded refs")
    badLoadedRefs.occurred_at = "2026-01-01T00:00:09.000Z"
    ;(badLoadedRefs.initial_checkpoint as Record<string, unknown>).investigation_id = "inv_bad_initial_loaded_refs"
    badLoadedRefs.initial_loaded_tool_refs = [null]
    badLoadedRefs.event_payload_hash = journalPayloadHash(badLoadedRefs)
    await store.append(badLoadedRefs as Parameters<EventStore["append"]>[0])
    const badStartedMissingPhase = structuredClone(seedStarted!) as Record<string, unknown>
    badStartedMissingPhase.investigation_id = "inv_bad_started_missing_phase"
    badStartedMissingPhase.journal_sequence = 0
    badStartedMissingPhase.objective = "bad started missing phase"
    badStartedMissingPhase.objective_hash = stableHash("bad started missing phase")
    badStartedMissingPhase.occurred_at = "2026-01-01T00:00:09.500Z"
    ;(badStartedMissingPhase.initial_checkpoint as Record<string, unknown>).investigation_id = "inv_bad_started_missing_phase"
    delete badStartedMissingPhase.phase
    badStartedMissingPhase.event_payload_hash = journalPayloadHash(badStartedMissingPhase)
    await store.append(badStartedMissingPhase as Parameters<EventStore["append"]>[0])
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
    const badReplayInput = baseInvestigation({ investigation_id: "inv_bad_replay_exchange", objective: "bad replay exchange" })
    const badReplayRun = await service.createObserver(badReplayInput)
    await badReplayRun.observer.onStarted(durableStartedSnapshot(badReplayInput, 15, "inv_bad_replay_exchange") as Parameters<typeof badReplayRun.observer.onStarted>[0])
    const badReplayInitial = await service.latestCheckpoint("inv_bad_replay_exchange")
    expect(badReplayInitial).toBeDefined()
    await badReplayRun.observer.onModelStepStarted({
      investigation_id: "inv_bad_replay_exchange",
      input: badReplayInput,
      turn_index: 1,
      model_request_id: "model_request_bad_replay",
      tool_protocol: "native",
      working_set_hash: badReplayInitial!.working_set.working_set_hash,
      context_hash: "context_hash_bad_replay",
      input_bytes: 128,
      estimated_input_tokens: 32,
      loaded_tools: [],
      provider_request_count_before: 0,
      external_api_audit_count_before: 0,
      started_at: "2026-01-01T00:00:11.500Z",
    })
    service.release(badReplayRun)
    const badReplayCheckpoint = {
      ...badReplayInitial!,
      checkpoint_id: "bad_replay_checkpoint",
      checkpoint_sequence: 1,
      checkpoint_kind: "turn_complete" as const,
      turn_index: 1,
      next_turn_index: 2,
      previous_checkpoint_id: badReplayInitial!.checkpoint_id,
      previous_checkpoint_hash: badReplayInitial!.checkpoint_hash,
      replay_exchange: {
        turn_index: 1,
        assistant_message: { role: "assistant", content: null },
        tool_result_messages: [null],
        exchange_hash: "bad_replay_exchange_hash",
        summary_only: true,
        full_tool_results_persisted: false,
      },
      working_set: { ...badReplayInitial!.working_set, model_turn_count: 1 },
      checkpoint_hash: "",
    }
    badReplayCheckpoint.checkpoint_hash = stableHash({ ...badReplayCheckpoint, checkpoint_hash: "" })
    const badReplayCheckpointEvent = {
      kind: "runtime_commander_investigation_checkpointed",
      schema_version: 1,
      investigation_id: "inv_bad_replay_exchange",
      journal_sequence: 2,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:00:12.000Z",
      checkpoint: badReplayCheckpoint,
      event_payload_hash: "",
    }
    badReplayCheckpointEvent.event_payload_hash = journalPayloadHash(badReplayCheckpointEvent)
    await store.append(badReplayCheckpointEvent as Parameters<EventStore["append"]>[0])
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
    const badFinalSummaryRecord = await service.get("inv_bad_final_summary_terminal")
    expect(badFinalSummaryRecord).toMatchObject({ projection_status: "corrupt", status: "running", recovery_state: "checkpoint_available_resume_not_implemented", checkpoint_available: true })
    expect(badFinalSummaryRecord?.integrity_errors.join("\n")).toContain("malformed terminal payload")
    const persistedTranscriptRecord = await service.get("inv_terminal_persisted_transcript")
    expect(persistedTranscriptRecord).toMatchObject({ projection_status: "corrupt", status: "running", recovery_state: "checkpoint_available_resume_not_implemented", checkpoint_available: true })
    expect(persistedTranscriptRecord?.integrity_errors.join("\n")).toContain("malformed terminal payload")
    const malformedMembersRecord = await service.get("inv_terminal_malformed_members")
    expect(malformedMembersRecord).toMatchObject({ projection_status: "corrupt", status: "running", recovery_state: "checkpoint_available_resume_not_implemented", checkpoint_available: true })
    expect(malformedMembersRecord?.integrity_errors.join("\n")).toContain("malformed terminal payload")
    const rawAssistantTerminalRecord = await service.get("inv_terminal_raw_assistant_preview")
    expect(rawAssistantTerminalRecord).toMatchObject({ projection_status: "corrupt", status: "running", recovery_state: "checkpoint_available_resume_not_implemented", checkpoint_available: true })
    expect(rawAssistantTerminalRecord?.integrity_errors.join("\n")).toContain("malformed terminal payload")
    const badAuditTransportRecord = await service.get("inv_terminal_bad_audit_transport")
    expect(badAuditTransportRecord).toMatchObject({ projection_status: "corrupt", status: "running", recovery_state: "checkpoint_available_resume_not_implemented", checkpoint_available: true })
    expect(badAuditTransportRecord?.integrity_errors.join("\n")).toContain("malformed terminal payload")
    const malformedCheckpointTurnRecord = await service.get("inv_checkpoint_malformed_turn_summary")
    expect(malformedCheckpointTurnRecord).toMatchObject({ projection_status: "corrupt", checkpoint_available: true, latest_checkpoint_id: malformedCheckpointTurnInitial!.checkpoint_id })
    expect(malformedCheckpointTurnRecord?.integrity_errors.join("\n")).toContain("malformed checkpoint payload")
    expect(await service.getCheckpoint(malformedCheckpointTurn.checkpoint_id)).toBeUndefined()
    const badCheckpointAuditRecord = await service.get("inv_checkpoint_bad_provider_audit")
    expect(badCheckpointAuditRecord).toMatchObject({ projection_status: "corrupt", checkpoint_available: true, latest_checkpoint_id: badCheckpointAuditInitial!.checkpoint_id })
    expect(badCheckpointAuditRecord?.integrity_errors.join("\n")).toContain("malformed checkpoint payload")
    expect(await service.getCheckpoint(badCheckpointAudit.checkpoint_id)).toBeUndefined()
    const inconsistentOptionalAuditRecord = await service.get("inv_checkpoint_inconsistent_optional_audit")
    expect(inconsistentOptionalAuditRecord).toMatchObject({ projection_status: "corrupt", checkpoint_available: true, latest_checkpoint_id: inconsistentOptionalAuditInitial!.checkpoint_id })
    expect(inconsistentOptionalAuditRecord?.integrity_errors.join("\n")).toContain("malformed checkpoint payload")
    expect(await service.getCheckpoint(inconsistentOptionalAudit.checkpoint_id)).toBeUndefined()
    const checkpointWithoutBoundaryRecord = await service.get("inv_projected_checkpoint_without_boundary")
    expect(checkpointWithoutBoundaryRecord).toMatchObject({ projection_status: "corrupt", latest_checkpoint_id: checkpointWithoutBoundaryInitial!.checkpoint_id, checkpoint_available: true })
    expect(checkpointWithoutBoundaryRecord?.integrity_errors.join("\n")).toContain("checkpoint missing model-step boundary")
    expect(await service.getCheckpoint("checkpoint_without_model_step_boundary")).toBeUndefined()
    const badInitialRecord = await service.get("inv_bad_initial_chain")
    expect(badInitialRecord).toMatchObject({ projection_status: "corrupt", checkpoint_available: false, recovery_state: "no_checkpoint_resume_not_implemented" })
    expect(badInitialRecord?.integrity_errors.join("\n")).toContain("initial checkpoint investigation_id mismatch")
    expect(await service.latestCheckpoint("inv_bad_initial_chain")).toBeUndefined()
    const badLoadedRefsRecord = await service.get("inv_bad_initial_loaded_refs")
    expect(badLoadedRefsRecord).toMatchObject({ projection_status: "corrupt", checkpoint_available: false, recovery_state: "no_checkpoint_resume_not_implemented" })
    expect(badLoadedRefsRecord?.integrity_errors.join("\n")).toContain("malformed started payload")
    const badStartedMissingPhaseRecord = await service.get("inv_bad_started_missing_phase")
    expect(badStartedMissingPhaseRecord).toMatchObject({ projection_status: "corrupt", checkpoint_available: false, recovery_state: "no_checkpoint_resume_not_implemented" })
    expect(badStartedMissingPhaseRecord?.integrity_errors.join("\n")).toContain("malformed started payload")
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
    const badReplayRecord = await service.get("inv_bad_replay_exchange")
    expect(badReplayRecord).toMatchObject({ projection_status: "corrupt", latest_checkpoint_id: badReplayInitial!.checkpoint_id, checkpoint_available: true, uncertain_provider_outcome: true })
    expect(badReplayRecord?.integrity_errors.join("\n")).toContain("malformed checkpoint payload")
    expect(await service.getCheckpoint("bad_replay_checkpoint")).toBeUndefined()
    const postTerminal = await service.get("inv_post_terminal_checkpoint")
    expect(postTerminal).toMatchObject({ projection_status: "corrupt", status: "final", recovery_state: "not_required", latest_checkpoint_id: postTerminalInitial!.checkpoint_id })
    expect(postTerminal?.integrity_errors.join("\n")).toContain("investigation event appears after terminal event")
    expect(await service.latestCheckpoint("inv_post_terminal_checkpoint")).toEqual(postTerminalInitial)
    expect(await service.getCheckpoint("post_terminal_bad_checkpoint")).toBeUndefined()
    const valid = await service.get("inv_valid_after_malformed")
    expect(valid).toMatchObject({ investigation_id: "inv_valid_after_malformed", projection_status: "ready", checkpoint_available: true })
    const summary = await service.summary()
    expect(summary).toMatchObject({ total: 27, running_count: 26, terminal_count: 1, final_count: 1, checkpoint_available_count: 22, uncertain_provider_outcome_count: 3, corrupt_count: 24 })
  })

  test("durable journal projection rejects hash-valid immutable identity drift", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-identity-drift-"))
    await writeApprovedSpec(projectDir)
    const server = new RuntimeServer({
      projectDir,
      adapter: new FakeOpenCodeAdapter(),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "identity drift should not run" }]),
    })
    servers.push({ stop: () => server.shutdown() })
    await server.start()
    const service = new CommanderInvestigationJournalService({ eventStore: server.eventStore })

    async function start(input: ReturnType<typeof baseInvestigation>, index: number) {
      const run = await service.createObserver(input)
      await run.observer.onStarted(durableStartedSnapshot(input, index, input.investigation_id!) as Parameters<typeof run.observer.onStarted>[0])
      const checkpoint = await service.latestCheckpoint(input.investigation_id!)
      expect(checkpoint).toBeDefined()
      service.release(run)
      return checkpoint!
    }

    async function appendModelStep(input: ReturnType<typeof baseInvestigation>, checkpoint: CommanderInvestigationCheckpoint) {
      const event = {
        kind: "runtime_commander_investigation_model_step_started",
        schema_version: 1,
        investigation_id: input.investigation_id!,
        journal_sequence: 1,
        turn_index: 1,
        model_request_id: `model_request_${input.investigation_id}`,
        provider_id: input.provider_id,
        provider_kind: input.provider_kind,
        model_id: input.model_id,
        tool_protocol: "native",
        base_checkpoint_id: checkpoint.checkpoint_id,
        base_checkpoint_sequence: checkpoint.checkpoint_sequence,
        base_checkpoint_hash: checkpoint.checkpoint_hash,
        working_set_hash: checkpoint.working_set.working_set_hash,
        context_hash: `context_hash_${input.investigation_id}`,
        input_bytes: 128,
        estimated_input_tokens: 32,
        loaded_tool_refs: [],
        provider_request_count_before: 0,
        external_api_audit_count_before: 0,
        started_at: "2026-01-01T00:01:00.000Z",
        requested_by: input.requested_by,
        occurred_at: "2026-01-01T00:01:00.000Z",
        event_payload_hash: "",
      }
      event.event_payload_hash = journalPayloadHash(event)
      await server.eventStore.append(event as Parameters<EventStore["append"]>[0])
    }

    async function appendHashValidStartedDrift(name: string, mutate: (event: Record<string, unknown>) => Record<string, unknown>) {
      const objective = `started drift ${name}`
      const input = baseInvestigation({ investigation_id: `inv_started_${name}`, objective })
      const template = await start(baseInvestigation({ investigation_id: `inv_started_template_${name}`, objective: `template ${name}` }), 40 + name.length)
      const checkpoint = finalizeTestCheckpoint({
        ...template,
        investigation_id: input.investigation_id!,
        phase: input.phase,
        objective_hash: stableHash(objective),
        provider_id: input.provider_id,
        provider_kind: input.provider_kind,
        model_id: input.model_id,
        tool_protocol: "native",
        working_set: { ...template.working_set, phase: input.phase, objective_preview: objective },
      })
      const normalizedInput = { ...input }
      const event = mutate({
        kind: "runtime_commander_investigation_started",
        schema_version: 1,
        investigation_id: input.investigation_id!,
        journal_sequence: 0,
        requested_by: input.requested_by,
        occurred_at: "2026-01-01T00:04:00.000Z",
        normalized_input: normalizedInput,
        input_hash: stableHash(normalizedInput),
        phase: input.phase,
        objective,
        objective_hash: stableHash(objective),
        provider_id: input.provider_id,
        provider_kind: input.provider_kind,
        model_id: input.model_id,
        tool_protocol: "native",
        budget: checkpoint.budget,
        budget_hash: checkpoint.budget.budget_hash,
        bootstrap_ref: checkpoint.bootstrap_ref,
        initial_loaded_tool_refs: checkpoint.loaded_tools,
        initial_checkpoint: checkpoint,
        started_at: "2026-01-01T00:04:00.000Z",
        summary_preview: objective,
        event_payload_hash: "",
      })
      event.event_payload_hash = journalPayloadHash(event)
      await server.eventStore.append(event as Parameters<EventStore["append"]>[0])
      const record = await service.get(input.investigation_id!)
      expect(record).toMatchObject({ projection_status: "corrupt", checkpoint_available: false })
      const checkpointLookup = await service.latestCheckpoint(input.investigation_id!)
      expect(checkpointLookup).toBeUndefined()
      return record?.integrity_errors.join("\n") ?? ""
    }

    async function appendHashValidCheckpointDrift(name: string, mutate: (checkpoint: CommanderInvestigationCheckpoint) => CommanderInvestigationCheckpoint) {
      const input = baseInvestigation({ investigation_id: `inv_identity_${name}`, objective: `identity drift ${name}` })
      const initial = await start(input, 20 + name.length)
      await appendModelStep(input, initial)
      const checkpoint = finalizeTestCheckpoint(mutate({
        ...initial,
        checkpoint_sequence: 1,
        checkpoint_kind: "turn_complete",
        turn_index: 1,
        next_turn_index: 2,
        previous_checkpoint_id: initial.checkpoint_id,
        previous_checkpoint_hash: initial.checkpoint_hash,
        working_set: { ...initial.working_set, model_turn_count: 1 },
      }))
      const event = {
        kind: "runtime_commander_investigation_checkpointed",
        schema_version: 1,
        investigation_id: input.investigation_id!,
        journal_sequence: 2,
        requested_by: "tester",
        occurred_at: "2026-01-01T00:01:01.000Z",
        checkpoint,
        event_payload_hash: "",
      }
      event.event_payload_hash = journalPayloadHash(event)
      await server.eventStore.append(event as Parameters<EventStore["append"]>[0])
      const record = await service.get(input.investigation_id!)
      expect(record).toMatchObject({ projection_status: "corrupt", latest_checkpoint_id: initial.checkpoint_id })
      expect(await service.getCheckpoint(checkpoint.checkpoint_id)).toBeUndefined()
      return record?.integrity_errors.join("\n") ?? ""
    }

    expect(await appendHashValidCheckpointDrift("provider", (checkpoint) => ({ ...checkpoint, provider_id: "provider-B" }))).toContain("checkpoint provider_id identity mismatch")
    expect(await appendHashValidCheckpointDrift("model", (checkpoint) => ({ ...checkpoint, model_id: "model-B" }))).toContain("checkpoint model_id identity mismatch")
    expect(await appendHashValidCheckpointDrift("phase", (checkpoint) => ({ ...checkpoint, phase: "governance_review" }))).toContain("checkpoint phase identity mismatch")
    expect(await appendHashValidCheckpointDrift("objective", (checkpoint) => ({ ...checkpoint, objective_hash: "objective-hash-B" }))).toContain("checkpoint objective_hash identity mismatch")
    expect(await appendHashValidCheckpointDrift("bootstrap", (checkpoint) => ({ ...checkpoint, bootstrap_ref: { bootstrap_id: "bootstrap-B", bootstrap_hash: "bootstrap-hash-B" } }))).toContain("checkpoint bootstrap_id identity mismatch")
    expect(await appendHashValidCheckpointDrift("budget", (checkpoint) => {
      const budget = { ...checkpoint.budget, budget_id: "budget-B", budget_hash: "" }
      budget.budget_hash = stableHash({ ...budget, budget_hash: "" })
      return { ...checkpoint, budget }
    })).toContain("checkpoint budget_id identity mismatch")

    expect(await appendHashValidStartedDrift("missing_input", (event) => {
      delete event.normalized_input
      return event
    })).toContain("malformed started payload")
    expect(await appendHashValidStartedDrift("missing_input_hash", (event) => {
      delete event.input_hash
      return event
    })).toContain("malformed started payload")
    expect(await appendHashValidStartedDrift("bad_input_hash", (event) => ({ ...event, input_hash: "bad_input_hash" }))).toContain("started input_hash mismatch")
    expect(await appendHashValidStartedDrift("input_objective", (event) => {
      const normalized_input = { ...(event.normalized_input as Record<string, unknown>), objective: "normalized objective B" }
      return { ...event, normalized_input, input_hash: stableHash(normalized_input) }
    })).toContain("started normalized_input objective mismatch")
    expect(await appendHashValidStartedDrift("input_provider", (event) => {
      const normalized_input = { ...(event.normalized_input as Record<string, unknown>), provider_id: "provider-B", model_id: "model-B" }
      return { ...event, normalized_input, input_hash: stableHash(normalized_input) }
    })).toContain("started normalized_input provider_id mismatch")
    expect(await appendHashValidStartedDrift("input_linkage", (event) => {
      const normalized_input = { ...(event.normalized_input as Record<string, unknown>), session_id: "session-B", mission_id: "mission-B" }
      return { ...event, normalized_input, input_hash: stableHash(normalized_input) }
    })).toContain("started normalized_input mission_id mismatch")
    expect(await appendHashValidStartedDrift("incomplete_budget", (event) => {
      const budget = { budget_id: "budget_incomplete", budget_hash: "" }
      budget.budget_hash = stableHash({ ...budget, budget_hash: "" })
      const initial_checkpoint = finalizeTestCheckpoint({ ...(event.initial_checkpoint as CommanderInvestigationCheckpoint), budget: budget as unknown as CommanderInvestigationCheckpoint["budget"] })
      return { ...event, budget, budget_hash: budget.budget_hash, initial_checkpoint }
    })).toContain("malformed started payload")
    expect(await appendHashValidStartedDrift("over_cap_budget", (event) => {
      const budget = { ...((event.budget as CommanderInvestigationCheckpoint["budget"])), max_model_turns: 25, budget_hash: "" }
      budget.budget_hash = stableHash({ ...budget, budget_hash: "" })
      const initial_checkpoint = finalizeTestCheckpoint({ ...(event.initial_checkpoint as CommanderInvestigationCheckpoint), budget })
      return { ...event, budget, budget_hash: budget.budget_hash, initial_checkpoint }
    })).toContain("malformed started payload")

    const initialRefsInput = baseInvestigation({ investigation_id: "inv_identity_initial_refs", objective: "identity initial refs drift" })
    const initialRefs = await start(initialRefsInput, 31)
    const initialRefsBad = finalizeTestCheckpoint({ ...initialRefs, investigation_id: "inv_identity_initial_refs_bad" })
    const startedEvent = {
      kind: "runtime_commander_investigation_started",
      schema_version: 1,
      investigation_id: "inv_identity_initial_refs_bad",
      journal_sequence: 0,
      requested_by: initialRefsInput.requested_by,
      occurred_at: "2026-01-01T00:02:00.000Z",
      normalized_input: { ...initialRefsInput, investigation_id: "inv_identity_initial_refs_bad" },
      input_hash: stableHash({ ...initialRefsInput, investigation_id: "inv_identity_initial_refs_bad" }),
      phase: initialRefsBad.phase,
      objective: "identity initial refs drift",
      objective_hash: initialRefsBad.objective_hash,
      provider_id: initialRefsBad.provider_id,
      provider_kind: initialRefsBad.provider_kind,
      model_id: initialRefsBad.model_id,
      tool_protocol: initialRefsBad.tool_protocol,
      budget: initialRefsBad.budget,
      budget_hash: initialRefsBad.budget.budget_hash,
      bootstrap_ref: initialRefsBad.bootstrap_ref,
      initial_loaded_tool_refs: [{ tool_id: "memory.search", descriptor_version: "v1", authority_id: "authority", input_schema_hash: "input", output_schema_hash: "output", load_policy: "deferred", trust_class: "runtime_authoritative", instruction_semantics: "none", max_output_bytes: 1000, timeout_ms: 100 }],
      initial_checkpoint: initialRefsBad,
      started_at: "2026-01-01T00:02:00.000Z",
      summary_preview: "identity initial refs drift",
      event_payload_hash: "",
    }
    startedEvent.event_payload_hash = journalPayloadHash(startedEvent)
    await server.eventStore.append(startedEvent as Parameters<EventStore["append"]>[0])
    const badRefs = await service.get("inv_identity_initial_refs_bad")
    expect(badRefs).toMatchObject({ projection_status: "corrupt", checkpoint_available: false })
    expect(badRefs?.integrity_errors.join("\n")).toContain("initial checkpoint loaded-tool references mismatch started event")

    const fakeLoadedToolRef: CommanderInvestigationLoadedToolRef = { tool_id: "memory.search", descriptor_version: "v1", authority_id: "authority", input_schema_hash: "input", output_schema_hash: "output", load_policy: "deferred", trust_class: "runtime_authoritative", instruction_semantics: "none", max_output_bytes: 1000, timeout_ms: 100 }
    const modelLoadedInput = baseInvestigation({ investigation_id: "inv_identity_model_loaded_refs", objective: "model loaded refs drift" })
    const modelLoadedInitial = await start(modelLoadedInput, 32)
    const modelLoadedEvent = {
      kind: "runtime_commander_investigation_model_step_started",
      schema_version: 1,
      investigation_id: modelLoadedInput.investigation_id!,
      journal_sequence: 1,
      turn_index: 1,
      model_request_id: "model_request_loaded_refs_drift",
      provider_id: modelLoadedInput.provider_id,
      provider_kind: modelLoadedInput.provider_kind,
      model_id: modelLoadedInput.model_id,
      tool_protocol: "native",
      base_checkpoint_id: modelLoadedInitial.checkpoint_id,
      base_checkpoint_sequence: modelLoadedInitial.checkpoint_sequence,
      base_checkpoint_hash: modelLoadedInitial.checkpoint_hash,
      working_set_hash: modelLoadedInitial.working_set.working_set_hash,
      context_hash: "context_hash_loaded_refs_drift",
      input_bytes: 128,
      estimated_input_tokens: 32,
      loaded_tool_refs: [fakeLoadedToolRef],
      provider_request_count_before: 0,
      external_api_audit_count_before: 0,
      started_at: "2026-01-01T00:02:30.000Z",
      requested_by: "tester",
      occurred_at: "2026-01-01T00:02:30.000Z",
      event_payload_hash: "",
    }
    modelLoadedEvent.event_payload_hash = journalPayloadHash(modelLoadedEvent)
    await server.eventStore.append(modelLoadedEvent as Parameters<EventStore["append"]>[0])
    const modelLoadedRecord = await service.get("inv_identity_model_loaded_refs")
    expect(modelLoadedRecord).toMatchObject({ projection_status: "corrupt", latest_checkpoint_id: modelLoadedInitial.checkpoint_id })
    expect(modelLoadedRecord?.integrity_errors.join("\n")).toContain("model-step loaded_tool_refs mismatch base checkpoint")

    expect(await appendHashValidCheckpointDrift("checkpoint_loaded_ids", (checkpoint) => ({ ...checkpoint, loaded_tools: [fakeLoadedToolRef], working_set: { ...checkpoint.working_set, loaded_tool_ids: [] } }))).toContain("checkpoint loaded_tools mismatch working_set.loaded_tool_ids")
    expect(await appendHashValidCheckpointDrift("checkpoint_incomplete_budget", (checkpoint) => {
      const budget = { budget_id: "budget_checkpoint_incomplete", budget_hash: "" }
      budget.budget_hash = stableHash({ ...budget, budget_hash: "" })
      return { ...checkpoint, budget: budget as unknown as CommanderInvestigationCheckpoint["budget"] }
    })).toContain("malformed checkpoint payload")
    expect(await appendHashValidCheckpointDrift("checkpoint_over_cap_budget", (checkpoint) => {
      const budget = { ...checkpoint.budget, max_model_turns: 25, budget_hash: "" }
      budget.budget_hash = stableHash({ ...budget, budget_hash: "" })
      return { ...checkpoint, budget }
    })).toContain("malformed checkpoint payload")

    const terminalInput = baseInvestigation({ investigation_id: "inv_identity_terminal", objective: "identity terminal drift" })
    const terminalCheckpoint = await start(terminalInput, 33)
    const terminal: CommanderInvestigationTerminalRecord = {
      schema_version: 1,
      investigation_id: "inv_identity_terminal",
      status: "final",
      stop_reason: "model_final",
      phase: terminalCheckpoint.phase,
      objective_hash: terminalCheckpoint.objective_hash,
      provider_id: "provideruniquexyz",
      provider_kind: terminalCheckpoint.provider_kind,
      model_id: terminalCheckpoint.model_id,
      tool_protocol: terminalCheckpoint.tool_protocol,
      final_output: { text_persisted: false, text_hash: "text_hash_terminal", text_chars: 10 },
      conclusion: { status: "final", stop_reason: "model_final", evidence_ids: [], evidence_titles: [], safe_evidence_summaries: [], blockers: [], warnings: [], final_output_text_hash: "text_hash_terminal" },
      bootstrap_id: terminalCheckpoint.bootstrap_ref.bootstrap_id,
      bootstrap_hash: terminalCheckpoint.bootstrap_ref.bootstrap_hash,
      budget_id: terminalCheckpoint.budget.budget_id,
      budget_hash: terminalCheckpoint.budget.budget_hash,
      last_checkpoint_id: terminalCheckpoint.checkpoint_id,
      last_checkpoint_sequence: terminalCheckpoint.checkpoint_sequence,
      last_checkpoint_hash: terminalCheckpoint.checkpoint_hash,
      model_turn_count: 0,
      provider_request_count: 0,
      tool_call_count: 0,
      tool_search_call_count: 0,
      loaded_tool_ids: [],
      evidence_cards: [],
      turn_summaries: [],
      omitted_evidence_count: 0,
      omitted_turn_count: 0,
      provider_audit: terminalCheckpoint.working_set.provider_audit,
      blockers: [],
      warnings: [],
      semantic_result_hash: "semantic_terminal_identity",
      started_at: "2026-01-01T00:03:00.000Z",
      completed_at: "2026-01-01T00:03:01.000Z",
      terminal_hash: "",
      transcript_persisted: false,
      raw_tool_results_persisted: false,
      chain_of_thought_persisted: false,
    }
    terminal.terminal_hash = stableHash({ ...terminal, terminal_hash: "" })
    const terminalEvent = {
      kind: "runtime_commander_investigation_finished",
      schema_version: 1,
      investigation_id: "inv_identity_terminal",
      journal_sequence: 1,
      requested_by: "tester",
      occurred_at: "2026-01-01T00:03:01.000Z",
      terminal,
      event_payload_hash: "",
    }
    terminalEvent.event_payload_hash = journalPayloadHash(terminalEvent)
    await server.eventStore.append(terminalEvent as Parameters<EventStore["append"]>[0])
    const terminalRecord = await service.get("inv_identity_terminal")
    expect(terminalRecord).toMatchObject({ projection_status: "corrupt", status: "running" })
    expect(terminalRecord?.integrity_errors.join("\n")).toContain("terminal provider_id identity mismatch")

    const corruptSearch = await server.searchCommanderOperationalMemory({ query: "provideruniquexyz", source_kinds: ["commander_investigation"] })
    expect(corruptSearch.result?.candidates).toEqual([])

    async function appendHashValidTerminalDrift(name: string, mutate: (terminal: CommanderInvestigationTerminalRecord, checkpoint: CommanderInvestigationCheckpoint) => CommanderInvestigationTerminalRecord) {
      const input = baseInvestigation({ investigation_id: `inv_terminal_${name}`, objective: `terminal drift ${name}` })
      const checkpoint = await start(input, 50 + name.length)
      let terminalRecord: CommanderInvestigationTerminalRecord = {
        schema_version: 1,
        investigation_id: input.investigation_id!,
        status: "final",
        stop_reason: "model_final",
        phase: checkpoint.phase,
        objective_hash: checkpoint.objective_hash,
        provider_id: checkpoint.provider_id,
        provider_kind: checkpoint.provider_kind,
        model_id: checkpoint.model_id,
        tool_protocol: checkpoint.tool_protocol,
        final_output: { text_persisted: false, text_hash: "text_hash_terminal_valid", text_chars: 10 },
        conclusion: { status: "final", stop_reason: "model_final", evidence_ids: [], evidence_titles: [], safe_evidence_summaries: [], blockers: [], warnings: [], final_output_text_hash: "text_hash_terminal_valid" },
        bootstrap_id: checkpoint.bootstrap_ref.bootstrap_id,
        bootstrap_hash: checkpoint.bootstrap_ref.bootstrap_hash,
        budget_id: checkpoint.budget.budget_id,
        budget_hash: checkpoint.budget.budget_hash,
        last_checkpoint_id: checkpoint.checkpoint_id,
        last_checkpoint_sequence: checkpoint.checkpoint_sequence,
        last_checkpoint_hash: checkpoint.checkpoint_hash,
        model_turn_count: 0,
        provider_request_count: 0,
        tool_call_count: 0,
        tool_search_call_count: 0,
        loaded_tool_ids: checkpoint.loaded_tools.map((tool) => tool.tool_id),
        evidence_cards: [],
        turn_summaries: [],
        omitted_evidence_count: 0,
        omitted_turn_count: 0,
        provider_audit: checkpoint.working_set.provider_audit,
        blockers: [],
        warnings: [],
        semantic_result_hash: `semantic_terminal_${name}`,
        started_at: "2026-01-01T00:05:00.000Z",
        completed_at: "2026-01-01T00:05:01.000Z",
        terminal_hash: "",
        transcript_persisted: false,
        raw_tool_results_persisted: false,
        chain_of_thought_persisted: false,
      }
      terminalRecord = mutate(terminalRecord, checkpoint)
      terminalRecord.terminal_hash = stableHash({ ...terminalRecord, terminal_hash: "" })
      const event = {
        kind: "runtime_commander_investigation_finished",
        schema_version: 1,
        investigation_id: input.investigation_id!,
        journal_sequence: 1,
        requested_by: "tester",
        occurred_at: "2026-01-01T00:05:01.000Z",
        terminal: terminalRecord,
        event_payload_hash: "",
      }
      event.event_payload_hash = journalPayloadHash(event)
      await server.eventStore.append(event as Parameters<EventStore["append"]>[0])
      const record = await service.get(input.investigation_id!)
      expect(record).toMatchObject({ projection_status: "corrupt", status: "running" })
      const search = await server.searchCommanderOperationalMemory({ query: `semantic_terminal_${name}`, source_kinds: ["commander_investigation"] })
      expect(search.result?.candidates).toEqual([])
      return record?.integrity_errors.join("\n") ?? ""
    }

    expect(await appendHashValidTerminalDrift("loaded_ids", (terminalRecord) => ({ ...terminalRecord, loaded_tool_ids: ["memory.search"] }))).toContain("terminal loaded_tool_ids mismatch latest checkpoint")
    expect(await appendHashValidTerminalDrift("conclusion_status", (terminalRecord) => ({ ...terminalRecord, conclusion: { ...terminalRecord.conclusion, status: "failed" } }))).toContain("terminal conclusion status mismatch")
    expect(await appendHashValidTerminalDrift("conclusion_stop", (terminalRecord) => ({ ...terminalRecord, conclusion: { ...terminalRecord.conclusion, stop_reason: "provider_failed" } }))).toContain("terminal conclusion stop_reason mismatch")
    expect(await appendHashValidTerminalDrift("final_output_hash", (terminalRecord) => ({ ...terminalRecord, conclusion: { ...terminalRecord.conclusion, final_output_text_hash: "different_text_hash" } }))).toContain("terminal conclusion final_output_text_hash mismatch")
    expect(await appendHashValidTerminalDrift("conclusion_evidence", (terminalRecord) => {
      const card = evidenceCard("evidence_terminal_conclusion_drift")
      return {
        ...terminalRecord,
        evidence_cards: [card],
        conclusion: { ...terminalRecord.conclusion, evidence_ids: [], evidence_titles: [card.title], safe_evidence_summaries: [card.summary_preview] },
      }
    })).toContain("terminal conclusion evidence_ids mismatch")
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

  test("recovery preview classifies checkpoint pending terminal and corrupt records without execution", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3b1-recovery-classification-"))
    await writeApprovedSpec(projectDir)
    const server = configuredProviderRuntimeServer(projectDir)
    servers.push({ stop: () => server.shutdown() })
    const service = new CommanderInvestigationJournalService({ eventStore: server.eventStore })

    async function startOnly(id: string, index: number, overrides: Partial<ReturnType<typeof baseInvestigation>> = {}) {
      const input = baseInvestigation({ investigation_id: id, provider_id: "fixture_provider", provider_kind: "openai", model_id: "fixture-model", tool_protocol: "native", ...overrides })
      const run = await service.createObserver(input)
      const snapshot = durableStartedSnapshot(input, index, id) as any
      snapshot.budget = { ...snapshot.budget, max_context_bytes: 8192, budget_hash: "" }
      snapshot.budget.budget_hash = stableHash({ ...snapshot.budget, budget_hash: "" })
      await run.observer.onStarted(snapshot as Parameters<typeof run.observer.onStarted>[0])
      service.release(run)
      return { input, checkpoint: (await service.latestCheckpoint(id))! }
    }

    const checkpointed = await startOnly("inv_recovery_checkpoint", 1)
    const source = await server.getCommanderInvestigationRecoverySource("inv_recovery_checkpoint")
    expect(source).toMatchObject({
      projection_status: "ready",
      normalized_input: { investigation_id: "inv_recovery_checkpoint", provider_id: "fixture_provider" },
      latest_checkpoint: { checkpoint_id: checkpointed.checkpoint.checkpoint_id },
    })
    expect(source?.pending_model_step).toBeUndefined()
    const checkpointPreview = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_checkpoint", include_current_continuity: false })
    expect(checkpointPreview).toMatchObject({
      status: "ready_for_approval",
      recovery_kind: "checkpoint",
      recommended_action: "approve_resume_from_checkpoint",
      automatic_resume_allowed: false,
      exact_replay_supported: false,
      original_assistant_text_available: false,
      provider_request_replay_allowed: false,
      tool_execution_replay_allowed: false,
      fresh_context_required: true,
      network_called: false,
      provider_called: false,
      tool_executed: false,
      events_appended: false,
    })
    expect(checkpointPreview.checkpoint).toMatchObject({ checkpoint_id: checkpointed.checkpoint.checkpoint_id, assistant_text_persisted: false, exact_replay_supported: false })
    expect(checkpointPreview.recovery_packet?.checkpoint_ref?.checkpoint_hash).toBe(checkpointed.checkpoint.checkpoint_hash)
    expect(checkpointPreview.provider_compatibility.execution_envelope).toMatchObject({ connector_id: "openai-test", max_output_tokens: 1024, supports_streaming: false })
    expect(checkpointPreview.recovery_packet?.provider_execution_envelope_hash).toBe(checkpointPreview.provider_compatibility.execution_envelope?.execution_envelope_hash)
    expect(JSON.stringify(checkpointPreview)).not.toContain("https://api.example.test")
    expect(JSON.stringify(checkpointPreview)).not.toContain("NXL_TEST_MODEL_KEY")
    expect(JSON.stringify(checkpointPreview)).not.toContain("real-provider-key")
    expect(checkpointPreview.recovery_plan_hash).toBeString()

    const terminalCheckpointBase = await startOnly("inv_recovery_terminal_checkpoint_only", 7)
    const terminalCheckpointModelStep = {
      kind: "runtime_commander_investigation_model_step_started",
      schema_version: 1,
      investigation_id: "inv_recovery_terminal_checkpoint_only",
      journal_sequence: 1,
      turn_index: 1,
      model_request_id: "model_request_terminal_checkpoint_only",
      provider_id: terminalCheckpointBase.input.provider_id,
      provider_kind: terminalCheckpointBase.input.provider_kind,
      model_id: terminalCheckpointBase.input.model_id,
      tool_protocol: "native",
      base_checkpoint_id: terminalCheckpointBase.checkpoint.checkpoint_id,
      base_checkpoint_sequence: terminalCheckpointBase.checkpoint.checkpoint_sequence,
      base_checkpoint_hash: terminalCheckpointBase.checkpoint.checkpoint_hash,
      working_set_hash: terminalCheckpointBase.checkpoint.working_set.working_set_hash,
      context_hash: "context_hash_terminal_checkpoint_only",
      input_bytes: 128,
      estimated_input_tokens: 32,
      loaded_tool_refs: terminalCheckpointBase.checkpoint.loaded_tools,
      provider_request_count_before: 0,
      external_api_audit_count_before: 0,
      started_at: "2026-01-01T00:00:30.000Z",
      requested_by: terminalCheckpointBase.input.requested_by,
      occurred_at: "2026-01-01T00:00:30.000Z",
      event_payload_hash: "",
    }
    terminalCheckpointModelStep.event_payload_hash = journalPayloadHash(terminalCheckpointModelStep)
    await server.eventStore.append(terminalCheckpointModelStep as Parameters<EventStore["append"]>[0])
    const terminalCheckpoint = finalizeTestCheckpoint({
      ...terminalCheckpointBase.checkpoint,
      checkpoint_sequence: 1,
      checkpoint_kind: "turn_complete",
      turn_index: 1,
      next_turn_index: 2,
      previous_checkpoint_id: terminalCheckpointBase.checkpoint.checkpoint_id,
      previous_checkpoint_hash: terminalCheckpointBase.checkpoint.checkpoint_hash,
      provider_request_count: 1,
      external_api_audit_count: 0,
      working_set: { ...terminalCheckpointBase.checkpoint.working_set, model_turn_count: 1 },
      turn_summaries: [{
        turn_index: 1,
        model_request_id: "model_request_terminal_checkpoint_only",
        model_result_hash: "model_result_hash_terminal_checkpoint_only",
        model_status: "final",
        provider_request_count: 1,
        assistant_text_preview: undefined,
        tool_call_ids: [],
        tool_ids: [],
        tool_execution_ids: [],
        tool_execution_statuses: [],
        newly_loaded_tool_ids: [],
        new_evidence_ids: [],
        input_estimated_tokens: 32,
        input_bytes: 128,
        cumulative_tool_calls: 0,
        progress_made: true,
        no_progress_reasons: [],
        warnings: [],
        provider_audit_request_ids: [],
        provider_audit_event_kinds: [],
        provider_audit_event_count: 0,
        provider_audit_complete: true,
        turn_hash: "turn_hash_terminal_checkpoint_only",
      }],
    })
    const terminalCheckpointEvent = {
      kind: "runtime_commander_investigation_checkpointed",
      schema_version: 1,
      investigation_id: "inv_recovery_terminal_checkpoint_only",
      journal_sequence: 2,
      requested_by: "test",
      occurred_at: "2026-01-01T00:00:31.000Z",
      checkpoint: terminalCheckpoint,
      event_payload_hash: "",
    }
    terminalCheckpointEvent.event_payload_hash = journalPayloadHash(terminalCheckpointEvent)
    await server.eventStore.append(terminalCheckpointEvent as Parameters<EventStore["append"]>[0])
    const terminalCheckpointSource = await server.getCommanderInvestigationRecoverySource("inv_recovery_terminal_checkpoint_only")
    expect(terminalCheckpointSource).toMatchObject({ projection_status: "ready", latest_checkpoint: { checkpoint_id: terminalCheckpoint.checkpoint_id } })
    const terminalCheckpointPreview = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_terminal_checkpoint_only", include_current_continuity: false })
    expect(terminalCheckpointPreview).toMatchObject({
      status: "blocked",
      recovery_kind: "none",
      recommended_action: "start_new_investigation",
      checkpoint: { checkpoint_id: terminalCheckpoint.checkpoint_id },
      recovery_packet: undefined,
      provider_called: false,
      tool_executed: false,
      events_appended: false,
    })
    expect(terminalCheckpointPreview.blockers.join("\n")).toContain("terminal model status final")
    expect(terminalCheckpointPreview.same_journal_resume_candidate).toBe(false)

    const pending = await startOnly("inv_recovery_pending", 2)
    const pendingEvent = {
      kind: "runtime_commander_investigation_model_step_started",
      schema_version: 1,
      investigation_id: "inv_recovery_pending",
      journal_sequence: 1,
      turn_index: 1,
      model_request_id: "model_request_recovery_pending",
      provider_id: pending.input.provider_id,
      provider_kind: pending.input.provider_kind,
      model_id: pending.input.model_id,
      tool_protocol: "native",
      base_checkpoint_id: pending.checkpoint.checkpoint_id,
      base_checkpoint_sequence: pending.checkpoint.checkpoint_sequence,
      base_checkpoint_hash: pending.checkpoint.checkpoint_hash,
      working_set_hash: pending.checkpoint.working_set.working_set_hash,
      context_hash: "context_hash_recovery_pending",
      input_bytes: 128,
      estimated_input_tokens: 32,
      loaded_tool_refs: pending.checkpoint.loaded_tools,
      provider_request_count_before: 0,
      external_api_audit_count_before: 0,
      started_at: "2026-01-01T00:01:00.000Z",
      requested_by: pending.input.requested_by,
      occurred_at: "2026-01-01T00:01:00.000Z",
      event_payload_hash: "",
    }
    pendingEvent.event_payload_hash = journalPayloadHash(pendingEvent)
    await server.eventStore.append(pendingEvent as Parameters<EventStore["append"]>[0])
    const pendingPreview = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_pending", include_current_continuity: false })
    expect(pendingPreview).toMatchObject({
      status: "human_review_required",
      recovery_kind: "uncertain_provider_outcome",
      recommended_action: "review_uncertain_provider_outcome",
      human_approval_required: true,
      pending_model_step: {
        model_request_id: "model_request_recovery_pending",
        outcome: "uncertain",
        human_disposition_required: true,
        provider_request_may_have_been_sent: true,
        provider_response_available: false,
        tool_execution_known_to_have_occurred: false,
      },
    })
    expect(pendingPreview.warnings.join("\n")).toContain("external API audit counts do not resolve it")

    const terminalBase = await startOnly("inv_recovery_terminal", 4)
    const terminalRecord: CommanderInvestigationTerminalRecord = {
      schema_version: 1,
      investigation_id: "inv_recovery_terminal",
      status: "final",
      stop_reason: "model_final",
      phase: terminalBase.checkpoint.phase,
      objective_hash: terminalBase.checkpoint.objective_hash,
      provider_id: terminalBase.checkpoint.provider_id,
      provider_kind: terminalBase.checkpoint.provider_kind,
      model_id: terminalBase.checkpoint.model_id,
      tool_protocol: terminalBase.checkpoint.tool_protocol,
      final_output: { text_persisted: false, text_hash: "terminal_recovery_hash", text_chars: 12 },
      conclusion: { status: "final", stop_reason: "model_final", evidence_ids: [], evidence_titles: [], safe_evidence_summaries: [], blockers: [], warnings: [], final_output_text_hash: "terminal_recovery_hash" },
      bootstrap_id: terminalBase.checkpoint.bootstrap_ref.bootstrap_id,
      bootstrap_hash: terminalBase.checkpoint.bootstrap_ref.bootstrap_hash,
      budget_id: terminalBase.checkpoint.budget.budget_id,
      budget_hash: terminalBase.checkpoint.budget.budget_hash,
      last_checkpoint_id: terminalBase.checkpoint.checkpoint_id,
      last_checkpoint_sequence: terminalBase.checkpoint.checkpoint_sequence,
      last_checkpoint_hash: terminalBase.checkpoint.checkpoint_hash,
      model_turn_count: 0,
      provider_request_count: 0,
      tool_call_count: 0,
      tool_search_call_count: 0,
      loaded_tool_ids: [],
      evidence_cards: [],
      turn_summaries: [],
      omitted_evidence_count: 0,
      omitted_turn_count: 0,
      provider_audit: terminalBase.checkpoint.working_set.provider_audit,
      blockers: [],
      warnings: [],
      semantic_result_hash: "semantic_recovery_terminal",
      started_at: "2026-01-01T00:03:00.000Z",
      completed_at: "2026-01-01T00:03:01.000Z",
      terminal_hash: "",
      transcript_persisted: false,
      raw_tool_results_persisted: false,
      chain_of_thought_persisted: false,
    }
    terminalRecord.terminal_hash = stableHash({ ...terminalRecord, terminal_hash: "" })
    const terminalEvent = {
      kind: "runtime_commander_investigation_finished",
      schema_version: 1,
      investigation_id: "inv_recovery_terminal",
      journal_sequence: 1,
      requested_by: "test",
      occurred_at: "2026-01-01T00:03:01.000Z",
      terminal: terminalRecord,
      event_payload_hash: "",
    }
    terminalEvent.event_payload_hash = journalPayloadHash(terminalEvent)
    await server.eventStore.append(terminalEvent as Parameters<EventStore["append"]>[0])
    const terminalPreview = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_terminal" })
    expect(terminalPreview).toMatchObject({
      status: "not_applicable",
      recovery_kind: "none",
      recommended_action: "start_new_investigation",
      terminal_continuation_requires_new_investigation: true,
      automatic_resume_allowed: false,
    })

    const corrupt = await startOnly("inv_recovery_corrupt", 3)
    const badCheckpoint = finalizeTestCheckpoint({ ...corrupt.checkpoint, provider_id: "uniquedriftxyz", checkpoint_sequence: 1, checkpoint_kind: "turn_complete", turn_index: 1, next_turn_index: 2, previous_checkpoint_id: corrupt.checkpoint.checkpoint_id, previous_checkpoint_hash: corrupt.checkpoint.checkpoint_hash })
    const badEvent = {
      kind: "runtime_commander_investigation_checkpointed",
      schema_version: 1,
      investigation_id: "inv_recovery_corrupt",
      journal_sequence: 1,
      requested_by: "test",
      occurred_at: "2026-01-01T00:02:00.000Z",
      checkpoint: badCheckpoint,
      event_payload_hash: "",
    }
    badEvent.event_payload_hash = journalPayloadHash(badEvent)
    await server.eventStore.append(badEvent as Parameters<EventStore["append"]>[0])
    const corruptSource = await server.getCommanderInvestigationRecoverySource("inv_recovery_corrupt")
    expect(corruptSource).toMatchObject({ projection_status: "corrupt" })
    expect(corruptSource?.latest_checkpoint).toBeUndefined()
    const corruptPreview = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_corrupt" })
    expect(corruptPreview).toMatchObject({ status: "blocked", recommended_action: "inspect_corrupt_record" })
    const search = await server.searchCommanderOperationalMemory({ query: "uniquedriftxyz", source_kinds: ["commander_investigation"] })
    expect(search.result?.candidates).toEqual([])

    const futureKindBase = await startOnly("inv_recovery_future_kind", 5)
    const futureKindEvent = {
      kind: "runtime_commander_investigation_future_kind_recorded",
      schema_version: 1,
      investigation_id: "inv_recovery_future_kind",
      journal_sequence: 1,
      requested_by: "test",
      occurred_at: "2026-01-01T00:04:00.000Z",
      recovery_plan_hash: "future_plan_hash",
      base_checkpoint_id: futureKindBase.checkpoint.checkpoint_id,
      event_payload_hash: "",
    }
    futureKindEvent.event_payload_hash = journalPayloadHash(futureKindEvent)
    await server.eventStore.append(futureKindEvent as Parameters<EventStore["append"]>[0])
    const futureKindSource = await server.getCommanderInvestigationRecoverySource("inv_recovery_future_kind")
    expect(futureKindSource).toMatchObject({ projection_status: "corrupt", latest_checkpoint: undefined, normalized_input: undefined })
    expect(futureKindSource?.record?.integrity_errors.join("\n")).toContain("unsupported Commander journal event kind")
    const futureKindPreview = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_future_kind", include_current_continuity: false })
    expect(futureKindPreview).toMatchObject({ status: "blocked", recommended_action: "inspect_corrupt_record", checkpoint: undefined })

    const missingTopLevelBase = await startOnly("inv_recovery_missing_top_level", 6)
    const missingTopLevelCheckpoint = finalizeTestCheckpoint({
      ...missingTopLevelBase.checkpoint,
      checkpoint_sequence: 1,
      checkpoint_kind: "turn_complete",
      turn_index: 1,
      next_turn_index: 2,
      previous_checkpoint_id: missingTopLevelBase.checkpoint.checkpoint_id,
      previous_checkpoint_hash: missingTopLevelBase.checkpoint.checkpoint_hash,
    })
    const missingTopLevelEvent = {
      kind: "runtime_commander_investigation_checkpointed",
      schema_version: 1,
      journal_sequence: 1,
      requested_by: "test",
      occurred_at: "2026-01-01T00:05:00.000Z",
      checkpoint: missingTopLevelCheckpoint,
      event_payload_hash: "",
    }
    missingTopLevelEvent.event_payload_hash = journalPayloadHash(missingTopLevelEvent)
    await server.eventStore.append(missingTopLevelEvent as Parameters<EventStore["append"]>[0])
    const missingTopLevelSource = await server.getCommanderInvestigationRecoverySource("inv_recovery_missing_top_level")
    expect(missingTopLevelSource).toMatchObject({ projection_status: "corrupt", latest_checkpoint: undefined, normalized_input: undefined })
    expect(missingTopLevelSource?.record?.integrity_errors.join("\n")).toContain("without top-level investigation_id")
    const missingTopLevelPreview = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_missing_top_level", include_current_continuity: false })
    expect(missingTopLevelPreview).toMatchObject({ status: "blocked", recommended_action: "inspect_corrupt_record", checkpoint: undefined })

    await startOnly("inv_recovery_malformed_approval_owner", 9)
    await startOnly("inv_recovery_malformed_approval_unrelated", 10)
    const missingApprovalTopLevelEvent = {
      kind: "runtime_commander_investigation_recovery_approved",
      schema_version: 1,
      journal_sequence: 1,
      requested_by: "human_operator",
      occurred_at: "2026-01-01T00:06:00.000Z",
      approval: {
        schema_version: 1,
        approval_version: 1,
        approval_id: "approval_missing_top_level_owner",
        approval_sequence: 0,
        investigation_id: "inv_recovery_malformed_approval_owner",
        recovery_kind: "checkpoint",
        decision: "approve_resume_from_checkpoint",
        approved_by: "human_operator",
        approval_source: "human",
        acknowledgements: {
          fresh_context_required: true,
          exact_replay_unavailable: true,
          provider_request_replay_forbidden: true,
          tool_execution_replay_forbidden: true,
        },
        recovery_basis_hash: "basis_missing_top_level_owner",
        recovery_plan_hash: "plan_missing_top_level_owner",
        recovery_packet_hash: "packet_missing_top_level_owner",
        preview_hash: "preview_missing_top_level_owner",
        checkpoint_ref: {
          checkpoint_id: "checkpoint_missing_top_level_owner",
          checkpoint_sequence: 0,
          checkpoint_hash: "checkpoint_hash_missing_top_level_owner",
        },
        provider_execution_envelope_hash: "provider_envelope_missing_top_level_owner",
        tool_compatibility_hash: "tool_hash_missing_top_level_owner",
        provider_compatibility_hash: "provider_hash_missing_top_level_owner",
        budget_compatibility_hash: "budget_hash_missing_top_level_owner",
        context_compatibility_hash: "context_hash_missing_top_level_owner",
        continuity_compatibility_hash: "continuity_hash_missing_top_level_owner",
        human_control_compatibility_hash: "human_control_hash_missing_top_level_owner",
        one_shot: true,
        automatic: false,
        fresh_context_required: true,
        exact_replay_supported: false,
        provider_request_replay_allowed: false,
        tool_execution_replay_allowed: false,
        execution_supported_in_this_branch: false,
        approved_at: "2026-01-01T00:06:00.000Z",
        approval_hash: "approval_hash_missing_top_level_owner",
      },
      event_payload_hash: "",
    }
    missingApprovalTopLevelEvent.event_payload_hash = journalPayloadHash(missingApprovalTopLevelEvent)
    await server.eventStore.append(missingApprovalTopLevelEvent as Parameters<EventStore["append"]>[0])
    const malformedApprovalOwnerSource = await server.getCommanderInvestigationRecoverySource("inv_recovery_malformed_approval_owner")
    expect(malformedApprovalOwnerSource).toMatchObject({ projection_status: "corrupt", latest_checkpoint: undefined, normalized_input: undefined })
    expect(malformedApprovalOwnerSource?.record?.integrity_errors.join("\n")).toContain("without top-level investigation_id")
    const malformedApprovalUnrelatedSource = await server.getCommanderInvestigationRecoverySource("inv_recovery_malformed_approval_unrelated")
    expect(malformedApprovalUnrelatedSource).toMatchObject({ projection_status: "ready" })
    expect(malformedApprovalUnrelatedSource?.record?.integrity_errors.join("\n")).not.toContain("unassignable Commander journal event")

    await startOnly("inv_recovery_interior_malformed", 7)
    await writeFile(server.eventStore.eventsPath, '{"kind":"runtime_commander_inv\n{"kind":"runtime_started","schema_version":1,"event_id":"runtime_started_after_malformed","timestamp":"2026-01-01T00:04:00.000Z"}\n', { flag: "a" })
    const interiorMalformedSource = await server.getCommanderInvestigationRecoverySource("inv_recovery_interior_malformed")
    expect(interiorMalformedSource).toMatchObject({ projection_status: "corrupt", latest_checkpoint: undefined, normalized_input: undefined })
    expect(interiorMalformedSource?.record?.integrity_errors.join("\n")).toContain("unassignable Commander journal event")
    const interiorMalformedPreview = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_interior_malformed", include_current_continuity: false })
    expect(interiorMalformedPreview).toMatchObject({ status: "blocked", recommended_action: "inspect_corrupt_record", checkpoint: undefined })

    await startOnly("inv_recovery_indeterminate_malformed", 8)
    await writeFile(server.eventStore.eventsPath, '{"kind":"runtime_command\n{"kind":"runtime_started","schema_version":1,"event_id":"runtime_started_after_indeterminate_malformed","timestamp":"2026-01-01T00:04:30.000Z"}\n', { flag: "a" })
    const indeterminateMalformedSource = await server.getCommanderInvestigationRecoverySource("inv_recovery_indeterminate_malformed")
    expect(indeterminateMalformedSource).toMatchObject({ projection_status: "corrupt", latest_checkpoint: undefined, normalized_input: undefined })
    expect(indeterminateMalformedSource?.record?.integrity_errors.join("\n")).toContain("unassignable Commander journal event")
    const indeterminateMalformedPreview = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_indeterminate_malformed", include_current_continuity: false })
    expect(indeterminateMalformedPreview).toMatchObject({ status: "blocked", recommended_action: "inspect_corrupt_record", checkpoint: undefined })

    await writeFile(server.eventStore.eventsPath, '{"kind":"runtime_commander_inv', { flag: "a" })
    const blockedByTailSource = await server.getCommanderInvestigationRecoverySource("inv_recovery_checkpoint")
    expect(blockedByTailSource).toMatchObject({ projection_status: "corrupt", latest_checkpoint: undefined, normalized_input: undefined })
    expect(blockedByTailSource?.record?.integrity_errors.join("\n")).toContain("unassignable Commander journal event")
    const blockedByTailPreview = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_checkpoint", include_current_continuity: false })
    expect(blockedByTailPreview).toMatchObject({ status: "blocked", recommended_action: "inspect_corrupt_record" })
    expect(blockedByTailPreview.checkpoint).toBeUndefined()
  })

  test("recovery preview enforces exact tool compatibility budgets human controls and deterministic plan hashes", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3b1-recovery-compat-"))
    const eventStore = new EventStore(join(projectDir, ".nxl", "events.jsonl"))
    const journal = new CommanderInvestigationJournalService({ eventStore })
    const memorySearch = COMMANDER_TOOL_REGISTRY.find((tool) => tool.tool_id === "memory.search")
    expect(memorySearch).toBeDefined()
    const input = baseInvestigation({ investigation_id: "inv_recovery_compat", objective: "Recover with exact tool compatibility", provider_id: "fixture_provider", provider_kind: "openai", model_id: "fixture-model", tool_protocol: "native", session_id: "session_recovery_compat" })
    const run = await journal.createObserver(input)
    const snapshot = durableStartedSnapshot(input, 8, "inv_recovery_compat") as any
    snapshot.budget = { ...snapshot.budget, max_context_bytes: 8192, budget_hash: "" }
    snapshot.budget.budget_hash = stableHash({ ...snapshot.budget, budget_hash: "" })
    snapshot.loaded_tools = [memorySearch!]
    snapshot.working_set.loaded_tool_ids = ["memory.search"]
    snapshot.working_set.evidence_cards = [evidenceCard("evidence_recovery_pointer")]
    snapshot.working_set.recent_result_signatures = [{ signature_hash: "signature_recovery", count: 1, last_turn_index: 0 }]
    await run.observer.onStarted(snapshot as Parameters<typeof run.observer.onStarted>[0])
    journal.release(run)
    const source = await journal.recoverySource("inv_recovery_compat")
    expect(source?.latest_checkpoint?.loaded_tools.map((tool) => tool.tool_id)).toEqual(["memory.search"])
    const recoveryExecutionEnvelope = (overrides: {
      connector_id?: string
      base_url?: string
      allowed_hosts?: string[]
      allowed_methods?: string[]
      timeout_ms?: number
      max_request_bytes?: number
      max_response_bytes?: number
      max_context_bytes?: number
      max_context_tokens?: number
      max_output_tokens?: number
      supports_tools?: boolean | "unknown"
      supports_json_schema?: boolean | "unknown"
      supports_long_context?: boolean | "unknown"
      supports_local_execution?: boolean | "unknown"
      credential_value?: string
    } = {}) => {
      const connectorId = overrides.connector_id ?? "openai-test"
      const providerId = "fixture_provider"
      const providerKind = "openai"
      const modelId = "fixture-model"
      const connectorPolicyHash = stableHash({
        connector_id: connectorId,
        chat_completions_url: `${overrides.base_url ?? "https://api.example.test/v1"}/chat/completions`,
        allowed_hosts: overrides.allowed_hosts ?? ["api.example.test"],
        allowed_methods: overrides.allowed_methods ?? ["POST"],
        default_headers: [["X-Trace", "trace-fixture"]],
        credential_ref_injection_shape: [{ source: "env", inject_as: "header", target_name: "Authorization", prefix: "Bearer " }],
        connector_timeout_ms: overrides.timeout_ms ?? 5000,
        connector_max_response_bytes: overrides.max_response_bytes ?? 65_536,
        allow_local_http: false,
      })
      const capabilityEnvelopeHash = stableHash({
        provider_kind: providerKind,
        provider_id: providerId,
        model_id: modelId,
        role_support: ["commander"],
        max_context_bytes: overrides.max_context_bytes ?? 65_536,
        max_context_tokens: overrides.max_context_tokens,
        max_output_tokens: overrides.max_output_tokens ?? 1024,
        supports_tools: overrides.supports_tools ?? true,
        supports_json_schema: overrides.supports_json_schema ?? "unknown",
        supports_mcp: false,
        supports_long_context: overrides.supports_long_context ?? "unknown",
        supports_streaming: false,
        supports_local_execution: overrides.supports_local_execution ?? false,
        safety_margin_ratio: 0.18,
        source: "runtime_config",
      })
      const envelope = {
        envelope_version: 1 as const,
        transport_kind: "openai_compatible_connector" as const,
        provider_id: providerId,
        provider_kind: providerKind,
        connector_id: connectorId,
        model_id: modelId,
        timeout_ms: overrides.timeout_ms ?? 5000,
        max_request_bytes: overrides.max_request_bytes ?? 65_536,
        max_response_bytes: overrides.max_response_bytes ?? 65_536,
        max_context_bytes: overrides.max_context_bytes ?? 65_536,
        max_context_tokens: overrides.max_context_tokens,
        max_output_tokens: overrides.max_output_tokens ?? 1024,
        supports_tools: overrides.supports_tools ?? true,
        supports_json_schema: overrides.supports_json_schema ?? "unknown" as const,
        supports_long_context: overrides.supports_long_context ?? "unknown" as const,
        supports_local_execution: overrides.supports_local_execution ?? false,
        supports_streaming: false as const,
        connector_policy_hash: connectorPolicyHash,
        capability_envelope_hash: capabilityEnvelopeHash,
        execution_envelope_hash: "",
      }
      envelope.execution_envelope_hash = stableHash({ ...envelope, execution_envelope_hash: "" })
      return envelope
    }

    const baseOptions = (overrides: Partial<ConstructorParameters<typeof CommanderInvestigationRecoveryService>[0]> = {}) => ({
      recoverySource: async () => source,
      descriptors: COMMANDER_TOOL_REGISTRY,
      boundToolIds: COMMANDER_BOUND_TOOL_IDS,
      providerReadiness: () => ({
        readiness_id: "ready",
        status: "ready" as const,
        configuration_ready: true,
        execution_ready: false,
        provider_source: "configured_connector" as const,
        provider_id: "fixture_provider",
        provider_kind: "openai",
        connector_id: "openai-test",
        model_id: "fixture-model",
        enabled_phases: ["proposal_investigation" as const],
        capability_id: "capability_fixture",
        default_tool_protocol: "native" as const,
        runtime_mode: "status",
        runtime_lifecycle_state: "created" as const,
        runtime_started: false,
        run_lock_required: true,
        run_lock_held: false,
        adapter_id: "external_api_connector_ai_sdk_core",
        supports_streaming: false,
        would_call_network: true,
        would_append_external_api_audit: true,
        checks: [
          { name: "connector_exists", ok: true, severity: "info" as const, summary: "connector exists" },
          { name: "credential_values_present", ok: true, severity: "info" as const, summary: "credentials present" },
        ],
        blockers: [],
        warnings: [],
        generated_at: "2026-01-01T00:00:00.000Z",
        network_called: false as const,
        events_appended: false as const,
        readiness_hash: "readiness_hash",
      }),
      providerExecutionEnvelope: () => recoveryExecutionEnvelope(),
      modelCapability: () => ({
        capability_id: "capability_fixture",
        provider_kind: "openai",
        provider_id: "fixture_provider",
        model_id: "fixture-model",
        display_name: "Fixture",
        role_support: ["commander" as const],
        max_context_bytes: 65_536,
        max_output_tokens: 1024,
        supports_tools: true,
        supports_json_schema: "unknown" as const,
        supports_mcp: false,
        supports_long_context: "unknown" as const,
        supports_streaming: false,
        supports_local_execution: false,
        safety_margin_ratio: 0.18,
        source: "runtime_config" as const,
        warnings: [],
      }),
      currentProfile: (profileInput: { phase?: string }) => new CommanderToolService({ contextBudgetService: new ContextBudgetService({ registry: new ModelCapabilityRegistry() }) }).profile(profileInput),
      currentContextBudget: async () => ({
        context_budget_id: source!.latest_checkpoint!.budget.source_context_budget_id,
        tool_schema_allocation_bytes: source!.latest_checkpoint!.budget.tool_schema_allocation_bytes,
        tool_schema_allocation_tokens: source!.latest_checkpoint!.budget.tool_schema_allocation_tokens,
        blockers: [],
        warnings: [],
      }),
      currentBootstrap: async () => ({ ...minimalTestBootstrap(), bootstrap_id: source!.latest_checkpoint!.bootstrap_ref.bootstrap_id, bootstrap_hash: source!.latest_checkpoint!.bootstrap_ref.bootstrap_hash }),
      currentHumanControl: async () => ({ action: "continue" as const, source_kind: "human_control", checked_at: "2026-01-01T00:00:00.000Z", warnings: [] }),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      ...overrides,
    })

    const validPreview = await new CommanderInvestigationRecoveryService(baseOptions()).preview({ investigation_id: "inv_recovery_compat" })
    expect(validPreview).toMatchObject({
      status: "ready_for_approval",
      tool_compatibility: { compatible: true },
      budget_compatibility: { model_turns_remaining: 4, tool_calls_remaining: 4, repeat_signature_count: 1 },
      human_control: { action: "continue" },
      provider_called: false,
      tool_executed: false,
      events_appended: false,
    })
    expect(validPreview.recovery_packet?.evidence_pointers[0]).toMatchObject({ evidence_id: "evidence_recovery_pointer", source_id: "evidence_recovery_pointer", summary_preview: "bounded evidence evidence_recovery_pointer" })
    expect(validPreview.recovery_packet?.provider_execution_envelope_hash).toBe(validPreview.provider_compatibility.execution_envelope?.execution_envelope_hash)
    expect(validPreview.provider_compatibility.execution_envelope).toMatchObject({ connector_id: "openai-test", max_output_tokens: 1024, supports_tools: true })
    expect(JSON.stringify(validPreview)).not.toContain("raw tool")
    expect(JSON.stringify(validPreview)).not.toContain("https://api.example.test")
    expect(JSON.stringify(validPreview)).not.toContain("trace-fixture")
    expect(JSON.stringify(validPreview)).not.toContain("NXL_TEST_MODEL_KEY")
    expect(JSON.stringify(validPreview)).not.toContain("real-provider-key")

    const legacyProjectDir = await mkdtemp(join(tmpdir(), "nxl-9w3b1-legacy-loaded-tool-limits-"))
    const legacyStore = new EventStore(join(legacyProjectDir, ".nxl", "events.jsonl"))
    const legacyJournal = new CommanderInvestigationJournalService({ eventStore: legacyStore })
    const legacyInput = baseInvestigation({ investigation_id: "inv_recovery_legacy_limits", objective: "Recover old schema loaded tools", provider_id: "fixture_provider", provider_kind: "openai", model_id: "fixture-model", tool_protocol: "native" })
    const legacyRun = await legacyJournal.createObserver(legacyInput)
    const legacySnapshot = durableStartedSnapshot(legacyInput, 18, "inv_recovery_legacy_limits") as any
    legacySnapshot.loaded_tools = [memorySearch!]
    legacySnapshot.working_set.loaded_tool_ids = ["memory.search"]
    await legacyRun.observer.onStarted(legacySnapshot as Parameters<typeof legacyRun.observer.onStarted>[0])
    legacyJournal.release(legacyRun)
    const legacyEvent = JSON.parse((await readFile(legacyStore.eventsPath, "utf8")).trim()) as any
    const stripLegacyCompatibilityFields = (tool: CommanderInvestigationLoadedToolRef) => {
      const { max_output_bytes: _maxOutputBytes, timeout_ms: _timeoutMs, description_hash: _descriptionHash, ...legacyTool } = tool
      return legacyTool
    }
    legacyEvent.initial_loaded_tool_refs = legacyEvent.initial_loaded_tool_refs.map(stripLegacyCompatibilityFields)
    legacyEvent.initial_checkpoint = finalizeTestCheckpoint({
      ...legacyEvent.initial_checkpoint,
      loaded_tools: legacyEvent.initial_checkpoint.loaded_tools.map(stripLegacyCompatibilityFields),
    })
    legacyEvent.event_payload_hash = journalPayloadHash(legacyEvent)
    await writeFile(legacyStore.eventsPath, `${JSON.stringify(legacyEvent)}\n`)
    const legacySource = await legacyJournal.recoverySource("inv_recovery_legacy_limits")
    expect(legacySource).toMatchObject({ projection_status: "ready", latest_checkpoint: { checkpoint_id: legacyEvent.initial_checkpoint.checkpoint_id } })
    expect(legacySource?.latest_checkpoint?.loaded_tools[0].max_output_bytes).toBeUndefined()
    expect(legacySource?.latest_checkpoint?.loaded_tools[0].timeout_ms).toBeUndefined()
    const legacyPreview = await new CommanderInvestigationRecoveryService(baseOptions({
      recoverySource: async () => legacySource,
      currentBootstrap: async () => ({ ...minimalTestBootstrap(), bootstrap_id: legacySource!.latest_checkpoint!.bootstrap_ref.bootstrap_id, bootstrap_hash: legacySource!.latest_checkpoint!.bootstrap_ref.bootstrap_hash }),
    })).preview({ investigation_id: "inv_recovery_legacy_limits" })
    expect(legacyPreview.status).toBe("blocked")
    expect(legacyPreview.recommended_action).toBe("reconfigure_runtime")
    expect(legacyPreview.tool_compatibility.blockers.join("\n")).toContain("capability envelope changed or is incomplete")
    expect(legacyPreview.tool_compatibility.blockers.join("\n")).toContain("provider-visible description changed or is incomplete")

    for (const [label, mutate] of [
      ["tool max output", (tool: CommanderInvestigationLoadedToolRef) => ({ ...tool, max_output_bytes: (tool.max_output_bytes ?? 0) + 1 })],
      ["tool timeout", (tool: CommanderInvestigationLoadedToolRef) => ({ ...tool, timeout_ms: (tool.timeout_ms ?? 0) + 1 })],
    ] as const) {
      const driftedToolCheckpoint = finalizeTestCheckpoint({
        ...source!.latest_checkpoint!,
        loaded_tools: source!.latest_checkpoint!.loaded_tools.map((tool) => tool.tool_id === "memory.search" ? mutate(tool) : tool),
      })
      const driftedToolPreview = await new CommanderInvestigationRecoveryService(baseOptions({ recoverySource: async () => ({ ...source!, latest_checkpoint: driftedToolCheckpoint }) })).preview({ investigation_id: "inv_recovery_compat" })
      expect(driftedToolPreview.status, label).toBe("blocked")
      expect(driftedToolPreview.recommended_action, label).toBe("reconfigure_runtime")
      expect(driftedToolPreview.tool_compatibility.blockers.join("\n"), label).toContain("capability envelope changed")
      expect(driftedToolPreview.recovery_plan_hash, label).not.toBe(validPreview.recovery_plan_hash)
    }

    const sameEnvelopeLaterPreview = await new CommanderInvestigationRecoveryService(baseOptions({ now: () => new Date("2026-01-03T00:00:00.000Z") })).preview({ investigation_id: "inv_recovery_compat" })
    expect(sameEnvelopeLaterPreview.recovery_plan_hash).toBe(validPreview.recovery_plan_hash)

    const credentialRotatedPreview = await new CommanderInvestigationRecoveryService(baseOptions({ providerExecutionEnvelope: () => recoveryExecutionEnvelope({ credential_value: "rotated-secret" }) })).preview({ investigation_id: "inv_recovery_compat" })
    expect(credentialRotatedPreview.recovery_plan_hash).toBe(validPreview.recovery_plan_hash)

    const defaultProviderReadiness = baseOptions().providerReadiness
    const missingCredentialPreview = await new CommanderInvestigationRecoveryService(baseOptions({
      providerReadiness: (readinessInput) => {
        const readiness = defaultProviderReadiness(readinessInput)
        return {
          ...readiness,
          status: "blocked" as const,
          configuration_ready: false,
          checks: readiness.checks.map((check) => check.name === "credential_values_present" ? { ...check, ok: false, severity: "error" as const, summary: "credential value is missing" } : check),
          blockers: ["connector credential value is missing"],
        }
      },
    })).preview({ investigation_id: "inv_recovery_compat" })
    expect(missingCredentialPreview).toMatchObject({
      status: "blocked",
      recommended_action: "reconfigure_runtime",
      provider_compatibility: { credentials_ready: false },
    })
    expect(JSON.stringify(missingCredentialPreview)).not.toContain("NXL_TEST_MODEL_KEY")
    expect(JSON.stringify(missingCredentialPreview)).not.toContain("real-provider-key")

    for (const [label, envelope] of [
      ["connector_id", recoveryExecutionEnvelope({ connector_id: "openai-alt" })],
      ["base_url", recoveryExecutionEnvelope({ base_url: "https://api-alt.example.test/v1" })],
      ["allowed_hosts", recoveryExecutionEnvelope({ allowed_hosts: ["api-alt.example.test"] })],
      ["allowed_methods", recoveryExecutionEnvelope({ allowed_methods: ["POST", "GET"] })],
      ["timeout_ms", recoveryExecutionEnvelope({ timeout_ms: 7000 })],
      ["max_request_bytes", recoveryExecutionEnvelope({ max_request_bytes: 32_768 })],
      ["max_response_bytes", recoveryExecutionEnvelope({ max_response_bytes: 32_768 })],
      ["max_output_tokens", recoveryExecutionEnvelope({ max_output_tokens: 512 })],
      ["supports_tools", recoveryExecutionEnvelope({ supports_tools: "unknown" })],
      ["supports_json_schema", recoveryExecutionEnvelope({ supports_json_schema: true })],
      ["context_limits", recoveryExecutionEnvelope({ max_context_bytes: 32_768, max_context_tokens: 8192 })],
    ] as const) {
      const changed = await new CommanderInvestigationRecoveryService(baseOptions({ providerExecutionEnvelope: () => envelope })).preview({ investigation_id: "inv_recovery_compat" })
      expect(changed.recovery_plan_hash, label).not.toBe(validPreview.recovery_plan_hash)
      expect(changed.provider_compatibility.compatibility_hash, label).not.toBe(validPreview.provider_compatibility.compatibility_hash)
    }

    let skippedContinuityBootstrapInput: unknown
    const skippedContinuityPreview = await new CommanderInvestigationRecoveryService(baseOptions({
      currentBootstrap: async (bootstrapInput) => {
        skippedContinuityBootstrapInput = bootstrapInput
        return { ...minimalTestBootstrap(), bootstrap_id: source!.latest_checkpoint!.bootstrap_ref.bootstrap_id, bootstrap_hash: source!.latest_checkpoint!.bootstrap_ref.bootstrap_hash, estimated_bytes: 256, estimated_tokens: 64 }
      },
    })).preview({ investigation_id: "inv_recovery_compat", include_current_continuity: false })
    expect(skippedContinuityPreview).toMatchObject({ status: "ready_for_approval", continuity_compatibility: { current_bootstrap_ready: false } })
    expect(skippedContinuityBootstrapInput).toMatchObject({ include_continuity: false })
    expect(skippedContinuityPreview.context_compatibility.current_bootstrap_bytes).toBe(256)
    expect(skippedContinuityPreview.warnings.join("\n")).toContain("current continuity was not assessed")

    const skippedContinuityOversizedPreview = await new CommanderInvestigationRecoveryService(baseOptions({
      currentBootstrap: async () => ({ ...minimalTestBootstrap(), bootstrap_id: source!.latest_checkpoint!.bootstrap_ref.bootstrap_id, bootstrap_hash: source!.latest_checkpoint!.bootstrap_ref.bootstrap_hash, estimated_bytes: 5000, estimated_tokens: 1250 }),
    })).preview({ investigation_id: "inv_recovery_compat", include_current_continuity: false })
    expect(skippedContinuityOversizedPreview).toMatchObject({ status: "blocked", recommended_action: "reconfigure_runtime" })
    expect(skippedContinuityOversizedPreview.context_compatibility.blockers.join("\n")).toContain("current model context")
    expect(skippedContinuityOversizedPreview.recovery_packet?.blockers.join("\n")).toContain("current model context")

    let capturedBootstrapInput: unknown
    const omittedContinuitySource = { ...source!, normalized_input: { ...source!.normalized_input!, include_continuity: false } }
    const forcedContinuityPreview = await new CommanderInvestigationRecoveryService(baseOptions({
      recoverySource: async () => omittedContinuitySource,
      currentBootstrap: async (bootstrapInput) => {
        capturedBootstrapInput = bootstrapInput
        return { ...minimalTestBootstrap(), bootstrap_id: source!.latest_checkpoint!.bootstrap_ref.bootstrap_id, bootstrap_hash: source!.latest_checkpoint!.bootstrap_ref.bootstrap_hash }
      },
    })).preview({ investigation_id: "inv_recovery_compat" })
    expect(forcedContinuityPreview.status).toBe("ready_for_approval")
    expect(capturedBootstrapInput).toMatchObject({ include_continuity: true })

    const throwingContinuityBootstrap = new CommanderInvestigationBootstrapService({
      continuityService: {
        proposal: async () => { throw new Error("proposal continuity unavailable") },
        midMission: async () => { throw new Error("mid mission continuity unavailable") },
        summary: async () => { throw new Error("summary continuity unavailable") },
        openLoops: async () => { throw new Error("open loops continuity unavailable") },
      } as any,
    })
    for (const [phase, linkage] of [
      ["proposal_investigation", {}],
      ["mid_mission_supervision", { session_id: "session_recovery_compat" }],
      ["result_review", {}],
    ] as const) {
      const degradedSource = {
        ...source!,
        record: { ...source!.record!, phase, session_id: linkage.session_id },
        normalized_input: { ...source!.normalized_input!, phase, session_id: linkage.session_id },
        latest_checkpoint: { ...source!.latest_checkpoint!, phase },
      }
      const degradedPreview = await new CommanderInvestigationRecoveryService(baseOptions({
        recoverySource: async () => degradedSource,
        currentBootstrap: async (bootstrapInput) => throwingContinuityBootstrap.compile(bootstrapInput),
      })).preview({ investigation_id: "inv_recovery_compat" })
      expect(degradedPreview).toMatchObject({
        status: "blocked",
        recommended_action: "reconfigure_runtime",
        continuity_compatibility: { current_bootstrap_ready: false },
        provider_called: false,
        tool_executed: false,
        events_appended: false,
        files_written: false,
      })
      expect(degradedPreview.continuity_compatibility.blockers.join("\n")).toContain("current continuity assessment is degraded")
    }

    const warningBudget = { ...source!.latest_checkpoint!.budget, max_context_bytes: 8192, budget_hash: "" }
    warningBudget.budget_hash = stableHash({ ...warningBudget, budget_hash: "" })
    const warningCheckpoint = finalizeTestCheckpoint({ ...source!.latest_checkpoint!, budget: warningBudget })
    const warningContinuityPreview = await new CommanderInvestigationRecoveryService(baseOptions({
      recoverySource: async () => ({ ...source!, latest_checkpoint: warningCheckpoint }),
      currentBootstrap: async () => ({
        ...minimalTestBootstrap(),
        bootstrap_id: source!.latest_checkpoint!.bootstrap_ref.bootstrap_id,
        bootstrap_hash: source!.latest_checkpoint!.bootstrap_ref.bootstrap_hash,
        warnings: ["ordinary nonfatal continuity warning"],
      }),
    })).preview({ investigation_id: "inv_recovery_compat" })
    expect(warningContinuityPreview).toMatchObject({ status: "ready_for_approval", continuity_compatibility: { current_bootstrap_ready: true } })
    expect(warningContinuityPreview.warnings.join("\n")).toContain("ordinary nonfatal continuity warning")

    const executionReadyPreview = await new CommanderInvestigationRecoveryService(baseOptions({
      providerReadiness: () => ({
        readiness_id: "ready-execution",
        status: "ready" as const,
        configuration_ready: true,
        execution_ready: true,
        provider_source: "configured_connector" as const,
        provider_id: "fixture_provider",
        provider_kind: "openai",
        connector_id: "openai-test",
        model_id: "fixture-model",
        enabled_phases: ["proposal_investigation" as const],
        capability_id: "capability_fixture",
        default_tool_protocol: "native" as const,
        runtime_mode: "active",
        runtime_lifecycle_state: "ready" as const,
        runtime_started: true,
        run_lock_required: true,
        run_lock_held: true,
        adapter_id: "external_api_connector_ai_sdk_core",
        supports_streaming: false,
        would_call_network: true,
        would_append_external_api_audit: true,
        checks: [
          { name: "connector_exists", ok: true, severity: "info" as const, summary: "connector exists" },
          { name: "credential_values_present", ok: true, severity: "info" as const, summary: "credentials present" },
        ],
        blockers: [],
        warnings: [],
        generated_at: "2026-01-01T00:00:00.000Z",
        network_called: false as const,
        events_appended: false as const,
        readiness_hash: "readiness_hash_execution",
      }),
    })).preview({ investigation_id: "inv_recovery_compat" })
    expect(executionReadyPreview.provider_compatibility.execution_ready_now).toBe(true)
    expect(executionReadyPreview.provider_compatibility.compatibility_hash).toBe(validPreview.provider_compatibility.compatibility_hash)
    expect(executionReadyPreview.recovery_plan_hash).toBe(validPreview.recovery_plan_hash)

    const compactedContextCap = validPreview.context_compatibility.estimated_recovery_packet_bytes
      + validPreview.context_compatibility.loaded_schema_bytes
      + validPreview.context_compatibility.latest_protocol_summary_bytes
      + validPreview.context_compatibility.current_bootstrap_bytes
      + 1
    const compactedContextPreview = await new CommanderInvestigationRecoveryService(baseOptions({
      modelCapability: () => ({
        capability_id: "capability_compacted_context",
        provider_kind: "openai",
        provider_id: "fixture_provider",
        model_id: "fixture-model",
        display_name: "Fixture compacted",
        role_support: ["commander" as const],
        max_context_bytes: compactedContextCap,
        max_output_tokens: 1024,
        supports_tools: true,
        supports_json_schema: "unknown" as const,
        supports_mcp: false,
        supports_long_context: "unknown" as const,
        supports_streaming: false,
        supports_local_execution: false,
        safety_margin_ratio: 0.18,
        source: "runtime_config" as const,
        warnings: [],
      }),
    })).preview({ investigation_id: "inv_recovery_compat" })
    expect(compactedContextPreview.status).toBe("ready_for_approval")
    expect(compactedContextPreview.context_compatibility.evidence_summary_bytes).toBeGreaterThan(0)
    expect(compactedContextPreview.context_compatibility.within_current_context_budget).toBe(true)

    const bootstrapSizedPreview = await new CommanderInvestigationRecoveryService(baseOptions({
      modelCapability: () => ({
        capability_id: "capability_fixture",
        provider_kind: "openai",
        provider_id: "fixture_provider",
        model_id: "fixture-model",
        display_name: "Fixture",
        role_support: ["commander" as const],
        max_context_bytes: compactedContextCap,
        max_output_tokens: 1024,
        supports_tools: true,
        supports_json_schema: "unknown" as const,
        supports_mcp: false,
        supports_long_context: "unknown" as const,
        supports_streaming: false,
        supports_local_execution: false,
        safety_margin_ratio: 0.18,
        source: "runtime_config" as const,
        warnings: [],
      }),
      currentBootstrap: async () => ({ ...minimalTestBootstrap(), bootstrap_id: source!.latest_checkpoint!.bootstrap_ref.bootstrap_id, bootstrap_hash: source!.latest_checkpoint!.bootstrap_ref.bootstrap_hash, estimated_bytes: 4096, estimated_tokens: 1024 }),
    })).preview({ investigation_id: "inv_recovery_compat" })
    expect(bootstrapSizedPreview).toMatchObject({ status: "blocked", context_compatibility: { within_current_context_budget: false, current_bootstrap_bytes: 4096, current_bootstrap_tokens: 1024 } })
    expect(bootstrapSizedPreview.context_compatibility.blockers.join("\n")).toContain("current model context")
    expect(bootstrapSizedPreview.recovery_packet?.blockers.join("\n")).toContain("current model context")
    expect(bootstrapSizedPreview.recovery_plan_hash).not.toBe(validPreview.recovery_plan_hash)

    const reservedInputPreview = await new CommanderInvestigationRecoveryService(baseOptions({
      currentContextBudget: async () => ({
        context_budget_id: "context_budget_reserved_input",
        input_context_bytes: 65_536,
        input_context_tokens: 1,
        tool_schema_allocation_bytes: source!.latest_checkpoint!.budget.tool_schema_allocation_bytes,
        tool_schema_allocation_tokens: source!.latest_checkpoint!.budget.tool_schema_allocation_tokens,
        blockers: [],
        warnings: [],
      }),
    })).preview({ investigation_id: "inv_recovery_compat" })
    expect(reservedInputPreview).toMatchObject({ status: "blocked", context_compatibility: { within_current_context_budget: false, current_input_context_tokens: 1 } })
    expect(reservedInputPreview.context_compatibility.blockers.join("\n")).toContain("current model context token budget")
    expect(reservedInputPreview.recovery_packet?.blockers.join("\n")).toContain("current model context token budget")

    const driftedDescriptors = COMMANDER_TOOL_REGISTRY.map((tool) => tool.tool_id === "memory.search" ? { ...tool, version: "9.9.9" } : tool)
    const driftedPreview = await new CommanderInvestigationRecoveryService(baseOptions({ descriptors: driftedDescriptors })).preview({ investigation_id: "inv_recovery_compat" })
    expect(driftedPreview).toMatchObject({ status: "blocked", tool_compatibility: { compatible: false } })
    expect(driftedPreview.tool_compatibility.blockers.join("\n")).toContain("descriptor metadata changed")
    expect(driftedPreview.recovery_plan_hash).not.toBe(validPreview.recovery_plan_hash)
    expect(driftedPreview.recommended_action).toBe("reconfigure_runtime")

    const descriptionDriftDescriptors = COMMANDER_TOOL_REGISTRY.map((tool) => tool.tool_id === "memory.search" ? { ...tool, description: `${tool.description} Changed provider-visible recovery text.` } : tool)
    const descriptionDriftPreview = await new CommanderInvestigationRecoveryService(baseOptions({ descriptors: descriptionDriftDescriptors })).preview({ investigation_id: "inv_recovery_compat" })
    expect(descriptionDriftPreview).toMatchObject({ status: "blocked", tool_compatibility: { compatible: false } })
    expect(descriptionDriftPreview.tool_compatibility.blockers.join("\n")).toContain("provider-visible description changed")
    expect(descriptionDriftPreview.recovery_plan_hash).not.toBe(validPreview.recovery_plan_hash)
    expect(descriptionDriftPreview.recommended_action).toBe("reconfigure_runtime")

    const envelopeDriftDescriptors = COMMANDER_TOOL_REGISTRY.map((tool) => tool.tool_id === "memory.search" ? { ...tool, namespace: "runtime_read" as const } : tool)
    const envelopeDriftPreview = await new CommanderInvestigationRecoveryService(baseOptions({ descriptors: envelopeDriftDescriptors })).preview({ investigation_id: "inv_recovery_compat" })
    expect(envelopeDriftPreview).toMatchObject({ status: "blocked", tool_compatibility: { compatible: false } })
    expect(envelopeDriftPreview.tool_compatibility.blockers.join("\n")).toContain("capability envelope changed")

    const namespaceExcludedDescriptor = { ...memorySearch!, namespace: "governance" as const, allowed_phases: ["proposal_investigation" as const] }
    const namespaceExcludedCheckpoint = finalizeTestCheckpoint({
      ...source!.latest_checkpoint!,
      loaded_tools: source!.latest_checkpoint!.loaded_tools.map((tool) => tool.tool_id === "memory.search" ? {
        ...tool,
        namespace: namespaceExcludedDescriptor.namespace,
      } : tool),
    })
    const namespaceExcludedPreview = await new CommanderInvestigationRecoveryService(baseOptions({
      descriptors: COMMANDER_TOOL_REGISTRY.map((tool) => tool.tool_id === "memory.search" ? namespaceExcludedDescriptor : tool),
      recoverySource: async () => ({ ...source!, latest_checkpoint: namespaceExcludedCheckpoint }),
    })).preview({ investigation_id: "inv_recovery_compat" })
    expect(namespaceExcludedPreview).toMatchObject({ status: "blocked", recommended_action: "reconfigure_runtime", tool_compatibility: { compatible: false } })
    expect(namespaceExcludedPreview.tool_compatibility.tools.find((tool) => tool.tool_id === "memory.search")).toMatchObject({
      allowed_in_phase: false,
      capability_envelope_match: true,
      compatible: false,
    })
    expect(namespaceExcludedPreview.tool_compatibility.blockers.join("\n")).toContain("no longer allowed in phase proposal_investigation")
    expect(namespaceExcludedPreview.recovery_plan_hash).not.toBe(validPreview.recovery_plan_hash)
    expect(namespaceExcludedPreview).toMatchObject({ provider_called: false, tool_executed: false, network_called: false, events_appended: false, files_written: false })

    const exhausted = { ...source!.latest_checkpoint!, working_set: { ...source!.latest_checkpoint!.working_set, model_turn_count: 4 } }
    const exhaustedSource = { ...source!, latest_checkpoint: exhausted, record: { ...source!.record!, model_turn_count: 4 } }
    const budgetPreview = await new CommanderInvestigationRecoveryService(baseOptions({ recoverySource: async () => exhaustedSource })).preview({ investigation_id: "inv_recovery_compat" })
    expect(budgetPreview).toMatchObject({ status: "blocked" })
    expect(budgetPreview.budget_compatibility.exhausted_dimensions).toContain("model_turns")
    expect(budgetPreview.recommended_action).toBe("start_new_investigation")

    const finalOnlyBudgetCheckpoint = finalizeTestCheckpoint({
      ...source!.latest_checkpoint!,
      working_set: {
        ...source!.latest_checkpoint!.working_set,
        tool_call_count: source!.latest_checkpoint!.budget.max_tool_calls,
        tool_search_call_count: source!.latest_checkpoint!.budget.max_tool_search_calls,
        cumulative_tool_result_bytes: source!.latest_checkpoint!.budget.max_cumulative_tool_result_bytes,
      },
    })
    const finalOnlyBudgetPreview = await new CommanderInvestigationRecoveryService(baseOptions({
      recoverySource: async () => ({ ...source!, latest_checkpoint: finalOnlyBudgetCheckpoint }),
    })).preview({ investigation_id: "inv_recovery_compat" })
    expect(finalOnlyBudgetPreview).toMatchObject({ status: "ready_for_approval", recommended_action: "approve_resume_from_checkpoint" })
    expect(finalOnlyBudgetPreview.budget_compatibility.exhausted_dimensions).not.toContain("tool_calls")
    expect(finalOnlyBudgetPreview.budget_compatibility.exhausted_dimensions).not.toContain("tool_search_calls")
    expect(finalOnlyBudgetPreview.budget_compatibility.exhausted_dimensions).not.toContain("result_bytes")
    expect(finalOnlyBudgetPreview.budget_compatibility.model_turns_remaining).toBeGreaterThan(0)

    const overConsumedToolBudgetCheckpoint = finalizeTestCheckpoint({
      ...source!.latest_checkpoint!,
      working_set: {
        ...source!.latest_checkpoint!.working_set,
        tool_call_count: source!.latest_checkpoint!.budget.max_tool_calls + 1,
      },
    })
    const overConsumedToolBudgetPreview = await new CommanderInvestigationRecoveryService(baseOptions({
      recoverySource: async () => ({ ...source!, latest_checkpoint: overConsumedToolBudgetCheckpoint }),
    })).preview({ investigation_id: "inv_recovery_compat" })
    expect(overConsumedToolBudgetPreview).toMatchObject({ status: "blocked" })
    expect(overConsumedToolBudgetPreview.budget_compatibility.exhausted_dimensions).toContain("tool_calls")

    const noProgressExhausted = { ...source!.latest_checkpoint!, working_set: { ...source!.latest_checkpoint!.working_set, consecutive_no_progress_turns: source!.latest_checkpoint!.budget.max_consecutive_no_progress_turns } }
    const noProgressPreview = await new CommanderInvestigationRecoveryService(baseOptions({ recoverySource: async () => ({ ...source!, latest_checkpoint: noProgressExhausted }) })).preview({ investigation_id: "inv_recovery_compat" })
    expect(noProgressPreview).toMatchObject({ status: "blocked" })
    expect(noProgressPreview.budget_compatibility.exhausted_dimensions).toContain("no_progress_turns")
    expect(noProgressPreview.recommended_action).toBe("start_new_investigation")

    const loadedSchemaCapPreview = await new CommanderInvestigationRecoveryService(baseOptions({
      currentProfile: (profileInput: { phase?: string }) => ({ ...new CommanderToolService({ contextBudgetService: new ContextBudgetService({ registry: new ModelCapabilityRegistry() }) }).profile(profileInput), max_loaded_schemas: 0 }),
    })).preview({ investigation_id: "inv_recovery_compat" })
    expect(loadedSchemaCapPreview).toMatchObject({ status: "blocked" })
    expect(loadedSchemaCapPreview.budget_compatibility.exhausted_dimensions).toContain("loaded_schemas")

    const schemaByteCapPreview = await new CommanderInvestigationRecoveryService(baseOptions({
      currentContextBudget: async () => ({
        context_budget_id: "context_budget_smaller_schema_allocation",
        tool_schema_allocation_bytes: Math.max(0, validPreview.context_compatibility.loaded_schema_bytes - 1),
        tool_schema_allocation_tokens: source!.latest_checkpoint!.budget.tool_schema_allocation_tokens,
        blockers: [],
        warnings: [],
      }),
    })).preview({ investigation_id: "inv_recovery_compat" })
    expect(schemaByteCapPreview).toMatchObject({ status: "blocked" })
    expect(schemaByteCapPreview.budget_compatibility.exhausted_dimensions).toContain("tool_schema_allocation_bytes")
    expect(schemaByteCapPreview.budget_compatibility.blockers.join("\n")).toContain("tool_schema_allocation_bytes")
    expect(schemaByteCapPreview.budget_compatibility.current_context_budget_id).toBe("context_budget_smaller_schema_allocation")
    expect(schemaByteCapPreview.recovery_plan_hash).not.toBe(validPreview.recovery_plan_hash)

    const schemaTokenBudget = { ...source!.latest_checkpoint!.budget, tool_schema_allocation_tokens: Math.max(0, validPreview.context_compatibility.loaded_schema_tokens - 1), budget_hash: "" }
    schemaTokenBudget.budget_hash = stableHash({ ...schemaTokenBudget, budget_hash: "" })
    const schemaTokenCheckpoint = finalizeTestCheckpoint({ ...source!.latest_checkpoint!, budget: schemaTokenBudget })
    const schemaTokenCapPreview = await new CommanderInvestigationRecoveryService(baseOptions({
      recoverySource: async () => ({ ...source!, latest_checkpoint: schemaTokenCheckpoint }),
    })).preview({ investigation_id: "inv_recovery_compat" })
    expect(schemaTokenCapPreview).toMatchObject({ status: "blocked" })
    expect(schemaTokenCapPreview.budget_compatibility.exhausted_dimensions).toContain("tool_schema_allocation_tokens")
    expect(schemaTokenCapPreview.budget_compatibility.blockers.join("\n")).toContain("tool_schema_allocation_tokens")

    const tokenLimitedBudget = { ...source!.latest_checkpoint!.budget, max_context_tokens: 1, budget_hash: "" }
    tokenLimitedBudget.budget_hash = stableHash({ ...tokenLimitedBudget, budget_hash: "" })
    const tokenLimitedCheckpoint = finalizeTestCheckpoint({ ...source!.latest_checkpoint!, budget: tokenLimitedBudget })
    const storedTokenCapPreview = await new CommanderInvestigationRecoveryService(baseOptions({
      recoverySource: async () => ({ ...source!, latest_checkpoint: tokenLimitedCheckpoint }),
      modelCapability: () => ({
        capability_id: "capability_no_token_ceiling",
        provider_kind: "openai",
        provider_id: "fixture_provider",
        model_id: "fixture-model",
        display_name: "Fixture no token ceiling",
        role_support: ["commander" as const],
        max_context_bytes: 65_536,
        max_output_tokens: 1024,
        supports_tools: true,
        supports_json_schema: "unknown" as const,
        supports_mcp: false,
        supports_long_context: "unknown" as const,
        supports_streaming: false,
        supports_local_execution: false,
        safety_margin_ratio: 0.18,
        source: "runtime_config" as const,
        warnings: [],
      }),
    })).preview({ investigation_id: "inv_recovery_compat" })
    expect(storedTokenCapPreview).toMatchObject({ status: "blocked", context_compatibility: { within_current_context_budget: false } })
    expect(storedTokenCapPreview.context_compatibility.blockers.join("\n")).toContain("token budget")

    const smallContextPreview = await new CommanderInvestigationRecoveryService(baseOptions({
      modelCapability: () => ({
        capability_id: "capability_tiny_context",
        provider_kind: "openai",
        provider_id: "fixture_provider",
        model_id: "fixture-model",
        display_name: "Fixture tiny",
        role_support: ["commander" as const],
        max_context_bytes: 1,
        max_context_tokens: 1,
        max_output_tokens: 1024,
        supports_tools: true,
        supports_json_schema: "unknown" as const,
        supports_mcp: false,
        supports_long_context: "unknown" as const,
        supports_streaming: false,
        supports_local_execution: false,
        safety_margin_ratio: 0.18,
        source: "runtime_config" as const,
        warnings: [],
      }),
    })).preview({ investigation_id: "inv_recovery_compat" })
    expect(smallContextPreview).toMatchObject({ status: "blocked", context_compatibility: { within_current_context_budget: false } })
    expect(smallContextPreview.context_compatibility.current_context_budget_id).toBe("capability_tiny_context")
    expect(smallContextPreview.context_compatibility.blockers.join("\n")).toContain("current model context")
    expect(smallContextPreview.recovery_plan_hash).not.toBe(validPreview.recovery_plan_hash)

    const humanStopPreview = await new CommanderInvestigationRecoveryService(baseOptions({
      currentHumanControl: async () => ({ action: "stop" as const, source_kind: "human_control", projected_state: "stop_requested", summary_preview: "human stop", checked_at: "2026-01-01T00:00:00.000Z", warnings: [] }),
    })).preview({ investigation_id: "inv_recovery_compat" })
    expect(humanStopPreview).toMatchObject({ status: "blocked", recommended_action: "none", human_control: { action: "blocked" } })

    for (const projected_state of ["pause_requested", "correction_pending", "override_pending"] as const) {
      const humanHoldPreview = await new CommanderInvestigationRecoveryService(baseOptions({
        modelCapability: () => ({
          capability_id: "capability_human_hold_context",
          provider_kind: "openai",
          provider_id: "fixture_provider",
          model_id: "fixture-model",
          display_name: "Fixture human hold",
          role_support: ["commander" as const],
          max_context_bytes: 131_072,
          max_output_tokens: 1024,
          supports_tools: true,
          supports_json_schema: "unknown" as const,
          supports_mcp: false,
          supports_long_context: "unknown" as const,
          supports_streaming: false,
          supports_local_execution: false,
          safety_margin_ratio: 0.18,
          source: "runtime_config" as const,
          warnings: [],
        }),
        currentHumanControl: async () => ({ action: projected_state === "pause_requested" ? "pause" as const : "needs_human_review" as const, source_kind: "human_control", projected_state, summary_preview: projected_state, checked_at: "2026-01-01T00:00:00.000Z", warnings: [] }),
      })).preview({ investigation_id: "inv_recovery_compat" })
      expect(["blocked", "human_review_required"]).toContain(humanHoldPreview.status)
      expect(humanHoldPreview.recommended_action).toBe("none")
    }

    const injectedProviderReadiness = () => ({
      readiness_id: "injected",
      status: "ready" as const,
      configuration_ready: true,
      execution_ready: true,
      provider_source: "injected_adapter" as const,
      provider_id: "fixture_provider",
      provider_kind: "openai",
      model_id: "fixture-model",
      enabled_phases: ["proposal_investigation" as const],
      default_tool_protocol: "native" as const,
      runtime_mode: "active",
      runtime_lifecycle_state: "ready" as const,
      runtime_started: true,
      run_lock_required: false,
      run_lock_held: false,
      adapter_id: "scripted",
      supports_streaming: false,
      would_call_network: false,
      would_append_external_api_audit: false,
      checks: [],
      blockers: [],
      warnings: [],
      generated_at: "2026-01-01T00:00:00.000Z",
      network_called: false as const,
      events_appended: false as const,
      readiness_hash: "injected_hash",
    })
    const injectedCheckpointPreview = await new CommanderInvestigationRecoveryService(baseOptions({ providerReadiness: injectedProviderReadiness })).preview({ investigation_id: "inv_recovery_compat" })
    expect(injectedCheckpointPreview).toMatchObject({ status: "blocked", recommended_action: "reconfigure_runtime", provider_compatibility: { provider_source: "injected_adapter", compatible: false } })
    expect(injectedCheckpointPreview.provider_compatibility.blockers.join("\n")).toContain("configured connector-backed provider is required for production recovery")

    const pendingStopSource = {
      ...source!,
      pending_model_step: {
        schema_version: 1 as const,
        investigation_id: "inv_recovery_compat",
        journal_sequence: 1,
        turn_index: 1,
        model_request_id: "model_request_pending_stop",
        provider_id: input.provider_id,
        provider_kind: input.provider_kind,
        model_id: input.model_id,
        tool_protocol: "native" as const,
        base_checkpoint_id: source!.latest_checkpoint!.checkpoint_id,
        base_checkpoint_sequence: source!.latest_checkpoint!.checkpoint_sequence,
        base_checkpoint_hash: source!.latest_checkpoint!.checkpoint_hash,
        working_set_hash: source!.latest_checkpoint!.working_set.working_set_hash,
        context_hash: "context_hash_pending_stop",
        input_bytes: 128,
        estimated_input_tokens: 32,
        loaded_tool_refs: source!.latest_checkpoint!.loaded_tools,
        provider_request_count_before: 0,
        external_api_audit_count_before: 0,
        started_at: "2026-01-01T00:00:30.000Z",
        requested_by: input.requested_by,
        occurred_at: "2026-01-01T00:00:30.000Z",
        event_payload_hash: "hash_not_authoritative_in_preview_fixture",
      },
    }
    const injectedPendingPreview = await new CommanderInvestigationRecoveryService(baseOptions({ recoverySource: async () => pendingStopSource, providerReadiness: injectedProviderReadiness })).preview({ investigation_id: "inv_recovery_compat" })
    expect(injectedPendingPreview).toMatchObject({ status: "blocked", recovery_kind: "uncertain_provider_outcome", recommended_action: "reconfigure_runtime" })

    const pendingHumanStopPreview = await new CommanderInvestigationRecoveryService(baseOptions({
      recoverySource: async () => pendingStopSource,
      currentHumanControl: async () => ({ action: "stop" as const, source_kind: "human_control", projected_state: "stop_requested", summary_preview: "human stop", checked_at: "2026-01-01T00:00:00.000Z", warnings: [] }),
    })).preview({ investigation_id: "inv_recovery_compat" })
    expect(pendingHumanStopPreview).toMatchObject({ status: "blocked", recovery_kind: "uncertain_provider_outcome", human_control: { action: "blocked" } })

    const pendingPlanPreview = await new CommanderInvestigationRecoveryService(baseOptions({ recoverySource: async () => pendingStopSource })).preview({ investigation_id: "inv_recovery_compat" })
    const pendingContextDriftPreview = await new CommanderInvestigationRecoveryService(baseOptions({
      recoverySource: async () => ({
        ...pendingStopSource,
        pending_model_step: {
          ...pendingStopSource.pending_model_step,
          context_hash: "context_hash_pending_stop_changed",
        },
      }),
    })).preview({ investigation_id: "inv_recovery_compat" })
    expect(pendingPlanPreview.pending_model_step?.model_request_id).toBe(pendingContextDriftPreview.pending_model_step?.model_request_id)
    expect(pendingContextDriftPreview.recovery_plan_hash).not.toBe(pendingPlanPreview.recovery_plan_hash)

    const repeatPreview = await new CommanderInvestigationRecoveryService(baseOptions({ now: () => new Date("2026-01-02T00:00:00.000Z") })).preview({ investigation_id: "inv_recovery_compat" })
    expect(repeatPreview.recovery_plan_hash).toBe(validPreview.recovery_plan_hash)
    expect(repeatPreview.preview_hash).toBe(validPreview.preview_hash)
  })

  test("recovery approval records one human checkpoint approval without invalidating the plan", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3b2a-approval-checkpoint-"))
    await writeApprovedSpec(projectDir)
	    const server = configuredProviderRuntimeServer(projectDir)
	    servers.push({ stop: () => server.shutdown() })
	    const journal = new CommanderInvestigationJournalService({ eventStore: server.eventStore })
	    const input = baseInvestigation({
      investigation_id: "inv_recovery_approval_checkpoint",
      objective: "Approve safe checkpoint recovery",
      provider_id: "fixture_provider",
      provider_kind: "openai",
      model_id: "fixture-model",
      tool_protocol: "native",
    })
    const run = await journal.createObserver(input)
    const snapshot = durableStartedSnapshot(input, 14, "inv_recovery_approval_checkpoint") as any
    snapshot.budget = { ...snapshot.budget, max_context_bytes: 8192, budget_hash: "" }
    snapshot.budget.budget_hash = stableHash({ ...snapshot.budget, budget_hash: "" })
    await run.observer.onStarted(snapshot as Parameters<typeof run.observer.onStarted>[0])
    journal.release(run)

    const preStart = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_approval_checkpoint" })
    expect(preStart).toMatchObject({ status: "ready_for_approval", provider_called: false, tool_executed: false, network_called: false, events_appended: false })
    const preStartApprovalInput = {
      investigation_id: "inv_recovery_approval_checkpoint",
      recovery_plan_hash: preStart.recovery_plan_hash!,
      decision: "approve_resume_from_checkpoint" as const,
      approved_by: "human_operator",
      human_note: "Reviewed compatible checkpoint plan.",
      acknowledgements: {
        fresh_context_required: true as const,
        exact_replay_unavailable: true as const,
        provider_request_replay_forbidden: true as const,
        tool_execution_replay_forbidden: true as const,
      },
    }
    const preStartRecord = await server.recordCommanderInvestigationRecoveryApproval(preStartApprovalInput)
    expect(preStartRecord).toMatchObject({ status: "blocked", events_appended: false, provider_called: false, tool_executed: false, network_called: false })
    await server.start()
    const before = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_approval_checkpoint" })
    expect(before).toMatchObject({
      status: "ready_for_approval",
      recovery_kind: "checkpoint",
      recommended_action: "approve_resume_from_checkpoint",
      approval_state: "none",
      recovery_approval_required: true,
      provider_called: false,
      tool_executed: false,
      network_called: false,
      events_appended: false,
    })
    expect(before.recovery_basis_hash).toBeString()
    expect(before.recovery_plan_hash).toBeString()
    const approvalInput = { ...preStartApprovalInput, recovery_plan_hash: before.recovery_plan_hash! }
    const approvalPreview = await server.previewCommanderInvestigationRecoveryApproval(approvalInput)
    expect(approvalPreview).toMatchObject({
      status: "ready",
      recovery_plan_hash_match: true,
      acknowledgement_complete: true,
      would_append_event: true,
      events_appended: false,
      provider_called: false,
      tool_executed: false,
      network_called: false,
    })
    expect(approvalPreview.recovery_basis_hash).toBe(before.recovery_basis_hash)
    let appendBoundaryPreviewCalls = 0
    let staleAppendCalls = 0
    const staleBoundaryApproval = await new CommanderInvestigationRecoveryApprovalService({
      recoveryPreview: async () => {
        appendBoundaryPreviewCalls += 1
        if (appendBoundaryPreviewCalls === 1) return before
        return {
          ...before,
          status: "blocked" as const,
          recommended_action: "reconfigure_runtime" as const,
          human_control: {
            ...before.human_control,
            action: "blocked" as const,
            blockers: ["human stop changed before approval append"],
          },
          blockers: ["human stop changed before approval append"],
        }
      },
      recoverySource: async () => journal.recoverySource("inv_recovery_approval_checkpoint"),
      journalService: {
        recordRecoveryApprovalAfterRevalidation: async (_investigationId: string, revalidate: () => Promise<unknown>) => {
          await revalidate()
          staleAppendCalls += 1
          throw new Error("must not append stale approval")
        },
      } as any,
    }).record(approvalInput)
    expect(staleBoundaryApproval).toMatchObject({
      status: "blocked",
      events_appended: false,
      provider_called: false,
      tool_executed: false,
      network_called: false,
    })
    expect(staleBoundaryApproval.blockers.join("\n")).toContain("changed before approval append")
    expect(appendBoundaryPreviewCalls).toBe(2)
    expect(staleAppendCalls).toBe(0)
    let tailRacePreviewCalls = 0
    const tailRaceApproval = await new CommanderInvestigationRecoveryApprovalService({
      recoveryPreview: async () => {
        tailRacePreviewCalls += 1
        if (tailRacePreviewCalls === 2) {
          await server.eventStore.append({ kind: "runtime_test_tail_changed", changed_at: "2026-01-01T00:00:00.500Z" } as Parameters<EventStore["append"]>[0])
        }
        return before
      },
      recoverySource: async () => journal.recoverySource("inv_recovery_approval_checkpoint"),
      journalService: journal,
    }).record(approvalInput)
    expect(tailRaceApproval).toMatchObject({
      status: "blocked",
      events_appended: false,
      provider_called: false,
      tool_executed: false,
      network_called: false,
    })
    expect(tailRaceApproval.blockers.join("\n")).toContain("event log changed before append")
    expect(tailRacePreviewCalls).toBe(2)
    let capturedAmbiguousApproval: any
    const reconciledAmbiguousAppend = await new CommanderInvestigationRecoveryApprovalService({
      recoveryPreview: async () => before,
      recoverySource: async () => {
        const source = await journal.recoverySource("inv_recovery_approval_checkpoint")
        if (!capturedAmbiguousApproval) return source
        const summary = {
          approval_id: capturedAmbiguousApproval.approval_id,
          approval_sequence: 0,
          decision: capturedAmbiguousApproval.decision,
          approved_by: capturedAmbiguousApproval.approved_by,
          approved_at: capturedAmbiguousApproval.approved_at,
          human_note_hash: capturedAmbiguousApproval.human_note_hash,
          recovery_basis_hash: capturedAmbiguousApproval.recovery_basis_hash,
          recovery_plan_hash: capturedAmbiguousApproval.recovery_plan_hash,
          recovery_packet_hash: capturedAmbiguousApproval.recovery_packet_hash,
          checkpoint_ref: capturedAmbiguousApproval.checkpoint_ref,
          pending_model_step_ref: capturedAmbiguousApproval.pending_model_step_ref,
          pending_model_request_id: capturedAmbiguousApproval.pending_model_step_ref?.model_request_id,
          provider_execution_envelope_hash: capturedAmbiguousApproval.provider_execution_envelope_hash,
          tool_compatibility_hash: capturedAmbiguousApproval.tool_compatibility_hash,
          provider_compatibility_hash: capturedAmbiguousApproval.provider_compatibility_hash,
          budget_compatibility_hash: capturedAmbiguousApproval.budget_compatibility_hash,
          context_compatibility_hash: capturedAmbiguousApproval.context_compatibility_hash,
          continuity_compatibility_hash: capturedAmbiguousApproval.continuity_compatibility_hash,
          human_control_compatibility_hash: capturedAmbiguousApproval.human_control_compatibility_hash,
          approval_hash: capturedAmbiguousApproval.approval_hash,
        }
        return { ...source!, recovery_approvals: [summary], latest_recovery_approval: summary }
      },
      journalService: {
        recordRecoveryApprovalAfterRevalidation: async (_investigationId: string, revalidate: () => Promise<any>) => {
          capturedAmbiguousApproval = (await revalidate()).approval
          throw new Error("simulated close failure after synced recovery approval")
        },
      } as any,
    }).record(approvalInput)
    expect(reconciledAmbiguousAppend).toMatchObject({
      status: "recorded",
      approval_state: "current",
      events_appended: true,
      provider_called: false,
      tool_executed: false,
      network_called: false,
    })
    expect(reconciledAmbiguousAppend.warnings.join("\n")).toContain("reconciled recovery approval after ambiguous append failure")
    let approvalEventsBeforeRecord = (await readFile(server.eventStore.eventsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { kind: string })
    expect(approvalEventsBeforeRecord.filter((event) => event.kind === "runtime_commander_investigation_recovery_approved")).toHaveLength(0)
    const recorded = await server.recordCommanderInvestigationRecoveryApproval(approvalInput)
    expect(recorded).toMatchObject({
      status: "recorded",
      approval_state: "current",
      recovery_basis_hash: before.recovery_basis_hash,
      recovery_plan_hash: before.recovery_plan_hash,
      events_appended: true,
      provider_called: false,
      tool_executed: false,
      network_called: false,
    })
    expect(recorded.approval).toMatchObject({
      decision: "approve_resume_from_checkpoint",
      approval_source: "human",
      one_shot: true,
      automatic: false,
      execution_supported_in_this_branch: false,
      exact_replay_supported: false,
      provider_request_replay_allowed: false,
      tool_execution_replay_allowed: false,
    })
    const after = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_approval_checkpoint" })
    expect(after).toMatchObject({
      status: "approved_waiting_for_execution",
      recommended_action: "await_recovery_execution",
      approval_state: "current",
      recovery_approval_required: false,
      recovery_approval_consumed: false,
      automatic_resume_allowed: false,
    })
    expect(after.recovery_basis_hash).toBe(before.recovery_basis_hash)
    expect(after.recovery_plan_hash).toBe(before.recovery_plan_hash)
    const approvalRecord = await journal.get("inv_recovery_approval_checkpoint")
    expect(approvalRecord?.updated_at).toBe(recorded.approval?.approved_at)
    const duplicate = await server.recordCommanderInvestigationRecoveryApproval(approvalInput)
    expect(duplicate).toMatchObject({ status: "already_recorded", events_appended: false })
    const approvedCheckpoint = await journal.latestCheckpoint("inv_recovery_approval_checkpoint")
    const driftModelStep = {
      kind: "runtime_commander_investigation_model_step_started",
      schema_version: 1,
      investigation_id: "inv_recovery_approval_checkpoint",
      journal_sequence: 2,
      turn_index: 1,
      model_request_id: "model_request_approval_checkpoint_drift",
      provider_id: input.provider_id,
      provider_kind: input.provider_kind,
      model_id: input.model_id,
      tool_protocol: "native",
      base_checkpoint_id: approvedCheckpoint!.checkpoint_id,
      base_checkpoint_sequence: approvedCheckpoint!.checkpoint_sequence,
      base_checkpoint_hash: approvedCheckpoint!.checkpoint_hash,
      working_set_hash: approvedCheckpoint!.working_set.working_set_hash,
      context_hash: "context_hash_approval_checkpoint_drift",
      input_bytes: 128,
      estimated_input_tokens: 32,
      loaded_tool_refs: approvedCheckpoint!.loaded_tools,
      provider_request_count_before: 0,
      external_api_audit_count_before: 0,
      started_at: "2026-01-01T00:01:00.000Z",
      requested_by: input.requested_by,
      occurred_at: "2026-01-01T00:01:00.000Z",
      event_payload_hash: "",
    }
    driftModelStep.event_payload_hash = journalPayloadHash(driftModelStep)
    await server.eventStore.append(driftModelStep as Parameters<EventStore["append"]>[0])
	    const driftWorkingSet = {
	      ...approvedCheckpoint!.working_set,
	      model_turn_count: 1,
	      current_warnings: ["checkpoint changed after approval"],
	      working_set_hash: "",
	    }
	    driftWorkingSet.working_set_hash = stableHash(stableCommanderInvestigationWorkingSet(driftWorkingSet as CommanderInvestigationWorkingSet))
	    const driftCheckpoint = finalizeTestCheckpoint({
	      ...approvedCheckpoint!,
	      checkpoint_sequence: 1,
	      checkpoint_kind: "turn_complete",
	      turn_index: 1,
	      next_turn_index: 2,
	      previous_checkpoint_id: approvedCheckpoint!.checkpoint_id,
	      previous_checkpoint_hash: approvedCheckpoint!.checkpoint_hash,
	      provider_request_count: 1,
	      working_set: driftWorkingSet,
	      replay_exchange: summaryOnlyReplayExchangeFixture(1),
	    })
    const driftCheckpointEvent = {
      kind: "runtime_commander_investigation_checkpointed",
      schema_version: 1,
      investigation_id: "inv_recovery_approval_checkpoint",
      journal_sequence: 3,
      requested_by: input.requested_by,
      occurred_at: "2026-01-01T00:01:01.000Z",
      checkpoint: driftCheckpoint,
      event_payload_hash: "",
    }
    driftCheckpointEvent.event_payload_hash = journalPayloadHash(driftCheckpointEvent)
    await server.eventStore.append(driftCheckpointEvent as Parameters<EventStore["append"]>[0])
    const stale = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_approval_checkpoint" })
    expect(stale).toMatchObject({
      status: "ready_for_approval",
      approval_state: "stale",
      stale_approval_count: 1,
      recovery_approval_required: true,
    })
    expect(stale.recovery_basis_hash).not.toBe(before.recovery_basis_hash)
    expect(stale.recovery_plan_hash).not.toBe(before.recovery_plan_hash)
    const staleRecord = await journal.get("inv_recovery_approval_checkpoint")
    expect(staleRecord).toMatchObject({
      recovery_state: "checkpoint_available_resume_not_implemented",
      recovery_approval_count: 1,
      recovery_approval_recorded: false,
      latest_recovery_approval_id: undefined,
    })
    const events = (await readFile(server.eventStore.eventsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { kind: string; [key: string]: unknown })
    expect(events.filter((event) => event.kind === "runtime_commander_investigation_recovery_approved")).toHaveLength(1)
    expect(JSON.stringify(events)).not.toContain("https://api.example.test")
    expect(JSON.stringify(events)).not.toContain("real-provider-key")
    expect(JSON.stringify(events)).not.toContain("authorization")
    expect(JSON.stringify(events)).not.toContain("provider prompt")
    await server.shutdown("approval checkpoint test")
    const shutdownIndex = events.findIndex((event) => event.kind === "runtime_shutdown")
    expect(shutdownIndex).toBe(-1)
  })

  test("recovery preparation binds fresh continuation state into plan and scripted kernel", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3b2b1-preparation-"))
    await writeApprovedSpec(projectDir)
	    const server = configuredProviderRuntimeServer(projectDir)
	    servers.push({ stop: () => server.shutdown() })
	    const journal = new CommanderInvestigationJournalService({ eventStore: server.eventStore })
	    const toolProfile = COMMANDER_TOOL_REGISTRY.find((tool) => tool.tool_id === "commander.tool_profile")
	    expect(toolProfile).toBeDefined()
    const input = baseInvestigation({
      investigation_id: "inv_recovery_preparation_checkpoint",
      objective: "Prepare checkpoint recovery without execution",
      provider_id: "fixture_provider",
      provider_kind: "openai",
      model_id: "fixture-model",
      tool_protocol: "native",
	    })
	    const run = await journal.createObserver(input)
	    const snapshot = durableStartedSnapshot(input, 24, "inv_recovery_preparation_checkpoint") as any
	    snapshot.budget = {
	      ...snapshot.budget,
	      max_tool_calls: 20,
	      max_loaded_schemas: 1,
	      max_context_bytes: 16_384,
	      tool_schema_allocation_bytes: 16_384,
	      tool_schema_allocation_tokens: 4_096,
	      budget_hash: "",
	    }
	    snapshot.budget.budget_hash = stableHash({ ...snapshot.budget, budget_hash: "" })
	    snapshot.loaded_tools = [toolProfile!]
	    snapshot.working_set.loaded_tool_ids = ["commander.tool_profile"]
	    snapshot.working_set.working_set_hash = stableHash(stableCommanderInvestigationWorkingSet(snapshot.working_set as CommanderInvestigationWorkingSet))
	    await run.observer.onStarted(snapshot as Parameters<typeof run.observer.onStarted>[0])
    journal.release(run)

    const before = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_preparation_checkpoint" })
    expect(before).toMatchObject({
      status: "ready_for_approval",
      recovery_kind: "checkpoint",
      execution_preparation: {
        recovery_kind: "checkpoint",
        next_turn_index: 1,
        exact_replay_supported: false,
        original_assistant_text_available: false,
        fresh_context_required: true,
      },
      provider_called: false,
      tool_executed: false,
      network_called: false,
      events_appended: false,
    })
    expect(before.execution_preparation_hash).toBe(before.execution_preparation?.execution_preparation_hash)
    expect(before.recovery_packet?.execution_preparation_hash).toBe(before.execution_preparation_hash)
    expect(before.recovery_packet?.first_model_request_preview_hash).toBe(before.execution_preparation?.first_model_request_preview_hash)
    expect(before.recovery_plan_hash).toBeString()

    await server.start()
    const approval = await server.recordCommanderInvestigationRecoveryApproval({
      investigation_id: "inv_recovery_preparation_checkpoint",
      recovery_plan_hash: before.recovery_plan_hash!,
      decision: "approve_resume_from_checkpoint",
      approved_by: "human_operator",
      acknowledgements: {
        fresh_context_required: true,
        exact_replay_unavailable: true,
        provider_request_replay_forbidden: true,
        tool_execution_replay_forbidden: true,
      },
    })
    expect(approval).toMatchObject({ status: "recorded", events_appended: true, provider_called: false, tool_executed: false, network_called: false })
    const after = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_preparation_checkpoint" })
    expect(after).toMatchObject({
      status: "approved_waiting_for_execution",
      recommended_action: "await_recovery_execution",
      approval_state: "current",
      recovery_approval_consumed: false,
      execution_preparation_hash: before.execution_preparation_hash,
    })
    expect(after.recovery_plan_hash).toBe(before.recovery_plan_hash)
    expect(after.recovery_packet?.packet_hash).toBe(before.recovery_packet?.packet_hash)

    const preparation = await server.previewCommanderInvestigationRecoveryExecutionPreparation({
      investigation_id: "inv_recovery_preparation_checkpoint",
      approval_id: approval.approval!.approval_id,
      approval_hash: approval.approval!.approval_hash,
      recovery_plan_hash: after.recovery_plan_hash!,
    })
    expect(preparation).toMatchObject({
      status: "ready",
      approval_current: true,
      approval_consumed: false,
      execution_supported_in_this_branch: false,
      provider_called: false,
      tool_executed: false,
      network_called: false,
      events_appended: false,
      files_written: false,
      research_db_written: false,
      first_model_request: {
        turn_index: 1,
        old_request_replayed: false,
        tool_execution_replayed: false,
        provider_called: false,
      },
      continuation_summary: {
        exact_replay_supported: false,
        original_assistant_text_available: false,
        fresh_context_required: true,
      },
    })
    expect(preparation.execution_preparation_hash).toBe(before.execution_preparation_hash)
    expect(preparation.first_model_request?.request_id).toContain("_recovery_0_")
    expect(JSON.stringify(preparation)).not.toContain("https://api.example.test")
    expect(JSON.stringify(preparation)).not.toContain("real-provider-key")

    const source = await server.getCommanderInvestigationRecoverySource("inv_recovery_preparation_checkpoint")
    const builder = new CommanderInvestigationRecoveryContinuationBuilder({
      descriptors: COMMANDER_TOOL_REGISTRY,
      currentBootstrap: (bootstrapInput) => (server as any).commanderInvestigationBootstrapService().compile(bootstrapInput),
      contextService: new CommanderInvestigationContextService(),
      modelOutputTokens: () => 1024,
    })
    const built = await builder.build({ source: source!, preview: after, checkpoint: source!.latest_checkpoint! })
    expect(built.blockers).toEqual([])
    expect(built.seed?.execution_preparation_hash).toBe(before.execution_preparation_hash)
    expect(built.seed?.effective_budget.effective_budget.max_tool_calls).toBe(before.budget_compatibility.current_policy_limits.max_tool_calls)
    expect(built.seed?.effective_budget.effective_budget.max_loaded_schemas).toBe(1)
    expect(built.seed?.effective_budget.remaining.loaded_schemas).toBe(0)
    let capturedRequest: CommanderModelStepRequest | undefined
    const runtimeCapability = commanderInvestigationModelCapability(validateCommanderInvestigationProviderConfig(providerConfig()))
    const registry = new ModelCapabilityRegistry({ runtimeCapabilities: [runtimeCapability] })
	    const controller = new CommanderInvestigationController({
	      modelAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "Recovered scripted final.", assert_request: (request) => { capturedRequest = request } }]),
	      toolExecutor: executorFixture().executor,
	      toolService: new CommanderToolService({ contextBudgetService: new ContextBudgetService({ registry }) }),
	      descriptors: COMMANDER_TOOL_REGISTRY,
	      boundToolIds: COMMANDER_BOUND_TOOL_IDS,
	      bootstrapService: (server as any).commanderInvestigationBootstrapService(),
	      contextService: new CommanderInvestigationContextService(),
	      capabilityRegistry: registry,
	      contextBudgetService: new ContextBudgetService({ registry }),
	    })
    const recovered = await controller.runFromRecoverySeed(built.seed!)
    expect(recovered).toMatchObject({
      investigation_id: "inv_recovery_preparation_checkpoint",
      status: "final",
      stop_reason: "model_final",
      model_turn_count: 1,
      provider_request_count: 1,
      tool_call_count: 0,
      events_appended: false,
    })
	    expect(capturedRequest?.request_id).toBe(preparation.first_model_request?.request_id)
	    expect(capturedRequest?.messages.some((message) => message.role === "user" && message.content.includes("commander_investigation_recovery_notice"))).toBe(true)
	    expect(capturedRequest?.tools.map((tool) => tool.tool_id)).toEqual(["commander.tool_profile"])

	    const toolExecutor = executorFixture()
	    let toolTurnRequest: CommanderModelStepRequest | undefined
	    let finalAfterToolRequest: CommanderModelStepRequest | undefined
	    const toolController = new CommanderInvestigationController({
	      modelAdapter: new ScriptedCommanderModelStepAdapter([
	        { status: "tool_call", tool_calls: [toolCall("recover_profile", "commander.tool_profile", { phase: "proposal_investigation" })], assert_request: (request) => { toolTurnRequest = request } },
	        { status: "final", text: "Recovered after scripted tool.", assert_request: (request) => { finalAfterToolRequest = request } },
	      ]),
	      toolExecutor: toolExecutor.executor,
	      toolService: new CommanderToolService({ contextBudgetService: new ContextBudgetService({ registry }) }),
	      descriptors: COMMANDER_TOOL_REGISTRY,
	      boundToolIds: COMMANDER_BOUND_TOOL_IDS,
	      bootstrapService: (server as any).commanderInvestigationBootstrapService(),
	      contextService: new CommanderInvestigationContextService(),
	      capabilityRegistry: registry,
	      contextBudgetService: new ContextBudgetService({ registry }),
	    })
	    const recoveredWithTool = await toolController.runFromRecoverySeed(built.seed!)
	    expect(recoveredWithTool).toMatchObject({
	      status: "final",
	      stop_reason: "model_final",
	      model_turn_count: 2,
	      provider_request_count: 2,
	      tool_call_count: 1,
	      events_appended: false,
	    })
	    expect(toolTurnRequest?.request_id).toBe(preparation.first_model_request?.request_id)
	    expect(finalAfterToolRequest?.request_id).toContain("_recovery_0_")
	    expect(finalAfterToolRequest?.request_id).not.toBe(toolTurnRequest?.request_id)
	    expect(finalAfterToolRequest?.messages.some((message) => message.role === "tool" && message.tool_call_id === "recover_profile")).toBe(true)

    const events = (await readFile(server.eventStore.eventsPath, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, any>)
    const approvalEvent = events.find((event) => event.kind === "runtime_commander_investigation_recovery_approved")
    const legacyApprovalEvent = {
      ...approvalEvent!,
      approval: {
        ...approvalEvent!.approval,
        recovery_plan_hash: stableHash({ legacy_preparation_missing: true }),
        approval_hash: "",
      },
      event_payload_hash: "",
    }
    legacyApprovalEvent.approval.approval_hash = stableHash({ ...legacyApprovalEvent.approval, approved_at: "", approval_hash: "" })
    legacyApprovalEvent.event_payload_hash = journalPayloadHash(legacyApprovalEvent)
    const legacyDir = await mkdtemp(join(tmpdir(), "nxl-9w3b2b1-legacy-approval-"))
    const legacyStore = new EventStore(join(legacyDir, ".nxl", "events.jsonl"))
    for (const event of events.filter((candidate) => candidate.kind !== "runtime_commander_investigation_recovery_approved")) await legacyStore.append(event as Parameters<EventStore["append"]>[0])
    await legacyStore.append(legacyApprovalEvent as Parameters<EventStore["append"]>[0])
    await writeApprovedSpec(legacyDir)
    const legacyServer = configuredProviderRuntimeServer(legacyDir)
    servers.push({ stop: () => legacyServer.shutdown() })
    const legacyPreview = await legacyServer.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_preparation_checkpoint" })
    expect(legacyPreview).toMatchObject({
      status: "ready_for_approval",
      approval_state: "stale",
      stale_approval_count: 1,
      current_approval: undefined,
      recovery_approval_required: true,
    })
    expect(legacyPreview.recovery_plan_hash).toBe(before.recovery_plan_hash)
    expect(legacyPreview.recovery_packet?.execution_preparation_hash).toBe(before.execution_preparation_hash)
    expect(legacyPreview.warnings.join("\n")).toContain("stale")

    await server.shutdown("recovery preparation checkpoint test")
  })

  test("recovery approval hashes the full bounded human note while storing only a preview", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3b2a-approval-note-hash-"))
    await writeApprovedSpec(projectDir)
    const server = configuredProviderRuntimeServer(projectDir)
    const journal = (server as any).commanderInvestigationJournalService() as CommanderInvestigationJournalService
    const input = baseInvestigation({
      investigation_id: "inv_recovery_approval_note_hash",
      objective: "Approve checkpoint with long distinct notes",
      provider_id: "fixture_provider",
      provider_kind: "openai",
      model_id: "fixture-model",
      tool_protocol: "native",
    })
    const run = await journal.createObserver(input)
    const snapshot = durableStartedSnapshot(input, 23, "inv_recovery_approval_note_hash") as any
    snapshot.budget = { ...snapshot.budget, max_context_bytes: 8192, budget_hash: "" }
    snapshot.budget.budget_hash = stableHash({ ...snapshot.budget, budget_hash: "" })
    await run.observer.onStarted(snapshot as Parameters<typeof run.observer.onStarted>[0])
    journal.release(run)
    await server.start()
    const preview = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_approval_note_hash" })
    expect(preview).toMatchObject({ status: "ready_for_approval" })
    const acknowledgements = {
      fresh_context_required: true as const,
      exact_replay_unavailable: true as const,
      provider_request_replay_forbidden: true as const,
      tool_execution_replay_forbidden: true as const,
    }
    const sharedPrefix = "reviewed ".padEnd(500, "x")
    const first = await server.recordCommanderInvestigationRecoveryApproval({
      investigation_id: "inv_recovery_approval_note_hash",
      recovery_plan_hash: preview.recovery_plan_hash!,
      decision: "approve_resume_from_checkpoint",
      approved_by: "human_operator",
      human_note: `${sharedPrefix}A`,
      acknowledgements,
    })
    const secondPreview = await server.previewCommanderInvestigationRecoveryApproval({
      investigation_id: "inv_recovery_approval_note_hash",
      recovery_plan_hash: preview.recovery_plan_hash!,
      decision: "approve_resume_from_checkpoint",
      approved_by: "human_operator",
      human_note: `${sharedPrefix}B`,
      acknowledgements,
    })
    expect(first.status).toBe("recorded")
    expect(secondPreview.status).toBe("ready")
    expect(secondPreview.existing_current_approval).toBeUndefined()
    expect(first.approval?.human_note_preview).toBe(sharedPrefix)
    expect(first.approval?.human_note_hash).not.toBe(stableHash(sharedPrefix))
    const second = await server.recordCommanderInvestigationRecoveryApproval({
      investigation_id: "inv_recovery_approval_note_hash",
      recovery_plan_hash: preview.recovery_plan_hash!,
      decision: "approve_resume_from_checkpoint",
      approved_by: "human_operator",
      human_note: `${sharedPrefix}B`,
      acknowledgements,
    })
    expect(second).toMatchObject({ status: "recorded", events_appended: true })
    expect(second.approval?.approval_id).not.toBe(first.approval?.approval_id)
    const afterSecond = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_approval_note_hash" })
    expect(afterSecond).toMatchObject({
      status: "approved_waiting_for_execution",
      approval_state: "current",
      stale_approval_count: 0,
      current_approval: {
        approval_id: second.approval?.approval_id,
        approved_by: "human_operator",
      },
    })
    const duplicateFirst = await server.recordCommanderInvestigationRecoveryApproval({
      investigation_id: "inv_recovery_approval_note_hash",
      recovery_plan_hash: preview.recovery_plan_hash!,
      decision: "approve_resume_from_checkpoint",
      approved_by: "human_operator",
      human_note: `${sharedPrefix}A`,
      acknowledgements,
    })
    expect(duplicateFirst).toMatchObject({ status: "already_recorded", events_appended: false })
    const events = (await readFile(server.eventStore.eventsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { kind: string })
    expect(events.filter((event) => event.kind === "runtime_commander_investigation_recovery_approved")).toHaveLength(2)
    await server.shutdown("approval note hash test")
  })

  test("recovery approval uses a runtime-owned external API env snapshot", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3b2a-approval-env-snapshot-"))
    await writeApprovedSpec(projectDir)
    const externalApiEnv: Record<string, string | undefined> = { NXL_TEST_MODEL_KEY: "real-provider-key" }
    const registry = new ExternalApiConnectorRegistry([connector("openai-test", "https://api.example.test/v1")])
    const connectorCopy = registry.get("openai-test")!
    const server = configuredProviderRuntimeServer(projectDir, { externalApiEnv, externalApiConnectorRegistry: registry })
    servers.push({ stop: () => server.shutdown() })
    const journal = new CommanderInvestigationJournalService({ eventStore: server.eventStore })
    const input = baseInvestigation({
      investigation_id: "inv_recovery_approval_env_snapshot",
      objective: "Approve checkpoint after caller env mutation",
      provider_id: "fixture_provider",
      provider_kind: "openai",
      model_id: "fixture-model",
      tool_protocol: "native",
    })
    const run = await journal.createObserver(input)
    const snapshot = durableStartedSnapshot(input, 22, "inv_recovery_approval_env_snapshot") as any
    snapshot.budget = { ...snapshot.budget, max_context_bytes: 8192, budget_hash: "" }
    snapshot.budget.budget_hash = stableHash({ ...snapshot.budget, budget_hash: "" })
    await run.observer.onStarted(snapshot as Parameters<typeof run.observer.onStarted>[0])
    journal.release(run)
    externalApiEnv.NXL_TEST_MODEL_KEY = undefined
    connectorCopy.base_url = "https://api-mutated.example.test/v1"
    connectorCopy.allowed_hosts = ["api-mutated.example.test"]
    await server.start()
    const preview = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_approval_env_snapshot" })
    expect(preview).toMatchObject({
      status: "ready_for_approval",
      provider_compatibility: { credentials_ready: true },
    })
    const recorded = await server.recordCommanderInvestigationRecoveryApproval({
      investigation_id: "inv_recovery_approval_env_snapshot",
      recovery_plan_hash: preview.recovery_plan_hash!,
      decision: "approve_resume_from_checkpoint",
      approved_by: "human_operator",
      human_note: "   \n\t  ",
      acknowledgements: {
        fresh_context_required: true,
        exact_replay_unavailable: true,
        provider_request_replay_forbidden: true,
        tool_execution_replay_forbidden: true,
      },
    })
    expect(recorded).toMatchObject({
      status: "recorded",
      events_appended: true,
      provider_called: false,
      tool_executed: false,
      network_called: false,
    })
    expect(recorded.approval?.human_note_preview).toBeUndefined()
    expect(recorded.approval?.human_note_hash).toBeString()
    const record = await server.getCommanderInvestigationRecord("inv_recovery_approval_env_snapshot")
    expect(record?.projection_status).toBe("ready")
  })

  test("recovery approval accepts credential words in IDs, operators, and token-budget notes", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3b2a-approval-credential-words-"))
    await writeApprovedSpec(projectDir)
    const server = configuredProviderRuntimeServer(projectDir)
    servers.push({ stop: () => server.shutdown() })
    const journal = new CommanderInvestigationJournalService({ eventStore: server.eventStore })
    for (const investigationId of ["inv_context_token_budget", "inv_secret_scanning_review"]) {
      const input = baseInvestigation({
        investigation_id: investigationId,
        objective: `Approve ${investigationId} recovery`,
        provider_id: "fixture_provider",
        provider_kind: "openai",
        model_id: "fixture-model",
        tool_protocol: "native",
      })
      const run = await journal.createObserver(input)
      const snapshot = durableStartedSnapshot(input, 21, investigationId) as any
      snapshot.budget = { ...snapshot.budget, max_context_bytes: 8192, budget_hash: "" }
      snapshot.budget.budget_hash = stableHash({ ...snapshot.budget, budget_hash: "" })
      await run.observer.onStarted(snapshot as Parameters<typeof run.observer.onStarted>[0])
      journal.release(run)
    }
    await server.start()
    const tokenBudgetPreview = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_context_token_budget" })
    expect(tokenBudgetPreview).toMatchObject({ status: "ready_for_approval" })
    const recorded = await server.recordCommanderInvestigationRecoveryApproval({
      investigation_id: "inv_context_token_budget",
      recovery_plan_hash: tokenBudgetPreview.recovery_plan_hash!,
      decision: "approve_resume_from_checkpoint",
      approved_by: "credential_platform_team",
      human_note: "reviewed token-budget recovery behavior",
      acknowledgements: {
        fresh_context_required: true,
        exact_replay_unavailable: true,
        provider_request_replay_forbidden: true,
        tool_execution_replay_forbidden: true,
      },
    })
    expect(recorded).toMatchObject({ status: "recorded", events_appended: true })
    expect(recorded.approval?.human_note_preview).toBe("reviewed token-budget recovery behavior")
    const secretScanningPreview = await server.previewCommanderInvestigationRecoveryApproval({
      investigation_id: "inv_secret_scanning_review",
      recovery_plan_hash: (await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_secret_scanning_review" })).recovery_plan_hash!,
      decision: "approve_resume_from_checkpoint",
      approved_by: "tokenization_reviewer",
      human_note: "reviewed secret scanning labels without including a secret value",
      acknowledgements: {
        fresh_context_required: true,
        exact_replay_unavailable: true,
        provider_request_replay_forbidden: true,
        tool_execution_replay_forbidden: true,
      },
    })
    expect(secretScanningPreview).toMatchObject({ status: "ready", acknowledgement_complete: true })
    const urlBlocked = await server.previewCommanderInvestigationRecoveryApproval({
      investigation_id: "inv_context_token_budget",
      recovery_plan_hash: tokenBudgetPreview.recovery_plan_hash!,
      decision: "approve_resume_from_checkpoint",
      approved_by: "https://operator.example.test",
      acknowledgements: {
        fresh_context_required: true,
        exact_replay_unavailable: true,
        provider_request_replay_forbidden: true,
        tool_execution_replay_forbidden: true,
      },
    })
    expect(urlBlocked).toMatchObject({ status: "blocked", events_appended: false })
    expect(urlBlocked.blockers.join("\n")).toContain("approved_by must not contain URLs or credential payloads")
    const tokenApproverBlocked = await server.previewCommanderInvestigationRecoveryApproval({
      investigation_id: "inv_context_token_budget",
      recovery_plan_hash: tokenBudgetPreview.recovery_plan_hash!,
      decision: "approve_resume_from_checkpoint",
      approved_by: "token=realCredentialPayload123",
      acknowledgements: {
        fresh_context_required: true,
        exact_replay_unavailable: true,
        provider_request_replay_forbidden: true,
        tool_execution_replay_forbidden: true,
      },
    })
    expect(tokenApproverBlocked).toMatchObject({ status: "blocked", events_appended: false })
    expect(tokenApproverBlocked.blockers.join("\n")).toContain("approved_by must not contain URLs or credential payloads")
    const unknownAcknowledgementBlocked = await server.previewCommanderInvestigationRecoveryApproval({
      investigation_id: "inv_context_token_budget",
      recovery_plan_hash: tokenBudgetPreview.recovery_plan_hash!,
      decision: "approve_resume_from_checkpoint",
      approved_by: "human_operator",
      acknowledgements: {
        fresh_context_required: true,
        exact_replay_unavailable: true,
        provider_request_replay_forbidden: true,
        tool_execution_replay_forbidden: true,
        provider_request_replay_allowed: true,
      } as any,
    })
    expect(unknownAcknowledgementBlocked).toMatchObject({ status: "blocked", events_appended: false })
    expect(unknownAcknowledgementBlocked.blockers.join("\n")).toContain("unknown recovery approval acknowledgement key provider_request_replay_allowed")
    for (const approved_by of ["token=realCredentialPayload123", "aws_access_key_id=AKIAREALCREDENTIALPAYLOAD123", "private_key=realCredentialPayload123"]) {
      const blocked = await server.previewCommanderInvestigationRecoveryApproval({
        investigation_id: "inv_context_token_budget",
        recovery_plan_hash: tokenBudgetPreview.recovery_plan_hash!,
        decision: "approve_resume_from_checkpoint",
        approved_by,
        acknowledgements: {
          fresh_context_required: true,
          exact_replay_unavailable: true,
          provider_request_replay_forbidden: true,
          tool_execution_replay_forbidden: true,
        },
      })
      expect(blocked).toMatchObject({ status: "blocked", events_appended: false })
      expect(blocked.blockers.join("\n")).toContain("approved_by must not contain URLs or credential payloads")
    }
    for (const human_note of ["api_key=sk-realCredentialPayload123", "Bearer realCredentialPayload123", "secret: realCredentialPayload123", "access_token=realCredentialPayload123", "aws_secret_access_key=realCredentialPayload123", "private_key=realCredentialPayload123"]) {
      const blocked = await server.previewCommanderInvestigationRecoveryApproval({
        investigation_id: "inv_context_token_budget",
        recovery_plan_hash: tokenBudgetPreview.recovery_plan_hash!,
        decision: "approve_resume_from_checkpoint",
        approved_by: "human_operator",
        human_note,
        acknowledgements: {
          fresh_context_required: true,
          exact_replay_unavailable: true,
          provider_request_replay_forbidden: true,
          tool_execution_replay_forbidden: true,
        },
      })
      expect(blocked).toMatchObject({ status: "blocked", events_appended: false })
      expect(blocked.blockers.join("\n")).toContain("human_note must not contain URLs or credential payloads")
    }
    const events = (await readFile(server.eventStore.eventsPath, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { kind: string })
    expect(events.filter((event) => event.kind === "runtime_commander_investigation_recovery_approved")).toHaveLength(1)
  })

  test("recovery approval snapshots mutable caller input before async preview", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3b2a-approval-input-snapshot-"))
    await writeApprovedSpec(projectDir)
    const server = configuredProviderRuntimeServer(projectDir)
    servers.push({ stop: () => server.shutdown() })
    const journal = new CommanderInvestigationJournalService({ eventStore: server.eventStore })
    const input = baseInvestigation({
      investigation_id: "inv_recovery_approval_mutation",
      objective: "Approve checkpoint despite caller mutation",
      provider_id: "fixture_provider",
      provider_kind: "openai",
      model_id: "fixture-model",
      tool_protocol: "native",
    })
    const run = await journal.createObserver(input)
    const snapshot = durableStartedSnapshot(input, 20, "inv_recovery_approval_mutation") as any
    snapshot.budget = { ...snapshot.budget, max_context_bytes: 8192, budget_hash: "" }
    snapshot.budget.budget_hash = stableHash({ ...snapshot.budget, budget_hash: "" })
    await run.observer.onStarted(snapshot as Parameters<typeof run.observer.onStarted>[0])
    journal.release(run)
    await server.start()
    const before = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_approval_mutation" })
    expect(before).toMatchObject({ status: "ready_for_approval" })
    let releasePreview!: () => void
    const enteredPreview = new Promise<void>((resolve) => {
      releasePreview = resolve
    })
    let previewCalls = 0
    const mutableInput: any = {
      investigation_id: "inv_recovery_approval_mutation",
      recovery_plan_hash: before.recovery_plan_hash!,
      decision: "approve_resume_from_checkpoint",
      approved_by: "human_operator",
      human_note: "original bounded note",
      acknowledgements: {
        fresh_context_required: true,
        exact_replay_unavailable: true,
        provider_request_replay_forbidden: true,
        tool_execution_replay_forbidden: true,
      },
    }
    const approvalPromise = new CommanderInvestigationRecoveryApprovalService({
      recoveryPreview: async () => {
        previewCalls += 1
        if (previewCalls === 1) await enteredPreview
        return before
      },
      recoverySource: async () => journal.recoverySource("inv_recovery_approval_mutation"),
      journalService: journal,
      now: () => new Date("2026-01-01T00:00:20.000Z"),
    }).record(mutableInput)
    mutableInput.decision = "approve_continue_after_uncertain_provider_outcome"
    mutableInput.acknowledgements.fresh_context_required = false
    mutableInput.acknowledgements.unknown_acknowledgement = true
    mutableInput.human_note = "api_key=sk-mutatedCredentialPayload123"
    releasePreview()
    const recorded = await approvalPromise
    expect(recorded).toMatchObject({
      status: "recorded",
      events_appended: true,
      decision: "approve_resume_from_checkpoint",
      approval: {
        decision: "approve_resume_from_checkpoint",
        human_note_preview: "original bounded note",
        acknowledgements: {
          fresh_context_required: true,
          exact_replay_unavailable: true,
          provider_request_replay_forbidden: true,
          tool_execution_replay_forbidden: true,
        },
      },
    })
    expect(recorded.approval?.acknowledgements).not.toHaveProperty("unknown_acknowledgement")
    const record = await journal.get("inv_recovery_approval_mutation")
    expect(record).toMatchObject({ projection_status: "ready", recovery_approval_recorded: true })
    const events = (await readFile(server.eventStore.eventsPath, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
    const approvalEvents = events.filter((event) => event.kind === "runtime_commander_investigation_recovery_approved")
    expect(approvalEvents).toHaveLength(1)
    expect(JSON.stringify(approvalEvents)).not.toContain("sk-mutatedCredentialPayload123")
  })

  test("recovery approval queues overlapping exact duplicates into idempotent result", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3b2a-approval-overlap-duplicate-"))
    await writeApprovedSpec(projectDir)
    const server = configuredProviderRuntimeServer(projectDir)
    servers.push({ stop: () => server.shutdown() })
    const journal = new CommanderInvestigationJournalService({ eventStore: server.eventStore })
    const input = baseInvestigation({
      investigation_id: "inv_recovery_approval_overlap_duplicate",
      objective: "Approve exact overlapping duplicate once",
      provider_id: "fixture_provider",
      provider_kind: "openai",
      model_id: "fixture-model",
      tool_protocol: "native",
    })
    const run = await journal.createObserver(input)
    const snapshot = durableStartedSnapshot(input, 18, "inv_recovery_approval_overlap_duplicate") as any
    snapshot.budget = { ...snapshot.budget, max_context_bytes: 8192, budget_hash: "" }
    snapshot.budget.budget_hash = stableHash({ ...snapshot.budget, budget_hash: "" })
    await run.observer.onStarted(snapshot as Parameters<typeof run.observer.onStarted>[0])
    journal.release(run)
    await server.start()
    const preview = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_approval_overlap_duplicate" })
    expect(preview).toMatchObject({ status: "ready_for_approval" })
    const approvalInput = {
      investigation_id: "inv_recovery_approval_overlap_duplicate",
      recovery_plan_hash: preview.recovery_plan_hash!,
      decision: "approve_resume_from_checkpoint" as const,
      approved_by: "human_operator",
      human_note: "same duplicate approval",
      acknowledgements: {
        fresh_context_required: true as const,
        exact_replay_unavailable: true as const,
        provider_request_replay_forbidden: true as const,
        tool_execution_replay_forbidden: true as const,
      },
    }
    const [first, second] = await Promise.all([
      server.recordCommanderInvestigationRecoveryApproval(approvalInput),
      server.recordCommanderInvestigationRecoveryApproval(approvalInput),
    ])
    const results = [first, second]
    expect(results.filter((result) => result.status === "recorded")).toHaveLength(1)
    expect(results.filter((result) => result.status === "already_recorded")).toHaveLength(1)
    expect(results.filter((result) => result.events_appended)).toHaveLength(1)
    const events = (await readFile(server.eventStore.eventsPath, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { kind: string })
    expect(events.filter((event) => event.kind === "runtime_commander_investigation_recovery_approved")).toHaveLength(1)
  })

  test("recovery approval replay rejects hash-valid noncanonical timestamps", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3b2a-approval-timestamp-"))
    await writeApprovedSpec(projectDir)
    const server = configuredProviderRuntimeServer(projectDir)
    servers.push({ stop: () => server.shutdown() })
    const journal = new CommanderInvestigationJournalService({ eventStore: server.eventStore })
    const input = baseInvestigation({
      investigation_id: "inv_recovery_approval_timestamp",
      objective: "Reject malformed approval timestamp",
      provider_id: "fixture_provider",
      provider_kind: "openai",
      model_id: "fixture-model",
      tool_protocol: "native",
    })
    const run = await journal.createObserver(input)
    const snapshot = durableStartedSnapshot(input, 19, "inv_recovery_approval_timestamp") as any
    snapshot.budget = { ...snapshot.budget, max_context_bytes: 8192, budget_hash: "" }
    snapshot.budget.budget_hash = stableHash({ ...snapshot.budget, budget_hash: "" })
    await run.observer.onStarted(snapshot as Parameters<typeof run.observer.onStarted>[0])
    journal.release(run)
    await server.start()
    const preview = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_approval_timestamp" })
    const recorded = await server.recordCommanderInvestigationRecoveryApproval({
      investigation_id: "inv_recovery_approval_timestamp",
      recovery_plan_hash: preview.recovery_plan_hash!,
      decision: "approve_resume_from_checkpoint",
      approved_by: "human_operator",
      acknowledgements: {
        fresh_context_required: true,
        exact_replay_unavailable: true,
        provider_request_replay_forbidden: true,
        tool_execution_replay_forbidden: true,
      },
    })
    expect(recorded.status).toBe("recorded")
    const readyRecord = await journal.get("inv_recovery_approval_timestamp")
    expect(readyRecord).toMatchObject({ projection_status: "ready", recovery_approval_recorded: true })
    const events = (await readFile(server.eventStore.eventsPath, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, any>)
    const malformedTimestampEvent = {
      ...events.find((event) => event.kind === "runtime_commander_investigation_recovery_approved")!,
      occurred_at: "zzzz",
      approval: {
        ...events.find((event) => event.kind === "runtime_commander_investigation_recovery_approved")!.approval,
        approved_at: "zzzz",
      },
      event_payload_hash: "",
    }
    malformedTimestampEvent.approval.approval_hash = stableHash({ ...malformedTimestampEvent.approval, approved_at: "", approval_hash: "" })
    malformedTimestampEvent.event_payload_hash = journalPayloadHash(malformedTimestampEvent)
    const malformedDir = await mkdtemp(join(tmpdir(), "nxl-9w3b2a-approval-timestamp-malformed-"))
    const malformedStore = new EventStore(join(malformedDir, ".nxl", "events.jsonl"))
    for (const event of events.filter((candidate) => candidate.kind !== "runtime_commander_investigation_recovery_approved")) {
      await malformedStore.append(event as Parameters<EventStore["append"]>[0])
    }
    await malformedStore.append(malformedTimestampEvent as Parameters<EventStore["append"]>[0])
    const malformedJournal = new CommanderInvestigationJournalService({ eventStore: malformedStore })
    const malformedRecord = await malformedJournal.get("inv_recovery_approval_timestamp")
    expect(malformedRecord).toMatchObject({
      projection_status: "corrupt",
      recovery_approval_recorded: false,
      latest_recovery_approval_id: undefined,
    })
    const malformedSource = await malformedJournal.recoverySource("inv_recovery_approval_timestamp")
    expect(malformedSource?.latest_recovery_approval).toBeUndefined()

    const credentialApproverEvent = {
      ...events.find((event) => event.kind === "runtime_commander_investigation_recovery_approved")!,
      requested_by: "api_key=sk-replayCredentialPayload123",
      approval: {
        ...events.find((event) => event.kind === "runtime_commander_investigation_recovery_approved")!.approval,
        approved_by: "api_key=sk-replayCredentialPayload123",
      },
      event_payload_hash: "",
    }
    credentialApproverEvent.approval.approval_hash = stableHash({ ...credentialApproverEvent.approval, approved_at: "", approval_hash: "" })
    credentialApproverEvent.event_payload_hash = journalPayloadHash(credentialApproverEvent)
    const credentialDir = await mkdtemp(join(tmpdir(), "nxl-9w3b2a-approval-credential-approver-"))
    const credentialStore = new EventStore(join(credentialDir, ".nxl", "events.jsonl"))
    for (const event of events.filter((candidate) => candidate.kind !== "runtime_commander_investigation_recovery_approved")) {
      await credentialStore.append(event as Parameters<EventStore["append"]>[0])
    }
    await credentialStore.append(credentialApproverEvent as Parameters<EventStore["append"]>[0])
    const credentialJournal = new CommanderInvestigationJournalService({ eventStore: credentialStore })
    const credentialRecord = await credentialJournal.get("inv_recovery_approval_timestamp")
    expect(credentialRecord).toMatchObject({
      projection_status: "corrupt",
      recovery_approval_recorded: false,
      latest_recovery_approval_id: undefined,
    })

    const tokenAssignmentApproverEvent = {
      ...events.find((event) => event.kind === "runtime_commander_investigation_recovery_approved")!,
      requested_by: "access_token=replayCredentialPayload123",
      approval: {
        ...events.find((event) => event.kind === "runtime_commander_investigation_recovery_approved")!.approval,
        approved_by: "access_token=replayCredentialPayload123",
      },
      event_payload_hash: "",
    }
    tokenAssignmentApproverEvent.approval.approval_hash = stableHash({ ...tokenAssignmentApproverEvent.approval, approved_at: "", approval_hash: "" })
    tokenAssignmentApproverEvent.event_payload_hash = journalPayloadHash(tokenAssignmentApproverEvent)
    const tokenAssignmentDir = await mkdtemp(join(tmpdir(), "nxl-9w3b2a-approval-token-assignment-"))
    const tokenAssignmentStore = new EventStore(join(tokenAssignmentDir, ".nxl", "events.jsonl"))
    for (const event of events.filter((candidate) => candidate.kind !== "runtime_commander_investigation_recovery_approved")) {
      await tokenAssignmentStore.append(event as Parameters<EventStore["append"]>[0])
    }
    await tokenAssignmentStore.append(tokenAssignmentApproverEvent as Parameters<EventStore["append"]>[0])
    const tokenAssignmentJournal = new CommanderInvestigationJournalService({ eventStore: tokenAssignmentStore })
    const tokenAssignmentRecord = await tokenAssignmentJournal.get("inv_recovery_approval_timestamp")
    expect(tokenAssignmentRecord).toMatchObject({
      projection_status: "corrupt",
      recovery_approval_recorded: false,
      latest_recovery_approval_id: undefined,
    })

    const privateKeyApproverEvent = {
      ...events.find((event) => event.kind === "runtime_commander_investigation_recovery_approved")!,
      requested_by: "private_key=replayCredentialPayload123",
      approval: {
        ...events.find((event) => event.kind === "runtime_commander_investigation_recovery_approved")!.approval,
        approved_by: "private_key=replayCredentialPayload123",
      },
      event_payload_hash: "",
    }
    privateKeyApproverEvent.approval.approval_hash = stableHash({ ...privateKeyApproverEvent.approval, approved_at: "", approval_hash: "" })
    privateKeyApproverEvent.event_payload_hash = journalPayloadHash(privateKeyApproverEvent)
    const privateKeyDir = await mkdtemp(join(tmpdir(), "nxl-9w3b2a-approval-private-key-assignment-"))
    const privateKeyStore = new EventStore(join(privateKeyDir, ".nxl", "events.jsonl"))
    for (const event of events.filter((candidate) => candidate.kind !== "runtime_commander_investigation_recovery_approved")) {
      await privateKeyStore.append(event as Parameters<EventStore["append"]>[0])
    }
    await privateKeyStore.append(privateKeyApproverEvent as Parameters<EventStore["append"]>[0])
    const privateKeyJournal = new CommanderInvestigationJournalService({ eventStore: privateKeyStore })
    const privateKeyRecord = await privateKeyJournal.get("inv_recovery_approval_timestamp")
    expect(privateKeyRecord).toMatchObject({
      projection_status: "corrupt",
      recovery_approval_recorded: false,
      latest_recovery_approval_id: undefined,
    })
  })

  test("recovery approval blocks while the durable investigation is still active", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3b2a-approval-active-journal-"))
    const eventStore = new EventStore(join(projectDir, ".nxl", "events.jsonl"))
    const journal = new CommanderInvestigationJournalService({ eventStore })
    const input = baseInvestigation({
      investigation_id: "inv_recovery_approval_active",
      objective: "Block approval while provider request is active",
      provider_id: "fixture_provider",
      provider_kind: "openai",
      model_id: "fixture-model",
      tool_protocol: "native",
    })
    const run = await journal.createObserver(input)
    const snapshot = durableStartedSnapshot(input, 17, "inv_recovery_approval_active") as any
    snapshot.budget = { ...snapshot.budget, max_context_bytes: 8192, budget_hash: "" }
    snapshot.budget.budget_hash = stableHash({ ...snapshot.budget, budget_hash: "" })
    await run.observer.onStarted(snapshot as Parameters<typeof run.observer.onStarted>[0])
    const checkpoint = await journal.latestCheckpoint("inv_recovery_approval_active")
    expect(checkpoint).toBeDefined()
    const approval = {
      schema_version: 1,
      approval_version: 1,
      approval_id: "commander_recovery_approval_active",
      approval_sequence: 0,
      investigation_id: "inv_recovery_approval_active",
      recovery_kind: "checkpoint",
      decision: "approve_continue_after_uncertain_provider_outcome",
      approved_by: "human_operator",
      approval_source: "human",
      acknowledgements: {
        fresh_context_required: true,
        exact_replay_unavailable: true,
        provider_request_replay_forbidden: true,
        tool_execution_replay_forbidden: true,
        uncertain_provider_outcome: true,
      },
      recovery_basis_hash: "basis_active",
      recovery_plan_hash: "plan_active",
      recovery_packet_hash: "packet_active",
      preview_hash: "preview_active",
      checkpoint_ref: {
        checkpoint_id: checkpoint!.checkpoint_id,
        checkpoint_sequence: checkpoint!.checkpoint_sequence,
        checkpoint_hash: checkpoint!.checkpoint_hash,
      },
      provider_execution_envelope_hash: "provider_hash",
      tool_compatibility_hash: "tool_hash",
      provider_compatibility_hash: "provider_compat_hash",
      budget_compatibility_hash: "budget_hash",
      context_compatibility_hash: "context_hash",
      continuity_compatibility_hash: "continuity_hash",
      human_control_compatibility_hash: "human_hash",
      one_shot: true,
      automatic: false,
      fresh_context_required: true,
      exact_replay_supported: false,
      provider_request_replay_allowed: false,
      tool_execution_replay_allowed: false,
      execution_supported_in_this_branch: false,
      approved_at: "2026-01-01T00:00:10.000Z",
      approval_hash: "approval_hash",
    } as any
    await expect(journal.recordRecoveryApproval({ expected_basis: { basis_hash: "basis_active" } as any, approval })).rejects.toThrow("inactive durable investigation")
    journal.release(run)
    const source = await journal.recoverySource("inv_recovery_approval_active")
    expect(source?.recovery_basis).toBeDefined()
    const mismatchedApproval = {
      ...approval,
      recovery_kind: "uncertain_provider_outcome",
      decision: "approve_resume_from_checkpoint",
      acknowledgements: {
        fresh_context_required: true,
        exact_replay_unavailable: true,
        provider_request_replay_forbidden: true,
        tool_execution_replay_forbidden: true,
      },
      recovery_basis_hash: source!.recovery_basis!.basis_hash,
      recovery_plan_hash: source!.recovery_basis!.basis_hash,
      approval_hash: "",
    }
    mismatchedApproval.approval_hash = stableHash({ ...mismatchedApproval, approved_at: "", approval_hash: "" })
    await expect(journal.recordRecoveryApproval({ expected_basis: source!.recovery_basis!, approval: mismatchedApproval as any })).rejects.toThrow("replay schema")
    const directApproval = {
      ...approval,
      recovery_kind: "checkpoint",
      decision: "approve_resume_from_checkpoint",
      acknowledgements: {
        fresh_context_required: true,
        exact_replay_unavailable: true,
        provider_request_replay_forbidden: true,
        tool_execution_replay_forbidden: true,
      },
      recovery_basis_hash: source!.recovery_basis!.basis_hash,
      recovery_plan_hash: source!.recovery_basis!.basis_hash,
      approval_hash: "",
    }
    directApproval.approval_hash = stableHash({ ...directApproval, approved_at: "", approval_hash: "" })
    const extraPropertyApproval = { ...directApproval, unexpected_authority: "must block", approval_hash: "" }
    extraPropertyApproval.approval_hash = stableHash({ ...extraPropertyApproval, approved_at: "", approval_hash: "" })
    await expect(journal.recordRecoveryApproval({ expected_basis: source!.recovery_basis!, approval: extraPropertyApproval as any })).rejects.toThrow("replay schema")
    const malformedCheckpointApproval = {
      ...directApproval,
      checkpoint_ref: {
        ...directApproval.checkpoint_ref,
        unexpected_checkpoint_field: "must block",
      },
      approval_hash: "",
    }
    malformedCheckpointApproval.approval_hash = stableHash({ ...malformedCheckpointApproval, approved_at: "", approval_hash: "" })
    await expect(journal.recordRecoveryApproval({ expected_basis: source!.recovery_basis!, approval: malformedCheckpointApproval as any })).rejects.toThrow("replay schema")
    const events = (await readFile(eventStore.eventsPath, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { kind: string })
    expect(events.filter((event) => event.kind === "runtime_commander_investigation_recovery_approved")).toHaveLength(0)
    const record = await journal.get("inv_recovery_approval_active")
    expect(record?.projection_status).toBe("ready")
  })

  test("recovery approval serializes concurrent writes for the same investigation", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3b2a-approval-concurrent-"))
    await writeApprovedSpec(projectDir)
    const server = configuredProviderRuntimeServer(projectDir)
    servers.push({ stop: () => server.shutdown() })
    const journal = new CommanderInvestigationJournalService({ eventStore: server.eventStore })
    const input = baseInvestigation({
      investigation_id: "inv_recovery_approval_concurrent",
      objective: "Serialize concurrent recovery approvals",
      provider_id: "fixture_provider",
      provider_kind: "openai",
      model_id: "fixture-model",
      tool_protocol: "native",
    })
    const run = await journal.createObserver(input)
    const snapshot = durableStartedSnapshot(input, 16, "inv_recovery_approval_concurrent") as any
    snapshot.budget = { ...snapshot.budget, max_context_bytes: 8192, budget_hash: "" }
    snapshot.budget.budget_hash = stableHash({ ...snapshot.budget, budget_hash: "" })
    await run.observer.onStarted(snapshot as Parameters<typeof run.observer.onStarted>[0])
    journal.release(run)
    await server.start()
    const preview = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_approval_concurrent" })
    expect(preview).toMatchObject({ status: "ready_for_approval", recovery_kind: "checkpoint" })
    const baseApproval = {
      investigation_id: "inv_recovery_approval_concurrent",
      recovery_plan_hash: preview.recovery_plan_hash!,
      decision: "approve_resume_from_checkpoint" as const,
      approved_by: "human_operator",
      acknowledgements: {
        fresh_context_required: true as const,
        exact_replay_unavailable: true as const,
        provider_request_replay_forbidden: true as const,
        tool_execution_replay_forbidden: true as const,
      },
    }
    const [first, second] = await Promise.all([
      server.recordCommanderInvestigationRecoveryApproval({ ...baseApproval, human_note: "first approval note" }),
      server.recordCommanderInvestigationRecoveryApproval({ ...baseApproval, human_note: "second approval note" }),
    ])
    const results = [first, second]
    expect(results.filter((result) => result.status === "recorded")).toHaveLength(2)
    expect(results.filter((result) => result.events_appended)).toHaveLength(2)
    expect(new Set(results.map((result) => result.approval?.approval_id)).size).toBe(2)
    const record = await server.getCommanderInvestigationRecord("inv_recovery_approval_concurrent")
    expect(record).toMatchObject({
      projection_status: "ready",
      recovery_approval_count: 2,
      recovery_approval_recorded: true,
      recovery_approval_consumed: false,
    })
    const events = (await readFile(server.eventStore.eventsPath, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { kind: string; journal_sequence?: number; approval?: { approval_sequence?: number } })
    const approvals = events.filter((event) => event.kind === "runtime_commander_investigation_recovery_approved")
    expect(approvals).toHaveLength(2)
    expect(approvals[0]?.journal_sequence).toBe(1)
    expect(approvals[0]?.approval?.approval_sequence).toBe(0)
    expect(approvals[1]?.journal_sequence).toBe(2)
    expect(approvals[1]?.approval?.approval_sequence).toBe(1)
    await server.shutdown("concurrent approval test")
  })

  test("recovery approval records uncertain-provider continuation without resolving the pending outcome", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3b2a-approval-uncertain-"))
    await writeApprovedSpec(projectDir)
    const server = configuredProviderRuntimeServer(projectDir)
    servers.push({ stop: () => server.shutdown() })
    const journal = new CommanderInvestigationJournalService({ eventStore: server.eventStore })
    const input = baseInvestigation({
      investigation_id: "inv_recovery_approval_uncertain",
      objective: "Approve uncertain provider continuation",
      provider_id: "fixture_provider",
      provider_kind: "openai",
      model_id: "fixture-model",
      tool_protocol: "native",
    })
    const run = await journal.createObserver(input)
    const snapshot = durableStartedSnapshot(input, 15, "inv_recovery_approval_uncertain") as any
    snapshot.budget = { ...snapshot.budget, max_context_bytes: 8192, budget_hash: "" }
    snapshot.budget.budget_hash = stableHash({ ...snapshot.budget, budget_hash: "" })
    await run.observer.onStarted(snapshot as Parameters<typeof run.observer.onStarted>[0])
    journal.release(run)
    const checkpoint = await journal.latestCheckpoint("inv_recovery_approval_uncertain")
    expect(checkpoint).toBeDefined()
    const pendingEvent = {
      kind: "runtime_commander_investigation_model_step_started",
      schema_version: 1,
      investigation_id: "inv_recovery_approval_uncertain",
      journal_sequence: 1,
      turn_index: 1,
      model_request_id: "model_request_uncertain_approval",
      provider_id: input.provider_id,
      provider_kind: input.provider_kind,
      model_id: input.model_id,
      tool_protocol: "native",
      base_checkpoint_id: checkpoint!.checkpoint_id,
      base_checkpoint_sequence: checkpoint!.checkpoint_sequence,
      base_checkpoint_hash: checkpoint!.checkpoint_hash,
      working_set_hash: checkpoint!.working_set.working_set_hash,
      context_hash: "context_hash_uncertain_approval",
      input_bytes: 128,
      estimated_input_tokens: 32,
      loaded_tool_refs: checkpoint!.loaded_tools,
      provider_request_count_before: 0,
      external_api_audit_count_before: 0,
      started_at: "2026-01-01T00:00:45.000Z",
      requested_by: input.requested_by,
      occurred_at: "2026-01-01T00:00:45.000Z",
      event_payload_hash: "",
    }
    pendingEvent.event_payload_hash = journalPayloadHash(pendingEvent)
    await server.eventStore.append(pendingEvent as Parameters<EventStore["append"]>[0])

    await server.start()
    const before = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_approval_uncertain" })
	    expect(before).toMatchObject({
	      status: "human_review_required",
	      recovery_kind: "uncertain_provider_outcome",
	      recommended_action: "review_uncertain_provider_outcome",
	      pending_model_step: { model_request_id: "model_request_uncertain_approval", outcome: "uncertain" },
	      execution_preparation: {
	        uncertain_model_turn_charge: 1,
	        unresolved_provider_attempt_count: 1,
	        next_turn_index: 2,
	      },
	      recovery_packet: {
	        uncertain_model_turn_charge: 1,
	        unresolved_provider_attempt_count: 1,
	      },
	    })
	    expect(before.execution_preparation_hash).toBeTruthy()
	    expect(before.execution_preparation?.first_model_request_preview_hash).toBe(before.recovery_packet?.first_model_request_preview_hash)
    const approvalInput = {
      investigation_id: "inv_recovery_approval_uncertain",
      recovery_plan_hash: before.recovery_plan_hash!,
      decision: "approve_continue_after_uncertain_provider_outcome" as const,
      approved_by: "human_operator",
      acknowledgements: {
        fresh_context_required: true as const,
        exact_replay_unavailable: true as const,
        provider_request_replay_forbidden: true as const,
        tool_execution_replay_forbidden: true as const,
        uncertain_provider_outcome: true as const,
      },
    }
    const recorded = await server.recordCommanderInvestigationRecoveryApproval(approvalInput)
    expect(recorded).toMatchObject({
      status: "recorded",
      events_appended: true,
      pending_model_step_ref: {
        model_request_id: "model_request_uncertain_approval",
        provider_request_may_have_been_sent: true,
        provider_response_available: false,
        provider_outcome_remains_unknown: true,
        tool_execution_known_to_have_occurred: false,
        provider_request_replay_forbidden: true,
        tool_execution_replay_forbidden: true,
      },
      provider_called: false,
      tool_executed: false,
      network_called: false,
    })
    const after = await server.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_approval_uncertain" })
    expect(after).toMatchObject({
      status: "approved_waiting_for_execution",
      recommended_action: "await_recovery_execution",
      approval_state: "current",
      recovery_kind: "uncertain_provider_outcome",
      pending_model_step: { model_request_id: "model_request_uncertain_approval" },
      automatic_resume_allowed: false,
    })
	    expect(after.recovery_basis_hash).toBe(before.recovery_basis_hash)
	    expect(after.recovery_plan_hash).toBe(before.recovery_plan_hash)
	    expect(after.execution_preparation_hash).toBe(before.execution_preparation_hash)
	    const uncertainPreparation = await server.previewCommanderInvestigationRecoveryExecutionPreparation({
	      investigation_id: "inv_recovery_approval_uncertain",
	      approval_id: after.current_approval!.approval_id,
	      approval_hash: after.current_approval!.approval_hash,
	      recovery_plan_hash: after.recovery_plan_hash!,
	    })
	    expect(uncertainPreparation).toMatchObject({
	      status: "ready",
	      recovery_kind: "uncertain_provider_outcome",
	      approval_current: true,
	      approval_consumed: false,
	      pending_model_step_ref: {
	        model_request_id: "model_request_uncertain_approval",
	        provider_request_may_have_been_sent: true,
	        provider_response_available: false,
	        provider_outcome_remains_unknown: true,
	        tool_execution_known_to_have_occurred: false,
	      },
	      continuation_summary: {
	        uncertain_model_turn_charge: 1,
	        unresolved_provider_attempt_count: 1,
	        next_turn_index: 2,
	      },
	      provider_called: false,
	      tool_executed: false,
	      network_called: false,
	      events_appended: false,
	    })
	    expect(uncertainPreparation.first_model_request?.old_pending_request_id).toBe("model_request_uncertain_approval")
	    expect(uncertainPreparation.first_model_request?.request_id).not.toBe("model_request_uncertain_approval")
	    expect(uncertainPreparation.first_model_request?.old_request_replayed).toBe(false)
	    expect(uncertainPreparation.first_model_request?.tool_execution_replayed).toBe(false)
	    const record = await server.getCommanderInvestigationRecord("inv_recovery_approval_uncertain")
    expect(record).toMatchObject({
      status: "running",
      pending_model_request_id: "model_request_uncertain_approval",
      uncertain_provider_outcome: true,
      resume_supported: false,
      recovery_approval_recorded: true,
      recovery_approval_consumed: false,
    })
    const events = (await readFile(server.eventStore.eventsPath, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, any>)
    const approvalEvent = events.find((event) => event.kind === "runtime_commander_investigation_recovery_approved")
    expect(approvalEvent).toBeDefined()
    const stalePacketApprovalEvent = {
      ...approvalEvent!,
      approval: {
        ...approvalEvent!.approval,
        recovery_packet_hash: stableHash({ stale_packet_fixture: true }),
        approval_id: `commander_recovery_approval_${stableHash({ investigation_id: "inv_recovery_approval_uncertain", plan: before.recovery_plan_hash, decision: approvalInput.decision, approved_by: "human_operator", note: undefined }).slice(0, 20)}`,
        approval_hash: "",
      },
      event_payload_hash: "",
    }
    stalePacketApprovalEvent.approval.approval_hash = stableHash({ ...stalePacketApprovalEvent.approval, approved_at: "", approval_hash: "" })
    stalePacketApprovalEvent.event_payload_hash = journalPayloadHash(stalePacketApprovalEvent)
    const stalePacketDir = await mkdtemp(join(tmpdir(), "nxl-9w3b2a-stale-packet-approval-"))
    const stalePacketStore = new EventStore(join(stalePacketDir, ".nxl", "events.jsonl"))
    for (const event of events.filter((candidate) => candidate.kind !== "runtime_commander_investigation_recovery_approved")) {
      await stalePacketStore.append(event as Parameters<EventStore["append"]>[0])
    }
    await stalePacketStore.append(stalePacketApprovalEvent as Parameters<EventStore["append"]>[0])
    await writeApprovedSpec(stalePacketDir)
    const stalePacketServer = configuredProviderRuntimeServer(stalePacketDir)
    servers.push({ stop: () => stalePacketServer.shutdown() })
    await stalePacketServer.start()
    const stalePacketPreview = await stalePacketServer.previewCommanderInvestigationRecovery({ investigation_id: "inv_recovery_approval_uncertain" })
    expect(stalePacketPreview).toMatchObject({
      status: "human_review_required",
      recommended_action: "review_uncertain_provider_outcome",
      approval_state: "stale",
      current_approval: undefined,
      stale_approval_count: 1,
    })
    const replacementPacketApproval = await stalePacketServer.recordCommanderInvestigationRecoveryApproval(approvalInput)
    expect(replacementPacketApproval).toMatchObject({
      status: "recorded",
      approval_state: "current",
      events_appended: true,
    })
    const replacementPacketEvents = (await readFile(stalePacketServer.eventStore.eventsPath, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, any>)
    const replacementPacketApprovalEvents = replacementPacketEvents.filter((event) => event.kind === "runtime_commander_investigation_recovery_approved")
    expect(replacementPacketApprovalEvents).toHaveLength(2)
    expect(new Set(replacementPacketApprovalEvents.map((event) => event.approval.approval_id)).size).toBe(2)
    const replacementPacketRecord = await stalePacketServer.getCommanderInvestigationRecord("inv_recovery_approval_uncertain")
    expect(replacementPacketRecord).toMatchObject({
      projection_status: "ready",
      recovery_approval_recorded: true,
      latest_recovery_approval_id: replacementPacketApproval.approval?.approval_id,
    })
    const malformedApprovalEvent = {
      ...approvalEvent!,
      approval: {
        ...approvalEvent!.approval,
        acknowledgements: {
          fresh_context_required: true,
          exact_replay_unavailable: true,
          provider_request_replay_forbidden: true,
          tool_execution_replay_forbidden: true,
        },
        approval_hash: "",
      },
      event_payload_hash: "",
    }
    malformedApprovalEvent.approval.approval_hash = stableHash({ ...malformedApprovalEvent.approval, approved_at: "", approval_hash: "" })
    malformedApprovalEvent.event_payload_hash = journalPayloadHash(malformedApprovalEvent)
    const malformedDir = await mkdtemp(join(tmpdir(), "nxl-9w3b2a-malformed-approval-"))
    const malformedStore = new EventStore(join(malformedDir, ".nxl", "events.jsonl"))
    for (const event of events.filter((candidate) => candidate.kind !== "runtime_commander_investigation_recovery_approved")) {
      await malformedStore.append(event as Parameters<EventStore["append"]>[0])
    }
    await malformedStore.append(malformedApprovalEvent as Parameters<EventStore["append"]>[0])
    const malformedJournal = new CommanderInvestigationJournalService({ eventStore: malformedStore })
    const malformedRecord = await malformedJournal.get("inv_recovery_approval_uncertain")
    expect(malformedRecord).toMatchObject({
      projection_status: "corrupt",
      recovery_approval_recorded: false,
      latest_recovery_approval_id: undefined,
    })
    const extraFieldApprovalEvent = {
      ...approvalEvent!,
      approval: {
        ...approvalEvent!.approval,
        raw_provider_response: "raw provider response sentinel must not be accepted",
        approval_hash: "",
      },
      event_payload_hash: "",
    }
    extraFieldApprovalEvent.approval.approval_hash = stableHash({ ...extraFieldApprovalEvent.approval, approved_at: "", approval_hash: "" })
    extraFieldApprovalEvent.event_payload_hash = journalPayloadHash(extraFieldApprovalEvent)
    const extraFieldDir = await mkdtemp(join(tmpdir(), "nxl-9w3b2a-extra-approval-field-"))
    const extraFieldStore = new EventStore(join(extraFieldDir, ".nxl", "events.jsonl"))
    for (const event of events.filter((candidate) => candidate.kind !== "runtime_commander_investigation_recovery_approved")) {
      await extraFieldStore.append(event as Parameters<EventStore["append"]>[0])
    }
    await extraFieldStore.append(extraFieldApprovalEvent as Parameters<EventStore["append"]>[0])
    const extraFieldJournal = new CommanderInvestigationJournalService({ eventStore: extraFieldStore })
    const extraFieldRecord = await extraFieldJournal.get("inv_recovery_approval_uncertain")
    expect(extraFieldRecord).toMatchObject({
      projection_status: "corrupt",
      recovery_approval_recorded: false,
      latest_recovery_approval_id: undefined,
    })
    const mismatchedEnvelopeEvent = {
      ...approvalEvent!,
      requested_by: "different_human_operator",
      unexpected_outer_payload: "raw provider response sentinel must not be accepted",
      event_payload_hash: "",
    }
    mismatchedEnvelopeEvent.event_payload_hash = journalPayloadHash(mismatchedEnvelopeEvent)
    const mismatchedEnvelopeDir = await mkdtemp(join(tmpdir(), "nxl-9w3b2a-mismatched-approval-envelope-"))
    const mismatchedEnvelopeStore = new EventStore(join(mismatchedEnvelopeDir, ".nxl", "events.jsonl"))
    for (const event of events.filter((candidate) => candidate.kind !== "runtime_commander_investigation_recovery_approved")) {
      await mismatchedEnvelopeStore.append(event as Parameters<EventStore["append"]>[0])
    }
    await mismatchedEnvelopeStore.append(mismatchedEnvelopeEvent as Parameters<EventStore["append"]>[0])
    const mismatchedEnvelopeJournal = new CommanderInvestigationJournalService({ eventStore: mismatchedEnvelopeStore })
    const mismatchedEnvelopeRecord = await mismatchedEnvelopeJournal.get("inv_recovery_approval_uncertain")
    expect(mismatchedEnvelopeRecord).toMatchObject({
      projection_status: "corrupt",
      recovery_approval_recorded: false,
      latest_recovery_approval_id: undefined,
    })
  })

  test("durable Commander investigations are searchable through typed operational memory projection", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "nxl-9w3a-operational-memory-"))
    await writeApprovedSpec(projectDir)
    const server = new RuntimeServer({
      projectDir,
      adapter: new FakeOpenCodeAdapter(),
      commanderModelStepAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "modelonlyxyz durable conclusion text" }]),
    })
    servers.push({ stop: () => server.shutdown() })
    await server.start()
    await server.runCommanderInvestigationDurable(baseInvestigation({ investigation_id: "inv_searchable", objective: "Find prior durable investigation needle", session_id: "session_search", mission_id: "mission_search" }))
    const search = await server.searchCommanderOperationalMemory({ query: "durable investigation needle", source_kinds: ["commander_investigation"], session_id: "session_search" })
    expect(search).toMatchObject({ status: "ready", events_appended: false })
    expect(search.result?.candidates).toEqual([expect.objectContaining({ source_kind: "commander_investigation", source_id: "inv_searchable", pointer_only: true, session_id: "session_search" })])
    const finalSearch = await server.searchCommanderOperationalMemory({ query: "modelonlyxyz", source_kinds: ["commander_investigation"], session_id: "session_search" })
    expect(finalSearch.result?.candidates).toEqual([])

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
    const evidenceRecord = await service.get("inv_searchable_evidence")
    expect(evidenceRecord?.final_summary_preview).toBeUndefined()

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

    for (let index = 1; index <= 101; index += 1) {
      const investigationId = `inv_bulk_${String(index).padStart(3, "0")}`
      const input = baseInvestigation({
        investigation_id: investigationId,
        objective: index === 1 ? "oldest durable archive needle" : `recent durable archive filler ${index}`,
        session_id: "session_bulk_search",
      })
      const run = await service.createObserver(input)
      await run.observer.onStarted(durableStartedSnapshot(input, index + 20, investigationId) as Parameters<typeof run.observer.onStarted>[0])
      await service.finish(run, {
        ...baseResult,
        investigation_id: investigationId,
        completed_at: new Date(Date.UTC(2026, 0, 1, 3, 0, index)).toISOString(),
        final_summary: index === 1 ? "oldest durable archive final" : `recent durable archive final ${index}`,
        evidence: [],
      })
      service.release(run)
    }
    const projectedBulk = await service.listForOperationalMemorySearch({ limit: 800, session_id: "session_bulk_search" })
    expect(projectedBulk).toHaveLength(101)
    expect(projectedBulk.map((record) => record.investigation_id)).toContain("inv_bulk_001")
    const oldestSearch = await server.searchCommanderOperationalMemory({ query: "inv_bulk_001", source_kinds: ["commander_investigation"], session_id: "session_bulk_search" })
    expect(oldestSearch.result?.candidates).toContainEqual(expect.objectContaining({ source_kind: "commander_investigation", source_id: "inv_bulk_001", pointer_only: true }))

    await writeFile((server as unknown as { eventStore: EventStore }).eventStore.eventsPath, '{\"kind\":\"runtime_commander_investigation_started\",\"schema_version\":1,\"investigation_id\":\"inv_torn_search_line\",\"journal_sequence\":0', { flag: "a" })
    const afterTornSearch = await server.searchCommanderOperationalMemory({ query: "durable investigation needle", source_kinds: ["commander_investigation"], session_id: "session_search" })
    expect(afterTornSearch.result?.candidates).toContainEqual(expect.objectContaining({ source_kind: "commander_investigation", source_id: "inv_searchable", pointer_only: true }))
  })

  test("operational memory search finds Commander investigations under scan cap pressure", async () => {
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

  test("operational memory search preserves non-Commander records under Commander scan cap pressure", async () => {
    const commanderFiller = Array.from({ length: 100 }, (_, index) => ({
      source_kind: "commander_investigation",
      source_id: `inv_filler_${String(index).padStart(3, "0")}`,
      label: `Commander filler ${index}`,
      status: "final",
      summary_preview: "durable investigation unrelated filler",
      occurred_at: `2026-01-01T00:02:${String(index % 60).padStart(2, "0")}.000Z`,
      fields: { phase: "proposal_investigation" },
    }))
    const wakeFiller = Array.from({ length: 800 }, (_, index) => ({
      source_kind: "wake_supervision",
      source_id: `wake_filler_${String(index).padStart(3, "0")}`,
      label: `Wake filler ${index}`,
      status: "ready",
      summary_preview: index === 699 ? "rare guidance needle from wake supervision" : "wake scheduler unrelated filler",
      occurred_at: "2026-01-01T00:00:00.000Z",
      fields: { phase: "mid_mission_supervision" },
    }))
    const service = new CommanderOperationalMemorySearchService({
      collectRecords: async () => [...commanderFiller, ...wakeFiller],
    })
    const search = await service.search({ query: "rare guidance needle" })
    expect(search).toMatchObject({ status: "ready", scanned_items: 800 })
    expect(search.result?.candidates).toEqual([expect.objectContaining({ source_kind: "wake_supervision", source_id: "wake_filler_699" })])
    expect(search.warnings).toContain("operational memory scan capped at 800 filtered typed records")
  })

  test("operational memory search balances explicit multi-source filters before scoring", async () => {
    const commanderFiller = Array.from({ length: 800 }, (_, index) => ({
      source_kind: "commander_investigation",
      source_id: `inv_filtered_filler_${String(index).padStart(3, "0")}`,
      label: `Filtered Commander filler ${index}`,
      status: "final",
      summary_preview: "durable investigation unrelated filtered filler",
      occurred_at: `2026-01-01T00:02:${String(index % 60).padStart(2, "0")}.000Z`,
      fields: { phase: "proposal_investigation" },
    }))
    const wakeFiller = Array.from({ length: 800 }, (_, index) => ({
      source_kind: "wake_supervision",
      source_id: `wake_filtered_filler_${String(index).padStart(3, "0")}`,
      label: `Filtered Wake filler ${index}`,
      status: "ready",
      summary_preview: index === 399 ? "explicit multi source filter needle" : "wake scheduler unrelated filtered filler",
      occurred_at: "2026-01-01T00:00:00.000Z",
      fields: { phase: "mid_mission_supervision" },
    }))
    const service = new CommanderOperationalMemorySearchService({
      collectRecords: async () => [...commanderFiller, ...wakeFiller],
    })
    const search = await service.search({ query: "explicit multi source filter needle", source_kinds: ["commander_investigation", "wake_supervision"] })
    expect(search).toMatchObject({ status: "ready", scanned_items: 800 })
    expect(search.result?.candidates[0]).toMatchObject({ source_kind: "wake_supervision", source_id: "wake_filtered_filler_399" })
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
    const journal = (server as unknown as { commanderInvestigationJournalService: () => CommanderInvestigationJournalService }).commanderInvestigationJournalService()
    const originalGet = journal.get.bind(journal)
    let releaseLookup!: () => void
    let lookupEntered!: () => void
    const lookupStarted = new Promise<void>((resolve) => {
      lookupEntered = resolve
    })
    const lookupGate = new Promise<void>((resolve) => {
      releaseLookup = resolve
    })
    let blockedLookup = true
    journal.get = async (investigationId: string) => {
      if (blockedLookup) {
        blockedLookup = false
        lookupEntered()
        await lookupGate
      }
      return originalGet(investigationId)
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

function configuredProviderRuntimeServer(projectDir: string, options: { adapter?: FakeOpenCodeAdapter; transport?: ExternalApiTransport; externalApiEnv?: Record<string, string | undefined>; externalApiConnectorRegistry?: ExternalApiConnectorRegistry } = {}) {
  return new RuntimeServer({
    projectDir,
    adapter: options.adapter ?? new FakeOpenCodeAdapter(),
    commanderInvestigationProviderConfig: validateCommanderInvestigationProviderConfig(providerConfig()),
    externalApiConnectorRegistry: options.externalApiConnectorRegistry,
    externalApiConnectors: options.externalApiConnectorRegistry ? undefined : [connector("openai-test", "https://api.example.test/v1")],
    externalApiTransport: options.transport ?? new FakeExternalApiTransport([{ status_code: 200, body: chatCompletionText("configured final") }]),
    externalApiEnv: options.externalApiEnv ?? { NXL_TEST_MODEL_KEY: "real-provider-key" },
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
    continuity_assessment_status: "ready" as const,
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

function controllerWithBootstrapHash(bootstrapHash: string) {
  return new CommanderInvestigationController({
    modelAdapter: new ScriptedCommanderModelStepAdapter([{ status: "final", text: "same final" }]),
    toolExecutor: { execute: async () => { throw new Error("tool executor should not run") } },
    toolService: new CommanderToolService({ contextBudgetService: new ContextBudgetService({ registry: new ModelCapabilityRegistry() }) }),
    descriptors: COMMANDER_TOOL_REGISTRY,
    boundToolIds: COMMANDER_BOUND_TOOL_IDS,
    bootstrapService: { compile: async () => ({ ...minimalTestBootstrap(), bootstrap_hash: bootstrapHash }) },
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
  const budget = {
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
    budget_hash: "",
  }
  budget.budget_hash = stableHash({ ...budget, budget_hash: "" })
  const workingSet: CommanderInvestigationWorkingSet = {
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
    working_set_hash: "",
  }
  workingSet.working_set_hash = stableHash(stableCommanderInvestigationWorkingSet(workingSet))
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
    budget,
    tool_protocol: "native",
    loaded_tools: [],
	    working_set: workingSet,
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

function finalizeTestCheckpoint(checkpoint: CommanderInvestigationCheckpoint): CommanderInvestigationCheckpoint {
  const current = { ...checkpoint, checkpoint_id: "", semantic_state_hash: "", checkpoint_hash: "" }
  current.semantic_state_hash = stableHash({
    ...current,
    checkpoint_id: "",
    checkpoint_hash: "",
    semantic_state_hash: "",
    created_at: "",
    elapsed_active_ms: 0,
    provider_audit: undefined,
    working_set: {
      ...current.working_set,
      provider_audit: { ...current.working_set.provider_audit, audit_request_ids: [] },
      evidence_cards: current.working_set.evidence_cards.map((item) => ({ ...item, observed_at: "" })),
    },
    turn_summaries: current.turn_summaries.map((item) => ({ ...item, provider_audit_request_ids: [], turn_hash: "" })),
  })
  current.checkpoint_id = `commander_inv_checkpoint_${current.checkpoint_sequence}_${current.semantic_state_hash.slice(0, 16)}`
  current.checkpoint_hash = stableHash({ ...current, checkpoint_hash: "" })
  return current
}

function summaryOnlyReplayExchangeFixture(turnIndex: number): CommanderInvestigationReplayExchange {
  const exchange: CommanderInvestigationReplayExchange = {
    turn_index: turnIndex,
    assistant_message: {
      role: "assistant",
      content: [{
        type: "text_fingerprint",
        text_persisted: false,
        text_hash: stableHash(`summary-only-replay-${turnIndex}`),
        text_chars: 0,
      }],
    },
    tool_result_messages: [],
    exchange_hash: "",
    summary_only: true,
    assistant_text_persisted: false,
    exact_replay_supported: false,
    protocol_relationship_preserved: true,
    full_tool_results_persisted: false,
  }
  return { ...exchange, exchange_hash: stableHash({ ...exchange, exchange_hash: "" }) }
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
