import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import type { OpenCodeResultReviewPacketService } from "../opencode/opencode-result-review-packet-service"
import { redactText, redactValue } from "../security/redaction"
import type {
  CommanderExecutorReviewCommand,
  CommanderExecutorReviewFinding,
  CommanderExecutorReviewResult,
} from "./commander-executor-review-types"
import type {
  ExecutorReviewProposalDraftCandidate,
  ExecutorReviewProposalDraftCommand,
  ExecutorReviewProposalDraftPreview,
  ExecutorReviewProposalDraftPreviewInput,
  ExecutorReviewProposalDraftPreviewStatus,
  ExecutorReviewProposalDraftSummary,
} from "./executor-review-proposal-draft-types"

const MAX_TEXT = 240
const MAX_ROWS = 12

export type ExecutorReviewProposalDraftServiceOptions = {
  eventStore: EventStore
  packetService?: OpenCodeResultReviewPacketService
  now?: () => Date
}

export class ExecutorReviewProposalDraftService {
  private readonly now: () => Date

  constructor(private readonly options: ExecutorReviewProposalDraftServiceOptions) {
    this.now = options.now ?? (() => new Date())
  }

  async preview(input: ExecutorReviewProposalDraftPreviewInput = {}): Promise<ExecutorReviewProposalDraftPreview> {
    const normalized = normalizeInput(input)
    const generatedAt = this.now().toISOString()
    const reviews = await this.reviews()
    const review = selectReview(reviews, normalized)
    const blockers: string[] = []
    const warnings = ["draft preview does not create proposals, request reviews, apply changes, call providers, or launch OpenCode"]
    if (!review) {
      blockers.push(hasExplicitTarget(normalized) ? "requested Commander executor review was not found" : "no Commander executor review records were found")
    }

    const packet = review && normalized.include_packet !== false && this.options.packetService
      ? await this.options.packetService.preview({
        handoff_id: review.handoff_id,
        mission_id: review.mission_id,
        result_id: review.result_id,
        proposal_id: review.proposal_id,
        include_authority: normalized.include_authority !== false,
      }).catch(() => null)
      : null

    if (review?.status && review.status !== "succeeded") blockers.push(`executor review status is ${review.status}; draft preview requires succeeded`)
    if (review?.decision && !draftableDecisions.has(review.decision)) blockers.push(`executor review decision ${review.decision} is not draftable`)
    if (review && review.confidence < 0.5) blockers.push("executor review confidence is below draft threshold")
    const hasBlockerFinding = review?.findings.some((finding) => finding.severity === "blocker") === true
    if (hasBlockerFinding) warnings.push("blocker findings suppress mission result acceptance drafts")

    const candidates = review && blockers.length === 0
      ? candidatesForReview(review, packet, normalized.limit ?? MAX_ROWS, hasBlockerFinding)
      : []
    const status = previewStatus(review, blockers, candidates)
    return redactValue({
      preview_id: previewId(review, generatedAt),
      status,
      review_id: review?.review_id,
      packet_id: review?.packet_id,
      review_decision: review?.decision,
      review_confidence: review?.confidence,
      can_create_proposals_now: false,
      candidates,
      blockers: boundList(blockers),
      warnings: boundList(warnings),
      recommended_commands: recommendedCommands(review).slice(0, MAX_ROWS),
      generated_at: generatedAt,
      redacted_summary_preview: summaryPreview(status, review, candidates, blockers),
    })
  }

  async summary(input: { limit?: number } = {}): Promise<ExecutorReviewProposalDraftSummary> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100))
    const reviews = (await this.reviews()).slice(0, limit)
    let draftable = 0
    let blocked = 0
    let candidateCount = 0
    for (const review of reviews) {
      const hasBlockerFinding = review.findings.some((finding) => finding.severity === "blocker")
      const candidates = review.status === "succeeded" && draftableDecisions.has(review.decision) && review.confidence >= 0.5
        ? candidatesForReview(review, null, MAX_ROWS, hasBlockerFinding)
        : []
      if (candidates.length > 0) draftable += 1
      else blocked += 1
      candidateCount += candidates.length
    }
    return redactValue({
      total_reviews_considered: reviews.length,
      draftable_review_count: draftable,
      blocked_review_count: blocked,
      candidate_count: candidateCount,
      latest_review_id: reviews[0]?.review_id,
      generated_at: this.now().toISOString(),
    })
  }

  private async reviews(): Promise<CommanderExecutorReviewResult[]> {
    return (await this.options.eventStore.readAll())
      .filter((event) =>
        event.kind === "commander_executor_review_succeeded"
        || event.kind === "commander_executor_review_failed"
        || event.kind === "commander_executor_review_blocked")
      .map(resultFromEvent)
      .reverse()
  }
}

export function readExecutorReviewProposalDraftPreviewInput(value: unknown): ExecutorReviewProposalDraftPreviewInput {
  if (!isRecord(value)) return {}
  return normalizeInput(value)
}

function normalizeInput(input: Record<string, unknown> = {}): ExecutorReviewProposalDraftPreviewInput {
  return {
    review_id: optional(input.review_id ?? input.reviewId),
    packet_id: optional(input.packet_id ?? input.packetId),
    mission_id: optional(input.mission_id ?? input.missionId),
    result_id: optional(input.result_id ?? input.resultId),
    handoff_id: optional(input.handoff_id ?? input.handoffId),
    proposal_id: optional(input.proposal_id ?? input.proposalId),
    limit: optionalNumber(input.limit),
    include_packet: input.include_packet === false || input.includePacket === false ? false : undefined,
    include_authority: input.include_authority === false || input.includeAuthority === false ? false : undefined,
  }
}

const draftableDecisions = new Set(["accept_result", "needs_followup", "needs_human_review"])

function selectReview(reviews: CommanderExecutorReviewResult[], input: ExecutorReviewProposalDraftPreviewInput): CommanderExecutorReviewResult | undefined {
  if (input.review_id) return reviews.find((review) => review.review_id === input.review_id)
  return reviews.find((review) =>
    (!input.packet_id || review.packet_id === input.packet_id)
    && (!input.mission_id || review.mission_id === input.mission_id)
    && (!input.result_id || review.result_id === input.result_id)
    && (!input.handoff_id || review.handoff_id === input.handoff_id)
    && (!input.proposal_id || review.proposal_id === input.proposal_id))
}

function candidatesForReview(review: CommanderExecutorReviewResult, packet: { result_summary_preview?: string; objective_preview?: string } | null, limit: number, hasBlockerFinding: boolean): ExecutorReviewProposalDraftCandidate[] {
  if (review.decision === "accept_result" && !hasBlockerFinding) {
    return [candidate(review, {
      kind: review.result_id ? "mission_result" : "mission_progress",
      title: "Draft accepted executor result",
      summary: packet?.result_summary_preview ?? review.summary,
      rationale: "Commander executor review accepted the bounded executor result packet.",
      risk: review.confidence >= 0.75 ? "low" : "medium",
    })].slice(0, limit)
  }
  if (review.decision === "needs_followup") {
    return [candidate(review, {
      kind: hasBlockerFinding ? "blocked_followup" : "followup_task",
      title: "Draft executor follow-up task",
      summary: review.summary,
      rationale: "Commander executor review requested follow-up based on review findings.",
      risk: hasRiskFinding(review) || hasBlockerFinding ? "high" : "medium",
    })].slice(0, limit)
  }
  if (review.decision === "needs_human_review") {
    return [candidate(review, {
      kind: "human_review",
      title: "Draft human review request",
      summary: review.summary,
      rationale: "Commander executor review requested human inspection before action.",
      risk: hasBlockerFinding ? "high" : "medium",
    })].slice(0, limit)
  }
  return []
}

function candidate(review: CommanderExecutorReviewResult, input: { kind: ExecutorReviewProposalDraftCandidate["draft_kind"]; title: string; summary: string; rationale: string; risk: ExecutorReviewProposalDraftCandidate["risk"] }): ExecutorReviewProposalDraftCandidate {
  const source = `${review.review_id}:${input.kind}:${review.review_hash}`
  return {
    draft_id: `draft_${sha256(source).slice(0, 16)}`,
    draft_kind: input.kind,
    title: bound(input.title),
    summary: bound(input.summary),
    rationale: bound(input.rationale),
    source_review_id: review.review_id,
    source_packet_id: review.packet_id,
    mission_id: review.mission_id,
    result_id: review.result_id,
    handoff_id: review.handoff_id,
    proposal_id: review.proposal_id,
    evidence_ids: boundList(review.evidence_ids),
    finding_ids: boundList(review.findings.map((finding) => finding.finding_id)),
    confidence: clamp(review.confidence),
    risk: input.risk,
    would_create_proposal: false,
    would_mutate_mission: false,
    recommended_commands: recommendedCommands(review),
  }
}

function recommendedCommands(review?: CommanderExecutorReviewResult): ExecutorReviewProposalDraftCommand[] {
  const commands: ExecutorReviewProposalDraftCommand[] = [
    { label: "Show executor review", command: review?.review_id ? `/executor-review-show ${review.review_id}` : "/executor-reviews", command_type: "read" },
    { label: "Show executor reviews", command: "/executor-reviews", command_type: "read" },
    { label: "Inspect result review packet", command: review?.result_id ? `/result-review-packet result=${review.result_id}` : "/result-review-packet", command_type: "read" },
    { label: "Show executor review authority", command: "/authority-show /executor-review", command_type: "read" },
    { label: "Show draft preview authority", command: "/authority-show /executor-review-draft-preview", command_type: "read" },
  ]
  if (review?.mission_id) commands.push({ label: "Inspect mission", command: `/mission ${review.mission_id}`, command_type: "read" })
  if (review?.handoff_id) commands.push({ label: "Inspect handoff", command: `/handoff-show ${review.handoff_id}`, command_type: "read" })
  return commands.map(cleanCommand).slice(0, MAX_ROWS)
}

function previewStatus(review: CommanderExecutorReviewResult | undefined, blockers: string[], candidates: ExecutorReviewProposalDraftCandidate[]): ExecutorReviewProposalDraftPreviewStatus {
  if (!review) return "unknown"
  if (review.status !== "succeeded") return "blocked"
  if (review.confidence < 0.5) return "inconclusive"
  if (blockers.length > 0) return review.status === "succeeded" ? "needs_review" : "blocked"
  return candidates.length > 0 ? "ready" : "needs_review"
}

function summaryPreview(status: ExecutorReviewProposalDraftPreviewStatus, review: CommanderExecutorReviewResult | undefined, candidates: ExecutorReviewProposalDraftCandidate[], blockers: string[]): string {
  if (!review) return "No Commander executor review is available for draft preview."
  if (blockers.length > 0) return blockers[0] ?? `Draft preview is ${status}.`
  return `${candidates.length} draft candidate(s) derived from executor review ${review.review_id}; no proposal was created.`
}

function resultFromEvent(event: JsonlEvent): CommanderExecutorReviewResult {
  return redactValue({
    review_id: String(event.review_id ?? ""),
    packet_id: String(event.packet_id ?? ""),
    packet_status: String(event.packet_status ?? "unknown"),
    status: event.status === "succeeded" || event.status === "failed" || event.status === "blocked" ? event.status : "blocked",
    provider_kind: String(event.provider_kind ?? ""),
    decision: readDecision(event.decision),
    confidence: typeof event.confidence === "number" ? clamp(event.confidence) : 0,
    summary: bound(String(event.summary ?? event.error ?? "")),
    findings: Array.isArray(event.findings) ? event.findings.map(readFinding).slice(0, MAX_ROWS) : [],
    evidence_ids: boundList(event.evidence_ids),
    recommended_commands: Array.isArray(event.recommended_commands) ? event.recommended_commands.map(readCommand).slice(0, MAX_ROWS) : [],
    error: optional(event.error),
    started_at: String(event.started_at ?? event.timestamp ?? ""),
    completed_at: String(event.completed_at ?? event.timestamp ?? ""),
    requested_by: String(event.requested_by ?? "operator"),
    review_hash: String(event.review_hash ?? ""),
    handoff_id: optional(event.handoff_id),
    mission_id: optional(event.mission_id),
    result_id: optional(event.result_id),
    proposal_id: optional(event.proposal_id),
  }) as CommanderExecutorReviewResult
}

function readFinding(value: unknown): CommanderExecutorReviewFinding {
  const record = isRecord(value) ? value : {}
  return {
    finding_id: bound(String(record.finding_id ?? "finding_unknown")),
    severity: record.severity === "info" || record.severity === "warning" || record.severity === "risk" || record.severity === "blocker" ? record.severity : "warning",
    title: bound(String(record.title ?? "Finding")),
    summary: bound(String(record.summary ?? "")),
    evidence_ids: boundList(record.evidence_ids),
    recommended_commands: Array.isArray(record.recommended_commands) ? record.recommended_commands.map(readCommand).slice(0, MAX_ROWS) : [],
  }
}

function readCommand(value: unknown): CommanderExecutorReviewCommand {
  const record = isRecord(value) ? value : {}
  return {
    label: bound(String(record.label ?? "Inspect")),
    command: bound(String(record.command ?? "/executor-reviews")),
    command_type: record.command_type === "write" ? "write" : "read",
    requires_active_runtime: record.requires_active_runtime === true,
    notes: optional(record.notes),
  }
}

function hasRiskFinding(review: CommanderExecutorReviewResult): boolean {
  return review.findings.some((finding) => finding.severity === "risk")
}

function hasExplicitTarget(input: ExecutorReviewProposalDraftPreviewInput): boolean {
  return Boolean(input.review_id || input.packet_id || input.mission_id || input.result_id || input.handoff_id || input.proposal_id)
}

function previewId(review: CommanderExecutorReviewResult | undefined, generatedAt: string): string {
  return `executor_review_draft_${sha256(`${review?.review_id ?? "none"}:${generatedAt}`).slice(0, 16)}`
}

function cleanCommand(value: ExecutorReviewProposalDraftCommand): ExecutorReviewProposalDraftCommand {
  return {
    label: bound(value.label),
    command: bound(value.command),
    command_type: value.command_type === "write" ? "write" : "read",
    requires_active_runtime: value.requires_active_runtime === true,
    notes: value.notes ? bound(value.notes) : undefined,
  }
}

function readDecision(value: unknown): CommanderExecutorReviewResult["decision"] {
  if (value === "accept_result" || value === "needs_followup" || value === "needs_human_review" || value === "blocked" || value === "inconclusive") return value
  return "inconclusive"
}

function optional(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? bound(trimmed) : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 100) : undefined
}

function bound(value: string, limit = MAX_TEXT): string {
  return redactText(value).replace(/\s+/g, " ").trim().slice(0, limit)
}

function boundList(value: unknown, limit = MAX_ROWS): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => bound(item)).filter(Boolean).slice(0, limit) : []
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
