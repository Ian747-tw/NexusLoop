import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import type { CommanderProposal } from "../missions/proposal-types"
import type { ProposalRegistry } from "../missions/proposal-registry"
import { redactText, redactValue } from "../security/redaction"
import type { ExecutorReviewProposalDraftCandidate } from "./executor-review-proposal-draft-types"
import type { ExecutorReviewProposalDraftService } from "./executor-review-proposal-draft-service"
import type {
  ExecutorReviewProposalCreateCommand,
  ExecutorReviewProposalCreateInput,
  ExecutorReviewProposalCreatePreview,
  ExecutorReviewProposalCreatePreviewInput,
  ExecutorReviewProposalCreateRecord,
  ExecutorReviewProposalCreateResult,
} from "./executor-review-proposal-create-types"

const MAX_TEXT = 240
const MAX_ROWS = 12

export type ExecutorReviewProposalCreateServiceOptions = {
  eventStore: EventStore
  draftService: ExecutorReviewProposalDraftService
  proposalRegistry: ProposalRegistry
  now?: () => Date
}

export class ExecutorReviewProposalCreateService {
  private readonly now: () => Date
  private createQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: ExecutorReviewProposalCreateServiceOptions) {
    this.now = options.now ?? (() => new Date())
  }

  async preview(input: ExecutorReviewProposalCreatePreviewInput): Promise<ExecutorReviewProposalCreatePreview> {
    const normalized = normalizePreviewInput(input)
    return this.buildPreview(normalized)
  }

  async create(input: ExecutorReviewProposalCreateInput): Promise<ExecutorReviewProposalCreateResult> {
    const normalized = normalizeCreateInput(input)
    if (normalized.dry_run === true) {
      const preview = await this.buildPreview(normalized)
      const createdAt = this.now().toISOString()
      const createHash = createHashFor(preview)
      const createId = `executor_review_proposal_create_${createHash.slice(0, 16)}`
      return redactValue(resultFromPreview(preview, {
        create_id: createId,
        status: "dry_run",
        created_at: createdAt,
        requested_by: normalized.requested_by ?? "operator",
        create_hash: createHash,
      }))
    }
    return this.serializeCreate(() => this.createNonDry(normalized))
  }

  private async createNonDry(normalized: ExecutorReviewProposalCreateInput): Promise<ExecutorReviewProposalCreateResult> {
    const preview = await this.buildPreview(normalized)
    const createdAt = this.now().toISOString()
    const createHash = createHashFor(preview)
    const createId = `executor_review_proposal_create_${createHash.slice(0, 16)}`
    if (preview.existing_proposal_id) {
      const existingEvent = (await this.createEvents()).reverse().find((event) =>
        event.kind === "commander_executor_review_proposal_created"
        && event.review_id === preview.review_id
        && event.draft_id === preview.draft_id
        && event.proposal_id === preview.existing_proposal_id)
      if (existingEvent) return redactValue(resultFromEvent(existingEvent))
      return redactValue(resultFromPreview(preview, {
        create_id: createId,
        status: "blocked",
        proposal_id: preview.existing_proposal_id,
        created_at: createdAt,
        requested_by: normalized.requested_by ?? "operator",
        create_hash: createHash,
        error: "proposal already exists for this executor review draft",
      }))
    }
    if (!preview.can_create) {
      const result = resultFromPreview(preview, {
        create_id: createId,
        status: "blocked",
        proposal_id: preview.existing_proposal_id,
        created_at: createdAt,
        requested_by: normalized.requested_by ?? "operator",
        create_hash: createHash,
        error: preview.blockers[0] ?? "executor review proposal creation is blocked",
      })
      await this.append("commander_executor_review_proposal_create_blocked", result)
      return redactValue(result)
    }
    try {
      const proposal = await this.options.proposalRegistry.createProposal({
        mission_id: preview.target_mission_id,
        result_id: preview.target_result_id,
        action_kind: "other",
        title: preview.title_preview,
        summary: preview.summary_preview,
        proposed_by: normalized.requested_by ?? "operator",
        action_payload: {
          source: "executor_review_proposal_create",
          review_id: preview.review_id,
          draft_id: preview.draft_id,
          source_packet_id: preview.source_packet_id,
          draft_kind: preview.draft_kind,
          proposed_action_kind: preview.proposed_action_kind,
          target_mission_id: preview.target_mission_id,
          target_result_id: preview.target_result_id,
          target_handoff_id: preview.target_handoff_id,
          target_proposal_id: preview.target_proposal_id,
          evidence_ids: preview.evidence_ids,
          finding_ids: preview.finding_ids,
          source_confidence: preview.source_confidence,
          risk: preview.risk,
          create_hash: createHash,
        },
      })
      const result = resultFromPreview(preview, {
        create_id: createId,
        status: "created",
        proposal_id: proposal.proposal_id,
        created_at: createdAt,
        requested_by: normalized.requested_by ?? "operator",
        create_hash: createHash,
      })
      await this.append("commander_executor_review_proposal_created", result)
      return redactValue(result)
    } catch (error) {
      const result = resultFromPreview(preview, {
        create_id: createId,
        status: "failed",
        created_at: createdAt,
        requested_by: normalized.requested_by ?? "operator",
        create_hash: createHash,
        error: bound(error instanceof Error ? error.message : String(error)),
      })
      await this.append("commander_executor_review_proposal_create_failed", result)
      return redactValue(result)
    }
  }

  private async serializeCreate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.createQueue
    let release!: () => void
    this.createQueue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  async list(input: { limit?: number; review_id?: string; proposal_id?: string } = {}): Promise<ExecutorReviewProposalCreateRecord[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100))
    const events = await this.createEvents()
    return redactValue(events
      .filter((event) => !input.review_id || event.review_id === input.review_id)
      .filter((event) => !input.proposal_id || event.proposal_id === input.proposal_id)
      .reverse()
      .map(recordFromEvent)
      .slice(0, limit))
  }

  async get(createId: string): Promise<ExecutorReviewProposalCreateResult | null> {
    const safeId = required(createId, "create_id")
    const event = (await this.createEvents()).reverse().find((item) => item.create_id === safeId)
    return event ? redactValue(resultFromEvent(event)) : null
  }

  private async buildPreview(input: ExecutorReviewProposalCreatePreviewInput): Promise<ExecutorReviewProposalCreatePreview> {
    const generatedAt = this.now().toISOString()
    const warnings = ["proposal creation does not request review, apply changes, mutate missions, call providers, or launch OpenCode"]
    const draftPreview = await this.options.draftService.preview({ review_id: input.review_id, include_authority: true, include_packet: true })
    const candidate = draftPreview.candidates.find((item) => item.draft_id === input.draft_id)
    const blockers: string[] = []
    if (!candidate) blockers.push("requested draft_id was not found for the exact executor review")
    if (draftPreview.status !== "ready") blockers.push(`executor review draft preview is ${draftPreview.status}`)
    if (draftPreview.review_decision && !new Set(["accept_result", "needs_followup", "needs_human_review"]).has(draftPreview.review_decision)) blockers.push(`executor review decision ${draftPreview.review_decision} is not proposal-creation eligible`)
    if ((draftPreview.review_confidence ?? 0) < 0.5) blockers.push("executor review confidence is below proposal creation threshold")
    if (candidate?.would_create_proposal !== false || candidate?.would_mutate_mission !== false) blockers.push("draft candidate must be preview-only and non-mutating")
    if (candidate?.risk === "high" && candidate.draft_kind !== "human_review" && candidate.draft_kind !== "blocked_followup") blockers.push("high-risk draft candidates require human_review or blocked_followup kind")
    const existing = candidate ? await this.findExisting(candidate) : undefined
    if (existing) blockers.push("proposal already exists for this executor review draft")
    const actionKind = proposedActionKind(candidate)
    return redactValue({
      preview_id: `executor_review_proposal_create_preview_${sha256(`${input.review_id}:${input.draft_id}:${generatedAt}`).slice(0, 16)}`,
      status: blockers.length === 0 ? "ready" : "blocked",
      can_create: blockers.length === 0,
      review_id: bound(input.review_id),
      draft_id: bound(input.draft_id),
      source_packet_id: candidate?.source_packet_id,
      draft_kind: candidate?.draft_kind ?? "other",
      title_preview: bound(candidate?.title ?? "Executor review proposal"),
      summary_preview: bound(candidate?.summary ?? "No draft candidate is available for proposal creation."),
      proposed_action_kind: actionKind,
      target_mission_id: candidate?.mission_id,
      target_result_id: candidate?.result_id,
      target_handoff_id: candidate?.handoff_id,
      target_proposal_id: candidate?.proposal_id,
      evidence_ids: boundList(candidate?.evidence_ids),
      finding_ids: boundList(candidate?.finding_ids),
      source_confidence: candidate?.confidence ?? draftPreview.review_confidence ?? 0,
      risk: candidate?.risk ?? "medium",
      existing_proposal_id: existing?.proposal_id,
      blockers: boundList(blockers),
      warnings: boundList(warnings),
      recommended_commands: recommendedCommands(input.review_id, input.draft_id, existing?.proposal_id),
      generated_at: generatedAt,
      redacted_summary_preview: blockers.length === 0 ? `Draft ${input.draft_id} can create one proposed Commander proposal.` : blockers[0] ?? "Proposal creation is blocked.",
    })
  }

  private async findExisting(candidate: ExecutorReviewProposalDraftCandidate): Promise<CommanderProposal | undefined> {
    const proposals = await this.options.proposalRegistry.listAllProposals()
    return proposals.find((proposal) => {
      const payload = proposal.action_payload ?? {}
      return payload.source === "executor_review_proposal_create"
        && payload.review_id === candidate.source_review_id
        && payload.draft_id === candidate.draft_id
        && proposal.status !== "cancelled"
    })
  }

  private async createEvents(): Promise<JsonlEvent[]> {
    return (await this.options.eventStore.readAll()).filter((event) =>
      event.kind === "commander_executor_review_proposal_created"
      || event.kind === "commander_executor_review_proposal_create_blocked"
      || event.kind === "commander_executor_review_proposal_create_failed")
  }

  private async append(kind: string, result: ExecutorReviewProposalCreateResult): Promise<void> {
    await this.options.eventStore.append({ kind, ...redactValue(result) } as JsonlEvent)
  }
}

export function readExecutorReviewProposalCreatePreviewInput(value: unknown): ExecutorReviewProposalCreatePreviewInput {
  if (!isRecord(value)) throw new Error("executor review proposal creation requires review_id and draft_id")
  return normalizePreviewInput(value)
}

export function readExecutorReviewProposalCreateInput(value: unknown): ExecutorReviewProposalCreateInput {
  if (!isRecord(value)) throw new Error("executor review proposal creation requires review_id and draft_id")
  return normalizeCreateInput(value)
}

function normalizePreviewInput(input: Record<string, unknown>): ExecutorReviewProposalCreatePreviewInput {
  return {
    review_id: required(input.review_id ?? input.reviewId, "review_id"),
    draft_id: required(input.draft_id ?? input.draftId, "draft_id"),
    include_validation_evidence: input.include_validation_evidence === false || input.includeValidationEvidence === false ? false : undefined,
  }
}

function normalizeCreateInput(input: Record<string, unknown>): ExecutorReviewProposalCreateInput {
  return {
    ...normalizePreviewInput(input),
    requested_by: optional(input.requested_by ?? input.requestedBy) ?? "operator",
    dry_run: input.dry_run === true || input.dryRun === true,
  }
}

function resultFromPreview(preview: ExecutorReviewProposalCreatePreview, input: {
  create_id: string
  status: ExecutorReviewProposalCreateResult["status"]
  proposal_id?: string
  created_at: string
  requested_by: string
  error?: string
  create_hash: string
}): ExecutorReviewProposalCreateResult {
  return {
    create_id: input.create_id,
    status: input.status,
    proposal_id: input.proposal_id,
    review_id: preview.review_id,
    draft_id: preview.draft_id,
    source_packet_id: preview.source_packet_id,
    draft_kind: preview.draft_kind,
    proposed_action_kind: preview.proposed_action_kind,
    title_preview: preview.title_preview,
    summary_preview: preview.summary_preview,
    evidence_ids: preview.evidence_ids,
    finding_ids: preview.finding_ids,
    created_at: input.created_at,
    requested_by: input.requested_by,
    error: input.error,
    create_hash: input.create_hash,
    recommended_commands: preview.recommended_commands,
  }
}

function recordFromEvent(event: JsonlEvent): ExecutorReviewProposalCreateRecord {
  return {
    create_id: String(event.create_id ?? ""),
    status: String(event.status ?? "blocked"),
    proposal_id: optional(event.proposal_id),
    review_id: String(event.review_id ?? ""),
    draft_id: String(event.draft_id ?? ""),
    draft_kind: String(event.draft_kind ?? "other"),
    created_at: String(event.created_at ?? event.timestamp ?? ""),
    summary_preview: bound(String(event.summary_preview ?? event.error ?? "")),
    create_hash: String(event.create_hash ?? ""),
  }
}

function resultFromEvent(event: JsonlEvent): ExecutorReviewProposalCreateResult {
  return {
    create_id: String(event.create_id ?? ""),
    status: event.status === "created" || event.status === "blocked" || event.status === "failed" || event.status === "dry_run" ? event.status : "blocked",
    proposal_id: optional(event.proposal_id),
    review_id: String(event.review_id ?? ""),
    draft_id: String(event.draft_id ?? ""),
    source_packet_id: optional(event.source_packet_id),
    draft_kind: String(event.draft_kind ?? "other"),
    proposed_action_kind: String(event.proposed_action_kind ?? "other"),
    title_preview: bound(String(event.title_preview ?? "")),
    summary_preview: bound(String(event.summary_preview ?? "")),
    evidence_ids: boundList(event.evidence_ids),
    finding_ids: boundList(event.finding_ids),
    created_at: String(event.created_at ?? event.timestamp ?? ""),
    requested_by: String(event.requested_by ?? "operator"),
    error: optional(event.error),
    create_hash: String(event.create_hash ?? ""),
    recommended_commands: Array.isArray(event.recommended_commands) ? event.recommended_commands.map(readCommand).slice(0, MAX_ROWS) : [],
  }
}

function proposedActionKind(candidate?: ExecutorReviewProposalDraftCandidate): string {
  if (!candidate) return "other"
  if (candidate.draft_kind === "checkpoint") return "operator_checkpoint"
  return "other"
}

function createHashFor(preview: ExecutorReviewProposalCreatePreview): string {
  return sha256(JSON.stringify({
    review_id: preview.review_id,
    draft_id: preview.draft_id,
    source_packet_id: preview.source_packet_id,
    draft_kind: preview.draft_kind,
    proposed_action_kind: preview.proposed_action_kind,
    title_preview: preview.title_preview,
    summary_preview: preview.summary_preview,
    evidence_ids: preview.evidence_ids,
    finding_ids: preview.finding_ids,
  }))
}

function recommendedCommands(reviewId: string, draftId: string, proposalId?: string): ExecutorReviewProposalCreateCommand[] {
  const commands: ExecutorReviewProposalCreateCommand[] = [
    { label: "Show executor review", command: `/executor-review-show ${reviewId}`, command_type: "read" },
    { label: "Preview draft", command: `/executor-review-draft-preview review=${reviewId}`, command_type: "read" },
    { label: "Dry-run proposal create", command: `/executor-review-proposal-create-dry-run review=${reviewId} draft=${draftId}`, command_type: "read" },
    { label: "Show proposal create authority", command: "/authority-show /executor-review-proposal-create", command_type: "read" },
    { label: "List proposals", command: "/proposals", command_type: "read" },
  ]
  if (proposalId) commands.push({ label: "Show created proposal", command: `/proposal ${proposalId}`, command_type: "read" })
  return commands.map(readCommand).slice(0, MAX_ROWS)
}

function readCommand(value: unknown): ExecutorReviewProposalCreateCommand {
  const record = isRecord(value) ? value : {}
  return {
    label: bound(String(record.label ?? "Inspect")),
    command: bound(String(record.command ?? "/executor-review-proposal-creates")),
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
