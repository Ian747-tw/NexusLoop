import { existsSync } from "fs"
import { join } from "path"
import type { RuntimeEvent } from "./events"
import { redactText, redactUnknown } from "./redaction"
import type { CommanderApplyPreviewSummary, CommanderApplyResultSummary, CommanderAuditEventSummary, CommanderAuthorityChainSummary, CommanderPlaybookDraftSummary, CommanderPlaybookSummary, CommanderProposalBundleSummary, CommanderProposalSummary, CommanderWorkbenchDraftSummary, CommanderWorkbenchReadinessSummary, CommanderWorkbenchStatusSummary, ExecutorClaimSummary, MissionProgressSummary, MissionRecord, MissionResultSummary, ProposalBundleReadinessSummary, ReviewRequestSummary } from "./state"

export interface SubmitUserMessageResult {
  accepted: true
  missionId: string
  intentId: string
}

export interface RuntimeClient {
  readonly streamMode?: "finite" | "long-lived"
  stream(): AsyncIterable<RuntimeEvent>
  command(name: string, payload?: Record<string, unknown>): Promise<unknown>
  sendUserMessage(message: string): Promise<SubmitUserMessageResult | void>
  sendCommand(command: string): Promise<unknown>
  shutdown?(): Promise<void>
}

export class FakeRuntimeClient implements RuntimeClient {
  readonly sentMessages: string[] = []
  readonly sentCommands: string[] = []
  private readonly missions: MissionRecord[] = []
  private readonly claims: ExecutorClaimSummary[] = []
  private readonly progress: MissionProgressSummary[] = []
  private readonly results: MissionResultSummary[] = []
  private readonly reviews: ReviewRequestSummary[] = []
  private readonly proposals: CommanderProposalSummary[] = []
  private readonly proposalBundles: CommanderProposalBundleSummary[] = []
  private readonly playbooks: CommanderPlaybookSummary[] = fakeCommanderPlaybooks()
  private readonly playbookDrafts: CommanderWorkbenchDraftSummary[] = []
  private projectionRebuilds = 0
  private sequence = 0

  constructor(
    private readonly projectDir: string,
    private readonly projectName: string,
  ) {}

  async *stream(): AsyncIterable<RuntimeEvent> {
    yield {
      type: "RuntimeReady",
      projectName: this.projectName,
      runtimeStatus: "fake runtime connected",
      providerLabel: "placeholder only",
      modelLabel: "not configured",
    }

    if (!existsSync(join(this.projectDir, ".nxl"))) {
      yield { type: "ProjectUninitialized", projectDir: this.projectDir }
      return
    }

    yield { type: "ProjectInitialized", projectDir: this.projectDir }
    yield { type: "ResumeSummaryLoaded", lastRunId: "fake-last-run", activeMissionId: "mission-placeholder", recordsCount: 0 }
    if (process.env.NXL_TUI_FAKE_FULL_STREAM !== "1") return
    yield {
      type: "MissionStarted",
      missionId: "mission-placeholder",
      workIntent: "Awaiting user message",
      budget: "placeholder budget",
      programState: "ready",
    }
    yield { type: "WakeHookFired", hook: "resume-screen-opened" }
    yield { type: "ExecutorToolStarted", tool: "runtime.connect", target: "fake runtime stream" }
    yield { type: "ExecutorToolCompleted", tool: "runtime.connect", status: "completed", output: "connection skeleton active" }
    yield {
      type: "CommanderDecisionRecorded",
      decision: "standby",
      reason: "Commander intelligence is intentionally not implemented in this branch",
    }
  }

  async sendUserMessage(message: string): Promise<SubmitUserMessageResult> {
    this.sentMessages.push(message)
    const python = process.env.NXL_PYTHON_EXECUTABLE ?? "python"
    const onboarding = Bun.spawnSync({
      cmd: [
        python,
        "-m",
        "nxl_core.spec.tui_onboarding",
        "--project-dir",
        this.projectDir,
        "--message",
        message,
      ],
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    })
    if (onboarding.exitCode !== 0) {
      const stderr = new TextDecoder().decode(onboarding.stderr).trim()
      throw new Error(`spec onboarding failed: ${stderr}`)
    }
    return this.createMission(message)
  }

  async sendCommand(command: string): Promise<unknown> {
    this.sentCommands.push(command)
    switch (command) {
      case "status":
        return this.command("runtime.status")
      case "missions":
        return this.command("runtime.list_recent_missions", { limit: 5 })
      case "resume":
      case "new-session":
      case "records":
      case "shutdown":
      case "initialize":
      case "cancel":
        return { ok: true, command }
      default:
        throw new Error(`unknown TUI command: ${redactText(command)}`)
    }
  }

  async command(name: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    switch (name) {
      case "runtime.status":
        return {
          runtimeStatus: "fake runtime connected",
          mode: "active",
          projectName: this.projectName,
          specApproved: existsSync(join(this.projectDir, ".nxl")),
          lockHeld: false,
          adapterStatus: { kind: "fake", phase: "idle" },
          missions: this.missionSummary(),
          reviews: this.reviewSummary(),
          proposals: this.proposalSummary(),
          proposalBundles: this.proposalBundleSummary(),
          playbookDrafts: this.playbookDraftSummary(),
          researchProjection: { mode: "disabled", ok: true, stale: false, reason: "disabled", pending_count: 0 },
        }
      case "runtime.list_recent_missions":
        return this.missions.slice(0, readLimit(payload.limit, 5))
      case "runtime.get_mission":
        return this.getMission(String(payload.missionId ?? payload.mission_id ?? ""))
      case "runtime.claim_mission":
        return this.claimMission(String(payload.missionId ?? payload.mission_id ?? ""), String(payload.executorId ?? payload.executor_id ?? ""))
      case "runtime.record_mission_progress":
        return this.recordMissionProgress(
          String(payload.missionId ?? payload.mission_id ?? ""),
          String(payload.claimId ?? payload.claim_id ?? ""),
          String(payload.message ?? ""),
        )
      case "runtime.submit_mission_result":
        return this.submitMissionResult(
          String(payload.missionId ?? payload.mission_id ?? ""),
          String(payload.claimId ?? payload.claim_id ?? ""),
          String(payload.summary ?? ""),
        )
      case "runtime.complete_mission":
        return this.completeMission(String(payload.missionId ?? payload.mission_id ?? ""), payload)
      case "runtime.fail_mission":
        return this.failMission(String(payload.missionId ?? payload.mission_id ?? ""), String(payload.reason ?? ""))
      case "runtime.cancel_mission":
        return this.cancelMission(String(payload.missionId ?? payload.mission_id ?? ""), optionalString(payload.reason))
      case "runtime.release_mission_claim":
        return this.releaseMissionClaim(String(payload.claimId ?? payload.claim_id ?? ""), optionalString(payload.reason))
      case "runtime.list_mission_claims":
        return this.claims.filter((claim) => claim.mission_id === String(payload.missionId ?? payload.mission_id ?? ""))
      case "runtime.list_mission_progress":
        return this.progress.filter((item) => item.mission_id === String(payload.missionId ?? payload.mission_id ?? ""))
      case "runtime.list_mission_results":
        return this.results.filter((result) => result.mission_id === String(payload.missionId ?? payload.mission_id ?? ""))
      case "runtime.create_review_request":
        return this.createReviewRequest(payload)
      case "runtime.get_review_request":
        return this.getReviewRequest(String(payload.reviewId ?? payload.review_id ?? ""))
      case "runtime.list_review_requests":
        return this.listReviewRequests(optionalString(payload.status), readLimit(payload.limit, 20))
      case "runtime.approve_review_request":
        return this.decideReview(String(payload.reviewId ?? payload.review_id ?? ""), "approved", String(payload.decidedBy ?? payload.decided_by ?? ""), optionalString(payload.reason))
      case "runtime.reject_review_request":
        return this.decideReview(String(payload.reviewId ?? payload.review_id ?? ""), "rejected", String(payload.decidedBy ?? payload.decided_by ?? ""), optionalString(payload.reason))
      case "runtime.cancel_review_request":
        return this.decideReview(String(payload.reviewId ?? payload.review_id ?? ""), "cancelled", String(payload.decidedBy ?? payload.decided_by ?? ""), optionalString(payload.reason))
      case "runtime.review_status":
        return this.reviewSummary()
      case "runtime.create_commander_proposal":
        return this.createProposal(payload)
      case "runtime.get_commander_proposal":
        return this.getProposal(String(payload.proposalId ?? payload.proposal_id ?? ""))
      case "runtime.list_commander_proposals":
        return this.listProposals(optionalString(payload.status), readLimit(payload.limit, 20))
      case "runtime.request_proposal_review":
        return this.requestProposalReview(String(payload.proposalId ?? payload.proposal_id ?? ""), payload)
      case "runtime.cancel_commander_proposal":
        return this.cancelProposal(String(payload.proposalId ?? payload.proposal_id ?? ""), optionalString(payload.reason))
      case "runtime.apply_commander_proposal":
        return this.applyProposal(String(payload.proposalId ?? payload.proposal_id ?? ""))
      case "runtime.proposal_status":
        return this.proposalSummary()
      case "runtime.create_proposal_bundle":
        return this.createProposalBundle(payload)
      case "runtime.get_proposal_bundle":
        return this.getProposalBundle(String(payload.bundleId ?? payload.bundle_id ?? ""))
      case "runtime.list_proposal_bundles":
        return this.listProposalBundles(optionalString(payload.status), readLimit(payload.limit, 20))
      case "runtime.add_proposal_to_bundle":
        return this.addProposalToBundle(String(payload.bundleId ?? payload.bundle_id ?? ""), String(payload.proposalId ?? payload.proposal_id ?? ""))
      case "runtime.proposal_bundle_readiness":
        return this.proposalBundleReadiness(String(payload.bundleId ?? payload.bundle_id ?? ""))
      case "runtime.request_proposal_bundle_reviews":
        return this.requestProposalBundleReviews(String(payload.bundleId ?? payload.bundle_id ?? ""), String(payload.requestedBy ?? payload.requested_by ?? "operator"))
      case "runtime.apply_proposal_bundle":
        return this.applyProposalBundle(String(payload.bundleId ?? payload.bundle_id ?? ""), payload.allowPartial === true || payload.allow_partial === true)
      case "runtime.cancel_proposal_bundle":
        return this.cancelProposalBundle(String(payload.bundleId ?? payload.bundle_id ?? ""), optionalString(payload.reason))
      case "runtime.proposal_bundle_status":
        return this.proposalBundleSummary()
      case "runtime.list_commander_playbooks":
        return this.playbooks
      case "runtime.get_commander_playbook":
        return this.getCommanderPlaybook(String(payload.playbookId ?? payload.playbook_id ?? ""))
      case "runtime.draft_commander_playbook":
        return this.draftCommanderPlaybook(payload)
      case "runtime.get_commander_playbook_draft":
        return this.getCommanderPlaybookDraft(String(payload.draftId ?? payload.draft_id ?? ""))
      case "runtime.list_commander_playbook_drafts":
        return this.listCommanderPlaybookDrafts(optionalString(payload.status), readLimit(payload.limit, 20))
      case "runtime.commander_playbook_draft_status":
        return this.playbookDraftSummary()
      case "runtime.commander_playbook_draft_readiness":
        return this.commanderPlaybookDraftReadiness(String(payload.draftId ?? payload.draft_id ?? ""))
      case "runtime.request_commander_playbook_draft_reviews":
        return this.requestCommanderPlaybookDraftReviews(String(payload.draftId ?? payload.draft_id ?? ""), String(payload.requestedBy ?? payload.requested_by ?? "operator"))
      case "runtime.cancel_commander_playbook_draft":
        return this.cancelCommanderPlaybookDraft(String(payload.draftId ?? payload.draft_id ?? ""), optionalString(payload.reason))
      case "runtime.commander_apply_preview":
        return this.commanderApplyPreview(String(payload.targetType ?? payload.target_type ?? ""), String(payload.targetId ?? payload.target_id ?? ""))
      case "runtime.apply_commander_target":
        return this.applyCommanderTarget(
          String(payload.targetType ?? payload.target_type ?? ""),
          String(payload.targetId ?? payload.target_id ?? ""),
          payload.allowPartial === true || payload.allow_partial === true,
          payload.dryRun === true || payload.dry_run === true,
        )
      case "runtime.commander_audit_timeline":
        return this.commanderAuditTimeline(optionalString(payload.category), readLimit(payload.limit, 20), optionalString(payload.targetType ?? payload.target_type), optionalString(payload.targetId ?? payload.target_id))
      case "runtime.commander_authority_chain":
        return this.commanderAuthorityChain(String(payload.targetType ?? payload.target_type ?? ""), String(payload.targetId ?? payload.target_id ?? ""))
      case "runtime.submit_user_message":
        return this.createMission(String(payload.message ?? ""))
      case "runtime.resume":
      case "runtime.start_new_session":
      case "runtime.view_records":
      case "runtime.shutdown":
        return { ok: true }
      case "research.list_topics":
        return this.researchTopics()
      case "research.get_topic_snapshot":
        return this.topicSnapshot(String(payload.topicId ?? ""))
      case "research.search_notes":
        return this.searchNotes(String(payload.topicId ?? ""), String(payload.query ?? ""))
      case "research.list_events":
        return this.researchEvents(readLimit(isRecord(payload.options) ? payload.options.limit : undefined, 5))
      case "research.projection_status":
        return this.projectionStatus()
      case "research.rebuild_projection":
        this.projectionRebuilds += 1
        return this.projectionStatus()
      default:
        throw new Error(`unknown runtime command: ${redactText(name)}`)
    }
  }

  private createMission(message: string): SubmitUserMessageResult {
    this.sequence += 1
    const missionId = `fake-mission-${this.sequence}`
    const intentId = `fake-intent-${this.sequence}`
    const now = new Date(0).toISOString()
    this.missions.unshift({
      mission_id: missionId,
      intent_id: intentId,
      objective: redactText(message),
      status: "sent",
      created_at: now,
      updated_at: now,
    })
    return { accepted: true, missionId, intentId }
  }

  private getMission(missionId: string): MissionRecord | null {
    if (!missionId.trim()) throw new Error("missionId is required")
    return this.missions.find((mission) => mission.mission_id === missionId) ?? null
  }

  private ensureMission(missionId: string): MissionRecord {
    const id = missionId.trim()
    if (!id) throw new Error("missionId is required")
    let mission = this.missions.find((item) => item.mission_id === id)
    if (mission) return mission
    const now = new Date(0).toISOString()
    mission = {
      mission_id: id,
      intent_id: `fake-intent-for-${redactText(id)}`,
      objective: `Fake mission ${redactText(id)}`,
      status: "sent",
      created_at: now,
      updated_at: now,
    }
    this.missions.unshift(mission)
    return mission
  }

  private claimMission(missionId: string, executorId: string): ExecutorClaimSummary {
    const mission = this.ensureMission(missionId)
    const executor = redactText(requiredString(executorId, "executorId"))
    const existing = this.claims.find((claim) => claim.mission_id === mission.mission_id && claim.status === "active")
    if (existing) throw new Error(`mission already has an active claim: ${redactText(mission.mission_id)}`)
    if (mission.status !== "sent") throw new Error(`mission must be sent before claim: ${redactText(mission.mission_id)}`)
    this.sequence += 1
    const now = new Date(0).toISOString()
    const claim: ExecutorClaimSummary = {
      claim_id: `fake-claim-${this.sequence}`,
      mission_id: mission.mission_id,
      executor_id: executor,
      status: "active",
      claimed_at: now,
    }
    this.claims.unshift(claim)
    mission.status = "claimed"
    mission.claimed_at = now
    mission.updated_at = now
    return claim
  }

  private recordMissionProgress(missionId: string, claimId: string, message: string): MissionProgressSummary {
    const mission = this.ensureMission(missionId)
    const claim = this.requireClaim(claimId, mission.mission_id)
    if (claim.status !== "active") throw new Error(`claim is not active: ${redactText(claim.claim_id)}`)
    this.sequence += 1
    const now = new Date(0).toISOString()
    const progress: MissionProgressSummary = {
      progress_id: `fake-progress-${this.sequence}`,
      mission_id: mission.mission_id,
      claim_id: claim.claim_id,
      message: redactText(requiredString(message, "message")),
      created_at: now,
    }
    this.progress.unshift(progress)
    mission.status = "running"
    mission.updated_at = now
    return progress
  }

  private submitMissionResult(missionId: string, claimId: string, summary: string): MissionResultSummary {
    const mission = this.ensureMission(missionId)
    const claim = this.requireClaim(claimId, mission.mission_id)
    if (claim.status !== "active") throw new Error(`claim is not active: ${redactText(claim.claim_id)}`)
    this.sequence += 1
    const now = new Date(0).toISOString()
    const result: MissionResultSummary = {
      result_id: `fake-result-${this.sequence}`,
      mission_id: mission.mission_id,
      claim_id: claim.claim_id,
      summary: redactText(requiredString(summary, "summary")),
      status: "submitted",
      created_at: now,
    }
    this.results.unshift(result)
    mission.status = "running"
    mission.updated_at = now
    return result
  }

  private completeMission(missionId: string, payload: Record<string, unknown>): MissionRecord {
    const mission = this.ensureMission(missionId)
    const activeClaim = this.claims.find((claim) => claim.mission_id === mission.mission_id && claim.status === "active")
    if (!activeClaim) throw new Error(`mission completion requires an active claim: ${redactText(mission.mission_id)}`)
    const payloadResultId = optionalString(payload.resultId) ?? optionalString(payload.result_id)
    const result = payloadResultId
      ? this.results.find((item) => item.result_id === payloadResultId && item.mission_id === mission.mission_id)
      : this.results.find((item) => item.mission_id === mission.mission_id && item.claim_id === activeClaim.claim_id)
    if (!result) throw new Error(`mission completion requires a submitted result: ${redactText(mission.mission_id)}`)
    if (result.claim_id !== activeClaim.claim_id) throw new Error(`result must belong to active claim: ${redactText(result.result_id)}`)
    const now = new Date(0).toISOString()
    result.status = "accepted"
    activeClaim.status = "completed"
    mission.status = "completed"
    mission.completed_at = now
    mission.updated_at = now
    mission.completion_result_id = result.result_id
    const summary = optionalString(payload.summary)
    if (summary) mission.completion_summary = redactText(summary)
    return mission
  }

  private failMission(missionId: string, reason: string): MissionRecord {
    const mission = this.ensureMission(missionId)
    const now = new Date(0).toISOString()
    mission.status = "failed"
    mission.updated_at = now
    mission.failure_reason = redactText(requiredString(reason, "reason"))
    for (const claim of this.claims.filter((item) => item.mission_id === mission.mission_id && item.status === "active")) {
      claim.status = "failed"
    }
    return mission
  }

  private cancelMission(missionId: string, reason?: string): MissionRecord {
    const mission = this.ensureMission(missionId)
    const now = new Date(0).toISOString()
    mission.status = "cancelled"
    mission.cancelled_at = now
    mission.updated_at = now
    if (reason) mission.cancellation_reason = redactText(reason)
    for (const claim of this.claims.filter((item) => item.mission_id === mission.mission_id && item.status === "active")) {
      claim.status = "cancelled"
    }
    return mission
  }

  private releaseMissionClaim(claimId: string, reason?: string): ExecutorClaimSummary {
    const claim = this.requireClaim(claimId)
    if (claim.status !== "active") return claim
    claim.status = "released"
    claim.released_at = new Date(0).toISOString()
    if (reason) claim.release_reason = redactText(reason)
    const mission = this.missions.find((item) => item.mission_id === claim.mission_id)
    if (mission && !isTerminalMissionStatus(mission.status)) {
      mission.status = "sent"
      mission.updated_at = new Date(0).toISOString()
    }
    return claim
  }

  private createReviewRequest(payload: Record<string, unknown>): ReviewRequestSummary {
    const missionId = optionalString(payload.missionId) ?? optionalString(payload.mission_id)
    if (missionId) this.ensureMission(missionId)
    this.sequence += 1
    const now = new Date(0).toISOString()
    const review: ReviewRequestSummary = {
      review_id: `fake-review-${this.sequence}`,
      mission_id: missionId ? redactText(missionId) : undefined,
      claim_id: optionalString(payload.claimId) ?? optionalString(payload.claim_id),
      result_id: optionalString(payload.resultId) ?? optionalString(payload.result_id),
      request_type: optionalString(payload.requestType) ?? optionalString(payload.request_type) ?? "other",
      title: redactText(requiredString(String(payload.title ?? ""), "title")),
      summary: redactText(requiredString(String(payload.summary ?? ""), "summary")),
      requested_by: redactText(requiredString(String(payload.requestedBy ?? payload.requested_by ?? ""), "requestedBy")),
      status: "pending",
      created_at: now,
      updated_at: now,
    }
    this.reviews.unshift(review)
    return review
  }

  private getReviewRequest(reviewId: string): ReviewRequestSummary | null {
    const id = requiredString(reviewId, "reviewId")
    return this.reviews.find((review) => review.review_id === id) ?? null
  }

  private listReviewRequests(status: string | undefined, limit: number): ReviewRequestSummary[] {
    return this.reviews.filter((review) => status === undefined || review.status === status).slice(0, limit)
  }

  private decideReview(reviewId: string, decision: "approved" | "rejected" | "cancelled", decidedBy: string, reason?: string): ReviewRequestSummary {
    const review = this.reviews.find((item) => item.review_id === requiredString(reviewId, "reviewId"))
    if (!review) throw new Error(`review request not found: ${redactText(reviewId)}`)
    const by = redactText(requiredString(decidedBy, "decidedBy"))
    const safeReason = reason === undefined ? undefined : redactText(requiredString(reason, "reason"))
    if (review.status !== "pending") {
      if (review.status === decision && review.decision_by === by && review.decision_reason === safeReason) return review
      throw new Error(`terminal review decision conflicts with existing ${redactText(review.status)} payload: ${redactText(review.review_id)}`)
    }
    const now = new Date(0).toISOString()
    review.status = decision
    review.updated_at = now
    review.decision_at = now
    review.decision_by = by
    review.decision_reason = safeReason
    for (const proposal of this.proposals.filter((item) => item.review_id === review.review_id)) {
      if (decision === "approved" && proposal.status === "review_requested") proposal.status = "approved"
      if ((decision === "rejected" || decision === "cancelled") && proposal.status === "review_requested") proposal.status = "rejected"
      proposal.updated_at = now
      proposal.decision_at = now
      if (safeReason && proposal.status === "rejected") proposal.failure_reason = safeReason
    }
    return review
  }

  private createProposal(payload: Record<string, unknown>): CommanderProposalSummary {
    const actionKind = requiredString(String(payload.actionKind ?? payload.action_kind ?? ""), "actionKind")
    const actionPayload = isRecord(payload.actionPayload) ? payload.actionPayload : isRecord(payload.action_payload) ? payload.action_payload : {}
    const missionId = optionalString(payload.missionId) ?? optionalString(payload.mission_id) ?? optionalString(actionPayload.mission_id)
    const claimId = optionalString(payload.claimId) ?? optionalString(payload.claim_id) ?? optionalString(actionPayload.claim_id)
    const resultId = optionalString(payload.resultId) ?? optionalString(payload.result_id) ?? optionalString(actionPayload.result_id)
    if (missionId) this.ensureMission(missionId)
    this.sequence += 1
    const now = new Date(0).toISOString()
    const proposal: CommanderProposalSummary = {
      proposal_id: `fake-proposal-${this.sequence}`,
      mission_id: missionId ? redactText(missionId) : undefined,
      claim_id: claimId ? redactText(claimId) : undefined,
      result_id: resultId ? redactText(resultId) : undefined,
      action_kind: redactText(actionKind),
      title: redactText(requiredString(String(payload.title ?? ""), "title")),
      summary: redactText(requiredString(String(payload.summary ?? ""), "summary")),
      proposed_by: redactText(requiredString(String(payload.proposedBy ?? payload.proposed_by ?? ""), "proposedBy")),
      status: "proposed",
      action_payload: redactUnknown(actionPayload) as Record<string, unknown>,
      created_at: now,
      updated_at: now,
    }
    this.proposals.unshift(proposal)
    return proposal
  }

  private getProposal(proposalId: string): CommanderProposalSummary | null {
    const id = requiredString(proposalId, "proposalId")
    return this.proposals.find((proposal) => proposal.proposal_id === id) ?? null
  }

  private listProposals(status: string | undefined, limit: number): CommanderProposalSummary[] {
    return this.proposals.filter((proposal) => status === undefined || proposal.status === status).slice(0, limit)
  }

  private requestProposalReview(proposalId: string, payload: Record<string, unknown>): CommanderProposalSummary {
    const proposal = this.requireProposal(proposalId)
    if (proposal.status === "review_requested" || proposal.status === "approved") return proposal
    if (proposal.status !== "proposed") throw new Error(`terminal proposal cannot request review: ${redactText(proposal.proposal_id)}`)
    const review = this.createReviewRequest({
      missionId: proposal.mission_id,
      claimId: proposal.claim_id,
      resultId: proposal.result_id,
      requestType: reviewTypeForProposal(proposal.action_kind),
      title: payload.title ?? proposal.title,
      summary: payload.summary ?? proposal.summary,
      requestedBy: payload.requestedBy ?? payload.requested_by ?? "operator",
    })
    proposal.review_id = review.review_id
    proposal.status = "review_requested"
    proposal.updated_at = new Date(0).toISOString()
    return proposal
  }

  private cancelProposal(proposalId: string, reason?: string): CommanderProposalSummary {
    const proposal = this.requireProposal(proposalId)
    const safeReason = reason === undefined ? undefined : redactText(reason)
    if (proposal.status === "cancelled") {
      if (proposal.failure_reason === safeReason) return proposal
      throw new Error(`terminal proposal cancellation conflicts with existing payload: ${redactText(proposal.proposal_id)}`)
    }
    if (proposal.status === "rejected" || proposal.status === "applied") throw new Error(`terminal proposal cannot cancel: ${redactText(proposal.proposal_id)}`)
    proposal.status = "cancelled"
    proposal.updated_at = new Date(0).toISOString()
    proposal.failure_reason = safeReason
    return proposal
  }

  private applyProposal(proposalId: string): CommanderProposalSummary {
    const proposal = this.requireProposal(proposalId)
    if (proposal.status === "applied") return proposal
    if (proposal.status === "rejected" || proposal.status === "cancelled") throw new Error(`terminal proposal cannot apply: ${redactText(proposal.proposal_id)}`)
    const review = proposal.review_id ? this.reviews.find((item) => item.review_id === proposal.review_id) : undefined
    if (!review || review.status !== "approved") throw new Error(`proposal requires an approved linked review before apply: ${redactText(proposal.proposal_id)}`)
    const payload = isRecord(proposal.action_payload) ? proposal.action_payload : {}
    let result: string
    switch (proposal.action_kind) {
      case "record_progress":
        result = `mission_progress_recorded:${this.recordMissionProgress(requiredActionString(proposal, payload, "mission_id"), requiredActionString(proposal, payload, "claim_id"), requiredString(String(payload.message ?? ""), "message")).progress_id}`
        break
      case "submit_result":
        result = `mission_result_submitted:${this.submitMissionResult(requiredActionString(proposal, payload, "mission_id"), requiredActionString(proposal, payload, "claim_id"), requiredString(String(payload.summary ?? ""), "summary")).result_id}`
        break
      case "complete_mission":
        result = `mission_completed:${this.completeMission(requiredActionString(proposal, payload, "mission_id"), { resultId: optionalActionString(proposal, payload, "result_id"), summary: optionalString(payload.summary) }).mission_id}`
        break
      case "fail_mission":
        result = `mission_failed:${this.failMission(requiredActionString(proposal, payload, "mission_id"), requiredString(String(payload.reason ?? ""), "reason")).mission_id}`
        break
      case "cancel_mission":
        result = `mission_cancelled:${this.cancelMission(requiredActionString(proposal, payload, "mission_id"), optionalString(payload.reason)).mission_id}`
        break
      case "release_claim":
        result = `mission_claim_released:${this.releaseMissionClaim(requiredActionString(proposal, payload, "claim_id"), optionalString(payload.reason)).claim_id}`
        break
      default:
        throw new Error(`unsupported proposal action kind for apply: ${redactText(proposal.action_kind)}`)
    }
    proposal.status = "applied"
    proposal.updated_at = new Date(0).toISOString()
    proposal.applied_at = proposal.updated_at
    proposal.application_result = result
    proposal.failure_reason = undefined
    return proposal
  }

  private createProposalBundle(payload: Record<string, unknown>): CommanderProposalBundleSummary {
    this.sequence += 1
    const now = new Date(0).toISOString()
    const bundle: CommanderProposalBundleSummary = {
      bundle_id: `fake-bundle-${this.sequence}`,
      title: redactText(requiredString(String(payload.title ?? ""), "title")),
      summary: redactText(requiredString(String(payload.summary ?? ""), "summary")),
      created_by: redactText(requiredString(String(payload.createdBy ?? payload.created_by ?? ""), "createdBy")),
      status: "open",
      proposal_ids: [],
      created_at: now,
      updated_at: now,
    }
    this.proposalBundles.unshift(bundle)
    return this.projectProposalBundle(bundle)
  }

  private getProposalBundle(bundleId: string): CommanderProposalBundleSummary | null {
    const id = requiredString(bundleId, "bundleId")
    const bundle = this.proposalBundles.find((item) => item.bundle_id === id)
    return bundle ? this.projectProposalBundle(bundle) : null
  }

  private listProposalBundles(status: string | undefined, limit: number): CommanderProposalBundleSummary[] {
    return this.proposalBundles.map((bundle) => this.projectProposalBundle(bundle)).filter((bundle) => status === undefined || bundle.status === status).slice(0, limit)
  }

  private addProposalToBundle(bundleId: string, proposalId: string): CommanderProposalBundleSummary {
    const bundle = this.requireProposalBundle(bundleId)
    this.requireMutableProposalBundle(bundle)
    const proposal = this.requireProposal(proposalId)
    if (!bundle.proposal_ids.includes(proposal.proposal_id)) bundle.proposal_ids.push(proposal.proposal_id)
    bundle.updated_at = new Date(0).toISOString()
    return this.projectProposalBundle(bundle)
  }

  private proposalBundleReadiness(bundleId: string): ProposalBundleReadinessSummary {
    const bundle = this.requireProposalBundle(bundleId)
    const blockers: string[] = []
    const proposals = bundle.proposal_ids.map((proposalId) => this.proposals.find((proposal) => proposal.proposal_id === proposalId))
    for (const [index, proposal] of proposals.entries()) {
      if (!proposal) blockers.push(`missing proposal: ${bundle.proposal_ids[index]}`)
      else if (proposal.status !== "approved" && proposal.status !== "applied") blockers.push(`proposal ${proposal.proposal_id} status is ${proposal.status}`)
    }
    if (bundle.status === "cancelled") blockers.push(`bundle ${bundle.bundle_id} is cancelled`)
    return {
      bundle_id: bundle.bundle_id,
      proposal_count: bundle.proposal_ids.length,
      proposed_count: proposals.filter((proposal) => proposal?.status === "proposed").length,
      review_requested_count: proposals.filter((proposal) => proposal?.status === "review_requested").length,
      approved_count: proposals.filter((proposal) => proposal?.status === "approved").length,
      rejected_count: proposals.filter((proposal) => proposal?.status === "rejected").length,
      cancelled_count: proposals.filter((proposal) => proposal?.status === "cancelled").length,
      applied_count: proposals.filter((proposal) => proposal?.status === "applied").length,
      blocked_count: blockers.length,
      ready_to_apply: bundle.status !== "cancelled" && bundle.proposal_ids.length > 0 && blockers.length === 0,
      blockers: blockers.map(redactText),
    }
  }

  private requestProposalBundleReviews(bundleId: string, requestedBy: string): CommanderProposalBundleSummary {
    const bundle = this.requireProposalBundle(bundleId)
    this.requireMutableProposalBundle(bundle)
    for (const proposalId of bundle.proposal_ids) {
      const proposal = this.requireProposal(proposalId)
      if (proposal.status === "proposed") this.requestProposalReview(proposal.proposal_id, { requestedBy })
    }
    bundle.status = "review_requested"
    bundle.updated_at = new Date(0).toISOString()
    return this.projectProposalBundle(bundle)
  }

  private applyProposalBundle(bundleId: string, allowPartial: boolean): CommanderProposalBundleSummary {
    const bundle = this.requireProposalBundle(bundleId)
    this.requireMutableProposalBundle(bundle)
    const readiness = this.proposalBundleReadiness(bundle.bundle_id)
    if (readiness.proposal_count === 0) {
      bundle.status = "partially_applied"
      bundle.failure_reason = "proposal bundle has no proposals to apply"
      throw new Error(bundle.failure_reason)
    }
    if (!allowPartial && !readiness.ready_to_apply) {
      bundle.status = "partially_applied"
      bundle.failure_reason = readiness.blockers.join("; ") || "bundle is not ready to apply"
      throw new Error(`proposal bundle is not ready to apply: ${bundle.failure_reason}`)
    }
    let appliedCount = 0
    let skippedCount = 0
    for (const proposalId of bundle.proposal_ids) {
      const proposal = this.requireProposal(proposalId)
      if (proposal.status === "applied") {
        skippedCount += 1
        continue
      }
      if (proposal.status !== "approved") {
        if (allowPartial) {
          skippedCount += 1
          continue
        }
        throw new Error(`proposal is not approved: ${redactText(proposal.proposal_id)}`)
      }
      this.applyProposal(proposal.proposal_id)
      appliedCount += 1
    }
    if (allowPartial && appliedCount === 0 && skippedCount > 0) {
      bundle.status = "partially_applied"
      bundle.failure_reason = "partial proposal bundle apply did not apply any proposals"
      throw new Error(`proposal bundle apply failed: ${bundle.failure_reason}`)
    }
    bundle.updated_at = new Date(0).toISOString()
    return this.projectProposalBundle(bundle)
  }

  private cancelProposalBundle(bundleId: string, reason?: string): CommanderProposalBundleSummary {
    const bundle = this.requireProposalBundle(bundleId)
    const projected = this.projectProposalBundle(bundle)
    const safeReason = reason === undefined ? undefined : redactText(reason)
    if (projected.status === "cancelled") {
      if (bundle.cancellation_reason === safeReason) return bundle
      throw new Error(`terminal proposal bundle cancellation conflicts with existing payload: ${redactText(bundle.bundle_id)}`)
    }
    if (projected.status === "applied") throw new Error(`applied proposal bundle cannot cancel: ${redactText(bundle.bundle_id)}`)
    bundle.status = "cancelled"
    bundle.updated_at = new Date(0).toISOString()
    bundle.cancelled_at = bundle.updated_at
    bundle.cancellation_reason = safeReason
    return bundle
  }

  private getCommanderPlaybook(playbookId: string): CommanderPlaybookSummary | null {
    const id = requiredString(playbookId, "playbookId")
    const playbook = this.playbooks.find((item) => item.playbook_id === id)
    if (!playbook) throw new Error(`unknown commander playbook: ${redactText(id)}`)
    return playbook
  }

  private draftCommanderPlaybook(payload: Record<string, unknown>): CommanderPlaybookDraftSummary {
    const playbookId = requiredString(String(payload.playbookId ?? payload.playbook_id ?? ""), "playbookId")
    const playbook = this.playbooks.find((item) => item.playbook_id === playbookId)
    if (!playbook) throw new Error(`unknown commander playbook: ${redactText(playbookId)}`)
    const fields = readStringFields(payload.fields)
    for (const field of playbook.required_fields.filter((item) => item.required)) requiredString(String(fields[field.name] ?? ""), field.name)
    const proposedBy = String(payload.proposedBy ?? payload.proposed_by ?? payload.requestedBy ?? payload.requested_by ?? "operator")
    const requestedBy = String(payload.requestedBy ?? payload.requested_by ?? proposedBy)
    const created: CommanderProposalSummary[] = []
    for (const proposalPayload of proposalPayloadsForPlaybook(playbook.playbook_id, fields, proposedBy)) created.push(this.createProposal(proposalPayload))
    const shouldBundle = payload.createBundle === true || payload.create_bundle === true || created.length > 1
    let bundleId: string | undefined
    if (shouldBundle) {
      const bundle = this.createProposalBundle({
        title: payload.bundleTitle ?? payload.bundle_title ?? fields.title ?? playbook.title,
        summary: payload.bundleSummary ?? payload.bundle_summary ?? fields.completion_summary ?? fields.summary ?? fields.reason ?? playbook.description,
        createdBy: proposedBy,
      })
      bundleId = bundle.bundle_id
      for (const proposal of created) this.addProposalToBundle(bundle.bundle_id, proposal.proposal_id)
    }
    let reviewIds: string[] | undefined
    if (payload.requestReviews === true || payload.request_reviews === true) {
      if (bundleId) this.requestProposalBundleReviews(bundleId, requestedBy)
      else for (const proposal of created) this.requestProposalReview(proposal.proposal_id, { requestedBy })
      reviewIds = created.map((proposal) => this.requireProposal(proposal.proposal_id).review_id).filter((reviewId): reviewId is string => typeof reviewId === "string")
    }
    this.sequence += 1
    const draftId = `fake-draft-${this.sequence}`
    const createdAt = new Date(0).toISOString()
    const draft: CommanderWorkbenchDraftSummary = {
      draft_id: draftId,
      playbook_id: playbook.playbook_id,
      status: reviewStatusForDraft(created.length, reviewIds?.length ?? 0),
      proposed_by: redactText(proposedBy),
      field_values: fields,
      proposal_ids: created.map((proposal) => proposal.proposal_id),
      bundle_id: bundleId,
      review_ids: reviewIds,
      created_at: createdAt,
      updated_at: createdAt,
    }
    this.playbookDrafts.unshift(draft)
    return {
      draft_id: draftId,
      playbook_id: playbook.playbook_id,
      proposal_ids: created.map((proposal) => proposal.proposal_id),
      bundle_id: bundleId,
      review_ids: reviewIds,
      created_at: createdAt,
    }
  }

  private getCommanderPlaybookDraft(draftId: string): CommanderWorkbenchDraftSummary | null {
    const id = requiredString(draftId, "draftId")
    return this.playbookDrafts.find((draft) => draft.draft_id === id) ?? null
  }

  private listCommanderPlaybookDrafts(status: string | undefined, limit: number): CommanderWorkbenchDraftSummary[] {
    return this.playbookDrafts.filter((draft) => status === undefined || draft.status === status).slice(0, limit)
  }

  private playbookDraftSummary(): CommanderWorkbenchStatusSummary {
    return {
      drafted_count: this.playbookDrafts.filter((draft) => draft.status === "drafted").length,
      review_requested_count: this.playbookDrafts.filter((draft) => draft.status === "review_requested").length,
      partially_review_requested_count: this.playbookDrafts.filter((draft) => draft.status === "partially_review_requested").length,
      cancelled_count: this.playbookDrafts.filter((draft) => draft.status === "cancelled").length,
      last_draft_id: this.playbookDrafts[0]?.draft_id,
    }
  }

  private commanderPlaybookDraftReadiness(draftId: string): CommanderWorkbenchReadinessSummary {
    const draft = this.requireCommanderPlaybookDraft(draftId)
    const blockers: string[] = []
    let approved = 0
    let rejected = 0
    let cancelled = 0
    let applied = 0
    const reviewIds: string[] = []
    for (const proposalId of draft.proposal_ids) {
      const proposal = this.requireProposal(proposalId)
      if (proposal.status === "applied") applied += 1
      if (proposal.review_id) reviewIds.push(proposal.review_id)
      else blockers.push(`proposal ${proposal.proposal_id} has no linked review`)
      if (proposal.status !== "approved" && proposal.status !== "applied") blockers.push(`proposal ${proposal.proposal_id} status is ${proposal.status}`)
    }
    for (const reviewId of reviewIds) {
      const review = this.reviews.find((item) => item.review_id === reviewId)
      if (!review) blockers.push(`missing review: ${reviewId}`)
      else if (review.status === "approved") approved += 1
      else if (review.status === "rejected") rejected += 1
      else if (review.status === "cancelled") cancelled += 1
      else blockers.push(`review ${review.review_id} status is ${review.status}`)
    }
    if (draft.status === "cancelled") blockers.push(`draft ${draft.draft_id} is cancelled`)
    return {
      draft_id: draft.draft_id,
      proposal_count: draft.proposal_ids.length,
      bundle_id: draft.bundle_id,
      review_count: reviewIds.length,
      missing_review_count: Math.max(0, draft.proposal_ids.length - reviewIds.length),
      approved_review_count: approved,
      rejected_review_count: rejected,
      cancelled_review_count: cancelled,
      applied_proposal_count: applied,
      blockers: blockers.map(redactText),
      ready_to_apply: draft.status !== "cancelled" && draft.proposal_ids.length > 0 && blockers.length === 0,
    }
  }

  private requestCommanderPlaybookDraftReviews(draftId: string, requestedBy: string): CommanderWorkbenchDraftSummary {
    const draft = this.requireCommanderPlaybookDraft(draftId)
    if (draft.status === "cancelled") throw new Error(`cancelled playbook draft cannot request reviews: ${redactText(draft.draft_id)}`)
    const existingReviewIds = draft.proposal_ids.map((proposalId) => this.requireProposal(proposalId).review_id).filter((reviewId): reviewId is string => typeof reviewId === "string")
    const hasMissingReviews = existingReviewIds.length < draft.proposal_ids.length
    if (draft.bundle_id && hasMissingReviews) this.requestProposalBundleReviews(draft.bundle_id, requestedBy)
    else {
      for (const proposalId of draft.proposal_ids) {
        const proposal = this.requireProposal(proposalId)
        if (!proposal.review_id) this.requestProposalReview(proposal.proposal_id, { requestedBy })
      }
    }
    const reviewIds = draft.proposal_ids.map((proposalId) => this.requireProposal(proposalId).review_id).filter((reviewId): reviewId is string => typeof reviewId === "string")
    draft.review_ids = reviewIds
    draft.status = reviewStatusForDraft(draft.proposal_ids.length, reviewIds.length)
    draft.updated_at = new Date(0).toISOString()
    return draft
  }

  private cancelCommanderPlaybookDraft(draftId: string, reason?: string): CommanderWorkbenchDraftSummary {
    const draft = this.requireCommanderPlaybookDraft(draftId)
    const safeReason = reason === undefined ? undefined : redactText(reason)
    if (draft.status === "cancelled") {
      if (draft.cancellation_reason === safeReason) return draft
      throw new Error(`terminal playbook draft cancellation conflicts with existing payload: ${redactText(draft.draft_id)}`)
    }
    draft.status = "cancelled"
    draft.updated_at = new Date(0).toISOString()
    draft.cancelled_at = draft.updated_at
    draft.cancellation_reason = safeReason
    return draft
  }

  private requireCommanderPlaybookDraft(draftId: string): CommanderWorkbenchDraftSummary {
    const id = requiredString(draftId, "draftId")
    const draft = this.playbookDrafts.find((item) => item.draft_id === id)
    if (!draft) throw new Error(`commander playbook draft not found: ${redactText(id)}`)
    return draft
  }

  private commanderApplyPreview(targetType: string, targetId: string): CommanderApplyPreviewSummary {
    const target = readApplyTarget(targetType, targetId)
    if (target.targetType === "proposal") return this.proposalApplyPreview(target.targetId)
    if (target.targetType === "bundle") return this.bundleApplyPreview(target.targetId, "bundle")
    return this.draftApplyPreview(target.targetId)
  }

  private applyCommanderTarget(targetType: string, targetId: string, allowPartial: boolean, dryRun: boolean): CommanderApplyResultSummary {
    const target = readApplyTarget(targetType, targetId)
    const preview = this.commanderApplyPreview(target.targetType, target.targetId)
    if (dryRun) {
      return {
        target_type: target.targetType,
        target_id: target.targetId,
        applied: false,
        applied_proposal_ids: [],
        skipped_proposal_ids: [...preview.proposal_ids],
        result_summary: "dry run; no proposals applied",
        created_at: new Date(0).toISOString(),
      }
    }
    if (!preview.ready_to_apply && !allowPartial) throw new Error(`commander apply target is not ready: ${preview.blockers.join("; ") || "blocked"}`)
    if (allowPartial && preview.would_apply.length === 0) throw new Error("partial commander apply did not have any approved proposals to apply")
    const before = new Map(preview.proposal_ids.map((proposalId) => [proposalId, this.requireProposal(proposalId).status]))
    if (preview.apply_mode === "single") {
      if (preview.would_apply.length > 0) this.applyProposal(target.targetId)
    } else if (preview.apply_mode === "bundle" || preview.apply_mode === "draft_bundle") {
      if (preview.bundle_id && preview.would_apply.length > 0) this.applyProposalBundle(preview.bundle_id, allowPartial)
    } else {
      for (const proposalId of preview.proposal_ids) {
        const proposal = this.requireProposal(proposalId)
        if (proposal.status === "approved") this.applyProposal(proposal.proposal_id)
        else if (proposal.status !== "applied" && !allowPartial) throw new Error(`proposal is not approved: ${redactText(proposal.proposal_id)}`)
      }
    }
    const appliedProposalIds = preview.proposal_ids.filter((proposalId) => before.get(proposalId) !== "applied" && this.requireProposal(proposalId).status === "applied")
    const skippedProposalIds = preview.proposal_ids.filter((proposalId) => !appliedProposalIds.includes(proposalId))
    return {
      target_type: target.targetType,
      target_id: target.targetId,
      applied: appliedProposalIds.length > 0,
      applied_proposal_ids: appliedProposalIds,
      skipped_proposal_ids: skippedProposalIds,
      result_summary: appliedProposalIds.length > 0 ? `applied ${appliedProposalIds.length} proposal(s); skipped ${skippedProposalIds.length}` : `no new proposals applied; skipped ${skippedProposalIds.length}`,
      created_at: new Date(0).toISOString(),
    }
  }

  private proposalApplyPreview(proposalId: string): CommanderApplyPreviewSummary {
    const proposal = this.requireProposal(proposalId)
    const blockers = fakeProposalBlockers(proposal)
    return {
      target_type: "proposal",
      target_id: proposal.proposal_id,
      ready_to_apply: blockers.length === 0,
      proposal_ids: [proposal.proposal_id],
      approved_count: proposal.status === "approved" ? 1 : 0,
      applied_count: proposal.status === "applied" ? 1 : 0,
      blocked_count: blockers.length,
      blockers,
      apply_mode: "single",
      would_apply: proposal.status === "approved" ? [proposal.proposal_id] : [],
      would_skip: proposal.status === "applied" ? [proposal.proposal_id] : [],
    }
  }

  private bundleApplyPreview(bundleId: string, applyMode: "bundle" | "draft_bundle", draftId?: string): CommanderApplyPreviewSummary {
    const bundle = this.requireProposalBundle(bundleId)
    const readiness = this.proposalBundleReadiness(bundle.bundle_id)
    return {
      target_type: draftId ? "draft" : "bundle",
      target_id: draftId ?? bundle.bundle_id,
      ready_to_apply: readiness.ready_to_apply,
      proposal_ids: [...bundle.proposal_ids],
      bundle_id: bundle.bundle_id,
      draft_id: draftId,
      approved_count: readiness.approved_count,
      applied_count: readiness.applied_count,
      blocked_count: readiness.blocked_count,
      blockers: readiness.blockers,
      apply_mode: applyMode,
      would_apply: bundle.proposal_ids.filter((proposalId) => this.requireProposal(proposalId).status === "approved"),
      would_skip: bundle.proposal_ids.filter((proposalId) => this.requireProposal(proposalId).status === "applied"),
    }
  }

  private draftApplyPreview(draftId: string): CommanderApplyPreviewSummary {
    const draft = this.requireCommanderPlaybookDraft(draftId)
    const cancelledBlocker = draft.status === "cancelled" ? `draft ${draft.draft_id} is cancelled` : undefined
    if (draft.bundle_id) {
      const preview = this.bundleApplyPreview(draft.bundle_id, "draft_bundle", draft.draft_id)
      if (!cancelledBlocker) return preview
      return {
        ...preview,
        ready_to_apply: false,
        blocked_count: preview.blocked_count + 1,
        blockers: [...preview.blockers, redactText(cancelledBlocker)],
        would_apply: [],
      }
    }
    const blockers = draft.proposal_ids.flatMap((proposalId) => fakeProposalBlockers(this.requireProposal(proposalId)))
    if (cancelledBlocker) blockers.push(cancelledBlocker)
    return {
      target_type: "draft",
      target_id: draft.draft_id,
      ready_to_apply: blockers.length === 0 && draft.proposal_ids.length > 0,
      proposal_ids: [...draft.proposal_ids],
      draft_id: draft.draft_id,
      approved_count: draft.proposal_ids.filter((proposalId) => this.requireProposal(proposalId).status === "approved").length,
      applied_count: draft.proposal_ids.filter((proposalId) => this.requireProposal(proposalId).status === "applied").length,
      blocked_count: blockers.length,
      blockers: blockers.map(redactText),
      apply_mode: "draft_proposals",
      would_apply: cancelledBlocker ? [] : draft.proposal_ids.filter((proposalId) => this.requireProposal(proposalId).status === "approved"),
      would_skip: draft.proposal_ids.filter((proposalId) => this.requireProposal(proposalId).status === "applied"),
    }
  }

  private commanderAuditTimeline(category: string | undefined, limit: number, targetType?: string, targetId?: string): { events: CommanderAuditEventSummary[]; total_considered: number; next_after_event_id?: string; next_before_event_id?: string } {
    const events = this.fakeAuditEvents()
      .filter((event) => !category || event.category === category)
      .filter((event) => !targetType || !targetId || auditEventMatches(event, targetType, targetId))
    const recent = [...events].reverse().slice(0, limit)
    return {
      events: recent,
      total_considered: events.length,
      next_after_event_id: recent.at(0)?.event_id,
      next_before_event_id: events.length > recent.length ? recent.at(-1)?.event_id : undefined,
    }
  }

  private commanderAuthorityChain(targetType: string, targetId: string): CommanderAuthorityChainSummary {
    const cleanTarget = readAuditTarget(targetType, targetId)
    const events = this.fakeAuditEvents()
    const related = new Set<string>([`${cleanTarget.targetType}:${cleanTarget.targetId}`])
    for (let depth = 0; depth < 3; depth += 1) {
      let expanded = false
      for (const event of events) {
        if (!auditEventMatchesAny(event, related)) continue
        for (const [key, values] of Object.entries(event.related_ids)) {
          const type = auditKeyToType(key)
          if (!type) continue
          for (const value of values) {
            const encoded = `${type}:${value}`
            if (!related.has(encoded)) {
              related.add(encoded)
              expanded = true
            }
          }
        }
      }
      if (!expanded) break
    }
    const chainEvents = events.filter((event) => auditEventMatchesAny(event, related))
    return {
      target_type: cleanTarget.targetType,
      target_id: cleanTarget.targetId,
      related_ids: auditRelatedRecord(related),
      events: chainEvents,
      missing_links: chainEvents.length === 0 ? [`no audit events found for ${cleanTarget.targetType} ${cleanTarget.targetId}`] : [],
    }
  }

  private fakeAuditEvents(): CommanderAuditEventSummary[] {
    const events: CommanderAuditEventSummary[] = []
    for (const mission of [...this.missions].reverse()) {
      events.push(fakeAuditEvent(events.length, "mission_created", "mission", "mission", mission.mission_id, { mission_id: [mission.mission_id], intent_id: mission.intent_id ? [mission.intent_id] : [] }, mission.status))
    }
    for (const claim of [...this.claims].reverse()) {
      events.push(fakeAuditEvent(events.length, "mission_claimed", "mission", "claim", claim.claim_id, { mission_id: [claim.mission_id], claim_id: [claim.claim_id] }, claim.status))
    }
    for (const item of [...this.progress].reverse()) {
      events.push(fakeAuditEvent(events.length, "mission_progress_recorded", "mission", "mission", item.mission_id, { mission_id: [item.mission_id], claim_id: [item.claim_id], progress_id: [item.progress_id] }, item.message))
    }
    for (const result of [...this.results].reverse()) {
      events.push(fakeAuditEvent(events.length, "mission_result_submitted", "mission", "result", result.result_id, { mission_id: [result.mission_id], claim_id: [result.claim_id], result_id: [result.result_id] }, result.summary))
    }
    for (const review of [...this.reviews].reverse()) {
      events.push(fakeAuditEvent(events.length, review.status === "pending" ? "review_request_created" : `review_request_${review.status}`, "review", "review", review.review_id, { review_id: [review.review_id], mission_id: review.mission_id ? [review.mission_id] : [], claim_id: review.claim_id ? [review.claim_id] : [], result_id: review.result_id ? [review.result_id] : [] }, review.title))
    }
    for (const proposal of [...this.proposals].reverse()) {
      events.push(fakeAuditEvent(events.length, "commander_proposal_created", "proposal", "proposal", proposal.proposal_id, { proposal_id: [proposal.proposal_id], review_id: proposal.review_id ? [proposal.review_id] : [], mission_id: proposal.mission_id ? [proposal.mission_id] : [], claim_id: proposal.claim_id ? [proposal.claim_id] : [], result_id: proposal.result_id ? [proposal.result_id] : [] }, proposal.action_kind))
      if (proposal.status === "applied") events.push(fakeAuditEvent(events.length, "commander_proposal_applied", "apply", "proposal", proposal.proposal_id, { proposal_id: [proposal.proposal_id], review_id: proposal.review_id ? [proposal.review_id] : [], mission_id: proposal.mission_id ? [proposal.mission_id] : [], claim_id: proposal.claim_id ? [proposal.claim_id] : [] }, proposal.application_result ?? "applied"))
    }
    for (const bundle of [...this.proposalBundles].reverse()) {
      events.push(fakeAuditEvent(events.length, "commander_proposal_bundle_created", "proposal_bundle", "bundle", bundle.bundle_id, { bundle_id: [bundle.bundle_id], proposal_id: bundle.proposal_ids }, bundle.status))
    }
    for (const draft of [...this.playbookDrafts].reverse()) {
      events.push(fakeAuditEvent(events.length, "commander_playbook_draft_created", "playbook_draft", "draft", draft.draft_id, { draft_id: [draft.draft_id], proposal_id: draft.proposal_ids, bundle_id: draft.bundle_id ? [draft.bundle_id] : [], review_id: draft.review_ids ?? [] }, draft.playbook_id))
    }
    if (events.length === 0) events.push(fakeAuditEvent(0, "runtime_started", "runtime", "runtime", "fake-runtime", { runtime_id: ["fake-runtime"] }, "fake runtime connected"))
    return events
  }

  private projectProposalBundle(bundle: CommanderProposalBundleSummary): CommanderProposalBundleSummary {
    if (bundle.status === "cancelled") return bundle
    const readiness = this.proposalBundleReadiness(bundle.bundle_id)
    let status = "open"
    if (readiness.proposal_count > 0 && readiness.applied_count === readiness.proposal_count) status = "applied"
    else if (readiness.applied_count > 0) status = "partially_applied"
    else if (readiness.proposal_count > 0 && readiness.approved_count === readiness.proposal_count) status = "approved"
    else if (readiness.approved_count > 0) status = "partially_approved"
    else if (readiness.review_requested_count > 0) status = "review_requested"
    return { ...bundle, status }
  }

  private requireProposalBundle(bundleId: string): CommanderProposalBundleSummary {
    const id = requiredString(bundleId, "bundleId")
    const bundle = this.proposalBundles.find((item) => item.bundle_id === id)
    if (!bundle) throw new Error(`commander proposal bundle not found: ${redactText(id)}`)
    return bundle
  }

  private requireMutableProposalBundle(bundle: CommanderProposalBundleSummary): void {
    const projected = this.projectProposalBundle(bundle)
    if (projected.status === "cancelled" || projected.status === "applied") throw new Error(`terminal proposal bundle cannot be changed: ${redactText(bundle.bundle_id)}`)
  }

  private requireProposal(proposalId: string): CommanderProposalSummary {
    const id = requiredString(proposalId, "proposalId")
    const proposal = this.proposals.find((item) => item.proposal_id === id)
    if (!proposal) throw new Error(`commander proposal not found: ${redactText(id)}`)
    return proposal
  }

  private requireClaim(claimId: string, missionId?: string): ExecutorClaimSummary {
    const id = requiredString(claimId, "claimId")
    const claim = this.claims.find((item) => item.claim_id === id && (missionId === undefined || item.mission_id === missionId))
    if (!claim) throw new Error(`unknown mission claim: ${redactText(id)}`)
    return claim
  }

  private missionSummary() {
    return {
      pending_count: this.missions.filter((mission) => mission.status === "created" || mission.status === "sent").length,
      failed_count: this.missions.filter((mission) => mission.status === "failed").length,
      active_claim_count: this.missions.filter((mission) => mission.status === "claimed" || mission.status === "running").length,
      completed_count: this.missions.filter((mission) => mission.status === "completed").length,
      cancelled_count: this.missions.filter((mission) => mission.status === "cancelled").length,
      last_mission_id: this.missions[0]?.mission_id,
    }
  }

  private reviewSummary() {
    return {
      pending_count: this.reviews.filter((review) => review.status === "pending").length,
      approved_count: this.reviews.filter((review) => review.status === "approved").length,
      rejected_count: this.reviews.filter((review) => review.status === "rejected").length,
      cancelled_count: this.reviews.filter((review) => review.status === "cancelled").length,
      last_review_id: this.reviews[0]?.review_id,
    }
  }

  private proposalSummary() {
    return {
      proposed_count: this.proposals.filter((proposal) => proposal.status === "proposed").length,
      review_requested_count: this.proposals.filter((proposal) => proposal.status === "review_requested").length,
      approved_count: this.proposals.filter((proposal) => proposal.status === "approved").length,
      rejected_count: this.proposals.filter((proposal) => proposal.status === "rejected").length,
      cancelled_count: this.proposals.filter((proposal) => proposal.status === "cancelled").length,
      applied_count: this.proposals.filter((proposal) => proposal.status === "applied").length,
      last_proposal_id: this.proposals[0]?.proposal_id,
    }
  }

  private proposalBundleSummary() {
    const projected = this.proposalBundles.map((bundle) => this.projectProposalBundle(bundle))
    return {
      open_count: projected.filter((bundle) => bundle.status === "open").length,
      review_requested_count: projected.filter((bundle) => bundle.status === "review_requested").length,
      approved_count: projected.filter((bundle) => bundle.status === "approved").length,
      partially_approved_count: projected.filter((bundle) => bundle.status === "partially_approved").length,
      applied_count: projected.filter((bundle) => bundle.status === "applied").length,
      partially_applied_count: projected.filter((bundle) => bundle.status === "partially_applied").length,
      cancelled_count: projected.filter((bundle) => bundle.status === "cancelled").length,
      last_bundle_id: this.proposalBundles[0]?.bundle_id,
    }
  }

  private researchTopics() {
    return [
      {
        id: "fake-topic-1",
        title: "Fake runtime research topic",
        status: "active",
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
      },
      {
        id: "fake-topic-2",
        title: "Projection rebuild notes",
        status: "open",
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
      },
    ]
  }

  private topicSnapshot(topicId: string) {
    const topic = this.researchTopics().find((item) => item.id === topicId)
    if (!topic) return null
    return {
      topic,
      sources: [],
      notes: this.searchNotes(topicId, ""),
      artifacts: [],
      stats: {
        source_count: 1,
        note_count: 1,
        artifact_count: 0,
        report_count: 0,
        reviewed_source_count: 1,
        rejected_source_count: 0,
      },
      latest_event: this.researchEvents(1)[0],
    }
  }

  private searchNotes(topicId: string, query: string) {
    const note = {
      id: "fake-note-1",
      topic_id: topicId || "fake-topic-1",
      source_id: "fake-source-1",
      content: `Fake research note for ${query || "runtime projection"}`,
      tags: ["fake", "projection"],
      created_at: new Date(0).toISOString(),
    }
    return topicId && topicId !== "fake-topic-1" && topicId !== "fake-topic-2" ? [] : [note]
  }

  private researchEvents(limit: number) {
    return [
      {
        event_id: "fake-research-event-1",
        event_type: "topic_created",
        entity_type: "topic",
        entity_id: "fake-topic-1",
        payload: { title: "not rendered" },
        created_at: new Date(0).toISOString(),
      },
    ].slice(0, limit)
  }

  private projectionStatus() {
    return {
      mode: "disabled",
      ok: true,
      stale: false,
      reason: this.projectionRebuilds > 0 ? "rebuilt" : "disabled",
      pending_count: 0,
      last_event_id: "fake-research-event-1",
      checked_at: new Date(0).toISOString(),
    }
  }
}

function readLimit(value: unknown, fallback: number): number {
  if (!Number.isInteger(value) || Number(value) < 1) return fallback
  return Math.min(Number(value), 100)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requiredString(value: string, name: string): string {
  const cleaned = value.trim()
  if (!cleaned) throw new Error(`${name} is required`)
  return cleaned
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const cleaned = value.trim()
  return cleaned ? cleaned : undefined
}

function reviewStatusForDraft(proposalCount: number, reviewCount: number): string {
  if (reviewCount <= 0) return "drafted"
  if (reviewCount >= proposalCount) return "review_requested"
  return "partially_review_requested"
}

function readApplyTarget(targetType: string, targetId: string): { targetType: "proposal" | "bundle" | "draft"; targetId: string } {
  if (targetType !== "proposal" && targetType !== "bundle" && targetType !== "draft") throw new Error("targetType must be proposal, bundle, or draft")
  return { targetType, targetId: requiredString(targetId, "targetId") }
}

function readAuditTarget(targetType: string, targetId: string): { targetType: string; targetId: string } {
  if (!["mission", "claim", "result", "review", "proposal", "bundle", "draft", "runtime"].includes(targetType)) throw new Error("targetType must be mission, claim, result, review, proposal, bundle, draft, or runtime")
  return { targetType, targetId: requiredString(targetId, "targetId") }
}

function fakeAuditEvent(
  index: number,
  kind: string,
  category: string,
  targetType: string,
  targetId: string,
  relatedIds: Record<string, string[] | undefined>,
  summary: string,
): CommanderAuditEventSummary {
  const cleanRelated: Record<string, string[]> = {}
  for (const [key, values] of Object.entries(relatedIds)) {
    const clean = (values ?? []).filter((value) => typeof value === "string" && value.trim()).map(redactText).sort()
    if (clean.length > 0) cleanRelated[key] = clean
  }
  return {
    event_id: `fake-audit-${index}`,
    event_index: index,
    kind,
    category,
    target_type: targetType,
    target_id: redactText(targetId),
    related_ids: cleanRelated,
    created_at: new Date(0).toISOString(),
    title: `${kind} ${redactText(targetId)}`,
    summary: redactText(summary),
  }
}

function auditEventMatches(event: CommanderAuditEventSummary, targetType: string, targetId: string): boolean {
  return event.target_type === targetType && event.target_id === targetId
    || event.related_ids[`${targetType}_id`]?.includes(targetId) === true
    || targetType === "runtime" && event.related_ids.intent_id?.includes(targetId) === true
}

function auditEventMatchesAny(event: CommanderAuditEventSummary, related: Set<string>): boolean {
  for (const item of related) {
    const [targetType, targetId] = item.split(":", 2)
    if (auditEventMatches(event, targetType, targetId)) return true
  }
  return false
}

function auditKeyToType(key: string): string | undefined {
  if (key.endsWith("_id")) return key.slice(0, -3)
  return undefined
}

function auditRelatedRecord(related: Set<string>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const item of related) {
    const [targetType, targetId] = item.split(":", 2)
    const key = `${targetType}_id`
    out[key] = [...(out[key] ?? []), targetId].sort()
  }
  return out
}

function fakeProposalBlockers(proposal: CommanderProposalSummary): string[] {
  if (proposal.status === "approved" || proposal.status === "applied") return []
  if (proposal.status === "rejected" || proposal.status === "cancelled") return [`proposal ${proposal.proposal_id} is ${proposal.status}`]
  if (!proposal.review_id) return [`proposal ${proposal.proposal_id} has no linked review`]
  return [`proposal ${proposal.proposal_id} status is ${proposal.status}`]
}

function requiredActionString(proposal: CommanderProposalSummary, payload: Record<string, unknown>, field: "mission_id" | "claim_id" | "result_id"): string {
  const value = optionalActionString(proposal, payload, field)
  if (!value) throw new Error(`${field} is required`)
  return value
}

function optionalActionString(proposal: CommanderProposalSummary, payload: Record<string, unknown>, field: "mission_id" | "claim_id" | "result_id"): string | undefined {
  const topLevel = field === "mission_id" ? proposal.mission_id : field === "claim_id" ? proposal.claim_id : proposal.result_id
  const payloadValue = optionalString(payload[field])
  if (topLevel && payloadValue && payloadValue !== topLevel) throw new Error(`${field} conflicts with reviewed proposal target`)
  return topLevel ?? payloadValue
}

function isTerminalMissionStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled"
}

function reviewTypeForProposal(actionKind: string): string {
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
    default:
      return "operator_checkpoint"
  }
}

function fakeCommanderPlaybooks(): CommanderPlaybookSummary[] {
  return [
    {
      playbook_id: "complete-from-result",
      title: "Complete mission from result",
      description: "Drafts a complete_mission proposal that references an existing mission result.",
      required_fields: playbookFields(["mission_id", "result_id", "title", "summary"]),
      generated_action_kinds: ["complete_mission"],
      creates_bundle: false,
    },
    {
      playbook_id: "submit-result-and-complete",
      title: "Submit result and complete mission",
      description: "Drafts submit_result and complete_mission proposals as an ordered bundle.",
      required_fields: playbookFields(["mission_id", "claim_id", "result_summary", "completion_summary", "title"]),
      generated_action_kinds: ["submit_result", "complete_mission"],
      creates_bundle: true,
    },
    {
      playbook_id: "record-progress",
      title: "Record mission progress",
      description: "Drafts a record_progress proposal for an active mission claim.",
      required_fields: playbookFields(["mission_id", "claim_id", "message", "title"]),
      generated_action_kinds: ["record_progress"],
      creates_bundle: false,
    },
    {
      playbook_id: "fail-mission",
      title: "Fail mission",
      description: "Drafts a fail_mission proposal with an explicit reason.",
      required_fields: playbookFields(["mission_id", "reason", "title"]),
      generated_action_kinds: ["fail_mission"],
      creates_bundle: false,
    },
    {
      playbook_id: "cancel-mission",
      title: "Cancel mission",
      description: "Drafts a cancel_mission proposal with an explicit reason.",
      required_fields: playbookFields(["mission_id", "reason", "title"]),
      generated_action_kinds: ["cancel_mission"],
      creates_bundle: false,
    },
    {
      playbook_id: "release-claim",
      title: "Release claim",
      description: "Drafts a release_claim proposal with an explicit reason.",
      required_fields: playbookFields(["claim_id", "reason", "title"]),
      generated_action_kinds: ["release_claim"],
      creates_bundle: false,
    },
  ]
}

function playbookFields(names: string[]): CommanderPlaybookSummary["required_fields"] {
  return names.map((name) => ({
    name,
    label: name.split("_").map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" "),
    required: true,
    field_type: name.endsWith("_id") ? name : name === "reason" ? "reason" : name === "title" ? "title" : name === "message" ? "text" : "summary",
  }))
}

function readStringFields(value: unknown): Record<string, string> {
  if (!isRecord(value)) throw new Error("fields must be an object")
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) out[requiredString(key, "field name")] = requiredString(String(raw ?? ""), key)
  return out
}

function proposalPayloadsForPlaybook(playbookId: string, fields: Record<string, string>, proposedBy: string): Record<string, unknown>[] {
  switch (playbookId) {
    case "complete-from-result":
      return [{
        missionId: fields.mission_id,
        resultId: fields.result_id,
        actionKind: "complete_mission",
        title: fields.title,
        summary: fields.summary,
        proposedBy,
        actionPayload: { mission_id: fields.mission_id, result_id: fields.result_id, summary: fields.summary },
      }]
    case "submit-result-and-complete":
      return [
        {
          missionId: fields.mission_id,
          claimId: fields.claim_id,
          actionKind: "submit_result",
          title: fields.title,
          summary: fields.result_summary,
          proposedBy,
          actionPayload: { mission_id: fields.mission_id, claim_id: fields.claim_id, summary: fields.result_summary },
        },
        {
          missionId: fields.mission_id,
          actionKind: "complete_mission",
          title: fields.title,
          summary: fields.completion_summary,
          proposedBy,
          actionPayload: { mission_id: fields.mission_id, summary: fields.completion_summary },
        },
      ]
    case "record-progress":
      return [{
        missionId: fields.mission_id,
        claimId: fields.claim_id,
        actionKind: "record_progress",
        title: fields.title,
        summary: fields.message,
        proposedBy,
        actionPayload: { mission_id: fields.mission_id, claim_id: fields.claim_id, message: fields.message },
      }]
    case "fail-mission":
      return [{
        missionId: fields.mission_id,
        actionKind: "fail_mission",
        title: fields.title,
        summary: fields.reason,
        proposedBy,
        actionPayload: { mission_id: fields.mission_id, reason: fields.reason },
      }]
    case "cancel-mission":
      return [{
        missionId: fields.mission_id,
        actionKind: "cancel_mission",
        title: fields.title,
        summary: fields.reason,
        proposedBy,
        actionPayload: { mission_id: fields.mission_id, reason: fields.reason },
      }]
    case "release-claim":
      return [{
        claimId: fields.claim_id,
        actionKind: "release_claim",
        title: fields.title,
        summary: fields.reason,
        proposedBy,
        actionPayload: { claim_id: fields.claim_id, reason: fields.reason },
      }]
    default:
      throw new Error(`unknown commander playbook: ${redactText(playbookId)}`)
  }
}
