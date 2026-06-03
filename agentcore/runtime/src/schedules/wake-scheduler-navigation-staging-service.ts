import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import { classifyWakeSchedulerNavigationCommand } from "./wake-scheduler-navigation-service"
import type {
  WakeSchedulerNavigationStageRisk,
  WakeSchedulerNavigationStageTargetKind,
  WakeSchedulerNavigationStageClearInput,
  WakeSchedulerNavigationStageEligibility,
  WakeSchedulerNavigationStageInput,
  WakeSchedulerNavigationStagePreview,
  WakeSchedulerNavigationStageRemoveInput,
  WakeSchedulerNavigationStagedCommand,
  WakeSchedulerNavigationStagedCommandRecord,
} from "./wake-scheduler-navigation-staging-types"

const DEFAULT_LIMIT = 20
const HARD_LIMIT = 100
const PREVIEW_CHARS = 220

interface NormalizedStageInput {
  command: string
  source_board_id?: string
  source_card_id?: string
  source_audit_id?: string
  source_incident_id?: string
  source_related_id?: string
  requested_by: string
}

interface NormalizedRemoveInput {
  staged_id: string
  reason?: string
  requested_by: string
}

interface NormalizedClearInput {
  reason?: string
  requested_by: string
}

export class WakeSchedulerNavigationStagingService {
  constructor(private readonly eventStore: EventStore, private readonly now: () => string = () => new Date().toISOString()) {}

  async preview(input: WakeSchedulerNavigationStageInput): Promise<WakeSchedulerNavigationStagePreview> {
    const normalized = readStageInput(input)
    const eligibility = stageEligibility(normalized.command)
    const existing = eligibility.can_stage ? await this.findActiveByHash(stageHash(eligibility.command)) : undefined
    return redactValue({
      command: eligibility.command,
      source_card_id: normalized.source_card_id,
      source_board_id: normalized.source_board_id,
      eligibility,
      existing_staged_id: existing?.staged_id,
      blockers: eligibility.blockers,
      warnings: [...eligibility.warnings, ...(existing ? ["matching safe-read command is already staged"] : [])],
    })
  }

  async stage(input: WakeSchedulerNavigationStageInput): Promise<WakeSchedulerNavigationStagedCommand> {
    const normalized = readStageInput(input)
    const eligibility = stageEligibility(normalized.command)
    if (!eligibility.can_stage) throw new Error(`scheduler navigation command cannot be staged: ${eligibility.blockers.join("; ")}`)
    const existing = await this.findActiveByHash(stageHash(eligibility.command))
    if (existing) return existing
    const staged = stagedCommand(normalized, eligibility, this.now())
    await this.eventStore.append({
      kind: "runtime_wake_scheduler_navigation_command_staged",
      created_at: staged.staged_at,
      staged_id: staged.staged_id,
      command: staged.command,
      command_type: staged.command_type,
      risk: staged.risk,
      target_kind: staged.target_kind,
      target_id: staged.target_id,
      source_board_id: staged.source_board_id,
      source_card_id: staged.source_card_id,
      source_audit_id: staged.source_audit_id,
      source_incident_id: staged.source_incident_id,
      source_related_id: staged.source_related_id,
      label: staged.label,
      notes: staged.notes,
      staged_at: staged.staged_at,
      staged_by: staged.staged_by,
      stage_hash: staged.stage_hash,
      summary_preview: summaryPreview(staged),
    })
    return redactValue(staged)
  }

  async list(limit = DEFAULT_LIMIT): Promise<WakeSchedulerNavigationStagedCommandRecord[]> {
    return this.recordsFromActive(await this.active(), readLimit(limit))
  }

  async get(stagedId: string): Promise<WakeSchedulerNavigationStagedCommand | null> {
    const staged = (await this.active()).find((item) => item.staged_id === cleanString(stagedId, "staged_id")) ?? null
    return staged ? redactValue(staged) : null
  }

  async remove(input: WakeSchedulerNavigationStageRemoveInput): Promise<WakeSchedulerNavigationStagedCommand | null> {
    const normalized = readRemoveInput(input)
    const active = await this.active()
    const staged = active.find((item) => item.staged_id === normalized.staged_id) ?? null
    await this.eventStore.append({
      kind: "runtime_wake_scheduler_navigation_command_removed",
      created_at: this.now(),
      staged_id: normalized.staged_id,
      reason: normalized.reason,
      requested_by: normalized.requested_by,
    })
    return staged ? redactValue(staged) : null
  }

  async clear(input: WakeSchedulerNavigationStageClearInput = {}): Promise<WakeSchedulerNavigationStagedCommandRecord[]> {
    const normalized = readClearInput(input)
    const active = await this.active()
    await this.eventStore.append({
      kind: "runtime_wake_scheduler_navigation_commands_cleared",
      created_at: this.now(),
      cleared_count: active.length,
      reason: normalized.reason,
      requested_by: normalized.requested_by,
    })
    return this.recordsFromActive([], DEFAULT_LIMIT)
  }

  private async findActiveByHash(hash: string): Promise<WakeSchedulerNavigationStagedCommand | undefined> {
    return (await this.active()).find((item) => item.stage_hash === hash)
  }

  private async active(): Promise<WakeSchedulerNavigationStagedCommand[]> {
    const active = new Map<string, WakeSchedulerNavigationStagedCommand>()
    for (const event of await this.eventStore.readAll()) {
      const kind = String(event.kind ?? "")
      if (kind === "runtime_wake_scheduler_navigation_command_staged") {
        const staged = stagedFromEvent(event)
        if (staged) active.set(staged.stage_hash, staged)
      } else if (kind === "runtime_wake_scheduler_navigation_command_removed") {
        const stagedId = typeof event.staged_id === "string" ? event.staged_id : undefined
        if (stagedId) {
          for (const [hash, staged] of active) if (staged.staged_id === stagedId) active.delete(hash)
        }
      } else if (kind === "runtime_wake_scheduler_navigation_commands_cleared") {
        active.clear()
      }
    }
    return [...active.values()].sort((left, right) => right.staged_at.localeCompare(left.staged_at) || left.staged_id.localeCompare(right.staged_id))
  }

  private recordsFromActive(active: WakeSchedulerNavigationStagedCommand[], limit: number): WakeSchedulerNavigationStagedCommandRecord[] {
    return redactValue(active.slice(0, limit).map((staged) => ({
      staged_id: staged.staged_id,
      command: staged.command,
      risk: staged.risk,
      target_kind: staged.target_kind,
      target_id: staged.target_id,
      staged_at: staged.staged_at,
      staged_by: staged.staged_by,
      summary_preview: summaryPreview(staged),
      stage_hash: staged.stage_hash,
    })))
  }
}

export function readWakeSchedulerNavigationStageInput(value: unknown): WakeSchedulerNavigationStageInput {
  return readStageInput(value)
}

export function readWakeSchedulerNavigationStageRemoveInput(value: unknown): WakeSchedulerNavigationStageRemoveInput {
  return readRemoveInput(value)
}

export function readWakeSchedulerNavigationStageClearInput(value: unknown): WakeSchedulerNavigationStageClearInput {
  return readClearInput(value)
}

function stageEligibility(command: string): WakeSchedulerNavigationStageEligibility {
  const classified = classifyWakeSchedulerNavigationCommand(command)
  const blockers: string[] = []
  if (!classified.supported) blockers.push(...classified.blockers)
  if (classified.risk === "write_requires_operator") blockers.push("write navigation commands cannot be staged in 7Q")
  if (classified.risk === "high_impact_write") blockers.push("high-impact navigation commands cannot be staged in 7Q")
  if (classified.risk === "unsupported") blockers.push("unsupported navigation commands cannot be staged")
  if (classified.command_type !== "read") blockers.push("only safe-read navigation commands can be staged")
  return redactValue({
    can_stage: blockers.length === 0 && classified.risk === "safe_read" && classified.supported,
    command: classified.command,
    command_type: classified.command_type,
    risk: classified.risk,
    target_kind: classified.target_kind,
    target_id: classified.target_id,
    blockers: [...new Set(blockers)].slice(0, 10),
    warnings: ["staging records command text only; it does not execute commands"],
    redacted_summary_preview: preview(`${classified.risk} ${classified.target_kind}${classified.target_id ? ` ${classified.target_id}` : ""}: ${classified.command}`),
  })
}

function stagedCommand(input: NormalizedStageInput, eligibility: WakeSchedulerNavigationStageEligibility, now: string): WakeSchedulerNavigationStagedCommand {
  const hash = stageHash(eligibility.command)
  return redactValue({
    staged_id: `wake_scheduler_navigation_staged_${hash.slice(0, 16)}`,
    command: eligibility.command,
    command_type: eligibility.command_type,
    risk: eligibility.risk,
    target_kind: eligibility.target_kind,
    target_id: eligibility.target_id,
    source_board_id: input.source_board_id,
    source_card_id: input.source_card_id,
    source_audit_id: input.source_audit_id,
    source_incident_id: input.source_incident_id,
    source_related_id: input.source_related_id,
    label: labelForCommand(eligibility.command),
    notes: ["navigation-origin safe-read command; not executed automatically"],
    staged_at: now,
    staged_by: input.requested_by,
    status: "staged",
    stage_hash: hash,
  })
}

function stagedFromEvent(event: JsonlEvent): WakeSchedulerNavigationStagedCommand | null {
  if (typeof event.staged_id !== "string" || typeof event.command !== "string" || typeof event.stage_hash !== "string") return null
  return redactValue({
    staged_id: event.staged_id,
    command: readString(event.command, ""),
    command_type: event.command_type === "write" ? "write" : "read",
    risk: readRisk(event.risk),
    target_kind: readTargetKind(event.target_kind),
    target_id: typeof event.target_id === "string" ? preview(event.target_id) : undefined,
    source_board_id: typeof event.source_board_id === "string" ? preview(event.source_board_id) : undefined,
    source_card_id: typeof event.source_card_id === "string" ? preview(event.source_card_id) : undefined,
    source_audit_id: typeof event.source_audit_id === "string" ? preview(event.source_audit_id) : undefined,
    source_incident_id: typeof event.source_incident_id === "string" ? preview(event.source_incident_id) : undefined,
    source_related_id: typeof event.source_related_id === "string" ? preview(event.source_related_id) : undefined,
    label: readString(event.label, labelForCommand(event.command)),
    notes: Array.isArray(event.notes) ? event.notes.filter((item): item is string => typeof item === "string").slice(0, 10).map(preview) : [],
    staged_at: readString(event.staged_at ?? event.created_at, ""),
    staged_by: readString(event.staged_by, "operator"),
    status: "staged",
    stage_hash: event.stage_hash,
  })
}

function readRisk(value: unknown): WakeSchedulerNavigationStageRisk {
  return value === "safe_read" || value === "write_requires_operator" || value === "high_impact_write" || value === "unsupported" ? value : "unsupported"
}

function readTargetKind(value: unknown): WakeSchedulerNavigationStageTargetKind {
  switch (value) {
    case "scheduler_status":
    case "scheduler_bootstrap":
    case "scheduler_recovery":
    case "scheduler_recovery_workflow":
    case "scheduler_audit":
    case "wake_schedule":
    case "wake_tick":
    case "wake_assessment":
    case "continuation_plan":
    case "checkpoint":
    case "resume_anchor":
    case "handoff_followup":
    case "mission":
      return value
    default:
      return "unknown"
  }
}

function readStageInput(value: unknown): NormalizedStageInput {
  if (!isRecord(value)) throw new Error("scheduler navigation stage input is required")
  return {
    command: cleanString(value.command, "command"),
    source_board_id: optionalCleanString(value.source_board_id ?? value.sourceBoardId),
    source_card_id: optionalCleanString(value.source_card_id ?? value.sourceCardId),
    source_audit_id: optionalCleanString(value.source_audit_id ?? value.sourceAuditId),
    source_incident_id: optionalCleanString(value.source_incident_id ?? value.sourceIncidentId),
    source_related_id: optionalCleanString(value.source_related_id ?? value.sourceRelatedId),
    requested_by: optionalCleanString(value.requested_by ?? value.requestedBy) ?? "scheduler-navigation-staging",
  }
}

function readRemoveInput(value: unknown): NormalizedRemoveInput {
  if (!isRecord(value)) throw new Error("scheduler navigation stage remove input is required")
  return {
    staged_id: cleanString(value.staged_id ?? value.stagedId, "staged_id"),
    reason: optionalCleanString(value.reason),
    requested_by: optionalCleanString(value.requested_by ?? value.requestedBy) ?? "scheduler-navigation-staging",
  }
}

function readClearInput(value: unknown): NormalizedClearInput {
  const record = isRecord(value) ? value : {}
  return {
    reason: optionalCleanString(record.reason),
    requested_by: optionalCleanString(record.requested_by ?? record.requestedBy) ?? "scheduler-navigation-staging",
  }
}

function summaryPreview(staged: WakeSchedulerNavigationStagedCommand): string {
  return preview(`${staged.risk} ${staged.target_kind}: ${staged.command}`)
}

function labelForCommand(command: string): string {
  const name = command.split(/\s+/)[0] ?? command
  return preview(name.replace(/^\//, "").replaceAll("-", " "))
}

function stageHash(command: string): string {
  return createHash("sha256").update(command).digest("hex")
}

function readLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_LIMIT
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error("scheduler navigation staged command limit must be a positive integer")
  return Math.min(Number(value), HARD_LIMIT)
}

function cleanString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return preview(value.trim())
}

function optionalCleanString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  return cleanString(value, "optional string")
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? preview(value) : fallback
}

function preview(value: string): string {
  const clean = redactText(value).replace(/\s+/g, " ").trim()
  return clean.length > PREVIEW_CHARS ? `${clean.slice(0, PREVIEW_CHARS - 3)}...` : clean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
