import { createHash } from "node:crypto"
import type { RuntimeRestoreService } from "../checkpoints/runtime-restore-service"
import type { RuntimeCheckpoint, RuntimeCheckpointSections } from "../checkpoints/runtime-checkpoint-types"
import type { RuntimeRestorePreview, RuntimeResumeAnchor } from "../checkpoints/runtime-restore-types"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type {
  WakeAssessment,
  WakeAssessmentInput,
  WakeAssessmentPreview,
  WakeAssessmentRecord,
  WakeAssessmentSections,
  WakeCommanderSection,
  WakeExecutorSection,
  WakeHandoffSection,
  WakeReasoningSection,
  WakeSuggestedCommand,
  WakeTriggerKind,
} from "./wake-hook-types"

const DEFAULT_MAX_BYTES = 64 * 1024
const HARD_MAX_BYTES = 256 * 1024
const MIN_MAX_BYTES = 2048
const MAX_ITEMS = 20
const MAX_STRING_CHARS = 1000
const PREVIEW_CHARS = 360
const APPEND_EVENT_ID_PLACEHOLDER = "rt_zzzzzzzzzz_zzzzzzzz"
const APPEND_TIMESTAMP_PLACEHOLDER = "9999-12-31T23:59:59.999Z"

type SectionProvider = () => Promise<RuntimeCheckpointSections> | RuntimeCheckpointSections

export interface WakeAssessmentServiceOptions {
  eventStore: EventStore
  restoreService: RuntimeRestoreService
  sectionProvider?: SectionProvider
  idFactory?: () => string
  now?: () => Date
}

type WakeAssessmentEvent = JsonlEvent & {
  kind: "runtime_wake_assessment_created"
  wake_assessment?: WakeAssessment
}

type RuntimeCheckpointEvent = JsonlEvent & {
  kind: "runtime_checkpoint_created"
  checkpoint?: RuntimeCheckpoint
}

type NormalizedWakeInput = {
  resume_id?: string
  checkpoint_id?: string
  trigger_kind: WakeTriggerKind
  requested_by: string
  max_bytes: number
  dry_run: boolean
}

export class WakeAssessmentService {
  private generatedIds = 0

  constructor(private readonly options: WakeAssessmentServiceOptions) {}

  async preview(input: WakeAssessmentInput): Promise<WakeAssessmentPreview> {
    const normalized = normalizeInput(input, false)
    return this.buildPreview(normalized)
  }

  async create(input: WakeAssessmentInput): Promise<WakeAssessment> {
    const normalized = normalizeInput(input, true)
    const preview = await this.buildPreview(normalized)
    if (!normalized.resume_id) throw new Error("resume_id is required for wake assessment creation")
    if (!preview.allowed) throw new Error(preview.blockers[0] ?? "wake assessment is blocked")
    const anchor = await this.options.restoreService.get(normalized.resume_id)
    const createdAt = (this.options.now ?? (() => new Date()))().toISOString()
    const wakeId = normalized.dry_run ? "wake_dry_run" : this.options.idFactory ? this.options.idFactory() : `wake_${Date.now().toString(36)}_${++this.generatedIds}`
    const assessment = fitAssessment({
      wake_id: wakeId,
      trigger_kind: normalized.trigger_kind,
      resume_id: normalized.resume_id,
      checkpoint_id: preview.checkpoint_id,
      checkpoint_hash: anchor?.checkpoint_hash,
      created_at: createdAt,
      requested_by: redactText(normalized.requested_by),
      dry_run: normalized.dry_run ? true : undefined,
      allowed: preview.allowed,
      blockers: preview.blockers,
      warnings: preview.warnings,
      drift_status: preview.drift_status,
      current_event_count: preview.current_event_count,
      checkpoint_event_count: preview.checkpoint_event_count,
      new_event_count: preview.new_event_count,
      sections: await this.sectionsForPreview(preview, anchor),
      suggested_commands: preview.suggested_commands,
    }, normalized.max_bytes)
    if (normalized.dry_run) return redactValue(assessment)
    const eventPayload = eventPayloadFromAssessment(assessment)
    if (persistedEventByteLength(eventPayload) > normalized.max_bytes) throw new Error("runtime wake assessment event exceeds max_bytes")
    await this.options.eventStore.append(eventPayload)
    return redactValue(assessment)
  }

  async get(wakeId: string): Promise<WakeAssessment | null> {
    const id = cleanString(wakeId, "wake_id")
    return redactValue((await this.assessments()).find((assessment) => assessment.wake_id === id) ?? null)
  }

  async list(limit = 20): Promise<WakeAssessmentRecord[]> {
    const cleanLimit = readLimit(limit)
    return redactValue((await this.assessments()).slice().reverse().slice(0, cleanLimit).map(recordFromAssessment))
  }

  private async buildPreview(input: NormalizedWakeInput): Promise<WakeAssessmentPreview> {
    const events = await this.options.eventStore.readAll()
    const blockers: string[] = []
    const warnings: string[] = []
    let anchor: RuntimeResumeAnchor | null = null
    let checkpointId = input.checkpoint_id
    if (input.trigger_kind !== "manual") blockers.push("wake assessment trigger_kind currently supports manual only")
    if (input.resume_id) {
      anchor = await this.options.restoreService.get(input.resume_id)
      if (!anchor) blockers.push("runtime resume anchor not found")
      checkpointId = anchor?.checkpoint_id ?? checkpointId
    } else if (checkpointId) {
      warnings.push("wake preview is using an unanchored checkpoint; create requires resume_id")
    } else {
      blockers.push("resume_id or checkpoint_id is required")
    }

    let restorePreview: RuntimeRestorePreview | null = null
    if (checkpointId) {
      try {
        restorePreview = await this.options.restoreService.preview({ checkpoint_id: checkpointId })
      } catch (error) {
        blockers.push(error instanceof Error ? error.message : String(error))
      }
    }
    if (restorePreview) {
      blockers.push(...restorePreview.verification.blockers)
      warnings.push(...restorePreview.verification.warnings)
      if (!restorePreview.verification.hash_ok) blockers.push("runtime checkpoint hash verification failed")
      if (restorePreview.verification.drift_status === "forked") blockers.push("runtime checkpoint event cursor is forked")
      if (restorePreview.verification.drift_status === "advanced") warnings.push("new events exist after checkpoint")
    }
    const currentCheckpointHash = checkpointId ? await this.currentCheckpointHash(checkpointId) : undefined
    if (anchor && currentCheckpointHash && anchor.checkpoint_hash !== currentCheckpointHash) {
      blockers.push("runtime resume anchor checkpoint hash does not match current checkpoint")
    }
    const currentSections = await this.currentSections()
    const sections = sectionSummaries(restorePreview, currentSections)
    const suggested = suggestedCommands(input.resume_id, checkpointId, restorePreview, sections)
    const uniqueBlockers = unique(blockers)
    const uniqueWarnings = unique(warnings)
    const allowed = uniqueBlockers.length === 0
    return redactValue({
      trigger_kind: input.trigger_kind,
      resume_id: input.resume_id,
      checkpoint_id: checkpointId,
      allowed,
      blockers: uniqueBlockers,
      warnings: uniqueWarnings,
      drift_status: restorePreview?.verification.drift_status,
      current_event_count: restorePreview?.verification.current_event_count ?? events.length,
      checkpoint_event_count: restorePreview?.verification.event_count_at_checkpoint,
      new_event_count: restorePreview?.verification.new_event_count,
      reasoning_health_status: sections.reasoning?.health_status,
      handoff_summary: sections.handoff?.followup_summary,
      commander_summary: sections.commander?.queue_summary,
      executor_summary: sections.executor ? { active_mission_count: sections.executor.active_mission_ids.length, mission_count: sections.executor.mission_ids.length } : undefined,
      suggested_commands: suggested,
      redacted_summary_preview: previewText(stableStringify({
        resume_id: input.resume_id,
        checkpoint_id: checkpointId,
        allowed,
        drift_status: restorePreview?.verification.drift_status,
        blockers: uniqueBlockers,
        warnings: uniqueWarnings,
      })),
    })
  }

  private async sectionsForPreview(preview: WakeAssessmentPreview, anchor: RuntimeResumeAnchor | null): Promise<WakeAssessmentSections> {
    const restore = preview.checkpoint_id ? await this.options.restoreService.preview({ checkpoint_id: preview.checkpoint_id }) : null
    const sections = sectionSummaries(restore, await this.currentSections())
    return sanitizeSections({
      resume: {
        resume_id: anchor?.resume_id,
        checkpoint_id: anchor?.checkpoint_id ?? preview.checkpoint_id,
        checkpoint_hash: anchor?.checkpoint_hash,
        marked_at: anchor?.marked_at,
        drift_status: anchor?.drift_status,
        warnings: anchor ? [] : ["wake assessment has no resume anchor"],
      },
      checkpoint: {
        checkpoint_id: preview.checkpoint_id,
        checkpoint_hash: anchor?.checkpoint_hash,
        verification: restore?.verification,
        warnings: restore?.verification.warnings ?? [],
      },
      commander: sections.commander,
      executor: sections.executor,
      handoff: sections.handoff,
      reasoning: sections.reasoning,
    })
  }

  private async currentSections(): Promise<RuntimeCheckpointSections | undefined> {
    return this.options.sectionProvider ? redactValue(await this.options.sectionProvider()) : undefined
  }

  private async assessments(): Promise<WakeAssessment[]> {
    const out: WakeAssessment[] = []
    for (const event of await this.options.eventStore.readAll()) {
      if (event.kind !== "runtime_wake_assessment_created") continue
      const assessment = readAssessmentEvent(event as WakeAssessmentEvent)
      if (assessment) out.push(assessment)
    }
    return out
  }

  private async currentCheckpointHash(checkpointId: string): Promise<string | undefined> {
    for (const event of await this.options.eventStore.readAll()) {
      if (event.kind !== "runtime_checkpoint_created") continue
      const checkpoint = readCheckpointEvent(event as RuntimeCheckpointEvent)
      if (checkpoint?.checkpoint_id === checkpointId) return checkpoint.checkpoint_hash
    }
    return undefined
  }
}

function eventPayloadFromAssessment(assessment: WakeAssessment): JsonlEvent {
  return {
    kind: "runtime_wake_assessment_created",
    wake_id: assessment.wake_id,
    trigger_kind: assessment.trigger_kind,
    resume_id: assessment.resume_id,
    checkpoint_id: assessment.checkpoint_id,
    checkpoint_hash: assessment.checkpoint_hash,
    created_at: assessment.created_at,
    requested_by: assessment.requested_by,
    dry_run: assessment.dry_run,
    allowed: assessment.allowed,
    blockers: assessment.blockers,
    warnings: assessment.warnings,
    drift_status: assessment.drift_status,
    current_event_count: assessment.current_event_count,
    checkpoint_event_count: assessment.checkpoint_event_count,
    new_event_count: assessment.new_event_count,
    sections: assessment.sections,
    suggested_commands: assessment.suggested_commands,
    assessment_hash: assessment.assessment_hash,
  }
}

function sectionSummaries(restore: RuntimeRestorePreview | null, currentSections: RuntimeCheckpointSections | undefined): WakeAssessmentSections {
  const hasCurrent = currentSections !== undefined
  return sanitizeSections({
    commander: hasCurrent ? commanderSection(currentSections) : restore?.commander_context,
    executor: hasCurrent ? executorSection(currentSections) : restore?.executor_context,
    handoff: hasCurrent ? handoffSection(currentSections) : restore?.handoff_context,
    reasoning: hasCurrent ? reasoningSection(currentSections) : restore?.reasoning_context,
    checkpoint: restore ? { checkpoint_id: restore.checkpoint_id, verification: restore.verification, warnings: restore.verification.warnings } : undefined,
  })
}

function commanderSection(sections: RuntimeCheckpointSections | undefined): WakeCommanderSection {
  const commander = recordSection(sections?.commander)
  return {
    recent_cycle_ids: idsFrom(commander.recent_cycles, "cycle_id"),
    recent_synthesis_ids: idsFrom(commander.recent_syntheses, "synthesis_id"),
    proposal_ids: idsFrom(commander.recent_proposals, "proposal_id"),
    review_ids: idsFrom(commander.reviews, "last_review_id"),
    bundle_ids: idsFrom(commander.recent_bundles, "bundle_id"),
    queue_summary: recordSection(commander.queues),
    warnings: [],
  }
}

function executorSection(sections: RuntimeCheckpointSections | undefined): WakeExecutorSection {
  const executor = recordSection(sections?.executor)
  const recent = Array.isArray(executor.recent_missions) ? executor.recent_missions : []
  const details = Array.isArray(executor.recent_mission_details) ? executor.recent_mission_details : []
  return {
    mission_ids: idsFrom(recent, "mission_id"),
    active_mission_ids: recent.filter((item) => isRecord(item) && item.status !== "completed" && item.status !== "failed" && item.status !== "cancelled").map((item) => redactText(String(item.mission_id))).slice(0, MAX_ITEMS),
    active_claim_ids: idsFrom(details.flatMap((item) => isRecord(item) && Array.isArray(item.claims) ? item.claims : []), "claim_id"),
    result_ids: idsFrom(details.flatMap((item) => isRecord(item) && Array.isArray(item.results) ? item.results : []), "result_id"),
    progress_ids: idsFrom(details.flatMap((item) => isRecord(item) && Array.isArray(item.progress) ? item.progress : []), "progress_id"),
    warnings: [],
  }
}

function handoffSection(sections: RuntimeCheckpointSections | undefined): WakeHandoffSection {
  const handoff = recordSection(sections?.handoff)
  const active = recordSection(handoff.active_queue)
  const needsReview = recordSection(handoff.needs_result_review_queue)
  const failed = recordSection(handoff.failed_queue)
  return {
    handoff_ids: idsFrom(handoff.recent_handoffs, "handoff_id"),
    active_handoff_ids: idsFrom(active.items, "handoff_id"),
    needs_result_review_ids: idsFrom(needsReview.items, "handoff_id"),
    failed_handoff_ids: idsFrom(failed.items, "handoff_id"),
    followup_summary: recordSection(handoff.followup_summary),
    warnings: [],
  }
}

function reasoningSection(sections: RuntimeCheckpointSections | undefined): WakeReasoningSection {
  const reasoning = recordSection(sections?.reasoning)
  const status = recordSection(reasoning.status)
  const health = recordSection(reasoning.health)
  return {
    provider_id: stringField(status.provider_id),
    provider_kind: stringField(status.kind),
    health_status: stringField(health.status),
    warnings: [],
  }
}

function suggestedCommands(resumeId: string | undefined, checkpointId: string | undefined, restore: RuntimeRestorePreview | null, sections: WakeAssessmentSections): WakeSuggestedCommand[] {
  const commands: WakeSuggestedCommand[] = []
  if (resumeId) commands.push({ label: "Show resume anchor", command: `/resume-anchor ${resumeId}`, command_type: "read" })
  if (checkpointId) commands.push({ label: "Preview restore", command: `/restore-preview ${checkpointId}`, command_type: "read" })
  commands.push(
    { label: "Open handoff follow-ups", command: "/handoff-followups", command_type: "read" },
    { label: "Open active handoffs", command: "/handoff-active", command_type: "read" },
    { label: "Open handoff results", command: "/handoff-results", command_type: "read" },
    { label: "Open commander queues", command: "/queues", command_type: "read" },
    { label: "List cycles", command: "/cycles", command_type: "read" },
    { label: "List syntheses", command: "/syntheses", command_type: "read" },
    { label: "Reasoning status", command: "/reasoning", command_type: "read" },
    { label: "Create follow-up checkpoint", command: "/checkpoint full wake follow-up", command_type: "write", requires_active_runtime: true },
  )
  for (const handoffId of sections.handoff?.active_handoff_ids ?? []) {
    commands.push({ label: "Show active handoff", command: `/handoff-followup ${handoffId}`, command_type: "read" })
  }
  if (restore?.suggested_commands) {
    for (const command of restore.suggested_commands) {
      if (command.command_type === "read") commands.push(command)
    }
  }
  return dedupeCommands(commands).slice(0, MAX_ITEMS)
}

function fitAssessment(input: Omit<WakeAssessment, "assessment_hash">, maxBytes: number): WakeAssessment {
  let assessment = finalizeAssessment(input)
  if (persistedEventByteLength(eventPayloadFromAssessment(assessment)) <= maxBytes) return redactValue(assessment)
  const warnings = unique([...input.warnings, `wake assessment truncated to fit max_bytes=${maxBytes}`])
  const truncated = finalizeAssessment({ ...input, warnings, sections: truncateSections(input.sections, 5), suggested_commands: input.suggested_commands.slice(0, 8) })
  if (persistedEventByteLength(eventPayloadFromAssessment(truncated)) <= maxBytes) return redactValue(truncated)
  const minimal = finalizeAssessment({
    ...input,
    warnings: unique([...warnings, "wake assessment sections reduced to minimal summaries"]),
    sections: {
      resume: input.sections.resume,
      checkpoint: input.sections.checkpoint,
      reasoning: input.sections.reasoning,
    },
    suggested_commands: input.suggested_commands.slice(0, 4),
  })
  if (persistedEventByteLength(eventPayloadFromAssessment(minimal)) <= maxBytes) return redactValue(minimal)
  throw new Error("minimal wake assessment exceeds max_bytes")
}

function finalizeAssessment(input: Omit<WakeAssessment, "assessment_hash">): WakeAssessment {
  return { ...input, assessment_hash: sha256(stableStringify(input)) }
}

function recordFromAssessment(assessment: WakeAssessment): WakeAssessmentRecord {
  return {
    wake_id: assessment.wake_id,
    trigger_kind: assessment.trigger_kind,
    resume_id: assessment.resume_id,
    checkpoint_id: assessment.checkpoint_id,
    allowed: assessment.allowed,
    drift_status: assessment.drift_status,
    created_at: assessment.created_at,
    requested_by: assessment.requested_by,
    summary_preview: previewText(stableStringify({
      wake_id: assessment.wake_id,
      resume_id: assessment.resume_id,
      checkpoint_id: assessment.checkpoint_id,
      allowed: assessment.allowed,
      drift_status: assessment.drift_status,
      blockers: assessment.blockers,
    })),
    assessment_hash: assessment.assessment_hash,
  }
}

function readAssessmentEvent(event: WakeAssessmentEvent): WakeAssessment | null {
  if (isRecord(event.wake_assessment) && typeof event.wake_assessment.wake_id === "string") return redactValue(event.wake_assessment as WakeAssessment)
  if (typeof event.wake_id !== "string") return null
  const {
    kind: _kind,
    event_id: _eventId,
    timestamp: _timestamp,
    ...assessment
  } = event
  return redactValue(assessment as WakeAssessment)
}

function readCheckpointEvent(event: RuntimeCheckpointEvent): RuntimeCheckpoint | null {
  if (!isRecord(event.checkpoint) || typeof event.checkpoint.checkpoint_id !== "string" || typeof event.checkpoint.checkpoint_hash !== "string") return null
  return event.checkpoint as RuntimeCheckpoint
}

export function readWakeAssessmentInput(payload: Record<string, unknown>): WakeAssessmentInput {
  return {
    resume_id: optionalString(payload.resumeId ?? payload.resume_id, "resumeId"),
    checkpoint_id: optionalString(payload.checkpointId ?? payload.checkpoint_id, "checkpointId"),
    trigger_kind: payload.triggerKind !== undefined || payload.trigger_kind !== undefined ? readTriggerKind(payload.triggerKind ?? payload.trigger_kind) : undefined,
    requested_by: optionalString(payload.requestedBy ?? payload.requested_by, "requestedBy"),
    max_bytes: optionalPositiveInteger(payload.maxBytes ?? payload.max_bytes, "maxBytes", HARD_MAX_BYTES),
    dry_run: optionalBoolean(payload.dryRun ?? payload.dry_run, "dryRun"),
  }
}

function normalizeInput(input: WakeAssessmentInput, requireResume: boolean): NormalizedWakeInput {
  const resumeId = input.resume_id ?? input.resumeId
  const checkpointId = input.checkpoint_id ?? input.checkpointId
  const trigger = input.trigger_kind ?? input.triggerKind ?? "manual"
  if (trigger !== "manual" && trigger !== "startup_preview" && trigger !== "external_signal") throw new Error("wake assessment trigger_kind is invalid")
  if (requireResume && !resumeId) throw new Error("resume_id is required for wake assessment creation")
  if (resumeId && checkpointId) throw new Error("wake assessment accepts resume_id or checkpoint_id, not both")
  return {
    resume_id: resumeId ? cleanString(resumeId, "resume_id") : undefined,
    checkpoint_id: checkpointId ? cleanString(checkpointId, "checkpoint_id") : undefined,
    trigger_kind: trigger,
    requested_by: boundedText(cleanString(input.requested_by ?? input.requestedBy ?? "operator", "requested_by"), 128),
    max_bytes: readMaxBytes(input.max_bytes ?? input.maxBytes),
    dry_run: input.dry_run === true || input.dryRun === true,
  }
}

function readTriggerKind(value: unknown): WakeTriggerKind {
  if (value === "manual" || value === "startup_preview" || value === "external_signal") return value
  throw new Error("wake assessment trigger_kind is invalid")
}

function readMaxBytes(value: unknown): number {
  if (value === undefined) return DEFAULT_MAX_BYTES
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error("max_bytes must be a positive integer")
  if (Number(value) < MIN_MAX_BYTES) throw new Error(`max_bytes must be at least ${MIN_MAX_BYTES}`)
  if (Number(value) > HARD_MAX_BYTES) throw new Error(`max_bytes must be no greater than ${HARD_MAX_BYTES}`)
  return Number(value)
}

function readLimit(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error("wake assessment list limit must be a positive integer")
  return Math.min(Number(value), 100)
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${field} must be a string`)
  if (!value.trim()) throw new Error(`${field} must be nonblank`)
  return value.trim()
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`)
  return value
}

function optionalPositiveInteger(value: unknown, field: string, max: number): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${field} must be a positive integer`)
  if (Number(value) > max) throw new Error(`${field} must be no greater than ${max}`)
  return Number(value)
}

function sanitizeSections(sections: WakeAssessmentSections): WakeAssessmentSections {
  return redactValue(sanitizeValue(sections, MAX_ITEMS) as WakeAssessmentSections)
}

function truncateSections(sections: WakeAssessmentSections, limit: number): WakeAssessmentSections {
  return redactValue(sanitizeValue(sections, limit) as WakeAssessmentSections)
}

function sanitizeValue(value: unknown, arrayLimit: number): unknown {
  if (typeof value === "string") return boundedText(redactText(value), MAX_STRING_CHARS)
  if (typeof value !== "object" || value === null) return value
  if (Array.isArray(value)) return value.slice(0, arrayLimit).map((item) => sanitizeValue(item, arrayLimit))
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value).slice(0, 80)) out[redactText(key)] = sanitizeValue(item, arrayLimit)
  return out
}

function dedupeCommands(commands: WakeSuggestedCommand[]): WakeSuggestedCommand[] {
  const seen = new Set<string>()
  return commands.filter((command) => {
    if (seen.has(command.command)) return false
    seen.add(command.command)
    return true
  })
}

function recordSection(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function idsFrom(value: unknown, field: string): string[] {
  const values = Array.isArray(value) ? value : isRecord(value) ? [value] : []
  return values.flatMap((item) => isRecord(item) && typeof item[field] === "string" ? [redactText(item[field])] : []).slice(0, MAX_ITEMS)
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? redactText(value) : undefined
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => redactText(value)).filter(Boolean))]
}

function cleanString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function boundedText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 15))}... [truncated]`
}

function previewText(value: string): string {
  return boundedText(redactText(value).replace(/\s+/g, " "), PREVIEW_CHARS)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8")
}

function persistedEventByteLength(payload: JsonlEvent): number {
  const safePayload = redactValue({
    ...payload,
    event_id: payload.event_id ?? APPEND_EVENT_ID_PLACEHOLDER,
    timestamp: payload.timestamp ?? APPEND_TIMESTAMP_PLACEHOLDER,
  })
  return byteLength(stableStringify(safePayload)) + 1
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) out[key] = sortValue(value[key])
  return out
}
