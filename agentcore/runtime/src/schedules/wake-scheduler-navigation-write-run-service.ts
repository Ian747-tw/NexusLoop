import { createHash, randomUUID } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { WakeSchedulerNavigationLowRiskWriteExecutor } from "./wake-scheduler-navigation-low-risk-write-executor"
import type { WakeSchedulerNavigationWriteStagingService } from "./wake-scheduler-navigation-write-staging-service"
import type {
  WakeSchedulerNavigationWriteRunInput,
  WakeSchedulerNavigationWriteRunListInput,
  WakeSchedulerNavigationWriteRunPreview,
  WakeSchedulerNavigationWriteRunRecord,
  WakeSchedulerNavigationWriteRunResult,
} from "./wake-scheduler-navigation-write-run-types"

const DEFAULT_LIMIT = 20
const HARD_LIMIT = 100
const PREVIEW_CHARS = 1024
const LOW_RISK_EXECUTABLE = new Set(["/wake-tick-dry-run", "/scheduler-nav-run"])

interface NormalizedRunInput {
  staged_write_id: string
  requested_by: string
  dry_run: boolean
}

interface NormalizedListInput {
  limit: number
  staged_write_id?: string
}

export class WakeSchedulerNavigationWriteRunService {
  private executionQueue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly eventStore: EventStore,
    private readonly staging: WakeSchedulerNavigationWriteStagingService,
    private readonly executor: WakeSchedulerNavigationLowRiskWriteExecutor,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async preview(input: WakeSchedulerNavigationWriteRunInput): Promise<WakeSchedulerNavigationWriteRunPreview> {
    const normalized = readRunInput(input)
    return this.previewFor(normalized.staged_write_id)
  }

  async execute(input: WakeSchedulerNavigationWriteRunInput): Promise<WakeSchedulerNavigationWriteRunResult> {
    const run = () => this.executeQueued(input)
    const result = this.executionQueue.then(run, run)
    this.executionQueue = result.catch(() => undefined)
    return result
  }

  async list(input: WakeSchedulerNavigationWriteRunListInput = {}): Promise<WakeSchedulerNavigationWriteRunRecord[]> {
    const normalized = readListInput(input)
    const results = await this.results()
    return redactValue(results
      .filter((item) => !normalized.staged_write_id || item.staged_write_id === normalized.staged_write_id)
      .slice(0, normalized.limit)
      .map((result) => ({
        run_id: result.run_id,
        staged_write_id: result.staged_write_id,
        command: result.command,
        execution_kind: result.execution_kind,
        status: result.status,
        completed_at: result.completed_at,
        summary_preview: summaryPreview(result),
      })))
  }

  async get(runId: string): Promise<WakeSchedulerNavigationWriteRunResult | null> {
    const result = (await this.results()).find((item) => item.run_id === cleanString(runId, "run_id")) ?? null
    return result ? redactValue(result) : null
  }

  private async executeQueued(input: WakeSchedulerNavigationWriteRunInput): Promise<WakeSchedulerNavigationWriteRunResult> {
    const normalized = readRunInput(input)
    const preview = await this.previewFor(normalized.staged_write_id)
    const startedAt = this.now()
    const runId = runIdFor(normalized.staged_write_id, startedAt)
    if (normalized.dry_run) {
      return redactValue(resultFromPreview(runId, preview, preview.can_execute ? "succeeded" : "blocked", startedAt, startedAt, normalized.requested_by, "write_run_dry_run", "dry-run only; no write run events appended and no downstream executor called", undefined, undefined))
    }
    if (!preview.can_execute) {
      const blocked = resultFromPreview(runId, preview, "blocked", startedAt, startedAt, normalized.requested_by, undefined, undefined, preview.blockers.join("; "), undefined)
      await this.appendTerminal("runtime_wake_scheduler_navigation_write_run_blocked", blocked)
      return redactValue(blocked)
    }

    await this.eventStore.append({
      kind: "runtime_wake_scheduler_navigation_write_run_started",
      created_at: startedAt,
      run_id: runId,
      staged_write_id: preview.staged_write_id,
      command: preview.command,
      command_name: preview.command_name,
      execution_kind: preview.execution_kind,
      risk: preview.risk,
      authority_gate: preview.authority_gate,
      target_kind: preview.target_kind,
      target_id: preview.target_id,
      status: "started",
      requested_by: normalized.requested_by,
      started_at: startedAt,
      summary_preview: preview.redacted_summary_preview,
    })

    try {
      const execution = await this.executor.execute(preview.command, normalized.requested_by)
      const completedAt = this.now()
      const result = resultFromPreview(runId, preview, "succeeded", startedAt, completedAt, normalized.requested_by, execution.result_kind, execution.result_summary, undefined, execution.downstream_run_id)
      await this.appendTerminal("runtime_wake_scheduler_navigation_write_run_succeeded", result)
      return redactValue(result)
    } catch (error) {
      const completedAt = this.now()
      const result = resultFromPreview(runId, preview, "failed", startedAt, completedAt, normalized.requested_by, undefined, undefined, error instanceof Error ? error.message : String(error), undefined)
      await this.appendTerminal("runtime_wake_scheduler_navigation_write_run_failed", result)
      return redactValue(result)
    }
  }

  private async previewFor(stagedWriteId: string): Promise<WakeSchedulerNavigationWriteRunPreview> {
    const staged = await this.staging.get(stagedWriteId)
    if (!staged) {
      return redactValue({
        staged_write_id: cleanString(stagedWriteId, "staged_write_id"),
        command: "",
        command_name: "",
        can_execute: false,
        risk: "unsupported",
        authority_gate: "unknown",
        target_kind: "unknown",
        execution_kind: "blocked",
        blockers: ["staged write command is not active"],
        warnings: ["7V executes only one active low-risk staged write per explicit request"],
        redacted_summary_preview: "staged write command is not active",
      })
    }
    const recheck = await this.staging.preview({ command: staged.command, allow_medium_risk: false })
    const eligibility = recheck.eligibility
    const blockers: string[] = []
    if (!recheck.existing_staged_id || recheck.existing_staged_id !== staged.staged_write_id) blockers.push("staged write command is not the active eligible record")
    if (!eligibility.can_stage) blockers.push(...eligibility.blockers)
    if (eligibility.risk !== "low_risk_write") blockers.push("7V executes low-risk staged writes only")
    if (!LOW_RISK_EXECUTABLE.has(eligibility.command_name)) blockers.push(`${eligibility.command_name} is not in the 7V low-risk executor whitelist`)
    if (eligibility.command_name === "/scheduler-nav-run" && !eligibility.target_id) blockers.push("/scheduler-nav-run requires a staged read id")
    if (!this.executor.supports(staged.command)) blockers.push("staged write command is not supported by the 7V low-risk executor")
    const executionKind = eligibility.command_name === "/wake-tick-dry-run"
      ? "wake_tick_dry_run"
      : eligibility.command_name === "/scheduler-nav-run"
        ? "staged_safe_read"
        : "blocked"
    return redactValue({
      staged_write_id: staged.staged_write_id,
      command: eligibility.command,
      command_name: eligibility.command_name,
      can_execute: blockers.length === 0,
      risk: eligibility.risk,
      authority_gate: eligibility.authority_gate,
      target_kind: eligibility.target_kind,
      target_id: eligibility.target_id,
      execution_kind: blockers.length === 0 ? executionKind : "blocked",
      blockers: [...new Set(blockers)].slice(0, 10).map(preview),
      warnings: [...eligibility.warnings, "7V executes exactly one low-risk staged write and never calls /run-staged"].slice(0, 10).map(preview),
      redacted_summary_preview: preview(`${eligibility.risk} ${eligibility.authority_gate}: ${eligibility.command}`),
    })
  }

  private async appendTerminal(kind: "runtime_wake_scheduler_navigation_write_run_succeeded" | "runtime_wake_scheduler_navigation_write_run_failed" | "runtime_wake_scheduler_navigation_write_run_blocked", result: WakeSchedulerNavigationWriteRunResult): Promise<void> {
    await this.eventStore.append({
      kind,
      created_at: result.completed_at,
      run_id: result.run_id,
      staged_write_id: result.staged_write_id,
      command: result.command,
      command_name: result.command_name,
      execution_kind: result.execution_kind,
      risk: result.risk,
      authority_gate: result.authority_gate,
      target_kind: result.target_kind,
      target_id: result.target_id,
      status: result.status,
      result_kind: result.result_kind,
      result_summary: result.result_summary,
      downstream_run_id: result.downstream_run_id,
      error: result.error,
      requested_by: result.requested_by,
      started_at: result.started_at,
      completed_at: result.completed_at,
      result_hash: result.result_hash,
      summary_preview: summaryPreview(result),
    })
  }

  private async results(): Promise<WakeSchedulerNavigationWriteRunResult[]> {
    const results = new Map<string, WakeSchedulerNavigationWriteRunResult>()
    for (const event of await this.eventStore.readAll()) {
      const result = resultFromEvent(event)
      if (result) results.set(result.run_id, result)
    }
    return [...results.values()].sort((left, right) => right.completed_at.localeCompare(left.completed_at) || left.run_id.localeCompare(right.run_id))
  }
}

export function readWakeSchedulerNavigationWriteRunInput(value: unknown): WakeSchedulerNavigationWriteRunInput {
  return readRunInput(value)
}

export function readWakeSchedulerNavigationWriteRunListInput(value: unknown): WakeSchedulerNavigationWriteRunListInput {
  return readListInput(value)
}

function resultFromPreview(
  runId: string,
  previewResult: WakeSchedulerNavigationWriteRunPreview,
  status: WakeSchedulerNavigationWriteRunResult["status"],
  startedAt: string,
  completedAt: string,
  requestedBy: string,
  resultKind?: string,
  resultSummary?: string,
  error?: string,
  downstreamRunId?: string,
): WakeSchedulerNavigationWriteRunResult {
  const result = {
    run_id: runId,
    staged_write_id: previewResult.staged_write_id,
    command: previewResult.command,
    command_name: previewResult.command_name,
    execution_kind: previewResult.execution_kind,
    risk: previewResult.risk,
    authority_gate: previewResult.authority_gate,
    target_kind: previewResult.target_kind,
    target_id: previewResult.target_id,
    status,
    result_kind: resultKind ? preview(resultKind) : undefined,
    result_summary: resultSummary ? preview(resultSummary) : undefined,
    downstream_run_id: downstreamRunId ? preview(downstreamRunId) : undefined,
    error: error ? preview(error) : undefined,
    started_at: startedAt,
    completed_at: completedAt,
    requested_by: preview(requestedBy),
  }
  return redactValue({ ...result, result_hash: hashText(JSON.stringify(result)) })
}

function resultFromEvent(event: JsonlEvent): WakeSchedulerNavigationWriteRunResult | null {
  const kind = String(event.kind ?? "")
  if (!kind.startsWith("runtime_wake_scheduler_navigation_write_run_") || kind.endsWith("_started")) return null
  if (typeof event.run_id !== "string" || typeof event.staged_write_id !== "string" || typeof event.command !== "string") return null
  return redactValue({
    run_id: preview(event.run_id),
    staged_write_id: preview(event.staged_write_id),
    command: preview(event.command),
    command_name: readString(event.command_name, ""),
    execution_kind: readExecutionKind(event.execution_kind),
    risk: readRisk(event.risk),
    authority_gate: readAuthorityGate(event.authority_gate),
    target_kind: readString(event.target_kind, "unknown"),
    target_id: typeof event.target_id === "string" ? preview(event.target_id) : undefined,
    status: readStatus(event.status),
    result_kind: typeof event.result_kind === "string" ? preview(event.result_kind) : undefined,
    result_summary: typeof event.result_summary === "string" ? preview(event.result_summary) : undefined,
    downstream_run_id: typeof event.downstream_run_id === "string" ? preview(event.downstream_run_id) : undefined,
    error: typeof event.error === "string" ? preview(event.error) : undefined,
    started_at: readString(event.started_at ?? event.created_at, ""),
    completed_at: readString(event.completed_at ?? event.created_at, ""),
    requested_by: readString(event.requested_by, "operator"),
    result_hash: readString(event.result_hash, ""),
  })
}

function readRunInput(value: unknown): NormalizedRunInput {
  if (!isRecord(value)) throw new Error("scheduler navigation write run input is required")
  return {
    staged_write_id: cleanString(value.staged_write_id ?? value.stagedWriteId, "staged_write_id"),
    requested_by: optionalCleanString(value.requested_by ?? value.requestedBy) ?? "scheduler-navigation-write-run",
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
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error("scheduler navigation write run limit must be a positive integer")
  return Math.min(Number(value), HARD_LIMIT)
}

function readStatus(value: unknown): WakeSchedulerNavigationWriteRunResult["status"] {
  return value === "succeeded" || value === "failed" || value === "blocked" ? value : "failed"
}

function readExecutionKind(value: unknown): WakeSchedulerNavigationWriteRunResult["execution_kind"] {
  return value === "wake_tick_dry_run" || value === "staged_safe_read" || value === "blocked" ? value : "blocked"
}

function readRisk(value: unknown): WakeSchedulerNavigationWriteRunResult["risk"] {
  return value === "low_risk_write" || value === "medium_risk_write" || value === "high_impact_write" || value === "unsupported" ? value : "unsupported"
}

function readAuthorityGate(value: unknown): WakeSchedulerNavigationWriteRunResult["authority_gate"] {
  const allowed = ["wake_scheduler_runtime", "wake_schedule_tick", "checkpoint_runtime", "recovery_runtime", "recovery_workflow_runtime", "continuation_runtime", "handoff_runtime", "mission_runtime", "proposal_review_runtime", "reasoning_provider_runtime", "unknown"]
  return typeof value === "string" && allowed.includes(value) ? value as WakeSchedulerNavigationWriteRunResult["authority_gate"] : "unknown"
}

function summaryPreview(result: WakeSchedulerNavigationWriteRunResult): string {
  return preview(`${result.status} ${result.execution_kind}: ${result.result_summary ?? result.error ?? result.command}`)
}

function runIdFor(stagedWriteId: string, startedAt: string): string {
  return `wake_scheduler_navigation_write_run_${hashText(`${stagedWriteId}:${startedAt}:${randomUUID()}`).slice(0, 16)}`
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
