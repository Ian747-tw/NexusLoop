import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import { isGenericProposalApplyActionKind, type ProposalRegistry } from "./proposal-registry"
import type { ProposalStatus } from "./proposal-types"
import type {
  CommanderProposalBundle,
  CommanderProposalBundleInput,
  CommanderProposalBundleReadiness,
  CommanderProposalBundleStatus,
  CommanderProposalBundleSummary,
} from "./proposal-bundle-types"

export interface ProposalBundleRegistryOptions {
  eventStore: EventStore
  proposalRegistry: ProposalRegistry
  idFactory?: (prefix: "bundle") => string
  now?: () => Date
}

type ProposalBundleEvent =
  | { kind: "commander_proposal_bundle_created"; bundle: CommanderProposalBundle }
  | { kind: "commander_proposal_bundle_proposal_added"; bundle_id: string; proposal_id: string; added_at: string }
  | { kind: "commander_proposal_bundle_review_requested"; bundle_id: string; proposal_ids: string[]; requested_at: string; requested_by: string }
  | { kind: "commander_proposal_bundle_cancelled"; bundle_id: string; cancelled_at: string; reason?: string }
  | { kind: "commander_proposal_bundle_applied"; bundle_id: string; applied_at: string; applied_proposal_ids: string[]; skipped_proposal_ids?: string[] }
  | { kind: "commander_proposal_bundle_apply_failed"; bundle_id: string; failed_at: string; failure_reason: string; applied_proposal_ids?: string[]; blocked_proposal_ids?: string[] }

const TERMINAL_BUNDLE_STATUSES = new Set<CommanderProposalBundleStatus>(["cancelled", "applied"])

// Bundle status is a projection: cancellation is the only bundle-local terminal
// override, and all other statuses are derived from included proposal states.
export class ProposalBundleRegistry {
  private readonly eventStore: EventStore
  private readonly proposalRegistry: ProposalRegistry
  private readonly idFactory: (prefix: "bundle") => string
  private readonly now: () => Date
  private hydrated = false
  private generatedIds = 0
  private hydrateTask: Promise<void> | null = null
  private mutationTask: Promise<void> = Promise.resolve()
  private readonly bundles = new Map<string, CommanderProposalBundle>()
  private readonly bundleOrder: string[] = []

  constructor(options: ProposalBundleRegistryOptions) {
    this.eventStore = options.eventStore
    this.proposalRegistry = options.proposalRegistry
    this.idFactory = options.idFactory ?? ((prefix) => `${prefix}_${Date.now().toString(36)}_${++this.generatedIds}`)
    this.now = options.now ?? (() => new Date())
  }

  async createBundle(input: CommanderProposalBundleInput): Promise<CommanderProposalBundle> {
    return this.serializeMutation(async () => {
      await this.hydrate()
      const now = this.isoNow()
      const bundle: CommanderProposalBundle = {
        bundle_id: this.idFactory("bundle"),
        title: redactText(cleanRequiredString(input.title, "title")),
        summary: redactText(cleanRequiredString(input.summary, "summary")),
        created_by: redactText(cleanRequiredString(input.created_by, "created_by")),
        status: "open",
        proposal_ids: [],
        created_at: now,
        updated_at: now,
      }
      await this.appendAndApply({ kind: "commander_proposal_bundle_created", bundle })
      return redactValue(await this.projectBundle(bundle.bundle_id))
    })
  }

  async addProposal(bundleId: string, proposalId: string): Promise<CommanderProposalBundle> {
    return this.serializeMutation(async () => {
      await this.hydrate()
      const bundle = this.requireBundle(cleanRequiredString(bundleId, "bundle_id"))
      await this.requireBundleMutable(bundle.bundle_id)
      const cleanProposalId = cleanRequiredString(proposalId, "proposal_id")
      const proposal = await this.proposalRegistry.getProposal(cleanProposalId)
      if (!proposal) throw new Error(`commander proposal not found: ${cleanProposalId}`)
      if (bundle.proposal_ids.includes(cleanProposalId)) return redactValue(await this.projectBundle(bundle.bundle_id))
      await this.appendAndApply({
        kind: "commander_proposal_bundle_proposal_added",
        bundle_id: bundle.bundle_id,
        proposal_id: cleanProposalId,
        added_at: this.isoNow(),
      })
      return redactValue(await this.projectBundle(bundle.bundle_id))
    })
  }

  async getBundle(bundleId: string): Promise<CommanderProposalBundle | null> {
    await this.hydrate()
    const id = cleanRequiredString(bundleId, "bundle_id")
    if (!this.bundles.has(id)) return null
    return redactValue(await this.projectBundle(id))
  }

  async listBundles(options: { status?: CommanderProposalBundleStatus; limit?: number } = {}): Promise<CommanderProposalBundle[]> {
    await this.hydrate()
    const status = options.status === undefined ? undefined : cleanStatus(options.status)
    const limit = cleanLimit(options.limit ?? 20)
    const out: CommanderProposalBundle[] = []
    for (const bundleId of this.bundleOrder.slice().reverse()) {
      const bundle = await this.projectBundle(bundleId)
      if (status === undefined || bundle.status === status) out.push(bundle)
      if (out.length >= limit) break
    }
    return redactValue(out)
  }

  async listAllBundles(options: { status?: CommanderProposalBundleStatus } = {}): Promise<CommanderProposalBundle[]> {
    await this.hydrate()
    const status = options.status === undefined ? undefined : cleanStatus(options.status)
    const out: CommanderProposalBundle[] = []
    for (const bundleId of this.bundleOrder.slice().reverse()) {
      const bundle = await this.projectBundle(bundleId)
      if (status === undefined || bundle.status === status) out.push(bundle)
    }
    return redactValue(out)
  }

  async readiness(bundleId: string): Promise<CommanderProposalBundleReadiness> {
    await this.hydrate()
    return redactValue(await this.computeReadiness(cleanRequiredString(bundleId, "bundle_id")))
  }

  async requestReviews(bundleId: string, input: { requested_by: string }): Promise<CommanderProposalBundle> {
    return this.serializeMutation(async () => {
      await this.hydrate()
      const bundle = this.requireBundle(cleanRequiredString(bundleId, "bundle_id"))
      await this.requireBundleMutable(bundle.bundle_id)
      const requestedBy = redactText(cleanRequiredString(input.requested_by, "requested_by"))
      const requestedProposalIds: string[] = []
      for (const proposalId of bundle.proposal_ids) {
        const proposal = await this.proposalRegistry.getProposal(proposalId)
        if (!proposal) throw new Error(`commander proposal not found: ${proposalId}`)
        if (proposal.status === "proposed") {
          const updated = await this.proposalRegistry.requestReview(proposal.proposal_id, { requested_by: requestedBy })
          requestedProposalIds.push(updated.proposal_id)
        }
      }
      await this.appendAndApply({
        kind: "commander_proposal_bundle_review_requested",
        bundle_id: bundle.bundle_id,
        proposal_ids: requestedProposalIds,
        requested_at: this.isoNow(),
        requested_by: requestedBy,
      })
      return redactValue(await this.projectBundle(bundle.bundle_id))
    })
  }

  async applyBundle(bundleId: string, options: { allowPartial?: boolean } = {}): Promise<CommanderProposalBundle> {
    return this.serializeMutation(async () => {
      await this.hydrate()
      const bundle = this.requireBundle(cleanRequiredString(bundleId, "bundle_id"))
      await this.requireBundleMutable(bundle.bundle_id)
      const readiness = await this.computeReadiness(bundle.bundle_id)
      const allowPartial = options.allowPartial === true
      if (readiness.proposal_count === 0) {
        await this.appendAndApply({
          kind: "commander_proposal_bundle_apply_failed",
          bundle_id: bundle.bundle_id,
          failed_at: this.isoNow(),
          failure_reason: "proposal bundle has no proposals to apply",
          blocked_proposal_ids: [],
        })
        throw new Error("proposal bundle has no proposals to apply")
      }
      if (!allowPartial && !readiness.ready_to_apply) {
        const reason = readiness.blockers.join("; ") || "bundle is not ready to apply"
        await this.appendAndApply({
          kind: "commander_proposal_bundle_apply_failed",
          bundle_id: bundle.bundle_id,
          failed_at: this.isoNow(),
          failure_reason: reason,
          blocked_proposal_ids: await this.blockedProposalIds(bundle.proposal_ids),
        })
        throw new Error(`proposal bundle is not ready to apply: ${reason}`)
      }

      const appliedProposalIds: string[] = []
      const skippedProposalIds: string[] = []
      try {
        for (const proposalId of bundle.proposal_ids) {
          const proposal = await this.proposalRegistry.getProposal(proposalId)
          if (!proposal) throw new Error(`commander proposal not found: ${proposalId}`)
          if (proposal.status === "applied") {
            skippedProposalIds.push(proposal.proposal_id)
            continue
          }
          if (proposal.status !== "approved" || !isGenericProposalApplyActionKind(proposal.action_kind)) {
            if (allowPartial) {
              skippedProposalIds.push(proposal.proposal_id)
              continue
            }
            throw new Error(`proposal is not ready for generic apply: ${proposal.proposal_id}`)
          }
          const applied = await this.proposalRegistry.applyProposal(proposal.proposal_id)
          appliedProposalIds.push(applied.proposal_id)
        }
        if (allowPartial && appliedProposalIds.length === 0 && skippedProposalIds.length > 0) {
          throw new Error("partial proposal bundle apply did not apply any proposals")
        }
        await this.appendAndApply({
          kind: "commander_proposal_bundle_applied",
          bundle_id: bundle.bundle_id,
          applied_at: this.isoNow(),
          applied_proposal_ids: appliedProposalIds,
          skipped_proposal_ids: skippedProposalIds,
        })
      } catch (error) {
        const message = redactText(error instanceof Error ? error.message : String(error))
        await this.appendAndApply({
          kind: "commander_proposal_bundle_apply_failed",
          bundle_id: bundle.bundle_id,
          failed_at: this.isoNow(),
          failure_reason: message,
          applied_proposal_ids: appliedProposalIds,
          blocked_proposal_ids: await this.blockedProposalIds(bundle.proposal_ids),
        })
        throw new Error(`proposal bundle apply failed: ${message}`)
      }
      return redactValue(await this.projectBundle(bundle.bundle_id))
    })
  }

  async cancelBundle(bundleId: string, reason?: string): Promise<CommanderProposalBundle> {
    return this.serializeMutation(async () => {
      await this.hydrate()
      const bundle = this.requireBundle(cleanRequiredString(bundleId, "bundle_id"))
      const projected = await this.projectBundle(bundle.bundle_id)
      const safeReason = reason === undefined ? undefined : redactText(cleanRequiredString(reason, "reason"))
      if (projected.status === "cancelled") return redactValue(this.idempotentCancelled(bundle, safeReason))
      if (projected.status === "applied") throw new Error(`applied proposal bundle cannot cancel: ${bundle.bundle_id}`)
      await this.appendAndApply({
        kind: "commander_proposal_bundle_cancelled",
        bundle_id: bundle.bundle_id,
        cancelled_at: this.isoNow(),
        reason: safeReason,
      })
      return redactValue(await this.projectBundle(bundle.bundle_id))
    })
  }

  async statusSummary(): Promise<CommanderProposalBundleSummary> {
    await this.hydrate()
    const projected = await Promise.all(this.bundleOrder.map((bundleId) => this.projectBundle(bundleId)))
    return {
      open_count: projected.filter((bundle) => bundle.status === "open").length,
      review_requested_count: projected.filter((bundle) => bundle.status === "review_requested").length,
      approved_count: projected.filter((bundle) => bundle.status === "approved").length,
      partially_approved_count: projected.filter((bundle) => bundle.status === "partially_approved").length,
      applied_count: projected.filter((bundle) => bundle.status === "applied").length,
      partially_applied_count: projected.filter((bundle) => bundle.status === "partially_applied").length,
      cancelled_count: projected.filter((bundle) => bundle.status === "cancelled").length,
      last_bundle_id: this.bundleOrder.at(-1),
    }
  }

  private async projectBundle(bundleId: string): Promise<CommanderProposalBundle> {
    const bundle = this.requireBundle(bundleId)
    if (bundle.status === "cancelled") return bundle
    const readiness = await this.computeReadiness(bundle.bundle_id)
    return redactValue({ ...bundle, status: deriveStatus(readiness), updated_at: bundle.updated_at })
  }

  private async computeReadiness(bundleId: string): Promise<CommanderProposalBundleReadiness> {
    const bundle = this.requireBundle(bundleId)
    const statuses: ProposalStatus[] = []
    const blockers: string[] = []
    for (const proposalId of bundle.proposal_ids) {
      const proposal = await this.proposalRegistry.getProposal(proposalId)
      if (!proposal) {
        blockers.push(`missing proposal: ${proposalId}`)
        continue
      }
      statuses.push(proposal.status)
      if (!isGenericProposalApplyActionKind(proposal.action_kind)) {
        blockers.push(`proposal ${proposal.proposal_id} action ${proposal.action_kind} must use its dedicated command`)
      }
      if (proposal.status !== "approved" && proposal.status !== "applied") {
        blockers.push(`proposal ${proposal.proposal_id} status is ${proposal.status}`)
      }
    }
    if (bundle.status === "cancelled") blockers.push(`bundle ${bundle.bundle_id} is cancelled`)
    const blockedCount = blockers.length
    return {
      bundle_id: bundle.bundle_id,
      proposal_count: bundle.proposal_ids.length,
      proposed_count: statuses.filter((status) => status === "proposed").length,
      review_requested_count: statuses.filter((status) => status === "review_requested").length,
      approved_count: statuses.filter((status) => status === "approved").length,
      rejected_count: statuses.filter((status) => status === "rejected").length,
      cancelled_count: statuses.filter((status) => status === "cancelled").length,
      applied_count: statuses.filter((status) => status === "applied").length,
      blocked_count: blockedCount,
      ready_to_apply: bundle.status !== "cancelled" && bundle.proposal_ids.length > 0 && blockedCount === 0,
      blockers: blockers.map(redactText),
    }
  }

  private async blockedProposalIds(proposalIds: string[]): Promise<string[]> {
    const blocked: string[] = []
    for (const proposalId of proposalIds) {
      const proposal = await this.proposalRegistry.getProposal(proposalId)
      if (!proposal || !isGenericProposalApplyActionKind(proposal.action_kind) || (proposal.status !== "approved" && proposal.status !== "applied")) blocked.push(proposalId)
    }
    return blocked
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

  private async appendAndApply(event: ProposalBundleEvent): Promise<void> {
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

  private applyEvent(event: JsonlEvent | ProposalBundleEvent): void {
    switch (event.kind) {
      case "commander_proposal_bundle_created":
        this.applyCreated(readBundle(event.bundle))
        break
      case "commander_proposal_bundle_proposal_added":
        this.applyProposalAdded(readEventString(event.bundle_id, "bundle_id"), readEventString(event.proposal_id, "proposal_id"), readEventString(event.added_at, "added_at"))
        break
      case "commander_proposal_bundle_review_requested":
        this.applyBundleStatus(readEventString(event.bundle_id, "bundle_id"), "review_requested", readEventString(event.requested_at, "requested_at"))
        break
      case "commander_proposal_bundle_cancelled":
        this.applyCancelled(readEventString(event.bundle_id, "bundle_id"), readEventString(event.cancelled_at, "cancelled_at"), optionalEventString(event.reason, "reason"))
        break
      case "commander_proposal_bundle_applied":
        this.applyBundleStatus(readEventString(event.bundle_id, "bundle_id"), "applied", readEventString(event.applied_at, "applied_at"), { applied_at: readEventString(event.applied_at, "applied_at") })
        break
      case "commander_proposal_bundle_apply_failed":
        this.applyFailed(readEventString(event.bundle_id, "bundle_id"), readEventString(event.failed_at, "failed_at"), readEventString(event.failure_reason, "failure_reason"))
        break
      default:
        if (typeof event.kind === "string" && event.kind.startsWith("commander_proposal_bundle_")) {
          throw new Error(`unsupported commander proposal bundle event: ${event.kind}`)
        }
    }
  }

  private applyCreated(bundle: CommanderProposalBundle): void {
    if (bundle.status !== "open") throw new Error(`commander_proposal_bundle_created must start open: ${bundle.bundle_id}`)
    if (!this.bundles.has(bundle.bundle_id)) this.bundleOrder.push(bundle.bundle_id)
    this.bundles.set(bundle.bundle_id, redactValue(bundle))
  }

  private applyProposalAdded(bundleId: string, proposalId: string, addedAt: string): void {
    const bundle = this.requireBundle(bundleId)
    if (TERMINAL_BUNDLE_STATUSES.has(bundle.status)) throw new Error(`terminal proposal bundle cannot add proposal: ${bundleId}`)
    if (bundle.proposal_ids.includes(proposalId)) return
    this.bundles.set(bundleId, redactValue({ ...bundle, proposal_ids: [...bundle.proposal_ids, proposalId], updated_at: addedAt }))
  }

  private applyBundleStatus(bundleId: string, status: CommanderProposalBundleStatus, updatedAt: string, extra: Partial<CommanderProposalBundle> = {}): void {
    const bundle = this.requireBundle(bundleId)
    if (bundle.status === "cancelled") throw new Error(`cancelled proposal bundle cannot change status: ${bundleId}`)
    const next = redactValue({ ...bundle, ...extra, status, updated_at: updatedAt })
    if (status === "applied") delete next.failure_reason
    this.bundles.set(bundleId, next)
  }

  private applyCancelled(bundleId: string, cancelledAt: string, reason?: string): void {
    const bundle = this.requireBundle(bundleId)
    if (bundle.status === "cancelled") {
      if (bundle.cancellation_reason === reason) return
      throw new Error(`terminal proposal bundle cancellation conflicts with existing payload: ${bundleId}`)
    }
    if (bundle.status === "applied") throw new Error(`applied proposal bundle cancellation conflicts: ${bundleId}`)
    this.bundles.set(bundleId, redactValue({ ...bundle, status: "cancelled", updated_at: cancelledAt, cancelled_at: cancelledAt, cancellation_reason: reason }))
  }

  private applyFailed(bundleId: string, failedAt: string, failureReason: string): void {
    const bundle = this.requireBundle(bundleId)
    if (bundle.status === "cancelled") throw new Error(`cancelled proposal bundle apply failure conflicts: ${bundleId}`)
    this.bundles.set(bundleId, redactValue({ ...bundle, status: "partially_applied", updated_at: failedAt, failure_reason: redactText(failureReason) }))
  }

  private requireBundle(bundleId: string): CommanderProposalBundle {
    const bundle = this.bundles.get(bundleId)
    if (!bundle) throw new Error(`commander proposal bundle not found: ${bundleId}`)
    return bundle
  }

  private async requireBundleMutable(bundleId: string): Promise<void> {
    const bundle = await this.projectBundle(bundleId)
    if (bundle.status === "cancelled" || bundle.status === "applied") {
      throw new Error(`terminal proposal bundle cannot be changed: ${bundle.bundle_id}`)
    }
  }

  private idempotentCancelled(bundle: CommanderProposalBundle, reason?: string): CommanderProposalBundle {
    if (bundle.cancellation_reason === reason) return bundle
    throw new Error(`terminal proposal bundle cancellation conflicts with existing payload: ${bundle.bundle_id}`)
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}

function deriveStatus(readiness: CommanderProposalBundleReadiness): CommanderProposalBundleStatus {
  if (readiness.proposal_count > 0 && readiness.applied_count === readiness.proposal_count) return "applied"
  if (readiness.applied_count > 0) return "partially_applied"
  if (readiness.proposal_count > 0 && readiness.approved_count === readiness.proposal_count) return "approved"
  if (readiness.approved_count > 0) return "partially_approved"
  if (readiness.review_requested_count > 0) return "review_requested"
  return "open"
}

function readBundle(value: unknown): CommanderProposalBundle {
  if (!isRecord(value)) throw new Error("commander_proposal_bundle_created event missing bundle")
  const proposalIds = value.proposal_ids
  if (!Array.isArray(proposalIds)) throw new Error("proposal_ids must be an array")
  return {
    bundle_id: cleanRequiredString(value.bundle_id, "bundle_id"),
    title: redactText(cleanRequiredString(value.title, "title")),
    summary: redactText(cleanRequiredString(value.summary, "summary")),
    created_by: redactText(cleanRequiredString(value.created_by, "created_by")),
    status: cleanStatus(value.status),
    proposal_ids: proposalIds.map((item, index) => cleanRequiredString(item, `proposal_ids[${index}]`)),
    created_at: cleanRequiredString(value.created_at, "created_at"),
    updated_at: cleanRequiredString(value.updated_at, "updated_at"),
    cancelled_at: optionalEventString(value.cancelled_at, "cancelled_at"),
    cancellation_reason: optionalEventString(value.cancellation_reason, "cancellation_reason"),
    applied_at: optionalEventString(value.applied_at, "applied_at"),
    failure_reason: optionalEventString(value.failure_reason, "failure_reason"),
  }
}

function cleanRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function readEventString(value: unknown, field: string): string {
  return cleanRequiredString(value, field)
}

function optionalEventString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${field} must be a string`)
  if (!value.trim()) throw new Error(`${field} must be nonblank`)
  return redactText(value.trim())
}

function cleanStatus(value: unknown): CommanderProposalBundleStatus {
  if (
    value !== "open" &&
    value !== "review_requested" &&
    value !== "partially_approved" &&
    value !== "approved" &&
    value !== "partially_applied" &&
    value !== "applied" &&
    value !== "cancelled"
  ) throw new Error("proposal bundle status is invalid")
  return value
}

function cleanLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error("proposal bundle list limit must be a positive integer")
  return Math.min(value, 100)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
