import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { WakeSchedulerNavigationWritePreviewService } from "./wake-scheduler-navigation-write-preview-service"
import type { WakeSchedulerNavigationWritePreview } from "./wake-scheduler-navigation-write-preview-types"
import type {
  WakeSchedulerNavigationStagedWriteCommand,
  WakeSchedulerNavigationStagedWriteCommandRecord,
  WakeSchedulerNavigationWriteStageClearInput,
  WakeSchedulerNavigationWriteStageEligibility,
  WakeSchedulerNavigationWriteStageInput,
  WakeSchedulerNavigationWriteStagePreview,
  WakeSchedulerNavigationWriteStageRemoveInput,
} from "./wake-scheduler-navigation-write-staging-types"

const DEFAULT_LIMIT = 20
const HARD_LIMIT = 100
const PREVIEW_CHARS = 220

const GENERIC_7T_BLOCKER = "Branch 7T previews write eligibility only; can_stage_now=false and can_execute_now=false"
const LOW_RISK_ALLOWED = new Set(["/wake-tick-dry-run", "/scheduler-nav-run"])
const MEDIUM_RISK_ALLOWED = new Set([
  "/checkpoint",
  "/scheduler-recovery-ack",
  "/scheduler-recovery-resolve",
  "/scheduler-recovery-dismiss",
  "/scheduler-recovery-workflow",
  "/scheduler-recovery-step-done",
  "/scheduler-recovery-step-skip",
  "/scheduler-recovery-step-block",
  "/scheduler-recovery-workflow-cancel",
  "/continue-plan",
  "/continue-pause",
  "/continue-cancel",
])
const EXPLICITLY_BLOCKED = new Set([
  "/scheduler-start",
  "/scheduler-stop",
  "/wake-tick",
  "/continue-step",
  "/handoff",
  "/apply",
  "/approve",
  "/reject",
  "/complete",
  "/fail",
  "/cancel",
  "/synthesize",
  "/cycle",
  "/api-call",
  "/request-review",
  "/cancel-review",
  "/proposal-review",
  "/apply-proposal",
  "/cancel-proposal",
  "/bundle-review",
  "/apply-bundle",
  "/cancel-bundle",
  "/draft-review",
  "/cancel-draft",
  "/apply-target",
  "/apply-partial",
])

interface NormalizedStageInput {
  command: string
  allow_medium_risk: boolean
  source_related_id?: string
  source_incident_id?: string
  source_staged_id?: string
  source_board_id?: string
  requested_by: string
}

interface NormalizedRemoveInput {
  staged_write_id: string
  reason?: string
  requested_by: string
}

interface NormalizedClearInput {
  reason?: string
  requested_by: string
}

export class WakeSchedulerNavigationWriteStagingService {
  constructor(
    private readonly eventStore: EventStore,
    private readonly previewService: WakeSchedulerNavigationWritePreviewService,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async preview(input: WakeSchedulerNavigationWriteStageInput): Promise<WakeSchedulerNavigationWriteStagePreview> {
    const normalized = readStageInput(input)
    const writePreview = await this.previewService.preview({ command: normalized.command })
    const eligibility = stageEligibility(writePreview, normalized.allow_medium_risk)
    const existing = eligibility.can_stage ? await this.findActiveByHash(stageHash(eligibility)) : undefined
    return redactValue({
      command: eligibility.command,
      eligibility,
      existing_staged_id: existing?.staged_write_id,
      blockers: eligibility.blockers,
      warnings: [...eligibility.warnings, ...(existing ? ["matching write command is already staged"] : [])],
    })
  }

  async stage(input: WakeSchedulerNavigationWriteStageInput): Promise<WakeSchedulerNavigationStagedWriteCommand> {
    const normalized = readStageInput(input)
    const writePreview = await this.previewService.preview({ command: normalized.command })
    const eligibility = stageEligibility(writePreview, normalized.allow_medium_risk)
    if (!eligibility.can_stage) throw new Error(`scheduler navigation write command cannot be staged: ${eligibility.blockers.join("; ")}`)
    const existing = await this.findActiveByHash(stageHash(eligibility))
    if (existing) return existing
    const staged = stagedWriteCommand(normalized, writePreview, eligibility, this.now())
    await this.eventStore.append({
      kind: "runtime_wake_scheduler_navigation_write_command_staged",
      created_at: staged.staged_at,
      staged_write_id: staged.staged_write_id,
      command: staged.command,
      command_name: staged.command_name,
      risk: staged.risk,
      authority_gate: staged.authority_gate,
      target_kind: staged.target_kind,
      target_id: staged.target_id,
      equivalent_runtime_command: staged.equivalent_runtime_command,
      prerequisites: staged.prerequisites,
      safer_read_commands: staged.safer_read_commands,
      future_stage_policy: staged.future_stage_policy,
      source_preview_hash: staged.source_preview_hash,
      source_related_id: staged.source_related_id,
      source_incident_id: staged.source_incident_id,
      source_staged_id: staged.source_staged_id,
      source_board_id: staged.source_board_id,
      staged_at: staged.staged_at,
      staged_by: staged.staged_by,
      status: staged.status,
      stage_hash: staged.stage_hash,
      summary_preview: staged.summary_preview,
    })
    return redactValue(staged)
  }

  async list(limit = DEFAULT_LIMIT): Promise<WakeSchedulerNavigationStagedWriteCommandRecord[]> {
    return this.recordsFromActive(await this.active(), readLimit(limit))
  }

  async get(stagedWriteId: string): Promise<WakeSchedulerNavigationStagedWriteCommand | null> {
    const staged = (await this.active()).find((item) => item.staged_write_id === cleanString(stagedWriteId, "staged_write_id")) ?? null
    return staged ? redactValue(staged) : null
  }

  async activeCommands(): Promise<WakeSchedulerNavigationStagedWriteCommand[]> {
    return redactValue(await this.active())
  }

  async remove(input: WakeSchedulerNavigationWriteStageRemoveInput): Promise<WakeSchedulerNavigationStagedWriteCommand | null> {
    const normalized = readRemoveInput(input)
    const active = await this.active()
    const staged = active.find((item) => item.staged_write_id === normalized.staged_write_id) ?? null
    await this.eventStore.append({
      kind: "runtime_wake_scheduler_navigation_write_command_removed",
      created_at: this.now(),
      staged_write_id: normalized.staged_write_id,
      reason: normalized.reason,
      requested_by: normalized.requested_by,
    })
    return staged ? redactValue(staged) : null
  }

  async clear(input: WakeSchedulerNavigationWriteStageClearInput = {}): Promise<WakeSchedulerNavigationStagedWriteCommandRecord[]> {
    const normalized = readClearInput(input)
    const active = await this.active()
    await this.eventStore.append({
      kind: "runtime_wake_scheduler_navigation_write_commands_cleared",
      created_at: this.now(),
      cleared_count: active.length,
      reason: normalized.reason,
      requested_by: normalized.requested_by,
    })
    return this.recordsFromActive([], DEFAULT_LIMIT)
  }

  private async findActiveByHash(hash: string): Promise<WakeSchedulerNavigationStagedWriteCommand | undefined> {
    return (await this.active()).find((item) => item.stage_hash === hash)
  }

  private async active(): Promise<WakeSchedulerNavigationStagedWriteCommand[]> {
    const active = new Map<string, WakeSchedulerNavigationStagedWriteCommand>()
    for (const event of await this.eventStore.readAll()) {
      const kind = String(event.kind ?? "")
      if (kind === "runtime_wake_scheduler_navigation_write_command_staged") {
        const staged = stagedFromEvent(event)
        if (staged) active.set(staged.stage_hash, staged)
      } else if (kind === "runtime_wake_scheduler_navigation_write_command_removed") {
        const stagedWriteId = typeof event.staged_write_id === "string" ? event.staged_write_id : undefined
        if (stagedWriteId) for (const [hash, staged] of active) if (staged.staged_write_id === stagedWriteId) active.delete(hash)
      } else if (kind === "runtime_wake_scheduler_navigation_write_commands_cleared") {
        active.clear()
      }
    }
    return [...active.values()].sort((left, right) => right.staged_at.localeCompare(left.staged_at) || left.staged_write_id.localeCompare(right.staged_write_id))
  }

  private recordsFromActive(active: WakeSchedulerNavigationStagedWriteCommand[], limit: number): WakeSchedulerNavigationStagedWriteCommandRecord[] {
    return redactValue(active.slice(0, limit).map((staged) => ({
      staged_write_id: staged.staged_write_id,
      command: staged.command,
      risk: staged.risk,
      authority_gate: staged.authority_gate,
      target_kind: staged.target_kind,
      target_id: staged.target_id,
      staged_at: staged.staged_at,
      staged_by: staged.staged_by,
      summary_preview: staged.summary_preview,
      stage_hash: staged.stage_hash,
    })))
  }
}

export function readWakeSchedulerNavigationWriteStageInput(value: unknown): WakeSchedulerNavigationWriteStageInput {
  return readStageInput(value)
}

export function readWakeSchedulerNavigationWriteStageRemoveInput(value: unknown): WakeSchedulerNavigationWriteStageRemoveInput {
  return readRemoveInput(value)
}

export function readWakeSchedulerNavigationWriteStageClearInput(value: unknown): WakeSchedulerNavigationWriteStageClearInput {
  return readClearInput(value)
}

function stageEligibility(writePreview: WakeSchedulerNavigationWritePreview, allowMediumRisk: boolean): WakeSchedulerNavigationWriteStageEligibility {
  const blockers: string[] = []
  if (writePreview.command_type !== "write") blockers.push("only write previews can be staged by 7U")
  if (writePreview.risk === "unsupported" || writePreview.status === "unsupported") blockers.push("unsupported write commands cannot be staged")
  if (writePreview.risk === "high_impact_write") blockers.push("high-impact write commands cannot be staged in 7U")
  if (EXPLICITLY_BLOCKED.has(writePreview.command_name)) blockers.push(`${writePreview.command_name} is not allowed in the 7U write staging whitelist`)
  if (writePreview.risk === "low_risk_write" && !LOW_RISK_ALLOWED.has(writePreview.command_name)) blockers.push(`${writePreview.command_name} is not an allowed low-risk staged write`)
  if (writePreview.risk === "medium_risk_write") {
    if (!MEDIUM_RISK_ALLOWED.has(writePreview.command_name)) blockers.push(`${writePreview.command_name} is not an allowed medium-risk staged write`)
    if (!allowMediumRisk) blockers.push("medium-risk write staging requires allow_medium_risk=true")
  }
  const hardPreviewBlockers = writePreview.blockers.filter((blocker) => blocker !== GENERIC_7T_BLOCKER)
  blockers.push(...hardPreviewBlockers)
  return redactValue({
    can_stage: blockers.length === 0 && (writePreview.risk === "low_risk_write" || (writePreview.risk === "medium_risk_write" && allowMediumRisk)),
    command: writePreview.command,
    command_name: writePreview.command_name,
    risk: writePreview.risk,
    authority_gate: writePreview.authority_gate,
    status: writePreview.status,
    target_kind: writePreview.target_kind,
    target_id: writePreview.target_id,
    blockers: [...new Set(blockers)].slice(0, 10).map(preview),
    warnings: [...writePreview.warnings, "7U stages write intent only; it does not execute staged write commands"].slice(0, 10).map(preview),
    prerequisites: writePreview.prerequisites,
    safer_read_commands: writePreview.safer_read_commands,
    future_stage_policy: writePreview.future_stage_policy,
    redacted_summary_preview: preview(`${writePreview.risk} ${writePreview.authority_gate}: ${writePreview.command}`),
  })
}

function stagedWriteCommand(input: NormalizedStageInput, writePreview: WakeSchedulerNavigationWritePreview, eligibility: WakeSchedulerNavigationWriteStageEligibility, now: string): WakeSchedulerNavigationStagedWriteCommand {
  const sourcePreviewHash = hashText(stableJson({
    command: writePreview.command,
    command_name: writePreview.command_name,
    risk: writePreview.risk,
    authority_gate: writePreview.authority_gate,
    target_kind: writePreview.target_kind,
    target_id: writePreview.target_id,
    prerequisites: writePreview.prerequisites,
    future_stage_policy: writePreview.future_stage_policy,
  }))
  const hash = stageHash(eligibility)
  const summary = preview(`${eligibility.risk} ${eligibility.authority_gate}: ${eligibility.command}`)
  return redactValue({
    staged_write_id: `wake_scheduler_navigation_write_staged_${hash.slice(0, 16)}`,
    command: eligibility.command,
    command_name: eligibility.command_name,
    risk: eligibility.risk,
    authority_gate: eligibility.authority_gate,
    target_kind: eligibility.target_kind,
    target_id: eligibility.target_id,
    equivalent_runtime_command: writePreview.equivalent_runtime_command,
    prerequisites: eligibility.prerequisites,
    safer_read_commands: eligibility.safer_read_commands,
    future_stage_policy: eligibility.future_stage_policy,
    source_preview_hash: sourcePreviewHash,
    source_related_id: input.source_related_id,
    source_incident_id: input.source_incident_id,
    source_staged_id: input.source_staged_id,
    source_board_id: input.source_board_id,
    staged_at: now,
    staged_by: input.requested_by,
    status: "staged" as const,
    stage_hash: hash,
    summary_preview: summary,
  })
}

function stagedFromEvent(event: JsonlEvent): WakeSchedulerNavigationStagedWriteCommand | null {
  if (typeof event.staged_write_id !== "string" || typeof event.command !== "string" || typeof event.stage_hash !== "string") return null
  return redactValue({
    staged_write_id: preview(event.staged_write_id),
    command: readString(event.command, ""),
    command_name: readString(event.command_name, event.command.split(/\s+/)[0] ?? ""),
    risk: readRisk(event.risk),
    authority_gate: readAuthorityGate(event.authority_gate),
    target_kind: readString(event.target_kind, "unknown"),
    target_id: typeof event.target_id === "string" ? preview(event.target_id) : undefined,
    equivalent_runtime_command: typeof event.equivalent_runtime_command === "string" ? preview(event.equivalent_runtime_command) : undefined,
    prerequisites: Array.isArray(event.prerequisites) ? event.prerequisites.filter(isRecord).slice(0, 20).map((item) => ({
      name: readString(item.name, ""),
      satisfied: item.satisfied === true,
      severity: item.severity === "warning" || item.severity === "error" ? item.severity : "info",
      summary: readString(item.summary, ""),
    })) : [],
    safer_read_commands: Array.isArray(event.safer_read_commands) ? event.safer_read_commands.filter(isRecord).slice(0, 10).map((item) => ({
      label: readString(item.label, ""),
      command: readString(item.command, ""),
      command_type: item.command_type === "write" ? "write" as const : "read" as const,
      risk: typeof item.risk === "string" ? preview(item.risk) : undefined,
      requires_active_runtime: typeof item.requires_active_runtime === "boolean" ? item.requires_active_runtime : undefined,
      notes: typeof item.notes === "string" ? preview(item.notes) : undefined,
    })) : [],
    future_stage_policy: isRecord(event.future_stage_policy) ? {
      would_require_active_runtime: event.future_stage_policy.would_require_active_runtime === true,
      would_require_run_lock: event.future_stage_policy.would_require_run_lock === true,
      would_require_confirmation: event.future_stage_policy.would_require_confirmation === true,
      would_require_approval_record: event.future_stage_policy.would_require_approval_record === true,
      would_require_dry_run_first: event.future_stage_policy.would_require_dry_run_first === true,
      would_require_recent_read_evidence: event.future_stage_policy.would_require_recent_read_evidence === true,
      allowed_in_7t: false,
    } : undefined,
    source_preview_hash: readString(event.source_preview_hash, ""),
    source_related_id: typeof event.source_related_id === "string" ? preview(event.source_related_id) : undefined,
    source_incident_id: typeof event.source_incident_id === "string" ? preview(event.source_incident_id) : undefined,
    source_staged_id: typeof event.source_staged_id === "string" ? preview(event.source_staged_id) : undefined,
    source_board_id: typeof event.source_board_id === "string" ? preview(event.source_board_id) : undefined,
    staged_at: readString(event.staged_at ?? event.created_at, ""),
    staged_by: readString(event.staged_by, "operator"),
    status: "staged" as const,
    stage_hash: readString(event.stage_hash, ""),
    summary_preview: readString(event.summary_preview, ""),
  })
}

function readStageInput(value: unknown): NormalizedStageInput {
  if (!isRecord(value)) throw new Error("scheduler navigation write stage input is required")
  return {
    command: cleanString(value.command, "command"),
    allow_medium_risk: value.allow_medium_risk === true || value.allowMediumRisk === true,
    source_related_id: optionalCleanString(value.source_related_id ?? value.sourceRelatedId),
    source_incident_id: optionalCleanString(value.source_incident_id ?? value.sourceIncidentId),
    source_staged_id: optionalCleanString(value.source_staged_id ?? value.sourceStagedId),
    source_board_id: optionalCleanString(value.source_board_id ?? value.sourceBoardId),
    requested_by: optionalCleanString(value.requested_by ?? value.requestedBy) ?? "scheduler-navigation-write-staging",
  }
}

function readRemoveInput(value: unknown): NormalizedRemoveInput {
  if (!isRecord(value)) throw new Error("scheduler navigation write stage remove input is required")
  return {
    staged_write_id: cleanString(value.staged_write_id ?? value.stagedWriteId, "staged_write_id"),
    reason: optionalCleanString(value.reason),
    requested_by: optionalCleanString(value.requested_by ?? value.requestedBy) ?? "scheduler-navigation-write-staging",
  }
}

function readClearInput(value: unknown): NormalizedClearInput {
  const record = isRecord(value) ? value : {}
  return {
    reason: optionalCleanString(record.reason),
    requested_by: optionalCleanString(record.requested_by ?? record.requestedBy) ?? "scheduler-navigation-write-staging",
  }
}

function stageHash(eligibility: WakeSchedulerNavigationWriteStageEligibility): string {
  return hashText(stableJson({ command: eligibility.command, authority_gate: eligibility.authority_gate, risk: eligibility.risk }))
}

function readLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_LIMIT
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error("scheduler navigation staged write limit must be a positive integer")
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

function readRisk(value: unknown): WakeSchedulerNavigationWriteStageEligibility["risk"] {
  return value === "low_risk_write" || value === "medium_risk_write" || value === "high_impact_write" || value === "unsupported" ? value : "unsupported"
}

function readAuthorityGate(value: unknown): WakeSchedulerNavigationWriteStageEligibility["authority_gate"] {
  switch (value) {
    case "wake_scheduler_runtime":
    case "wake_schedule_tick":
    case "checkpoint_runtime":
    case "recovery_runtime":
    case "recovery_workflow_runtime":
    case "continuation_runtime":
    case "handoff_runtime":
    case "mission_runtime":
    case "proposal_review_runtime":
    case "reasoning_provider_runtime":
      return value
    default:
      return "unknown"
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`
  return JSON.stringify(value)
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function preview(value: string): string {
  const clean = redactText(value).replace(/\s+/g, " ").trim()
  return clean.length > PREVIEW_CHARS ? `${clean.slice(0, PREVIEW_CHARS - 3)}...` : clean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
