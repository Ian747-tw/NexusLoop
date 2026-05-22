import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { MissionRegistry } from "./mission-registry"
import type { ReviewRegistry } from "./review-registry"
import type { ReviewRequestType } from "./review-types"
import type { CommanderProposal, CommanderProposalInput, ProposalActionKind, ProposalStatus, ProposalStatusSummary } from "./proposal-types"

export interface ProposalRegistryOptions {
  eventStore: EventStore
  missionRegistry: MissionRegistry
  reviewRegistry: ReviewRegistry
  idFactory?: (prefix: "proposal") => string
  now?: () => Date
}

type ProposalEvent =
  | { kind: "commander_proposal_created"; proposal: CommanderProposal }
  | { kind: "commander_proposal_review_requested"; proposal_id: string; review_id: string; requested_at: string }
  | { kind: "commander_proposal_approved"; proposal_id: string; review_id: string; approved_at: string }
  | { kind: "commander_proposal_rejected"; proposal_id: string; review_id?: string; rejected_at: string; reason?: string }
  | { kind: "commander_proposal_cancelled"; proposal_id: string; cancelled_at: string; reason?: string }
  | { kind: "commander_proposal_applied"; proposal_id: string; applied_at: string; application_result: string }
  | { kind: "commander_proposal_apply_failed"; proposal_id: string; failed_at: string; failure_reason: string }

const ACTION_KINDS = new Set<ProposalActionKind>([
  "complete_mission",
  "fail_mission",
  "cancel_mission",
  "release_claim",
  "record_progress",
  "submit_result",
  "operator_checkpoint",
  "other",
])

const TERMINAL_STATUSES = new Set<ProposalStatus>(["rejected", "cancelled", "applied"])

export class ProposalRegistry {
  private readonly eventStore: EventStore
  private readonly missionRegistry: MissionRegistry
  private readonly reviewRegistry: ReviewRegistry
  private readonly idFactory: (prefix: "proposal") => string
  private readonly now: () => Date
  private hydrated = false
  private generatedIds = 0
  private hydrateTask: Promise<void> | null = null
  private mutationTask: Promise<void> = Promise.resolve()
  private readonly proposals = new Map<string, CommanderProposal>()
  private readonly proposalOrder: string[] = []

  constructor(options: ProposalRegistryOptions) {
    this.eventStore = options.eventStore
    this.missionRegistry = options.missionRegistry
    this.reviewRegistry = options.reviewRegistry
    this.idFactory = options.idFactory ?? ((prefix) => `${prefix}_${Date.now().toString(36)}_${++this.generatedIds}`)
    this.now = options.now ?? (() => new Date())
  }

  async createProposal(input: CommanderProposalInput): Promise<CommanderProposal> {
    return this.serializeMutation(async () => {
      await this.hydrate()
      const actionKind = cleanActionKind(input.action_kind)
      const payload = readPayload(input.action_payload)
      const missionId = cleanOptionalString(input.mission_id ?? optionalPayloadString(payload, "mission_id"), "mission_id")
      const claimId = cleanOptionalString(input.claim_id ?? optionalPayloadString(payload, "claim_id"), "claim_id")
      const resultId = cleanOptionalString(input.result_id ?? optionalPayloadString(payload, "result_id"), "result_id")
      if (resultId && !missionId) throw new Error("mission_id is required when result_id is provided")
      if (missionId) await this.validateMissionReferences(missionId, claimId, resultId)
      else if (claimId) await this.validateClaimReference(claimId)
      const now = this.isoNow()
      const proposal: CommanderProposal = {
        proposal_id: this.idFactory("proposal"),
        mission_id: missionId,
        claim_id: claimId,
        result_id: resultId,
        action_kind: actionKind,
        title: redactText(cleanRequiredString(input.title, "title")),
        summary: redactText(cleanRequiredString(input.summary, "summary")),
        proposed_by: redactText(cleanRequiredString(input.proposed_by, "proposed_by")),
        status: "proposed",
        action_payload: redactValue(payload),
        created_at: now,
        updated_at: now,
      }
      await this.appendAndApply({ kind: "commander_proposal_created", proposal })
      return redactValue(this.requireProposal(proposal.proposal_id))
    })
  }

  async requestReview(proposalId: string, input: { title?: string; summary?: string; requested_by: string }): Promise<CommanderProposal> {
    return this.serializeMutation(async () => {
      await this.hydrate()
      const proposal = this.requireProposal(cleanRequiredString(proposalId, "proposal_id"))
      if (proposal.status === "review_requested" || proposal.status === "approved") return redactValue(proposal)
      if (TERMINAL_STATUSES.has(proposal.status)) throw new Error(`terminal proposal cannot request review: ${proposal.proposal_id}`)
      const review = await this.reviewRegistry.createReviewRequest({
        mission_id: proposal.mission_id ?? await this.missionIdForClaim(proposal.claim_id),
        claim_id: proposal.claim_id,
        result_id: proposal.result_id,
        request_type: reviewTypeForAction(proposal.action_kind),
        title: input.title === undefined ? proposal.title : input.title,
        summary: input.summary === undefined ? proposal.summary : input.summary,
        requested_by: input.requested_by,
      })
      await this.appendAndApply({
        kind: "commander_proposal_review_requested",
        proposal_id: proposal.proposal_id,
        review_id: review.review_id,
        requested_at: this.isoNow(),
      })
      return redactValue(this.requireProposal(proposal.proposal_id))
    })
  }

  async getProposal(proposalId: string): Promise<CommanderProposal | null> {
    await this.hydrate()
    return redactValue(this.proposals.get(cleanRequiredString(proposalId, "proposal_id")) ?? null)
  }

  async listProposals(options: { status?: ProposalStatus; limit?: number } = {}): Promise<CommanderProposal[]> {
    await this.hydrate()
    const status = options.status === undefined ? undefined : cleanStatus(options.status)
    const limit = cleanLimit(options.limit ?? 20)
    return redactValue(
      this.proposalOrder
        .slice()
        .reverse()
        .map((proposalId) => this.proposals.get(proposalId))
        .filter((proposal): proposal is CommanderProposal => proposal !== undefined && (status === undefined || proposal.status === status))
        .slice(0, limit),
    )
  }

  async listAllProposals(options: { status?: ProposalStatus } = {}): Promise<CommanderProposal[]> {
    await this.hydrate()
    const status = options.status === undefined ? undefined : cleanStatus(options.status)
    return redactValue(
      this.proposalOrder
        .slice()
        .reverse()
        .map((proposalId) => this.proposals.get(proposalId))
        .filter((proposal): proposal is CommanderProposal => proposal !== undefined && (status === undefined || proposal.status === status)),
    )
  }

  async cancelProposal(proposalId: string, reason?: string): Promise<CommanderProposal> {
    return this.serializeMutation(async () => {
      await this.hydrate()
      const proposal = this.requireProposal(cleanRequiredString(proposalId, "proposal_id"))
      const safeReason = reason === undefined ? undefined : redactText(cleanRequiredString(reason, "reason"))
      if (proposal.status === "cancelled") return redactValue(this.idempotentCancelled(proposal, safeReason))
      if (TERMINAL_STATUSES.has(proposal.status)) throw new Error(`terminal proposal cannot cancel: ${proposal.proposal_id}`)
      await this.appendAndApply({
        kind: "commander_proposal_cancelled",
        proposal_id: proposal.proposal_id,
        cancelled_at: this.isoNow(),
        reason: safeReason,
      })
      return redactValue(this.requireProposal(proposal.proposal_id))
    })
  }

  async applyProposal(proposalId: string): Promise<CommanderProposal> {
    return this.serializeMutation(async () => {
      await this.hydrate()
      const proposal = this.requireProposal(cleanRequiredString(proposalId, "proposal_id"))
      if (proposal.status === "applied") return redactValue(proposal)
      if (proposal.status === "rejected" || proposal.status === "cancelled") throw new Error(`terminal proposal cannot apply: ${proposal.proposal_id}`)
      const reviewId = cleanRequiredString(proposal.review_id, "review_id")
      const review = await this.reviewRegistry.getReviewRequest(reviewId)
      if (!review) {
        throw new Error(`proposal requires an approved linked review before apply: ${proposal.proposal_id}`)
      }
      if (review.status === "rejected" || review.status === "cancelled") {
        await this.appendAndApply({
          kind: "commander_proposal_rejected",
          proposal_id: proposal.proposal_id,
          review_id: review.review_id,
          rejected_at: review.decision_at ?? this.isoNow(),
          reason: review.decision_reason ?? `linked review ${review.status}`,
        })
        throw new Error(`proposal linked review is ${review.status}: ${proposal.proposal_id}`)
      }
      if (review.status !== "approved") throw new Error(`proposal requires an approved linked review before apply: ${proposal.proposal_id}`)
      if (proposal.status !== "approved") {
        await this.appendAndApply({
          kind: "commander_proposal_approved",
          proposal_id: proposal.proposal_id,
          review_id: review.review_id,
          approved_at: review.decision_at ?? this.isoNow(),
        })
      }
      try {
        const applicationResult = await this.applyAction(this.requireProposal(proposal.proposal_id))
        await this.appendAndApply({
          kind: "commander_proposal_applied",
          proposal_id: proposal.proposal_id,
          applied_at: this.isoNow(),
          application_result: applicationResult,
        })
      } catch (error) {
        const message = redactText(error instanceof Error ? error.message : String(error))
        await this.appendAndApply({
          kind: "commander_proposal_apply_failed",
          proposal_id: proposal.proposal_id,
          failed_at: this.isoNow(),
          failure_reason: message,
        })
        throw new Error(`proposal apply failed: ${message}`)
      }
      return redactValue(this.requireProposal(proposal.proposal_id))
    })
  }

  async syncReviewDecision(reviewId: string): Promise<CommanderProposal[]> {
    return this.serializeMutation(async () => {
      await this.hydrate()
      const id = cleanRequiredString(reviewId, "review_id")
      const review = await this.reviewRegistry.getReviewRequest(id)
      if (!review || review.status === "pending") return []
      const changed: CommanderProposal[] = []
      for (const proposal of [...this.proposals.values()].filter((item) => item.review_id === id)) {
        if (review.status === "approved") {
          if (proposal.status === "review_requested") {
            await this.appendAndApply({
              kind: "commander_proposal_approved",
              proposal_id: proposal.proposal_id,
              review_id: id,
              approved_at: review.decision_at ?? this.isoNow(),
            })
            changed.push(this.requireProposal(proposal.proposal_id))
          }
        } else if (review.status === "rejected" || review.status === "cancelled") {
          if (proposal.status === "review_requested") {
            await this.appendAndApply({
              kind: "commander_proposal_rejected",
              proposal_id: proposal.proposal_id,
              review_id: id,
              rejected_at: review.decision_at ?? this.isoNow(),
              reason: review.decision_reason ?? `linked review ${review.status}`,
            })
            changed.push(this.requireProposal(proposal.proposal_id))
          }
        }
      }
      return redactValue(changed)
    })
  }

  async statusSummary(): Promise<ProposalStatusSummary> {
    await this.hydrate()
    const proposals = [...this.proposals.values()]
    return {
      proposed_count: proposals.filter((proposal) => proposal.status === "proposed").length,
      review_requested_count: proposals.filter((proposal) => proposal.status === "review_requested").length,
      approved_count: proposals.filter((proposal) => proposal.status === "approved").length,
      rejected_count: proposals.filter((proposal) => proposal.status === "rejected").length,
      cancelled_count: proposals.filter((proposal) => proposal.status === "cancelled").length,
      applied_count: proposals.filter((proposal) => proposal.status === "applied").length,
      last_proposal_id: this.proposalOrder.at(-1),
    }
  }

  private async applyAction(proposal: CommanderProposal): Promise<string> {
    const payload = readPayload(proposal.action_payload)
    switch (proposal.action_kind) {
      case "record_progress": {
        const progress = await this.missionRegistry.recordMissionProgress({
          mission_id: requiredActionString(proposal, payload, "mission_id"),
          claim_id: requiredActionString(proposal, payload, "claim_id"),
          message: requiredPayloadString(payload, "message"),
        })
        return `mission_progress_recorded:${progress.progress_id}`
      }
      case "submit_result": {
        const result = await this.missionRegistry.submitMissionResult({
          mission_id: requiredActionString(proposal, payload, "mission_id"),
          claim_id: requiredActionString(proposal, payload, "claim_id"),
          summary: requiredPayloadString(payload, "summary"),
          artifacts: optionalPayloadStringArray(payload, "artifacts"),
          research_result_ids: optionalPayloadStringArray(payload, "research_result_ids"),
        })
        return `mission_result_submitted:${result.result_id}`
      }
      case "complete_mission": {
        const mission = await this.missionRegistry.completeMission(requiredActionString(proposal, payload, "mission_id"), {
          result_id: optionalActionString(proposal, payload, "result_id"),
          summary: optionalPayloadString(payload, "summary"),
        })
        return `mission_completed:${mission.mission_id}`
      }
      case "fail_mission": {
        const mission = await this.missionRegistry.failMission(requiredActionString(proposal, payload, "mission_id"), requiredPayloadString(payload, "reason"))
        return `mission_failed:${mission.mission_id}`
      }
      case "cancel_mission": {
        const mission = await this.missionRegistry.cancelMission(requiredActionString(proposal, payload, "mission_id"), optionalPayloadString(payload, "reason"))
        return `mission_cancelled:${mission.mission_id}`
      }
      case "release_claim": {
        const claim = await this.missionRegistry.releaseMissionClaim(requiredActionString(proposal, payload, "claim_id"), optionalPayloadString(payload, "reason"))
        return `mission_claim_released:${claim.claim_id}`
      }
      default:
        throw new Error(`unsupported proposal action kind for apply: ${proposal.action_kind}`)
    }
  }

  private async validateMissionReferences(missionId: string, claimId?: string, resultId?: string): Promise<void> {
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

  private async validateClaimReference(claimId: string): Promise<void> {
    const claim = await this.missionRegistry.getMissionClaim(claimId)
    if (!claim) throw new Error(`mission claim not found: ${claimId}`)
  }

  private async missionIdForClaim(claimId?: string): Promise<string | undefined> {
    if (!claimId) return undefined
    const claim = await this.missionRegistry.getMissionClaim(claimId)
    return claim?.mission_id
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

  private async appendAndApply(event: ProposalEvent): Promise<void> {
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

  private applyEvent(event: JsonlEvent | ProposalEvent): void {
    switch (event.kind) {
      case "commander_proposal_created":
        this.applyCreated(readProposal(event.proposal))
        break
      case "commander_proposal_review_requested":
        this.applyReviewRequested(readEventString(event.proposal_id, "proposal_id"), readEventString(event.review_id, "review_id"), readEventString(event.requested_at, "requested_at"))
        break
      case "commander_proposal_approved":
        this.applyDecision(readEventString(event.proposal_id, "proposal_id"), "approved", readEventString(event.approved_at, "approved_at"), undefined, readEventString(event.review_id, "review_id"))
        break
      case "commander_proposal_rejected":
        this.applyDecision(readEventString(event.proposal_id, "proposal_id"), "rejected", readEventString(event.rejected_at, "rejected_at"), optionalPayloadString(event, "reason"))
        break
      case "commander_proposal_cancelled":
        this.applyDecision(readEventString(event.proposal_id, "proposal_id"), "cancelled", readEventString(event.cancelled_at, "cancelled_at"), optionalPayloadString(event, "reason"))
        break
      case "commander_proposal_applied":
        this.applyApplied(readEventString(event.proposal_id, "proposal_id"), readEventString(event.applied_at, "applied_at"), readEventString(event.application_result, "application_result"))
        break
      case "commander_proposal_apply_failed":
        this.applyFailed(readEventString(event.proposal_id, "proposal_id"), readEventString(event.failed_at, "failed_at"), readEventString(event.failure_reason, "failure_reason"))
        break
      default:
        if (typeof event.kind === "string" && event.kind.startsWith("commander_proposal_") && !event.kind.startsWith("commander_proposal_bundle_")) {
          throw new Error(`unsupported commander proposal event: ${event.kind}`)
        }
    }
  }

  private applyCreated(proposal: CommanderProposal): void {
    if (proposal.status !== "proposed") throw new Error(`commander_proposal_created must start proposed: ${proposal.proposal_id}`)
    if (!this.proposals.has(proposal.proposal_id)) this.proposalOrder.push(proposal.proposal_id)
    this.proposals.set(proposal.proposal_id, redactValue(proposal))
  }

  private applyReviewRequested(proposalId: string, reviewId: string, requestedAt: string): void {
    const proposal = this.requireProposal(proposalId)
    if (TERMINAL_STATUSES.has(proposal.status)) throw new Error(`terminal proposal review request conflicts: ${proposalId}`)
    if (proposal.review_id && proposal.review_id !== reviewId) throw new Error(`proposal review request conflicts with existing review: ${proposalId}`)
    this.proposals.set(proposalId, redactValue({ ...proposal, review_id: reviewId, status: "review_requested", updated_at: requestedAt }))
  }

  private applyDecision(proposalId: string, status: "approved" | "rejected" | "cancelled", at: string, reason?: string, reviewId?: string): void {
    const proposal = this.requireProposal(proposalId)
    if (TERMINAL_STATUSES.has(proposal.status)) {
      if (proposal.status === status && proposal.failure_reason === reason) return
      throw new Error(`terminal proposal status conflicts with existing ${proposal.status}: ${proposalId}`)
    }
    if (status === "approved" && proposal.review_id !== reviewId) throw new Error(`proposal approval review does not match linked review: ${proposalId}`)
    this.proposals.set(proposalId, redactValue({ ...proposal, status, updated_at: at, decision_at: at, failure_reason: reason }))
  }

  private applyApplied(proposalId: string, appliedAt: string, applicationResult: string): void {
    const proposal = this.requireProposal(proposalId)
    if (proposal.status === "applied") {
      if (proposal.application_result === applicationResult) return
      throw new Error(`terminal proposal apply conflicts with existing payload: ${proposalId}`)
    }
    if (proposal.status !== "approved") throw new Error(`proposal must be approved before applied event: ${proposalId}`)
    const { failure_reason: _failureReason, ...appliedProposal } = proposal
    this.proposals.set(proposalId, redactValue({ ...appliedProposal, status: "applied", updated_at: appliedAt, applied_at: appliedAt, application_result: redactText(applicationResult) }))
  }

  private applyFailed(proposalId: string, failedAt: string, failureReason: string): void {
    const proposal = this.requireProposal(proposalId)
    if (TERMINAL_STATUSES.has(proposal.status)) throw new Error(`terminal proposal apply failure conflicts: ${proposalId}`)
    this.proposals.set(proposalId, redactValue({ ...proposal, updated_at: failedAt, failure_reason: redactText(failureReason) }))
  }

  private requireProposal(proposalId: string): CommanderProposal {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) throw new Error(`commander proposal not found: ${proposalId}`)
    return proposal
  }

  private idempotentCancelled(proposal: CommanderProposal, reason?: string): CommanderProposal {
    if (proposal.failure_reason === reason) return proposal
    throw new Error(`terminal proposal cancellation conflicts with existing payload: ${proposal.proposal_id}`)
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}

function readProposal(value: unknown): CommanderProposal {
  if (!isRecord(value)) throw new Error("commander_proposal_created event missing proposal")
  return {
    proposal_id: cleanRequiredString(value.proposal_id, "proposal_id"),
    mission_id: cleanOptionalString(value.mission_id, "mission_id"),
    claim_id: cleanOptionalString(value.claim_id, "claim_id"),
    result_id: cleanOptionalString(value.result_id, "result_id"),
    review_id: cleanOptionalString(value.review_id, "review_id"),
    action_kind: cleanActionKind(value.action_kind),
    title: redactText(cleanRequiredString(value.title, "title")),
    summary: redactText(cleanRequiredString(value.summary, "summary")),
    proposed_by: redactText(cleanRequiredString(value.proposed_by, "proposed_by")),
    status: cleanStatus(value.status),
    action_payload: readPayload(value.action_payload),
    created_at: cleanRequiredString(value.created_at, "created_at"),
    updated_at: cleanRequiredString(value.updated_at, "updated_at"),
    decision_at: cleanOptionalString(value.decision_at, "decision_at"),
    applied_at: cleanOptionalString(value.applied_at, "applied_at"),
    application_result: cleanOptionalString(value.application_result, "application_result"),
    failure_reason: cleanOptionalString(value.failure_reason, "failure_reason"),
  }
}

function reviewTypeForAction(actionKind: ProposalActionKind): ReviewRequestType {
  switch (actionKind) {
    case "complete_mission":
      return "mission_completion"
    case "fail_mission":
      return "mission_failure"
    case "cancel_mission":
      return "mission_cancellation"
    case "release_claim":
      return "claim_release"
    case "submit_result":
      return "result_acceptance"
    case "record_progress":
    case "operator_checkpoint":
    case "other":
      return "operator_checkpoint"
  }
}

function readPayload(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error("action_payload must be an object")
  return redactValue(value)
}

function requiredPayloadString(payload: Record<string, unknown>, field: string): string {
  return cleanRequiredString(payload[field], field)
}

function requiredActionString(proposal: CommanderProposal, payload: Record<string, unknown>, field: "mission_id" | "claim_id" | "result_id"): string {
  const value = optionalActionString(proposal, payload, field)
  if (!value) throw new Error(`${field} is required`)
  return value
}

function optionalActionString(proposal: CommanderProposal, payload: Record<string, unknown>, field: "mission_id" | "claim_id" | "result_id"): string | undefined {
  const topLevel = field === "mission_id" ? proposal.mission_id : field === "claim_id" ? proposal.claim_id : proposal.result_id
  const payloadValue = optionalPayloadString(payload, field)
  if (topLevel && payloadValue && payloadValue !== topLevel) throw new Error(`${field} conflicts with reviewed proposal target`)
  return topLevel ?? payloadValue
}

function optionalPayloadString(payload: Record<string, unknown>, field: string): string | undefined {
  return cleanOptionalString(payload[field], field)
}

function optionalPayloadStringArray(payload: Record<string, unknown>, field: string): string[] | undefined {
  const value = payload[field]
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value.map((item, index) => redactText(cleanRequiredString(item, `${field}[${index}]`)))
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

function readEventString(value: unknown, field: string): string {
  return cleanRequiredString(value, field)
}

function cleanActionKind(value: unknown): ProposalActionKind {
  if (typeof value !== "string" || !ACTION_KINDS.has(value as ProposalActionKind)) throw new Error("action_kind is invalid")
  return value as ProposalActionKind
}

function cleanStatus(value: unknown): ProposalStatus {
  if (
    value !== "proposed" &&
    value !== "review_requested" &&
    value !== "approved" &&
    value !== "rejected" &&
    value !== "cancelled" &&
    value !== "applied"
  ) throw new Error("proposal status is invalid")
  return value
}

function cleanLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error("proposal list limit must be a positive integer")
  return Math.min(value, 100)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
