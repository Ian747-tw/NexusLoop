import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { $ } from "bun"
import { NoSuchToolError } from "ai"
import { RuntimeServer } from "../server"
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
  CommanderToolExecutor,
  buildProviderToolMap,
  commanderToolSchemaFromDescriptor,
  createCommanderToolBindingRegistry,
  parseJsonFallback,
  providerJsonSchema,
  providerToolNameFor,
  toCommanderToolResultMessage,
  validateCommanderToolArguments,
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

  test("native adapter preserves multiple tool calls order ids and canonical underscore IDs", async () => {
    const mock = startMockServer("multi_tool")
    const request = baseRequest({ baseUrl: mock.url, content: "multi tool" })
    const result = await request.adapter.executeOneStep(request.request)
    expect(result.status).toBe("tool_call")
    expect(result.assistant_message?.content.filter((part) => part.type === "tool_call").map((part) => part.tool_call_id)).toEqual(["call_memory", "call_git"])
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
    const { executor } = executorFixture({ timeout: (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}`)), 1)) as Promise<never> })
    await expect(executor.execute(baseExecution({ tool_id: "memory.search", abort_signal: aborted.signal }))).resolves.toMatchObject({ status: "blocked", handler_invoked: false })
    await expect(executor.execute(baseExecution({ tool_id: "continuity.search" }))).resolves.toMatchObject({ status: "cancelled", handler_invoked: true })
    const failure = executorFixture({ failTool: "memory.search" }).executor
    await expect(failure.execute(baseExecution({ tool_id: "memory.search", arguments: { query: "x" } }))).resolves.toMatchObject({ status: "failed", handler_invoked: true })
    const oversized = executorFixture({ oversizedTool: "memory.search" }).executor
    await expect(oversized.execute(baseExecution({ tool_id: "memory.search", arguments: { query: "x" } }))).resolves.toMatchObject({ status: "failed", result: undefined })
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

function modelTool(toolId: string) {
  const descriptor = COMMANDER_TOOL_REGISTRY.find((tool) => tool.tool_id === toolId)
  if (!descriptor) throw new Error(`missing descriptor ${toolId}`)
  return commanderToolSchemaFromDescriptor(descriptor)
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

function startMockServer(kind: "text" | "tool" | "multi_tool" | "malformed_tool" | "json_fallback" | "json_fallback_final" | "stream_tool" | "stream_json_fallback_tool" | "stream_refusal" | "http_429" | "slow" | "structured_invalid" | "refusal" | "no_usage") {
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

function chatBody(kind: string) {
  const base = { id: `chatcmpl_${kind}`, object: "chat.completion", created: 1784160000, model: "fixture-model", usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } }
  if (kind === "tool" || kind === "multi_tool" || kind === "malformed_tool") {
    const tool_calls = [{ id: "call_memory", type: "function", function: { name: "memory__search", arguments: kind === "malformed_tool" ? JSON.stringify({ query: 7 }) : JSON.stringify({ query: "research memory", limit: 3 }) } }]
    if (kind === "multi_tool") tool_calls.push({ id: "call_git", type: "function", function: { name: "repo__git_status", arguments: "{}" } })
    return { ...base, choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls } }] }
  }
  if (kind === "json_fallback") return { ...base, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ type: "tool_call", tool_id: "memory.search", arguments: { query: "research memory", limit: 3 } }) } }] }
  if (kind === "json_fallback_final") return { ...base, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ type: "final", final: { summary: "done" } }) } }] }
  if (kind === "structured_invalid") return { ...base, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "{}" } }] }
  if (kind === "refusal") return { ...base, choices: [{ index: 0, finish_reason: "content_filter", message: { role: "assistant", content: "" } }] }
  if (kind === "no_usage") return { id: "chatcmpl_no_usage", object: "chat.completion", created: 1784160000, model: "fixture-model", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "plain fixture" } }] }
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

function testBindingRegistry(options: { failTool?: string; oversizedTool?: string; blockedTool?: string; emptyTool?: string; boundedLargeTool?: string; staleLowOutputBytesTool?: string; calls?: string[] } = {}) {
  const calls = options.calls ?? []
  return createPatchedRegistry(options, calls)
}

function createPatchedRegistry(options: { failTool?: string; oversizedTool?: string; blockedTool?: string; emptyTool?: string; boundedLargeTool?: string; staleLowOutputBytesTool?: string }, calls: string[]) {
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
        return { tool_id: "repo.read_lines", result: { lines: [{ line_number: 1, text: "x" }] }, git_process_invoked: false, evidence: [] }
      },
      gitStatus: async () => ({ tool_id: "repo.git_status", result: { is_git_repository: true }, git_process_invoked: true, evidence: [] }),
      gitDiff: async () => ({ tool_id: "repo.git_diff", result: { files: [] }, git_process_invoked: true, evidence: [] }),
    } as unknown as CommanderRepoReadService,
  }, COMMANDER_TOOL_REGISTRY)
  return registry
}

function executorFixture(options: { failTool?: string; oversizedTool?: string; blockedTool?: string; emptyTool?: string; boundedLargeTool?: string; staleLowOutputBytesTool?: string; timeout?: (ms: number, signal?: AbortSignal) => Promise<never> | { promise: Promise<never>; cancel: () => void } } = {}) {
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

async function eventText(projectDir: string): Promise<string> {
  try {
    return await readFile(join(projectDir, ".nxl", "events.jsonl"), "utf8")
  } catch {
    return ""
  }
}
