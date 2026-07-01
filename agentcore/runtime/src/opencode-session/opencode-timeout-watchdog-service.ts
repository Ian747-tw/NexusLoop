import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { OpenCodeLaunchGateService } from "./opencode-launch-gate-service"
import type { OpenCodeLaunchRecord, OpenCodeLaunchResult } from "./opencode-launch-gate-types"
import type { OpenCodeProgressService } from "./opencode-progress-service"
import type { OpenCodeExecutionState, OpenCodeProgressKind, OpenCodeProgressResult } from "./opencode-progress-types"
import type { OpenCodeSessionPlan } from "./opencode-session-types"
import type { OpenCodeSessionService } from "./opencode-session-service"
import type {
  OpenCodeForcedReportInput,
  OpenCodeForcedReportRequest,
  OpenCodeWatchdogAction,
  OpenCodeWatchdogCommand,
  OpenCodeWatchdogPreview,
  OpenCodeWatchdogPreviewInput,
  OpenCodeWatchdogRecord,
  OpenCodeWatchdogRecordInput,
  OpenCodeWatchdogResult,
  OpenCodeWatchdogStatus,
  OpenCodeWatchdogSummary,
} from "./opencode-timeout-watchdog-types"

const MAX_LIST = 100
const MAX_TEXT = 320
const MAX_ARRAY = 12
const DEFAULT_REPORT_DUE_AFTER_MS = 60_000
const LAUNCHED_STATUSES = new Set(["launch_started", "launched"])
const RAW_LOG_PATTERNS = [
  /\n.{80,}\n.{80,}\n/s,
  /(stdout|stderr|traceback|stack trace|bun test v|npm error|error:).{0,80}\n/i,
  /(\[[0-9]{2}:[0-9]{2}:[0-9]{2}\].*\n){3,}/i,
]

export type OpenCodeTimeoutWatchdogServiceOptions = {
  eventStore: EventStore
  opencodeSessionService: OpenCodeSessionService
  launchGateService: OpenCodeLaunchGateService
  progressService: OpenCodeProgressService
  now?: () => Date
  watchdogIdFactory?: () => string
  forcedReportIdFactory?: () => string
}

type BuiltWatchdogPreview = {
  preview: OpenCodeWatchdogPreview
  session?: OpenCodeSessionPlan | null
  launch?: OpenCodeLaunchResult | OpenCodeLaunchRecord | null
  latestProgress?: OpenCodeProgressResult | null
}

type WatchdogProgressEvidence = Pick<OpenCodeProgressResult, "progress_id" | "recorded_at" | "kind" | "execution_state" | "blockers_preview" | "question_preview">

export class OpenCodeTimeoutWatchdogService {
  private readonly now: () => Date
  private readonly watchdogIdFactory: () => string
  private readonly forcedReportIdFactory: () => string

  constructor(private readonly options: OpenCodeTimeoutWatchdogServiceOptions) {
    this.now = options.now ?? (() => new Date())
    this.watchdogIdFactory = options.watchdogIdFactory ?? (() => `opencode_watchdog_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`)
    this.forcedReportIdFactory = options.forcedReportIdFactory ?? (() => `opencode_forced_report_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`)
  }

  async preview(input: OpenCodeWatchdogPreviewInput = {}): Promise<OpenCodeWatchdogPreview> {
    return (await this.buildPreview(input)).preview
  }

  async record(input: OpenCodeWatchdogRecordInput = {}): Promise<OpenCodeWatchdogResult> {
    const recordedAt = this.now().toISOString()
    const recordedBy = bound(input.recorded_by ?? "operator") ?? "operator"
    const built = await this.buildPreview(input)
    const preview = built.preview
    const watchdogId = this.watchdogIdFactory()
    if (!preview.can_record) {
      return resultFromPreview(preview, {
        watchdog_id: watchdogId,
        status: "blocked",
        recorded_at: recordedAt,
        recorded_by: recordedBy,
        error: preview.blockers[0] ?? "OpenCode watchdog assessment is blocked",
      })
    }
    if (input.request_report === true && !shouldAllowForcedReport(preview.watchdog_status, preview.has_blockers, preview.has_question)) {
      return resultFromPreview(preview, {
        watchdog_id: watchdogId,
        status: "blocked",
        recorded_at: recordedAt,
        recorded_by: recordedBy,
        error: "forced report request is only allowed for stale, timed_out, needs_report, or blocked sessions",
      })
    }
    if (input.request_report === true && preview.forced_report_already_requested) {
      return resultFromPreview(preview, {
        watchdog_id: watchdogId,
        status: "blocked",
        recorded_at: recordedAt,
        recorded_by: recordedBy,
        error: "forced report request already exists for this watchdog assessment",
      })
    }
    if (input.dry_run === true) {
      return resultFromPreview(preview, {
        watchdog_id: watchdogId,
        status: "dry_run",
        recorded_at: recordedAt,
        recorded_by: recordedBy,
      })
    }
    const result = resultFromPreview(preview, {
      watchdog_id: watchdogId,
      status: "recorded",
      recorded_at: recordedAt,
      recorded_by: recordedBy,
    })
    await this.options.eventStore.append(watchdogEventPayload(result) as JsonlEvent)
    if (input.request_report === true) {
      const request = await this.requestForcedReport({
        session_id: preview.session_id,
        launch_id: preview.launch_id,
        reason: "watchdog assessment requested forced report",
        requested_by: recordedBy,
      }, { watchdogId, preview })
      return redactValue({ ...result, forced_report_requested: isForcedReportRequestShape(request), forced_report_request_id: isForcedReportRequestShape(request) ? request.request_id : undefined })
    }
    return redactValue(result)
  }

  async requestForcedReport(input: OpenCodeForcedReportInput = {}, context: { watchdogId?: string; preview?: OpenCodeWatchdogPreview } = {}): Promise<OpenCodeForcedReportRequest | OpenCodeWatchdogResult> {
    const requestedAt = this.now().toISOString()
    const requestedBy = bound(input.requested_by ?? "operator") ?? "operator"
    const rawReason = input.reason ?? "operator requested report after watchdog assessment"
    const reason = bound(rawReason) ?? "operator requested report after watchdog assessment"
    const preview = context.preview ?? await this.preview({ session_id: input.session_id, launch_id: input.launch_id })
    if (!preview.can_record) {
      return resultFromPreview(preview, {
        watchdog_id: context.watchdogId ?? this.watchdogIdFactory(),
        status: "blocked",
        recorded_at: requestedAt,
        recorded_by: requestedBy,
        error: preview.blockers[0] ?? "OpenCode forced report request is blocked",
      })
    }
    if (looksLikeRawLog(rawReason)) {
      return resultFromPreview(preview, {
        watchdog_id: context.watchdogId ?? this.watchdogIdFactory(),
        status: "blocked",
        recorded_at: requestedAt,
        recorded_by: requestedBy,
        error: "raw logs are out of scope for forced report requests; attach an artifact pointer in a later branch",
      })
    }
    if (!shouldAllowForcedReport(preview.watchdog_status, preview.has_blockers, preview.has_question)) {
      return resultFromPreview(preview, {
        watchdog_id: context.watchdogId ?? this.watchdogIdFactory(),
        status: "blocked",
        recorded_at: requestedAt,
        recorded_by: requestedBy,
        error: "forced report request is only allowed for stale, timed_out, needs_report, or blocked sessions",
      })
    }
    if (preview.forced_report_already_requested) {
      return resultFromPreview(preview, {
        watchdog_id: context.watchdogId ?? this.watchdogIdFactory(),
        status: "blocked",
        recorded_at: requestedAt,
        recorded_by: requestedBy,
        error: "forced report request already exists for this watchdog assessment",
      })
    }
    if (input.dry_run === true) {
      return resultFromPreview(preview, {
        watchdog_id: context.watchdogId ?? this.watchdogIdFactory(),
        status: "dry_run",
        recorded_at: requestedAt,
        recorded_by: requestedBy,
      })
    }
    const requestId = this.forcedReportIdFactory()
    const forcedPauseRecommended = preview.forced_pause_enabled === true && (preview.watchdog_status === "timed_out" || preview.watchdog_status === "needs_report")
    const requestHash = hash(stableJson({
      session_id: preview.session_id,
      launch_id: preview.launch_id,
      watchdog_hash: preview.watchdog_hash,
      latest_progress_id: preview.latest_progress_id,
      reason,
      forced_pause_recommended: forcedPauseRecommended,
    }))
    const request: OpenCodeForcedReportRequest = redactValue({
      request_id: requestId,
      session_id: preview.session_id,
      launch_id: preview.launch_id,
      watchdog_id: context.watchdogId,
      reason,
      requested_at: requestedAt,
      requested_by: requestedBy,
      latest_progress_id: preview.latest_progress_id,
      report_due_after_ms: DEFAULT_REPORT_DUE_AFTER_MS,
      forced_pause_recommended: forcedPauseRecommended,
      process_paused: false as const,
      command_to_operator_preview: "metadata only: ask OpenCode for a bounded status report manually or through a future protocol",
      request_hash: requestHash,
    })
    await this.options.eventStore.append(forcedReportEventPayload(request) as JsonlEvent)
    return request
  }

  async list(input: { limit?: number; session_id?: string; launch_id?: string; status?: string } = {}): Promise<OpenCodeWatchdogRecord[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, MAX_LIST))
    return (await this.recordEntries())
      .filter(({ record }) => !input.session_id || record.session_id === input.session_id)
      .filter(({ record }) => !input.launch_id || record.launch_id === input.launch_id)
      .filter(({ record }) => !input.status || record.watchdog_status === input.status)
      .sort(compareRecordEntriesDesc)
      .map(({ record }) => record)
      .slice(0, limit)
  }

  async get(watchdogId: string): Promise<OpenCodeWatchdogResult | null> {
    const event = (await this.options.eventStore.readAll())
      .filter(isWatchdogEvent)
      .reverse()
      .find((item) => item.watchdog_id === watchdogId)
    if (!event) return null
    const linkedRequest = (await this.forcedReportRequests()).find((request) => request.watchdog_id === watchdogId)
    return watchdogResultFromEvent(event, linkedRequest)
  }

  async listForcedReports(input: { limit?: number; session_id?: string; launch_id?: string } = {}): Promise<OpenCodeForcedReportRequest[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, MAX_LIST))
    return (await this.forcedReportRequests())
      .filter((record) => !input.session_id || record.session_id === input.session_id)
      .filter((record) => !input.launch_id || record.launch_id === input.launch_id)
      .sort((left, right) => right.requested_at.localeCompare(left.requested_at))
      .slice(0, limit)
  }

  async getForcedReport(requestId: string): Promise<OpenCodeForcedReportRequest | null> {
    return (await this.forcedReportRequests()).find((record) => record.request_id === requestId) ?? null
  }

  async summary(input: { limit?: number } = {}): Promise<OpenCodeWatchdogSummary> {
    const launches = await this.allLaunchRecords()
    const latestBySession = new Map<string, { record: OpenCodeWatchdogRecord; index: number }>()
    for (const entry of [...await this.recordEntries()].sort(compareRecordEntriesAsc)) latestBySession.set(entry.record.session_id, entry)
    const entries = [...latestBySession.values()]
    const records = entries.map(({ record }) => record)
    return redactValue({
      total_launched_sessions: new Set(launches.filter((launch) => LAUNCHED_STATUSES.has(launch.status)).map((launch) => launch.session_id)).size,
      healthy_count: records.filter((record) => record.watchdog_status === "healthy").length,
      stale_count: records.filter((record) => record.watchdog_status === "stale").length,
      timed_out_count: records.filter((record) => record.watchdog_status === "timed_out").length,
      needs_report_count: records.filter((record) => record.watchdog_status === "needs_report").length,
      blocked_count: records.filter((record) => record.watchdog_status === "blocked").length,
      latest_records: entries.sort(compareRecordEntriesDesc).map(({ record }) => record).slice(0, Math.max(1, Math.min(input.limit ?? 10, MAX_LIST))),
      generated_at: this.now().toISOString(),
    })
  }

  private async buildPreview(input: OpenCodeWatchdogPreviewInput = {}): Promise<BuiltWatchdogPreview> {
    const generatedAt = this.now().toISOString()
    const nowMs = this.now().getTime()
    const sessionIdInput = optional(input.session_id)
    const launchId = optional(input.launch_id)
    const blockers: string[] = []
    const warnings = new Set<string>([
      "watchdog assessment is metadata only; it does not pause, kill, stop, resume, guide, answer, launch OpenCode, call providers, call MCPs, write research.db, run wake, or mutate missions",
      "heartbeat proves reported activity only; it does not mean task success",
    ])
    if (!sessionIdInput && !launchId) blockers.push("session_id or launch_id is required")

    let launch: OpenCodeLaunchResult | OpenCodeLaunchRecord | null = null
    if (launchId) {
      launch = await this.options.launchGateService.get(launchId)
      if (!launch) blockers.push("launch_id does not resolve to an OpenCode launch record")
    }
    let sessionId = sessionIdInput ?? launch?.session_id ?? ""
    let session: OpenCodeSessionPlan | null = null
    if (sessionId) {
      session = await this.options.opencodeSessionService.get(sessionId)
      if (!session) blockers.push("session_id does not resolve to a planned OpenCode session")
    }
    if (!launch && sessionId) {
      launch = (await this.resolveLatestLaunch(sessionId)) ?? null
      if (!launch) blockers.push("OpenCode watchdog requires a launch record for the session")
    }
    if (launch && sessionIdInput && launch.session_id !== sessionIdInput) blockers.push("launch_id does not belong to session_id")
    sessionId = sessionId || launch?.session_id || ""
    if (launch && !LAUNCHED_STATUSES.has(launch.status)) {
      if (launch.status === "launch_failed") blockers.push("launch failed; record failure_report progress instead of watchdog timeout metadata")
      else blockers.push(`OpenCode watchdog requires launch_started or launched status; current status is ${launch.status}`)
    }

    const latestProgress = input.include_latest_progress === false || !sessionId ? null : await this.options.progressService.latest({ session_id: sessionId, launch_id: launch?.launch_id })
    const latestSubstantiveProgress = input.include_latest_progress === false || !sessionId ? null : await this.latestNonHeartbeatProgress(sessionId, launch?.launch_id)
    const policy = session?.timeout_policy
    const maxWallTimeMs = clampMs(input.max_wall_time_ms, policy?.max_wall_time_ms ?? 30 * 60 * 1000, 1_000, 24 * 60 * 60 * 1000)
    const maxNoProgressMs = clampMs(input.max_no_progress_ms, policy?.max_no_progress_ms ?? 10 * 60 * 1000, 1_000, 24 * 60 * 60 * 1000)
    const heartbeatIntervalMs = clampMs(input.heartbeat_interval_ms, policy?.heartbeat_interval_ms ?? 60_000, 1_000, 60 * 60 * 1000)
    const launchStartedAt = launch && "started_at" in launch ? launch.started_at : undefined
    const wallClockElapsedMs = elapsed(nowMs, launchStartedAt)
    const latestElapsedMs = elapsed(nowMs, latestProgress?.recorded_at)
    const latestSubstantiveElapsedMs = elapsed(nowMs, latestSubstantiveProgress?.recorded_at)
    const heartbeatElapsedMs = latestElapsedMs ?? wallClockElapsedMs
    const noProgressElapsedMs = latestSubstantiveElapsedMs ?? wallClockElapsedMs
    const statusEvidence = latestProgress?.kind === "heartbeat" ? latestSubstantiveProgress ?? latestProgress : latestProgress
    const hasBlockers = (latestProgress?.blockers_preview?.length ?? 0) > 0 || latestProgress?.execution_state === "blocked" || latestProgress?.kind === "blocker" || (latestSubstantiveProgress?.blockers_preview?.length ?? 0) > 0 || latestSubstantiveProgress?.execution_state === "blocked" || latestSubstantiveProgress?.kind === "blocker"
    const hasQuestion = Boolean(latestProgress?.question_preview) || latestProgress?.execution_state === "needs_commander" || latestProgress?.kind === "question" || Boolean(latestSubstantiveProgress?.question_preview) || latestSubstantiveProgress?.execution_state === "needs_commander" || latestSubstantiveProgress?.kind === "question"
    const statusResult = computeWatchdogStatus({
      latestProgress: statusEvidence,
      wallClockElapsedMs,
      noProgressElapsedMs,
      heartbeatElapsedMs,
      maxWallTimeMs,
      maxNoProgressMs,
      heartbeatIntervalMs,
      hasBlockers,
      hasQuestion,
    })
    for (const warning of statusResult.warnings) warnings.add(warning)
    if (policy?.report_required_on_timeout === false && (statusResult.status === "timed_out" || statusResult.status === "needs_report")) warnings.add("session timeout policy does not require reports on timeout; manual forced report remains metadata-only")
    const requestHashKey = hash(stableJson({
      session_id: sessionId,
      launch_id: launch?.launch_id ?? launchId,
      watchdog_status: statusResult.status,
      latest_progress_id: latestProgress?.progress_id,
      latest_substantive_progress_id: latestSubstantiveProgress?.progress_id,
      wall_clock_elapsed_ms: wallClockElapsedMs,
      no_progress_elapsed_ms: noProgressElapsedMs,
      heartbeat_elapsed_ms: heartbeatElapsedMs,
    }))
    const existingForcedReport = await this.findForcedReportForEvidence(sessionId, launch?.launch_id ?? launchId, latestProgress?.progress_id)
    const reportRequiredOnTimeout = policy?.report_required_on_timeout ?? true
    const timeoutDerivedReport = statusResult.status === "timed_out" || statusResult.status === "needs_report" || statusResult.status === "stale"
    const reportRequired = (statusResult.status === "blocked" && (hasBlockers || hasQuestion)) || hasQuestion || (timeoutDerivedReport && reportRequiredOnTimeout)
    const canRecord = blockers.length === 0
    return {
      preview: redactValue({
        preview_id: `opencode_watchdog_preview_${requestHashKey.slice(0, 16)}`,
        status: canRecord ? "ready" : "blocked",
        can_record: canRecord,
        session_id: sessionId,
        launch_id: launch?.launch_id ?? launchId,
        launch_status: launch?.status,
        watchdog_status: canRecord ? statusResult.status : "unknown",
        recommended_action: canRecord ? statusResult.action : "record_assessment",
        wall_clock_elapsed_ms: wallClockElapsedMs,
        no_progress_elapsed_ms: noProgressElapsedMs,
        heartbeat_elapsed_ms: heartbeatElapsedMs,
        max_wall_time_ms: maxWallTimeMs,
        max_no_progress_ms: maxNoProgressMs,
        heartbeat_interval_ms: heartbeatIntervalMs,
        forced_pause_enabled: policy?.forced_pause_enabled ?? true,
        report_required_on_timeout: policy?.report_required_on_timeout ?? true,
        latest_progress_id: latestProgress?.progress_id,
        latest_progress_kind: latestProgress?.kind,
        latest_progress_state: latestProgress?.execution_state,
        latest_progress_at: latestProgress?.recorded_at,
        latest_report_summary_preview: latestProgress?.report_summary_preview,
        has_blockers: hasBlockers,
        has_question: hasQuestion,
        blockers_preview: boundArray(latestProgress?.blockers_preview?.length ? latestProgress.blockers_preview : latestSubstantiveProgress?.blockers_preview),
        question_preview: bound(latestProgress?.question_preview ?? latestSubstantiveProgress?.question_preview),
        report_required: canRecord && reportRequired,
        forced_report_already_requested: Boolean(existingForcedReport),
        blockers: boundArray(unique(blockers)),
        warnings: boundArray(unique([...warnings])),
        recommended_commands: recommendedCommands(sessionId || "<session_id>", launch?.launch_id ?? launchId),
        generated_at: generatedAt,
        redacted_summary_preview: canRecord ? `OpenCode watchdog ${statusResult.status} for ${sessionId}` : blockers[0] ?? "OpenCode watchdog blocked",
        watchdog_hash: requestHashKey,
      }),
      session,
      launch,
      latestProgress,
    }
  }

  private async resolveLatestLaunch(sessionId: string): Promise<OpenCodeLaunchResult | OpenCodeLaunchRecord | null> {
    const launches = await this.options.launchGateService.list({ session_id: sessionId, limit: MAX_LIST })
    const latest = launches.find((launch) => LAUNCHED_STATUSES.has(launch.status)) ?? launches[0]
    return latest ? (await this.options.launchGateService.get(latest.launch_id)) ?? latest : null
  }

  private async records(): Promise<OpenCodeWatchdogRecord[]> {
    return (await this.options.eventStore.readAll()).filter(isWatchdogEvent).map(watchdogRecordFromEvent).filter((record): record is OpenCodeWatchdogRecord => !!record)
  }

  private async recordEntries(): Promise<Array<{ record: OpenCodeWatchdogRecord; index: number }>> {
    return (await this.options.eventStore.readAll())
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => isWatchdogEvent(event))
      .map(({ event, index }) => ({ record: watchdogRecordFromEvent(event), index }))
      .filter((entry): entry is { record: OpenCodeWatchdogRecord; index: number } => !!entry.record)
  }

  private async forcedReportRequests(): Promise<OpenCodeForcedReportRequest[]> {
    return (await this.options.eventStore.readAll()).filter(isForcedReportEvent).map(forcedReportFromEvent).filter((record): record is OpenCodeForcedReportRequest => !!record)
  }

  private async allLaunchRecords(): Promise<Array<{ session_id: string; status: string }>> {
    const records = new Map<string, { session_id: string; status: string }>()
    for (const event of await this.options.eventStore.readAll()) {
      if (!isLaunchRecordEvent(event) || typeof event.launch_id !== "string" || typeof event.session_id !== "string") continue
      records.set(event.launch_id, {
        session_id: event.session_id,
        status: readLaunchRecordStatus(event),
      })
    }
    return [...records.values()]
  }

  private async latestNonHeartbeatProgress(sessionId: string, launchId: string | undefined): Promise<WatchdogProgressEvidence | null> {
    const events = await this.options.eventStore.readAll()
    for (const event of [...events].reverse()) {
      if (event.kind !== "opencode_session_progress_recorded") continue
      if (event.progress_kind === "heartbeat") continue
      if (event.session_id !== sessionId) continue
      if (launchId && event.launch_id !== launchId) continue
      const kind = readProgressKind(event.progress_kind)
      return {
        progress_id: typeof event.progress_id === "string" ? event.progress_id : "unknown",
        recorded_at: typeof event.recorded_at === "string" ? event.recorded_at : "",
        kind,
        execution_state: readExecutionState(event.execution_state, defaultExecutionState(kind)),
        blockers_preview: boundArray(Array.isArray(event.blockers_preview) ? event.blockers_preview : []),
        question_preview: bound(event.question_preview),
      }
    }
    return null
  }

  private async findForcedReportForEvidence(sessionId: string, launchId: string | undefined, latestProgressId: string | undefined): Promise<OpenCodeForcedReportRequest | null> {
    return (await this.forcedReportRequests()).find((request) =>
      request.session_id === sessionId &&
      (launchId ? request.launch_id === launchId : true) &&
      (latestProgressId ? request.latest_progress_id === latestProgressId : true)
    ) ?? null
  }
}

export function readOpenCodeWatchdogPreviewInput(value: unknown): OpenCodeWatchdogPreviewInput {
  const input = isRecord(value) ? value : {}
  return {
    session_id: optional(input.sessionId ?? input.session_id ?? input.session),
    launch_id: optional(input.launchId ?? input.launch_id ?? input.launch),
    max_wall_time_ms: optionalNumber(input.maxWallTimeMs ?? input.max_wall_time_ms),
    max_no_progress_ms: optionalNumber(input.maxNoProgressMs ?? input.max_no_progress_ms),
    heartbeat_interval_ms: optionalNumber(input.heartbeatIntervalMs ?? input.heartbeat_interval_ms),
    include_latest_progress: optionalBoolean(input.includeLatestProgress ?? input.include_latest_progress),
  }
}

export function readOpenCodeWatchdogRecordInput(value: unknown): OpenCodeWatchdogRecordInput {
  const input = isRecord(value) ? value : {}
  return {
    ...readOpenCodeWatchdogPreviewInput(input),
    dry_run: optionalBoolean(input.dryRun ?? input.dry_run),
    recorded_by: optional(input.recordedBy ?? input.recorded_by),
    request_report: optionalBoolean(input.requestReport ?? input.request_report),
  }
}

export function readOpenCodeForcedReportInput(value: unknown): OpenCodeForcedReportInput {
  const input = isRecord(value) ? value : {}
  return {
    session_id: optional(input.sessionId ?? input.session_id ?? input.session),
    launch_id: optional(input.launchId ?? input.launch_id ?? input.launch),
    reason: optionalRawText(input.reason),
    dry_run: optionalBoolean(input.dryRun ?? input.dry_run),
    requested_by: optional(input.requestedBy ?? input.requested_by),
  }
}

function computeWatchdogStatus(input: {
  latestProgress: Pick<OpenCodeProgressResult, "kind" | "execution_state"> | null
  wallClockElapsedMs?: number
  noProgressElapsedMs?: number
  heartbeatElapsedMs?: number
  maxWallTimeMs: number
  maxNoProgressMs: number
  heartbeatIntervalMs: number
  hasBlockers: boolean
  hasQuestion: boolean
}): { status: OpenCodeWatchdogStatus; action: OpenCodeWatchdogAction; warnings: string[] } {
  const warnings: string[] = []
  const latest = input.latestProgress
  if (latest?.kind === "failure_report" || latest?.execution_state === "reported_failed") {
    warnings.push("failure_report is evidence only; it does not fail mission/session authority")
    return { status: "blocked", action: "record_assessment", warnings }
  }
  if (latest?.kind === "completion_report" || latest?.execution_state === "reported_done") {
    warnings.push("completion_report is evidence only; it does not complete mission/session authority")
    return { status: "healthy", action: "none", warnings }
  }
  if (input.hasBlockers) return { status: "blocked", action: "escalate_to_commander", warnings: ["blocker metadata found; Commander escalation protocol is future work"] }
  if (input.hasQuestion) return { status: "needs_report", action: "request_report", warnings: ["question metadata found; OpenCode asks Commander protocol is future work"] }
  if ((input.wallClockElapsedMs ?? 0) > input.maxWallTimeMs) return { status: "timed_out", action: "request_report", warnings }
  if ((input.noProgressElapsedMs ?? 0) > input.maxNoProgressMs) return { status: "needs_report", action: "request_report", warnings }
  if ((input.heartbeatElapsedMs ?? 0) > input.heartbeatIntervalMs * 2) return { status: "stale", action: "request_report", warnings }
  return { status: "healthy", action: "none", warnings }
}

function shouldAllowForcedReport(status: OpenCodeWatchdogStatus, hasBlockers: boolean, hasQuestion: boolean): boolean {
  return status === "stale" || status === "timed_out" || status === "needs_report" || (status === "blocked" && (hasBlockers || hasQuestion))
}

function resultFromPreview(preview: OpenCodeWatchdogPreview, overrides: { watchdog_id: string; status: OpenCodeWatchdogResult["status"]; recorded_at: string; recorded_by: string; error?: string }): OpenCodeWatchdogResult {
  return redactValue({
    watchdog_id: overrides.watchdog_id,
    status: overrides.status,
    session_id: preview.session_id,
    launch_id: preview.launch_id,
    watchdog_status: preview.watchdog_status,
    recommended_action: preview.recommended_action,
    report_required: preview.report_required,
    forced_report_requested: false,
    latest_progress_id: preview.latest_progress_id,
    latest_progress_kind: preview.latest_progress_kind,
    latest_progress_state: preview.latest_progress_state,
    latest_progress_at: preview.latest_progress_at,
    wall_clock_elapsed_ms: preview.wall_clock_elapsed_ms,
    no_progress_elapsed_ms: preview.no_progress_elapsed_ms,
    heartbeat_elapsed_ms: preview.heartbeat_elapsed_ms,
    recorded_at: overrides.recorded_at,
    recorded_by: overrides.recorded_by,
    error: bound(overrides.error),
    watchdog_hash: hash(stableJson({ watchdog_id: overrides.watchdog_id, preview_hash: preview.watchdog_hash, status: overrides.status })),
    recommended_commands: preview.recommended_commands,
  })
}

function watchdogEventPayload(result: OpenCodeWatchdogResult): Record<string, unknown> {
  return redactValue({
    kind: "opencode_session_watchdog_recorded",
    watchdog_id: result.watchdog_id,
    session_id: result.session_id,
    launch_id: result.launch_id,
    watchdog_status: result.watchdog_status,
    recommended_action: result.recommended_action,
    report_required: result.report_required,
    wall_clock_elapsed_ms: result.wall_clock_elapsed_ms,
    no_progress_elapsed_ms: result.no_progress_elapsed_ms,
    heartbeat_elapsed_ms: result.heartbeat_elapsed_ms,
    latest_progress_id: result.latest_progress_id,
    latest_progress_kind: result.latest_progress_kind,
    latest_progress_state: result.latest_progress_state,
    latest_progress_at: result.latest_progress_at,
    has_blockers: result.watchdog_status === "blocked",
    has_question: result.latest_progress_kind === "question" || result.latest_progress_state === "needs_commander",
    recorded_at: result.recorded_at,
    recorded_by: result.recorded_by,
    watchdog_hash: result.watchdog_hash,
  })
}

function forcedReportEventPayload(request: OpenCodeForcedReportRequest): Record<string, unknown> {
  return redactValue({
    kind: "opencode_session_forced_report_requested",
    request_id: request.request_id,
    watchdog_id: request.watchdog_id,
    session_id: request.session_id,
    launch_id: request.launch_id,
    reason: request.reason,
    requested_at: request.requested_at,
    requested_by: request.requested_by,
    latest_progress_id: request.latest_progress_id,
    report_due_after_ms: request.report_due_after_ms,
    forced_pause_recommended: request.forced_pause_recommended,
    process_paused: false,
    request_hash: request.request_hash,
  })
}

function watchdogRecordFromEvent(event: JsonlEvent): OpenCodeWatchdogRecord | null {
  if (typeof event.watchdog_id !== "string" || typeof event.session_id !== "string") return null
  return redactValue({
    watchdog_id: event.watchdog_id,
    session_id: event.session_id,
    launch_id: typeof event.launch_id === "string" ? event.launch_id : undefined,
    watchdog_status: readWatchdogStatus(event.watchdog_status),
    recommended_action: readWatchdogAction(event.recommended_action),
    report_required: event.report_required === true,
    recorded_at: typeof event.recorded_at === "string" ? event.recorded_at : "",
    recorded_by: bound(event.recorded_by) ?? "unknown",
    latest_progress_id: typeof event.latest_progress_id === "string" ? event.latest_progress_id : undefined,
    watchdog_hash: typeof event.watchdog_hash === "string" ? event.watchdog_hash : hash(stableJson(event)),
  })
}

function watchdogResultFromEvent(event: JsonlEvent, linkedRequest?: OpenCodeForcedReportRequest): OpenCodeWatchdogResult {
  const record = watchdogRecordFromEvent(event)
  return redactValue({
    watchdog_id: String(event.watchdog_id ?? ""),
    status: "recorded",
    session_id: String(event.session_id ?? ""),
    launch_id: typeof event.launch_id === "string" ? event.launch_id : undefined,
    watchdog_status: readWatchdogStatus(event.watchdog_status),
    recommended_action: readWatchdogAction(event.recommended_action),
    report_required: event.report_required === true,
    forced_report_requested: Boolean(linkedRequest),
    forced_report_request_id: linkedRequest?.request_id,
    latest_progress_id: typeof event.latest_progress_id === "string" ? event.latest_progress_id : undefined,
    latest_progress_kind: typeof event.latest_progress_kind === "string" ? event.latest_progress_kind : undefined,
    latest_progress_state: typeof event.latest_progress_state === "string" ? event.latest_progress_state : undefined,
    latest_progress_at: typeof event.latest_progress_at === "string" ? event.latest_progress_at : undefined,
    wall_clock_elapsed_ms: typeof event.wall_clock_elapsed_ms === "number" ? event.wall_clock_elapsed_ms : undefined,
    no_progress_elapsed_ms: typeof event.no_progress_elapsed_ms === "number" ? event.no_progress_elapsed_ms : undefined,
    heartbeat_elapsed_ms: typeof event.heartbeat_elapsed_ms === "number" ? event.heartbeat_elapsed_ms : undefined,
    recorded_at: record?.recorded_at ?? "",
    recorded_by: record?.recorded_by ?? "unknown",
    watchdog_hash: record?.watchdog_hash ?? hash(stableJson(event)),
    recommended_commands: recommendedCommands(String(event.session_id ?? "<session_id>"), typeof event.launch_id === "string" ? event.launch_id : undefined),
  })
}

function forcedReportFromEvent(event: JsonlEvent): OpenCodeForcedReportRequest | null {
  if (typeof event.request_id !== "string" || typeof event.session_id !== "string") return null
  return redactValue({
    request_id: event.request_id,
    session_id: event.session_id,
    launch_id: typeof event.launch_id === "string" ? event.launch_id : undefined,
    watchdog_id: typeof event.watchdog_id === "string" ? event.watchdog_id : undefined,
    reason: bound(event.reason) ?? "forced report requested",
    requested_at: typeof event.requested_at === "string" ? event.requested_at : "",
    requested_by: bound(event.requested_by) ?? "unknown",
    latest_progress_id: typeof event.latest_progress_id === "string" ? event.latest_progress_id : undefined,
    report_due_after_ms: typeof event.report_due_after_ms === "number" ? event.report_due_after_ms : undefined,
    forced_pause_recommended: event.forced_pause_recommended === true,
    process_paused: false as const,
    command_to_operator_preview: "metadata only: no OpenCode process was paused or prompted",
    request_hash: typeof event.request_hash === "string" ? event.request_hash : hash(stableJson(event)),
  })
}

function compareRecordEntriesDesc(left: { record: OpenCodeWatchdogRecord; index: number }, right: { record: OpenCodeWatchdogRecord; index: number }): number {
  const time = right.record.recorded_at.localeCompare(left.record.recorded_at)
  return time !== 0 ? time : right.index - left.index
}

function compareRecordEntriesAsc(left: { record: OpenCodeWatchdogRecord; index: number }, right: { record: OpenCodeWatchdogRecord; index: number }): number {
  const time = left.record.recorded_at.localeCompare(right.record.recorded_at)
  return time !== 0 ? time : left.index - right.index
}

function isWatchdogEvent(event: JsonlEvent): boolean {
  return event.kind === "opencode_session_watchdog_recorded"
}

function isForcedReportEvent(event: JsonlEvent): boolean {
  return event.kind === "opencode_session_forced_report_requested"
}

function isLaunchRecordEvent(event: JsonlEvent): boolean {
  return event.kind === "opencode_session_launch_started" || event.kind === "opencode_session_launch_succeeded" || event.kind === "opencode_session_launch_failed"
}

function readLaunchRecordStatus(event: JsonlEvent): string {
  if (event.status === "launch_started" || event.status === "launched" || event.status === "launch_failed") return event.status
  if (event.kind === "opencode_session_launch_failed") return "launch_failed"
  if (event.kind === "opencode_session_launch_started") return "launch_started"
  return "launched"
}

function isForcedReportRequestShape(value: unknown): value is OpenCodeForcedReportRequest {
  return isRecord(value) && typeof value.request_id === "string"
}

function recommendedCommands(sessionId: string, launchId?: string): OpenCodeWatchdogCommand[] {
  const launchArg = launchId ? ` launch=${launchId}` : ""
  return [
    { label: "Preview watchdog", command: `/opencode-watchdog-preview session=${sessionId}${launchArg}`, command_type: "read" },
    { label: "Record watchdog", command: `/opencode-watchdog-record session=${sessionId}`, command_type: "write", requires_active_runtime: true, notes: "metadata only; no process pause/kill or Commander guidance" },
    { label: "Request report", command: `/opencode-force-report session=${sessionId} reason=<reason>`, command_type: "write", requires_active_runtime: true, notes: "metadata only; process_paused=false" },
    { label: "Latest progress", command: `/opencode-progress-latest session=${sessionId}${launchArg}`, command_type: "read" },
  ]
}

function readWatchdogStatus(value: unknown): OpenCodeWatchdogStatus {
  return value === "healthy" || value === "stale" || value === "timed_out" || value === "blocked" || value === "needs_report" || value === "unknown" ? value : "unknown"
}

function readWatchdogAction(value: unknown): OpenCodeWatchdogAction {
  return value === "none" || value === "record_assessment" || value === "request_report" || value === "escalate_to_commander" || value === "escalate_to_human" ? value : "none"
}

function readProgressKind(value: unknown): OpenCodeProgressKind {
  return value === "progress" || value === "blocker" || value === "question" || value === "checkpoint_note" || value === "completion_report" || value === "failure_report" ? value : "heartbeat"
}

function defaultExecutionState(kind: OpenCodeProgressKind): OpenCodeExecutionState {
  if (kind === "blocker") return "blocked"
  if (kind === "question") return "needs_commander"
  if (kind === "completion_report") return "reported_done"
  if (kind === "failure_report") return "reported_failed"
  return "running"
}

function readExecutionState(value: unknown, fallback: OpenCodeExecutionState): OpenCodeExecutionState {
  return value === "running" || value === "working" || value === "waiting" || value === "blocked" || value === "needs_commander" || value === "needs_human" || value === "reported_done" || value === "reported_failed" || value === "unknown" ? value : fallback
}

function elapsed(nowMs: number, iso: string | undefined): number | undefined {
  if (!iso) return undefined
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return undefined
  return Math.max(0, nowMs - then)
}

function clampMs(value: number | undefined, fallback: number, min: number, max: number): number {
  const raw = typeof value === "number" && Number.isFinite(value) ? value : fallback
  return Math.max(min, Math.min(max, Math.floor(raw)))
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? bound(value) : undefined
}

function optionalRawText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value
  if (value === "true") return true
  if (value === "false") return false
  return undefined
}

function bound(value: unknown, max = MAX_TEXT): string | undefined {
  if (value === undefined || value === null) return undefined
  return redactText(String(value)).slice(0, max)
}

function boundArray(values: unknown[] | undefined, limit = MAX_ARRAY): string[] {
  return (values ?? []).map((item) => bound(item) ?? "").filter(Boolean).slice(0, limit)
}

function looksLikeRawLog(value: unknown): boolean {
  if (typeof value !== "string") return false
  if (value.length > 2_000) return true
  return RAW_LOG_PATTERNS.some((pattern) => pattern.test(value))
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item
    return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)))
  })
}
