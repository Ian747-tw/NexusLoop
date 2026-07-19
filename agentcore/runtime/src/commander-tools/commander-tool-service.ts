import { createHash } from "node:crypto"
import { COMMAND_AUTHORITY_REGISTRY } from "../authority/command-authority-registry"
import type { CommandAuthorityRisk } from "../authority/command-authority-types"
import type { ContextBudgetService } from "../context/context-budget-service"
import { redactText } from "../security/redaction"
import { COMMANDER_TOOL_NAMESPACES, COMMANDER_TOOL_PHASES, COMMANDER_TOOL_REGISTRY, namespaceSummaries } from "./commander-tool-registry"
import type {
  CommanderToolAvailability,
  CommanderToolBootstrapPreview,
  CommanderToolDescriptor,
  CommanderToolDescriptorSummary,
  CommanderToolListInput,
  CommanderToolNamespace,
  CommanderToolPhase,
  CommanderToolProfile,
  CommanderToolRegistrySummary,
  CommanderToolRegistryValidation,
  CommanderToolSearchInput,
  CommanderToolSearchMatch,
  CommanderToolSearchPreview,
  CommanderToolSideEffectClass,
} from "./commander-tool-types"

const CORE_ORDER = ["commander.tool_search", "commander.tool_get", "commander.tool_profile", "authority.describe"]
const FORBIDDEN_PATTERNS = [/shell/i, /(^|\.)[a-z0-9_]*(write|edit|patch|commit|push)[a-z0-9_]*$/i, /^github\.(merge|approve|request_changes|write_file|create_commit|push)$/i, /^process\.(kill|stop)$/i, /^opencode\.prompt_send$/i, /^provider\.call$/i, /^mcp\.(install|execute_arbitrary)$/i]

export type CommanderToolServiceOptions = {
  contextBudgetService: ContextBudgetService
  now?: () => Date
  tools?: CommanderToolDescriptor[]
}

export class CommanderToolService {
  private readonly now: () => Date
  private readonly tools: CommanderToolDescriptor[]

  constructor(private readonly options: CommanderToolServiceOptions) {
    this.now = options.now ?? (() => new Date())
    this.tools = options.tools ?? COMMANDER_TOOL_REGISTRY
  }

  summary(): CommanderToolRegistrySummary {
    const generatedAt = this.now().toISOString()
    return {
      total_tools: this.tools.length,
      implemented_tools: this.tools.filter((tool) => tool.availability === "implemented_read_surface").length,
      future_tools: this.tools.filter((tool) => tool.availability.startsWith("future")).length,
      blocked_tools: this.tools.filter((tool) => tool.availability === "blocked").length,
      namespace_counts: countBy(this.tools, "namespace"),
      risk_counts: countBy(this.tools, "risk"),
      side_effect_counts: countBy(this.tools, "side_effect_class"),
      always_loaded_count: this.tools.filter((tool) => tool.load_policy === "always_loaded").length,
      deferred_count: this.tools.filter((tool) => tool.load_policy === "deferred").length,
      governance_intent_count: this.tools.filter((tool) => tool.side_effect_class === "governance_intent").length,
      direct_external_write_count: this.tools.filter((tool) => tool.side_effect_class === "approved_external_write").length,
      provider_call_count: this.tools.filter((tool) => tool.calls_provider).length,
      generated_at: generatedAt,
    }
  }

  list(input: CommanderToolListInput = {}): CommanderToolDescriptorSummary[] {
    const filters = readCommanderToolListInput(input)
    const limit = filters.limit ?? 20
    return this.filterTools(filters).slice(0, limit).map((tool) => summarizeTool(tool))
  }

  get(input: { tool_id?: string; include_schema?: boolean } = {}): CommanderToolDescriptor {
    const toolId = requiredToolId(input.tool_id)
    const found = this.tools.find((tool) => tool.tool_id === toolId)
    if (!found) throw new Error("commander tool_id was not found")
    return input.include_schema === false ? stripSchema(found) as CommanderToolDescriptor : markSchemaLoaded(found)
  }

  search(input: CommanderToolSearchInput = {}): CommanderToolSearchPreview {
    const generatedAt = this.now().toISOString()
    const query = optionalString(input.query)
    const blockers: string[] = []
    if (!query) blockers.push("commander tool search requires query")
    const parsed = readCommanderToolSearchInput(input)
    const includeSchema = parsed.include_schema === true
    const limit = includeSchema ? Math.min(parsed.limit ?? 10, 3) : parsed.limit ?? 10
    const scored = query ? this.filterTools(parsed).map((tool) => scoreTool(tool, query, parsed.phase)).filter((match) => match.score > 0) : []
    scored.sort((a, b) => b.score - a.score || a.tool_id.localeCompare(b.tool_id))
    const matches = scored.slice(0, limit).map((match) => includeSchema ? { ...match, descriptor: markSchemaLoaded(this.requireTool(match.tool_id)), schema_loaded: true } : match)
    const schemaBytes = matches.reduce((sum, match) => sum + (match.descriptor ? match.descriptor.schema_metadata.input_schema_bytes + match.descriptor.schema_metadata.output_schema_bytes : 0), 0)
    const result: CommanderToolSearchPreview = {
      preview_id: `commander_tool_search_${hash({ query, parsed, matches: matches.map((item) => item.tool_id) }).slice(0, 16)}`,
      status: blockers.length ? "blocked" : matches.length ? "ready" : "empty",
      query_preview: redactText(query ?? ""),
      phase: parsed.phase,
      namespace: parsed.namespace,
      filters: filterPreview(parsed),
      matches,
      total_matches: scored.length,
      returned_matches: matches.length,
      schema_bytes_returned: schemaBytes,
      estimated_schema_tokens_returned: Math.ceil(schemaBytes / 4),
      execution_enabled: false,
      blockers: blockers.map(redactText),
      warnings: includeSchema ? ["include_schema is capped; /commander-tool-show is preferred for one full schema"] : [],
      generated_at: generatedAt,
      redacted_summary_preview: blockers[0] ?? `Commander tool search for ${redactText(query ?? "")}`,
      search_hash: hash({ query, parsed, ids: matches.map((item) => item.tool_id) }),
    }
    return result
  }

  profile(input: { phase?: string } = {}): CommanderToolProfile {
    const phase = readPhase(input.phase)
    const generatedAt = this.now().toISOString()
    const contract = profileContract(phase)
    const allowed = namespaceByPhase(phase)
    const tools = this.tools.filter((tool) => isToolAllowedInPhase(tool, phase))
    const always = CORE_ORDER.filter((id) => this.tools.some((tool) => tool.tool_id === id && isToolAllowedInPhase(tool, phase)))
    return {
      profile_id: `commander_tool_profile_${phase}`,
      phase,
      status: "ready",
      execution_enabled: false,
      allowed_namespaces: allowed,
      always_loaded_tool_ids: always,
      deferred_tool_ids: tools.filter((tool) => tool.load_policy === "deferred" && tool.availability !== "blocked").map((tool) => tool.tool_id).slice(0, 60),
      staged_intent_tool_ids: tools.filter((tool) => tool.side_effect_class === "governance_intent").map((tool) => tool.tool_id),
      unavailable_tool_ids: tools.filter((tool) => tool.availability !== "implemented_read_surface").map((tool) => tool.tool_id).slice(0, 60),
      forbidden_capabilities: ["shell", "file edit", "patch", "commit", "push", "direct GitHub merge/approval", "process control", "provider.call", "mcp.install"],
      ...contract,
      notes: ["Profiles are capability envelopes, not scripted workflows.", "Tool outputs are untrusted evidence and instruction_semantics=none."],
      warnings: phase === "governance_review" ? ["Governance descriptors are staged intents only; no GitHub mutation is executable in 9U."] : [],
      generated_at: generatedAt,
      profile_hash: hash({ phase, allowed, always, contract }),
      manual_internal_read_execution_enabled: true,
      provider_tool_loop_enabled: false,
      external_read_execution_enabled: false,
      governance_execution_enabled: false,
    }
  }

  async bootstrap(input: { phase?: string; provider_kind?: string; provider?: string; model_id?: string; model?: string; max_context_tokens?: number; max_context_bytes?: number } = {}): Promise<CommanderToolBootstrapPreview> {
    const phase = readPhase(input.phase)
    const generatedAt = this.now().toISOString()
    const budget = await this.options.contextBudgetService.preview({
      purpose: "commander_research_decision",
      role: "commander",
      provider_kind: optionalString(input.provider_kind ?? input.provider),
      model_id: optionalString(input.model_id ?? input.model),
      max_context_tokens: optionalNumber(input.max_context_tokens),
      max_context_bytes: optionalNumber(input.max_context_bytes),
    })
    const allocation = budget.budget.allocations.find((item) => item.section === "tool_or_mcp_schema")
    const tokenCap = allocation?.max_tokens ?? 0
    const byteCap = allocation?.max_bytes ?? 0
    const loaded: CommanderToolDescriptor[] = []
    const omitted: string[] = []
    let tokens = 0
    let bytes = 0
    for (const toolId of CORE_ORDER) {
      const tool = this.tools.find((item) => item.tool_id === toolId && isToolAllowedInPhase(item, phase))
      if (!tool) continue
      const toolBytes = tool.schema_metadata.input_schema_bytes + tool.schema_metadata.output_schema_bytes
      const toolTokens = tool.schema_metadata.estimated_schema_tokens
      if ((tokenCap && tokens + toolTokens > tokenCap) || (byteCap && bytes + toolBytes > byteCap)) {
        if (toolId === "commander.tool_search" && loaded.length === 0) {
          loaded.push(markSchemaLoaded(tool))
          tokens += toolTokens
          bytes += toolBytes
        } else {
          omitted.push(toolId)
        }
        continue
      }
      loaded.push(markSchemaLoaded(tool))
      tokens += toolTokens
      bytes += toolBytes
    }
    const eligibleTools = this.tools.filter((tool) => isToolAllowedInPhase(tool, phase))
    const loadedToolIds = new Set(loaded.map((tool) => tool.tool_id))
    const deferredTools = eligibleTools.filter((tool) => tool.load_policy === "deferred" && !loadedToolIds.has(tool.tool_id))
    const deferred = namespaceSummaries(deferredTools).filter((item) => namespaceByPhase(phase).includes(item.namespace) && namespaceSummaryHasRecords(item))
    return {
      preview_id: `commander_tool_bootstrap_${hash({ phase, loaded: loaded.map((tool) => tool.tool_id), budget: budget.budget.budget_id }).slice(0, 16)}`,
      phase,
      provider_kind: budget.capability?.provider_kind ?? optionalString(input.provider_kind ?? input.provider) ?? "unknown",
      model_id: budget.capability?.model_id ?? optionalString(input.model_id ?? input.model) ?? "unknown",
      context_budget_id: budget.budget.budget_id,
      tool_schema_allocation_tokens: allocation?.max_tokens,
      tool_schema_allocation_bytes: allocation?.max_bytes,
      always_loaded_tools: loaded,
      deferred_namespaces: deferred,
      deferred_tool_count: eligibleTools.filter((tool) => tool.load_policy === "deferred").length,
      initial_schema_tokens: tokens,
      initial_schema_bytes: bytes,
      over_budget: Boolean((tokenCap && tokens > tokenCap) || (byteCap && bytes > byteCap)),
      omitted_core_tools: omitted,
      execution_enabled: false,
      manual_internal_read_execution_enabled: true,
      provider_tool_loop_enabled: false,
      external_read_execution_enabled: false,
      governance_execution_enabled: false,
      blockers: budget.blockers,
      warnings: [...budget.warnings, "bootstrap preview does not execute Commander tools, call providers, call MCPs, or read repositories"],
      generated_at: generatedAt,
      redacted_summary_preview: `Commander ${phase} bootstrap catalog with ${loaded.length} loaded schemas`,
      bootstrap_hash: hash({ phase, loaded: loaded.map((tool) => tool.tool_id), omitted, budget: budget.budget.budget_id }),
    }
  }

  validate(tools: CommanderToolDescriptor[] = this.tools): CommanderToolRegistryValidation {
    const generatedAt = this.now().toISOString()
    const errors: string[] = []
    const warnings: string[] = []
    const invalid = new Set<string>()
    const seen = new Set<string>()
    let authorityMismatch = 0
    let schemaViolation = 0
    let unsafe = 0
    for (const tool of tools) {
      if (seen.has(tool.tool_id)) mark(tool.tool_id, "duplicate Commander tool_id")
      seen.add(tool.tool_id)
      if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(tool.tool_id)) mark(tool.tool_id, "tool_id must be lowercase namespace-qualified identifier")
      if (!COMMANDER_TOOL_NAMESPACES.includes(tool.namespace)) mark(tool.tool_id, "unknown namespace")
      if (tool.allowed_phases.length === 0 || tool.allowed_phases.some((phase) => !COMMANDER_TOOL_PHASES.includes(phase))) mark(tool.tool_id, "descriptor allowed_phases must contain known Commander phases")
      if (!tool.version || tool.input_schema?.schema_version !== "nxl-commander-tool-v1" || tool.output_schema?.schema_version !== "nxl-commander-tool-v1") {
        schemaViolation += 1
        mark(tool.tool_id, "schema version is missing or unsupported")
      }
      if (tool.instruction_semantics !== "none") mark(tool.tool_id, "instruction_semantics must be none")
      if (FORBIDDEN_PATTERNS.some((pattern) => pattern.test(tool.tool_id))) mark(tool.tool_id, "forbidden direct tool capability is exposed")
      if (tool.availability === "implemented_read_surface") {
        const authority = tool.slash_command ? authorityFor(tool.slash_command) : undefined
        if (!authority || !tool.authority_id || authority.authority_id !== tool.authority_id) {
          authorityMismatch += 1
          mark(tool.tool_id, "implemented descriptor must map to an exact authority record")
        } else {
          if (authority.risk !== tool.risk || authority.risk !== "safe_read") {
            authorityMismatch += 1
            mark(tool.tool_id, "implemented descriptor risk must match safe_read authority")
          }
          if (authority.runtime_command !== tool.runtime_command) {
            authorityMismatch += 1
            mark(tool.tool_id, "implemented descriptor runtime command must match authority record")
          }
          const allowGitProcess = isAllowedGitProcessDescriptor(tool, authority)
          for (const [field, expected] of Object.entries({ mutates_events: false, creates_external_process: false, calls_provider: false, requires_approval: false, requires_run_lock: false, requires_network: false, requires_credentials: false }) as Array<[keyof CommanderToolDescriptor, false]>) {
            if (field === "creates_external_process" && allowGitProcess) continue
            if (tool[field] !== expected) {
              unsafe += 1
              mark(tool.tool_id, `implemented descriptor has unsafe ${field}`)
            }
          }
          if (tool.creates_external_process && !allowGitProcess) {
            unsafe += 1
            mark(tool.tool_id, "process-backed implemented descriptor is not an allowed fixed Git read tool")
          }
          if (allowGitProcess && (tool.execution_backend !== "restricted_git_read" || tool.process_policy !== "fixed_git_read_only" || authority.creates_external_process !== true)) {
            unsafe += 1
            mark(tool.tool_id, "Git read descriptor must use restricted_git_read/fixed_git_read_only and matching authority process metadata")
          }
        }
      }
      if (tool.availability !== "implemented_read_surface" && (tool.runtime_command || tool.slash_command)) mark(tool.tool_id, "future descriptor must not pretend to be executable")
      if (tool.side_effect_class === "approved_external_write") mark(tool.tool_id, "approved external write tools are not exposed in 9U")
      if (tool.calls_provider) mark(tool.tool_id, "provider execution tool is exposed")
    }
    for (const phase of COMMANDER_TOOL_PHASES) {
      const profile = this.profile({ phase })
      for (const toolId of profile.always_loaded_tool_ids) {
        const tool = tools.find((item) => item.tool_id === toolId)
        if (!tool || !isToolAllowedInPhase(tool, phase)) mark(toolId, `always-loaded tool is not valid for phase ${phase}`)
      }
      if (profile.always_loaded_tool_ids.length > 4) errors.push(`phase ${phase} has too many always-loaded tools`)
    }
    function mark(toolId: string, message: string) {
      invalid.add(toolId)
      errors.push(`${toolId}: ${message}`)
    }
    return {
      validation_id: `commander_tool_validation_${hash({ errors, warnings }).slice(0, 16)}`,
      status: errors.length ? "blocked" : "ready",
      descriptor_count: tools.length,
      profile_count: COMMANDER_TOOL_PHASES.length,
      namespace_count: COMMANDER_TOOL_NAMESPACES.length,
      errors: errors.map(redactText),
      warnings: warnings.map(redactText),
      invalid_tool_ids: Array.from(invalid).slice(0, 50),
      invalid_profile_ids: errors.filter((error) => error.includes("phase ")).slice(0, 20),
      unsafe_exposure_count: unsafe,
      authority_mismatch_count: authorityMismatch,
      schema_violation_count: schemaViolation,
      generated_at: generatedAt,
      redacted_summary_preview: errors.length ? "Commander tool registry validation blocked" : "Commander tool registry validation ready",
      validation_hash: hash({ errors, warnings, count: tools.length }),
    }
  }

  private requireTool(toolId: string): CommanderToolDescriptor {
    const tool = this.tools.find((item) => item.tool_id === toolId)
    if (!tool) throw new Error("commander tool_id was not found")
    return tool
  }

  private filterTools(input: CommanderToolListInput | CommanderToolSearchInput): CommanderToolDescriptor[] {
    const applyPhaseFilter = !("query" in input) || input.allowed_in_phase_only !== false
    return this.tools
      .filter((tool) => !applyPhaseFilter || !input.phase || isToolAllowedInPhase(tool, input.phase))
      .filter((tool) => !input.namespace || tool.namespace === input.namespace)
      .filter((tool) => !input.risk || tool.risk === input.risk)
      .filter((tool) => !input.side_effect_class || tool.side_effect_class === input.side_effect_class)
      .filter((tool) => !input.availability || tool.availability === input.availability)
      .filter((tool) => !input.implemented_only || tool.availability === "implemented_read_surface")
  }
}

export function readCommanderToolListInput(input: Record<string, unknown> = {}): CommanderToolListInput {
  return {
    phase: optionalPhase(input.phase),
    namespace: optionalNamespace(input.namespace),
    risk: optionalRisk(input.risk),
    side_effect_class: optionalSideEffect(input.sideEffectClass ?? input.side_effect_class),
    availability: optionalAvailability(input.availability),
    implemented_only: optionalBoolean(input.implementedOnly ?? input.implemented_only),
    limit: optionalLimit(input.limit, 50),
  }
}

export function readCommanderToolSearchInput(input: Record<string, unknown> = {}): CommanderToolSearchInput {
  return {
    ...readCommanderToolListInput(input),
    query: optionalString(input.query),
    allowed_in_phase_only: optionalBoolean(input.allowedInPhaseOnly ?? input.allowed_in_phase_only),
    include_schema: optionalBoolean(input.includeSchema ?? input.include_schema),
    limit: optionalLimit(input.limit, 20),
  }
}

export function readCommanderToolGetInput(input: Record<string, unknown> = {}): { tool_id?: string; include_schema?: boolean } {
  return {
    tool_id: optionalString(input.toolId ?? input.tool_id ?? input.id),
    include_schema: optionalBoolean(input.includeSchema ?? input.include_schema),
  }
}

function summarizeTool(tool: CommanderToolDescriptor): CommanderToolDescriptorSummary {
  const stripped = stripSchema(tool)
  return {
    ...stripped,
    input_field_names: Object.keys(tool.input_schema?.properties ?? {}),
    output_field_names: Object.keys(tool.output_schema?.properties ?? {}),
  }
}

function stripSchema(tool: CommanderToolDescriptor): CommanderToolDescriptor {
  const { input_schema: _input, output_schema: _output, ...rest } = tool
  return { ...rest, schema_metadata: { ...tool.schema_metadata, schema_loaded: false } }
}

function markSchemaLoaded(tool: CommanderToolDescriptor): CommanderToolDescriptor {
  return { ...tool, schema_metadata: { ...tool.schema_metadata, schema_loaded: true } }
}

function scoreTool(tool: CommanderToolDescriptor, query: string, phase?: CommanderToolPhase): CommanderToolSearchMatch {
  const terms = tokenize(query)
  const matchedFields = new Set<string>()
  let score = 0
  if (tool.tool_id === query) { score += 100; matchedFields.add("tool_id") }
  if (tool.name.toLowerCase() === query.toLowerCase()) { score += 80; matchedFields.add("name") }
  if (tool.namespace === query) { score += 40; matchedFields.add("namespace") }
  for (const term of terms) {
    if (tool.tool_id.includes(term)) { score += 16; matchedFields.add("tool_id") }
    if (tool.name.toLowerCase().includes(term)) { score += 12; matchedFields.add("name") }
    if (tool.namespace.includes(term)) { score += 10; matchedFields.add("namespace") }
    if (tool.keywords.some((keyword) => keyword.includes(term))) { score += 8; matchedFields.add("keywords") }
    if (tool.description.toLowerCase().includes(term)) { score += 4; matchedFields.add("description") }
  }
  const allowed = phase ? isToolAllowedInPhase(tool, phase) : true
  if (matchedFields.size > 0) {
    if (allowed) score += 3
    if (tool.availability === "implemented_read_surface") score += 2
  }
  return {
    tool_id: tool.tool_id,
    namespace: tool.namespace,
    name: tool.name,
    description_preview: preview(tool.description),
    availability: tool.availability,
    risk: tool.risk,
    side_effect_class: tool.side_effect_class,
    load_policy: tool.load_policy,
    allowed_in_phase: allowed,
    score,
    matched_fields: Array.from(matchedFields).sort(),
    schema_loaded: false,
    input_field_names: Object.keys(tool.input_schema?.properties ?? {}),
    output_field_names: Object.keys(tool.output_schema?.properties ?? {}),
    schema_hash: tool.schema_metadata.input_schema_hash,
    recommended_command: `/commander-tool-show ${tool.tool_id}`,
  }
}

export function isToolAllowedInPhase(tool: CommanderToolDescriptor, phase: CommanderToolPhase): boolean {
  return namespaceByPhase(phase).includes(tool.namespace) && tool.allowed_phases.includes(phase)
}

export function namespaceByPhase(phase: CommanderToolPhase): CommanderToolNamespace[] {
  switch (phase) {
    case "proposal_investigation":
      return ["core", "authority", "memory", "continuity", "runtime_read", "opencode_read", "repo_read", "github_read", "external_research"]
    case "mid_mission_supervision":
      return ["core", "authority", "continuity", "opencode_read", "memory", "runtime_read", "repo_read"]
    case "result_review":
      return ["core", "authority", "continuity", "opencode_read", "memory", "runtime_read", "repo_read", "github_read"]
    case "governance_review":
      return ["core", "authority", "runtime_read", "opencode_read", "github_read", "governance"]
    case "emergency_inspection":
      return ["core", "authority", "continuity", "runtime_read", "opencode_read"]
    case "general_read":
    default:
      return ["core", "authority", "memory", "continuity", "runtime_read", "opencode_read"]
  }
}

function profileContract(phase: CommanderToolPhase) {
  const map: Record<CommanderToolPhase, { max_tool_calls_future: number; max_tool_search_calls_future: number; max_loaded_schemas: number }> = {
    general_read: { max_tool_calls_future: 16, max_tool_search_calls_future: 4, max_loaded_schemas: 8 },
    proposal_investigation: { max_tool_calls_future: 24, max_tool_search_calls_future: 6, max_loaded_schemas: 12 },
    mid_mission_supervision: { max_tool_calls_future: 16, max_tool_search_calls_future: 4, max_loaded_schemas: 8 },
    result_review: { max_tool_calls_future: 20, max_tool_search_calls_future: 5, max_loaded_schemas: 10 },
    governance_review: { max_tool_calls_future: 16, max_tool_search_calls_future: 4, max_loaded_schemas: 8 },
    emergency_inspection: { max_tool_calls_future: 10, max_tool_search_calls_future: 2, max_loaded_schemas: 6 },
  }
  return { ...map[phase], max_initial_schema_tokens: 1200, max_initial_schema_bytes: 4800, max_cumulative_result_bytes_future: 96_000, max_wall_time_ms_future: 120_000 }
}

function authorityFor(command: string) {
  return COMMAND_AUTHORITY_REGISTRY.find((record) => record.slash_command === command || record.aliases.includes(command))
}

function isAllowedGitProcessDescriptor(tool: CommanderToolDescriptor, authority: { creates_external_process: boolean } | undefined): boolean {
  return tool.namespace === "repo_read"
    && ["repo.git_status", "repo.git_diff", "repo.git_log"].includes(tool.tool_id)
    && tool.execution_backend === "restricted_git_read"
    && tool.process_policy === "fixed_git_read_only"
    && tool.side_effect_class === "internal_read"
    && tool.risk === "safe_read"
    && tool.requires_network === false
    && tool.requires_credentials === false
    && tool.mutates_events === false
    && tool.calls_provider === false
    && tool.requires_approval === false
    && tool.requires_run_lock === false
    && authority?.creates_external_process === true
}

function countBy<T extends Record<string, unknown>>(items: T[], key: keyof T): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) counts[String(item[key])] = (counts[String(item[key])] ?? 0) + 1
  return counts
}

function filterPreview(input: CommanderToolSearchInput): Record<string, string | boolean | number> {
  const out: Record<string, string | boolean | number> = {}
  for (const [key, value] of Object.entries(input)) if (value !== undefined && key !== "query") out[key] = value as string | boolean | number
  return out
}

function namespaceSummaryHasRecords(item: { implemented_count: number; future_count: number; blocked_count: number }): boolean {
  return item.implemented_count + item.future_count + item.blocked_count > 0
}

function readPhase(value: unknown): CommanderToolPhase {
  const phase = optionalPhase(value)
  if (!phase) throw new Error("commander tool phase is required")
  return phase
}

function requiredToolId(value: unknown): string {
  const text = optionalString(value)
  if (!text) throw new Error("commander tool_id is required")
  if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(text)) throw new Error("commander tool_id is unsupported")
  return text
}

function optionalPhase(value: unknown): CommanderToolPhase | undefined {
  const text = optionalString(value)
  if (!text) return undefined
  if (!COMMANDER_TOOL_PHASES.includes(text as CommanderToolPhase)) throw new Error("commander tool phase is unsupported")
  return text as CommanderToolPhase
}

function optionalNamespace(value: unknown): CommanderToolNamespace | undefined {
  const text = optionalString(value)
  if (!text) return undefined
  if (!COMMANDER_TOOL_NAMESPACES.includes(text as CommanderToolNamespace)) throw new Error("commander tool namespace is unsupported")
  return text as CommanderToolNamespace
}

function optionalAvailability(value: unknown): CommanderToolAvailability | undefined {
  const text = optionalString(value)
  if (!text) return undefined
  const allowed: CommanderToolAvailability[] = ["implemented_read_surface", "registry_only", "future_internal_read", "future_external_read", "future_governance_intent", "blocked"]
  if (!allowed.includes(text as CommanderToolAvailability)) throw new Error("commander tool availability is unsupported")
  return text as CommanderToolAvailability
}

function optionalSideEffect(value: unknown): CommanderToolSideEffectClass | undefined {
  const text = optionalString(value)
  if (!text) return undefined
  const allowed: CommanderToolSideEffectClass[] = ["none", "internal_read", "external_read", "governance_intent", "approved_external_write", "forbidden"]
  if (!allowed.includes(text as CommanderToolSideEffectClass)) throw new Error("commander tool side_effect_class is unsupported")
  return text as CommanderToolSideEffectClass
}

function optionalRisk(value: unknown): CommandAuthorityRisk | undefined {
  const text = optionalString(value)
  if (!text) return undefined
  const allowed: CommandAuthorityRisk[] = ["safe_read", "low_risk_write", "medium_risk_write", "high_impact_write", "unsupported", "unknown"]
  if (!allowed.includes(text as CommandAuthorityRisk)) throw new Error("commander tool risk is unsupported")
  return text as CommandAuthorityRisk
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value === "boolean") return value
  if (value === "true") return true
  if (value === "false") return false
  throw new Error("commander tool boolean filter is unsupported")
}

function optionalLimit(value: unknown, max: number): number | undefined {
  if (value === undefined) return undefined
  const number = typeof value === "number" ? value : Number(value)
  if (!Number.isInteger(number) || number < 1) throw new Error("commander tool limit must be a positive integer")
  return Math.min(number, max)
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined
  const number = typeof value === "number" ? value : Number(value)
  return Number.isFinite(number) ? number : undefined
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const redacted = redactText(value).trim()
  return redacted ? redacted.slice(0, 400) : undefined
}

function tokenize(value: string): string[] {
  return redactText(value).toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean).slice(0, 16)
}

function preview(value: string, max = 180): string {
  return redactText(value).replace(/\s+/g, " ").trim().slice(0, max)
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}
