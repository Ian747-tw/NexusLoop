import { createHash } from "node:crypto"
import { redactText } from "../security/redaction"
import type { OpenCodeSessionService } from "../opencode-session/opencode-session-service"
import { ModelCapabilityRegistry } from "./model-capability-registry"
import type { ModelCapability, ModelCapabilityRole } from "./model-capability-types"
import type {
  ContextBudgetAllocation,
  ContextBudgetPreview,
  ContextBudgetPreviewInput,
  ContextBudgetProfile,
  ContextBudgetPurpose,
  ContextBudgetSection,
  ContextBudgetSummary,
} from "./context-budget-types"

const CONSERVATIVE_CONTEXT_BYTES = 12_000
const CONSERVATIVE_CONTEXT_TOKENS = 3000
const MAX_CONTEXT_BYTES = 512_000
const MAX_CONTEXT_TOKENS = 128_000
const MIN_OUTPUT_TOKENS = 512

export type ContextBudgetServiceOptions = {
  registry: ModelCapabilityRegistry
  opencodeSessionService?: OpenCodeSessionService
  now?: () => Date
}

export class ContextBudgetService {
  private readonly now: () => Date

  constructor(private readonly options: ContextBudgetServiceOptions) {
    this.now = options.now ?? (() => new Date())
  }

  listModelCapabilities(input: { provider_kind?: string; role?: string; limit?: number } = {}): ModelCapability[] {
    return this.options.registry.list(input)
  }

  getModelCapability(input: { capability_id?: string; provider_kind?: string; model_id?: string } = {}): ModelCapability {
    return this.options.registry.get(input)
  }

  summary(): ContextBudgetSummary {
    return this.options.registry.summary(this.now())
  }

  async preview(input: ContextBudgetPreviewInput = {}): Promise<ContextBudgetPreview> {
    const generatedAt = this.now().toISOString()
    const purpose = readPurpose(input.purpose)
    const role = readRole(input.role, purpose)
    const providerKind = optional(input.provider_kind) ?? defaultProviderForPurpose(purpose)
    const modelId = optional(input.model_id) ?? defaultModelForPurpose(purpose)
    const capability = this.options.registry.get({ provider_kind: providerKind, model_id: modelId })
    const blockers: string[] = []
    if (purpose === "unknown") blockers.push("context budget preview requires a supported purpose")
    if (!capabilitySupportsRole(capability, role)) {
      blockers.push("selected model capability does not support requested role")
    }

    const sessionId = optional(input.session_id)
    const session = sessionId && this.options.opencodeSessionService ? await this.options.opencodeSessionService.get(sessionId) : null
    if (sessionId && !session) blockers.push("session_id was not found")
    const sessionMaxContextBytes = session?.max_context_bytes
    const explicitTokens = clampOptional(input.max_context_tokens, 1_000, MAX_CONTEXT_TOKENS)
    const explicitBytes = clampOptional(input.max_context_bytes, 1_000, MAX_CONTEXT_BYTES)
    const warnings = new Set<string>([
      ...capability.warnings,
      "budget preview does not compile context, call providers, launch OpenCode, query research.db, or mutate runtime state",
    ])

    let maxContextTokens = explicitTokens ?? capability.max_context_tokens
    let maxContextBytes = explicitBytes ?? capability.max_context_bytes
    if (!maxContextTokens && !maxContextBytes) {
      maxContextTokens = CONSERVATIVE_CONTEXT_TOKENS
      maxContextBytes = CONSERVATIVE_CONTEXT_BYTES
      warnings.add("unknown context window; using conservative budget")
    }
    if (maxContextTokens) maxContextTokens = Math.min(maxContextTokens, capability.max_context_tokens ?? MAX_CONTEXT_TOKENS, MAX_CONTEXT_TOKENS)
    if (maxContextBytes) maxContextBytes = Math.min(maxContextBytes, MAX_CONTEXT_BYTES)
    if (explicitTokens && capability.max_context_tokens && explicitTokens > capability.max_context_tokens) {
      maxContextTokens = capability.max_context_tokens
      warnings.add("model capability is lower than requested max_context_tokens; model budget wins")
    }
    if (explicitBytes && capability.max_context_bytes && explicitBytes > capability.max_context_bytes) {
      maxContextBytes = capability.max_context_bytes
      warnings.add("model capability is lower than requested max_context_bytes; model budget wins")
    }
    if (purpose === "opencode_executor_session" && sessionMaxContextBytes) {
      if (!maxContextBytes || sessionMaxContextBytes < maxContextBytes) {
        maxContextBytes = sessionMaxContextBytes
        const sessionDerivedTokens = Math.max(1, Math.floor(sessionMaxContextBytes / 4))
        maxContextTokens = maxContextTokens ? Math.min(maxContextTokens, sessionDerivedTokens) : sessionDerivedTokens
        warnings.add("planned session max_context_bytes constrains executor budget")
        warnings.add("planned session max_context_bytes constrains executor token budget")
      } else if (sessionMaxContextBytes > maxContextBytes) {
        warnings.add("model capability is lower than session max_context_bytes; model budget wins")
      }
    }

    const requestedOutputTokens = capability.max_output_tokens ?? Math.max(MIN_OUTPUT_TOKENS, Math.floor((maxContextTokens ?? CONSERVATIVE_CONTEXT_TOKENS) * 0.12))
    const maxOutputTokens = maxContextTokens
      ? Math.max(1, Math.min(requestedOutputTokens, Math.floor(maxContextTokens * 0.25)))
      : requestedOutputTokens
    if (maxOutputTokens < requestedOutputTokens) warnings.add("output reserve reduced to fit selected max_context_tokens")
    const safetyMarginTokens = maxContextTokens
      ? Math.min(Math.max(1, Math.floor(maxContextTokens * capability.safety_margin_ratio)), Math.max(0, maxContextTokens - maxOutputTokens))
      : undefined
    const safetyMarginBytes = maxContextBytes
      ? Math.min(Math.max(1, Math.floor(maxContextBytes * capability.safety_margin_ratio), Math.min(1_024, maxContextBytes)), maxContextBytes)
      : undefined
    const budget: ContextBudgetProfile = {
      budget_id: `context_budget_${hash(stableJson({ purpose, role, providerKind: capability.provider_kind, model: capability.model_id, sessionId, maxContextTokens, maxContextBytes })).slice(0, 16)}`,
      purpose,
      provider_kind: capability.provider_kind,
      model_id: capability.model_id,
      session_id: sessionId,
      max_context_tokens: maxContextTokens,
      max_context_bytes: maxContextBytes,
      max_output_tokens: maxOutputTokens,
      safety_margin_tokens: safetyMarginTokens,
      safety_margin_bytes: safetyMarginBytes,
      allocations: allocateSections(purpose, maxContextTokens, maxContextBytes, maxOutputTokens, safetyMarginTokens, safetyMarginBytes),
      warnings: Array.from(warnings).map((item) => redactText(item)).slice(0, 12),
      generated_at: generatedAt,
    }

    return redactStringsOnly({
      preview_id: `context_budget_preview_${hash(budget.budget_id).slice(0, 16)}`,
      purpose,
      role,
      capability,
      session_id: sessionId,
      session_max_context_bytes: sessionMaxContextBytes,
      budget,
      blockers: blockers.map((item) => redactText(item)),
      warnings: budget.warnings,
      recommended_commands: [
        { label: "List model capabilities", command: "/model-capabilities", command_type: "read" },
        { label: "Context budget summary", command: "/context-budget-summary", command_type: "read" },
        { label: "Show authority", command: "/authority-show /context-budget-preview", command_type: "read" },
      ],
      generated_at: generatedAt,
      redacted_summary_preview: blockers[0] ?? `${purpose} budget preview for ${capability.provider_kind}/${capability.model_id}`,
    })
  }
}

export function readContextBudgetPreviewInput(value: unknown): ContextBudgetPreviewInput {
  const input = isRecord(value) ? value : {}
  return {
    purpose: optional(input.purpose),
    role: optional(input.role),
    provider_kind: optional(input.providerKind ?? input.provider_kind ?? input.provider),
    provider_id: optional(input.providerId ?? input.provider_id),
    model_id: optional(input.modelId ?? input.model_id ?? input.model),
    session_id: optional(input.sessionId ?? input.session_id ?? input.session),
    max_context_tokens: optionalNumber(input.maxContextTokens ?? input.max_context_tokens),
    max_context_bytes: optionalNumber(input.maxContextBytes ?? input.max_context_bytes),
  }
}

export function readModelCapabilityGetInput(value: unknown): { capability_id?: string; provider_kind?: string; model_id?: string } {
  const input = isRecord(value) ? value : {}
  return {
    capability_id: optional(input.capabilityId ?? input.capability_id),
    provider_kind: optional(input.providerKind ?? input.provider_kind ?? input.provider),
    model_id: optional(input.modelId ?? input.model_id ?? input.model),
  }
}

export function readModelCapabilityListInput(value: unknown): { provider_kind?: string; role?: string; limit?: number } {
  const input = isRecord(value) ? value : {}
  return {
    provider_kind: optional(input.providerKind ?? input.provider_kind ?? input.provider),
    role: optional(input.role),
    limit: optionalNumber(input.limit),
  }
}

function allocateSections(
  purpose: ContextBudgetPurpose,
  maxTokens: number | undefined,
  maxBytes: number | undefined,
  outputTokens: number,
  safetyTokens: number | undefined,
  safetyBytes: number | undefined,
): ContextBudgetAllocation[] {
  const rules = sectionRules(purpose)
  const availableTokens = maxTokens === undefined ? undefined : Math.max(0, maxTokens - outputTokens - (safetyTokens ?? 0))
  const availableBytes = maxBytes === undefined ? undefined : Math.max(0, maxBytes - (safetyBytes ?? 0))
  const tokenCaps = distributeCaps(rules, availableTokens, 64)
  const byteCaps = distributeCaps(rules, availableBytes, 256)
  return rules.map((rule) => ({
    section: rule.section,
    max_tokens: rule.weight > 0 ? tokenCaps.get(rule) : undefined,
    max_bytes: rule.weight > 0 ? byteCaps.get(rule) : undefined,
    priority: rule.priority,
    inclusion_policy: rule.inclusion_policy,
    notes: rule.notes,
  }))
}

function sectionRules(purpose: ContextBudgetPurpose): Array<ContextBudgetAllocation & { weight: number }> {
  const common: Array<ContextBudgetAllocation & { weight: number }> = [
    { section: "raw_logs", priority: "excluded", inclusion_policy: "excluded_by_default", notes: "raw logs are excluded by default", weight: 0 },
    { section: "reserved_output", priority: "required", inclusion_policy: "always", notes: "reserved output space; not input context", weight: 0 },
    { section: "safety_margin", priority: "required", inclusion_policy: "always", notes: "reserved safety margin; not input context", weight: 0 },
  ]
  const excludedToolSchema: ContextBudgetAllocation & { weight: number } = { section: "tool_or_mcp_schema", priority: "low", inclusion_policy: "excluded_by_default", notes: "tool/MCP schemas are excluded unless a route selects specific tools", weight: 0 }
  if (purpose === "opencode_executor_session") return [
    { section: "role_kernel", priority: "required", inclusion_policy: "always", weight: 14 },
    { section: "approved_spec", priority: "medium", inclusion_policy: "if_relevant", notes: "bounded spec excerpt only", weight: 8 },
    { section: "mission_state", priority: "high", inclusion_policy: "always", notes: "tactical objective and constraints", weight: 18 },
    { section: "commander_guidance", priority: "high", inclusion_policy: "always", weight: 16 },
    { section: "executor_progress", priority: "high", inclusion_policy: "if_relevant", notes: "session memory/progress summary", weight: 12 },
    { section: "artifact_summaries", priority: "medium", inclusion_policy: "if_relevant", weight: 8 },
    { section: "research_memory", priority: "low", inclusion_policy: "pointer_only", notes: "no full research.db dump", weight: 4 },
    { section: "active_sessions", priority: "low", inclusion_policy: "pointer_only", weight: 3 },
    { section: "recent_deltas", priority: "medium", inclusion_policy: "if_relevant", weight: 5 },
    excludedToolSchema,
    ...common,
  ]
  if (purpose === "wake_supervisor") return [
    { section: "role_kernel", priority: "required", inclusion_policy: "always", weight: 8 },
    { section: "active_sessions", priority: "high", inclusion_policy: "always", weight: 18 },
    { section: "executor_progress", priority: "high", inclusion_policy: "always", weight: 18 },
    { section: "human_interventions", priority: "high", inclusion_policy: "if_relevant", weight: 10 },
    { section: "recent_deltas", priority: "high", inclusion_policy: "always", weight: 12 },
    { section: "commander_guidance", priority: "medium", inclusion_policy: "if_relevant", weight: 8 },
    { section: "research_memory", priority: "low", inclusion_policy: "if_relevant", notes: "bounded retrieval only", weight: 4 },
    excludedToolSchema,
    ...common,
  ]
  if (purpose === "research_retrieval") return [
    { section: "role_kernel", priority: "required", inclusion_policy: "always", weight: 8 },
    { section: "research_memory", priority: "high", inclusion_policy: "if_relevant", notes: "bounded retrieved findings; never full research.db", weight: 24 },
    { section: "external_research", priority: "medium", inclusion_policy: "if_relevant", weight: 12 },
    { section: "artifact_summaries", priority: "medium", inclusion_policy: "pointer_only", weight: 8 },
    { section: "mission_state", priority: "medium", inclusion_policy: "if_relevant", weight: 8 },
    excludedToolSchema,
    ...common,
  ]
  if (purpose === "commander_research_decision") return [
    { section: "role_kernel", priority: "required", inclusion_policy: "always", weight: 10 },
    { section: "approved_spec", priority: "high", inclusion_policy: "always", weight: 12 },
    { section: "mission_state", priority: "high", inclusion_policy: "if_relevant", weight: 14 },
    { section: "research_memory", priority: "high", inclusion_policy: "if_relevant", notes: "bounded retrieved findings; never full research.db", weight: 16 },
    { section: "external_research", priority: "low", inclusion_policy: "pointer_only", weight: 4 },
    { section: "active_sessions", priority: "medium", inclusion_policy: "if_relevant", weight: 8 },
    { section: "executor_progress", priority: "medium", inclusion_policy: "if_relevant", weight: 7 },
    { section: "commander_guidance", priority: "medium", inclusion_policy: "if_relevant", weight: 6 },
    { section: "human_interventions", priority: "medium", inclusion_policy: "if_relevant", weight: 5 },
    { section: "recent_deltas", priority: "high", inclusion_policy: "if_relevant", weight: 10 },
    { section: "tool_or_mcp_schema", priority: "medium", inclusion_policy: "if_relevant", notes: "bounded Commander tool bootstrap schemas; execution remains disabled", weight: 6 },
    ...common,
  ]
  return [
    { section: "role_kernel", priority: "required", inclusion_policy: "always", weight: 10 },
    { section: "approved_spec", priority: "high", inclusion_policy: "always", weight: 12 },
    { section: "mission_state", priority: "high", inclusion_policy: "if_relevant", weight: 14 },
    { section: "research_memory", priority: "high", inclusion_policy: "if_relevant", notes: "bounded retrieved findings; never full research.db", weight: 16 },
    { section: "external_research", priority: "low", inclusion_policy: "pointer_only", weight: 4 },
    { section: "active_sessions", priority: "medium", inclusion_policy: "if_relevant", weight: 8 },
    { section: "executor_progress", priority: "medium", inclusion_policy: "if_relevant", weight: 7 },
    { section: "commander_guidance", priority: "medium", inclusion_policy: "if_relevant", weight: 6 },
    { section: "human_interventions", priority: "medium", inclusion_policy: "if_relevant", weight: 5 },
    { section: "recent_deltas", priority: "high", inclusion_policy: "if_relevant", weight: 10 },
    excludedToolSchema,
    ...common,
  ]
}

function readPurpose(value: unknown): ContextBudgetPurpose {
  const safe = optional(value) ?? "unknown"
  if (["commander_research_decision", "commander_executor_review", "opencode_executor_session", "wake_supervisor", "research_retrieval", "open_question_answer"].includes(safe)) return safe as ContextBudgetPurpose
  return "unknown"
}

function readRole(value: unknown, purpose: ContextBudgetPurpose): ModelCapabilityRole {
  const safe = optional(value)
  if (safe && ["commander", "executor", "research", "wake_supervisor", "unknown"].includes(safe)) return safe as ModelCapabilityRole
  if (purpose.startsWith("commander")) return "commander"
  if (purpose === "opencode_executor_session") return "executor"
  if (purpose === "wake_supervisor") return "wake_supervisor"
  if (purpose === "research_retrieval") return "research"
  return "unknown"
}

function defaultModelForPurpose(purpose: ContextBudgetPurpose): string {
  if (purpose === "opencode_executor_session") return "opencode-default"
  return "unknown"
}

function defaultProviderForPurpose(purpose: ContextBudgetPurpose): string {
  if (purpose === "opencode_executor_session") return "opencode"
  return "unknown"
}

function capabilitySupportsRole(capability: ModelCapability, role: ModelCapabilityRole): boolean {
  if (role === "unknown") return true
  return capability.role_support.includes(role) || capability.role_support.includes("unknown")
}

function distributeCaps<T extends { weight: number }>(rules: T[], available: number | undefined, floor: number): Map<T, number> {
  const caps = new Map<T, number>()
  const weighted = rules.filter((rule) => rule.weight > 0)
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0)
  if (available === undefined || !weighted.length || available <= 0 || totalWeight <= 0) return caps
  const canApplyFloor = available >= weighted.length * floor
  let remaining = Math.floor(available)
  let remainingWeight = totalWeight
  for (const rule of weighted) {
    const raw = Math.floor(remaining * rule.weight / remainingWeight)
    const capped = Math.min(remaining, canApplyFloor ? Math.max(floor, raw) : raw)
    caps.set(rule, capped)
    remaining -= capped
    remainingWeight -= rule.weight
  }
  return caps
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? redactText(value.trim()) : undefined
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value)
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.floor(parsed)
  }
  return undefined
}

function clampOptional(value: unknown, min: number, max: number): number | undefined {
  const parsed = optionalNumber(value)
  if (parsed === undefined) return undefined
  return Math.max(min, Math.min(parsed, max))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort())
}

function redactStringsOnly<T>(value: T): T {
  if (typeof value === "string") return redactText(value) as T
  if (Array.isArray(value)) return value.map((item) => redactStringsOnly(item)) as T
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) out[key] = redactStringsOnly(item)
    return out as T
  }
  return value
}
