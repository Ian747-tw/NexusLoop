import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import type { CommanderProposal } from "../missions/proposal-types"
import type { ProposalRegistry } from "../missions/proposal-registry"
import type { ReviewRegistry } from "../missions/review-registry"
import { redactText, redactValue } from "../security/redaction"
import type { ExecutorReviewProposalCreateService } from "./executor-review-proposal-create-service"
import type {
  ExecutorReviewProposalReviewRequestCommand,
  ExecutorReviewProposalReviewRequestInput,
  ExecutorReviewProposalReviewRequestPreview,
  ExecutorReviewProposalReviewRequestPreviewInput,
  ExecutorReviewProposalReviewRequestRecord,
  ExecutorReviewProposalReviewRequestResult,
} from "./executor-review-proposal-review-request-types"

const MAX_TEXT = 240
const MAX_ROWS = 12

export type ExecutorReviewProposalReviewRequestServiceOptions = {
  eventStore: EventStore
  proposalRegistry: ProposalRegistry
  reviewRegistry: ReviewRegistry
  createService: ExecutorReviewProposalCreateService
  now?: () => Date
}

export class ExecutorReviewProposalReviewRequestService {
  private readonly now: () => Date
  private requestQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: ExecutorReviewProposalReviewRequestServiceOptions) {
    this.now = options.now ?? (() => new Date())
  }

  async preview(input: ExecutorReviewProposalReviewRequestPreviewInput): Promise<ExecutorReviewProposalReviewRequestPreview> {
    return this.buildPreview(normalizePreviewInput(input))
  }

  async request(input: ExecutorReviewProposalReviewRequestInput): Promise<ExecutorReviewProposalReviewRequestResult> {
    const normalized = normalizeRequestInput(input)
    if (normalized.dry_run === true) {
      const preview = await this.buildPreview(normalized)
      const requestedAt = this.now().toISOString()
      const requestHash = requestHashFor(preview)
      return redactValue(resultFromPreview(preview, {
        request_gate_id: requestGateId(requestHash),
        status: preview.can_request ? "dry_run" : "blocked",
        review_request_id: preview.existing_review_request_id,
        requested_at: requestedAt,
        requested_by: normalized.requested_by ?? "operator",
        error: preview.can_request ? undefined : preview.blockers[0] ?? "executor-review proposal review request is blocked",
        request_hash: requestHash,
      }))
    }
    return this.serializeRequest(() => this.requestNonDry(normalized))
  }

  private async requestNonDry(normalized: ExecutorReviewProposalReviewRequestInput): Promise<ExecutorReviewProposalReviewRequestResult> {
    const preview = await this.buildPreview(normalized)
    const requestedAt = this.now().toISOString()
    const requestHash = requestHashFor(preview)
    const gateId = requestGateId(requestHash)
    if (preview.existing_review_request_id) {
      const recovered = await this.resultFromLinkedProposal(preview.proposal_id)
      if (recovered) return redactValue(recovered)
      return redactValue(resultFromPreview(preview, {
        request_gate_id: gateId,
        status: "blocked",
        review_request_id: preview.existing_review_request_id,
        requested_at: requestedAt,
        requested_by: normalized.requested_by ?? "operator",
        request_hash: requestHash,
        error: "review request already exists for this executor-review proposal",
      }))
    }
    if (!preview.can_request) {
      const result = resultFromPreview(preview, {
        request_gate_id: gateId,
        status: "blocked",
        requested_at: requestedAt,
        requested_by: normalized.requested_by ?? "operator",
        request_hash: requestHash,
        error: preview.blockers[0] ?? "executor-review proposal review request is blocked",
      })
      await this.append("commander_executor_review_proposal_review_request_blocked", result)
      return redactValue(result)
    }
    try {
      const proposal = await this.options.proposalRegistry.requestReview(preview.proposal_id, {
        requested_by: normalized.requested_by ?? "operator",
      })
      const result = resultFromPreview(preview, {
        request_gate_id: gateId,
        status: "requested",
        review_request_id: proposal.review_id,
        requested_at: requestedAt,
        requested_by: normalized.requested_by ?? "operator",
        request_hash: requestHash,
      })
      await this.append("commander_executor_review_proposal_review_requested", result)
      return redactValue(result)
    } catch (error) {
      const result = resultFromPreview(preview, {
        request_gate_id: gateId,
        status: "failed",
        requested_at: requestedAt,
        requested_by: normalized.requested_by ?? "operator",
        request_hash: requestHash,
        error: bound(error instanceof Error ? error.message : String(error)),
      })
      await this.append("commander_executor_review_proposal_review_request_failed", result)
      return redactValue(result)
    }
  }

  private async serializeRequest<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.requestQueue
    let release!: () => void
    this.requestQueue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  async list(input: { limit?: number; proposal_id?: string; review_request_id?: string; create_id?: string } = {}): Promise<ExecutorReviewProposalReviewRequestRecord[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100))
    const results = await this.requestResults()
    return redactValue(results
      .filter((result) => !input.proposal_id || result.proposal_id === input.proposal_id)
      .filter((result) => !input.review_request_id || result.review_request_id === input.review_request_id)
      .filter((result) => !input.create_id || result.create_id === input.create_id)
      .sort((left, right) => left.requested_at.localeCompare(right.requested_at))
      .reverse()
      .map(recordFromResult)
      .slice(0, limit))
  }

  async get(requestGateId: string): Promise<ExecutorReviewProposalReviewRequestResult | null> {
    const safeId = required(requestGateId, "request_gate_id")
    const result = (await this.requestResults()).reverse().find((item) => item.request_gate_id === safeId)
    return result ? redactValue(result) : null
  }

  private async buildPreview(input: ExecutorReviewProposalReviewRequestPreviewInput): Promise<ExecutorReviewProposalReviewRequestPreview> {
    const generatedAt = this.now().toISOString()
    const proposal = await this.options.proposalRegistry.getProposal(input.proposal_id)
    const payload = isRecord(proposal?.action_payload) ? proposal.action_payload : {}
    const createId = createIdForProposal(proposal)
    const linkedReview = proposal?.review_id ? await this.options.reviewRegistry.getReviewRequest(proposal.review_id) : null
    const blockers: string[] = []
    if (!proposal) blockers.push("proposal_id was not found")
    if (proposal && payload.source !== "executor_review_proposal_create") blockers.push("proposal was not created by executor-review proposal creation gate")
    if (proposal && (!optional(payload.review_id) || !optional(payload.draft_id))) blockers.push("executor-review proposal source metadata is incomplete")
    if (proposal && ["cancelled", "applied", "rejected"].includes(proposal.status)) blockers.push(`proposal status ${proposal.status} cannot request review`)
    if (input.create_id && createId && input.create_id !== createId) blockers.push("create_id does not match the proposal source create record")
    if (input.create_id && !createId) blockers.push("proposal source create record is unavailable")
    if (input.create_id && createId === input.create_id) {
      const createRecord = await this.options.createService.get(input.create_id)
      if (!createRecord || createRecord.proposal_id !== input.proposal_id) blockers.push("create_id does not match an active executor-review proposal create record")
    }
    if (proposal?.review_id) blockers.push("review request already exists for this executor-review proposal")
    const reviewId = optional(payload.review_id)
    const draftId = optional(payload.draft_id)
    const sourcePacketId = optional(payload.source_packet_id)
    const canRequest = blockers.length === 0
    const warnings = ["review request creation does not approve, reject, apply changes, mutate missions, call providers, or launch OpenCode"]
    return redactValue({
      preview_id: `executor_review_proposal_review_request_preview_${sha256(`${input.proposal_id}:${input.create_id ?? ""}:${generatedAt}`).slice(0, 16)}`,
      status: canRequest ? "ready" : "blocked",
      can_request: canRequest,
      proposal_id: bound(input.proposal_id),
      create_id: createId,
      review_id: reviewId,
      draft_id: draftId,
      source_packet_id: sourcePacketId,
      proposal_status: proposal?.status,
      proposal_title_preview: bound(proposal?.title ?? ""),
      proposal_summary_preview: bound(proposal?.summary ?? ""),
      action_kind: proposal?.action_kind,
      mission_id: proposal?.mission_id ?? optional(payload.target_mission_id),
      result_id: proposal?.result_id ?? optional(payload.target_result_id),
      source_evidence_ids: boundList(payload.evidence_ids),
      source_finding_ids: boundList(payload.finding_ids),
      source_confidence: numberOptional(payload.source_confidence),
      risk: optional(payload.risk),
      existing_review_request_id: proposal?.review_id,
      existing_review_request_status: linkedReview?.status,
      blockers: boundList(blockers),
      warnings: boundList(warnings),
      recommended_commands: recommendedCommands(input.proposal_id, createId, proposal?.review_id),
      generated_at: generatedAt,
      redacted_summary_preview: canRequest ? `Proposal ${input.proposal_id} can request one review.` : blockers[0] ?? "Review request is blocked.",
    })
  }

  private async requestEvents(): Promise<JsonlEvent[]> {
    return (await this.options.eventStore.readAll()).filter((event) =>
      event.kind === "commander_executor_review_proposal_review_requested"
      || event.kind === "commander_executor_review_proposal_review_request_blocked"
      || event.kind === "commander_executor_review_proposal_review_request_failed")
  }

  private async requestResults(): Promise<ExecutorReviewProposalReviewRequestResult[]> {
    let results = (await this.requestEvents()).map(resultFromEvent)
    for (const proposal of await this.options.proposalRegistry.listAllProposals()) {
      const recovered = await this.resultFromLinkedProposal(proposal.proposal_id)
      if (!recovered) continue
      const matches = (result: ExecutorReviewProposalReviewRequestResult) =>
        result.request_gate_id === recovered.request_gate_id
        || (result.proposal_id === recovered.proposal_id && result.review_request_id === recovered.review_request_id)
      if (results.some((result) => result.status === "requested" && matches(result))) continue
      results = results.filter((result) => !matches(result))
      results.push(recovered)
    }
    return results
  }

  private async resultFromLinkedProposal(proposalId: string): Promise<ExecutorReviewProposalReviewRequestResult | undefined> {
    const proposal = await this.options.proposalRegistry.getProposal(proposalId)
    if (!proposal?.review_id) return undefined
    const payload = isRecord(proposal.action_payload) ? proposal.action_payload : {}
    if (payload.source !== "executor_review_proposal_create") return undefined
    const reviewId = optional(payload.review_id)
    const draftId = optional(payload.draft_id)
    if (!reviewId || !draftId) return undefined
    const createId = createIdForProposal(proposal)
    const linkedReview = await this.options.reviewRegistry.getReviewRequest(proposal.review_id)
    const preview: ExecutorReviewProposalReviewRequestPreview = {
      preview_id: "recovered",
      status: "blocked",
      can_request: false,
      proposal_id: proposal.proposal_id,
      create_id: createId,
      review_id: reviewId,
      draft_id: draftId,
      source_packet_id: optional(payload.source_packet_id),
      proposal_status: proposal.status,
      proposal_title_preview: bound(proposal.title),
      proposal_summary_preview: bound(proposal.summary),
      action_kind: proposal.action_kind,
      mission_id: proposal.mission_id ?? optional(payload.target_mission_id),
      result_id: proposal.result_id ?? optional(payload.target_result_id),
      source_evidence_ids: boundList(payload.evidence_ids),
      source_finding_ids: boundList(payload.finding_ids),
      source_confidence: numberOptional(payload.source_confidence),
      risk: optional(payload.risk),
      existing_review_request_id: proposal.review_id,
      existing_review_request_status: linkedReview?.status,
      blockers: ["review request already exists for this executor-review proposal"],
      warnings: [],
      recommended_commands: recommendedCommands(proposal.proposal_id, createId, proposal.review_id),
      generated_at: proposal.updated_at,
      redacted_summary_preview: "Review request already exists for this executor-review proposal.",
    }
    const requestHash = requestHashFor(preview)
    return resultFromPreview(preview, {
      request_gate_id: requestGateId(requestHash),
      status: "requested",
      review_request_id: proposal.review_id,
      requested_at: linkedReview?.created_at ?? proposal.updated_at,
      requested_by: linkedReview?.requested_by ?? proposal.proposed_by ?? "operator",
      request_hash: requestHash,
    })
  }

  private async append(kind: string, result: ExecutorReviewProposalReviewRequestResult): Promise<void> {
    await this.options.eventStore.append({ kind, ...redactValue(result) } as JsonlEvent)
  }
}

export function readExecutorReviewProposalReviewRequestPreviewInput(value: unknown): ExecutorReviewProposalReviewRequestPreviewInput {
  if (!isRecord(value)) throw new Error("executor review proposal review request requires proposal_id")
  return normalizePreviewInput(value)
}

export function readExecutorReviewProposalReviewRequestInput(value: unknown): ExecutorReviewProposalReviewRequestInput {
  if (!isRecord(value)) throw new Error("executor review proposal review request requires proposal_id")
  return normalizeRequestInput(value)
}

function normalizePreviewInput(input: Record<string, unknown>): ExecutorReviewProposalReviewRequestPreviewInput {
  return {
    proposal_id: required(input.proposal_id ?? input.proposalId, "proposal_id"),
    create_id: optional(input.create_id ?? input.createId),
    include_authority: input.include_authority === false || input.includeAuthority === false ? false : undefined,
  }
}

function normalizeRequestInput(input: Record<string, unknown>): ExecutorReviewProposalReviewRequestInput {
  return {
    ...normalizePreviewInput(input),
    requested_by: optional(input.requested_by ?? input.requestedBy) ?? "operator",
    dry_run: input.dry_run === true || input.dryRun === true,
  }
}

function resultFromPreview(preview: ExecutorReviewProposalReviewRequestPreview, input: {
  request_gate_id: string
  status: ExecutorReviewProposalReviewRequestResult["status"]
  review_request_id?: string
  requested_at: string
  requested_by: string
  error?: string
  request_hash: string
}): ExecutorReviewProposalReviewRequestResult {
  return {
    request_gate_id: input.request_gate_id,
    status: input.status,
    review_request_id: input.review_request_id,
    proposal_id: preview.proposal_id,
    create_id: preview.create_id,
    review_id: preview.review_id,
    draft_id: preview.draft_id,
    source_packet_id: preview.source_packet_id,
    mission_id: preview.mission_id,
    result_id: preview.result_id,
    requested_at: input.requested_at,
    requested_by: input.requested_by,
    error: input.error,
    request_hash: input.request_hash,
    recommended_commands: preview.recommended_commands,
  }
}

function recordFromResult(result: ExecutorReviewProposalReviewRequestResult): ExecutorReviewProposalReviewRequestRecord {
  return {
    request_gate_id: result.request_gate_id,
    status: result.status,
    review_request_id: result.review_request_id,
    proposal_id: result.proposal_id,
    create_id: result.create_id,
    review_id: result.review_id,
    draft_id: result.draft_id,
    requested_at: result.requested_at,
    summary_preview: bound(result.error ?? result.proposal_id),
    request_hash: result.request_hash,
  }
}

function resultFromEvent(event: JsonlEvent): ExecutorReviewProposalReviewRequestResult {
  return {
    request_gate_id: String(event.request_gate_id ?? ""),
    status: event.status === "requested" || event.status === "blocked" || event.status === "failed" || event.status === "dry_run" ? event.status : "blocked",
    review_request_id: optional(event.review_request_id),
    proposal_id: String(event.proposal_id ?? ""),
    create_id: optional(event.create_id),
    review_id: optional(event.review_id),
    draft_id: optional(event.draft_id),
    source_packet_id: optional(event.source_packet_id),
    mission_id: optional(event.mission_id),
    result_id: optional(event.result_id),
    requested_at: String(event.requested_at ?? event.timestamp ?? ""),
    requested_by: String(event.requested_by ?? "operator"),
    error: optional(event.error),
    request_hash: String(event.request_hash ?? ""),
    recommended_commands: Array.isArray(event.recommended_commands) ? event.recommended_commands.map(readCommand).slice(0, MAX_ROWS) : [],
  }
}

function createIdForProposal(proposal: CommanderProposal | null | undefined): string | undefined {
  const payload = isRecord(proposal?.action_payload) ? proposal.action_payload : {}
  const createHash = optional(payload.create_hash)
  return createHash ? `executor_review_proposal_create_${createHash.slice(0, 16)}` : undefined
}

function requestHashFor(preview: ExecutorReviewProposalReviewRequestPreview): string {
  return sha256(JSON.stringify({
    proposal_id: preview.proposal_id,
    create_id: preview.create_id,
    review_id: preview.review_id,
    draft_id: preview.draft_id,
    source_packet_id: preview.source_packet_id,
    mission_id: preview.mission_id,
    result_id: preview.result_id,
    source_evidence_ids: preview.source_evidence_ids,
    source_finding_ids: preview.source_finding_ids,
    risk: preview.risk,
  }))
}

function requestGateId(requestHash: string): string {
  return `executor_review_proposal_review_request_${requestHash.slice(0, 16)}`
}

function recommendedCommands(proposalId: string, createId?: string, reviewRequestId?: string): ExecutorReviewProposalReviewRequestCommand[] {
  const commands: ExecutorReviewProposalReviewRequestCommand[] = [
    { label: "Show proposal", command: `/proposal ${proposalId}`, command_type: "read" },
    { label: "Preview review request", command: `/executor-review-proposal-review-preview proposal=${proposalId}${createId ? ` create=${createId}` : ""}`, command_type: "read" },
    { label: "Dry-run review request", command: `/executor-review-proposal-review-dry-run proposal=${proposalId}${createId ? ` create=${createId}` : ""}`, command_type: "read" },
    { label: "List review requests", command: "/executor-review-proposal-review-requests", command_type: "read" },
    { label: "Show authority", command: "/authority-show /executor-review-proposal-review-request", command_type: "read" },
  ]
  if (createId) commands.push({ label: "Show proposal create", command: `/executor-review-proposal-create-show ${createId}`, command_type: "read" })
  if (reviewRequestId) commands.push({ label: "Show review request", command: `/review ${reviewRequestId}`, command_type: "read" })
  return commands.map(readCommand).slice(0, MAX_ROWS)
}

function readCommand(value: unknown): ExecutorReviewProposalReviewRequestCommand {
  const record = isRecord(value) ? value : {}
  return {
    label: bound(String(record.label ?? "Inspect")),
    command: bound(String(record.command ?? "/executor-review-proposal-review-requests")),
    command_type: record.command_type === "write" ? "write" : "read",
    requires_active_runtime: record.requires_active_runtime === true,
    notes: optional(record.notes),
  }
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
