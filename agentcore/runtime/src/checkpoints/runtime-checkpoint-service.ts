import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type {
  RuntimeCheckpoint,
  RuntimeCheckpointInput,
  RuntimeCheckpointPreview,
  RuntimeCheckpointRecord,
  RuntimeCheckpointScope,
  RuntimeCheckpointSectionSummary,
  RuntimeCheckpointSections,
  RuntimeCheckpointSuggestedCommand,
} from "./runtime-checkpoint-types"

const DEFAULT_MAX_BYTES = 64 * 1024
const HARD_MAX_BYTES = 256 * 1024
const MIN_MAX_BYTES = 2048
const PREVIEW_CHARS = 360
const MAX_REASON_CHARS = 500
const MAX_STRING_CHARS = 1000
const MAX_ARRAY_ITEMS = 20

type SectionProvider = () => Promise<RuntimeCheckpointSections> | RuntimeCheckpointSections

export interface RuntimeCheckpointServiceOptions {
  eventStore: EventStore
  sectionProvider: SectionProvider
  idFactory?: () => string
  now?: () => Date
}

type RuntimeCheckpointEvent = JsonlEvent & {
  kind: "runtime_checkpoint_created"
  checkpoint?: RuntimeCheckpoint
}

export class RuntimeCheckpointService {
  private generatedIds = 0

  constructor(private readonly options: RuntimeCheckpointServiceOptions) {}

  async preview(input: RuntimeCheckpointInput = {}): Promise<RuntimeCheckpointPreview> {
    const normalized = normalizeInput(input)
    const events = await this.options.eventStore.readAll()
    const sections = await this.buildSections(normalized.scope)
    const sectionSummaries = summarizeSections(sections)
    const payload = {
      scope: normalized.scope,
      reason: normalized.reason,
      event_count: events.length,
      last_event_id: latestEventId(events),
      sections,
      restore_supported: false,
    }
    const estimatedBytes = byteLength(stableStringify(payload))
    return redactValue({
      scope: normalized.scope,
      reason: normalized.reason,
      event_count: events.length,
      last_event_id: latestEventId(events),
      sections: sectionSummaries,
      estimated_bytes: estimatedBytes,
      max_bytes: normalized.max_bytes,
      blockers: [],
      redacted_summary_preview: previewText(stableStringify(summaryPayload(payload))),
    })
  }

  async create(input: RuntimeCheckpointInput = {}): Promise<RuntimeCheckpoint> {
    const normalized = normalizeInput(input)
    const checkpoint = await this.buildCheckpoint(normalized)
    await this.options.eventStore.append({
      kind: "runtime_checkpoint_created",
      checkpoint_id: checkpoint.checkpoint_id,
      scope: checkpoint.scope,
      reason: checkpoint.reason,
      created_at: checkpoint.created_at,
      created_by: checkpoint.created_by,
      event_count: checkpoint.event_count,
      last_event_id: checkpoint.last_event_id,
      checkpoint_hash: checkpoint.checkpoint_hash,
      restore_supported: false,
      checkpoint,
    })
    return redactValue(checkpoint)
  }

  async get(checkpointId: string): Promise<RuntimeCheckpoint | null> {
    const id = cleanString(checkpointId, "checkpoint_id")
    const checkpoint = (await this.checkpoints()).find((item) => item.checkpoint_id === id) ?? null
    return redactValue(checkpoint)
  }

  async list(limit = 20): Promise<RuntimeCheckpointRecord[]> {
    const cleanLimit = readLimit(limit)
    const records = (await this.checkpoints()).slice().reverse().slice(0, cleanLimit).map(recordFromCheckpoint)
    return redactValue(records)
  }

  private async buildCheckpoint(input: Required<Pick<RuntimeCheckpointInput, "scope" | "max_bytes">> & { reason?: string; created_by: string }): Promise<RuntimeCheckpoint> {
    const events = await this.options.eventStore.readAll()
    const createdAt = (this.options.now ?? (() => new Date()))().toISOString()
    const checkpointId = this.options.idFactory ? this.options.idFactory() : `checkpoint_${Date.now().toString(36)}_${++this.generatedIds}`
    const base = {
      checkpoint_id: checkpointId,
      scope: input.scope,
      reason: input.reason,
      created_at: createdAt,
      created_by: input.created_by,
      event_count: events.length,
      last_event_id: latestEventId(events),
      sections: await this.buildSections(input.scope),
      restore_supported: false as const,
      warnings: [] as string[],
    }
    const checkpoint = fitCheckpoint(base, input.max_bytes)
    return redactValue(checkpoint)
  }

  private async buildSections(scope: RuntimeCheckpointScope): Promise<RuntimeCheckpointSections> {
    const allSections = sanitizeSections(await this.options.sectionProvider())
    const names = sectionNamesForScope(scope)
    const out: RuntimeCheckpointSections = {}
    for (const name of names) {
      const value = allSections[name]
      if (value !== undefined) out[name] = value as never
    }
    out.suggested_commands = suggestedCommands(scope, allSections)
    return redactValue(out)
  }

  private async checkpoints(): Promise<RuntimeCheckpoint[]> {
    const out: RuntimeCheckpoint[] = []
    for (const event of await this.options.eventStore.readAll()) {
      if (event.kind !== "runtime_checkpoint_created") continue
      const checkpoint = readCheckpointEvent(event as RuntimeCheckpointEvent)
      if (checkpoint) out.push(checkpoint)
    }
    return out
  }
}

function fitCheckpoint(checkpoint: Omit<RuntimeCheckpoint, "checkpoint_hash" | "section_summaries">, maxBytes: number): RuntimeCheckpoint {
  const initial = finalizeCheckpoint(checkpoint)
  if (byteLength(stableStringify(initial)) <= maxBytes) return initial
  const warnings = [...checkpoint.warnings, `checkpoint truncated to fit max_bytes=${maxBytes}`]
  let sections = truncateSections(checkpoint.sections, MAX_ARRAY_ITEMS)
  let candidate = finalizeCheckpoint({ ...checkpoint, sections, warnings })
  if (byteLength(stableStringify(candidate)) <= maxBytes) return candidate
  sections = truncateSections(sections, 5)
  candidate = finalizeCheckpoint({ ...checkpoint, sections, warnings })
  if (byteLength(stableStringify(candidate)) <= maxBytes) return candidate
  sections = minimalSections(sections)
  candidate = finalizeCheckpoint({ ...checkpoint, sections, warnings: [...warnings, "checkpoint sections reduced to minimal summaries"] })
  if (byteLength(stableStringify(candidate)) <= maxBytes) return candidate
  throw new Error("minimal runtime checkpoint exceeds max_bytes")
}

function finalizeCheckpoint(checkpoint: Omit<RuntimeCheckpoint, "checkpoint_hash" | "section_summaries">): RuntimeCheckpoint {
  const withSummaries = {
    ...checkpoint,
    section_summaries: summarizeSections(checkpoint.sections),
  }
  return {
    ...withSummaries,
    checkpoint_hash: sha256(stableStringify(withSummaries)),
  }
}

function truncateSections(sections: RuntimeCheckpointSections, limit: number): RuntimeCheckpointSections {
  return sanitizeSections(sections, limit, true)
}

function minimalSections(sections: RuntimeCheckpointSections): RuntimeCheckpointSections {
  const summaries = summarizeSections(sections).map((section) => ({ ...section, truncated: true }))
  return { runtime: { note: "sections truncated", summaries }, suggested_commands: sections.suggested_commands?.slice(0, 3) ?? [] }
}

function sanitizeSections(sections: RuntimeCheckpointSections, arrayLimit = MAX_ARRAY_ITEMS, markTruncated = false): RuntimeCheckpointSections {
  const out: RuntimeCheckpointSections = {}
  for (const [key, value] of Object.entries(sections) as Array<[keyof RuntimeCheckpointSections, unknown]>) {
    if (value === undefined) continue
    out[key] = sanitizeValue(value, arrayLimit, markTruncated) as never
  }
  return redactValue(out)
}

function sanitizeValue(value: unknown, arrayLimit: number, markTruncated: boolean): unknown {
  if (typeof value === "string") return boundedText(redactText(value), MAX_STRING_CHARS)
  if (typeof value !== "object" || value === null) return value
  if (Array.isArray(value)) {
    const truncated = value.length > arrayLimit
    const items = value.slice(0, arrayLimit).map((item) => sanitizeValue(item, arrayLimit, markTruncated))
    return markTruncated && truncated ? [...items, { truncated: true, omitted_count: value.length - arrayLimit }] : items
  }
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value).slice(0, 80)) out[redactText(key)] = sanitizeValue(item, arrayLimit, markTruncated)
  return out
}

function summarizeSections(sections: RuntimeCheckpointSections): RuntimeCheckpointSectionSummary[] {
  return (Object.entries(sections) as Array<[keyof RuntimeCheckpointSections, unknown]>).map(([name, value]) => ({
    name,
    included: value !== undefined,
    item_count: countItems(value),
    bytes: byteLength(stableStringify(value)),
    truncated: stableStringify(value).includes('"truncated":true'),
  })).sort((a, b) => a.name.localeCompare(b.name))
}

function sectionNamesForScope(scope: RuntimeCheckpointScope): Array<keyof RuntimeCheckpointSections> {
  if (scope === "commander") return ["runtime", "spec", "reasoning", "research", "commander"]
  if (scope === "executor") return ["runtime", "executor", "opencode"]
  if (scope === "research") return ["runtime", "reasoning", "research", "commander"]
  if (scope === "handoff") return ["runtime", "executor", "opencode", "handoff"]
  return ["runtime", "spec", "reasoning", "research", "commander", "executor", "opencode", "handoff"]
}

function suggestedCommands(scope: RuntimeCheckpointScope, sections: RuntimeCheckpointSections): RuntimeCheckpointSuggestedCommand[] {
  const commands: RuntimeCheckpointSuggestedCommand[] = [
    { label: "List checkpoints", command: "/checkpoints", command_type: "read" },
    { label: "Preview checkpoint", command: `/checkpoint-preview ${scope}`, command_type: "read" },
  ]
  if (scope === "commander" || scope === "full") {
    commands.push({ label: "Open commander queues", command: "/queues", command_type: "read" })
  }
  if (scope === "executor" || scope === "full") {
    commands.push({ label: "List missions", command: "/missions", command_type: "read" })
  }
  if (scope === "research" || scope === "full") {
    commands.push({ label: "List research topics", command: "/topics", command_type: "read" })
  }
  if (scope === "handoff" || scope === "full" || sections.handoff) {
    commands.push({ label: "Open handoff follow-ups", command: "/handoff-followups", command_type: "read" })
  }
  return commands
}

function recordFromCheckpoint(checkpoint: RuntimeCheckpoint): RuntimeCheckpointRecord {
  return {
    checkpoint_id: checkpoint.checkpoint_id,
    scope: checkpoint.scope,
    reason: checkpoint.reason,
    created_at: checkpoint.created_at,
    created_by: checkpoint.created_by,
    event_count: checkpoint.event_count,
    last_event_id: checkpoint.last_event_id,
    checkpoint_hash: checkpoint.checkpoint_hash,
    section_names: Object.keys(checkpoint.sections).sort(),
    summary_preview: previewText(stableStringify(summaryPayload(checkpoint))),
  }
}

function readCheckpointEvent(event: RuntimeCheckpointEvent): RuntimeCheckpoint | null {
  if (!isRecord(event.checkpoint) || typeof event.checkpoint.checkpoint_id !== "string") return null
  return redactValue(event.checkpoint as RuntimeCheckpoint)
}

function normalizeInput(input: RuntimeCheckpointInput): Required<Pick<RuntimeCheckpointInput, "scope" | "max_bytes">> & { reason?: string; created_by: string } {
  const scope = input.scope === undefined ? "full" : readScope(input.scope)
  const reason = input.reason === undefined ? undefined : boundedText(cleanString(input.reason, "reason"), MAX_REASON_CHARS)
  const createdBy = boundedText(cleanString(input.created_by ?? input.requested_by ?? "operator", "created_by"), 128)
  const maxBytes = input.max_bytes === undefined ? DEFAULT_MAX_BYTES : readMaxBytes(input.max_bytes)
  return { scope, reason: reason ? redactText(reason) : undefined, created_by: redactText(createdBy), max_bytes: maxBytes }
}

export function readRuntimeCheckpointScope(value: unknown): RuntimeCheckpointScope {
  return value === undefined ? "full" : readScope(value)
}

function readScope(value: unknown): RuntimeCheckpointScope {
  if (value === "full" || value === "commander" || value === "executor" || value === "research" || value === "handoff") return value
  throw new Error("runtime checkpoint scope must be one of full, commander, executor, research, handoff")
}

function readLimit(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error("checkpoint list limit must be a positive integer")
  return Math.min(Number(value), 100)
}

function readMaxBytes(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < MIN_MAX_BYTES) throw new Error(`max_bytes must be an integer >= ${MIN_MAX_BYTES}`)
  if (Number(value) > HARD_MAX_BYTES) throw new Error(`max_bytes must be no greater than ${HARD_MAX_BYTES}`)
  return Number(value)
}

function cleanString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function latestEventId(events: JsonlEvent[]): string | undefined {
  const last = events.at(-1)
  return typeof last?.event_id === "string" ? last.event_id : undefined
}

function countItems(value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (isRecord(value)) return Object.keys(value).length
  return value === undefined ? 0 : 1
}

function summaryPayload(value: unknown): unknown {
  if (!isRecord(value)) return value
  return {
    scope: value.scope,
    event_count: value.event_count,
    last_event_id: value.last_event_id,
    sections: isRecord(value.sections) ? Object.keys(value.sections).sort() : [],
    restore_supported: value.restore_supported,
  }
}

function boundedText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 15))}... [truncated]`
}

function previewText(value: string): string {
  return boundedText(redactText(value).replace(/\s+/g, " "), PREVIEW_CHARS)
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
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
