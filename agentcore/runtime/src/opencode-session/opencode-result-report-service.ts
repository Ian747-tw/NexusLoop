import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactValue } from "../security/redaction"
import type { CommanderGuidanceService } from "./opencode-commander-guidance-service"
import type { OpenCodeCommanderQuestionService } from "./opencode-commander-question-service"
import type { CommanderGuidanceDeliveryService } from "./opencode-guidance-delivery-service"
import type { OpenCodeLaunchGateService } from "./opencode-launch-gate-service"
import type { OpenCodeLaunchRecord, OpenCodeLaunchResult } from "./opencode-launch-gate-types"
import type { OpenCodeProgressService } from "./opencode-progress-service"
import type { OpenCodeSessionService } from "./opencode-session-service"
import type { OpenCodeTimeoutWatchdogService } from "./opencode-timeout-watchdog-service"
import type { OpenCodeWakeActionExecutionService } from "./opencode-wake-action-execution-service"
import type { OpenCodeWakeSupervisorExecutionService } from "./opencode-wake-supervisor-execution-service"
import type {
  OpenCodeResultDisposition,
  OpenCodeResultReportCommand,
  OpenCodeResultReportKind,
  OpenCodeResultReportPreview,
  OpenCodeResultReportPreviewInput,
  OpenCodeResultReportRecord,
  OpenCodeResultReportRecordInput,
  OpenCodeResultReportResult,
  OpenCodeResultReportSummary,
  OpenCodeResultReviewState,
} from "./opencode-result-report-types"

const EVENT_KIND = "opencode_result_report_recorded"
const MAX_LIST = 100
const MAX_ARRAY = 16
const MAX_TEXT = 360
const LAUNCHED_STATUSES = new Set(["launch_started", "launched"])
const RAW_PATTERNS = [
  /\n.{100,}\n.{100,}/s,
  /(stdout|stderr|traceback|stack trace|bun test v|npm error|diff --git|@@ |\+\+\+ |--- ).{0,120}\n/i,
  /(\[[0-9]{2}:[0-9]{2}:[0-9]{2}\].*\n){3,}/i,
]

export type OpenCodeResultReportServiceOptions = {
  eventStore: EventStore
  opencodeSessionService: OpenCodeSessionService
  launchGateService: OpenCodeLaunchGateService
  progressService: OpenCodeProgressService
  watchdogService: OpenCodeTimeoutWatchdogService
  questionService: OpenCodeCommanderQuestionService
  guidanceService: CommanderGuidanceService
  guidanceDeliveryService: CommanderGuidanceDeliveryService
  wakeExecutionService: OpenCodeWakeSupervisorExecutionService
  wakeActionExecutionService: OpenCodeWakeActionExecutionService
  now?: () => Date
  idFactory?: () => string
}

type SequencedReport = { record: OpenCodeResultReportRecord; event_index: number }
type Evidence = {
  session_id?: string
  launch_id?: string
  progress?: Awaited<ReturnType<OpenCodeProgressService["get"]>>
}

export class OpenCodeResultReportService {
  private readonly now: () => Date
  private readonly idFactory: () => string
  private recordQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: OpenCodeResultReportServiceOptions) {
    this.now = options.now ?? (() => new Date())
    this.idFactory = options.idFactory ?? (() => `opencode_result_report_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`)
  }

  async preview(input: OpenCodeResultReportPreviewInput = {}): Promise<OpenCodeResultReportPreview> {
    return this.buildPreview(input)
  }

  async record(input: OpenCodeResultReportRecordInput = {}): Promise<OpenCodeResultReportResult> {
    const preview = await this.buildPreview(input)
    const reportId = this.idFactory()
    const recordedAt = this.now().toISOString()
    const recordedBy = bound(input.recorded_by ?? "operator") ?? "operator"
    if (!preview.can_record) return resultFromPreview(preview, { report_id: reportId, status: "blocked", recorded_at: recordedAt, recorded_by: recordedBy, error: preview.blockers[0] ?? "OpenCode result report is blocked" })
    const duplicate = await this.findDuplicate(preview.report_hash, preview.session_id, preview.launch_id)
    if (duplicate) return resultFromPreview(preview, { report_id: reportId, status: "blocked", recorded_at: recordedAt, recorded_by: recordedBy, error: "duplicate OpenCode result report already exists for this session/launch" })
    if (input.dry_run === true) return resultFromPreview(preview, { report_id: reportId, status: "dry_run", recorded_at: recordedAt, recorded_by: recordedBy })
    return this.serializeRecord(async () => {
      const rebuilt = await this.buildPreview(input)
      if (!rebuilt.can_record) return resultFromPreview(rebuilt, { report_id: reportId, status: "blocked", recorded_at: recordedAt, recorded_by: recordedBy, error: rebuilt.blockers[0] ?? "OpenCode result report is blocked" })
      const duplicateAfterLock = await this.findDuplicate(rebuilt.report_hash, rebuilt.session_id, rebuilt.launch_id)
      if (duplicateAfterLock) return resultFromPreview(rebuilt, { report_id: reportId, status: "blocked", recorded_at: recordedAt, recorded_by: recordedBy, error: "duplicate OpenCode result report already exists for this session/launch" })
      const result = resultFromPreview(rebuilt, { report_id: reportId, status: "recorded", recorded_at: recordedAt, recorded_by: recordedBy })
      await this.options.eventStore.append(eventPayload(result) as JsonlEvent)
      return redactValue(result)
    })
  }

  async list(input: { limit?: number; session_id?: string; launch_id?: string; result_kind?: string; result_disposition?: string; review_state?: string } = {}): Promise<OpenCodeResultReportRecord[]> {
    const limit = positiveInteger(input.limit, 20, MAX_LIST)
    return (await this.sequencedRecords())
      .filter((item) => !input.session_id || item.record.session_id === input.session_id)
      .filter((item) => !input.launch_id || item.record.launch_id === input.launch_id)
      .filter((item) => !input.result_kind || item.record.result_kind === input.result_kind)
      .filter((item) => !input.result_disposition || item.record.result_disposition === input.result_disposition)
      .filter((item) => !input.review_state || item.record.review_state === input.review_state)
      .sort(compareSequencedDesc)
      .map((item) => item.record)
      .slice(0, limit)
  }

  async get(reportId: string): Promise<OpenCodeResultReportResult | null> {
    const event = (await this.options.eventStore.readAll()).filter(isReportEvent).reverse().find((item) => item.report_id === reportId)
    return event ? resultFromEvent(event) : null
  }

  async latest(input: { session_id?: string; launch_id?: string } = {}): Promise<OpenCodeResultReportResult | null> {
    const latest = (await this.list({ ...input, limit: 1 }))[0]
    return latest ? this.get(latest.report_id) : null
  }

  async summary(input: { limit?: number } = {}): Promise<OpenCodeResultReportSummary> {
    const records = (await this.sequencedRecords()).sort(compareSequencedDesc).map((item) => item.record)
    const limit = positiveInteger(input.limit, 10, MAX_LIST)
    return redactValue({
      total_reports: records.length,
      session_count: new Set(records.map((record) => record.session_id)).size,
      completion_count: records.filter((record) => record.result_kind === "completion_report").length,
      partial_count: records.filter((record) => record.result_kind === "partial_report").length,
      failure_count: records.filter((record) => record.result_kind === "failure_report").length,
      inconclusive_count: records.filter((record) => record.result_kind === "inconclusive_report").length,
      blocked_count: records.filter((record) => record.result_kind === "blocked_report").length,
      needs_commander_review_count: records.filter((record) => record.review_state === "needs_commander_review").length,
      needs_human_review_count: records.filter((record) => record.review_state === "needs_human_review").length,
      latest_reports: records.slice(0, limit),
      generated_at: this.now().toISOString(),
    })
  }

  private async buildPreview(input: OpenCodeResultReportPreviewInput): Promise<OpenCodeResultReportPreview> {
    const generatedAt = this.now().toISOString()
    const blockers: string[] = []
    const warnings = [
      "result reports are executor evidence only; they do not complete missions or accept results",
      "no provider, MCP, OpenCode prompt, process control, research.db write, checkpoint, Commander review, or mission mutation occurs",
    ]
    const evidence = await this.resolveEvidence(input, blockers)
    const sessionIdInput = bound(input.session_id)
    const launchIdInput = bound(input.launch_id)
    let sessionId = sessionIdInput ?? evidence.session_id ?? ""
    let launchId = launchIdInput ?? evidence.launch_id
    if (!sessionId && !launchId) blockers.push("session_id, launch_id, or linked evidence is required")
    let launch: OpenCodeLaunchResult | OpenCodeLaunchRecord | null = null
    if (launchId) {
      launch = await this.options.launchGateService.get(launchId)
      if (!launch) blockers.push("launch_id does not resolve to an OpenCode launch record")
    }
    if (!launch && sessionId) {
      const launches = await this.options.launchGateService.list({ session_id: sessionId, limit: MAX_LIST })
      const candidate = launches.find((item) => LAUNCHED_STATUSES.has(item.status)) ?? launches[0] ?? null
      launch = candidate ? (await this.options.launchGateService.get(candidate.launch_id)) ?? candidate : null
      if (!launch) blockers.push("OpenCode result report requires a launch record for the session")
    }
    if (launch && !sessionId) sessionId = launch.session_id
    if (sessionId) {
      const session = await this.options.opencodeSessionService.get(sessionId)
      if (!session) blockers.push("session_id does not resolve to a planned OpenCode session")
    }
    if (launch && sessionId && launch.session_id !== sessionId) blockers.push("launch_id does not belong to session_id")
    if (launch && !LAUNCHED_STATUSES.has(launch.status)) blockers.push(`OpenCode result report requires launch_started or launched status; current status is ${launch.status}`)
    sessionId = sessionId || launch?.session_id || ""
    launchId = launchId || launch?.launch_id

    const resultKind = readResultKind(input.result_kind, evidence.progress?.kind)
    const disposition = dispositionForKind(resultKind)
    let reviewState = readReviewState(input.review_state, defaultReviewState(resultKind), blockers)
    if (resultKind !== "status_report" && reviewState !== "needs_commander_review" && reviewState !== "needs_human_review") {
      blockers.push("terminal OpenCode result reports require Commander or human review")
      reviewState = defaultReviewState(resultKind)
    }
    const rawBlocked = inputLooksRaw(input)
    if (rawBlocked) blockers.push("raw logs, full diffs, file contents, provider output, raw OpenCode output, full event logs, and research.db dumps are out of scope for result reports")

    const summary = rawBlocked ? "raw result payload omitted" : bound(input.summary ?? evidence.progress?.report_summary_preview)
    const outcome = rawBlocked ? undefined : bound(input.outcome ?? defaultOutcomeFromProgress(evidence.progress))
    const changedFiles = rawBlocked ? [] : boundArray(input.changed_files ?? evidence.progress?.files_touched_preview)
    const testsRun = rawBlocked ? [] : boundArray(input.tests_run ?? evidence.progress?.tests_run_preview)
    const testResults = rawBlocked ? [] : boundArray(input.test_results)
    const artifacts = rawBlocked ? [] : boundArray(input.artifacts ?? evidence.progress?.artifacts_preview)
    const metrics = rawBlocked ? [] : boundArray(input.metrics)
    const claims = rawBlocked ? [] : boundArray(input.claims)
    const knownFailures = rawBlocked ? [] : boundArray(input.known_failures ?? evidence.progress?.blockers_preview)
    const followups = rawBlocked ? [] : boundArray(input.followups)
    const confidence = readConfidence(input.confidence ?? evidence.progress?.confidence)

    if (!summary) blockers.push("summary is required")
    if (resultKind === "completion_report" && !outcome && claims.length === 0) blockers.push("completion_report requires outcome or claims")
    if (resultKind === "partial_report" && followups.length === 0 && knownFailures.length === 0) blockers.push("partial_report requires followups or known_failures")
    if (resultKind === "failure_report" && !outcome && knownFailures.length === 0) blockers.push("failure_report requires outcome or known_failures")
    if (resultKind === "inconclusive_report" && !outcome && knownFailures.length === 0 && followups.length === 0) blockers.push("inconclusive_report requires outcome, known_failures, or followups")
    if (resultKind === "blocked_report" && knownFailures.length === 0 && followups.length === 0) blockers.push("blocked_report requires known_failures or followups")
    if (resultKind === "unknown") blockers.push("result_kind is unsupported")

    const reportHash = hash(stableJson({
      session_id: sessionId,
      launch_id: launchId,
      result_kind: resultKind,
      result_disposition: disposition,
      review_state: reviewState,
      summary,
      outcome,
      changedFiles,
      testsRun,
      testResults,
      artifacts,
      metrics,
      claims,
      knownFailures,
      followups,
      confidence,
      links: linkedIds(input),
    }))

    if (sessionId && await this.findDuplicate(reportHash, sessionId, launchId)) blockers.push("duplicate OpenCode result report already exists for this session/launch")
    const canRecord = blockers.length === 0
    return redactValue({
      preview_id: `opencode_result_report_preview_${reportHash.slice(0, 16)}`,
      status: canRecord ? "ready" : "blocked",
      can_record: canRecord,
      session_id: sessionId,
      launch_id: launchId,
      result_kind: resultKind,
      result_disposition: disposition,
      review_state: reviewState,
      summary_preview: summary ?? "",
      outcome_preview: outcome,
      changed_files_preview: changedFiles,
      tests_run_preview: testsRun,
      test_results_preview: testResults,
      artifacts_preview: artifacts,
      metrics_preview: metrics,
      claims_preview: claims,
      known_failures_preview: knownFailures,
      followups_preview: followups,
      confidence,
      ...linkedIds(input),
      mission_mutated: false as const,
      research_db_written: false as const,
      checkpoint_created: false as const,
      commander_review_created: false as const,
      blockers: boundArray(unique(blockers)),
      warnings: boundArray(unique(warnings)),
      recommended_commands: recommendedCommands(sessionId, launchId),
      generated_at: generatedAt,
      redacted_summary_preview: canRecord ? `OpenCode result report ${resultKind} is ready for durable metadata recording` : blockers[0] ?? "OpenCode result report blocked",
      report_hash: reportHash,
    })
  }

  private async resolveEvidence(input: OpenCodeResultReportPreviewInput, blockers: string[]): Promise<Evidence> {
    const resolved: Evidence = {}
    const progressId = bound(input.progress_id)
    if (progressId) {
      const progress = await this.options.progressService.get(progressId)
      if (!progress) blockers.push("progress_id does not resolve to OpenCode progress metadata")
      else Object.assign(resolved, { progress, session_id: progress.session_id, launch_id: progress.launch_id })
    }
    await this.resolveLinked(input.watchdog_id, "watchdog_id", blockers, resolved, async (id) => this.options.watchdogService.get(id))
    await this.resolveLinked(input.question_id, "question_id", blockers, resolved, async (id) => this.options.questionService.get(id))
    await this.resolveLinked(input.guidance_id, "guidance_id", blockers, resolved, async (id) => this.options.guidanceService.get(id))
    await this.resolveLinked(input.delivery_id, "delivery_id", blockers, resolved, async (id) => this.options.guidanceDeliveryService.get(id))
    await this.resolveLinked(input.wake_execution_id, "wake_execution_id", blockers, resolved, async (id) => this.options.wakeExecutionService.get(id))
    await this.resolveLinked(input.wake_action_execution_id, "wake_action_execution_id", blockers, resolved, async (id) => this.options.wakeActionExecutionService.get(id))
    const sessionId = bound(input.session_id)
    const launchId = bound(input.launch_id)
    if (sessionId && resolved.session_id && resolved.session_id !== sessionId) blockers.push("linked evidence does not belong to session_id")
    if (launchId && resolved.launch_id && resolved.launch_id !== launchId) blockers.push("linked evidence does not belong to launch_id")
    return resolved
  }

  private async resolveLinked<T extends { session_id?: string; launch_id?: string }>(id: string | undefined, label: string, blockers: string[], resolved: Evidence, get: (id: string) => Promise<T | null>): Promise<void> {
    const value = bound(id)
    if (!value) return
    const record = await get(value)
    if (!record) {
      blockers.push(`${label} does not resolve to OpenCode metadata`)
      return
    }
    if (record.session_id && resolved.session_id && resolved.session_id !== record.session_id) blockers.push(`${label} does not belong to the linked session`)
    if (record.launch_id && resolved.launch_id && resolved.launch_id !== record.launch_id) blockers.push(`${label} does not belong to the linked launch`)
    resolved.session_id ??= record.session_id
    resolved.launch_id ??= record.launch_id
  }

  private async findDuplicate(reportHash: string, sessionId: string, launchId?: string): Promise<OpenCodeResultReportRecord | undefined> {
    return (await this.sequencedRecords())
      .find((item) => item.record.session_id === sessionId && item.record.launch_id === launchId && item.record.report_hash === reportHash)
      ?.record
  }

  private async sequencedRecords(): Promise<SequencedReport[]> {
    return (await this.options.eventStore.readAll())
      .map((event, index) => ({ event, index }))
      .filter((item) => isReportEvent(item.event))
      .map((item) => ({ record: recordFromEvent(item.event), event_index: item.index }))
  }

  private serializeRecord<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.recordQueue.then(operation, operation)
    this.recordQueue = next.then(() => undefined, () => undefined)
    return next
  }
}

export function readOpenCodeResultReportPreviewInput(value: unknown): OpenCodeResultReportPreviewInput {
  const input = isRecord(value) ? value : {}
  return {
    session_id: optional(input.sessionId ?? input.session_id ?? input.session),
    launch_id: optional(input.launchId ?? input.launch_id ?? input.launch),
    result_kind: optional(input.resultKind ?? input.result_kind ?? input.kind),
    summary: optionalRaw(input.summary),
    outcome: optionalRaw(input.outcome),
    changed_files: optionalArray(input.changedFiles ?? input.changed_files),
    tests_run: optionalArray(input.testsRun ?? input.tests_run),
    test_results: optionalArray(input.testResults ?? input.test_results),
    artifacts: optionalArray(input.artifacts),
    metrics: optionalArray(input.metrics),
    claims: optionalArray(input.claims),
    known_failures: optionalArray(input.knownFailures ?? input.known_failures),
    followups: optionalArray(input.followups),
    confidence: input.confidence,
    progress_id: optional(input.progressId ?? input.progress_id ?? input.progress),
    watchdog_id: optional(input.watchdogId ?? input.watchdog_id ?? input.watchdog),
    question_id: optional(input.questionId ?? input.question_id ?? input.question),
    guidance_id: optional(input.guidanceId ?? input.guidance_id ?? input.guidance),
    delivery_id: optional(input.deliveryId ?? input.delivery_id ?? input.delivery),
    wake_execution_id: optional(input.wakeExecutionId ?? input.wakeExecution ?? input.wake_execution_id ?? input.wake_execution),
    wake_action_execution_id: optional(input.wakeActionExecutionId ?? input.wakeAction ?? input.wake_action_execution_id ?? input.wake_action),
    review_state: optional(input.reviewState ?? input.review_state),
  }
}

export function readOpenCodeResultReportRecordInput(value: unknown): OpenCodeResultReportRecordInput {
  const input = isRecord(value) ? value : {}
  return {
    ...readOpenCodeResultReportPreviewInput(value),
    dry_run: optionalBoolean(input.dryRun ?? input.dry_run),
    recorded_by: optional(input.recordedBy ?? input.recorded_by),
  }
}

function resultFromPreview(preview: OpenCodeResultReportPreview, overrides: { report_id: string; status: OpenCodeResultReportResult["status"]; recorded_at: string; recorded_by: string; error?: string }): OpenCodeResultReportResult {
  return redactValue({
    report_id: overrides.report_id,
    status: overrides.status,
    session_id: preview.session_id,
    launch_id: preview.launch_id,
    result_kind: preview.result_kind,
    result_disposition: preview.result_disposition,
    review_state: preview.review_state,
    summary_preview: preview.summary_preview,
    outcome_preview: preview.outcome_preview,
    changed_files_preview: preview.changed_files_preview,
    tests_run_preview: preview.tests_run_preview,
    test_results_preview: preview.test_results_preview,
    artifacts_preview: preview.artifacts_preview,
    metrics_preview: preview.metrics_preview,
    claims_preview: preview.claims_preview,
    known_failures_preview: preview.known_failures_preview,
    followups_preview: preview.followups_preview,
    confidence: preview.confidence,
    linked_progress_id: preview.linked_progress_id,
    linked_watchdog_id: preview.linked_watchdog_id,
    linked_question_id: preview.linked_question_id,
    linked_guidance_id: preview.linked_guidance_id,
    linked_delivery_id: preview.linked_delivery_id,
    linked_wake_execution_id: preview.linked_wake_execution_id,
    linked_wake_action_execution_id: preview.linked_wake_action_execution_id,
    mission_mutated: false as const,
    research_db_written: false as const,
    checkpoint_created: false as const,
    commander_review_created: false as const,
    recorded_at: overrides.recorded_at,
    recorded_by: bound(overrides.recorded_by) ?? "operator",
    error: bound(overrides.error),
    report_hash: preview.report_hash,
    recommended_commands: preview.recommended_commands,
  })
}

function eventPayload(result: OpenCodeResultReportResult): Record<string, unknown> {
  return redactValue({ kind: EVENT_KIND, ...result, status: undefined, recommended_commands: undefined, error: undefined })
}

function resultFromEvent(event: Record<string, unknown>): OpenCodeResultReportResult {
  return redactValue({
    report_id: String(event.report_id ?? ""),
    status: "recorded" as const,
    ...baseFromEvent(event),
    recorded_at: String(event.recorded_at ?? ""),
    recorded_by: String(event.recorded_by ?? "operator"),
    report_hash: String(event.report_hash ?? ""),
    recommended_commands: recommendedCommands(String(event.session_id ?? ""), typeof event.launch_id === "string" ? event.launch_id : undefined),
  })
}

function recordFromEvent(event: Record<string, unknown>): OpenCodeResultReportRecord {
  const base = baseFromEvent(event)
  return redactValue({
    report_id: String(event.report_id ?? ""),
    session_id: base.session_id,
    launch_id: base.launch_id,
    result_kind: base.result_kind,
    result_disposition: base.result_disposition,
    review_state: base.review_state,
    summary_preview: base.summary_preview,
    recorded_at: String(event.recorded_at ?? ""),
    recorded_by: String(event.recorded_by ?? "operator"),
    confidence: base.confidence,
    has_failures: base.known_failures_preview.length > 0,
    has_artifacts: base.artifacts_preview.length > 0,
    has_metrics: base.metrics_preview.length > 0,
    report_hash: String(event.report_hash ?? ""),
  })
}

function baseFromEvent(event: Record<string, unknown>) {
  return {
    session_id: String(event.session_id ?? ""),
    launch_id: optional(event.launch_id),
    result_kind: readResultKind(event.result_kind),
    result_disposition: readDisposition(event.result_disposition),
    review_state: readReviewStateValue(event.review_state),
    summary_preview: String(event.summary_preview ?? ""),
    outcome_preview: optional(event.outcome_preview),
    changed_files_preview: boundArray(event.changed_files_preview),
    tests_run_preview: boundArray(event.tests_run_preview),
    test_results_preview: boundArray(event.test_results_preview),
    artifacts_preview: boundArray(event.artifacts_preview),
    metrics_preview: boundArray(event.metrics_preview),
    claims_preview: boundArray(event.claims_preview),
    known_failures_preview: boundArray(event.known_failures_preview),
    followups_preview: boundArray(event.followups_preview),
    confidence: readConfidence(event.confidence),
    linked_progress_id: optional(event.linked_progress_id),
    linked_watchdog_id: optional(event.linked_watchdog_id),
    linked_question_id: optional(event.linked_question_id),
    linked_guidance_id: optional(event.linked_guidance_id),
    linked_delivery_id: optional(event.linked_delivery_id),
    linked_wake_execution_id: optional(event.linked_wake_execution_id),
    linked_wake_action_execution_id: optional(event.linked_wake_action_execution_id),
    mission_mutated: false as const,
    research_db_written: false as const,
    checkpoint_created: false as const,
    commander_review_created: false as const,
  }
}

function linkedIds(input: OpenCodeResultReportPreviewInput): Partial<OpenCodeResultReportPreview> {
  return {
    linked_progress_id: bound(input.progress_id),
    linked_watchdog_id: bound(input.watchdog_id),
    linked_question_id: bound(input.question_id),
    linked_guidance_id: bound(input.guidance_id),
    linked_delivery_id: bound(input.delivery_id),
    linked_wake_execution_id: bound(input.wake_execution_id),
    linked_wake_action_execution_id: bound(input.wake_action_execution_id),
  }
}

function readResultKind(value: unknown, progressKind?: string): OpenCodeResultReportKind {
  const raw = String(value ?? progressKind ?? "status_report")
  if (["completion_report", "partial_report", "failure_report", "inconclusive_report", "blocked_report", "status_report"].includes(raw)) return raw as OpenCodeResultReportKind
  if (raw === "progress" || raw === "heartbeat" || raw === "question" || raw === "blocker" || raw === "checkpoint_note") return "status_report"
  return "unknown"
}

function dispositionForKind(kind: OpenCodeResultReportKind): OpenCodeResultDisposition {
  if (kind === "completion_report") return "reported_done"
  if (kind === "partial_report") return "reported_partial"
  if (kind === "failure_report") return "reported_failed"
  if (kind === "inconclusive_report") return "reported_inconclusive"
  if (kind === "blocked_report") return "reported_blocked"
  return "reported_status_only"
}

function readDisposition(value: unknown): OpenCodeResultDisposition {
  const raw = String(value ?? "")
  if (["reported_done", "reported_partial", "reported_failed", "reported_inconclusive", "reported_blocked", "reported_status_only"].includes(raw)) return raw as OpenCodeResultDisposition
  return "reported_status_only"
}

function defaultReviewState(kind: OpenCodeResultReportKind): OpenCodeResultReviewState {
  return kind === "status_report" ? "review_not_required" : "needs_commander_review"
}

function readReviewState(value: unknown, fallback: OpenCodeResultReviewState, blockers: string[]): OpenCodeResultReviewState {
  const raw = optional(value)
  if (!raw) return fallback
  if (raw === "accepted" || raw === "rejected" || raw === "approved") {
    blockers.push("accepted/rejected result review states belong to a future Commander result review branch")
    return fallback
  }
  return readReviewStateValue(raw, fallback)
}

function readReviewStateValue(value: unknown, fallback: OpenCodeResultReviewState = "unknown"): OpenCodeResultReviewState {
  const raw = String(value ?? "")
  if (["needs_commander_review", "needs_human_review", "not_ready_for_review", "review_not_required", "unknown"].includes(raw)) return raw as OpenCodeResultReviewState
  return fallback
}

function defaultOutcomeFromProgress(progress: Evidence["progress"]): string | undefined {
  if (!progress) return undefined
  if (progress.kind === "completion_report") return progress.report_summary_preview
  if (progress.kind === "failure_report") return progress.report_summary_preview
  return undefined
}

function readConfidence(value: unknown): string | number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.min(1, value))
  const raw = optional(value)
  if (!raw) return undefined
  if (["low", "medium", "high", "unknown"].includes(raw)) return raw
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : "unknown"
}

function inputLooksRaw(input: OpenCodeResultReportPreviewInput): boolean {
  const values = [input.summary, input.outcome, ...(input.changed_files ?? []), ...(input.tests_run ?? []), ...(input.test_results ?? []), ...(input.artifacts ?? []), ...(input.metrics ?? []), ...(input.claims ?? []), ...(input.known_failures ?? []), ...(input.followups ?? [])]
  return values.some((value) => typeof value === "string" && (value.length > 2000 || RAW_PATTERNS.some((pattern) => pattern.test(value))))
}

function recommendedCommands(sessionId: string, launchId?: string): OpenCodeResultReportCommand[] {
  return [
    { label: "List result reports", command: sessionId ? `/opencode-result-reports session=${sessionId}` : "/opencode-result-reports", command_type: "read", notes: "read bounded result-report metadata" },
    { label: "Latest result report", command: sessionId ? `/opencode-result-report-latest session=${sessionId}` : "/opencode-result-report-latest session=<session_id>", command_type: "read", notes: "read latest result-report metadata" },
    { label: "Record result report", command: sessionId ? `/opencode-result-report session=${sessionId} kind=completion_report summary=<summary> outcome=<outcome>` : launchId ? `/opencode-result-report launch=${launchId} kind=completion_report summary=<summary> outcome=<outcome>` : "/opencode-result-report session=<session_id> kind=completion_report summary=<summary> outcome=<outcome>", command_type: "write", requires_active_runtime: true, notes: "manual metadata write only; does not complete mission or ingest research" },
  ]
}

function isReportEvent(event: unknown): event is Record<string, unknown> {
  return isRecord(event) && event.kind === EVENT_KIND && typeof event.report_id === "string" && typeof event.session_id === "string"
}

function compareSequencedDesc(a: SequencedReport, b: SequencedReport): number {
  const time = b.record.recorded_at.localeCompare(a.record.recorded_at)
  return time || b.event_index - a.event_index
}

function positiveInteger(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(Math.floor(parsed), max)) : fallback
}

function bound(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, MAX_TEXT) : undefined
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, MAX_TEXT) : undefined
}

function optionalRaw(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function optionalArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string")
  if (typeof value === "string" && value.trim()) return value.split(",").map((item) => item.trim()).filter(Boolean)
  return undefined
}

function boundArray(value: unknown): string[] {
  return (Array.isArray(value) ? value : optionalArray(value) ?? [])
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, MAX_ARRAY)
    .map((item) => item.slice(0, MAX_TEXT))
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value
  if (value === "true") return true
  if (value === "false") return false
  return undefined
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]))
  return value
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
