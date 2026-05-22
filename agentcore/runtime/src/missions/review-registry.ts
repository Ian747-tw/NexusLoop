import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { MissionRegistry } from "./mission-registry"
import type { ReviewDecision, ReviewRequest, ReviewRequestInput, ReviewRequestType, ReviewStatus, ReviewStatusSummary } from "./review-types"

export interface ReviewRegistryOptions {
  eventStore: EventStore
  missionRegistry?: MissionRegistry
  idFactory?: (prefix: "review") => string
  now?: () => Date
}

type ReviewEvent =
  | { kind: "review_request_created"; review: ReviewRequest }
  | { kind: "review_request_approved"; decision: ReviewDecision }
  | { kind: "review_request_rejected"; decision: ReviewDecision }
  | { kind: "review_request_cancelled"; decision: ReviewDecision }

const REVIEW_REQUEST_TYPES = new Set<ReviewRequestType>([
  "mission_completion",
  "mission_failure",
  "mission_cancellation",
  "claim_release",
  "result_acceptance",
  "operator_checkpoint",
  "other",
])

const TERMINAL_STATUSES = new Set<ReviewStatus>(["approved", "rejected", "cancelled"])

export class ReviewRegistry {
  private readonly eventStore: EventStore
  private readonly missionRegistry?: MissionRegistry
  private readonly idFactory: (prefix: "review") => string
  private readonly now: () => Date
  private hydrated = false
  private generatedIds = 0
  private hydrateTask: Promise<void> | null = null
  private mutationTask: Promise<void> = Promise.resolve()
  private readonly reviews = new Map<string, ReviewRequest>()
  private readonly reviewOrder: string[] = []

  constructor(options: ReviewRegistryOptions) {
    this.eventStore = options.eventStore
    this.missionRegistry = options.missionRegistry
    this.idFactory = options.idFactory ?? ((prefix) => `${prefix}_${Date.now().toString(36)}_${++this.generatedIds}`)
    this.now = options.now ?? (() => new Date())
  }

  async createReviewRequest(input: ReviewRequestInput): Promise<ReviewRequest> {
    return this.serializeMutation(async () => {
      await this.hydrate()
      const missionId = cleanOptionalString(input.mission_id, "mission_id")
      const claimId = cleanOptionalString(input.claim_id, "claim_id")
      const resultId = cleanOptionalString(input.result_id, "result_id")
      if ((claimId || resultId) && !missionId) throw new Error("mission_id is required when claim_id or result_id is provided")
      if (missionId) await this.validateMissionReferences(missionId, claimId, resultId)
      const requestType = cleanRequestType(input.request_type ?? "other")
      const now = this.isoNow()
      const review: ReviewRequest = {
        review_id: this.idFactory("review"),
        mission_id: missionId,
        claim_id: claimId,
        result_id: resultId,
        request_type: requestType,
        title: redactText(cleanRequiredString(input.title, "title")),
        summary: redactText(cleanRequiredString(input.summary, "summary")),
        requested_by: redactText(cleanRequiredString(input.requested_by, "requested_by")),
        status: "pending",
        created_at: now,
        updated_at: now,
      }
      await this.appendAndApply({ kind: "review_request_created", review })
      return redactValue(this.requireReview(review.review_id))
    })
  }

  async getReviewRequest(reviewId: string): Promise<ReviewRequest | null> {
    await this.hydrate()
    return redactValue(this.reviews.get(cleanRequiredString(reviewId, "review_id")) ?? null)
  }

  async listReviewRequests(options: { status?: ReviewStatus; limit?: number } = {}): Promise<ReviewRequest[]> {
    await this.hydrate()
    const status = options.status === undefined ? undefined : cleanStatus(options.status)
    const limit = cleanLimit(options.limit ?? 20)
    return redactValue(
      this.reviewOrder
        .slice()
        .reverse()
        .map((reviewId) => this.reviews.get(reviewId))
        .filter((review): review is ReviewRequest => review !== undefined && (status === undefined || review.status === status))
        .slice(0, limit),
    )
  }

  async listAllReviewRequests(options: { status?: ReviewStatus } = {}): Promise<ReviewRequest[]> {
    await this.hydrate()
    const status = options.status === undefined ? undefined : cleanStatus(options.status)
    return redactValue(
      this.reviewOrder
        .slice()
        .reverse()
        .map((reviewId) => this.reviews.get(reviewId))
        .filter((review): review is ReviewRequest => review !== undefined && (status === undefined || review.status === status)),
    )
  }

  async approveReviewRequest(reviewId: string, decidedBy: string, reason?: string): Promise<ReviewRequest> {
    return this.decide(reviewId, "approved", decidedBy, reason)
  }

  async rejectReviewRequest(reviewId: string, decidedBy: string, reason?: string): Promise<ReviewRequest> {
    return this.decide(reviewId, "rejected", decidedBy, reason)
  }

  async cancelReviewRequest(reviewId: string, decidedBy: string, reason?: string): Promise<ReviewRequest> {
    return this.decide(reviewId, "cancelled", decidedBy, reason)
  }

  async statusSummary(): Promise<ReviewStatusSummary> {
    await this.hydrate()
    const reviews = [...this.reviews.values()]
    return {
      pending_count: reviews.filter((review) => review.status === "pending").length,
      approved_count: reviews.filter((review) => review.status === "approved").length,
      rejected_count: reviews.filter((review) => review.status === "rejected").length,
      cancelled_count: reviews.filter((review) => review.status === "cancelled").length,
      last_review_id: this.reviewOrder.at(-1),
    }
  }

  private async decide(reviewId: string, decision: ReviewDecision["decision"], decidedBy: string, reason?: string): Promise<ReviewRequest> {
    return this.serializeMutation(async () => {
      await this.hydrate()
      const id = cleanRequiredString(reviewId, "review_id")
      const by = redactText(cleanRequiredString(decidedBy, "decided_by"))
      const safeReason = reason === undefined ? undefined : redactText(cleanRequiredString(reason, "reason"))
      const review = this.requireReview(id)
      if (TERMINAL_STATUSES.has(review.status)) return redactValue(this.idempotentDecision(review, decision, by, safeReason))
      const decisionRecord: ReviewDecision = {
        review_id: id,
        decision,
        decided_by: by,
        reason: safeReason,
        decided_at: this.isoNow(),
      }
      const event: ReviewEvent = decision === "approved"
        ? { kind: "review_request_approved", decision: decisionRecord }
        : decision === "rejected"
          ? { kind: "review_request_rejected", decision: decisionRecord }
          : { kind: "review_request_cancelled", decision: decisionRecord }
      await this.appendAndApply(event)
      return redactValue(this.requireReview(id))
    })
  }

  private async validateMissionReferences(missionId: string, claimId?: string, resultId?: string): Promise<void> {
    if (!this.missionRegistry) return
    const mission = await this.missionRegistry.getMission(missionId)
    if (!mission) throw new Error(`mission not found: ${missionId}`)
    if (claimId) {
      const claim = await this.missionRegistry.getMissionClaim(claimId)
      if (!claim || claim.mission_id !== missionId) throw new Error(`mission claim does not belong to mission: ${claimId}`)
    }
    if (resultId) {
      const result = await this.missionRegistry.getMissionResult(resultId)
      if (!result || result.mission_id !== missionId) throw new Error(`mission result does not belong to mission: ${resultId}`)
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

  private async appendAndApply(event: ReviewEvent): Promise<void> {
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

  private applyEvent(event: JsonlEvent | ReviewEvent): void {
    switch (event.kind) {
      case "review_request_created":
        this.applyCreated(readReviewRequest(event.review))
        break
      case "review_request_approved":
      case "review_request_rejected":
      case "review_request_cancelled":
        this.applyDecision(readReviewDecision(event.decision, event.kind))
        break
      default:
        if (typeof event.kind === "string" && event.kind.startsWith("review_")) {
          throw new Error(`unsupported review event: ${event.kind}`)
        }
    }
  }

  private applyCreated(review: ReviewRequest): void {
    if (review.status !== "pending") throw new Error(`review_request_created must start pending: ${review.review_id}`)
    if (!this.reviews.has(review.review_id)) this.reviewOrder.push(review.review_id)
    this.reviews.set(review.review_id, redactValue(review))
  }

  private applyDecision(decision: ReviewDecision): void {
    const review = this.requireReview(decision.review_id)
    if (TERMINAL_STATUSES.has(review.status)) {
      this.idempotentDecision(review, decision.decision, decision.decided_by, decision.reason)
      return
    }
    this.reviews.set(decision.review_id, redactValue({
      ...review,
      status: decision.decision,
      updated_at: decision.decided_at,
      decision_at: decision.decided_at,
      decision_by: decision.decided_by,
      decision_reason: decision.reason,
    }))
  }

  private idempotentDecision(review: ReviewRequest, decision: ReviewDecision["decision"], decidedBy: string, reason?: string): ReviewRequest {
    if (review.status === decision && review.decision_by === decidedBy && review.decision_reason === reason) return review
    throw new Error(`terminal review decision conflicts with existing ${review.status} payload: ${review.review_id}`)
  }

  private requireReview(reviewId: string): ReviewRequest {
    const review = this.reviews.get(reviewId)
    if (!review) throw new Error(`review request not found: ${reviewId}`)
    return review
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}

function readReviewRequest(value: unknown): ReviewRequest {
  if (!isRecord(value)) throw new Error("review_request_created event missing review")
  return {
    review_id: cleanRequiredString(value.review_id, "review_id"),
    mission_id: cleanOptionalString(value.mission_id, "mission_id"),
    claim_id: cleanOptionalString(value.claim_id, "claim_id"),
    result_id: cleanOptionalString(value.result_id, "result_id"),
    request_type: cleanRequestType(value.request_type),
    title: redactText(cleanRequiredString(value.title, "title")),
    summary: redactText(cleanRequiredString(value.summary, "summary")),
    requested_by: redactText(cleanRequiredString(value.requested_by, "requested_by")),
    status: cleanStatus(value.status),
    created_at: cleanRequiredString(value.created_at, "created_at"),
    updated_at: cleanRequiredString(value.updated_at, "updated_at"),
    decision_at: cleanOptionalString(value.decision_at, "decision_at"),
    decision_by: cleanOptionalString(value.decision_by, "decision_by"),
    decision_reason: cleanOptionalString(value.decision_reason, "decision_reason"),
  }
}

function readReviewDecision(value: unknown, eventKind?: string): ReviewDecision {
  if (!isRecord(value)) throw new Error("review decision event missing decision")
  const decision = cleanStatus(value.decision)
  if (decision === "pending") throw new Error("review decision cannot be pending")
  if (eventKind !== undefined && eventKind !== `review_request_${decision}`) {
    throw new Error(`review decision event kind conflicts with decision: ${eventKind}`)
  }
  return {
    review_id: cleanRequiredString(value.review_id, "review_id"),
    decision,
    decided_by: redactText(cleanRequiredString(value.decided_by, "decided_by")),
    reason: cleanOptionalString(value.reason, "reason"),
    decided_at: cleanRequiredString(value.decided_at, "decided_at"),
  }
}

function cleanRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function cleanOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${field} must be a string`)
  if (!value.trim()) throw new Error(`${field} must be nonblank`)
  return redactText(value.trim())
}

function cleanRequestType(value: unknown): ReviewRequestType {
  if (typeof value !== "string" || !REVIEW_REQUEST_TYPES.has(value as ReviewRequestType)) throw new Error("request_type is invalid")
  return value as ReviewRequestType
}

function cleanStatus(value: unknown): ReviewStatus {
  if (value !== "pending" && value !== "approved" && value !== "rejected" && value !== "cancelled") throw new Error("review status is invalid")
  return value
}

function cleanLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error("review list limit must be a positive integer")
  return Math.min(value, 100)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
