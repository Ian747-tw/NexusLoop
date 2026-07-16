import { describe, expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { createMinimalCustomAdapter } from "../src/candidates/minimal-custom-adapter"
import { createOpenAIAgentsCoreAdapter, runControlledAgentsModelProbe, runnerOwnershipProbe } from "../src/candidates/openai-agents-core-adapter"
import { createVercelAiSdkCoreAdapter } from "../src/candidates/vercel-ai-sdk-core-adapter"
import { baseRequest, finalizeResult, hashStable, selectedCommanderTools, toModelTool, toolForSdkName, toolNameFor, validateArguments, type CommanderModelStepAdapter } from "../src/contracts"
import { fixtureCase } from "../src/fixture-model"
import { startMockOpenAICompatibleServer } from "../src/mock-openai-compatible-server"
import { runBunImportProbe } from "../src/probes/bun-import-probe"
import { runCancellationProbe } from "../src/probes/cancellation-probe"
import { runJsonFallbackProbe } from "../src/probes/json-fallback-probe"
import { runNativeToolCallProbe } from "../src/probes/native-tool-call-probe"
import { ownershipReport } from "../src/probes/ownership-probe"
import { runSchemaCompatibilityProbe } from "../src/probes/schema-compatibility-probe"
import { runStreamingProbe } from "../src/probes/streaming-probe"
import { runTextStepProbe } from "../src/probes/text-step-probe"
import { runUsageProbe } from "../src/probes/usage-probe"
import { buildResults, runProbes, validateProbeResults } from "../src/sdk-fit-runner"

const adapters = [
  createMinimalCustomAdapter(),
  createVercelAiSdkCoreAdapter(),
  createOpenAIAgentsCoreAdapter(),
]

describe("isolated SDK spike", () => {
  test("candidate packages import under Bun and tracing is disabled by API", async () => {
    await expect(runBunImportProbe()).resolves.toEqual({ status: "pass" })
  })

  test("production packages do not depend on candidate SDKs", async () => {
    const runtimePkg = JSON.parse(await readFile(new URL("../../../runtime/package.json", import.meta.url), "utf8"))
    const tuiPkg = JSON.parse(await readFile(new URL("../../../tui/package.json", import.meta.url), "utf8"))
    for (const pkg of [runtimePkg, tuiPkg]) {
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
      expect(deps.ai).toBeUndefined()
      expect(deps["@ai-sdk/openai-compatible"]).toBeUndefined()
      expect(deps["@openai/agents"]).toBeUndefined()
    }
  })

  test("production files do not import the spike package", async () => {
    const root = new URL("../../../../", import.meta.url).pathname
    const files = await collectFiles(root, ["agentcore/runtime", "agentcore/tui"])
    for (const file of files) {
      const text = await readFile(file, "utf8")
      expect(text.includes("commander-agent-runtime-sdk-fit")).toBe(false)
    }
  })

  test("real 9U/9V tool schemas convert without mutating canonical descriptors", () => {
    const descriptors = selectedCommanderTools()
    const before = hashStable(descriptors)
    const result = runSchemaCompatibilityProbe(descriptors)
    expect(result.status).toBe("pass")
    expect(result.checked_tool_ids).toEqual([
      "commander.tool_search",
      "memory.search",
      "continuity.search",
      "repo.search_text",
      "repo.read_lines",
      "repo.git_status",
      "repo.git_diff",
    ])
    expect(hashStable(descriptors)).toBe(before)
  })

  test("required, enum, additionalProperties, max/min, maxLength, and optional fields remain intact", () => {
    const memory = toModelTool(selectedCommanderTools().find((tool) => tool.tool_id === "memory.search")!)
    expect(validateArguments(memory, { query: "memory", limit: 2 }).valid).toBe(true)
    expect(validateArguments(memory, { limit: 2 }).errors).toContain("missing required field query")
    expect(validateArguments(memory, { query: "memory", extra: true }).errors).toContain("unknown field extra")
    expect(validateArguments(memory, { query: "x".repeat(301) }).errors).toContain("query exceeds maxLength")
    expect(validateArguments(memory, { query: "memory", limit: 999 }).errors).toContain("limit above maximum")
    expect(validateArguments(memory, { query: "memory", limit: 0 }).errors).toContain("limit below minimum")
  })

  test("SDK tool names preserve canonical IDs that contain underscores", () => {
    const tools = selectedCommanderTools().map(toModelTool)
    expect(toolNameFor("repo.git_status")).toBe("repo__git_status")
    expect(toolForSdkName(tools, "repo__git_status")?.tool_id).toBe("repo.git_status")
    expect(toolForSdkName(tools, "repo__git_diff")?.tool_id).toBe("repo.git_diff")
    expect(toolForSdkName(tools, "repo__read_lines")?.tool_id).toBe("repo.read_lines")
    expect(toolForSdkName(tools, "repo__search_text")?.tool_id).toBe("repo.search_text")
  })

  test("AI SDK provider adapter preserves tool result messages for an explicit next step", async () => {
    const server = await startMockOpenAICompatibleServer(() => "text")
    try {
      const adapter = createVercelAiSdkCoreAdapter({ baseURL: server.url, apiKey: "fixture-key" })
      const result = await adapter.executeOneStep(baseRequest({
        messages: [
          { role: "user", content: "Use memory." },
          { role: "tool", tool_call_id: "call_memory", tool_name: "memory.search", content: "{\"matches\":[]}" },
        ],
      }))
      expect(result.provider_metadata.request_count).toBe(1)
      const body = server.requests[0].body as { messages?: Array<{ role: string; content: unknown }> }
      expect(JSON.stringify(body.messages)).toContain("tool")
      expect(JSON.stringify(body.messages)).toContain("call_memory")
      expect(JSON.stringify(body.messages)).toContain("matches")
    } finally {
      await server.close()
    }
  })

  test("AI SDK provider adapter preserves assistant tool calls before tool results", async () => {
    const server = await startMockOpenAICompatibleServer(() => "text")
    try {
      const adapter = createVercelAiSdkCoreAdapter({ baseURL: server.url, apiKey: "fixture-key" })
      const result = await adapter.executeOneStep(baseRequest({
        messages: [
          { role: "user", content: "Use memory." },
          { role: "assistant", tool_call_id: "call_memory", tool_name: "memory.search", content: "{\"query\":\"research memory\"}" },
          { role: "tool", tool_call_id: "call_memory", tool_name: "memory.search", content: "{\"matches\":[]}" },
        ],
      }))
      expect(result.provider_metadata.request_count).toBe(1)
      const body = server.requests[0].body as { messages?: Array<{ role: string }> }
      const serialized = JSON.stringify(body.messages)
      expect(serialized).toContain("assistant")
      expect(serialized).toContain("tool_calls")
      expect(serialized).toContain("call_memory")
      expect(serialized).toContain("memory__search")
      expect(serialized.indexOf("\"role\":\"assistant\"")).toBeLessThan(serialized.indexOf("\"role\":\"tool\""))
    } finally {
      await server.close()
    }
  })

  test("AI SDK provider adapter sends structured output schema and preserves provider result hash", async () => {
    const server = await startMockOpenAICompatibleServer(() => "structured")
    try {
      const adapter = createVercelAiSdkCoreAdapter({ baseURL: server.url, apiKey: "fixture-key" })
      const request = baseRequest({
        messages: [{ role: "user", content: "structured" }],
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
      })
      const result = await adapter.executeOneStep(request)
      expect(result.status).toBe("final")
      expect(result.text).toContain("structured fixture")
      const body = JSON.stringify(server.requests[0].body)
      expect(body).toContain("response_format")
      expect(body).toContain("nexusloop_structured_output")
      expect(body).toContain("summary")

      const recomputeInput = {
        request_id: result.request_id,
        candidate_id: result.candidate_id,
        status: result.status,
        text: result.text,
        tool_calls: result.tool_calls,
        finish_reason: result.finish_reason,
        usage: result.usage,
        provider_metadata: result.provider_metadata,
        duration_ms: result.duration_ms,
        warnings: result.warnings,
      } as const
      const recomputed = finalizeResult(result.error ? { ...recomputeInput, error: result.error } : recomputeInput)
      expect(result.result_hash).toBe(recomputed.result_hash)
    } finally {
      await server.close()
    }
  })

  test("AI SDK provider adapter forwards required tool choice", async () => {
    const server = await startMockOpenAICompatibleServer(() => "tool")
    try {
      const adapter = createVercelAiSdkCoreAdapter({ baseURL: server.url, apiKey: "fixture-key" })
      const result = await adapter.executeOneStep(baseRequest({
        tool_choice: "required",
        messages: [{ role: "user", content: "tool" }],
      }))
      expect(result.status).toBe("tool_call")
      expect(JSON.stringify(server.requests[0].body)).toContain("required")

      const streamEvents = []
      for await (const event of adapter.executeOneStreamedStep(baseRequest({ tool_choice: "required", messages: [{ role: "user", content: "stream" }] }))) {
        streamEvents.push(event.type)
      }
      expect(streamEvents).toContain("completed")
      expect(JSON.stringify(server.requests[1].body)).toContain("required")
      expect(JSON.stringify(server.requests[1].body)).toContain("\"max_tokens\":256")
      expect(JSON.stringify(server.requests[1].body)).toContain("\"temperature\":0")
    } finally {
      await server.close()
    }
  })

  test("AI SDK provider adapter preserves refusal status", async () => {
    const server = await startMockOpenAICompatibleServer(() => "refusal")
    try {
      const adapter = createVercelAiSdkCoreAdapter({ baseURL: server.url, apiKey: "fixture-key" })
      const result = await adapter.executeOneStep(baseRequest({ messages: [{ role: "user", content: "refusal" }] }))
      expect(result.status).toBe("refusal")
      expect(result.text).toContain("fixture refusal")
      expect(result.finish_reason).toBe("content-filter")
    } finally {
      await server.close()
    }
  })

  test("AI SDK provider stream fixture keeps error cases reachable", async () => {
    const server = await startMockOpenAICompatibleServer()
    const originalConsoleError = console.error
    try {
      console.error = () => {}
      const adapter = createVercelAiSdkCoreAdapter({ baseURL: server.url, apiKey: "fixture-key" })
      const events = []
      for await (const event of adapter.executeOneStreamedStep(baseRequest({ messages: [{ role: "user", content: "invalid json stream" }] }))) {
        events.push(event.type)
      }
      expect(events).toContain("error")
      expect(JSON.stringify(server.requests[0].body)).toContain("invalid json stream")
    } finally {
      console.error = originalConsoleError
      await server.close()
    }
  })

  test("OpenAI Agents candidate exercises the controlled SDK ModelProvider surface", async () => {
    const probe = await runControlledAgentsModelProbe(baseRequest({ tool_choice: "required", messages: [{ role: "user", content: "tool" }] }))
    expect(probe.sdk_model_provider_used).toBe(true)
    expect(probe.request_count).toBe(1)
    expect(probe.output_types).toContain("function_call")
    expect(probe.tool_choice).toBe("required")
    expect(probe.tracing_disabled_by_api).toBe(true)
  })

  for (const adapter of adapters) {
    test(`${adapter.candidate_id} normalizes plain final text`, async () => {
      const result = await runTextStepProbe(adapter)
      expect(result.status).toBe("pass")
      expect(result.result.raw_provider_payload_included).toBe(false)
    })

    test(`${adapter.candidate_id} normalizes one native tool call without execution`, async () => {
      const result = await runNativeToolCallProbe(adapter)
      expect(result.status).toBe("pass")
      expect(result.result.provider_metadata.request_count).toBe(1)
      expect(result.result.tool_calls[0].tool_id).toBe("memory.search")
      expect(result.result.tool_calls[0].arguments_valid).toBe(true)
    })

    test(`${adapter.candidate_id} normalizes multiple calls and malformed arguments`, async () => {
      const multi = await adapter.executeOneStep(baseRequest({ messages: [{ role: "user", content: "multi tool" }] }))
      expect(multi.status).toBe("tool_call")
      expect(multi.tool_calls).toHaveLength(2)
      const malformed = await adapter.executeOneStep(baseRequest({ messages: [{ role: "user", content: "malformed" }] }))
      expect(malformed.status).toBe("tool_call")
      expect(malformed.tool_calls[0].arguments_valid).toBe(false)
    })

    test(`${adapter.candidate_id} normalizes refusal and structured output`, async () => {
      const refusal = await adapter.executeOneStep(baseRequest({ messages: [{ role: "user", content: "refusal" }] }))
      expect(refusal.status).toBe("refusal")
      const structured = await adapter.executeOneStep(baseRequest({ messages: [{ role: "user", content: "structured" }] }))
      expect(structured.status).toBe("final")
      expect(structured.text).toContain("structured fixture")
    })

    test(`${adapter.candidate_id} supports JSON fallback validation`, () => {
      const request = baseRequest()
      const valid = runJsonFallbackProbe(request, JSON.stringify({ type: "tool_call", tool_id: "memory.search", arguments: { query: "memory" } }))
      expect(valid.status).toBe("tool_call")
      const unknownKey = runJsonFallbackProbe(request, JSON.stringify({ type: "tool_call", tool_id: "memory.search", arguments: { query: "memory" }, extra: true }))
      expect(unknownKey.status).toBe("malformed")
      const unknownTool = runJsonFallbackProbe(request, JSON.stringify({ type: "tool_call", tool_id: "repo.shell", arguments: {} }))
      expect(unknownTool.status).toBe("malformed")
      const oversized = runJsonFallbackProbe(request, "x".repeat(4097))
      expect(oversized.status).toBe("blocked")
    })

    test(`${adapter.candidate_id} normalizes streaming and cancellation`, async () => {
      expect((await runStreamingProbe(adapter)).status).toBe("pass")
      expect((await runCancellationProbe(adapter)).status).toBe("pass")
    })

    test(`${adapter.candidate_id} maps usage without fabricating missing values`, async () => {
      const result = await runUsageProbe(adapter)
      expect(result.status).toBe("pass")
      expect(result.usage.total_tokens).toBe(18)
    })

    test(`${adapter.candidate_id} ownership probe keeps NexusLoop authority`, () => {
      const report = ownershipReport(adapter.candidate_id)
      expect(report.nexusloop_owns_tool_execution).toBe(true)
      expect(report.nexusloop_owns_loop).toBe(true)
      expect(report.hidden_tool_execution_detected).toBe(false)
      expect(report.hidden_second_request_detected).toBe(false)
      expect(report.hidden_persistence_detected).toBe(false)
    })
  }

  test("OpenAI Agents Runner ownership conflicts are documented", () => {
    const probe = runnerOwnershipProbe()
    expect(probe.production_runner_suitable).toBe(false)
    expect(probe.function_tools_can_auto_execute).toBe(true)
    expect(probe.tracing_disabled_by_api).toBe(true)
  })

  test("matrix weights total 100 and select exactly one final decision", async () => {
    const results = await buildResults()
    expect(Object.values(results.weights).reduce((sum, value) => sum + value, 0)).toBe(100)
    expect(results.final_decision).toBe("hybrid_ai_sdk_core_with_nexusloop_loop")
    expect(results.candidates.some((candidate) => candidate.candidate_id === "vercel_ai_sdk_core" && candidate.weighted_score > 90)).toBe(true)
  })

  test("probe output is deterministic and confirms one-step shape", async () => {
    const first = await runProbes()
    const second = await runProbes()
    expect(hashStable(first)).toBe(hashStable(second))
    expect(validateProbeResults(first)).toEqual([])
    expect(first.one_step.every((item) => item.request_count === 1)).toBe(true)
    expect(first.one_step.every((item) => item.tool_calls === 1)).toBe(true)
    const broken = structuredClone(first)
    broken.one_step[0].status = "final"
    broken.ownership[0].hidden_tool_execution_detected = true
    expect(validateProbeResults(broken)).toContain("minimal_custom_adapter one-step status was final")
    expect(validateProbeResults(broken)).toContain("minimal_custom_adapter reported hidden tool execution")
  })

  test("fixture classifier keeps malformed stream cases before generic streams", () => {
    expect(fixtureCase(baseRequest({ messages: [{ role: "user", content: "invalid json stream" }] }))).toBe("invalid_json")
    expect(fixtureCase(baseRequest({ messages: [{ role: "user", content: "premature stream" }] }))).toBe("premature_stream")
    expect(fixtureCase(baseRequest({ messages: [{ role: "user", content: "stream tool" }] }))).toBe("stream_tool")
  })
})

async function collectFiles(root: string, dirs: string[]): Promise<string[]> {
  const files: string[] = []
  for (const dir of dirs) await walk(join(root, dir), files)
  return files.filter((file) => /\.(ts|tsx|js|json)$/.test(file))
}

async function walk(path: string, files: string[]): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const next = join(path, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue
      await walk(next, files)
    } else {
      files.push(next)
    }
  }
}
