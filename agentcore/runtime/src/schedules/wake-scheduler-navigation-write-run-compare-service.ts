import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { WakeSchedulerNavigationWriteAuthorityGate, WakeSchedulerNavigationWriteRisk } from "./wake-scheduler-navigation-write-preview-types"
import type { WakeSchedulerNavigationWriteRunStatus, WakeSchedulerNavigationWriteExecutionKind } from "./wake-scheduler-navigation-write-run-types"
import type { WakeSchedulerNavigationWriteStagingService } from "./wake-scheduler-navigation-write-staging-service"
import type {
  WakeSchedulerNavigationWriteRunCompareCommand,
  WakeSchedulerNavigationWriteRunCompareInput,
  WakeSchedulerNavigationWriteRunComparisonStatus,
  WakeSchedulerNavigationWriteRunGroup,
  WakeSchedulerNavigationWriteRunGroupInput,
  WakeSchedulerNavigationWriteRunHistory,
  WakeSchedulerNavigationWriteRunHistoryInput,
  WakeSchedulerNavigationWriteRunOutcomeHash,
  WakeSchedulerNavigationWriteRunPairComparison,
  WakeSchedulerNavigationWriteRunStaleInput,
  WakeSchedulerNavigationWriteRunStaleItem,
} from "./wake-scheduler-navigation-write-run-compare-types"

const DEFAULT_LIMIT = 20
const HARD_LIMIT = 100
const DEFAULT_STALE_AFTER_MS = 60 * 60 * 1000
const PREVIEW_CHARS = 1024

interface TerminalWriteRun {
  run_id: string
  staged_write_id: string
  command: string
  command_name: string
  execution_kind: WakeSchedulerNavigationWriteExecutionKind
  risk: WakeSchedulerNavigationWriteRisk
  authority_gate: WakeSchedulerNavigationWriteAuthorityGate
  target_kind: string
  target_id?: string
  status: WakeSchedulerNavigationWriteRunStatus
  result_kind?: string
  result_summary?: string
  downstream_run_id?: string
  error?: string
  started_at: string
  completed_at: string
  requested_by: string
  result_hash?: string
  outcome_hash: string
}

interface HistoryQuery {
  staged_write_id?: string
  command?: string
  limit: number
  stale_after_ms: number
}

interface CompareQuery {
  staged_write_id?: string
  left_run_id?: string
  right_run_id?: string
  latest: boolean
}

interface StaleQuery {
  stale_after_ms: number
  limit: number
}

interface GroupQuery {
  staged_write_id?: string
  command?: string
  limit: number
}

export class WakeSchedulerNavigationWriteRunCompareService {
  constructor(
    private readonly eventStore: EventStore,
    private readonly staging: WakeSchedulerNavigationWriteStagingService,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async history(input: WakeSchedulerNavigationWriteRunHistoryInput = {}): Promise<WakeSchedulerNavigationWriteRunHistory> {
    const query = readHistoryInput(input)
    const groups = await this.groups(query)
    const now = this.now()
    return redactValue({
      staged_write_id: query.staged_write_id,
      command: query.command,
      groups,
      total_runs: groups.reduce((sum, group) => sum + group.run_count, 0),
      total_groups: groups.length,
      changed_groups: groups.filter((group) => group.comparison_status === "changed").length,
      failed_groups: groups.filter((group) => group.failed_count > 0 || group.blocked_count > 0 || group.latest_status === "failed" || group.latest_status === "blocked").length,
      stale_groups: groups.filter((group) => groupIsStale(group, now, query.stale_after_ms)).length,
      generated_at: now,
    })
  }

  async group(input: WakeSchedulerNavigationWriteRunGroupInput): Promise<WakeSchedulerNavigationWriteRunGroup | null> {
    const query = readGroupInput(input)
    const groups = await this.groups({ ...query, stale_after_ms: DEFAULT_STALE_AFTER_MS })
    return groups[0] ? redactValue(groups[0]) : null
  }

  async compare(input: WakeSchedulerNavigationWriteRunCompareInput): Promise<WakeSchedulerNavigationWriteRunPairComparison> {
    const query = readCompareInput(input)
    const runs = await this.terminalRuns()
    let left: TerminalWriteRun | undefined
    let right: TerminalWriteRun | undefined
    if (query.left_run_id || query.right_run_id) {
      if (!query.left_run_id || !query.right_run_id) throw new Error("left_run_id and right_run_id are both required")
      left = runs.find((run) => run.run_id === query.left_run_id)
      right = runs.find((run) => run.run_id === query.right_run_id)
      if (!left || !right) throw new Error("write-run comparison run id not found")
    } else {
      if (!query.staged_write_id) throw new Error("staged_write_id is required for latest write-run comparison")
      const stagedRuns = runs.filter((run) => run.staged_write_id === query.staged_write_id)
      if (stagedRuns.length === 0) throw new Error("write-run comparison has no terminal runs")
      if (stagedRuns.length === 1) return firstRunComparison(stagedRuns[0])
      left = stagedRuns[1]
      right = stagedRuns[0]
    }
    return pairComparison(left, right)
  }

  async stale(input: WakeSchedulerNavigationWriteRunStaleInput = {}): Promise<WakeSchedulerNavigationWriteRunStaleItem[]> {
    const query = readStaleInput(input)
    const nowMs = Date.parse(this.now())
    const latestByStaged = new Map<string, TerminalWriteRun>()
    for (const run of await this.terminalRuns()) {
      if (!latestByStaged.has(run.staged_write_id)) latestByStaged.set(run.staged_write_id, run)
    }
    const staged = await this.staging.list(HARD_LIMIT)
    const items: WakeSchedulerNavigationWriteRunStaleItem[] = staged.map((command) => {
      const latest = latestByStaged.get(command.staged_write_id)
      const latestMs = latest?.completed_at ? Date.parse(latest.completed_at) : NaN
      const age = Number.isFinite(latestMs) ? Math.max(0, nowMs - latestMs) : undefined
      return redactValue({
        staged_write_id: command.staged_write_id,
        command: command.command,
        command_name: readCommandName(command.command),
        risk: command.risk,
        authority_gate: command.authority_gate,
        target_kind: command.target_kind,
        target_id: command.target_id,
        latest_run_id: latest?.run_id,
        latest_completed_at: latest?.completed_at,
        age_ms: age,
        stale_after_ms: query.stale_after_ms,
        stale: age === undefined || age >= query.stale_after_ms,
        recommended_commands: recommendedCommands(command.staged_write_id, latest?.run_id),
      })
    })
    return redactValue(items
      .sort((left, right) => Number(right.stale) - Number(left.stale) || (right.age_ms ?? Number.MAX_SAFE_INTEGER) - (left.age_ms ?? Number.MAX_SAFE_INTEGER) || left.staged_write_id.localeCompare(right.staged_write_id))
      .slice(0, query.limit))
  }

  outcomeHash(run: Pick<TerminalWriteRun, "command" | "command_name" | "execution_kind" | "risk" | "authority_gate" | "target_kind" | "target_id" | "status" | "result_kind" | "result_summary" | "error">): WakeSchedulerNavigationWriteRunOutcomeHash {
    return outcomeHash(run)
  }

  private async groups(query: (HistoryQuery | GroupQuery) & { stale_after_ms?: number }): Promise<WakeSchedulerNavigationWriteRunGroup[]> {
    const grouped = new Map<string, TerminalWriteRun[]>()
    for (const run of await this.terminalRuns()) {
      if (query.staged_write_id && run.staged_write_id !== query.staged_write_id) continue
      if (query.command && run.command !== query.command) continue
      const rows = grouped.get(run.staged_write_id) ?? []
      rows.push(run)
      grouped.set(run.staged_write_id, rows)
    }
    const groups = [...grouped.values()].map((runs) => groupFromRuns(runs))
    return redactValue(groups.sort((left, right) => (right.latest_completed_at ?? "").localeCompare(left.latest_completed_at ?? "") || left.staged_write_id.localeCompare(right.staged_write_id)).slice(0, query.limit))
  }

  private async terminalRuns(): Promise<TerminalWriteRun[]> {
    const runs = new Map<string, TerminalWriteRun>()
    for (const event of await this.eventStore.readAll()) {
      const run = runFromEvent(event)
      if (run) runs.set(run.run_id, run)
    }
    return [...runs.values()].sort((left, right) => right.completed_at.localeCompare(left.completed_at) || left.run_id.localeCompare(right.run_id))
  }
}

export function stableWakeSchedulerNavigationWriteRunOutcomeHash(value: Pick<TerminalWriteRun, "command" | "command_name" | "execution_kind" | "risk" | "authority_gate" | "target_kind" | "target_id" | "status" | "result_kind" | "result_summary" | "error">): WakeSchedulerNavigationWriteRunOutcomeHash {
  return outcomeHash(value)
}

export function readWakeSchedulerNavigationWriteRunHistoryInput(value: unknown): WakeSchedulerNavigationWriteRunHistoryInput {
  return readHistoryInput(value)
}

export function readWakeSchedulerNavigationWriteRunCompareInput(value: unknown): WakeSchedulerNavigationWriteRunCompareInput {
  return readCompareInput(value)
}

export function readWakeSchedulerNavigationWriteRunStaleInput(value: unknown): WakeSchedulerNavigationWriteRunStaleInput {
  return readStaleInput(value)
}

export function readWakeSchedulerNavigationWriteRunGroupInput(value: unknown): WakeSchedulerNavigationWriteRunGroupInput {
  return readGroupInput(value)
}

function runFromEvent(event: JsonlEvent): TerminalWriteRun | null {
  const kind = String(event.kind ?? "")
  if (
    kind !== "runtime_wake_scheduler_navigation_write_run_succeeded" &&
    kind !== "runtime_wake_scheduler_navigation_write_run_failed" &&
    kind !== "runtime_wake_scheduler_navigation_write_run_blocked"
  ) return null
  if (typeof event.run_id !== "string" || typeof event.staged_write_id !== "string" || typeof event.command !== "string") return null
  const run = redactValue({
    run_id: preview(event.run_id),
    staged_write_id: preview(event.staged_write_id),
    command: preview(event.command),
    command_name: readString(event.command_name, readCommandName(event.command)),
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
    started_at: readString(event.started_at ?? event.created_at ?? event.timestamp, ""),
    completed_at: readString(event.completed_at ?? event.created_at ?? event.timestamp, ""),
    requested_by: readString(event.requested_by, "operator"),
    result_hash: typeof event.result_hash === "string" ? preview(event.result_hash) : undefined,
  })
  return { ...run, outcome_hash: outcomeHash(run).outcome_hash }
}

function groupFromRuns(runs: TerminalWriteRun[]): WakeSchedulerNavigationWriteRunGroup {
  const sorted = [...runs].sort((left, right) => right.completed_at.localeCompare(left.completed_at) || left.run_id.localeCompare(right.run_id))
  const latest = sorted[0]
  const previous = sorted[1]
  const comparisonStatus = latest ? groupStatus(latest, previous) : "unknown"
  const downstreamRunIds = [...new Set(sorted.map((run) => run.downstream_run_id).filter((id): id is string => Boolean(id)))]
  return redactValue({
    group_id: `wake_scheduler_navigation_write_run_group_${hashText(latest.staged_write_id).slice(0, 16)}`,
    staged_write_id: latest.staged_write_id,
    command: latest.command,
    command_name: latest.command_name,
    execution_kind: latest.execution_kind,
    risk: latest.risk,
    authority_gate: latest.authority_gate,
    target_kind: latest.target_kind,
    target_id: latest.target_id,
    run_count: sorted.length,
    succeeded_count: sorted.filter((run) => run.status === "succeeded").length,
    failed_count: sorted.filter((run) => run.status === "failed").length,
    blocked_count: sorted.filter((run) => run.status === "blocked").length,
    latest_run_id: latest.run_id,
    latest_completed_at: latest.completed_at,
    latest_status: latest.status,
    latest_outcome_hash: latest.outcome_hash,
    previous_run_id: previous?.run_id,
    previous_outcome_hash: previous?.outcome_hash,
    downstream_run_ids: downstreamRunIds.slice(0, 10),
    comparison_status: comparisonStatus,
    summary_preview: preview(`${comparisonStatus} ${latest.execution_kind}: ${latest.result_summary ?? latest.error ?? latest.command}`),
    recommended_commands: recommendedCommands(latest.staged_write_id, latest.run_id),
  })
}

function pairComparison(left: TerminalWriteRun, right: TerminalWriteRun): WakeSchedulerNavigationWriteRunPairComparison {
  const status = pairStatus(left, right)
  const sameStaged = left.staged_write_id === right.staged_write_id
  const downstreamDelta = downstreamDeltaSummary(left, right)
  return redactValue({
    comparison_id: `wake_scheduler_navigation_write_run_compare_${hashText(`${left.run_id}:${right.run_id}`).slice(0, 16)}`,
    staged_write_id: sameStaged ? left.staged_write_id : "mixed",
    command: left.command === right.command ? left.command : `${left.command} <> ${right.command}`,
    left_run_id: left.run_id,
    right_run_id: right.run_id,
    left_completed_at: left.completed_at,
    right_completed_at: right.completed_at,
    left_status: left.status,
    right_status: right.status,
    left_outcome_hash: left.outcome_hash,
    right_outcome_hash: right.outcome_hash,
    comparison_status: status,
    summary_delta: preview(deltaSummary(left, right, status)),
    downstream_delta: downstreamDelta ? preview(downstreamDelta) : undefined,
    warnings: sameStaged ? ["comparison uses bounded write-run result summaries, not raw results"] : ["comparing runs from different staged writes", "comparison uses bounded write-run result summaries, not raw results"],
    recommended_commands: recommendedCommands(sameStaged ? left.staged_write_id : right.staged_write_id, right.run_id),
  })
}

function firstRunComparison(run: TerminalWriteRun): WakeSchedulerNavigationWriteRunPairComparison {
  return redactValue({
    comparison_id: `wake_scheduler_navigation_write_run_compare_${hashText(`${run.run_id}:first`).slice(0, 16)}`,
    staged_write_id: run.staged_write_id,
    command: run.command,
    left_run_id: run.run_id,
    right_run_id: run.run_id,
    left_completed_at: run.completed_at,
    right_completed_at: run.completed_at,
    left_status: run.status,
    right_status: run.status,
    left_outcome_hash: run.outcome_hash,
    right_outcome_hash: run.outcome_hash,
    comparison_status: "first_run",
    summary_delta: preview(`first recorded terminal write-run outcome for ${run.command}`),
    downstream_delta: run.downstream_run_id ? preview(`first downstream staged-read run ${run.downstream_run_id}`) : undefined,
    warnings: ["only one terminal write-run outcome is available"],
    recommended_commands: recommendedCommands(run.staged_write_id, run.run_id),
  })
}

function groupStatus(latest: TerminalWriteRun, previous?: TerminalWriteRun): WakeSchedulerNavigationWriteRunComparisonStatus {
  if (!previous) return "first_run"
  return pairStatus(previous, latest)
}

function pairStatus(left: TerminalWriteRun, right: TerminalWriteRun): WakeSchedulerNavigationWriteRunComparisonStatus {
  if (left.status === "failed" || right.status === "failed") return left.outcome_hash === right.outcome_hash ? "failed" : "changed"
  if (left.status === "blocked" || right.status === "blocked") return left.outcome_hash === right.outcome_hash ? "blocked" : "changed"
  return left.outcome_hash === right.outcome_hash ? "unchanged" : "changed"
}

function deltaSummary(left: TerminalWriteRun, right: TerminalWriteRun, status: WakeSchedulerNavigationWriteRunComparisonStatus): string {
  if (status === "unchanged") return `unchanged bounded outcome for ${right.command}`
  if (status === "failed") return `same failed bounded outcome for ${right.command}`
  if (status === "blocked") return `same blocked bounded outcome for ${right.command}`
  return `changed bounded outcome from ${left.status}/${left.result_kind ?? "none"} to ${right.status}/${right.result_kind ?? "none"}`
}

function downstreamDeltaSummary(left: TerminalWriteRun, right: TerminalWriteRun): string | undefined {
  if (!left.downstream_run_id && !right.downstream_run_id) return undefined
  if (left.downstream_run_id === right.downstream_run_id) return `same downstream staged-read run ${right.downstream_run_id}`
  return `downstream staged-read link changed from ${left.downstream_run_id ?? "none"} to ${right.downstream_run_id ?? "none"}`
}

function outcomeHash(value: Pick<TerminalWriteRun, "command" | "command_name" | "execution_kind" | "risk" | "authority_gate" | "target_kind" | "target_id" | "status" | "result_kind" | "result_summary" | "error">): WakeSchedulerNavigationWriteRunOutcomeHash {
  const hash_basis = redactValue({
    command: preview(value.command),
    command_name: preview(value.command_name),
    execution_kind: value.execution_kind,
    risk: value.risk,
    authority_gate: value.authority_gate,
    target_kind: preview(value.target_kind),
    target_id: value.target_id ? preview(value.target_id) : undefined,
    status: value.status,
    result_kind: value.result_kind ? preview(value.result_kind) : undefined,
    result_summary: value.result_summary ? preview(value.result_summary) : undefined,
    error: value.error ? preview(value.error) : undefined,
  })
  return { outcome_hash: hashText(stableJson(hash_basis)), hash_basis }
}

function recommendedCommands(stagedWriteId: string, runId?: string): WakeSchedulerNavigationWriteRunCompareCommand[] {
  const commands: WakeSchedulerNavigationWriteRunCompareCommand[] = [
    { label: "Preview staged write", command: `/scheduler-nav-write-run-preview ${stagedWriteId}`, command_type: "read", notes: "read-only execution eligibility preview" },
    { label: "Run staged write", command: `/scheduler-nav-write-run ${stagedWriteId}`, command_type: "write", requires_active_runtime: true, notes: "explicit one-command low-risk write execution path" },
    { label: "List write runs", command: "/scheduler-nav-write-runs", command_type: "read" },
    { label: "List staged writes", command: "/scheduler-nav-write-staged", command_type: "read" },
    { label: "Compare write runs", command: `/scheduler-nav-write-run-compare ${stagedWriteId}`, command_type: "read" },
  ]
  if (runId) commands.push({ label: "Show latest write run", command: `/scheduler-nav-write-run-show ${runId}`, command_type: "read" })
  return commands
}

function groupIsStale(group: WakeSchedulerNavigationWriteRunGroup, now: string, staleAfterMs: number): boolean {
  if (!group.latest_completed_at) return true
  const latest = Date.parse(group.latest_completed_at)
  const current = Date.parse(now)
  return !Number.isFinite(latest) || !Number.isFinite(current) || current - latest >= staleAfterMs
}

function readHistoryInput(value: unknown): HistoryQuery {
  const record = isRecord(value) ? value : {}
  return {
    staged_write_id: optionalCleanString(record.staged_write_id ?? record.stagedWriteId),
    command: optionalCleanString(record.command),
    limit: readLimit(record.limit),
    stale_after_ms: readDurationMs(record.stale_after_ms ?? record.staleAfterMs, DEFAULT_STALE_AFTER_MS, "stale_after_ms"),
  }
}

function readCompareInput(value: unknown): CompareQuery {
  const record = isRecord(value) ? value : {}
  return {
    staged_write_id: optionalCleanString(record.staged_write_id ?? record.stagedWriteId),
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
  const stagedWriteId = optionalCleanString(record.staged_write_id ?? record.stagedWriteId)
  const command = optionalCleanString(record.command)
  if (!stagedWriteId && !command) throw new Error("staged_write_id or command is required")
  return { staged_write_id: stagedWriteId, command, limit: readLimit(record.limit) }
}

function readLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_LIMIT
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error("scheduler write-run comparison limit must be a positive integer")
  return Math.min(Number(value), HARD_LIMIT)
}

function readDurationMs(value: unknown, fallback: number, field: string): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${field} must be a positive integer in milliseconds`)
  return Number(value)
}

function readStatus(value: unknown): WakeSchedulerNavigationWriteRunStatus {
  return value === "succeeded" || value === "failed" || value === "blocked" ? value : "failed"
}

function readExecutionKind(value: unknown): WakeSchedulerNavigationWriteExecutionKind {
  return value === "wake_tick_dry_run" || value === "staged_safe_read" || value === "blocked" ? value : "blocked"
}

function readRisk(value: unknown): WakeSchedulerNavigationWriteRisk {
  return value === "low_risk_write" || value === "medium_risk_write" || value === "high_impact_write" || value === "unsupported" ? value : "unsupported"
}

function readAuthorityGate(value: unknown): WakeSchedulerNavigationWriteAuthorityGate {
  const allowed: WakeSchedulerNavigationWriteAuthorityGate[] = ["wake_scheduler_runtime", "wake_schedule_tick", "checkpoint_runtime", "recovery_runtime", "recovery_workflow_runtime", "continuation_runtime", "handoff_runtime", "mission_runtime", "proposal_review_runtime", "reasoning_provider_runtime", "unknown"]
  return typeof value === "string" && allowed.includes(value as WakeSchedulerNavigationWriteAuthorityGate) ? value as WakeSchedulerNavigationWriteAuthorityGate : "unknown"
}

function readCommandName(command: unknown): string {
  if (typeof command !== "string") return ""
  return preview(command.trim().split(/\s+/)[0] ?? "")
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
