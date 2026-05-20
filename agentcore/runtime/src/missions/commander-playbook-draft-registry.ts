import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { ProposalBundleRegistry } from "./proposal-bundle-registry"
import type { ProposalRegistry } from "./proposal-registry"
import type { ReviewRegistry } from "./review-registry"
import type {
  CommanderPlaybookDraft,
  CommanderPlaybookDraftReadiness,
  CommanderPlaybookDraftStatus,
  CommanderPlaybookDraftSummary,
  CreateCommanderPlaybookDraftRecordInput,
} from "./commander-playbook-draft-types"

export interface CommanderPlaybookDraftRegistryOptions {
  eventStore: EventStore
  proposalRegistry: ProposalRegistry
  proposalBundleRegistry: ProposalBundleRegistry
  reviewRegistry: ReviewRegistry
  idFactory?: (prefix: "draft") => string
  now?: () => Date
}

type CommanderPlaybookDraftEvent =
  | { kind: "commander_playbook_draft_created"; draft: CommanderPlaybookDraft }
  | { kind: "commander_playbook_draft_reviews_requested"; draft_id: string; review_ids: string[]; requested_at: string; requested_by: string }
  | { kind: "commander_playbook_draft_cancelled"; draft_id: string; cancelled_at: string; reason?: string }

export class CommanderPlaybookDraftRegistry {
  private readonly eventStore: EventStore
  private readonly proposalRegistry: ProposalRegistry
  private readonly proposalBundleRegistry: ProposalBundleRegistry
  private readonly reviewRegistry: ReviewRegistry
  private readonly idFactory: (prefix: "draft") => string
  private readonly now: () => Date
  private hydrated = false
  private generatedIds = 0
  private hydrateTask: Promise<void> | null = null
  private mutationTask: Promise<void> = Promise.resolve()
  private readonly drafts = new Map<string, CommanderPlaybookDraft>()
  private readonly draftOrder: string[] = []

  constructor(options: CommanderPlaybookDraftRegistryOptions) {
    this.eventStore = options.eventStore
    this.proposalRegistry = options.proposalRegistry
    this.proposalBundleRegistry = options.proposalBundleRegistry
    this.reviewRegistry = options.reviewRegistry
    this.idFactory = options.idFactory ?? ((prefix) => `${prefix}_${Date.now().toString(36)}_${++this.generatedIds}`)
    this.now = options.now ?? (() => new Date())
  }

  async createDraft(input: CreateCommanderPlaybookDraftRecordInput): Promise<CommanderPlaybookDraft> {
    return this.serializeMutation(async () => {
      await this.hydrate()
      const now = input.created_at ?? this.isoNow()
      const proposalIds = readStringArray(input.proposal_ids, "proposal_ids")
      if (proposalIds.length === 0) throw new Error("proposal_ids must include at least one proposal")
      for (const proposalId of proposalIds) {
        const proposal = await this.proposalRegistry.getProposal(proposalId)
        if (!proposal) throw new Error(`commander proposal not found: ${proposalId}`)
      }
      const bundleId = cleanOptionalString(input.bundle_id, "bundle_id")
      if (bundleId) {
        const bundle = await this.proposalBundleRegistry.getBundle(bundleId)
        if (!bundle) throw new Error(`commander proposal bundle not found: ${bundleId}`)
      }
      const reviewIds = readOptionalStringArray(input.review_ids, "review_ids")
      const draft: CommanderPlaybookDraft = {
        draft_id: this.idFactory("draft"),
        playbook_id: cleanRequiredString(input.playbook_id, "playbook_id"),
        status: statusForReviewCount(proposalIds.length, reviewIds?.length ?? 0),
        proposed_by: redactText(cleanRequiredString(input.proposed_by, "proposed_by")),
        field_values: readStringRecord(input.field_values, "field_values"),
        proposal_ids: proposalIds,
        bundle_id: bundleId,
        review_ids: reviewIds,
        created_at: now,
        updated_at: now,
      }
      await this.appendAndApply({ kind: "commander_playbook_draft_created", draft })
      return redactValue(this.requireDraft(draft.draft_id))
    })
  }

  async getDraft(draftId: string): Promise<CommanderPlaybookDraft | null> {
    await this.hydrate()
    return redactValue(this.drafts.get(cleanRequiredString(draftId, "draft_id")) ?? null)
  }

  async listDrafts(options: { status?: CommanderPlaybookDraftStatus; limit?: number } = {}): Promise<CommanderPlaybookDraft[]> {
    await this.hydrate()
    const status = options.status === undefined ? undefined : cleanStatus(options.status)
    const limit = cleanLimit(options.limit ?? 20)
    return redactValue(
      this.draftOrder
        .slice()
        .reverse()
        .map((draftId) => this.drafts.get(draftId))
        .filter((draft): draft is CommanderPlaybookDraft => draft !== undefined && (status === undefined || draft.status === status))
        .slice(0, limit),
    )
  }

  async statusSummary(): Promise<CommanderPlaybookDraftSummary> {
    await this.hydrate()
    const drafts = [...this.drafts.values()]
    return {
      drafted_count: drafts.filter((draft) => draft.status === "drafted").length,
      review_requested_count: drafts.filter((draft) => draft.status === "review_requested").length,
      partially_review_requested_count: drafts.filter((draft) => draft.status === "partially_review_requested").length,
      cancelled_count: drafts.filter((draft) => draft.status === "cancelled").length,
      last_draft_id: this.draftOrder.at(-1),
    }
  }

  async readiness(draftId: string): Promise<CommanderPlaybookDraftReadiness> {
    await this.hydrate()
    const draft = this.requireDraft(cleanRequiredString(draftId, "draft_id"))
    return redactValue(await this.computeReadiness(draft))
  }

  async requestReviews(draftId: string, input: { requested_by: string }): Promise<CommanderPlaybookDraft> {
    return this.serializeMutation(async () => {
      await this.hydrate()
      const draft = this.requireDraft(cleanRequiredString(draftId, "draft_id"))
      if (draft.status === "cancelled") throw new Error(`cancelled playbook draft cannot request reviews: ${draft.draft_id}`)
      const requestedBy = redactText(cleanRequiredString(input.requested_by, "requested_by"))
      const existing = await this.reviewIdsForDraft(draft.proposal_ids)
      const hasMissingReviews = existing.length < draft.proposal_ids.length
      if (draft.bundle_id && hasMissingReviews) {
        await this.proposalBundleRegistry.requestReviews(draft.bundle_id, { requested_by: requestedBy })
      } else {
        for (const proposalId of draft.proposal_ids) {
          const proposal = await this.proposalRegistry.getProposal(proposalId)
          if (!proposal) throw new Error(`commander proposal not found: ${proposalId}`)
          if (!proposal.review_id) await this.proposalRegistry.requestReview(proposal.proposal_id, { requested_by: requestedBy })
        }
      }
      const reviewIds = await this.reviewIdsForDraft(draft.proposal_ids)
      const recorded = draft.review_ids ?? []
      if (!sameStringSet(recorded, reviewIds)) {
        await this.appendAndApply({
          kind: "commander_playbook_draft_reviews_requested",
          draft_id: draft.draft_id,
          review_ids: reviewIds,
          requested_at: this.isoNow(),
          requested_by: requestedBy,
        })
      }
      return redactValue(this.requireDraft(draft.draft_id))
    })
  }

  async cancelDraft(draftId: string, reason?: string): Promise<CommanderPlaybookDraft> {
    return this.serializeMutation(async () => {
      await this.hydrate()
      const draft = this.requireDraft(cleanRequiredString(draftId, "draft_id"))
      const safeReason = reason === undefined ? undefined : redactText(cleanRequiredString(reason, "reason"))
      if (draft.status === "cancelled") return redactValue(this.idempotentCancelled(draft, safeReason))
      await this.appendAndApply({
        kind: "commander_playbook_draft_cancelled",
        draft_id: draft.draft_id,
        cancelled_at: this.isoNow(),
        reason: safeReason,
      })
      return redactValue(this.requireDraft(draft.draft_id))
    })
  }

  private async reviewIdsForDraft(proposalIds: string[]): Promise<string[]> {
    const reviewIds: string[] = []
    for (const proposalId of proposalIds) {
      const proposal = await this.proposalRegistry.getProposal(proposalId)
      if (!proposal) throw new Error(`commander proposal not found: ${proposalId}`)
      if (proposal.review_id && !reviewIds.includes(proposal.review_id)) reviewIds.push(proposal.review_id)
    }
    return reviewIds
  }

  private async computeReadiness(draft: CommanderPlaybookDraft): Promise<CommanderPlaybookDraftReadiness> {
    const blockers: string[] = []
    let appliedProposalCount = 0
    const reviewIds: string[] = []
    for (const proposalId of draft.proposal_ids) {
      const proposal = await this.proposalRegistry.getProposal(proposalId)
      if (!proposal) {
        blockers.push(`missing proposal: ${proposalId}`)
        continue
      }
      if (proposal.status === "applied") appliedProposalCount += 1
      if (proposal.review_id) reviewIds.push(proposal.review_id)
      else blockers.push(`proposal ${proposal.proposal_id} has no linked review`)
      if (proposal.status !== "approved" && proposal.status !== "applied") blockers.push(`proposal ${proposal.proposal_id} status is ${proposal.status}`)
    }
    let approvedReviewCount = 0
    let rejectedReviewCount = 0
    let cancelledReviewCount = 0
    for (const reviewId of reviewIds) {
      const review = await this.reviewRegistry.getReviewRequest(reviewId)
      if (!review) {
        blockers.push(`missing review: ${reviewId}`)
        continue
      }
      if (review.status === "approved") approvedReviewCount += 1
      else if (review.status === "rejected") rejectedReviewCount += 1
      else if (review.status === "cancelled") cancelledReviewCount += 1
      else blockers.push(`review ${review.review_id} status is ${review.status}`)
    }
    if (draft.status === "cancelled") blockers.push(`draft ${draft.draft_id} is cancelled`)
    const missingReviewCount = Math.max(0, draft.proposal_ids.length - reviewIds.length)
    return {
      draft_id: draft.draft_id,
      proposal_count: draft.proposal_ids.length,
      bundle_id: draft.bundle_id,
      review_count: reviewIds.length,
      missing_review_count: missingReviewCount,
      approved_review_count: approvedReviewCount,
      rejected_review_count: rejectedReviewCount,
      cancelled_review_count: cancelledReviewCount,
      applied_proposal_count: appliedProposalCount,
      blockers: blockers.map(redactText),
      ready_to_apply: draft.status !== "cancelled" && draft.proposal_ids.length > 0 && blockers.length === 0,
    }
  }

  private async hydrate(): Promise<void> {
    if (this.hydrated) return
    if (this.hydrateTask) return this.hydrateTask
    this.hydrateTask = (async () => {
      for (const event of await this.eventStore.readAll()) this.applyEvent(event)
      this.hydrated = true
    })()
    try {
      await this.hydrateTask
    } finally {
      this.hydrateTask = null
    }
  }

  private async appendAndApply(event: CommanderPlaybookDraftEvent): Promise<void> {
    const safeEvent = redactValue(event)
    await this.eventStore.append(safeEvent)
    this.applyEvent(safeEvent)
  }

  private async serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTask
    let release!: () => void
    this.mutationTask = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  private applyEvent(event: JsonlEvent | CommanderPlaybookDraftEvent): void {
    switch (event.kind) {
      case "commander_playbook_draft_created":
        this.applyCreated(readDraft(event.draft))
        break
      case "commander_playbook_draft_reviews_requested":
        this.applyReviewsRequested(readEventString(event.draft_id, "draft_id"), readStringArray(event.review_ids, "review_ids"), readEventString(event.requested_at, "requested_at"))
        break
      case "commander_playbook_draft_cancelled":
        this.applyCancelled(readEventString(event.draft_id, "draft_id"), readEventString(event.cancelled_at, "cancelled_at"), cleanOptionalString(event.reason, "reason"))
        break
      default:
        if (typeof event.kind === "string" && event.kind.startsWith("commander_playbook_draft_")) {
          throw new Error(`unsupported commander playbook draft event: ${event.kind}`)
        }
    }
  }

  private applyCreated(draft: CommanderPlaybookDraft): void {
    if (this.drafts.has(draft.draft_id)) throw new Error(`commander playbook draft already exists: ${draft.draft_id}`)
    this.draftOrder.push(draft.draft_id)
    this.drafts.set(draft.draft_id, redactValue(draft))
  }

  private applyReviewsRequested(draftId: string, reviewIds: string[], requestedAt: string): void {
    const draft = this.requireDraft(draftId)
    if (draft.status === "cancelled") throw new Error(`cancelled playbook draft review request conflicts: ${draftId}`)
    const merged = [...draft.review_ids ?? []]
    for (const reviewId of reviewIds) if (!merged.includes(reviewId)) merged.push(reviewId)
    this.drafts.set(draftId, redactValue({ ...draft, review_ids: merged, status: statusForReviewCount(draft.proposal_ids.length, merged.length), updated_at: requestedAt }))
  }

  private applyCancelled(draftId: string, cancelledAt: string, reason?: string): void {
    const draft = this.requireDraft(draftId)
    if (draft.status === "cancelled") {
      if (draft.cancellation_reason === reason) return
      throw new Error(`terminal playbook draft cancellation conflicts with existing payload: ${draftId}`)
    }
    this.drafts.set(draftId, redactValue({ ...draft, status: "cancelled", updated_at: cancelledAt, cancelled_at: cancelledAt, cancellation_reason: reason }))
  }

  private requireDraft(draftId: string): CommanderPlaybookDraft {
    const draft = this.drafts.get(draftId)
    if (!draft) throw new Error(`commander playbook draft not found: ${draftId}`)
    return draft
  }

  private idempotentCancelled(draft: CommanderPlaybookDraft, reason?: string): CommanderPlaybookDraft {
    if (draft.cancellation_reason === reason) return draft
    throw new Error(`terminal playbook draft cancellation conflicts with existing payload: ${draft.draft_id}`)
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}

function statusForReviewCount(proposalCount: number, reviewCount: number): CommanderPlaybookDraftStatus {
  if (reviewCount <= 0) return "drafted"
  if (reviewCount >= proposalCount) return "review_requested"
  return "partially_review_requested"
}

function readDraft(value: unknown): CommanderPlaybookDraft {
  if (!isRecord(value)) throw new Error("commander_playbook_draft_created event missing draft")
  return {
    draft_id: cleanRequiredString(value.draft_id, "draft_id"),
    playbook_id: cleanRequiredString(value.playbook_id, "playbook_id"),
    status: cleanStatus(value.status),
    proposed_by: redactText(cleanRequiredString(value.proposed_by, "proposed_by")),
    field_values: readStringRecord(value.field_values, "field_values"),
    proposal_ids: readStringArray(value.proposal_ids, "proposal_ids"),
    bundle_id: cleanOptionalString(value.bundle_id, "bundle_id"),
    review_ids: readOptionalStringArray(value.review_ids, "review_ids"),
    created_at: cleanRequiredString(value.created_at, "created_at"),
    updated_at: cleanRequiredString(value.updated_at, "updated_at"),
    cancelled_at: cleanOptionalString(value.cancelled_at, "cancelled_at"),
    cancellation_reason: cleanOptionalString(value.cancellation_reason, "cancellation_reason"),
  }
}

function readStringRecord(value: unknown, field: string): Record<string, string> {
  if (!isRecord(value)) throw new Error(`${field} must be an object`)
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) out[cleanRequiredString(key, `${field} key`)] = redactText(cleanRequiredString(raw, key))
  return out
}

function readStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value.map((item, index) => cleanRequiredString(item, `${field}[${index}]`))
}

function readOptionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  return readStringArray(value, field)
}

function cleanRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function readEventString(value: unknown, field: string): string {
  return cleanRequiredString(value, field)
}

function cleanOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${field} must be a string`)
  if (!value.trim()) throw new Error(`${field} must be nonblank`)
  return redactText(value.trim())
}

function cleanStatus(value: unknown): CommanderPlaybookDraftStatus {
  if (value !== "drafted" && value !== "review_requested" && value !== "partially_review_requested" && value !== "cancelled") {
    throw new Error("commander playbook draft status is invalid")
  }
  return value
}

function cleanLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error("commander playbook draft list limit must be a positive integer")
  return Math.min(value, 100)
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((item) => rightSet.has(item))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
