import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { WakeSchedulerNavigationWriteStagingService } from "./wake-scheduler-navigation-write-staging-service"
import type {
  WakeSchedulerNavigationCheckpointApprovalUsage,
  WakeSchedulerNavigationCheckpointApprovalUsageInput,
  WakeSchedulerNavigationCheckpointApprovalUsageSummary,
  WakeSchedulerNavigationCheckpointWriteCompareCommand,
  WakeSchedulerNavigationCheckpointWriteCompareInput,
  WakeSchedulerNavigationCheckpointWriteComparisonStatus,
  WakeSchedulerNavigationCheckpointWriteGroup,
  WakeSchedulerNavigationCheckpointWriteGroupInput,
  WakeSchedulerNavigationCheckpointWriteHistory,
  WakeSchedulerNavigationCheckpointWriteHistoryInput,
  WakeSchedulerNavigationCheckpointWriteOutcomeHash,
  WakeSchedulerNavigationCheckpointWritePairComparison,
  WakeSchedulerNavigationCheckpointWriteStaleInput,
  WakeSchedulerNavigationCheckpointWriteStaleItem,
} from "./wake-scheduler-navigation-checkpoint-write-compare-types"

const DEFAULT_LIMIT = 20
const HARD_LIMIT = 100
const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000
const PREVIEW_CHARS = 1024

interface TerminalCheckpointRun {
  run_id: string
  staged_write_id: string
  approval_id?: string
  command: string
  command_name: string
  execution_kind: "checkpoint_create" | "blocked"
  risk: string
  authority_gate: string
  status: "succeeded" | "failed" | "blocked"
  checkpoint_id?: string
  checkpoint_hash?: string
  event_count?: number
  result_kind?: string
  result_summary?: string
  error?: string
  started_at: string
  completed_at: string
  requested_by: string
  result_hash?: string
  checkpoint_scope?: string
  outcome_hash: string
}

interface ApprovalRecord {
  approval_id: string
  staged_write_id: string
  staged_event_id?: string
  command: string
  command_name: string
  risk: string
  authority_gate: string
  status: "pending" | "approved" | "rejected" | "revoked" | "expired"
  approved_at?: string
  rejected_at?: string
  revoked_at?: string
  expires_at?: string
  staged_at?: string
  stage_hash?: string
  updated_at: string
}

interface ActiveStagedInstance {
  staged_event_id?: string
  staged_at?: string
  stage_hash?: string
}

interface HistoryQuery {
  staged_write_id?: string
  approval_id?: string
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

interface GroupQuery {
  staged_write_id?: string
  command?: string
  limit: number
}

interface StaleQuery {
  stale_after_ms: number
  limit: number
}

interface ApprovalUsageQuery {
  approval_id?: string
  staged_write_id?: string
  command?: string
  limit: number
  stale_after_ms: number
}

export class WakeSchedulerNavigationCheckpointWriteCompareService {
  constructor(
    private readonly eventStore: EventStore,
    private readonly staging: WakeSchedulerNavigationWriteStagingService,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async history(input: WakeSchedulerNavigationCheckpointWriteHistoryInput = {}): Promise<WakeSchedulerNavigationCheckpointWriteHistory> {
    const query = readHistoryInput(input)
    const groups = await this.groups(query)
    const usage = await this.approvalUsageRows({
      approval_id: query.approval_id,
      staged_write_id: query.staged_write_id,
      command: query.command,
      limit: HARD_LIMIT,
      stale_after_ms: query.stale_after_ms,
    })
    return redactValue({
      staged_write_id: query.staged_write_id,
      approval_id: query.approval_id,
      command: query.command,
      groups,
      total_runs: groups.reduce((sum, group) => sum + group.run_count, 0),
      total_groups: groups.length,
      changed_groups: groups.filter((group) => group.comparison_status === "changed").length,
      failed_groups: groups.filter((group) => group.failed_count > 0 || group.blocked_count > 0 || group.latest_status === "failed" || group.latest_status === "blocked").length,
      artifact_changed_groups: groups.filter((group) => group.checkpoint_artifact_changed).length,
      unused_approval_count: usage.filter((item) => !item.used).length,
      stale_approval_count: usage.filter((item) => item.stale).length,
      generated_at: this.now(),
    })
  }

  async group(input: WakeSchedulerNavigationCheckpointWriteGroupInput): Promise<WakeSchedulerNavigationCheckpointWriteGroup | null> {
    const query = readGroupInput(input)
    const groups = await this.groups(query)
    return groups[0] ? redactValue(groups[0]) : null
  }

  async compare(input: WakeSchedulerNavigationCheckpointWriteCompareInput): Promise<WakeSchedulerNavigationCheckpointWritePairComparison> {
    const query = readCompareInput(input)
    const runs = await this.terminalRuns()
    let left: TerminalCheckpointRun | undefined
    let right: TerminalCheckpointRun | undefined
    if (query.left_run_id || query.right_run_id) {
      if (!query.left_run_id || !query.right_run_id) throw new Error("left_run_id and right_run_id are both required")
      left = runs.find((run) => run.run_id === query.left_run_id)
      right = runs.find((run) => run.run_id === query.right_run_id)
      if (!left || !right) throw new Error("checkpoint write comparison run id not found")
    } else {
      if (!query.staged_write_id) throw new Error("staged_write_id is required for latest checkpoint write comparison")
      const stagedRuns = runs.filter((run) => run.staged_write_id === query.staged_write_id)
      if (stagedRuns.length === 0) throw new Error("checkpoint write comparison has no terminal runs")
      if (stagedRuns.length === 1) return firstRunComparison(stagedRuns[0])
      left = stagedRuns[1]
      right = stagedRuns[0]
    }
    return pairComparison(left, right)
  }

  async stale(input: WakeSchedulerNavigationCheckpointWriteStaleInput = {}): Promise<WakeSchedulerNavigationCheckpointWriteStaleItem[]> {
    const query = readStaleInput(input)
    const nowMs = Date.parse(this.now())
    const latestByStaged = latestRunByStaged(await this.terminalRuns())
    const activeStaged = (await this.staging.activeCommands()).filter((item) => item.command_name === "/checkpoint" && item.risk === "medium_risk_write" && item.authority_gate === "checkpoint_runtime")
    const approvals = await this.approvals()
    const activeApproved = authoritativeApprovedByStaged(approvals, activeStagedProjection(activeStaged), this.now())
    const stagedIds = new Set(activeApproved.keys())
    const items: WakeSchedulerNavigationCheckpointWriteStaleItem[] = []
    for (const stagedWriteId of stagedIds) {
      const staged = activeStaged.find((item) => item.staged_write_id === stagedWriteId)
      const approval = activeApproved.get(stagedWriteId)
      const latest = latestByStaged.get(stagedWriteId)
      const latestMs = latest?.completed_at ? Date.parse(latest.completed_at) : NaN
      const age = Number.isFinite(latestMs) ? Math.max(0, nowMs - latestMs) : undefined
      const stale = age === undefined || age >= query.stale_after_ms
      items.push(redactValue({
        staged_write_id: stagedWriteId,
        approval_id: approval?.approval_id,
        command: staged?.command ?? approval?.command ?? "",
        latest_run_id: latest?.run_id,
        latest_completed_at: latest?.completed_at,
        checkpoint_id: latest?.checkpoint_id,
        age_ms: age,
        stale_after_ms: query.stale_after_ms,
        stale,
        reason: stale ? (latest ? "latest checkpoint write-run is older than threshold" : "approved staged checkpoint write has no terminal run") : "latest checkpoint write-run is fresh",
        recommended_commands: recommendedCommands(stagedWriteId, latest?.run_id, approval?.approval_id),
      }))
    }
    return redactValue(items
      .sort((left, right) => Number(right.stale) - Number(left.stale) || (right.age_ms ?? Number.MAX_SAFE_INTEGER) - (left.age_ms ?? Number.MAX_SAFE_INTEGER) || left.staged_write_id.localeCompare(right.staged_write_id))
      .slice(0, query.limit))
  }

  async approvalUsage(input: WakeSchedulerNavigationCheckpointApprovalUsageInput = {}): Promise<WakeSchedulerNavigationCheckpointApprovalUsageSummary> {
    const query = readApprovalUsageInput(input)
    const allUsage = await this.approvalUsageRows(query)
    const usage = allUsage.slice(0, query.limit)
    return redactValue({
      approvals: usage,
      total_approvals: allUsage.length,
      used_count: allUsage.filter((item) => item.used).length,
      unused_count: allUsage.filter((item) => !item.used).length,
      stale_count: allUsage.filter((item) => item.stale).length,
      expired_unused_count: allUsage.filter((item) => item.expired_before_use).length,
      revoked_unused_count: allUsage.filter((item) => item.revoked_before_use).length,
      generated_at: this.now(),
    })
  }

  async approvalUsageRows(input: ApprovalUsageQuery): Promise<WakeSchedulerNavigationCheckpointApprovalUsage[]> {
    const runs = await this.terminalRuns()
    const approvals = await this.approvals()
    const now = this.now()
    const nowMs = Date.parse(now)
    const activeStaged = activeStagedProjection((await this.staging.activeCommands())
      .filter((item) => item.command_name === "/checkpoint" && item.risk === "medium_risk_write" && item.authority_gate === "checkpoint_runtime"))
    const usage = approvals
      .filter((approval) => approval.command_name === "/checkpoint" && approval.risk === "medium_risk_write" && approval.authority_gate === "checkpoint_runtime")
      .filter((approval) => !input.approval_id || approval.approval_id === input.approval_id)
      .filter((approval) => !input.staged_write_id || approval.staged_write_id === input.staged_write_id)
      .filter((approval) => !input.command || approval.command === input.command)
      .map((approval): WakeSchedulerNavigationCheckpointApprovalUsage => {
        const approvalRuns = runs.filter((run) => run.approval_id === approval.approval_id).sort((left, right) => right.completed_at.localeCompare(left.completed_at) || left.run_id.localeCompare(right.run_id))
        const latest = approvalRuns[0]
        const approvalStatus = approvalStatusAt(approval, now)
        const stagedActive = stagedInstanceIsActive(approval, activeStaged)
        const effectiveStatus = approvalStatus === "approved" && !stagedActive ? "expired" : approvalStatus
        const approvedAtMs = approval.approved_at ? Date.parse(approval.approved_at) : NaN
        const latestMs = latest?.completed_at ? Date.parse(latest.completed_at) : NaN
        const expiresMs = approval.expires_at ? Date.parse(approval.expires_at) : NaN
        const revokedMs = approval.revoked_at ? Date.parse(approval.revoked_at) : NaN
        const staleAgeBase = Number.isFinite(latestMs) ? latestMs : approvedAtMs
        const stale = !stagedActive || (Number.isFinite(staleAgeBase) ? nowMs - staleAgeBase >= input.stale_after_ms : true)
        const expiredBeforeUse = !latest && (!stagedActive || (Number.isFinite(expiresMs) && expiresMs <= nowMs))
        const revokedBeforeUse = !latest && Boolean(approval.revoked_at)
        const warnings: string[] = []
        if (latest && Number.isFinite(expiresMs) && Date.parse(latest.completed_at) > expiresMs) warnings.push("checkpoint write-run occurred after approval expiry in event history")
        if (latest && Number.isFinite(revokedMs) && Date.parse(latest.completed_at) > revokedMs) warnings.push("checkpoint write-run occurred after approval revocation in event history")
        if (!stagedActive) warnings.push("staged checkpoint write is no longer active")
        if (!latest && effectiveStatus === "approved" && stale) warnings.push("approved checkpoint write has not been used within stale threshold")
        return redactValue({
          approval_id: approval.approval_id,
          staged_write_id: approval.staged_write_id,
          command: approval.command,
          approval_status: effectiveStatus,
          approved_at: approval.approved_at,
          expires_at: approval.expires_at,
          revoked_at: approval.revoked_at,
          used: approvalRuns.length > 0,
          run_ids: approvalRuns.map((run) => run.run_id).slice(0, 10),
          latest_run_id: latest?.run_id,
          latest_run_status: latest?.status,
          latest_run_at: latest?.completed_at,
          stale,
          expired_before_use: expiredBeforeUse,
          revoked_before_use: revokedBeforeUse,
          warnings: warnings.map(preview).slice(0, 10),
          recommended_commands: recommendedCommands(approval.staged_write_id, latest?.run_id, approval.approval_id),
        })
      })
      .sort((left, right) => (right.latest_run_at ?? right.approved_at ?? "").localeCompare(left.latest_run_at ?? left.approved_at ?? "") || left.approval_id.localeCompare(right.approval_id))
    return redactValue(usage)
  }

  outcomeHash(run: Pick<TerminalCheckpointRun, "command" | "command_name" | "execution_kind" | "risk" | "authority_gate" | "status" | "result_kind" | "result_summary" | "error" | "checkpoint_scope" | "event_count">): WakeSchedulerNavigationCheckpointWriteOutcomeHash {
    return outcomeHash(run)
  }

  private async groups(query: (HistoryQuery | GroupQuery) & { approval_id?: string }): Promise<WakeSchedulerNavigationCheckpointWriteGroup[]> {
    const grouped = new Map<string, TerminalCheckpointRun[]>()
    for (const run of await this.terminalRuns()) {
      if (query.staged_write_id && run.staged_write_id !== query.staged_write_id) continue
      if (query.approval_id && run.approval_id !== query.approval_id) continue
      if (query.command && run.command !== query.command) continue
      const rows = grouped.get(run.staged_write_id) ?? []
      rows.push(run)
      grouped.set(run.staged_write_id, rows)
    }
    const groups = [...grouped.values()].map((runs) => groupFromRuns(runs))
    return redactValue(groups.sort((left, right) => (right.latest_completed_at ?? "").localeCompare(left.latest_completed_at ?? "") || left.staged_write_id.localeCompare(right.staged_write_id)).slice(0, query.limit))
  }

  private async terminalRuns(): Promise<TerminalCheckpointRun[]> {
    const runs = new Map<string, TerminalCheckpointRun>()
    for (const event of await this.eventStore.readAll()) {
      const run = runFromEvent(event)
      if (run) runs.set(run.run_id, run)
    }
    return [...runs.values()].sort((left, right) => right.completed_at.localeCompare(left.completed_at) || left.run_id.localeCompare(right.run_id))
  }

  private async approvals(): Promise<ApprovalRecord[]> {
    const approvals = new Map<string, ApprovalRecord>()
    for (const event of await this.eventStore.readAll()) {
      const kind = String(event.kind ?? "")
      if (kind === "runtime_wake_scheduler_navigation_write_approval_recorded") {
        const approval = approvalFromEvent(event)
        if (approval) approvals.set(approval.approval_id, approval)
      } else if (kind === "runtime_wake_scheduler_navigation_write_approval_revoked" && typeof event.approval_id === "string") {
        const existing = approvals.get(event.approval_id)
        if (existing) approvals.set(existing.approval_id, redactValue({
          ...existing,
          status: "revoked" as const,
          revoked_at: readString(event.revoked_at ?? event.created_at, ""),
          updated_at: readString(event.revoked_at ?? event.created_at, ""),
        }))
      }
    }
    return [...approvals.values()]
  }
}

export function stableWakeSchedulerNavigationCheckpointWriteOutcomeHash(value: Pick<TerminalCheckpointRun, "command" | "command_name" | "execution_kind" | "risk" | "authority_gate" | "status" | "result_kind" | "result_summary" | "error" | "checkpoint_scope" | "event_count">): WakeSchedulerNavigationCheckpointWriteOutcomeHash {
  return outcomeHash(value)
}

export function readWakeSchedulerNavigationCheckpointWriteHistoryInput(value: unknown): WakeSchedulerNavigationCheckpointWriteHistoryInput {
  return readHistoryInput(value)
}

export function readWakeSchedulerNavigationCheckpointWriteCompareInput(value: unknown): WakeSchedulerNavigationCheckpointWriteCompareInput {
  return readCompareInput(value)
}

export function readWakeSchedulerNavigationCheckpointWriteStaleInput(value: unknown): WakeSchedulerNavigationCheckpointWriteStaleInput {
  return readStaleInput(value)
}

export function readWakeSchedulerNavigationCheckpointWriteGroupInput(value: unknown): WakeSchedulerNavigationCheckpointWriteGroupInput {
  return readGroupInput(value)
}

export function readWakeSchedulerNavigationCheckpointApprovalUsageInput(value: unknown): WakeSchedulerNavigationCheckpointApprovalUsageInput {
  return readApprovalUsageInput(value)
}

function runFromEvent(event: JsonlEvent): TerminalCheckpointRun | null {
  const kind = String(event.kind ?? "")
  if (
    kind !== "runtime_wake_scheduler_navigation_checkpoint_write_run_succeeded" &&
    kind !== "runtime_wake_scheduler_navigation_checkpoint_write_run_failed" &&
    kind !== "runtime_wake_scheduler_navigation_checkpoint_write_run_blocked"
  ) return null
  if (typeof event.run_id !== "string" || typeof event.staged_write_id !== "string" || typeof event.command !== "string") return null
  const run = redactValue({
    run_id: preview(event.run_id),
    staged_write_id: preview(event.staged_write_id),
    approval_id: typeof event.approval_id === "string" ? preview(event.approval_id) : undefined,
    command: preview(event.command),
    command_name: readString(event.command_name, readCommandName(event.command)),
    execution_kind: event.execution_kind === "checkpoint_create" ? "checkpoint_create" as const : "blocked" as const,
    risk: readString(event.risk, "unsupported"),
    authority_gate: readString(event.authority_gate, "unknown"),
    status: readStatus(event.status),
    checkpoint_id: typeof event.checkpoint_id === "string" ? preview(event.checkpoint_id) : undefined,
    checkpoint_hash: typeof event.checkpoint_hash === "string" ? preview(event.checkpoint_hash) : undefined,
    event_count: Number.isInteger(event.event_count) ? Number(event.event_count) : undefined,
    result_kind: typeof event.result_kind === "string" ? preview(event.result_kind) : undefined,
    result_summary: typeof event.result_summary === "string" ? preview(event.result_summary) : undefined,
    error: typeof event.error === "string" ? preview(event.error) : undefined,
    started_at: readString(event.started_at ?? event.created_at ?? event.timestamp, ""),
    completed_at: readString(event.completed_at ?? event.created_at ?? event.timestamp, ""),
    requested_by: readString(event.requested_by, "operator"),
    result_hash: typeof event.result_hash === "string" ? preview(event.result_hash) : undefined,
    checkpoint_scope: checkpointScopeFromCommand(event.command),
  })
  return { ...run, outcome_hash: outcomeHash(run).outcome_hash }
}

function approvalFromEvent(event: JsonlEvent): ApprovalRecord | null {
  if (typeof event.approval_id !== "string" || typeof event.staged_write_id !== "string" || typeof event.command !== "string") return null
  return redactValue({
    approval_id: preview(event.approval_id),
    staged_write_id: preview(event.staged_write_id),
    staged_event_id: typeof event.staged_event_id === "string" ? preview(event.staged_event_id) : undefined,
    command: preview(event.command),
    command_name: readString(event.command_name, readCommandName(event.command)),
    risk: readString(event.risk, "unsupported"),
    authority_gate: readString(event.authority_gate, "unknown"),
    status: readApprovalStatus(event.status),
    approved_at: typeof event.approved_at === "string" ? preview(event.approved_at) : undefined,
    rejected_at: typeof event.rejected_at === "string" ? preview(event.rejected_at) : undefined,
    revoked_at: typeof event.revoked_at === "string" ? preview(event.revoked_at) : undefined,
    expires_at: typeof event.expires_at === "string" ? preview(event.expires_at) : undefined,
    staged_at: typeof event.staged_at === "string" ? preview(event.staged_at) : undefined,
    stage_hash: typeof event.stage_hash === "string" ? preview(event.stage_hash) : undefined,
    updated_at: readString(event.created_at ?? event.approved_at ?? event.rejected_at, ""),
  })
}

function activeStagedProjection(stagedCommands: Array<{ staged_write_id: string; staged_event_id?: string; staged_at?: string; stage_hash?: string }>): Map<string, ActiveStagedInstance[]> {
  const out = new Map<string, ActiveStagedInstance[]>()
  for (const staged of stagedCommands) {
    const existing = out.get(staged.staged_write_id) ?? []
    existing.push({ staged_event_id: staged.staged_event_id, staged_at: staged.staged_at, stage_hash: staged.stage_hash })
    out.set(staged.staged_write_id, existing)
  }
  return out
}

function stagedInstanceIsActive(approval: ApprovalRecord, activeStaged: Map<string, ActiveStagedInstance[]>): boolean {
  const active = activeStaged.get(approval.staged_write_id) ?? []
  if (active.length === 0) return false
  if (approval.staged_event_id) return active.some((staged) => staged.staged_event_id === approval.staged_event_id)
  if (!approval.staged_at && !approval.stage_hash) return true
  return active.some((staged) => staged.staged_at === approval.staged_at && staged.stage_hash === approval.stage_hash)
}

function groupFromRuns(runs: TerminalCheckpointRun[]): WakeSchedulerNavigationCheckpointWriteGroup {
  const sorted = [...runs].sort((left, right) => right.completed_at.localeCompare(left.completed_at) || left.run_id.localeCompare(right.run_id))
  const latest = sorted[0]
  const previous = sorted[1]
  const comparisonStatus = latest ? groupStatus(latest, previous) : "unknown"
  const artifactChanged = Boolean(latest && previous && artifactChangedBetween(previous, latest))
  const approvalIds = [...new Set(sorted.map((run) => run.approval_id).filter((id): id is string => Boolean(id)))]
  return redactValue({
    group_id: `wake_scheduler_navigation_checkpoint_write_group_${hashText(latest.staged_write_id).slice(0, 16)}`,
    staged_write_id: latest.staged_write_id,
    command: latest.command,
    command_name: latest.command_name,
    approval_ids: approvalIds.slice(0, 10),
    run_count: sorted.length,
    succeeded_count: sorted.filter((run) => run.status === "succeeded").length,
    failed_count: sorted.filter((run) => run.status === "failed").length,
    blocked_count: sorted.filter((run) => run.status === "blocked").length,
    latest_run_id: latest.run_id,
    latest_approval_id: latest.approval_id,
    latest_checkpoint_id: latest.checkpoint_id,
    latest_checkpoint_hash: latest.checkpoint_hash,
    latest_event_count: latest.event_count,
    latest_completed_at: latest.completed_at,
    latest_status: latest.status,
    latest_outcome_hash: latest.outcome_hash,
    previous_run_id: previous?.run_id,
    previous_outcome_hash: previous?.outcome_hash,
    comparison_status: comparisonStatus,
    checkpoint_artifact_changed: artifactChanged,
    summary_preview: preview(`${comparisonStatus} checkpoint write: ${latest.result_summary ?? latest.error ?? latest.command}`),
    recommended_commands: recommendedCommands(latest.staged_write_id, latest.run_id, latest.approval_id),
  })
}

function pairComparison(left: TerminalCheckpointRun, right: TerminalCheckpointRun): WakeSchedulerNavigationCheckpointWritePairComparison {
  const status = pairStatus(left, right)
  const sameStaged = left.staged_write_id === right.staged_write_id
  const artifactDelta = artifactDeltaSummary(left, right)
  const approvalDelta = approvalDeltaSummary(left, right)
  return redactValue({
    comparison_id: `wake_scheduler_navigation_checkpoint_write_compare_${hashText(`${left.run_id}:${right.run_id}`).slice(0, 16)}`,
    staged_write_id: sameStaged ? left.staged_write_id : "mixed",
    command: left.command === right.command ? left.command : `${left.command} <> ${right.command}`,
    left_run_id: left.run_id,
    right_run_id: right.run_id,
    left_approval_id: left.approval_id,
    right_approval_id: right.approval_id,
    left_checkpoint_id: left.checkpoint_id,
    right_checkpoint_id: right.checkpoint_id,
    left_checkpoint_hash: left.checkpoint_hash,
    right_checkpoint_hash: right.checkpoint_hash,
    left_event_count: left.event_count,
    right_event_count: right.event_count,
    left_completed_at: left.completed_at,
    right_completed_at: right.completed_at,
    left_status: left.status,
    right_status: right.status,
    left_outcome_hash: left.outcome_hash,
    right_outcome_hash: right.outcome_hash,
    comparison_status: status,
    checkpoint_artifact_delta: artifactDelta,
    approval_delta: approvalDelta,
    summary_delta: preview(deltaSummary(left, right, status)),
    warnings: sameStaged ? ["comparison uses bounded checkpoint write-run summaries; checkpoint artifacts are tracked separately"] : ["comparing runs from different staged checkpoint writes", "comparison uses bounded checkpoint write-run summaries; checkpoint artifacts are tracked separately"],
    recommended_commands: recommendedCommands(sameStaged ? left.staged_write_id : right.staged_write_id, right.run_id, right.approval_id),
  })
}

function firstRunComparison(run: TerminalCheckpointRun): WakeSchedulerNavigationCheckpointWritePairComparison {
  return redactValue({
    comparison_id: `wake_scheduler_navigation_checkpoint_write_compare_${hashText(`${run.run_id}:first`).slice(0, 16)}`,
    staged_write_id: run.staged_write_id,
    command: run.command,
    left_run_id: run.run_id,
    right_run_id: run.run_id,
    left_approval_id: run.approval_id,
    right_approval_id: run.approval_id,
    left_checkpoint_id: run.checkpoint_id,
    right_checkpoint_id: run.checkpoint_id,
    left_checkpoint_hash: run.checkpoint_hash,
    right_checkpoint_hash: run.checkpoint_hash,
    left_event_count: run.event_count,
    right_event_count: run.event_count,
    left_completed_at: run.completed_at,
    right_completed_at: run.completed_at,
    left_status: run.status,
    right_status: run.status,
    left_outcome_hash: run.outcome_hash,
    right_outcome_hash: run.outcome_hash,
    comparison_status: "first_run",
    checkpoint_artifact_delta: artifactDeltaSummary(run, run),
    approval_delta: approvalDeltaSummary(run, run),
    summary_delta: preview(`first recorded checkpoint write-run outcome for ${run.command}`),
    warnings: ["only one terminal checkpoint write-run outcome is available"],
    recommended_commands: recommendedCommands(run.staged_write_id, run.run_id, run.approval_id),
  })
}

function groupStatus(latest: TerminalCheckpointRun, previous?: TerminalCheckpointRun): WakeSchedulerNavigationCheckpointWriteComparisonStatus {
  if (!previous) return "first_run"
  return pairStatus(previous, latest)
}

function pairStatus(left: TerminalCheckpointRun, right: TerminalCheckpointRun): WakeSchedulerNavigationCheckpointWriteComparisonStatus {
  if (left.status === "failed" || right.status === "failed") return left.outcome_hash === right.outcome_hash ? "failed" : "changed"
  if (left.status === "blocked" || right.status === "blocked") return left.outcome_hash === right.outcome_hash ? "blocked" : "changed"
  return left.outcome_hash === right.outcome_hash ? "unchanged" : "changed"
}

function deltaSummary(left: TerminalCheckpointRun, right: TerminalCheckpointRun, status: WakeSchedulerNavigationCheckpointWriteComparisonStatus): string {
  if (status === "unchanged") return `unchanged bounded checkpoint write outcome for ${right.command}`
  if (status === "failed") return `same failed bounded checkpoint write outcome for ${right.command}`
  if (status === "blocked") return `same blocked bounded checkpoint write outcome for ${right.command}`
  return `changed bounded checkpoint write outcome from ${left.status}/${left.result_kind ?? "none"} to ${right.status}/${right.result_kind ?? "none"}`
}

function artifactChangedBetween(left: TerminalCheckpointRun, right: TerminalCheckpointRun): boolean {
  return (left.checkpoint_hash ?? "") !== (right.checkpoint_hash ?? "") || (left.event_count ?? -1) !== (right.event_count ?? -1)
}

function artifactDeltaSummary(left: TerminalCheckpointRun, right: TerminalCheckpointRun): string | undefined {
  if (!left.checkpoint_id && !right.checkpoint_id && left.event_count === right.event_count) return undefined
  if (!artifactChangedBetween(left, right)) return `checkpoint artifact unchanged hash=${right.checkpoint_hash ?? "none"} events=${right.event_count ?? "unknown"}`
  return `checkpoint artifact changed hash ${left.checkpoint_hash ?? "none"} -> ${right.checkpoint_hash ?? "none"} events ${left.event_count ?? "unknown"} -> ${right.event_count ?? "unknown"}`
}

function approvalDeltaSummary(left: TerminalCheckpointRun, right: TerminalCheckpointRun): string | undefined {
  if (!left.approval_id && !right.approval_id) return undefined
  if (left.approval_id === right.approval_id) return `same approval ${right.approval_id}`
  return `approval changed from ${left.approval_id ?? "none"} to ${right.approval_id ?? "none"}`
}

function outcomeHash(value: Pick<TerminalCheckpointRun, "command" | "command_name" | "execution_kind" | "risk" | "authority_gate" | "status" | "result_kind" | "result_summary" | "error" | "checkpoint_scope" | "event_count">): WakeSchedulerNavigationCheckpointWriteOutcomeHash {
  const hash_basis = redactValue({
    command: preview(value.command),
    command_name: preview(value.command_name),
    execution_kind: value.execution_kind,
    risk: preview(value.risk),
    authority_gate: preview(value.authority_gate),
    status: value.status,
    result_kind: value.result_kind ? preview(value.result_kind) : undefined,
    result_summary: value.result_summary ? normalizeOutcomeText(value.result_summary) : undefined,
    error: value.error ? preview(value.error) : undefined,
    checkpoint_scope: value.checkpoint_scope ? preview(value.checkpoint_scope) : undefined,
  })
  return { outcome_hash: hashText(stableJson(hash_basis)), hash_basis }
}

function normalizeOutcomeText(value: string): string {
  return preview(value)
    .replace(/\bcheckpoint_[A-Za-z0-9_-]+\b/g, "checkpoint_[ARTIFACT_ID]")
    .replace(/\b[0-9a-f]{64}\b/gi, "[ARTIFACT_HASH]")
    .replace(/\bevents=\d+\b/g, "events=[ARTIFACT_EVENT_COUNT]")
}

function recommendedCommands(stagedWriteId: string, runId?: string, approvalId?: string): WakeSchedulerNavigationCheckpointWriteCompareCommand[] {
  const commands: WakeSchedulerNavigationCheckpointWriteCompareCommand[] = [
    { label: "Preview checkpoint write", command: `/scheduler-nav-checkpoint-run-preview ${stagedWriteId}`, command_type: "read", notes: "read-only execution eligibility preview" },
    { label: "Run checkpoint write", command: `/scheduler-nav-checkpoint-run ${stagedWriteId}`, command_type: "write", requires_active_runtime: true, notes: "explicit approved checkpoint write execution path" },
    { label: "List checkpoint write runs", command: "/scheduler-nav-checkpoint-runs", command_type: "read" },
    { label: "Compare checkpoint writes", command: `/scheduler-nav-checkpoint-compare ${stagedWriteId}`, command_type: "read" },
    { label: "List write approvals", command: "/scheduler-nav-write-approvals", command_type: "read" },
  ]
  if (runId) commands.push({ label: "Show checkpoint write run", command: `/scheduler-nav-checkpoint-run-show ${runId}`, command_type: "read" })
  if (approvalId) commands.push({ label: "Show write approval", command: `/scheduler-nav-write-approval-show ${approvalId}`, command_type: "read" })
  return commands
}

function latestRunByStaged(runs: TerminalCheckpointRun[]): Map<string, TerminalCheckpointRun> {
  const latest = new Map<string, TerminalCheckpointRun>()
  for (const run of runs) if (!latest.has(run.staged_write_id)) latest.set(run.staged_write_id, run)
  return latest
}

function approvalStatusAt(approval: ApprovalRecord, now: string): ApprovalRecord["status"] {
  if (approval.status === "approved" && approval.expires_at && Date.parse(approval.expires_at) <= Date.parse(now)) return "expired"
  return approval.status
}

function authoritativeApprovedByStaged(approvals: ApprovalRecord[], activeStaged: Map<string, ActiveStagedInstance[]>, now: string): Map<string, ApprovalRecord> {
  const grouped = new Map<string, Array<{ approval: ApprovalRecord; index: number }>>()
  approvals.forEach((approval, index) => {
    if (approval.command_name !== "/checkpoint" || approval.risk !== "medium_risk_write" || approval.authority_gate !== "checkpoint_runtime") return
    const effective = effectiveApprovalForActiveStaged(approval, activeStaged, now)
    if (effective.status === "expired") return
    const rows = grouped.get(effective.staged_write_id) ?? []
    rows.push({ approval: effective, index })
    grouped.set(effective.staged_write_id, rows)
  })
  const out = new Map<string, ApprovalRecord>()
  for (const [stagedWriteId, rows] of grouped) {
    const latest = rows.sort((left, right) => left.approval.updated_at.localeCompare(right.approval.updated_at) || left.index - right.index).at(-1)?.approval
    if (latest?.status === "approved") out.set(stagedWriteId, latest)
  }
  return out
}

function effectiveApprovalForActiveStaged(approval: ApprovalRecord, activeStaged: Map<string, ActiveStagedInstance[]>, now: string): ApprovalRecord {
  const status = approvalStatusAt(approval, now)
  if (status === "approved" && !stagedInstanceIsActive(approval, activeStaged)) return { ...approval, status: "expired" }
  return { ...approval, status }
}

function readHistoryInput(value: unknown): HistoryQuery {
  const record = isRecord(value) ? value : {}
  return {
    staged_write_id: optionalCleanString(record.staged_write_id ?? record.stagedWriteId),
    approval_id: optionalCleanString(record.approval_id ?? record.approvalId),
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

function readApprovalUsageInput(value: unknown): ApprovalUsageQuery {
  const record = isRecord(value) ? value : {}
  return {
    approval_id: optionalCleanString(record.approval_id ?? record.approvalId),
    staged_write_id: optionalCleanString(record.staged_write_id ?? record.stagedWriteId),
    command: optionalCleanString(record.command),
    limit: readLimit(record.limit),
    stale_after_ms: readDurationMs(record.stale_after_ms ?? record.staleAfterMs, DEFAULT_STALE_AFTER_MS, "stale_after_ms"),
  }
}

function readLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_LIMIT
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error("scheduler checkpoint write comparison limit must be a positive integer")
  return Math.min(Number(value), HARD_LIMIT)
}

function readDurationMs(value: unknown, fallback: number, field: string): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${field} must be a positive integer in milliseconds`)
  return Number(value)
}

function readStatus(value: unknown): TerminalCheckpointRun["status"] {
  return value === "succeeded" || value === "failed" || value === "blocked" ? value : "failed"
}

function readApprovalStatus(value: unknown): ApprovalRecord["status"] {
  return value === "approved" || value === "rejected" || value === "revoked" || value === "expired" || value === "pending" ? value : "pending"
}

function readCommandName(command: unknown): string {
  if (typeof command !== "string") return ""
  return preview(command.trim().split(/\s+/)[0] ?? "")
}

function checkpointScopeFromCommand(command: unknown): string | undefined {
  if (typeof command !== "string") return undefined
  const [name, scope] = command.trim().split(/\s+/)
  return name === "/checkpoint" && scope ? preview(scope) : undefined
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
