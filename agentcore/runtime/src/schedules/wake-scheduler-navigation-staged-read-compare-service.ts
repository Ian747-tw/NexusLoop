import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { WakeSchedulerNavigationStageTargetKind } from "./wake-scheduler-navigation-staging-types"
import type { WakeSchedulerNavigationStagingService } from "./wake-scheduler-navigation-staging-service"
import type {
  WakeSchedulerNavigationStagedReadCompareCommand,
  WakeSchedulerNavigationStagedReadCompareInput,
  WakeSchedulerNavigationStagedReadComparisonHash,
  WakeSchedulerNavigationStagedReadComparisonStatus,
  WakeSchedulerNavigationStagedReadGroup,
  WakeSchedulerNavigationStagedReadGroupInput,
  WakeSchedulerNavigationStagedReadHistory,
  WakeSchedulerNavigationStagedReadHistoryInput,
  WakeSchedulerNavigationStagedReadPairComparison,
  WakeSchedulerNavigationStagedReadStaleInput,
  WakeSchedulerNavigationStagedReadStaleItem,
} from "./wake-scheduler-navigation-staged-read-compare-types"

const DEFAULT_LIMIT = 20
const HARD_LIMIT = 100
const DEFAULT_STALE_AFTER_MS = 60 * 60 * 1000
const PREVIEW_CHARS = 1024

type TerminalStatus = "succeeded" | "failed" | "blocked"

interface TerminalRun {
  run_id: string
  staged_id: string
  command: string
  target_kind: WakeSchedulerNavigationStageTargetKind
  target_id?: string
  status: TerminalStatus
  result_kind?: string
  result_summary?: string
  error?: string
  started_at: string
  completed_at: string
  requested_by: string
  summary_preview?: string
  comparison_hash: string
}

interface HistoryQuery {
  staged_id?: string
  command?: string
  limit: number
  stale_after_ms: number
}

interface CompareQuery {
  staged_id?: string
  left_run_id?: string
  right_run_id?: string
  latest: boolean
}

interface StaleQuery {
  stale_after_ms: number
  limit: number
}

interface GroupQuery {
  staged_id?: string
  command?: string
  limit: number
}

export class WakeSchedulerNavigationStagedReadCompareService {
  constructor(
    private readonly eventStore: EventStore,
    private readonly staging: WakeSchedulerNavigationStagingService,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async history(input: WakeSchedulerNavigationStagedReadHistoryInput = {}): Promise<WakeSchedulerNavigationStagedReadHistory> {
    const query = readHistoryInput(input)
    const groups = await this.groups(query)
    const now = this.now()
    const staleGroups = groups.filter((group) => groupIsStale(group, now, query.stale_after_ms)).length
    return redactValue({
      staged_id: query.staged_id,
      command: query.command,
      groups,
      total_runs: groups.reduce((sum, group) => sum + group.run_count, 0),
      total_groups: groups.length,
      changed_groups: groups.filter((group) => group.comparison_status === "changed").length,
      failed_groups: groups.filter((group) => group.comparison_status === "failed" || group.comparison_status === "blocked").length,
      stale_groups: staleGroups,
      generated_at: now,
    })
  }

  async group(input: WakeSchedulerNavigationStagedReadGroupInput): Promise<WakeSchedulerNavigationStagedReadGroup | null> {
    const query = readGroupInput(input)
    const groups = await this.groups({ ...query, stale_after_ms: DEFAULT_STALE_AFTER_MS })
    return groups[0] ? redactValue(groups[0]) : null
  }

  async compare(input: WakeSchedulerNavigationStagedReadCompareInput): Promise<WakeSchedulerNavigationStagedReadPairComparison> {
    const query = readCompareInput(input)
    const runs = await this.terminalRuns()
    let left: TerminalRun | undefined
    let right: TerminalRun | undefined
    if (query.left_run_id || query.right_run_id) {
      if (!query.left_run_id || !query.right_run_id) throw new Error("left_run_id and right_run_id are both required")
      left = runs.find((run) => run.run_id === query.left_run_id)
      right = runs.find((run) => run.run_id === query.right_run_id)
      if (!left || !right) throw new Error("staged read comparison run id not found")
    } else {
      if (!query.staged_id) throw new Error("staged_id is required for latest staged read comparison")
      const stagedRuns = runs.filter((run) => run.staged_id === query.staged_id)
      if (stagedRuns.length === 0) throw new Error("staged read comparison has no terminal runs")
      if (stagedRuns.length === 1) return firstRunComparison(stagedRuns[0])
      left = stagedRuns[1]
      right = stagedRuns[0]
    }
    return pairComparison(left, right)
  }

  async stale(input: WakeSchedulerNavigationStagedReadStaleInput = {}): Promise<WakeSchedulerNavigationStagedReadStaleItem[]> {
    const query = readStaleInput(input)
    const nowMs = Date.parse(this.now())
    const latestByStaged = new Map<string, TerminalRun>()
    for (const run of await this.terminalRuns()) {
      if (!latestByStaged.has(run.staged_id)) latestByStaged.set(run.staged_id, run)
    }
    const staged = await this.staging.list(HARD_LIMIT)
    const items: WakeSchedulerNavigationStagedReadStaleItem[] = staged.map((command) => {
      const latest = latestByStaged.get(command.staged_id)
      const latestMs = latest?.completed_at ? Date.parse(latest.completed_at) : NaN
      const age = Number.isFinite(latestMs) ? Math.max(0, nowMs - latestMs) : undefined
      return redactValue({
        staged_id: command.staged_id,
        command: command.command,
        target_kind: command.target_kind,
        target_id: command.target_id,
        latest_run_id: latest?.run_id,
        latest_completed_at: latest?.completed_at,
        age_ms: age,
        stale_after_ms: query.stale_after_ms,
        stale: age === undefined || age >= query.stale_after_ms,
        recommended_commands: recommendedCommands(command.staged_id, latest?.run_id),
      })
    })
    return redactValue(items
      .sort((left, right) => Number(right.stale) - Number(left.stale) || (right.age_ms ?? Number.MAX_SAFE_INTEGER) - (left.age_ms ?? Number.MAX_SAFE_INTEGER) || left.staged_id.localeCompare(right.staged_id))
      .slice(0, query.limit))
  }

  comparisonHash(run: Pick<TerminalRun, "command" | "target_kind" | "target_id" | "status" | "result_kind" | "result_summary" | "error">): WakeSchedulerNavigationStagedReadComparisonHash {
    return comparisonHash(run)
  }

  private async groups(query: HistoryQuery | GroupQuery & { stale_after_ms?: number }): Promise<WakeSchedulerNavigationStagedReadGroup[]> {
    const grouped = new Map<string, TerminalRun[]>()
    for (const run of await this.terminalRuns()) {
      if (query.staged_id && run.staged_id !== query.staged_id) continue
      if (query.command && run.command !== query.command) continue
      const rows = grouped.get(run.staged_id) ?? []
      rows.push(run)
      grouped.set(run.staged_id, rows)
    }
    const groups = [...grouped.values()].map((runs) => groupFromRuns(runs))
    return redactValue(groups.sort((left, right) => (right.latest_completed_at ?? "").localeCompare(left.latest_completed_at ?? "") || left.staged_id.localeCompare(right.staged_id)).slice(0, query.limit))
  }

  private async terminalRuns(): Promise<TerminalRun[]> {
    const runs = new Map<string, TerminalRun>()
    for (const event of await this.eventStore.readAll()) {
      const run = runFromEvent(event)
      if (run) runs.set(run.run_id, run)
    }
    return [...runs.values()].sort((left, right) => right.completed_at.localeCompare(left.completed_at) || left.run_id.localeCompare(right.run_id))
  }
}

export function stableWakeSchedulerNavigationStagedReadComparisonHash(value: Pick<TerminalRun, "command" | "target_kind" | "target_id" | "status" | "result_kind" | "result_summary" | "error">): WakeSchedulerNavigationStagedReadComparisonHash {
  return comparisonHash(value)
}

export function readWakeSchedulerNavigationStagedReadHistoryInput(value: unknown): WakeSchedulerNavigationStagedReadHistoryInput {
  return readHistoryInput(value)
}

export function readWakeSchedulerNavigationStagedReadCompareInput(value: unknown): WakeSchedulerNavigationStagedReadCompareInput {
  return readCompareInput(value)
}

export function readWakeSchedulerNavigationStagedReadStaleInput(value: unknown): WakeSchedulerNavigationStagedReadStaleInput {
  return readStaleInput(value)
}

export function readWakeSchedulerNavigationStagedReadGroupInput(value: unknown): WakeSchedulerNavigationStagedReadGroupInput {
  return readGroupInput(value)
}

function runFromEvent(event: JsonlEvent): TerminalRun | null {
  const kind = String(event.kind ?? "")
  if (
    kind !== "runtime_wake_scheduler_navigation_staged_read_succeeded" &&
    kind !== "runtime_wake_scheduler_navigation_staged_read_failed" &&
    kind !== "runtime_wake_scheduler_navigation_staged_read_blocked"
  ) return null
  if (typeof event.run_id !== "string" || typeof event.staged_id !== "string" || typeof event.command !== "string") return null
  const run = redactValue({
    run_id: preview(event.run_id),
    staged_id: preview(event.staged_id),
    command: preview(event.command),
    target_kind: readTargetKind(event.target_kind),
    target_id: typeof event.target_id === "string" ? preview(event.target_id) : undefined,
    status: readStatus(event.status),
    result_kind: typeof event.result_kind === "string" ? preview(event.result_kind) : undefined,
    result_summary: typeof event.result_summary === "string" ? preview(event.result_summary) : undefined,
    error: typeof event.error === "string" ? preview(event.error) : undefined,
    started_at: readString(event.started_at ?? event.created_at ?? event.timestamp, ""),
    completed_at: readString(event.completed_at ?? event.created_at ?? event.timestamp, ""),
    requested_by: readString(event.requested_by, "operator"),
    summary_preview: typeof event.summary_preview === "string" ? preview(event.summary_preview) : undefined,
  })
  return { ...run, comparison_hash: comparisonHash(run).comparison_hash }
}

function groupFromRuns(runs: TerminalRun[]): WakeSchedulerNavigationStagedReadGroup {
  const sorted = [...runs].sort((left, right) => right.completed_at.localeCompare(left.completed_at) || left.run_id.localeCompare(right.run_id))
  const latest = sorted[0]
  const previous = sorted[1]
  const comparisonStatus = latest ? groupStatus(latest, previous) : "unknown"
  return redactValue({
    group_id: `wake_scheduler_navigation_staged_read_group_${hashText(latest.staged_id).slice(0, 16)}`,
    staged_id: latest.staged_id,
    command: latest.command,
    target_kind: latest.target_kind,
    target_id: latest.target_id,
    run_count: sorted.length,
    succeeded_count: sorted.filter((run) => run.status === "succeeded").length,
    failed_count: sorted.filter((run) => run.status === "failed").length,
    blocked_count: sorted.filter((run) => run.status === "blocked").length,
    latest_run_id: latest.run_id,
    latest_completed_at: latest.completed_at,
    latest_status: latest.status,
    latest_comparison_hash: latest.comparison_hash,
    previous_run_id: previous?.run_id,
    previous_comparison_hash: previous?.comparison_hash,
    comparison_status: comparisonStatus,
    summary_preview: preview(`${comparisonStatus} ${latest.target_kind}: ${latest.result_summary ?? latest.error ?? latest.command}`),
    recommended_commands: recommendedCommands(latest.staged_id, latest.run_id),
  })
}

function pairComparison(left: TerminalRun, right: TerminalRun): WakeSchedulerNavigationStagedReadPairComparison {
  const status = pairStatus(left, right)
  const sameStaged = left.staged_id === right.staged_id
  return redactValue({
    comparison_id: `wake_scheduler_navigation_staged_read_compare_${hashText(`${left.run_id}:${right.run_id}`).slice(0, 16)}`,
    staged_id: sameStaged ? left.staged_id : "mixed",
    command: left.command === right.command ? left.command : `${left.command} <> ${right.command}`,
    left_run_id: left.run_id,
    right_run_id: right.run_id,
    left_completed_at: left.completed_at,
    right_completed_at: right.completed_at,
    left_status: left.status,
    right_status: right.status,
    left_comparison_hash: left.comparison_hash,
    right_comparison_hash: right.comparison_hash,
    comparison_status: status,
    summary_delta: preview(deltaSummary(left, right, status)),
    warnings: sameStaged ? ["comparison uses bounded staged-read result summaries, not raw results"] : ["comparing runs from different staged commands", "comparison uses bounded staged-read result summaries, not raw results"],
    recommended_commands: recommendedCommands(sameStaged ? left.staged_id : right.staged_id, right.run_id),
  })
}

function firstRunComparison(run: TerminalRun): WakeSchedulerNavigationStagedReadPairComparison {
  return redactValue({
    comparison_id: `wake_scheduler_navigation_staged_read_compare_${hashText(`${run.run_id}:first`).slice(0, 16)}`,
    staged_id: run.staged_id,
    command: run.command,
    left_run_id: run.run_id,
    right_run_id: run.run_id,
    left_completed_at: run.completed_at,
    right_completed_at: run.completed_at,
    left_status: run.status,
    right_status: run.status,
    left_comparison_hash: run.comparison_hash,
    right_comparison_hash: run.comparison_hash,
    comparison_status: "first_run",
    summary_delta: preview(`first recorded terminal result for ${run.command}`),
    warnings: ["only one terminal staged-read run is available"],
    recommended_commands: recommendedCommands(run.staged_id, run.run_id),
  })
}

function groupStatus(latest: TerminalRun, previous?: TerminalRun): WakeSchedulerNavigationStagedReadComparisonStatus {
  if (!previous) return "first_run"
  return pairStatus(previous, latest)
}

function pairStatus(left: TerminalRun, right: TerminalRun): WakeSchedulerNavigationStagedReadComparisonStatus {
  if (left.status === "failed" || right.status === "failed") return left.comparison_hash === right.comparison_hash ? "failed" : "changed"
  if (left.status === "blocked" || right.status === "blocked") return left.comparison_hash === right.comparison_hash ? "blocked" : "changed"
  return left.comparison_hash === right.comparison_hash ? "unchanged" : "changed"
}

function deltaSummary(left: TerminalRun, right: TerminalRun, status: WakeSchedulerNavigationStagedReadComparisonStatus): string {
  if (status === "unchanged") return `unchanged bounded result for ${right.command}`
  if (status === "failed") return `same failed bounded result for ${right.command}`
  if (status === "blocked") return `same blocked bounded result for ${right.command}`
  return `changed bounded result from ${left.status}/${left.result_kind ?? "none"} to ${right.status}/${right.result_kind ?? "none"}`
}

function comparisonHash(value: Pick<TerminalRun, "command" | "target_kind" | "target_id" | "status" | "result_kind" | "result_summary" | "error">): WakeSchedulerNavigationStagedReadComparisonHash {
  const hash_basis = redactValue({
    command: preview(value.command),
    target_kind: value.target_kind,
    target_id: value.target_id ? preview(value.target_id) : undefined,
    status: value.status,
    result_kind: value.result_kind ? preview(value.result_kind) : undefined,
    result_summary: value.result_summary ? preview(value.result_summary) : undefined,
    error: value.error ? preview(value.error) : undefined,
  })
  return { comparison_hash: hashText(stableJson(hash_basis)), hash_basis }
}

function recommendedCommands(stagedId: string, runId?: string): WakeSchedulerNavigationStagedReadCompareCommand[] {
  const commands: WakeSchedulerNavigationStagedReadCompareCommand[] = [
    { label: "Preview staged read", command: `/scheduler-nav-run-preview ${stagedId}`, command_type: "read", notes: "read-only execution eligibility preview" },
    { label: "Run staged read", command: `/scheduler-nav-run ${stagedId}`, command_type: "write", requires_active_runtime: true, notes: "explicit one-command safe-read execution path" },
    { label: "List staged read runs", command: "/scheduler-nav-runs", command_type: "read" },
    { label: "List staged commands", command: "/scheduler-nav-staged", command_type: "read" },
    { label: "Compare staged reads", command: `/scheduler-nav-read-compare ${stagedId}`, command_type: "read" },
  ]
  if (runId) commands.push({ label: "Show latest run", command: `/scheduler-nav-run-show ${runId}`, command_type: "read" })
  return commands
}

function groupIsStale(group: WakeSchedulerNavigationStagedReadGroup, now: string, staleAfterMs: number): boolean {
  if (!group.latest_completed_at) return true
  const latest = Date.parse(group.latest_completed_at)
  const current = Date.parse(now)
  return !Number.isFinite(latest) || !Number.isFinite(current) || current - latest >= staleAfterMs
}

function readHistoryInput(value: unknown): HistoryQuery {
  const record = isRecord(value) ? value : {}
  return {
    staged_id: optionalCleanString(record.staged_id ?? record.stagedId),
    command: optionalCleanString(record.command),
    limit: readLimit(record.limit),
    stale_after_ms: readDurationMs(record.stale_after_ms ?? record.staleAfterMs, DEFAULT_STALE_AFTER_MS, "stale_after_ms"),
  }
}

function readCompareInput(value: unknown): CompareQuery {
  const record = isRecord(value) ? value : {}
  return {
    staged_id: optionalCleanString(record.staged_id ?? record.stagedId),
    left_run_id: optionalCleanString(record.left_run_id ?? record.leftRunId),
    right_run_id: optionalCleanString(record.right_run_id ?? record.rightRunId),
    latest: record.latest === undefined ? true : Boolean(record.latest),
  }
}

function readStaleInput(value: unknown): StaleQuery {
  const record = isRecord(value) ? value : {}
  return {
    stale_after_ms: readDurationMs(record.stale_after_ms ?? record.staleAfterMs, DEFAULT_STALE_AFTER_MS, "stale_after_ms"),
    limit: readLimit(record.limit),
  }
}

function readGroupInput(value: unknown): GroupQuery {
  const record = isRecord(value) ? value : {}
  const stagedId = optionalCleanString(record.staged_id ?? record.stagedId)
  const command = optionalCleanString(record.command)
  if (!stagedId && !command) throw new Error("staged_id or command is required")
  return { staged_id: stagedId, command, limit: readLimit(record.limit) }
}

function readLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_LIMIT
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error("scheduler staged read comparison limit must be a positive integer")
  return Math.min(Number(value), HARD_LIMIT)
}

function readDurationMs(value: unknown, fallback: number, field: string): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${field} must be a positive integer in milliseconds`)
  return Number(value)
}

function readStatus(value: unknown): TerminalStatus {
  return value === "succeeded" || value === "failed" || value === "blocked" ? value : "failed"
}

function readTargetKind(value: unknown): WakeSchedulerNavigationStageTargetKind {
  const allowed: WakeSchedulerNavigationStageTargetKind[] = ["scheduler_status", "scheduler_bootstrap", "scheduler_recovery", "scheduler_recovery_workflow", "scheduler_audit", "wake_schedule", "wake_tick", "wake_assessment", "continuation_plan", "checkpoint", "resume_anchor", "handoff_followup", "mission", "unknown"]
  return typeof value === "string" && allowed.includes(value as WakeSchedulerNavigationStageTargetKind) ? value as WakeSchedulerNavigationStageTargetKind : "unknown"
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

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
