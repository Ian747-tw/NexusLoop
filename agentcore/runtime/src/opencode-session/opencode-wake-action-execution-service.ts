import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { CommanderGuidanceDeliveryService } from "./opencode-guidance-delivery-service"
import type { OpenCodeCommanderQuestionService } from "./opencode-commander-question-service"
import type { OpenCodeHumanControlService } from "./opencode-human-control-service"
import type { OpenCodeProgressService } from "./opencode-progress-service"
import type { OpenCodeTimeoutWatchdogService } from "./opencode-timeout-watchdog-service"
import type { OpenCodeWakeSupervisorExecutionService } from "./opencode-wake-supervisor-execution-service"
import type {
  OpenCodeWakeSupervisorExecutionEvidenceRef,
  OpenCodeWakeSupervisorExecutionResult,
} from "./opencode-wake-supervisor-execution-types"
import type { OpenCodeWakeSupervisorRecommendedAction } from "./opencode-wake-supervisor-types"
import type {
  OpenCodeWakeActionEffectKind,
  OpenCodeWakeActionExecutionCommand,
  OpenCodeWakeActionExecutionEvidenceRef,
  OpenCodeWakeActionExecutionPreview,
  OpenCodeWakeActionExecutionPreviewInput,
  OpenCodeWakeActionExecutionRecord,
  OpenCodeWakeActionExecutionRecordInput,
  OpenCodeWakeActionExecutionResult,
  OpenCodeWakeActionExecutionSummary,
  OpenCodeWakeActionKind,
} from "./opencode-wake-action-execution-types"

const MAX_LIST = 100
const MAX_TEXT = 420
const ACTION_EVENT_KIND = "opencode_wake_action_execution_recorded"
const METADATA_ACTIONS = new Set<OpenCodeWakeActionKind>(["record_watchdog", "request_forced_report", "create_commander_question"])

export type OpenCodeWakeActionExecutionServiceOptions = {
  eventStore: EventStore
  wakeExecutionService: OpenCodeWakeSupervisorExecutionService
  watchdogService: OpenCodeTimeoutWatchdogService
  questionService: OpenCodeCommanderQuestionService
  guidanceDeliveryService: CommanderGuidanceDeliveryService
  progressService: OpenCodeProgressService
  humanControlService: OpenCodeHumanControlService
  now?: () => Date
  idFactory?: () => string
}

type SequencedActionRecord = {
  record: OpenCodeWakeActionExecutionRecord
  event_index: number
}

type ExecutionContext = {
  execution: OpenCodeWakeSupervisorExecutionResult | null
  actionKind: OpenCodeWakeActionKind
  effectKind: OpenCodeWakeActionEffectKind
  metadataEventKind?: string
  manualActionPreview?: string
  expectedEventKinds: string[]
  blockers: string[]
  warnings: string[]
}

export class OpenCodeWakeActionExecutionService {
  private readonly now: () => Date
  private readonly idFactory: () => string
  private actionQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: OpenCodeWakeActionExecutionServiceOptions) {
    this.now = options.now ?? (() => new Date())
    this.idFactory = options.idFactory ?? (() => `opencode_wake_action_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`)
  }

  async preview(input: OpenCodeWakeActionExecutionPreviewInput = {}): Promise<OpenCodeWakeActionExecutionPreview> {
    return this.buildPreview(input)
  }

  async record(input: OpenCodeWakeActionExecutionRecordInput = {}): Promise<OpenCodeWakeActionExecutionResult> {
    const preview = await this.buildPreview(input)
    const actionExecutionId = this.idFactory()
    const recordedAt = this.now().toISOString()
    const recordedBy = bound(input.recorded_by ?? "operator") ?? "operator"
    if (!preview.can_execute) {
      return resultFromPreview(preview, actionExecutionId, "blocked", recordedAt, recordedBy, preview.blockers[0] ?? "wake action execution is blocked")
    }
    if (input.dry_run === true) {
      return resultFromPreview(preview, actionExecutionId, "dry_run", recordedAt, recordedBy)
    }
    return this.serializeAction(async () => {
      const rebuilt = await this.buildPreview(input)
      if (!rebuilt.can_execute) {
        return resultFromPreview(rebuilt, actionExecutionId, "blocked", recordedAt, recordedBy, rebuilt.blockers[0] ?? "wake action execution is blocked")
      }
      const metadata = await this.executeMetadataAction(rebuilt, input, recordedBy)
      const status: OpenCodeWakeActionExecutionResult["status"] = metadata.status
      const result = resultFromPreview(rebuilt, actionExecutionId, status, recordedAt, recordedBy, metadata.error, metadata.metadata_record_id, metadata.metadata_result_preview)
      await this.options.eventStore.append(actionEventPayload(result, rebuilt.evidence_refs) as JsonlEvent)
      return redactValue(result)
    })
  }

  async list(input: { limit?: number; execution_id?: string; session_id?: string; launch_id?: string; action_kind?: string; status?: string; effect_kind?: string } = {}): Promise<OpenCodeWakeActionExecutionRecord[]> {
    const limit = positiveInteger(input.limit, 20, MAX_LIST)
    return (await this.sequencedRecords())
      .filter((item) => !input.execution_id || item.record.execution_id === input.execution_id)
      .filter((item) => !input.session_id || item.record.session_id === input.session_id)
      .filter((item) => !input.launch_id || item.record.launch_id === input.launch_id)
      .filter((item) => !input.action_kind || item.record.action_kind === input.action_kind)
      .filter((item) => !input.status || item.record.status === input.status)
      .filter((item) => !input.effect_kind || item.record.effect_kind === input.effect_kind)
      .sort(compareSequencedDesc)
      .map((item) => item.record)
      .slice(0, limit)
  }

  async get(actionExecutionId: string): Promise<OpenCodeWakeActionExecutionResult | null> {
    const event = (await this.options.eventStore.readAll()).filter(isActionEvent).reverse().find((item) => item.action_execution_id === actionExecutionId)
    return event ? resultFromEvent(event) : null
  }

  async latest(input: { execution_id?: string; session_id?: string; launch_id?: string } = {}): Promise<OpenCodeWakeActionExecutionResult | null> {
    const latest = (await this.list({ ...input, limit: 1 }))[0]
    return latest ? this.get(latest.action_execution_id) : null
  }

  async summary(input: { limit?: number } = {}): Promise<OpenCodeWakeActionExecutionSummary> {
    const records = (await this.sequencedRecords()).sort(compareSequencedDesc).map((item) => item.record)
    const byKind: Record<string, number> = {}
    for (const record of records) byKind[record.action_kind] = (byKind[record.action_kind] ?? 0) + 1
    const limit = positiveInteger(input.limit, 10, MAX_LIST)
    return redactValue({
      total_actions: records.length,
      executed_count: records.filter((record) => record.status === "executed").length,
      skipped_count: records.filter((record) => record.status === "skipped").length,
      blocked_count: records.filter((record) => record.status === "blocked").length,
      failed_count: records.filter((record) => record.status === "failed").length,
      metadata_event_count: records.filter((record) => record.effect_kind === "metadata_event_appended").length,
      manual_action_required_count: records.filter((record) => record.effect_kind === "manual_action_required").length,
      by_action_kind_counts: byKind,
      latest_actions: records.slice(0, limit),
      generated_at: this.now().toISOString(),
    })
  }

  private async buildPreview(input: OpenCodeWakeActionExecutionPreviewInput = {}): Promise<OpenCodeWakeActionExecutionPreview> {
    const generatedAt = this.now().toISOString()
    const context = await this.resolveExecution(input)
    const execution = context.execution
    const canExecute = context.blockers.length === 0
    const evidenceRefs = readEvidenceRefs(execution?.evidence_refs ?? [])
    const actionHash = hash(stableJson({
      execution_id: input.execution_id,
      source_execution_hash: execution?.execution_hash,
      supervisor_hash: execution?.supervisor_hash,
      action_kind: context.actionKind,
      effect_kind: context.effectKind,
      evidence_refs: evidenceRefs.map((ref) => [ref.evidence_kind, ref.evidence_id, ref.status]),
      allow_operator_handoff: input.allow_operator_handoff === true,
      blockers: context.blockers,
    }))
    return redactValue({
      preview_id: `opencode_wake_action_preview_${actionHash.slice(0, 16)}`,
      status: canExecute ? "ready" : "blocked",
      can_execute: canExecute,
      execution_id: optional(input.execution_id) ?? "",
      session_id: execution?.session_id,
      launch_id: execution?.launch_id,
      supervisor_status: execution?.supervisor_status,
      recommended_action: execution?.recommended_action,
      action_kind: context.actionKind,
      effect_kind: context.effectKind,
      action_execution_status_before: "not_executed" as const,
      will_execute_metadata_write: context.effectKind === "metadata_event_appended",
      will_call_provider: false as const,
      will_send_opencode_prompt: false as const,
      will_control_process: false as const,
      will_mutate_mission: false as const,
      expected_event_kinds: context.expectedEventKinds,
      blocked_reason_preview: context.blockers[0],
      manual_action_preview: context.manualActionPreview,
      source_supervisor_hash: execution?.supervisor_hash,
      evidence_refs: evidenceRefs,
      blockers: boundArray(unique(context.blockers)),
      warnings: boundArray(unique(context.warnings)),
      recommended_commands: recommendedCommands(context.actionKind, optional(input.execution_id) ?? "<execution_id>", execution?.session_id),
      generated_at: generatedAt,
      redacted_summary_preview: canExecute
        ? `Wake action gate can ${context.effectKind === "metadata_event_appended" ? "execute metadata action" : "record skipped action"} ${context.actionKind}`
        : context.blockers[0] ?? "wake action execution blocked",
      action_hash: actionHash,
    })
  }

  private async resolveExecution(input: OpenCodeWakeActionExecutionPreviewInput): Promise<ExecutionContext> {
    const executionId = optional(input.execution_id)
    const blockers: string[] = []
    const warnings: string[] = [
      "wake action execution is typed and allowlisted; it never executes arbitrary recommended command text",
      "no provider, MCP, OpenCode prompt, OpenCode launch, process control, research.db write, result/checkpoint, or mission/proposal/review/apply mutation occurs",
    ]
    if (!executionId) blockers.push("execution_id is required")
    const execution = executionId ? await this.options.wakeExecutionService.get(executionId) : null
    if (executionId && !execution) blockers.push("execution_id does not resolve to a wake supervisor execution record")
    if (execution && execution.action_execution_status !== "not_executed") blockers.push("wake supervisor execution action status must be not_executed")
    const actionKind = readActionKind(input.action_kind, actionKindFromRecommendedAction(execution?.recommended_action))
    const expectedEventKinds = expectedEventsForAction(actionKind, input.allow_operator_handoff === true)
    let effectKind = effectForAction(actionKind, input.allow_operator_handoff === true)
    let manualActionPreview = manualPreviewForAction(actionKind, execution, input.allow_operator_handoff === true)
    if (actionKind === "unsupported") blockers.push("wake recommended action is unsupported by the 9M metadata action gate")
    if (actionKind === "answer_commander_question") blockers.push("answer_commander_question requires explicit /commander-guidance and is blocked in 9M")
    if (actionKind === "deliver_guidance" && input.allow_operator_handoff !== true) blockers.push("deliver_guidance requires explicit allow_operator_handoff=true in 9M")
    if (actionKind === "prepare_result_review") blockers.push("Branch 9N result report model is required before result review")
    if (actionKind === "create_commander_question" && !usableQuestionEvidence(execution?.evidence_refs ?? [])) blockers.push("create_commander_question requires progress, watchdog, or forced-report evidence from the wake execution")
    if (METADATA_ACTIONS.has(actionKind)) warnings.push(`${actionKind} will call only the existing typed metadata service API when recorded`)
    if (actionKind === "deliver_guidance" && input.allow_operator_handoff === true) warnings.push("deliver_guidance uses operator_handoff only and sends no OpenCode prompt")
    if (blockers.length > 0 && effectKind !== "blocked_unsupported") {
      effectKind = actionKind === "unsupported" ? "blocked_unsupported" : effectKind
    }
    return { execution, actionKind, effectKind, manualActionPreview, expectedEventKinds, blockers, warnings }
  }

  private async executeMetadataAction(
    preview: OpenCodeWakeActionExecutionPreview,
    input: OpenCodeWakeActionExecutionRecordInput,
    recordedBy: string,
  ): Promise<{ status: OpenCodeWakeActionExecutionResult["status"]; metadata_record_id?: string; metadata_result_preview?: string; error?: string }> {
    if (preview.action_kind === "none") return { status: "skipped", metadata_result_preview: "no action needed" }
    if (preview.action_kind === "read_latest_progress") {
      const latest = await this.options.progressService.latest({ session_id: preview.session_id, launch_id: preview.launch_id })
      return { status: "skipped", metadata_record_id: latest?.progress_id, metadata_result_preview: latest ? `latest progress ${latest.progress_id}: ${latest.kind}` : "no latest progress found" }
    }
    if (preview.action_kind === "review_human_control") {
      const latest = await this.options.humanControlService.latest({ session_id: preview.session_id, launch_id: preview.launch_id })
      return { status: "skipped", metadata_record_id: latest?.control_id, metadata_result_preview: latest ? `latest human control ${latest.control_id}: ${latest.control_kind}` : "manual human control review required" }
    }
    if (preview.action_kind === "record_watchdog") {
      const result = await this.options.watchdogService.record({ session_id: preview.session_id, launch_id: preview.launch_id, recorded_by: recordedBy })
      if (result.status !== "recorded") return { status: "failed", error: result.error ?? "watchdog metadata record failed" }
      return { status: "executed", metadata_record_id: result.watchdog_id, metadata_result_preview: `watchdog ${result.watchdog_status}` }
    }
    if (preview.action_kind === "request_forced_report") {
      const result = await this.options.watchdogService.requestForcedReport({ session_id: preview.session_id, launch_id: preview.launch_id, reason: input.reason ?? "wake supervisor recommended forced report", requested_by: recordedBy })
      if (!("request_id" in result)) return { status: "failed", error: result.error ?? "forced report metadata request failed" }
      return { status: "executed", metadata_record_id: result.request_id, metadata_result_preview: `forced report requested; process_paused=${result.process_paused}` }
    }
    if (preview.action_kind === "create_commander_question") {
      const ids = evidenceIds(preview.evidence_refs)
      const result = await this.options.questionService.create({
        session_id: preview.session_id,
        launch_id: preview.launch_id,
        progress_id: ids.progress_id,
        watchdog_id: ids.watchdog_id,
        forced_report_request_id: ids.forced_report_request_id,
        question: input.reason ?? "Wake supervisor detected blocker/report need; Commander decision required.",
        context_summary: "Wake recommended-action execution gate created this bounded question from supervisor evidence.",
        source_kind: ids.forced_report_request_id ? "forced_report" : ids.watchdog_id ? "watchdog" : "progress_question",
        created_by: recordedBy,
      })
      if (result.status !== "created") return { status: "failed", error: result.error ?? "Commander question metadata creation failed" }
      return { status: "executed", metadata_record_id: result.question_id, metadata_result_preview: `Commander question ${result.question_type}` }
    }
    if (preview.action_kind === "deliver_guidance" && input.allow_operator_handoff === true) {
      const guidanceId = guidanceEvidenceId(preview.evidence_refs)
      if (!guidanceId) return { status: "failed", error: "guidance evidence was not available for operator_handoff delivery" }
      const result = await this.options.guidanceDeliveryService.deliver({ guidance_id: guidanceId, delivery_mode: "operator_handoff", delivered_by: recordedBy })
      if (result.status !== "delivery_requested") return { status: "failed", error: result.error ?? "guidance operator_handoff delivery failed" }
      return { status: "executed", metadata_record_id: result.delivery_id, metadata_result_preview: `guidance delivery ${result.delivery_status_after}; no OpenCode prompt sent` }
    }
    return { status: "skipped", metadata_result_preview: preview.manual_action_preview ?? "manual action required" }
  }

  private async sequencedRecords(): Promise<SequencedActionRecord[]> {
    return (await this.options.eventStore.readAll())
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => isActionEvent(event))
      .map(({ event, index }) => ({ record: recordFromEvent(event)!, event_index: index }))
      .filter((item) => Boolean(item.record))
  }

  private async serializeAction<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.actionQueue
    let release!: () => void
    this.actionQueue = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

export function readOpenCodeWakeActionExecutionPreviewInput(value: unknown): OpenCodeWakeActionExecutionPreviewInput {
  const input = isRecord(value) ? value : {}
  return {
    execution_id: optional(input.executionId ?? input.execution_id ?? input.execution),
    action_kind: optional(input.actionKind ?? input.action_kind ?? input.action),
    allow_operator_handoff: optionalBoolean(input.allowOperatorHandoff ?? input.allow_operator_handoff),
    answer: optionalRawText(input.answer),
    reason: optionalRawText(input.reason),
  }
}

export function readOpenCodeWakeActionExecutionRecordInput(value: unknown): OpenCodeWakeActionExecutionRecordInput {
  const input = isRecord(value) ? value : {}
  return {
    ...readOpenCodeWakeActionExecutionPreviewInput(value),
    dry_run: optionalBoolean(input.dryRun ?? input.dry_run),
    recorded_by: optional(input.recordedBy ?? input.recorded_by),
  }
}

function resultFromPreview(
  preview: OpenCodeWakeActionExecutionPreview,
  actionExecutionId: string,
  status: OpenCodeWakeActionExecutionResult["status"],
  recordedAt: string,
  recordedBy: string,
  error?: string,
  metadataRecordId?: string,
  metadataResultPreview?: string,
): OpenCodeWakeActionExecutionResult {
  return redactValue({
    action_execution_id: actionExecutionId,
    status,
    execution_id: preview.execution_id,
    session_id: preview.session_id,
    launch_id: preview.launch_id,
    supervisor_status: preview.supervisor_status,
    recommended_action: preview.recommended_action,
    action_kind: preview.action_kind,
    effect_kind: status === "failed" ? "failed" : preview.effect_kind,
    action_execution_status_before: "not_executed" as const,
    metadata_event_kind: metadataEventKind(preview.action_kind, preview.effect_kind),
    metadata_record_id: metadataRecordId,
    metadata_result_preview: bound(metadataResultPreview),
    manual_action_preview: preview.manual_action_preview,
    will_call_provider: false as const,
    will_send_opencode_prompt: false as const,
    will_control_process: false as const,
    will_mutate_mission: false as const,
    recorded_at: recordedAt,
    recorded_by: bound(recordedBy) ?? "operator",
    error: bound(error),
    action_hash: preview.action_hash,
    recommended_commands: preview.recommended_commands,
  })
}

function actionEventPayload(result: OpenCodeWakeActionExecutionResult, evidenceRefs: OpenCodeWakeActionExecutionEvidenceRef[]): Record<string, unknown> {
  return redactValue({
    kind: ACTION_EVENT_KIND,
    action_execution_id: result.action_execution_id,
    execution_id: result.execution_id,
    session_id: result.session_id,
    launch_id: result.launch_id,
    supervisor_status: result.supervisor_status,
    recommended_action: result.recommended_action,
    action_kind: result.action_kind,
    status: result.status,
    effect_kind: result.effect_kind,
    action_execution_status_before: "not_executed",
    metadata_event_kind: result.metadata_event_kind,
    metadata_record_id: result.metadata_record_id,
    metadata_result_preview: result.metadata_result_preview,
    manual_action_preview: result.manual_action_preview,
    will_call_provider: false,
    will_send_opencode_prompt: false,
    will_control_process: false,
    will_mutate_mission: false,
    evidence_refs: evidenceRefs,
    recorded_at: result.recorded_at,
    recorded_by: result.recorded_by,
    action_hash: result.action_hash,
  })
}

function resultFromEvent(event: JsonlEvent): OpenCodeWakeActionExecutionResult {
  return redactValue({
    action_execution_id: String(event.action_execution_id ?? ""),
    status: readResultStatus(event.status),
    execution_id: String(event.execution_id ?? ""),
    session_id: optional(event.session_id),
    launch_id: optional(event.launch_id),
    supervisor_status: optional(event.supervisor_status) as OpenCodeWakeActionExecutionResult["supervisor_status"],
    recommended_action: optional(event.recommended_action) as OpenCodeWakeSupervisorRecommendedAction | undefined,
    action_kind: readActionKind(event.action_kind),
    effect_kind: readEffectKind(event.effect_kind),
    action_execution_status_before: "not_executed" as const,
    metadata_event_kind: optional(event.metadata_event_kind),
    metadata_record_id: optional(event.metadata_record_id),
    metadata_result_preview: bound(event.metadata_result_preview),
    manual_action_preview: bound(event.manual_action_preview),
    will_call_provider: false as const,
    will_send_opencode_prompt: false as const,
    will_control_process: false as const,
    will_mutate_mission: false as const,
    recorded_at: String(event.recorded_at ?? ""),
    recorded_by: bound(event.recorded_by) ?? "unknown",
    action_hash: typeof event.action_hash === "string" ? event.action_hash : hash(stableJson(event)),
    recommended_commands: recommendedCommands(readActionKind(event.action_kind), String(event.execution_id ?? "<execution_id>"), optional(event.session_id)),
  })
}

function recordFromEvent(event: JsonlEvent): OpenCodeWakeActionExecutionRecord | null {
  if (typeof event.action_execution_id !== "string" || typeof event.execution_id !== "string") return null
  const result = resultFromEvent(event)
  return redactValue({
    action_execution_id: result.action_execution_id,
    execution_id: result.execution_id,
    session_id: result.session_id,
    launch_id: result.launch_id,
    recommended_action: result.recommended_action,
    action_kind: result.action_kind,
    status: result.status,
    effect_kind: result.effect_kind,
    metadata_event_kind: result.metadata_event_kind,
    metadata_record_id: result.metadata_record_id,
    recorded_at: result.recorded_at,
    recorded_by: result.recorded_by,
    summary_preview: bound(`wake action ${result.status}: ${result.action_kind}; effect=${result.effect_kind}; provider=false prompt=false process=false mission=false`) ?? "",
    action_hash: result.action_hash,
  })
}

function actionKindFromRecommendedAction(action: OpenCodeWakeSupervisorRecommendedAction | undefined): OpenCodeWakeActionKind {
  if (action === "none" || action === "read_latest_progress" || action === "record_watchdog" || action === "request_forced_report" || action === "create_commander_question" || action === "answer_commander_question" || action === "deliver_guidance" || action === "review_human_control" || action === "prepare_result_review") return action
  return "unsupported"
}

function readActionKind(value: unknown, fallback: OpenCodeWakeActionKind = "unsupported"): OpenCodeWakeActionKind {
  return value === "none" || value === "read_latest_progress" || value === "record_watchdog" || value === "request_forced_report" || value === "create_commander_question" || value === "answer_commander_question" || value === "deliver_guidance" || value === "review_human_control" || value === "prepare_result_review" || value === "unsupported" ? value : fallback
}

function effectForAction(action: OpenCodeWakeActionKind, allowOperatorHandoff: boolean): OpenCodeWakeActionEffectKind {
  if (action === "none") return "no_effect"
  if (action === "read_latest_progress") return "read_only_noop"
  if (action === "record_watchdog" || action === "request_forced_report" || action === "create_commander_question") return "metadata_event_appended"
  if (action === "deliver_guidance" && allowOperatorHandoff) return "metadata_event_appended"
  if (action === "unsupported") return "blocked_unsupported"
  return "manual_action_required"
}

function expectedEventsForAction(action: OpenCodeWakeActionKind, allowOperatorHandoff: boolean): string[] {
  if (action === "record_watchdog") return ["opencode_session_watchdog_recorded", ACTION_EVENT_KIND]
  if (action === "request_forced_report") return ["opencode_session_forced_report_requested", ACTION_EVENT_KIND]
  if (action === "create_commander_question") return ["opencode_commander_question_created", ACTION_EVENT_KIND]
  if (action === "deliver_guidance" && allowOperatorHandoff) return ["opencode_commander_guidance_delivery_requested", ACTION_EVENT_KIND]
  return [ACTION_EVENT_KIND]
}

function metadataEventKind(action: OpenCodeWakeActionKind, effect: OpenCodeWakeActionEffectKind): string | undefined {
  if (effect !== "metadata_event_appended") return undefined
  if (action === "record_watchdog") return "opencode_session_watchdog_recorded"
  if (action === "request_forced_report") return "opencode_session_forced_report_requested"
  if (action === "create_commander_question") return "opencode_commander_question_created"
  if (action === "deliver_guidance") return "opencode_commander_guidance_delivery_requested"
  return undefined
}

function manualPreviewForAction(action: OpenCodeWakeActionKind, execution: OpenCodeWakeSupervisorExecutionResult | null, allowOperatorHandoff: boolean): string | undefined {
  const ids = evidenceIds(readEvidenceRefs(execution?.evidence_refs ?? []))
  if (action === "answer_commander_question") return `/commander-guidance question=${ids.question_id ?? "<question_id>"} answer=<answer>`
  if (action === "deliver_guidance" && !allowOperatorHandoff) return `/commander-guidance-deliver guidance=${ids.guidance_id ?? "<guidance_id>"} mode=operator_handoff`
  if (action === "review_human_control") return `/opencode-human-controls session=${execution?.session_id ?? "<session_id>"}`
  if (action === "prepare_result_review") return "Branch 9N result report model required before result review."
  if (action === "unsupported") return "Unsupported wake recommendation; inspect supervisor evidence manually."
  return undefined
}

function usableQuestionEvidence(refs: OpenCodeWakeSupervisorExecutionEvidenceRef[]): boolean {
  const ids = evidenceIds(readEvidenceRefs(refs))
  return Boolean(ids.progress_id || ids.watchdog_id || ids.forced_report_request_id)
}

function evidenceIds(refs: OpenCodeWakeActionExecutionEvidenceRef[]): { progress_id?: string; watchdog_id?: string; forced_report_request_id?: string; question_id?: string; guidance_id?: string } {
  const result: { progress_id?: string; watchdog_id?: string; forced_report_request_id?: string; question_id?: string; guidance_id?: string } = {}
  for (const ref of refs) {
    if (ref.evidence_kind === "progress" && !result.progress_id) result.progress_id = ref.evidence_id
    if (ref.evidence_kind === "watchdog" && !result.watchdog_id) result.watchdog_id = ref.evidence_id
    if (ref.evidence_kind === "forced_report" && !result.forced_report_request_id) result.forced_report_request_id = ref.evidence_id
    if (ref.evidence_kind === "commander_question" && !result.question_id) result.question_id = ref.evidence_id
    if (ref.evidence_kind === "commander_guidance" && !result.guidance_id) result.guidance_id = ref.evidence_id
  }
  return result
}

function guidanceEvidenceId(refs: OpenCodeWakeActionExecutionEvidenceRef[]): string | undefined {
  return evidenceIds(refs).guidance_id
}

function readEvidenceRefs(value: unknown): OpenCodeWakeActionExecutionEvidenceRef[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, MAX_LIST).map((item) => ({
    evidence_kind: bound(item.evidence_kind) ?? "unknown",
    evidence_id: bound(item.evidence_id) ?? "",
    status: bound(item.status),
    summary_preview: bound(item.summary_preview),
    pointer_only: true as const,
  }))
}

function recommendedCommands(actionKind: OpenCodeWakeActionKind, executionId: string, sessionId?: string): OpenCodeWakeActionExecutionCommand[] {
  const commands: OpenCodeWakeActionExecutionCommand[] = [
    { label: "List wake actions", command: `/opencode-wake-actions execution=${executionId}`, command_type: "read", notes: "read wake action execution metadata" },
    { label: "Show wake execution", command: `/opencode-wake-execution-show ${executionId}`, command_type: "read", notes: "inspect source 9L wake execution record" },
  ]
  if (actionKind === "answer_commander_question") commands.push({ label: "Answer question manually", command: "/commander-guidance question=<question_id> answer=<answer>", command_type: "write", notes: "explicit manual command required; 9M does not generate answers" })
  if (actionKind === "deliver_guidance") commands.push({ label: "Deliver guidance manually", command: "/commander-guidance-deliver guidance=<guidance_id> mode=operator_handoff", command_type: "write", notes: "explicit operator_handoff only; no OpenCode prompt send" })
  if (sessionId) commands.push({ label: "Supervisor preview", command: `/opencode-wake-supervisor-preview session=${sessionId}`, command_type: "read" })
  return commands
}

function isActionEvent(event: JsonlEvent): boolean {
  return event.kind === ACTION_EVENT_KIND
}

function readResultStatus(value: unknown): OpenCodeWakeActionExecutionResult["status"] {
  return value === "executed" || value === "skipped" || value === "blocked" || value === "dry_run" || value === "failed" ? value : "blocked"
}

function readEffectKind(value: unknown): OpenCodeWakeActionEffectKind {
  return value === "no_effect" || value === "read_only_noop" || value === "metadata_event_appended" || value === "manual_action_required" || value === "blocked_unsupported" || value === "failed" ? value : "failed"
}

function compareSequencedDesc(a: SequencedActionRecord, b: SequencedActionRecord): number {
  return b.event_index - a.event_index
}

function positiveInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(Math.floor(value), max))
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? bound(value.trim()) : undefined
}

function optionalRawText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true
    if (value.toLowerCase() === "false") return false
  }
  return undefined
}

function bound(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value !== "string") return undefined
  return redactText(value).slice(0, max)
}

function boundArray<T>(values: T[], max = MAX_LIST): T[] {
  return values.slice(0, max)
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(flattenKeys(value)).sort())
}

function flattenKeys(value: unknown, keys: Record<string, true> = {}): Record<string, true> {
  if (Array.isArray(value)) {
    for (const item of value) flattenKeys(item, keys)
  } else if (isRecord(value)) {
    for (const [key, nested] of Object.entries(value)) {
      keys[key] = true
      flattenKeys(nested, keys)
    }
  }
  return keys
}
