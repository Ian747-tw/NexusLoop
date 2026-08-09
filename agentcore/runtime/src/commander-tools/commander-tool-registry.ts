import { createHash } from "node:crypto"
import { COMMAND_AUTHORITY_REGISTRY } from "../authority/command-authority-registry"
import { commanderGithubToolAuthority } from "../commander-agent/commander-github-tool-authority-registry"
import { commanderGithubOutputSchema } from "./commander-github-read-schemas"
import type { CommanderGithubReadToolId } from "./commander-github-read-types"
import type { CommandAuthorityRecord } from "../authority/command-authority-types"
import type {
  CommanderToolAvailability,
  CommanderToolDescriptor,
  CommanderToolJsonSchema,
  CommanderToolLoadPolicy,
  CommanderToolNamespace,
  CommanderToolNamespaceSummary,
  CommanderToolPhase,
  CommanderToolSideEffectClass,
  CommanderToolTrustClass,
} from "./commander-tool-types"

export const COMMANDER_TOOL_NAMESPACES: CommanderToolNamespace[] = ["core", "authority", "memory", "continuity", "runtime_read", "opencode_read", "repo_read", "github_read", "external_research", "governance"]
export const COMMANDER_TOOL_PHASES: CommanderToolPhase[] = ["general_read", "proposal_investigation", "mid_mission_supervision", "result_review", "governance_review", "emergency_inspection"]

const ALL_READ_PHASES: CommanderToolPhase[] = ["general_read", "proposal_investigation", "mid_mission_supervision", "result_review", "governance_review", "emergency_inspection"]
const STRATEGIC_PHASES: CommanderToolPhase[] = ["proposal_investigation", "result_review"]
const SUPERVISION_PHASES: CommanderToolPhase[] = ["mid_mission_supervision", "result_review", "emergency_inspection"]

const emptySchema: CommanderToolJsonSchema = {
  schema_version: "nxl-commander-tool-v1",
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
}

const stringField = (description: string, maxLength = 240) => ({ type: "string" as const, description, maxLength })
const boolField = (description: string) => ({ type: "boolean" as const, description })
const intField = (description: string, minimum = 1, maximum = 20) => ({ type: "integer" as const, description, minimum, maximum })

function schema(properties: CommanderToolJsonSchema["properties"], required: string[] = []): CommanderToolJsonSchema {
  return { schema_version: "nxl-commander-tool-v1", type: "object", properties, required, additionalProperties: false }
}

type ToolSpec = Omit<CommanderToolDescriptor, "authority_id" | "risk" | "side_effect_class" | "trust_class" | "instruction_semantics" | "availability" | "load_policy" | "requires_approval" | "requires_run_lock" | "creates_external_process" | "execution_backend" | "process_policy" | "calls_provider" | "mutates_events" | "current_phase_status" | "schema_metadata"> & {
  slash_command?: string
  input_schema?: CommanderToolJsonSchema
  output_schema?: CommanderToolJsonSchema
  risk?: CommanderToolDescriptor["risk"]
  side_effect_class?: CommanderToolSideEffectClass
  trust_class?: CommanderToolTrustClass
  availability?: CommanderToolAvailability
  load_policy?: CommanderToolLoadPolicy
  requires_approval?: boolean
  requires_run_lock?: boolean
  creates_external_process?: boolean
  execution_backend?: CommanderToolDescriptor["execution_backend"]
  process_policy?: CommanderToolDescriptor["process_policy"]
  calls_provider?: boolean
  mutates_events?: boolean
  authority?: CommandAuthorityRecord
}

function makeTool(spec: ToolSpec): CommanderToolDescriptor {
  const authority = spec.authority ?? (spec.slash_command ? findAuthority(spec.slash_command) : undefined)
  const { authority: _internalAuthority, ...descriptorSpec } = spec
  const input = spec.input_schema ?? emptySchema
  const output = spec.output_schema ?? schema({ status: stringField("Bounded command result status", 64) }, ["status"])
  const schemaBytes = bytes(input) + bytes(output)
  return {
    ...descriptorSpec,
    authority_id: authority?.authority_id,
    runtime_command: spec.runtime_command ?? authority?.runtime_command,
    risk: spec.risk ?? authority?.risk ?? "safe_read",
    side_effect_class: spec.side_effect_class ?? (authority ? "internal_read" : "none"),
    trust_class: spec.trust_class ?? "runtime_authoritative",
    instruction_semantics: "none",
    availability: spec.availability ?? (authority ? "implemented_read_surface" : "future_internal_read"),
    load_policy: spec.load_policy ?? "deferred",
    current_phase_status: authority?.current_phase_status ?? (spec.availability?.startsWith("future") ? "future" : "implemented"),
    requires_approval: authority?.requires_approval ?? spec.requires_approval ?? false,
    requires_run_lock: authority?.requires_run_lock ?? spec.requires_run_lock ?? false,
    creates_external_process: authority?.creates_external_process ?? spec.creates_external_process ?? false,
    execution_backend: spec.execution_backend ?? (spec.namespace === "repo_read" ? "filesystem_read" : "runtime_service"),
    process_policy: spec.process_policy ?? "none",
    calls_provider: authority?.calls_provider ?? spec.calls_provider ?? false,
    mutates_events: authority?.mutates_events ?? spec.mutates_events ?? false,
    input_schema: input,
    output_schema: output,
    schema_metadata: {
      input_schema_hash: hash(input),
      output_schema_hash: hash(output),
      input_schema_bytes: bytes(input),
      output_schema_bytes: bytes(output),
      estimated_schema_tokens: Math.ceil(schemaBytes / 4),
      schema_loaded: true,
    },
  }
}

export const COMMANDER_TOOL_REGISTRY: CommanderToolDescriptor[] = [
  makeTool({ tool_id: "commander.tool_search", namespace: "core", name: "Search Commander tools", version: "1.0.0", description: "Search the curated Commander capability registry without executing tools.", keywords: ["tool", "search", "capability", "registry"], slash_command: "/commander-tool-search", load_policy: "always_loaded", allowed_phases: ALL_READ_PHASES, requires_network: false, requires_credentials: false, max_output_bytes: 12_000, timeout_ms: 500, input_schema: schema({ query: stringField("Search query", 200), phase: stringField("Optional Commander phase", 64), namespace: stringField("Optional namespace filter", 64), implemented_only: boolField("Only implemented read surfaces"), allowed_in_phase_only: boolField("Only current phase eligible tools"), include_schema: boolField("Include bounded schemas"), limit: intField("Maximum matches") }, ["query"]), output_schema: schema({ matches: { type: "array", description: "Bounded descriptor matches", items: { type: "object", description: "Tool match preview" } }, execution_enabled: boolField("Always false in 9U") }, ["matches", "execution_enabled"]), notes: ["Catalog read only; schemas are deferred by default."], out_of_scope: ["tool execution", "provider calls", "MCP execution", "network"] }),
  makeTool({ tool_id: "commander.tool_get", namespace: "core", name: "Show Commander tool", version: "1.0.0", description: "Load one bounded Commander tool descriptor and schema.", keywords: ["tool", "show", "schema"], slash_command: "/commander-tool-show", load_policy: "always_loaded", allowed_phases: ALL_READ_PHASES, requires_network: false, requires_credentials: false, max_output_bytes: 16_000, timeout_ms: 500, input_schema: schema({ tool_id: stringField("Commander tool ID", 120) }, ["tool_id"]), output_schema: schema({ tool_id: stringField("Tool ID", 120), schema_loaded: boolField("Whether full schema was returned") }, ["tool_id", "schema_loaded"]), notes: ["Loads one schema only; output remains bounded."], out_of_scope: ["tool execution"] }),
  makeTool({ tool_id: "commander.tool_list", namespace: "core", name: "List Commander tools", version: "1.0.0", description: "List bounded Commander capability descriptors.", keywords: ["tool", "list", "catalog"], slash_command: "/commander-tools", load_policy: "deferred", allowed_phases: ALL_READ_PHASES, requires_network: false, requires_credentials: false, max_output_bytes: 16_000, timeout_ms: 500, input_schema: schema({ namespace: stringField("Optional namespace filter", 64), phase: stringField("Optional phase filter", 64), implemented_only: boolField("Only implemented read surfaces"), limit: intField("Maximum descriptors", 1, 50) }), notes: ["List output omits full deferred schemas."], out_of_scope: ["automatic command reflection"] }),
  makeTool({ tool_id: "commander.tool_profile", namespace: "core", name: "Preview Commander tool profile", version: "1.0.0", description: "Describe a Commander phase capability envelope.", keywords: ["profile", "phase", "budget"], slash_command: "/commander-tool-profile", load_policy: "always_loaded", allowed_phases: ALL_READ_PHASES, requires_network: false, requires_credentials: false, max_output_bytes: 12_000, timeout_ms: 500, input_schema: schema({ phase: stringField("Commander phase", 80) }, ["phase"]), notes: ["Profiles are capability envelopes, not workflows."], out_of_scope: ["provider loop enforcement"] }),
  makeTool({ tool_id: "commander.tool_bootstrap", namespace: "core", name: "Preview Commander bootstrap catalog", version: "1.0.0", description: "Compile the initial bounded tool schema catalog for a Commander phase.", keywords: ["bootstrap", "schema", "budget"], slash_command: "/commander-tool-bootstrap", load_policy: "deferred", allowed_phases: ALL_READ_PHASES, requires_network: false, requires_credentials: false, max_output_bytes: 18_000, timeout_ms: 700, input_schema: schema({ phase: stringField("Commander phase", 80), provider: stringField("Provider kind", 80), model: stringField("Model ID", 120), max_context_tokens: intField("Optional context token cap", 1000, 128000) }, ["phase"]), notes: ["Uses ContextBudgetService; execution_enabled is false."], out_of_scope: ["provider calls", "tool loop execution"] }),
  makeTool({ tool_id: "commander.tool_registry_validate", namespace: "core", name: "Validate Commander tool registry", version: "1.0.0", description: "Validate Commander tool descriptors against authority and safety invariants.", keywords: ["validate", "registry", "authority"], slash_command: "/commander-tool-registry-validate", load_policy: "deferred", allowed_phases: ALL_READ_PHASES, requires_network: false, requires_credentials: false, max_output_bytes: 18_000, timeout_ms: 700, notes: ["Validation fails closed with explicit errors."], out_of_scope: ["repairing descriptors automatically"] }),
  makeTool({ tool_id: "authority.describe", namespace: "authority", name: "Show command authority", version: "1.0.0", description: "Inspect one existing runtime authority record.", keywords: ["authority", "risk", "permission"], slash_command: "/authority-show", load_policy: "always_loaded", allowed_phases: ALL_READ_PHASES, requires_network: false, requires_credentials: false, max_output_bytes: 10_000, timeout_ms: 500, input_schema: schema({ command: stringField("Slash command to inspect", 100) }, ["command"]), notes: ["Authority records are runtime-owned evidence."], out_of_scope: ["command execution"] }),
  makeTool({ tool_id: "authority.list", namespace: "authority", name: "List command authority", version: "1.0.0", description: "List existing command authority records.", keywords: ["authority", "list"], slash_command: "/authority-list", allowed_phases: ALL_READ_PHASES, requires_network: false, requires_credentials: false, max_output_bytes: 14_000, timeout_ms: 500, notes: ["Read-only authority inventory."], out_of_scope: ["automatic Commander tool exposure"] }),
  makeTool({ tool_id: "authority.summary", namespace: "authority", name: "Command authority summary", version: "1.0.0", description: "Summarize command authority risk and owner counts.", keywords: ["authority", "summary"], slash_command: "/authority-summary", allowed_phases: ALL_READ_PHASES, requires_network: false, requires_credentials: false, max_output_bytes: 8_000, timeout_ms: 500, notes: ["Read-only authority summary."], out_of_scope: ["approval mutation"] }),
  makeTool({ tool_id: "memory.profile", namespace: "memory", name: "Research memory profile", version: "1.0.0", description: "Inspect research-memory search capabilities and limits.", keywords: ["memory", "profile", "fts", "lexical"], slash_command: "/research-memory-profile", allowed_phases: ["general_read", "proposal_investigation", "result_review", "mid_mission_supervision"], requires_network: false, requires_credentials: false, trust_class: "research_projection", max_output_bytes: 10_000, timeout_ms: 700, notes: ["Search capability evidence only; no provider or vector search."], out_of_scope: ["semantic search", "research direction decision"] }),
  makeTool({ tool_id: "memory.search", namespace: "memory", name: "Search research memory", version: "1.0.0", description: "Run bounded internal research-memory retrieval.", keywords: ["memory", "research", "search", "finding", "failure"], slash_command: "/research-memory-search", allowed_phases: ["general_read", "proposal_investigation", "result_review", "mid_mission_supervision"], requires_network: false, requires_credentials: false, trust_class: "research_projection", max_output_bytes: 18_000, timeout_ms: 1000, input_schema: schema({ query: stringField("Bounded search query", 300), labels: stringField("Optional comma-separated labels", 120), include_failures: boolField("Include failure evidence"), limit: intField("Maximum candidates") }, ["query"]), notes: ["Hybrid FTS+lexical when available; bounded lexical fallback."], out_of_scope: ["provider synthesis", "proposal creation"] }),
  makeTool({ tool_id: "memory.show", namespace: "memory", name: "Inspect research memory", version: "1.0.0", description: "Inspect one bounded research-memory record.", keywords: ["memory", "inspect", "show"], slash_command: "/research-memory-show", allowed_phases: STRATEGIC_PHASES, requires_network: false, requires_credentials: false, trust_class: "research_projection", max_output_bytes: 12_000, timeout_ms: 700, input_schema: schema({ id: stringField("Research memory ID", 160) }, ["id"]), notes: ["Pointer-only provenance and bounded previews."], out_of_scope: ["raw artifact contents", "raw DB dump"] }),
  makeTool({ tool_id: "memory.near_duplicates", namespace: "memory", name: "Research near-duplicate preview", version: "1.0.0", description: "Preview duplicate risk for a proposed research question.", keywords: ["duplicate", "novelty", "memory"], slash_command: "/research-memory-near-duplicates", allowed_phases: STRATEGIC_PHASES, requires_network: false, requires_credentials: false, trust_class: "research_projection", max_output_bytes: 14_000, timeout_ms: 1000, input_schema: schema({ query: stringField("Question or objective", 300), limit: intField("Maximum candidates") }, ["query"]), notes: ["Advisory only; does not block proposals."], out_of_scope: ["automatic novelty authority"] }),
  makeTool({ tool_id: "memory.summary", namespace: "memory", name: "Research memory summary", version: "1.0.0", description: "Summarize available research-memory candidates.", keywords: ["memory", "summary"], slash_command: "/research-memory-summary", allowed_phases: ALL_READ_PHASES, requires_network: false, requires_credentials: false, trust_class: "research_projection", max_output_bytes: 10_000, timeout_ms: 700, notes: ["Projection summary only."], out_of_scope: ["research.db writes"] }),
  makeTool({ tool_id: "continuity.proposal_packet", namespace: "continuity", name: "Commander proposal continuity packet", version: "1.0.0", description: "Preview bounded Commander proposal-time continuity.", keywords: ["continuity", "proposal", "packet"], slash_command: "/commander-continuity-preview", allowed_phases: ["proposal_investigation"], requires_network: false, requires_credentials: false, max_output_bytes: 24_000, timeout_ms: 1200, input_schema: schema({ objective: stringField("Proposed objective", 400) }, ["objective"]), notes: ["Read-only packet; no proposal generation."], out_of_scope: ["Commander proposal creation"] }),
  makeTool({ tool_id: "continuity.midmission_packet", namespace: "continuity", name: "Commander mid-mission packet", version: "1.0.0", description: "Preview bounded Commander mid-mission continuity.", keywords: ["continuity", "midmission", "session"], slash_command: "/commander-midmission-packet", allowed_phases: SUPERVISION_PHASES, requires_network: false, requires_credentials: false, max_output_bytes: 24_000, timeout_ms: 1200, input_schema: schema({ session: stringField("OpenCode session ID", 160), launch: stringField("Optional launch ID", 160) }), notes: ["Read-only continuity inspection."], out_of_scope: ["OpenCode prompt send"] }),
  makeTool({ tool_id: "continuity.open_loops", namespace: "continuity", name: "Commander open loops", version: "1.0.0", description: "List pending continuity loops that may affect Commander decisions.", keywords: ["open", "loops", "pending"], slash_command: "/commander-open-loops", allowed_phases: ALL_READ_PHASES, requires_network: false, requires_credentials: false, max_output_bytes: 16_000, timeout_ms: 900, notes: ["Recommendations are not executed."], out_of_scope: ["wake action execution"] }),
  makeTool({ tool_id: "continuity.thread", namespace: "continuity", name: "Commander continuity thread", version: "1.0.0", description: "Show bounded best-effort continuity lineage.", keywords: ["thread", "lineage", "continuity"], slash_command: "/commander-continuity-thread", allowed_phases: ALL_READ_PHASES, requires_network: false, requires_credentials: false, max_output_bytes: 12_000, timeout_ms: 900, notes: ["Best-effort thread inference only."], out_of_scope: ["proposal mutation"] }),
  makeTool({ tool_id: "continuity.summary", namespace: "continuity", name: "Commander continuity summary", version: "1.0.0", description: "Summarize recent continuity and open-loop counts.", keywords: ["continuity", "summary"], slash_command: "/commander-continuity-summary", allowed_phases: ALL_READ_PHASES, requires_network: false, requires_credentials: false, max_output_bytes: 12_000, timeout_ms: 900, notes: ["Read-only summary."], out_of_scope: ["event append"] }),
  makeTool({ tool_id: "continuity.search", namespace: "continuity", name: "Search operational continuity", version: "1.0.0", description: "Search bounded typed operational memory across runtime/session/progress/guidance/result records.", keywords: ["continuity", "operational", "memory", "search"], slash_command: "/commander-continuity-search", runtime_command: "runtime.search_commander_operational_memory", allowed_phases: ["general_read", "proposal_investigation", "mid_mission_supervision", "result_review", "emergency_inspection"], requires_network: false, requires_credentials: false, execution_backend: "runtime_service", process_policy: "none", max_output_bytes: 18_000, timeout_ms: 1000, input_schema: schema({ query: stringField("Operational-memory query", 240), session_id: stringField("Optional OpenCode session ID", 160), source_kinds: stringField("Optional comma-separated source kinds", 200), limit: intField("Maximum candidates", 1, 20) }, ["query"]), notes: ["Searches typed projections only; raw events are not searched."], out_of_scope: ["raw event log search", "research.db writes"] }),
  makeTool({ tool_id: "runtime.status", namespace: "runtime_read", name: "Runtime status", version: "1.0.0", description: "Read bounded runtime status and mission summary.", keywords: ["runtime", "status"], slash_command: "/status", allowed_phases: ALL_READ_PHASES, requires_network: false, requires_credentials: false, max_output_bytes: 10_000, timeout_ms: 500, notes: ["Runtime-authoritative status only."], out_of_scope: ["runtime shutdown", "session start"] }),
  makeTool({ tool_id: "runtime.mission_list", namespace: "runtime_read", name: "List missions", version: "1.0.0", description: "List recent mission records through existing runtime authority.", keywords: ["mission", "list", "runtime"], slash_command: "/missions", allowed_phases: ALL_READ_PHASES, requires_network: false, requires_credentials: false, max_output_bytes: 14_000, timeout_ms: 700, notes: ["Read-only mission inventory."], out_of_scope: ["mission mutation", "claim", "complete", "fail", "cancel"] }),
  makeTool({ tool_id: "runtime.mission_show", namespace: "runtime_read", name: "Show mission", version: "1.0.0", description: "Inspect one bounded mission record through existing runtime authority.", keywords: ["mission", "show", "runtime"], slash_command: "/mission", allowed_phases: ALL_READ_PHASES, requires_network: false, requires_credentials: false, max_output_bytes: 12_000, timeout_ms: 700, input_schema: schema({ mission_id: stringField("Mission ID", 160) }, ["mission_id"]), notes: ["Read-only mission inspection."], out_of_scope: ["mission mutation", "proposal apply"] }),
  makeTool({ tool_id: "runtime.review_list", namespace: "runtime_read", name: "List reviews", version: "1.0.0", description: "List proposal review records through existing runtime authority.", keywords: ["review", "list", "runtime"], slash_command: "/reviews", allowed_phases: ["proposal_investigation", "result_review", "governance_review"], requires_network: false, requires_credentials: false, max_output_bytes: 14_000, timeout_ms: 700, notes: ["Read-only review inventory."], out_of_scope: ["review approval", "review rejection", "review cancellation"] }),
  makeTool({ tool_id: "runtime.review_show", namespace: "runtime_read", name: "Show review", version: "1.0.0", description: "Inspect one proposal review record through existing runtime authority.", keywords: ["review", "show", "runtime"], slash_command: "/review", allowed_phases: ["proposal_investigation", "result_review", "governance_review"], requires_network: false, requires_credentials: false, max_output_bytes: 12_000, timeout_ms: 700, input_schema: schema({ review_id: stringField("Review request ID", 160) }, ["review_id"]), notes: ["Read-only review inspection."], out_of_scope: ["review decision"] }),
  makeTool({ tool_id: "runtime.proposal_list", namespace: "runtime_read", name: "List proposals", version: "1.0.0", description: "List Commander proposal records through existing runtime authority.", keywords: ["proposal", "list", "runtime"], slash_command: "/proposals", allowed_phases: ["proposal_investigation", "result_review", "governance_review"], requires_network: false, requires_credentials: false, max_output_bytes: 14_000, timeout_ms: 700, notes: ["Read-only proposal inventory."], out_of_scope: ["proposal creation", "review request", "apply"] }),
  makeTool({ tool_id: "runtime.proposal_show", namespace: "runtime_read", name: "Show proposal", version: "1.0.0", description: "Inspect one Commander proposal record through existing runtime authority.", keywords: ["proposal", "show", "runtime"], slash_command: "/proposal", allowed_phases: ["proposal_investigation", "result_review", "governance_review"], requires_network: false, requires_credentials: false, max_output_bytes: 12_000, timeout_ms: 700, input_schema: schema({ proposal_id: stringField("Proposal ID", 160) }, ["proposal_id"]), notes: ["Read-only proposal inspection."], out_of_scope: ["proposal apply", "proposal cancellation"] }),
  makeTool({ tool_id: "opencode.session_continuity", namespace: "opencode_read", name: "OpenCode session continuity", version: "1.0.0", description: "Preview executor-safe OpenCode session continuity.", keywords: ["opencode", "continuity", "session"], slash_command: "/opencode-continuity-preview", allowed_phases: SUPERVISION_PHASES, requires_network: false, requires_credentials: false, max_output_bytes: 22_000, timeout_ms: 1200, notes: ["Artifact not delivery; no prompt/native action."], out_of_scope: ["OpenCode prompt", "native session action"] }),
  makeTool({ tool_id: "opencode.context_refresh_show", namespace: "opencode_read", name: "Show OpenCode context refresh", version: "1.0.0", description: "Inspect one immutable context-refresh record.", keywords: ["opencode", "refresh", "show"], slash_command: "/opencode-context-refresh-show", allowed_phases: SUPERVISION_PHASES, requires_network: false, requires_credentials: false, max_output_bytes: 12_000, timeout_ms: 700, notes: ["Metadata only; no artifact contents."], out_of_scope: ["OpenCode delivery"] }),
  makeTool({ tool_id: "opencode.context_refresh_list", namespace: "opencode_read", name: "List OpenCode context refreshes", version: "1.0.0", description: "List immutable context-refresh records.", keywords: ["opencode", "refresh", "list"], slash_command: "/opencode-context-refreshes", allowed_phases: SUPERVISION_PHASES, requires_network: false, requires_credentials: false, max_output_bytes: 12_000, timeout_ms: 700, notes: ["Read-only metadata."], out_of_scope: ["artifact write"] }),
  makeTool({ tool_id: "opencode.context_refresh_latest", namespace: "opencode_read", name: "Latest OpenCode context refresh", version: "1.0.0", description: "Read latest context-refresh metadata.", keywords: ["opencode", "refresh", "latest"], slash_command: "/opencode-context-refresh-latest", allowed_phases: SUPERVISION_PHASES, requires_network: false, requires_credentials: false, max_output_bytes: 10_000, timeout_ms: 700, notes: ["Read-only metadata."], out_of_scope: ["OpenCode delivery"] }),
  makeTool({ tool_id: "opencode.progress_latest", namespace: "opencode_read", name: "Latest OpenCode progress", version: "1.0.0", description: "Read latest bounded OpenCode progress metadata.", keywords: ["opencode", "progress", "latest"], slash_command: "/opencode-progress-latest", allowed_phases: SUPERVISION_PHASES, requires_network: false, requires_credentials: false, max_output_bytes: 10_000, timeout_ms: 700, notes: ["Metadata evidence only."], out_of_scope: ["mission completion"] }),
  makeTool({ tool_id: "opencode.progress_list", namespace: "opencode_read", name: "List OpenCode progress", version: "1.0.0", description: "List bounded OpenCode progress records.", keywords: ["opencode", "progress", "list"], slash_command: "/opencode-progress-list", allowed_phases: SUPERVISION_PHASES, requires_network: false, requires_credentials: false, max_output_bytes: 14_000, timeout_ms: 700, notes: ["Read-only progress evidence."], out_of_scope: ["raw logs"] }),
  makeTool({ tool_id: "opencode.watchdog_preview", namespace: "opencode_read", name: "OpenCode watchdog preview", version: "1.0.0", description: "Preview watchdog status without process control.", keywords: ["opencode", "watchdog", "timeout"], slash_command: "/opencode-watchdog-preview", allowed_phases: SUPERVISION_PHASES, requires_network: false, requires_credentials: false, max_output_bytes: 14_000, timeout_ms: 900, notes: ["No pause/kill/stop."], out_of_scope: ["process control"] }),
  makeTool({ tool_id: "opencode.wake_preview", namespace: "opencode_read", name: "OpenCode wake preview", version: "1.0.0", description: "Preview wake-supervisor recommendation metadata.", keywords: ["opencode", "wake", "supervisor"], slash_command: "/opencode-wake-supervisor-preview", allowed_phases: SUPERVISION_PHASES, requires_network: false, requires_credentials: false, max_output_bytes: 16_000, timeout_ms: 1000, notes: ["Recommendation only; no execution."], out_of_scope: ["wake action execution"] }),
  makeTool({ tool_id: "opencode.result_report_show", namespace: "opencode_read", name: "Show OpenCode result report", version: "1.0.0", description: "Inspect one bounded result report.", keywords: ["opencode", "result", "report"], slash_command: "/opencode-result-report-show", allowed_phases: ["result_review", "mid_mission_supervision"], requires_network: false, requires_credentials: false, max_output_bytes: 12_000, timeout_ms: 700, notes: ["Executor evidence only."], out_of_scope: ["result acceptance"] }),
  makeTool({ tool_id: "opencode.result_report_list", namespace: "opencode_read", name: "List OpenCode result reports", version: "1.0.0", description: "List bounded result-report records.", keywords: ["opencode", "result", "reports"], slash_command: "/opencode-result-reports", allowed_phases: ["result_review", "mid_mission_supervision"], requires_network: false, requires_credentials: false, max_output_bytes: 14_000, timeout_ms: 700, notes: ["Read-only report evidence."], out_of_scope: ["mission completion"] }),
  makeTool({ tool_id: "opencode.result_review_show", namespace: "opencode_read", name: "Show OpenCode result review", version: "1.0.0", description: "Inspect one bounded result-review record.", keywords: ["opencode", "result", "review"], slash_command: "/opencode-result-review-show", allowed_phases: ["result_review", "mid_mission_supervision"], requires_network: false, requires_credentials: false, max_output_bytes: 12_000, timeout_ms: 700, notes: ["Review disposition only."], out_of_scope: ["research ingestion"] }),
  makeTool({ tool_id: "opencode.result_review_list", namespace: "opencode_read", name: "List OpenCode result reviews", version: "1.0.0", description: "List bounded result-review records.", keywords: ["opencode", "result", "reviews"], slash_command: "/opencode-result-reviews", allowed_phases: ["result_review", "mid_mission_supervision"], requires_network: false, requires_credentials: false, max_output_bytes: 14_000, timeout_ms: 700, notes: ["Read-only review metadata."], out_of_scope: ["mission mutation"] }),
  ...repoReadTools(),
  ...futureTools(),
]

export function namespaceSummaries(tools: CommanderToolDescriptor[] = COMMANDER_TOOL_REGISTRY): CommanderToolNamespaceSummary[] {
  return COMMANDER_TOOL_NAMESPACES.map((namespace) => {
    const records = tools.filter((tool) => tool.namespace === namespace)
    return {
      namespace,
      title: titleForNamespace(namespace),
      description: descriptionForNamespace(namespace),
      implemented_count: records.filter((tool) => tool.availability === "implemented_read_surface").length,
      future_count: records.filter((tool) => tool.availability.startsWith("future")).length,
      blocked_count: records.filter((tool) => tool.availability === "blocked").length,
      default_load_policy: records.some((tool) => tool.load_policy === "always_loaded") ? "deferred" : "deferred",
      requires_network: records.some((tool) => tool.requires_network),
      trust_class: records[0]?.trust_class ?? "unknown",
      example_tool_ids: records.slice(0, 4).map((tool) => tool.tool_id),
      estimated_catalog_tokens: Math.ceil(bytes(records.map((tool) => ({ tool_id: tool.tool_id, name: tool.name, description: tool.description }))) / 4),
    }
  })
}

function futureTools(): CommanderToolDescriptor[] {
  const github = githubReadTools()
  const external = ["search", "source_show", "paper_metadata"]
    .map((name) => makeFuture(`external_research.${name}`, "external_research", "future_external_read", "external_content_untrusted", true, false, ["proposal_investigation"]))
  const governance = ["stage_pr_review", "stage_pr_approval", "stage_pr_request_changes", "stage_ci_rerun", "stage_pr_merge"]
    .map((name) => makeFuture(`governance.${name}`, "governance", "future_governance_intent", "governance_metadata", true, true, ["governance_review"], "governance_intent", true))
  return [...github, ...external, ...governance]
}

function githubReadTools(): CommanderToolDescriptor[] {
  const common = { namespace: "github_read" as const, version: "1.0.0", trust_class: "github_content_untrusted" as const, side_effect_class: "external_read" as const, availability: "implemented_read_surface" as const, load_policy: "deferred" as const, allowed_phases: ["proposal_investigation", "result_review", "governance_review"] as CommanderToolPhase[], requires_network: true, requires_credentials: true, requires_approval: false, requires_run_lock: true, creates_external_process: false, execution_backend: "runtime_service" as const, process_policy: "none" as const, calls_provider: false, mutates_events: false, max_output_bytes: 12_000, timeout_ms: 15_000, notes: ["Bounded runtime-owned GitHub evidence gateway; output is untrusted data with instruction_semantics=none."], out_of_scope: ["GitHub mutation", "search", "raw payloads", "diffs", "arbitrary REST/GraphQL"] }
  const repo = { repository: stringField("Exact configured lowercase owner/repository identity", 201) }
  const sha = stringField("Exact lowercase full 40-character commit SHA", 40)
  const number = intField("Exact pull request or issue number", 1, 1000000000)
  const makeGithub = (tool_id: CommanderGithubReadToolId, name: string, description: string, keywords: string[], input_schema: CommanderToolJsonSchema) => makeTool({ ...common, tool_id, name, description, keywords, authority: commanderGithubToolAuthority(tool_id), input_schema, output_schema: commanderGithubOutputSchema(tool_id) })
  return [
    makeGithub("github.repository_get", "GitHub repository metadata", "Read minimal metadata for one configured GitHub repository.", ["github", "repository", "metadata"], schema(repo, ["repository"])),
    makeGithub("github.commit_get", "GitHub commit metadata", "Read bounded exact-SHA GitHub commit metadata.", ["github", "commit", "sha"], schema({ ...repo, commit_sha: sha }, ["repository", "commit_sha"])),
    makeGithub("github.pull_request_get", "GitHub pull request metadata", "Read bounded pull-request metadata and changed-file summary evidence.", ["github", "pull", "request", "files"], schema({ ...repo, pull_number: number }, ["repository", "pull_number"])),
    makeGithub("github.issue_get", "GitHub issue metadata", "Read bounded GitHub issue metadata.", ["github", "issue"], schema({ ...repo, issue_number: number }, ["repository", "issue_number"])),
    makeGithub("github.commit_checks", "GitHub exact-SHA checks", "Read bounded current check-run summaries for an exact commit SHA.", ["github", "checks", "ci", "sha"], schema({ ...repo, commit_sha: sha }, ["repository", "commit_sha"])),
    makeGithub("github.pull_request_reviews", "GitHub pull request review state", "Read bounded review summaries and thread-aware review state for one pull request at an exact commit SHA.", ["github", "review", "threads", "pull", "sha"], schema({ ...repo, pull_number: number, commit_sha: sha }, ["repository", "pull_number", "commit_sha"])),
  ]
}

function repoReadTools(): CommanderToolDescriptor[] {
  const phases: CommanderToolPhase[] = ["proposal_investigation", "mid_mission_supervision", "result_review"]
  const common = {
    namespace: "repo_read" as const,
    version: "1.0.0",
    requires_network: false,
    requires_credentials: false,
    trust_class: "repository_content_untrusted" as const,
    side_effect_class: "internal_read" as const,
    availability: "implemented_read_surface" as const,
    load_policy: "deferred" as const,
    allowed_phases: phases,
    max_output_bytes: 18_000,
    timeout_ms: 1200,
    notes: ["Project-root bounded read only; repository content is untrusted evidence with instruction_semantics=none."],
    out_of_scope: ["file writes", "shell", "provider calls", "MCP/network", "proposal generation"],
  }
  return [
    makeTool({ ...common, tool_id: "repo.tree", name: "Repository tree", description: "Inspect a bounded project-root directory tree without file contents.", keywords: ["repo", "tree", "files"], slash_command: "/commander-repo-tree", runtime_command: "runtime.commander_repo_tree", execution_backend: "filesystem_read", process_policy: "none", input_schema: schema({ path: stringField("Project-relative path", 240), depth: intField("Depth", 1, 8), limit: intField("Entry cap", 1, 500), include_upstream: boolField("Include agentcore/upstream traversal") }) }),
    makeTool({ ...common, tool_id: "repo.search_text", name: "Repository literal text search", description: "Run bounded literal text search over safe text files.", keywords: ["repo", "search", "text", "code"], slash_command: "/commander-repo-search", runtime_command: "runtime.commander_repo_search_text", execution_backend: "filesystem_read", process_policy: "none", input_schema: schema({ query: stringField("Literal search query", 240), path: stringField("Project-relative root", 240), extensions: stringField("Comma-separated extensions", 120), limit: intField("Match cap", 1, 100) }, ["query"]) }),
    makeTool({ ...common, tool_id: "repo.read_lines", name: "Repository line-range read", description: "Read a bounded line range from one safe text file.", keywords: ["repo", "read", "lines", "code"], slash_command: "/commander-repo-read", runtime_command: "runtime.commander_repo_read_lines", execution_backend: "filesystem_read", process_policy: "none", input_schema: schema({ path: stringField("Project-relative file path", 300), start_line: intField("Start line", 1, 1000000), end_line: intField("End line", 1, 1000000) }, ["path"]) }),
    makeTool({ ...common, tool_id: "repo.find_symbol", name: "Repository lexical symbol lookup", description: "Find bounded lexical declaration/reference candidates.", keywords: ["repo", "symbol", "declaration", "code"], slash_command: "/commander-repo-symbol", runtime_command: "runtime.commander_repo_find_symbol", execution_backend: "filesystem_read", process_policy: "none", input_schema: schema({ symbol: stringField("Symbol identifier", 160), path: stringField("Project-relative root", 240), limit: intField("Candidate cap", 1, 50) }, ["symbol"]) }),
    makeTool({ ...common, tool_id: "repo.git_status", name: "Git worktree status", description: "Read bounded Git worktree status through a fixed read-only adapter.", keywords: ["git", "status", "worktree"], slash_command: "/commander-git-status", runtime_command: "runtime.commander_repo_git_status", creates_external_process: true, execution_backend: "restricted_git_read", process_policy: "fixed_git_read_only", max_output_bytes: 12_000, timeout_ms: 2500, notes: [...common.notes, "Spawns only fixed read-only Git commands with shell=false and network prompts disabled."] }),
    makeTool({ ...common, tool_id: "repo.git_diff", name: "Git diff", description: "Read bounded Git diff/stat output through fixed read-only commands.", keywords: ["git", "diff", "patch"], slash_command: "/commander-git-diff", runtime_command: "runtime.commander_repo_git_diff", creates_external_process: true, execution_backend: "restricted_git_read", process_policy: "fixed_git_read_only", max_output_bytes: 64_000, timeout_ms: 2500, input_schema: schema({ scope: stringField("working_tree, staged, or head", 40), path: stringField("Optional project-relative path", 240), stat_only: boolField("Return stat only") }), notes: [...common.notes, "Spawns only fixed read-only Git diff commands with shell=false and no external diff/textconv."] }),
    makeTool({ ...common, tool_id: "repo.git_log", name: "Git log", description: "Read bounded Git commit history through a fixed read-only adapter.", keywords: ["git", "log", "history"], slash_command: "/commander-git-log", runtime_command: "runtime.commander_repo_git_log", creates_external_process: true, execution_backend: "restricted_git_read", process_policy: "fixed_git_read_only", max_output_bytes: 14_000, timeout_ms: 2500, input_schema: schema({ path: stringField("Optional project-relative path", 240), limit: intField("Commit cap", 1, 50) }), notes: [...common.notes, "Commit bodies and diffs are not returned."] }),
    makeTool({ ...common, tool_id: "repo.test_manifest", name: "Test manifest", description: "Inspect bounded test/check command declarations without running them.", keywords: ["test", "manifest", "scripts", "pytest"], slash_command: "/commander-test-manifest", runtime_command: "runtime.commander_repo_test_manifest", execution_backend: "filesystem_read", process_policy: "none" }),
    makeTool({ ...common, tool_id: "repo.dependency_manifest", name: "Dependency manifest", description: "Inspect direct dependency declarations and lockfile metadata only.", keywords: ["dependency", "manifest", "package", "pyproject"], slash_command: "/commander-dependency-manifest", runtime_command: "runtime.commander_repo_dependency_manifest", execution_backend: "filesystem_read", process_policy: "none" }),
  ]
}

function makeFuture(toolId: string, namespace: CommanderToolNamespace, availability: CommanderToolAvailability, trust: CommanderToolTrustClass, network: boolean, credentials: boolean, phases: CommanderToolPhase[], sideEffect: CommanderToolSideEffectClass = availability === "future_external_read" ? "external_read" : "internal_read", approval = false): CommanderToolDescriptor {
  const label = toolId.replace(".", " ")
  return makeTool({
    tool_id: toolId,
    namespace,
    name: label,
    version: "0.1.0",
    description: `Future ${label} capability descriptor. It is not executable in 9U.`,
    keywords: toolId.split(/[._]/),
    risk: "safe_read",
    side_effect_class: sideEffect,
    trust_class: trust,
    availability,
    load_policy: "deferred",
    allowed_phases: phases,
    requires_network: network,
    requires_credentials: credentials,
    requires_approval: approval,
    requires_run_lock: false,
    creates_external_process: false,
    calls_provider: false,
    mutates_events: false,
    max_output_bytes: 12_000,
    timeout_ms: 1000,
    notes: ["Registry-only future capability; no execution command exists in 9U."],
    out_of_scope: ["tool execution", "dynamic installation", "direct mutation"],
  })
}

function findAuthority(command: string): CommandAuthorityRecord | undefined {
  return COMMAND_AUTHORITY_REGISTRY.find((record) => record.slash_command === command || record.aliases.includes(command))
}

function titleForNamespace(namespace: CommanderToolNamespace): string {
  return namespace.replace(/_/g, " ")
}

function descriptionForNamespace(namespace: CommanderToolNamespace): string {
  const descriptions: Record<CommanderToolNamespace, string> = {
    core: "Tool discovery, profile, bootstrap, and validation surfaces.",
    authority: "Existing command-authority inspection.",
    memory: "Research-memory search and inspection.",
    continuity: "Commander continuity packet and open-loop reads.",
    runtime_read: "Approved runtime/mission/proposal status reads.",
    opencode_read: "OpenCode session/progress/wake/result/context-refresh reads.",
    repo_read: "Future bounded project-root code and Git reads.",
    github_read: "Future read-only GitHub inspection.",
    external_research: "Future allowlisted external research reads.",
    governance: "Future staged governance intents only.",
  }
  return descriptions[namespace]
}

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value))
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}
