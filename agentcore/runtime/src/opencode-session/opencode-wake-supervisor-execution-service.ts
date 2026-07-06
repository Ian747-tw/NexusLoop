import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { OpenCodeWakeSupervisorService } from "./opencode-wake-supervisor-service"
import type {
  OpenCodeWakeSupervisorCommand,
  OpenCodeWakeSupervisorEvidenceRef,
  OpenCodeWakeSupervisorPreview,
  OpenCodeWakeSupervisorRecommendedAction,
  OpenCodeWakeSupervisorSummary,
  OpenCodeWakeSupervisorStatus,
} from "./opencode-wake-supervisor-types"
import type {
  OpenCodeWakeSupervisorBatchPreview,
  OpenCodeWakeSupervisorBatchPreviewInput,
  OpenCodeWakeSupervisorBatchRecordInput,
  OpenCodeWakeSupervisorBatchResult,
  OpenCodeWakeSupervisorExecutionCommand,
  OpenCodeWakeSupervisorExecutionEvidenceRef,
  OpenCodeWakeSupervisorExecutionMode,
  OpenCodeWakeSupervisorExecutionPreview,
  OpenCodeWakeSupervisorExecutionPreviewInput,
  OpenCodeWakeSupervisorExecutionRecord,
  OpenCodeWakeSupervisorExecutionRecordInput,
  OpenCodeWakeSupervisorExecutionResult,
  OpenCodeWakeSupervisorExecutionSummary,
} from "./opencode-wake-supervisor-execution-types"

const MAX_LIST = 100
const MAX_BATCH = 50
const DEFAULT_BATCH_LIMIT = 20
const DEFAULT_EVIDENCE_LIMIT = 20
const MAX_TEXT = 360
const EXECUTION_EVENT_KIND = "opencode_wake_supervisor_execution_recorded"
const BATCH_EVENT_KIND = "opencode_wake_supervisor_batch_recorded"

export type OpenCodeWakeSupervisorExecutionServiceOptions = {
  eventStore: EventStore
  wakeSupervisorService: OpenCodeWakeSupervisorService
  now?: () => Date
  idFactory?: () => string
  batchIdFactory?: () => string
}

type SequencedExecutionRecord = {
  record: OpenCodeWakeSupervisorExecutionRecord
  event_index: number
}

export class OpenCodeWakeSupervisorExecutionService {
  private readonly now: () => Date
  private readonly idFactory: () => string
  private readonly batchIdFactory: () => string
  private recordQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: OpenCodeWakeSupervisorExecutionServiceOptions) {
    this.now = options.now ?? (() => new Date())
    this.idFactory = options.idFactory ?? (() => `opencode_wake_execution_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`)
    this.batchIdFactory = options.batchIdFactory ?? (() => `opencode_wake_batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`)
  }

  async preview(input: OpenCodeWakeSupervisorExecutionPreviewInput = {}): Promise<OpenCodeWakeSupervisorExecutionPreview> {
    return this.buildPreview(input, "single_session")
  }

  async record(input: OpenCodeWakeSupervisorExecutionRecordInput = {}): Promise<OpenCodeWakeSupervisorExecutionResult> {
    const preview = await this.buildPreview(input, "single_session")
    const executionId = this.idFactory()
    const recordedAt = this.now().toISOString()
    const recordedBy = bound(input.recorded_by ?? "operator") ?? "operator"
    if (!preview.can_record) return resultFromPreview(preview, executionId, "blocked", recordedAt, recordedBy, preview.blockers[0] ?? "OpenCode wake supervisor execution is blocked")
    if (input.dry_run === true) return resultFromPreview(preview, executionId, "dry_run", recordedAt, recordedBy)
    return this.serializeRecord(async () => {
      const rebuilt = await this.buildPreview(input, "single_session")
      if (!rebuilt.can_record) return resultFromPreview(rebuilt, executionId, "blocked", recordedAt, recordedBy, rebuilt.blockers[0] ?? "OpenCode wake supervisor execution is blocked")
      const result = resultFromPreview(rebuilt, executionId, "recorded", recordedAt, recordedBy)
      await this.options.eventStore.append(executionEventPayload(result) as JsonlEvent)
      return redactValue(result)
    })
  }

  async batchPreview(input: OpenCodeWakeSupervisorBatchPreviewInput = {}): Promise<OpenCodeWakeSupervisorBatchPreview> {
    return this.buildBatchPreview(input)
  }

  async recordBatch(input: OpenCodeWakeSupervisorBatchRecordInput = {}): Promise<OpenCodeWakeSupervisorBatchResult> {
    const preview = await this.buildBatchPreview(input)
    const batchId = this.batchIdFactory()
    const recordedAt = this.now().toISOString()
    const recordedBy = bound(input.recorded_by ?? "operator") ?? "operator"
    if (!preview.can_record) return batchResultFromPreview(preview, batchId, "blocked", recordedAt, recordedBy, preview.blockers[0] ?? "OpenCode wake supervisor batch execution is blocked")
    if (input.dry_run === true) return batchResultFromPreview(preview, batchId, "dry_run", recordedAt, recordedBy)
    return this.serializeRecord(async () => {
      const rebuilt = await this.buildBatchPreview(input)
      if (!rebuilt.can_record) return batchResultFromPreview(rebuilt, batchId, "blocked", recordedAt, recordedBy, rebuilt.blockers[0] ?? "OpenCode wake supervisor batch execution is blocked")
      const records: OpenCodeWakeSupervisorExecutionRecord[] = []
      const results: OpenCodeWakeSupervisorExecutionResult[] = []
      for (const sessionPreview of rebuilt.session_previews) {
        if (!sessionPreview.can_record) continue
        const result = resultFromPreview(sessionPreview, this.idFactory(), "recorded", recordedAt, recordedBy, undefined, "batch_active_sessions")
        results.push(result)
        records.push(recordFromResult(result))
      }
      const result = batchResultFromPreview(rebuilt, batchId, "recorded", recordedAt, recordedBy, undefined, records)
      await this.options.eventStore.append(batchEventPayload(result) as JsonlEvent)
      for (const executionResult of results) {
        await this.options.eventStore.append(executionEventPayload(executionResult, batchId) as JsonlEvent)
      }
      return redactValue(result)
    })
  }

  async list(input: { limit?: number; session_id?: string; launch_id?: string; supervisor_status?: string; recommended_action?: string; execution_mode?: string } = {}): Promise<OpenCodeWakeSupervisorExecutionRecord[]> {
    const limit = positiveInteger(input.limit, 20, MAX_LIST)
    return (await this.sequencedRecords())
      .filter((item) => !input.session_id || item.record.session_id === input.session_id)
      .filter((item) => !input.launch_id || item.record.launch_id === input.launch_id)
      .filter((item) => !input.supervisor_status || item.record.supervisor_status === input.supervisor_status)
      .filter((item) => !input.recommended_action || item.record.recommended_action === input.recommended_action)
      .filter((item) => !input.execution_mode || item.record.execution_mode === input.execution_mode)
      .sort(compareSequencedDesc)
      .map((item) => item.record)
      .slice(0, limit)
  }

  async get(executionId: string): Promise<OpenCodeWakeSupervisorExecutionResult | null> {
    const event = (await this.options.eventStore.readAll()).filter(isExecutionEvent).reverse().find((item) => item.execution_id === executionId)
    return event ? resultFromEvent(event) : null
  }

  async latest(input: { session_id?: string; launch_id?: string } = {}): Promise<OpenCodeWakeSupervisorExecutionResult | null> {
    const latest = (await this.list({ ...input, limit: 1 }))[0]
    return latest ? this.get(latest.execution_id) : null
  }

  async summary(input: { limit?: number } = {}): Promise<OpenCodeWakeSupervisorExecutionSummary> {
    const records = (await this.sequencedRecords()).sort(compareSequencedDesc).map((item) => item.record)
    const batchCount = (await this.options.eventStore.readAll()).filter(isBatchEvent).length
    const limit = positiveInteger(input.limit, 10, MAX_LIST)
    return redactValue({
      total_executions: records.length,
      session_count: new Set(records.map((record) => record.session_id).filter(Boolean)).size,
      batch_count: batchCount,
      healthy_count: records.filter((record) => record.supervisor_status === "healthy").length,
      watch_count: records.filter((record) => record.supervisor_status === "watch").length,
      needs_report_count: records.filter((record) => record.supervisor_status === "needs_report").length,
      needs_commander_answer_count: records.filter((record) => record.supervisor_status === "needs_commander_answer").length,
      guidance_pending_delivery_count: records.filter((record) => record.supervisor_status === "guidance_pending_delivery").length,
      human_attention_count: records.filter((record) => record.supervisor_status === "human_attention" || record.supervisor_status === "human_paused" || record.supervisor_status === "stop_requested").length,
      timed_out_count: records.filter((record) => record.supervisor_status === "timed_out").length,
      stale_count: records.filter((record) => record.supervisor_status === "stale").length,
      blocked_count: records.filter((record) => record.supervisor_status === "blocked").length,
      action_executed_count: 0 as const,
      latest_executions: records.slice(0, limit),
      generated_at: this.now().toISOString(),
    })
  }

  private async buildPreview(input: OpenCodeWakeSupervisorExecutionPreviewInput = {}, executionMode: OpenCodeWakeSupervisorExecutionMode): Promise<OpenCodeWakeSupervisorExecutionPreview> {
    const generatedAt = this.now().toISOString()
    const warnings = new Set<string>([
      "wake supervisor execution records metadata only; recommended commands are not executed",
      "action_execution_status=not_executed for 9L",
      "no provider, MCP, OpenCode prompt, OpenCode launch, process control, research.db write, checkpoint, result ingestion, or mission/proposal/review/apply mutation occurs",
    ])
    const blockers: string[] = []
    let supervisor: OpenCodeWakeSupervisorPreview | null = null
    try {
      supervisor = await this.options.wakeSupervisorService.preview({
        session_id: optional(input.session_id),
        launch_id: optional(input.launch_id),
        include_research_memory: input.include_research_memory,
        include_context_packet: input.include_context_packet,
        include_human_controls: input.include_human_controls,
        include_guidance_delivery: input.include_guidance_delivery,
        limit_evidence: input.limit_evidence,
      })
    } catch (error) {
      blockers.push(`wake supervisor preview failed: ${bound(error instanceof Error ? error.message : String(error)) ?? "unknown error"}`)
    }
    if (!supervisor) blockers.push("wake supervisor preview is unavailable")
    if (supervisor?.status === "blocked") blockers.push(...supervisor.blockers)
    if (supervisor?.status === "partial") warnings.add("partial supervisor preview recorded with bounded available evidence")
    const canRecord = blockers.length === 0 && Boolean(supervisor?.session_id || supervisor?.launch_id)
    const recommendedCommands = commandPreviews(supervisor?.recommended_commands ?? [])
    const evidenceRefs = evidencePreviews(supervisor?.evidence_refs ?? [], positiveInteger(input.limit_evidence, DEFAULT_EVIDENCE_LIMIT, MAX_LIST))
    const executionHash = hash(stableJson({
      execution_mode: executionMode,
      session_id: supervisor?.session_id ?? optional(input.session_id),
      launch_id: supervisor?.launch_id ?? optional(input.launch_id),
      supervisor_hash: supervisor?.supervisor_hash,
      supervisor_status: supervisor?.supervisor_status,
      recommended_action: supervisor?.recommended_action,
      evidence_refs: evidenceRefs.map((ref) => [ref.evidence_kind, ref.evidence_id, ref.status]),
      context_section_count: supervisor?.context_sections.length ?? 0,
      action_execution_status: "not_executed",
      blockers,
    }))
    const status: OpenCodeWakeSupervisorExecutionPreview["status"] = blockers.length > 0 ? "blocked" : supervisor?.status === "partial" ? "partial" : "ready"
    return redactValue({
      preview_id: `opencode_wake_execution_preview_${executionHash.slice(0, 16)}`,
      status,
      can_record: canRecord,
      execution_mode: executionMode,
      session_id: supervisor?.session_id ?? optional(input.session_id),
      launch_id: supervisor?.launch_id ?? optional(input.launch_id),
      supervisor_preview_id: supervisor?.preview_id,
      supervisor_hash: supervisor?.supervisor_hash,
      supervisor_status: supervisor?.supervisor_status,
      recommended_action: supervisor?.recommended_action,
      action_execution_status: "not_executed" as const,
      recommended_commands_preview: recommendedCommands,
      evidence_refs: evidenceRefs,
      context_section_count: supervisor?.context_sections.length ?? 0,
      blockers: boundArray(unique(blockers)),
      warnings: boundArray(unique([...warnings, ...(supervisor?.warnings ?? [])])),
      generated_at: generatedAt,
      redacted_summary_preview: blockers.length > 0
        ? blockers[0] ?? "OpenCode wake supervisor execution blocked"
        : `Wake supervisor execution would record ${supervisor?.supervisor_status ?? "unknown"} and recommend ${supervisor?.recommended_action ?? "unknown"} without executing actions`,
      execution_hash: executionHash,
    })
  }

  private async buildBatchPreview(input: OpenCodeWakeSupervisorBatchPreviewInput = {}): Promise<OpenCodeWakeSupervisorBatchPreview> {
    const generatedAt = this.now().toISOString()
    const limit = positiveInteger(input.limit, DEFAULT_BATCH_LIMIT, MAX_BATCH)
    const warnings = new Set<string>([
      "batch wake supervisor execution records metadata only; recommended commands are not executed",
      "batch records are capped and do not run a scheduler daemon",
    ])
    const blockers: string[] = []
    const summary = await this.options.wakeSupervisorService.summary({
      limit,
      include_research_memory: input.include_research_memory,
      include_human_controls: input.include_human_controls,
      status_filter: input.status_filter,
    })
    const totalCandidateSessions = batchCandidateCount(summary, input.status_filter)
    const sessionPreviews: OpenCodeWakeSupervisorExecutionPreview[] = []
    for (const card of summary.session_cards.slice(0, limit)) {
      const preview = await this.buildPreview({
        session_id: card.session_id,
        launch_id: card.launch_id,
        include_research_memory: input.include_research_memory,
        include_human_controls: input.include_human_controls,
        include_guidance_delivery: input.include_guidance_delivery,
        limit_evidence: input.limit_evidence,
      }, "batch_active_sessions")
      if (preview.can_record) sessionPreviews.push(preview)
      else warnings.add(`skipped ${card.session_id}: ${preview.blockers[0] ?? "blocked preview"}`)
    }
    if (totalCandidateSessions === 0) blockers.push("no active launch_started or launched OpenCode sessions are available for batch wake execution")
    if (totalCandidateSessions > limit) warnings.add(`batch preview capped at ${limit} sessions`)
    const skipped = Math.max(0, totalCandidateSessions - sessionPreviews.length)
    const canRecord = blockers.length === 0 && sessionPreviews.length > 0
    if (totalCandidateSessions > 0 && sessionPreviews.length === 0) blockers.push("all candidate sessions were skipped or blocked")
    const batchHash = hash(stableJson({
      execution_mode: "batch_active_sessions",
      total_candidate_sessions: totalCandidateSessions,
      included_session_count: sessionPreviews.length,
      skipped_session_count: skipped,
      hashes: sessionPreviews.map((preview) => preview.execution_hash),
      status_filter: input.status_filter,
    }))
    const status: OpenCodeWakeSupervisorBatchPreview["status"] = blockers.length > 0 ? "blocked" : skipped > 0 || sessionPreviews.some((preview) => preview.status === "partial") ? "partial" : "ready"
    return redactValue({
      preview_id: `opencode_wake_batch_preview_${batchHash.slice(0, 16)}`,
      status,
      can_record: canRecord,
      execution_mode: "batch_active_sessions" as const,
      total_candidate_sessions: totalCandidateSessions,
      included_session_count: sessionPreviews.length,
      skipped_session_count: skipped,
      session_previews: sessionPreviews,
      blockers: boundArray(unique(blockers)),
      warnings: boundArray(unique([...warnings])),
      generated_at: generatedAt,
      redacted_summary_preview: canRecord
        ? `Batch wake supervisor execution would record ${sessionPreviews.length} session assessments without executing actions`
        : blockers[0] ?? "OpenCode wake supervisor batch execution blocked",
      execution_hash: batchHash,
    })
  }

  private async sequencedRecords(): Promise<SequencedExecutionRecord[]> {
    return (await this.options.eventStore.readAll())
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => isExecutionEvent(event))
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

function batchCandidateCount(summary: OpenCodeWakeSupervisorSummary, statusFilter?: string): number {
  if (!statusFilter) return summary.total_launched_sessions
  const statusCount = summary.status_counts[statusFilter as keyof typeof summary.status_counts]
  if (typeof statusCount === "number") return statusCount
  if (statusFilter === "healthy") return summary.healthy_count
  if (statusFilter === "watch") return summary.watch_count
  if (statusFilter === "stale") return summary.stale_count
  if (statusFilter === "timed_out") return summary.timed_out_count
  if (statusFilter === "needs_report") return summary.needs_report_count
  if (statusFilter === "needs_commander_answer") return summary.needs_commander_answer_count
  if (statusFilter === "guidance_pending_delivery") return summary.guidance_pending_delivery_count
  if (statusFilter === "human_attention" || statusFilter === "human_paused") return summary.human_attention_count
  if (statusFilter === "stop_requested") return summary.stop_requested_count
  return summary.session_cards.length
}

export function readOpenCodeWakeSupervisorExecutionPreviewInput(value: unknown): OpenCodeWakeSupervisorExecutionPreviewInput {
  const input = isRecord(value) ? value : {}
  return {
    session_id: optional(input.sessionId ?? input.session_id ?? input.session),
    launch_id: optional(input.launchId ?? input.launch_id ?? input.launch),
    include_research_memory: optionalBoolean(input.includeResearchMemory ?? input.include_research_memory),
    include_context_packet: optionalBoolean(input.includeContextPacket ?? input.include_context_packet),
    include_human_controls: optionalBoolean(input.includeHumanControls ?? input.include_human_controls),
    include_guidance_delivery: optionalBoolean(input.includeGuidanceDelivery ?? input.include_guidance_delivery),
    limit_evidence: optionalPositiveInteger(input.limitEvidence ?? input.limit_evidence, MAX_LIST),
  }
}

export function readOpenCodeWakeSupervisorExecutionRecordInput(value: unknown): OpenCodeWakeSupervisorExecutionRecordInput {
  const input = isRecord(value) ? value : {}
  return {
    ...readOpenCodeWakeSupervisorExecutionPreviewInput(value),
    dry_run: optionalBoolean(input.dryRun ?? input.dry_run),
    recorded_by: optional(input.recordedBy ?? input.recorded_by),
  }
}

export function readOpenCodeWakeSupervisorBatchPreviewInput(value: unknown): OpenCodeWakeSupervisorBatchPreviewInput {
  const input = isRecord(value) ? value : {}
  return {
    limit: optionalPositiveInteger(input.limit, MAX_BATCH),
    status_filter: optional(input.statusFilter ?? input.status_filter ?? input.status),
    include_research_memory: optionalBoolean(input.includeResearchMemory ?? input.include_research_memory),
    include_human_controls: optionalBoolean(input.includeHumanControls ?? input.include_human_controls),
    include_guidance_delivery: optionalBoolean(input.includeGuidanceDelivery ?? input.include_guidance_delivery),
    limit_evidence: optionalPositiveInteger(input.limitEvidence ?? input.limit_evidence, MAX_LIST),
  }
}

export function readOpenCodeWakeSupervisorBatchRecordInput(value: unknown): OpenCodeWakeSupervisorBatchRecordInput {
  const input = isRecord(value) ? value : {}
  return {
    ...readOpenCodeWakeSupervisorBatchPreviewInput(value),
    dry_run: optionalBoolean(input.dryRun ?? input.dry_run),
    recorded_by: optional(input.recordedBy ?? input.recorded_by),
  }
}

function resultFromPreview(
  preview: OpenCodeWakeSupervisorExecutionPreview,
  executionId: string,
  status: OpenCodeWakeSupervisorExecutionResult["status"],
  recordedAt: string,
  recordedBy: string,
  error?: string,
  executionMode: OpenCodeWakeSupervisorExecutionMode = preview.execution_mode,
): OpenCodeWakeSupervisorExecutionResult {
  return redactValue({
    execution_id: executionId,
    status,
    execution_mode: executionMode,
    session_id: preview.session_id,
    launch_id: preview.launch_id,
    supervisor_preview_id: preview.supervisor_preview_id,
    supervisor_hash: preview.supervisor_hash,
    supervisor_status: preview.supervisor_status,
    recommended_action: preview.recommended_action,
    action_execution_status: "not_executed" as const,
    recommended_commands_preview: preview.recommended_commands_preview,
    evidence_refs: preview.evidence_refs,
    context_section_count: preview.context_section_count,
    recorded_at: recordedAt,
    recorded_by: bound(recordedBy) ?? "operator",
    error: bound(error),
    execution_hash: preview.execution_hash,
    recommended_commands: followupCommands(preview.session_id, preview.launch_id),
  })
}

function batchResultFromPreview(
  preview: OpenCodeWakeSupervisorBatchPreview,
  batchId: string,
  status: OpenCodeWakeSupervisorBatchResult["status"],
  recordedAt: string,
  recordedBy: string,
  error?: string,
  executionRecords: OpenCodeWakeSupervisorExecutionRecord[] = [],
): OpenCodeWakeSupervisorBatchResult {
  return redactValue({
    batch_id: batchId,
    status,
    execution_mode: "batch_active_sessions" as const,
    total_candidate_sessions: preview.total_candidate_sessions,
    recorded_execution_count: status === "recorded" || status === "dry_run" ? (executionRecords.length || preview.included_session_count) : 0,
    skipped_session_count: preview.skipped_session_count,
    execution_records: executionRecords,
    action_execution_status: "not_executed" as const,
    recorded_at: recordedAt,
    recorded_by: bound(recordedBy) ?? "operator",
    error: bound(error),
    batch_hash: preview.execution_hash,
    recommended_commands: [
      { label: "List wake executions", command: "/opencode-wake-executions", command_type: "read", notes: "read recorded wake supervisor execution metadata" },
      { label: "Supervisor summary", command: "/opencode-wake-supervisor-summary", command_type: "read", notes: "read current wake supervisor preview summary" },
    ],
  })
}

function executionEventPayload(result: OpenCodeWakeSupervisorExecutionResult, batchId?: string): Record<string, unknown> {
  return redactValue({
    kind: EXECUTION_EVENT_KIND,
    execution_id: result.execution_id,
    execution_mode: result.execution_mode,
    batch_id: batchId,
    session_id: result.session_id,
    launch_id: result.launch_id,
    supervisor_preview_id: result.supervisor_preview_id,
    supervisor_hash: result.supervisor_hash,
    supervisor_status: result.supervisor_status,
    recommended_action: result.recommended_action,
    action_execution_status: "not_executed",
    recommended_commands_preview: result.recommended_commands_preview,
    evidence_refs: result.evidence_refs,
    context_section_count: result.context_section_count,
    recorded_at: result.recorded_at,
    recorded_by: result.recorded_by,
    execution_hash: result.execution_hash,
  })
}

function batchEventPayload(result: OpenCodeWakeSupervisorBatchResult): Record<string, unknown> {
  return redactValue({
    kind: BATCH_EVENT_KIND,
    batch_id: result.batch_id,
    execution_mode: "batch_active_sessions",
    total_candidate_sessions: result.total_candidate_sessions,
    recorded_execution_count: result.recorded_execution_count,
    skipped_session_count: result.skipped_session_count,
    session_execution_ids: result.execution_records.map((record) => record.execution_id),
    action_execution_status: "not_executed",
    recorded_at: result.recorded_at,
    recorded_by: result.recorded_by,
    batch_hash: result.batch_hash,
  })
}

function resultFromEvent(event: JsonlEvent): OpenCodeWakeSupervisorExecutionResult {
  const sessionId = typeof event.session_id === "string" ? event.session_id : undefined
  const launchId = typeof event.launch_id === "string" ? event.launch_id : undefined
  return redactValue({
    execution_id: String(event.execution_id ?? ""),
    status: "recorded" as const,
    execution_mode: readExecutionMode(event.execution_mode),
    session_id: sessionId,
    launch_id: launchId,
    supervisor_preview_id: optional(event.supervisor_preview_id),
    supervisor_hash: optional(event.supervisor_hash),
    supervisor_status: readSupervisorStatus(event.supervisor_status),
    recommended_action: readRecommendedAction(event.recommended_action),
    action_execution_status: "not_executed" as const,
    recommended_commands_preview: readCommands(event.recommended_commands_preview),
    evidence_refs: readEvidenceRefs(event.evidence_refs),
    context_section_count: typeof event.context_section_count === "number" ? event.context_section_count : 0,
    recorded_at: typeof event.recorded_at === "string" ? event.recorded_at : "",
    recorded_by: bound(event.recorded_by) ?? "unknown",
    execution_hash: typeof event.execution_hash === "string" ? event.execution_hash : hash(stableJson(event)),
    recommended_commands: followupCommands(sessionId, launchId),
  })
}

function recordFromEvent(event: JsonlEvent): OpenCodeWakeSupervisorExecutionRecord | null {
  if (typeof event.execution_id !== "string") return null
  const result = resultFromEvent(event)
  return recordFromResult(result)
}

function recordFromResult(result: OpenCodeWakeSupervisorExecutionResult): OpenCodeWakeSupervisorExecutionRecord {
  return redactValue({
    execution_id: result.execution_id,
    execution_mode: result.execution_mode,
    session_id: result.session_id,
    launch_id: result.launch_id,
    supervisor_status: result.supervisor_status,
    recommended_action: result.recommended_action,
    action_execution_status: "not_executed" as const,
    recorded_at: result.recorded_at,
    recorded_by: result.recorded_by,
    summary_preview: bound(`wake supervisor recorded ${result.supervisor_status ?? "unknown"}; recommended ${result.recommended_action ?? "unknown"}; action_execution_status=not_executed`) ?? "",
    execution_hash: result.execution_hash,
  })
}

function commandPreviews(commands: OpenCodeWakeSupervisorCommand[]): OpenCodeWakeSupervisorExecutionCommand[] {
  return boundArray(commands, 12).map((command) => ({
    label: bound(command.label) ?? "Command",
    command: bound(command.command) ?? "",
    command_type: command.command_type,
    requires_active_runtime: command.requires_active_runtime,
    notes: bound([command.notes, "preview only; not executed by 9L wake supervisor execution"].filter(Boolean).join("; ")),
  }))
}

function evidencePreviews(refs: OpenCodeWakeSupervisorEvidenceRef[], limit: number): OpenCodeWakeSupervisorExecutionEvidenceRef[] {
  return refs.slice(0, limit).map((ref) => ({
    evidence_kind: bound(ref.evidence_kind) ?? "unknown",
    evidence_id: bound(ref.evidence_id) ?? "",
    status: bound(ref.status),
    summary_preview: bound(ref.summary_preview),
    pointer_only: true as const,
  }))
}

function followupCommands(sessionId?: string, launchId?: string): OpenCodeWakeSupervisorExecutionCommand[] {
  const session = sessionId ?? "<session_id>"
  const commands: OpenCodeWakeSupervisorExecutionCommand[] = [
    { label: "List wake executions", command: sessionId ? `/opencode-wake-executions session=${session}` : "/opencode-wake-executions", command_type: "read", notes: "read recorded wake supervisor execution metadata" },
    { label: "Preview supervisor", command: launchId ? `/opencode-wake-supervisor-preview launch=${launchId}` : `/opencode-wake-supervisor-preview session=${session}`, command_type: "read", notes: "recompute read-only supervisor preview" },
  ]
  return commands
}

function readCommands(value: unknown): OpenCodeWakeSupervisorExecutionCommand[] {
  if (!Array.isArray(value)) return []
  return commandPreviews(value.filter(isRecord).map((item) => ({
    label: String(item.label ?? "Command"),
    command: String(item.command ?? ""),
    command_type: item.command_type === "write" ? "write" : "read",
    requires_active_runtime: optionalBoolean(item.requires_active_runtime),
    notes: optional(item.notes),
  })))
}

function readEvidenceRefs(value: unknown): OpenCodeWakeSupervisorExecutionEvidenceRef[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, MAX_LIST).map((item) => ({
    evidence_kind: bound(item.evidence_kind) ?? "unknown",
    evidence_id: bound(item.evidence_id) ?? "",
    status: bound(item.status),
    summary_preview: bound(item.summary_preview),
    pointer_only: true as const,
  }))
}

function isExecutionEvent(event: JsonlEvent): boolean {
  return event.kind === EXECUTION_EVENT_KIND
}

function isBatchEvent(event: JsonlEvent): boolean {
  return event.kind === BATCH_EVENT_KIND
}

function readExecutionMode(value: unknown): OpenCodeWakeSupervisorExecutionMode {
  return value === "batch_active_sessions" ? "batch_active_sessions" : "single_session"
}

function readSupervisorStatus(value: unknown): OpenCodeWakeSupervisorStatus | undefined {
  if (typeof value !== "string") return undefined
  if (["healthy", "watch", "needs_report", "needs_commander_answer", "guidance_pending_delivery", "human_attention", "human_paused", "stop_requested", "blocked", "stale", "timed_out", "unknown"].includes(value)) return value as OpenCodeWakeSupervisorStatus
  return undefined
}

function readRecommendedAction(value: unknown): OpenCodeWakeSupervisorRecommendedAction | undefined {
  if (typeof value !== "string") return undefined
  if (["none", "read_latest_progress", "record_watchdog", "request_forced_report", "create_commander_question", "answer_commander_question", "deliver_guidance", "review_human_control", "escalate_to_human", "prepare_result_review", "unknown"].includes(value)) return value as OpenCodeWakeSupervisorRecommendedAction
  return undefined
}

function compareSequencedDesc(a: SequencedExecutionRecord, b: SequencedExecutionRecord): number {
  return b.event_index - a.event_index
}

function positiveInteger(value: unknown, fallback: number | undefined, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback ?? 0
  return Math.max(1, Math.min(Math.floor(value), max))
}

function optionalPositiveInteger(value: unknown, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  return Math.max(1, Math.min(Math.floor(value), max))
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? bound(value.trim()) : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const lower = value.toLowerCase()
    if (lower === "true") return true
    if (lower === "false") return false
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
