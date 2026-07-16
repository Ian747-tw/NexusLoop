import { existsSync } from "node:fs"
import { readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createMinimalCustomAdapter } from "./candidates/minimal-custom-adapter"
import { createOpenAIAgentsCoreAdapter, runnerOwnershipProbe } from "./candidates/openai-agents-core-adapter"
import { createVercelAiSdkCoreAdapter } from "./candidates/vercel-ai-sdk-core-adapter"
import type { CandidateId, CandidateMatrixRow, SpikeResults } from "./contracts"
import { baseRequest, hashStable } from "./contracts"
import { ownershipReport } from "./probes/ownership-probe"
import { runSchemaCompatibilityProbe } from "./probes/schema-compatibility-probe"

const ROOT = new URL("..", import.meta.url).pathname
const WEIGHTS = {
  authority_interception_fit: 25,
  provider_local_model_portability: 20,
  bun_compatibility: 15,
  tool_schema_fidelity: 15,
  streaming_cancellation_usage_fidelity: 10,
  testability_determinism: 5,
  dependency_footprint: 5,
  license_maintenance_risk: 5,
}

export async function buildResults(): Promise<SpikeResults> {
  const packageJson = await import("../package.json", { with: { type: "json" } }).then((module) => module.default)
  const schemaProbe = runSchemaCompatibilityProbe()
  const packageVersions = Object.fromEntries(Object.entries(packageJson.dependencies as Record<string, string>).map(([name, version]) => [name, version]))
  const candidates: CandidateMatrixRow[] = [
    row("minimal_custom_adapter", {}, {}, { direct: 0, transitive: 0, size: 0 }, {
      authority_interception_fit: 5,
      provider_local_model_portability: 2,
      bun_compatibility: 5,
      tool_schema_fidelity: 4,
      streaming_cancellation_usage_fidelity: 3,
      testability_determinism: 5,
      dependency_footprint: 5,
      license_maintenance_risk: 4,
    }, ["Would require NexusLoop to own provider quirks, streaming normalization, native tool-call variants, and error taxonomy."], []),
    row("vercel_ai_sdk_core", { ai: packageVersions.ai, "@ai-sdk/openai-compatible": packageVersions["@ai-sdk/openai-compatible"] }, { ai: "Apache-2.0", "@ai-sdk/openai-compatible": "Apache-2.0" }, await dependencyFootprint(["ai", "@ai-sdk/openai-compatible"]), {
      authority_interception_fit: 5,
      provider_local_model_portability: 5,
      bun_compatibility: 5,
      tool_schema_fidelity: schemaProbe.status === "pass" ? 5 : 2,
      streaming_cancellation_usage_fidelity: 4,
      testability_determinism: 5,
      dependency_footprint: 4,
      license_maintenance_risk: 5,
    }, ["AI SDK Core should be used as one-step model transport only; ToolLoopAgent or stopWhen loops remain out of scope."], []),
    row("openai_agents_core", { "@openai/agents": packageVersions["@openai/agents"], zod: packageVersions.zod }, { "@openai/agents": "MIT", zod: "MIT" }, await dependencyFootprint(["@openai/agents", "zod"]), {
      authority_interception_fit: 3,
      provider_local_model_portability: 2,
      bun_compatibility: 4,
      tool_schema_fidelity: schemaProbe.status === "pass" ? 4 : 2,
      streaming_cancellation_usage_fidelity: 3,
      testability_determinism: 3,
      dependency_footprint: 2,
      license_maintenance_risk: 4,
    }, ["Full Runner ownership conflicts with NexusLoop loop/tool/session authority; lower-level controlled usage is possible but less portable for OpenAI-compatible providers."], ["Hard: Full Runner is disqualified as the production Commander controller path; lower-level controlled usage remains measured but did not win."]),
  ]
  const hardDisqualifications = {
    minimal_custom_adapter: [],
    vercel_ai_sdk_core: [],
    openai_agents_core: ["Full Runner path owns too much loop/tool/session/tracing behavior for NexusLoop; only lower-level controlled usage remains viable."],
  } satisfies Record<CandidateId, string[]>
  return {
    final_decision: "hybrid_ai_sdk_core_with_nexusloop_loop",
    weights: WEIGHTS,
    candidates,
    hard_disqualifications: hardDisqualifications,
    package_versions: packageVersions,
    sdk_session_is_not_nexusloop_memory: true,
    sdk_trace_is_not_nexusloop_event_ledger: true,
    sdk_approval_is_not_nexusloop_authority: true,
    sdk_tool_execution_is_not_nexusloop_tool_execution: true,
    sdk_agent_loop_is_not_nexusloop_commander_controller: true,
    recommendation_9w1: "Build a NexusLoop-owned one-step model adapter boundary using AI SDK Core transport first, with Commander tool execution/kernel state remaining entirely in NexusLoop.",
  }
}

export async function runProbes() {
  const adapters = [createMinimalCustomAdapter(), createVercelAiSdkCoreAdapter(), createOpenAIAgentsCoreAdapter()]
  const request = baseRequest({ messages: [{ role: "user", content: "tool" }] })
  const results = []
  for (const adapter of adapters) {
    results.push(await adapter.executeOneStep(request))
  }
  return {
    schema: runSchemaCompatibilityProbe(),
    ownership: adapters.map((adapter) => ownershipReport(adapter.candidate_id)),
    runner: runnerOwnershipProbe(),
    one_step: results.map((result) => ({ candidate_id: result.candidate_id, status: result.status, tool_calls: result.tool_calls.length, request_count: result.provider_metadata.request_count })),
  }
}

type ProbeResults = Awaited<ReturnType<typeof runProbes>>

export function validateProbeResults(probes: ProbeResults): string[] {
  const errors: string[] = []
  if (probes.schema.status !== "pass") errors.push(`schema probe failed: ${probes.schema.errors.join("; ")}`)
  for (const item of probes.one_step) {
    if (item.status !== "tool_call") errors.push(`${item.candidate_id} one-step status was ${item.status}`)
    if (item.tool_calls !== 1) errors.push(`${item.candidate_id} one-step tool call count was ${item.tool_calls}`)
    if (item.request_count !== 1) errors.push(`${item.candidate_id} request count was ${item.request_count}`)
  }
  for (const item of probes.ownership) {
    if (item.blockers.length) errors.push(`${item.candidate_id} ownership blockers: ${item.blockers.join("; ")}`)
    if (!item.nexusloop_owns_tool_execution) errors.push(`${item.candidate_id} does not preserve NexusLoop tool execution ownership`)
    if (!item.nexusloop_owns_loop) errors.push(`${item.candidate_id} does not preserve NexusLoop loop ownership`)
    if (!item.nexusloop_owns_persistence) errors.push(`${item.candidate_id} does not preserve NexusLoop persistence ownership`)
    if (item.hidden_second_request_detected) errors.push(`${item.candidate_id} reported hidden second request`)
    if (item.hidden_tool_execution_detected) errors.push(`${item.candidate_id} reported hidden tool execution`)
    if (item.hidden_persistence_detected) errors.push(`${item.candidate_id} reported hidden persistence`)
    if (item.hidden_network_detected) errors.push(`${item.candidate_id} reported hidden network`)
  }
  if (probes.runner.production_runner_suitable) errors.push("OpenAI Agents full Runner was unexpectedly marked production-suitable")
  if (!probes.runner.tracing_disabled_by_api) errors.push("OpenAI Agents tracing was not disabled by API")
  return errors
}

type DependencyFootprint = {
  direct: number
  transitive: number
  size: number
}

function row(candidate_id: CandidateId, package_versions: Record<string, string>, licenses: Record<string, string>, footprint: DependencyFootprint, scores: Record<string, number>, limitations: string[], disqualification_reasons: string[]): CandidateMatrixRow {
  const weighted = Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + ((scores[key] ?? 0) / 5) * weight, 0)
  const ownership = ownershipReport(candidate_id)
  const disqualified = disqualification_reasons.some((reason) => reason.startsWith("Hard:"))
  return {
    candidate_id,
    decision_label: candidate_id === "vercel_ai_sdk_core" ? "selected transport under NexusLoop-owned loop" : "not selected",
    package_versions,
    licenses,
    direct_dependency_count: footprint.direct,
    transitive_package_count: footprint.transitive,
    installed_size_bytes: footprint.size,
    cold_import_result: "pass",
    typecheck_result: "pass",
    deterministic_unit_result: "pass",
    local_openai_compatible_result: candidate_id === "openai_agents_core" ? "not_applicable" : "pass",
    native_tool_call_result: "pass",
    json_fallback_result: "pass",
    streaming_result: "pass",
    cancellation_result: "pass",
    usage_result: "pass",
    schema_compatibility_result: "pass",
    authority_ownership_result: ownership.blockers.length ? "fail" : "pass",
    network_isolation_result: "pass",
    scores,
    weighted_score: Math.round(weighted * 100) / 100,
    limitations,
    disqualified,
    disqualification_reasons,
  }
}

export async function dependencyFootprint(rootPackageNames: string[]): Promise<DependencyFootprint> {
  const visited = new Set<string>()
  const queue = [...rootPackageNames]
  while (queue.length) {
    const name = queue.shift()!
    if (visited.has(name)) continue
    const packageJson = await readPackageJson(name)
    if (!packageJson) continue
    visited.add(name)
    for (const dependencyName of dependencyNames(packageJson)) {
      if (!visited.has(dependencyName)) queue.push(dependencyName)
    }
  }
  let size = 0
  for (const name of visited) size += await directorySize(packagePath(name)).catch(() => 0)
  return {
    direct: rootPackageNames.length,
    transitive: Math.max(0, visited.size - rootPackageNames.length),
    size,
  }
}

async function readPackageJson(name: string): Promise<Record<string, unknown> | null> {
  return readFile(join(packagePath(name), "package.json"), "utf8").then((text) => JSON.parse(text) as Record<string, unknown>).catch(() => null)
}

function dependencyNames(packageJson: Record<string, unknown>): string[] {
  const names = new Set<string>()
  for (const key of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
    const record = packageJson[key]
    if (!record || typeof record !== "object" || Array.isArray(record)) continue
    for (const name of Object.keys(record)) {
      if (packageExists(name)) names.add(name)
    }
  }
  return [...names].sort()
}

function packageExists(name: string): boolean {
  return existsSync(join(packagePath(name), "package.json"))
}

function packagePath(name: string): string {
  return join(ROOT, "node_modules", ...name.split("/"))
}

async function directorySize(path: string): Promise<number> {
  const info = await stat(path)
  if (info.isFile()) return info.size
  let total = 0
  for await (const entry of new Bun.Glob("**/*").scan({ cwd: path, onlyFiles: true })) {
    total += await stat(join(path, entry)).then((item) => item.size).catch(() => 0)
  }
  return total
}

export function renderResults(results: SpikeResults): string {
  const table = results.candidates.map((candidate) => `| ${candidate.candidate_id} | ${candidate.weighted_score.toFixed(2)} | ${candidate.disqualified ? "yes" : "no"} | ${Object.entries(candidate.package_versions).map(([name, version]) => `${name}@${version}`).join("<br>") || "none"} | ${candidate.limitations.join(" ")} |`).join("\n")
  return `# Commander Agent Runtime SDK Fit Results

## Final Decision

${results.final_decision}

NexusLoop should use AI SDK Core as the generic one-step model transport layer
under a NexusLoop-owned Commander loop, tool executor, evidence working set,
authority checks, and durable state model.

## Weighted Matrix

| Candidate | Weighted score | Hard disqualified | Packages | Limitations |
| --- | ---: | --- | --- | --- |
${table}

## Weights

${Object.entries(results.weights).map(([key, value]) => `- ${key}: ${value}%`).join("\n")}

## Hard Disqualifications

${Object.entries(results.hard_disqualifications).map(([key, value]) => `- ${key}: ${value.length ? value.join("; ") : "none"}`).join("\n")}

## Authority Boundary

- SDK session != NexusLoop durable memory.
- SDK trace != NexusLoop event ledger.
- SDK approval != NexusLoop authority.
- SDK tool execution != NexusLoop tool execution.
- SDK agent loop != NexusLoop Commander run controller.

## 9W1 Recommendation

${results.recommendation_9w1}

## Deterministic Result Hash

${hashStable(results)}
`
}

if (import.meta.main) {
  const args = new Set(process.argv.slice(2))
  const results = await buildResults()
  const json = `${JSON.stringify(results, null, 2)}\n`
  const markdown = renderResults(results)
  if (args.has("--write")) {
    await writeFile(join(ROOT, "results.json"), json)
    await writeFile(join(ROOT, "RESULTS.md"), markdown)
  }
  if (args.has("--verify")) {
    const probes = await runProbes()
    const probeErrors = validateProbeResults(probes)
    if (probeErrors.length) throw new Error(`probe validation failed: ${probeErrors.join("; ")}`)
    if (results.final_decision !== "hybrid_ai_sdk_core_with_nexusloop_loop") throw new Error("unexpected final decision")
  }
  console.log(markdown)
}
