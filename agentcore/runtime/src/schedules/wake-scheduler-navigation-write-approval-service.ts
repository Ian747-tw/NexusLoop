import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { WakeSchedulerNavigationWriteStagingService } from "./wake-scheduler-navigation-write-staging-service"
import type { WakeSchedulerNavigationStagedWriteCommand } from "./wake-scheduler-navigation-write-staging-types"
import type {
  WakeSchedulerNavigationWriteApproval,
  WakeSchedulerNavigationWriteApprovalCommand,
  WakeSchedulerNavigationWriteApprovalInput,
  WakeSchedulerNavigationWriteApprovalListInput,
  WakeSchedulerNavigationWriteApprovalRecord,
  WakeSchedulerNavigationWriteApprovalRejectInput,
  WakeSchedulerNavigationWriteApprovalRevokeInput,
  WakeSchedulerNavigationWriteApprovalStatus,
  WakeSchedulerNavigationWriteEvidence,
  WakeSchedulerNavigationWriteReadinessInput,
  WakeSchedulerNavigationWriteReadinessPreview,
  WakeSchedulerNavigationWriteReadinessStatus,
} from "./wake-scheduler-navigation-write-approval-types"

const DEFAULT_LIMIT = 20
const HARD_LIMIT = 100
const PREVIEW_CHARS = 1024
const DEFAULT_MAX_EVIDENCE_AGE_MS = 60 * 60 * 1000
const DEFAULT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000
const MAX_APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000

const APPROVAL_ELIGIBLE = new Set([
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

const HIGH_IMPACT_BLOCKED = new Set([
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
  "/proposal-review",
  "/apply-proposal",
  "/apply-target",
])

interface ReadinessQuery {
  staged_write_id: string
  max_evidence_age_ms: number
}

interface ApprovalMutationInput {
  staged_write_id: string
  requested_by: string
  reason?: string
  expires_at?: string
  max_evidence_age_ms: number
}

interface RejectInput {
  staged_write_id: string
  requested_by: string
  reason?: string
}

interface RevokeInput {
  approval_id: string
  requested_by: string
  reason?: string
}

interface ListInput {
  limit: number
  staged_write_id?: string
  status?: WakeSchedulerNavigationWriteApprovalStatus
}

export class WakeSchedulerNavigationWriteApprovalService {
  constructor(
    private readonly eventStore: EventStore,
    private readonly staging: WakeSchedulerNavigationWriteStagingService,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async preview(input: WakeSchedulerNavigationWriteReadinessInput): Promise<WakeSchedulerNavigationWriteReadinessPreview> {
    const query = readReadinessInput(input)
    const staged = await this.staging.get(query.staged_write_id)
    if (!staged) return missingPreview(query.staged_write_id)
    const approvals = await this.approvals()
    const existing = activeApprovalRecord(approvals.filter((approval) => approval.staged_write_id === staged.staged_write_id), staged, this.now())
    return redactValue(readinessFromStaged(staged, query.max_evidence_age_ms, this.now(), existing, await this.eventStore.readAll()))
  }

  async approve(input: WakeSchedulerNavigationWriteApprovalInput): Promise<WakeSchedulerNavigationWriteApproval> {
    const normalized = readApproveInput(input)
    const previewRecord = await this.preview({ staged_write_id: normalized.staged_write_id, max_evidence_age_ms: normalized.max_evidence_age_ms })
    if (!previewRecord.can_approve) throw new Error(`scheduler navigation write approval is not ready: ${previewRecord.blockers.join("; ")}`)
    const expiresAt = boundedExpiresAt(normalized.expires_at, this.now())
    const staged = await this.staging.get(normalized.staged_write_id)
    if (!staged) throw new Error("staged write command is not active")
    const approval = approvalFromPreview(previewRecord, staged, "approved", normalized.requested_by, normalized.reason, expiresAt, this.now())
    await this.eventStore.append({
      kind: "runtime_wake_scheduler_navigation_write_approval_recorded",
      created_at: approval.updated_at,
      approval_id: approval.approval_id,
      staged_write_id: approval.staged_write_id,
      command: approval.command,
      command_name: approval.command_name,
      risk: approval.risk,
      authority_gate: approval.authority_gate,
      target_kind: approval.target_kind,
      target_id: approval.target_id,
      staged_at: approval.staged_at,
      stage_hash: approval.stage_hash,
      status: approval.status,
      approved_at: approval.approved_at,
      requested_by: approval.requested_by,
      reason: approval.reason,
      evidence: approval.evidence,
      approval_hash: approval.approval_hash,
      expires_at: approval.expires_at,
      summary_preview: approval.summary_preview,
    })
    return redactValue(approval)
  }

  async reject(input: WakeSchedulerNavigationWriteApprovalRejectInput): Promise<WakeSchedulerNavigationWriteApproval> {
    const normalized = readRejectInput(input)
    const staged = await this.staging.get(normalized.staged_write_id)
    if (!staged) throw new Error("staged write command is not active")
    const previewRecord = readinessFromStaged(staged, DEFAULT_MAX_EVIDENCE_AGE_MS, this.now(), undefined, await this.eventStore.readAll())
    const approval = approvalFromPreview(previewRecord, staged, "rejected", normalized.requested_by, normalized.reason, undefined, this.now())
    await this.eventStore.append({
      kind: "runtime_wake_scheduler_navigation_write_approval_recorded",
      created_at: approval.updated_at,
      approval_id: approval.approval_id,
      staged_write_id: approval.staged_write_id,
      command: approval.command,
      command_name: approval.command_name,
      risk: approval.risk,
      authority_gate: approval.authority_gate,
      target_kind: approval.target_kind,
      target_id: approval.target_id,
      staged_at: approval.staged_at,
      stage_hash: approval.stage_hash,
      status: approval.status,
      rejected_at: approval.rejected_at,
      requested_by: approval.requested_by,
      reason: approval.reason,
      evidence: approval.evidence,
      approval_hash: approval.approval_hash,
      summary_preview: approval.summary_preview,
    })
    return redactValue(approval)
  }

  async revoke(input: WakeSchedulerNavigationWriteApprovalRevokeInput): Promise<WakeSchedulerNavigationWriteApproval | null> {
    const normalized = readRevokeInput(input)
    const approval = (await this.approvals()).find((item) => item.approval_id === normalized.approval_id) ?? null
    if (!approval) throw new Error("scheduler navigation write approval was not found")
    const revokedAt = this.now()
    const revoked: WakeSchedulerNavigationWriteApproval = redactValue({ ...approval, status: "revoked" as const, revoked_at: revokedAt, updated_at: revokedAt, requested_by: normalized.requested_by, reason: normalized.reason ?? approval.reason })
    await this.eventStore.append({
      kind: "runtime_wake_scheduler_navigation_write_approval_revoked",
      created_at: revokedAt,
      approval_id: normalized.approval_id,
      staged_write_id: approval.staged_write_id,
      requested_by: normalized.requested_by,
      reason: normalized.reason,
      revoked_at: revokedAt,
    })
    return redactValue(revoked)
  }

  async get(approvalId: string): Promise<WakeSchedulerNavigationWriteApproval | null> {
    const activeStaged = activeStagedProjection(await this.staging.activeCommands())
    const approval = (await this.approvals()).find((item) => item.approval_id === cleanString(approvalId, "approval_id")) ?? null
    return approval ? redactValue(deriveApprovalStatus(approval, this.now(), activeStaged)) : null
  }

  async list(input: WakeSchedulerNavigationWriteApprovalListInput = {}): Promise<WakeSchedulerNavigationWriteApprovalRecord[]> {
    const query = readListInput(input)
    const activeStaged = activeStagedProjection(await this.staging.activeCommands())
    return redactValue((await this.approvals())
      .map((approval) => deriveApprovalStatus(approval, this.now(), activeStaged))
      .filter((approval) => !query.staged_write_id || approval.staged_write_id === query.staged_write_id)
      .filter((approval) => !query.status || approval.status === query.status)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at) || left.approval_id.localeCompare(right.approval_id))
      .slice(0, query.limit)
      .map(recordFromApproval))
  }

  private async approvals(): Promise<WakeSchedulerNavigationWriteApproval[]> {
    const approvals = new Map<string, WakeSchedulerNavigationWriteApproval>()
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
          requested_by: readString(event.requested_by, existing.requested_by),
          reason: typeof event.reason === "string" ? preview(event.reason) : existing.reason,
        }))
      }
    }
    return [...approvals.values()]
  }
}

export function readWakeSchedulerNavigationWriteReadinessInput(value: unknown): WakeSchedulerNavigationWriteReadinessInput {
  return readReadinessInput(value)
}

export function readWakeSchedulerNavigationWriteApprovalInput(value: unknown): WakeSchedulerNavigationWriteApprovalInput {
  return readApproveInput(value)
}

export function readWakeSchedulerNavigationWriteApprovalRejectInput(value: unknown): WakeSchedulerNavigationWriteApprovalRejectInput {
  return readRejectInput(value)
}

export function readWakeSchedulerNavigationWriteApprovalRevokeInput(value: unknown): WakeSchedulerNavigationWriteApprovalRevokeInput {
  return readRevokeInput(value)
}

export function readWakeSchedulerNavigationWriteApprovalListInput(value: unknown): WakeSchedulerNavigationWriteApprovalListInput {
  return readListInput(value)
}

function readinessFromStaged(staged: WakeSchedulerNavigationStagedWriteCommand, maxEvidenceAgeMs: number, now: string, existing?: WakeSchedulerNavigationWriteApprovalRecord, events: JsonlEvent[] = []): WakeSchedulerNavigationWriteReadinessPreview {
  const blockers: string[] = []
  const warnings = ["7X approval records future operator intent only; it does not execute staged writes"]
  const requiredEvidence: WakeSchedulerNavigationWriteEvidence[] = []
  const optionalEvidence: WakeSchedulerNavigationWriteEvidence[] = []
  if (staged.risk === "low_risk_write") blockers.push("low-risk staged writes do not require 7X medium-risk approval")
  if (staged.risk === "high_impact_write") blockers.push("high-impact staged writes are blocked from 7X approval")
  if (staged.risk === "unsupported") blockers.push("unsupported staged writes cannot be approved")
  if (staged.risk === "medium_risk_write" && !APPROVAL_ELIGIBLE.has(staged.command_name)) blockers.push(`${staged.command_name} is not in the 7X approval whitelist`)
  if (HIGH_IMPACT_BLOCKED.has(staged.command_name)) blockers.push(`${staged.command_name} remains blocked from 7X approval`)
  const shapeBlocker = targetShapeBlocker(staged)
  if (shapeBlocker) blockers.push(shapeBlocker)
  const required = requiredEvidenceFor(staged, now, maxEvidenceAgeMs, events)
  requiredEvidence.push(...required)
  blockers.push(...required.flatMap((evidence) => evidence.blockers))
  const readinessStatus: WakeSchedulerNavigationWriteReadinessStatus = staged.risk === "high_impact_write"
    ? "high_impact_blocked"
    : staged.risk === "unsupported"
      ? "unsupported"
      : blockers.some((blocker) => blocker.includes("evidence"))
        ? "needs_evidence"
        : blockers.length > 0
          ? "blocked"
          : "ready_for_approval"
  const recommended = recommendedCommands(staged)
  optionalEvidence.push(manualEvidence(staged, now, maxEvidenceAgeMs))
  return redactValue({
    staged_write_id: staged.staged_write_id,
    command: staged.command,
    command_name: staged.command_name,
    risk: staged.risk,
    authority_gate: staged.authority_gate,
    target_kind: staged.target_kind,
    target_id: staged.target_id,
    readiness_status: readinessStatus,
    can_approve: readinessStatus === "ready_for_approval",
    can_execute_now: false as const,
    blockers: [...new Set(blockers)].slice(0, 10).map(preview),
    warnings: warnings.slice(0, 10).map(preview),
    required_evidence: requiredEvidence.slice(0, 10),
    optional_evidence: optionalEvidence.slice(0, 10),
    existing_approval: existing,
    recommended_commands: recommended.slice(0, 10),
    redacted_summary_preview: preview(`${readinessStatus} ${staged.risk} ${staged.authority_gate}: ${staged.command}`),
  })
}

function requiredEvidenceFor(staged: WakeSchedulerNavigationStagedWriteCommand, now: string, maxEvidenceAgeMs: number, events: JsonlEvent[]): WakeSchedulerNavigationWriteEvidence[] {
  if (staged.command_name === "/checkpoint") return []
  const command = staged.command_name
  if (command === "/scheduler-recovery-ack" || command === "/scheduler-recovery-resolve" || command === "/scheduler-recovery-dismiss" || command === "/scheduler-recovery-workflow") {
    return [evidenceFor(events, "audit_chain", staged.target_id, staged.command, now, maxEvidenceAgeMs, "recent scheduler recovery evidence is required before approval")]
  }
  if (command === "/scheduler-recovery-step-done" || command === "/scheduler-recovery-step-skip" || command === "/scheduler-recovery-step-block" || command === "/scheduler-recovery-workflow-cancel") {
    return [evidenceFor(events, "audit_chain", staged.target_id, staged.command, now, maxEvidenceAgeMs, "recent recovery workflow evidence is required before approval")]
  }
  if (command === "/continue-plan") return [evidenceFor(events, "safe_read_run", targetIdForEvidence(staged), staged.command, now, maxEvidenceAgeMs, "recent wake evidence is required before approval")]
  if (command === "/continue-pause" || command === "/continue-cancel") return [evidenceFor(events, "safe_read_run", staged.target_id, staged.command, now, maxEvidenceAgeMs, "recent continuation plan evidence is required before approval")]
  return []
}

function evidenceFor(events: JsonlEvent[], kind: WakeSchedulerNavigationWriteEvidence["kind"], relatedId: string | undefined, command: string, now: string, maxEvidenceAgeMs: number, summary: string): WakeSchedulerNavigationWriteEvidence {
  const terminalEvidence = latestEvidenceEvent(events, relatedId, command)
  if (!terminalEvidence) return missingEvidence(kind, relatedId, command, maxEvidenceAgeMs, summary)
  const completedAt = terminalEvidence.completed_at
  const completedMs = Date.parse(completedAt)
  const nowMs = Date.parse(now)
  const age = Number.isFinite(completedMs) && Number.isFinite(nowMs) ? Math.max(0, nowMs - completedMs) : undefined
  const fresh = terminalEvidence.status === "succeeded" && age !== undefined && age <= maxEvidenceAgeMs
  const evidenceKind = terminalEvidence.command.startsWith("/scheduler-audit-chain") ? "audit_chain" : kind
  return redactValue({
    evidence_id: `wake_scheduler_write_evidence_${hashText(`${terminalEvidence.run_id}:${relatedId ?? command}`).slice(0, 16)}`,
    kind: evidenceKind,
    related_id: relatedId,
    command: terminalEvidence.command,
    status: terminalEvidence.status,
    completed_at: completedAt,
    fresh,
    age_ms: age,
    summary_preview: preview(`${fresh ? "fresh" : "insufficient"} evidence from ${terminalEvidence.command}: ${terminalEvidence.summary}`),
    blockers: fresh ? [] : [`${summary}; latest evidence is ${terminalEvidence.status}, stale, or undated; max evidence age is ${maxEvidenceAgeMs}ms`].map(preview),
    warnings: fresh ? [] : ["run the recommended read commands manually, then preview readiness again"].map(preview),
  })
}

function latestEvidenceEvent(events: JsonlEvent[], relatedId: string | undefined, stagedCommand: string): { run_id: string; command: string; status: string; completed_at: string; summary: string } | undefined {
  const target = relatedId ? preview(relatedId) : undefined
  return events
    .map(evidenceEvent)
    .filter((event): event is { run_id: string; command: string; status: string; completed_at: string; summary: string } => Boolean(event))
    .filter((event) => evidenceMatches(event.command, target, stagedCommand))
    .sort((left, right) => right.completed_at.localeCompare(left.completed_at) || right.run_id.localeCompare(left.run_id))[0]
}

function evidenceEvent(event: JsonlEvent): { run_id: string; command: string; status: string; completed_at: string; summary: string } | null {
  const kind = String(event.kind ?? "")
  if (
    kind !== "runtime_wake_scheduler_navigation_staged_read_succeeded" &&
    kind !== "runtime_wake_scheduler_navigation_staged_read_failed" &&
    kind !== "runtime_wake_scheduler_navigation_staged_read_blocked" &&
    kind !== "runtime_wake_scheduler_navigation_write_run_succeeded" &&
    kind !== "runtime_wake_scheduler_navigation_write_run_failed" &&
    kind !== "runtime_wake_scheduler_navigation_write_run_blocked"
  ) return null
  if (typeof event.run_id !== "string" || typeof event.command !== "string") return null
  return redactValue({
    run_id: preview(event.run_id),
    command: preview(event.command),
    status: readString(event.status, kind.endsWith("_succeeded") ? "succeeded" : kind.endsWith("_failed") ? "failed" : "blocked"),
    completed_at: readString(event.completed_at ?? event.created_at ?? event.timestamp, ""),
    summary: readString(event.result_summary ?? event.error ?? event.summary_preview, ""),
  })
}

function evidenceMatches(evidenceCommand: string, relatedId: string | undefined, stagedCommand: string): boolean {
  if (!relatedId) return false
  if (evidenceCommand.includes(relatedId)) return true
  if (stagedCommand.startsWith("/scheduler-recovery-") && (evidenceCommand === "/scheduler-recovery" || evidenceCommand === "/scheduler-recovery-preview")) return true
  if (stagedCommand.startsWith("/scheduler-recovery-workflow") && evidenceCommand === "/scheduler-recovery-workflows") return true
  if (stagedCommand.startsWith("/continue-") && evidenceCommand === "/continuations") return true
  return false
}

function missingEvidence(kind: WakeSchedulerNavigationWriteEvidence["kind"], relatedId: string | undefined, command: string, maxEvidenceAgeMs: number, summary: string): WakeSchedulerNavigationWriteEvidence {
  return redactValue({
    evidence_id: `wake_scheduler_write_evidence_missing_${hashText(`${kind}:${relatedId ?? command}`).slice(0, 16)}`,
    kind,
    related_id: relatedId,
    command,
    status: "missing",
    completed_at: undefined,
    fresh: false,
    age_ms: undefined,
    summary_preview: preview(summary),
    blockers: [`${summary}; max evidence age is ${maxEvidenceAgeMs}ms`].map(preview),
    warnings: ["run the recommended read commands manually, then preview readiness again"].map(preview),
  })
}

function manualEvidence(staged: WakeSchedulerNavigationStagedWriteCommand, now: string, maxEvidenceAgeMs: number): WakeSchedulerNavigationWriteEvidence {
  return redactValue({
    evidence_id: `wake_scheduler_write_evidence_manual_${hashText(`${staged.staged_write_id}:${now}`).slice(0, 16)}`,
    kind: "manual_note" as const,
    related_id: staged.staged_write_id,
    command: staged.command,
    status: "optional",
    completed_at: now,
    fresh: true,
    age_ms: 0,
    summary_preview: preview(`operator should verify current state within ${maxEvidenceAgeMs}ms before future execution`),
    blockers: [],
    warnings: ["manual evidence is informational and does not execute the staged write"].map(preview),
  })
}

function targetShapeBlocker(staged: WakeSchedulerNavigationStagedWriteCommand): string | undefined {
  if (staged.command_name === "/continue-plan" && !/\bwake=/.test(staged.command)) return "continue-plan approval requires wake=<wakeId>"
  if ((staged.command_name === "/scheduler-recovery-step-done" || staged.command_name === "/scheduler-recovery-step-skip" || staged.command_name === "/scheduler-recovery-step-block") && !/\s\d+\b/.test(staged.command)) return "recovery workflow step approval requires a numeric step index"
  if (staged.command_name === "/continue-plan") return undefined
  if (staged.command_name !== "/checkpoint" && !staged.target_id) return "target id is required for medium-risk approval"
  return undefined
}

function targetIdForEvidence(staged: WakeSchedulerNavigationStagedWriteCommand): string | undefined {
  if (staged.target_id) return staged.target_id
  const match = /\bwake=([^\s]+)/.exec(staged.command)
  return match?.[1] ? preview(match[1]) : undefined
}

function approvalFromPreview(previewRecord: WakeSchedulerNavigationWriteReadinessPreview, staged: WakeSchedulerNavigationStagedWriteCommand, status: "approved" | "rejected", requestedBy: string, reason: string | undefined, expiresAt: string | undefined, now: string): WakeSchedulerNavigationWriteApproval {
  const hashBasis = {
    staged_write_id: previewRecord.staged_write_id,
    command: previewRecord.command,
    command_name: previewRecord.command_name,
    risk: previewRecord.risk,
    authority_gate: previewRecord.authority_gate,
    target_kind: previewRecord.target_kind,
    target_id: previewRecord.target_id,
    staged_at: staged.staged_at,
    stage_hash: staged.stage_hash,
    status,
    reason,
    evidence: previewRecord.required_evidence.map((item) => ({ evidence_id: item.evidence_id, fresh: item.fresh, summary_preview: item.summary_preview })),
    expires_at: expiresAt,
  }
  const approvalHash = hashText(stableJson(hashBasis))
  const approvalId = `wake_scheduler_navigation_write_approval_${hashText(`${previewRecord.staged_write_id}:${staged.staged_at ?? ""}:${staged.stage_hash ?? ""}:${status}`).slice(0, 16)}`
  return redactValue({
    approval_id: approvalId,
    staged_write_id: previewRecord.staged_write_id,
    command: previewRecord.command,
    command_name: previewRecord.command_name,
    risk: previewRecord.risk,
    authority_gate: previewRecord.authority_gate,
    target_kind: previewRecord.target_kind,
    target_id: previewRecord.target_id,
    staged_at: staged.staged_at,
    stage_hash: staged.stage_hash,
    status,
    approved_at: status === "approved" ? now : undefined,
    rejected_at: status === "rejected" ? now : undefined,
    updated_at: now,
    requested_by: requestedBy,
    reason,
    evidence: [...previewRecord.required_evidence, ...previewRecord.optional_evidence].slice(0, 20),
    approval_hash: approvalHash,
    expires_at: expiresAt,
    summary_preview: preview(`${status} ${previewRecord.command}`),
  })
}

function approvalFromEvent(event: JsonlEvent): WakeSchedulerNavigationWriteApproval | null {
  if (typeof event.approval_id !== "string" || typeof event.staged_write_id !== "string" || typeof event.command !== "string") return null
  const status = readApprovalStatus(event.status)
  return redactValue({
    approval_id: preview(event.approval_id),
    staged_write_id: preview(event.staged_write_id),
    command: preview(event.command),
    command_name: readString(event.command_name, readCommandName(event.command)),
    risk: readRisk(event.risk),
    authority_gate: readAuthorityGate(event.authority_gate),
    target_kind: readString(event.target_kind, "unknown"),
    target_id: typeof event.target_id === "string" ? preview(event.target_id) : undefined,
    staged_at: typeof event.staged_at === "string" ? preview(event.staged_at) : undefined,
    stage_hash: typeof event.stage_hash === "string" ? preview(event.stage_hash) : undefined,
    status,
    approved_at: typeof event.approved_at === "string" ? preview(event.approved_at) : undefined,
    rejected_at: typeof event.rejected_at === "string" ? preview(event.rejected_at) : undefined,
    revoked_at: typeof event.revoked_at === "string" ? preview(event.revoked_at) : undefined,
    updated_at: readString(event.approved_at ?? event.rejected_at ?? event.revoked_at ?? event.created_at, ""),
    requested_by: readString(event.requested_by, "operator"),
    reason: typeof event.reason === "string" ? preview(event.reason) : undefined,
    evidence: Array.isArray(event.evidence) ? event.evidence.filter(isRecord).slice(0, 20).map(readEvidence) : [],
    approval_hash: readString(event.approval_hash, ""),
    expires_at: typeof event.expires_at === "string" ? preview(event.expires_at) : undefined,
    summary_preview: readString(event.summary_preview, ""),
  })
}

function readEvidence(value: Record<string, unknown>): WakeSchedulerNavigationWriteEvidence {
  return redactValue({
    evidence_id: readString(value.evidence_id, ""),
    kind: readEvidenceKind(value.kind),
    related_id: typeof value.related_id === "string" ? preview(value.related_id) : undefined,
    command: typeof value.command === "string" ? preview(value.command) : undefined,
    status: typeof value.status === "string" ? preview(value.status) : undefined,
    completed_at: typeof value.completed_at === "string" ? preview(value.completed_at) : undefined,
    fresh: value.fresh === true,
    age_ms: typeof value.age_ms === "number" && Number.isFinite(value.age_ms) ? Math.max(0, Math.trunc(value.age_ms)) : undefined,
    summary_preview: readString(value.summary_preview, ""),
    blockers: Array.isArray(value.blockers) ? value.blockers.filter((item): item is string => typeof item === "string").slice(0, 10).map(preview) : [],
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((item): item is string => typeof item === "string").slice(0, 10).map(preview) : [],
  })
}

function activeApprovalRecord(approvals: WakeSchedulerNavigationWriteApproval[], staged: WakeSchedulerNavigationStagedWriteCommand, now: string): WakeSchedulerNavigationWriteApprovalRecord | undefined {
  const activeStaged = activeStagedProjection([staged])
  return approvals
    .map((approval) => deriveApprovalStatus(approval, now, activeStaged))
    .filter((approval) => approval.status === "approved")
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0]
    ? recordFromApproval(approvals.map((approval) => deriveApprovalStatus(approval, now, activeStaged)).filter((approval) => approval.status === "approved").sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0])
    : undefined
}

function deriveApprovalStatus(approval: WakeSchedulerNavigationWriteApproval, now: string, activeStaged: Map<string, Array<{ staged_at?: string; stage_hash?: string }>>): WakeSchedulerNavigationWriteApproval {
  if (approval.status === "approved") {
    if (!stagedInstanceIsActive(approval, activeStaged)) return redactValue({ ...approval, status: "expired" as const, summary_preview: preview(`expired inactive staged write ${approval.command}`) })
    if (approval.expires_at && Date.parse(approval.expires_at) <= Date.parse(now)) return redactValue({ ...approval, status: "expired" as const, summary_preview: preview(`expired ${approval.command}`) })
  }
  return approval
}

function activeStagedProjection(stagedCommands: WakeSchedulerNavigationStagedWriteCommand[]): Map<string, Array<{ staged_at?: string; stage_hash?: string }>> {
  const out = new Map<string, Array<{ staged_at?: string; stage_hash?: string }>>()
  for (const staged of stagedCommands) {
    const existing = out.get(staged.staged_write_id) ?? []
    existing.push({ staged_at: staged.staged_at, stage_hash: staged.stage_hash })
    out.set(staged.staged_write_id, existing)
  }
  return out
}

function stagedInstanceIsActive(approval: WakeSchedulerNavigationWriteApproval, activeStaged: Map<string, Array<{ staged_at?: string; stage_hash?: string }>>): boolean {
  const active = activeStaged.get(approval.staged_write_id) ?? []
  if (active.length === 0) return false
  if (!approval.staged_at && !approval.stage_hash) return true
  return active.some((staged) => staged.staged_at === approval.staged_at && staged.stage_hash === approval.stage_hash)
}

function recordFromApproval(approval: WakeSchedulerNavigationWriteApproval): WakeSchedulerNavigationWriteApprovalRecord {
  return redactValue({
    approval_id: approval.approval_id,
    staged_write_id: approval.staged_write_id,
    command: approval.command,
    risk: approval.risk,
    authority_gate: approval.authority_gate,
    status: approval.status,
    updated_at: approval.updated_at,
    summary_preview: approval.summary_preview,
    approval_hash: approval.approval_hash,
  })
}

function missingPreview(stagedWriteId: string): WakeSchedulerNavigationWriteReadinessPreview {
  return redactValue({
    staged_write_id: preview(stagedWriteId),
    command: "",
    command_name: "",
    risk: "unsupported" as const,
    authority_gate: "unknown" as const,
    target_kind: "unknown",
    readiness_status: "blocked" as const,
    can_approve: false,
    can_execute_now: false as const,
    blockers: ["staged write command is not active"].map(preview),
    warnings: ["removed or cleared staged writes cannot be approved"].map(preview),
    required_evidence: [],
    optional_evidence: [],
    recommended_commands: [command("List staged writes", "/scheduler-nav-write-staged", "read")],
    redacted_summary_preview: preview(`missing staged write ${stagedWriteId}`),
  })
}

function recommendedCommands(staged: WakeSchedulerNavigationStagedWriteCommand): WakeSchedulerNavigationWriteApprovalCommand[] {
  const commands: WakeSchedulerNavigationWriteApprovalCommand[] = [
    command("Preview write readiness", `/scheduler-nav-write-readiness ${staged.staged_write_id}`, "read"),
    command("List staged writes", "/scheduler-nav-write-staged", "read"),
    command("List approvals", "/scheduler-nav-write-approvals", "read"),
  ]
  for (const read of staged.safer_read_commands.slice(0, 5)) commands.push(read)
  commands.push(command("Approve for future execution", `/scheduler-nav-write-approve ${staged.staged_write_id}`, "write", true, "approval records future intent only"))
  commands.push(command("Reject staged write", `/scheduler-nav-write-reject ${staged.staged_write_id}`, "write", true, "rejection records operator decision only"))
  return commands
}

function command(label: string, cmd: string, commandType: "read" | "write", requiresActiveRuntime?: boolean, notes?: string): WakeSchedulerNavigationWriteApprovalCommand {
  return { label: preview(label), command: preview(cmd), command_type: commandType, requires_active_runtime: requiresActiveRuntime, notes: notes ? preview(notes) : undefined }
}

function readReadinessInput(value: unknown): ReadinessQuery {
  if (!isRecord(value)) throw new Error("scheduler navigation write readiness input is required")
  return {
    staged_write_id: cleanString(value.staged_write_id ?? value.stagedWriteId, "staged_write_id"),
    max_evidence_age_ms: readOptionalDuration(value.max_evidence_age_ms ?? value.maxEvidenceAgeMs, DEFAULT_MAX_EVIDENCE_AGE_MS, MAX_EVIDENCE_AGE_MS, "max_evidence_age_ms"),
  }
}

function readApproveInput(value: unknown): ApprovalMutationInput {
  if (!isRecord(value)) throw new Error("scheduler navigation write approval input is required")
  return {
    staged_write_id: cleanString(value.staged_write_id ?? value.stagedWriteId, "staged_write_id"),
    requested_by: optionalCleanString(value.requested_by ?? value.requestedBy) ?? "scheduler-navigation-write-approval",
    reason: optionalCleanString(value.reason),
    expires_at: optionalCleanString(value.expires_at ?? value.expiresAt),
    max_evidence_age_ms: readOptionalDuration(value.max_evidence_age_ms ?? value.maxEvidenceAgeMs, DEFAULT_MAX_EVIDENCE_AGE_MS, MAX_EVIDENCE_AGE_MS, "max_evidence_age_ms"),
  }
}

function readRejectInput(value: unknown): RejectInput {
  if (!isRecord(value)) throw new Error("scheduler navigation write rejection input is required")
  return {
    staged_write_id: cleanString(value.staged_write_id ?? value.stagedWriteId, "staged_write_id"),
    requested_by: optionalCleanString(value.requested_by ?? value.requestedBy) ?? "scheduler-navigation-write-approval",
    reason: optionalCleanString(value.reason),
  }
}

function readRevokeInput(value: unknown): RevokeInput {
  if (!isRecord(value)) throw new Error("scheduler navigation write approval revoke input is required")
  return {
    approval_id: cleanString(value.approval_id ?? value.approvalId, "approval_id"),
    requested_by: optionalCleanString(value.requested_by ?? value.requestedBy) ?? "scheduler-navigation-write-approval",
    reason: optionalCleanString(value.reason),
  }
}

function readListInput(value: unknown): ListInput {
  const record = isRecord(value) ? value : {}
  return {
    limit: readOptionalLimit(record.limit),
    staged_write_id: optionalCleanString(record.staged_write_id ?? record.stagedWriteId),
    status: readOptionalApprovalStatus(record.status),
  }
}

function boundedExpiresAt(value: string | undefined, now: string): string {
  const nowMs = Date.parse(now)
  if (!value) return new Date(nowMs + DEFAULT_APPROVAL_TTL_MS).toISOString()
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || parsed <= nowMs) throw new Error("expires_at must be a future ISO timestamp")
  return new Date(Math.min(parsed, nowMs + MAX_APPROVAL_TTL_MS)).toISOString()
}

function readOptionalDuration(value: unknown, fallback: number, cap: number, field: string): number {
  if (value === undefined || value === null) return fallback
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${field} must be a positive integer`)
  return Math.min(Number(value), cap)
}

function readOptionalLimit(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_LIMIT
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error("scheduler navigation write approval limit must be a positive integer")
  return Math.min(Number(value), HARD_LIMIT)
}

function readOptionalApprovalStatus(value: unknown): WakeSchedulerNavigationWriteApprovalStatus | undefined {
  if (value === undefined || value === null) return undefined
  const status = readApprovalStatus(value)
  if (status === "pending") throw new Error("scheduler navigation write approval status filter is invalid")
  return status
}

function readApprovalStatus(value: unknown): WakeSchedulerNavigationWriteApprovalStatus {
  return value === "approved" || value === "rejected" || value === "revoked" || value === "expired" || value === "pending" ? value : "pending"
}

function readEvidenceKind(value: unknown): WakeSchedulerNavigationWriteEvidence["kind"] {
  return value === "safe_read_run" || value === "safe_read_comparison" || value === "low_risk_write_run" || value === "low_risk_write_comparison" || value === "audit_chain" || value === "manual_note" ? value : "manual_note"
}

function readRisk(value: unknown): WakeSchedulerNavigationStagedWriteCommand["risk"] {
  return value === "low_risk_write" || value === "medium_risk_write" || value === "high_impact_write" || value === "unsupported" ? value : "unsupported"
}

function readAuthorityGate(value: unknown): WakeSchedulerNavigationStagedWriteCommand["authority_gate"] {
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

function readCommandName(commandValue: unknown): string {
  return typeof commandValue === "string" ? preview(commandValue.split(/\s+/)[0] ?? "") : ""
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
