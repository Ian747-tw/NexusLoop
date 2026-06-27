import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import type { MissionRegistry } from "../missions/mission-registry"
import type { ProposalRegistry } from "../missions/proposal-registry"
import { redactText, redactValue } from "../security/redaction"
import type {
  OpenCodeSessionCommand,
  OpenCodeSessionCreateInput,
  OpenCodeSessionHumanControlPolicy,
  OpenCodeSessionPlan,
  OpenCodeSessionPreview,
  OpenCodeSessionPreviewInput,
  OpenCodeSessionQuestionPolicy,
  OpenCodeSessionRecord,
  OpenCodeSessionSourceKind,
  OpenCodeSessionStatus,
  OpenCodeSessionSummary,
  OpenCodeSessionTimeoutPolicy,
} from "./opencode-session-types"

const MAX_TEXT = 320
const MAX_ROWS = 12
const DEFAULT_MAX_CONTEXT_BYTES = 12_000
const MAX_CONTEXT_BYTES = 48_000
const DEFAULT_MAX_WALL_TIME_MS = 30 * 60 * 1000
const DEFAULT_MAX_NO_PROGRESS_MS = 10 * 60 * 1000
const DEFAULT_HEARTBEAT_INTERVAL_MS = 60 * 1000
const MAX_WALL_TIME_MS = 24 * 60 * 60 * 1000
const MAX_NO_PROGRESS_MS = 2 * 60 * 60 * 1000
const MAX_HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000

export type OpenCodeSessionServiceOptions = {
  eventStore: EventStore
  missionRegistry: MissionRegistry
  proposalRegistry: ProposalRegistry
  now?: () => Date
}

export class OpenCodeSessionService {
  private readonly now: () => Date
  private createQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: OpenCodeSessionServiceOptions) {
    this.now = options.now ?? (() => new Date())
  }

  async preview(input: OpenCodeSessionPreviewInput = {}): Promise<OpenCodeSessionPreview> {
    return this.buildPreview(normalizePreviewInput(input))
  }

  async create(input: OpenCodeSessionCreateInput = {}): Promise<OpenCodeSessionPlan> {
    const normalized = normalizeCreateInput(input)
    const preview = await this.buildPreview(normalized)
    const createdAt = this.now().toISOString()
    const sessionHash = sessionHashFor(preview)
    const existing = preview.existing_session_id ? await this.get(preview.existing_session_id) : null
    if (existing) return redactValue(existing)
    const plan = planFromPreview(preview, {
      session_id: sessionId(sessionHash),
      created_at: createdAt,
      created_by: normalized.created_by ?? "operator",
      session_hash: sessionHash,
    })
    if (normalized.dry_run === true) return redactValue(plan)
    if (!preview.can_create) throw new Error(preview.blockers[0] ?? "opencode session plan is blocked")
    return this.serializeCreate(async () => {
      const rebuilt = await this.buildPreview(normalized)
      const rebuiltExisting = rebuilt.existing_session_id ? await this.get(rebuilt.existing_session_id) : null
      if (rebuiltExisting) return redactValue(rebuiltExisting)
      if (!rebuilt.can_create) throw new Error(rebuilt.blockers[0] ?? "opencode session plan is blocked")
      const finalHash = sessionHashFor(rebuilt)
      const finalPlan = planFromPreview(rebuilt, {
        session_id: sessionId(finalHash),
        created_at: createdAt,
        created_by: normalized.created_by ?? "operator",
        session_hash: finalHash,
      })
      await this.options.eventStore.append(redactValue({ kind: "opencode_session_planned", ...finalPlan }) as JsonlEvent)
      return redactValue(finalPlan)
    })
  }

  async list(input: { limit?: number; status?: OpenCodeSessionStatus; mission_id?: string; proposal_id?: string; source_kind?: OpenCodeSessionSourceKind } = {}): Promise<OpenCodeSessionRecord[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100))
    return redactValue((await this.sessions())
      .filter((item) => !input.status || item.status === input.status)
      .filter((item) => !input.mission_id || item.mission_id === input.mission_id)
      .filter((item) => !input.proposal_id || item.proposal_id === input.proposal_id)
      .filter((item) => !input.source_kind || item.source_kind === input.source_kind)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map(recordFromPlan)
      .slice(0, limit))
  }

  async get(sessionIdValue: string): Promise<OpenCodeSessionPlan | null> {
    const safeId = required(sessionIdValue, "session_id")
    return (await this.sessions()).find((item) => item.session_id === safeId) ?? null
  }

  async summary(): Promise<OpenCodeSessionSummary> {
    const sessions = await this.sessions()
    return redactValue({
      total_sessions: sessions.length,
      planned_count: sessions.filter((item) => item.status === "planned").length,
      running_count: 0,
      paused_count: 0,
      blocked_count: 0,
      completed_count: 0,
      failed_count: 0,
      cancelled_count: 0,
      generated_at: this.now().toISOString(),
    })
  }

  private async buildPreview(input: OpenCodeSessionPreviewInput): Promise<OpenCodeSessionPreview> {
    const generatedAt = this.now().toISOString()
    const source = await this.resolveSource(input)
    const sourceKind = input.source_kind ?? source.source_kind
    const objective = bound(input.objective ?? source.objective ?? "")
    const title = bound(input.title ?? source.title ?? titleFromObjective(objective))
    const blockers: string[] = []
    const warnings = [
      "session planning does not launch OpenCode, send prompts, call providers, mutate missions, create checkpoints, or execute scheduler/wake/continuation/recovery writes",
    ]
    if (!objective) blockers.push("objective or valid linked proposal/mission source is required")
    if (input.proposal_id && !source.proposal_found) blockers.push("proposal_id was not found")
    if (input.mission_id && !source.mission_found) blockers.push("mission_id was not found")
    blockers.push(...source.link_blockers)
    if (input.review_request_id && source.review_request_id && input.review_request_id !== source.review_request_id) blockers.push("review_request_id does not match linked proposal")
    if (input.apply_id && !source.apply_id_matches) blockers.push("apply_id does not match durable narrow apply evidence")
    const hasLinkedSource = !!source.proposal_id || !!source.mission_id || !!source.apply_id
    if (source.source_status && ["cancelled", "rejected", "failed"].includes(source.source_status) && (sourceKind !== "manual" || hasLinkedSource)) blockers.push(`source status ${source.source_status} is not plan-eligible`)
    if (objective.length < 12) warnings.push("objective is short; future launch may require clearer tactical scope")
    const maxContextBytes = boundedNumber(input.max_context_bytes, DEFAULT_MAX_CONTEXT_BYTES, 1_000, MAX_CONTEXT_BYTES)
    const sessionTimeoutPolicy = timeoutPolicy(input)
    const sessionQuestionPolicy = questionPolicy()
    const humanPolicy = humanControlPolicy()
    const commanderContext = bound(`Commander strategic context: ${source.context ?? objective}`)
    const opencodeSeed = bound(`OpenCode tactical seed: ${objective}`)
    const sharedContext = bound(`Shared source: ${sourceKind}${source.proposal_id ? ` proposal=${source.proposal_id}` : ""}${source.mission_id ? ` mission=${source.mission_id}` : ""}`)
    const previewHash = sha256(stableJson({
      source_kind: sourceKind,
      mission_id: source.mission_id,
      proposal_id: source.proposal_id,
      review_request_id: source.review_request_id,
      apply_id: source.apply_id,
      objective,
    }))
    const existing = blockers.length === 0 ? await this.findExisting(previewHash) : undefined
    if (existing) blockers.push("matching active planned OpenCode session already exists")
    return redactValue({
      preview_id: `opencode_session_preview_${previewHash.slice(0, 16)}`,
      can_create: blockers.length === 0,
      source_kind: sourceKind,
      mission_id: source.mission_id,
      proposal_id: source.proposal_id,
      review_request_id: source.review_request_id,
      apply_id: source.apply_id,
      title_preview: title,
      objective_preview: objective,
      commander_context_summary_preview: commanderContext,
      opencode_context_seed_preview: opencodeSeed,
      success_criteria: boundList(source.success_criteria.length ? source.success_criteria : ["Produce bounded progress evidence or a blocker report"]),
      constraints: boundList([
        "Do not mutate mission state from session planning",
        "Keep Commander and OpenCode context boundaries separate",
        ...source.constraints,
      ]),
      timeout_policy: sessionTimeoutPolicy,
      question_policy: sessionQuestionPolicy,
      human_control_policy: humanPolicy,
      existing_session_id: existing?.session_id,
      blockers: boundList(blockers),
      warnings: boundList(warnings),
      recommended_commands: recommendedCommands(source.proposal_id, source.mission_id, existing?.session_id),
      generated_at: generatedAt,
      redacted_summary_preview: blockers.length === 0 ? `Planned OpenCode session can be created for ${sourceKind} source.` : blockers[0] ?? "OpenCode session plan is blocked.",
    })
  }

  private async resolveSource(input: OpenCodeSessionPreviewInput): Promise<{
    source_kind: OpenCodeSessionSourceKind
    mission_id?: string
    proposal_id?: string
    review_request_id?: string
    apply_id?: string
    objective?: string
    title?: string
    context?: string
    source_status?: string
    proposal_found?: boolean
    mission_found?: boolean
    apply_id_matches?: boolean
    success_criteria: string[]
    constraints: string[]
    link_blockers: string[]
  }> {
    const proposal = input.proposal_id ? await this.options.proposalRegistry.getProposal(input.proposal_id) : null
    const apply = input.apply_id ? await this.findNarrowApply(input.apply_id) : undefined
    const applyProposalId = optional(apply?.proposal_id)
    const proposalMissionId = proposal?.mission_id
    const missionId = proposalMissionId ?? input.mission_id
    const mission = missionId ? await this.options.missionRegistry.getMission(missionId) : null
    const payload = isRecord(proposal?.action_payload) ? proposal.action_payload : {}
    const sourceKind = input.source_kind ?? (proposal ? "proposal" : mission ? "mission" : apply ? "executor_review" : input.objective ? "manual" : "unknown")
    const linkBlockers: string[] = []
    if (input.proposal_id && input.mission_id && proposalMissionId && input.mission_id !== proposalMissionId) linkBlockers.push("mission_id does not match linked proposal")
    if (input.apply_id && input.proposal_id && applyProposalId && input.proposal_id !== applyProposalId) linkBlockers.push("apply_id does not match linked proposal")
    return {
      source_kind: sourceKind,
      mission_id: mission?.mission_id ?? missionId,
      proposal_id: proposal?.proposal_id ?? applyProposalId ?? input.proposal_id,
      review_request_id: input.review_request_id ?? proposal?.review_id,
      apply_id: optional(apply?.apply_id) ?? input.apply_id,
      objective: input.objective ?? proposal?.summary ?? mission?.objective,
      title: input.title ?? proposal?.title ?? (mission ? `OpenCode session for ${mission.mission_id}` : undefined),
      context: proposal?.summary ?? mission?.objective ?? input.objective,
      source_status: proposal?.status ?? mission?.status,
      proposal_found: input.proposal_id ? !!proposal : undefined,
      mission_found: input.mission_id ? !!mission : undefined,
      apply_id_matches: input.apply_id ? !!apply : undefined,
      success_criteria: optionalStringArray(payload.success_criteria) ?? [],
      constraints: optionalStringArray(payload.constraints) ?? [],
      link_blockers: linkBlockers,
    }
  }

  private async findNarrowApply(applyIdValue: string): Promise<JsonlEvent | undefined> {
    return (await this.options.eventStore.readAll()).slice().reverse().find((event) =>
      event.kind === "commander_executor_review_proposal_narrow_applied"
      && event.apply_id === applyIdValue)
  }

  private async findExisting(sessionHash: string): Promise<OpenCodeSessionPlan | undefined> {
    return (await this.sessions()).find((item) => item.status === "planned" && item.session_hash === sessionHash)
  }

  private async sessions(): Promise<OpenCodeSessionPlan[]> {
    return (await this.options.eventStore.readAll())
      .filter((event) => event.kind === "opencode_session_planned")
      .map(planFromEvent)
  }

  private async serializeCreate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.createQueue
    let release!: () => void
    this.createQueue = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

export function readOpenCodeSessionPreviewInput(value: unknown): OpenCodeSessionPreviewInput {
  return normalizePreviewInput(isRecord(value) ? value : {})
}

export function readOpenCodeSessionCreateInput(value: unknown): OpenCodeSessionCreateInput {
  return normalizeCreateInput(isRecord(value) ? value : {})
}

function normalizePreviewInput(input: Record<string, unknown>): OpenCodeSessionPreviewInput {
  return {
    mission_id: optional(input.mission_id ?? input.missionId ?? input.mission),
    proposal_id: optional(input.proposal_id ?? input.proposalId ?? input.proposal),
    review_request_id: optional(input.review_request_id ?? input.reviewRequestId ?? input.review),
    apply_id: optional(input.apply_id ?? input.applyId ?? input.apply),
    objective: optional(input.objective),
    title: optional(input.title),
    source_kind: readSourceKind(input.source_kind ?? input.sourceKind),
    max_context_bytes: optionalNumber(input.max_context_bytes ?? input.maxContextBytes),
    max_wall_time_ms: optionalNumber(input.max_wall_time_ms ?? input.maxWallTimeMs),
    max_no_progress_ms: optionalNumber(input.max_no_progress_ms ?? input.maxNoProgressMs),
    heartbeat_interval_ms: optionalNumber(input.heartbeat_interval_ms ?? input.heartbeatIntervalMs),
    created_by: optional(input.created_by ?? input.createdBy),
    include_authority: input.include_authority === false || input.includeAuthority === false ? false : undefined,
  }
}

function normalizeCreateInput(input: Record<string, unknown>): OpenCodeSessionCreateInput {
  return {
    ...normalizePreviewInput(input),
    dry_run: input.dry_run === true || input.dryRun === true,
    created_by: optional(input.created_by ?? input.createdBy),
  }
}

function planFromPreview(preview: OpenCodeSessionPreview, extra: { session_id: string; created_at: string; created_by: string; session_hash: string }): OpenCodeSessionPlan {
  return redactValue({
    session_id: extra.session_id,
    status: "planned",
    mission_id: preview.mission_id,
    proposal_id: preview.proposal_id,
    review_request_id: preview.review_request_id,
    apply_id: preview.apply_id,
    source_kind: preview.source_kind,
    objective: preview.objective_preview,
    title: preview.title_preview,
    commander_context_summary: preview.commander_context_summary_preview,
    opencode_context_seed: preview.opencode_context_seed_preview,
    shared_context_summary: bound(`Shared planning context for ${preview.source_kind}`),
    success_criteria: preview.success_criteria,
    constraints: preview.constraints,
    artifact_expectations: ["Bounded progress summary", "Blocking questions if tactical execution cannot proceed"],
    timeout_policy: preview.timeout_policy,
    question_policy: preview.question_policy,
    human_control_policy: preview.human_control_policy,
    created_at: extra.created_at,
    created_by: bound(extra.created_by),
    session_hash: extra.session_hash,
  })
}

function planFromEvent(event: JsonlEvent): OpenCodeSessionPlan {
  return redactValue({
    session_id: readEventString(event.session_id, "session_id"),
    status: "planned",
    mission_id: optional(event.mission_id),
    proposal_id: optional(event.proposal_id),
    review_request_id: optional(event.review_request_id),
    apply_id: optional(event.apply_id),
    source_kind: readSourceKind(event.source_kind) ?? "unknown",
    objective: readEventString(event.objective, "objective"),
    title: readEventString(event.title, "title"),
    commander_context_summary: readEventString(event.commander_context_summary, "commander_context_summary"),
    opencode_context_seed: readEventString(event.opencode_context_seed, "opencode_context_seed"),
    shared_context_summary: readEventString(event.shared_context_summary, "shared_context_summary"),
    success_criteria: boundList(event.success_criteria),
    constraints: boundList(event.constraints),
    artifact_expectations: boundList(event.artifact_expectations),
    timeout_policy: readTimeoutPolicy(event.timeout_policy),
    question_policy: readQuestionPolicy(event.question_policy),
    human_control_policy: readHumanPolicy(event.human_control_policy),
    created_at: readEventString(event.created_at, "created_at"),
    created_by: readEventString(event.created_by, "created_by"),
    session_hash: readEventString(event.session_hash, "session_hash"),
  })
}

function recordFromPlan(plan: OpenCodeSessionPlan): OpenCodeSessionRecord {
  return {
    session_id: plan.session_id,
    status: plan.status,
    title: plan.title,
    mission_id: plan.mission_id,
    proposal_id: plan.proposal_id,
    source_kind: plan.source_kind,
    created_at: plan.created_at,
    summary_preview: bound(plan.objective),
    session_hash: plan.session_hash,
  }
}

function timeoutPolicy(input: OpenCodeSessionPreviewInput): OpenCodeSessionTimeoutPolicy {
  const base = {
    max_wall_time_ms: boundedNumber(input.max_wall_time_ms, DEFAULT_MAX_WALL_TIME_MS, 60_000, MAX_WALL_TIME_MS),
    max_no_progress_ms: boundedNumber(input.max_no_progress_ms, DEFAULT_MAX_NO_PROGRESS_MS, 30_000, MAX_NO_PROGRESS_MS),
    heartbeat_interval_ms: boundedNumber(input.heartbeat_interval_ms, DEFAULT_HEARTBEAT_INTERVAL_MS, 5_000, MAX_HEARTBEAT_INTERVAL_MS),
    forced_pause_enabled: true,
    report_required_on_timeout: true,
  }
  return { ...base, timeout_policy_hash: sha256(stableJson(base)) }
}

function questionPolicy(): OpenCodeSessionQuestionPolicy {
  const base = {
    allow_opencode_questions: true,
    commander_answer_required_for_blockers: true,
    human_escalation_allowed: true,
    max_pending_questions: 3,
  }
  return { ...base, question_policy_hash: sha256(stableJson(base)) }
}

function humanControlPolicy(): OpenCodeSessionHumanControlPolicy {
  const base = {
    allow_human_pause: true,
    allow_human_override: true,
    allow_human_stop: true,
    allow_human_guidance_note: true,
    require_reason_for_stop: true,
  }
  return { ...base, human_policy_hash: sha256(stableJson(base)) }
}

function readTimeoutPolicy(value: unknown): OpenCodeSessionTimeoutPolicy {
  return isRecord(value) ? {
    max_wall_time_ms: boundedNumber(value.max_wall_time_ms, DEFAULT_MAX_WALL_TIME_MS, 60_000, MAX_WALL_TIME_MS),
    max_no_progress_ms: boundedNumber(value.max_no_progress_ms, DEFAULT_MAX_NO_PROGRESS_MS, 30_000, MAX_NO_PROGRESS_MS),
    heartbeat_interval_ms: boundedNumber(value.heartbeat_interval_ms, DEFAULT_HEARTBEAT_INTERVAL_MS, 5_000, MAX_HEARTBEAT_INTERVAL_MS),
    max_tool_idle_ms: optionalNumber(value.max_tool_idle_ms),
    forced_pause_enabled: value.forced_pause_enabled !== false,
    report_required_on_timeout: value.report_required_on_timeout !== false,
    timeout_policy_hash: optional(value.timeout_policy_hash) ?? sha256(stableJson(value)),
  } : timeoutPolicy({})
}

function readQuestionPolicy(value: unknown): OpenCodeSessionQuestionPolicy {
  return isRecord(value) ? {
    allow_opencode_questions: value.allow_opencode_questions !== false,
    commander_answer_required_for_blockers: value.commander_answer_required_for_blockers !== false,
    human_escalation_allowed: value.human_escalation_allowed !== false,
    max_pending_questions: boundedNumber(value.max_pending_questions, 3, 1, 20),
    question_policy_hash: optional(value.question_policy_hash) ?? sha256(stableJson(value)),
  } : questionPolicy()
}

function readHumanPolicy(value: unknown): OpenCodeSessionHumanControlPolicy {
  return isRecord(value) ? {
    allow_human_pause: value.allow_human_pause !== false,
    allow_human_override: value.allow_human_override !== false,
    allow_human_stop: value.allow_human_stop !== false,
    allow_human_guidance_note: value.allow_human_guidance_note !== false,
    require_reason_for_stop: value.require_reason_for_stop !== false,
    human_policy_hash: optional(value.human_policy_hash) ?? sha256(stableJson(value)),
  } : humanControlPolicy()
}

function sessionHashFor(preview: OpenCodeSessionPreview): string {
  return sha256(stableJson({
    source_kind: preview.source_kind,
    mission_id: preview.mission_id,
    proposal_id: preview.proposal_id,
    review_request_id: preview.review_request_id,
    apply_id: preview.apply_id,
    objective: preview.objective_preview,
  }))
}

function sessionId(hash: string): string {
  return `opencode_session_${hash.slice(0, 16)}`
}

function recommendedCommands(proposalId?: string, missionId?: string, sessionIdValue?: string): OpenCodeSessionCommand[] {
  const commands: OpenCodeSessionCommand[] = [
    { label: "Show authority", command: "/authority-show /opencode-session-plan", command_type: "read" },
    { label: "List sessions", command: "/opencode-sessions", command_type: "read" },
    { label: "Session summary", command: "/opencode-session-summary", command_type: "read" },
  ]
  if (sessionIdValue) commands.push({ label: "Show session", command: `/opencode-session-show ${sessionIdValue}`, command_type: "read" })
  if (proposalId) commands.push({ label: "Show proposal", command: `/proposal ${proposalId}`, command_type: "read" })
  if (missionId) commands.push({ label: "Show mission", command: `/mission ${missionId}`, command_type: "read" })
  return commands
}

function titleFromObjective(objective: string): string {
  return objective ? bound(`OpenCode session: ${objective}`) : ""
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = optionalNumber(value)
  if (parsed === undefined) return fallback
  return Math.max(min, Math.min(parsed, max))
}

function optionalNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : undefined
  return typeof number === "number" && Number.isFinite(number) ? Math.trunc(number) : undefined
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return boundList(value)
}

function boundList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => bound(String(item))).filter(Boolean).slice(0, MAX_ROWS)
}

function bound(value: string): string {
  return redactText(value).slice(0, MAX_TEXT)
}

function optional(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const bounded = bound(value.trim())
  return bounded ? bounded : undefined
}

function required(value: unknown, name: string): string {
  const result = optional(value)
  if (!result) throw new Error(`${name} is required`)
  return result
}

function readEventString(value: unknown, name: string): string {
  return required(value, name)
}

function readSourceKind(value: unknown): OpenCodeSessionSourceKind | undefined {
  if (value === "manual" || value === "proposal" || value === "mission" || value === "executor_review" || value === "research" || value === "unknown") return value
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stableJson(value: unknown): string {
  return JSON.stringify(stable(value))
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
