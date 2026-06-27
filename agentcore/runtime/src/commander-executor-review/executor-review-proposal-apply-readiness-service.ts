import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import type { CommanderProposal } from "../missions/proposal-types"
import type { ProposalRegistry } from "../missions/proposal-registry"
import type { ReviewRegistry } from "../missions/review-registry"
import type { ReviewRequest } from "../missions/review-types"
import { redactText, redactValue } from "../security/redaction"
import type { ExecutorReviewProposalCreateService } from "./executor-review-proposal-create-service"
import type { ExecutorReviewProposalReviewDecisionService } from "./executor-review-proposal-review-decision-service"
import type { ExecutorReviewProposalReviewRequestService } from "./executor-review-proposal-review-request-service"
import type { ExecutorReviewProposalCreateRecord } from "./executor-review-proposal-create-types"
import type { ExecutorReviewProposalReviewDecisionRecord } from "./executor-review-proposal-review-decision-types"
import type { ExecutorReviewProposalReviewRequestRecord } from "./executor-review-proposal-review-request-types"
import type {
  ExecutorReviewProposalApplyCandidateKind,
  ExecutorReviewProposalApplyReadinessCommand,
  ExecutorReviewProposalApplyReadinessInput,
  ExecutorReviewProposalApplyReadinessPreview,
  ExecutorReviewProposalApplyReadinessRecord,
  ExecutorReviewProposalApplyReadinessStatus,
  ExecutorReviewProposalApplyReadinessSummary,
} from "./executor-review-proposal-apply-readiness-types"

const MAX_TEXT = 240
const MAX_ROWS = 12

export type ExecutorReviewProposalApplyReadinessServiceOptions = {
  eventStore: EventStore
  proposalRegistry: ProposalRegistry
  reviewRegistry: ReviewRegistry
  createService: ExecutorReviewProposalCreateService
  requestService: ExecutorReviewProposalReviewRequestService
  decisionService: ExecutorReviewProposalReviewDecisionService
  now?: () => Date
}

type Chain = {
  proposal: CommanderProposal | null
  review?: ReviewRequest | null
  createRecord?: ExecutorReviewProposalCreateRecord
  requestRecord?: ExecutorReviewProposalReviewRequestRecord
  decisionRecord?: ExecutorReviewProposalReviewDecisionRecord
}

export class ExecutorReviewProposalApplyReadinessService {
  private readonly now: () => Date

  constructor(private readonly options: ExecutorReviewProposalApplyReadinessServiceOptions) {
    this.now = options.now ?? (() => new Date())
  }

  async preview(input: ExecutorReviewProposalApplyReadinessInput): Promise<ExecutorReviewProposalApplyReadinessPreview> {
    const normalized = normalizeInput(input)
    if (!hasTarget(normalized)) return this.blockedNoTarget(normalized)
    return this.buildPreview(await this.resolveChain(normalized), normalized)
  }

  async summary(input: { limit?: number } = {}): Promise<ExecutorReviewProposalApplyReadinessSummary> {
    const previews = await this.candidatePreviews(limit(input.limit))
    return {
      total_considered: previews.length,
      ready_count: previews.filter((item) => item.status === "ready").length,
      blocked_count: previews.filter((item) => item.status === "blocked").length,
      needs_review_count: previews.filter((item) => item.status === "needs_review").length,
      rejected_count: previews.filter((item) => item.status === "rejected").length,
      generic_count: previews.filter((item) => item.candidate_kind === "generic" || item.candidate_kind === "manual_action").length,
      high_risk_count: previews.filter((item) => item.candidate_risk === "high").length,
      generated_at: this.now().toISOString(),
    }
  }

  async list(input: { limit?: number; status?: ExecutorReviewProposalApplyReadinessStatus; candidate_kind?: ExecutorReviewProposalApplyCandidateKind; proposal_id?: string } = {}): Promise<ExecutorReviewProposalApplyReadinessRecord[]> {
    return redactValue((await this.candidatePreviews())
      .filter((item) => !input.status || item.status === input.status)
      .filter((item) => !input.candidate_kind || item.candidate_kind === input.candidate_kind)
      .filter((item) => !input.proposal_id || item.proposal_id === input.proposal_id)
      .map(recordFromPreview)
      .slice(0, limit(input.limit)))
  }

  async get(readinessId: string): Promise<ExecutorReviewProposalApplyReadinessPreview | null> {
    const safeId = required(readinessId, "readiness_id")
    return (await this.candidatePreviews()).find((item) => item.readiness_id === safeId) ?? null
  }

  private async candidatePreviews(max?: number): Promise<ExecutorReviewProposalApplyReadinessPreview[]> {
    const proposals = await this.options.proposalRegistry.listAllProposals()
    const executorProposals = proposals.filter((proposal) => {
      const payload = isRecord(proposal.action_payload) ? proposal.action_payload : {}
      return payload.source === "executor_review_proposal_create"
    })
    const previews: ExecutorReviewProposalApplyReadinessPreview[] = []
    const candidates = typeof max === "number" ? executorProposals.slice(0, max) : executorProposals
    for (const proposal of candidates) {
      previews.push(await this.buildPreview(await this.resolveChain({ proposal_id: proposal.proposal_id }), { proposal_id: proposal.proposal_id }))
    }
    return previews.sort((left, right) => right.generated_at.localeCompare(left.generated_at))
  }

  private async resolveChain(input: ExecutorReviewProposalApplyReadinessInput): Promise<Chain> {
    const gateEvents = await this.gateEvents()
    const proposalId = input.proposal_id
      ?? this.proposalIdForReview(input.review_request_id, gateEvents)
      ?? this.proposalIdForDecision(input.decision_gate_id, gateEvents)
      ?? this.proposalIdForCreate(input.create_id, gateEvents)
    const proposal = proposalId ? await this.options.proposalRegistry.getProposal(proposalId) : null
    const reviewRequestId = input.review_request_id ?? proposal?.review_id
    const review = reviewRequestId ? await this.options.reviewRegistry.getReviewRequest(reviewRequestId) : null
    const requestRecord = reviewRequestId ? this.requestRecordFromGateEvents(gateEvents, { review_request_id: reviewRequestId }) : undefined
    const createRecord = input.create_id ? this.createRecordFromGateEvents(gateEvents, { create_id: input.create_id }) : proposalId ? this.createRecordFromGateEvents(gateEvents, { proposal_id: proposalId }) : undefined
    const decisionRecord = input.decision_gate_id ? this.decisionRecordFromGateEvents(gateEvents, { decision_gate_id: input.decision_gate_id }) : reviewRequestId ? this.decisionRecordFromGateEvents(gateEvents, { review_request_id: reviewRequestId }) : undefined
    return { proposal, review, createRecord, requestRecord, decisionRecord }
  }

  private async gateEvents(): Promise<JsonlEvent[]> {
    return (await this.options.eventStore.readAll()).filter((event) =>
      event.kind === "commander_executor_review_proposal_created"
      || event.kind === "commander_executor_review_proposal_review_requested"
      || event.kind === "commander_executor_review_proposal_review_approved"
      || event.kind === "commander_executor_review_proposal_review_rejected")
  }

  private createRecordFromGateEvents(events: JsonlEvent[], query: { create_id?: string; proposal_id?: string }): ExecutorReviewProposalCreateRecord | undefined {
    const event = events.slice().reverse().find((candidate) =>
      candidate.kind === "commander_executor_review_proposal_created"
      && (!query.create_id || candidate.create_id === query.create_id)
      && (!query.proposal_id || candidate.proposal_id === query.proposal_id))
    if (!event || typeof event.create_id !== "string" || typeof event.review_id !== "string" || typeof event.draft_id !== "string") return undefined
    return {
      create_id: event.create_id,
      status: "created",
      proposal_id: typeof event.proposal_id === "string" ? event.proposal_id : undefined,
      review_id: event.review_id,
      draft_id: event.draft_id,
      draft_kind: typeof event.draft_kind === "string" ? event.draft_kind : "other",
      created_at: typeof event.created_at === "string" ? event.created_at : "",
      summary_preview: typeof event.summary_preview === "string" ? event.summary_preview : typeof event.title_preview === "string" ? event.title_preview : event.draft_id,
      create_hash: typeof event.create_hash === "string" ? event.create_hash : "",
    }
  }

  private requestRecordFromGateEvents(events: JsonlEvent[], query: { review_request_id?: string; proposal_id?: string }): ExecutorReviewProposalReviewRequestRecord | undefined {
    const event = events.slice().reverse().find((candidate) =>
      candidate.kind === "commander_executor_review_proposal_review_requested"
      && (!query.review_request_id || candidate.review_request_id === query.review_request_id)
      && (!query.proposal_id || candidate.proposal_id === query.proposal_id))
    if (!event || typeof event.request_gate_id !== "string" || typeof event.proposal_id !== "string") return undefined
    return {
      request_gate_id: event.request_gate_id,
      status: "requested",
      review_request_id: typeof event.review_request_id === "string" ? event.review_request_id : undefined,
      proposal_id: event.proposal_id,
      create_id: typeof event.create_id === "string" ? event.create_id : undefined,
      review_id: typeof event.review_id === "string" ? event.review_id : undefined,
      draft_id: typeof event.draft_id === "string" ? event.draft_id : undefined,
      requested_at: typeof event.requested_at === "string" ? event.requested_at : "",
      summary_preview: typeof event.summary_preview === "string" ? event.summary_preview : event.proposal_id,
      request_hash: typeof event.request_hash === "string" ? event.request_hash : "",
    }
  }

  private decisionRecordFromGateEvents(events: JsonlEvent[], query: { decision_gate_id?: string; review_request_id?: string; proposal_id?: string }): ExecutorReviewProposalReviewDecisionRecord | undefined {
    const event = events.slice().reverse().find((candidate) =>
      (candidate.kind === "commander_executor_review_proposal_review_approved" || candidate.kind === "commander_executor_review_proposal_review_rejected")
      && (!query.decision_gate_id || candidate.decision_gate_id === query.decision_gate_id)
      && (!query.review_request_id || candidate.review_request_id === query.review_request_id)
      && (!query.proposal_id || candidate.proposal_id === query.proposal_id))
    if (!event || typeof event.decision_gate_id !== "string" || typeof event.review_request_id !== "string") return undefined
    const approved = event.kind === "commander_executor_review_proposal_review_approved"
    return {
      decision_gate_id: event.decision_gate_id,
      status: approved ? "approved" : "rejected",
      decision: approved ? "approve" : "reject",
      review_request_id: event.review_request_id,
      proposal_id: typeof event.proposal_id === "string" ? event.proposal_id : undefined,
      request_gate_id: typeof event.request_gate_id === "string" ? event.request_gate_id : undefined,
      create_id: typeof event.create_id === "string" ? event.create_id : undefined,
      decided_at: typeof event.decided_at === "string" ? event.decided_at : "",
      summary_preview: typeof event.reason_preview === "string" ? event.reason_preview : event.review_request_id,
      decision_hash: typeof event.decision_hash === "string" ? event.decision_hash : "",
    }
  }

  private proposalIdForReview(reviewRequestId: string | undefined, events: JsonlEvent[]): string | undefined {
    if (!reviewRequestId) return undefined
    return this.requestRecordFromGateEvents(events, { review_request_id: reviewRequestId })?.proposal_id
  }

  private proposalIdForDecision(decisionGateId: string | undefined, events: JsonlEvent[]): string | undefined {
    if (!decisionGateId) return undefined
    return this.decisionRecordFromGateEvents(events, { decision_gate_id: decisionGateId })?.proposal_id
  }

  private proposalIdForCreate(createId: string | undefined, events: JsonlEvent[]): string | undefined {
    if (!createId) return undefined
    return this.createRecordFromGateEvents(events, { create_id: createId })?.proposal_id
  }

  private buildPreview(chain: Chain, input: ExecutorReviewProposalApplyReadinessInput): ExecutorReviewProposalApplyReadinessPreview {
    const generatedAt = this.now().toISOString()
    const proposal = chain.proposal
    const payload = isRecord(proposal?.action_payload) ? proposal.action_payload : {}
    const blockers: string[] = []
    const warnings = ["apply readiness does not apply proposals, mutate missions, call providers, launch OpenCode, or execute scheduler/wake/continuation/recovery writes"]
    if (!proposal) blockers.push("proposal was not found")
    if (proposal && payload.source !== "executor_review_proposal_create") blockers.push("proposal was not created by executor-review proposal creation gate")
    if (proposal && (!optional(payload.review_id) || !optional(payload.draft_id))) blockers.push("executor-review proposal source metadata is incomplete")
    if (proposal && !chain.createRecord) blockers.push("executor-review proposal creation gate record was not found")
    if (proposal && ["cancelled", "applied"].includes(proposal.status)) blockers.push(`proposal status ${proposal.status} cannot be apply-ready`)
    if (chain.review?.status === "cancelled") blockers.push("review request is cancelled")
    if (input.create_id && (!chain.createRecord || chain.createRecord.proposal_id !== proposal?.proposal_id)) blockers.push("create_id does not match the proposal source create record")
    if (input.review_request_id && proposal && input.proposal_id && input.review_request_id !== proposal.review_id) blockers.push("review_request_id does not match linked proposal review")
    if (input.decision_gate_id && (!chain.decisionRecord || chain.decisionRecord.proposal_id !== proposal?.proposal_id)) blockers.push("decision_gate_id does not match linked proposal review decision")
    if (proposal && proposal.review_id && !chain.review) blockers.push("linked review request was not found")
    if (proposal && proposal.review_id && !chain.requestRecord) blockers.push("executor-review proposal review-request gate record was not found")
    if (chain.review && (chain.review.status === "approved" || chain.review.status === "rejected") && !chain.decisionRecord) blockers.push("executor-review proposal review decision gate record was not found")
    if (proposal && chain.requestRecord && chain.requestRecord.proposal_id !== proposal.proposal_id) blockers.push("review-request gate linkage is inconsistent")
    if (proposal && chain.decisionRecord && chain.decisionRecord.proposal_id && chain.decisionRecord.proposal_id !== proposal.proposal_id) blockers.push("review-decision gate linkage is inconsistent")
    const evidenceIds = boundList(payload.evidence_ids)
    const findingIds = boundList(payload.finding_ids)
    if (proposal && evidenceIds.length === 0 && findingIds.length === 0) blockers.push("executor-review proposal source evidence metadata is incomplete")
    const candidateKind = classifyCandidate(proposal)
    const candidateRisk = classifyRisk(candidateKind, optional(payload.risk))
    if (proposal?.action_kind === "opencode_handoff") blockers.push("opencode_handoff proposals require the dedicated handoff command")
    if (candidateKind === "unsupported") blockers.push("proposal candidate kind is unsupported for future apply")

    let status: ExecutorReviewProposalApplyReadinessStatus
    if (blockers.length > 0) status = "blocked"
    else if (chain.review?.status === "rejected" || proposal?.status === "rejected" || chain.decisionRecord?.status === "rejected") status = "rejected"
    else if (!chain.requestRecord || !chain.review || chain.review.status === "pending" || !chain.decisionRecord) status = "needs_review"
    else if (chain.review.status === "approved" && chain.decisionRecord.status === "approved" && proposal?.status === "approved") status = "ready"
    else status = "needs_review"

    const canApplyInFuture = status === "ready"
    return redactValue({
      readiness_id: readinessIdFor(proposal?.proposal_id ?? input.proposal_id ?? input.review_request_id ?? input.decision_gate_id ?? input.create_id ?? "unknown", chain.decisionRecord?.decision_gate_id, chain.createRecord?.create_id),
      status,
      can_apply_in_future: canApplyInFuture,
      proposal_id: bound(proposal?.proposal_id ?? input.proposal_id ?? "unknown"),
      review_request_id: chain.review?.review_id ?? chain.requestRecord?.review_request_id ?? proposal?.review_id,
      request_gate_id: chain.requestRecord?.request_gate_id,
      decision_gate_id: chain.decisionRecord?.decision_gate_id,
      create_id: chain.createRecord?.create_id,
      source_executor_review_id: optional(payload.review_id) ?? chain.createRecord?.review_id,
      source_draft_id: optional(payload.draft_id) ?? chain.createRecord?.draft_id,
      source_packet_id: optional(payload.source_packet_id),
      proposal_status: proposal?.status,
      review_request_status: chain.review?.status,
      review_decision: chain.decisionRecord?.decision,
      proposal_title_preview: bound(proposal?.title ?? ""),
      proposal_summary_preview: bound(proposal?.summary ?? ""),
      action_kind: proposal?.action_kind,
      candidate_kind: candidateKind,
      candidate_risk: candidateRisk,
      mission_id: proposal?.mission_id ?? optional(payload.target_mission_id),
      result_id: proposal?.result_id ?? optional(payload.target_result_id),
      source_evidence_ids: evidenceIds,
      source_finding_ids: findingIds,
      source_confidence: numberOptional(payload.source_confidence),
      blockers: boundList(blockers),
      warnings: boundList(warnings),
      recommended_commands: recommendedCommands(proposal?.proposal_id ?? input.proposal_id, chain.review?.review_id ?? chain.requestRecord?.review_request_id, chain.decisionRecord?.decision_gate_id, chain.createRecord?.create_id, optional(payload.review_id)),
      generated_at: generatedAt,
      redacted_summary_preview: canApplyInFuture ? `Proposal ${proposal?.proposal_id} is ready for future apply inspection.` : blockers[0] ?? statusSummary(status),
    })
  }

  private blockedNoTarget(input: ExecutorReviewProposalApplyReadinessInput): ExecutorReviewProposalApplyReadinessPreview {
    const generatedAt = this.now().toISOString()
    return redactValue({
      readiness_id: readinessIdFor("no-target", undefined, undefined),
      status: "unknown",
      can_apply_in_future: false,
      proposal_id: "unknown",
      proposal_title_preview: "",
      proposal_summary_preview: "",
      candidate_kind: "generic",
      candidate_risk: "medium",
      source_evidence_ids: [],
      source_finding_ids: [],
      blockers: ["apply readiness preview requires proposal_id, review_request_id, decision_gate_id, or create_id"],
      warnings: ["apply readiness does not select an implicit latest future apply target"],
      recommended_commands: recommendedCommands(input.proposal_id),
      generated_at: generatedAt,
      redacted_summary_preview: "Apply readiness preview requires an explicit target.",
    })
  }
}

export function readExecutorReviewProposalApplyReadinessInput(value: unknown): ExecutorReviewProposalApplyReadinessInput {
  if (!isRecord(value)) return {}
  return normalizeInput(value)
}

function normalizeInput(input: Record<string, unknown>): ExecutorReviewProposalApplyReadinessInput {
  return {
    proposal_id: optional(input.proposal_id ?? input.proposalId ?? input.proposal),
    review_request_id: optional(input.review_request_id ?? input.reviewRequestId ?? input.review_id ?? input.reviewId ?? input.review),
    decision_gate_id: optional(input.decision_gate_id ?? input.decisionGateId ?? input.decision),
    create_id: optional(input.create_id ?? input.createId ?? input.create),
    include_authority: input.include_authority === false || input.includeAuthority === false ? false : undefined,
    limit: typeof input.limit === "number" ? input.limit : undefined,
  }
}

function hasTarget(input: ExecutorReviewProposalApplyReadinessInput): boolean {
  return Boolean(input.proposal_id || input.review_request_id || input.decision_gate_id || input.create_id)
}

function classifyCandidate(proposal: CommanderProposal | null): ExecutorReviewProposalApplyCandidateKind {
  if (!proposal) return "generic"
  const payload = isRecord(proposal.action_payload) ? proposal.action_payload : {}
  if (proposal.action_kind === "record_progress") return "mission_progress"
  if (proposal.action_kind === "submit_result") return "mission_result"
  if (proposal.action_kind === "operator_checkpoint") return "checkpoint"
  if (proposal.action_kind !== "other") return "manual_action"
  const draftKind = optional(payload.draft_kind)
  if (draftKind === "mission_result") return "mission_result"
  if (draftKind === "mission_progress") return "mission_progress"
  if (draftKind === "followup_task") return "followup_task"
  if (draftKind === "human_review") return "human_review"
  if (draftKind === "checkpoint") return "checkpoint"
  if (draftKind === "blocked_followup") return "blocked_followup"
  return "generic"
}

function classifyRisk(kind: ExecutorReviewProposalApplyCandidateKind, sourceRisk?: string): "low" | "medium" | "high" {
  if (kind === "unsupported") return "high"
  if (kind === "mission_result") return "high"
  if (sourceRisk === "high") return "high"
  if (sourceRisk === "low") return "low"
  return "medium"
}

function recordFromPreview(preview: ExecutorReviewProposalApplyReadinessPreview): ExecutorReviewProposalApplyReadinessRecord {
  return {
    readiness_id: preview.readiness_id,
    status: preview.status,
    proposal_id: preview.proposal_id,
    review_request_id: preview.review_request_id,
    decision_gate_id: preview.decision_gate_id,
    create_id: preview.create_id,
    candidate_kind: preview.candidate_kind,
    candidate_risk: preview.candidate_risk,
    generated_at: preview.generated_at,
    summary_preview: bound(preview.redacted_summary_preview || preview.proposal_summary_preview),
  }
}

function recommendedCommands(proposalId?: string, reviewRequestId?: string, decisionGateId?: string, createId?: string, sourceReviewId?: string): ExecutorReviewProposalApplyReadinessCommand[] {
  const commands: ExecutorReviewProposalApplyReadinessCommand[] = [
    { label: "List readiness", command: "/executor-review-proposal-apply-readiness-list", command_type: "read" },
    { label: "Show authority", command: "/authority-show /executor-review-proposal-apply-readiness", command_type: "read" },
  ]
  if (proposalId) commands.unshift({ label: "Show proposal", command: `/proposal ${proposalId}`, command_type: "read" })
  if (reviewRequestId) commands.push({ label: "Show review", command: `/review ${reviewRequestId}`, command_type: "read" })
  if (decisionGateId) commands.push({ label: "Show review decision", command: `/executor-review-proposal-review-decision-show ${decisionGateId}`, command_type: "read" })
  if (createId) commands.push({ label: "Show proposal create", command: `/executor-review-proposal-create-show ${createId}`, command_type: "read" })
  if (sourceReviewId) commands.push({ label: "Show executor review", command: `/executor-review-show ${sourceReviewId}`, command_type: "read" })
  return commands.map(readCommand).slice(0, MAX_ROWS)
}

function readCommand(value: unknown): ExecutorReviewProposalApplyReadinessCommand {
  const record = isRecord(value) ? value : {}
  return {
    label: bound(String(record.label ?? "Inspect")),
    command: bound(String(record.command ?? "/executor-review-proposal-apply-readiness-list")),
    command_type: record.command_type === "write" ? "write" : "read",
    requires_active_runtime: record.requires_active_runtime === true,
    notes: optional(record.notes),
  }
}

function statusSummary(status: ExecutorReviewProposalApplyReadinessStatus): string {
  if (status === "ready") return "Proposal is ready for future apply inspection."
  if (status === "needs_review") return "Proposal still needs an 8I review request and 8J approved decision."
  if (status === "rejected") return "Proposal review decision is rejected."
  if (status === "blocked") return "Proposal apply readiness is blocked."
  return "Apply readiness target is unknown."
}

function readinessIdFor(proposalId: string, decisionGateId?: string, createId?: string): string {
  return `executor_review_proposal_apply_readiness_${sha256(JSON.stringify({ proposalId, decisionGateId, createId })).slice(0, 16)}`
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

function bound(value: string, max = MAX_TEXT): string {
  return redactText(value).replace(/\s+/g, " ").trim().slice(0, max)
}

function boundList(value: unknown, max = MAX_ROWS): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => bound(item)).filter(Boolean).slice(0, max) : []
}

function limit(value: unknown): number {
  return Math.max(1, Math.min(typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 20, 100))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
