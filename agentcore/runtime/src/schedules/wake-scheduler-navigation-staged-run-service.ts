import { createHash, randomUUID } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import { classifyWakeSchedulerNavigationCommand } from "./wake-scheduler-navigation-service"
import { WakeSchedulerNavigationReadExecutor } from "./wake-scheduler-navigation-read-executor"
import type { WakeSchedulerNavigationStagingService } from "./wake-scheduler-navigation-staging-service"
import type { WakeSchedulerNavigationStageRisk, WakeSchedulerNavigationStageTargetKind } from "./wake-scheduler-navigation-staging-types"
import type {
  WakeSchedulerNavigationStagedRunInput,
  WakeSchedulerNavigationStagedRunListInput,
  WakeSchedulerNavigationStagedRunPreview,
  WakeSchedulerNavigationStagedRunRecord,
  WakeSchedulerNavigationStagedRunResult,
} from "./wake-scheduler-navigation-staged-run-types"

const DEFAULT_LIMIT = 20
const HARD_LIMIT = 100
const PREVIEW_CHARS = 1024

interface NormalizedRunInput {
  staged_id: string
  requested_by: string
}

interface NormalizedListInput {
  limit: number
  staged_id?: string
}

export class WakeSchedulerNavigationStagedRunService {
  private executionQueue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly eventStore: EventStore,
    private readonly staging: WakeSchedulerNavigationStagingService,
    private readonly executor: WakeSchedulerNavigationReadExecutor,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async preview(input: WakeSchedulerNavigationStagedRunInput): Promise<WakeSchedulerNavigationStagedRunPreview> {
    const normalized = readRunInput(input)
    return this.previewFor(normalized.staged_id)
  }

  async execute(input: WakeSchedulerNavigationStagedRunInput): Promise<WakeSchedulerNavigationStagedRunResult> {
    const run = () => this.executeQueued(input)
    const result = this.executionQueue.then(run, run)
    this.executionQueue = result.catch(() => undefined)
    return result
  }

  private async executeQueued(input: WakeSchedulerNavigationStagedRunInput): Promise<WakeSchedulerNavigationStagedRunResult> {
    const normalized = readRunInput(input)
    const preview = await this.previewFor(normalized.staged_id)
    const startedAt = this.now()
    const runId = runIdFor(normalized.staged_id, startedAt)
    if (!preview.can_execute) {
      const blocked = resultFromPreview(runId, preview, "blocked", startedAt, startedAt, normalized.requested_by, undefined, preview.blockers.join("; "))
      await this.eventStore.append({
        kind: "runtime_wake_scheduler_navigation_staged_read_blocked",
        created_at: blocked.completed_at,
        run_id: blocked.run_id,
        staged_id: blocked.staged_id,
        command: blocked.command,
        target_kind: blocked.target_kind,
        target_id: blocked.target_id,
        status: blocked.status,
        error: blocked.error,
        requested_by: blocked.requested_by,
        started_at: blocked.started_at,
        completed_at: blocked.completed_at,
        result_hash: blocked.result_hash,
        summary_preview: summaryPreview(blocked),
      })
      return redactValue(blocked)
    }

    await this.eventStore.append({
      kind: "runtime_wake_scheduler_navigation_staged_read_started",
      created_at: startedAt,
      run_id: runId,
      staged_id: preview.staged_id,
      command: preview.command,
      target_kind: preview.target_kind,
      target_id: preview.target_id,
      status: "started",
      requested_by: normalized.requested_by,
      started_at: startedAt,
      summary_preview: preview.redacted_summary_preview,
    })

    try {
      const execution = await this.executor.execute(preview.command)
      const completedAt = this.now()
      const result = resultFromPreview(runId, preview, "succeeded", startedAt, completedAt, normalized.requested_by, execution.result_summary, undefined, execution.result_kind)
      await this.eventStore.append({
        kind: "runtime_wake_scheduler_navigation_staged_read_succeeded",
        created_at: result.completed_at,
        run_id: result.run_id,
        staged_id: result.staged_id,
        command: result.command,
        target_kind: result.target_kind,
        target_id: result.target_id,
        status: result.status,
        result_kind: result.result_kind,
        result_summary: result.result_summary,
        requested_by: result.requested_by,
        started_at: result.started_at,
        completed_at: result.completed_at,
        result_hash: result.result_hash,
        summary_preview: summaryPreview(result),
      })
      return redactValue(result)
    } catch (error) {
      const completedAt = this.now()
      const result = resultFromPreview(runId, preview, "failed", startedAt, completedAt, normalized.requested_by, undefined, error instanceof Error ? error.message : String(error))
      await this.eventStore.append({
        kind: "runtime_wake_scheduler_navigation_staged_read_failed",
        created_at: result.completed_at,
        run_id: result.run_id,
        staged_id: result.staged_id,
        command: result.command,
        target_kind: result.target_kind,
        target_id: result.target_id,
        status: result.status,
        error: result.error,
        requested_by: result.requested_by,
        started_at: result.started_at,
        completed_at: result.completed_at,
        result_hash: result.result_hash,
        summary_preview: summaryPreview(result),
      })
      return redactValue(result)
    }
  }

  async list(input: WakeSchedulerNavigationStagedRunListInput = {}): Promise<WakeSchedulerNavigationStagedRunRecord[]> {
    const normalized = readListInput(input)
    return this.records(normalized)
  }

  async get(runId: string): Promise<WakeSchedulerNavigationStagedRunResult | null> {
    const result = (await this.results()).find((item) => item.run_id === cleanString(runId, "run_id")) ?? null
    return result ? redactValue(result) : null
  }

  private async previewFor(stagedId: string): Promise<WakeSchedulerNavigationStagedRunPreview> {
    const staged = await this.staging.get(stagedId)
    if (!staged) {
      return redactValue({
        staged_id: cleanString(stagedId, "staged_id"),
        command: "",
        can_execute: false,
        command_type: "read",
        risk: "unsupported",
        target_kind: "unknown",
        blockers: ["staged navigation command is not active"],
        warnings: ["staged reads execute one safe-read command only after explicit request"],
        redacted_summary_preview: "staged navigation command is not active",
      })
    }
    const classified = classifyWakeSchedulerNavigationCommand(staged.command)
    const blockers: string[] = []
    if (classified.command_type !== "read") blockers.push("staged command is not a read command")
    if (classified.risk !== "safe_read") blockers.push("staged command is not safe-read risk")
    if (!classified.supported) blockers.push(...classified.blockers)
    if (!this.executor.supports(staged.command)) blockers.push("safe-read command is not executable by staged read executor yet")
    return redactValue({
      staged_id: staged.staged_id,
      command: classified.command,
      can_execute: blockers.length === 0,
      command_type: classified.command_type,
      risk: classified.risk,
      target_kind: classified.target_kind,
      target_id: classified.target_id,
      blockers: [...new Set(blockers)].slice(0, 10),
      warnings: ["staged read execution runs exactly one safe-read command and never calls /run-staged"],
      redacted_summary_preview: preview(`${classified.risk} ${classified.target_kind}${classified.target_id ? ` ${classified.target_id}` : ""}: ${classified.command}`),
    })
  }

  private async records(input: NormalizedListInput): Promise<WakeSchedulerNavigationStagedRunRecord[]> {
    const results = await this.results()
    return redactValue(results
      .filter((item) => !input.staged_id || item.staged_id === input.staged_id)
      .slice(0, input.limit)
      .map((result) => ({
        run_id: result.run_id,
        staged_id: result.staged_id,
        command: result.command,
        target_kind: result.target_kind,
        status: result.status,
        completed_at: result.completed_at,
        summary_preview: summaryPreview(result),
      })))
  }

  private async results(): Promise<WakeSchedulerNavigationStagedRunResult[]> {
    const results = new Map<string, WakeSchedulerNavigationStagedRunResult>()
    for (const event of await this.eventStore.readAll()) {
      const result = resultFromEvent(event)
      if (result) results.set(result.run_id, result)
    }
    return [...results.values()].sort((left, right) => right.completed_at.localeCompare(left.completed_at) || left.run_id.localeCompare(right.run_id))
  }
}

export function readWakeSchedulerNavigationStagedRunInput(value: unknown): WakeSchedulerNavigationStagedRunInput {
  return readRunInput(value)
}

export function readWakeSchedulerNavigationStagedRunListInput(value: unknown): WakeSchedulerNavigationStagedRunListInput {
  return readListInput(value)
}

function resultFromPreview(
  runId: string,
  previewResult: WakeSchedulerNavigationStagedRunPreview,
  status: WakeSchedulerNavigationStagedRunResult["status"],
  startedAt: string,
  completedAt: string,
  requestedBy: string,
  resultSummary?: string,
  error?: string,
  resultKind?: string,
): WakeSchedulerNavigationStagedRunResult {
  const result = {
    run_id: runId,
    staged_id: previewResult.staged_id,
    command: previewResult.command,
    target_kind: previewResult.target_kind,
    target_id: previewResult.target_id,
    status,
    result_summary: resultSummary ? preview(resultSummary) : undefined,
    result_kind: resultKind ? preview(resultKind) : undefined,
    error: error ? preview(error) : undefined,
    started_at: startedAt,
    completed_at: completedAt,
    requested_by: preview(requestedBy),
  }
  return redactValue({ ...result, result_hash: hashText(JSON.stringify(result)) })
}

function resultFromEvent(event: JsonlEvent): WakeSchedulerNavigationStagedRunResult | null {
  const kind = String(event.kind ?? "")
  if (!kind.startsWith("runtime_wake_scheduler_navigation_staged_read_") || kind.endsWith("_started")) return null
  if (typeof event.run_id !== "string" || typeof event.staged_id !== "string" || typeof event.command !== "string") return null
  const status = readStatus(event.status)
  return redactValue({
    run_id: preview(event.run_id),
    staged_id: preview(event.staged_id),
    command: preview(event.command),
    target_kind: readTargetKind(event.target_kind),
    target_id: typeof event.target_id === "string" ? preview(event.target_id) : undefined,
    status,
    result_summary: typeof event.result_summary === "string" ? preview(event.result_summary) : undefined,
    result_kind: typeof event.result_kind === "string" ? preview(event.result_kind) : undefined,
    error: typeof event.error === "string" ? preview(event.error) : undefined,
    started_at: readString(event.started_at ?? event.created_at ?? event.timestamp, ""),
    completed_at: readString(event.completed_at ?? event.created_at ?? event.timestamp, ""),
    requested_by: readString(event.requested_by, "operator"),
    result_hash: typeof event.result_hash === "string" ? preview(event.result_hash) : undefined,
  })
}

function readRunInput(value: unknown): NormalizedRunInput {
  if (!isRecord(value)) throw new Error("scheduler staged read input is required")
  return {
    staged_id: cleanString(value.staged_id ?? value.stagedId, "staged_id"),
    requested_by: optionalCleanString(value.requested_by ?? value.requestedBy) ?? "scheduler-navigation-staged-read",
  }
}

function readListInput(value: unknown): NormalizedListInput {
  const record = isRecord(value) ? value : {}
  return {
    limit: readLimit(record.limit),
    staged_id: optionalCleanString(record.staged_id ?? record.stagedId),
  }
}

function readStatus(value: unknown): WakeSchedulerNavigationStagedRunResult["status"] {
  return value === "succeeded" || value === "failed" || value === "blocked" ? value : "failed"
}

function readTargetKind(value: unknown): WakeSchedulerNavigationStageTargetKind {
  const allowed: WakeSchedulerNavigationStageTargetKind[] = ["scheduler_status", "scheduler_bootstrap", "scheduler_recovery", "scheduler_recovery_workflow", "scheduler_audit", "wake_schedule", "wake_tick", "wake_assessment", "continuation_plan", "checkpoint", "resume_anchor", "handoff_followup", "mission", "unknown"]
  return typeof value === "string" && allowed.includes(value as WakeSchedulerNavigationStageTargetKind) ? value as WakeSchedulerNavigationStageTargetKind : "unknown"
}

function summaryPreview(result: WakeSchedulerNavigationStagedRunResult): string {
  return preview(`${result.status} ${result.target_kind}: ${result.result_summary ?? result.error ?? result.command}`)
}

function runIdFor(stagedId: string, startedAt: string): string {
  return `wake_scheduler_navigation_staged_read_${hashText(`${stagedId}:${startedAt}:${randomUUID()}`).slice(0, 16)}`
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function readLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_LIMIT
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error("scheduler staged read run limit must be a positive integer")
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
