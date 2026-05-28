import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { RuntimeCheckpoint, RuntimeCheckpointSections } from "./runtime-checkpoint-types"
import type {
  RuntimeCheckpointDriftStatus,
  RuntimeCheckpointVerification,
  RuntimeRestoreCommanderContext,
  RuntimeRestoreExecutorContext,
  RuntimeRestoreHandoffContext,
  RuntimeRestoreInput,
  RuntimeRestorePreview,
  RuntimeRestoreReasoningContext,
  RuntimeRestoreSuggestedCommand,
  RuntimeResumeAnchor,
} from "./runtime-restore-types"

const PREVIEW_CHARS = 360
const MAX_IDS = 20

type SectionProvider = () => Promise<RuntimeCheckpointSections> | RuntimeCheckpointSections

export interface RuntimeRestoreServiceOptions {
  eventStore: EventStore
  sectionProvider?: SectionProvider
  idFactory?: () => string
  now?: () => Date
}

type CheckpointEvent = JsonlEvent & {
  kind: "runtime_checkpoint_created"
  checkpoint?: RuntimeCheckpoint
}

type ResumeAnchorEvent = JsonlEvent & {
  kind: "runtime_resume_anchor_marked"
  resume_anchor?: RuntimeResumeAnchor
}

export class RuntimeRestoreService {
  private generatedIds = 0

  constructor(private readonly options: RuntimeRestoreServiceOptions) {}

  async preview(input: RuntimeRestoreInput): Promise<RuntimeRestorePreview> {
    const checkpointId = readCheckpointId(input)
    const events = await this.options.eventStore.readAll()
    const checkpoint = findCheckpoint(events, checkpointId)
    const verification = verifyCheckpoint(events, checkpointId, checkpoint)
    const currentSections = await this.currentSections().catch(() => undefined)
    const sections = checkpoint?.sections ?? currentSections ?? {}
    const commander = commanderContext(sections)
    const executor = executorContext(sections)
    const handoff = handoffContext(sections)
    const reasoning = reasoningContext(sections)
    const suggested = suggestedCommands(checkpointId, verification, checkpoint)
    const canMark = verification.exists && verification.hash_ok && verification.cursor_ok && verification.drift_status !== "forked"
    return redactValue({
      checkpoint_id: checkpointId,
      can_mark_resume: canMark,
      verification,
      commander_context: commander,
      executor_context: executor,
      handoff_context: handoff,
      reasoning_context: reasoning,
      suggested_commands: suggested,
      redacted_summary_preview: previewText(stableStringify({
        checkpoint_id: checkpointId,
        can_mark_resume: canMark,
        drift_status: verification.drift_status,
        commander,
        executor,
        handoff,
      })),
      created_at: (this.options.now ?? (() => new Date()))().toISOString(),
    })
  }

  async mark(input: RuntimeRestoreInput): Promise<RuntimeResumeAnchor> {
    const markedBy = boundedText(cleanString(input.marked_by ?? input.markedBy ?? input.requested_by ?? input.requestedBy ?? "operator", "marked_by"), 128)
    const preview = await this.preview(input)
    if (!preview.verification.exists) throw new Error("runtime checkpoint not found")
    if (!preview.verification.hash_ok) throw new Error("runtime checkpoint hash verification failed")
    if (preview.verification.drift_status === "forked") throw new Error("runtime checkpoint event cursor is forked")
    if (!preview.can_mark_resume) throw new Error("runtime checkpoint cannot be marked for resume")
    const resumeId = this.options.idFactory ? this.options.idFactory() : `resume_${Date.now().toString(36)}_${++this.generatedIds}`
    const anchor: RuntimeResumeAnchor = {
      resume_id: resumeId,
      checkpoint_id: preview.checkpoint_id,
      checkpoint_hash: findCheckpoint(await this.options.eventStore.readAll(), preview.checkpoint_id)?.checkpoint_hash ?? "",
      marked_at: (this.options.now ?? (() => new Date()))().toISOString(),
      marked_by: redactText(markedBy),
      event_count_at_checkpoint: preview.verification.event_count_at_checkpoint,
      current_event_count: preview.verification.current_event_count,
      checkpoint_last_event_id: preview.verification.checkpoint_last_event_id,
      current_last_event_id: preview.verification.current_last_event_id,
      drift_status: preview.verification.drift_status,
      summary_preview: preview.redacted_summary_preview,
    }
    await this.options.eventStore.append({
      kind: "runtime_resume_anchor_marked",
      resume_id: anchor.resume_id,
      checkpoint_id: anchor.checkpoint_id,
      checkpoint_hash: anchor.checkpoint_hash,
      marked_at: anchor.marked_at,
      marked_by: anchor.marked_by,
      event_count_at_checkpoint: anchor.event_count_at_checkpoint,
      current_event_count: anchor.current_event_count,
      checkpoint_last_event_id: anchor.checkpoint_last_event_id,
      current_last_event_id: anchor.current_last_event_id,
      drift_status: anchor.drift_status,
      summary_preview: anchor.summary_preview,
      resume_anchor: anchor,
    })
    return redactValue(anchor)
  }

  async get(resumeId: string): Promise<RuntimeResumeAnchor | null> {
    const id = cleanString(resumeId, "resume_id")
    return redactValue((await this.anchors()).find((anchor) => anchor.resume_id === id) ?? null)
  }

  async list(limit = 20): Promise<RuntimeResumeAnchor[]> {
    const cleanLimit = readLimit(limit)
    return redactValue((await this.anchors()).slice().reverse().slice(0, cleanLimit))
  }

  private async anchors(): Promise<RuntimeResumeAnchor[]> {
    const anchors: RuntimeResumeAnchor[] = []
    for (const event of await this.options.eventStore.readAll()) {
      if (event.kind !== "runtime_resume_anchor_marked") continue
      const anchor = readAnchorEvent(event as ResumeAnchorEvent)
      if (anchor) anchors.push(anchor)
    }
    return anchors
  }

  private async currentSections(): Promise<RuntimeCheckpointSections | undefined> {
    return this.options.sectionProvider ? redactValue(await this.options.sectionProvider()) : undefined
  }
}

function verifyCheckpoint(events: JsonlEvent[], checkpointId: string, checkpoint: RuntimeCheckpoint | null): RuntimeCheckpointVerification {
  if (!checkpoint) {
    return {
      checkpoint_id: checkpointId,
      exists: false,
      hash_ok: false,
      cursor_ok: false,
      event_count_at_checkpoint: 0,
      current_event_count: events.length,
      current_last_event_id: latestEventId(events),
      new_event_count: events.length,
      drift_status: "unknown",
      blockers: ["runtime checkpoint not found"],
      warnings: [],
    }
  }
  const warnings = checkpoint.restore_supported === false ? ["checkpoint restore is preview-only; full restore is not implemented"] : []
  const expectedHash = checkpointHash(checkpoint)
  const hashOk = expectedHash === checkpoint.checkpoint_hash
  const eventCount = Number.isInteger(checkpoint.event_count) ? checkpoint.event_count : 0
  const currentCount = events.length
  const cursor = reconcileCursor(events, eventCount, checkpoint.last_event_id)
  const blockers: string[] = []
  if (!hashOk) blockers.push("runtime checkpoint hash verification failed")
  if (!cursor.cursor_ok) blockers.push("runtime checkpoint event cursor is not available")
  if (cursor.drift_status === "forked") blockers.push("runtime checkpoint event cursor is forked")
  return {
    checkpoint_id: checkpoint.checkpoint_id,
    exists: true,
    hash_ok: hashOk,
    cursor_ok: cursor.cursor_ok,
    event_count_at_checkpoint: eventCount,
    current_event_count: currentCount,
    checkpoint_last_event_id: checkpoint.last_event_id,
    current_last_event_id: latestEventId(events),
    new_event_count: Math.max(0, currentCount - eventCount),
    drift_status: cursor.drift_status,
    blockers,
    warnings: [...warnings, ...cursor.warnings],
  }
}

function reconcileCursor(events: JsonlEvent[], eventCount: number, lastEventId: string | undefined): { cursor_ok: boolean; drift_status: RuntimeCheckpointDriftStatus; warnings: string[] } {
  if (eventCount > events.length) return { cursor_ok: false, drift_status: "forked", warnings: [] }
  if (eventCount === 0 && !lastEventId) return { cursor_ok: true, drift_status: events.length === 0 ? "none" : "advanced", warnings: events.length === 0 ? [] : ["new events exist after checkpoint"] }
  if (!lastEventId) return { cursor_ok: true, drift_status: "unknown", warnings: ["checkpoint has no last event id"] }
  const expected = events[eventCount - 1]?.event_id
  if (expected === lastEventId) return { cursor_ok: true, drift_status: eventCount === events.length ? "none" : "advanced", warnings: eventCount === events.length ? [] : ["new events exist after checkpoint"] }
  const found = events.findIndex((event) => event.event_id === lastEventId)
  if (found >= 0) return { cursor_ok: true, drift_status: "advanced", warnings: ["checkpoint cursor moved but last event id is traceable"] }
  return { cursor_ok: false, drift_status: "forked", warnings: [] }
}

function commanderContext(sections: RuntimeCheckpointSections): RuntimeRestoreCommanderContext {
  const commander = recordSection(sections.commander)
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

function executorContext(sections: RuntimeCheckpointSections): RuntimeRestoreExecutorContext {
  const executor = recordSection(sections.executor)
  const recent = Array.isArray(executor.recent_missions) ? executor.recent_missions : []
  const details = Array.isArray(executor.recent_mission_details) ? executor.recent_mission_details : []
  return {
    mission_ids: idsFrom(recent, "mission_id"),
    active_mission_ids: recent.filter((item) => isRecord(item) && item.status !== "completed" && item.status !== "failed" && item.status !== "cancelled").map((item) => String((item as Record<string, unknown>).mission_id)).slice(0, MAX_IDS),
    active_claim_ids: idsFrom(details.flatMap((item) => isRecord(item) && Array.isArray(item.claims) ? item.claims : []), "claim_id"),
    result_ids: idsFrom(details.flatMap((item) => isRecord(item) && Array.isArray(item.results) ? item.results : []), "result_id"),
    progress_ids: idsFrom(details.flatMap((item) => isRecord(item) && Array.isArray(item.progress) ? item.progress : []), "progress_id"),
    warnings: [],
  }
}

function handoffContext(sections: RuntimeCheckpointSections): RuntimeRestoreHandoffContext {
  const handoff = recordSection(sections.handoff)
  const active = recordSection(handoff.active_queue)
  const needsReview = recordSection(handoff.needs_result_review_queue)
  return {
    handoff_ids: idsFrom(handoff.recent_handoffs, "handoff_id"),
    active_handoff_ids: idsFrom(active.items, "handoff_id"),
    needs_result_review_ids: idsFrom(needsReview.items, "handoff_id"),
    failed_handoff_ids: [],
    warnings: [],
  }
}

function reasoningContext(sections: RuntimeCheckpointSections): RuntimeRestoreReasoningContext {
  const reasoning = recordSection(sections.reasoning)
  const status = recordSection(reasoning.status)
  const health = recordSection(reasoning.health)
  return {
    provider_id: stringField(status.provider_id),
    provider_kind: stringField(status.kind),
    health_status: stringField(health.status),
    warnings: [],
  }
}

function suggestedCommands(checkpointId: string, verification: RuntimeCheckpointVerification, checkpoint: RuntimeCheckpoint | null): RuntimeRestoreSuggestedCommand[] {
  const commands: RuntimeRestoreSuggestedCommand[] = [
    { label: "Show checkpoint", command: `/checkpoint-show ${checkpointId}`, command_type: "read" },
    { label: "Open handoff follow-ups", command: "/handoff-followups", command_type: "read" },
    { label: "List missions", command: "/missions", command_type: "read" },
    { label: "Open commander queues", command: "/queues", command_type: "read" },
    { label: "List cycles", command: "/cycles", command_type: "read" },
    { label: "List syntheses", command: "/syntheses", command_type: "read" },
    { label: "Reasoning status", command: "/reasoning", command_type: "read" },
  ]
  if (checkpoint && verification.exists && verification.hash_ok && verification.cursor_ok && verification.drift_status !== "forked") {
    commands.push({ label: "Mark resume anchor", command: `/resume-mark ${checkpointId}`, command_type: "write", requires_active_runtime: true })
  }
  return commands
}

function findCheckpoint(events: JsonlEvent[], checkpointId: string): RuntimeCheckpoint | null {
  for (const event of events) {
    if (event.kind !== "runtime_checkpoint_created") continue
    const checkpoint = readCheckpointEvent(event as CheckpointEvent)
    if (checkpoint?.checkpoint_id === checkpointId) return checkpoint
  }
  return null
}

function checkpointHash(checkpoint: RuntimeCheckpoint): string {
  const { checkpoint_hash: _hash, ...payload } = checkpoint
  return sha256(stableStringify(payload))
}

function readCheckpointEvent(event: CheckpointEvent): RuntimeCheckpoint | null {
  if (!isRecord(event.checkpoint) || typeof event.checkpoint.checkpoint_id !== "string") return null
  return event.checkpoint as RuntimeCheckpoint
}

function readAnchorEvent(event: ResumeAnchorEvent): RuntimeResumeAnchor | null {
  if (!isRecord(event.resume_anchor) || typeof event.resume_anchor.resume_id !== "string") return null
  return redactValue(event.resume_anchor as RuntimeResumeAnchor)
}

function readCheckpointId(input: RuntimeRestoreInput): string {
  return cleanString(input.checkpoint_id ?? input.checkpointId, "checkpoint_id")
}

function readLimit(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error("resume anchor list limit must be a positive integer")
  return Math.min(Number(value), 100)
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

function latestEventId(events: JsonlEvent[]): string | undefined {
  const last = events.at(-1)
  return typeof last?.event_id === "string" ? last.event_id : undefined
}

function idsFrom(value: unknown, field: string): string[] {
  const values = Array.isArray(value) ? value : isRecord(value) ? [value] : []
  return values.flatMap((item) => isRecord(item) && typeof item[field] === "string" ? [redactText(item[field])] : []).slice(0, MAX_IDS)
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? redactText(value) : undefined
}

function recordSection(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
