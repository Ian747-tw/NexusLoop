import { createHash, randomUUID } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import { readRuntimeCheckpointScope } from "../checkpoints/runtime-checkpoint-service"
import type { RuntimeCheckpointScope } from "../checkpoints/runtime-checkpoint-types"
import type { WakeSchedulerNavigationWriteApprovalService } from "./wake-scheduler-navigation-write-approval-service"
import type { WakeSchedulerNavigationWriteStagingService } from "./wake-scheduler-navigation-write-staging-service"
import type { WakeSchedulerNavigationCheckpointWriteExecutor } from "./wake-scheduler-navigation-checkpoint-write-executor"
import type {
  WakeSchedulerNavigationCheckpointWriteRunInput,
  WakeSchedulerNavigationCheckpointWriteRunListInput,
  WakeSchedulerNavigationCheckpointWriteRunPreview,
  WakeSchedulerNavigationCheckpointWriteRunRecord,
  WakeSchedulerNavigationCheckpointWriteRunResult,
} from "./wake-scheduler-navigation-checkpoint-write-run-types"

const DEFAULT_LIMIT = 20
const HARD_LIMIT = 100
const PREVIEW_CHARS = 1024

interface ParsedCheckpointCommand {
  scope?: RuntimeCheckpointScope
  reason?: string
  blockers: string[]
}

interface NormalizedRunInput {
  staged_write_id: string
  requested_by: string
  dry_run: boolean
}

interface NormalizedListInput {
  limit: number
  staged_write_id?: string
}

export class WakeSchedulerNavigationCheckpointWriteRunService {
  private executionQueue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly eventStore: EventStore,
    private readonly staging: WakeSchedulerNavigationWriteStagingService,
    private readonly approvals: WakeSchedulerNavigationWriteApprovalService,
    private readonly executor: WakeSchedulerNavigationCheckpointWriteExecutor,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async preview(input: WakeSchedulerNavigationCheckpointWriteRunInput): Promise<WakeSchedulerNavigationCheckpointWriteRunPreview> {
    const normalized = readRunInput(input)
    return this.previewFor(normalized.staged_write_id)
  }

  async execute(input: WakeSchedulerNavigationCheckpointWriteRunInput): Promise<WakeSchedulerNavigationCheckpointWriteRunResult> {
    const run = () => this.executeQueued(input)
    const result = this.executionQueue.then(run, run)
    this.executionQueue = result.catch(() => undefined)
    return result
  }

  async list(input: WakeSchedulerNavigationCheckpointWriteRunListInput = {}): Promise<WakeSchedulerNavigationCheckpointWriteRunRecord[]> {
    const normalized = readListInput(input)
    const results = await this.results()
    return redactValue(results
      .filter((item) => !normalized.staged_write_id || item.staged_write_id === normalized.staged_write_id)
      .slice(0, normalized.limit)
      .map((result) => ({
        run_id: result.run_id,
        staged_write_id: result.staged_write_id,
        approval_id: result.approval_id,
        command: result.command,
        status: result.status,
        checkpoint_id: result.checkpoint_id,
        completed_at: result.completed_at,
        summary_preview: summaryPreview(result),
      })))
  }

  async get(runId: string): Promise<WakeSchedulerNavigationCheckpointWriteRunResult | null> {
    const result = (await this.results()).find((item) => item.run_id === cleanString(runId, "run_id")) ?? null
    return result ? redactValue(result) : null
  }

  private async executeQueued(input: WakeSchedulerNavigationCheckpointWriteRunInput): Promise<WakeSchedulerNavigationCheckpointWriteRunResult> {
    const normalized = readRunInput(input)
    const preview = await this.previewFor(normalized.staged_write_id)
    const startedAt = this.now()
    const runId = runIdFor(normalized.staged_write_id, startedAt)

    if (normalized.dry_run) {
      return redactValue(resultFromPreview(runId, preview, preview.can_execute ? "succeeded" : "blocked", startedAt, startedAt, normalized.requested_by, undefined, undefined, undefined, preview.can_execute ? "checkpoint_write_run_dry_run" : undefined, preview.can_execute ? "dry-run only; no checkpoint created and no checkpoint write-run events appended" : undefined, preview.can_execute ? undefined : preview.blockers.join("; ")))
    }

    if (!preview.can_execute) {
      const blocked = resultFromPreview(runId, preview, "blocked", startedAt, startedAt, normalized.requested_by, undefined, undefined, undefined, undefined, undefined, preview.blockers.join("; "))
      await this.appendTerminal("runtime_wake_scheduler_navigation_checkpoint_write_run_blocked", blocked)
      return redactValue(blocked)
    }

    await this.eventStore.append({
      kind: "runtime_wake_scheduler_navigation_checkpoint_write_run_started",
      created_at: startedAt,
      run_id: runId,
      staged_write_id: preview.staged_write_id,
      approval_id: preview.approval_id,
      command: preview.command,
      command_name: preview.command_name,
      execution_kind: preview.execution_kind,
      risk: preview.risk,
      authority_gate: preview.authority_gate,
      status: "started",
      requested_by: normalized.requested_by,
      started_at: startedAt,
      summary_preview: preview.redacted_summary_preview,
    })

    try {
      const parsed = parseCheckpointCommand(preview.command)
      if (!parsed.scope || parsed.blockers.length > 0) throw new Error(parsed.blockers.join("; ") || "checkpoint command is malformed")
      const checkpoint = await this.executor.execute({
        scope: parsed.scope,
        reason: parsed.reason,
        requested_by: normalized.requested_by,
      })
      const completedAt = this.now()
      const result = resultFromPreview(
        runId,
        preview,
        "succeeded",
        startedAt,
        completedAt,
        normalized.requested_by,
        checkpoint.checkpoint_id,
        checkpoint.checkpoint_hash,
        checkpoint.event_count,
        "runtime_checkpoint",
        `created checkpoint ${checkpoint.checkpoint_id} scope=${checkpoint.scope} events=${checkpoint.event_count}`,
        undefined,
      )
      await this.appendTerminal("runtime_wake_scheduler_navigation_checkpoint_write_run_succeeded", result)
      return redactValue(result)
    } catch (error) {
      const completedAt = this.now()
      const result = resultFromPreview(runId, preview, "failed", startedAt, completedAt, normalized.requested_by, undefined, undefined, undefined, undefined, undefined, error instanceof Error ? error.message : String(error))
      await this.appendTerminal("runtime_wake_scheduler_navigation_checkpoint_write_run_failed", result)
      return redactValue(result)
    }
  }

  private async previewFor(stagedWriteId: string): Promise<WakeSchedulerNavigationCheckpointWriteRunPreview> {
    const cleanId = cleanString(stagedWriteId, "staged_write_id")
    const staged = await this.staging.get(cleanId)
    if (!staged) {
      return redactValue({
        staged_write_id: cleanId,
        command: "",
        command_name: "",
        can_execute: false,
        risk: "unsupported",
        authority_gate: "unknown",
        target_kind: "unknown",
        execution_kind: "blocked",
        blockers: ["staged write command is not active"],
        warnings: ["7Y executes only approved active staged checkpoint writes"],
        redacted_summary_preview: "staged write command is not active",
      })
    }

    const recheck = await this.staging.preview({ command: staged.command, allow_medium_risk: true })
    const eligibility = recheck.eligibility
    const readiness = await this.approvals.preview({ staged_write_id: staged.staged_write_id })
    const parsed = parseCheckpointCommand(staged.command)
    const blockers: string[] = []

    if (!recheck.existing_staged_id || recheck.existing_staged_id !== staged.staged_write_id) blockers.push("staged checkpoint write is not the active eligible record")
    if (!eligibility.can_stage) blockers.push(...eligibility.blockers)
    if (staged.command_name !== "/checkpoint" || eligibility.command_name !== "/checkpoint") blockers.push("7Y executes staged /checkpoint writes only")
    if (eligibility.risk !== "medium_risk_write") blockers.push("7Y executes approved medium-risk checkpoint writes only")
    if (eligibility.authority_gate !== "checkpoint_runtime") blockers.push("staged write is not owned by checkpoint_runtime")
    blockers.push(...parsed.blockers)
    if (!readiness.existing_approval) blockers.push("active 7X approval is required for this exact staged checkpoint write")
    if (readiness.existing_approval && readiness.existing_approval.staged_write_id !== staged.staged_write_id) blockers.push("active approval does not match staged checkpoint write")
    if (readiness.blockers.length > 0 && !readiness.existing_approval) blockers.push(...readiness.blockers)
    if (parsed.scope && blockers.length === 0) {
      const checkpointPreview = await this.executor.preview({ scope: parsed.scope, reason: parsed.reason, requested_by: "scheduler-navigation-checkpoint-write-run-preview" })
      blockers.push(...checkpointPreview.blockers)
    }

    const warnings = [
      ...eligibility.warnings,
      ...readiness.warnings,
      "7Y creates exactly one checkpoint per explicit operator request and never calls /run-staged",
    ]

    return redactValue({
      staged_write_id: staged.staged_write_id,
      approval_id: readiness.existing_approval?.approval_id,
      command: eligibility.command,
      command_name: eligibility.command_name,
      can_execute: blockers.length === 0,
      risk: eligibility.risk,
      authority_gate: eligibility.authority_gate,
      target_kind: eligibility.target_kind,
      target_id: eligibility.target_id,
      execution_kind: blockers.length === 0 ? "checkpoint_create" : "blocked",
      checkpoint_scope: parsed.scope,
      checkpoint_reason_preview: parsed.reason,
      blockers: [...new Set(blockers)].slice(0, 10).map(preview),
      warnings: [...new Set(warnings)].slice(0, 10).map(preview),
      redacted_summary_preview: preview(`${eligibility.risk} ${eligibility.authority_gate}: ${eligibility.command}`),
    })
  }

  private async appendTerminal(
    kind:
      | "runtime_wake_scheduler_navigation_checkpoint_write_run_succeeded"
      | "runtime_wake_scheduler_navigation_checkpoint_write_run_failed"
      | "runtime_wake_scheduler_navigation_checkpoint_write_run_blocked",
    result: WakeSchedulerNavigationCheckpointWriteRunResult,
  ): Promise<void> {
    await this.eventStore.append({
      kind,
      created_at: result.completed_at,
      run_id: result.run_id,
      staged_write_id: result.staged_write_id,
      approval_id: result.approval_id,
      command: result.command,
      command_name: result.command_name,
      execution_kind: result.execution_kind,
      risk: result.risk,
      authority_gate: result.authority_gate,
      status: result.status,
      checkpoint_id: result.checkpoint_id,
      checkpoint_hash: result.checkpoint_hash,
      event_count: result.event_count,
      result_kind: result.result_kind,
      result_summary: result.result_summary,
      error: result.error,
      requested_by: result.requested_by,
      started_at: result.started_at,
      completed_at: result.completed_at,
      result_hash: result.result_hash,
      summary_preview: summaryPreview(result),
    })
  }

  private async results(): Promise<WakeSchedulerNavigationCheckpointWriteRunResult[]> {
    const results = new Map<string, WakeSchedulerNavigationCheckpointWriteRunResult>()
    for (const event of await this.eventStore.readAll()) {
      const result = resultFromEvent(event)
      if (result) results.set(result.run_id, result)
    }
    return [...results.values()].sort((left, right) => right.completed_at.localeCompare(left.completed_at) || left.run_id.localeCompare(right.run_id))
  }
}

export function readWakeSchedulerNavigationCheckpointWriteRunInput(value: unknown): WakeSchedulerNavigationCheckpointWriteRunInput {
  return readRunInput(value)
}

export function readWakeSchedulerNavigationCheckpointWriteRunListInput(value: unknown): WakeSchedulerNavigationCheckpointWriteRunListInput {
  return readListInput(value)
}

function resultFromPreview(
  runId: string,
  previewResult: WakeSchedulerNavigationCheckpointWriteRunPreview,
  status: WakeSchedulerNavigationCheckpointWriteRunResult["status"],
  startedAt: string,
  completedAt: string,
  requestedBy: string,
  checkpointId?: string,
  checkpointHash?: string,
  eventCount?: number,
  resultKind?: string,
  resultSummary?: string,
  error?: string,
): WakeSchedulerNavigationCheckpointWriteRunResult {
  const result = {
    run_id: runId,
    staged_write_id: previewResult.staged_write_id,
    approval_id: previewResult.approval_id,
    command: previewResult.command,
    command_name: previewResult.command_name,
    execution_kind: previewResult.execution_kind,
    risk: previewResult.risk,
    authority_gate: previewResult.authority_gate,
    status,
    checkpoint_id: checkpointId ? preview(checkpointId) : undefined,
    checkpoint_hash: checkpointHash ? preview(checkpointHash) : undefined,
    event_count: eventCount,
    result_kind: resultKind ? preview(resultKind) : undefined,
    result_summary: resultSummary ? preview(resultSummary) : undefined,
    error: error ? preview(error) : undefined,
    started_at: startedAt,
    completed_at: completedAt,
    requested_by: preview(requestedBy),
  }
  return redactValue({ ...result, result_hash: hashText(JSON.stringify(result)) })
}

function resultFromEvent(event: JsonlEvent): WakeSchedulerNavigationCheckpointWriteRunResult | null {
  const kind = String(event.kind ?? "")
  if (!kind.startsWith("runtime_wake_scheduler_navigation_checkpoint_write_run_") || kind.endsWith("_started")) return null
  if (typeof event.run_id !== "string" || typeof event.staged_write_id !== "string" || typeof event.command !== "string") return null
  return redactValue({
    run_id: preview(event.run_id),
    staged_write_id: preview(event.staged_write_id),
    approval_id: typeof event.approval_id === "string" ? preview(event.approval_id) : undefined,
    command: preview(event.command),
    command_name: readString(event.command_name, ""),
    execution_kind: event.execution_kind === "checkpoint_create" ? "checkpoint_create" : "blocked",
    risk: readRisk(event.risk),
    authority_gate: readAuthorityGate(event.authority_gate),
    status: readStatus(event.status),
    checkpoint_id: typeof event.checkpoint_id === "string" ? preview(event.checkpoint_id) : undefined,
    checkpoint_hash: typeof event.checkpoint_hash === "string" ? preview(event.checkpoint_hash) : undefined,
    event_count: Number.isInteger(event.event_count) ? Number(event.event_count) : undefined,
    result_kind: typeof event.result_kind === "string" ? preview(event.result_kind) : undefined,
    result_summary: typeof event.result_summary === "string" ? preview(event.result_summary) : undefined,
    error: typeof event.error === "string" ? preview(event.error) : undefined,
    started_at: readString(event.started_at ?? event.created_at, ""),
    completed_at: readString(event.completed_at ?? event.created_at, ""),
    requested_by: readString(event.requested_by, "operator"),
    result_hash: readString(event.result_hash, ""),
  })
}

function parseCheckpointCommand(command: string): ParsedCheckpointCommand {
  const [name, scopeRaw, ...reasonParts] = command.trim().split(/\s+/)
  const blockers: string[] = []
  if (name !== "/checkpoint") blockers.push("checkpoint write executor supports /checkpoint only")
  if (!scopeRaw) blockers.push("/checkpoint requires a scope")
  let scope: RuntimeCheckpointScope | undefined
  if (scopeRaw) {
    try {
      scope = readRuntimeCheckpointScope(scopeRaw)
    } catch {
      blockers.push("checkpoint scope must be one of full, commander, executor, research, handoff")
    }
  }
  const reason = reasonParts.length > 0 ? preview(reasonParts.join(" ")) : undefined
  return { scope, reason, blockers }
}

function readRunInput(value: unknown): NormalizedRunInput {
  if (!isRecord(value)) throw new Error("scheduler navigation checkpoint write run input is required")
  return {
    staged_write_id: cleanString(value.staged_write_id ?? value.stagedWriteId, "staged_write_id"),
    requested_by: optionalCleanString(value.requested_by ?? value.requestedBy) ?? "scheduler-navigation-checkpoint-write-run",
    dry_run: value.dry_run === true || value.dryRun === true,
  }
}

function readListInput(value: unknown): NormalizedListInput {
  const record = isRecord(value) ? value : {}
  return {
    limit: readLimit(record.limit),
    staged_write_id: optionalCleanString(record.staged_write_id ?? record.stagedWriteId),
  }
}

function readLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_LIMIT
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error("scheduler navigation checkpoint write run limit must be a positive integer")
  return Math.min(Number(value), HARD_LIMIT)
}

function readStatus(value: unknown): WakeSchedulerNavigationCheckpointWriteRunResult["status"] {
  return value === "succeeded" || value === "failed" || value === "blocked" ? value : "failed"
}

function readRisk(value: unknown): WakeSchedulerNavigationCheckpointWriteRunResult["risk"] {
  return value === "low_risk_write" || value === "medium_risk_write" || value === "high_impact_write" || value === "unsupported" ? value : "unsupported"
}

function readAuthorityGate(value: unknown): WakeSchedulerNavigationCheckpointWriteRunResult["authority_gate"] {
  const allowed = ["wake_scheduler_runtime", "wake_schedule_tick", "checkpoint_runtime", "recovery_runtime", "recovery_workflow_runtime", "continuation_runtime", "handoff_runtime", "mission_runtime", "proposal_review_runtime", "reasoning_provider_runtime", "unknown"]
  return typeof value === "string" && allowed.includes(value) ? value as WakeSchedulerNavigationCheckpointWriteRunResult["authority_gate"] : "unknown"
}

function summaryPreview(result: WakeSchedulerNavigationCheckpointWriteRunResult): string {
  return preview(`${result.status} ${result.execution_kind}: ${result.result_summary ?? result.error ?? result.command}`)
}

function runIdFor(stagedWriteId: string, startedAt: string): string {
  return `wake_scheduler_navigation_checkpoint_write_run_${hashText(`${stagedWriteId}:${startedAt}:${randomUUID()}`).slice(0, 16)}`
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex")
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
