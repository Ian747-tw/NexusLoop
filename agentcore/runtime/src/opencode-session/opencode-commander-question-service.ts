import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { OpenCodeLaunchGateService } from "./opencode-launch-gate-service"
import type { OpenCodeLaunchRecord, OpenCodeLaunchResult } from "./opencode-launch-gate-types"
import type { OpenCodeProgressService } from "./opencode-progress-service"
import type { OpenCodeProgressResult } from "./opencode-progress-types"
import type { OpenCodeTimeoutWatchdogService } from "./opencode-timeout-watchdog-service"
import type { OpenCodeForcedReportRequest, OpenCodeWatchdogResult } from "./opencode-timeout-watchdog-types"
import type { OpenCodeSessionService } from "./opencode-session-service"
import type {
  OpenCodeCommanderQuestionCommand,
  OpenCodeCommanderQuestionCreateInput,
  OpenCodeCommanderQuestionPreview,
  OpenCodeCommanderQuestionPreviewInput,
  OpenCodeCommanderQuestionRecord,
  OpenCodeCommanderQuestionResult,
  OpenCodeCommanderQuestionSourceKind,
  OpenCodeCommanderQuestionStatus,
  OpenCodeCommanderQuestionSummary,
  OpenCodeCommanderQuestionType,
  OpenCodeCommanderQuestionUrgency,
} from "./opencode-commander-question-types"

const MAX_LIST = 100
const MAX_TEXT = 360
const MAX_ARRAY = 8
const LAUNCHED_STATUSES = new Set(["launch_started", "launched"])
const RAW_LOG_PATTERNS = [
  /\n.{80,}\n.{80,}\n/s,
  /(stdout|stderr|traceback|stack trace|bun test v|npm error|error:).{0,80}\n/i,
  /(\[[0-9]{2}:[0-9]{2}:[0-9]{2}\].*\n){3,}/i,
]

export type OpenCodeCommanderQuestionServiceOptions = {
  eventStore: EventStore
  opencodeSessionService: OpenCodeSessionService
  launchGateService: OpenCodeLaunchGateService
  progressService: OpenCodeProgressService
  watchdogService: OpenCodeTimeoutWatchdogService
  now?: () => Date
  idFactory?: () => string
}

type EvidenceBundle = {
  sessionId: string
  launchId?: string
  launch?: OpenCodeLaunchResult | OpenCodeLaunchRecord | null
  progress?: OpenCodeProgressResult | null
  watchdog?: OpenCodeWatchdogResult | null
  forcedReport?: OpenCodeForcedReportRequest | null
}

type SequencedQuestionRecord = {
  record: OpenCodeCommanderQuestionRecord
  event_index: number
}

export class OpenCodeCommanderQuestionService {
  private readonly now: () => Date
  private readonly idFactory: () => string

  constructor(private readonly options: OpenCodeCommanderQuestionServiceOptions) {
    this.now = options.now ?? (() => new Date())
    this.idFactory = options.idFactory ?? (() => `opencode_commander_question_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`)
  }

  async preview(input: OpenCodeCommanderQuestionPreviewInput = {}): Promise<OpenCodeCommanderQuestionPreview> {
    return this.buildPreview(input)
  }

  async create(input: OpenCodeCommanderQuestionCreateInput = {}): Promise<OpenCodeCommanderQuestionResult> {
    const preview = await this.buildPreview(input)
    const questionId = this.idFactory()
    const createdAt = this.now().toISOString()
    const createdBy = bound(input.created_by ?? "operator") ?? "operator"
    if (!preview.can_create) {
      return resultFromPreview(preview, {
        question_id: questionId,
        status: "blocked",
        created_at: createdAt,
        created_by: createdBy,
        error: preview.blockers[0] ?? "OpenCode Commander question is blocked",
      })
    }
    if (preview.duplicate_question_id) {
      return resultFromPreview(preview, {
        question_id: questionId,
        status: "blocked",
        created_at: createdAt,
        created_by: createdBy,
        error: "pending Commander question already exists for this evidence",
      })
    }
    if (input.dry_run === true) {
      return resultFromPreview(preview, {
        question_id: questionId,
        status: "dry_run",
        created_at: createdAt,
        created_by: createdBy,
      })
    }
    const result = resultFromPreview(preview, {
      question_id: questionId,
      status: "created",
      created_at: createdAt,
      created_by: createdBy,
    })
    await this.options.eventStore.append(questionEventPayload(result) as JsonlEvent)
    return redactValue(result)
  }

  async list(input: { limit?: number; session_id?: string; launch_id?: string; status?: string; question_type?: string; urgency?: string } = {}): Promise<OpenCodeCommanderQuestionRecord[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, MAX_LIST))
    return (await this.sequencedRecords())
      .filter((item) => !input.session_id || item.record.session_id === input.session_id)
      .filter((item) => !input.launch_id || item.record.launch_id === input.launch_id)
      .filter((item) => !input.status || item.record.status === input.status)
      .filter((item) => !input.question_type || item.record.question_type === input.question_type)
      .filter((item) => !input.urgency || item.record.urgency === input.urgency)
      .sort(compareSequencedDesc)
      .map((item) => item.record)
      .slice(0, limit)
  }

  async get(questionId: string): Promise<OpenCodeCommanderQuestionResult | null> {
    const event = (await this.options.eventStore.readAll())
      .filter(isQuestionEvent)
      .reverse()
      .find((item) => item.question_id === questionId)
    return event ? resultFromEvent(event) : null
  }

  async latest(input: { session_id?: string; launch_id?: string } = {}): Promise<OpenCodeCommanderQuestionResult | null> {
    const latest = (await this.list({ ...input, limit: 1 }))[0]
    return latest ? this.get(latest.question_id) : null
  }

  async summary(input: { limit?: number } = {}): Promise<OpenCodeCommanderQuestionSummary> {
    const records = (await this.sequencedRecords()).sort(compareSequencedDesc).map((item) => item.record)
    const limit = Math.max(1, Math.min(input.limit ?? 10, MAX_LIST))
    return redactValue({
      total_questions: records.length,
      pending_commander_count: records.filter((record) => record.status === "pending_commander").length,
      pending_human_count: records.filter((record) => record.status === "pending_human").length,
      withdrawn_count: records.filter((record) => record.status === "withdrawn").length,
      superseded_count: records.filter((record) => record.status === "superseded").length,
      answered_count: records.filter((record) => record.status === "answered").length,
      urgent_count: records.filter((record) => record.urgency === "urgent").length,
      blocked_type_count: records.filter((record) => record.question_type === "blocker").length,
      latest_questions: records.slice(0, limit),
      generated_at: this.now().toISOString(),
    })
  }

  private async buildPreview(input: OpenCodeCommanderQuestionPreviewInput = {}): Promise<OpenCodeCommanderQuestionPreview> {
    const generatedAt = this.now().toISOString()
    const blockers: string[] = []
    const warnings = new Set<string>([
      "question records do not answer Commander questions, inject guidance, prompt OpenCode, call providers, run wake supervision, mutate missions, or write research.db",
      "Commander answer and guidance are future 9H work",
    ])
    const evidence = await this.resolveEvidence(input, blockers)
    const sessionId = evidence.sessionId
    const launchId = evidence.launchId

    if (!input.session_id && !input.launch_id && !input.progress_id && !input.watchdog_id && !input.forced_report_request_id) {
      blockers.push("session_id, launch_id, progress_id, watchdog_id, or forced_report_request_id is required")
    }
    const explicitQuestion = bound(input.question)
    const evidenceQuestion = evidence.progress?.question_preview
      ?? (evidence.progress?.blockers_preview?.length ? `OpenCode is blocked: ${evidence.progress.blockers_preview.join("; ")}` : undefined)
      ?? evidence.forcedReport?.reason
      ?? (evidence.watchdog ? `OpenCode watchdog ${evidence.watchdog.watchdog_status} requires Commander attention` : undefined)
    const question = explicitQuestion ?? bound(evidenceQuestion)
    const contextSummary = bound(input.context_summary)
      ?? evidence.progress?.report_summary_preview
      ?? (evidence.watchdog ? `OpenCode watchdog ${evidence.watchdog.watchdog_status} requires Commander attention` : undefined)
      ?? evidence.forcedReport?.command_to_operator_preview
      ?? "Commander question source is bounded runtime metadata"
    const options = boundArray(input.options_considered)
    const recommendation = bound(input.executor_recommendation)
    const evidenceSummary = evidenceSummaryPreview(evidence)
    const rawLogBlocked = questionInputLooksLikeRawLog(input)
    if (rawLogBlocked) blockers.push("raw logs are out of scope for Commander question records; attach an artifact pointer in a later branch")
    if (!question) blockers.push("question text is required unless linked evidence provides a bounded question or blocker")
    const questionType = readQuestionType(input.question_type, defaultQuestionType(evidence))
    const urgency = readUrgency(input.urgency, defaultUrgency(evidence))
    const sourceKind = readSourceKind(input.source_kind, defaultSourceKind(evidence))
    const evidenceKey = evidence.forcedReport?.request_id ?? evidence.watchdog?.watchdog_id ?? evidence.progress?.progress_id ?? launchId ?? sessionId
    const questionHash = hash(stableJson({
      session_id: sessionId,
      launch_id: launchId,
      progress_id: evidence.progress?.progress_id,
      watchdog_id: evidence.watchdog?.watchdog_id,
      forced_report_request_id: evidence.forcedReport?.request_id,
      evidence_key: evidenceKey,
      question: normalize(question ?? ""),
      question_type: questionType,
    }))
    const duplicate = sessionId ? await this.findDuplicate(sessionId, evidenceKey, questionHash) : undefined
    if (duplicate) blockers.push("pending Commander question already exists for this evidence")
    const canCreate = blockers.length === 0
    return redactValue({
      preview_id: `opencode_commander_question_preview_${questionHash.slice(0, 16)}`,
      status: canCreate ? "ready" : "blocked",
      can_create: canCreate,
      session_id: sessionId,
      launch_id: launchId,
      progress_id: evidence.progress?.progress_id,
      watchdog_id: evidence.watchdog?.watchdog_id,
      forced_report_request_id: evidence.forcedReport?.request_id,
      question_type: questionType,
      urgency,
      question_preview: rawLogBlocked ? "raw question log omitted; attach artifact pointer in a later branch" : question ?? "",
      context_summary_preview: rawLogBlocked ? "raw context log omitted; attach artifact pointer in a later branch" : contextSummary,
      options_considered_preview: rawLogBlocked ? [] : options,
      executor_recommendation_preview: rawLogBlocked ? undefined : recommendation,
      evidence_summary_preview: rawLogBlocked ? undefined : evidenceSummary,
      source_kind: sourceKind,
      duplicate_question_id: duplicate?.question_id,
      blockers: boundArray(unique(blockers)),
      warnings: boundArray(unique([...warnings])),
      recommended_commands: recommendedCommands(sessionId || "<session_id>"),
      generated_at: generatedAt,
      redacted_summary_preview: canCreate ? `OpenCode asks Commander ${questionType} for ${sessionId}` : blockers[0] ?? "OpenCode Commander question blocked",
      question_hash: questionHash,
    })
  }

  private async resolveEvidence(input: OpenCodeCommanderQuestionPreviewInput, blockers: string[]): Promise<EvidenceBundle> {
    let sessionId = optionalBoundedMetadata(input.session_id) ?? ""
    let launchId = optionalBoundedMetadata(input.launch_id)
    let progress: OpenCodeProgressResult | null = null
    let watchdog: OpenCodeWatchdogResult | null = null
    let forcedReport: OpenCodeForcedReportRequest | null = null
    if (input.progress_id) {
      progress = await this.options.progressService.get(input.progress_id)
      if (!progress) blockers.push("progress_id does not resolve to an OpenCode progress record")
      if (progress) {
        sessionId = sessionId || progress.session_id
        launchId = launchId || progress.launch_id
      }
    }
    if (input.watchdog_id) {
      watchdog = await this.options.watchdogService.get(input.watchdog_id)
      if (!watchdog) blockers.push("watchdog_id does not resolve to an OpenCode watchdog record")
      if (watchdog) {
        sessionId = sessionId || watchdog.session_id
        launchId = launchId || watchdog.launch_id
      }
    }
    if (input.forced_report_request_id) {
      forcedReport = await this.options.watchdogService.getForcedReport(input.forced_report_request_id)
      if (!forcedReport) blockers.push("forced_report_request_id does not resolve to an OpenCode forced-report request")
      if (forcedReport) {
        sessionId = sessionId || forcedReport.session_id
        launchId = launchId || forcedReport.launch_id
      }
    }
    let launch: OpenCodeLaunchResult | OpenCodeLaunchRecord | null = null
    if (launchId) {
      launch = await this.options.launchGateService.get(launchId)
      if (!launch) blockers.push("launch_id does not resolve to an OpenCode launch record")
    } else if (sessionId) {
      const launches = await this.options.launchGateService.list({ session_id: sessionId, limit: 100 })
      launch = launches.find((item) => LAUNCHED_STATUSES.has(item.status)) ?? null
      launchId = launch?.launch_id
      if (!launch) blockers.push("OpenCode Commander question requires a launch record for the session")
    }
    if (launch && !LAUNCHED_STATUSES.has(launch.status)) blockers.push(`OpenCode Commander question requires launch_started or launched status; current status is ${launch.status}`)
    if (launch && sessionId && launch.session_id !== sessionId) blockers.push("launch_id does not belong to session_id")
    sessionId = sessionId || launch?.session_id || ""
	    if (sessionId) {
	      const session = await this.options.opencodeSessionService.get(sessionId)
	      if (!session) blockers.push("session_id does not resolve to a planned OpenCode session")
	      if (session && session.question_policy.allow_opencode_questions === false) blockers.push("planned OpenCode session question policy does not allow OpenCode Commander questions")
	    }
    if (progress && sessionId && progress.session_id !== sessionId) blockers.push("progress_id does not belong to session_id")
    if (progress && launchId && progress.launch_id && progress.launch_id !== launchId) blockers.push("progress_id does not belong to launch_id")
    if (progress && !isQuestionEligibleProgress(progress)) blockers.push("progress_id must reference question/blocker/needs_commander/blocked/needs_human evidence")
    if (watchdog && sessionId && watchdog.session_id !== sessionId) blockers.push("watchdog_id does not belong to session_id")
    if (watchdog && launchId && watchdog.launch_id && watchdog.launch_id !== launchId) blockers.push("watchdog_id does not belong to launch_id")
    if (watchdog && !["blocked", "needs_report", "stale", "timed_out"].includes(watchdog.watchdog_status)) blockers.push("watchdog_id must reference blocked, needs_report, stale, or timed_out evidence")
    if (forcedReport && sessionId && forcedReport.session_id !== sessionId) blockers.push("forced_report_request_id does not belong to session_id")
    if (forcedReport && launchId && forcedReport.launch_id && forcedReport.launch_id !== launchId) blockers.push("forced_report_request_id does not belong to launch_id")
    return { sessionId, launchId, launch, progress, watchdog, forcedReport }
  }

  private async findDuplicate(sessionId: string, evidenceKey: string | undefined, questionHash: string): Promise<OpenCodeCommanderQuestionRecord | undefined> {
    if (!evidenceKey) return undefined
    return (await this.sequencedRecords())
      .find(({ record }) => record.session_id === sessionId && (record.status === "pending_commander" || record.status === "pending_human") && record.question_hash === questionHash)
      ?.record
  }

  private async sequencedRecords(): Promise<SequencedQuestionRecord[]> {
    return (await this.options.eventStore.readAll())
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => isQuestionEvent(event))
      .map(({ event, index }) => ({ record: recordFromEvent(event)!, event_index: index }))
      .filter((item) => Boolean(item.record))
  }
}

export function readOpenCodeCommanderQuestionPreviewInput(value: unknown): OpenCodeCommanderQuestionPreviewInput {
  const input = isRecord(value) ? value : {}
  return {
    session_id: optional(input.sessionId ?? input.session_id ?? input.session),
    launch_id: optional(input.launchId ?? input.launch_id ?? input.launch),
    progress_id: optional(input.progressId ?? input.progress_id ?? input.progress),
    watchdog_id: optional(input.watchdogId ?? input.watchdog_id ?? input.watchdog),
    forced_report_request_id: optional(input.forcedReportRequestId ?? input.forced_report_request_id ?? input.forcedReport ?? input.forced_report),
    question: optional(input.question),
    question_type: optional(input.questionType ?? input.question_type ?? input.type),
    urgency: optional(input.urgency),
    context_summary: optional(input.contextSummary ?? input.context_summary ?? input.context),
    options_considered: optionalStringArray(input.optionsConsidered ?? input.options_considered ?? input.options),
    executor_recommendation: optional(input.executorRecommendation ?? input.executor_recommendation ?? input.recommendation),
    source_kind: optional(input.sourceKind ?? input.source_kind ?? input.source),
  }
}

export function readOpenCodeCommanderQuestionCreateInput(value: unknown): OpenCodeCommanderQuestionCreateInput {
  const input = isRecord(value) ? value : {}
  return {
    ...readOpenCodeCommanderQuestionPreviewInput(value),
    dry_run: optionalBoolean(input.dryRun ?? input.dry_run),
    created_by: optional(input.createdBy ?? input.created_by),
  }
}

function resultFromPreview(preview: OpenCodeCommanderQuestionPreview, overrides: { question_id: string; status: OpenCodeCommanderQuestionResult["status"]; created_at: string; created_by: string; error?: string }): OpenCodeCommanderQuestionResult {
  return redactValue({
    question_id: overrides.question_id,
    status: overrides.status,
    question_status: preview.urgency === "urgent" ? "pending_human" : "pending_commander",
    session_id: preview.session_id,
    launch_id: preview.launch_id,
    progress_id: preview.progress_id,
    watchdog_id: preview.watchdog_id,
    forced_report_request_id: preview.forced_report_request_id,
    question_type: preview.question_type,
    urgency: preview.urgency,
    question_preview: preview.question_preview,
    context_summary_preview: preview.context_summary_preview,
    options_considered_preview: preview.options_considered_preview,
    executor_recommendation_preview: preview.executor_recommendation_preview,
    evidence_summary_preview: preview.evidence_summary_preview,
    created_at: overrides.created_at,
    created_by: bound(overrides.created_by) ?? "operator",
    source_kind: preview.source_kind,
    error: bound(overrides.error),
    question_hash: preview.question_hash,
    recommended_commands: preview.recommended_commands,
  })
}

function questionEventPayload(result: OpenCodeCommanderQuestionResult): Record<string, unknown> {
  return redactValue({
    kind: "opencode_commander_question_created",
    question_id: result.question_id,
    question_status: result.question_status,
    session_id: result.session_id,
    launch_id: result.launch_id,
    progress_id: result.progress_id,
    watchdog_id: result.watchdog_id,
    forced_report_request_id: result.forced_report_request_id,
    question_type: result.question_type,
    urgency: result.urgency,
    question_preview: result.question_preview,
    context_summary_preview: result.context_summary_preview,
    options_considered_preview: result.options_considered_preview,
    executor_recommendation_preview: result.executor_recommendation_preview,
    evidence_summary_preview: result.evidence_summary_preview,
    created_at: result.created_at,
    created_by: result.created_by,
    source_kind: result.source_kind,
    question_hash: result.question_hash,
  })
}

function resultFromEvent(event: JsonlEvent): OpenCodeCommanderQuestionResult {
  return redactValue({
    question_id: String(event.question_id ?? ""),
    status: "created",
    question_status: readQuestionStatus(event.question_status),
    session_id: String(event.session_id ?? ""),
    launch_id: typeof event.launch_id === "string" ? event.launch_id : undefined,
    progress_id: typeof event.progress_id === "string" ? event.progress_id : undefined,
    watchdog_id: typeof event.watchdog_id === "string" ? event.watchdog_id : undefined,
    forced_report_request_id: typeof event.forced_report_request_id === "string" ? event.forced_report_request_id : undefined,
    question_type: readQuestionType(event.question_type),
    urgency: readUrgency(event.urgency),
    question_preview: bound(event.question_preview) ?? "",
    context_summary_preview: bound(event.context_summary_preview) ?? "",
    options_considered_preview: boundArray(Array.isArray(event.options_considered_preview) ? event.options_considered_preview : []),
    executor_recommendation_preview: bound(event.executor_recommendation_preview),
    evidence_summary_preview: bound(event.evidence_summary_preview),
    created_at: typeof event.created_at === "string" ? event.created_at : "",
    created_by: bound(event.created_by) ?? "unknown",
    source_kind: readSourceKind(event.source_kind),
    question_hash: typeof event.question_hash === "string" ? event.question_hash : hash(stableJson(event)),
    recommended_commands: recommendedCommands(String(event.session_id ?? "<session_id>")),
  })
}

function recordFromEvent(event: JsonlEvent): OpenCodeCommanderQuestionRecord | null {
  if (typeof event.question_id !== "string" || typeof event.session_id !== "string") return null
  return redactValue({
    question_id: event.question_id,
    status: readQuestionStatus(event.question_status),
    session_id: event.session_id,
    launch_id: typeof event.launch_id === "string" ? event.launch_id : undefined,
    question_type: readQuestionType(event.question_type),
    urgency: readUrgency(event.urgency),
    question_preview: bound(event.question_preview) ?? "",
    source_kind: readSourceKind(event.source_kind),
    created_at: typeof event.created_at === "string" ? event.created_at : "",
    created_by: bound(event.created_by) ?? "unknown",
    has_options: Array.isArray(event.options_considered_preview) && event.options_considered_preview.length > 0,
    has_recommendation: typeof event.executor_recommendation_preview === "string" && event.executor_recommendation_preview.length > 0,
    linked_progress_id: typeof event.progress_id === "string" ? event.progress_id : undefined,
    linked_watchdog_id: typeof event.watchdog_id === "string" ? event.watchdog_id : undefined,
    linked_forced_report_request_id: typeof event.forced_report_request_id === "string" ? event.forced_report_request_id : undefined,
    question_hash: typeof event.question_hash === "string" ? event.question_hash : hash(stableJson(event)),
  })
}

function isQuestionEvent(event: JsonlEvent): boolean {
  return event.kind === "opencode_commander_question_created"
}

function readQuestionStatus(value: unknown): OpenCodeCommanderQuestionStatus {
  return value === "pending_human" || value === "withdrawn" || value === "superseded" || value === "answered" ? value : "pending_commander"
}

function readQuestionType(value: unknown, fallback: OpenCodeCommanderQuestionType = "unknown"): OpenCodeCommanderQuestionType {
  return value === "clarification" || value === "blocker" || value === "design_choice" || value === "permission" || value === "missing_context" || value === "conflict" || value === "status_report_request" || value === "timeout_report" || value === "unknown" ? value : fallback
}

function readUrgency(value: unknown, fallback: OpenCodeCommanderQuestionUrgency = "normal"): OpenCodeCommanderQuestionUrgency {
  return value === "low" || value === "normal" || value === "high" || value === "urgent" ? value : fallback
}

function readSourceKind(value: unknown, fallback: OpenCodeCommanderQuestionSourceKind = "unknown"): OpenCodeCommanderQuestionSourceKind {
  return value === "manual" || value === "progress_question" || value === "watchdog" || value === "forced_report" || value === "fake" || value === "unknown" ? value : fallback
}

function defaultQuestionType(evidence: EvidenceBundle): OpenCodeCommanderQuestionType {
  if (evidence.forcedReport) return "status_report_request"
  if (evidence.watchdog?.watchdog_status === "timed_out") return "timeout_report"
  if (evidence.watchdog) return "status_report_request"
  if (evidence.progress?.kind === "blocker" || evidence.progress?.execution_state === "blocked") return "blocker"
  if (evidence.progress?.kind === "question" || evidence.progress?.execution_state === "needs_commander") return "clarification"
  return "clarification"
}

function defaultUrgency(evidence: EvidenceBundle): OpenCodeCommanderQuestionUrgency {
  if (evidence.watchdog?.watchdog_status === "timed_out") return "urgent"
  if (evidence.forcedReport || evidence.watchdog?.watchdog_status === "needs_report") return "high"
  return "normal"
}

function defaultSourceKind(evidence: EvidenceBundle): OpenCodeCommanderQuestionSourceKind {
  if (evidence.forcedReport) return "forced_report"
  if (evidence.watchdog) return "watchdog"
  if (evidence.progress) return "progress_question"
  return "manual"
}

function isQuestionEligibleProgress(progress: OpenCodeProgressResult): boolean {
  return progress.kind === "question" || progress.kind === "blocker" || progress.execution_state === "needs_commander" || progress.execution_state === "blocked" || progress.execution_state === "needs_human"
}

function evidenceSummaryPreview(evidence: EvidenceBundle): string | undefined {
  if (evidence.forcedReport) return `forced report ${evidence.forcedReport.request_id}: ${evidence.forcedReport.reason}`
  if (evidence.watchdog) return `watchdog ${evidence.watchdog.watchdog_id}: ${evidence.watchdog.watchdog_status}`
  if (evidence.progress) return `progress ${evidence.progress.progress_id}: ${evidence.progress.kind}`
  return undefined
}

function recommendedCommands(sessionId: string): OpenCodeCommanderQuestionCommand[] {
  return [
    { label: "Create question", command: `/opencode-ask-commander session=${sessionId} question=<question>`, command_type: "write", requires_active_runtime: true, notes: "metadata only; no Commander answer or OpenCode prompt" },
    { label: "List questions", command: `/opencode-commander-questions session=${sessionId}`, command_type: "read" },
    { label: "Latest question", command: `/opencode-commander-question-latest session=${sessionId}`, command_type: "read" },
  ]
}

function questionInputLooksLikeRawLog(input: OpenCodeCommanderQuestionPreviewInput): boolean {
  const values = [input.question, input.context_summary, input.executor_recommendation, ...(input.options_considered ?? [])].filter((item): item is string => typeof item === "string")
  return values.some(looksLikeRawLog)
}

function looksLikeRawLog(value: string): boolean {
  return RAW_LOG_PATTERNS.some((pattern) => pattern.test(value))
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? bound(value) : undefined
}

function optionalBoundedMetadata(value: unknown): string | undefined {
  return optional(value)
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return boundArray(value)
  if (typeof value === "string") return boundArray(value.split(",").map((item) => item.trim()).filter(Boolean))
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

function compareSequencedDesc(left: SequencedQuestionRecord, right: SequencedQuestionRecord): number {
  const time = right.record.created_at.localeCompare(left.record.created_at)
  if (time !== 0) return time
  return right.event_index - left.event_index
}
