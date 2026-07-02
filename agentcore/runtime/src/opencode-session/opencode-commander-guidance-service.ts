import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { OpenCodeLaunchGateService } from "./opencode-launch-gate-service"
import type { OpenCodeCommanderQuestionService } from "./opencode-commander-question-service"
import type { OpenCodeCommanderQuestionResult } from "./opencode-commander-question-types"
import type { OpenCodeSessionService } from "./opencode-session-service"
import type {
  CommanderGuidanceAuthorKind,
  CommanderGuidanceCommand,
  CommanderGuidanceCreateInput,
  CommanderGuidanceDeliveryStatus,
  CommanderGuidancePreview,
  CommanderGuidancePreviewInput,
  CommanderGuidanceRecord,
  CommanderGuidanceResult,
  CommanderGuidanceScope,
  CommanderGuidanceStatus,
  CommanderGuidanceSummary,
} from "./opencode-commander-guidance-types"

const MAX_LIST = 100
const MAX_TEXT = 480
const MAX_RAW_TEXT = MAX_TEXT * 2
const MAX_ARRAY = 10
const LAUNCHED_STATUSES = new Set(["launch_started", "launched"])
const RAW_LOG_PATTERNS = [
  /\n.{80,}\n.{80,}\n/s,
  /(^|\s)(stdout|stderr|traceback|stack trace|bun test v|npm error|error:)(\s|$|:)/i,
  /(stdout|stderr|traceback|stack trace|bun test v|npm error|error:).{0,80}\n/i,
  /(\[[0-9]{2}:[0-9]{2}:[0-9]{2}\].*\n){3,}/i,
]

export type CommanderGuidanceServiceOptions = {
  eventStore: EventStore
  opencodeSessionService: OpenCodeSessionService
  launchGateService: OpenCodeLaunchGateService
  questionService: OpenCodeCommanderQuestionService
  now?: () => Date
  idFactory?: () => string
}

type SequencedGuidanceRecord = {
  record: CommanderGuidanceRecord
  event_index: number
}

export class CommanderGuidanceService {
  private readonly now: () => Date
  private readonly idFactory: () => string
  private createQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: CommanderGuidanceServiceOptions) {
    this.now = options.now ?? (() => new Date())
    this.idFactory = options.idFactory ?? (() => `commander_guidance_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`)
  }

  async preview(input: CommanderGuidancePreviewInput = {}): Promise<CommanderGuidancePreview> {
    return this.buildPreview(input)
  }

  async create(input: CommanderGuidanceCreateInput = {}): Promise<CommanderGuidanceResult> {
    const preview = await this.buildPreview(input)
    const guidanceId = this.idFactory()
    const createdAt = this.now().toISOString()
    const createdBy = bound(input.created_by ?? "operator") ?? "operator"
    if (preview.duplicate_guidance_id && input.dry_run !== true) {
      const repaired = await this.repairPartialQuestionAnswer(preview.duplicate_guidance_id)
      if (repaired) return repaired
    }
    if (!preview.can_create || preview.duplicate_guidance_id) {
      return resultFromPreview(preview, {
        guidance_id: guidanceId,
        status: "blocked",
        created_at: createdAt,
        created_by: createdBy,
        error: preview.duplicate_guidance_id ? "Commander guidance already exists for this question" : preview.blockers[0] ?? "Commander guidance is blocked",
      })
    }
    if (input.dry_run === true) {
      return resultFromPreview(preview, {
        guidance_id: guidanceId,
        status: "dry_run",
        created_at: createdAt,
        created_by: createdBy,
      })
    }
    return this.serializeCreate(async () => {
      const rebuilt = await this.buildPreview(input)
      if (rebuilt.duplicate_guidance_id) {
        const repaired = await this.repairPartialQuestionAnswerUnlocked(rebuilt.duplicate_guidance_id)
        if (repaired) return repaired
      }
      if (!rebuilt.can_create || rebuilt.duplicate_guidance_id) {
        return resultFromPreview(rebuilt, {
          guidance_id: guidanceId,
          status: "blocked",
          created_at: createdAt,
          created_by: createdBy,
          error: rebuilt.duplicate_guidance_id ? "Commander guidance already exists for this question" : rebuilt.blockers[0] ?? "Commander guidance is blocked",
        })
      }
      const result = resultFromPreview(rebuilt, {
        guidance_id: guidanceId,
        status: "created",
        created_at: createdAt,
        created_by: createdBy,
      })
      await this.options.eventStore.append(guidanceEventPayload(result) as JsonlEvent)
      await this.options.eventStore.append(questionAnsweredEventPayload(result) as JsonlEvent)
      return redactValue(result)
    })
  }

  async list(input: { limit?: number; session_id?: string; launch_id?: string; question_id?: string; status?: string; delivery_status?: string; guidance_scope?: string } = {}): Promise<CommanderGuidanceRecord[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, MAX_LIST))
    return (await this.sequencedRecords())
      .filter((item) => !input.session_id || item.record.session_id === input.session_id)
      .filter((item) => !input.launch_id || item.record.launch_id === input.launch_id)
      .filter((item) => !input.question_id || item.record.question_id === input.question_id)
      .filter((item) => !input.status || item.record.status === input.status)
      .filter((item) => !input.delivery_status || item.record.delivery_status === input.delivery_status)
      .filter((item) => !input.guidance_scope || item.record.guidance_scope === input.guidance_scope)
      .sort(compareSequencedDesc)
      .map((item) => item.record)
      .slice(0, limit)
  }

  async get(guidanceId: string): Promise<CommanderGuidanceResult | null> {
    const event = (await this.options.eventStore.readAll())
      .filter(isGuidanceCreatedEvent)
      .reverse()
      .find((item) => item.guidance_id === guidanceId)
    return event ? resultFromEvent(event) : null
  }

  async latest(input: { session_id?: string; launch_id?: string; question_id?: string } = {}): Promise<CommanderGuidanceResult | null> {
    const latest = (await this.list({ ...input, limit: 1 }))[0]
    return latest ? this.get(latest.guidance_id) : null
  }

  async summary(input: { limit?: number } = {}): Promise<CommanderGuidanceSummary> {
    const records = (await this.sequencedRecords()).sort(compareSequencedDesc).map((item) => item.record)
    const limit = Math.max(1, Math.min(input.limit ?? 10, MAX_LIST))
    const byScope: Record<string, number> = {}
    for (const record of records) byScope[record.guidance_scope] = (byScope[record.guidance_scope] ?? 0) + 1
    return redactValue({
      total_guidance: records.length,
      created_count: records.filter((record) => record.status === "created").length,
      not_delivered_count: records.filter((record) => record.delivery_status === "not_delivered").length,
      pending_delivery_count: records.filter((record) => record.delivery_status === "pending_delivery").length,
      delivered_count: records.filter((record) => record.delivery_status === "delivered").length,
      cancelled_count: records.filter((record) => record.status === "cancelled").length,
      by_scope_counts: byScope,
      latest_guidance: records.slice(0, limit),
      generated_at: this.now().toISOString(),
    })
  }

  private async buildPreview(input: CommanderGuidancePreviewInput = {}): Promise<CommanderGuidancePreview> {
    const generatedAt = this.now().toISOString()
    const blockers: string[] = []
    const warnings = new Set<string>([
      "Commander guidance records are not delivered to OpenCode in 9H",
      "no provider, MCP, OpenCode prompt, wake execution, research.db write, or mission mutation occurs",
    ])
    const questionId = optional(input.question_id) ?? ""
    if (!questionId) blockers.push("question_id is required")
    const question = questionId ? await this.options.questionService.get(questionId) : null
    if (questionId && !question) blockers.push("question_id does not resolve to an OpenCodeCommanderQuestion")
    if (question && question.question_status !== "pending_commander" && question.question_status !== "pending_human") blockers.push("question is already answered or no longer pending")
    if (question?.session_id && !await this.options.opencodeSessionService.get(question.session_id)) blockers.push("linked session does not resolve to a planned OpenCode session")
    if (question?.launch_id) {
      const launch = await this.options.launchGateService.get(question.launch_id)
      if (!launch) blockers.push("linked launch does not resolve to an OpenCode launch record")
      else if (!LAUNCHED_STATUSES.has(launch.status)) blockers.push(`Commander guidance requires launch_started or launched status; current status is ${launch.status}`)
      if (launch && question.session_id && launch.session_id !== question.session_id) blockers.push("linked launch does not belong to question session")
    } else if (question) {
      blockers.push("Commander guidance requires a linked OpenCode launch record")
    }
    const answer = bound(input.answer)
    if (!answer) blockers.push("answer text is required")
    const rawLogBlocked = guidanceInputLooksLikeRawLog(input)
    if (rawLogBlocked) blockers.push("raw logs are out of scope for Commander guidance records; attach artifact pointers instead")
    const guidanceScope = readGuidanceScope(input.guidance_scope, defaultGuidanceScope(question))
    const authorKind = readAuthorKind(input.author_kind)
    const rationale = bound(input.rationale)
    const constraints = boundArray(input.constraints)
    const specRefs = boundArray(input.spec_refs)
    const researchRefs = boundArray(input.research_refs)
    const artifactRefs = boundArray(input.artifact_refs)
    const deliveryNote = bound(input.delivery_note) ?? "guidance recorded only; delivery to OpenCode is future work"
    const guidanceHash = hash(stableJson({
      question_id: questionId,
      answer: normalize(answer ?? ""),
      guidance_scope: guidanceScope,
      constraints,
      spec_refs: specRefs,
      research_refs: researchRefs,
      artifact_refs: artifactRefs,
    }))
    const duplicate = questionId ? await this.findDuplicate(questionId) : undefined
    if (duplicate) blockers.push("Commander guidance already exists for this question")
    if (question?.question_type === "blocker" && constraints.length === 0) warnings.add("blocker questions should include explicit constraints when available")
    const canCreate = blockers.length === 0
    return redactValue({
      preview_id: `commander_guidance_preview_${guidanceHash.slice(0, 16)}`,
      status: canCreate ? "ready" : "blocked",
      can_create: canCreate,
      question_id: questionId,
      question_status: question?.question_status,
      session_id: question?.session_id ?? "",
      launch_id: question?.launch_id,
      progress_id: question?.progress_id,
      watchdog_id: question?.watchdog_id,
      forced_report_request_id: question?.forced_report_request_id,
      guidance_scope: guidanceScope,
      author_kind: authorKind,
      answer_preview: rawLogBlocked ? "raw answer log omitted; attach artifact pointer instead" : answer ?? "",
      rationale_preview: rawLogBlocked ? undefined : rationale,
      constraints_preview: rawLogBlocked ? [] : constraints,
      spec_refs_preview: rawLogBlocked ? [] : specRefs,
      research_refs_preview: rawLogBlocked ? [] : researchRefs,
      artifact_refs_preview: rawLogBlocked ? [] : artifactRefs,
      delivery_status: "not_delivered",
      delivery_note_preview: rawLogBlocked ? "raw delivery note omitted" : deliveryNote,
      duplicate_guidance_id: duplicate?.guidance_id,
      blockers: boundArray(unique(blockers)),
      warnings: boundArray(unique([...warnings])),
      recommended_commands: recommendedCommands(questionId || "<question_id>"),
      generated_at: generatedAt,
      redacted_summary_preview: canCreate ? `Commander guidance ${guidanceScope} for ${questionId}` : blockers[0] ?? "Commander guidance blocked",
      guidance_hash: guidanceHash,
    })
  }

  private async findDuplicate(questionId: string): Promise<CommanderGuidanceRecord | undefined> {
    return (await this.sequencedRecords()).find(({ record }) => record.question_id === questionId && record.status !== "cancelled" && record.status !== "superseded")?.record
  }

  private async repairPartialQuestionAnswer(guidanceId: string): Promise<CommanderGuidanceResult | null> {
    return this.serializeCreate(() => this.repairPartialQuestionAnswerUnlocked(guidanceId))
  }

  private async repairPartialQuestionAnswerUnlocked(guidanceId: string): Promise<CommanderGuidanceResult | null> {
    const existing = await this.get(guidanceId)
    if (!existing) return null
    if (await this.hasQuestionAnsweredEvent(existing.question_id, existing.guidance_id)) return null
    await this.options.eventStore.append(questionAnsweredEventPayload(existing) as JsonlEvent)
    return redactValue(existing)
  }

  private async hasQuestionAnsweredEvent(questionId: string, guidanceId: string): Promise<boolean> {
    return (await this.options.eventStore.readAll())
      .some((event) => isQuestionAnsweredEvent(event) && event.question_id === questionId && event.guidance_id === guidanceId)
  }

  private async sequencedRecords(): Promise<SequencedGuidanceRecord[]> {
    return (await this.options.eventStore.readAll())
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => isGuidanceCreatedEvent(event))
      .map(({ event, index }) => ({ record: recordFromEvent(event)!, event_index: index }))
      .filter((item) => Boolean(item.record))
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

export function readCommanderGuidancePreviewInput(value: unknown): CommanderGuidancePreviewInput {
  const input = isRecord(value) ? value : {}
  return {
    question_id: optional(input.questionId ?? input.question_id ?? input.question),
    answer: optionalRawText(input.answer),
    guidance_scope: optional(input.guidanceScope ?? input.guidance_scope ?? input.scope),
    author_kind: optional(input.authorKind ?? input.author_kind ?? input.author),
    rationale: optionalRawText(input.rationale),
    constraints: optionalRawStringArray(input.constraints),
    spec_refs: optionalRawStringArray(input.specRefs ?? input.spec_refs),
    research_refs: optionalRawStringArray(input.researchRefs ?? input.research_refs),
    artifact_refs: optionalRawStringArray(input.artifactRefs ?? input.artifact_refs),
    delivery_note: optionalRawText(input.deliveryNote ?? input.delivery_note),
  }
}

export function readCommanderGuidanceCreateInput(value: unknown): CommanderGuidanceCreateInput {
  const input = isRecord(value) ? value : {}
  return {
    ...readCommanderGuidancePreviewInput(value),
    dry_run: optionalBoolean(input.dryRun ?? input.dry_run),
    created_by: optional(input.createdBy ?? input.created_by),
  }
}

function resultFromPreview(preview: CommanderGuidancePreview, overrides: { guidance_id: string; status: CommanderGuidanceResult["status"]; created_at: string; created_by: string; error?: string }): CommanderGuidanceResult {
  return redactValue({
    guidance_id: overrides.guidance_id,
    status: overrides.status,
    guidance_status: "created",
    delivery_status: "not_delivered",
    question_id: preview.question_id,
    question_status_after: overrides.status === "created" ? "answered" : undefined,
    session_id: preview.session_id,
    launch_id: preview.launch_id,
    progress_id: preview.progress_id,
    watchdog_id: preview.watchdog_id,
    forced_report_request_id: preview.forced_report_request_id,
    guidance_scope: preview.guidance_scope,
    author_kind: preview.author_kind,
    answer_preview: preview.answer_preview,
    rationale_preview: preview.rationale_preview,
    constraints_preview: preview.constraints_preview,
    spec_refs_preview: preview.spec_refs_preview,
    research_refs_preview: preview.research_refs_preview,
    artifact_refs_preview: preview.artifact_refs_preview,
    delivery_note_preview: preview.delivery_note_preview,
    created_at: overrides.created_at,
    created_by: bound(overrides.created_by) ?? "operator",
    error: bound(overrides.error),
    guidance_hash: preview.guidance_hash,
    recommended_commands: preview.recommended_commands,
  })
}

function guidanceEventPayload(result: CommanderGuidanceResult): Record<string, unknown> {
  return redactValue({
    kind: "opencode_commander_guidance_created",
    guidance_id: result.guidance_id,
    guidance_status: "created",
    delivery_status: "not_delivered",
    question_id: result.question_id,
    session_id: result.session_id,
    launch_id: result.launch_id,
    progress_id: result.progress_id,
    watchdog_id: result.watchdog_id,
    forced_report_request_id: result.forced_report_request_id,
    guidance_scope: result.guidance_scope,
    author_kind: result.author_kind,
    answer_preview: result.answer_preview,
    rationale_preview: result.rationale_preview,
    constraints_preview: result.constraints_preview,
    spec_refs_preview: result.spec_refs_preview,
    research_refs_preview: result.research_refs_preview,
    artifact_refs_preview: result.artifact_refs_preview,
    delivery_note_preview: result.delivery_note_preview,
    created_at: result.created_at,
    created_by: result.created_by,
    guidance_hash: result.guidance_hash,
  })
}

function questionAnsweredEventPayload(result: CommanderGuidanceResult): Record<string, unknown> {
  return redactValue({
    kind: "opencode_commander_question_answered",
    question_id: result.question_id,
    guidance_id: result.guidance_id,
    session_id: result.session_id,
    launch_id: result.launch_id,
    answered_at: result.created_at,
    answered_by: result.created_by,
    question_status: "answered",
    answer_preview: result.answer_preview,
    guidance_hash: result.guidance_hash,
  })
}

function resultFromEvent(event: JsonlEvent): CommanderGuidanceResult {
  return redactValue({
    guidance_id: String(event.guidance_id ?? ""),
    status: "created",
    guidance_status: readGuidanceStatus(event.guidance_status),
    delivery_status: readDeliveryStatus(event.delivery_status),
    question_id: String(event.question_id ?? ""),
    question_status_after: "answered",
    session_id: String(event.session_id ?? ""),
    launch_id: typeof event.launch_id === "string" ? event.launch_id : undefined,
    progress_id: typeof event.progress_id === "string" ? event.progress_id : undefined,
    watchdog_id: typeof event.watchdog_id === "string" ? event.watchdog_id : undefined,
    forced_report_request_id: typeof event.forced_report_request_id === "string" ? event.forced_report_request_id : undefined,
    guidance_scope: readGuidanceScope(event.guidance_scope),
    author_kind: readAuthorKind(event.author_kind),
    answer_preview: bound(event.answer_preview) ?? "",
    rationale_preview: bound(event.rationale_preview),
    constraints_preview: boundArray(Array.isArray(event.constraints_preview) ? event.constraints_preview : []),
    spec_refs_preview: boundArray(Array.isArray(event.spec_refs_preview) ? event.spec_refs_preview : []),
    research_refs_preview: boundArray(Array.isArray(event.research_refs_preview) ? event.research_refs_preview : []),
    artifact_refs_preview: boundArray(Array.isArray(event.artifact_refs_preview) ? event.artifact_refs_preview : []),
    delivery_note_preview: bound(event.delivery_note_preview) ?? "guidance recorded only; delivery to OpenCode is future work",
    created_at: typeof event.created_at === "string" ? event.created_at : "",
    created_by: bound(event.created_by) ?? "unknown",
    guidance_hash: typeof event.guidance_hash === "string" ? event.guidance_hash : hash(stableJson(event)),
    recommended_commands: recommendedCommands(String(event.question_id ?? "<question_id>")),
  })
}

function recordFromEvent(event: JsonlEvent): CommanderGuidanceRecord | null {
  if (typeof event.guidance_id !== "string" || typeof event.question_id !== "string" || typeof event.session_id !== "string") return null
  return redactValue({
    guidance_id: event.guidance_id,
    status: readGuidanceStatus(event.guidance_status),
    delivery_status: readDeliveryStatus(event.delivery_status),
    question_id: event.question_id,
    session_id: event.session_id,
    launch_id: typeof event.launch_id === "string" ? event.launch_id : undefined,
    guidance_scope: readGuidanceScope(event.guidance_scope),
    author_kind: readAuthorKind(event.author_kind),
    answer_preview: bound(event.answer_preview) ?? "",
    created_at: typeof event.created_at === "string" ? event.created_at : "",
    created_by: bound(event.created_by) ?? "unknown",
    has_constraints: Array.isArray(event.constraints_preview) && event.constraints_preview.length > 0,
    has_refs: (Array.isArray(event.spec_refs_preview) && event.spec_refs_preview.length > 0)
      || (Array.isArray(event.research_refs_preview) && event.research_refs_preview.length > 0)
      || (Array.isArray(event.artifact_refs_preview) && event.artifact_refs_preview.length > 0),
    guidance_hash: typeof event.guidance_hash === "string" ? event.guidance_hash : hash(stableJson(event)),
  })
}

function isGuidanceCreatedEvent(event: JsonlEvent): boolean {
  return event.kind === "opencode_commander_guidance_created"
}

function isQuestionAnsweredEvent(event: JsonlEvent): boolean {
  return event.kind === "opencode_commander_question_answered"
}

function readGuidanceStatus(value: unknown): CommanderGuidanceStatus {
  return value === "draft" || value === "superseded" || value === "delivered" || value === "cancelled" ? value : "created"
}

function readDeliveryStatus(value: unknown): CommanderGuidanceDeliveryStatus {
  return value === "pending_delivery" || value === "delivered" || value === "delivery_failed" ? value : "not_delivered"
}

function readGuidanceScope(value: unknown, fallback: CommanderGuidanceScope = "answer_question"): CommanderGuidanceScope {
  return value === "answer_question" || value === "clarification" || value === "constraint" || value === "design_direction" || value === "permission_decision" || value === "status_report_response" || value === "timeout_report_response" || value === "blocker_resolution" || value === "unknown" ? value : fallback
}

function readAuthorKind(value: unknown): CommanderGuidanceAuthorKind {
  return value === "commander_manual" || value === "system" || value === "unknown" ? value : "human"
}

function defaultGuidanceScope(question: OpenCodeCommanderQuestionResult | null): CommanderGuidanceScope {
  if (question?.question_type === "blocker") return "blocker_resolution"
  if (question?.question_type === "permission") return "permission_decision"
  if (question?.question_type === "timeout_report" || question?.question_type === "status_report_request") return "status_report_response"
  if (question?.question_type === "design_choice") return "design_direction"
  return "answer_question"
}

function recommendedCommands(questionId: string): CommanderGuidanceCommand[] {
  return [
    { label: "Create guidance", command: `/commander-guidance question=${questionId} answer=<answer>`, command_type: "write", requires_active_runtime: true, notes: "metadata only; no OpenCode delivery or provider call" },
    { label: "List guidance", command: `/commander-guidance-list question=${questionId}`, command_type: "read" },
    { label: "Latest guidance", command: `/commander-guidance-latest question=${questionId}`, command_type: "read" },
  ]
}

function guidanceInputLooksLikeRawLog(input: CommanderGuidancePreviewInput): boolean {
  const values = [
    input.answer,
    input.rationale,
    input.delivery_note,
    ...(input.constraints ?? []),
    ...(input.spec_refs ?? []),
    ...(input.research_refs ?? []),
    ...(input.artifact_refs ?? []),
  ].filter((item): item is string => typeof item === "string")
  return values.some(looksLikeRawLog)
}

function looksLikeRawLog(value: string): boolean {
  if (value.trim().length > MAX_RAW_TEXT) return true
  return RAW_LOG_PATTERNS.some((pattern) => pattern.test(value))
}

function optionalRawText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? bound(value) : undefined
}

function optionalRawStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, MAX_ARRAY)
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, MAX_ARRAY)
  return undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : value === "true" ? true : value === "false" ? false : undefined
}

function bound(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value !== "string") return undefined
  const redacted = redactText(value.trim())
  if (!redacted) return undefined
  return redacted.length > max ? `${redacted.slice(0, max - 1)}…` : redacted
}

function boundArray(values: unknown, maxItems = MAX_ARRAY): string[] {
  if (!Array.isArray(values)) return []
  return values.map((item) => bound(item)).filter((item): item is string => Boolean(item)).slice(0, maxItems)
}

function normalize(value: string): string {
  return redactText(value).toLowerCase().replace(/\s+/g, " ").trim()
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function compareSequencedDesc(left: SequencedGuidanceRecord, right: SequencedGuidanceRecord): number {
  const time = right.record.created_at.localeCompare(left.record.created_at)
  if (time !== 0) return time
  return right.event_index - left.event_index
}
