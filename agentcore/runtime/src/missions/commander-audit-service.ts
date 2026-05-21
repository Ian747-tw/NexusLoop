import { redactText, redactValue } from "../security/redaction"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import type {
  CommanderAuditEventKind,
  CommanderAuditEventSummary,
  CommanderAuditTargetType,
  CommanderAuditTimeline,
  CommanderAuditTimelineOptions,
  CommanderAuthorityChain,
} from "./commander-audit-types"

const TIMELINE_LIMIT_MAX = 100
const TIMELINE_LIMIT_DEFAULT = 25

const MISSION_EVENTS = new Set([
  "work_intent_created",
  "mission_created",
  "mission_sent",
  "mission_claimed",
  "mission_progress_recorded",
  "mission_result_submitted",
  "mission_completed",
  "mission_failed",
  "mission_cancelled",
  "mission_claim_released",
])

const REVIEW_EVENTS = new Set([
  "review_request_created",
  "review_request_approved",
  "review_request_rejected",
  "review_request_cancelled",
])

const PROPOSAL_EVENTS = new Set([
  "commander_proposal_created",
  "commander_proposal_review_requested",
  "commander_proposal_approved",
  "commander_proposal_rejected",
  "commander_proposal_cancelled",
])

const APPLY_EVENTS = new Set([
  "commander_proposal_applied",
  "commander_proposal_apply_failed",
  "commander_proposal_bundle_applied",
  "commander_proposal_bundle_apply_failed",
])

const BUNDLE_EVENTS = new Set([
  "commander_proposal_bundle_created",
  "commander_proposal_bundle_proposal_added",
  "commander_proposal_bundle_review_requested",
  "commander_proposal_bundle_cancelled",
])

const DRAFT_EVENTS = new Set([
  "commander_playbook_draft_created",
  "commander_playbook_draft_reviews_requested",
  "commander_playbook_draft_cancelled",
])

const RUNTIME_EVENTS = new Set([
  "runtime_started",
  "runtime_shutdown",
  "RuntimeReady",
  "ProjectInitialized",
  "ResumeSummaryLoaded",
  "ExecutorLifecycle",
  "RuntimeShutdown",
])

const TARGET_TYPES = new Set(["mission", "claim", "result", "review", "proposal", "bundle", "draft", "runtime"])
const CATEGORIES = new Set(["mission", "review", "proposal", "proposal_bundle", "playbook_draft", "apply", "runtime", "other"])

const RELATED_ID_KEYS: Array<[string, CommanderAuditTargetType]> = [
  ["mission_id", "mission"],
  ["intent_id", "runtime"],
  ["claim_id", "claim"],
  ["progress_id", "mission"],
  ["result_id", "result"],
  ["review_id", "review"],
  ["proposal_id", "proposal"],
  ["bundle_id", "bundle"],
  ["draft_id", "draft"],
]

export class CommanderAuditService {
  constructor(private readonly eventStore: EventStore) {}

  async timeline(options: CommanderAuditTimelineOptions = {}): Promise<CommanderAuditTimeline> {
    const limit = readLimit(options.limit)
    const category = options.category === undefined ? undefined : readCategory(options.category)
    const target = readOptionalTarget(options.target_type, options.target_id)
    const summaries = (await this.eventStore.readAll()).map((event, index) => summarizeEvent(event, index))
    const afterIndex = eventBoundaryIndex(summaries, options.after_event_id)
    const beforeIndex = eventBoundaryIndex(summaries, options.before_event_id)
    const filtered = summaries
      .filter((event) => afterIndex === undefined || event.event_index > afterIndex)
      .filter((event) => beforeIndex === undefined || event.event_index < beforeIndex)
      .filter((event) => category === undefined || event.category === category)
      .filter((event) => !target || eventMatchesTarget(event, target.target_type, target.target_id))
    const recent = [...filtered].reverse().slice(0, limit)
    const newest = recent.at(0)
    const oldest = recent.at(-1)
    const hasOlder = oldest ? filtered.some((event) => event.event_index < oldest.event_index) : false
    return redactValue({
      events: recent,
      total_considered: filtered.length,
      next_after_event_id: newest?.event_id,
      next_before_event_id: hasOlder ? oldest?.event_id : undefined,
    })
  }

  async authorityChain(targetType: string, targetId: string): Promise<CommanderAuthorityChain> {
    const target = readTarget(targetType, targetId)
    const summaries = (await this.eventStore.readAll()).map((event, index) => summarizeEvent(event, index))
    const ids = new Map<CommanderAuditTargetType, Set<string>>([[target.target_type, new Set([target.target_id])]])
    let foundDirect = false
    for (let depth = 0; depth < 3; depth += 1) {
      let expanded = false
      for (const event of summaries) {
        if (!eventMatchesAny(event, ids)) continue
        if (eventMatchesTarget(event, target.target_type, target.target_id)) foundDirect = true
        for (const [key, values] of Object.entries(event.related_ids)) {
          const relatedType = keyToTargetType(key)
          if (!relatedType) continue
          const bucket = ids.get(relatedType) ?? new Set<string>()
          for (const value of values) {
            if (!bucket.has(value)) {
              bucket.add(value)
              expanded = true
            }
          }
          ids.set(relatedType, bucket)
        }
      }
      if (!expanded) break
    }
    const events = summaries.filter((event) => eventMatchesAny(event, ids)).sort((a, b) => a.event_index - b.event_index)
    const relatedIds = idsToRelatedRecord(ids)
    return redactValue({
      target_type: target.target_type,
      target_id: target.target_id,
      related_ids: relatedIds,
      events,
      missing_links: foundDirect || events.length > 0 ? [] : [`no audit events found for ${target.target_type} ${target.target_id}`],
    })
  }
}

export function summarizeCommanderAuditEvent(event: JsonlEvent, eventIndex: number): CommanderAuditEventSummary {
  return summarizeEvent(event, eventIndex)
}

function summarizeEvent(event: JsonlEvent, eventIndex: number): CommanderAuditEventSummary {
  const kind = String(event.kind ?? event.type ?? "unknown")
  const relatedIds = collectRelatedIds(event)
  const category = categoryForKind(kind)
  const target = primaryTarget(kind, relatedIds)
  return redactValue({
    event_id: typeof event.event_id === "string" ? event.event_id : undefined,
    event_index: eventIndex,
    kind,
    category,
    target_type: target?.target_type,
    target_id: target?.target_id,
    related_ids: relatedIds,
    created_at: createdAt(event),
    title: titleForKind(kind, target?.target_id),
    summary: summaryForEvent(event, kind, target),
  })
}

function collectRelatedIds(value: unknown, out: Record<string, Set<string>> = {}): Record<string, string[]> {
  if (Array.isArray(value)) {
    for (const item of value) collectRelatedIds(item, out)
  } else if (isRecord(value)) {
    for (const [key, raw] of Object.entries(value)) {
      const related = RELATED_ID_KEYS.find(([candidate]) => candidate === key)
      if (related) {
        const values = Array.isArray(raw) ? raw : [raw]
        const bucket = out[key] ?? new Set<string>()
        for (const item of values) if (typeof item === "string" && item.trim()) bucket.add(redactText(item.trim()))
        out[key] = bucket
      }
      collectRelatedIds(raw, out)
    }
  }
  return Object.fromEntries(Object.entries(out).map(([key, values]) => [key, [...values].sort()]))
}

function categoryForKind(kind: string): CommanderAuditEventKind {
  if (MISSION_EVENTS.has(kind)) return "mission"
  if (REVIEW_EVENTS.has(kind)) return "review"
  if (PROPOSAL_EVENTS.has(kind)) return "proposal"
  if (BUNDLE_EVENTS.has(kind)) return "proposal_bundle"
  if (DRAFT_EVENTS.has(kind)) return "playbook_draft"
  if (APPLY_EVENTS.has(kind)) return "apply"
  if (RUNTIME_EVENTS.has(kind) || kind.startsWith("runtime_") || kind.startsWith("Runtime") || kind.startsWith("ResearchProjection")) return "runtime"
  return "other"
}

function primaryTarget(kind: string, relatedIds: Record<string, string[]>): { target_type: CommanderAuditTargetType; target_id: string } | undefined {
  const orderedKeys = kind.includes("draft")
    ? [["draft_id", "draft"], ["bundle_id", "bundle"], ["proposal_id", "proposal"]]
    : kind.includes("bundle")
      ? [["bundle_id", "bundle"], ["proposal_id", "proposal"]]
      : kind.includes("proposal")
        ? [["proposal_id", "proposal"], ["review_id", "review"], ["mission_id", "mission"]]
        : kind.includes("review")
          ? [["review_id", "review"], ["mission_id", "mission"]]
          : [["mission_id", "mission"], ["claim_id", "claim"], ["result_id", "result"], ["intent_id", "runtime"]]
  for (const [key, targetType] of orderedKeys) {
    const targetId = relatedIds[key]?.[0]
    if (targetId) return { target_type: targetType as CommanderAuditTargetType, target_id: targetId }
  }
  return undefined
}

function titleForKind(kind: string, targetId?: string): string {
  return `${kind}${targetId ? ` ${targetId}` : ""}`
}

function summaryForEvent(event: JsonlEvent, kind: string, target?: { target_type: CommanderAuditTargetType; target_id: string }): string {
  const pieces = [target ? `${target.target_type}=${target.target_id}` : undefined]
  const nested = firstNestedRecord(event)
  for (const key of ["status", "action_kind", "request_type", "decision", "mode", "reason", "failure_reason", "cancellation_reason", "release_reason", "application_result"]) {
    const value = event[key] ?? nested?.[key]
    if (typeof value === "string" && value.trim()) pieces.push(`${key}=${preview(value)}`)
  }
  return pieces.filter((piece): piece is string => Boolean(piece)).join(" ") || kind
}

function firstNestedRecord(event: JsonlEvent): Record<string, unknown> | undefined {
  for (const key of ["mission", "intent", "claim", "progress", "result", "review", "decision", "proposal", "bundle", "draft"]) {
    const value = event[key]
    if (isRecord(value)) return value
  }
  return undefined
}

function createdAt(event: JsonlEvent): string | undefined {
  if (typeof event.timestamp === "string") return redactText(event.timestamp)
  const nested = firstNestedRecord(event)
  for (const key of ["created_at", "updated_at", "requested_at", "approved_at", "rejected_at", "cancelled_at", "applied_at", "failed_at", "sent_at"]) {
    const value = event[key] ?? nested?.[key]
    if (typeof value === "string") return redactText(value)
  }
  return undefined
}

function eventMatchesTarget(event: CommanderAuditEventSummary, targetType: CommanderAuditTargetType, targetId: string): boolean {
  return event.related_ids[`${targetType}_id`]?.includes(targetId) === true
    || event.target_type === targetType && event.target_id === targetId
    || targetType === "runtime" && event.related_ids.intent_id?.includes(targetId) === true
}

function eventMatchesAny(event: CommanderAuditEventSummary, ids: Map<CommanderAuditTargetType, Set<string>>): boolean {
  for (const [targetType, values] of ids.entries()) {
    for (const value of values) if (eventMatchesTarget(event, targetType, value)) return true
  }
  return false
}

function keyToTargetType(key: string): CommanderAuditTargetType | undefined {
  if (key === "mission_id") return "mission"
  if (key === "claim_id") return "claim"
  if (key === "result_id") return "result"
  if (key === "review_id") return "review"
  if (key === "proposal_id") return "proposal"
  if (key === "bundle_id") return "bundle"
  if (key === "draft_id") return "draft"
  if (key === "intent_id") return "runtime"
  return undefined
}

function idsToRelatedRecord(ids: Map<CommanderAuditTargetType, Set<string>>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [targetType, values] of ids.entries()) out[`${targetType}_id`] = [...values].sort()
  return out
}

function eventBoundaryIndex(events: CommanderAuditEventSummary[], eventId: unknown): number | undefined {
  if (eventId === undefined) return undefined
  const clean = cleanString(eventId, "eventId")
  const index = events.find((event) => event.event_id === clean)?.event_index
  return index
}

function readLimit(value: unknown): number {
  if (value === undefined) return TIMELINE_LIMIT_DEFAULT
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error("audit limit must be a positive integer")
  return Math.min(Number(value), TIMELINE_LIMIT_MAX)
}

function readOptionalTarget(targetType: unknown, targetId: unknown): { target_type: CommanderAuditTargetType; target_id: string } | undefined {
  if (targetType === undefined && targetId === undefined) return undefined
  return readTarget(targetType, targetId)
}

function readTarget(targetType: unknown, targetId: unknown): { target_type: CommanderAuditTargetType; target_id: string } {
  const type = cleanString(targetType, "targetType")
  if (!TARGET_TYPES.has(type)) throw new Error("commander audit targetType is invalid")
  return { target_type: type as CommanderAuditTargetType, target_id: cleanString(targetId, "targetId") }
}

function readCategory(value: unknown): CommanderAuditEventKind {
  const category = cleanString(value, "category")
  if (!CATEGORIES.has(category)) throw new Error("commander audit category is invalid")
  return category as CommanderAuditEventKind
}

function cleanString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return redactText(value.trim())
}

function preview(value: string): string {
  const clean = redactText(value).replace(/\s+/g, " ").trim()
  return clean.length > 120 ? `${clean.slice(0, 117)}...` : clean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
