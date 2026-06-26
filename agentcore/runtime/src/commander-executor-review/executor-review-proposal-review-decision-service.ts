import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import type { CommanderProposal } from "../missions/proposal-types"
import type { ProposalRegistry } from "../missions/proposal-registry"
import type { ReviewRegistry } from "../missions/review-registry"
import type { ReviewRequest } from "../missions/review-types"
import { redactText, redactValue } from "../security/redaction"
import type { ExecutorReviewProposalReviewRequestService } from "./executor-review-proposal-review-request-service"
import type {
  ExecutorReviewProposalReviewDecision,
  ExecutorReviewProposalReviewDecisionCommand,
  ExecutorReviewProposalReviewDecisionInput,
  ExecutorReviewProposalReviewDecisionPreview,
  ExecutorReviewProposalReviewDecisionPreviewInput,
  ExecutorReviewProposalReviewDecisionRecord,
  ExecutorReviewProposalReviewDecisionResult,
} from "./executor-review-proposal-review-decision-types"
import type { ExecutorReviewProposalReviewRequestRecord, ExecutorReviewProposalReviewRequestResult } from "./executor-review-proposal-review-request-types"

const MAX_TEXT = 240
const MAX_ROWS = 12

export type ExecutorReviewProposalReviewDecisionServiceOptions = {
  eventStore: EventStore
  proposalRegistry: ProposalRegistry
  reviewRegistry: ReviewRegistry
  requestService: ExecutorReviewProposalReviewRequestService
  now?: () => Date
}

export class ExecutorReviewProposalReviewDecisionService {
  private readonly now: () => Date
  private decisionQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: ExecutorReviewProposalReviewDecisionServiceOptions) {
    this.now = options.now ?? (() => new Date())
  }

  async preview(input: ExecutorReviewProposalReviewDecisionPreviewInput): Promise<ExecutorReviewProposalReviewDecisionPreview> {
    return this.buildPreview(normalizePreviewInput(input))
  }

  async decide(input: ExecutorReviewProposalReviewDecisionInput): Promise<ExecutorReviewProposalReviewDecisionResult> {
    const normalized = normalizeDecisionInput(input)
    if (normalized.dry_run === true) {
      const preview = await this.buildPreview(normalized)
      const decidedAt = this.now().toISOString()
      const decisionHash = decisionHashFor(preview)
      return redactValue(resultFromPreview(preview, {
        decision_gate_id: decisionGateId(decisionHash),
        status: preview.can_decide ? "dry_run" : "blocked",
        decided_at: decidedAt,
        decided_by: normalized.decided_by ?? "operator",
        reason_preview: normalized.reason,
        error: preview.can_decide ? undefined : preview.blockers[0] ?? "executor-review proposal review decision is blocked",
        decision_hash: decisionHash,
      }))
    }
    return this.serializeDecision(() => this.decideNonDry(normalized))
  }

  private async decideNonDry(normalized: ExecutorReviewProposalReviewDecisionInput): Promise<ExecutorReviewProposalReviewDecisionResult> {
    const preview = await this.buildPreview(normalized)
    const decidedAt = this.now().toISOString()
    const decisionHash = decisionHashFor(preview)
    const gateId = decisionGateId(decisionHash)
    const duplicateOnly = preview.existing_decision
      && preview.blockers.length === 1
      && preview.blockers[0] === `review request already ${preview.existing_decision}`
    if (duplicateOnly) {
      try {
        await this.options.proposalRegistry.syncReviewDecision(preview.review_request_id)
        const recovered = await this.resultFromReviewRequest(preview.review_request_id, normalized.decision)
        if (recovered) return redactValue(recovered)
      } catch (error) {
        const result = resultFromPreview(preview, {
          decision_gate_id: gateId,
          status: "failed",
          decided_at: decidedAt,
          decided_by: normalized.decided_by ?? "operator",
          reason_preview: normalized.reason,
          error: bound(error instanceof Error ? error.message : String(error)),
          decision_hash: decisionHash,
        })
        await this.append("commander_executor_review_proposal_review_decision_failed", result)
        return redactValue(result)
      }
      return redactValue(resultFromPreview(preview, {
        decision_gate_id: gateId,
        status: "blocked",
        decided_at: decidedAt,
        decided_by: normalized.decided_by ?? "operator",
        reason_preview: normalized.reason,
        error: `review request already ${preview.existing_decision}`,
        decision_hash: decisionHash,
      }))
    }
    if (!preview.can_decide) {
      const blockedDecisionHash = blockedDecisionHashFor(preview, normalized)
      const result = resultFromPreview(preview, {
        decision_gate_id: decisionGateId(blockedDecisionHash),
        status: "blocked",
        decided_at: decidedAt,
        decided_by: normalized.decided_by ?? "operator",
        reason_preview: normalized.reason,
        error: preview.blockers[0] ?? "executor-review proposal review decision is blocked",
        decision_hash: blockedDecisionHash,
      })
      await this.append("commander_executor_review_proposal_review_decision_blocked", result)
      return redactValue(result)
    }
    try {
      const by = normalized.decided_by ?? "operator"
      const review = normalized.decision === "approve"
        ? await this.options.reviewRegistry.approveReviewRequest(preview.review_request_id, by, normalized.reason)
        : await this.options.reviewRegistry.rejectReviewRequest(preview.review_request_id, by, normalized.reason)
      await this.options.proposalRegistry.syncReviewDecision(review.review_id)
      const result = resultFromPreview(preview, {
        decision_gate_id: gateId,
        status: normalized.decision === "approve" ? "approved" : "rejected",
        decided_at: review.decision_at ?? decidedAt,
        decided_by: review.decision_by ?? by,
        reason_preview: review.decision_reason ?? normalized.reason,
        decision_hash: decisionHash,
      })
      await this.append(normalized.decision === "approve"
        ? "commander_executor_review_proposal_review_approved"
        : "commander_executor_review_proposal_review_rejected", result)
      return redactValue(result)
    } catch (error) {
      const result = resultFromPreview(preview, {
        decision_gate_id: gateId,
        status: "failed",
        decided_at: decidedAt,
        decided_by: normalized.decided_by ?? "operator",
        reason_preview: normalized.reason,
        error: bound(error instanceof Error ? error.message : String(error)),
        decision_hash: decisionHash,
      })
      await this.append("commander_executor_review_proposal_review_decision_failed", result)
      return redactValue(result)
    }
  }

  private async serializeDecision<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.decisionQueue
    let release!: () => void
    this.decisionQueue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  async list(input: { limit?: number; review_request_id?: string; proposal_id?: string; request_gate_id?: string; decision?: ExecutorReviewProposalReviewDecision } = {}): Promise<ExecutorReviewProposalReviewDecisionRecord[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100))
    const results = await this.decisionResults()
    return redactValue(results
      .filter((result) => !input.review_request_id || result.review_request_id === input.review_request_id)
      .filter((result) => !input.proposal_id || result.proposal_id === input.proposal_id)
      .filter((result) => !input.request_gate_id || result.request_gate_id === input.request_gate_id)
      .filter((result) => !input.decision || result.decision === input.decision)
      .sort((left, right) => left.decided_at.localeCompare(right.decided_at))
      .reverse()
      .map(recordFromResult)
      .slice(0, limit))
  }

  async get(decisionGateId: string): Promise<ExecutorReviewProposalReviewDecisionResult | null> {
    const safeId = required(decisionGateId, "decision_gate_id")
    const result = (await this.decisionResults()).reverse().find((item) => item.decision_gate_id === safeId)
    return result ? redactValue(result) : null
  }

  private async buildPreview(input: ExecutorReviewProposalReviewDecisionPreviewInput): Promise<ExecutorReviewProposalReviewDecisionPreview> {
    const generatedAt = this.now().toISOString()
    const review = await this.options.reviewRegistry.getReviewRequest(input.review_request_id)
    const requestRecord = await this.findRequestRecord(input.review_request_id)
    const proposal = requestRecord?.proposal_id ? await this.options.proposalRegistry.getProposal(requestRecord.proposal_id) : null
    const payload = isRecord(proposal?.action_payload) ? proposal.action_payload : {}
    const blockers: string[] = []
    if (!review) blockers.push("review_request_id was not found")
    if (!requestRecord) blockers.push("review request was not created by executor-review proposal review-request gate")
    if (input.request_gate_id && requestRecord && input.request_gate_id !== requestRecord.request_gate_id) blockers.push("request_gate_id does not match the review-request gate record")
    if (!proposal) blockers.push("linked proposal was not found")
    if (proposal && payload.source !== "executor_review_proposal_create") blockers.push("proposal was not created by executor-review proposal creation gate")
    if (proposal && (!optional(payload.review_id) || !optional(payload.draft_id))) blockers.push("executor-review proposal source metadata is incomplete")
    if (proposal && ["cancelled", "applied"].includes(proposal.status)) blockers.push(`proposal status ${proposal.status} cannot be review-decided`)
    if (review && review.status !== "pending") blockers.push(`review request already ${review.status}`)
    if (input.decision === "reject" && !optional(input.reason)) blockers.push("reject decision requires reason")
    const canDecide = blockers.length === 0
    const warnings = ["review decision does not apply proposals, mutate missions, call providers, launch OpenCode, or execute scheduler/wake/continuation/recovery writes"]
    return redactValue({
      preview_id: `executor_review_proposal_review_decision_preview_${sha256(`${input.review_request_id}:${input.decision}:${input.request_gate_id ?? ""}:${generatedAt}`).slice(0, 16)}`,
      status: canDecide ? "ready" : "blocked",
      can_decide: canDecide,
      decision: input.decision,
      review_request_id: bound(input.review_request_id),
      proposal_id: proposal?.proposal_id ?? requestRecord?.proposal_id,
      request_gate_id: requestRecord?.request_gate_id,
      create_id: requestRecord?.create_id,
      source_executor_review_id: requestRecord?.review_id ?? optional(payload.review_id),
      source_draft_id: requestRecord?.draft_id ?? optional(payload.draft_id),
      source_packet_id: optional(payload.source_packet_id),
      review_request_status: review?.status,
      proposal_status: proposal?.status,
      proposal_title_preview: bound(proposal?.title ?? review?.title ?? ""),
      proposal_summary_preview: bound(proposal?.summary ?? review?.summary ?? ""),
      action_kind: proposal?.action_kind,
      mission_id: proposal?.mission_id ?? review?.mission_id,
      result_id: proposal?.result_id ?? review?.result_id,
      source_evidence_ids: boundList(payload.evidence_ids),
      source_finding_ids: boundList(payload.finding_ids),
      source_confidence: numberOptional(payload.source_confidence),
      risk: optional(payload.risk),
      existing_decision: review?.status === "approved" || review?.status === "rejected" || review?.status === "cancelled" ? review.status : undefined,
      existing_decision_at: review?.decision_at,
      blockers: boundList(blockers),
      warnings: boundList(warnings),
      recommended_commands: recommendedCommands(input.review_request_id, input.decision, requestRecord, proposal),
      generated_at: generatedAt,
      redacted_summary_preview: canDecide ? `Review request ${input.review_request_id} can be ${input.decision === "approve" ? "approved" : "rejected"}.` : blockers[0] ?? "Review decision is blocked.",
    })
  }

  private async findRequestRecord(reviewRequestId: string): Promise<ExecutorReviewProposalReviewRequestRecord | null> {
    const records = await this.options.requestService.list({ limit: 100, review_request_id: reviewRequestId })
    return records.find((record) => record.status === "requested" && record.review_request_id === reviewRequestId) ?? null
  }

  private async decisionEvents(): Promise<JsonlEvent[]> {
    return (await this.options.eventStore.readAll()).filter((event) =>
      event.kind === "commander_executor_review_proposal_review_approved"
      || event.kind === "commander_executor_review_proposal_review_rejected"
      || event.kind === "commander_executor_review_proposal_review_decision_blocked"
      || event.kind === "commander_executor_review_proposal_review_decision_failed")
  }

  private async decisionResults(): Promise<ExecutorReviewProposalReviewDecisionResult[]> {
    let results = (await this.decisionEvents()).map(resultFromEvent)
    for (const review of await this.options.reviewRegistry.listAllReviewRequests()) {
      if (review.status !== "approved" && review.status !== "rejected") continue
      const recovered = await this.resultFromReviewRequest(review.review_id, review.status === "approved" ? "approve" : "reject")
      if (!recovered) continue
      const matches = (result: ExecutorReviewProposalReviewDecisionResult) =>
        result.decision_gate_id === recovered.decision_gate_id
        || (result.review_request_id === recovered.review_request_id && result.status === recovered.status)
      if (results.some((result) => matches(result))) continue
      results = results.filter((result) => !matches(result))
      results.push(recovered)
    }
    return results
  }

  private async resultFromReviewRequest(reviewRequestId: string, decision: ExecutorReviewProposalReviewDecision): Promise<ExecutorReviewProposalReviewDecisionResult | undefined> {
    const review = await this.options.reviewRegistry.getReviewRequest(reviewRequestId)
    if (!review || (review.status !== "approved" && review.status !== "rejected")) return undefined
    if ((decision === "approve" && review.status !== "approved") || (decision === "reject" && review.status !== "rejected")) return undefined
    const requestRecord = await this.findRequestRecord(reviewRequestId)
    if (!requestRecord) return undefined
    const proposal = requestRecord.proposal_id ? await this.options.proposalRegistry.getProposal(requestRecord.proposal_id) : null
    const preview = previewFromRecoveredReview(review, decision, requestRecord, proposal)
    const decisionHash = decisionHashFor(preview)
    return resultFromPreview(preview, {
      decision_gate_id: decisionGateId(decisionHash),
      status: review.status,
      decided_at: review.decision_at ?? review.updated_at,
      decided_by: review.decision_by ?? "operator",
      reason_preview: review.decision_reason,
      decision_hash: decisionHash,
    })
  }

  private async append(kind: string, result: ExecutorReviewProposalReviewDecisionResult): Promise<void> {
    await this.options.eventStore.append({ kind, ...redactValue(result) } as JsonlEvent)
  }
}

export function readExecutorReviewProposalReviewDecisionPreviewInput(value: unknown): ExecutorReviewProposalReviewDecisionPreviewInput {
  if (!isRecord(value)) throw new Error("executor review proposal review decision requires review_request_id")
  return normalizePreviewInput(value)
}

export function readExecutorReviewProposalReviewDecisionInput(value: unknown): ExecutorReviewProposalReviewDecisionInput {
  if (!isRecord(value)) throw new Error("executor review proposal review decision requires review_request_id")
  return normalizeDecisionInput(value)
}

function normalizePreviewInput(input: Record<string, unknown>): ExecutorReviewProposalReviewDecisionPreviewInput {
  return {
    review_request_id: required(input.review_request_id ?? input.reviewRequestId ?? input.reviewId ?? input.review_id, "review_request_id"),
    decision: readDecision(input.decision),
    reason: optional(input.reason),
    request_gate_id: optional(input.request_gate_id ?? input.requestGateId ?? input.request),
    include_authority: input.include_authority === false || input.includeAuthority === false ? false : undefined,
  }
}

function normalizeDecisionInput(input: Record<string, unknown>): ExecutorReviewProposalReviewDecisionInput {
  return {
    ...normalizePreviewInput(input),
    decided_by: optional(input.decided_by ?? input.decidedBy) ?? "operator",
    dry_run: input.dry_run === true || input.dryRun === true,
  }
}

function resultFromPreview(preview: ExecutorReviewProposalReviewDecisionPreview, input: {
  decision_gate_id: string
  status: ExecutorReviewProposalReviewDecisionResult["status"]
  decided_at: string
  decided_by: string
  reason_preview?: string
  error?: string
  decision_hash: string
}): ExecutorReviewProposalReviewDecisionResult {
  return {
    decision_gate_id: input.decision_gate_id,
    status: input.status,
    decision: preview.decision,
    review_request_id: preview.review_request_id,
    proposal_id: preview.proposal_id,
    request_gate_id: preview.request_gate_id,
    create_id: preview.create_id,
    source_executor_review_id: preview.source_executor_review_id,
    source_draft_id: preview.source_draft_id,
    source_packet_id: preview.source_packet_id,
    mission_id: preview.mission_id,
    result_id: preview.result_id,
    decided_at: input.decided_at,
    decided_by: input.decided_by,
    reason_preview: optional(input.reason_preview),
    error: input.error,
    decision_hash: input.decision_hash,
    recommended_commands: preview.recommended_commands,
  }
}

function recordFromResult(result: ExecutorReviewProposalReviewDecisionResult): ExecutorReviewProposalReviewDecisionRecord {
  return {
    decision_gate_id: result.decision_gate_id,
    status: result.status,
    decision: result.decision,
    review_request_id: result.review_request_id,
    proposal_id: result.proposal_id,
    request_gate_id: result.request_gate_id,
    create_id: result.create_id,
    decided_at: result.decided_at,
    summary_preview: bound(result.error ?? result.reason_preview ?? result.review_request_id),
    decision_hash: result.decision_hash,
  }
}

function resultFromEvent(event: JsonlEvent): ExecutorReviewProposalReviewDecisionResult {
  return {
    decision_gate_id: String(event.decision_gate_id ?? ""),
    status: event.status === "approved" || event.status === "rejected" || event.status === "blocked" || event.status === "failed" || event.status === "dry_run" ? event.status : "blocked",
    decision: event.decision === "reject" ? "reject" : "approve",
    review_request_id: String(event.review_request_id ?? ""),
    proposal_id: optional(event.proposal_id),
    request_gate_id: optional(event.request_gate_id),
    create_id: optional(event.create_id),
    source_executor_review_id: optional(event.source_executor_review_id),
    source_draft_id: optional(event.source_draft_id),
    source_packet_id: optional(event.source_packet_id),
    mission_id: optional(event.mission_id),
    result_id: optional(event.result_id),
    decided_at: String(event.decided_at ?? event.timestamp ?? ""),
    decided_by: String(event.decided_by ?? "operator"),
    reason_preview: optional(event.reason_preview),
    error: optional(event.error),
    decision_hash: String(event.decision_hash ?? ""),
    recommended_commands: Array.isArray(event.recommended_commands) ? event.recommended_commands.map(readCommand).slice(0, MAX_ROWS) : [],
  }
}

function previewFromRecoveredReview(
  review: ReviewRequest,
  decision: ExecutorReviewProposalReviewDecision,
  requestRecord: ExecutorReviewProposalReviewRequestRecord,
  proposal: CommanderProposal | null,
): ExecutorReviewProposalReviewDecisionPreview {
  const payload = isRecord(proposal?.action_payload) ? proposal.action_payload : {}
  return {
    preview_id: "recovered",
    status: "blocked",
    can_decide: false,
    decision,
    review_request_id: review.review_id,
    proposal_id: requestRecord.proposal_id,
    request_gate_id: requestRecord.request_gate_id,
    create_id: requestRecord.create_id,
    source_executor_review_id: requestRecord.review_id ?? optional(payload.review_id),
    source_draft_id: requestRecord.draft_id ?? optional(payload.draft_id),
    source_packet_id: optional(payload.source_packet_id),
    review_request_status: review.status,
    proposal_status: proposal?.status,
    proposal_title_preview: bound(proposal?.title ?? review.title),
    proposal_summary_preview: bound(proposal?.summary ?? review.summary),
    action_kind: proposal?.action_kind,
    mission_id: proposal?.mission_id ?? review.mission_id,
    result_id: proposal?.result_id ?? review.result_id,
    source_evidence_ids: boundList(payload.evidence_ids),
    source_finding_ids: boundList(payload.finding_ids),
    source_confidence: numberOptional(payload.source_confidence),
    risk: optional(payload.risk),
    existing_decision: review.status === "approved" || review.status === "rejected" || review.status === "cancelled" ? review.status : undefined,
    existing_decision_at: review.decision_at,
    blockers: [`review request already ${review.status}`],
    warnings: [],
    recommended_commands: recommendedCommands(review.review_id, decision, requestRecord, proposal),
    generated_at: review.updated_at,
    redacted_summary_preview: `Review request already ${review.status}.`,
  }
}

function decisionHashFor(preview: ExecutorReviewProposalReviewDecisionPreview): string {
  return sha256(JSON.stringify({
    decision: preview.decision,
    review_request_id: preview.review_request_id,
    proposal_id: preview.proposal_id,
    request_gate_id: preview.request_gate_id,
    create_id: preview.create_id,
    source_executor_review_id: preview.source_executor_review_id,
    source_draft_id: preview.source_draft_id,
    source_packet_id: preview.source_packet_id,
    mission_id: preview.mission_id,
    result_id: preview.result_id,
    source_evidence_ids: preview.source_evidence_ids,
    source_finding_ids: preview.source_finding_ids,
    risk: preview.risk,
  }))
}

function blockedDecisionHashFor(preview: ExecutorReviewProposalReviewDecisionPreview, input: ExecutorReviewProposalReviewDecisionInput): string {
  return sha256(JSON.stringify({
    decision: preview.decision,
    review_request_id: preview.review_request_id,
    request_gate_id: preview.request_gate_id,
    attempted_request_gate_id: input.request_gate_id,
    blockers: preview.blockers,
  }))
}

function decisionGateId(decisionHash: string): string {
  return `executor_review_proposal_review_decision_${decisionHash.slice(0, 16)}`
}

function recommendedCommands(
  reviewRequestId: string,
  decision: ExecutorReviewProposalReviewDecision,
  requestRecord?: ExecutorReviewProposalReviewRequestRecord | null,
  proposal?: CommanderProposal | null,
): ExecutorReviewProposalReviewDecisionCommand[] {
  const commands: ExecutorReviewProposalReviewDecisionCommand[] = [
    { label: "Show review", command: `/review ${reviewRequestId}`, command_type: "read" },
    { label: "Preview decision", command: `/executor-review-proposal-review-decision-preview review=${reviewRequestId} decision=${decision}`, command_type: "read" },
    { label: "Dry-run decision", command: `/executor-review-proposal-review-decision-dry-run review=${reviewRequestId} decision=${decision}${decision === "reject" ? " reason=<reason>" : ""}`, command_type: "read" },
    { label: "List decisions", command: "/executor-review-proposal-review-decisions", command_type: "read" },
    { label: "Show authority", command: decision === "approve" ? "/authority-show /executor-review-proposal-review-approve" : "/authority-show /executor-review-proposal-review-reject", command_type: "read" },
  ]
  if (proposal?.proposal_id ?? requestRecord?.proposal_id) commands.push({ label: "Show proposal", command: `/proposal ${proposal?.proposal_id ?? requestRecord?.proposal_id}`, command_type: "read" })
  if (requestRecord?.request_gate_id) commands.push({ label: "Show request gate", command: `/executor-review-proposal-review-show ${requestRecord.request_gate_id}`, command_type: "read" })
  return commands.map(readCommand).slice(0, MAX_ROWS)
}

function readCommand(value: unknown): ExecutorReviewProposalReviewDecisionCommand {
  const record = isRecord(value) ? value : {}
  return {
    label: bound(String(record.label ?? "Inspect")),
    command: bound(String(record.command ?? "/executor-review-proposal-review-decisions")),
    command_type: record.command_type === "write" ? "write" : "read",
    requires_active_runtime: record.requires_active_runtime === true,
    notes: optional(record.notes),
  }
}

function readDecision(value: unknown): ExecutorReviewProposalReviewDecision {
  if (value === "approve" || value === "reject") return value
  throw new Error("decision must be approve or reject")
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

function numberOptional(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function bound(value: string, limit = MAX_TEXT): string {
  return redactText(value).replace(/\s+/g, " ").trim().slice(0, limit)
}

function boundList(value: unknown, limit = MAX_ROWS): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => bound(item)).filter(Boolean).slice(0, limit) : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
