import { createHash } from "node:crypto"
import type { MissionRegistry } from "../missions/mission-registry"
import type { ProposalRegistry } from "../missions/proposal-registry"
import type { OpenCodeSessionService } from "../opencode-session/opencode-session-service"
import { redactText } from "../security/redaction"
import type { ContextBudgetAllocation, ContextBudgetPurpose } from "./context-budget-types"
import type { ContextBudgetService } from "./context-budget-service"
import type {
  ContextPacketPreview,
  ContextPacketPreviewInput,
  ContextPacketPurpose,
  ContextPacketRole,
  ContextPacketSection,
  ContextPacketSectionStatus,
  ContextPacketSourceKind,
  ContextPacketSourceRef,
  ContextPacketSummary,
} from "./context-packet-types"

const MAX_TEXT = 240
const SUPPORTED_PURPOSES: ContextPacketPurpose[] = [
  "commander_research_decision",
  "commander_executor_review",
  "opencode_executor_session",
  "wake_supervisor",
  "research_retrieval",
  "open_question_answer",
]
const SUPPORTED_ROLES: ContextPacketRole[] = ["commander", "executor", "wake_supervisor", "research"]

export type ContextPacketCompilerServiceOptions = {
  contextBudgetService: ContextBudgetService
  opencodeSessionService: OpenCodeSessionService
  missionRegistry: MissionRegistry
  proposalRegistry: ProposalRegistry
  now?: () => Date
}

export class ContextPacketCompilerService {
  private readonly now: () => Date

  constructor(private readonly options: ContextPacketCompilerServiceOptions) {
    this.now = options.now ?? (() => new Date())
  }

  summary(): ContextPacketSummary {
    return redactStringsOnly({
      supported_purposes: SUPPORTED_PURPOSES,
      supported_roles: SUPPORTED_ROLES,
      generated_at: this.now().toISOString(),
    })
  }

  async preview(input: ContextPacketPreviewInput = {}): Promise<ContextPacketPreview> {
    const generatedAt = this.now().toISOString()
    const purpose = readPurpose(input.purpose)
    const role = readRole(input.role, purpose)
    const budgetPreview = await this.options.contextBudgetService.preview({
      purpose,
      role,
      provider_kind: input.provider_kind,
      provider_id: input.provider_id,
      model_id: input.model_id,
      session_id: input.session_id,
      max_context_tokens: input.max_context_tokens,
      max_context_bytes: input.max_context_bytes,
    })
    const blockers = new Set<string>(budgetPreview.blockers)
    const warnings = new Set<string>([
      ...budgetPreview.warnings,
      "packet preview does not compile executable prompts, call providers, launch OpenCode, query research.db, call MCPs, or decide research direction",
      "token estimates are approximate; exact tokenizer integration is future work",
    ])
    if (purpose === "unknown") blockers.add("context packet preview requires a supported purpose")

    const session = input.session_id ? await this.options.opencodeSessionService.get(input.session_id) : null
    if (purpose === "opencode_executor_session" && input.session_id && !session) blockers.add("session_id was not found")
    const missionId = optional(input.mission_id) ?? session?.mission_id
    const proposalId = optional(input.proposal_id) ?? session?.proposal_id
    const mission = missionId ? await this.options.missionRegistry.getMission(missionId) : null
    const proposal = proposalId ? await this.options.proposalRegistry.getProposal(proposalId) : null
    if (input.mission_id && !mission) warnings.add("mission_id was not found; mission_state remains missing")
    if (input.proposal_id && !proposal) warnings.add("proposal_id was not found; proposal source remains missing")

    const sourceContext: PacketSourceContext = {
      purpose,
      role,
      session,
      mission,
      proposal,
      missionId,
      proposalId,
      reviewRequestId: optional(input.review_request_id) ?? session?.review_request_id ?? proposal?.review_id,
      applyId: optional(input.apply_id) ?? session?.apply_id,
    }
    const sections = budgetPreview.budget.allocations.map((allocation) => sectionFromAllocation(allocation, sourceContext))
    if (!sections.some((section) => section.section === "raw_logs")) sections.push(excludedSyntheticSection("raw_logs", "raw logs are excluded by policy"))
    if (!sections.some((section) => section.section === "tool_or_mcp_schema")) sections.push(excludedSyntheticSection("tool_or_mcp_schema", "tool/MCP schemas are excluded until a future router selects specific tools"))
    if (purpose === "open_question_answer" && !sections.some((section) => section.section === "open_question_answer")) sections.push(openQuestionAnswerSection(sourceContext))

    const missingRequired = sections.filter((section) => section.priority === "required" && (section.status === "missing" || section.status === "omitted"))
    for (const section of sections) {
      if (section.status === "missing" && section.priority === "required") warnings.add(`${section.section} is missing`)
    }
    const estimatedInputBytes = sections
      .filter((section) => section.status === "included" || section.status === "pointer_only")
      .reduce((sum, section) => sum + (section.estimated_bytes ?? 0), 0)
    const estimatedInputTokens = Math.ceil(estimatedInputBytes / 4)
    const overBudget = (budgetPreview.budget.max_context_bytes !== undefined && estimatedInputBytes > budgetPreview.budget.max_context_bytes)
      || (budgetPreview.budget.max_context_tokens !== undefined && estimatedInputTokens > budgetPreview.budget.max_context_tokens)
      || sections.some((section) =>
        (section.max_bytes !== undefined && section.estimated_bytes !== undefined && section.estimated_bytes > section.max_bytes)
        || (section.max_tokens !== undefined && section.estimated_tokens !== undefined && section.estimated_tokens > section.max_tokens))
    if (overBudget) warnings.add("packet preview exceeds one or more approximate budget caps")
    const includedSourceRefs = uniqueRefs(sections.flatMap((section) => section.source_refs.filter((ref) => !ref.pointer_only)))
    const omittedSourceRefs = uniqueRefs(sections.flatMap((section) => section.source_refs.filter((ref) => ref.pointer_only || section.status !== "included")))
    const packetHash = hash(stableJson({
      purpose,
      role,
      budget_id: budgetPreview.budget.budget_id,
      session_id: session?.session_id ?? input.session_id,
      mission_id: missionId,
      proposal_id: proposalId,
      sections: sections.map((section) => [section.section, section.status, section.source_refs.map((ref) => ref.source_id)]),
    }))
    const packetStatus = blockers.size > 0 || missingRequired.length > 0
      ? "blocked"
      : sections.some((section) => section.status === "missing" || section.status === "omitted" || section.status === "pointer_only")
        ? "partial"
        : "ready"
    return redactStringsOnly({
      packet_id: `context_packet_${packetHash.slice(0, 16)}`,
      role,
      purpose,
      budget_id: budgetPreview.budget.budget_id,
      provider_kind: budgetPreview.budget.provider_kind,
      model_id: budgetPreview.budget.model_id,
      session_id: session?.session_id ?? optional(input.session_id),
      mission_id: mission?.mission_id ?? missionId,
      proposal_id: proposal?.proposal_id ?? proposalId,
      review_request_id: sourceContext.reviewRequestId,
      apply_id: sourceContext.applyId,
      packet_status: packetStatus,
      can_compile_final_prompt: false as const,
      sections,
      included_source_refs: includedSourceRefs,
      omitted_source_refs: omittedSourceRefs,
      budget_summary: {
        max_context_tokens: budgetPreview.budget.max_context_tokens,
        max_context_bytes: budgetPreview.budget.max_context_bytes,
        max_output_tokens: budgetPreview.budget.max_output_tokens,
        safety_margin_tokens: budgetPreview.budget.safety_margin_tokens,
        safety_margin_bytes: budgetPreview.budget.safety_margin_bytes,
        estimated_input_tokens: estimatedInputTokens,
        estimated_input_bytes: estimatedInputBytes,
        over_budget: overBudget,
      },
      blockers: Array.from(blockers).map((item) => bound(item)),
      warnings: Array.from(warnings).map((item) => bound(item)).slice(0, 16),
      recommended_commands: recommendedCommands(purpose, session?.session_id ?? optional(input.session_id)),
      generated_at: generatedAt,
      redacted_summary_preview: packetStatus === "blocked"
        ? (Array.from(blockers)[0] ?? "context packet preview is blocked")
        : `${purpose} packet skeleton with ${sections.length} bounded sections`,
      packet_hash: packetHash,
    })
  }
}

export function readContextPacketPreviewInput(value: unknown): ContextPacketPreviewInput {
  const input = isRecord(value) ? value : {}
  return {
    purpose: optional(input.purpose),
    role: optional(input.role),
    provider_kind: optional(input.providerKind ?? input.provider_kind ?? input.provider),
    provider_id: optional(input.providerId ?? input.provider_id),
    model_id: optional(input.modelId ?? input.model_id ?? input.model),
    session_id: optional(input.sessionId ?? input.session_id ?? input.session),
    mission_id: optional(input.missionId ?? input.mission_id ?? input.mission),
    proposal_id: optional(input.proposalId ?? input.proposal_id ?? input.proposal),
    review_request_id: optional(input.reviewRequestId ?? input.review_request_id ?? input.review),
    apply_id: optional(input.applyId ?? input.apply_id ?? input.apply),
    max_context_tokens: optionalNumber(input.maxContextTokens ?? input.max_context_tokens),
    max_context_bytes: optionalNumber(input.maxContextBytes ?? input.max_context_bytes),
    include_authority: input.include_authority === false || input.includeAuthority === false ? false : undefined,
  }
}

type PacketSourceContext = {
  purpose: ContextPacketPurpose
  role: ContextPacketRole
  session: Awaited<ReturnType<OpenCodeSessionService["get"]>>
  mission: Awaited<ReturnType<MissionRegistry["getMission"]>>
  proposal: Awaited<ReturnType<ProposalRegistry["getProposal"]>>
  missionId?: string
  proposalId?: string
  reviewRequestId?: string
  applyId?: string
}

function sectionFromAllocation(allocation: ContextBudgetAllocation, context: PacketSourceContext): ContextPacketSection {
  const baseRefs = refsForSection(allocation.section, context)
  let status: ContextPacketSectionStatus = "included"
  let summary = `${allocation.section} skeleton is bounded by budget allocation`
  let omittedReason: string | undefined
  const warnings: string[] = []

  if (allocation.section === "raw_logs" || allocation.section === "tool_or_mcp_schema") {
    status = "excluded"
    summary = allocation.section === "raw_logs" ? "raw logs are excluded by default" : "tool/MCP schemas are excluded until a future route selects specific tools"
    omittedReason = "excluded by context packet policy"
  } else if (allocation.section === "research_memory") {
    status = "pointer_only"
    summary = "research memory is pointer-only in 9B2; no research.db query is performed"
    warnings.push("research.db retrieval is future work")
  } else if (allocation.section === "external_research") {
    status = context.purpose === "research_retrieval" ? "omitted" : "pointer_only"
    summary = "external research is not fetched in 9B2"
    omittedReason = "MCP and external research routing are out of scope"
  } else if (allocation.section === "approved_spec") {
    status = "pointer_only"
    summary = "approved spec is represented as a bounded pointer; no full spec dump is included"
  } else if (allocation.section === "recent_deltas") {
    status = "pointer_only"
    summary = "recent deltas are represented as event pointers only; no full event log is included"
  } else if (allocation.section === "executor_progress") {
    status = "missing"
    summary = "executor progress model is not implemented yet"
  } else if (allocation.section === "commander_guidance") {
    status = context.session ? "pointer_only" : "missing"
    summary = context.session ? "Commander guidance is a future protocol; current source is the planned session pointer" : "Commander guidance protocol is not implemented yet"
  } else if (allocation.section === "human_interventions") {
    status = "missing"
    summary = "human intervention model is not implemented yet"
  } else if (allocation.section === "active_sessions") {
    status = context.session ? "included" : context.purpose === "wake_supervisor" ? "pointer_only" : "missing"
    summary = context.session ? "active/planned session pointer included" : "active session projection is not available in this skeleton"
  } else if (allocation.section === "mission_state") {
    status = context.session || context.mission || context.proposal ? "included" : "missing"
    summary = context.session
      ? "tactical objective comes from the planned OpenCode session"
      : context.mission
        ? "mission state pointer is included"
        : "mission state is unavailable"
  } else if (allocation.section === "artifact_summaries") {
    status = "pointer_only"
    summary = "artifact summaries are pointer-only until artifact registry selection is implemented"
  } else if (allocation.section === "role_kernel") {
    summary = `role kernel for ${context.role} / ${context.purpose}; no research conclusion is selected`
  } else if (allocation.section === "reserved_output" || allocation.section === "safety_margin") {
    status = "excluded"
    summary = `${allocation.section} is a budget reserve, not packet input`
    omittedReason = "reserved budget"
  }

  const estimatedBytes = estimateBytes(summary, baseRefs)
  const estimatedTokens = Math.ceil(estimatedBytes / 4)
  if (allocation.max_bytes !== undefined && estimatedBytes > allocation.max_bytes) warnings.push("section estimate exceeds max_bytes cap")
  if (allocation.max_tokens !== undefined && estimatedTokens > allocation.max_tokens) warnings.push("section estimate exceeds max_tokens cap")
  return {
    section: allocation.section,
    status,
    priority: allocation.priority,
    inclusion_policy: allocation.inclusion_policy,
    max_tokens: allocation.max_tokens,
    max_bytes: allocation.max_bytes,
    estimated_tokens: status === "excluded" ? 0 : estimatedTokens,
    estimated_bytes: status === "excluded" ? 0 : estimatedBytes,
    summary_preview: bound(summary),
    source_refs: baseRefs,
    omitted_reason: omittedReason ? bound(omittedReason) : undefined,
    warnings: warnings.map((item) => bound(item)),
  }
}

function refsForSection(section: string, context: PacketSourceContext): ContextPacketSourceRef[] {
  const refs: ContextPacketSourceRef[] = []
  if (section === "role_kernel") refs.push(sourceRef("budget", "role_kernel_policy", "role kernel", `${context.role} ${context.purpose}`, true))
  if (section === "approved_spec") refs.push(sourceRef("spec", "approved_spec_current", "approved spec pointer", "bounded spec pointer only", true))
  if (section === "mission_state") {
    if (context.session) refs.push(sourceRef("opencode_session", context.session.session_id, "planned session objective", context.session.objective, false))
    if (context.mission) refs.push(sourceRef("mission", context.mission.mission_id, "mission pointer", context.mission.objective, true))
    else if (context.missionId) refs.push(sourceRef("mission", context.missionId, "mission pointer", "mission record not found", true))
    if (context.proposal) refs.push(sourceRef("proposal", context.proposal.proposal_id, "proposal pointer", context.proposal.summary, true))
  }
  if (section === "commander_guidance" && context.session) refs.push(sourceRef("opencode_session", context.session.session_id, "planned session Commander context", context.session.commander_context_summary, true))
  if ((section === "mission_state" || section === "commander_guidance") && context.session) {
    refs.push(sourceRef("opencode_session", `${context.session.session_id}:timeout_policy`, "timeout/report policy pointer", "planned session timeout metadata only", true))
    refs.push(sourceRef("opencode_session", `${context.session.session_id}:question_policy`, "question policy pointer", "planned session question metadata only", true))
    refs.push(sourceRef("opencode_session", `${context.session.session_id}:human_control_policy`, "human control policy pointer", "planned session human-control metadata only", true))
  }
  if (section === "active_sessions" && context.session) refs.push(sourceRef("opencode_session", context.session.session_id, "planned OpenCode session", context.session.title, false))
  if (section === "research_memory") refs.push(sourceRef("research_result", "research_db_retrieval_future", "research memory pointer", "full research.db is not included", true))
  if (section === "external_research") refs.push(sourceRef("external_source", "external_research_future", "external research pointer", "MCP/external retrieval is not called", true))
  if (section === "recent_deltas") refs.push(sourceRef("event", "events_jsonl_projection_pointer", "event projection pointer", "full event log is not included", true))
  if (section === "tool_or_mcp_schema") refs.push(sourceRef("unknown", "tool_schema_router_future", "tool schema router", "all tool/MCP schemas excluded by default", true))
  if (section === "artifact_summaries") refs.push(sourceRef("artifact", "artifact_registry_future", "artifact registry pointer", "artifact summaries require future selection", true))
  if (section === "executor_progress") refs.push(sourceRef("opencode_session", context.session?.session_id ?? "executor_progress_future", "executor progress pointer", "progress model is future work", true))
  if (section === "human_interventions") refs.push(sourceRef("human_intervention", "human_intervention_future", "human intervention pointer", "human controls are future work", true))
  if (section === "open_question_answer") refs.push(sourceRef("unknown", "opencode_question_protocol_future", "question protocol pointer", "question protocol is future work", true))
  if (context.reviewRequestId && (section === "mission_state" || section === "active_sessions")) refs.push(sourceRef("review", context.reviewRequestId, "review pointer", "review source ID pointer", true))
  if (context.applyId && (section === "mission_state" || section === "active_sessions")) refs.push(sourceRef("apply", context.applyId, "apply pointer", "apply source ID pointer", true))
  if (context.session && section === "opencode_executor_session_policy") refs.push(sourceRef("opencode_session", context.session.session_id, "session policy pointer", "timeout/question/human policy metadata", true))
  return refs
}

function excludedSyntheticSection(section: string, reason: string): ContextPacketSection {
  return {
    section,
    status: "excluded",
    priority: "excluded",
    inclusion_policy: "excluded_by_default",
    estimated_tokens: 0,
    estimated_bytes: 0,
    summary_preview: bound(reason),
    source_refs: [],
    omitted_reason: bound(reason),
    warnings: [],
  }
}

function openQuestionAnswerSection(context: PacketSourceContext): ContextPacketSection {
  const summary = "pending question and Commander guidance protocol are not implemented yet"
  const refs = refsForSection("open_question_answer", context)
  const estimatedBytes = estimateBytes(summary, refs)
  return {
    section: "open_question_answer",
    status: "missing",
    priority: "high",
    inclusion_policy: "if_relevant",
    estimated_tokens: Math.ceil(estimatedBytes / 4),
    estimated_bytes: estimatedBytes,
    summary_preview: bound(summary),
    source_refs: refs,
    omitted_reason: "OpenCode asks Commander protocol is future work",
    warnings: ["question protocol is future work"],
  }
}

function sourceRef(sourceKind: ContextPacketSourceKind, sourceId: string, label: string, summary: string, pointerOnly: boolean): ContextPacketSourceRef {
  return {
    source_kind: sourceKind,
    source_id: bound(sourceId, 160),
    label: bound(label, 120),
    summary_preview: bound(summary),
    pointer_only: pointerOnly,
  }
}

function estimateBytes(summary: string, refs: ContextPacketSourceRef[]): number {
  return Buffer.byteLength(summary, "utf8") + refs.reduce((sum, ref) => sum + Buffer.byteLength(`${ref.source_kind}:${ref.source_id}:${ref.summary_preview ?? ""}`, "utf8"), 0)
}

function uniqueRefs(refs: ContextPacketSourceRef[]): ContextPacketSourceRef[] {
  const seen = new Set<string>()
  const out: ContextPacketSourceRef[] = []
  for (const ref of refs) {
    const key = `${ref.source_kind}:${ref.source_id}:${ref.pointer_only}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ref)
  }
  return out.slice(0, 24)
}

function recommendedCommands(purpose: ContextPacketPurpose, sessionId?: string) {
  const commands = [
    { label: "Context packet summary", command: "/context-packet-summary", command_type: "read" as const },
    { label: "Context budget preview", command: `/context-budget-preview purpose=${purpose}`, command_type: "read" as const },
    { label: "Show authority", command: "/authority-show /context-packet-preview", command_type: "read" as const },
  ]
  if (sessionId) commands.push({ label: "Show OpenCode session", command: `/opencode-session-show ${sessionId}`, command_type: "read" as const })
  return commands
}

function readPurpose(value: unknown): ContextPacketPurpose {
  const safe = optional(value) ?? "unknown"
  return SUPPORTED_PURPOSES.includes(safe as ContextPacketPurpose) ? safe as ContextPacketPurpose : "unknown"
}

function readRole(value: unknown, purpose: ContextBudgetPurpose): ContextPacketRole {
  const safe = optional(value)
  if (safe && ["commander", "executor", "wake_supervisor", "research", "unknown"].includes(safe)) return safe as ContextPacketRole
  if (purpose.startsWith("commander")) return "commander"
  if (purpose === "opencode_executor_session") return "executor"
  if (purpose === "wake_supervisor") return "wake_supervisor"
  if (purpose === "research_retrieval") return "research"
  return "unknown"
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function bound(value: unknown, max = MAX_TEXT): string {
  return redactText(String(value ?? "").replace(/\s+/g, " ").trim()).slice(0, max)
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, stableKeys(value))
}

function stableKeys(value: unknown): string[] {
  const keys = new Set<string>()
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) item.forEach(visit)
    else if (item && typeof item === "object") {
      for (const [key, child] of Object.entries(item)) {
        keys.add(key)
        visit(child)
      }
    }
  }
  visit(value)
  return Array.from(keys).sort()
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
