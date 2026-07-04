import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { OpenCodeLaunchGateService } from "./opencode-launch-gate-service"
import type { OpenCodeLaunchRecord, OpenCodeLaunchResult } from "./opencode-launch-gate-types"
import type { OpenCodeProgressService } from "./opencode-progress-service"
import type { OpenCodeTimeoutWatchdogService } from "./opencode-timeout-watchdog-service"
import type { OpenCodeCommanderQuestionService } from "./opencode-commander-question-service"
import type { CommanderGuidanceService } from "./opencode-commander-guidance-service"
import type { CommanderGuidanceDeliveryService } from "./opencode-guidance-delivery-service"
import type { OpenCodeSessionService } from "./opencode-session-service"
import type {
  OpenCodeHumanControlCommand,
  OpenCodeHumanControlKind,
  OpenCodeHumanControlPreview,
  OpenCodeHumanControlPreviewInput,
  OpenCodeHumanControlProjectionState,
  OpenCodeHumanControlRecord,
  OpenCodeHumanControlRecordInput,
  OpenCodeHumanControlResult,
  OpenCodeHumanControlSummary,
  OpenCodeHumanControlUrgency,
} from "./opencode-human-control-types"

const MAX_LIST = 100
const MAX_TEXT = 360
const MAX_RAW_TEXT = MAX_TEXT * 2
const LAUNCHED_STATUSES = new Set(["launch_started", "launched"])
const HUMAN_CONTROL_EVENT_KIND = "opencode_human_control_recorded"
const RAW_LOG_PATTERNS = [
  /\n.{80,}\n.{80,}\n/s,
  /(^|\s)(stdout|stderr|traceback|stack trace|bun test v|npm error|error:)(\s|$|:)/i,
  /(stdout|stderr|traceback|stack trace|bun test v|npm error|error:).{0,80}\n/i,
  /(\[[0-9]{2}:[0-9]{2}:[0-9]{2}\].*\n){3,}/i,
  /(full research\.db|full event log|raw opencode output|provider output|file contents)/i,
]

export type OpenCodeHumanControlServiceOptions = {
  eventStore: EventStore
  opencodeSessionService: OpenCodeSessionService
  launchGateService: OpenCodeLaunchGateService
  progressService: OpenCodeProgressService
  watchdogService: OpenCodeTimeoutWatchdogService
  questionService: OpenCodeCommanderQuestionService
  guidanceService: CommanderGuidanceService
  guidanceDeliveryService: CommanderGuidanceDeliveryService
  now?: () => Date
  idFactory?: () => string
}

type SequencedHumanControlRecord = {
  record: OpenCodeHumanControlRecord
  event_index: number
}

export class OpenCodeHumanControlService {
  private readonly now: () => Date
  private readonly idFactory: () => string
  private recordQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: OpenCodeHumanControlServiceOptions) {
    this.now = options.now ?? (() => new Date())
    this.idFactory = options.idFactory ?? (() => `opencode_human_control_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`)
  }

  async preview(input: OpenCodeHumanControlPreviewInput = {}): Promise<OpenCodeHumanControlPreview> {
    return this.buildPreview(input)
  }

  async record(input: OpenCodeHumanControlRecordInput = {}): Promise<OpenCodeHumanControlResult> {
    const preview = await this.buildPreview(input)
    const controlId = this.idFactory()
    const recordedAt = this.now().toISOString()
    const recordedBy = bound(input.recorded_by ?? "operator") ?? "operator"
    if (!preview.can_record) {
      return resultFromPreview(preview, {
        control_id: controlId,
        status: "blocked",
        recorded_at: recordedAt,
        recorded_by: recordedBy,
        error: preview.blockers[0] ?? "OpenCode human control is blocked",
      })
    }
    if (input.dry_run === true) {
      return resultFromPreview(preview, {
        control_id: controlId,
        status: "dry_run",
        recorded_at: recordedAt,
        recorded_by: recordedBy,
      })
    }
    return this.serializeRecord(async () => {
      const rebuilt = await this.buildPreview(input)
      if (!rebuilt.can_record) {
        return resultFromPreview(rebuilt, {
          control_id: controlId,
          status: "blocked",
          recorded_at: recordedAt,
          recorded_by: recordedBy,
          error: rebuilt.blockers[0] ?? "OpenCode human control is blocked",
        })
      }
      const duplicate = await this.findDuplicate(rebuilt)
      if (duplicate) {
        return resultFromPreview(rebuilt, {
          control_id: controlId,
          status: "blocked",
          recorded_at: recordedAt,
          recorded_by: recordedBy,
          error: `duplicate human control already exists: ${duplicate.control_id}`,
        })
      }
      const result = resultFromPreview(rebuilt, {
        control_id: controlId,
        status: "recorded",
        recorded_at: recordedAt,
        recorded_by: recordedBy,
      })
      await this.options.eventStore.append(eventPayload(result) as JsonlEvent)
      return redactValue(result)
    })
  }

  async list(input: { limit?: number; session_id?: string; launch_id?: string; control_kind?: string; projected_state_after?: string; urgency?: string } = {}): Promise<OpenCodeHumanControlRecord[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, MAX_LIST))
    return (await this.sequencedRecords())
      .filter((item) => !input.session_id || item.record.session_id === input.session_id)
      .filter((item) => !input.launch_id || item.record.launch_id === input.launch_id)
      .filter((item) => !input.control_kind || item.record.control_kind === input.control_kind)
      .filter((item) => !input.projected_state_after || item.record.projected_state_after === input.projected_state_after)
      .filter((item) => !input.urgency || item.record.urgency === input.urgency)
      .sort(compareSequencedDesc)
      .map((item) => item.record)
      .slice(0, limit)
  }

  async get(controlId: string): Promise<OpenCodeHumanControlResult | null> {
    const event = (await this.options.eventStore.readAll())
      .filter(isHumanControlEvent)
      .reverse()
      .find((item) => item.control_id === controlId)
    return event ? resultFromEvent(event) : null
  }

  async latest(input: { session_id?: string; launch_id?: string } = {}): Promise<OpenCodeHumanControlResult | null> {
    const latest = (await this.list({ ...input, limit: 1 }))[0]
    return latest ? this.get(latest.control_id) : null
  }

  async summary(input: { limit?: number } = {}): Promise<OpenCodeHumanControlSummary> {
    const records = (await this.sequencedRecords()).sort(compareSequencedDesc).map((item) => item.record)
    return redactValue({
      total_controls: records.length,
      session_count: new Set(records.map((record) => record.session_id)).size,
      pause_requested_count: records.filter((record) => record.projected_state_after === "pause_requested").length,
      stop_requested_count: records.filter((record) => record.projected_state_after === "stop_requested").length,
      correction_pending_count: records.filter((record) => record.projected_state_after === "correction_pending").length,
      override_pending_count: records.filter((record) => record.projected_state_after === "override_pending").length,
      report_requested_count: records.filter((record) => record.projected_state_after === "report_requested").length,
      escalation_count: records.filter((record) => record.projected_state_after === "escalated").length,
      urgent_count: records.filter((record) => record.urgency === "urgent").length,
      latest_controls: records.slice(0, Math.max(1, Math.min(input.limit ?? 10, MAX_LIST))),
      generated_at: this.now().toISOString(),
    })
  }

  private async buildPreview(input: OpenCodeHumanControlPreviewInput = {}): Promise<OpenCodeHumanControlPreview> {
    const generatedAt = this.now().toISOString()
    const controlKind = readControlKind(input.control_kind)
    const urgency = readUrgency(input.urgency)
    const projectedState = projectedStateForKind(controlKind)
    const sessionIdInput = optional(input.session_id)
    const launchIdInput = optional(input.launch_id)
    const blockers: string[] = []
    const warnings = new Set<string>([
      "human control records are metadata only; they do not pause, kill, stop, resume, launch, or prompt OpenCode",
      "human corrections and overrides are durable evidence for future Commander/wake review; they do not mutate missions",
      "no provider, MCP, research.db write, wake execution, scheduler execution, checkpoint, or mission/proposal/review/apply mutation occurs",
    ])
    if (!sessionIdInput && !launchIdInput && !hasLinkedEvidence(input)) blockers.push("session_id or launch_id is required")

    let launch: OpenCodeLaunchResult | OpenCodeLaunchRecord | null = null
    if (launchIdInput) {
      launch = await this.options.launchGateService.get(launchIdInput)
      if (!launch) blockers.push("launch_id does not resolve to an OpenCode launch record")
    }
    let sessionId = sessionIdInput ?? launch?.session_id ?? ""
    if (sessionId) {
      const session = await this.options.opencodeSessionService.get(sessionId)
      if (!session) blockers.push("session_id does not resolve to a planned OpenCode session")
    }
    const evidence = await this.resolveEvidence(input)
    for (const blocker of evidence.blockers) blockers.push(blocker)
    sessionId = sessionId || evidence.session_id || ""
    if (evidence.launch_id && !launch) {
      launch = await this.options.launchGateService.get(evidence.launch_id)
      if (!launch) blockers.push("linked evidence launch does not resolve to an OpenCode launch record")
    }
    if (!launch && sessionId) {
      launch = await this.resolveLatestLaunch(sessionId)
      if (!launch) blockers.push("OpenCode human controls require a launch record for the session")
    }
    if (launch && sessionIdInput && launch.session_id !== sessionIdInput) blockers.push("launch_id does not belong to session_id")
    if (launch && evidence.session_id && launch.session_id !== evidence.session_id) blockers.push("linked evidence does not belong to the launch session")
    sessionId = sessionId || launch?.session_id || ""
    if (launch && !LAUNCHED_STATUSES.has(launch.status)) blockers.push(`OpenCode human controls require launch_started or launched status; current status is ${launch.status}`)
    if (!isSupportedKind(input.control_kind) && input.control_kind !== undefined) blockers.push(`unsupported human control kind: ${String(input.control_kind)}`)

    const humanNote = bound(input.human_note)
    const correction = bound(input.correction)
    const overrideText = bound(input.override)
    const reason = bound(input.reason)
    const rawLogBlocked = inputLooksLikeRawLog(input)
    if (rawLogBlocked) blockers.push("raw logs, file contents, provider output, raw OpenCode output, full event logs, and full research.db dumps are out of scope for human control records")
    for (const requirement of requiredTextBlockers(controlKind, { humanNote, correction, overrideText, reason })) blockers.push(requirement)

    const safeHumanNote = rawLogBlocked ? "raw human note omitted" : humanNote
    const safeCorrection = rawLogBlocked ? undefined : correction
    const safeOverride = rawLogBlocked ? undefined : overrideText
    const safeReason = rawLogBlocked ? undefined : reason
    const controlHash = hash(stableJson({
      session_id: sessionId,
      launch_id: launch?.launch_id ?? launchIdInput ?? evidence.launch_id,
      control_kind: controlKind,
      urgency,
      human_note: normalize(safeHumanNote ?? ""),
      correction: normalize(safeCorrection ?? ""),
      override: normalize(safeOverride ?? ""),
      reason: normalize(safeReason ?? ""),
      progress_id: evidence.progress_id,
      watchdog_id: evidence.watchdog_id,
      forced_report_request_id: evidence.forced_report_request_id,
      question_id: evidence.question_id,
      guidance_id: evidence.guidance_id,
      delivery_id: evidence.delivery_id,
    }))
    const canRecord = blockers.length === 0
    return redactValue({
      preview_id: `opencode_human_control_preview_${controlHash.slice(0, 16)}`,
      status: canRecord ? "ready" : "blocked",
      can_record: canRecord,
      session_id: sessionId,
      launch_id: launch?.launch_id ?? launchIdInput ?? evidence.launch_id,
      control_kind: controlKind,
      projected_state_after: projectedState,
      urgency,
      human_note_preview: safeHumanNote,
      correction_preview: safeCorrection,
      override_preview: safeOverride,
      reason_preview: safeReason,
      linked_progress_id: evidence.progress_id,
      linked_watchdog_id: evidence.watchdog_id,
      linked_forced_report_request_id: evidence.forced_report_request_id,
      linked_question_id: evidence.question_id,
      linked_guidance_id: evidence.guidance_id,
      linked_delivery_id: evidence.delivery_id,
      process_control_performed: false,
      open_code_prompt_sent: false,
      mission_mutated: false,
      blockers: boundArray(unique(blockers)),
      warnings: boundArray(unique([...warnings])),
      recommended_commands: recommendedCommands(sessionId || "<session_id>"),
      generated_at: generatedAt,
      redacted_summary_preview: canRecord ? `OpenCode human control ${controlKind} for ${sessionId}` : blockers[0] ?? "OpenCode human control blocked",
      control_hash: controlHash,
    })
  }

  private async resolveEvidence(input: OpenCodeHumanControlPreviewInput): Promise<{
    session_id?: string
    launch_id?: string
    progress_id?: string
    watchdog_id?: string
    forced_report_request_id?: string
    question_id?: string
    guidance_id?: string
    delivery_id?: string
    blockers: string[]
  }> {
    const blockers: string[] = []
    const resolved: { session_id?: string; launch_id?: string; progress_id?: string; watchdog_id?: string; forced_report_request_id?: string; question_id?: string; guidance_id?: string; delivery_id?: string } = {}
    const progressId = optional(input.progress_id)
    if (progressId) {
      const progress = await this.options.progressService.get(progressId)
      if (!progress) blockers.push("progress_id does not resolve to OpenCode progress metadata")
      else Object.assign(resolved, { progress_id: progressId, session_id: progress.session_id, launch_id: progress.launch_id })
    }
    const watchdogId = optional(input.watchdog_id)
    if (watchdogId) {
      const watchdog = await this.options.watchdogService.get(watchdogId)
      if (!watchdog) blockers.push("watchdog_id does not resolve to OpenCode watchdog metadata")
      else Object.assign(resolved, sameChain(resolved, watchdog.session_id, watchdog.launch_id, blockers, "watchdog_id"), { watchdog_id: watchdogId })
    }
    const forcedReportId = optional(input.forced_report_request_id)
    if (forcedReportId) {
      const forcedReport = await this.options.watchdogService.getForcedReport(forcedReportId)
      if (!forcedReport) blockers.push("forced_report_request_id does not resolve to OpenCode forced report metadata")
      else Object.assign(resolved, sameChain(resolved, forcedReport.session_id, forcedReport.launch_id, blockers, "forced_report_request_id"), { forced_report_request_id: forcedReportId })
    }
    const questionId = optional(input.question_id)
    if (questionId) {
      const question = await this.options.questionService.get(questionId)
      if (!question) blockers.push("question_id does not resolve to OpenCodeCommanderQuestion metadata")
      else Object.assign(resolved, sameChain(resolved, question.session_id, question.launch_id, blockers, "question_id"), { question_id: questionId })
    }
    const guidanceId = optional(input.guidance_id)
    if (guidanceId) {
      const guidance = await this.options.guidanceService.get(guidanceId)
      if (!guidance) blockers.push("guidance_id does not resolve to CommanderGuidance metadata")
      else Object.assign(resolved, sameChain(resolved, guidance.session_id, guidance.launch_id, blockers, "guidance_id"), { guidance_id: guidanceId })
    }
    const deliveryId = optional(input.delivery_id)
    if (deliveryId) {
      const delivery = await this.options.guidanceDeliveryService.get(deliveryId)
      if (!delivery) blockers.push("delivery_id does not resolve to CommanderGuidanceDelivery metadata")
      else Object.assign(resolved, sameChain(resolved, delivery.session_id, delivery.launch_id, blockers, "delivery_id"), { delivery_id: deliveryId })
    }
    if (input.session_id && resolved.session_id && input.session_id !== resolved.session_id) blockers.push("linked evidence does not belong to session_id")
    if (input.launch_id && resolved.launch_id && input.launch_id !== resolved.launch_id) blockers.push("linked evidence does not belong to launch_id")
    return { ...resolved, blockers }
  }

  private async resolveLatestLaunch(sessionId: string): Promise<OpenCodeLaunchResult | OpenCodeLaunchRecord | null> {
    const launches = await this.options.launchGateService.list({ session_id: sessionId, limit: MAX_LIST })
    const latest = launches.find((launch) => LAUNCHED_STATUSES.has(launch.status)) ?? launches[0]
    return latest ? (await this.options.launchGateService.get(latest.launch_id)) ?? latest : null
  }

  private async findDuplicate(preview: OpenCodeHumanControlPreview): Promise<OpenCodeHumanControlRecord | null> {
    if (preview.control_kind === "note" || preview.control_kind === "priority_change" || preview.control_kind === "resume_request") return null
    return (await this.sequencedRecords())
      .map((item) => item.record)
      .find((record) =>
        record.session_id === preview.session_id &&
        record.control_kind === preview.control_kind &&
        record.control_hash === preview.control_hash
      ) ?? null
  }

  private async sequencedRecords(): Promise<SequencedHumanControlRecord[]> {
    return (await this.options.eventStore.readAll())
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => isHumanControlEvent(event))
      .map(({ event, index }) => ({ record: recordFromEvent(event)!, event_index: index }))
      .filter((item) => Boolean(item.record))
  }

  private async serializeRecord<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.recordQueue
    let release!: () => void
    this.recordQueue = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

export function readOpenCodeHumanControlPreviewInput(value: unknown): OpenCodeHumanControlPreviewInput {
  const input = isRecord(value) ? value : {}
  return {
    session_id: optional(input.sessionId ?? input.session_id ?? input.session),
    launch_id: optional(input.launchId ?? input.launch_id ?? input.launch),
    control_kind: optional(input.controlKind ?? input.control_kind ?? input.kind),
    urgency: optional(input.urgency),
    human_note: optionalRawText(input.humanNote ?? input.human_note ?? input.note),
    correction: optionalRawText(input.correction),
    override: optionalRawText(input.override),
    reason: optionalRawText(input.reason),
    progress_id: optional(input.progressId ?? input.progress_id ?? input.progress),
    watchdog_id: optional(input.watchdogId ?? input.watchdog_id ?? input.watchdog),
    forced_report_request_id: optional(input.forcedReportRequestId ?? input.forced_report_request_id ?? input.forcedReport ?? input.forced_report),
    question_id: optional(input.questionId ?? input.question_id ?? input.question),
    guidance_id: optional(input.guidanceId ?? input.guidance_id ?? input.guidance),
    delivery_id: optional(input.deliveryId ?? input.delivery_id ?? input.delivery),
  }
}

export function readOpenCodeHumanControlRecordInput(value: unknown): OpenCodeHumanControlRecordInput {
  const input = isRecord(value) ? value : {}
  return {
    ...readOpenCodeHumanControlPreviewInput(value),
    dry_run: optionalBoolean(input.dryRun ?? input.dry_run),
    recorded_by: optional(input.recordedBy ?? input.recorded_by),
  }
}

function sameChain(
  resolved: { session_id?: string; launch_id?: string },
  sessionId: string,
  launchId: string | undefined,
  blockers: string[],
  label: string,
): { session_id?: string; launch_id?: string } {
  if (resolved.session_id && resolved.session_id !== sessionId) blockers.push(`${label} belongs to a different session`)
  if (resolved.launch_id && launchId && resolved.launch_id !== launchId) blockers.push(`${label} belongs to a different launch`)
  return { session_id: resolved.session_id ?? sessionId, launch_id: resolved.launch_id ?? launchId }
}

function resultFromPreview(preview: OpenCodeHumanControlPreview, overrides: { control_id: string; status: OpenCodeHumanControlResult["status"]; recorded_at: string; recorded_by: string; error?: string }): OpenCodeHumanControlResult {
  return redactValue({
    control_id: overrides.control_id,
    status: overrides.status,
    session_id: preview.session_id,
    launch_id: preview.launch_id,
    control_kind: preview.control_kind,
    projected_state_after: preview.projected_state_after,
    urgency: preview.urgency,
    human_note_preview: preview.human_note_preview,
    correction_preview: preview.correction_preview,
    override_preview: preview.override_preview,
    reason_preview: preview.reason_preview,
    linked_progress_id: preview.linked_progress_id,
    linked_watchdog_id: preview.linked_watchdog_id,
    linked_forced_report_request_id: preview.linked_forced_report_request_id,
    linked_question_id: preview.linked_question_id,
    linked_guidance_id: preview.linked_guidance_id,
    linked_delivery_id: preview.linked_delivery_id,
    process_control_performed: false as const,
    open_code_prompt_sent: false as const,
    mission_mutated: false as const,
    recorded_at: overrides.recorded_at,
    recorded_by: bound(overrides.recorded_by) ?? "operator",
    error: bound(overrides.error),
    control_hash: preview.control_hash,
    recommended_commands: preview.recommended_commands,
  })
}

function eventPayload(result: OpenCodeHumanControlResult): Record<string, unknown> {
  return redactValue({
    kind: HUMAN_CONTROL_EVENT_KIND,
    control_id: result.control_id,
    session_id: result.session_id,
    launch_id: result.launch_id,
    control_kind: result.control_kind,
    projected_state_after: result.projected_state_after,
    urgency: result.urgency,
    human_note_preview: result.human_note_preview,
    correction_preview: result.correction_preview,
    override_preview: result.override_preview,
    reason_preview: result.reason_preview,
    linked_progress_id: result.linked_progress_id,
    linked_watchdog_id: result.linked_watchdog_id,
    linked_forced_report_request_id: result.linked_forced_report_request_id,
    linked_question_id: result.linked_question_id,
    linked_guidance_id: result.linked_guidance_id,
    linked_delivery_id: result.linked_delivery_id,
    process_control_performed: false,
    open_code_prompt_sent: false,
    mission_mutated: false,
    recorded_at: result.recorded_at,
    recorded_by: result.recorded_by,
    control_hash: result.control_hash,
  })
}

function resultFromEvent(event: JsonlEvent): OpenCodeHumanControlResult {
  return redactValue({
    control_id: String(event.control_id ?? ""),
    status: "recorded",
    session_id: String(event.session_id ?? ""),
    launch_id: optional(event.launch_id),
    control_kind: readControlKind(event.control_kind),
    projected_state_after: readProjectionState(event.projected_state_after),
    urgency: readUrgency(event.urgency),
    human_note_preview: bound(event.human_note_preview),
    correction_preview: bound(event.correction_preview),
    override_preview: bound(event.override_preview),
    reason_preview: bound(event.reason_preview),
    linked_progress_id: optional(event.linked_progress_id),
    linked_watchdog_id: optional(event.linked_watchdog_id),
    linked_forced_report_request_id: optional(event.linked_forced_report_request_id),
    linked_question_id: optional(event.linked_question_id),
    linked_guidance_id: optional(event.linked_guidance_id),
    linked_delivery_id: optional(event.linked_delivery_id),
    process_control_performed: false as const,
    open_code_prompt_sent: false as const,
    mission_mutated: false as const,
    recorded_at: typeof event.recorded_at === "string" ? event.recorded_at : "",
    recorded_by: bound(event.recorded_by) ?? "unknown",
    control_hash: typeof event.control_hash === "string" ? event.control_hash : hash(stableJson(event)),
    recommended_commands: recommendedCommands(String(event.session_id ?? "<session_id>")),
  })
}

function recordFromEvent(event: JsonlEvent): OpenCodeHumanControlRecord | null {
  if (typeof event.control_id !== "string" || typeof event.session_id !== "string") return null
  return redactValue({
    control_id: event.control_id,
    session_id: event.session_id,
    launch_id: optional(event.launch_id),
    control_kind: readControlKind(event.control_kind),
    projected_state_after: readProjectionState(event.projected_state_after),
    urgency: readUrgency(event.urgency),
    human_note_preview: bound(event.human_note_preview ?? event.reason_preview ?? event.correction_preview ?? event.override_preview),
    recorded_at: typeof event.recorded_at === "string" ? event.recorded_at : "",
    recorded_by: bound(event.recorded_by) ?? "unknown",
    linked_progress_id: optional(event.linked_progress_id),
    linked_watchdog_id: optional(event.linked_watchdog_id),
    linked_forced_report_request_id: optional(event.linked_forced_report_request_id),
    linked_question_id: optional(event.linked_question_id),
    linked_guidance_id: optional(event.linked_guidance_id),
    linked_delivery_id: optional(event.linked_delivery_id),
    process_control_performed: false as const,
    open_code_prompt_sent: false as const,
    mission_mutated: false as const,
    control_hash: typeof event.control_hash === "string" ? event.control_hash : hash(stableJson(event)),
  })
}

function isHumanControlEvent(event: JsonlEvent): boolean {
  return event.kind === HUMAN_CONTROL_EVENT_KIND
}

function readControlKind(value: unknown): OpenCodeHumanControlKind {
  return value === "pause_request" || value === "resume_request" || value === "stop_request" ||
    value === "correction" || value === "override" || value === "force_report" ||
    value === "priority_change" || value === "note" || value === "escalation"
    ? value
    : "unknown"
}

function isSupportedKind(value: unknown): boolean {
  return value === undefined || readControlKind(value) !== "unknown"
}

function readUrgency(value: unknown): OpenCodeHumanControlUrgency {
  return value === "low" || value === "high" || value === "urgent" ? value : "normal"
}

function readProjectionState(value: unknown): OpenCodeHumanControlProjectionState {
  return value === "pause_requested" || value === "resume_requested" || value === "stop_requested" ||
    value === "correction_pending" || value === "override_pending" || value === "report_requested" ||
    value === "escalated" || value === "noted" ? value : "none"
}

function projectedStateForKind(kind: OpenCodeHumanControlKind): OpenCodeHumanControlProjectionState {
  switch (kind) {
    case "pause_request": return "pause_requested"
    case "resume_request": return "resume_requested"
    case "stop_request": return "stop_requested"
    case "correction": return "correction_pending"
    case "override": return "override_pending"
    case "force_report": return "report_requested"
    case "escalation": return "escalated"
    case "priority_change":
    case "note":
      return "noted"
    default:
      return "none"
  }
}

function requiredTextBlockers(kind: OpenCodeHumanControlKind, input: { humanNote?: string; correction?: string; overrideText?: string; reason?: string }): string[] {
  switch (kind) {
    case "pause_request":
    case "resume_request":
    case "force_report":
    case "priority_change":
    case "escalation":
      return input.reason || input.humanNote ? [] : [`${kind} requires reason or human_note`]
    case "stop_request":
      return input.reason ? [] : ["stop_request requires reason"]
    case "correction":
      return input.correction ? [] : ["correction requires correction text"]
    case "override":
      return input.overrideText ? [] : ["override requires override text"]
    case "note":
      return input.humanNote ? [] : ["note requires human_note"]
    default:
      return ["valid control_kind is required"]
  }
}

function inputLooksLikeRawLog(input: OpenCodeHumanControlPreviewInput): boolean {
  return [input.human_note, input.correction, input.override, input.reason]
    .filter((item): item is string => typeof item === "string")
    .some(looksLikeRawLog)
}

function looksLikeRawLog(value: string): boolean {
  if (value.trim().length > MAX_RAW_TEXT) return true
  return RAW_LOG_PATTERNS.some((pattern) => pattern.test(value))
}

function hasLinkedEvidence(input: OpenCodeHumanControlPreviewInput): boolean {
  return Boolean(input.progress_id || input.watchdog_id || input.forced_report_request_id || input.question_id || input.guidance_id || input.delivery_id)
}

function recommendedCommands(sessionId: string): OpenCodeHumanControlCommand[] {
  return [
    { label: "Preview human control", command: `/opencode-human-control-preview session=${sessionId} kind=pause_request reason=<reason>`, command_type: "read" },
    { label: "Record human note", command: `/opencode-human-note session=${sessionId} note=<note>`, command_type: "write", requires_active_runtime: true, notes: "metadata only; no OpenCode prompt or process control occurs" },
    { label: "List human controls", command: `/opencode-human-controls session=${sessionId}`, command_type: "read" },
  ]
}

function optionalRawText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? bound(value) : undefined
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

function boundArray(values: unknown, maxItems = 16): string[] {
  if (!Array.isArray(values)) return []
  return values.map((item) => bound(item)).filter((item): item is string => Boolean(item)).slice(0, maxItems)
}

function normalize(value: string): string {
  return redactText(value).toLowerCase().replace(/\s+/g, " ").trim()
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function compareSequencedDesc(left: SequencedHumanControlRecord, right: SequencedHumanControlRecord): number {
  const time = right.record.recorded_at.localeCompare(left.record.recorded_at)
  if (time !== 0) return time
  return right.event_index - left.event_index
}
