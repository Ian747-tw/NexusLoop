import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type {
  WakeSchedulerAuditChain,
  WakeSchedulerAuditCommand,
  WakeSchedulerAuditEventKind,
  WakeSchedulerAuditGap,
  WakeSchedulerAuditIncident,
  WakeSchedulerAuditQuery,
  WakeSchedulerAuditSeverity,
  WakeSchedulerAuditSummary,
  WakeSchedulerAuditTimelineEntry,
} from "./wake-scheduler-audit-types"

const DEFAULT_LIMIT = 50
const HARD_LIMIT = 200
const PREVIEW_CHARS = 220

const KINDS: WakeSchedulerAuditEventKind[] = [
  "checkpoint",
  "resume_anchor",
  "wake_assessment",
  "continuation_plan",
  "continuation_step",
  "wake_schedule",
  "wake_tick",
  "scheduler_lifecycle",
  "scheduler_bootstrap",
  "scheduler_recovery",
  "scheduler_recovery_workflow",
  "incident",
  "other",
]

const SEVERITIES: WakeSchedulerAuditSeverity[] = ["info", "warning", "error"]

const RELATED_KEYS = new Set([
  "checkpoint_id",
  "resume_id",
  "wake_id",
  "plan_id",
  "step_id",
  "schedule_id",
  "tick_id",
  "recovery_id",
  "workflow_id",
  "mission_id",
  "handoff_id",
  "proposal_id",
  "review_id",
  "event_id",
])

export class WakeSchedulerAuditService {
  constructor(private readonly eventStore: EventStore) {}

  async summary(): Promise<WakeSchedulerAuditSummary> {
    const entries = await this.entries()
    const incidents = buildIncidents(entries)
    const latestScheduler = [...entries].reverse().find((entry) => entry.source_kind === "scheduler_lifecycle")
    const latestBootstrap = [...entries].reverse().find((entry) => entry.source_kind === "scheduler_bootstrap")
    const latestRecovery = [...entries].reverse().find((entry) => entry.source_kind === "scheduler_recovery")
    return redactValue({
      event_count: entries.length,
      checkpoint_count: entries.filter((entry) => entry.source_kind === "checkpoint").length,
      resume_anchor_count: entries.filter((entry) => entry.source_kind === "resume_anchor").length,
      wake_assessment_count: entries.filter((entry) => entry.source_kind === "wake_assessment").length,
      continuation_plan_count: entries.filter((entry) => entry.source_kind === "continuation_plan").length,
      continuation_step_count: entries.filter((entry) => entry.source_kind === "continuation_step").length,
      schedule_count: entries.filter((entry) => entry.source_kind === "wake_schedule").length,
      tick_count: entries.filter((entry) => entry.source_kind === "wake_tick" || entry.source_event_kind === "runtime_wake_scheduler_tick_succeeded").length,
      scheduler_start_count: entries.filter((entry) => entry.source_event_kind === "runtime_wake_scheduler_started").length,
      scheduler_stop_count: entries.filter((entry) => entry.source_event_kind === "runtime_wake_scheduler_stopped" || entry.source_event_kind === "runtime_shutdown").length,
      scheduler_failure_count: entries.filter((entry) => entry.source_event_kind === "runtime_wake_scheduler_tick_failed").length,
      bootstrap_blocked_count: entries.filter((entry) => entry.source_event_kind === "runtime_wake_scheduler_bootstrap_blocked").length,
      stale_recovery_count: entries.filter((entry) => entry.source_event_kind === "runtime_wake_scheduler_stale_run_detected").length,
      recovery_workflow_count: entries.filter((entry) => entry.source_kind === "scheduler_recovery_workflow").length,
      unresolved_incident_count: incidents.filter((incident) => incident.status === "open").length,
      last_event_at: entries.at(-1)?.created_at,
      latest_scheduler_status: latestScheduler ? schedulerStatus(latestScheduler) : undefined,
      latest_bootstrap_status: latestBootstrap ? latestBootstrap.source_event_kind.replace("runtime_wake_scheduler_bootstrap_", "") : undefined,
      latest_recovery_status: latestRecovery ? recoveryStatus(latestRecovery) : undefined,
    })
  }

  async timeline(query: WakeSchedulerAuditQuery = {}): Promise<WakeSchedulerAuditTimelineEntry[]> {
    const normalized = readWakeSchedulerAuditQuery(query)
    return redactValue(applyQuery(await this.entries(), normalized).reverse().slice(0, normalized.limit))
  }

  async chain(relatedId: string, limit?: number): Promise<WakeSchedulerAuditChain> {
    const cleanId = cleanString(relatedId, "relatedId")
    const all = await this.entries()
    const ids = expandRelatedIds(all, cleanId)
    const entries = all.filter((entry) => entryMatchesAnyRelated(entry, ids)).slice(-readLimit(limit))
    const relatedIds = mergeRelatedIds(entries)
    const root = entries.find((entry) => entryContainsRelated(entry, cleanId))
    return redactValue({
      chain_id: `wake_scheduler_audit_chain_${hashText(cleanId).slice(0, 16)}`,
      root_kind: root?.source_kind ?? "other",
      root_id: cleanId,
      entries,
      related_ids: relatedIds,
      gaps: detectGaps(entries),
      recommended_commands: recommendedForRelated(relatedIds, cleanId),
    })
  }

  async incidents(query: { limit?: number; status?: string; severity?: string } = {}): Promise<WakeSchedulerAuditIncident[]> {
    const limit = readLimit(query.limit)
    const status = query.status === undefined ? undefined : readIncidentStatus(query.status)
    const severity = query.severity === undefined ? undefined : readSeverity(query.severity)
    return redactValue(buildIncidents(await this.entries())
      .filter((incident) => status === undefined || incident.status === status)
      .filter((incident) => severity === undefined || incident.severity === severity)
      .slice(0, limit))
  }

  private async entries(): Promise<WakeSchedulerAuditTimelineEntry[]> {
    const events = await this.eventStore.readAll()
    return events
      .map((event, index) => entryFromEvent(event, index))
      .filter((entry): entry is WakeSchedulerAuditTimelineEntry => entry !== null)
  }
}

export function readWakeSchedulerAuditQuery(payload: WakeSchedulerAuditQuery | Record<string, unknown> = {}): Required<Pick<WakeSchedulerAuditQuery, "limit" | "include_commands">> & Omit<WakeSchedulerAuditQuery, "limit" | "include_commands"> {
  const raw = payload as Record<string, unknown>
  return {
    limit: readLimit(raw.limit),
    since: raw.since === undefined ? undefined : readIso(raw.since, "since"),
    until: raw.until === undefined ? undefined : readIso(raw.until, "until"),
    kinds: readKinds(raw.kinds ?? raw.kind),
    severity: raw.severity === undefined ? undefined : readSeverity(raw.severity),
    related_id: raw.related_id === undefined && raw.relatedId === undefined ? undefined : cleanString(raw.related_id ?? raw.relatedId, "relatedId"),
    include_commands: raw.include_commands !== false && raw.includeCommands !== false,
  }
}

function entryFromEvent(event: JsonlEvent, index: number): WakeSchedulerAuditTimelineEntry | null {
  const kind = String(event.kind ?? event.type ?? "unknown")
  const sourceKind = sourceKindFor(kind)
  if (sourceKind === null) return null
  const relatedIds = collectRelatedIds(event)
  const severity = severityFor(kind)
  const createdAt = eventTime(event)
  const entry: WakeSchedulerAuditTimelineEntry = {
    audit_id: `wake_scheduler_audit_${index}_${hashText(kind + (event.event_id ?? createdAt)).slice(0, 10)}`,
    event_id: typeof event.event_id === "string" ? redactText(event.event_id) : undefined,
    source_kind: sourceKind,
    source_event_kind: kind,
    severity,
    created_at: createdAt,
    title: titleFor(kind, relatedIds),
    summary: summaryFor(event, kind, relatedIds),
    related_ids: relatedIds,
    recommended_commands: commandsForEntry(kind, relatedIds),
  }
  return redactValue(entry)
}

function sourceKindFor(kind: string): WakeSchedulerAuditEventKind | null {
  if (kind === "runtime_checkpoint_created") return "checkpoint"
  if (kind === "runtime_resume_anchor_marked") return "resume_anchor"
  if (kind === "runtime_wake_assessment_created") return "wake_assessment"
  if (kind === "runtime_continuation_plan_created" || kind === "runtime_continuation_plan_paused" || kind === "runtime_continuation_plan_cancelled" || kind === "runtime_continuation_plan_completed") return "continuation_plan"
  if (kind === "runtime_continuation_step_started" || kind === "runtime_continuation_step_succeeded" || kind === "runtime_continuation_step_failed") return "continuation_step"
  if (kind === "runtime_wake_schedule_created" || kind === "runtime_wake_schedule_paused" || kind === "runtime_wake_schedule_resumed" || kind === "runtime_wake_schedule_cancelled") return "wake_schedule"
  if (kind === "runtime_wake_schedule_tick_completed" || kind === "runtime_wake_scheduler_tick_succeeded" || kind === "runtime_wake_scheduler_tick_failed") return "wake_tick"
  if (kind === "runtime_wake_scheduler_started" || kind === "runtime_wake_scheduler_stopped" || kind === "runtime_wake_scheduler_heartbeat" || kind === "runtime_shutdown") return "scheduler_lifecycle"
  if (kind === "runtime_wake_scheduler_bootstrap_skipped" || kind === "runtime_wake_scheduler_bootstrap_started" || kind === "runtime_wake_scheduler_bootstrap_blocked" || kind === "runtime_wake_scheduler_stale_run_detected") return "scheduler_bootstrap"
  if (kind === "runtime_wake_scheduler_recovery_recorded") return "scheduler_recovery"
  if (kind === "runtime_wake_scheduler_recovery_workflow_created" || kind === "runtime_wake_scheduler_recovery_workflow_step_recorded" || kind === "runtime_wake_scheduler_recovery_workflow_cancelled") return "scheduler_recovery_workflow"
  if (/runtime_(wake|continuation|checkpoint|resume|scheduler)/.test(kind)) return "other"
  return null
}

function severityFor(kind: string): WakeSchedulerAuditSeverity {
  if (kind.includes("failed") || kind.includes("failure")) return "error"
  if (kind.includes("blocked") || kind.includes("stale_run") || kind.includes("cancelled")) return "warning"
  return "info"
}

function collectRelatedIds(value: unknown, out: Record<string, Set<string>> = {}): Record<string, string[]> {
  if (Array.isArray(value)) {
    for (const item of value) collectRelatedIds(item, out)
  } else if (isRecord(value)) {
    for (const [key, raw] of Object.entries(value)) {
      const normalizedKey = normalizeRelatedKey(key)
      if (normalizedKey) {
        const bucket = out[normalizedKey] ?? new Set<string>()
        const values = Array.isArray(raw) ? raw : [raw]
        for (const item of values) if (typeof item === "string" && item.trim()) bucket.add(redactText(item.trim()))
        out[normalizedKey] = bucket
      }
      collectRelatedIds(raw, out)
    }
  }
  return Object.fromEntries(Object.entries(out).map(([key, values]) => [key, [...values].sort()]))
}

function normalizeRelatedKey(key: string): string | null {
  if (RELATED_KEYS.has(key)) return key
  if (key.endsWith("_ids") && RELATED_KEYS.has(`${key.slice(0, -4)}_id`)) return `${key.slice(0, -4)}_id`
  if (key === "stale_prior_event_id") return "event_id"
  return null
}

function titleFor(kind: string, relatedIds: Record<string, string[]>): string {
  const id = primaryId(relatedIds)
  return preview(`${kind}${id ? ` ${id}` : ""}`)
}

function summaryFor(event: JsonlEvent, kind: string, relatedIds: Record<string, string[]>): string {
  const nested = firstNestedRecord(event)
  const pieces = [primaryId(relatedIds) ? `id=${primaryId(relatedIds)}` : undefined]
  for (const key of ["status", "scheduler_status", "message", "reason", "error", "failure_reason", "resolution", "summary_preview"]) {
    const value = event[key] ?? nested?.[key]
    if (typeof value === "string" && value.trim()) pieces.push(`${key}=${preview(value)}`)
  }
  return pieces.filter((piece): piece is string => Boolean(piece)).join(" ") || kind
}

function firstNestedRecord(event: JsonlEvent): Record<string, unknown> | undefined {
  for (const key of ["checkpoint", "anchor", "wake", "assessment", "plan", "result", "schedule", "tick", "workflow", "stale_prior_run"]) {
    const value = event[key]
    if (isRecord(value)) return value
  }
  return undefined
}

function primaryId(relatedIds: Record<string, string[]>): string | undefined {
  for (const key of ["workflow_id", "recovery_id", "schedule_id", "tick_id", "wake_id", "plan_id", "step_id", "resume_id", "checkpoint_id", "event_id"]) {
    const value = relatedIds[key]?.[0]
    if (value) return value
  }
  return undefined
}

function commandsForEntry(kind: string, relatedIds: Record<string, string[]>): WakeSchedulerAuditCommand[] {
  const commands: WakeSchedulerAuditCommand[] = [{ label: "Scheduler status", command: "/scheduler-status", command_type: "read" }]
  if (kind.includes("bootstrap")) commands.push({ label: "Scheduler bootstrap", command: "/scheduler-bootstrap", command_type: "read" })
  if (kind.includes("recovery_workflow") || relatedIds.workflow_id?.[0]) commands.push({ label: "Recovery workflows", command: "/scheduler-recovery-workflows", command_type: "read" })
  if (kind.includes("recovery") || relatedIds.recovery_id?.[0]) commands.push({ label: "Scheduler recovery", command: "/scheduler-recovery", command_type: "read" })
  if (relatedIds.schedule_id?.[0]) commands.push({ label: "Wake schedule", command: `/wake-schedule ${relatedIds.schedule_id[0]}`, command_type: "read" })
  if (relatedIds.wake_id?.[0]) commands.push({ label: "Wake assessment", command: `/wake-show ${relatedIds.wake_id[0]}`, command_type: "read" })
  if (relatedIds.plan_id?.[0]) commands.push({ label: "Continuation plan", command: `/continue-show ${relatedIds.plan_id[0]}`, command_type: "read" })
  if (relatedIds.checkpoint_id?.[0]) commands.push({ label: "Checkpoint", command: `/checkpoint-show ${relatedIds.checkpoint_id[0]}`, command_type: "read" })
  if (relatedIds.resume_id?.[0]) commands.push({ label: "Resume anchor", command: `/resume-anchor ${relatedIds.resume_id[0]}`, command_type: "read" })
  if (kind === "runtime_wake_scheduler_stale_run_detected" || kind === "runtime_wake_scheduler_tick_failed") commands.push({ label: "Wake tick preview", command: "/wake-tick-preview", command_type: "read" })
  return dedupeCommands(commands).slice(0, 10)
}

function applyQuery(entries: WakeSchedulerAuditTimelineEntry[], query: ReturnType<typeof readWakeSchedulerAuditQuery>): WakeSchedulerAuditTimelineEntry[] {
  return entries
    .filter((entry) => query.since === undefined || entry.created_at >= query.since)
    .filter((entry) => query.until === undefined || entry.created_at <= query.until)
    .filter((entry) => query.kinds === undefined || query.kinds.includes(entry.source_kind))
    .filter((entry) => query.severity === undefined || entry.severity === query.severity)
    .filter((entry) => query.related_id === undefined || entryContainsRelated(entry, query.related_id))
    .map((entry) => query.include_commands ? entry : { ...entry, recommended_commands: [] })
}

function expandRelatedIds(entries: WakeSchedulerAuditTimelineEntry[], rootId: string): Set<string> {
  const ids = new Set([rootId])
  for (let depth = 0; depth < 4; depth += 1) {
    let expanded = false
    for (const entry of entries) {
      if (!entryMatchesAnyRelated(entry, ids)) continue
      for (const values of Object.values(entry.related_ids)) {
        for (const value of values) if (!ids.has(value)) {
          ids.add(value)
          expanded = true
        }
      }
    }
    if (!expanded) break
  }
  return ids
}

function entryMatchesAnyRelated(entry: WakeSchedulerAuditTimelineEntry, ids: Set<string>): boolean {
  for (const id of ids) if (entryContainsRelated(entry, id)) return true
  return false
}

function entryContainsRelated(entry: WakeSchedulerAuditTimelineEntry, id: string): boolean {
  return Object.values(entry.related_ids).some((values) => values.includes(id)) || entry.audit_id === id || entry.event_id === id
}

function mergeRelatedIds(entries: WakeSchedulerAuditTimelineEntry[]): Record<string, string[]> {
  const out: Record<string, Set<string>> = {}
  for (const entry of entries) {
    for (const [key, values] of Object.entries(entry.related_ids)) {
      const bucket = out[key] ?? new Set<string>()
      for (const value of values) bucket.add(value)
      out[key] = bucket
    }
  }
  return Object.fromEntries(Object.entries(out).map(([key, values]) => [key, [...values].sort()]))
}

function detectGaps(entries: WakeSchedulerAuditTimelineEntry[]): WakeSchedulerAuditGap[] {
  const gaps: WakeSchedulerAuditGap[] = []
  if (unmatchedSchedulerStarts(entries).length > 0) {
    gaps.push({ severity: "warning", message: "scheduler start has no matching stop or runtime shutdown in this chain" })
  }
  if (entries.some((entry) => entry.source_event_kind === "runtime_wake_scheduler_recovery_workflow_created")
    && !entries.some((entry) => entry.source_event_kind === "runtime_wake_scheduler_recovery_workflow_step_recorded")) {
    gaps.push({ severity: "warning", message: "recovery workflow has no recorded step progress" })
  }
  if (entries.some((entry) => entry.source_event_kind === "runtime_continuation_plan_created")
    && !entries.some((entry) => entry.source_kind === "continuation_step")) {
    gaps.push({ severity: "warning", message: "continuation plan has no step result events" })
  }
  if (entries.some((entry) => entry.source_event_kind === "runtime_wake_scheduler_stale_run_detected")
    && !entries.some((entry) => entry.source_event_kind === "runtime_wake_scheduler_recovery_recorded")) {
    gaps.push({ severity: "warning", message: "stale scheduler recovery has no acknowledgement or resolution event" })
  }
  return gaps.map((gap) => redactValue(gap))
}

function buildIncidents(entries: WakeSchedulerAuditTimelineEntry[]): WakeSchedulerAuditIncident[] {
  const incidents: WakeSchedulerAuditIncident[] = []
  const openStarts = unmatchedSchedulerStarts(entries)
  if (openStarts.length > 0) incidents.push(incident("scheduler_started_without_stop", "warning", "open", "Scheduler start without stop", "scheduler start has no matching stop or shutdown", openStarts))
  for (const entry of entries.filter((item) => item.source_event_kind === "runtime_wake_scheduler_tick_failed")) incidents.push(incident(`tick_failed_${entry.event_id ?? entry.audit_id}`, "error", "open", "Scheduler tick failed", entry.summary, [entry]))
  for (const entry of entries.filter((item) => item.source_event_kind === "runtime_wake_scheduler_bootstrap_blocked")) incidents.push(incident(`bootstrap_blocked_${entry.event_id ?? entry.audit_id}`, "warning", "open", "Scheduler bootstrap blocked", entry.summary, [entry]))
  const recoveryRecords = entries.filter((item) => item.source_event_kind === "runtime_wake_scheduler_recovery_recorded")
  for (const entry of entries.filter((item) => item.source_event_kind === "runtime_wake_scheduler_stale_run_detected")) {
    const related = recoveryRecords.find((record) => sameRecoverySignal(entry, record))
    const status = related?.summary.includes("resolution=resolved") ? "resolved" : related ? "acknowledged" : "open"
    incidents.push(incident(`stale_run_${entry.event_id ?? entry.audit_id}`, "warning", status, "Stale scheduler run detected", entry.summary, related ? [entry, related] : [entry]))
  }
  for (const entry of entries.filter((item) => item.source_event_kind === "runtime_wake_scheduler_recovery_workflow_cancelled")) incidents.push(incident(`workflow_cancelled_${entry.event_id ?? entry.audit_id}`, "warning", "open", "Recovery workflow cancelled", entry.summary, [entry]))
  for (const entry of entries.filter((item) => item.source_event_kind === "runtime_continuation_step_failed")) incidents.push(incident(`continuation_step_failed_${entry.event_id ?? entry.audit_id}`, "error", "open", "Continuation step failed", entry.summary, [entry]))
  return incidents.sort((left, right) => (right.last_seen_at ?? "").localeCompare(left.last_seen_at ?? ""))
}

function unmatchedSchedulerStarts(entries: WakeSchedulerAuditTimelineEntry[]): WakeSchedulerAuditTimelineEntry[] {
  let openStarts: WakeSchedulerAuditTimelineEntry[] = []
  for (const entry of entries) {
    if (entry.source_event_kind === "runtime_wake_scheduler_started") openStarts = [entry]
    if (entry.source_event_kind === "runtime_wake_scheduler_stopped" || entry.source_event_kind === "runtime_shutdown") openStarts = []
  }
  return openStarts
}

function incident(id: string, severity: WakeSchedulerAuditSeverity, status: WakeSchedulerAuditIncident["status"], title: string, summary: string, entries: WakeSchedulerAuditTimelineEntry[]): WakeSchedulerAuditIncident {
  const first = entries[0]
  const last = entries.at(-1)
  const related = mergeRelatedIds(entries)
  return redactValue({
    incident_id: `wake_scheduler_incident_${hashText(id).slice(0, 16)}`,
    severity,
    status,
    title: preview(title),
    summary: preview(summary),
    first_seen_at: first?.created_at,
    last_seen_at: last?.created_at,
    related_entries: entries.slice(0, 10),
    recommended_commands: recommendedForRelated(related, primaryId(related) ?? ""),
  })
}

function sameRecoverySignal(left: WakeSchedulerAuditTimelineEntry, right: WakeSchedulerAuditTimelineEntry): boolean {
  const leftIds = new Set(Object.values(left.related_ids).flat())
  return Object.values(right.related_ids).flat().some((id) => leftIds.has(id))
}

function recommendedForRelated(relatedIds: Record<string, string[]>, fallbackId: string): WakeSchedulerAuditCommand[] {
  return dedupeCommands([
    { label: "Scheduler status", command: "/scheduler-status", command_type: "read" },
    { label: "Scheduler audit chain", command: `/scheduler-audit-chain ${primaryId(relatedIds) ?? fallbackId}`, command_type: "read" },
    { label: "Scheduler recovery", command: "/scheduler-recovery", command_type: "read" },
    { label: "Wake tick preview", command: "/wake-tick-preview", command_type: "read" },
    relatedIds.workflow_id?.[0] ? { label: "Recovery workflow", command: `/scheduler-recovery-workflow-show ${relatedIds.workflow_id[0]}`, command_type: "read" as const } : undefined,
    relatedIds.recovery_id?.[0] ? { label: "Recovery", command: `/scheduler-recovery-show ${relatedIds.recovery_id[0]}`, command_type: "read" as const } : undefined,
  ].filter((command): command is WakeSchedulerAuditCommand => Boolean(command))).slice(0, 10)
}

function schedulerStatus(entry: WakeSchedulerAuditTimelineEntry): string {
  if (entry.source_event_kind === "runtime_wake_scheduler_started") return "running"
  if (entry.source_event_kind === "runtime_wake_scheduler_stopped" || entry.source_event_kind === "runtime_shutdown") return "stopped"
  if (entry.source_event_kind === "runtime_wake_scheduler_tick_failed") return "error"
  return "unknown"
}

function recoveryStatus(entry: WakeSchedulerAuditTimelineEntry): string {
  if (entry.summary.includes("resolution=resolved")) return "resolved"
  if (entry.summary.includes("resolution=dismissed")) return "dismissed"
  if (entry.source_event_kind === "runtime_wake_scheduler_recovery_recorded") return "acknowledged"
  return "detected"
}

function readLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_LIMIT
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error("scheduler audit limit must be a positive integer")
  return Math.min(Number(value), HARD_LIMIT)
}

function readKinds(value: unknown): WakeSchedulerAuditEventKind[] | undefined {
  if (value === undefined) return undefined
  const raw = Array.isArray(value) ? value : [value]
  const kinds = raw.map((item) => cleanString(item, "kind"))
  for (const kind of kinds) if (!KINDS.includes(kind as WakeSchedulerAuditEventKind)) throw new Error("scheduler audit kind is invalid")
  return kinds as WakeSchedulerAuditEventKind[]
}

function readSeverity(value: unknown): WakeSchedulerAuditSeverity {
  const severity = cleanString(value, "severity")
  if (!SEVERITIES.includes(severity as WakeSchedulerAuditSeverity)) throw new Error("scheduler audit severity is invalid")
  return severity as WakeSchedulerAuditSeverity
}

function readIncidentStatus(value: unknown): WakeSchedulerAuditIncident["status"] {
  const status = cleanString(value, "status")
  if (status !== "open" && status !== "acknowledged" && status !== "resolved" && status !== "unknown") throw new Error("scheduler audit incident status is invalid")
  return status
}

function readIso(value: unknown, field: string): string {
  const clean = cleanString(value, field)
  if (Number.isNaN(Date.parse(clean))) throw new Error(`scheduler audit ${field} must be an ISO timestamp`)
  return clean
}

function cleanString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return redactText(value.trim())
}

function eventTime(event: JsonlEvent): string {
  if (typeof event.created_at === "string") return redactText(event.created_at)
  if (typeof event.recorded_at === "string") return redactText(event.recorded_at)
  if (typeof event.cancelled_at === "string") return redactText(event.cancelled_at)
  if (typeof event.timestamp === "string") return redactText(event.timestamp)
  const nested = firstNestedRecord(event)
  for (const key of ["created_at", "updated_at", "started_at", "completed_at", "failed_at", "marked_at"]) {
    const value = nested?.[key]
    if (typeof value === "string") return redactText(value)
  }
  return ""
}

function dedupeCommands(commands: WakeSchedulerAuditCommand[]): WakeSchedulerAuditCommand[] {
  const seen = new Set<string>()
  return commands.filter((command) => {
    const key = `${command.command_type}:${command.command}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).map((command) => redactValue(command))
}

function preview(value: string): string {
  const clean = redactText(value).replace(/\s+/g, " ").trim()
  return clean.length > PREVIEW_CHARS ? `${clean.slice(0, PREVIEW_CHARS - 3)}...` : clean
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
