import type { RuntimeEvent, RuntimeResearchProjectionHealth, RuntimeStatus } from "../events/event-types"
import type { ExecutorClaim, MissionProgress, MissionRecord, MissionResult } from "../missions/mission-types"
import type { ReviewRequest, ReviewRequestInput, ReviewStatusSummary } from "../missions/review-types"
import type { CommanderProposal, CommanderProposalInput, ProposalStatusSummary } from "../missions/proposal-types"
import type { CommanderProposalBundle, CommanderProposalBundleInput, CommanderProposalBundleReadiness, CommanderProposalBundleStatus, CommanderProposalBundleSummary } from "../missions/proposal-bundle-types"
import type { CommanderPlaybook, CommanderPlaybookDraftInput, CommanderPlaybookDraftResult } from "../missions/commander-playbook-types"
import type { CommanderPlaybookDraft, CommanderPlaybookDraftReadiness, CommanderPlaybookDraftStatus, CommanderPlaybookDraftSummary } from "../missions/commander-playbook-draft-types"
import type { CommanderApplyPreview, CommanderApplyResult, CommanderApplyTargetType } from "../missions/commander-apply-types"
import type { CommanderAuditEventKind, CommanderAuditTimeline, CommanderAuthorityChain } from "../missions/commander-audit-types"
import type { CommanderQueueKind, CommanderQueueResult, CommanderQueueSummary } from "../missions/commander-queue-types"
import type { CommanderTargetContext, CommanderTargetType } from "../missions/commander-target-context-types"
import type { ExternalApiAuditRecord, ExternalApiConnectorSummary, ExternalApiRequestInput, ExternalApiRequestPreview, ExternalApiRequestResult } from "../external-api/api-connector-types"
import type { ExternalApiResearchIngestionInput, ExternalApiResearchIngestionPreview, ExternalApiResearchIngestionRecord, ExternalApiResearchIngestionResult } from "../external-api/api-research-ingestion-types"
import type { ResearchSynthesisInput, ResearchSynthesisPreview, ResearchSynthesisRecord, ResearchSynthesisResult } from "../research-synthesis/research-synthesis-types"
import type { CommanderCycleInput, CommanderCyclePreview, CommanderCycleRecord, CommanderCycleResult } from "../commander-cycle/commander-cycle-types"
import type { CommanderExecutorReviewInput, CommanderExecutorReviewPreview, CommanderExecutorReviewRecord, CommanderExecutorReviewResult } from "../commander-executor-review/commander-executor-review-types"
import type { ExecutorReviewProposalDraftPreview, ExecutorReviewProposalDraftPreviewInput, ExecutorReviewProposalDraftSummary } from "../commander-executor-review/executor-review-proposal-draft-types"
import type { ExecutorReviewProposalCreateInput, ExecutorReviewProposalCreatePreview, ExecutorReviewProposalCreatePreviewInput, ExecutorReviewProposalCreateRecord, ExecutorReviewProposalCreateResult } from "../commander-executor-review/executor-review-proposal-create-types"
import type { ExecutorReviewProposalReviewRequestInput, ExecutorReviewProposalReviewRequestPreview, ExecutorReviewProposalReviewRequestPreviewInput, ExecutorReviewProposalReviewRequestRecord, ExecutorReviewProposalReviewRequestResult } from "../commander-executor-review/executor-review-proposal-review-request-types"
import type { ExecutorReviewProposalReviewDecisionInput, ExecutorReviewProposalReviewDecisionPreview, ExecutorReviewProposalReviewDecisionPreviewInput, ExecutorReviewProposalReviewDecisionRecord, ExecutorReviewProposalReviewDecisionResult } from "../commander-executor-review/executor-review-proposal-review-decision-types"
import type { ExecutorReviewProposalApplyCandidateKind, ExecutorReviewProposalApplyReadinessInput, ExecutorReviewProposalApplyReadinessPreview, ExecutorReviewProposalApplyReadinessRecord, ExecutorReviewProposalApplyReadinessStatus, ExecutorReviewProposalApplyReadinessSummary } from "../commander-executor-review/executor-review-proposal-apply-readiness-types"
import type { ExecutorReviewProposalNarrowApplyInput, ExecutorReviewProposalNarrowApplyPreview, ExecutorReviewProposalNarrowApplyPreviewInput, ExecutorReviewProposalNarrowApplyRecord, ExecutorReviewProposalNarrowApplyResult } from "../commander-executor-review/executor-review-proposal-narrow-apply-types"
import type { ReasoningProviderStatus } from "../reasoning/reasoning-provider-config"
import type { ReasoningProviderHealth, ReasoningProviderSmokePreview, ReasoningProviderSmokeResult } from "../reasoning/reasoning-health-types"
import type { MiniMaxLiveValidationInput, MiniMaxLiveValidationPreview, MiniMaxLiveValidationRecord, MiniMaxLiveValidationResult } from "../reasoning/minimax-live-validation-types"
import type { OpenCodeHandoffPreview, OpenCodeHandoffRecord, OpenCodeHandoffResult } from "../opencode/opencode-handoff-types"
import type { OpenCodeHandoffFollowup, OpenCodeHandoffFollowupQueue, OpenCodeHandoffFollowupQueueKind, OpenCodeHandoffFollowupSummary } from "../opencode/opencode-handoff-followup-types"
import type { OpenCodeProcessSmokePreview, OpenCodeProcessSmokeRecord, OpenCodeProcessSmokeResult } from "../opencode/opencode-process-smoke-types"
import type { OpenCodeHandoffReadinessInput, OpenCodeHandoffReadinessPreview, OpenCodeHandoffReadinessSummary } from "../opencode/opencode-handoff-readiness-types"
import type { OpenCodeResultReviewPacket, OpenCodeResultReviewPacketInput, OpenCodeResultReviewSummary } from "../opencode/opencode-result-review-packet-types"
import type { OpenCodeSessionCreateInput, OpenCodeSessionPlan, OpenCodeSessionPreview, OpenCodeSessionPreviewInput, OpenCodeSessionRecord, OpenCodeSessionSourceKind, OpenCodeSessionStatus, OpenCodeSessionSummary } from "../opencode-session/opencode-session-types"
import type { OpenCodeSessionInstructionPackPreview, OpenCodeSessionInstructionPackPreviewInput, OpenCodeSessionInstructionPackRecord, OpenCodeSessionInstructionPackResult, OpenCodeSessionInstructionPackWriteInput } from "../opencode-session/opencode-session-instruction-pack-types"
import type { OpenCodeLaunchReadinessPreview, OpenCodeLaunchReadinessPreviewInput, OpenCodeLaunchReadinessSummary } from "../opencode-session/opencode-launch-readiness-types"
import type { OpenCodeLaunchInput, OpenCodeLaunchPreview, OpenCodeLaunchPreviewInput, OpenCodeLaunchRecord, OpenCodeLaunchResult } from "../opencode-session/opencode-launch-gate-types"
import type { OpenCodeProgressAppendInput, OpenCodeProgressPreview, OpenCodeProgressPreviewInput, OpenCodeProgressRecord, OpenCodeProgressResult, OpenCodeProgressSummary } from "../opencode-session/opencode-progress-types"
import type { OpenCodeForcedReportInput, OpenCodeForcedReportRequest, OpenCodeWatchdogPreview, OpenCodeWatchdogPreviewInput, OpenCodeWatchdogRecord, OpenCodeWatchdogRecordInput, OpenCodeWatchdogResult, OpenCodeWatchdogSummary } from "../opencode-session/opencode-timeout-watchdog-types"
import type { OpenCodeCommanderQuestionCreateInput, OpenCodeCommanderQuestionPreview, OpenCodeCommanderQuestionPreviewInput, OpenCodeCommanderQuestionRecord, OpenCodeCommanderQuestionResult, OpenCodeCommanderQuestionSummary } from "../opencode-session/opencode-commander-question-types"
import type { CommanderGuidanceCreateInput, CommanderGuidancePreview, CommanderGuidancePreviewInput, CommanderGuidanceRecord, CommanderGuidanceResult, CommanderGuidanceSummary } from "../opencode-session/opencode-commander-guidance-types"
import type { CommanderGuidanceDeliveryInput, CommanderGuidanceDeliveryPreview, CommanderGuidanceDeliveryPreviewInput, CommanderGuidanceDeliveryRecord, CommanderGuidanceDeliveryResult, CommanderGuidanceDeliverySummary } from "../opencode-session/opencode-guidance-delivery-types"
import type { ContextBudgetPreview, ContextBudgetPreviewInput, ContextBudgetSummary } from "../context/context-budget-types"
import type { ModelCapability } from "../context/model-capability-types"
import type { ContextPacketPreview, ContextPacketPreviewInput, ContextPacketSummary } from "../context/context-packet-types"
import type { ResearchMemoryRetrievalInput, ResearchMemoryRetrievalPreview, ResearchMemorySummary, ResearchNoveltyInput, ResearchNoveltyPreview } from "../research-memory/research-memory-types"
import type { RuntimeCheckpoint, RuntimeCheckpointInput, RuntimeCheckpointPreview, RuntimeCheckpointRecord } from "../checkpoints/runtime-checkpoint-types"
import type { RuntimeRestoreInput, RuntimeRestorePreview, RuntimeResumeAnchor } from "../checkpoints/runtime-restore-types"
import type { WakeAssessment, WakeAssessmentInput, WakeAssessmentPreview, WakeAssessmentRecord } from "../wake/wake-hook-types"
import type { ContinuationPlan, ContinuationPlanDecisionInput, ContinuationPlanInput, ContinuationPlanPreview, ContinuationPlanRecord, ContinuationStepInput, ContinuationStepResult } from "../continuation/continuation-types"
import type { WakeSchedule, WakeScheduleDecisionInput, WakeScheduleInput, WakeSchedulePreview, WakeScheduleRecord, WakeScheduleTickInput, WakeScheduleTickPreview, WakeScheduleTickResult } from "../schedules/wake-schedule-types"
import type { WakeSchedulerEventRecord, WakeSchedulerPreview, WakeSchedulerStartInput, WakeSchedulerState, WakeSchedulerStopInput } from "../schedules/wake-scheduler-types"
import type { WakeSchedulerBootstrapStatus } from "../schedules/wake-scheduler-bootstrap-types"
import type { WakeSchedulerRecovery, WakeSchedulerRecoveryAcknowledgeInput, WakeSchedulerRecoveryPreview, WakeSchedulerRecoveryRecord } from "../schedules/wake-scheduler-recovery-types"
import type { WakeSchedulerRecoveryWorkflow, WakeSchedulerRecoveryWorkflowCancelInput, WakeSchedulerRecoveryWorkflowInput, WakeSchedulerRecoveryWorkflowPreview, WakeSchedulerRecoveryWorkflowRecord, WakeSchedulerRecoveryWorkflowStepRecordInput, WakeSchedulerRecoveryWorkflowVerification } from "../schedules/wake-scheduler-recovery-workflow-types"
import type { WakeSchedulerAuditChain, WakeSchedulerAuditIncident, WakeSchedulerAuditQuery, WakeSchedulerAuditSummary, WakeSchedulerAuditTimelineEntry } from "../schedules/wake-scheduler-audit-types"
import type { WakeSchedulerNavigationBoard, WakeSchedulerNavigationCommandPreview, WakeSchedulerNavigationInput, WakeSchedulerNavigationTarget } from "../schedules/wake-scheduler-navigation-types"
import type { WakeSchedulerNavigationStageClearInput, WakeSchedulerNavigationStageInput, WakeSchedulerNavigationStagePreview, WakeSchedulerNavigationStageRemoveInput, WakeSchedulerNavigationStagedCommand, WakeSchedulerNavigationStagedCommandRecord } from "../schedules/wake-scheduler-navigation-staging-types"
import type { WakeSchedulerNavigationStagedRunInput, WakeSchedulerNavigationStagedRunListInput, WakeSchedulerNavigationStagedRunPreview, WakeSchedulerNavigationStagedRunRecord, WakeSchedulerNavigationStagedRunResult } from "../schedules/wake-scheduler-navigation-staged-run-types"
import type { WakeSchedulerNavigationStagedReadCompareInput, WakeSchedulerNavigationStagedReadGroup, WakeSchedulerNavigationStagedReadGroupInput, WakeSchedulerNavigationStagedReadHistory, WakeSchedulerNavigationStagedReadHistoryInput, WakeSchedulerNavigationStagedReadPairComparison, WakeSchedulerNavigationStagedReadStaleInput, WakeSchedulerNavigationStagedReadStaleItem } from "../schedules/wake-scheduler-navigation-staged-read-compare-types"
import type { WakeSchedulerNavigationWriteBoard, WakeSchedulerNavigationWriteBoardInput, WakeSchedulerNavigationWritePreview, WakeSchedulerNavigationWritePreviewInput } from "../schedules/wake-scheduler-navigation-write-preview-types"
import type { WakeSchedulerNavigationStagedWriteCommand, WakeSchedulerNavigationStagedWriteCommandRecord, WakeSchedulerNavigationWriteStageClearInput, WakeSchedulerNavigationWriteStageInput, WakeSchedulerNavigationWriteStagePreview, WakeSchedulerNavigationWriteStageRemoveInput } from "../schedules/wake-scheduler-navigation-write-staging-types"
import type { WakeSchedulerNavigationWriteRunInput, WakeSchedulerNavigationWriteRunListInput, WakeSchedulerNavigationWriteRunPreview, WakeSchedulerNavigationWriteRunRecord, WakeSchedulerNavigationWriteRunResult } from "../schedules/wake-scheduler-navigation-write-run-types"
import type { WakeSchedulerNavigationWriteRunCompareInput, WakeSchedulerNavigationWriteRunGroup, WakeSchedulerNavigationWriteRunGroupInput, WakeSchedulerNavigationWriteRunHistory, WakeSchedulerNavigationWriteRunHistoryInput, WakeSchedulerNavigationWriteRunPairComparison, WakeSchedulerNavigationWriteRunStaleInput, WakeSchedulerNavigationWriteRunStaleItem } from "../schedules/wake-scheduler-navigation-write-run-compare-types"
import type { WakeSchedulerNavigationWriteApproval, WakeSchedulerNavigationWriteApprovalInput, WakeSchedulerNavigationWriteApprovalListInput, WakeSchedulerNavigationWriteApprovalRecord, WakeSchedulerNavigationWriteApprovalRejectInput, WakeSchedulerNavigationWriteApprovalRevokeInput, WakeSchedulerNavigationWriteReadinessInput, WakeSchedulerNavigationWriteReadinessPreview } from "../schedules/wake-scheduler-navigation-write-approval-types"
import type { WakeSchedulerNavigationCheckpointWriteRunInput, WakeSchedulerNavigationCheckpointWriteRunListInput, WakeSchedulerNavigationCheckpointWriteRunPreview, WakeSchedulerNavigationCheckpointWriteRunRecord, WakeSchedulerNavigationCheckpointWriteRunResult } from "../schedules/wake-scheduler-navigation-checkpoint-write-run-types"
import type { WakeSchedulerNavigationCheckpointApprovalUsageInput, WakeSchedulerNavigationCheckpointApprovalUsageSummary, WakeSchedulerNavigationCheckpointWriteCompareInput, WakeSchedulerNavigationCheckpointWriteGroup, WakeSchedulerNavigationCheckpointWriteGroupInput, WakeSchedulerNavigationCheckpointWriteHistory, WakeSchedulerNavigationCheckpointWriteHistoryInput, WakeSchedulerNavigationCheckpointWritePairComparison, WakeSchedulerNavigationCheckpointWriteStaleInput, WakeSchedulerNavigationCheckpointWriteStaleItem } from "../schedules/wake-scheduler-navigation-checkpoint-write-compare-types"
import type { CommandAuthorityQuery, CommandAuthorityRecord, CommandAuthoritySummary, CommandValidationProfile } from "../authority/command-authority-types"
import type { ListResearchEventsOptions, Note, ResearchEvent, SearchOptions, Topic, TopicSnapshot } from "../research-db/research-db"

export interface SubmitUserMessageResult {
  accepted: true
  missionId: string
  intentId: string
}

export interface RuntimeClient {
  command(name: "runtime.status"): Promise<RuntimeStatus>
  command(name: "runtime.reasoning_provider_status"): Promise<ReasoningProviderStatus>
  command(name: "runtime.command_authority_summary"): Promise<CommandAuthoritySummary>
  command(name: "runtime.command_authority_list", payload?: CommandAuthorityQuery): Promise<CommandAuthorityRecord[]>
  command(name: "runtime.command_authority_get", payload: { command: string }): Promise<CommandAuthorityRecord>
  command(name: "runtime.command_authority_validation_profile", payload: { command: string; changedFiles?: string[]; changed_files?: string[] }): Promise<CommandValidationProfile>
  command(name: "runtime.reasoning_provider_health"): Promise<ReasoningProviderHealth>
  command(name: "runtime.preview_reasoning_provider_smoke", payload?: { surface?: string; requestedBy?: string; requested_by?: string }): Promise<ReasoningProviderSmokePreview>
  command(name: "runtime.execute_reasoning_provider_smoke", payload?: { surface?: string; dryRun?: boolean; dry_run?: boolean; requestedBy?: string; requested_by?: string }): Promise<ReasoningProviderSmokeResult>
  command(name: "runtime.preview_minimax_live_validation", payload?: MiniMaxLiveValidationInput): Promise<MiniMaxLiveValidationPreview>
  command(name: "runtime.execute_minimax_live_validation", payload?: MiniMaxLiveValidationInput): Promise<MiniMaxLiveValidationResult>
  command(name: "runtime.list_minimax_live_validations", payload?: { limit?: number }): Promise<MiniMaxLiveValidationRecord[]>
  command(name: "runtime.get_minimax_live_validation", payload: { validationId: string } | { validation_id: string }): Promise<MiniMaxLiveValidationResult | null>
  command(name: "runtime.resume" | "runtime.start_new_session" | "runtime.view_records"): Promise<unknown>
  command(name: "runtime.shutdown", payload?: { reason?: string }): Promise<unknown>
  command(name: "runtime.get_mission", payload: { missionId: string }): Promise<MissionRecord | null>
  command(name: "runtime.list_recent_missions", payload?: { limit?: number }): Promise<MissionRecord[]>
  command(name: "runtime.claim_mission", payload: { missionId: string; executorId: string }): Promise<ExecutorClaim>
  command(name: "runtime.record_mission_progress", payload: { missionId: string; claimId: string; message: string }): Promise<MissionProgress>
  command(name: "runtime.submit_mission_result", payload: { missionId: string; claimId: string; summary: string; artifacts?: string[]; researchResultIds?: string[] }): Promise<MissionResult>
  command(name: "runtime.complete_mission", payload: { missionId: string; resultId?: string; summary?: string }): Promise<MissionRecord>
  command(name: "runtime.fail_mission", payload: { missionId: string; reason: string }): Promise<MissionRecord>
  command(name: "runtime.cancel_mission", payload: { missionId: string; reason?: string }): Promise<MissionRecord>
  command(name: "runtime.release_mission_claim", payload: { claimId: string; reason?: string }): Promise<ExecutorClaim>
  command(name: "runtime.list_mission_claims", payload: { missionId: string }): Promise<ExecutorClaim[]>
  command(name: "runtime.list_mission_progress", payload: { missionId: string }): Promise<MissionProgress[]>
  command(name: "runtime.list_mission_results", payload: { missionId: string }): Promise<MissionResult[]>
  command(name: "runtime.create_review_request", payload: Omit<ReviewRequestInput, "mission_id" | "claim_id" | "result_id" | "request_type"> & { missionId?: string; claimId?: string; resultId?: string; requestType?: ReviewRequestInput["request_type"] }): Promise<ReviewRequest>
  command(name: "runtime.get_review_request", payload: { reviewId: string }): Promise<ReviewRequest | null>
  command(name: "runtime.list_review_requests", payload?: { status?: ReviewRequest["status"]; limit?: number }): Promise<ReviewRequest[]>
  command(name: "runtime.approve_review_request", payload: { reviewId: string; decidedBy: string; reason?: string }): Promise<ReviewRequest>
  command(name: "runtime.reject_review_request", payload: { reviewId: string; decidedBy: string; reason?: string }): Promise<ReviewRequest>
  command(name: "runtime.cancel_review_request", payload: { reviewId: string; decidedBy: string; reason?: string }): Promise<ReviewRequest>
  command(name: "runtime.review_status"): Promise<ReviewStatusSummary>
  command(name: "runtime.create_commander_proposal", payload: Omit<CommanderProposalInput, "mission_id" | "claim_id" | "result_id" | "action_kind" | "action_payload" | "proposed_by"> & { missionId?: string; claimId?: string; resultId?: string; actionKind: CommanderProposalInput["action_kind"]; actionPayload?: Record<string, unknown>; proposedBy: string }): Promise<CommanderProposal>
  command(name: "runtime.get_commander_proposal", payload: { proposalId: string }): Promise<CommanderProposal | null>
  command(name: "runtime.list_commander_proposals", payload?: { status?: CommanderProposal["status"]; limit?: number }): Promise<CommanderProposal[]>
  command(name: "runtime.request_proposal_review", payload: { proposalId: string; title?: string; summary?: string; requestedBy: string }): Promise<CommanderProposal>
  command(name: "runtime.cancel_commander_proposal", payload: { proposalId: string; reason?: string }): Promise<CommanderProposal>
  command(name: "runtime.apply_commander_proposal", payload: { proposalId: string }): Promise<CommanderProposal>
  command(name: "runtime.proposal_status"): Promise<ProposalStatusSummary>
  command(name: "runtime.create_proposal_bundle", payload: Omit<CommanderProposalBundleInput, "created_by"> & { createdBy: string }): Promise<CommanderProposalBundle>
  command(name: "runtime.get_proposal_bundle", payload: { bundleId: string }): Promise<CommanderProposalBundle | null>
  command(name: "runtime.list_proposal_bundles", payload?: { status?: CommanderProposalBundleStatus; limit?: number }): Promise<CommanderProposalBundle[]>
  command(name: "runtime.add_proposal_to_bundle", payload: { bundleId: string; proposalId: string }): Promise<CommanderProposalBundle>
  command(name: "runtime.proposal_bundle_readiness", payload: { bundleId: string }): Promise<CommanderProposalBundleReadiness>
  command(name: "runtime.request_proposal_bundle_reviews", payload: { bundleId: string; requestedBy: string }): Promise<CommanderProposalBundle>
  command(name: "runtime.apply_proposal_bundle", payload: { bundleId: string; allowPartial?: boolean }): Promise<CommanderProposalBundle>
  command(name: "runtime.cancel_proposal_bundle", payload: { bundleId: string; reason?: string }): Promise<CommanderProposalBundle>
  command(name: "runtime.proposal_bundle_status"): Promise<CommanderProposalBundleSummary>
  command(name: "runtime.list_commander_playbooks"): Promise<CommanderPlaybook[]>
  command(name: "runtime.get_commander_playbook", payload: { playbookId: string }): Promise<CommanderPlaybook | null>
  command(name: "runtime.draft_commander_playbook", payload: Omit<CommanderPlaybookDraftInput, "playbook_id" | "proposed_by" | "requested_by" | "bundle_title" | "bundle_summary" | "create_bundle" | "request_reviews"> & {
    playbookId: string
    proposedBy?: string
    requestedBy?: string
    bundleTitle?: string
    bundleSummary?: string
    createBundle?: boolean
    requestReviews?: boolean
  }): Promise<CommanderPlaybookDraftResult>
  command(name: "runtime.get_commander_playbook_draft", payload: { draftId: string }): Promise<CommanderPlaybookDraft | null>
  command(name: "runtime.list_commander_playbook_drafts", payload?: { status?: CommanderPlaybookDraftStatus; limit?: number }): Promise<CommanderPlaybookDraft[]>
  command(name: "runtime.commander_playbook_draft_status"): Promise<CommanderPlaybookDraftSummary>
  command(name: "runtime.commander_playbook_draft_readiness", payload: { draftId: string }): Promise<CommanderPlaybookDraftReadiness>
  command(name: "runtime.request_commander_playbook_draft_reviews", payload: { draftId: string; requestedBy: string }): Promise<CommanderPlaybookDraft>
  command(name: "runtime.cancel_commander_playbook_draft", payload: { draftId: string; reason?: string }): Promise<CommanderPlaybookDraft>
  command(name: "runtime.commander_apply_preview", payload: { targetType: CommanderApplyTargetType; targetId: string }): Promise<CommanderApplyPreview>
  command(name: "runtime.apply_commander_target", payload: { targetType: CommanderApplyTargetType; targetId: string; allowPartial?: boolean; dryRun?: boolean }): Promise<CommanderApplyResult>
  command(name: "runtime.commander_audit_timeline", payload?: { limit?: number; category?: CommanderAuditEventKind; targetType?: string; targetId?: string; afterEventId?: string; beforeEventId?: string }): Promise<CommanderAuditTimeline>
  command(name: "runtime.commander_authority_chain", payload: { targetType: string; targetId: string }): Promise<CommanderAuthorityChain>
  command(name: "runtime.commander_queue_summary", payload?: { staleAfterMs?: number }): Promise<CommanderQueueSummary>
  command(name: "runtime.commander_queue", payload: { queue: CommanderQueueKind; limit?: number; staleAfterMs?: number }): Promise<CommanderQueueResult>
  command(name: "runtime.commander_target_context", payload: { targetType: CommanderTargetType; targetId: string } | { target_type: CommanderTargetType; target_id: string }): Promise<CommanderTargetContext>
  command(name: "runtime.list_external_api_connectors"): Promise<ExternalApiConnectorSummary[]>
  command(name: "runtime.get_external_api_connector", payload: { connectorId: string } | { connector_id: string }): Promise<ExternalApiConnectorSummary | null>
  command(name: "runtime.preview_external_api_request", payload: ExternalApiRequestInput | {
    connectorId: string
    method: ExternalApiRequestInput["method"]
    path: string
    query?: Record<string, string>
    headers?: Record<string, string>
    body?: string
    dryRun?: boolean
    requestedBy: string
  }): Promise<ExternalApiRequestPreview>
  command(name: "runtime.execute_external_api_request", payload: ExternalApiRequestInput | {
    connectorId: string
    method: ExternalApiRequestInput["method"]
    path: string
    query?: Record<string, string>
    headers?: Record<string, string>
    body?: string
    dryRun?: boolean
    requestedBy: string
  }): Promise<ExternalApiRequestResult>
  command(name: "runtime.list_external_api_audit", payload?: { limit?: number }): Promise<ExternalApiAuditRecord[]>
  command(name: "runtime.preview_external_api_research_ingestion", payload: ExternalApiResearchIngestionInput | {
    connectorId: string
    method: ExternalApiResearchIngestionInput["method"]
    path: string
    query?: Record<string, string>
    headers?: Record<string, string>
    body?: string
    topicId: string
    sourceTitle: string
    noteTitle?: string
    requestedBy: string
    responseSelector?: ExternalApiResearchIngestionInput["response_selector"]
    tags?: string[]
    dryRun?: boolean
  }): Promise<ExternalApiResearchIngestionPreview>
  command(name: "runtime.execute_external_api_research_ingestion", payload: ExternalApiResearchIngestionInput | {
    connectorId: string
    method: ExternalApiResearchIngestionInput["method"]
    path: string
    query?: Record<string, string>
    headers?: Record<string, string>
    body?: string
    topicId: string
    sourceTitle: string
    noteTitle?: string
    requestedBy: string
    responseSelector?: ExternalApiResearchIngestionInput["response_selector"]
    tags?: string[]
    dryRun?: boolean
  }): Promise<ExternalApiResearchIngestionResult>
  command(name: "runtime.list_external_api_research_ingestions", payload?: { limit?: number }): Promise<ExternalApiResearchIngestionRecord[]>
  command(name: "runtime.preview_research_synthesis", payload: ResearchSynthesisInput | {
    topicId: string
    objective?: string
    providerId?: string
    createProposals?: boolean
    requestedBy: string
    maxContextBytes?: number
    maxOutputBytes?: number
  }): Promise<ResearchSynthesisPreview>
  command(name: "runtime.execute_research_synthesis", payload: ResearchSynthesisInput | {
    topicId: string
    objective?: string
    providerId?: string
    createProposals?: boolean
    requestedBy: string
    maxContextBytes?: number
    maxOutputBytes?: number
  }): Promise<ResearchSynthesisResult>
  command(name: "runtime.get_research_synthesis", payload: { synthesisId: string } | { synthesis_id: string }): Promise<ResearchSynthesisResult | null>
  command(name: "runtime.list_research_syntheses", payload?: { limit?: number }): Promise<ResearchSynthesisRecord[]>
  command(name: "runtime.preview_commander_cycle", payload: CommanderCycleInput | {
    objective?: string
    topicId?: string
    missionId?: string
    providerId?: string
    createProposals?: boolean
    createBundle?: boolean
    requestedBy: string
    maxContextBytes?: number
    maxOutputBytes?: number
  }): Promise<CommanderCyclePreview>
  command(name: "runtime.execute_commander_cycle", payload: CommanderCycleInput | {
    objective?: string
    topicId?: string
    missionId?: string
    providerId?: string
    createProposals?: boolean
    createBundle?: boolean
    requestedBy: string
    maxContextBytes?: number
    maxOutputBytes?: number
  }): Promise<CommanderCycleResult>
  command(name: "runtime.get_commander_cycle", payload: { cycleId: string } | { cycle_id: string }): Promise<CommanderCycleResult | null>
  command(name: "runtime.list_commander_cycles", payload?: { limit?: number }): Promise<CommanderCycleRecord[]>
  command(name: "runtime.preview_opencode_handoff", payload: { proposalId: string; requestedBy?: string; dryRun?: boolean } | { proposal_id: string; requested_by?: string; dry_run?: boolean }): Promise<OpenCodeHandoffPreview>
  command(name: "runtime.execute_opencode_handoff", payload: { proposalId: string; requestedBy?: string; dryRun?: boolean } | { proposal_id: string; requested_by?: string; dry_run?: boolean }): Promise<OpenCodeHandoffResult>
  command(name: "runtime.list_opencode_handoffs", payload?: { limit?: number }): Promise<OpenCodeHandoffRecord[]>
  command(name: "runtime.get_opencode_handoff", payload: { handoffId: string } | { handoff_id: string }): Promise<OpenCodeHandoffResult | null>
  command(name: "runtime.preview_opencode_process_smoke", payload?: { timeoutMs?: number; timeout_ms?: number }): Promise<OpenCodeProcessSmokePreview>
  command(name: "runtime.execute_opencode_process_smoke", payload?: { requestedBy?: string; requested_by?: string; timeoutMs?: number; timeout_ms?: number; dryRun?: boolean; dry_run?: boolean }): Promise<OpenCodeProcessSmokeResult>
  command(name: "runtime.list_opencode_process_smokes", payload?: { limit?: number }): Promise<OpenCodeProcessSmokeRecord[]>
  command(name: "runtime.get_opencode_process_smoke", payload: { smokeId: string } | { smoke_id: string }): Promise<OpenCodeProcessSmokeResult | null>
  command(name: "runtime.preview_opencode_handoff_readiness", payload?: OpenCodeHandoffReadinessInput | {
    proposalId?: string
    reviewId?: string
    missionId?: string
    handoffId?: string
    command?: string
    requireRecentSmoke?: boolean
    maxSmokeAgeMs?: number
    includeAuthority?: boolean
  }): Promise<OpenCodeHandoffReadinessPreview>
  command(name: "runtime.opencode_handoff_readiness_summary", payload?: { maxSmokeAgeMs?: number; max_smoke_age_ms?: number }): Promise<OpenCodeHandoffReadinessSummary>
  command(name: "runtime.preview_opencode_result_review_packet", payload?: OpenCodeResultReviewPacketInput | {
    handoffId?: string
    followupId?: string
    missionId?: string
    resultId?: string
    proposalId?: string
    staleAfterMs?: number
  }): Promise<OpenCodeResultReviewPacket>
  command(name: "runtime.opencode_result_review_summary", payload?: { staleAfterMs?: number; stale_after_ms?: number; limit?: number }): Promise<OpenCodeResultReviewSummary>
  command(name: "runtime.preview_opencode_session_plan", payload?: OpenCodeSessionPreviewInput | {
    missionId?: string
    proposalId?: string
    reviewRequestId?: string
    applyId?: string
    objective?: string
    title?: string
    sourceKind?: OpenCodeSessionSourceKind
    maxContextBytes?: number
    maxWallTimeMs?: number
    maxNoProgressMs?: number
    heartbeatIntervalMs?: number
    createdBy?: string
  }): Promise<OpenCodeSessionPreview>
  command(name: "runtime.create_opencode_session_plan", payload?: OpenCodeSessionCreateInput | {
    missionId?: string
    proposalId?: string
    reviewRequestId?: string
    applyId?: string
    objective?: string
    title?: string
    sourceKind?: OpenCodeSessionSourceKind
    maxContextBytes?: number
    maxWallTimeMs?: number
    maxNoProgressMs?: number
    heartbeatIntervalMs?: number
    createdBy?: string
    dryRun?: boolean
  }): Promise<OpenCodeSessionPlan>
  command(name: "runtime.list_opencode_sessions", payload?: { limit?: number; status?: OpenCodeSessionStatus; mission_id?: string; missionId?: string; proposal_id?: string; proposalId?: string; source_kind?: OpenCodeSessionSourceKind; sourceKind?: OpenCodeSessionSourceKind }): Promise<OpenCodeSessionRecord[]>
  command(name: "runtime.get_opencode_session", payload: { session_id: string } | { sessionId: string }): Promise<OpenCodeSessionPlan | null>
  command(name: "runtime.opencode_session_summary", payload?: Record<string, never>): Promise<OpenCodeSessionSummary>
  command(name: "runtime.list_model_capabilities", payload?: { provider_kind?: string; providerKind?: string; provider?: string; role?: string; limit?: number }): Promise<ModelCapability[]>
  command(name: "runtime.get_model_capability", payload?: { capability_id?: string; capabilityId?: string; provider_kind?: string; providerKind?: string; provider?: string; model_id?: string; modelId?: string; model?: string }): Promise<ModelCapability>
  command(name: "runtime.context_budget_summary", payload?: Record<string, never>): Promise<ContextBudgetSummary>
  command(name: "runtime.preview_context_budget", payload?: ContextBudgetPreviewInput | {
    purpose?: string
    role?: string
    providerKind?: string
    providerId?: string
    modelId?: string
    sessionId?: string
    maxContextTokens?: number
    maxContextBytes?: number
  }): Promise<ContextBudgetPreview>
  command(name: "runtime.preview_context_packet", payload?: ContextPacketPreviewInput | {
    purpose?: string
    role?: string
    providerKind?: string
    providerId?: string
    modelId?: string
    sessionId?: string
    missionId?: string
    proposalId?: string
    reviewRequestId?: string
    applyId?: string
    maxContextTokens?: number
    maxContextBytes?: number
  }): Promise<ContextPacketPreview>
  command(name: "runtime.context_packet_summary", payload?: Record<string, never>): Promise<ContextPacketSummary>
  command(name: "runtime.preview_opencode_session_instruction_pack", payload?: OpenCodeSessionInstructionPackPreviewInput | {
    sessionId?: string
    providerKind?: string
    modelId?: string
    maxContextTokens?: number
    maxContextBytes?: number
    includeOpenCodeConfig?: boolean
    includeManifest?: boolean
  }): Promise<OpenCodeSessionInstructionPackPreview>
  command(name: "runtime.write_opencode_session_instruction_pack", payload?: OpenCodeSessionInstructionPackWriteInput | {
    sessionId?: string
    providerKind?: string
    modelId?: string
    maxContextTokens?: number
    maxContextBytes?: number
    includeOpenCodeConfig?: boolean
    includeManifest?: boolean
    dryRun?: boolean
    writtenBy?: string
  }): Promise<OpenCodeSessionInstructionPackResult>
  command(name: "runtime.list_opencode_session_instruction_packs", payload?: { limit?: number; session_id?: string; sessionId?: string; session?: string; status?: string }): Promise<OpenCodeSessionInstructionPackRecord[]>
  command(name: "runtime.get_opencode_session_instruction_pack", payload: { pack_id: string } | { packId: string }): Promise<OpenCodeSessionInstructionPackResult | null>
  command(name: "runtime.preview_opencode_launch_readiness", payload?: OpenCodeLaunchReadinessPreviewInput | { sessionId?: string; session_id?: string; session?: string; packId?: string; pack_id?: string; pack?: string; providerKind?: string; modelId?: string; maxContextTokens?: number; maxContextBytes?: number; includeResearchMemory?: boolean; includeNativeConfig?: boolean }): Promise<OpenCodeLaunchReadinessPreview>
  command(name: "runtime.opencode_launch_readiness_summary", payload?: { limit?: number }): Promise<OpenCodeLaunchReadinessSummary>
  command(name: "runtime.preview_opencode_session_launch", payload?: OpenCodeLaunchPreviewInput | { sessionId?: string; session_id?: string; session?: string; packId?: string; pack_id?: string; pack?: string; readinessHash?: string; readiness_hash?: string; providerKind?: string; provider_kind?: string; modelId?: string; model_id?: string; adapterKind?: string; adapter_kind?: string; allowRealLaunch?: boolean; allow_real_launch?: boolean; launchMode?: string; launch_mode?: string }): Promise<OpenCodeLaunchPreview>
  command(name: "runtime.launch_opencode_session", payload?: OpenCodeLaunchInput | { sessionId?: string; session_id?: string; session?: string; packId?: string; pack_id?: string; pack?: string; readinessHash?: string; readiness_hash?: string; providerKind?: string; provider_kind?: string; modelId?: string; model_id?: string; adapterKind?: string; adapter_kind?: string; allowRealLaunch?: boolean; allow_real_launch?: boolean; launchMode?: string; launch_mode?: string; dryRun?: boolean; dry_run?: boolean; launchedBy?: string; launched_by?: string }): Promise<OpenCodeLaunchResult>
  command(name: "runtime.list_opencode_session_launches", payload?: { limit?: number; session_id?: string; sessionId?: string; session?: string; status?: string }): Promise<OpenCodeLaunchRecord[]>
  command(name: "runtime.get_opencode_session_launch", payload: { launch_id: string } | { launchId: string }): Promise<OpenCodeLaunchResult | null>
  command(name: "runtime.preview_opencode_progress", payload?: OpenCodeProgressPreviewInput | { sessionId?: string; session_id?: string; session?: string; launchId?: string; launch_id?: string; launch?: string; kind?: string; executionState?: string; execution_state?: string; reportSummary?: string; report_summary?: string; summary?: string; currentStep?: string; current_step?: string; step?: string; filesTouched?: string[]; files_touched?: string[]; files?: string[]; commandsRun?: string[]; commands_run?: string[]; commands?: string[]; testsRun?: string[]; tests_run?: string[]; tests?: string[]; artifacts?: string[]; blockers?: string[]; blocker?: string[]; question?: string; confidence?: number | string; nextAction?: string; next_action?: string; next?: string; sourceKind?: string; source_kind?: string; source?: string }): Promise<OpenCodeProgressPreview>
  command(name: "runtime.record_opencode_progress", payload?: OpenCodeProgressAppendInput | { sessionId?: string; session_id?: string; session?: string; launchId?: string; launch_id?: string; launch?: string; kind?: string; executionState?: string; execution_state?: string; reportSummary?: string; report_summary?: string; summary?: string; currentStep?: string; current_step?: string; step?: string; filesTouched?: string[]; files_touched?: string[]; files?: string[]; commandsRun?: string[]; commands_run?: string[]; commands?: string[]; testsRun?: string[]; tests_run?: string[]; tests?: string[]; artifacts?: string[]; blockers?: string[]; blocker?: string[]; question?: string; confidence?: number | string; nextAction?: string; next_action?: string; next?: string; sourceKind?: string; source_kind?: string; source?: string; dryRun?: boolean; dry_run?: boolean; recordedBy?: string; recorded_by?: string }): Promise<OpenCodeProgressResult>
  command(name: "runtime.list_opencode_progress", payload?: { limit?: number; session_id?: string; sessionId?: string; session?: string; launch_id?: string; launchId?: string; launch?: string; kind?: string; execution_state?: string; executionState?: string }): Promise<OpenCodeProgressRecord[]>
  command(name: "runtime.get_opencode_progress", payload: { progress_id: string } | { progressId: string }): Promise<OpenCodeProgressResult | null>
  command(name: "runtime.latest_opencode_progress", payload?: { session_id?: string; sessionId?: string; session?: string; launch_id?: string; launchId?: string; launch?: string }): Promise<OpenCodeProgressResult | null>
  command(name: "runtime.opencode_progress_summary", payload?: { limit?: number }): Promise<OpenCodeProgressSummary>
  command(name: "runtime.preview_opencode_watchdog", payload?: OpenCodeWatchdogPreviewInput | { sessionId?: string; session_id?: string; session?: string; launchId?: string; launch_id?: string; launch?: string; maxWallTimeMs?: number; max_wall_time_ms?: number; maxNoProgressMs?: number; max_no_progress_ms?: number; heartbeatIntervalMs?: number; heartbeat_interval_ms?: number; includeLatestProgress?: boolean; include_latest_progress?: boolean }): Promise<OpenCodeWatchdogPreview>
  command(name: "runtime.record_opencode_watchdog", payload?: OpenCodeWatchdogRecordInput | { sessionId?: string; session_id?: string; session?: string; launchId?: string; launch_id?: string; launch?: string; maxWallTimeMs?: number; max_wall_time_ms?: number; maxNoProgressMs?: number; max_no_progress_ms?: number; heartbeatIntervalMs?: number; heartbeat_interval_ms?: number; includeLatestProgress?: boolean; include_latest_progress?: boolean; dryRun?: boolean; dry_run?: boolean; recordedBy?: string; recorded_by?: string; requestReport?: boolean; request_report?: boolean }): Promise<OpenCodeWatchdogResult>
  command(name: "runtime.request_opencode_forced_report", payload?: OpenCodeForcedReportInput | { sessionId?: string; session_id?: string; session?: string; launchId?: string; launch_id?: string; launch?: string; reason?: string; dryRun?: boolean; dry_run?: boolean; requestedBy?: string; requested_by?: string }): Promise<OpenCodeForcedReportRequest | OpenCodeWatchdogResult>
  command(name: "runtime.list_opencode_watchdogs", payload?: { limit?: number; session_id?: string; sessionId?: string; session?: string; launch_id?: string; launchId?: string; launch?: string; status?: string }): Promise<OpenCodeWatchdogRecord[]>
  command(name: "runtime.get_opencode_watchdog", payload: { watchdog_id: string } | { watchdogId: string }): Promise<OpenCodeWatchdogResult | null>
  command(name: "runtime.list_opencode_forced_report_requests", payload?: { limit?: number; session_id?: string; sessionId?: string; session?: string; launch_id?: string; launchId?: string; launch?: string }): Promise<OpenCodeForcedReportRequest[]>
  command(name: "runtime.get_opencode_forced_report_request", payload: { request_id: string } | { requestId: string }): Promise<OpenCodeForcedReportRequest | null>
  command(name: "runtime.opencode_watchdog_summary", payload?: { limit?: number }): Promise<OpenCodeWatchdogSummary>
  command(name: "runtime.preview_opencode_commander_question", payload?: OpenCodeCommanderQuestionPreviewInput | { sessionId?: string; session_id?: string; session?: string; launchId?: string; launch_id?: string; launch?: string; progressId?: string; progress_id?: string; progress?: string; watchdogId?: string; watchdog_id?: string; watchdog?: string; forcedReportRequestId?: string; forced_report_request_id?: string; forcedReport?: string; forced_report?: string; question?: string; questionType?: string; question_type?: string; type?: string; urgency?: string; contextSummary?: string; context_summary?: string; context?: string; optionsConsidered?: string[]; options_considered?: string[]; options?: string[]; executorRecommendation?: string; executor_recommendation?: string; recommendation?: string; sourceKind?: string; source_kind?: string; source?: string }): Promise<OpenCodeCommanderQuestionPreview>
  command(name: "runtime.create_opencode_commander_question", payload?: OpenCodeCommanderQuestionCreateInput | { sessionId?: string; session_id?: string; session?: string; launchId?: string; launch_id?: string; launch?: string; progressId?: string; progress_id?: string; progress?: string; watchdogId?: string; watchdog_id?: string; watchdog?: string; forcedReportRequestId?: string; forced_report_request_id?: string; forcedReport?: string; forced_report?: string; question?: string; questionType?: string; question_type?: string; type?: string; urgency?: string; contextSummary?: string; context_summary?: string; context?: string; optionsConsidered?: string[]; options_considered?: string[]; options?: string[]; executorRecommendation?: string; executor_recommendation?: string; recommendation?: string; sourceKind?: string; source_kind?: string; source?: string; dryRun?: boolean; dry_run?: boolean; createdBy?: string; created_by?: string }): Promise<OpenCodeCommanderQuestionResult>
  command(name: "runtime.list_opencode_commander_questions", payload?: { limit?: number; session_id?: string; sessionId?: string; session?: string; launch_id?: string; launchId?: string; launch?: string; status?: string; question_type?: string; questionType?: string; type?: string; urgency?: string }): Promise<OpenCodeCommanderQuestionRecord[]>
  command(name: "runtime.get_opencode_commander_question", payload: { question_id: string } | { questionId: string }): Promise<OpenCodeCommanderQuestionResult | null>
  command(name: "runtime.latest_opencode_commander_question", payload?: { session_id?: string; sessionId?: string; session?: string; launch_id?: string; launchId?: string; launch?: string }): Promise<OpenCodeCommanderQuestionResult | null>
  command(name: "runtime.opencode_commander_question_summary", payload?: { limit?: number }): Promise<OpenCodeCommanderQuestionSummary>
  command(name: "runtime.preview_commander_guidance", payload?: CommanderGuidancePreviewInput | { questionId?: string; question_id?: string; question?: string; answer?: string; guidanceScope?: string; guidance_scope?: string; scope?: string; authorKind?: string; author_kind?: string; author?: string; rationale?: string; constraints?: string[]; specRefs?: string[]; spec_refs?: string[]; researchRefs?: string[]; research_refs?: string[]; artifactRefs?: string[]; artifact_refs?: string[]; deliveryNote?: string; delivery_note?: string }): Promise<CommanderGuidancePreview>
  command(name: "runtime.create_commander_guidance", payload?: CommanderGuidanceCreateInput | { questionId?: string; question_id?: string; question?: string; answer?: string; guidanceScope?: string; guidance_scope?: string; scope?: string; authorKind?: string; author_kind?: string; author?: string; rationale?: string; constraints?: string[]; specRefs?: string[]; spec_refs?: string[]; researchRefs?: string[]; research_refs?: string[]; artifactRefs?: string[]; artifact_refs?: string[]; deliveryNote?: string; delivery_note?: string; dryRun?: boolean; dry_run?: boolean; createdBy?: string; created_by?: string }): Promise<CommanderGuidanceResult>
  command(name: "runtime.list_commander_guidance", payload?: { limit?: number; session_id?: string; sessionId?: string; session?: string; launch_id?: string; launchId?: string; launch?: string; question_id?: string; questionId?: string; question?: string; status?: string; delivery_status?: string; deliveryStatus?: string; guidance_scope?: string; guidanceScope?: string; scope?: string }): Promise<CommanderGuidanceRecord[]>
  command(name: "runtime.get_commander_guidance", payload: { guidance_id: string } | { guidanceId: string }): Promise<CommanderGuidanceResult | null>
  command(name: "runtime.latest_commander_guidance", payload?: { session_id?: string; sessionId?: string; session?: string; launch_id?: string; launchId?: string; launch?: string; question_id?: string; questionId?: string; question?: string }): Promise<CommanderGuidanceResult | null>
  command(name: "runtime.commander_guidance_summary", payload?: { limit?: number }): Promise<CommanderGuidanceSummary>
  command(name: "runtime.preview_commander_guidance_delivery", payload?: CommanderGuidanceDeliveryPreviewInput | { guidanceId?: string; guidance_id?: string; guidance?: string; deliveryMode?: string; delivery_mode?: string; mode?: string; allowRealDelivery?: boolean; allow_real_delivery?: boolean; operatorNote?: string; operator_note?: string }): Promise<CommanderGuidanceDeliveryPreview>
  command(name: "runtime.deliver_commander_guidance", payload?: CommanderGuidanceDeliveryInput | { guidanceId?: string; guidance_id?: string; guidance?: string; deliveryMode?: string; delivery_mode?: string; mode?: string; allowRealDelivery?: boolean; allow_real_delivery?: boolean; operatorNote?: string; operator_note?: string; dryRun?: boolean; dry_run?: boolean; deliveredBy?: string; delivered_by?: string }): Promise<CommanderGuidanceDeliveryResult>
  command(name: "runtime.list_commander_guidance_deliveries", payload?: { limit?: number; session_id?: string; sessionId?: string; session?: string; launch_id?: string; launchId?: string; launch?: string; guidance_id?: string; guidanceId?: string; guidance?: string; status?: string; delivery_mode?: string; deliveryMode?: string; mode?: string }): Promise<CommanderGuidanceDeliveryRecord[]>
  command(name: "runtime.get_commander_guidance_delivery", payload: { delivery_id: string } | { deliveryId: string }): Promise<CommanderGuidanceDeliveryResult | null>
  command(name: "runtime.latest_commander_guidance_delivery", payload?: { session_id?: string; sessionId?: string; session?: string; launch_id?: string; launchId?: string; launch?: string; guidance_id?: string; guidanceId?: string; guidance?: string }): Promise<CommanderGuidanceDeliveryResult | null>
  command(name: "runtime.commander_guidance_delivery_summary", payload?: { limit?: number }): Promise<CommanderGuidanceDeliverySummary>
  command(name: "runtime.research_memory_summary", payload?: Record<string, never>): Promise<ResearchMemorySummary>
  command(name: "runtime.preview_research_memory_retrieval", payload?: ResearchMemoryRetrievalInput | { query?: string; labels?: string[]; limit?: number; sourceKind?: string; source_kind?: string; missionId?: string; mission_id?: string; sessionId?: string; session_id?: string; includeFailures?: boolean; include_failures?: boolean; includeArtifacts?: boolean; include_artifacts?: boolean }): Promise<ResearchMemoryRetrievalPreview>
  command(name: "runtime.preview_research_novelty_check", payload?: ResearchNoveltyInput | { question?: string; method?: string; config?: string; labels?: string[]; limit?: number; missionId?: string; mission_id?: string; sessionId?: string; session_id?: string; repetitionReason?: string; repetition_reason?: string; reason?: string; includeFailures?: boolean; include_failures?: boolean }): Promise<ResearchNoveltyPreview>
  command(name: "runtime.preview_commander_executor_review", payload?: CommanderExecutorReviewInput): Promise<CommanderExecutorReviewPreview>
  command(name: "runtime.execute_commander_executor_review", payload?: CommanderExecutorReviewInput): Promise<CommanderExecutorReviewResult>
  command(name: "runtime.list_commander_executor_reviews", payload?: { limit?: number; packet_id?: string; packetId?: string; mission_id?: string; missionId?: string; handoff_id?: string; handoffId?: string }): Promise<CommanderExecutorReviewRecord[]>
  command(name: "runtime.get_commander_executor_review", payload: { review_id: string } | { reviewId: string }): Promise<CommanderExecutorReviewResult | null>
  command(name: "runtime.preview_executor_review_proposal_drafts", payload?: ExecutorReviewProposalDraftPreviewInput): Promise<ExecutorReviewProposalDraftPreview>
  command(name: "runtime.executor_review_proposal_draft_summary", payload?: { limit?: number }): Promise<ExecutorReviewProposalDraftSummary>
  command(name: "runtime.preview_executor_review_proposal_create", payload: ExecutorReviewProposalCreatePreviewInput): Promise<ExecutorReviewProposalCreatePreview>
  command(name: "runtime.create_executor_review_proposal", payload: ExecutorReviewProposalCreateInput): Promise<ExecutorReviewProposalCreateResult>
  command(name: "runtime.list_executor_review_proposal_creates", payload?: { limit?: number; review_id?: string; reviewId?: string; proposal_id?: string; proposalId?: string }): Promise<ExecutorReviewProposalCreateRecord[]>
  command(name: "runtime.get_executor_review_proposal_create", payload: { create_id: string } | { createId: string }): Promise<ExecutorReviewProposalCreateResult | null>
  command(name: "runtime.preview_executor_review_proposal_review_request", payload: ExecutorReviewProposalReviewRequestPreviewInput): Promise<ExecutorReviewProposalReviewRequestPreview>
  command(name: "runtime.request_executor_review_proposal_review", payload: ExecutorReviewProposalReviewRequestInput): Promise<ExecutorReviewProposalReviewRequestResult>
  command(name: "runtime.list_executor_review_proposal_review_requests", payload?: { limit?: number; proposal_id?: string; proposalId?: string; review_request_id?: string; reviewRequestId?: string; create_id?: string; createId?: string }): Promise<ExecutorReviewProposalReviewRequestRecord[]>
  command(name: "runtime.get_executor_review_proposal_review_request", payload: { request_gate_id: string } | { requestGateId: string }): Promise<ExecutorReviewProposalReviewRequestResult | null>
  command(name: "runtime.preview_executor_review_proposal_review_decision", payload: ExecutorReviewProposalReviewDecisionPreviewInput): Promise<ExecutorReviewProposalReviewDecisionPreview>
  command(name: "runtime.decide_executor_review_proposal_review", payload: ExecutorReviewProposalReviewDecisionInput): Promise<ExecutorReviewProposalReviewDecisionResult>
  command(name: "runtime.list_executor_review_proposal_review_decisions", payload?: { limit?: number; proposal_id?: string; proposalId?: string; review_request_id?: string; reviewRequestId?: string; request_gate_id?: string; requestGateId?: string; decision?: "approve" | "reject" }): Promise<ExecutorReviewProposalReviewDecisionRecord[]>
  command(name: "runtime.get_executor_review_proposal_review_decision", payload: { decision_gate_id: string } | { decisionGateId: string }): Promise<ExecutorReviewProposalReviewDecisionResult | null>
  command(name: "runtime.preview_executor_review_proposal_apply_readiness", payload?: ExecutorReviewProposalApplyReadinessInput): Promise<ExecutorReviewProposalApplyReadinessPreview>
  command(name: "runtime.executor_review_proposal_apply_readiness_summary", payload?: { limit?: number }): Promise<ExecutorReviewProposalApplyReadinessSummary>
  command(name: "runtime.list_executor_review_proposal_apply_readiness", payload?: { limit?: number; status?: ExecutorReviewProposalApplyReadinessStatus; candidate_kind?: ExecutorReviewProposalApplyCandidateKind; candidateKind?: ExecutorReviewProposalApplyCandidateKind; proposal_id?: string; proposalId?: string }): Promise<ExecutorReviewProposalApplyReadinessRecord[]>
  command(name: "runtime.get_executor_review_proposal_apply_readiness", payload: { readiness_id: string } | { readinessId: string }): Promise<ExecutorReviewProposalApplyReadinessPreview | null>
  command(name: "runtime.preview_executor_review_proposal_narrow_apply", payload: ExecutorReviewProposalNarrowApplyPreviewInput): Promise<ExecutorReviewProposalNarrowApplyPreview>
  command(name: "runtime.apply_executor_review_proposal_narrow", payload: ExecutorReviewProposalNarrowApplyInput): Promise<ExecutorReviewProposalNarrowApplyResult>
  command(name: "runtime.list_executor_review_proposal_narrow_applies", payload?: { limit?: number; proposal_id?: string; proposalId?: string; status?: string; candidate_kind?: ExecutorReviewProposalApplyCandidateKind; candidateKind?: ExecutorReviewProposalApplyCandidateKind }): Promise<ExecutorReviewProposalNarrowApplyRecord[]>
  command(name: "runtime.get_executor_review_proposal_narrow_apply", payload: { apply_id: string } | { applyId: string }): Promise<ExecutorReviewProposalNarrowApplyResult | null>
  command(name: "runtime.get_opencode_handoff_followup", payload: { handoffId: string } | { handoff_id: string }): Promise<OpenCodeHandoffFollowup | null>
  command(name: "runtime.list_opencode_handoff_followups", payload?: { limit?: number; staleAfterMs?: number; stale_after_ms?: number }): Promise<OpenCodeHandoffFollowup[]>
  command(name: "runtime.opencode_handoff_followup_summary", payload?: { staleAfterMs?: number; stale_after_ms?: number }): Promise<OpenCodeHandoffFollowupSummary>
  command(name: "runtime.opencode_handoff_followup_queue", payload: { queue: OpenCodeHandoffFollowupQueueKind | string; limit?: number; staleAfterMs?: number; stale_after_ms?: number }): Promise<OpenCodeHandoffFollowupQueue>
  command(name: "runtime.preview_runtime_checkpoint", payload?: RuntimeCheckpointInput | { scope?: string; reason?: string; requestedBy?: string; createdBy?: string; maxBytes?: number }): Promise<RuntimeCheckpointPreview>
  command(name: "runtime.create_runtime_checkpoint", payload?: RuntimeCheckpointInput | { scope?: string; reason?: string; requestedBy?: string; createdBy?: string; maxBytes?: number }): Promise<RuntimeCheckpoint>
  command(name: "runtime.get_runtime_checkpoint", payload: { checkpointId: string } | { checkpoint_id: string }): Promise<RuntimeCheckpoint | null>
  command(name: "runtime.list_runtime_checkpoints", payload?: { limit?: number }): Promise<RuntimeCheckpointRecord[]>
  command(name: "runtime.preview_checkpoint_restore", payload: RuntimeRestoreInput): Promise<RuntimeRestorePreview>
  command(name: "runtime.mark_checkpoint_resume_anchor", payload: RuntimeRestoreInput): Promise<RuntimeResumeAnchor>
  command(name: "runtime.get_checkpoint_resume_anchor", payload: { resumeId: string } | { resume_id: string }): Promise<RuntimeResumeAnchor | null>
  command(name: "runtime.list_checkpoint_resume_anchors", payload?: { limit?: number }): Promise<RuntimeResumeAnchor[]>
  command(name: "runtime.preview_wake_assessment", payload: WakeAssessmentInput): Promise<WakeAssessmentPreview>
  command(name: "runtime.create_wake_assessment", payload: WakeAssessmentInput): Promise<WakeAssessment>
  command(name: "runtime.get_wake_assessment", payload: { wakeId: string } | { wake_id: string }): Promise<WakeAssessment | null>
  command(name: "runtime.list_wake_assessments", payload?: { limit?: number }): Promise<WakeAssessmentRecord[]>
  command(name: "runtime.preview_continuation_plan", payload: ContinuationPlanInput): Promise<ContinuationPlanPreview>
  command(name: "runtime.create_continuation_plan", payload: ContinuationPlanInput): Promise<ContinuationPlan>
  command(name: "runtime.get_continuation_plan", payload: { planId: string } | { plan_id: string }): Promise<ContinuationPlan | null>
  command(name: "runtime.list_continuation_plans", payload?: { limit?: number }): Promise<ContinuationPlanRecord[]>
  command(name: "runtime.execute_continuation_step", payload: ContinuationStepInput): Promise<ContinuationStepResult>
  command(name: "runtime.pause_continuation_plan", payload: ContinuationPlanDecisionInput): Promise<ContinuationPlan>
  command(name: "runtime.cancel_continuation_plan", payload: ContinuationPlanDecisionInput): Promise<ContinuationPlan>
  command(name: "runtime.preview_wake_schedule", payload: WakeScheduleInput): Promise<WakeSchedulePreview>
  command(name: "runtime.create_wake_schedule", payload: WakeScheduleInput): Promise<WakeSchedule>
  command(name: "runtime.get_wake_schedule", payload: { scheduleId: string } | { schedule_id: string }): Promise<WakeSchedule | null>
  command(name: "runtime.list_wake_schedules", payload?: { limit?: number }): Promise<WakeScheduleRecord[]>
  command(name: "runtime.pause_wake_schedule", payload: WakeScheduleDecisionInput): Promise<WakeSchedule>
  command(name: "runtime.resume_wake_schedule", payload: WakeScheduleDecisionInput): Promise<WakeSchedule>
  command(name: "runtime.cancel_wake_schedule", payload: WakeScheduleDecisionInput): Promise<WakeSchedule>
  command(name: "runtime.preview_wake_schedule_tick", payload?: WakeScheduleTickInput): Promise<WakeScheduleTickPreview>
  command(name: "runtime.execute_wake_schedule_tick", payload?: WakeScheduleTickInput): Promise<WakeScheduleTickResult>
  command(name: "runtime.list_wake_schedule_ticks", payload?: { limit?: number }): Promise<WakeScheduleTickResult[]>
  command(name: "runtime.get_wake_schedule_tick", payload: { tickId: string } | { tick_id: string }): Promise<WakeScheduleTickResult | null>
  command(name: "runtime.preview_wake_scheduler_start", payload?: WakeSchedulerStartInput): Promise<WakeSchedulerPreview>
  command(name: "runtime.start_wake_scheduler", payload?: WakeSchedulerStartInput): Promise<WakeSchedulerState>
  command(name: "runtime.stop_wake_scheduler", payload?: WakeSchedulerStopInput): Promise<WakeSchedulerState>
  command(name: "runtime.wake_scheduler_status", payload?: Record<string, never>): Promise<WakeSchedulerState>
  command(name: "runtime.wake_scheduler_bootstrap_status", payload?: Record<string, never>): Promise<WakeSchedulerBootstrapStatus>
  command(name: "runtime.preview_wake_scheduler_bootstrap", payload?: Record<string, never>): Promise<WakeSchedulerBootstrapStatus>
  command(name: "runtime.preview_wake_scheduler_recovery", payload?: Record<string, never>): Promise<WakeSchedulerRecoveryPreview>
  command(name: "runtime.get_wake_scheduler_recovery", payload: { recoveryId: string } | { recovery_id: string }): Promise<WakeSchedulerRecovery | null>
  command(name: "runtime.list_wake_scheduler_recoveries", payload?: { limit?: number }): Promise<WakeSchedulerRecoveryRecord[]>
  command(name: "runtime.acknowledge_wake_scheduler_recovery", payload: WakeSchedulerRecoveryAcknowledgeInput): Promise<WakeSchedulerRecovery>
  command(name: "runtime.preview_wake_scheduler_recovery_workflow", payload?: WakeSchedulerRecoveryWorkflowInput): Promise<WakeSchedulerRecoveryWorkflowPreview>
  command(name: "runtime.create_wake_scheduler_recovery_workflow", payload?: WakeSchedulerRecoveryWorkflowInput): Promise<WakeSchedulerRecoveryWorkflow>
  command(name: "runtime.get_wake_scheduler_recovery_workflow", payload: { workflowId: string } | { workflow_id: string }): Promise<WakeSchedulerRecoveryWorkflow | null>
  command(name: "runtime.list_wake_scheduler_recovery_workflows", payload?: { limit?: number }): Promise<WakeSchedulerRecoveryWorkflowRecord[]>
  command(name: "runtime.record_wake_scheduler_recovery_workflow_step", payload: WakeSchedulerRecoveryWorkflowStepRecordInput): Promise<WakeSchedulerRecoveryWorkflow>
  command(name: "runtime.cancel_wake_scheduler_recovery_workflow", payload: WakeSchedulerRecoveryWorkflowCancelInput): Promise<WakeSchedulerRecoveryWorkflow>
  command(name: "runtime.verify_wake_scheduler_recovery_workflow", payload: { workflowId: string } | { workflow_id: string }): Promise<WakeSchedulerRecoveryWorkflowVerification>
  command(name: "runtime.wake_scheduler_audit_summary", payload?: Record<string, never>): Promise<WakeSchedulerAuditSummary>
  command(name: "runtime.wake_scheduler_audit_timeline", payload?: WakeSchedulerAuditQuery | { limit?: number; kind?: string; kinds?: string[]; severity?: string; related?: string; related_id?: string; relatedId?: string; since?: string; until?: string }): Promise<WakeSchedulerAuditTimelineEntry[]>
  command(name: "runtime.wake_scheduler_audit_chain", payload: { relatedId: string; limit?: number } | { related_id: string; limit?: number }): Promise<WakeSchedulerAuditChain>
  command(name: "runtime.wake_scheduler_audit_incidents", payload?: { limit?: number; status?: string; severity?: string }): Promise<WakeSchedulerAuditIncident[]>
  command(name: "runtime.wake_scheduler_navigation_board", payload?: WakeSchedulerNavigationInput): Promise<WakeSchedulerNavigationBoard>
  command(name: "runtime.preview_wake_scheduler_navigation_command", payload: { command: string }): Promise<WakeSchedulerNavigationCommandPreview>
  command(name: "runtime.get_wake_scheduler_navigation_target", payload: { targetKind: string; targetId: string } | { target_kind: string; target_id: string }): Promise<WakeSchedulerNavigationTarget>
  command(name: "runtime.preview_wake_scheduler_navigation_stage", payload: WakeSchedulerNavigationStageInput): Promise<WakeSchedulerNavigationStagePreview>
  command(name: "runtime.stage_wake_scheduler_navigation_command", payload: WakeSchedulerNavigationStageInput): Promise<WakeSchedulerNavigationStagedCommand>
  command(name: "runtime.list_wake_scheduler_navigation_staged_commands", payload?: { limit?: number }): Promise<WakeSchedulerNavigationStagedCommandRecord[]>
  command(name: "runtime.remove_wake_scheduler_navigation_staged_command", payload: WakeSchedulerNavigationStageRemoveInput): Promise<WakeSchedulerNavigationStagedCommand | null>
  command(name: "runtime.clear_wake_scheduler_navigation_staged_commands", payload?: WakeSchedulerNavigationStageClearInput): Promise<WakeSchedulerNavigationStagedCommandRecord[]>
  command(name: "runtime.preview_wake_scheduler_navigation_staged_read", payload: WakeSchedulerNavigationStagedRunInput): Promise<WakeSchedulerNavigationStagedRunPreview>
  command(name: "runtime.execute_wake_scheduler_navigation_staged_read", payload: WakeSchedulerNavigationStagedRunInput): Promise<WakeSchedulerNavigationStagedRunResult>
  command(name: "runtime.list_wake_scheduler_navigation_staged_read_runs", payload?: WakeSchedulerNavigationStagedRunListInput): Promise<WakeSchedulerNavigationStagedRunRecord[]>
  command(name: "runtime.get_wake_scheduler_navigation_staged_read_run", payload: { runId: string } | { run_id: string }): Promise<WakeSchedulerNavigationStagedRunResult | null>
  command(name: "runtime.wake_scheduler_navigation_staged_read_history", payload?: WakeSchedulerNavigationStagedReadHistoryInput): Promise<WakeSchedulerNavigationStagedReadHistory>
  command(name: "runtime.wake_scheduler_navigation_staged_read_compare", payload: WakeSchedulerNavigationStagedReadCompareInput): Promise<WakeSchedulerNavigationStagedReadPairComparison>
  command(name: "runtime.wake_scheduler_navigation_staged_read_stale", payload?: WakeSchedulerNavigationStagedReadStaleInput): Promise<WakeSchedulerNavigationStagedReadStaleItem[]>
  command(name: "runtime.wake_scheduler_navigation_staged_read_group", payload: WakeSchedulerNavigationStagedReadGroupInput): Promise<WakeSchedulerNavigationStagedReadGroup | null>
  command(name: "runtime.preview_wake_scheduler_navigation_write_command", payload: WakeSchedulerNavigationWritePreviewInput): Promise<WakeSchedulerNavigationWritePreview>
  command(name: "runtime.wake_scheduler_navigation_write_board", payload?: WakeSchedulerNavigationWriteBoardInput): Promise<WakeSchedulerNavigationWriteBoard>
  command(name: "runtime.preview_wake_scheduler_navigation_write_stage", payload: WakeSchedulerNavigationWriteStageInput): Promise<WakeSchedulerNavigationWriteStagePreview>
  command(name: "runtime.stage_wake_scheduler_navigation_write_command", payload: WakeSchedulerNavigationWriteStageInput): Promise<WakeSchedulerNavigationStagedWriteCommand>
  command(name: "runtime.get_wake_scheduler_navigation_staged_write_command", payload: { stagedWriteId: string } | { staged_write_id: string }): Promise<WakeSchedulerNavigationStagedWriteCommand | null>
  command(name: "runtime.list_wake_scheduler_navigation_staged_write_commands", payload?: { limit?: number }): Promise<WakeSchedulerNavigationStagedWriteCommandRecord[]>
  command(name: "runtime.remove_wake_scheduler_navigation_staged_write_command", payload: WakeSchedulerNavigationWriteStageRemoveInput): Promise<WakeSchedulerNavigationStagedWriteCommand | null>
  command(name: "runtime.clear_wake_scheduler_navigation_staged_write_commands", payload?: WakeSchedulerNavigationWriteStageClearInput): Promise<WakeSchedulerNavigationStagedWriteCommandRecord[]>
  command(name: "runtime.preview_wake_scheduler_navigation_write_run", payload: WakeSchedulerNavigationWriteRunInput): Promise<WakeSchedulerNavigationWriteRunPreview>
  command(name: "runtime.execute_wake_scheduler_navigation_write_run", payload: WakeSchedulerNavigationWriteRunInput): Promise<WakeSchedulerNavigationWriteRunResult>
  command(name: "runtime.list_wake_scheduler_navigation_write_runs", payload?: WakeSchedulerNavigationWriteRunListInput): Promise<WakeSchedulerNavigationWriteRunRecord[]>
  command(name: "runtime.get_wake_scheduler_navigation_write_run", payload: { runId: string } | { run_id: string }): Promise<WakeSchedulerNavigationWriteRunResult | null>
  command(name: "runtime.wake_scheduler_navigation_write_run_history", payload?: WakeSchedulerNavigationWriteRunHistoryInput): Promise<WakeSchedulerNavigationWriteRunHistory>
  command(name: "runtime.wake_scheduler_navigation_write_run_compare", payload: WakeSchedulerNavigationWriteRunCompareInput): Promise<WakeSchedulerNavigationWriteRunPairComparison>
  command(name: "runtime.wake_scheduler_navigation_write_run_stale", payload?: WakeSchedulerNavigationWriteRunStaleInput): Promise<WakeSchedulerNavigationWriteRunStaleItem[]>
  command(name: "runtime.wake_scheduler_navigation_write_run_group", payload: WakeSchedulerNavigationWriteRunGroupInput): Promise<WakeSchedulerNavigationWriteRunGroup | null>
  command(name: "runtime.preview_wake_scheduler_navigation_write_readiness", payload: WakeSchedulerNavigationWriteReadinessInput): Promise<WakeSchedulerNavigationWriteReadinessPreview>
  command(name: "runtime.approve_wake_scheduler_navigation_staged_write", payload: WakeSchedulerNavigationWriteApprovalInput): Promise<WakeSchedulerNavigationWriteApproval>
  command(name: "runtime.reject_wake_scheduler_navigation_staged_write", payload: WakeSchedulerNavigationWriteApprovalRejectInput): Promise<WakeSchedulerNavigationWriteApproval>
  command(name: "runtime.revoke_wake_scheduler_navigation_write_approval", payload: WakeSchedulerNavigationWriteApprovalRevokeInput): Promise<WakeSchedulerNavigationWriteApproval | null>
  command(name: "runtime.get_wake_scheduler_navigation_write_approval", payload: { approvalId: string } | { approval_id: string }): Promise<WakeSchedulerNavigationWriteApproval | null>
  command(name: "runtime.list_wake_scheduler_navigation_write_approvals", payload?: WakeSchedulerNavigationWriteApprovalListInput): Promise<WakeSchedulerNavigationWriteApprovalRecord[]>
  command(name: "runtime.preview_wake_scheduler_navigation_checkpoint_write_run", payload: WakeSchedulerNavigationCheckpointWriteRunInput): Promise<WakeSchedulerNavigationCheckpointWriteRunPreview>
  command(name: "runtime.execute_wake_scheduler_navigation_checkpoint_write_run", payload: WakeSchedulerNavigationCheckpointWriteRunInput): Promise<WakeSchedulerNavigationCheckpointWriteRunResult>
  command(name: "runtime.list_wake_scheduler_navigation_checkpoint_write_runs", payload?: WakeSchedulerNavigationCheckpointWriteRunListInput): Promise<WakeSchedulerNavigationCheckpointWriteRunRecord[]>
  command(name: "runtime.get_wake_scheduler_navigation_checkpoint_write_run", payload: { runId: string } | { run_id: string }): Promise<WakeSchedulerNavigationCheckpointWriteRunResult | null>
  command(name: "runtime.wake_scheduler_navigation_checkpoint_write_history", payload?: WakeSchedulerNavigationCheckpointWriteHistoryInput): Promise<WakeSchedulerNavigationCheckpointWriteHistory>
  command(name: "runtime.wake_scheduler_navigation_checkpoint_write_compare", payload: WakeSchedulerNavigationCheckpointWriteCompareInput): Promise<WakeSchedulerNavigationCheckpointWritePairComparison>
  command(name: "runtime.wake_scheduler_navigation_checkpoint_write_stale", payload?: WakeSchedulerNavigationCheckpointWriteStaleInput): Promise<WakeSchedulerNavigationCheckpointWriteStaleItem[]>
  command(name: "runtime.wake_scheduler_navigation_checkpoint_write_group", payload: WakeSchedulerNavigationCheckpointWriteGroupInput): Promise<WakeSchedulerNavigationCheckpointWriteGroup | null>
  command(name: "runtime.wake_scheduler_navigation_checkpoint_write_approval_usage", payload?: WakeSchedulerNavigationCheckpointApprovalUsageInput): Promise<WakeSchedulerNavigationCheckpointApprovalUsageSummary>
  command(name: "runtime.list_wake_scheduler_events", payload?: { limit?: number }): Promise<WakeSchedulerEventRecord[]>
  command(name: "research.list_topics", payload?: { query?: string }): Promise<Topic[]>
  command(name: "research.get_topic_snapshot", payload: { topicId: string }): Promise<TopicSnapshot | null>
  command(name: "research.list_events", payload?: { options?: ListResearchEventsOptions }): Promise<ResearchEvent[]>
  command(name: "research.search_notes", payload: { topicId: string; query: string; options?: SearchOptions }): Promise<Note[]>
  command(name: "research.projection_status"): Promise<RuntimeResearchProjectionHealth>
  command(name: "research.rebuild_projection", payload?: { force?: boolean }): Promise<RuntimeResearchProjectionHealth>
  command(name: "runtime.submit_user_message", payload: { message: string }): Promise<SubmitUserMessageResult>
  submitUserMessage(message: string): Promise<SubmitUserMessageResult>
  stream(): AsyncIterable<RuntimeEvent>
}

export interface RuntimeCommandEnvelope {
  command:
    | "runtime.status"
    | "runtime.reasoning_provider_status"
    | "runtime.reasoning_provider_health"
    | "runtime.preview_reasoning_provider_smoke"
    | "runtime.execute_reasoning_provider_smoke"
    | "runtime.preview_minimax_live_validation"
    | "runtime.execute_minimax_live_validation"
    | "runtime.list_minimax_live_validations"
    | "runtime.get_minimax_live_validation"
    | "runtime.resume"
    | "runtime.start_new_session"
    | "runtime.view_records"
    | "runtime.get_mission"
    | "runtime.list_recent_missions"
    | "runtime.claim_mission"
    | "runtime.record_mission_progress"
    | "runtime.submit_mission_result"
    | "runtime.complete_mission"
    | "runtime.fail_mission"
    | "runtime.cancel_mission"
    | "runtime.release_mission_claim"
    | "runtime.list_mission_claims"
    | "runtime.list_mission_progress"
    | "runtime.list_mission_results"
    | "runtime.create_review_request"
    | "runtime.get_review_request"
    | "runtime.list_review_requests"
    | "runtime.approve_review_request"
    | "runtime.reject_review_request"
    | "runtime.cancel_review_request"
    | "runtime.review_status"
    | "runtime.create_commander_proposal"
    | "runtime.get_commander_proposal"
    | "runtime.list_commander_proposals"
    | "runtime.request_proposal_review"
    | "runtime.cancel_commander_proposal"
    | "runtime.apply_commander_proposal"
    | "runtime.proposal_status"
    | "runtime.create_proposal_bundle"
    | "runtime.get_proposal_bundle"
    | "runtime.list_proposal_bundles"
    | "runtime.add_proposal_to_bundle"
    | "runtime.proposal_bundle_readiness"
    | "runtime.request_proposal_bundle_reviews"
    | "runtime.apply_proposal_bundle"
    | "runtime.cancel_proposal_bundle"
    | "runtime.proposal_bundle_status"
    | "runtime.list_commander_playbooks"
    | "runtime.get_commander_playbook"
    | "runtime.draft_commander_playbook"
    | "runtime.get_commander_playbook_draft"
    | "runtime.list_commander_playbook_drafts"
    | "runtime.commander_playbook_draft_status"
    | "runtime.commander_playbook_draft_readiness"
    | "runtime.request_commander_playbook_draft_reviews"
    | "runtime.cancel_commander_playbook_draft"
    | "runtime.commander_apply_preview"
    | "runtime.apply_commander_target"
    | "runtime.commander_audit_timeline"
    | "runtime.commander_authority_chain"
    | "runtime.commander_queue_summary"
    | "runtime.commander_queue"
    | "runtime.commander_target_context"
    | "runtime.list_external_api_connectors"
    | "runtime.get_external_api_connector"
    | "runtime.preview_external_api_request"
    | "runtime.execute_external_api_request"
    | "runtime.list_external_api_audit"
    | "runtime.preview_external_api_research_ingestion"
    | "runtime.execute_external_api_research_ingestion"
    | "runtime.list_external_api_research_ingestions"
    | "runtime.preview_research_synthesis"
    | "runtime.execute_research_synthesis"
    | "runtime.get_research_synthesis"
    | "runtime.list_research_syntheses"
    | "runtime.preview_commander_cycle"
    | "runtime.execute_commander_cycle"
    | "runtime.get_commander_cycle"
    | "runtime.list_commander_cycles"
    | "runtime.preview_opencode_handoff"
    | "runtime.execute_opencode_handoff"
    | "runtime.list_opencode_handoffs"
    | "runtime.get_opencode_handoff"
    | "runtime.preview_opencode_process_smoke"
    | "runtime.execute_opencode_process_smoke"
    | "runtime.list_opencode_process_smokes"
    | "runtime.get_opencode_process_smoke"
    | "runtime.preview_opencode_handoff_readiness"
    | "runtime.opencode_handoff_readiness_summary"
    | "runtime.preview_opencode_result_review_packet"
    | "runtime.opencode_result_review_summary"
    | "runtime.preview_opencode_session_plan"
    | "runtime.create_opencode_session_plan"
    | "runtime.list_opencode_sessions"
    | "runtime.get_opencode_session"
    | "runtime.opencode_session_summary"
    | "runtime.list_model_capabilities"
    | "runtime.get_model_capability"
    | "runtime.context_budget_summary"
    | "runtime.preview_context_budget"
    | "runtime.preview_context_packet"
    | "runtime.context_packet_summary"
    | "runtime.preview_opencode_session_instruction_pack"
    | "runtime.write_opencode_session_instruction_pack"
    | "runtime.list_opencode_session_instruction_packs"
    | "runtime.get_opencode_session_instruction_pack"
    | "runtime.preview_opencode_launch_readiness"
    | "runtime.opencode_launch_readiness_summary"
    | "runtime.preview_commander_executor_review"
    | "runtime.execute_commander_executor_review"
    | "runtime.list_commander_executor_reviews"
    | "runtime.get_commander_executor_review"
    | "runtime.preview_executor_review_proposal_drafts"
    | "runtime.executor_review_proposal_draft_summary"
    | "runtime.preview_executor_review_proposal_create"
    | "runtime.create_executor_review_proposal"
    | "runtime.list_executor_review_proposal_creates"
    | "runtime.get_executor_review_proposal_create"
    | "runtime.preview_executor_review_proposal_review_request"
    | "runtime.request_executor_review_proposal_review"
    | "runtime.list_executor_review_proposal_review_requests"
    | "runtime.get_executor_review_proposal_review_request"
    | "runtime.preview_executor_review_proposal_review_decision"
    | "runtime.decide_executor_review_proposal_review"
    | "runtime.list_executor_review_proposal_review_decisions"
    | "runtime.get_executor_review_proposal_review_decision"
    | "runtime.preview_executor_review_proposal_apply_readiness"
    | "runtime.executor_review_proposal_apply_readiness_summary"
    | "runtime.list_executor_review_proposal_apply_readiness"
    | "runtime.get_executor_review_proposal_apply_readiness"
    | "runtime.preview_executor_review_proposal_narrow_apply"
    | "runtime.apply_executor_review_proposal_narrow"
    | "runtime.list_executor_review_proposal_narrow_applies"
    | "runtime.get_executor_review_proposal_narrow_apply"
    | "runtime.get_opencode_handoff_followup"
    | "runtime.list_opencode_handoff_followups"
    | "runtime.opencode_handoff_followup_summary"
    | "runtime.opencode_handoff_followup_queue"
    | "runtime.preview_runtime_checkpoint"
    | "runtime.create_runtime_checkpoint"
    | "runtime.get_runtime_checkpoint"
    | "runtime.list_runtime_checkpoints"
    | "runtime.preview_checkpoint_restore"
    | "runtime.mark_checkpoint_resume_anchor"
    | "runtime.get_checkpoint_resume_anchor"
    | "runtime.list_checkpoint_resume_anchors"
    | "runtime.preview_wake_assessment"
    | "runtime.create_wake_assessment"
    | "runtime.get_wake_assessment"
    | "runtime.list_wake_assessments"
    | "runtime.preview_continuation_plan"
    | "runtime.create_continuation_plan"
    | "runtime.get_continuation_plan"
    | "runtime.list_continuation_plans"
    | "runtime.execute_continuation_step"
    | "runtime.pause_continuation_plan"
    | "runtime.cancel_continuation_plan"
    | "runtime.preview_wake_schedule"
    | "runtime.create_wake_schedule"
    | "runtime.get_wake_schedule"
    | "runtime.list_wake_schedules"
    | "runtime.pause_wake_schedule"
    | "runtime.resume_wake_schedule"
    | "runtime.cancel_wake_schedule"
    | "runtime.preview_wake_schedule_tick"
    | "runtime.execute_wake_schedule_tick"
    | "runtime.list_wake_schedule_ticks"
    | "runtime.get_wake_schedule_tick"
    | "runtime.preview_wake_scheduler_start"
    | "runtime.start_wake_scheduler"
    | "runtime.stop_wake_scheduler"
    | "runtime.wake_scheduler_status"
    | "runtime.wake_scheduler_bootstrap_status"
    | "runtime.preview_wake_scheduler_bootstrap"
    | "runtime.preview_wake_scheduler_recovery"
    | "runtime.get_wake_scheduler_recovery"
    | "runtime.list_wake_scheduler_recoveries"
    | "runtime.acknowledge_wake_scheduler_recovery"
    | "runtime.preview_wake_scheduler_recovery_workflow"
    | "runtime.create_wake_scheduler_recovery_workflow"
    | "runtime.get_wake_scheduler_recovery_workflow"
    | "runtime.list_wake_scheduler_recovery_workflows"
    | "runtime.record_wake_scheduler_recovery_workflow_step"
    | "runtime.cancel_wake_scheduler_recovery_workflow"
    | "runtime.verify_wake_scheduler_recovery_workflow"
    | "runtime.wake_scheduler_audit_summary"
    | "runtime.wake_scheduler_audit_timeline"
    | "runtime.wake_scheduler_audit_chain"
    | "runtime.wake_scheduler_audit_incidents"
    | "runtime.wake_scheduler_navigation_board"
    | "runtime.preview_wake_scheduler_navigation_command"
    | "runtime.get_wake_scheduler_navigation_target"
    | "runtime.preview_wake_scheduler_navigation_stage"
    | "runtime.stage_wake_scheduler_navigation_command"
    | "runtime.list_wake_scheduler_navigation_staged_commands"
    | "runtime.remove_wake_scheduler_navigation_staged_command"
    | "runtime.clear_wake_scheduler_navigation_staged_commands"
    | "runtime.preview_wake_scheduler_navigation_staged_read"
    | "runtime.execute_wake_scheduler_navigation_staged_read"
    | "runtime.list_wake_scheduler_navigation_staged_read_runs"
    | "runtime.get_wake_scheduler_navigation_staged_read_run"
    | "runtime.wake_scheduler_navigation_staged_read_history"
    | "runtime.wake_scheduler_navigation_staged_read_compare"
    | "runtime.wake_scheduler_navigation_staged_read_stale"
    | "runtime.wake_scheduler_navigation_staged_read_group"
    | "runtime.preview_wake_scheduler_navigation_write_command"
    | "runtime.wake_scheduler_navigation_write_board"
    | "runtime.preview_wake_scheduler_navigation_write_stage"
    | "runtime.stage_wake_scheduler_navigation_write_command"
    | "runtime.get_wake_scheduler_navigation_staged_write_command"
    | "runtime.list_wake_scheduler_navigation_staged_write_commands"
    | "runtime.remove_wake_scheduler_navigation_staged_write_command"
    | "runtime.clear_wake_scheduler_navigation_staged_write_commands"
    | "runtime.preview_wake_scheduler_navigation_write_run"
    | "runtime.execute_wake_scheduler_navigation_write_run"
    | "runtime.list_wake_scheduler_navigation_write_runs"
    | "runtime.get_wake_scheduler_navigation_write_run"
    | "runtime.wake_scheduler_navigation_write_run_history"
    | "runtime.wake_scheduler_navigation_write_run_compare"
    | "runtime.wake_scheduler_navigation_write_run_stale"
    | "runtime.wake_scheduler_navigation_write_run_group"
    | "runtime.preview_wake_scheduler_navigation_write_readiness"
    | "runtime.approve_wake_scheduler_navigation_staged_write"
    | "runtime.reject_wake_scheduler_navigation_staged_write"
    | "runtime.revoke_wake_scheduler_navigation_write_approval"
    | "runtime.get_wake_scheduler_navigation_write_approval"
    | "runtime.list_wake_scheduler_navigation_write_approvals"
    | "runtime.preview_wake_scheduler_navigation_checkpoint_write_run"
    | "runtime.execute_wake_scheduler_navigation_checkpoint_write_run"
    | "runtime.list_wake_scheduler_navigation_checkpoint_write_runs"
    | "runtime.get_wake_scheduler_navigation_checkpoint_write_run"
    | "runtime.wake_scheduler_navigation_checkpoint_write_history"
    | "runtime.wake_scheduler_navigation_checkpoint_write_compare"
    | "runtime.wake_scheduler_navigation_checkpoint_write_stale"
    | "runtime.wake_scheduler_navigation_checkpoint_write_group"
    | "runtime.wake_scheduler_navigation_checkpoint_write_approval_usage"
    | "runtime.list_wake_scheduler_events"
    | "research.list_topics"
    | "research.get_topic_snapshot"
    | "research.list_events"
    | "research.search_notes"
    | "research.projection_status"
    | "research.rebuild_projection"
    | "runtime.submit_user_message"
    | "runtime.shutdown"
  payload?: Record<string, unknown>
}
