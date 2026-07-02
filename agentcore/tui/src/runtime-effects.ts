import { redactText, redactUnknown } from "./redaction"
import { parseRuntimeCommand, type KeySideEffect } from "./keyboard"
import {
  executionCommandFor,
  stageExplicitCommand,
  stageSuggestedCommand,
  type OperatorCommandExecutionResult,
  type OperatorStagedCommand,
  withExecutionCommand,
} from "./operator-actions"
import type { RuntimeClient, SubmitUserMessageResult } from "./runtime"
import type {
  ExecutorClaimSummary,
  MissionRecord,
  MissionExecutionState,
  MissionProgressSummary,
  MissionResultSummary,
  MissionSummaryState,
  OpenCodeHandoffPreviewSummary,
  OpenCodeProcessSmokePreviewSummary,
  OpenCodeProcessSmokeRecordSummary,
  OpenCodeProcessSmokeResultSummary,
  OpenCodeProcessSmokeState,
  OpenCodeHandoffReadinessCommandSummary,
  OpenCodeHandoffReadinessEvidenceSummary,
  OpenCodeHandoffReadinessPreviewSummary,
  OpenCodeHandoffReadinessState,
  OpenCodeHandoffReadinessSummary,
  OpenCodeResultReviewCommandSummary,
  OpenCodeResultReviewEvidenceSummary,
  OpenCodeResultReviewPacketRecordSummary,
  OpenCodeResultReviewPacketSummary,
  OpenCodeResultReviewState,
  OpenCodeResultReviewSummary,
  OpenCodeSessionPlanSummary,
  OpenCodeSessionPreviewSummary,
  OpenCodeSessionRecordSummary,
  OpenCodeSessionsState,
  OpenCodeSessionSummary,
  ModelCapabilitySummary,
  ContextBudgetPreviewSummary,
  ContextBudgetProfileSummary,
  ContextBudgetSummaryState,
  ContextBudgetsState,
  ContextPacketPreviewSummary,
  ContextPacketSummaryState,
  ContextPacketsState,
  OpenCodeSessionInstructionPackPreviewSummary,
  OpenCodeSessionInstructionPackRecordSummary,
  OpenCodeSessionInstructionPackResultSummary,
  OpenCodeSessionInstructionPacksState,
  ResearchMemoryCandidateSummary,
  ResearchMemoryRetrievalPreviewSummary,
  ResearchMemoryState,
  ResearchMemorySummaryState,
  ResearchNoveltyPreviewSummary,
  CommanderExecutorReviewCommandSummary,
  CommanderExecutorReviewFindingSummary,
  CommanderExecutorReviewPreviewSummary,
  CommanderExecutorReviewRecordSummary,
  CommanderExecutorReviewResultSummary,
  CommanderExecutorReviewState,
  ExecutorReviewProposalDraftCandidateSummary,
  ExecutorReviewProposalDraftCommandSummary,
  ExecutorReviewProposalDraftPreviewSummary,
  ExecutorReviewProposalDraftState,
  ExecutorReviewProposalDraftSummary,
  ExecutorReviewProposalCreateCommandSummary,
  ExecutorReviewProposalCreatePreviewSummary,
  ExecutorReviewProposalCreateRecordSummary,
  ExecutorReviewProposalCreateResultSummary,
  ExecutorReviewProposalCreateState,
  ExecutorReviewProposalReviewRequestCommandSummary,
  ExecutorReviewProposalReviewRequestPreviewSummary,
  ExecutorReviewProposalReviewRequestRecordSummary,
  ExecutorReviewProposalReviewRequestResultSummary,
  ExecutorReviewProposalReviewRequestState,
  ExecutorReviewProposalReviewDecisionCommandSummary,
  ExecutorReviewProposalReviewDecisionPreviewSummary,
  ExecutorReviewProposalReviewDecisionRecordSummary,
  ExecutorReviewProposalReviewDecisionResultSummary,
  ExecutorReviewProposalReviewDecisionState,
  ExecutorReviewProposalApplyReadinessPreviewSummary,
  ExecutorReviewProposalApplyReadinessRecordSummary,
  ExecutorReviewProposalApplyReadinessState,
  ExecutorReviewProposalApplyReadinessSummary,
  ExecutorReviewProposalApplyReadinessCommandSummary,
  ExecutorReviewProposalNarrowApplyCommandSummary,
  ExecutorReviewProposalNarrowApplyPreviewSummary,
  ExecutorReviewProposalNarrowApplyRecordSummary,
  ExecutorReviewProposalNarrowApplyResultSummary,
  ExecutorReviewProposalNarrowApplyState,
  OpenCodeLaunchReadinessCheckSummary,
  OpenCodeLaunchReadinessCommandSummary,
  OpenCodeLaunchReadinessPreviewSummary,
  OpenCodeLaunchReadinessSourceRefSummary,
  OpenCodeLaunchReadinessState,
  OpenCodeLaunchReadinessSummaryState,
  OpenCodeLaunchCommandSummary,
  OpenCodeLaunchPreviewSummary,
  OpenCodeLaunchRecordSummary,
  OpenCodeLaunchResultSummary,
  OpenCodeLaunchesState,
  OpenCodeProgressCommandSummary,
  OpenCodeProgressPreviewSummary,
  OpenCodeProgressRecordSummary,
  OpenCodeProgressResultSummary,
  OpenCodeProgressState,
  OpenCodeProgressSummaryState,
  OpenCodeForcedReportRequestSummary,
  OpenCodeCommanderQuestionCommandSummary,
  OpenCodeCommanderQuestionPreviewSummary,
  OpenCodeCommanderQuestionRecordSummary,
  OpenCodeCommanderQuestionResultSummary,
  OpenCodeCommanderQuestionSummaryState,
  OpenCodeCommanderQuestionsState,
  OpenCodeWatchdogCommandSummary,
  OpenCodeWatchdogPreviewSummary,
  OpenCodeWatchdogRecordSummary,
  OpenCodeWatchdogResultSummary,
  OpenCodeWatchdogState,
  OpenCodeWatchdogSummaryState,
  OpenCodeHandoffRecordSummary,
  OpenCodeHandoffResultSummary,
  OpenCodeHandoffState,
  OpenCodeHandoffFollowupCounts,
  OpenCodeHandoffFollowupQueueKind,
  OpenCodeHandoffFollowupState,
  RuntimeCheckpointPreviewSummary,
  RuntimeCheckpointRecordSummary,
  RuntimeCheckpointScope,
  RuntimeCheckpointSectionSummary,
  RuntimeCheckpointSummary,
  RuntimeCheckpointsState,
  RuntimeRestorePreviewSummary,
  RuntimeRestoreState,
  RuntimeResumeAnchorSummary,
  WakeAssessmentPreviewSummary,
  WakeAssessmentRecordSummary,
  WakeAssessmentState,
  WakeAssessmentSummary,
  WakeSuggestedCommandSummary,
  OpenCodeHandoffFollowupSummary,
  CommanderApplyPreviewSummary,
  CommanderApplyResultSummary,
  CommanderApplyState,
  CommanderAuditEventSummary,
  CommanderAuditState,
  CommanderAuthorityChainSummary,
  CommanderQueueItemSummary,
  CommanderQueueKind,
  CommanderQueuesState,
  CommanderQueueSummary,
  CommanderCyclePreviewSummary,
  CommanderCycleRecordSummary,
  CommanderCycleResultSummary,
  CommanderCycleState,
  CommanderNavigationState,
  OperatorActionsState,
  CommanderSuggestedCommandSummary,
  CommanderTargetContextSummary,
  CommanderTargetType,
  CommanderWorkbenchDraftSummary,
  CommanderWorkbenchReadinessSummary,
  CommanderWorkbenchState,
  CommanderWorkbenchStatusSummary,
  ContinuationPlanPreviewSummary,
  ContinuationPlanRecordSummary,
  ContinuationPlanSummary,
  ContinuationState,
  ContinuationStepPreviewSummary,
  ContinuationStepResultSummary,
  ContinuationStepSummary,
  WakeScheduleDueItemSummary,
  WakeSchedulePreviewSummary,
  WakeScheduleRecordSummary,
  WakeSchedulesState,
  WakeSchedulerConfigSummary,
  WakeSchedulerEventRecordSummary,
  WakeSchedulerBootstrapStatusSummary,
  WakeSchedulerPreviewSummary,
  WakeSchedulerRecoveryPreviewSummary,
  WakeSchedulerRecoveryRecordSummary,
  WakeSchedulerRecoverySummary,
  WakeSchedulerRecoveryWorkflowPreviewSummary,
  WakeSchedulerRecoveryWorkflowRecordSummary,
  WakeSchedulerRecoveryWorkflowStepSummary,
  WakeSchedulerRecoveryWorkflowSummary,
  WakeSchedulerRecoveryWorkflowVerificationSummary,
  WakeSchedulerAuditChainSummary,
  WakeSchedulerAuditCommandSummary,
  WakeSchedulerAuditIncidentSummary,
  WakeSchedulerAuditSummarySummary,
  WakeSchedulerAuditTimelineEntrySummary,
  WakeSchedulerNavigationBoardSummary,
  WakeSchedulerNavigationCardSummary,
  WakeSchedulerNavigationCommandPreviewSummary,
  WakeSchedulerNavigationStagePreviewSummary,
  WakeSchedulerNavigationStagedRunPreviewSummary,
  WakeSchedulerNavigationStagedRunRecordSummary,
  WakeSchedulerNavigationStagedRunResultSummary,
  WakeSchedulerNavigationStagedReadCompareCommandSummary,
  WakeSchedulerNavigationStagedReadGroupSummary,
  WakeSchedulerNavigationStagedReadHistorySummary,
  WakeSchedulerNavigationStagedReadPairComparisonSummary,
  WakeSchedulerNavigationStagedReadStaleItemSummary,
  WakeSchedulerNavigationStagedCommandRecordSummary,
  WakeSchedulerNavigationStagedCommandSummary,
  WakeSchedulerNavigationTargetSummary,
  WakeSchedulerNavigationWriteBoardSummary,
  WakeSchedulerNavigationWriteCommandSummary,
  WakeSchedulerNavigationWritePrerequisiteSummary,
  WakeSchedulerNavigationWritePreviewSummary,
  WakeSchedulerNavigationStagedWriteCommandRecordSummary,
  WakeSchedulerNavigationStagedWriteCommandSummary,
  WakeSchedulerNavigationWriteRunPreviewSummary,
  WakeSchedulerNavigationWriteRunRecordSummary,
  WakeSchedulerNavigationWriteRunResultSummary,
  WakeSchedulerNavigationWriteRunCompareCommandSummary,
  WakeSchedulerNavigationWriteRunGroupSummary,
  WakeSchedulerNavigationWriteRunHistorySummary,
  WakeSchedulerNavigationWriteRunPairComparisonSummary,
  WakeSchedulerNavigationWriteRunStaleItemSummary,
  WakeSchedulerNavigationWriteApprovalRecordSummary,
  WakeSchedulerNavigationWriteApprovalSummary,
  WakeSchedulerNavigationCheckpointWriteRunPreviewSummary,
  WakeSchedulerNavigationCheckpointWriteRunRecordSummary,
  WakeSchedulerNavigationCheckpointWriteRunResultSummary,
  WakeSchedulerNavigationCheckpointApprovalUsageSummary,
  WakeSchedulerNavigationCheckpointApprovalUsageSummaryState,
  WakeSchedulerNavigationCheckpointWriteCompareCommandSummary,
  WakeSchedulerNavigationCheckpointWriteGroupSummary,
  WakeSchedulerNavigationCheckpointWriteHistorySummary,
  WakeSchedulerNavigationCheckpointWritePairComparisonSummary,
  WakeSchedulerNavigationCheckpointWriteStaleItemSummary,
  WakeSchedulerNavigationWriteEvidenceSummary,
  WakeSchedulerNavigationWriteReadinessPreviewSummary,
  WakeSchedulerNavigationWriteStageEligibilitySummary,
  WakeSchedulerNavigationWriteStagePreviewSummary,
  WakeSchedulerStateSummary,
  WakeSchedulerUiState,
  WakeScheduleSummary,
  WakeScheduleTickPreviewSummary,
  WakeScheduleTickResultSummary,
  ExternalApiAuditRecordSummary,
  ExternalApiConnectorSummary,
  ExternalApiResearchIngestionPreviewSummary,
  ExternalApiResearchIngestionRecordSummary,
  ExternalApiResearchIngestionResultSummary,
  ExternalApiResearchState,
  ExternalApiRequestPreviewSummary,
  ExternalApiRequestResultSummary,
  ExternalApiState,
  ResearchEventSummary,
  ResearchNoteSummary,
  ResearchProjectionSummary,
  ResearchProjectionUiSummary,
  ResearchRecordsState,
  ReasoningProviderStatusSummary,
  ResearchSynthesisPreviewSummary,
  ResearchSynthesisRecordSummary,
  ResearchSynthesisResultSummary,
  ResearchSynthesisState,
  CommanderProposalSummary,
  CommanderPlaybookDraftSummary,
  CommanderPlaybooksState,
  CommanderPlaybookSummary,
  CommanderProposalBundleSummary,
  ProposalBundleReadinessSummary,
  ProposalBundlesState,
  ProposalBundleStatusSummary,
  ProposalsState,
  ProposalStatusSummary,
  CommandAuthorityRecordSummary,
  CommandAuthorityState,
  CommandAuthoritySummaryState,
  CommandAuthorityValidationProfileSummary,
  ReasoningProviderHealthCheckSummary,
  ReasoningProviderHealthSummary,
  MiniMaxLiveValidationCommandSummary,
  MiniMaxLiveValidationPreviewSummary,
  MiniMaxLiveValidationRecordSummary,
  MiniMaxLiveValidationResultSummary,
  MiniMaxLiveValidationState,
  MiniMaxLiveValidationSurfaceResultSummary,
  ReasoningProviderSmokePreviewSummary,
  ReasoningProviderSmokeResultSummary,
  ReviewRequestSummary,
  ReviewsState,
  ReviewStatusSummary,
  ResearchTopicSnapshotSummary,
  ResearchTopicSummary,
  RuntimeStatusSummary,
  UiState,
} from "./state"

const RESEARCH_TOPIC_LIMIT = 10
const RESEARCH_NOTE_LIMIT = 10
const RESEARCH_EVENT_LIMIT = 10
const MISSION_EXECUTION_LIMIT = 10
const REVIEW_LIMIT = 10
const PROPOSAL_LIMIT = 10
const PROPOSAL_BUNDLE_LIMIT = 10
const PLAYBOOK_LIMIT = 10
const WORKBENCH_DRAFT_LIMIT = 10
const AUDIT_LIMIT = 20
const QUEUE_LIMIT = 20
const EXTERNAL_API_LIMIT = 20
const SYNTHESIS_LIMIT = 20
const CYCLE_LIMIT = 20
const HANDOFF_LIMIT = 20
const CHECKPOINT_LIMIT = 20
const PREVIEW_LENGTH = 160

export type RuntimeUiEffect =
  | KeySideEffect
  | { type: "load-runtime-status" }
  | { type: "load-command-authority-summary" }
  | { type: "load-command-authority-list"; risk?: string; gate?: string; owner?: string; limit?: number }
  | { type: "load-command-authority-record"; command: string }
  | { type: "load-command-authority-validation-profile"; command: string; changedFiles?: string[] }
  | { type: "load-reasoning-provider-status" }
  | { type: "load-reasoning-provider-health" }
  | { type: "preview-reasoning-provider-smoke"; surface?: string }
  | { type: "execute-reasoning-provider-smoke"; surface?: string; dryRun?: boolean }
  | { type: "preview-minimax-live-validation"; surfaces?: string[]; timeoutMs?: number }
  | { type: "execute-minimax-live-validation"; surfaces?: string[]; dryRun?: boolean; timeoutMs?: number }
  | { type: "load-minimax-live-validations"; limit?: number }
  | { type: "load-minimax-live-validation"; validationId: string }
  | { type: "load-recent-missions"; limit?: number }
  | { type: "refresh-runtime-records" }
  | { type: "load-research-topics"; query?: string; limit?: number }
  | { type: "load-research-topic-snapshot"; topicId: string }
  | { type: "search-research-notes"; topicId: string; query: string; limit?: number }
  | { type: "load-research-events"; limit?: number }
  | { type: "load-research-projection-status" }
  | { type: "rebuild-research-projection" }
  | { type: "refresh-research-records" }
  | { type: "load-mission-details"; missionId: string }
  | { type: "load-mission-execution-records"; missionId: string }
  | { type: "load-mission-claims"; missionId: string }
  | { type: "load-mission-progress"; missionId: string }
  | { type: "load-mission-results"; missionId: string }
  | { type: "claim-mission"; missionId: string; executorId: string }
  | { type: "record-mission-progress"; missionId: string; claimId: string; message: string }
  | { type: "submit-mission-result"; missionId: string; claimId: string; summary: string }
  | { type: "complete-mission"; missionId: string; resultId?: string; summary?: string }
  | { type: "fail-mission"; missionId: string; reason: string }
  | { type: "cancel-mission"; missionId: string; reason?: string }
  | { type: "release-mission-claim"; claimId: string; reason?: string }
  | { type: "load-reviews"; limit?: number }
  | { type: "load-review"; reviewId: string }
  | { type: "create-review-request"; missionId: string; title: string; summary: string }
  | { type: "approve-review"; reviewId: string; reason?: string }
  | { type: "reject-review"; reviewId: string; reason: string }
  | { type: "cancel-review"; reviewId: string; reason?: string }
  | { type: "load-proposals"; limit?: number }
  | { type: "load-proposal"; proposalId: string }
  | { type: "create-proposal"; actionKind: string; missionId?: string; claimId?: string; resultId?: string; title: string; summary: string; actionPayload: Record<string, unknown> }
  | { type: "request-proposal-review"; proposalId: string; title: string; summary: string }
  | { type: "apply-proposal"; proposalId: string }
  | { type: "cancel-proposal"; proposalId: string; reason?: string }
  | { type: "load-proposal-bundles"; limit?: number }
  | { type: "load-proposal-bundle"; bundleId: string }
  | { type: "create-proposal-bundle"; title: string; summary: string }
  | { type: "add-proposal-to-bundle"; bundleId: string; proposalId: string }
  | { type: "load-proposal-bundle-readiness"; bundleId: string }
  | { type: "request-proposal-bundle-reviews"; bundleId: string }
  | { type: "apply-proposal-bundle"; bundleId: string }
  | { type: "cancel-proposal-bundle"; bundleId: string; reason?: string }
  | { type: "load-playbooks"; limit?: number }
  | { type: "load-playbook"; playbookId: string }
  | { type: "draft-playbook"; playbookId: string; fields: Record<string, string>; bundleTitle?: string; bundleSummary?: string; createBundle?: boolean; requestReviews?: boolean }
  | { type: "load-playbook-drafts"; limit?: number }
  | { type: "load-playbook-draft"; draftId: string }
  | { type: "load-playbook-draft-readiness"; draftId: string }
  | { type: "request-playbook-draft-reviews"; draftId: string }
  | { type: "cancel-playbook-draft"; draftId: string; reason?: string }
  | { type: "commander-apply-preview"; targetType: "proposal" | "bundle" | "draft"; targetId: string }
  | { type: "commander-apply-target"; targetType: "proposal" | "bundle" | "draft"; targetId: string; allowPartial?: boolean }
  | { type: "load-commander-audit"; limit?: number; category?: string }
  | { type: "load-commander-authority-chain"; targetType: string; targetId: string }
  | { type: "load-commander-queues"; queue?: CommanderQueueKind; limit?: number; staleAfterMs?: number }
  | { type: "load-commander-queue"; queue: CommanderQueueKind; limit?: number; staleAfterMs?: number }
  | { type: "load-commander-target-context"; targetType: CommanderTargetType; targetId: string }
  | { type: "load-external-api-connectors"; limit?: number }
  | { type: "load-external-api-connector"; connectorId: string }
  | { type: "preview-external-api-request"; connectorId: string; method: "GET" | "POST"; path: string; query?: Record<string, string> }
  | { type: "execute-external-api-request"; connectorId: string; method: "GET" | "POST"; path: string; query?: Record<string, string>; dryRun?: boolean }
  | { type: "load-external-api-audit"; limit?: number }
  | { type: "preview-external-api-research-ingestion"; connectorId: string; method: "GET" | "POST"; path: string; topicId: string; sourceTitle: string; noteTitle?: string; query?: Record<string, string>; tags?: string[] }
  | { type: "execute-external-api-research-ingestion"; connectorId: string; method: "GET" | "POST"; path: string; topicId: string; sourceTitle: string; noteTitle?: string; query?: Record<string, string>; tags?: string[]; dryRun?: boolean }
  | { type: "load-external-api-research-ingestions"; limit?: number }
  | { type: "preview-research-synthesis"; topicId: string; objective?: string }
  | { type: "execute-research-synthesis"; topicId: string; objective?: string; createProposals?: boolean }
  | { type: "load-research-synthesis"; synthesisId: string }
  | { type: "load-research-syntheses"; limit?: number }
  | { type: "preview-commander-cycle"; topicId?: string; missionId?: string; objective?: string }
  | { type: "execute-commander-cycle"; topicId?: string; missionId?: string; objective?: string; createProposals?: boolean; createBundle?: boolean }
  | { type: "load-commander-cycle"; cycleId: string }
  | { type: "load-commander-cycles"; limit?: number }
  | { type: "preview-opencode-handoff"; proposalId: string }
  | { type: "execute-opencode-handoff"; proposalId: string; dryRun?: boolean }
  | { type: "load-opencode-handoff"; handoffId: string }
  | { type: "load-opencode-handoffs"; limit?: number }
  | { type: "preview-opencode-process-smoke"; timeoutMs?: number }
  | { type: "execute-opencode-process-smoke"; dryRun?: boolean; timeoutMs?: number }
  | { type: "load-opencode-process-smokes"; limit?: number }
  | { type: "load-opencode-process-smoke"; smokeId: string }
  | { type: "preview-opencode-handoff-readiness"; proposalId?: string; reviewId?: string; missionId?: string; handoffId?: string; requireRecentSmoke?: boolean; maxSmokeAgeMs?: number }
  | { type: "load-opencode-handoff-readiness-summary"; maxSmokeAgeMs?: number }
  | { type: "preview-opencode-result-review-packet"; handoffId?: string; followupId?: string; missionId?: string; resultId?: string; proposalId?: string; staleAfterMs?: number }
  | { type: "load-opencode-result-review-summary"; staleAfterMs?: number; limit?: number }
  | { type: "preview-opencode-session-plan"; objective?: string; proposalId?: string; missionId?: string; reviewRequestId?: string; applyId?: string; title?: string; maxContextBytes?: number }
  | { type: "create-opencode-session-plan"; objective?: string; proposalId?: string; missionId?: string; reviewRequestId?: string; applyId?: string; title?: string; maxContextBytes?: number; dryRun?: boolean }
  | { type: "load-opencode-sessions"; limit?: number }
  | { type: "load-opencode-session"; sessionId: string }
  | { type: "load-opencode-session-summary" }
  | { type: "load-model-capabilities"; providerKind?: string; role?: string; limit?: number }
  | { type: "load-model-capability"; capabilityId?: string; providerKind?: string; modelId?: string }
  | { type: "load-context-budget-summary" }
  | { type: "preview-context-budget"; purpose?: string; role?: string; providerKind?: string; modelId?: string; sessionId?: string; maxContextTokens?: number; maxContextBytes?: number }
  | { type: "preview-context-packet"; purpose?: string; role?: string; providerKind?: string; modelId?: string; sessionId?: string; missionId?: string; proposalId?: string; reviewRequestId?: string; applyId?: string; maxContextTokens?: number; maxContextBytes?: number }
  | { type: "load-context-packet-summary" }
  | { type: "preview-opencode-session-instruction-pack"; sessionId?: string; providerKind?: string; modelId?: string; maxContextTokens?: number; maxContextBytes?: number; includeOpenCodeConfig?: boolean; includeManifest?: boolean }
  | { type: "write-opencode-session-instruction-pack"; sessionId?: string; providerKind?: string; modelId?: string; maxContextTokens?: number; maxContextBytes?: number; includeOpenCodeConfig?: boolean; includeManifest?: boolean; dryRun?: boolean }
  | { type: "load-opencode-session-instruction-packs"; sessionId?: string; status?: string; limit?: number }
  | { type: "load-opencode-session-instruction-pack"; packId: string }
  | { type: "preview-opencode-launch-readiness"; sessionId?: string; packId?: string; providerKind?: string; modelId?: string; maxContextTokens?: number; maxContextBytes?: number; includeResearchMemory?: boolean; includeNativeConfig?: boolean }
  | { type: "load-opencode-launch-readiness-summary"; limit?: number }
  | { type: "preview-opencode-session-launch"; sessionId?: string; packId?: string; readinessHash?: string; adapterKind?: string; providerKind?: string; modelId?: string; allowRealLaunch?: boolean }
  | { type: "launch-opencode-session"; sessionId?: string; packId?: string; readinessHash?: string; adapterKind?: string; providerKind?: string; modelId?: string; allowRealLaunch?: boolean; dryRun?: boolean }
  | { type: "load-opencode-session-launches"; sessionId?: string; status?: string; limit?: number }
  | { type: "load-opencode-session-launch"; launchId: string }
  | { type: "preview-opencode-progress"; sessionId?: string; launchId?: string; kind?: string; executionState?: string; reportSummary?: string; currentStep?: string; filesTouched?: string[]; commandsRun?: string[]; testsRun?: string[]; artifacts?: string[]; blockers?: string[]; question?: string; confidence?: number | string; nextAction?: string; sourceKind?: string }
  | { type: "record-opencode-progress"; sessionId?: string; launchId?: string; kind?: string; executionState?: string; reportSummary?: string; currentStep?: string; filesTouched?: string[]; commandsRun?: string[]; testsRun?: string[]; artifacts?: string[]; blockers?: string[]; question?: string; confidence?: number | string; nextAction?: string; sourceKind?: string; dryRun?: boolean }
  | { type: "load-opencode-progress-records"; sessionId?: string; launchId?: string; kind?: string; executionState?: string; limit?: number }
  | { type: "load-opencode-progress"; progressId: string }
  | { type: "load-latest-opencode-progress"; sessionId?: string; launchId?: string }
  | { type: "load-opencode-progress-summary"; limit?: number }
  | { type: "preview-opencode-watchdog"; sessionId?: string; launchId?: string; maxWallTimeMs?: number; maxNoProgressMs?: number; heartbeatIntervalMs?: number }
  | { type: "record-opencode-watchdog"; sessionId?: string; launchId?: string; maxWallTimeMs?: number; maxNoProgressMs?: number; heartbeatIntervalMs?: number; dryRun?: boolean; requestReport?: boolean }
  | { type: "request-opencode-forced-report"; sessionId?: string; launchId?: string; reason?: string; dryRun?: boolean }
  | { type: "load-opencode-watchdogs"; sessionId?: string; launchId?: string; status?: string; limit?: number }
  | { type: "load-opencode-watchdog"; watchdogId: string }
  | { type: "load-opencode-forced-report-requests"; sessionId?: string; launchId?: string; limit?: number }
  | { type: "load-opencode-forced-report-request"; requestId: string }
  | { type: "load-opencode-watchdog-summary"; limit?: number }
  | { type: "preview-opencode-commander-question"; sessionId?: string; launchId?: string; progressId?: string; watchdogId?: string; forcedReportRequestId?: string; question?: string; questionType?: string; urgency?: string; contextSummary?: string; optionsConsidered?: string[]; executorRecommendation?: string; sourceKind?: string }
  | { type: "create-opencode-commander-question"; sessionId?: string; launchId?: string; progressId?: string; watchdogId?: string; forcedReportRequestId?: string; question?: string; questionType?: string; urgency?: string; contextSummary?: string; optionsConsidered?: string[]; executorRecommendation?: string; sourceKind?: string; dryRun?: boolean }
  | { type: "load-opencode-commander-questions"; sessionId?: string; launchId?: string; status?: string; questionType?: string; urgency?: string; limit?: number }
  | { type: "load-opencode-commander-question"; questionId: string }
  | { type: "load-latest-opencode-commander-question"; sessionId?: string; launchId?: string }
  | { type: "load-opencode-commander-question-summary"; limit?: number }
  | { type: "load-research-memory-summary" }
  | { type: "preview-research-memory-retrieval"; query?: string; labels?: string[]; limit?: number; sourceKind?: string; missionId?: string; sessionId?: string; includeFailures?: boolean; includeArtifacts?: boolean }
  | { type: "preview-research-novelty-check"; question?: string; method?: string; config?: string; labels?: string[]; limit?: number; missionId?: string; sessionId?: string; repetitionReason?: string; includeFailures?: boolean }
  | { type: "preview-commander-executor-review"; handoffId?: string; followupId?: string; missionId?: string; resultId?: string; proposalId?: string }
  | { type: "execute-commander-executor-review"; handoffId?: string; followupId?: string; missionId?: string; resultId?: string; proposalId?: string; dryRun?: boolean }
  | { type: "load-commander-executor-reviews"; limit?: number }
  | { type: "load-commander-executor-review"; reviewId: string }
  | { type: "preview-executor-review-proposal-drafts"; reviewId?: string; packetId?: string; missionId?: string; resultId?: string; handoffId?: string; proposalId?: string; limit?: number }
  | { type: "load-executor-review-proposal-draft-summary"; limit?: number }
  | { type: "preview-executor-review-proposal-create"; reviewId: string; draftId: string }
  | { type: "create-executor-review-proposal"; reviewId: string; draftId: string; dryRun?: boolean }
  | { type: "load-executor-review-proposal-creates"; limit?: number }
  | { type: "load-executor-review-proposal-create"; createId: string }
  | { type: "preview-executor-review-proposal-review-request"; proposalId: string; createId?: string }
  | { type: "request-executor-review-proposal-review"; proposalId: string; createId?: string; dryRun?: boolean }
  | { type: "load-executor-review-proposal-review-requests"; limit?: number }
  | { type: "load-executor-review-proposal-review-request"; requestGateId: string }
  | { type: "preview-executor-review-proposal-review-decision"; reviewRequestId: string; decision: "approve" | "reject"; reason?: string; requestGateId?: string }
  | { type: "decide-executor-review-proposal-review"; reviewRequestId: string; decision: "approve" | "reject"; reason?: string; requestGateId?: string; dryRun?: boolean }
  | { type: "load-executor-review-proposal-review-decisions"; limit?: number }
  | { type: "load-executor-review-proposal-review-decision"; decisionGateId: string }
  | { type: "preview-executor-review-proposal-apply-readiness"; proposalId?: string; reviewRequestId?: string; decisionGateId?: string; createId?: string }
  | { type: "load-executor-review-proposal-apply-readiness-summary"; limit?: number }
  | { type: "load-executor-review-proposal-apply-readiness-list"; limit?: number; status?: string; candidateKind?: string; proposalId?: string }
  | { type: "load-executor-review-proposal-apply-readiness"; readinessId: string }
  | { type: "preview-executor-review-proposal-narrow-apply"; proposalId: string; readinessId?: string; reason?: string }
  | { type: "apply-executor-review-proposal-narrow"; proposalId: string; readinessId?: string; reason?: string; dryRun?: boolean }
  | { type: "load-executor-review-proposal-narrow-applies"; limit?: number }
  | { type: "load-executor-review-proposal-narrow-apply"; applyId: string }
  | { type: "load-opencode-handoff-followup"; handoffId: string }
  | { type: "load-opencode-handoff-followups"; limit?: number }
  | { type: "load-opencode-handoff-followup-summary" }
  | { type: "load-opencode-handoff-followup-queue"; queue: OpenCodeHandoffFollowupQueueKind; limit?: number }
  | { type: "preview-runtime-checkpoint"; scope?: RuntimeCheckpointScope; reason?: string }
  | { type: "create-runtime-checkpoint"; scope?: RuntimeCheckpointScope; reason?: string }
  | { type: "load-runtime-checkpoint"; checkpointId: string }
  | { type: "load-runtime-checkpoints"; limit?: number }
  | { type: "preview-checkpoint-restore"; checkpointId: string }
  | { type: "mark-checkpoint-resume-anchor"; checkpointId: string }
  | { type: "load-checkpoint-resume-anchor"; resumeId: string }
  | { type: "load-checkpoint-resume-anchors"; limit?: number }
  | { type: "preview-wake-assessment"; resumeId?: string; checkpointId?: string }
  | { type: "create-wake-assessment"; resumeId: string }
  | { type: "load-wake-assessment"; wakeId: string }
  | { type: "load-wake-assessments"; limit?: number }
  | { type: "preview-continuation-plan"; wakeId: string }
  | { type: "create-continuation-plan"; wakeId: string }
  | { type: "load-continuation-plan"; planId: string }
  | { type: "load-continuation-plans"; limit?: number }
  | { type: "execute-continuation-step"; planId: string; index?: number; dryRun?: boolean }
  | { type: "pause-continuation-plan"; planId: string }
  | { type: "cancel-continuation-plan"; planId: string }
  | { type: "preview-wake-schedule"; resumeId: string; intervalMs: number; title?: string }
  | { type: "create-wake-schedule"; resumeId: string; intervalMs: number; title?: string }
  | { type: "load-wake-schedule"; scheduleId: string }
  | { type: "load-wake-schedules"; limit?: number }
  | { type: "pause-wake-schedule"; scheduleId: string }
  | { type: "resume-wake-schedule"; scheduleId: string }
  | { type: "cancel-wake-schedule"; scheduleId: string }
  | { type: "preview-wake-schedule-tick" }
  | { type: "execute-wake-schedule-tick"; dryRun?: boolean }
  | { type: "load-wake-schedule-ticks"; limit?: number }
  | { type: "load-wake-schedule-tick"; tickId: string }
  | { type: "preview-wake-scheduler-start"; intervalMs?: number; maxDueItems?: number; dryRun?: boolean }
  | { type: "start-wake-scheduler"; intervalMs?: number; maxDueItems?: number; dryRun?: boolean }
  | { type: "stop-wake-scheduler"; reason?: string }
  | { type: "load-wake-scheduler-status" }
  | { type: "load-wake-scheduler-bootstrap-status" }
  | { type: "preview-wake-scheduler-bootstrap" }
  | { type: "preview-wake-scheduler-recovery" }
  | { type: "load-wake-scheduler-recoveries"; limit?: number }
  | { type: "load-wake-scheduler-recovery"; recoveryId: string }
  | { type: "acknowledge-wake-scheduler-recovery"; recoveryId?: string; resolution: "acknowledged" | "resolved" | "dismissed"; reason?: string }
  | { type: "preview-wake-scheduler-recovery-workflow"; recoveryId?: string }
  | { type: "create-wake-scheduler-recovery-workflow"; recoveryId?: string }
  | { type: "load-wake-scheduler-recovery-workflows"; limit?: number }
  | { type: "load-wake-scheduler-recovery-workflow"; workflowId: string }
  | { type: "verify-wake-scheduler-recovery-workflow"; workflowId: string }
  | { type: "record-wake-scheduler-recovery-workflow-step"; workflowId: string; index: number; status: "manually_done" | "skipped" | "blocked"; note?: string }
  | { type: "cancel-wake-scheduler-recovery-workflow"; workflowId: string; reason?: string }
  | { type: "load-wake-scheduler-audit-summary" }
  | { type: "load-wake-scheduler-audit-timeline"; limit?: number; kind?: string; severity?: string; relatedId?: string }
  | { type: "load-wake-scheduler-audit-chain"; relatedId: string; limit?: number }
  | { type: "load-wake-scheduler-audit-incidents"; limit?: number; status?: string; severity?: string }
  | { type: "load-wake-scheduler-navigation-board"; relatedId?: string; incidentId?: string; auditId?: string; command?: string; includeWrite?: boolean; limit?: number }
  | { type: "preview-wake-scheduler-navigation-command"; command: string }
  | { type: "load-wake-scheduler-navigation-target"; targetKind: string; targetId: string }
  | { type: "preview-wake-scheduler-navigation-stage"; command: string }
  | { type: "stage-wake-scheduler-navigation-command"; command: string }
  | { type: "load-wake-scheduler-navigation-staged-commands"; limit?: number }
  | { type: "remove-wake-scheduler-navigation-staged-command"; stagedId: string }
  | { type: "clear-wake-scheduler-navigation-staged-commands"; reason?: string }
  | { type: "preview-wake-scheduler-navigation-staged-read"; stagedId: string }
  | { type: "execute-wake-scheduler-navigation-staged-read"; stagedId: string }
  | { type: "dry-run-wake-scheduler-navigation-staged-read"; stagedId: string }
  | { type: "load-wake-scheduler-navigation-staged-read-runs"; limit?: number; stagedId?: string }
  | { type: "load-wake-scheduler-navigation-staged-read-run"; runId: string }
  | { type: "load-wake-scheduler-navigation-staged-read-history"; stagedId?: string; command?: string; limit?: number; staleAfterMs?: number }
  | { type: "compare-wake-scheduler-navigation-staged-read"; stagedId: string }
  | { type: "compare-wake-scheduler-navigation-staged-read-runs"; leftRunId: string; rightRunId: string }
  | { type: "load-wake-scheduler-navigation-staged-read-stale"; staleAfterMs?: number; limit?: number }
  | { type: "load-wake-scheduler-navigation-staged-read-group"; stagedId: string; limit?: number }
  | { type: "preview-wake-scheduler-navigation-write-command"; command: string }
  | { type: "load-wake-scheduler-navigation-write-board"; relatedId?: string; incidentId?: string; stagedId?: string; includeHighImpact?: boolean; limit?: number }
  | { type: "preview-wake-scheduler-navigation-write-stage"; command: string; allowMediumRisk?: boolean }
  | { type: "stage-wake-scheduler-navigation-write-command"; command: string; allowMediumRisk?: boolean }
  | { type: "load-wake-scheduler-navigation-staged-write-commands"; limit?: number }
  | { type: "load-wake-scheduler-navigation-staged-write-command"; stagedWriteId: string }
  | { type: "remove-wake-scheduler-navigation-staged-write-command"; stagedWriteId: string }
  | { type: "clear-wake-scheduler-navigation-staged-write-commands"; reason?: string }
  | { type: "preview-wake-scheduler-navigation-write-run"; stagedWriteId: string }
  | { type: "execute-wake-scheduler-navigation-write-run"; stagedWriteId: string }
  | { type: "dry-run-wake-scheduler-navigation-write-run"; stagedWriteId: string }
  | { type: "load-wake-scheduler-navigation-write-runs"; limit?: number; stagedWriteId?: string }
  | { type: "load-wake-scheduler-navigation-write-run"; runId: string }
  | { type: "load-wake-scheduler-navigation-write-run-history"; stagedWriteId?: string; command?: string; limit?: number; staleAfterMs?: number }
  | { type: "compare-wake-scheduler-navigation-write-run"; stagedWriteId: string }
  | { type: "compare-wake-scheduler-navigation-write-run-runs"; leftRunId: string; rightRunId: string }
  | { type: "load-wake-scheduler-navigation-write-run-stale"; staleAfterMs?: number; limit?: number }
  | { type: "load-wake-scheduler-navigation-write-run-group"; stagedWriteId: string; limit?: number }
  | { type: "preview-wake-scheduler-navigation-write-readiness"; stagedWriteId: string }
  | { type: "approve-wake-scheduler-navigation-staged-write"; stagedWriteId: string; reason?: string }
  | { type: "reject-wake-scheduler-navigation-staged-write"; stagedWriteId: string; reason?: string }
  | { type: "revoke-wake-scheduler-navigation-write-approval"; approvalId: string; reason?: string }
  | { type: "load-wake-scheduler-navigation-write-approvals"; limit?: number }
  | { type: "load-wake-scheduler-navigation-write-approval"; approvalId: string }
  | { type: "preview-wake-scheduler-navigation-checkpoint-write-run"; stagedWriteId: string }
  | { type: "execute-wake-scheduler-navigation-checkpoint-write-run"; stagedWriteId: string }
  | { type: "dry-run-wake-scheduler-navigation-checkpoint-write-run"; stagedWriteId: string }
  | { type: "load-wake-scheduler-navigation-checkpoint-write-runs"; limit?: number; stagedWriteId?: string }
  | { type: "load-wake-scheduler-navigation-checkpoint-write-run"; runId: string }
  | { type: "load-wake-scheduler-navigation-checkpoint-write-history"; stagedWriteId?: string; approvalId?: string; command?: string; limit?: number; staleAfterMs?: number }
  | { type: "compare-wake-scheduler-navigation-checkpoint-write"; stagedWriteId: string }
  | { type: "compare-wake-scheduler-navigation-checkpoint-write-runs"; leftRunId: string; rightRunId: string }
  | { type: "load-wake-scheduler-navigation-checkpoint-write-stale"; staleAfterMs?: number; limit?: number }
  | { type: "load-wake-scheduler-navigation-checkpoint-write-group"; stagedWriteId: string; limit?: number }
  | { type: "load-wake-scheduler-navigation-checkpoint-approval-usage"; approvalId?: string; stagedWriteId?: string; limit?: number; staleAfterMs?: number }
  | { type: "load-wake-scheduler-events"; limit?: number }

export async function applyRuntimeUiEffect(
  state: UiState,
  runtime: RuntimeClient,
  effect: RuntimeUiEffect,
): Promise<UiState> {
  try {
    switch (effect.type) {
      case "load-runtime-status":
        return applyRuntimeStatus(state, await runtime.command("runtime.status"))
      case "load-command-authority-summary":
        return applyCommandAuthoritySummary(state, await runtime.command("runtime.command_authority_summary"))
      case "load-command-authority-list":
        return applyCommandAuthorityRecords(state, await runtime.command("runtime.command_authority_list", {
          risk: effect.risk,
          gate: effect.gate,
          owner: effect.owner,
          limit: effect.limit ?? 20,
        }), effect.limit ?? 20)
      case "load-command-authority-record":
        return applyCommandAuthorityRecord(state, await runtime.command("runtime.command_authority_get", { command: effect.command }))
      case "load-command-authority-validation-profile":
        return applyCommandAuthorityValidationProfile(state, await runtime.command("runtime.command_authority_validation_profile", { command: effect.command, changedFiles: effect.changedFiles ?? [] }))
      case "load-reasoning-provider-status":
        return applyReasoningProviderStatus(state, await runtime.command("runtime.reasoning_provider_status"))
      case "load-reasoning-provider-health":
        return applyReasoningProviderHealth(state, await runtime.command("runtime.reasoning_provider_health"))
      case "preview-reasoning-provider-smoke":
        return applyReasoningProviderSmokePreview(state, await runtime.command("runtime.preview_reasoning_provider_smoke", { surface: effect.surface, requestedBy: "tui" }))
      case "execute-reasoning-provider-smoke":
        return applyReasoningProviderSmokeResult(state, await runtime.command("runtime.execute_reasoning_provider_smoke", { surface: effect.surface, dryRun: effect.dryRun === true, requestedBy: "tui" }))
      case "preview-minimax-live-validation":
        return applyMiniMaxLiveValidationPreview(state, await runtime.command("runtime.preview_minimax_live_validation", { surfaces: effect.surfaces, timeout_ms: effect.timeoutMs }))
      case "execute-minimax-live-validation": {
        const next = applyMiniMaxLiveValidationResult(state, await runtime.command("runtime.execute_minimax_live_validation", { surfaces: effect.surfaces, dry_run: effect.dryRun === true, timeout_ms: effect.timeoutMs, requested_by: "tui" }))
        return effect.dryRun === true ? next : applyMiniMaxLiveValidationRecords(next, await runtime.command("runtime.list_minimax_live_validations", { limit: HANDOFF_LIMIT }), HANDOFF_LIMIT, { preserveCommandError: true })
      }
      case "load-minimax-live-validations":
        return applyMiniMaxLiveValidationRecords(state, await runtime.command("runtime.list_minimax_live_validations", { limit: effect.limit ?? HANDOFF_LIMIT }), effect.limit ?? HANDOFF_LIMIT)
      case "load-minimax-live-validation":
        return applyMiniMaxLiveValidationResult(state, await runtime.command("runtime.get_minimax_live_validation", { validationId: effect.validationId }), effect.validationId)
      case "load-recent-missions":
        return applyRecentMissions(state, await runtime.command("runtime.list_recent_missions", { limit: effect.limit ?? 5 }))
      case "refresh-runtime-records":
        return await refreshRuntimeRecords(state, runtime)
      case "load-research-topics":
        return applyResearchTopics(
          state,
          await runtime.command("research.list_topics", effect.query ? { query: effect.query } : {}),
          effect.query,
          effect.limit ?? RESEARCH_TOPIC_LIMIT,
        )
      case "load-research-topic-snapshot":
        return applyResearchTopicSnapshot(
          state,
          await runtime.command("research.get_topic_snapshot", { topicId: effect.topicId }),
          effect.topicId,
        )
      case "search-research-notes":
        return applyResearchNotes(
          state,
          await runtime.command("research.search_notes", {
            topicId: effect.topicId,
            query: effect.query,
            options: { limit: effect.limit ?? RESEARCH_NOTE_LIMIT },
          }),
          effect.topicId,
          effect.query,
          effect.limit ?? RESEARCH_NOTE_LIMIT,
        )
      case "load-research-events":
        return applyResearchEvents(
          state,
          await runtime.command("research.list_events", { options: { limit: effect.limit ?? RESEARCH_EVENT_LIMIT } }),
          effect.limit ?? RESEARCH_EVENT_LIMIT,
        )
      case "load-research-projection-status":
        return applyResearchProjectionStatus(state, await runtime.command("research.projection_status"))
      case "rebuild-research-projection": {
        const next = applyResearchProjectionStatus(state, await runtime.command("research.rebuild_projection", { force: true }))
        return await refreshResearchRecordsOrRecordError(next, runtime)
      }
      case "refresh-research-records":
        return await refreshResearchRecords(state, runtime)
      case "load-mission-details":
        return applyMissionDetails(state, await runtime.command("runtime.get_mission", { missionId: effect.missionId }), effect.missionId)
      case "load-mission-execution-records":
        return await loadMissionExecutionRecords(state, runtime, effect.missionId)
      case "load-mission-claims":
        return applyMissionClaims(state, await runtime.command("runtime.list_mission_claims", { missionId: effect.missionId }), effect.missionId)
      case "load-mission-progress":
        return applyMissionProgress(state, await runtime.command("runtime.list_mission_progress", { missionId: effect.missionId }), effect.missionId)
      case "load-mission-results":
        return applyMissionResults(state, await runtime.command("runtime.list_mission_results", { missionId: effect.missionId }), effect.missionId)
      case "claim-mission": {
        const next = applyMissionClaim(state, await runtime.command("runtime.claim_mission", { missionId: effect.missionId, executorId: effect.executorId }))
        return await refreshAfterMissionWrite(next, runtime, effect.missionId)
      }
      case "record-mission-progress": {
        const next = applyMissionProgressRecord(state, await runtime.command("runtime.record_mission_progress", { missionId: effect.missionId, claimId: effect.claimId, message: effect.message }))
        return await refreshAfterMissionWrite(next, runtime, effect.missionId)
      }
      case "submit-mission-result": {
        const next = applyMissionResultRecord(state, await runtime.command("runtime.submit_mission_result", { missionId: effect.missionId, claimId: effect.claimId, summary: effect.summary }))
        return await refreshAfterMissionWrite(next, runtime, effect.missionId)
      }
      case "complete-mission": {
        const next = applyMissionDetails(state, await runtime.command("runtime.complete_mission", { missionId: effect.missionId, resultId: effect.resultId, summary: effect.summary }), effect.missionId)
        return await refreshAfterMissionWrite(next, runtime, effect.missionId)
      }
      case "fail-mission": {
        const next = applyMissionDetails(state, await runtime.command("runtime.fail_mission", { missionId: effect.missionId, reason: effect.reason }), effect.missionId)
        return await refreshAfterMissionWrite(next, runtime, effect.missionId)
      }
      case "cancel-mission": {
        const next = applyMissionDetails(state, await runtime.command("runtime.cancel_mission", { missionId: effect.missionId, reason: effect.reason }), effect.missionId)
        return await refreshAfterMissionWrite(next, runtime, effect.missionId)
      }
      case "release-mission-claim": {
        const value = await runtime.command("runtime.release_mission_claim", { claimId: effect.claimId, reason: effect.reason })
        const rawMissionId = readRawStringField(value, "mission_id")
        const claim = readExecutorClaim(value)
        if (!claim || !rawMissionId) throw new Error("runtime.release_mission_claim returned invalid claim")
        const next = applyMissionClaim(state, claim)
        return await refreshAfterMissionWrite(next, runtime, rawMissionId)
      }
      case "load-reviews":
        return await loadReviews(state, runtime, effect.limit ?? REVIEW_LIMIT)
      case "load-review":
        return applySelectedReview(state, await runtime.command("runtime.get_review_request", { reviewId: effect.reviewId }), effect.reviewId)
      case "create-review-request": {
        const next = applySelectedReview(
          state,
          await runtime.command("runtime.create_review_request", {
            missionId: effect.missionId,
            requestType: "operator_checkpoint",
            title: effect.title,
            summary: effect.summary,
            requestedBy: "operator",
          }),
          undefined,
        )
        return await loadReviews(next, runtime, REVIEW_LIMIT)
      }
      case "approve-review": {
        const next = applySelectedReview(
          state,
          await runtime.command("runtime.approve_review_request", { reviewId: effect.reviewId, decidedBy: "operator", reason: effect.reason }),
          effect.reviewId,
        )
        return await loadReviews(next, runtime, REVIEW_LIMIT)
      }
      case "reject-review": {
        const next = applySelectedReview(
          state,
          await runtime.command("runtime.reject_review_request", { reviewId: effect.reviewId, decidedBy: "operator", reason: effect.reason }),
          effect.reviewId,
        )
        return await loadReviews(next, runtime, REVIEW_LIMIT)
      }
      case "cancel-review": {
        const next = applySelectedReview(
          state,
          await runtime.command("runtime.cancel_review_request", { reviewId: effect.reviewId, decidedBy: "operator", reason: effect.reason }),
          effect.reviewId,
        )
        return await loadReviews(next, runtime, REVIEW_LIMIT)
      }
      case "load-proposals":
        return await loadProposals(state, runtime, effect.limit ?? PROPOSAL_LIMIT)
      case "load-proposal":
        return applySelectedProposal(state, await runtime.command("runtime.get_commander_proposal", { proposalId: effect.proposalId }), effect.proposalId)
      case "create-proposal": {
        const next = applySelectedProposal(
          state,
          await runtime.command("runtime.create_commander_proposal", {
            missionId: effect.missionId,
            claimId: effect.claimId,
            resultId: effect.resultId,
            actionKind: effect.actionKind,
            title: effect.title,
            summary: effect.summary,
            proposedBy: "operator",
            actionPayload: effect.actionPayload,
          }),
          undefined,
        )
        return await loadProposals(next, runtime, PROPOSAL_LIMIT)
      }
      case "request-proposal-review": {
        const next = applySelectedProposal(
          state,
          await runtime.command("runtime.request_proposal_review", {
            proposalId: effect.proposalId,
            title: effect.title,
            summary: effect.summary,
            requestedBy: "operator",
          }),
          effect.proposalId,
        )
        return await refreshProposalAndReviews(next, runtime)
      }
      case "apply-proposal": {
        const next = applySelectedProposal(state, await runtime.command("runtime.apply_commander_proposal", { proposalId: effect.proposalId }), effect.proposalId)
        const selectedProposal = next.proposals?.selectedProposal
        const missionId = selectedProposal?.mission_id ?? missionIdForClaim(next, selectedProposal?.claim_id)
        const refreshed = missionId ? await refreshAfterMissionWrite(next, runtime, missionId) : next
        return await loadProposals(refreshed, runtime, PROPOSAL_LIMIT)
      }
      case "cancel-proposal": {
        const next = applySelectedProposal(
          state,
          await runtime.command("runtime.cancel_commander_proposal", { proposalId: effect.proposalId, reason: effect.reason }),
          effect.proposalId,
        )
        return await loadProposals(next, runtime, PROPOSAL_LIMIT)
      }
      case "load-proposal-bundles":
        return await loadProposalBundles(state, runtime, effect.limit ?? PROPOSAL_BUNDLE_LIMIT)
      case "load-proposal-bundle": {
        const next = applySelectedProposalBundle(state, await runtime.command("runtime.get_proposal_bundle", { bundleId: effect.bundleId }), effect.bundleId)
        return await loadProposalBundleReadiness(next, runtime, effect.bundleId)
      }
      case "create-proposal-bundle": {
        const created = await runtime.command("runtime.create_proposal_bundle", {
          title: effect.title,
          summary: effect.summary,
          createdBy: "operator",
        })
        const next = applySelectedProposalBundle(
          state,
          created,
          undefined,
        )
        const refreshed = await loadProposalBundles(next, runtime, PROPOSAL_BUNDLE_LIMIT)
        const selectedBundleId = next.proposalBundles?.selectedBundle?.bundle_id
        return selectedBundleId ? await loadProposalBundleReadiness(refreshed, runtime, selectedBundleId) : refreshed
      }
      case "add-proposal-to-bundle": {
        const next = applySelectedProposalBundle(
          state,
          await runtime.command("runtime.add_proposal_to_bundle", { bundleId: effect.bundleId, proposalId: effect.proposalId }),
          effect.bundleId,
        )
        return await loadProposalBundleReadiness(next, runtime, effect.bundleId)
      }
      case "load-proposal-bundle-readiness":
        return await loadProposalBundleReadiness(state, runtime, effect.bundleId)
      case "request-proposal-bundle-reviews": {
        const next = applySelectedProposalBundle(
          state,
          await runtime.command("runtime.request_proposal_bundle_reviews", { bundleId: effect.bundleId, requestedBy: "operator" }),
          effect.bundleId,
        )
        return await refreshProposalBundlesProposalsAndReviews(next, runtime, effect.bundleId)
      }
      case "apply-proposal-bundle": {
        const next = applySelectedProposalBundle(
          state,
          await runtime.command("runtime.apply_proposal_bundle", { bundleId: effect.bundleId }),
          effect.bundleId,
        )
        return await refreshAfterBundleWrite(next, runtime, effect.bundleId)
      }
      case "cancel-proposal-bundle": {
        const next = applySelectedProposalBundle(
          state,
          await runtime.command("runtime.cancel_proposal_bundle", { bundleId: effect.bundleId, reason: effect.reason }),
          effect.bundleId,
        )
        return await loadProposalBundleReadiness(await loadProposalBundles(next, runtime, PROPOSAL_BUNDLE_LIMIT), runtime, effect.bundleId)
      }
      case "load-playbooks":
        return applyPlaybookCatalog(state, await runtime.command("runtime.list_commander_playbooks"), effect.limit ?? PLAYBOOK_LIMIT)
      case "load-playbook":
        return applySelectedPlaybook(state, await runtime.command("runtime.get_commander_playbook", { playbookId: effect.playbookId }), effect.playbookId)
      case "draft-playbook": {
        const drafted = applyPlaybookDraft(
          state,
          await runtime.command("runtime.draft_commander_playbook", {
            playbookId: effect.playbookId,
            fields: effect.fields,
            proposedBy: "operator",
            requestedBy: "operator",
            bundleTitle: effect.bundleTitle,
            bundleSummary: effect.bundleSummary,
            createBundle: effect.createBundle,
            requestReviews: effect.requestReviews,
          }),
        )
        return await refreshAfterPlaybookDraft(drafted, runtime)
      }
      case "load-playbook-drafts":
        return await loadPlaybookDrafts(state, runtime, effect.limit ?? WORKBENCH_DRAFT_LIMIT)
      case "load-playbook-draft": {
        const next = applySelectedWorkbenchDraft(
          state,
          await runtime.command("runtime.get_commander_playbook_draft", { draftId: effect.draftId }),
          effect.draftId,
        )
        return await loadPlaybookDraftReadiness(next, runtime, effect.draftId)
      }
      case "load-playbook-draft-readiness":
        return await loadPlaybookDraftReadiness(state, runtime, effect.draftId)
      case "request-playbook-draft-reviews": {
        const next = applySelectedWorkbenchDraft(
          state,
          await runtime.command("runtime.request_commander_playbook_draft_reviews", { draftId: effect.draftId, requestedBy: "operator" }),
          effect.draftId,
        )
        let refreshed = await loadPlaybookDraftReadiness(await loadPlaybookDrafts(next, runtime, WORKBENCH_DRAFT_LIMIT), runtime, effect.draftId)
        refreshed = await loadProposals(refreshed, runtime, PROPOSAL_LIMIT)
        return await loadReviews(refreshed, runtime, REVIEW_LIMIT)
      }
      case "cancel-playbook-draft": {
        const next = applySelectedWorkbenchDraft(
          state,
          await runtime.command("runtime.cancel_commander_playbook_draft", { draftId: effect.draftId, reason: effect.reason }),
          effect.draftId,
        )
        return await loadPlaybookDraftReadiness(await loadPlaybookDrafts(next, runtime, WORKBENCH_DRAFT_LIMIT), runtime, effect.draftId)
      }
      case "commander-apply-preview":
        return applyCommanderApplyPreview(
          state,
          await runtime.command("runtime.commander_apply_preview", { targetType: effect.targetType, targetId: effect.targetId }),
        )
      case "commander-apply-target": {
        const next = applyCommanderApplyResult(
          state,
          await runtime.command("runtime.apply_commander_target", { targetType: effect.targetType, targetId: effect.targetId, allowPartial: effect.allowPartial }),
        )
        return await refreshAfterCommanderApply(next, runtime, effect.targetType, effect.targetId)
      }
      case "load-commander-audit":
        return applyCommanderAuditTimeline(
          state,
          await runtime.command("runtime.commander_audit_timeline", { limit: effect.limit ?? AUDIT_LIMIT, category: effect.category as never }),
        )
      case "load-commander-authority-chain":
        return applyCommanderAuthorityChain(
          state,
          await runtime.command("runtime.commander_authority_chain", { targetType: effect.targetType, targetId: effect.targetId }),
          effect.targetType,
          effect.targetId,
        )
      case "load-commander-queues":
        return await loadCommanderQueues(state, runtime, effect.queue ?? "needs_review", effect.limit ?? QUEUE_LIMIT, effect.staleAfterMs)
      case "load-commander-queue":
        return await loadCommanderQueue(state, runtime, effect.queue, effect.limit ?? QUEUE_LIMIT, effect.staleAfterMs)
      case "load-commander-target-context":
        return applyCommanderTargetContext(
          state,
          await runtime.command("runtime.commander_target_context", { targetType: effect.targetType, targetId: effect.targetId }),
        )
      case "load-external-api-connectors":
        return await loadExternalApiConnectors(state, runtime, effect.limit ?? EXTERNAL_API_LIMIT)
      case "load-external-api-connector":
        return applyExternalApiConnector(
          state,
          await runtime.command("runtime.get_external_api_connector", { connectorId: effect.connectorId }),
          effect.connectorId,
        )
      case "preview-external-api-request":
        return applyExternalApiPreview(
          state,
          await runtime.command("runtime.preview_external_api_request", {
            connectorId: effect.connectorId,
            method: effect.method,
            path: effect.path,
            query: effect.query,
            requestedBy: "operator",
          }),
        )
      case "execute-external-api-request": {
        const next = applyExternalApiResult(
          state,
          await runtime.command("runtime.execute_external_api_request", {
            connectorId: effect.connectorId,
            method: effect.method,
            path: effect.path,
            query: effect.query,
            dryRun: effect.dryRun,
            requestedBy: "operator",
          }),
        )
        return effect.dryRun ? next : await loadExternalApiAudit(next, runtime, EXTERNAL_API_LIMIT)
      }
      case "load-external-api-audit":
        return await loadExternalApiAudit(state, runtime, effect.limit ?? EXTERNAL_API_LIMIT)
      case "preview-external-api-research-ingestion":
        return applyExternalApiResearchPreview(
          state,
          await runtime.command("runtime.preview_external_api_research_ingestion", {
            connectorId: effect.connectorId,
            method: effect.method,
            path: effect.path,
            topicId: effect.topicId,
            sourceTitle: effect.sourceTitle,
            noteTitle: effect.noteTitle,
            query: effect.query,
            tags: effect.tags,
            requestedBy: "operator",
          }),
        )
      case "execute-external-api-research-ingestion": {
        const next = applyExternalApiResearchResult(
          state,
          await runtime.command("runtime.execute_external_api_research_ingestion", {
            connectorId: effect.connectorId,
            method: effect.method,
            path: effect.path,
            topicId: effect.topicId,
            sourceTitle: effect.sourceTitle,
            noteTitle: effect.noteTitle,
            query: effect.query,
            tags: effect.tags,
            dryRun: effect.dryRun,
            requestedBy: "operator",
          }),
        )
        return effect.dryRun ? next : await loadExternalApiResearchIngestions(next, runtime, EXTERNAL_API_LIMIT)
      }
      case "load-external-api-research-ingestions":
        return await loadExternalApiResearchIngestions(state, runtime, effect.limit ?? EXTERNAL_API_LIMIT)
      case "preview-research-synthesis":
        return applyResearchSynthesisPreview(
          state,
          await runtime.command("runtime.preview_research_synthesis", {
            topicId: effect.topicId,
            objective: effect.objective,
            requestedBy: "operator",
          }),
        )
      case "execute-research-synthesis": {
        const next = applyResearchSynthesisResult(
          state,
          await runtime.command("runtime.execute_research_synthesis", {
            topicId: effect.topicId,
            objective: effect.objective,
            createProposals: effect.createProposals,
            requestedBy: "operator",
          }),
        )
        let refreshed = await loadResearchSyntheses(next, runtime, SYNTHESIS_LIMIT)
        if (effect.createProposals) refreshed = await loadProposals(refreshed, runtime, PROPOSAL_LIMIT)
        return refreshed
      }
      case "load-research-synthesis":
        return applyResearchSynthesisResult(
          state,
          await runtime.command("runtime.get_research_synthesis", { synthesisId: effect.synthesisId }),
          effect.synthesisId,
        )
      case "load-research-syntheses":
        return await loadResearchSyntheses(state, runtime, effect.limit ?? SYNTHESIS_LIMIT)
      case "preview-commander-cycle":
        return applyCommanderCyclePreview(
          state,
          await runtime.command("runtime.preview_commander_cycle", {
            topicId: effect.topicId,
            missionId: effect.missionId,
            objective: effect.objective,
            requestedBy: "operator",
          }),
        )
      case "execute-commander-cycle": {
        const next = applyCommanderCycleResult(
          state,
          await runtime.command("runtime.execute_commander_cycle", {
            topicId: effect.topicId,
            missionId: effect.missionId,
            objective: effect.objective,
            createProposals: effect.createProposals,
            createBundle: effect.createBundle,
            requestedBy: "operator",
          }),
        )
        let refreshed = await loadCommanderCycles(next, runtime, CYCLE_LIMIT)
        if (effect.createProposals || effect.createBundle) refreshed = await loadProposals(refreshed, runtime, PROPOSAL_LIMIT)
        if (effect.createBundle) refreshed = await loadProposalBundles(refreshed, runtime, PROPOSAL_BUNDLE_LIMIT)
        return refreshed
      }
      case "load-commander-cycle":
        return applyCommanderCycleResult(
          state,
          await runtime.command("runtime.get_commander_cycle", { cycleId: effect.cycleId }),
          effect.cycleId,
        )
      case "load-commander-cycles":
        return await loadCommanderCycles(state, runtime, effect.limit ?? CYCLE_LIMIT)
      case "preview-opencode-handoff":
        return applyOpenCodeHandoffPreview(
          state,
          await runtime.command("runtime.preview_opencode_handoff", { proposalId: effect.proposalId, requestedBy: "operator" }),
        )
      case "execute-opencode-handoff": {
        const next = applyOpenCodeHandoffResult(
          state,
          await runtime.command("runtime.execute_opencode_handoff", { proposalId: effect.proposalId, dryRun: effect.dryRun, requestedBy: "operator" }),
        )
        return effect.dryRun ? next : await refreshAfterHandoff(next, runtime)
      }
      case "load-opencode-handoff":
        return applyOpenCodeHandoffResult(
          state,
          await runtime.command("runtime.get_opencode_handoff", { handoffId: effect.handoffId }),
          effect.handoffId,
        )
      case "load-opencode-handoffs":
        return await loadOpenCodeHandoffs(state, runtime, effect.limit ?? HANDOFF_LIMIT)
      case "preview-opencode-process-smoke":
        return applyOpenCodeProcessSmokePreview(
          state,
          await runtime.command("runtime.preview_opencode_process_smoke", { timeoutMs: effect.timeoutMs }),
        )
      case "execute-opencode-process-smoke": {
        const next = applyOpenCodeProcessSmokeResult(
          state,
          await runtime.command("runtime.execute_opencode_process_smoke", { requestedBy: "operator", dryRun: effect.dryRun === true, timeoutMs: effect.timeoutMs }),
        )
        return effect.dryRun === true ? next : applyOpenCodeProcessSmokeRecords(next, await runtime.command("runtime.list_opencode_process_smokes", { limit: HANDOFF_LIMIT }), HANDOFF_LIMIT, { preserveCommandError: true })
      }
      case "load-opencode-process-smokes":
        return applyOpenCodeProcessSmokeRecords(
          state,
          await runtime.command("runtime.list_opencode_process_smokes", { limit: effect.limit ?? HANDOFF_LIMIT }),
          effect.limit ?? HANDOFF_LIMIT,
        )
      case "load-opencode-process-smoke":
        return applyOpenCodeProcessSmokeResult(
          state,
          await runtime.command("runtime.get_opencode_process_smoke", { smokeId: effect.smokeId }),
          effect.smokeId,
        )
      case "preview-opencode-handoff-readiness":
        return applyOpenCodeHandoffReadinessPreview(
          state,
          await runtime.command("runtime.preview_opencode_handoff_readiness", {
            proposalId: effect.proposalId,
            reviewId: effect.reviewId,
            missionId: effect.missionId,
            handoffId: effect.handoffId,
            requireRecentSmoke: effect.requireRecentSmoke,
            maxSmokeAgeMs: effect.maxSmokeAgeMs,
          }),
        )
      case "load-opencode-handoff-readiness-summary":
        return applyOpenCodeHandoffReadinessSummary(
          state,
          await runtime.command("runtime.opencode_handoff_readiness_summary", { maxSmokeAgeMs: effect.maxSmokeAgeMs }),
        )
      case "preview-opencode-result-review-packet":
        return applyOpenCodeResultReviewPacket(
          state,
          await runtime.command("runtime.preview_opencode_result_review_packet", {
            handoffId: effect.handoffId,
            followupId: effect.followupId,
            missionId: effect.missionId,
            resultId: effect.resultId,
            proposalId: effect.proposalId,
            staleAfterMs: effect.staleAfterMs,
          }),
        )
      case "load-opencode-result-review-summary":
        return applyOpenCodeResultReviewSummary(
          state,
          await runtime.command("runtime.opencode_result_review_summary", { staleAfterMs: effect.staleAfterMs, limit: effect.limit }),
        )
      case "preview-opencode-session-plan":
        return applyOpenCodeSessionPreview(state, await runtime.command("runtime.preview_opencode_session_plan", {
          objective: effect.objective,
          proposalId: effect.proposalId,
          missionId: effect.missionId,
          reviewRequestId: effect.reviewRequestId,
          applyId: effect.applyId,
          title: effect.title,
          maxContextBytes: effect.maxContextBytes,
        }))
      case "create-opencode-session-plan": {
        const next = applyOpenCodeSessionPlan(state, await runtime.command("runtime.create_opencode_session_plan", {
          objective: effect.objective,
          proposalId: effect.proposalId,
          missionId: effect.missionId,
          reviewRequestId: effect.reviewRequestId,
          applyId: effect.applyId,
          title: effect.title,
          maxContextBytes: effect.maxContextBytes,
          dryRun: effect.dryRun === true,
          createdBy: "operator",
        }))
        return effect.dryRun === true ? next : applyOpenCodeSessionRecords(next, await runtime.command("runtime.list_opencode_sessions", { limit: HANDOFF_LIMIT }))
      }
      case "load-opencode-sessions":
        return applyOpenCodeSessionRecords(state, await runtime.command("runtime.list_opencode_sessions", { limit: effect.limit ?? HANDOFF_LIMIT }))
      case "load-opencode-session":
        return applyOpenCodeSessionSelected(state, await runtime.command("runtime.get_opencode_session", { sessionId: effect.sessionId }), effect.sessionId)
      case "load-opencode-session-summary":
        return applyOpenCodeSessionSummary(state, await runtime.command("runtime.opencode_session_summary"))
      case "load-model-capabilities":
        return applyContextBudgetCapabilities(state, await runtime.command("runtime.list_model_capabilities", { providerKind: effect.providerKind, role: effect.role, limit: effect.limit ?? HANDOFF_LIMIT }))
      case "load-model-capability":
        return applyContextBudgetSelectedCapability(state, await runtime.command("runtime.get_model_capability", { capabilityId: effect.capabilityId, providerKind: effect.providerKind, modelId: effect.modelId }))
      case "load-context-budget-summary":
        return applyContextBudgetSummary(state, await runtime.command("runtime.context_budget_summary"))
      case "preview-context-budget":
        return applyContextBudgetPreview(state, await runtime.command("runtime.preview_context_budget", {
          purpose: effect.purpose,
          role: effect.role,
          providerKind: effect.providerKind,
          modelId: effect.modelId,
          sessionId: effect.sessionId,
          maxContextTokens: effect.maxContextTokens,
          maxContextBytes: effect.maxContextBytes,
        }))
      case "preview-context-packet":
        return applyContextPacketPreview(state, await runtime.command("runtime.preview_context_packet", {
          purpose: effect.purpose,
          role: effect.role,
          providerKind: effect.providerKind,
          modelId: effect.modelId,
          sessionId: effect.sessionId,
          missionId: effect.missionId,
          proposalId: effect.proposalId,
          reviewRequestId: effect.reviewRequestId,
          applyId: effect.applyId,
          maxContextTokens: effect.maxContextTokens,
          maxContextBytes: effect.maxContextBytes,
        }))
      case "load-context-packet-summary":
        return applyContextPacketSummary(state, await runtime.command("runtime.context_packet_summary"))
      case "preview-opencode-session-instruction-pack":
        return applyOpenCodeSessionInstructionPackPreview(state, await runtime.command("runtime.preview_opencode_session_instruction_pack", {
          sessionId: effect.sessionId,
          providerKind: effect.providerKind,
          modelId: effect.modelId,
          maxContextTokens: effect.maxContextTokens,
          maxContextBytes: effect.maxContextBytes,
          includeOpenCodeConfig: effect.includeOpenCodeConfig,
          includeManifest: effect.includeManifest,
        }))
      case "write-opencode-session-instruction-pack": {
        const next = applyOpenCodeSessionInstructionPackResult(state, await runtime.command("runtime.write_opencode_session_instruction_pack", {
          sessionId: effect.sessionId,
          providerKind: effect.providerKind,
          modelId: effect.modelId,
          maxContextTokens: effect.maxContextTokens,
          maxContextBytes: effect.maxContextBytes,
          includeOpenCodeConfig: effect.includeOpenCodeConfig,
          includeManifest: effect.includeManifest,
          dryRun: effect.dryRun === true,
          writtenBy: "operator",
        }))
        if (next.opencodeSessionInstructionPacks?.commandError) return next
        return effect.dryRun === true ? next : applyOpenCodeSessionInstructionPackRecords(next, await runtime.command("runtime.list_opencode_session_instruction_packs", { limit: HANDOFF_LIMIT }))
      }
      case "load-opencode-session-instruction-packs":
        return applyOpenCodeSessionInstructionPackRecords(state, await runtime.command("runtime.list_opencode_session_instruction_packs", { limit: effect.limit ?? HANDOFF_LIMIT, sessionId: effect.sessionId, status: effect.status }))
      case "load-opencode-session-instruction-pack":
        return applyOpenCodeSessionInstructionPackSelected(state, await runtime.command("runtime.get_opencode_session_instruction_pack", { packId: effect.packId }), effect.packId)
      case "preview-opencode-launch-readiness":
        return applyOpenCodeLaunchReadinessPreview(state, await runtime.command("runtime.preview_opencode_launch_readiness", {
          sessionId: effect.sessionId,
          packId: effect.packId,
          providerKind: effect.providerKind,
          modelId: effect.modelId,
          maxContextTokens: effect.maxContextTokens,
          maxContextBytes: effect.maxContextBytes,
          includeResearchMemory: effect.includeResearchMemory,
          includeNativeConfig: effect.includeNativeConfig,
        }))
      case "load-opencode-launch-readiness-summary":
        return applyOpenCodeLaunchReadinessSummary(state, await runtime.command("runtime.opencode_launch_readiness_summary", { limit: effect.limit }))
      case "preview-opencode-session-launch":
        return applyOpenCodeLaunchPreview(state, await runtime.command("runtime.preview_opencode_session_launch", {
          sessionId: effect.sessionId,
          packId: effect.packId,
          readinessHash: effect.readinessHash,
          adapterKind: effect.adapterKind,
          providerKind: effect.providerKind,
          modelId: effect.modelId,
          allowRealLaunch: effect.allowRealLaunch,
        }))
      case "launch-opencode-session": {
        const next = applyOpenCodeLaunchResult(state, await runtime.command("runtime.launch_opencode_session", {
          sessionId: effect.sessionId,
          packId: effect.packId,
          readinessHash: effect.readinessHash,
          adapterKind: effect.adapterKind,
          providerKind: effect.providerKind,
          modelId: effect.modelId,
          allowRealLaunch: effect.allowRealLaunch,
          dryRun: effect.dryRun === true,
          launchedBy: "operator",
        }))
        if (next.opencodeLaunches?.commandError) return next
        return effect.dryRun === true ? next : applyOpenCodeLaunchRecords(next, await runtime.command("runtime.list_opencode_session_launches", { limit: HANDOFF_LIMIT }))
      }
      case "load-opencode-session-launches":
        return applyOpenCodeLaunchRecords(state, await runtime.command("runtime.list_opencode_session_launches", { limit: effect.limit ?? HANDOFF_LIMIT, sessionId: effect.sessionId, status: effect.status }))
      case "load-opencode-session-launch":
        return applyOpenCodeLaunchSelected(state, await runtime.command("runtime.get_opencode_session_launch", { launchId: effect.launchId }), effect.launchId)
      case "preview-opencode-progress":
        return applyOpenCodeProgressPreview(state, await runtime.command("runtime.preview_opencode_progress", progressPayload(effect)))
      case "record-opencode-progress": {
        const next = applyOpenCodeProgressResult(state, await runtime.command("runtime.record_opencode_progress", { ...progressPayload(effect), dryRun: effect.dryRun === true, recordedBy: "operator" }))
        if (next.opencodeProgress?.commandError) return next
        return effect.dryRun === true ? next : applyOpenCodeProgressRecords(next, await runtime.command("runtime.list_opencode_progress", { limit: HANDOFF_LIMIT, sessionId: effect.sessionId, launchId: effect.launchId }))
      }
      case "load-opencode-progress-records":
        return applyOpenCodeProgressRecords(state, await runtime.command("runtime.list_opencode_progress", { limit: effect.limit ?? HANDOFF_LIMIT, sessionId: effect.sessionId, launchId: effect.launchId, kind: effect.kind, executionState: effect.executionState }))
      case "load-opencode-progress":
        return applyOpenCodeProgressSelected(state, await runtime.command("runtime.get_opencode_progress", { progressId: effect.progressId }), effect.progressId)
      case "load-latest-opencode-progress":
        return applyOpenCodeProgressLatest(state, await runtime.command("runtime.latest_opencode_progress", { sessionId: effect.sessionId, launchId: effect.launchId }), effect.sessionId ?? effect.launchId ?? "latest")
      case "load-opencode-progress-summary":
        return applyOpenCodeProgressSummary(state, await runtime.command("runtime.opencode_progress_summary", { limit: effect.limit ?? HANDOFF_LIMIT }))
      case "preview-opencode-watchdog":
        return applyOpenCodeWatchdogPreview(state, await runtime.command("runtime.preview_opencode_watchdog", watchdogPayload(effect)))
      case "record-opencode-watchdog": {
        const next = applyOpenCodeWatchdogResult(state, await runtime.command("runtime.record_opencode_watchdog", { ...watchdogPayload(effect), dryRun: effect.dryRun === true, requestReport: effect.requestReport === true, recordedBy: "operator" }))
        if (next.opencodeWatchdog?.commandError) return next
        return effect.dryRun === true ? next : applyOpenCodeWatchdogRecords(next, await runtime.command("runtime.list_opencode_watchdogs", { limit: HANDOFF_LIMIT, sessionId: effect.sessionId, launchId: effect.launchId }))
      }
      case "request-opencode-forced-report": {
        const next = applyOpenCodeForcedReportResult(state, await runtime.command("runtime.request_opencode_forced_report", { sessionId: effect.sessionId, launchId: effect.launchId, reason: effect.reason, dryRun: effect.dryRun === true, requestedBy: "operator" }))
        if (next.opencodeWatchdog?.commandError) return next
        return effect.dryRun === true ? next : applyOpenCodeForcedReportRecords(next, await runtime.command("runtime.list_opencode_forced_report_requests", { limit: HANDOFF_LIMIT, sessionId: effect.sessionId, launchId: effect.launchId }))
      }
      case "load-opencode-watchdogs":
        return applyOpenCodeWatchdogRecords(state, await runtime.command("runtime.list_opencode_watchdogs", { limit: effect.limit ?? HANDOFF_LIMIT, sessionId: effect.sessionId, launchId: effect.launchId, status: effect.status }))
      case "load-opencode-watchdog":
        return applyOpenCodeWatchdogSelected(state, await runtime.command("runtime.get_opencode_watchdog", { watchdogId: effect.watchdogId }), effect.watchdogId)
      case "load-opencode-forced-report-requests":
        return applyOpenCodeForcedReportRecords(state, await runtime.command("runtime.list_opencode_forced_report_requests", { limit: effect.limit ?? HANDOFF_LIMIT, sessionId: effect.sessionId, launchId: effect.launchId }))
      case "load-opencode-forced-report-request":
        return applyOpenCodeForcedReportSelected(state, await runtime.command("runtime.get_opencode_forced_report_request", { requestId: effect.requestId }), effect.requestId)
      case "load-opencode-watchdog-summary":
        return applyOpenCodeWatchdogSummary(state, await runtime.command("runtime.opencode_watchdog_summary", { limit: effect.limit ?? HANDOFF_LIMIT }))
      case "preview-opencode-commander-question":
        return applyOpenCodeCommanderQuestionPreview(state, await runtime.command("runtime.preview_opencode_commander_question", commanderQuestionPayload(effect)))
      case "create-opencode-commander-question": {
        const next = applyOpenCodeCommanderQuestionResult(state, await runtime.command("runtime.create_opencode_commander_question", { ...commanderQuestionPayload(effect), dryRun: effect.dryRun === true, createdBy: "operator" }))
        if (next.opencodeCommanderQuestions?.commandError) return next
        const result = next.opencodeCommanderQuestions?.latestResult
        const sessionId = result?.session_id || effect.sessionId
        const launchId = result?.launch_id || effect.launchId
        return effect.dryRun === true ? next : applyOpenCodeCommanderQuestionRecords(next, await runtime.command("runtime.list_opencode_commander_questions", { limit: HANDOFF_LIMIT, sessionId, launchId }))
      }
      case "load-opencode-commander-questions":
        return applyOpenCodeCommanderQuestionRecords(state, await runtime.command("runtime.list_opencode_commander_questions", { limit: effect.limit ?? HANDOFF_LIMIT, sessionId: effect.sessionId, launchId: effect.launchId, status: effect.status, questionType: effect.questionType, urgency: effect.urgency }))
      case "load-opencode-commander-question":
        return applyOpenCodeCommanderQuestionSelected(state, await runtime.command("runtime.get_opencode_commander_question", { questionId: effect.questionId }), effect.questionId)
      case "load-latest-opencode-commander-question":
        return applyOpenCodeCommanderQuestionLatest(state, await runtime.command("runtime.latest_opencode_commander_question", { sessionId: effect.sessionId, launchId: effect.launchId }), effect.sessionId ?? effect.launchId ?? "latest")
      case "load-opencode-commander-question-summary":
        return applyOpenCodeCommanderQuestionSummary(state, await runtime.command("runtime.opencode_commander_question_summary", { limit: effect.limit ?? HANDOFF_LIMIT }))
      case "load-research-memory-summary":
        return applyResearchMemorySummary(state, await runtime.command("runtime.research_memory_summary"))
      case "preview-research-memory-retrieval":
        return applyResearchMemoryRetrievalPreview(state, await runtime.command("runtime.preview_research_memory_retrieval", {
          query: effect.query,
          labels: effect.labels,
          limit: effect.limit,
          sourceKind: effect.sourceKind,
          missionId: effect.missionId,
          sessionId: effect.sessionId,
          includeFailures: effect.includeFailures,
          includeArtifacts: effect.includeArtifacts,
        }))
      case "preview-research-novelty-check":
        return applyResearchNoveltyPreview(state, await runtime.command("runtime.preview_research_novelty_check", {
          question: effect.question,
          method: effect.method,
          config: effect.config,
          labels: effect.labels,
          limit: effect.limit,
          missionId: effect.missionId,
          sessionId: effect.sessionId,
          repetitionReason: effect.repetitionReason,
          includeFailures: effect.includeFailures,
        }))
      case "preview-commander-executor-review":
        return applyCommanderExecutorReviewPreview(
          state,
          await runtime.command("runtime.preview_commander_executor_review", {
            handoff_id: effect.handoffId,
            followup_id: effect.followupId,
            mission_id: effect.missionId,
            result_id: effect.resultId,
            proposal_id: effect.proposalId,
          }),
        )
      case "execute-commander-executor-review":
        return applyCommanderExecutorReviewResult(
          state,
          await runtime.command("runtime.execute_commander_executor_review", {
            handoff_id: effect.handoffId,
            followup_id: effect.followupId,
            mission_id: effect.missionId,
            result_id: effect.resultId,
            proposal_id: effect.proposalId,
            dry_run: effect.dryRun,
            requested_by: "tui",
          }),
        )
      case "load-commander-executor-reviews":
        return applyCommanderExecutorReviewRecords(
          state,
          await runtime.command("runtime.list_commander_executor_reviews", { limit: effect.limit ?? HANDOFF_LIMIT }),
        )
      case "load-commander-executor-review":
        return applyCommanderExecutorReviewSelected(
          state,
          await runtime.command("runtime.get_commander_executor_review", { reviewId: effect.reviewId }),
          effect.reviewId,
        )
      case "preview-executor-review-proposal-drafts":
        return applyExecutorReviewProposalDraftPreview(state, await runtime.command("runtime.preview_executor_review_proposal_drafts", {
          reviewId: effect.reviewId,
          packetId: effect.packetId,
          missionId: effect.missionId,
          resultId: effect.resultId,
          handoffId: effect.handoffId,
          proposalId: effect.proposalId,
          limit: effect.limit,
        }))
      case "load-executor-review-proposal-draft-summary":
        return applyExecutorReviewProposalDraftSummary(state, await runtime.command("runtime.executor_review_proposal_draft_summary", { limit: effect.limit }))
      case "preview-executor-review-proposal-create":
        return applyExecutorReviewProposalCreatePreview(state, await runtime.command("runtime.preview_executor_review_proposal_create", {
          reviewId: effect.reviewId,
          draftId: effect.draftId,
        }))
      case "create-executor-review-proposal": {
        const next = applyExecutorReviewProposalCreateResult(state, await runtime.command("runtime.create_executor_review_proposal", {
          reviewId: effect.reviewId,
          draftId: effect.draftId,
          dry_run: effect.dryRun,
          requested_by: "tui",
        }))
        if (effect.dryRun === true) {
          return {
            ...next,
            executorReviewProposalCreate: {
              ...executorReviewProposalCreateState(next),
              records: executorReviewProposalCreateState(state).records,
            },
          }
        }
        const refreshed = applyExecutorReviewProposalCreateRecords(next, await runtime.command("runtime.list_executor_review_proposal_creates", { limit: HANDOFF_LIMIT }))
        const createError = next.executorReviewProposalCreate?.commandError
        return createError
          ? {
            ...refreshed,
            executorReviewProposalCreate: {
              ...executorReviewProposalCreateState(refreshed),
              commandError: createError,
            },
          }
          : refreshed
      }
      case "load-executor-review-proposal-creates":
        return applyExecutorReviewProposalCreateRecords(state, await runtime.command("runtime.list_executor_review_proposal_creates", { limit: effect.limit ?? HANDOFF_LIMIT }))
      case "load-executor-review-proposal-create":
        return applyExecutorReviewProposalCreateSelected(state, await runtime.command("runtime.get_executor_review_proposal_create", { createId: effect.createId }), effect.createId)
      case "preview-executor-review-proposal-review-request":
        return applyExecutorReviewProposalReviewRequestPreview(state, await runtime.command("runtime.preview_executor_review_proposal_review_request", {
          proposalId: effect.proposalId,
          createId: effect.createId,
        }))
      case "request-executor-review-proposal-review": {
        const next = applyExecutorReviewProposalReviewRequestResult(state, await runtime.command("runtime.request_executor_review_proposal_review", {
          proposalId: effect.proposalId,
          createId: effect.createId,
          dry_run: effect.dryRun,
          requested_by: "tui",
        }))
        if (effect.dryRun === true) {
          return {
            ...next,
            executorReviewProposalReviewRequest: {
              ...executorReviewProposalReviewRequestState(next),
              records: executorReviewProposalReviewRequestState(state).records,
            },
          }
        }
        const refreshed = applyExecutorReviewProposalReviewRequestRecords(next, await runtime.command("runtime.list_executor_review_proposal_review_requests", { limit: HANDOFF_LIMIT }))
        const requestError = next.executorReviewProposalReviewRequest?.commandError
        return requestError
          ? {
            ...refreshed,
            executorReviewProposalReviewRequest: {
              ...executorReviewProposalReviewRequestState(refreshed),
              commandError: requestError,
            },
          }
          : refreshed
      }
      case "load-executor-review-proposal-review-requests":
        return applyExecutorReviewProposalReviewRequestRecords(state, await runtime.command("runtime.list_executor_review_proposal_review_requests", { limit: effect.limit ?? HANDOFF_LIMIT }))
      case "load-executor-review-proposal-review-request":
        return applyExecutorReviewProposalReviewRequestSelected(state, await runtime.command("runtime.get_executor_review_proposal_review_request", { requestGateId: effect.requestGateId }), effect.requestGateId)
      case "preview-executor-review-proposal-review-decision":
        return applyExecutorReviewProposalReviewDecisionPreview(state, await runtime.command("runtime.preview_executor_review_proposal_review_decision", {
          reviewRequestId: effect.reviewRequestId,
          decision: effect.decision,
          reason: effect.reason,
          requestGateId: effect.requestGateId,
        }))
      case "decide-executor-review-proposal-review": {
        const next = applyExecutorReviewProposalReviewDecisionResult(state, await runtime.command("runtime.decide_executor_review_proposal_review", {
          reviewRequestId: effect.reviewRequestId,
          decision: effect.decision,
          reason: effect.reason,
          requestGateId: effect.requestGateId,
          dry_run: effect.dryRun,
          decided_by: "tui",
        }))
        if (effect.dryRun === true) {
          return {
            ...next,
            executorReviewProposalReviewDecision: {
              ...executorReviewProposalReviewDecisionState(next),
              records: executorReviewProposalReviewDecisionState(state).records,
            },
          }
        }
        const refreshed = applyExecutorReviewProposalReviewDecisionRecords(next, await runtime.command("runtime.list_executor_review_proposal_review_decisions", { limit: HANDOFF_LIMIT }))
        const decisionError = next.executorReviewProposalReviewDecision?.commandError
        return decisionError
          ? {
            ...refreshed,
            executorReviewProposalReviewDecision: {
              ...executorReviewProposalReviewDecisionState(refreshed),
              commandError: decisionError,
            },
          }
          : refreshed
      }
      case "load-executor-review-proposal-review-decisions":
        return applyExecutorReviewProposalReviewDecisionRecords(state, await runtime.command("runtime.list_executor_review_proposal_review_decisions", { limit: effect.limit ?? HANDOFF_LIMIT }))
      case "load-executor-review-proposal-review-decision":
        return applyExecutorReviewProposalReviewDecisionSelected(state, await runtime.command("runtime.get_executor_review_proposal_review_decision", { decisionGateId: effect.decisionGateId }), effect.decisionGateId)
      case "preview-executor-review-proposal-apply-readiness":
        return applyExecutorReviewProposalApplyReadinessPreview(state, await runtime.command("runtime.preview_executor_review_proposal_apply_readiness", {
          proposalId: effect.proposalId,
          reviewRequestId: effect.reviewRequestId,
          decisionGateId: effect.decisionGateId,
          createId: effect.createId,
        }))
      case "load-executor-review-proposal-apply-readiness-summary":
        return applyExecutorReviewProposalApplyReadinessSummary(state, await runtime.command("runtime.executor_review_proposal_apply_readiness_summary", { limit: effect.limit ?? HANDOFF_LIMIT }))
      case "load-executor-review-proposal-apply-readiness-list":
        return applyExecutorReviewProposalApplyReadinessRecords(state, await runtime.command("runtime.list_executor_review_proposal_apply_readiness", {
          limit: effect.limit ?? HANDOFF_LIMIT,
          status: effect.status,
          candidateKind: effect.candidateKind,
          proposalId: effect.proposalId,
        }))
      case "load-executor-review-proposal-apply-readiness":
        return applyExecutorReviewProposalApplyReadinessSelected(state, await runtime.command("runtime.get_executor_review_proposal_apply_readiness", { readinessId: effect.readinessId }), effect.readinessId)
      case "preview-executor-review-proposal-narrow-apply":
        return applyExecutorReviewProposalNarrowApplyPreview(state, await runtime.command("runtime.preview_executor_review_proposal_narrow_apply", {
          proposalId: effect.proposalId,
          readinessId: effect.readinessId,
          reason: effect.reason,
        }))
      case "apply-executor-review-proposal-narrow": {
        const next = applyExecutorReviewProposalNarrowApplyResult(state, await runtime.command("runtime.apply_executor_review_proposal_narrow", {
          proposalId: effect.proposalId,
          readinessId: effect.readinessId,
          reason: effect.reason,
          appliedBy: "operator",
          dryRun: effect.dryRun === true,
        }))
        const refreshed = applyExecutorReviewProposalNarrowApplyRecords(next, await runtime.command("runtime.list_executor_review_proposal_narrow_applies", { limit: HANDOFF_LIMIT }))
        const applyError = next.executorReviewProposalNarrowApply?.commandError
        return applyError
          ? {
            ...refreshed,
            executorReviewProposalNarrowApply: {
              ...executorReviewProposalNarrowApplyState(refreshed),
              commandError: applyError,
            },
          }
          : refreshed
      }
      case "load-executor-review-proposal-narrow-applies":
        return applyExecutorReviewProposalNarrowApplyRecords(state, await runtime.command("runtime.list_executor_review_proposal_narrow_applies", { limit: effect.limit ?? HANDOFF_LIMIT }))
      case "load-executor-review-proposal-narrow-apply":
        return applyExecutorReviewProposalNarrowApplySelected(state, await runtime.command("runtime.get_executor_review_proposal_narrow_apply", { applyId: effect.applyId }), effect.applyId)
      case "load-opencode-handoff-followup":
        return applyOpenCodeHandoffFollowup(
          state,
          await runtime.command("runtime.get_opencode_handoff_followup", { handoffId: effect.handoffId }),
          effect.handoffId,
        )
      case "load-opencode-handoff-followups":
        return await loadOpenCodeHandoffFollowups(state, runtime, effect.limit ?? HANDOFF_LIMIT)
      case "load-opencode-handoff-followup-summary":
        return applyOpenCodeHandoffFollowupSummary(state, await runtime.command("runtime.opencode_handoff_followup_summary"))
      case "load-opencode-handoff-followup-queue":
        return applyOpenCodeHandoffFollowupQueue(
          state,
          await runtime.command("runtime.opencode_handoff_followup_queue", { queue: effect.queue, limit: effect.limit ?? HANDOFF_LIMIT }),
        )
      case "preview-runtime-checkpoint":
        return applyRuntimeCheckpointPreview(
          state,
          await runtime.command("runtime.preview_runtime_checkpoint", { scope: effect.scope, reason: effect.reason, requestedBy: "operator" }),
        )
      case "create-runtime-checkpoint": {
        const next = applyRuntimeCheckpoint(
          state,
          await runtime.command("runtime.create_runtime_checkpoint", { scope: effect.scope, reason: effect.reason, requestedBy: "operator" }),
        )
        return await loadRuntimeCheckpoints(next, runtime, CHECKPOINT_LIMIT)
      }
      case "load-runtime-checkpoint":
        return applyRuntimeCheckpoint(
          state,
          await runtime.command("runtime.get_runtime_checkpoint", { checkpointId: effect.checkpointId }),
          effect.checkpointId,
        )
      case "load-runtime-checkpoints":
        return await loadRuntimeCheckpoints(state, runtime, effect.limit ?? CHECKPOINT_LIMIT)
      case "preview-checkpoint-restore":
        return applyRuntimeRestorePreview(
          state,
          await runtime.command("runtime.preview_checkpoint_restore", { checkpointId: effect.checkpointId, requestedBy: "operator" }),
        )
      case "mark-checkpoint-resume-anchor": {
        const next = applyRuntimeResumeAnchor(
          state,
          await runtime.command("runtime.mark_checkpoint_resume_anchor", { checkpointId: effect.checkpointId, requestedBy: "operator" }),
        )
        return await loadRuntimeResumeAnchors(next, runtime, CHECKPOINT_LIMIT)
      }
      case "load-checkpoint-resume-anchor":
        return applyRuntimeResumeAnchor(
          state,
          await runtime.command("runtime.get_checkpoint_resume_anchor", { resumeId: effect.resumeId }),
          effect.resumeId,
        )
      case "load-checkpoint-resume-anchors":
        return await loadRuntimeResumeAnchors(state, runtime, effect.limit ?? CHECKPOINT_LIMIT)
      case "preview-wake-assessment":
        return applyWakeAssessmentPreview(
          state,
          await runtime.command("runtime.preview_wake_assessment", { resumeId: effect.resumeId, checkpointId: effect.checkpointId, requestedBy: "operator" }),
        )
      case "create-wake-assessment": {
        const next = applyWakeAssessment(
          state,
          await runtime.command("runtime.create_wake_assessment", { resumeId: effect.resumeId, requestedBy: "operator" }),
        )
        return await loadWakeAssessments(next, runtime, CHECKPOINT_LIMIT)
      }
      case "load-wake-assessment":
        return applyWakeAssessment(
          state,
          await runtime.command("runtime.get_wake_assessment", { wakeId: effect.wakeId }),
          effect.wakeId,
        )
      case "load-wake-assessments":
        return await loadWakeAssessments(state, runtime, effect.limit ?? CHECKPOINT_LIMIT)
      case "preview-continuation-plan":
        return applyContinuationPlanPreview(
          state,
          await runtime.command("runtime.preview_continuation_plan", { wakeId: effect.wakeId, requestedBy: "operator" }),
        )
      case "create-continuation-plan": {
        const next = applyContinuationPlan(
          state,
          await runtime.command("runtime.create_continuation_plan", { wakeId: effect.wakeId, requestedBy: "operator" }),
        )
        return await loadContinuationPlans(next, runtime, CHECKPOINT_LIMIT)
      }
      case "load-continuation-plan":
        return applyContinuationPlan(
          state,
          await runtime.command("runtime.get_continuation_plan", { planId: effect.planId }),
          effect.planId,
        )
      case "load-continuation-plans":
        return await loadContinuationPlans(state, runtime, effect.limit ?? CHECKPOINT_LIMIT)
      case "execute-continuation-step": {
        const next = applyContinuationStepResult(
          state,
          await runtime.command("runtime.execute_continuation_step", { planId: effect.planId, index: effect.index, dryRun: effect.dryRun === true, requestedBy: "operator" }),
        )
        return effect.dryRun ? next : applyContinuationPlan(next, await runtime.command("runtime.get_continuation_plan", { planId: effect.planId }), effect.planId)
      }
      case "pause-continuation-plan": {
        const next = applyContinuationPlan(
          state,
          await runtime.command("runtime.pause_continuation_plan", { planId: effect.planId, requestedBy: "operator" }),
        )
        return await loadContinuationPlans(next, runtime, CHECKPOINT_LIMIT)
      }
      case "cancel-continuation-plan": {
        const next = applyContinuationPlan(
          state,
          await runtime.command("runtime.cancel_continuation_plan", { planId: effect.planId, requestedBy: "operator" }),
        )
        return await loadContinuationPlans(next, runtime, CHECKPOINT_LIMIT)
      }
      case "preview-wake-schedule":
        return applyWakeSchedulePreview(
          state,
          await runtime.command("runtime.preview_wake_schedule", { resumeId: effect.resumeId, intervalMs: effect.intervalMs, title: effect.title, requestedBy: "operator" }),
        )
      case "create-wake-schedule": {
        const next = applyWakeSchedule(
          state,
          await runtime.command("runtime.create_wake_schedule", { resumeId: effect.resumeId, intervalMs: effect.intervalMs, title: effect.title, requestedBy: "operator" }),
        )
        return await loadWakeSchedules(next, runtime, CHECKPOINT_LIMIT)
      }
      case "load-wake-schedule":
        return applyWakeSchedule(
          state,
          await runtime.command("runtime.get_wake_schedule", { scheduleId: effect.scheduleId }),
          effect.scheduleId,
        )
      case "load-wake-schedules":
        return await loadWakeSchedules(state, runtime, effect.limit ?? CHECKPOINT_LIMIT)
      case "pause-wake-schedule": {
        const next = applyWakeSchedule(
          state,
          await runtime.command("runtime.pause_wake_schedule", { scheduleId: effect.scheduleId, requestedBy: "operator" }),
        )
        return await loadWakeSchedules(next, runtime, CHECKPOINT_LIMIT)
      }
      case "resume-wake-schedule": {
        const next = applyWakeSchedule(
          state,
          await runtime.command("runtime.resume_wake_schedule", { scheduleId: effect.scheduleId, requestedBy: "operator" }),
        )
        return await loadWakeSchedules(next, runtime, CHECKPOINT_LIMIT)
      }
      case "cancel-wake-schedule": {
        const next = applyWakeSchedule(
          state,
          await runtime.command("runtime.cancel_wake_schedule", { scheduleId: effect.scheduleId, requestedBy: "operator" }),
        )
        return await loadWakeSchedules(next, runtime, CHECKPOINT_LIMIT)
      }
      case "preview-wake-schedule-tick":
        return applyWakeScheduleTickPreview(state, await runtime.command("runtime.preview_wake_schedule_tick", { requestedBy: "operator" }))
      case "execute-wake-schedule-tick": {
        const next = applyWakeScheduleTickResult(
          state,
          await runtime.command("runtime.execute_wake_schedule_tick", { dryRun: effect.dryRun === true, requestedBy: "operator" }),
        )
        return effect.dryRun ? next : await loadWakeScheduleTicks(await loadWakeSchedules(next, runtime, CHECKPOINT_LIMIT), runtime, CHECKPOINT_LIMIT)
      }
      case "load-wake-schedule-ticks":
        return await loadWakeScheduleTicks(state, runtime, effect.limit ?? CHECKPOINT_LIMIT)
      case "load-wake-schedule-tick":
        return applyWakeScheduleTickResult(
          state,
          await runtime.command("runtime.get_wake_schedule_tick", { tickId: effect.tickId }),
          effect.tickId,
        )
      case "preview-wake-scheduler-start":
        return applyWakeSchedulerPreview(
          state,
          await runtime.command("runtime.preview_wake_scheduler_start", { intervalMs: effect.intervalMs, maxDueItems: effect.maxDueItems, dryRun: effect.dryRun === true, requestedBy: "operator" }),
        )
      case "start-wake-scheduler": {
        const next = applyWakeSchedulerStatus(
          state,
          await runtime.command("runtime.start_wake_scheduler", { intervalMs: effect.intervalMs, maxDueItems: effect.maxDueItems, dryRun: effect.dryRun === true, requestedBy: "operator" }),
        )
        return await loadWakeSchedulerEvents(next, runtime, CHECKPOINT_LIMIT)
      }
      case "stop-wake-scheduler": {
        const next = applyWakeSchedulerStatus(
          state,
          await runtime.command("runtime.stop_wake_scheduler", { reason: effect.reason, requestedBy: "operator" }),
        )
        return await loadWakeSchedulerEvents(next, runtime, CHECKPOINT_LIMIT)
      }
      case "load-wake-scheduler-status":
        return await loadWakeSchedulerStatusWithBootstrap(state, runtime)
      case "load-wake-scheduler-bootstrap-status":
        return applyWakeSchedulerBootstrapStatus(state, await runtime.command("runtime.wake_scheduler_bootstrap_status"))
      case "preview-wake-scheduler-bootstrap":
        return applyWakeSchedulerBootstrapPreview(state, await runtime.command("runtime.preview_wake_scheduler_bootstrap"))
      case "preview-wake-scheduler-recovery":
        return applyWakeSchedulerRecoveryPreview(state, await runtime.command("runtime.preview_wake_scheduler_recovery"))
      case "load-wake-scheduler-recoveries":
        return applyWakeSchedulerRecoveries(state, await runtime.command("runtime.list_wake_scheduler_recoveries", { limit: effect.limit ?? CHECKPOINT_LIMIT }), effect.limit ?? CHECKPOINT_LIMIT)
      case "load-wake-scheduler-recovery":
        return applyWakeSchedulerRecovery(state, await runtime.command("runtime.get_wake_scheduler_recovery", { recoveryId: effect.recoveryId }), effect.recoveryId)
      case "acknowledge-wake-scheduler-recovery": {
        const next = applyWakeSchedulerRecovery(state, await runtime.command("runtime.acknowledge_wake_scheduler_recovery", {
          recoveryId: effect.recoveryId,
          resolution: effect.resolution,
          reason: effect.reason,
          requestedBy: "operator",
        }), effect.recoveryId)
        const withPreview = applyWakeSchedulerRecoveryPreview(next, await runtime.command("runtime.preview_wake_scheduler_recovery"))
        return applyWakeSchedulerRecoveries(withPreview, await runtime.command("runtime.list_wake_scheduler_recoveries", { limit: CHECKPOINT_LIMIT }), CHECKPOINT_LIMIT)
      }
      case "preview-wake-scheduler-recovery-workflow":
        return applyWakeSchedulerRecoveryWorkflowPreview(state, await runtime.command("runtime.preview_wake_scheduler_recovery_workflow", { recoveryId: effect.recoveryId }))
      case "create-wake-scheduler-recovery-workflow":
        return applyWakeSchedulerRecoveryWorkflow(state, await runtime.command("runtime.create_wake_scheduler_recovery_workflow", { recoveryId: effect.recoveryId, requestedBy: "operator" }))
      case "load-wake-scheduler-recovery-workflows":
        return applyWakeSchedulerRecoveryWorkflows(state, await runtime.command("runtime.list_wake_scheduler_recovery_workflows", { limit: effect.limit ?? CHECKPOINT_LIMIT }), effect.limit ?? CHECKPOINT_LIMIT)
      case "load-wake-scheduler-recovery-workflow":
        return applyWakeSchedulerRecoveryWorkflow(state, await runtime.command("runtime.get_wake_scheduler_recovery_workflow", { workflowId: effect.workflowId }), effect.workflowId)
      case "verify-wake-scheduler-recovery-workflow":
        return applyWakeSchedulerRecoveryWorkflowVerification(state, await runtime.command("runtime.verify_wake_scheduler_recovery_workflow", { workflowId: effect.workflowId }))
      case "record-wake-scheduler-recovery-workflow-step":
        return applyWakeSchedulerRecoveryWorkflow(state, await runtime.command("runtime.record_wake_scheduler_recovery_workflow_step", { workflowId: effect.workflowId, index: effect.index, status: effect.status, note: effect.note, requestedBy: "operator" }), effect.workflowId)
      case "cancel-wake-scheduler-recovery-workflow":
        return applyWakeSchedulerRecoveryWorkflow(state, await runtime.command("runtime.cancel_wake_scheduler_recovery_workflow", { workflowId: effect.workflowId, reason: effect.reason, requestedBy: "operator" }), effect.workflowId)
      case "load-wake-scheduler-audit-summary":
        return applyWakeSchedulerAuditSummary(state, await runtime.command("runtime.wake_scheduler_audit_summary"))
      case "load-wake-scheduler-audit-timeline":
        return applyWakeSchedulerAuditTimeline(state, await runtime.command("runtime.wake_scheduler_audit_timeline", { limit: effect.limit ?? CHECKPOINT_LIMIT, kind: effect.kind, severity: effect.severity, relatedId: effect.relatedId }), effect.limit ?? CHECKPOINT_LIMIT)
      case "load-wake-scheduler-audit-chain":
        return applyWakeSchedulerAuditChain(state, await runtime.command("runtime.wake_scheduler_audit_chain", { relatedId: effect.relatedId, limit: effect.limit ?? CHECKPOINT_LIMIT }), effect.relatedId)
      case "load-wake-scheduler-audit-incidents":
        return applyWakeSchedulerAuditIncidents(state, await runtime.command("runtime.wake_scheduler_audit_incidents", { limit: effect.limit ?? CHECKPOINT_LIMIT, status: effect.status, severity: effect.severity }), effect.limit ?? CHECKPOINT_LIMIT)
      case "load-wake-scheduler-navigation-board":
        return applyWakeSchedulerNavigationBoard(state, await runtime.command("runtime.wake_scheduler_navigation_board", {
          relatedId: effect.relatedId,
          incidentId: effect.incidentId,
          auditId: effect.auditId,
          command: effect.command,
          includeWrite: effect.includeWrite,
          limit: effect.limit ?? CHECKPOINT_LIMIT,
        }))
      case "preview-wake-scheduler-navigation-command":
        return applyWakeSchedulerNavigationCommandPreview(state, await runtime.command("runtime.preview_wake_scheduler_navigation_command", { command: effect.command }))
      case "load-wake-scheduler-navigation-target":
        return applyWakeSchedulerNavigationTarget(state, await runtime.command("runtime.get_wake_scheduler_navigation_target", { targetKind: effect.targetKind, targetId: effect.targetId }))
      case "preview-wake-scheduler-navigation-stage":
        return applyWakeSchedulerNavigationStagePreview(state, await runtime.command("runtime.preview_wake_scheduler_navigation_stage", { command: effect.command, requestedBy: "operator" }))
      case "stage-wake-scheduler-navigation-command": {
        const next = applyWakeSchedulerNavigationStagedCommand(state, await runtime.command("runtime.stage_wake_scheduler_navigation_command", { command: effect.command, requestedBy: "operator" }))
        return applyWakeSchedulerNavigationStagedCommands(next, await runtime.command("runtime.list_wake_scheduler_navigation_staged_commands", { limit: CHECKPOINT_LIMIT }), CHECKPOINT_LIMIT)
      }
      case "load-wake-scheduler-navigation-staged-commands":
        return applyWakeSchedulerNavigationStagedCommands(state, await runtime.command("runtime.list_wake_scheduler_navigation_staged_commands", { limit: effect.limit ?? CHECKPOINT_LIMIT }), effect.limit ?? CHECKPOINT_LIMIT)
      case "remove-wake-scheduler-navigation-staged-command": {
        const next = applyWakeSchedulerNavigationStagedCommand(state, await runtime.command("runtime.remove_wake_scheduler_navigation_staged_command", { stagedId: effect.stagedId, requestedBy: "operator" }), effect.stagedId)
        return applyWakeSchedulerNavigationStagedCommands(next, await runtime.command("runtime.list_wake_scheduler_navigation_staged_commands", { limit: CHECKPOINT_LIMIT }), CHECKPOINT_LIMIT)
      }
      case "clear-wake-scheduler-navigation-staged-commands":
        return applyWakeSchedulerNavigationStagedCommands(state, await runtime.command("runtime.clear_wake_scheduler_navigation_staged_commands", { reason: effect.reason, requestedBy: "operator" }), CHECKPOINT_LIMIT)
      case "preview-wake-scheduler-navigation-staged-read":
        return applyWakeSchedulerNavigationStagedReadPreview(state, await runtime.command("runtime.preview_wake_scheduler_navigation_staged_read", { stagedId: effect.stagedId, requestedBy: "operator" }))
      case "dry-run-wake-scheduler-navigation-staged-read":
        return applyWakeSchedulerNavigationStagedReadPreview(state, await runtime.command("runtime.preview_wake_scheduler_navigation_staged_read", { stagedId: effect.stagedId, requestedBy: "operator" }))
      case "execute-wake-scheduler-navigation-staged-read": {
        const next = applyWakeSchedulerNavigationStagedReadResult(state, await runtime.command("runtime.execute_wake_scheduler_navigation_staged_read", { stagedId: effect.stagedId, requestedBy: "operator" }))
        return applyWakeSchedulerNavigationStagedReadRuns(next, await runtime.command("runtime.list_wake_scheduler_navigation_staged_read_runs", { limit: CHECKPOINT_LIMIT }), CHECKPOINT_LIMIT)
      }
      case "load-wake-scheduler-navigation-staged-read-runs":
        return applyWakeSchedulerNavigationStagedReadRuns(state, await runtime.command("runtime.list_wake_scheduler_navigation_staged_read_runs", { limit: effect.limit ?? CHECKPOINT_LIMIT, stagedId: effect.stagedId }), effect.limit ?? CHECKPOINT_LIMIT)
      case "load-wake-scheduler-navigation-staged-read-run":
        return applyWakeSchedulerNavigationStagedReadResult(state, await runtime.command("runtime.get_wake_scheduler_navigation_staged_read_run", { runId: effect.runId }), effect.runId)
      case "load-wake-scheduler-navigation-staged-read-history":
        return applyWakeSchedulerNavigationStagedReadHistory(state, await runtime.command("runtime.wake_scheduler_navigation_staged_read_history", { stagedId: effect.stagedId, command: effect.command, limit: effect.limit ?? CHECKPOINT_LIMIT, staleAfterMs: effect.staleAfterMs }))
      case "compare-wake-scheduler-navigation-staged-read":
        return applyWakeSchedulerNavigationStagedReadComparison(state, await runtime.command("runtime.wake_scheduler_navigation_staged_read_compare", { stagedId: effect.stagedId, latest: true }))
      case "compare-wake-scheduler-navigation-staged-read-runs":
        return applyWakeSchedulerNavigationStagedReadComparison(state, await runtime.command("runtime.wake_scheduler_navigation_staged_read_compare", { leftRunId: effect.leftRunId, rightRunId: effect.rightRunId }))
      case "load-wake-scheduler-navigation-staged-read-stale":
        return applyWakeSchedulerNavigationStagedReadStale(state, await runtime.command("runtime.wake_scheduler_navigation_staged_read_stale", { staleAfterMs: effect.staleAfterMs, limit: effect.limit ?? CHECKPOINT_LIMIT }), effect.limit ?? CHECKPOINT_LIMIT)
      case "load-wake-scheduler-navigation-staged-read-group":
        return applyWakeSchedulerNavigationStagedReadGroup(state, await runtime.command("runtime.wake_scheduler_navigation_staged_read_group", { stagedId: effect.stagedId, limit: effect.limit ?? CHECKPOINT_LIMIT }), effect.stagedId)
      case "preview-wake-scheduler-navigation-write-command":
        return applyWakeSchedulerNavigationWritePreview(state, await runtime.command("runtime.preview_wake_scheduler_navigation_write_command", { command: effect.command }))
      case "load-wake-scheduler-navigation-write-board":
        return applyWakeSchedulerNavigationWriteBoard(state, await runtime.command("runtime.wake_scheduler_navigation_write_board", {
          relatedId: effect.relatedId,
          incidentId: effect.incidentId,
          stagedId: effect.stagedId,
          includeHighImpact: effect.includeHighImpact,
          limit: effect.limit ?? CHECKPOINT_LIMIT,
        }))
      case "preview-wake-scheduler-navigation-write-stage":
        return applyWakeSchedulerNavigationWriteStagePreview(state, await runtime.command("runtime.preview_wake_scheduler_navigation_write_stage", { command: effect.command, allowMediumRisk: effect.allowMediumRisk, requestedBy: "operator" }))
      case "stage-wake-scheduler-navigation-write-command": {
        const next = applyWakeSchedulerNavigationStagedWriteCommand(state, await runtime.command("runtime.stage_wake_scheduler_navigation_write_command", { command: effect.command, allowMediumRisk: effect.allowMediumRisk, requestedBy: "operator" }))
        return applyWakeSchedulerNavigationStagedWriteCommands(next, await runtime.command("runtime.list_wake_scheduler_navigation_staged_write_commands", { limit: CHECKPOINT_LIMIT }), CHECKPOINT_LIMIT)
      }
      case "load-wake-scheduler-navigation-staged-write-commands":
        return applyWakeSchedulerNavigationStagedWriteCommands(state, await runtime.command("runtime.list_wake_scheduler_navigation_staged_write_commands", { limit: effect.limit ?? CHECKPOINT_LIMIT }), effect.limit ?? CHECKPOINT_LIMIT)
      case "load-wake-scheduler-navigation-staged-write-command":
        return applyWakeSchedulerNavigationStagedWriteCommand(state, await runtime.command("runtime.get_wake_scheduler_navigation_staged_write_command", { stagedWriteId: effect.stagedWriteId }), effect.stagedWriteId)
      case "remove-wake-scheduler-navigation-staged-write-command": {
        const next = applyWakeSchedulerNavigationStagedWriteCommand(state, await runtime.command("runtime.remove_wake_scheduler_navigation_staged_write_command", { stagedWriteId: effect.stagedWriteId, requestedBy: "operator" }), effect.stagedWriteId)
        return applyWakeSchedulerNavigationStagedWriteCommands(next, await runtime.command("runtime.list_wake_scheduler_navigation_staged_write_commands", { limit: CHECKPOINT_LIMIT }), CHECKPOINT_LIMIT)
      }
      case "clear-wake-scheduler-navigation-staged-write-commands":
        return applyWakeSchedulerNavigationStagedWriteCommands(state, await runtime.command("runtime.clear_wake_scheduler_navigation_staged_write_commands", { reason: effect.reason, requestedBy: "operator" }), CHECKPOINT_LIMIT)
      case "preview-wake-scheduler-navigation-write-run":
        return applyWakeSchedulerNavigationWriteRunPreview(state, await runtime.command("runtime.preview_wake_scheduler_navigation_write_run", { stagedWriteId: effect.stagedWriteId, requestedBy: "operator" }))
      case "execute-wake-scheduler-navigation-write-run": {
        const next = applyWakeSchedulerNavigationWriteRunResult(state, await runtime.command("runtime.execute_wake_scheduler_navigation_write_run", { stagedWriteId: effect.stagedWriteId, requestedBy: "operator" }))
        return applyWakeSchedulerNavigationWriteRunRecords(next, await runtime.command("runtime.list_wake_scheduler_navigation_write_runs", { limit: CHECKPOINT_LIMIT }), CHECKPOINT_LIMIT)
      }
      case "dry-run-wake-scheduler-navigation-write-run":
        return applyWakeSchedulerNavigationWriteRunResult(state, await runtime.command("runtime.execute_wake_scheduler_navigation_write_run", { stagedWriteId: effect.stagedWriteId, dryRun: true, requestedBy: "operator" }))
      case "load-wake-scheduler-navigation-write-runs":
        return applyWakeSchedulerNavigationWriteRunRecords(state, await runtime.command("runtime.list_wake_scheduler_navigation_write_runs", { limit: effect.limit ?? CHECKPOINT_LIMIT, stagedWriteId: effect.stagedWriteId }), effect.limit ?? CHECKPOINT_LIMIT)
      case "load-wake-scheduler-navigation-write-run":
        return applyWakeSchedulerNavigationWriteRunResult(state, await runtime.command("runtime.get_wake_scheduler_navigation_write_run", { runId: effect.runId }), effect.runId)
      case "load-wake-scheduler-navigation-write-run-history":
        return applyWakeSchedulerNavigationWriteRunHistory(state, await runtime.command("runtime.wake_scheduler_navigation_write_run_history", { stagedWriteId: effect.stagedWriteId, command: effect.command, limit: effect.limit ?? CHECKPOINT_LIMIT, staleAfterMs: effect.staleAfterMs }))
      case "compare-wake-scheduler-navigation-write-run":
        return applyWakeSchedulerNavigationWriteRunComparison(state, await runtime.command("runtime.wake_scheduler_navigation_write_run_compare", { stagedWriteId: effect.stagedWriteId, latest: true }))
      case "compare-wake-scheduler-navigation-write-run-runs":
        return applyWakeSchedulerNavigationWriteRunComparison(state, await runtime.command("runtime.wake_scheduler_navigation_write_run_compare", { leftRunId: effect.leftRunId, rightRunId: effect.rightRunId }))
      case "load-wake-scheduler-navigation-write-run-stale":
        return applyWakeSchedulerNavigationWriteRunStale(state, await runtime.command("runtime.wake_scheduler_navigation_write_run_stale", { staleAfterMs: effect.staleAfterMs, limit: effect.limit ?? CHECKPOINT_LIMIT }), effect.limit ?? CHECKPOINT_LIMIT)
      case "load-wake-scheduler-navigation-write-run-group":
        return applyWakeSchedulerNavigationWriteRunGroup(state, await runtime.command("runtime.wake_scheduler_navigation_write_run_group", { stagedWriteId: effect.stagedWriteId, limit: effect.limit ?? CHECKPOINT_LIMIT }), effect.stagedWriteId)
      case "preview-wake-scheduler-navigation-write-readiness":
        return applyWakeSchedulerNavigationWriteReadinessPreview(state, await runtime.command("runtime.preview_wake_scheduler_navigation_write_readiness", { stagedWriteId: effect.stagedWriteId }))
      case "approve-wake-scheduler-navigation-staged-write": {
        const next = applyWakeSchedulerNavigationWriteApproval(state, await runtime.command("runtime.approve_wake_scheduler_navigation_staged_write", { stagedWriteId: effect.stagedWriteId, reason: effect.reason, requestedBy: "operator" }))
        return applyWakeSchedulerNavigationWriteApprovalRecords(next, await runtime.command("runtime.list_wake_scheduler_navigation_write_approvals", { limit: CHECKPOINT_LIMIT }), CHECKPOINT_LIMIT)
      }
      case "reject-wake-scheduler-navigation-staged-write": {
        const next = applyWakeSchedulerNavigationWriteApproval(state, await runtime.command("runtime.reject_wake_scheduler_navigation_staged_write", { stagedWriteId: effect.stagedWriteId, reason: effect.reason, requestedBy: "operator" }))
        return applyWakeSchedulerNavigationWriteApprovalRecords(next, await runtime.command("runtime.list_wake_scheduler_navigation_write_approvals", { limit: CHECKPOINT_LIMIT }), CHECKPOINT_LIMIT)
      }
      case "revoke-wake-scheduler-navigation-write-approval": {
        const next = applyWakeSchedulerNavigationWriteApproval(state, await runtime.command("runtime.revoke_wake_scheduler_navigation_write_approval", { approvalId: effect.approvalId, reason: effect.reason, requestedBy: "operator" }), effect.approvalId)
        return applyWakeSchedulerNavigationWriteApprovalRecords(next, await runtime.command("runtime.list_wake_scheduler_navigation_write_approvals", { limit: CHECKPOINT_LIMIT }), CHECKPOINT_LIMIT)
      }
      case "load-wake-scheduler-navigation-write-approvals":
        return applyWakeSchedulerNavigationWriteApprovalRecords(state, await runtime.command("runtime.list_wake_scheduler_navigation_write_approvals", { limit: effect.limit ?? CHECKPOINT_LIMIT }), effect.limit ?? CHECKPOINT_LIMIT)
      case "load-wake-scheduler-navigation-write-approval":
        return applyWakeSchedulerNavigationWriteApproval(state, await runtime.command("runtime.get_wake_scheduler_navigation_write_approval", { approvalId: effect.approvalId }), effect.approvalId)
      case "preview-wake-scheduler-navigation-checkpoint-write-run":
        return applyWakeSchedulerNavigationCheckpointWriteRunPreview(state, await runtime.command("runtime.preview_wake_scheduler_navigation_checkpoint_write_run", { stagedWriteId: effect.stagedWriteId, requestedBy: "operator" }))
      case "execute-wake-scheduler-navigation-checkpoint-write-run": {
        const next = applyWakeSchedulerNavigationCheckpointWriteRunResult(state, await runtime.command("runtime.execute_wake_scheduler_navigation_checkpoint_write_run", { stagedWriteId: effect.stagedWriteId, requestedBy: "operator" }))
        return applyWakeSchedulerNavigationCheckpointWriteRunRecords(next, await runtime.command("runtime.list_wake_scheduler_navigation_checkpoint_write_runs", { limit: CHECKPOINT_LIMIT }), CHECKPOINT_LIMIT)
      }
      case "dry-run-wake-scheduler-navigation-checkpoint-write-run":
        return applyWakeSchedulerNavigationCheckpointWriteRunResult(state, await runtime.command("runtime.execute_wake_scheduler_navigation_checkpoint_write_run", { stagedWriteId: effect.stagedWriteId, dryRun: true, requestedBy: "operator" }))
      case "load-wake-scheduler-navigation-checkpoint-write-runs":
        return applyWakeSchedulerNavigationCheckpointWriteRunRecords(state, await runtime.command("runtime.list_wake_scheduler_navigation_checkpoint_write_runs", { limit: effect.limit ?? CHECKPOINT_LIMIT, stagedWriteId: effect.stagedWriteId }), effect.limit ?? CHECKPOINT_LIMIT)
      case "load-wake-scheduler-navigation-checkpoint-write-run":
        return applyWakeSchedulerNavigationCheckpointWriteRunResult(state, await runtime.command("runtime.get_wake_scheduler_navigation_checkpoint_write_run", { runId: effect.runId }), effect.runId)
      case "load-wake-scheduler-navigation-checkpoint-write-history":
        return applyWakeSchedulerNavigationCheckpointWriteHistory(state, await runtime.command("runtime.wake_scheduler_navigation_checkpoint_write_history", { stagedWriteId: effect.stagedWriteId, approvalId: effect.approvalId, command: effect.command, limit: effect.limit ?? CHECKPOINT_LIMIT, staleAfterMs: effect.staleAfterMs }))
      case "compare-wake-scheduler-navigation-checkpoint-write":
        return applyWakeSchedulerNavigationCheckpointWriteComparison(state, await runtime.command("runtime.wake_scheduler_navigation_checkpoint_write_compare", { stagedWriteId: effect.stagedWriteId, latest: true }))
      case "compare-wake-scheduler-navigation-checkpoint-write-runs":
        return applyWakeSchedulerNavigationCheckpointWriteComparison(state, await runtime.command("runtime.wake_scheduler_navigation_checkpoint_write_compare", { leftRunId: effect.leftRunId, rightRunId: effect.rightRunId }))
      case "load-wake-scheduler-navigation-checkpoint-write-stale":
        return applyWakeSchedulerNavigationCheckpointWriteStale(state, await runtime.command("runtime.wake_scheduler_navigation_checkpoint_write_stale", { staleAfterMs: effect.staleAfterMs, limit: effect.limit ?? CHECKPOINT_LIMIT }), effect.limit ?? CHECKPOINT_LIMIT)
      case "load-wake-scheduler-navigation-checkpoint-write-group":
        return applyWakeSchedulerNavigationCheckpointWriteGroup(state, await runtime.command("runtime.wake_scheduler_navigation_checkpoint_write_group", { stagedWriteId: effect.stagedWriteId, limit: effect.limit ?? CHECKPOINT_LIMIT }), effect.stagedWriteId)
      case "load-wake-scheduler-navigation-checkpoint-approval-usage":
        return applyWakeSchedulerNavigationCheckpointApprovalUsage(state, await runtime.command("runtime.wake_scheduler_navigation_checkpoint_write_approval_usage", { approvalId: effect.approvalId, stagedWriteId: effect.stagedWriteId, limit: effect.limit ?? CHECKPOINT_LIMIT, staleAfterMs: effect.staleAfterMs }))
      case "load-wake-scheduler-events":
        return await loadWakeSchedulerEvents(state, runtime, effect.limit ?? CHECKPOINT_LIMIT)
      case "send-user-message": {
        const result = await runtime.sendUserMessage(effect.message)
        const next = result ? applySubmissionResult(state, result) : state
        return await refreshRuntimeRecordsOrRecordError(next, runtime)
      }
      case "send-command": {
        const next = await applyNamedRuntimeCommand(state, runtime, effect.command, effect.args ?? [])
        return shouldRefreshAfterCommand(effect.command) ? await refreshRuntimeRecordsOrRecordError(next, runtime) : next
      }
    }
  } catch (error) {
    if (isOperatorActionEffect(effect)) return recordOperatorActionCommandError(state, error)
    if (isMissionExecutionEffect(effect)) return recordMissionExecutionCommandError(state, error)
    if (isReviewEffect(effect)) return recordReviewCommandError(state, error)
    if (isProposalEffect(effect)) return recordProposalCommandError(state, error)
    if (isProposalBundleEffect(effect)) return recordProposalBundleCommandError(state, error)
    if (isPlaybookEffect(effect)) return recordPlaybookCommandError(state, error)
    if (isWorkbenchEffect(effect)) return recordWorkbenchCommandError(state, error)
    if (isCommanderApplyEffect(effect)) return recordCommanderApplyCommandError(state, error)
    if (isCommanderAuditEffect(effect)) return recordCommanderAuditCommandError(state, error)
    if (isCommanderQueueEffect(effect)) return recordCommanderQueueCommandError(state, error)
    if (isCommanderNavigationEffect(effect)) return recordCommanderNavigationCommandError(state, error)
    if (isExternalApiEffect(effect)) return recordExternalApiCommandError(state, error)
    if (isResearchSynthesisEffect(effect)) return recordResearchSynthesisCommandError(state, error)
    if (isCommanderCycleEffect(effect)) return recordCommanderCycleCommandError(state, error)
    if (isOpenCodeHandoffEffect(effect)) return recordOpenCodeHandoffCommandError(state, error)
    if (isOpenCodeProcessSmokeEffect(effect)) return recordOpenCodeProcessSmokeCommandError(state, error)
    if (isOpenCodeHandoffReadinessEffect(effect)) return recordOpenCodeHandoffReadinessCommandError(state, error)
    if (isOpenCodeResultReviewEffect(effect)) return recordOpenCodeResultReviewCommandError(state, error)
    if (isOpenCodeSessionEffect(effect)) return recordOpenCodeSessionCommandError(state, error)
    if (isContextBudgetEffect(effect)) return recordContextBudgetCommandError(state, error)
    if (isContextPacketEffect(effect)) return recordContextPacketCommandError(state, error)
    if (isOpenCodeSessionInstructionPackEffect(effect)) return recordOpenCodeSessionInstructionPackCommandError(state, error)
    if (isResearchMemoryEffect(effect)) return recordResearchMemoryCommandError(state, error)
    if (isCommanderExecutorReviewEffect(effect)) return recordCommanderExecutorReviewCommandError(state, error)
    if (isExecutorReviewProposalDraftEffect(effect)) return recordExecutorReviewProposalDraftCommandError(state, error)
    if (isExecutorReviewProposalCreateEffect(effect)) return recordExecutorReviewProposalCreateCommandError(state, error)
    if (isExecutorReviewProposalReviewRequestEffect(effect)) return recordExecutorReviewProposalReviewRequestCommandError(state, error)
    if (isExecutorReviewProposalReviewDecisionEffect(effect)) return recordExecutorReviewProposalReviewDecisionCommandError(state, error)
    if (isExecutorReviewProposalApplyReadinessEffect(effect)) return recordExecutorReviewProposalApplyReadinessCommandError(state, error)
    if (isExecutorReviewProposalNarrowApplyEffect(effect)) return recordExecutorReviewProposalNarrowApplyCommandError(state, error)
    if (isMiniMaxLiveValidationEffect(effect)) return recordMiniMaxLiveValidationCommandError(state, error)
    if (isOpenCodeFollowupEffect(effect)) return recordOpenCodeFollowupCommandError(state, error)
    if (isRuntimeCheckpointEffect(effect)) return recordRuntimeCheckpointCommandError(state, error)
    if (isRuntimeRestoreEffect(effect)) return recordRuntimeRestoreCommandError(state, error)
    if (isWakeAssessmentEffect(effect)) return recordWakeAssessmentCommandError(state, error)
    if (isContinuationEffect(effect)) return recordContinuationCommandError(state, error)
    if (isWakeScheduleEffect(effect)) return recordWakeScheduleCommandError(state, error)
    if (isWakeSchedulerEffect(effect)) return recordWakeSchedulerCommandError(state, error)
    if (isCommandAuthorityEffect(effect)) return recordCommandAuthorityCommandError(state, error)
    if (isReasoningProviderEffect(effect)) return recordReasoningProviderCommandError(state, error)
    if (isResearchEffect(effect)) return recordResearchCommandError(state, error)
    return recordRuntimeCommandError(state, error)
  }
}

export async function refreshRuntimeRecords(state: UiState, runtime: RuntimeClient): Promise<UiState> {
  let next = state
  next = await applyRuntimeUiEffect(next, runtime, { type: "load-runtime-status" })
  next = await applyRuntimeUiEffect(next, runtime, { type: "load-recent-missions", limit: 5 })
  next = await applyRuntimeUiEffect(next, runtime, { type: "load-reviews", limit: REVIEW_LIMIT })
  next = await applyRuntimeUiEffect(next, runtime, { type: "load-proposals", limit: PROPOSAL_LIMIT })
  next = await applyRuntimeUiEffect(next, runtime, { type: "load-proposal-bundles", limit: PROPOSAL_BUNDLE_LIMIT })
  next = await applyRuntimeUiEffect(next, runtime, { type: "load-playbooks", limit: PLAYBOOK_LIMIT })
  next = await applyRuntimeUiEffect(next, runtime, { type: "load-playbook-drafts", limit: WORKBENCH_DRAFT_LIMIT })
  return next
}

export async function refreshResearchRecords(state: UiState, runtime: RuntimeClient): Promise<UiState> {
  let next: UiState = { ...state, research: { ...researchState(state), commandError: undefined } }
  next = await applyRuntimeUiEffect(next, runtime, { type: "load-research-projection-status" })
  next = await applyRuntimeUiEffect(next, runtime, { type: "load-research-topics", limit: RESEARCH_TOPIC_LIMIT })
  next = await applyRuntimeUiEffect(next, runtime, { type: "load-research-events", limit: RESEARCH_EVENT_LIMIT })
  return next
}

async function refreshRuntimeRecordsOrRecordError(state: UiState, runtime: RuntimeClient): Promise<UiState> {
  try {
    return await refreshRuntimeRecords(state, runtime)
  } catch (error) {
    return recordRuntimeCommandError(state, error)
  }
}

async function refreshResearchRecordsOrRecordError(state: UiState, runtime: RuntimeClient): Promise<UiState> {
  try {
    return await refreshResearchRecords(state, runtime)
  } catch (error) {
    return recordResearchCommandError(state, error)
  }
}

async function loadMissionExecutionRecords(state: UiState, runtime: RuntimeClient, missionId: string): Promise<UiState> {
  let next = await applyRuntimeUiEffect(state, runtime, { type: "load-mission-details", missionId })
  next = await applyRuntimeUiEffect(next, runtime, { type: "load-mission-claims", missionId })
  next = await applyRuntimeUiEffect(next, runtime, { type: "load-mission-progress", missionId })
  next = await applyRuntimeUiEffect(next, runtime, { type: "load-mission-results", missionId })
  return next
}

async function refreshAfterMissionWrite(state: UiState, runtime: RuntimeClient, missionId: string): Promise<UiState> {
  let next = await loadMissionExecutionRecords(state, runtime, missionId)
  const activeMissionId = next.missionExecution?.selectedMissionId ?? redactText(missionId)
  next = await refreshRuntimeRecordsOrRecordError(next, runtime)
  return {
    ...next,
    header: {
      ...next.header,
      activeMissionId,
    },
  }
}

function missionIdForClaim(state: UiState, claimId?: string): string | undefined {
  if (!claimId) return undefined
  return state.missionExecution?.claims.find((claim) => claim.claim_id === claimId)?.mission_id
}

async function missionIdsForProposalIds(state: UiState, runtime: RuntimeClient, proposalIds: string[]): Promise<string[]> {
  const missionIds: string[] = []
  for (const proposalId of proposalIds) {
    let proposal = state.proposals?.recent.find((item) => item.proposal_id === proposalId)
    if (!proposal) {
      proposal = readProposal(await runtime.command("runtime.get_commander_proposal", { proposalId })) ?? undefined
    }
    const missionId = proposal?.mission_id ?? missionIdForClaim(state, proposal?.claim_id)
    if (missionId && !missionIds.includes(missionId)) missionIds.push(missionId)
  }
  return missionIds
}

async function loadReviews(state: UiState, runtime: RuntimeClient, limit: number): Promise<UiState> {
  const summary = readReviewSummary(await runtime.command("runtime.review_status"))
  const pending = readReviewList(await runtime.command("runtime.list_review_requests", { status: "pending", limit }), "runtime.list_review_requests")
  const recent = readReviewList(await runtime.command("runtime.list_review_requests", { limit }), "runtime.list_review_requests")
  return {
    ...state,
    reviews: {
      ...reviewsState(state),
      summary,
      pending,
      recent,
      commandError: state.lastCommand === "reviews" ? undefined : state.reviews?.commandError,
    },
  }
}

async function loadProposals(state: UiState, runtime: RuntimeClient, limit: number): Promise<UiState> {
  const summary = readProposalSummary(await runtime.command("runtime.proposal_status"))
  const recent = readProposalList(await runtime.command("runtime.list_commander_proposals", { limit }), "runtime.list_commander_proposals")
  return {
    ...state,
    proposals: {
      ...proposalsState(state),
      summary,
      recent,
      commandError: state.lastCommand === "proposals" ? undefined : state.proposals?.commandError,
    },
  }
}

async function loadProposalBundles(state: UiState, runtime: RuntimeClient, limit: number): Promise<UiState> {
  const summary = readProposalBundleSummary(await runtime.command("runtime.proposal_bundle_status"))
  const recent = readProposalBundleList(await runtime.command("runtime.list_proposal_bundles", { limit }), "runtime.list_proposal_bundles")
  return {
    ...state,
    proposalBundles: {
      ...proposalBundlesState(state),
      summary,
      recent,
      commandError: state.lastCommand === "bundles" ? undefined : state.proposalBundles?.commandError,
    },
  }
}

async function loadProposalBundleReadiness(state: UiState, runtime: RuntimeClient, bundleId: string): Promise<UiState> {
  const readiness = readProposalBundleReadiness(await runtime.command("runtime.proposal_bundle_readiness", { bundleId }))
  return {
    ...state,
    proposalBundles: {
      ...proposalBundlesState(state),
      readiness,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "proposal bundle readiness", detail: `bundle_id=${redactText(bundleId)}`, status: readiness.ready_to_apply ? "ready" : "blocked" }].slice(-12),
  }
}

async function loadPlaybookDrafts(state: UiState, runtime: RuntimeClient, limit: number): Promise<UiState> {
  const summary = readWorkbenchSummary(await runtime.command("runtime.commander_playbook_draft_status"))
  const drafts = readWorkbenchDraftList(await runtime.command("runtime.list_commander_playbook_drafts", { limit }), "runtime.list_commander_playbook_drafts")
  return {
    ...state,
    commanderWorkbench: {
      ...commanderWorkbenchState(state),
      summary,
      drafts,
      commandError: state.lastCommand === "drafts" || state.lastCommand === "workbench" ? undefined : state.commanderWorkbench?.commandError,
    },
  }
}

async function loadPlaybookDraftReadiness(state: UiState, runtime: RuntimeClient, draftId: string): Promise<UiState> {
  const readiness = readWorkbenchReadiness(await runtime.command("runtime.commander_playbook_draft_readiness", { draftId }))
  return {
    ...state,
    commanderWorkbench: {
      ...commanderWorkbenchState(state),
      readiness,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "playbook draft readiness", detail: `draft_id=${redactText(draftId)}`, status: readiness.ready_to_apply ? "ready" : "blocked" }].slice(-12),
  }
}

async function refreshProposalBundlesProposalsAndReviews(state: UiState, runtime: RuntimeClient, bundleId: string): Promise<UiState> {
  let next = await loadProposalBundles(state, runtime, PROPOSAL_BUNDLE_LIMIT)
  next = await loadProposalBundleReadiness(next, runtime, bundleId)
  next = await loadProposals(next, runtime, PROPOSAL_LIMIT)
  next = await loadReviews(next, runtime, REVIEW_LIMIT)
  return next
}

async function refreshAfterBundleWrite(state: UiState, runtime: RuntimeClient, bundleId: string): Promise<UiState> {
  let next = await refreshProposalBundlesProposalsAndReviews(state, runtime, bundleId)
  const selectedBundle = next.proposalBundles?.selectedBundle
  const missionId = selectedBundle?.proposal_ids
    .map((proposalId) => next.proposals?.recent.find((proposal) => proposal.proposal_id === proposalId)?.mission_id)
    .find((candidate): candidate is string => typeof candidate === "string")
  if (missionId) next = await loadMissionExecutionRecords(next, runtime, missionId)
  next = await refreshRuntimeRecordsOrRecordError(next, runtime)
  return next
}

async function refreshProposalAndReviews(state: UiState, runtime: RuntimeClient): Promise<UiState> {
  let next = await loadProposals(state, runtime, PROPOSAL_LIMIT)
  next = await loadReviews(next, runtime, REVIEW_LIMIT)
  return next
}

async function refreshAfterPlaybookDraft(state: UiState, runtime: RuntimeClient): Promise<UiState> {
  let next = await loadProposals(state, runtime, PROPOSAL_LIMIT)
  next = await loadProposalBundles(next, runtime, PROPOSAL_BUNDLE_LIMIT)
  next = await loadReviews(next, runtime, REVIEW_LIMIT)
  next = await loadPlaybookDrafts(next, runtime, WORKBENCH_DRAFT_LIMIT)
  return next
}

async function refreshAfterCommanderApply(state: UiState, runtime: RuntimeClient, targetType: "proposal" | "bundle" | "draft", targetId: string): Promise<UiState> {
  let next = await loadProposals(state, runtime, PROPOSAL_LIMIT)
  next = await loadProposalBundles(next, runtime, PROPOSAL_BUNDLE_LIMIT)
  next = await loadPlaybookDrafts(next, runtime, WORKBENCH_DRAFT_LIMIT)
  next = await loadReviews(next, runtime, REVIEW_LIMIT)
  try {
    next = applyCommanderApplyPreview(next, await runtime.command("runtime.commander_apply_preview", { targetType, targetId }))
  } catch {
    // The apply result is more important than a stale post-apply preview.
  }
  const targetProposalIds = [
    ...(next.commanderApply?.lastResult?.applied_proposal_ids ?? []),
    ...(next.commanderApply?.lastResult?.skipped_proposal_ids ?? []),
  ]
  const affectedMissionIds = await missionIdsForProposalIds(next, runtime, targetProposalIds)
  const selectedMissionId = next.missionExecution?.selectedMissionId
  const missionId = selectedMissionId && affectedMissionIds.includes(selectedMissionId)
    ? selectedMissionId
    : affectedMissionIds[0]
  return missionId ? await refreshAfterMissionWrite(next, runtime, missionId) : next
}

async function loadCommanderQueues(state: UiState, runtime: RuntimeClient, queue: CommanderQueueKind, limit: number, staleAfterMs?: number): Promise<UiState> {
  const summary = readCommanderQueueSummary(await runtime.command("runtime.commander_queue_summary", staleAfterMs === undefined ? {} : { staleAfterMs }))
  const next = {
    ...state,
    commanderQueues: {
      ...commanderQueuesState(state),
      summary,
      commandError: undefined,
    },
  }
  return await loadCommanderQueue(next, runtime, queue, limit, staleAfterMs)
}

async function loadCommanderQueue(state: UiState, runtime: RuntimeClient, queue: CommanderQueueKind, limit: number, staleAfterMs?: number): Promise<UiState> {
  const result = readCommanderQueueResult(await runtime.command("runtime.commander_queue", { queue, limit, ...(staleAfterMs === undefined ? {} : { staleAfterMs }) }))
  return {
    ...state,
    commanderQueues: {
      ...commanderQueuesState(state),
      selectedQueue: result.queue,
      items: result.items.slice(0, limit),
      totalConsidered: result.total_considered,
      limit: result.limit,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "commander queue loaded", detail: `queue=${result.queue} items=${result.items.length}`, status: "loaded" }].slice(-12),
  }
}

async function loadExternalApiConnectors(state: UiState, runtime: RuntimeClient, limit: number): Promise<UiState> {
  const connectors = readExternalApiConnectorList(await runtime.command("runtime.list_external_api_connectors"), "runtime.list_external_api_connectors", limit)
  const next = {
    ...state,
    externalApi: {
      ...externalApiState(state),
      connectors,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "external API connectors loaded", detail: `connectors=${connectors.length}`, status: "loaded" }].slice(-12),
  }
  return await loadExternalApiAudit(next, runtime, EXTERNAL_API_LIMIT)
}

async function loadExternalApiAudit(state: UiState, runtime: RuntimeClient, limit: number): Promise<UiState> {
  const audit = readExternalApiAuditList(await runtime.command("runtime.list_external_api_audit", { limit }), "runtime.list_external_api_audit", limit)
  return {
    ...state,
    externalApi: {
      ...externalApiState(state),
      audit,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "external API audit loaded", detail: `records=${audit.length}`, status: "loaded" }].slice(-12),
  }
}

async function loadExternalApiResearchIngestions(state: UiState, runtime: RuntimeClient, limit: number): Promise<UiState> {
  const ingestions = readExternalApiResearchIngestionList(await runtime.command("runtime.list_external_api_research_ingestions", { limit }), "runtime.list_external_api_research_ingestions", limit)
  return {
    ...state,
    externalApi: {
      ...externalApiState(state),
      research: {
        ...externalApiResearchState(state),
        ingestions,
        commandError: undefined,
      },
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "external API research ingestions loaded", detail: `records=${ingestions.length}`, status: "loaded" }].slice(-12),
  }
}

async function loadResearchSyntheses(state: UiState, runtime: RuntimeClient, limit: number): Promise<UiState> {
  const recent = readResearchSynthesisRecordList(await runtime.command("runtime.list_research_syntheses", { limit }), "runtime.list_research_syntheses", limit)
  return {
    ...state,
    researchSynthesis: {
      ...researchSynthesisState(state),
      recent,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "research syntheses loaded", detail: `records=${recent.length}`, status: "loaded" }].slice(-12),
  }
}

async function loadCommanderCycles(state: UiState, runtime: RuntimeClient, limit: number): Promise<UiState> {
  const recent = readCommanderCycleRecordList(await runtime.command("runtime.list_commander_cycles", { limit }), "runtime.list_commander_cycles", limit)
  return {
    ...state,
    commanderCycle: {
      ...commanderCycleState(state),
      recent,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "commander cycles loaded", detail: `records=${recent.length}`, status: "loaded" }].slice(-12),
  }
}

async function loadOpenCodeHandoffs(state: UiState, runtime: RuntimeClient, limit: number): Promise<UiState> {
  const recent = readOpenCodeHandoffRecordList(await runtime.command("runtime.list_opencode_handoffs", { limit }), "runtime.list_opencode_handoffs", limit)
  return {
    ...state,
    opencodeHandoff: {
      ...opencodeHandoffState(state),
      recent,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode handoffs loaded", detail: `records=${recent.length}`, status: "loaded" }].slice(-12),
  }
}

async function loadOpenCodeHandoffFollowups(state: UiState, runtime: RuntimeClient, limit: number): Promise<UiState> {
  const items = readOpenCodeHandoffFollowupList(await runtime.command("runtime.list_opencode_handoff_followups", { limit }), "runtime.list_opencode_handoff_followups", limit)
  const summary = readOpenCodeHandoffFollowupCounts(await runtime.command("runtime.opencode_handoff_followup_summary"))
  return {
    ...state,
    opencodeFollowup: {
      ...opencodeFollowupState(state),
      summary,
      queueItems: items,
      selectedQueue: undefined,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode follow-ups loaded", detail: `records=${items.length}`, status: "loaded" }].slice(-12),
  }
}

async function loadRuntimeCheckpoints(state: UiState, runtime: RuntimeClient, limit: number): Promise<UiState> {
  const recent = readRuntimeCheckpointRecordList(await runtime.command("runtime.list_runtime_checkpoints", { limit }), "runtime.list_runtime_checkpoints", limit)
  return {
    ...state,
    runtimeCheckpoints: {
      ...runtimeCheckpointsState(state),
      recent,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "runtime checkpoints loaded", detail: `records=${recent.length}`, status: "loaded" }].slice(-12),
  }
}

async function loadRuntimeResumeAnchors(state: UiState, runtime: RuntimeClient, limit: number): Promise<UiState> {
  const recentAnchors = readRuntimeResumeAnchorList(await runtime.command("runtime.list_checkpoint_resume_anchors", { limit }), "runtime.list_checkpoint_resume_anchors", limit)
  return {
    ...state,
    runtimeRestore: {
      ...runtimeRestoreState(state),
      recentAnchors,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "checkpoint resume anchors loaded", detail: `records=${recentAnchors.length}`, status: "loaded" }].slice(-12),
  }
}

async function refreshAfterHandoff(state: UiState, runtime: RuntimeClient): Promise<UiState> {
  let next = await loadOpenCodeHandoffs(state, runtime, HANDOFF_LIMIT)
  next = await loadOpenCodeHandoffFollowups(next, runtime, HANDOFF_LIMIT)
  next = await loadProposals(next, runtime, PROPOSAL_LIMIT)
  const missionId = next.opencodeHandoff?.lastResult?.mission_id
  return missionId ? await refreshAfterMissionWrite(next, runtime, missionId) : await refreshRuntimeRecordsOrRecordError(next, runtime)
}

function applyExternalApiConnector(state: UiState, value: unknown, connectorId: string): UiState {
  const connector = readExternalApiConnector(value)
  if (!connector && value !== null) throw new Error("runtime.get_external_api_connector returned invalid connector")
  const selectedConnectorId = connector?.connector_id ?? redactText(connectorId)
  return {
    ...state,
    externalApi: {
      ...externalApiState(state),
      selectedConnector: connector,
      connectors: connector ? [connector, ...externalApiState(state).connectors.filter((item) => item.connector_id !== connector.connector_id)].slice(0, EXTERNAL_API_LIMIT) : externalApiState(state).connectors,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "external API connector selected", detail: `connector_id=${selectedConnectorId}`, status: connector ? "loaded" : "missing" }].slice(-12),
  }
}

function applyExternalApiPreview(state: UiState, value: unknown): UiState {
  const requestPreview = readExternalApiPreview(value)
  return {
    ...state,
    externalApi: {
      ...externalApiState(state),
      preview: requestPreview,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "external API preview", detail: requestPreview.url, status: requestPreview.allowed ? "allowed" : "blocked" }].slice(-12),
  }
}

function applyExternalApiResult(state: UiState, value: unknown): UiState {
  const result = readExternalApiResult(value)
  return {
    ...state,
    externalApi: {
      ...externalApiState(state),
      lastResult: result,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "external API result", detail: `${result.connector_id} ${result.status_code ?? "no-status"}`, status: result.ok ? "ok" : "failed" }].slice(-12),
  }
}

function applyExternalApiResearchPreview(state: UiState, value: unknown): UiState {
  const ingestPreview = readExternalApiResearchIngestionPreview(value)
  return {
    ...state,
    externalApi: {
      ...externalApiState(state),
      research: {
        ...externalApiResearchState(state),
        preview: ingestPreview,
        commandError: undefined,
      },
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "external API research ingest preview", detail: ingestPreview.url, status: ingestPreview.allowed ? "allowed" : "blocked" }].slice(-12),
  }
}

function applyExternalApiResearchResult(state: UiState, value: unknown): UiState {
  const result = readExternalApiResearchIngestionResult(value)
  return {
    ...state,
    externalApi: {
      ...externalApiState(state),
      research: {
        ...externalApiResearchState(state),
        lastResult: result,
        commandError: undefined,
      },
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "external API research ingest result", detail: `${result.connector_id} topic=${result.topic_id}`, status: result.ok ? "ok" : "failed" }].slice(-12),
  }
}

function applyResearchSynthesisPreview(state: UiState, value: unknown): UiState {
  const synthPreview = readResearchSynthesisPreview(value)
  return {
    ...state,
    researchSynthesis: {
      ...researchSynthesisState(state),
      preview: synthPreview,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "research synthesis preview", detail: `topic=${synthPreview.topic_id}`, status: synthPreview.blockers.length === 0 ? "ready" : "blocked" }].slice(-12),
  }
}

function applyCommanderCyclePreview(state: UiState, value: unknown): UiState {
  const cyclePreview = readCommanderCyclePreview(value)
  return {
    ...state,
    commanderCycle: {
      ...commanderCycleState(state),
      preview: cyclePreview,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "commander cycle preview", detail: cyclePreview.topic_id ? `topic=${cyclePreview.topic_id}` : `mission=${cyclePreview.mission_id ?? "none"}`, status: cyclePreview.blockers.length === 0 ? "ready" : "blocked" }].slice(-12),
  }
}

function applyCommanderCycleResult(state: UiState, value: unknown, cycleId?: string): UiState {
  const result = readCommanderCycleResult(value)
  if (!result && value !== null) throw new Error("runtime.get_commander_cycle returned invalid result")
  const selectedId = result?.cycle_id ?? (cycleId ? redactText(cycleId) : undefined)
  return {
    ...state,
    commanderCycle: {
      ...commanderCycleState(state),
      selected: result,
      recent: result ? [recordFromCommanderCycleResult(result), ...commanderCycleState(state).recent.filter((item) => item.cycle_id !== result.cycle_id)].slice(0, CYCLE_LIMIT) : commanderCycleState(state).recent,
      commandError: undefined,
    },
    systemActions: selectedId
      ? [...state.systemActions, { title: "commander cycle selected", detail: `cycle_id=${selectedId}`, status: result ? "loaded" : "missing" }].slice(-12)
      : state.systemActions,
  }
}

function applyOpenCodeHandoffPreview(state: UiState, value: unknown): UiState {
  const handoffPreview = readOpenCodeHandoffPreview(value)
  return {
    ...state,
    opencodeHandoff: {
      ...opencodeHandoffState(state),
      preview: handoffPreview,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode handoff preview", detail: `proposal=${handoffPreview.proposal_id}`, status: handoffPreview.eligible ? "eligible" : "blocked" }].slice(-12),
  }
}

function applyOpenCodeHandoffResult(state: UiState, value: unknown, handoffId?: string): UiState {
  const result = readOpenCodeHandoffResult(value)
  if (!result && value !== null) throw new Error("runtime.get_opencode_handoff returned invalid result")
  const selectedId = result?.handoff_id ?? (handoffId ? redactText(handoffId) : undefined)
  return {
    ...state,
    opencodeHandoff: {
      ...opencodeHandoffState(state),
      lastResult: result,
      recent: result && !result.dry_run ? [recordFromOpenCodeHandoffResult(result), ...opencodeHandoffState(state).recent.filter((item) => item.handoff_id !== result.handoff_id)].slice(0, HANDOFF_LIMIT) : opencodeHandoffState(state).recent,
      commandError: undefined,
    },
    systemActions: selectedId
      ? [...state.systemActions, { title: "opencode handoff result", detail: `handoff_id=${selectedId}`, status: result?.sent ? "sent" : "dry-run" }].slice(-12)
      : state.systemActions,
  }
}

function applyOpenCodeProcessSmokePreview(state: UiState, value: unknown): UiState {
  const smokePreview = readOpenCodeProcessSmokePreview(value)
  return {
    ...state,
    opencodeProcessSmoke: {
      ...opencodeProcessSmokeState(state),
      preview: smokePreview,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode process smoke preview", detail: `status=${smokePreview.status}`, status: smokePreview.can_execute ? "ready" : "blocked" }].slice(-12),
  }
}

function applyOpenCodeProcessSmokeResult(state: UiState, value: unknown, smokeId?: string): UiState {
  const result = readOpenCodeProcessSmokeResult(value)
  if (!result && value !== null) throw new Error("runtime.get_opencode_process_smoke returned invalid result")
  const current = opencodeProcessSmokeState(state)
  const selectedId = result?.smoke_id ?? (smokeId ? redactText(smokeId) : undefined)
  const resultError = result && (result.status === "blocked" || result.status === "failed")
    ? (result.error ?? `OpenCode process smoke ${result.status}`)
    : undefined
  return {
    ...state,
    opencodeProcessSmoke: {
      ...current,
      latestResult: result ?? current.latestResult ?? null,
      selected: result ?? (smokeId ? null : current.selected ?? null),
      records: result && result.status !== "skipped" ? [recordFromOpenCodeProcessSmokeResult(result), ...current.records.filter((item) => item.smoke_id !== result.smoke_id)].slice(0, HANDOFF_LIMIT) : current.records,
      commandError: resultError ? redactText(resultError) : undefined,
    },
    systemActions: selectedId
      ? [...state.systemActions, { title: "opencode process smoke result", detail: `smoke_id=${selectedId}`, status: result?.status ?? "missing" }].slice(-12)
      : state.systemActions,
  }
}

function applyOpenCodeProcessSmokeRecords(state: UiState, value: unknown, limit: number, options: { preserveCommandError?: boolean } = {}): UiState {
  const records = readOpenCodeProcessSmokeRecordList(value, "runtime.list_opencode_process_smokes", limit)
  const current = opencodeProcessSmokeState(state)
  return {
    ...state,
    opencodeProcessSmoke: {
      ...current,
      records,
      commandError: options.preserveCommandError ? current.commandError : undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode process smoke records", detail: `records=${records.length}`, status: "loaded" }].slice(-12),
  }
}

function applyOpenCodeHandoffReadinessPreview(state: UiState, value: unknown): UiState {
  const readiness = readOpenCodeHandoffReadinessPreview(value)
  return {
    ...state,
    opencodeHandoffReadiness: {
      ...opencodeHandoffReadinessState(state),
      preview: readiness,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode handoff readiness", detail: `status=${readiness.status}`, status: readiness.status === "ready" ? "ready" : "blocked" }].slice(-12),
  }
}

function applyOpenCodeHandoffReadinessSummary(state: UiState, value: unknown): UiState {
  const summary = readOpenCodeHandoffReadinessSummary(value)
  return {
    ...state,
    opencodeHandoffReadiness: {
      ...opencodeHandoffReadinessState(state),
      summary,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode handoff readiness summary", detail: `ready=${summary.ready_count} blocked=${summary.blocked_count} smoke=${summary.needs_smoke_count}`, status: "loaded" }].slice(-12),
  }
}

function applyOpenCodeResultReviewPacket(state: UiState, value: unknown): UiState {
  const packet = readOpenCodeResultReviewPacket(value)
  const current = opencodeResultReviewState(state)
  return {
    ...state,
    opencodeResultReview: {
      ...current,
      packet,
      records: [recordFromOpenCodeResultReviewPacket(packet), ...current.records.filter((item) => item.packet_id !== packet.packet_id)].slice(0, HANDOFF_LIMIT),
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode result review packet", detail: `status=${packet.status}`, status: packet.status === "ready_for_commander_review" ? "ready" : "loaded" }].slice(-12),
  }
}

function applyOpenCodeResultReviewSummary(state: UiState, value: unknown): UiState {
  const summary = readOpenCodeResultReviewSummary(value)
  return {
    ...state,
    opencodeResultReview: {
      ...opencodeResultReviewState(state),
      summary,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode result review summary", detail: `ready=${summary.ready_count} needs_result=${summary.needs_result_count} failed=${summary.failed_count}`, status: "loaded" }].slice(-12),
  }
}

function applyCommanderExecutorReviewPreview(state: UiState, value: unknown): UiState {
  const previewResult = readCommanderExecutorReviewPreview(value)
  return {
    ...state,
    commanderExecutorReview: {
      ...commanderExecutorReviewState(state),
      preview: previewResult,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "commander executor review preview", detail: `can_execute=${previewResult.can_execute}`, status: previewResult.can_execute ? "ready" : "blocked" }].slice(-12),
  }
}

function applyCommanderExecutorReviewResult(state: UiState, value: unknown): UiState {
  const result = readCommanderExecutorReviewResult(value)
  const current = commanderExecutorReviewState(state)
  return {
    ...state,
    commanderExecutorReview: {
      ...current,
      latestResult: result,
      selected: result,
      records: result.review_id === "dry-run"
        ? current.records
        : [recordFromCommanderExecutorReviewResult(result), ...current.records.filter((item) => item.review_id !== result.review_id)].slice(0, HANDOFF_LIMIT),
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "commander executor review", detail: `decision=${result.decision}`, status: result.status }].slice(-12),
  }
}

function applyCommanderExecutorReviewRecords(state: UiState, value: unknown): UiState {
  const records = readCommanderExecutorReviewRecords(value)
  return {
    ...state,
    commanderExecutorReview: {
      ...commanderExecutorReviewState(state),
      records,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "commander executor reviews", detail: `records=${records.length}`, status: "loaded" }].slice(-12),
  }
}

function applyCommanderExecutorReviewSelected(state: UiState, value: unknown, reviewId: string): UiState {
  const result = value === null ? null : readCommanderExecutorReviewResult(value)
  return {
    ...state,
    commanderExecutorReview: {
      ...commanderExecutorReviewState(state),
      selected: result,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "commander executor review selected", detail: `review_id=${redactText(reviewId)}`, status: result ? result.status : "missing" }].slice(-12),
  }
}

function applyExecutorReviewProposalDraftPreview(state: UiState, value: unknown): UiState {
  const previewResult = readExecutorReviewProposalDraftPreview(value)
  return {
    ...state,
    executorReviewProposalDrafts: {
      ...executorReviewProposalDraftState(state),
      preview: previewResult,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal draft preview", detail: `status=${previewResult.status} candidates=${previewResult.candidates.length}`, status: previewResult.status === "ready" ? "ready" : "blocked" }].slice(-12),
  }
}

function applyExecutorReviewProposalDraftSummary(state: UiState, value: unknown): UiState {
  const summary = readExecutorReviewProposalDraftSummary(value)
  return {
    ...state,
    executorReviewProposalDrafts: {
      ...executorReviewProposalDraftState(state),
      summary,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal draft summary", detail: `draftable=${summary.draftable_review_count} candidates=${summary.candidate_count}`, status: "loaded" }].slice(-12),
  }
}

function applyExecutorReviewProposalCreatePreview(state: UiState, value: unknown): UiState {
  const previewResult = readExecutorReviewProposalCreatePreview(value)
  return {
    ...state,
    executorReviewProposalCreate: {
      ...executorReviewProposalCreateState(state),
      preview: previewResult,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal create preview", detail: `status=${previewResult.status} can_create=${previewResult.can_create}`, status: previewResult.can_create ? "ready" : "blocked" }].slice(-12),
  }
}

function applyExecutorReviewProposalCreateResult(state: UiState, value: unknown): UiState {
  const result = readExecutorReviewProposalCreateResult(value)
  const current = executorReviewProposalCreateState(state)
  const commandError = result.status === "blocked" || result.status === "failed"
    ? result.error ?? `executor review proposal create ${result.status}`
    : undefined
  return {
    ...state,
    executorReviewProposalCreate: {
      ...current,
      latestResult: result,
      selected: result,
      records: result.status === "dry_run"
        ? current.records
        : [recordFromExecutorReviewProposalCreateResult(result), ...current.records.filter((item) => item.create_id !== result.create_id)].slice(0, HANDOFF_LIMIT),
      commandError,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal create", detail: `status=${result.status} proposal=${result.proposal_id ?? "none"}`, status: result.status }].slice(-12),
  }
}

function applyExecutorReviewProposalCreateRecords(state: UiState, value: unknown): UiState {
  const records = readExecutorReviewProposalCreateRecords(value)
  return {
    ...state,
    executorReviewProposalCreate: {
      ...executorReviewProposalCreateState(state),
      records,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal creates", detail: `records=${records.length}`, status: "loaded" }].slice(-12),
  }
}

function applyExecutorReviewProposalCreateSelected(state: UiState, value: unknown, createId: string): UiState {
  const result = value === null ? null : readExecutorReviewProposalCreateResult(value)
  return {
    ...state,
    executorReviewProposalCreate: {
      ...executorReviewProposalCreateState(state),
      selected: result,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal create selected", detail: `create_id=${redactText(createId)}`, status: result ? result.status : "missing" }].slice(-12),
  }
}

function applyExecutorReviewProposalReviewRequestPreview(state: UiState, value: unknown): UiState {
  const previewResult = readExecutorReviewProposalReviewRequestPreview(value)
  return {
    ...state,
    executorReviewProposalReviewRequest: {
      ...executorReviewProposalReviewRequestState(state),
      preview: previewResult,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal review request preview", detail: `status=${previewResult.status} can_request=${previewResult.can_request}`, status: previewResult.can_request ? "ready" : "blocked" }].slice(-12),
  }
}

function applyExecutorReviewProposalReviewRequestResult(state: UiState, value: unknown): UiState {
  const result = readExecutorReviewProposalReviewRequestResult(value)
  const current = executorReviewProposalReviewRequestState(state)
  const commandError = result.status === "blocked" || result.status === "failed"
    ? result.error ?? `executor review proposal review request ${result.status}`
    : undefined
  return {
    ...state,
    executorReviewProposalReviewRequest: {
      ...current,
      latestResult: result,
      selected: result,
      records: result.status === "dry_run"
        ? current.records
        : [recordFromExecutorReviewProposalReviewRequestResult(result), ...current.records.filter((item) => item.request_gate_id !== result.request_gate_id)].slice(0, HANDOFF_LIMIT),
      commandError,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal review request", detail: `status=${result.status} review_request=${result.review_request_id ?? "none"}`, status: result.status }].slice(-12),
  }
}

function applyExecutorReviewProposalReviewRequestRecords(state: UiState, value: unknown): UiState {
  const records = readExecutorReviewProposalReviewRequestRecords(value)
  return {
    ...state,
    executorReviewProposalReviewRequest: {
      ...executorReviewProposalReviewRequestState(state),
      records,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal review requests", detail: `records=${records.length}`, status: "loaded" }].slice(-12),
  }
}

function applyExecutorReviewProposalReviewRequestSelected(state: UiState, value: unknown, requestGateId: string): UiState {
  const result = value === null ? null : readExecutorReviewProposalReviewRequestResult(value)
  return {
    ...state,
    executorReviewProposalReviewRequest: {
      ...executorReviewProposalReviewRequestState(state),
      selected: result,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal review request selected", detail: `request_gate_id=${redactText(requestGateId)}`, status: result ? result.status : "missing" }].slice(-12),
  }
}

function applyExecutorReviewProposalReviewDecisionPreview(state: UiState, value: unknown): UiState {
  const previewResult = readExecutorReviewProposalReviewDecisionPreview(value)
  return {
    ...state,
    executorReviewProposalReviewDecision: {
      ...executorReviewProposalReviewDecisionState(state),
      preview: previewResult,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal review decision preview", detail: `status=${previewResult.status} can_decide=${previewResult.can_decide} decision=${previewResult.decision}`, status: previewResult.can_decide ? "ready" : "blocked" }].slice(-12),
  }
}

function applyExecutorReviewProposalReviewDecisionResult(state: UiState, value: unknown): UiState {
  const result = readExecutorReviewProposalReviewDecisionResult(value)
  const current = executorReviewProposalReviewDecisionState(state)
  const commandError = result.status === "blocked" || result.status === "failed"
    ? result.error ?? `executor review proposal review decision ${result.status}`
    : undefined
  return {
    ...state,
    executorReviewProposalReviewDecision: {
      ...current,
      latestResult: result,
      selected: result,
      records: result.status === "dry_run"
        ? current.records
        : [recordFromExecutorReviewProposalReviewDecisionResult(result), ...current.records.filter((item) => item.decision_gate_id !== result.decision_gate_id)].slice(0, HANDOFF_LIMIT),
      commandError,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal review decision", detail: `status=${result.status} review_request=${result.review_request_id}`, status: result.status }].slice(-12),
  }
}

function applyExecutorReviewProposalReviewDecisionRecords(state: UiState, value: unknown): UiState {
  const records = readExecutorReviewProposalReviewDecisionRecords(value)
  return {
    ...state,
    executorReviewProposalReviewDecision: {
      ...executorReviewProposalReviewDecisionState(state),
      records,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal review decisions", detail: `records=${records.length}`, status: "loaded" }].slice(-12),
  }
}

function applyExecutorReviewProposalReviewDecisionSelected(state: UiState, value: unknown, decisionGateId: string): UiState {
  const result = value === null ? null : readExecutorReviewProposalReviewDecisionResult(value)
  return {
    ...state,
    executorReviewProposalReviewDecision: {
      ...executorReviewProposalReviewDecisionState(state),
      selected: result,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal review decision selected", detail: `decision_gate_id=${redactText(decisionGateId)}`, status: result ? result.status : "missing" }].slice(-12),
  }
}

function applyExecutorReviewProposalApplyReadinessPreview(state: UiState, value: unknown): UiState {
  const previewResult = readExecutorReviewProposalApplyReadinessPreview(value)
  return {
    ...state,
    executorReviewProposalApplyReadiness: {
      ...executorReviewProposalApplyReadinessState(state),
      preview: previewResult,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal apply readiness", detail: `status=${previewResult.status} proposal=${previewResult.proposal_id}`, status: previewResult.status }].slice(-12),
  }
}

function applyExecutorReviewProposalApplyReadinessSummary(state: UiState, value: unknown): UiState {
  const summary = readExecutorReviewProposalApplyReadinessSummary(value)
  return {
    ...state,
    executorReviewProposalApplyReadiness: {
      ...executorReviewProposalApplyReadinessState(state),
      summary,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal apply readiness summary", detail: `ready=${summary.ready_count} needs_review=${summary.needs_review_count}`, status: "loaded" }].slice(-12),
  }
}

function applyExecutorReviewProposalApplyReadinessRecords(state: UiState, value: unknown): UiState {
  const records = readExecutorReviewProposalApplyReadinessRecords(value)
  return {
    ...state,
    executorReviewProposalApplyReadiness: {
      ...executorReviewProposalApplyReadinessState(state),
      records,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal apply readiness records", detail: `records=${records.length}`, status: "loaded" }].slice(-12),
  }
}

function applyExecutorReviewProposalApplyReadinessSelected(state: UiState, value: unknown, readinessId: string): UiState {
  const result = value === null ? null : readExecutorReviewProposalApplyReadinessPreview(value)
  return {
    ...state,
    executorReviewProposalApplyReadiness: {
      ...executorReviewProposalApplyReadinessState(state),
      selected: result,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal apply readiness selected", detail: `readiness_id=${redactText(readinessId)}`, status: result ? result.status : "missing" }].slice(-12),
  }
}

function applyExecutorReviewProposalNarrowApplyPreview(state: UiState, value: unknown): UiState {
  const previewResult = readExecutorReviewProposalNarrowApplyPreview(value)
  return {
    ...state,
    executorReviewProposalNarrowApply: {
      ...executorReviewProposalNarrowApplyState(state),
      preview: previewResult,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal narrow apply", detail: `status=${previewResult.status} proposal=${previewResult.proposal_id}`, status: previewResult.status }].slice(-12),
  }
}

function applyExecutorReviewProposalNarrowApplyResult(state: UiState, value: unknown): UiState {
  const result = readExecutorReviewProposalNarrowApplyResult(value)
  const commandError = result.status === "blocked" || result.status === "failed" ? result.error ?? "executor review proposal narrow apply did not complete" : undefined
  return {
    ...state,
    executorReviewProposalNarrowApply: {
      ...executorReviewProposalNarrowApplyState(state),
      latestResult: result,
      commandError,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal narrow apply result", detail: `status=${result.status} proposal=${result.proposal_id}`, status: result.status }].slice(-12),
  }
}

function applyExecutorReviewProposalNarrowApplyRecords(state: UiState, value: unknown): UiState {
  const records = readExecutorReviewProposalNarrowApplyRecords(value)
  return {
    ...state,
    executorReviewProposalNarrowApply: {
      ...executorReviewProposalNarrowApplyState(state),
      records,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal narrow apply records", detail: `records=${records.length}`, status: "loaded" }].slice(-12),
  }
}

function applyExecutorReviewProposalNarrowApplySelected(state: UiState, value: unknown, applyId: string): UiState {
  const result = value === null ? null : readExecutorReviewProposalNarrowApplyResult(value)
  return {
    ...state,
    executorReviewProposalNarrowApply: {
      ...executorReviewProposalNarrowApplyState(state),
      selected: result,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal narrow apply selected", detail: `apply_id=${redactText(applyId)}`, status: result ? result.status : "missing" }].slice(-12),
  }
}

function applyOpenCodeSessionPreview(state: UiState, value: unknown): UiState {
  const previewResult = readOpenCodeSessionPreview(value)
  return {
    ...state,
    opencodeSessions: {
      ...opencodeSessionsState(state),
      preview: previewResult,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode session preview", detail: `source=${previewResult.source_kind}`, status: previewResult.can_create ? "ready" : "blocked" }].slice(-12),
  }
}

function applyOpenCodeSessionPlan(state: UiState, value: unknown): UiState {
  const plan = readOpenCodeSessionPlan(value)
  return {
    ...state,
    opencodeSessions: {
      ...opencodeSessionsState(state),
      latestPlan: plan,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode session planned", detail: `session_id=${plan.session_id}`, status: plan.status }].slice(-12),
  }
}

function applyOpenCodeSessionRecords(state: UiState, value: unknown): UiState {
  const records = readOpenCodeSessionRecords(value)
  return {
    ...state,
    opencodeSessions: {
      ...opencodeSessionsState(state),
      records,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode session records", detail: `records=${records.length}`, status: "loaded" }].slice(-12),
  }
}

function applyOpenCodeSessionSelected(state: UiState, value: unknown, sessionId: string): UiState {
  const selected = value === null ? null : readOpenCodeSessionPlan(value)
  return {
    ...state,
    opencodeSessions: {
      ...opencodeSessionsState(state),
      selected,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode session selected", detail: `session_id=${redactText(sessionId)}`, status: selected?.status ?? "missing" }].slice(-12),
  }
}

function applyOpenCodeSessionSummary(state: UiState, value: unknown): UiState {
  const summary = readOpenCodeSessionSummary(value)
  return {
    ...state,
    opencodeSessions: {
      ...opencodeSessionsState(state),
      summary,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode session summary", detail: `planned=${summary.planned_count}`, status: "loaded" }].slice(-12),
  }
}

function applyContextBudgetCapabilities(state: UiState, value: unknown): UiState {
  const capabilities = readModelCapabilities(value)
  return {
    ...state,
    contextBudgets: {
      ...contextBudgetsState(state),
      capabilities,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "context budget capabilities", detail: `capabilities=${capabilities.length}`, status: "loaded" }].slice(-12),
  }
}

function applyContextBudgetSelectedCapability(state: UiState, value: unknown): UiState {
  const selectedCapability = readModelCapability(value)
  return {
    ...state,
    contextBudgets: {
      ...contextBudgetsState(state),
      selectedCapability,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "model capability selected", detail: `${selectedCapability.provider_kind}/${selectedCapability.model_id}`, status: "loaded" }].slice(-12),
  }
}

function applyContextBudgetSummary(state: UiState, value: unknown): UiState {
  const summary = readContextBudgetSummary(value)
  return {
    ...state,
    contextBudgets: {
      ...contextBudgetsState(state),
      summary,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "context budget summary", detail: `capabilities=${summary.total_capabilities}`, status: "loaded" }].slice(-12),
  }
}

function applyContextBudgetPreview(state: UiState, value: unknown): UiState {
  const budgetPreview = readContextBudgetPreview(value)
  return {
    ...state,
    contextBudgets: {
      ...contextBudgetsState(state),
      preview: budgetPreview,
      selectedCapability: budgetPreview.capability ?? contextBudgetsState(state).selectedCapability,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "context budget preview", detail: `purpose=${budgetPreview.purpose}`, status: budgetPreview.blockers.length ? "blocked" : "loaded" }].slice(-12),
  }
}

function applyContextPacketPreview(state: UiState, value: unknown): UiState {
  const packetPreview = readContextPacketPreview(value)
  return {
    ...state,
    contextPackets: {
      ...contextPacketsState(state),
      preview: packetPreview,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "context packet preview", detail: `purpose=${packetPreview.purpose}`, status: packetPreview.blockers.length ? "blocked" : "loaded" }].slice(-12),
  }
}

function applyContextPacketSummary(state: UiState, value: unknown): UiState {
  const summary = readContextPacketSummary(value)
  return {
    ...state,
    contextPackets: {
      ...contextPacketsState(state),
      summary,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "context packet summary", detail: `purposes=${summary.supported_purposes.length}`, status: "loaded" }].slice(-12),
  }
}

function applyOpenCodeSessionInstructionPackPreview(state: UiState, value: unknown): UiState {
  const packPreview = readOpenCodeSessionInstructionPackPreview(value)
  return {
    ...state,
    opencodeSessionInstructionPacks: {
      ...opencodeSessionInstructionPacksState(state),
      preview: packPreview,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode instruction pack preview", detail: `session=${packPreview.session_id || "missing"}`, status: packPreview.can_write ? "loaded" : "blocked" }].slice(-12),
  }
}

function applyOpenCodeSessionInstructionPackResult(state: UiState, value: unknown): UiState {
  const result = readOpenCodeSessionInstructionPackResult(value)
  const commandError = result.status === "blocked" || result.status === "failed" ? result.error ?? result.status : undefined
  return {
    ...state,
    opencodeSessionInstructionPacks: {
      ...opencodeSessionInstructionPacksState(state),
      latestResult: result,
      selected: result.status === "written" ? result : opencodeSessionInstructionPacksState(state).selected,
      commandError,
    },
    systemActions: [...state.systemActions, { title: "opencode instruction pack write", detail: `session=${result.session_id || "missing"}`, status: result.status }].slice(-12),
  }
}

function applyOpenCodeSessionInstructionPackRecords(state: UiState, value: unknown): UiState {
  const records = readOpenCodeSessionInstructionPackRecords(value)
  return {
    ...state,
    opencodeSessionInstructionPacks: {
      ...opencodeSessionInstructionPacksState(state),
      records,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode instruction packs", detail: `records=${records.length}`, status: "loaded" }].slice(-12),
  }
}

function applyOpenCodeSessionInstructionPackSelected(state: UiState, value: unknown, packId: string): UiState {
  const selected = value === null ? null : readOpenCodeSessionInstructionPackResult(value)
  return {
    ...state,
    opencodeSessionInstructionPacks: {
      ...opencodeSessionInstructionPacksState(state),
      selected,
      commandError: selected ? undefined : `instruction pack not found: ${redactText(packId)}`,
    },
    systemActions: [...state.systemActions, { title: "opencode instruction pack selected", detail: `pack=${redactText(packId)}`, status: selected ? "loaded" : "missing" }].slice(-12),
  }
}

function applyOpenCodeLaunchReadinessPreview(state: UiState, value: unknown): UiState {
  const readiness = readOpenCodeLaunchReadinessPreview(value)
  const commandError = readiness.status === "blocked" ? readiness.blockers[0] ?? "OpenCode launch readiness is blocked" : undefined
  return {
    ...state,
    opencodeLaunchReadiness: {
      ...opencodeLaunchReadinessState(state),
      preview: readiness,
      commandError,
    },
    systemActions: [...state.systemActions, { title: "opencode launch readiness", detail: `status=${readiness.status} session=${readiness.session_id || "missing"}`, status: readiness.status }].slice(-12),
  }
}

function applyOpenCodeLaunchReadinessSummary(state: UiState, value: unknown): UiState {
  const summary = readOpenCodeLaunchReadinessSummary(value)
  return {
    ...state,
    opencodeLaunchReadiness: {
      ...opencodeLaunchReadinessState(state),
      summary,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode launch readiness summary", detail: `ready=${summary.ready_count} blocked=${summary.blocked_count} partial=${summary.partial_count}`, status: "loaded" }].slice(-12),
  }
}

function applyOpenCodeLaunchPreview(state: UiState, value: unknown): UiState {
  const previewValue = readOpenCodeLaunchPreview(value)
  const commandError = previewValue.status === "blocked" ? previewValue.blockers[0] ?? "OpenCode launch preview is blocked" : undefined
  return {
    ...state,
    opencodeLaunches: {
      ...opencodeLaunchesState(state),
      preview: previewValue,
      commandError,
    },
    systemActions: [...state.systemActions, { title: "opencode launch preview", detail: `status=${previewValue.status} session=${previewValue.session_id || "missing"}`, status: previewValue.status }].slice(-12),
  }
}

function applyOpenCodeLaunchResult(state: UiState, value: unknown): UiState {
  const result = readOpenCodeLaunchResult(value)
  const commandError = result.status === "blocked" || result.status === "launch_failed"
    ? result.error ?? "OpenCode launch is blocked or failed"
    : undefined
  return {
    ...state,
    opencodeLaunches: {
      ...opencodeLaunchesState(state),
      latestResult: result,
      commandError,
    },
    systemActions: [...state.systemActions, { title: "opencode launch", detail: `status=${result.status} session=${result.session_id || "missing"}`, status: result.status }].slice(-12),
  }
}

function applyOpenCodeLaunchRecords(state: UiState, value: unknown): UiState {
  const records = readOpenCodeLaunchRecords(value)
  return {
    ...state,
    opencodeLaunches: {
      ...opencodeLaunchesState(state),
      records,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode launches", detail: `records=${records.length}`, status: "loaded" }].slice(-12),
  }
}

function applyOpenCodeLaunchSelected(state: UiState, value: unknown, launchId: string): UiState {
  const selected = value === null ? null : readOpenCodeLaunchResult(value)
  return {
    ...state,
    opencodeLaunches: {
      ...opencodeLaunchesState(state),
      selected,
      commandError: selected ? undefined : `OpenCode launch not found: ${redactText(launchId)}`,
    },
    systemActions: [...state.systemActions, { title: "opencode launch selected", detail: `launch=${redactText(launchId)}`, status: selected ? "loaded" : "missing" }].slice(-12),
  }
}

function applyOpenCodeProgressPreview(state: UiState, value: unknown): UiState {
  const progress = readOpenCodeProgressPreview(value)
  const commandError = progress.status === "blocked" ? progress.blockers[0] ?? "OpenCode progress preview is blocked" : undefined
  return {
    ...state,
    opencodeProgress: {
      ...opencodeProgressState(state),
      preview: progress,
      commandError,
    },
    systemActions: [...state.systemActions, { title: "opencode progress preview", detail: `status=${progress.status} kind=${progress.kind} session=${progress.session_id || "missing"}`, status: progress.status }].slice(-12),
  }
}

function applyOpenCodeProgressResult(state: UiState, value: unknown): UiState {
  const result = readOpenCodeProgressResult(value)
  const commandError = result.status === "blocked" || result.status === "failed" ? result.error ?? "OpenCode progress record is blocked or failed" : undefined
  return {
    ...state,
    opencodeProgress: {
      ...opencodeProgressState(state),
      latestResult: result,
      latest: result.status === "recorded" ? result : opencodeProgressState(state).latest ?? null,
      commandError,
    },
    systemActions: [...state.systemActions, { title: "opencode progress", detail: `status=${result.status} kind=${result.kind} session=${result.session_id || "missing"}`, status: result.status }].slice(-12),
  }
}

function applyOpenCodeProgressRecords(state: UiState, value: unknown): UiState {
  const records = readOpenCodeProgressRecords(value)
  return {
    ...state,
    opencodeProgress: {
      ...opencodeProgressState(state),
      records,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode progress records", detail: `records=${records.length}`, status: "loaded" }].slice(-12),
  }
}

function applyOpenCodeProgressSelected(state: UiState, value: unknown, progressId: string): UiState {
  const selected = value === null ? null : readOpenCodeProgressResult(value)
  return {
    ...state,
    opencodeProgress: {
      ...opencodeProgressState(state),
      selected,
      commandError: selected ? undefined : `OpenCode progress record not found: ${redactText(progressId)}`,
    },
    systemActions: [...state.systemActions, { title: "opencode progress selected", detail: `progress=${redactText(progressId)}`, status: selected ? "loaded" : "missing" }].slice(-12),
  }
}

function applyOpenCodeProgressLatest(state: UiState, value: unknown, label: string): UiState {
  const latest = value === null ? null : readOpenCodeProgressResult(value)
  return {
    ...state,
    opencodeProgress: {
      ...opencodeProgressState(state),
      latest,
      commandError: latest ? undefined : `OpenCode progress latest not found: ${redactText(label)}`,
    },
    systemActions: [...state.systemActions, { title: "opencode progress latest", detail: `target=${redactText(label)}`, status: latest ? "loaded" : "missing" }].slice(-12),
  }
}

function applyOpenCodeProgressSummary(state: UiState, value: unknown): UiState {
  const summary = readOpenCodeProgressSummary(value)
  return {
    ...state,
    opencodeProgress: {
      ...opencodeProgressState(state),
      summary,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode progress summary", detail: `records=${summary.total_records} heartbeat=${summary.heartbeat_count}`, status: "loaded" }].slice(-12),
  }
}

function applyOpenCodeWatchdogPreview(state: UiState, value: unknown): UiState {
  const watchdog = readOpenCodeWatchdogPreview(value)
  const commandError = watchdog.status === "blocked" ? watchdog.blockers[0] ?? "OpenCode watchdog preview is blocked" : undefined
  return {
    ...state,
    opencodeWatchdog: {
      ...opencodeWatchdogState(state),
      preview: watchdog,
      commandError,
    },
    systemActions: [...state.systemActions, { title: "opencode watchdog preview", detail: `status=${watchdog.watchdog_status} session=${watchdog.session_id || "missing"}`, status: watchdog.status }].slice(-12),
  }
}

function applyOpenCodeWatchdogResult(state: UiState, value: unknown): UiState {
  const result = readOpenCodeWatchdogResult(value)
  const commandError = result.status === "blocked" || result.status === "failed" ? result.error ?? "OpenCode watchdog record is blocked or failed" : undefined
  return {
    ...state,
    opencodeWatchdog: {
      ...opencodeWatchdogState(state),
      latestResult: result,
      commandError,
    },
    systemActions: [...state.systemActions, { title: "opencode watchdog", detail: `status=${result.status} watchdog=${result.watchdog_status} session=${result.session_id || "missing"}`, status: result.status }].slice(-12),
  }
}

function applyOpenCodeForcedReportResult(state: UiState, value: unknown): UiState {
  if (isRecord(value) && typeof value.request_id === "string") {
    const request = readOpenCodeForcedReportRequest(value)
    return {
      ...state,
      opencodeWatchdog: {
        ...opencodeWatchdogState(state),
        forcedReportResult: request,
        commandError: undefined,
      },
      systemActions: [...state.systemActions, { title: "opencode forced report", detail: `request=${request.request_id} session=${request.session_id || "missing"}`, status: "recorded" }].slice(-12),
    }
  }
  return applyOpenCodeWatchdogResult(state, value)
}

function applyOpenCodeWatchdogRecords(state: UiState, value: unknown): UiState {
  const records = readOpenCodeWatchdogRecords(value)
  return {
    ...state,
    opencodeWatchdog: {
      ...opencodeWatchdogState(state),
      records,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode watchdog records", detail: `records=${records.length}`, status: "loaded" }].slice(-12),
  }
}

function applyOpenCodeWatchdogSelected(state: UiState, value: unknown, watchdogId: string): UiState {
  const selected = value === null ? null : readOpenCodeWatchdogResult(value)
  return {
    ...state,
    opencodeWatchdog: {
      ...opencodeWatchdogState(state),
      selected,
      commandError: selected ? undefined : `OpenCode watchdog record not found: ${redactText(watchdogId)}`,
    },
    systemActions: [...state.systemActions, { title: "opencode watchdog selected", detail: `watchdog=${redactText(watchdogId)}`, status: selected ? "loaded" : "missing" }].slice(-12),
  }
}

function applyOpenCodeForcedReportRecords(state: UiState, value: unknown): UiState {
  const records = readOpenCodeForcedReportRequests(value)
  return {
    ...state,
    opencodeWatchdog: {
      ...opencodeWatchdogState(state),
      forcedReportRequests: records,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode forced reports", detail: `records=${records.length}`, status: "loaded" }].slice(-12),
  }
}

function applyOpenCodeForcedReportSelected(state: UiState, value: unknown, requestId: string): UiState {
  const selectedRequest = value === null ? null : readOpenCodeForcedReportRequest(value)
  return {
    ...state,
    opencodeWatchdog: {
      ...opencodeWatchdogState(state),
      selectedRequest,
      commandError: selectedRequest ? undefined : `OpenCode forced report request not found: ${redactText(requestId)}`,
    },
    systemActions: [...state.systemActions, { title: "opencode forced report selected", detail: `request=${redactText(requestId)}`, status: selectedRequest ? "loaded" : "missing" }].slice(-12),
  }
}

function applyOpenCodeWatchdogSummary(state: UiState, value: unknown): UiState {
  const summary = readOpenCodeWatchdogSummary(value)
  return {
    ...state,
    opencodeWatchdog: {
      ...opencodeWatchdogState(state),
      summary,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode watchdog summary", detail: `healthy=${summary.healthy_count} timed_out=${summary.timed_out_count} needs_report=${summary.needs_report_count}`, status: "loaded" }].slice(-12),
  }
}

function applyOpenCodeCommanderQuestionPreview(state: UiState, value: unknown): UiState {
  const question = readOpenCodeCommanderQuestionPreview(value)
  const commandError = question.status === "blocked" ? question.blockers[0] ?? "OpenCode Commander question preview is blocked" : undefined
  return {
    ...state,
    opencodeCommanderQuestions: {
      ...opencodeCommanderQuestionState(state),
      preview: question,
      commandError,
    },
    systemActions: [...state.systemActions, { title: "opencode asks commander preview", detail: `type=${question.question_type} session=${question.session_id || "missing"}`, status: question.status }].slice(-12),
  }
}

function applyOpenCodeCommanderQuestionResult(state: UiState, value: unknown): UiState {
  const result = readOpenCodeCommanderQuestionResult(value)
  const commandError = result.status === "blocked" || result.status === "failed" ? result.error ?? "OpenCode Commander question is blocked or failed" : undefined
  return {
    ...state,
    opencodeCommanderQuestions: {
      ...opencodeCommanderQuestionState(state),
      latestResult: result,
      latest: result.status === "created" ? result : opencodeCommanderQuestionState(state).latest ?? null,
      commandError,
    },
    systemActions: [...state.systemActions, { title: "opencode asks commander", detail: `status=${result.status} question=${result.question_id} session=${result.session_id || "missing"}`, status: result.status }].slice(-12),
  }
}

function applyOpenCodeCommanderQuestionRecords(state: UiState, value: unknown): UiState {
  const records = readOpenCodeCommanderQuestionRecords(value)
  return {
    ...state,
    opencodeCommanderQuestions: {
      ...opencodeCommanderQuestionState(state),
      records,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode commander questions", detail: `records=${records.length}`, status: "loaded" }].slice(-12),
  }
}

function applyOpenCodeCommanderQuestionSelected(state: UiState, value: unknown, questionId: string): UiState {
  const selected = value === null ? null : readOpenCodeCommanderQuestionResult(value)
  return {
    ...state,
    opencodeCommanderQuestions: {
      ...opencodeCommanderQuestionState(state),
      selected,
      commandError: selected ? undefined : `OpenCode Commander question not found: ${redactText(questionId)}`,
    },
    systemActions: [...state.systemActions, { title: "opencode commander question selected", detail: `question=${redactText(questionId)}`, status: selected ? "loaded" : "missing" }].slice(-12),
  }
}

function applyOpenCodeCommanderQuestionLatest(state: UiState, value: unknown, label: string): UiState {
  const latest = value === null ? null : readOpenCodeCommanderQuestionResult(value)
  return {
    ...state,
    opencodeCommanderQuestions: {
      ...opencodeCommanderQuestionState(state),
      latest,
      commandError: latest ? undefined : `OpenCode Commander question latest not found: ${redactText(label)}`,
    },
    systemActions: [...state.systemActions, { title: "opencode commander question latest", detail: `target=${redactText(label)}`, status: latest ? "loaded" : "missing" }].slice(-12),
  }
}

function applyOpenCodeCommanderQuestionSummary(state: UiState, value: unknown): UiState {
  const summary = readOpenCodeCommanderQuestionSummary(value)
  return {
    ...state,
    opencodeCommanderQuestions: {
      ...opencodeCommanderQuestionState(state),
      summary,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode commander question summary", detail: `pending=${summary.pending_commander_count} urgent=${summary.urgent_count}`, status: "loaded" }].slice(-12),
  }
}

function applyResearchMemorySummary(state: UiState, value: unknown): UiState {
  const summary = readResearchMemorySummary(value)
  return {
    ...state,
    researchMemory: {
      ...researchMemoryState(state),
      summary,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "research memory summary", detail: `candidates=${summary.total_candidates_available}`, status: "loaded" }].slice(-12),
  }
}

function applyResearchMemoryRetrievalPreview(state: UiState, value: unknown): UiState {
  const retrievalPreview = readResearchMemoryRetrievalPreview(value)
  return {
    ...state,
    researchMemory: {
      ...researchMemoryState(state),
      retrievalPreview,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "research memory retrieval", detail: `status=${retrievalPreview.status} candidates=${retrievalPreview.candidates.length}`, status: retrievalPreview.status }].slice(-12),
  }
}

function applyResearchNoveltyPreview(state: UiState, value: unknown): UiState {
  const noveltyPreview = readResearchNoveltyPreview(value)
  return {
    ...state,
    researchMemory: {
      ...researchMemoryState(state),
      noveltyPreview,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "research novelty preview", detail: `risk=${noveltyPreview.duplicate_risk} score=${noveltyPreview.novelty_score}`, status: noveltyPreview.status }].slice(-12),
  }
}

function applyOpenCodeHandoffFollowup(state: UiState, value: unknown, handoffId?: string): UiState {
  const result = readOpenCodeHandoffFollowup(value)
  if (!result && value !== null) throw new Error("runtime.get_opencode_handoff_followup returned invalid follow-up")
  const selectedId = result?.handoff_id ?? (handoffId ? redactText(handoffId) : undefined)
  return {
    ...state,
    opencodeFollowup: {
      ...opencodeFollowupState(state),
      selected: result,
      queueItems: result ? [result, ...opencodeFollowupState(state).queueItems.filter((item) => item.handoff_id !== result.handoff_id)].slice(0, HANDOFF_LIMIT) : opencodeFollowupState(state).queueItems,
      commandError: undefined,
    },
    systemActions: selectedId
      ? [...state.systemActions, { title: "opencode follow-up selected", detail: `handoff_id=${selectedId}`, status: result ? result.followup_status : "missing" }].slice(-12)
      : state.systemActions,
  }
}

function applyOpenCodeHandoffFollowupSummary(state: UiState, value: unknown): UiState {
  const summary = readOpenCodeHandoffFollowupCounts(value)
  return {
    ...state,
    opencodeFollowup: {
      ...opencodeFollowupState(state),
      summary,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode follow-up summary", detail: `active=${summary.sent_count + summary.running_count} results=${summary.result_submitted_count}`, status: "loaded" }].slice(-12),
  }
}

function applyOpenCodeHandoffFollowupQueue(state: UiState, value: unknown): UiState {
  const queue = readOpenCodeHandoffFollowupQueue(value)
  return {
    ...state,
    opencodeFollowup: {
      ...opencodeFollowupState(state),
      selectedQueue: queue.queue,
      queueItems: queue.items,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "opencode follow-up queue", detail: `${queue.queue}=${queue.items.length}`, status: "loaded" }].slice(-12),
  }
}

function applyRuntimeCheckpointPreview(state: UiState, value: unknown): UiState {
  const checkpointPreview = readRuntimeCheckpointPreview(value)
  return {
    ...state,
    runtimeCheckpoints: {
      ...runtimeCheckpointsState(state),
      preview: checkpointPreview,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "runtime checkpoint preview", detail: `scope=${checkpointPreview.scope}`, status: checkpointPreview.blockers.length === 0 ? "ready" : "blocked" }].slice(-12),
  }
}

function applyRuntimeCheckpoint(state: UiState, value: unknown, checkpointId?: string): UiState {
  const checkpoint = readRuntimeCheckpoint(value)
  if (!checkpoint && value !== null) throw new Error("runtime.get_runtime_checkpoint returned invalid checkpoint")
  const selectedId = checkpoint?.checkpoint_id ?? (checkpointId ? redactText(checkpointId) : undefined)
  return {
    ...state,
    runtimeCheckpoints: {
      ...runtimeCheckpointsState(state),
      selected: checkpoint,
      recent: checkpoint ? [recordFromRuntimeCheckpoint(checkpoint), ...runtimeCheckpointsState(state).recent.filter((item) => item.checkpoint_id !== checkpoint.checkpoint_id)].slice(0, CHECKPOINT_LIMIT) : runtimeCheckpointsState(state).recent,
      commandError: undefined,
    },
    systemActions: selectedId
      ? [...state.systemActions, { title: "runtime checkpoint selected", detail: `checkpoint_id=${selectedId}`, status: checkpoint ? checkpoint.scope : "missing" }].slice(-12)
      : state.systemActions,
  }
}

function applyRuntimeRestorePreview(state: UiState, value: unknown): UiState {
  const preview = readRuntimeRestorePreview(value)
  return {
    ...state,
    runtimeRestore: {
      ...runtimeRestoreState(state),
      preview,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "checkpoint resume preview", detail: `checkpoint_id=${preview.checkpoint_id}`, status: preview.can_mark_resume ? "ready" : "blocked" }].slice(-12),
  }
}

function applyRuntimeResumeAnchor(state: UiState, value: unknown, resumeId?: string): UiState {
  const anchor = readRuntimeResumeAnchor(value)
  if (!anchor && value !== null) throw new Error("runtime.get_checkpoint_resume_anchor returned invalid anchor")
  const selectedId = anchor?.resume_id ?? (resumeId ? redactText(resumeId) : undefined)
  return {
    ...state,
    runtimeRestore: {
      ...runtimeRestoreState(state),
      selectedAnchor: anchor,
      recentAnchors: anchor ? [anchor, ...runtimeRestoreState(state).recentAnchors.filter((item) => item.resume_id !== anchor.resume_id)].slice(0, CHECKPOINT_LIMIT) : runtimeRestoreState(state).recentAnchors,
      commandError: undefined,
    },
    systemActions: selectedId
      ? [...state.systemActions, { title: "checkpoint resume anchor selected", detail: `resume_id=${selectedId}`, status: anchor ? anchor.drift_status : "missing" }].slice(-12)
      : state.systemActions,
  }
}

async function loadWakeAssessments(state: UiState, runtime: RuntimeClient, limit: number): Promise<UiState> {
  const recent = readWakeAssessmentRecordList(await runtime.command("runtime.list_wake_assessments", { limit }), "runtime.list_wake_assessments", limit)
  return {
    ...state,
    wakeAssessment: {
      ...wakeAssessmentState(state),
      recent,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "wake assessments loaded", detail: `records=${recent.length}`, status: "loaded" }].slice(-12),
  }
}

function applyWakeAssessmentPreview(state: UiState, value: unknown): UiState {
  const preview = readWakeAssessmentPreview(value)
  return {
    ...state,
    wakeAssessment: {
      ...wakeAssessmentState(state),
      preview,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "wake assessment preview", detail: `checkpoint_id=${preview.checkpoint_id ?? "none"}`, status: preview.allowed ? "ready" : "blocked" }].slice(-12),
  }
}

function applyWakeAssessment(state: UiState, value: unknown, wakeId?: string): UiState {
  const assessment = readWakeAssessment(value)
  if (!assessment && value !== null) throw new Error("runtime.get_wake_assessment returned invalid assessment")
  const selectedId = assessment?.wake_id ?? (wakeId ? redactText(wakeId) : undefined)
  return {
    ...state,
    wakeAssessment: {
      ...wakeAssessmentState(state),
      selected: assessment,
      recent: assessment ? [recordFromWakeAssessment(assessment), ...wakeAssessmentState(state).recent.filter((item) => item.wake_id !== assessment.wake_id)].slice(0, CHECKPOINT_LIMIT) : wakeAssessmentState(state).recent,
      commandError: undefined,
    },
    systemActions: selectedId
      ? [...state.systemActions, { title: "wake assessment selected", detail: `wake_id=${selectedId}`, status: assessment ? (assessment.allowed ? "ready" : "blocked") : "missing" }].slice(-12)
      : state.systemActions,
  }
}

async function loadContinuationPlans(state: UiState, runtime: RuntimeClient, limit: number): Promise<UiState> {
  const recent = readContinuationPlanRecordList(await runtime.command("runtime.list_continuation_plans", { limit }), "runtime.list_continuation_plans", limit)
  return {
    ...state,
    continuation: {
      ...continuationState(state),
      recent,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "continuation plans loaded", detail: `records=${recent.length}`, status: "loaded" }].slice(-12),
  }
}

function applyContinuationPlanPreview(state: UiState, value: unknown): UiState {
  const preview = readContinuationPlanPreview(value)
  return {
    ...state,
    continuation: {
      ...continuationState(state),
      preview,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "continuation preview", detail: `wake_id=${preview.wake_id} steps=${preview.step_count}`, status: preview.can_create ? "ready" : "blocked" }].slice(-12),
  }
}

function applyContinuationPlan(state: UiState, value: unknown, planId?: string): UiState {
  const plan = readContinuationPlan(value)
  if (!plan && value !== null) throw new Error("runtime.get_continuation_plan returned invalid plan")
  const selectedId = plan?.plan_id ?? (planId ? redactText(planId) : undefined)
  return {
    ...state,
    continuation: {
      ...continuationState(state),
      selected: plan,
      recent: plan ? [recordFromContinuationPlan(plan), ...continuationState(state).recent.filter((item) => item.plan_id !== plan.plan_id)].slice(0, CHECKPOINT_LIMIT) : continuationState(state).recent,
      commandError: undefined,
    },
    systemActions: selectedId
      ? [...state.systemActions, { title: "continuation plan selected", detail: `plan_id=${selectedId}`, status: plan ? plan.status : "missing" }].slice(-12)
      : state.systemActions,
  }
}

function applyContinuationStepResult(state: UiState, value: unknown): UiState {
  const result = readContinuationStepResult(value)
  return {
    ...state,
    continuation: {
      ...continuationState(state),
      lastStepResult: result,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "continuation step result", detail: `plan_id=${result.plan_id} index=${result.index}`, status: result.status }].slice(-12),
  }
}

async function loadWakeSchedules(state: UiState, runtime: RuntimeClient, limit: number): Promise<UiState> {
  const recent = readWakeScheduleRecordList(await runtime.command("runtime.list_wake_schedules", { limit }), "runtime.list_wake_schedules", limit)
  return {
    ...state,
    wakeSchedules: {
      ...wakeSchedulesState(state),
      recent,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "wake schedules loaded", detail: `records=${recent.length}`, status: "loaded" }].slice(-12),
  }
}

async function loadWakeScheduleTicks(state: UiState, runtime: RuntimeClient, limit: number): Promise<UiState> {
  const recentTicks = readWakeScheduleTickResultList(await runtime.command("runtime.list_wake_schedule_ticks", { limit }), "runtime.list_wake_schedule_ticks", limit)
  return {
    ...state,
    wakeSchedules: {
      ...wakeSchedulesState(state),
      recentTicks,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "wake schedule ticks loaded", detail: `records=${recentTicks.length}`, status: "loaded" }].slice(-12),
  }
}

function applyWakeSchedulePreview(state: UiState, value: unknown): UiState {
  const preview = readWakeSchedulePreview(value)
  return {
    ...state,
    wakeSchedules: {
      ...wakeSchedulesState(state),
      preview,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "wake schedule preview", detail: `resume_id=${preview.resume_id} every=${preview.interval_ms}ms`, status: preview.can_create ? "ready" : "blocked" }].slice(-12),
  }
}

function applyWakeSchedule(state: UiState, value: unknown, scheduleId?: string): UiState {
  const schedule = readWakeSchedule(value)
  if (!schedule && value !== null) throw new Error("runtime.get_wake_schedule returned invalid schedule")
  const selectedId = schedule?.schedule_id ?? (scheduleId ? redactText(scheduleId) : undefined)
  return {
    ...state,
    wakeSchedules: {
      ...wakeSchedulesState(state),
      selected: schedule,
      recent: schedule ? [recordFromWakeSchedule(schedule), ...wakeSchedulesState(state).recent.filter((item) => item.schedule_id !== schedule.schedule_id)].slice(0, CHECKPOINT_LIMIT) : wakeSchedulesState(state).recent,
      commandError: undefined,
    },
    systemActions: selectedId
      ? [...state.systemActions, { title: "wake schedule selected", detail: `schedule_id=${selectedId}`, status: schedule ? schedule.status : "missing" }].slice(-12)
      : state.systemActions,
  }
}

function applyWakeScheduleTickPreview(state: UiState, value: unknown): UiState {
  const tickPreview = readWakeScheduleTickPreview(value)
  return {
    ...state,
    wakeSchedules: {
      ...wakeSchedulesState(state),
      tickPreview,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "wake tick preview", detail: `due=${tickPreview.due_count} eligible=${tickPreview.eligible_count}`, status: tickPreview.blocked_count > 0 ? "blocked" : "ready" }].slice(-12),
  }
}

function applyWakeScheduleTickResult(state: UiState, value: unknown, tickId?: string): UiState {
  const tick = readWakeScheduleTickResult(value)
  if (!tick && value !== null) throw new Error("runtime.get_wake_schedule_tick returned invalid tick")
  const selectedId = tick?.tick_id ?? (tickId ? redactText(tickId) : undefined)
  return {
    ...state,
    wakeSchedules: {
      ...wakeSchedulesState(state),
      lastTick: tick ?? wakeSchedulesState(state).lastTick,
      recentTicks: tick ? [tick, ...wakeSchedulesState(state).recentTicks.filter((item) => item.tick_id !== tick.tick_id)].slice(0, CHECKPOINT_LIMIT) : wakeSchedulesState(state).recentTicks,
      commandError: undefined,
    },
    systemActions: selectedId
      ? [...state.systemActions, { title: "wake tick result", detail: `tick_id=${selectedId}`, status: tick ? (tick.dry_run ? "dry-run" : "completed") : "missing" }].slice(-12)
      : state.systemActions,
  }
}

async function loadWakeSchedulerEvents(state: UiState, runtime: RuntimeClient, limit: number): Promise<UiState> {
  const events = readWakeSchedulerEventRecordList(await runtime.command("runtime.list_wake_scheduler_events", { limit }), "runtime.list_wake_scheduler_events", limit)
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      events,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "wake scheduler events loaded", detail: `records=${events.length}`, status: "loaded" }].slice(-12),
  }
}

async function loadWakeSchedulerStatusWithBootstrap(state: UiState, runtime: RuntimeClient): Promise<UiState> {
  const withStatus = applyWakeSchedulerStatus(state, await runtime.command("runtime.wake_scheduler_status"))
  try {
    return applyWakeSchedulerBootstrapStatus(withStatus, await runtime.command("runtime.wake_scheduler_bootstrap_status"))
  } catch (error) {
    return recordWakeSchedulerCommandError(withStatus, error)
  }
}

function applyWakeSchedulerPreview(state: UiState, value: unknown): UiState {
  const previewResult = readWakeSchedulerPreview(value)
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      preview: previewResult,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "wake scheduler preview", detail: `every=${previewResult.config.interval_ms}ms dry_run=${previewResult.config.dry_run}`, status: previewResult.can_start ? "ready" : "blocked" }].slice(-12),
  }
}

function applyWakeSchedulerStatus(state: UiState, value: unknown): UiState {
  const status = readWakeSchedulerState(value)
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      status,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "wake scheduler status", detail: `status=${status.status} ticks=${status.tick_count}`, status: status.status }].slice(-12),
  }
}

function applyWakeSchedulerBootstrapStatus(state: UiState, value: unknown): UiState {
  const status = readWakeSchedulerBootstrapStatus(value, "runtime.wake_scheduler_bootstrap_status")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      bootstrapStatus: status,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "wake scheduler bootstrap", detail: `autostart=${status.autostart_enabled} can_bootstrap=${status.can_bootstrap}`, status: status.can_bootstrap ? "ready" : "blocked" }].slice(-12),
  }
}

function applyWakeSchedulerBootstrapPreview(state: UiState, value: unknown): UiState {
  const previewResult = readWakeSchedulerBootstrapStatus(value, "runtime.preview_wake_scheduler_bootstrap")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      bootstrapPreview: previewResult,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "wake scheduler bootstrap preview", detail: `autostart=${previewResult.autostart_enabled} can_bootstrap=${previewResult.can_bootstrap}`, status: previewResult.can_bootstrap ? "ready" : "blocked" }].slice(-12),
  }
}

function applyWakeSchedulerRecoveryPreview(state: UiState, value: unknown): UiState {
  const previewResult = readWakeSchedulerRecoveryPreview(value, "runtime.preview_wake_scheduler_recovery")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      recoveryPreview: previewResult,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler recovery preview", detail: `status=${previewResult.status} stale=${previewResult.stale_detected}`, status: previewResult.status }].slice(-12),
  }
}

function applyWakeSchedulerRecoveries(state: UiState, value: unknown, limit: number): UiState {
  const recoveries = readWakeSchedulerRecoveryRecordList(value, "runtime.list_wake_scheduler_recoveries", limit)
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      recoveries,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler recoveries loaded", detail: `records=${recoveries.length}`, status: "loaded" }].slice(-12),
  }
}

function applyWakeSchedulerRecovery(state: UiState, value: unknown, requestedId?: string): UiState {
  const recovery = readWakeSchedulerRecovery(value, "runtime.get_wake_scheduler_recovery")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      selectedRecovery: recovery,
      commandError: recovery ? undefined : `scheduler recovery not found: ${redactText(requestedId ?? "")}`,
    },
    systemActions: [...state.systemActions, { title: "scheduler recovery", detail: recovery ? `id=${recovery.recovery_id} status=${recovery.status}` : `missing=${redactText(requestedId ?? "")}`, status: recovery?.status ?? "missing" }].slice(-12),
  }
}

function applyWakeSchedulerRecoveryWorkflowPreview(state: UiState, value: unknown): UiState {
  const previewResult = readWakeSchedulerRecoveryWorkflowPreview(value, "runtime.preview_wake_scheduler_recovery_workflow")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      recoveryWorkflowPreview: previewResult,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler recovery workflow preview", detail: `can_create=${previewResult.can_create} steps=${previewResult.step_count}`, status: previewResult.can_create ? "ready" : "blocked" }].slice(-12),
  }
}

function applyWakeSchedulerRecoveryWorkflow(state: UiState, value: unknown, requestedId?: string): UiState {
  const workflow = readWakeSchedulerRecoveryWorkflow(value, "runtime.get_wake_scheduler_recovery_workflow")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      selectedRecoveryWorkflow: workflow,
      commandError: workflow ? undefined : `scheduler recovery workflow not found: ${redactText(requestedId ?? "")}`,
    },
    systemActions: [...state.systemActions, { title: "scheduler recovery workflow", detail: workflow ? `id=${workflow.workflow_id} status=${workflow.status}` : `missing=${redactText(requestedId ?? "")}`, status: workflow?.status ?? "missing" }].slice(-12),
  }
}

function applyWakeSchedulerRecoveryWorkflows(state: UiState, value: unknown, limit: number): UiState {
  const workflows = readWakeSchedulerRecoveryWorkflowRecordList(value, "runtime.list_wake_scheduler_recovery_workflows", limit)
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      recoveryWorkflows: workflows,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler recovery workflows loaded", detail: `records=${workflows.length}`, status: "loaded" }].slice(-12),
  }
}

function applyWakeSchedulerRecoveryWorkflowVerification(state: UiState, value: unknown): UiState {
  const verification = readWakeSchedulerRecoveryWorkflowVerification(value, "runtime.verify_wake_scheduler_recovery_workflow")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      recoveryWorkflowVerification: verification,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler recovery workflow verification", detail: `updates=${verification.step_updates.length}`, status: "checked" }].slice(-12),
  }
}

function applyWakeSchedulerAuditSummary(state: UiState, value: unknown): UiState {
  const summary = readWakeSchedulerAuditSummary(value, "runtime.wake_scheduler_audit_summary")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      auditSummary: summary,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler audit summary", detail: `events=${summary.event_count} incidents=${summary.unresolved_incident_count}`, status: summary.unresolved_incident_count > 0 ? "warning" : "loaded" }].slice(-12),
  }
}

function applyWakeSchedulerAuditTimeline(state: UiState, value: unknown, limit: number): UiState {
  const timeline = readWakeSchedulerAuditTimeline(value, "runtime.wake_scheduler_audit_timeline", limit)
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      auditTimeline: timeline,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler audit timeline", detail: `entries=${timeline.length}`, status: "loaded" }].slice(-12),
  }
}

function applyWakeSchedulerAuditChain(state: UiState, value: unknown, requestedId?: string): UiState {
  const chain = readWakeSchedulerAuditChain(value, "runtime.wake_scheduler_audit_chain")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      selectedAuditChain: chain,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler audit chain", detail: `related=${redactText(requestedId ?? chain.root_id)} entries=${chain.entries.length}`, status: chain.gaps.length > 0 ? "warning" : "loaded" }].slice(-12),
  }
}

function applyWakeSchedulerAuditIncidents(state: UiState, value: unknown, limit: number): UiState {
  const incidents = readWakeSchedulerAuditIncidents(value, "runtime.wake_scheduler_audit_incidents", limit)
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      auditIncidents: incidents,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler audit incidents", detail: `incidents=${incidents.length}`, status: incidents.some((incident) => incident.status === "open") ? "warning" : "loaded" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationBoard(state: UiState, value: unknown): UiState {
  const board = readWakeSchedulerNavigationBoard(value, "runtime.wake_scheduler_navigation_board")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      navigationBoard: board,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler navigation", detail: `cards=${board.cards.length} source=${board.source.kind}`, status: board.blockers.length > 0 ? "blocked" : "loaded" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationCommandPreview(state: UiState, value: unknown): UiState {
  const commandPreview = readWakeSchedulerNavigationCommandPreview(value, "runtime.preview_wake_scheduler_navigation_command")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      navigationCommandPreview: commandPreview,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler navigation command", detail: `${commandPreview.risk} ${commandPreview.target_kind}`, status: commandPreview.supported ? "loaded" : "blocked" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationTarget(state: UiState, value: unknown): UiState {
  const target = readWakeSchedulerNavigationTarget(value, "runtime.get_wake_scheduler_navigation_target")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      navigationTarget: target,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler navigation target", detail: `${target.target_kind} ${target.target_id}`, status: target.warnings.length > 0 ? "warning" : "loaded" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationStagePreview(state: UiState, value: unknown): UiState {
  const stagePreview = readWakeSchedulerNavigationStagePreview(value, "runtime.preview_wake_scheduler_navigation_stage")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      navigationStagePreview: stagePreview,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler navigation stage preview", detail: `${stagePreview.eligibility.risk} can_stage=${stagePreview.eligibility.can_stage}`, status: stagePreview.eligibility.can_stage ? "ready" : "blocked" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationStagedCommand(state: UiState, value: unknown, stagedId?: string): UiState {
  const staged = readWakeSchedulerNavigationStagedCommand(value, "runtime.stage_wake_scheduler_navigation_command")
  if (!staged && value !== null) throw new Error("runtime.stage_wake_scheduler_navigation_command returned invalid staged command")
  const selectedId = staged?.staged_id ?? (stagedId ? redactText(stagedId) : undefined)
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      selectedStagedNavigationCommand: staged,
      commandError: undefined,
    },
    systemActions: selectedId
      ? [...state.systemActions, { title: "scheduler navigation staged", detail: `staged_id=${selectedId}`, status: staged ? "staged" : "removed" }].slice(-12)
      : state.systemActions,
  }
}

function applyWakeSchedulerNavigationStagedCommands(state: UiState, value: unknown, limit: number): UiState {
  const staged = readWakeSchedulerNavigationStagedCommandRecords(value, "runtime.list_wake_scheduler_navigation_staged_commands", limit)
  const currentSelection = wakeSchedulerState(state).selectedStagedNavigationCommand
  const selected = currentSelection && staged.some((item) => item.staged_id === currentSelection.staged_id) ? currentSelection : null
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      stagedNavigationCommands: staged,
      selectedStagedNavigationCommand: selected,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler navigation staged commands", detail: `commands=${staged.length}`, status: "loaded" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationStagedReadPreview(state: UiState, value: unknown): UiState {
  const previewResult = readWakeSchedulerNavigationStagedRunPreview(value, "runtime.preview_wake_scheduler_navigation_staged_read")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      stagedReadPreview: previewResult,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler navigation staged read preview", detail: `staged_id=${previewResult.staged_id} can_execute=${previewResult.can_execute}`, status: previewResult.can_execute ? "ready" : "blocked" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationStagedReadResult(state: UiState, value: unknown, runId?: string): UiState {
  const result = readWakeSchedulerNavigationStagedRunResult(value, "runtime.execute_wake_scheduler_navigation_staged_read")
  if (!result && value !== null) throw new Error("runtime staged read command returned invalid result")
  const selectedId = result?.run_id ?? (runId ? redactText(runId) : undefined)
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      latestStagedReadResult: result,
      commandError: undefined,
    },
    systemActions: selectedId
      ? [...state.systemActions, { title: "scheduler navigation staged read", detail: `run_id=${selectedId}`, status: result?.status ?? "missing" }].slice(-12)
      : state.systemActions,
  }
}

function applyWakeSchedulerNavigationStagedReadRuns(state: UiState, value: unknown, limit: number): UiState {
  const runs = readWakeSchedulerNavigationStagedRunRecords(value, "runtime.list_wake_scheduler_navigation_staged_read_runs", limit)
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      stagedReadRuns: runs,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler navigation staged read runs", detail: `runs=${runs.length}`, status: "loaded" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationStagedReadHistory(state: UiState, value: unknown): UiState {
  const history = readWakeSchedulerNavigationStagedReadHistory(value, "runtime.wake_scheduler_navigation_staged_read_history")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      stagedReadHistory: history,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler navigation read history", detail: `groups=${history.total_groups} runs=${history.total_runs}`, status: "loaded" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationStagedReadComparison(state: UiState, value: unknown): UiState {
  const comparison = readWakeSchedulerNavigationStagedReadComparison(value, "runtime.wake_scheduler_navigation_staged_read_compare")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      stagedReadComparison: comparison,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler navigation read comparison", detail: `status=${comparison.comparison_status}`, status: "loaded" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationStagedReadStale(state: UiState, value: unknown, limit: number): UiState {
  const stale = readWakeSchedulerNavigationStagedReadStaleItems(value, "runtime.wake_scheduler_navigation_staged_read_stale", limit)
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      stagedReadStaleItems: stale,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler navigation stale reads", detail: `items=${stale.length}`, status: "loaded" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationStagedReadGroup(state: UiState, value: unknown, stagedId: string): UiState {
  const group = readWakeSchedulerNavigationStagedReadGroup(value, "runtime.wake_scheduler_navigation_staged_read_group")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      selectedStagedReadGroup: group,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler navigation read group", detail: `staged_id=${redactText(stagedId)}`, status: group ? "loaded" : "missing" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationWritePreview(state: UiState, value: unknown): UiState {
  const writePreview = readWakeSchedulerNavigationWritePreview(value, "runtime.preview_wake_scheduler_navigation_write_command")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      writePreview,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler write eligibility", detail: `${writePreview.risk}/${writePreview.authority_gate}`, status: writePreview.status }].slice(-12),
  }
}

function applyWakeSchedulerNavigationWriteBoard(state: UiState, value: unknown): UiState {
  const writeBoard = readWakeSchedulerNavigationWriteBoard(value, "runtime.wake_scheduler_navigation_write_board")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      writeBoard,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler write eligibility board", detail: `previews=${writeBoard.previews.length}`, status: "loaded" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationWriteStagePreview(state: UiState, value: unknown): UiState {
  const writeStagePreview = readWakeSchedulerNavigationWriteStagePreview(value, "runtime.preview_wake_scheduler_navigation_write_stage")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      writeStagePreview,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler write stage preview", detail: `${writeStagePreview.eligibility.risk} can_stage=${writeStagePreview.eligibility.can_stage}`, status: writeStagePreview.eligibility.can_stage ? "ready" : "blocked" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationStagedWriteCommand(state: UiState, value: unknown, stagedWriteId?: string): UiState {
  const staged = readWakeSchedulerNavigationStagedWriteCommand(value, "runtime.stage_wake_scheduler_navigation_write_command")
  if (!staged && value !== null) throw new Error("runtime staged write command returned invalid staged command")
  const selectedId = staged?.staged_write_id ?? (stagedWriteId ? redactText(stagedWriteId) : undefined)
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      selectedStagedWriteCommand: staged,
      commandError: undefined,
    },
    systemActions: selectedId
      ? [...state.systemActions, { title: "scheduler write staged", detail: `staged_write_id=${selectedId}`, status: staged ? "staged" : "removed" }].slice(-12)
      : state.systemActions,
  }
}

function applyWakeSchedulerNavigationStagedWriteCommands(state: UiState, value: unknown, limit: number): UiState {
  const staged = readWakeSchedulerNavigationStagedWriteCommandRecords(value, "runtime.list_wake_scheduler_navigation_staged_write_commands", limit)
  const currentSelection = wakeSchedulerState(state).selectedStagedWriteCommand
  const selected = currentSelection && staged.some((item) => item.staged_write_id === currentSelection.staged_write_id) ? currentSelection : null
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      stagedWriteCommands: staged,
      selectedStagedWriteCommand: selected,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler staged writes", detail: `commands=${staged.length}`, status: "loaded" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationWriteRunPreview(state: UiState, value: unknown): UiState {
  const writeRunPreview = readWakeSchedulerNavigationWriteRunPreview(value, "runtime.preview_wake_scheduler_navigation_write_run")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      writeRunPreview,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler write run preview", detail: `${writeRunPreview.execution_kind} can_execute=${writeRunPreview.can_execute}`, status: writeRunPreview.can_execute ? "ready" : "blocked" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationWriteRunResult(state: UiState, value: unknown, runId?: string): UiState {
  const result = readWakeSchedulerNavigationWriteRunResult(value, "runtime.execute_wake_scheduler_navigation_write_run")
  if (!result && value !== null) throw new Error("runtime write run returned invalid result")
  const selectedId = result?.run_id ?? (runId ? redactText(runId) : undefined)
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      latestWriteRunResult: result,
      commandError: undefined,
    },
    systemActions: selectedId
      ? [...state.systemActions, { title: "scheduler write run", detail: `run_id=${selectedId}`, status: result?.status ?? "missing" }].slice(-12)
      : state.systemActions,
  }
}

function applyWakeSchedulerNavigationWriteRunRecords(state: UiState, value: unknown, limit: number): UiState {
  const records = readWakeSchedulerNavigationWriteRunRecords(value, "runtime.list_wake_scheduler_navigation_write_runs", limit)
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      writeRunRecords: records,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler write runs", detail: `runs=${records.length}`, status: "loaded" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationWriteRunHistory(state: UiState, value: unknown): UiState {
  const history = readWakeSchedulerNavigationWriteRunHistory(value, "runtime.wake_scheduler_navigation_write_run_history")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      writeRunHistory: history,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler write-run history", detail: `groups=${history.total_groups} runs=${history.total_runs}`, status: "loaded" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationWriteRunComparison(state: UiState, value: unknown): UiState {
  const comparison = readWakeSchedulerNavigationWriteRunComparison(value, "runtime.wake_scheduler_navigation_write_run_compare")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      writeRunComparison: comparison,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler write-run comparison", detail: `status=${comparison.comparison_status}`, status: "loaded" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationWriteRunStale(state: UiState, value: unknown, limit: number): UiState {
  const stale = readWakeSchedulerNavigationWriteRunStaleItems(value, "runtime.wake_scheduler_navigation_write_run_stale", limit)
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      writeRunStaleItems: stale,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler stale write-runs", detail: `items=${stale.length}`, status: "loaded" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationWriteRunGroup(state: UiState, value: unknown, stagedWriteId: string): UiState {
  const group = readWakeSchedulerNavigationWriteRunGroup(value, "runtime.wake_scheduler_navigation_write_run_group")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      selectedWriteRunGroup: group,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler write-run group", detail: `staged_write_id=${redactText(stagedWriteId)}`, status: group ? "loaded" : "missing" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationWriteReadinessPreview(state: UiState, value: unknown): UiState {
  const readiness = readWakeSchedulerNavigationWriteReadinessPreview(value, "runtime.preview_wake_scheduler_navigation_write_readiness")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      writeReadinessPreview: readiness,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler write approval readiness", detail: `${readiness.readiness_status} can_approve=${readiness.can_approve}`, status: readiness.can_approve ? "ready" : "blocked" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationWriteApproval(state: UiState, value: unknown, approvalId?: string): UiState {
  const approval = readWakeSchedulerNavigationWriteApproval(value, "runtime.scheduler_navigation_write_approval")
  if (!approval && value !== null) throw new Error("runtime write approval returned invalid approval")
  const selectedId = approval?.approval_id ?? (approvalId ? redactText(approvalId) : undefined)
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      selectedWriteApproval: approval,
      commandError: undefined,
    },
    systemActions: selectedId
      ? [...state.systemActions, { title: "scheduler write approval", detail: `approval_id=${selectedId}`, status: approval?.status ?? "missing" }].slice(-12)
      : state.systemActions,
  }
}

function applyWakeSchedulerNavigationWriteApprovalRecords(state: UiState, value: unknown, limit: number): UiState {
  const records = readWakeSchedulerNavigationWriteApprovalRecords(value, "runtime.list_wake_scheduler_navigation_write_approvals", limit)
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      writeApprovalRecords: records,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler write approvals", detail: `records=${records.length}`, status: "loaded" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationCheckpointWriteRunPreview(state: UiState, value: unknown): UiState {
  const checkpointWriteRunPreview = readWakeSchedulerNavigationCheckpointWriteRunPreview(value, "runtime.preview_wake_scheduler_navigation_checkpoint_write_run")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      checkpointWriteRunPreview,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler checkpoint write run preview", detail: `${checkpointWriteRunPreview.execution_kind} can_execute=${checkpointWriteRunPreview.can_execute}`, status: checkpointWriteRunPreview.can_execute ? "ready" : "blocked" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationCheckpointWriteRunResult(state: UiState, value: unknown, runId?: string): UiState {
  const result = readWakeSchedulerNavigationCheckpointWriteRunResult(value, "runtime.execute_wake_scheduler_navigation_checkpoint_write_run")
  if (!result && value !== null) throw new Error("runtime checkpoint write run returned invalid result")
  const selectedId = result?.run_id ?? (runId ? redactText(runId) : undefined)
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      latestCheckpointWriteRunResult: result,
      commandError: undefined,
    },
    systemActions: selectedId
      ? [...state.systemActions, { title: "scheduler checkpoint write run", detail: `run_id=${selectedId}`, status: result?.status ?? "missing" }].slice(-12)
      : state.systemActions,
  }
}

function applyWakeSchedulerNavigationCheckpointWriteRunRecords(state: UiState, value: unknown, limit: number): UiState {
  const records = readWakeSchedulerNavigationCheckpointWriteRunRecords(value, "runtime.list_wake_scheduler_navigation_checkpoint_write_runs", limit)
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      checkpointWriteRunRecords: records,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler checkpoint write runs", detail: `runs=${records.length}`, status: "loaded" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationCheckpointWriteHistory(state: UiState, value: unknown): UiState {
  const history = readWakeSchedulerNavigationCheckpointWriteHistory(value, "runtime.wake_scheduler_navigation_checkpoint_write_history")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      checkpointWriteHistory: history,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler checkpoint write history", detail: `groups=${history.total_groups} runs=${history.total_runs}`, status: "loaded" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationCheckpointWriteComparison(state: UiState, value: unknown): UiState {
  const comparison = readWakeSchedulerNavigationCheckpointWriteComparison(value, "runtime.wake_scheduler_navigation_checkpoint_write_compare")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      checkpointWriteComparison: comparison,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler checkpoint write comparison", detail: `status=${comparison.comparison_status}`, status: "loaded" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationCheckpointWriteStale(state: UiState, value: unknown, limit: number): UiState {
  const stale = readWakeSchedulerNavigationCheckpointWriteStaleItems(value, "runtime.wake_scheduler_navigation_checkpoint_write_stale", limit)
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      checkpointWriteStaleItems: stale,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler stale checkpoint writes", detail: `items=${stale.length}`, status: "loaded" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationCheckpointWriteGroup(state: UiState, value: unknown, stagedWriteId: string): UiState {
  const group = readWakeSchedulerNavigationCheckpointWriteGroup(value, "runtime.wake_scheduler_navigation_checkpoint_write_group")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      selectedCheckpointWriteGroup: group,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler checkpoint write group", detail: `staged_write_id=${redactText(stagedWriteId)}`, status: group ? "loaded" : "missing" }].slice(-12),
  }
}

function applyWakeSchedulerNavigationCheckpointApprovalUsage(state: UiState, value: unknown): UiState {
  const usage = readWakeSchedulerNavigationCheckpointApprovalUsage(value, "runtime.wake_scheduler_navigation_checkpoint_write_approval_usage")
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      checkpointApprovalUsage: usage,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "scheduler checkpoint approval usage", detail: `approvals=${usage.total_approvals} used=${usage.used_count}`, status: "loaded" }].slice(-12),
  }
}

function applyResearchSynthesisResult(state: UiState, value: unknown, synthesisId?: string): UiState {
  const result = readResearchSynthesisResult(value)
  if (!result && value !== null) throw new Error("runtime.get_research_synthesis returned invalid result")
  const selectedId = result?.synthesis_id ?? (synthesisId ? redactText(synthesisId) : undefined)
  return {
    ...state,
    researchSynthesis: {
      ...researchSynthesisState(state),
      selected: result,
      recent: result ? [recordFromSynthesisResult(result), ...researchSynthesisState(state).recent.filter((item) => item.synthesis_id !== result.synthesis_id)].slice(0, SYNTHESIS_LIMIT) : researchSynthesisState(state).recent,
      commandError: undefined,
    },
    systemActions: selectedId
      ? [...state.systemActions, { title: "research synthesis selected", detail: `synthesis_id=${selectedId}`, status: result ? "loaded" : "missing" }].slice(-12)
      : state.systemActions,
  }
}

function applyCommanderTargetContext(state: UiState, value: unknown): UiState {
  const context = readCommanderTargetContext(value)
  return {
    ...state,
    commanderNavigation: {
      ...commanderNavigationState(state),
      selected: context,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "target context loaded", detail: `${context.target_type}:${context.target_id}`, status: context.found ? context.status : "missing" }].slice(-12),
  }
}

function stageSuggestedOperatorCommand(state: UiState, args: string[]): UiState {
  const staged = stageSuggestedCommand(state.commanderNavigation?.selected, requiredArg(args, 0, "index"))
  return applyStagedOperatorCommand(state, staged, "operator command staged")
}

function stageExplicitOperatorCommand(state: UiState, args: string[]): UiState {
  const staged = stageExplicitCommand(requiredRest(args, 0, "command"))
  return applyStagedOperatorCommand(state, staged, "operator command staged")
}

function applyStagedOperatorCommand(state: UiState, staged: OperatorStagedCommand, title: string): UiState {
  return {
    ...state,
    operatorActions: {
      ...operatorActionsState(state),
      staged,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title, detail: preview(redactText(staged.command)), status: staged.command_type }].slice(-12),
  }
}

function clearStagedOperatorCommand(state: UiState): UiState {
  return {
    ...state,
    operatorActions: {
      ...operatorActionsState(state),
      staged: null,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "operator command cleared", detail: "staged=none", status: "cleared" }].slice(-12),
  }
}

function previewStagedOperatorCommand(state: UiState): UiState {
  const staged = operatorActionsState(state).staged
  if (!staged) throw new Error("staged command is required")
  return {
    ...state,
    operatorActions: {
      ...operatorActionsState(state),
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "operator command preview", detail: preview(redactText(staged.command)), status: staged.command_type }].slice(-12),
  }
}

async function runStagedOperatorCommand(state: UiState, runtime: RuntimeClient): Promise<UiState> {
  const staged = operatorActionsState(state).staged
  if (!staged) throw new Error("staged command is required")
  const commandToRun = executionCommandFor(staged)
  const parsed = parseRuntimeCommand(commandToRun)
  if (!parsed) {
    return applyOperatorExecutionFailure(state, staged, `unsupported staged command: ${staged.command}`)
  }
  if (operatorActionCommands.has(parsed.command)) {
    return applyOperatorExecutionFailure(state, staged, `staged command cannot be an operator action command: ${parsed.command}`)
  }
  const executedAt = new Date().toISOString()
  try {
    const executionState = clearCommandErrorFor(parsed.command, state)
    const executedRaw = await applyNamedRuntimeCommand(executionState, runtime, parsed.command, parsed.args)
    const immediateError = commandErrorFor(parsed.command, executedRaw)
    if (immediateError) {
      return applyOperatorExecutionFailure(executedRaw, staged, immediateError, executedAt)
    }
    const executed = shouldRefreshAfterCommand(parsed.command)
      ? await refreshRuntimeRecordsOrRecordError(executedRaw, runtime)
      : executedRaw
    const afterError = commandErrorFor(parsed.command, executed)
    if (afterError) {
      return applyOperatorExecutionFailure(executed, staged, afterError, executedAt)
    }
    const result = operatorExecutionResult(staged.command, true, `executed ${parsed.command}`, executedAt, parsed.command, parsed.args)
    return {
      ...executed,
      operatorActions: {
        ...operatorActionsState(executed),
        staged: null,
        lastResult: result,
        commandError: undefined,
      },
      systemActions: [...executed.systemActions, { title: "operator command executed", detail: result.summary, status: "ok" }].slice(-12),
    }
  } catch (error) {
    return applyOperatorExecutionFailure(state, staged, error instanceof Error ? error.message : String(error), executedAt)
  }
}

function applyOperatorExecutionFailure(state: UiState, staged: OperatorStagedCommand, summary: string, executedAt = new Date().toISOString()): UiState {
  const message = redactText(summary)
  const result = operatorExecutionResult(staged.command, false, message, executedAt)
  return {
    ...state,
    operatorActions: {
      ...operatorActionsState(state),
      staged,
      lastResult: result,
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "operator command failed", detail: message, status: "failed" }].slice(-12),
  }
}

function operatorExecutionResult(command: string, ok: boolean, summary: string, executedAt: string, parsedCommand?: string, args: string[] = []): OperatorCommandExecutionResult {
  return {
    command: redactText(command),
    ok,
    summary: redactText(summary),
    executed_at: executedAt,
    ...affectedTarget(parsedCommand, args),
  }
}

function affectedTarget(command: string | undefined, args: string[]): Pick<OperatorCommandExecutionResult, "affected_target_type" | "affected_target_id"> {
  if (!command) return {}
  if (command === "open" || command === "jump" || command === "target" || command === "audit" || command === "apply-preview" || command === "apply-target" || command === "apply-partial") {
    return args[0] && args[1] ? { affected_target_type: redactText(args[0]), affected_target_id: redactText(args[1]) } : {}
  }
  const aliasTarget = command.startsWith("open-") ? command.slice("open-".length) : undefined
  if (aliasTarget && args[0]) return { affected_target_type: redactText(aliasTarget), affected_target_id: redactText(args[0]) }
  const directTargets: Record<string, string> = {
    mission: "mission",
    claims: "mission",
    progress: "mission",
    results: "mission",
    review: "review",
    approve: "review",
    reject: "review",
    "cancel-review": "review",
    proposal: "proposal",
    "proposal-review": "proposal",
    "apply-proposal": "proposal",
    "cancel-proposal": "proposal",
    bundle: "bundle",
    "bundle-add": "bundle",
    "bundle-review": "bundle",
    "bundle-ready": "bundle",
    "apply-bundle": "bundle",
    "cancel-bundle": "bundle",
    draft: "draft",
    "draft-ready": "draft",
    "draft-review": "draft",
    "cancel-draft": "draft",
  }
  const targetType = directTargets[command]
  return targetType && args[0] ? { affected_target_type: targetType, affected_target_id: redactText(args[0]) } : {}
}

function commandErrorFor(command: string, state: UiState): string | undefined {
  if (commandAuthorityCommands.has(command)) return state.commandAuthority?.commandError
  if (missionExecutionCommands.has(command)) return state.missionExecution?.commandError
  if (reviewCommands.has(command)) return state.reviews?.commandError
  if (proposalCommands.has(command)) return state.proposals?.commandError
  if (proposalBundleCommands.has(command)) return state.proposalBundles?.commandError
  if (playbookCommands.has(command)) return state.commanderPlaybooks?.commandError
  if (workbenchCommands.has(command)) return state.commanderWorkbench?.commandError
  if (commanderApplyCommands.has(command)) return state.commanderApply?.commandError
  if (commanderAuditCommands.has(command)) return state.commanderAudit?.commandError
  if (commanderQueueCommands.has(command)) return state.commanderQueues?.commandError
  if (commanderNavigationCommands.has(command)) return state.commanderNavigation?.commandError
  if (externalApiCommands.has(command)) return state.externalApi?.commandError
  if (researchSynthesisCommands.has(command)) return state.researchSynthesis?.commandError
  if (commanderCycleCommands.has(command)) return state.commanderCycle?.commandError
  if (opencodeHandoffCommands.has(command)) return state.opencodeHandoff?.commandError
  if (opencodeProcessSmokeCommands.has(command)) return state.opencodeProcessSmoke?.commandError
  if (opencodeHandoffReadinessCommands.has(command)) return state.opencodeHandoffReadiness?.commandError
  if (opencodeResultReviewCommands.has(command)) return state.opencodeResultReview?.commandError
  if (opencodeSessionCommands.has(command)) return state.opencodeSessions?.commandError
  if (contextBudgetCommands.has(command)) return state.contextBudgets?.commandError
  if (contextPacketCommands.has(command)) return state.contextPackets?.commandError
  if (opencodeSessionInstructionPackCommands.has(command)) return state.opencodeSessionInstructionPacks?.commandError
  if (opencodeLaunchReadinessCommands.has(command)) return state.opencodeLaunchReadiness?.commandError
  if (opencodeLaunchCommands.has(command)) return state.opencodeLaunches?.commandError
  if (opencodeProgressCommands.has(command)) return state.opencodeProgress?.commandError
  if (opencodeWatchdogCommands.has(command)) return state.opencodeWatchdog?.commandError
  if (opencodeCommanderQuestionCommands.has(command)) return state.opencodeCommanderQuestions?.commandError
  if (researchMemoryCommands.has(command)) return state.researchMemory?.commandError
  if (commanderExecutorReviewCommands.has(command)) return state.commanderExecutorReview?.commandError
  if (executorReviewProposalDraftCommands.has(command)) return state.executorReviewProposalDrafts?.commandError
  if (executorReviewProposalCreateCommands.has(command)) return state.executorReviewProposalCreate?.commandError
  if (executorReviewProposalReviewRequestCommands.has(command)) return state.executorReviewProposalReviewRequest?.commandError
  if (executorReviewProposalReviewDecisionCommands.has(command)) return state.executorReviewProposalReviewDecision?.commandError
  if (executorReviewProposalApplyReadinessCommands.has(command)) return state.executorReviewProposalApplyReadiness?.commandError
  if (executorReviewProposalNarrowApplyCommands.has(command)) return state.executorReviewProposalNarrowApply?.commandError
  if (opencodeFollowupCommands.has(command)) return state.opencodeFollowup?.commandError
  if (runtimeCheckpointCommands.has(command)) return state.runtimeCheckpoints?.commandError
  if (runtimeRestoreCommands.has(command)) return state.runtimeRestore?.commandError
  if (wakeAssessmentCommands.has(command)) return state.wakeAssessment?.commandError
  if (continuationCommands.has(command)) return state.continuation?.commandError
  if (wakeScheduleCommands.has(command)) return state.wakeSchedules?.commandError
  if (wakeSchedulerCommands.has(command)) return state.wakeScheduler?.commandError
  if (reasoningProviderCommands.has(command)) return state.reasoningProvider?.commandError
  if (researchCommands.has(command)) return state.research?.commandError
  return state.runtimeCommandError
}

function clearCommandErrorFor(command: string, state: UiState): UiState {
  if (commandAuthorityCommands.has(command)) return { ...state, commandAuthority: { ...commandAuthorityState(state), commandError: undefined } }
  if (missionExecutionCommands.has(command)) return { ...state, missionExecution: { ...missionExecutionState(state), commandError: undefined } }
  if (reviewCommands.has(command)) return { ...state, reviews: { ...reviewsState(state), commandError: undefined } }
  if (proposalCommands.has(command)) return { ...state, proposals: { ...proposalsState(state), commandError: undefined } }
  if (proposalBundleCommands.has(command)) return { ...state, proposalBundles: { ...proposalBundlesState(state), commandError: undefined } }
  if (playbookCommands.has(command)) return { ...state, commanderPlaybooks: { ...commanderPlaybooksState(state), commandError: undefined } }
  if (workbenchCommands.has(command)) return { ...state, commanderWorkbench: { ...commanderWorkbenchState(state), commandError: undefined } }
  if (commanderApplyCommands.has(command)) return { ...state, commanderApply: { ...commanderApplyState(state), commandError: undefined } }
  if (commanderAuditCommands.has(command)) return { ...state, commanderAudit: { ...commanderAuditState(state), commandError: undefined } }
  if (commanderQueueCommands.has(command)) return { ...state, commanderQueues: { ...commanderQueuesState(state), commandError: undefined } }
  if (commanderNavigationCommands.has(command)) return { ...state, commanderNavigation: { ...commanderNavigationState(state), commandError: undefined } }
  if (externalApiCommands.has(command)) return { ...state, externalApi: { ...externalApiState(state), commandError: undefined } }
  if (researchSynthesisCommands.has(command)) return { ...state, researchSynthesis: { ...researchSynthesisState(state), commandError: undefined } }
  if (commanderCycleCommands.has(command)) return { ...state, commanderCycle: { ...commanderCycleState(state), commandError: undefined } }
  if (opencodeHandoffCommands.has(command)) return { ...state, opencodeHandoff: { ...opencodeHandoffState(state), commandError: undefined } }
  if (opencodeProcessSmokeCommands.has(command)) return { ...state, opencodeProcessSmoke: { ...opencodeProcessSmokeState(state), commandError: undefined } }
  if (opencodeHandoffReadinessCommands.has(command)) return { ...state, opencodeHandoffReadiness: { ...opencodeHandoffReadinessState(state), commandError: undefined } }
  if (opencodeResultReviewCommands.has(command)) return { ...state, opencodeResultReview: { ...opencodeResultReviewState(state), commandError: undefined } }
  if (opencodeSessionCommands.has(command)) return { ...state, opencodeSessions: { ...opencodeSessionsState(state), commandError: undefined } }
  if (contextBudgetCommands.has(command)) return { ...state, contextBudgets: { ...contextBudgetsState(state), commandError: undefined } }
  if (contextPacketCommands.has(command)) return { ...state, contextPackets: { ...contextPacketsState(state), commandError: undefined } }
  if (opencodeSessionInstructionPackCommands.has(command)) return { ...state, opencodeSessionInstructionPacks: { ...opencodeSessionInstructionPacksState(state), commandError: undefined } }
  if (opencodeLaunchReadinessCommands.has(command)) return { ...state, opencodeLaunchReadiness: { ...opencodeLaunchReadinessState(state), commandError: undefined } }
  if (opencodeLaunchCommands.has(command)) return { ...state, opencodeLaunches: { ...opencodeLaunchesState(state), commandError: undefined } }
  if (opencodeProgressCommands.has(command)) return { ...state, opencodeProgress: { ...opencodeProgressState(state), commandError: undefined } }
  if (opencodeWatchdogCommands.has(command)) return { ...state, opencodeWatchdog: { ...opencodeWatchdogState(state), commandError: undefined } }
  if (opencodeCommanderQuestionCommands.has(command)) return { ...state, opencodeCommanderQuestions: { ...opencodeCommanderQuestionState(state), commandError: undefined } }
  if (researchMemoryCommands.has(command)) return { ...state, researchMemory: { ...researchMemoryState(state), commandError: undefined } }
  if (commanderExecutorReviewCommands.has(command)) return { ...state, commanderExecutorReview: { ...commanderExecutorReviewState(state), commandError: undefined } }
  if (executorReviewProposalDraftCommands.has(command)) return { ...state, executorReviewProposalDrafts: { ...executorReviewProposalDraftState(state), commandError: undefined } }
  if (executorReviewProposalCreateCommands.has(command)) return { ...state, executorReviewProposalCreate: { ...executorReviewProposalCreateState(state), commandError: undefined } }
  if (executorReviewProposalReviewRequestCommands.has(command)) return { ...state, executorReviewProposalReviewRequest: { ...executorReviewProposalReviewRequestState(state), commandError: undefined } }
  if (executorReviewProposalReviewDecisionCommands.has(command)) return { ...state, executorReviewProposalReviewDecision: { ...executorReviewProposalReviewDecisionState(state), commandError: undefined } }
  if (executorReviewProposalApplyReadinessCommands.has(command)) return { ...state, executorReviewProposalApplyReadiness: { ...executorReviewProposalApplyReadinessState(state), commandError: undefined } }
  if (executorReviewProposalNarrowApplyCommands.has(command)) return { ...state, executorReviewProposalNarrowApply: { ...executorReviewProposalNarrowApplyState(state), commandError: undefined } }
  if (opencodeFollowupCommands.has(command)) return { ...state, opencodeFollowup: { ...opencodeFollowupState(state), commandError: undefined } }
  if (runtimeCheckpointCommands.has(command)) return { ...state, runtimeCheckpoints: { ...runtimeCheckpointsState(state), commandError: undefined } }
  if (runtimeRestoreCommands.has(command)) return { ...state, runtimeRestore: { ...runtimeRestoreState(state), commandError: undefined } }
  if (wakeAssessmentCommands.has(command)) return { ...state, wakeAssessment: { ...wakeAssessmentState(state), commandError: undefined } }
  if (continuationCommands.has(command)) return { ...state, continuation: { ...continuationState(state), commandError: undefined } }
  if (wakeScheduleCommands.has(command)) return { ...state, wakeSchedules: { ...wakeSchedulesState(state), commandError: undefined } }
  if (wakeSchedulerCommands.has(command)) return { ...state, wakeScheduler: { ...wakeSchedulerState(state), commandError: undefined } }
  if (reasoningProviderCommands.has(command)) return { ...state, reasoningProvider: { ...reasoningProviderState(state), commandError: undefined } }
  if (researchCommands.has(command)) return { ...state, research: { ...researchState(state), commandError: undefined } }
  return { ...state, runtimeCommandError: undefined }
}

function applyNamedRuntimeCommand(state: UiState, runtime: RuntimeClient, command: string, args: string[]): Promise<UiState> {
  const commandState = { ...state, lastCommand: command }
  switch (command) {
    case "stage":
      return Promise.resolve(stageSuggestedOperatorCommand(commandState, args))
    case "stage-command":
      return Promise.resolve(stageExplicitOperatorCommand(commandState, args))
    case "clear-stage":
      return Promise.resolve(clearStagedOperatorCommand(commandState))
    case "stage-preview":
      return Promise.resolve(previewStagedOperatorCommand(commandState))
    case "run-staged":
    case "execute-staged":
      return runStagedOperatorCommand(commandState, runtime)
    case "authority":
    case "authority-summary":
    case "command-authority":
    case "command-map":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-command-authority-summary" })
        .then((next) => applyRuntimeUiEffect(next, runtime, { type: "load-command-authority-list", limit: 20 }))
    case "authority-list":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-command-authority-list", ...authorityListArgs(args) })
    case "authority-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-command-authority-record", command: requiredRest(args, 0, "slashCommand") })
    case "authority-profile":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-command-authority-validation-profile", command: requiredRest(args, 0, "slashCommand") })
    case "apis":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-external-api-connectors", limit: EXTERNAL_API_LIMIT })
    case "api":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-external-api-connector", connectorId: requiredArg(args, 0, "connectorId") })
    case "api-preview":
      return applyRuntimeUiEffect(commandState, runtime, externalApiRequestEffect("preview-external-api-request", args))
    case "api-call":
      return applyRuntimeUiEffect(commandState, runtime, externalApiRequestEffect("execute-external-api-request", args))
    case "api-dry-run": {
      const effect = externalApiExecuteEffect(args)
      return applyRuntimeUiEffect(commandState, runtime, { ...effect, dryRun: true })
    }
    case "api-audit":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-external-api-audit", limit: EXTERNAL_API_LIMIT })
    case "api-ingest-preview":
      return applyRuntimeUiEffect(commandState, runtime, externalApiResearchIngestionEffect("preview-external-api-research-ingestion", args))
    case "api-ingest":
      return applyRuntimeUiEffect(commandState, runtime, externalApiResearchIngestionEffect("execute-external-api-research-ingestion", args))
    case "api-ingest-dry-run": {
      const effect = externalApiResearchExecuteIngestionEffect(args)
      return applyRuntimeUiEffect(commandState, runtime, { ...effect, dryRun: true })
    }
    case "api-ingestions":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-external-api-research-ingestions", limit: EXTERNAL_API_LIMIT })
    case "synthesize-preview":
      return applyRuntimeUiEffect(commandState, runtime, synthesisEffect("preview-research-synthesis", args))
    case "synthesize":
      return applyRuntimeUiEffect(commandState, runtime, synthesisEffect("execute-research-synthesis", args))
    case "synthesize-proposals": {
      const effect = synthesisEffect("execute-research-synthesis", args)
      if (effect.type !== "execute-research-synthesis") throw new Error("research synthesis execute effect is required")
      return applyRuntimeUiEffect(commandState, runtime, { ...effect, createProposals: true })
    }
    case "syntheses":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-research-syntheses", limit: SYNTHESIS_LIMIT })
    case "synthesis":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-research-synthesis", synthesisId: requiredArg(args, 0, "synthesisId") })
    case "cycle-preview":
      return applyRuntimeUiEffect(commandState, runtime, commanderCycleEffect("preview-commander-cycle", args))
    case "cycle":
      return applyRuntimeUiEffect(commandState, runtime, commanderCycleEffect("execute-commander-cycle", args))
    case "cycle-proposals": {
      const effect = commanderCycleEffect("execute-commander-cycle", args)
      if (effect.type !== "execute-commander-cycle") throw new Error("commander cycle execute effect is required")
      return applyRuntimeUiEffect(commandState, runtime, { ...effect, createProposals: true })
    }
    case "cycle-bundle": {
      const effect = commanderCycleEffect("execute-commander-cycle", args)
      if (effect.type !== "execute-commander-cycle") throw new Error("commander cycle execute effect is required")
      return applyRuntimeUiEffect(commandState, runtime, { ...effect, createProposals: true, createBundle: true })
    }
    case "cycles":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-commander-cycles", limit: CYCLE_LIMIT })
    case "cycle-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-commander-cycle", cycleId: requiredArg(args, 0, "cycleId") })
    case "handoff-preview":
      return applyRuntimeUiEffect(commandState, runtime, { type: "preview-opencode-handoff", proposalId: requiredArg(args, 0, "proposalId") })
    case "handoff":
      return applyRuntimeUiEffect(commandState, runtime, { type: "execute-opencode-handoff", proposalId: requiredArg(args, 0, "proposalId") })
    case "handoff-dry-run":
      return applyRuntimeUiEffect(commandState, runtime, { type: "execute-opencode-handoff", proposalId: requiredArg(args, 0, "proposalId"), dryRun: true })
    case "handoffs":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-handoffs", limit: HANDOFF_LIMIT })
    case "handoff-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-handoff", handoffId: requiredArg(args, 0, "handoffId") })
    case "opencode-smoke-preview":
      return applyRuntimeUiEffect(commandState, runtime, { type: "preview-opencode-process-smoke" })
    case "opencode-smoke":
    case "opencode-process-smoke":
    case "opencode-health-smoke":
      return applyRuntimeUiEffect(commandState, runtime, { type: "execute-opencode-process-smoke" })
    case "opencode-smoke-dry-run":
      return applyRuntimeUiEffect(commandState, runtime, { type: "execute-opencode-process-smoke", dryRun: true })
    case "opencode-smokes":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-process-smokes", limit: HANDOFF_LIMIT })
    case "opencode-smoke-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-process-smoke", smokeId: requiredArg(args, 0, "smokeId") })
    case "handoff-readiness":
    case "opencode-handoff-readiness":
    case "handoff-ready":
      return applyRuntimeUiEffect(commandState, runtime, handoffReadinessEffect(args))
    case "handoff-readiness-summary":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-handoff-readiness-summary" })
    case "result-review-packet":
    case "opencode-result-review":
    case "executor-result-review":
    case "handoff-result-review":
      return applyRuntimeUiEffect(commandState, runtime, resultReviewPacketEffect(args))
    case "result-review-summary":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-result-review-summary" })
    case "opencode-session-preview":
    case "session-preview":
      return applyRuntimeUiEffect(commandState, runtime, opencodeSessionEffect("preview-opencode-session-plan", args, false))
    case "opencode-session-plan":
    case "session-plan":
    case "opencode-plan":
      return applyRuntimeUiEffect(commandState, runtime, opencodeSessionEffect("create-opencode-session-plan", args, true))
    case "opencode-session-plan-dry-run": {
      const effect = opencodeSessionEffect("create-opencode-session-plan", args, true) as Extract<RuntimeUiEffect, { type: "create-opencode-session-plan" }>
      return applyRuntimeUiEffect(commandState, runtime, { ...effect, dryRun: true })
    }
    case "opencode-sessions":
    case "sessions":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-sessions", limit: HANDOFF_LIMIT })
    case "opencode-session-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-session", sessionId: requiredArg(args, 0, "sessionId") })
    case "opencode-session-summary":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-session-summary" })
    case "model-capabilities":
    case "models":
      return applyRuntimeUiEffect(commandState, runtime, contextCapabilityListEffect(args))
    case "model-capability":
      return applyRuntimeUiEffect(commandState, runtime, contextCapabilityGetEffect(args))
    case "context-budget-summary":
    case "model-budget":
    case "context-budget":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-context-budget-summary" })
    case "context-budget-preview":
    case "budget-preview":
      return applyRuntimeUiEffect(commandState, runtime, contextBudgetPreviewEffect(args))
    case "context-packet-preview":
    case "packet-preview":
    case "compile-context-preview":
    case "context-compile-preview":
      return applyRuntimeUiEffect(commandState, runtime, contextPacketPreviewEffect(args))
    case "context-packet-summary":
    case "context-packets":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-context-packet-summary" })
    case "opencode-session-instruction-pack-preview":
    case "session-instruction-pack-preview":
    case "opencode-context-pack-preview":
      return applyRuntimeUiEffect(commandState, runtime, opencodeSessionInstructionPackEffect("preview-opencode-session-instruction-pack", args, true))
    case "opencode-session-instruction-pack-dry-run":
    case "session-instruction-pack-dry-run": {
      const effect = opencodeSessionInstructionPackEffect("write-opencode-session-instruction-pack", args, true) as Extract<RuntimeUiEffect, { type: "write-opencode-session-instruction-pack" }>
      return applyRuntimeUiEffect(commandState, runtime, { ...effect, dryRun: true })
    }
    case "opencode-session-instruction-pack-write":
    case "session-instruction-pack-write":
    case "opencode-context-pack-write":
      return applyRuntimeUiEffect(commandState, runtime, opencodeSessionInstructionPackEffect("write-opencode-session-instruction-pack", args, true))
    case "opencode-session-instruction-packs":
      return applyRuntimeUiEffect(commandState, runtime, opencodeSessionInstructionPackListEffect(args))
    case "opencode-session-instruction-pack-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-session-instruction-pack", packId: requiredArg(args, 0, "packId") })
    case "opencode-launch-readiness":
    case "launch-readiness":
    case "opencode-session-launch-readiness":
    case "session-launch-readiness":
    case "launch-ready":
      return applyRuntimeUiEffect(commandState, runtime, opencodeLaunchReadinessEffect(args))
    case "opencode-launch-readiness-summary":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-launch-readiness-summary", limit: HANDOFF_LIMIT })
    case "opencode-launch-preview":
    case "launch-opencode-preview":
      return applyRuntimeUiEffect(commandState, runtime, opencodeLaunchEffect("preview-opencode-session-launch", args, true))
    case "opencode-launch-dry-run":
    case "launch-opencode-dry-run": {
      const effect = opencodeLaunchEffect("launch-opencode-session", args, true) as Extract<RuntimeUiEffect, { type: "launch-opencode-session" }>
      return applyRuntimeUiEffect(commandState, runtime, { ...effect, dryRun: true })
    }
    case "opencode-launch":
    case "launch-opencode":
    case "session-launch":
    case "opencode-session-launch":
      return applyRuntimeUiEffect(commandState, runtime, opencodeLaunchEffect("launch-opencode-session", args, true))
    case "opencode-launches":
      return applyRuntimeUiEffect(commandState, runtime, opencodeLaunchListEffect(args))
    case "opencode-launch-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-session-launch", launchId: requiredArg(args, 0, "launchId") })
    case "opencode-progress-preview":
      return applyRuntimeUiEffect(commandState, runtime, opencodeProgressEffect("preview-opencode-progress", args, "heartbeat", false))
    case "opencode-progress-dry-run": {
      const effect = opencodeProgressEffect("record-opencode-progress", args, "progress", true) as Extract<RuntimeUiEffect, { type: "record-opencode-progress" }>
      return applyRuntimeUiEffect(commandState, runtime, { ...effect, dryRun: true })
    }
    case "opencode-heartbeat":
    case "session-heartbeat":
      return applyRuntimeUiEffect(commandState, runtime, opencodeProgressEffect("record-opencode-progress", args, "heartbeat", true))
    case "opencode-progress":
    case "session-progress":
      return applyRuntimeUiEffect(commandState, runtime, opencodeProgressEffect("record-opencode-progress", args, "progress", true))
    case "opencode-blocker":
    case "session-blocker":
      return applyRuntimeUiEffect(commandState, runtime, opencodeProgressEffect("record-opencode-progress", args, "blocker", true))
    case "opencode-question":
    case "session-question":
      return applyRuntimeUiEffect(commandState, runtime, opencodeProgressEffect("record-opencode-progress", args, "question", true))
    case "opencode-progress-list":
    case "progress-list":
      return applyRuntimeUiEffect(commandState, runtime, opencodeProgressListEffect(args))
    case "opencode-progress-latest":
    case "progress-latest":
      return applyRuntimeUiEffect(commandState, runtime, opencodeProgressLatestEffect(args))
    case "opencode-progress-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-progress", progressId: requiredArg(args, 0, "progressId") })
    case "opencode-progress-summary":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-progress-summary", limit: HANDOFF_LIMIT })
    case "opencode-watchdog-preview":
    case "session-watchdog":
    case "watchdog-preview":
      return applyRuntimeUiEffect(commandState, runtime, opencodeWatchdogEffect("preview-opencode-watchdog", args, false))
    case "opencode-watchdog-dry-run": {
      const effect = opencodeWatchdogEffect("record-opencode-watchdog", args, true) as Extract<RuntimeUiEffect, { type: "record-opencode-watchdog" }>
      return applyRuntimeUiEffect(commandState, runtime, { ...effect, dryRun: true })
    }
    case "opencode-watchdog-record":
    case "watchdog-record":
      return applyRuntimeUiEffect(commandState, runtime, opencodeWatchdogEffect("record-opencode-watchdog", args, true))
    case "opencode-force-report-dry-run": {
      const effect = opencodeForcedReportEffect(args) as Extract<RuntimeUiEffect, { type: "request-opencode-forced-report" }>
      return applyRuntimeUiEffect(commandState, runtime, { ...effect, dryRun: true })
    }
    case "opencode-force-report":
    case "force-report":
    case "session-force-report":
      return applyRuntimeUiEffect(commandState, runtime, opencodeForcedReportEffect(args))
    case "opencode-watchdogs":
      return applyRuntimeUiEffect(commandState, runtime, opencodeWatchdogListEffect(args))
    case "opencode-watchdog-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-watchdog", watchdogId: requiredArg(args, 0, "watchdogId") })
    case "opencode-force-report-requests":
    case "forced-reports":
      return applyRuntimeUiEffect(commandState, runtime, opencodeForcedReportListEffect(args))
    case "opencode-force-report-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-forced-report-request", requestId: requiredArg(args, 0, "requestId") })
    case "opencode-watchdog-summary":
    case "watchdog-summary":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-watchdog-summary", limit: HANDOFF_LIMIT })
    case "opencode-ask-commander-preview":
    case "ask-commander-preview":
      return applyRuntimeUiEffect(commandState, runtime, opencodeCommanderQuestionEffect("preview-opencode-commander-question", args, false))
    case "opencode-ask-commander-dry-run":
    case "ask-commander-dry-run": {
      const effect = opencodeCommanderQuestionEffect("create-opencode-commander-question", args, true) as Extract<RuntimeUiEffect, { type: "create-opencode-commander-question" }>
      return applyRuntimeUiEffect(commandState, runtime, { ...effect, dryRun: true })
    }
    case "opencode-ask-commander":
    case "ask-commander":
    case "commander-question":
      return applyRuntimeUiEffect(commandState, runtime, opencodeCommanderQuestionEffect("create-opencode-commander-question", args, true))
    case "opencode-commander-questions":
    case "commander-questions":
      return applyRuntimeUiEffect(commandState, runtime, opencodeCommanderQuestionListEffect(args))
    case "opencode-commander-question-latest":
    case "question-latest":
      return applyRuntimeUiEffect(commandState, runtime, opencodeCommanderQuestionLatestEffect(args))
    case "opencode-commander-question-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-commander-question", questionId: requiredArg(args, 0, "questionId") })
    case "opencode-commander-question-summary":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-commander-question-summary", limit: HANDOFF_LIMIT })
    case "research-memory-summary":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-research-memory-summary" })
    case "research-memory-search":
    case "research-memory-preview":
    case "research-search":
    case "memory-search":
      return applyRuntimeUiEffect(commandState, runtime, researchMemoryRetrievalEffect(args))
    case "research-novelty-preview":
    case "novelty-preview":
    case "research-dup-check":
      return applyRuntimeUiEffect(commandState, runtime, researchNoveltyEffect(args))
    case "executor-review-preview":
    case "commander-executor-review-preview":
      return applyRuntimeUiEffect(commandState, runtime, commanderExecutorReviewEffect("preview-commander-executor-review", args))
    case "executor-review":
    case "commander-executor-review":
      return applyRuntimeUiEffect(commandState, runtime, commanderExecutorReviewEffect("execute-commander-executor-review", args))
    case "executor-review-dry-run": {
      const effect = commanderExecutorReviewEffect("execute-commander-executor-review", args) as Extract<RuntimeUiEffect, { type: "execute-commander-executor-review" }>
      return applyRuntimeUiEffect(commandState, runtime, { ...effect, dryRun: true })
    }
    case "executor-reviews":
    case "commander-executor-reviews":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-commander-executor-reviews", limit: HANDOFF_LIMIT })
    case "executor-review-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-commander-executor-review", reviewId: requiredArg(args, 0, "reviewId") })
    case "executor-review-draft-preview":
    case "executor-review-drafts":
    case "commander-executor-draft-preview":
    case "commander-executor-drafts":
      return applyRuntimeUiEffect(commandState, runtime, executorReviewProposalDraftEffect(args))
    case "executor-review-draft-summary":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-executor-review-proposal-draft-summary", limit: HANDOFF_LIMIT })
    case "executor-review-proposal-create-preview":
    case "executor-draft-create-preview":
      return applyRuntimeUiEffect(commandState, runtime, executorReviewProposalCreateEffect("preview-executor-review-proposal-create", args))
    case "executor-review-proposal-create":
    case "executor-draft-create":
    case "commander-executor-proposal-create":
      return applyRuntimeUiEffect(commandState, runtime, executorReviewProposalCreateEffect("create-executor-review-proposal", args))
    case "executor-review-proposal-create-dry-run": {
      const effect = executorReviewProposalCreateEffect("create-executor-review-proposal", args) as Extract<RuntimeUiEffect, { type: "create-executor-review-proposal" }>
      return applyRuntimeUiEffect(commandState, runtime, { ...effect, dryRun: true })
    }
    case "executor-review-proposal-creates":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-executor-review-proposal-creates", limit: HANDOFF_LIMIT })
    case "executor-review-proposal-create-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-executor-review-proposal-create", createId: requiredArg(args, 0, "createId") })
    case "executor-review-proposal-review-preview":
    case "executor-draft-review-preview":
      return applyRuntimeUiEffect(commandState, runtime, executorReviewProposalReviewRequestEffect("preview-executor-review-proposal-review-request", args))
    case "executor-review-proposal-review-request":
    case "executor-draft-review-request":
    case "commander-executor-proposal-review-request":
      return applyRuntimeUiEffect(commandState, runtime, executorReviewProposalReviewRequestEffect("request-executor-review-proposal-review", args))
    case "executor-review-proposal-review-dry-run": {
      const effect = executorReviewProposalReviewRequestEffect("request-executor-review-proposal-review", args) as Extract<RuntimeUiEffect, { type: "request-executor-review-proposal-review" }>
      return applyRuntimeUiEffect(commandState, runtime, { ...effect, dryRun: true })
    }
    case "executor-review-proposal-review-requests":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-executor-review-proposal-review-requests", limit: HANDOFF_LIMIT })
    case "executor-review-proposal-review-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-executor-review-proposal-review-request", requestGateId: requiredArg(args, 0, "requestGateId") })
    case "executor-review-proposal-review-decision-preview":
      return applyRuntimeUiEffect(commandState, runtime, executorReviewProposalReviewDecisionEffect("preview-executor-review-proposal-review-decision", args))
    case "executor-review-proposal-review-approve":
    case "executor-draft-review-approve":
    case "commander-executor-proposal-review-approve":
      return applyRuntimeUiEffect(commandState, runtime, executorReviewProposalReviewDecisionEffect("decide-executor-review-proposal-review", args, "approve"))
    case "executor-review-proposal-review-reject":
    case "executor-draft-review-reject":
    case "commander-executor-proposal-review-reject":
      return applyRuntimeUiEffect(commandState, runtime, executorReviewProposalReviewDecisionEffect("decide-executor-review-proposal-review", args, "reject"))
    case "executor-review-proposal-review-decision-dry-run": {
      const effect = executorReviewProposalReviewDecisionEffect("decide-executor-review-proposal-review", args) as Extract<RuntimeUiEffect, { type: "decide-executor-review-proposal-review" }>
      return applyRuntimeUiEffect(commandState, runtime, { ...effect, dryRun: true })
    }
    case "executor-review-proposal-review-decisions":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-executor-review-proposal-review-decisions", limit: HANDOFF_LIMIT })
    case "executor-review-proposal-review-decision-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-executor-review-proposal-review-decision", decisionGateId: requiredArg(args, 0, "decisionGateId") })
    case "executor-review-proposal-apply-readiness":
    case "executor-draft-apply-readiness":
    case "commander-executor-proposal-apply-readiness":
    case "proposal-apply-readiness":
      return applyRuntimeUiEffect(commandState, runtime, executorReviewProposalApplyReadinessEffect(args))
    case "executor-review-proposal-apply-readiness-summary":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-executor-review-proposal-apply-readiness-summary", limit: HANDOFF_LIMIT })
    case "executor-review-proposal-apply-readiness-list":
      return applyRuntimeUiEffect(commandState, runtime, executorReviewProposalApplyReadinessListEffect(args))
    case "executor-review-proposal-apply-readiness-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-executor-review-proposal-apply-readiness", readinessId: requiredArg(args, 0, "readinessId") })
    case "executor-review-proposal-narrow-apply-preview":
    case "executor-draft-narrow-apply-preview":
      return applyRuntimeUiEffect(commandState, runtime, executorReviewProposalNarrowApplyEffect("preview-executor-review-proposal-narrow-apply", args))
    case "executor-review-proposal-narrow-apply":
    case "executor-draft-narrow-apply":
    case "commander-executor-proposal-narrow-apply":
    case "proposal-narrow-apply":
      return applyRuntimeUiEffect(commandState, runtime, executorReviewProposalNarrowApplyEffect("apply-executor-review-proposal-narrow", args))
    case "executor-review-proposal-narrow-apply-dry-run": {
      const effect = executorReviewProposalNarrowApplyEffect("apply-executor-review-proposal-narrow", args) as Extract<RuntimeUiEffect, { type: "apply-executor-review-proposal-narrow" }>
      return applyRuntimeUiEffect(commandState, runtime, { ...effect, dryRun: true })
    }
    case "executor-review-proposal-narrow-applies":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-executor-review-proposal-narrow-applies", limit: HANDOFF_LIMIT })
    case "executor-review-proposal-narrow-apply-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-executor-review-proposal-narrow-apply", applyId: requiredArg(args, 0, "applyId") })
    case "handoff-followup":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-handoff-followup", handoffId: requiredArg(args, 0, "handoffId") })
    case "handoff-followups":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-handoff-followups", limit: HANDOFF_LIMIT })
    case "handoff-followup-summary":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-handoff-followup-summary" })
    case "handoff-queue":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-handoff-followup-queue", queue: readFollowupQueueArg(requiredArg(args, 0, "queue")), limit: HANDOFF_LIMIT })
    case "handoff-active":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-handoff-followup-queue", queue: "active", limit: HANDOFF_LIMIT })
    case "handoff-results":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-handoff-followup-queue", queue: "needs_result_review", limit: HANDOFF_LIMIT })
    case "handoff-failed":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-handoff-followup-queue", queue: "failed", limit: HANDOFF_LIMIT })
    case "handoff-blocked":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-handoff-followup-queue", queue: "blocked", limit: HANDOFF_LIMIT })
    case "handoff-stale":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-opencode-handoff-followup-queue", queue: "stale", limit: HANDOFF_LIMIT })
    case "checkpoint-preview": {
      const effect = checkpointEffect("preview-runtime-checkpoint", args)
      return applyRuntimeUiEffect(commandState, runtime, effect)
    }
    case "checkpoint": {
      const effect = checkpointEffect("create-runtime-checkpoint", args)
      return applyRuntimeUiEffect(commandState, runtime, effect)
    }
    case "checkpoints":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-runtime-checkpoints", limit: CHECKPOINT_LIMIT })
    case "checkpoint-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-runtime-checkpoint", checkpointId: requiredArg(args, 0, "checkpointId") })
    case "restore-preview":
    case "resume-preview":
      return applyRuntimeUiEffect(commandState, runtime, { type: "preview-checkpoint-restore", checkpointId: requiredArg(args, 0, "checkpointId") })
    case "resume-mark":
      return applyRuntimeUiEffect(commandState, runtime, { type: "mark-checkpoint-resume-anchor", checkpointId: requiredArg(args, 0, "checkpointId") })
    case "resume-anchors":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-checkpoint-resume-anchors", limit: CHECKPOINT_LIMIT })
    case "resume-anchor":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-checkpoint-resume-anchor", resumeId: requiredArg(args, 0, "resumeId") })
    case "wake-preview": {
      const target = wakeTargetArg(args, true)
      return applyRuntimeUiEffect(commandState, runtime, { type: "preview-wake-assessment", ...target })
    }
    case "wake": {
      const target = wakeTargetArg(args, false)
      if (!target.resumeId) throw new Error("wake requires resume=<resumeId>")
      return applyRuntimeUiEffect(commandState, runtime, { type: "create-wake-assessment", resumeId: target.resumeId })
    }
    case "wakes":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-assessments", limit: CHECKPOINT_LIMIT })
    case "wake-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-assessment", wakeId: requiredArg(args, 0, "wakeId") })
    case "continue-preview":
    case "cont-preview":
      return applyRuntimeUiEffect(commandState, runtime, { type: "preview-continuation-plan", wakeId: wakeIdArg(args) })
    case "continue-plan":
      return applyRuntimeUiEffect(commandState, runtime, { type: "create-continuation-plan", wakeId: wakeIdArg(args) })
    case "continue-step":
    case "cont-step":
      return applyRuntimeUiEffect(commandState, runtime, { type: "execute-continuation-step", planId: requiredArg(args, 0, "planId"), index: optionalIndexArg(args, 1) })
    case "continue-dry-run":
      return applyRuntimeUiEffect(commandState, runtime, { type: "execute-continuation-step", planId: requiredArg(args, 0, "planId"), index: optionalIndexArg(args, 1), dryRun: true })
    case "continue-pause":
      return applyRuntimeUiEffect(commandState, runtime, { type: "pause-continuation-plan", planId: requiredArg(args, 0, "planId") })
    case "continue-cancel":
      return applyRuntimeUiEffect(commandState, runtime, { type: "cancel-continuation-plan", planId: requiredArg(args, 0, "planId") })
    case "continuations":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-continuation-plans", limit: CHECKPOINT_LIMIT })
    case "continue-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-continuation-plan", planId: requiredArg(args, 0, "planId") })
    case "schedule-wake-preview":
      return applyRuntimeUiEffect(commandState, runtime, wakeScheduleEffect("preview-wake-schedule", args))
    case "schedule-wake":
      return applyRuntimeUiEffect(commandState, runtime, wakeScheduleEffect("create-wake-schedule", args))
    case "wake-schedules":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-schedules", limit: CHECKPOINT_LIMIT })
    case "wake-schedule":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-schedule", scheduleId: requiredArg(args, 0, "scheduleId") })
    case "wake-schedule-pause":
      return applyRuntimeUiEffect(commandState, runtime, { type: "pause-wake-schedule", scheduleId: requiredArg(args, 0, "scheduleId") })
    case "wake-schedule-resume":
      return applyRuntimeUiEffect(commandState, runtime, { type: "resume-wake-schedule", scheduleId: requiredArg(args, 0, "scheduleId") })
    case "wake-schedule-cancel":
      return applyRuntimeUiEffect(commandState, runtime, { type: "cancel-wake-schedule", scheduleId: requiredArg(args, 0, "scheduleId") })
    case "wake-tick-preview":
      return applyRuntimeUiEffect(commandState, runtime, { type: "preview-wake-schedule-tick" })
    case "wake-tick":
      return applyRuntimeUiEffect(commandState, runtime, { type: "execute-wake-schedule-tick" })
    case "wake-tick-dry-run":
      return applyRuntimeUiEffect(commandState, runtime, { type: "execute-wake-schedule-tick", dryRun: true })
    case "wake-ticks":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-schedule-ticks", limit: CHECKPOINT_LIMIT })
    case "wake-tick-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-schedule-tick", tickId: requiredArg(args, 0, "tickId") })
    case "scheduler-preview":
    case "wake-scheduler-preview":
      return applyRuntimeUiEffect(commandState, runtime, wakeSchedulerEffect("preview-wake-scheduler-start", args))
    case "scheduler-start":
    case "wake-scheduler-start":
      return applyRuntimeUiEffect(commandState, runtime, wakeSchedulerEffect("start-wake-scheduler", args))
    case "scheduler-stop":
    case "wake-scheduler-stop":
      return applyRuntimeUiEffect(commandState, runtime, { type: "stop-wake-scheduler", reason: args.join(" ") || undefined })
    case "scheduler-status":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-status" })
    case "scheduler-bootstrap":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-bootstrap-status" })
    case "scheduler-bootstrap-preview":
      return applyRuntimeUiEffect(commandState, runtime, { type: "preview-wake-scheduler-bootstrap" })
    case "scheduler-recovery":
    case "wake-scheduler-recovery":
    case "scheduler-recovery-preview":
      return applyRuntimeUiEffect(commandState, runtime, { type: "preview-wake-scheduler-recovery" })
    case "scheduler-recoveries":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-recoveries", limit: CHECKPOINT_LIMIT })
    case "scheduler-recovery-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-recovery", recoveryId: requiredArg(args, 0, "recoveryId") })
    case "scheduler-recovery-ack":
      return applyRuntimeUiEffect(commandState, runtime, { type: "acknowledge-wake-scheduler-recovery", recoveryId: requiredArg(args, 0, "recoveryId"), resolution: "acknowledged", reason: args.slice(1).join(" ") || undefined })
    case "scheduler-recovery-resolve":
      return applyRuntimeUiEffect(commandState, runtime, { type: "acknowledge-wake-scheduler-recovery", recoveryId: requiredArg(args, 0, "recoveryId"), resolution: "resolved", reason: args.slice(1).join(" ") || undefined })
    case "scheduler-recovery-dismiss":
      return applyRuntimeUiEffect(commandState, runtime, { type: "acknowledge-wake-scheduler-recovery", recoveryId: requiredArg(args, 0, "recoveryId"), resolution: "dismissed", reason: args.slice(1).join(" ") || undefined })
    case "scheduler-recovery-workflow-preview":
    case "wake-scheduler-recovery-workflow":
      return applyRuntimeUiEffect(commandState, runtime, { type: "preview-wake-scheduler-recovery-workflow", recoveryId: requiredArg(args, 0, "recoveryId") })
    case "scheduler-recovery-workflow":
      return applyRuntimeUiEffect(commandState, runtime, { type: "create-wake-scheduler-recovery-workflow", recoveryId: requiredArg(args, 0, "recoveryId") })
    case "scheduler-recovery-workflows":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-recovery-workflows", limit: CHECKPOINT_LIMIT })
    case "scheduler-recovery-workflow-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-recovery-workflow", workflowId: requiredArg(args, 0, "workflowId") })
    case "scheduler-recovery-workflow-verify":
      return applyRuntimeUiEffect(commandState, runtime, { type: "verify-wake-scheduler-recovery-workflow", workflowId: requiredArg(args, 0, "workflowId") })
    case "scheduler-recovery-step-done":
      return applyRuntimeUiEffect(commandState, runtime, { type: "record-wake-scheduler-recovery-workflow-step", workflowId: requiredArg(args, 0, "workflowId"), index: requiredIndex(args, 1), status: "manually_done", note: args.slice(2).join(" ") || undefined })
    case "scheduler-recovery-step-skip":
      return applyRuntimeUiEffect(commandState, runtime, { type: "record-wake-scheduler-recovery-workflow-step", workflowId: requiredArg(args, 0, "workflowId"), index: requiredIndex(args, 1), status: "skipped", note: args.slice(2).join(" ") || undefined })
    case "scheduler-recovery-step-block":
      return applyRuntimeUiEffect(commandState, runtime, { type: "record-wake-scheduler-recovery-workflow-step", workflowId: requiredArg(args, 0, "workflowId"), index: requiredIndex(args, 1), status: "blocked", note: args.slice(2).join(" ") || undefined })
    case "scheduler-recovery-workflow-cancel":
      return applyRuntimeUiEffect(commandState, runtime, { type: "cancel-wake-scheduler-recovery-workflow", workflowId: requiredArg(args, 0, "workflowId"), reason: args.slice(1).join(" ") || undefined })
    case "scheduler-audit":
    case "wake-scheduler-audit":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-audit-summary" })
        .then((withSummary) => applyRuntimeUiEffect(withSummary, runtime, { type: "load-wake-scheduler-audit-timeline", limit: CHECKPOINT_LIMIT }))
    case "scheduler-audit-summary":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-audit-summary" })
    case "scheduler-audit-timeline": {
      const query = schedulerAuditTimelineArgs(args)
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-audit-timeline", ...query })
    }
    case "scheduler-audit-chain":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-audit-chain", relatedId: requiredArg(args, 0, "relatedId") })
    case "scheduler-audit-incidents":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-audit-incidents", status: args[0] })
    case "scheduler-nav":
    case "scheduler-navigation":
    case "wake-scheduler-nav": {
      const query = schedulerNavigationArgs(args)
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-navigation-board", ...query })
    }
    case "scheduler-nav-command":
      return applyRuntimeUiEffect(commandState, runtime, { type: "preview-wake-scheduler-navigation-command", command: requiredRest(args, 0, "command") })
    case "scheduler-nav-target":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-navigation-target", targetKind: requiredArg(args, 0, "targetKind"), targetId: requiredArg(args, 1, "targetId") })
    case "scheduler-nav-stage-preview":
      return applyRuntimeUiEffect(commandState, runtime, { type: "preview-wake-scheduler-navigation-stage", command: requiredRest(args, 0, "command") })
    case "scheduler-nav-stage":
      return applyRuntimeUiEffect(commandState, runtime, { type: "stage-wake-scheduler-navigation-command", command: requiredRest(args, 0, "command") })
    case "scheduler-nav-staged":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-navigation-staged-commands", limit: CHECKPOINT_LIMIT })
    case "scheduler-nav-unstage":
      return applyRuntimeUiEffect(commandState, runtime, { type: "remove-wake-scheduler-navigation-staged-command", stagedId: requiredArg(args, 0, "stagedId") })
    case "scheduler-nav-stage-clear":
      return applyRuntimeUiEffect(commandState, runtime, { type: "clear-wake-scheduler-navigation-staged-commands", reason: args.join(" ") || undefined })
    case "scheduler-nav-run-preview":
    case "scheduler-nav-read-preview":
      return applyRuntimeUiEffect(commandState, runtime, { type: "preview-wake-scheduler-navigation-staged-read", stagedId: requiredArg(args, 0, "stagedId") })
    case "scheduler-nav-run":
    case "scheduler-nav-read":
      return applyRuntimeUiEffect(commandState, runtime, { type: "execute-wake-scheduler-navigation-staged-read", stagedId: requiredArg(args, 0, "stagedId") })
    case "scheduler-nav-run-dry-run":
      return applyRuntimeUiEffect(commandState, runtime, { type: "dry-run-wake-scheduler-navigation-staged-read", stagedId: requiredArg(args, 0, "stagedId") })
    case "scheduler-nav-runs":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-navigation-staged-read-runs", limit: CHECKPOINT_LIMIT })
    case "scheduler-nav-run-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-navigation-staged-read-run", runId: requiredArg(args, 0, "runId") })
    case "scheduler-nav-read-history":
    case "scheduler-nav-run-history": {
      const query = schedulerNavReadHistoryArgs(args)
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-navigation-staged-read-history", ...query })
    }
    case "scheduler-nav-read-compare":
    case "scheduler-nav-run-compare":
      return applyRuntimeUiEffect(commandState, runtime, { type: "compare-wake-scheduler-navigation-staged-read", stagedId: requiredArg(args, 0, "stagedId") })
    case "scheduler-nav-read-compare-runs":
      return applyRuntimeUiEffect(commandState, runtime, { type: "compare-wake-scheduler-navigation-staged-read-runs", leftRunId: requiredArg(args, 0, "leftRunId"), rightRunId: requiredArg(args, 1, "rightRunId") })
    case "scheduler-nav-read-stale": {
      const query = schedulerNavReadStaleArgs(args)
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-navigation-staged-read-stale", ...query })
    }
    case "scheduler-nav-read-group":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-navigation-staged-read-group", stagedId: requiredArg(args, 0, "stagedId") })
    case "scheduler-nav-write-preview":
    case "scheduler-write-preview":
      return applyRuntimeUiEffect(commandState, runtime, { type: "preview-wake-scheduler-navigation-write-command", command: requiredRest(args, 0, "command") })
    case "scheduler-nav-write-board":
    case "scheduler-write-board": {
      const query = schedulerNavWriteBoardArgs(args)
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-navigation-write-board", ...query })
    }
    case "scheduler-nav-write-stage-preview":
    case "scheduler-write-stage-preview":
      return applyRuntimeUiEffect(commandState, runtime, { type: "preview-wake-scheduler-navigation-write-stage", command: requiredRest(args, 0, "command") })
    case "scheduler-nav-write-stage":
    case "scheduler-write-stage":
      return applyRuntimeUiEffect(commandState, runtime, { type: "stage-wake-scheduler-navigation-write-command", command: requiredRest(args, 0, "command") })
    case "scheduler-nav-write-stage-medium":
      return applyRuntimeUiEffect(commandState, runtime, { type: "stage-wake-scheduler-navigation-write-command", command: requiredRest(args, 0, "command"), allowMediumRisk: true })
    case "scheduler-nav-write-staged":
    case "scheduler-write-staged":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-navigation-staged-write-commands", limit: CHECKPOINT_LIMIT })
    case "scheduler-nav-write-unstage":
      return applyRuntimeUiEffect(commandState, runtime, { type: "remove-wake-scheduler-navigation-staged-write-command", stagedWriteId: requiredArg(args, 0, "stagedWriteId") })
    case "scheduler-nav-write-stage-clear":
      return applyRuntimeUiEffect(commandState, runtime, { type: "clear-wake-scheduler-navigation-staged-write-commands", reason: optionalRest(args, 0) })
    case "scheduler-nav-write-run-preview":
    case "scheduler-write-run-preview":
      return applyRuntimeUiEffect(commandState, runtime, { type: "preview-wake-scheduler-navigation-write-run", stagedWriteId: requiredArg(args, 0, "stagedWriteId") })
    case "scheduler-nav-write-run":
    case "scheduler-write-run":
      return applyRuntimeUiEffect(commandState, runtime, { type: "execute-wake-scheduler-navigation-write-run", stagedWriteId: requiredArg(args, 0, "stagedWriteId") })
    case "scheduler-nav-write-run-dry-run":
      return applyRuntimeUiEffect(commandState, runtime, { type: "dry-run-wake-scheduler-navigation-write-run", stagedWriteId: requiredArg(args, 0, "stagedWriteId") })
    case "scheduler-nav-write-runs":
    case "scheduler-write-runs":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-navigation-write-runs", limit: CHECKPOINT_LIMIT })
    case "scheduler-nav-write-run-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-navigation-write-run", runId: requiredArg(args, 0, "runId") })
    case "scheduler-nav-write-run-history":
    case "scheduler-write-run-history": {
      const query = schedulerNavWriteRunHistoryArgs(args)
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-navigation-write-run-history", ...query })
    }
    case "scheduler-nav-write-run-compare":
    case "scheduler-write-run-compare":
      return applyRuntimeUiEffect(commandState, runtime, { type: "compare-wake-scheduler-navigation-write-run", stagedWriteId: requiredArg(args, 0, "stagedWriteId") })
    case "scheduler-nav-write-run-compare-runs":
      return applyRuntimeUiEffect(commandState, runtime, { type: "compare-wake-scheduler-navigation-write-run-runs", leftRunId: requiredArg(args, 0, "leftRunId"), rightRunId: requiredArg(args, 1, "rightRunId") })
    case "scheduler-nav-write-run-stale": {
      const query = schedulerNavWriteRunStaleArgs(args)
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-navigation-write-run-stale", ...query })
    }
    case "scheduler-write-run-stale": {
      const query = schedulerNavWriteRunStaleArgs(args)
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-navigation-write-run-stale", ...query })
    }
    case "scheduler-nav-write-run-group":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-navigation-write-run-group", stagedWriteId: requiredArg(args, 0, "stagedWriteId") })
    case "scheduler-nav-write-readiness":
    case "scheduler-write-readiness":
      return applyRuntimeUiEffect(commandState, runtime, { type: "preview-wake-scheduler-navigation-write-readiness", stagedWriteId: requiredArg(args, 0, "stagedWriteId") })
    case "scheduler-nav-write-approve":
    case "scheduler-write-approve":
      return applyRuntimeUiEffect(commandState, runtime, { type: "approve-wake-scheduler-navigation-staged-write", stagedWriteId: requiredArg(args, 0, "stagedWriteId"), reason: optionalRest(args, 1) })
    case "scheduler-nav-write-reject":
    case "scheduler-write-reject":
      return applyRuntimeUiEffect(commandState, runtime, { type: "reject-wake-scheduler-navigation-staged-write", stagedWriteId: requiredArg(args, 0, "stagedWriteId"), reason: optionalRest(args, 1) })
    case "scheduler-nav-write-approval-revoke":
      return applyRuntimeUiEffect(commandState, runtime, { type: "revoke-wake-scheduler-navigation-write-approval", approvalId: requiredArg(args, 0, "approvalId"), reason: optionalRest(args, 1) })
    case "scheduler-nav-write-approvals":
    case "scheduler-write-approvals":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-navigation-write-approvals", limit: CHECKPOINT_LIMIT })
    case "scheduler-nav-write-approval-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-navigation-write-approval", approvalId: requiredArg(args, 0, "approvalId") })
    case "scheduler-nav-checkpoint-run-preview":
    case "scheduler-checkpoint-run-preview":
      return applyRuntimeUiEffect(commandState, runtime, { type: "preview-wake-scheduler-navigation-checkpoint-write-run", stagedWriteId: requiredArg(args, 0, "stagedWriteId") })
    case "scheduler-nav-checkpoint-run":
    case "scheduler-checkpoint-run":
      return applyRuntimeUiEffect(commandState, runtime, { type: "execute-wake-scheduler-navigation-checkpoint-write-run", stagedWriteId: requiredArg(args, 0, "stagedWriteId") })
    case "scheduler-nav-checkpoint-run-dry-run":
      return applyRuntimeUiEffect(commandState, runtime, { type: "dry-run-wake-scheduler-navigation-checkpoint-write-run", stagedWriteId: requiredArg(args, 0, "stagedWriteId") })
    case "scheduler-nav-checkpoint-runs":
    case "scheduler-checkpoint-runs":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-navigation-checkpoint-write-runs", limit: CHECKPOINT_LIMIT })
    case "scheduler-nav-checkpoint-run-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-navigation-checkpoint-write-run", runId: requiredArg(args, 0, "runId") })
    case "scheduler-nav-checkpoint-history":
    case "scheduler-checkpoint-history": {
      const query = schedulerNavCheckpointHistoryArgs(args)
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-navigation-checkpoint-write-history", ...query })
    }
    case "scheduler-nav-checkpoint-compare":
    case "scheduler-checkpoint-compare":
      return applyRuntimeUiEffect(commandState, runtime, { type: "compare-wake-scheduler-navigation-checkpoint-write", stagedWriteId: requiredArg(args, 0, "stagedWriteId") })
    case "scheduler-nav-checkpoint-compare-runs":
      return applyRuntimeUiEffect(commandState, runtime, { type: "compare-wake-scheduler-navigation-checkpoint-write-runs", leftRunId: requiredArg(args, 0, "leftRunId"), rightRunId: requiredArg(args, 1, "rightRunId") })
    case "scheduler-nav-checkpoint-stale":
    case "scheduler-checkpoint-stale": {
      const query = schedulerNavCheckpointStaleArgs(args)
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-navigation-checkpoint-write-stale", ...query })
    }
    case "scheduler-nav-checkpoint-group":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-navigation-checkpoint-write-group", stagedWriteId: requiredArg(args, 0, "stagedWriteId") })
    case "scheduler-nav-checkpoint-approval-usage": {
      const query = schedulerNavCheckpointApprovalUsageArgs(args)
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-navigation-checkpoint-approval-usage", ...query })
    }
    case "scheduler-events":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-wake-scheduler-events", limit: CHECKPOINT_LIMIT })
    case "reasoning":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-reasoning-provider-status" })
        .then((next) => applyRuntimeUiEffect(next, runtime, { type: "load-reasoning-provider-health" }))
    case "reasoning-health":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-reasoning-provider-health" })
    case "reasoning-smoke-preview":
      return applyRuntimeUiEffect(commandState, runtime, { type: "preview-reasoning-provider-smoke", surface: optionalSurfaceArg(args) })
    case "reasoning-smoke":
      return applyRuntimeUiEffect(commandState, runtime, { type: "execute-reasoning-provider-smoke", surface: optionalSurfaceArg(args) })
    case "reasoning-smoke-dry-run":
      return applyRuntimeUiEffect(commandState, runtime, { type: "execute-reasoning-provider-smoke", surface: optionalSurfaceArg(args), dryRun: true })
    case "minimax-live-preview":
    case "reasoning-live-preview": {
      const query = minimaxLiveValidationArgs(args)
      return applyRuntimeUiEffect(commandState, runtime, { type: "preview-minimax-live-validation", ...query })
    }
    case "minimax-live-validate":
    case "reasoning-live-validate":
    case "minimax-provider-validate": {
      const query = minimaxLiveValidationArgs(args)
      return applyRuntimeUiEffect(commandState, runtime, { type: "execute-minimax-live-validation", ...query })
    }
    case "minimax-live-dry-run": {
      const query = minimaxLiveValidationArgs(args)
      return applyRuntimeUiEffect(commandState, runtime, { type: "execute-minimax-live-validation", ...query, dryRun: true })
    }
    case "minimax-live-validations":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-minimax-live-validations", limit: HANDOFF_LIMIT })
    case "minimax-live-show":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-minimax-live-validation", validationId: requiredArg(args, 0, "validationId") })
    case "status":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-runtime-status" })
    case "missions":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-recent-missions", limit: 5 })
    case "research":
      return refreshResearchRecordsOrRecordError(commandState, runtime)
    case "topics":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-research-topics", limit: RESEARCH_TOPIC_LIMIT })
    case "topic":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-research-topic-snapshot", topicId: requiredArg(args, 0, "topicId") })
    case "notes":
      return applyRuntimeUiEffect(commandState, runtime, {
        type: "search-research-notes",
        topicId: requiredArg(args, 0, "topicId"),
        query: requiredRest(args, 1, "query"),
        limit: RESEARCH_NOTE_LIMIT,
      })
    case "research-events":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-research-events", limit: RESEARCH_EVENT_LIMIT })
    case "projection":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-research-projection-status" })
    case "rebuild-projection":
      return applyRuntimeUiEffect(commandState, runtime, { type: "rebuild-research-projection" })
    case "mission":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-mission-execution-records", missionId: requiredArg(args, 0, "missionId") })
    case "claims":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-mission-claims", missionId: requiredArg(args, 0, "missionId") })
    case "progress":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-mission-progress", missionId: requiredArg(args, 0, "missionId") })
    case "results":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-mission-results", missionId: requiredArg(args, 0, "missionId") })
    case "claim":
      return applyRuntimeUiEffect(commandState, runtime, { type: "claim-mission", missionId: requiredArg(args, 0, "missionId"), executorId: requiredArg(args, 1, "executorId") })
    case "progress-add":
      return applyRuntimeUiEffect(commandState, runtime, {
        type: "record-mission-progress",
        missionId: requiredArg(args, 0, "missionId"),
        claimId: requiredArg(args, 1, "claimId"),
        message: requiredRest(args, 2, "message"),
      })
    case "result":
      return applyRuntimeUiEffect(commandState, runtime, {
        type: "submit-mission-result",
        missionId: requiredArg(args, 0, "missionId"),
        claimId: requiredArg(args, 1, "claimId"),
        summary: requiredRest(args, 2, "summary"),
      })
    case "complete":
      return applyRuntimeUiEffect(commandState, runtime, completeMissionEffect(args))
    case "fail":
      return applyRuntimeUiEffect(commandState, runtime, {
        type: "fail-mission",
        missionId: requiredArg(args, 0, "missionId"),
        reason: requiredRest(args, 1, "reason"),
      })
    case "cancel-mission":
      return applyRuntimeUiEffect(commandState, runtime, {
        type: "cancel-mission",
        missionId: requiredArg(args, 0, "missionId"),
        reason: optionalRest(args, 1),
      })
    case "release-claim":
      return applyRuntimeUiEffect(commandState, runtime, {
        type: "release-mission-claim",
        claimId: requiredArg(args, 0, "claimId"),
        reason: optionalRest(args, 1),
      })
    case "reviews":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-reviews", limit: REVIEW_LIMIT })
    case "review":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-review", reviewId: requiredArg(args, 0, "reviewId") })
    case "request-review":
      return applyRuntimeUiEffect(commandState, runtime, requestReviewEffect(args))
    case "approve":
      return applyRuntimeUiEffect(commandState, runtime, { type: "approve-review", reviewId: requiredArg(args, 0, "reviewId"), reason: optionalRest(args, 1) })
    case "reject":
      return applyRuntimeUiEffect(commandState, runtime, { type: "reject-review", reviewId: requiredArg(args, 0, "reviewId"), reason: requiredRest(args, 1, "reason") })
    case "cancel-review":
      return applyRuntimeUiEffect(commandState, runtime, { type: "cancel-review", reviewId: requiredArg(args, 0, "reviewId"), reason: optionalRest(args, 1) })
    case "proposals":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-proposals", limit: PROPOSAL_LIMIT })
    case "proposal":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-proposal", proposalId: requiredArg(args, 0, "proposalId") })
    case "proposal-review":
      return applyRuntimeUiEffect(commandState, runtime, proposalReviewEffect(args))
    case "apply-proposal":
      return applyRuntimeUiEffect(commandState, runtime, { type: "apply-proposal", proposalId: requiredArg(args, 0, "proposalId") })
    case "cancel-proposal":
      return applyRuntimeUiEffect(commandState, runtime, { type: "cancel-proposal", proposalId: requiredArg(args, 0, "proposalId"), reason: optionalRest(args, 1) })
    case "propose-progress":
      return applyRuntimeUiEffect(commandState, runtime, proposeProgressEffect(args))
    case "propose-result":
      return applyRuntimeUiEffect(commandState, runtime, proposeResultEffect(args))
    case "propose-complete":
      return applyRuntimeUiEffect(commandState, runtime, proposeCompleteEffect(args))
    case "propose-fail":
      return applyRuntimeUiEffect(commandState, runtime, proposeFailEffect(args))
    case "propose-cancel":
      return applyRuntimeUiEffect(commandState, runtime, proposeCancelEffect(args))
    case "propose-release":
      return applyRuntimeUiEffect(commandState, runtime, proposeReleaseEffect(args))
    case "bundles":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-proposal-bundles", limit: PROPOSAL_BUNDLE_LIMIT })
    case "bundle":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-proposal-bundle", bundleId: requiredArg(args, 0, "bundleId") })
    case "create-bundle":
      return applyRuntimeUiEffect(commandState, runtime, createProposalBundleEffect(args))
    case "bundle-add":
      return applyRuntimeUiEffect(commandState, runtime, { type: "add-proposal-to-bundle", bundleId: requiredArg(args, 0, "bundleId"), proposalId: requiredArg(args, 1, "proposalId") })
    case "bundle-review":
      return applyRuntimeUiEffect(commandState, runtime, { type: "request-proposal-bundle-reviews", bundleId: requiredArg(args, 0, "bundleId") })
    case "bundle-ready":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-proposal-bundle-readiness", bundleId: requiredArg(args, 0, "bundleId") })
    case "apply-bundle":
      return applyRuntimeUiEffect(commandState, runtime, { type: "apply-proposal-bundle", bundleId: requiredArg(args, 0, "bundleId") })
    case "cancel-bundle":
      return applyRuntimeUiEffect(commandState, runtime, { type: "cancel-proposal-bundle", bundleId: requiredArg(args, 0, "bundleId"), reason: optionalRest(args, 1) })
    case "playbooks":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-playbooks", limit: PLAYBOOK_LIMIT })
    case "playbook":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-playbook", playbookId: requiredArg(args, 0, "playbookId") })
    case "draft-complete":
      return applyRuntimeUiEffect(commandState, runtime, draftCompleteEffect(args))
    case "draft-result-complete":
      return applyRuntimeUiEffect(commandState, runtime, draftResultCompleteEffect(args))
    case "draft-progress":
      return applyRuntimeUiEffect(commandState, runtime, draftProgressEffect(args))
    case "draft-fail":
      return applyRuntimeUiEffect(commandState, runtime, draftFailEffect(args))
    case "draft-cancel":
      return applyRuntimeUiEffect(commandState, runtime, draftCancelEffect(args))
    case "draft-release":
      return applyRuntimeUiEffect(commandState, runtime, draftReleaseEffect(args))
    case "drafts":
    case "workbench":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-playbook-drafts", limit: WORKBENCH_DRAFT_LIMIT })
    case "draft":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-playbook-draft", draftId: requiredArg(args, 0, "draftId") })
    case "draft-ready":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-playbook-draft-readiness", draftId: requiredArg(args, 0, "draftId") })
    case "draft-review":
      return applyRuntimeUiEffect(commandState, runtime, { type: "request-playbook-draft-reviews", draftId: requiredArg(args, 0, "draftId") })
    case "cancel-draft":
      return applyRuntimeUiEffect(commandState, runtime, { type: "cancel-playbook-draft", draftId: requiredArg(args, 0, "draftId"), reason: optionalRest(args, 1) })
    case "apply-preview":
      return applyRuntimeUiEffect(commandState, runtime, commanderApplyEffect(args, false))
    case "apply-target":
      return applyRuntimeUiEffect(commandState, runtime, commanderApplyEffect(args, true))
    case "apply-partial":
      return applyRuntimeUiEffect(commandState, runtime, commanderApplyPartialEffect(args))
    case "audit":
      return args.length === 0
        ? applyRuntimeUiEffect(commandState, runtime, { type: "load-commander-audit", limit: AUDIT_LIMIT })
        : applyRuntimeUiEffect(commandState, runtime, auditChainEffect(args))
    case "audit-kind":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-commander-audit", limit: AUDIT_LIMIT, category: requiredArg(args, 0, "category") })
    case "queues":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-commander-queues", queue: "needs_review", limit: QUEUE_LIMIT })
    case "queue":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-commander-queues", queue: requiredQueueKindArg(args, 0), limit: QUEUE_LIMIT })
    case "queue-review":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-commander-queues", queue: "needs_review", limit: QUEUE_LIMIT })
    case "queue-apply":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-commander-queues", queue: "ready_to_apply", limit: QUEUE_LIMIT })
    case "queue-blocked":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-commander-queues", queue: "blocked", limit: QUEUE_LIMIT })
    case "queue-failed":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-commander-queues", queue: "failed_apply", limit: QUEUE_LIMIT })
    case "queue-applied":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-commander-queues", queue: "recently_applied", limit: QUEUE_LIMIT })
    case "queue-drafts":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-commander-queues", queue: "drafts_needing_review", limit: QUEUE_LIMIT })
    case "queue-bundles":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-commander-queues", queue: "bundles_needing_review", limit: QUEUE_LIMIT })
    case "queue-stale":
      return applyRuntimeUiEffect(commandState, runtime, { type: "load-commander-queues", queue: "stale_open", limit: QUEUE_LIMIT })
    case "open":
    case "jump":
    case "target":
      return applyRuntimeUiEffect(commandState, runtime, targetContextEffect(args, 0))
    case "open-proposal":
      return applyRuntimeUiEffect(commandState, runtime, targetContextAliasEffect("proposal", args))
    case "open-bundle":
      return applyRuntimeUiEffect(commandState, runtime, targetContextAliasEffect("bundle", args))
    case "open-draft":
      return applyRuntimeUiEffect(commandState, runtime, targetContextAliasEffect("draft", args))
    case "open-review":
      return applyRuntimeUiEffect(commandState, runtime, targetContextAliasEffect("review", args))
    case "open-mission":
      return applyRuntimeUiEffect(commandState, runtime, targetContextAliasEffect("mission", args))
    case "resume":
      return runClientCommand(state, runtime, command)
    case "new-session":
      return runClientCommand(state, runtime, command)
    case "records":
      return runClientCommand(state, runtime, command)
    case "shutdown":
      return runClientCommand(state, runtime, command)
    case "initialize":
    case "cancel":
      return Promise.resolve({ ...state, lastCommand: command, runtimeCommandError: undefined })
    default:
      throw new Error(`unknown TUI command: ${command}`)
  }
}

async function runClientCommand(state: UiState, runtime: RuntimeClient, command: string): Promise<UiState> {
  await runtime.sendCommand(command)
  return { ...state, lastCommand: command, runtimeCommandError: undefined }
}

function shouldRefreshAfterCommand(command: string): boolean {
  return ["resume", "new-session", "records"].includes(command)
}

function isOperatorActionEffect(effect: RuntimeUiEffect): boolean {
  return effect.type === "send-command" && operatorActionCommands.has(effect.command)
}

const operatorActionCommands = new Set([
  "stage",
  "stage-command",
  "clear-stage",
  "run-staged",
  "execute-staged",
  "stage-preview",
])

function isCommandAuthorityEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") {
    return effect.type.startsWith("load-command-authority")
  }
  return commandAuthorityCommands.has(effect.command)
}

const commandAuthorityCommands = new Set([
  "authority",
  "authority-summary",
  "authority-list",
  "authority-show",
  "authority-profile",
  "command-authority",
  "command-map",
])

function isResearchEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") {
    return (
      effect.type.startsWith("load-research") ||
      effect.type === "search-research-notes" ||
      effect.type === "rebuild-research-projection" ||
      effect.type === "refresh-research-records"
    )
  }
  return researchCommands.has(effect.command)
}

const researchCommands = new Set([
  "research",
  "topics",
  "topic",
  "notes",
  "research-events",
  "projection",
  "rebuild-projection",
])

function isMissionExecutionEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") {
    return missionExecutionEffectTypes.has(effect.type)
  }
  return missionExecutionCommands.has(effect.command)
}

const missionExecutionCommands = new Set([
  "mission",
  "claims",
  "progress",
  "results",
  "claim",
  "progress-add",
  "result",
  "complete",
  "fail",
  "cancel-mission",
  "release-claim",
])

const missionExecutionEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "load-mission-details",
  "load-mission-execution-records",
  "load-mission-claims",
  "load-mission-progress",
  "load-mission-results",
  "claim-mission",
  "record-mission-progress",
  "submit-mission-result",
  "complete-mission",
  "fail-mission",
  "cancel-mission",
  "release-mission-claim",
])

function isReviewEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return reviewEffectTypes.has(effect.type)
  return reviewCommands.has(effect.command)
}

const reviewCommands = new Set([
  "reviews",
  "review",
  "request-review",
  "approve",
  "reject",
  "cancel-review",
])

const reviewEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "load-reviews",
  "load-review",
  "create-review-request",
  "approve-review",
  "reject-review",
  "cancel-review",
])

function isProposalEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return proposalEffectTypes.has(effect.type)
  return proposalCommands.has(effect.command)
}

function isProposalBundleEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return proposalBundleEffectTypes.has(effect.type)
  return proposalBundleCommands.has(effect.command)
}

const proposalCommands = new Set([
  "proposals",
  "proposal",
  "proposal-review",
  "apply-proposal",
  "cancel-proposal",
  "propose-progress",
  "propose-result",
  "propose-complete",
  "propose-fail",
  "propose-cancel",
  "propose-release",
])

const proposalEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "load-proposals",
  "load-proposal",
  "create-proposal",
  "request-proposal-review",
  "apply-proposal",
  "cancel-proposal",
])

const proposalBundleCommands = new Set([
  "bundles",
  "bundle",
  "create-bundle",
  "bundle-add",
  "bundle-review",
  "bundle-ready",
  "apply-bundle",
  "cancel-bundle",
])

const proposalBundleEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "load-proposal-bundles",
  "load-proposal-bundle",
  "create-proposal-bundle",
  "add-proposal-to-bundle",
  "load-proposal-bundle-readiness",
  "request-proposal-bundle-reviews",
  "apply-proposal-bundle",
  "cancel-proposal-bundle",
])

function isPlaybookEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return playbookEffectTypes.has(effect.type)
  return playbookCommands.has(effect.command)
}

function isWorkbenchEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return workbenchEffectTypes.has(effect.type)
  return workbenchCommands.has(effect.command)
}

function isCommanderApplyEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return commanderApplyEffectTypes.has(effect.type)
  return commanderApplyCommands.has(effect.command)
}

function isCommanderAuditEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return commanderAuditEffectTypes.has(effect.type)
  return commanderAuditCommands.has(effect.command)
}

function isCommanderQueueEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return commanderQueueEffectTypes.has(effect.type)
  return commanderQueueCommands.has(effect.command)
}

function isCommanderNavigationEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return effect.type === "load-commander-target-context"
  return commanderNavigationCommands.has(effect.command)
}

function isExternalApiEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return externalApiEffectTypes.has(effect.type)
  return externalApiCommands.has(effect.command)
}

function isResearchSynthesisEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return researchSynthesisEffectTypes.has(effect.type)
  return researchSynthesisCommands.has(effect.command)
}

function isCommanderCycleEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return commanderCycleEffectTypes.has(effect.type)
  return commanderCycleCommands.has(effect.command)
}

function isOpenCodeHandoffEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return opencodeHandoffEffectTypes.has(effect.type)
  return opencodeHandoffCommands.has(effect.command)
}

function isOpenCodeProcessSmokeEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return opencodeProcessSmokeEffectTypes.has(effect.type)
  return opencodeProcessSmokeCommands.has(effect.command)
}

function isOpenCodeHandoffReadinessEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return opencodeHandoffReadinessEffectTypes.has(effect.type)
  return opencodeHandoffReadinessCommands.has(effect.command)
}

function isOpenCodeResultReviewEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return opencodeResultReviewEffectTypes.has(effect.type)
  return opencodeResultReviewCommands.has(effect.command)
}

function isOpenCodeSessionEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return opencodeSessionEffectTypes.has(effect.type)
  return opencodeSessionCommands.has(effect.command)
}

function isContextBudgetEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return contextBudgetEffectTypes.has(effect.type)
  return contextBudgetCommands.has(effect.command)
}

function isContextPacketEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return contextPacketEffectTypes.has(effect.type)
  return contextPacketCommands.has(effect.command)
}

function isOpenCodeSessionInstructionPackEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return opencodeSessionInstructionPackEffectTypes.has(effect.type)
  return opencodeSessionInstructionPackCommands.has(effect.command)
}

function isResearchMemoryEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return researchMemoryEffectTypes.has(effect.type)
  return researchMemoryCommands.has(effect.command)
}

function isCommanderExecutorReviewEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return commanderExecutorReviewEffectTypes.has(effect.type)
  return commanderExecutorReviewCommands.has(effect.command)
}

function isExecutorReviewProposalDraftEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return executorReviewProposalDraftEffectTypes.has(effect.type)
  return executorReviewProposalDraftCommands.has(effect.command)
}

function isExecutorReviewProposalCreateEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return executorReviewProposalCreateEffectTypes.has(effect.type)
  return executorReviewProposalCreateCommands.has(effect.command)
}

function isExecutorReviewProposalReviewRequestEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return executorReviewProposalReviewRequestEffectTypes.has(effect.type)
  return executorReviewProposalReviewRequestCommands.has(effect.command)
}

function isExecutorReviewProposalReviewDecisionEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return executorReviewProposalReviewDecisionEffectTypes.has(effect.type)
  return executorReviewProposalReviewDecisionCommands.has(effect.command)
}

function isExecutorReviewProposalApplyReadinessEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return executorReviewProposalApplyReadinessEffectTypes.has(effect.type)
  return executorReviewProposalApplyReadinessCommands.has(effect.command)
}

function isExecutorReviewProposalNarrowApplyEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return executorReviewProposalNarrowApplyEffectTypes.has(effect.type)
  return executorReviewProposalNarrowApplyCommands.has(effect.command)
}

function isOpenCodeFollowupEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return opencodeFollowupEffectTypes.has(effect.type)
  return opencodeFollowupCommands.has(effect.command)
}

function isRuntimeCheckpointEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return runtimeCheckpointEffectTypes.has(effect.type)
  return runtimeCheckpointCommands.has(effect.command)
}

function isRuntimeRestoreEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return runtimeRestoreEffectTypes.has(effect.type)
  return runtimeRestoreCommands.has(effect.command)
}

function isWakeAssessmentEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return wakeAssessmentEffectTypes.has(effect.type)
  return wakeAssessmentCommands.has(effect.command)
}

function isContinuationEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return continuationEffectTypes.has(effect.type)
  return continuationCommands.has(effect.command)
}

function isWakeScheduleEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return wakeScheduleEffectTypes.has(effect.type)
  return wakeScheduleCommands.has(effect.command)
}

function isWakeSchedulerEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return wakeSchedulerEffectTypes.has(effect.type)
  return wakeSchedulerCommands.has(effect.command)
}

function isReasoningProviderEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return reasoningProviderEffectTypes.has(effect.type)
  return reasoningProviderCommands.has(effect.command)
}

function isMiniMaxLiveValidationEffect(effect: RuntimeUiEffect): boolean {
  if (effect.type !== "send-command") return minimaxLiveValidationEffectTypes.has(effect.type)
  return minimaxLiveValidationCommands.has(effect.command)
}

const playbookCommands = new Set([
  "playbooks",
  "playbook",
  "draft-complete",
  "draft-result-complete",
  "draft-progress",
  "draft-fail",
  "draft-cancel",
  "draft-release",
])

const playbookEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "load-playbooks",
  "load-playbook",
  "draft-playbook",
])

const workbenchCommands = new Set([
  "drafts",
  "workbench",
  "draft",
  "draft-ready",
  "draft-review",
  "cancel-draft",
])

const workbenchEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "load-playbook-drafts",
  "load-playbook-draft",
  "load-playbook-draft-readiness",
  "request-playbook-draft-reviews",
  "cancel-playbook-draft",
])

const commanderApplyCommands = new Set([
  "apply-preview",
  "apply-target",
  "apply-partial",
])

const commanderApplyEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "commander-apply-preview",
  "commander-apply-target",
])

const commanderAuditCommands = new Set([
  "audit",
  "audit-kind",
])

const commanderAuditEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "load-commander-audit",
  "load-commander-authority-chain",
])

const commanderQueueCommands = new Set([
  "queues",
  "queue",
  "queue-review",
  "queue-apply",
  "queue-blocked",
  "queue-failed",
  "queue-applied",
  "queue-drafts",
  "queue-bundles",
  "queue-stale",
])

const commanderQueueEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "load-commander-queues",
  "load-commander-queue",
])

const commanderNavigationCommands = new Set([
  "open",
  "jump",
  "target",
  "open-proposal",
  "open-bundle",
  "open-draft",
  "open-review",
  "open-mission",
])

const externalApiCommands = new Set([
  "apis",
  "api",
  "api-preview",
  "api-call",
  "api-dry-run",
  "api-audit",
  "api-ingest-preview",
  "api-ingest",
  "api-ingest-dry-run",
  "api-ingestions",
])

const researchSynthesisCommands = new Set([
  "synthesize-preview",
  "synthesize",
  "synthesize-proposals",
  "syntheses",
  "synthesis",
])

const commanderCycleCommands = new Set([
  "cycle-preview",
  "cycle",
  "cycle-proposals",
  "cycle-bundle",
  "cycles",
  "cycle-show",
])

const opencodeHandoffCommands = new Set([
  "handoff-preview",
  "handoff",
  "handoff-dry-run",
  "handoffs",
  "handoff-show",
])

const opencodeProcessSmokeCommands = new Set([
  "opencode-smoke-preview",
  "opencode-smoke",
  "opencode-smoke-dry-run",
  "opencode-smokes",
  "opencode-smoke-show",
  "opencode-process-smoke",
  "opencode-health-smoke",
])

const opencodeHandoffReadinessCommands = new Set([
  "handoff-readiness",
  "handoff-readiness-summary",
  "opencode-handoff-readiness",
  "handoff-ready",
])

const opencodeResultReviewCommands = new Set([
  "result-review-packet",
  "result-review-summary",
  "opencode-result-review",
  "executor-result-review",
  "handoff-result-review",
])

const opencodeSessionCommands = new Set([
  "opencode-session-preview",
  "session-preview",
  "opencode-session-plan",
  "session-plan",
  "opencode-plan",
  "opencode-session-plan-dry-run",
  "opencode-sessions",
  "sessions",
  "opencode-session-show",
  "opencode-session-summary",
])

const opencodeSessionEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "preview-opencode-session-plan",
  "create-opencode-session-plan",
  "load-opencode-sessions",
  "load-opencode-session",
  "load-opencode-session-summary",
])

const contextBudgetCommands = new Set([
  "model-capabilities",
  "models",
  "model-capability",
  "context-budget-summary",
  "model-budget",
  "context-budget",
  "context-budget-preview",
  "budget-preview",
])

const contextBudgetEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "load-model-capabilities",
  "load-model-capability",
  "load-context-budget-summary",
  "preview-context-budget",
])

const contextPacketCommands = new Set([
  "context-packet-preview",
  "packet-preview",
  "compile-context-preview",
  "context-compile-preview",
  "context-packet-summary",
  "context-packets",
])

const contextPacketEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "preview-context-packet",
  "load-context-packet-summary",
])

const opencodeSessionInstructionPackCommands = new Set([
  "opencode-session-instruction-pack-preview",
  "session-instruction-pack-preview",
  "opencode-context-pack-preview",
  "opencode-session-instruction-pack-dry-run",
  "session-instruction-pack-dry-run",
  "opencode-session-instruction-pack-write",
  "session-instruction-pack-write",
  "opencode-context-pack-write",
  "opencode-session-instruction-packs",
  "opencode-session-instruction-pack-show",
])

const opencodeSessionInstructionPackEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "preview-opencode-session-instruction-pack",
  "write-opencode-session-instruction-pack",
  "load-opencode-session-instruction-packs",
  "load-opencode-session-instruction-pack",
])

const opencodeLaunchReadinessCommands = new Set([
  "opencode-launch-readiness",
  "launch-readiness",
  "opencode-session-launch-readiness",
  "session-launch-readiness",
  "launch-ready",
  "opencode-launch-readiness-summary",
])

const opencodeLaunchCommands = new Set([
  "opencode-launch-preview",
  "launch-opencode-preview",
  "opencode-launch-dry-run",
  "launch-opencode-dry-run",
  "opencode-launch",
  "launch-opencode",
  "session-launch",
  "opencode-session-launch",
  "opencode-launches",
  "opencode-launch-show",
])

const opencodeProgressCommands = new Set([
  "opencode-progress-preview",
  "opencode-progress-dry-run",
  "opencode-heartbeat",
  "session-heartbeat",
  "opencode-progress",
  "session-progress",
  "opencode-blocker",
  "session-blocker",
  "opencode-question",
  "session-question",
  "opencode-progress-list",
  "progress-list",
  "opencode-progress-latest",
  "progress-latest",
  "opencode-progress-show",
  "opencode-progress-summary",
])

const opencodeWatchdogCommands = new Set([
  "opencode-watchdog-preview",
  "session-watchdog",
  "watchdog-preview",
  "opencode-watchdog-record",
  "watchdog-record",
  "opencode-watchdog-dry-run",
  "opencode-force-report",
  "force-report",
  "session-force-report",
  "opencode-force-report-dry-run",
  "opencode-watchdogs",
  "opencode-watchdog-show",
  "opencode-force-report-requests",
  "forced-reports",
  "opencode-force-report-show",
  "opencode-watchdog-summary",
  "watchdog-summary",
])

const opencodeCommanderQuestionCommands = new Set([
  "opencode-ask-commander-preview",
  "ask-commander-preview",
  "opencode-ask-commander-dry-run",
  "ask-commander-dry-run",
  "opencode-ask-commander",
  "ask-commander",
  "commander-question",
  "opencode-commander-questions",
  "commander-questions",
  "opencode-commander-question-latest",
  "question-latest",
  "opencode-commander-question-show",
  "opencode-commander-question-summary",
])

const researchMemoryCommands = new Set([
  "research-memory-summary",
  "research-memory-search",
  "research-memory-preview",
  "research-search",
  "memory-search",
  "research-novelty-preview",
  "novelty-preview",
  "research-dup-check",
])

const researchMemoryEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "load-research-memory-summary",
  "preview-research-memory-retrieval",
  "preview-research-novelty-check",
])

const commanderExecutorReviewCommands = new Set([
  "executor-review-preview",
  "executor-review",
  "executor-review-dry-run",
  "executor-reviews",
  "executor-review-show",
  "commander-executor-review-preview",
  "commander-executor-review",
  "commander-executor-reviews",
])

const executorReviewProposalDraftCommands = new Set([
  "executor-review-draft-preview",
  "executor-review-drafts",
  "commander-executor-draft-preview",
  "commander-executor-drafts",
  "executor-review-draft-summary",
])

const executorReviewProposalCreateCommands = new Set([
  "executor-review-proposal-create-preview",
  "executor-review-proposal-create",
  "executor-review-proposal-create-dry-run",
  "executor-review-proposal-creates",
  "executor-review-proposal-create-show",
  "executor-draft-create-preview",
  "executor-draft-create",
  "commander-executor-proposal-create",
])

const executorReviewProposalReviewRequestCommands = new Set([
  "executor-review-proposal-review-preview",
  "executor-review-proposal-review-request",
  "executor-review-proposal-review-dry-run",
  "executor-review-proposal-review-requests",
  "executor-review-proposal-review-show",
  "executor-draft-review-preview",
  "executor-draft-review-request",
  "commander-executor-proposal-review-request",
])

const executorReviewProposalReviewDecisionCommands = new Set([
  "executor-review-proposal-review-decision-preview",
  "executor-review-proposal-review-approve",
  "executor-review-proposal-review-reject",
  "executor-review-proposal-review-decision-dry-run",
  "executor-review-proposal-review-decisions",
  "executor-review-proposal-review-decision-show",
  "executor-draft-review-approve",
  "executor-draft-review-reject",
  "commander-executor-proposal-review-approve",
  "commander-executor-proposal-review-reject",
])

const executorReviewProposalApplyReadinessCommands = new Set([
  "executor-review-proposal-apply-readiness",
  "executor-review-proposal-apply-readiness-summary",
  "executor-review-proposal-apply-readiness-list",
  "executor-review-proposal-apply-readiness-show",
  "executor-draft-apply-readiness",
  "commander-executor-proposal-apply-readiness",
  "proposal-apply-readiness",
])

const executorReviewProposalNarrowApplyCommands = new Set([
  "executor-review-proposal-narrow-apply-preview",
  "executor-review-proposal-narrow-apply",
  "executor-review-proposal-narrow-apply-dry-run",
  "executor-review-proposal-narrow-applies",
  "executor-review-proposal-narrow-apply-show",
  "executor-draft-narrow-apply-preview",
  "executor-draft-narrow-apply",
  "commander-executor-proposal-narrow-apply",
  "proposal-narrow-apply",
])

const opencodeFollowupCommands = new Set([
  "handoff-followup",
  "handoff-followups",
  "handoff-followup-summary",
  "handoff-queue",
  "handoff-active",
  "handoff-results",
  "handoff-failed",
  "handoff-blocked",
  "handoff-stale",
])

const runtimeCheckpointCommands = new Set([
  "checkpoint-preview",
  "checkpoint",
  "checkpoints",
  "checkpoint-show",
])

const runtimeRestoreCommands = new Set([
  "restore-preview",
  "resume-preview",
  "resume-mark",
  "resume-anchors",
  "resume-anchor",
])

const wakeAssessmentCommands = new Set([
  "wake-preview",
  "wake",
  "wakes",
  "wake-show",
])

const continuationCommands = new Set([
  "continue-preview",
  "cont-preview",
  "continue-plan",
  "continue-step",
  "cont-step",
  "continue-dry-run",
  "continue-pause",
  "continue-cancel",
  "continuations",
  "continue-show",
])

const wakeScheduleCommands = new Set([
  "schedule-wake-preview",
  "schedule-wake",
  "wake-schedules",
  "wake-schedule",
  "wake-schedule-pause",
  "wake-schedule-resume",
  "wake-schedule-cancel",
  "wake-tick-preview",
  "wake-tick",
  "wake-tick-dry-run",
  "wake-ticks",
  "wake-tick-show",
])

const wakeSchedulerCommands = new Set([
  "scheduler-preview",
  "scheduler-start",
  "scheduler-stop",
  "scheduler-status",
  "scheduler-bootstrap",
  "scheduler-bootstrap-preview",
  "scheduler-recovery",
  "scheduler-recovery-preview",
  "scheduler-recoveries",
  "scheduler-recovery-show",
  "scheduler-recovery-ack",
  "scheduler-recovery-resolve",
  "scheduler-recovery-dismiss",
  "scheduler-recovery-workflow-preview",
  "scheduler-recovery-workflow",
  "scheduler-recovery-workflows",
  "scheduler-recovery-workflow-show",
  "scheduler-recovery-workflow-verify",
  "scheduler-recovery-step-done",
  "scheduler-recovery-step-skip",
  "scheduler-recovery-step-block",
  "scheduler-recovery-workflow-cancel",
  "scheduler-audit",
  "scheduler-audit-summary",
  "scheduler-audit-timeline",
  "scheduler-audit-chain",
  "scheduler-audit-incidents",
  "scheduler-nav",
  "scheduler-navigation",
  "scheduler-nav-command",
  "scheduler-nav-target",
  "scheduler-nav-stage-preview",
  "scheduler-nav-stage",
  "scheduler-nav-staged",
  "scheduler-nav-unstage",
  "scheduler-nav-stage-clear",
  "scheduler-nav-run-preview",
  "scheduler-nav-run",
  "scheduler-nav-run-dry-run",
  "scheduler-nav-runs",
  "scheduler-nav-run-show",
  "scheduler-nav-read-preview",
  "scheduler-nav-read",
  "scheduler-nav-read-history",
  "scheduler-nav-run-history",
  "scheduler-nav-read-compare",
  "scheduler-nav-run-compare",
  "scheduler-nav-read-compare-runs",
  "scheduler-nav-read-stale",
  "scheduler-nav-read-group",
  "scheduler-nav-write-preview",
  "scheduler-nav-write-board",
  "scheduler-write-preview",
  "scheduler-write-board",
  "scheduler-nav-write-stage-preview",
  "scheduler-nav-write-stage",
  "scheduler-nav-write-stage-medium",
  "scheduler-nav-write-staged",
  "scheduler-nav-write-unstage",
  "scheduler-nav-write-stage-clear",
  "scheduler-write-stage-preview",
  "scheduler-write-stage",
  "scheduler-write-staged",
  "scheduler-nav-write-run-preview",
  "scheduler-nav-write-run",
  "scheduler-nav-write-run-dry-run",
  "scheduler-nav-write-runs",
  "scheduler-nav-write-run-show",
  "scheduler-nav-write-run-history",
  "scheduler-nav-write-run-compare",
  "scheduler-nav-write-run-compare-runs",
  "scheduler-nav-write-run-stale",
  "scheduler-nav-write-run-group",
  "scheduler-nav-write-readiness",
  "scheduler-nav-write-approve",
  "scheduler-nav-write-reject",
  "scheduler-nav-write-approval-revoke",
  "scheduler-nav-write-approvals",
  "scheduler-nav-write-approval-show",
  "scheduler-write-run-preview",
  "scheduler-write-run",
  "scheduler-write-runs",
  "scheduler-write-run-history",
  "scheduler-write-run-compare",
  "scheduler-write-run-stale",
  "scheduler-write-readiness",
  "scheduler-write-approve",
  "scheduler-write-reject",
  "scheduler-write-approvals",
  "scheduler-nav-checkpoint-history",
  "scheduler-nav-checkpoint-compare",
  "scheduler-nav-checkpoint-compare-runs",
  "scheduler-nav-checkpoint-stale",
  "scheduler-nav-checkpoint-group",
  "scheduler-nav-checkpoint-approval-usage",
  "scheduler-checkpoint-history",
  "scheduler-checkpoint-compare",
  "scheduler-checkpoint-stale",
  "scheduler-events",
  "wake-scheduler-preview",
  "wake-scheduler-start",
  "wake-scheduler-stop",
  "wake-scheduler-recovery",
  "wake-scheduler-recovery-workflow",
  "wake-scheduler-audit",
  "wake-scheduler-nav",
])

const reasoningProviderCommands = new Set([
  "reasoning",
  "reasoning-health",
  "reasoning-smoke-preview",
  "reasoning-smoke",
  "reasoning-smoke-dry-run",
])

const minimaxLiveValidationCommands = new Set([
  "minimax-live-preview",
  "minimax-live-validate",
  "minimax-live-dry-run",
  "minimax-live-validations",
  "minimax-live-show",
  "reasoning-live-preview",
  "reasoning-live-validate",
  "minimax-provider-validate",
])

const externalApiEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "load-external-api-connectors",
  "load-external-api-connector",
  "preview-external-api-request",
  "execute-external-api-request",
  "load-external-api-audit",
  "preview-external-api-research-ingestion",
  "execute-external-api-research-ingestion",
  "load-external-api-research-ingestions",
])

const researchSynthesisEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "preview-research-synthesis",
  "execute-research-synthesis",
  "load-research-synthesis",
  "load-research-syntheses",
])

const commanderCycleEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "preview-commander-cycle",
  "execute-commander-cycle",
  "load-commander-cycle",
  "load-commander-cycles",
])

const opencodeHandoffEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "preview-opencode-handoff",
  "execute-opencode-handoff",
  "load-opencode-handoff",
  "load-opencode-handoffs",
])

const opencodeProcessSmokeEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "preview-opencode-process-smoke",
  "execute-opencode-process-smoke",
  "load-opencode-process-smokes",
  "load-opencode-process-smoke",
])

const opencodeHandoffReadinessEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "preview-opencode-handoff-readiness",
  "load-opencode-handoff-readiness-summary",
])

const opencodeResultReviewEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "preview-opencode-result-review-packet",
  "load-opencode-result-review-summary",
])

const commanderExecutorReviewEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "preview-commander-executor-review",
  "execute-commander-executor-review",
  "load-commander-executor-reviews",
  "load-commander-executor-review",
])

const executorReviewProposalDraftEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "preview-executor-review-proposal-drafts",
  "load-executor-review-proposal-draft-summary",
])

const executorReviewProposalCreateEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "preview-executor-review-proposal-create",
  "create-executor-review-proposal",
  "load-executor-review-proposal-creates",
  "load-executor-review-proposal-create",
])

const executorReviewProposalReviewRequestEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "preview-executor-review-proposal-review-request",
  "request-executor-review-proposal-review",
  "load-executor-review-proposal-review-requests",
  "load-executor-review-proposal-review-request",
])

const executorReviewProposalReviewDecisionEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "preview-executor-review-proposal-review-decision",
  "decide-executor-review-proposal-review",
  "load-executor-review-proposal-review-decisions",
  "load-executor-review-proposal-review-decision",
])

const executorReviewProposalApplyReadinessEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "preview-executor-review-proposal-apply-readiness",
  "load-executor-review-proposal-apply-readiness-summary",
  "load-executor-review-proposal-apply-readiness-list",
  "load-executor-review-proposal-apply-readiness",
])

const executorReviewProposalNarrowApplyEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "preview-executor-review-proposal-narrow-apply",
  "apply-executor-review-proposal-narrow",
  "load-executor-review-proposal-narrow-applies",
  "load-executor-review-proposal-narrow-apply",
])

const opencodeFollowupEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "load-opencode-handoff-followup",
  "load-opencode-handoff-followups",
  "load-opencode-handoff-followup-summary",
  "load-opencode-handoff-followup-queue",
])

const runtimeCheckpointEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "preview-runtime-checkpoint",
  "create-runtime-checkpoint",
  "load-runtime-checkpoint",
  "load-runtime-checkpoints",
])

const runtimeRestoreEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "preview-checkpoint-restore",
  "mark-checkpoint-resume-anchor",
  "load-checkpoint-resume-anchor",
  "load-checkpoint-resume-anchors",
])

const wakeAssessmentEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "preview-wake-assessment",
  "create-wake-assessment",
  "load-wake-assessment",
  "load-wake-assessments",
])

const continuationEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "preview-continuation-plan",
  "create-continuation-plan",
  "load-continuation-plan",
  "load-continuation-plans",
  "execute-continuation-step",
  "pause-continuation-plan",
  "cancel-continuation-plan",
])

const wakeScheduleEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "preview-wake-schedule",
  "create-wake-schedule",
  "load-wake-schedule",
  "load-wake-schedules",
  "pause-wake-schedule",
  "resume-wake-schedule",
  "cancel-wake-schedule",
  "preview-wake-schedule-tick",
  "execute-wake-schedule-tick",
  "load-wake-schedule-ticks",
  "load-wake-schedule-tick",
])

const wakeSchedulerEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "preview-wake-scheduler-start",
  "start-wake-scheduler",
  "stop-wake-scheduler",
  "load-wake-scheduler-status",
  "load-wake-scheduler-bootstrap-status",
  "preview-wake-scheduler-bootstrap",
  "preview-wake-scheduler-recovery",
  "load-wake-scheduler-recoveries",
  "load-wake-scheduler-recovery",
  "acknowledge-wake-scheduler-recovery",
  "preview-wake-scheduler-recovery-workflow",
  "create-wake-scheduler-recovery-workflow",
  "load-wake-scheduler-recovery-workflows",
  "load-wake-scheduler-recovery-workflow",
  "verify-wake-scheduler-recovery-workflow",
  "record-wake-scheduler-recovery-workflow-step",
  "cancel-wake-scheduler-recovery-workflow",
  "load-wake-scheduler-audit-summary",
  "load-wake-scheduler-audit-timeline",
  "load-wake-scheduler-audit-chain",
  "load-wake-scheduler-audit-incidents",
  "load-wake-scheduler-navigation-board",
  "preview-wake-scheduler-navigation-command",
  "load-wake-scheduler-navigation-target",
  "preview-wake-scheduler-navigation-stage",
  "stage-wake-scheduler-navigation-command",
  "load-wake-scheduler-navigation-staged-commands",
  "remove-wake-scheduler-navigation-staged-command",
  "clear-wake-scheduler-navigation-staged-commands",
  "preview-wake-scheduler-navigation-staged-read",
  "execute-wake-scheduler-navigation-staged-read",
  "dry-run-wake-scheduler-navigation-staged-read",
  "load-wake-scheduler-navigation-staged-read-runs",
  "load-wake-scheduler-navigation-staged-read-run",
  "load-wake-scheduler-navigation-staged-read-history",
  "compare-wake-scheduler-navigation-staged-read",
  "compare-wake-scheduler-navigation-staged-read-runs",
  "load-wake-scheduler-navigation-staged-read-stale",
  "load-wake-scheduler-navigation-staged-read-group",
  "preview-wake-scheduler-navigation-write-command",
  "load-wake-scheduler-navigation-write-board",
  "preview-wake-scheduler-navigation-write-stage",
  "stage-wake-scheduler-navigation-write-command",
  "load-wake-scheduler-navigation-staged-write-commands",
  "load-wake-scheduler-navigation-staged-write-command",
  "remove-wake-scheduler-navigation-staged-write-command",
  "clear-wake-scheduler-navigation-staged-write-commands",
  "preview-wake-scheduler-navigation-write-run",
  "execute-wake-scheduler-navigation-write-run",
  "dry-run-wake-scheduler-navigation-write-run",
  "load-wake-scheduler-navigation-write-runs",
  "load-wake-scheduler-navigation-write-run",
  "load-wake-scheduler-navigation-write-run-history",
  "compare-wake-scheduler-navigation-write-run",
  "compare-wake-scheduler-navigation-write-run-runs",
  "load-wake-scheduler-navigation-write-run-stale",
  "load-wake-scheduler-navigation-write-run-group",
  "preview-wake-scheduler-navigation-write-readiness",
  "approve-wake-scheduler-navigation-staged-write",
  "reject-wake-scheduler-navigation-staged-write",
  "revoke-wake-scheduler-navigation-write-approval",
  "load-wake-scheduler-navigation-write-approvals",
  "load-wake-scheduler-navigation-write-approval",
  "preview-wake-scheduler-navigation-checkpoint-write-run",
  "execute-wake-scheduler-navigation-checkpoint-write-run",
  "dry-run-wake-scheduler-navigation-checkpoint-write-run",
  "load-wake-scheduler-navigation-checkpoint-write-runs",
  "load-wake-scheduler-navigation-checkpoint-write-run",
  "load-wake-scheduler-navigation-checkpoint-write-history",
  "compare-wake-scheduler-navigation-checkpoint-write",
  "compare-wake-scheduler-navigation-checkpoint-write-runs",
  "load-wake-scheduler-navigation-checkpoint-write-stale",
  "load-wake-scheduler-navigation-checkpoint-write-group",
  "load-wake-scheduler-navigation-checkpoint-approval-usage",
  "load-wake-scheduler-events",
])

const reasoningProviderEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "load-reasoning-provider-status",
  "load-reasoning-provider-health",
  "preview-reasoning-provider-smoke",
  "execute-reasoning-provider-smoke",
])

const minimaxLiveValidationEffectTypes = new Set<RuntimeUiEffect["type"]>([
  "preview-minimax-live-validation",
  "execute-minimax-live-validation",
  "load-minimax-live-validations",
  "load-minimax-live-validation",
])

function applyRuntimeStatus(state: UiState, value: unknown): UiState {
  if (!isRecord(value)) throw new Error("runtime.status returned non-object result")
  const runtimeStatus: RuntimeStatusSummary = {
    runtimeStatus: readString(value.runtimeStatus, "unknown"),
    mode: readString(value.mode, "unknown"),
    projectName: readString(value.projectName, state.header.projectName),
    specApproved: readBoolean(value.specApproved),
    lockHeld: readBoolean(value.lockHeld),
  }
  const researchProjection = readResearchProjection(value.researchProjection)
  const missions = readMissionSummary(value.missions, state.missions?.recent ?? [])
  const reviewSummary = readReviewSummary(value.reviews)
  const proposalSummary = readProposalSummary(value.proposals)
  const proposalBundleSummary = readProposalBundleSummary(value.proposalBundles)
  const workbenchSummary = readWorkbenchSummary(value.playbookDrafts)
  const reasoningProvider = readReasoningProviderStatus(value.reasoningProvider)
  const wakeScheduler = readRuntimeStatusWakeScheduler(value.wakeScheduler)
  return {
    ...state,
    runtimeStatus,
    adapterStatus: isRecord(value.adapterStatus) ? redactUnknown(value.adapterStatus) : state.adapterStatus,
    reasoningProvider: reasoningProvider ? { ...reasoningProviderState(state), ...reasoningProvider } : state.reasoningProvider,
    researchProjection: researchProjection ?? state.researchProjection,
    missions: missions ?? state.missions,
    reviews: reviewSummary ? { ...reviewsState(state), summary: reviewSummary } : state.reviews,
    proposals: proposalSummary ? { ...proposalsState(state), summary: proposalSummary } : state.proposals,
    proposalBundles: proposalBundleSummary ? { ...proposalBundlesState(state), summary: proposalBundleSummary } : state.proposalBundles,
    commanderWorkbench: workbenchSummary ? { ...commanderWorkbenchState(state), summary: workbenchSummary } : state.commanderWorkbench,
    wakeScheduler: wakeScheduler ? { ...wakeSchedulerState(state), ...wakeScheduler, commandError: undefined } : state.wakeScheduler,
    runtimeCommandError: undefined,
    header: {
      ...state.header,
      projectName: runtimeStatus.projectName,
      runtimeStatus: runtimeStatus.runtimeStatus,
      activeMissionId: missions?.last_mission_id ?? state.header.activeMissionId,
    },
  }
}

function readRuntimeStatusWakeScheduler(value: unknown): Pick<WakeSchedulerUiState, "status" | "bootstrapStatus" | "recoveryPreview"> | null {
  if (!isRecord(value)) return null
  const status = isRecord(value.status) ? readWakeSchedulerState(value.status) : null
  const bootstrapStatus = isRecord(value.bootstrap) ? readWakeSchedulerBootstrapStatus(value.bootstrap, "runtime.status.wakeScheduler.bootstrap") : null
  const recoveryPreview = isRecord(value.recovery) ? readWakeSchedulerRecoveryPreview(value.recovery, "runtime.status.wakeScheduler.recovery") : null
  if (!status && !bootstrapStatus && !recoveryPreview) return null
  return {
    status,
    bootstrapStatus,
    recoveryPreview,
  }
}

function applyReasoningProviderStatus(state: UiState, value: unknown): UiState {
  const reasoningProvider = readReasoningProviderStatus(value)
  if (!reasoningProvider) throw new Error("runtime.reasoning_provider_status returned invalid result")
  return {
    ...state,
    reasoningProvider: { ...reasoningProviderState(state), ...reasoningProvider, commandError: undefined },
    runtimeCommandError: undefined,
  }
}

function applyReasoningProviderHealth(state: UiState, value: unknown): UiState {
  const health = readReasoningProviderHealth(value)
  if (!health) throw new Error("runtime.reasoning_provider_health returned invalid result")
  return {
    ...state,
    reasoningProvider: {
      ...reasoningProviderState(state),
      kind: health.kind,
      provider_id: health.provider_id,
      connector_id: health.connector_id,
      model: health.model,
      max_input_bytes: health.max_input_bytes,
      max_output_bytes: health.max_output_bytes,
      timeout_ms: health.timeout_ms,
      enabled_for: health.enabled_for,
      health,
      commandError: undefined,
    },
    runtimeCommandError: undefined,
  }
}

function applyReasoningProviderSmokePreview(state: UiState, value: unknown): UiState {
  const smokePreview = readReasoningProviderSmokePreview(value)
  if (!smokePreview) throw new Error("runtime.preview_reasoning_provider_smoke returned invalid result")
  return {
    ...state,
    reasoningProvider: {
      ...reasoningProviderState(state),
      kind: smokePreview.kind,
      provider_id: smokePreview.provider_id,
      connector_id: smokePreview.connector_id,
      model: smokePreview.model,
      max_input_bytes: state.reasoningProvider?.max_input_bytes ?? 0,
      max_output_bytes: smokePreview.max_output_bytes,
      enabled_for: state.reasoningProvider?.enabled_for ?? [],
      smokePreview,
      commandError: undefined,
    },
    runtimeCommandError: undefined,
  }
}

function applyReasoningProviderSmokeResult(state: UiState, value: unknown): UiState {
  const lastSmoke = readReasoningProviderSmokeResult(value)
  if (!lastSmoke) throw new Error("runtime.execute_reasoning_provider_smoke returned invalid result")
  return {
    ...state,
    reasoningProvider: {
      ...reasoningProviderState(state),
      kind: lastSmoke.kind,
      provider_id: lastSmoke.provider_id,
      connector_id: lastSmoke.connector_id,
      model: lastSmoke.model,
      max_input_bytes: state.reasoningProvider?.max_input_bytes ?? 0,
      max_output_bytes: state.reasoningProvider?.max_output_bytes ?? 0,
      enabled_for: state.reasoningProvider?.enabled_for ?? [],
      lastSmoke,
      commandError: undefined,
    },
    runtimeCommandError: undefined,
  }
}

function applyMiniMaxLiveValidationPreview(state: UiState, value: unknown): UiState {
  const preview = readMiniMaxLiveValidationPreview(value)
  if (!preview) throw new Error("runtime.preview_minimax_live_validation returned invalid result")
  return {
    ...state,
    minimaxLiveValidation: {
      ...minimaxLiveValidationState(state),
      preview,
      commandError: undefined,
    },
    runtimeCommandError: undefined,
    systemActions: [...state.systemActions, { title: "minimax live validation preview", detail: `status=${preview.status}`, status: preview.can_execute ? "ready" : "blocked" }].slice(-12),
  }
}

function applyMiniMaxLiveValidationResult(state: UiState, value: unknown, validationId?: string): UiState {
  const result = readMiniMaxLiveValidationResult(value)
  if (!result && value !== null) throw new Error("runtime.get_minimax_live_validation returned invalid result")
  const current = minimaxLiveValidationState(state)
  return {
    ...state,
    minimaxLiveValidation: {
      ...current,
      latestResult: result ?? current.latestResult ?? null,
      selected: result ?? (validationId ? null : current.selected ?? null),
      records: result && result.status !== "skipped" ? [recordFromMiniMaxLiveValidationResult(result), ...current.records.filter((item) => item.validation_id !== result.validation_id)].slice(0, HANDOFF_LIMIT) : current.records,
      commandError: result?.error ?? undefined,
    },
    runtimeCommandError: undefined,
    systemActions: [...state.systemActions, { title: "minimax live validation result", detail: `validation_id=${result?.validation_id ?? validationId ?? "none"}`, status: result?.status ?? "missing" }].slice(-12),
  }
}

function applyMiniMaxLiveValidationRecords(state: UiState, value: unknown, limit: number, options: { preserveCommandError?: boolean } = {}): UiState {
  const records = readMiniMaxLiveValidationRecordList(value, "runtime.list_minimax_live_validations", limit)
  const current = minimaxLiveValidationState(state)
  return {
    ...state,
    minimaxLiveValidation: {
      ...current,
      records,
      commandError: options.preserveCommandError ? current.commandError : undefined,
    },
    runtimeCommandError: undefined,
    systemActions: [...state.systemActions, { title: "minimax live validation records", detail: `records=${records.length}`, status: "loaded" }].slice(-12),
  }
}

function applyRecentMissions(state: UiState, value: unknown): UiState {
  if (!Array.isArray(value)) throw new Error("runtime.list_recent_missions returned non-array result")
  const recent = value.map(readMissionRecord).filter((mission): mission is MissionRecord => mission !== null)
  const current = state.missions ?? {
    pending_count: 0,
    failed_count: 0,
    active_claim_count: 0,
    completed_count: 0,
    cancelled_count: 0,
    recent: [],
  }
  return {
    ...state,
    missions: {
      ...current,
      last_mission_id: recent[0]?.mission_id ?? current.last_mission_id,
      recent,
    },
    runtimeCommandError: state.lastCommand === "missions" ? undefined : state.runtimeCommandError,
    header: {
      ...state.header,
      activeMissionId: recent[0]?.mission_id ?? current.last_mission_id ?? state.header.activeMissionId,
    },
  }
}

function applyCommandAuthoritySummary(state: UiState, value: unknown): UiState {
  return {
    ...state,
    commandAuthority: {
      ...commandAuthorityState(state),
      summary: readCommandAuthoritySummary(value),
      commandError: undefined,
    },
    runtimeCommandError: undefined,
  }
}

function applyCommandAuthorityRecords(state: UiState, value: unknown, limit: number): UiState {
  if (!Array.isArray(value)) throw new Error("runtime.command_authority_list returned non-array result")
  return {
    ...state,
    commandAuthority: {
      ...commandAuthorityState(state),
      records: value.map(readCommandAuthorityRecord).filter((record): record is CommandAuthorityRecordSummary => record !== null).slice(0, limit),
      commandError: undefined,
    },
    runtimeCommandError: undefined,
  }
}

function applyCommandAuthorityRecord(state: UiState, value: unknown): UiState {
  const selected = readCommandAuthorityRecord(value)
  if (!selected) throw new Error("runtime.command_authority_get returned invalid record")
  return {
    ...state,
    commandAuthority: {
      ...commandAuthorityState(state),
      selected,
      commandError: undefined,
    },
    runtimeCommandError: undefined,
    systemActions: [...state.systemActions, { title: "command authority selected", detail: `${selected.slash_command} risk=${selected.risk} gate=${selected.gate}`, status: selected.current_phase_status }].slice(-12),
  }
}

function applyCommandAuthorityValidationProfile(state: UiState, value: unknown): UiState {
  return {
    ...state,
    commandAuthority: {
      ...commandAuthorityState(state),
      validationProfile: readCommandAuthorityValidationProfile(value),
      commandError: undefined,
    },
    runtimeCommandError: undefined,
  }
}

function applySelectedReview(state: UiState, value: unknown, reviewId: string | undefined): UiState {
  const review = readReview(value)
  if (!review && value !== null) throw new Error("runtime.get_review_request returned invalid review")
  const selectedReviewId = review?.review_id ?? (reviewId ? redactText(reviewId) : undefined)
  return {
    ...state,
    reviews: {
      ...reviewsState(state),
      selectedReview: review,
      recent: review ? [review, ...reviewsState(state).recent.filter((item) => item.review_id !== review.review_id)].slice(0, REVIEW_LIMIT) : reviewsState(state).recent,
      commandError: undefined,
    },
    systemActions: selectedReviewId
      ? [...state.systemActions, { title: "review selected", detail: `review_id=${selectedReviewId}`, status: review?.status }].slice(-12)
      : state.systemActions,
  }
}

function applySelectedProposal(state: UiState, value: unknown, proposalId: string | undefined): UiState {
  const proposal = readProposal(value)
  if (!proposal && value !== null) throw new Error("runtime.get_commander_proposal returned invalid proposal")
  const selectedProposalId = proposal?.proposal_id ?? (proposalId ? redactText(proposalId) : undefined)
  return {
    ...state,
    proposals: {
      ...proposalsState(state),
      selectedProposal: proposal,
      recent: proposal ? [proposal, ...proposalsState(state).recent.filter((item) => item.proposal_id !== proposal.proposal_id)].slice(0, PROPOSAL_LIMIT) : proposalsState(state).recent,
      commandError: undefined,
    },
    systemActions: selectedProposalId
      ? [...state.systemActions, { title: "proposal selected", detail: `proposal_id=${selectedProposalId}`, status: proposal?.status }].slice(-12)
      : state.systemActions,
  }
}

function applySelectedProposalBundle(state: UiState, value: unknown, bundleId: string | undefined): UiState {
  const bundle = readProposalBundle(value)
  if (!bundle && value !== null) throw new Error("runtime.get_proposal_bundle returned invalid proposal bundle")
  const selectedBundleId = bundle?.bundle_id ?? (bundleId ? redactText(bundleId) : undefined)
  return {
    ...state,
    proposalBundles: {
      ...proposalBundlesState(state),
      selectedBundle: bundle,
      recent: bundle ? [bundle, ...proposalBundlesState(state).recent.filter((item) => item.bundle_id !== bundle.bundle_id)].slice(0, PROPOSAL_BUNDLE_LIMIT) : proposalBundlesState(state).recent,
      commandError: undefined,
    },
    systemActions: selectedBundleId
      ? [...state.systemActions, { title: "proposal bundle selected", detail: `bundle_id=${selectedBundleId}`, status: bundle?.status }].slice(-12)
      : state.systemActions,
  }
}

function applyPlaybookCatalog(state: UiState, value: unknown, limit: number): UiState {
  if (!Array.isArray(value)) throw new Error("runtime.list_commander_playbooks returned non-array result")
  return {
    ...state,
    commanderPlaybooks: {
      ...commanderPlaybooksState(state),
      catalog: value.map(readPlaybook).filter((playbook): playbook is CommanderPlaybookSummary => playbook !== null).slice(0, limit),
      commandError: state.lastCommand === "playbooks" ? undefined : state.commanderPlaybooks?.commandError,
    },
  }
}

function applySelectedPlaybook(state: UiState, value: unknown, playbookId: string): UiState {
  const playbook = readPlaybook(value)
  if (!playbook && value !== null) throw new Error("runtime.get_commander_playbook returned invalid playbook")
  const selectedPlaybookId = playbook?.playbook_id ?? redactText(playbookId)
  return {
    ...state,
    commanderPlaybooks: {
      ...commanderPlaybooksState(state),
      selectedPlaybook: playbook,
      catalog: playbook ? [playbook, ...commanderPlaybooksState(state).catalog.filter((item) => item.playbook_id !== playbook.playbook_id)].slice(0, PLAYBOOK_LIMIT) : commanderPlaybooksState(state).catalog,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "playbook selected", detail: `playbook_id=${selectedPlaybookId}` }].slice(-12),
  }
}

function applyPlaybookDraft(state: UiState, value: unknown): UiState {
  const draft = readPlaybookDraft(value)
  return {
    ...state,
    commanderPlaybooks: {
      ...commanderPlaybooksState(state),
      lastDraft: draft,
      commandError: undefined,
    },
    systemActions: [
      ...state.systemActions,
      {
        title: "playbook drafted",
        detail: `draft_id=${draft.draft_id ?? "none"} playbook_id=${draft.playbook_id} proposals=${draft.proposal_ids.join(",") || "none"} bundle=${draft.bundle_id ?? "none"}`,
        status: "proposed",
      },
    ].slice(-12),
  }
}

function applySelectedWorkbenchDraft(state: UiState, value: unknown, draftId: string): UiState {
  const draft = readWorkbenchDraft(value)
  if (!draft && value !== null) throw new Error("runtime.get_commander_playbook_draft returned invalid draft")
  const selectedDraftId = draft?.draft_id ?? redactText(draftId)
  return {
    ...state,
    commanderWorkbench: {
      ...commanderWorkbenchState(state),
      selectedDraft: draft,
      drafts: draft ? [draft, ...commanderWorkbenchState(state).drafts.filter((item) => item.draft_id !== draft.draft_id)].slice(0, WORKBENCH_DRAFT_LIMIT) : commanderWorkbenchState(state).drafts,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "playbook draft selected", detail: `draft_id=${selectedDraftId}`, status: draft?.status }].slice(-12),
  }
}

function applyCommanderApplyPreview(state: UiState, value: unknown): UiState {
  const preview = readCommanderApplyPreview(value)
  return {
    ...state,
    commanderApply: {
      ...commanderApplyState(state),
      preview,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "commander apply preview", detail: `${preview.target_type}:${preview.target_id}`, status: preview.ready_to_apply ? "ready" : "blocked" }].slice(-12),
  }
}

function applyCommanderApplyResult(state: UiState, value: unknown): UiState {
  const result = readCommanderApplyResult(value)
  return {
    ...state,
    commanderApply: {
      ...commanderApplyState(state),
      lastResult: result,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "commander apply result", detail: `${result.target_type}:${result.target_id}`, status: result.applied ? "applied" : "skipped" }].slice(-12),
  }
}

function applyCommanderAuditTimeline(state: UiState, value: unknown): UiState {
  const timeline = readCommanderAuditTimeline(value)
  return {
    ...state,
    commanderAudit: {
      ...commanderAuditState(state),
      timeline,
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "commander audit timeline", detail: `events=${timeline.length}`, status: "loaded" }].slice(-12),
  }
}

function applyCommanderAuthorityChain(state: UiState, value: unknown, targetType: string, targetId: string): UiState {
  const chain = readCommanderAuthorityChain(value)
  return {
    ...state,
    commanderAudit: {
      ...commanderAuditState(state),
      selectedChain: chain,
      lastTargetType: redactText(targetType),
      lastTargetId: redactText(targetId),
      commandError: undefined,
    },
    systemActions: [...state.systemActions, { title: "commander authority chain", detail: `${chain.target_type}:${chain.target_id}`, status: chain.events.length > 0 ? "loaded" : "empty" }].slice(-12),
  }
}

function applyMissionDetails(state: UiState, value: unknown, missionId: string): UiState {
  const selectedMissionId = redactText(missionId)
  const previous = missionExecutionState(state)
  const sameTarget = previous.selectedMissionId === selectedMissionId
  return {
    ...state,
    missionExecution: {
      ...previous,
      selectedMissionId,
      selectedMission: readMissionRecord(value),
      selectedClaimId: sameTarget ? previous.selectedClaimId : undefined,
      selectedResultId: sameTarget ? previous.selectedResultId : undefined,
      claims: sameTarget ? previous.claims : [],
      progress: sameTarget ? previous.progress : [],
      results: sameTarget ? previous.results : [],
      commandError: undefined,
    },
    header: {
      ...state.header,
      activeMissionId: selectedMissionId,
    },
  }
}

function applyMissionClaims(state: UiState, value: unknown, missionId: string): UiState {
  if (!Array.isArray(value)) throw new Error("runtime.list_mission_claims returned non-array result")
  const selectedMissionId = redactText(missionId)
  const previous = missionExecutionState(state)
  const sameTarget = previous.selectedMissionId === selectedMissionId
  return {
    ...state,
    missionExecution: {
      ...previous,
      selectedMissionId,
      selectedMission: selectedMissionForTarget(state, selectedMissionId),
      selectedClaimId: sameTarget ? previous.selectedClaimId : undefined,
      selectedResultId: sameTarget ? previous.selectedResultId : undefined,
      claims: value.map(readExecutorClaim).filter((claim): claim is ExecutorClaimSummary => claim !== null).slice(0, MISSION_EXECUTION_LIMIT),
      progress: sameTarget ? previous.progress : [],
      results: sameTarget ? previous.results : [],
      commandError: state.lastCommand === "claims" ? undefined : state.missionExecution?.commandError,
    },
    header: {
      ...state.header,
      activeMissionId: selectedMissionId,
    },
  }
}

function applyMissionProgress(state: UiState, value: unknown, missionId: string): UiState {
  if (!Array.isArray(value)) throw new Error("runtime.list_mission_progress returned non-array result")
  const selectedMissionId = redactText(missionId)
  const previous = missionExecutionState(state)
  const sameTarget = previous.selectedMissionId === selectedMissionId
  return {
    ...state,
    missionExecution: {
      ...previous,
      selectedMissionId,
      selectedMission: selectedMissionForTarget(state, selectedMissionId),
      selectedClaimId: sameTarget ? previous.selectedClaimId : undefined,
      selectedResultId: sameTarget ? previous.selectedResultId : undefined,
      claims: sameTarget ? previous.claims : [],
      progress: value.map(readMissionProgress).filter((item): item is MissionProgressSummary => item !== null).slice(0, MISSION_EXECUTION_LIMIT),
      results: sameTarget ? previous.results : [],
      commandError: state.lastCommand === "progress" ? undefined : state.missionExecution?.commandError,
    },
    header: {
      ...state.header,
      activeMissionId: selectedMissionId,
    },
  }
}

function applyMissionResults(state: UiState, value: unknown, missionId: string): UiState {
  if (!Array.isArray(value)) throw new Error("runtime.list_mission_results returned non-array result")
  const selectedMissionId = redactText(missionId)
  const previous = missionExecutionState(state)
  const sameTarget = previous.selectedMissionId === selectedMissionId
  return {
    ...state,
    missionExecution: {
      ...previous,
      selectedMissionId,
      selectedMission: selectedMissionForTarget(state, selectedMissionId),
      selectedClaimId: sameTarget ? previous.selectedClaimId : undefined,
      selectedResultId: sameTarget ? previous.selectedResultId : undefined,
      claims: sameTarget ? previous.claims : [],
      progress: sameTarget ? previous.progress : [],
      results: value.map(readMissionResult).filter((item): item is MissionResultSummary => item !== null).slice(0, MISSION_EXECUTION_LIMIT),
      commandError: state.lastCommand === "results" ? undefined : state.missionExecution?.commandError,
    },
    header: {
      ...state.header,
      activeMissionId: selectedMissionId,
    },
  }
}

function applyMissionClaim(state: UiState, value: unknown): UiState {
  const claim = readExecutorClaim(value)
  if (!claim) throw new Error("runtime.claim_mission returned invalid claim")
  const current = missionExecutionState(state)
  const claims = [claim, ...current.claims.filter((item) => item.claim_id !== claim.claim_id)].slice(0, MISSION_EXECUTION_LIMIT)
  return {
    ...state,
    missionExecution: {
      ...current,
      selectedMissionId: claim.mission_id,
      selectedClaimId: claim.claim_id,
      claims,
      commandError: undefined,
    },
  }
}

function applyMissionProgressRecord(state: UiState, value: unknown): UiState {
  const progress = readMissionProgress(value)
  if (!progress) throw new Error("runtime.record_mission_progress returned invalid progress")
  const current = missionExecutionState(state)
  return {
    ...state,
    missionExecution: {
      ...current,
      selectedMissionId: progress.mission_id,
      selectedClaimId: progress.claim_id,
      progress: [progress, ...current.progress.filter((item) => item.progress_id !== progress.progress_id)].slice(0, MISSION_EXECUTION_LIMIT),
      commandError: undefined,
    },
  }
}

function applyMissionResultRecord(state: UiState, value: unknown): UiState {
  const result = readMissionResult(value)
  if (!result) throw new Error("runtime.submit_mission_result returned invalid result")
  const current = missionExecutionState(state)
  return {
    ...state,
    missionExecution: {
      ...current,
      selectedMissionId: result.mission_id,
      selectedClaimId: result.claim_id,
      selectedResultId: result.result_id,
      results: [result, ...current.results.filter((item) => item.result_id !== result.result_id)].slice(0, MISSION_EXECUTION_LIMIT),
      commandError: undefined,
    },
  }
}

function applyResearchTopics(state: UiState, value: unknown, query: string | undefined, limit: number): UiState {
  if (!Array.isArray(value)) throw new Error("research.list_topics returned non-array result")
  return {
    ...state,
    research: {
      ...researchState(state),
      topics: value.map(readResearchTopic).filter((topic): topic is ResearchTopicSummary => topic !== null).slice(0, limit),
      lastQuery: query === undefined ? state.research?.lastQuery : redactText(query),
      commandError: state.lastCommand === "topics" ? undefined : state.research?.commandError,
    },
  }
}

function applyResearchTopicSnapshot(state: UiState, value: unknown, topicId: string): UiState {
  return {
    ...state,
    research: {
      ...researchState(state),
      selectedTopic: readTopicSnapshot(value),
      selectedTopicId: redactText(topicId),
      commandError: undefined,
    },
  }
}

function applyResearchNotes(state: UiState, value: unknown, topicId: string, query: string, limit: number): UiState {
  if (!Array.isArray(value)) throw new Error("research.search_notes returned non-array result")
  return {
    ...state,
    research: {
      ...researchState(state),
      notes: value.map(readResearchNote).filter((note): note is ResearchNoteSummary => note !== null).slice(0, limit),
      selectedTopic: state.research?.selectedTopic?.topic.id === redactText(topicId) ? state.research.selectedTopic : null,
      selectedTopicId: redactText(topicId),
      lastQuery: redactText(query),
      commandError: undefined,
    },
  }
}

function applyResearchEvents(state: UiState, value: unknown, limit: number): UiState {
  if (!Array.isArray(value)) throw new Error("research.list_events returned non-array result")
  return {
    ...state,
    research: {
      ...researchState(state),
      events: value.map(readResearchEvent).filter((event): event is ResearchEventSummary => event !== null).slice(0, limit),
      commandError: state.lastCommand === "research-events" ? undefined : state.research?.commandError,
    },
  }
}

function applyResearchProjectionStatus(state: UiState, value: unknown): UiState {
  const projection = readResearchProjectionUi(value)
  return {
    ...state,
    research: {
      ...researchState(state),
      projection,
      commandError: state.lastCommand === "projection" || state.lastCommand === "rebuild-projection"
        ? undefined
        : state.research?.commandError,
    },
  }
}

function applySubmissionResult(state: UiState, result: SubmitUserMessageResult): UiState {
  return {
    ...state,
    header: { ...state.header, activeMissionId: result.missionId },
    systemActions: [
      ...state.systemActions,
      { title: "mission submitted", detail: `mission_id=${redactText(result.missionId)} intent_id=${redactText(result.intentId)}` },
    ].slice(-12),
  }
}

function recordRuntimeCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    runtimeCommandError: message,
    systemActions: [...state.systemActions, { title: "runtime command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordResearchCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    research: {
      ...researchState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "research command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordCommandAuthorityCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    commandAuthority: {
      ...commandAuthorityState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "command authority error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordReasoningProviderCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    reasoningProvider: {
      ...reasoningProviderState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "reasoning provider command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordMiniMaxLiveValidationCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    minimaxLiveValidation: {
      ...minimaxLiveValidationState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "minimax live validation command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordMissionExecutionCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    missionExecution: {
      ...missionExecutionState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "mission execution command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordReviewCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    reviews: {
      ...reviewsState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "review command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordProposalCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    proposals: {
      ...proposalsState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "proposal command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordProposalBundleCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    proposalBundles: {
      ...proposalBundlesState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "proposal bundle command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordPlaybookCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    commanderPlaybooks: {
      ...commanderPlaybooksState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "playbook command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordWorkbenchCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    commanderWorkbench: {
      ...commanderWorkbenchState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "workbench command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordCommanderApplyCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    commanderApply: {
      ...commanderApplyState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "commander apply command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordCommanderAuditCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    commanderAudit: {
      ...commanderAuditState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "commander audit command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordCommanderQueueCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    commanderQueues: {
      ...commanderQueuesState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "commander queue command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordCommanderNavigationCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    commanderNavigation: {
      ...commanderNavigationState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "commander navigation command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordOperatorActionCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    operatorActions: {
      ...operatorActionsState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "operator action command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordExternalApiCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    externalApi: {
      ...externalApiState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "external API command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordResearchSynthesisCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    researchSynthesis: {
      ...researchSynthesisState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "research synthesis command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordCommanderCycleCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    commanderCycle: {
      ...commanderCycleState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "commander cycle command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordOpenCodeHandoffCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    opencodeHandoff: {
      ...opencodeHandoffState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "opencode handoff command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordOpenCodeProcessSmokeCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    opencodeProcessSmoke: {
      ...opencodeProcessSmokeState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "opencode process smoke command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordOpenCodeHandoffReadinessCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    opencodeHandoffReadiness: {
      ...opencodeHandoffReadinessState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "opencode handoff readiness command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordOpenCodeResultReviewCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    opencodeResultReview: {
      ...opencodeResultReviewState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "opencode result review command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordOpenCodeSessionCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    opencodeSessions: {
      ...opencodeSessionsState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "opencode session command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordContextBudgetCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    contextBudgets: {
      ...contextBudgetsState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "context budget command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordContextPacketCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    contextPackets: {
      ...contextPacketsState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "context packet command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordOpenCodeSessionInstructionPackCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    opencodeSessionInstructionPacks: {
      ...opencodeSessionInstructionPacksState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "opencode instruction pack command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordResearchMemoryCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    researchMemory: {
      ...researchMemoryState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "research memory command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordCommanderExecutorReviewCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    commanderExecutorReview: {
      ...commanderExecutorReviewState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "commander executor review command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordExecutorReviewProposalDraftCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    executorReviewProposalDrafts: {
      ...executorReviewProposalDraftState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal draft command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordExecutorReviewProposalCreateCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    executorReviewProposalCreate: {
      ...executorReviewProposalCreateState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal create command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordExecutorReviewProposalReviewRequestCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    executorReviewProposalReviewRequest: {
      ...executorReviewProposalReviewRequestState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal review request command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordExecutorReviewProposalReviewDecisionCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    executorReviewProposalReviewDecision: {
      ...executorReviewProposalReviewDecisionState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal review decision command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordExecutorReviewProposalApplyReadinessCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    executorReviewProposalApplyReadiness: {
      ...executorReviewProposalApplyReadinessState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal apply readiness command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordExecutorReviewProposalNarrowApplyCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    executorReviewProposalNarrowApply: {
      ...executorReviewProposalNarrowApplyState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "executor review proposal narrow apply command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordOpenCodeFollowupCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    opencodeFollowup: {
      ...opencodeFollowupState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "opencode follow-up command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordRuntimeCheckpointCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    runtimeCheckpoints: {
      ...runtimeCheckpointsState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "runtime checkpoint command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordRuntimeRestoreCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    runtimeRestore: {
      ...runtimeRestoreState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "checkpoint resume command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordWakeAssessmentCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    wakeAssessment: {
      ...wakeAssessmentState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "wake assessment command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordContinuationCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    continuation: {
      ...continuationState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "continuation command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordWakeScheduleCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    wakeSchedules: {
      ...wakeSchedulesState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "wake schedule command error", detail: message, status: "failed" }].slice(-12),
  }
}

function recordWakeSchedulerCommandError(state: UiState, error: unknown): UiState {
  const message = redactText(error instanceof Error ? error.message : String(error))
  return {
    ...state,
    wakeScheduler: {
      ...wakeSchedulerState(state),
      commandError: message,
    },
    systemActions: [...state.systemActions, { title: "wake scheduler command error", detail: message, status: "failed" }].slice(-12),
  }
}

function readResearchProjection(value: unknown): ResearchProjectionSummary | undefined {
  if (!isRecord(value)) return undefined
  return {
    mode: readString(value.mode, "unknown"),
    ok: readBoolean(value.ok),
    stale: readBoolean(value.stale),
    reason: typeof value.reason === "string" ? redactText(value.reason) : undefined,
    pending_count: readNumber(value.pending_count, 0),
  }
}

function readExternalApiConnectorList(value: unknown, commandName: string, limit: number): ExternalApiConnectorSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readExternalApiConnector).filter((connector): connector is ExternalApiConnectorSummary => connector !== null).slice(0, limit)
}

function readExternalApiConnector(value: unknown): ExternalApiConnectorSummary | null {
  if (!isRecord(value) || typeof value.connector_id !== "string") return null
  return {
    connector_id: redactText(value.connector_id),
    title: preview(readString(value.title, "")),
    description: typeof value.description === "string" ? preview(readString(value.description, "")) : undefined,
    base_url: redactText(readString(value.base_url, "")),
    allowed_hosts: readStringList(value.allowed_hosts, 20),
    allowed_methods: readStringList(value.allowed_methods, 10),
    timeout_ms: readNumber(value.timeout_ms, 0),
    max_response_bytes: readNumber(value.max_response_bytes, 0),
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : undefined,
    updated_at: typeof value.updated_at === "string" ? redactText(value.updated_at) : undefined,
    credential_refs: Array.isArray(value.credential_refs)
      ? value.credential_refs.map(readExternalApiCredentialRef).filter((ref): ref is NonNullable<ExternalApiConnectorSummary["credential_refs"]>[number] => ref !== null).slice(0, 10)
      : undefined,
  }
}

function readExternalApiCredentialRef(value: unknown): NonNullable<ExternalApiConnectorSummary["credential_refs"]>[number] | null {
  if (!isRecord(value) || typeof value.name !== "string") return null
  return {
    name: redactText(value.name),
    source: readString(value.source, "env"),
    inject_as: readString(value.inject_as, "header"),
    target_name: redactText(readString(value.target_name, "")),
    prefix: typeof value.prefix === "string" ? redactText(value.prefix) : undefined,
    env_name: typeof value.env_name === "string" ? redactText(value.env_name) : undefined,
  }
}

function readExternalApiPreview(value: unknown): ExternalApiRequestPreviewSummary {
  if (!isRecord(value) || typeof value.connector_id !== "string" || typeof value.url !== "string") throw new Error("runtime.preview_external_api_request returned invalid preview")
  return {
    connector_id: redactText(value.connector_id),
    method: readString(value.method, "GET"),
    url: preview(redactText(value.url)),
    allowed: readBoolean(value.allowed),
    blockers: readStringList(value.blockers, 10).map(preview),
    redacted_headers: readStringMap(value.redacted_headers, 20),
    has_body: readBoolean(value.has_body),
    body_bytes: readNumber(value.body_bytes, 0),
    credential_refs_used: readStringList(value.credential_refs_used, 10),
  }
}

function readExternalApiResult(value: unknown): ExternalApiRequestResultSummary {
  if (!isRecord(value) || typeof value.request_id !== "string" || typeof value.connector_id !== "string" || typeof value.url !== "string") throw new Error("runtime.execute_external_api_request returned invalid result")
  return {
    request_id: redactText(value.request_id),
    connector_id: redactText(value.connector_id),
    method: readString(value.method, "GET"),
    url: preview(redactText(value.url)),
    status_code: typeof value.status_code === "number" ? value.status_code : undefined,
    ok: readBoolean(value.ok),
    response_bytes: typeof value.response_bytes === "number" ? value.response_bytes : undefined,
    response_preview: typeof value.response_preview === "string" ? preview(redactText(value.response_preview)) : undefined,
    error: typeof value.error === "string" ? preview(redactText(value.error)) : undefined,
    dry_run: readBoolean(value.dry_run),
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : "",
  }
}

function readExternalApiAuditList(value: unknown, commandName: string, limit: number): ExternalApiAuditRecordSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readExternalApiAuditRecord).filter((record): record is ExternalApiAuditRecordSummary => record !== null).slice(0, limit)
}

function readExternalApiAuditRecord(value: unknown): ExternalApiAuditRecordSummary | null {
  if (!isRecord(value) || typeof value.request_id !== "string" || typeof value.connector_id !== "string") return null
  return {
    request_id: redactText(value.request_id),
    connector_id: redactText(value.connector_id),
    method: readString(value.method, "GET"),
    url: preview(redactText(readString(value.url, ""))),
    status_code: typeof value.status_code === "number" ? value.status_code : undefined,
    ok: readBoolean(value.ok),
    dry_run: readBoolean(value.dry_run),
    requested_by: readString(value.requested_by, "unknown"),
    error: typeof value.error === "string" ? preview(redactText(value.error)) : undefined,
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : "",
  }
}

function readExternalApiResearchIngestionPreview(value: unknown): ExternalApiResearchIngestionPreviewSummary {
  if (!isRecord(value) || typeof value.connector_id !== "string" || typeof value.topic_id !== "string" || typeof value.url !== "string") throw new Error("runtime.preview_external_api_research_ingestion returned invalid preview")
  return {
    connector_id: redactText(value.connector_id),
    topic_id: redactText(value.topic_id),
    method: readString(value.method, "GET"),
    url: preview(redactText(value.url)),
    allowed: readBoolean(value.allowed),
    blockers: readStringList(value.blockers, 10).map(preview),
    would_create_source: readBoolean(value.would_create_source),
    would_create_note: readBoolean(value.would_create_note),
    max_ingested_bytes: readNumber(value.max_ingested_bytes, 0),
    credential_refs_used: readStringList(value.credential_refs_used, 10),
    redacted_headers: readStringMap(value.redacted_headers, 20),
  }
}

function readExternalApiResearchIngestionResult(value: unknown): ExternalApiResearchIngestionResultSummary {
  if (!isRecord(value) || typeof value.ingestion_id !== "string" || typeof value.connector_id !== "string" || typeof value.topic_id !== "string") throw new Error("runtime.execute_external_api_research_ingestion returned invalid result")
  return {
    ingestion_id: redactText(value.ingestion_id),
    request_id: typeof value.request_id === "string" ? redactText(value.request_id) : undefined,
    connector_id: redactText(value.connector_id),
    topic_id: redactText(value.topic_id),
    source_id: typeof value.source_id === "string" ? redactText(value.source_id) : undefined,
    note_id: typeof value.note_id === "string" ? redactText(value.note_id) : undefined,
    artifact_id: typeof value.artifact_id === "string" ? redactText(value.artifact_id) : undefined,
    audit_request_id: typeof value.audit_request_id === "string" ? redactText(value.audit_request_id) : undefined,
    ok: readBoolean(value.ok),
    dry_run: readBoolean(value.dry_run),
    ingested_bytes: readNumber(value.ingested_bytes, 0),
    response_preview: typeof value.response_preview === "string" ? preview(redactText(value.response_preview)) : "",
    error: typeof value.error === "string" ? preview(redactText(value.error)) : undefined,
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : "",
  }
}

function readExternalApiResearchIngestionList(value: unknown, commandName: string, limit: number): ExternalApiResearchIngestionRecordSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readExternalApiResearchIngestionRecord).filter((record): record is ExternalApiResearchIngestionRecordSummary => record !== null).slice(0, limit)
}

function readExternalApiResearchIngestionRecord(value: unknown): ExternalApiResearchIngestionRecordSummary | null {
  if (!isRecord(value) || typeof value.ingestion_id !== "string" || typeof value.connector_id !== "string") return null
  return {
    ingestion_id: redactText(value.ingestion_id),
    connector_id: redactText(value.connector_id),
    topic_id: readString(value.topic_id, ""),
    source_id: typeof value.source_id === "string" ? redactText(value.source_id) : undefined,
    note_id: typeof value.note_id === "string" ? redactText(value.note_id) : undefined,
    artifact_id: typeof value.artifact_id === "string" ? redactText(value.artifact_id) : undefined,
    audit_request_id: typeof value.audit_request_id === "string" ? redactText(value.audit_request_id) : undefined,
    ok: readBoolean(value.ok),
    dry_run: readBoolean(value.dry_run),
    requested_by: readString(value.requested_by, "unknown"),
    error: typeof value.error === "string" ? preview(redactText(value.error)) : undefined,
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : "",
  }
}

function readResearchSynthesisPreview(value: unknown): ResearchSynthesisPreviewSummary {
  if (!isRecord(value) || typeof value.topic_id !== "string" || typeof value.topic_title !== "string") throw new Error("runtime.preview_research_synthesis returned invalid preview")
  const counts = isRecord(value.evidence_counts) ? value.evidence_counts : {}
  return {
    topic_id: redactText(value.topic_id),
    topic_title: preview(readString(value.topic_title, "")),
    evidence_counts: {
      sources: readNumber(counts.sources, 0),
      notes: readNumber(counts.notes, 0),
      artifacts: readNumber(counts.artifacts, 0),
      ingestions: readNumber(counts.ingestions, 0),
    },
    context_bytes: readNumber(value.context_bytes, 0),
    max_context_bytes: readNumber(value.max_context_bytes, 0),
    included_evidence_ids: readStringList(value.included_evidence_ids, 20),
    excluded_evidence_count: readNumber(value.excluded_evidence_count, 0),
    blockers: readStringList(value.blockers, 10).map(preview),
    redacted_context_preview: typeof value.redacted_context_preview === "string" ? preview(redactText(value.redacted_context_preview)) : "",
  }
}

function readResearchSynthesisResult(value: unknown): ResearchSynthesisResultSummary | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value) || typeof value.synthesis_id !== "string" || typeof value.topic_id !== "string") throw new Error("runtime.get_research_synthesis returned invalid result")
  return {
    synthesis_id: redactText(value.synthesis_id),
    topic_id: redactText(value.topic_id),
    provider_id: readString(value.provider_id, "unknown"),
    source_note_id: typeof value.source_note_id === "string" ? redactText(value.source_note_id) : undefined,
    artifact_id: typeof value.artifact_id === "string" ? redactText(value.artifact_id) : undefined,
    proposal_ids: readStringList(value.proposal_ids, 20),
    title: preview(readString(value.title, "")),
    summary: preview(readString(value.summary, "")),
    findings: readStringList(value.findings, 10).map(preview),
    risks: readStringList(value.risks, 10).map(preview),
    open_questions: readStringList(value.open_questions, 10).map(preview),
    recommended_actions: Array.isArray(value.recommended_actions)
      ? value.recommended_actions.map(readResearchSynthesisAction).filter((item): item is ResearchSynthesisResultSummary["recommended_actions"][number] => item !== null).slice(0, 10)
      : [],
    context_hash: readString(value.context_hash, ""),
    output_hash: readString(value.output_hash, ""),
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : "",
    requested_by: readString(value.requested_by, "unknown"),
  }
}

function readResearchSynthesisAction(value: unknown): ResearchSynthesisResultSummary["recommended_actions"][number] | null {
  if (!isRecord(value) || typeof value.title !== "string") return null
  return {
    title: preview(readString(value.title, "")),
    summary: preview(readString(value.summary, "")),
    action_kind: readString(value.action_kind, "other"),
    evidence_ids: readStringList(value.evidence_ids, 20),
  }
}

function readResearchSynthesisRecordList(value: unknown, commandName: string, limit: number): ResearchSynthesisRecordSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readResearchSynthesisRecord).filter((record): record is ResearchSynthesisRecordSummary => record !== null).slice(0, limit)
}

function readResearchSynthesisRecord(value: unknown): ResearchSynthesisRecordSummary | null {
  if (!isRecord(value) || typeof value.synthesis_id !== "string" || typeof value.topic_id !== "string") return null
  return {
    synthesis_id: redactText(value.synthesis_id),
    topic_id: redactText(value.topic_id),
    provider_id: readString(value.provider_id, "unknown"),
    source_note_id: typeof value.source_note_id === "string" ? redactText(value.source_note_id) : undefined,
    artifact_id: typeof value.artifact_id === "string" ? redactText(value.artifact_id) : undefined,
    proposal_ids: readStringList(value.proposal_ids, 20),
    title: preview(readString(value.title, "")),
    summary_preview: preview(readString(value.summary_preview, "")),
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : "",
    requested_by: readString(value.requested_by, "unknown"),
  }
}

function recordFromSynthesisResult(result: ResearchSynthesisResultSummary): ResearchSynthesisRecordSummary {
  return {
    synthesis_id: result.synthesis_id,
    topic_id: result.topic_id,
    provider_id: result.provider_id,
    source_note_id: result.source_note_id,
    artifact_id: result.artifact_id,
    proposal_ids: result.proposal_ids,
    title: result.title,
    summary_preview: preview(result.summary),
    created_at: result.created_at,
    requested_by: result.requested_by,
  }
}

function readCommanderCyclePreview(value: unknown): CommanderCyclePreviewSummary {
  if (!isRecord(value) || !isRecord(value.context_counts)) throw new Error("runtime.preview_commander_cycle returned invalid preview")
  const counts = value.context_counts
  return {
    objective: typeof value.objective === "string" ? preview(redactText(value.objective)) : undefined,
    topic_id: typeof value.topic_id === "string" ? redactText(value.topic_id) : undefined,
    mission_id: typeof value.mission_id === "string" ? redactText(value.mission_id) : undefined,
    context_counts: {
      sources: readNumber(counts.sources, 0),
      notes: readNumber(counts.notes, 0),
      artifacts: readNumber(counts.artifacts, 0),
      syntheses: readNumber(counts.syntheses, 0),
      proposals: readNumber(counts.proposals, 0),
      reviews: readNumber(counts.reviews, 0),
      queues: readNumber(counts.queues, 0),
    },
    context_bytes: readNumber(value.context_bytes, 0),
    max_context_bytes: readNumber(value.max_context_bytes, 0),
    included_evidence_ids: readStringList(value.included_evidence_ids, 20),
    included_synthesis_ids: readStringList(value.included_synthesis_ids, 20),
    blockers: readStringList(value.blockers, 10).map(preview),
    redacted_context_preview: typeof value.redacted_context_preview === "string" ? preview(redactText(value.redacted_context_preview)) : "",
  }
}

function readCommanderCycleResult(value: unknown): CommanderCycleResultSummary | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value) || typeof value.cycle_id !== "string") throw new Error("runtime.get_commander_cycle returned invalid result")
  return {
    cycle_id: redactText(value.cycle_id),
    provider_id: readString(value.provider_id, "unknown"),
    objective: typeof value.objective === "string" ? preview(redactText(value.objective)) : undefined,
    topic_id: typeof value.topic_id === "string" ? redactText(value.topic_id) : undefined,
    mission_id: typeof value.mission_id === "string" ? redactText(value.mission_id) : undefined,
    title: preview(readString(value.title, "")),
    summary: preview(readString(value.summary, "")),
    findings: readStringList(value.findings, 10).map(preview),
    risks: readStringList(value.risks, 10).map(preview),
    recommended_actions: Array.isArray(value.recommended_actions)
      ? value.recommended_actions.map(readCommanderCycleAction).filter((item): item is CommanderCycleResultSummary["recommended_actions"][number] => item !== null).slice(0, 10)
      : [],
    proposal_ids: readStringList(value.proposal_ids, 20),
    bundle_id: typeof value.bundle_id === "string" ? redactText(value.bundle_id) : undefined,
    context_hash: readString(value.context_hash, ""),
    output_hash: readString(value.output_hash, ""),
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : "",
    requested_by: readString(value.requested_by, "unknown"),
  }
}

function readCommanderCycleAction(value: unknown): CommanderCycleResultSummary["recommended_actions"][number] | null {
  if (!isRecord(value) || typeof value.title !== "string") return null
  return {
    title: preview(readString(value.title, "")),
    summary: preview(readString(value.summary, "")),
    action_kind: readString(value.action_kind, "other"),
    rationale: preview(readString(value.rationale, "")),
    evidence_ids: readStringList(value.evidence_ids, 20),
    synthesis_ids: readStringList(value.synthesis_ids, 20),
    related_target_type: typeof value.related_target_type === "string" ? redactText(value.related_target_type) : undefined,
    related_target_id: typeof value.related_target_id === "string" ? redactText(value.related_target_id) : undefined,
  }
}

function readCommanderCycleRecordList(value: unknown, commandName: string, limit: number): CommanderCycleRecordSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readCommanderCycleRecord).filter((record): record is CommanderCycleRecordSummary => record !== null).slice(0, limit)
}

function readCommanderCycleRecord(value: unknown): CommanderCycleRecordSummary | null {
  if (!isRecord(value) || typeof value.cycle_id !== "string") return null
  return {
    cycle_id: redactText(value.cycle_id),
    provider_id: readString(value.provider_id, "unknown"),
    objective_preview: typeof value.objective_preview === "string" ? preview(redactText(value.objective_preview)) : undefined,
    topic_id: typeof value.topic_id === "string" ? redactText(value.topic_id) : undefined,
    mission_id: typeof value.mission_id === "string" ? redactText(value.mission_id) : undefined,
    title: preview(readString(value.title, "")),
    summary_preview: preview(readString(value.summary_preview, "")),
    proposal_ids: readStringList(value.proposal_ids, 20),
    bundle_id: typeof value.bundle_id === "string" ? redactText(value.bundle_id) : undefined,
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : "",
    requested_by: readString(value.requested_by, "unknown"),
  }
}

function recordFromCommanderCycleResult(result: CommanderCycleResultSummary): CommanderCycleRecordSummary {
  return {
    cycle_id: result.cycle_id,
    provider_id: result.provider_id,
    objective_preview: result.objective ? preview(result.objective) : undefined,
    topic_id: result.topic_id,
    mission_id: result.mission_id,
    title: result.title,
    summary_preview: preview(result.summary),
    proposal_ids: result.proposal_ids,
    bundle_id: result.bundle_id,
    created_at: result.created_at,
    requested_by: result.requested_by,
  }
}

function readOpenCodeHandoffPreview(value: unknown): OpenCodeHandoffPreviewSummary {
  if (!isRecord(value) || typeof value.proposal_id !== "string") throw new Error("runtime.preview_opencode_handoff returned invalid preview")
  return {
    proposal_id: redactText(value.proposal_id),
    eligible: readBoolean(value.eligible),
    blockers: readStringList(value.blockers, 10).map(preview),
    action_kind: readString(value.action_kind, "unknown"),
    proposal_status: readString(value.proposal_status, "unknown"),
    review_id: typeof value.review_id === "string" ? redactText(value.review_id) : undefined,
    review_status: typeof value.review_status === "string" ? redactText(value.review_status) : undefined,
    objective_preview: preview(readString(value.objective_preview, "")),
    evidence_ids: readStringList(value.evidence_ids, 20),
    source_cycle_id: typeof value.source_cycle_id === "string" ? redactText(value.source_cycle_id) : undefined,
    source_synthesis_id: typeof value.source_synthesis_id === "string" ? redactText(value.source_synthesis_id) : undefined,
    would_create_mission: readBoolean(value.would_create_mission),
    would_send_to_adapter: readBoolean(value.would_send_to_adapter),
  }
}

function readOpenCodeHandoffResult(value: unknown): OpenCodeHandoffResultSummary | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value) || typeof value.handoff_id !== "string") throw new Error("runtime.get_opencode_handoff returned invalid result")
  return {
    handoff_id: redactText(value.handoff_id),
    proposal_id: readString(value.proposal_id, ""),
    review_id: typeof value.review_id === "string" ? redactText(value.review_id) : undefined,
    mission_id: typeof value.mission_id === "string" ? redactText(value.mission_id) : undefined,
    intent_id: typeof value.intent_id === "string" ? redactText(value.intent_id) : undefined,
    adapter_session_id: typeof value.adapter_session_id === "string" ? redactText(value.adapter_session_id) : undefined,
    objective_preview: preview(readString(value.objective_preview, "")),
    sent: readBoolean(value.sent),
    dry_run: readBoolean(value.dry_run),
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : "",
    requested_by: readString(value.requested_by, "unknown"),
    source_cycle_id: typeof value.source_cycle_id === "string" ? redactText(value.source_cycle_id) : undefined,
    source_synthesis_id: typeof value.source_synthesis_id === "string" ? redactText(value.source_synthesis_id) : undefined,
    evidence_ids: readStringList(value.evidence_ids, 20),
  }
}

function readOpenCodeHandoffRecordList(value: unknown, commandName: string, limit: number): OpenCodeHandoffRecordSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readOpenCodeHandoffRecord).filter((record): record is OpenCodeHandoffRecordSummary => record !== null).slice(0, limit)
}

function readOpenCodeHandoffRecord(value: unknown): OpenCodeHandoffRecordSummary | null {
  if (!isRecord(value) || typeof value.handoff_id !== "string") return null
  return {
    handoff_id: redactText(value.handoff_id),
    proposal_id: readString(value.proposal_id, ""),
    mission_id: typeof value.mission_id === "string" ? redactText(value.mission_id) : undefined,
    intent_id: typeof value.intent_id === "string" ? redactText(value.intent_id) : undefined,
    sent: readBoolean(value.sent),
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : "",
    requested_by: readString(value.requested_by, "unknown"),
    source_cycle_id: typeof value.source_cycle_id === "string" ? redactText(value.source_cycle_id) : undefined,
    source_synthesis_id: typeof value.source_synthesis_id === "string" ? redactText(value.source_synthesis_id) : undefined,
  }
}

function recordFromOpenCodeHandoffResult(result: OpenCodeHandoffResultSummary): OpenCodeHandoffRecordSummary {
  return {
    handoff_id: result.handoff_id,
    proposal_id: result.proposal_id,
    mission_id: result.mission_id,
    intent_id: result.intent_id,
    sent: result.sent,
    created_at: result.created_at,
    requested_by: result.requested_by,
    source_cycle_id: result.source_cycle_id,
    source_synthesis_id: result.source_synthesis_id,
  }
}

function readOpenCodeProcessSmokePreview(value: unknown): OpenCodeProcessSmokePreviewSummary {
  if (!isRecord(value) || typeof value.status !== "string") throw new Error("runtime.preview_opencode_process_smoke returned invalid preview")
  return {
    smoke_id: typeof value.smoke_id === "string" ? redactText(value.smoke_id) : undefined,
    status: redactText(value.status),
    can_execute: readBoolean(value.can_execute),
    adapter_kind: typeof value.adapter_kind === "string" ? redactText(value.adapter_kind) : undefined,
    project_dir: preview(readString(value.project_dir, "")),
    binary_path: typeof value.binary_path === "string" ? preview(value.binary_path) : undefined,
    binary_detected: readBoolean(value.binary_detected),
    opt_in_required: readBoolean(value.opt_in_required),
    opt_in_present: readBoolean(value.opt_in_present),
    timeout_ms: readNumber(value.timeout_ms, 0),
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readOpenCodeProcessSmokeResult(value: unknown): OpenCodeProcessSmokeResultSummary | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value) || typeof value.smoke_id !== "string") throw new Error("runtime.get_opencode_process_smoke returned invalid result")
  return {
    smoke_id: redactText(value.smoke_id),
    status: readString(value.status, "unknown"),
    adapter_kind: typeof value.adapter_kind === "string" ? redactText(value.adapter_kind) : undefined,
    project_dir: preview(readString(value.project_dir, "")),
    binary_path: typeof value.binary_path === "string" ? preview(value.binary_path) : undefined,
    started_at: readString(value.started_at, ""),
    completed_at: readString(value.completed_at, ""),
    duration_ms: typeof value.duration_ms === "number" ? value.duration_ms : undefined,
    exit_code: typeof value.exit_code === "number" ? value.exit_code : undefined,
    signal: typeof value.signal === "string" ? redactText(value.signal) : undefined,
    stdout_preview: typeof value.stdout_preview === "string" ? preview(value.stdout_preview) : undefined,
    stderr_preview: typeof value.stderr_preview === "string" ? preview(value.stderr_preview) : undefined,
    diagnostics: readStringList(value.diagnostics, 12).map(preview),
    error: typeof value.error === "string" ? preview(value.error) : undefined,
    requested_by: readString(value.requested_by, "unknown"),
    smoke_hash: readString(value.smoke_hash, ""),
  }
}

function readOpenCodeProcessSmokeRecordList(value: unknown, commandName: string, limit: number): OpenCodeProcessSmokeRecordSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readOpenCodeProcessSmokeRecord).filter((record): record is OpenCodeProcessSmokeRecordSummary => record !== null).slice(0, limit)
}

function readOpenCodeProcessSmokeRecord(value: unknown): OpenCodeProcessSmokeRecordSummary | null {
  if (!isRecord(value) || typeof value.smoke_id !== "string") return null
  return {
    smoke_id: redactText(value.smoke_id),
    status: readString(value.status, "unknown"),
    adapter_kind: typeof value.adapter_kind === "string" ? redactText(value.adapter_kind) : undefined,
    completed_at: readString(value.completed_at, ""),
    duration_ms: typeof value.duration_ms === "number" ? value.duration_ms : undefined,
    exit_code: typeof value.exit_code === "number" ? value.exit_code : undefined,
    summary_preview: preview(readString(value.summary_preview, "")),
    smoke_hash: readString(value.smoke_hash, ""),
  }
}

function recordFromOpenCodeProcessSmokeResult(result: OpenCodeProcessSmokeResultSummary): OpenCodeProcessSmokeRecordSummary {
  return {
    smoke_id: result.smoke_id,
    status: result.status,
    adapter_kind: result.adapter_kind,
    completed_at: result.completed_at,
    duration_ms: result.duration_ms,
    exit_code: result.exit_code,
    summary_preview: result.error ?? result.diagnostics[0] ?? result.status,
    smoke_hash: result.smoke_hash,
  }
}

function readOpenCodeHandoffReadinessPreview(value: unknown): OpenCodeHandoffReadinessPreviewSummary {
  if (!isRecord(value) || typeof value.readiness_id !== "string" || typeof value.status !== "string" || !isRecord(value.authority)) throw new Error("runtime.preview_opencode_handoff_readiness returned invalid preview")
  return {
    readiness_id: redactText(value.readiness_id),
    status: readString(value.status, "unknown"),
    can_execute_now: false,
    proposal_id: typeof value.proposal_id === "string" ? redactText(value.proposal_id) : undefined,
    review_id: typeof value.review_id === "string" ? redactText(value.review_id) : undefined,
    mission_id: typeof value.mission_id === "string" ? redactText(value.mission_id) : undefined,
    handoff_id: typeof value.handoff_id === "string" ? redactText(value.handoff_id) : undefined,
    authority: {
      command: preview(readString(value.authority.command, "")),
      slash_command: preview(readString(value.authority.slash_command, "")),
      risk: readString(value.authority.risk, "unknown"),
      gate: readString(value.authority.gate, "unknown"),
      owner: readString(value.authority.owner, "unknown"),
      blocked_by_default: readBoolean(value.authority.blocked_by_default),
    },
    latest_smoke: isRecord(value.latest_smoke) ? readOpenCodeProcessSmokeRecord(value.latest_smoke) ?? undefined : undefined,
    handoff_preview_summary: typeof value.handoff_preview_summary === "string" ? preview(readString(value.handoff_preview_summary, "")) : undefined,
    required_evidence: readOpenCodeHandoffReadinessEvidenceList(value.required_evidence),
    optional_evidence: readOpenCodeHandoffReadinessEvidenceList(value.optional_evidence),
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    recommended_commands: readOpenCodeHandoffReadinessCommands(value.recommended_commands),
    generated_at: readString(value.generated_at, ""),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readOpenCodeHandoffReadinessSummary(value: unknown): OpenCodeHandoffReadinessSummary {
  if (!isRecord(value)) throw new Error("runtime.opencode_handoff_readiness_summary returned invalid summary")
  return {
    total_considered: readNumber(value.total_considered, 0),
    ready_count: readNumber(value.ready_count, 0),
    blocked_count: readNumber(value.blocked_count, 0),
    needs_smoke_count: readNumber(value.needs_smoke_count, 0),
    needs_review_count: readNumber(value.needs_review_count, 0),
    latest_smoke_status: typeof value.latest_smoke_status === "string" ? redactText(value.latest_smoke_status) : undefined,
    latest_handoff_status: typeof value.latest_handoff_status === "string" ? redactText(value.latest_handoff_status) : undefined,
    generated_at: readString(value.generated_at, ""),
  }
}

function readOpenCodeHandoffReadinessEvidenceList(value: unknown): OpenCodeHandoffReadinessEvidenceSummary[] {
  if (!Array.isArray(value)) return []
  return value.map(readOpenCodeHandoffReadinessEvidence).filter((item): item is OpenCodeHandoffReadinessEvidenceSummary => item !== null).slice(0, 12)
}

function readOpenCodeHandoffReadinessEvidence(value: unknown): OpenCodeHandoffReadinessEvidenceSummary | null {
  if (!isRecord(value) || typeof value.evidence_id !== "string" || typeof value.kind !== "string") return null
  return {
    evidence_id: redactText(value.evidence_id),
    kind: readString(value.kind, "unknown"),
    related_id: typeof value.related_id === "string" ? redactText(value.related_id) : undefined,
    status: readString(value.status, "unknown"),
    fresh: readBoolean(value.fresh),
    completed_at: typeof value.completed_at === "string" ? readString(value.completed_at, "") : undefined,
    age_ms: typeof value.age_ms === "number" ? value.age_ms : undefined,
    summary_preview: preview(readString(value.summary_preview, "")),
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
  }
}

function readOpenCodeHandoffReadinessCommands(value: unknown): OpenCodeHandoffReadinessCommandSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((command) => ({
    label: preview(readString(command.label, "")),
    command: preview(readString(command.command, "")),
    command_type: command.command_type === "write" ? "write" : "read",
    requires_active_runtime: command.requires_active_runtime === true,
    notes: typeof command.notes === "string" ? preview(readString(command.notes, "")) : undefined,
  }))
}

function readOpenCodeResultReviewPacket(value: unknown): OpenCodeResultReviewPacketSummary {
  if (!isRecord(value) || typeof value.packet_id !== "string" || typeof value.status !== "string") throw new Error("runtime.preview_opencode_result_review_packet returned invalid packet")
  return {
    packet_id: redactText(value.packet_id),
    status: readString(value.status, "unknown"),
    handoff_id: typeof value.handoff_id === "string" ? redactText(value.handoff_id) : undefined,
    followup_id: typeof value.followup_id === "string" ? redactText(value.followup_id) : undefined,
    mission_id: typeof value.mission_id === "string" ? redactText(value.mission_id) : undefined,
    result_id: typeof value.result_id === "string" ? redactText(value.result_id) : undefined,
    claim_id: typeof value.claim_id === "string" ? redactText(value.claim_id) : undefined,
    proposal_id: typeof value.proposal_id === "string" ? redactText(value.proposal_id) : undefined,
    review_id: typeof value.review_id === "string" ? redactText(value.review_id) : undefined,
    title: preview(readString(value.title, "")),
    objective_preview: typeof value.objective_preview === "string" ? preview(readString(value.objective_preview, "")) : undefined,
    executor_summary_preview: typeof value.executor_summary_preview === "string" ? preview(readString(value.executor_summary_preview, "")) : undefined,
    result_summary_preview: typeof value.result_summary_preview === "string" ? preview(readString(value.result_summary_preview, "")) : undefined,
    artifact_previews: readStringList(value.artifact_previews, 12).map(preview),
    evidence: readOpenCodeResultReviewEvidenceList(value.evidence),
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    recommended_commands: readOpenCodeResultReviewCommands(value.recommended_commands),
    generated_at: readString(value.generated_at, ""),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readOpenCodeResultReviewSummary(value: unknown): OpenCodeResultReviewSummary {
  if (!isRecord(value)) throw new Error("runtime.opencode_result_review_summary returned invalid summary")
  return {
    total_considered: readNumber(value.total_considered, 0),
    ready_count: readNumber(value.ready_count, 0),
    needs_result_count: readNumber(value.needs_result_count, 0),
    failed_count: readNumber(value.failed_count, 0),
    blocked_count: readNumber(value.blocked_count, 0),
    stale_count: readNumber(value.stale_count, 0),
    latest_handoff_id: typeof value.latest_handoff_id === "string" ? redactText(value.latest_handoff_id) : undefined,
    latest_result_id: typeof value.latest_result_id === "string" ? redactText(value.latest_result_id) : undefined,
    generated_at: readString(value.generated_at, ""),
  }
}

function readOpenCodeResultReviewEvidenceList(value: unknown): OpenCodeResultReviewEvidenceSummary[] {
  if (!Array.isArray(value)) return []
  return value.map(readOpenCodeResultReviewEvidence).filter((item): item is OpenCodeResultReviewEvidenceSummary => item !== null).slice(0, 12)
}

function readOpenCodeResultReviewEvidence(value: unknown): OpenCodeResultReviewEvidenceSummary | null {
  if (!isRecord(value) || typeof value.evidence_id !== "string" || typeof value.kind !== "string") return null
  return {
    evidence_id: redactText(value.evidence_id),
    kind: readString(value.kind, "unknown"),
    related_id: typeof value.related_id === "string" ? redactText(value.related_id) : undefined,
    status: readString(value.status, "unknown"),
    fresh: readBoolean(value.fresh),
    completed_at: typeof value.completed_at === "string" ? readString(value.completed_at, "") : undefined,
    age_ms: typeof value.age_ms === "number" ? value.age_ms : undefined,
    summary_preview: preview(readString(value.summary_preview, "")),
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
  }
}

function readOpenCodeResultReviewCommands(value: unknown): OpenCodeResultReviewCommandSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((command) => ({
    label: preview(readString(command.label, "")),
    command: preview(readString(command.command, "")),
    command_type: command.command_type === "write" ? "write" : "read",
    requires_active_runtime: command.requires_active_runtime === true,
    notes: typeof command.notes === "string" ? preview(readString(command.notes, "")) : undefined,
  }))
}

function recordFromOpenCodeResultReviewPacket(packet: OpenCodeResultReviewPacketSummary): OpenCodeResultReviewPacketRecordSummary {
  return {
    packet_id: packet.packet_id,
    status: packet.status,
    handoff_id: packet.handoff_id,
    mission_id: packet.mission_id,
    result_id: packet.result_id,
    proposal_id: packet.proposal_id,
    generated_at: packet.generated_at,
    summary_preview: packet.redacted_summary_preview,
  }
}

function readOpenCodeSessionPreview(value: unknown): OpenCodeSessionPreviewSummary {
  if (!isRecord(value) || typeof value.preview_id !== "string") throw new Error("runtime.preview_opencode_session_plan returned invalid preview")
  return {
    preview_id: redactText(value.preview_id),
    can_create: readBoolean(value.can_create),
    source_kind: readString(value.source_kind, "unknown"),
    mission_id: typeof value.mission_id === "string" ? redactText(value.mission_id) : undefined,
    proposal_id: typeof value.proposal_id === "string" ? redactText(value.proposal_id) : undefined,
    review_request_id: typeof value.review_request_id === "string" ? redactText(value.review_request_id) : undefined,
    apply_id: typeof value.apply_id === "string" ? redactText(value.apply_id) : undefined,
    title_preview: preview(readString(value.title_preview, "")),
    objective_preview: preview(readString(value.objective_preview, "")),
    commander_context_summary_preview: preview(readString(value.commander_context_summary_preview, "")),
    opencode_context_seed_preview: preview(readString(value.opencode_context_seed_preview, "")),
    max_context_bytes: readNumber(value.max_context_bytes, 0),
    success_criteria: readStringList(value.success_criteria, 10).map(preview),
    constraints: readStringList(value.constraints, 10).map(preview),
    timeout_policy: readOpenCodeSessionTimeoutPolicy(value.timeout_policy),
    question_policy: readOpenCodeSessionQuestionPolicy(value.question_policy),
    human_control_policy: readOpenCodeSessionHumanPolicy(value.human_control_policy),
    existing_session_id: typeof value.existing_session_id === "string" ? redactText(value.existing_session_id) : undefined,
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    recommended_commands: readOpenCodeSessionCommands(value.recommended_commands),
    generated_at: readString(value.generated_at, ""),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readOpenCodeSessionPlan(value: unknown): OpenCodeSessionPlanSummary {
  if (!isRecord(value) || typeof value.session_id !== "string") throw new Error("runtime opencode session command returned invalid plan")
  return {
    session_id: redactText(value.session_id),
    status: readString(value.status, "unknown"),
    mission_id: typeof value.mission_id === "string" ? redactText(value.mission_id) : undefined,
    proposal_id: typeof value.proposal_id === "string" ? redactText(value.proposal_id) : undefined,
    review_request_id: typeof value.review_request_id === "string" ? redactText(value.review_request_id) : undefined,
    apply_id: typeof value.apply_id === "string" ? redactText(value.apply_id) : undefined,
    source_kind: readString(value.source_kind, "unknown"),
    objective: preview(readString(value.objective, "")),
    title: preview(readString(value.title, "")),
    commander_context_summary: preview(readString(value.commander_context_summary, "")),
    opencode_context_seed: preview(readString(value.opencode_context_seed, "")),
    shared_context_summary: preview(readString(value.shared_context_summary, "")),
    max_context_bytes: readNumber(value.max_context_bytes, 0),
    success_criteria: readStringList(value.success_criteria, 10).map(preview),
    constraints: readStringList(value.constraints, 10).map(preview),
    artifact_expectations: readStringList(value.artifact_expectations, 10).map(preview),
    timeout_policy: readOpenCodeSessionTimeoutPolicy(value.timeout_policy),
    question_policy: readOpenCodeSessionQuestionPolicy(value.question_policy),
    human_control_policy: readOpenCodeSessionHumanPolicy(value.human_control_policy),
    created_at: readString(value.created_at, ""),
    created_by: readString(value.created_by, ""),
    session_hash: readString(value.session_hash, ""),
  }
}

function readOpenCodeSessionRecords(value: unknown): OpenCodeSessionRecordSummary[] {
  if (!Array.isArray(value)) throw new Error("runtime.list_opencode_sessions returned invalid records")
  return value.filter(isRecord).slice(0, HANDOFF_LIMIT).map((record) => ({
    session_id: readString(record.session_id, ""),
    status: readString(record.status, "unknown"),
    title: preview(readString(record.title, "")),
    mission_id: typeof record.mission_id === "string" ? redactText(record.mission_id) : undefined,
    proposal_id: typeof record.proposal_id === "string" ? redactText(record.proposal_id) : undefined,
    source_kind: readString(record.source_kind, "unknown"),
    created_at: readString(record.created_at, ""),
    updated_at: typeof record.updated_at === "string" ? readString(record.updated_at, "") : undefined,
    summary_preview: preview(readString(record.summary_preview, "")),
    session_hash: readString(record.session_hash, ""),
  }))
}

function readOpenCodeSessionSummary(value: unknown): OpenCodeSessionSummary {
  if (!isRecord(value)) throw new Error("runtime.opencode_session_summary returned invalid summary")
  return {
    total_sessions: readNumber(value.total_sessions, 0),
    planned_count: readNumber(value.planned_count, 0),
    running_count: readNumber(value.running_count, 0),
    paused_count: readNumber(value.paused_count, 0),
    blocked_count: readNumber(value.blocked_count, 0),
    completed_count: readNumber(value.completed_count, 0),
    failed_count: readNumber(value.failed_count, 0),
    cancelled_count: readNumber(value.cancelled_count, 0),
    generated_at: readString(value.generated_at, ""),
  }
}

function readOpenCodeSessionTimeoutPolicy(value: unknown): OpenCodeSessionPreviewSummary["timeout_policy"] {
  const record = isRecord(value) ? value : {}
  return {
    max_wall_time_ms: readNumber(record.max_wall_time_ms, 0),
    max_no_progress_ms: readNumber(record.max_no_progress_ms, 0),
    heartbeat_interval_ms: readNumber(record.heartbeat_interval_ms, 0),
    max_tool_idle_ms: typeof record.max_tool_idle_ms === "number" ? record.max_tool_idle_ms : undefined,
    forced_pause_enabled: readBoolean(record.forced_pause_enabled),
    report_required_on_timeout: readBoolean(record.report_required_on_timeout),
    timeout_policy_hash: readString(record.timeout_policy_hash, ""),
  }
}

function readOpenCodeSessionQuestionPolicy(value: unknown): OpenCodeSessionPreviewSummary["question_policy"] {
  const record = isRecord(value) ? value : {}
  return {
    allow_opencode_questions: readBoolean(record.allow_opencode_questions),
    commander_answer_required_for_blockers: readBoolean(record.commander_answer_required_for_blockers),
    human_escalation_allowed: readBoolean(record.human_escalation_allowed),
    max_pending_questions: readNumber(record.max_pending_questions, 0),
    question_policy_hash: readString(record.question_policy_hash, ""),
  }
}

function readOpenCodeSessionHumanPolicy(value: unknown): OpenCodeSessionPreviewSummary["human_control_policy"] {
  const record = isRecord(value) ? value : {}
  return {
    allow_human_pause: readBoolean(record.allow_human_pause),
    allow_human_override: readBoolean(record.allow_human_override),
    allow_human_stop: readBoolean(record.allow_human_stop),
    allow_human_guidance_note: readBoolean(record.allow_human_guidance_note),
    require_reason_for_stop: readBoolean(record.require_reason_for_stop),
    human_policy_hash: readString(record.human_policy_hash, ""),
  }
}

function readOpenCodeSessionCommands(value: unknown): OpenCodeSessionPreviewSummary["recommended_commands"] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((command) => ({
    label: preview(readString(command.label, "")),
    command: preview(readString(command.command, "")),
    command_type: command.command_type === "write" ? "write" : "read",
    requires_active_runtime: command.requires_active_runtime === true,
    notes: typeof command.notes === "string" ? preview(readString(command.notes, "")) : undefined,
  }))
}

function readModelCapabilities(value: unknown): ModelCapabilitySummary[] {
  if (!Array.isArray(value)) throw new Error("runtime.list_model_capabilities returned invalid capabilities")
  return value.filter(isRecord).slice(0, HANDOFF_LIMIT).map(readModelCapability)
}

function readModelCapability(value: unknown): ModelCapabilitySummary {
  if (!isRecord(value) || typeof value.capability_id !== "string") throw new Error("runtime.get_model_capability returned invalid capability")
  return {
    capability_id: redactText(value.capability_id),
    provider_kind: readString(value.provider_kind, "unknown"),
    provider_id: typeof value.provider_id === "string" ? redactText(value.provider_id) : undefined,
    model_id: readString(value.model_id, "unknown"),
    display_name: preview(readString(value.display_name, "")),
    role_support: readStringList(value.role_support, 8),
    max_context_tokens: typeof value.max_context_tokens === "number" ? readNumber(value.max_context_tokens, 0) : undefined,
    max_output_tokens: typeof value.max_output_tokens === "number" ? readNumber(value.max_output_tokens, 0) : undefined,
    max_context_bytes: typeof value.max_context_bytes === "number" ? readNumber(value.max_context_bytes, 0) : undefined,
    supports_tools: readTriState(value.supports_tools),
    supports_json_schema: readTriState(value.supports_json_schema),
    supports_mcp: readTriState(value.supports_mcp),
    supports_long_context: readTriState(value.supports_long_context),
    supports_streaming: readTriState(value.supports_streaming),
    supports_local_execution: readTriState(value.supports_local_execution),
    default_temperature: typeof value.default_temperature === "number" ? value.default_temperature : undefined,
    safety_margin_ratio: typeof value.safety_margin_ratio === "number" ? value.safety_margin_ratio : 0.2,
    source: readString(value.source, "unknown"),
    warnings: readStringList(value.warnings, 10).map(preview),
    created_at: typeof value.created_at === "string" ? readString(value.created_at, "") : undefined,
  }
}

function readContextBudgetSummary(value: unknown): ContextBudgetSummaryState {
  if (!isRecord(value)) throw new Error("runtime.context_budget_summary returned invalid summary")
  return {
    total_capabilities: readNumber(value.total_capabilities, 0),
    known_context_count: readNumber(value.known_context_count, 0),
    unknown_context_count: readNumber(value.unknown_context_count, 0),
    local_model_count: readNumber(value.local_model_count, 0),
    cloud_model_count: readNumber(value.cloud_model_count, 0),
    long_context_count: readNumber(value.long_context_count, 0),
    generated_at: readString(value.generated_at, ""),
  }
}

function readContextBudgetPreview(value: unknown): ContextBudgetPreviewSummary {
  if (!isRecord(value) || typeof value.preview_id !== "string") throw new Error("runtime.preview_context_budget returned invalid preview")
  return {
    preview_id: redactText(value.preview_id),
    purpose: readString(value.purpose, "unknown"),
    role: readString(value.role, "unknown"),
    capability: isRecord(value.capability) ? readModelCapability(value.capability) : undefined,
    session_id: typeof value.session_id === "string" ? redactText(value.session_id) : undefined,
    session_max_context_bytes: typeof value.session_max_context_bytes === "number" ? readNumber(value.session_max_context_bytes, 0) : undefined,
    budget: readContextBudgetProfile(value.budget),
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    recommended_commands: readContextBudgetCommands(value.recommended_commands),
    generated_at: readString(value.generated_at, ""),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readContextBudgetProfile(value: unknown): ContextBudgetProfileSummary {
  const record = isRecord(value) ? value : {}
  return {
    budget_id: readString(record.budget_id, ""),
    purpose: readString(record.purpose, "unknown"),
    provider_kind: readString(record.provider_kind, "unknown"),
    model_id: readString(record.model_id, "unknown"),
    session_id: typeof record.session_id === "string" ? redactText(record.session_id) : undefined,
    max_context_tokens: typeof record.max_context_tokens === "number" ? readNumber(record.max_context_tokens, 0) : undefined,
    max_context_bytes: typeof record.max_context_bytes === "number" ? readNumber(record.max_context_bytes, 0) : undefined,
    max_output_tokens: typeof record.max_output_tokens === "number" ? readNumber(record.max_output_tokens, 0) : undefined,
    safety_margin_tokens: typeof record.safety_margin_tokens === "number" ? readNumber(record.safety_margin_tokens, 0) : undefined,
    safety_margin_bytes: typeof record.safety_margin_bytes === "number" ? readNumber(record.safety_margin_bytes, 0) : undefined,
    allocations: readContextBudgetAllocations(record.allocations),
    warnings: readStringList(record.warnings, 10).map(preview),
    generated_at: readString(record.generated_at, ""),
  }
}

function readContextBudgetAllocations(value: unknown): ContextBudgetPreviewSummary["budget"]["allocations"] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 18).map((allocation) => ({
    section: readString(allocation.section, "unknown"),
    max_tokens: typeof allocation.max_tokens === "number" ? readNumber(allocation.max_tokens, 0) : undefined,
    max_bytes: typeof allocation.max_bytes === "number" ? readNumber(allocation.max_bytes, 0) : undefined,
    priority: readPriority(allocation.priority),
    inclusion_policy: readInclusionPolicy(allocation.inclusion_policy),
    notes: typeof allocation.notes === "string" ? preview(readString(allocation.notes, "")) : undefined,
  }))
}

function readContextBudgetCommands(value: unknown): ContextBudgetPreviewSummary["recommended_commands"] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((command) => ({
    label: preview(readString(command.label, "")),
    command: preview(readString(command.command, "")),
    command_type: command.command_type === "write" ? "write" : "read",
    requires_active_runtime: command.requires_active_runtime === true,
    notes: typeof command.notes === "string" ? preview(readString(command.notes, "")) : undefined,
  }))
}

function readContextPacketSummary(value: unknown): ContextPacketSummaryState {
  if (!isRecord(value)) throw new Error("runtime.context_packet_summary returned invalid summary")
  return {
    supported_purposes: readStringList(value.supported_purposes, 12),
    supported_roles: readStringList(value.supported_roles, 8),
    generated_at: readString(value.generated_at, ""),
  }
}

function readContextPacketPreview(value: unknown): ContextPacketPreviewSummary {
  if (!isRecord(value) || typeof value.packet_id !== "string") throw new Error("runtime.preview_context_packet returned invalid preview")
  return {
    packet_id: redactText(value.packet_id),
    role: readString(value.role, "unknown"),
    purpose: readString(value.purpose, "unknown"),
    budget_id: readString(value.budget_id, ""),
    provider_kind: typeof value.provider_kind === "string" ? readString(value.provider_kind, "unknown") : undefined,
    model_id: typeof value.model_id === "string" ? readString(value.model_id, "unknown") : undefined,
    session_id: typeof value.session_id === "string" ? redactText(value.session_id) : undefined,
    mission_id: typeof value.mission_id === "string" ? redactText(value.mission_id) : undefined,
    proposal_id: typeof value.proposal_id === "string" ? redactText(value.proposal_id) : undefined,
    review_request_id: typeof value.review_request_id === "string" ? redactText(value.review_request_id) : undefined,
    apply_id: typeof value.apply_id === "string" ? redactText(value.apply_id) : undefined,
    packet_status: readString(value.packet_status, "unknown"),
    can_compile_final_prompt: false,
    sections: readContextPacketSections(value.sections),
    included_source_refs: readContextPacketSourceRefs(value.included_source_refs),
    omitted_source_refs: readContextPacketSourceRefs(value.omitted_source_refs),
    budget_summary: readContextPacketBudgetSummary(value.budget_summary),
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 12).map(preview),
    recommended_commands: readContextPacketCommands(value.recommended_commands),
    generated_at: readString(value.generated_at, ""),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
    packet_hash: readString(value.packet_hash, ""),
  }
}

function readContextPacketSections(value: unknown): ContextPacketPreviewSummary["sections"] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 18).map((section) => ({
    section: readString(section.section, "unknown"),
    status: readString(section.status, "unknown"),
    priority: readPriority(section.priority),
    inclusion_policy: readInclusionPolicy(section.inclusion_policy),
    max_tokens: typeof section.max_tokens === "number" ? readNumber(section.max_tokens, 0) : undefined,
    max_bytes: typeof section.max_bytes === "number" ? readNumber(section.max_bytes, 0) : undefined,
    estimated_tokens: typeof section.estimated_tokens === "number" ? readNumber(section.estimated_tokens, 0) : undefined,
    estimated_bytes: typeof section.estimated_bytes === "number" ? readNumber(section.estimated_bytes, 0) : undefined,
    summary_preview: preview(readString(section.summary_preview, "")),
    source_refs: readContextPacketSourceRefs(section.source_refs),
    omitted_reason: typeof section.omitted_reason === "string" ? preview(readString(section.omitted_reason, "")) : undefined,
    warnings: readStringList(section.warnings, 6).map(preview),
  }))
}

function readContextPacketSourceRefs(value: unknown): ContextPacketPreviewSummary["included_source_refs"] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 20).map((ref) => ({
    source_kind: readString(ref.source_kind, "unknown"),
    source_id: redactText(readString(ref.source_id, "")),
    label: typeof ref.label === "string" ? preview(readString(ref.label, "")) : undefined,
    summary_preview: typeof ref.summary_preview === "string" ? preview(readString(ref.summary_preview, "")) : undefined,
    event_kind: typeof ref.event_kind === "string" ? readString(ref.event_kind, "") : undefined,
    pointer_only: ref.pointer_only === true,
  }))
}

function readContextPacketBudgetSummary(value: unknown): ContextPacketPreviewSummary["budget_summary"] {
  const record = isRecord(value) ? value : {}
  return {
    max_context_tokens: typeof record.max_context_tokens === "number" ? readNumber(record.max_context_tokens, 0) : undefined,
    max_context_bytes: typeof record.max_context_bytes === "number" ? readNumber(record.max_context_bytes, 0) : undefined,
    max_output_tokens: typeof record.max_output_tokens === "number" ? readNumber(record.max_output_tokens, 0) : undefined,
    safety_margin_tokens: typeof record.safety_margin_tokens === "number" ? readNumber(record.safety_margin_tokens, 0) : undefined,
    safety_margin_bytes: typeof record.safety_margin_bytes === "number" ? readNumber(record.safety_margin_bytes, 0) : undefined,
    estimated_input_tokens: typeof record.estimated_input_tokens === "number" ? readNumber(record.estimated_input_tokens, 0) : undefined,
    estimated_input_bytes: typeof record.estimated_input_bytes === "number" ? readNumber(record.estimated_input_bytes, 0) : undefined,
    over_budget: record.over_budget === true,
  }
}

function readContextPacketCommands(value: unknown): ContextPacketPreviewSummary["recommended_commands"] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((command) => ({
    label: preview(readString(command.label, "")),
    command: preview(readString(command.command, "")),
    command_type: command.command_type === "write" ? "write" : "read",
    requires_active_runtime: command.requires_active_runtime === true,
    notes: typeof command.notes === "string" ? preview(readString(command.notes, "")) : undefined,
  }))
}

function readOpenCodeSessionInstructionPackPreview(value: unknown): OpenCodeSessionInstructionPackPreviewSummary {
  if (!isRecord(value) || typeof value.preview_id !== "string") throw new Error("runtime.preview_opencode_session_instruction_pack returned invalid preview")
  return {
    preview_id: redactText(value.preview_id),
    status: readString(value.status, "unknown"),
    can_write: value.can_write === true,
    session_id: redactText(readString(value.session_id, "")),
    packet_id: typeof value.packet_id === "string" ? redactText(value.packet_id) : undefined,
    packet_hash: typeof value.packet_hash === "string" ? redactText(value.packet_hash) : undefined,
    budget_id: typeof value.budget_id === "string" ? redactText(value.budget_id) : undefined,
    source_kind: typeof value.source_kind === "string" ? readString(value.source_kind, "unknown") : undefined,
    mission_id: typeof value.mission_id === "string" ? redactText(value.mission_id) : undefined,
    proposal_id: typeof value.proposal_id === "string" ? redactText(value.proposal_id) : undefined,
    review_request_id: typeof value.review_request_id === "string" ? redactText(value.review_request_id) : undefined,
    apply_id: typeof value.apply_id === "string" ? redactText(value.apply_id) : undefined,
    target_dir: readString(value.target_dir, ""),
    files: readOpenCodeSessionInstructionPackFiles(value.files),
    total_size_bytes: readNumber(value.total_size_bytes, 0),
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 12).map(preview),
    recommended_commands: readOpenCodeSessionInstructionPackCommands(value.recommended_commands),
    generated_at: readString(value.generated_at, ""),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
    pack_hash: readString(value.pack_hash, ""),
  }
}

function readOpenCodeSessionInstructionPackResult(value: unknown): OpenCodeSessionInstructionPackResultSummary {
  if (!isRecord(value) || typeof value.pack_id !== "string") throw new Error("runtime.write_opencode_session_instruction_pack returned invalid result")
  return {
    pack_id: redactText(value.pack_id),
    status: readString(value.status, "unknown"),
    session_id: redactText(readString(value.session_id, "")),
    packet_id: typeof value.packet_id === "string" ? redactText(value.packet_id) : undefined,
    packet_hash: typeof value.packet_hash === "string" ? redactText(value.packet_hash) : undefined,
    budget_id: typeof value.budget_id === "string" ? redactText(value.budget_id) : undefined,
    target_dir: readString(value.target_dir, ""),
    files: readOpenCodeSessionInstructionPackFiles(value.files),
    total_size_bytes: readNumber(value.total_size_bytes, 0),
    written_at: readString(value.written_at, ""),
    written_by: readString(value.written_by, ""),
    error: typeof value.error === "string" ? preview(readString(value.error, "")) : undefined,
    pack_hash: readString(value.pack_hash, ""),
    recommended_commands: readOpenCodeSessionInstructionPackCommands(value.recommended_commands),
  }
}

function readOpenCodeSessionInstructionPackRecords(value: unknown): OpenCodeSessionInstructionPackRecordSummary[] {
  if (!Array.isArray(value)) throw new Error("runtime.list_opencode_session_instruction_packs returned invalid records")
  return value.filter(isRecord).slice(0, HANDOFF_LIMIT).map((record) => ({
    pack_id: redactText(readString(record.pack_id, "")),
    status: readString(record.status, "unknown"),
    session_id: redactText(readString(record.session_id, "")),
    packet_id: typeof record.packet_id === "string" ? redactText(record.packet_id) : undefined,
    target_dir: readString(record.target_dir, ""),
    file_count: readNumber(record.file_count, 0),
    total_size_bytes: readNumber(record.total_size_bytes, 0),
    written_at: readString(record.written_at, ""),
    summary_preview: preview(readString(record.summary_preview, "")),
    pack_hash: readString(record.pack_hash, ""),
  }))
}

function readOpenCodeSessionInstructionPackFiles(value: unknown): OpenCodeSessionInstructionPackPreviewSummary["files"] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((file) => ({
    file_kind: readString(file.file_kind, "unknown"),
    relative_path: readString(file.relative_path, ""),
    would_write: file.would_write === true,
    size_bytes: readNumber(file.size_bytes, 0),
    sha256: readString(file.sha256, ""),
    summary_preview: preview(readString(file.summary_preview, "")),
    sections_used: readStringList(file.sections_used, 12),
    source_refs: readStringList(file.source_refs, 20),
    warnings: readStringList(file.warnings, 8).map(preview),
  }))
}

function readOpenCodeSessionInstructionPackCommands(value: unknown): OpenCodeSessionInstructionPackPreviewSummary["recommended_commands"] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((command) => ({
    label: preview(readString(command.label, "")),
    command: preview(readString(command.command, "")),
    command_type: command.command_type === "write" ? "write" : "read",
    requires_active_runtime: command.requires_active_runtime === true,
    notes: typeof command.notes === "string" ? preview(readString(command.notes, "")) : undefined,
  }))
}

function readOpenCodeLaunchReadinessPreview(value: unknown): OpenCodeLaunchReadinessPreviewSummary {
  if (!isRecord(value) || typeof value.preview_id !== "string") throw new Error("runtime.preview_opencode_launch_readiness returned invalid preview")
  return {
    preview_id: redactText(value.preview_id),
    status: readString(value.status, "unknown"),
    can_launch_in_future: value.can_launch_in_future === true,
    launch_performed: false,
    session_id: redactText(readString(value.session_id, "")),
    pack_id: typeof value.pack_id === "string" ? redactText(value.pack_id) : undefined,
    packet_id: typeof value.packet_id === "string" ? redactText(value.packet_id) : undefined,
    budget_id: typeof value.budget_id === "string" ? redactText(value.budget_id) : undefined,
    source_kind: typeof value.source_kind === "string" ? readString(value.source_kind, "unknown") : undefined,
    mission_id: typeof value.mission_id === "string" ? redactText(value.mission_id) : undefined,
    proposal_id: typeof value.proposal_id === "string" ? redactText(value.proposal_id) : undefined,
    review_request_id: typeof value.review_request_id === "string" ? redactText(value.review_request_id) : undefined,
    apply_id: typeof value.apply_id === "string" ? redactText(value.apply_id) : undefined,
    target_dir: typeof value.target_dir === "string" ? readString(value.target_dir, "") : undefined,
    instruction_files_verified: value.instruction_files_verified === true,
    manifest_verified: value.manifest_verified === true,
    config_verified: value.config_verified === true,
    context_packet_status: typeof value.context_packet_status === "string" ? readString(value.context_packet_status, "unknown") : undefined,
    context_budget_status: typeof value.context_budget_status === "string" ? readString(value.context_budget_status, "unknown") : undefined,
    research_memory_status: typeof value.research_memory_status === "string" ? readString(value.research_memory_status, "unknown") : undefined,
    novelty_risk: typeof value.novelty_risk === "string" ? readString(value.novelty_risk, "unknown") : undefined,
    selected_launch_surface: readString(value.selected_launch_surface, "unknown"),
    checks: readOpenCodeLaunchReadinessChecks(value.checks),
    blockers: readStringList(value.blockers, 12).map(preview),
    warnings: readStringList(value.warnings, 14).map(preview),
    recommended_commands: readOpenCodeLaunchReadinessCommands(value.recommended_commands),
    generated_at: readString(value.generated_at, ""),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
    readiness_hash: readString(value.readiness_hash, ""),
  }
}

function readOpenCodeLaunchReadinessSummary(value: unknown): OpenCodeLaunchReadinessSummaryState {
  if (!isRecord(value)) throw new Error("runtime.opencode_launch_readiness_summary returned invalid summary")
  return {
    total_planned_sessions: readNumber(value.total_planned_sessions, 0),
    ready_count: readNumber(value.ready_count, 0),
    blocked_count: readNumber(value.blocked_count, 0),
    partial_count: readNumber(value.partial_count, 0),
    generated_at: readString(value.generated_at, ""),
  }
}

function readOpenCodeLaunchReadinessChecks(value: unknown): OpenCodeLaunchReadinessCheckSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 16).map((item) => ({
    check_id: readString(item.check_id, "unknown"),
    label: preview(readString(item.label, "")),
    status: readString(item.status, "unknown"),
    summary_preview: preview(readString(item.summary_preview, "")),
    blockers: readStringList(item.blockers, 8).map(preview),
    warnings: readStringList(item.warnings, 8).map(preview),
    source_refs: readOpenCodeLaunchReadinessSourceRefs(item.source_refs),
  }))
}

function readOpenCodeLaunchReadinessSourceRefs(value: unknown): OpenCodeLaunchReadinessSourceRefSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 20).map((item) => ({
    source_kind: readString(item.source_kind, "unknown"),
    source_id: preview(readString(item.source_id, "")),
    label: typeof item.label === "string" ? preview(readString(item.label, "")) : undefined,
    summary_preview: typeof item.summary_preview === "string" ? preview(readString(item.summary_preview, "")) : undefined,
    pointer_only: true,
  }))
}

function readOpenCodeLaunchReadinessCommands(value: unknown): OpenCodeLaunchReadinessCommandSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((command) => ({
    label: preview(readString(command.label, "")),
    command: preview(readString(command.command, "")),
    command_type: command.command_type === "write" ? "write" : "read",
    requires_active_runtime: command.requires_active_runtime === true,
    notes: typeof command.notes === "string" ? preview(readString(command.notes, "")) : undefined,
  }))
}

function readOpenCodeLaunchPreview(value: unknown): OpenCodeLaunchPreviewSummary {
  if (!isRecord(value) || typeof value.preview_id !== "string") throw new Error("runtime.preview_opencode_session_launch returned invalid preview")
  return {
    preview_id: redactText(value.preview_id),
    status: readString(value.status, "blocked"),
    can_launch: value.can_launch === true,
    launch_performed: false,
    adapter_kind: readString(value.adapter_kind, "unknown"),
    launch_mode: readString(value.launch_mode, "fresh"),
    session_id: redactText(readString(value.session_id, "")),
    pack_id: typeof value.pack_id === "string" ? redactText(value.pack_id) : undefined,
    readiness_hash: typeof value.readiness_hash === "string" ? readString(value.readiness_hash, "") : undefined,
    readiness_status: typeof value.readiness_status === "string" ? readString(value.readiness_status, "unknown") : undefined,
    packet_id: typeof value.packet_id === "string" ? redactText(value.packet_id) : undefined,
    packet_hash: typeof value.packet_hash === "string" ? readString(value.packet_hash, "") : undefined,
    budget_id: typeof value.budget_id === "string" ? redactText(value.budget_id) : undefined,
    target_dir: typeof value.target_dir === "string" ? preview(readString(value.target_dir, "")) : undefined,
    command_preview: typeof value.command_preview === "string" ? preview(readString(value.command_preview, "")) : undefined,
    env_preview: typeof value.env_preview === "string" ? preview(readString(value.env_preview, "")) : undefined,
    instruction_files: readStringList(value.instruction_files, 12),
    blockers: readStringList(value.blockers, 12).map(preview),
    warnings: readStringList(value.warnings, 14).map(preview),
    recommended_commands: readOpenCodeLaunchCommands(value.recommended_commands),
    generated_at: readString(value.generated_at, ""),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
    launch_hash: readString(value.launch_hash, ""),
  }
}

function readOpenCodeLaunchResult(value: unknown): OpenCodeLaunchResultSummary {
  if (!isRecord(value) || typeof value.launch_id !== "string") throw new Error("runtime.launch_opencode_session returned invalid result")
  return {
    launch_id: redactText(value.launch_id),
    status: readString(value.status, "blocked"),
    adapter_kind: readString(value.adapter_kind, "unknown"),
    launch_mode: readString(value.launch_mode, "fresh"),
    session_id: redactText(readString(value.session_id, "")),
    pack_id: typeof value.pack_id === "string" ? redactText(value.pack_id) : undefined,
    readiness_hash: typeof value.readiness_hash === "string" ? readString(value.readiness_hash, "") : undefined,
    packet_id: typeof value.packet_id === "string" ? redactText(value.packet_id) : undefined,
    packet_hash: typeof value.packet_hash === "string" ? readString(value.packet_hash, "") : undefined,
    budget_id: typeof value.budget_id === "string" ? redactText(value.budget_id) : undefined,
    target_dir: typeof value.target_dir === "string" ? preview(readString(value.target_dir, "")) : undefined,
    process_id: typeof value.process_id === "number" ? readNumber(value.process_id, 0) : undefined,
    native_session_id: typeof value.native_session_id === "string" ? redactText(value.native_session_id) : undefined,
    command_preview: typeof value.command_preview === "string" ? preview(readString(value.command_preview, "")) : undefined,
    started_at: typeof value.started_at === "string" ? readString(value.started_at, "") : undefined,
    completed_at: typeof value.completed_at === "string" ? readString(value.completed_at, "") : undefined,
    exit_code: typeof value.exit_code === "number" ? readNumber(value.exit_code, 0) : undefined,
    error: typeof value.error === "string" ? preview(readString(value.error, "")) : undefined,
    launch_performed: value.launch_performed === true,
    output_summary_preview: typeof value.output_summary_preview === "string" ? preview(readString(value.output_summary_preview, "")) : undefined,
    event_count: typeof value.event_count === "number" ? readNumber(value.event_count, 0) : undefined,
    launch_hash: readString(value.launch_hash, ""),
    recommended_commands: readOpenCodeLaunchCommands(value.recommended_commands),
  }
}

function readOpenCodeLaunchRecords(value: unknown): OpenCodeLaunchRecordSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 20).map(readOpenCodeLaunchRecord)
}

function readOpenCodeLaunchRecord(value: Record<string, unknown>): OpenCodeLaunchRecordSummary {
  return {
    launch_id: redactText(readString(value.launch_id, "")),
    status: readString(value.status, "unknown"),
    adapter_kind: readString(value.adapter_kind, "unknown"),
    launch_mode: readString(value.launch_mode, "fresh"),
    session_id: redactText(readString(value.session_id, "")),
    pack_id: typeof value.pack_id === "string" ? redactText(value.pack_id) : undefined,
    native_session_id: typeof value.native_session_id === "string" ? redactText(value.native_session_id) : undefined,
    process_id: typeof value.process_id === "number" ? readNumber(value.process_id, 0) : undefined,
    started_at: readString(value.started_at, ""),
    completed_at: typeof value.completed_at === "string" ? readString(value.completed_at, "") : undefined,
    exit_code: typeof value.exit_code === "number" ? readNumber(value.exit_code, 0) : undefined,
    summary_preview: preview(readString(value.summary_preview, "")),
    launch_hash: readString(value.launch_hash, ""),
  }
}

function readOpenCodeLaunchCommands(value: unknown): OpenCodeLaunchCommandSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((command) => ({
    label: preview(readString(command.label, "")),
    command: preview(readString(command.command, "")),
    command_type: command.command_type === "write" ? "write" : "read",
    requires_active_runtime: command.requires_active_runtime === true,
    notes: typeof command.notes === "string" ? preview(readString(command.notes, "")) : undefined,
  }))
}

function readOpenCodeProgressPreview(value: unknown): OpenCodeProgressPreviewSummary {
  if (!isRecord(value) || typeof value.preview_id !== "string") throw new Error("runtime.preview_opencode_progress returned invalid preview")
  return {
    preview_id: redactText(value.preview_id),
    status: readString(value.status, "blocked"),
    can_record: value.can_record === true,
    session_id: redactText(readString(value.session_id, "")),
    launch_id: typeof value.launch_id === "string" ? redactText(value.launch_id) : undefined,
    launch_status: typeof value.launch_status === "string" ? readString(value.launch_status, "unknown") : undefined,
    launch_started_at: typeof value.launch_started_at === "string" ? readString(value.launch_started_at, "") : undefined,
    kind: readString(value.kind, "heartbeat"),
    execution_state: readString(value.execution_state, "unknown"),
    report_summary_preview: preview(readString(value.report_summary_preview, "")),
    current_step_preview: typeof value.current_step_preview === "string" ? preview(readString(value.current_step_preview, "")) : undefined,
    files_touched_preview: readStringList(value.files_touched_preview, 12).map(preview),
    commands_run_preview: readStringList(value.commands_run_preview, 12).map(preview),
    tests_run_preview: readStringList(value.tests_run_preview, 12).map(preview),
    artifacts_preview: readStringList(value.artifacts_preview, 12).map(preview),
    blockers_preview: readStringList(value.blockers_preview, 12).map(preview),
    question_preview: typeof value.question_preview === "string" ? preview(readString(value.question_preview, "")) : undefined,
    confidence: typeof value.confidence === "number" ? readNumber(value.confidence, 0) : typeof value.confidence === "string" ? readString(value.confidence, "unknown") : undefined,
    next_action_preview: typeof value.next_action_preview === "string" ? preview(readString(value.next_action_preview, "")) : undefined,
    source_kind: readString(value.source_kind, "manual"),
    blockers: readStringList(value.blockers, 12).map(preview),
    warnings: readStringList(value.warnings, 14).map(preview),
    recommended_commands: readOpenCodeProgressCommands(value.recommended_commands),
    generated_at: readString(value.generated_at, ""),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
    progress_hash: readString(value.progress_hash, ""),
  }
}

function readOpenCodeProgressResult(value: unknown): OpenCodeProgressResultSummary {
  if (!isRecord(value) || typeof value.progress_id !== "string") throw new Error("runtime.record_opencode_progress returned invalid result")
  return {
    progress_id: redactText(value.progress_id),
    status: readString(value.status, "blocked"),
    session_id: redactText(readString(value.session_id, "")),
    launch_id: typeof value.launch_id === "string" ? redactText(value.launch_id) : undefined,
    kind: readString(value.kind, "heartbeat"),
    execution_state: readString(value.execution_state, "unknown"),
    report_summary_preview: preview(readString(value.report_summary_preview, "")),
    current_step_preview: typeof value.current_step_preview === "string" ? preview(readString(value.current_step_preview, "")) : undefined,
    files_touched_preview: readStringList(value.files_touched_preview, 12).map(preview),
    commands_run_preview: readStringList(value.commands_run_preview, 12).map(preview),
    tests_run_preview: readStringList(value.tests_run_preview, 12).map(preview),
    artifacts_preview: readStringList(value.artifacts_preview, 12).map(preview),
    blockers_preview: readStringList(value.blockers_preview, 12).map(preview),
    question_preview: typeof value.question_preview === "string" ? preview(readString(value.question_preview, "")) : undefined,
    confidence: typeof value.confidence === "number" ? readNumber(value.confidence, 0) : typeof value.confidence === "string" ? readString(value.confidence, "unknown") : undefined,
    next_action_preview: typeof value.next_action_preview === "string" ? preview(readString(value.next_action_preview, "")) : undefined,
    recorded_at: readString(value.recorded_at, ""),
    recorded_by: preview(readString(value.recorded_by, "")),
    source_kind: readString(value.source_kind, "manual"),
    error: typeof value.error === "string" ? preview(readString(value.error, "")) : undefined,
    progress_hash: readString(value.progress_hash, ""),
    recommended_commands: readOpenCodeProgressCommands(value.recommended_commands),
  }
}

function readOpenCodeProgressRecords(value: unknown): OpenCodeProgressRecordSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 20).map(readOpenCodeProgressRecord)
}

function readOpenCodeProgressRecord(value: Record<string, unknown>): OpenCodeProgressRecordSummary {
  return {
    progress_id: redactText(readString(value.progress_id, "")),
    session_id: redactText(readString(value.session_id, "")),
    launch_id: typeof value.launch_id === "string" ? redactText(value.launch_id) : undefined,
    kind: readString(value.kind, "heartbeat"),
    execution_state: readString(value.execution_state, "unknown"),
    report_summary_preview: preview(readString(value.report_summary_preview, "")),
    recorded_at: readString(value.recorded_at, ""),
    recorded_by: preview(readString(value.recorded_by, "")),
    source_kind: readString(value.source_kind, "manual"),
    confidence: typeof value.confidence === "number" ? readNumber(value.confidence, 0) : typeof value.confidence === "string" ? readString(value.confidence, "unknown") : undefined,
    has_blockers: value.has_blockers === true,
    has_question: value.has_question === true,
    progress_hash: readString(value.progress_hash, ""),
  }
}

function readOpenCodeProgressSummary(value: unknown): OpenCodeProgressSummaryState {
  if (!isRecord(value)) throw new Error("runtime.opencode_progress_summary returned invalid summary")
  return {
    total_records: readNumber(value.total_records, 0),
    session_count: readNumber(value.session_count, 0),
    launched_session_count: readNumber(value.launched_session_count, 0),
    latest_records: readOpenCodeProgressRecords(value.latest_records),
    blocked_count: readNumber(value.blocked_count, 0),
    question_count: readNumber(value.question_count, 0),
    heartbeat_count: readNumber(value.heartbeat_count, 0),
    generated_at: readString(value.generated_at, ""),
  }
}

function readOpenCodeProgressCommands(value: unknown): OpenCodeProgressCommandSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((command) => ({
    label: preview(readString(command.label, "")),
    command: preview(readString(command.command, "")),
    command_type: command.command_type === "write" ? "write" : "read",
    requires_active_runtime: command.requires_active_runtime === true,
    notes: typeof command.notes === "string" ? preview(readString(command.notes, "")) : undefined,
  }))
}

function readOpenCodeWatchdogPreview(value: unknown): OpenCodeWatchdogPreviewSummary {
  if (!isRecord(value) || typeof value.preview_id !== "string") throw new Error("runtime.preview_opencode_watchdog returned invalid preview")
  return {
    preview_id: redactText(value.preview_id),
    status: readString(value.status, "blocked"),
    can_record: value.can_record === true,
    session_id: redactText(readString(value.session_id, "")),
    launch_id: typeof value.launch_id === "string" ? redactText(value.launch_id) : undefined,
    launch_status: typeof value.launch_status === "string" ? readString(value.launch_status, "unknown") : undefined,
    watchdog_status: readString(value.watchdog_status, "unknown"),
    recommended_action: readString(value.recommended_action, "none"),
    wall_clock_elapsed_ms: readOptionalNumber(value.wall_clock_elapsed_ms),
    no_progress_elapsed_ms: readOptionalNumber(value.no_progress_elapsed_ms),
    heartbeat_elapsed_ms: readOptionalNumber(value.heartbeat_elapsed_ms),
    max_wall_time_ms: readOptionalNumber(value.max_wall_time_ms),
    max_no_progress_ms: readOptionalNumber(value.max_no_progress_ms),
    heartbeat_interval_ms: readOptionalNumber(value.heartbeat_interval_ms),
    forced_pause_enabled: typeof value.forced_pause_enabled === "boolean" ? value.forced_pause_enabled : undefined,
    report_required_on_timeout: typeof value.report_required_on_timeout === "boolean" ? value.report_required_on_timeout : undefined,
    latest_progress_id: typeof value.latest_progress_id === "string" ? redactText(value.latest_progress_id) : undefined,
    latest_progress_kind: typeof value.latest_progress_kind === "string" ? readString(value.latest_progress_kind, "unknown") : undefined,
    latest_progress_state: typeof value.latest_progress_state === "string" ? readString(value.latest_progress_state, "unknown") : undefined,
    latest_progress_at: typeof value.latest_progress_at === "string" ? readString(value.latest_progress_at, "") : undefined,
    latest_report_summary_preview: typeof value.latest_report_summary_preview === "string" ? preview(readString(value.latest_report_summary_preview, "")) : undefined,
    has_blockers: value.has_blockers === true,
    has_question: value.has_question === true,
    blockers_preview: readStringList(value.blockers_preview, 12).map(preview),
    question_preview: typeof value.question_preview === "string" ? preview(readString(value.question_preview, "")) : undefined,
    report_required: value.report_required === true,
    forced_report_already_requested: value.forced_report_already_requested === true,
    blockers: readStringList(value.blockers, 12).map(preview),
    warnings: readStringList(value.warnings, 14).map(preview),
    recommended_commands: readOpenCodeWatchdogCommands(value.recommended_commands),
    generated_at: readString(value.generated_at, ""),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
    watchdog_hash: readString(value.watchdog_hash, ""),
  }
}

function readOpenCodeWatchdogResult(value: unknown): OpenCodeWatchdogResultSummary {
  if (!isRecord(value) || typeof value.watchdog_id !== "string") throw new Error("runtime.record_opencode_watchdog returned invalid result")
  return {
    watchdog_id: redactText(value.watchdog_id),
    status: readString(value.status, "blocked"),
    session_id: redactText(readString(value.session_id, "")),
    launch_id: typeof value.launch_id === "string" ? redactText(value.launch_id) : undefined,
    watchdog_status: readString(value.watchdog_status, "unknown"),
    recommended_action: readString(value.recommended_action, "none"),
    report_required: value.report_required === true,
    forced_report_requested: value.forced_report_requested === true,
    forced_report_request_id: typeof value.forced_report_request_id === "string" ? redactText(value.forced_report_request_id) : undefined,
    latest_progress_id: typeof value.latest_progress_id === "string" ? redactText(value.latest_progress_id) : undefined,
    latest_progress_kind: typeof value.latest_progress_kind === "string" ? readString(value.latest_progress_kind, "unknown") : undefined,
    latest_progress_state: typeof value.latest_progress_state === "string" ? readString(value.latest_progress_state, "unknown") : undefined,
    latest_progress_at: typeof value.latest_progress_at === "string" ? readString(value.latest_progress_at, "") : undefined,
    wall_clock_elapsed_ms: readOptionalNumber(value.wall_clock_elapsed_ms),
    no_progress_elapsed_ms: readOptionalNumber(value.no_progress_elapsed_ms),
    heartbeat_elapsed_ms: readOptionalNumber(value.heartbeat_elapsed_ms),
    recorded_at: readString(value.recorded_at, ""),
    recorded_by: preview(readString(value.recorded_by, "")),
    error: typeof value.error === "string" ? preview(readString(value.error, "")) : undefined,
    watchdog_hash: readString(value.watchdog_hash, ""),
    recommended_commands: readOpenCodeWatchdogCommands(value.recommended_commands),
  }
}

function readOpenCodeWatchdogRecords(value: unknown): OpenCodeWatchdogRecordSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 20).map((record) => ({
    watchdog_id: redactText(readString(record.watchdog_id, "")),
    session_id: redactText(readString(record.session_id, "")),
    launch_id: typeof record.launch_id === "string" ? redactText(record.launch_id) : undefined,
    watchdog_status: readString(record.watchdog_status, "unknown"),
    recommended_action: readString(record.recommended_action, "none"),
    report_required: record.report_required === true,
    recorded_at: readString(record.recorded_at, ""),
    recorded_by: preview(readString(record.recorded_by, "")),
    latest_progress_id: typeof record.latest_progress_id === "string" ? redactText(record.latest_progress_id) : undefined,
    watchdog_hash: readString(record.watchdog_hash, ""),
  }))
}

function readOpenCodeForcedReportRequest(value: unknown): OpenCodeForcedReportRequestSummary {
  if (!isRecord(value) || typeof value.request_id !== "string") throw new Error("runtime.request_opencode_forced_report returned invalid request")
  return {
    request_id: redactText(value.request_id),
    session_id: redactText(readString(value.session_id, "")),
    launch_id: typeof value.launch_id === "string" ? redactText(value.launch_id) : undefined,
    watchdog_id: typeof value.watchdog_id === "string" ? redactText(value.watchdog_id) : undefined,
    reason: preview(readString(value.reason, "")),
    requested_at: readString(value.requested_at, ""),
    requested_by: preview(readString(value.requested_by, "")),
    latest_progress_id: typeof value.latest_progress_id === "string" ? redactText(value.latest_progress_id) : undefined,
    report_due_after_ms: readOptionalNumber(value.report_due_after_ms),
    forced_pause_recommended: value.forced_pause_recommended === true,
    process_paused: false,
    command_to_operator_preview: typeof value.command_to_operator_preview === "string" ? preview(readString(value.command_to_operator_preview, "")) : undefined,
    request_hash: readString(value.request_hash, ""),
  }
}

function readOpenCodeForcedReportRequests(value: unknown): OpenCodeForcedReportRequestSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 20).map(readOpenCodeForcedReportRequest)
}

function readOpenCodeWatchdogSummary(value: unknown): OpenCodeWatchdogSummaryState {
  if (!isRecord(value)) throw new Error("runtime.opencode_watchdog_summary returned invalid summary")
  return {
    total_launched_sessions: readNumber(value.total_launched_sessions, 0),
    healthy_count: readNumber(value.healthy_count, 0),
    stale_count: readNumber(value.stale_count, 0),
    timed_out_count: readNumber(value.timed_out_count, 0),
    needs_report_count: readNumber(value.needs_report_count, 0),
    blocked_count: readNumber(value.blocked_count, 0),
    latest_records: readOpenCodeWatchdogRecords(value.latest_records),
    generated_at: readString(value.generated_at, ""),
  }
}

function readOpenCodeWatchdogCommands(value: unknown): OpenCodeWatchdogCommandSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((command) => ({
    label: preview(readString(command.label, "")),
    command: preview(readString(command.command, "")),
    command_type: command.command_type === "write" ? "write" : "read",
    requires_active_runtime: command.requires_active_runtime === true,
    notes: typeof command.notes === "string" ? preview(readString(command.notes, "")) : undefined,
  }))
}

function readOpenCodeCommanderQuestionPreview(value: unknown): OpenCodeCommanderQuestionPreviewSummary {
  if (!isRecord(value) || typeof value.preview_id !== "string") throw new Error("runtime.preview_opencode_commander_question returned invalid preview")
  return {
    preview_id: redactText(value.preview_id),
    status: readString(value.status, "blocked"),
    can_create: value.can_create === true,
    session_id: redactText(readString(value.session_id, "")),
    launch_id: typeof value.launch_id === "string" ? redactText(value.launch_id) : undefined,
    progress_id: typeof value.progress_id === "string" ? redactText(value.progress_id) : undefined,
    watchdog_id: typeof value.watchdog_id === "string" ? redactText(value.watchdog_id) : undefined,
    forced_report_request_id: typeof value.forced_report_request_id === "string" ? redactText(value.forced_report_request_id) : undefined,
    question_type: readString(value.question_type, "unknown"),
    urgency: readString(value.urgency, "normal"),
    question_preview: preview(readString(value.question_preview, "")),
    context_summary_preview: preview(readString(value.context_summary_preview, "")),
    options_considered_preview: readStringList(value.options_considered_preview, 8).map(preview),
    executor_recommendation_preview: typeof value.executor_recommendation_preview === "string" ? preview(readString(value.executor_recommendation_preview, "")) : undefined,
    evidence_summary_preview: typeof value.evidence_summary_preview === "string" ? preview(readString(value.evidence_summary_preview, "")) : undefined,
    source_kind: readString(value.source_kind, "manual"),
    duplicate_question_id: typeof value.duplicate_question_id === "string" ? redactText(value.duplicate_question_id) : undefined,
    blockers: readStringList(value.blockers, 12).map(preview),
    warnings: readStringList(value.warnings, 14).map(preview),
    recommended_commands: readOpenCodeCommanderQuestionCommands(value.recommended_commands),
    generated_at: readString(value.generated_at, ""),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
    question_hash: readString(value.question_hash, ""),
  }
}

function readOpenCodeCommanderQuestionResult(value: unknown): OpenCodeCommanderQuestionResultSummary {
  if (!isRecord(value) || typeof value.question_id !== "string") throw new Error("runtime.create_opencode_commander_question returned invalid result")
  return {
    question_id: redactText(value.question_id),
    status: readString(value.status, "blocked"),
    question_status: readString(value.question_status, "pending_commander"),
    session_id: redactText(readString(value.session_id, "")),
    launch_id: typeof value.launch_id === "string" ? redactText(value.launch_id) : undefined,
    progress_id: typeof value.progress_id === "string" ? redactText(value.progress_id) : undefined,
    watchdog_id: typeof value.watchdog_id === "string" ? redactText(value.watchdog_id) : undefined,
    forced_report_request_id: typeof value.forced_report_request_id === "string" ? redactText(value.forced_report_request_id) : undefined,
    question_type: readString(value.question_type, "unknown"),
    urgency: readString(value.urgency, "normal"),
    question_preview: preview(readString(value.question_preview, "")),
    context_summary_preview: preview(readString(value.context_summary_preview, "")),
    options_considered_preview: readStringList(value.options_considered_preview, 8).map(preview),
    executor_recommendation_preview: typeof value.executor_recommendation_preview === "string" ? preview(readString(value.executor_recommendation_preview, "")) : undefined,
    evidence_summary_preview: typeof value.evidence_summary_preview === "string" ? preview(readString(value.evidence_summary_preview, "")) : undefined,
    created_at: readString(value.created_at, ""),
    created_by: preview(readString(value.created_by, "")),
    source_kind: readString(value.source_kind, "manual"),
    error: typeof value.error === "string" ? preview(readString(value.error, "")) : undefined,
    question_hash: readString(value.question_hash, ""),
    recommended_commands: readOpenCodeCommanderQuestionCommands(value.recommended_commands),
  }
}

function readOpenCodeCommanderQuestionRecords(value: unknown): OpenCodeCommanderQuestionRecordSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 20).map((record) => ({
    question_id: redactText(readString(record.question_id, "")),
    status: readString(record.status, "pending_commander"),
    session_id: redactText(readString(record.session_id, "")),
    launch_id: typeof record.launch_id === "string" ? redactText(record.launch_id) : undefined,
    question_type: readString(record.question_type, "unknown"),
    urgency: readString(record.urgency, "normal"),
    question_preview: preview(readString(record.question_preview, "")),
    source_kind: readString(record.source_kind, "manual"),
    created_at: readString(record.created_at, ""),
    created_by: preview(readString(record.created_by, "")),
    has_options: record.has_options === true,
    has_recommendation: record.has_recommendation === true,
    linked_progress_id: typeof record.linked_progress_id === "string" ? redactText(record.linked_progress_id) : undefined,
    linked_watchdog_id: typeof record.linked_watchdog_id === "string" ? redactText(record.linked_watchdog_id) : undefined,
    linked_forced_report_request_id: typeof record.linked_forced_report_request_id === "string" ? redactText(record.linked_forced_report_request_id) : undefined,
    question_hash: readString(record.question_hash, ""),
  }))
}

function readOpenCodeCommanderQuestionSummary(value: unknown): OpenCodeCommanderQuestionSummaryState {
  if (!isRecord(value)) throw new Error("runtime.opencode_commander_question_summary returned invalid summary")
  return {
    total_questions: readNumber(value.total_questions, 0),
    pending_commander_count: readNumber(value.pending_commander_count, 0),
    pending_human_count: readNumber(value.pending_human_count, 0),
    withdrawn_count: readNumber(value.withdrawn_count, 0),
    superseded_count: readNumber(value.superseded_count, 0),
    answered_count: readNumber(value.answered_count, 0),
    urgent_count: readNumber(value.urgent_count, 0),
    blocked_type_count: readNumber(value.blocked_type_count, 0),
    latest_questions: readOpenCodeCommanderQuestionRecords(value.latest_questions),
    generated_at: readString(value.generated_at, ""),
  }
}

function readOpenCodeCommanderQuestionCommands(value: unknown): OpenCodeCommanderQuestionCommandSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((command) => ({
    label: preview(readString(command.label, "")),
    command: preview(readString(command.command, "")),
    command_type: command.command_type === "write" ? "write" : "read",
    requires_active_runtime: command.requires_active_runtime === true,
    notes: typeof command.notes === "string" ? preview(readString(command.notes, "")) : undefined,
  }))
}

function readResearchMemorySummary(value: unknown): ResearchMemorySummaryState {
  if (!isRecord(value)) throw new Error("runtime.research_memory_summary returned invalid summary")
  return {
    total_candidates_available: readNumber(value.total_candidates_available, 0),
    label_counts: readNumberMap(value.label_counts, 12),
    source_counts: readNumberMap(value.source_counts, 12),
    has_research_db_projection: readBoolean(value.has_research_db_projection),
    retrieval_policy: readString(value.retrieval_policy, "empty_projection"),
    generated_at: readString(value.generated_at, ""),
  }
}

function readResearchMemoryRetrievalPreview(value: unknown): ResearchMemoryRetrievalPreviewSummary {
  if (!isRecord(value) || typeof value.preview_id !== "string") throw new Error("runtime.preview_research_memory_retrieval returned invalid preview")
  return {
    preview_id: redactText(value.preview_id),
    status: readString(value.status, "blocked"),
    query_preview: preview(readString(value.query_preview, "")),
    labels: readStringList(value.labels, 12),
    limit: readNumber(value.limit, 0),
    candidates: readResearchMemoryCandidates(value.candidates),
    omitted_count: readNumber(value.omitted_count, 0),
    retrieval_policy: readString(value.retrieval_policy, "lexical_preview"),
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 12).map(preview),
    recommended_commands: readResearchMemoryCommands(value.recommended_commands),
    generated_at: readString(value.generated_at, ""),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
    retrieval_hash: readString(value.retrieval_hash, ""),
  }
}

function readResearchNoveltyPreview(value: unknown): ResearchNoveltyPreviewSummary {
  if (!isRecord(value) || typeof value.preview_id !== "string") throw new Error("runtime.preview_research_novelty_check returned invalid preview")
  return {
    preview_id: redactText(value.preview_id),
    status: readString(value.status, "blocked"),
    proposed_question_preview: preview(readString(value.proposed_question_preview, "")),
    proposed_method_preview: typeof value.proposed_method_preview === "string" ? preview(readString(value.proposed_method_preview, "")) : undefined,
    proposed_config_preview: typeof value.proposed_config_preview === "string" ? preview(readString(value.proposed_config_preview, "")) : undefined,
    nearest_prior_results: readResearchMemoryCandidates(value.nearest_prior_results),
    duplicate_risk: readString(value.duplicate_risk, "unknown"),
    novelty_score: readNumber(value.novelty_score, 0),
    difference_summary_preview: preview(readString(value.difference_summary_preview, "")),
    repetition_requires_justification: readBoolean(value.repetition_requires_justification),
    acceptable_repetition_reasons: readStringList(value.acceptable_repetition_reasons, 12),
    suggested_reason_not_duplicate: typeof value.suggested_reason_not_duplicate === "string" ? preview(readString(value.suggested_reason_not_duplicate, "")) : undefined,
    missing_memory_warning: readBoolean(value.missing_memory_warning),
    external_research_recommended: readBoolean(value.external_research_recommended),
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 12).map(preview),
    recommended_commands: readResearchMemoryCommands(value.recommended_commands),
    generated_at: readString(value.generated_at, ""),
    novelty_hash: readString(value.novelty_hash, ""),
  }
}

function readResearchMemoryCandidates(value: unknown): ResearchMemoryCandidateSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, HANDOFF_LIMIT).map((candidate) => ({
    result_id: redactText(readString(candidate.result_id, "")),
    label: readString(candidate.label, "unknown"),
    source_kind: readString(candidate.source_kind, "unknown"),
    question_preview: preview(readString(candidate.question_preview, "")),
    hypothesis_preview: typeof candidate.hypothesis_preview === "string" ? preview(readString(candidate.hypothesis_preview, "")) : undefined,
    method_preview: typeof candidate.method_preview === "string" ? preview(readString(candidate.method_preview, "")) : undefined,
    config_preview: typeof candidate.config_preview === "string" ? preview(readString(candidate.config_preview, "")) : undefined,
    outcome_preview: typeof candidate.outcome_preview === "string" ? preview(readString(candidate.outcome_preview, "")) : undefined,
    metric_preview: typeof candidate.metric_preview === "string" ? preview(readString(candidate.metric_preview, "")) : undefined,
    confidence: typeof candidate.confidence === "number" ? readNumber(candidate.confidence, 0) : undefined,
    status: typeof candidate.status === "string" ? readString(candidate.status, "unknown") : undefined,
    source_session_id: typeof candidate.source_session_id === "string" ? redactText(candidate.source_session_id) : undefined,
    source_mission_id: typeof candidate.source_mission_id === "string" ? redactText(candidate.source_mission_id) : undefined,
    artifact_ids: readStringList(candidate.artifact_ids, 8).map(redactText),
    citation_ids: readStringList(candidate.citation_ids, 8).map(redactText),
    related_event_ids: readStringList(candidate.related_event_ids, 8).map(redactText),
    relevance_score: readNumber(candidate.relevance_score, 0),
    duplicate_similarity_score: readNumber(candidate.duplicate_similarity_score, 0),
    matched_terms: readStringList(candidate.matched_terms, 12),
    difference_preview: typeof candidate.difference_preview === "string" ? preview(readString(candidate.difference_preview, "")) : undefined,
    warning_flags: readStringList(candidate.warning_flags, 8).map(preview),
    source_refs: readResearchMemorySourceRefs(candidate.source_refs),
  }))
}

function readResearchMemorySourceRefs(value: unknown): ResearchMemoryCandidateSummary["source_refs"] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((ref) => ({
    source_kind: readString(ref.source_kind, "unknown"),
    source_id: redactText(readString(ref.source_id, "")),
    label: typeof ref.label === "string" ? preview(readString(ref.label, "")) : undefined,
    summary_preview: typeof ref.summary_preview === "string" ? preview(readString(ref.summary_preview, "")) : undefined,
    pointer_only: true,
  }))
}

function readResearchMemoryCommands(value: unknown): ResearchMemoryRetrievalPreviewSummary["recommended_commands"] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((command) => ({
    label: preview(readString(command.label, "")),
    command: preview(readString(command.command, "")),
    command_type: command.command_type === "write" ? "write" : "read",
    requires_active_runtime: command.requires_active_runtime === true,
    notes: typeof command.notes === "string" ? preview(readString(command.notes, "")) : undefined,
  }))
}

function readTriState(value: unknown): boolean | "unknown" {
  return typeof value === "boolean" ? value : "unknown"
}

function readPriority(value: unknown): "required" | "high" | "medium" | "low" | "excluded" {
  return value === "required" || value === "high" || value === "medium" || value === "low" || value === "excluded" ? value : "medium"
}

function readInclusionPolicy(value: unknown): "always" | "if_relevant" | "pointer_only" | "excluded_by_default" {
  return value === "always" || value === "if_relevant" || value === "pointer_only" || value === "excluded_by_default" ? value : "if_relevant"
}

function readCommanderExecutorReviewPreview(value: unknown): CommanderExecutorReviewPreviewSummary {
  if (!isRecord(value)) throw new Error("runtime.preview_commander_executor_review returned invalid preview")
  return {
    review_id: typeof value.review_id === "string" ? redactText(value.review_id) : undefined,
    packet_id: typeof value.packet_id === "string" ? redactText(value.packet_id) : undefined,
    packet_status: typeof value.packet_status === "string" ? readString(value.packet_status, "") : undefined,
    can_execute: readBoolean(value.can_execute),
    provider_kind: readString(value.provider_kind, ""),
    provider_ready: readBoolean(value.provider_ready),
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    packet_summary_preview: typeof value.packet_summary_preview === "string" ? preview(readString(value.packet_summary_preview, "")) : undefined,
    prompt_preview: typeof value.prompt_preview === "string" ? preview(readString(value.prompt_preview, "")) : undefined,
    recommended_commands: readCommanderExecutorReviewCommands(value.recommended_commands),
    generated_at: readString(value.generated_at, ""),
  }
}

function readCommanderExecutorReviewResult(value: unknown): CommanderExecutorReviewResultSummary {
  if (!isRecord(value) || typeof value.review_id !== "string") throw new Error("runtime.execute_commander_executor_review returned invalid result")
  return {
    review_id: redactText(value.review_id),
    packet_id: readString(value.packet_id, ""),
    packet_status: readString(value.packet_status, ""),
    status: readString(value.status, ""),
    provider_kind: readString(value.provider_kind, ""),
    decision: readString(value.decision, ""),
    confidence: readNumber(value.confidence, 0),
    summary: preview(readString(value.summary, "")),
    findings: readCommanderExecutorReviewFindings(value.findings),
    evidence_ids: readStringList(value.evidence_ids, 12).map(redactText),
    recommended_commands: readCommanderExecutorReviewCommands(value.recommended_commands),
    error: typeof value.error === "string" ? preview(readString(value.error, "")) : undefined,
    started_at: readString(value.started_at, ""),
    completed_at: readString(value.completed_at, ""),
    requested_by: readString(value.requested_by, ""),
    review_hash: readString(value.review_hash, ""),
    handoff_id: typeof value.handoff_id === "string" ? redactText(value.handoff_id) : undefined,
    mission_id: typeof value.mission_id === "string" ? redactText(value.mission_id) : undefined,
    result_id: typeof value.result_id === "string" ? redactText(value.result_id) : undefined,
    proposal_id: typeof value.proposal_id === "string" ? redactText(value.proposal_id) : undefined,
  }
}

function readCommanderExecutorReviewRecords(value: unknown): CommanderExecutorReviewRecordSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, HANDOFF_LIMIT).map((item) => ({
    review_id: readString(item.review_id, ""),
    packet_id: readString(item.packet_id, ""),
    status: readString(item.status, ""),
    decision: readString(item.decision, ""),
    confidence: readNumber(item.confidence, 0),
    completed_at: readString(item.completed_at, ""),
    summary_preview: preview(readString(item.summary_preview, "")),
    review_hash: readString(item.review_hash, ""),
    handoff_id: typeof item.handoff_id === "string" ? redactText(item.handoff_id) : undefined,
    mission_id: typeof item.mission_id === "string" ? redactText(item.mission_id) : undefined,
    result_id: typeof item.result_id === "string" ? redactText(item.result_id) : undefined,
  }))
}

function readCommanderExecutorReviewFindings(value: unknown): CommanderExecutorReviewFindingSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((item) => ({
    finding_id: readString(item.finding_id, ""),
    severity: readString(item.severity, ""),
    title: preview(readString(item.title, "")),
    summary: preview(readString(item.summary, "")),
    evidence_ids: readStringList(item.evidence_ids, 12).map(redactText),
    recommended_commands: readCommanderExecutorReviewCommands(item.recommended_commands),
  }))
}

function readCommanderExecutorReviewCommands(value: unknown): CommanderExecutorReviewCommandSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((command) => ({
    label: preview(readString(command.label, "")),
    command: preview(readString(command.command, "")),
    command_type: command.command_type === "write" ? "write" : "read",
    requires_active_runtime: command.requires_active_runtime === true,
    notes: typeof command.notes === "string" ? preview(readString(command.notes, "")) : undefined,
  }))
}

function readExecutorReviewProposalDraftPreview(value: unknown): ExecutorReviewProposalDraftPreviewSummary {
  if (!isRecord(value)) throw new Error("runtime.preview_executor_review_proposal_drafts returned invalid preview")
  return {
    preview_id: readString(value.preview_id, ""),
    status: readString(value.status, "unknown"),
    review_id: typeof value.review_id === "string" ? redactText(value.review_id) : undefined,
    packet_id: typeof value.packet_id === "string" ? redactText(value.packet_id) : undefined,
    review_decision: typeof value.review_decision === "string" ? readString(value.review_decision, "") : undefined,
    review_confidence: typeof value.review_confidence === "number" ? value.review_confidence : undefined,
    can_create_proposals_now: readBoolean(value.can_create_proposals_now),
    candidates: readExecutorReviewProposalDraftCandidates(value.candidates),
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    recommended_commands: readExecutorReviewProposalDraftCommands(value.recommended_commands),
    generated_at: readString(value.generated_at, ""),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readExecutorReviewProposalDraftCandidates(value: unknown): ExecutorReviewProposalDraftCandidateSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((item) => ({
    draft_id: readString(item.draft_id, ""),
    draft_kind: readString(item.draft_kind, "other"),
    title: preview(readString(item.title, "")),
    summary: preview(readString(item.summary, "")),
    rationale: preview(readString(item.rationale, "")),
    source_review_id: readString(item.source_review_id, ""),
    source_packet_id: readString(item.source_packet_id, ""),
    mission_id: typeof item.mission_id === "string" ? redactText(item.mission_id) : undefined,
    result_id: typeof item.result_id === "string" ? redactText(item.result_id) : undefined,
    handoff_id: typeof item.handoff_id === "string" ? redactText(item.handoff_id) : undefined,
    proposal_id: typeof item.proposal_id === "string" ? redactText(item.proposal_id) : undefined,
    evidence_ids: readStringList(item.evidence_ids, 12).map(redactText),
    finding_ids: readStringList(item.finding_ids, 12).map(redactText),
    confidence: readNumber(item.confidence, 0),
    risk: readString(item.risk, "medium"),
    would_create_proposal: readBoolean(item.would_create_proposal),
    would_mutate_mission: readBoolean(item.would_mutate_mission),
    recommended_commands: readExecutorReviewProposalDraftCommands(item.recommended_commands),
  }))
}

function readExecutorReviewProposalDraftCommands(value: unknown): ExecutorReviewProposalDraftCommandSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((command) => ({
    label: preview(readString(command.label, "")),
    command: preview(readString(command.command, "")),
    command_type: command.command_type === "write" ? "write" : "read",
    requires_active_runtime: command.requires_active_runtime === true,
    notes: typeof command.notes === "string" ? preview(readString(command.notes, "")) : undefined,
  }))
}

function readExecutorReviewProposalDraftSummary(value: unknown): ExecutorReviewProposalDraftSummary {
  if (!isRecord(value)) throw new Error("runtime.executor_review_proposal_draft_summary returned invalid summary")
  return {
    total_reviews_considered: readNumber(value.total_reviews_considered, 0),
    draftable_review_count: readNumber(value.draftable_review_count, 0),
    blocked_review_count: readNumber(value.blocked_review_count, 0),
    candidate_count: readNumber(value.candidate_count, 0),
    latest_review_id: typeof value.latest_review_id === "string" ? redactText(value.latest_review_id) : undefined,
    generated_at: readString(value.generated_at, ""),
  }
}

function readExecutorReviewProposalCreatePreview(value: unknown): ExecutorReviewProposalCreatePreviewSummary {
  if (!isRecord(value)) throw new Error("runtime.preview_executor_review_proposal_create returned invalid preview")
  return {
    preview_id: readString(value.preview_id, ""),
    status: readString(value.status, "blocked"),
    can_create: readBoolean(value.can_create),
    review_id: readString(value.review_id, ""),
    draft_id: readString(value.draft_id, ""),
    source_packet_id: typeof value.source_packet_id === "string" ? redactText(value.source_packet_id) : undefined,
    draft_kind: readString(value.draft_kind, "other"),
    title_preview: preview(readString(value.title_preview, "")),
    summary_preview: preview(readString(value.summary_preview, "")),
    proposed_action_kind: readString(value.proposed_action_kind, "other"),
    target_mission_id: typeof value.target_mission_id === "string" ? redactText(value.target_mission_id) : undefined,
    target_result_id: typeof value.target_result_id === "string" ? redactText(value.target_result_id) : undefined,
    target_handoff_id: typeof value.target_handoff_id === "string" ? redactText(value.target_handoff_id) : undefined,
    target_proposal_id: typeof value.target_proposal_id === "string" ? redactText(value.target_proposal_id) : undefined,
    evidence_ids: readStringList(value.evidence_ids, 12).map(redactText),
    finding_ids: readStringList(value.finding_ids, 12).map(redactText),
    source_confidence: readNumber(value.source_confidence, 0),
    risk: readString(value.risk, "medium"),
    existing_proposal_id: typeof value.existing_proposal_id === "string" ? redactText(value.existing_proposal_id) : undefined,
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    recommended_commands: readExecutorReviewProposalCreateCommands(value.recommended_commands),
    generated_at: readString(value.generated_at, ""),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readExecutorReviewProposalCreateResult(value: unknown): ExecutorReviewProposalCreateResultSummary {
  if (!isRecord(value) || typeof value.create_id !== "string") throw new Error("runtime.create_executor_review_proposal returned invalid result")
  return {
    create_id: readString(value.create_id, ""),
    status: readString(value.status, "blocked"),
    proposal_id: typeof value.proposal_id === "string" ? redactText(value.proposal_id) : undefined,
    review_id: readString(value.review_id, ""),
    draft_id: readString(value.draft_id, ""),
    source_packet_id: typeof value.source_packet_id === "string" ? redactText(value.source_packet_id) : undefined,
    draft_kind: readString(value.draft_kind, "other"),
    proposed_action_kind: readString(value.proposed_action_kind, "other"),
    title_preview: preview(readString(value.title_preview, "")),
    summary_preview: preview(readString(value.summary_preview, "")),
    evidence_ids: readStringList(value.evidence_ids, 12).map(redactText),
    finding_ids: readStringList(value.finding_ids, 12).map(redactText),
    created_at: readString(value.created_at, ""),
    requested_by: preview(readString(value.requested_by, "")),
    error: typeof value.error === "string" ? preview(readString(value.error, "")) : undefined,
    create_hash: readString(value.create_hash, ""),
    recommended_commands: readExecutorReviewProposalCreateCommands(value.recommended_commands),
  }
}

function readExecutorReviewProposalCreateRecords(value: unknown): ExecutorReviewProposalCreateRecordSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((item) => ({
    create_id: readString(item.create_id, ""),
    status: readString(item.status, "blocked"),
    proposal_id: typeof item.proposal_id === "string" ? redactText(item.proposal_id) : undefined,
    review_id: readString(item.review_id, ""),
    draft_id: readString(item.draft_id, ""),
    draft_kind: readString(item.draft_kind, "other"),
    created_at: readString(item.created_at, ""),
    summary_preview: preview(readString(item.summary_preview, "")),
    create_hash: readString(item.create_hash, ""),
  }))
}

function readExecutorReviewProposalCreateCommands(value: unknown): ExecutorReviewProposalCreateCommandSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((command) => ({
    label: preview(readString(command.label, "")),
    command: preview(readString(command.command, "")),
    command_type: command.command_type === "write" ? "write" : "read",
    requires_active_runtime: command.requires_active_runtime === true,
    notes: typeof command.notes === "string" ? preview(readString(command.notes, "")) : undefined,
  }))
}

function readExecutorReviewProposalReviewRequestPreview(value: unknown): ExecutorReviewProposalReviewRequestPreviewSummary {
  if (!isRecord(value)) throw new Error("runtime.preview_executor_review_proposal_review_request returned invalid preview")
  return {
    preview_id: readString(value.preview_id, ""),
    status: readString(value.status, "blocked"),
    can_request: readBoolean(value.can_request),
    proposal_id: readString(value.proposal_id, ""),
    create_id: typeof value.create_id === "string" ? redactText(value.create_id) : undefined,
    review_id: typeof value.review_id === "string" ? redactText(value.review_id) : undefined,
    draft_id: typeof value.draft_id === "string" ? redactText(value.draft_id) : undefined,
    source_packet_id: typeof value.source_packet_id === "string" ? redactText(value.source_packet_id) : undefined,
    proposal_status: typeof value.proposal_status === "string" ? readString(value.proposal_status, "") : undefined,
    proposal_title_preview: preview(readString(value.proposal_title_preview, "")),
    proposal_summary_preview: preview(readString(value.proposal_summary_preview, "")),
    action_kind: typeof value.action_kind === "string" ? readString(value.action_kind, "") : undefined,
    mission_id: typeof value.mission_id === "string" ? redactText(value.mission_id) : undefined,
    result_id: typeof value.result_id === "string" ? redactText(value.result_id) : undefined,
    source_evidence_ids: readStringList(value.source_evidence_ids, 12).map(redactText),
    source_finding_ids: readStringList(value.source_finding_ids, 12).map(redactText),
    source_confidence: typeof value.source_confidence === "number" ? value.source_confidence : undefined,
    risk: typeof value.risk === "string" ? readString(value.risk, "") : undefined,
    existing_review_request_id: typeof value.existing_review_request_id === "string" ? redactText(value.existing_review_request_id) : undefined,
    existing_review_request_status: typeof value.existing_review_request_status === "string" ? readString(value.existing_review_request_status, "") : undefined,
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    recommended_commands: readExecutorReviewProposalReviewRequestCommands(value.recommended_commands),
    generated_at: readString(value.generated_at, ""),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readExecutorReviewProposalReviewRequestResult(value: unknown): ExecutorReviewProposalReviewRequestResultSummary {
  if (!isRecord(value) || typeof value.request_gate_id !== "string") throw new Error("runtime.request_executor_review_proposal_review returned invalid result")
  return {
    request_gate_id: readString(value.request_gate_id, ""),
    status: readString(value.status, "blocked"),
    review_request_id: typeof value.review_request_id === "string" ? redactText(value.review_request_id) : undefined,
    proposal_id: readString(value.proposal_id, ""),
    create_id: typeof value.create_id === "string" ? redactText(value.create_id) : undefined,
    review_id: typeof value.review_id === "string" ? redactText(value.review_id) : undefined,
    draft_id: typeof value.draft_id === "string" ? redactText(value.draft_id) : undefined,
    source_packet_id: typeof value.source_packet_id === "string" ? redactText(value.source_packet_id) : undefined,
    mission_id: typeof value.mission_id === "string" ? redactText(value.mission_id) : undefined,
    result_id: typeof value.result_id === "string" ? redactText(value.result_id) : undefined,
    requested_at: readString(value.requested_at, ""),
    requested_by: preview(readString(value.requested_by, "")),
    error: typeof value.error === "string" ? preview(readString(value.error, "")) : undefined,
    request_hash: readString(value.request_hash, ""),
    recommended_commands: readExecutorReviewProposalReviewRequestCommands(value.recommended_commands),
  }
}

function readExecutorReviewProposalReviewRequestRecords(value: unknown): ExecutorReviewProposalReviewRequestRecordSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((item) => ({
    request_gate_id: readString(item.request_gate_id, ""),
    status: readString(item.status, "blocked"),
    review_request_id: typeof item.review_request_id === "string" ? redactText(item.review_request_id) : undefined,
    proposal_id: readString(item.proposal_id, ""),
    create_id: typeof item.create_id === "string" ? redactText(item.create_id) : undefined,
    review_id: typeof item.review_id === "string" ? redactText(item.review_id) : undefined,
    draft_id: typeof item.draft_id === "string" ? redactText(item.draft_id) : undefined,
    requested_at: readString(item.requested_at, ""),
    summary_preview: preview(readString(item.summary_preview, "")),
    request_hash: readString(item.request_hash, ""),
  }))
}

function readExecutorReviewProposalReviewRequestCommands(value: unknown): ExecutorReviewProposalReviewRequestCommandSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((command) => ({
    label: preview(readString(command.label, "")),
    command: preview(readString(command.command, "")),
    command_type: command.command_type === "write" ? "write" : "read",
    requires_active_runtime: command.requires_active_runtime === true,
    notes: typeof command.notes === "string" ? preview(readString(command.notes, "")) : undefined,
  }))
}

function readExecutorReviewProposalReviewDecisionPreview(value: unknown): ExecutorReviewProposalReviewDecisionPreviewSummary {
  if (!isRecord(value)) throw new Error("runtime.preview_executor_review_proposal_review_decision returned invalid preview")
  return {
    preview_id: readString(value.preview_id, ""),
    status: readString(value.status, "blocked"),
    can_decide: readBoolean(value.can_decide),
    decision: value.decision === "reject" ? "reject" : "approve",
    review_request_id: readString(value.review_request_id, ""),
    proposal_id: typeof value.proposal_id === "string" ? redactText(value.proposal_id) : undefined,
    request_gate_id: typeof value.request_gate_id === "string" ? redactText(value.request_gate_id) : undefined,
    create_id: typeof value.create_id === "string" ? redactText(value.create_id) : undefined,
    source_executor_review_id: typeof value.source_executor_review_id === "string" ? redactText(value.source_executor_review_id) : undefined,
    source_draft_id: typeof value.source_draft_id === "string" ? redactText(value.source_draft_id) : undefined,
    source_packet_id: typeof value.source_packet_id === "string" ? redactText(value.source_packet_id) : undefined,
    review_request_status: typeof value.review_request_status === "string" ? readString(value.review_request_status, "") : undefined,
    proposal_status: typeof value.proposal_status === "string" ? readString(value.proposal_status, "") : undefined,
    proposal_title_preview: preview(readString(value.proposal_title_preview, "")),
    proposal_summary_preview: preview(readString(value.proposal_summary_preview, "")),
    action_kind: typeof value.action_kind === "string" ? readString(value.action_kind, "") : undefined,
    mission_id: typeof value.mission_id === "string" ? redactText(value.mission_id) : undefined,
    result_id: typeof value.result_id === "string" ? redactText(value.result_id) : undefined,
    source_evidence_ids: readStringList(value.source_evidence_ids, 12).map(redactText),
    source_finding_ids: readStringList(value.source_finding_ids, 12).map(redactText),
    source_confidence: typeof value.source_confidence === "number" ? value.source_confidence : undefined,
    risk: typeof value.risk === "string" ? readString(value.risk, "") : undefined,
    existing_decision: typeof value.existing_decision === "string" ? readString(value.existing_decision, "") : undefined,
    existing_decision_at: typeof value.existing_decision_at === "string" ? readString(value.existing_decision_at, "") : undefined,
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    recommended_commands: readExecutorReviewProposalReviewDecisionCommands(value.recommended_commands),
    generated_at: readString(value.generated_at, ""),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readExecutorReviewProposalReviewDecisionResult(value: unknown): ExecutorReviewProposalReviewDecisionResultSummary {
  if (!isRecord(value) || typeof value.decision_gate_id !== "string") throw new Error("runtime.decide_executor_review_proposal_review returned invalid result")
  return {
    decision_gate_id: readString(value.decision_gate_id, ""),
    status: readString(value.status, "blocked"),
    decision: value.decision === "reject" ? "reject" : "approve",
    review_request_id: readString(value.review_request_id, ""),
    proposal_id: typeof value.proposal_id === "string" ? redactText(value.proposal_id) : undefined,
    request_gate_id: typeof value.request_gate_id === "string" ? redactText(value.request_gate_id) : undefined,
    create_id: typeof value.create_id === "string" ? redactText(value.create_id) : undefined,
    source_executor_review_id: typeof value.source_executor_review_id === "string" ? redactText(value.source_executor_review_id) : undefined,
    source_draft_id: typeof value.source_draft_id === "string" ? redactText(value.source_draft_id) : undefined,
    source_packet_id: typeof value.source_packet_id === "string" ? redactText(value.source_packet_id) : undefined,
    mission_id: typeof value.mission_id === "string" ? redactText(value.mission_id) : undefined,
    result_id: typeof value.result_id === "string" ? redactText(value.result_id) : undefined,
    decided_at: readString(value.decided_at, ""),
    decided_by: preview(readString(value.decided_by, "")),
    reason_preview: typeof value.reason_preview === "string" ? preview(readString(value.reason_preview, "")) : undefined,
    error: typeof value.error === "string" ? preview(readString(value.error, "")) : undefined,
    decision_hash: readString(value.decision_hash, ""),
    recommended_commands: readExecutorReviewProposalReviewDecisionCommands(value.recommended_commands),
  }
}

function readExecutorReviewProposalReviewDecisionRecords(value: unknown): ExecutorReviewProposalReviewDecisionRecordSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((item) => ({
    decision_gate_id: readString(item.decision_gate_id, ""),
    status: readString(item.status, "blocked"),
    decision: item.decision === "reject" ? "reject" : "approve",
    review_request_id: readString(item.review_request_id, ""),
    proposal_id: typeof item.proposal_id === "string" ? redactText(item.proposal_id) : undefined,
    request_gate_id: typeof item.request_gate_id === "string" ? redactText(item.request_gate_id) : undefined,
    create_id: typeof item.create_id === "string" ? redactText(item.create_id) : undefined,
    decided_at: readString(item.decided_at, ""),
    summary_preview: preview(readString(item.summary_preview, "")),
    decision_hash: readString(item.decision_hash, ""),
  }))
}

function readExecutorReviewProposalReviewDecisionCommands(value: unknown): ExecutorReviewProposalReviewDecisionCommandSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((command) => ({
    label: preview(readString(command.label, "")),
    command: preview(readString(command.command, "")),
    command_type: command.command_type === "write" ? "write" : "read",
    requires_active_runtime: command.requires_active_runtime === true,
    notes: typeof command.notes === "string" ? preview(readString(command.notes, "")) : undefined,
  }))
}

function recordFromExecutorReviewProposalReviewDecisionResult(result: ExecutorReviewProposalReviewDecisionResultSummary): ExecutorReviewProposalReviewDecisionRecordSummary {
  return {
    decision_gate_id: result.decision_gate_id,
    status: result.status,
    decision: result.decision,
    review_request_id: result.review_request_id,
    proposal_id: result.proposal_id,
    request_gate_id: result.request_gate_id,
    create_id: result.create_id,
    decided_at: result.decided_at,
    summary_preview: result.error ?? result.reason_preview ?? result.review_request_id,
    decision_hash: result.decision_hash,
  }
}

function readExecutorReviewProposalApplyReadinessPreview(value: unknown): ExecutorReviewProposalApplyReadinessPreviewSummary {
  if (!isRecord(value)) throw new Error("runtime.preview_executor_review_proposal_apply_readiness returned invalid preview")
  return {
    readiness_id: readString(value.readiness_id, ""),
    status: readString(value.status, "unknown"),
    can_apply_in_future: readBoolean(value.can_apply_in_future),
    proposal_id: readString(value.proposal_id, ""),
    review_request_id: typeof value.review_request_id === "string" ? redactText(value.review_request_id) : undefined,
    request_gate_id: typeof value.request_gate_id === "string" ? redactText(value.request_gate_id) : undefined,
    decision_gate_id: typeof value.decision_gate_id === "string" ? redactText(value.decision_gate_id) : undefined,
    create_id: typeof value.create_id === "string" ? redactText(value.create_id) : undefined,
    source_executor_review_id: typeof value.source_executor_review_id === "string" ? redactText(value.source_executor_review_id) : undefined,
    source_draft_id: typeof value.source_draft_id === "string" ? redactText(value.source_draft_id) : undefined,
    source_packet_id: typeof value.source_packet_id === "string" ? redactText(value.source_packet_id) : undefined,
    proposal_status: typeof value.proposal_status === "string" ? readString(value.proposal_status, "") : undefined,
    review_request_status: typeof value.review_request_status === "string" ? readString(value.review_request_status, "") : undefined,
    review_decision: typeof value.review_decision === "string" ? readString(value.review_decision, "") : undefined,
    proposal_title_preview: preview(readString(value.proposal_title_preview, "")),
    proposal_summary_preview: preview(readString(value.proposal_summary_preview, "")),
    action_kind: typeof value.action_kind === "string" ? readString(value.action_kind, "") : undefined,
    candidate_kind: readString(value.candidate_kind, "generic"),
    candidate_risk: readString(value.candidate_risk, "medium"),
    mission_id: typeof value.mission_id === "string" ? redactText(value.mission_id) : undefined,
    result_id: typeof value.result_id === "string" ? redactText(value.result_id) : undefined,
    source_evidence_ids: readStringList(value.source_evidence_ids, 12).map(redactText),
    source_finding_ids: readStringList(value.source_finding_ids, 12).map(redactText),
    source_confidence: typeof value.source_confidence === "number" ? value.source_confidence : undefined,
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    recommended_commands: readExecutorReviewProposalApplyReadinessCommands(value.recommended_commands),
    generated_at: readString(value.generated_at, ""),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readExecutorReviewProposalApplyReadinessSummary(value: unknown): ExecutorReviewProposalApplyReadinessSummary {
  if (!isRecord(value)) throw new Error("runtime.executor_review_proposal_apply_readiness_summary returned invalid summary")
  return {
    total_considered: readNumber(value.total_considered, 0),
    ready_count: readNumber(value.ready_count, 0),
    blocked_count: readNumber(value.blocked_count, 0),
    needs_review_count: readNumber(value.needs_review_count, 0),
    rejected_count: readNumber(value.rejected_count, 0),
    generic_count: readNumber(value.generic_count, 0),
    high_risk_count: readNumber(value.high_risk_count, 0),
    generated_at: readString(value.generated_at, ""),
  }
}

function readExecutorReviewProposalApplyReadinessRecords(value: unknown): ExecutorReviewProposalApplyReadinessRecordSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((item) => ({
    readiness_id: readString(item.readiness_id, ""),
    status: readString(item.status, "unknown"),
    proposal_id: readString(item.proposal_id, ""),
    review_request_id: typeof item.review_request_id === "string" ? redactText(item.review_request_id) : undefined,
    decision_gate_id: typeof item.decision_gate_id === "string" ? redactText(item.decision_gate_id) : undefined,
    create_id: typeof item.create_id === "string" ? redactText(item.create_id) : undefined,
    candidate_kind: readString(item.candidate_kind, "generic"),
    candidate_risk: readString(item.candidate_risk, "medium"),
    generated_at: readString(item.generated_at, ""),
    summary_preview: preview(readString(item.summary_preview, "")),
  }))
}

function readExecutorReviewProposalApplyReadinessCommands(value: unknown): ExecutorReviewProposalApplyReadinessCommandSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((command) => ({
    label: preview(readString(command.label, "")),
    command: preview(readString(command.command, "")),
    command_type: command.command_type === "write" ? "write" : "read",
    requires_active_runtime: command.requires_active_runtime === true,
    notes: typeof command.notes === "string" ? preview(readString(command.notes, "")) : undefined,
  }))
}

function readExecutorReviewProposalNarrowApplyPreview(value: unknown): ExecutorReviewProposalNarrowApplyPreviewSummary {
  if (!isRecord(value)) throw new Error("runtime.preview_executor_review_proposal_narrow_apply returned invalid preview")
  return {
    preview_id: readString(value.preview_id, ""),
    status: readString(value.status, "unknown"),
    can_apply: readBoolean(value.can_apply),
    proposal_id: readString(value.proposal_id, ""),
    readiness_id: typeof value.readiness_id === "string" ? redactText(value.readiness_id) : undefined,
    review_request_id: typeof value.review_request_id === "string" ? redactText(value.review_request_id) : undefined,
    request_gate_id: typeof value.request_gate_id === "string" ? redactText(value.request_gate_id) : undefined,
    decision_gate_id: typeof value.decision_gate_id === "string" ? redactText(value.decision_gate_id) : undefined,
    create_id: typeof value.create_id === "string" ? redactText(value.create_id) : undefined,
    source_executor_review_id: typeof value.source_executor_review_id === "string" ? redactText(value.source_executor_review_id) : undefined,
    source_draft_id: typeof value.source_draft_id === "string" ? redactText(value.source_draft_id) : undefined,
    source_packet_id: typeof value.source_packet_id === "string" ? redactText(value.source_packet_id) : undefined,
    proposal_status: typeof value.proposal_status === "string" ? readString(value.proposal_status, "") : undefined,
    readiness_status: typeof value.readiness_status === "string" ? readString(value.readiness_status, "") : undefined,
    candidate_kind: readString(value.candidate_kind, "generic"),
    candidate_risk: readString(value.candidate_risk, "medium"),
    proposal_title_preview: preview(readString(value.proposal_title_preview, "")),
    proposal_summary_preview: preview(readString(value.proposal_summary_preview, "")),
    action_kind: typeof value.action_kind === "string" ? readString(value.action_kind, "") : undefined,
    mission_id: typeof value.mission_id === "string" ? redactText(value.mission_id) : undefined,
    result_id: typeof value.result_id === "string" ? redactText(value.result_id) : undefined,
    source_evidence_ids: readStringList(value.source_evidence_ids, 12).map(redactText),
    source_finding_ids: readStringList(value.source_finding_ids, 12).map(redactText),
    source_confidence: typeof value.source_confidence === "number" ? value.source_confidence : undefined,
    existing_apply_id: typeof value.existing_apply_id === "string" ? redactText(value.existing_apply_id) : undefined,
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    recommended_commands: readExecutorReviewProposalNarrowApplyCommands(value.recommended_commands),
    generated_at: readString(value.generated_at, ""),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readExecutorReviewProposalNarrowApplyResult(value: unknown): ExecutorReviewProposalNarrowApplyResultSummary {
  if (!isRecord(value)) throw new Error("runtime.apply_executor_review_proposal_narrow returned invalid result")
  return {
    apply_id: readString(value.apply_id, ""),
    status: readString(value.status, "unknown"),
    proposal_id: readString(value.proposal_id, ""),
    readiness_id: typeof value.readiness_id === "string" ? redactText(value.readiness_id) : undefined,
    review_request_id: typeof value.review_request_id === "string" ? redactText(value.review_request_id) : undefined,
    request_gate_id: typeof value.request_gate_id === "string" ? redactText(value.request_gate_id) : undefined,
    decision_gate_id: typeof value.decision_gate_id === "string" ? redactText(value.decision_gate_id) : undefined,
    create_id: typeof value.create_id === "string" ? redactText(value.create_id) : undefined,
    source_executor_review_id: typeof value.source_executor_review_id === "string" ? redactText(value.source_executor_review_id) : undefined,
    source_draft_id: typeof value.source_draft_id === "string" ? redactText(value.source_draft_id) : undefined,
    source_packet_id: typeof value.source_packet_id === "string" ? redactText(value.source_packet_id) : undefined,
    candidate_kind: readString(value.candidate_kind, "generic"),
    candidate_risk: readString(value.candidate_risk, "medium"),
    applied_at: readString(value.applied_at, ""),
    applied_by: readString(value.applied_by, ""),
    reason_preview: typeof value.reason_preview === "string" ? preview(readString(value.reason_preview, "")) : undefined,
    error: typeof value.error === "string" ? preview(readString(value.error, "")) : undefined,
    apply_hash: readString(value.apply_hash, ""),
    recommended_commands: readExecutorReviewProposalNarrowApplyCommands(value.recommended_commands),
  }
}

function readExecutorReviewProposalNarrowApplyRecords(value: unknown): ExecutorReviewProposalNarrowApplyRecordSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((item) => ({
    apply_id: readString(item.apply_id, ""),
    status: readString(item.status, "unknown"),
    proposal_id: readString(item.proposal_id, ""),
    readiness_id: typeof item.readiness_id === "string" ? redactText(item.readiness_id) : undefined,
    candidate_kind: readString(item.candidate_kind, "generic"),
    candidate_risk: readString(item.candidate_risk, "medium"),
    applied_at: readString(item.applied_at, ""),
    summary_preview: preview(readString(item.summary_preview, "")),
    apply_hash: readString(item.apply_hash, ""),
  }))
}

function readExecutorReviewProposalNarrowApplyCommands(value: unknown): ExecutorReviewProposalNarrowApplyCommandSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 12).map((command) => ({
    label: preview(readString(command.label, "")),
    command: preview(readString(command.command, "")),
    command_type: command.command_type === "write" ? "write" : "read",
    requires_active_runtime: command.requires_active_runtime === true,
    notes: typeof command.notes === "string" ? preview(readString(command.notes, "")) : undefined,
  }))
}

function recordFromExecutorReviewProposalReviewRequestResult(result: ExecutorReviewProposalReviewRequestResultSummary): ExecutorReviewProposalReviewRequestRecordSummary {
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

function recordFromExecutorReviewProposalCreateResult(result: ExecutorReviewProposalCreateResultSummary): ExecutorReviewProposalCreateRecordSummary {
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

function recordFromCommanderExecutorReviewResult(result: CommanderExecutorReviewResultSummary): CommanderExecutorReviewRecordSummary {
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

function readOpenCodeHandoffFollowup(value: unknown): OpenCodeHandoffFollowupSummary | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value) || typeof value.handoff_id !== "string") throw new Error("runtime.get_opencode_handoff_followup returned invalid follow-up")
  return {
    handoff_id: redactText(value.handoff_id),
    proposal_id: readString(value.proposal_id, ""),
    review_id: typeof value.review_id === "string" ? redactText(value.review_id) : undefined,
    mission_id: typeof value.mission_id === "string" ? redactText(value.mission_id) : undefined,
    intent_id: typeof value.intent_id === "string" ? redactText(value.intent_id) : undefined,
    followup_status: readFollowupStatus(value.followup_status),
    handoff_sent: readBoolean(value.handoff_sent),
    proposal_status: typeof value.proposal_status === "string" ? redactText(value.proposal_status) : undefined,
    review_status: typeof value.review_status === "string" ? redactText(value.review_status) : undefined,
    mission_status: typeof value.mission_status === "string" ? redactText(value.mission_status) : undefined,
    active_claim_id: typeof value.active_claim_id === "string" ? redactText(value.active_claim_id) : undefined,
    latest_progress_id: typeof value.latest_progress_id === "string" ? redactText(value.latest_progress_id) : undefined,
    latest_result_id: typeof value.latest_result_id === "string" ? redactText(value.latest_result_id) : undefined,
    result_count: readNumber(value.result_count, 0),
    progress_count: readNumber(value.progress_count, 0),
    blockers: readStringList(value.blockers, 10).map(preview),
    suggested_commands: Array.isArray(value.suggested_commands) ? value.suggested_commands.map(readOpenCodeHandoffFollowupCommand).filter((item): item is OpenCodeHandoffFollowupSummary["suggested_commands"][number] => item !== null).slice(0, 10) : [],
    source_cycle_id: typeof value.source_cycle_id === "string" ? redactText(value.source_cycle_id) : undefined,
    source_synthesis_id: typeof value.source_synthesis_id === "string" ? redactText(value.source_synthesis_id) : undefined,
    evidence_ids: readStringList(value.evidence_ids, 20),
    updated_at: typeof value.updated_at === "string" ? redactText(value.updated_at) : undefined,
  }
}

function readOpenCodeHandoffFollowupCommand(value: unknown): OpenCodeHandoffFollowupSummary["suggested_commands"][number] | null {
  if (!isRecord(value) || typeof value.label !== "string" || typeof value.command !== "string") return null
  return {
    label: preview(redactText(value.label)),
    command: preview(redactText(value.command)),
    command_type: value.command_type === "write" ? "write" : "read",
    requires_active_runtime: value.requires_active_runtime === true,
    requires_review: value.requires_review === true,
  }
}

function readOpenCodeHandoffFollowupList(value: unknown, commandName: string, limit: number): OpenCodeHandoffFollowupSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readOpenCodeHandoffFollowup).filter((record): record is OpenCodeHandoffFollowupSummary => record !== null).slice(0, limit)
}

function readOpenCodeHandoffFollowupCounts(value: unknown): OpenCodeHandoffFollowupCounts {
  if (!isRecord(value)) throw new Error("runtime.opencode_handoff_followup_summary returned invalid summary")
  return {
    sent_count: readNumber(value.sent_count, 0),
    running_count: readNumber(value.running_count, 0),
    result_submitted_count: readNumber(value.result_submitted_count, 0),
    completed_count: readNumber(value.completed_count, 0),
    failed_count: readNumber(value.failed_count, 0),
    blocked_count: readNumber(value.blocked_count, 0),
    stale_count: readNumber(value.stale_count, 0),
    last_handoff_id: typeof value.last_handoff_id === "string" ? redactText(value.last_handoff_id) : undefined,
  }
}

function readOpenCodeHandoffFollowupQueue(value: unknown): { queue: OpenCodeHandoffFollowupQueueKind; items: OpenCodeHandoffFollowupSummary[]; total_considered: number; limit: number } {
  if (!isRecord(value)) throw new Error("runtime.opencode_handoff_followup_queue returned invalid queue")
  const limit = readNumber(value.limit, HANDOFF_LIMIT)
  return {
    queue: readFollowupStatusQueue(value.queue),
    items: readOpenCodeHandoffFollowupList(value.items, "runtime.opencode_handoff_followup_queue", limit),
    total_considered: readNumber(value.total_considered, 0),
    limit,
  }
}

function readRuntimeCheckpointPreview(value: unknown): RuntimeCheckpointPreviewSummary {
  if (!isRecord(value)) throw new Error("runtime.preview_runtime_checkpoint returned invalid preview")
  return {
    checkpoint_id: typeof value.checkpoint_id === "string" ? redactText(value.checkpoint_id) : undefined,
    scope: readCheckpointScope(value.scope),
    reason: typeof value.reason === "string" ? preview(redactText(value.reason)) : undefined,
    event_count: readNumber(value.event_count, 0),
    last_event_id: typeof value.last_event_id === "string" ? redactText(value.last_event_id) : undefined,
    sections: readRuntimeCheckpointSections(value.sections),
    estimated_bytes: readNumber(value.estimated_bytes, 0),
    max_bytes: readNumber(value.max_bytes, 0),
    blockers: readStringList(value.blockers, 10).map(preview),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readRuntimeCheckpoint(value: unknown): RuntimeCheckpointSummary | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value) || typeof value.checkpoint_id !== "string") throw new Error("runtime.get_runtime_checkpoint returned invalid checkpoint")
  return {
    checkpoint_id: redactText(value.checkpoint_id),
    scope: readCheckpointScope(value.scope),
    reason: typeof value.reason === "string" ? preview(redactText(value.reason)) : undefined,
    created_at: readString(value.created_at, ""),
    created_by: readString(value.created_by, "unknown"),
    event_count: readNumber(value.event_count, 0),
    last_event_id: typeof value.last_event_id === "string" ? redactText(value.last_event_id) : undefined,
    checkpoint_hash: readString(value.checkpoint_hash, ""),
    sections: isRecord(value.sections) ? redactUnknown(value.sections) as Record<string, unknown> : {},
    section_summaries: readRuntimeCheckpointSections(value.section_summaries),
    restore_supported: false,
    warnings: readStringList(value.warnings, 10).map(preview),
  }
}

function readRuntimeCheckpointRecordList(value: unknown, commandName: string, limit: number): RuntimeCheckpointRecordSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readRuntimeCheckpointRecord).filter((record): record is RuntimeCheckpointRecordSummary => record !== null).slice(0, limit)
}

function readRuntimeCheckpointRecord(value: unknown): RuntimeCheckpointRecordSummary | null {
  if (!isRecord(value) || typeof value.checkpoint_id !== "string") return null
  return {
    checkpoint_id: redactText(value.checkpoint_id),
    scope: readCheckpointScope(value.scope),
    reason: typeof value.reason === "string" ? preview(redactText(value.reason)) : undefined,
    created_at: readString(value.created_at, ""),
    created_by: readString(value.created_by, "unknown"),
    event_count: readNumber(value.event_count, 0),
    last_event_id: typeof value.last_event_id === "string" ? redactText(value.last_event_id) : undefined,
    checkpoint_hash: readString(value.checkpoint_hash, ""),
    section_names: readStringList(value.section_names, 20),
    summary_preview: preview(readString(value.summary_preview, "")),
  }
}

function recordFromRuntimeCheckpoint(checkpoint: RuntimeCheckpointSummary): RuntimeCheckpointRecordSummary {
  return {
    checkpoint_id: checkpoint.checkpoint_id,
    scope: checkpoint.scope,
    reason: checkpoint.reason,
    created_at: checkpoint.created_at,
    created_by: checkpoint.created_by,
    event_count: checkpoint.event_count,
    last_event_id: checkpoint.last_event_id,
    checkpoint_hash: checkpoint.checkpoint_hash,
    section_names: Object.keys(checkpoint.sections).sort(),
    summary_preview: `sections=${Object.keys(checkpoint.sections).sort().join(",")}`,
  }
}

function readRuntimeRestorePreview(value: unknown): RuntimeRestorePreviewSummary {
  if (!isRecord(value) || typeof value.checkpoint_id !== "string") throw new Error("runtime.preview_checkpoint_restore returned invalid preview")
  return {
    checkpoint_id: redactText(value.checkpoint_id),
    can_mark_resume: readBoolean(value.can_mark_resume),
    verification: readRuntimeCheckpointVerification(value.verification),
    commander_context: readRuntimeRestoreContext(value.commander_context),
    executor_context: readRuntimeRestoreContext(value.executor_context),
    handoff_context: readRuntimeRestoreContext(value.handoff_context),
    reasoning_context: readRuntimeRestoreContext(value.reasoning_context),
    suggested_commands: Array.isArray(value.suggested_commands) ? value.suggested_commands.map(readRuntimeRestoreCommand).filter((item): item is RuntimeRestorePreviewSummary["suggested_commands"][number] => item !== null).slice(0, 10) : [],
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
    created_at: readString(value.created_at, ""),
  }
}

function readRuntimeCheckpointVerification(value: unknown): RuntimeRestorePreviewSummary["verification"] {
  if (!isRecord(value)) throw new Error("runtime.preview_checkpoint_restore returned invalid verification")
  return {
    checkpoint_id: readString(value.checkpoint_id, ""),
    exists: readBoolean(value.exists),
    hash_ok: readBoolean(value.hash_ok),
    cursor_ok: readBoolean(value.cursor_ok),
    event_count_at_checkpoint: readNumber(value.event_count_at_checkpoint, 0),
    current_event_count: readNumber(value.current_event_count, 0),
    checkpoint_last_event_id: typeof value.checkpoint_last_event_id === "string" ? redactText(value.checkpoint_last_event_id) : undefined,
    current_last_event_id: typeof value.current_last_event_id === "string" ? redactText(value.current_last_event_id) : undefined,
    new_event_count: readNumber(value.new_event_count, 0),
    drift_status: readString(value.drift_status, "unknown"),
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
  }
}

function readRuntimeRestoreContext(value: unknown): RuntimeRestorePreviewSummary["commander_context"] {
  if (!isRecord(value)) return { warnings: [] }
  return {
    recent_cycle_ids: readStringList(value.recent_cycle_ids, 20),
    recent_synthesis_ids: readStringList(value.recent_synthesis_ids, 20),
    proposal_ids: readStringList(value.proposal_ids, 20),
    review_ids: readStringList(value.review_ids, 20),
    bundle_ids: readStringList(value.bundle_ids, 20),
    mission_ids: readStringList(value.mission_ids, 20),
    active_mission_ids: readStringList(value.active_mission_ids, 20),
    active_claim_ids: readStringList(value.active_claim_ids, 20),
    result_ids: readStringList(value.result_ids, 20),
    progress_ids: readStringList(value.progress_ids, 20),
    handoff_ids: readStringList(value.handoff_ids, 20),
    active_handoff_ids: readStringList(value.active_handoff_ids, 20),
    needs_result_review_ids: readStringList(value.needs_result_review_ids, 20),
    failed_handoff_ids: readStringList(value.failed_handoff_ids, 20),
    provider_id: typeof value.provider_id === "string" ? redactText(value.provider_id) : undefined,
    provider_kind: typeof value.provider_kind === "string" ? redactText(value.provider_kind) : undefined,
    health_status: typeof value.health_status === "string" ? redactText(value.health_status) : undefined,
    warnings: readStringList(value.warnings, 10).map(preview),
  }
}

function readRuntimeRestoreCommand(value: unknown): RuntimeRestorePreviewSummary["suggested_commands"][number] | null {
  if (!isRecord(value) || typeof value.label !== "string" || typeof value.command !== "string") return null
  return {
    label: preview(redactText(value.label)),
    command: preview(redactText(value.command)),
    command_type: value.command_type === "write" ? "write" : "read",
    requires_active_runtime: value.requires_active_runtime === true,
  }
}

function readRuntimeResumeAnchor(value: unknown): RuntimeResumeAnchorSummary | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value) || typeof value.resume_id !== "string") throw new Error("runtime.get_checkpoint_resume_anchor returned invalid anchor")
  return {
    resume_id: redactText(value.resume_id),
    checkpoint_id: readString(value.checkpoint_id, ""),
    checkpoint_hash: readString(value.checkpoint_hash, ""),
    marked_at: readString(value.marked_at, ""),
    marked_by: readString(value.marked_by, "operator"),
    event_count_at_checkpoint: readNumber(value.event_count_at_checkpoint, 0),
    current_event_count: readNumber(value.current_event_count, 0),
    checkpoint_last_event_id: typeof value.checkpoint_last_event_id === "string" ? redactText(value.checkpoint_last_event_id) : undefined,
    current_last_event_id: typeof value.current_last_event_id === "string" ? redactText(value.current_last_event_id) : undefined,
    drift_status: readString(value.drift_status, "unknown"),
    summary_preview: preview(readString(value.summary_preview, "")),
  }
}

function readRuntimeResumeAnchorList(value: unknown, commandName: string, limit: number): RuntimeResumeAnchorSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readRuntimeResumeAnchor).filter((anchor): anchor is RuntimeResumeAnchorSummary => anchor !== null).slice(0, limit)
}

function readWakeAssessmentPreview(value: unknown): WakeAssessmentPreviewSummary {
  if (!isRecord(value)) throw new Error("runtime.preview_wake_assessment returned invalid preview")
  return {
    wake_id: typeof value.wake_id === "string" ? redactText(value.wake_id) : undefined,
    trigger_kind: readString(value.trigger_kind, "manual"),
    resume_id: typeof value.resume_id === "string" ? redactText(value.resume_id) : undefined,
    checkpoint_id: typeof value.checkpoint_id === "string" ? redactText(value.checkpoint_id) : undefined,
    allowed: readBoolean(value.allowed),
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    drift_status: typeof value.drift_status === "string" ? redactText(value.drift_status) : undefined,
    current_event_count: readNumber(value.current_event_count, 0),
    checkpoint_event_count: typeof value.checkpoint_event_count === "number" ? value.checkpoint_event_count : undefined,
    new_event_count: typeof value.new_event_count === "number" ? value.new_event_count : undefined,
    reasoning_health_status: typeof value.reasoning_health_status === "string" ? redactText(value.reasoning_health_status) : undefined,
    handoff_summary: isRecord(value.handoff_summary) ? redactUnknown(value.handoff_summary) as Record<string, unknown> : undefined,
    commander_summary: isRecord(value.commander_summary) ? redactUnknown(value.commander_summary) as Record<string, unknown> : undefined,
    executor_summary: isRecord(value.executor_summary) ? redactUnknown(value.executor_summary) as Record<string, unknown> : undefined,
    suggested_commands: Array.isArray(value.suggested_commands) ? value.suggested_commands.map(readWakeSuggestedCommand).filter((item): item is WakeSuggestedCommandSummary => item !== null).slice(0, 10) : [],
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readWakeAssessment(value: unknown): WakeAssessmentSummary | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value) || typeof value.wake_id !== "string") throw new Error("runtime.get_wake_assessment returned invalid assessment")
  return {
    wake_id: redactText(value.wake_id),
    trigger_kind: readString(value.trigger_kind, "manual"),
    resume_id: typeof value.resume_id === "string" ? redactText(value.resume_id) : undefined,
    checkpoint_id: typeof value.checkpoint_id === "string" ? redactText(value.checkpoint_id) : undefined,
    checkpoint_hash: typeof value.checkpoint_hash === "string" ? redactText(value.checkpoint_hash) : undefined,
    created_at: readString(value.created_at, ""),
    requested_by: readString(value.requested_by, "operator"),
    allowed: readBoolean(value.allowed),
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    drift_status: typeof value.drift_status === "string" ? redactText(value.drift_status) : undefined,
    current_event_count: readNumber(value.current_event_count, 0),
    checkpoint_event_count: typeof value.checkpoint_event_count === "number" ? value.checkpoint_event_count : undefined,
    new_event_count: typeof value.new_event_count === "number" ? value.new_event_count : undefined,
    sections: isRecord(value.sections) ? redactUnknown(value.sections) as WakeAssessmentSummary["sections"] : {},
    suggested_commands: Array.isArray(value.suggested_commands) ? value.suggested_commands.map(readWakeSuggestedCommand).filter((item): item is WakeSuggestedCommandSummary => item !== null).slice(0, 10) : [],
    assessment_hash: readString(value.assessment_hash, ""),
  }
}

function readWakeAssessmentRecordList(value: unknown, commandName: string, limit: number): WakeAssessmentRecordSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readWakeAssessmentRecord).filter((record): record is WakeAssessmentRecordSummary => record !== null).slice(0, limit)
}

function readWakeAssessmentRecord(value: unknown): WakeAssessmentRecordSummary | null {
  if (!isRecord(value) || typeof value.wake_id !== "string") return null
  return {
    wake_id: redactText(value.wake_id),
    trigger_kind: readString(value.trigger_kind, "manual"),
    resume_id: typeof value.resume_id === "string" ? redactText(value.resume_id) : undefined,
    checkpoint_id: typeof value.checkpoint_id === "string" ? redactText(value.checkpoint_id) : undefined,
    allowed: readBoolean(value.allowed),
    drift_status: typeof value.drift_status === "string" ? redactText(value.drift_status) : undefined,
    created_at: readString(value.created_at, ""),
    requested_by: readString(value.requested_by, "operator"),
    summary_preview: preview(readString(value.summary_preview, "")),
    assessment_hash: readString(value.assessment_hash, ""),
  }
}

function readWakeSuggestedCommand(value: unknown): WakeSuggestedCommandSummary | null {
  if (!isRecord(value) || typeof value.label !== "string" || typeof value.command !== "string") return null
  return {
    label: preview(redactText(value.label)),
    command: preview(redactText(value.command)),
    command_type: value.command_type === "write" ? "write" : "read",
    requires_active_runtime: value.requires_active_runtime === true,
    requires_review: value.requires_review === true,
  }
}

function recordFromWakeAssessment(assessment: WakeAssessmentSummary): WakeAssessmentRecordSummary {
  return {
    wake_id: assessment.wake_id,
    trigger_kind: assessment.trigger_kind,
    resume_id: assessment.resume_id,
    checkpoint_id: assessment.checkpoint_id,
    allowed: assessment.allowed,
    drift_status: assessment.drift_status,
    created_at: assessment.created_at,
    requested_by: assessment.requested_by,
    summary_preview: `wake checkpoint=${assessment.checkpoint_id ?? "none"} allowed=${assessment.allowed}`,
    assessment_hash: assessment.assessment_hash,
  }
}

function readContinuationPlanPreview(value: unknown): ContinuationPlanPreviewSummary {
  if (!isRecord(value)) throw new Error("runtime.preview_continuation_plan returned invalid preview")
  return {
    wake_id: readString(value.wake_id, ""),
    resume_id: typeof value.resume_id === "string" ? redactText(value.resume_id) : undefined,
    checkpoint_id: typeof value.checkpoint_id === "string" ? redactText(value.checkpoint_id) : undefined,
    can_create: readBoolean(value.can_create),
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    step_count: readNumber(value.step_count, 0),
    read_step_count: readNumber(value.read_step_count, 0),
    write_step_count: readNumber(value.write_step_count, 0),
    operator_checkpoint_count: readNumber(value.operator_checkpoint_count, 0),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
    steps: Array.isArray(value.steps) ? value.steps.map(readContinuationStepPreview).filter((step): step is ContinuationStepPreviewSummary => step !== null).slice(0, 10) : [],
  }
}

function readContinuationPlan(value: unknown): ContinuationPlanSummary | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value) || typeof value.plan_id !== "string") throw new Error("runtime.get_continuation_plan returned invalid plan")
  return {
    plan_id: redactText(value.plan_id),
    wake_id: readString(value.wake_id, ""),
    resume_id: typeof value.resume_id === "string" ? redactText(value.resume_id) : undefined,
    checkpoint_id: typeof value.checkpoint_id === "string" ? redactText(value.checkpoint_id) : undefined,
    status: readString(value.status, "proposed"),
    created_at: readString(value.created_at, ""),
    created_by: readString(value.created_by, "operator"),
    updated_at: readString(value.updated_at, ""),
    plan_hash: readString(value.plan_hash, ""),
    steps: Array.isArray(value.steps) ? value.steps.map(readContinuationStep).filter((step): step is ContinuationStepSummary => step !== null).slice(0, 20) : [],
    current_step_index: typeof value.current_step_index === "number" ? value.current_step_index : undefined,
    completed_step_count: readNumber(value.completed_step_count, 0),
    failed_step_count: readNumber(value.failed_step_count, 0),
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
  }
}

function readContinuationStepPreview(value: unknown): ContinuationStepPreviewSummary | null {
  if (!isRecord(value) || typeof value.command !== "string") return null
  return {
    index: readNumber(value.index, 0),
    label: preview(readString(value.label, "")),
    command: preview(readString(value.command, "")),
    command_type: value.command_type === "write" ? "write" : "read",
    step_kind: readString(value.step_kind, "read_command"),
    requires_active_runtime: value.requires_active_runtime === true,
    requires_review: value.requires_review === true,
    allowed_by_default: readBoolean(value.allowed_by_default),
    blockers: readStringList(value.blockers, 10).map(preview),
  }
}

function readContinuationStep(value: unknown): ContinuationStepSummary | null {
  const base = readContinuationStepPreview(value)
  if (!base || !isRecord(value) || typeof value.step_id !== "string") return null
  return {
    ...base,
    step_id: redactText(value.step_id),
    status: readString(value.status, "pending"),
    created_from_suggestion: value.created_from_suggestion === true,
    result_summary: typeof value.result_summary === "string" ? preview(redactText(value.result_summary)) : undefined,
    error: typeof value.error === "string" ? preview(redactText(value.error)) : undefined,
    started_at: typeof value.started_at === "string" ? redactText(value.started_at) : undefined,
    completed_at: typeof value.completed_at === "string" ? redactText(value.completed_at) : undefined,
  }
}

function readContinuationStepResult(value: unknown): ContinuationStepResultSummary {
  if (!isRecord(value) || typeof value.plan_id !== "string" || typeof value.step_id !== "string") throw new Error("runtime.execute_continuation_step returned invalid result")
  return {
    plan_id: redactText(value.plan_id),
    step_id: redactText(value.step_id),
    index: readNumber(value.index, 0),
    status: readString(value.status, "failed"),
    command: preview(readString(value.command, "")),
    result_summary: typeof value.result_summary === "string" ? preview(redactText(value.result_summary)) : undefined,
    error: typeof value.error === "string" ? preview(redactText(value.error)) : undefined,
    dry_run: value.dry_run === true,
    started_at: readString(value.started_at, ""),
    completed_at: readString(value.completed_at, ""),
  }
}

function readContinuationPlanRecordList(value: unknown, commandName: string, limit: number): ContinuationPlanRecordSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readContinuationPlanRecord).filter((record): record is ContinuationPlanRecordSummary => record !== null).slice(0, limit)
}

function readContinuationPlanRecord(value: unknown): ContinuationPlanRecordSummary | null {
  if (!isRecord(value) || typeof value.plan_id !== "string") return null
  return {
    plan_id: redactText(value.plan_id),
    wake_id: readString(value.wake_id, ""),
    status: readString(value.status, "proposed"),
    created_at: readString(value.created_at, ""),
    updated_at: readString(value.updated_at, ""),
    step_count: readNumber(value.step_count, 0),
    completed_step_count: readNumber(value.completed_step_count, 0),
    failed_step_count: readNumber(value.failed_step_count, 0),
    summary_preview: preview(readString(value.summary_preview, "")),
    plan_hash: readString(value.plan_hash, ""),
  }
}

function recordFromContinuationPlan(plan: ContinuationPlanSummary): ContinuationPlanRecordSummary {
  return {
    plan_id: plan.plan_id,
    wake_id: plan.wake_id,
    status: plan.status,
    created_at: plan.created_at,
    updated_at: plan.updated_at,
    step_count: plan.steps.length,
    completed_step_count: plan.completed_step_count,
    failed_step_count: plan.failed_step_count,
    summary_preview: `continuation wake=${plan.wake_id} status=${plan.status}`,
    plan_hash: plan.plan_hash,
  }
}

function readWakeSchedulePolicy(value: unknown): WakeSchedulePreviewSummary["policy"] {
  if (!isRecord(value)) {
    return {
      create_wake_assessment: true,
      create_continuation_plan: false,
      include_write_steps: false,
      max_wake_assessments_per_tick: 1,
      max_continuation_plans_per_tick: 0,
    }
  }
  return {
    create_wake_assessment: value.create_wake_assessment !== false,
    create_continuation_plan: value.create_continuation_plan === true,
    include_write_steps: value.include_write_steps === true,
    max_wake_assessments_per_tick: readNumber(value.max_wake_assessments_per_tick, 1),
    max_continuation_plans_per_tick: readNumber(value.max_continuation_plans_per_tick, 0),
  }
}

function readWakeSchedulePreview(value: unknown): WakeSchedulePreviewSummary {
  if (!isRecord(value) || typeof value.resume_id !== "string") throw new Error("runtime.preview_wake_schedule returned invalid preview")
  return {
    resume_id: redactText(value.resume_id),
    checkpoint_id: typeof value.checkpoint_id === "string" ? redactText(value.checkpoint_id) : undefined,
    title: preview(readString(value.title, "")),
    interval_ms: readNumber(value.interval_ms, 0),
    next_due_at: readString(value.next_due_at, ""),
    policy: readWakeSchedulePolicy(value.policy),
    can_create: readBoolean(value.can_create),
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readWakeSchedule(value: unknown): WakeScheduleSummary | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value) || typeof value.schedule_id !== "string") throw new Error("runtime.get_wake_schedule returned invalid schedule")
  return {
    schedule_id: redactText(value.schedule_id),
    resume_id: readString(value.resume_id, ""),
    checkpoint_id: typeof value.checkpoint_id === "string" ? redactText(value.checkpoint_id) : undefined,
    status: readString(value.status, "active"),
    title: preview(readString(value.title, "")),
    interval_ms: readNumber(value.interval_ms, 0),
    next_due_at: readString(value.next_due_at, ""),
    last_tick_at: typeof value.last_tick_at === "string" ? redactText(value.last_tick_at) : undefined,
    last_wake_id: typeof value.last_wake_id === "string" ? redactText(value.last_wake_id) : undefined,
    last_plan_id: typeof value.last_plan_id === "string" ? redactText(value.last_plan_id) : undefined,
    created_at: readString(value.created_at, ""),
    created_by: readString(value.created_by, "operator"),
    updated_at: readString(value.updated_at, ""),
    policy: readWakeSchedulePolicy(value.policy),
    reason: typeof value.reason === "string" ? preview(redactText(value.reason)) : undefined,
    schedule_hash: readString(value.schedule_hash, ""),
    warnings: readStringList(value.warnings, 10).map(preview),
  }
}

function readWakeScheduleRecordList(value: unknown, commandName: string, limit: number): WakeScheduleRecordSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readWakeScheduleRecord).filter((record): record is WakeScheduleRecordSummary => record !== null).slice(0, limit)
}

function readWakeScheduleRecord(value: unknown): WakeScheduleRecordSummary | null {
  if (!isRecord(value) || typeof value.schedule_id !== "string") return null
  return {
    schedule_id: redactText(value.schedule_id),
    resume_id: readString(value.resume_id, ""),
    status: readString(value.status, "active"),
    title: preview(readString(value.title, "")),
    next_due_at: readString(value.next_due_at, ""),
    last_tick_at: typeof value.last_tick_at === "string" ? redactText(value.last_tick_at) : undefined,
    last_wake_id: typeof value.last_wake_id === "string" ? redactText(value.last_wake_id) : undefined,
    last_plan_id: typeof value.last_plan_id === "string" ? redactText(value.last_plan_id) : undefined,
    summary_preview: preview(readString(value.summary_preview, "")),
  }
}

function recordFromWakeSchedule(schedule: WakeScheduleSummary): WakeScheduleRecordSummary {
  return {
    schedule_id: schedule.schedule_id,
    resume_id: schedule.resume_id,
    status: schedule.status,
    title: schedule.title,
    next_due_at: schedule.next_due_at,
    last_tick_at: schedule.last_tick_at,
    last_wake_id: schedule.last_wake_id,
    last_plan_id: schedule.last_plan_id,
    summary_preview: `wake schedule resume=${schedule.resume_id} status=${schedule.status}`,
  }
}

function readWakeScheduleDueItem(value: unknown): WakeScheduleDueItemSummary | null {
  if (!isRecord(value) || typeof value.schedule_id !== "string") return null
  return {
    schedule_id: redactText(value.schedule_id),
    resume_id: readString(value.resume_id, ""),
    checkpoint_id: typeof value.checkpoint_id === "string" ? redactText(value.checkpoint_id) : undefined,
    due: readBoolean(value.due),
    status: readString(value.status, "active"),
    next_due_at: readString(value.next_due_at, ""),
    last_tick_at: typeof value.last_tick_at === "string" ? redactText(value.last_tick_at) : undefined,
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    would_create_wake: readBoolean(value.would_create_wake),
    would_create_continuation_plan: readBoolean(value.would_create_continuation_plan),
  }
}

function readWakeScheduleTickPreview(value: unknown): WakeScheduleTickPreviewSummary {
  if (!isRecord(value) || typeof value.now !== "string") throw new Error("runtime.preview_wake_schedule_tick returned invalid preview")
  return {
    now: redactText(value.now),
    due_count: readNumber(value.due_count, 0),
    eligible_count: readNumber(value.eligible_count, 0),
    blocked_count: readNumber(value.blocked_count, 0),
    items: Array.isArray(value.items) ? value.items.map(readWakeScheduleDueItem).filter((item): item is WakeScheduleDueItemSummary => item !== null).slice(0, 20) : [],
    max_items: readNumber(value.max_items, 0),
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
  }
}

function readWakeScheduleTickResult(value: unknown): WakeScheduleTickResultSummary | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value) || typeof value.tick_id !== "string") throw new Error("runtime.get_wake_schedule_tick returned invalid tick")
  return {
    tick_id: redactText(value.tick_id),
    now: readString(value.now, ""),
    processed_count: readNumber(value.processed_count, 0),
    wake_ids: readStringList(value.wake_ids, 20),
    plan_ids: readStringList(value.plan_ids, 20),
    skipped: Array.isArray(value.skipped) ? value.skipped.map(readWakeScheduleDueItem).filter((item): item is WakeScheduleDueItemSummary => item !== null).slice(0, 20) : [],
    created_at: readString(value.created_at, ""),
    requested_by: readString(value.requested_by, "operator"),
    dry_run: readBoolean(value.dry_run),
  }
}

function readWakeScheduleTickResultList(value: unknown, commandName: string, limit: number): WakeScheduleTickResultSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readWakeScheduleTickResult).filter((tick): tick is WakeScheduleTickResultSummary => tick !== null).slice(0, limit)
}

function readWakeSchedulerConfig(value: unknown): WakeSchedulerConfigSummary {
  if (!isRecord(value)) {
    return { enabled: false, interval_ms: 60_000, max_due_items: 5, dry_run: false, heartbeat_interval_ms: 60_000, stop_on_error: false }
  }
  return {
    enabled: readBoolean(value.enabled),
    interval_ms: readNumber(value.interval_ms, 60_000),
    max_due_items: readNumber(value.max_due_items, 5),
    dry_run: readBoolean(value.dry_run),
    started_by: typeof value.started_by === "string" ? preview(redactText(value.started_by)) : undefined,
    heartbeat_interval_ms: typeof value.heartbeat_interval_ms === "number" ? readNumber(value.heartbeat_interval_ms, 60_000) : undefined,
    max_ticks_per_run: typeof value.max_ticks_per_run === "number" ? readNumber(value.max_ticks_per_run, 0) : undefined,
    stop_on_error: readBoolean(value.stop_on_error),
  }
}

function readWakeSchedulerPreview(value: unknown): WakeSchedulerPreviewSummary {
  if (!isRecord(value) || !isRecord(value.config)) throw new Error("runtime.preview_wake_scheduler_start returned invalid preview")
  return {
    can_start: readBoolean(value.can_start),
    status: readString(value.status, "stopped"),
    config: readWakeSchedulerConfig(value.config),
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    due_preview: isRecord(value.due_preview) ? readWakeScheduleTickPreview(value.due_preview) : undefined,
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readWakeSchedulerBootstrapStatus(value: unknown, commandName: string): WakeSchedulerBootstrapStatusSummary {
  if (!isRecord(value) || !isRecord(value.config)) throw new Error(`${commandName} returned invalid bootstrap status`)
  const config = value.config
  return {
    autostart_enabled: readBoolean(value.autostart_enabled),
    configured: readBoolean(value.configured),
    can_bootstrap: readBoolean(value.can_bootstrap),
    scheduler_status: readString(value.scheduler_status, "stopped"),
    config: {
      ...readWakeSchedulerConfig({
        ...config,
        enabled: value.autostart_enabled,
        started_by: config.requested_by,
      }),
      require_due_schedule: readBoolean(config.require_due_schedule),
      requested_by: typeof config.requested_by === "string" ? preview(redactText(config.requested_by)) : undefined,
    },
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    last_bootstrap_event_id: typeof value.last_bootstrap_event_id === "string" ? redactText(value.last_bootstrap_event_id) : undefined,
    last_bootstrap_at: typeof value.last_bootstrap_at === "string" ? redactText(value.last_bootstrap_at) : undefined,
    stale_prior_run: readWakeSchedulerStaleRun(value.stale_prior_run),
    due_preview: isRecord(value.due_preview) ? readWakeScheduleTickPreview(value.due_preview) : undefined,
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readWakeSchedulerStaleRun(value: unknown): WakeSchedulerBootstrapStatusSummary["stale_prior_run"] {
  if (!isRecord(value)) return undefined
  return {
    detected: readBoolean(value.detected),
    prior_started_at: typeof value.prior_started_at === "string" ? redactText(value.prior_started_at) : undefined,
    prior_status: typeof value.prior_status === "string" ? readString(value.prior_status, "running") : undefined,
    prior_tick_id: typeof value.prior_tick_id === "string" ? redactText(value.prior_tick_id) : undefined,
    prior_event_id: typeof value.prior_event_id === "string" ? redactText(value.prior_event_id) : undefined,
    reason: typeof value.reason === "string" ? preview(redactText(value.reason)) : undefined,
  }
}

function readWakeSchedulerRecoveryPreview(value: unknown, commandName: string): WakeSchedulerRecoveryPreviewSummary {
  if (!isRecord(value)) throw new Error(`${commandName} returned invalid recovery preview`)
  return {
    recovery_id: typeof value.recovery_id === "string" ? redactText(value.recovery_id) : undefined,
    stale_detected: readBoolean(value.stale_detected),
    status: readString(value.status, "none"),
    prior_started_at: typeof value.prior_started_at === "string" ? redactText(value.prior_started_at) : undefined,
    prior_event_id: typeof value.prior_event_id === "string" ? redactText(value.prior_event_id) : undefined,
    prior_tick_id: typeof value.prior_tick_id === "string" ? redactText(value.prior_tick_id) : undefined,
    scheduler_status: readString(value.scheduler_status, "stopped"),
    current_event_count: readNumber(value.current_event_count, 0),
    due_schedule_count: readNumber(value.due_schedule_count, 0),
    eligible_due_schedule_count: readNumber(value.eligible_due_schedule_count, 0),
    blocked_due_schedule_count: readNumber(value.blocked_due_schedule_count, 0),
    missed_window_estimate_count: typeof value.missed_window_estimate_count === "number" ? readNumber(value.missed_window_estimate_count, 0) : undefined,
    warnings: readStringList(value.warnings, 10).map(preview),
    blockers: readStringList(value.blockers, 10).map(preview),
    recommended_commands: readWakeSchedulerRecoveryCommands(value.recommended_commands),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readWakeSchedulerRecovery(value: unknown, commandName: string): WakeSchedulerRecoverySummary | null {
  if (value === null || value === undefined) return null
  const previewResult = readWakeSchedulerRecoveryPreview(value, commandName)
  if (!previewResult.recovery_id || !isRecord(value)) throw new Error(`${commandName} returned invalid recovery`)
  return {
    ...previewResult,
    recovery_id: previewResult.recovery_id,
    acknowledged_at: typeof value.acknowledged_at === "string" ? redactText(value.acknowledged_at) : undefined,
    acknowledged_by: typeof value.acknowledged_by === "string" ? preview(redactText(value.acknowledged_by)) : undefined,
    resolution_reason: typeof value.resolution_reason === "string" ? preview(redactText(value.resolution_reason)) : undefined,
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : "",
    updated_at: typeof value.updated_at === "string" ? redactText(value.updated_at) : "",
    recovery_hash: typeof value.recovery_hash === "string" ? redactText(value.recovery_hash) : "",
  }
}

function readWakeSchedulerRecoveryRecordList(value: unknown, commandName: string, limit: number): WakeSchedulerRecoveryRecordSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readWakeSchedulerRecoveryRecord).filter((record): record is WakeSchedulerRecoveryRecordSummary => record !== null).slice(0, limit)
}

function readWakeSchedulerRecoveryRecord(value: unknown): WakeSchedulerRecoveryRecordSummary | null {
  if (!isRecord(value) || typeof value.recovery_id !== "string") return null
  return {
    recovery_id: redactText(value.recovery_id),
    status: readString(value.status, "none"),
    stale_detected: readBoolean(value.stale_detected),
    prior_started_at: typeof value.prior_started_at === "string" ? redactText(value.prior_started_at) : undefined,
    acknowledged_at: typeof value.acknowledged_at === "string" ? redactText(value.acknowledged_at) : undefined,
    updated_at: typeof value.updated_at === "string" ? redactText(value.updated_at) : "",
    summary_preview: typeof value.summary_preview === "string" ? preview(redactText(value.summary_preview)) : "",
    recovery_hash: typeof value.recovery_hash === "string" ? redactText(value.recovery_hash) : "",
  }
}

function readWakeSchedulerRecoveryCommands(value: unknown): WakeSchedulerRecoveryPreviewSummary["recommended_commands"] {
  if (!Array.isArray(value)) return []
  const out: WakeSchedulerRecoveryPreviewSummary["recommended_commands"] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    out.push({
      label: preview(readString(item.label, "")),
      command: preview(redactText(readString(item.command, ""))),
      command_type: readString(item.command_type, "read"),
      requires_active_runtime: typeof item.requires_active_runtime === "boolean" ? item.requires_active_runtime : undefined,
      notes: typeof item.notes === "string" ? preview(redactText(item.notes)) : undefined,
    })
    if (out.length >= 10) break
  }
  return out
}

function readWakeSchedulerRecoveryWorkflowPreview(value: unknown, commandName: string): WakeSchedulerRecoveryWorkflowPreviewSummary {
  if (!isRecord(value)) throw new Error(`${commandName} returned invalid workflow preview`)
  return {
    recovery_id: readString(value.recovery_id, ""),
    can_create: readBoolean(value.can_create),
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    recovery_status: readString(value.recovery_status, "none"),
    stale_detected: readBoolean(value.stale_detected),
    step_count: readNumber(value.step_count, 0),
    read_step_count: readNumber(value.read_step_count, 0),
    write_step_count: readNumber(value.write_step_count, 0),
    dry_run_step_count: readNumber(value.dry_run_step_count, 0),
    resolution_step_count: readNumber(value.resolution_step_count, 0),
    steps: readWakeSchedulerRecoveryWorkflowSteps(value.steps),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readWakeSchedulerRecoveryWorkflow(value: unknown, commandName: string): WakeSchedulerRecoveryWorkflowSummary | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value) || typeof value.workflow_id !== "string") throw new Error(`${commandName} returned invalid workflow`)
  return {
    workflow_id: redactText(value.workflow_id),
    recovery_id: readString(value.recovery_id, ""),
    recovery_hash: typeof value.recovery_hash === "string" ? redactText(value.recovery_hash) : undefined,
    status: readString(value.status, "active"),
    created_at: readString(value.created_at, ""),
    created_by: typeof value.created_by === "string" ? preview(redactText(value.created_by)) : "",
    updated_at: readString(value.updated_at, ""),
    workflow_hash: typeof value.workflow_hash === "string" ? redactText(value.workflow_hash) : "",
    steps: readWakeSchedulerRecoveryWorkflowSteps(value.steps),
    completed_step_count: readNumber(value.completed_step_count, 0),
    skipped_step_count: readNumber(value.skipped_step_count, 0),
    blocked_step_count: readNumber(value.blocked_step_count, 0),
    warnings: readStringList(value.warnings, 10).map(preview),
    blockers: readStringList(value.blockers, 10).map(preview),
  }
}

function readWakeSchedulerRecoveryWorkflowRecordList(value: unknown, commandName: string, limit: number): WakeSchedulerRecoveryWorkflowRecordSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readWakeSchedulerRecoveryWorkflowRecord).filter((record): record is WakeSchedulerRecoveryWorkflowRecordSummary => record !== null).slice(0, limit)
}

function readWakeSchedulerRecoveryWorkflowRecord(value: unknown): WakeSchedulerRecoveryWorkflowRecordSummary | null {
  if (!isRecord(value) || typeof value.workflow_id !== "string") return null
  return {
    workflow_id: redactText(value.workflow_id),
    recovery_id: readString(value.recovery_id, ""),
    status: readString(value.status, "active"),
    created_at: readString(value.created_at, ""),
    updated_at: readString(value.updated_at, ""),
    step_count: readNumber(value.step_count, 0),
    completed_step_count: readNumber(value.completed_step_count, 0),
    skipped_step_count: readNumber(value.skipped_step_count, 0),
    blocked_step_count: readNumber(value.blocked_step_count, 0),
    summary_preview: typeof value.summary_preview === "string" ? preview(redactText(value.summary_preview)) : "",
    workflow_hash: typeof value.workflow_hash === "string" ? redactText(value.workflow_hash) : "",
  }
}

function readWakeSchedulerRecoveryWorkflowVerification(value: unknown, commandName: string): WakeSchedulerRecoveryWorkflowVerificationSummary {
  if (!isRecord(value)) throw new Error(`${commandName} returned invalid workflow verification`)
  return {
    workflow_id: readString(value.workflow_id, ""),
    recovery_id: readString(value.recovery_id, ""),
    checked_at: readString(value.checked_at, ""),
    observable_events: Array.isArray(value.observable_events) ? value.observable_events.filter(isRecord).slice(0, 20).map((event) => ({
      kind: readString(event.kind, "event"),
      event_id: typeof event.event_id === "string" ? redactText(event.event_id) : undefined,
      created_at: typeof event.created_at === "string" ? redactText(event.created_at) : undefined,
      command_match: typeof event.command_match === "string" ? preview(redactText(event.command_match)) : undefined,
      summary_preview: typeof event.summary_preview === "string" ? preview(redactText(event.summary_preview)) : "",
    })) : [],
    step_updates: Array.isArray(value.step_updates) ? value.step_updates.filter(isRecord).slice(0, 20).map((update) => ({
      step_id: readString(update.step_id, ""),
      index: readNumber(update.index, 0),
      suggested_status: readString(update.suggested_status, "verified"),
      verification_summary: preview(readString(update.verification_summary, "")),
    })) : [],
    warnings: readStringList(value.warnings, 20).map(preview),
  }
}

function readWakeSchedulerRecoveryWorkflowSteps(value: unknown): WakeSchedulerRecoveryWorkflowStepSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 20).map((step) => ({
    step_id: typeof step.step_id === "string" ? redactText(step.step_id) : undefined,
    index: readNumber(step.index, 0),
    label: preview(readString(step.label, "")),
    command: preview(redactText(readString(step.command, ""))),
    command_type: readString(step.command_type, "read"),
    step_kind: readString(step.step_kind, "read_command"),
    allowed_to_execute_here: false,
    requires_active_runtime: typeof step.requires_active_runtime === "boolean" ? step.requires_active_runtime : undefined,
    verification_hint: typeof step.verification_hint === "string" ? preview(redactText(step.verification_hint)) : undefined,
    status: typeof step.status === "string" ? readString(step.status, "pending") : undefined,
    note: typeof step.note === "string" ? preview(redactText(step.note)) : undefined,
    marked_at: typeof step.marked_at === "string" ? redactText(step.marked_at) : undefined,
    marked_by: typeof step.marked_by === "string" ? preview(redactText(step.marked_by)) : undefined,
    verification_summary: typeof step.verification_summary === "string" ? preview(redactText(step.verification_summary)) : undefined,
    blockers: readStringList(step.blockers, 10).map(preview),
  }))
}

function readWakeSchedulerAuditSummary(value: unknown, commandName: string): WakeSchedulerAuditSummarySummary {
  if (!isRecord(value)) throw new Error(`${commandName} returned invalid audit summary`)
  return {
    event_count: readNumber(value.event_count, 0),
    checkpoint_count: readNumber(value.checkpoint_count, 0),
    resume_anchor_count: readNumber(value.resume_anchor_count, 0),
    wake_assessment_count: readNumber(value.wake_assessment_count, 0),
    continuation_plan_count: readNumber(value.continuation_plan_count, 0),
    continuation_step_count: readNumber(value.continuation_step_count, 0),
    schedule_count: readNumber(value.schedule_count, 0),
    tick_count: readNumber(value.tick_count, 0),
    scheduler_start_count: readNumber(value.scheduler_start_count, 0),
    scheduler_stop_count: readNumber(value.scheduler_stop_count, 0),
    scheduler_failure_count: readNumber(value.scheduler_failure_count, 0),
    bootstrap_blocked_count: readNumber(value.bootstrap_blocked_count, 0),
    stale_recovery_count: readNumber(value.stale_recovery_count, 0),
    recovery_workflow_count: readNumber(value.recovery_workflow_count, 0),
    unresolved_incident_count: readNumber(value.unresolved_incident_count, 0),
    last_event_at: typeof value.last_event_at === "string" ? redactText(value.last_event_at) : undefined,
    latest_scheduler_status: typeof value.latest_scheduler_status === "string" ? redactText(value.latest_scheduler_status) : undefined,
    latest_bootstrap_status: typeof value.latest_bootstrap_status === "string" ? redactText(value.latest_bootstrap_status) : undefined,
    latest_recovery_status: typeof value.latest_recovery_status === "string" ? redactText(value.latest_recovery_status) : undefined,
  }
}

function readWakeSchedulerAuditTimeline(value: unknown, commandName: string, limit: number): WakeSchedulerAuditTimelineEntrySummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readWakeSchedulerAuditTimelineEntry).filter((entry): entry is WakeSchedulerAuditTimelineEntrySummary => entry !== null).slice(0, limit)
}

function readWakeSchedulerAuditTimelineEntry(value: unknown): WakeSchedulerAuditTimelineEntrySummary | null {
  if (!isRecord(value) || typeof value.audit_id !== "string") return null
  return {
    audit_id: redactText(value.audit_id),
    event_id: typeof value.event_id === "string" ? redactText(value.event_id) : undefined,
    source_kind: readString(value.source_kind, "other"),
    source_event_kind: readString(value.source_event_kind, "unknown"),
    severity: readString(value.severity, "info"),
    created_at: readString(value.created_at, ""),
    title: preview(readString(value.title, "")),
    summary: preview(readString(value.summary, "")),
    related_ids: readRelatedIds(value.related_ids),
    recommended_commands: readWakeSchedulerAuditCommands(value.recommended_commands),
  }
}

function readWakeSchedulerAuditCommands(value: unknown): WakeSchedulerAuditCommandSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 10).map((command) => ({
    label: preview(readString(command.label, "")),
    command: preview(readString(command.command, "")),
    command_type: readString(command.command_type, "read"),
    requires_active_runtime: typeof command.requires_active_runtime === "boolean" ? command.requires_active_runtime : undefined,
    notes: typeof command.notes === "string" ? preview(redactText(command.notes)) : undefined,
  }))
}

function readWakeSchedulerAuditChain(value: unknown, commandName: string): WakeSchedulerAuditChainSummary {
  if (!isRecord(value) || typeof value.chain_id !== "string") throw new Error(`${commandName} returned invalid audit chain`)
  return {
    chain_id: redactText(value.chain_id),
    root_kind: readString(value.root_kind, "other"),
    root_id: readString(value.root_id, ""),
    entries: readWakeSchedulerAuditTimeline(value.entries, commandName, 20),
    related_ids: readRelatedIds(value.related_ids),
    gaps: Array.isArray(value.gaps) ? value.gaps.filter(isRecord).slice(0, 20).map((gap) => ({
      severity: readString(gap.severity, "warning"),
      message: preview(readString(gap.message, "")),
      related_ids: readRelatedIds(gap.related_ids),
    })) : [],
    recommended_commands: readWakeSchedulerAuditCommands(value.recommended_commands),
  }
}

function readWakeSchedulerAuditIncidents(value: unknown, commandName: string, limit: number): WakeSchedulerAuditIncidentSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.filter(isRecord).slice(0, limit).map((incident) => ({
    incident_id: readString(incident.incident_id, ""),
    severity: readString(incident.severity, "warning"),
    status: readString(incident.status, "open"),
    title: preview(readString(incident.title, "")),
    summary: preview(readString(incident.summary, "")),
    first_seen_at: typeof incident.first_seen_at === "string" ? redactText(incident.first_seen_at) : undefined,
    last_seen_at: typeof incident.last_seen_at === "string" ? redactText(incident.last_seen_at) : undefined,
    related_entries: readWakeSchedulerAuditTimeline(incident.related_entries, commandName, 10),
    recommended_commands: readWakeSchedulerAuditCommands(incident.recommended_commands),
  }))
}

function readWakeSchedulerNavigationBoard(value: unknown, commandName: string): WakeSchedulerNavigationBoardSummary {
  if (!isRecord(value) || typeof value.board_id !== "string" || !isRecord(value.source)) throw new Error(`${commandName} returned invalid navigation board`)
  return {
    board_id: redactText(value.board_id),
    source: {
      kind: readString(value.source.kind, "summary"),
      related_id: typeof value.source.related_id === "string" ? preview(redactText(value.source.related_id)) : undefined,
      incident_id: typeof value.source.incident_id === "string" ? preview(redactText(value.source.incident_id)) : undefined,
      audit_id: typeof value.source.audit_id === "string" ? preview(redactText(value.source.audit_id)) : undefined,
    },
    title: preview(readString(value.title, "")),
    summary: preview(readString(value.summary, "")),
    cards: readWakeSchedulerNavigationCards(value.cards, 20),
    related_ids: readRelatedIds(value.related_ids),
    warnings: readStringList(value.warnings, 20).map(preview),
    blockers: readStringList(value.blockers, 20).map(preview),
    generated_at: readString(value.generated_at, ""),
  }
}

function readWakeSchedulerNavigationCards(value: unknown, limit: number): WakeSchedulerNavigationCardSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, limit).map((card) => ({
    card_id: readString(card.card_id, ""),
    label: preview(readString(card.label, "")),
    command: preview(readString(card.command, "")),
    command_type: readString(card.command_type, "read"),
    risk: readString(card.risk, "unsupported"),
    target_kind: readString(card.target_kind, "unknown"),
    target_id: typeof card.target_id === "string" ? preview(redactText(card.target_id)) : undefined,
    supported: readBoolean(card.supported),
    blockers: readStringList(card.blockers, 10).map(preview),
    notes: readStringList(card.notes, 10).map(preview),
    recommended_order: readNumber(card.recommended_order, 0),
  }))
}

function readWakeSchedulerNavigationCommandPreview(value: unknown, commandName: string): WakeSchedulerNavigationCommandPreviewSummary {
  if (!isRecord(value) || typeof value.command !== "string") throw new Error(`${commandName} returned invalid navigation command preview`)
  return {
    command: preview(readString(value.command, "")),
    command_type: readString(value.command_type, "read"),
    risk: readString(value.risk, "unsupported"),
    target_kind: readString(value.target_kind, "unknown"),
    target_id: typeof value.target_id === "string" ? preview(redactText(value.target_id)) : undefined,
    supported: readBoolean(value.supported),
    blockers: readStringList(value.blockers, 10).map(preview),
    notes: readStringList(value.notes, 10).map(preview),
    equivalent_runtime_command: typeof value.equivalent_runtime_command === "string" ? preview(redactText(value.equivalent_runtime_command)) : undefined,
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readWakeSchedulerNavigationTarget(value: unknown, commandName: string): WakeSchedulerNavigationTargetSummary {
  if (!isRecord(value) || typeof value.target_id !== "string") throw new Error(`${commandName} returned invalid navigation target`)
  return {
    target_kind: readString(value.target_kind, "unknown"),
    target_id: preview(readString(value.target_id, "")),
    title: preview(readString(value.title, "")),
    related_commands: readWakeSchedulerNavigationCards(value.related_commands, 20),
    related_ids: readRelatedIds(value.related_ids),
    audit_entries: readWakeSchedulerAuditTimeline(value.audit_entries, commandName, 20),
    warnings: readStringList(value.warnings, 20).map(preview),
  }
}

function readWakeSchedulerNavigationStagePreview(value: unknown, commandName: string): WakeSchedulerNavigationStagePreviewSummary {
  if (!isRecord(value) || typeof value.command !== "string" || !isRecord(value.eligibility)) throw new Error(`${commandName} returned invalid navigation stage preview`)
  return {
    command: preview(readString(value.command, "")),
    source_card_id: typeof value.source_card_id === "string" ? preview(redactText(value.source_card_id)) : undefined,
    source_board_id: typeof value.source_board_id === "string" ? preview(redactText(value.source_board_id)) : undefined,
    eligibility: readWakeSchedulerNavigationStageEligibility(value.eligibility),
    existing_staged_id: typeof value.existing_staged_id === "string" ? preview(redactText(value.existing_staged_id)) : undefined,
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
  }
}

function readWakeSchedulerNavigationStageEligibility(value: Record<string, unknown>) {
  return {
    can_stage: readBoolean(value.can_stage),
    command: preview(readString(value.command, "")),
    command_type: readString(value.command_type, "read"),
    risk: readString(value.risk, "unsupported"),
    target_kind: readString(value.target_kind, "unknown"),
    target_id: typeof value.target_id === "string" ? preview(redactText(value.target_id)) : undefined,
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readWakeSchedulerNavigationStagedCommandRecords(value: unknown, commandName: string, limit: number): WakeSchedulerNavigationStagedCommandRecordSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readWakeSchedulerNavigationStagedCommandRecord).filter((record): record is WakeSchedulerNavigationStagedCommandRecordSummary => record !== null).slice(0, limit)
}

function readWakeSchedulerNavigationStagedCommandRecord(value: unknown): WakeSchedulerNavigationStagedCommandRecordSummary | null {
  if (!isRecord(value) || typeof value.staged_id !== "string" || typeof value.command !== "string") return null
  return {
    staged_id: redactText(value.staged_id),
    command: preview(readString(value.command, "")),
    risk: readString(value.risk, "unsupported"),
    target_kind: readString(value.target_kind, "unknown"),
    target_id: typeof value.target_id === "string" ? preview(redactText(value.target_id)) : undefined,
    staged_at: readString(value.staged_at, ""),
    staged_by: preview(readString(value.staged_by, "")),
    summary_preview: preview(readString(value.summary_preview, "")),
    stage_hash: redactText(readString(value.stage_hash, "")),
  }
}

function readWakeSchedulerNavigationStagedCommand(value: unknown, commandName: string): WakeSchedulerNavigationStagedCommandSummary | null {
  if (value === null) return null
  if (!isRecord(value) || typeof value.staged_id !== "string" || typeof value.command !== "string") throw new Error(`${commandName} returned invalid staged navigation command`)
  return {
    staged_id: redactText(value.staged_id),
    command: preview(readString(value.command, "")),
    command_type: readString(value.command_type, "read"),
    risk: readString(value.risk, "unsupported"),
    target_kind: readString(value.target_kind, "unknown"),
    target_id: typeof value.target_id === "string" ? preview(redactText(value.target_id)) : undefined,
    source_board_id: typeof value.source_board_id === "string" ? preview(redactText(value.source_board_id)) : undefined,
    source_card_id: typeof value.source_card_id === "string" ? preview(redactText(value.source_card_id)) : undefined,
    source_audit_id: typeof value.source_audit_id === "string" ? preview(redactText(value.source_audit_id)) : undefined,
    source_incident_id: typeof value.source_incident_id === "string" ? preview(redactText(value.source_incident_id)) : undefined,
    source_related_id: typeof value.source_related_id === "string" ? preview(redactText(value.source_related_id)) : undefined,
    label: preview(readString(value.label, "")),
    notes: readStringList(value.notes, 10).map(preview),
    staged_at: readString(value.staged_at, ""),
    staged_by: preview(readString(value.staged_by, "")),
    status: readString(value.status, "staged"),
    stage_hash: redactText(readString(value.stage_hash, "")),
  }
}

function readWakeSchedulerNavigationStagedRunPreview(value: unknown, commandName: string): WakeSchedulerNavigationStagedRunPreviewSummary {
  if (!isRecord(value) || typeof value.staged_id !== "string") throw new Error(`${commandName} returned invalid staged read preview`)
  return {
    staged_id: redactText(value.staged_id),
    command: preview(readString(value.command, "")),
    can_execute: readBoolean(value.can_execute),
    command_type: readString(value.command_type, "read"),
    risk: readString(value.risk, "unsupported"),
    target_kind: readString(value.target_kind, "unknown"),
    target_id: typeof value.target_id === "string" ? preview(redactText(value.target_id)) : undefined,
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readWakeSchedulerNavigationStagedRunRecords(value: unknown, commandName: string, limit: number): WakeSchedulerNavigationStagedRunRecordSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readWakeSchedulerNavigationStagedRunRecord).filter((record): record is WakeSchedulerNavigationStagedRunRecordSummary => record !== null).slice(0, limit)
}

function readWakeSchedulerNavigationStagedRunRecord(value: unknown): WakeSchedulerNavigationStagedRunRecordSummary | null {
  if (!isRecord(value) || typeof value.run_id !== "string" || typeof value.staged_id !== "string" || typeof value.command !== "string") return null
  return {
    run_id: redactText(value.run_id),
    staged_id: redactText(value.staged_id),
    command: preview(readString(value.command, "")),
    target_kind: readString(value.target_kind, "unknown"),
    status: readString(value.status, "failed"),
    completed_at: readString(value.completed_at, ""),
    summary_preview: preview(readString(value.summary_preview, "")),
  }
}

function readWakeSchedulerNavigationStagedRunResult(value: unknown, commandName: string): WakeSchedulerNavigationStagedRunResultSummary | null {
  if (value === null) return null
  if (!isRecord(value) || typeof value.run_id !== "string" || typeof value.staged_id !== "string" || typeof value.command !== "string") throw new Error(`${commandName} returned invalid staged read result`)
  return {
    run_id: redactText(value.run_id),
    staged_id: redactText(value.staged_id),
    command: preview(readString(value.command, "")),
    target_kind: readString(value.target_kind, "unknown"),
    target_id: typeof value.target_id === "string" ? preview(redactText(value.target_id)) : undefined,
    status: readString(value.status, "failed"),
    result_summary: typeof value.result_summary === "string" ? preview(readString(value.result_summary, "")) : undefined,
    result_kind: typeof value.result_kind === "string" ? preview(readString(value.result_kind, "")) : undefined,
    error: typeof value.error === "string" ? preview(readString(value.error, "")) : undefined,
    started_at: readString(value.started_at, ""),
    completed_at: readString(value.completed_at, ""),
    requested_by: preview(readString(value.requested_by, "")),
    result_hash: typeof value.result_hash === "string" ? preview(redactText(value.result_hash)) : undefined,
  }
}

function readWakeSchedulerNavigationStagedReadHistory(value: unknown, commandName: string): WakeSchedulerNavigationStagedReadHistorySummary {
  if (!isRecord(value) || !Array.isArray(value.groups)) throw new Error(`${commandName} returned invalid staged read history`)
  return {
    staged_id: typeof value.staged_id === "string" ? redactText(value.staged_id) : undefined,
    command: typeof value.command === "string" ? preview(readString(value.command, "")) : undefined,
    groups: value.groups.map(readWakeSchedulerNavigationStagedReadGroupRecord).filter((group): group is WakeSchedulerNavigationStagedReadGroupSummary => group !== null).slice(0, CHECKPOINT_LIMIT),
    total_runs: readNumber(value.total_runs, 0),
    total_groups: readNumber(value.total_groups, 0),
    changed_groups: readNumber(value.changed_groups, 0),
    failed_groups: readNumber(value.failed_groups, 0),
    stale_groups: readNumber(value.stale_groups, 0),
    generated_at: readString(value.generated_at, ""),
  }
}

function readWakeSchedulerNavigationStagedReadGroup(value: unknown, commandName: string): WakeSchedulerNavigationStagedReadGroupSummary | null {
  if (value === null) return null
  const group = readWakeSchedulerNavigationStagedReadGroupRecord(value)
  if (!group) throw new Error(`${commandName} returned invalid staged read group`)
  return group
}

function readWakeSchedulerNavigationStagedReadGroupRecord(value: unknown): WakeSchedulerNavigationStagedReadGroupSummary | null {
  if (!isRecord(value) || typeof value.group_id !== "string" || typeof value.staged_id !== "string" || typeof value.command !== "string") return null
  return {
    group_id: redactText(value.group_id),
    staged_id: redactText(value.staged_id),
    command: preview(readString(value.command, "")),
    target_kind: readString(value.target_kind, "unknown"),
    target_id: typeof value.target_id === "string" ? preview(redactText(value.target_id)) : undefined,
    run_count: readNumber(value.run_count, 0),
    succeeded_count: readNumber(value.succeeded_count, 0),
    failed_count: readNumber(value.failed_count, 0),
    blocked_count: readNumber(value.blocked_count, 0),
    latest_run_id: typeof value.latest_run_id === "string" ? redactText(value.latest_run_id) : undefined,
    latest_completed_at: readString(value.latest_completed_at, ""),
    latest_status: readString(value.latest_status, "unknown"),
    latest_comparison_hash: typeof value.latest_comparison_hash === "string" ? preview(redactText(value.latest_comparison_hash)) : undefined,
    previous_run_id: typeof value.previous_run_id === "string" ? redactText(value.previous_run_id) : undefined,
    previous_comparison_hash: typeof value.previous_comparison_hash === "string" ? preview(redactText(value.previous_comparison_hash)) : undefined,
    comparison_status: readString(value.comparison_status, "unknown"),
    summary_preview: preview(readString(value.summary_preview, "")),
    recommended_commands: readWakeSchedulerNavigationStagedReadCompareCommands(value.recommended_commands),
  }
}

function readWakeSchedulerNavigationStagedReadComparison(value: unknown, commandName: string): WakeSchedulerNavigationStagedReadPairComparisonSummary {
  if (!isRecord(value) || typeof value.comparison_id !== "string" || typeof value.left_run_id !== "string" || typeof value.right_run_id !== "string") throw new Error(`${commandName} returned invalid staged read comparison`)
  return {
    comparison_id: redactText(value.comparison_id),
    staged_id: readString(value.staged_id, ""),
    command: preview(readString(value.command, "")),
    left_run_id: redactText(value.left_run_id),
    right_run_id: redactText(value.right_run_id),
    left_completed_at: readString(value.left_completed_at, ""),
    right_completed_at: readString(value.right_completed_at, ""),
    left_status: readString(value.left_status, "unknown"),
    right_status: readString(value.right_status, "unknown"),
    left_comparison_hash: preview(redactText(readString(value.left_comparison_hash, ""))),
    right_comparison_hash: preview(redactText(readString(value.right_comparison_hash, ""))),
    comparison_status: readString(value.comparison_status, "unknown"),
    summary_delta: preview(readString(value.summary_delta, "")),
    warnings: readStringList(value.warnings, 10).map(preview),
    recommended_commands: readWakeSchedulerNavigationStagedReadCompareCommands(value.recommended_commands),
  }
}

function readWakeSchedulerNavigationStagedReadStaleItems(value: unknown, commandName: string, limit: number): WakeSchedulerNavigationStagedReadStaleItemSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readWakeSchedulerNavigationStagedReadStaleItem).filter((item): item is WakeSchedulerNavigationStagedReadStaleItemSummary => item !== null).slice(0, limit)
}

function readWakeSchedulerNavigationStagedReadStaleItem(value: unknown): WakeSchedulerNavigationStagedReadStaleItemSummary | null {
  if (!isRecord(value) || typeof value.staged_id !== "string" || typeof value.command !== "string") return null
  return {
    staged_id: redactText(value.staged_id),
    command: preview(readString(value.command, "")),
    target_kind: readString(value.target_kind, "unknown"),
    target_id: typeof value.target_id === "string" ? preview(redactText(value.target_id)) : undefined,
    latest_run_id: typeof value.latest_run_id === "string" ? redactText(value.latest_run_id) : undefined,
    latest_completed_at: readString(value.latest_completed_at, ""),
    age_ms: typeof value.age_ms === "number" ? value.age_ms : undefined,
    stale_after_ms: readNumber(value.stale_after_ms, 0),
    stale: readBoolean(value.stale),
    recommended_commands: readWakeSchedulerNavigationStagedReadCompareCommands(value.recommended_commands),
  }
}

function readWakeSchedulerNavigationStagedReadCompareCommands(value: unknown): WakeSchedulerNavigationStagedReadCompareCommandSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 10).map((command) => ({
    label: preview(readString(command.label, "")),
    command: preview(readString(command.command, "")),
    command_type: readString(command.command_type, "read"),
    requires_active_runtime: typeof command.requires_active_runtime === "boolean" ? command.requires_active_runtime : undefined,
    notes: typeof command.notes === "string" ? preview(readString(command.notes, "")) : undefined,
  }))
}

function readWakeSchedulerNavigationWritePreview(value: unknown, commandName: string): WakeSchedulerNavigationWritePreviewSummary {
  if (!isRecord(value) || typeof value.command !== "string" || typeof value.command_name !== "string") throw new Error(`${commandName} returned invalid write preview`)
  return {
    command: preview(readString(value.command, "")),
    command_name: preview(readString(value.command_name, "")),
    command_type: readString(value.command_type, "write"),
    risk: readString(value.risk, "unsupported"),
    authority_gate: readString(value.authority_gate, "unknown"),
    equivalent_runtime_command: typeof value.equivalent_runtime_command === "string" ? preview(redactText(value.equivalent_runtime_command)) : undefined,
    status: readString(value.status, "unsupported"),
    can_stage_now: false,
    can_execute_now: false,
    target_kind: readString(value.target_kind, "unknown"),
    target_id: typeof value.target_id === "string" ? preview(redactText(value.target_id)) : undefined,
    parsed_args: readParsedArgs(value.parsed_args),
    prerequisites: readWakeSchedulerNavigationWritePrerequisites(value.prerequisites),
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    safer_read_commands: readWakeSchedulerNavigationWriteCommands(value.safer_read_commands),
    future_stage_policy: readWakeSchedulerNavigationFutureStagePolicy(value.future_stage_policy),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readWakeSchedulerNavigationWriteBoard(value: unknown, commandName: string): WakeSchedulerNavigationWriteBoardSummary {
  if (!isRecord(value) || typeof value.board_id !== "string" || !isRecord(value.source) || !Array.isArray(value.previews)) throw new Error(`${commandName} returned invalid write board`)
  return {
    board_id: redactText(value.board_id),
    source: {
      kind: readString(value.source.kind, "navigation_board"),
      related_id: typeof value.source.related_id === "string" ? preview(redactText(value.source.related_id)) : undefined,
      incident_id: typeof value.source.incident_id === "string" ? preview(redactText(value.source.incident_id)) : undefined,
      staged_id: typeof value.source.staged_id === "string" ? preview(redactText(value.source.staged_id)) : undefined,
    },
    previews: value.previews.map((item) => readWakeSchedulerNavigationWritePreview(item, commandName)).slice(0, 20),
    omitted_read_count: readNumber(value.omitted_read_count, 0),
    unsupported_count: readNumber(value.unsupported_count, 0),
    high_impact_count: readNumber(value.high_impact_count, 0),
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    generated_at: readString(value.generated_at, ""),
  }
}

function readWakeSchedulerNavigationWriteStagePreview(value: unknown, commandName: string): WakeSchedulerNavigationWriteStagePreviewSummary {
  if (!isRecord(value) || typeof value.command !== "string" || !isRecord(value.eligibility)) throw new Error(`${commandName} returned invalid write stage preview`)
  return {
    command: preview(readString(value.command, "")),
    eligibility: readWakeSchedulerNavigationWriteStageEligibility(value.eligibility),
    existing_staged_id: typeof value.existing_staged_id === "string" ? redactText(value.existing_staged_id) : undefined,
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
  }
}

function readWakeSchedulerNavigationWriteStageEligibility(value: Record<string, unknown>): WakeSchedulerNavigationWriteStageEligibilitySummary {
  return {
    can_stage: readBoolean(value.can_stage),
    command: preview(readString(value.command, "")),
    command_name: preview(readString(value.command_name, "")),
    risk: readString(value.risk, "unsupported"),
    authority_gate: readString(value.authority_gate, "unknown"),
    status: readString(value.status, "unsupported"),
    target_kind: readString(value.target_kind, "unknown"),
    target_id: typeof value.target_id === "string" ? preview(redactText(value.target_id)) : undefined,
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    prerequisites: readWakeSchedulerNavigationWritePrerequisites(value.prerequisites),
    safer_read_commands: readWakeSchedulerNavigationWriteCommands(value.safer_read_commands),
    future_stage_policy: readWakeSchedulerNavigationFutureStagePolicy(value.future_stage_policy),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readWakeSchedulerNavigationStagedWriteCommandRecords(value: unknown, commandName: string, limit: number): WakeSchedulerNavigationStagedWriteCommandRecordSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readWakeSchedulerNavigationStagedWriteCommandRecord).filter((record): record is WakeSchedulerNavigationStagedWriteCommandRecordSummary => record !== null).slice(0, limit)
}

function readWakeSchedulerNavigationStagedWriteCommandRecord(value: unknown): WakeSchedulerNavigationStagedWriteCommandRecordSummary | null {
  if (!isRecord(value) || typeof value.staged_write_id !== "string" || typeof value.command !== "string") return null
  return {
    staged_write_id: redactText(value.staged_write_id),
    command: preview(readString(value.command, "")),
    risk: readString(value.risk, "unsupported"),
    authority_gate: readString(value.authority_gate, "unknown"),
    target_kind: readString(value.target_kind, "unknown"),
    target_id: typeof value.target_id === "string" ? preview(redactText(value.target_id)) : undefined,
    staged_at: readString(value.staged_at, ""),
    staged_by: preview(readString(value.staged_by, "")),
    summary_preview: preview(readString(value.summary_preview, "")),
    stage_hash: redactText(readString(value.stage_hash, "")),
  }
}

function readWakeSchedulerNavigationStagedWriteCommand(value: unknown, commandName: string): WakeSchedulerNavigationStagedWriteCommandSummary | null {
  if (value === null) return null
  if (!isRecord(value) || typeof value.staged_write_id !== "string" || typeof value.command !== "string") throw new Error(`${commandName} returned invalid staged write command`)
  return {
    staged_write_id: redactText(value.staged_write_id),
    command: preview(readString(value.command, "")),
    command_name: preview(readString(value.command_name, "")),
    risk: readString(value.risk, "unsupported"),
    authority_gate: readString(value.authority_gate, "unknown"),
    target_kind: readString(value.target_kind, "unknown"),
    target_id: typeof value.target_id === "string" ? preview(redactText(value.target_id)) : undefined,
    equivalent_runtime_command: typeof value.equivalent_runtime_command === "string" ? preview(redactText(value.equivalent_runtime_command)) : undefined,
    prerequisites: readWakeSchedulerNavigationWritePrerequisites(value.prerequisites),
    safer_read_commands: readWakeSchedulerNavigationWriteCommands(value.safer_read_commands),
    future_stage_policy: readWakeSchedulerNavigationFutureStagePolicy(value.future_stage_policy),
    source_preview_hash: preview(redactText(readString(value.source_preview_hash, ""))),
    source_related_id: typeof value.source_related_id === "string" ? preview(redactText(value.source_related_id)) : undefined,
    source_incident_id: typeof value.source_incident_id === "string" ? preview(redactText(value.source_incident_id)) : undefined,
    source_staged_id: typeof value.source_staged_id === "string" ? preview(redactText(value.source_staged_id)) : undefined,
    source_board_id: typeof value.source_board_id === "string" ? preview(redactText(value.source_board_id)) : undefined,
    staged_at: readString(value.staged_at, ""),
    staged_by: preview(readString(value.staged_by, "")),
    status: readString(value.status, "staged"),
    stage_hash: preview(redactText(readString(value.stage_hash, ""))),
    summary_preview: preview(readString(value.summary_preview, "")),
  }
}

function readWakeSchedulerNavigationWriteRunPreview(value: unknown, commandName: string): WakeSchedulerNavigationWriteRunPreviewSummary {
  if (!isRecord(value) || typeof value.staged_write_id !== "string" || typeof value.command !== "string") throw new Error(`${commandName} returned invalid write run preview`)
  return {
    staged_write_id: redactText(value.staged_write_id),
    command: preview(readString(value.command, "")),
    command_name: preview(readString(value.command_name, "")),
    can_execute: readBoolean(value.can_execute),
    risk: readString(value.risk, "unsupported"),
    authority_gate: readString(value.authority_gate, "unknown"),
    target_kind: readString(value.target_kind, "unknown"),
    target_id: typeof value.target_id === "string" ? preview(redactText(value.target_id)) : undefined,
    execution_kind: readString(value.execution_kind, "blocked"),
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readWakeSchedulerNavigationWriteRunRecords(value: unknown, commandName: string, limit: number): WakeSchedulerNavigationWriteRunRecordSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readWakeSchedulerNavigationWriteRunRecord).filter((record): record is WakeSchedulerNavigationWriteRunRecordSummary => record !== null).slice(0, limit)
}

function readWakeSchedulerNavigationWriteRunRecord(value: unknown): WakeSchedulerNavigationWriteRunRecordSummary | null {
  if (!isRecord(value) || typeof value.run_id !== "string" || typeof value.staged_write_id !== "string" || typeof value.command !== "string") return null
  return {
    run_id: redactText(value.run_id),
    staged_write_id: redactText(value.staged_write_id),
    command: preview(readString(value.command, "")),
    execution_kind: readString(value.execution_kind, "blocked"),
    status: readString(value.status, "blocked"),
    completed_at: readString(value.completed_at, ""),
    summary_preview: preview(readString(value.summary_preview, "")),
  }
}

function readWakeSchedulerNavigationWriteRunResult(value: unknown, commandName: string): WakeSchedulerNavigationWriteRunResultSummary | null {
  if (value === null) return null
  if (!isRecord(value) || typeof value.run_id !== "string" || typeof value.staged_write_id !== "string" || typeof value.command !== "string") throw new Error(`${commandName} returned invalid write run result`)
  return {
    run_id: redactText(value.run_id),
    staged_write_id: redactText(value.staged_write_id),
    command: preview(readString(value.command, "")),
    command_name: preview(readString(value.command_name, "")),
    execution_kind: readString(value.execution_kind, "blocked"),
    risk: readString(value.risk, "unsupported"),
    authority_gate: readString(value.authority_gate, "unknown"),
    target_kind: readString(value.target_kind, "unknown"),
    target_id: typeof value.target_id === "string" ? preview(redactText(value.target_id)) : undefined,
    status: readString(value.status, "blocked"),
    result_kind: typeof value.result_kind === "string" ? preview(redactText(value.result_kind)) : undefined,
    result_summary: typeof value.result_summary === "string" ? preview(readString(value.result_summary, "")) : undefined,
    downstream_run_id: typeof value.downstream_run_id === "string" ? redactText(value.downstream_run_id) : undefined,
    error: typeof value.error === "string" ? preview(readString(value.error, "")) : undefined,
    started_at: readString(value.started_at, ""),
    completed_at: readString(value.completed_at, ""),
    requested_by: preview(readString(value.requested_by, "")),
    result_hash: preview(redactText(readString(value.result_hash, ""))),
  }
}

function readWakeSchedulerNavigationWriteRunHistory(value: unknown, commandName: string): WakeSchedulerNavigationWriteRunHistorySummary {
  if (!isRecord(value) || !Array.isArray(value.groups)) throw new Error(`${commandName} returned invalid write-run history`)
  return {
    staged_write_id: typeof value.staged_write_id === "string" ? redactText(value.staged_write_id) : undefined,
    command: typeof value.command === "string" ? preview(readString(value.command, "")) : undefined,
    groups: value.groups.map(readWakeSchedulerNavigationWriteRunGroupRecord).filter((group): group is WakeSchedulerNavigationWriteRunGroupSummary => group !== null).slice(0, CHECKPOINT_LIMIT),
    total_runs: readNumber(value.total_runs, 0),
    total_groups: readNumber(value.total_groups, 0),
    changed_groups: readNumber(value.changed_groups, 0),
    failed_groups: readNumber(value.failed_groups, 0),
    stale_groups: readNumber(value.stale_groups, 0),
    generated_at: readString(value.generated_at, ""),
  }
}

function readWakeSchedulerNavigationWriteRunGroup(value: unknown, commandName: string): WakeSchedulerNavigationWriteRunGroupSummary | null {
  if (value === null) return null
  const group = readWakeSchedulerNavigationWriteRunGroupRecord(value)
  if (!group) throw new Error(`${commandName} returned invalid write-run group`)
  return group
}

function readWakeSchedulerNavigationWriteRunGroupRecord(value: unknown): WakeSchedulerNavigationWriteRunGroupSummary | null {
  if (!isRecord(value) || typeof value.group_id !== "string" || typeof value.staged_write_id !== "string" || typeof value.command !== "string") return null
  return {
    group_id: redactText(value.group_id),
    staged_write_id: redactText(value.staged_write_id),
    command: preview(readString(value.command, "")),
    command_name: preview(readString(value.command_name, "")),
    execution_kind: readString(value.execution_kind, "blocked"),
    risk: readString(value.risk, "unsupported"),
    authority_gate: readString(value.authority_gate, "unknown"),
    target_kind: readString(value.target_kind, "unknown"),
    target_id: typeof value.target_id === "string" ? preview(redactText(value.target_id)) : undefined,
    run_count: readNumber(value.run_count, 0),
    succeeded_count: readNumber(value.succeeded_count, 0),
    failed_count: readNumber(value.failed_count, 0),
    blocked_count: readNumber(value.blocked_count, 0),
    latest_run_id: typeof value.latest_run_id === "string" ? redactText(value.latest_run_id) : undefined,
    latest_completed_at: readString(value.latest_completed_at, ""),
    latest_status: readString(value.latest_status, "unknown"),
    latest_outcome_hash: typeof value.latest_outcome_hash === "string" ? preview(redactText(value.latest_outcome_hash)) : undefined,
    previous_run_id: typeof value.previous_run_id === "string" ? redactText(value.previous_run_id) : undefined,
    previous_outcome_hash: typeof value.previous_outcome_hash === "string" ? preview(redactText(value.previous_outcome_hash)) : undefined,
    downstream_run_ids: readStringList(value.downstream_run_ids, 10).map((id) => preview(redactText(id))),
    comparison_status: readString(value.comparison_status, "unknown"),
    summary_preview: preview(readString(value.summary_preview, "")),
    recommended_commands: readWakeSchedulerNavigationWriteRunCompareCommands(value.recommended_commands),
  }
}

function readWakeSchedulerNavigationWriteRunComparison(value: unknown, commandName: string): WakeSchedulerNavigationWriteRunPairComparisonSummary {
  if (!isRecord(value) || typeof value.comparison_id !== "string" || typeof value.left_run_id !== "string" || typeof value.right_run_id !== "string") throw new Error(`${commandName} returned invalid write-run comparison`)
  return {
    comparison_id: redactText(value.comparison_id),
    staged_write_id: readString(value.staged_write_id, ""),
    command: preview(readString(value.command, "")),
    left_run_id: redactText(value.left_run_id),
    right_run_id: redactText(value.right_run_id),
    left_completed_at: readString(value.left_completed_at, ""),
    right_completed_at: readString(value.right_completed_at, ""),
    left_status: readString(value.left_status, "unknown"),
    right_status: readString(value.right_status, "unknown"),
    left_outcome_hash: preview(redactText(readString(value.left_outcome_hash, ""))),
    right_outcome_hash: preview(redactText(readString(value.right_outcome_hash, ""))),
    comparison_status: readString(value.comparison_status, "unknown"),
    summary_delta: preview(readString(value.summary_delta, "")),
    downstream_delta: typeof value.downstream_delta === "string" ? preview(readString(value.downstream_delta, "")) : undefined,
    warnings: readStringList(value.warnings, 10).map(preview),
    recommended_commands: readWakeSchedulerNavigationWriteRunCompareCommands(value.recommended_commands),
  }
}

function readWakeSchedulerNavigationWriteRunStaleItems(value: unknown, commandName: string, limit: number): WakeSchedulerNavigationWriteRunStaleItemSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readWakeSchedulerNavigationWriteRunStaleItem).filter((item): item is WakeSchedulerNavigationWriteRunStaleItemSummary => item !== null).slice(0, limit)
}

function readWakeSchedulerNavigationWriteRunStaleItem(value: unknown): WakeSchedulerNavigationWriteRunStaleItemSummary | null {
  if (!isRecord(value) || typeof value.staged_write_id !== "string" || typeof value.command !== "string") return null
  return {
    staged_write_id: redactText(value.staged_write_id),
    command: preview(readString(value.command, "")),
    command_name: preview(readString(value.command_name, "")),
    risk: readString(value.risk, "unsupported"),
    authority_gate: readString(value.authority_gate, "unknown"),
    target_kind: readString(value.target_kind, "unknown"),
    target_id: typeof value.target_id === "string" ? preview(redactText(value.target_id)) : undefined,
    latest_run_id: typeof value.latest_run_id === "string" ? redactText(value.latest_run_id) : undefined,
    latest_completed_at: readString(value.latest_completed_at, ""),
    age_ms: typeof value.age_ms === "number" ? value.age_ms : undefined,
    stale_after_ms: readNumber(value.stale_after_ms, 0),
    stale: readBoolean(value.stale),
    recommended_commands: readWakeSchedulerNavigationWriteRunCompareCommands(value.recommended_commands),
  }
}

function readWakeSchedulerNavigationWriteRunCompareCommands(value: unknown): WakeSchedulerNavigationWriteRunCompareCommandSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 10).map((command) => ({
    label: preview(readString(command.label, "")),
    command: preview(readString(command.command, "")),
    command_type: readString(command.command_type, "read"),
    requires_active_runtime: typeof command.requires_active_runtime === "boolean" ? command.requires_active_runtime : undefined,
    notes: typeof command.notes === "string" ? preview(readString(command.notes, "")) : undefined,
  }))
}

function readWakeSchedulerNavigationWriteReadinessPreview(value: unknown, commandName: string): WakeSchedulerNavigationWriteReadinessPreviewSummary {
  if (!isRecord(value) || typeof value.staged_write_id !== "string" || typeof value.command !== "string") throw new Error(`${commandName} returned invalid write readiness preview`)
  return {
    staged_write_id: redactText(value.staged_write_id),
    command: preview(readString(value.command, "")),
    command_name: preview(readString(value.command_name, "")),
    risk: readString(value.risk, "unsupported"),
    authority_gate: readString(value.authority_gate, "unknown"),
    target_kind: readString(value.target_kind, "unknown"),
    target_id: typeof value.target_id === "string" ? preview(redactText(value.target_id)) : undefined,
    readiness_status: readString(value.readiness_status, "blocked"),
    can_approve: readBoolean(value.can_approve),
    can_execute_now: false,
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    required_evidence: readWakeSchedulerNavigationWriteEvidenceList(value.required_evidence),
    optional_evidence: readWakeSchedulerNavigationWriteEvidenceList(value.optional_evidence),
    existing_approval: isRecord(value.existing_approval) ? readWakeSchedulerNavigationWriteApprovalRecord(value.existing_approval) ?? undefined : undefined,
    recommended_commands: readWakeSchedulerNavigationWriteCommands(value.recommended_commands),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readWakeSchedulerNavigationWriteApprovalRecords(value: unknown, commandName: string, limit: number): WakeSchedulerNavigationWriteApprovalRecordSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readWakeSchedulerNavigationWriteApprovalRecord).filter((record): record is WakeSchedulerNavigationWriteApprovalRecordSummary => record !== null).slice(0, limit)
}

function readWakeSchedulerNavigationWriteApprovalRecord(value: unknown): WakeSchedulerNavigationWriteApprovalRecordSummary | null {
  if (!isRecord(value) || typeof value.approval_id !== "string" || typeof value.staged_write_id !== "string" || typeof value.command !== "string") return null
  return {
    approval_id: redactText(value.approval_id),
    staged_write_id: redactText(value.staged_write_id),
    command: preview(readString(value.command, "")),
    risk: readString(value.risk, "unsupported"),
    authority_gate: readString(value.authority_gate, "unknown"),
    status: readString(value.status, "pending"),
    updated_at: readString(value.updated_at, ""),
    summary_preview: preview(readString(value.summary_preview, "")),
    approval_hash: preview(redactText(readString(value.approval_hash, ""))),
  }
}

function readWakeSchedulerNavigationWriteApproval(value: unknown, commandName: string): WakeSchedulerNavigationWriteApprovalSummary | null {
  if (value === null) return null
  if (!isRecord(value) || typeof value.approval_id !== "string" || typeof value.staged_write_id !== "string" || typeof value.command !== "string") throw new Error(`${commandName} returned invalid write approval`)
  return {
    approval_id: redactText(value.approval_id),
    staged_write_id: redactText(value.staged_write_id),
    command: preview(readString(value.command, "")),
    command_name: preview(readString(value.command_name, "")),
    risk: readString(value.risk, "unsupported"),
    authority_gate: readString(value.authority_gate, "unknown"),
    target_kind: readString(value.target_kind, "unknown"),
    target_id: typeof value.target_id === "string" ? preview(redactText(value.target_id)) : undefined,
    status: readString(value.status, "pending"),
    approved_at: typeof value.approved_at === "string" ? readString(value.approved_at, "") : undefined,
    rejected_at: typeof value.rejected_at === "string" ? readString(value.rejected_at, "") : undefined,
    revoked_at: typeof value.revoked_at === "string" ? readString(value.revoked_at, "") : undefined,
    updated_at: readString(value.updated_at, ""),
    requested_by: preview(readString(value.requested_by, "")),
    reason: typeof value.reason === "string" ? preview(readString(value.reason, "")) : undefined,
    evidence: readWakeSchedulerNavigationWriteEvidenceList(value.evidence),
    approval_hash: preview(redactText(readString(value.approval_hash, ""))),
    expires_at: typeof value.expires_at === "string" ? readString(value.expires_at, "") : undefined,
    summary_preview: preview(readString(value.summary_preview, "")),
  }
}

function readWakeSchedulerNavigationCheckpointWriteRunPreview(value: unknown, commandName: string): WakeSchedulerNavigationCheckpointWriteRunPreviewSummary {
  if (!isRecord(value) || typeof value.staged_write_id !== "string" || typeof value.command !== "string") throw new Error(`${commandName} returned invalid checkpoint write run preview`)
  return {
    staged_write_id: redactText(value.staged_write_id),
    approval_id: typeof value.approval_id === "string" ? redactText(value.approval_id) : undefined,
    command: preview(readString(value.command, "")),
    command_name: preview(readString(value.command_name, "")),
    can_execute: readBoolean(value.can_execute),
    risk: readString(value.risk, "unsupported"),
    authority_gate: readString(value.authority_gate, "unknown"),
    target_kind: readString(value.target_kind, "unknown"),
    target_id: typeof value.target_id === "string" ? preview(redactText(value.target_id)) : undefined,
    execution_kind: readString(value.execution_kind, "blocked"),
    checkpoint_scope: typeof value.checkpoint_scope === "string" ? preview(redactText(value.checkpoint_scope)) : undefined,
    checkpoint_reason_preview: typeof value.checkpoint_reason_preview === "string" ? preview(readString(value.checkpoint_reason_preview, "")) : undefined,
    blockers: readStringList(value.blockers, 10).map(preview),
    warnings: readStringList(value.warnings, 10).map(preview),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
  }
}

function readWakeSchedulerNavigationCheckpointWriteRunRecords(value: unknown, commandName: string, limit: number): WakeSchedulerNavigationCheckpointWriteRunRecordSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readWakeSchedulerNavigationCheckpointWriteRunRecord).filter((record): record is WakeSchedulerNavigationCheckpointWriteRunRecordSummary => record !== null).slice(0, limit)
}

function readWakeSchedulerNavigationCheckpointWriteRunRecord(value: unknown): WakeSchedulerNavigationCheckpointWriteRunRecordSummary | null {
  if (!isRecord(value) || typeof value.run_id !== "string" || typeof value.staged_write_id !== "string" || typeof value.command !== "string") return null
  return {
    run_id: redactText(value.run_id),
    staged_write_id: redactText(value.staged_write_id),
    approval_id: typeof value.approval_id === "string" ? redactText(value.approval_id) : undefined,
    command: preview(readString(value.command, "")),
    status: readString(value.status, "blocked"),
    checkpoint_id: typeof value.checkpoint_id === "string" ? redactText(value.checkpoint_id) : undefined,
    completed_at: readString(value.completed_at, ""),
    summary_preview: preview(readString(value.summary_preview, "")),
  }
}

function readWakeSchedulerNavigationCheckpointWriteRunResult(value: unknown, commandName: string): WakeSchedulerNavigationCheckpointWriteRunResultSummary | null {
  if (value === null) return null
  if (!isRecord(value) || typeof value.run_id !== "string" || typeof value.staged_write_id !== "string" || typeof value.command !== "string") throw new Error(`${commandName} returned invalid checkpoint write run result`)
  return {
    run_id: redactText(value.run_id),
    staged_write_id: redactText(value.staged_write_id),
    approval_id: typeof value.approval_id === "string" ? redactText(value.approval_id) : undefined,
    command: preview(readString(value.command, "")),
    command_name: preview(readString(value.command_name, "")),
    execution_kind: readString(value.execution_kind, "blocked"),
    risk: readString(value.risk, "unsupported"),
    authority_gate: readString(value.authority_gate, "unknown"),
    status: readString(value.status, "blocked"),
    checkpoint_id: typeof value.checkpoint_id === "string" ? redactText(value.checkpoint_id) : undefined,
    checkpoint_hash: typeof value.checkpoint_hash === "string" ? preview(redactText(value.checkpoint_hash)) : undefined,
    event_count: typeof value.event_count === "number" ? value.event_count : undefined,
    result_kind: typeof value.result_kind === "string" ? preview(redactText(value.result_kind)) : undefined,
    result_summary: typeof value.result_summary === "string" ? preview(readString(value.result_summary, "")) : undefined,
    error: typeof value.error === "string" ? preview(readString(value.error, "")) : undefined,
    started_at: readString(value.started_at, ""),
    completed_at: readString(value.completed_at, ""),
    requested_by: preview(readString(value.requested_by, "")),
    result_hash: preview(redactText(readString(value.result_hash, ""))),
  }
}

function readWakeSchedulerNavigationCheckpointWriteHistory(value: unknown, commandName: string): WakeSchedulerNavigationCheckpointWriteHistorySummary {
  if (!isRecord(value) || !Array.isArray(value.groups)) throw new Error(`${commandName} returned invalid checkpoint write history`)
  return {
    staged_write_id: typeof value.staged_write_id === "string" ? redactText(value.staged_write_id) : undefined,
    approval_id: typeof value.approval_id === "string" ? redactText(value.approval_id) : undefined,
    command: typeof value.command === "string" ? preview(readString(value.command, "")) : undefined,
    groups: value.groups.map(readWakeSchedulerNavigationCheckpointWriteGroupRecord).filter((group): group is WakeSchedulerNavigationCheckpointWriteGroupSummary => group !== null).slice(0, CHECKPOINT_LIMIT),
    total_runs: readNumber(value.total_runs, 0),
    total_groups: readNumber(value.total_groups, 0),
    changed_groups: readNumber(value.changed_groups, 0),
    failed_groups: readNumber(value.failed_groups, 0),
    artifact_changed_groups: readNumber(value.artifact_changed_groups, 0),
    unused_approval_count: readNumber(value.unused_approval_count, 0),
    stale_approval_count: readNumber(value.stale_approval_count, 0),
    generated_at: readString(value.generated_at, ""),
  }
}

function readWakeSchedulerNavigationCheckpointWriteGroup(value: unknown, commandName: string): WakeSchedulerNavigationCheckpointWriteGroupSummary | null {
  if (value === null) return null
  const group = readWakeSchedulerNavigationCheckpointWriteGroupRecord(value)
  if (!group) throw new Error(`${commandName} returned invalid checkpoint write group`)
  return group
}

function readWakeSchedulerNavigationCheckpointWriteGroupRecord(value: unknown): WakeSchedulerNavigationCheckpointWriteGroupSummary | null {
  if (!isRecord(value) || typeof value.group_id !== "string" || typeof value.staged_write_id !== "string" || typeof value.command !== "string") return null
  return {
    group_id: redactText(value.group_id),
    staged_write_id: redactText(value.staged_write_id),
    command: preview(readString(value.command, "")),
    command_name: preview(readString(value.command_name, "")),
    approval_ids: readStringList(value.approval_ids, 10).map((id) => redactText(id)),
    run_count: readNumber(value.run_count, 0),
    succeeded_count: readNumber(value.succeeded_count, 0),
    failed_count: readNumber(value.failed_count, 0),
    blocked_count: readNumber(value.blocked_count, 0),
    latest_run_id: typeof value.latest_run_id === "string" ? redactText(value.latest_run_id) : undefined,
    latest_approval_id: typeof value.latest_approval_id === "string" ? redactText(value.latest_approval_id) : undefined,
    latest_checkpoint_id: typeof value.latest_checkpoint_id === "string" ? redactText(value.latest_checkpoint_id) : undefined,
    latest_checkpoint_hash: typeof value.latest_checkpoint_hash === "string" ? preview(redactText(value.latest_checkpoint_hash)) : undefined,
    latest_event_count: typeof value.latest_event_count === "number" ? value.latest_event_count : undefined,
    latest_completed_at: readString(value.latest_completed_at, ""),
    latest_status: readString(value.latest_status, "unknown"),
    latest_outcome_hash: typeof value.latest_outcome_hash === "string" ? preview(redactText(value.latest_outcome_hash)) : undefined,
    previous_run_id: typeof value.previous_run_id === "string" ? redactText(value.previous_run_id) : undefined,
    previous_outcome_hash: typeof value.previous_outcome_hash === "string" ? preview(redactText(value.previous_outcome_hash)) : undefined,
    comparison_status: readString(value.comparison_status, "unknown"),
    checkpoint_artifact_changed: typeof value.checkpoint_artifact_changed === "boolean" ? value.checkpoint_artifact_changed : undefined,
    summary_preview: preview(readString(value.summary_preview, "")),
    recommended_commands: readWakeSchedulerNavigationCheckpointWriteCompareCommands(value.recommended_commands),
  }
}

function readWakeSchedulerNavigationCheckpointWriteComparison(value: unknown, commandName: string): WakeSchedulerNavigationCheckpointWritePairComparisonSummary {
  if (!isRecord(value) || typeof value.comparison_id !== "string" || typeof value.left_run_id !== "string" || typeof value.right_run_id !== "string") throw new Error(`${commandName} returned invalid checkpoint write comparison`)
  return {
    comparison_id: redactText(value.comparison_id),
    staged_write_id: readString(value.staged_write_id, ""),
    command: preview(readString(value.command, "")),
    left_run_id: redactText(value.left_run_id),
    right_run_id: redactText(value.right_run_id),
    left_approval_id: typeof value.left_approval_id === "string" ? redactText(value.left_approval_id) : undefined,
    right_approval_id: typeof value.right_approval_id === "string" ? redactText(value.right_approval_id) : undefined,
    left_checkpoint_id: typeof value.left_checkpoint_id === "string" ? redactText(value.left_checkpoint_id) : undefined,
    right_checkpoint_id: typeof value.right_checkpoint_id === "string" ? redactText(value.right_checkpoint_id) : undefined,
    left_checkpoint_hash: typeof value.left_checkpoint_hash === "string" ? preview(redactText(value.left_checkpoint_hash)) : undefined,
    right_checkpoint_hash: typeof value.right_checkpoint_hash === "string" ? preview(redactText(value.right_checkpoint_hash)) : undefined,
    left_event_count: typeof value.left_event_count === "number" ? value.left_event_count : undefined,
    right_event_count: typeof value.right_event_count === "number" ? value.right_event_count : undefined,
    left_completed_at: readString(value.left_completed_at, ""),
    right_completed_at: readString(value.right_completed_at, ""),
    left_status: readString(value.left_status, "unknown"),
    right_status: readString(value.right_status, "unknown"),
    left_outcome_hash: preview(redactText(readString(value.left_outcome_hash, ""))),
    right_outcome_hash: preview(redactText(readString(value.right_outcome_hash, ""))),
    comparison_status: readString(value.comparison_status, "unknown"),
    checkpoint_artifact_delta: typeof value.checkpoint_artifact_delta === "string" ? preview(readString(value.checkpoint_artifact_delta, "")) : undefined,
    approval_delta: typeof value.approval_delta === "string" ? preview(readString(value.approval_delta, "")) : undefined,
    summary_delta: preview(readString(value.summary_delta, "")),
    warnings: readStringList(value.warnings, 10).map(preview),
    recommended_commands: readWakeSchedulerNavigationCheckpointWriteCompareCommands(value.recommended_commands),
  }
}

function readWakeSchedulerNavigationCheckpointWriteStaleItems(value: unknown, commandName: string, limit: number): WakeSchedulerNavigationCheckpointWriteStaleItemSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readWakeSchedulerNavigationCheckpointWriteStaleItem).filter((item): item is WakeSchedulerNavigationCheckpointWriteStaleItemSummary => item !== null).slice(0, limit)
}

function readWakeSchedulerNavigationCheckpointWriteStaleItem(value: unknown): WakeSchedulerNavigationCheckpointWriteStaleItemSummary | null {
  if (!isRecord(value) || typeof value.staged_write_id !== "string" || typeof value.command !== "string") return null
  return {
    staged_write_id: redactText(value.staged_write_id),
    approval_id: typeof value.approval_id === "string" ? redactText(value.approval_id) : undefined,
    command: preview(readString(value.command, "")),
    latest_run_id: typeof value.latest_run_id === "string" ? redactText(value.latest_run_id) : undefined,
    latest_completed_at: readString(value.latest_completed_at, ""),
    checkpoint_id: typeof value.checkpoint_id === "string" ? redactText(value.checkpoint_id) : undefined,
    age_ms: typeof value.age_ms === "number" ? value.age_ms : undefined,
    stale_after_ms: readNumber(value.stale_after_ms, 0),
    stale: readBoolean(value.stale),
    reason: preview(readString(value.reason, "")),
    recommended_commands: readWakeSchedulerNavigationCheckpointWriteCompareCommands(value.recommended_commands),
  }
}

function readWakeSchedulerNavigationCheckpointApprovalUsage(value: unknown, commandName: string): WakeSchedulerNavigationCheckpointApprovalUsageSummaryState {
  if (!isRecord(value) || !Array.isArray(value.approvals)) throw new Error(`${commandName} returned invalid checkpoint approval usage`)
  return {
    approvals: value.approvals.map(readWakeSchedulerNavigationCheckpointApprovalUsageItem).filter((item): item is WakeSchedulerNavigationCheckpointApprovalUsageSummary => item !== null).slice(0, CHECKPOINT_LIMIT),
    total_approvals: readNumber(value.total_approvals, 0),
    used_count: readNumber(value.used_count, 0),
    unused_count: readNumber(value.unused_count, 0),
    stale_count: readNumber(value.stale_count, 0),
    expired_unused_count: readNumber(value.expired_unused_count, 0),
    revoked_unused_count: readNumber(value.revoked_unused_count, 0),
    generated_at: readString(value.generated_at, ""),
  }
}

function readWakeSchedulerNavigationCheckpointApprovalUsageItem(value: unknown): WakeSchedulerNavigationCheckpointApprovalUsageSummary | null {
  if (!isRecord(value) || typeof value.approval_id !== "string" || typeof value.staged_write_id !== "string" || typeof value.command !== "string") return null
  return {
    approval_id: redactText(value.approval_id),
    staged_write_id: redactText(value.staged_write_id),
    command: preview(readString(value.command, "")),
    approval_status: readString(value.approval_status, "pending"),
    approved_at: typeof value.approved_at === "string" ? readString(value.approved_at, "") : undefined,
    expires_at: typeof value.expires_at === "string" ? readString(value.expires_at, "") : undefined,
    revoked_at: typeof value.revoked_at === "string" ? readString(value.revoked_at, "") : undefined,
    used: readBoolean(value.used),
    run_ids: readStringList(value.run_ids, 10).map((id) => redactText(id)),
    latest_run_id: typeof value.latest_run_id === "string" ? redactText(value.latest_run_id) : undefined,
    latest_run_status: readString(value.latest_run_status, "unknown"),
    latest_run_at: readString(value.latest_run_at, ""),
    stale: readBoolean(value.stale),
    expired_before_use: readBoolean(value.expired_before_use),
    revoked_before_use: readBoolean(value.revoked_before_use),
    warnings: readStringList(value.warnings, 10).map(preview),
    recommended_commands: readWakeSchedulerNavigationCheckpointWriteCompareCommands(value.recommended_commands),
  }
}

function readWakeSchedulerNavigationCheckpointWriteCompareCommands(value: unknown): WakeSchedulerNavigationCheckpointWriteCompareCommandSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 10).map((command) => ({
    label: preview(readString(command.label, "")),
    command: preview(readString(command.command, "")),
    command_type: readString(command.command_type, "read"),
    requires_active_runtime: typeof command.requires_active_runtime === "boolean" ? command.requires_active_runtime : undefined,
    notes: typeof command.notes === "string" ? preview(readString(command.notes, "")) : undefined,
  }))
}

function readWakeSchedulerNavigationWriteEvidenceList(value: unknown): WakeSchedulerNavigationWriteEvidenceSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 10).map((item) => ({
    evidence_id: redactText(readString(item.evidence_id, "")),
    kind: readString(item.kind, "manual_note"),
    related_id: typeof item.related_id === "string" ? preview(redactText(item.related_id)) : undefined,
    command: typeof item.command === "string" ? preview(readString(item.command, "")) : undefined,
    status: typeof item.status === "string" ? preview(readString(item.status, "")) : undefined,
    completed_at: typeof item.completed_at === "string" ? readString(item.completed_at, "") : undefined,
    fresh: readBoolean(item.fresh),
    age_ms: typeof item.age_ms === "number" ? item.age_ms : undefined,
    summary_preview: preview(readString(item.summary_preview, "")),
    blockers: readStringList(item.blockers, 10).map(preview),
    warnings: readStringList(item.warnings, 10).map(preview),
  }))
}

function readWakeSchedulerNavigationWritePrerequisites(value: unknown): WakeSchedulerNavigationWritePrerequisiteSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 20).map((item) => ({
    name: preview(readString(item.name, "")),
    satisfied: readBoolean(item.satisfied),
    severity: readString(item.severity, "info"),
    summary: preview(readString(item.summary, "")),
  }))
}

function readWakeSchedulerNavigationWriteCommands(value: unknown): WakeSchedulerNavigationWriteCommandSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).slice(0, 10).map((command) => ({
    label: preview(readString(command.label, "")),
    command: preview(readString(command.command, "")),
    command_type: readString(command.command_type, "read"),
    risk: typeof command.risk === "string" ? preview(redactText(command.risk)) : undefined,
    requires_active_runtime: typeof command.requires_active_runtime === "boolean" ? command.requires_active_runtime : undefined,
    notes: typeof command.notes === "string" ? preview(readString(command.notes, "")) : undefined,
  }))
}

function readWakeSchedulerNavigationFutureStagePolicy(value: unknown) {
  if (!isRecord(value)) return undefined
  return {
    would_require_active_runtime: readBoolean(value.would_require_active_runtime),
    would_require_run_lock: readBoolean(value.would_require_run_lock),
    would_require_confirmation: readBoolean(value.would_require_confirmation),
    would_require_approval_record: readBoolean(value.would_require_approval_record),
    would_require_dry_run_first: readBoolean(value.would_require_dry_run_first),
    would_require_recent_read_evidence: readBoolean(value.would_require_recent_read_evidence),
    allowed_in_7t: false as const,
  }
}

function readParsedArgs(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value).slice(0, 20)) {
    if (typeof item === "string") out[preview(redactText(key))] = preview(redactText(item))
  }
  return out
}

function readWakeSchedulerState(value: unknown): WakeSchedulerStateSummary {
  if (!isRecord(value) || !isRecord(value.config)) throw new Error("runtime.wake_scheduler_status returned invalid status")
  return {
    status: readString(value.status, "stopped"),
    config: readWakeSchedulerConfig(value.config),
    started_at: typeof value.started_at === "string" ? redactText(value.started_at) : undefined,
    stopped_at: typeof value.stopped_at === "string" ? redactText(value.stopped_at) : undefined,
    last_tick_id: typeof value.last_tick_id === "string" ? redactText(value.last_tick_id) : undefined,
    last_tick_at: typeof value.last_tick_at === "string" ? redactText(value.last_tick_at) : undefined,
    last_error: typeof value.last_error === "string" ? preview(redactText(value.last_error)) : undefined,
    tick_count: readNumber(value.tick_count, 0),
    heartbeat_count: readNumber(value.heartbeat_count, 0),
    next_tick_at: typeof value.next_tick_at === "string" ? redactText(value.next_tick_at) : undefined,
    started_by: typeof value.started_by === "string" ? preview(redactText(value.started_by)) : undefined,
    stopped_by: typeof value.stopped_by === "string" ? preview(redactText(value.stopped_by)) : undefined,
  }
}

function readWakeSchedulerEventRecordList(value: unknown, commandName: string, limit: number): WakeSchedulerEventRecordSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readWakeSchedulerEventRecord).filter((record): record is WakeSchedulerEventRecordSummary => record !== null).slice(0, limit)
}

function readWakeSchedulerEventRecord(value: unknown): WakeSchedulerEventRecordSummary | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null
  return {
    event_id: typeof value.event_id === "string" ? redactText(value.event_id) : undefined,
    kind: readString(value.kind, ""),
    scheduler_status: readString(value.scheduler_status, "stopped"),
    tick_id: typeof value.tick_id === "string" ? redactText(value.tick_id) : undefined,
    message: typeof value.message === "string" ? preview(redactText(value.message)) : undefined,
    created_at: readString(value.created_at, ""),
    requested_by: typeof value.requested_by === "string" ? preview(redactText(value.requested_by)) : undefined,
  }
}

function readRuntimeCheckpointSections(value: unknown): RuntimeCheckpointSectionSummary[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    if (!isRecord(item) || typeof item.name !== "string") return null
    return {
      name: readString(item.name, "section"),
      included: readBoolean(item.included),
      item_count: readNumber(item.item_count, 0),
      bytes: readNumber(item.bytes, 0),
      truncated: readBoolean(item.truncated),
    }
  }).filter((item): item is RuntimeCheckpointSectionSummary => item !== null).slice(0, 20)
}

function readCheckpointScope(value: unknown): RuntimeCheckpointScope {
  if (value === "full" || value === "commander" || value === "executor" || value === "research" || value === "handoff") return value
  return "full"
}

function readFollowupStatus(value: unknown): OpenCodeHandoffFollowupSummary["followup_status"] {
  if (value === "sent" || value === "claimed" || value === "running" || value === "result_submitted" || value === "completed" || value === "failed" || value === "cancelled" || value === "handoff_failed" || value === "blocked" || value === "unknown") return value
  return "unknown"
}

function readFollowupStatusQueue(value: unknown): OpenCodeHandoffFollowupQueueKind {
  if (value === "active" || value === "needs_result_review" || value === "completed" || value === "failed" || value === "blocked" || value === "stale") return value
  return "blocked"
}

function readResearchProjectionUi(value: unknown): ResearchProjectionUiSummary {
  if (!isRecord(value)) throw new Error("research.projection_status returned non-object result")
  return {
    mode: readString(value.mode, "unknown"),
    ok: readBoolean(value.ok),
    stale: readBoolean(value.stale),
    reason: typeof value.reason === "string" ? redactText(value.reason) : undefined,
    pending_count: readNumber(value.pending_count, 0),
    last_event_id: typeof value.last_event_id === "string" ? redactText(value.last_event_id) : undefined,
  }
}

function readMissionSummary(value: unknown, recent: MissionRecord[]): MissionSummaryState | undefined {
  if (!isRecord(value)) return undefined
  return {
    pending_count: readNumber(value.pending_count, 0),
    failed_count: readNumber(value.failed_count, 0),
    active_claim_count: readNumber(value.active_claim_count, 0),
    completed_count: readNumber(value.completed_count, 0),
    cancelled_count: readNumber(value.cancelled_count, 0),
    last_mission_id: typeof value.last_mission_id === "string" ? redactText(value.last_mission_id) : undefined,
    recent,
  }
}

function readReasoningProviderStatus(value: unknown): ReasoningProviderStatusSummary | undefined {
  if (!isRecord(value)) return undefined
  return {
    kind: readString(value.kind, "fake"),
    provider_id: readString(value.provider_id, "unknown"),
    connector_id: typeof value.connector_id === "string" ? redactText(value.connector_id) : undefined,
    model: typeof value.model === "string" ? redactText(value.model) : undefined,
    max_input_bytes: readNumber(value.max_input_bytes, 0),
    max_output_bytes: readNumber(value.max_output_bytes, 0),
    timeout_ms: typeof value.timeout_ms === "number" ? value.timeout_ms : undefined,
    system_prompt_version: typeof value.system_prompt_version === "string" ? redactText(value.system_prompt_version) : undefined,
    enabled_for: Array.isArray(value.enabled_for) ? value.enabled_for.filter((item): item is string => typeof item === "string").map(redactText) : [],
  }
}

function readReasoningProviderHealth(value: unknown): ReasoningProviderHealthSummary | undefined {
  if (!isRecord(value)) return undefined
  return {
    provider_id: readString(value.provider_id, "unknown"),
    kind: readString(value.kind, "fake"),
    status: readString(value.status, "blocked"),
    enabled_for: readStringList(value.enabled_for, 10),
    connector_id: typeof value.connector_id === "string" ? redactText(value.connector_id) : undefined,
    model: typeof value.model === "string" ? redactText(value.model) : undefined,
    max_input_bytes: readNumber(value.max_input_bytes, 0),
    max_output_bytes: readNumber(value.max_output_bytes, 0),
    timeout_ms: typeof value.timeout_ms === "number" ? value.timeout_ms : undefined,
    checks: Array.isArray(value.checks) ? value.checks.map(readReasoningProviderHealthCheck).filter((check): check is NonNullable<ReturnType<typeof readReasoningProviderHealthCheck>> => check !== null).slice(0, 20) : [],
    last_checked_at: readString(value.last_checked_at, ""),
  }
}

function readReasoningProviderHealthCheck(value: unknown): ReasoningProviderHealthCheckSummary | null {
  if (!isRecord(value)) return null
  return {
    name: readString(value.name, "check"),
    ok: readBoolean(value.ok),
    severity: readString(value.severity, "info"),
    summary: preview(readString(value.summary, "")),
    redacted_detail: typeof value.redacted_detail === "string" ? preview(redactText(value.redacted_detail)) : undefined,
  }
}

function readReasoningProviderSmokePreview(value: unknown): ReasoningProviderSmokePreviewSummary | undefined {
  if (!isRecord(value)) return undefined
  return {
    provider_id: readString(value.provider_id, "unknown"),
    kind: readString(value.kind, "fake"),
    surface: readString(value.surface, "research_synthesis"),
    would_call_network: readBoolean(value.would_call_network),
    connector_id: typeof value.connector_id === "string" ? redactText(value.connector_id) : undefined,
    model: typeof value.model === "string" ? redactText(value.model) : undefined,
    prompt_bytes: readNumber(value.prompt_bytes, 0),
    max_output_bytes: readNumber(value.max_output_bytes, 0),
    blockers: readStringList(value.blockers, 20),
    redacted_request_preview: preview(readString(value.redacted_request_preview, "")),
  }
}

function readReasoningProviderSmokeResult(value: unknown): ReasoningProviderSmokeResultSummary | undefined {
  if (!isRecord(value)) return undefined
  return {
    provider_id: readString(value.provider_id, "unknown"),
    kind: readString(value.kind, "fake"),
    surface: readString(value.surface, "research_synthesis"),
    ok: readBoolean(value.ok),
    dry_run: readBoolean(value.dry_run),
    connector_id: typeof value.connector_id === "string" ? redactText(value.connector_id) : undefined,
    model: typeof value.model === "string" ? redactText(value.model) : undefined,
    request_id: typeof value.request_id === "string" ? redactText(value.request_id) : undefined,
    parsed: readBoolean(value.parsed),
    summary: preview(readString(value.summary, "")),
    error: typeof value.error === "string" ? preview(redactText(value.error)) : undefined,
    created_at: readString(value.created_at, ""),
  }
}

function readMiniMaxLiveValidationPreview(value: unknown): MiniMaxLiveValidationPreviewSummary | undefined {
  if (!isRecord(value)) return undefined
  return {
    validation_id: typeof value.validation_id === "string" ? redactText(value.validation_id) : undefined,
    status: readString(value.status, "blocked"),
    can_execute: readBoolean(value.can_execute),
    provider_kind: readString(value.provider_kind, "unknown"),
    provider_id: readString(value.provider_id, "unknown"),
    connector_id: typeof value.connector_id === "string" ? redactText(value.connector_id) : undefined,
    model: typeof value.model === "string" ? redactText(value.model) : undefined,
    enabled_surfaces: readStringList(value.enabled_surfaces, 10),
    requested_surfaces: readStringList(value.requested_surfaces, 10),
    opt_in_required: readBoolean(value.opt_in_required),
    opt_in_present: readBoolean(value.opt_in_present),
    timeout_ms: readNumber(value.timeout_ms, 0),
    blockers: readStringList(value.blockers, 20),
    warnings: readStringList(value.warnings, 20),
    redacted_summary_preview: preview(readString(value.redacted_summary_preview, "")),
    recommended_commands: readMiniMaxLiveValidationCommands(value.recommended_commands),
    generated_at: readString(value.generated_at, ""),
  }
}

function readMiniMaxLiveValidationResult(value: unknown): MiniMaxLiveValidationResultSummary | null {
  if (!isRecord(value) || typeof value.validation_id !== "string") return null
  return {
    validation_id: redactText(value.validation_id),
    status: readString(value.status, "blocked"),
    provider_kind: readString(value.provider_kind, "unknown"),
    provider_id: readString(value.provider_id, "unknown"),
    connector_id: typeof value.connector_id === "string" ? redactText(value.connector_id) : undefined,
    model: typeof value.model === "string" ? redactText(value.model) : undefined,
    surfaces: Array.isArray(value.surfaces) ? value.surfaces.map(readMiniMaxLiveValidationSurfaceResult).filter((item): item is MiniMaxLiveValidationSurfaceResultSummary => item !== null).slice(0, 10) : [],
    started_at: readString(value.started_at, ""),
    completed_at: readString(value.completed_at, ""),
    duration_ms: typeof value.duration_ms === "number" ? value.duration_ms : undefined,
    requested_by: readString(value.requested_by, "unknown"),
    validation_hash: readString(value.validation_hash, ""),
    diagnostics: readStringList(value.diagnostics, 12),
    error: typeof value.error === "string" ? preview(redactText(value.error)) : undefined,
  }
}

function readMiniMaxLiveValidationSurfaceResult(value: unknown): MiniMaxLiveValidationSurfaceResultSummary | null {
  if (!isRecord(value)) return null
  return {
    surface: readString(value.surface, "unknown"),
    status: readString(value.status, "blocked"),
    ok: readBoolean(value.ok),
    parsed: readBoolean(value.parsed),
    request_id: typeof value.request_id === "string" ? redactText(value.request_id) : undefined,
    summary_preview: typeof value.summary_preview === "string" ? preview(redactText(value.summary_preview)) : undefined,
    error: typeof value.error === "string" ? preview(redactText(value.error)) : undefined,
    duration_ms: typeof value.duration_ms === "number" ? value.duration_ms : undefined,
    schema_version: typeof value.schema_version === "string" ? redactText(value.schema_version) : undefined,
  }
}

function readMiniMaxLiveValidationRecordList(value: unknown, commandName: string, limit: number): MiniMaxLiveValidationRecordSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readMiniMaxLiveValidationRecord).filter((record): record is MiniMaxLiveValidationRecordSummary => record !== null).slice(0, limit)
}

function readMiniMaxLiveValidationRecord(value: unknown): MiniMaxLiveValidationRecordSummary | null {
  if (!isRecord(value) || typeof value.validation_id !== "string") return null
  return {
    validation_id: redactText(value.validation_id),
    status: readString(value.status, "blocked"),
    provider_id: readString(value.provider_id, "unknown"),
    model: typeof value.model === "string" ? redactText(value.model) : undefined,
    completed_at: readString(value.completed_at, ""),
    surface_count: readNumber(value.surface_count, 0),
    succeeded_count: readNumber(value.succeeded_count, 0),
    failed_count: readNumber(value.failed_count, 0),
    summary_preview: preview(readString(value.summary_preview, "")),
    validation_hash: readString(value.validation_hash, ""),
  }
}

function readMiniMaxLiveValidationCommands(value: unknown): MiniMaxLiveValidationCommandSummary[] {
  if (!Array.isArray(value)) return []
  return value.map((item): MiniMaxLiveValidationCommandSummary | null => {
    if (!isRecord(item)) return null
    return {
      label: readString(item.label, "command"),
      command: readString(item.command, ""),
      command_type: readString(item.command_type, "read"),
      requires_active_runtime: typeof item.requires_active_runtime === "boolean" ? item.requires_active_runtime : undefined,
      notes: typeof item.notes === "string" ? preview(redactText(item.notes)) : undefined,
    }
  }).filter((item): item is MiniMaxLiveValidationCommandSummary => item !== null).slice(0, 10)
}

function recordFromMiniMaxLiveValidationResult(result: MiniMaxLiveValidationResultSummary): MiniMaxLiveValidationRecordSummary {
  return {
    validation_id: result.validation_id,
    status: result.status,
    provider_id: result.provider_id,
    model: result.model,
    completed_at: result.completed_at,
    surface_count: result.surfaces.length,
    succeeded_count: result.surfaces.filter((surface) => surface.status === "succeeded").length,
    failed_count: result.surfaces.filter((surface) => surface.status === "failed" || surface.status === "blocked").length,
    summary_preview: result.error ?? result.diagnostics[0] ?? result.status,
    validation_hash: result.validation_hash,
  }
}

function readReviewSummary(value: unknown): ReviewStatusSummary | undefined {
  if (!isRecord(value)) return undefined
  return {
    pending_count: readNumber(value.pending_count, 0),
    approved_count: readNumber(value.approved_count, 0),
    rejected_count: readNumber(value.rejected_count, 0),
    cancelled_count: readNumber(value.cancelled_count, 0),
    last_review_id: typeof value.last_review_id === "string" ? redactText(value.last_review_id) : undefined,
  }
}

function readProposalSummary(value: unknown): ProposalStatusSummary | undefined {
  if (!isRecord(value)) return undefined
  return {
    proposed_count: readNumber(value.proposed_count, 0),
    review_requested_count: readNumber(value.review_requested_count, 0),
    approved_count: readNumber(value.approved_count, 0),
    rejected_count: readNumber(value.rejected_count, 0),
    cancelled_count: readNumber(value.cancelled_count, 0),
    applied_count: readNumber(value.applied_count, 0),
    last_proposal_id: typeof value.last_proposal_id === "string" ? redactText(value.last_proposal_id) : undefined,
  }
}

function readProposalBundleSummary(value: unknown): ProposalBundleStatusSummary | undefined {
  if (!isRecord(value)) return undefined
  return {
    open_count: readNumber(value.open_count, 0),
    review_requested_count: readNumber(value.review_requested_count, 0),
    approved_count: readNumber(value.approved_count, 0),
    partially_approved_count: readNumber(value.partially_approved_count, 0),
    applied_count: readNumber(value.applied_count, 0),
    partially_applied_count: readNumber(value.partially_applied_count, 0),
    cancelled_count: readNumber(value.cancelled_count, 0),
    last_bundle_id: typeof value.last_bundle_id === "string" ? redactText(value.last_bundle_id) : undefined,
  }
}

function readWorkbenchSummary(value: unknown): CommanderWorkbenchStatusSummary | undefined {
  if (!isRecord(value)) return undefined
  return {
    drafted_count: readNumber(value.drafted_count, 0),
    review_requested_count: readNumber(value.review_requested_count, 0),
    partially_review_requested_count: readNumber(value.partially_review_requested_count, 0),
    cancelled_count: readNumber(value.cancelled_count, 0),
    last_draft_id: typeof value.last_draft_id === "string" ? redactText(value.last_draft_id) : undefined,
  }
}

function readReviewList(value: unknown, commandName: string): ReviewRequestSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readReview).filter((review): review is ReviewRequestSummary => review !== null).slice(0, REVIEW_LIMIT)
}

function readReview(value: unknown): ReviewRequestSummary | null {
  if (!isRecord(value) || typeof value.review_id !== "string" || typeof value.status !== "string") return null
  return {
    review_id: redactText(value.review_id),
    mission_id: typeof value.mission_id === "string" ? redactText(value.mission_id) : undefined,
    claim_id: typeof value.claim_id === "string" ? redactText(value.claim_id) : undefined,
    result_id: typeof value.result_id === "string" ? redactText(value.result_id) : undefined,
    request_type: readString(value.request_type, "other"),
    title: preview(readString(value.title, "")),
    summary: preview(readString(value.summary, "")),
    requested_by: readString(value.requested_by, "unknown"),
    status: readString(value.status, "unknown"),
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : undefined,
    updated_at: typeof value.updated_at === "string" ? redactText(value.updated_at) : undefined,
    decision_at: typeof value.decision_at === "string" ? redactText(value.decision_at) : undefined,
    decision_by: typeof value.decision_by === "string" ? redactText(value.decision_by) : undefined,
    decision_reason: typeof value.decision_reason === "string" ? preview(redactText(value.decision_reason)) : undefined,
  }
}

function readProposalList(value: unknown, commandName: string): CommanderProposalSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readProposal).filter((proposal): proposal is CommanderProposalSummary => proposal !== null).slice(0, PROPOSAL_LIMIT)
}

function readProposal(value: unknown): CommanderProposalSummary | null {
  if (!isRecord(value) || typeof value.proposal_id !== "string" || typeof value.status !== "string") return null
  return {
    proposal_id: redactText(value.proposal_id),
    mission_id: typeof value.mission_id === "string" ? redactText(value.mission_id) : undefined,
    claim_id: typeof value.claim_id === "string" ? redactText(value.claim_id) : undefined,
    result_id: typeof value.result_id === "string" ? redactText(value.result_id) : undefined,
    review_id: typeof value.review_id === "string" ? redactText(value.review_id) : undefined,
    action_kind: readString(value.action_kind, "other"),
    title: preview(readString(value.title, "")),
    summary: preview(readString(value.summary, "")),
    proposed_by: readString(value.proposed_by, "unknown"),
    status: readString(value.status, "unknown"),
    action_payload: isRecord(value.action_payload) ? redactUnknown(value.action_payload) as Record<string, unknown> : undefined,
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : undefined,
    updated_at: typeof value.updated_at === "string" ? redactText(value.updated_at) : undefined,
    decision_at: typeof value.decision_at === "string" ? redactText(value.decision_at) : undefined,
    applied_at: typeof value.applied_at === "string" ? redactText(value.applied_at) : undefined,
    application_result: typeof value.application_result === "string" ? redactText(value.application_result) : undefined,
    failure_reason: typeof value.failure_reason === "string" ? preview(redactText(value.failure_reason)) : undefined,
  }
}

function readProposalBundleList(value: unknown, commandName: string): CommanderProposalBundleSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readProposalBundle).filter((bundle): bundle is CommanderProposalBundleSummary => bundle !== null).slice(0, PROPOSAL_BUNDLE_LIMIT)
}

function readProposalBundle(value: unknown): CommanderProposalBundleSummary | null {
  if (!isRecord(value) || typeof value.bundle_id !== "string" || typeof value.status !== "string") return null
  const proposalIds = Array.isArray(value.proposal_ids)
    ? value.proposal_ids.filter((item): item is string => typeof item === "string").map(redactText).slice(0, 100)
    : []
  return {
    bundle_id: redactText(value.bundle_id),
    title: preview(readString(value.title, "")),
    summary: preview(readString(value.summary, "")),
    created_by: readString(value.created_by, "unknown"),
    status: readString(value.status, "unknown"),
    proposal_ids: proposalIds,
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : undefined,
    updated_at: typeof value.updated_at === "string" ? redactText(value.updated_at) : undefined,
    cancelled_at: typeof value.cancelled_at === "string" ? redactText(value.cancelled_at) : undefined,
    cancellation_reason: typeof value.cancellation_reason === "string" ? preview(redactText(value.cancellation_reason)) : undefined,
    applied_at: typeof value.applied_at === "string" ? redactText(value.applied_at) : undefined,
    failure_reason: typeof value.failure_reason === "string" ? preview(redactText(value.failure_reason)) : undefined,
  }
}

function readProposalBundleReadiness(value: unknown): ProposalBundleReadinessSummary {
  if (!isRecord(value) || typeof value.bundle_id !== "string") throw new Error("runtime.proposal_bundle_readiness returned invalid readiness")
  return {
    bundle_id: redactText(value.bundle_id),
    proposal_count: readNumber(value.proposal_count, 0),
    proposed_count: readNumber(value.proposed_count, 0),
    review_requested_count: readNumber(value.review_requested_count, 0),
    approved_count: readNumber(value.approved_count, 0),
    rejected_count: readNumber(value.rejected_count, 0),
    cancelled_count: readNumber(value.cancelled_count, 0),
    applied_count: readNumber(value.applied_count, 0),
    blocked_count: readNumber(value.blocked_count, 0),
    ready_to_apply: readBoolean(value.ready_to_apply),
    blockers: Array.isArray(value.blockers) ? value.blockers.filter((item): item is string => typeof item === "string").map((item) => preview(redactText(item))).slice(0, 10) : [],
  }
}

function readPlaybook(value: unknown): CommanderPlaybookSummary | null {
  if (!isRecord(value) || typeof value.playbook_id !== "string") return null
  const fields = Array.isArray(value.required_fields)
    ? value.required_fields.map(readPlaybookField).filter((field): field is CommanderPlaybookSummary["required_fields"][number] => field !== null).slice(0, 20)
    : []
  const actionKinds = Array.isArray(value.generated_action_kinds)
    ? value.generated_action_kinds.filter((item): item is string => typeof item === "string").map(redactText).slice(0, 20)
    : []
  return {
    playbook_id: redactText(value.playbook_id),
    title: preview(readString(value.title, "")),
    description: preview(readString(value.description, "")),
    required_fields: fields,
    generated_action_kinds: actionKinds,
    creates_bundle: readBoolean(value.creates_bundle),
  }
}

function readPlaybookField(value: unknown): CommanderPlaybookSummary["required_fields"][number] | null {
  if (!isRecord(value) || typeof value.name !== "string") return null
  return {
    name: redactText(value.name),
    label: preview(readString(value.label, value.name)),
    required: readBoolean(value.required),
    field_type: readString(value.field_type, "text"),
  }
}

function readPlaybookDraft(value: unknown): CommanderPlaybookDraftSummary {
  if (!isRecord(value) || typeof value.playbook_id !== "string" || typeof value.created_at !== "string") throw new Error("runtime.draft_commander_playbook returned invalid draft result")
  return {
    draft_id: typeof value.draft_id === "string" ? redactText(value.draft_id) : undefined,
    playbook_id: redactText(value.playbook_id),
    proposal_ids: Array.isArray(value.proposal_ids) ? value.proposal_ids.filter((item): item is string => typeof item === "string").map(redactText).slice(0, 20) : [],
    bundle_id: typeof value.bundle_id === "string" ? redactText(value.bundle_id) : undefined,
    review_ids: Array.isArray(value.review_ids) ? value.review_ids.filter((item): item is string => typeof item === "string").map(redactText).slice(0, 20) : undefined,
    created_at: redactText(value.created_at),
  }
}

function readWorkbenchDraftList(value: unknown, commandName: string): CommanderWorkbenchDraftSummary[] {
  if (!Array.isArray(value)) throw new Error(`${commandName} returned non-array result`)
  return value.map(readWorkbenchDraft).filter((draft): draft is CommanderWorkbenchDraftSummary => draft !== null).slice(0, WORKBENCH_DRAFT_LIMIT)
}

function readWorkbenchDraft(value: unknown): CommanderWorkbenchDraftSummary | null {
  if (!isRecord(value) || typeof value.draft_id !== "string" || typeof value.status !== "string") return null
  const fieldValues: Record<string, string> = {}
  if (isRecord(value.field_values)) {
    for (const [key, raw] of Object.entries(value.field_values)) {
      if (typeof raw === "string") fieldValues[redactText(key)] = preview(redactText(raw))
    }
  }
  return {
    draft_id: redactText(value.draft_id),
    playbook_id: readString(value.playbook_id, "unknown"),
    status: readString(value.status, "unknown"),
    proposed_by: readString(value.proposed_by, "unknown"),
    field_values: fieldValues,
    proposal_ids: Array.isArray(value.proposal_ids) ? value.proposal_ids.filter((item): item is string => typeof item === "string").map(redactText).slice(0, 20) : [],
    bundle_id: typeof value.bundle_id === "string" ? redactText(value.bundle_id) : undefined,
    review_ids: Array.isArray(value.review_ids) ? value.review_ids.filter((item): item is string => typeof item === "string").map(redactText).slice(0, 20) : undefined,
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : "",
    updated_at: typeof value.updated_at === "string" ? redactText(value.updated_at) : "",
    cancelled_at: typeof value.cancelled_at === "string" ? redactText(value.cancelled_at) : undefined,
    cancellation_reason: typeof value.cancellation_reason === "string" ? preview(redactText(value.cancellation_reason)) : undefined,
  }
}

function readWorkbenchReadiness(value: unknown): CommanderWorkbenchReadinessSummary {
  if (!isRecord(value) || typeof value.draft_id !== "string") throw new Error("runtime.commander_playbook_draft_readiness returned invalid readiness")
  return {
    draft_id: redactText(value.draft_id),
    proposal_count: readNumber(value.proposal_count, 0),
    bundle_id: typeof value.bundle_id === "string" ? redactText(value.bundle_id) : undefined,
    review_count: readNumber(value.review_count, 0),
    missing_review_count: readNumber(value.missing_review_count, 0),
    approved_review_count: readNumber(value.approved_review_count, 0),
    rejected_review_count: readNumber(value.rejected_review_count, 0),
    cancelled_review_count: readNumber(value.cancelled_review_count, 0),
    applied_proposal_count: readNumber(value.applied_proposal_count, 0),
    blockers: Array.isArray(value.blockers) ? value.blockers.filter((item): item is string => typeof item === "string").map((item) => preview(redactText(item))).slice(0, 10) : [],
    ready_to_apply: readBoolean(value.ready_to_apply),
  }
}

function readCommanderApplyPreview(value: unknown): CommanderApplyPreviewSummary {
  if (!isRecord(value) || typeof value.target_type !== "string" || typeof value.target_id !== "string") throw new Error("runtime.commander_apply_preview returned invalid preview")
  return {
    target_type: readString(value.target_type, "unknown"),
    target_id: redactText(value.target_id),
    ready_to_apply: readBoolean(value.ready_to_apply),
    proposal_ids: readStringList(value.proposal_ids, 20),
    bundle_id: typeof value.bundle_id === "string" ? redactText(value.bundle_id) : undefined,
    draft_id: typeof value.draft_id === "string" ? redactText(value.draft_id) : undefined,
    approved_count: readNumber(value.approved_count, 0),
    applied_count: readNumber(value.applied_count, 0),
    blocked_count: readNumber(value.blocked_count, 0),
    blockers: readStringList(value.blockers, 10).map(preview),
    apply_mode: readString(value.apply_mode, "single"),
    would_apply: readStringList(value.would_apply, 20),
    would_skip: readStringList(value.would_skip, 20),
  }
}

function readCommanderApplyResult(value: unknown): CommanderApplyResultSummary {
  if (!isRecord(value) || typeof value.target_type !== "string" || typeof value.target_id !== "string") throw new Error("runtime.apply_commander_target returned invalid result")
  return {
    target_type: readString(value.target_type, "unknown"),
    target_id: redactText(value.target_id),
    applied: readBoolean(value.applied),
    applied_proposal_ids: readStringList(value.applied_proposal_ids, 20),
    skipped_proposal_ids: readStringList(value.skipped_proposal_ids, 20),
    result_summary: preview(readString(value.result_summary, "")),
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : "",
  }
}

function readCommanderAuditTimeline(value: unknown): CommanderAuditEventSummary[] {
  if (!isRecord(value) || !Array.isArray(value.events)) throw new Error("runtime.commander_audit_timeline returned invalid timeline")
  return value.events.map(readCommanderAuditEvent).filter((event): event is CommanderAuditEventSummary => event !== null).slice(0, AUDIT_LIMIT)
}

function readCommanderAuthorityChain(value: unknown): CommanderAuthorityChainSummary {
  if (!isRecord(value) || typeof value.target_type !== "string" || typeof value.target_id !== "string" || !Array.isArray(value.events)) throw new Error("runtime.commander_authority_chain returned invalid chain")
  return {
    target_type: readString(value.target_type, "unknown"),
    target_id: redactText(value.target_id),
    related_ids: readRelatedIds(value.related_ids),
    events: value.events.map(readCommanderAuditEvent).filter((event): event is CommanderAuditEventSummary => event !== null).slice(0, 20),
    missing_links: readStringList(value.missing_links, 10).map(preview),
  }
}

function readCommanderAuditEvent(value: unknown): CommanderAuditEventSummary | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null
  return {
    event_id: typeof value.event_id === "string" ? redactText(value.event_id) : undefined,
    event_index: readNumber(value.event_index, 0),
    kind: readString(value.kind, "unknown"),
    category: readString(value.category, "other"),
    target_type: typeof value.target_type === "string" ? redactText(value.target_type) : undefined,
    target_id: typeof value.target_id === "string" ? redactText(value.target_id) : undefined,
    related_ids: readRelatedIds(value.related_ids),
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : undefined,
    title: preview(readString(value.title, value.kind)),
    summary: preview(readString(value.summary, "")),
  }
}

function readCommanderQueueSummary(value: unknown): CommanderQueueSummary {
  if (!isRecord(value)) throw new Error("runtime.commander_queue_summary returned invalid summary")
  return {
    needs_review_count: readNumber(value.needs_review_count, 0),
    ready_to_apply_count: readNumber(value.ready_to_apply_count, 0),
    blocked_count: readNumber(value.blocked_count, 0),
    failed_apply_count: readNumber(value.failed_apply_count, 0),
    recently_applied_count: readNumber(value.recently_applied_count, 0),
    drafts_needing_review_count: readNumber(value.drafts_needing_review_count, 0),
    bundles_needing_review_count: readNumber(value.bundles_needing_review_count, 0),
    stale_open_count: readNumber(value.stale_open_count, 0),
    last_updated_at: typeof value.last_updated_at === "string" ? redactText(value.last_updated_at) : undefined,
  }
}

function readCommanderQueueResult(value: unknown): { queue: CommanderQueueKind; items: CommanderQueueItemSummary[]; total_considered: number; limit: number } {
  if (!isRecord(value) || typeof value.queue !== "string" || !Array.isArray(value.items)) throw new Error("runtime.commander_queue returned invalid result")
  const queue = readQueueKind(value.queue)
  const limit = Math.max(0, Math.min(readNumber(value.limit, QUEUE_LIMIT), 100))
  return {
    queue,
    items: value.items.map(readCommanderQueueItem).filter((item): item is CommanderQueueItemSummary => item !== null).slice(0, limit),
    total_considered: readNumber(value.total_considered, 0),
    limit,
  }
}

function readCommanderQueueItem(value: unknown): CommanderQueueItemSummary | null {
  if (!isRecord(value) || typeof value.queue !== "string" || typeof value.target_id !== "string" || typeof value.target_type !== "string") return null
  return {
    queue: readQueueKind(value.queue),
    target_type: readString(value.target_type, "unknown"),
    target_id: redactText(value.target_id),
    title: preview(readString(value.title, "")),
    summary: preview(readString(value.summary, "")),
    status: readString(value.status, "unknown"),
    priority: typeof value.priority === "string" ? redactText(value.priority) : undefined,
    related_ids: readRelatedIds(value.related_ids),
    blockers: readStringList(value.blockers, 10).map(preview),
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : undefined,
    updated_at: typeof value.updated_at === "string" ? redactText(value.updated_at) : undefined,
  }
}

function readCommanderTargetContext(value: unknown): CommanderTargetContextSummary {
  if (!isRecord(value) || typeof value.target_type !== "string" || typeof value.target_id !== "string") throw new Error("runtime.commander_target_context returned invalid context")
  return {
    target_type: readTargetType(value.target_type),
    target_id: redactText(value.target_id),
    found: readBoolean(value.found),
    title: preview(readString(value.title, "")),
    summary: preview(readString(value.summary, "")),
    status: typeof value.status === "string" ? redactText(value.status) : undefined,
    record_kind: typeof value.record_kind === "string" ? redactText(value.record_kind) : undefined,
    related_ids: readRelatedIds(value.related_ids),
    queue_membership: readStringList(value.queue_membership, 20).map(readQueueKind),
    audit_event_count: readNumber(value.audit_event_count, 0),
    recent_audit_events: Array.isArray(value.recent_audit_events) ? value.recent_audit_events.map(readCommanderAuditEvent).filter((event): event is CommanderAuditEventSummary => event !== null).slice(0, 20) : [],
    suggested_commands: Array.isArray(value.suggested_commands) ? value.suggested_commands.map(readSuggestedCommand).filter((command): command is CommanderSuggestedCommandSummary => command !== null).slice(0, 12) : [],
    missing_links: readStringList(value.missing_links, 20).map(preview),
  }
}

function readSuggestedCommand(value: unknown): CommanderSuggestedCommandSummary | null {
  if (!isRecord(value) || typeof value.label !== "string" || typeof value.command !== "string") return null
  const commandType = value.command_type === "write" ? "write" : "read"
  return withExecutionCommand<CommanderSuggestedCommandSummary>({
    label: preview(readString(value.label, "")),
    command: readString(value.command, ""),
    command_type: commandType,
    requires_review: typeof value.requires_review === "boolean" ? value.requires_review : undefined,
    requires_active_runtime: typeof value.requires_active_runtime === "boolean" ? value.requires_active_runtime : undefined,
  }, value.command)
}

function readRelatedIds(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) return {}
  const out: Record<string, string[]> = {}
  for (const [key, raw] of Object.entries(value)) out[redactText(key)] = readStringList(raw, 20)
  return out
}

function readStringList(value: unknown, limit: number): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map(redactText).slice(0, limit) : []
}

function readStringMap(value: unknown, limit: number): Record<string, string> {
  if (!isRecord(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value).slice(0, limit)) {
    if (typeof raw === "string") out[redactText(key)] = preview(redactText(raw))
  }
  return out
}

function readNumberMap(value: unknown, limit: number): Record<string, number> {
  if (!isRecord(value)) return {}
  const out: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value).slice(0, limit)) {
    if (typeof raw === "number" && Number.isFinite(raw)) out[redactText(key)] = raw
  }
  return out
}

function readCommandAuthoritySummary(value: unknown): CommandAuthoritySummaryState {
  if (!isRecord(value)) throw new Error("runtime.command_authority_summary returned invalid summary")
  return {
    total_records: readNumber(value.total_records, 0),
    risks: readNumberMap(value.risks, 20),
    gates: readNumberMap(value.gates, 40),
    owners: readNumberMap(value.owners, 40),
    mutating_count: readNumber(value.mutating_count, 0),
    high_impact_count: readNumber(value.high_impact_count, 0),
    approval_required_count: readNumber(value.approval_required_count, 0),
    generated_at: readString(value.generated_at, ""),
  }
}

function readCommandAuthorityRecord(value: unknown): CommandAuthorityRecordSummary | null {
  if (!isRecord(value) || typeof value.authority_id !== "string" || typeof value.slash_command !== "string") return null
  return {
    authority_id: redactText(value.authority_id),
    slash_command: value.slash_command,
    runtime_command: typeof value.runtime_command === "string" ? redactText(value.runtime_command) : undefined,
    aliases: readStringList(value.aliases, 12),
    risk: readString(value.risk, "unknown"),
    gate: readString(value.gate, "unknown"),
    owner: readString(value.owner, "unknown"),
    mutates_events: readBoolean(value.mutates_events),
    creates_external_process: readBoolean(value.creates_external_process),
    calls_provider: readBoolean(value.calls_provider),
    requires_active_runtime: readBoolean(value.requires_active_runtime),
    requires_run_lock: readBoolean(value.requires_run_lock),
    requires_approval: readBoolean(value.requires_approval),
    approval_surface: typeof value.approval_surface === "string" ? redactText(value.approval_surface) : undefined,
    execution_surface: typeof value.execution_surface === "string" ? redactText(value.execution_surface) : undefined,
    expected_event_kinds: readStringList(value.expected_event_kinds, 20),
    blocked_by_default: readBoolean(value.blocked_by_default),
    current_phase_status: readString(value.current_phase_status, "unknown"),
    recommended_reads: readStringList(value.recommended_reads, 12),
    validation_profile: readCommandAuthorityValidationProfile(value.validation_profile),
    notes: readStringList(value.notes, 12).map(preview),
    out_of_scope: readStringList(value.out_of_scope, 12).map(preview),
  }
}

function readCommandAuthorityValidationProfile(value: unknown): CommandAuthorityValidationProfileSummary {
  const raw = isRecord(value) ? value : {}
  return {
    unit_runtime: readBoolean(raw.unit_runtime),
    unit_tui: readBoolean(raw.unit_tui),
    typecheck_runtime: readBoolean(raw.typecheck_runtime),
    typecheck_tui: readBoolean(raw.typecheck_tui),
    integration_cli: readBoolean(raw.integration_cli),
    targeted_e2e: readStringList(raw.targeted_e2e, 20),
    optional_regression_e2e: readStringList(raw.optional_regression_e2e, 20),
    full_e2e_required_when: readStringList(raw.full_e2e_required_when, 20).map(preview),
    live_provider_required: false,
    real_opencode_required: false,
  }
}

function readQueueKind(value: string): CommanderQueueKind {
  if (value === "needs_review" ||
    value === "ready_to_apply" ||
    value === "blocked" ||
    value === "failed_apply" ||
    value === "recently_applied" ||
    value === "drafts_needing_review" ||
    value === "bundles_needing_review" ||
    value === "stale_open") return value
  throw new Error("commander queue kind is invalid")
}

function readTargetType(value: string): CommanderTargetType {
  if (value === "mission" ||
    value === "claim" ||
    value === "result" ||
    value === "review" ||
    value === "proposal" ||
    value === "bundle" ||
    value === "draft" ||
    value === "runtime") return value
  throw new Error("commander target type is invalid")
}

function readMissionRecord(value: unknown): MissionRecord | null {
  if (!isRecord(value) || typeof value.mission_id !== "string" || typeof value.status !== "string") return null
  return {
    mission_id: redactText(value.mission_id),
    intent_id: typeof value.intent_id === "string" ? redactText(value.intent_id) : undefined,
    objective: typeof value.objective === "string" ? redactText(value.objective) : undefined,
    status: redactText(value.status),
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : undefined,
    updated_at: typeof value.updated_at === "string" ? redactText(value.updated_at) : undefined,
    claimed_at: typeof value.claimed_at === "string" ? redactText(value.claimed_at) : undefined,
    completed_at: typeof value.completed_at === "string" ? redactText(value.completed_at) : undefined,
    cancelled_at: typeof value.cancelled_at === "string" ? redactText(value.cancelled_at) : undefined,
    failure_reason: typeof value.failure_reason === "string" ? redactText(value.failure_reason) : undefined,
    cancellation_reason: typeof value.cancellation_reason === "string" ? redactText(value.cancellation_reason) : undefined,
    completion_summary: typeof value.completion_summary === "string" ? redactText(value.completion_summary) : undefined,
    completion_result_id: typeof value.completion_result_id === "string" ? redactText(value.completion_result_id) : undefined,
  }
}

function readExecutorClaim(value: unknown): ExecutorClaimSummary | null {
  if (!isRecord(value) || typeof value.claim_id !== "string" || typeof value.mission_id !== "string") return null
  return {
    claim_id: redactText(value.claim_id),
    mission_id: redactText(value.mission_id),
    executor_id: redactText(readString(value.executor_id, "unknown")),
    status: redactText(readString(value.status, "unknown")),
    claimed_at: typeof value.claimed_at === "string" ? redactText(value.claimed_at) : undefined,
    released_at: typeof value.released_at === "string" ? redactText(value.released_at) : undefined,
    release_reason: typeof value.release_reason === "string" ? redactText(value.release_reason) : undefined,
  }
}

function readRawStringField(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : undefined
}

function readMissionProgress(value: unknown): MissionProgressSummary | null {
  if (!isRecord(value) || typeof value.progress_id !== "string" || typeof value.mission_id !== "string" || typeof value.claim_id !== "string") return null
  return {
    progress_id: redactText(value.progress_id),
    mission_id: redactText(value.mission_id),
    claim_id: redactText(value.claim_id),
    message: preview(readString(value.message, "")),
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : undefined,
  }
}

function readMissionResult(value: unknown): MissionResultSummary | null {
  if (!isRecord(value) || typeof value.result_id !== "string" || typeof value.mission_id !== "string" || typeof value.claim_id !== "string") return null
  return {
    result_id: redactText(value.result_id),
    mission_id: redactText(value.mission_id),
    claim_id: redactText(value.claim_id),
    summary: preview(readString(value.summary, "")),
    status: redactText(readString(value.status, "unknown")),
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : undefined,
  }
}

function readResearchTopic(value: unknown): ResearchTopicSummary | null {
  if (!isRecord(value) || typeof value.id !== "string") return null
  return {
    id: redactText(value.id),
    title: readString(value.title, "untitled"),
    status: readString(value.status, "unknown"),
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : undefined,
    updated_at: typeof value.updated_at === "string" ? redactText(value.updated_at) : undefined,
  }
}

function readResearchNote(value: unknown): ResearchNoteSummary | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.topic_id !== "string") return null
  return {
    id: redactText(value.id),
    topic_id: redactText(value.topic_id),
    source_id: typeof value.source_id === "string" ? redactText(value.source_id) : undefined,
    content: preview(readString(value.content, "")),
    tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === "string").map(redactText).slice(0, 6) : [],
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : undefined,
  }
}

function readResearchEvent(value: unknown): ResearchEventSummary | null {
  if (
    !isRecord(value) ||
    typeof value.event_id !== "string" ||
    typeof value.event_type !== "string" ||
    typeof value.entity_type !== "string" ||
    typeof value.entity_id !== "string"
  ) return null
  return {
    event_id: redactText(value.event_id),
    event_type: redactText(value.event_type),
    entity_type: redactText(value.entity_type),
    entity_id: redactText(value.entity_id),
    created_at: typeof value.created_at === "string" ? redactText(value.created_at) : undefined,
  }
}

function readTopicSnapshot(value: unknown): ResearchTopicSnapshotSummary | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) throw new Error("research.get_topic_snapshot returned non-object result")
  const topic = readResearchTopic(value.topic)
  if (!topic) return null
  const stats = isRecord(value.stats) ? value.stats : {}
  return {
    topic,
    stats: {
      source_count: readNumber(stats.source_count, 0),
      note_count: readNumber(stats.note_count, 0),
      artifact_count: readNumber(stats.artifact_count, 0),
      report_count: readNumber(stats.report_count, 0),
      reviewed_source_count: readNumber(stats.reviewed_source_count, 0),
      rejected_source_count: readNumber(stats.rejected_source_count, 0),
    },
    latest_event: readResearchEvent(value.latest_event) ?? undefined,
  }
}

function researchState(state: UiState): ResearchRecordsState {
  return state.research ?? { topics: [], selectedTopic: null, notes: [], events: [] }
}

function commandAuthorityState(state: UiState): CommandAuthorityState {
  return state.commandAuthority ?? { summary: null, records: [], selected: null, validationProfile: null }
}

function reviewsState(state: UiState): ReviewsState {
  return state.reviews ?? { pending: [], recent: [] }
}

function proposalsState(state: UiState): ProposalsState {
  return state.proposals ?? { recent: [] }
}

function proposalBundlesState(state: UiState): ProposalBundlesState {
  return state.proposalBundles ?? { recent: [] }
}

function commanderPlaybooksState(state: UiState): CommanderPlaybooksState {
  return state.commanderPlaybooks ?? { catalog: [], selectedPlaybook: null, lastDraft: null }
}

function commanderWorkbenchState(state: UiState): CommanderWorkbenchState {
  return state.commanderWorkbench ?? { drafts: [], selectedDraft: null, readiness: null }
}

function commanderApplyState(state: UiState): CommanderApplyState {
  return state.commanderApply ?? { preview: null, lastResult: null }
}

function commanderAuditState(state: UiState): CommanderAuditState {
  return state.commanderAudit ?? { timeline: [], selectedChain: null }
}

function commanderQueuesState(state: UiState): CommanderQueuesState {
  return state.commanderQueues ?? { selectedQueue: "needs_review", items: [] }
}

function commanderNavigationState(state: UiState): CommanderNavigationState {
  return state.commanderNavigation ?? { selected: null }
}

function operatorActionsState(state: UiState): OperatorActionsState {
  return state.operatorActions ?? { staged: null, lastResult: null }
}

function externalApiState(state: UiState): ExternalApiState {
  return state.externalApi ?? { connectors: [], selectedConnector: null, preview: null, lastResult: null, audit: [] }
}

function externalApiResearchState(state: UiState): ExternalApiResearchState {
  return state.externalApi?.research ?? { preview: null, lastResult: null, ingestions: [] }
}

function researchSynthesisState(state: UiState): ResearchSynthesisState {
  return state.researchSynthesis ?? { preview: null, selected: null, recent: [] }
}

function commanderCycleState(state: UiState): CommanderCycleState {
  return state.commanderCycle ?? { preview: null, selected: null, recent: [] }
}

function opencodeHandoffState(state: UiState): OpenCodeHandoffState {
  return state.opencodeHandoff ?? { preview: null, lastResult: null, recent: [] }
}

function opencodeProcessSmokeState(state: UiState): OpenCodeProcessSmokeState {
  return state.opencodeProcessSmoke ?? { preview: null, latestResult: null, records: [], selected: null }
}

function opencodeHandoffReadinessState(state: UiState): OpenCodeHandoffReadinessState {
  return state.opencodeHandoffReadiness ?? { preview: null, summary: null }
}

function opencodeResultReviewState(state: UiState): OpenCodeResultReviewState {
  return state.opencodeResultReview ?? { packet: null, summary: null, records: [] }
}

function opencodeSessionsState(state: UiState): OpenCodeSessionsState {
  return state.opencodeSessions ?? { preview: null, latestPlan: null, records: [], selected: null, summary: null }
}

function contextBudgetsState(state: UiState): ContextBudgetsState {
  return state.contextBudgets ?? { capabilities: [], selectedCapability: null, preview: null, summary: null }
}

function contextPacketsState(state: UiState): ContextPacketsState {
  return state.contextPackets ?? { preview: null, summary: null }
}

function opencodeSessionInstructionPacksState(state: UiState): OpenCodeSessionInstructionPacksState {
  return state.opencodeSessionInstructionPacks ?? { preview: null, latestResult: null, records: [], selected: null }
}

function opencodeLaunchReadinessState(state: UiState): OpenCodeLaunchReadinessState {
  return state.opencodeLaunchReadiness ?? { preview: null, summary: null }
}

function opencodeLaunchesState(state: UiState): OpenCodeLaunchesState {
  return state.opencodeLaunches ?? { preview: null, latestResult: null, records: [], selected: null }
}

function opencodeProgressState(state: UiState): OpenCodeProgressState {
  return state.opencodeProgress ?? { preview: null, latestResult: null, records: [], selected: null, latest: null, summary: null }
}

function opencodeWatchdogState(state: UiState): OpenCodeWatchdogState {
  return state.opencodeWatchdog ?? { preview: null, latestResult: null, forcedReportResult: null, records: [], forcedReportRequests: [], selected: null, selectedRequest: null, summary: null }
}

function opencodeCommanderQuestionState(state: UiState): OpenCodeCommanderQuestionsState {
  return state.opencodeCommanderQuestions ?? { preview: null, latestResult: null, records: [], selected: null, latest: null, summary: null }
}

function progressPayload(effect: Extract<RuntimeUiEffect, { type: "preview-opencode-progress" | "record-opencode-progress" }>): Record<string, unknown> {
  return {
    sessionId: effect.sessionId,
    launchId: effect.launchId,
    kind: effect.kind,
    executionState: effect.executionState,
    reportSummary: effect.reportSummary,
    currentStep: effect.currentStep,
    filesTouched: effect.filesTouched,
    commandsRun: effect.commandsRun,
    testsRun: effect.testsRun,
    artifacts: effect.artifacts,
    blockers: effect.blockers,
    question: effect.question,
    confidence: effect.confidence,
    nextAction: effect.nextAction,
    sourceKind: effect.sourceKind,
  }
}

function watchdogPayload(effect: Extract<RuntimeUiEffect, { type: "preview-opencode-watchdog" | "record-opencode-watchdog" }>): Record<string, unknown> {
  return {
    sessionId: effect.sessionId,
    launchId: effect.launchId,
    maxWallTimeMs: effect.maxWallTimeMs,
    maxNoProgressMs: effect.maxNoProgressMs,
    heartbeatIntervalMs: effect.heartbeatIntervalMs,
  }
}

function commanderQuestionPayload(effect: Extract<RuntimeUiEffect, { type: "preview-opencode-commander-question" | "create-opencode-commander-question" }>): Record<string, unknown> {
  return {
    sessionId: effect.sessionId,
    launchId: effect.launchId,
    progressId: effect.progressId,
    watchdogId: effect.watchdogId,
    forcedReportRequestId: effect.forcedReportRequestId,
    question: effect.question,
    questionType: effect.questionType,
    urgency: effect.urgency,
    contextSummary: effect.contextSummary,
    optionsConsidered: effect.optionsConsidered,
    executorRecommendation: effect.executorRecommendation,
    sourceKind: effect.sourceKind,
  }
}

function researchMemoryState(state: UiState): ResearchMemoryState {
  return state.researchMemory ?? { summary: null, retrievalPreview: null, noveltyPreview: null }
}

function commanderExecutorReviewState(state: UiState): CommanderExecutorReviewState {
  return state.commanderExecutorReview ?? { preview: null, latestResult: null, records: [], selected: null }
}

function executorReviewProposalDraftState(state: UiState): ExecutorReviewProposalDraftState {
  return state.executorReviewProposalDrafts ?? { preview: null, summary: null }
}

function executorReviewProposalCreateState(state: UiState): ExecutorReviewProposalCreateState {
  return state.executorReviewProposalCreate ?? { preview: null, latestResult: null, records: [], selected: null }
}

function executorReviewProposalReviewRequestState(state: UiState): ExecutorReviewProposalReviewRequestState {
  return state.executorReviewProposalReviewRequest ?? { preview: null, latestResult: null, records: [], selected: null }
}

function executorReviewProposalReviewDecisionState(state: UiState): ExecutorReviewProposalReviewDecisionState {
  return state.executorReviewProposalReviewDecision ?? { preview: null, latestResult: null, records: [], selected: null }
}

function executorReviewProposalApplyReadinessState(state: UiState): ExecutorReviewProposalApplyReadinessState {
  return state.executorReviewProposalApplyReadiness ?? { preview: null, summary: null, records: [], selected: null }
}

function executorReviewProposalNarrowApplyState(state: UiState): ExecutorReviewProposalNarrowApplyState {
  return state.executorReviewProposalNarrowApply ?? { preview: null, latestResult: null, records: [], selected: null }
}

function opencodeFollowupState(state: UiState): OpenCodeHandoffFollowupState {
  return state.opencodeFollowup ?? { selected: null, summary: null, queueItems: [] }
}

function runtimeCheckpointsState(state: UiState): RuntimeCheckpointsState {
  return state.runtimeCheckpoints ?? { preview: null, selected: null, recent: [] }
}

function runtimeRestoreState(state: UiState): RuntimeRestoreState {
  return state.runtimeRestore ?? { preview: null, selectedAnchor: null, recentAnchors: [] }
}

function wakeAssessmentState(state: UiState): WakeAssessmentState {
  return state.wakeAssessment ?? { preview: null, selected: null, recent: [] }
}

function continuationState(state: UiState): ContinuationState {
  return state.continuation ?? { preview: null, selected: null, lastStepResult: null, recent: [] }
}

function wakeSchedulesState(state: UiState): WakeSchedulesState {
  return state.wakeSchedules ?? { preview: null, selected: null, recent: [], tickPreview: null, lastTick: null, recentTicks: [] }
}

function wakeSchedulerState(state: UiState): WakeSchedulerUiState {
  const scheduler: Partial<WakeSchedulerUiState> = state.wakeScheduler ?? {}
  return {
    preview: scheduler.preview ?? null,
    status: scheduler.status ?? null,
    bootstrapStatus: scheduler.bootstrapStatus ?? null,
    bootstrapPreview: scheduler.bootstrapPreview ?? null,
    recoveryPreview: scheduler.recoveryPreview ?? null,
    selectedRecovery: scheduler.selectedRecovery ?? null,
    recoveries: scheduler.recoveries ?? [],
    recoveryWorkflowPreview: scheduler.recoveryWorkflowPreview ?? null,
    selectedRecoveryWorkflow: scheduler.selectedRecoveryWorkflow ?? null,
    recoveryWorkflowVerification: scheduler.recoveryWorkflowVerification ?? null,
    recoveryWorkflows: scheduler.recoveryWorkflows ?? [],
    auditSummary: scheduler.auditSummary ?? null,
    auditTimeline: scheduler.auditTimeline ?? [],
    selectedAuditChain: scheduler.selectedAuditChain ?? null,
    auditIncidents: scheduler.auditIncidents ?? [],
    navigationBoard: scheduler.navigationBoard ?? null,
    navigationCommandPreview: scheduler.navigationCommandPreview ?? null,
    navigationTarget: scheduler.navigationTarget ?? null,
    navigationStagePreview: scheduler.navigationStagePreview ?? null,
    stagedNavigationCommands: scheduler.stagedNavigationCommands ?? [],
    selectedStagedNavigationCommand: scheduler.selectedStagedNavigationCommand ?? null,
    stagedReadPreview: scheduler.stagedReadPreview ?? null,
    latestStagedReadResult: scheduler.latestStagedReadResult ?? null,
    stagedReadRuns: scheduler.stagedReadRuns ?? [],
    stagedReadHistory: scheduler.stagedReadHistory ?? null,
    stagedReadComparison: scheduler.stagedReadComparison ?? null,
    stagedReadStaleItems: scheduler.stagedReadStaleItems ?? [],
    selectedStagedReadGroup: scheduler.selectedStagedReadGroup ?? null,
    writePreview: scheduler.writePreview ?? null,
    writeBoard: scheduler.writeBoard ?? null,
    writeStagePreview: scheduler.writeStagePreview ?? null,
    selectedStagedWriteCommand: scheduler.selectedStagedWriteCommand ?? null,
    stagedWriteCommands: scheduler.stagedWriteCommands ?? [],
    writeRunPreview: scheduler.writeRunPreview ?? null,
    latestWriteRunResult: scheduler.latestWriteRunResult ?? null,
    writeRunRecords: scheduler.writeRunRecords ?? [],
    writeRunHistory: scheduler.writeRunHistory ?? null,
    writeRunComparison: scheduler.writeRunComparison ?? null,
    writeRunStaleItems: scheduler.writeRunStaleItems ?? [],
    selectedWriteRunGroup: scheduler.selectedWriteRunGroup ?? null,
    writeReadinessPreview: scheduler.writeReadinessPreview ?? null,
    selectedWriteApproval: scheduler.selectedWriteApproval ?? null,
    writeApprovalRecords: scheduler.writeApprovalRecords ?? [],
    checkpointWriteRunPreview: scheduler.checkpointWriteRunPreview ?? null,
    latestCheckpointWriteRunResult: scheduler.latestCheckpointWriteRunResult ?? null,
    checkpointWriteRunRecords: scheduler.checkpointWriteRunRecords ?? [],
    checkpointWriteHistory: scheduler.checkpointWriteHistory ?? null,
    checkpointWriteComparison: scheduler.checkpointWriteComparison ?? null,
    checkpointWriteStaleItems: scheduler.checkpointWriteStaleItems ?? [],
    selectedCheckpointWriteGroup: scheduler.selectedCheckpointWriteGroup ?? null,
    checkpointApprovalUsage: scheduler.checkpointApprovalUsage ?? null,
    events: scheduler.events ?? [],
    commandError: scheduler.commandError,
  }
}

function reasoningProviderState(state: UiState) {
  return state.reasoningProvider ?? {
    kind: "fake",
    provider_id: "unknown",
    max_input_bytes: 0,
    max_output_bytes: 0,
    enabled_for: [],
  }
}

function minimaxLiveValidationState(state: UiState): MiniMaxLiveValidationState {
  return state.minimaxLiveValidation ?? { records: [] }
}

function missionExecutionState(state: UiState): MissionExecutionState {
  return state.missionExecution ?? { claims: [], progress: [], results: [] }
}

function selectedMissionForTarget(state: UiState, selectedMissionId: string): MissionRecord | null {
  return state.missionExecution?.selectedMission?.mission_id === selectedMissionId
    ? state.missionExecution.selectedMission
    : null
}

function completeMissionEffect(args: string[]): Extract<RuntimeUiEffect, { type: "complete-mission" }> {
  const missionId = requiredMissionIdArg(args, 0)
  const second = args[1]
  if (!second) return { type: "complete-mission", missionId }
  if (second === "--result") {
    return { type: "complete-mission", missionId, resultId: requiredArg(args, 2, "resultId"), summary: optionalRest(args, 3) }
  }
  if (second.startsWith("--result=")) {
    const resultId = second.slice("--result=".length).trim()
    if (!resultId) throw new Error("resultId is required")
    return { type: "complete-mission", missionId, resultId, summary: optionalRest(args, 2) }
  }
  return { type: "complete-mission", missionId, summary: requiredRest(args, 1, "summary") }
}

function requestReviewEffect(args: string[]): Extract<RuntimeUiEffect, { type: "create-review-request" }> {
  const missionId = requiredArg(args, 0, "missionId")
  const separator = args.indexOf("--")
  if (separator < 2) throw new Error("-- separator is required between review title and summary")
  const title = args.slice(1, separator).join(" ").trim()
  const summary = args.slice(separator + 1).join(" ").trim()
  if (!title) throw new Error("title is required")
  if (!summary) throw new Error("summary is required")
  return { type: "create-review-request", missionId, title, summary }
}

function proposalReviewEffect(args: string[]): Extract<RuntimeUiEffect, { type: "request-proposal-review" }> {
  const proposalId = requiredArg(args, 0, "proposalId")
  const separator = args.indexOf("--")
  if (separator < 2) throw new Error("-- separator is required between proposal review title and summary")
  const title = args.slice(1, separator).join(" ").trim()
  const summary = args.slice(separator + 1).join(" ").trim()
  if (!title) throw new Error("title is required")
  if (!summary) throw new Error("summary is required")
  return { type: "request-proposal-review", proposalId, title, summary }
}

function proposeProgressEffect(args: string[]): Extract<RuntimeUiEffect, { type: "create-proposal" }> {
  const missionId = requiredArg(args, 0, "missionId")
  const claimId = requiredArg(args, 1, "claimId")
  const separator = args.indexOf("--")
  if (separator < 3) throw new Error("-- separator is required between proposal title and message")
  const title = args.slice(2, separator).join(" ").trim()
  const message = args.slice(separator + 1).join(" ").trim()
  if (!title) throw new Error("title is required")
  if (!message) throw new Error("message is required")
  return { type: "create-proposal", actionKind: "record_progress", missionId, claimId, title, summary: message, actionPayload: { mission_id: missionId, claim_id: claimId, message } }
}

function proposeResultEffect(args: string[]): Extract<RuntimeUiEffect, { type: "create-proposal" }> {
  const missionId = requiredArg(args, 0, "missionId")
  const claimId = requiredArg(args, 1, "claimId")
  const separator = args.indexOf("--")
  if (separator < 3) throw new Error("-- separator is required between proposal title and summary")
  const title = args.slice(2, separator).join(" ").trim()
  const summary = args.slice(separator + 1).join(" ").trim()
  if (!title) throw new Error("title is required")
  if (!summary) throw new Error("summary is required")
  return { type: "create-proposal", actionKind: "submit_result", missionId, claimId, title, summary, actionPayload: { mission_id: missionId, claim_id: claimId, summary } }
}

function proposeCompleteEffect(args: string[]): Extract<RuntimeUiEffect, { type: "create-proposal" }> {
  const missionId = requiredArg(args, 0, "missionId")
  const separator = args.indexOf("--")
  if (separator < 2) throw new Error("-- separator is required between proposal title and summary")
  const title = args.slice(1, separator).join(" ").trim()
  const summary = args.slice(separator + 1).join(" ").trim()
  if (!title) throw new Error("title is required")
  if (!summary) throw new Error("summary is required")
  return { type: "create-proposal", actionKind: "complete_mission", missionId, title, summary, actionPayload: { mission_id: missionId, summary } }
}

function proposeFailEffect(args: string[]): Extract<RuntimeUiEffect, { type: "create-proposal" }> {
  const missionId = requiredArg(args, 0, "missionId")
  const separator = args.indexOf("--")
  if (separator < 2) throw new Error("-- separator is required between proposal title and reason")
  const title = args.slice(1, separator).join(" ").trim()
  const reason = args.slice(separator + 1).join(" ").trim()
  if (!title) throw new Error("title is required")
  if (!reason) throw new Error("reason is required")
  return { type: "create-proposal", actionKind: "fail_mission", missionId, title, summary: reason, actionPayload: { mission_id: missionId, reason } }
}

function proposeCancelEffect(args: string[]): Extract<RuntimeUiEffect, { type: "create-proposal" }> {
  const missionId = requiredArg(args, 0, "missionId")
  const separator = args.indexOf("--")
  if (separator < 2) throw new Error("-- separator is required between proposal title and reason")
  const title = args.slice(1, separator).join(" ").trim()
  const reason = args.slice(separator + 1).join(" ").trim()
  if (!title) throw new Error("title is required")
  if (!reason) throw new Error("reason is required")
  return { type: "create-proposal", actionKind: "cancel_mission", missionId, title, summary: reason, actionPayload: { mission_id: missionId, reason } }
}

function proposeReleaseEffect(args: string[]): Extract<RuntimeUiEffect, { type: "create-proposal" }> {
  const claimId = requiredArg(args, 0, "claimId")
  const separator = args.indexOf("--")
  if (separator < 2) throw new Error("-- separator is required between proposal title and reason")
  const title = args.slice(1, separator).join(" ").trim()
  const reason = args.slice(separator + 1).join(" ").trim()
  if (!title) throw new Error("title is required")
  if (!reason) throw new Error("reason is required")
  return { type: "create-proposal", actionKind: "release_claim", claimId, title, summary: reason, actionPayload: { claim_id: claimId, reason } }
}

function createProposalBundleEffect(args: string[]): Extract<RuntimeUiEffect, { type: "create-proposal-bundle" }> {
  const separator = args.indexOf("--")
  if (separator < 1) throw new Error("-- separator is required between bundle title and summary")
  const title = args.slice(0, separator).join(" ").trim()
  const summary = args.slice(separator + 1).join(" ").trim()
  if (!title) throw new Error("title is required")
  if (!summary) throw new Error("summary is required")
  return { type: "create-proposal-bundle", title, summary }
}

function draftCompleteEffect(args: string[]): Extract<RuntimeUiEffect, { type: "draft-playbook" }> {
  const missionId = requiredArg(args, 0, "missionId")
  const resultId = requiredArg(args, 1, "resultId")
  const separator = args.indexOf("--")
  if (separator < 3) throw new Error("-- separator is required between draft title and summary")
  const title = args.slice(2, separator).join(" ").trim()
  const summary = args.slice(separator + 1).join(" ").trim()
  if (!title) throw new Error("title is required")
  if (!summary) throw new Error("summary is required")
  return { type: "draft-playbook", playbookId: "complete-from-result", fields: { mission_id: missionId, result_id: resultId, title, summary } }
}

function draftResultCompleteEffect(args: string[]): Extract<RuntimeUiEffect, { type: "draft-playbook" }> {
  const missionId = requiredArg(args, 0, "missionId")
  const claimId = requiredArg(args, 1, "claimId")
  const separator = args.indexOf("--")
  if (separator < 3) throw new Error("-- separator is required between draft title and summaries")
  const title = args.slice(2, separator).join(" ").trim()
  const summaryText = args.slice(separator + 1).join(" ").trim()
  const parts = summaryText.split(/\s+\|\|\s+/)
  const resultSummary = (parts[0] ?? "").trim()
  const completionSummary = parts.slice(1).join(" || ").trim()
  if (!title) throw new Error("title is required")
  if (!resultSummary) throw new Error("result_summary is required")
  if (!completionSummary) throw new Error("completion_summary is required")
  return {
    type: "draft-playbook",
    playbookId: "submit-result-and-complete",
    fields: { mission_id: missionId, claim_id: claimId, title, result_summary: resultSummary, completion_summary: completionSummary },
  }
}

function draftProgressEffect(args: string[]): Extract<RuntimeUiEffect, { type: "draft-playbook" }> {
  const missionId = requiredArg(args, 0, "missionId")
  const claimId = requiredArg(args, 1, "claimId")
  const separator = args.indexOf("--")
  if (separator < 3) throw new Error("-- separator is required between draft title and message")
  const title = args.slice(2, separator).join(" ").trim()
  const message = args.slice(separator + 1).join(" ").trim()
  if (!title) throw new Error("title is required")
  if (!message) throw new Error("message is required")
  return { type: "draft-playbook", playbookId: "record-progress", fields: { mission_id: missionId, claim_id: claimId, title, message } }
}

function draftFailEffect(args: string[]): Extract<RuntimeUiEffect, { type: "draft-playbook" }> {
  return draftReasonPlaybookEffect(args, "fail-mission")
}

function draftCancelEffect(args: string[]): Extract<RuntimeUiEffect, { type: "draft-playbook" }> {
  return draftReasonPlaybookEffect(args, "cancel-mission")
}

function draftReleaseEffect(args: string[]): Extract<RuntimeUiEffect, { type: "draft-playbook" }> {
  const claimId = requiredArg(args, 0, "claimId")
  const separator = args.indexOf("--")
  if (separator < 2) throw new Error("-- separator is required between draft title and reason")
  const title = args.slice(1, separator).join(" ").trim()
  const reason = args.slice(separator + 1).join(" ").trim()
  if (!title) throw new Error("title is required")
  if (!reason) throw new Error("reason is required")
  return { type: "draft-playbook", playbookId: "release-claim", fields: { claim_id: claimId, title, reason } }
}

function draftReasonPlaybookEffect(args: string[], playbookId: "fail-mission" | "cancel-mission"): Extract<RuntimeUiEffect, { type: "draft-playbook" }> {
  const missionId = requiredArg(args, 0, "missionId")
  const separator = args.indexOf("--")
  if (separator < 2) throw new Error("-- separator is required between draft title and reason")
  const title = args.slice(1, separator).join(" ").trim()
  const reason = args.slice(separator + 1).join(" ").trim()
  if (!title) throw new Error("title is required")
  if (!reason) throw new Error("reason is required")
  return { type: "draft-playbook", playbookId, fields: { mission_id: missionId, title, reason } }
}

function commanderApplyEffect(args: string[], apply: boolean): Extract<RuntimeUiEffect, { type: "commander-apply-preview" | "commander-apply-target" }> {
  const targetType = requiredArg(args, 0, "targetType")
  if (targetType !== "proposal" && targetType !== "bundle" && targetType !== "draft") throw new Error("targetType must be proposal, bundle, or draft")
  const targetId = requiredArg(args, 1, "targetId")
  return apply
    ? { type: "commander-apply-target", targetType, targetId }
    : { type: "commander-apply-preview", targetType, targetId }
}

function commanderApplyPartialEffect(args: string[]): Extract<RuntimeUiEffect, { type: "commander-apply-target" }> {
  const effect = commanderApplyEffect(args, true)
  if (effect.type !== "commander-apply-target") throw new Error("apply target is required")
  if (effect.targetType === "proposal") throw new Error("partial apply target must be bundle or draft")
  return { ...effect, allowPartial: true }
}

function auditChainEffect(args: string[]): Extract<RuntimeUiEffect, { type: "load-commander-authority-chain" }> {
  return {
    type: "load-commander-authority-chain",
    targetType: requiredArg(args, 0, "targetType"),
    targetId: requiredArg(args, 1, "targetId"),
  }
}

function schedulerAuditTimelineArgs(args: string[]): { limit?: number; kind?: string; severity?: string; relatedId?: string } {
  const out: { limit?: number; kind?: string; severity?: string; relatedId?: string } = {}
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("scheduler audit timeline args must use key=value")
    if (key === "limit") out.limit = readPositiveInteger(value, "limit", CHECKPOINT_LIMIT)
    else if (key === "kind") out.kind = value
    else if (key === "severity") out.severity = value
    else if (key === "related") out.relatedId = value
    else throw new Error("scheduler audit timeline arg is invalid")
  }
  return out
}

function schedulerNavigationArgs(args: string[]): { relatedId?: string; incidentId?: string; auditId?: string; includeWrite?: boolean; limit?: number } {
  const out: { relatedId?: string; incidentId?: string; auditId?: string; includeWrite?: boolean; limit?: number } = {}
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("scheduler navigation args must use key=value")
    if (key === "related") out.relatedId = value
    else if (key === "incident") out.incidentId = value
    else if (key === "audit") out.auditId = value
    else if (key === "limit") out.limit = readPositiveInteger(value, "limit", CHECKPOINT_LIMIT)
    else if (key === "include_write") out.includeWrite = value !== "0" && value !== "false"
    else throw new Error("scheduler navigation arg is invalid")
  }
  return out
}

function schedulerNavReadHistoryArgs(args: string[]): { stagedId?: string; command?: string; limit?: number; staleAfterMs?: number } {
  const out: { stagedId?: string; command?: string; limit?: number; staleAfterMs?: number } = {}
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("scheduler navigation read history args must use key=value")
    if (key === "staged") out.stagedId = value
    else if (key === "command") out.command = value
    else if (key === "limit") out.limit = readPositiveInteger(value, "limit", CHECKPOINT_LIMIT)
    else if (key === "after") out.staleAfterMs = readDurationArg(value)
    else throw new Error("scheduler navigation read history arg is invalid")
  }
  return out
}

function schedulerNavReadStaleArgs(args: string[]): { staleAfterMs?: number; limit?: number } {
  const out: { staleAfterMs?: number; limit?: number } = {}
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("scheduler navigation read stale args must use key=value")
    if (key === "after") out.staleAfterMs = readDurationArg(value)
    else if (key === "limit") out.limit = readPositiveInteger(value, "limit", CHECKPOINT_LIMIT)
    else throw new Error("scheduler navigation read stale arg is invalid")
  }
  return out
}

function schedulerNavWriteRunHistoryArgs(args: string[]): { stagedWriteId?: string; command?: string; limit?: number; staleAfterMs?: number } {
  const out: { stagedWriteId?: string; command?: string; limit?: number; staleAfterMs?: number } = {}
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("scheduler navigation write-run history args must use key=value")
    if (key === "staged") out.stagedWriteId = value
    else if (key === "command") out.command = value
    else if (key === "limit") out.limit = readPositiveInteger(value, "limit", CHECKPOINT_LIMIT)
    else if (key === "after") out.staleAfterMs = readDurationArg(value)
    else throw new Error("scheduler navigation write-run history arg is invalid")
  }
  return out
}

function schedulerNavWriteRunStaleArgs(args: string[]): { staleAfterMs?: number; limit?: number } {
  const out: { staleAfterMs?: number; limit?: number } = {}
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("scheduler navigation write-run stale args must use key=value")
    if (key === "after") out.staleAfterMs = readDurationArg(value)
    else if (key === "limit") out.limit = readPositiveInteger(value, "limit", CHECKPOINT_LIMIT)
    else throw new Error("scheduler navigation write-run stale arg is invalid")
  }
  return out
}

function schedulerNavCheckpointHistoryArgs(args: string[]): { stagedWriteId?: string; approvalId?: string; command?: string; limit?: number; staleAfterMs?: number } {
  const out: { stagedWriteId?: string; approvalId?: string; command?: string; limit?: number; staleAfterMs?: number } = {}
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("scheduler checkpoint history args must use key=value")
    if (key === "staged") out.stagedWriteId = value
    else if (key === "approval") out.approvalId = value
    else if (key === "command") out.command = value
    else if (key === "limit") out.limit = readPositiveInteger(value, "limit", CHECKPOINT_LIMIT)
    else if (key === "after") out.staleAfterMs = readDurationArg(value)
    else throw new Error("scheduler checkpoint history arg is invalid")
  }
  return out
}

function schedulerNavCheckpointStaleArgs(args: string[]): { staleAfterMs?: number; limit?: number } {
  const out: { staleAfterMs?: number; limit?: number } = {}
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("scheduler checkpoint stale args must use key=value")
    if (key === "after") out.staleAfterMs = readDurationArg(value)
    else if (key === "limit") out.limit = readPositiveInteger(value, "limit", CHECKPOINT_LIMIT)
    else throw new Error("scheduler checkpoint stale arg is invalid")
  }
  return out
}

function schedulerNavCheckpointApprovalUsageArgs(args: string[]): { approvalId?: string; stagedWriteId?: string; limit?: number; staleAfterMs?: number } {
  const out: { approvalId?: string; stagedWriteId?: string; limit?: number; staleAfterMs?: number } = {}
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("scheduler checkpoint approval usage args must use key=value")
    if (key === "approval") out.approvalId = value
    else if (key === "staged") out.stagedWriteId = value
    else if (key === "limit") out.limit = readPositiveInteger(value, "limit", CHECKPOINT_LIMIT)
    else if (key === "after") out.staleAfterMs = readDurationArg(value)
    else throw new Error("scheduler checkpoint approval usage arg is invalid")
  }
  return out
}

function authorityListArgs(args: string[]): { risk?: string; gate?: string; owner?: string; limit?: number } {
  const out: { risk?: string; gate?: string; owner?: string; limit?: number } = {}
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("authority list args must use key=value")
    if (key === "risk") out.risk = value
    else if (key === "gate") out.gate = value
    else if (key === "owner") out.owner = value
    else if (key === "limit") out.limit = readPositiveInteger(value, "limit", 100)
    else throw new Error("authority list arg is invalid")
  }
  return out
}

function schedulerNavWriteBoardArgs(args: string[]): { relatedId?: string; incidentId?: string; stagedId?: string; includeHighImpact?: boolean; limit?: number } {
  const out: { relatedId?: string; incidentId?: string; stagedId?: string; includeHighImpact?: boolean; limit?: number } = {}
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("scheduler navigation write board args must use key=value")
    if (key === "related") out.relatedId = value
    else if (key === "incident") out.incidentId = value
    else if (key === "staged") out.stagedId = value
    else if (key === "include_high_impact") out.includeHighImpact = value !== "0" && value !== "false"
    else if (key === "limit") out.limit = readPositiveInteger(value, "limit", CHECKPOINT_LIMIT)
    else throw new Error("scheduler navigation write board arg is invalid")
  }
  return out
}

function readDurationArg(value: string): number {
  if (/^\d+$/.test(value)) return readPositiveInteger(value, "duration", 24 * 60 * 60 * 1000)
  const match = value.match(/^(\d+)(s|m|h|d)$/)
  if (!match) throw new Error("duration must be milliseconds or one of 60s, 5m, 1h, 1d")
  const amount = Number(match[1])
  const unit = match[2]
  const scale = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000
  return amount * scale
}

function requiredQueueKindArg(args: string[], index: number): CommanderQueueKind {
  return readQueueKind(requiredArg(args, index, "queue"))
}

function targetContextEffect(args: string[], index: number): Extract<RuntimeUiEffect, { type: "load-commander-target-context" }> {
  return {
    type: "load-commander-target-context",
    targetType: readTargetType(requiredArg(args, index, "targetType")),
    targetId: requiredArg(args, index + 1, "targetId"),
  }
}

function targetContextAliasEffect(targetType: CommanderTargetType, args: string[]): Extract<RuntimeUiEffect, { type: "load-commander-target-context" }> {
  return {
    type: "load-commander-target-context",
    targetType,
    targetId: requiredArg(args, 0, "targetId"),
  }
}

function externalApiRequestEffect(type: "preview-external-api-request" | "execute-external-api-request", args: string[]): Extract<RuntimeUiEffect, { type: "preview-external-api-request" | "execute-external-api-request" }> {
  const connectorId = requiredArg(args, 0, "connectorId")
  const method = requiredArg(args, 1, "method").toUpperCase()
  if (method !== "GET" && method !== "POST") throw new Error("method must be GET or POST")
  const path = requiredArg(args, 2, "path")
  const query = queryArgs(args.slice(3))
  return { type, connectorId, method, path, ...(Object.keys(query).length > 0 ? { query } : {}) }
}

function externalApiExecuteEffect(args: string[]): Extract<RuntimeUiEffect, { type: "execute-external-api-request" }> {
  const effect = externalApiRequestEffect("execute-external-api-request", args)
  if (effect.type !== "execute-external-api-request") throw new Error("external API execute effect is required")
  return effect
}

function externalApiResearchIngestionEffect(type: "preview-external-api-research-ingestion" | "execute-external-api-research-ingestion", args: string[]): Extract<RuntimeUiEffect, { type: "preview-external-api-research-ingestion" | "execute-external-api-research-ingestion" }> {
  const connectorId = requiredArg(args, 0, "connectorId")
  const method = requiredArg(args, 1, "method").toUpperCase()
  if (method !== "GET" && method !== "POST") throw new Error("method must be GET or POST")
  const path = requiredArg(args, 2, "path")
  const options = ingestionArgs(args.slice(3))
  if (!options.topicId) throw new Error("topic is required")
  if (!options.sourceTitle) throw new Error("source is required")
  return {
    type,
    connectorId,
    method,
    path,
    topicId: options.topicId,
    sourceTitle: options.sourceTitle,
    noteTitle: options.noteTitle,
    ...(Object.keys(options.query).length > 0 ? { query: options.query } : {}),
    ...(options.tags.length > 0 ? { tags: options.tags } : {}),
  }
}

function externalApiResearchExecuteIngestionEffect(args: string[]): Extract<RuntimeUiEffect, { type: "execute-external-api-research-ingestion" }> {
  const effect = externalApiResearchIngestionEffect("execute-external-api-research-ingestion", args)
  if (effect.type !== "execute-external-api-research-ingestion") throw new Error("external API research ingestion execute effect is required")
  return effect
}

function synthesisEffect(type: "preview-research-synthesis" | "execute-research-synthesis", args: string[]): Extract<RuntimeUiEffect, { type: "preview-research-synthesis" | "execute-research-synthesis" }> {
  const topicId = requiredArg(args, 0, "topicId")
  const objective = optionalRest(args, 1)
  return { type, topicId, ...(objective ? { objective } : {}) }
}

function commanderCycleEffect(type: "preview-commander-cycle" | "execute-commander-cycle", args: string[]): Extract<RuntimeUiEffect, { type: "preview-commander-cycle" | "execute-commander-cycle" }> {
  const parsed = cycleArgs(args)
  return { type, ...parsed }
}

function handoffReadinessEffect(args: string[]): Extract<RuntimeUiEffect, { type: "preview-opencode-handoff-readiness" }> {
  const effect: Extract<RuntimeUiEffect, { type: "preview-opencode-handoff-readiness" }> = { type: "preview-opencode-handoff-readiness" }
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("handoff readiness args must use proposal=<id>, review=<id>, mission=<id>, or handoff=<id>")
    if (key === "proposal") effect.proposalId = value
    else if (key === "review") effect.reviewId = value
    else if (key === "mission") effect.missionId = value
    else if (key === "handoff") effect.handoffId = value
    else throw new Error("handoff readiness arg is unsupported")
  }
  return effect
}

function resultReviewPacketEffect(args: string[]): Extract<RuntimeUiEffect, { type: "preview-opencode-result-review-packet" }> {
  const effect: Extract<RuntimeUiEffect, { type: "preview-opencode-result-review-packet" }> = { type: "preview-opencode-result-review-packet" }
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("result review packet args must use handoff=<id>, followup=<id>, mission=<id>, result=<id>, or proposal=<id>")
    if (key === "handoff") effect.handoffId = value
    else if (key === "followup") effect.followupId = value
    else if (key === "mission") effect.missionId = value
    else if (key === "result") effect.resultId = value
    else if (key === "proposal") effect.proposalId = value
    else throw new Error("result review packet arg is unsupported")
  }
  return effect
}

function commanderExecutorReviewEffect(
  type: "preview-commander-executor-review" | "execute-commander-executor-review",
  args: string[],
): Extract<RuntimeUiEffect, { type: "preview-commander-executor-review" | "execute-commander-executor-review" }> {
  const effect: Extract<RuntimeUiEffect, { type: "preview-commander-executor-review" | "execute-commander-executor-review" }> = { type }
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("executor review args must use handoff=<id>, followup=<id>, mission=<id>, result=<id>, or proposal=<id>")
    if (key === "handoff") effect.handoffId = value
    else if (key === "followup") effect.followupId = value
    else if (key === "mission") effect.missionId = value
    else if (key === "result") effect.resultId = value
    else if (key === "proposal") effect.proposalId = value
    else throw new Error("executor review arg is unsupported")
  }
  return effect
}

function executorReviewProposalDraftEffect(args: string[]): Extract<RuntimeUiEffect, { type: "preview-executor-review-proposal-drafts" }> {
  const effect: Extract<RuntimeUiEffect, { type: "preview-executor-review-proposal-drafts" }> = { type: "preview-executor-review-proposal-drafts" }
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("executor review draft args must use review=<id>, packet=<id>, mission=<id>, result=<id>, handoff=<id>, or proposal=<id>")
    if (key === "review") effect.reviewId = value
    else if (key === "packet") effect.packetId = value
    else if (key === "mission") effect.missionId = value
    else if (key === "result") effect.resultId = value
    else if (key === "handoff") effect.handoffId = value
    else if (key === "proposal") effect.proposalId = value
    else if (key === "limit") effect.limit = readPositiveInteger(value, "limit", 100)
    else throw new Error("executor review draft arg is unsupported")
  }
  return effect
}

function executorReviewProposalCreateEffect(
  type: "preview-executor-review-proposal-create" | "create-executor-review-proposal",
  args: string[],
): Extract<RuntimeUiEffect, { type: "preview-executor-review-proposal-create" | "create-executor-review-proposal" }> {
  const effect: Extract<RuntimeUiEffect, { type: "preview-executor-review-proposal-create" | "create-executor-review-proposal" }> = { type, reviewId: "", draftId: "" }
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("executor review proposal create args must use review=<id> and draft=<id>")
    if (key === "review") effect.reviewId = value
    else if (key === "draft") effect.draftId = value
    else throw new Error("executor review proposal create arg is unsupported")
  }
  if (!effect.reviewId || !effect.draftId) throw new Error("executor review proposal create requires review=<id> and draft=<id>")
  return effect
}

function executorReviewProposalReviewRequestEffect(
  type: "preview-executor-review-proposal-review-request" | "request-executor-review-proposal-review",
  args: string[],
): Extract<RuntimeUiEffect, { type: "preview-executor-review-proposal-review-request" | "request-executor-review-proposal-review" }> {
  const effect: Extract<RuntimeUiEffect, { type: "preview-executor-review-proposal-review-request" | "request-executor-review-proposal-review" }> = { type, proposalId: "" }
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("executor review proposal review request args must use proposal=<id> and optional create=<id>")
    if (key === "proposal") effect.proposalId = value
    else if (key === "create") effect.createId = value
    else throw new Error("executor review proposal review request arg is unsupported")
  }
  if (!effect.proposalId) throw new Error("executor review proposal review request requires proposal=<id>")
  return effect
}

function executorReviewProposalReviewDecisionEffect(
  type: "preview-executor-review-proposal-review-decision" | "decide-executor-review-proposal-review",
  args: string[],
  enforcedDecision?: "approve" | "reject",
): Extract<RuntimeUiEffect, { type: "preview-executor-review-proposal-review-decision" | "decide-executor-review-proposal-review" }> {
  const effect: Extract<RuntimeUiEffect, { type: "preview-executor-review-proposal-review-decision" | "decide-executor-review-proposal-review" }> = { type, reviewRequestId: "", decision: enforcedDecision ?? "approve" }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("executor review proposal review decision args must use review=<id> decision=<approve|reject> optional reason=<reason> request=<id>")
    if (key === "review") effect.reviewRequestId = value
    else if (key === "decision") {
      if (value !== "approve" && value !== "reject") throw new Error("executor review proposal review decision must be approve or reject")
      if (enforcedDecision && value !== enforcedDecision) throw new Error(`executor review proposal review ${enforcedDecision} command cannot use decision=${value}`)
      effect.decision = value
    } else if (key === "reason") {
      effect.reason = [value, ...args.slice(index + 1)].join(" ").trim()
      break
    }
    else if (key === "request") effect.requestGateId = value
    else throw new Error("executor review proposal review decision arg is unsupported")
  }
  if (!effect.reviewRequestId) throw new Error("executor review proposal review decision requires review=<id>")
  if (type === "decide-executor-review-proposal-review" && effect.decision === "reject" && !effect.reason) throw new Error("executor review proposal review reject requires reason=<reason>")
  return effect
}

function executorReviewProposalApplyReadinessEffect(args: string[]): Extract<RuntimeUiEffect, { type: "preview-executor-review-proposal-apply-readiness" }> {
  const effect: Extract<RuntimeUiEffect, { type: "preview-executor-review-proposal-apply-readiness" }> = { type: "preview-executor-review-proposal-apply-readiness" }
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("executor review proposal apply readiness args must use proposal=<id>, review=<id>, decision=<id>, or create=<id>")
    if (key === "proposal") effect.proposalId = value
    else if (key === "review") effect.reviewRequestId = value
    else if (key === "decision") effect.decisionGateId = value
    else if (key === "create") effect.createId = value
    else throw new Error("executor review proposal apply readiness arg is unsupported")
  }
  return effect
}

function executorReviewProposalApplyReadinessListEffect(args: string[]): Extract<RuntimeUiEffect, { type: "load-executor-review-proposal-apply-readiness-list" }> {
  const effect: Extract<RuntimeUiEffect, { type: "load-executor-review-proposal-apply-readiness-list" }> = { type: "load-executor-review-proposal-apply-readiness-list", limit: HANDOFF_LIMIT }
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("executor review proposal apply readiness list args must use key=value")
    if (key === "status") effect.status = value
    else if (key === "kind") effect.candidateKind = value
    else if (key === "proposal") effect.proposalId = value
    else if (key === "limit") effect.limit = readPositiveInteger(value, "limit", HANDOFF_LIMIT)
    else throw new Error("executor review proposal apply readiness list arg is unsupported")
  }
  return effect
}

function executorReviewProposalNarrowApplyEffect(type: "preview-executor-review-proposal-narrow-apply" | "apply-executor-review-proposal-narrow", args: string[]): Extract<RuntimeUiEffect, { type: "preview-executor-review-proposal-narrow-apply" | "apply-executor-review-proposal-narrow" }> {
  const effect: Extract<RuntimeUiEffect, { type: "preview-executor-review-proposal-narrow-apply" | "apply-executor-review-proposal-narrow" }> = { type, proposalId: "" }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ""
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("executor review proposal narrow apply args must use proposal=<id>, readiness=<id>, or reason=<reason>")
    if (key === "proposal") effect.proposalId = value
    else if (key === "readiness") effect.readinessId = value
    else if (key === "reason") {
      effect.reason = [value, ...args.slice(index + 1)].join(" ").trim()
      break
    }
    else throw new Error("executor review proposal narrow apply arg is unsupported")
  }
  if (!effect.proposalId) throw new Error("executor review proposal narrow apply requires proposal=<id>")
  return effect
}

function opencodeSessionEffect(type: "preview-opencode-session-plan" | "create-opencode-session-plan", args: string[], requireSource: boolean): Extract<RuntimeUiEffect, { type: "preview-opencode-session-plan" | "create-opencode-session-plan" }> {
  const effect: Extract<RuntimeUiEffect, { type: "preview-opencode-session-plan" | "create-opencode-session-plan" }> = { type }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ""
    const separator = arg.indexOf("=")
    if (separator <= 0) throw new Error("OpenCode session args must use objective=<text>, proposal=<id>, mission=<id>, review=<id>, apply=<id>, or title=<text>")
    const key = arg.slice(0, separator).trim()
    const value = arg.slice(separator + 1).trim()
    if (!key || !value) throw new Error("OpenCode session args must include non-empty key=value pairs")
    if (key === "objective") {
      const parts = [value]
      while (index + 1 < args.length && !looksLikeKeyValueArg(args[index + 1] ?? "")) {
        index += 1
        parts.push(args[index] ?? "")
      }
      effect.objective = parts.join(" ").trim()
    } else if (key === "title") {
      const parts = [value]
      while (index + 1 < args.length && !looksLikeKeyValueArg(args[index + 1] ?? "")) {
        index += 1
        parts.push(args[index] ?? "")
      }
      effect.title = parts.join(" ").trim()
    } else if (key === "proposal") effect.proposalId = value
    else if (key === "mission") effect.missionId = value
    else if (key === "review") effect.reviewRequestId = value
    else if (key === "apply") effect.applyId = value
    else if (key === "max_context_bytes") effect.maxContextBytes = readPositiveInteger(value, "max_context_bytes", 48_000)
    else throw new Error("OpenCode session arg is unsupported")
  }
  if (requireSource && !effect.objective && !effect.proposalId && !effect.missionId && !effect.applyId) {
    throw new Error("OpenCode session plan requires objective=<text>, proposal=<id>, mission=<id>, or apply=<id>")
  }
  return effect
}

function looksLikeKeyValueArg(value: string): boolean {
  const separator = value.indexOf("=")
  if (separator <= 0) return false
  const key = value.slice(0, separator).trim()
  return ["objective", "title", "proposal", "mission", "review", "apply", "max_context_bytes"].includes(key)
}

function contextCapabilityListEffect(args: string[]): Extract<RuntimeUiEffect, { type: "load-model-capabilities" }> {
  const effect: Extract<RuntimeUiEffect, { type: "load-model-capabilities" }> = { type: "load-model-capabilities", limit: HANDOFF_LIMIT }
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("model capabilities args must use provider=<kind>, role=<role>, or limit=<n>")
    if (key === "provider") effect.providerKind = value
    else if (key === "role") effect.role = value
    else if (key === "limit") effect.limit = readPositiveInteger(value, "limit", HANDOFF_LIMIT)
    else throw new Error("model capabilities arg is unsupported")
  }
  return effect
}

function contextCapabilityGetEffect(args: string[]): Extract<RuntimeUiEffect, { type: "load-model-capability" }> {
  if (args.length === 1 && !args[0]!.includes("=")) return { type: "load-model-capability", capabilityId: args[0] }
  const effect: Extract<RuntimeUiEffect, { type: "load-model-capability" }> = { type: "load-model-capability" }
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("model capability args must use capability=<id> or provider=<kind> model=<id>")
    if (key === "capability") effect.capabilityId = value
    else if (key === "provider") effect.providerKind = value
    else if (key === "model") effect.modelId = value
    else throw new Error("model capability arg is unsupported")
  }
  if (!effect.capabilityId && (!effect.providerKind || !effect.modelId)) throw new Error("model capability requires capability=<id> or provider=<kind> model=<id>")
  return effect
}

function contextBudgetPreviewEffect(args: string[]): Extract<RuntimeUiEffect, { type: "preview-context-budget" }> {
  const effect: Extract<RuntimeUiEffect, { type: "preview-context-budget" }> = { type: "preview-context-budget" }
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("context budget preview args must use purpose=<purpose>, provider=<kind>, model=<id>, session=<id>, max_context_bytes=<n>, or max_context_tokens=<n>")
    if (key === "purpose") effect.purpose = value
    else if (key === "role") effect.role = value
    else if (key === "provider") effect.providerKind = value
    else if (key === "model") effect.modelId = value
    else if (key === "session") effect.sessionId = value
    else if (key === "max_context_bytes") effect.maxContextBytes = readPositiveInteger(value, "max_context_bytes", 512_000)
    else if (key === "max_context_tokens") effect.maxContextTokens = readPositiveInteger(value, "max_context_tokens", 128_000)
    else throw new Error("context budget preview arg is unsupported")
  }
  if (!effect.purpose) throw new Error("context budget preview requires purpose=<purpose>")
  return effect
}

function contextPacketPreviewEffect(args: string[]): Extract<RuntimeUiEffect, { type: "preview-context-packet" }> {
  const effect: Extract<RuntimeUiEffect, { type: "preview-context-packet" }> = { type: "preview-context-packet" }
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("context packet preview args must use purpose=<purpose>, provider=<kind>, model=<id>, session=<id>, mission=<id>, proposal=<id>, review=<id>, apply=<id>, max_context_bytes=<n>, or max_context_tokens=<n>")
    if (key === "purpose") effect.purpose = value
    else if (key === "role") effect.role = value
    else if (key === "provider") effect.providerKind = value
    else if (key === "model") effect.modelId = value
    else if (key === "session") effect.sessionId = value
    else if (key === "mission") effect.missionId = value
    else if (key === "proposal") effect.proposalId = value
    else if (key === "review") effect.reviewRequestId = value
    else if (key === "apply") effect.applyId = value
    else if (key === "max_context_bytes") effect.maxContextBytes = readPositiveInteger(value, "max_context_bytes", 512_000)
    else if (key === "max_context_tokens") effect.maxContextTokens = readPositiveInteger(value, "max_context_tokens", 128_000)
    else throw new Error("context packet preview arg is unsupported")
  }
  if (!effect.purpose) throw new Error("context packet preview requires purpose=<purpose>")
  return effect
}

function opencodeSessionInstructionPackEffect(type: "preview-opencode-session-instruction-pack" | "write-opencode-session-instruction-pack", args: string[], requireSession: boolean): Extract<RuntimeUiEffect, { type: "preview-opencode-session-instruction-pack" | "write-opencode-session-instruction-pack" }> {
  const effect: Extract<RuntimeUiEffect, { type: "preview-opencode-session-instruction-pack" | "write-opencode-session-instruction-pack" }> = { type }
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("OpenCode instruction pack args must use session=<id>, provider=<kind>, model=<id>, max_context_bytes=<n>, or max_context_tokens=<n>")
    if (key === "session") effect.sessionId = value
    else if (key === "provider") effect.providerKind = value
    else if (key === "model") effect.modelId = value
    else if (key === "max_context_bytes") effect.maxContextBytes = readPositiveInteger(value, "max_context_bytes", 512_000)
    else if (key === "max_context_tokens") effect.maxContextTokens = readPositiveInteger(value, "max_context_tokens", 128_000)
    else if (key === "include_opencode_config") effect.includeOpenCodeConfig = value !== "false"
    else if (key === "include_manifest") effect.includeManifest = value !== "false"
    else throw new Error("OpenCode instruction pack arg is unsupported")
  }
  if (requireSession && !effect.sessionId) throw new Error("OpenCode instruction pack requires session=<id>")
  return effect
}

function opencodeSessionInstructionPackListEffect(args: string[]): Extract<RuntimeUiEffect, { type: "load-opencode-session-instruction-packs" }> {
  const effect: Extract<RuntimeUiEffect, { type: "load-opencode-session-instruction-packs" }> = { type: "load-opencode-session-instruction-packs", limit: HANDOFF_LIMIT }
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("OpenCode instruction pack list args must use session=<id>, status=<status>, or limit=<n>")
    if (key === "session") effect.sessionId = value
    else if (key === "status") effect.status = value
    else if (key === "limit") effect.limit = readPositiveInteger(value, "limit", HANDOFF_LIMIT)
    else throw new Error("OpenCode instruction pack list arg is unsupported")
  }
  return effect
}

function opencodeLaunchReadinessEffect(args: string[]): Extract<RuntimeUiEffect, { type: "preview-opencode-launch-readiness" }> {
  const effect: Extract<RuntimeUiEffect, { type: "preview-opencode-launch-readiness" }> = { type: "preview-opencode-launch-readiness" }
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("OpenCode launch readiness args must use session=<id>, pack=<id>, provider=<kind>, model=<id>, max_context_bytes=<n>, or max_context_tokens=<n>")
    if (key === "session") effect.sessionId = value
    else if (key === "pack") effect.packId = value
    else if (key === "provider") effect.providerKind = value
    else if (key === "model") effect.modelId = value
    else if (key === "max_context_bytes") effect.maxContextBytes = readPositiveInteger(value, "max_context_bytes", 512_000)
    else if (key === "max_context_tokens") effect.maxContextTokens = readPositiveInteger(value, "max_context_tokens", 128_000)
    else if (key === "include_research_memory") effect.includeResearchMemory = value !== "false"
    else if (key === "include_native_config") effect.includeNativeConfig = value !== "false"
    else throw new Error("OpenCode launch readiness arg is unsupported")
  }
  if (!effect.sessionId) throw new Error("OpenCode launch readiness requires session=<id>")
  return effect
}

function opencodeLaunchEffect(
  type: "preview-opencode-session-launch" | "launch-opencode-session",
  args: string[],
  requireSession: boolean,
): Extract<RuntimeUiEffect, { type: "preview-opencode-session-launch" | "launch-opencode-session" }> {
  const effect: Extract<RuntimeUiEffect, { type: "preview-opencode-session-launch" | "launch-opencode-session" }> = { type }
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("OpenCode launch args must use session=<id>, pack=<id>, readiness_hash=<hash>, adapter=<kind>, provider=<kind>, model=<id>, or allow_real_launch=<bool>")
    if (key === "session") effect.sessionId = value
    else if (key === "pack") effect.packId = value
    else if (key === "readiness_hash") effect.readinessHash = value
    else if (key === "adapter") effect.adapterKind = value
    else if (key === "provider") effect.providerKind = value
    else if (key === "model") effect.modelId = value
    else if (key === "allow_real_launch") effect.allowRealLaunch = readBooleanArg(value)
    else throw new Error("OpenCode launch arg is unsupported")
  }
  if (requireSession && !effect.sessionId) throw new Error("OpenCode launch requires session=<id>")
  return effect
}

function opencodeLaunchListEffect(args: string[]): Extract<RuntimeUiEffect, { type: "load-opencode-session-launches" }> {
  const effect: Extract<RuntimeUiEffect, { type: "load-opencode-session-launches" }> = { type: "load-opencode-session-launches", limit: HANDOFF_LIMIT }
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("OpenCode launch list args must use session=<id>, status=<status>, or limit=<n>")
    if (key === "session") effect.sessionId = value
    else if (key === "status") effect.status = value
    else if (key === "limit") effect.limit = readPositiveInteger(value, "limit", HANDOFF_LIMIT)
    else throw new Error("OpenCode launch list arg is unsupported")
  }
  return effect
}

function opencodeProgressEffect(
  type: "preview-opencode-progress" | "record-opencode-progress",
  args: string[],
  defaultKind: string,
  requirePayload: boolean,
): Extract<RuntimeUiEffect, { type: "preview-opencode-progress" | "record-opencode-progress" }> {
  const effect: Extract<RuntimeUiEffect, { type: "preview-opencode-progress" | "record-opencode-progress" }> = { type, kind: defaultKind }
  const freeTextKeys = new Set(["summary", "step", "blocker", "blockers", "question", "next"])
  const knownKeys = new Set(["session", "launch", "kind", "state", "execution_state", "summary", "step", "files", "commands", "tests", "artifacts", "blocker", "blockers", "question", "confidence", "next", "source"])
  for (let index = 0; index < args.length; index += 1) {
    const { key, value, nextIndex } = readKeyValueWithFreeText(args, index, knownKeys, freeTextKeys, "OpenCode progress args must use session=<id>, launch=<id>, summary=<text>, step=<text>, files=<csv>, commands=<csv>, tests=<csv>, artifacts=<csv>, blocker=<text>, question=<text>, confidence=<value>, or next=<text>")
    index = nextIndex
    if (key === "session") effect.sessionId = value
    else if (key === "launch") effect.launchId = value
    else if (key === "kind") effect.kind = value
    else if (key === "state" || key === "execution_state") effect.executionState = value
    else if (key === "summary") effect.reportSummary = value
    else if (key === "step") effect.currentStep = value
    else if (key === "files") effect.filesTouched = commaList(value)
    else if (key === "commands") effect.commandsRun = commaList(value)
    else if (key === "tests") effect.testsRun = commaList(value)
    else if (key === "artifacts") effect.artifacts = commaList(value)
    else if (key === "blocker" || key === "blockers") effect.blockers = commaList(value)
    else if (key === "question") effect.question = value
    else if (key === "confidence") effect.confidence = value
    else if (key === "next") effect.nextAction = value
    else if (key === "source") effect.sourceKind = value
    else throw new Error("OpenCode progress arg is unsupported")
  }
  if (!effect.sessionId && !effect.launchId) throw new Error("OpenCode progress requires session=<id> or launch=<id>")
  const effectiveKind = effect.kind ?? defaultKind
  if (requirePayload && (effectiveKind === "heartbeat" || effectiveKind === "progress" || effectiveKind === "blocker") && !effect.reportSummary) throw new Error("OpenCode progress requires summary=<text>")
  if (requirePayload && effectiveKind === "question" && !effect.question) throw new Error("OpenCode question requires question=<text>")
  if (effectiveKind === "blocker" && !effect.blockers?.length) throw new Error("OpenCode blocker requires blocker=<text>")
  return effect
}

function opencodeProgressListEffect(args: string[]): Extract<RuntimeUiEffect, { type: "load-opencode-progress-records" }> {
  const effect: Extract<RuntimeUiEffect, { type: "load-opencode-progress-records" }> = { type: "load-opencode-progress-records", limit: HANDOFF_LIMIT }
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("OpenCode progress list args must use session=<id>, launch=<id>, kind=<kind>, state=<state>, or limit=<n>")
    if (key === "session") effect.sessionId = value
    else if (key === "launch") effect.launchId = value
    else if (key === "kind") effect.kind = value
    else if (key === "state" || key === "execution_state") effect.executionState = value
    else if (key === "limit") effect.limit = readPositiveInteger(value, "limit", HANDOFF_LIMIT)
    else throw new Error("OpenCode progress list arg is unsupported")
  }
  return effect
}

function opencodeProgressLatestEffect(args: string[]): Extract<RuntimeUiEffect, { type: "load-latest-opencode-progress" }> {
  const effect: Extract<RuntimeUiEffect, { type: "load-latest-opencode-progress" }> = { type: "load-latest-opencode-progress" }
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("OpenCode progress latest args must use session=<id> or launch=<id>")
    if (key === "session") effect.sessionId = value
    else if (key === "launch") effect.launchId = value
    else throw new Error("OpenCode progress latest arg is unsupported")
  }
  if (!effect.sessionId && !effect.launchId) throw new Error("OpenCode progress latest requires session=<id> or launch=<id>")
  return effect
}

function opencodeWatchdogEffect(
  type: "preview-opencode-watchdog" | "record-opencode-watchdog",
  args: string[],
  requireTarget: boolean,
): Extract<RuntimeUiEffect, { type: "preview-opencode-watchdog" | "record-opencode-watchdog" }> {
  const effect: Extract<RuntimeUiEffect, { type: "preview-opencode-watchdog" | "record-opencode-watchdog" }> = { type }
  const knownKeys = new Set(["session", "launch", "max_wall", "max_wall_ms", "max_wall_time_ms", "max_no_progress", "max_no_progress_ms", "heartbeat", "heartbeat_ms", "heartbeat_interval_ms", "request_report"])
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("OpenCode watchdog args must use session=<id>, launch=<id>, max_wall_ms=<n>, max_no_progress_ms=<n>, heartbeat_ms=<n>, or request_report=<bool>")
    if (!knownKeys.has(key)) throw new Error("OpenCode watchdog arg is unsupported")
    if (key === "session") effect.sessionId = value
    else if (key === "launch") effect.launchId = value
    else if (key === "max_wall" || key === "max_wall_ms" || key === "max_wall_time_ms") effect.maxWallTimeMs = readPositiveInteger(value, key, 86_400_000)
    else if (key === "max_no_progress" || key === "max_no_progress_ms") effect.maxNoProgressMs = readPositiveInteger(value, key, 86_400_000)
    else if (key === "heartbeat" || key === "heartbeat_ms" || key === "heartbeat_interval_ms") effect.heartbeatIntervalMs = readPositiveInteger(value, key, 3_600_000)
    else if (key === "request_report" && type === "record-opencode-watchdog") (effect as Extract<RuntimeUiEffect, { type: "record-opencode-watchdog" }>).requestReport = readBooleanArg(value)
  }
  if (requireTarget && !effect.sessionId && !effect.launchId) throw new Error("OpenCode watchdog requires session=<id> or launch=<id>")
  return effect
}

function opencodeForcedReportEffect(args: string[]): Extract<RuntimeUiEffect, { type: "request-opencode-forced-report" }> {
  const effect: Extract<RuntimeUiEffect, { type: "request-opencode-forced-report" }> = { type: "request-opencode-forced-report" }
  const freeTextKeys = new Set(["reason"])
  const knownKeys = new Set(["session", "launch", "reason"])
  for (let index = 0; index < args.length; index += 1) {
    const { key, value, nextIndex } = readKeyValueWithFreeText(args, index, knownKeys, freeTextKeys, "OpenCode forced report args must use session=<id>, launch=<id>, or reason=<text>")
    index = nextIndex
    if (key === "session") effect.sessionId = value
    else if (key === "launch") effect.launchId = value
    else if (key === "reason") effect.reason = value
    else throw new Error("OpenCode forced report arg is unsupported")
  }
  if (!effect.sessionId && !effect.launchId) throw new Error("OpenCode forced report requires session=<id> or launch=<id>")
  if (!effect.reason) effect.reason = "operator requested report after watchdog assessment"
  return effect
}

function opencodeWatchdogListEffect(args: string[]): Extract<RuntimeUiEffect, { type: "load-opencode-watchdogs" }> {
  const effect: Extract<RuntimeUiEffect, { type: "load-opencode-watchdogs" }> = { type: "load-opencode-watchdogs", limit: HANDOFF_LIMIT }
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("OpenCode watchdog list args must use session=<id>, launch=<id>, status=<status>, or limit=<n>")
    if (key === "session") effect.sessionId = value
    else if (key === "launch") effect.launchId = value
    else if (key === "status") effect.status = value
    else if (key === "limit") effect.limit = readPositiveInteger(value, "limit", HANDOFF_LIMIT)
    else throw new Error("OpenCode watchdog list arg is unsupported")
  }
  return effect
}

function opencodeForcedReportListEffect(args: string[]): Extract<RuntimeUiEffect, { type: "load-opencode-forced-report-requests" }> {
  const effect: Extract<RuntimeUiEffect, { type: "load-opencode-forced-report-requests" }> = { type: "load-opencode-forced-report-requests", limit: HANDOFF_LIMIT }
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("OpenCode forced report list args must use session=<id>, launch=<id>, or limit=<n>")
    if (key === "session") effect.sessionId = value
    else if (key === "launch") effect.launchId = value
    else if (key === "limit") effect.limit = readPositiveInteger(value, "limit", HANDOFF_LIMIT)
    else throw new Error("OpenCode forced report list arg is unsupported")
  }
  return effect
}

function opencodeCommanderQuestionEffect(
  type: "preview-opencode-commander-question" | "create-opencode-commander-question",
  args: string[],
  requireSource: boolean,
): Extract<RuntimeUiEffect, { type: "preview-opencode-commander-question" | "create-opencode-commander-question" }> {
  const effect: Extract<RuntimeUiEffect, { type: "preview-opencode-commander-question" | "create-opencode-commander-question" }> = { type }
  const freeTextKeys = new Set(["question", "context", "recommendation"])
  const knownKeys = new Set(["session", "launch", "progress", "watchdog", "forced_report", "question", "type", "urgency", "context", "options", "recommendation", "source"])
  for (let index = 0; index < args.length; index += 1) {
    const { key, value, nextIndex } = readKeyValueWithFreeText(args, index, knownKeys, freeTextKeys, "OpenCode asks Commander args must use session=<id>, launch=<id>, progress=<id>, watchdog=<id>, forced_report=<id>, question=<text>, type=<type>, urgency=<urgency>, context=<text>, options=<csv>, recommendation=<text>, or source=<kind>")
    index = nextIndex
    if (key === "session") effect.sessionId = value
    else if (key === "launch") effect.launchId = value
    else if (key === "progress") effect.progressId = value
    else if (key === "watchdog") effect.watchdogId = value
    else if (key === "forced_report") effect.forcedReportRequestId = value
    else if (key === "question") effect.question = value
    else if (key === "type") effect.questionType = value
    else if (key === "urgency") effect.urgency = value
    else if (key === "context") effect.contextSummary = value
    else if (key === "options") effect.optionsConsidered = commaList(value)
    else if (key === "recommendation") effect.executorRecommendation = value
    else if (key === "source") effect.sourceKind = value
    else throw new Error("OpenCode asks Commander arg is unsupported")
  }
  if (requireSource && !effect.sessionId && !effect.launchId && !effect.progressId && !effect.watchdogId && !effect.forcedReportRequestId) {
    throw new Error("OpenCode asks Commander requires session=<id>, launch=<id>, progress=<id>, watchdog=<id>, or forced_report=<id>")
  }
  if (requireSource && !effect.question && !effect.progressId && !effect.watchdogId && !effect.forcedReportRequestId) {
    throw new Error("OpenCode asks Commander requires question=<text> unless progress/watchdog/forced_report evidence supplies context")
  }
  return effect
}

function opencodeCommanderQuestionListEffect(args: string[]): Extract<RuntimeUiEffect, { type: "load-opencode-commander-questions" }> {
  const effect: Extract<RuntimeUiEffect, { type: "load-opencode-commander-questions" }> = { type: "load-opencode-commander-questions", limit: HANDOFF_LIMIT }
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("OpenCode Commander questions list args must use session=<id>, launch=<id>, status=<status>, type=<type>, urgency=<urgency>, or limit=<n>")
    if (key === "session") effect.sessionId = value
    else if (key === "launch") effect.launchId = value
    else if (key === "status") effect.status = value
    else if (key === "type") effect.questionType = value
    else if (key === "urgency") effect.urgency = value
    else if (key === "limit") effect.limit = readPositiveInteger(value, "limit", HANDOFF_LIMIT)
    else throw new Error("OpenCode Commander questions list arg is unsupported")
  }
  return effect
}

function opencodeCommanderQuestionLatestEffect(args: string[]): Extract<RuntimeUiEffect, { type: "load-latest-opencode-commander-question" }> {
  const effect: Extract<RuntimeUiEffect, { type: "load-latest-opencode-commander-question" }> = { type: "load-latest-opencode-commander-question" }
  for (const arg of args) {
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=").trim()
    if (!key || !value) throw new Error("OpenCode Commander question latest args must use session=<id> or launch=<id>")
    if (key === "session") effect.sessionId = value
    else if (key === "launch") effect.launchId = value
    else throw new Error("OpenCode Commander question latest arg is unsupported")
  }
  if (!effect.sessionId && !effect.launchId) throw new Error("OpenCode Commander question latest requires session=<id> or launch=<id>")
  return effect
}

function researchMemoryRetrievalEffect(args: string[]): Extract<RuntimeUiEffect, { type: "preview-research-memory-retrieval" }> {
  const effect: Extract<RuntimeUiEffect, { type: "preview-research-memory-retrieval" }> = { type: "preview-research-memory-retrieval", limit: HANDOFF_LIMIT }
  const freeTextKeys = new Set(["query"])
  const knownKeys = new Set(["query", "labels", "limit", "source", "mission", "session", "include_failures", "include_artifacts"])
  for (let index = 0; index < args.length; index += 1) {
    const { key, value, nextIndex } = readKeyValueWithFreeText(args, index, knownKeys, freeTextKeys, "research memory search args must use query=<text>, labels=<csv>, limit=<n>, source=<kind>, mission=<id>, or session=<id>")
    index = nextIndex
    if (key === "query") effect.query = value
    else if (key === "labels") effect.labels = commaList(value)
    else if (key === "limit") effect.limit = readPositiveInteger(value, "limit", HANDOFF_LIMIT)
    else if (key === "source") effect.sourceKind = value
    else if (key === "mission") effect.missionId = value
    else if (key === "session") effect.sessionId = value
    else if (key === "include_failures") effect.includeFailures = readBooleanArg(value)
    else if (key === "include_artifacts") effect.includeArtifacts = readBooleanArg(value)
    else throw new Error("research memory search arg is unsupported")
  }
  if (!effect.query) throw new Error("research memory search requires query=<text>")
  return effect
}

function researchNoveltyEffect(args: string[]): Extract<RuntimeUiEffect, { type: "preview-research-novelty-check" }> {
  const effect: Extract<RuntimeUiEffect, { type: "preview-research-novelty-check" }> = { type: "preview-research-novelty-check", limit: HANDOFF_LIMIT }
  const freeTextKeys = new Set(["question", "method", "config", "reason", "repetition_reason"])
  const knownKeys = new Set(["question", "method", "config", "reason", "repetition_reason", "labels", "limit", "mission", "session", "include_failures"])
  for (let index = 0; index < args.length; index += 1) {
    const { key, value, nextIndex } = readKeyValueWithFreeText(args, index, knownKeys, freeTextKeys, "research novelty args must use question=<text>, method=<text>, config=<text>, reason=<reason>, labels=<csv>, limit=<n>, mission=<id>, or session=<id>")
    index = nextIndex
    if (key === "question") effect.question = value
    else if (key === "method") effect.method = value
    else if (key === "config") effect.config = value
    else if (key === "reason" || key === "repetition_reason") effect.repetitionReason = value
    else if (key === "labels") effect.labels = commaList(value)
    else if (key === "limit") effect.limit = readPositiveInteger(value, "limit", HANDOFF_LIMIT)
    else if (key === "mission") effect.missionId = value
    else if (key === "session") effect.sessionId = value
    else if (key === "include_failures") effect.includeFailures = readBooleanArg(value)
    else throw new Error("research novelty arg is unsupported")
  }
  if (!effect.question) throw new Error("research novelty preview requires question=<text>")
  return effect
}

function readKeyValueWithFreeText(args: string[], index: number, knownKeys: Set<string>, freeTextKeys: Set<string>, errorMessage: string): { key: string; value: string; nextIndex: number } {
  const arg = args[index] ?? ""
  const separator = arg.indexOf("=")
  if (separator <= 0) throw new Error(errorMessage)
  const key = arg.slice(0, separator).trim()
  const first = arg.slice(separator + 1).trim()
  if (!key || !first || !knownKeys.has(key)) throw new Error(errorMessage)
  const parts = [first]
  let nextIndex = index
  if (freeTextKeys.has(key)) {
    while (nextIndex + 1 < args.length && !looksLikeAnyKeyValueArg(args[nextIndex + 1] ?? "", knownKeys)) {
      nextIndex += 1
      parts.push(args[nextIndex] ?? "")
    }
  }
  return { key, value: parts.join(" ").trim(), nextIndex }
}

function looksLikeAnyKeyValueArg(value: string, knownKeys: Set<string>): boolean {
  const separator = value.indexOf("=")
  if (separator <= 0) return false
  return knownKeys.has(value.slice(0, separator).trim())
}

function commaList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 12)
}

function readBooleanArg(value: string): boolean {
  return value !== "false" && value !== "0" && value !== "no"
}

function checkpointEffect(type: "preview-runtime-checkpoint" | "create-runtime-checkpoint", args: string[]): Extract<RuntimeUiEffect, { type: "preview-runtime-checkpoint" | "create-runtime-checkpoint" }> {
  let scope: RuntimeCheckpointScope = "full"
  let reasonStart = 0
  if (args[0] && isCheckpointScope(args[0])) {
    scope = args[0]
    reasonStart = 1
  } else if (args[0]) {
    throw new Error("runtime checkpoint scope is invalid")
  }
  const reason = optionalRest(args, reasonStart)
  return { type, scope, ...(reason ? { reason } : {}) }
}

function wakeTargetArg(args: string[], allowCheckpoint: boolean): { resumeId?: string; checkpointId?: string } {
  if (args.length !== 1) throw new Error(allowCheckpoint ? "wake preview requires resume=<resumeId> or checkpoint=<checkpointId>" : "wake requires resume=<resumeId>")
  const [key, ...rest] = args[0].split("=")
  const value = rest.join("=").trim()
  if (!value) throw new Error(allowCheckpoint ? "wake preview requires resume=<resumeId> or checkpoint=<checkpointId>" : "wake requires resume=<resumeId>")
  if (key === "resume") return { resumeId: value }
  if (allowCheckpoint && key === "checkpoint") return { checkpointId: value }
  throw new Error(allowCheckpoint ? "wake preview requires resume=<resumeId> or checkpoint=<checkpointId>" : "wake requires resume=<resumeId>")
}

function wakeIdArg(args: string[]): string {
  if (args.length !== 1) throw new Error("continuation command requires wake=<wakeId>")
  const [key, ...rest] = args[0].split("=")
  const value = rest.join("=").trim()
  if (key !== "wake" || !value) throw new Error("continuation command requires wake=<wakeId>")
  return value
}

function wakeScheduleEffect(type: "preview-wake-schedule" | "create-wake-schedule", args: string[]): Extract<RuntimeUiEffect, { type: "preview-wake-schedule" | "create-wake-schedule" }> {
  let resumeId: string | undefined
  let intervalMs: number | undefined
  const title: string[] = []
  for (const arg of args) {
    if (arg.startsWith("resume=")) {
      resumeId = arg.slice("resume=".length).trim()
      if (!resumeId) throw new Error("schedule wake requires resume=<resumeId>")
    } else if (arg.startsWith("every=")) {
      intervalMs = parseScheduleDuration(arg.slice("every=".length).trim())
    } else {
      title.push(arg)
    }
  }
  if (!resumeId) throw new Error("schedule wake requires resume=<resumeId>")
  if (intervalMs === undefined) throw new Error("schedule wake requires every=<duration>")
  return { type, resumeId, intervalMs, title: title.length ? title.join(" ") : undefined }
}

function wakeSchedulerEffect(type: "preview-wake-scheduler-start" | "start-wake-scheduler", args: string[]): Extract<RuntimeUiEffect, { type: "preview-wake-scheduler-start" | "start-wake-scheduler" }> {
  let intervalMs: number | undefined
  let maxDueItems: number | undefined
  let dryRun = false
  for (const arg of args) {
    if (arg === "dry-run" || arg === "dry_run") {
      dryRun = true
    } else if (arg.startsWith("every=")) {
      intervalMs = parseScheduleDuration(arg.slice("every=".length).trim())
    } else if (arg.startsWith("max=")) {
      const parsed = Number(arg.slice("max=".length).trim())
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) throw new Error("scheduler max must be 1..20")
      maxDueItems = parsed
    } else {
      throw new Error("scheduler args must be dry-run, every=<duration>, or max=<n>")
    }
  }
  return { type, intervalMs, maxDueItems, dryRun }
}

function parseScheduleDuration(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d)?$/.exec(value)
  if (!match) throw new Error("schedule duration must be 60s, 5m, 1h, 1d, or milliseconds")
  const amount = Number(match[1])
  const unit = match[2] ?? "ms"
  const multipliers: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  const duration = amount * multipliers[unit]
  if (duration < 60_000) throw new Error("schedule duration must be at least 60s")
  if (duration > 30 * 24 * 60 * 60 * 1000) throw new Error("schedule duration must be no greater than 30d")
  return duration
}

function optionalIndexArg(args: string[], index: number): number | undefined {
  const value = args[index]
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error("continuation step index must be a nonnegative integer")
  return parsed
}

function requiredIndex(args: string[], index: number): number {
  const parsed = optionalIndexArg(args, index)
  if (parsed === undefined) throw new Error("workflow step index is required")
  return parsed
}

function readPositiveInteger(value: string, field: string, max: number): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${field} must be a positive integer`)
  return Math.min(parsed, max)
}

function cycleArgs(args: string[]): { topicId?: string; missionId?: string; objective?: string } {
  let topicId: string | undefined
  let missionId: string | undefined
  const objective: string[] = []
  for (const arg of args) {
    if (arg.startsWith("topic=")) {
      topicId = arg.slice("topic=".length).trim()
      if (!topicId) throw new Error("topic is required")
    } else if (arg.startsWith("mission=")) {
      missionId = arg.slice("mission=".length).trim()
      if (!missionId) throw new Error("mission is required")
    } else {
      objective.push(arg)
    }
  }
  const objectiveText = objective.join(" ").trim()
  if (!topicId && !missionId && !objectiveText) throw new Error("topic, mission, or objective is required")
  return { topicId, missionId, ...(objectiveText ? { objective: objectiveText } : {}) }
}

function ingestionArgs(args: string[]): { topicId?: string; sourceTitle?: string; noteTitle?: string; tags: string[]; query: Record<string, string> } {
  const query: Record<string, string> = {}
  const tags: string[] = []
  let topicId: string | undefined
  let sourceTitle: string | undefined
  let noteTitle: string | undefined
  for (const arg of args) {
    const index = arg.indexOf("=")
    if (index <= 0) throw new Error("ingestion args must be key=value")
    const key = arg.slice(0, index).trim()
    const value = arg.slice(index + 1)
    if (!key) throw new Error("ingestion arg key is required")
    if (key === "topic") topicId = value
    else if (key === "source") sourceTitle = value
    else if (key === "note") noteTitle = value
    else if (key === "tag") tags.push(value)
    else if (key === "body") throw new Error("body is not supported by TUI API ingestion")
    else query[key] = value
  }
  return { topicId, sourceTitle, noteTitle, tags, query }
}

function queryArgs(args: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const arg of args) {
    const index = arg.indexOf("=")
    if (index <= 0) throw new Error("query args must be key=value")
    const key = arg.slice(0, index).trim()
    const value = arg.slice(index + 1)
    if (!key) throw new Error("query key is required")
    out[key] = value
  }
  return out
}

function requiredArg(args: string[], index: number, field: string): string {
  const value = args[index]
  if (!value) throw new Error(`${field} is required`)
  return value
}

function readFollowupQueueArg(value: string): OpenCodeHandoffFollowupQueueKind {
  if (value === "active" || value === "needs_result_review" || value === "completed" || value === "failed" || value === "blocked" || value === "stale") return value
  throw new Error("handoff follow-up queue is invalid")
}

function isCheckpointScope(value: string): value is RuntimeCheckpointScope {
  return value === "full" || value === "commander" || value === "executor" || value === "research" || value === "handoff"
}

function requiredMissionIdArg(args: string[], index: number): string {
  const value = args[index]
  if (!value || value.startsWith("--")) throw new Error("missionId is required")
  return value
}

function requiredRest(args: string[], index: number, field: string): string {
  const value = args.slice(index).join(" ").trim()
  if (!value) throw new Error(`${field} is required`)
  return value
}

function optionalSurfaceArg(args: string[]): string | undefined {
  if (args.length === 0) return undefined
  if (args.length > 1) throw new Error("reasoning smoke accepts one optional surface")
  const value = args[0]
  if (value === "research" || value === "research_synthesis" || value === "cycle" || value === "commander_cycle" || value === "executor_review" || value === "commander_executor_review") return value
  throw new Error("reasoning smoke surface must be research_synthesis, commander_cycle, or commander_executor_review")
}

function minimaxLiveValidationArgs(args: string[]): { surfaces?: string[]; timeoutMs?: number } {
  const surfaces: string[] = []
  let timeoutMs: number | undefined
  for (const arg of args) {
    if (arg.startsWith("surface=")) {
      surfaces.push(readMiniMaxLiveValidationSurfaceArg(arg.slice("surface=".length).trim()))
    } else if (arg.startsWith("timeout=")) {
      timeoutMs = parseLiveValidationTimeout(arg.slice("timeout=".length).trim())
    } else if (arg.startsWith("timeout_ms=")) {
      timeoutMs = parseLiveValidationTimeout(arg.slice("timeout_ms=".length).trim())
    } else if (arg === "research" || arg === "research_synthesis" || arg === "cycle" || arg === "commander_cycle" || arg === "executor_review" || arg === "commander_executor_review") {
      surfaces.push(readMiniMaxLiveValidationSurfaceArg(arg))
    } else {
      throw new Error("MiniMax live validation args must be surface=<surface>, timeout=<ms>, or a supported surface")
    }
  }
  return { surfaces: surfaces.length > 0 ? [...new Set(surfaces)] : undefined, timeoutMs }
}

function readMiniMaxLiveValidationSurfaceArg(value: string): string {
  if (value === "research" || value === "research_synthesis") return "research_synthesis"
  if (value === "cycle" || value === "commander_cycle") return "commander_cycle"
  if (value === "executor_review" || value === "commander_executor_review") return "commander_executor_review"
  throw new Error("MiniMax live validation surface must be research_synthesis, commander_cycle, or commander_executor_review")
}

function parseLiveValidationTimeout(value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 60_000) throw new Error("MiniMax live validation timeout must be 1..60000 milliseconds")
  return parsed
}

function optionalRest(args: string[], index: number): string | undefined {
  const value = args.slice(index).join(" ").trim()
  return value || undefined
}

function preview(value: string): string {
  return value.length > PREVIEW_LENGTH ? `${value.slice(0, PREVIEW_LENGTH)}...` : value
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? redactText(value) : fallback
}

function readBoolean(value: unknown): boolean {
  return value === true
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
