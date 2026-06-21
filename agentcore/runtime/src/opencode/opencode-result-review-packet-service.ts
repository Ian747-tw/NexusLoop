import { CommandAuthorityService } from "../authority/command-authority-service"
import type { MissionProgress, MissionRecord, MissionResult } from "../missions/mission-types"
import type { CommanderProposal } from "../missions/proposal-types"
import type { ReviewRequest } from "../missions/review-types"
import { redactText, redactValue } from "../security/redaction"
import type { OpenCodeHandoffResult } from "./opencode-handoff-types"
import type { OpenCodeHandoffRecord } from "./opencode-handoff-types"
import type { OpenCodeHandoffFollowup, OpenCodeHandoffFollowupSummary } from "./opencode-handoff-followup-types"
import type { OpenCodeHandoffReadinessPreview, OpenCodeHandoffReadinessSummary } from "./opencode-handoff-readiness-types"
import type { OpenCodeProcessSmokeRecord } from "./opencode-process-smoke-types"
import type {
  OpenCodeResultReviewCommand,
  OpenCodeResultReviewEvidence,
  OpenCodeResultReviewPacket,
  OpenCodeResultReviewPacketInput,
  OpenCodeResultReviewPacketStatus,
  OpenCodeResultReviewSummary,
} from "./opencode-result-review-packet-types"

const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000
const MAX_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000
const MAX_TEXT = 240
const MAX_ROWS = 12

export type OpenCodeResultReviewPacketServiceOptions = {
  now?: () => Date
  authorityService?: CommandAuthorityService
  listHandoffs: (limit: number) => Promise<OpenCodeHandoffRecord[]>
  getHandoff: (handoffId: string) => Promise<OpenCodeHandoffResult | null>
  getHandoffByProposal: (proposalId: string) => Promise<OpenCodeHandoffResult | null>
  listFollowups: (options: { limit?: number; staleAfterMs?: number }) => Promise<OpenCodeHandoffFollowup[]>
  getFollowup: (handoffId: string, options?: { staleAfterMs?: number }) => Promise<OpenCodeHandoffFollowup | null>
  getFollowupByProposal: (proposalId: string, options?: { staleAfterMs?: number }) => Promise<OpenCodeHandoffFollowup | null>
  getFollowupByMission: (missionId: string, options?: { staleAfterMs?: number }) => Promise<OpenCodeHandoffFollowup | null>
  followupSummary: (options?: { staleAfterMs?: number }) => Promise<OpenCodeHandoffFollowupSummary>
  getMission: (missionId: string) => Promise<MissionRecord | null>
  listMissionProgress: (missionId: string) => Promise<MissionProgress[]>
  listMissionResults: (missionId: string) => Promise<MissionResult[]>
  getMissionResult: (resultId: string) => Promise<MissionResult | null>
  getProposal: (proposalId: string) => Promise<CommanderProposal | null>
  getReview: (reviewId: string) => Promise<ReviewRequest | null>
  readinessPreview: (input: { proposal_id?: string; mission_id?: string; handoff_id?: string; require_recent_smoke?: boolean }) => Promise<OpenCodeHandoffReadinessPreview>
  readinessSummary: () => Promise<OpenCodeHandoffReadinessSummary>
  listSmokes: (limit: number) => Promise<OpenCodeProcessSmokeRecord[]>
}

type BuildContext = {
  handoff?: OpenCodeHandoffResult | null
  followup?: OpenCodeHandoffFollowup | null
  mission?: MissionRecord | null
  progress: MissionProgress[]
  results: MissionResult[]
  result?: MissionResult | null
  proposal?: CommanderProposal | null
  review?: ReviewRequest | null
  latestSmoke?: OpenCodeProcessSmokeRecord
  readiness?: OpenCodeHandoffReadinessPreview | OpenCodeHandoffReadinessSummary
}

export class OpenCodeResultReviewPacketService {
  private readonly now: () => Date
  private readonly authorityService: CommandAuthorityService
  private readonly options: OpenCodeResultReviewPacketServiceOptions

  constructor(options: OpenCodeResultReviewPacketServiceOptions) {
    this.options = options
    this.now = options.now ?? (() => new Date())
    this.authorityService = options.authorityService ?? new CommandAuthorityService(() => this.now().toISOString())
  }

  async preview(input: OpenCodeResultReviewPacketInput = {}): Promise<OpenCodeResultReviewPacket> {
    const normalized = normalizeInput(input)
    const generatedAt = this.now().toISOString()
    const staleAfterMs = normalized.stale_after_ms ?? DEFAULT_STALE_AFTER_MS
    const evidence: OpenCodeResultReviewEvidence[] = []
    const blockers: string[] = []
    const warnings: string[] = []

    const context = await this.context(normalized, staleAfterMs)
    if (context.handoff) evidence.push(handoffEvidence(context.handoff, this.now()))
    if (context.followup) evidence.push(followupEvidence(context.followup, staleAfterMs, this.now()))
    if (context.mission) evidence.push(missionEvidence(context.mission, this.now()))
    if (context.progress.length > 0) evidence.push(progressEvidence(context.progress.at(-1)!, context.progress.length, this.now()))
    if (context.result) evidence.push(resultEvidence(context.result, this.now()))
    else if (context.results.length > 0) evidence.push(resultEvidence(context.results.at(-1)!, this.now()))
    if (context.proposal) evidence.push(proposalEvidence(context.proposal, this.now()))
    if (context.review) evidence.push(reviewEvidence(context.review, this.now()))
    if (normalized.include_authority !== false) evidence.push(...this.authorityEvidence())
    if (normalized.include_readiness !== false && context.readiness) evidence.push(readinessEvidence(context.readiness, this.now()))
    if (context.latestSmoke) evidence.push(smokeEvidence(context.latestSmoke, this.now()))

    if (!context.handoff && !context.followup && !context.mission && !context.result && !context.proposal) blockers.push("no OpenCode handoff, mission result, mission, or proposal evidence was found")
    if ((normalized.handoff_id || normalized.followup_id) && !context.handoff && !context.followup) blockers.push("requested handoff or follow-up was not found")
    if (normalized.mission_id && !context.mission) blockers.push("requested mission was not found")
    if (normalized.proposal_id && !context.proposal) blockers.push("requested proposal was not found")
    if (context.followup?.blockers?.length) blockers.push(...context.followup.blockers)
    if (context.followup && (isFailureStatus(context.followup.followup_status) || isBlockedStatus(context.followup.followup_status))) blockers.push(`handoff follow-up is ${context.followup.followup_status}`)
    if (context.handoff && !context.handoff.sent) blockers.push("handoff was not sent")
    const explicitResultMissing = Boolean(normalized.result_id && !context.result)
    if (explicitResultMissing) blockers.push("requested result was not found")
    const latestResult = explicitResultMissing ? undefined : context.result ?? context.results.at(-1)
    if (context.mission && isBlockedMissionStatus(context.mission.status)) blockers.push(`mission is ${context.mission.status}`)
    if (latestResult?.status === "rejected") blockers.push("mission result is rejected")
    blockers.push(...targetConsistencyBlockers(context, normalized, latestResult))
    if ((context.handoff || context.followup || context.mission) && !latestResult && !isFailureStatus(context.followup?.followup_status)) {
      const stale = outcomeEvidenceIsStale(context, staleAfterMs, this.now())
      if (stale) warnings.push("executor outcome evidence is stale and has no mission result")
      else warnings.push("executor outcome has no submitted mission result yet")
    }

    const status = packetStatus({ blockers, warnings, context, latestResult, staleAfterMs, now: this.now() })
    const hardBlockers = status === "needs_result" || status === "stale"
      ? []
      : status === "ready_for_commander_review"
        ? blockers.filter((blocker) => !isStaleOnlyBlocker(blocker))
        : blockers
    const packet: OpenCodeResultReviewPacket = {
      packet_id: packetId(normalized, generatedAt),
      status,
      handoff_id: context.handoff?.handoff_id ?? context.followup?.handoff_id ?? normalized.handoff_id ?? normalized.followup_id,
      followup_id: context.followup?.handoff_id ?? normalized.followup_id,
      mission_id: context.followup?.mission_id ?? context.handoff?.mission_id ?? context.mission?.mission_id ?? latestResult?.mission_id ?? normalized.mission_id,
      result_id: latestResult?.result_id ?? normalized.result_id,
      claim_id: latestResult?.claim_id ?? context.followup?.active_claim_id,
      proposal_id: context.proposal?.proposal_id ?? context.handoff?.proposal_id ?? context.followup?.proposal_id ?? normalized.proposal_id,
      review_id: context.review?.review_id ?? context.handoff?.review_id ?? context.followup?.review_id,
      title: titleFor(status, context),
      objective_preview: context.handoff?.objective_preview ?? context.mission?.objective ?? context.proposal?.summary,
      executor_summary_preview: context.followup ? `follow-up ${context.followup.followup_status}; progress=${context.followup.progress_count} results=${context.followup.result_count}` : undefined,
      result_summary_preview: latestResult?.summary,
      artifact_previews: (latestResult?.artifacts ?? []).slice(0, MAX_ROWS).map(bound),
      evidence: evidence.slice(0, MAX_ROWS),
      blockers: boundList(hardBlockers),
      warnings: boundList(warnings),
      recommended_commands: recommendedCommands(context, normalized).slice(0, MAX_ROWS),
      generated_at: generatedAt,
      redacted_summary_preview: summaryPreview(status, hardBlockers, warnings, latestResult),
    }
    return redactValue(packet)
  }

  async summary(input: Pick<OpenCodeResultReviewPacketInput, "stale_after_ms" | "limit"> = {}): Promise<OpenCodeResultReviewSummary> {
    const normalized = normalizeInput(input)
    const staleAfterMs = normalized.stale_after_ms ?? DEFAULT_STALE_AFTER_MS
    const limit = normalized.limit ?? 20
    const followups = await this.options.listFollowups({ limit, staleAfterMs })
    let ready = 0
    let needsResult = 0
    let failed = 0
    let blocked = 0
    let stale = 0
    let latestResultId: string | undefined
    for (const followup of followups) {
      const results = followup.mission_id ? await this.options.listMissionResults(followup.mission_id) : []
      const handoff = followup.handoff_id ? await this.options.getHandoff(followup.handoff_id).catch(() => null) : null
      latestResultId ??= results.at(-1)?.result_id
      const status = statusFromFollowup(followup, results.at(-1), staleAfterMs, this.now(), handoff)
      if (status === "ready_for_commander_review") ready += 1
      else if (status === "needs_result") needsResult += 1
      else if (status === "failed") failed += 1
      else if (status === "stale") stale += 1
      else if (status === "blocked") blocked += 1
    }
    const followupSummary = await this.options.followupSummary({ staleAfterMs })
    return redactValue({
      total_considered: followups.length,
      ready_count: ready,
      needs_result_count: needsResult,
      failed_count: failed,
      blocked_count: blocked,
      stale_count: stale,
      latest_handoff_id: followupSummary.last_handoff_id,
      latest_result_id: latestResultId,
      generated_at: this.now().toISOString(),
    })
  }

  private async context(input: OpenCodeResultReviewPacketInput, staleAfterMs: number): Promise<BuildContext> {
    const requestedHandoffId = input.handoff_id ?? input.followup_id
    const result = input.result_id ? await this.options.getMissionResult(input.result_id) : null
    const hasExplicitNonHandoffTarget = Boolean(input.mission_id || input.result_id || input.proposal_id)
    const proposalHandoff = !requestedHandoffId && input.proposal_id ? await this.options.getHandoffByProposal(input.proposal_id) : null
    const proposalFollowup = !requestedHandoffId && input.proposal_id && !proposalHandoff ? await this.options.getFollowupByProposal(input.proposal_id, { staleAfterMs }) : null
    const requestedMissionId = input.mission_id ?? result?.mission_id
    const missionFollowup = !requestedHandoffId && !proposalHandoff && !proposalFollowup && requestedMissionId ? await this.options.getFollowupByMission(requestedMissionId, { staleAfterMs }) : null
    const handoffId = requestedHandoffId ?? proposalHandoff?.handoff_id ?? proposalFollowup?.handoff_id ?? missionFollowup?.handoff_id
    const latestFollowupRecord = handoffId || hasExplicitNonHandoffTarget ? undefined : (await this.options.listFollowups({ limit: 1, staleAfterMs }))[0]
    const latestHandoffRecord = handoffId || hasExplicitNonHandoffTarget || latestFollowupRecord ? undefined : (await this.options.listHandoffs(1))[0]
    const selectedHandoffId = handoffId ?? latestFollowupRecord?.handoff_id ?? latestHandoffRecord?.handoff_id
    const handoff = proposalHandoff ?? (selectedHandoffId ? await this.options.getHandoff(selectedHandoffId) : null)
    const followup = selectedHandoffId
      ? (latestFollowupRecord?.handoff_id === selectedHandoffId ? latestFollowupRecord : await this.options.getFollowup(selectedHandoffId, { staleAfterMs }))
      : hasExplicitNonHandoffTarget
        ? null
        : undefined
    const missionId = input.mission_id ?? followup?.mission_id ?? handoff?.mission_id ?? result?.mission_id
    const mission = missionId ? await this.options.getMission(missionId) : null
    const progress = missionId ? await this.options.listMissionProgress(missionId) : []
    const results = missionId ? await this.options.listMissionResults(missionId) : []
    const proposalId = input.proposal_id ?? handoff?.proposal_id ?? followup?.proposal_id
    const proposal = proposalId ? await this.options.getProposal(proposalId) : null
    const reviewId = proposal?.review_id ?? handoff?.review_id ?? followup?.review_id
    const review = reviewId ? await this.options.getReview(reviewId) : null
    const latestSmoke = (await this.options.listSmokes(1))[0]
    const readiness = input.include_readiness === false
      ? undefined
      : proposalId || missionId || handoffId
        ? await this.options.readinessPreview({ proposal_id: proposalId, mission_id: missionId, handoff_id: handoffId, require_recent_smoke: false }).catch(() => undefined)
        : await this.options.readinessSummary().catch(() => undefined)
    return { handoff: handoff ?? null, followup: followup ?? null, mission, progress, results, result, proposal, review, latestSmoke, readiness }
  }

  private authorityEvidence(): OpenCodeResultReviewEvidence[] {
    return ["/handoff", "/handoff-readiness", "/handoff-followups", "/mission", "/result"].map((command) => {
      const record = this.authorityService.get(command)
      return evidence({
        evidence_id: `authority:${record.slash_command}`,
        kind: "authority",
        related_id: record.slash_command,
        status: record.risk,
        fresh: true,
        summary_preview: `${record.slash_command} is ${record.risk} owner=${record.owner} gate=${record.gate}`,
        warnings: record.blocked_by_default ? [`${record.slash_command} is blocked by default or explicit`] : [],
      })
    })
  }
}

export function readOpenCodeResultReviewPacketInput(input: Record<string, unknown> = {}): OpenCodeResultReviewPacketInput {
  return normalizeInput(input)
}

function normalizeInput(input: Record<string, unknown> = {}): OpenCodeResultReviewPacketInput {
  return {
    handoff_id: optionalString(input.handoff_id ?? input.handoffId, "handoff_id"),
    followup_id: optionalString(input.followup_id ?? input.followupId, "followup_id"),
    mission_id: optionalString(input.mission_id ?? input.missionId, "mission_id"),
    result_id: optionalString(input.result_id ?? input.resultId, "result_id"),
    proposal_id: optionalString(input.proposal_id ?? input.proposalId, "proposal_id"),
    limit: optionalPositiveInteger(input.limit, "limit", 100),
    stale_after_ms: optionalPositiveInteger(input.stale_after_ms ?? input.staleAfterMs, "stale_after_ms", MAX_STALE_AFTER_MS),
    include_authority: optionalBoolean(input.include_authority ?? input.includeAuthority, "include_authority"),
    include_readiness: optionalBoolean(input.include_readiness ?? input.includeReadiness, "include_readiness"),
  }
}

function packetStatus(input: { blockers: string[]; warnings: string[]; context: BuildContext; latestResult?: MissionResult; staleAfterMs: number; now: Date }): OpenCodeResultReviewPacketStatus {
  const hardBlockers = input.blockers.filter((blocker) => !isStaleOnlyBlocker(blocker))
  if (input.context.mission && isBlockedMissionStatus(input.context.mission.status)) return "blocked"
  if (input.latestResult?.status === "rejected") return "blocked"
  if (input.latestResult && hardBlockers.length === 0) return "ready_for_commander_review"
  if (isFailureStatus(input.context.followup?.followup_status)) return "failed"
  if (!input.context.handoff && !input.context.followup && !input.context.mission && !input.context.result && !input.context.proposal) return input.blockers.length > 0 ? "blocked" : "unknown"
  if ((input.context.handoff || input.context.followup || input.context.mission) && !input.latestResult) {
    if (outcomeEvidenceIsStale(input.context, input.staleAfterMs, input.now) && hardBlockers.length === 0) return "stale"
    if (isBlockedStatus(input.context.followup?.followup_status)) return "blocked"
    if (input.blockers.length > 0) return "blocked"
    return "needs_result"
  }
  if (input.blockers.length > 0) return "blocked"
  if (input.context.proposal && !input.context.handoff) return "needs_handoff"
  return "unknown"
}

function statusFromFollowup(followup: OpenCodeHandoffFollowup, result: MissionResult | undefined, staleAfterMs: number, now: Date, handoff?: OpenCodeHandoffResult | null): OpenCodeResultReviewPacketStatus {
  if (isFailureStatus(followup.followup_status)) return "failed"
  const hardBlockers = followup.blockers.filter((blocker) => !isStaleOnlyBlocker(blocker))
  if (hardBlockers.length > 0) return "blocked"
  if (result?.status === "rejected") return "blocked"
  if (result && isReviewableResultStatus(result.status)) return "ready_for_commander_review"
  const staleByFollowup = isStale(followup.updated_at, staleAfterMs, now) || followup.blockers.some(isStaleOnlyBlocker)
  const staleByHandoff = Boolean(handoff?.created_at && isStale(handoff.created_at, staleAfterMs, now))
  if (isBlockedStatus(followup.followup_status)) return "blocked"
  if ((staleByFollowup || staleByHandoff) && hardBlockers.length === 0) return "stale"
  if (followup.blockers.length > 0) return "blocked"
  return "needs_result"
}

function isFailureStatus(status: string | undefined): boolean {
  return status === "failed" || status === "cancelled" || status === "handoff_failed"
}

function isBlockedStatus(status: string | undefined): boolean {
  return status === "blocked"
}

function isBlockedMissionStatus(status: string | undefined): boolean {
  return status === "failed" || status === "cancelled"
}

function isReviewableResultStatus(status: string | undefined): boolean {
  return status === "submitted" || status === "accepted"
}

function outcomeEvidenceIsStale(context: BuildContext, staleAfterMs: number, now: Date): boolean {
  return Boolean(
    (context.handoff?.created_at && isStale(context.handoff.created_at, staleAfterMs, now)) ||
      (context.followup?.updated_at && isStale(context.followup.updated_at, staleAfterMs, now)) ||
      (context.mission?.updated_at && isStale(context.mission.updated_at, staleAfterMs, now)),
  )
}

function targetConsistencyBlockers(context: BuildContext, input: OpenCodeResultReviewPacketInput, latestResult?: MissionResult): string[] {
  const out: string[] = []
  if (input.handoff_id && input.followup_id && input.handoff_id !== input.followup_id) {
    out.push("requested handoff and follow-up ids do not match")
  }
  const selectedMissionId = context.followup?.mission_id ?? context.handoff?.mission_id ?? input.mission_id ?? context.mission?.mission_id
  const selectedProposalId = context.followup?.proposal_id ?? context.handoff?.proposal_id
  if (selectedProposalId && input.proposal_id && input.proposal_id !== selectedProposalId) {
    out.push("requested proposal does not match selected handoff or follow-up proposal")
  }
  if (context.proposal && selectedMissionId && context.proposal.mission_id && context.proposal.mission_id !== selectedMissionId) {
    out.push("requested proposal mission does not match selected mission")
  }
  if (context.proposal && latestResult && context.proposal.mission_id && context.proposal.mission_id !== latestResult.mission_id) {
    out.push("requested proposal mission does not match selected result mission")
  }
  if (context.proposal && latestResult && context.proposal.result_id && context.proposal.result_id !== latestResult.result_id) {
    out.push("requested proposal result does not match selected result")
  }
  const proposalMatchesResult = Boolean(
    context.proposal &&
      latestResult &&
      ((context.proposal.mission_id && context.proposal.mission_id === latestResult.mission_id) ||
        (context.proposal.result_id && context.proposal.result_id === latestResult.result_id)),
  )
  if (input.proposal_id && input.result_id && latestResult && !selectedProposalId && !proposalMatchesResult) {
    out.push("requested proposal is not linked to selected result by handoff, follow-up, mission, or result id")
  }
  if (input.proposal_id && input.mission_id && latestResult && !selectedProposalId && !proposalMatchesResult) {
    out.push("requested proposal is not linked to selected mission result by handoff, follow-up, mission, or result id")
  }
  if (selectedMissionId && input.mission_id && input.mission_id !== selectedMissionId) {
    out.push("requested mission does not match selected handoff or follow-up mission")
  }
  if (selectedMissionId && input.result_id && latestResult?.mission_id && latestResult.mission_id !== selectedMissionId) {
    out.push("requested result mission does not match selected handoff or follow-up mission")
  }
  return out
}

function isStaleOnlyBlocker(blocker: string): boolean {
  return blocker === "handoff follow-up is stale"
}

function handoffEvidence(handoff: OpenCodeHandoffResult, now: Date): OpenCodeResultReviewEvidence {
  return evidence({
    evidence_id: `handoff:${handoff.handoff_id}`,
    kind: "handoff",
    related_id: handoff.handoff_id,
    status: handoff.sent ? "sent" : "not_sent",
    fresh: handoff.sent,
    completed_at: handoff.created_at,
    age_ms: age(now, handoff.created_at),
    summary_preview: `handoff proposal=${handoff.proposal_id} mission=${handoff.mission_id ?? "none"} sent=${handoff.sent}`,
    blockers: handoff.sent ? [] : ["handoff was not sent"],
  })
}

function followupEvidence(followup: OpenCodeHandoffFollowup, staleAfterMs: number, now: Date): OpenCodeResultReviewEvidence {
  const stale = isStale(followup.updated_at, staleAfterMs, now)
  return evidence({
    evidence_id: `handoff_followup:${followup.handoff_id}`,
    kind: "handoff_followup",
    related_id: followup.handoff_id,
    status: followup.followup_status,
    fresh: !stale,
    completed_at: followup.updated_at,
    age_ms: age(now, followup.updated_at),
    summary_preview: `status=${followup.followup_status} progress=${followup.progress_count} results=${followup.result_count}`,
    blockers: followup.blockers,
    warnings: stale ? ["handoff follow-up is stale"] : [],
  })
}

function missionEvidence(mission: MissionRecord, now: Date): OpenCodeResultReviewEvidence {
  return evidence({
    evidence_id: `mission:${mission.mission_id}`,
    kind: "mission",
    related_id: mission.mission_id,
    status: mission.status,
    fresh: mission.status !== "failed" && mission.status !== "cancelled",
    completed_at: mission.updated_at,
    age_ms: age(now, mission.updated_at),
    summary_preview: mission.objective,
    blockers: mission.status === "failed" ? [mission.failure_reason ?? "mission failed"] : mission.status === "cancelled" ? [mission.cancellation_reason ?? "mission cancelled"] : [],
  })
}

function progressEvidence(progress: MissionProgress, count: number, now: Date): OpenCodeResultReviewEvidence {
  return evidence({
    evidence_id: `mission_progress:${progress.progress_id}`,
    kind: "mission_progress",
    related_id: progress.progress_id,
    status: "recorded",
    fresh: true,
    completed_at: progress.created_at,
    age_ms: age(now, progress.created_at),
    summary_preview: `latest progress (${count} total): ${progress.message}`,
  })
}

function resultEvidence(result: MissionResult, now: Date): OpenCodeResultReviewEvidence {
  return evidence({
    evidence_id: `mission_result:${result.result_id}`,
    kind: "mission_result",
    related_id: result.result_id,
    status: result.status,
    fresh: result.status === "submitted" || result.status === "accepted",
    completed_at: result.created_at,
    age_ms: age(now, result.created_at),
    summary_preview: result.summary,
    blockers: result.status === "rejected" ? ["mission result was rejected"] : [],
  })
}

function proposalEvidence(proposal: CommanderProposal, now: Date): OpenCodeResultReviewEvidence {
  return evidence({
    evidence_id: `proposal:${proposal.proposal_id}`,
    kind: "proposal",
    related_id: proposal.proposal_id,
    status: proposal.status,
    fresh: true,
    completed_at: proposal.updated_at,
    age_ms: age(now, proposal.updated_at),
    summary_preview: `${proposal.action_kind}: ${proposal.title}`,
  })
}

function reviewEvidence(review: ReviewRequest, now: Date): OpenCodeResultReviewEvidence {
  return evidence({
    evidence_id: `review:${review.review_id}`,
    kind: "review",
    related_id: review.review_id,
    status: review.status,
    fresh: review.status === "approved",
    completed_at: review.updated_at,
    age_ms: age(now, review.updated_at),
    summary_preview: `${review.request_type}: ${review.title}`,
    warnings: review.status !== "approved" ? [`review is ${review.status}`] : [],
  })
}

function readinessEvidence(readiness: OpenCodeHandoffReadinessPreview | OpenCodeHandoffReadinessSummary, now: Date): OpenCodeResultReviewEvidence {
  const status = "status" in readiness ? readiness.status : `ready=${readiness.ready_count} blocked=${readiness.blocked_count}`
  return evidence({
    evidence_id: "handoff_readiness:summary",
    kind: "handoff_readiness",
    status,
    fresh: true,
    completed_at: readiness.generated_at,
    age_ms: age(now, readiness.generated_at),
    summary_preview: "status" in readiness ? readiness.redacted_summary_preview : `latest_smoke=${readiness.latest_smoke_status ?? "none"} latest_handoff=${readiness.latest_handoff_status ?? "none"}`,
  })
}

function smokeEvidence(smoke: OpenCodeProcessSmokeRecord, now: Date): OpenCodeResultReviewEvidence {
  return evidence({
    evidence_id: `process_smoke:${smoke.smoke_id}`,
    kind: "process_smoke",
    related_id: smoke.smoke_id,
    status: smoke.status,
    fresh: smoke.status === "succeeded",
    completed_at: smoke.completed_at,
    age_ms: age(now, smoke.completed_at),
    summary_preview: smoke.summary_preview,
  })
}

function evidence(input: Omit<OpenCodeResultReviewEvidence, "blockers" | "warnings" | "summary_preview"> & { summary_preview: string; blockers?: string[]; warnings?: string[] }): OpenCodeResultReviewEvidence {
  return {
    ...input,
    evidence_id: bound(input.evidence_id),
    related_id: input.related_id ? bound(input.related_id) : undefined,
    status: bound(input.status),
    summary_preview: bound(input.summary_preview),
    blockers: boundList(input.blockers ?? []),
    warnings: boundList(input.warnings ?? []),
  }
}

function recommendedCommands(context: BuildContext, input: OpenCodeResultReviewPacketInput): OpenCodeResultReviewCommand[] {
  const handoffId = context.handoff?.handoff_id ?? context.followup?.handoff_id ?? input.handoff_id ?? input.followup_id
  const missionId = context.mission?.mission_id ?? context.result?.mission_id ?? context.followup?.mission_id ?? input.mission_id
  const resultId = context.result?.result_id ?? context.results.at(-1)?.result_id ?? input.result_id
  const proposalId = context.proposal?.proposal_id ?? context.handoff?.proposal_id ?? context.followup?.proposal_id ?? input.proposal_id
  const reviewId = context.review?.review_id ?? context.handoff?.review_id ?? context.followup?.review_id
  const commands: OpenCodeResultReviewCommand[] = [
    { label: "List handoff follow-ups", command: "/handoff-followups", command_type: "read" },
    { label: "Show handoff authority", command: "/authority-show /handoff", command_type: "read" },
    { label: "Show handoff readiness", command: handoffId ? `/handoff-readiness handoff=${handoffId}` : "/handoff-readiness", command_type: "read" },
    { label: "List OpenCode smokes", command: "/opencode-smokes", command_type: "read" },
  ]
  if (handoffId) commands.push({ label: "Show handoff follow-up", command: `/handoff-followup ${handoffId}`, command_type: "read" }, { label: "Show handoff", command: `/handoff-show ${handoffId}`, command_type: "read" })
  if (missionId) commands.push({ label: "Show mission", command: `/mission ${missionId}`, command_type: "read" }, { label: "List mission results", command: `/results ${missionId}`, command_type: "read" })
  if (resultId) commands.push({ label: "Open result context", command: `/open result ${resultId}`, command_type: "read" })
  if (proposalId) commands.push({ label: "Show proposal", command: `/proposal ${proposalId}`, command_type: "read" })
  if (reviewId) commands.push({ label: "Show review", command: `/review ${reviewId}`, command_type: "read" })
  return commands
}

function titleFor(status: OpenCodeResultReviewPacketStatus, context: BuildContext): string {
  if (status === "ready_for_commander_review" && (context.result ?? context.results.at(-1))) return "OpenCode executor result is ready for Commander review"
  if (status === "needs_result") return "OpenCode executor handoff needs a mission result"
  if (status === "failed") return "OpenCode executor handoff failed or was blocked"
  if (status === "blocked") return "OpenCode executor result review is blocked"
  if (status === "stale") return "OpenCode executor handoff is stale without result evidence"
  return "OpenCode executor result review packet"
}

function summaryPreview(status: OpenCodeResultReviewPacketStatus, blockers: string[], warnings: string[], result?: MissionResult): string {
  if (result) return bound(`packet ${status}: result=${result.result_id} ${result.summary}`)
  if (blockers[0]) return bound(`packet ${status}: ${blockers[0]}`)
  if (warnings[0]) return bound(`packet ${status}: ${warnings[0]}`)
  return bound(`packet ${status}`)
}

function packetId(input: OpenCodeResultReviewPacketInput, generatedAt: string): string {
  const target = input.handoff_id ?? input.followup_id ?? input.mission_id ?? input.result_id ?? input.proposal_id ?? "latest"
  return bound(`opencode_result_review_${target}_${Date.parse(generatedAt).toString(36)}`).replace(/[^a-zA-Z0-9_-]/g, "_")
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${field} must be a string`)
  if (!value.trim()) throw new Error(`${field} must be nonblank`)
  return bound(value)
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean`)
  return value
}

function optionalPositiveInteger(value: unknown, field: string, max: number): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${field} must be a positive integer`)
  return Math.min(Number(value), max)
}

function isStale(timestamp: string | undefined, staleAfterMs: number, now: Date): boolean {
  if (!timestamp) return false
  const time = Date.parse(timestamp)
  return Number.isFinite(time) && now.getTime() - time >= staleAfterMs
}

function age(now: Date, timestamp?: string): number | undefined {
  if (!timestamp) return undefined
  const time = Date.parse(timestamp)
  return Number.isFinite(time) ? Math.max(0, now.getTime() - time) : undefined
}

function boundList(items: string[]): string[] {
  return items.map(bound).filter(Boolean).slice(0, MAX_ROWS)
}

function bound(value: string): string {
  return redactText(value).slice(0, MAX_TEXT)
}
