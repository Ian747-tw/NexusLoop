import { existsSync } from "fs"
import { createHash } from "crypto"
import { join } from "path"
import type { RuntimeEvent } from "./events"
import { redactText, redactUnknown } from "./redaction"
import type { CommanderApplyPreviewSummary, CommanderApplyResultSummary, CommanderAuditEventSummary, CommanderAuthorityChainSummary, CommanderCyclePreviewSummary, CommanderCycleRecordSummary, CommanderCycleResultSummary, CommanderExecutorReviewPreviewSummary, CommanderExecutorReviewRecordSummary, CommanderExecutorReviewResultSummary, CommanderPlaybookDraftSummary, CommanderPlaybookSummary, CommanderProposalBundleSummary, CommanderProposalSummary, CommanderQueueItemSummary, CommanderQueueKind, CommanderQueueSummary, CommanderTargetContextSummary, CommanderTargetType, CommanderWorkbenchDraftSummary, CommanderWorkbenchReadinessSummary, CommanderWorkbenchStatusSummary, ContinuationPlanPreviewSummary, ContinuationPlanRecordSummary, ContinuationPlanSummary, ContinuationStepResultSummary, ExecutorClaimSummary, ExecutorReviewProposalApplyReadinessPreviewSummary, ExecutorReviewProposalApplyReadinessRecordSummary, ExecutorReviewProposalApplyReadinessSummary, ExecutorReviewProposalCreatePreviewSummary, ExecutorReviewProposalCreateRecordSummary, ExecutorReviewProposalCreateResultSummary, ExecutorReviewProposalDraftCandidateSummary, ExecutorReviewProposalDraftPreviewSummary, ExecutorReviewProposalDraftSummary, ExecutorReviewProposalReviewDecisionPreviewSummary, ExecutorReviewProposalReviewDecisionRecordSummary, ExecutorReviewProposalReviewDecisionResultSummary, ExecutorReviewProposalReviewRequestPreviewSummary, ExecutorReviewProposalReviewRequestRecordSummary, ExecutorReviewProposalReviewRequestResultSummary, ExternalApiAuditRecordSummary, ExternalApiConnectorSummary, ExternalApiResearchIngestionPreviewSummary, ExternalApiResearchIngestionRecordSummary, ExternalApiResearchIngestionResultSummary, ExternalApiRequestPreviewSummary, ExternalApiRequestResultSummary, MiniMaxLiveValidationPreviewSummary, MiniMaxLiveValidationRecordSummary, MiniMaxLiveValidationResultSummary, MiniMaxLiveValidationSurfaceResultSummary, MissionProgressSummary, MissionRecord, MissionResultSummary, OpenCodeHandoffFollowupCounts, OpenCodeHandoffFollowupQueueKind, OpenCodeHandoffFollowupSummary, OpenCodeHandoffPreviewSummary, OpenCodeHandoffReadinessPreviewSummary, OpenCodeHandoffReadinessSummary, OpenCodeHandoffRecordSummary, OpenCodeHandoffResultSummary, OpenCodeProcessSmokePreviewSummary, OpenCodeProcessSmokeRecordSummary, OpenCodeProcessSmokeResultSummary, OpenCodeResultReviewPacketSummary, OpenCodeResultReviewSummary, ProposalBundleReadinessSummary, ResearchSynthesisPreviewSummary, ResearchSynthesisRecordSummary, ResearchSynthesisResultSummary, ReviewRequestSummary, RuntimeCheckpointPreviewSummary, RuntimeCheckpointRecordSummary, RuntimeCheckpointScope, RuntimeCheckpointSummary, RuntimeRestorePreviewSummary, RuntimeResumeAnchorSummary, WakeAssessmentPreviewSummary, WakeAssessmentRecordSummary, WakeAssessmentSummary, WakeSchedulePreviewSummary, WakeScheduleRecordSummary, WakeScheduleSummary, WakeSchedulerAuditChainSummary, WakeSchedulerAuditCommandSummary, WakeSchedulerAuditIncidentSummary, WakeSchedulerAuditSummarySummary, WakeSchedulerAuditTimelineEntrySummary, WakeSchedulerBootstrapStatusSummary, WakeSchedulerEventRecordSummary, WakeSchedulerNavigationBoardSummary, WakeSchedulerNavigationCardSummary, WakeSchedulerNavigationCheckpointApprovalUsageSummaryState, WakeSchedulerNavigationCheckpointWriteGroupSummary, WakeSchedulerNavigationCheckpointWriteHistorySummary, WakeSchedulerNavigationCheckpointWritePairComparisonSummary, WakeSchedulerNavigationCheckpointWriteRunPreviewSummary, WakeSchedulerNavigationCheckpointWriteRunRecordSummary, WakeSchedulerNavigationCheckpointWriteRunResultSummary, WakeSchedulerNavigationCheckpointWriteStaleItemSummary, WakeSchedulerNavigationCommandPreviewSummary, WakeSchedulerNavigationStagePreviewSummary, WakeSchedulerNavigationStagedReadGroupSummary, WakeSchedulerNavigationStagedReadHistorySummary, WakeSchedulerNavigationStagedReadPairComparisonSummary, WakeSchedulerNavigationStagedReadStaleItemSummary, WakeSchedulerNavigationStagedRunPreviewSummary, WakeSchedulerNavigationStagedRunRecordSummary, WakeSchedulerNavigationStagedRunResultSummary, WakeSchedulerNavigationStagedCommandRecordSummary, WakeSchedulerNavigationStagedCommandSummary, WakeSchedulerNavigationStagedWriteCommandRecordSummary, WakeSchedulerNavigationStagedWriteCommandSummary, WakeSchedulerNavigationTargetKindSummary, WakeSchedulerNavigationTargetSummary, WakeSchedulerNavigationWriteApprovalRecordSummary, WakeSchedulerNavigationWriteApprovalSummary, WakeSchedulerNavigationWriteReadinessPreviewSummary, WakeSchedulerNavigationWriteBoardSummary, WakeSchedulerNavigationWritePreviewSummary, WakeSchedulerNavigationWriteRunGroupSummary, WakeSchedulerNavigationWriteRunHistorySummary, WakeSchedulerNavigationWriteRunPairComparisonSummary, WakeSchedulerNavigationWriteRunPreviewSummary, WakeSchedulerNavigationWriteRunRecordSummary, WakeSchedulerNavigationWriteRunResultSummary, WakeSchedulerNavigationWriteRunStaleItemSummary, WakeSchedulerNavigationWriteStagePreviewSummary, WakeSchedulerPreviewSummary, WakeSchedulerRecoveryPreviewSummary, WakeSchedulerRecoveryRecordSummary, WakeSchedulerRecoverySummary, WakeSchedulerRecoveryWorkflowPreviewSummary, WakeSchedulerRecoveryWorkflowRecordSummary, WakeSchedulerRecoveryWorkflowStepSummary, WakeSchedulerRecoveryWorkflowSummary, WakeSchedulerRecoveryWorkflowVerificationSummary, WakeSchedulerStateSummary, WakeScheduleTickPreviewSummary, WakeScheduleTickResultSummary } from "./state"
import type { CommandAuthorityRecordSummary, CommandAuthoritySummaryState, CommandAuthorityValidationProfileSummary } from "./state"

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

const COMMANDER_QUEUE_KINDS: CommanderQueueKind[] = [
  "needs_review",
  "ready_to_apply",
  "blocked",
  "failed_apply",
  "recently_applied",
  "drafts_needing_review",
  "bundles_needing_review",
  "stale_open",
]

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
  private readonly externalApiConnectors: ExternalApiConnectorSummary[] = fakeExternalApiConnectors()
  private readonly externalApiAudit: ExternalApiAuditRecordSummary[] = []
  private readonly externalApiResearchIngestions: ExternalApiResearchIngestionRecordSummary[] = []
  private readonly researchSyntheses: ResearchSynthesisResultSummary[] = []
  private readonly commanderCycles: CommanderCycleResultSummary[] = []
  private readonly opencodeHandoffs: OpenCodeHandoffResultSummary[] = []
  private readonly opencodeProcessSmokes: OpenCodeProcessSmokeResultSummary[] = []
  private readonly commanderExecutorReviews: CommanderExecutorReviewResultSummary[] = []
  private readonly executorReviewProposalCreates: ExecutorReviewProposalCreateResultSummary[] = []
  private readonly executorReviewProposalReviewRequests: ExecutorReviewProposalReviewRequestResultSummary[] = []
  private readonly executorReviewProposalReviewDecisions: ExecutorReviewProposalReviewDecisionResultSummary[] = []
  private readonly minimaxLiveValidations: MiniMaxLiveValidationResultSummary[] = []
  private readonly runtimeCheckpoints: RuntimeCheckpointSummary[] = []
  private readonly runtimeResumeAnchors: RuntimeResumeAnchorSummary[] = []
  private readonly wakeAssessments: WakeAssessmentSummary[] = []
  private readonly continuationPlans: ContinuationPlanSummary[] = []
  private readonly wakeSchedules: WakeScheduleSummary[] = []
  private readonly wakeScheduleTicks: WakeScheduleTickResultSummary[] = []
  private wakeSchedulerStatusRecord: WakeSchedulerStateSummary = fakeWakeSchedulerStatus()
  private wakeSchedulerBootstrapStatusRecord: WakeSchedulerBootstrapStatusSummary = fakeWakeSchedulerBootstrapStatus()
  private wakeSchedulerRecoveryPreviewRecord: WakeSchedulerRecoveryPreviewSummary = fakeWakeSchedulerRecoveryPreview()
  private readonly wakeSchedulerRecoveries: WakeSchedulerRecoverySummary[] = []
  private wakeSchedulerRecoveryWorkflowPreviewRecord: WakeSchedulerRecoveryWorkflowPreviewSummary | null = null
  private readonly wakeSchedulerRecoveryWorkflows: WakeSchedulerRecoveryWorkflowSummary[] = []
  private readonly wakeSchedulerEvents: WakeSchedulerEventRecordSummary[] = []
  private wakeSchedulerAuditTimelineRecords: WakeSchedulerAuditTimelineEntrySummary[] = []
  private readonly wakeSchedulerNavigationStagedCommands: WakeSchedulerNavigationStagedCommandSummary[] = []
  private readonly wakeSchedulerNavigationStagedWriteCommands: WakeSchedulerNavigationStagedWriteCommandSummary[] = []
  private readonly wakeSchedulerNavigationStagedReadRuns: WakeSchedulerNavigationStagedRunResultSummary[] = []
  private readonly wakeSchedulerNavigationWriteRuns: WakeSchedulerNavigationWriteRunResultSummary[] = []
  private readonly wakeSchedulerNavigationWriteApprovals: WakeSchedulerNavigationWriteApprovalSummary[] = []
  private readonly wakeSchedulerNavigationCheckpointWriteRuns: WakeSchedulerNavigationCheckpointWriteRunResultSummary[] = []
  private projectionRebuilds = 0
  private sequence = 0

  constructor(
    private readonly projectDir: string,
    private readonly projectName: string,
  ) {
    if (process.env.NXL_TUI_FAKE_WAKE_SCHEDULER_STALE === "1") {
      this.wakeSchedulerRecoveryPreviewRecord = fakeWakeSchedulerRecoveryPreview({
        recovery_id: "fake-recovery-1",
        stale_detected: true,
        status: "detected",
        prior_started_at: new Date(0).toISOString(),
        prior_event_id: "fake-prior-event-1",
        prior_tick_id: "fake-prior-tick-1",
        current_event_count: 1,
        warnings: ["previous scheduler start has no matching stop or runtime shutdown event"],
        recommended_commands: [
          { label: "Inspect scheduler status", command: "/scheduler-status", command_type: "read" },
          { label: "Preview due wake schedules", command: "/wake-tick-preview", command_type: "read" },
          { label: "Acknowledge stale run", command: "/scheduler-recovery-ack fake-recovery-1", command_type: "write", requires_active_runtime: true },
        ],
        redacted_summary_preview: "fake wake scheduler recovery stale=true",
      })
    }
  }

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
          reasoningProvider: this.reasoningProviderStatus(),
          researchProjection: { mode: "disabled", ok: true, stale: false, reason: "disabled", pending_count: 0 },
          wakeScheduler: {
            status: this.wakeSchedulerStatus(),
            bootstrap: this.wakeSchedulerBootstrapStatus(),
            recovery: this.previewWakeSchedulerRecovery(),
          },
        }
      case "runtime.reasoning_provider_status":
        return this.reasoningProviderStatus()
      case "runtime.command_authority_summary":
        return fakeCommandAuthoritySummary()
      case "runtime.command_authority_list":
        return fakeCommandAuthorityRecords().filter((record) => {
          if (typeof payload.risk === "string" && record.risk !== payload.risk) return false
          if (typeof payload.gate === "string" && record.gate !== payload.gate) return false
          if (typeof payload.owner === "string" && record.owner !== payload.owner) return false
          return true
        }).slice(0, readLimit(payload.limit, 20))
      case "runtime.command_authority_get":
        return fakeCommandAuthorityGet(String(payload.command ?? ""))
      case "runtime.command_authority_validation_profile":
        return fakeCommandAuthorityGet(String(payload.command ?? "")).validation_profile
      case "runtime.reasoning_provider_health":
        return this.reasoningProviderHealth()
      case "runtime.preview_reasoning_provider_smoke":
        return this.previewReasoningProviderSmoke(payload)
      case "runtime.execute_reasoning_provider_smoke":
        return this.executeReasoningProviderSmoke(payload)
      case "runtime.preview_minimax_live_validation":
        return this.previewMiniMaxLiveValidation(payload)
      case "runtime.execute_minimax_live_validation":
        return this.executeMiniMaxLiveValidation(payload)
      case "runtime.list_minimax_live_validations":
        return this.listMiniMaxLiveValidations(readLimit(payload.limit, 20))
      case "runtime.get_minimax_live_validation":
        return this.getMiniMaxLiveValidation(String(payload.validationId ?? payload.validation_id ?? ""))
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
        return this.commanderAuditTimeline(
          optionalString(payload.category),
          readAuditLimit(payload.limit),
          optionalString(payload.targetType ?? payload.target_type),
          optionalString(payload.targetId ?? payload.target_id),
          optionalString(payload.afterEventId ?? payload.after_event_id),
          optionalString(payload.beforeEventId ?? payload.before_event_id),
        )
      case "runtime.commander_authority_chain":
        return this.commanderAuthorityChain(String(payload.targetType ?? payload.target_type ?? ""), String(payload.targetId ?? payload.target_id ?? ""))
      case "runtime.commander_queue_summary":
        return this.commanderQueueSummary(readStaleAfterMs(payload.staleAfterMs === undefined ? payload.stale_after_ms : payload.staleAfterMs))
      case "runtime.commander_queue":
        return this.commanderQueue(
          readQueueKind(String(payload.queue ?? "")),
          readQueueLimit(payload.limit === undefined ? 20 : payload.limit),
          readStaleAfterMs(payload.staleAfterMs === undefined ? payload.stale_after_ms : payload.staleAfterMs),
        )
      case "runtime.commander_target_context":
        return this.commanderTargetContext(String(payload.targetType ?? payload.target_type ?? ""), String(payload.targetId ?? payload.target_id ?? ""))
      case "runtime.list_external_api_connectors":
        return this.externalApiConnectors
      case "runtime.get_external_api_connector":
        return this.getExternalApiConnector(String(payload.connectorId ?? payload.connector_id ?? ""))
      case "runtime.preview_external_api_request":
        return this.previewExternalApiRequest(payload)
      case "runtime.execute_external_api_request":
        return this.executeExternalApiRequest(payload)
      case "runtime.list_external_api_audit":
        return this.externalApiAudit.slice(0, readLimit(payload.limit, 20))
      case "runtime.preview_external_api_research_ingestion":
        return this.previewExternalApiResearchIngestion(payload)
      case "runtime.execute_external_api_research_ingestion":
        return this.executeExternalApiResearchIngestion(payload)
      case "runtime.list_external_api_research_ingestions":
        return this.externalApiResearchIngestions.slice(0, readLimit(payload.limit, 20))
      case "runtime.preview_research_synthesis":
        return this.previewResearchSynthesis(payload)
      case "runtime.execute_research_synthesis":
        return this.executeResearchSynthesis(payload)
      case "runtime.get_research_synthesis":
        return this.getResearchSynthesis(String(payload.synthesisId ?? payload.synthesis_id ?? ""))
      case "runtime.list_research_syntheses":
        return this.listResearchSyntheses(readLimit(payload.limit, 20))
      case "runtime.preview_commander_cycle":
        return this.previewCommanderCycle(payload)
      case "runtime.execute_commander_cycle":
        return this.executeCommanderCycle(payload)
      case "runtime.get_commander_cycle":
        return this.getCommanderCycle(String(payload.cycleId ?? payload.cycle_id ?? ""))
      case "runtime.list_commander_cycles":
        return this.listCommanderCycles(readLimit(payload.limit, 20))
      case "runtime.preview_opencode_handoff":
        return this.previewOpenCodeHandoff(payload)
      case "runtime.execute_opencode_handoff":
        return this.executeOpenCodeHandoff(payload)
      case "runtime.get_opencode_handoff":
        return this.getOpenCodeHandoff(String(payload.handoffId ?? payload.handoff_id ?? ""))
      case "runtime.list_opencode_handoffs":
        return this.listOpenCodeHandoffs(readLimit(payload.limit, 20))
      case "runtime.preview_opencode_process_smoke":
        return this.previewOpenCodeProcessSmoke(payload)
      case "runtime.execute_opencode_process_smoke":
        return this.executeOpenCodeProcessSmoke(payload)
      case "runtime.list_opencode_process_smokes":
        return this.listOpenCodeProcessSmokes(readLimit(payload.limit, 20))
      case "runtime.get_opencode_process_smoke":
        return this.getOpenCodeProcessSmoke(String(payload.smokeId ?? payload.smoke_id ?? ""))
      case "runtime.preview_opencode_handoff_readiness":
        return this.previewOpenCodeHandoffReadiness(payload)
      case "runtime.opencode_handoff_readiness_summary":
        return this.openCodeHandoffReadinessSummary()
      case "runtime.preview_opencode_result_review_packet":
        return this.previewOpenCodeResultReviewPacket(payload)
      case "runtime.opencode_result_review_summary":
        return this.openCodeResultReviewSummary()
      case "runtime.preview_commander_executor_review":
        return this.previewCommanderExecutorReview(payload)
      case "runtime.execute_commander_executor_review":
        return this.executeCommanderExecutorReview(payload)
      case "runtime.list_commander_executor_reviews":
        return this.commanderExecutorReviews.slice(0, readLimit(payload.limit, 20)).map(recordFromCommanderExecutorReview)
      case "runtime.get_commander_executor_review":
        return this.commanderExecutorReviews.find((item) => item.review_id === String(payload.reviewId ?? payload.review_id ?? "")) ?? null
      case "runtime.preview_executor_review_proposal_drafts":
        return this.previewExecutorReviewProposalDrafts(payload)
      case "runtime.executor_review_proposal_draft_summary":
        return this.executorReviewProposalDraftSummary()
      case "runtime.preview_executor_review_proposal_create":
        return this.previewExecutorReviewProposalCreate(payload)
      case "runtime.create_executor_review_proposal":
        return this.createExecutorReviewProposal(payload)
      case "runtime.list_executor_review_proposal_creates":
        return this.executorReviewProposalCreates.slice(0, readLimit(payload.limit, 20)).map(recordFromExecutorReviewProposalCreate)
      case "runtime.get_executor_review_proposal_create":
        return this.executorReviewProposalCreates.find((item) => item.create_id === String(payload.createId ?? payload.create_id ?? "")) ?? null
      case "runtime.preview_executor_review_proposal_review_request":
        return this.previewExecutorReviewProposalReviewRequest(payload)
      case "runtime.request_executor_review_proposal_review":
        return this.requestExecutorReviewProposalReview(payload)
      case "runtime.list_executor_review_proposal_review_requests":
        return this.executorReviewProposalReviewRequests.slice(0, readLimit(payload.limit, 20)).map(recordFromExecutorReviewProposalReviewRequest)
      case "runtime.get_executor_review_proposal_review_request":
        return this.executorReviewProposalReviewRequests.find((item) => item.request_gate_id === String(payload.requestGateId ?? payload.request_gate_id ?? "")) ?? null
      case "runtime.preview_executor_review_proposal_review_decision":
        return this.previewExecutorReviewProposalReviewDecision(payload)
      case "runtime.decide_executor_review_proposal_review":
        return this.decideExecutorReviewProposalReview(payload)
      case "runtime.list_executor_review_proposal_review_decisions":
        return this.executorReviewProposalReviewDecisions.slice(0, readLimit(payload.limit, 20)).map(recordFromExecutorReviewProposalReviewDecision)
      case "runtime.get_executor_review_proposal_review_decision":
        return this.executorReviewProposalReviewDecisions.find((item) => item.decision_gate_id === String(payload.decisionGateId ?? payload.decision_gate_id ?? "")) ?? null
      case "runtime.preview_executor_review_proposal_apply_readiness":
        return this.previewExecutorReviewProposalApplyReadiness(payload)
      case "runtime.executor_review_proposal_apply_readiness_summary":
        return this.executorReviewProposalApplyReadinessSummary(payload)
      case "runtime.list_executor_review_proposal_apply_readiness":
        return this.listExecutorReviewProposalApplyReadiness(payload)
      case "runtime.get_executor_review_proposal_apply_readiness":
        return this.listExecutorReviewProposalApplyReadiness({ limit: 100 }).find((item) => item.readiness_id === String(payload.readinessId ?? payload.readiness_id ?? "")) ?? null
      case "runtime.get_opencode_handoff_followup":
        return this.getOpenCodeHandoffFollowup(String(payload.handoffId ?? payload.handoff_id ?? ""))
      case "runtime.list_opencode_handoff_followups":
        return this.listOpenCodeHandoffFollowups(readLimit(payload.limit, 20))
      case "runtime.opencode_handoff_followup_summary":
        return this.opencodeHandoffFollowupSummary()
      case "runtime.opencode_handoff_followup_queue":
        return this.opencodeHandoffFollowupQueue(readFollowupQueue(String(payload.queue ?? "")), readLimit(payload.limit, 20))
      case "runtime.preview_runtime_checkpoint":
        return this.previewRuntimeCheckpoint(payload)
      case "runtime.create_runtime_checkpoint":
        return this.createRuntimeCheckpoint(payload)
      case "runtime.get_runtime_checkpoint":
        return this.getRuntimeCheckpoint(String(payload.checkpointId ?? payload.checkpoint_id ?? ""))
      case "runtime.list_runtime_checkpoints":
        return this.listRuntimeCheckpoints(readLimit(payload.limit, 20))
      case "runtime.preview_checkpoint_restore":
        return this.previewCheckpointRestore(payload)
      case "runtime.mark_checkpoint_resume_anchor":
        return this.markCheckpointResumeAnchor(payload)
      case "runtime.get_checkpoint_resume_anchor":
        return this.getCheckpointResumeAnchor(String(payload.resumeId ?? payload.resume_id ?? ""))
      case "runtime.list_checkpoint_resume_anchors":
        return this.runtimeResumeAnchors.slice(0, readLimit(payload.limit, 20))
      case "runtime.preview_wake_assessment":
        return this.previewWakeAssessment(payload)
      case "runtime.create_wake_assessment":
        return this.createWakeAssessment(payload)
      case "runtime.get_wake_assessment":
        return this.getWakeAssessment(String(payload.wakeId ?? payload.wake_id ?? ""))
      case "runtime.list_wake_assessments":
        return this.listWakeAssessments(readLimit(payload.limit, 20))
      case "runtime.preview_continuation_plan":
        return this.previewContinuationPlan(payload)
      case "runtime.create_continuation_plan":
        return this.createContinuationPlan(payload)
      case "runtime.get_continuation_plan":
        return this.getContinuationPlan(String(payload.planId ?? payload.plan_id ?? ""))
      case "runtime.list_continuation_plans":
        return this.listContinuationPlans(readLimit(payload.limit, 20))
      case "runtime.execute_continuation_step":
        return this.executeContinuationStep(payload)
      case "runtime.pause_continuation_plan":
        return this.pauseContinuationPlan(payload)
      case "runtime.cancel_continuation_plan":
        return this.cancelContinuationPlan(payload)
      case "runtime.preview_wake_schedule":
        return this.previewWakeSchedule(payload)
      case "runtime.create_wake_schedule":
        return this.createWakeSchedule(payload)
      case "runtime.get_wake_schedule":
        return this.getWakeSchedule(String(payload.scheduleId ?? payload.schedule_id ?? ""))
      case "runtime.list_wake_schedules":
        return this.listWakeSchedules(readLimit(payload.limit, 20))
      case "runtime.pause_wake_schedule":
        return this.pauseWakeSchedule(payload)
      case "runtime.resume_wake_schedule":
        return this.resumeWakeSchedule(payload)
      case "runtime.cancel_wake_schedule":
        return this.cancelWakeSchedule(payload)
      case "runtime.preview_wake_schedule_tick":
        return this.previewWakeScheduleTick(payload)
      case "runtime.execute_wake_schedule_tick":
        return this.executeWakeScheduleTick(payload)
      case "runtime.list_wake_schedule_ticks":
        return this.listWakeScheduleTicks(readLimit(payload.limit, 20))
      case "runtime.get_wake_schedule_tick":
        return this.getWakeScheduleTick(String(payload.tickId ?? payload.tick_id ?? ""))
      case "runtime.preview_wake_scheduler_start":
        return this.previewWakeSchedulerStart(payload)
      case "runtime.start_wake_scheduler":
        return this.startWakeScheduler(payload)
      case "runtime.stop_wake_scheduler":
        return this.stopWakeScheduler(payload)
      case "runtime.wake_scheduler_status":
        return this.wakeSchedulerStatus()
      case "runtime.wake_scheduler_bootstrap_status":
        return this.wakeSchedulerBootstrapStatus()
      case "runtime.preview_wake_scheduler_bootstrap":
        return this.previewWakeSchedulerBootstrap()
      case "runtime.preview_wake_scheduler_recovery":
        return this.previewWakeSchedulerRecovery()
      case "runtime.list_wake_scheduler_recoveries":
        return this.listWakeSchedulerRecoveries(readLimit(payload.limit, 20))
      case "runtime.get_wake_scheduler_recovery":
        return this.getWakeSchedulerRecovery(String(payload.recoveryId ?? payload.recovery_id ?? ""))
      case "runtime.acknowledge_wake_scheduler_recovery":
        return this.acknowledgeWakeSchedulerRecovery(payload)
      case "runtime.preview_wake_scheduler_recovery_workflow":
        return this.previewWakeSchedulerRecoveryWorkflow(String(payload.recoveryId ?? payload.recovery_id ?? ""))
      case "runtime.create_wake_scheduler_recovery_workflow":
        return this.createWakeSchedulerRecoveryWorkflow(String(payload.recoveryId ?? payload.recovery_id ?? ""))
      case "runtime.list_wake_scheduler_recovery_workflows":
        return this.listWakeSchedulerRecoveryWorkflows(readLimit(payload.limit, 20))
      case "runtime.get_wake_scheduler_recovery_workflow":
        return this.getWakeSchedulerRecoveryWorkflow(String(payload.workflowId ?? payload.workflow_id ?? ""))
      case "runtime.record_wake_scheduler_recovery_workflow_step":
        return this.recordWakeSchedulerRecoveryWorkflowStep(payload)
      case "runtime.cancel_wake_scheduler_recovery_workflow":
        return this.cancelWakeSchedulerRecoveryWorkflow(payload)
      case "runtime.verify_wake_scheduler_recovery_workflow":
        return this.verifyWakeSchedulerRecoveryWorkflow(String(payload.workflowId ?? payload.workflow_id ?? ""))
      case "runtime.wake_scheduler_audit_summary":
        return this.wakeSchedulerAuditSummary()
      case "runtime.wake_scheduler_audit_timeline":
        return this.wakeSchedulerAuditTimeline(payload)
      case "runtime.wake_scheduler_audit_chain":
        return this.wakeSchedulerAuditChain(String(payload.relatedId ?? payload.related_id ?? ""), readLimit(payload.limit, 20))
      case "runtime.wake_scheduler_audit_incidents":
        return this.wakeSchedulerAuditIncidents(payload)
      case "runtime.wake_scheduler_navigation_board":
        return this.wakeSchedulerNavigationBoard(payload)
      case "runtime.preview_wake_scheduler_navigation_command":
        return fakeWakeSchedulerNavigationCommandPreview(String(payload.command ?? ""))
      case "runtime.get_wake_scheduler_navigation_target":
        return this.wakeSchedulerNavigationTarget(String(payload.targetKind ?? payload.target_kind ?? ""), String(payload.targetId ?? payload.target_id ?? ""))
      case "runtime.preview_wake_scheduler_navigation_stage":
        return this.previewWakeSchedulerNavigationStage(String(payload.command ?? ""))
      case "runtime.stage_wake_scheduler_navigation_command":
        return this.stageWakeSchedulerNavigationCommand(String(payload.command ?? ""), String(payload.requestedBy ?? payload.requested_by ?? "operator"))
      case "runtime.list_wake_scheduler_navigation_staged_commands":
        return this.listWakeSchedulerNavigationStagedCommands(readLimit(payload.limit, 20))
      case "runtime.remove_wake_scheduler_navigation_staged_command":
        return this.removeWakeSchedulerNavigationStagedCommand(String(payload.stagedId ?? payload.staged_id ?? ""))
      case "runtime.clear_wake_scheduler_navigation_staged_commands":
        return this.clearWakeSchedulerNavigationStagedCommands()
      case "runtime.preview_wake_scheduler_navigation_staged_read":
        return this.previewWakeSchedulerNavigationStagedRead(String(payload.stagedId ?? payload.staged_id ?? ""))
      case "runtime.execute_wake_scheduler_navigation_staged_read":
        return this.executeWakeSchedulerNavigationStagedRead(String(payload.stagedId ?? payload.staged_id ?? ""), String(payload.requestedBy ?? payload.requested_by ?? "operator"))
      case "runtime.list_wake_scheduler_navigation_staged_read_runs":
        return this.listWakeSchedulerNavigationStagedReadRuns(readLimit(payload.limit, 20), typeof (payload.stagedId ?? payload.staged_id) === "string" ? String(payload.stagedId ?? payload.staged_id) : undefined)
      case "runtime.get_wake_scheduler_navigation_staged_read_run":
        return this.getWakeSchedulerNavigationStagedReadRun(String(payload.runId ?? payload.run_id ?? ""))
      case "runtime.wake_scheduler_navigation_staged_read_history":
        return this.wakeSchedulerNavigationStagedReadHistory(payload)
      case "runtime.wake_scheduler_navigation_staged_read_compare":
        return this.wakeSchedulerNavigationStagedReadCompare(payload)
      case "runtime.wake_scheduler_navigation_staged_read_stale":
        return this.wakeSchedulerNavigationStagedReadStale(payload)
      case "runtime.wake_scheduler_navigation_staged_read_group":
        return this.wakeSchedulerNavigationStagedReadGroup(payload)
      case "runtime.preview_wake_scheduler_navigation_write_command":
        return fakeWakeSchedulerNavigationWritePreview(String(payload.command ?? ""))
      case "runtime.wake_scheduler_navigation_write_board":
        return this.wakeSchedulerNavigationWriteBoard(payload)
      case "runtime.preview_wake_scheduler_navigation_write_stage":
        return this.previewWakeSchedulerNavigationWriteStage(String(payload.command ?? ""), payload.allowMediumRisk === true || payload.allow_medium_risk === true)
      case "runtime.stage_wake_scheduler_navigation_write_command":
        return this.stageWakeSchedulerNavigationWriteCommand(String(payload.command ?? ""), payload.allowMediumRisk === true || payload.allow_medium_risk === true, String(payload.requestedBy ?? payload.requested_by ?? "operator"))
      case "runtime.get_wake_scheduler_navigation_staged_write_command":
        return this.getWakeSchedulerNavigationStagedWriteCommand(String(payload.stagedWriteId ?? payload.staged_write_id ?? ""))
      case "runtime.list_wake_scheduler_navigation_staged_write_commands":
        return this.listWakeSchedulerNavigationStagedWriteCommands(readLimit(payload.limit, 20))
      case "runtime.remove_wake_scheduler_navigation_staged_write_command":
        return this.removeWakeSchedulerNavigationStagedWriteCommand(String(payload.stagedWriteId ?? payload.staged_write_id ?? ""))
      case "runtime.clear_wake_scheduler_navigation_staged_write_commands":
        return this.clearWakeSchedulerNavigationStagedWriteCommands()
      case "runtime.preview_wake_scheduler_navigation_write_run":
        return this.previewWakeSchedulerNavigationWriteRun(String(payload.stagedWriteId ?? payload.staged_write_id ?? ""))
      case "runtime.execute_wake_scheduler_navigation_write_run":
        return this.executeWakeSchedulerNavigationWriteRun(
          String(payload.stagedWriteId ?? payload.staged_write_id ?? ""),
          payload.dryRun === true || payload.dry_run === true,
          String(payload.requestedBy ?? payload.requested_by ?? "operator"),
        )
      case "runtime.list_wake_scheduler_navigation_write_runs":
        return this.listWakeSchedulerNavigationWriteRuns(readLimit(payload.limit, 20), typeof (payload.stagedWriteId ?? payload.staged_write_id) === "string" ? String(payload.stagedWriteId ?? payload.staged_write_id) : undefined)
      case "runtime.get_wake_scheduler_navigation_write_run":
        return this.getWakeSchedulerNavigationWriteRun(String(payload.runId ?? payload.run_id ?? ""))
      case "runtime.wake_scheduler_navigation_write_run_history":
        return this.wakeSchedulerNavigationWriteRunHistory(payload)
      case "runtime.wake_scheduler_navigation_write_run_compare":
        return this.wakeSchedulerNavigationWriteRunCompare(payload)
      case "runtime.wake_scheduler_navigation_write_run_stale":
        return this.wakeSchedulerNavigationWriteRunStale(payload)
      case "runtime.wake_scheduler_navigation_write_run_group":
        return this.wakeSchedulerNavigationWriteRunGroup(payload)
      case "runtime.preview_wake_scheduler_navigation_write_readiness":
        return this.previewWakeSchedulerNavigationWriteReadiness(String(payload.stagedWriteId ?? payload.staged_write_id ?? ""))
      case "runtime.approve_wake_scheduler_navigation_staged_write":
        return this.approveWakeSchedulerNavigationStagedWrite(String(payload.stagedWriteId ?? payload.staged_write_id ?? ""), String(payload.reason ?? ""), String(payload.requestedBy ?? payload.requested_by ?? "operator"))
      case "runtime.reject_wake_scheduler_navigation_staged_write":
        return this.rejectWakeSchedulerNavigationStagedWrite(String(payload.stagedWriteId ?? payload.staged_write_id ?? ""), String(payload.reason ?? ""), String(payload.requestedBy ?? payload.requested_by ?? "operator"))
      case "runtime.revoke_wake_scheduler_navigation_write_approval":
        return this.revokeWakeSchedulerNavigationWriteApproval(String(payload.approvalId ?? payload.approval_id ?? ""), String(payload.reason ?? ""), String(payload.requestedBy ?? payload.requested_by ?? "operator"))
      case "runtime.get_wake_scheduler_navigation_write_approval":
        return this.getWakeSchedulerNavigationWriteApproval(String(payload.approvalId ?? payload.approval_id ?? ""))
      case "runtime.list_wake_scheduler_navigation_write_approvals":
        return this.listWakeSchedulerNavigationWriteApprovals(readLimit(payload.limit, 20))
      case "runtime.preview_wake_scheduler_navigation_checkpoint_write_run":
        return this.previewWakeSchedulerNavigationCheckpointWriteRun(String(payload.stagedWriteId ?? payload.staged_write_id ?? ""))
      case "runtime.execute_wake_scheduler_navigation_checkpoint_write_run":
        return this.executeWakeSchedulerNavigationCheckpointWriteRun(
          String(payload.stagedWriteId ?? payload.staged_write_id ?? ""),
          payload.dryRun === true || payload.dry_run === true,
          String(payload.requestedBy ?? payload.requested_by ?? "operator"),
        )
      case "runtime.list_wake_scheduler_navigation_checkpoint_write_runs":
        return this.listWakeSchedulerNavigationCheckpointWriteRuns(readLimit(payload.limit, 20), typeof (payload.stagedWriteId ?? payload.staged_write_id) === "string" ? String(payload.stagedWriteId ?? payload.staged_write_id) : undefined)
      case "runtime.get_wake_scheduler_navigation_checkpoint_write_run":
        return this.getWakeSchedulerNavigationCheckpointWriteRun(String(payload.runId ?? payload.run_id ?? ""))
      case "runtime.wake_scheduler_navigation_checkpoint_write_history":
        return this.wakeSchedulerNavigationCheckpointWriteHistory(payload)
      case "runtime.wake_scheduler_navigation_checkpoint_write_compare":
        return this.wakeSchedulerNavigationCheckpointWriteCompare(payload)
      case "runtime.wake_scheduler_navigation_checkpoint_write_stale":
        return this.wakeSchedulerNavigationCheckpointWriteStale(payload)
      case "runtime.wake_scheduler_navigation_checkpoint_write_group":
        return this.wakeSchedulerNavigationCheckpointWriteGroup(payload)
      case "runtime.wake_scheduler_navigation_checkpoint_write_approval_usage":
        return this.wakeSchedulerNavigationCheckpointApprovalUsage(payload)
      case "runtime.list_wake_scheduler_events":
        return this.listWakeSchedulerEvents(readLimit(payload.limit, 20))
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

  private getExternalApiConnector(connectorId: string): ExternalApiConnectorSummary | null {
    const id = requiredString(connectorId, "connectorId")
    return this.externalApiConnectors.find((connector) => connector.connector_id === id) ?? null
  }

  private reasoningProviderStatus(): Record<string, unknown> {
    return {
      kind: "fake",
      provider_id: "fake-reasoning",
      max_input_bytes: 32768,
      max_output_bytes: 16384,
      enabled_for: ["research_synthesis", "commander_cycle"],
    }
  }

  private reasoningProviderHealth(): Record<string, unknown> {
    return {
      provider_id: "fake-reasoning",
      kind: "fake",
      status: "ok",
      enabled_for: ["research_synthesis", "commander_cycle"],
      max_input_bytes: 32768,
      max_output_bytes: 16384,
      checks: [
        { name: "config", ok: true, severity: "info", summary: "fake reasoning provider configured" },
        { name: "network", ok: true, severity: "info", summary: "fake provider performs no network calls" },
      ],
      last_checked_at: "1970-01-01T00:00:00.000Z",
    }
  }

  private previewReasoningProviderSmoke(payload: Record<string, unknown>): Record<string, unknown> {
    const surface = readReasoningSurface(payload.surface)
    return {
      provider_id: "fake-reasoning",
      kind: "fake",
      surface,
      would_call_network: false,
      prompt_bytes: 64,
      max_output_bytes: 16384,
      blockers: [],
      redacted_request_preview: `fake reasoning smoke request for ${surface}`,
    }
  }

  private executeReasoningProviderSmoke(payload: Record<string, unknown>): Record<string, unknown> {
    const surface = readReasoningSurface(payload.surface)
    return {
      provider_id: "fake-reasoning",
      kind: "fake",
      surface,
      ok: true,
      dry_run: payload.dryRun === true || payload.dry_run === true,
      parsed: payload.dryRun === true || payload.dry_run === true ? false : true,
      summary: payload.dryRun === true || payload.dry_run === true ? "fake reasoning smoke dry-run passed" : `fake ${surface} smoke parsed deterministic provider output`,
      created_at: "1970-01-01T00:00:00.000Z",
    }
  }

  private previewMiniMaxLiveValidation(payload: Record<string, unknown>): MiniMaxLiveValidationPreviewSummary {
    const surfaces = readMiniMaxLiveValidationSurfaces(payload.surfaces ?? payload.surface)
    return {
      status: "not_configured",
      can_execute: false,
      provider_kind: "fake",
      provider_id: "fake-reasoning",
      enabled_surfaces: ["research_synthesis", "commander_cycle"],
      requested_surfaces: surfaces,
      opt_in_required: true,
      opt_in_present: false,
      timeout_ms: readValidationTimeout(payload.timeoutMs ?? payload.timeout_ms),
      blockers: ["MiniMax reasoning provider is not configured", "NXL_MINIMAX_LIVE_VALIDATION=1 is required for MiniMax live validation"],
      warnings: ["fake runtime does not call MiniMax or live providers"],
      redacted_summary_preview: "MiniMax live validation is blocked in fake/default runtime",
      recommended_commands: [
        { label: "Preview validation", command: `/minimax-live-preview surface=${surfaces[0] ?? "commander_executor_review"}`, command_type: "read" },
        { label: "Reasoning smoke preview", command: `/reasoning-smoke-preview ${surfaces[0] ?? "commander_executor_review"}`, command_type: "read" },
        { label: "Show authority", command: "/authority-show /minimax-live-validate", command_type: "read" },
      ],
      generated_at: "1970-01-01T00:00:00.000Z",
    }
  }

  private executeMiniMaxLiveValidation(payload: Record<string, unknown>): MiniMaxLiveValidationResultSummary {
    const dryRun = payload.dryRun === true || payload.dry_run === true
    const surfaces = readMiniMaxLiveValidationSurfaces(payload.surfaces ?? payload.surface)
    const result: MiniMaxLiveValidationResultSummary = {
      validation_id: dryRun ? "fake-minimax-live-dry-run" : `fake-minimax-live-${this.minimaxLiveValidations.length + 1}`,
      status: dryRun ? "skipped" : "blocked",
      provider_kind: "fake",
      provider_id: "fake-reasoning",
      surfaces: surfaces.map((surface): MiniMaxLiveValidationSurfaceResultSummary => ({
        surface,
        status: dryRun ? "skipped" : "blocked",
        ok: false,
        parsed: false,
        summary_preview: dryRun ? "dry-run requested; no provider call or events appended" : undefined,
        error: dryRun ? undefined : "MiniMax live validation requires minimax provider config and live opt-in",
        schema_version: "reasoning-smoke-v1",
      })),
      started_at: "1970-01-01T00:00:00.000Z",
      completed_at: "1970-01-01T00:00:00.000Z",
      duration_ms: 0,
      requested_by: "tui",
      validation_hash: fakeNavigationStageHash(`minimax-live:${dryRun ? "dry-run" : this.minimaxLiveValidations.length + 1}`),
      diagnostics: [dryRun ? "fake dry-run did not call MiniMax or append events" : "fake runtime blocked MiniMax live validation without provider calls"],
      error: dryRun ? undefined : "MiniMax live validation requires explicit live configuration",
    }
    if (!dryRun) this.minimaxLiveValidations.unshift(result)
    return result
  }

  private listMiniMaxLiveValidations(limit: number): MiniMaxLiveValidationRecordSummary[] {
    return this.minimaxLiveValidations.slice(0, limit).map((item) => ({
      validation_id: item.validation_id,
      status: item.status,
      provider_id: item.provider_id,
      model: item.model,
      completed_at: item.completed_at,
      surface_count: item.surfaces.length,
      succeeded_count: item.surfaces.filter((surface) => surface.status === "succeeded").length,
      failed_count: item.surfaces.filter((surface) => surface.status === "failed" || surface.status === "blocked").length,
      summary_preview: item.error ?? item.diagnostics[0] ?? item.status,
      validation_hash: item.validation_hash,
    }))
  }

  private getMiniMaxLiveValidation(validationId: string): MiniMaxLiveValidationResultSummary | null {
    const id = requiredString(validationId, "validationId")
    return this.minimaxLiveValidations.find((item) => item.validation_id === id) ?? null
  }

  private previewExternalApiRequest(payload: Record<string, unknown>): ExternalApiRequestPreviewSummary {
    const connector = this.requireExternalApiConnector(String(payload.connectorId ?? payload.connector_id ?? ""))
    const method = readExternalApiMethod(String(payload.method ?? ""))
    const path = requiredString(String(payload.path ?? ""), "path")
    const query = isRecord(payload.query) ? payload.query as Record<string, unknown> : {}
    const url = new URL(path, connector.base_url)
    const blockers: string[] = []
    if (!connector.allowed_methods.includes(method)) blockers.push(`method not allowed: ${method}`)
    if (!connector.allowed_hosts.includes(url.hostname)) blockers.push(`host not allowed: ${url.hostname}`)
    for (const [key, value] of Object.entries(query)) {
      if (typeof value !== "string") blockers.push(`query value must be string: ${key}`)
      else url.searchParams.set(key, redactText(value))
    }
    return {
      connector_id: connector.connector_id,
      method,
      url: redactText(url.toString()),
      allowed: blockers.length === 0,
      blockers: blockers.map(redactText),
      redacted_headers: {},
      has_body: false,
      body_bytes: 0,
      credential_refs_used: connector.credential_refs?.map((ref) => ref.name) ?? [],
    }
  }

  private executeExternalApiRequest(payload: Record<string, unknown>): ExternalApiRequestResultSummary {
    const preview = this.previewExternalApiRequest(payload)
    const dryRun = payload.dryRun === true || payload.dry_run === true
    this.sequence += 1
    const result: ExternalApiRequestResultSummary = {
      request_id: `fake-api-request-${this.sequence}`,
      connector_id: preview.connector_id,
      method: preview.method,
      url: preview.url,
      status_code: dryRun ? undefined : 200,
      ok: preview.allowed,
      response_bytes: dryRun ? undefined : 28,
      response_preview: dryRun ? "dry run: transport not called" : "{\"ok\":true,\"value\":\"fake\"}",
      error: preview.allowed ? undefined : preview.blockers.join("; "),
      dry_run: dryRun,
      created_at: new Date(0).toISOString(),
    }
    if (!dryRun) {
      this.externalApiAudit.unshift({
        request_id: result.request_id,
        connector_id: result.connector_id,
        method: result.method,
        url: result.url,
        status_code: result.status_code,
        ok: result.ok,
        dry_run: false,
        requested_by: redactText(String(payload.requestedBy ?? payload.requested_by ?? "operator")),
        error: result.error,
        created_at: result.created_at,
      })
    }
    if (!result.ok) throw new Error(result.error ?? "external API request blocked")
    return result
  }

  private previewExternalApiResearchIngestion(payload: Record<string, unknown>): ExternalApiResearchIngestionPreviewSummary {
    const requestPreview = this.previewExternalApiRequest(payload)
    const topicId = requiredString(String(payload.topicId ?? payload.topic_id ?? ""), "topicId")
    const sourceTitle = requiredString(String(payload.sourceTitle ?? payload.source_title ?? ""), "sourceTitle")
    const blockers = [...requestPreview.blockers]
    if (!this.researchTopics().some((topic) => topic.id === topicId)) blockers.push(`topic not found: ${redactText(topicId)}`)
    return {
      connector_id: requestPreview.connector_id,
      topic_id: redactText(topicId),
      method: requestPreview.method,
      url: requestPreview.url,
      allowed: requestPreview.allowed && blockers.length === 0,
      blockers: blockers.map(redactText),
      would_create_source: blockers.length === 0 && sourceTitle.length > 0,
      would_create_note: blockers.length === 0 && sourceTitle.length > 0,
      max_ingested_bytes: 4096,
      credential_refs_used: requestPreview.credential_refs_used,
      redacted_headers: requestPreview.redacted_headers,
    }
  }

  private executeExternalApiResearchIngestion(payload: Record<string, unknown>): ExternalApiResearchIngestionResultSummary {
    const ingestPreview = this.previewExternalApiResearchIngestion(payload)
    const dryRun = payload.dryRun === true || payload.dry_run === true
    this.sequence += 1
    const result: ExternalApiResearchIngestionResultSummary = {
      ingestion_id: `fake-api-ingestion-${this.sequence}`,
      request_id: dryRun ? undefined : `fake-api-request-${this.sequence}`,
      connector_id: ingestPreview.connector_id,
      topic_id: ingestPreview.topic_id,
      source_id: dryRun ? undefined : `fake-source-${this.sequence}`,
      note_id: dryRun ? undefined : `fake-note-${this.sequence}`,
      artifact_id: dryRun ? undefined : `fake-artifact-${this.sequence}`,
      audit_request_id: dryRun ? undefined : `fake-api-request-${this.sequence}`,
      ok: ingestPreview.allowed,
      dry_run: dryRun,
      ingested_bytes: dryRun ? 0 : 28,
      response_preview: dryRun ? "dry run: transport not called and ResearchDb not written" : "{\"ok\":true,\"value\":\"fake\"}",
      error: ingestPreview.allowed ? undefined : ingestPreview.blockers.join("; "),
      created_at: new Date(0).toISOString(),
    }
    if (!result.ok) throw new Error(result.error ?? "external API research ingestion blocked")
    if (!dryRun) {
      this.externalApiResearchIngestions.unshift({
        ingestion_id: result.ingestion_id,
        connector_id: result.connector_id,
        topic_id: result.topic_id,
        source_id: result.source_id,
        note_id: result.note_id,
        artifact_id: result.artifact_id,
        audit_request_id: result.audit_request_id,
        ok: true,
        dry_run: false,
        requested_by: redactText(String(payload.requestedBy ?? payload.requested_by ?? "operator")),
        created_at: result.created_at,
      })
    }
    return result
  }

  private requireExternalApiConnector(connectorId: string): ExternalApiConnectorSummary {
    const connector = this.getExternalApiConnector(connectorId)
    if (!connector) throw new Error(`external API connector not found: ${redactText(connectorId)}`)
    return connector
  }

  private previewResearchSynthesis(payload: Record<string, unknown>): ResearchSynthesisPreviewSummary {
    const topicId = requiredString(String(payload.topicId ?? payload.topic_id ?? ""), "topicId")
    const topic = this.researchTopics().find((item) => item.id === topicId)
    if (!topic) throw new Error(`topic not found: ${redactText(topicId)}`)
    const notes = this.searchNotes(topicId, "")
    const ingestions = this.externalApiResearchIngestions.filter((item) => item.topic_id === topicId)
    const evidenceIds = [
      "fake-source-1",
      ...notes.map((note) => note.id),
      ...ingestions.map((ingestion) => ingestion.ingestion_id),
    ]
    const context = redactText(`topic=${topic.title}\nnotes=${notes.map((note) => note.content).join("\n")}\ningestions=${ingestions.map((item) => item.ingestion_id).join(",")}`)
    return {
      topic_id: redactText(topicId),
      topic_title: redactText(topic.title),
      evidence_counts: { sources: 1, notes: notes.length, artifacts: 0, ingestions: ingestions.length },
      context_bytes: new TextEncoder().encode(context).byteLength,
      max_context_bytes: readNumber(payload.maxContextBytes ?? payload.max_context_bytes, 32768),
      included_evidence_ids: evidenceIds.map(redactText),
      excluded_evidence_count: 0,
      blockers: evidenceIds.length === 0 ? ["topic has no evidence to synthesize"] : [],
      redacted_context_preview: preview(context),
    }
  }

  private executeResearchSynthesis(payload: Record<string, unknown>): ResearchSynthesisResultSummary {
    const synthPreview = this.previewResearchSynthesis(payload)
    if (synthPreview.blockers.length > 0) throw new Error(synthPreview.blockers.join("; "))
    this.sequence += 1
    const synthesisId = `fake-synthesis-${this.sequence}`
    const action = {
      title: "Operator checkpoint",
      summary: `Review synthesis for topic ${synthPreview.topic_id}`,
      action_kind: "operator_checkpoint",
      evidence_ids: synthPreview.included_evidence_ids.slice(0, 3),
    }
    const result: ResearchSynthesisResultSummary = {
      synthesis_id: synthesisId,
      topic_id: synthPreview.topic_id,
      provider_id: "fake-research-synthesis",
      source_note_id: `fake-synthesis-note-${this.sequence}`,
      artifact_id: `fake-synthesis-artifact-${this.sequence}`,
      proposal_ids: [],
      title: `Synthesis for ${synthPreview.topic_title}`,
      summary: redactText(`Deterministic fake synthesis for ${synthPreview.included_evidence_ids.length} evidence records.`),
      findings: [`Evidence records considered: ${synthPreview.included_evidence_ids.length}`],
      risks: ["Fake provider does not make real-world claims."],
      open_questions: ["Operator should review whether the evidence is sufficient."],
      recommended_actions: [action],
      context_hash: "fake-context-hash",
      output_hash: "fake-output-hash",
      created_at: new Date(0).toISOString(),
      requested_by: redactText(String(payload.requestedBy ?? payload.requested_by ?? "operator")),
    }
    if (payload.createProposals === true || payload.create_proposals === true) {
      const proposal = this.createProposal({
        actionKind: "operator_checkpoint",
        title: action.title,
        summary: `${action.summary}\n\nsynthesis_id: ${synthesisId}\nevidence_ids: ${action.evidence_ids.join(", ") || "none"}`,
        proposedBy: result.requested_by,
        actionPayload: { synthesis_id: synthesisId, topic_id: result.topic_id, evidence_ids: action.evidence_ids },
      })
      result.proposal_ids = [proposal.proposal_id]
    }
    this.researchSyntheses.unshift(result)
    return result
  }

  private getResearchSynthesis(synthesisId: string): ResearchSynthesisResultSummary | null {
    const id = requiredString(synthesisId, "synthesisId")
    return this.researchSyntheses.find((item) => item.synthesis_id === id) ?? null
  }

  private listResearchSyntheses(limit: number): ResearchSynthesisRecordSummary[] {
    return this.researchSyntheses.slice(0, limit).map((item) => ({
      synthesis_id: item.synthesis_id,
      topic_id: item.topic_id,
      provider_id: item.provider_id,
      source_note_id: item.source_note_id,
      artifact_id: item.artifact_id,
      proposal_ids: item.proposal_ids,
      title: item.title,
      summary_preview: preview(item.summary),
      created_at: item.created_at,
      requested_by: item.requested_by,
    }))
  }

  private previewCommanderCycle(payload: Record<string, unknown>): CommanderCyclePreviewSummary {
    const topicId = optionalString(payload.topicId ?? payload.topic_id)
    const missionId = optionalString(payload.missionId ?? payload.mission_id)
    const objective = optionalString(payload.objective)
    if (!topicId && !missionId && !objective) throw new Error("topic, mission, or objective is required")
    if (topicId && !this.researchTopics().some((topic) => topic.id === topicId)) throw new Error(`topic not found: ${redactText(topicId)}`)
    if (missionId && !this.missions.some((mission) => mission.mission_id === missionId)) throw new Error(`mission not found: ${redactText(missionId)}`)
    const notes = topicId ? this.searchNotes(topicId, "") : []
    const syntheses = topicId ? this.researchSyntheses.filter((item) => item.topic_id === topicId) : []
    const evidenceIds = topicId ? ["fake-source-1", ...notes.map((note) => note.id)] : []
    const context = redactText(`topic=${topicId ?? "none"}\nmission=${missionId ?? "none"}\nobjective=${objective ?? ""}\nnotes=${notes.map((note) => note.content).join("\n")}\nsyntheses=${syntheses.map((item) => item.synthesis_id).join(",")}`)
    return {
      objective: objective ? redactText(objective) : undefined,
      topic_id: topicId ? redactText(topicId) : undefined,
      mission_id: missionId ? redactText(missionId) : undefined,
      context_counts: {
        sources: topicId ? 1 : 0,
        notes: notes.length,
        artifacts: 0,
        syntheses: syntheses.length,
        proposals: this.proposals.length,
        reviews: this.reviews.length,
        queues: this.proposals.length + this.proposalBundles.length,
      },
      context_bytes: new TextEncoder().encode(context).byteLength,
      max_context_bytes: readNumber(payload.maxContextBytes ?? payload.max_context_bytes, 49152),
      included_evidence_ids: evidenceIds.map(redactText),
      included_synthesis_ids: syntheses.map((item) => item.synthesis_id),
      blockers: topicId && evidenceIds.length === 0 && syntheses.length === 0 ? ["topic has no evidence or syntheses for commander cycle"] : [],
      redacted_context_preview: preview(context),
    }
  }

  private executeCommanderCycle(payload: Record<string, unknown>): CommanderCycleResultSummary {
    const cyclePreview = this.previewCommanderCycle(payload)
    if (cyclePreview.blockers.length > 0) throw new Error(cyclePreview.blockers.join("; "))
    this.sequence += 1
    const cycleId = `fake-cycle-${this.sequence}`
    const action = {
      title: "Operator checkpoint",
      summary: "Review commander cycle recommendation.",
      action_kind: "operator_checkpoint",
      rationale: "Fake commander cycle preserves operator review and apply authority.",
      evidence_ids: cyclePreview.included_evidence_ids.slice(0, 3),
      synthesis_ids: cyclePreview.included_synthesis_ids.slice(0, 3),
      related_target_type: cyclePreview.mission_id ? "mission" : "topic",
      related_target_id: cyclePreview.mission_id ?? cyclePreview.topic_id,
    }
    const result: CommanderCycleResultSummary = {
      cycle_id: cycleId,
      provider_id: "fake-commander-cycle",
      objective: cyclePreview.objective,
      topic_id: cyclePreview.topic_id,
      mission_id: cyclePreview.mission_id,
      title: `Commander cycle for ${cyclePreview.topic_id ?? cyclePreview.mission_id}`,
      summary: redactText(`Deterministic commander cycle reviewed ${cyclePreview.included_evidence_ids.length} evidence records.`),
      findings: [`Evidence records considered: ${cyclePreview.included_evidence_ids.length}`],
      risks: ["Fake provider does not apply proposals."],
      recommended_actions: [action],
      proposal_ids: [],
      context_hash: "fake-cycle-context-hash",
      output_hash: "fake-cycle-output-hash",
      created_at: new Date(0).toISOString(),
      requested_by: redactText(String(payload.requestedBy ?? payload.requested_by ?? "operator")),
    }
    if (payload.createProposals === true || payload.create_proposals === true || payload.createBundle === true || payload.create_bundle === true) {
      const proposal = this.createProposal({
        actionKind: "operator_checkpoint",
        title: action.title,
        summary: `${action.summary}\n\ncycle_id: ${cycleId}\nevidence_ids: ${action.evidence_ids.join(", ") || "none"}\nsynthesis_ids: ${action.synthesis_ids.join(", ") || "none"}`,
        proposedBy: result.requested_by,
        actionPayload: { cycle_id: cycleId, topic_id: result.topic_id, mission_id: result.mission_id, evidence_ids: action.evidence_ids, synthesis_ids: action.synthesis_ids },
      })
      result.proposal_ids = [proposal.proposal_id]
    }
    if ((payload.createBundle === true || payload.create_bundle === true) && (result.proposal_ids?.length ?? 0) > 0) {
      const bundle = this.createProposalBundle({
        title: `Commander cycle ${cycleId}`,
        summary: `Bundle for ${cycleId}`,
        createdBy: result.requested_by,
      })
      for (const proposalId of result.proposal_ids ?? []) this.addProposalToBundle(bundle.bundle_id, proposalId)
      result.bundle_id = bundle.bundle_id
    }
    this.commanderCycles.unshift(result)
    return result
  }

  private getCommanderCycle(cycleId: string): CommanderCycleResultSummary | null {
    const id = requiredString(cycleId, "cycleId")
    return this.commanderCycles.find((item) => item.cycle_id === id) ?? null
  }

  private listCommanderCycles(limit: number): CommanderCycleRecordSummary[] {
    return this.commanderCycles.slice(0, limit).map((item) => ({
      cycle_id: item.cycle_id,
      provider_id: item.provider_id,
      objective_preview: item.objective ? preview(item.objective) : undefined,
      topic_id: item.topic_id,
      mission_id: item.mission_id,
      title: item.title,
      summary_preview: preview(item.summary),
      proposal_ids: item.proposal_ids,
      bundle_id: item.bundle_id,
      created_at: item.created_at,
      requested_by: item.requested_by,
    }))
  }

  private previewOpenCodeHandoff(payload: Record<string, unknown>): OpenCodeHandoffPreviewSummary {
    const proposalId = requiredString(String(payload.proposalId ?? payload.proposal_id ?? ""), "proposalId")
    if (proposalId === "fake-handoff-proposal") this.ensureFakeHandoffProposal()
    const proposal = this.proposals.find((item) => item.proposal_id === proposalId)
    if (!proposal) {
      return {
        proposal_id: redactText(proposalId),
        eligible: false,
        blockers: [`commander proposal not found: ${redactText(proposalId)}`],
        action_kind: "missing",
        proposal_status: "missing",
        objective_preview: "",
        evidence_ids: [],
        would_create_mission: false,
        would_send_to_adapter: false,
      }
    }
    const review = proposal.review_id ? this.reviews.find((item) => item.review_id === proposal.review_id) : undefined
    const actionPayload = isRecord(proposal.action_payload) ? proposal.action_payload : {}
    const objective = optionalString(actionPayload.objective) ?? ""
    const evidenceIds = stringList(actionPayload.evidence_ids)
    const blockers: string[] = []
    if (proposal.action_kind !== "opencode_handoff") blockers.push("proposal action_kind must be opencode_handoff")
    if (!objective) blockers.push("objective is required")
    if (!proposal.review_id) blockers.push("proposal requires linked review")
    if (proposal.review_id && !review) blockers.push("linked review not found")
    if (review && review.status !== "approved") blockers.push("linked review must be approved")
    if (proposal.status !== "approved" && proposal.status !== "applied") blockers.push("proposal must be approved before handoff")
    return {
      proposal_id: proposal.proposal_id,
      eligible: blockers.length === 0,
      blockers: blockers.map(redactText),
      action_kind: proposal.action_kind,
      proposal_status: proposal.status,
      review_id: proposal.review_id,
      review_status: review?.status,
      objective_preview: preview(redactText(objective)),
      evidence_ids: evidenceIds.map(redactText),
      source_cycle_id: optionalString(actionPayload.source_cycle_id),
      source_synthesis_id: optionalString(actionPayload.source_synthesis_id),
      would_create_mission: blockers.length === 0 && proposal.status !== "applied",
      would_send_to_adapter: blockers.length === 0 && proposal.status !== "applied",
    }
  }

  private executeOpenCodeHandoff(payload: Record<string, unknown>): OpenCodeHandoffResultSummary {
    const proposalId = requiredString(String(payload.proposalId ?? payload.proposal_id ?? ""), "proposalId")
    const existing = this.opencodeHandoffs.find((item) => item.proposal_id === proposalId && item.sent)
    if (existing && payload.dryRun !== true && payload.dry_run !== true) return existing
    const handoffPreview = this.previewOpenCodeHandoff(payload)
    if (!handoffPreview.eligible) throw new Error(`opencode handoff is not eligible: ${handoffPreview.blockers.join("; ")}`)
    const requestedBy = redactText(String(payload.requestedBy ?? payload.requested_by ?? "operator"))
    const now = new Date(0).toISOString()
    if (payload.dryRun === true || payload.dry_run === true) {
      return {
        handoff_id: "dry-run",
        proposal_id: handoffPreview.proposal_id,
        review_id: handoffPreview.review_id,
        objective_preview: handoffPreview.objective_preview,
        sent: false,
        dry_run: true,
        created_at: now,
        requested_by: requestedBy,
        source_cycle_id: handoffPreview.source_cycle_id,
        source_synthesis_id: handoffPreview.source_synthesis_id,
        evidence_ids: handoffPreview.evidence_ids,
      }
    }
    this.sequence += 1
    const mission = this.createMission(handoffPreview.objective_preview)
    const result: OpenCodeHandoffResultSummary = {
      handoff_id: `fake-handoff-${this.sequence}`,
      proposal_id: handoffPreview.proposal_id,
      review_id: handoffPreview.review_id,
      mission_id: mission.missionId,
      intent_id: mission.intentId,
      objective_preview: handoffPreview.objective_preview,
      sent: true,
      dry_run: false,
      created_at: now,
      requested_by: requestedBy,
      source_cycle_id: handoffPreview.source_cycle_id,
      source_synthesis_id: handoffPreview.source_synthesis_id,
      evidence_ids: handoffPreview.evidence_ids,
    }
    const proposal = this.requireProposal(proposalId)
    proposal.status = "applied"
    proposal.applied_at = now
    proposal.updated_at = now
    proposal.application_result = `opencode_handoff:${result.handoff_id}:mission:${result.mission_id}`
    this.opencodeHandoffs.unshift(result)
    return result
  }

  private getOpenCodeHandoff(handoffId: string): OpenCodeHandoffResultSummary | null {
    const id = requiredString(handoffId, "handoffId")
    return this.opencodeHandoffs.find((item) => item.handoff_id === id) ?? null
  }

  private listOpenCodeHandoffs(limit: number): OpenCodeHandoffRecordSummary[] {
    return this.opencodeHandoffs.slice(0, limit).map((item) => ({
      handoff_id: item.handoff_id,
      proposal_id: item.proposal_id,
      mission_id: item.mission_id,
      intent_id: item.intent_id,
      sent: item.sent,
      created_at: item.created_at,
      requested_by: item.requested_by,
      source_cycle_id: item.source_cycle_id,
      source_synthesis_id: item.source_synthesis_id,
    }))
  }

  private previewOpenCodeProcessSmoke(payload: Record<string, unknown>): OpenCodeProcessSmokePreviewSummary {
    const timeoutMs = readSmokeTimeout(payload.timeoutMs ?? payload.timeout_ms)
    return {
      smoke_id: undefined,
      status: "ready",
      can_execute: true,
      adapter_kind: "fake",
      project_dir: "/fake/project",
      binary_path: "fake-opencode",
      binary_detected: true,
      opt_in_required: false,
      opt_in_present: true,
      timeout_ms: timeoutMs,
      blockers: [],
      warnings: ["fake runtime smoke does not launch a real process"],
      redacted_summary_preview: "fake OpenCode smoke ready; no real process launch",
    }
  }

  private executeOpenCodeProcessSmoke(payload: Record<string, unknown>): OpenCodeProcessSmokeResultSummary {
    const dryRun = payload.dryRun === true || payload.dry_run === true
    const now = new Date(0).toISOString()
    const result: OpenCodeProcessSmokeResultSummary = {
      smoke_id: dryRun ? "fake-smoke-dry-run" : `fake-smoke-${this.opencodeProcessSmokes.length + 1}`,
      status: dryRun ? "skipped" : "succeeded",
      adapter_kind: "fake",
      project_dir: "/fake/project",
      binary_path: "fake-opencode",
      started_at: now,
      completed_at: now,
      duration_ms: 0,
      exit_code: dryRun ? undefined : 0,
      diagnostics: [dryRun ? "fake dry-run did not launch process or write events" : "fake OpenCode process smoke succeeded without launching a real process"],
      requested_by: redactText(String(payload.requestedBy ?? payload.requested_by ?? "operator")),
      smoke_hash: fakeNavigationStageHash(`opencode-smoke:${dryRun ? "dry-run" : this.opencodeProcessSmokes.length + 1}`),
    }
    if (!dryRun) this.opencodeProcessSmokes.unshift(result)
    return result
  }

  private listOpenCodeProcessSmokes(limit: number): OpenCodeProcessSmokeRecordSummary[] {
    return this.opencodeProcessSmokes.slice(0, limit).map((item) => ({
      smoke_id: item.smoke_id,
      status: item.status,
      adapter_kind: item.adapter_kind,
      completed_at: item.completed_at,
      duration_ms: item.duration_ms,
      exit_code: item.exit_code,
      summary_preview: item.error ?? item.diagnostics[0] ?? item.status,
      smoke_hash: item.smoke_hash,
    }))
  }

  private getOpenCodeProcessSmoke(smokeId: string): OpenCodeProcessSmokeResultSummary | null {
    const id = requiredString(smokeId, "smokeId")
    return this.opencodeProcessSmokes.find((item) => item.smoke_id === id) ?? null
  }

  private previewOpenCodeHandoffReadiness(payload: Record<string, unknown>): OpenCodeHandoffReadinessPreviewSummary {
    const proposalId = optionalString(payload.proposalId ?? payload.proposal_id)
    const reviewId = optionalString(payload.reviewId ?? payload.review_id)
    const missionId = optionalString(payload.missionId ?? payload.mission_id)
    const handoffId = optionalString(payload.handoffId ?? payload.handoff_id)
    const latestSmoke = this.listOpenCodeProcessSmokes(1)[0]
    const blockers: string[] = []
    const warnings = ["fake/default runtime does not require real OpenCode smoke", "readiness preview does not execute handoff or launch OpenCode"]
    let handoffPreview: OpenCodeHandoffPreviewSummary | null = null
    if (proposalId) {
      try {
        handoffPreview = this.previewOpenCodeHandoff({ proposalId })
        if (!handoffPreview.eligible) blockers.push(...handoffPreview.blockers)
      } catch (error) {
        blockers.push(error instanceof Error ? error.message : String(error))
      }
    }
    const status = blockers.length > 0 ? "needs_review" : "ready"
    return {
      readiness_id: `fake-handoff-readiness-${proposalId ?? reviewId ?? missionId ?? handoffId ?? "general"}`,
      status,
      can_execute_now: false,
      proposal_id: proposalId,
      review_id: reviewId,
      mission_id: missionId,
      handoff_id: handoffId,
      authority: {
        command: "/handoff",
        slash_command: "/handoff",
        risk: "high_impact_write",
        gate: "handoff_runtime",
        owner: "opencode_handoff",
        blocked_by_default: true,
      },
      latest_smoke: latestSmoke,
      handoff_preview_summary: handoffPreview ? `eligible=${handoffPreview.eligible} proposal=${handoffPreview.proposal_id}` : undefined,
      required_evidence: [
        {
          evidence_id: latestSmoke ? `process_smoke:${latestSmoke.smoke_id}` : "process_smoke:none",
          kind: "process_smoke",
          related_id: latestSmoke?.smoke_id,
          status: latestSmoke?.status ?? "missing",
          fresh: latestSmoke?.status === "succeeded",
          completed_at: latestSmoke?.completed_at,
          age_ms: 0,
          summary_preview: latestSmoke?.summary_preview ?? "fake/default runtime smoke is optional",
          blockers: [],
          warnings: latestSmoke ? [] : ["no fake smoke record yet; run /opencode-smoke-dry-run or /opencode-smoke-preview"],
        },
        {
          evidence_id: "authority:/handoff",
          kind: "authority_record",
          related_id: "/handoff",
          status: "high_impact_write",
          fresh: true,
          summary_preview: "/handoff remains a high-impact explicit command",
          blockers: [],
          warnings: ["readiness does not execute high-impact handoff"],
        },
      ],
      optional_evidence: [
        {
          evidence_id: "handoff_followup:summary",
          kind: "handoff_followup",
          status: "ok",
          fresh: true,
          summary_preview: "fake handoff follow-up summary is available on demand",
          blockers: [],
          warnings: [],
        },
      ],
      blockers: blockers.map(redactText),
      warnings: warnings.map(redactText),
      recommended_commands: [
        { label: "Show handoff authority", command: "/authority-show /handoff", command_type: "read" },
        { label: "Preview OpenCode smoke", command: "/opencode-smoke-preview", command_type: "read" },
        { label: "List handoff follow-ups", command: "/handoff-followups", command_type: "read" },
        ...(proposalId ? [{ label: "Preview handoff", command: `/handoff-preview ${proposalId}`, command_type: "read" as const }] : []),
      ],
      generated_at: new Date(0).toISOString(),
      redacted_summary_preview: status === "ready" ? "fake handoff readiness is ready; execution remains explicit" : `fake handoff readiness blocked: ${blockers[0]}`,
    }
  }

  private openCodeHandoffReadinessSummary(): OpenCodeHandoffReadinessSummary {
    const preview = this.previewOpenCodeHandoffReadiness({})
    return {
      total_considered: 1,
      ready_count: preview.status === "ready" ? 1 : 0,
      blocked_count: preview.status === "blocked" ? 1 : 0,
      needs_smoke_count: preview.status === "needs_smoke" ? 1 : 0,
      needs_review_count: preview.status === "needs_review" ? 1 : 0,
      latest_smoke_status: preview.latest_smoke?.status,
      latest_handoff_status: this.opencodeHandoffs[0] ? (this.opencodeHandoffs[0].sent ? "sent" : "not_sent") : undefined,
      generated_at: new Date(0).toISOString(),
    }
  }

  private previewOpenCodeResultReviewPacket(payload: Record<string, unknown>): OpenCodeResultReviewPacketSummary {
    const handoffId = optionalString(payload.handoffId ?? payload.handoff_id)
    const followupId = optionalString(payload.followupId ?? payload.followup_id)
    const missionIdInput = optionalString(payload.missionId ?? payload.mission_id)
    const resultIdInput = optionalString(payload.resultId ?? payload.result_id)
    const proposalIdInput = optionalString(payload.proposalId ?? payload.proposal_id)
    const handoff = handoffId || followupId
      ? this.opencodeHandoffs.find((item) => item.handoff_id === (handoffId ?? followupId))
      : this.opencodeHandoffs[0]
    const followup = handoff ? this.buildOpenCodeHandoffFollowups().find((item) => item.handoff_id === handoff.handoff_id) : undefined
    const result = resultIdInput
      ? (this.results.find((item) => item.result_id === resultIdInput)
        ?? (resultIdInput === "result-handoff-1" ? {
          result_id: "result-handoff-1",
          mission_id: "mission-handoff-1",
          claim_id: "claim-handoff-1",
          summary: "fake executor result summary",
          status: "submitted",
          created_at: new Date(0).toISOString(),
        } : undefined))
      : this.results.find((item) => item.mission_id === (missionIdInput ?? followup?.mission_id ?? handoff?.mission_id))
    const missionId = missionIdInput ?? result?.mission_id ?? followup?.mission_id ?? handoff?.mission_id
    const mission = missionId ? this.missions.find((item) => item.mission_id === missionId) : undefined
    const proposalId = proposalIdInput ?? followup?.proposal_id ?? handoff?.proposal_id
    const proposal = proposalId ? this.proposals.find((item) => item.proposal_id === proposalId) : undefined
    const review = proposal?.review_id ? this.reviews.find((item) => item.review_id === proposal.review_id) : undefined
    const evidence = [
      ...(handoff ? [{
        evidence_id: `handoff:${handoff.handoff_id}`,
        kind: "handoff",
        related_id: handoff.handoff_id,
        status: handoff.sent ? "sent" : "not_sent",
        fresh: handoff.sent,
        completed_at: handoff.created_at,
        summary_preview: `fake handoff proposal=${handoff.proposal_id} mission=${handoff.mission_id ?? "none"}`,
        blockers: handoff.sent ? [] : ["handoff was not sent"],
        warnings: [],
      }] : []),
      ...(followup ? [{
        evidence_id: `handoff_followup:${followup.handoff_id}`,
        kind: "handoff_followup",
        related_id: followup.handoff_id,
        status: followup.followup_status,
        fresh: followup.followup_status !== "failed" && followup.followup_status !== "blocked",
        completed_at: followup.updated_at,
        summary_preview: `fake follow-up ${followup.followup_status}; progress=${followup.progress_count} results=${followup.result_count}`,
        blockers: followup.blockers,
        warnings: [],
      }] : []),
      ...(mission ? [{
        evidence_id: `mission:${mission.mission_id}`,
        kind: "mission",
        related_id: mission.mission_id,
        status: mission.status,
        fresh: true,
        completed_at: mission.updated_at,
        summary_preview: mission.objective ?? mission.status,
        blockers: [],
        warnings: [],
      }] : []),
      ...(result ? [{
        evidence_id: `mission_result:${result.result_id}`,
        kind: "mission_result",
        related_id: result.result_id,
        status: result.status,
        fresh: true,
        completed_at: result.created_at,
        summary_preview: result.summary,
        blockers: [],
        warnings: [],
      }] : []),
      ...(proposal ? [{
        evidence_id: `proposal:${proposal.proposal_id}`,
        kind: "proposal",
        related_id: proposal.proposal_id,
        status: proposal.status,
        fresh: true,
        completed_at: proposal.updated_at,
        summary_preview: proposal.summary,
        blockers: [],
        warnings: [],
      }] : []),
      ...(review ? [{
        evidence_id: `review:${review.review_id}`,
        kind: "review",
        related_id: review.review_id,
        status: review.status,
        fresh: true,
        completed_at: review.updated_at,
        summary_preview: review.summary,
        blockers: [],
        warnings: [],
      }] : []),
      {
        evidence_id: "authority:/handoff",
        kind: "authority",
        related_id: "/handoff",
        status: "high_impact_write",
        fresh: true,
        summary_preview: "/handoff is high_impact_write owner=opencode_handoff gate=handoff_runtime",
        blockers: [],
        warnings: ["result review packet does not execute handoff"],
      },
      {
        evidence_id: "handoff_readiness:summary",
        kind: "handoff_readiness",
        status: this.openCodeHandoffReadinessSummary().ready_count > 0 ? "ready" : "unknown",
        fresh: true,
        summary_preview: "fake readiness summary is read-only",
        blockers: [],
        warnings: [],
      },
    ].map((item) => ({
      ...item,
      evidence_id: redactText(item.evidence_id),
      related_id: item.related_id ? redactText(item.related_id) : undefined,
      status: redactText(item.status),
      summary_preview: redactText(item.summary_preview),
      blockers: item.blockers.map(redactText),
      warnings: item.warnings.map(redactText),
    }))
    const blockers: string[] = []
    const warnings: string[] = []
    if (!handoff && !mission && !result && !proposal) blockers.push("no OpenCode handoff, mission result, mission, or proposal evidence was found")
    if ((handoff || followup || mission) && !result) warnings.push("executor outcome has no submitted mission result yet")
    const failed = followup && ["failed", "blocked", "cancelled", "handoff_failed"].includes(followup.followup_status)
    const status = result ? "ready_for_commander_review" : failed ? "failed" : blockers.length > 0 ? "blocked" : handoff || mission ? "needs_result" : proposal ? "needs_handoff" : "unknown"
    return {
      packet_id: `fake-result-review-${handoff?.handoff_id ?? mission?.mission_id ?? result?.result_id ?? proposal?.proposal_id ?? "latest"}`,
      status,
      handoff_id: handoff?.handoff_id ?? handoffId ?? followupId,
      followup_id: followup?.handoff_id ?? followupId,
      mission_id: mission?.mission_id ?? missionId,
      result_id: result?.result_id ?? resultIdInput,
      claim_id: result?.claim_id ?? followup?.active_claim_id,
      proposal_id: proposal?.proposal_id ?? proposalId,
      review_id: review?.review_id ?? handoff?.review_id ?? followup?.review_id,
      title: status === "ready_for_commander_review" ? "OpenCode executor result is ready for Commander review" : status === "needs_result" ? "OpenCode executor handoff needs a mission result" : "OpenCode result review packet has insufficient evidence",
      objective_preview: redactText(handoff?.objective_preview ?? mission?.objective ?? proposal?.summary ?? ""),
      executor_summary_preview: followup ? `follow-up ${followup.followup_status}; progress=${followup.progress_count} results=${followup.result_count}` : undefined,
      result_summary_preview: result?.summary ? redactText(result.summary) : undefined,
      artifact_previews: [],
      evidence: evidence.slice(0, 12),
      blockers: blockers.map(redactText),
      warnings: warnings.map(redactText),
      recommended_commands: [
        { label: "List handoff follow-ups", command: "/handoff-followups", command_type: "read" as const },
        { label: "Show handoff authority", command: "/authority-show /handoff", command_type: "read" as const },
        { label: "Show handoff readiness", command: handoff?.handoff_id ? `/handoff-readiness handoff=${handoff.handoff_id}` : "/handoff-readiness", command_type: "read" as const },
        ...(handoff ? [{ label: "Show handoff follow-up", command: `/handoff-followup ${handoff.handoff_id}`, command_type: "read" as const }] : []),
        ...(mission ? [{ label: "Show mission", command: `/mission ${mission.mission_id}`, command_type: "read" as const }, { label: "List mission results", command: `/results ${mission.mission_id}`, command_type: "read" as const }] : []),
      ].map((command): { label: string; command: string; command_type: "read" | "write" } => ({ ...command, command: redactText(command.command), label: redactText(command.label), command_type: command.command_type })),
      generated_at: new Date(0).toISOString(),
      redacted_summary_preview: status === "ready_for_commander_review" ? "packet ready for Commander review" : (blockers[0] ?? warnings[0] ?? status),
    }
  }

  private openCodeResultReviewSummary(): OpenCodeResultReviewSummary {
    const followups = this.buildOpenCodeHandoffFollowups()
    let ready = 0
    let needsResult = 0
    let failed = 0
    let blocked = 0
    let stale = 0
    for (const followup of followups) {
      const result = this.results.find((item) => item.mission_id === followup.mission_id)
      if (result) ready += 1
      else if (["failed", "cancelled", "handoff_failed"].includes(followup.followup_status)) failed += 1
      else if (followup.followup_status === "blocked") blocked += 1
      else if (followup.followup_status === "sent") needsResult += 1
      else stale += 1
    }
    return {
      total_considered: followups.length,
      ready_count: ready,
      needs_result_count: needsResult,
      failed_count: failed,
      blocked_count: blocked,
      stale_count: stale,
      latest_handoff_id: followups[0]?.handoff_id,
      latest_result_id: this.results[0]?.result_id,
      generated_at: new Date(0).toISOString(),
    }
  }

  private previewCommanderExecutorReview(payload: Record<string, unknown>): CommanderExecutorReviewPreviewSummary {
    const packet = this.previewOpenCodeResultReviewPacket(payload)
    const ready = packet.status === "ready_for_commander_review"
    return {
      review_id: ready ? "fake-executor-review-preview" : undefined,
      packet_id: packet.packet_id,
      packet_status: packet.status,
      can_execute: ready,
      provider_kind: "fake-commander-executor-review",
      provider_ready: true,
      blockers: ready ? [] : [`result review packet is ${packet.status}; Commander review requires ready_for_commander_review`],
      warnings: ["executor review does not create proposals, apply changes, or launch OpenCode"],
      packet_summary_preview: packet.redacted_summary_preview,
      prompt_preview: `Review bounded packet ${packet.packet_id}; do not create proposals or run commands.`,
      recommended_commands: [
        { label: "Inspect result packet", command: packet.result_id ? `/result-review-packet result=${packet.result_id}` : "/result-review-packet", command_type: "read" },
        { label: "Show executor review records", command: "/executor-reviews", command_type: "read" },
        { label: "Show handoff authority", command: "/authority-show /handoff", command_type: "read" },
      ],
      generated_at: new Date(0).toISOString(),
    }
  }

  private executeCommanderExecutorReview(payload: Record<string, unknown>): CommanderExecutorReviewResultSummary {
    const preview = this.previewCommanderExecutorReview(payload)
    const dryRun = payload.dryRun === true || payload.dry_run === true
    const reviewId = dryRun ? "dry-run" : `fake-executor-review-${++this.sequence}`
    const status = preview.can_execute && !dryRun ? "succeeded" : "blocked"
    const result: CommanderExecutorReviewResultSummary = {
      review_id: reviewId,
      packet_id: preview.packet_id ?? "fake-result-review-latest",
      packet_status: preview.packet_status ?? "unknown",
      status,
      provider_kind: preview.provider_kind,
      decision: preview.can_execute ? "accept_result" : "blocked",
      confidence: preview.can_execute ? 0.82 : 0,
      summary: dryRun
        ? "dry-run: Commander executor review would call fake provider once"
        : preview.can_execute
          ? "Fake Commander review accepted the executor result packet for manual follow-up."
          : "Fake Commander review blocked because the packet is not ready.",
      findings: preview.can_execute ? [{
        finding_id: "finding_executor_packet_readiness",
        severity: "info",
        title: "Executor packet readiness",
        summary: "Bounded packet evidence is sufficient for Commander review.",
        evidence_ids: ["handoff:fake-handoff-1", "mission_result:result-handoff-1"],
        recommended_commands: preview.recommended_commands.slice(0, 2),
      }] : [],
      evidence_ids: ["handoff:fake-handoff-1", "mission_result:result-handoff-1"],
      recommended_commands: preview.recommended_commands,
      started_at: new Date(0).toISOString(),
      completed_at: new Date(0).toISOString(),
      requested_by: "tui",
      review_hash: `fake-review-hash-${reviewId}`,
      result_id: "result-handoff-1",
      mission_id: "mission-handoff-1",
      handoff_id: "handoff-1",
    }
    if (!dryRun) this.commanderExecutorReviews.unshift(result)
    return result
  }

  private previewExecutorReviewProposalDrafts(payload: Record<string, unknown>): ExecutorReviewProposalDraftPreviewSummary {
    const reviewId = String(payload.reviewId ?? payload.review_id ?? "")
    const resultId = String(payload.resultId ?? payload.result_id ?? "")
    const packetId = String(payload.packetId ?? payload.packet_id ?? "")
    const missionId = String(payload.missionId ?? payload.mission_id ?? "")
    const handoffId = String(payload.handoffId ?? payload.handoff_id ?? "")
    const proposalId = String(payload.proposalId ?? payload.proposal_id ?? "")
    const hasExplicitTarget = Boolean(reviewId || resultId || packetId || missionId || handoffId || proposalId)
    const review = this.commanderExecutorReviews.find((item) =>
      (reviewId ? item.review_id === reviewId : true)
      && (resultId ? item.result_id === resultId : true)
      && (packetId ? item.packet_id === packetId : true)
      && (missionId ? item.mission_id === missionId : true)
      && (handoffId ? item.handoff_id === handoffId : true)
      && (proposalId ? item.proposal_id === proposalId : true),
    ) ?? (hasExplicitTarget ? undefined : this.commanderExecutorReviews[0])
    const blockers = review ? [] : [
      hasExplicitTarget
        ? "no Commander executor review matched the requested draft target"
        : "no Commander executor review records were found",
    ]
    const candidates: ExecutorReviewProposalDraftCandidateSummary[] = review && review.status === "succeeded" && review.decision === "accept_result"
      ? [{
        draft_id: `fake-draft-${review.review_id}`,
        draft_kind: review.result_id ? "mission_result" : "mission_progress",
        title: "Draft accepted executor result",
        summary: review.summary,
        rationale: "Fake Commander executor review accepted the bounded executor result packet.",
        source_review_id: review.review_id,
        source_packet_id: review.packet_id,
        mission_id: review.mission_id,
        result_id: review.result_id,
        handoff_id: review.handoff_id,
        proposal_id: review.proposal_id,
        evidence_ids: review.evidence_ids,
        finding_ids: review.findings.map((finding) => finding.finding_id),
        confidence: review.confidence,
        risk: "low",
        would_create_proposal: false,
        would_mutate_mission: false,
        recommended_commands: [
          { label: "Show executor review", command: `/executor-review-show ${review.review_id}`, command_type: "read" },
          { label: "Inspect result packet", command: review.result_id ? `/result-review-packet result=${review.result_id}` : "/result-review-packet", command_type: "read" },
        ],
      }]
      : []
    return {
      preview_id: review ? `fake-draft-preview-${review.review_id}` : "fake-draft-preview-none",
      status: candidates.length > 0 ? "ready" : (review ? "blocked" : "unknown"),
      review_id: review?.review_id,
      packet_id: review?.packet_id,
      review_decision: review?.decision,
      review_confidence: review?.confidence,
      can_create_proposals_now: false,
      candidates,
      blockers,
      warnings: ["draft preview does not create proposals, request reviews, apply changes, call providers, or launch OpenCode"],
      recommended_commands: [
        { label: "Show executor reviews", command: "/executor-reviews", command_type: "read" },
        { label: "Show draft authority", command: "/authority-show /executor-review-draft-preview", command_type: "read" },
      ],
      generated_at: new Date(0).toISOString(),
      redacted_summary_preview: candidates.length > 0 ? `${candidates.length} fake draft candidate(s); no proposal was created.` : "No fake executor review is available for draft preview.",
    }
  }

  private executorReviewProposalDraftSummary(): ExecutorReviewProposalDraftSummary {
    const draftable = this.commanderExecutorReviews.filter((review) => review.status === "succeeded" && review.decision === "accept_result").length
    return {
      total_reviews_considered: this.commanderExecutorReviews.length,
      draftable_review_count: draftable,
      blocked_review_count: Math.max(0, this.commanderExecutorReviews.length - draftable),
      candidate_count: draftable,
      latest_review_id: this.commanderExecutorReviews[0]?.review_id,
      generated_at: new Date(0).toISOString(),
    }
  }

  private previewExecutorReviewProposalCreate(payload: Record<string, unknown>): ExecutorReviewProposalCreatePreviewSummary {
    const reviewId = requiredString(String(payload.reviewId ?? payload.review_id ?? ""), "review")
    const draftId = requiredString(String(payload.draftId ?? payload.draft_id ?? ""), "draft")
    const draftPreview = this.previewExecutorReviewProposalDrafts({ reviewId })
    const candidate = draftPreview.candidates.find((item) => item.draft_id === draftId)
    const existing = this.executorReviewProposalCreates.find((item) => item.review_id === reviewId && item.draft_id === draftId && item.status === "created")
    const existingProposal = existing?.proposal_id ? this.proposals.find((proposal) => proposal.proposal_id === existing.proposal_id) : undefined
    const blockers = [
      ...(candidate ? [] : ["requested draft_id was not found for the exact executor review"]),
      ...(existing ? ["proposal already exists for this executor review draft"] : []),
    ]
    return {
      preview_id: `fake-proposal-create-preview-${reviewId}-${draftId}`,
      status: blockers.length === 0 ? "ready" : "blocked",
      can_create: blockers.length === 0,
      review_id: reviewId,
      draft_id: draftId,
      source_packet_id: candidate?.source_packet_id,
      draft_kind: candidate?.draft_kind ?? "other",
      title_preview: candidate?.title ?? "Executor review proposal",
      summary_preview: candidate?.summary ?? "No draft candidate is available for proposal creation.",
      proposed_action_kind: "other",
      target_mission_id: candidate?.mission_id,
      target_result_id: candidate?.result_id,
      target_handoff_id: candidate?.handoff_id,
      target_proposal_id: candidate?.proposal_id,
      evidence_ids: candidate?.evidence_ids ?? [],
      finding_ids: candidate?.finding_ids ?? [],
      source_confidence: candidate?.confidence ?? draftPreview.review_confidence ?? 0,
      risk: candidate?.risk ?? "medium",
      existing_proposal_id: existing?.proposal_id,
      existing_proposal_status: existingProposal?.status,
      blockers,
      warnings: ["proposal creation does not request review, apply changes, mutate missions, call providers, or launch OpenCode"],
      recommended_commands: [
        { label: "Show executor review", command: `/executor-review-show ${reviewId}`, command_type: "read" },
        { label: "Preview draft", command: `/executor-review-draft-preview review=${reviewId}`, command_type: "read" },
        { label: "List proposals", command: "/proposals", command_type: "read" },
      ],
      generated_at: new Date(0).toISOString(),
      redacted_summary_preview: blockers.length === 0 ? `Draft ${draftId} can create one fake proposed Commander proposal.` : blockers[0] ?? "Proposal creation is blocked.",
    }
  }

  private createExecutorReviewProposal(payload: Record<string, unknown>): ExecutorReviewProposalCreateResultSummary {
    const dryRun = payload.dryRun === true || payload.dry_run === true
    const preview = this.previewExecutorReviewProposalCreate(payload)
    const createId = `fake-create-${preview.review_id}-${preview.draft_id}`
    const existing = this.executorReviewProposalCreates.find((item) => item.review_id === preview.review_id && item.draft_id === preview.draft_id && item.status === "created")
    const existingProposal = existing?.proposal_id ? this.proposals.find((proposal) => proposal.proposal_id === existing.proposal_id) : undefined
    if (!dryRun && existing && existingProposal?.status !== "cancelled") return existing
    const result: ExecutorReviewProposalCreateResultSummary = {
      create_id: createId,
      status: dryRun && preview.can_create ? "dry_run" : preview.can_create ? "created" : "blocked",
      proposal_id: existing && existingProposal?.status === "cancelled" ? existing.proposal_id : !dryRun && preview.can_create ? `fake-proposal-${this.proposals.length + 1}` : undefined,
      review_id: preview.review_id,
      draft_id: preview.draft_id,
      source_packet_id: preview.source_packet_id,
      draft_kind: preview.draft_kind,
      proposed_action_kind: preview.proposed_action_kind,
      title_preview: preview.title_preview,
      summary_preview: preview.summary_preview,
      evidence_ids: preview.evidence_ids,
      finding_ids: preview.finding_ids,
      created_at: new Date(0).toISOString(),
      requested_by: "tui",
      error: existingProposal?.status === "cancelled" ? "proposal already exists for this executor review draft and was cancelled" : preview.blockers[0],
      create_hash: `fake-create-hash-${preview.review_id}-${preview.draft_id}`,
      recommended_commands: preview.recommended_commands,
    }
    if (!dryRun && result.status === "created" && result.proposal_id) {
      this.proposals.unshift({
        proposal_id: result.proposal_id,
        mission_id: preview.target_mission_id,
        result_id: preview.target_result_id,
        action_kind: "other",
        title: result.title_preview,
        summary: result.summary_preview,
        proposed_by: "tui",
        status: "proposed",
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
          create_hash: result.create_hash,
        },
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
      })
      this.executorReviewProposalCreates.unshift(result)
    }
    return result
  }

  private previewExecutorReviewProposalReviewRequest(payload: Record<string, unknown>): ExecutorReviewProposalReviewRequestPreviewSummary {
    const proposalId = requiredString(String(payload.proposalId ?? payload.proposal_id ?? ""), "proposal")
    const createId = optionalString(payload.createId ?? payload.create_id)
    const proposal = this.proposals.find((item) => item.proposal_id === proposalId)
    const createRecord = this.executorReviewProposalCreates.find((item) => item.proposal_id === proposalId && item.status === "created")
    const source = proposal?.action_payload
    const sourceReviewId = typeof source?.review_id === "string" ? source.review_id : createRecord?.review_id
    const sourceDraftId = typeof source?.draft_id === "string" ? source.draft_id : createRecord?.draft_id
    const sourceCreateId = createRecord?.create_id ?? (typeof source?.create_hash === "string" ? `fake-create-${sourceReviewId}-${sourceDraftId}` : undefined)
    const blockers = [
      ...(proposal ? [] : ["proposal_id was not found"]),
      ...(proposal && source?.source !== "executor_review_proposal_create" && !createRecord ? ["proposal was not created by executor-review proposal creation gate"] : []),
      ...(proposal && (!sourceReviewId || !sourceDraftId) ? ["executor-review proposal source metadata is incomplete"] : []),
      ...(proposal && ["cancelled", "applied", "rejected"].includes(proposal.status) ? [`proposal status ${proposal.status} cannot request review`] : []),
      ...(createId && sourceCreateId && createId !== sourceCreateId ? ["create_id does not match the proposal source create record"] : []),
      ...(proposal?.review_id ? ["review request already exists for this executor-review proposal"] : []),
    ]
    const review = proposal?.review_id ? this.reviews.find((item) => item.review_id === proposal.review_id) : undefined
    return {
      preview_id: `fake-review-request-preview-${proposalId}`,
      status: blockers.length === 0 ? "ready" : "blocked",
      can_request: blockers.length === 0,
      proposal_id: proposalId,
      create_id: sourceCreateId,
      review_id: sourceReviewId,
      draft_id: sourceDraftId,
      source_packet_id: typeof source?.source_packet_id === "string" ? source.source_packet_id : createRecord?.source_packet_id,
      proposal_status: proposal?.status,
      proposal_title_preview: proposal?.title ?? "Executor review proposal",
      proposal_summary_preview: proposal?.summary ?? "No executor-review proposal is available.",
      action_kind: proposal?.action_kind,
      mission_id: proposal?.mission_id,
      result_id: proposal?.result_id,
      source_evidence_ids: Array.isArray(source?.evidence_ids) ? source.evidence_ids.map(String) : createRecord?.evidence_ids ?? [],
      source_finding_ids: Array.isArray(source?.finding_ids) ? source.finding_ids.map(String) : createRecord?.finding_ids ?? [],
      source_confidence: typeof source?.source_confidence === "number" ? source.source_confidence : undefined,
      risk: typeof source?.risk === "string" ? source.risk : undefined,
      existing_review_request_id: proposal?.review_id,
      existing_review_request_status: review?.status,
      blockers,
      warnings: ["review request does not approve, reject, apply, mutate missions, call providers, or launch OpenCode"],
      recommended_commands: [
        { label: "Show proposal", command: `/proposal ${proposalId}`, command_type: "read" },
        { label: "List reviews", command: "/reviews", command_type: "read" },
        { label: "Show authority", command: "/authority-show /executor-review-proposal-review-request", command_type: "read" },
      ],
      generated_at: new Date(0).toISOString(),
      redacted_summary_preview: blockers.length === 0 ? `Proposal ${proposalId} can request one fake review.` : blockers[0] ?? "Review request is blocked.",
    }
  }

  private requestExecutorReviewProposalReview(payload: Record<string, unknown>): ExecutorReviewProposalReviewRequestResultSummary {
    const dryRun = payload.dryRun === true || payload.dry_run === true
    const preview = this.previewExecutorReviewProposalReviewRequest(payload)
    const existing = this.executorReviewProposalReviewRequests.find((item) => item.proposal_id === preview.proposal_id && item.status === "requested")
    const duplicateOnly = preview.existing_review_request_id
      && preview.blockers.length === 1
      && preview.blockers[0] === "review request already exists for this executor-review proposal"
    if (!dryRun && existing && duplicateOnly) return existing
    const requestGateId = `fake-review-request-gate-${preview.proposal_id}`
    const result: ExecutorReviewProposalReviewRequestResultSummary = {
      request_gate_id: requestGateId,
      status: dryRun && preview.can_request ? "dry_run" : preview.can_request ? "requested" : "blocked",
      review_request_id: !dryRun && preview.can_request ? `fake-review-request-${this.reviews.length + 1}` : preview.existing_review_request_id,
      proposal_id: preview.proposal_id,
      create_id: preview.create_id,
      review_id: preview.review_id,
      draft_id: preview.draft_id,
      source_packet_id: preview.source_packet_id,
      mission_id: preview.mission_id,
      result_id: preview.result_id,
      requested_at: new Date(0).toISOString(),
      requested_by: "tui",
      error: preview.can_request ? undefined : preview.blockers[0],
      request_hash: `fake-review-request-hash-${preview.proposal_id}`,
      recommended_commands: preview.recommended_commands,
    }
    if (!dryRun && result.status === "requested" && result.review_request_id) {
      const proposal = this.proposals.find((item) => item.proposal_id === result.proposal_id)
      if (proposal) {
        this.reviews.unshift({
          review_id: result.review_request_id,
          mission_id: proposal.mission_id,
          claim_id: proposal.claim_id,
          result_id: proposal.result_id,
          request_type: reviewTypeForProposal(proposal.action_kind),
          title: proposal.title,
          summary: proposal.summary,
          requested_by: "tui",
          status: "pending",
          created_at: new Date(0).toISOString(),
          updated_at: new Date(0).toISOString(),
        })
        proposal.review_id = result.review_request_id
        proposal.status = "review_requested"
        proposal.updated_at = new Date(0).toISOString()
      }
      this.executorReviewProposalReviewRequests.unshift(result)
    }
    return result
  }

  private previewExecutorReviewProposalReviewDecision(payload: Record<string, unknown>): ExecutorReviewProposalReviewDecisionPreviewSummary {
    const reviewRequestId = requiredString(String(payload.reviewRequestId ?? payload.review_request_id ?? payload.reviewId ?? payload.review_id ?? ""), "review")
    const decision = readReviewDecision(String(payload.decision ?? ""))
    const reason = optionalString(payload.reason)
    const requestGateId = optionalString(payload.requestGateId ?? payload.request_gate_id ?? payload.request)
    const review = this.reviews.find((item) => item.review_id === reviewRequestId)
    const requestRecord = this.executorReviewProposalReviewRequests.find((item) => item.review_request_id === reviewRequestId && item.status === "requested")
    const proposal = requestRecord?.proposal_id ? this.proposals.find((item) => item.proposal_id === requestRecord.proposal_id) : undefined
    const source = proposal?.action_payload
    const blockers = [
      ...(review ? [] : ["review_request_id was not found"]),
      ...(requestRecord ? [] : ["review request was not created by executor-review proposal review-request gate"]),
      ...(requestGateId && requestRecord && requestGateId !== requestRecord.request_gate_id ? ["request_gate_id does not match the review-request gate record"] : []),
      ...(proposal ? [] : ["linked proposal was not found"]),
      ...(proposal && !requestRecord && source?.source !== "executor_review_proposal_create" ? ["proposal was not created by executor-review proposal creation gate"] : []),
      ...(proposal && ["cancelled", "applied"].includes(proposal.status) ? [`proposal status ${proposal.status} cannot be review-decided`] : []),
      ...(review && review.status !== "pending" ? [`review request already ${review.status}`] : []),
      ...(decision === "reject" && !reason ? ["reject decision requires reason"] : []),
    ]
    return {
      preview_id: `fake-review-decision-preview-${reviewRequestId}-${decision}`,
      status: blockers.length === 0 ? "ready" : "blocked",
      can_decide: blockers.length === 0,
      decision,
      review_request_id: reviewRequestId,
      proposal_id: proposal?.proposal_id ?? requestRecord?.proposal_id,
      request_gate_id: requestRecord?.request_gate_id,
      create_id: requestRecord?.create_id,
      source_executor_review_id: requestRecord?.review_id ?? (typeof source?.review_id === "string" ? source.review_id : undefined),
      source_draft_id: requestRecord?.draft_id ?? (typeof source?.draft_id === "string" ? source.draft_id : undefined),
      source_packet_id: requestRecord?.source_packet_id ?? (typeof source?.source_packet_id === "string" ? source.source_packet_id : undefined),
      review_request_status: review?.status,
      proposal_status: proposal?.status,
      proposal_title_preview: proposal?.title ?? review?.title ?? "Executor review proposal",
      proposal_summary_preview: proposal?.summary ?? review?.summary ?? "No executor-review proposal review request is available.",
      action_kind: proposal?.action_kind,
      mission_id: proposal?.mission_id ?? review?.mission_id,
      result_id: proposal?.result_id ?? review?.result_id,
      source_evidence_ids: Array.isArray(source?.evidence_ids) ? source.evidence_ids.map(String) : [],
      source_finding_ids: Array.isArray(source?.finding_ids) ? source.finding_ids.map(String) : [],
      source_confidence: typeof source?.source_confidence === "number" ? source.source_confidence : undefined,
      risk: typeof source?.risk === "string" ? source.risk : undefined,
      existing_decision: review && review.status !== "pending" ? review.status : undefined,
      existing_decision_at: review?.decision_at,
      blockers,
      warnings: ["review decision does not apply proposals, mutate missions, call providers, or launch OpenCode"],
      recommended_commands: [
        { label: "Show review", command: `/review ${reviewRequestId}`, command_type: "read" },
        { label: "List decisions", command: "/executor-review-proposal-review-decisions", command_type: "read" },
        { label: "Show authority", command: decision === "approve" ? "/authority-show /executor-review-proposal-review-approve" : "/authority-show /executor-review-proposal-review-reject", command_type: "read" },
      ],
      generated_at: new Date(0).toISOString(),
      redacted_summary_preview: blockers.length === 0 ? `Review request ${reviewRequestId} can be ${decision === "approve" ? "approved" : "rejected"}.` : blockers[0] ?? "Review decision is blocked.",
    }
  }

  private decideExecutorReviewProposalReview(payload: Record<string, unknown>): ExecutorReviewProposalReviewDecisionResultSummary {
    const dryRun = payload.dryRun === true || payload.dry_run === true
    const preview = this.previewExecutorReviewProposalReviewDecision(payload)
    const reason = optionalString(payload.reason)
    const existing = this.executorReviewProposalReviewDecisions.find((item) => item.review_request_id === preview.review_request_id)
    const duplicateOnly = preview.existing_decision
      && preview.blockers.length === 1
      && preview.blockers[0] === `review request already ${preview.existing_decision}`
    if (!dryRun && existing && duplicateOnly && existing.decision === preview.decision) return existing
    if (!dryRun && existing && duplicateOnly && existing.decision !== preview.decision) {
      return {
        ...existing,
        status: "blocked",
        decision: preview.decision,
        error: `review request already ${preview.existing_decision}`,
      }
    }
    const result: ExecutorReviewProposalReviewDecisionResultSummary = {
      decision_gate_id: `fake-review-decision-gate-${preview.review_request_id}-${preview.decision}`,
      status: dryRun && preview.can_decide ? "dry_run" : preview.can_decide ? preview.decision === "approve" ? "approved" : "rejected" : "blocked",
      decision: preview.decision,
      review_request_id: preview.review_request_id,
      proposal_id: preview.proposal_id,
      request_gate_id: preview.request_gate_id,
      create_id: preview.create_id,
      source_executor_review_id: preview.source_executor_review_id,
      source_draft_id: preview.source_draft_id,
      source_packet_id: preview.source_packet_id,
      mission_id: preview.mission_id,
      result_id: preview.result_id,
      decided_at: new Date(0).toISOString(),
      decided_by: "tui",
      reason_preview: reason,
      error: preview.can_decide ? undefined : preview.blockers[0],
      decision_hash: `fake-review-decision-hash-${preview.review_request_id}-${preview.decision}`,
      recommended_commands: preview.recommended_commands,
    }
    if (!dryRun && (result.status === "approved" || result.status === "rejected")) {
      const review = this.reviews.find((item) => item.review_id === result.review_request_id)
      if (review) {
        review.status = result.status
        review.decision_at = result.decided_at
        review.decision_by = result.decided_by
        review.decision_reason = reason
        review.updated_at = result.decided_at
      }
      const proposal = result.proposal_id ? this.proposals.find((item) => item.proposal_id === result.proposal_id) : undefined
      if (proposal) {
        proposal.status = result.status
        proposal.updated_at = result.decided_at
      }
      this.executorReviewProposalReviewDecisions.unshift(result)
    }
    return result
  }

  private previewExecutorReviewProposalApplyReadiness(payload: Record<string, unknown>): ExecutorReviewProposalApplyReadinessPreviewSummary {
    const proposalId = optionalString(payload.proposalId ?? payload.proposal_id ?? payload.proposal)
      ?? this.proposalIdForFakeReview(optionalString(payload.reviewRequestId ?? payload.review_request_id ?? payload.reviewId ?? payload.review_id ?? payload.review))
      ?? this.proposalIdForFakeDecision(optionalString(payload.decisionGateId ?? payload.decision_gate_id ?? payload.decision))
      ?? this.proposalIdForFakeCreate(optionalString(payload.createId ?? payload.create_id ?? payload.create))
    if (!proposalId) return this.fakeApplyReadinessNoTarget()
    const proposal = this.proposals.find((item) => item.proposal_id === proposalId)
    const source = isRecord(proposal?.action_payload) ? proposal.action_payload : {}
    const reviewId = optionalString(payload.reviewRequestId ?? payload.review_request_id ?? payload.reviewId ?? payload.review_id ?? payload.review) ?? proposal?.review_id
    const review = reviewId ? this.reviews.find((item) => item.review_id === reviewId) : undefined
    const requestRecord = reviewId ? this.executorReviewProposalReviewRequests.find((item) => item.review_request_id === reviewId && item.status === "requested") : undefined
    const createRecord = optionalString(payload.createId ?? payload.create_id ?? payload.create)
      ? this.executorReviewProposalCreates.find((item) => item.create_id === optionalString(payload.createId ?? payload.create_id ?? payload.create))
      : this.executorReviewProposalCreates.find((item) => item.proposal_id === proposalId && item.status === "created")
    const decisionRecord = optionalString(payload.decisionGateId ?? payload.decision_gate_id ?? payload.decision)
      ? this.executorReviewProposalReviewDecisions.find((item) => item.decision_gate_id === optionalString(payload.decisionGateId ?? payload.decision_gate_id ?? payload.decision))
      : reviewId ? this.executorReviewProposalReviewDecisions.find((item) => item.review_request_id === reviewId && (item.status === "approved" || item.status === "rejected")) : undefined
    const candidateKind = fakeApplyCandidateKind(proposal)
    const candidateRisk = fakeApplyCandidateRisk(candidateKind, optionalString(source.risk))
    const blockers = [
      ...(proposal ? [] : ["proposal was not found"]),
      ...(proposal && source.source !== "executor_review_proposal_create" ? ["proposal was not created by executor-review proposal creation gate"] : []),
      ...(proposal && (!optionalString(source.review_id) || !optionalString(source.draft_id)) ? ["executor-review proposal source metadata is incomplete"] : []),
      ...(proposal && ["cancelled", "applied"].includes(proposal.status) ? [`proposal status ${proposal.status} cannot be apply-ready`] : []),
      ...(optionalString(payload.createId ?? payload.create_id ?? payload.create) && createRecord?.proposal_id !== proposal?.proposal_id ? ["create_id does not match the proposal source create record"] : []),
      ...(optionalString(payload.reviewRequestId ?? payload.review_request_id ?? payload.reviewId ?? payload.review_id ?? payload.review) && reviewId !== (review?.review_id ?? proposal?.review_id) ? ["review_request_id does not match linked proposal review"] : []),
      ...(optionalString(payload.decisionGateId ?? payload.decision_gate_id ?? payload.decision) && decisionRecord?.proposal_id !== proposal?.proposal_id ? ["decision_gate_id does not match linked proposal review decision"] : []),
      ...(proposal?.review_id && !review ? ["linked review request was not found"] : []),
      ...(requestRecord && requestRecord.proposal_id !== proposal?.proposal_id ? ["review-request gate linkage is inconsistent"] : []),
      ...(decisionRecord?.proposal_id && decisionRecord.proposal_id !== proposal?.proposal_id ? ["review-decision gate linkage is inconsistent"] : []),
      ...(proposal && stringList(source.evidence_ids).length === 0 && stringList(source.finding_ids).length === 0 ? ["executor-review proposal source evidence metadata is incomplete"] : []),
      ...(candidateKind === "unsupported" ? ["proposal candidate kind is unsupported for future apply"] : []),
    ]
    let status = "needs_review"
    if (blockers.length > 0) status = "blocked"
    else if (review?.status === "rejected" || proposal?.status === "rejected" || decisionRecord?.status === "rejected") status = "rejected"
    else if (!requestRecord || !review || review.status === "pending" || !decisionRecord) status = "needs_review"
    else if (review.status === "approved" && decisionRecord.status === "approved" && proposal?.status === "approved") status = "ready"
    const readinessId = `fake-apply-readiness-${proposalId}-${decisionRecord?.decision_gate_id ?? "pending"}`
    return {
      readiness_id: readinessId,
      status,
      can_apply_in_future: status === "ready",
      proposal_id: proposalId,
      review_request_id: review?.review_id ?? requestRecord?.review_request_id ?? proposal?.review_id,
      request_gate_id: requestRecord?.request_gate_id,
      decision_gate_id: decisionRecord?.decision_gate_id,
      create_id: createRecord?.create_id,
      source_executor_review_id: optionalString(source.review_id) ?? createRecord?.review_id,
      source_draft_id: optionalString(source.draft_id) ?? createRecord?.draft_id,
      source_packet_id: optionalString(source.source_packet_id),
      proposal_status: proposal?.status,
      review_request_status: review?.status,
      review_decision: decisionRecord?.decision,
      proposal_title_preview: proposal?.title ?? "",
      proposal_summary_preview: proposal?.summary ?? "",
      action_kind: proposal?.action_kind,
      candidate_kind: candidateKind,
      candidate_risk: candidateRisk,
      mission_id: proposal?.mission_id ?? optionalString(source.target_mission_id),
      result_id: proposal?.result_id ?? optionalString(source.target_result_id),
      source_evidence_ids: stringList(source.evidence_ids),
      source_finding_ids: stringList(source.finding_ids),
      source_confidence: typeof source.source_confidence === "number" ? source.source_confidence : undefined,
      blockers: blockers.map(redactText),
      warnings: ["apply readiness does not apply proposals, mutate missions, call providers, launch OpenCode, or execute scheduler/wake/continuation/recovery writes"],
      recommended_commands: [
        { label: "Show proposal", command: `/proposal ${proposalId}`, command_type: "read" },
        { label: "List readiness", command: "/executor-review-proposal-apply-readiness-list", command_type: "read" },
        { label: "Show authority", command: "/authority-show /executor-review-proposal-apply-readiness", command_type: "read" },
      ],
      generated_at: new Date(0).toISOString(),
      redacted_summary_preview: status === "ready" ? `Proposal ${proposalId} is ready for future apply inspection.` : blockers[0] ?? fakeApplyReadinessStatusSummary(status),
    }
  }

  private fakeApplyReadinessNoTarget(): ExecutorReviewProposalApplyReadinessPreviewSummary {
    return {
      readiness_id: "fake-apply-readiness-no-target",
      status: "unknown",
      can_apply_in_future: false,
      proposal_id: "unknown",
      proposal_title_preview: "",
      proposal_summary_preview: "",
      candidate_kind: "generic",
      candidate_risk: "medium",
      source_evidence_ids: [],
      source_finding_ids: [],
      blockers: ["apply readiness preview requires proposal, review, decision, or create target"],
      warnings: ["apply readiness does not select an implicit latest future apply target"],
      recommended_commands: [
        { label: "List readiness", command: "/executor-review-proposal-apply-readiness-list", command_type: "read" },
        { label: "Read summary", command: "/executor-review-proposal-apply-readiness-summary", command_type: "read" },
      ],
      generated_at: new Date(0).toISOString(),
      redacted_summary_preview: "Apply readiness preview requires an explicit target.",
    }
  }

  private executorReviewProposalApplyReadinessSummary(payload: Record<string, unknown>): ExecutorReviewProposalApplyReadinessSummary {
    const records = this.listExecutorReviewProposalApplyReadiness({ limit: readLimit(payload.limit, 20) })
    return {
      total_considered: records.length,
      ready_count: records.filter((item) => item.status === "ready").length,
      blocked_count: records.filter((item) => item.status === "blocked").length,
      needs_review_count: records.filter((item) => item.status === "needs_review").length,
      rejected_count: records.filter((item) => item.status === "rejected").length,
      generic_count: records.filter((item) => item.candidate_kind === "generic" || item.candidate_kind === "manual_action").length,
      high_risk_count: records.filter((item) => item.candidate_risk === "high").length,
      generated_at: new Date(0).toISOString(),
    }
  }

  private listExecutorReviewProposalApplyReadiness(payload: Record<string, unknown>): ExecutorReviewProposalApplyReadinessRecordSummary[] {
    return this.proposals
      .filter((proposal) => isRecord(proposal.action_payload) && proposal.action_payload.source === "executor_review_proposal_create")
      .map((proposal) => recordFromExecutorReviewProposalApplyReadiness(this.previewExecutorReviewProposalApplyReadiness({ proposalId: proposal.proposal_id })))
      .filter((record) => !payload.status || record.status === payload.status)
      .filter((record) => !payload.candidateKind && !payload.candidate_kind || record.candidate_kind === (payload.candidateKind ?? payload.candidate_kind))
      .filter((record) => !payload.proposalId && !payload.proposal_id || record.proposal_id === (payload.proposalId ?? payload.proposal_id))
      .slice(0, readLimit(payload.limit, 20))
  }

  private proposalIdForFakeReview(reviewRequestId?: string): string | undefined {
    if (!reviewRequestId) return undefined
    return this.executorReviewProposalReviewRequests.find((item) => item.review_request_id === reviewRequestId)?.proposal_id
      ?? this.proposals.find((item) => item.review_id === reviewRequestId)?.proposal_id
  }

  private proposalIdForFakeDecision(decisionGateId?: string): string | undefined {
    if (!decisionGateId) return undefined
    return this.executorReviewProposalReviewDecisions.find((item) => item.decision_gate_id === decisionGateId)?.proposal_id
  }

  private proposalIdForFakeCreate(createId?: string): string | undefined {
    if (!createId) return undefined
    return this.executorReviewProposalCreates.find((item) => item.create_id === createId)?.proposal_id
  }

  private getOpenCodeHandoffFollowup(handoffId: string): OpenCodeHandoffFollowupSummary | null {
    const id = requiredString(handoffId, "handoffId")
    return this.buildOpenCodeHandoffFollowups().find((item) => item.handoff_id === id) ?? null
  }

  private listOpenCodeHandoffFollowups(limit: number): OpenCodeHandoffFollowupSummary[] {
    return this.buildOpenCodeHandoffFollowups().slice(0, limit)
  }

  private opencodeHandoffFollowupSummary(): OpenCodeHandoffFollowupCounts {
    const items = this.buildOpenCodeHandoffFollowups()
    return {
      sent_count: items.filter((item) => item.followup_status === "sent").length,
      running_count: items.filter((item) => item.followup_status === "claimed" || item.followup_status === "running").length,
      result_submitted_count: items.filter((item) => item.followup_status === "result_submitted").length,
      completed_count: items.filter((item) => item.followup_status === "completed").length,
      failed_count: items.filter((item) => item.followup_status === "failed" || item.followup_status === "cancelled" || item.followup_status === "handoff_failed").length,
      blocked_count: items.filter((item) => item.followup_status === "blocked" || item.followup_status === "unknown").length,
      stale_count: items.filter((item) => item.followup_status === "sent").length,
      last_handoff_id: items[0]?.handoff_id,
    }
  }

  private opencodeHandoffFollowupQueue(queue: OpenCodeHandoffFollowupQueueKind, limit: number): { queue: OpenCodeHandoffFollowupQueueKind; items: OpenCodeHandoffFollowupSummary[]; total_considered: number; limit: number } {
    const all = this.buildOpenCodeHandoffFollowups()
    const items = all.filter((item) => {
      if (queue === "active") return item.followup_status === "sent" || item.followup_status === "claimed" || item.followup_status === "running"
      if (queue === "needs_result_review") return item.followup_status === "result_submitted"
      if (queue === "completed") return item.followup_status === "completed"
      if (queue === "failed") return item.followup_status === "failed" || item.followup_status === "cancelled" || item.followup_status === "handoff_failed"
      if (queue === "stale") return item.followup_status === "sent"
      return item.followup_status === "blocked" || item.followup_status === "unknown"
    }).slice(0, limit)
    return { queue, items, total_considered: all.length, limit }
  }

  private buildOpenCodeHandoffFollowups(): OpenCodeHandoffFollowupSummary[] {
    if (this.opencodeHandoffs.length === 0) {
      this.ensureFakeHandoffProposal()
      this.executeOpenCodeHandoff({ proposalId: "fake-handoff-proposal", requestedBy: "fake" })
    }
    return this.opencodeHandoffs.map((handoff) => {
      const mission = handoff.mission_id ? this.missions.find((item) => item.mission_id === handoff.mission_id) : undefined
      const claims = handoff.mission_id ? this.claims.filter((item) => item.mission_id === handoff.mission_id) : []
      const progress = handoff.mission_id ? this.progress.filter((item) => item.mission_id === handoff.mission_id) : []
      const results = handoff.mission_id ? this.results.filter((item) => item.mission_id === handoff.mission_id) : []
      const activeClaim = claims.find((item) => item.status === "active")
      const latestProgress = progress[0]
      const latestResult = results[0]
      const proposal = this.proposals.find((item) => item.proposal_id === handoff.proposal_id)
      const review = handoff.review_id ? this.reviews.find((item) => item.review_id === handoff.review_id) : undefined
      const blockers: string[] = []
      if (!mission && handoff.mission_id) blockers.push(`mission not found: ${handoff.mission_id}`)
      return {
        handoff_id: handoff.handoff_id,
        proposal_id: handoff.proposal_id,
        review_id: handoff.review_id,
        mission_id: handoff.mission_id,
        intent_id: handoff.intent_id,
        followup_status: fakeFollowupStatus(mission?.status, activeClaim?.claim_id, progress.length, results.length, blockers),
        handoff_sent: handoff.sent,
        proposal_status: proposal?.status,
        review_status: review?.status,
        mission_status: mission?.status,
        active_claim_id: activeClaim?.claim_id,
        latest_progress_id: latestProgress?.progress_id,
        latest_result_id: latestResult?.result_id,
        result_count: results.length,
        progress_count: progress.length,
        blockers: blockers.map(redactText),
        suggested_commands: fakeFollowupCommands(handoff.handoff_id, handoff.mission_id, activeClaim?.claim_id, latestProgress?.progress_id, latestResult?.result_id),
        source_cycle_id: handoff.source_cycle_id,
        source_synthesis_id: handoff.source_synthesis_id,
        evidence_ids: handoff.evidence_ids,
        updated_at: latestResult?.created_at ?? latestProgress?.created_at ?? mission?.updated_at ?? handoff.created_at,
      }
    })
  }

  private previewRuntimeCheckpoint(payload: Record<string, unknown>): RuntimeCheckpointPreviewSummary {
    const scope = readCheckpointScope(optionalString(payload.scope) ?? "full")
    const reason = optionalString(payload.reason)
    const sections = this.fakeCheckpointSectionSummaries(scope)
    return {
      scope,
      reason: reason ? redactText(reason) : undefined,
      event_count: 12 + this.runtimeCheckpoints.length,
      last_event_id: this.runtimeCheckpoints[0]?.checkpoint_id ?? "fake-last-run",
      sections,
      estimated_bytes: sections.reduce((sum, section) => sum + section.bytes, 256),
      max_bytes: readNumber(payload.maxBytes ?? payload.max_bytes, 65536),
      blockers: [],
      redacted_summary_preview: `fake ${scope} checkpoint preview`,
    }
  }

  private createRuntimeCheckpoint(payload: Record<string, unknown>): RuntimeCheckpointSummary {
    const previewResult = this.previewRuntimeCheckpoint(payload)
    const checkpointNumber = this.runtimeCheckpoints.length + 1
    const checkpoint: RuntimeCheckpointSummary = {
      checkpoint_id: `fake-checkpoint-${checkpointNumber}`,
      scope: previewResult.scope,
      reason: previewResult.reason,
      created_at: new Date(0).toISOString(),
      created_by: redactText(String(payload.createdBy ?? payload.created_by ?? payload.requestedBy ?? payload.requested_by ?? "operator")),
      event_count: previewResult.event_count,
      last_event_id: previewResult.last_event_id,
      checkpoint_hash: `fake-checkpoint-hash-${checkpointNumber}`,
      sections: this.fakeCheckpointSections(previewResult.scope),
      section_summaries: previewResult.sections,
      restore_supported: false,
      warnings: [],
    }
    this.runtimeCheckpoints.unshift(checkpoint)
    return checkpoint
  }

  private getRuntimeCheckpoint(checkpointId: string): RuntimeCheckpointSummary | null {
    const id = requiredString(checkpointId, "checkpointId")
    return this.runtimeCheckpoints.find((item) => item.checkpoint_id === id) ?? null
  }

  private listRuntimeCheckpoints(limit: number): RuntimeCheckpointRecordSummary[] {
    return this.runtimeCheckpoints.slice(0, limit).map((checkpoint) => ({
      checkpoint_id: checkpoint.checkpoint_id,
      scope: checkpoint.scope,
      reason: checkpoint.reason,
      created_at: checkpoint.created_at,
      created_by: checkpoint.created_by,
      event_count: checkpoint.event_count,
      last_event_id: checkpoint.last_event_id,
      checkpoint_hash: checkpoint.checkpoint_hash,
      section_names: Object.keys(checkpoint.sections).sort(),
      summary_preview: `fake ${checkpoint.scope} checkpoint sections=${Object.keys(checkpoint.sections).length}`,
    }))
  }

  private previewCheckpointRestore(payload: Record<string, unknown>): RuntimeRestorePreviewSummary {
    const checkpointId = requiredString(String(payload.checkpointId ?? payload.checkpoint_id ?? ""), "checkpointId")
    const checkpoint = this.getRuntimeCheckpoint(checkpointId)
    const exists = checkpoint !== null
    const currentEvents = 12 + this.runtimeCheckpoints.length + this.runtimeResumeAnchors.length
    const drift = exists && checkpoint.event_count === currentEvents ? "none" : exists ? "advanced" : "unknown"
    const verification = {
      checkpoint_id: checkpointId,
      exists,
      hash_ok: exists,
      cursor_ok: exists,
      event_count_at_checkpoint: checkpoint?.event_count ?? 0,
      current_event_count: currentEvents,
      checkpoint_last_event_id: checkpoint?.last_event_id,
      current_last_event_id: this.runtimeResumeAnchors[0]?.resume_id ?? this.runtimeCheckpoints[0]?.checkpoint_id ?? "fake-last-run",
      new_event_count: checkpoint ? Math.max(0, currentEvents - checkpoint.event_count) : currentEvents,
      drift_status: drift,
      blockers: exists ? [] : ["runtime checkpoint not found"],
      warnings: exists ? ["checkpoint restore is preview-only; full restore is not implemented"] : [],
    }
    return {
      checkpoint_id: checkpointId,
      can_mark_resume: exists,
      verification,
      commander_context: {
        recent_cycle_ids: this.commanderCycles.slice(0, 5).map((cycle) => cycle.cycle_id),
        recent_synthesis_ids: this.researchSyntheses.slice(0, 5).map((synthesis) => synthesis.synthesis_id),
        proposal_ids: this.proposals.slice(0, 5).map((proposal) => proposal.proposal_id),
        review_ids: this.reviews.slice(0, 5).map((review) => review.review_id),
        bundle_ids: this.proposalBundles.slice(0, 5).map((bundle) => bundle.bundle_id),
        warnings: [],
      },
      executor_context: {
        mission_ids: this.missions.slice(0, 5).map((mission) => mission.mission_id),
        active_mission_ids: this.missions.filter((mission) => mission.status !== "completed" && mission.status !== "failed").slice(0, 5).map((mission) => mission.mission_id),
        active_claim_ids: this.claims.slice(0, 5).map((claim) => claim.claim_id),
        result_ids: this.results.slice(0, 5).map((result) => result.result_id),
        progress_ids: this.progress.slice(0, 5).map((item) => item.progress_id),
        warnings: [],
      },
      handoff_context: {
        handoff_ids: this.opencodeHandoffs.slice(0, 5).map((handoff) => handoff.handoff_id),
        active_handoff_ids: this.opencodeHandoffFollowupQueue("active", 5).items.map((item) => item.handoff_id),
        needs_result_review_ids: this.opencodeHandoffFollowupQueue("needs_result_review", 5).items.map((item) => item.handoff_id),
        failed_handoff_ids: this.opencodeHandoffFollowupQueue("failed", 5).items.map((item) => item.handoff_id),
        warnings: [],
      },
      reasoning_context: {
        provider_id: "fake-reasoning",
        provider_kind: "fake",
        health_status: "ok",
        warnings: [],
      },
      suggested_commands: [
        { label: "Show checkpoint", command: `/checkpoint-show ${checkpointId}`, command_type: "read" },
        { label: "Open handoff follow-ups", command: "/handoff-followups", command_type: "read" },
        { label: "List missions", command: "/missions", command_type: "read" },
        { label: "Open commander queues", command: "/queues", command_type: "read" },
        { label: "List cycles", command: "/cycles", command_type: "read" },
        { label: "List syntheses", command: "/syntheses", command_type: "read" },
        { label: "Reasoning status", command: "/reasoning", command_type: "read" },
        ...(exists ? [{ label: "Mark resume anchor", command: `/resume-mark ${checkpointId}`, command_type: "write" as const, requires_active_runtime: true }] : []),
      ],
      redacted_summary_preview: exists ? `fake resume preview checkpoint=${checkpointId} drift=${drift}` : `fake resume preview missing checkpoint=${checkpointId}`,
      created_at: new Date(0).toISOString(),
    }
  }

  private markCheckpointResumeAnchor(payload: Record<string, unknown>): RuntimeResumeAnchorSummary {
    const preview = this.previewCheckpointRestore(payload)
    if (!preview.can_mark_resume) throw new Error("runtime checkpoint cannot be marked for resume")
    const resumeNumber = this.runtimeResumeAnchors.length + 1
    const anchor: RuntimeResumeAnchorSummary = {
      resume_id: `fake-resume-${resumeNumber}`,
      checkpoint_id: preview.checkpoint_id,
      checkpoint_hash: this.getRuntimeCheckpoint(preview.checkpoint_id)?.checkpoint_hash ?? "",
      marked_at: new Date(0).toISOString(),
      marked_by: redactText(String(payload.markedBy ?? payload.marked_by ?? payload.requestedBy ?? payload.requested_by ?? "operator")),
      event_count_at_checkpoint: preview.verification.event_count_at_checkpoint,
      current_event_count: preview.verification.current_event_count,
      checkpoint_last_event_id: preview.verification.checkpoint_last_event_id,
      current_last_event_id: preview.verification.current_last_event_id,
      drift_status: preview.verification.drift_status,
      summary_preview: preview.redacted_summary_preview,
    }
    this.runtimeResumeAnchors.unshift(anchor)
    return anchor
  }

  private getCheckpointResumeAnchor(resumeId: string): RuntimeResumeAnchorSummary | null {
    const id = requiredString(resumeId, "resumeId")
    return this.runtimeResumeAnchors.find((anchor) => anchor.resume_id === id) ?? null
  }

  private previewWakeAssessment(payload: Record<string, unknown>): WakeAssessmentPreviewSummary {
    const resumeId = optionalString(payload.resumeId ?? payload.resume_id)
    const checkpointId = optionalString(payload.checkpointId ?? payload.checkpoint_id)
    if (resumeId && checkpointId) throw new Error("wake assessment accepts resume_id or checkpoint_id, not both")
    if (!resumeId && !checkpointId) throw new Error("resume_id or checkpoint_id is required")
    const anchor = resumeId ? this.getCheckpointResumeAnchor(resumeId) : null
    const resolvedCheckpointId = anchor?.checkpoint_id ?? checkpointId
    const restore = resolvedCheckpointId ? this.previewCheckpointRestore({ checkpointId: resolvedCheckpointId }) : null
    const blockers: string[] = []
    const warnings: string[] = []
    if (resumeId && !anchor) blockers.push("runtime resume anchor not found")
    if (!resumeId && checkpointId) warnings.push("wake preview is using an unanchored checkpoint; create requires resume_id")
    if (restore) {
      blockers.push(...restore.verification.blockers)
      warnings.push(...restore.verification.warnings)
      if (restore.verification.drift_status === "advanced") warnings.push("new events exist after checkpoint")
    }
    return {
      trigger_kind: "manual",
      resume_id: resumeId,
      checkpoint_id: resolvedCheckpointId,
      allowed: blockers.length === 0,
      blockers: [...new Set(blockers.map(redactText))],
      warnings: [...new Set(warnings.map(redactText))],
      drift_status: restore?.verification.drift_status,
      current_event_count: restore?.verification.current_event_count ?? 12,
      checkpoint_event_count: restore?.verification.event_count_at_checkpoint,
      new_event_count: restore?.verification.new_event_count,
      reasoning_health_status: "ok",
      handoff_summary: this.opencodeHandoffFollowupSummary(),
      commander_summary: this.commanderQueueSummary(24 * 60 * 60 * 1000),
      executor_summary: { mission_count: this.missions.length, active_mission_count: this.missions.filter((mission) => mission.status !== "completed" && mission.status !== "failed").length },
      suggested_commands: [
        ...(resumeId ? [{ label: "Show resume anchor", command: `/resume-anchor ${resumeId}`, command_type: "read" as const }] : []),
        ...(resolvedCheckpointId ? [{ label: "Preview restore", command: `/restore-preview ${resolvedCheckpointId}`, command_type: "read" as const }] : []),
        { label: "Open handoff follow-ups", command: "/handoff-followups", command_type: "read" },
        { label: "Open commander queues", command: "/queues", command_type: "read" },
        { label: "Reasoning status", command: "/reasoning", command_type: "read" },
        { label: "Create follow-up checkpoint", command: "/checkpoint full wake follow-up", command_type: "write", requires_active_runtime: true },
      ],
      redacted_summary_preview: `fake wake assessment checkpoint=${resolvedCheckpointId ?? "none"} allowed=${blockers.length === 0}`,
    }
  }

  private createWakeAssessment(payload: Record<string, unknown>): WakeAssessmentSummary {
    const resumeId = requiredString(String(payload.resumeId ?? payload.resume_id ?? ""), "resumeId")
    const previewResult = this.previewWakeAssessment({ resumeId })
    if (!previewResult.allowed) throw new Error(previewResult.blockers[0] ?? "wake assessment is blocked")
    const wakeNumber = this.wakeAssessments.length + 1
    const assessment: WakeAssessmentSummary = {
      wake_id: `fake-wake-${wakeNumber}`,
      trigger_kind: "manual",
      resume_id: resumeId,
      checkpoint_id: previewResult.checkpoint_id,
      checkpoint_hash: this.getCheckpointResumeAnchor(resumeId)?.checkpoint_hash,
      created_at: new Date(0).toISOString(),
      requested_by: redactText(String(payload.requestedBy ?? payload.requested_by ?? "operator")),
      allowed: previewResult.allowed,
      blockers: previewResult.blockers,
      warnings: previewResult.warnings,
      drift_status: previewResult.drift_status,
      current_event_count: previewResult.current_event_count,
      checkpoint_event_count: previewResult.checkpoint_event_count,
      new_event_count: previewResult.new_event_count,
      sections: {
        resume: { resume_id: resumeId, checkpoint_id: previewResult.checkpoint_id, warnings: [] },
        reasoning: { provider_id: "fake-reasoning", provider_kind: "fake", health_status: "ok", warnings: [] },
      },
      suggested_commands: previewResult.suggested_commands,
      assessment_hash: `fake-wake-hash-${wakeNumber}`,
    }
    this.wakeAssessments.unshift(assessment)
    return assessment
  }

  private getWakeAssessment(wakeId: string): WakeAssessmentSummary | null {
    const id = requiredString(wakeId, "wakeId")
    return this.wakeAssessments.find((wake) => wake.wake_id === id) ?? null
  }

  private listWakeAssessments(limit: number): WakeAssessmentRecordSummary[] {
    return this.wakeAssessments.slice(0, limit).map((wake) => ({
      wake_id: wake.wake_id,
      trigger_kind: wake.trigger_kind,
      resume_id: wake.resume_id,
      checkpoint_id: wake.checkpoint_id,
      allowed: wake.allowed,
      drift_status: wake.drift_status,
      created_at: wake.created_at,
      requested_by: wake.requested_by,
      summary_preview: `fake wake checkpoint=${wake.checkpoint_id ?? "none"} allowed=${wake.allowed}`,
      assessment_hash: wake.assessment_hash,
    }))
  }

  private previewWakeSchedule(payload: Record<string, unknown>): WakeSchedulePreviewSummary {
    const resumeId = requiredString(String(payload.resumeId ?? payload.resume_id ?? ""), "resumeId")
    const intervalMs = readNumber(payload.intervalMs ?? payload.interval_ms, 60_000)
    if (intervalMs < 60_000) throw new Error("interval_ms must be at least 60000")
    const anchor = this.getCheckpointResumeAnchor(resumeId)
    const blockers: string[] = []
    if (!anchor) blockers.push("runtime resume anchor not found")
    const nextDueAt = typeof (payload.nextDueAt ?? payload.next_due_at) === "string"
      ? redactText(String(payload.nextDueAt ?? payload.next_due_at))
      : new Date(intervalMs).toISOString()
    const policy = fakeWakeSchedulePolicy(payload.policy)
    return {
      resume_id: resumeId,
      checkpoint_id: anchor?.checkpoint_id,
      title: redactText(String(payload.title ?? "Manual wake schedule")),
      interval_ms: intervalMs,
      next_due_at: nextDueAt,
      policy,
      can_create: blockers.length === 0,
      blockers: blockers.map(redactText),
      warnings: [],
      redacted_summary_preview: `fake wake schedule resume=${resumeId} interval_ms=${intervalMs}`,
    }
  }

  private createWakeSchedule(payload: Record<string, unknown>): WakeScheduleSummary {
    const preview = this.previewWakeSchedule(payload)
    if (!preview.can_create) throw new Error(preview.blockers[0] ?? "wake schedule is blocked")
    const number = this.wakeSchedules.length + 1
    const schedule: WakeScheduleSummary = {
      schedule_id: `fake-wake-schedule-${number}`,
      resume_id: preview.resume_id,
      checkpoint_id: preview.checkpoint_id,
      status: "active",
      title: preview.title,
      interval_ms: preview.interval_ms,
      next_due_at: preview.next_due_at,
      created_at: new Date(0).toISOString(),
      created_by: redactText(String(payload.createdBy ?? payload.created_by ?? payload.requestedBy ?? payload.requested_by ?? "operator")),
      updated_at: new Date(0).toISOString(),
      policy: preview.policy,
      reason: typeof payload.reason === "string" ? redactText(payload.reason) : undefined,
      schedule_hash: `fake-wake-schedule-hash-${number}`,
      warnings: preview.warnings,
    }
    this.wakeSchedules.unshift(schedule)
    return schedule
  }

  private getWakeSchedule(scheduleId: string): WakeScheduleSummary | null {
    const id = requiredString(scheduleId, "scheduleId")
    return this.wakeSchedules.find((schedule) => schedule.schedule_id === id) ?? null
  }

  private listWakeSchedules(limit: number): WakeScheduleRecordSummary[] {
    return this.wakeSchedules.slice(0, limit).map((schedule) => wakeScheduleRecord(schedule))
  }

  private pauseWakeSchedule(payload: Record<string, unknown>): WakeScheduleSummary {
    return this.setWakeScheduleStatus(String(payload.scheduleId ?? payload.schedule_id ?? ""), "paused")
  }

  private resumeWakeSchedule(payload: Record<string, unknown>): WakeScheduleSummary {
    return this.setWakeScheduleStatus(String(payload.scheduleId ?? payload.schedule_id ?? ""), "active")
  }

  private cancelWakeSchedule(payload: Record<string, unknown>): WakeScheduleSummary {
    return this.setWakeScheduleStatus(String(payload.scheduleId ?? payload.schedule_id ?? ""), "cancelled")
  }

  private setWakeScheduleStatus(scheduleId: string, status: "active" | "paused" | "cancelled"): WakeScheduleSummary {
    const schedule = this.getWakeSchedule(scheduleId)
    if (!schedule) throw new Error("wake schedule not found")
    if (schedule.status === "cancelled") throw new Error("wake schedule is cancelled")
    schedule.status = status
    schedule.updated_at = new Date(0).toISOString()
    return schedule
  }

  private previewWakeScheduleTick(payload: Record<string, unknown>): WakeScheduleTickPreviewSummary {
    const now = typeof payload.now === "string" ? payload.now : new Date(0).toISOString()
    const maxItems = readLimit(payload.maxDueItems ?? payload.max_due_items, 5)
    const allItems = this.wakeSchedules.slice().sort((left, right) => left.next_due_at.localeCompare(right.next_due_at) || left.schedule_id.localeCompare(right.schedule_id)).map((schedule) => {
      const due = schedule.status === "active" && Date.parse(schedule.next_due_at) <= Date.parse(now)
      const blockers = schedule.status === "active" ? [] : [`wake schedule is ${schedule.status}`]
      return {
        schedule_id: schedule.schedule_id,
        resume_id: schedule.resume_id,
        checkpoint_id: schedule.checkpoint_id,
        due,
        status: schedule.status,
        next_due_at: schedule.next_due_at,
        last_tick_at: schedule.last_tick_at,
        blockers,
        warnings: [],
        would_create_wake: due && blockers.length === 0 && schedule.policy.create_wake_assessment,
        would_create_continuation_plan: due && blockers.length === 0 && schedule.policy.create_wake_assessment && schedule.policy.create_continuation_plan,
      }
    })
    const dueItems = allItems.filter((item) => item.due)
    const otherItems = allItems.filter((item) => !item.due)
    const orderedItems = [...dueItems, ...otherItems]
    const items = orderedItems.slice(0, maxItems)
    return {
      now,
      due_count: orderedItems.filter((item) => item.due).length,
      eligible_count: orderedItems.filter((item) => item.due && item.blockers.length === 0).length,
      blocked_count: orderedItems.filter((item) => item.due && item.blockers.length > 0).length,
      items,
      max_items: maxItems,
      blockers: [],
      warnings: [],
    }
  }

  private executeWakeScheduleTick(payload: Record<string, unknown>): WakeScheduleTickResultSummary {
    const dryRun = payload.dryRun === true || payload.dry_run === true
    const preview = this.previewWakeScheduleTick(payload)
    const wakeIds: string[] = []
    const planIds: string[] = []
    if (!dryRun) {
      for (const item of preview.items.filter((entry) => entry.due && entry.blockers.length === 0)) {
        const schedule = this.getWakeSchedule(item.schedule_id)
        if (!schedule) continue
        let wakeId: string | undefined
        if (schedule.policy.create_wake_assessment) {
          const wake = this.createWakeAssessment({ resumeId: schedule.resume_id, requestedBy: payload.requestedBy ?? payload.requested_by ?? "operator" })
          wakeId = wake.wake_id
          wakeIds.push(wake.wake_id)
        }
        if (wakeId && schedule.policy.create_continuation_plan) {
          const plan = this.createContinuationPlan({ wakeId, requestedBy: payload.requestedBy ?? payload.requested_by ?? "operator" })
          planIds.push(plan.plan_id)
          schedule.last_plan_id = plan.plan_id
        }
        schedule.last_tick_at = preview.now
        schedule.last_wake_id = wakeId
        schedule.next_due_at = new Date(Date.parse(preview.now) + schedule.interval_ms).toISOString()
      }
    }
    const tick: WakeScheduleTickResultSummary = {
      tick_id: `fake-wake-tick-${this.wakeScheduleTicks.length + 1}`,
      now: preview.now,
      processed_count: preview.items.filter((entry) => entry.due && entry.blockers.length === 0).length,
      wake_ids: dryRun ? [] : wakeIds,
      plan_ids: dryRun ? [] : planIds,
      skipped: preview.items.filter((entry) => entry.blockers.length > 0),
      created_at: new Date(0).toISOString(),
      requested_by: redactText(String(payload.requestedBy ?? payload.requested_by ?? "operator")),
      dry_run: dryRun,
    }
    if (!dryRun) this.wakeScheduleTicks.unshift(tick)
    return tick
  }

  private getWakeScheduleTick(tickId: string): WakeScheduleTickResultSummary | null {
    const id = requiredString(tickId, "tickId")
    return this.wakeScheduleTicks.find((tick) => tick.tick_id === id) ?? null
  }

  private listWakeScheduleTicks(limit: number): WakeScheduleTickResultSummary[] {
    return this.wakeScheduleTicks.slice(0, limit)
  }

  private previewWakeSchedulerStart(payload: Record<string, unknown>): WakeSchedulerPreviewSummary {
    const intervalMs = readNumber(payload.intervalMs ?? payload.interval_ms, 60_000)
    if (intervalMs < 60_000) throw new Error("interval_ms must be at least 60000")
    const maxDueItems = readLimit(payload.maxDueItems ?? payload.max_due_items, 5)
    const dryRun = payload.dryRun === true || payload.dry_run === true
    const blockers = this.wakeSchedulerStatusRecord.status === "running" ? ["wake scheduler is already running"] : []
    return {
      can_start: blockers.length === 0,
      status: this.wakeSchedulerStatusRecord.status,
      config: {
        enabled: true,
        interval_ms: intervalMs,
        max_due_items: maxDueItems,
        dry_run: dryRun,
        heartbeat_interval_ms: intervalMs,
        stop_on_error: payload.stopOnError === true || payload.stop_on_error === true,
        started_by: "operator",
      },
      blockers,
      warnings: [],
      due_preview: this.previewWakeScheduleTick({ maxDueItems: maxDueItems, dryRun: true }),
      redacted_summary_preview: `fake wake scheduler interval_ms=${intervalMs} dry_run=${dryRun}`,
    }
  }

  private startWakeScheduler(payload: Record<string, unknown>): WakeSchedulerStateSummary {
    const preview = this.previewWakeSchedulerStart(payload)
    if (!preview.can_start) throw new Error(preview.blockers[0] ?? "wake scheduler cannot start")
    this.wakeSchedulerStatusRecord = {
      status: "running",
      config: preview.config,
      started_at: new Date(0).toISOString(),
      tick_count: 0,
      heartbeat_count: 0,
      next_tick_at: new Date(preview.config.interval_ms).toISOString(),
      started_by: "operator",
    }
    this.recordWakeSchedulerEvent("runtime_wake_scheduler_started", "running", "fake wake scheduler started")
    return this.wakeSchedulerStatusRecord
  }

  private stopWakeScheduler(payload: Record<string, unknown>): WakeSchedulerStateSummary {
    if (this.wakeSchedulerStatusRecord.status === "stopped") return this.wakeSchedulerStatusRecord
    this.wakeSchedulerStatusRecord = {
      ...this.wakeSchedulerStatusRecord,
      status: "stopped",
      stopped_at: new Date(0).toISOString(),
      stopped_by: redactText(String(payload.requestedBy ?? payload.requested_by ?? "operator")),
    }
    this.recordWakeSchedulerEvent("runtime_wake_scheduler_stopped", "stopped", typeof payload.reason === "string" ? payload.reason : "fake wake scheduler stopped")
    return this.wakeSchedulerStatusRecord
  }

  private wakeSchedulerStatus(): WakeSchedulerStateSummary {
    return this.wakeSchedulerStatusRecord
  }

  private wakeSchedulerBootstrapStatus(): WakeSchedulerBootstrapStatusSummary {
    return {
      ...this.wakeSchedulerBootstrapStatusRecord,
      scheduler_status: this.wakeSchedulerStatusRecord.status,
      can_bootstrap: this.wakeSchedulerBootstrapStatusRecord.autostart_enabled && this.wakeSchedulerStatusRecord.status === "stopped",
      blockers: this.wakeSchedulerBootstrapStatusRecord.autostart_enabled ? [] : ["wake scheduler autostart disabled"],
    }
  }

  private previewWakeSchedulerBootstrap(): WakeSchedulerBootstrapStatusSummary {
    return {
      ...this.wakeSchedulerBootstrapStatus(),
      due_preview: this.previewWakeScheduleTick({ maxDueItems: this.wakeSchedulerBootstrapStatusRecord.config.max_due_items, dryRun: true }),
      redacted_summary_preview: "fake wake scheduler bootstrap preview autostart=false",
    }
  }

  private previewWakeSchedulerRecovery(): WakeSchedulerRecoveryPreviewSummary {
    return {
      ...this.wakeSchedulerRecoveryPreviewRecord,
      scheduler_status: this.wakeSchedulerStatusRecord.status,
      due_schedule_count: this.previewWakeScheduleTick({ dryRun: true }).due_count,
      eligible_due_schedule_count: this.previewWakeScheduleTick({ dryRun: true }).eligible_count,
      blocked_due_schedule_count: this.previewWakeScheduleTick({ dryRun: true }).blocked_count,
    }
  }

  private listWakeSchedulerRecoveries(limit: number): WakeSchedulerRecoveryRecordSummary[] {
    return this.wakeSchedulerRecoveries.slice(0, limit).map((recovery) => ({
      recovery_id: recovery.recovery_id,
      status: recovery.status,
      stale_detected: recovery.stale_detected,
      prior_started_at: recovery.prior_started_at,
      acknowledged_at: recovery.acknowledged_at,
      updated_at: recovery.updated_at,
      summary_preview: recovery.redacted_summary_preview,
      recovery_hash: recovery.recovery_hash,
    }))
  }

  private getWakeSchedulerRecovery(recoveryId: string): WakeSchedulerRecoverySummary | null {
    const id = requiredString(recoveryId, "recoveryId")
    const found = this.wakeSchedulerRecoveries.find((recovery) => recovery.recovery_id === id)
    if (found) return found
    const previewResult = this.previewWakeSchedulerRecovery()
    if (previewResult.recovery_id === id && previewResult.stale_detected) {
      return {
        ...previewResult,
        recovery_id: id,
        created_at: previewResult.prior_started_at ?? new Date(0).toISOString(),
        updated_at: previewResult.prior_started_at ?? new Date(0).toISOString(),
        recovery_hash: `fake-${id}`,
      }
    }
    return null
  }

  private acknowledgeWakeSchedulerRecovery(payload: Record<string, unknown>): WakeSchedulerRecoverySummary {
    const resolution = String(payload.resolution ?? "")
    if (resolution !== "acknowledged" && resolution !== "resolved" && resolution !== "dismissed") throw new Error("wake scheduler recovery resolution must be acknowledged, resolved, or dismissed")
    const previewResult = this.previewWakeSchedulerRecovery()
    const recoveryId = String(payload.recoveryId ?? payload.recovery_id ?? previewResult.recovery_id ?? "")
    if (!previewResult.stale_detected || !previewResult.recovery_id || recoveryId !== previewResult.recovery_id) throw new Error("wake scheduler recovery_id does not match current stale prior run")
    const now = new Date(0).toISOString()
    const recovery: WakeSchedulerRecoverySummary = {
      ...previewResult,
      recovery_id: previewResult.recovery_id,
      status: resolution,
      acknowledged_at: now,
      acknowledged_by: "operator",
      resolution_reason: typeof payload.reason === "string" ? redactText(payload.reason) : undefined,
      created_at: previewResult.prior_started_at ?? now,
      updated_at: now,
      recovery_hash: `fake-${previewResult.recovery_id}`,
    }
    this.wakeSchedulerRecoveries.unshift(recovery)
    this.wakeSchedulerRecoveryPreviewRecord = {
      ...previewResult,
      status: resolution,
      recommended_commands: previewResult.recommended_commands.filter((command) => !command.command.startsWith("/scheduler-recovery-ack")),
    }
    return recovery
  }

  private previewWakeSchedulerRecoveryWorkflow(recoveryId: string): WakeSchedulerRecoveryWorkflowPreviewSummary {
    const recovery = recoveryId ? this.getWakeSchedulerRecovery(recoveryId) : this.previewWakeSchedulerRecovery()
    const steps = recovery && recovery.stale_detected
      ? recovery.recommended_commands.map((command, index): WakeSchedulerRecoveryWorkflowStepSummary => ({
        index,
        label: command.label,
        command: command.command,
        command_type: command.command_type,
        step_kind: command.command_type === "read" ? "read_command" : command.command.includes("dry-run") ? "dry_run_command" : command.command.startsWith("/scheduler-recovery-") ? "recovery_resolution" : "write_command",
        allowed_to_execute_here: false,
        requires_active_runtime: command.requires_active_runtime,
        verification_hint: "fake workflow does not execute commands",
        blockers: [],
      }))
      : []
    const previewResult: WakeSchedulerRecoveryWorkflowPreviewSummary = {
      recovery_id: recovery?.recovery_id ?? recoveryId,
      can_create: Boolean(recovery?.stale_detected && recovery.recovery_id),
      blockers: recovery?.stale_detected ? [] : ["no stale scheduler recovery is available for workflow creation"],
      warnings: recovery?.warnings ?? [],
      recovery_status: recovery?.status ?? "none",
      stale_detected: Boolean(recovery?.stale_detected),
      step_count: steps.length,
      read_step_count: steps.filter((step) => step.command_type === "read").length,
      write_step_count: steps.filter((step) => step.command_type === "write").length,
      dry_run_step_count: steps.filter((step) => step.step_kind === "dry_run_command").length,
      resolution_step_count: steps.filter((step) => step.step_kind === "recovery_resolution").length,
      steps,
      redacted_summary_preview: `fake workflow recovery=${recovery?.recovery_id ?? recoveryId} steps=${steps.length}`,
    }
    this.wakeSchedulerRecoveryWorkflowPreviewRecord = previewResult
    return previewResult
  }

  private createWakeSchedulerRecoveryWorkflow(recoveryId: string): WakeSchedulerRecoveryWorkflowSummary {
    const previewResult = this.previewWakeSchedulerRecoveryWorkflow(recoveryId)
    if (!previewResult.can_create) throw new Error("wake scheduler recovery workflow cannot be created")
    const workflowId = `fake-workflow-${previewResult.recovery_id}`
    const now = new Date(0).toISOString()
    const workflow: WakeSchedulerRecoveryWorkflowSummary = {
      workflow_id: workflowId,
      recovery_id: previewResult.recovery_id,
      recovery_hash: `fake-${previewResult.recovery_id}`,
      status: "active",
      created_at: now,
      created_by: "operator",
      updated_at: now,
      workflow_hash: `fake-${workflowId}`,
      steps: previewResult.steps.map((step) => ({ ...step, step_id: `fake-step-${step.index}`, status: "pending" })),
      completed_step_count: 0,
      skipped_step_count: 0,
      blocked_step_count: 0,
      warnings: previewResult.warnings,
      blockers: [],
    }
    this.wakeSchedulerRecoveryWorkflows.unshift(workflow)
    return workflow
  }

  private listWakeSchedulerRecoveryWorkflows(limit: number): WakeSchedulerRecoveryWorkflowRecordSummary[] {
    return this.wakeSchedulerRecoveryWorkflows.slice(0, limit).map((workflow) => ({
      workflow_id: workflow.workflow_id,
      recovery_id: workflow.recovery_id,
      status: workflow.status,
      created_at: workflow.created_at,
      updated_at: workflow.updated_at,
      step_count: workflow.steps.length,
      completed_step_count: workflow.completed_step_count,
      skipped_step_count: workflow.skipped_step_count,
      blocked_step_count: workflow.blocked_step_count,
      summary_preview: `fake workflow ${workflow.workflow_id}`,
      workflow_hash: workflow.workflow_hash,
    }))
  }

  private getWakeSchedulerRecoveryWorkflow(workflowId: string): WakeSchedulerRecoveryWorkflowSummary | null {
    const id = requiredString(workflowId, "workflowId")
    return this.wakeSchedulerRecoveryWorkflows.find((workflow) => workflow.workflow_id === id) ?? null
  }

  private recordWakeSchedulerRecoveryWorkflowStep(payload: Record<string, unknown>): WakeSchedulerRecoveryWorkflowSummary {
    const workflow = this.getWakeSchedulerRecoveryWorkflow(String(payload.workflowId ?? payload.workflow_id ?? ""))
    if (!workflow) throw new Error("wake scheduler recovery workflow not found")
    if (workflow.status === "cancelled" || workflow.status === "completed") throw new Error("terminal recovery workflow cannot record more steps")
    const index = Number(payload.index)
    if (!Number.isInteger(index) || index < 0) throw new Error("workflow step index must be a non-negative integer")
    const step = workflow.steps.find((item) => item.index === index)
    if (!step) throw new Error("wake scheduler recovery workflow step not found")
    const status = String(payload.status)
    if (status !== "manually_done" && status !== "skipped" && status !== "blocked") throw new Error("workflow step status must be manually_done, skipped, or blocked")
    step.status = status
    step.note = typeof payload.note === "string" ? redactText(payload.note) : undefined
    step.marked_at = new Date(0).toISOString()
    step.marked_by = "operator"
    workflow.completed_step_count = workflow.steps.filter((item) => item.status === "manually_done" || item.status === "verified").length
    workflow.skipped_step_count = workflow.steps.filter((item) => item.status === "skipped").length
    workflow.blocked_step_count = workflow.steps.filter((item) => item.status === "blocked").length
    workflow.status = workflow.blocked_step_count > 0 ? "blocked" : workflow.steps.every((item) => item.status !== "pending") ? "completed" : "active"
    workflow.updated_at = new Date(0).toISOString()
    return workflow
  }

  private cancelWakeSchedulerRecoveryWorkflow(payload: Record<string, unknown>): WakeSchedulerRecoveryWorkflowSummary {
    const workflow = this.getWakeSchedulerRecoveryWorkflow(String(payload.workflowId ?? payload.workflow_id ?? ""))
    if (!workflow) throw new Error("wake scheduler recovery workflow not found")
    workflow.status = "cancelled"
    workflow.updated_at = new Date(0).toISOString()
    if (typeof payload.reason === "string") workflow.blockers = [redactText(payload.reason)]
    return workflow
  }

  private verifyWakeSchedulerRecoveryWorkflow(workflowId: string): WakeSchedulerRecoveryWorkflowVerificationSummary {
    const workflow = this.getWakeSchedulerRecoveryWorkflow(workflowId)
    if (!workflow) throw new Error("wake scheduler recovery workflow not found")
    return {
      workflow_id: workflow.workflow_id,
      recovery_id: workflow.recovery_id,
      checked_at: new Date(0).toISOString(),
      observable_events: [],
      step_updates: [],
      warnings: ["fake workflow verification is read-only and does not execute commands"],
    }
  }

  private wakeSchedulerAuditSummary(): WakeSchedulerAuditSummarySummary {
    const timeline = this.wakeSchedulerAuditTimeline({ limit: 50 })
    const incidents = this.wakeSchedulerAuditIncidents({})
    return {
      event_count: timeline.length,
      checkpoint_count: timeline.filter((entry) => entry.source_kind === "checkpoint").length,
      resume_anchor_count: timeline.filter((entry) => entry.source_kind === "resume_anchor").length,
      wake_assessment_count: timeline.filter((entry) => entry.source_kind === "wake_assessment").length,
      continuation_plan_count: timeline.filter((entry) => entry.source_kind === "continuation_plan").length,
      continuation_step_count: timeline.filter((entry) => entry.source_kind === "continuation_step").length,
      schedule_count: timeline.filter((entry) => entry.source_kind === "wake_schedule").length,
      tick_count: timeline.filter((entry) => entry.source_kind === "wake_tick").length,
      scheduler_start_count: timeline.filter((entry) => entry.source_event_kind === "runtime_wake_scheduler_started").length,
      scheduler_stop_count: timeline.filter((entry) => entry.source_event_kind === "runtime_wake_scheduler_stopped").length,
      scheduler_failure_count: timeline.filter((entry) => entry.source_event_kind === "runtime_wake_scheduler_tick_failed").length,
      bootstrap_blocked_count: timeline.filter((entry) => entry.source_event_kind === "runtime_wake_scheduler_bootstrap_blocked").length,
      stale_recovery_count: timeline.filter((entry) => entry.source_event_kind === "runtime_wake_scheduler_stale_run_detected").length,
      recovery_workflow_count: timeline.filter((entry) => entry.source_kind === "scheduler_recovery_workflow").length,
      unresolved_incident_count: incidents.filter((incident) => incident.status === "open").length,
      last_event_at: timeline.at(0)?.created_at,
      latest_scheduler_status: this.wakeSchedulerStatusRecord.status,
      latest_bootstrap_status: this.wakeSchedulerBootstrapStatusRecord.can_bootstrap ? "ready" : "blocked",
      latest_recovery_status: this.wakeSchedulerRecoveryPreviewRecord.status,
    }
  }

  private wakeSchedulerAuditTimeline(payload: Record<string, unknown>): WakeSchedulerAuditTimelineEntrySummary[] {
    if (this.wakeSchedulerAuditTimelineRecords.length === 0) this.wakeSchedulerAuditTimelineRecords = fakeWakeSchedulerAuditTimeline(this.wakeSchedulerRecoveryPreviewRecord)
    const limit = readLimit(payload.limit, 20)
    const kind = typeof payload.kind === "string" ? payload.kind : undefined
    const severity = typeof payload.severity === "string" ? payload.severity : undefined
    const related = typeof payload.relatedId === "string" ? payload.relatedId : typeof payload.related_id === "string" ? payload.related_id : undefined
    return this.wakeSchedulerAuditTimelineRecords
      .filter((entry) => kind === undefined || entry.source_kind === kind)
      .filter((entry) => severity === undefined || entry.severity === severity)
      .filter((entry) => related === undefined || Object.values(entry.related_ids).some((values) => values.includes(related)))
      .slice(0, limit)
  }

  private wakeSchedulerAuditChain(relatedId: string, limit: number): WakeSchedulerAuditChainSummary {
    const id = requiredString(relatedId, "relatedId")
    const entries = this.wakeSchedulerAuditTimeline({ limit }).filter((entry) => Object.values(entry.related_ids).some((values) => values.includes(id)))
    return {
      chain_id: `fake-chain-${id}`,
      root_kind: entries[0]?.source_kind ?? "other",
      root_id: id,
      entries,
      related_ids: entries.reduce<Record<string, string[]>>((out, entry) => {
        for (const [key, values] of Object.entries(entry.related_ids)) out[key] = [...new Set([...(out[key] ?? []), ...values])].sort()
        return out
      }, {}),
      gaps: entries.some((entry) => entry.source_event_kind === "runtime_wake_scheduler_started") && !entries.some((entry) => entry.source_event_kind === "runtime_wake_scheduler_stopped")
        ? [{ severity: "warning", message: "scheduler start has no matching stop or runtime shutdown in this chain" }]
        : [],
      recommended_commands: [{ label: "Scheduler status", command: "/scheduler-status", command_type: "read" }],
    }
  }

  private wakeSchedulerAuditIncidents(payload: Record<string, unknown>): WakeSchedulerAuditIncidentSummary[] {
    const limit = readLimit(payload.limit, 20)
    const status = typeof payload.status === "string" ? payload.status : undefined
    const incidents = this.wakeSchedulerAuditTimeline({ limit: 50 })
      .filter((entry) => entry.severity === "warning" || entry.severity === "error")
      .map((entry) => ({
        incident_id: `fake-incident-${entry.audit_id}`,
        severity: entry.severity,
        status: "open",
        title: entry.title,
        summary: entry.summary,
        first_seen_at: entry.created_at,
        last_seen_at: entry.created_at,
        related_entries: [entry],
        recommended_commands: entry.recommended_commands,
      }))
    return incidents.filter((incident) => status === undefined || incident.status === status).slice(0, limit)
  }

  private wakeSchedulerNavigationBoard(payload: Record<string, unknown>): WakeSchedulerNavigationBoardSummary {
    const limit = readLimit(payload.limit, 20)
    const includeWrite = payload.includeWrite === false || payload.include_write === false ? false : true
    const command = typeof payload.command === "string" ? payload.command : undefined
    const relatedId = typeof payload.relatedId === "string" ? payload.relatedId : typeof payload.related_id === "string" ? payload.related_id : undefined
    const incidentId = typeof payload.incidentId === "string" ? payload.incidentId : typeof payload.incident_id === "string" ? payload.incident_id : undefined
    const auditId = typeof payload.auditId === "string" ? payload.auditId : typeof payload.audit_id === "string" ? payload.audit_id : undefined
    const cards: WakeSchedulerNavigationCardSummary[] = []
    const source = command ? { kind: "command" } : relatedId ? { kind: "related_id", related_id: redactText(relatedId) } : incidentId ? { kind: "incident", incident_id: redactText(incidentId) } : auditId ? { kind: "timeline", audit_id: redactText(auditId) } : { kind: "summary" }
    const commands: WakeSchedulerAuditCommandSummary[] = command
      ? [{ label: "Command preview", command, command_type: "read" }]
      : relatedId ? this.wakeSchedulerAuditChain(relatedId, limit).recommended_commands
        : incidentId ? this.wakeSchedulerAuditIncidents({ limit: 50 }).find((incident) => incident.incident_id === incidentId)?.recommended_commands ?? []
          : auditId ? this.wakeSchedulerAuditTimeline({ limit: 50 }).find((entry) => entry.audit_id === auditId)?.recommended_commands ?? []
            : [
              { label: "Scheduler audit", command: "/scheduler-audit", command_type: "read" },
              { label: "Scheduler status", command: "/scheduler-status", command_type: "read" },
              { label: "Wake tick preview", command: "/wake-tick-preview", command_type: "read" },
            ]
    let omitted = 0
    for (const item of commands) {
      const previewRecord = fakeWakeSchedulerNavigationCommandPreview(item.command)
      if (!includeWrite && previewRecord.command_type === "write") {
        omitted += 1
        continue
      }
      cards.push(fakeWakeSchedulerNavigationCard(item.label, previewRecord, cards.length + 1))
      if (cards.length >= limit) break
    }
    return {
      board_id: `fake-navigation-${source.kind}`,
      source,
      title: "Fake scheduler navigation",
      summary: "Suggested commands are display-only; run them manually outside navigation.",
      cards,
      related_ids: relatedId ? { related_id: [redactText(relatedId)] } : {},
      warnings: omitted > 0 ? [`${omitted} write/high-impact command cards omitted by include_write=false`] : [],
      blockers: command && cards.some((card) => !card.supported) ? cards.flatMap((card) => card.blockers).slice(0, 10) : [],
      generated_at: new Date(0).toISOString(),
    }
  }

  private wakeSchedulerNavigationWriteBoard(payload: Record<string, unknown>): WakeSchedulerNavigationWriteBoardSummary {
    const limit = readLimit(payload.limit, 20)
    const relatedId = typeof payload.relatedId === "string" ? payload.relatedId : typeof payload.related_id === "string" ? payload.related_id : undefined
    const incidentId = typeof payload.incidentId === "string" ? payload.incidentId : typeof payload.incident_id === "string" ? payload.incident_id : undefined
    const stagedId = typeof payload.stagedId === "string" ? payload.stagedId : typeof payload.staged_id === "string" ? payload.staged_id : undefined
    const includeHighImpact = payload.includeHighImpact === false || payload.include_high_impact === false ? false : true
    const source = relatedId ? { kind: "related_id", related_id: redactText(relatedId) } : incidentId ? { kind: "incident", incident_id: redactText(incidentId) } : stagedId ? { kind: "staged_read_group", staged_id: redactText(stagedId) } : { kind: "navigation_board" }
    const commands = stagedId
      ? [`/scheduler-nav-run ${stagedId}`]
      : relatedId || incidentId
        ? ["/wake-tick-dry-run", "/scheduler-start dry-run every=60s", "/wake-tick", "/proposal-review <proposalId>"]
        : ["/wake-tick-dry-run", "/checkpoint full manual-checkpoint", "/scheduler-start dry-run every=60s", "/wake-tick", "/proposal-review <proposalId>"]
    const previews = commands.map(fakeWakeSchedulerNavigationWritePreview).filter((previewRecord) => includeHighImpact || previewRecord.risk !== "high_impact_write").slice(0, limit)
    return {
      board_id: `fake-write-board-${source.kind}`,
      source,
      previews,
      omitted_read_count: 0,
      unsupported_count: previews.filter((previewRecord) => previewRecord.risk === "unsupported").length,
      high_impact_count: commands.map(fakeWakeSchedulerNavigationWritePreview).filter((previewRecord) => previewRecord.risk === "high_impact_write").length,
      blockers: [],
      warnings: ["write eligibility preview is read-only; no write command is staged or executed"],
      generated_at: new Date(0).toISOString(),
    }
  }

  private previewWakeSchedulerNavigationWriteStage(commandValue: string, allowMediumRisk: boolean): WakeSchedulerNavigationWriteStagePreviewSummary {
    const writePreview = fakeWakeSchedulerNavigationWritePreview(commandValue)
    const blockers = fakeWriteStageBlockers(writePreview, allowMediumRisk)
    const hash = fakeWriteStageHash(writePreview.command, writePreview.authority_gate, writePreview.risk)
    const existing = this.wakeSchedulerNavigationStagedWriteCommands.find((item) => item.stage_hash === hash)
    return {
      command: writePreview.command,
      eligibility: {
        can_stage: blockers.length === 0,
        command: writePreview.command,
        command_name: writePreview.command_name,
        risk: writePreview.risk,
        authority_gate: writePreview.authority_gate,
        status: writePreview.status,
        target_kind: writePreview.target_kind,
        target_id: writePreview.target_id,
        blockers,
        warnings: [...writePreview.warnings, "7U stages write intent only; it does not execute staged write commands"],
        prerequisites: writePreview.prerequisites,
        safer_read_commands: writePreview.safer_read_commands,
        future_stage_policy: writePreview.future_stage_policy,
        redacted_summary_preview: `${writePreview.risk} ${writePreview.authority_gate}: ${writePreview.command}`,
      },
      existing_staged_id: existing?.staged_write_id,
      blockers,
      warnings: existing ? ["matching write command is already staged"] : ["staged write commands are not executed by 7U"],
    }
  }

  private stageWakeSchedulerNavigationWriteCommand(commandValue: string, allowMediumRisk: boolean, stagedBy: string): WakeSchedulerNavigationStagedWriteCommandSummary {
    const stagePreview = this.previewWakeSchedulerNavigationWriteStage(commandValue, allowMediumRisk)
    if (!stagePreview.eligibility.can_stage) throw new Error(`scheduler navigation write command cannot be staged: ${stagePreview.blockers.join("; ")}`)
    const existing = stagePreview.existing_staged_id ? this.wakeSchedulerNavigationStagedWriteCommands.find((item) => item.staged_write_id === stagePreview.existing_staged_id) : undefined
    if (existing) return existing
    const hash = fakeWriteStageHash(stagePreview.command, stagePreview.eligibility.authority_gate, stagePreview.eligibility.risk)
    const staged: WakeSchedulerNavigationStagedWriteCommandSummary = {
      staged_write_id: `fake-navigation-write-staged-${hash.slice(0, 16)}`,
      command: stagePreview.command,
      command_name: stagePreview.eligibility.command_name,
      risk: stagePreview.eligibility.risk,
      authority_gate: stagePreview.eligibility.authority_gate,
      target_kind: stagePreview.eligibility.target_kind,
      target_id: stagePreview.eligibility.target_id,
      equivalent_runtime_command: fakeRuntimeCommandFor(stagePreview.eligibility.command_name),
      prerequisites: stagePreview.eligibility.prerequisites,
      safer_read_commands: stagePreview.eligibility.safer_read_commands,
      future_stage_policy: stagePreview.eligibility.future_stage_policy,
      source_preview_hash: hash,
      staged_at: new Date(0).toISOString(),
      staged_by: preview(redactText(stagedBy)),
      status: "staged",
      stage_hash: hash,
      summary_preview: `${stagePreview.eligibility.risk} ${stagePreview.eligibility.authority_gate}: ${stagePreview.command}`,
    }
    this.wakeSchedulerNavigationStagedWriteCommands.unshift(staged)
    return staged
  }

  private getWakeSchedulerNavigationStagedWriteCommand(stagedWriteId: string): WakeSchedulerNavigationStagedWriteCommandSummary | null {
    const normalizedId = redactText(requiredString(stagedWriteId, "stagedWriteId"))
    return this.wakeSchedulerNavigationStagedWriteCommands.find((item) => item.staged_write_id === normalizedId) ?? null
  }

  private listWakeSchedulerNavigationStagedWriteCommands(limit: number): WakeSchedulerNavigationStagedWriteCommandRecordSummary[] {
    return this.wakeSchedulerNavigationStagedWriteCommands.slice(0, limit).map(fakeNavigationStagedWriteRecord)
  }

  private removeWakeSchedulerNavigationStagedWriteCommand(stagedWriteId: string): WakeSchedulerNavigationStagedWriteCommandSummary | null {
    const normalizedId = redactText(requiredString(stagedWriteId, "stagedWriteId"))
    const index = this.wakeSchedulerNavigationStagedWriteCommands.findIndex((item) => item.staged_write_id === normalizedId)
    if (index < 0) return null
    return this.wakeSchedulerNavigationStagedWriteCommands.splice(index, 1)[0] ?? null
  }

  private clearWakeSchedulerNavigationStagedWriteCommands(): WakeSchedulerNavigationStagedWriteCommandRecordSummary[] {
    this.wakeSchedulerNavigationStagedWriteCommands.splice(0, this.wakeSchedulerNavigationStagedWriteCommands.length)
    return []
  }

  private previewWakeSchedulerNavigationWriteRun(stagedWriteId: string): WakeSchedulerNavigationWriteRunPreviewSummary {
    const normalizedId = redactText(requiredString(stagedWriteId, "stagedWriteId"))
    const staged = this.wakeSchedulerNavigationStagedWriteCommands.find((item) => item.staged_write_id === normalizedId)
    if (!staged) {
      return {
        staged_write_id: normalizedId,
        command: "",
        command_name: "",
        can_execute: false,
        risk: "unsupported",
        authority_gate: "unknown",
        target_kind: "unknown",
        execution_kind: "blocked",
        blockers: ["staged write command is not active"],
        warnings: ["fake write runs execute one low-risk staged write only after explicit request"],
        redacted_summary_preview: "staged write command is not active",
      }
    }

    const blockers: string[] = []
    if (staged.risk !== "low_risk_write") blockers.push("7V executes low-risk staged writes only")
    if (staged.command_name !== "/wake-tick-dry-run" && staged.command_name !== "/scheduler-nav-run") blockers.push("staged write command is not in the 7V executor whitelist")
    if (staged.command_name === "/scheduler-nav-run" && !staged.target_id) blockers.push("scheduler-nav-run staged read id is required")
    blockers.push(...fakeLowRiskWriteRunShapeBlockers(staged.command, staged.command_name))
    if (blockers.length === 0 && staged.command_name === "/scheduler-nav-run" && !this.wakeSchedulerNavigationStagedCommands.some((item) => item.staged_id === staged.target_id)) blockers.push("staged navigation command is not active")
    const executionKind = blockers.length > 0 ? "blocked" : staged.command_name === "/wake-tick-dry-run" ? "wake_tick_dry_run" : "staged_safe_read"

    return {
      staged_write_id: staged.staged_write_id,
      command: staged.command,
      command_name: staged.command_name,
      can_execute: blockers.length === 0,
      risk: staged.risk,
      authority_gate: staged.authority_gate,
      target_kind: staged.target_kind,
      target_id: staged.target_id,
      execution_kind: executionKind,
      blockers,
      warnings: ["fake write-run execution never calls /run-staged"],
      redacted_summary_preview: `${executionKind} can_execute=${blockers.length === 0}: ${staged.command}`,
    }
  }

  private executeWakeSchedulerNavigationWriteRun(stagedWriteId: string, dryRun: boolean, requestedBy: string): WakeSchedulerNavigationWriteRunResultSummary {
    const previewRecord = this.previewWakeSchedulerNavigationWriteRun(stagedWriteId)
    const completedAt = new Date(0).toISOString()
    if (dryRun) {
      return fakeNavigationWriteRunResult({
        previewRecord,
        runId: `fake-write-run-dry-run-${this.sequence + 1}`,
        status: previewRecord.can_execute ? "succeeded" : "blocked",
        resultKind: "fake_write_run_dry_run",
        resultSummary: previewRecord.can_execute ? `dry_run=true execution_kind=${previewRecord.execution_kind}` : undefined,
        error: previewRecord.can_execute ? undefined : previewRecord.blockers.join("; "),
        requestedBy,
        completedAt,
      })
    }

    let downstreamRunId: string | undefined
    let resultKind = "fake_write_run"
    let resultSummary: string | undefined
    let status: WakeSchedulerNavigationWriteRunResultSummary["status"] = previewRecord.can_execute ? "succeeded" : "blocked"
    let error: string | undefined = previewRecord.can_execute ? undefined : previewRecord.blockers.join("; ")

    if (previewRecord.can_execute && previewRecord.execution_kind === "wake_tick_dry_run") {
      resultKind = "wake_tick_dry_run"
      resultSummary = "dry_run=true processed=0 wake_ids=0 plan_ids=0 skipped=0"
    } else if (previewRecord.can_execute && previewRecord.execution_kind === "staged_safe_read") {
      const downstream = this.executeWakeSchedulerNavigationStagedRead(previewRecord.target_id ?? "", requestedBy)
      downstreamRunId = downstream.run_id
      resultKind = "staged_safe_read"
      resultSummary = downstream.result_summary ?? downstream.error ?? "staged safe-read completed"
      status = downstream.status === "succeeded" ? "succeeded" : downstream.status === "failed" ? "failed" : "blocked"
      error = downstream.status === "succeeded" ? undefined : downstream.error
    }

    const result = fakeNavigationWriteRunResult({
      previewRecord,
      runId: `fake-write-run-${++this.sequence}`,
      status,
      resultKind,
      resultSummary,
      downstreamRunId,
      error,
      requestedBy,
      completedAt,
    })
    this.wakeSchedulerNavigationWriteRuns.unshift(result)
    return result
  }

  private listWakeSchedulerNavigationWriteRuns(limit: number, stagedWriteId?: string): WakeSchedulerNavigationWriteRunRecordSummary[] {
    const normalizedId = stagedWriteId ? redactText(stagedWriteId) : undefined
    return this.wakeSchedulerNavigationWriteRuns
      .filter((run) => !normalizedId || run.staged_write_id === normalizedId)
      .slice(0, limit)
      .map(fakeNavigationWriteRunRecord)
  }

  private getWakeSchedulerNavigationWriteRun(runId: string): WakeSchedulerNavigationWriteRunResultSummary | null {
    const normalizedId = redactText(requiredString(runId, "runId"))
    return this.wakeSchedulerNavigationWriteRuns.find((run) => run.run_id === normalizedId) ?? null
  }

  private wakeSchedulerNavigationWriteRunHistory(payload: Record<string, unknown>): WakeSchedulerNavigationWriteRunHistorySummary {
    const stagedWriteId = typeof (payload.stagedWriteId ?? payload.staged_write_id) === "string" ? redactText(String(payload.stagedWriteId ?? payload.staged_write_id)) : undefined
    const command = typeof payload.command === "string" ? preview(redactText(payload.command)) : undefined
    const limit = readLimit(payload.limit, 20)
    const groups = this.fakeWriteRunGroups()
      .filter((group) => !stagedWriteId || group.staged_write_id === stagedWriteId)
      .filter((group) => !command || group.command === command)
      .slice(0, limit)
    return {
      staged_write_id: stagedWriteId,
      command,
      groups,
      total_runs: groups.reduce((sum, group) => sum + group.run_count, 0),
      total_groups: groups.length,
      changed_groups: groups.filter((group) => group.comparison_status === "changed").length,
      failed_groups: groups.filter((group) => group.failed_count > 0 || group.blocked_count > 0).length,
      stale_groups: 0,
      generated_at: new Date(0).toISOString(),
    }
  }

  private wakeSchedulerNavigationWriteRunCompare(payload: Record<string, unknown>): WakeSchedulerNavigationWriteRunPairComparisonSummary {
    const leftRunId = typeof (payload.leftRunId ?? payload.left_run_id) === "string" ? redactText(String(payload.leftRunId ?? payload.left_run_id)) : undefined
    const rightRunId = typeof (payload.rightRunId ?? payload.right_run_id) === "string" ? redactText(String(payload.rightRunId ?? payload.right_run_id)) : undefined
    let left: WakeSchedulerNavigationWriteRunResultSummary | undefined
    let right: WakeSchedulerNavigationWriteRunResultSummary | undefined
    if (leftRunId || rightRunId) {
      left = this.wakeSchedulerNavigationWriteRuns.find((run) => run.run_id === leftRunId)
      right = this.wakeSchedulerNavigationWriteRuns.find((run) => run.run_id === rightRunId)
    } else {
      const stagedWriteId = redactText(requiredString(String(payload.stagedWriteId ?? payload.staged_write_id ?? ""), "stagedWriteId"))
      const runs = this.wakeSchedulerNavigationWriteRuns.filter((run) => run.staged_write_id === stagedWriteId)
      if (runs.length === 1) return fakeWriteRunPairComparison(runs[0], runs[0], "first_run")
      left = runs[1]
      right = runs[0]
    }
    if (!left || !right) throw new Error("fake write-run comparison run id not found")
    return fakeWriteRunPairComparison(left, right, fakeWriteRunComparisonStatus(left, right))
  }

  private wakeSchedulerNavigationWriteRunStale(payload: Record<string, unknown>): WakeSchedulerNavigationWriteRunStaleItemSummary[] {
    const staleAfterMs = typeof (payload.staleAfterMs ?? payload.stale_after_ms) === "number" ? Number(payload.staleAfterMs ?? payload.stale_after_ms) : 3_600_000
    const limit = readLimit(payload.limit, 20)
    return this.wakeSchedulerNavigationStagedWriteCommands.slice(0, limit).map((staged) => {
      const latest = this.wakeSchedulerNavigationWriteRuns.find((run) => run.staged_write_id === staged.staged_write_id)
      return {
        staged_write_id: staged.staged_write_id,
        command: staged.command,
        command_name: staged.command_name,
        risk: staged.risk,
        authority_gate: staged.authority_gate,
        target_kind: staged.target_kind,
        target_id: staged.target_id,
        latest_run_id: latest?.run_id,
        latest_completed_at: latest?.completed_at,
        age_ms: latest ? 0 : undefined,
        stale_after_ms: staleAfterMs,
        stale: !latest,
        recommended_commands: fakeWriteRunCompareCommands(staged.staged_write_id, latest?.run_id),
      }
    })
  }

  private wakeSchedulerNavigationWriteRunGroup(payload: Record<string, unknown>): WakeSchedulerNavigationWriteRunGroupSummary | null {
    const stagedWriteId = redactText(requiredString(String(payload.stagedWriteId ?? payload.staged_write_id ?? ""), "stagedWriteId"))
    return this.fakeWriteRunGroups().find((group) => group.staged_write_id === stagedWriteId) ?? null
  }

  private previewWakeSchedulerNavigationWriteReadiness(stagedWriteIdValue: string): WakeSchedulerNavigationWriteReadinessPreviewSummary {
    const stagedWriteId = redactText(requiredString(stagedWriteIdValue, "stagedWriteId"))
    const staged = this.wakeSchedulerNavigationStagedWriteCommands.find((item) => item.staged_write_id === stagedWriteId)
    if (!staged) {
      return {
        staged_write_id: stagedWriteId,
        command: "",
        command_name: "",
        risk: "unsupported",
        authority_gate: "unknown",
        target_kind: "unknown",
        readiness_status: "blocked",
        can_approve: false,
        can_execute_now: false,
        blockers: ["staged write command is not active"],
        warnings: ["removed or cleared staged writes cannot be approved"],
        required_evidence: [],
        optional_evidence: [],
        recommended_commands: [{ label: "List staged writes", command: "/scheduler-nav-write-staged", command_type: "read" }],
        redacted_summary_preview: `missing staged write ${stagedWriteId}`,
      }
    }
    const blockers: string[] = []
    if (staged.risk !== "medium_risk_write") blockers.push("only medium-risk staged writes are approval-eligible in 7X")
    if (staged.command_name !== "/checkpoint") blockers.push("fake runtime requires additional evidence for this medium-risk command")
    const status = blockers.length === 0 ? "ready_for_approval" : staged.risk === "high_impact_write" ? "high_impact_blocked" : "blocked"
    const latestDecision = this.wakeSchedulerNavigationWriteApprovals.find((approval) => approval.staged_write_id === staged.staged_write_id)
    const existing = latestDecision?.status === "approved" ? latestDecision : undefined
    return {
      staged_write_id: staged.staged_write_id,
      command: staged.command,
      command_name: staged.command_name,
      risk: staged.risk,
      authority_gate: staged.authority_gate,
      target_kind: staged.target_kind,
      target_id: staged.target_id,
      readiness_status: status,
      can_approve: status === "ready_for_approval",
      can_execute_now: false,
      blockers,
      warnings: ["7X approval records future operator intent only; it does not execute staged writes"],
      required_evidence: [],
      optional_evidence: [{
        evidence_id: `fake-write-evidence-${staged.staged_write_id}`,
        kind: "manual_note",
        related_id: staged.staged_write_id,
        command: staged.command,
        status: "optional",
        completed_at: new Date(0).toISOString(),
        fresh: true,
        age_ms: 0,
        summary_preview: "fake operator state evidence is informational only",
        blockers: [],
        warnings: ["fake evidence does not execute the staged write"],
      }],
      existing_approval: existing ? fakeNavigationWriteApprovalRecord(existing) : undefined,
      recommended_commands: [
        { label: "List staged writes", command: "/scheduler-nav-write-staged", command_type: "read" },
        { label: "List approvals", command: "/scheduler-nav-write-approvals", command_type: "read" },
        { label: "Approve for future execution", command: `/scheduler-nav-write-approve ${staged.staged_write_id}`, command_type: "write", requires_active_runtime: true },
      ],
      redacted_summary_preview: `${status} ${staged.risk} ${staged.authority_gate}: ${staged.command}`,
    }
  }

  private approveWakeSchedulerNavigationStagedWrite(stagedWriteId: string, reason: string, requestedBy: string): WakeSchedulerNavigationWriteApprovalSummary {
    const readiness = this.previewWakeSchedulerNavigationWriteReadiness(stagedWriteId)
    if (!readiness.can_approve) throw new Error(`scheduler navigation write approval is not ready: ${readiness.blockers.join("; ")}`)
    const approval = fakeNavigationWriteApproval(readiness, "approved", reason, requestedBy)
    this.wakeSchedulerNavigationWriteApprovals.unshift(approval)
    return approval
  }

  private rejectWakeSchedulerNavigationStagedWrite(stagedWriteId: string, reason: string, requestedBy: string): WakeSchedulerNavigationWriteApprovalSummary {
    const readiness = this.previewWakeSchedulerNavigationWriteReadiness(stagedWriteId)
    if (!this.wakeSchedulerNavigationStagedWriteCommands.some((item) => item.staged_write_id === readiness.staged_write_id)) throw new Error("staged write command is not active")
    const approval = fakeNavigationWriteApproval(readiness, "rejected", reason, requestedBy)
    this.wakeSchedulerNavigationWriteApprovals.unshift(approval)
    return approval
  }

  private revokeWakeSchedulerNavigationWriteApproval(approvalIdValue: string, reason: string, requestedBy: string): WakeSchedulerNavigationWriteApprovalSummary | null {
    const approvalId = redactText(requiredString(approvalIdValue, "approvalId"))
    const approvalIndex = this.wakeSchedulerNavigationWriteApprovals.findIndex((item) => item.approval_id === approvalId)
    const approval = this.wakeSchedulerNavigationWriteApprovals[approvalIndex]
    if (!approval) return null
    const revoked = { ...approval, status: "revoked", revoked_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString(), requested_by: preview(redactText(requestedBy)), reason: preview(redactText(reason)) }
    this.wakeSchedulerNavigationWriteApprovals.splice(approvalIndex, 1, revoked)
    return revoked
  }

  private getWakeSchedulerNavigationWriteApproval(approvalIdValue: string): WakeSchedulerNavigationWriteApprovalSummary | null {
    const approvalId = redactText(requiredString(approvalIdValue, "approvalId"))
    return this.wakeSchedulerNavigationWriteApprovals.find((item) => item.approval_id === approvalId) ?? null
  }

  private listWakeSchedulerNavigationWriteApprovals(limit: number): WakeSchedulerNavigationWriteApprovalRecordSummary[] {
    return this.wakeSchedulerNavigationWriteApprovals.slice(0, limit).map(fakeNavigationWriteApprovalRecord)
  }

  private previewWakeSchedulerNavigationCheckpointWriteRun(stagedWriteId: string): WakeSchedulerNavigationCheckpointWriteRunPreviewSummary {
    const normalizedId = redactText(requiredString(stagedWriteId, "stagedWriteId"))
    const staged = this.wakeSchedulerNavigationStagedWriteCommands.find((item) => item.staged_write_id === normalizedId)
    if (!staged) {
      return {
        staged_write_id: normalizedId,
        command: "",
        command_name: "",
        can_execute: false,
        risk: "unsupported",
        authority_gate: "unknown",
        target_kind: "unknown",
        execution_kind: "blocked",
        blockers: ["staged write command is not active"],
        warnings: ["fake checkpoint write runs execute approved staged checkpoints only"],
        redacted_summary_preview: "staged write command is not active",
      }
    }
    const readiness = this.previewWakeSchedulerNavigationWriteReadiness(staged.staged_write_id)
    const parsed = fakeParseCheckpointCommand(staged.command)
    const blockers: string[] = []
    if (staged.command_name !== "/checkpoint") blockers.push("7Y executes staged /checkpoint writes only")
    if (staged.risk !== "medium_risk_write") blockers.push("7Y executes approved medium-risk checkpoint writes only")
    if (staged.authority_gate !== "checkpoint_runtime") blockers.push("staged write is not owned by checkpoint_runtime")
    blockers.push(...parsed.blockers)
    if (!readiness.existing_approval) blockers.push("active 7X approval is required for this exact staged checkpoint write")
    const executionKind = blockers.length === 0 ? "checkpoint_create" : "blocked"
    return {
      staged_write_id: staged.staged_write_id,
      approval_id: readiness.existing_approval?.approval_id,
      command: staged.command,
      command_name: staged.command_name,
      can_execute: blockers.length === 0,
      risk: staged.risk,
      authority_gate: staged.authority_gate,
      target_kind: staged.target_kind,
      target_id: staged.target_id,
      execution_kind: executionKind,
      checkpoint_scope: parsed.scope,
      checkpoint_reason_preview: parsed.reason,
      blockers,
      warnings: ["fake checkpoint write-run execution never calls /run-staged"],
      redacted_summary_preview: `${executionKind} can_execute=${blockers.length === 0}: ${staged.command}`,
    }
  }

  private executeWakeSchedulerNavigationCheckpointWriteRun(stagedWriteId: string, dryRun: boolean, requestedBy: string): WakeSchedulerNavigationCheckpointWriteRunResultSummary {
    const previewRecord = this.previewWakeSchedulerNavigationCheckpointWriteRun(stagedWriteId)
    const completedAt = new Date(0).toISOString()
    if (dryRun) {
      return fakeNavigationCheckpointWriteRunResult({
        previewRecord,
        runId: `fake-checkpoint-write-run-dry-run-${this.sequence + 1}`,
        status: previewRecord.can_execute ? "succeeded" : "blocked",
        resultKind: "fake_checkpoint_write_run_dry_run",
        resultSummary: previewRecord.can_execute ? `dry_run=true scope=${previewRecord.checkpoint_scope ?? "unknown"}` : undefined,
        error: previewRecord.can_execute ? undefined : previewRecord.blockers.join("; "),
        requestedBy,
        completedAt,
      })
    }

    let checkpoint: RuntimeCheckpointSummary | undefined
    let status: WakeSchedulerNavigationCheckpointWriteRunResultSummary["status"] = previewRecord.can_execute ? "succeeded" : "blocked"
    let error: string | undefined = previewRecord.can_execute ? undefined : previewRecord.blockers.join("; ")
    let resultSummary: string | undefined
    if (previewRecord.can_execute) {
      checkpoint = this.createRuntimeCheckpoint({ scope: previewRecord.checkpoint_scope ?? "full", reason: previewRecord.checkpoint_reason_preview, requestedBy })
      resultSummary = `created checkpoint ${checkpoint.checkpoint_id} scope=${checkpoint.scope} events=${checkpoint.event_count}`
    }
    const result = fakeNavigationCheckpointWriteRunResult({
      previewRecord,
      runId: `fake-checkpoint-write-run-${++this.sequence}`,
      status,
      checkpoint,
      resultKind: checkpoint ? "runtime_checkpoint" : undefined,
      resultSummary,
      error,
      requestedBy,
      completedAt,
    })
    this.wakeSchedulerNavigationCheckpointWriteRuns.unshift(result)
    return result
  }

  private listWakeSchedulerNavigationCheckpointWriteRuns(limit: number, stagedWriteId?: string): WakeSchedulerNavigationCheckpointWriteRunRecordSummary[] {
    const normalizedId = stagedWriteId ? redactText(stagedWriteId) : undefined
    return this.wakeSchedulerNavigationCheckpointWriteRuns
      .filter((run) => !normalizedId || run.staged_write_id === normalizedId)
      .slice(0, limit)
      .map(fakeNavigationCheckpointWriteRunRecord)
  }

  private getWakeSchedulerNavigationCheckpointWriteRun(runId: string): WakeSchedulerNavigationCheckpointWriteRunResultSummary | null {
    const normalizedId = redactText(requiredString(runId, "runId"))
    return this.wakeSchedulerNavigationCheckpointWriteRuns.find((run) => run.run_id === normalizedId) ?? null
  }

  private wakeSchedulerNavigationCheckpointWriteHistory(payload: Record<string, unknown>): WakeSchedulerNavigationCheckpointWriteHistorySummary {
    const stagedWriteId = typeof (payload.stagedWriteId ?? payload.staged_write_id) === "string" ? redactText(String(payload.stagedWriteId ?? payload.staged_write_id)) : undefined
    const approvalId = typeof (payload.approvalId ?? payload.approval_id) === "string" ? redactText(String(payload.approvalId ?? payload.approval_id)) : undefined
    const command = typeof payload.command === "string" ? preview(redactText(payload.command)) : undefined
    const limit = readLimit(payload.limit, 20)
    const groups = this.fakeCheckpointWriteGroups()
      .filter((group) => !stagedWriteId || group.staged_write_id === stagedWriteId)
      .filter((group) => !approvalId || group.approval_ids.includes(approvalId))
      .filter((group) => !command || group.command === command)
      .slice(0, limit)
    const usage = this.wakeSchedulerNavigationCheckpointApprovalUsage(payload)
    return {
      staged_write_id: stagedWriteId,
      approval_id: approvalId,
      command,
      groups,
      total_runs: groups.reduce((sum, group) => sum + group.run_count, 0),
      total_groups: groups.length,
      changed_groups: groups.filter((group) => group.comparison_status === "changed").length,
      failed_groups: groups.filter((group) => group.failed_count > 0 || group.blocked_count > 0).length,
      artifact_changed_groups: groups.filter((group) => group.checkpoint_artifact_changed).length,
      unused_approval_count: usage.unused_count,
      stale_approval_count: usage.stale_count,
      generated_at: new Date(0).toISOString(),
    }
  }

  private wakeSchedulerNavigationCheckpointWriteCompare(payload: Record<string, unknown>): WakeSchedulerNavigationCheckpointWritePairComparisonSummary {
    const leftRunId = typeof (payload.leftRunId ?? payload.left_run_id) === "string" ? redactText(String(payload.leftRunId ?? payload.left_run_id)) : undefined
    const rightRunId = typeof (payload.rightRunId ?? payload.right_run_id) === "string" ? redactText(String(payload.rightRunId ?? payload.right_run_id)) : undefined
    let left: WakeSchedulerNavigationCheckpointWriteRunResultSummary | undefined
    let right: WakeSchedulerNavigationCheckpointWriteRunResultSummary | undefined
    if (leftRunId || rightRunId) {
      left = this.wakeSchedulerNavigationCheckpointWriteRuns.find((run) => run.run_id === leftRunId)
      right = this.wakeSchedulerNavigationCheckpointWriteRuns.find((run) => run.run_id === rightRunId)
    } else {
      const stagedWriteId = redactText(requiredString(String(payload.stagedWriteId ?? payload.staged_write_id ?? ""), "stagedWriteId"))
      const runs = this.wakeSchedulerNavigationCheckpointWriteRuns.filter((run) => run.staged_write_id === stagedWriteId)
      if (runs.length === 1) return fakeCheckpointWritePairComparison(runs[0], runs[0], "first_run")
      left = runs[1]
      right = runs[0]
    }
    if (!left || !right) throw new Error("fake checkpoint write comparison run id not found")
    return fakeCheckpointWritePairComparison(left, right, fakeCheckpointWriteComparisonStatus(left, right))
  }

  private wakeSchedulerNavigationCheckpointWriteStale(payload: Record<string, unknown>): WakeSchedulerNavigationCheckpointWriteStaleItemSummary[] {
    const staleAfterMs = typeof (payload.staleAfterMs ?? payload.stale_after_ms) === "number" ? Number(payload.staleAfterMs ?? payload.stale_after_ms) : 86_400_000
    const limit = readLimit(payload.limit, 20)
    return this.wakeSchedulerNavigationStagedWriteCommands
      .filter((staged) => staged.command_name === "/checkpoint")
      .slice(0, limit)
      .map((staged) => {
        const latest = this.wakeSchedulerNavigationCheckpointWriteRuns.find((run) => run.staged_write_id === staged.staged_write_id)
        const approval = this.wakeSchedulerNavigationWriteApprovals.find((item) => item.staged_write_id === staged.staged_write_id && item.status === "approved")
        return {
          staged_write_id: staged.staged_write_id,
          approval_id: approval?.approval_id,
          command: staged.command,
          latest_run_id: latest?.run_id,
          latest_completed_at: latest?.completed_at,
          checkpoint_id: latest?.checkpoint_id,
          age_ms: latest ? 0 : undefined,
          stale_after_ms: staleAfterMs,
          stale: !latest,
          reason: latest ? "latest checkpoint write-run is fresh" : "approved staged checkpoint write has no terminal run",
          recommended_commands: fakeCheckpointWriteCompareCommands(staged.staged_write_id, latest?.run_id, approval?.approval_id),
        }
      })
  }

  private wakeSchedulerNavigationCheckpointWriteGroup(payload: Record<string, unknown>): WakeSchedulerNavigationCheckpointWriteGroupSummary | null {
    const stagedWriteId = redactText(requiredString(String(payload.stagedWriteId ?? payload.staged_write_id ?? ""), "stagedWriteId"))
    return this.fakeCheckpointWriteGroups().find((group) => group.staged_write_id === stagedWriteId) ?? null
  }

  private wakeSchedulerNavigationCheckpointApprovalUsage(payload: Record<string, unknown>): WakeSchedulerNavigationCheckpointApprovalUsageSummaryState {
    const approvalId = typeof (payload.approvalId ?? payload.approval_id) === "string" ? redactText(String(payload.approvalId ?? payload.approval_id)) : undefined
    const stagedWriteId = typeof (payload.stagedWriteId ?? payload.staged_write_id) === "string" ? redactText(String(payload.stagedWriteId ?? payload.staged_write_id)) : undefined
    const limit = readLimit(payload.limit, 20)
    const approvals = this.wakeSchedulerNavigationWriteApprovals
      .filter((approval) => approval.command_name === "/checkpoint")
      .filter((approval) => !approvalId || approval.approval_id === approvalId)
      .filter((approval) => !stagedWriteId || approval.staged_write_id === stagedWriteId)
      .slice(0, limit)
      .map((approval) => {
        const runs = this.wakeSchedulerNavigationCheckpointWriteRuns.filter((run) => run.approval_id === approval.approval_id)
        const latest = runs[0]
        return {
          approval_id: approval.approval_id,
          staged_write_id: approval.staged_write_id,
          command: approval.command,
          approval_status: approval.status,
          approved_at: approval.approved_at,
          expires_at: approval.expires_at,
          revoked_at: approval.revoked_at,
          used: runs.length > 0,
          run_ids: runs.map((run) => run.run_id),
          latest_run_id: latest?.run_id,
          latest_run_status: latest?.status,
          latest_run_at: latest?.completed_at,
          stale: runs.length === 0,
          expired_before_use: approval.status === "expired" && runs.length === 0,
          revoked_before_use: approval.status === "revoked" && runs.length === 0,
          warnings: runs.length === 0 ? ["checkpoint approval has not been used"] : [],
          recommended_commands: fakeCheckpointWriteCompareCommands(approval.staged_write_id, latest?.run_id, approval.approval_id),
        }
      })
    return {
      approvals,
      total_approvals: approvals.length,
      used_count: approvals.filter((item) => item.used).length,
      unused_count: approvals.filter((item) => !item.used).length,
      stale_count: approvals.filter((item) => item.stale).length,
      expired_unused_count: approvals.filter((item) => item.expired_before_use).length,
      revoked_unused_count: approvals.filter((item) => item.revoked_before_use).length,
      generated_at: new Date(0).toISOString(),
    }
  }

  private fakeCheckpointWriteGroups(): WakeSchedulerNavigationCheckpointWriteGroupSummary[] {
    const stagedWriteIds = [...new Set(this.wakeSchedulerNavigationCheckpointWriteRuns.map((run) => run.staged_write_id))]
    return stagedWriteIds.map((stagedWriteId) => {
      const runs = this.wakeSchedulerNavigationCheckpointWriteRuns.filter((run) => run.staged_write_id === stagedWriteId)
      return fakeCheckpointWriteGroup(stagedWriteId, runs)
    })
  }

  private fakeWriteRunGroups(): WakeSchedulerNavigationWriteRunGroupSummary[] {
    const stagedWriteIds = [...new Set(this.wakeSchedulerNavigationWriteRuns.map((run) => run.staged_write_id))]
    return stagedWriteIds.map((stagedWriteId) => {
      const runs = this.wakeSchedulerNavigationWriteRuns.filter((run) => run.staged_write_id === stagedWriteId)
      const latest = runs[0]
      const previous = runs[1]
      const comparisonStatus = previous ? fakeWriteRunComparisonStatus(previous, latest) : "first_run"
      return {
        group_id: `fake-write-run-group-${stagedWriteId}`,
        staged_write_id: stagedWriteId,
        command: latest.command,
        command_name: latest.command_name,
        execution_kind: latest.execution_kind,
        risk: latest.risk,
        authority_gate: latest.authority_gate,
        target_kind: latest.target_kind,
        target_id: latest.target_id,
        run_count: runs.length,
        succeeded_count: runs.filter((run) => run.status === "succeeded").length,
        failed_count: runs.filter((run) => run.status === "failed").length,
        blocked_count: runs.filter((run) => run.status === "blocked").length,
        latest_run_id: latest.run_id,
        latest_completed_at: latest.completed_at,
        latest_status: latest.status,
        latest_outcome_hash: fakeWriteRunOutcomeHash(latest),
        previous_run_id: previous?.run_id,
        previous_outcome_hash: previous ? fakeWriteRunOutcomeHash(previous) : undefined,
        downstream_run_ids: [...new Set(runs.map((run) => run.downstream_run_id).filter((id): id is string => Boolean(id)))],
        comparison_status: comparisonStatus,
        summary_preview: `${comparisonStatus} ${latest.execution_kind}: ${latest.result_summary ?? latest.error ?? latest.command}`,
        recommended_commands: fakeWriteRunCompareCommands(stagedWriteId, latest.run_id),
      }
    })
  }

  private wakeSchedulerNavigationTarget(targetKind: string, targetId: string): WakeSchedulerNavigationTargetSummary {
    const target_kind = fakeNavigationTargetKind(targetKind)
    const target_id = redactText(requiredString(targetId, "targetId"))
    const chain = this.wakeSchedulerAuditChain(target_id, 20)
    const commands: WakeSchedulerAuditCommandSummary[] = [
      { label: "Scheduler audit chain", command: `/scheduler-audit-chain ${target_id}`, command_type: "read" },
      target_kind === "scheduler_recovery" ? { label: "Recovery", command: `/scheduler-recovery-show ${target_id}`, command_type: "read" } : undefined,
      target_kind === "wake_schedule" ? { label: "Wake schedule", command: `/wake-schedule ${target_id}`, command_type: "read" } : undefined,
    ].filter((command): command is WakeSchedulerAuditCommandSummary => Boolean(command))
    return {
      target_kind,
      target_id,
      title: `${target_kind} ${target_id}`,
      related_commands: commands.map((command, index) => fakeWakeSchedulerNavigationCard(command.label, fakeWakeSchedulerNavigationCommandPreview(command.command), index + 1)),
      related_ids: chain.related_ids,
      audit_entries: chain.entries,
      warnings: chain.entries.length === 0 ? [`no fake audit entries found for ${target_kind}`] : [],
    }
  }

  private previewWakeSchedulerNavigationStage(commandValue: string): WakeSchedulerNavigationStagePreviewSummary {
    const previewRecord = fakeWakeSchedulerNavigationCommandPreview(commandValue)
    const blockers = fakeNavigationStageBlockers(previewRecord)
    const stageHash = fakeNavigationStageHash(previewRecord.command)
    const existing = this.wakeSchedulerNavigationStagedCommands.find((item) => item.stage_hash === stageHash)
    return {
      command: previewRecord.command,
      eligibility: {
        can_stage: blockers.length === 0,
        command: previewRecord.command,
        command_type: previewRecord.command_type,
        risk: previewRecord.risk,
        target_kind: previewRecord.target_kind,
        target_id: previewRecord.target_id,
        blockers,
        warnings: ["staging records command text only; it does not execute commands"],
        redacted_summary_preview: `${previewRecord.risk} ${previewRecord.target_kind}: ${previewRecord.command}`,
      },
      existing_staged_id: existing?.staged_id,
      blockers,
      warnings: existing ? ["matching safe-read command is already staged"] : ["navigation staged commands are not executed automatically"],
    }
  }

  private stageWakeSchedulerNavigationCommand(commandValue: string, stagedBy: string): WakeSchedulerNavigationStagedCommandSummary {
    const stagePreview = this.previewWakeSchedulerNavigationStage(commandValue)
    if (!stagePreview.eligibility.can_stage) throw new Error(`scheduler navigation command cannot be staged: ${stagePreview.blockers.join("; ")}`)
    const existing = stagePreview.existing_staged_id ? this.wakeSchedulerNavigationStagedCommands.find((item) => item.staged_id === stagePreview.existing_staged_id) : undefined
    if (existing) return existing
    const hash = fakeNavigationStageHash(stagePreview.command)
    const staged: WakeSchedulerNavigationStagedCommandSummary = {
      staged_id: `fake-navigation-staged-${hash.slice(0, 16)}`,
      command: stagePreview.command,
      command_type: stagePreview.eligibility.command_type,
      risk: stagePreview.eligibility.risk,
      target_kind: stagePreview.eligibility.target_kind,
      target_id: stagePreview.eligibility.target_id,
      label: (stagePreview.command.split(/\s+/)[0] ?? stagePreview.command).replace(/^\//, "").replaceAll("-", " "),
      notes: ["navigation-origin safe-read command; not executed automatically"],
      staged_at: new Date(0).toISOString(),
      staged_by: preview(redactText(stagedBy)),
      status: "staged",
      stage_hash: hash,
    }
    this.wakeSchedulerNavigationStagedCommands.unshift(staged)
    return staged
  }

  private listWakeSchedulerNavigationStagedCommands(limit: number): WakeSchedulerNavigationStagedCommandRecordSummary[] {
    return this.wakeSchedulerNavigationStagedCommands.slice(0, limit).map(fakeNavigationStagedRecord)
  }

  private removeWakeSchedulerNavigationStagedCommand(stagedId: string): WakeSchedulerNavigationStagedCommandSummary | null {
    const normalizedId = redactText(requiredString(stagedId, "stagedId"))
    const index = this.wakeSchedulerNavigationStagedCommands.findIndex((item) => item.staged_id === normalizedId)
    if (index < 0) return null
    return this.wakeSchedulerNavigationStagedCommands.splice(index, 1)[0] ?? null
  }

  private clearWakeSchedulerNavigationStagedCommands(): WakeSchedulerNavigationStagedCommandRecordSummary[] {
    this.wakeSchedulerNavigationStagedCommands.splice(0, this.wakeSchedulerNavigationStagedCommands.length)
    return []
  }

  private previewWakeSchedulerNavigationStagedRead(stagedId: string): WakeSchedulerNavigationStagedRunPreviewSummary {
    const normalizedId = redactText(requiredString(stagedId, "stagedId"))
    const staged = this.wakeSchedulerNavigationStagedCommands.find((item) => item.staged_id === normalizedId)
    if (!staged) {
      return {
        staged_id: normalizedId,
        command: "",
        can_execute: false,
        command_type: "read",
        risk: "unsupported",
        target_kind: "unknown",
        blockers: ["staged navigation command is not active"],
        warnings: ["fake staged reads execute one safe-read command only after explicit request"],
        redacted_summary_preview: "staged navigation command is not active",
      }
    }
    const command = fakeWakeSchedulerNavigationCommandPreview(staged.command)
    const blockers = fakeNavigationStageBlockers(command)
    return {
      staged_id: staged.staged_id,
      command: command.command,
      can_execute: blockers.length === 0 && command.risk === "safe_read" && command.command_type === "read" && command.supported,
      command_type: command.command_type,
      risk: command.risk,
      target_kind: command.target_kind,
      target_id: command.target_id,
      blockers,
      warnings: ["fake staged read execution never calls /run-staged"],
      redacted_summary_preview: `${command.risk} ${command.target_kind}: ${command.command}`,
    }
  }

  private executeWakeSchedulerNavigationStagedRead(stagedId: string, requestedBy: string): WakeSchedulerNavigationStagedRunResultSummary {
    const previewRecord = this.previewWakeSchedulerNavigationStagedRead(stagedId)
    const runId = `fake-staged-read-${this.wakeSchedulerNavigationStagedReadRuns.length + 1}`
    const completedAt = new Date(0).toISOString()
    const result: WakeSchedulerNavigationStagedRunResultSummary = {
      run_id: runId,
      staged_id: previewRecord.staged_id,
      command: previewRecord.command,
      target_kind: previewRecord.target_kind,
      target_id: previewRecord.target_id,
      status: previewRecord.can_execute ? "succeeded" : "blocked",
      result_summary: previewRecord.can_execute ? fakeStagedReadSummary(previewRecord.command) : undefined,
      result_kind: previewRecord.can_execute ? "fake_read_result" : undefined,
      error: previewRecord.can_execute ? undefined : previewRecord.blockers.join("; "),
      started_at: completedAt,
      completed_at: completedAt,
      requested_by: preview(redactText(requestedBy)),
      result_hash: fakeNavigationStageHash(`${previewRecord.staged_id}:${runId}:${previewRecord.command}`),
    }
    this.wakeSchedulerNavigationStagedReadRuns.unshift(result)
    return result
  }

  private listWakeSchedulerNavigationStagedReadRuns(limit: number, stagedId?: string): WakeSchedulerNavigationStagedRunRecordSummary[] {
    const normalizedId = stagedId ? redactText(stagedId) : undefined
    return this.wakeSchedulerNavigationStagedReadRuns
      .filter((run) => !normalizedId || run.staged_id === normalizedId)
      .slice(0, limit)
      .map(fakeStagedReadRunRecord)
  }

  private getWakeSchedulerNavigationStagedReadRun(runId: string): WakeSchedulerNavigationStagedRunResultSummary | null {
    const normalizedId = redactText(requiredString(runId, "runId"))
    return this.wakeSchedulerNavigationStagedReadRuns.find((run) => run.run_id === normalizedId) ?? null
  }

  private wakeSchedulerNavigationStagedReadHistory(payload: Record<string, unknown>): WakeSchedulerNavigationStagedReadHistorySummary {
    const stagedId = typeof (payload.stagedId ?? payload.staged_id) === "string" ? redactText(String(payload.stagedId ?? payload.staged_id)) : undefined
    const command = typeof payload.command === "string" ? preview(redactText(payload.command)) : undefined
    const limit = readLimit(payload.limit, 20)
    const groups = this.fakeStagedReadGroups()
      .filter((group) => !stagedId || group.staged_id === stagedId)
      .filter((group) => !command || group.command === command)
      .slice(0, limit)
    return {
      staged_id: stagedId,
      command,
      groups,
      total_runs: groups.reduce((sum, group) => sum + group.run_count, 0),
      total_groups: groups.length,
      changed_groups: groups.filter((group) => group.comparison_status === "changed").length,
      failed_groups: groups.filter((group) => group.comparison_status === "failed" || group.comparison_status === "blocked").length,
      stale_groups: 0,
      generated_at: new Date(0).toISOString(),
    }
  }

  private wakeSchedulerNavigationStagedReadCompare(payload: Record<string, unknown>): WakeSchedulerNavigationStagedReadPairComparisonSummary {
    const leftRunId = typeof (payload.leftRunId ?? payload.left_run_id) === "string" ? redactText(String(payload.leftRunId ?? payload.left_run_id)) : undefined
    const rightRunId = typeof (payload.rightRunId ?? payload.right_run_id) === "string" ? redactText(String(payload.rightRunId ?? payload.right_run_id)) : undefined
    let left: WakeSchedulerNavigationStagedRunResultSummary | undefined
    let right: WakeSchedulerNavigationStagedRunResultSummary | undefined
    if (leftRunId || rightRunId) {
      left = this.wakeSchedulerNavigationStagedReadRuns.find((run) => run.run_id === leftRunId)
      right = this.wakeSchedulerNavigationStagedReadRuns.find((run) => run.run_id === rightRunId)
    } else {
      const stagedId = redactText(requiredString(String(payload.stagedId ?? payload.staged_id ?? ""), "stagedId"))
      const runs = this.wakeSchedulerNavigationStagedReadRuns.filter((run) => run.staged_id === stagedId)
      if (runs.length === 1) return fakePairComparison(runs[0], runs[0], "first_run")
      left = runs[1]
      right = runs[0]
    }
    if (!left || !right) throw new Error("fake staged read comparison run id not found")
    return fakePairComparison(left, right, fakeComparisonStatus(left, right))
  }

  private wakeSchedulerNavigationStagedReadStale(payload: Record<string, unknown>): WakeSchedulerNavigationStagedReadStaleItemSummary[] {
    const staleAfterMs = typeof (payload.staleAfterMs ?? payload.stale_after_ms) === "number" ? Number(payload.staleAfterMs ?? payload.stale_after_ms) : 3_600_000
    const limit = readLimit(payload.limit, 20)
    return this.wakeSchedulerNavigationStagedCommands.slice(0, limit).map((staged) => {
      const latest = this.wakeSchedulerNavigationStagedReadRuns.find((run) => run.staged_id === staged.staged_id)
      return {
        staged_id: staged.staged_id,
        command: staged.command,
        target_kind: staged.target_kind,
        target_id: staged.target_id,
        latest_run_id: latest?.run_id,
        latest_completed_at: latest?.completed_at,
        age_ms: latest ? 0 : undefined,
        stale_after_ms: staleAfterMs,
        stale: !latest,
        recommended_commands: fakeCompareCommands(staged.staged_id, latest?.run_id),
      }
    })
  }

  private wakeSchedulerNavigationStagedReadGroup(payload: Record<string, unknown>): WakeSchedulerNavigationStagedReadGroupSummary | null {
    const stagedId = redactText(requiredString(String(payload.stagedId ?? payload.staged_id ?? ""), "stagedId"))
    return this.fakeStagedReadGroups().find((group) => group.staged_id === stagedId) ?? null
  }

  private fakeStagedReadGroups(): WakeSchedulerNavigationStagedReadGroupSummary[] {
    const stagedIds = [...new Set(this.wakeSchedulerNavigationStagedReadRuns.map((run) => run.staged_id))]
    return stagedIds.map((stagedId) => {
      const runs = this.wakeSchedulerNavigationStagedReadRuns.filter((run) => run.staged_id === stagedId)
      const latest = runs[0]
      const previous = runs[1]
      return {
        group_id: `fake-staged-read-group-${stagedId}`,
        staged_id: stagedId,
        command: latest.command,
        target_kind: latest.target_kind,
        target_id: latest.target_id,
        run_count: runs.length,
        succeeded_count: runs.filter((run) => run.status === "succeeded").length,
        failed_count: runs.filter((run) => run.status === "failed").length,
        blocked_count: runs.filter((run) => run.status === "blocked").length,
        latest_run_id: latest.run_id,
        latest_completed_at: latest.completed_at,
        latest_status: latest.status,
        latest_comparison_hash: fakeStableComparisonHash(latest),
        previous_run_id: previous?.run_id,
        previous_comparison_hash: previous ? fakeStableComparisonHash(previous) : undefined,
        comparison_status: previous ? fakeComparisonStatus(previous, latest) : "first_run",
        summary_preview: `${previous ? fakeComparisonStatus(previous, latest) : "first_run"} ${latest.target_kind}: ${latest.result_summary ?? latest.error ?? latest.command}`,
        recommended_commands: fakeCompareCommands(stagedId, latest.run_id),
      }
    })
  }

  private listWakeSchedulerEvents(limit: number): WakeSchedulerEventRecordSummary[] {
    return this.wakeSchedulerEvents.slice(0, limit)
  }

  private recordWakeSchedulerEvent(kind: string, status: string, message: string): void {
    this.wakeSchedulerEvents.unshift({
      event_id: `fake-wake-scheduler-event-${this.wakeSchedulerEvents.length + 1}`,
      kind,
      scheduler_status: status,
      message: redactText(message),
      created_at: new Date(0).toISOString(),
      requested_by: "operator",
    })
  }

  private previewContinuationPlan(payload: Record<string, unknown>): ContinuationPlanPreviewSummary {
    const wakeId = requiredString(String(payload.wakeId ?? payload.wake_id ?? ""), "wakeId")
    const wake = this.getWakeAssessment(wakeId)
    const blockers: string[] = []
    const warnings = wake?.warnings ?? []
    if (!wake) blockers.push("wake assessment not found")
    if (wake && !wake.allowed) blockers.push("wake assessment is not allowed")
    const steps = (wake?.suggested_commands ?? []).slice(0, 20).map((command, index) => {
      const isWrite = command.command_type === "write"
      const blockers = isWrite ? ["continuation write commands are blocked by default"] : []
      return {
        index,
        label: command.label,
        command: command.command,
        command_type: command.command_type,
        step_kind: isWrite && command.command.startsWith("/checkpoint ") ? "operator_checkpoint" : isWrite ? "write_command" : "read_command",
        requires_active_runtime: command.requires_active_runtime,
        requires_review: command.requires_review,
        allowed_by_default: !isWrite,
        blockers,
      }
    })
    if (wake && steps.length === 0) blockers.push("wake assessment has no continuation-compatible suggested commands")
    return {
      wake_id: wakeId,
      resume_id: wake?.resume_id,
      checkpoint_id: wake?.checkpoint_id,
      can_create: blockers.length === 0,
      blockers: blockers.map(redactText),
      warnings: warnings.map(redactText),
      step_count: steps.length,
      read_step_count: steps.filter((step) => step.command_type === "read").length,
      write_step_count: steps.filter((step) => step.command_type === "write").length,
      operator_checkpoint_count: steps.filter((step) => step.step_kind === "operator_checkpoint").length,
      redacted_summary_preview: `fake continuation wake=${wakeId} steps=${steps.length}`,
      steps,
    }
  }

  private createContinuationPlan(payload: Record<string, unknown>): ContinuationPlanSummary {
    const preview = this.previewContinuationPlan(payload)
    if (!preview.can_create) throw new Error(preview.blockers[0] ?? "continuation plan is blocked")
    const number = this.continuationPlans.length + 1
    const plan: ContinuationPlanSummary = {
      plan_id: `fake-continuation-${number}`,
      wake_id: preview.wake_id,
      resume_id: preview.resume_id,
      checkpoint_id: preview.checkpoint_id,
      status: "proposed",
      created_at: new Date(0).toISOString(),
      created_by: redactText(String(payload.createdBy ?? payload.created_by ?? payload.requestedBy ?? payload.requested_by ?? "operator")),
      updated_at: new Date(0).toISOString(),
      plan_hash: `fake-continuation-hash-${number}`,
      steps: preview.steps.map((step) => ({
        ...step,
        step_id: `fake-continuation-step-${number}-${step.index + 1}`,
        status: step.allowed_by_default ? "pending" : "blocked",
        created_from_suggestion: true,
      })),
      current_step_index: preview.steps.find((step) => step.allowed_by_default)?.index,
      completed_step_count: 0,
      failed_step_count: 0,
      blockers: preview.blockers,
      warnings: preview.warnings,
    }
    this.continuationPlans.unshift(plan)
    return plan
  }

  private getContinuationPlan(planId: string): ContinuationPlanSummary | null {
    const id = requiredString(planId, "planId")
    return this.continuationPlans.find((plan) => plan.plan_id === id) ?? null
  }

  private listContinuationPlans(limit: number): ContinuationPlanRecordSummary[] {
    return this.continuationPlans.slice(0, limit).map((plan) => continuationRecord(plan))
  }

  private executeContinuationStep(payload: Record<string, unknown>): ContinuationStepResultSummary {
    const plan = this.getContinuationPlan(String(payload.planId ?? payload.plan_id ?? ""))
    if (!plan) throw new Error("continuation plan not found")
    if (plan.status === "paused" || plan.status === "cancelled" || plan.status === "completed") throw new Error(`continuation plan is ${plan.status}`)
    const index = typeof payload.index === "number" ? payload.index : plan.steps.find((step) => step.status === "pending")?.index
    if (index === undefined) throw new Error("continuation plan has no pending step")
    const step = plan.steps.find((item) => item.index === index)
    if (!step) throw new Error("continuation step not found")
    if (step.status === "blocked") throw new Error(step.blockers[0] ?? "continuation step is blocked")
    if (step.command_type === "write") throw new Error("continuation write step execution is not supported in Branch 7I")
    const dryRun = payload.dryRun === true || payload.dry_run === true
    const now = new Date(0).toISOString()
    const result: ContinuationStepResultSummary = {
      plan_id: plan.plan_id,
      step_id: step.step_id,
      index: step.index,
      status: "succeeded",
      command: step.command,
      result_summary: dryRun ? `dry-run would execute ${step.command}` : `executed fake read step ${step.command}`,
      dry_run: dryRun || undefined,
      started_at: now,
      completed_at: now,
    }
    if (!dryRun) {
      step.status = "succeeded"
      step.started_at = now
      step.completed_at = now
      step.result_summary = result.result_summary
      plan.status = plan.steps.every((item) => item.status !== "pending" && item.status !== "running") ? "completed" : "active"
      plan.updated_at = now
      plan.completed_step_count = plan.steps.filter((item) => item.status === "succeeded").length
      plan.current_step_index = plan.steps.find((item) => item.status === "pending")?.index
    }
    return result
  }

  private pauseContinuationPlan(payload: Record<string, unknown>): ContinuationPlanSummary {
    const plan = this.getContinuationPlan(String(payload.planId ?? payload.plan_id ?? ""))
    if (!plan) throw new Error("continuation plan not found")
    plan.status = "paused"
    plan.updated_at = new Date(0).toISOString()
    return plan
  }

  private cancelContinuationPlan(payload: Record<string, unknown>): ContinuationPlanSummary {
    const plan = this.getContinuationPlan(String(payload.planId ?? payload.plan_id ?? ""))
    if (!plan) throw new Error("continuation plan not found")
    plan.status = "cancelled"
    plan.updated_at = new Date(0).toISOString()
    return plan
  }

  private fakeCheckpointSections(scope: RuntimeCheckpointScope): Record<string, unknown> {
    const all: Record<string, unknown> = {
      runtime: { mode: "active", started: true, run_lock_held: false, event_count: 12 + this.runtimeCheckpoints.length },
      spec: { status: existsSync(join(this.projectDir, ".nxl")) ? "approved" : "unknown" },
      reasoning: { status: this.reasoningProviderStatus(), health: this.reasoningProviderHealth() },
      research: { topic_count: this.researchTopics().length, recent_syntheses: this.listResearchSyntheses(5) },
      commander: { proposals: this.proposalSummary(), reviews: this.reviewSummary(), cycles: this.listCommanderCycles(5) },
      executor: { missions: this.missionSummary(), recent_missions: this.missions.slice(0, 5) },
      opencode: { adapter_status_available: false, adapter_status_reason: "fake checkpoint does not call adapter" },
      handoff: { recent_handoffs: this.listOpenCodeHandoffs(5), followup_summary: this.opencodeHandoffFollowupSummary() },
      suggested_commands: [
        { label: "List checkpoints", command: "/checkpoints", command_type: "read" },
        { label: "Preview checkpoint", command: `/checkpoint-preview ${scope}`, command_type: "read" },
      ],
    }
    const keys = scope === "commander"
      ? ["runtime", "spec", "reasoning", "research", "commander", "suggested_commands"]
      : scope === "executor"
        ? ["runtime", "executor", "opencode", "suggested_commands"]
        : scope === "research"
          ? ["runtime", "reasoning", "research", "commander", "suggested_commands"]
          : scope === "handoff"
            ? ["runtime", "executor", "opencode", "handoff", "suggested_commands"]
            : Object.keys(all)
    const out: Record<string, unknown> = {}
    for (const key of keys) out[key] = all[key]
    return redactUnknown(out) as Record<string, unknown>
  }

  private fakeCheckpointSectionSummaries(scope: RuntimeCheckpointScope): RuntimeCheckpointPreviewSummary["sections"] {
    return Object.entries(this.fakeCheckpointSections(scope)).map(([name, value]) => ({
      name,
      included: true,
      item_count: Array.isArray(value) ? value.length : isRecord(value) ? Object.keys(value).length : 1,
      bytes: new TextEncoder().encode(JSON.stringify(value)).byteLength,
      truncated: false,
    })).sort((a, b) => a.name.localeCompare(b.name))
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
      if (!proposal) {
        blockers.push(`missing proposal: ${bundle.proposal_ids[index]}`)
      } else {
        if (proposal.status !== "applied" && !isGenericFakeApplyActionKind(proposal.action_kind)) blockers.push(`proposal ${proposal.proposal_id} action ${proposal.action_kind} must use its dedicated command`)
        if (proposal.status !== "approved" && proposal.status !== "applied") blockers.push(`proposal ${proposal.proposal_id} status is ${proposal.status}`)
      }
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
      if (proposal.status !== "approved" || !isGenericFakeApplyActionKind(proposal.action_kind)) {
        if (allowPartial) {
          skippedCount += 1
          continue
        }
        throw new Error(`proposal is not ready for generic apply: ${redactText(proposal.proposal_id)}`)
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
        if (proposal.status === "approved" && isGenericFakeApplyActionKind(proposal.action_kind)) this.applyProposal(proposal.proposal_id)
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
      would_apply: proposal.status === "approved" && blockers.length === 0 ? [proposal.proposal_id] : [],
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
      would_apply: bundle.proposal_ids.filter((proposalId) => {
        const proposal = this.requireProposal(proposalId)
        return proposal.status === "approved" && isGenericFakeApplyActionKind(proposal.action_kind)
      }),
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

  private commanderAuditTimeline(category: string | undefined, limit: number, targetType?: string, targetId?: string, afterEventId?: string, beforeEventId?: string): { events: CommanderAuditEventSummary[]; total_considered: number; next_after_event_id?: string; next_before_event_id?: string } {
    const cleanCategory = category === undefined ? undefined : readAuditCategory(category)
    const cleanTarget = targetType === undefined && targetId === undefined ? undefined : readAuditTarget(targetType ?? "", targetId ?? "")
    const allEvents = this.fakeAuditEvents()
    const afterIndex = auditBoundaryIndex(allEvents, afterEventId)
    const beforeIndex = auditBoundaryIndex(allEvents, beforeEventId)
    const events = allEvents
      .filter((event) => afterIndex === undefined || event.event_index > afterIndex)
      .filter((event) => beforeIndex === undefined || event.event_index < beforeIndex)
      .filter((event) => !cleanCategory || event.category === cleanCategory)
      .filter((event) => !cleanTarget || auditEventMatches(event, cleanTarget.targetType, cleanTarget.targetId))
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

  private commanderTargetContext(targetType: string, targetId: string): CommanderTargetContextSummary {
    const target = readAuditTarget(targetType, targetId) as { targetType: CommanderTargetType; targetId: string }
    const chain = this.commanderAuthorityChain(target.targetType, target.targetId)
    const queueMembership = this.fakeQueueMembership(target.targetType, target.targetId)
    const record = this.fakeTargetRecord(target.targetType, target.targetId)
    const related = mergeRelatedIds(record.related_ids, chain.related_ids)
    return {
      target_type: target.targetType,
      target_id: redactText(target.targetId),
      found: record.found,
      title: preview(redactText(record.title)),
      summary: preview(redactText(record.summary)),
      status: record.status ? redactText(record.status) : undefined,
      record_kind: record.record_kind,
      related_ids: related,
      queue_membership: queueMembership,
      audit_event_count: chain.events.length,
      recent_audit_events: chain.events.slice(-20).reverse(),
      suggested_commands: fakeSuggestedCommands(target.targetType, target.targetId, record.status, queueMembership, related, record.action_kind),
      missing_links: [...record.missing_links, ...chain.missing_links].map(redactText).slice(0, 20),
    }
  }

  private fakeQueueMembership(targetType: CommanderTargetType, targetId: string): CommanderQueueKind[] {
    const out: CommanderQueueKind[] = []
    for (const queue of COMMANDER_QUEUE_KINDS) {
      if (this.collectCommanderQueue(queue, 7 * 24 * 60 * 60 * 1000).some((item) => item.target_type === targetType && item.target_id === targetId)) out.push(queue)
    }
    return out
  }

  private fakeTargetRecord(targetType: CommanderTargetType, targetId: string): { found: boolean; title: string; summary: string; status?: string; record_kind?: string; action_kind?: string; related_ids: Record<string, string[]>; missing_links: string[] } {
    if (targetType === "mission") {
      const mission = this.missions.find((item) => item.mission_id === targetId)
      if (!mission) return fakeMissingTarget(targetType, targetId)
      return {
        found: true,
        title: `mission ${mission.mission_id}`,
        summary: mission.objective ?? mission.completion_summary ?? mission.failure_reason ?? "mission record",
        status: mission.status,
        record_kind: "mission",
        related_ids: {
          mission_id: [mission.mission_id],
          intent_id: mission.intent_id ? [mission.intent_id] : [],
          claim_id: this.claims.filter((claim) => claim.mission_id === mission.mission_id).map((claim) => claim.claim_id),
          result_id: this.results.filter((result) => result.mission_id === mission.mission_id).map((result) => result.result_id),
        },
        missing_links: [],
      }
    }
    if (targetType === "claim") {
      const claim = this.claims.find((item) => item.claim_id === targetId)
      if (!claim) return fakeMissingTarget(targetType, targetId)
      return { found: true, title: `claim ${claim.claim_id}`, summary: `executor=${claim.executor_id}`, status: claim.status, record_kind: "mission_claim", related_ids: { claim_id: [claim.claim_id], mission_id: [claim.mission_id] }, missing_links: [] }
    }
    if (targetType === "result") {
      const result = this.results.find((item) => item.result_id === targetId)
      if (!result) return fakeMissingTarget(targetType, targetId)
      return { found: true, title: `result ${result.result_id}`, summary: result.summary, status: result.status, record_kind: "mission_result", related_ids: { result_id: [result.result_id], mission_id: [result.mission_id], claim_id: [result.claim_id] }, missing_links: [] }
    }
    if (targetType === "review") {
      const review = this.reviews.find((item) => item.review_id === targetId)
      if (!review) return fakeMissingTarget(targetType, targetId)
      return { found: true, title: review.title, summary: review.summary, status: review.status, record_kind: "review_request", related_ids: { review_id: [review.review_id], proposal_id: this.proposals.filter((proposal) => proposal.review_id === review.review_id).map((proposal) => proposal.proposal_id), mission_id: review.mission_id ? [review.mission_id] : [], claim_id: review.claim_id ? [review.claim_id] : [], result_id: review.result_id ? [review.result_id] : [] }, missing_links: [] }
    }
    if (targetType === "proposal") {
      const proposal = this.proposals.find((item) => item.proposal_id === targetId)
      if (!proposal) return fakeMissingTarget(targetType, targetId)
      return { found: true, title: proposal.title, summary: proposal.summary, status: proposal.status, record_kind: "commander_proposal", action_kind: proposal.action_kind, related_ids: { proposal_id: [proposal.proposal_id], review_id: proposal.review_id ? [proposal.review_id] : [], bundle_id: this.proposalBundles.filter((bundle) => bundle.proposal_ids.includes(proposal.proposal_id)).map((bundle) => bundle.bundle_id), draft_id: this.playbookDrafts.filter((draft) => draft.proposal_ids.includes(proposal.proposal_id)).map((draft) => draft.draft_id), mission_id: proposal.mission_id ? [proposal.mission_id] : [], claim_id: proposal.claim_id ? [proposal.claim_id] : [], result_id: proposal.result_id ? [proposal.result_id] : [] }, missing_links: [] }
    }
    if (targetType === "bundle") {
      const bundle = this.proposalBundles.find((item) => item.bundle_id === targetId)
      if (!bundle) return fakeMissingTarget(targetType, targetId)
      const projected = this.projectProposalBundle(bundle)
      return { found: true, title: projected.title, summary: projected.summary, status: projected.status, record_kind: "commander_proposal_bundle", related_ids: { bundle_id: [projected.bundle_id], proposal_id: projected.proposal_ids }, missing_links: [] }
    }
    if (targetType === "draft") {
      const draft = this.playbookDrafts.find((item) => item.draft_id === targetId)
      if (!draft) return fakeMissingTarget(targetType, targetId)
      return { found: true, title: draft.playbook_id, summary: "playbook draft", status: draft.status, record_kind: "commander_playbook_draft", related_ids: { draft_id: [draft.draft_id], proposal_id: draft.proposal_ids, bundle_id: draft.bundle_id ? [draft.bundle_id] : [], review_id: draft.review_ids ?? [] }, missing_links: [] }
    }
    return { found: true, title: `runtime ${targetId}`, summary: "fake runtime connected", status: "fake runtime connected", record_kind: "runtime", related_ids: { intent_id: [targetId] }, missing_links: [] }
  }

  private commanderQueueSummary(staleAfterMs: number): CommanderQueueSummary {
    return {
      needs_review_count: this.commanderQueue("needs_review", 100, staleAfterMs).total_considered,
      ready_to_apply_count: this.commanderQueue("ready_to_apply", 100, staleAfterMs).total_considered,
      blocked_count: this.commanderQueue("blocked", 100, staleAfterMs).total_considered,
      failed_apply_count: this.commanderQueue("failed_apply", 100, staleAfterMs).total_considered,
      recently_applied_count: this.commanderQueue("recently_applied", 100, staleAfterMs).total_considered,
      drafts_needing_review_count: this.commanderQueue("drafts_needing_review", 100, staleAfterMs).total_considered,
      bundles_needing_review_count: this.commanderQueue("bundles_needing_review", 100, staleAfterMs).total_considered,
      stale_open_count: this.commanderQueue("stale_open", 100, staleAfterMs).total_considered,
      last_updated_at: new Date(0).toISOString(),
    }
  }

  private commanderQueue(queue: CommanderQueueKind, limit: number, staleAfterMs: number): { queue: CommanderQueueKind; items: CommanderQueueItemSummary[]; total_considered: number; limit: number } {
    const items = this.collectCommanderQueue(queue, staleAfterMs)
    const ordered = orderQueueItems(queue, items)
    return {
      queue,
      items: ordered.slice(0, limit),
      total_considered: ordered.length,
      limit,
    }
  }

  private collectCommanderQueue(queue: CommanderQueueKind, staleAfterMs: number): CommanderQueueItemSummary[] {
    switch (queue) {
      case "needs_review":
        return this.reviews.filter((review) => review.status === "pending").map((review) => fakeQueueItem(queue, "review", review.review_id, review.title, review.summary, review.status, { review_id: [review.review_id], mission_id: review.mission_id ? [review.mission_id] : [] }, review.created_at, review.updated_at, "high"))
      case "ready_to_apply":
        return [
          ...this.proposals.filter((proposal) => this.proposalApplyPreview(proposal.proposal_id).ready_to_apply && proposal.status !== "applied").map((proposal) => fakeQueueItem(queue, "proposal", proposal.proposal_id, proposal.title, proposal.summary, proposal.status, proposalRelatedIds(proposal), proposal.created_at, proposal.updated_at, "high")),
          ...this.proposalBundles.filter((bundle) => this.bundleApplyPreview(bundle.bundle_id, "bundle").ready_to_apply && this.projectProposalBundle(bundle).status !== "applied").map((bundle) => fakeQueueItem(queue, "bundle", bundle.bundle_id, bundle.title, bundle.summary, this.projectProposalBundle(bundle).status, bundleRelatedIds(bundle), bundle.created_at, bundle.updated_at, "high")),
          ...this.playbookDrafts.filter((draft) => this.draftApplyPreview(draft.draft_id).ready_to_apply).map((draft) => draftQueueItem(queue, draft, "high")),
        ]
      case "blocked":
        return [
          ...this.proposals.filter((proposal) => !isTerminalFakeProposal(proposal) && !this.proposalApplyPreview(proposal.proposal_id).ready_to_apply).map((proposal) => fakeQueueItem(queue, "proposal", proposal.proposal_id, proposal.title, proposal.summary, proposal.status, proposalRelatedIds(proposal), proposal.created_at, proposal.updated_at, "normal", this.proposalApplyPreview(proposal.proposal_id).blockers)),
          ...this.proposalBundles.filter((bundle) => !isTerminalFakeBundle(this.projectProposalBundle(bundle)) && !this.bundleApplyPreview(bundle.bundle_id, "bundle").ready_to_apply).map((bundle) => fakeQueueItem(queue, "bundle", bundle.bundle_id, bundle.title, bundle.summary, this.projectProposalBundle(bundle).status, bundleRelatedIds(bundle), bundle.created_at, bundle.updated_at, "normal", this.bundleApplyPreview(bundle.bundle_id, "bundle").blockers)),
          ...this.playbookDrafts.filter((draft) => !isTerminalFakeDraft(draft) && !this.draftApplyPreview(draft.draft_id).ready_to_apply).map((draft) => draftQueueItem(queue, draft, "normal", this.draftApplyPreview(draft.draft_id).blockers)),
        ]
      case "failed_apply":
        return [
          ...this.proposals.filter((proposal) => proposal.status === "approved" && proposal.failure_reason).map((proposal) => fakeQueueItem(queue, "proposal", proposal.proposal_id, proposal.title, proposal.summary, proposal.status, proposalRelatedIds(proposal), proposal.created_at, proposal.updated_at, "high", proposal.failure_reason ? [proposal.failure_reason] : [])),
          ...this.proposalBundles.flatMap((bundle) => {
            const projected = this.projectProposalBundle(bundle)
            if (!bundle.failure_reason || projected.status === "cancelled" || projected.status === "applied") return []
            return [fakeQueueItem(queue, "bundle", bundle.bundle_id, bundle.title, bundle.summary, projected.status, bundleRelatedIds(bundle), bundle.created_at, bundle.updated_at, "high", [bundle.failure_reason])]
          }),
        ]
      case "recently_applied":
        return [
          ...this.proposals.filter((proposal) => proposal.status === "applied").map((proposal) => fakeQueueItem(queue, "proposal", proposal.proposal_id, proposal.title, proposal.summary, proposal.status, proposalRelatedIds(proposal), proposal.created_at, proposal.updated_at, "normal")),
          ...this.proposalBundles.filter((bundle) => this.projectProposalBundle(bundle).status === "applied").map((bundle) => fakeQueueItem(queue, "bundle", bundle.bundle_id, bundle.title, bundle.summary, "applied", bundleRelatedIds(bundle), bundle.created_at, bundle.updated_at, "normal")),
        ]
      case "drafts_needing_review":
        return this.playbookDrafts.filter((draft) => draft.status !== "cancelled" && draft.proposal_ids.some((proposalId) => !this.requireProposal(proposalId).review_id)).map((draft) => draftQueueItem(queue, draft, "high", draft.proposal_ids.filter((proposalId) => !this.requireProposal(proposalId).review_id).map((proposalId) => `proposal ${proposalId} has no linked review`)))
      case "bundles_needing_review":
        return this.proposalBundles.filter((bundle) => this.projectProposalBundle(bundle).status !== "cancelled" && this.projectProposalBundle(bundle).status !== "applied" && bundle.proposal_ids.some((proposalId) => {
          const proposal = this.requireProposal(proposalId)
          return !proposal.review_id || proposal.status === "proposed"
        })).map((bundle) => fakeQueueItem(queue, "bundle", bundle.bundle_id, bundle.title, bundle.summary, this.projectProposalBundle(bundle).status, bundleRelatedIds(bundle), bundle.created_at, bundle.updated_at, "high", bundle.proposal_ids.flatMap((proposalId) => {
          const proposal = this.requireProposal(proposalId)
          if (!proposal.review_id) return [`proposal ${proposalId} has no linked review`]
          if (proposal.status === "proposed") return [`proposal ${proposalId} status is proposed`]
          return []
        })))
      case "stale_open": {
        const threshold = Date.parse(fakeNowIso()) - staleAfterMs
        const stale = (createdAt?: string, updatedAt?: string) => Date.parse(updatedAt ?? createdAt ?? "") <= threshold
        return [
          ...this.reviews.filter((review) => review.status === "pending" && stale(review.created_at, review.updated_at)).map((review) => fakeQueueItem(queue, "review", review.review_id, review.title, review.summary, review.status, { review_id: [review.review_id] }, review.created_at, review.updated_at, "normal")),
          ...this.proposals.filter((proposal) => ["proposed", "review_requested", "approved"].includes(proposal.status) && stale(proposal.created_at, proposal.updated_at)).map((proposal) => fakeQueueItem(queue, "proposal", proposal.proposal_id, proposal.title, proposal.summary, proposal.status, proposalRelatedIds(proposal), proposal.created_at, proposal.updated_at, "normal")),
          ...this.proposalBundles.filter((bundle) => ["open", "review_requested", "partially_approved", "approved"].includes(this.projectProposalBundle(bundle).status) && stale(bundle.created_at, bundle.updated_at)).map((bundle) => fakeQueueItem(queue, "bundle", bundle.bundle_id, bundle.title, bundle.summary, this.projectProposalBundle(bundle).status, bundleRelatedIds(bundle), bundle.created_at, bundle.updated_at, "normal")),
          ...this.playbookDrafts.filter((draft) => draft.status !== "cancelled" && stale(draft.created_at, draft.updated_at)).map((draft) => draftQueueItem(queue, draft, "normal")),
        ]
      }
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
      .sort((a, b) => fakeAuditSortKey(a) - fakeAuditSortKey(b) || fakeAuditKindOrder(a.kind) - fakeAuditKindOrder(b.kind) || a.kind.localeCompare(b.kind))
      .map((event, index) => ({ ...event, event_index: index }))
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
    if (id === "fake-handoff-proposal") this.ensureFakeHandoffProposal()
    const proposal = this.proposals.find((item) => item.proposal_id === id)
    if (!proposal) throw new Error(`commander proposal not found: ${redactText(id)}`)
    return proposal
  }

  private ensureFakeHandoffProposal(): void {
    if (this.proposals.some((item) => item.proposal_id === "fake-handoff-proposal")) return
    const now = new Date(0).toISOString()
    this.reviews.unshift({
      review_id: "fake-handoff-review",
      request_type: "operator_checkpoint",
      title: "Approve fake OpenCode handoff",
      summary: "Deterministic fake approved handoff review",
      requested_by: "operator",
      status: "approved",
      created_at: now,
      updated_at: now,
      decision_at: now,
      decision_by: "operator",
      decision_reason: "approved for fake handoff",
    })
    this.proposals.unshift({
      proposal_id: "fake-handoff-proposal",
      review_id: "fake-handoff-review",
      action_kind: "opencode_handoff",
      title: "Fake OpenCode handoff",
      summary: "Deterministic approved handoff proposal",
      proposed_by: "operator",
      status: "approved",
      action_payload: {
        objective: "Run fake OpenCode handoff mission",
        source_cycle_id: "fake-cycle-1",
        evidence_ids: ["fake-evidence-1"],
        requested_executor: "opencode",
      },
      created_at: now,
      updated_at: now,
      decision_at: now,
    })
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

function readSmokeTimeout(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1) return 10_000
  return Math.min(Number(value), 60_000)
}

function readQueueLimit(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error("commander queue limit must be a positive integer")
  return Math.min(Number(value), 100)
}

function readQueueKind(value: string): CommanderQueueKind {
  if (isCommanderQueueKind(value)) return value
  throw new Error("commander queue kind is invalid")
}

function readFollowupQueue(value: string): OpenCodeHandoffFollowupQueueKind {
  if (value === "active" || value === "needs_result_review" || value === "completed" || value === "failed" || value === "blocked" || value === "stale") return value
  throw new Error("handoff follow-up queue is invalid")
}

function readCheckpointScope(value: string): RuntimeCheckpointScope {
  if (value === "full" || value === "commander" || value === "executor" || value === "research" || value === "handoff") return value
  throw new Error("runtime checkpoint scope is invalid")
}

function readExternalApiMethod(value: string): "GET" | "POST" {
  const method = value.toUpperCase()
  if (method === "GET" || method === "POST") return method
  throw new Error("method must be GET or POST")
}

function isCommanderQueueKind(value: string): value is CommanderQueueKind {
  return value === "needs_review" ||
    value === "ready_to_apply" ||
    value === "blocked" ||
    value === "failed_apply" ||
    value === "recently_applied" ||
    value === "drafts_needing_review" ||
    value === "bundles_needing_review" ||
    value === "stale_open"
}

function fakeFollowupStatus(missionStatus: string | undefined, activeClaimId: string | undefined, progressCount: number, resultCount: number, blockers: string[]): OpenCodeHandoffFollowupSummary["followup_status"] {
  if (blockers.length > 0) return "blocked"
  if (!missionStatus) return "unknown"
  if (missionStatus === "completed" || missionStatus === "failed" || missionStatus === "cancelled") return missionStatus
  if (resultCount > 0) return "result_submitted"
  if (missionStatus === "running" || progressCount > 0) return "running"
  if (missionStatus === "claimed" || activeClaimId) return "claimed"
  if (missionStatus === "sent") return "sent"
  return "unknown"
}

function fakeFollowupCommands(handoffId: string, missionId?: string, claimId?: string, progressId?: string, resultId?: string): OpenCodeHandoffFollowupSummary["suggested_commands"] {
  const commands: OpenCodeHandoffFollowupSummary["suggested_commands"] = [
    { label: "Show handoff", command: `/handoff-show ${handoffId}`, command_type: "read" },
    { label: "Show follow-up", command: `/handoff-followup ${handoffId}`, command_type: "read" },
  ]
  if (missionId) {
    commands.push(
      { label: "Show mission", command: `/mission ${missionId}`, command_type: "read" },
      { label: "List claims", command: `/claims ${missionId}`, command_type: "read" },
      { label: "List progress", command: `/progress ${missionId}`, command_type: "read" },
      { label: "List results", command: `/results ${missionId}`, command_type: "read" },
    )
  }
  if (claimId) commands.push({ label: "Open claim", command: `/open claim ${claimId}`, command_type: "read" })
  if (progressId) commands.push({ label: "Open progress", command: `/open progress ${progressId}`, command_type: "read" })
  if (resultId) commands.push({ label: "Open result", command: `/open result ${resultId}`, command_type: "read" })
  return commands
}

function readStaleAfterMs(value: unknown): number {
  if (value === undefined) return 7 * 24 * 60 * 60 * 1000
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error("commander queue staleAfterMs must be a positive integer")
  return Number(value)
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function fakeNowIso(): string {
  return "1970-01-07T23:59:59.999Z"
}

function fakeQueueItem(queue: CommanderQueueKind, targetType: string, targetId: string, title: string, summary: string, status: string, relatedIds: Record<string, string[]>, createdAt?: string, updatedAt?: string, priority?: string, blockers?: string[]): CommanderQueueItemSummary {
  return {
    queue,
    target_type: targetType,
    target_id: redactText(targetId),
    title: preview(redactText(title)),
    summary: preview(redactText(summary)),
    status: redactText(status),
    priority,
    related_ids: redactQueueRelatedIds(relatedIds),
    blockers: blockers?.map((blocker) => preview(redactText(blocker))).slice(0, 10),
    created_at: createdAt,
    updated_at: updatedAt,
  }
}

function preview(value: string): string {
  return value.length > 160 ? `${value.slice(0, 160)}...` : value
}

function draftQueueItem(queue: CommanderQueueKind, draft: CommanderWorkbenchDraftSummary, priority?: string, blockers?: string[]): CommanderQueueItemSummary {
  return fakeQueueItem(
    queue,
    "draft",
    draft.draft_id,
    draft.playbook_id,
    Object.entries(draft.field_values).map(([key, value]) => `${key}=${value}`).join("; ") || "playbook draft",
    draft.status,
    { draft_id: [draft.draft_id], proposal_id: draft.proposal_ids, bundle_id: draft.bundle_id ? [draft.bundle_id] : [], review_id: draft.review_ids ?? [] },
    draft.created_at,
    draft.updated_at,
    priority,
    blockers,
  )
}

function proposalRelatedIds(proposal: CommanderProposalSummary): Record<string, string[]> {
  return {
    proposal_id: [proposal.proposal_id],
    review_id: proposal.review_id ? [proposal.review_id] : [],
    mission_id: proposal.mission_id ? [proposal.mission_id] : [],
    claim_id: proposal.claim_id ? [proposal.claim_id] : [],
    result_id: proposal.result_id ? [proposal.result_id] : [],
  }
}

function bundleRelatedIds(bundle: CommanderProposalBundleSummary): Record<string, string[]> {
  return {
    bundle_id: [bundle.bundle_id],
    proposal_id: bundle.proposal_ids,
  }
}

function redactQueueRelatedIds(value: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [key, values] of Object.entries(value)) {
    const clean = values.filter(Boolean).map(redactText).slice(0, 50)
    if (clean.length > 0) out[key] = clean
  }
  return out
}

export function orderQueueItems(queue: CommanderQueueKind, items: CommanderQueueItemSummary[]): CommanderQueueItemSummary[] {
  const direction = queue === "recently_applied" || queue === "ready_to_apply" || queue === "blocked" || queue === "failed_apply" ? -1 : 1
  return items.slice().sort((a, b) => {
    const byTime = direction * (queueTime(a) - queueTime(b))
    if (byTime !== 0) return byTime
    const byPriority = queuePriorityRank(b.priority) - queuePriorityRank(a.priority)
    if (byPriority !== 0) return byPriority
    return `${a.target_type}:${a.target_id}`.localeCompare(`${b.target_type}:${b.target_id}`)
  })
}

function queueTime(item: CommanderQueueItemSummary): number {
  const timestamp = Date.parse(item.updated_at ?? item.created_at ?? "")
  return Number.isFinite(timestamp) ? timestamp : 0
}

function queuePriorityRank(value: CommanderQueueItemSummary["priority"]): number {
  if (value === "high") return 2
  if (value === "normal") return 1
  return 0
}

function readAuditLimit(value: unknown): number {
  if (value === undefined) return 20
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error("audit limit must be a positive integer")
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

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, 20)
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

function fakeMissingTarget(targetType: CommanderTargetType, targetId: string): { found: boolean; title: string; summary: string; record_kind: string; related_ids: Record<string, string[]>; missing_links: string[] } {
  return {
    found: false,
    title: `${targetType} ${targetId}`,
    summary: "target record not found",
    record_kind: targetType,
    related_ids: { [`${targetType}_id`]: [redactText(targetId)] },
    missing_links: [`${targetType} record not found: ${targetId}`],
  }
}

function mergeRelatedIds(...records: Record<string, string[]>[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const record of records) {
    for (const [key, values] of Object.entries(record)) {
      out[key] = [...new Set([...(out[key] ?? []), ...values.map(redactText)])].sort().slice(0, 20)
    }
  }
  return Object.fromEntries(Object.entries(out).filter(([, values]) => values.length > 0).sort(([a], [b]) => a.localeCompare(b)))
}

function fakeSuggestedCommands(targetType: CommanderTargetType, targetId: string, status: string | undefined, queues: CommanderQueueKind[], relatedIds: Record<string, string[]>, actionKind?: string): CommanderTargetContextSummary["suggested_commands"] {
  const id = redactText(targetId)
  const missionId = relatedIds.mission_id?.[0] ?? id
  const commands: CommanderTargetContextSummary["suggested_commands"] = []
  const add = (label: string, command: string, commandType: "read" | "write" = "read", requiresReview = false, requiresActiveRuntime = false) => {
    commands.push({ label: redactText(label), command: redactText(command), command_type: commandType, requires_review: requiresReview || undefined, requires_active_runtime: requiresActiveRuntime || undefined })
  }
  if (targetType === "mission") {
    add("Open mission", `/mission ${id}`)
    add("Audit mission", `/audit mission ${id}`)
  } else if (targetType === "review") {
    add("Open review", `/review ${id}`)
    add("Audit review", `/audit review ${id}`)
    if (status === "pending") {
      add("Approve review", `/approve ${id}`, "write", false, true)
      add("Reject review", `/reject ${id} <reason>`, "write", false, true)
    }
  } else if (targetType === "proposal") {
    add("Open proposal", `/proposal ${id}`)
    add("Request review", `/proposal-review ${id} <title> -- <summary>`, "write", true, true)
    if (actionKind === "opencode_handoff") {
      add("Preview handoff", `/handoff-preview ${id}`)
      if (status === "approved") add("Execute handoff", `/handoff ${id}`, "write", true, true)
    } else {
      add("Preview apply", `/apply-preview proposal ${id}`)
      if (status === "approved") add("Apply proposal", `/apply-target proposal ${id}`, "write", true, true)
    }
  } else if (targetType === "bundle") {
    add("Open bundle", `/bundle ${id}`)
    add("Check readiness", `/bundle-ready ${id}`)
    add("Request reviews", `/bundle-review ${id}`, "write", true, true)
    add("Preview apply", `/apply-preview bundle ${id}`)
    if (status === "approved") add("Apply bundle", `/apply-target bundle ${id}`, "write", true, true)
  } else if (targetType === "draft") {
    add("Open draft", `/draft ${id}`)
    add("Check readiness", `/draft-ready ${id}`)
    add("Request reviews", `/draft-review ${id}`, "write", true, true)
    add("Preview apply", `/apply-preview draft ${id}`)
    if (status !== "cancelled") add("Apply draft", `/apply-target draft ${id}`, "write", true, true)
  } else if (targetType === "claim") {
    add("List claims", `/claims ${missionId}`)
    add("Audit claim", `/audit claim ${id}`)
    add("Propose release", `/propose-release ${id} <title> -- <reason>`, "write", true, true)
  } else if (targetType === "result") {
    add("List results", `/results ${missionId}`)
    add("Audit result", `/audit result ${id}`)
    add("Draft completion", `/draft-complete ${missionId} ${id} <title> -- <summary>`, "write", true, true)
  } else {
    add("Runtime status", "/status")
    add("Audit runtime", `/audit runtime ${id}`)
  }
  for (const queue of queues) add(`Open ${queue}`, `/queue ${queue}`)
  return commands.slice(0, 12)
}

function readAuditCategory(category: string): string {
  if (!["mission", "review", "proposal", "proposal_bundle", "playbook_draft", "apply", "runtime", "other"].includes(category)) throw new Error("commander audit category is invalid")
  return category
}

function auditBoundaryIndex(events: CommanderAuditEventSummary[], eventId: string | undefined): number | undefined {
  if (eventId === undefined) return undefined
  const index = events.find((event) => event.event_id === requiredString(eventId, "eventId"))?.event_index
  if (index === undefined) throw new Error("audit event cursor not found")
  return index
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
    event_id: stableFakeAuditEventId(kind, targetId, cleanRelated),
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

function stableFakeAuditEventId(kind: string, targetId: string, relatedIds: Record<string, string[]>): string {
  const stableId = relatedIds.draft_id?.[0]
    ?? relatedIds.bundle_id?.[0]
    ?? relatedIds.proposal_id?.[0]
    ?? relatedIds.review_id?.[0]
    ?? relatedIds.progress_id?.[0]
    ?? relatedIds.result_id?.[0]
    ?? relatedIds.claim_id?.[0]
    ?? relatedIds.mission_id?.[0]
    ?? relatedIds.intent_id?.[0]
    ?? redactText(targetId)
  return `fake-audit-${kind}-${stableId}`.replace(/[^A-Za-z0-9_.:-]/g, "_")
}

function fakeAuditSortKey(event: CommanderAuditEventSummary): number {
  const ids = [
    event.target_id,
    ...Object.values(event.related_ids).flat(),
  ].filter((value): value is string => typeof value === "string")
  const suffixes = ids.map((value) => /-(\d+)$/.exec(value)?.[1]).filter((value): value is string => typeof value === "string").map(Number)
  return suffixes.length > 0 ? Math.max(...suffixes) : -1
}

function fakeAuditKindOrder(kind: string): number {
  if (kind === "mission_created") return 0
  if (kind === "mission_claimed") return 1
  if (kind === "mission_progress_recorded") return 2
  if (kind === "mission_result_submitted") return 3
  if (kind === "review_request_created") return 4
  if (kind.startsWith("review_request_")) return 5
  if (kind === "commander_proposal_created") return 6
  if (kind === "commander_proposal_bundle_created") return 7
  if (kind === "commander_playbook_draft_created") return 8
  if (kind === "commander_proposal_applied") return 9
  return 20
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
  if (key === "intent_id") return "runtime"
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
  if (proposal.status === "applied") return []
  if (!isGenericFakeApplyActionKind(proposal.action_kind)) return [`proposal ${proposal.proposal_id} action ${proposal.action_kind} must use its dedicated command`]
  if (proposal.status === "approved") return []
  if (proposal.status === "rejected" || proposal.status === "cancelled") return [`proposal ${proposal.proposal_id} is ${proposal.status}`]
  if (!proposal.review_id) return [`proposal ${proposal.proposal_id} has no linked review`]
  return [`proposal ${proposal.proposal_id} status is ${proposal.status}`]
}

function isGenericFakeApplyActionKind(actionKind: string): boolean {
  return actionKind !== "opencode_handoff"
}

function isTerminalFakeProposal(proposal: CommanderProposalSummary): boolean {
  return proposal.status === "applied" || proposal.status === "rejected" || proposal.status === "cancelled"
}

function isTerminalFakeBundle(bundle: CommanderProposalBundleSummary): boolean {
  return bundle.status === "applied" || bundle.status === "cancelled"
}

function isTerminalFakeDraft(draft: CommanderWorkbenchDraftSummary): boolean {
  return draft.status === "cancelled"
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

function readReviewDecision(value: string): "approve" | "reject" {
  if (value === "approve" || value === "reject") return value
  throw new Error("executor review proposal review decision must be approve or reject")
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

function fakeExternalApiConnectors(): ExternalApiConnectorSummary[] {
  return [
    {
      connector_id: "generic-http-readonly",
      title: "Generic HTTP read-only",
      description: "Disabled placeholder until explicitly configured",
      base_url: "https://disabled.example.invalid",
      allowed_hosts: [],
      allowed_methods: ["GET"],
      timeout_ms: 5000,
      max_response_bytes: 4096,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
      credential_refs: [],
    },
    {
      connector_id: "mock-research-api",
      title: "Mock research API",
      description: "Deterministic connector for fake transport and tests",
      base_url: "https://api.example.test",
      allowed_hosts: ["api.example.test"],
      allowed_methods: ["GET", "POST"],
      timeout_ms: 5000,
      max_response_bytes: 4096,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
      credential_refs: [],
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

function readReasoningSurface(value: unknown): "research_synthesis" | "commander_cycle" | "commander_executor_review" {
  if (value === undefined || value === "research" || value === "research_synthesis") return "research_synthesis"
  if (value === "cycle" || value === "commander_cycle") return "commander_cycle"
  if (value === "executor_review" || value === "commander_executor_review") return "commander_executor_review"
  throw new Error("reasoning smoke surface must be research_synthesis, commander_cycle, or commander_executor_review")
}

function readMiniMaxLiveValidationSurfaces(value: unknown): Array<"research_synthesis" | "commander_cycle" | "commander_executor_review"> {
  const raw = Array.isArray(value) ? value : value === undefined ? ["commander_executor_review"] : [value]
  return [...new Set(raw.map(readMiniMaxLiveValidationSurface))]
}

function readMiniMaxLiveValidationSurface(value: unknown): "research_synthesis" | "commander_cycle" | "commander_executor_review" {
  if (value === "research" || value === "research_synthesis") return "research_synthesis"
  if (value === "cycle" || value === "commander_cycle") return "commander_cycle"
  if (value === "executor_review" || value === "commander_executor_review") return "commander_executor_review"
  throw new Error("MiniMax live validation surface must be research_synthesis, commander_cycle, or commander_executor_review")
}

function readValidationTimeout(value: unknown): number {
  if (value === undefined) return 20_000
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 60_000) throw new Error("MiniMax live validation timeout must be 1..60000 milliseconds")
  return parsed
}

function continuationRecord(plan: ContinuationPlanSummary): ContinuationPlanRecordSummary {
  return {
    plan_id: plan.plan_id,
    wake_id: plan.wake_id,
    status: plan.status,
    created_at: plan.created_at,
    updated_at: plan.updated_at,
    step_count: plan.steps.length,
    completed_step_count: plan.completed_step_count,
    failed_step_count: plan.failed_step_count,
    summary_preview: `fake continuation wake=${plan.wake_id} status=${plan.status}`,
    plan_hash: plan.plan_hash,
  }
}

function wakeScheduleRecord(schedule: WakeScheduleSummary): WakeScheduleRecordSummary {
  return {
    schedule_id: schedule.schedule_id,
    resume_id: schedule.resume_id,
    status: schedule.status,
    title: schedule.title,
    next_due_at: schedule.next_due_at,
    last_tick_at: schedule.last_tick_at,
    last_wake_id: schedule.last_wake_id,
    last_plan_id: schedule.last_plan_id,
    summary_preview: `fake wake schedule resume=${schedule.resume_id} status=${schedule.status}`,
  }
}

function fakeWakeSchedulePolicy(value: unknown): WakeSchedulePreviewSummary["policy"] {
  const input = isRecord(value) ? value : {}
  const createContinuationPlan = input.createContinuationPlan === true || input.create_continuation_plan === true
  return {
    create_wake_assessment: input.createWakeAssessment === false || input.create_wake_assessment === false ? false : true,
    create_continuation_plan: createContinuationPlan,
    include_write_steps: input.includeWriteSteps === true || input.include_write_steps === true,
    max_wake_assessments_per_tick: readLimit(input.maxWakeAssessmentsPerTick ?? input.max_wake_assessments_per_tick, 1),
    max_continuation_plans_per_tick: readLimit(input.maxContinuationPlansPerTick ?? input.max_continuation_plans_per_tick, createContinuationPlan ? 1 : 0),
  }
}

function fakeWakeSchedulerStatus(): WakeSchedulerStateSummary {
  return {
    status: "stopped",
    config: {
      enabled: false,
      interval_ms: 60_000,
      max_due_items: 5,
      dry_run: false,
      heartbeat_interval_ms: 60_000,
      stop_on_error: false,
    },
    tick_count: 0,
    heartbeat_count: 0,
  }
}

function fakeWakeSchedulerBootstrapStatus(): WakeSchedulerBootstrapStatusSummary {
  return {
    autostart_enabled: false,
    configured: false,
    can_bootstrap: false,
    scheduler_status: "stopped",
    config: {
      enabled: false,
      interval_ms: 60_000,
      max_due_items: 5,
      dry_run: false,
      heartbeat_interval_ms: 60_000,
      stop_on_error: false,
      require_due_schedule: false,
      requested_by: "scheduler-bootstrap",
    },
    blockers: ["wake scheduler autostart disabled"],
    warnings: ["wake scheduler bootstrap config absent"],
    stale_prior_run: { detected: false },
    redacted_summary_preview: "fake wake scheduler bootstrap autostart=false",
  }
}

function fakeWakeSchedulerRecoveryPreview(overrides: Partial<WakeSchedulerRecoveryPreviewSummary> = {}): WakeSchedulerRecoveryPreviewSummary {
  return {
    stale_detected: false,
    status: "none",
    scheduler_status: "stopped",
    current_event_count: 0,
    due_schedule_count: 0,
    eligible_due_schedule_count: 0,
    blocked_due_schedule_count: 0,
    warnings: [],
    blockers: [],
    recommended_commands: [
      { label: "Inspect scheduler status", command: "/scheduler-status", command_type: "read" },
      { label: "Preview due wake schedules", command: "/wake-tick-preview", command_type: "read" },
    ],
    redacted_summary_preview: "fake wake scheduler recovery stale=false",
    ...overrides,
  }
}

function fakeWakeSchedulerAuditTimeline(recovery: WakeSchedulerRecoveryPreviewSummary): WakeSchedulerAuditTimelineEntrySummary[] {
  const now = new Date(0).toISOString()
  const recoveryId = recovery.recovery_id ?? "fake-recovery-1"
  const out: WakeSchedulerAuditTimelineEntrySummary[] = [{
    audit_id: "fake-audit-bootstrap",
    event_id: "fake-bootstrap-event",
    source_kind: "scheduler_bootstrap",
    source_event_kind: "runtime_wake_scheduler_bootstrap_blocked",
    severity: "warning",
    created_at: now,
    title: "runtime_wake_scheduler_bootstrap_blocked",
    summary: "message=wake scheduler autostart disabled",
    related_ids: {},
    recommended_commands: [{ label: "Scheduler bootstrap", command: "/scheduler-bootstrap", command_type: "read" }],
  }]
  if (recovery.stale_detected) {
    out.unshift({
      audit_id: "fake-audit-recovery",
      event_id: recovery.prior_event_id,
      source_kind: "scheduler_bootstrap",
      source_event_kind: "runtime_wake_scheduler_stale_run_detected",
      severity: "warning",
      created_at: now,
      title: "runtime_wake_scheduler_stale_run_detected",
      summary: `recovery=${recoveryId}`,
      related_ids: { recovery_id: [recoveryId], event_id: recovery.prior_event_id ? [recovery.prior_event_id] : [] },
      recommended_commands: [{ label: "Scheduler recovery", command: "/scheduler-recovery", command_type: "read" }],
    })
  }
  return out
}

function fakeWakeSchedulerNavigationCommandPreview(commandValue: string): WakeSchedulerNavigationCommandPreviewSummary {
  const command = preview(redactText(commandValue.trim()))
  if (!command.startsWith("/") || command.startsWith("/tmp/") || command.startsWith("/path")) return fakeUnsupportedNavigationCommand(command, "only whitelisted slash commands are supported")
  const name = command.split(/\s+/)[0] ?? ""
  const target_id = command.split(/\s+/)[1]?.includes("=") ? undefined : command.split(/\s+/)[1]
  const safeRead = new Set(["/scheduler-status", "/scheduler-events", "/scheduler-bootstrap", "/scheduler-bootstrap-preview", "/scheduler-recovery", "/scheduler-recovery-preview", "/scheduler-recoveries", "/scheduler-recovery-show", "/scheduler-recovery-workflows", "/scheduler-recovery-workflow-show", "/scheduler-recovery-workflow-verify", "/scheduler-audit", "/scheduler-audit-summary", "/scheduler-audit-timeline", "/scheduler-audit-chain", "/scheduler-audit-incidents", "/scheduler-nav-staged", "/wake-tick-preview", "/wake-schedules", "/wake-schedule", "/wake-ticks", "/wake-tick-show", "/wake-preview", "/wake-show", "/continuations", "/continue-show", "/checkpoints", "/checkpoint-show", "/resume-anchors", "/resume-anchor", "/handoff-followups", "/handoff-followup", "/missions", "/mission", "/reasoning"])
  const writes = new Set(["/scheduler-start", "/scheduler-stop", "/wake-tick", "/wake-tick-dry-run", "/scheduler-recovery-ack", "/scheduler-recovery-resolve", "/scheduler-recovery-dismiss", "/scheduler-recovery-workflow", "/scheduler-recovery-step-done", "/scheduler-recovery-step-skip", "/scheduler-recovery-step-block", "/scheduler-recovery-workflow-cancel", "/checkpoint", "/continue-step", "/continue-plan", "/continue-pause", "/continue-cancel"])
  const highImpact = new Set(["/handoff", "/apply", "/approve", "/reject", "/complete", "/fail", "/cancel", "/api-call", "/synthesize", "/cycle"])
  if (safeRead.has(name)) {
    return {
      command,
      command_type: "read",
      risk: "safe_read",
      target_kind: name === "/scheduler-recovery-workflow" ? "scheduler_recovery" : fakeTargetKindForCommand(name),
      target_id,
      supported: true,
      blockers: [],
      notes: ["read-only inspection command; navigation does not execute it"],
      equivalent_runtime_command: fakeRuntimeCommandFor(name),
      redacted_summary_preview: `safe_read ${command}`,
    }
  }
  if (writes.has(name)) {
    return {
      command,
      command_type: "write",
      risk: "write_requires_operator",
      target_kind: fakeTargetKindForCommand(name),
      target_id,
      supported: true,
      blockers: ["navigation is read-only and will not run this command"],
      notes: ["write command requires explicit operator execution outside navigation"],
      equivalent_runtime_command: fakeRuntimeCommandFor(name),
      redacted_summary_preview: `write_requires_operator ${command}`,
    }
  }
  if (highImpact.has(name)) {
    return {
      command,
      command_type: "write",
      risk: "high_impact_write",
      target_kind: fakeTargetKindForCommand(name),
      target_id,
      supported: false,
      blockers: ["high-impact command is not supported by scheduler navigation"],
      notes: ["shown for awareness only"],
      redacted_summary_preview: `high_impact_write ${command}`,
    }
  }
  return fakeUnsupportedNavigationCommand(command, "command is not in the scheduler navigation whitelist")
}

function fakeUnsupportedNavigationCommand(command: string, reason: string): WakeSchedulerNavigationCommandPreviewSummary {
  return {
    command,
    command_type: "read",
    risk: "unsupported",
    target_kind: "unknown",
    supported: false,
    blockers: [reason],
    notes: ["unsupported command is displayed as text only"],
    redacted_summary_preview: `unsupported ${command}`,
  }
}

function fakeWakeSchedulerNavigationWritePreview(commandValue: string): WakeSchedulerNavigationWritePreviewSummary {
  const command = preview(redactText(commandValue.trim()))
  const parts = command.split(/\s+/)
  const name = parts[0] ?? ""
  const targetId = parts[1]?.includes("=") ? undefined : parts[1]
  if (!command.startsWith("/") || command.startsWith("/tmp/") || command.startsWith("/path")) {
    return fakeUnsupportedWritePreview(command, "command must be a single whitelisted slash command")
  }
  const highImpact = new Set(["/wake-tick", "/handoff", "/apply", "/request-review", "/approve", "/reject", "/cancel-review", "/proposal-review", "/apply-proposal", "/cancel-proposal", "/bundle-review", "/apply-bundle", "/cancel-bundle", "/draft-review", "/cancel-draft", "/apply-target", "/apply-partial", "/complete", "/fail", "/cancel", "/api-call", "/synthesize", "/cycle"])
  const medium = new Set(["/scheduler-start", "/scheduler-stop", "/scheduler-nav-run", "/checkpoint", "/scheduler-recovery-ack", "/scheduler-recovery-resolve", "/scheduler-recovery-dismiss", "/scheduler-recovery-workflow", "/scheduler-recovery-step-done", "/scheduler-recovery-step-skip", "/scheduler-recovery-step-block", "/scheduler-recovery-workflow-cancel", "/continue-plan", "/continue-step", "/continue-pause", "/continue-cancel"])
  const approvalRequired = new Set(["/checkpoint", "/scheduler-recovery-ack", "/scheduler-recovery-resolve", "/scheduler-recovery-dismiss", "/scheduler-recovery-workflow", "/scheduler-recovery-step-done", "/scheduler-recovery-step-skip", "/scheduler-recovery-step-block", "/scheduler-recovery-workflow-cancel", "/continue-plan", "/continue-pause", "/continue-cancel"])
  if (name !== "/wake-tick-dry-run" && !medium.has(name) && !highImpact.has(name)) return fakeUnsupportedWritePreview(command, "command is not in the scheduler write preview whitelist")
  const high = highImpact.has(name)
  const requiresApproval = high || approvalRequired.has(name)
  const gate = fakeWriteGateFor(name)
  return {
    command,
    command_name: name,
    command_type: "write",
    risk: high ? "high_impact_write" : name === "/wake-tick-dry-run" || name === "/scheduler-nav-run" ? "low_risk_write" : "medium_risk_write",
    authority_gate: gate,
    equivalent_runtime_command: fakeRuntimeCommandFor(name),
    status: high ? "high_impact_blocked" : "blocked",
    can_stage_now: false,
    can_execute_now: false,
    target_kind: name === "/scheduler-recovery-workflow" ? "scheduler_recovery" : fakeTargetKindForCommand(name),
    target_id: targetId,
    parsed_args: Object.fromEntries(parts.slice(1).filter((part) => part.includes("=")).map((part) => {
      const [key, ...rest] = part.split("=")
      return [redactText(key), preview(redactText(rest.join("=")))]
    })),
    prerequisites: [
      { name: "command_recognized", satisfied: true, severity: "info", summary: "command matched the explicit write-preview whitelist" },
      { name: "active_runtime_future_gate", satisfied: false, severity: "warning", summary: "future write staging/execution would require an active runtime" },
      { name: "run_lock_future_gate", satisfied: false, severity: "warning", summary: "future write staging/execution would require the runtime run lock" },
      { name: "current_branch_support", satisfied: false, severity: "error", summary: "Branch 7T does not stage or execute write commands" },
    ],
    blockers: ["Branch 7T previews write eligibility only; can_stage_now=false and can_execute_now=false", ...(high ? ["high-impact writes are blocked from staging/execution by this preview surface"] : [])],
    warnings: ["recommended commands are informational and must be run manually"],
    safer_read_commands: [{ label: "Scheduler status", command: "/scheduler-status", command_type: "read" }, { label: "Wake tick preview", command: "/wake-tick-preview", command_type: "read" }],
    future_stage_policy: {
      would_require_active_runtime: true,
      would_require_run_lock: true,
      would_require_confirmation: true,
      would_require_approval_record: requiresApproval,
      would_require_dry_run_first: high || name === "/scheduler-start" || name === "/wake-tick",
      would_require_recent_read_evidence: true,
      allowed_in_7t: false,
    },
    redacted_summary_preview: `${high ? "high_impact_write" : "write"} ${gate} ${command}`,
  }
}

function fakeWriteStageBlockers(writePreview: WakeSchedulerNavigationWritePreviewSummary, allowMediumRisk: boolean): string[] {
  const lowAllowed = new Set(["/wake-tick-dry-run", "/scheduler-nav-run"])
  const mediumAllowed = new Set(["/checkpoint", "/scheduler-recovery-ack", "/scheduler-recovery-resolve", "/scheduler-recovery-dismiss", "/scheduler-recovery-workflow", "/scheduler-recovery-step-done", "/scheduler-recovery-step-skip", "/scheduler-recovery-step-block", "/scheduler-recovery-workflow-cancel", "/continue-plan", "/continue-pause", "/continue-cancel"])
  const blocked = new Set(["/scheduler-start", "/scheduler-stop", "/wake-tick", "/continue-step", "/handoff", "/apply", "/request-review", "/approve", "/reject", "/cancel-review", "/proposal-review", "/apply-proposal", "/cancel-proposal", "/bundle-review", "/apply-bundle", "/cancel-bundle", "/draft-review", "/cancel-draft", "/apply-target", "/apply-partial", "/complete", "/fail", "/cancel", "/api-call", "/synthesize", "/cycle"])
  const blockers: string[] = []
  if (writePreview.risk === "unsupported" || writePreview.status === "unsupported") blockers.push("unsupported write commands cannot be staged")
  if (writePreview.risk === "high_impact_write") blockers.push("high-impact write commands cannot be staged in 7U")
  if (blocked.has(writePreview.command_name)) blockers.push(`${writePreview.command_name} is not allowed in the 7U write staging whitelist`)
  if (writePreview.risk === "low_risk_write" && !lowAllowed.has(writePreview.command_name)) blockers.push(`${writePreview.command_name} is not an allowed low-risk staged write`)
  if (writePreview.risk === "medium_risk_write") {
    if (!mediumAllowed.has(writePreview.command_name)) blockers.push(`${writePreview.command_name} is not an allowed medium-risk staged write`)
    if (!allowMediumRisk) blockers.push("medium-risk write staging requires allow_medium_risk=true")
  }
  blockers.push(...writePreview.blockers.filter((blocker) => blocker !== "Branch 7T previews write eligibility only; can_stage_now=false and can_execute_now=false"))
  return [...new Set(blockers)].slice(0, 10).map(preview)
}

function fakeUnsupportedWritePreview(command: string, reason: string): WakeSchedulerNavigationWritePreviewSummary {
  return {
    command,
    command_name: command.split(/\s+/)[0] ?? "",
    command_type: "write",
    risk: "unsupported",
    authority_gate: "unknown",
    status: "unsupported",
    can_stage_now: false,
    can_execute_now: false,
    target_kind: "unknown",
    parsed_args: {},
    prerequisites: [{ name: "command_recognized", satisfied: false, severity: "error", summary: reason }],
    blockers: [reason, "unsupported commands fail closed"],
    warnings: ["path-like, unknown, and malformed commands are text only"],
    safer_read_commands: [{ label: "Scheduler navigation", command: "/scheduler-nav", command_type: "read" }],
    future_stage_policy: {
      would_require_active_runtime: true,
      would_require_run_lock: true,
      would_require_confirmation: true,
      would_require_approval_record: true,
      would_require_dry_run_first: false,
      would_require_recent_read_evidence: true,
      allowed_in_7t: false,
    },
    redacted_summary_preview: `unsupported ${command}`,
  }
}

function fakeWriteGateFor(name: string): WakeSchedulerNavigationWritePreviewSummary["authority_gate"] {
  if (name === "/scheduler-start" || name === "/scheduler-stop" || name === "/scheduler-nav-run") return "wake_scheduler_runtime"
  if (name.startsWith("/wake-tick")) return "wake_schedule_tick"
  if (name === "/checkpoint") return "checkpoint_runtime"
  if (name.startsWith("/scheduler-recovery-step") || name.startsWith("/scheduler-recovery-workflow")) return "recovery_workflow_runtime"
  if (name.startsWith("/scheduler-recovery")) return "recovery_runtime"
  if (name.startsWith("/continue")) return "continuation_runtime"
  if (name === "/handoff") return "handoff_runtime"
  if (name === "/complete" || name === "/fail" || name === "/cancel") return "mission_runtime"
  if (name === "/apply" || name === "/request-review" || name === "/approve" || name === "/reject" || name === "/cancel-review" || name === "/proposal-review" || name === "/apply-proposal" || name === "/cancel-proposal" || name === "/bundle-review" || name === "/apply-bundle" || name === "/cancel-bundle" || name === "/draft-review" || name === "/cancel-draft" || name === "/apply-target" || name === "/apply-partial") return "proposal_review_runtime"
  if (name === "/api-call" || name === "/synthesize" || name === "/cycle") return "reasoning_provider_runtime"
  return "unknown"
}

function fakeWakeSchedulerNavigationCard(label: string, command: WakeSchedulerNavigationCommandPreviewSummary, order: number): WakeSchedulerNavigationCardSummary {
  return {
    card_id: `fake-navigation-card-${order}`,
    label: preview(redactText(label)),
    command: command.command,
    command_type: command.command_type,
    risk: command.risk,
    target_kind: command.target_kind,
    target_id: command.target_id,
    supported: command.supported,
    blockers: command.blockers,
    notes: command.notes,
    recommended_order: order,
  }
}

function fakeNavigationStageBlockers(command: WakeSchedulerNavigationCommandPreviewSummary): string[] {
  const blockers: string[] = []
  if (!command.supported) blockers.push(...command.blockers)
  if (command.risk === "write_requires_operator") blockers.push("write navigation commands cannot be staged in 7Q")
  if (command.risk === "high_impact_write") blockers.push("high-impact navigation commands cannot be staged in 7Q")
  if (command.risk === "unsupported") blockers.push("unsupported navigation commands cannot be staged")
  if (command.command_type !== "read") blockers.push("only safe-read navigation commands can be staged")
  return [...new Set(blockers)].slice(0, 10)
}

function fakeNavigationStageHash(command: string): string {
  return createHash("sha256").update(command).digest("hex")
}

function fakeWriteStageHash(command: string, authorityGate: string, risk: string): string {
  return createHash("sha256").update(`${command}\n${authorityGate}\n${risk}`).digest("hex")
}

function fakeNavigationStagedRecord(staged: WakeSchedulerNavigationStagedCommandSummary): WakeSchedulerNavigationStagedCommandRecordSummary {
  return {
    staged_id: staged.staged_id,
    command: staged.command,
    risk: staged.risk,
    target_kind: staged.target_kind,
    target_id: staged.target_id,
    staged_at: staged.staged_at,
    staged_by: staged.staged_by,
    summary_preview: `${staged.risk} ${staged.target_kind}: ${staged.command}`,
    stage_hash: staged.stage_hash,
  }
}

function fakeNavigationStagedWriteRecord(staged: WakeSchedulerNavigationStagedWriteCommandSummary): WakeSchedulerNavigationStagedWriteCommandRecordSummary {
  return {
    staged_write_id: staged.staged_write_id,
    command: staged.command,
    risk: staged.risk,
    authority_gate: staged.authority_gate,
    target_kind: staged.target_kind,
    target_id: staged.target_id,
    staged_at: staged.staged_at,
    staged_by: staged.staged_by,
    summary_preview: staged.summary_preview,
    stage_hash: staged.stage_hash,
  }
}

function fakeNavigationWriteRunResult(input: {
  previewRecord: WakeSchedulerNavigationWriteRunPreviewSummary
  runId: string
  status: WakeSchedulerNavigationWriteRunResultSummary["status"]
  resultKind?: string
  resultSummary?: string
  downstreamRunId?: string
  error?: string
  requestedBy: string
  completedAt: string
}): WakeSchedulerNavigationWriteRunResultSummary {
  const resultSummary = input.resultSummary ? preview(redactText(input.resultSummary)) : undefined
  const error = input.error ? preview(redactText(input.error)) : undefined
  return {
    run_id: input.runId,
    staged_write_id: input.previewRecord.staged_write_id,
    command: input.previewRecord.command,
    command_name: input.previewRecord.command_name,
    execution_kind: input.previewRecord.execution_kind,
    risk: input.previewRecord.risk,
    authority_gate: input.previewRecord.authority_gate,
    target_kind: input.previewRecord.target_kind,
    target_id: input.previewRecord.target_id,
    status: input.status,
    result_kind: input.resultKind,
    result_summary: resultSummary,
    downstream_run_id: input.downstreamRunId,
    error,
    started_at: input.completedAt,
    completed_at: input.completedAt,
    requested_by: preview(redactText(input.requestedBy)),
    result_hash: fakeNavigationStageHash(`${input.runId}:${input.previewRecord.staged_write_id}:${input.status}:${resultSummary ?? error ?? ""}`),
  }
}

function fakeNavigationWriteRunRecord(run: WakeSchedulerNavigationWriteRunResultSummary): WakeSchedulerNavigationWriteRunRecordSummary {
  return {
    run_id: run.run_id,
    staged_write_id: run.staged_write_id,
    command: run.command,
    execution_kind: run.execution_kind,
    status: run.status,
    completed_at: run.completed_at,
    summary_preview: run.result_summary ?? run.error ?? run.command,
  }
}

function fakeNavigationCheckpointWriteRunResult(input: {
  previewRecord: WakeSchedulerNavigationCheckpointWriteRunPreviewSummary
  runId: string
  status: WakeSchedulerNavigationCheckpointWriteRunResultSummary["status"]
  checkpoint?: RuntimeCheckpointSummary
  resultKind?: string
  resultSummary?: string
  error?: string
  requestedBy: string
  completedAt: string
}): WakeSchedulerNavigationCheckpointWriteRunResultSummary {
  const resultSummary = input.resultSummary ? preview(redactText(input.resultSummary)) : undefined
  const error = input.error ? preview(redactText(input.error)) : undefined
  return {
    run_id: input.runId,
    staged_write_id: input.previewRecord.staged_write_id,
    approval_id: input.previewRecord.approval_id,
    command: input.previewRecord.command,
    command_name: input.previewRecord.command_name,
    execution_kind: input.previewRecord.execution_kind,
    risk: input.previewRecord.risk,
    authority_gate: input.previewRecord.authority_gate,
    status: input.status,
    checkpoint_id: input.checkpoint?.checkpoint_id,
    checkpoint_hash: input.checkpoint?.checkpoint_hash,
    event_count: input.checkpoint?.event_count,
    result_kind: input.resultKind,
    result_summary: resultSummary,
    error,
    started_at: input.completedAt,
    completed_at: input.completedAt,
    requested_by: preview(redactText(input.requestedBy)),
    result_hash: fakeNavigationStageHash(`${input.runId}:${input.previewRecord.staged_write_id}:${input.status}:${input.checkpoint?.checkpoint_hash ?? resultSummary ?? error ?? ""}`),
  }
}

function fakeNavigationCheckpointWriteRunRecord(run: WakeSchedulerNavigationCheckpointWriteRunResultSummary): WakeSchedulerNavigationCheckpointWriteRunRecordSummary {
  return {
    run_id: run.run_id,
    staged_write_id: run.staged_write_id,
    approval_id: run.approval_id,
    command: run.command,
    status: run.status,
    checkpoint_id: run.checkpoint_id,
    completed_at: run.completed_at,
    summary_preview: run.result_summary ?? run.error ?? run.command,
  }
}

function fakeCheckpointWriteGroup(stagedWriteId: string, runs: WakeSchedulerNavigationCheckpointWriteRunResultSummary[]): WakeSchedulerNavigationCheckpointWriteGroupSummary {
  const latest = runs[0]
  const previous = runs[1]
  const comparisonStatus = previous ? fakeCheckpointWriteComparisonStatus(previous, latest) : "first_run"
  const artifactChanged = Boolean(previous && ((previous.checkpoint_hash ?? "") !== (latest.checkpoint_hash ?? "") || (previous.event_count ?? -1) !== (latest.event_count ?? -1)))
  return {
    group_id: `fake-checkpoint-write-group-${stagedWriteId}`,
    staged_write_id: stagedWriteId,
    command: latest.command,
    command_name: latest.command_name,
    approval_ids: [...new Set(runs.map((run) => run.approval_id).filter((id): id is string => Boolean(id)))],
    run_count: runs.length,
    succeeded_count: runs.filter((run) => run.status === "succeeded").length,
    failed_count: runs.filter((run) => run.status === "failed").length,
    blocked_count: runs.filter((run) => run.status === "blocked").length,
    latest_run_id: latest.run_id,
    latest_approval_id: latest.approval_id,
    latest_checkpoint_id: latest.checkpoint_id,
    latest_checkpoint_hash: latest.checkpoint_hash,
    latest_event_count: latest.event_count,
    latest_completed_at: latest.completed_at,
    latest_status: latest.status,
    latest_outcome_hash: fakeCheckpointWriteOutcomeHash(latest),
    previous_run_id: previous?.run_id,
    previous_outcome_hash: previous ? fakeCheckpointWriteOutcomeHash(previous) : undefined,
    comparison_status: comparisonStatus,
    checkpoint_artifact_changed: artifactChanged,
    summary_preview: `${comparisonStatus} checkpoint write: ${latest.result_summary ?? latest.error ?? latest.command}`,
    recommended_commands: fakeCheckpointWriteCompareCommands(stagedWriteId, latest.run_id, latest.approval_id),
  }
}

function fakeParseCheckpointCommand(command: string): { scope?: RuntimeCheckpointScope; reason?: string; blockers: string[] } {
  const [name, scopeRaw, ...reasonParts] = command.trim().split(/\s+/)
  const blockers: string[] = []
  if (name !== "/checkpoint") blockers.push("checkpoint write executor supports /checkpoint only")
  if (!scopeRaw) blockers.push("/checkpoint requires a scope")
  let scope: RuntimeCheckpointScope | undefined
  if (scopeRaw) {
    try {
      scope = readCheckpointScope(scopeRaw)
    } catch {
      blockers.push("checkpoint scope must be one of full, commander, executor, research, handoff")
    }
  }
  return {
    scope,
    reason: reasonParts.length > 0 ? preview(redactText(reasonParts.join(" "))) : undefined,
    blockers,
  }
}

function fakeCheckpointWritePairComparison(left: WakeSchedulerNavigationCheckpointWriteRunResultSummary, right: WakeSchedulerNavigationCheckpointWriteRunResultSummary, status: WakeSchedulerNavigationCheckpointWritePairComparisonSummary["comparison_status"]): WakeSchedulerNavigationCheckpointWritePairComparisonSummary {
  return {
    comparison_id: `fake-checkpoint-write-compare-${left.run_id}-${right.run_id}`,
    staged_write_id: left.staged_write_id === right.staged_write_id ? left.staged_write_id : "mixed",
    command: left.command === right.command ? left.command : `${left.command} <> ${right.command}`,
    left_run_id: left.run_id,
    right_run_id: right.run_id,
    left_approval_id: left.approval_id,
    right_approval_id: right.approval_id,
    left_checkpoint_id: left.checkpoint_id,
    right_checkpoint_id: right.checkpoint_id,
    left_checkpoint_hash: left.checkpoint_hash,
    right_checkpoint_hash: right.checkpoint_hash,
    left_event_count: left.event_count,
    right_event_count: right.event_count,
    left_completed_at: left.completed_at,
    right_completed_at: right.completed_at,
    left_status: left.status,
    right_status: right.status,
    left_outcome_hash: fakeCheckpointWriteOutcomeHash(left),
    right_outcome_hash: fakeCheckpointWriteOutcomeHash(right),
    comparison_status: status,
    checkpoint_artifact_delta: (left.checkpoint_hash !== right.checkpoint_hash || left.event_count !== right.event_count) ? `checkpoint artifact changed hash ${left.checkpoint_hash ?? "none"} -> ${right.checkpoint_hash ?? "none"} events ${left.event_count ?? "unknown"} -> ${right.event_count ?? "unknown"}` : `checkpoint artifact unchanged hash=${right.checkpoint_hash ?? "none"} events=${right.event_count ?? "unknown"}`,
    approval_delta: left.approval_id === right.approval_id ? `same approval ${right.approval_id ?? "none"}` : `approval changed from ${left.approval_id ?? "none"} to ${right.approval_id ?? "none"}`,
    summary_delta: status === "unchanged" ? `unchanged bounded checkpoint write outcome for ${right.command}` : status === "first_run" ? `first recorded checkpoint write-run outcome for ${right.command}` : `changed bounded checkpoint write outcome for ${right.command}`,
    warnings: ["comparison uses bounded checkpoint write-run summaries; checkpoint artifacts are tracked separately"],
    recommended_commands: fakeCheckpointWriteCompareCommands(right.staged_write_id, right.run_id, right.approval_id),
  }
}

function fakeCheckpointWriteComparisonStatus(left: WakeSchedulerNavigationCheckpointWriteRunResultSummary, right: WakeSchedulerNavigationCheckpointWriteRunResultSummary): WakeSchedulerNavigationCheckpointWritePairComparisonSummary["comparison_status"] {
  if (left.status === "failed" || right.status === "failed") return fakeCheckpointWriteOutcomeHash(left) === fakeCheckpointWriteOutcomeHash(right) ? "failed" : "changed"
  if (left.status === "blocked" || right.status === "blocked") return fakeCheckpointWriteOutcomeHash(left) === fakeCheckpointWriteOutcomeHash(right) ? "blocked" : "changed"
  return fakeCheckpointWriteOutcomeHash(left) === fakeCheckpointWriteOutcomeHash(right) ? "unchanged" : "changed"
}

function fakeCheckpointWriteOutcomeHash(run: WakeSchedulerNavigationCheckpointWriteRunResultSummary): string {
  const [, checkpointScope] = run.command.trim().split(/\s+/)
  return fakeNavigationStageHash(JSON.stringify({
    command: run.command,
    command_name: run.command_name,
    execution_kind: run.execution_kind,
    risk: run.risk,
    authority_gate: run.authority_gate,
    status: run.status,
    result_kind: run.result_kind,
    result_summary: run.result_summary ? fakeCheckpointWriteNormalizedOutcomeText(run.result_summary) : undefined,
    error: run.error,
    checkpoint_scope: checkpointScope,
  }))
}

function fakeCheckpointWriteNormalizedOutcomeText(value: string): string {
  return value
    .slice(0, 1024)
    .replace(/\bcheckpoint_[A-Za-z0-9_-]+\b/g, "checkpoint_[ARTIFACT_ID]")
    .replace(/\bfake-checkpoint-[A-Za-z0-9_-]+\b/g, "checkpoint_[ARTIFACT_ID]")
    .replace(/\b[0-9a-f]{64}\b/gi, "[ARTIFACT_HASH]")
    .replace(/\bevents=\d+\b/g, "events=[ARTIFACT_EVENT_COUNT]")
}

function fakeCheckpointWriteCompareCommands(stagedWriteId: string, runId?: string, approvalId?: string) {
  const commands = [
    { label: "Preview checkpoint write", command: `/scheduler-nav-checkpoint-run-preview ${stagedWriteId}`, command_type: "read" },
    { label: "Run checkpoint write", command: `/scheduler-nav-checkpoint-run ${stagedWriteId}`, command_type: "write", requires_active_runtime: true },
    { label: "List checkpoint write runs", command: "/scheduler-nav-checkpoint-runs", command_type: "read" },
    { label: "Compare checkpoint writes", command: `/scheduler-nav-checkpoint-compare ${stagedWriteId}`, command_type: "read" },
    { label: "List write approvals", command: "/scheduler-nav-write-approvals", command_type: "read" },
  ]
  if (runId) commands.push({ label: "Show checkpoint write run", command: `/scheduler-nav-checkpoint-run-show ${runId}`, command_type: "read" })
  if (approvalId) commands.push({ label: "Show write approval", command: `/scheduler-nav-write-approval-show ${approvalId}`, command_type: "read" })
  return commands
}

function fakeWriteRunPairComparison(left: WakeSchedulerNavigationWriteRunResultSummary, right: WakeSchedulerNavigationWriteRunResultSummary, status: WakeSchedulerNavigationWriteRunPairComparisonSummary["comparison_status"]): WakeSchedulerNavigationWriteRunPairComparisonSummary {
  return {
    comparison_id: `fake-write-run-compare-${left.run_id}-${right.run_id}`,
    staged_write_id: left.staged_write_id === right.staged_write_id ? left.staged_write_id : "mixed",
    command: left.command === right.command ? left.command : `${left.command} <> ${right.command}`,
    left_run_id: left.run_id,
    right_run_id: right.run_id,
    left_completed_at: left.completed_at,
    right_completed_at: right.completed_at,
    left_status: left.status,
    right_status: right.status,
    left_outcome_hash: fakeWriteRunOutcomeHash(left),
    right_outcome_hash: fakeWriteRunOutcomeHash(right),
    comparison_status: status,
    summary_delta: status === "unchanged" ? `unchanged bounded outcome for ${right.command}` : status === "first_run" ? `first recorded terminal write-run outcome for ${right.command}` : `changed bounded outcome for ${right.command}`,
    downstream_delta: left.downstream_run_id || right.downstream_run_id ? `downstream staged-read link changed from ${left.downstream_run_id ?? "none"} to ${right.downstream_run_id ?? "none"}` : undefined,
    warnings: ["comparison uses bounded write-run result summaries, not raw results"],
    recommended_commands: fakeWriteRunCompareCommands(right.staged_write_id, right.run_id),
  }
}

function fakeWriteRunComparisonStatus(left: WakeSchedulerNavigationWriteRunResultSummary, right: WakeSchedulerNavigationWriteRunResultSummary): WakeSchedulerNavigationWriteRunPairComparisonSummary["comparison_status"] {
  if (left.status === "failed" || right.status === "failed") return fakeWriteRunOutcomeHash(left) === fakeWriteRunOutcomeHash(right) ? "failed" : "changed"
  if (left.status === "blocked" || right.status === "blocked") return fakeWriteRunOutcomeHash(left) === fakeWriteRunOutcomeHash(right) ? "blocked" : "changed"
  return fakeWriteRunOutcomeHash(left) === fakeWriteRunOutcomeHash(right) ? "unchanged" : "changed"
}

function fakeWriteRunOutcomeHash(run: WakeSchedulerNavigationWriteRunResultSummary): string {
  return fakeNavigationStageHash(JSON.stringify({
    command: run.command,
    command_name: run.command_name,
    execution_kind: run.execution_kind,
    risk: run.risk,
    authority_gate: run.authority_gate,
    target_kind: run.target_kind,
    target_id: run.target_id,
    status: run.status,
    result_kind: run.result_kind,
    result_summary: run.result_summary,
    error: run.error,
  }))
}

function fakeWriteRunCompareCommands(stagedWriteId: string, runId?: string) {
  const commands = [
    { label: "Preview staged write", command: `/scheduler-nav-write-run-preview ${stagedWriteId}`, command_type: "read" },
    { label: "Run staged write", command: `/scheduler-nav-write-run ${stagedWriteId}`, command_type: "write", requires_active_runtime: true },
    { label: "List write runs", command: "/scheduler-nav-write-runs", command_type: "read" },
    { label: "List staged writes", command: "/scheduler-nav-write-staged", command_type: "read" },
    { label: "Compare write runs", command: `/scheduler-nav-write-run-compare ${stagedWriteId}`, command_type: "read" },
  ]
  if (runId) commands.push({ label: "Show latest write run", command: `/scheduler-nav-write-run-show ${runId}`, command_type: "read" })
  return commands
}

function fakeNavigationWriteApproval(readiness: WakeSchedulerNavigationWriteReadinessPreviewSummary, status: "approved" | "rejected", reason: string, requestedBy: string): WakeSchedulerNavigationWriteApprovalSummary {
  const approvalHash = fakeNavigationStageHash(`${readiness.staged_write_id}:${status}:${readiness.command}:${preview(redactText(reason))}`)
  return {
    approval_id: `fake-write-approval-${fakeNavigationStageHash(`${readiness.staged_write_id}:${status}`).slice(0, 16)}`,
    staged_write_id: readiness.staged_write_id,
    command: readiness.command,
    command_name: readiness.command_name,
    risk: readiness.risk,
    authority_gate: readiness.authority_gate,
    target_kind: readiness.target_kind,
    target_id: readiness.target_id,
    status,
    approved_at: status === "approved" ? new Date(0).toISOString() : undefined,
    rejected_at: status === "rejected" ? new Date(0).toISOString() : undefined,
    updated_at: new Date(0).toISOString(),
    requested_by: preview(redactText(requestedBy)),
    reason: reason ? preview(redactText(reason)) : undefined,
    evidence: [...readiness.required_evidence, ...readiness.optional_evidence],
    approval_hash: approvalHash,
    expires_at: status === "approved" ? new Date(24 * 60 * 60 * 1000).toISOString() : undefined,
    summary_preview: `${status} ${readiness.command}`,
  }
}

function fakeNavigationWriteApprovalRecord(approval: WakeSchedulerNavigationWriteApprovalSummary): WakeSchedulerNavigationWriteApprovalRecordSummary {
  return {
    approval_id: approval.approval_id,
    staged_write_id: approval.staged_write_id,
    command: approval.command,
    risk: approval.risk,
    authority_gate: approval.authority_gate,
    status: approval.status,
    updated_at: approval.updated_at,
    summary_preview: approval.summary_preview,
    approval_hash: approval.approval_hash,
  }
}

function fakeLowRiskWriteRunShapeBlockers(command: string, commandName: string): string[] {
  const [name, ...args] = command.trim().split(/\s+/)
  if (commandName === "/wake-tick-dry-run" || name === "/wake-tick-dry-run") {
    return args.length === 0 ? [] : ["/wake-tick-dry-run does not accept staged execution arguments"]
  }
  if (commandName === "/scheduler-nav-run" || name === "/scheduler-nav-run") {
    return args.length === 1 && Boolean(args[0]?.trim()) ? [] : ["/scheduler-nav-run requires exactly one staged read id"]
  }
  return []
}

function fakeStagedReadSummary(command: string): string {
  if (command === "/scheduler-status") return "scheduler_status: status=stopped"
  if (command === "/scheduler-audit-summary") return "scheduler_audit_summary: event_count=0"
  if (command.startsWith("/scheduler")) return `scheduler_read: ${command}`
  return `fake_read_result: ${command}`
}

function fakeStagedReadRunRecord(run: WakeSchedulerNavigationStagedRunResultSummary): WakeSchedulerNavigationStagedRunRecordSummary {
  return {
    run_id: run.run_id,
    staged_id: run.staged_id,
    command: run.command,
    target_kind: run.target_kind,
    status: run.status,
    completed_at: run.completed_at,
    summary_preview: run.result_summary ?? run.error ?? run.command,
  }
}

function fakePairComparison(left: WakeSchedulerNavigationStagedRunResultSummary, right: WakeSchedulerNavigationStagedRunResultSummary, status: WakeSchedulerNavigationStagedReadPairComparisonSummary["comparison_status"]): WakeSchedulerNavigationStagedReadPairComparisonSummary {
  return {
    comparison_id: `fake-staged-read-compare-${fakeNavigationStageHash(`${left.run_id}:${right.run_id}`).slice(0, 16)}`,
    staged_id: left.staged_id === right.staged_id ? left.staged_id : "mixed",
    command: left.command === right.command ? left.command : `${left.command} <> ${right.command}`,
    left_run_id: left.run_id,
    right_run_id: right.run_id,
    left_completed_at: left.completed_at,
    right_completed_at: right.completed_at,
    left_status: left.status,
    right_status: right.status,
    left_comparison_hash: fakeStableComparisonHash(left),
    right_comparison_hash: fakeStableComparisonHash(right),
    comparison_status: status,
    summary_delta: status === "unchanged" ? `unchanged bounded result for ${right.command}` : status === "first_run" ? `first recorded terminal result for ${right.command}` : `changed bounded result for ${right.command}`,
    warnings: ["comparison uses bounded staged-read result summaries, not raw results"],
    recommended_commands: fakeCompareCommands(right.staged_id, right.run_id),
  }
}

function fakeComparisonStatus(left: WakeSchedulerNavigationStagedRunResultSummary, right: WakeSchedulerNavigationStagedRunResultSummary): WakeSchedulerNavigationStagedReadPairComparisonSummary["comparison_status"] {
  if (left.status === "failed" || right.status === "failed") return fakeStableComparisonHash(left) === fakeStableComparisonHash(right) ? "failed" : "changed"
  if (left.status === "blocked" || right.status === "blocked") return fakeStableComparisonHash(left) === fakeStableComparisonHash(right) ? "blocked" : "changed"
  return fakeStableComparisonHash(left) === fakeStableComparisonHash(right) ? "unchanged" : "changed"
}

function fakeStableComparisonHash(run: WakeSchedulerNavigationStagedRunResultSummary): string {
  return fakeNavigationStageHash(JSON.stringify({
    command: run.command,
    target_kind: run.target_kind,
    target_id: run.target_id,
    status: run.status,
    result_kind: run.result_kind,
    result_summary: run.result_summary,
    error: run.error,
  }))
}

function fakeCompareCommands(stagedId: string, runId?: string) {
  const commands = [
    { label: "Preview staged read", command: `/scheduler-nav-run-preview ${stagedId}`, command_type: "read" as const, notes: "read-only execution eligibility preview" },
    { label: "Run staged read", command: `/scheduler-nav-run ${stagedId}`, command_type: "write" as const, requires_active_runtime: true, notes: "explicit one-command safe-read execution path" },
    { label: "List staged read runs", command: "/scheduler-nav-runs", command_type: "read" as const },
    { label: "Compare staged reads", command: `/scheduler-nav-read-compare ${stagedId}`, command_type: "read" as const },
  ]
  if (runId) commands.push({ label: "Show latest run", command: `/scheduler-nav-run-show ${runId}`, command_type: "read" as const })
  return commands
}

function fakeTargetKindForCommand(name: string): WakeSchedulerNavigationTargetKindSummary {
  if (name.startsWith("/scheduler-audit")) return "scheduler_audit"
  if (name === "/scheduler-nav-staged") return "scheduler_audit"
  if (name.startsWith("/scheduler-bootstrap")) return "scheduler_bootstrap"
  if (name.startsWith("/scheduler-recovery-workflow") || name.startsWith("/scheduler-recovery-step")) return "scheduler_recovery_workflow"
  if (name.startsWith("/scheduler-recovery")) return "scheduler_recovery"
  if (name.startsWith("/scheduler")) return "scheduler_status"
  if (name.startsWith("/wake-tick")) return "wake_tick"
  if (name === "/wake-schedules" || name === "/wake-schedule") return "wake_schedule"
  if (name === "/wake-preview" || name === "/wake-show") return "wake_assessment"
  if (name.startsWith("/continue")) return "continuation_plan"
  if (name.startsWith("/checkpoint")) return "checkpoint"
  if (name.startsWith("/resume")) return "resume_anchor"
  if (name.startsWith("/handoff")) return "handoff_followup"
  if (name.startsWith("/mission")) return "mission"
  return "unknown"
}

function fakeRuntimeCommandFor(name: string): string | undefined {
  const map: Record<string, string> = {
    "/scheduler-status": "runtime.wake_scheduler_status",
    "/scheduler-bootstrap": "runtime.wake_scheduler_bootstrap_status",
    "/scheduler-recovery": "runtime.preview_wake_scheduler_recovery",
    "/scheduler-audit": "runtime.wake_scheduler_audit_timeline",
    "/scheduler-audit-summary": "runtime.wake_scheduler_audit_summary",
    "/scheduler-audit-chain": "runtime.wake_scheduler_audit_chain",
    "/scheduler-audit-incidents": "runtime.wake_scheduler_audit_incidents",
    "/scheduler-nav-staged": "runtime.list_wake_scheduler_navigation_staged_commands",
  }
  return map[name]
}

function fakeNavigationTargetKind(value: string): WakeSchedulerNavigationTargetKindSummary {
  const aliases: Record<string, WakeSchedulerNavigationTargetKindSummary> = { recovery: "scheduler_recovery", workflow: "scheduler_recovery_workflow", schedule: "wake_schedule", wake: "wake_assessment", continuation: "continuation_plan", resume: "resume_anchor", handoff: "handoff_followup" }
  return aliases[value] ?? value
}

function fakeCommandAuthoritySummary(): CommandAuthoritySummaryState {
  const records = fakeCommandAuthorityRecords()
  const risks = fakeCountBy(records, "risk")
  const gates = fakeCountBy(records, "gate")
  const owners = fakeCountBy(records, "owner")
  return {
    total_records: records.length,
    risks,
    gates,
    owners,
    mutating_count: records.filter((record) => record.mutates_events).length,
    high_impact_count: records.filter((record) => record.risk === "high_impact_write").length,
    approval_required_count: records.filter((record) => record.requires_approval).length,
    generated_at: new Date(0).toISOString(),
  }
}

function recordFromCommanderExecutorReview(result: CommanderExecutorReviewResultSummary): CommanderExecutorReviewRecordSummary {
  return {
    review_id: result.review_id,
    packet_id: result.packet_id,
    status: result.status,
    decision: result.decision,
    confidence: result.confidence,
    completed_at: result.completed_at,
    summary_preview: result.summary,
    review_hash: result.review_hash,
    handoff_id: result.handoff_id,
    mission_id: result.mission_id,
    result_id: result.result_id,
  }
}

function recordFromExecutorReviewProposalCreate(result: ExecutorReviewProposalCreateResultSummary): ExecutorReviewProposalCreateRecordSummary {
  return {
    create_id: result.create_id,
    status: result.status,
    proposal_id: result.proposal_id,
    review_id: result.review_id,
    draft_id: result.draft_id,
    draft_kind: result.draft_kind,
    created_at: result.created_at,
    summary_preview: result.summary_preview,
    create_hash: result.create_hash,
  }
}

function recordFromExecutorReviewProposalReviewRequest(result: ExecutorReviewProposalReviewRequestResultSummary): ExecutorReviewProposalReviewRequestRecordSummary {
  return {
    request_gate_id: result.request_gate_id,
    status: result.status,
    review_request_id: result.review_request_id,
    proposal_id: result.proposal_id,
    create_id: result.create_id,
    review_id: result.review_id,
    draft_id: result.draft_id,
    requested_at: result.requested_at,
    summary_preview: result.error ?? result.proposal_id,
    request_hash: result.request_hash,
  }
}

function recordFromExecutorReviewProposalReviewDecision(result: ExecutorReviewProposalReviewDecisionResultSummary): ExecutorReviewProposalReviewDecisionRecordSummary {
  return {
    decision_gate_id: result.decision_gate_id,
    status: result.status,
    decision: result.decision,
    review_request_id: result.review_request_id,
    proposal_id: result.proposal_id,
    request_gate_id: result.request_gate_id,
    create_id: result.create_id,
    decided_at: result.decided_at,
    summary_preview: result.error ?? result.proposal_id ?? result.review_request_id,
    decision_hash: result.decision_hash,
  }
}

function recordFromExecutorReviewProposalApplyReadiness(previewResult: ExecutorReviewProposalApplyReadinessPreviewSummary): ExecutorReviewProposalApplyReadinessRecordSummary {
  return {
    readiness_id: previewResult.readiness_id,
    status: previewResult.status,
    proposal_id: previewResult.proposal_id,
    review_request_id: previewResult.review_request_id,
    decision_gate_id: previewResult.decision_gate_id,
    create_id: previewResult.create_id,
    candidate_kind: previewResult.candidate_kind,
    candidate_risk: previewResult.candidate_risk,
    generated_at: previewResult.generated_at,
    summary_preview: previewResult.redacted_summary_preview || previewResult.proposal_summary_preview,
  }
}

function fakeApplyCandidateKind(proposal: CommanderProposalSummary | undefined): string {
  if (!proposal) return "generic"
  if (proposal.action_kind === "record_progress") return "mission_progress"
  if (proposal.action_kind === "submit_result") return "mission_result"
  if (proposal.action_kind === "operator_checkpoint") return "checkpoint"
  if (proposal.action_kind !== "other") return "manual_action"
  const payload = isRecord(proposal.action_payload) ? proposal.action_payload : {}
  const draftKind = optionalString(payload.draft_kind)
  if (draftKind === "mission_result") return "mission_result"
  if (draftKind === "mission_progress") return "mission_progress"
  if (draftKind === "followup_task") return "followup_task"
  if (draftKind === "human_review") return "human_review"
  if (draftKind === "checkpoint") return "checkpoint"
  if (draftKind === "blocked_followup") return "blocked_followup"
  return "generic"
}

function fakeApplyCandidateRisk(kind: string, sourceRisk?: string): "low" | "medium" | "high" {
  if (kind === "unsupported" || kind === "mission_result" || sourceRisk === "high") return "high"
  if (sourceRisk === "low") return "low"
  return "medium"
}

function fakeApplyReadinessStatusSummary(status: string): string {
  if (status === "ready") return "Proposal is ready for future apply inspection."
  if (status === "needs_review") return "Proposal still needs an 8I review request and 8J approved decision."
  if (status === "rejected") return "Proposal review decision is rejected."
  if (status === "blocked") return "Proposal apply readiness is blocked."
  return "Apply readiness target is unknown."
}

function fakeCommandAuthorityRecords(): CommandAuthorityRecordSummary[] {
  return [
    fakeCommandAuthorityRecord("/authority", "runtime.command_authority_summary", "safe_read", "none", "runtime_status", { targeted: ["tests/e2e_user/scenarios/test_command_authority_inventory_tui.py"] }),
    fakeCommandAuthorityRecord("/status", "runtime.status", "safe_read", "none", "runtime_status", { targeted: ["tests/e2e_user/scenarios/test_spec_onboarding_tui.py"] }),
    fakeCommandAuthorityRecord("/scheduler-nav-checkpoint-run", "runtime.execute_wake_scheduler_navigation_checkpoint_write_run", "medium_risk_write", "checkpoint_runtime", "scheduler_navigation_checkpoint_write", {
      mutates: true,
      active: true,
      lock: true,
      approval: true,
      approvalSurface: "/scheduler-nav-write-approve",
      executionSurface: "checkpoint_create",
      events: ["runtime_wake_scheduler_navigation_checkpoint_write_run_started", "runtime_wake_scheduler_navigation_checkpoint_write_run_succeeded", "runtime_checkpoint_created"],
      reads: ["/scheduler-nav-checkpoint-run-preview", "/scheduler-nav-checkpoint-runs"],
      targeted: ["tests/e2e_user/scenarios/test_wake_scheduler_navigation_checkpoint_write_tui.py"],
    }),
    fakeCommandAuthorityRecord("/scheduler-nav-checkpoint-history", "runtime.wake_scheduler_navigation_checkpoint_write_history", "safe_read", "none", "scheduler_navigation_checkpoint_compare", { targeted: ["tests/e2e_user/scenarios/test_wake_scheduler_navigation_checkpoint_write_compare_tui.py"] }),
    fakeCommandAuthorityRecord("/wake-tick", "runtime.execute_wake_schedule_tick", "high_impact_write", "wake_schedule_tick", "wake_schedule", {
      mutates: true,
      active: true,
      lock: true,
      events: ["runtime_wake_schedule_tick_completed"],
      reads: ["/wake-tick-preview", "/wake-tick-dry-run"],
      targeted: ["tests/e2e_user/scenarios/test_wake_schedule_tui.py"],
      out: ["real wake tick execution"],
    }),
    fakeCommandAuthorityRecord("/handoff", "runtime.execute_opencode_handoff", "high_impact_write", "handoff_runtime", "opencode_handoff", {
      mutates: true,
      active: true,
      lock: true,
      process: true,
      events: ["runtime_opencode_handoff_started", "runtime_opencode_handoff_succeeded"],
      reads: ["/handoff-preview", "/handoff-followups"],
      targeted: ["tests/e2e_user/scenarios/test_opencode_handoff_tui.py", "tests/e2e_user/scenarios/test_opencode_handoff_followup_tui.py"],
      out: ["OpenCode process launch"],
    }),
    fakeCommandAuthorityRecord("/opencode-smoke", "runtime.execute_opencode_process_smoke", "low_risk_write", "opencode_runtime", "opencode_handoff", {
      mutates: true,
      active: true,
      lock: true,
      process: true,
      blocked: true,
      events: ["opencode_process_smoke_started", "opencode_process_smoke_succeeded", "opencode_process_smoke_failed", "opencode_process_smoke_blocked"],
      reads: ["/opencode-smoke-preview", "/opencode-smokes"],
      targeted: ["tests/e2e_user/scenarios/test_opencode_process_smoke_tui.py"],
      aliases: ["/opencode-process-smoke", "/opencode-health-smoke"],
      out: ["mission mutation", "proposal mutation", "review mutation", "MiniMax live provider calls"],
    }),
    fakeCommandAuthorityRecord("/handoff-readiness", "runtime.preview_opencode_handoff_readiness", "safe_read", "handoff_runtime", "opencode_handoff", {
      reads: ["/authority-show /handoff", "/opencode-smoke-preview", "/handoff-followups"],
      targeted: ["tests/e2e_user/scenarios/test_opencode_handoff_readiness_tui.py"],
      aliases: ["/opencode-handoff-readiness", "/handoff-ready"],
      notes: ["Read-only OpenCode handoff readiness diagnostics; does not launch OpenCode or execute handoff."],
      out: ["OpenCode launch", "handoff execution", "mission mutation", "proposal mutation", "review mutation"],
    }),
    fakeCommandAuthorityRecord("/handoff-readiness-summary", "runtime.opencode_handoff_readiness_summary", "safe_read", "handoff_runtime", "opencode_handoff", {
      reads: ["/handoff-readiness", "/authority-show /handoff", "/opencode-smokes"],
      targeted: ["tests/e2e_user/scenarios/test_opencode_handoff_readiness_tui.py"],
      notes: ["Read-only OpenCode handoff readiness summary; does not launch OpenCode or execute handoff."],
      out: ["OpenCode launch", "handoff execution", "mission mutation", "proposal mutation", "review mutation"],
    }),
    fakeCommandAuthorityRecord("/result-review-packet", "runtime.preview_opencode_result_review_packet", "safe_read", "handoff_runtime", "opencode_handoff", {
      reads: ["/handoff-followups", "/handoff-readiness", "/authority-show /handoff"],
      targeted: ["tests/e2e_user/scenarios/test_opencode_result_review_packet_tui.py"],
      aliases: ["/opencode-result-review", "/executor-result-review", "/handoff-result-review"],
      notes: ["Read-only OpenCode result review packet; does not call Commander, providers, handoff execution, or OpenCode."],
      out: ["OpenCode launch", "handoff execution", "provider calls", "mission mutation", "proposal mutation", "review mutation"],
    }),
    fakeCommandAuthorityRecord("/result-review-summary", "runtime.opencode_result_review_summary", "safe_read", "handoff_runtime", "opencode_handoff", {
      reads: ["/result-review-packet", "/handoff-followups", "/handoff-readiness"],
      targeted: ["tests/e2e_user/scenarios/test_opencode_result_review_packet_tui.py"],
      notes: ["Read-only OpenCode result review summary; does not mutate executor or commander state."],
      out: ["OpenCode launch", "handoff execution", "provider calls", "mission mutation", "proposal mutation", "review mutation"],
    }),
    fakeCommandAuthorityRecord("/executor-review-preview", "runtime.preview_commander_executor_review", "safe_read", "reasoning_provider_runtime", "commander_cycle", {
      reads: ["/result-review-packet", "/authority-show /executor-review"],
      targeted: ["tests/e2e_user/scenarios/test_commander_executor_review_tui.py"],
      aliases: ["/commander-executor-review-preview"],
      notes: ["Read-only Commander executor review preview; does not call provider."],
      out: ["proposal creation", "proposal apply", "OpenCode launch", "handoff execution"],
    }),
    fakeCommandAuthorityRecord("/executor-review-dry-run", "runtime.execute_commander_executor_review", "safe_read", "reasoning_provider_runtime", "commander_cycle", {
      reads: ["/executor-review-preview", "/result-review-packet"],
      targeted: ["tests/e2e_user/scenarios/test_commander_executor_review_tui.py"],
      notes: ["Dry-run does not call provider and appends no review events."],
      out: ["provider calls", "proposal creation", "OpenCode launch"],
    }),
    fakeCommandAuthorityRecord("/executor-review", "runtime.execute_commander_executor_review", "high_impact_write", "reasoning_provider_runtime", "commander_cycle", {
      mutates: true,
      active: true,
      lock: true,
      events: ["commander_executor_review_started", "commander_executor_review_succeeded", "commander_executor_review_failed", "commander_executor_review_blocked"],
      reads: ["/executor-review-preview", "/executor-reviews", "/result-review-packet"],
      targeted: ["tests/e2e_user/scenarios/test_commander_executor_review_tui.py"],
      aliases: ["/commander-executor-review"],
      notes: ["Calls Commander executor review provider once and writes bounded review artifacts only; does not create proposals."],
      out: ["proposal creation", "proposal apply", "OpenCode launch", "handoff execution", "mission mutation"],
    }),
    fakeCommandAuthorityRecord("/executor-reviews", "runtime.list_commander_executor_reviews", "safe_read", "none", "commander_cycle", {
      reads: ["/executor-review-show"],
      targeted: ["tests/e2e_user/scenarios/test_commander_executor_review_tui.py"],
      aliases: ["/commander-executor-reviews"],
    }),
    fakeCommandAuthorityRecord("/executor-review-show", "runtime.get_commander_executor_review", "safe_read", "none", "commander_cycle", {
      reads: ["/executor-reviews"],
      targeted: ["tests/e2e_user/scenarios/test_commander_executor_review_tui.py"],
    }),
    fakeCommandAuthorityRecord("/executor-review-draft-preview", "runtime.preview_executor_review_proposal_drafts", "safe_read", "none", "commander_cycle", {
      reads: ["/executor-review-show", "/executor-reviews", "/result-review-packet"],
      targeted: ["tests/e2e_user/scenarios/test_executor_review_proposal_draft_tui.py"],
      aliases: ["/executor-review-drafts", "/commander-executor-draft-preview", "/commander-executor-drafts"],
      notes: ["Read-only executor-review proposal draft preview; does not create proposals, call providers, or mutate missions."],
      out: ["proposal creation", "review request", "proposal apply", "provider calls", "OpenCode launch", "mission mutation"],
    }),
    fakeCommandAuthorityRecord("/executor-review-draft-summary", "runtime.executor_review_proposal_draft_summary", "safe_read", "none", "commander_cycle", {
      reads: ["/executor-review-draft-preview", "/executor-reviews"],
      targeted: ["tests/e2e_user/scenarios/test_executor_review_proposal_draft_tui.py"],
      notes: ["Read-only executor-review proposal draft summary; no proposal registry writes."],
      out: ["proposal creation", "review request", "proposal apply", "provider calls", "OpenCode launch", "mission mutation"],
    }),
    fakeCommandAuthorityRecord("/executor-review-proposal-create-preview", "runtime.preview_executor_review_proposal_create", "safe_read", "none", "proposal", {
      reads: ["/executor-review-draft-preview", "/executor-review-show"],
      targeted: ["tests/e2e_user/scenarios/test_executor_review_proposal_create_tui.py"],
      notes: ["Read-only preview for converting one executor-review draft into one Commander proposal."],
      out: ["proposal creation", "review request", "proposal apply", "provider calls", "OpenCode launch", "mission mutation"],
    }),
    fakeCommandAuthorityRecord("/executor-review-proposal-create", "runtime.create_executor_review_proposal", "high_impact_write", "proposal_review_runtime", "proposal", {
      mutates: true,
      active: true,
      lock: true,
      events: ["commander_proposal_created", "commander_executor_review_proposal_created"],
      reads: ["/executor-review-proposal-create-preview", "/executor-review-proposal-creates", "/proposals"],
      targeted: ["tests/e2e_user/scenarios/test_executor_review_proposal_create_tui.py"],
      aliases: ["/executor-draft-create", "/commander-executor-proposal-create"],
      notes: ["Creates exactly one proposed Commander proposal from one selected executor-review draft; does not request review or apply."],
      out: ["review request", "proposal apply", "provider calls", "OpenCode launch", "mission mutation"],
    }),
    fakeCommandAuthorityRecord("/executor-review-proposal-create-dry-run", "runtime.create_executor_review_proposal", "safe_read", "proposal_review_runtime", "proposal", {
      reads: ["/executor-review-proposal-create-preview"],
      targeted: ["tests/e2e_user/scenarios/test_executor_review_proposal_create_tui.py"],
      notes: ["Dry-run proposal creation appends no events and creates no proposal."],
      out: ["proposal creation", "review request", "proposal apply", "provider calls", "OpenCode launch", "mission mutation"],
    }),
    fakeCommandAuthorityRecord("/executor-review-proposal-creates", "runtime.list_executor_review_proposal_creates", "safe_read", "none", "proposal", {
      reads: ["/executor-review-proposal-create-show"],
      targeted: ["tests/e2e_user/scenarios/test_executor_review_proposal_create_tui.py"],
    }),
    fakeCommandAuthorityRecord("/executor-review-proposal-create-show", "runtime.get_executor_review_proposal_create", "safe_read", "none", "proposal", {
      reads: ["/executor-review-proposal-creates"],
      targeted: ["tests/e2e_user/scenarios/test_executor_review_proposal_create_tui.py"],
    }),
    fakeCommandAuthorityRecord("/executor-review-proposal-review-preview", "runtime.preview_executor_review_proposal_review_request", "safe_read", "none", "review", {
      reads: ["/executor-review-proposal-create-show", "/proposal"],
      targeted: ["tests/e2e_user/scenarios/test_executor_review_proposal_review_request_tui.py"],
      aliases: ["/executor-draft-review-preview"],
      notes: ["Read-only preview for requesting review on one executor-review-created proposal."],
      out: ["review approval", "review rejection", "proposal apply", "provider calls", "OpenCode launch", "mission mutation"],
    }),
    fakeCommandAuthorityRecord("/executor-review-proposal-review-request", "runtime.request_executor_review_proposal_review", "high_impact_write", "proposal_review_runtime", "review", {
      mutates: true,
      active: true,
      lock: true,
      events: ["review_request_created", "commander_proposal_review_requested", "commander_executor_review_proposal_review_requested"],
      reads: ["/executor-review-proposal-review-preview", "/executor-review-proposal-review-requests", "/reviews"],
      targeted: ["tests/e2e_user/scenarios/test_executor_review_proposal_review_request_tui.py"],
      aliases: ["/executor-draft-review-request", "/commander-executor-proposal-review-request"],
      notes: ["Creates exactly one review request for one executor-review-created proposal; does not approve, reject, apply, or mutate missions."],
      out: ["review approval", "review rejection", "proposal apply", "provider calls", "OpenCode launch", "mission mutation"],
    }),
    fakeCommandAuthorityRecord("/executor-review-proposal-review-dry-run", "runtime.request_executor_review_proposal_review", "safe_read", "proposal_review_runtime", "review", {
      reads: ["/executor-review-proposal-review-preview"],
      targeted: ["tests/e2e_user/scenarios/test_executor_review_proposal_review_request_tui.py"],
      notes: ["Dry-run review-request creation appends no events and creates no review request."],
      out: ["review request creation", "review approval", "proposal apply", "provider calls", "OpenCode launch", "mission mutation"],
    }),
    fakeCommandAuthorityRecord("/executor-review-proposal-review-requests", "runtime.list_executor_review_proposal_review_requests", "safe_read", "none", "review", {
      reads: ["/executor-review-proposal-review-show"],
      targeted: ["tests/e2e_user/scenarios/test_executor_review_proposal_review_request_tui.py"],
    }),
    fakeCommandAuthorityRecord("/executor-review-proposal-review-show", "runtime.get_executor_review_proposal_review_request", "safe_read", "none", "review", {
      reads: ["/executor-review-proposal-review-requests"],
      targeted: ["tests/e2e_user/scenarios/test_executor_review_proposal_review_request_tui.py"],
    }),
    fakeCommandAuthorityRecord("/executor-review-proposal-review-decision-preview", "runtime.preview_executor_review_proposal_review_decision", "safe_read", "none", "review", {
      reads: ["/executor-review-proposal-review-requests", "/reviews"],
      targeted: ["tests/e2e_user/scenarios/test_executor_review_proposal_review_decision_tui.py"],
      notes: ["Read-only preview for approving or rejecting one 8I-created review request."],
      out: ["review approval", "review rejection", "proposal apply", "provider calls", "OpenCode launch", "mission mutation"],
    }),
    fakeCommandAuthorityRecord("/executor-review-proposal-review-approve", "runtime.decide_executor_review_proposal_review", "high_impact_write", "proposal_review_runtime", "review", {
      mutates: true,
      active: true,
      lock: true,
      events: ["review_request_approved", "commander_proposal_approved", "commander_executor_review_proposal_review_approved"],
      reads: ["/executor-review-proposal-review-decision-preview", "/executor-review-proposal-review-decisions", "/reviews"],
      targeted: ["tests/e2e_user/scenarios/test_executor_review_proposal_review_decision_tui.py"],
      aliases: ["/executor-draft-review-approve", "/commander-executor-proposal-review-approve"],
      notes: ["Approves exactly one 8I-created review request. It does not apply proposals, mutate missions, call providers, or launch OpenCode."],
      out: ["proposal apply", "mission mutation", "provider calls", "OpenCode launch"],
    }),
    fakeCommandAuthorityRecord("/executor-review-proposal-review-reject", "runtime.decide_executor_review_proposal_review", "high_impact_write", "proposal_review_runtime", "review", {
      mutates: true,
      active: true,
      lock: true,
      events: ["review_request_rejected", "commander_proposal_rejected", "commander_executor_review_proposal_review_rejected"],
      reads: ["/executor-review-proposal-review-decision-preview", "/executor-review-proposal-review-decisions", "/reviews"],
      targeted: ["tests/e2e_user/scenarios/test_executor_review_proposal_review_decision_tui.py"],
      aliases: ["/executor-draft-review-reject", "/commander-executor-proposal-review-reject"],
      notes: ["Rejects exactly one 8I-created review request. It does not apply proposals, mutate missions, call providers, or launch OpenCode."],
      out: ["proposal apply", "mission mutation", "provider calls", "OpenCode launch"],
    }),
    fakeCommandAuthorityRecord("/executor-review-proposal-review-decision-dry-run", "runtime.decide_executor_review_proposal_review", "safe_read", "proposal_review_runtime", "review", {
      reads: ["/executor-review-proposal-review-decision-preview"],
      targeted: ["tests/e2e_user/scenarios/test_executor_review_proposal_review_decision_tui.py"],
      notes: ["Dry-run review decision appends no events and does not approve or reject."],
      out: ["review approval", "review rejection", "proposal apply", "provider calls", "OpenCode launch", "mission mutation"],
    }),
    fakeCommandAuthorityRecord("/executor-review-proposal-review-decisions", "runtime.list_executor_review_proposal_review_decisions", "safe_read", "none", "review", {
      reads: ["/executor-review-proposal-review-decision-show"],
      targeted: ["tests/e2e_user/scenarios/test_executor_review_proposal_review_decision_tui.py"],
    }),
    fakeCommandAuthorityRecord("/executor-review-proposal-review-decision-show", "runtime.get_executor_review_proposal_review_decision", "safe_read", "none", "review", {
      reads: ["/executor-review-proposal-review-decisions"],
      targeted: ["tests/e2e_user/scenarios/test_executor_review_proposal_review_decision_tui.py"],
    }),
    fakeCommandAuthorityRecord("/executor-review-proposal-apply-readiness", "runtime.preview_executor_review_proposal_apply_readiness", "safe_read", "none", "commander_apply", {
      reads: ["/proposal", "/executor-review-proposal-review-decisions", "/executor-review-proposal-create-show"],
      targeted: ["tests/e2e_user/scenarios/test_executor_review_proposal_apply_readiness_tui.py"],
      aliases: ["/executor-draft-apply-readiness", "/commander-executor-proposal-apply-readiness", "/proposal-apply-readiness"],
      notes: ["Read-only apply-readiness projection for 8H/8I/8J-approved executor-review proposals. It does not apply proposals or mutate missions."],
      out: ["proposal apply", "mission mutation", "provider calls", "OpenCode launch"],
    }),
    fakeCommandAuthorityRecord("/executor-review-proposal-apply-readiness-summary", "runtime.executor_review_proposal_apply_readiness_summary", "safe_read", "none", "commander_apply", {
      reads: ["/executor-review-proposal-apply-readiness-list"],
      targeted: ["tests/e2e_user/scenarios/test_executor_review_proposal_apply_readiness_tui.py"],
      notes: ["Read-only apply-readiness summary; appends no events."],
      out: ["proposal apply", "mission mutation", "provider calls", "OpenCode launch"],
    }),
    fakeCommandAuthorityRecord("/executor-review-proposal-apply-readiness-list", "runtime.list_executor_review_proposal_apply_readiness", "safe_read", "none", "commander_apply", {
      reads: ["/executor-review-proposal-apply-readiness-show"],
      targeted: ["tests/e2e_user/scenarios/test_executor_review_proposal_apply_readiness_tui.py"],
      notes: ["Read-only apply-readiness list; does not infer a mutation target."],
      out: ["proposal apply", "mission mutation", "provider calls", "OpenCode launch"],
    }),
    fakeCommandAuthorityRecord("/executor-review-proposal-apply-readiness-show", "runtime.get_executor_review_proposal_apply_readiness", "safe_read", "none", "commander_apply", {
      reads: ["/executor-review-proposal-apply-readiness-list"],
      targeted: ["tests/e2e_user/scenarios/test_executor_review_proposal_apply_readiness_tui.py"],
    }),
    fakeCommandAuthorityRecord("/minimax-live-preview", "runtime.preview_minimax_live_validation", "safe_read", "reasoning_provider_runtime", "reasoning_provider", {
      reads: ["/reasoning", "/reasoning-smoke-preview commander_executor_review"],
      targeted: ["tests/e2e_user/scenarios/test_minimax_live_validation_tui.py"],
      aliases: ["/reasoning-live-preview"],
      notes: ["Read-only MiniMax live validation preview; does not call provider."],
      out: ["provider calls", "proposal creation", "OpenCode launch", "mission mutation"],
    }),
    fakeCommandAuthorityRecord("/minimax-live-dry-run", "runtime.execute_minimax_live_validation", "safe_read", "reasoning_provider_runtime", "reasoning_provider", {
      reads: ["/minimax-live-preview"],
      targeted: ["tests/e2e_user/scenarios/test_minimax_live_validation_tui.py"],
      notes: ["Dry-run does not call MiniMax and appends no events."],
      out: ["provider calls", "proposal creation", "OpenCode launch", "mission mutation"],
    }),
    fakeCommandAuthorityRecord("/minimax-live-validate", "runtime.execute_minimax_live_validation", "high_impact_write", "reasoning_provider_runtime", "reasoning_provider", {
      mutates: true,
      events: ["minimax_live_validation_started", "minimax_live_validation_succeeded", "minimax_live_validation_failed"],
      reads: ["/minimax-live-preview", "/minimax-live-validations"],
      targeted: ["tests/e2e_user/scenarios/test_minimax_live_validation_tui.py"],
      aliases: ["/reasoning-live-validate", "/minimax-provider-validate"],
      notes: ["Explicit opt-in live MiniMax provider validation only; writes bounded validation metadata and does not create proposals or product mutations."],
      out: ["proposal creation", "proposal apply", "Commander cycle product execution", "research synthesis product execution", "OpenCode launch", "mission mutation"],
    }),
    fakeCommandAuthorityRecord("/minimax-live-validations", "runtime.list_minimax_live_validations", "safe_read", "reasoning_provider_runtime", "reasoning_provider", {
      reads: ["/minimax-live-show"],
      targeted: ["tests/e2e_user/scenarios/test_minimax_live_validation_tui.py"],
    }),
    fakeCommandAuthorityRecord("/minimax-live-show", "runtime.get_minimax_live_validation", "safe_read", "reasoning_provider_runtime", "reasoning_provider", {
      reads: ["/minimax-live-validations"],
      targeted: ["tests/e2e_user/scenarios/test_minimax_live_validation_tui.py"],
    }),
    fakeCommandAuthorityRecord("/apply-proposal", "runtime.apply_commander_proposal", "high_impact_write", "proposal_review_runtime", "proposal", {
      mutates: true,
      active: true,
      lock: true,
      events: ["commander_proposal_applied"],
      targeted: ["tests/e2e_user/scenarios/test_commander_cycle_tui.py"],
    }),
  ]
}

function fakeCommandAuthorityGet(command: string): CommandAuthorityRecordSummary {
  const normalized = fakeNormalizeAuthorityCommand(command)
  const found = normalized ? fakeCommandAuthorityRecords().find((record) => record.slash_command === normalized || record.aliases.includes(normalized)) : undefined
  if (found) return found
  return fakeCommandAuthorityRecord(redactText(command).slice(0, 160) || "<empty>", undefined, "unsupported", "unknown", "unknown", {
    blocked: true,
    status: "blocked",
    notes: ["Unsupported, unknown, non-slash, or path-like command text. Authority inventory does not execute inspected commands."],
    out: ["command execution", "command staging", "approval mutation"],
    targeted: ["tests/e2e_user/scenarios/test_command_authority_inventory_tui.py"],
  })
}

function fakeCommandAuthorityRecord(
  slashCommand: string,
  runtimeCommand: string | undefined,
  risk: string,
  gate: string,
  owner: string,
  options: {
    mutates?: boolean
    active?: boolean
    lock?: boolean
    approval?: boolean
    approvalSurface?: string
    executionSurface?: string
    events?: string[]
    reads?: string[]
    targeted?: string[]
    aliases?: string[]
    status?: string
    blocked?: boolean
    process?: boolean
    provider?: boolean
    notes?: string[]
    out?: string[]
  } = {},
): CommandAuthorityRecordSummary {
  return {
    authority_id: `fake_authority_${slashCommand.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "_") || "unknown"}`,
    slash_command: redactText(slashCommand),
    runtime_command: runtimeCommand,
    aliases: options.aliases ?? [],
    risk,
    gate,
    owner,
    mutates_events: options.mutates === true,
    creates_external_process: options.process === true,
    calls_provider: options.provider === true,
    requires_active_runtime: options.active === true,
    requires_run_lock: options.lock === true,
    requires_approval: options.approval === true,
    approval_surface: options.approvalSurface,
    execution_surface: options.executionSurface,
    expected_event_kinds: options.events ?? [],
    blocked_by_default: options.blocked ?? (risk === "high_impact_write" || risk === "unsupported"),
    current_phase_status: options.status ?? "implemented",
    recommended_reads: options.reads ?? [],
    validation_profile: fakeCommandAuthorityProfile(options.targeted ?? ["tests/e2e_user/scenarios/test_command_authority_inventory_tui.py"]),
    notes: options.notes ?? ["Read-only authority inventory; inspected commands are not executed."],
    out_of_scope: options.out ?? [],
  }
}

function fakeCommandAuthorityProfile(targeted: string[]): CommandAuthorityValidationProfileSummary {
  return {
    unit_runtime: true,
    unit_tui: true,
    typecheck_runtime: true,
    typecheck_tui: true,
    integration_cli: true,
    targeted_e2e: targeted,
    optional_regression_e2e: [],
    full_e2e_required_when: ["Run full historical E2E only for release-candidate gates, shared parser/global dispatch changes, broad snapshot/state merge changes, or explicit reviewer request."],
    live_provider_required: false,
    real_opencode_required: false,
  }
}

function fakeNormalizeAuthorityCommand(value: string): string | undefined {
  const match = /^\/([a-z][a-z-]*)(?:\s|$)/i.exec(redactText(value).trim())
  return match ? `/${match[1].toLowerCase()}` : undefined
}

function fakeCountBy(records: CommandAuthorityRecordSummary[], key: "risk" | "gate" | "owner"): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const record of records) counts[record[key]] = (counts[record[key]] ?? 0) + 1
  return counts
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
