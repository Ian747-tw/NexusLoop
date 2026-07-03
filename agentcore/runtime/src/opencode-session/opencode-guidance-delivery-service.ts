import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { OpenCodeLaunchGateService } from "./opencode-launch-gate-service"
import type { OpenCodeCommanderQuestionService } from "./opencode-commander-question-service"
import type { CommanderGuidanceService } from "./opencode-commander-guidance-service"
import type { OpenCodeSessionService } from "./opencode-session-service"
import type {
  CommanderGuidanceDeliveryAdapterCapability,
  CommanderGuidanceDeliveryCommand,
  CommanderGuidanceDeliveryInput,
  CommanderGuidanceDeliveryMode,
  CommanderGuidanceDeliveryPreview,
  CommanderGuidanceDeliveryPreviewInput,
  CommanderGuidanceDeliveryProjectionStatus,
  CommanderGuidanceDeliveryRecord,
  CommanderGuidanceDeliveryResult,
  CommanderGuidanceDeliveryStatus,
  CommanderGuidanceDeliverySummary,
} from "./opencode-guidance-delivery-types"

const MAX_LIST = 100
const MAX_TEXT = 480
const MAX_RAW_TEXT = MAX_TEXT * 2
const MAX_ARRAY = 16
const LAUNCHED_STATUSES = new Set(["launch_started", "launched"])
const DELIVERY_EVENT_KINDS = new Set([
  "opencode_commander_guidance_delivery_requested",
  "opencode_commander_guidance_delivered",
  "opencode_commander_guidance_delivery_failed",
])
const RAW_LOG_PATTERNS = [
  /\n.{80,}\n.{80,}\n/s,
  /(^|\s)(stdout|stderr|traceback|stack trace|bun test v|npm error|error:)(\s|$|:)/i,
  /(stdout|stderr|traceback|stack trace|bun test v|npm error|error:).{0,80}\n/i,
  /(\[[0-9]{2}:[0-9]{2}:[0-9]{2}\].*\n){3,}/i,
]

export type CommanderGuidanceDeliveryServiceOptions = {
  eventStore: EventStore
  opencodeSessionService: OpenCodeSessionService
  launchGateService: OpenCodeLaunchGateService
  questionService: OpenCodeCommanderQuestionService
  guidanceService: CommanderGuidanceService
  now?: () => Date
  idFactory?: () => string
}

type SequencedDeliveryRecord = {
  record: CommanderGuidanceDeliveryRecord
  event_index: number
}

export class CommanderGuidanceDeliveryService {
  private readonly now: () => Date
  private readonly idFactory: () => string
  private createQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: CommanderGuidanceDeliveryServiceOptions) {
    this.now = options.now ?? (() => new Date())
    this.idFactory = options.idFactory ?? (() => `commander_guidance_delivery_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`)
  }

  async preview(input: CommanderGuidanceDeliveryPreviewInput = {}): Promise<CommanderGuidanceDeliveryPreview> {
    return this.buildPreview(input)
  }

  async deliver(input: CommanderGuidanceDeliveryInput = {}): Promise<CommanderGuidanceDeliveryResult> {
    const preview = await this.buildPreview(input)
    const deliveryId = this.idFactory()
    const createdAt = this.now().toISOString()
    const deliveredBy = bound(input.delivered_by ?? "operator") ?? "operator"
    if (!preview.can_deliver) {
      return resultFromPreview(preview, {
        delivery_id: deliveryId,
        status: "blocked",
        delivery_status_after: preview.current_delivery_status ?? "not_delivered",
        created_at: createdAt,
        delivered_by: deliveredBy,
        error: preview.blockers[0] ?? "Commander guidance delivery is blocked",
      })
    }
    if (input.dry_run === true) {
      return resultFromPreview(preview, {
        delivery_id: deliveryId,
        status: "dry_run",
        delivery_status_after: preview.current_delivery_status ?? "not_delivered",
        created_at: createdAt,
        delivered_by: deliveredBy,
      })
    }
    return this.serializeCreate(async () => {
      const rebuilt = await this.buildPreview(input)
      if (!rebuilt.can_deliver) {
        return resultFromPreview(rebuilt, {
          delivery_id: deliveryId,
          status: "blocked",
          delivery_status_after: rebuilt.current_delivery_status ?? "not_delivered",
          created_at: createdAt,
          delivered_by: deliveredBy,
          error: rebuilt.blockers[0] ?? "Commander guidance delivery is blocked",
        })
      }
      const status: CommanderGuidanceDeliveryStatus = rebuilt.delivery_mode === "operator_handoff" ? "delivery_requested" : "delivery_failed"
      const deliveryStatusAfter: CommanderGuidanceDeliveryProjectionStatus = rebuilt.delivery_mode === "operator_handoff" ? "pending_delivery" : "delivery_failed"
      const result = resultFromPreview(rebuilt, {
        delivery_id: deliveryId,
        status,
        delivery_status_after: deliveryStatusAfter,
        created_at: createdAt,
        delivered_by: deliveredBy,
      })
      await this.options.eventStore.append(deliveryEventPayload(result) as JsonlEvent)
      return redactValue(result)
    })
  }

  async list(input: { limit?: number; session_id?: string; launch_id?: string; guidance_id?: string; status?: string; delivery_mode?: string } = {}): Promise<CommanderGuidanceDeliveryRecord[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, MAX_LIST))
    return (await this.sequencedRecords())
      .filter((item) => !input.session_id || item.record.session_id === input.session_id)
      .filter((item) => !input.launch_id || item.record.launch_id === input.launch_id)
      .filter((item) => !input.guidance_id || item.record.guidance_id === input.guidance_id)
      .filter((item) => !input.status || item.record.status === input.status)
      .filter((item) => !input.delivery_mode || item.record.delivery_mode === input.delivery_mode)
      .sort(compareSequencedDesc)
      .map((item) => item.record)
      .slice(0, limit)
  }

  async get(deliveryId: string): Promise<CommanderGuidanceDeliveryResult | null> {
    const event = (await this.options.eventStore.readAll())
      .filter(isDeliveryEvent)
      .reverse()
      .find((item) => item.delivery_id === deliveryId)
    return event ? resultFromEvent(event) : null
  }

  async latest(input: { session_id?: string; launch_id?: string; guidance_id?: string } = {}): Promise<CommanderGuidanceDeliveryResult | null> {
    const latest = (await this.list({ ...input, limit: 1 }))[0]
    return latest ? this.get(latest.delivery_id) : null
  }

  async summary(input: { limit?: number } = {}): Promise<CommanderGuidanceDeliverySummary> {
    const records = (await this.sequencedRecords()).sort(compareSequencedDesc).map((item) => item.record)
    const limit = Math.max(1, Math.min(input.limit ?? 10, MAX_LIST))
    const byMode: Record<string, number> = {}
    for (const record of records) byMode[record.delivery_mode] = (byMode[record.delivery_mode] ?? 0) + 1
    return redactValue({
      total_deliveries: records.length,
      requested_count: records.filter((record) => record.status === "delivery_requested").length,
      delivered_count: records.filter((record) => record.status === "delivered").length,
      failed_count: records.filter((record) => record.status === "delivery_failed").length,
      by_mode_counts: byMode,
      latest_deliveries: records.slice(0, limit),
      generated_at: this.now().toISOString(),
    })
  }

  private async buildPreview(input: CommanderGuidanceDeliveryPreviewInput = {}): Promise<CommanderGuidanceDeliveryPreview> {
    const generatedAt = this.now().toISOString()
    const blockers: string[] = []
    const warnings = new Set<string>([
      "delivery is separate from Commander guidance creation",
      "operator_handoff records metadata only and does not send an OpenCode prompt",
      "adapter_send is blocked in 9I until a safe running-session send path exists",
      "no provider, MCP, wake execution, research.db write, process control, or mission mutation occurs",
    ])
    const guidanceId = optional(input.guidance_id) ?? ""
    if (!guidanceId) blockers.push("guidance_id is required")
    const guidance = guidanceId ? await this.options.guidanceService.get(guidanceId) : null
    if (guidanceId && !guidance) blockers.push("guidance_id does not resolve to CommanderGuidance")
    const currentDeliveryStatus = guidance?.delivery_status ?? "not_delivered"
    if (guidance && guidance.guidance_status !== "created") blockers.push(`guidance status must be created; current status is ${guidance.guidance_status}`)
    if (guidance && currentDeliveryStatus !== "not_delivered") blockers.push(`guidance delivery_status must be not_delivered; current status is ${currentDeliveryStatus}`)
    const question = guidance?.question_id ? await this.options.questionService.get(guidance.question_id) : null
    if (guidance?.question_id && !question) blockers.push("linked question does not resolve")
    if (question && question.question_status !== "answered") blockers.push("linked question must be answered before guidance delivery")
    if (guidance?.session_id && !await this.options.opencodeSessionService.get(guidance.session_id)) blockers.push("linked session does not resolve to a planned OpenCode session")
    const launch = guidance?.launch_id ? await this.options.launchGateService.get(guidance.launch_id) : null
    if (guidance?.launch_id && !launch) blockers.push("linked launch does not resolve to an OpenCode launch record")
    if (launch && !LAUNCHED_STATUSES.has(launch.status)) blockers.push(`Commander guidance delivery requires launch_started or launched status; current status is ${launch.status}`)
    if (launch && guidance?.session_id && launch.session_id !== guidance.session_id) blockers.push("linked launch does not belong to guidance session")
    const rawMode = optional(input.delivery_mode)
    const mode = readDeliveryMode(input.delivery_mode)
    const adapterCapability: CommanderGuidanceDeliveryAdapterCapability = mode === "operator_handoff" ? "operator_handoff_only" : mode === "disabled" ? "disabled" : "disabled"
    if (rawMode && !isSupportedDeliveryMode(rawMode)) blockers.push(`unsupported delivery mode: ${rawMode}`)
    if (mode === "adapter_send") blockers.push("adapter_send delivery is blocked in 9I because no safe running-session OpenCode send path is available")
    if (mode === "fake") blockers.push("fake delivery mode is available only in the TUI fake runtime")
    if (mode === "disabled") blockers.push("delivery mode disabled")
    const rawLogBlocked = guidanceDeliveryInputLooksLikeRawLog(input, guidance)
    if (rawLogBlocked) blockers.push("raw logs, file contents, provider output, raw OpenCode output, and full event/research dumps are out of scope for guidance delivery")
    const refs = boundArray([...(guidance?.spec_refs_preview ?? []), ...(guidance?.research_refs_preview ?? []), ...(guidance?.artifact_refs_preview ?? [])], MAX_ARRAY)
    const answer = guidance?.answer_preview ?? ""
    const constraints = boundArray(guidance?.constraints_preview ?? [], MAX_ARRAY)
    const rationale = bound(guidance?.rationale_preview)
    const operatorNote = bound(input.operator_note)
    const payloadPreview = rawLogBlocked
      ? "raw delivery payload omitted"
      : bound([
          `guidance=${guidanceId}`,
          `question=${guidance?.question_id ?? ""}`,
          `answer=${answer}`,
          constraints.length ? `constraints=${constraints.join("; ")}` : "",
          rationale ? `rationale=${rationale}` : "",
          refs.length ? `refs=${refs.join("; ")}` : "",
          operatorNote ? `operator_note=${operatorNote}` : "",
        ].filter(Boolean).join(" | "), MAX_TEXT) ?? ""
    const targetSummary = bound(`session=${guidance?.session_id ?? ""} launch=${guidance?.launch_id ?? ""} mode=${mode}`) ?? ""
    const deliveryHash = hash(stableJson({
      guidance_id: guidanceId,
      question_id: guidance?.question_id ?? "",
      session_id: guidance?.session_id ?? "",
      launch_id: guidance?.launch_id ?? "",
      delivery_mode: mode,
      payload: normalize(payloadPreview),
    }))
    const canDeliver = blockers.length === 0
    return redactValue({
      preview_id: `commander_guidance_delivery_preview_${deliveryHash.slice(0, 16)}`,
      status: canDeliver ? "ready" : "blocked",
      can_deliver: canDeliver,
      guidance_id: guidanceId,
      question_id: guidance?.question_id ?? "",
      session_id: guidance?.session_id ?? "",
      launch_id: guidance?.launch_id,
      guidance_status: guidance?.guidance_status,
      current_delivery_status: currentDeliveryStatus,
      delivery_mode: mode,
      delivery_payload_preview: payloadPreview,
      answer_preview: rawLogBlocked ? "raw answer omitted" : answer,
      constraints_preview: rawLogBlocked ? [] : constraints,
      rationale_preview: rawLogBlocked ? undefined : rationale,
      refs_preview: rawLogBlocked ? [] : refs,
      target_summary_preview: targetSummary,
      adapter_capability: adapterCapability,
      blockers: boundArray(unique(blockers)),
      warnings: boundArray(unique([...warnings])),
      recommended_commands: recommendedCommands(guidanceId || "<guidance_id>"),
      generated_at: generatedAt,
      redacted_summary_preview: canDeliver ? `Commander guidance delivery ${mode} for ${guidanceId}` : blockers[0] ?? "Commander guidance delivery blocked",
      delivery_hash: deliveryHash,
    })
  }

  private async sequencedRecords(): Promise<SequencedDeliveryRecord[]> {
    return (await this.options.eventStore.readAll())
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => isDeliveryEvent(event))
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

export function readCommanderGuidanceDeliveryPreviewInput(value: unknown): CommanderGuidanceDeliveryPreviewInput {
  const input = isRecord(value) ? value : {}
  return {
    guidance_id: optional(input.guidanceId ?? input.guidance_id ?? input.guidance),
    delivery_mode: optional(input.deliveryMode ?? input.delivery_mode ?? input.mode),
    allow_real_delivery: optionalBoolean(input.allowRealDelivery ?? input.allow_real_delivery),
    operator_note: optionalRawText(input.operatorNote ?? input.operator_note),
  }
}

export function readCommanderGuidanceDeliveryInput(value: unknown): CommanderGuidanceDeliveryInput {
  const input = isRecord(value) ? value : {}
  return {
    ...readCommanderGuidanceDeliveryPreviewInput(value),
    dry_run: optionalBoolean(input.dryRun ?? input.dry_run),
    delivered_by: optional(input.deliveredBy ?? input.delivered_by),
  }
}

export function latestGuidanceDeliveryStatusFromEvents(events: JsonlEvent[], guidanceId: string): CommanderGuidanceDeliveryProjectionStatus {
  let status: CommanderGuidanceDeliveryProjectionStatus = "not_delivered"
  for (const event of events) {
    if (!isDeliveryEvent(event) || event.guidance_id !== guidanceId) continue
    status = readProjectionStatus(event.delivery_status_after)
  }
  return status
}

export function isGuidanceDeliveryEvent(event: JsonlEvent): boolean {
  return isDeliveryEvent(event)
}

function resultFromPreview(preview: CommanderGuidanceDeliveryPreview, overrides: { delivery_id: string; status: CommanderGuidanceDeliveryStatus; delivery_status_after: CommanderGuidanceDeliveryProjectionStatus; created_at: string; delivered_by: string; error?: string }): CommanderGuidanceDeliveryResult {
  return redactValue({
    delivery_id: overrides.delivery_id,
    status: overrides.status,
    guidance_id: preview.guidance_id,
    question_id: preview.question_id,
    session_id: preview.session_id,
    launch_id: preview.launch_id,
    delivery_mode: preview.delivery_mode,
    delivery_status_after: overrides.delivery_status_after,
    adapter_capability: preview.adapter_capability,
    delivery_payload_preview: preview.delivery_payload_preview,
    target_summary_preview: preview.target_summary_preview,
    adapter_ack_preview: overrides.status === "delivered" ? "bounded adapter acknowledgement" : undefined,
    operator_handoff_preview: preview.delivery_mode === "operator_handoff" ? "operator handoff requested; no OpenCode prompt was sent" : undefined,
    created_at: overrides.created_at,
    delivered_by: bound(overrides.delivered_by) ?? "operator",
    error: bound(overrides.error),
    delivery_hash: preview.delivery_hash,
    recommended_commands: preview.recommended_commands,
  })
}

function deliveryEventPayload(result: CommanderGuidanceDeliveryResult): Record<string, unknown> {
  const kind = result.status === "delivered"
    ? "opencode_commander_guidance_delivered"
    : result.status === "delivery_failed"
      ? "opencode_commander_guidance_delivery_failed"
      : "opencode_commander_guidance_delivery_requested"
  return redactValue({
    kind,
    delivery_id: result.delivery_id,
    guidance_id: result.guidance_id,
    question_id: result.question_id,
    session_id: result.session_id,
    launch_id: result.launch_id,
    delivery_mode: result.delivery_mode,
    delivery_status_after: result.delivery_status_after,
    delivery_payload_preview: result.delivery_payload_preview,
    target_summary_preview: result.target_summary_preview,
    adapter_capability: result.adapter_capability,
    adapter_ack_preview: result.adapter_ack_preview,
    operator_handoff_preview: result.operator_handoff_preview,
    created_at: result.created_at,
    delivered_by: result.delivered_by,
    error: result.error,
    delivery_hash: result.delivery_hash,
  })
}

function resultFromEvent(event: JsonlEvent): CommanderGuidanceDeliveryResult {
  return redactValue({
    delivery_id: String(event.delivery_id ?? ""),
    status: readResultStatus(event),
    guidance_id: String(event.guidance_id ?? ""),
    question_id: String(event.question_id ?? ""),
    session_id: String(event.session_id ?? ""),
    launch_id: typeof event.launch_id === "string" ? event.launch_id : undefined,
    delivery_mode: readDeliveryMode(event.delivery_mode),
    delivery_status_after: readProjectionStatus(event.delivery_status_after),
    adapter_capability: readAdapterCapability(event.adapter_capability),
    delivery_payload_preview: bound(event.delivery_payload_preview) ?? "",
    target_summary_preview: bound(event.target_summary_preview) ?? "",
    adapter_ack_preview: bound(event.adapter_ack_preview),
    operator_handoff_preview: bound(event.operator_handoff_preview),
    created_at: typeof event.created_at === "string" ? event.created_at : "",
    delivered_by: bound(event.delivered_by) ?? "unknown",
    error: bound(event.error),
    delivery_hash: typeof event.delivery_hash === "string" ? event.delivery_hash : hash(stableJson(event)),
    recommended_commands: recommendedCommands(String(event.guidance_id ?? "<guidance_id>")),
  })
}

function recordFromEvent(event: JsonlEvent): CommanderGuidanceDeliveryRecord | null {
  if (typeof event.delivery_id !== "string" || typeof event.guidance_id !== "string" || typeof event.question_id !== "string" || typeof event.session_id !== "string") return null
  return redactValue({
    delivery_id: event.delivery_id,
    status: readResultStatus(event),
    guidance_id: event.guidance_id,
    question_id: event.question_id,
    session_id: event.session_id,
    launch_id: typeof event.launch_id === "string" ? event.launch_id : undefined,
    delivery_mode: readDeliveryMode(event.delivery_mode),
    delivery_status_after: readProjectionStatus(event.delivery_status_after),
    created_at: typeof event.created_at === "string" ? event.created_at : "",
    delivered_by: bound(event.delivered_by) ?? "unknown",
    summary_preview: bound(event.delivery_payload_preview) ?? "",
    delivery_hash: typeof event.delivery_hash === "string" ? event.delivery_hash : hash(stableJson(event)),
  })
}

function isDeliveryEvent(event: JsonlEvent): boolean {
  return DELIVERY_EVENT_KINDS.has(String(event.kind ?? ""))
}

function readResultStatus(event: JsonlEvent): CommanderGuidanceDeliveryStatus {
  if (event.kind === "opencode_commander_guidance_delivered") return "delivered"
  if (event.kind === "opencode_commander_guidance_delivery_failed") return "delivery_failed"
  return "delivery_requested"
}

function readProjectionStatus(value: unknown): CommanderGuidanceDeliveryProjectionStatus {
  return value === "pending_delivery" || value === "delivered" || value === "delivery_failed" ? value : "not_delivered"
}

function readDeliveryMode(value: unknown): CommanderGuidanceDeliveryMode {
  return value === "adapter_send" || value === "fake" || value === "disabled" ? value : "operator_handoff"
}

function isSupportedDeliveryMode(value: string): boolean {
  return value === "operator_handoff" || value === "adapter_send" || value === "fake" || value === "disabled"
}

function readAdapterCapability(value: unknown): CommanderGuidanceDeliveryAdapterCapability {
  return value === "can_send" || value === "disabled" || value === "unknown" ? value : "operator_handoff_only"
}

function recommendedCommands(guidanceId: string): CommanderGuidanceDeliveryCommand[] {
  return [
    { label: "Preview delivery", command: `/commander-guidance-delivery-preview guidance=${guidanceId}`, command_type: "read" },
    { label: "Request operator handoff", command: `/commander-guidance-deliver guidance=${guidanceId} mode=operator_handoff`, command_type: "write", requires_active_runtime: true, notes: "metadata only; no OpenCode prompt is sent in operator_handoff mode" },
    { label: "List deliveries", command: `/commander-guidance-deliveries guidance=${guidanceId}`, command_type: "read" },
  ]
}

function guidanceDeliveryInputLooksLikeRawLog(input: CommanderGuidanceDeliveryPreviewInput, guidance: { answer_preview?: string; rationale_preview?: string; constraints_preview?: string[]; spec_refs_preview?: string[]; research_refs_preview?: string[]; artifact_refs_preview?: string[] } | null): boolean {
  const values = [
    input.operator_note,
    guidance?.answer_preview,
    guidance?.rationale_preview,
    ...(guidance?.constraints_preview ?? []),
    ...(guidance?.spec_refs_preview ?? []),
    ...(guidance?.research_refs_preview ?? []),
    ...(guidance?.artifact_refs_preview ?? []),
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

function compareSequencedDesc(left: SequencedDeliveryRecord, right: SequencedDeliveryRecord): number {
  const time = right.record.created_at.localeCompare(left.record.created_at)
  if (time !== 0) return time
  return right.event_index - left.event_index
}
