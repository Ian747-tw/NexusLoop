import { redactText, redactValue } from "../security/redaction"
import type { CommanderApplyService } from "./commander-apply-service"
import type { CommanderPlaybookDraftRegistry } from "./commander-playbook-draft-registry"
import type { CommanderPlaybookDraft } from "./commander-playbook-draft-types"
import type { ProposalBundleRegistry } from "./proposal-bundle-registry"
import type { CommanderProposalBundle } from "./proposal-bundle-types"
import type { ProposalRegistry } from "./proposal-registry"
import type { CommanderProposal } from "./proposal-types"
import type { ReviewRegistry } from "./review-registry"
import type { ReviewRequest } from "./review-types"
import type {
  CommanderQueueItem,
  CommanderQueueKind,
  CommanderQueueOptions,
  CommanderQueueResult,
  CommanderQueueSummary,
  CommanderQueueTargetType,
} from "./commander-queue-types"

export const COMMANDER_QUEUE_KINDS: CommanderQueueKind[] = [
  "needs_review",
  "ready_to_apply",
  "blocked",
  "failed_apply",
  "recently_applied",
  "drafts_needing_review",
  "bundles_needing_review",
  "stale_open",
]

const QUEUE_KIND_SET = new Set<CommanderQueueKind>(COMMANDER_QUEUE_KINDS)
const DEFAULT_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000
const MAX_LIMIT = 100
const TITLE_LIMIT = 120
const SUMMARY_LIMIT = 240
const BLOCKER_LIMIT = 160

export interface CommanderQueueServiceOptions {
  reviewRegistry: ReviewRegistry
  proposalRegistry: ProposalRegistry
  proposalBundleRegistry: ProposalBundleRegistry
  commanderPlaybookDraftRegistry: CommanderPlaybookDraftRegistry
  applyService: CommanderApplyService
  now?: () => Date
}

export class CommanderQueueService {
  private readonly reviewRegistry: ReviewRegistry
  private readonly proposalRegistry: ProposalRegistry
  private readonly proposalBundleRegistry: ProposalBundleRegistry
  private readonly commanderPlaybookDraftRegistry: CommanderPlaybookDraftRegistry
  private readonly applyService: CommanderApplyService
  private readonly now: () => Date

  constructor(options: CommanderQueueServiceOptions) {
    this.reviewRegistry = options.reviewRegistry
    this.proposalRegistry = options.proposalRegistry
    this.proposalBundleRegistry = options.proposalBundleRegistry
    this.commanderPlaybookDraftRegistry = options.commanderPlaybookDraftRegistry
    this.applyService = options.applyService
    this.now = options.now ?? (() => new Date())
  }

  async summary(options: CommanderQueueOptions = {}): Promise<CommanderQueueSummary> {
    const staleAfterMs = readStaleAfterMs(options.staleAfterMs)
    const counts: Record<CommanderQueueKind, number> = {
      needs_review: 0,
      ready_to_apply: 0,
      blocked: 0,
      failed_apply: 0,
      recently_applied: 0,
      drafts_needing_review: 0,
      bundles_needing_review: 0,
      stale_open: 0,
    }
    let lastUpdatedAt: string | undefined
    for (const queue of COMMANDER_QUEUE_KINDS) {
      const items = orderQueueItems(queue, await this.collect(queue, staleAfterMs))
      counts[queue] = items.length
      for (const item of items) {
        lastUpdatedAt = newestIso(lastUpdatedAt, item.updated_at ?? item.created_at)
      }
    }
    return redactValue({
      needs_review_count: counts.needs_review,
      ready_to_apply_count: counts.ready_to_apply,
      blocked_count: counts.blocked,
      failed_apply_count: counts.failed_apply,
      recently_applied_count: counts.recently_applied,
      drafts_needing_review_count: counts.drafts_needing_review,
      bundles_needing_review_count: counts.bundles_needing_review,
      stale_open_count: counts.stale_open,
      last_updated_at: lastUpdatedAt,
    })
  }

  async queue(queue: CommanderQueueKind, options: CommanderQueueOptions = {}): Promise<CommanderQueueResult> {
    const kind = readQueueKind(queue)
    const limit = readLimit(options.limit ?? 20)
    const staleAfterMs = readStaleAfterMs(options.staleAfterMs)
    const items = await this.collect(kind, staleAfterMs)
    const ordered = orderQueueItems(kind, items)
    return redactValue({
      queue: kind,
      items: ordered.slice(0, limit),
      total_considered: ordered.length,
      limit,
    })
  }

  async membership(targetType: string, targetId: string, options: CommanderQueueOptions = {}): Promise<CommanderQueueKind[]> {
    if (typeof targetType !== "string" || !targetType.trim()) throw new Error("commander queue targetType is required")
    if (typeof targetId !== "string" || !targetId.trim()) throw new Error("commander queue targetId is required")
    const staleAfterMs = readStaleAfterMs(options.staleAfterMs)
    const memberships: CommanderQueueKind[] = []
    for (const queue of COMMANDER_QUEUE_KINDS) {
      const items = await this.collect(queue, staleAfterMs)
      const cleanTargetId = redactText(targetId.trim())
      if (items.some((item) => item.target_type === targetType && item.target_id === cleanTargetId)) memberships.push(queue)
    }
    return memberships
  }

  private async collect(queue: CommanderQueueKind, staleAfterMs: number): Promise<CommanderQueueItem[]> {
    const [reviews, proposals, bundles, drafts] = await Promise.all([
      this.reviewRegistry.listAllReviewRequests(),
      this.proposalRegistry.listAllProposals(),
      this.proposalBundleRegistry.listAllBundles(),
      this.commanderPlaybookDraftRegistry.listAllDrafts(),
    ])
    switch (queue) {
      case "needs_review":
        return reviews.filter((review) => review.status === "pending").map((review) => reviewItem(queue, review))
      case "ready_to_apply":
        return this.applyPreviewItems(queue, proposals, bundles, drafts, true)
      case "blocked":
        return this.applyPreviewItems(queue, proposals, bundles, drafts, false)
      case "failed_apply":
        return [
          ...proposals.filter((proposal) => proposal.status === "approved" && proposal.failure_reason).map((proposal) => proposalItem(queue, proposal, { blockers: [proposal.failure_reason!] })),
          ...bundles.filter((bundle) => bundle.failure_reason && bundle.status !== "cancelled" && bundle.status !== "applied").map((bundle) => bundleItem(queue, bundle, { blockers: [bundle.failure_reason!] })),
        ]
      case "recently_applied":
        return [
          ...proposals.filter((proposal) => proposal.status === "applied").map((proposal) => proposalItem(queue, proposal)),
          ...bundles.filter((bundle) => bundle.status === "applied").map((bundle) => bundleItem(queue, bundle)),
        ]
      case "drafts_needing_review":
        return this.draftsNeedingReview(queue, drafts, proposals)
      case "bundles_needing_review":
        return this.bundlesNeedingReview(queue, bundles, proposals)
      case "stale_open":
        return this.staleOpen(queue, staleAfterMs, reviews, proposals, bundles, drafts)
    }
  }

  private async applyPreviewItems(queue: CommanderQueueKind, proposals: CommanderProposal[], bundles: CommanderProposalBundle[], drafts: CommanderPlaybookDraft[], ready: boolean): Promise<CommanderQueueItem[]> {
    const out: CommanderQueueItem[] = []
    for (const proposal of proposals) {
      if (isTerminalProposal(proposal)) continue
      const preview = await this.applyService.preview({ target_type: "proposal", target_id: proposal.proposal_id })
      if (preview.ready_to_apply === ready) out.push(proposalItem(queue, proposal, { blockers: preview.blockers, priority: ready ? "high" : "normal" }))
    }
    for (const bundle of bundles) {
      if (isTerminalBundle(bundle)) continue
      const preview = await this.applyService.preview({ target_type: "bundle", target_id: bundle.bundle_id })
      if (preview.ready_to_apply === ready) out.push(bundleItem(queue, bundle, { blockers: preview.blockers, priority: ready ? "high" : "normal" }))
    }
    for (const draft of drafts) {
      if (isTerminalDraft(draft)) continue
      const preview = await this.applyService.preview({ target_type: "draft", target_id: draft.draft_id })
      if (preview.ready_to_apply === ready) out.push(draftItem(queue, draft, { blockers: preview.blockers, priority: ready ? "high" : "normal" }))
    }
    return out
  }

  private draftsNeedingReview(queue: CommanderQueueKind, drafts: CommanderPlaybookDraft[], proposals: CommanderProposal[]): CommanderQueueItem[] {
    const proposalById = new Map(proposals.map((proposal) => [proposal.proposal_id, proposal]))
    return drafts.flatMap((draft) => {
      const missing = draft.proposal_ids.filter((proposalId) => !proposalById.get(proposalId)?.review_id)
      if (missing.length === 0 || draft.status === "cancelled") return []
      return [draftItem(queue, draft, {
        blockers: missing.map((proposalId) => `proposal ${proposalId} has no linked review`),
        priority: "high",
      })]
    })
  }

  private bundlesNeedingReview(queue: CommanderQueueKind, bundles: CommanderProposalBundle[], proposals: CommanderProposal[]): CommanderQueueItem[] {
    const proposalById = new Map(proposals.map((proposal) => [proposal.proposal_id, proposal]))
    return bundles.flatMap((bundle) => {
      if (bundle.status === "cancelled" || bundle.status === "applied") return []
      const blockers = bundle.proposal_ids.flatMap((proposalId) => {
        const proposal = proposalById.get(proposalId)
        if (!proposal) return [`missing proposal: ${proposalId}`]
        if (!proposal.review_id) return [`proposal ${proposalId} has no linked review`]
        if (proposal.status === "proposed") return [`proposal ${proposalId} status is proposed`]
        return []
      })
      if (blockers.length === 0) return []
      return [bundleItem(queue, bundle, { blockers, priority: "high" })]
    })
  }

  private staleOpen(queue: CommanderQueueKind, staleAfterMs: number, reviews: ReviewRequest[], proposals: CommanderProposal[], bundles: CommanderProposalBundle[], drafts: CommanderPlaybookDraft[]): CommanderQueueItem[] {
    const threshold = this.now().getTime() - staleAfterMs
    const isStale = (createdAt?: string, updatedAt?: string) => {
      const timestamp = Date.parse(updatedAt ?? createdAt ?? "")
      return Number.isFinite(timestamp) && timestamp <= threshold
    }
    return [
      ...reviews.filter((review) => review.status === "pending" && isStale(review.created_at, review.updated_at)).map((review) => reviewItem(queue, review, { priority: "normal" })),
      ...proposals.filter((proposal) => ["proposed", "review_requested", "approved"].includes(proposal.status) && isStale(proposal.created_at, proposal.updated_at)).map((proposal) => proposalItem(queue, proposal, { priority: "normal" })),
      ...bundles.filter((bundle) => ["open", "review_requested", "partially_approved", "approved"].includes(bundle.status) && isStale(bundle.created_at, bundle.updated_at)).map((bundle) => bundleItem(queue, bundle, { priority: "normal" })),
      ...drafts.filter((draft) => draft.status !== "cancelled" && isStale(draft.created_at, draft.updated_at)).map((draft) => draftItem(queue, draft, { priority: "normal" })),
    ]
  }
}

function isTerminalProposal(proposal: CommanderProposal): boolean {
  return proposal.status === "applied" || proposal.status === "rejected" || proposal.status === "cancelled"
}

function isTerminalBundle(bundle: CommanderProposalBundle): boolean {
  return bundle.status === "applied" || bundle.status === "cancelled"
}

function isTerminalDraft(draft: CommanderPlaybookDraft): boolean {
  return draft.status === "cancelled"
}

function reviewItem(queue: CommanderQueueKind, review: ReviewRequest, extra: Partial<CommanderQueueItem> = {}): CommanderQueueItem {
  return compactItem({
    queue,
    target_type: "review",
    target_id: review.review_id,
    title: review.title,
    summary: review.summary,
    status: review.status,
    priority: "high",
    related_ids: relatedIds({
      review_id: [review.review_id],
      mission_id: optionalArray(review.mission_id),
      claim_id: optionalArray(review.claim_id),
      result_id: optionalArray(review.result_id),
    }),
    created_at: review.created_at,
    updated_at: review.updated_at,
    ...extra,
  })
}

function proposalItem(queue: CommanderQueueKind, proposal: CommanderProposal, extra: Partial<CommanderQueueItem> = {}): CommanderQueueItem {
  return compactItem({
    queue,
    target_type: "proposal",
    target_id: proposal.proposal_id,
    title: proposal.title,
    summary: proposal.summary,
    status: proposal.status,
    priority: proposal.status === "approved" ? "high" : "normal",
    related_ids: relatedIds({
      proposal_id: [proposal.proposal_id],
      review_id: optionalArray(proposal.review_id),
      mission_id: optionalArray(proposal.mission_id),
      claim_id: optionalArray(proposal.claim_id),
      result_id: optionalArray(proposal.result_id),
    }),
    created_at: proposal.created_at,
    updated_at: proposal.updated_at ?? proposal.applied_at,
    ...extra,
  })
}

function bundleItem(queue: CommanderQueueKind, bundle: CommanderProposalBundle, extra: Partial<CommanderQueueItem> = {}): CommanderQueueItem {
  return compactItem({
    queue,
    target_type: "bundle",
    target_id: bundle.bundle_id,
    title: bundle.title,
    summary: bundle.summary,
    status: bundle.status,
    priority: bundle.status === "approved" ? "high" : "normal",
    related_ids: relatedIds({
      bundle_id: [bundle.bundle_id],
      proposal_id: bundle.proposal_ids,
    }),
    created_at: bundle.created_at,
    updated_at: bundle.updated_at ?? bundle.applied_at,
    ...extra,
  })
}

function draftItem(queue: CommanderQueueKind, draft: CommanderPlaybookDraft, extra: Partial<CommanderQueueItem> = {}): CommanderQueueItem {
  return compactItem({
    queue,
    target_type: "draft",
    target_id: draft.draft_id,
    title: draft.playbook_id,
    summary: Object.entries(draft.field_values).map(([key, value]) => `${key}=${value}`).join("; ") || "playbook draft",
    status: draft.status,
    priority: "normal",
    related_ids: relatedIds({
      draft_id: [draft.draft_id],
      proposal_id: draft.proposal_ids,
      bundle_id: optionalArray(draft.bundle_id),
      review_id: draft.review_ids ?? [],
    }),
    created_at: draft.created_at,
    updated_at: draft.updated_at,
    ...extra,
  })
}

function compactItem(item: CommanderQueueItem): CommanderQueueItem {
  return {
    ...item,
    target_id: redactText(item.target_id),
    title: bounded(item.title, TITLE_LIMIT),
    summary: bounded(item.summary, SUMMARY_LIMIT),
    status: redactText(item.status),
    related_ids: relatedIds(item.related_ids),
    blockers: item.blockers?.map((blocker) => bounded(blocker, BLOCKER_LIMIT)).slice(0, 10),
  }
}

function relatedIds(value: Record<string, string[] | undefined>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [key, ids] of Object.entries(value)) {
    const clean = (ids ?? []).filter(Boolean).map((id) => redactText(id)).slice(0, 50)
    if (clean.length > 0) out[key] = clean
  }
  return out
}

function optionalArray(value?: string): string[] {
  return value ? [value] : []
}

function bounded(value: string, max: number): string {
  const clean = redactText(value)
  return clean.length > max ? `${clean.slice(0, max)}...` : clean
}

function readQueueKind(value: unknown): CommanderQueueKind {
  if (typeof value !== "string" || !QUEUE_KIND_SET.has(value as CommanderQueueKind)) throw new Error("commander queue kind is invalid")
  return value as CommanderQueueKind
}

export function readCommanderQueueKind(value: unknown): CommanderQueueKind {
  return readQueueKind(value)
}

export function readCommanderQueueLimit(value: unknown): number {
  return readLimit(value)
}

export function readCommanderQueueStaleAfterMs(value: unknown): number | undefined {
  if (value === undefined) return undefined
  return readStaleAfterMs(value)
}

function readLimit(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error("commander queue limit must be a positive integer")
  return Math.min(Number(value), MAX_LIMIT)
}

function readStaleAfterMs(value: unknown): number {
  if (value === undefined) return DEFAULT_STALE_AFTER_MS
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error("commander queue staleAfterMs must be a positive integer")
  return Number(value)
}

function orderQueueItems(queue: CommanderQueueKind, items: CommanderQueueItem[]): CommanderQueueItem[] {
  const direction = queue === "recently_applied" || queue === "ready_to_apply" || queue === "blocked" || queue === "failed_apply" ? -1 : 1
  return items.slice().sort((a, b) => {
    const byTime = direction * (timeKey(a) - timeKey(b))
    if (byTime !== 0) return byTime
    const byPriority = priorityRank(b.priority) - priorityRank(a.priority)
    if (byPriority !== 0) return byPriority
    return `${a.target_type}:${a.target_id}`.localeCompare(`${b.target_type}:${b.target_id}`)
  })
}

function timeKey(item: CommanderQueueItem): number {
  const timestamp = Date.parse(item.updated_at ?? item.created_at ?? "")
  return Number.isFinite(timestamp) ? timestamp : 0
}

function priorityRank(value: CommanderQueueItem["priority"]): number {
  if (value === "high") return 2
  if (value === "normal") return 1
  return 0
}

function newestIso(left?: string, right?: string): string | undefined {
  if (!right) return left
  if (!left) return right
  return Date.parse(right) > Date.parse(left) ? right : left
}
