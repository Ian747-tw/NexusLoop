import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import type { ProposalRegistry } from "../missions/proposal-registry"
import { redactText, redactValue } from "../security/redaction"
import type { ExecutorReviewProposalApplyCandidateKind, ExecutorReviewProposalApplyReadinessPreview } from "./executor-review-proposal-apply-readiness-types"
import type { ExecutorReviewProposalApplyReadinessService } from "./executor-review-proposal-apply-readiness-service"
import type {
  ExecutorReviewProposalNarrowApplyCommand,
  ExecutorReviewProposalNarrowApplyInput,
  ExecutorReviewProposalNarrowApplyPreview,
  ExecutorReviewProposalNarrowApplyPreviewInput,
  ExecutorReviewProposalNarrowApplyRecord,
  ExecutorReviewProposalNarrowApplyResult,
} from "./executor-review-proposal-narrow-apply-types"

const MAX_TEXT = 240
const MAX_ROWS = 12
const ALLOWED_KINDS = new Set<ExecutorReviewProposalApplyCandidateKind>(["generic", "manual_action", "human_review", "followup_task", "blocked_followup"])
const BLOCKED_KINDS = new Set<ExecutorReviewProposalApplyCandidateKind>(["mission_progress", "mission_result", "checkpoint", "unsupported"])

export type ExecutorReviewProposalNarrowApplyServiceOptions = {
  eventStore: EventStore
  proposalRegistry: ProposalRegistry
  applyReadinessService: ExecutorReviewProposalApplyReadinessService
  now?: () => Date
}

export class ExecutorReviewProposalNarrowApplyService {
  private readonly now: () => Date
  private applyQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: ExecutorReviewProposalNarrowApplyServiceOptions) {
    this.now = options.now ?? (() => new Date())
  }

  async preview(input: ExecutorReviewProposalNarrowApplyPreviewInput): Promise<ExecutorReviewProposalNarrowApplyPreview> {
    return this.buildPreview(normalizePreviewInput(input))
  }

  async apply(input: ExecutorReviewProposalNarrowApplyInput): Promise<ExecutorReviewProposalNarrowApplyResult> {
    const normalized = normalizeApplyInput(input)
    if (normalized.dry_run === true) {
      const preview = await this.buildPreview(normalized)
      const appliedAt = this.now().toISOString()
      const applyHash = applyHashFor(preview)
      return redactValue(resultFromPreview(preview, {
        apply_id: applyId(applyHash),
        status: preview.can_apply ? "dry_run" : "blocked",
        applied_at: appliedAt,
        applied_by: normalized.applied_by ?? "operator",
        reason_preview: normalized.reason,
        error: preview.can_apply ? undefined : preview.blockers[0] ?? "executor-review proposal narrow apply is blocked",
        apply_hash: applyHash,
      }))
    }
    return this.serializeApply(() => this.applyNonDry(normalized))
  }

  async list(input: { limit?: number; proposal_id?: string; status?: string; candidate_kind?: ExecutorReviewProposalApplyCandidateKind } = {}): Promise<ExecutorReviewProposalNarrowApplyRecord[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100))
    return redactValue((await this.applyResults())
      .filter((result) => !input.proposal_id || result.proposal_id === input.proposal_id)
      .filter((result) => !input.status || result.status === input.status)
      .filter((result) => !input.candidate_kind || result.candidate_kind === input.candidate_kind)
      .sort((left, right) => left.applied_at.localeCompare(right.applied_at))
      .reverse()
      .map(recordFromResult)
      .slice(0, limit))
  }

  async get(applyIdValue: string): Promise<ExecutorReviewProposalNarrowApplyResult | null> {
    const safeId = required(applyIdValue, "apply_id")
    return (await this.applyResults()).reverse().find((item) => item.apply_id === safeId) ?? null
  }

  private async applyNonDry(input: ExecutorReviewProposalNarrowApplyInput): Promise<ExecutorReviewProposalNarrowApplyResult> {
    const preview = await this.buildPreview(input)
    const appliedAt = this.now().toISOString()
    const applyHash = applyHashFor(preview)
    const id = applyId(applyHash)
    if (preview.existing_apply_id) {
      const existing = await this.get(preview.existing_apply_id)
      if (existing) return redactValue(existing)
    }
    if (!preview.can_apply) {
      return redactValue(resultFromPreview(preview, {
        apply_id: id,
        status: "blocked",
        applied_at: appliedAt,
        applied_by: input.applied_by ?? "operator",
        reason_preview: input.reason,
        error: preview.blockers[0] ?? "executor-review proposal narrow apply is blocked",
        apply_hash: applyHash,
      }))
    }
    try {
      await this.options.proposalRegistry.markProposalApplied(preview.proposal_id, `executor_review_narrow_apply:${id}`)
      const result = resultFromPreview(preview, {
        apply_id: id,
        status: "applied",
        applied_at: appliedAt,
        applied_by: input.applied_by ?? "operator",
        reason_preview: input.reason,
        apply_hash: applyHash,
      })
      await this.append("commander_executor_review_proposal_narrow_applied", result)
      return redactValue(result)
    } catch (error) {
      const result = resultFromPreview(preview, {
        apply_id: id,
        status: "failed",
        applied_at: appliedAt,
        applied_by: input.applied_by ?? "operator",
        reason_preview: input.reason,
        error: bound(error instanceof Error ? error.message : String(error)),
        apply_hash: applyHash,
      })
      await this.append("commander_executor_review_proposal_narrow_apply_failed", result)
      return redactValue(result)
    }
  }

  private async buildPreview(input: ExecutorReviewProposalNarrowApplyPreviewInput): Promise<ExecutorReviewProposalNarrowApplyPreview> {
    const generatedAt = this.now().toISOString()
    const proposalId = optional(input.proposal_id)
    const blockers: string[] = []
    if (!proposalId) blockers.push("proposal_id is required")
    const readiness = proposalId ? await this.options.applyReadinessService.preview({ proposal_id: proposalId }) : undefined
    const existing = proposalId ? await this.findExistingApply(proposalId) : undefined
    if (readiness && input.readiness_id && input.readiness_id !== readiness.readiness_id) blockers.push("readiness_id does not match rebuilt apply-readiness")
    if (readiness && readiness.status !== "ready") blockers.push(`apply readiness is ${readiness.status}`)
    if (readiness && readiness.can_apply_in_future !== true) blockers.push("apply readiness does not permit future apply")
    if (readiness && BLOCKED_KINDS.has(readiness.candidate_kind)) blockers.push(`${readiness.candidate_kind} proposals are out of scope for narrow apply`)
    if (readiness && !ALLOWED_KINDS.has(readiness.candidate_kind)) blockers.push(`${readiness.candidate_kind} proposals are not narrow apply eligible`)
    if (readiness && readiness.action_kind === "opencode_handoff") blockers.push("opencode_handoff proposals require the dedicated handoff path")
    if (readiness && readiness.proposal_status && !["approved"].includes(readiness.proposal_status)) blockers.push(`proposal status ${readiness.proposal_status} cannot be narrow-applied`)
    if (readiness && readiness.source_evidence_ids.length === 0 && readiness.source_finding_ids.length === 0) blockers.push("executor-review source evidence metadata is incomplete")
    if (existing) blockers.push("proposal already has an executor-review narrow apply record")
    const canApply = blockers.length === 0
    const proposal = proposalId ? await this.options.proposalRegistry.getProposal(proposalId) : null
    return redactValue({
      preview_id: `executor_review_proposal_narrow_apply_preview_${sha256(`${proposalId ?? "missing"}:${input.readiness_id ?? ""}:${generatedAt}`).slice(0, 16)}`,
      status: canApply ? "ready" : "blocked",
      can_apply: canApply,
      proposal_id: bound(proposalId ?? readiness?.proposal_id ?? "unknown"),
      readiness_id: readiness?.readiness_id,
      review_request_id: readiness?.review_request_id,
      request_gate_id: readiness?.request_gate_id,
      decision_gate_id: readiness?.decision_gate_id,
      create_id: readiness?.create_id,
      source_executor_review_id: readiness?.source_executor_review_id,
      source_draft_id: readiness?.source_draft_id,
      source_packet_id: readiness?.source_packet_id,
      proposal_status: proposal?.status ?? readiness?.proposal_status,
      readiness_status: readiness?.status,
      candidate_kind: readiness?.candidate_kind ?? "generic",
      candidate_risk: readiness?.candidate_risk ?? "medium",
      proposal_title_preview: readiness?.proposal_title_preview ?? "",
      proposal_summary_preview: readiness?.proposal_summary_preview ?? "",
      action_kind: readiness?.action_kind,
      mission_id: readiness?.mission_id,
      result_id: readiness?.result_id,
      source_evidence_ids: readiness?.source_evidence_ids ?? [],
      source_finding_ids: readiness?.source_finding_ids ?? [],
      source_confidence: readiness?.source_confidence,
      existing_apply_id: existing?.apply_id,
      blockers: boundList(blockers),
      warnings: boundList(["narrow apply marks the proposal applied only and does not mutate missions, submit results, create checkpoints, call providers, launch OpenCode, or execute scheduler/wake/continuation/recovery writes"]),
      recommended_commands: recommendedCommands(proposalId, readiness),
      generated_at: generatedAt,
      redacted_summary_preview: canApply ? `Proposal ${proposalId} can be marked applied through the narrow proposal-only gate.` : blockers[0] ?? "Executor-review proposal narrow apply is blocked.",
    })
  }

  private async findExistingApply(proposalId: string): Promise<ExecutorReviewProposalNarrowApplyResult | undefined> {
    return (await this.applyResults()).find((result) => result.status === "applied" && result.proposal_id === proposalId)
  }

  private async applyResults(): Promise<ExecutorReviewProposalNarrowApplyResult[]> {
    return (await this.options.eventStore.readAll())
      .filter((event) => event.kind === "commander_executor_review_proposal_narrow_applied" || event.kind === "commander_executor_review_proposal_narrow_apply_failed")
      .map(resultFromEvent)
  }

  private async append(kind: string, result: ExecutorReviewProposalNarrowApplyResult): Promise<void> {
    await this.options.eventStore.append(redactValue({ kind, ...result }) as JsonlEvent)
  }

  private async serializeApply<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.applyQueue
    let release!: () => void
    this.applyQueue = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

export function readExecutorReviewProposalNarrowApplyPreviewInput(value: unknown): ExecutorReviewProposalNarrowApplyPreviewInput {
  return normalizePreviewInput(isRecord(value) ? value : {})
}

export function readExecutorReviewProposalNarrowApplyInput(value: unknown): ExecutorReviewProposalNarrowApplyInput {
  return normalizeApplyInput(isRecord(value) ? value : {})
}

function normalizePreviewInput(input: Record<string, unknown>): ExecutorReviewProposalNarrowApplyPreviewInput {
  return {
    proposal_id: optional(input.proposal_id ?? input.proposalId ?? input.proposal),
    readiness_id: optional(input.readiness_id ?? input.readinessId ?? input.readiness),
    reason: optional(input.reason),
    include_authority: input.include_authority === false || input.includeAuthority === false ? false : undefined,
  }
}

function normalizeApplyInput(input: Record<string, unknown>): ExecutorReviewProposalNarrowApplyInput {
  return {
    ...normalizePreviewInput(input),
    applied_by: optional(input.applied_by ?? input.appliedBy),
    dry_run: input.dry_run === true || input.dryRun === true,
  }
}

function resultFromPreview(preview: ExecutorReviewProposalNarrowApplyPreview, result: {
  apply_id: string
  status: "applied" | "blocked" | "failed" | "dry_run"
  applied_at: string
  applied_by: string
  reason_preview?: string
  error?: string
  apply_hash: string
}): ExecutorReviewProposalNarrowApplyResult {
  return {
    apply_id: result.apply_id,
    status: result.status,
    proposal_id: preview.proposal_id,
    readiness_id: preview.readiness_id,
    review_request_id: preview.review_request_id,
    request_gate_id: preview.request_gate_id,
    decision_gate_id: preview.decision_gate_id,
    create_id: preview.create_id,
    source_executor_review_id: preview.source_executor_review_id,
    source_draft_id: preview.source_draft_id,
    source_packet_id: preview.source_packet_id,
    candidate_kind: preview.candidate_kind,
    candidate_risk: preview.candidate_risk,
    applied_at: result.applied_at,
    applied_by: bound(result.applied_by),
    reason_preview: result.reason_preview ? bound(result.reason_preview) : undefined,
    error: result.error ? bound(result.error) : undefined,
    apply_hash: result.apply_hash,
    recommended_commands: preview.recommended_commands,
  }
}

function resultFromEvent(event: JsonlEvent): ExecutorReviewProposalNarrowApplyResult {
  const record = isRecord(event) ? event : {}
  return {
    apply_id: required(record.apply_id, "apply_id"),
    status: record.status === "failed" ? "failed" : "applied",
    proposal_id: required(record.proposal_id, "proposal_id"),
    readiness_id: optional(record.readiness_id),
    review_request_id: optional(record.review_request_id),
    request_gate_id: optional(record.request_gate_id),
    decision_gate_id: optional(record.decision_gate_id),
    create_id: optional(record.create_id),
    source_executor_review_id: optional(record.source_executor_review_id),
    source_draft_id: optional(record.source_draft_id),
    source_packet_id: optional(record.source_packet_id),
    candidate_kind: readCandidateKind(record.candidate_kind),
    candidate_risk: record.candidate_risk === "low" || record.candidate_risk === "high" ? record.candidate_risk : "medium",
    applied_at: optional(record.applied_at) ?? "",
    applied_by: optional(record.applied_by) ?? "operator",
    reason_preview: optional(record.reason_preview),
    error: optional(record.error),
    apply_hash: optional(record.apply_hash) ?? "",
    recommended_commands: readCommands(record.recommended_commands),
  }
}

function recordFromResult(result: ExecutorReviewProposalNarrowApplyResult): ExecutorReviewProposalNarrowApplyRecord {
  return {
    apply_id: result.apply_id,
    status: result.status,
    proposal_id: result.proposal_id,
    readiness_id: result.readiness_id,
    candidate_kind: result.candidate_kind,
    candidate_risk: result.candidate_risk,
    applied_at: result.applied_at,
    summary_preview: bound(result.error ?? result.reason_preview ?? `Narrow apply ${result.status} for ${result.proposal_id}`),
    apply_hash: result.apply_hash,
  }
}

function recommendedCommands(proposalId?: string, readiness?: ExecutorReviewProposalApplyReadinessPreview): ExecutorReviewProposalNarrowApplyCommand[] {
  const commands: ExecutorReviewProposalNarrowApplyCommand[] = [
    { label: "Show authority", command: "/authority-show /executor-review-proposal-narrow-apply", command_type: "read" },
    { label: "List narrow applies", command: "/executor-review-proposal-narrow-applies", command_type: "read" },
  ]
  if (proposalId) {
    commands.unshift({ label: "Show proposal", command: `/proposal ${proposalId}`, command_type: "read" })
    commands.push({ label: "Preview narrow apply", command: `/executor-review-proposal-narrow-apply-preview proposal=${proposalId}`, command_type: "read" })
  }
  if (readiness?.readiness_id) commands.push({ label: "Show apply readiness", command: `/executor-review-proposal-apply-readiness-show ${readiness.readiness_id}`, command_type: "read" })
  if (readiness?.decision_gate_id) commands.push({ label: "Show review decision", command: `/executor-review-proposal-review-decision-show ${readiness.decision_gate_id}`, command_type: "read" })
  return commands.slice(0, MAX_ROWS).map(readCommand)
}

function readCommands(value: unknown): ExecutorReviewProposalNarrowApplyCommand[] {
  return Array.isArray(value) ? value.map(readCommand).slice(0, MAX_ROWS) : []
}

function readCommand(value: unknown): ExecutorReviewProposalNarrowApplyCommand {
  const record = isRecord(value) ? value : {}
  return {
    label: bound(String(record.label ?? "Inspect")),
    command: bound(String(record.command ?? "/executor-review-proposal-narrow-applies")),
    command_type: record.command_type === "write" ? "write" : "read",
    requires_active_runtime: record.requires_active_runtime === true,
    notes: optional(record.notes),
  }
}

function applyHashFor(preview: ExecutorReviewProposalNarrowApplyPreview): string {
  return sha256(JSON.stringify({
    proposal_id: preview.proposal_id,
    readiness_id: preview.readiness_id,
    decision_gate_id: preview.decision_gate_id,
    create_id: preview.create_id,
    candidate_kind: preview.candidate_kind,
    candidate_risk: preview.candidate_risk,
  }))
}

function applyId(hash: string): string {
  return `executor_review_proposal_narrow_apply_${hash.slice(0, 16)}`
}

function readCandidateKind(value: unknown): ExecutorReviewProposalApplyCandidateKind {
  const text = optional(value)
  if (text === "manual_action" || text === "mission_progress" || text === "mission_result" || text === "human_review" || text === "checkpoint" || text === "followup_task" || text === "blocked_followup" || text === "generic" || text === "unsupported") return text
  return "generic"
}

function required(value: unknown, field: string): string {
  const text = optional(value)
  if (!text) throw new Error(`${field} is required`)
  return text
}

function optional(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? bound(trimmed) : undefined
}

function bound(value: string, max = MAX_TEXT): string {
  return redactText(value).replace(/\s+/g, " ").trim().slice(0, max)
}

function boundList(value: unknown, max = MAX_ROWS): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => bound(item)).filter(Boolean).slice(0, max) : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
