import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { OpenCodeLaunchGateService } from "./opencode-launch-gate-service"
import type { OpenCodeLaunchRecord, OpenCodeLaunchResult } from "./opencode-launch-gate-types"
import type { OpenCodeSessionService } from "./opencode-session-service"
import type {
  OpenCodeExecutionState,
  OpenCodeProgressAppendInput,
  OpenCodeProgressCommand,
  OpenCodeProgressKind,
  OpenCodeProgressPreview,
  OpenCodeProgressPreviewInput,
  OpenCodeProgressRecord,
  OpenCodeProgressResult,
  OpenCodeProgressSourceKind,
  OpenCodeProgressSummary,
} from "./opencode-progress-types"

const MAX_LIST = 100
const MAX_ARRAY = 12
const MAX_TEXT = 320
const NORMAL_LAUNCH_STATUSES = new Set(["launch_started", "launched"])
const RAW_LOG_PATTERNS = [
  /\n.{80,}\n.{80,}\n/s,
  /(stdout|stderr|traceback|stack trace|bun test v|npm error|error:).{0,80}\n/i,
  /(\[[0-9]{2}:[0-9]{2}:[0-9]{2}\].*\n){3,}/i,
]

export type OpenCodeProgressServiceOptions = {
  eventStore: EventStore
  opencodeSessionService: OpenCodeSessionService
  launchGateService: OpenCodeLaunchGateService
  now?: () => Date
  idFactory?: () => string
}

type BuiltProgressPreview = {
  preview: OpenCodeProgressPreview
  launch?: OpenCodeLaunchResult | OpenCodeLaunchRecord | null
}

type SequencedProgressRecord = {
  record: OpenCodeProgressRecord
  event_index: number
}

export class OpenCodeProgressService {
  private readonly now: () => Date
  private readonly idFactory: () => string

  constructor(private readonly options: OpenCodeProgressServiceOptions) {
    this.now = options.now ?? (() => new Date())
    this.idFactory = options.idFactory ?? (() => `opencode_progress_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`)
  }

  async preview(input: OpenCodeProgressPreviewInput = {}): Promise<OpenCodeProgressPreview> {
    return (await this.buildPreview(input)).preview
  }

  async record(input: OpenCodeProgressAppendInput = {}): Promise<OpenCodeProgressResult> {
    const recordedAt = this.now().toISOString()
    const recordedBy = bound(input.recorded_by ?? "operator") ?? "operator"
    const built = await this.buildPreview(input)
    const preview = built.preview
    const progressId = this.idFactory()
    if (!preview.can_record) {
      return resultFromPreview(preview, {
        progress_id: progressId,
        status: "blocked",
        recorded_at: recordedAt,
        recorded_by: recordedBy,
        error: preview.blockers[0] ?? "OpenCode progress report is blocked",
      })
    }
    if (input.dry_run === true) {
      return resultFromPreview(preview, {
        progress_id: progressId,
        status: "dry_run",
        recorded_at: recordedAt,
        recorded_by: recordedBy,
      })
    }
    const existing = await this.get(progressId)
    if (existing) {
      return resultFromPreview(preview, {
        progress_id: progressId,
        status: "blocked",
        recorded_at: recordedAt,
        recorded_by: recordedBy,
        error: "progress_id already exists",
      })
    }
    const result = resultFromPreview(preview, {
      progress_id: progressId,
      status: "recorded",
      recorded_at: recordedAt,
      recorded_by: recordedBy,
    })
    await this.options.eventStore.append(eventPayload(result) as JsonlEvent)
    return redactValue(result)
  }

  async list(input: { limit?: number; session_id?: string; launch_id?: string; kind?: string; execution_state?: string } = {}): Promise<OpenCodeProgressRecord[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, MAX_LIST))
    return (await this.sequencedRecords())
      .filter((item) => !input.session_id || item.record.session_id === input.session_id)
      .filter((item) => !input.launch_id || item.record.launch_id === input.launch_id)
      .filter((item) => !input.kind || item.record.kind === input.kind)
      .filter((item) => !input.execution_state || item.record.execution_state === input.execution_state)
      .sort(compareSequencedProgressRecords)
      .map((item) => item.record)
      .slice(0, limit)
  }

  async get(progressId: string): Promise<OpenCodeProgressResult | null> {
    const event = (await this.options.eventStore.readAll())
      .filter(isProgressEvent)
      .reverse()
      .find((item) => item.progress_id === progressId)
    return event ? resultFromEvent(event) : null
  }

  async latest(input: { session_id?: string; launch_id?: string } = {}): Promise<OpenCodeProgressResult | null> {
    const latest = (await this.list({ ...input, limit: 1 }))[0]
    return latest ? this.get(latest.progress_id) : null
  }

  async summary(input: { limit?: number } = {}): Promise<OpenCodeProgressSummary> {
    const sequenced = await this.sequencedRecords()
    const records = sequenced.map((item) => item.record)
    const latest = new Map<string, SequencedProgressRecord>()
    for (const item of [...sequenced].sort(compareSequencedProgressRecordsAscending)) {
      latest.set(item.record.session_id, item)
    }
    const latestRecords = [...latest.values()]
      .sort(compareSequencedProgressRecords)
      .map((item) => item.record)
      .slice(0, Math.max(1, Math.min(input.limit ?? 10, MAX_LIST)))
    return redactValue({
      total_records: records.length,
      session_count: new Set(records.map((record) => record.session_id)).size,
      launched_session_count: new Set(records.filter((record) => record.launch_id).map((record) => record.session_id)).size,
      latest_records: latestRecords,
      blocked_count: records.filter((record) => record.has_blockers || record.execution_state === "blocked").length,
      question_count: records.filter((record) => record.has_question || record.kind === "question").length,
      heartbeat_count: records.filter((record) => record.kind === "heartbeat").length,
      generated_at: this.now().toISOString(),
    })
  }

  private async buildPreview(input: OpenCodeProgressPreviewInput = {}): Promise<BuiltProgressPreview> {
    const generatedAt = this.now().toISOString()
    const kind = readProgressKind(input.kind)
    const executionState = readExecutionState(input.execution_state, defaultExecutionState(kind))
    const sourceKind = readSourceKind(input.source_kind)
    const sessionIdInput = optional(input.session_id)
    const launchId = optional(input.launch_id)
    const blockers: string[] = []
    const warnings = new Set<string>([
      "progress records do not mutate missions, accept results, enforce timeouts, ask Commander, launch OpenCode, call providers, call MCPs, or write research.db",
      "heartbeat records show reported activity only; they do not prove task success",
    ])
    if (!sessionIdInput && !launchId) blockers.push("session_id or launch_id is required")

    let launch: OpenCodeLaunchResult | OpenCodeLaunchRecord | null | undefined
    if (launchId) {
      launch = await this.options.launchGateService.get(launchId)
      if (!launch) blockers.push("launch_id does not resolve to an OpenCode launch record")
    }
    let sessionId = sessionIdInput ?? launch?.session_id ?? ""
    if (sessionIdInput) {
      const session = await this.options.opencodeSessionService.get(sessionIdInput)
      if (!session) blockers.push("session_id does not resolve to a planned OpenCode session")
    }
    if (!launch && sessionId) {
      const launches = await this.resolveLaunchesForSession(sessionId)
      launch = launches[0] ?? null
      if (!launch) blockers.push("OpenCode progress requires a launch record for the session")
    }
    if (launch && sessionIdInput && launch.session_id !== sessionIdInput) blockers.push("launch_id does not belong to session_id")
    sessionId = sessionId || launch?.session_id || ""
    if (launch && NORMAL_LAUNCH_STATUSES.has(launch.status)) {
      // allowed
    } else if (launch?.status === "launch_failed") {
      if (kind !== "failure_report") blockers.push("launch_failed records only allow failure_report progress metadata")
    } else if (launch) {
      blockers.push(`OpenCode progress requires launch_started or launched status; current status is ${launch.status}`)
    }

    const summary = bound(input.report_summary)
    const currentStep = bound(input.current_step)
    const filesTouched = boundArray(input.files_touched)
    const commandsRun = boundArray(input.commands_run)
    const testsRun = boundArray(input.tests_run)
    const artifacts = boundArray(input.artifacts)
    const blockersPreview = boundArray(input.blockers)
    const question = bound(input.question)
    const nextAction = bound(input.next_action)
    const confidence = readConfidence(input.confidence)

    if ((kind === "heartbeat" || kind === "progress" || kind === "blocker") && !summary) blockers.push("report_summary is required for heartbeat, progress, and blocker records")
    if (kind === "question" && !question) blockers.push("question is required for question records")
    if (kind === "blocker" && blockersPreview.length === 0) blockers.push("blocker metadata is required for blocker records")
    if (progressInputLooksLikeRawLog(input)) {
      blockers.push("raw logs are out of scope for progress records; attach an artifact pointer in a later branch")
    }
    const progressHash = hash(stableJson({
      session_id: sessionId,
      launch_id: launch?.launch_id ?? launchId,
      kind,
      execution_state: executionState,
      report_summary_preview: summary,
      current_step_preview: currentStep,
      files_touched_preview: filesTouched,
      commands_run_preview: commandsRun,
      tests_run_preview: testsRun,
      artifacts_preview: artifacts,
      blockers_preview: blockersPreview,
      question_preview: question,
      confidence,
      next_action_preview: nextAction,
      source_kind: sourceKind,
    }))
    const canRecord = blockers.length === 0
    return {
      preview: redactValue({
        preview_id: `opencode_progress_preview_${progressHash.slice(0, 16)}`,
        status: canRecord ? "ready" : "blocked",
        can_record: canRecord,
        session_id: sessionId,
        launch_id: launch?.launch_id ?? launchId,
        launch_status: launch?.status,
        launch_started_at: launch && "started_at" in launch ? launch.started_at : undefined,
        kind,
        execution_state: executionState,
        report_summary_preview: summary ?? (kind === "question" ? "question metadata report" : "OpenCode progress report"),
        current_step_preview: currentStep,
        files_touched_preview: filesTouched,
        commands_run_preview: commandsRun,
        tests_run_preview: testsRun,
        artifacts_preview: artifacts,
        blockers_preview: blockersPreview,
        question_preview: question,
        confidence,
        next_action_preview: nextAction,
        source_kind: sourceKind,
        blockers: boundArray(unique(blockers)),
        warnings: boundArray(unique([...warnings])),
        recommended_commands: recommendedCommands(sessionId || "<session_id>", launch?.launch_id ?? launchId),
        generated_at: generatedAt,
        redacted_summary_preview: canRecord ? `${kind} metadata ready for ${sessionId}` : blockers[0] ?? "OpenCode progress blocked",
        progress_hash: progressHash,
      }),
      launch,
    }
  }

  private async records(): Promise<OpenCodeProgressRecord[]> {
    return (await this.sequencedRecords()).map((item) => item.record)
  }

  private async sequencedRecords(): Promise<SequencedProgressRecord[]> {
    return (await this.options.eventStore.readAll())
      .map((event, event_index) => ({ event, event_index }))
      .filter((item) => isProgressEvent(item.event))
      .map((item) => ({ record: recordFromEvent(item.event), event_index: item.event_index }))
      .filter((item): item is SequencedProgressRecord => !!item.record)
  }

  private async resolveLaunchesForSession(sessionId: string): Promise<Array<OpenCodeLaunchResult | OpenCodeLaunchRecord>> {
    const records = await this.options.launchGateService.list({ session_id: sessionId, limit: 100 })
    const resolved = new Map<string, OpenCodeLaunchResult | OpenCodeLaunchRecord>()
    for (const record of records) {
      const latest = await this.options.launchGateService.get(record.launch_id)
      resolved.set(record.launch_id, latest ?? record)
    }
    return [...resolved.values()].sort(compareLaunchRecords)
  }
}

export function readOpenCodeProgressPreviewInput(value: unknown): OpenCodeProgressPreviewInput {
  const input = isRecord(value) ? value : {}
  return {
    session_id: optional(input.sessionId ?? input.session_id ?? input.session),
    launch_id: optional(input.launchId ?? input.launch_id ?? input.launch),
    kind: optional(input.kind),
    execution_state: optional(input.executionState ?? input.execution_state),
    report_summary: optionalRawText(input.reportSummary ?? input.report_summary ?? input.summary),
    current_step: optionalRawText(input.currentStep ?? input.current_step ?? input.step),
    files_touched: optionalStringArray(input.filesTouched ?? input.files_touched ?? input.files),
    commands_run: optionalStringArray(input.commandsRun ?? input.commands_run ?? input.commands),
    tests_run: optionalStringArray(input.testsRun ?? input.tests_run ?? input.tests),
    artifacts: optionalStringArray(input.artifacts),
    blockers: optionalStringArray(input.blockers ?? input.blocker),
    question: optionalRawText(input.question),
    confidence: readConfidence(input.confidence),
    next_action: optionalRawText(input.nextAction ?? input.next_action ?? input.next),
    source_kind: optional(input.sourceKind ?? input.source_kind ?? input.source),
  }
}

export function readOpenCodeProgressAppendInput(value: unknown): OpenCodeProgressAppendInput {
  const input = isRecord(value) ? value : {}
  return {
    ...readOpenCodeProgressPreviewInput(input),
    dry_run: optionalBoolean(input.dryRun ?? input.dry_run),
    recorded_by: optional(input.recordedBy ?? input.recorded_by),
  }
}

function resultFromPreview(preview: OpenCodeProgressPreview, overrides: { progress_id: string; status: OpenCodeProgressResult["status"]; recorded_at: string; recorded_by: string; error?: string }): OpenCodeProgressResult {
  return redactValue({
    progress_id: overrides.progress_id,
    status: overrides.status,
    session_id: preview.session_id,
    launch_id: preview.launch_id,
    kind: preview.kind,
    execution_state: preview.execution_state,
    report_summary_preview: preview.report_summary_preview,
    current_step_preview: preview.current_step_preview,
    files_touched_preview: preview.files_touched_preview,
    commands_run_preview: preview.commands_run_preview,
    tests_run_preview: preview.tests_run_preview,
    artifacts_preview: preview.artifacts_preview,
    blockers_preview: preview.blockers_preview,
    question_preview: preview.question_preview,
    confidence: preview.confidence,
    next_action_preview: preview.next_action_preview,
    recorded_at: overrides.recorded_at,
    recorded_by: overrides.recorded_by,
    source_kind: preview.source_kind,
    error: bound(overrides.error),
    progress_hash: hash(stableJson({ progress_id: overrides.progress_id, preview_hash: preview.progress_hash, status: overrides.status })),
    recommended_commands: preview.recommended_commands,
  })
}

function eventPayload(result: OpenCodeProgressResult): Record<string, unknown> {
  return redactValue({
    kind: "opencode_session_progress_recorded",
    progress_id: result.progress_id,
    session_id: result.session_id,
    launch_id: result.launch_id,
    progress_kind: result.kind,
    execution_state: result.execution_state,
    report_summary_preview: result.report_summary_preview,
    current_step_preview: result.current_step_preview,
    files_touched_preview: result.files_touched_preview,
    commands_run_preview: result.commands_run_preview,
    tests_run_preview: result.tests_run_preview,
    artifacts_preview: result.artifacts_preview,
    blockers_preview: result.blockers_preview,
    question_preview: result.question_preview,
    confidence: result.confidence,
    next_action_preview: result.next_action_preview,
    recorded_at: result.recorded_at,
    recorded_by: result.recorded_by,
    source_kind: result.source_kind,
    progress_hash: result.progress_hash,
  })
}

function recordFromEvent(event: JsonlEvent): OpenCodeProgressRecord | null {
  if (typeof event.progress_id !== "string" || typeof event.session_id !== "string") return null
  const blockers = Array.isArray(event.blockers_preview) ? event.blockers_preview.filter((item) => typeof item === "string") : []
  return redactValue({
    progress_id: event.progress_id,
    session_id: event.session_id,
    launch_id: typeof event.launch_id === "string" ? event.launch_id : undefined,
    kind: readProgressKind(event.progress_kind),
    execution_state: readExecutionState(event.execution_state, "unknown"),
    report_summary_preview: bound(event.report_summary_preview) ?? "OpenCode progress report",
    recorded_at: typeof event.recorded_at === "string" ? event.recorded_at : "",
    recorded_by: bound(event.recorded_by) ?? "unknown",
    source_kind: readSourceKind(event.source_kind),
    confidence: readConfidence(event.confidence),
    has_blockers: blockers.length > 0,
    has_question: typeof event.question_preview === "string" && event.question_preview.length > 0,
    progress_hash: typeof event.progress_hash === "string" ? event.progress_hash : hash(stableJson(event)),
  })
}

function resultFromEvent(event: JsonlEvent): OpenCodeProgressResult {
  const record = recordFromEvent(event)
  return redactValue({
    progress_id: String(event.progress_id ?? ""),
    status: "recorded",
    session_id: String(event.session_id ?? ""),
    launch_id: typeof event.launch_id === "string" ? event.launch_id : undefined,
    kind: readProgressKind(event.progress_kind),
    execution_state: readExecutionState(event.execution_state, "unknown"),
    report_summary_preview: bound(event.report_summary_preview) ?? "OpenCode progress report",
    current_step_preview: bound(event.current_step_preview),
    files_touched_preview: eventStringArray(event.files_touched_preview),
    commands_run_preview: eventStringArray(event.commands_run_preview),
    tests_run_preview: eventStringArray(event.tests_run_preview),
    artifacts_preview: eventStringArray(event.artifacts_preview),
    blockers_preview: eventStringArray(event.blockers_preview),
    question_preview: bound(event.question_preview),
    confidence: readConfidence(event.confidence),
    next_action_preview: bound(event.next_action_preview),
    recorded_at: record?.recorded_at ?? "",
    recorded_by: record?.recorded_by ?? "unknown",
    source_kind: readSourceKind(event.source_kind),
    progress_hash: record?.progress_hash ?? hash(stableJson(event)),
    recommended_commands: recommendedCommands(String(event.session_id ?? "<session_id>"), typeof event.launch_id === "string" ? event.launch_id : undefined),
  })
}

function isProgressEvent(event: JsonlEvent): boolean {
  return event.kind === "opencode_session_progress_recorded"
}

function recommendedCommands(sessionId: string, launchId?: string): OpenCodeProgressCommand[] {
  const launchArg = launchId ? ` launch=${launchId}` : ""
  return [
    { label: "Preview heartbeat", command: `/opencode-progress-preview session=${sessionId} summary=<summary>`, command_type: "read" },
    { label: "Record heartbeat", command: `/opencode-heartbeat session=${sessionId} summary=<summary>`, command_type: "write", requires_active_runtime: true, notes: "metadata only; does not mutate missions or supervise timeout" },
    { label: "List progress", command: `/opencode-progress-list session=${sessionId}`, command_type: "read" },
    { label: "Latest progress", command: `/opencode-progress-latest session=${sessionId}${launchArg}`, command_type: "read" },
  ]
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

function readSourceKind(value: unknown): OpenCodeProgressSourceKind {
  return value === "adapter" || value === "fake" || value === "unknown" ? value : "manual"
}

function readConfidence(value: unknown): number | "low" | "medium" | "high" | "unknown" | undefined {
  if (value === undefined || value === null || value === "") return undefined
  if (value === "low" || value === "medium" || value === "high" || value === "unknown") return value
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.min(1, value))
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(1, parsed))
  }
  return "unknown"
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? bound(value) : undefined
}

function optionalRawText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value
  if (value === "true") return true
  if (value === "false") return false
  return undefined
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map((item) => String(item))
  if (typeof value === "string" && value.trim()) return value.split(",").map((item) => item.trim()).filter(Boolean)
  return undefined
}

function eventStringArray(value: unknown): string[] {
  return Array.isArray(value) ? boundArray(value.map((item) => String(item))) : []
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

function progressInputLooksLikeRawLog(input: OpenCodeProgressPreviewInput): boolean {
  return [
    input.report_summary,
    input.current_step,
    input.question,
    input.next_action,
    ...(input.files_touched ?? []),
    ...(input.commands_run ?? []),
    ...(input.tests_run ?? []),
    ...(input.artifacts ?? []),
    ...(input.blockers ?? []),
  ].some(looksLikeRawLog)
}

function compareSequencedProgressRecords(left: SequencedProgressRecord, right: SequencedProgressRecord): number {
  const time = right.record.recorded_at.localeCompare(left.record.recorded_at)
  return time || right.event_index - left.event_index
}

function compareSequencedProgressRecordsAscending(left: SequencedProgressRecord, right: SequencedProgressRecord): number {
  const time = left.record.recorded_at.localeCompare(right.record.recorded_at)
  return time || left.event_index - right.event_index
}

function compareLaunchRecords(left: OpenCodeLaunchResult | OpenCodeLaunchRecord, right: OpenCodeLaunchResult | OpenCodeLaunchRecord): number {
  const rightTime = "completed_at" in right && right.completed_at ? right.completed_at : right.started_at ?? ""
  const leftTime = "completed_at" in left && left.completed_at ? left.completed_at : left.started_at ?? ""
  return rightTime.localeCompare(leftTime)
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
