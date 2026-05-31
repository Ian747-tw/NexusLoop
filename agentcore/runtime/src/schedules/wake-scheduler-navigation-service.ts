import { createHash } from "node:crypto"
import { redactText, redactValue } from "../security/redaction"
import type { WakeSchedulerAuditChain, WakeSchedulerAuditCommand, WakeSchedulerAuditIncident, WakeSchedulerAuditSummary, WakeSchedulerAuditTimelineEntry } from "./wake-scheduler-audit-types"
import type { WakeSchedulerAuditService } from "./wake-scheduler-audit-service"
import type {
  WakeSchedulerNavigationBoard,
  WakeSchedulerNavigationCard,
  WakeSchedulerNavigationCommandPreview,
  WakeSchedulerNavigationCommandType,
  WakeSchedulerNavigationInput,
  WakeSchedulerNavigationRisk,
  WakeSchedulerNavigationTarget,
  WakeSchedulerNavigationTargetKind,
} from "./wake-scheduler-navigation-types"

const DEFAULT_LIMIT = 20
const HARD_LIMIT = 50
const INCIDENT_SEARCH_LIMIT = 200
const PREVIEW_CHARS = 220

interface NormalizedInput {
  related_id?: string
  incident_id?: string
  audit_id?: string
  command?: string
  limit: number
  include_write: boolean
}

export interface ClassifiedWakeSchedulerNavigationCommand {
  command: string
  command_type: WakeSchedulerNavigationCommandType
  risk: WakeSchedulerNavigationRisk
  target_kind: WakeSchedulerNavigationTargetKind
  target_id?: string
  supported: boolean
  blockers: string[]
  notes: string[]
  equivalent_runtime_command?: string
}

export class WakeSchedulerNavigationService {
  constructor(private readonly auditService: WakeSchedulerAuditService, private readonly now: () => string = () => new Date().toISOString()) {}

  async board(input: WakeSchedulerNavigationInput = {}): Promise<WakeSchedulerNavigationBoard> {
    const normalized = normalizeInput(input)
    if (normalized.command) return this.commandBoard(normalized.command, normalized)
    if (normalized.related_id) return this.relatedBoard(normalized.related_id, normalized)
    if (normalized.incident_id) return this.incidentBoard(normalized.incident_id, normalized)
    if (normalized.audit_id) return this.auditEntryBoard(normalized.audit_id, normalized)
    return this.summaryBoard(normalized)
  }

  previewCommand(command: string): WakeSchedulerNavigationCommandPreview {
    const classified = classifyWakeSchedulerNavigationCommand(command)
    return redactValue({
      command: classified.command,
      command_type: classified.command_type,
      risk: classified.risk,
      target_kind: classified.target_kind,
      target_id: classified.target_id,
      supported: classified.supported,
      blockers: classified.blockers,
      notes: classified.notes,
      equivalent_runtime_command: classified.equivalent_runtime_command,
      redacted_summary_preview: preview(`${classified.risk} ${classified.target_kind}${classified.target_id ? ` ${classified.target_id}` : ""}: ${classified.command}`),
    })
  }

  async target(targetKind: string, targetId: string): Promise<WakeSchedulerNavigationTarget> {
    const kind = normalizeTargetKind(targetKind)
    const id = cleanString(targetId, "target_id")
    const chain = await this.auditService.chain(id, HARD_LIMIT)
    const related = mergeRelatedIds(chain.entries)
    const commands = [...chain.recommended_commands, ...chain.entries.flatMap((entry) => entry.recommended_commands), ...targetCommands(kind, id)]
    return redactValue({
      target_kind: kind,
      target_id: id,
      title: preview(`${kind} ${id}`),
      related_commands: this.cardsFromCommands(commands, { limit: DEFAULT_LIMIT, include_write: true }),
      related_ids: related,
      audit_entries: chain.entries.slice(0, DEFAULT_LIMIT),
      warnings: chain.entries.length === 0 ? [`no audit entries found for ${kind} ${id}`] : [],
    })
  }

  private async summaryBoard(input: NormalizedInput): Promise<WakeSchedulerNavigationBoard> {
    const [summary, timeline, incidents] = await Promise.all([
      this.auditService.summary(),
      this.auditService.timeline({ limit: input.limit }),
      this.auditService.incidents({ limit: input.limit }),
    ])
    const commands: WakeSchedulerAuditCommand[] = [
      { label: "Scheduler audit", command: "/scheduler-audit", command_type: "read" },
      { label: "Scheduler audit timeline", command: "/scheduler-audit-timeline limit=20", command_type: "read" },
      { label: "Scheduler audit incidents", command: "/scheduler-audit-incidents open", command_type: "read" },
      { label: "Scheduler status", command: "/scheduler-status", command_type: "read" },
      ...timeline.flatMap((entry) => entry.recommended_commands),
      ...incidents.flatMap((incident) => incident.recommended_commands),
    ]
    return this.boardFromParts({
      source: { kind: "summary" },
      title: "Scheduler audit navigation",
      summary: summaryText(summary, timeline.length, incidents.length),
      commands,
      related_ids: mergeRelatedIds(timeline.flatMap((entry) => [entry, ...incidents.flatMap((incident) => incident.related_entries)])),
      warnings: incidents.some((incident) => incident.status === "open") ? ["open audit incidents are present; suggested commands are for manual inspection only"] : [],
      blockers: [],
      input,
    })
  }

  private async relatedBoard(relatedId: string, input: NormalizedInput): Promise<WakeSchedulerNavigationBoard> {
    const chain = await this.auditService.chain(relatedId, input.limit)
    const commands = [...chain.recommended_commands, ...chain.entries.flatMap((entry) => entry.recommended_commands)]
    return this.boardFromParts({
      source: { kind: "related_id", related_id: relatedId },
      title: `Navigation for ${relatedId}`,
      summary: `audit chain entries=${chain.entries.length} gaps=${chain.gaps.length}`,
      commands,
      related_ids: chain.related_ids,
      warnings: chain.gaps.map((gap) => gap.message),
      blockers: chain.entries.length === 0 ? ["no audit chain entries found for related id"] : [],
      input,
    })
  }

  private async incidentBoard(incidentId: string, input: NormalizedInput): Promise<WakeSchedulerNavigationBoard> {
    const incidents = await this.auditService.incidents({ limit: INCIDENT_SEARCH_LIMIT })
    const incident = incidents.find((item) => item.incident_id === incidentId)
    const commands = incident ? [...incident.recommended_commands, ...incident.related_entries.flatMap((entry) => entry.recommended_commands)] : []
    return this.boardFromParts({
      source: { kind: "incident", incident_id: incidentId },
      title: incident ? `Navigation for incident ${incident.title}` : `Navigation for incident ${incidentId}`,
      summary: incident ? `${incident.severity}/${incident.status}: ${incident.summary}` : "incident not found",
      commands,
      related_ids: incident ? mergeRelatedIds(incident.related_entries) : {},
      warnings: incident && incident.status === "open" ? ["incident is open; navigation does not remediate it"] : [],
      blockers: incident ? [] : ["incident not found in audit projection"],
      input,
    })
  }

  private async auditEntryBoard(auditId: string, input: NormalizedInput): Promise<WakeSchedulerNavigationBoard> {
    const timeline = await this.auditService.timeline({ limit: HARD_LIMIT })
    const entry = timeline.find((item) => item.audit_id === auditId || item.event_id === auditId)
    const primary = entry ? primaryId(entry.related_ids) : undefined
    const chain = primary ? await this.auditService.chain(primary, input.limit) : undefined
    const commands = entry ? [...entry.recommended_commands, ...(chain?.recommended_commands ?? []), ...(chain?.entries.flatMap((item) => item.recommended_commands) ?? [])] : []
    return this.boardFromParts({
      source: { kind: "timeline", audit_id: auditId },
      title: entry ? `Navigation for audit entry ${entry.audit_id}` : `Navigation for audit entry ${auditId}`,
      summary: entry ? `${entry.severity} ${entry.source_kind}/${entry.source_event_kind}: ${entry.summary}` : "audit entry not found",
      commands,
      related_ids: chain?.related_ids ?? entry?.related_ids ?? {},
      warnings: chain?.gaps.map((gap) => gap.message) ?? [],
      blockers: entry ? [] : ["audit entry not found in recent timeline"],
      input,
    })
  }

  private commandBoard(command: string, input: NormalizedInput): WakeSchedulerNavigationBoard {
    const previewResult = this.previewCommand(command)
    const commandRecord: WakeSchedulerAuditCommand = { label: labelForCommand(previewResult.command), command: previewResult.command, command_type: previewResult.command_type }
    return this.boardFromParts({
      source: { kind: "command" },
      title: "Navigation command preview",
      summary: previewResult.redacted_summary_preview,
      commands: [commandRecord],
      related_ids: previewResult.target_id ? { [`${previewResult.target_kind}_id`]: [previewResult.target_id] } : {},
      warnings: previewResult.risk === "high_impact_write" ? ["high-impact command is shown for awareness only and is not executable here"] : [],
      blockers: previewResult.supported ? [] : previewResult.blockers,
      input,
    })
  }

  private boardFromParts(parts: { source: WakeSchedulerNavigationBoard["source"]; title: string; summary: string; commands: WakeSchedulerAuditCommand[]; related_ids: Record<string, string[]>; warnings: string[]; blockers: string[]; input: NormalizedInput }): WakeSchedulerNavigationBoard {
    const cards = this.cardsFromCommands(parts.commands, parts.input)
    const omitted = parts.input.include_write ? 0 : parts.commands.map((command) => classifyWakeSchedulerNavigationCommand(command.command)).filter((command) => command.command_type === "write").length
    return redactValue({
      board_id: `wake_scheduler_navigation_${hashText(JSON.stringify(parts.source) + parts.summary).slice(0, 16)}`,
      source: parts.source,
      title: preview(parts.title),
      summary: preview(parts.summary),
      cards,
      related_ids: parts.related_ids,
      warnings: [...parts.warnings.map(preview), ...(omitted > 0 ? [`${omitted} write/high-impact command cards omitted by include_write=false`] : [])].slice(0, 20),
      blockers: parts.blockers.map(preview).slice(0, 20),
      generated_at: this.now(),
    })
  }

  private cardsFromCommands(commands: WakeSchedulerAuditCommand[], input: Pick<NormalizedInput, "limit" | "include_write">): WakeSchedulerNavigationCard[] {
    const seen = new Set<string>()
    const cards: WakeSchedulerNavigationCard[] = []
    for (const command of commands) {
      const classified = classifyWakeSchedulerNavigationCommand(command.command)
      if (!input.include_write && classified.command_type === "write") continue
      if (seen.has(classified.command)) continue
      seen.add(classified.command)
      cards.push({
        card_id: `wake_scheduler_nav_card_${hashText(classified.command).slice(0, 16)}`,
        label: preview(command.label || labelForCommand(classified.command)),
        command: classified.command,
        command_type: classified.command_type,
        risk: classified.risk,
        target_kind: classified.target_kind,
        target_id: classified.target_id,
        supported: classified.supported,
        blockers: classified.blockers,
        notes: [...classified.notes, command.notes ? preview(command.notes) : undefined].filter((note): note is string => Boolean(note)).slice(0, 5),
        recommended_order: cards.length + 1,
      })
      if (cards.length >= input.limit) break
    }
    return redactValue(cards)
  }
}

function normalizeInput(input: WakeSchedulerNavigationInput): NormalizedInput {
  const raw = input as Record<string, unknown>
  const limit = readLimit(raw.limit)
  return {
    related_id: raw.related_id === undefined && raw.relatedId === undefined ? undefined : cleanString(raw.related_id ?? raw.relatedId, "related_id"),
    incident_id: raw.incident_id === undefined && raw.incidentId === undefined ? undefined : cleanString(raw.incident_id ?? raw.incidentId, "incident_id"),
    audit_id: raw.audit_id === undefined && raw.auditId === undefined ? undefined : cleanString(raw.audit_id ?? raw.auditId, "audit_id"),
    command: raw.command === undefined ? undefined : cleanCommand(raw.command),
    include_write: raw.include_write === false || raw.includeWrite === false ? false : true,
    limit,
  }
}

export function classifyWakeSchedulerNavigationCommand(value: string): ClassifiedWakeSchedulerNavigationCommand {
  const command = cleanCommand(value)
  if (!command.startsWith("/") || command.startsWith("//") || command.startsWith("/tmp/") || command.startsWith("/path")) {
    return unsupported(command, "only exact whitelisted slash commands are supported")
  }
  const parts = command.split(/\s+/)
  const name = parts[0] ?? ""
  const arg1 = parts[1]
  if (SAFE_READ.has(name)) return read(command, targetForRead(name, arg1), arg1)
  if (WRITE_COMMANDS.has(name)) return write(command, targetForWrite(name, arg1), arg1, "write command requires explicit operator execution outside navigation")
  if (HIGH_IMPACT.has(name)) return highImpact(command, targetForHighImpact(name, arg1), arg1)
  return unsupported(command, "command is not in the scheduler navigation whitelist")
}

const SAFE_READ = new Set([
  "/scheduler-status", "/scheduler-events", "/scheduler-bootstrap", "/scheduler-bootstrap-preview", "/scheduler-recovery", "/scheduler-recovery-preview",
  "/scheduler-recoveries", "/scheduler-recovery-show", "/scheduler-recovery-workflows", "/scheduler-recovery-workflow-show", "/scheduler-recovery-workflow-verify",
  "/scheduler-audit", "/scheduler-audit-summary", "/scheduler-audit-timeline", "/scheduler-audit-chain", "/scheduler-audit-incidents",
  "/wake-tick-preview", "/wake-schedules", "/wake-schedule", "/wake-ticks", "/wake-tick-show", "/wake-preview", "/wake-show",
  "/continuations", "/continue-show", "/checkpoints", "/checkpoint-show", "/resume-anchors", "/resume-anchor", "/handoff-followups", "/handoff-followup",
  "/missions", "/mission", "/reasoning",
])

const WRITE_COMMANDS = new Set([
  "/scheduler-start", "/scheduler-stop", "/wake-tick", "/wake-tick-dry-run", "/scheduler-recovery-ack", "/scheduler-recovery-resolve",
  "/scheduler-recovery-dismiss", "/scheduler-recovery-workflow", "/scheduler-recovery-step-done", "/scheduler-recovery-step-skip",
  "/scheduler-recovery-step-block", "/scheduler-recovery-workflow-cancel", "/checkpoint", "/continue-step", "/continue-plan", "/continue-pause", "/continue-cancel",
])

const HIGH_IMPACT = new Set(["/handoff", "/apply", "/approve", "/reject", "/complete", "/fail", "/cancel", "/api-call", "/synthesize", "/cycle"])

function read(command: string, target_kind: WakeSchedulerNavigationTargetKind, target_id?: string): ClassifiedWakeSchedulerNavigationCommand {
  return { command, command_type: "read", risk: "safe_read", target_kind, target_id: cleanOptionalId(target_id), supported: true, blockers: [], notes: ["read-only inspection command; navigation does not execute it"], equivalent_runtime_command: runtimeFor(command) }
}

function write(command: string, target_kind: WakeSchedulerNavigationTargetKind, target_id: string | undefined, note: string): ClassifiedWakeSchedulerNavigationCommand {
  return { command, command_type: "write", risk: "write_requires_operator", target_kind, target_id: cleanOptionalId(target_id), supported: true, blockers: ["navigation is read-only and will not run this command"], notes: [note], equivalent_runtime_command: runtimeFor(command) }
}

function highImpact(command: string, target_kind: WakeSchedulerNavigationTargetKind, target_id?: string): ClassifiedWakeSchedulerNavigationCommand {
  return { command, command_type: "write", risk: "high_impact_write", target_kind, target_id: cleanOptionalId(target_id), supported: false, blockers: ["high-impact command is not supported by scheduler navigation"], notes: ["shown only if encountered in recommendations; execute through the explicit owner surface, not navigation"] }
}

function unsupported(command: string, reason: string): ClassifiedWakeSchedulerNavigationCommand {
  return { command, command_type: "read", risk: "unsupported", target_kind: "unknown", supported: false, blockers: [reason], notes: ["unsupported command is displayed as text only"] }
}

function targetForRead(name: string, arg?: string): WakeSchedulerNavigationTargetKind {
  if (name.startsWith("/scheduler-audit")) return "scheduler_audit"
  if (name.startsWith("/scheduler-bootstrap")) return "scheduler_bootstrap"
  if (name.startsWith("/scheduler-recovery-workflow")) return "scheduler_recovery_workflow"
  if (name.startsWith("/scheduler-recovery")) return "scheduler_recovery"
  if (name === "/scheduler-status" || name === "/scheduler-events") return "scheduler_status"
  if (name.startsWith("/wake-tick")) return "wake_tick"
  if (name === "/wake-schedules" || name === "/wake-schedule") return "wake_schedule"
  if (name === "/wake-preview" || name === "/wake-show") return "wake_assessment"
  if (name === "/continuations" || name === "/continue-show") return "continuation_plan"
  if (name === "/checkpoints" || name === "/checkpoint-show") return "checkpoint"
  if (name === "/resume-anchors" || name === "/resume-anchor") return "resume_anchor"
  if (name === "/handoff-followups" || name === "/handoff-followup") return "handoff_followup"
  if (name === "/missions" || name === "/mission") return "mission"
  return arg ? "unknown" : "unknown"
}

function targetForWrite(name: string, _arg?: string): WakeSchedulerNavigationTargetKind {
  if (name.startsWith("/scheduler-recovery-workflow") || name.startsWith("/scheduler-recovery-step")) return "scheduler_recovery_workflow"
  if (name.startsWith("/scheduler-recovery")) return "scheduler_recovery"
  if (name.startsWith("/scheduler")) return "scheduler_status"
  if (name.startsWith("/wake-tick")) return "wake_tick"
  if (name.startsWith("/continue")) return "continuation_plan"
  if (name === "/checkpoint") return "checkpoint"
  return "unknown"
}

function targetForHighImpact(name: string, _arg?: string): WakeSchedulerNavigationTargetKind {
  if (name === "/handoff") return "handoff_followup"
  if (name === "/complete" || name === "/fail" || name === "/cancel") return "mission"
  return "unknown"
}

function runtimeFor(command: string): string | undefined {
  const name = command.split(/\s+/)[0]
  const map: Record<string, string> = {
    "/scheduler-status": "runtime.wake_scheduler_status",
    "/scheduler-events": "runtime.list_wake_scheduler_events",
    "/scheduler-bootstrap": "runtime.wake_scheduler_bootstrap_status",
    "/scheduler-bootstrap-preview": "runtime.preview_wake_scheduler_bootstrap",
    "/scheduler-recovery": "runtime.preview_wake_scheduler_recovery",
    "/scheduler-recovery-preview": "runtime.preview_wake_scheduler_recovery",
    "/scheduler-recoveries": "runtime.list_wake_scheduler_recoveries",
    "/scheduler-recovery-show": "runtime.get_wake_scheduler_recovery",
    "/scheduler-recovery-workflows": "runtime.list_wake_scheduler_recovery_workflows",
    "/scheduler-recovery-workflow-show": "runtime.get_wake_scheduler_recovery_workflow",
    "/scheduler-recovery-workflow-verify": "runtime.verify_wake_scheduler_recovery_workflow",
    "/scheduler-audit": "runtime.wake_scheduler_audit_timeline",
    "/scheduler-audit-summary": "runtime.wake_scheduler_audit_summary",
    "/scheduler-audit-timeline": "runtime.wake_scheduler_audit_timeline",
    "/scheduler-audit-chain": "runtime.wake_scheduler_audit_chain",
    "/scheduler-audit-incidents": "runtime.wake_scheduler_audit_incidents",
  }
  return name ? map[name] : undefined
}

function targetCommands(kind: WakeSchedulerNavigationTargetKind, id: string): WakeSchedulerAuditCommand[] {
  const commands: WakeSchedulerAuditCommand[] = [{ label: "Scheduler audit chain", command: `/scheduler-audit-chain ${id}`, command_type: "read" }]
  if (kind === "scheduler_recovery") commands.push({ label: "Scheduler recovery", command: `/scheduler-recovery-show ${id}`, command_type: "read" })
  if (kind === "scheduler_recovery_workflow") commands.push({ label: "Recovery workflow", command: `/scheduler-recovery-workflow-show ${id}`, command_type: "read" })
  if (kind === "wake_schedule") commands.push({ label: "Wake schedule", command: `/wake-schedule ${id}`, command_type: "read" })
  if (kind === "wake_assessment") commands.push({ label: "Wake assessment", command: `/wake-show ${id}`, command_type: "read" })
  if (kind === "continuation_plan") commands.push({ label: "Continuation plan", command: `/continue-show ${id}`, command_type: "read" })
  if (kind === "checkpoint") commands.push({ label: "Checkpoint", command: `/checkpoint-show ${id}`, command_type: "read" })
  if (kind === "resume_anchor") commands.push({ label: "Resume anchor", command: `/resume-anchor ${id}`, command_type: "read" })
  if (kind === "handoff_followup") commands.push({ label: "Handoff follow-up", command: `/handoff-followup ${id}`, command_type: "read" })
  if (kind === "mission") commands.push({ label: "Mission", command: `/mission ${id}`, command_type: "read" })
  return commands
}

function normalizeTargetKind(value: string): WakeSchedulerNavigationTargetKind {
  const clean = cleanString(value, "target_kind")
  const aliases: Record<string, WakeSchedulerNavigationTargetKind> = {
    recovery: "scheduler_recovery",
    workflow: "scheduler_recovery_workflow",
    schedule: "wake_schedule",
    wake: "wake_assessment",
    continuation: "continuation_plan",
    resume: "resume_anchor",
    handoff: "handoff_followup",
  }
  const normalized = aliases[clean] ?? clean
  const allowed: WakeSchedulerNavigationTargetKind[] = ["scheduler_status", "scheduler_bootstrap", "scheduler_recovery", "scheduler_recovery_workflow", "scheduler_audit", "wake_schedule", "wake_tick", "wake_assessment", "continuation_plan", "checkpoint", "resume_anchor", "handoff_followup", "mission", "unknown"]
  if (!allowed.includes(normalized as WakeSchedulerNavigationTargetKind)) throw new Error("scheduler navigation target kind is invalid")
  return normalized as WakeSchedulerNavigationTargetKind
}

function summaryText(summary: WakeSchedulerAuditSummary, timelineCount: number, incidentCount: number): string {
  return `events=${summary.event_count} timeline=${timelineCount} incidents=${incidentCount} scheduler=${summary.latest_scheduler_status ?? "unknown"} recovery=${summary.latest_recovery_status ?? "unknown"}`
}

function mergeRelatedIds(entries: WakeSchedulerAuditTimelineEntry[]): Record<string, string[]> {
  const out: Record<string, Set<string>> = {}
  for (const entry of entries) for (const [key, values] of Object.entries(entry.related_ids)) {
    const bucket = out[key] ?? new Set<string>()
    for (const value of values) bucket.add(value)
    out[key] = bucket
  }
  return Object.fromEntries(Object.entries(out).map(([key, values]) => [key, [...values].sort()]))
}

function primaryId(relatedIds: Record<string, string[]>): string | undefined {
  for (const key of ["workflow_id", "recovery_id", "schedule_id", "tick_id", "wake_id", "plan_id", "step_id", "resume_id", "checkpoint_id", "event_id"]) {
    const value = relatedIds[key]?.[0]
    if (value) return value
  }
  return undefined
}

function readLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_LIMIT
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error("scheduler navigation limit must be a positive integer")
  return Math.min(Number(value), HARD_LIMIT)
}

function cleanString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return preview(value.trim())
}

function cleanCommand(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("scheduler navigation command is required")
  return preview(value.trim())
}

function cleanOptionalId(value: string | undefined): string | undefined {
  if (!value || value.includes("=")) return undefined
  return preview(value)
}

function labelForCommand(command: string): string {
  const name = command.split(/\s+/)[0] ?? command
  return preview(name.replace(/^\//, "").replaceAll("-", " "))
}

function preview(value: string): string {
  const clean = redactText(value).replace(/\s+/g, " ").trim()
  return clean.length > PREVIEW_CHARS ? `${clean.slice(0, PREVIEW_CHARS - 3)}...` : clean
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
