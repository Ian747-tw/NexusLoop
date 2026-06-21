import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import type { MissionRegistry } from "../missions/mission-registry"
import type { ProposalRegistry } from "../missions/proposal-registry"
import type { ReviewRegistry } from "../missions/review-registry"
import { redactText, redactValue } from "../security/redaction"
import type { OpenCodeHandoffResult } from "./opencode-handoff-types"
import type {
  OpenCodeHandoffFollowup,
  OpenCodeHandoffFollowupCommand,
  OpenCodeHandoffFollowupQueue,
  OpenCodeHandoffFollowupQueueKind,
  OpenCodeHandoffFollowupStatus,
  OpenCodeHandoffFollowupSummary,
} from "./opencode-handoff-followup-types"

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000

interface OpenCodeHandoffFollowupServiceOptions {
  eventStore: EventStore
  proposalRegistry: ProposalRegistry
  reviewRegistry: ReviewRegistry
  missionRegistry: MissionRegistry
  now?: () => Date
}

type HandoffSeed =
  | { kind: "created"; handoff: OpenCodeHandoffResult }
  | {
      kind: "failed"
      handoff_id: string
      proposal_id: string
      review_id?: string
      mission_id?: string
      intent_id?: string
      source_cycle_id?: string
      source_synthesis_id?: string
      evidence_ids: string[]
      requested_by?: string
      updated_at: string
    }
  | {
      kind: "started"
      handoff_id: string
      proposal_id: string
      review_id?: string
      source_cycle_id?: string
      source_synthesis_id?: string
      evidence_ids: string[]
      updated_at: string
    }

export class OpenCodeHandoffFollowupService {
  private readonly eventStore: EventStore
  private readonly proposalRegistry: ProposalRegistry
  private readonly reviewRegistry: ReviewRegistry
  private readonly missionRegistry: MissionRegistry
  private readonly now: () => Date

  constructor(options: OpenCodeHandoffFollowupServiceOptions) {
    this.eventStore = options.eventStore
    this.proposalRegistry = options.proposalRegistry
    this.reviewRegistry = options.reviewRegistry
    this.missionRegistry = options.missionRegistry
    this.now = options.now ?? (() => new Date())
  }

  async get(handoffId: string, options: { staleAfterMs?: number } = {}): Promise<OpenCodeHandoffFollowup | null> {
    const id = cleanRequiredString(handoffId, "handoff_id")
    const staleAfterMs = readStaleAfterMs(options.staleAfterMs)
    return redactValue((await this.all(staleAfterMs)).find((item) => item.handoff_id === id) ?? null)
  }

  async getByProposal(proposalId: string, options: { staleAfterMs?: number } = {}): Promise<OpenCodeHandoffFollowup | null> {
    const id = cleanRequiredString(proposalId, "proposal_id")
    const staleAfterMs = readStaleAfterMs(options.staleAfterMs)
    return redactValue((await this.all(staleAfterMs)).slice().reverse().find((item) => item.proposal_id === id) ?? null)
  }

  async list(options: { limit?: number; staleAfterMs?: number } = {}): Promise<OpenCodeHandoffFollowup[]> {
    const limit = readLimit(options.limit)
    const staleAfterMs = readStaleAfterMs(options.staleAfterMs)
    return redactValue((await this.all(staleAfterMs)).slice().reverse().slice(0, limit))
  }

  async summary(options: { staleAfterMs?: number } = {}): Promise<OpenCodeHandoffFollowupSummary> {
    const staleAfterMs = readStaleAfterMs(options.staleAfterMs)
    const items = await this.all(staleAfterMs)
    return redactValue({
      sent_count: items.filter((item) => item.followup_status === "sent").length,
      running_count: items.filter((item) => item.followup_status === "claimed" || item.followup_status === "running").length,
      result_submitted_count: items.filter((item) => item.followup_status === "result_submitted").length,
      completed_count: items.filter((item) => item.followup_status === "completed").length,
      failed_count: items.filter((item) => item.followup_status === "failed" || item.followup_status === "cancelled" || item.followup_status === "handoff_failed").length,
      blocked_count: items.filter((item) => item.followup_status === "blocked" || item.followup_status === "unknown").length,
      stale_count: items.filter((item) => isStale(item, staleAfterMs, this.now())).length,
      last_handoff_id: items.at(-1)?.handoff_id,
    })
  }

  async queue(queue: OpenCodeHandoffFollowupQueueKind, options: { limit?: number; staleAfterMs?: number } = {}): Promise<OpenCodeHandoffFollowupQueue> {
    const cleanQueue = readQueue(queue)
    const limit = readLimit(options.limit)
    const staleAfterMs = readStaleAfterMs(options.staleAfterMs)
    const all = await this.all(staleAfterMs)
    const items = all.filter((item) => inQueue(item, cleanQueue, staleAfterMs, this.now())).reverse().slice(0, limit)
    return redactValue({ queue: cleanQueue, items, total_considered: all.length, limit })
  }

  private async all(staleAfterMs = DEFAULT_STALE_AFTER_MS): Promise<OpenCodeHandoffFollowup[]> {
    const seeds = await this.seeds()
    const out: OpenCodeHandoffFollowup[] = []
    for (const seed of seeds) out.push(await this.build(seed, staleAfterMs))
    return out.sort((a, b) => compareText(a.updated_at ?? "", b.updated_at ?? "") || compareText(a.handoff_id, b.handoff_id))
  }

  private async build(seed: HandoffSeed, staleAfterMs: number): Promise<OpenCodeHandoffFollowup> {
    const handoff = seed.kind === "created" ? seed.handoff : null
    const seedHandoffId = seed.kind === "created" ? seed.handoff.handoff_id : seed.handoff_id
    const seedUpdatedAt = seed.kind === "created" ? seed.handoff.created_at : seed.updated_at
    const proposalId = seed.kind === "created" ? seed.handoff.proposal_id : seed.proposal_id
    const reviewId = seed.kind === "created" ? seed.handoff.review_id : seed.review_id
    const missionId = handoff?.mission_id ?? (seed.kind === "failed" ? seed.mission_id : undefined)
    const intentId = handoff?.intent_id ?? (seed.kind === "failed" ? seed.intent_id : undefined)
    const blockers: string[] = []
    const proposal = await this.proposalRegistry.getProposal(proposalId)
    if (!proposal) blockers.push(`commander proposal not found: ${proposalId}`)
    const review = reviewId ? await this.reviewRegistry.getReviewRequest(reviewId) : null
    if (reviewId && !review) blockers.push(`review request not found: ${reviewId}`)
    const mission = missionId ? await this.missionRegistry.getMission(missionId) : null
    if (seed.kind === "created" && missionId && !mission) blockers.push(`mission not found: ${missionId}`)
    const claims = missionId ? await this.missionRegistry.listMissionClaims(missionId) : []
    const progress = missionId ? await this.missionRegistry.listMissionProgress(missionId) : []
    const results = missionId ? await this.missionRegistry.listMissionResults(missionId) : []
    const activeClaim = claims.find((claim) => claim.status === "active")
    const latestProgress = progress.at(-1)
    const latestResult = results.at(-1)
    const status = seed.kind === "failed"
      ? "handoff_failed"
      : seed.kind === "started"
        ? "blocked"
        : deriveStatus(mission?.status, activeClaim?.claim_id, progress.length, results.length, blockers)
    const updatedAt = latestResult?.created_at ?? latestProgress?.created_at ?? mission?.updated_at ?? seedUpdatedAt
    const followup: OpenCodeHandoffFollowup = {
      handoff_id: seedHandoffId,
      proposal_id: proposalId,
      review_id: reviewId,
      mission_id: missionId,
      intent_id: intentId,
      followup_status: status,
      handoff_sent: handoff?.sent === true,
      proposal_status: proposal?.status,
      review_status: review?.status,
      mission_status: mission?.status,
      active_claim_id: activeClaim?.claim_id,
      latest_progress_id: latestProgress?.progress_id,
      latest_result_id: latestResult?.result_id,
      result_count: results.length,
      progress_count: progress.length,
      blockers: blockers.map((item) => redactText(item)),
      suggested_commands: suggestedCommands(seedHandoffId, missionId, activeClaim?.claim_id, latestProgress?.progress_id, latestResult?.result_id),
      source_cycle_id: handoff?.source_cycle_id ?? (seed.kind === "started" || seed.kind === "failed" ? seed.source_cycle_id : undefined),
      source_synthesis_id: handoff?.source_synthesis_id ?? (seed.kind === "started" || seed.kind === "failed" ? seed.source_synthesis_id : undefined),
      evidence_ids: handoff?.evidence_ids ?? (seed.kind === "started" || seed.kind === "failed" ? seed.evidence_ids : []),
      updated_at: updatedAt,
    }
    if (followup.followup_status !== "completed" && followup.followup_status !== "failed" && followup.followup_status !== "cancelled" && isStale(followup, staleAfterMs, this.now())) {
      followup.blockers = [...followup.blockers, "handoff follow-up is stale"]
    }
    return redactValue(followup)
  }

  private async seeds(): Promise<HandoffSeed[]> {
    const map = new Map<string, HandoffSeed>()
    for (const event of await this.eventStore.readAll()) {
      if (event.kind === "opencode_handoff_started") {
        const started = readStarted(event)
        if (!map.has(started.handoff_id)) map.set(started.handoff_id, started)
      } else if (event.kind === "opencode_handoff_failed") {
        const failed = readFailed(event)
        const started = map.get(failed.handoff_id)
        if (started?.kind === "started") {
          failed.source_cycle_id = started.source_cycle_id
          failed.source_synthesis_id = started.source_synthesis_id
          failed.evidence_ids = started.evidence_ids
        }
        map.set(failed.handoff_id, failed)
      } else if (event.kind === "opencode_handoff_created" && isRecord(event.handoff)) {
        const handoff = readHandoffResult(event.handoff)
        map.set(handoff.handoff_id, { kind: "created", handoff })
      }
    }
    return [...map.values()]
  }
}

function deriveStatus(missionStatus: string | undefined, activeClaimId: string | undefined, progressCount: number, resultCount: number, blockers: string[]): OpenCodeHandoffFollowupStatus {
  if (blockers.length > 0) return "blocked"
  if (!missionStatus) return "unknown"
  if (missionStatus === "completed" || missionStatus === "failed" || missionStatus === "cancelled") return missionStatus
  if (resultCount > 0) return "result_submitted"
  if (missionStatus === "running" || progressCount > 0) return "running"
  if (missionStatus === "claimed" || activeClaimId) return "claimed"
  if (missionStatus === "sent") return "sent"
  return "unknown"
}

function suggestedCommands(handoffId: string, missionId?: string, claimId?: string, progressId?: string, resultId?: string): OpenCodeHandoffFollowupCommand[] {
  const commands: OpenCodeHandoffFollowupCommand[] = [
    { label: "Show handoff", command: `/handoff-show ${handoffId}`, command_type: "read" },
    { label: "Show follow-up", command: `/handoff-followup ${handoffId}`, command_type: "read" },
  ]
  if (missionId) {
    commands.push(
      { label: "Show mission", command: `/mission ${missionId}`, command_type: "read" },
      { label: "List claims", command: `/claims ${missionId}`, command_type: "read" },
      { label: "List progress", command: `/progress ${missionId}`, command_type: "read" },
      { label: "List results", command: `/results ${missionId}`, command_type: "read" },
      { label: "Audit mission", command: `/audit mission ${missionId}`, command_type: "read" },
    )
  }
  if (claimId) commands.push({ label: "Open claim", command: `/open claim ${claimId}`, command_type: "read" })
  if (progressId) commands.push({ label: "Open progress", command: `/open progress ${progressId}`, command_type: "read" })
  if (resultId) commands.push({ label: "Open result", command: `/open result ${resultId}`, command_type: "read" })
  return commands
}

function inQueue(item: OpenCodeHandoffFollowup, queue: OpenCodeHandoffFollowupQueueKind, staleAfterMs: number, now: Date): boolean {
  if (queue === "stale") return isStale(item, staleAfterMs, now)
  if (queue === "active") return item.followup_status === "sent" || item.followup_status === "claimed" || item.followup_status === "running"
  if (queue === "needs_result_review") return item.followup_status === "result_submitted"
  if (queue === "completed") return item.followup_status === "completed"
  if (queue === "failed") return item.followup_status === "failed" || item.followup_status === "cancelled" || item.followup_status === "handoff_failed"
  return item.followup_status === "blocked" || item.followup_status === "unknown"
}

function isStale(item: OpenCodeHandoffFollowup, staleAfterMs: number, now: Date): boolean {
  if (item.followup_status === "completed" || item.followup_status === "failed" || item.followup_status === "cancelled" || item.followup_status === "handoff_failed") return false
  if (!item.updated_at) return false
  const timestamp = Date.parse(item.updated_at)
  return Number.isFinite(timestamp) && now.getTime() - timestamp >= staleAfterMs
}

function readStarted(event: JsonlEvent): Extract<HandoffSeed, { kind: "started" }> {
  return {
    kind: "started",
    handoff_id: cleanRequiredString(event.handoff_id, "handoff_id"),
    proposal_id: cleanRequiredString(event.proposal_id, "proposal_id"),
    review_id: optionalString(event.review_id),
    source_cycle_id: optionalString(event.source_cycle_id),
    source_synthesis_id: optionalString(event.source_synthesis_id),
    evidence_ids: stringArray(event.evidence_ids),
    updated_at: cleanRequiredString(event.started_at, "started_at"),
  }
}

function readFailed(event: JsonlEvent): Extract<HandoffSeed, { kind: "failed" }> {
  return {
    kind: "failed",
    handoff_id: cleanRequiredString(event.handoff_id, "handoff_id"),
    proposal_id: cleanRequiredString(event.proposal_id, "proposal_id"),
    review_id: optionalString(event.review_id),
    mission_id: optionalString(event.mission_id),
    intent_id: optionalString(event.intent_id),
    source_cycle_id: undefined,
    source_synthesis_id: undefined,
    evidence_ids: [],
    requested_by: optionalString(event.requested_by),
    updated_at: cleanRequiredString(event.failed_at, "failed_at"),
  }
}

function readHandoffResult(value: Record<string, unknown>): OpenCodeHandoffResult {
  return {
    handoff_id: cleanRequiredString(value.handoff_id, "handoff_id"),
    proposal_id: cleanRequiredString(value.proposal_id, "proposal_id"),
    review_id: optionalString(value.review_id),
    mission_id: optionalString(value.mission_id),
    intent_id: optionalString(value.intent_id),
    adapter_session_id: optionalString(value.adapter_session_id),
    objective_preview: redactText(cleanRequiredString(value.objective_preview, "objective_preview")),
    sent: value.sent === true,
    dry_run: value.dry_run === true,
    created_at: cleanRequiredString(value.created_at, "created_at"),
    requested_by: redactText(cleanRequiredString(value.requested_by, "requested_by")),
    source_cycle_id: optionalString(value.source_cycle_id),
    source_synthesis_id: optionalString(value.source_synthesis_id),
    evidence_ids: stringArray(value.evidence_ids),
  }
}

function readLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_LIMIT
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error("handoff follow-up limit must be a positive integer")
  return Math.min(Number(value), MAX_LIMIT)
}

function readStaleAfterMs(value: unknown): number {
  if (value === undefined) return DEFAULT_STALE_AFTER_MS
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error("staleAfterMs must be a positive integer")
  return Number(value)
}

export function readOpenCodeHandoffFollowupQueueKind(value: unknown): OpenCodeHandoffFollowupQueueKind {
  return readQueue(value)
}

function readQueue(value: unknown): OpenCodeHandoffFollowupQueueKind {
  if (value === "active" || value === "needs_result_review" || value === "completed" || value === "failed" || value === "blocked" || value === "stale") return value
  throw new Error("handoff follow-up queue is invalid")
}

function cleanRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return redactText(value.trim())
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !value.trim()) return undefined
  return redactText(value.trim())
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => redactText(item.trim())).slice(0, 20)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
