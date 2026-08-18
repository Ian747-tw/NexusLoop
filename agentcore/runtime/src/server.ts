import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { EventStore } from "./events/event-store"
import { RuntimeEventBus } from "./events/event-bus"
import type { RuntimeEvent, RuntimeMode, RuntimeResearchProjectionHealth, RuntimeResearchProjectionMode, RuntimeStatus } from "./events/event-types"
import { modeRequiresApprovedSpec } from "./project/project-status"
import { locateProjectRoot, projectName } from "./project/project-root"
import { RunLock } from "./project/run-lock"
import { FakeOpenCodeAdapter } from "./opencode/fake-adapter"
import type { ExecutorToolHandlerAdapter, OpenCodeRuntimeAdapter } from "./opencode/adapter"
import { createOpenCodeAdapter, type OpenCodeAdapterConfig, type OpenCodeAdapterFactoryOptions } from "./opencode/adapter-config"
import { MissionRegistry } from "./missions/mission-registry"
import type { ExecutorClaim, MissionProgress, MissionRecord, MissionResult, MissionStatusSummary } from "./missions/mission-types"
import { ReviewRegistry } from "./missions/review-registry"
import type { ReviewRequest, ReviewRequestInput, ReviewStatus, ReviewStatusSummary } from "./missions/review-types"
import { ProposalRegistry } from "./missions/proposal-registry"
import type { CommanderProposal, CommanderProposalInput, ProposalStatus, ProposalStatusSummary } from "./missions/proposal-types"
import { ProposalBundleRegistry } from "./missions/proposal-bundle-registry"
import type { CommanderProposalBundle, CommanderProposalBundleInput, CommanderProposalBundleReadiness, CommanderProposalBundleStatus, CommanderProposalBundleSummary } from "./missions/proposal-bundle-types"
import { draftCommanderPlaybook, getCommanderPlaybook, listCommanderPlaybooks } from "./missions/commander-playbooks"
import type { CommanderPlaybook, CommanderPlaybookDraftInput, CommanderPlaybookDraftResult } from "./missions/commander-playbook-types"
import { CommanderPlaybookDraftRegistry } from "./missions/commander-playbook-draft-registry"
import type { CommanderPlaybookDraft, CommanderPlaybookDraftReadiness, CommanderPlaybookDraftStatus, CommanderPlaybookDraftSummary } from "./missions/commander-playbook-draft-types"
import { CommanderApplyService } from "./missions/commander-apply-service"
import type { CommanderApplyOptions, CommanderApplyPreview, CommanderApplyResult, CommanderApplyTargetType } from "./missions/commander-apply-types"
import { CommanderAuditService } from "./missions/commander-audit-service"
import type { CommanderAuditEventKind, CommanderAuditTimeline, CommanderAuthorityChain } from "./missions/commander-audit-types"
import { CommanderQueueService, readCommanderQueueKind, readCommanderQueueLimit, readCommanderQueueStaleAfterMs } from "./missions/commander-queue-service"
import type { CommanderQueueKind, CommanderQueueResult, CommanderQueueSummary } from "./missions/commander-queue-types"
import { CommanderTargetContextService } from "./missions/commander-target-context-service"
import type { CommanderTargetContext } from "./missions/commander-target-context-types"
import type { ExternalApiAuditRecord, ExternalApiConnector, ExternalApiRequestInput, ExternalApiRequestPreview, ExternalApiRequestResult } from "./external-api/api-connector-types"
import { ExternalApiConnectorRegistry } from "./external-api/api-connector-registry"
import { ExternalApiRequestService } from "./external-api/api-request-service"
import { CommanderGithubReadService } from "./commander-tools/commander-github-read-service"
import { readCommanderGithubGatewayConfigFromEnv, validateCommanderGithubGatewayConfig } from "./commander-tools/commander-github-read-config"
import type { CommanderGithubGatewayConfig, CommanderGithubGatewayStatus } from "./commander-tools/commander-github-read-types"
import { ExternalApiResearchIngestionService, type ExternalApiResearchDbWriter } from "./external-api/api-research-ingestion-service"
import type { ExternalApiResearchIngestionInput, ExternalApiResearchIngestionPreview, ExternalApiResearchIngestionRecord, ExternalApiResearchIngestionResult } from "./external-api/api-research-ingestion-types"
import { FetchExternalApiTransport, type ExternalApiHostResolver, type ExternalApiTransport } from "./external-api/api-transport"
import { ResearchSynthesisService, type ResearchSynthesisDbWriter } from "./research-synthesis/research-synthesis-service"
import { FakeResearchSynthesisProvider, type ResearchSynthesisProvider } from "./research-synthesis/research-synthesis-provider"
import type { ResearchSynthesisInput, ResearchSynthesisPreview, ResearchSynthesisRecord, ResearchSynthesisResult } from "./research-synthesis/research-synthesis-types"
import { CommanderCycleService } from "./commander-cycle/commander-cycle-service"
import { FakeCommanderCycleProvider, type CommanderCycleProvider } from "./commander-cycle/commander-cycle-provider"
import type { CommanderCycleInput, CommanderCyclePreview, CommanderCycleRecord, CommanderCycleResult } from "./commander-cycle/commander-cycle-types"
import { CommanderExecutorReviewService, readCommanderExecutorReviewInput } from "./commander-executor-review/commander-executor-review-service"
import { FakeCommanderExecutorReviewProvider, type CommanderExecutorReviewProvider } from "./commander-executor-review/commander-executor-review-provider"
import type { CommanderExecutorReviewPreview, CommanderExecutorReviewRecord, CommanderExecutorReviewResult } from "./commander-executor-review/commander-executor-review-types"
import { ExecutorReviewProposalDraftService, readExecutorReviewProposalDraftPreviewInput } from "./commander-executor-review/executor-review-proposal-draft-service"
import type { ExecutorReviewProposalDraftPreview, ExecutorReviewProposalDraftSummary } from "./commander-executor-review/executor-review-proposal-draft-types"
import { ExecutorReviewProposalCreateService, readExecutorReviewProposalCreateInput, readExecutorReviewProposalCreatePreviewInput } from "./commander-executor-review/executor-review-proposal-create-service"
import type { ExecutorReviewProposalCreatePreview, ExecutorReviewProposalCreateRecord, ExecutorReviewProposalCreateResult } from "./commander-executor-review/executor-review-proposal-create-types"
import { ExecutorReviewProposalReviewRequestService, readExecutorReviewProposalReviewRequestInput, readExecutorReviewProposalReviewRequestPreviewInput } from "./commander-executor-review/executor-review-proposal-review-request-service"
import type { ExecutorReviewProposalReviewRequestPreview, ExecutorReviewProposalReviewRequestRecord, ExecutorReviewProposalReviewRequestResult } from "./commander-executor-review/executor-review-proposal-review-request-types"
import { ExecutorReviewProposalReviewDecisionService, readExecutorReviewProposalReviewDecisionInput, readExecutorReviewProposalReviewDecisionPreviewInput } from "./commander-executor-review/executor-review-proposal-review-decision-service"
import type { ExecutorReviewProposalReviewDecisionPreview, ExecutorReviewProposalReviewDecisionRecord, ExecutorReviewProposalReviewDecisionResult } from "./commander-executor-review/executor-review-proposal-review-decision-types"
import { ExecutorReviewProposalApplyReadinessService, readExecutorReviewProposalApplyReadinessInput } from "./commander-executor-review/executor-review-proposal-apply-readiness-service"
import type { ExecutorReviewProposalApplyCandidateKind, ExecutorReviewProposalApplyReadinessPreview, ExecutorReviewProposalApplyReadinessRecord, ExecutorReviewProposalApplyReadinessStatus, ExecutorReviewProposalApplyReadinessSummary } from "./commander-executor-review/executor-review-proposal-apply-readiness-types"
import { ExecutorReviewProposalNarrowApplyService, readExecutorReviewProposalNarrowApplyInput, readExecutorReviewProposalNarrowApplyPreviewInput } from "./commander-executor-review/executor-review-proposal-narrow-apply-service"
import type { ExecutorReviewProposalNarrowApplyPreview, ExecutorReviewProposalNarrowApplyRecord, ExecutorReviewProposalNarrowApplyResult } from "./commander-executor-review/executor-review-proposal-narrow-apply-types"
import { MiniMaxReasoningProvider } from "./reasoning/minimax-provider"
import { defaultReasoningProviderConfig, reasoningProviderStatus, validateReasoningProviderConfig, type ReasoningProviderConfig, type ReasoningProviderStatus } from "./reasoning/reasoning-provider-config"
import { ReasoningProviderHealthService } from "./reasoning/reasoning-health-service"
import type { ReasoningProviderHealth, ReasoningProviderSmokeInput, ReasoningProviderSmokePreview, ReasoningProviderSmokeResult } from "./reasoning/reasoning-health-types"
import { MiniMaxLiveValidationService } from "./reasoning/minimax-live-validation-service"
import type { MiniMaxLiveValidationInput, MiniMaxLiveValidationPreview, MiniMaxLiveValidationRecord, MiniMaxLiveValidationResult, MiniMaxLiveValidationSurface } from "./reasoning/minimax-live-validation-types"
import { OpenCodeHandoffService } from "./opencode/opencode-handoff-service"
import type { OpenCodeHandoffInput, OpenCodeHandoffPreview, OpenCodeHandoffRecord, OpenCodeHandoffResult } from "./opencode/opencode-handoff-types"
import { OpenCodeHandoffFollowupService, readOpenCodeHandoffFollowupQueueKind } from "./opencode/opencode-handoff-followup-service"
import type { OpenCodeHandoffFollowup, OpenCodeHandoffFollowupQueue, OpenCodeHandoffFollowupSummary } from "./opencode/opencode-handoff-followup-types"
import { OpenCodeProcessSmokeService } from "./opencode/opencode-process-smoke-service"
import type { OpenCodeProcessSmokeExecuteInput, OpenCodeProcessSmokePreview, OpenCodeProcessSmokeRecord, OpenCodeProcessSmokeResult } from "./opencode/opencode-process-smoke-types"
import { OpenCodeHandoffReadinessService, readOpenCodeHandoffReadinessInput } from "./opencode/opencode-handoff-readiness-service"
import type { OpenCodeHandoffReadinessPreview, OpenCodeHandoffReadinessSummary } from "./opencode/opencode-handoff-readiness-types"
import { OpenCodeResultReviewPacketService, readOpenCodeResultReviewPacketInput } from "./opencode/opencode-result-review-packet-service"
import type { OpenCodeResultReviewPacket, OpenCodeResultReviewSummary } from "./opencode/opencode-result-review-packet-types"
import { OpenCodeSessionService, readOpenCodeSessionCreateInput, readOpenCodeSessionPreviewInput } from "./opencode-session/opencode-session-service"
import type { OpenCodeSessionPlan, OpenCodeSessionPreview, OpenCodeSessionRecord, OpenCodeSessionSourceKind, OpenCodeSessionStatus, OpenCodeSessionSummary } from "./opencode-session/opencode-session-types"
import { OpenCodeSessionInstructionPackService, readOpenCodeSessionInstructionPackPreviewInput, readOpenCodeSessionInstructionPackWriteInput } from "./opencode-session/opencode-session-instruction-pack-service"
import type { OpenCodeSessionInstructionPackPreview, OpenCodeSessionInstructionPackRecord, OpenCodeSessionInstructionPackResult } from "./opencode-session/opencode-session-instruction-pack-types"
import { OpenCodeLaunchReadinessService, readOpenCodeLaunchReadinessPreviewInput, readOpenCodeLaunchReadinessSummaryInput } from "./opencode-session/opencode-launch-readiness-service"
import type { OpenCodeLaunchReadinessPreview, OpenCodeLaunchReadinessSummary } from "./opencode-session/opencode-launch-readiness-types"
import { DisabledOpenCodeLaunchAdapter, FakeOpenCodeLaunchAdapter, type OpenCodeLaunchAdapter } from "./opencode-session/opencode-launch-adapter"
import { ProcessOpenCodeLaunchAdapter } from "./opencode-session/opencode-native-launch-adapter"
import { OpenCodeLaunchGateService, readOpenCodeLaunchInput, readOpenCodeLaunchPreviewInput } from "./opencode-session/opencode-launch-gate-service"
import type { OpenCodeLaunchPreview, OpenCodeLaunchRecord, OpenCodeLaunchResult } from "./opencode-session/opencode-launch-gate-types"
import { OpenCodeProgressService, readOpenCodeProgressAppendInput, readOpenCodeProgressPreviewInput } from "./opencode-session/opencode-progress-service"
import type { OpenCodeProgressPreview, OpenCodeProgressRecord, OpenCodeProgressResult, OpenCodeProgressSummary } from "./opencode-session/opencode-progress-types"
import { OpenCodeTimeoutWatchdogService, readOpenCodeForcedReportInput, readOpenCodeWatchdogPreviewInput, readOpenCodeWatchdogRecordInput } from "./opencode-session/opencode-timeout-watchdog-service"
import type { OpenCodeForcedReportRequest, OpenCodeWatchdogPreview, OpenCodeWatchdogRecord, OpenCodeWatchdogResult, OpenCodeWatchdogSummary } from "./opencode-session/opencode-timeout-watchdog-types"
import { OpenCodeCommanderQuestionService, readOpenCodeCommanderQuestionCreateInput, readOpenCodeCommanderQuestionPreviewInput } from "./opencode-session/opencode-commander-question-service"
import type { OpenCodeCommanderQuestionPreview, OpenCodeCommanderQuestionRecord, OpenCodeCommanderQuestionResult, OpenCodeCommanderQuestionSummary } from "./opencode-session/opencode-commander-question-types"
import { CommanderGuidanceService, readCommanderGuidanceCreateInput, readCommanderGuidancePreviewInput } from "./opencode-session/opencode-commander-guidance-service"
import type { CommanderGuidancePreview, CommanderGuidanceRecord, CommanderGuidanceResult, CommanderGuidanceSummary } from "./opencode-session/opencode-commander-guidance-types"
import { CommanderGuidanceDeliveryService, readCommanderGuidanceDeliveryInput, readCommanderGuidanceDeliveryPreviewInput } from "./opencode-session/opencode-guidance-delivery-service"
import type { CommanderGuidanceDeliveryPreview, CommanderGuidanceDeliveryRecord, CommanderGuidanceDeliveryResult, CommanderGuidanceDeliverySummary } from "./opencode-session/opencode-guidance-delivery-types"
import { OpenCodeHumanControlService, readOpenCodeHumanControlPreviewInput, readOpenCodeHumanControlRecordInput } from "./opencode-session/opencode-human-control-service"
import type { OpenCodeHumanControlPreview, OpenCodeHumanControlProjectionState, OpenCodeHumanControlRecord, OpenCodeHumanControlResult, OpenCodeHumanControlSummary } from "./opencode-session/opencode-human-control-types"
import { OpenCodeWakeSupervisorService, readOpenCodeWakeSupervisorPreviewInput, readOpenCodeWakeSupervisorSummaryInput } from "./opencode-session/opencode-wake-supervisor-service"
import type { OpenCodeWakeSupervisorPreview, OpenCodeWakeSupervisorSummary } from "./opencode-session/opencode-wake-supervisor-types"
import { OpenCodeWakeSupervisorExecutionService, readOpenCodeWakeSupervisorBatchPreviewInput, readOpenCodeWakeSupervisorBatchRecordInput, readOpenCodeWakeSupervisorExecutionPreviewInput, readOpenCodeWakeSupervisorExecutionRecordInput } from "./opencode-session/opencode-wake-supervisor-execution-service"
import type { OpenCodeWakeSupervisorBatchPreview, OpenCodeWakeSupervisorBatchResult, OpenCodeWakeSupervisorExecutionPreview, OpenCodeWakeSupervisorExecutionRecord, OpenCodeWakeSupervisorExecutionResult, OpenCodeWakeSupervisorExecutionSummary } from "./opencode-session/opencode-wake-supervisor-execution-types"
import { OpenCodeWakeActionExecutionService, readOpenCodeWakeActionExecutionPreviewInput, readOpenCodeWakeActionExecutionRecordInput } from "./opencode-session/opencode-wake-action-execution-service"
import type { OpenCodeWakeActionExecutionPreview, OpenCodeWakeActionExecutionRecord, OpenCodeWakeActionExecutionResult, OpenCodeWakeActionExecutionSummary } from "./opencode-session/opencode-wake-action-execution-types"
import { OpenCodeResultReportService, readOpenCodeResultReportPreviewInput, readOpenCodeResultReportRecordInput } from "./opencode-session/opencode-result-report-service"
import type { OpenCodeResultReportPreview, OpenCodeResultReportRecord, OpenCodeResultReportResult, OpenCodeResultReportSummary } from "./opencode-session/opencode-result-report-types"
import { OpenCodeResultReviewService, readOpenCodeResultReviewPreviewInput, readOpenCodeResultReviewRecordInput } from "./opencode-session/opencode-result-review-service"
import type { OpenCodeResultReviewPreview, OpenCodeResultReviewRecord, OpenCodeResultReviewResult, OpenCodeResultReviewSummary as OpenCodeResultReviewGateSummary } from "./opencode-session/opencode-result-review-types"
import { ContextBudgetService, readContextBudgetPreviewInput, readModelCapabilityGetInput, readModelCapabilityListInput } from "./context/context-budget-service"
import type { ContextBudgetPreview, ContextBudgetSummary } from "./context/context-budget-types"
import { ModelCapabilityRegistry } from "./context/model-capability-registry"
import type { ModelCapability } from "./context/model-capability-types"
import { ContextPacketCompilerService, readContextPacketPreviewInput } from "./context/context-packet-compiler-service"
import type { ContextPacketPreview, ContextPacketSummary } from "./context/context-packet-types"
import { ResearchMemoryService, readResearchMemoryInspectionInput, readResearchMemoryNearDuplicateInput, readResearchMemoryRetrievalInput, type ResearchMemoryReadAdapter } from "./research-memory/research-memory-service"
import { ResearchNoveltyService, readResearchNoveltyInput } from "./research-memory/research-novelty-service"
import type { ResearchMemoryInspectionPreview, ResearchMemoryNearDuplicatePreview, ResearchMemoryRetrievalPreview, ResearchMemorySearchProfile, ResearchMemorySummary, ResearchNoveltyPreview } from "./research-memory/research-memory-types"
import { ResearchIngestionService, readResearchIngestionPreviewInput, readResearchIngestionRecordInput, type ResearchIngestionDbWriter } from "./research/research-ingestion-service"
import type { ResearchIngestionPreview, ResearchIngestionRecord, ResearchIngestionResult, ResearchIngestionSummary } from "./research/research-ingestion-types"
import { CommanderContinuityService, readCommanderContinuityOpenLoopInput, readCommanderContinuitySummaryInput, readCommanderContinuityThreadInput, readCommanderMidMissionContinuityInput, readCommanderProposalContinuityInput } from "./continuity/commander-continuity-service"
import type { CommanderContinuityOpenLoop, CommanderContinuitySummary, CommanderContinuityThreadCard, CommanderMidMissionContinuityPacket, CommanderProposalContinuityPacket } from "./continuity/commander-continuity-types"
import { CommanderToolService, readCommanderToolGetInput, readCommanderToolListInput, readCommanderToolSearchInput } from "./commander-tools/commander-tool-service"
import type { CommanderToolBootstrapPreview, CommanderToolDescriptor, CommanderToolDescriptorSummary, CommanderToolPhase, CommanderToolProfile, CommanderToolRegistrySummary, CommanderToolRegistryValidation, CommanderToolSearchPreview } from "./commander-tools/commander-tool-types"
import { CommanderOperationalMemorySearchService, readCommanderOperationalMemorySearchInput, type CommanderOperationalMemoryRecord, type CommanderOperationalMemorySearchInput } from "./commander-tools/commander-operational-memory-search-service"
import { CommanderRepoReadService } from "./commander-tools/commander-repo-read-service"
import type { CommanderDependencyManifestResult, CommanderGitDiffResult, CommanderGitLogResult, CommanderGitStatusResult, CommanderInternalReadResult, CommanderOperationalMemorySearchPreview, CommanderRepoFileResult, CommanderRepoSearchResult, CommanderRepoSymbolResult, CommanderRepoTreeResult, CommanderTestManifestResult } from "./commander-tools/commander-read-types"
import { OpenCodeSessionContinuityService, readOpenCodeContinuationInput, readOpenCodeSessionContinuityInput } from "./opencode-session/opencode-session-continuity-service"
import type { OpenCodeContinuationPacket, OpenCodeSessionContinuityPacket } from "./opencode-session/opencode-session-continuity-types"
import { OpenCodeContextRefreshService, readOpenCodeContextRefreshWriteInput } from "./opencode-session/opencode-context-refresh-service"
import type { OpenCodeContextRefreshPreview, OpenCodeContextRefreshRecord, OpenCodeContextRefreshResult, OpenCodeContextRefreshSummary } from "./opencode-session/opencode-context-refresh-types"
import type { OpenCodeSpawn } from "./opencode/process-adapter"
import { RuntimeCheckpointService, readRuntimeCheckpointScope } from "./checkpoints/runtime-checkpoint-service"
import type { RuntimeCheckpoint, RuntimeCheckpointInput, RuntimeCheckpointPreview, RuntimeCheckpointRecord, RuntimeCheckpointSections } from "./checkpoints/runtime-checkpoint-types"
import { RuntimeRestoreService } from "./checkpoints/runtime-restore-service"
import type { RuntimeRestoreInput, RuntimeRestorePreview, RuntimeResumeAnchor } from "./checkpoints/runtime-restore-types"
import { WakeAssessmentService, readWakeAssessmentInput } from "./wake/wake-hook-service"
import type { WakeAssessment, WakeAssessmentPreview, WakeAssessmentRecord } from "./wake/wake-hook-types"
import { ContinuationService, readContinuationPlanDecisionInput, readContinuationPlanInput, readContinuationStepInput } from "./continuation/continuation-service"
import type { ContinuationPlan, ContinuationPlanPreview, ContinuationPlanRecord, ContinuationStepResult } from "./continuation/continuation-types"
import { WakeScheduleService, readWakeScheduleDecisionInput, readWakeScheduleInput, readWakeScheduleTickInput } from "./schedules/wake-schedule-service"
import type { WakeSchedule, WakeSchedulePreview, WakeScheduleRecord, WakeScheduleTickPreview, WakeScheduleTickResult } from "./schedules/wake-schedule-types"
import { WakeSchedulerService, readWakeSchedulerStartInput, readWakeSchedulerStopInput } from "./schedules/wake-scheduler-service"
import type { WakeSchedulerEventRecord, WakeSchedulerPreview, WakeSchedulerState } from "./schedules/wake-scheduler-types"
import { WakeSchedulerBootstrapService } from "./schedules/wake-scheduler-bootstrap-service"
import type { WakeSchedulerBootstrapConfig, WakeSchedulerBootstrapStatus } from "./schedules/wake-scheduler-bootstrap-types"
import { WakeSchedulerRecoveryService, readWakeSchedulerRecoveryAcknowledgeInput } from "./schedules/wake-scheduler-recovery-service"
import type { WakeSchedulerRecovery, WakeSchedulerRecoveryPreview, WakeSchedulerRecoveryRecord } from "./schedules/wake-scheduler-recovery-types"
import { WakeSchedulerRecoveryWorkflowService, readWakeSchedulerRecoveryWorkflowCancelInput, readWakeSchedulerRecoveryWorkflowInput, readWakeSchedulerRecoveryWorkflowStepRecordInput } from "./schedules/wake-scheduler-recovery-workflow-service"
import type { WakeSchedulerRecoveryWorkflow, WakeSchedulerRecoveryWorkflowPreview, WakeSchedulerRecoveryWorkflowRecord, WakeSchedulerRecoveryWorkflowVerification } from "./schedules/wake-scheduler-recovery-workflow-types"
import { WakeSchedulerAuditService, readWakeSchedulerAuditQuery } from "./schedules/wake-scheduler-audit-service"
import type { WakeSchedulerAuditChain, WakeSchedulerAuditIncident, WakeSchedulerAuditQuery, WakeSchedulerAuditSummary, WakeSchedulerAuditTimelineEntry } from "./schedules/wake-scheduler-audit-types"
import { WakeSchedulerNavigationService } from "./schedules/wake-scheduler-navigation-service"
import type { WakeSchedulerNavigationBoard, WakeSchedulerNavigationCommandPreview, WakeSchedulerNavigationInput, WakeSchedulerNavigationTarget } from "./schedules/wake-scheduler-navigation-types"
import { WakeSchedulerNavigationStagingService, readWakeSchedulerNavigationStageClearInput, readWakeSchedulerNavigationStageInput, readWakeSchedulerNavigationStageRemoveInput } from "./schedules/wake-scheduler-navigation-staging-service"
import type { WakeSchedulerNavigationStagePreview, WakeSchedulerNavigationStagedCommand, WakeSchedulerNavigationStagedCommandRecord } from "./schedules/wake-scheduler-navigation-staging-types"
import { WakeSchedulerNavigationReadExecutor } from "./schedules/wake-scheduler-navigation-read-executor"
import { WakeSchedulerNavigationStagedRunService, readWakeSchedulerNavigationStagedRunInput, readWakeSchedulerNavigationStagedRunListInput } from "./schedules/wake-scheduler-navigation-staged-run-service"
import type { WakeSchedulerNavigationStagedRunPreview, WakeSchedulerNavigationStagedRunRecord, WakeSchedulerNavigationStagedRunResult } from "./schedules/wake-scheduler-navigation-staged-run-types"
import { WakeSchedulerNavigationStagedReadCompareService, readWakeSchedulerNavigationStagedReadCompareInput, readWakeSchedulerNavigationStagedReadGroupInput, readWakeSchedulerNavigationStagedReadHistoryInput, readWakeSchedulerNavigationStagedReadStaleInput } from "./schedules/wake-scheduler-navigation-staged-read-compare-service"
import type { WakeSchedulerNavigationStagedReadGroup, WakeSchedulerNavigationStagedReadHistory, WakeSchedulerNavigationStagedReadPairComparison, WakeSchedulerNavigationStagedReadStaleItem } from "./schedules/wake-scheduler-navigation-staged-read-compare-types"
import { WakeSchedulerNavigationWritePreviewService, readWakeSchedulerNavigationWriteBoardInput, readWakeSchedulerNavigationWritePreviewInput } from "./schedules/wake-scheduler-navigation-write-preview-service"
import type { WakeSchedulerNavigationWriteBoard, WakeSchedulerNavigationWritePreview } from "./schedules/wake-scheduler-navigation-write-preview-types"
import { WakeSchedulerNavigationWriteStagingService, readWakeSchedulerNavigationWriteStageClearInput, readWakeSchedulerNavigationWriteStageInput, readWakeSchedulerNavigationWriteStageRemoveInput } from "./schedules/wake-scheduler-navigation-write-staging-service"
import type { WakeSchedulerNavigationStagedWriteCommand, WakeSchedulerNavigationStagedWriteCommandRecord, WakeSchedulerNavigationWriteStagePreview } from "./schedules/wake-scheduler-navigation-write-staging-types"
import { WakeSchedulerNavigationLowRiskWriteExecutor } from "./schedules/wake-scheduler-navigation-low-risk-write-executor"
import { WakeSchedulerNavigationWriteRunService, readWakeSchedulerNavigationWriteRunInput, readWakeSchedulerNavigationWriteRunListInput } from "./schedules/wake-scheduler-navigation-write-run-service"
import type { WakeSchedulerNavigationWriteRunPreview, WakeSchedulerNavigationWriteRunRecord, WakeSchedulerNavigationWriteRunResult } from "./schedules/wake-scheduler-navigation-write-run-types"
import { WakeSchedulerNavigationWriteRunCompareService, readWakeSchedulerNavigationWriteRunCompareInput, readWakeSchedulerNavigationWriteRunGroupInput, readWakeSchedulerNavigationWriteRunHistoryInput, readWakeSchedulerNavigationWriteRunStaleInput } from "./schedules/wake-scheduler-navigation-write-run-compare-service"
import type { WakeSchedulerNavigationWriteRunGroup, WakeSchedulerNavigationWriteRunHistory, WakeSchedulerNavigationWriteRunPairComparison, WakeSchedulerNavigationWriteRunStaleItem } from "./schedules/wake-scheduler-navigation-write-run-compare-types"
import { WakeSchedulerNavigationWriteApprovalService, readWakeSchedulerNavigationWriteApprovalInput, readWakeSchedulerNavigationWriteApprovalListInput, readWakeSchedulerNavigationWriteApprovalRejectInput, readWakeSchedulerNavigationWriteApprovalRevokeInput, readWakeSchedulerNavigationWriteReadinessInput } from "./schedules/wake-scheduler-navigation-write-approval-service"
import type { WakeSchedulerNavigationWriteApproval, WakeSchedulerNavigationWriteApprovalRecord, WakeSchedulerNavigationWriteReadinessPreview } from "./schedules/wake-scheduler-navigation-write-approval-types"
import { WakeSchedulerNavigationCheckpointWriteExecutor } from "./schedules/wake-scheduler-navigation-checkpoint-write-executor"
import { WakeSchedulerNavigationCheckpointWriteRunService, readWakeSchedulerNavigationCheckpointWriteRunInput, readWakeSchedulerNavigationCheckpointWriteRunListInput } from "./schedules/wake-scheduler-navigation-checkpoint-write-run-service"
import type { WakeSchedulerNavigationCheckpointWriteRunPreview, WakeSchedulerNavigationCheckpointWriteRunRecord, WakeSchedulerNavigationCheckpointWriteRunResult } from "./schedules/wake-scheduler-navigation-checkpoint-write-run-types"
import { WakeSchedulerNavigationCheckpointWriteCompareService, readWakeSchedulerNavigationCheckpointApprovalUsageInput, readWakeSchedulerNavigationCheckpointWriteCompareInput, readWakeSchedulerNavigationCheckpointWriteGroupInput, readWakeSchedulerNavigationCheckpointWriteHistoryInput, readWakeSchedulerNavigationCheckpointWriteStaleInput } from "./schedules/wake-scheduler-navigation-checkpoint-write-compare-service"
import type { WakeSchedulerNavigationCheckpointApprovalUsageSummary, WakeSchedulerNavigationCheckpointWriteGroup, WakeSchedulerNavigationCheckpointWriteHistory, WakeSchedulerNavigationCheckpointWritePairComparison, WakeSchedulerNavigationCheckpointWriteStaleItem } from "./schedules/wake-scheduler-navigation-checkpoint-write-compare-types"
import { CommandAuthorityService } from "./authority/command-authority-service"
import { COMMAND_AUTHORITY_REGISTRY } from "./authority/command-authority-registry"
import { COMMANDER_TOOL_REGISTRY } from "./commander-tools/commander-tool-registry"
import {
  createCommanderToolBindingRegistry,
  CommanderInvestigationBootstrapService,
  CommanderInvestigationContextService,
  CommanderInvestigationController,
  CommanderInvestigationJournalService,
  CommanderInvestigationJournalConflictError,
  CommanderInvestigationPersistenceError,
  CommanderInvestigationRecoveryApprovalService,
  CommanderInvestigationRecoveryContinuationBuilder,
  CommanderInvestigationRecoveryExecutionService,
  CommanderInvestigationRecoveryOperatorService,
  CommanderInvestigationRecoveryService,
  CommanderInvestigationRecoveryTransactionService,
  CommanderToolExecutor,
  ConnectorBackedCommanderModelStepAdapter,
  commanderInvestigationModelCapability,
  ANTHROPIC_MESSAGES_PROTOCOL_VERSION,
  ANTHROPIC_MESSAGES_PROVIDER_ADAPTER_VERSION,
  ANTHROPIC_MESSAGES_REQUEST_SHAPE_POLICY_VERSION,
  connectorChatCompletionsUrl,
  connectorModelRequestUrl,
  normalizeCommanderInvestigationRecoveryTransactionInput,
  stableHash,
  commanderRecoveryTransactionBlockedResult,
  validateCommanderInvestigationProviderConfig,
  validateCommanderConnectorProtocolPolicy,
  type CommanderInvestigationControlGate,
  type CommanderInvestigationControlSnapshot,
  type CommanderInvestigationInput,
  type CommanderInvestigationResult,
  type CommanderInvestigationJournalListOptions,
  type CommanderInvestigationRecord,
  type CommanderInvestigationCheckpoint,
  type CommanderInvestigationJournalSummary,
  type CommanderInvestigationRecoveryPreview,
  type CommanderInvestigationRecoveryPreviewInput,
  type CommanderInvestigationRecoveryApprovalInput,
  type CommanderInvestigationRecoveryApprovalPreview,
  type CommanderInvestigationRecoveryApprovalResult,
  type CommanderInvestigationRecoveryExecutionPreparationInput,
  type CommanderInvestigationRecoveryExecutionPreparationPreview,
  type CommanderInvestigationRecoveryExecutionEnvelope,
  type CommanderInvestigationRecoveryTransactionInput,
  type CommanderInvestigationRecoveryTransactionResult,
  type CommanderInvestigationRecoveryAttemptSummary,
  type CommanderRecoveryOperatorList,
  type CommanderRecoveryOperatorDetail,
  type CommanderRecoveryOperatorMissing,
  type CommanderRecoveryOperatorPreview,
  type CommanderRecoveryOperation,
  type CommanderRecoveryCancelInput,
  type CommanderRecoveryCancellationResult,
  type CommanderInvestigationRecoverySource,
  type CommanderInvestigationProviderConfig,
  type CommanderInvestigationProviderGate,
  type CommanderInvestigationProviderPreflightSnapshot,
  type CommanderInvestigationProviderReadiness,
  type CommanderInvestigationProviderReadinessCheck,
  type CommanderInvestigationProviderReadinessInput,
  type CommanderRuntimeLifecycleState,
  type CommanderModelStepAdapter,
  type CommanderToolBindingRegistry,
  type CommanderToolExecutionRequest,
  type CommanderToolExecutionResult,
} from "./commander-agent"
import { MissionToolRouter } from "./missions/mission-tool-router"
import type { ExecutorToolCall, ExecutorToolResult } from "./missions/mission-tool-types"
import { PolicyService } from "./spec/policy-service"
import { SpecService, type SpecSummary } from "./spec/spec-service"
import { redactText, redactValue } from "./security/redaction"
import { adaptLegacyCommanderModelAuthority } from "./model-configuration/model-profile-legacy-commander-adapter"
import { ModelProfileRuntimeRegistry } from "./model-configuration/model-profile-runtime-registry"
import {
  ResearchDb,
  type ListResearchEventsOptions,
  type Note,
  type ResearchProjectionIntegrity,
  type ResearchProjectionStatus,
  type ResearchEvent,
  type SearchOptions,
  type Topic,
  type TopicSnapshot,
  type ResearchResultInput,
  type ResearchResult,
} from "./research-db/research-db"

const EXECUTOR_SHUTDOWN_DRAIN_TIMEOUT_MS = 50
const READ_ONLY_RESEARCH_INGESTION_DB: ResearchIngestionDbWriter = {
  proposeResearchResult() {
    throw new Error("read-only research ingestion projection cannot write research memory")
  },
  acceptResearchResult() {
    throw new Error("read-only research ingestion projection cannot accept research memory")
  },
}

export interface RuntimeServerOptions {
  projectDir?: string
  mode?: RuntimeMode
  adapter?: OpenCodeRuntimeAdapter
  openCodeAdapterConfig?: OpenCodeAdapterConfig
  openCodeAdapterFactoryOptions?: Omit<OpenCodeAdapterFactoryOptions, "projectDir">
  missionRegistry?: MissionRegistry
  reviewRegistry?: ReviewRegistry
  proposalRegistry?: ProposalRegistry
  proposalBundleRegistry?: ProposalBundleRegistry
  commanderPlaybookDraftRegistry?: CommanderPlaybookDraftRegistry
  externalApiConnectorRegistry?: ExternalApiConnectorRegistry
  externalApiConnectors?: ExternalApiConnector[]
  externalApiTransport?: ExternalApiTransport
  externalApiEnv?: Record<string, string | undefined>
  externalApiResolveHostAddresses?: ExternalApiHostResolver
  externalApiNow?: () => Date
  externalApiRequestId?: () => string
  reasoningProviderConfig?: ReasoningProviderConfig
  researchSynthesisProvider?: ResearchSynthesisProvider
  researchSynthesisNow?: () => Date
  researchSynthesisId?: () => string
  commanderCycleProvider?: CommanderCycleProvider
  commanderCycleNow?: () => Date
  commanderCycleId?: () => string
  commanderExecutorReviewProvider?: CommanderExecutorReviewProvider
  commanderExecutorReviewNow?: () => Date
  commanderExecutorReviewId?: () => string
  opencodeHandoffNow?: () => Date
  opencodeHandoffId?: () => string
  opencodeProcessSmokeEnv?: Record<string, string | undefined>
  opencodeProcessSmokeNow?: () => Date
  opencodeProcessSmokeId?: () => string
  opencodeProcessSmokeSpawn?: OpenCodeSpawn
  opencodeLaunchEnv?: Record<string, string | undefined>
  opencodeLaunchAdapter?: OpenCodeLaunchAdapter
  opencodeLaunchNow?: () => Date
  opencodeLaunchId?: () => string
  opencodeLaunchSpawn?: OpenCodeSpawn
  opencodeWatchdogNow?: () => Date
  opencodeWatchdogId?: () => string
  opencodeForcedReportId?: () => string
  runtimeCheckpointNow?: () => Date
  runtimeCheckpointId?: () => string
  runtimeResumeNow?: () => Date
  runtimeResumeId?: () => string
  runtimeWakeNow?: () => Date
  runtimeWakeId?: () => string
  runtimeContinuationNow?: () => Date
  runtimeContinuationId?: () => string
  runtimeContinuationStepId?: () => string
  runtimeWakeScheduleNow?: () => Date
  runtimeWakeScheduleId?: () => string
  runtimeWakeScheduleTickId?: () => string
  runtimeWakeSchedulerNow?: () => Date
  runtimeWakeSchedulerSetTimer?: (callback: () => void, delayMs: number) => unknown
  runtimeWakeSchedulerClearTimer?: (timer: unknown) => void
  runtimeWakeSchedulerMinIntervalMs?: number
  runtimeWakeSchedulerMinHeartbeatIntervalMs?: number
  wakeSchedulerBootstrapConfig?: WakeSchedulerBootstrapConfig
  researchProjectionMode?: RuntimeResearchProjectionMode
  researchDb?: RuntimeResearchDbProjection
  researchDbFactory?: (projectDir: string) => RuntimeResearchDbProjection
  commanderQueueNow?: () => Date
  commanderModelStepAdapter?: CommanderModelStepAdapter
  commanderInvestigationProviderConfig?: CommanderInvestigationProviderConfig
  modelProfileRuntimeRegistry?: ModelProfileRuntimeRegistry
  commanderInvestigationControlGate?: CommanderInvestigationControlGate
  commanderGithubGatewayConfig?: CommanderGithubGatewayConfig
}

export interface RuntimeResearchDbReader {
  close(): void
  listTopics(): Topic[]
  searchTopics(query: string, options?: SearchOptions): Topic[]
  getTopicSnapshot(topicId: string): TopicSnapshot | null
  listResearchEvents(options?: ListResearchEventsOptions): ResearchEvent[]
  searchNotes(topicId: string, query: string, options?: SearchOptions): Note[]
}

export interface RuntimeResearchDbProjection extends RuntimeResearchDbReader {
  checkProjectionIntegrity(eventsPath?: string): ResearchProjectionIntegrity
  rebuildFromEvents(eventsPath?: string): void
  getProjectionStatus(): ResearchProjectionStatus
  repairResearchResultsFtsProjectionIfNeeded?(): void
  getTopic(id: string): Topic | null
  addSource(input: Parameters<ExternalApiResearchDbWriter["addSource"]>[0]): ReturnType<ExternalApiResearchDbWriter["addSource"]>
  addNote(input: Parameters<ExternalApiResearchDbWriter["addNote"]>[0]): ReturnType<ExternalApiResearchDbWriter["addNote"]>
  addArtifact(input: Parameters<ExternalApiResearchDbWriter["addArtifact"]>[0]): ReturnType<ExternalApiResearchDbWriter["addArtifact"]>
  proposeResearchResult(input: ResearchResultInput): ResearchResult
  acceptResearchResult(resultId: string): ResearchResult
}

export class RuntimeServer {
  readonly projectDir: string
  readonly mode: RuntimeMode
  readonly eventStore: EventStore
  readonly eventBus = new RuntimeEventBus()
  readonly specService: SpecService
  readonly policyService: PolicyService
  readonly adapter: OpenCodeRuntimeAdapter
  readonly missionRegistry: MissionRegistry
  readonly reviewRegistry: ReviewRegistry
  readonly proposalRegistry: ProposalRegistry
  readonly proposalBundleRegistry: ProposalBundleRegistry
  readonly commanderPlaybookDraftRegistry: CommanderPlaybookDraftRegistry
  readonly externalApiConnectorRegistry: ExternalApiConnectorRegistry
  private readonly openCodeAdapterConfig?: OpenCodeAdapterConfig
  private readonly runLock: RunLock
  private readonly externalApiTransport: ExternalApiTransport
  private readonly externalApiEnv: Record<string, string | undefined>
  private readonly externalApiResolveHostAddresses?: ExternalApiHostResolver
  private readonly externalApiNow?: () => Date
  private readonly externalApiRequestId?: () => string
  private readonly reasoningProviderConfig: ReasoningProviderConfig
  private readonly modelCapabilityRegistry: ModelCapabilityRegistry
  private readonly researchSynthesisProvider: ResearchSynthesisProvider
  private readonly researchSynthesisNow?: () => Date
  private readonly researchSynthesisId?: () => string
  private readonly commanderCycleProvider: CommanderCycleProvider
  private readonly commanderCycleNow?: () => Date
  private readonly commanderCycleId?: () => string
  private readonly commanderExecutorReviewProvider: CommanderExecutorReviewProvider
  private readonly commanderExecutorReviewNow?: () => Date
  private readonly commanderExecutorReviewId?: () => string
  private readonly opencodeHandoffNow?: () => Date
  private readonly opencodeHandoffId?: () => string
  private readonly opencodeProcessSmokeEnv: Record<string, string | undefined>
  private readonly opencodeProcessSmokeNow?: () => Date
  private readonly opencodeProcessSmokeId?: () => string
  private readonly opencodeProcessSmokeSpawn?: OpenCodeSpawn
  private readonly opencodeLaunchEnv: Record<string, string | undefined>
  private readonly opencodeLaunchAdapter?: OpenCodeLaunchAdapter
  private readonly opencodeLaunchNow?: () => Date
  private readonly opencodeLaunchId?: () => string
  private readonly opencodeLaunchSpawn?: OpenCodeSpawn
  private readonly opencodeWatchdogNow?: () => Date
  private readonly opencodeWatchdogId?: () => string
  private readonly opencodeForcedReportId?: () => string
  private readonly runtimeCheckpointNow?: () => Date
  private readonly runtimeCheckpointId?: () => string
  private readonly runtimeResumeNow?: () => Date
  private readonly runtimeResumeId?: () => string
  private readonly runtimeWakeNow?: () => Date
  private readonly runtimeWakeId?: () => string
  private readonly runtimeContinuationNow?: () => Date
  private readonly runtimeContinuationId?: () => string
  private readonly runtimeContinuationStepId?: () => string
  private readonly runtimeWakeScheduleNow?: () => Date
  private readonly runtimeWakeScheduleId?: () => string
  private readonly runtimeWakeScheduleTickId?: () => string
  private readonly runtimeWakeSchedulerNow?: () => Date
  private readonly runtimeWakeSchedulerSetTimer?: (callback: () => void, delayMs: number) => unknown
  private readonly runtimeWakeSchedulerClearTimer?: (timer: unknown) => void
  private readonly runtimeWakeSchedulerMinIntervalMs?: number
  private readonly runtimeWakeSchedulerMinHeartbeatIntervalMs?: number
  private readonly wakeSchedulerBootstrapConfig?: WakeSchedulerBootstrapConfig
  private readonly researchProjectionMode: RuntimeResearchProjectionMode
  private readonly researchDbFactory: (projectDir: string) => RuntimeResearchDbProjection
  private readonly commanderQueueNow?: () => Date
  private readonly commanderModelStepAdapter?: CommanderModelStepAdapter
  private readonly commanderInvestigationProviderConfig?: CommanderInvestigationProviderConfig
  private readonly modelProfileRuntimeRegistry?: ModelProfileRuntimeRegistry
  private readonly commanderInvestigationControlGate?: CommanderInvestigationControlGate
  private readonly commanderGithubGatewayConfig?: CommanderGithubGatewayConfig
  private readonly ownsResearchDb: boolean
  private researchDb: RuntimeResearchDbProjection | null = null
  private opencodeHandoffServiceInstance: OpenCodeHandoffService | null = null
  private opencodeProcessSmokeServiceInstance: OpenCodeProcessSmokeService | null = null
  private opencodeHandoffReadinessServiceInstance: OpenCodeHandoffReadinessService | null = null
  private opencodeResultReviewPacketServiceInstance: OpenCodeResultReviewPacketService | null = null
  private opencodeSessionServiceInstance: OpenCodeSessionService | null = null
  private opencodeSessionInstructionPackServiceInstance: OpenCodeSessionInstructionPackService | null = null
  private opencodeLaunchReadinessServiceInstance: OpenCodeLaunchReadinessService | null = null
  private opencodeLaunchGateServiceInstance: OpenCodeLaunchGateService | null = null
  private opencodeProgressServiceInstance: OpenCodeProgressService | null = null
  private opencodeTimeoutWatchdogServiceInstance: OpenCodeTimeoutWatchdogService | null = null
  private opencodeCommanderQuestionServiceInstance: OpenCodeCommanderQuestionService | null = null
  private commanderGuidanceServiceInstance: CommanderGuidanceService | null = null
  private commanderGuidanceDeliveryServiceInstance: CommanderGuidanceDeliveryService | null = null
  private opencodeHumanControlServiceInstance: OpenCodeHumanControlService | null = null
  private opencodeWakeSupervisorServiceInstance: OpenCodeWakeSupervisorService | null = null
  private opencodeWakeSupervisorExecutionServiceInstance: OpenCodeWakeSupervisorExecutionService | null = null
  private opencodeWakeActionExecutionServiceInstance: OpenCodeWakeActionExecutionService | null = null
  private opencodeResultReportServiceInstance: OpenCodeResultReportService | null = null
  private opencodeResultReviewServiceInstance: OpenCodeResultReviewService | null = null
  private researchIngestionServiceInstance: ResearchIngestionService | null = null
  private researchIngestionReadServiceInstance: Pick<ResearchIngestionService, "list" | "latest"> | null = null
  private commanderContinuityServiceInstance: CommanderContinuityService | null = null
  private commanderToolServiceInstance: CommanderToolService | null = null
  private commanderOperationalMemorySearchServiceInstance: CommanderOperationalMemorySearchService | null = null
  private commanderRepoReadServiceInstance: CommanderRepoReadService | null = null
  private commanderGithubReadServiceInstance: CommanderGithubReadService | null = null
  private commanderToolBindingRegistryInstance: CommanderToolBindingRegistry | null = null
  private commanderToolExecutorInstance: CommanderToolExecutor | null = null
  private commanderInvestigationBootstrapServiceInstance: CommanderInvestigationBootstrapService | null = null
  private commanderInvestigationContextServiceInstance: CommanderInvestigationContextService | null = null
  private commanderInvestigationControllerInstance: CommanderInvestigationController | null = null
  private commanderInvestigationJournalServiceInstance: CommanderInvestigationJournalService | null = null
  private commanderInvestigationRecoveryServiceInstance: CommanderInvestigationRecoveryService | null = null
  private commanderInvestigationRecoveryApprovalServiceInstance: CommanderInvestigationRecoveryApprovalService | null = null
  private commanderInvestigationRecoveryExecutionServiceInstance: CommanderInvestigationRecoveryExecutionService | null = null
  private commanderInvestigationRecoveryTransactionServiceInstance: CommanderInvestigationRecoveryTransactionService | null = null
  private commanderInvestigationRecoveryOperatorServiceInstance: CommanderInvestigationRecoveryOperatorService | null = null
  private opencodeSessionContinuityServiceInstance: OpenCodeSessionContinuityService | null = null
  private opencodeContextRefreshServiceInstance: OpenCodeContextRefreshService | null = null
  private contextBudgetServiceInstance: ContextBudgetService | null = null
  private contextPacketCompilerServiceInstance: ContextPacketCompilerService | null = null
  private researchMemoryServiceInstance: ResearchMemoryService | null = null
  private researchNoveltyServiceInstance: ResearchNoveltyService | null = null
  private commanderExecutorReviewServiceInstance: CommanderExecutorReviewService | null = null
  private executorReviewProposalDraftServiceInstance: ExecutorReviewProposalDraftService | null = null
  private executorReviewProposalCreateServiceInstance: ExecutorReviewProposalCreateService | null = null
  private executorReviewProposalReviewRequestServiceInstance: ExecutorReviewProposalReviewRequestService | null = null
  private executorReviewProposalReviewDecisionServiceInstance: ExecutorReviewProposalReviewDecisionService | null = null
  private executorReviewProposalApplyReadinessServiceInstance: ExecutorReviewProposalApplyReadinessService | null = null
  private executorReviewProposalNarrowApplyServiceInstance: ExecutorReviewProposalNarrowApplyService | null = null
  private minimaxLiveValidationServiceInstance: MiniMaxLiveValidationService | null = null
  private runtimeCheckpointServiceInstance: RuntimeCheckpointService | null = null
  private runtimeRestoreServiceInstance: RuntimeRestoreService | null = null
  private wakeAssessmentServiceInstance: WakeAssessmentService | null = null
  private continuationServiceInstance: ContinuationService | null = null
  private wakeScheduleServiceInstance: WakeScheduleService | null = null
  private wakeSchedulerServiceInstance: WakeSchedulerService | null = null
  private wakeSchedulerBootstrapServiceInstance: WakeSchedulerBootstrapService | null = null
  private wakeSchedulerRecoveryServiceInstance: WakeSchedulerRecoveryService | null = null
  private wakeSchedulerRecoveryWorkflowServiceInstance: WakeSchedulerRecoveryWorkflowService | null = null
  private wakeSchedulerAuditServiceInstance: WakeSchedulerAuditService | null = null
  private wakeSchedulerNavigationServiceInstance: WakeSchedulerNavigationService | null = null
  private wakeSchedulerNavigationStagingServiceInstance: WakeSchedulerNavigationStagingService | null = null
  private wakeSchedulerNavigationReadExecutorInstance: WakeSchedulerNavigationReadExecutor | null = null
  private wakeSchedulerNavigationStagedRunServiceInstance: WakeSchedulerNavigationStagedRunService | null = null
  private wakeSchedulerNavigationStagedReadCompareServiceInstance: WakeSchedulerNavigationStagedReadCompareService | null = null
  private wakeSchedulerNavigationWritePreviewServiceInstance: WakeSchedulerNavigationWritePreviewService | null = null
  private wakeSchedulerNavigationWriteStagingServiceInstance: WakeSchedulerNavigationWriteStagingService | null = null
  private wakeSchedulerNavigationLowRiskWriteExecutorInstance: WakeSchedulerNavigationLowRiskWriteExecutor | null = null
  private wakeSchedulerNavigationWriteRunServiceInstance: WakeSchedulerNavigationWriteRunService | null = null
  private wakeSchedulerNavigationWriteRunCompareServiceInstance: WakeSchedulerNavigationWriteRunCompareService | null = null
  private wakeSchedulerNavigationWriteApprovalServiceInstance: WakeSchedulerNavigationWriteApprovalService | null = null
  private wakeSchedulerNavigationCheckpointWriteExecutorInstance: WakeSchedulerNavigationCheckpointWriteExecutor | null = null
  private wakeSchedulerNavigationCheckpointWriteRunServiceInstance: WakeSchedulerNavigationCheckpointWriteRunService | null = null
  private wakeSchedulerNavigationCheckpointWriteCompareServiceInstance: WakeSchedulerNavigationCheckpointWriteCompareService | null = null
  private researchProjectionHealth: RuntimeResearchProjectionHealth
  private specSummary: SpecSummary | null = null
  private lifecycleState: CommanderRuntimeLifecycleState = "created"
  private lifecycleStartTask: Promise<void> | null = null
  private lifecycleShutdownTask: Promise<void> | null = null
  private lifecycleShutdownRequested = false
  private commanderInvestigationLifecycleAbort = new AbortController()
  private readonly activeConfiguredCommanderInvestigations = new Set<Promise<unknown>>()
  private readonly activeCommanderBoundReadTools = new Set<Promise<unknown>>()
  private readonly activeDurableCommanderInvestigations = new Set<{
    promise: Promise<unknown>
    investigation_id?: string
    run?: import("./commander-agent").CommanderInvestigationJournalRun
  }>()
  private readonly activeCommanderRecoveryApprovalWrites = new Set<Promise<unknown>>()
  private readonly activeCommanderRecoveryApprovalInvestigationIds = new Map<string, number>()
  private readonly activeConfiguredCommanderRecoveries = new Set<{
    promise: Promise<unknown>
    investigation_id: string
    run?: import("./commander-agent").CommanderInvestigationJournalRun
  }>()
  private readonly activeConfiguredCommanderRecoveryInvestigationIds = new Map<string, number>()
  private readonly publicCommanderRecoveryOperations = new Map<string, {
    record: CommanderRecoveryOperation
    controller: AbortController
    promise: Promise<void>
  }>()
  private readonly recentPublicCommanderRecoveryOperations = new Map<string, CommanderRecoveryOperation>()
  private readonly replaceablePublicCommanderRecoveryOperationIds = new Set<string>()
  private started = false
  private executorStreamTask: Promise<void> | null = null
  private executorStreamAbort = false
  private executorStreamError: string | null = null

  constructor(options: RuntimeServerOptions = {}) {
    this.projectDir = locateProjectRoot(options.projectDir)
    this.mode = options.mode ?? "active"
    this.eventStore = new EventStore(join(this.projectDir, ".nxl", "events.jsonl"))
    this.specService = new SpecService(this.projectDir)
    this.policyService = new PolicyService(this.projectDir)
    this.runLock = new RunLock(join(this.projectDir, ".nxl", "run.lock"))
    this.openCodeAdapterConfig = options.openCodeAdapterConfig
    this.adapter = options.adapter ?? (options.openCodeAdapterConfig ? createOpenCodeAdapter(options.openCodeAdapterConfig, { ...options.openCodeAdapterFactoryOptions, projectDir: this.projectDir }) : new FakeOpenCodeAdapter())
    this.registerExecutorToolHandler(this.adapter)
    this.missionRegistry = options.missionRegistry ?? new MissionRegistry({ eventStore: this.eventStore, projectDir: this.projectDir })
    this.reviewRegistry = options.reviewRegistry ?? new ReviewRegistry({ eventStore: this.eventStore, missionRegistry: this.missionRegistry })
    this.proposalRegistry = options.proposalRegistry ?? new ProposalRegistry({ eventStore: this.eventStore, missionRegistry: this.missionRegistry, reviewRegistry: this.reviewRegistry })
    this.proposalBundleRegistry = options.proposalBundleRegistry ?? new ProposalBundleRegistry({ eventStore: this.eventStore, proposalRegistry: this.proposalRegistry })
    this.commanderPlaybookDraftRegistry = options.commanderPlaybookDraftRegistry ?? new CommanderPlaybookDraftRegistry({ eventStore: this.eventStore, proposalRegistry: this.proposalRegistry, proposalBundleRegistry: this.proposalBundleRegistry, reviewRegistry: this.reviewRegistry })
    this.externalApiConnectorRegistry = options.externalApiConnectorRegistry ?? new ExternalApiConnectorRegistry(options.externalApiConnectors)
    this.externalApiTransport = options.externalApiTransport ?? new FetchExternalApiTransport({ resolveHostAddresses: options.externalApiResolveHostAddresses })
    this.externalApiEnv = Object.freeze({ ...(options.externalApiEnv ?? {}) })
    this.externalApiResolveHostAddresses = options.externalApiResolveHostAddresses
    this.externalApiNow = options.externalApiNow
    this.externalApiRequestId = options.externalApiRequestId
    if (options.commanderModelStepAdapter && options.commanderInvestigationProviderConfig) throw new Error("commanderModelStepAdapter cannot be combined with commanderInvestigationProviderConfig")
    this.commanderInvestigationProviderConfig = options.commanderInvestigationProviderConfig ? validateCommanderInvestigationProviderConfig(options.commanderInvestigationProviderConfig) : undefined
    this.modelProfileRuntimeRegistry = options.modelProfileRuntimeRegistry
      ?? (this.commanderInvestigationProviderConfig ? adaptLegacyCommanderModelAuthority(this.commanderInvestigationProviderConfig).registry : undefined)
    if (options.modelProfileRuntimeRegistry && this.commanderInvestigationProviderConfig) {
      requireCommanderRegistryAssertion(options.modelProfileRuntimeRegistry, this.commanderInvestigationProviderConfig)
    }
    this.reasoningProviderConfig = validateReasoningProviderConfig(options.reasoningProviderConfig ?? defaultReasoningProviderConfig())
    this.modelCapabilityRegistry = new ModelCapabilityRegistry({
      reasoningProviderConfig: this.reasoningProviderConfig,
      runtimeCapabilities: this.commanderInvestigationProviderConfig ? [commanderInvestigationModelCapability(this.commanderInvestigationProviderConfig)] : [],
    })
    const minimaxProvider = this.reasoningProviderConfig.kind === "minimax" ? this.createMiniMaxReasoningProvider() : null
    this.researchSynthesisProvider = options.researchSynthesisProvider ?? (minimaxProvider ?? new FakeResearchSynthesisProvider())
    this.researchSynthesisNow = options.researchSynthesisNow
    this.researchSynthesisId = options.researchSynthesisId
    this.commanderCycleProvider = options.commanderCycleProvider ?? (minimaxProvider ?? new FakeCommanderCycleProvider())
    this.commanderCycleNow = options.commanderCycleNow
    this.commanderCycleId = options.commanderCycleId
    this.commanderExecutorReviewProvider = options.commanderExecutorReviewProvider ?? (minimaxProvider ?? new FakeCommanderExecutorReviewProvider())
    this.commanderExecutorReviewNow = options.commanderExecutorReviewNow
    this.commanderExecutorReviewId = options.commanderExecutorReviewId
    this.opencodeHandoffNow = options.opencodeHandoffNow
    this.opencodeHandoffId = options.opencodeHandoffId
    this.opencodeProcessSmokeEnv = options.opencodeProcessSmokeEnv ?? process.env
    this.opencodeProcessSmokeNow = options.opencodeProcessSmokeNow
    this.opencodeProcessSmokeId = options.opencodeProcessSmokeId
    this.opencodeProcessSmokeSpawn = options.opencodeProcessSmokeSpawn ?? options.openCodeAdapterFactoryOptions?.spawn
    this.opencodeLaunchEnv = options.opencodeLaunchEnv ?? process.env
    this.opencodeLaunchAdapter = options.opencodeLaunchAdapter
    this.opencodeLaunchNow = options.opencodeLaunchNow
    this.opencodeLaunchId = options.opencodeLaunchId
    this.opencodeLaunchSpawn = options.opencodeLaunchSpawn ?? options.openCodeAdapterFactoryOptions?.spawn
    this.opencodeWatchdogNow = options.opencodeWatchdogNow
    this.opencodeWatchdogId = options.opencodeWatchdogId
    this.opencodeForcedReportId = options.opencodeForcedReportId
    this.runtimeCheckpointNow = options.runtimeCheckpointNow
    this.runtimeCheckpointId = options.runtimeCheckpointId
    this.runtimeResumeNow = options.runtimeResumeNow
    this.runtimeResumeId = options.runtimeResumeId
    this.runtimeWakeNow = options.runtimeWakeNow
    this.runtimeWakeId = options.runtimeWakeId
    this.runtimeContinuationNow = options.runtimeContinuationNow
    this.runtimeContinuationId = options.runtimeContinuationId
    this.runtimeContinuationStepId = options.runtimeContinuationStepId
    this.runtimeWakeScheduleNow = options.runtimeWakeScheduleNow
    this.runtimeWakeScheduleId = options.runtimeWakeScheduleId
    this.runtimeWakeScheduleTickId = options.runtimeWakeScheduleTickId
    this.runtimeWakeSchedulerNow = options.runtimeWakeSchedulerNow
    this.runtimeWakeSchedulerSetTimer = options.runtimeWakeSchedulerSetTimer
    this.runtimeWakeSchedulerClearTimer = options.runtimeWakeSchedulerClearTimer
    this.runtimeWakeSchedulerMinIntervalMs = options.runtimeWakeSchedulerMinIntervalMs
    this.runtimeWakeSchedulerMinHeartbeatIntervalMs = options.runtimeWakeSchedulerMinHeartbeatIntervalMs
    this.wakeSchedulerBootstrapConfig = options.wakeSchedulerBootstrapConfig
    this.researchProjectionMode = options.researchProjectionMode ?? "auto_rebuild"
    this.researchDb = options.researchDb ?? null
    this.ownsResearchDb = options.researchDb === undefined
    this.researchDbFactory = options.researchDbFactory ?? ((projectDir) => ResearchDb.open(projectDir, { allowFtsProjectionRepair: this.runLock.isHeld() }))
    this.commanderQueueNow = options.commanderQueueNow
    this.commanderModelStepAdapter = options.commanderModelStepAdapter ?? this.createConfiguredCommanderModelStepAdapter()
    this.commanderInvestigationControlGate = options.commanderInvestigationControlGate
    this.commanderGithubGatewayConfig = options.commanderGithubGatewayConfig
      ? validateCommanderGithubGatewayConfig(options.commanderGithubGatewayConfig)
      : readCommanderGithubGatewayConfigFromEnv(this.externalApiEnv)
    this.researchProjectionHealth = {
      mode: this.researchProjectionMode,
      ok: this.researchProjectionMode === "disabled",
      stale: false,
      reason: this.researchProjectionMode === "disabled" ? "disabled" : "not checked",
      pending_count: 0,
    }
  }

  async start(): Promise<void> {
    if (this.lifecycleShutdownRequested || this.lifecycleState === "stopping") throw new Error("runtime lifecycle is stopping")
    if (this.lifecycleStartTask) return this.lifecycleStartTask
    const task = this.startUnserialized()
    this.lifecycleStartTask = task
    try {
      await task
    } finally {
      if (this.lifecycleStartTask === task) this.lifecycleStartTask = null
    }
  }

  private async startUnserialized(): Promise<void> {
    if (modeRequiresApprovedSpec(this.mode)) {
      this.specSummary = await this.specService.requireApproved()
    } else {
      const current = await this.specService.readCurrent()
      this.specSummary = current?.status === "approved" ? this.specService.toSummary(current) : null
    }
    await this.runLock.acquire()
    this.lifecycleState = "starting"
    if (this.commanderInvestigationLifecycleAbort.signal.aborted) {
      this.commanderInvestigationLifecycleAbort = new AbortController()
    }
    try {
      this.ensureResearchProjectionUsable("startup")
      this.started = true
      if (this.mode === "active") {
        await this.adapter.startSession({
          projectDir: this.projectDir,
          objective: this.specSummary?.objective ?? "",
        })
        this.startExecutorEventPump()
      }
      const recordsBeforeStart = await this.eventStore.readAll()
      const runtimeStartedId = await this.eventStore.append({ kind: "runtime_started", mode: this.mode })
      await this.wakeSchedulerBootstrapService().bootstrapOnRuntimeStart()
      this.emitStartupReadyEvents(recordsBeforeStart.length + 1, runtimeStartedId)
      this.lifecycleState = "ready"
    } catch (error) {
      await this.cleanupFailedStartup()
      throw error
    }
  }

  private emitStartupReadyEvents(recordsCount: number, lastRunId: string): void {
    this.eventBus.emit({
      type: "RuntimeReady",
      projectName: projectName(this.projectDir),
      runtimeStatus: this.mode === "active" ? "ready" : `${this.mode} ready`,
      providerLabel: this.specSummary?.approvedBy,
      modelLabel: "fake-opencode-adapter",
    })
    this.eventBus.emit({ type: "ProjectInitialized", projectDir: this.projectDir })
    this.eventBus.emit({ type: "ResumeSummaryLoaded", recordsCount, lastRunId })
  }

  private startExecutorEventPump(): void {
    if (this.executorStreamTask) return
    this.executorStreamAbort = false
    this.executorStreamError = null

    let task!: Promise<void>
    task = (async () => {
      try {
        for await (const event of this.adapter.streamExecutorEvents()) {
          if (this.executorStreamAbort) break
          this.eventBus.emit(event)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.executorStreamError = message
        this.eventBus.emit({
          type: "ExecutorLifecycle",
          phase: "runtime-event-pump-error",
          message,
        })
      } finally {
        if (this.executorStreamTask === task) this.executorStreamTask = null
      }
    })()

    this.executorStreamTask = task
  }

  private async drainExecutorEventPumpAfterShutdown(): Promise<void> {
    const streamTask = this.executorStreamTask
    if (!streamTask) return
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const timedOut = Symbol("executor-shutdown-drain-timeout")
    const result = await Promise.race([
      streamTask.then(() => undefined),
      new Promise<typeof timedOut>((resolve) => {
        timeoutId = setTimeout(() => resolve(timedOut), EXECUTOR_SHUTDOWN_DRAIN_TIMEOUT_MS)
      }),
    ])
    if (timeoutId) clearTimeout(timeoutId)
    if (result === timedOut) this.executorStreamAbort = true
  }

  private async cleanupFailedStartup(): Promise<void> {
    this.executorStreamAbort = true
    this.lifecycleState = "stopping"
    this.commanderInvestigationLifecycleAbort.abort(new Error("RuntimeServer startup failed before Commander investigations became ready"))
    await this.drainConfiguredCommanderInvestigations()
    this.started = false
    try {
      await this.wakeSchedulerServiceInstance?.shutdown("runtime startup failed")
    } catch (error) {
      this.eventBus.emit({
        type: "ExecutorLifecycle",
        phase: "runtime-wake-scheduler-startup-cleanup-error",
        message: error instanceof Error ? error.message : String(error),
      })
    }
    try {
      await this.adapter.shutdown()
    } catch (error) {
      this.eventBus.emit({
        type: "ExecutorLifecycle",
        phase: "runtime-startup-cleanup-error",
        message: error instanceof Error ? error.message : String(error),
      })
    }
    try {
      await this.runLock.release()
    } catch (error) {
      this.eventBus.emit({
        type: "ExecutorLifecycle",
        phase: "runtime-lock-release-error",
        message: error instanceof Error ? error.message : String(error),
      })
    }
    try {
      this.closeOwnedResearchDb(null)
    } catch (error) {
      this.eventBus.emit({
        type: "ExecutorLifecycle",
        phase: "runtime-research-db-cleanup-error",
        message: error instanceof Error ? error.message : String(error),
      })
    }
    this.lifecycleState = "stopped"
  }

  async command(name: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    switch (name) {
      case "runtime.status":
        return this.status()
      case "runtime.reasoning_provider_status":
        return this.reasoningProviderStatus()
      case "runtime.command_authority_summary":
        return new CommandAuthorityService().summary()
      case "runtime.command_authority_list":
        return new CommandAuthorityService().list(payload)
      case "runtime.command_authority_get":
        return new CommandAuthorityService().get(requiredString(payload.command, "command"))
      case "runtime.command_authority_validation_profile":
        return new CommandAuthorityService().validationProfile(requiredString(payload.command, "command"), optionalStringArray(payload.changedFiles ?? payload.changed_files, "changedFiles") ?? [])
      case "runtime.commander_tool_catalog_summary":
        return this.commanderToolCatalogSummary()
      case "runtime.list_commander_tools":
        return this.listCommanderTools(readCommanderToolListInput(payload))
      case "runtime.get_commander_tool":
        return this.getCommanderTool(readCommanderToolGetInput(payload))
      case "runtime.search_commander_tools":
        return this.searchCommanderTools(readCommanderToolSearchInput(payload))
      case "runtime.preview_commander_tool_profile":
        return this.previewCommanderToolProfile({ phase: optionalString(payload.phase, "phase") })
      case "runtime.preview_commander_tool_bootstrap":
        return this.previewCommanderToolBootstrap({
          phase: optionalString(payload.phase, "phase"),
          provider_kind: optionalString(payload.providerKind ?? payload.provider_kind ?? payload.provider, "provider"),
          model_id: optionalString(payload.modelId ?? payload.model_id ?? payload.model, "model"),
          max_context_tokens: optionalPositiveInteger(payload.maxContextTokens ?? payload.max_context_tokens, "maxContextTokens", 128000),
          max_context_bytes: optionalPositiveInteger(payload.maxContextBytes ?? payload.max_context_bytes, "maxContextBytes", 512000),
        })
      case "runtime.validate_commander_tool_registry":
        return this.validateCommanderToolRegistry()
      case "runtime.search_commander_operational_memory":
        return this.searchCommanderOperationalMemory(readCommanderOperationalMemorySearchInput(payload))
      case "runtime.list_commander_investigation_recoveries":
        return this.listCommanderInvestigationRecoveries(readCommanderRecoveryListInput(payload))
      case "runtime.get_commander_investigation_recovery":
        return this.getCommanderInvestigationRecovery(readCommanderRecoveryShowInput(payload).investigation_id)
      case "runtime.preview_commander_investigation_recovery":
        return this.previewCommanderInvestigationRecoveryPublic(readCommanderRecoveryShowInput(payload).investigation_id)
      case "runtime.approve_commander_investigation_recovery":
        return this.recordCommanderInvestigationRecoveryApproval(readCommanderRecoveryApprovalInput(payload))
      case "runtime.execute_commander_investigation_recovery":
        return this.startCommanderInvestigationRecoveryOperation(readCommanderRecoveryExecuteInput(payload))
      case "runtime.cancel_commander_investigation_recovery":
        return this.cancelCommanderInvestigationRecoveryOperation(readCommanderRecoveryCancelInput(payload))
      case "runtime.commander_repo_tree":
        return this.commanderRepoTree(payload)
      case "runtime.commander_repo_search_text":
        return this.commanderRepoSearchText(payload)
      case "runtime.commander_repo_read_lines":
        return this.commanderRepoReadLines(payload)
      case "runtime.commander_repo_find_symbol":
        return this.commanderRepoFindSymbol(payload)
      case "runtime.commander_repo_git_status":
        return this.commanderRepoGitStatus()
      case "runtime.commander_repo_git_diff":
        return this.commanderRepoGitDiff(payload)
      case "runtime.commander_repo_git_log":
        return this.commanderRepoGitLog(payload)
      case "runtime.commander_repo_test_manifest":
        return this.commanderRepoTestManifest(payload)
      case "runtime.commander_repo_dependency_manifest":
        return this.commanderRepoDependencyManifest(payload)
      case "runtime.reasoning_provider_health":
        return this.reasoningProviderHealth()
      case "runtime.preview_reasoning_provider_smoke":
        return this.previewReasoningProviderSmoke(readReasoningProviderSmokeInput(payload))
      case "runtime.execute_reasoning_provider_smoke":
        return this.executeReasoningProviderSmoke(readReasoningProviderSmokeInput(payload))
      case "runtime.preview_minimax_live_validation":
        return this.previewMiniMaxLiveValidation(readMiniMaxLiveValidationInput(payload))
      case "runtime.execute_minimax_live_validation":
        return this.executeMiniMaxLiveValidation(readMiniMaxLiveValidationInput(payload))
      case "runtime.list_minimax_live_validations":
        return this.listMiniMaxLiveValidations(optionalPositiveInteger(payload.limit, "limit", 100) ?? 20)
      case "runtime.get_minimax_live_validation":
        return this.getMiniMaxLiveValidation(requiredString(payload.validationId ?? payload.validation_id, "validationId"))
      case "runtime.resume":
        return this.resume()
      case "runtime.start_new_session":
        return this.startNewSession()
      case "runtime.view_records":
        return this.viewRecords()
      case "research.list_topics":
        return this.listResearchTopics(optionalString(payload.query, "query"))
      case "research.get_topic_snapshot":
        return this.getResearchTopicSnapshot(requiredString(payload.topicId, "topicId"))
      case "research.list_events":
        return this.listResearchEvents(readResearchEventsOptions(payload.options))
      case "research.search_notes":
        return this.searchResearchNotes(requiredString(payload.topicId, "topicId"), requiredString(payload.query, "query"), readSearchOptions(payload.options))
      case "research.projection_status":
        return this.researchProjectionStatus()
      case "research.rebuild_projection":
        return this.rebuildResearchProjection(readRebuildProjectionOptions(payload))
      case "runtime.submit_user_message":
        return this.submitUserMessage(String(payload.message ?? ""))
      case "runtime.get_mission":
        return this.getMission(requiredString(payload.missionId ?? payload.mission_id, "missionId"))
      case "runtime.list_recent_missions":
        return this.listRecentMissions(optionalPositiveInteger(payload.limit, "limit", 100))
      case "runtime.claim_mission":
        return this.claimMission({
          mission_id: requiredString(payload.missionId ?? payload.mission_id, "missionId"),
          executor_id: requiredString(payload.executorId ?? payload.executor_id, "executorId"),
        })
      case "runtime.record_mission_progress":
        return this.recordMissionProgress({
          mission_id: requiredString(payload.missionId ?? payload.mission_id, "missionId"),
          claim_id: requiredString(payload.claimId ?? payload.claim_id, "claimId"),
          message: requiredString(payload.message, "message"),
        })
      case "runtime.submit_mission_result":
        return this.submitMissionResult({
          mission_id: requiredString(payload.missionId ?? payload.mission_id, "missionId"),
          claim_id: requiredString(payload.claimId ?? payload.claim_id, "claimId"),
          summary: requiredString(payload.summary, "summary"),
          artifacts: optionalStringArray(payload.artifacts, "artifacts"),
          research_result_ids: optionalStringArray(payload.researchResultIds ?? payload.research_result_ids, "researchResultIds"),
        })
      case "runtime.complete_mission":
        return this.completeMission(requiredString(payload.missionId ?? payload.mission_id, "missionId"), {
          result_id: optionalString(payload.resultId ?? payload.result_id, "resultId"),
          summary: optionalString(payload.summary, "summary"),
        })
      case "runtime.fail_mission":
        return this.failMission(requiredString(payload.missionId ?? payload.mission_id, "missionId"), requiredString(payload.reason, "reason"))
      case "runtime.cancel_mission":
        return this.cancelMission(requiredString(payload.missionId ?? payload.mission_id, "missionId"), optionalString(payload.reason, "reason"))
      case "runtime.release_mission_claim":
        return this.releaseMissionClaim(requiredString(payload.claimId ?? payload.claim_id, "claimId"), optionalString(payload.reason, "reason"))
      case "runtime.list_mission_claims":
        return this.listMissionClaims(requiredString(payload.missionId ?? payload.mission_id, "missionId"))
      case "runtime.list_mission_progress":
        return this.listMissionProgress(requiredString(payload.missionId ?? payload.mission_id, "missionId"))
      case "runtime.list_mission_results":
        return this.listMissionResults(requiredString(payload.missionId ?? payload.mission_id, "missionId"))
      case "runtime.create_review_request":
        return this.createReviewRequest({
          mission_id: optionalString(payload.missionId ?? payload.mission_id, "missionId"),
          claim_id: optionalString(payload.claimId ?? payload.claim_id, "claimId"),
          result_id: optionalString(payload.resultId ?? payload.result_id, "resultId"),
          request_type: optionalString(payload.requestType ?? payload.request_type, "requestType") as ReviewRequestInput["request_type"],
          title: requiredString(payload.title, "title"),
          summary: requiredString(payload.summary, "summary"),
          requested_by: requiredString(payload.requestedBy ?? payload.requested_by, "requestedBy"),
        })
      case "runtime.get_review_request":
        return this.getReviewRequest(requiredString(payload.reviewId ?? payload.review_id, "reviewId"))
      case "runtime.list_review_requests":
        return this.listReviewRequests({
          status: optionalString(payload.status, "status") as ReviewStatus | undefined,
          limit: optionalPositiveInteger(payload.limit, "limit", 1000),
        })
      case "runtime.approve_review_request":
        return this.approveReviewRequest(requiredString(payload.reviewId ?? payload.review_id, "reviewId"), requiredString(payload.decidedBy ?? payload.decided_by, "decidedBy"), optionalString(payload.reason, "reason"))
      case "runtime.reject_review_request":
        return this.rejectReviewRequest(requiredString(payload.reviewId ?? payload.review_id, "reviewId"), requiredString(payload.decidedBy ?? payload.decided_by, "decidedBy"), optionalString(payload.reason, "reason"))
      case "runtime.cancel_review_request":
        return this.cancelReviewRequest(requiredString(payload.reviewId ?? payload.review_id, "reviewId"), requiredString(payload.decidedBy ?? payload.decided_by, "decidedBy"), optionalString(payload.reason, "reason"))
      case "runtime.review_status":
        return this.reviewStatusSummary()
      case "runtime.create_commander_proposal":
        return this.createCommanderProposal({
          mission_id: optionalString(payload.missionId ?? payload.mission_id, "missionId"),
          claim_id: optionalString(payload.claimId ?? payload.claim_id, "claimId"),
          result_id: optionalString(payload.resultId ?? payload.result_id, "resultId"),
          action_kind: requiredString(payload.actionKind ?? payload.action_kind, "actionKind") as CommanderProposalInput["action_kind"],
          title: requiredString(payload.title, "title"),
          summary: requiredString(payload.summary, "summary"),
          proposed_by: requiredString(payload.proposedBy ?? payload.proposed_by, "proposedBy"),
          action_payload: optionalRecord(payload.actionPayload ?? payload.action_payload, "actionPayload"),
        })
      case "runtime.get_commander_proposal":
        return this.getCommanderProposal(requiredString(payload.proposalId ?? payload.proposal_id, "proposalId"))
      case "runtime.list_commander_proposals":
        return this.listCommanderProposals({
          status: optionalString(payload.status, "status") as ProposalStatus | undefined,
          limit: optionalPositiveInteger(payload.limit, "limit", 1000),
        })
      case "runtime.request_proposal_review":
        return this.requestProposalReview(requiredString(payload.proposalId ?? payload.proposal_id, "proposalId"), {
          title: optionalString(payload.title, "title"),
          summary: optionalString(payload.summary, "summary"),
          requested_by: requiredString(payload.requestedBy ?? payload.requested_by, "requestedBy"),
        })
      case "runtime.cancel_commander_proposal":
        return this.cancelCommanderProposal(requiredString(payload.proposalId ?? payload.proposal_id, "proposalId"), optionalString(payload.reason, "reason"))
      case "runtime.apply_commander_proposal":
        return this.applyCommanderProposal(requiredString(payload.proposalId ?? payload.proposal_id, "proposalId"))
      case "runtime.proposal_status":
        return this.proposalStatusSummary()
      case "runtime.create_proposal_bundle":
        return this.createProposalBundle({
          title: requiredString(payload.title, "title"),
          summary: requiredString(payload.summary, "summary"),
          created_by: requiredString(payload.createdBy ?? payload.created_by, "createdBy"),
        })
      case "runtime.get_proposal_bundle":
        return this.getProposalBundle(requiredString(payload.bundleId ?? payload.bundle_id, "bundleId"))
      case "runtime.list_proposal_bundles":
        return this.listProposalBundles({
          status: optionalString(payload.status, "status") as CommanderProposalBundleStatus | undefined,
          limit: optionalPositiveInteger(payload.limit, "limit", 100),
        })
      case "runtime.add_proposal_to_bundle":
        return this.addProposalToBundle(requiredString(payload.bundleId ?? payload.bundle_id, "bundleId"), requiredString(payload.proposalId ?? payload.proposal_id, "proposalId"))
      case "runtime.proposal_bundle_readiness":
        return this.proposalBundleReadiness(requiredString(payload.bundleId ?? payload.bundle_id, "bundleId"))
      case "runtime.request_proposal_bundle_reviews":
        return this.requestProposalBundleReviews(requiredString(payload.bundleId ?? payload.bundle_id, "bundleId"), requiredString(payload.requestedBy ?? payload.requested_by, "requestedBy"))
      case "runtime.apply_proposal_bundle":
        return this.applyProposalBundle(requiredString(payload.bundleId ?? payload.bundle_id, "bundleId"), { allowPartial: optionalBoolean(payload.allowPartial ?? payload.allow_partial, "allowPartial") })
      case "runtime.cancel_proposal_bundle":
        return this.cancelProposalBundle(requiredString(payload.bundleId ?? payload.bundle_id, "bundleId"), optionalString(payload.reason, "reason"))
      case "runtime.proposal_bundle_status":
        return this.proposalBundleStatusSummary()
      case "runtime.list_commander_playbooks":
        return this.listCommanderPlaybooks()
      case "runtime.get_commander_playbook":
        return this.getCommanderPlaybook(requiredString(payload.playbookId ?? payload.playbook_id, "playbookId"))
      case "runtime.draft_commander_playbook":
        return this.draftCommanderPlaybook(readCommanderPlaybookDraftInput(payload))
      case "runtime.get_commander_playbook_draft":
        return this.getCommanderPlaybookDraft(requiredString(payload.draftId ?? payload.draft_id, "draftId"))
      case "runtime.list_commander_playbook_drafts":
        return this.listCommanderPlaybookDrafts({
          status: optionalString(payload.status, "status") as CommanderPlaybookDraftStatus | undefined,
          limit: optionalPositiveInteger(payload.limit, "limit", 100),
        })
      case "runtime.commander_playbook_draft_status":
        return this.commanderPlaybookDraftStatusSummary()
      case "runtime.commander_playbook_draft_readiness":
        return this.commanderPlaybookDraftReadiness(requiredString(payload.draftId ?? payload.draft_id, "draftId"))
      case "runtime.request_commander_playbook_draft_reviews":
        return this.requestCommanderPlaybookDraftReviews(requiredString(payload.draftId ?? payload.draft_id, "draftId"), requiredString(payload.requestedBy ?? payload.requested_by, "requestedBy"))
      case "runtime.cancel_commander_playbook_draft":
        return this.cancelCommanderPlaybookDraft(requiredString(payload.draftId ?? payload.draft_id, "draftId"), optionalString(payload.reason, "reason"))
      case "runtime.commander_apply_preview":
        return this.commanderApplyPreview(readCommanderApplyTarget(payload))
      case "runtime.apply_commander_target":
        return this.applyCommanderTarget(readCommanderApplyTarget(payload), {
          allow_partial: optionalBoolean(payload.allowPartial ?? payload.allow_partial, "allowPartial"),
          dry_run: optionalBoolean(payload.dryRun ?? payload.dry_run, "dryRun"),
        })
      case "runtime.commander_audit_timeline":
        return this.commanderAuditTimeline({
          limit: optionalPositiveInteger(payload.limit, "limit", 1000),
          category: optionalString(payload.category, "category") as CommanderAuditEventKind | undefined,
          target_type: optionalString(payload.targetType ?? payload.target_type, "targetType"),
          target_id: optionalString(payload.targetId ?? payload.target_id, "targetId"),
          after_event_id: optionalString(payload.afterEventId ?? payload.after_event_id, "afterEventId"),
          before_event_id: optionalString(payload.beforeEventId ?? payload.before_event_id, "beforeEventId"),
        })
      case "runtime.commander_authority_chain":
        return this.commanderAuthorityChain(requiredString(payload.targetType ?? payload.target_type, "targetType"), requiredString(payload.targetId ?? payload.target_id, "targetId"))
      case "runtime.commander_queue_summary":
        return this.commanderQueueSummary({
          staleAfterMs: readCommanderQueueStaleAfterMs(payload.staleAfterMs === undefined ? payload.stale_after_ms : payload.staleAfterMs),
        })
      case "runtime.commander_queue":
        return this.commanderQueue(readCommanderQueueKind(payload.queue), {
          limit: readCommanderQueueLimit(payload.limit === undefined ? 20 : payload.limit),
          staleAfterMs: readCommanderQueueStaleAfterMs(payload.staleAfterMs === undefined ? payload.stale_after_ms : payload.staleAfterMs),
        })
      case "runtime.commander_target_context":
        return this.commanderTargetContext(requiredString(payload.targetType ?? payload.target_type, "targetType"), requiredString(payload.targetId ?? payload.target_id, "targetId"))
      case "runtime.list_external_api_connectors":
        return this.listExternalApiConnectors()
      case "runtime.get_external_api_connector":
        return this.getExternalApiConnector(requiredString(payload.connectorId ?? payload.connector_id, "connectorId"))
      case "runtime.preview_external_api_request":
        return this.previewExternalApiRequest(readExternalApiRequestInput(payload))
      case "runtime.execute_external_api_request":
        return this.executeExternalApiRequest(readExternalApiRequestInput(payload))
      case "runtime.list_external_api_audit":
        return this.listExternalApiAudit(optionalPositiveInteger(payload.limit, "limit", 100) ?? 20)
      case "runtime.preview_external_api_research_ingestion":
        return this.previewExternalApiResearchIngestion(readExternalApiResearchIngestionInput(payload))
      case "runtime.execute_external_api_research_ingestion":
        return this.executeExternalApiResearchIngestion(readExternalApiResearchIngestionInput(payload))
      case "runtime.list_external_api_research_ingestions":
        return this.listExternalApiResearchIngestions(optionalPositiveInteger(payload.limit, "limit", 100) ?? 20)
      case "runtime.preview_research_synthesis":
        return this.previewResearchSynthesis(readResearchSynthesisInput(payload))
      case "runtime.execute_research_synthesis":
        return this.executeResearchSynthesis(readResearchSynthesisInput(payload))
      case "runtime.get_research_synthesis":
        return this.getResearchSynthesis(requiredString(payload.synthesisId ?? payload.synthesis_id, "synthesisId"))
      case "runtime.list_research_syntheses":
        return this.listResearchSyntheses(optionalPositiveInteger(payload.limit, "limit", 100) ?? 20)
      case "runtime.preview_commander_cycle":
        return this.previewCommanderCycle(readCommanderCycleInput(payload))
      case "runtime.execute_commander_cycle":
        return this.executeCommanderCycle(readCommanderCycleInput(payload))
      case "runtime.get_commander_cycle":
        return this.getCommanderCycle(requiredString(payload.cycleId ?? payload.cycle_id, "cycleId"))
      case "runtime.list_commander_cycles":
        return this.listCommanderCycles(optionalPositiveInteger(payload.limit, "limit", 100) ?? 20)
      case "runtime.preview_opencode_handoff":
        return this.previewOpenCodeHandoff(readOpenCodeHandoffInput(payload))
      case "runtime.execute_opencode_handoff":
        return this.executeOpenCodeHandoff(readOpenCodeHandoffInput(payload))
      case "runtime.list_opencode_handoffs":
        return this.listOpenCodeHandoffs(optionalPositiveInteger(payload.limit, "limit", 100) ?? 20)
      case "runtime.get_opencode_handoff":
        return this.getOpenCodeHandoff(requiredString(payload.handoffId ?? payload.handoff_id, "handoffId"))
      case "runtime.preview_opencode_process_smoke":
        return this.previewOpenCodeProcessSmoke({
          timeout_ms: optionalPositiveInteger(payload.timeoutMs ?? payload.timeout_ms, "timeoutMs", 60_000),
        })
      case "runtime.execute_opencode_process_smoke":
        return this.executeOpenCodeProcessSmoke({
          requested_by: optionalString(payload.requestedBy ?? payload.requested_by, "requestedBy"),
          timeout_ms: optionalPositiveInteger(payload.timeoutMs ?? payload.timeout_ms, "timeoutMs", 60_000),
          dry_run: optionalBoolean(payload.dryRun ?? payload.dry_run, "dryRun"),
        })
      case "runtime.list_opencode_process_smokes":
        return this.listOpenCodeProcessSmokes(optionalPositiveInteger(payload.limit, "limit", 100) ?? 20)
      case "runtime.get_opencode_process_smoke":
        return this.getOpenCodeProcessSmoke(requiredString(payload.smokeId ?? payload.smoke_id, "smokeId"))
      case "runtime.preview_opencode_handoff_readiness":
        return this.previewOpenCodeHandoffReadiness(readOpenCodeHandoffReadinessInput(payload))
      case "runtime.opencode_handoff_readiness_summary":
        return this.openCodeHandoffReadinessSummary({
          max_smoke_age_ms: optionalPositiveIntegerUnbounded(payload.maxSmokeAgeMs ?? payload.max_smoke_age_ms, "maxSmokeAgeMs"),
        })
      case "runtime.preview_opencode_result_review_packet":
        return this.previewOpenCodeResultReviewPacket(readOpenCodeResultReviewPacketInput(payload))
      case "runtime.opencode_result_review_packet_summary":
        return this.openCodeResultReviewSummary(readOpenCodeResultReviewPacketInput(payload))
      case "runtime.preview_opencode_session_plan":
        return this.previewOpenCodeSessionPlan(readOpenCodeSessionPreviewInput(payload))
      case "runtime.create_opencode_session_plan":
        return this.createOpenCodeSessionPlan(readOpenCodeSessionCreateInput(payload))
      case "runtime.list_opencode_sessions":
        return this.listOpenCodeSessions({
          limit: optionalPositiveInteger(payload.limit, "limit", 100),
          status: optionalString(payload.status, "status") as OpenCodeSessionStatus | undefined,
          mission_id: optionalString(payload.missionId ?? payload.mission_id, "missionId"),
          proposal_id: optionalString(payload.proposalId ?? payload.proposal_id, "proposalId"),
          source_kind: optionalString(payload.sourceKind ?? payload.source_kind, "sourceKind") as OpenCodeSessionSourceKind | undefined,
        })
      case "runtime.get_opencode_session":
        return this.getOpenCodeSession(requiredString(payload.sessionId ?? payload.session_id, "sessionId"))
      case "runtime.opencode_session_summary":
        return this.openCodeSessionSummary()
      case "runtime.list_model_capabilities":
        return this.listModelCapabilities(readModelCapabilityListInput(payload))
      case "runtime.get_model_capability":
        return this.getModelCapability(readModelCapabilityGetInput(payload))
      case "runtime.context_budget_summary":
        return this.contextBudgetSummary()
      case "runtime.preview_context_budget":
        return this.previewContextBudget(readContextBudgetPreviewInput(payload))
      case "runtime.preview_context_packet":
        return this.previewContextPacket(readContextPacketPreviewInput(payload))
      case "runtime.context_packet_summary":
        return this.contextPacketSummary()
      case "runtime.preview_opencode_session_instruction_pack":
        return this.previewOpenCodeSessionInstructionPack(readOpenCodeSessionInstructionPackPreviewInput(payload))
      case "runtime.write_opencode_session_instruction_pack":
        return this.writeOpenCodeSessionInstructionPack(readOpenCodeSessionInstructionPackWriteInput(payload))
      case "runtime.list_opencode_session_instruction_packs":
        return this.listOpenCodeSessionInstructionPacks({
          limit: optionalPositiveInteger(payload.limit, "limit", 100),
          session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId"),
          status: optionalString(payload.status, "status"),
        })
      case "runtime.get_opencode_session_instruction_pack":
        return this.getOpenCodeSessionInstructionPack(requiredString(payload.packId ?? payload.pack_id, "packId"))
      case "runtime.preview_opencode_launch_readiness":
        return this.previewOpenCodeLaunchReadiness(readOpenCodeLaunchReadinessPreviewInput(payload))
      case "runtime.opencode_launch_readiness_summary":
        return this.openCodeLaunchReadinessSummary(readOpenCodeLaunchReadinessSummaryInput(payload))
      case "runtime.preview_opencode_session_launch":
        return this.previewOpenCodeSessionLaunch(readOpenCodeLaunchPreviewInput(payload))
      case "runtime.launch_opencode_session":
        return this.launchOpenCodeSession(readOpenCodeLaunchInput(payload))
      case "runtime.list_opencode_session_launches":
        return this.listOpenCodeSessionLaunches({
          limit: optionalPositiveInteger(payload.limit, "limit", 100),
          session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId"),
          status: optionalString(payload.status, "status"),
        })
      case "runtime.get_opencode_session_launch":
        return this.getOpenCodeSessionLaunch(requiredString(payload.launchId ?? payload.launch_id, "launchId"))
      case "runtime.preview_opencode_progress":
        return this.previewOpenCodeProgress(readOpenCodeProgressPreviewInput(payload))
      case "runtime.record_opencode_progress":
        return this.recordOpenCodeProgress(readOpenCodeProgressAppendInput(payload))
      case "runtime.list_opencode_progress":
        return this.listOpenCodeProgress({
          limit: optionalPositiveInteger(payload.limit, "limit", 100),
          session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId"),
          launch_id: optionalString(payload.launchId ?? payload.launch_id ?? payload.launch, "launchId"),
          kind: optionalString(payload.kind, "kind"),
          execution_state: optionalString(payload.executionState ?? payload.execution_state, "executionState"),
        })
      case "runtime.get_opencode_progress":
        return this.getOpenCodeProgress(requiredString(payload.progressId ?? payload.progress_id, "progressId"))
      case "runtime.latest_opencode_progress":
        return this.latestOpenCodeProgress({
          session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId"),
          launch_id: optionalString(payload.launchId ?? payload.launch_id ?? payload.launch, "launchId"),
        })
      case "runtime.opencode_progress_summary":
        return this.openCodeProgressSummary({ limit: optionalPositiveInteger(payload.limit, "limit", 100) })
      case "runtime.preview_opencode_watchdog":
        return this.previewOpenCodeWatchdog(readOpenCodeWatchdogPreviewInput(payload))
      case "runtime.record_opencode_watchdog":
        return this.recordOpenCodeWatchdog(readOpenCodeWatchdogRecordInput(payload))
      case "runtime.request_opencode_forced_report":
        return this.requestOpenCodeForcedReport(readOpenCodeForcedReportInput(payload))
      case "runtime.list_opencode_watchdogs":
        return this.listOpenCodeWatchdogs({
          limit: optionalPositiveInteger(payload.limit, "limit", 100),
          session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId"),
          launch_id: optionalString(payload.launchId ?? payload.launch_id ?? payload.launch, "launchId"),
          status: optionalString(payload.status, "status"),
        })
      case "runtime.get_opencode_watchdog":
        return this.getOpenCodeWatchdog(requiredString(payload.watchdogId ?? payload.watchdog_id, "watchdogId"))
      case "runtime.list_opencode_forced_report_requests":
        return this.listOpenCodeForcedReportRequests({
          limit: optionalPositiveInteger(payload.limit, "limit", 100),
          session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId"),
          launch_id: optionalString(payload.launchId ?? payload.launch_id ?? payload.launch, "launchId"),
        })
      case "runtime.get_opencode_forced_report_request":
        return this.getOpenCodeForcedReportRequest(requiredString(payload.requestId ?? payload.request_id, "requestId"))
      case "runtime.opencode_watchdog_summary":
        return this.openCodeWatchdogSummary({ limit: optionalPositiveInteger(payload.limit, "limit", 100) })
      case "runtime.preview_opencode_commander_question":
        return this.previewOpenCodeCommanderQuestion(readOpenCodeCommanderQuestionPreviewInput(payload))
      case "runtime.create_opencode_commander_question":
        return this.createOpenCodeCommanderQuestion(readOpenCodeCommanderQuestionCreateInput(payload))
      case "runtime.list_opencode_commander_questions":
        return this.listOpenCodeCommanderQuestions({
          limit: optionalPositiveInteger(payload.limit, "limit", 100),
          session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId"),
          launch_id: optionalString(payload.launchId ?? payload.launch_id ?? payload.launch, "launchId"),
          status: optionalString(payload.status, "status"),
          question_type: optionalString(payload.questionType ?? payload.question_type ?? payload.type, "questionType"),
          urgency: optionalString(payload.urgency, "urgency"),
        })
      case "runtime.get_opencode_commander_question":
        return this.getOpenCodeCommanderQuestion(requiredString(payload.questionId ?? payload.question_id, "questionId"))
      case "runtime.latest_opencode_commander_question":
        return this.latestOpenCodeCommanderQuestion({
          session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId"),
          launch_id: optionalString(payload.launchId ?? payload.launch_id ?? payload.launch, "launchId"),
        })
      case "runtime.opencode_commander_question_summary":
        return this.openCodeCommanderQuestionSummary({ limit: optionalPositiveInteger(payload.limit, "limit", 100) })
      case "runtime.preview_commander_guidance":
        return this.previewCommanderGuidance(readCommanderGuidancePreviewInput(payload))
      case "runtime.create_commander_guidance":
        return this.createCommanderGuidance(readCommanderGuidanceCreateInput(payload))
      case "runtime.list_commander_guidance":
        return this.listCommanderGuidance({
          limit: optionalPositiveInteger(payload.limit, "limit", 100),
          session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId"),
          launch_id: optionalString(payload.launchId ?? payload.launch_id ?? payload.launch, "launchId"),
          question_id: optionalString(payload.questionId ?? payload.question_id ?? payload.question, "questionId"),
          status: optionalString(payload.status, "status"),
          delivery_status: optionalString(payload.deliveryStatus ?? payload.delivery_status, "deliveryStatus"),
          guidance_scope: optionalString(payload.guidanceScope ?? payload.guidance_scope ?? payload.scope, "guidanceScope"),
        })
      case "runtime.get_commander_guidance":
        return this.getCommanderGuidance(requiredString(payload.guidanceId ?? payload.guidance_id, "guidanceId"))
      case "runtime.latest_commander_guidance":
        return this.latestCommanderGuidance({
          session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId"),
          launch_id: optionalString(payload.launchId ?? payload.launch_id ?? payload.launch, "launchId"),
          question_id: optionalString(payload.questionId ?? payload.question_id ?? payload.question, "questionId"),
        })
      case "runtime.commander_guidance_summary":
        return this.commanderGuidanceSummary({ limit: optionalPositiveInteger(payload.limit, "limit", 100) })
      case "runtime.preview_commander_guidance_delivery":
        return this.previewCommanderGuidanceDelivery(readCommanderGuidanceDeliveryPreviewInput(payload))
      case "runtime.deliver_commander_guidance":
        return this.deliverCommanderGuidance(readCommanderGuidanceDeliveryInput(payload))
      case "runtime.list_commander_guidance_deliveries":
        return this.listCommanderGuidanceDeliveries({
          limit: optionalPositiveInteger(payload.limit, "limit", 100),
          session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId"),
          launch_id: optionalString(payload.launchId ?? payload.launch_id ?? payload.launch, "launchId"),
          guidance_id: optionalString(payload.guidanceId ?? payload.guidance_id ?? payload.guidance, "guidanceId"),
          status: optionalString(payload.status, "status"),
          delivery_mode: optionalString(payload.deliveryMode ?? payload.delivery_mode ?? payload.mode, "deliveryMode"),
        })
      case "runtime.get_commander_guidance_delivery":
        return this.getCommanderGuidanceDelivery(requiredString(payload.deliveryId ?? payload.delivery_id, "deliveryId"))
      case "runtime.latest_commander_guidance_delivery":
        return this.latestCommanderGuidanceDelivery({
          session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId"),
          launch_id: optionalString(payload.launchId ?? payload.launch_id ?? payload.launch, "launchId"),
          guidance_id: optionalString(payload.guidanceId ?? payload.guidance_id ?? payload.guidance, "guidanceId"),
        })
      case "runtime.commander_guidance_delivery_summary":
        return this.commanderGuidanceDeliverySummary({ limit: optionalPositiveInteger(payload.limit, "limit", 100) })
      case "runtime.preview_opencode_human_control":
        return this.previewOpenCodeHumanControl(readOpenCodeHumanControlPreviewInput(payload))
      case "runtime.record_opencode_human_control":
        return this.recordOpenCodeHumanControl(readOpenCodeHumanControlRecordInput(payload))
      case "runtime.list_opencode_human_controls":
        return this.listOpenCodeHumanControls({
          limit: optionalPositiveInteger(payload.limit, "limit", 100),
          session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId"),
          launch_id: optionalString(payload.launchId ?? payload.launch_id ?? payload.launch, "launchId"),
          control_kind: optionalString(payload.controlKind ?? payload.control_kind ?? payload.kind, "controlKind"),
          projected_state_after: optionalString(payload.projectedStateAfter ?? payload.projected_state_after ?? payload.state, "projectedStateAfter"),
          urgency: optionalString(payload.urgency, "urgency"),
        })
      case "runtime.get_opencode_human_control":
        return this.getOpenCodeHumanControl(requiredString(payload.controlId ?? payload.control_id, "controlId"))
      case "runtime.latest_opencode_human_control":
        return this.latestOpenCodeHumanControl({
          session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId"),
          launch_id: optionalString(payload.launchId ?? payload.launch_id ?? payload.launch, "launchId"),
        })
      case "runtime.opencode_human_control_summary":
        return this.openCodeHumanControlSummary({ limit: optionalPositiveInteger(payload.limit, "limit", 100) })
      case "runtime.preview_opencode_wake_supervisor":
        return this.previewOpenCodeWakeSupervisor(readOpenCodeWakeSupervisorPreviewInput(payload))
      case "runtime.opencode_wake_supervisor_summary":
        return this.openCodeWakeSupervisorSummary(readOpenCodeWakeSupervisorSummaryInput(payload))
      case "runtime.preview_opencode_wake_supervisor_execution":
        return this.previewOpenCodeWakeSupervisorExecution(readOpenCodeWakeSupervisorExecutionPreviewInput(payload))
      case "runtime.record_opencode_wake_supervisor_execution":
        return this.recordOpenCodeWakeSupervisorExecution(readOpenCodeWakeSupervisorExecutionRecordInput(payload))
      case "runtime.preview_opencode_wake_supervisor_batch":
        return this.previewOpenCodeWakeSupervisorBatch(readOpenCodeWakeSupervisorBatchPreviewInput(payload))
      case "runtime.record_opencode_wake_supervisor_batch":
        return this.recordOpenCodeWakeSupervisorBatch(readOpenCodeWakeSupervisorBatchRecordInput(payload))
      case "runtime.list_opencode_wake_supervisor_executions":
        return this.listOpenCodeWakeSupervisorExecutions({
          limit: optionalPositiveInteger(payload.limit, "limit", 100),
          session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId"),
          launch_id: optionalString(payload.launchId ?? payload.launch_id ?? payload.launch, "launchId"),
          supervisor_status: optionalString(payload.supervisorStatus ?? payload.supervisor_status ?? payload.status, "supervisorStatus"),
          recommended_action: optionalString(payload.recommendedAction ?? payload.recommended_action ?? payload.action, "recommendedAction"),
          execution_mode: optionalString(payload.executionMode ?? payload.execution_mode ?? payload.mode, "executionMode"),
        })
      case "runtime.get_opencode_wake_supervisor_execution":
        return this.getOpenCodeWakeSupervisorExecution(requiredString(payload.executionId ?? payload.execution_id, "executionId"))
      case "runtime.latest_opencode_wake_supervisor_execution":
        return this.latestOpenCodeWakeSupervisorExecution({
          session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId"),
          launch_id: optionalString(payload.launchId ?? payload.launch_id ?? payload.launch, "launchId"),
        })
      case "runtime.opencode_wake_supervisor_execution_summary":
        return this.openCodeWakeSupervisorExecutionSummary({ limit: optionalPositiveInteger(payload.limit, "limit", 100) })
      case "runtime.preview_opencode_wake_action_execution":
        return this.previewOpenCodeWakeActionExecution(readOpenCodeWakeActionExecutionPreviewInput(payload))
      case "runtime.record_opencode_wake_action_execution":
        return this.recordOpenCodeWakeActionExecution(readOpenCodeWakeActionExecutionRecordInput(payload))
      case "runtime.list_opencode_wake_action_executions":
        return this.listOpenCodeWakeActionExecutions({
          limit: optionalPositiveInteger(payload.limit, "limit", 100),
          execution_id: optionalString(payload.executionId ?? payload.execution_id ?? payload.execution, "executionId"),
          session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId"),
          launch_id: optionalString(payload.launchId ?? payload.launch_id ?? payload.launch, "launchId"),
          action_kind: optionalString(payload.actionKind ?? payload.action_kind ?? payload.action, "actionKind"),
          status: optionalString(payload.status, "status"),
          effect_kind: optionalString(payload.effectKind ?? payload.effect_kind ?? payload.effect, "effectKind"),
        })
      case "runtime.get_opencode_wake_action_execution":
        return this.getOpenCodeWakeActionExecution(requiredString(payload.actionExecutionId ?? payload.action_execution_id, "actionExecutionId"))
      case "runtime.latest_opencode_wake_action_execution":
        return this.latestOpenCodeWakeActionExecution({
          execution_id: optionalString(payload.executionId ?? payload.execution_id ?? payload.execution, "executionId"),
          session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId"),
          launch_id: optionalString(payload.launchId ?? payload.launch_id ?? payload.launch, "launchId"),
        })
      case "runtime.opencode_wake_action_execution_summary":
        return this.openCodeWakeActionExecutionSummary({ limit: optionalPositiveInteger(payload.limit, "limit", 100) })
      case "runtime.preview_opencode_result_report":
        return this.previewOpenCodeResultReport(readOpenCodeResultReportPreviewInput(payload))
      case "runtime.record_opencode_result_report":
        return this.recordOpenCodeResultReport(readOpenCodeResultReportRecordInput(payload))
      case "runtime.list_opencode_result_reports":
        return this.listOpenCodeResultReports({
          limit: optionalPositiveInteger(payload.limit, "limit", 100),
          session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId"),
          launch_id: optionalString(payload.launchId ?? payload.launch_id ?? payload.launch, "launchId"),
          result_kind: optionalString(payload.resultKind ?? payload.result_kind ?? payload.kind, "resultKind"),
          result_disposition: optionalString(payload.resultDisposition ?? payload.result_disposition ?? payload.disposition, "resultDisposition"),
          review_state: optionalString(payload.reviewState ?? payload.review_state, "reviewState"),
        })
      case "runtime.get_opencode_result_report":
        return this.getOpenCodeResultReport(requiredString(payload.reportId ?? payload.report_id, "reportId"))
      case "runtime.latest_opencode_result_report":
        return this.latestOpenCodeResultReport({
          session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId"),
          launch_id: optionalString(payload.launchId ?? payload.launch_id ?? payload.launch, "launchId"),
        })
      case "runtime.opencode_result_report_summary":
        return this.openCodeResultReportSummary({ limit: optionalPositiveInteger(payload.limit, "limit", 100) })
      case "runtime.preview_opencode_result_review":
        return this.previewOpenCodeResultReview(readOpenCodeResultReviewPreviewInput(payload))
      case "runtime.record_opencode_result_review":
        return this.recordOpenCodeResultReview(readOpenCodeResultReviewRecordInput(payload))
      case "runtime.list_opencode_result_reviews":
        return this.listOpenCodeResultReviews({
          limit: optionalPositiveInteger(payload.limit, "limit", 100),
          report_id: optionalString(payload.reportId ?? payload.report_id ?? payload.report, "reportId"),
          session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId"),
          launch_id: optionalString(payload.launchId ?? payload.launch_id ?? payload.launch, "launchId"),
          decision: optionalString(payload.decision, "decision"),
          review_disposition: optionalString(payload.reviewDisposition ?? payload.review_disposition, "reviewDisposition"),
          projection_state_after: optionalString(payload.projectionStateAfter ?? payload.projection_state_after, "projectionStateAfter"),
          next_step: optionalString(payload.nextStep ?? payload.next_step, "nextStep"),
        })
      case "runtime.get_opencode_result_review":
        return this.getOpenCodeResultReview(requiredString(payload.reviewId ?? payload.review_id, "reviewId"))
      case "runtime.latest_opencode_result_review":
        return this.latestOpenCodeResultReview({
          report_id: optionalString(payload.reportId ?? payload.report_id ?? payload.report, "reportId"),
          session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId"),
          launch_id: optionalString(payload.launchId ?? payload.launch_id ?? payload.launch, "launchId"),
        })
      case "runtime.opencode_result_review_summary":
        return this.openCodeResultReviewGateSummary({ limit: optionalPositiveInteger(payload.limit, "limit", 100) })
      case "runtime.preview_research_ingestion":
        return this.previewResearchIngestion(readResearchIngestionPreviewInput(payload))
      case "runtime.record_research_ingestion":
        return this.recordResearchIngestion(readResearchIngestionRecordInput(payload))
      case "runtime.list_research_ingestions":
        return this.listResearchIngestions({
          limit: optionalPositiveInteger(payload.limit, "limit", 100),
          review_id: optionalString(payload.reviewId ?? payload.review_id ?? payload.review, "reviewId"),
          report_id: optionalString(payload.reportId ?? payload.report_id ?? payload.report, "reportId"),
          session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId"),
          launch_id: optionalString(payload.launchId ?? payload.launch_id ?? payload.launch, "launchId"),
          evidence_kind: optionalString(payload.evidenceKind ?? payload.evidence_kind, "evidenceKind"),
          research_db_written: optionalBoolean(payload.researchDbWritten ?? payload.research_db_written, "researchDbWritten"),
        })
      case "runtime.get_research_ingestion":
        return this.getResearchIngestion(requiredString(payload.ingestionId ?? payload.ingestion_id, "ingestionId"))
      case "runtime.latest_research_ingestion":
        return this.latestResearchIngestion({
          review_id: optionalString(payload.reviewId ?? payload.review_id ?? payload.review, "reviewId"),
          report_id: optionalString(payload.reportId ?? payload.report_id ?? payload.report, "reportId"),
          session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId"),
          launch_id: optionalString(payload.launchId ?? payload.launch_id ?? payload.launch, "launchId"),
        })
      case "runtime.research_ingestion_summary":
        return this.researchIngestionSummary({ limit: optionalPositiveInteger(payload.limit, "limit", 100) })
      case "runtime.research_memory_summary":
        return this.researchMemorySummary()
      case "runtime.preview_research_memory_retrieval":
        return this.previewResearchMemoryRetrieval(readResearchMemoryRetrievalInput(payload))
      case "runtime.get_research_memory_record":
        return this.getResearchMemoryRecord(readResearchMemoryInspectionInput(payload))
      case "runtime.preview_research_memory_near_duplicates":
        return this.previewResearchMemoryNearDuplicates(readResearchMemoryNearDuplicateInput(payload))
      case "runtime.research_memory_search_profile":
        return this.researchMemorySearchProfile()
      case "runtime.preview_commander_proposal_continuity":
        return this.previewCommanderProposalContinuity(readCommanderProposalContinuityInput(payload))
      case "runtime.preview_commander_midmission_continuity":
        return this.previewCommanderMidMissionContinuity(readCommanderMidMissionContinuityInput(payload))
      case "runtime.commander_continuity_summary":
        return this.commanderContinuitySummary(readCommanderContinuitySummaryInput(payload))
      case "runtime.list_commander_continuity_open_loops":
        return this.listCommanderContinuityOpenLoops(readCommanderContinuityOpenLoopInput(payload))
      case "runtime.show_commander_continuity_thread":
        return this.showCommanderContinuityThread(readCommanderContinuityThreadInput(payload))
      case "runtime.preview_opencode_session_continuity":
        return this.previewOpenCodeSessionContinuity(readOpenCodeSessionContinuityInput(payload))
      case "runtime.preview_opencode_continuation":
        return this.previewOpenCodeContinuation(readOpenCodeContinuationInput(payload))
      case "runtime.preview_opencode_context_refresh":
        return this.previewOpenCodeContextRefresh(readOpenCodeContextRefreshWriteInput(payload))
      case "runtime.write_opencode_context_refresh":
        return this.writeOpenCodeContextRefresh(readOpenCodeContextRefreshWriteInput(payload))
      case "runtime.list_opencode_context_refreshes":
        return this.listOpenCodeContextRefreshes({ limit: optionalPositiveInteger(payload.limit, "limit", 100), session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId"), continuity_mode: optionalString(payload.continuityMode ?? payload.continuity_mode ?? payload.mode, "continuityMode") })
      case "runtime.get_opencode_context_refresh":
        return this.getOpenCodeContextRefresh(requiredString(payload.refreshId ?? payload.refresh_id, "refreshId"))
      case "runtime.latest_opencode_context_refresh":
        return this.latestOpenCodeContextRefresh({ session_id: optionalString(payload.sessionId ?? payload.session_id ?? payload.session, "sessionId") })
      case "runtime.opencode_context_refresh_summary":
        return this.openCodeContextRefreshSummary({ limit: optionalPositiveInteger(payload.limit, "limit", 100) })
      case "runtime.preview_research_novelty_check":
        return this.previewResearchNoveltyCheck(readResearchNoveltyInput(payload))
      case "runtime.preview_commander_executor_review":
        return this.previewCommanderExecutorReview(readCommanderExecutorReviewInput(payload))
      case "runtime.execute_commander_executor_review":
        return this.executeCommanderExecutorReview(readCommanderExecutorReviewInput(payload))
      case "runtime.list_commander_executor_reviews":
        return this.listCommanderExecutorReviews({
          limit: optionalPositiveInteger(payload.limit, "limit", 100) ?? undefined,
          packet_id: optionalString(payload.packetId ?? payload.packet_id, "packetId"),
          mission_id: optionalString(payload.missionId ?? payload.mission_id, "missionId"),
          handoff_id: optionalString(payload.handoffId ?? payload.handoff_id, "handoffId"),
        })
      case "runtime.get_commander_executor_review":
        return this.getCommanderExecutorReview(requiredString(payload.reviewId ?? payload.review_id, "reviewId"))
      case "runtime.preview_executor_review_proposal_drafts":
        return this.previewExecutorReviewProposalDrafts(readExecutorReviewProposalDraftPreviewInput(payload))
      case "runtime.executor_review_proposal_draft_summary":
        return this.executorReviewProposalDraftSummary(readExecutorReviewProposalDraftPreviewInput(payload))
      case "runtime.preview_executor_review_proposal_create":
        return this.previewExecutorReviewProposalCreate(readExecutorReviewProposalCreatePreviewInput(payload))
      case "runtime.create_executor_review_proposal":
        return this.createExecutorReviewProposal(readExecutorReviewProposalCreateInput(payload))
      case "runtime.list_executor_review_proposal_creates":
        return this.listExecutorReviewProposalCreates({
          limit: optionalPositiveInteger(payload.limit, "limit", 100),
          review_id: optionalString(payload.reviewId ?? payload.review_id, "reviewId"),
          proposal_id: optionalString(payload.proposalId ?? payload.proposal_id, "proposalId"),
        })
      case "runtime.get_executor_review_proposal_create":
        return this.getExecutorReviewProposalCreate(requiredString(payload.createId ?? payload.create_id, "createId"))
      case "runtime.preview_executor_review_proposal_review_request":
        return this.previewExecutorReviewProposalReviewRequest(readExecutorReviewProposalReviewRequestPreviewInput(payload))
      case "runtime.request_executor_review_proposal_review":
        return this.requestExecutorReviewProposalReview(readExecutorReviewProposalReviewRequestInput(payload))
      case "runtime.list_executor_review_proposal_review_requests":
        return this.listExecutorReviewProposalReviewRequests({
          limit: optionalPositiveInteger(payload.limit, "limit", 100),
          proposal_id: optionalString(payload.proposalId ?? payload.proposal_id, "proposalId"),
          review_request_id: optionalString(payload.reviewRequestId ?? payload.review_request_id, "reviewRequestId"),
          create_id: optionalString(payload.createId ?? payload.create_id, "createId"),
        })
      case "runtime.get_executor_review_proposal_review_request":
        return this.getExecutorReviewProposalReviewRequest(requiredString(payload.requestGateId ?? payload.request_gate_id, "requestGateId"))
      case "runtime.preview_executor_review_proposal_review_decision":
        return this.previewExecutorReviewProposalReviewDecision(readExecutorReviewProposalReviewDecisionPreviewInput(payload))
      case "runtime.decide_executor_review_proposal_review":
        return this.decideExecutorReviewProposalReview(readExecutorReviewProposalReviewDecisionInput(payload))
      case "runtime.list_executor_review_proposal_review_decisions":
        return this.listExecutorReviewProposalReviewDecisions({
          limit: optionalPositiveInteger(payload.limit, "limit", 100),
          review_request_id: optionalString(payload.reviewRequestId ?? payload.review_request_id ?? payload.reviewId ?? payload.review_id, "reviewRequestId"),
          proposal_id: optionalString(payload.proposalId ?? payload.proposal_id, "proposalId"),
          request_gate_id: optionalString(payload.requestGateId ?? payload.request_gate_id, "requestGateId"),
          decision: optionalString(payload.decision, "decision") as "approve" | "reject" | undefined,
        })
      case "runtime.get_executor_review_proposal_review_decision":
        return this.getExecutorReviewProposalReviewDecision(requiredString(payload.decisionGateId ?? payload.decision_gate_id, "decisionGateId"))
      case "runtime.preview_executor_review_proposal_apply_readiness":
        return this.previewExecutorReviewProposalApplyReadiness(readExecutorReviewProposalApplyReadinessInput(payload))
      case "runtime.executor_review_proposal_apply_readiness_summary":
        return this.executorReviewProposalApplyReadinessSummary({
          limit: optionalPositiveInteger(payload.limit, "limit", 100),
        })
      case "runtime.list_executor_review_proposal_apply_readiness":
        return this.listExecutorReviewProposalApplyReadiness({
          limit: optionalPositiveInteger(payload.limit, "limit", 100),
          status: optionalString(payload.status, "status") as ExecutorReviewProposalApplyReadinessStatus | undefined,
          candidate_kind: optionalString(payload.candidateKind ?? payload.candidate_kind, "candidateKind") as ExecutorReviewProposalApplyCandidateKind | undefined,
          proposal_id: optionalString(payload.proposalId ?? payload.proposal_id, "proposalId"),
        })
      case "runtime.get_executor_review_proposal_apply_readiness":
        return this.getExecutorReviewProposalApplyReadiness(requiredString(payload.readinessId ?? payload.readiness_id, "readinessId"))
      case "runtime.preview_executor_review_proposal_narrow_apply":
        return this.previewExecutorReviewProposalNarrowApply(readExecutorReviewProposalNarrowApplyPreviewInput(payload))
      case "runtime.apply_executor_review_proposal_narrow":
        return this.applyExecutorReviewProposalNarrow(readExecutorReviewProposalNarrowApplyInput(payload))
      case "runtime.list_executor_review_proposal_narrow_applies":
        return this.listExecutorReviewProposalNarrowApplies({
          limit: optionalPositiveInteger(payload.limit, "limit", 100),
          proposal_id: optionalString(payload.proposalId ?? payload.proposal_id, "proposalId"),
          status: optionalString(payload.status, "status"),
          candidate_kind: optionalString(payload.candidateKind ?? payload.candidate_kind, "candidateKind") as ExecutorReviewProposalApplyCandidateKind | undefined,
        })
      case "runtime.get_executor_review_proposal_narrow_apply":
        return this.getExecutorReviewProposalNarrowApply(requiredString(payload.applyId ?? payload.apply_id, "applyId"))
      case "runtime.get_opencode_handoff_followup":
        return this.getOpenCodeHandoffFollowup(requiredString(payload.handoffId ?? payload.handoff_id, "handoffId"))
      case "runtime.list_opencode_handoff_followups":
        return this.listOpenCodeHandoffFollowups({
          limit: optionalPositiveIntegerUnbounded(payload.limit, "limit"),
          staleAfterMs: optionalPositiveIntegerUnbounded(payload.staleAfterMs ?? payload.stale_after_ms, "staleAfterMs"),
        })
      case "runtime.opencode_handoff_followup_summary":
        return this.openCodeHandoffFollowupSummary({
          staleAfterMs: optionalPositiveIntegerUnbounded(payload.staleAfterMs ?? payload.stale_after_ms, "staleAfterMs"),
        })
      case "runtime.opencode_handoff_followup_queue":
        return this.openCodeHandoffFollowupQueue(readOpenCodeHandoffFollowupQueueKind(payload.queue), {
          limit: optionalPositiveIntegerUnbounded(payload.limit, "limit"),
          staleAfterMs: optionalPositiveIntegerUnbounded(payload.staleAfterMs ?? payload.stale_after_ms, "staleAfterMs"),
        })
      case "runtime.preview_runtime_checkpoint":
        return this.previewRuntimeCheckpoint(readRuntimeCheckpointInput(payload))
      case "runtime.create_runtime_checkpoint":
        return this.createRuntimeCheckpoint(readRuntimeCheckpointInput(payload))
      case "runtime.get_runtime_checkpoint":
        return this.getRuntimeCheckpoint(requiredString(payload.checkpointId ?? payload.checkpoint_id, "checkpointId"))
      case "runtime.list_runtime_checkpoints":
        return this.listRuntimeCheckpoints(optionalPositiveInteger(payload.limit, "limit", 100) ?? 20)
      case "runtime.preview_checkpoint_restore":
        return this.previewCheckpointRestore(readRuntimeRestoreInput(payload))
      case "runtime.mark_checkpoint_resume_anchor":
        return this.markCheckpointResumeAnchor(readRuntimeRestoreInput(payload))
      case "runtime.get_checkpoint_resume_anchor":
        return this.getCheckpointResumeAnchor(requiredString(payload.resumeId ?? payload.resume_id, "resumeId"))
      case "runtime.list_checkpoint_resume_anchors":
        return this.listCheckpointResumeAnchors(optionalPositiveInteger(payload.limit, "limit", 100) ?? 20)
      case "runtime.preview_wake_assessment":
        return this.previewWakeAssessment(readWakeAssessmentInput(payload))
      case "runtime.create_wake_assessment":
        return this.createWakeAssessment(readWakeAssessmentInput(payload))
      case "runtime.get_wake_assessment":
        return this.getWakeAssessment(requiredString(payload.wakeId ?? payload.wake_id, "wakeId"))
      case "runtime.list_wake_assessments":
        return this.listWakeAssessments(optionalPositiveInteger(payload.limit, "limit", 100) ?? 20)
      case "runtime.preview_continuation_plan":
        return this.previewContinuationPlan(readContinuationPlanInput(payload))
      case "runtime.create_continuation_plan":
        return this.createContinuationPlan(readContinuationPlanInput(payload))
      case "runtime.get_continuation_plan":
        return this.getContinuationPlan(requiredString(payload.planId ?? payload.plan_id, "planId"))
      case "runtime.list_continuation_plans":
        return this.listContinuationPlans(optionalPositiveInteger(payload.limit, "limit", 100) ?? 20)
      case "runtime.execute_continuation_step":
        return this.executeContinuationStep(readContinuationStepInput(payload))
      case "runtime.pause_continuation_plan":
        return this.pauseContinuationPlan(readContinuationPlanDecisionInput(payload))
      case "runtime.cancel_continuation_plan":
        return this.cancelContinuationPlan(readContinuationPlanDecisionInput(payload))
      case "runtime.preview_wake_schedule":
        return this.previewWakeSchedule(readWakeScheduleInput(payload))
      case "runtime.create_wake_schedule":
        return this.createWakeSchedule(readWakeScheduleInput(payload))
      case "runtime.get_wake_schedule":
        return this.getWakeSchedule(requiredString(payload.scheduleId ?? payload.schedule_id, "scheduleId"))
      case "runtime.list_wake_schedules":
        return this.listWakeSchedules(optionalPositiveInteger(payload.limit, "limit", 100) ?? 20)
      case "runtime.pause_wake_schedule":
        return this.pauseWakeSchedule(readWakeScheduleDecisionInput(payload))
      case "runtime.resume_wake_schedule":
        return this.resumeWakeSchedule(readWakeScheduleDecisionInput(payload))
      case "runtime.cancel_wake_schedule":
        return this.cancelWakeSchedule(readWakeScheduleDecisionInput(payload))
      case "runtime.preview_wake_schedule_tick":
        return this.previewWakeScheduleTick(readWakeScheduleTickInput(payload))
      case "runtime.execute_wake_schedule_tick":
        return this.executeWakeScheduleTick(readWakeScheduleTickInput(payload))
      case "runtime.list_wake_schedule_ticks":
        return this.listWakeScheduleTicks(optionalPositiveInteger(payload.limit, "limit", 100) ?? 20)
      case "runtime.get_wake_schedule_tick":
        return this.getWakeScheduleTick(requiredString(payload.tickId ?? payload.tick_id, "tickId"))
      case "runtime.preview_wake_scheduler_start":
        return this.previewWakeSchedulerStart(readWakeSchedulerStartInput(payload))
      case "runtime.start_wake_scheduler":
        return this.startWakeScheduler(readWakeSchedulerStartInput(payload))
      case "runtime.stop_wake_scheduler":
        return this.stopWakeScheduler(readWakeSchedulerStopInput(payload))
      case "runtime.wake_scheduler_status":
        return this.wakeSchedulerStatus()
      case "runtime.wake_scheduler_bootstrap_status":
        return this.wakeSchedulerBootstrapStatus()
      case "runtime.preview_wake_scheduler_bootstrap":
        return this.previewWakeSchedulerBootstrap()
      case "runtime.preview_wake_scheduler_recovery":
        return this.previewWakeSchedulerRecovery()
      case "runtime.get_wake_scheduler_recovery":
        return this.getWakeSchedulerRecovery(requiredString(payload.recoveryId ?? payload.recovery_id, "recoveryId"))
      case "runtime.list_wake_scheduler_recoveries":
        return this.listWakeSchedulerRecoveries(optionalPositiveInteger(payload.limit, "limit", 100) ?? 20)
      case "runtime.acknowledge_wake_scheduler_recovery":
        return this.acknowledgeWakeSchedulerRecovery(readWakeSchedulerRecoveryAcknowledgeInput(payload))
      case "runtime.preview_wake_scheduler_recovery_workflow":
        return this.previewWakeSchedulerRecoveryWorkflow(readWakeSchedulerRecoveryWorkflowInput(payload))
      case "runtime.create_wake_scheduler_recovery_workflow":
        return this.createWakeSchedulerRecoveryWorkflow(readWakeSchedulerRecoveryWorkflowInput(payload))
      case "runtime.get_wake_scheduler_recovery_workflow":
        return this.getWakeSchedulerRecoveryWorkflow(requiredString(payload.workflowId ?? payload.workflow_id, "workflowId"))
      case "runtime.list_wake_scheduler_recovery_workflows":
        return this.listWakeSchedulerRecoveryWorkflows(optionalPositiveInteger(payload.limit, "limit", 100) ?? 20)
      case "runtime.record_wake_scheduler_recovery_workflow_step":
        return this.recordWakeSchedulerRecoveryWorkflowStep(readWakeSchedulerRecoveryWorkflowStepRecordInput(payload))
      case "runtime.cancel_wake_scheduler_recovery_workflow":
        return this.cancelWakeSchedulerRecoveryWorkflow(readWakeSchedulerRecoveryWorkflowCancelInput(payload))
      case "runtime.verify_wake_scheduler_recovery_workflow":
        return this.verifyWakeSchedulerRecoveryWorkflow(requiredString(payload.workflowId ?? payload.workflow_id, "workflowId"))
      case "runtime.wake_scheduler_audit_summary":
        return this.wakeSchedulerAuditSummary()
      case "runtime.wake_scheduler_audit_timeline":
        return this.wakeSchedulerAuditTimeline(readWakeSchedulerAuditQuery(payload))
      case "runtime.wake_scheduler_audit_chain":
        return this.wakeSchedulerAuditChain(requiredString(payload.relatedId ?? payload.related_id, "relatedId"), optionalPositiveInteger(payload.limit, "limit", 200))
      case "runtime.wake_scheduler_audit_incidents":
        return this.wakeSchedulerAuditIncidents({
          limit: optionalPositiveInteger(payload.limit, "limit", 200),
          status: optionalString(payload.status, "status"),
          severity: optionalString(payload.severity, "severity"),
        })
      case "runtime.wake_scheduler_navigation_board":
        return this.wakeSchedulerNavigationBoard(payload)
      case "runtime.preview_wake_scheduler_navigation_command":
        return this.previewWakeSchedulerNavigationCommand(requiredString(payload.command, "command"))
      case "runtime.get_wake_scheduler_navigation_target":
        return this.getWakeSchedulerNavigationTarget(requiredString(payload.targetKind ?? payload.target_kind, "targetKind"), requiredString(payload.targetId ?? payload.target_id, "targetId"))
      case "runtime.preview_wake_scheduler_navigation_stage":
        return this.previewWakeSchedulerNavigationStage(readWakeSchedulerNavigationStageInput(payload))
      case "runtime.stage_wake_scheduler_navigation_command":
        return this.stageWakeSchedulerNavigationCommand(readWakeSchedulerNavigationStageInput(payload))
      case "runtime.list_wake_scheduler_navigation_staged_commands":
        return this.listWakeSchedulerNavigationStagedCommands(optionalPositiveInteger(payload.limit, "limit", 100) ?? 20)
      case "runtime.remove_wake_scheduler_navigation_staged_command":
        return this.removeWakeSchedulerNavigationStagedCommand(readWakeSchedulerNavigationStageRemoveInput(payload))
      case "runtime.clear_wake_scheduler_navigation_staged_commands":
        return this.clearWakeSchedulerNavigationStagedCommands(readWakeSchedulerNavigationStageClearInput(payload))
      case "runtime.preview_wake_scheduler_navigation_staged_read":
        return this.previewWakeSchedulerNavigationStagedRead(readWakeSchedulerNavigationStagedRunInput(payload))
      case "runtime.execute_wake_scheduler_navigation_staged_read":
        return this.executeWakeSchedulerNavigationStagedRead(readWakeSchedulerNavigationStagedRunInput(payload))
      case "runtime.list_wake_scheduler_navigation_staged_read_runs":
        return this.listWakeSchedulerNavigationStagedReadRuns(readWakeSchedulerNavigationStagedRunListInput(payload))
      case "runtime.get_wake_scheduler_navigation_staged_read_run":
        return this.getWakeSchedulerNavigationStagedReadRun(requiredString(payload.runId ?? payload.run_id, "runId"))
      case "runtime.wake_scheduler_navigation_staged_read_history":
        return this.wakeSchedulerNavigationStagedReadHistory(readWakeSchedulerNavigationStagedReadHistoryInput(payload))
      case "runtime.wake_scheduler_navigation_staged_read_compare":
        return this.wakeSchedulerNavigationStagedReadCompare(readWakeSchedulerNavigationStagedReadCompareInput(payload))
      case "runtime.wake_scheduler_navigation_staged_read_stale":
        return this.wakeSchedulerNavigationStagedReadStale(readWakeSchedulerNavigationStagedReadStaleInput(payload))
      case "runtime.wake_scheduler_navigation_staged_read_group":
        return this.wakeSchedulerNavigationStagedReadGroup(readWakeSchedulerNavigationStagedReadGroupInput(payload))
      case "runtime.preview_wake_scheduler_navigation_write_command":
        return this.previewWakeSchedulerNavigationWriteCommand(readWakeSchedulerNavigationWritePreviewInput(payload))
      case "runtime.wake_scheduler_navigation_write_board":
        return this.wakeSchedulerNavigationWriteBoard(readWakeSchedulerNavigationWriteBoardInput(payload))
      case "runtime.preview_wake_scheduler_navigation_write_stage":
        return this.previewWakeSchedulerNavigationWriteStage(readWakeSchedulerNavigationWriteStageInput(payload))
      case "runtime.stage_wake_scheduler_navigation_write_command":
        return this.stageWakeSchedulerNavigationWriteCommand(readWakeSchedulerNavigationWriteStageInput(payload))
      case "runtime.get_wake_scheduler_navigation_staged_write_command":
        return this.getWakeSchedulerNavigationStagedWriteCommand(requiredString(payload.stagedWriteId ?? payload.staged_write_id, "stagedWriteId"))
      case "runtime.list_wake_scheduler_navigation_staged_write_commands":
        return this.listWakeSchedulerNavigationStagedWriteCommands(optionalPositiveInteger(payload.limit, "limit", 100) ?? 20)
      case "runtime.remove_wake_scheduler_navigation_staged_write_command":
        return this.removeWakeSchedulerNavigationStagedWriteCommand(readWakeSchedulerNavigationWriteStageRemoveInput(payload))
      case "runtime.clear_wake_scheduler_navigation_staged_write_commands":
        return this.clearWakeSchedulerNavigationStagedWriteCommands(readWakeSchedulerNavigationWriteStageClearInput(payload))
      case "runtime.preview_wake_scheduler_navigation_write_run":
        return this.previewWakeSchedulerNavigationWriteRun(readWakeSchedulerNavigationWriteRunInput(payload))
      case "runtime.execute_wake_scheduler_navigation_write_run":
        return this.executeWakeSchedulerNavigationWriteRun(readWakeSchedulerNavigationWriteRunInput(payload))
      case "runtime.list_wake_scheduler_navigation_write_runs":
        return this.listWakeSchedulerNavigationWriteRuns(readWakeSchedulerNavigationWriteRunListInput(payload))
      case "runtime.get_wake_scheduler_navigation_write_run":
        return this.getWakeSchedulerNavigationWriteRun(requiredString(payload.runId ?? payload.run_id, "runId"))
      case "runtime.wake_scheduler_navigation_write_run_history":
        return this.wakeSchedulerNavigationWriteRunHistory(readWakeSchedulerNavigationWriteRunHistoryInput(payload))
      case "runtime.wake_scheduler_navigation_write_run_compare":
        return this.wakeSchedulerNavigationWriteRunCompare(readWakeSchedulerNavigationWriteRunCompareInput(payload))
      case "runtime.wake_scheduler_navigation_write_run_stale":
        return this.wakeSchedulerNavigationWriteRunStale(readWakeSchedulerNavigationWriteRunStaleInput(payload))
      case "runtime.wake_scheduler_navigation_write_run_group":
        return this.wakeSchedulerNavigationWriteRunGroup(readWakeSchedulerNavigationWriteRunGroupInput(payload))
      case "runtime.preview_wake_scheduler_navigation_write_readiness":
        return this.previewWakeSchedulerNavigationWriteReadiness(readWakeSchedulerNavigationWriteReadinessInput(payload))
      case "runtime.approve_wake_scheduler_navigation_staged_write":
        return this.approveWakeSchedulerNavigationStagedWrite(readWakeSchedulerNavigationWriteApprovalInput(payload))
      case "runtime.reject_wake_scheduler_navigation_staged_write":
        return this.rejectWakeSchedulerNavigationStagedWrite(readWakeSchedulerNavigationWriteApprovalRejectInput(payload))
      case "runtime.revoke_wake_scheduler_navigation_write_approval":
        return this.revokeWakeSchedulerNavigationWriteApproval(readWakeSchedulerNavigationWriteApprovalRevokeInput(payload))
      case "runtime.get_wake_scheduler_navigation_write_approval":
        return this.getWakeSchedulerNavigationWriteApproval(requiredString(payload.approvalId ?? payload.approval_id, "approvalId"))
      case "runtime.list_wake_scheduler_navigation_write_approvals":
        return this.listWakeSchedulerNavigationWriteApprovals(readWakeSchedulerNavigationWriteApprovalListInput(payload))
      case "runtime.preview_wake_scheduler_navigation_checkpoint_write_run":
        return this.previewWakeSchedulerNavigationCheckpointWriteRun(readWakeSchedulerNavigationCheckpointWriteRunInput(payload))
      case "runtime.execute_wake_scheduler_navigation_checkpoint_write_run":
        return this.executeWakeSchedulerNavigationCheckpointWriteRun(readWakeSchedulerNavigationCheckpointWriteRunInput(payload))
      case "runtime.list_wake_scheduler_navigation_checkpoint_write_runs":
        return this.listWakeSchedulerNavigationCheckpointWriteRuns(readWakeSchedulerNavigationCheckpointWriteRunListInput(payload))
      case "runtime.get_wake_scheduler_navigation_checkpoint_write_run":
        return this.getWakeSchedulerNavigationCheckpointWriteRun(requiredString(payload.runId ?? payload.run_id, "runId"))
      case "runtime.wake_scheduler_navigation_checkpoint_write_history":
        return this.wakeSchedulerNavigationCheckpointWriteHistory(readWakeSchedulerNavigationCheckpointWriteHistoryInput(payload))
      case "runtime.wake_scheduler_navigation_checkpoint_write_compare":
        return this.wakeSchedulerNavigationCheckpointWriteCompare(readWakeSchedulerNavigationCheckpointWriteCompareInput(payload))
      case "runtime.wake_scheduler_navigation_checkpoint_write_stale":
        return this.wakeSchedulerNavigationCheckpointWriteStale(readWakeSchedulerNavigationCheckpointWriteStaleInput(payload))
      case "runtime.wake_scheduler_navigation_checkpoint_write_group":
        return this.wakeSchedulerNavigationCheckpointWriteGroup(readWakeSchedulerNavigationCheckpointWriteGroupInput(payload))
      case "runtime.wake_scheduler_navigation_checkpoint_write_approval_usage":
        return this.wakeSchedulerNavigationCheckpointWriteApprovalUsage(readWakeSchedulerNavigationCheckpointApprovalUsageInput(payload))
      case "runtime.list_wake_scheduler_events":
        return this.listWakeSchedulerEvents(optionalPositiveInteger(payload.limit, "limit", 100) ?? 20)
      case "runtime.shutdown":
        return this.shutdown(String(payload.reason ?? "command"))
      default:
        throw new Error(`unknown runtime command: ${name}`)
    }
  }

  async status(): Promise<RuntimeStatus> {
    this.checkResearchProjectionForStatus()
    const policy = await this.policyService.metadata()
    const adapterStatus = await this.adapter.getStatus()
    let specSummary = this.specSummary
    if (!specSummary) {
      const current = await this.specService.readCurrent()
      specSummary = current?.status === "approved" ? this.specService.toSummary(current) : null
    }
    return redactValue({
      projectDir: this.projectDir,
      projectName: projectName(this.projectDir),
      mode: this.mode,
      specApproved: specSummary?.status === "approved",
      runtimeStatus: this.started ? "started" : "created",
      lockHeld: this.runLock.isHeld(),
      fakeOpenCode: String(adapterStatus.message ?? ""),
      adapterStatus,
      executorStreamError: this.executorStreamError ?? undefined,
      missions: await this.missionRegistry.statusSummary(),
      reviews: await this.reviewRegistry.statusSummary(),
      proposals: await this.proposalRegistry.statusSummary(),
      proposalBundles: await this.proposalBundleRegistry.statusSummary(),
      playbookDrafts: await this.commanderPlaybookDraftRegistry.statusSummary(),
      reasoningProvider: this.reasoningProviderStatus(),
      researchProjection: this.researchProjectionHealth,
      wakeScheduler: {
        status: await this.wakeSchedulerStatus(),
        bootstrap: await this.wakeSchedulerBootstrapStatus(),
        recovery: await this.previewWakeSchedulerRecovery(),
      },
      policy,
    })
  }

  reasoningProviderStatus(): ReasoningProviderStatus {
    return reasoningProviderStatus(this.reasoningProviderConfig)
  }

  async resume(): Promise<{ events: number }> {
    const events = await this.eventStore.readAll()
    this.eventBus.emit({ type: "ResumeSummaryLoaded", recordsCount: events.length, lastRunId: await this.eventStore.latestEventId() ?? undefined })
    return { events: events.length }
  }

  async startNewSession(): Promise<{ adapter: Record<string, unknown> }> {
    if (this.mode !== "active") {
      throw new Error("runtime.start_new_session requires active mode")
    }
    if (!this.started || !this.runLock.isHeld()) {
      throw new Error("runtime must be started before starting a new session")
    }
    await this.adapter.startSession({ projectDir: this.projectDir, objective: this.specSummary?.objective ?? "" })
    this.startExecutorEventPump()
    return { adapter: await this.adapter.getStatus() }
  }

  async viewRecords(): Promise<{ events: unknown[] }> {
    return { events: redactValue(await this.eventStore.readAll()) }
  }

  listResearchTopics(query?: string, options?: SearchOptions): Topic[] {
    this.ensureResearchProjectionUsable("read")
    const db = this.getResearchDb()
    const topics = query === undefined ? db.listTopics() : db.searchTopics(query, options)
    return redactValue(topics)
  }

  getResearchTopicSnapshot(topicId: string): TopicSnapshot | null {
    this.ensureResearchProjectionUsable("read")
    return redactValue(this.getResearchDb().getTopicSnapshot(topicId))
  }

  listResearchEvents(options?: ListResearchEventsOptions): ResearchEvent[] {
    this.ensureResearchProjectionUsable("read")
    return redactValue(this.getResearchDb().listResearchEvents(options))
  }

  searchResearchNotes(topicId: string, query: string, options?: SearchOptions): Note[] {
    this.ensureResearchProjectionUsable("read")
    return redactValue(this.getResearchDb().searchNotes(topicId, query, options))
  }

  researchProjectionStatus(): RuntimeResearchProjectionHealth {
    this.checkResearchProjectionForStatus()
    return redactValue(this.researchProjectionHealth)
  }

  async rebuildResearchProjection(options: { force: boolean } = { force: false }): Promise<RuntimeResearchProjectionHealth> {
    if (this.researchProjectionMode === "disabled") {
      this.researchProjectionHealth = this.disabledProjectionHealth()
      return redactValue(this.researchProjectionHealth)
    }
    if (!options.force) {
      const integrity = this.checkResearchProjectionForStatus()
      if (integrity.ok && !integrity.stale) return redactValue(this.researchProjectionHealth)
      if (!integrity.stale) throw new Error(`research projection corrupt: ${integrity.reason ?? "unknown"}`)
    }
    await this.withProjectionWriteLock(() => this.rebuildProjection("command"))
    const integrity = this.checkResearchProjectionForStatus({ emit: true })
    if (!integrity.ok || integrity.stale) {
      throw new Error(`research projection rebuild did not produce a usable projection: ${integrity.reason ?? "unknown"}`)
    }
    return redactValue(this.researchProjectionHealth)
  }

  async submitUserMessage(message: string): Promise<{ accepted: true; missionId: string; intentId: string }> {
    if (this.mode !== "active") {
      throw new Error("runtime.submit_user_message requires active mode")
    }
    if (!this.started || !this.runLock.isHeld()) {
      throw new Error("runtime must be started before accepting user messages")
    }
    const sent = await this.createAndSendMission(message)
    return { accepted: true, missionId: sent.mission_id, intentId: sent.intent_id }
  }

  private async createAndSendMission(message: string): Promise<{ mission_id: string; intent_id: string }> {
    const { intent, mission } = await this.missionRegistry.createUserMessageMission(message)
    const packet = this.missionRegistry.createPacket(mission, message)
    try {
      await this.adapter.sendMissionPacket(packet)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.missionRegistry.markMissionFailed(mission.mission_id, message)
      throw new Error(`mission ${mission.mission_id} adapter delivery failed: ${redactValue(message)}`)
    }
    try {
      await this.missionRegistry.markMissionSent(mission.mission_id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`mission ${mission.mission_id} adapter delivery succeeded but sent-state persistence failed: ${redactValue(message)}`)
    }
    this.eventBus.emit({ type: "ExecutorLifecycle", phase: "mission-packet-sent", message: `Mission ${mission.mission_id} sent to adapter` })
    return { mission_id: mission.mission_id, intent_id: intent.intent_id }
  }

  async getMission(missionId: string): Promise<MissionRecord | null> {
    return this.missionRegistry.getMission(missionId)
  }

  async listRecentMissions(limit?: number): Promise<MissionRecord[]> {
    return this.missionRegistry.listRecentMissions(limit)
  }

  async missionStatusSummary(): Promise<MissionStatusSummary> {
    return this.missionRegistry.statusSummary()
  }

  async createReviewRequest(input: ReviewRequestInput): Promise<ReviewRequest> {
    this.requireReviewWriteRuntime("runtime.create_review_request")
    return this.reviewRegistry.createReviewRequest(input)
  }

  async getReviewRequest(reviewId: string): Promise<ReviewRequest | null> {
    return this.reviewRegistry.getReviewRequest(reviewId)
  }

  async listReviewRequests(options: { status?: ReviewStatus; limit?: number } = {}): Promise<ReviewRequest[]> {
    return this.reviewRegistry.listReviewRequests(options)
  }

  async approveReviewRequest(reviewId: string, decidedBy: string, reason?: string): Promise<ReviewRequest> {
    this.requireReviewWriteRuntime("runtime.approve_review_request")
    const review = await this.reviewRegistry.approveReviewRequest(reviewId, decidedBy, reason)
    await this.proposalRegistry.syncReviewDecision(review.review_id)
    return review
  }

  async rejectReviewRequest(reviewId: string, decidedBy: string, reason?: string): Promise<ReviewRequest> {
    this.requireReviewWriteRuntime("runtime.reject_review_request")
    const review = await this.reviewRegistry.rejectReviewRequest(reviewId, decidedBy, reason)
    await this.proposalRegistry.syncReviewDecision(review.review_id)
    return review
  }

  async cancelReviewRequest(reviewId: string, decidedBy: string, reason?: string): Promise<ReviewRequest> {
    this.requireReviewWriteRuntime("runtime.cancel_review_request")
    const review = await this.reviewRegistry.cancelReviewRequest(reviewId, decidedBy, reason)
    await this.proposalRegistry.syncReviewDecision(review.review_id)
    return review
  }

  async reviewStatusSummary(): Promise<ReviewStatusSummary> {
    return this.reviewRegistry.statusSummary()
  }

  async createCommanderProposal(input: CommanderProposalInput): Promise<CommanderProposal> {
    this.requireProposalWriteRuntime("runtime.create_commander_proposal")
    return this.proposalRegistry.createProposal(input)
  }

  async getCommanderProposal(proposalId: string): Promise<CommanderProposal | null> {
    return this.proposalRegistry.getProposal(proposalId)
  }

  async listCommanderProposals(options: { status?: ProposalStatus; limit?: number } = {}): Promise<CommanderProposal[]> {
    return this.proposalRegistry.listProposals(options)
  }

  async requestProposalReview(proposalId: string, input: { title?: string; summary?: string; requested_by: string }): Promise<CommanderProposal> {
    this.requireProposalWriteRuntime("runtime.request_proposal_review")
    return this.proposalRegistry.requestReview(proposalId, input)
  }

  async cancelCommanderProposal(proposalId: string, reason?: string): Promise<CommanderProposal> {
    this.requireProposalWriteRuntime("runtime.cancel_commander_proposal")
    return this.proposalRegistry.cancelProposal(proposalId, reason)
  }

  async applyCommanderProposal(proposalId: string): Promise<CommanderProposal> {
    this.requireProposalWriteRuntime("runtime.apply_commander_proposal")
    return this.proposalRegistry.applyProposal(proposalId)
  }

  async proposalStatusSummary(): Promise<ProposalStatusSummary> {
    return this.proposalRegistry.statusSummary()
  }

  async createProposalBundle(input: CommanderProposalBundleInput): Promise<CommanderProposalBundle> {
    this.requireProposalBundleWriteRuntime("runtime.create_proposal_bundle")
    return this.proposalBundleRegistry.createBundle(input)
  }

  async getProposalBundle(bundleId: string): Promise<CommanderProposalBundle | null> {
    return this.proposalBundleRegistry.getBundle(bundleId)
  }

  async listProposalBundles(options: { status?: CommanderProposalBundleStatus; limit?: number } = {}): Promise<CommanderProposalBundle[]> {
    return this.proposalBundleRegistry.listBundles(options)
  }

  async addProposalToBundle(bundleId: string, proposalId: string): Promise<CommanderProposalBundle> {
    this.requireProposalBundleWriteRuntime("runtime.add_proposal_to_bundle")
    return this.proposalBundleRegistry.addProposal(bundleId, proposalId)
  }

  async proposalBundleReadiness(bundleId: string): Promise<CommanderProposalBundleReadiness> {
    return this.proposalBundleRegistry.readiness(bundleId)
  }

  async requestProposalBundleReviews(bundleId: string, requestedBy: string): Promise<CommanderProposalBundle> {
    this.requireProposalBundleWriteRuntime("runtime.request_proposal_bundle_reviews")
    return this.proposalBundleRegistry.requestReviews(bundleId, { requested_by: requestedBy })
  }

  async applyProposalBundle(bundleId: string, options: { allowPartial?: boolean } = {}): Promise<CommanderProposalBundle> {
    this.requireProposalBundleWriteRuntime("runtime.apply_proposal_bundle")
    return this.proposalBundleRegistry.applyBundle(bundleId, options)
  }

  async cancelProposalBundle(bundleId: string, reason?: string): Promise<CommanderProposalBundle> {
    this.requireProposalBundleWriteRuntime("runtime.cancel_proposal_bundle")
    return this.proposalBundleRegistry.cancelBundle(bundleId, reason)
  }

  async proposalBundleStatusSummary(): Promise<CommanderProposalBundleSummary> {
    return this.proposalBundleRegistry.statusSummary()
  }

  listCommanderPlaybooks(): CommanderPlaybook[] {
    return listCommanderPlaybooks()
  }

  getCommanderPlaybook(playbookId: string): CommanderPlaybook | null {
    const playbook = getCommanderPlaybook(playbookId)
    if (!playbook) throw new Error(`unknown commander playbook: ${redactText(playbookId)}`)
    return playbook
  }

  async draftCommanderPlaybook(input: CommanderPlaybookDraftInput): Promise<CommanderPlaybookDraftResult> {
    this.requireCommanderPlaybookWriteRuntime("runtime.draft_commander_playbook")
    const result = await draftCommanderPlaybook(input, {
      proposalRegistry: this.proposalRegistry,
      proposalBundleRegistry: this.proposalBundleRegistry,
    })
    const draft = await this.commanderPlaybookDraftRegistry.createDraft({
      playbook_id: result.playbook_id,
      proposed_by: input.proposed_by ?? input.requested_by ?? "",
      field_values: input.fields,
      proposal_ids: result.proposal_ids,
      bundle_id: result.bundle_id,
      review_ids: result.review_ids,
      created_at: result.created_at,
    })
    return redactValue({ ...result, draft_id: draft.draft_id })
  }

  async getCommanderPlaybookDraft(draftId: string): Promise<CommanderPlaybookDraft | null> {
    return this.commanderPlaybookDraftRegistry.getDraft(draftId)
  }

  async listCommanderPlaybookDrafts(options: { status?: CommanderPlaybookDraftStatus; limit?: number } = {}): Promise<CommanderPlaybookDraft[]> {
    return this.commanderPlaybookDraftRegistry.listDrafts(options)
  }

  async commanderPlaybookDraftStatusSummary(): Promise<CommanderPlaybookDraftSummary> {
    return this.commanderPlaybookDraftRegistry.statusSummary()
  }

  async commanderPlaybookDraftReadiness(draftId: string): Promise<CommanderPlaybookDraftReadiness> {
    return this.commanderPlaybookDraftRegistry.readiness(draftId)
  }

  async requestCommanderPlaybookDraftReviews(draftId: string, requestedBy: string): Promise<CommanderPlaybookDraft> {
    this.requireCommanderPlaybookWriteRuntime("runtime.request_commander_playbook_draft_reviews")
    return this.commanderPlaybookDraftRegistry.requestReviews(draftId, { requested_by: requestedBy })
  }

  async cancelCommanderPlaybookDraft(draftId: string, reason?: string): Promise<CommanderPlaybookDraft> {
    this.requireCommanderPlaybookWriteRuntime("runtime.cancel_commander_playbook_draft")
    return this.commanderPlaybookDraftRegistry.cancelDraft(draftId, reason)
  }

  async commanderApplyPreview(target: { target_type: CommanderApplyTargetType; target_id: string }): Promise<CommanderApplyPreview> {
    return this.commanderApplyService().preview(target)
  }

  async applyCommanderTarget(target: { target_type: CommanderApplyTargetType; target_id: string }, options: CommanderApplyOptions = {}): Promise<CommanderApplyResult> {
    this.requireCommanderApplyWriteRuntime("runtime.apply_commander_target")
    return this.commanderApplyService().apply(target, options)
  }

  async commanderAuditTimeline(options: Parameters<CommanderAuditService["timeline"]>[0] = {}): Promise<CommanderAuditTimeline> {
    return this.commanderAuditService().timeline(options)
  }

  async commanderAuthorityChain(targetType: string, targetId: string): Promise<CommanderAuthorityChain> {
    return this.commanderAuditService().authorityChain(targetType, targetId)
  }

  async commanderQueueSummary(options: { staleAfterMs?: number } = {}): Promise<CommanderQueueSummary> {
    return this.commanderQueueService().summary(options)
  }

  async commanderQueue(queue: CommanderQueueKind, options: { limit?: number; staleAfterMs?: number } = {}): Promise<CommanderQueueResult> {
    return this.commanderQueueService().queue(queue, options)
  }

  async commanderTargetContext(targetType: string, targetId: string): Promise<CommanderTargetContext> {
    return this.commanderTargetContextService().context(targetType, targetId)
  }

  listExternalApiConnectors(): ReturnType<ExternalApiConnectorRegistry["list"]> {
    return this.externalApiConnectorRegistry.list()
  }

  getExternalApiConnector(connectorId: string): ReturnType<ExternalApiConnectorRegistry["getSummary"]> {
    return this.externalApiConnectorRegistry.getSummary(connectorId)
  }

  previewExternalApiRequest(input: ExternalApiRequestInput): ExternalApiRequestPreview {
    return this.externalApiRequestService().preview(input)
  }

  async executeExternalApiRequest(input: ExternalApiRequestInput): Promise<ExternalApiRequestResult> {
    this.requireExternalApiWriteRuntime("runtime.execute_external_api_request")
    return this.externalApiRequestService().execute(input)
  }

  async listExternalApiAudit(limit = 20): Promise<ExternalApiAuditRecord[]> {
    return this.externalApiRequestService().listAudit(limit)
  }

  reasoningProviderHealth(): ReasoningProviderHealth {
    return this.reasoningProviderHealthService().health()
  }

  previewReasoningProviderSmoke(input: ReasoningProviderSmokeInput = {}): ReasoningProviderSmokePreview {
    return this.reasoningProviderHealthService().preview(input)
  }

  async executeReasoningProviderSmoke(input: ReasoningProviderSmokeInput = {}): Promise<ReasoningProviderSmokeResult> {
    this.requireReasoningProviderSmokeRuntime("runtime.execute_reasoning_provider_smoke")
    return this.reasoningProviderHealthService().execute(input)
  }

  previewMiniMaxLiveValidation(input: MiniMaxLiveValidationInput = {}): MiniMaxLiveValidationPreview {
    return this.minimaxLiveValidationService().preview(input)
  }

  async executeMiniMaxLiveValidation(input: MiniMaxLiveValidationInput = {}): Promise<MiniMaxLiveValidationResult> {
    if (input.dry_run === true) return this.minimaxLiveValidationService().execute(input)
    await this.requireMiniMaxLiveValidationWriteAuthority("runtime.execute_minimax_live_validation")
    return this.withMiniMaxLiveValidationWriteLock(() => this.minimaxLiveValidationService().execute(input))
  }

  async listMiniMaxLiveValidations(limit = 20): Promise<MiniMaxLiveValidationRecord[]> {
    return this.minimaxLiveValidationService().list(limit)
  }

  async getMiniMaxLiveValidation(validationId: string): Promise<MiniMaxLiveValidationResult | null> {
    return this.minimaxLiveValidationService().get(validationId)
  }

  previewExternalApiResearchIngestion(input: ExternalApiResearchIngestionInput): ExternalApiResearchIngestionPreview {
    this.ensureResearchProjectionUsable("read")
    return this.externalApiResearchIngestionService().preview(input)
  }

  async executeExternalApiResearchIngestion(input: ExternalApiResearchIngestionInput): Promise<ExternalApiResearchIngestionResult> {
    this.requireExternalApiResearchWriteRuntime("runtime.execute_external_api_research_ingestion")
    this.ensureResearchProjectionUsable("read")
    return this.externalApiResearchIngestionService().execute(input)
  }

  async listExternalApiResearchIngestions(limit = 20): Promise<ExternalApiResearchIngestionRecord[]> {
    return this.externalApiResearchIngestionService().list(limit)
  }

  async previewResearchSynthesis(input: ResearchSynthesisInput): Promise<ResearchSynthesisPreview> {
    this.ensureResearchProjectionUsable("read")
    return this.researchSynthesisService().preview(input)
  }

  async executeResearchSynthesis(input: ResearchSynthesisInput): Promise<ResearchSynthesisResult> {
    this.requireResearchSynthesisWriteRuntime("runtime.execute_research_synthesis")
    this.ensureResearchProjectionUsable("read")
    return this.researchSynthesisService().execute(input)
  }

  async getResearchSynthesis(synthesisId: string): Promise<ResearchSynthesisResult | null> {
    return this.researchSynthesisService().get(synthesisId)
  }

  async listResearchSyntheses(limit = 20): Promise<ResearchSynthesisRecord[]> {
    return this.researchSynthesisService().list(limit)
  }

  async previewCommanderCycle(input: CommanderCycleInput): Promise<CommanderCyclePreview> {
    this.ensureResearchProjectionUsable("read")
    return this.commanderCycleService().preview(input)
  }

  async executeCommanderCycle(input: CommanderCycleInput): Promise<CommanderCycleResult> {
    this.requireCommanderCycleWriteRuntime("runtime.execute_commander_cycle")
    this.ensureResearchProjectionUsable("read")
    return this.commanderCycleService().execute(input)
  }

  async getCommanderCycle(cycleId: string): Promise<CommanderCycleResult | null> {
    return this.commanderCycleService().get(cycleId)
  }

  async listCommanderCycles(limit = 20): Promise<CommanderCycleRecord[]> {
    return this.commanderCycleService().list(limit)
  }

  async previewOpenCodeHandoff(input: OpenCodeHandoffInput): Promise<OpenCodeHandoffPreview> {
    return this.opencodeHandoffService().preview(input)
  }

  async executeOpenCodeHandoff(input: OpenCodeHandoffInput): Promise<OpenCodeHandoffResult> {
    this.requireOpenCodeHandoffRuntime("runtime.execute_opencode_handoff")
    return this.opencodeHandoffService().execute(input)
  }

  async listOpenCodeHandoffs(limit = 20): Promise<OpenCodeHandoffRecord[]> {
    return this.opencodeHandoffService().list(limit)
  }

  async getOpenCodeHandoff(handoffId: string): Promise<OpenCodeHandoffResult | null> {
    return this.opencodeHandoffService().get(handoffId)
  }

  async previewOpenCodeProcessSmoke(input: { timeout_ms?: number } = {}): Promise<OpenCodeProcessSmokePreview> {
    return this.opencodeProcessSmokeService().preview(input)
  }

  async executeOpenCodeProcessSmoke(input: OpenCodeProcessSmokeExecuteInput = {}): Promise<OpenCodeProcessSmokeResult> {
    if (input.dry_run !== true) {
      if (this.mode !== "active") throw new Error("runtime.execute_opencode_process_smoke requires active mode")
      const preview = await this.opencodeProcessSmokeService().preview({ timeout_ms: input.timeout_ms })
      if (preview.opt_in_present === true && preview.can_execute === true) {
        this.requireOpenCodeProcessSmokeRuntime("runtime.execute_opencode_process_smoke")
      } else {
        this.specSummary ??= await this.specService.requireApproved()
      }
    }
    return this.opencodeProcessSmokeService().execute(input)
  }

  async listOpenCodeProcessSmokes(limit = 20): Promise<OpenCodeProcessSmokeRecord[]> {
    return this.opencodeProcessSmokeService().list(limit)
  }

  async getOpenCodeProcessSmoke(smokeId: string): Promise<OpenCodeProcessSmokeResult | null> {
    return this.opencodeProcessSmokeService().get(smokeId)
  }

  async previewOpenCodeHandoffReadiness(input: Parameters<OpenCodeHandoffReadinessService["preview"]>[0] = {}): Promise<OpenCodeHandoffReadinessPreview> {
    return this.opencodeHandoffReadinessService().preview(input)
  }

  async openCodeHandoffReadinessSummary(input: Parameters<OpenCodeHandoffReadinessService["summary"]>[0] = {}): Promise<OpenCodeHandoffReadinessSummary> {
    return this.opencodeHandoffReadinessService().summary(input)
  }

  async previewOpenCodeResultReviewPacket(input: Parameters<OpenCodeResultReviewPacketService["preview"]>[0] = {}): Promise<OpenCodeResultReviewPacket> {
    return this.opencodeResultReviewPacketService().preview(input)
  }

  async openCodeResultReviewSummary(input: Parameters<OpenCodeResultReviewPacketService["summary"]>[0] = {}): Promise<OpenCodeResultReviewSummary> {
    return this.opencodeResultReviewPacketService().summary(input)
  }

  async previewOpenCodeSessionPlan(input: Parameters<OpenCodeSessionService["preview"]>[0] = {}): Promise<OpenCodeSessionPreview> {
    return this.opencodeSessionService().preview(input)
  }

  async createOpenCodeSessionPlan(input: Parameters<OpenCodeSessionService["create"]>[0] = {}): Promise<OpenCodeSessionPlan> {
    if (input.dry_run !== true) this.requireProposalWriteRuntime("runtime.create_opencode_session_plan")
    return this.opencodeSessionService().create(input)
  }

  async listOpenCodeSessions(input: Parameters<OpenCodeSessionService["list"]>[0] = {}): Promise<OpenCodeSessionRecord[]> {
    return this.opencodeSessionService().list(input)
  }

  async getOpenCodeSession(sessionId: string): Promise<OpenCodeSessionPlan | null> {
    return this.opencodeSessionService().get(sessionId)
  }

  async openCodeSessionSummary(): Promise<OpenCodeSessionSummary> {
    return this.opencodeSessionService().summary()
  }

  async listModelCapabilities(input: Parameters<ContextBudgetService["listModelCapabilities"]>[0] = {}): Promise<ModelCapability[]> {
    return this.contextBudgetService().listModelCapabilities(input)
  }

  async getModelCapability(input: Parameters<ContextBudgetService["getModelCapability"]>[0] = {}): Promise<ModelCapability> {
    return this.contextBudgetService().getModelCapability(input)
  }

  async contextBudgetSummary(): Promise<ContextBudgetSummary> {
    return this.contextBudgetService().summary()
  }

  async previewContextBudget(input: Parameters<ContextBudgetService["preview"]>[0] = {}): Promise<ContextBudgetPreview> {
    return this.contextBudgetService().preview(input)
  }

  async previewContextPacket(input: Parameters<ContextPacketCompilerService["preview"]>[0] = {}): Promise<ContextPacketPreview> {
    return this.contextPacketCompilerService().preview(input)
  }

  async contextPacketSummary(): Promise<ContextPacketSummary> {
    return this.contextPacketCompilerService().summary()
  }

  async previewOpenCodeSessionInstructionPack(input: Parameters<OpenCodeSessionInstructionPackService["preview"]>[0] = {}): Promise<OpenCodeSessionInstructionPackPreview> {
    return this.opencodeSessionInstructionPackService().preview(input)
  }

  async writeOpenCodeSessionInstructionPack(input: Parameters<OpenCodeSessionInstructionPackService["write"]>[0] = {}): Promise<OpenCodeSessionInstructionPackResult> {
    if (input.dry_run === true) return this.opencodeSessionInstructionPackService().write(input)
    return this.withInstructionPackWriteLock(() => this.opencodeSessionInstructionPackService().write(input))
  }

  async listOpenCodeSessionInstructionPacks(input: Parameters<OpenCodeSessionInstructionPackService["list"]>[0] = {}): Promise<OpenCodeSessionInstructionPackRecord[]> {
    return this.opencodeSessionInstructionPackService().list(input)
  }

  async getOpenCodeSessionInstructionPack(packId: string): Promise<OpenCodeSessionInstructionPackResult | null> {
    return this.opencodeSessionInstructionPackService().get(packId)
  }

  async previewOpenCodeLaunchReadiness(input: Parameters<OpenCodeLaunchReadinessService["preview"]>[0] = {}): Promise<OpenCodeLaunchReadinessPreview> {
    return this.opencodeLaunchReadinessService().preview(input)
  }

  async openCodeLaunchReadinessSummary(input: Parameters<OpenCodeLaunchReadinessService["summary"]>[0] = {}): Promise<OpenCodeLaunchReadinessSummary> {
    return this.opencodeLaunchReadinessService().summary(input)
  }

  async previewOpenCodeSessionLaunch(input: Parameters<OpenCodeLaunchGateService["preview"]>[0] = {}): Promise<OpenCodeLaunchPreview> {
    return this.opencodeLaunchGateService().preview(input)
  }

  async launchOpenCodeSession(input: Parameters<OpenCodeLaunchGateService["launch"]>[0] = {}): Promise<OpenCodeLaunchResult> {
    if (input.dry_run === true) return this.opencodeLaunchGateService().launch(input)
    return this.withOpenCodeLaunchWriteLock(() => this.opencodeLaunchGateService().launch(input))
  }

  async listOpenCodeSessionLaunches(input: Parameters<OpenCodeLaunchGateService["list"]>[0] = {}): Promise<OpenCodeLaunchRecord[]> {
    return this.opencodeLaunchGateService().list(input)
  }

  async getOpenCodeSessionLaunch(launchId: string): Promise<OpenCodeLaunchResult | null> {
    return this.opencodeLaunchGateService().get(launchId)
  }

  async previewOpenCodeProgress(input: Parameters<OpenCodeProgressService["preview"]>[0] = {}): Promise<OpenCodeProgressPreview> {
    return this.opencodeProgressService().preview(input)
  }

  async recordOpenCodeProgress(input: Parameters<OpenCodeProgressService["record"]>[0] = {}): Promise<OpenCodeProgressResult> {
    if (input.dry_run === true) return this.opencodeProgressService().record(input)
    return this.withOpenCodeLaunchWriteLock(() => this.opencodeProgressService().record(input))
  }

  async listOpenCodeProgress(input: Parameters<OpenCodeProgressService["list"]>[0] = {}): Promise<OpenCodeProgressRecord[]> {
    return this.opencodeProgressService().list(input)
  }

  async getOpenCodeProgress(progressId: string): Promise<OpenCodeProgressResult | null> {
    return this.opencodeProgressService().get(progressId)
  }

  async latestOpenCodeProgress(input: Parameters<OpenCodeProgressService["latest"]>[0] = {}): Promise<OpenCodeProgressResult | null> {
    return this.opencodeProgressService().latest(input)
  }

  async openCodeProgressSummary(input: Parameters<OpenCodeProgressService["summary"]>[0] = {}): Promise<OpenCodeProgressSummary> {
    return this.opencodeProgressService().summary(input)
  }

  async previewOpenCodeWatchdog(input: Parameters<OpenCodeTimeoutWatchdogService["preview"]>[0] = {}): Promise<OpenCodeWatchdogPreview> {
    return this.opencodeTimeoutWatchdogService().preview(input)
  }

  async recordOpenCodeWatchdog(input: Parameters<OpenCodeTimeoutWatchdogService["record"]>[0] = {}): Promise<OpenCodeWatchdogResult> {
    if (input.dry_run === true) return this.opencodeTimeoutWatchdogService().record(input)
    return this.withOpenCodeLaunchWriteLock(() => this.opencodeTimeoutWatchdogService().record(input))
  }

  async requestOpenCodeForcedReport(input: Parameters<OpenCodeTimeoutWatchdogService["requestForcedReport"]>[0] = {}): Promise<OpenCodeForcedReportRequest | OpenCodeWatchdogResult> {
    if (input.dry_run === true) return this.opencodeTimeoutWatchdogService().requestForcedReport(input)
    return this.withOpenCodeLaunchWriteLock(() => this.opencodeTimeoutWatchdogService().requestForcedReport(input))
  }

  async listOpenCodeWatchdogs(input: Parameters<OpenCodeTimeoutWatchdogService["list"]>[0] = {}): Promise<OpenCodeWatchdogRecord[]> {
    return this.opencodeTimeoutWatchdogService().list(input)
  }

  async getOpenCodeWatchdog(watchdogId: string): Promise<OpenCodeWatchdogResult | null> {
    return this.opencodeTimeoutWatchdogService().get(watchdogId)
  }

  async listOpenCodeForcedReportRequests(input: Parameters<OpenCodeTimeoutWatchdogService["listForcedReports"]>[0] = {}): Promise<OpenCodeForcedReportRequest[]> {
    return this.opencodeTimeoutWatchdogService().listForcedReports(input)
  }

  async getOpenCodeForcedReportRequest(requestId: string): Promise<OpenCodeForcedReportRequest | null> {
    return this.opencodeTimeoutWatchdogService().getForcedReport(requestId)
  }

  async openCodeWatchdogSummary(input: Parameters<OpenCodeTimeoutWatchdogService["summary"]>[0] = {}): Promise<OpenCodeWatchdogSummary> {
    return this.opencodeTimeoutWatchdogService().summary(input)
  }

  async previewOpenCodeCommanderQuestion(input: Parameters<OpenCodeCommanderQuestionService["preview"]>[0] = {}): Promise<OpenCodeCommanderQuestionPreview> {
    return this.opencodeCommanderQuestionService().preview(input)
  }

  async createOpenCodeCommanderQuestion(input: Parameters<OpenCodeCommanderQuestionService["create"]>[0] = {}): Promise<OpenCodeCommanderQuestionResult> {
    if (input.dry_run === true) return this.opencodeCommanderQuestionService().create(input)
    return this.withOpenCodeLaunchWriteLock(() => this.opencodeCommanderQuestionService().create(input))
  }

  async listOpenCodeCommanderQuestions(input: Parameters<OpenCodeCommanderQuestionService["list"]>[0] = {}): Promise<OpenCodeCommanderQuestionRecord[]> {
    return this.opencodeCommanderQuestionService().list(input)
  }

  async getOpenCodeCommanderQuestion(questionId: string): Promise<OpenCodeCommanderQuestionResult | null> {
    return this.opencodeCommanderQuestionService().get(questionId)
  }

  async latestOpenCodeCommanderQuestion(input: Parameters<OpenCodeCommanderQuestionService["latest"]>[0] = {}): Promise<OpenCodeCommanderQuestionResult | null> {
    return this.opencodeCommanderQuestionService().latest(input)
  }

  async openCodeCommanderQuestionSummary(input: Parameters<OpenCodeCommanderQuestionService["summary"]>[0] = {}): Promise<OpenCodeCommanderQuestionSummary> {
    return this.opencodeCommanderQuestionService().summary(input)
  }

  async previewCommanderGuidance(input: Parameters<CommanderGuidanceService["preview"]>[0] = {}): Promise<CommanderGuidancePreview> {
    return this.commanderGuidanceService().preview(input)
  }

  async createCommanderGuidance(input: Parameters<CommanderGuidanceService["create"]>[0] = {}): Promise<CommanderGuidanceResult> {
    if (input.dry_run === true) return this.commanderGuidanceService().create(input)
    return this.withOpenCodeLaunchWriteLock(() => this.commanderGuidanceService().create(input))
  }

  async listCommanderGuidance(input: Parameters<CommanderGuidanceService["list"]>[0] = {}): Promise<CommanderGuidanceRecord[]> {
    return this.commanderGuidanceService().list(input)
  }

  async getCommanderGuidance(guidanceId: string): Promise<CommanderGuidanceResult | null> {
    return this.commanderGuidanceService().get(guidanceId)
  }

  async latestCommanderGuidance(input: Parameters<CommanderGuidanceService["latest"]>[0] = {}): Promise<CommanderGuidanceResult | null> {
    return this.commanderGuidanceService().latest(input)
  }

  async commanderGuidanceSummary(input: Parameters<CommanderGuidanceService["summary"]>[0] = {}): Promise<CommanderGuidanceSummary> {
    return this.commanderGuidanceService().summary(input)
  }

  async previewCommanderGuidanceDelivery(input: Parameters<CommanderGuidanceDeliveryService["preview"]>[0] = {}): Promise<CommanderGuidanceDeliveryPreview> {
    return this.commanderGuidanceDeliveryService().preview(input)
  }

  async deliverCommanderGuidance(input: Parameters<CommanderGuidanceDeliveryService["deliver"]>[0] = {}): Promise<CommanderGuidanceDeliveryResult> {
    if (input.dry_run === true) return this.commanderGuidanceDeliveryService().deliver(input)
    return this.withOpenCodeLaunchWriteLock(() => this.commanderGuidanceDeliveryService().deliver(input))
  }

  async listCommanderGuidanceDeliveries(input: Parameters<CommanderGuidanceDeliveryService["list"]>[0] = {}): Promise<CommanderGuidanceDeliveryRecord[]> {
    return this.commanderGuidanceDeliveryService().list(input)
  }

  async getCommanderGuidanceDelivery(deliveryId: string): Promise<CommanderGuidanceDeliveryResult | null> {
    return this.commanderGuidanceDeliveryService().get(deliveryId)
  }

  async latestCommanderGuidanceDelivery(input: Parameters<CommanderGuidanceDeliveryService["latest"]>[0] = {}): Promise<CommanderGuidanceDeliveryResult | null> {
    return this.commanderGuidanceDeliveryService().latest(input)
  }

  async commanderGuidanceDeliverySummary(input: Parameters<CommanderGuidanceDeliveryService["summary"]>[0] = {}): Promise<CommanderGuidanceDeliverySummary> {
    return this.commanderGuidanceDeliveryService().summary(input)
  }

  async previewOpenCodeHumanControl(input: Parameters<OpenCodeHumanControlService["preview"]>[0] = {}): Promise<OpenCodeHumanControlPreview> {
    return this.opencodeHumanControlService().preview(input)
  }

  async recordOpenCodeHumanControl(input: Parameters<OpenCodeHumanControlService["record"]>[0] = {}): Promise<OpenCodeHumanControlResult> {
    if (input.dry_run === true) return this.opencodeHumanControlService().record(input)
    return this.withOpenCodeLaunchWriteLock(() => this.opencodeHumanControlService().record(input))
  }

  async listOpenCodeHumanControls(input: Parameters<OpenCodeHumanControlService["list"]>[0] = {}): Promise<OpenCodeHumanControlRecord[]> {
    return this.opencodeHumanControlService().list(input)
  }

  async getOpenCodeHumanControl(controlId: string): Promise<OpenCodeHumanControlResult | null> {
    return this.opencodeHumanControlService().get(controlId)
  }

  async latestOpenCodeHumanControl(input: Parameters<OpenCodeHumanControlService["latest"]>[0] = {}): Promise<OpenCodeHumanControlResult | null> {
    return this.opencodeHumanControlService().latest(input)
  }

  async openCodeHumanControlSummary(input: Parameters<OpenCodeHumanControlService["summary"]>[0] = {}): Promise<OpenCodeHumanControlSummary> {
    return this.opencodeHumanControlService().summary(input)
  }

  async previewOpenCodeWakeSupervisor(input: Parameters<OpenCodeWakeSupervisorService["preview"]>[0] = {}): Promise<OpenCodeWakeSupervisorPreview> {
    return this.opencodeWakeSupervisorService().preview(input)
  }

  async openCodeWakeSupervisorSummary(input: Parameters<OpenCodeWakeSupervisorService["summary"]>[0] = {}): Promise<OpenCodeWakeSupervisorSummary> {
    return this.opencodeWakeSupervisorService().summary(input)
  }

  async previewOpenCodeWakeSupervisorExecution(input: Parameters<OpenCodeWakeSupervisorExecutionService["preview"]>[0] = {}): Promise<OpenCodeWakeSupervisorExecutionPreview> {
    return this.opencodeWakeSupervisorExecutionService().preview(input)
  }

  async recordOpenCodeWakeSupervisorExecution(input: Parameters<OpenCodeWakeSupervisorExecutionService["record"]>[0] = {}): Promise<OpenCodeWakeSupervisorExecutionResult> {
    if (input.dry_run === true) return this.opencodeWakeSupervisorExecutionService().record(input)
    return this.withOpenCodeLaunchWriteLock(() => this.opencodeWakeSupervisorExecutionService().record(input))
  }

  async previewOpenCodeWakeSupervisorBatch(input: Parameters<OpenCodeWakeSupervisorExecutionService["batchPreview"]>[0] = {}): Promise<OpenCodeWakeSupervisorBatchPreview> {
    return this.opencodeWakeSupervisorExecutionService().batchPreview(input)
  }

  async recordOpenCodeWakeSupervisorBatch(input: Parameters<OpenCodeWakeSupervisorExecutionService["recordBatch"]>[0] = {}): Promise<OpenCodeWakeSupervisorBatchResult> {
    if (input.dry_run === true) return this.opencodeWakeSupervisorExecutionService().recordBatch(input)
    return this.withOpenCodeLaunchWriteLock(() => this.opencodeWakeSupervisorExecutionService().recordBatch(input))
  }

  async listOpenCodeWakeSupervisorExecutions(input: Parameters<OpenCodeWakeSupervisorExecutionService["list"]>[0] = {}): Promise<OpenCodeWakeSupervisorExecutionRecord[]> {
    return this.opencodeWakeSupervisorExecutionService().list(input)
  }

  async getOpenCodeWakeSupervisorExecution(executionId: string): Promise<OpenCodeWakeSupervisorExecutionResult | null> {
    return this.opencodeWakeSupervisorExecutionService().get(executionId)
  }

  async latestOpenCodeWakeSupervisorExecution(input: Parameters<OpenCodeWakeSupervisorExecutionService["latest"]>[0] = {}): Promise<OpenCodeWakeSupervisorExecutionResult | null> {
    return this.opencodeWakeSupervisorExecutionService().latest(input)
  }

  async openCodeWakeSupervisorExecutionSummary(input: Parameters<OpenCodeWakeSupervisorExecutionService["summary"]>[0] = {}): Promise<OpenCodeWakeSupervisorExecutionSummary> {
    return this.opencodeWakeSupervisorExecutionService().summary(input)
  }

  async previewOpenCodeWakeActionExecution(input: Parameters<OpenCodeWakeActionExecutionService["preview"]>[0] = {}): Promise<OpenCodeWakeActionExecutionPreview> {
    return this.opencodeWakeActionExecutionService().preview(input)
  }

  async recordOpenCodeWakeActionExecution(input: Parameters<OpenCodeWakeActionExecutionService["record"]>[0] = {}): Promise<OpenCodeWakeActionExecutionResult> {
    if (input.dry_run === true) return this.opencodeWakeActionExecutionService().record(input)
    return this.withOpenCodeLaunchWriteLock(() => this.opencodeWakeActionExecutionService().record(input))
  }

  async listOpenCodeWakeActionExecutions(input: Parameters<OpenCodeWakeActionExecutionService["list"]>[0] = {}): Promise<OpenCodeWakeActionExecutionRecord[]> {
    return this.opencodeWakeActionExecutionService().list(input)
  }

  async getOpenCodeWakeActionExecution(actionExecutionId: string): Promise<OpenCodeWakeActionExecutionResult | null> {
    return this.opencodeWakeActionExecutionService().get(actionExecutionId)
  }

  async latestOpenCodeWakeActionExecution(input: Parameters<OpenCodeWakeActionExecutionService["latest"]>[0] = {}): Promise<OpenCodeWakeActionExecutionResult | null> {
    return this.opencodeWakeActionExecutionService().latest(input)
  }

  async openCodeWakeActionExecutionSummary(input: Parameters<OpenCodeWakeActionExecutionService["summary"]>[0] = {}): Promise<OpenCodeWakeActionExecutionSummary> {
    return this.opencodeWakeActionExecutionService().summary(input)
  }

  async previewOpenCodeResultReport(input: Parameters<OpenCodeResultReportService["preview"]>[0] = {}): Promise<OpenCodeResultReportPreview> {
    return this.opencodeResultReportService().preview(input)
  }

  async recordOpenCodeResultReport(input: Parameters<OpenCodeResultReportService["record"]>[0] = {}): Promise<OpenCodeResultReportResult> {
    if (input.dry_run === true) return this.opencodeResultReportService().record(input)
    return this.withOpenCodeLaunchWriteLock(() => this.opencodeResultReportService().record(input))
  }

  async listOpenCodeResultReports(input: Parameters<OpenCodeResultReportService["list"]>[0] = {}): Promise<OpenCodeResultReportRecord[]> {
    return this.opencodeResultReportService().list(input)
  }

  async getOpenCodeResultReport(reportId: string): Promise<OpenCodeResultReportResult | null> {
    return this.opencodeResultReportService().get(reportId)
  }

  async latestOpenCodeResultReport(input: Parameters<OpenCodeResultReportService["latest"]>[0] = {}): Promise<OpenCodeResultReportResult | null> {
    return this.opencodeResultReportService().latest(input)
  }

  async openCodeResultReportSummary(input: Parameters<OpenCodeResultReportService["summary"]>[0] = {}): Promise<OpenCodeResultReportSummary> {
    return this.opencodeResultReportService().summary(input)
  }

  async previewOpenCodeResultReview(input: Parameters<OpenCodeResultReviewService["preview"]>[0] = {}): Promise<OpenCodeResultReviewPreview> {
    return this.opencodeResultReviewService().preview(input)
  }

  async recordOpenCodeResultReview(input: Parameters<OpenCodeResultReviewService["record"]>[0] = {}): Promise<OpenCodeResultReviewResult> {
    if (input.dry_run === true) return this.opencodeResultReviewService().record(input)
    return this.withOpenCodeLaunchWriteLock(() => this.opencodeResultReviewService().record(input))
  }

  async listOpenCodeResultReviews(input: Parameters<OpenCodeResultReviewService["list"]>[0] = {}): Promise<OpenCodeResultReviewRecord[]> {
    return this.opencodeResultReviewService().list(input)
  }

  async getOpenCodeResultReview(reviewId: string): Promise<OpenCodeResultReviewResult | null> {
    return this.opencodeResultReviewService().get(reviewId)
  }

  async latestOpenCodeResultReview(input: Parameters<OpenCodeResultReviewService["latest"]>[0] = {}): Promise<OpenCodeResultReviewResult | null> {
    return this.opencodeResultReviewService().latest(input)
  }

  async openCodeResultReviewGateSummary(input: Parameters<OpenCodeResultReviewService["summary"]>[0] = {}): Promise<OpenCodeResultReviewGateSummary> {
    return this.opencodeResultReviewService().summary(input)
  }

  async previewResearchIngestion(input: Parameters<ResearchIngestionService["preview"]>[0] = {}): Promise<ResearchIngestionPreview> {
    return this.researchIngestionService().preview(input)
  }

  async recordResearchIngestion(input: Parameters<ResearchIngestionService["record"]>[0] = {}): Promise<ResearchIngestionResult> {
    if (input.dry_run === true) return this.researchIngestionService().record(input)
    return this.withOpenCodeLaunchWriteLock(() => this.researchIngestionService().record(input))
  }

  async listResearchIngestions(input: Parameters<ResearchIngestionService["list"]>[0] = {}): Promise<ResearchIngestionRecord[]> {
    return this.researchIngestionService().list(input)
  }

  async getResearchIngestion(ingestionId: string): Promise<ResearchIngestionResult | null> {
    return this.researchIngestionService().get(ingestionId)
  }

  async latestResearchIngestion(input: Parameters<ResearchIngestionService["latest"]>[0] = {}): Promise<ResearchIngestionResult | null> {
    return this.researchIngestionService().latest(input)
  }

  async researchIngestionSummary(input: Parameters<ResearchIngestionService["summary"]>[0] = {}): Promise<ResearchIngestionSummary> {
    return this.researchIngestionService().summary(input)
  }

  researchMemorySummary(): ResearchMemorySummary {
    return this.researchMemoryService().summary()
  }

  previewResearchMemoryRetrieval(input: Parameters<ResearchMemoryService["preview"]>[0] = {}): ResearchMemoryRetrievalPreview {
    return this.researchMemoryService().preview(input)
  }

  getResearchMemoryRecord(input: Parameters<ResearchMemoryService["inspect"]>[0] = {}): ResearchMemoryInspectionPreview {
    return this.researchMemoryService().inspect(input)
  }

  previewResearchMemoryNearDuplicates(input: Parameters<ResearchMemoryService["nearDuplicates"]>[0] = {}): ResearchMemoryNearDuplicatePreview {
    return this.researchMemoryService().nearDuplicates(input)
  }

  researchMemorySearchProfile(): ResearchMemorySearchProfile {
    return this.researchMemoryService().searchProfile()
  }

  commanderToolCatalogSummary(): CommanderToolRegistrySummary {
    return {
      ...this.commanderToolService().summary(),
      github_gateway: this.commanderGithubGatewayStatus(),
    }
  }

  listCommanderTools(input: Parameters<CommanderToolService["list"]>[0] = {}): CommanderToolDescriptorSummary[] {
    return this.commanderToolService().list(input)
  }

  getCommanderTool(input: Parameters<CommanderToolService["get"]>[0] = {}): CommanderToolDescriptor {
    return this.commanderToolService().get(input)
  }

  searchCommanderTools(input: Parameters<CommanderToolService["search"]>[0] = {}): CommanderToolSearchPreview {
    return this.commanderToolService().search(input)
  }

  previewCommanderToolProfile(input: Parameters<CommanderToolService["profile"]>[0] = {}): CommanderToolProfile {
    return this.commanderToolService().profile(input)
  }

  previewCommanderToolBootstrap(input: Parameters<CommanderToolService["bootstrap"]>[0] = {}): Promise<CommanderToolBootstrapPreview> {
    return this.commanderToolService().bootstrap(input)
  }

  validateCommanderToolRegistry(): CommanderToolRegistryValidation {
    return this.commanderToolService().validate()
  }

  searchCommanderOperationalMemory(input: Parameters<CommanderOperationalMemorySearchService["search"]>[0] = {}): Promise<CommanderOperationalMemorySearchPreview> {
    return this.commanderOperationalMemorySearchService().search(input)
  }

  commanderRepoTree(input: Record<string, unknown> = {}): Promise<CommanderInternalReadResult<CommanderRepoTreeResult>> {
    return this.commanderRepoReadService().tree(input)
  }

  commanderRepoSearchText(input: Record<string, unknown> = {}): Promise<CommanderInternalReadResult<CommanderRepoSearchResult>> {
    return this.commanderRepoReadService().searchText(input)
  }

  commanderRepoReadLines(input: Record<string, unknown> = {}): Promise<CommanderInternalReadResult<CommanderRepoFileResult>> {
    return this.commanderRepoReadService().readLines(input)
  }

  commanderRepoFindSymbol(input: Record<string, unknown> = {}): Promise<CommanderInternalReadResult<CommanderRepoSymbolResult>> {
    return this.commanderRepoReadService().findSymbol(input)
  }

  commanderRepoGitStatus(): Promise<CommanderInternalReadResult<CommanderGitStatusResult>> {
    return this.commanderRepoReadService().gitStatus()
  }

  commanderRepoGitDiff(input: Record<string, unknown> = {}): Promise<CommanderInternalReadResult<CommanderGitDiffResult>> {
    return this.commanderRepoReadService().gitDiff(input)
  }

  commanderRepoGitLog(input: Record<string, unknown> = {}): Promise<CommanderInternalReadResult<CommanderGitLogResult>> {
    return this.commanderRepoReadService().gitLog(input)
  }

  commanderRepoTestManifest(input: Record<string, unknown> = {}): Promise<CommanderInternalReadResult<CommanderTestManifestResult>> {
    return this.commanderRepoReadService().testManifest(input)
  }

  commanderRepoDependencyManifest(input: Record<string, unknown> = {}): Promise<CommanderInternalReadResult<CommanderDependencyManifestResult>> {
    return this.commanderRepoReadService().dependencyManifest(input)
  }

  executeCommanderBoundReadTool(input: CommanderToolExecutionRequest): Promise<CommanderToolExecutionResult> {
    const combined = this.commanderInvestigationAbortSignal(input.abort_signal)
    let tracked!: Promise<CommanderToolExecutionResult>
    tracked = this.commanderToolExecutor().execute({ ...input, abort_signal: combined.signal }).finally(() => {
      this.activeCommanderBoundReadTools.delete(tracked)
      combined.cleanup()
    })
    this.activeCommanderBoundReadTools.add(tracked)
    return tracked
  }

  runCommanderInvestigationInMemory(input: CommanderInvestigationInput): Promise<CommanderInvestigationResult> {
    if (this.lifecycleState !== "ready" || this.lifecycleShutdownRequested) return this.commanderInvestigationController().run(input)

    const combined = this.commanderInvestigationAbortSignal(input.abort_signal)
    let tracked!: Promise<CommanderInvestigationResult>
    tracked = this.commanderInvestigationController().run({ ...input, abort_signal: combined.signal }).finally(() => {
      this.activeConfiguredCommanderInvestigations.delete(tracked)
      combined.cleanup()
    })
    this.activeConfiguredCommanderInvestigations.add(tracked)
    return tracked
  }

  async runCommanderInvestigationDurable(input: CommanderInvestigationInput): Promise<CommanderInvestigationResult> {
    if (this.mode !== "active" || !this.started || this.lifecycleState !== "ready" || this.lifecycleShutdownRequested || !this.runLock.isHeld()) {
      const blocked = await this.commanderInvestigationController().run({ ...input, abort_signal: alreadyAbortedSignal("durable Commander investigation requires active ready runtime with run lock") })
      return durableOverrideResult(blocked, {
        ...blocked,
        status: "blocked",
        stop_reason: "provider_preflight_blocked",
        blockers: ["durable Commander investigation requires active ready runtime with run lock"],
      })
    }
    const journal = this.commanderInvestigationJournalService()
    const durableInput = { ...input, investigation_id: input.investigation_id ?? this.generatedCommanderInvestigationId(input) }
    const combined = this.commanderInvestigationAbortSignal(durableInput.abort_signal)
    const active: { promise: Promise<CommanderInvestigationResult>; investigation_id?: string; run?: import("./commander-agent").CommanderInvestigationJournalRun } = { investigation_id: durableInput.investigation_id } as { promise: Promise<CommanderInvestigationResult>; investigation_id?: string; run?: import("./commander-agent").CommanderInvestigationJournalRun }
    let tracked!: Promise<CommanderInvestigationResult>
    tracked = (async () => {
      let run
      try {
        try {
          run = await journal.createObserver(durableInput)
        } catch (error) {
          const blocked = await this.commanderInvestigationController().run({ ...durableInput, abort_signal: alreadyAbortedSignal("durable Commander investigation journal conflict") })
          return durableOverrideResult(blocked, {
            ...blocked,
            status: error instanceof CommanderInvestigationJournalConflictError ? "blocked" : "failed",
            stop_reason: error instanceof CommanderInvestigationJournalConflictError ? "durable_state_conflict" : "persistence_failed",
            blockers: [error instanceof Error ? redactText(error.message) : String(error)].slice(0, 1),
          })
        }
        active.run = run
        if (combined.signal.aborted || this.lifecycleState !== "ready" || this.lifecycleShutdownRequested || !this.runLock.isHeld()) {
          const blocked = await this.commanderInvestigationController().run({ ...durableInput, abort_signal: alreadyAbortedSignal("durable Commander investigation stopped before journal start") })
          return durableOverrideResult(blocked, {
            ...blocked,
            status: "blocked",
            stop_reason: "provider_preflight_blocked",
            blockers: ["durable Commander investigation stopped before journal start"],
          })
        }
        let result: CommanderInvestigationResult
        try {
          result = await this.commanderInvestigationController(run.observer).run({ ...durableInput, abort_signal: combined.signal })
        } catch (error) {
          if (!run.state.started_persisted) throw error
          if (run.state.pending_model_request_id) {
            const uncertain = durableControllerRejectedResult(run.state, error, this.researchSynthesisNow?.() ?? new Date())
            return durablePersistenceFailedResult(uncertain, run.state, error, await commanderInvestigationProjectionAfterFailure(journal, run.investigation_id))
          }
          result = durableControllerRejectedResult(run.state, error, this.researchSynthesisNow?.() ?? new Date())
        }
        if (!run.state.started_persisted) {
          if (result.stop_reason === "persistence_failed") {
            return durablePersistenceFailedResult(result, run.state, result.blockers[0] ?? "Commander investigation durable start was not persisted", await commanderInvestigationProjectionAfterFailure(journal, run.investigation_id))
          }
          return result
        }
        try {
          const durability = await journal.finish(run, result)
          return durableResult(result, durability)
        } catch (error) {
          return durablePersistenceFailedResult(result, run.state, error, await commanderInvestigationProjectionAfterFailure(journal, run.investigation_id))
        }
      } finally {
        if (run) journal.release(run)
        combined.cleanup()
        this.activeDurableCommanderInvestigations.delete(active)
      }
    })()
    active.promise = tracked
    this.activeDurableCommanderInvestigations.add(active)
    return tracked
  }

  getCommanderInvestigationRecord(investigationId: string): Promise<CommanderInvestigationRecord | undefined> {
    return this.commanderInvestigationJournalService().get(investigationId)
  }

  listCommanderInvestigationRecords(options: CommanderInvestigationJournalListOptions = {}): Promise<CommanderInvestigationRecord[]> {
    return this.commanderInvestigationJournalService().list(options)
  }

  getLatestCommanderInvestigationCheckpoint(investigationId: string): Promise<CommanderInvestigationCheckpoint | undefined> {
    return this.commanderInvestigationJournalService().latestCheckpoint(investigationId)
  }

  commanderInvestigationJournalSummary(): Promise<CommanderInvestigationJournalSummary> {
    return this.commanderInvestigationJournalService().summary()
  }

  verifyCommanderInvestigationJournal(investigationId: string): Promise<CommanderInvestigationRecord | undefined> {
    return this.commanderInvestigationJournalService().verify(investigationId)
  }

  getCommanderInvestigationRecoverySource(investigationId: string): Promise<CommanderInvestigationRecoverySource | undefined> {
    return this.commanderInvestigationJournalService().recoverySource(investigationId)
  }

  listCommanderInvestigationRecoveries(input: Parameters<CommanderInvestigationRecoveryOperatorService["list"]>[0] = {}): Promise<CommanderRecoveryOperatorList> {
    return this.commanderInvestigationRecoveryOperatorService().list(input)
  }

  async getCommanderInvestigationRecovery(investigationId: string): Promise<CommanderRecoveryOperatorDetail | CommanderRecoveryOperatorMissing> {
    let detail = await this.commanderInvestigationRecoveryOperatorService().show(investigationId)
    if (!detail.found) return detail
    let active = Array.from(this.publicCommanderRecoveryOperations.values()).find((entry) => entry.record.investigation_id === investigationId)
    if (active?.record.status === "running") {
      await Promise.race([active.promise, new Promise<void>((resolve) => setTimeout(resolve, 50))])
      detail = await this.commanderInvestigationRecoveryOperatorService().show(investigationId)
      if (!detail.found) return detail
      active = Array.from(this.publicCommanderRecoveryOperations.values()).find((entry) => entry.record.investigation_id === investigationId)
    }
    const activeRunning = active?.record.status === "running"
    const matchingActiveAttempt = activeRunning
      && active !== undefined
      && recoveryAttemptMatchesOperation(detail.latest_recovery_attempt, active.record)
    if (detail.projection_status === "ready" && activeRunning && active && (detail.latest_recovery_attempt === undefined || matchingActiveAttempt)) {
      if (matchingActiveAttempt) active.record.recovery_attempt_id = detail.latest_recovery_attempt!.recovery_attempt_id
      detail = {
        ...detail,
        human_review_required: false,
        recommended_next_operator_action: "await_recovery_completion",
      }
    }
    const recent = Array.from(this.recentPublicCommanderRecoveryOperations.values()).reverse().find((record) => record.investigation_id === investigationId)
    const operation = active?.record ?? recent
    return operation ? { ...detail, active_operation: cloneRecoveryOperation(operation) } : detail
  }

  async previewCommanderInvestigationRecoveryPublic(investigationId: string): Promise<CommanderRecoveryOperatorPreview> {
    const preview = await this.commanderInvestigationRecoveryService().preview({ investigation_id: investigationId, include_current_continuity: true })
    return { ...preview, current_continuity_required: true }
  }

  previewCommanderInvestigationRecovery(input: CommanderInvestigationRecoveryPreviewInput): Promise<CommanderInvestigationRecoveryPreview> {
    return this.commanderInvestigationRecoveryService().preview(input)
  }

  previewCommanderInvestigationRecoveryApproval(input: CommanderInvestigationRecoveryApprovalInput): Promise<CommanderInvestigationRecoveryApprovalPreview> {
    return this.commanderInvestigationRecoveryApprovalService().preview(input)
  }

  previewCommanderInvestigationRecoveryExecutionPreparation(input: CommanderInvestigationRecoveryExecutionPreparationInput): Promise<CommanderInvestigationRecoveryExecutionPreparationPreview> {
    return this.commanderInvestigationRecoveryExecutionService().preview(input)
  }

  async recordCommanderInvestigationRecoveryApproval(input: CommanderInvestigationRecoveryApprovalInput): Promise<CommanderInvestigationRecoveryApprovalResult> {
    if (this.mode !== "active" || !this.started || this.lifecycleState !== "ready" || this.lifecycleShutdownRequested || !this.runLock.isHeld() || !this.commanderInvestigationProviderConfig) {
      const preview = await this.commanderInvestigationRecoveryApprovalService().preview(input)
      return commanderRecoveryApprovalBlockedResult(input, preview, "Commander recovery approval write requires active ready runtime with run lock and configured connector provider", this.researchSynthesisNow?.() ?? new Date())
    }
    if (typeof input.investigation_id === "string" && Array.from(this.activeDurableCommanderInvestigations).some((entry) => entry.investigation_id === input.investigation_id || entry.run?.investigation_id === input.investigation_id)) {
      const preview = await this.commanderInvestigationRecoveryApprovalService().preview(input)
      return commanderRecoveryApprovalBlockedResult(input, preview, "Commander recovery approval write requires inactive durable investigation", this.researchSynthesisNow?.() ?? new Date())
    }
    if (typeof input.investigation_id === "string" && this.activeConfiguredCommanderRecoveryInvestigationIds.has(input.investigation_id)) {
      const preview = await this.commanderInvestigationRecoveryApprovalService().preview(input)
      return commanderRecoveryApprovalBlockedResult(input, preview, "Commander recovery approval write is blocked while configured recovery is active for the investigation", this.researchSynthesisNow?.() ?? new Date())
    }
    const investigationId = typeof input.investigation_id === "string" ? input.investigation_id : undefined
    if (investigationId) this.activeCommanderRecoveryApprovalInvestigationIds.set(investigationId, (this.activeCommanderRecoveryApprovalInvestigationIds.get(investigationId) ?? 0) + 1)
    let tracked!: Promise<CommanderInvestigationRecoveryApprovalResult>
    tracked = this.commanderInvestigationRecoveryApprovalService().record(input).finally(() => {
      this.activeCommanderRecoveryApprovalWrites.delete(tracked)
      if (investigationId) {
        const remaining = (this.activeCommanderRecoveryApprovalInvestigationIds.get(investigationId) ?? 1) - 1
        if (remaining > 0) this.activeCommanderRecoveryApprovalInvestigationIds.set(investigationId, remaining)
        else this.activeCommanderRecoveryApprovalInvestigationIds.delete(investigationId)
      }
    })
    this.activeCommanderRecoveryApprovalWrites.add(tracked)
    return tracked
  }

  startCommanderInvestigationRecoveryOperation(input: CommanderInvestigationRecoveryTransactionInput): CommanderRecoveryOperation {
    const validated = normalizeCommanderInvestigationRecoveryTransactionInput(input)
    if (validated.blockers.length > 0) throw new Error(validated.blockers.join("; "))
    input = validated.input
    if (this.lifecycleShutdownRequested || this.lifecycleState === "stopping") {
      throw new Error("Commander recovery operation cannot start while RuntimeServer shutdown is in progress")
    }
    const existing = Array.from(this.publicCommanderRecoveryOperations.values()).find((entry) => entry.record.investigation_id === input.investigation_id && entry.record.status === "running")
    if (existing) {
      if (sameRecoveryAuthority(existing.record, input)) return cloneRecoveryOperation(existing.record)
      return {
        ...cloneRecoveryOperation(existing.record),
        request_rejected: true,
        error: "a different Commander recovery operation is already active for this investigation",
      }
    }
    const settled = Array.from(this.recentPublicCommanderRecoveryOperations.values()).find((record) => record.investigation_id === input.investigation_id)
    let settledRequiringAuthoritativeRecheck: CommanderRecoveryOperation | undefined
    if (settled) {
      if (this.replaceablePublicCommanderRecoveryOperationIds.has(settled.operation_id)) {
        this.recentPublicCommanderRecoveryOperations.delete(settled.operation_id)
        this.replaceablePublicCommanderRecoveryOperationIds.delete(settled.operation_id)
      } else if ((settled.status === "blocked" || settled.status === "failed") && settled.recovery_attempt_id === undefined) {
        settledRequiringAuthoritativeRecheck = settled
      } else {
        if (sameRecoveryAuthority(settled, input)) return cloneRecoveryOperation(settled)
        return {
          ...cloneRecoveryOperation(settled),
          request_rejected: true,
          error: "a recovery attempt already exists for this investigation and different authority cannot start another",
        }
      }
    }
    const operationId = `commander_recovery_operation_${randomUUID().replaceAll("-", "").slice(0, 24)}`
    const startedAt = (this.researchSynthesisNow?.() ?? new Date()).toISOString()
    const record: CommanderRecoveryOperation = {
      operation_id: operationId,
      operation_version: 1,
      investigation_id: input.investigation_id,
      approval_id: input.approval_id,
      approval_hash: input.approval_hash,
      recovery_plan_hash: input.recovery_plan_hash,
      execution_preparation_hash: input.execution_preparation_hash,
      status: "running",
      cancellation_requested: false,
      started_at: startedAt,
    }
    const controller = new AbortController()
    const combined = this.commanderInvestigationAbortSignal(controller.signal)
    const entry = { record, controller, promise: Promise.resolve() }
    this.publicCommanderRecoveryOperations.set(operationId, entry)
    entry.promise = (async () => {
      if (settledRequiringAuthoritativeRecheck) {
        const source = await this.commanderInvestigationJournalService().recoverySource(input.investigation_id)
        if (combined.signal.aborted) {
          throw new Error("Commander recovery operation cancelled during replacement authority recheck")
        }
        if (!recoveryOperationMayBeReplaced(source)) {
          throw new Error("a recovery attempt already exists for this investigation and different authority cannot start another")
        }
        this.recentPublicCommanderRecoveryOperations.delete(settledRequiringAuthoritativeRecheck.operation_id)
        this.replaceablePublicCommanderRecoveryOperationIds.delete(settledRequiringAuthoritativeRecheck.operation_id)
      }
      if (combined.signal.aborted) {
        throw new Error("Commander recovery operation cancelled before configured recovery")
      }
      return this.runCommanderInvestigationRecoveryConfigured(input, {
        abort_signal: combined.signal,
        on_recovery_attempt_prepared: (recoveryAttemptId) => {
          record.recovery_attempt_id = recoveryAttemptId
        },
      })
    })()
      .then(async (result) => {
        if (result.recovery_attempt_id && record.recovery_attempt_id !== result.recovery_attempt_id) {
          try {
            const source = await this.commanderInvestigationJournalService().recoverySource(input.investigation_id)
            const matchingAttempt = recoveryAttemptForOperation(source, record)
            if (matchingAttempt?.recovery_attempt_id === result.recovery_attempt_id) {
              record.recovery_attempt_id = result.recovery_attempt_id
            }
          } catch {
            // Result metadata cannot establish attempt ownership without matching journal authority.
          }
        }
        if (!result.approval_consumed && !result.recovery_attempt_id) {
          try {
            const source = await this.commanderInvestigationJournalService().recoverySource(input.investigation_id)
            if (recoveryOperationMayBeReplaced(source)) {
              this.replaceablePublicCommanderRecoveryOperationIds.add(record.operation_id)
            }
          } catch {
            // Replacement requires an authoritative reread proving that recovery never started.
          }
        }
        record.status = result.status === "already_started"
          ? "already_started"
          : result.status === "completed"
            ? "completed"
          : result.status === "blocked"
            ? "blocked"
            : "failed"
        if (record.status === "blocked" || record.status === "failed") {
          const explanation = [...result.blockers, ...result.warnings]
            .find((item) => typeof item === "string" && item.trim().length > 0)
          if (explanation) record.error = redactText(explanation).slice(0, 300)
        }
      })
      .catch(async (error) => {
        record.status = "failed"
        record.error = redactText(error instanceof Error ? error.message : String(error)).slice(0, 300)
        try {
          const source = await this.commanderInvestigationJournalService().recoverySource(input.investigation_id)
          const durableAttemptId = recoveryAttemptForOperation(source, record)?.recovery_attempt_id
          if (durableAttemptId) record.recovery_attempt_id = durableAttemptId
          else delete record.recovery_attempt_id
          if (recoveryOperationMayBeReplaced(source)) {
            this.replaceablePublicCommanderRecoveryOperationIds.add(record.operation_id)
          }
        } catch {
          // A failed authoritative reread cannot prove that the operation stopped before recovery start.
        }
      })
      .finally(() => {
        combined.cleanup()
        record.settled_at = (this.researchSynthesisNow?.() ?? new Date()).toISOString()
        this.publicCommanderRecoveryOperations.delete(operationId)
        this.recentPublicCommanderRecoveryOperations.set(operationId, cloneRecoveryOperation(record))
        while (this.recentPublicCommanderRecoveryOperations.size > 32) {
          const oldest = this.recentPublicCommanderRecoveryOperations.keys().next().value
          if (typeof oldest !== "string") break
          this.recentPublicCommanderRecoveryOperations.delete(oldest)
          this.replaceablePublicCommanderRecoveryOperationIds.delete(oldest)
        }
      })
    return cloneRecoveryOperation(record)
  }

  async cancelCommanderInvestigationRecoveryOperation(input: CommanderRecoveryCancelInput): Promise<CommanderRecoveryCancellationResult> {
    const generatedAt = (this.researchSynthesisNow?.() ?? new Date()).toISOString()
    const entry = this.publicCommanderRecoveryOperations.get(input.operation_id)
    if (!entry || entry.record.status !== "running") {
      const recent = this.recentPublicCommanderRecoveryOperations.get(input.operation_id)
      if (recent && (recent.investigation_id !== input.investigation_id || recent.approval_id !== input.approval_id || (recent.recovery_attempt_id !== undefined && recent.recovery_attempt_id !== input.recovery_attempt_id))) {
        return recoveryCancellationResult(input, "operation_identity_mismatch", recent.cancellation_requested, generatedAt, recent.recovery_attempt_id)
      }
      if (recent?.cancellation_requested) return recoveryCancellationResult(input, "already_requested", true, generatedAt, recent.recovery_attempt_id)
      return recoveryCancellationResult(input, "not_active", false, generatedAt, recent?.recovery_attempt_id)
    }
    if (entry.record.investigation_id !== input.investigation_id || entry.record.approval_id !== input.approval_id) {
      return recoveryCancellationResult(input, "operation_identity_mismatch", entry.record.cancellation_requested, generatedAt)
    }
    let attemptId = entry.record.recovery_attempt_id
    if (attemptId && input.recovery_attempt_id !== attemptId) {
      return recoveryCancellationResult(input, "operation_identity_mismatch", entry.record.cancellation_requested, generatedAt, attemptId)
    }
    if (!attemptId) {
      try {
        const source = await this.commanderInvestigationJournalService().recoverySource(input.investigation_id)
        attemptId = recoveryAttemptForOperation(source, entry.record)?.recovery_attempt_id
          ?? entry.record.recovery_attempt_id
      } catch {
        // The exact in-memory pre-start operation remains cancellable when journal reconciliation is unavailable.
      }
    }
    if (attemptId) entry.record.recovery_attempt_id = attemptId
    if (attemptId && input.recovery_attempt_id !== attemptId) {
      return recoveryCancellationResult(input, "operation_identity_mismatch", entry.record.cancellation_requested, generatedAt, attemptId)
    }
    if (!this.publicCommanderRecoveryOperations.has(input.operation_id) || entry.record.status !== "running") {
      if (entry.record.cancellation_requested) {
        return recoveryCancellationResult(input, "already_requested", true, generatedAt, attemptId)
      }
      return recoveryCancellationResult(input, "not_active", entry.record.cancellation_requested, generatedAt, attemptId)
    }
    if (entry.record.cancellation_requested) return recoveryCancellationResult(input, "already_requested", true, generatedAt, entry.record.recovery_attempt_id)
    entry.record.cancellation_requested = true
    entry.controller.abort(new Error("operator requested Commander recovery cancellation"))
    return recoveryCancellationResult(input, "cancellation_requested", true, generatedAt, entry.record.recovery_attempt_id)
  }

  async runCommanderInvestigationRecoveryConfigured(
    input: CommanderInvestigationRecoveryTransactionInput,
    operational: {
      abort_signal?: AbortSignal
      on_recovery_attempt_prepared?(recoveryAttemptId: string): void
    } = {},
  ): Promise<CommanderInvestigationRecoveryTransactionResult> {
    const now = this.researchSynthesisNow?.() ?? new Date()
    if (!this.configuredCommanderRecoveryRuntimeAuthorityReady()) {
      return commanderRecoveryTransactionBlockedResult(input, "configured Commander recovery requires active ready RuntimeServer authority, run lock, and connector-backed provider", now)
    }
    if (this.activeCommanderRecoveryApprovalInvestigationIds.has(input.investigation_id)) {
      return commanderRecoveryTransactionBlockedResult(input, "configured Commander recovery is blocked while an approval write is active for the investigation", now)
    }
    if (Array.from(this.activeDurableCommanderInvestigations).some((entry) => entry.investigation_id === input.investigation_id || entry.run?.investigation_id === input.investigation_id)) {
      return commanderRecoveryTransactionBlockedResult(input, "configured Commander recovery requires an inactive durable investigation", now)
    }
    this.activeConfiguredCommanderRecoveryInvestigationIds.set(input.investigation_id, (this.activeConfiguredCommanderRecoveryInvestigationIds.get(input.investigation_id) ?? 0) + 1)
    const combined = this.commanderInvestigationAbortSignal(operational.abort_signal)
    const active = { investigation_id: input.investigation_id } as {
      promise: Promise<unknown>
      investigation_id: string
      run?: import("./commander-agent").CommanderInvestigationJournalRun
    }
    const tracked = (async (): Promise<CommanderInvestigationRecoveryTransactionResult> => {
      try {
        const source = await this.commanderInvestigationJournalService().recoverySource(input.investigation_id)
        const identity = source?.immutable_identity
        if (!identity) return commanderRecoveryTransactionBlockedResult(input, "configured Commander recovery requires authoritative journal identity", now)
        const readiness = this.previewCommanderInvestigationProviderReadiness({
          phase: identity.phase,
          provider_id: identity.provider_id,
          provider_kind: identity.provider_kind,
          model_id: identity.model_id,
        })
        if (!readiness.execution_ready) {
          return commanderRecoveryTransactionBlockedResult(input, `configured Commander recovery provider is not execution-ready: ${readiness.blockers.join("; ").slice(0, 240)}`, now)
        }
        if (!this.configuredCommanderRecoveryRuntimeAuthorityReady()) {
          return commanderRecoveryTransactionBlockedResult(input, "configured Commander recovery authority changed during preflight", this.researchSynthesisNow?.() ?? new Date())
        }
        return await this.commanderInvestigationRecoveryTransactionService().run(input, {
          abort_signal: combined.signal,
          on_recovery_attempt_prepared: operational.on_recovery_attempt_prepared,
        })
      } finally {
        combined.cleanup()
        this.activeConfiguredCommanderRecoveries.delete(active)
        const remaining = (this.activeConfiguredCommanderRecoveryInvestigationIds.get(input.investigation_id) ?? 1) - 1
        if (remaining > 0) this.activeConfiguredCommanderRecoveryInvestigationIds.set(input.investigation_id, remaining)
        else this.activeConfiguredCommanderRecoveryInvestigationIds.delete(input.investigation_id)
      }
    })()
    active.promise = tracked
    this.activeConfiguredCommanderRecoveries.add(active)
    return tracked
  }

  private configuredCommanderRecoveryRuntimeAuthorityReady(): boolean {
    return (
      this.mode === "active" &&
      this.started &&
      this.lifecycleState === "ready" &&
      !this.lifecycleShutdownRequested &&
      this.runLock.isHeld() &&
      this.commanderInvestigationProviderConfig !== undefined &&
      this.commanderModelStepAdapter?.adapter_id === "external_api_connector_ai_sdk_core"
    )
  }

  private commanderInvestigationAbortSignal(callerSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
    const controller = new AbortController()
    const runtimeSignal = this.commanderInvestigationLifecycleAbort.signal
    const abortFrom = (signal: AbortSignal, fallback: string) => {
      if (controller.signal.aborted) return
      const reason = signal.reason instanceof Error ? signal.reason : new Error(fallback)
      controller.abort(reason)
    }
    const onRuntimeAbort = () => abortFrom(runtimeSignal, "RuntimeServer shutdown cancelled Commander investigation")
    const onCallerAbort = () => callerSignal ? abortFrom(callerSignal, "caller cancelled Commander investigation") : undefined
    runtimeSignal.addEventListener("abort", onRuntimeAbort, { once: true })
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true })
    if (runtimeSignal.aborted) onRuntimeAbort()
    else if (callerSignal?.aborted) onCallerAbort()
    return {
      signal: controller.signal,
      cleanup: () => {
        runtimeSignal.removeEventListener("abort", onRuntimeAbort)
        callerSignal?.removeEventListener("abort", onCallerAbort)
      },
    }
  }

  private generatedCommanderInvestigationId(input: CommanderInvestigationInput): string {
    return `commander_investigation_${stableHash({ input: { ...input, abort_signal: undefined }, generated_at: (this.researchSynthesisNow?.() ?? new Date()).toISOString(), nonce: randomUUID() }).slice(0, 16)}`
  }

  private async drainConfiguredCommanderInvestigations(): Promise<void> {
    const activeDurable = Array.from(this.activeDurableCommanderInvestigations)
    const activeRecoveries = Array.from(this.activeConfiguredCommanderRecoveries)
    const publicRecoveries = Array.from(this.publicCommanderRecoveryOperations.values())
    const pending = [...Array.from(this.activeConfiguredCommanderInvestigations), ...Array.from(this.activeCommanderBoundReadTools), ...activeDurable.map((entry) => entry.promise), ...activeRecoveries.map((entry) => entry.promise), ...publicRecoveries.map((entry) => entry.promise), ...Array.from(this.activeCommanderRecoveryApprovalWrites)]
    if (pending.length === 0) return
    const ownedExternalTimeoutMs = Math.max(this.commanderInvestigationProviderConfig?.timeout_ms ?? 0, this.commanderGithubGatewayConfig?.timeout_ms ?? 0)
    const timeoutMs = ownedExternalTimeoutMs > 0 ? Math.max(100, Math.min(ownedExternalTimeoutMs + 1000, 121_000)) : 1000
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const timedOut = Symbol("commander-provider-drain-timeout")
    const result = await Promise.race([
      Promise.allSettled(pending).then(() => undefined),
      new Promise<typeof timedOut>((resolve) => {
        timeoutId = setTimeout(() => resolve(timedOut), timeoutMs)
      }),
    ])
    if (timeoutId) clearTimeout(timeoutId)
    if (result === timedOut) {
      const journal = this.commanderInvestigationJournalService()
      for (const entry of activeDurable) {
        if (this.activeDurableCommanderInvestigations.has(entry) && entry.run) {
          journal.fence(entry.run, "RuntimeServer shutdown drain timed out before durable investigation settled")
        }
      }
      for (const entry of activeRecoveries) {
        if (this.activeConfiguredCommanderRecoveries.has(entry) && entry.run) {
          journal.fence(entry.run, "RuntimeServer shutdown drain timed out before configured recovery settled")
        }
      }
      const inFlightPersistence = [...activeDurable, ...activeRecoveries]
        .filter((entry) => entry.run && journal.inFlightPersistenceCount(entry.run) > 0)
        .map((entry) => journal.settleInFlightPersistence(entry.run!))
      if (inFlightPersistence.length > 0) {
        const persistenceSettled = Symbol("commander-journal-persistence-settled")
        const persistenceTimedOut = Symbol("commander-journal-persistence-timeout")
        const persistenceResult = await Promise.race([
          Promise.allSettled(inFlightPersistence).then(() => persistenceSettled),
          new Promise<typeof persistenceTimedOut>((resolve) => setTimeout(() => resolve(persistenceTimedOut), 1000)),
        ])
        if (persistenceResult === persistenceTimedOut) {
          throw new Error("Commander durable investigation persistence did not settle before shutdown; run lock retained")
        }
      }
      this.eventBus.emit({
        type: "ExecutorLifecycle",
        phase: "runtime_commander_investigation_drain_timeout",
        message: "Commander investigations did not settle before the shutdown drain timeout",
      })
      throw new Error("Commander investigations did not settle before shutdown; run lock retained")
    }
  }

  previewCommanderInvestigationProviderReadiness(input: CommanderInvestigationProviderReadinessInput = {}): CommanderInvestigationProviderReadiness {
    const generatedAt = (this.researchSynthesisNow?.() ?? new Date()).toISOString()
    const checks: CommanderInvestigationProviderReadinessCheck[] = []
    const warnings: string[] = []
    const blockers: string[] = []
    const push = (name: string, ok: boolean, severity: CommanderInvestigationProviderReadinessCheck["severity"], summary: string, redactedDetail?: string) => {
      checks.push({ name, ok, severity, summary, redacted_detail: redactedDetail ? redactText(redactedDetail).slice(0, 240) : undefined })
      if (!ok && severity === "error") blockers.push(summary)
      if (!ok && severity === "warning") warnings.push(summary)
    }
    if (!this.commanderInvestigationProviderConfig && !this.commanderModelStepAdapter) {
      const readiness = providerReadinessResult({
        status: "disabled",
        configurationReady: false,
        executionReady: false,
        providerSource: "none",
        runtimeMode: this.mode,
        runtimeLifecycleState: this.lifecycleState,
        runtimeStarted: this.started,
        runLockRequired: false,
        runLockHeld: this.runLock.isHeld(),
        supportsStreaming: false,
        checks,
        blockers: ["Commander investigation provider is not configured"],
        warnings,
        generatedAt,
        defaultToolProtocol: "unavailable",
      })
      return readiness
    }
    if (!this.commanderInvestigationProviderConfig) {
      warnings.push("Commander model adapter is injected for internal/test use; connector audit authority is not active")
      return providerReadinessResult({
        status: this.commanderModelStepAdapter ? "ready" : "disabled",
        configurationReady: Boolean(this.commanderModelStepAdapter),
        executionReady: Boolean(this.commanderModelStepAdapter),
        providerSource: "injected_adapter",
        runtimeMode: this.mode,
        runtimeLifecycleState: this.lifecycleState,
        runtimeStarted: this.started,
        runLockRequired: false,
        runLockHeld: this.runLock.isHeld(),
        adapterId: this.commanderModelStepAdapter?.adapter_id,
        supportsStreaming: this.commanderModelStepAdapter?.supports_streaming === true,
        checks,
        blockers,
        warnings,
        generatedAt,
        defaultToolProtocol: "unavailable",
      })
    }
    const config = this.commanderInvestigationProviderConfig
    const connector = this.externalApiConnectorRegistry.get(config.connector_id)
    const capability = this.modelCapabilityRegistry.get({ provider_kind: config.provider_kind, model_id: config.model_id, role: "commander" })
    push("config_valid", true, "info", "Commander investigation provider config is valid")
    push("provider_id_match", input.provider_id === undefined || input.provider_id === config.provider_id, "error", "requested provider_id matches configured provider")
    push("provider_kind_match", input.provider_kind === undefined || input.provider_kind === config.provider_kind, "error", "requested provider_kind matches configured provider")
    push("model_id_match", input.model_id === undefined || input.model_id === config.model_id, "error", "requested model_id matches configured model")
    push("phase_enabled", !input.phase || config.enabled_phases.includes(input.phase), "error", "requested phase is enabled for configured provider")
    push("connector_exists", Boolean(connector), "error", "configured external API connector exists")
    if (connector) {
      try {
        validateCommanderConnectorProtocolPolicy(config, connector)
        const requestUrl = connectorModelRequestUrl(connector, config.transport_kind)
        push("provider_request_policy", true, "info", `exact ${config.transport_kind} request policy is valid`)
        push("provider_request_url", true, "info", `exact ${requestUrl.pathname} provider URL can be derived`)
      } catch (error) {
        push("provider_request_policy", false, "error", "exact provider request policy is invalid", error instanceof Error ? error.message : String(error))
      }
      push("connector_allows_post", connector.allowed_methods.includes("POST"), "error", "connector permits POST")
      push("timeout_within_connector", config.timeout_ms <= connector.timeout_ms, "error", "provider timeout is within connector timeout")
      push("response_cap_within_connector", config.max_response_bytes <= connector.max_response_bytes, "error", "provider response cap is within connector response cap")
      push("credential_refs_present", (connector.credential_refs ?? []).length > 0, "error", "connector has credential references")
      const missingCredentials = (connector.credential_refs ?? []).filter((ref) => !this.externalApiEnv[ref.env_name])
      push("credential_values_present", missingCredentials.length === 0, "error", "connector credential values are present")
      try {
        const preview = this.externalApiRequestService().preview({ connector_id: config.connector_id, method: "POST", path: connectorModelRequestUrl(connector, config.transport_kind).pathname, headers: { "Content-Type": "application/json" }, body: "{}", dry_run: true, requested_by: "commander_provider_readiness" })
        push("external_api_preview", preview.allowed, "error", "ExternalApiRequestService preview allows exact request", preview.blockers.join("; "))
      } catch (error) {
        push("external_api_preview", false, "error", "ExternalApiRequestService preview failed", error instanceof Error ? error.message : String(error))
      }
    }
    push("capability_exists", capability.source === "runtime_config", "error", "runtime-config Commander model capability exists")
    push("capability_commander_role", capability.role_support.includes("commander"), "error", "configured capability supports Commander role")
    push("context_limits_coherent", config.max_context_bytes <= config.max_request_bytes && (!config.max_context_tokens || config.max_context_tokens > 0), "error", "configured context and request limits are coherent")
    push("adapter_nonstreaming", this.commanderModelStepAdapter?.adapter_id === "external_api_connector_ai_sdk_core" && this.commanderModelStepAdapter.supports_streaming === false, "error", "configured adapter is connector-backed and nonstreaming")
    const configurationReady = checks.filter((check) => check.severity === "error").every((check) => check.ok)
    push("runtime_active_mode", this.mode === "active", "error", "RuntimeServer mode is active")
    push("runtime_started", this.started, "error", "RuntimeServer is started")
    push("runtime_lifecycle_ready", this.lifecycleState === "ready", "error", "RuntimeServer lifecycle is ready")
    push("runtime_not_stopping", !this.lifecycleShutdownRequested, "error", "RuntimeServer shutdown is not requested")
    push("run_lock_held", this.runLock.isHeld(), "error", "RuntimeServer run lock is held")
    const executionReady = configurationReady && this.mode === "active" && this.started && this.lifecycleState === "ready" && !this.lifecycleShutdownRequested && this.runLock.isHeld()
    return providerReadinessResult({
      status: executionReady ? "ready" : "blocked",
      configurationReady,
      executionReady,
      providerSource: "configured_connector",
      providerId: config.provider_id,
      providerKind: config.provider_kind,
      connectorId: config.connector_id,
      modelId: config.model_id,
      enabledPhases: config.enabled_phases,
      capabilityId: capability.capability_id,
      runtimeMode: this.mode,
      runtimeLifecycleState: this.lifecycleState,
      runtimeStarted: this.started,
      runLockRequired: true,
      runLockHeld: this.runLock.isHeld(),
      adapterId: this.commanderModelStepAdapter?.adapter_id,
      supportsStreaming: false,
      checks,
      blockers,
      warnings,
      generatedAt,
      defaultToolProtocol: config.supports_tools === true ? "native" : "json_fallback",
      wouldCallNetwork: true,
      wouldAppendExternalApiAudit: true,
    })
  }

  previewCommanderProposalContinuity(input: Parameters<CommanderContinuityService["proposal"]>[0] = {}): Promise<CommanderProposalContinuityPacket> {
    return this.commanderContinuityService().proposal(input)
  }

  previewCommanderMidMissionContinuity(input: Parameters<CommanderContinuityService["midMission"]>[0] = {}): Promise<CommanderMidMissionContinuityPacket> {
    return this.commanderContinuityService().midMission(input)
  }

  commanderContinuitySummary(input: Parameters<CommanderContinuityService["summary"]>[0] = {}): Promise<CommanderContinuitySummary> {
    return this.commanderContinuityService().summary(input)
  }

  listCommanderContinuityOpenLoops(input: Parameters<CommanderContinuityService["openLoops"]>[0] = {}): Promise<CommanderContinuityOpenLoop[]> {
    return this.commanderContinuityService().openLoops(input)
  }

  showCommanderContinuityThread(input: Parameters<CommanderContinuityService["thread"]>[0] = {}): Promise<CommanderContinuityThreadCard | null> {
    return this.commanderContinuityService().thread(input)
  }

  previewOpenCodeSessionContinuity(input: Parameters<OpenCodeSessionContinuityService["session"]>[0] = {}): Promise<OpenCodeSessionContinuityPacket> {
    return this.opencodeSessionContinuityService().session(input)
  }

  previewOpenCodeContinuation(input: Parameters<OpenCodeSessionContinuityService["continuation"]>[0] = {}): Promise<OpenCodeContinuationPacket> {
    return this.opencodeSessionContinuityService().continuation(input)
  }

  previewOpenCodeContextRefresh(input: Parameters<OpenCodeContextRefreshService["preview"]>[0] = {}): Promise<OpenCodeContextRefreshPreview> {
    return this.opencodeContextRefreshService().preview(input)
  }

  async writeOpenCodeContextRefresh(input: Parameters<OpenCodeContextRefreshService["write"]>[0] = {}): Promise<OpenCodeContextRefreshResult> {
    if (input.dry_run === true) return this.opencodeContextRefreshService().write(input)
    return this.withOpenCodeLaunchWriteLock(() => this.opencodeContextRefreshService().write(input))
  }

  listOpenCodeContextRefreshes(input: Parameters<OpenCodeContextRefreshService["list"]>[0] = {}): Promise<OpenCodeContextRefreshRecord[]> {
    return this.opencodeContextRefreshService().list(input)
  }

  getOpenCodeContextRefresh(refreshId: string): Promise<OpenCodeContextRefreshResult | null> {
    return this.opencodeContextRefreshService().get(refreshId)
  }

  latestOpenCodeContextRefresh(input: Parameters<OpenCodeContextRefreshService["latest"]>[0] = {}): Promise<OpenCodeContextRefreshResult | null> {
    return this.opencodeContextRefreshService().latest(input)
  }

  openCodeContextRefreshSummary(input: Parameters<OpenCodeContextRefreshService["summary"]>[0] = {}): Promise<OpenCodeContextRefreshSummary> {
    return this.opencodeContextRefreshService().summary(input)
  }

  previewResearchNoveltyCheck(input: Parameters<ResearchNoveltyService["preview"]>[0] = {}): ResearchNoveltyPreview {
    return this.researchNoveltyService().preview(input)
  }

  async previewCommanderExecutorReview(input: Parameters<CommanderExecutorReviewService["preview"]>[0] = {}): Promise<CommanderExecutorReviewPreview> {
    return this.commanderExecutorReviewService().preview(input)
  }

  async executeCommanderExecutorReview(input: Parameters<CommanderExecutorReviewService["execute"]>[0] = {}): Promise<CommanderExecutorReviewResult> {
    if (input.dry_run !== true) this.requireCommanderExecutorReviewRuntime("runtime.execute_commander_executor_review")
    return this.commanderExecutorReviewService().execute(input)
  }

  async listCommanderExecutorReviews(input: Parameters<CommanderExecutorReviewService["list"]>[0] = {}): Promise<CommanderExecutorReviewRecord[]> {
    return this.commanderExecutorReviewService().list(input)
  }

  async getCommanderExecutorReview(reviewId: string): Promise<CommanderExecutorReviewResult | null> {
    return this.commanderExecutorReviewService().get(reviewId)
  }

  async previewExecutorReviewProposalDrafts(input: Parameters<ExecutorReviewProposalDraftService["preview"]>[0] = {}): Promise<ExecutorReviewProposalDraftPreview> {
    return this.executorReviewProposalDraftService().preview(input)
  }

  async executorReviewProposalDraftSummary(input: Parameters<ExecutorReviewProposalDraftService["summary"]>[0] = {}): Promise<ExecutorReviewProposalDraftSummary> {
    return this.executorReviewProposalDraftService().summary(input)
  }

  async previewExecutorReviewProposalCreate(input: Parameters<ExecutorReviewProposalCreateService["preview"]>[0]): Promise<ExecutorReviewProposalCreatePreview> {
    return this.executorReviewProposalCreateService().preview(input)
  }

  async createExecutorReviewProposal(input: Parameters<ExecutorReviewProposalCreateService["create"]>[0]): Promise<ExecutorReviewProposalCreateResult> {
    if (input.dry_run !== true) this.requireProposalWriteRuntime("runtime.create_executor_review_proposal")
    return this.executorReviewProposalCreateService().create(input)
  }

  async listExecutorReviewProposalCreates(input: Parameters<ExecutorReviewProposalCreateService["list"]>[0] = {}): Promise<ExecutorReviewProposalCreateRecord[]> {
    return this.executorReviewProposalCreateService().list(input)
  }

  async getExecutorReviewProposalCreate(createId: string): Promise<ExecutorReviewProposalCreateResult | null> {
    return this.executorReviewProposalCreateService().get(createId)
  }

  async previewExecutorReviewProposalReviewRequest(input: Parameters<ExecutorReviewProposalReviewRequestService["preview"]>[0]): Promise<ExecutorReviewProposalReviewRequestPreview> {
    return this.executorReviewProposalReviewRequestService().preview(input)
  }

  async requestExecutorReviewProposalReview(input: Parameters<ExecutorReviewProposalReviewRequestService["request"]>[0]): Promise<ExecutorReviewProposalReviewRequestResult> {
    if (input.dry_run !== true) this.requireProposalWriteRuntime("runtime.request_executor_review_proposal_review")
    return this.executorReviewProposalReviewRequestService().request(input)
  }

  async listExecutorReviewProposalReviewRequests(input: Parameters<ExecutorReviewProposalReviewRequestService["list"]>[0] = {}): Promise<ExecutorReviewProposalReviewRequestRecord[]> {
    return this.executorReviewProposalReviewRequestService().list(input)
  }

  async getExecutorReviewProposalReviewRequest(requestGateId: string): Promise<ExecutorReviewProposalReviewRequestResult | null> {
    return this.executorReviewProposalReviewRequestService().get(requestGateId)
  }

  async previewExecutorReviewProposalReviewDecision(input: Parameters<ExecutorReviewProposalReviewDecisionService["preview"]>[0]): Promise<ExecutorReviewProposalReviewDecisionPreview> {
    return this.executorReviewProposalReviewDecisionService().preview(input)
  }

  async decideExecutorReviewProposalReview(input: Parameters<ExecutorReviewProposalReviewDecisionService["decide"]>[0]): Promise<ExecutorReviewProposalReviewDecisionResult> {
    if (input.dry_run !== true) this.requireReviewWriteRuntime("runtime.decide_executor_review_proposal_review")
    return this.executorReviewProposalReviewDecisionService().decide(input)
  }

  async listExecutorReviewProposalReviewDecisions(input: Parameters<ExecutorReviewProposalReviewDecisionService["list"]>[0] = {}): Promise<ExecutorReviewProposalReviewDecisionRecord[]> {
    return this.executorReviewProposalReviewDecisionService().list(input)
  }

  async getExecutorReviewProposalReviewDecision(decisionGateId: string): Promise<ExecutorReviewProposalReviewDecisionResult | null> {
    return this.executorReviewProposalReviewDecisionService().get(decisionGateId)
  }

  async previewExecutorReviewProposalApplyReadiness(input: Parameters<ExecutorReviewProposalApplyReadinessService["preview"]>[0]): Promise<ExecutorReviewProposalApplyReadinessPreview> {
    return this.executorReviewProposalApplyReadinessService().preview(input)
  }

  async executorReviewProposalApplyReadinessSummary(input: Parameters<ExecutorReviewProposalApplyReadinessService["summary"]>[0] = {}): Promise<ExecutorReviewProposalApplyReadinessSummary> {
    return this.executorReviewProposalApplyReadinessService().summary(input)
  }

  async listExecutorReviewProposalApplyReadiness(input: Parameters<ExecutorReviewProposalApplyReadinessService["list"]>[0] = {}): Promise<ExecutorReviewProposalApplyReadinessRecord[]> {
    return this.executorReviewProposalApplyReadinessService().list(input)
  }

  async getExecutorReviewProposalApplyReadiness(readinessId: string): Promise<ExecutorReviewProposalApplyReadinessPreview | null> {
    return this.executorReviewProposalApplyReadinessService().get(readinessId)
  }

  async previewExecutorReviewProposalNarrowApply(input: Parameters<ExecutorReviewProposalNarrowApplyService["preview"]>[0]): Promise<ExecutorReviewProposalNarrowApplyPreview> {
    return this.executorReviewProposalNarrowApplyService().preview(input)
  }

  async applyExecutorReviewProposalNarrow(input: Parameters<ExecutorReviewProposalNarrowApplyService["apply"]>[0]): Promise<ExecutorReviewProposalNarrowApplyResult> {
    if (input.dry_run !== true) this.requireProposalWriteRuntime("runtime.apply_executor_review_proposal_narrow")
    return this.executorReviewProposalNarrowApplyService().apply(input)
  }

  async listExecutorReviewProposalNarrowApplies(input: Parameters<ExecutorReviewProposalNarrowApplyService["list"]>[0] = {}): Promise<ExecutorReviewProposalNarrowApplyRecord[]> {
    return this.executorReviewProposalNarrowApplyService().list(input)
  }

  async getExecutorReviewProposalNarrowApply(applyId: string): Promise<ExecutorReviewProposalNarrowApplyResult | null> {
    return this.executorReviewProposalNarrowApplyService().get(applyId)
  }

  async getOpenCodeHandoffFollowup(handoffId: string): Promise<OpenCodeHandoffFollowup | null> {
    return this.opencodeHandoffFollowupService().get(handoffId)
  }

  async listOpenCodeHandoffFollowups(options: { limit?: number; staleAfterMs?: number } = {}): Promise<OpenCodeHandoffFollowup[]> {
    return this.opencodeHandoffFollowupService().list(options)
  }

  async openCodeHandoffFollowupSummary(options: { staleAfterMs?: number } = {}): Promise<OpenCodeHandoffFollowupSummary> {
    return this.opencodeHandoffFollowupService().summary(options)
  }

  async openCodeHandoffFollowupQueue(queue: Parameters<OpenCodeHandoffFollowupService["queue"]>[0], options: { limit?: number; staleAfterMs?: number } = {}): Promise<OpenCodeHandoffFollowupQueue> {
    return this.opencodeHandoffFollowupService().queue(queue, options)
  }

  async previewRuntimeCheckpoint(input: RuntimeCheckpointInput = {}): Promise<RuntimeCheckpointPreview> {
    return this.runtimeCheckpointService().preview(input)
  }

  async createRuntimeCheckpoint(input: RuntimeCheckpointInput = {}): Promise<RuntimeCheckpoint> {
    this.requireRuntimeCheckpointWriteRuntime("runtime.create_runtime_checkpoint")
    return this.runtimeCheckpointService().create(input)
  }

  async getRuntimeCheckpoint(checkpointId: string): Promise<RuntimeCheckpoint | null> {
    return this.runtimeCheckpointService().get(checkpointId)
  }

  async listRuntimeCheckpoints(limit = 20): Promise<RuntimeCheckpointRecord[]> {
    return this.runtimeCheckpointService().list(limit)
  }

  async previewCheckpointRestore(input: RuntimeRestoreInput): Promise<RuntimeRestorePreview> {
    return this.runtimeRestoreService().preview(input)
  }

  async markCheckpointResumeAnchor(input: RuntimeRestoreInput): Promise<RuntimeResumeAnchor> {
    this.requireRuntimeResumeWriteRuntime("runtime.mark_checkpoint_resume_anchor")
    return this.runtimeRestoreService().mark(input)
  }

  async getCheckpointResumeAnchor(resumeId: string): Promise<RuntimeResumeAnchor | null> {
    return this.runtimeRestoreService().get(resumeId)
  }

  async listCheckpointResumeAnchors(limit = 20): Promise<RuntimeResumeAnchor[]> {
    return this.runtimeRestoreService().list(limit)
  }

  async previewWakeAssessment(input: Parameters<WakeAssessmentService["preview"]>[0]): Promise<WakeAssessmentPreview> {
    return this.wakeAssessmentService().preview(input)
  }

  async createWakeAssessment(input: Parameters<WakeAssessmentService["create"]>[0]): Promise<WakeAssessment> {
    this.requireWakeAssessmentWriteRuntime("runtime.create_wake_assessment")
    return this.wakeAssessmentService().create(input)
  }

  async getWakeAssessment(wakeId: string): Promise<WakeAssessment | null> {
    return this.wakeAssessmentService().get(wakeId)
  }

  async listWakeAssessments(limit = 20): Promise<WakeAssessmentRecord[]> {
    return this.wakeAssessmentService().list(limit)
  }

  async previewContinuationPlan(input: Parameters<ContinuationService["preview"]>[0]): Promise<ContinuationPlanPreview> {
    return this.continuationService().preview(input)
  }

  async createContinuationPlan(input: Parameters<ContinuationService["create"]>[0]): Promise<ContinuationPlan> {
    this.requireContinuationWriteRuntime("runtime.create_continuation_plan")
    return this.continuationService().create(input)
  }

  async getContinuationPlan(planId: string): Promise<ContinuationPlan | null> {
    return this.continuationService().get(planId)
  }

  async listContinuationPlans(limit = 20): Promise<ContinuationPlanRecord[]> {
    return this.continuationService().list(limit)
  }

  async executeContinuationStep(input: Parameters<ContinuationService["executeStep"]>[0]): Promise<ContinuationStepResult> {
    this.requireContinuationWriteRuntime("runtime.execute_continuation_step")
    return this.continuationService().executeStep(input)
  }

  async pauseContinuationPlan(input: Parameters<ContinuationService["pause"]>[0]): Promise<ContinuationPlan> {
    this.requireContinuationWriteRuntime("runtime.pause_continuation_plan")
    return this.continuationService().pause(input)
  }

  async cancelContinuationPlan(input: Parameters<ContinuationService["cancel"]>[0]): Promise<ContinuationPlan> {
    this.requireContinuationWriteRuntime("runtime.cancel_continuation_plan")
    return this.continuationService().cancel(input)
  }

  async previewWakeSchedule(input: Parameters<WakeScheduleService["preview"]>[0]): Promise<WakeSchedulePreview> {
    return this.wakeScheduleService().preview(input)
  }

  async createWakeSchedule(input: Parameters<WakeScheduleService["create"]>[0]): Promise<WakeSchedule> {
    this.requireContinuationWriteRuntime("runtime.create_wake_schedule")
    return this.wakeScheduleService().create(input)
  }

  async getWakeSchedule(scheduleId: string): Promise<WakeSchedule | null> {
    return this.wakeScheduleService().get(scheduleId)
  }

  async listWakeSchedules(limit = 20): Promise<WakeScheduleRecord[]> {
    return this.wakeScheduleService().list(limit)
  }

  async pauseWakeSchedule(input: Parameters<WakeScheduleService["pause"]>[0]): Promise<WakeSchedule> {
    this.requireContinuationWriteRuntime("runtime.pause_wake_schedule")
    return this.wakeScheduleService().pause(input)
  }

  async resumeWakeSchedule(input: Parameters<WakeScheduleService["resume"]>[0]): Promise<WakeSchedule> {
    this.requireContinuationWriteRuntime("runtime.resume_wake_schedule")
    return this.wakeScheduleService().resume(input)
  }

  async cancelWakeSchedule(input: Parameters<WakeScheduleService["cancel"]>[0]): Promise<WakeSchedule> {
    this.requireContinuationWriteRuntime("runtime.cancel_wake_schedule")
    return this.wakeScheduleService().cancel(input)
  }

  async previewWakeScheduleTick(input: Parameters<WakeScheduleService["previewTick"]>[0]): Promise<WakeScheduleTickPreview> {
    return this.wakeScheduleService().previewTick(input)
  }

  async executeWakeScheduleTick(input: Parameters<WakeScheduleService["executeTick"]>[0]): Promise<WakeScheduleTickResult> {
    this.requireContinuationWriteRuntime("runtime.execute_wake_schedule_tick")
    return this.wakeScheduleService().executeTick(input)
  }

  async getWakeScheduleTick(tickId: string): Promise<WakeScheduleTickResult | null> {
    return this.wakeScheduleService().getTick(tickId)
  }

  async listWakeScheduleTicks(limit = 20): Promise<WakeScheduleTickResult[]> {
    return this.wakeScheduleService().listTicks(limit)
  }

  async previewWakeSchedulerStart(input: Parameters<WakeSchedulerService["previewStart"]>[0]): Promise<WakeSchedulerPreview> {
    return this.wakeSchedulerService().previewStart(input)
  }

  async startWakeScheduler(input: Parameters<WakeSchedulerService["start"]>[0]): Promise<WakeSchedulerState> {
    this.requireWakeSchedulerRuntime("runtime.start_wake_scheduler")
    return this.wakeSchedulerService().start(input)
  }

  async stopWakeScheduler(input: Parameters<WakeSchedulerService["stop"]>[0]): Promise<WakeSchedulerState> {
    this.requireWakeSchedulerRuntime("runtime.stop_wake_scheduler")
    return this.wakeSchedulerService().stop(input)
  }

  async wakeSchedulerStatus(): Promise<WakeSchedulerState> {
    return this.wakeSchedulerService().status()
  }

  async listWakeSchedulerEvents(limit = 20): Promise<WakeSchedulerEventRecord[]> {
    return this.wakeSchedulerService().listEvents(limit)
  }

  async wakeSchedulerBootstrapStatus(): Promise<WakeSchedulerBootstrapStatus> {
    return this.wakeSchedulerBootstrapService().status()
  }

  async previewWakeSchedulerBootstrap(): Promise<WakeSchedulerBootstrapStatus> {
    return this.wakeSchedulerBootstrapService().preview()
  }

  async previewWakeSchedulerRecovery(): Promise<WakeSchedulerRecoveryPreview> {
    return this.wakeSchedulerRecoveryService().preview()
  }

  async getWakeSchedulerRecovery(recoveryId: string): Promise<WakeSchedulerRecovery | null> {
    return this.wakeSchedulerRecoveryService().get(recoveryId)
  }

  async listWakeSchedulerRecoveries(limit = 20): Promise<WakeSchedulerRecoveryRecord[]> {
    return this.wakeSchedulerRecoveryService().list(limit)
  }

  async acknowledgeWakeSchedulerRecovery(input: Parameters<WakeSchedulerRecoveryService["acknowledge"]>[0]): Promise<WakeSchedulerRecovery> {
    this.requireWakeSchedulerRuntime("runtime.acknowledge_wake_scheduler_recovery")
    return this.wakeSchedulerRecoveryService().acknowledge(input)
  }

  async previewWakeSchedulerRecoveryWorkflow(input: Parameters<WakeSchedulerRecoveryWorkflowService["preview"]>[0]): Promise<WakeSchedulerRecoveryWorkflowPreview> {
    return this.wakeSchedulerRecoveryWorkflowService().preview(input)
  }

  async createWakeSchedulerRecoveryWorkflow(input: Parameters<WakeSchedulerRecoveryWorkflowService["create"]>[0]): Promise<WakeSchedulerRecoveryWorkflow> {
    this.requireWakeSchedulerRuntime("runtime.create_wake_scheduler_recovery_workflow")
    return this.wakeSchedulerRecoveryWorkflowService().create(input)
  }

  async getWakeSchedulerRecoveryWorkflow(workflowId: string): Promise<WakeSchedulerRecoveryWorkflow | null> {
    return this.wakeSchedulerRecoveryWorkflowService().get(workflowId)
  }

  async listWakeSchedulerRecoveryWorkflows(limit = 20): Promise<WakeSchedulerRecoveryWorkflowRecord[]> {
    return this.wakeSchedulerRecoveryWorkflowService().list(limit)
  }

  async recordWakeSchedulerRecoveryWorkflowStep(input: Parameters<WakeSchedulerRecoveryWorkflowService["recordStep"]>[0]): Promise<WakeSchedulerRecoveryWorkflow> {
    this.requireWakeSchedulerRuntime("runtime.record_wake_scheduler_recovery_workflow_step")
    return this.wakeSchedulerRecoveryWorkflowService().recordStep(input)
  }

  async cancelWakeSchedulerRecoveryWorkflow(input: Parameters<WakeSchedulerRecoveryWorkflowService["cancel"]>[0]): Promise<WakeSchedulerRecoveryWorkflow> {
    this.requireWakeSchedulerRuntime("runtime.cancel_wake_scheduler_recovery_workflow")
    return this.wakeSchedulerRecoveryWorkflowService().cancel(input)
  }

  async verifyWakeSchedulerRecoveryWorkflow(workflowId: string): Promise<WakeSchedulerRecoveryWorkflowVerification> {
    return this.wakeSchedulerRecoveryWorkflowService().verify(workflowId)
  }

  async wakeSchedulerAuditSummary(): Promise<WakeSchedulerAuditSummary> {
    return this.wakeSchedulerAuditService().summary()
  }

  async wakeSchedulerAuditTimeline(query: WakeSchedulerAuditQuery = {}): Promise<WakeSchedulerAuditTimelineEntry[]> {
    return this.wakeSchedulerAuditService().timeline(query)
  }

  async wakeSchedulerAuditChain(relatedId: string, limit?: number): Promise<WakeSchedulerAuditChain> {
    return this.wakeSchedulerAuditService().chain(relatedId, limit)
  }

  async wakeSchedulerAuditIncidents(query: { limit?: number; status?: string; severity?: string } = {}): Promise<WakeSchedulerAuditIncident[]> {
    return this.wakeSchedulerAuditService().incidents(query)
  }

  async wakeSchedulerNavigationBoard(input: WakeSchedulerNavigationInput = {}): Promise<WakeSchedulerNavigationBoard> {
    return this.wakeSchedulerNavigationService().board(input)
  }

  async previewWakeSchedulerNavigationCommand(command: string): Promise<WakeSchedulerNavigationCommandPreview> {
    return this.wakeSchedulerNavigationService().previewCommand(command)
  }

  async getWakeSchedulerNavigationTarget(targetKind: string, targetId: string): Promise<WakeSchedulerNavigationTarget> {
    return this.wakeSchedulerNavigationService().target(targetKind, targetId)
  }

  async previewWakeSchedulerNavigationStage(input: Parameters<WakeSchedulerNavigationStagingService["preview"]>[0]): Promise<WakeSchedulerNavigationStagePreview> {
    return this.wakeSchedulerNavigationStagingService().preview(input)
  }

  async stageWakeSchedulerNavigationCommand(input: Parameters<WakeSchedulerNavigationStagingService["stage"]>[0]): Promise<WakeSchedulerNavigationStagedCommand> {
    this.requireWakeSchedulerRuntime("runtime.stage_wake_scheduler_navigation_command")
    return this.wakeSchedulerNavigationStagingService().stage(input)
  }

  async listWakeSchedulerNavigationStagedCommands(limit = 20): Promise<WakeSchedulerNavigationStagedCommandRecord[]> {
    return this.wakeSchedulerNavigationStagingService().list(limit)
  }

  async removeWakeSchedulerNavigationStagedCommand(input: Parameters<WakeSchedulerNavigationStagingService["remove"]>[0]): Promise<WakeSchedulerNavigationStagedCommand | null> {
    this.requireWakeSchedulerRuntime("runtime.remove_wake_scheduler_navigation_staged_command")
    return this.wakeSchedulerNavigationStagingService().remove(input)
  }

  async clearWakeSchedulerNavigationStagedCommands(input: Parameters<WakeSchedulerNavigationStagingService["clear"]>[0] = {}): Promise<WakeSchedulerNavigationStagedCommandRecord[]> {
    this.requireWakeSchedulerRuntime("runtime.clear_wake_scheduler_navigation_staged_commands")
    return this.wakeSchedulerNavigationStagingService().clear(input)
  }

  async previewWakeSchedulerNavigationStagedRead(input: Parameters<WakeSchedulerNavigationStagedRunService["preview"]>[0]): Promise<WakeSchedulerNavigationStagedRunPreview> {
    return this.wakeSchedulerNavigationStagedRunService().preview(input)
  }

  async executeWakeSchedulerNavigationStagedRead(input: Parameters<WakeSchedulerNavigationStagedRunService["execute"]>[0]): Promise<WakeSchedulerNavigationStagedRunResult> {
    this.requireWakeSchedulerRuntime("runtime.execute_wake_scheduler_navigation_staged_read")
    return this.wakeSchedulerNavigationStagedRunService().execute(input)
  }

  async listWakeSchedulerNavigationStagedReadRuns(input: Parameters<WakeSchedulerNavigationStagedRunService["list"]>[0] = {}): Promise<WakeSchedulerNavigationStagedRunRecord[]> {
    return this.wakeSchedulerNavigationStagedRunService().list(input)
  }

  async getWakeSchedulerNavigationStagedReadRun(runId: string): Promise<WakeSchedulerNavigationStagedRunResult | null> {
    return this.wakeSchedulerNavigationStagedRunService().get(runId)
  }

  async wakeSchedulerNavigationStagedReadHistory(input: Parameters<WakeSchedulerNavigationStagedReadCompareService["history"]>[0] = {}): Promise<WakeSchedulerNavigationStagedReadHistory> {
    return this.wakeSchedulerNavigationStagedReadCompareService().history(input)
  }

  async wakeSchedulerNavigationStagedReadCompare(input: Parameters<WakeSchedulerNavigationStagedReadCompareService["compare"]>[0]): Promise<WakeSchedulerNavigationStagedReadPairComparison> {
    return this.wakeSchedulerNavigationStagedReadCompareService().compare(input)
  }

  async wakeSchedulerNavigationStagedReadStale(input: Parameters<WakeSchedulerNavigationStagedReadCompareService["stale"]>[0] = {}): Promise<WakeSchedulerNavigationStagedReadStaleItem[]> {
    return this.wakeSchedulerNavigationStagedReadCompareService().stale(input)
  }

  async wakeSchedulerNavigationStagedReadGroup(input: Parameters<WakeSchedulerNavigationStagedReadCompareService["group"]>[0]): Promise<WakeSchedulerNavigationStagedReadGroup | null> {
    return this.wakeSchedulerNavigationStagedReadCompareService().group(input)
  }

  async previewWakeSchedulerNavigationWriteCommand(input: Parameters<WakeSchedulerNavigationWritePreviewService["preview"]>[0]): Promise<WakeSchedulerNavigationWritePreview> {
    return this.wakeSchedulerNavigationWritePreviewService().preview(input)
  }

  async wakeSchedulerNavigationWriteBoard(input: Parameters<WakeSchedulerNavigationWritePreviewService["board"]>[0] = {}): Promise<WakeSchedulerNavigationWriteBoard> {
    return this.wakeSchedulerNavigationWritePreviewService().board(input)
  }

  async previewWakeSchedulerNavigationWriteStage(input: Parameters<WakeSchedulerNavigationWriteStagingService["preview"]>[0]): Promise<WakeSchedulerNavigationWriteStagePreview> {
    return this.wakeSchedulerNavigationWriteStagingService().preview(input)
  }

  async stageWakeSchedulerNavigationWriteCommand(input: Parameters<WakeSchedulerNavigationWriteStagingService["stage"]>[0]): Promise<WakeSchedulerNavigationStagedWriteCommand> {
    this.requireWakeSchedulerRuntime("runtime.stage_wake_scheduler_navigation_write_command")
    return this.wakeSchedulerNavigationWriteStagingService().stage(input)
  }

  async getWakeSchedulerNavigationStagedWriteCommand(stagedWriteId: string): Promise<WakeSchedulerNavigationStagedWriteCommand | null> {
    return this.wakeSchedulerNavigationWriteStagingService().get(stagedWriteId)
  }

  async listWakeSchedulerNavigationStagedWriteCommands(limit = 20): Promise<WakeSchedulerNavigationStagedWriteCommandRecord[]> {
    return this.wakeSchedulerNavigationWriteStagingService().list(limit)
  }

  async removeWakeSchedulerNavigationStagedWriteCommand(input: Parameters<WakeSchedulerNavigationWriteStagingService["remove"]>[0]): Promise<WakeSchedulerNavigationStagedWriteCommand | null> {
    this.requireWakeSchedulerRuntime("runtime.remove_wake_scheduler_navigation_staged_write_command")
    return this.wakeSchedulerNavigationWriteStagingService().remove(input)
  }

  async clearWakeSchedulerNavigationStagedWriteCommands(input: Parameters<WakeSchedulerNavigationWriteStagingService["clear"]>[0] = {}): Promise<WakeSchedulerNavigationStagedWriteCommandRecord[]> {
    this.requireWakeSchedulerRuntime("runtime.clear_wake_scheduler_navigation_staged_write_commands")
    return this.wakeSchedulerNavigationWriteStagingService().clear(input)
  }

  async previewWakeSchedulerNavigationWriteRun(input: Parameters<WakeSchedulerNavigationWriteRunService["preview"]>[0]): Promise<WakeSchedulerNavigationWriteRunPreview> {
    return this.wakeSchedulerNavigationWriteRunService().preview(input)
  }

  async executeWakeSchedulerNavigationWriteRun(input: Parameters<WakeSchedulerNavigationWriteRunService["execute"]>[0]): Promise<WakeSchedulerNavigationWriteRunResult> {
    this.requireWakeSchedulerRuntime("runtime.execute_wake_scheduler_navigation_write_run")
    return this.wakeSchedulerNavigationWriteRunService().execute(input)
  }

  async listWakeSchedulerNavigationWriteRuns(input: Parameters<WakeSchedulerNavigationWriteRunService["list"]>[0] = {}): Promise<WakeSchedulerNavigationWriteRunRecord[]> {
    return this.wakeSchedulerNavigationWriteRunService().list(input)
  }

  async getWakeSchedulerNavigationWriteRun(runId: string): Promise<WakeSchedulerNavigationWriteRunResult | null> {
    return this.wakeSchedulerNavigationWriteRunService().get(runId)
  }

  async wakeSchedulerNavigationWriteRunHistory(input: Parameters<WakeSchedulerNavigationWriteRunCompareService["history"]>[0] = {}): Promise<WakeSchedulerNavigationWriteRunHistory> {
    return this.wakeSchedulerNavigationWriteRunCompareService().history(input)
  }

  async wakeSchedulerNavigationWriteRunCompare(input: Parameters<WakeSchedulerNavigationWriteRunCompareService["compare"]>[0]): Promise<WakeSchedulerNavigationWriteRunPairComparison> {
    return this.wakeSchedulerNavigationWriteRunCompareService().compare(input)
  }

  async wakeSchedulerNavigationWriteRunStale(input: Parameters<WakeSchedulerNavigationWriteRunCompareService["stale"]>[0] = {}): Promise<WakeSchedulerNavigationWriteRunStaleItem[]> {
    return this.wakeSchedulerNavigationWriteRunCompareService().stale(input)
  }

  async wakeSchedulerNavigationWriteRunGroup(input: Parameters<WakeSchedulerNavigationWriteRunCompareService["group"]>[0]): Promise<WakeSchedulerNavigationWriteRunGroup | null> {
    return this.wakeSchedulerNavigationWriteRunCompareService().group(input)
  }

  async previewWakeSchedulerNavigationWriteReadiness(input: Parameters<WakeSchedulerNavigationWriteApprovalService["preview"]>[0]): Promise<WakeSchedulerNavigationWriteReadinessPreview> {
    return this.wakeSchedulerNavigationWriteApprovalService().preview(input)
  }

  async approveWakeSchedulerNavigationStagedWrite(input: Parameters<WakeSchedulerNavigationWriteApprovalService["approve"]>[0]): Promise<WakeSchedulerNavigationWriteApproval> {
    this.requireWakeSchedulerRuntime("runtime.approve_wake_scheduler_navigation_staged_write")
    return this.wakeSchedulerNavigationWriteApprovalService().approve(input)
  }

  async rejectWakeSchedulerNavigationStagedWrite(input: Parameters<WakeSchedulerNavigationWriteApprovalService["reject"]>[0]): Promise<WakeSchedulerNavigationWriteApproval> {
    this.requireWakeSchedulerRuntime("runtime.reject_wake_scheduler_navigation_staged_write")
    return this.wakeSchedulerNavigationWriteApprovalService().reject(input)
  }

  async revokeWakeSchedulerNavigationWriteApproval(input: Parameters<WakeSchedulerNavigationWriteApprovalService["revoke"]>[0]): Promise<WakeSchedulerNavigationWriteApproval | null> {
    this.requireWakeSchedulerRuntime("runtime.revoke_wake_scheduler_navigation_write_approval")
    return this.wakeSchedulerNavigationWriteApprovalService().revoke(input)
  }

  async getWakeSchedulerNavigationWriteApproval(approvalId: string): Promise<WakeSchedulerNavigationWriteApproval | null> {
    return this.wakeSchedulerNavigationWriteApprovalService().get(approvalId)
  }

  async listWakeSchedulerNavigationWriteApprovals(input: Parameters<WakeSchedulerNavigationWriteApprovalService["list"]>[0] = {}): Promise<WakeSchedulerNavigationWriteApprovalRecord[]> {
    return this.wakeSchedulerNavigationWriteApprovalService().list(input)
  }

  async previewWakeSchedulerNavigationCheckpointWriteRun(input: Parameters<WakeSchedulerNavigationCheckpointWriteRunService["preview"]>[0]): Promise<WakeSchedulerNavigationCheckpointWriteRunPreview> {
    return this.wakeSchedulerNavigationCheckpointWriteRunService().preview(input)
  }

  async executeWakeSchedulerNavigationCheckpointWriteRun(input: Parameters<WakeSchedulerNavigationCheckpointWriteRunService["execute"]>[0]): Promise<WakeSchedulerNavigationCheckpointWriteRunResult> {
    this.requireRuntimeCheckpointWriteRuntime("runtime.execute_wake_scheduler_navigation_checkpoint_write_run")
    return this.wakeSchedulerNavigationCheckpointWriteRunService().execute(input)
  }

  async listWakeSchedulerNavigationCheckpointWriteRuns(input: Parameters<WakeSchedulerNavigationCheckpointWriteRunService["list"]>[0] = {}): Promise<WakeSchedulerNavigationCheckpointWriteRunRecord[]> {
    return this.wakeSchedulerNavigationCheckpointWriteRunService().list(input)
  }

  async getWakeSchedulerNavigationCheckpointWriteRun(runId: string): Promise<WakeSchedulerNavigationCheckpointWriteRunResult | null> {
    return this.wakeSchedulerNavigationCheckpointWriteRunService().get(runId)
  }

  async wakeSchedulerNavigationCheckpointWriteHistory(input: Parameters<WakeSchedulerNavigationCheckpointWriteCompareService["history"]>[0] = {}): Promise<WakeSchedulerNavigationCheckpointWriteHistory> {
    return this.wakeSchedulerNavigationCheckpointWriteCompareService().history(input)
  }

  async wakeSchedulerNavigationCheckpointWriteCompare(input: Parameters<WakeSchedulerNavigationCheckpointWriteCompareService["compare"]>[0]): Promise<WakeSchedulerNavigationCheckpointWritePairComparison> {
    return this.wakeSchedulerNavigationCheckpointWriteCompareService().compare(input)
  }

  async wakeSchedulerNavigationCheckpointWriteStale(input: Parameters<WakeSchedulerNavigationCheckpointWriteCompareService["stale"]>[0] = {}): Promise<WakeSchedulerNavigationCheckpointWriteStaleItem[]> {
    return this.wakeSchedulerNavigationCheckpointWriteCompareService().stale(input)
  }

  async wakeSchedulerNavigationCheckpointWriteGroup(input: Parameters<WakeSchedulerNavigationCheckpointWriteCompareService["group"]>[0]): Promise<WakeSchedulerNavigationCheckpointWriteGroup | null> {
    return this.wakeSchedulerNavigationCheckpointWriteCompareService().group(input)
  }

  async wakeSchedulerNavigationCheckpointWriteApprovalUsage(input: Parameters<WakeSchedulerNavigationCheckpointWriteCompareService["approvalUsage"]>[0] = {}): Promise<WakeSchedulerNavigationCheckpointApprovalUsageSummary> {
    return this.wakeSchedulerNavigationCheckpointWriteCompareService().approvalUsage(input)
  }

  async executeMissionTool(call: ExecutorToolCall): Promise<ExecutorToolResult> {
    const router = new MissionToolRouter({
      handlers: {
        getMission: this.getMission.bind(this),
        listRecentMissions: this.listRecentMissions.bind(this),
        claimMission: this.claimMission.bind(this),
        recordMissionProgress: this.recordMissionProgress.bind(this),
        submitMissionResult: this.submitMissionResult.bind(this),
        completeMission: this.completeMission.bind(this),
        failMission: this.failMission.bind(this),
        cancelMission: this.cancelMission.bind(this),
        releaseMissionClaim: this.releaseMissionClaim.bind(this),
        listMissionClaims: this.listMissionClaims.bind(this),
        listMissionProgress: this.listMissionProgress.bind(this),
        listMissionResults: this.listMissionResults.bind(this),
      },
    })
    return router.handle(call)
  }

  private registerExecutorToolHandler(adapter: OpenCodeRuntimeAdapter): void {
    if (!isExecutorToolHandlerAdapter(adapter)) return
    adapter.setExecutorToolHandler((call) => this.executeMissionTool(call))
  }

  async claimMission(input: { mission_id: string; executor_id: string }): Promise<ExecutorClaim> {
    this.requireMissionWriteRuntime("runtime.claim_mission")
    return this.missionRegistry.claimMission(input)
  }

  async recordMissionProgress(input: { mission_id: string; claim_id: string; message: string }): Promise<MissionProgress> {
    this.requireMissionWriteRuntime("runtime.record_mission_progress")
    return this.missionRegistry.recordMissionProgress(input)
  }

  async submitMissionResult(input: { mission_id: string; claim_id: string; summary: string; artifacts?: string[]; research_result_ids?: string[] }): Promise<MissionResult> {
    this.requireMissionWriteRuntime("runtime.submit_mission_result")
    return this.missionRegistry.submitMissionResult(input)
  }

  async completeMission(missionId: string, input: { result_id?: string; summary?: string } = {}): Promise<MissionRecord> {
    this.requireMissionWriteRuntime("runtime.complete_mission")
    return this.missionRegistry.completeMission(missionId, input)
  }

  async failMission(missionId: string, reason: string): Promise<MissionRecord> {
    this.requireMissionWriteRuntime("runtime.fail_mission")
    return this.missionRegistry.failMission(missionId, reason)
  }

  async cancelMission(missionId: string, reason?: string): Promise<MissionRecord> {
    this.requireMissionWriteRuntime("runtime.cancel_mission")
    return this.missionRegistry.cancelMission(missionId, reason)
  }

  async releaseMissionClaim(claimId: string, reason?: string): Promise<ExecutorClaim> {
    this.requireMissionWriteRuntime("runtime.release_mission_claim")
    return this.missionRegistry.releaseMissionClaim(claimId, reason)
  }

  async listMissionClaims(missionId: string): Promise<ExecutorClaim[]> {
    return this.missionRegistry.listMissionClaims(missionId)
  }

  async listMissionProgress(missionId: string): Promise<MissionProgress[]> {
    return this.missionRegistry.listMissionProgress(missionId)
  }

  async listMissionResults(missionId: string): Promise<MissionResult[]> {
    return this.missionRegistry.listMissionResults(missionId)
  }

  async shutdown(reason = "shutdown"): Promise<void> {
    this.lifecycleShutdownRequested = true
    if (this.lifecycleShutdownTask) return this.lifecycleShutdownTask
    const task = this.shutdownSerialized(reason)
    this.lifecycleShutdownTask = task
    try {
      await task
    } finally {
      if (this.lifecycleShutdownTask === task) this.lifecycleShutdownTask = null
      this.lifecycleShutdownRequested = false
    }
  }

  private async shutdownSerialized(reason: string): Promise<void> {
    let firstError: unknown = null
    const startTask = this.lifecycleStartTask
    if (startTask) {
      try {
        await startTask
      } catch (error) {
        firstError ??= error
      }
    }
    if (this.started || this.runLock.isHeld()) {
      this.lifecycleState = "stopping"
      this.commanderInvestigationLifecycleAbort.abort(new Error("RuntimeServer shutdown cancelled Commander investigation"))
      await this.drainConfiguredCommanderInvestigations()
      this.eventBus.emit({ type: "RuntimeShutdown", reason })
      try {
        await this.wakeSchedulerServiceInstance?.shutdown(reason)
      } catch (error) {
        firstError ??= error
        this.eventBus.emit({
          type: "ExecutorLifecycle",
          phase: "runtime-wake-scheduler-shutdown-error",
          message: error instanceof Error ? error.message : String(error),
        })
      }
      try {
        await this.adapter.shutdown()
        await this.drainExecutorEventPumpAfterShutdown()
      } catch (error) {
        firstError ??= error
        this.eventBus.emit({
          type: "ExecutorLifecycle",
          phase: "runtime-adapter-shutdown-error",
          message: error instanceof Error ? error.message : String(error),
        })
      }
      this.executorStreamAbort = true
      try {
        await this.eventStore.append({ kind: "runtime_shutdown", reason })
      } catch (error) {
        firstError ??= error
        this.eventBus.emit({
          type: "ExecutorLifecycle",
          phase: "runtime-shutdown-event-error",
          message: error instanceof Error ? error.message : String(error),
        })
      } finally {
        try {
          await this.runLock.release()
        } finally {
          this.started = false
          this.lifecycleState = "stopped"
        }
      }
    } else {
      this.executorStreamAbort = true
      this.lifecycleState = "stopped"
    }
    this.closeOwnedResearchDb(firstError)
    if (firstError) throw firstError
  }

  private getResearchDb(): RuntimeResearchDbProjection {
    if (!this.researchDb) this.researchDb = assertProjectionDb(this.researchDbFactory(this.projectDir))
    return assertProjectionDb(this.researchDb)
  }

  private ensureResearchProjectionUsable(operation: "startup" | "read"): void {
    if (this.researchProjectionMode === "disabled") {
      this.researchProjectionHealth = this.disabledProjectionHealth()
      return
    }

    const integrity = this.checkResearchProjectionForStatus({ emit: true })
    if (integrity.ok && !integrity.stale) {
      this.ensureResearchFtsProjectionWritable(operation)
      return
    }
    if (integrity.stale && this.researchProjectionMode === "auto_rebuild") {
      this.requireProjectionWriteLock(`research projection auto-rebuild during ${operation}`)
      this.rebuildProjection(operation)
      const rebuilt = this.checkResearchProjectionForStatus({ emit: true })
      if (rebuilt.ok && !rebuilt.stale) {
        this.ensureResearchFtsProjectionWritable(operation)
        return
      }
      throw new Error(`research projection rebuild did not produce a usable projection: ${rebuilt.reason ?? "unknown"}`)
    }

    const reason = integrity.reason ?? (integrity.stale ? "stale" : "unknown")
    if (integrity.stale) throw new Error(`research projection stale: ${reason}`)
    throw new Error(`research projection corrupt: ${reason}`)
  }

  private ensureResearchFtsProjectionWritable(operation: "startup" | "read"): void {
    if (operation !== "startup") return
    const db = this.getResearchDb()
    if (typeof db.repairResearchResultsFtsProjectionIfNeeded !== "function") return
    this.requireProjectionWriteLock("research FTS projection repair during startup")
    db.repairResearchResultsFtsProjectionIfNeeded()
  }

  private checkResearchProjectionForStatus(options: { emit?: boolean } = {}): ResearchProjectionIntegrity {
    if (this.researchProjectionMode === "disabled") {
      this.researchProjectionHealth = this.disabledProjectionHealth()
      return { ok: true, stale: false }
    }

    let integrity: ResearchProjectionIntegrity
    try {
      integrity = this.getResearchDb().checkProjectionIntegrity(this.eventStore.eventsPath)
    } catch (error) {
      integrity = { ok: false, stale: false, reason: error instanceof Error ? error.message : String(error) }
    }
    this.updateResearchProjectionHealth(integrity)
    if (options.emit) {
      this.emitResearchProjectionEvent(integrity.ok ? "ResearchProjectionChecked" : integrity.stale ? "ResearchProjectionStale" : "ResearchProjectionCorrupt")
    }
    return integrity
  }

  private rebuildProjection(operation: "startup" | "read" | "command"): void {
    this.emitResearchProjectionEvent("ResearchProjectionRebuildStarted", `research projection rebuild started during ${operation}`)
    try {
      this.getResearchDb().rebuildFromEvents(this.eventStore.eventsPath)
      const status = this.getResearchDb().getProjectionStatus()
      this.researchProjectionHealth = {
        ...this.researchProjectionHealth,
        ok: true,
        stale: false,
        reason: undefined,
        last_event_id: status.last_event_id ?? undefined,
        pending_count: 0,
        rebuilt_at: status.rebuilt_at ?? undefined,
        checked_at: new Date().toISOString(),
      }
      this.emitResearchProjectionEvent("ResearchProjectionRebuilt")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.researchProjectionHealth = {
        ...this.researchProjectionHealth,
        ok: false,
        stale: false,
        reason: message,
        checked_at: new Date().toISOString(),
      }
      this.emitResearchProjectionEvent("ResearchProjectionRebuildFailed")
      throw new Error(`research projection rebuild failed: ${message}`)
    }
  }

  private requireProjectionWriteLock(operation: string): void {
    if (!this.runLock.isHeld()) throw new Error(`${operation} requires runtime start with run lock held`)
  }

  private async withProjectionWriteLock<T>(operation: () => T): Promise<T> {
    if (this.runLock.isHeld()) return operation()
    await this.runLock.acquire()
    try {
      return operation()
    } finally {
      await this.runLock.release()
    }
  }

  private updateResearchProjectionHealth(integrity: ResearchProjectionIntegrity): void {
    let status: ResearchProjectionStatus | null = null
    try {
      status = this.getResearchDb().getProjectionStatus()
    } catch {
      status = null
    }
    this.researchProjectionHealth = {
      mode: this.researchProjectionMode,
      ok: integrity.ok,
      stale: integrity.stale,
      reason: integrity.reason,
      last_event_id: integrity.last_event_id ?? status?.last_event_id ?? undefined,
      pending_count: integrity.pending_count ?? 0,
      rebuilt_at: status?.rebuilt_at ?? undefined,
      checked_at: new Date().toISOString(),
    }
  }

  private emitResearchProjectionEvent(type: ResearchProjectionRuntimeEventType, reason?: string): void {
    this.eventBus.emit({
      type,
      mode: this.researchProjectionHealth.mode,
      ok: this.researchProjectionHealth.ok,
      stale: this.researchProjectionHealth.stale,
      reason: reason ?? this.researchProjectionHealth.reason,
      last_event_id: this.researchProjectionHealth.last_event_id,
      pending_count: this.researchProjectionHealth.pending_count,
      rebuilt_at: this.researchProjectionHealth.rebuilt_at,
      checked_at: this.researchProjectionHealth.checked_at ?? new Date().toISOString(),
    })
  }

  private disabledProjectionHealth(): RuntimeResearchProjectionHealth {
    return { mode: "disabled", ok: true, stale: false, reason: "disabled", pending_count: 0, checked_at: new Date().toISOString() }
  }

  private closeOwnedResearchDb(firstError: unknown): void {
    if (!this.researchDb || !this.ownsResearchDb) return
    try {
      this.researchDb.close()
      this.researchDb = null
    } catch (error) {
      if (!firstError) throw error
      this.eventBus.emit({
        type: "ExecutorLifecycle",
        phase: "runtime-research-db-close-error",
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private requireMissionWriteRuntime(commandName: string): void {
    if (this.mode !== "active") throw new Error(`${commandName} requires active mode`)
    if (!this.started || !this.runLock.isHeld()) throw new Error("runtime must be started before mission execution writes")
  }

  private requireReviewWriteRuntime(commandName: string): void {
    if (this.mode !== "active") throw new Error(`${commandName} requires active mode`)
    if (!this.started || !this.runLock.isHeld()) throw new Error("runtime must be started before review writes")
  }

  private requireProposalWriteRuntime(commandName: string): void {
    if (this.mode !== "active") throw new Error(`${commandName} requires active mode`)
    if (!this.started || !this.runLock.isHeld()) throw new Error("runtime must be started before proposal writes")
  }

  private requireProposalBundleWriteRuntime(commandName: string): void {
    if (this.mode !== "active") throw new Error(`${commandName} requires active mode`)
    if (!this.started || !this.runLock.isHeld()) throw new Error("runtime must be started before proposal bundle writes")
  }

  private requireCommanderPlaybookWriteRuntime(commandName: string): void {
    if (this.mode !== "active") throw new Error(`${commandName} requires active mode`)
    if (!this.started || !this.runLock.isHeld()) throw new Error("runtime must be started before commander playbook writes")
  }

  private requireCommanderApplyWriteRuntime(commandName: string): void {
    if (this.mode !== "active") throw new Error(`${commandName} requires active mode`)
    if (!this.started || !this.runLock.isHeld()) throw new Error("runtime must be started before commander apply writes")
  }

  private requireExternalApiWriteRuntime(commandName: string): void {
    if (this.mode !== "active") throw new Error(`${commandName} requires active mode`)
    if (!this.started || !this.runLock.isHeld()) throw new Error("runtime must be started before external API requests")
  }

  private requireExternalApiResearchWriteRuntime(commandName: string): void {
    if (this.mode !== "active") throw new Error(`${commandName} requires active mode`)
    if (!this.started || !this.runLock.isHeld()) throw new Error("runtime must be started before external API research ingestion writes")
  }

  private requireResearchSynthesisWriteRuntime(commandName: string): void {
    if (this.mode !== "active") throw new Error(`${commandName} requires active mode`)
    if (!this.started || !this.runLock.isHeld()) throw new Error("runtime must be started before research synthesis writes")
  }

  private requireCommanderCycleWriteRuntime(commandName: string): void {
    if (this.mode !== "active") throw new Error(`${commandName} requires active mode`)
    if (!this.started || !this.runLock.isHeld()) throw new Error("runtime must be started before commander cycle writes")
  }

  private requireCommanderExecutorReviewRuntime(commandName: string): void {
    if (this.mode !== "active") throw new Error(`${commandName} requires active mode`)
    if (!this.started || !this.runLock.isHeld()) throw new Error("runtime must be started before commander executor review writes")
  }

  private requireReasoningProviderSmokeRuntime(commandName: string): void {
    if (this.mode !== "active") throw new Error(`${commandName} requires active mode`)
    if (!this.started || !this.runLock.isHeld()) throw new Error("runtime must be started before reasoning provider smoke")
  }

  private async requireMiniMaxLiveValidationWriteAuthority(commandName: string): Promise<void> {
    if (this.mode !== "active") throw new Error(`${commandName} requires active mode`)
    if (!this.specSummary && modeRequiresApprovedSpec(this.mode)) {
      this.specSummary = await this.specService.requireApproved()
    }
  }

  private async withMiniMaxLiveValidationWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    if (this.runLock.isHeld()) return operation()
    await this.runLock.acquire()
    try {
      return await operation()
    } finally {
      await this.runLock.release()
    }
  }

  private async withInstructionPackWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    if (this.runLock.isHeld()) return operation()
    await this.runLock.acquire()
    try {
      return await operation()
    } finally {
      await this.runLock.release()
    }
  }

  private async withOpenCodeLaunchWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    if (this.runLock.isHeld()) return operation()
    await this.runLock.acquire()
    try {
      return await operation()
    } finally {
      await this.runLock.release()
    }
  }

  private requireOpenCodeHandoffRuntime(commandName: string): void {
    if (this.mode !== "active") throw new Error(`${commandName} requires active mode`)
    if (!this.started || !this.runLock.isHeld()) throw new Error("runtime must be started before opencode handoff writes")
  }

  private requireOpenCodeProcessSmokeRuntime(commandName: string): void {
    if (this.mode !== "active") throw new Error(`${commandName} requires active mode`)
    if (!this.started || !this.runLock.isHeld()) throw new Error("runtime must be started before opencode process smoke writes")
  }

  private requireRuntimeCheckpointWriteRuntime(commandName: string): void {
    if (this.mode !== "active") throw new Error(`${commandName} requires active mode`)
    if (!this.started || !this.runLock.isHeld()) throw new Error("runtime must be started before runtime checkpoint writes")
  }

  private requireRuntimeResumeWriteRuntime(commandName: string): void {
    if (this.mode !== "active") throw new Error(`${commandName} requires active mode`)
    if (!this.started || !this.runLock.isHeld()) throw new Error("runtime must be started before runtime resume anchor writes")
  }

  private requireWakeAssessmentWriteRuntime(commandName: string): void {
    if (this.mode !== "active") throw new Error(`${commandName} requires active mode`)
    if (!this.started || !this.runLock.isHeld()) throw new Error("runtime must be started before wake assessment writes")
  }

  private requireContinuationWriteRuntime(commandName: string): void {
    if (this.mode !== "active") throw new Error(`${commandName} requires active mode`)
    if (!this.started || !this.runLock.isHeld()) throw new Error("runtime must be started before continuation writes")
  }

  private requireWakeSchedulerRuntime(commandName: string): void {
    if (this.mode !== "active") throw new Error(`${commandName} requires active mode`)
    if (!this.started || !this.runLock.isHeld()) throw new Error("runtime must be started before wake scheduler writes")
  }

  private commanderApplyService(): CommanderApplyService {
    return new CommanderApplyService({
      proposalRegistry: this.proposalRegistry,
      proposalBundleRegistry: this.proposalBundleRegistry,
      commanderPlaybookDraftRegistry: this.commanderPlaybookDraftRegistry,
    })
  }

  private commanderAuditService(): CommanderAuditService {
    return new CommanderAuditService(this.eventStore)
  }

  private commanderQueueService(): CommanderQueueService {
    return new CommanderQueueService({
      reviewRegistry: this.reviewRegistry,
      proposalRegistry: this.proposalRegistry,
      proposalBundleRegistry: this.proposalBundleRegistry,
      commanderPlaybookDraftRegistry: this.commanderPlaybookDraftRegistry,
      applyService: this.commanderApplyService(),
      now: this.commanderQueueNow,
    })
  }

  private opencodeHandoffService(): OpenCodeHandoffService {
    this.opencodeHandoffServiceInstance ??= new OpenCodeHandoffService({
      eventStore: this.eventStore,
      proposalRegistry: this.proposalRegistry,
      reviewRegistry: this.reviewRegistry,
      sendMission: (objective) => this.createAndSendMission(objective),
      now: this.opencodeHandoffNow,
      idFactory: this.opencodeHandoffId ? () => this.opencodeHandoffId!() : undefined,
    })
    return this.opencodeHandoffServiceInstance
  }

  private opencodeProcessSmokeService(): OpenCodeProcessSmokeService {
    this.opencodeProcessSmokeServiceInstance ??= new OpenCodeProcessSmokeService({
      eventStore: this.eventStore,
      projectDir: this.projectDir,
      adapterConfig: this.openCodeAdapterConfig,
      env: this.opencodeProcessSmokeEnv,
      spawn: this.opencodeProcessSmokeSpawn,
      now: this.opencodeProcessSmokeNow,
      idFactory: this.opencodeProcessSmokeId ? () => this.opencodeProcessSmokeId!() : undefined,
    })
    return this.opencodeProcessSmokeServiceInstance
  }

  private opencodeHandoffReadinessService(): OpenCodeHandoffReadinessService {
    this.opencodeHandoffReadinessServiceInstance ??= new OpenCodeHandoffReadinessService({
      adapterKind: this.openCodeAdapterConfig?.kind ?? "fake",
      now: this.opencodeHandoffNow,
      listSmokes: (limit) => this.opencodeProcessSmokeService().list(limit),
      previewHandoff: (input) => this.opencodeHandoffService().preview(input),
      listHandoffs: (limit) => this.opencodeHandoffService().list(limit),
      getHandoff: (handoffId) => this.opencodeHandoffService().get(handoffId),
      followupSummary: () => this.opencodeHandoffFollowupService().summary(),
    })
    return this.opencodeHandoffReadinessServiceInstance
  }

  private opencodeResultReviewPacketService(): OpenCodeResultReviewPacketService {
    this.opencodeResultReviewPacketServiceInstance ??= new OpenCodeResultReviewPacketService({
      now: this.opencodeHandoffNow,
      listHandoffs: (limit) => this.opencodeHandoffService().list(limit),
      getHandoff: (handoffId) => this.opencodeHandoffService().get(handoffId),
      getHandoffByProposal: (proposalId) => this.opencodeHandoffService().getByProposal(proposalId),
      listFollowups: (options) => this.opencodeHandoffFollowupService().list(options),
      getFollowup: (handoffId, options) => this.opencodeHandoffFollowupService().get(handoffId, options),
      getFollowupByProposal: (proposalId, options) => this.opencodeHandoffFollowupService().getByProposal(proposalId, options),
      getFollowupByMission: (missionId, options) => this.opencodeHandoffFollowupService().getByMission(missionId, options),
      followupSummary: (options) => this.opencodeHandoffFollowupService().summary(options),
      getMission: (missionId) => this.missionRegistry.getMission(missionId),
      listMissionProgress: (missionId) => this.missionRegistry.listMissionProgress(missionId),
      listMissionResults: (missionId) => this.missionRegistry.listMissionResults(missionId),
      getMissionResult: (resultId) => this.missionRegistry.getMissionResult(resultId),
      getProposal: (proposalId) => this.proposalRegistry.getProposal(proposalId),
      getReview: (reviewId) => this.reviewRegistry.getReviewRequest(reviewId),
      readinessPreview: (input) => this.opencodeHandoffReadinessService().preview(input),
      readinessSummary: () => this.opencodeHandoffReadinessService().summary(),
      listSmokes: (limit) => this.opencodeProcessSmokeService().list(limit),
    })
    return this.opencodeResultReviewPacketServiceInstance
  }

  private opencodeSessionService(): OpenCodeSessionService {
    this.opencodeSessionServiceInstance ??= new OpenCodeSessionService({
      eventStore: this.eventStore,
      missionRegistry: this.missionRegistry,
      proposalRegistry: this.proposalRegistry,
    })
    return this.opencodeSessionServiceInstance
  }

  private contextBudgetService(): ContextBudgetService {
    this.contextBudgetServiceInstance ??= new ContextBudgetService({
      registry: this.modelCapabilityRegistry,
      opencodeSessionService: this.opencodeSessionService(),
    })
    return this.contextBudgetServiceInstance
  }

  private contextPacketCompilerService(): ContextPacketCompilerService {
    this.contextPacketCompilerServiceInstance ??= new ContextPacketCompilerService({
      contextBudgetService: this.contextBudgetService(),
      opencodeSessionService: this.opencodeSessionService(),
      missionRegistry: this.missionRegistry,
      proposalRegistry: this.proposalRegistry,
    })
    return this.contextPacketCompilerServiceInstance
  }

  private opencodeSessionInstructionPackService(): OpenCodeSessionInstructionPackService {
    this.opencodeSessionInstructionPackServiceInstance ??= new OpenCodeSessionInstructionPackService({
      projectDir: this.projectDir,
      eventStore: this.eventStore,
      opencodeSessionService: this.opencodeSessionService(),
      contextPacketCompilerService: this.contextPacketCompilerService(),
    })
    return this.opencodeSessionInstructionPackServiceInstance
  }

  private opencodeLaunchReadinessService(): OpenCodeLaunchReadinessService {
    this.opencodeLaunchReadinessServiceInstance ??= new OpenCodeLaunchReadinessService({
      projectDir: this.projectDir,
      opencodeSessionService: this.opencodeSessionService(),
      instructionPackService: this.opencodeSessionInstructionPackService(),
      contextPacketCompilerService: this.contextPacketCompilerService(),
      researchNoveltyService: this.researchNoveltyService(),
      nativeLaunchSurface: this.openCodeAdapterConfig?.kind === "process" ? "process_adapter" : "unknown",
    })
    return this.opencodeLaunchReadinessServiceInstance
  }

  private opencodeLaunchGateService(): OpenCodeLaunchGateService {
    this.opencodeLaunchGateServiceInstance ??= new OpenCodeLaunchGateService({
      projectDir: this.projectDir,
      eventStore: this.eventStore,
      readinessService: this.opencodeLaunchReadinessService(),
      instructionPackService: this.opencodeSessionInstructionPackService(),
      fakeAdapter: new FakeOpenCodeLaunchAdapter(),
      realAdapter: this.opencodeLaunchAdapter ?? this.createOpenCodeLaunchAdapter(),
      env: this.opencodeLaunchEnv,
      now: this.opencodeLaunchNow,
      idFactory: this.opencodeLaunchId,
    })
    return this.opencodeLaunchGateServiceInstance
  }

  private opencodeProgressService(): OpenCodeProgressService {
    this.opencodeProgressServiceInstance ??= new OpenCodeProgressService({
      eventStore: this.eventStore,
      opencodeSessionService: this.opencodeSessionService(),
      launchGateService: this.opencodeLaunchGateService(),
    })
    return this.opencodeProgressServiceInstance
  }

  private opencodeTimeoutWatchdogService(): OpenCodeTimeoutWatchdogService {
    this.opencodeTimeoutWatchdogServiceInstance ??= new OpenCodeTimeoutWatchdogService({
      eventStore: this.eventStore,
      opencodeSessionService: this.opencodeSessionService(),
      launchGateService: this.opencodeLaunchGateService(),
      progressService: this.opencodeProgressService(),
      now: this.opencodeWatchdogNow,
      watchdogIdFactory: this.opencodeWatchdogId,
      forcedReportIdFactory: this.opencodeForcedReportId,
    })
    return this.opencodeTimeoutWatchdogServiceInstance
  }

  private opencodeCommanderQuestionService(): OpenCodeCommanderQuestionService {
    this.opencodeCommanderQuestionServiceInstance ??= new OpenCodeCommanderQuestionService({
      eventStore: this.eventStore,
      opencodeSessionService: this.opencodeSessionService(),
      launchGateService: this.opencodeLaunchGateService(),
      progressService: this.opencodeProgressService(),
      watchdogService: this.opencodeTimeoutWatchdogService(),
    })
    return this.opencodeCommanderQuestionServiceInstance
  }

  private commanderGuidanceService(): CommanderGuidanceService {
    this.commanderGuidanceServiceInstance ??= new CommanderGuidanceService({
      eventStore: this.eventStore,
      opencodeSessionService: this.opencodeSessionService(),
      launchGateService: this.opencodeLaunchGateService(),
      questionService: this.opencodeCommanderQuestionService(),
    })
    return this.commanderGuidanceServiceInstance
  }

  private commanderGuidanceDeliveryService(): CommanderGuidanceDeliveryService {
    this.commanderGuidanceDeliveryServiceInstance ??= new CommanderGuidanceDeliveryService({
      eventStore: this.eventStore,
      opencodeSessionService: this.opencodeSessionService(),
      launchGateService: this.opencodeLaunchGateService(),
      questionService: this.opencodeCommanderQuestionService(),
      guidanceService: this.commanderGuidanceService(),
    })
    return this.commanderGuidanceDeliveryServiceInstance
  }

  private opencodeHumanControlService(): OpenCodeHumanControlService {
    this.opencodeHumanControlServiceInstance ??= new OpenCodeHumanControlService({
      eventStore: this.eventStore,
      opencodeSessionService: this.opencodeSessionService(),
      launchGateService: this.opencodeLaunchGateService(),
      progressService: this.opencodeProgressService(),
      watchdogService: this.opencodeTimeoutWatchdogService(),
      questionService: this.opencodeCommanderQuestionService(),
      guidanceService: this.commanderGuidanceService(),
      guidanceDeliveryService: this.commanderGuidanceDeliveryService(),
    })
    return this.opencodeHumanControlServiceInstance
  }

  private opencodeWakeSupervisorService(): OpenCodeWakeSupervisorService {
    this.opencodeWakeSupervisorServiceInstance ??= new OpenCodeWakeSupervisorService({
      opencodeSessionService: this.opencodeSessionService(),
      launchGateService: this.opencodeLaunchGateService(),
      progressService: this.opencodeProgressService(),
      watchdogService: this.opencodeTimeoutWatchdogService(),
      questionService: this.opencodeCommanderQuestionService(),
      guidanceService: this.commanderGuidanceService(),
      guidanceDeliveryService: this.commanderGuidanceDeliveryService(),
      humanControlService: this.opencodeHumanControlService(),
    })
    return this.opencodeWakeSupervisorServiceInstance
  }

  private opencodeWakeSupervisorExecutionService(): OpenCodeWakeSupervisorExecutionService {
    this.opencodeWakeSupervisorExecutionServiceInstance ??= new OpenCodeWakeSupervisorExecutionService({
      eventStore: this.eventStore,
      wakeSupervisorService: this.opencodeWakeSupervisorService(),
    })
    return this.opencodeWakeSupervisorExecutionServiceInstance
  }

  private opencodeWakeActionExecutionService(): OpenCodeWakeActionExecutionService {
    this.opencodeWakeActionExecutionServiceInstance ??= new OpenCodeWakeActionExecutionService({
      eventStore: this.eventStore,
      wakeExecutionService: this.opencodeWakeSupervisorExecutionService(),
      watchdogService: this.opencodeTimeoutWatchdogService(),
      questionService: this.opencodeCommanderQuestionService(),
      guidanceDeliveryService: this.commanderGuidanceDeliveryService(),
      progressService: this.opencodeProgressService(),
      humanControlService: this.opencodeHumanControlService(),
    })
    return this.opencodeWakeActionExecutionServiceInstance
  }

  private opencodeResultReportService(): OpenCodeResultReportService {
    this.opencodeResultReportServiceInstance ??= new OpenCodeResultReportService({
      eventStore: this.eventStore,
      opencodeSessionService: this.opencodeSessionService(),
      launchGateService: this.opencodeLaunchGateService(),
      progressService: this.opencodeProgressService(),
      watchdogService: this.opencodeTimeoutWatchdogService(),
      questionService: this.opencodeCommanderQuestionService(),
      guidanceService: this.commanderGuidanceService(),
      guidanceDeliveryService: this.commanderGuidanceDeliveryService(),
      wakeExecutionService: this.opencodeWakeSupervisorExecutionService(),
      wakeActionExecutionService: this.opencodeWakeActionExecutionService(),
    })
    return this.opencodeResultReportServiceInstance
  }

  private opencodeResultReviewService(): OpenCodeResultReviewService {
    this.opencodeResultReviewServiceInstance ??= new OpenCodeResultReviewService({
      eventStore: this.eventStore,
      opencodeSessionService: this.opencodeSessionService(),
      launchGateService: this.opencodeLaunchGateService(),
      resultReportService: this.opencodeResultReportService(),
    })
    return this.opencodeResultReviewServiceInstance
  }

  private createOpenCodeLaunchAdapter(): OpenCodeLaunchAdapter {
    if (this.openCodeAdapterConfig?.kind === "process") {
      return new ProcessOpenCodeLaunchAdapter({
        command: this.openCodeAdapterConfig.command!,
        args: this.openCodeAdapterConfig.args,
        cwd: this.openCodeAdapterConfig.cwd ?? this.projectDir,
        env: this.openCodeAdapterConfig.env,
        spawn: this.opencodeLaunchSpawn,
        spawnTimeoutMs: this.openCodeAdapterConfig.spawnTimeoutMs,
      })
    }
    return new DisabledOpenCodeLaunchAdapter()
  }

  private commanderExecutorReviewService(): CommanderExecutorReviewService {
    this.commanderExecutorReviewServiceInstance ??= new CommanderExecutorReviewService({
      eventStore: this.eventStore,
      packetService: this.opencodeResultReviewPacketService(),
      provider: this.commanderExecutorReviewProvider,
      now: this.commanderExecutorReviewNow ?? this.opencodeHandoffNow,
      reviewId: this.commanderExecutorReviewId,
    })
    return this.commanderExecutorReviewServiceInstance
  }

  private executorReviewProposalDraftService(): ExecutorReviewProposalDraftService {
    this.executorReviewProposalDraftServiceInstance ??= new ExecutorReviewProposalDraftService({
      eventStore: this.eventStore,
      packetService: this.opencodeResultReviewPacketService(),
      now: this.commanderExecutorReviewNow ?? this.opencodeHandoffNow,
    })
    return this.executorReviewProposalDraftServiceInstance
  }

  private executorReviewProposalCreateService(): ExecutorReviewProposalCreateService {
    this.executorReviewProposalCreateServiceInstance ??= new ExecutorReviewProposalCreateService({
      eventStore: this.eventStore,
      draftService: this.executorReviewProposalDraftService(),
      proposalRegistry: this.proposalRegistry,
      now: this.commanderExecutorReviewNow ?? this.opencodeHandoffNow,
    })
    return this.executorReviewProposalCreateServiceInstance
  }

  private executorReviewProposalReviewRequestService(): ExecutorReviewProposalReviewRequestService {
    this.executorReviewProposalReviewRequestServiceInstance ??= new ExecutorReviewProposalReviewRequestService({
      eventStore: this.eventStore,
      proposalRegistry: this.proposalRegistry,
      reviewRegistry: this.reviewRegistry,
      createService: this.executorReviewProposalCreateService(),
      now: this.commanderExecutorReviewNow ?? this.opencodeHandoffNow,
    })
    return this.executorReviewProposalReviewRequestServiceInstance
  }

  private executorReviewProposalReviewDecisionService(): ExecutorReviewProposalReviewDecisionService {
    this.executorReviewProposalReviewDecisionServiceInstance ??= new ExecutorReviewProposalReviewDecisionService({
      eventStore: this.eventStore,
      proposalRegistry: this.proposalRegistry,
      reviewRegistry: this.reviewRegistry,
      requestService: this.executorReviewProposalReviewRequestService(),
      now: this.commanderExecutorReviewNow ?? this.opencodeHandoffNow,
    })
    return this.executorReviewProposalReviewDecisionServiceInstance
  }

  private executorReviewProposalApplyReadinessService(): ExecutorReviewProposalApplyReadinessService {
    this.executorReviewProposalApplyReadinessServiceInstance ??= new ExecutorReviewProposalApplyReadinessService({
      eventStore: this.eventStore,
      proposalRegistry: this.proposalRegistry,
      reviewRegistry: this.reviewRegistry,
      createService: this.executorReviewProposalCreateService(),
      requestService: this.executorReviewProposalReviewRequestService(),
      decisionService: this.executorReviewProposalReviewDecisionService(),
      now: this.commanderExecutorReviewNow ?? this.opencodeHandoffNow,
    })
    return this.executorReviewProposalApplyReadinessServiceInstance
  }

  private executorReviewProposalNarrowApplyService(): ExecutorReviewProposalNarrowApplyService {
    this.executorReviewProposalNarrowApplyServiceInstance ??= new ExecutorReviewProposalNarrowApplyService({
      eventStore: this.eventStore,
      proposalRegistry: this.proposalRegistry,
      applyReadinessService: this.executorReviewProposalApplyReadinessService(),
      now: this.commanderExecutorReviewNow ?? this.opencodeHandoffNow,
    })
    return this.executorReviewProposalNarrowApplyServiceInstance
  }

  private opencodeHandoffFollowupService(): OpenCodeHandoffFollowupService {
    return new OpenCodeHandoffFollowupService({
      eventStore: this.eventStore,
      proposalRegistry: this.proposalRegistry,
      reviewRegistry: this.reviewRegistry,
      missionRegistry: this.missionRegistry,
      now: this.opencodeHandoffNow,
    })
  }

  private commanderTargetContextService(): CommanderTargetContextService {
    return new CommanderTargetContextService({
      missionRegistry: this.missionRegistry,
      reviewRegistry: this.reviewRegistry,
      proposalRegistry: this.proposalRegistry,
      proposalBundleRegistry: this.proposalBundleRegistry,
      commanderPlaybookDraftRegistry: this.commanderPlaybookDraftRegistry,
      applyService: this.commanderApplyService(),
      auditService: this.commanderAuditService(),
      queueService: this.commanderQueueService(),
      runtimeStatus: this.status.bind(this),
    })
  }

  private runtimeCheckpointService(): RuntimeCheckpointService {
    this.runtimeCheckpointServiceInstance ??= new RuntimeCheckpointService({
      eventStore: this.eventStore,
      now: this.runtimeCheckpointNow,
      idFactory: this.runtimeCheckpointId ? () => this.runtimeCheckpointId!() : undefined,
      sectionProvider: () => this.runtimeCheckpointSections(),
    })
    return this.runtimeCheckpointServiceInstance
  }

  private runtimeRestoreService(): RuntimeRestoreService {
    this.runtimeRestoreServiceInstance ??= new RuntimeRestoreService({
      eventStore: this.eventStore,
      now: this.runtimeResumeNow ?? this.runtimeCheckpointNow,
      idFactory: this.runtimeResumeId ? () => this.runtimeResumeId!() : undefined,
      sectionProvider: () => this.runtimeCheckpointSections(),
    })
    return this.runtimeRestoreServiceInstance
  }

  private wakeAssessmentService(): WakeAssessmentService {
    this.wakeAssessmentServiceInstance ??= new WakeAssessmentService({
      eventStore: this.eventStore,
      restoreService: this.runtimeRestoreService(),
      now: this.runtimeWakeNow ?? this.runtimeResumeNow ?? this.runtimeCheckpointNow,
      idFactory: this.runtimeWakeId ? () => this.runtimeWakeId!() : undefined,
      sectionProvider: () => this.runtimeCheckpointSections(),
    })
    return this.wakeAssessmentServiceInstance
  }

  private continuationService(): ContinuationService {
    this.continuationServiceInstance ??= new ContinuationService({
      eventStore: this.eventStore,
      wakeService: this.wakeAssessmentService(),
      now: this.runtimeContinuationNow ?? this.runtimeWakeNow ?? this.runtimeResumeNow ?? this.runtimeCheckpointNow,
      idFactory: this.runtimeContinuationId ? () => this.runtimeContinuationId!() : undefined,
      stepIdFactory: this.runtimeContinuationStepId ? () => this.runtimeContinuationStepId!() : undefined,
      executeReadCommand: (command) => this.executeContinuationReadCommand(command),
    })
    return this.continuationServiceInstance
  }

  private wakeScheduleService(): WakeScheduleService {
    this.wakeScheduleServiceInstance ??= new WakeScheduleService({
      eventStore: this.eventStore,
      restoreService: this.runtimeRestoreService(),
      wakeService: this.wakeAssessmentService(),
      continuationService: this.continuationService(),
      now: this.runtimeWakeScheduleNow ?? this.runtimeWakeNow ?? this.runtimeResumeNow ?? this.runtimeCheckpointNow,
      idFactory: this.runtimeWakeScheduleId ? () => this.runtimeWakeScheduleId!() : undefined,
      tickIdFactory: this.runtimeWakeScheduleTickId ? () => this.runtimeWakeScheduleTickId!() : undefined,
    })
    return this.wakeScheduleServiceInstance
  }

  private wakeSchedulerService(): WakeSchedulerService {
    this.wakeSchedulerServiceInstance ??= new WakeSchedulerService({
      eventStore: this.eventStore,
      wakeScheduleService: this.wakeScheduleService(),
      now: this.runtimeWakeSchedulerNow ?? this.runtimeWakeScheduleNow ?? this.runtimeWakeNow ?? this.runtimeResumeNow ?? this.runtimeCheckpointNow,
      setTimer: this.runtimeWakeSchedulerSetTimer,
      clearTimer: this.runtimeWakeSchedulerClearTimer,
      minIntervalMs: this.runtimeWakeSchedulerMinIntervalMs,
      minHeartbeatIntervalMs: this.runtimeWakeSchedulerMinHeartbeatIntervalMs,
      canRun: () => this.mode === "active" && this.started && this.runLock.isHeld(),
    })
    return this.wakeSchedulerServiceInstance
  }

  private wakeSchedulerBootstrapService(): WakeSchedulerBootstrapService {
    this.wakeSchedulerBootstrapServiceInstance ??= new WakeSchedulerBootstrapService({
      eventStore: this.eventStore,
      scheduler: this.wakeSchedulerService(),
      config: this.wakeSchedulerBootstrapConfig,
      now: this.runtimeWakeSchedulerNow ?? this.runtimeWakeScheduleNow ?? this.runtimeWakeNow ?? this.runtimeResumeNow ?? this.runtimeCheckpointNow,
    })
    return this.wakeSchedulerBootstrapServiceInstance
  }

  private wakeSchedulerRecoveryService(): WakeSchedulerRecoveryService {
    this.wakeSchedulerRecoveryServiceInstance ??= new WakeSchedulerRecoveryService({
      eventStore: this.eventStore,
      scheduler: this.wakeSchedulerService(),
      bootstrap: this.wakeSchedulerBootstrapService(),
      wakeScheduleService: this.wakeScheduleService(),
      now: this.runtimeWakeSchedulerNow ?? this.runtimeWakeScheduleNow ?? this.runtimeWakeNow ?? this.runtimeResumeNow ?? this.runtimeCheckpointNow,
    })
    return this.wakeSchedulerRecoveryServiceInstance
  }

  private wakeSchedulerRecoveryWorkflowService(): WakeSchedulerRecoveryWorkflowService {
    this.wakeSchedulerRecoveryWorkflowServiceInstance ??= new WakeSchedulerRecoveryWorkflowService({
      eventStore: this.eventStore,
      recovery: this.wakeSchedulerRecoveryService(),
      now: this.runtimeWakeSchedulerNow ?? this.runtimeWakeScheduleNow ?? this.runtimeWakeNow ?? this.runtimeResumeNow ?? this.runtimeCheckpointNow,
    })
    return this.wakeSchedulerRecoveryWorkflowServiceInstance
  }

  private wakeSchedulerAuditService(): WakeSchedulerAuditService {
    this.wakeSchedulerAuditServiceInstance ??= new WakeSchedulerAuditService(this.eventStore)
    return this.wakeSchedulerAuditServiceInstance
  }

  private wakeSchedulerNavigationService(): WakeSchedulerNavigationService {
    this.wakeSchedulerNavigationServiceInstance ??= new WakeSchedulerNavigationService(this.wakeSchedulerAuditService())
    return this.wakeSchedulerNavigationServiceInstance
  }

  private wakeSchedulerNavigationStagingService(): WakeSchedulerNavigationStagingService {
    const now = this.runtimeWakeSchedulerNow ?? this.runtimeWakeScheduleNow ?? this.runtimeWakeNow ?? this.runtimeResumeNow ?? this.runtimeCheckpointNow ?? (() => new Date())
    this.wakeSchedulerNavigationStagingServiceInstance ??= new WakeSchedulerNavigationStagingService(this.eventStore, () => now().toISOString())
    return this.wakeSchedulerNavigationStagingServiceInstance
  }

  private wakeSchedulerNavigationReadExecutor(): WakeSchedulerNavigationReadExecutor {
    this.wakeSchedulerNavigationReadExecutorInstance ??= new WakeSchedulerNavigationReadExecutor(this)
    return this.wakeSchedulerNavigationReadExecutorInstance
  }

  private wakeSchedulerNavigationStagedRunService(): WakeSchedulerNavigationStagedRunService {
    const now = this.runtimeWakeSchedulerNow ?? this.runtimeWakeScheduleNow ?? this.runtimeWakeNow ?? this.runtimeResumeNow ?? this.runtimeCheckpointNow ?? (() => new Date())
    this.wakeSchedulerNavigationStagedRunServiceInstance ??= new WakeSchedulerNavigationStagedRunService(
      this.eventStore,
      this.wakeSchedulerNavigationStagingService(),
      this.wakeSchedulerNavigationReadExecutor(),
      () => now().toISOString(),
    )
    return this.wakeSchedulerNavigationStagedRunServiceInstance
  }

  private wakeSchedulerNavigationStagedReadCompareService(): WakeSchedulerNavigationStagedReadCompareService {
    const now = this.runtimeWakeSchedulerNow ?? this.runtimeWakeScheduleNow ?? this.runtimeWakeNow ?? this.runtimeResumeNow ?? this.runtimeCheckpointNow ?? (() => new Date())
    this.wakeSchedulerNavigationStagedReadCompareServiceInstance ??= new WakeSchedulerNavigationStagedReadCompareService(
      this.eventStore,
      this.wakeSchedulerNavigationStagingService(),
      () => now().toISOString(),
    )
    return this.wakeSchedulerNavigationStagedReadCompareServiceInstance
  }

  private wakeSchedulerNavigationWritePreviewService(): WakeSchedulerNavigationWritePreviewService {
    const now = this.runtimeWakeSchedulerNow ?? this.runtimeWakeScheduleNow ?? this.runtimeWakeNow ?? this.runtimeResumeNow ?? this.runtimeCheckpointNow ?? (() => new Date())
    this.wakeSchedulerNavigationWritePreviewServiceInstance ??= new WakeSchedulerNavigationWritePreviewService(this.wakeSchedulerNavigationService(), () => now().toISOString())
    return this.wakeSchedulerNavigationWritePreviewServiceInstance
  }

  private wakeSchedulerNavigationWriteStagingService(): WakeSchedulerNavigationWriteStagingService {
    const now = this.runtimeWakeSchedulerNow ?? this.runtimeWakeScheduleNow ?? this.runtimeWakeNow ?? this.runtimeResumeNow ?? this.runtimeCheckpointNow ?? (() => new Date())
    this.wakeSchedulerNavigationWriteStagingServiceInstance ??= new WakeSchedulerNavigationWriteStagingService(
      this.eventStore,
      this.wakeSchedulerNavigationWritePreviewService(),
      () => now().toISOString(),
    )
    return this.wakeSchedulerNavigationWriteStagingServiceInstance
  }

  private wakeSchedulerNavigationLowRiskWriteExecutor(): WakeSchedulerNavigationLowRiskWriteExecutor {
    this.wakeSchedulerNavigationLowRiskWriteExecutorInstance ??= new WakeSchedulerNavigationLowRiskWriteExecutor(
      this.wakeScheduleService(),
      this.wakeSchedulerNavigationStagedRunService(),
    )
    return this.wakeSchedulerNavigationLowRiskWriteExecutorInstance
  }

  private wakeSchedulerNavigationWriteRunService(): WakeSchedulerNavigationWriteRunService {
    const now = this.runtimeWakeSchedulerNow ?? this.runtimeWakeScheduleNow ?? this.runtimeWakeNow ?? this.runtimeResumeNow ?? this.runtimeCheckpointNow ?? (() => new Date())
    this.wakeSchedulerNavigationWriteRunServiceInstance ??= new WakeSchedulerNavigationWriteRunService(
      this.eventStore,
      this.wakeSchedulerNavigationWriteStagingService(),
      this.wakeSchedulerNavigationLowRiskWriteExecutor(),
      () => now().toISOString(),
    )
    return this.wakeSchedulerNavigationWriteRunServiceInstance
  }

  private wakeSchedulerNavigationWriteRunCompareService(): WakeSchedulerNavigationWriteRunCompareService {
    const now = this.runtimeWakeSchedulerNow ?? this.runtimeWakeScheduleNow ?? this.runtimeWakeNow ?? this.runtimeResumeNow ?? this.runtimeCheckpointNow ?? (() => new Date())
    this.wakeSchedulerNavigationWriteRunCompareServiceInstance ??= new WakeSchedulerNavigationWriteRunCompareService(
      this.eventStore,
      this.wakeSchedulerNavigationWriteStagingService(),
      () => now().toISOString(),
    )
    return this.wakeSchedulerNavigationWriteRunCompareServiceInstance
  }

  private wakeSchedulerNavigationWriteApprovalService(): WakeSchedulerNavigationWriteApprovalService {
    const now = this.runtimeWakeSchedulerNow ?? this.runtimeWakeScheduleNow ?? this.runtimeWakeNow ?? this.runtimeResumeNow ?? this.runtimeCheckpointNow ?? (() => new Date())
    this.wakeSchedulerNavigationWriteApprovalServiceInstance ??= new WakeSchedulerNavigationWriteApprovalService(
      this.eventStore,
      this.wakeSchedulerNavigationWriteStagingService(),
      () => now().toISOString(),
    )
    return this.wakeSchedulerNavigationWriteApprovalServiceInstance
  }

  private wakeSchedulerNavigationCheckpointWriteExecutor(): WakeSchedulerNavigationCheckpointWriteExecutor {
    this.wakeSchedulerNavigationCheckpointWriteExecutorInstance ??= new WakeSchedulerNavigationCheckpointWriteExecutor(this.runtimeCheckpointService())
    return this.wakeSchedulerNavigationCheckpointWriteExecutorInstance
  }

  private wakeSchedulerNavigationCheckpointWriteRunService(): WakeSchedulerNavigationCheckpointWriteRunService {
    const now = this.runtimeWakeSchedulerNow ?? this.runtimeWakeScheduleNow ?? this.runtimeWakeNow ?? this.runtimeResumeNow ?? this.runtimeCheckpointNow ?? (() => new Date())
    this.wakeSchedulerNavigationCheckpointWriteRunServiceInstance ??= new WakeSchedulerNavigationCheckpointWriteRunService(
      this.eventStore,
      this.wakeSchedulerNavigationWriteStagingService(),
      this.wakeSchedulerNavigationWriteApprovalService(),
      this.wakeSchedulerNavigationCheckpointWriteExecutor(),
      () => now().toISOString(),
    )
    return this.wakeSchedulerNavigationCheckpointWriteRunServiceInstance
  }

  private wakeSchedulerNavigationCheckpointWriteCompareService(): WakeSchedulerNavigationCheckpointWriteCompareService {
    const now = this.runtimeWakeSchedulerNow ?? this.runtimeWakeScheduleNow ?? this.runtimeWakeNow ?? this.runtimeResumeNow ?? this.runtimeCheckpointNow ?? (() => new Date())
    this.wakeSchedulerNavigationCheckpointWriteCompareServiceInstance ??= new WakeSchedulerNavigationCheckpointWriteCompareService(
      this.eventStore,
      this.wakeSchedulerNavigationWriteStagingService(),
      () => now().toISOString(),
    )
    return this.wakeSchedulerNavigationCheckpointWriteCompareServiceInstance
  }

  private async executeContinuationReadCommand(command: string): Promise<unknown> {
    const [name, ...args] = command.trim().split(/\s+/)
    switch (name) {
      case "/reasoning":
        return { status: this.reasoningProviderStatus(), health: await this.reasoningProviderHealth() }
      case "/handoff-followups":
        return this.listOpenCodeHandoffFollowups({ limit: 20 })
      case "/handoff-active":
        return this.openCodeHandoffFollowupQueue("active", { limit: 20 })
      case "/handoff-results":
        return this.openCodeHandoffFollowupQueue("needs_result_review", { limit: 20 })
      case "/handoff-failed":
        return this.openCodeHandoffFollowupQueue("failed", { limit: 20 })
      case "/handoff-blocked":
        return this.openCodeHandoffFollowupQueue("blocked", { limit: 20 })
      case "/handoff-stale":
        return this.openCodeHandoffFollowupQueue("stale", { limit: 20 })
      case "/handoff-followup":
        return this.getOpenCodeHandoffFollowup(requiredString(args[0], "handoffId"))
      case "/queues":
        return this.commanderQueueSummary()
      case "/missions":
        return this.listRecentMissions(20)
      case "/cycles":
        return this.listCommanderCycles(20)
      case "/cycle-show":
        return this.getCommanderCycle(requiredString(args[0], "cycleId"))
      case "/syntheses":
        return this.listResearchSyntheses(20)
      case "/synthesis":
        return this.getResearchSynthesis(requiredString(args[0], "synthesisId"))
      case "/resume-anchors":
        return this.listCheckpointResumeAnchors(20)
      case "/resume-anchor":
        return this.getCheckpointResumeAnchor(requiredString(args[0], "resumeId"))
      case "/restore-preview":
        return this.previewCheckpointRestore({ checkpoint_id: requiredString(args[0], "checkpointId") })
      case "/checkpoints":
        return this.listRuntimeCheckpoints(20)
      case "/checkpoint-show":
        return this.getRuntimeCheckpoint(requiredString(args[0], "checkpointId"))
      case "/wakes":
        return this.listWakeAssessments(20)
      case "/wake-show":
        return this.getWakeAssessment(requiredString(args[0], "wakeId"))
      case "/mission":
        return this.getMission(requiredString(args[0], "missionId"))
      default:
        throw new Error("continuation read command is not supported")
    }
  }

  private async runtimeCheckpointSections(): Promise<RuntimeCheckpointSections> {
    const events = await this.eventStore.readAll()
    const lastEventId = events.at(-1)?.event_id
    const missionSummary = await this.missionRegistry.statusSummary()
    const recentMissions = await this.missionRegistry.listRecentMissions(10)
    const recentMissionDetails = []
    for (const mission of recentMissions.slice(0, 5)) {
      recentMissionDetails.push({
        mission_id: mission.mission_id,
        status: mission.status,
        updated_at: mission.updated_at,
        claims: (await this.missionRegistry.listMissionClaims(mission.mission_id)).slice(-5),
        progress: (await this.missionRegistry.listMissionProgress(mission.mission_id)).slice(-5),
        results: (await this.missionRegistry.listMissionResults(mission.mission_id)).slice(-5),
      })
    }
    const projection = this.safeResearchProjectionStatus()
    const research = this.safeResearchCheckpointSummary()
    const syntheses = await this.safeListResearchSyntheses(10)
    const cycles = await this.safeListCommanderCycles(10)
    const handoffSummary = await this.openCodeHandoffFollowupSummary().catch((error) => ({ error: error instanceof Error ? error.message : String(error) }))
    const handoffActive = await this.openCodeHandoffFollowupQueue("active", { limit: 10 }).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }))
    return redactValue({
      runtime: {
        mode: this.mode,
        started: this.started,
        run_lock_held: this.runLock.isHeld(),
        runtime_status_summary: this.started ? "started" : "created",
        event_count: events.length,
        last_event_id: typeof lastEventId === "string" ? lastEventId : undefined,
        projection_health: projection,
      },
      spec: {
        status: this.specSummary?.status ?? "unknown",
        objective_preview: this.specSummary?.objective,
        approved_by: this.specSummary?.approvedBy,
        approved_at: this.specSummary?.approvedAt,
      },
      reasoning: {
        status: this.reasoningProviderStatus(),
        health: this.reasoningProviderHealth(),
      },
      research: {
        projection,
        topics: research.topics,
        topic_count: research.topic_count,
        recent_syntheses: syntheses,
        recent_api_ingestions: await this.listExternalApiResearchIngestions(10).catch(() => []),
      },
      commander: {
        proposals: await this.proposalStatusSummary(),
        reviews: await this.reviewStatusSummary(),
        bundles: await this.proposalBundleStatusSummary(),
        playbook_drafts: await this.commanderPlaybookDraftStatusSummary(),
        recent_proposals: await this.listCommanderProposals({ limit: 10 }),
        recent_bundles: await this.listProposalBundles({ limit: 10 }),
        recent_playbook_drafts: await this.listCommanderPlaybookDrafts({ limit: 10 }),
        recent_cycles: cycles,
        recent_syntheses: syntheses,
        queues: await this.commanderQueueSummary().catch((error) => ({ error: error instanceof Error ? error.message : String(error) })),
      },
      executor: {
        missions: missionSummary,
        recent_missions: recentMissions,
        recent_mission_details: recentMissionDetails,
      },
      opencode: {
        adapter_status_available: false,
        adapter_status_reason: "checkpoint creation does not call adapter",
        executor_stream_error: this.executorStreamError ?? undefined,
      },
      handoff: {
        recent_handoffs: await this.listOpenCodeHandoffs(10),
        followup_summary: handoffSummary,
        active_queue: handoffActive,
        needs_result_review_queue: await this.openCodeHandoffFollowupQueue("needs_result_review", { limit: 10 }).catch((error) => ({ error: error instanceof Error ? error.message : String(error) })),
      },
    })
  }

  private safeResearchProjectionStatus(): RuntimeResearchProjectionHealth {
    try {
      return this.researchProjectionStatus()
    } catch (error) {
      return redactValue({
        ...this.researchProjectionHealth,
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private safeResearchCheckpointSummary(): { topics: Array<Record<string, unknown>>; topic_count: number } {
    try {
      if (this.researchProjectionMode === "disabled") return { topics: [], topic_count: 0 }
      const topics = this.getResearchDb().listTopics()
      return {
        topics: topics.slice(0, 10).map((topic) => ({
          id: topic.id,
          title: topic.title,
          status: topic.status,
          updated_at: topic.updated_at,
        })),
        topic_count: topics.length,
      }
    } catch {
      return { topics: [], topic_count: 0 }
    }
  }

  private async safeListResearchSyntheses(limit: number): Promise<ResearchSynthesisRecord[]> {
    try {
      return await this.listResearchSyntheses(limit)
    } catch {
      return []
    }
  }

  private async safeListCommanderCycles(limit: number): Promise<CommanderCycleRecord[]> {
    try {
      return await this.listCommanderCycles(limit)
    } catch {
      return []
    }
  }

  private externalApiRequestService(): ExternalApiRequestService {
    return new ExternalApiRequestService({
      registry: this.externalApiConnectorRegistry,
      transport: this.externalApiTransport,
      eventStore: this.eventStore,
      env: this.externalApiEnv,
      resolveHostAddresses: this.externalApiResolveHostAddresses,
      now: this.externalApiNow,
      requestId: this.externalApiRequestId,
    })
  }

  private createMiniMaxReasoningProvider(): ResearchSynthesisProvider & CommanderCycleProvider & CommanderExecutorReviewProvider {
    const connectorId = this.reasoningProviderConfig.connector_id
    const connector = connectorId ? this.externalApiConnectorRegistry.get(connectorId) : null
    if (!connectorId || !connector) {
      return new UnavailableReasoningProvider(this.reasoningProviderConfig.provider_id, `MiniMax reasoning provider connector not found: ${redactText(connectorId ?? "missing")}`)
    }
    return new MiniMaxReasoningProvider({
      config: this.reasoningProviderConfig,
      requestService: this.externalApiRequestService(),
      connector,
    })
  }

  private reasoningProviderHealthService(): ReasoningProviderHealthService {
    return new ReasoningProviderHealthService({
      config: this.reasoningProviderConfig,
      registry: this.externalApiConnectorRegistry,
      requestService: this.externalApiRequestService(),
      eventStore: this.eventStore,
      env: this.externalApiEnv,
      now: this.externalApiNow,
    })
  }

  private minimaxLiveValidationService(): MiniMaxLiveValidationService {
    this.minimaxLiveValidationServiceInstance ??= new MiniMaxLiveValidationService({
      eventStore: this.eventStore,
      config: this.reasoningProviderConfig,
      healthService: this.reasoningProviderHealthService(),
      env: this.externalApiEnv,
      now: this.externalApiNow,
      idFactory: this.externalApiRequestId ? () => `minimax_live_${this.externalApiRequestId?.()}` : undefined,
    })
    return this.minimaxLiveValidationServiceInstance
  }

  private externalApiResearchIngestionService(): ExternalApiResearchIngestionService {
    return new ExternalApiResearchIngestionService({
      registry: this.externalApiConnectorRegistry,
      requestService: this.externalApiRequestService(),
      eventStore: this.eventStore,
      researchDb: this.getResearchDb(),
      now: this.externalApiNow,
      ingestionId: this.externalApiRequestId ? () => `ingest_${this.externalApiRequestId?.()}` : undefined,
    })
  }

  private researchSynthesisService(): ResearchSynthesisService {
    return new ResearchSynthesisService({
      eventStore: this.eventStore,
      researchDb: this.getResearchDb() as ResearchSynthesisDbWriter,
      proposalRegistry: this.proposalRegistry,
      provider: this.researchSynthesisProvider,
      now: this.researchSynthesisNow,
      synthesisId: this.researchSynthesisId,
    })
  }

  private researchMemoryService(): ResearchMemoryService {
    this.researchMemoryServiceInstance ??= new ResearchMemoryService({
      readAdapter: () => this.researchMemoryReadAdapter(),
      now: this.researchSynthesisNow,
    })
    return this.researchMemoryServiceInstance
  }

  private researchNoveltyService(): ResearchNoveltyService {
    this.researchNoveltyServiceInstance ??= new ResearchNoveltyService({
      memoryService: this.researchMemoryService(),
      now: this.researchSynthesisNow,
    })
    return this.researchNoveltyServiceInstance
  }

  private commanderContinuityService(): CommanderContinuityService {
    this.commanderContinuityServiceInstance ??= new CommanderContinuityService({
      opencodeSessionService: this.opencodeSessionService(),
      launchGateService: this.opencodeLaunchGateService(),
      progressService: this.opencodeProgressService(),
      watchdogService: this.opencodeTimeoutWatchdogService(),
      questionService: this.opencodeCommanderQuestionService(),
      guidanceService: this.commanderGuidanceService(),
      guidanceDeliveryService: this.commanderGuidanceDeliveryService(),
      humanControlService: this.opencodeHumanControlService(),
      wakeSupervisorService: this.opencodeWakeSupervisorService(),
      wakeExecutionService: this.opencodeWakeSupervisorExecutionService(),
      wakeActionExecutionService: this.opencodeWakeActionExecutionService(),
      resultReportService: this.opencodeResultReportService(),
      resultReviewService: this.opencodeResultReviewService(),
      researchIngestionService: this.researchIngestionReadService(),
      researchMemoryService: this.researchMemoryService(),
      now: this.researchSynthesisNow,
    })
    return this.commanderContinuityServiceInstance
  }

  private commanderToolService(): CommanderToolService {
    this.commanderToolServiceInstance ??= new CommanderToolService({
      contextBudgetService: this.contextBudgetService(),
      now: this.researchSynthesisNow,
    })
    return this.commanderToolServiceInstance
  }

  private commanderOperationalMemorySearchService(): CommanderOperationalMemorySearchService {
    this.commanderOperationalMemorySearchServiceInstance ??= new CommanderOperationalMemorySearchService({
      now: this.researchSynthesisNow,
      collectRecords: (input) => this.collectCommanderOperationalMemoryRecords(input),
    })
    return this.commanderOperationalMemorySearchServiceInstance
  }

  private commanderRepoReadService(): CommanderRepoReadService {
    this.commanderRepoReadServiceInstance ??= new CommanderRepoReadService({
      projectDir: this.projectDir,
      now: this.researchSynthesisNow,
    })
    return this.commanderRepoReadServiceInstance
  }

  private commanderGithubReadService(): CommanderGithubReadService | undefined {
    if (!this.commanderGithubGatewayConfig) return undefined
    const connector = this.externalApiConnectorRegistry.get(this.commanderGithubGatewayConfig.connector_id)
    if (!connector) return undefined
    this.commanderGithubReadServiceInstance ??= new CommanderGithubReadService({
      requestService: this.externalApiRequestService(),
      connector,
      config: this.commanderGithubGatewayConfig,
      credentialsReady: (connector.credential_refs ?? []).every((ref) => Boolean(this.externalApiEnv[ref.env_name])),
      now: this.researchSynthesisNow,
    })
    return this.commanderGithubReadServiceInstance
  }

  private commanderGithubGatewayStatus(): CommanderGithubGatewayStatus {
    const generatedAt = (this.researchSynthesisNow?.() ?? new Date()).toISOString()
    const blocked = (blocker: string, repositoryCount = 0, repositories: string[] = []) => ({
      status: "blocked" as const,
      connector_id: this.commanderGithubGatewayConfig?.connector_id,
      repository_count: repositoryCount,
      repositories,
      blockers: [redactText(blocker)],
      warnings: ["GitHub evidence is untrusted data and cannot alter runtime authority."],
      generated_at: generatedAt,
    })
    if (!this.commanderGithubGatewayConfig) return blocked("GitHub read gateway is not configured")
    const repositories = [...this.commanderGithubGatewayConfig.allowed_repositories]
    if (!this.externalApiConnectorRegistry.get(this.commanderGithubGatewayConfig.connector_id)) {
      return blocked("configured Commander GitHub gateway connector was not found", repositories.length, repositories)
    }
    try {
      return this.commanderGithubReadService()?.status() ?? blocked("configured Commander GitHub gateway is unavailable", repositories.length, repositories)
    } catch (error) {
      return blocked(error instanceof Error ? error.message : "configured Commander GitHub gateway policy is invalid", repositories.length, repositories)
    }
  }

  private readyCommanderGithubReadService(): CommanderGithubReadService | undefined {
    try {
      return this.commanderGithubReadService()
    } catch {
      return undefined
    }
  }

  private commanderToolBindingRegistry(): CommanderToolBindingRegistry {
    this.commanderToolBindingRegistryInstance ??= createCommanderToolBindingRegistry({
      commanderToolService: this.commanderToolService(),
      commandAuthorityService: new CommandAuthorityService(this.researchSynthesisNow ? () => this.researchSynthesisNow!().toISOString() : undefined),
      researchMemoryService: this.researchMemoryService(),
      operationalMemorySearchService: this.commanderOperationalMemorySearchService(),
      repoReadService: this.commanderRepoReadService(),
      githubReadService: this.readyCommanderGithubReadService(),
    })
    return this.commanderToolBindingRegistryInstance
  }

  private commanderToolExecutor(): CommanderToolExecutor {
    this.commanderToolExecutorInstance ??= new CommanderToolExecutor({
      descriptors: COMMANDER_TOOL_REGISTRY,
      authorityRecords: COMMAND_AUTHORITY_REGISTRY,
      bindingRegistry: this.commanderToolBindingRegistry(),
      runtimeAuthority: () => ({
        active_runtime: this.mode === "active" && this.started && this.lifecycleState === "ready" && !this.lifecycleShutdownRequested,
        run_lock_held: this.runLock.isHeld(),
      }),
      now: this.researchSynthesisNow,
    })
    return this.commanderToolExecutorInstance
  }

  private commanderInvestigationBootstrapService(): CommanderInvestigationBootstrapService {
    this.commanderInvestigationBootstrapServiceInstance ??= new CommanderInvestigationBootstrapService({
      continuityService: this.commanderContinuityService(),
      now: this.researchSynthesisNow,
    })
    return this.commanderInvestigationBootstrapServiceInstance
  }

  private commanderInvestigationContextService(): CommanderInvestigationContextService {
    this.commanderInvestigationContextServiceInstance ??= new CommanderInvestigationContextService()
    return this.commanderInvestigationContextServiceInstance
  }

  private commanderInvestigationController(persistenceObserver?: import("./commander-agent").CommanderInvestigationPersistenceObserver): CommanderInvestigationController {
    if (persistenceObserver) return this.createCommanderInvestigationController(persistenceObserver)
    this.commanderInvestigationControllerInstance ??= new CommanderInvestigationController({
      ...this.commanderInvestigationControllerOptions(),
    })
    return this.commanderInvestigationControllerInstance
  }

  private createCommanderInvestigationController(persistenceObserver?: import("./commander-agent").CommanderInvestigationPersistenceObserver): CommanderInvestigationController {
    return new CommanderInvestigationController({
      ...this.commanderInvestigationControllerOptions(),
      persistenceObserver,
    })
  }

  private commanderInvestigationControllerOptions(): ConstructorParameters<typeof CommanderInvestigationController>[0] {
    return {
      modelAdapter: this.commanderModelStepAdapter,
      toolExecutor: this.commanderToolExecutor(),
      toolService: this.commanderToolService(),
      descriptors: COMMANDER_TOOL_REGISTRY,
      boundToolIds: this.commanderToolBindingRegistry().validation_summary.tool_ids,
      bootstrapService: this.commanderInvestigationBootstrapService(),
      contextService: this.commanderInvestigationContextService(),
      controlGate: this.commanderInvestigationControlGate ?? this.defaultCommanderInvestigationControlGate(),
      providerGate: this.commanderInvestigationProviderConfig ? this.defaultCommanderInvestigationProviderGate() : undefined,
      providerAuditPolicy: this.commanderInvestigationProviderConfig ? { required: true, transport_kind: "external_api_connector", connector_id: this.commanderInvestigationProviderConfig.connector_id } : { required: false, transport_kind: "none" },
      capabilityRegistry: this.modelCapabilityRegistry,
      contextBudgetService: this.contextBudgetService(),
      recoverySource: (investigationId) => this.commanderInvestigationJournalService().recoverySource(investigationId),
      now: this.researchSynthesisNow,
    }
  }

  private commanderInvestigationJournalService(): CommanderInvestigationJournalService {
    this.commanderInvestigationJournalServiceInstance ??= new CommanderInvestigationJournalService({
      eventStore: this.eventStore,
      now: this.researchSynthesisNow,
    })
    return this.commanderInvestigationJournalServiceInstance
  }

  private commanderInvestigationRecoveryService(): CommanderInvestigationRecoveryService {
    this.commanderInvestigationRecoveryServiceInstance ??= new CommanderInvestigationRecoveryService({
      recoverySource: ({ investigation_id }) => this.commanderInvestigationJournalService().recoverySource(investigation_id),
      descriptors: COMMANDER_TOOL_REGISTRY,
      boundToolIds: this.commanderToolBindingRegistry().validation_summary.tool_ids,
      providerReadiness: (input) => this.previewCommanderInvestigationProviderReadiness(input),
      providerExecutionEnvelope: (input) => this.commanderInvestigationRecoveryExecutionEnvelope(input),
      githubGatewayStatus: () => this.commanderGithubGatewayStatus(),
      modelCapability: (input) => this.modelCapabilityRegistry.get(input),
      currentProfile: (input) => this.commanderToolService().profile(input),
      currentContextBudget: async (input) => {
        const preview = await this.contextBudgetService().preview({
          purpose: "commander_research_decision",
          role: "commander",
          provider_kind: input.provider_kind,
          model_id: input.model_id,
          max_context_tokens: input.max_context_tokens,
          max_context_bytes: input.max_context_bytes,
        })
        const allocation = preview.budget.allocations.find((item) => item.section === "tool_or_mcp_schema")
        const inputContextBytes = preview.budget.max_context_bytes === undefined
          ? undefined
          : Math.max(0, preview.budget.max_context_bytes - (preview.budget.safety_margin_bytes ?? 0))
        const inputContextTokens = preview.budget.max_context_tokens === undefined
          ? undefined
          : Math.max(0, preview.budget.max_context_tokens - (preview.budget.max_output_tokens ?? 0) - (preview.budget.safety_margin_tokens ?? 0))
        return {
          context_budget_id: preview.budget.budget_id,
          input_context_bytes: inputContextBytes,
          input_context_tokens: inputContextTokens,
          tool_schema_allocation_bytes: allocation?.max_bytes,
          tool_schema_allocation_tokens: allocation?.max_tokens,
          blockers: preview.blockers,
          warnings: preview.warnings,
        }
      },
      currentBootstrap: (input) => this.commanderInvestigationBootstrapService().compile(input),
      currentHumanControl: (input) => this.readDurableCommanderInvestigationControl({
        phase: input.phase,
        session_id: input.session_id,
        launch_id: input.launch_id,
        before: "model_step",
        turn_index: 0,
      }),
      continuationBuilder: this.commanderInvestigationRecoveryContinuationBuilderOptions(),
      now: this.researchSynthesisNow,
    })
    return this.commanderInvestigationRecoveryServiceInstance
  }

  private commanderInvestigationRecoveryContinuationBuilderOptions(options?: { includeProviderPreflight?: boolean }) {
    return {
      descriptors: COMMANDER_TOOL_REGISTRY,
      currentBootstrap: (input: Omit<CommanderInvestigationInput, "abort_signal">) => this.commanderInvestigationBootstrapService().compile(input),
      contextService: this.commanderInvestigationContextService(),
      modelOutputTokens: (input: { provider_kind: string; model_id: string }) => {
        const capability = this.modelCapabilityRegistry.get({ provider_kind: input.provider_kind, model_id: input.model_id, role: "commander" })
        return Math.min(1024, capability.max_output_tokens ?? 1024)
      },
      currentHumanControl: (input: { phase: CommanderToolPhase; session_id?: string; launch_id?: string; turn_index: number }) => this.readDurableCommanderInvestigationControl({
        phase: input.phase,
        session_id: input.session_id,
        launch_id: input.launch_id,
        before: "model_step",
        turn_index: input.turn_index,
      }),
      providerPreflight: options?.includeProviderPreflight ? async (input: { phase: CommanderToolPhase; provider_id: string; provider_kind: string; model_id: string; turn_index: number }) => this.commanderInvestigationProviderConfig
        ? this.defaultCommanderInvestigationProviderGate().check({
          phase: input.phase,
          provider_id: input.provider_id,
          provider_kind: input.provider_kind,
          model_id: input.model_id,
          before: "model_step",
          turn_index: input.turn_index,
        })
        : undefined : undefined,
    }
  }

  private commanderInvestigationRecoveryApprovalService(): CommanderInvestigationRecoveryApprovalService {
    this.commanderInvestigationRecoveryApprovalServiceInstance ??= new CommanderInvestigationRecoveryApprovalService({
      recoveryPreview: (input) => this.commanderInvestigationRecoveryService().preview(input),
      recoverySource: (investigationId) => this.commanderInvestigationJournalService().recoverySource(investigationId),
      journalService: this.commanderInvestigationJournalService(),
      now: this.researchSynthesisNow,
    })
    return this.commanderInvestigationRecoveryApprovalServiceInstance
  }

  private commanderInvestigationRecoveryOperatorService(): CommanderInvestigationRecoveryOperatorService {
    this.commanderInvestigationRecoveryOperatorServiceInstance ??= new CommanderInvestigationRecoveryOperatorService(
      this.commanderInvestigationJournalService(),
      this.researchSynthesisNow,
    )
    return this.commanderInvestigationRecoveryOperatorServiceInstance
  }

  private commanderInvestigationRecoveryExecutionService(): CommanderInvestigationRecoveryExecutionService {
    this.commanderInvestigationRecoveryExecutionServiceInstance ??= new CommanderInvestigationRecoveryExecutionService({
      recoveryPreview: (input) => this.commanderInvestigationRecoveryService().preview(input),
      recoverySource: (investigationId) => this.commanderInvestigationJournalService().recoverySource(investigationId),
      continuationBuilder: new CommanderInvestigationRecoveryContinuationBuilder(this.commanderInvestigationRecoveryContinuationBuilderOptions({ includeProviderPreflight: true })),
      now: this.researchSynthesisNow,
    })
    return this.commanderInvestigationRecoveryExecutionServiceInstance
  }

  private commanderInvestigationRecoveryTransactionService(): CommanderInvestigationRecoveryTransactionService {
    const config = this.commanderInvestigationProviderConfig
    if (!config) throw new Error("configured Commander recovery transaction requires provider config")
    this.commanderInvestigationRecoveryTransactionServiceInstance ??= new CommanderInvestigationRecoveryTransactionService({
      recoveryPreview: (input) => this.commanderInvestigationRecoveryService().preview(input),
      recoveryExecutionService: this.commanderInvestigationRecoveryExecutionService(),
      recoverySource: (investigationId) => this.commanderInvestigationJournalService().recoverySource(investigationId),
      journalService: this.commanderInvestigationJournalService(),
      executionMode: {
        kind: "configured_connector",
        execution_transport: "configured_connector_provider",
        connector_id: config.connector_id,
        provider_audit_required: true,
      },
      continuationRunner: {
        run: ({ seed, persistence_observer, abort_signal }) => this.createCommanderInvestigationController(persistence_observer).runFromRecoverySeed(seed, { abort_signal }),
      },
      onPersistenceRun: (run) => {
        for (const active of this.activeConfiguredCommanderRecoveries) {
          if (active.investigation_id === run.investigation_id) active.run = run
        }
      },
      onPersistenceRunReleased: (run) => {
        for (const active of this.activeConfiguredCommanderRecoveries) {
          if (active.run === run) active.run = undefined
        }
      },
      now: this.researchSynthesisNow,
    })
    return this.commanderInvestigationRecoveryTransactionServiceInstance
  }

  private createConfiguredCommanderModelStepAdapter(): CommanderModelStepAdapter | undefined {
    const config = this.commanderInvestigationProviderConfig
    if (!config) return undefined
    return new ConnectorBackedCommanderModelStepAdapter({
      config: {
        transport_kind: config.transport_kind,
        provider_id: config.provider_id,
        connector_id: config.connector_id,
        model_id: config.model_id,
        timeout_ms: config.timeout_ms,
        max_request_bytes: config.max_request_bytes,
        max_response_bytes: config.max_response_bytes,
      },
      registry: this.externalApiConnectorRegistry,
      requestService: this.externalApiRequestService(),
      now: this.externalApiNow,
    })
  }

  private commanderInvestigationRecoveryExecutionEnvelope(input: CommanderInvestigationProviderReadinessInput): CommanderInvestigationRecoveryExecutionEnvelope | undefined {
    const config = this.commanderInvestigationProviderConfig
    if (!config) return undefined
    const connector = this.externalApiConnectorRegistry.get(config.connector_id)
    const capability = this.modelCapabilityRegistry.get({ provider_kind: config.provider_kind, model_id: config.model_id, role: "commander" })
    const openAiConnectorPolicy = {
      connector_id: config.connector_id,
      chat_completions_url: connector ? connectorChatCompletionsUrl(connector).toString() : undefined,
      allowed_hosts: connector?.allowed_hosts.slice().sort() ?? [],
      allowed_methods: connector?.allowed_methods.slice().sort() ?? [],
      default_headers: Object.entries(connector?.default_headers ?? {}).sort(([a], [b]) => a.localeCompare(b)),
      credential_ref_injection_shape: (connector?.credential_refs ?? []).map((ref) => ({ source: ref.source, inject_as: ref.inject_as, target_name: ref.target_name, prefix: ref.prefix })).sort((a, b) => `${a.inject_as}:${a.target_name}`.localeCompare(`${b.inject_as}:${b.target_name}`)),
      connector_timeout_ms: connector?.timeout_ms,
      connector_max_response_bytes: connector?.max_response_bytes,
      allow_local_http: connector?.allow_local_http === true,
    }
    const anthropicConnectorPolicy = {
      connector_id: config.connector_id,
      messages_url: connector ? connectorModelRequestUrl(connector, config.transport_kind).toString() : undefined,
      allowed_hosts: connector?.allowed_hosts.slice().sort() ?? [],
      allowed_methods: connector?.allowed_methods.slice().sort() ?? [],
      default_headers: Object.entries(connector?.default_headers ?? {}).sort(([a], [b]) => a.localeCompare(b)),
      credential_ref_injection_shape: (connector?.credential_refs ?? []).map((ref) => ({ source: ref.source, inject_as: ref.inject_as, target_name: ref.target_name, prefix: ref.prefix })).sort((a, b) => `${a.inject_as}:${a.target_name}`.localeCompare(`${b.inject_as}:${b.target_name}`)),
      connector_timeout_ms: connector?.timeout_ms,
      connector_max_response_bytes: connector?.max_response_bytes,
      allow_local_http: connector?.allow_local_http === true,
      anthropic_version: ANTHROPIC_MESSAGES_PROTOCOL_VERSION,
      provider_adapter_version: ANTHROPIC_MESSAGES_PROVIDER_ADAPTER_VERSION,
      request_shape_policy_version: ANTHROPIC_MESSAGES_REQUEST_SHAPE_POLICY_VERSION,
      beta_headers_allowed: false,
      server_tools_allowed: false,
    }
    const connectorPolicyHash = stableHash(config.transport_kind === "openai_compatible_connector" ? openAiConnectorPolicy : anthropicConnectorPolicy)
    const capabilityEnvelopeHash = stableHash({
      provider_kind: capability.provider_kind,
      provider_id: capability.provider_id,
      model_id: capability.model_id,
      role_support: capability.role_support.slice().sort(),
      max_context_bytes: capability.max_context_bytes,
      max_context_tokens: capability.max_context_tokens,
      max_output_tokens: capability.max_output_tokens,
      supports_tools: capability.supports_tools,
      supports_json_schema: capability.supports_json_schema,
      supports_mcp: capability.supports_mcp,
      supports_long_context: capability.supports_long_context,
      supports_streaming: capability.supports_streaming,
      supports_local_execution: capability.supports_local_execution,
      safety_margin_ratio: capability.safety_margin_ratio,
      source: capability.source,
    })
    const envelope: CommanderInvestigationRecoveryExecutionEnvelope = {
      envelope_version: 1 as const,
      transport_kind: config.transport_kind,
      provider_id: config.provider_id,
      provider_kind: config.provider_kind,
      connector_id: config.connector_id,
      model_id: config.model_id,
      timeout_ms: config.timeout_ms,
      max_request_bytes: config.max_request_bytes,
      max_response_bytes: config.max_response_bytes,
      max_context_bytes: config.max_context_bytes,
      max_context_tokens: config.max_context_tokens,
      max_output_tokens: config.max_output_tokens,
      supports_tools: config.supports_tools,
      supports_json_schema: config.supports_json_schema,
      supports_long_context: config.supports_long_context,
      supports_local_execution: config.supports_local_execution,
      supports_streaming: false as const,
      connector_policy_hash: connectorPolicyHash,
      ...(config.transport_kind === "anthropic_messages_connector" ? {
        provider_adapter_version: ANTHROPIC_MESSAGES_PROVIDER_ADAPTER_VERSION,
        request_shape_policy_version: ANTHROPIC_MESSAGES_REQUEST_SHAPE_POLICY_VERSION,
      } : {}),
      github_gateway_policy_hash: this.commanderGithubGatewayStatus().transport_policy_hash,
      capability_envelope_hash: capabilityEnvelopeHash,
      execution_envelope_hash: "",
    }
    envelope.execution_envelope_hash = stableHash({ ...envelope, execution_envelope_hash: "" })
    return redactValue(envelope)
  }

  private defaultCommanderInvestigationProviderGate(): CommanderInvestigationProviderGate {
    return {
      check: (input) => this.checkCommanderInvestigationProvider(input),
    }
  }

  private checkCommanderInvestigationProvider(input: Parameters<CommanderInvestigationProviderGate["check"]>[0]): CommanderInvestigationProviderPreflightSnapshot {
    const readiness = this.previewCommanderInvestigationProviderReadiness({
      phase: input.phase,
      provider_id: input.provider_id,
      provider_kind: input.provider_kind,
      model_id: input.model_id,
    })
    const snapshot: CommanderInvestigationProviderPreflightSnapshot = {
      ready: readiness.execution_ready,
      source_kind: readiness.provider_source,
      checks: readiness.checks.slice(0, 24),
      blockers: readiness.blockers.slice(0, 12),
      warnings: readiness.warnings.slice(0, 12),
      checked_at: (this.researchSynthesisNow?.() ?? new Date()).toISOString(),
      snapshot_hash: "",
    }
    snapshot.snapshot_hash = stableHash({ ...snapshot, checked_at: "", snapshot_hash: "" })
    return snapshot
  }

  private defaultCommanderInvestigationControlGate(): CommanderInvestigationControlGate {
    return {
      check: async (input) => this.readDurableCommanderInvestigationControl(input),
    }
  }

  private async readDurableCommanderInvestigationControl(input: Parameters<CommanderInvestigationControlGate["check"]>[0]): Promise<CommanderInvestigationControlSnapshot> {
    const checkedAt = (this.researchSynthesisNow?.() ?? new Date()).toISOString()
    if (!input.session_id && !input.launch_id) return { action: "continue", source_kind: "default", checked_at: checkedAt, warnings: [] }
    try {
      const effective = await this.effectiveOpenCodeHumanControl({ session_id: input.session_id, launch_id: input.launch_id })
      if (!effective) return { action: "continue", source_kind: "human_control", checked_at: checkedAt, warnings: [] }
      const action = investigationControlActionForProjection(effective.projected_state_after)
      const summary = humanControlSummaryPreview(effective)
      const warnings = investigationControlWarnings(effective.projected_state_after, [])
      return {
        action,
        control_id: effective.control_id,
        source_kind: "human_control",
        summary_preview: summary,
        projected_state: effective.projected_state_after,
        checked_at: checkedAt,
        warnings,
      }
    } catch (error) {
      return {
        action: "needs_human_review",
        source_kind: "human_control",
        summary_preview: `durable human-control inspection failed: ${redactText(error instanceof Error ? error.message : String(error)).slice(0, 200)}`,
        projected_state: "escalated",
        checked_at: checkedAt,
        warnings: ["human-control inspection failed closed; investigation was not allowed to continue"],
      }
    }
  }

  private async effectiveOpenCodeHumanControl(input: { session_id?: string; launch_id?: string }): Promise<OpenCodeHumanControlRecord | undefined> {
    let sessionId = input.session_id
    if (!sessionId && input.launch_id) {
      const launch = await this.getOpenCodeSessionLaunch(input.launch_id)
      if (!launch) throw new Error("launch_id could not be resolved for durable human-control inspection")
      sessionId = launch.session_id
    }
    const records = sessionId && input.launch_id
      ? (await this.opencodeHumanControlService().listAll({ session_id: sessionId }))
        .filter((record) => !record.launch_id || record.launch_id === input.launch_id)
        .slice(0, 100)
      : await this.listOpenCodeHumanControls({ ...input, session_id: sessionId, limit: 100 })
    return records.find((record) => record.projected_state_after !== "noted") ?? records[0]
  }

  private async collectCommanderOperationalMemoryRecords(input: CommanderOperationalMemorySearchInput = {}): Promise<CommanderOperationalMemoryRecord[]> {
    const requestedSourceKinds = operationalMemorySourceKinds(input.source_kinds)
    if (requestedSourceKinds.length === 1 && requestedSourceKinds[0] === "commander_investigation") {
      return this.collectCommanderInvestigationOperationalMemoryRecords(input)
    }
    const records: CommanderOperationalMemoryRecord[] = []
    const push = (record: CommanderOperationalMemoryRecord | null | undefined) => { if (record) records.push(record) }
    const missions = await this.listRecentMissions(100)
    for (const mission of missions) {
      push({ source_kind: "mission", source_id: mission.mission_id, label: "mission", status: mission.status, summary_preview: mission.objective, mission_id: mission.mission_id, occurred_at: mission.updated_at ?? mission.created_at, fields: { objective: mission.objective, intent_id: mission.intent_id } })
    }
    const proposals = await this.listCommanderProposals({ limit: 100 })
    for (const proposal of proposals) {
      push({ source_kind: "proposal", source_id: proposal.proposal_id, label: "proposal", status: proposal.status, summary_preview: `${proposal.title}: ${proposal.summary}`, mission_id: proposal.mission_id, occurred_at: proposal.updated_at ?? proposal.created_at, fields: { action_kind: proposal.action_kind, proposed_by: proposal.proposed_by } })
    }
    const reviews = await this.listReviewRequests({ limit: 100 })
    for (const review of reviews) {
      push({ source_kind: "proposal_review", source_id: review.review_id, label: "review", status: review.status, summary_preview: `${review.title}: ${review.summary}`, mission_id: review.mission_id, occurred_at: review.updated_at ?? review.created_at, fields: { request_type: review.request_type, requested_by: review.requested_by } })
    }
    const sessions = await this.listOpenCodeSessions({ limit: 100 })
    for (const session of sessions) {
      push({ source_kind: "opencode_session", source_id: session.session_id, label: "OpenCode session", status: session.status, summary_preview: session.summary_preview, session_id: session.session_id, mission_id: session.mission_id, occurred_at: session.updated_at ?? session.created_at, fields: { source_kind: session.source_kind, proposal_id: session.proposal_id, title: session.title } })
    }
    const launches = await this.listOpenCodeSessionLaunches({ limit: 100 })
    for (const launchRecord of launches) {
      const launch = await this.getOpenCodeSessionLaunch(launchRecord.launch_id)
      push({ source_kind: "opencode_launch", source_id: launchRecord.launch_id, label: "OpenCode launch", status: launchRecord.status, summary_preview: `launch ${launchRecord.launch_id} for session ${launch?.session_id ?? "unknown"}; mode ${launch?.launch_mode ?? "unknown"}`, session_id: launch?.session_id, launch_id: launchRecord.launch_id, occurred_at: launch?.started_at, fields: { launch_mode: launch?.launch_mode, native_session_id: launch?.native_session_id } })
    }
    for (const progress of await this.listOpenCodeProgress({ limit: 100 })) {
      const full = await this.getOpenCodeProgress(progress.progress_id)
      push({ source_kind: "opencode_progress", source_id: progress.progress_id, label: "OpenCode progress", status: progress.execution_state, summary_preview: full?.report_summary_preview ?? progress.report_summary_preview, session_id: progress.session_id, launch_id: progress.launch_id, occurred_at: progress.recorded_at, fields: { kind: progress.kind, current_step: full?.current_step_preview, question: full?.question_preview, next_action: full?.next_action_preview, files: full?.files_touched_preview.join(" "), tests: full?.tests_run_preview.join(" "), blockers: full?.blockers_preview.join(" ") } })
    }
    for (const watchdog of await this.listOpenCodeWatchdogs({ limit: 100 })) push({ source_kind: "opencode_watchdog", source_id: watchdog.watchdog_id, label: "OpenCode watchdog", status: watchdog.watchdog_status, summary_preview: `watchdog ${watchdog.watchdog_status}; recommended ${watchdog.recommended_action}`, session_id: watchdog.session_id, launch_id: watchdog.launch_id, occurred_at: watchdog.recorded_at, fields: { recommendation: watchdog.recommended_action } })
    for (const question of await this.listOpenCodeCommanderQuestions({ limit: 100 })) push({ source_kind: "commander_question", source_id: question.question_id, label: "Commander question", status: question.status, summary_preview: question.question_preview, session_id: question.session_id, launch_id: question.launch_id, occurred_at: question.created_at, fields: { urgency: question.urgency, question_type: question.question_type } })
    for (const guidance of await this.listCommanderGuidance({ limit: 100 })) push({ source_kind: "commander_guidance", source_id: guidance.guidance_id, label: "Commander guidance", status: guidance.status, summary_preview: guidance.answer_preview, session_id: guidance.session_id, launch_id: guidance.launch_id, occurred_at: guidance.created_at, fields: { delivery_status: guidance.delivery_status, guidance_scope: guidance.guidance_scope } })
    for (const delivery of await this.listCommanderGuidanceDeliveries({ limit: 100 })) push({ source_kind: "guidance_delivery", source_id: delivery.delivery_id, label: "Guidance delivery", status: delivery.status, summary_preview: delivery.summary_preview, session_id: delivery.session_id, launch_id: delivery.launch_id, occurred_at: delivery.created_at, fields: { delivery_mode: delivery.delivery_mode, guidance_id: delivery.guidance_id } })
    for (const control of await this.listOpenCodeHumanControls({ limit: 100 })) push({ source_kind: "human_control", source_id: control.control_id, label: "Human control", status: control.projected_state_after, summary_preview: control.human_note_preview ?? `${control.control_kind} ${control.projected_state_after}`, session_id: control.session_id, launch_id: control.launch_id, occurred_at: control.recorded_at, fields: { control_kind: control.control_kind, urgency: control.urgency } })
    for (const wake of await this.listOpenCodeWakeSupervisorExecutions({ limit: 100 })) push({ source_kind: "wake_execution", source_id: wake.execution_id, label: "Wake execution", status: wake.action_execution_status, summary_preview: wake.summary_preview, session_id: wake.session_id, launch_id: wake.launch_id, occurred_at: wake.recorded_at, fields: { recommended_action: wake.recommended_action, execution_mode: wake.execution_mode } })
    for (const action of await this.listOpenCodeWakeActionExecutions({ limit: 100 })) push({ source_kind: "wake_action", source_id: action.action_execution_id, label: "Wake action", status: action.status, summary_preview: action.summary_preview, session_id: action.session_id, launch_id: action.launch_id, occurred_at: action.recorded_at, fields: { action_kind: action.action_kind, effect_kind: action.effect_kind } })
    for (const report of await this.listOpenCodeResultReports({ limit: 100 })) push({ source_kind: "result_report", source_id: report.report_id, label: "Result report", status: report.review_state, summary_preview: report.summary_preview, session_id: report.session_id, launch_id: report.launch_id, occurred_at: report.recorded_at, fields: { result_kind: report.result_kind, result_disposition: report.result_disposition } })
    for (const review of await this.listOpenCodeResultReviews({ limit: 100 })) push({ source_kind: "result_review", source_id: review.review_id, label: "Result review", status: review.review_disposition, summary_preview: `${review.decision}: ${review.rationale_preview}`, session_id: review.session_id, launch_id: review.launch_id, occurred_at: review.recorded_at, fields: { decision: review.decision, next_step: review.next_step, report_id: review.report_id } })
    for (const ingestion of await this.listResearchIngestions({ limit: 100 })) push({ source_kind: "research_ingestion", source_id: ingestion.ingestion_id, label: "Research ingestion", status: ingestion.research_db_written ? "research_db_written" : "not_written", summary_preview: ingestion.research_title_preview, session_id: ingestion.session_id, launch_id: ingestion.launch_id, occurred_at: ingestion.recorded_at, fields: { evidence_kind: ingestion.evidence_kind, review_id: ingestion.review_id, report_id: ingestion.report_id } })
    for (const refresh of await this.listOpenCodeContextRefreshes({ limit: 100 })) push({ source_kind: "context_refresh", source_id: refresh.refresh_id, label: "Context refresh", status: refresh.status, summary_preview: refresh.summary_preview, session_id: refresh.target_session_id, launch_id: refresh.launch_id, occurred_at: refresh.written_at, fields: { mode: refresh.continuity_mode, packet_kind: refresh.packet_kind, previous_refresh_id: refresh.previous_refresh_id } })
    records.push(...await this.collectCommanderInvestigationOperationalMemoryRecords(input))
    return records
  }

  private async collectCommanderInvestigationOperationalMemoryRecords(input: CommanderOperationalMemorySearchInput = {}): Promise<CommanderOperationalMemoryRecord[]> {
    const records: CommanderOperationalMemoryRecord[] = []
    const push = (record: CommanderOperationalMemoryRecord | null | undefined) => { if (record) records.push(record) }
    const statuses = operationalMemoryStatuses(input.statuses)
    for (const investigation of await this.commanderInvestigationJournalService().listForOperationalMemorySearch({
      limit: 800,
      session_id: input.session_id,
      mission_id: input.mission_id,
      statuses,
    })) {
      if (investigation.projection_status !== "ready") continue
      push({
        source_kind: "commander_investigation",
        source_id: investigation.investigation_id,
        label: "Commander investigation",
        status: investigation.status,
        summary_preview: [
          investigation.objective_preview,
          `phase ${investigation.phase}`,
          investigation.stop_reason ? `stop ${investigation.stop_reason}` : "running",
          ...investigation.evidence_previews.map((preview) => `evidence ${preview}`),
          `evidence ${investigation.evidence_count}`,
          `recovery ${investigation.recovery_state}`,
          investigation.recovery_approval_recorded ? `recovery approval ${investigation.latest_recovery_approval_decision}` : "",
          investigation.recovery_execution_started ? `recovery attempt ${investigation.latest_recovery_attempt_id}` : "",
        ].filter(Boolean).join("; "),
        session_id: investigation.session_id,
        launch_id: investigation.launch_id,
        mission_id: investigation.mission_id,
        occurred_at: investigation.updated_at,
        fields: {
          phase: investigation.phase,
          stop_reason: investigation.stop_reason,
          provider_id: investigation.provider_id,
          model_id: investigation.model_id,
          latest_checkpoint_id: investigation.latest_checkpoint_id,
          recovery_state: investigation.recovery_state,
          recovery_approval_recorded: String(investigation.recovery_approval_recorded),
          recovery_approval_decision: investigation.latest_recovery_approval_decision,
          recovery_approval_id: investigation.latest_recovery_approval_id,
          recovery_approved_by: investigation.latest_recovery_approved_by,
          recovery_approval_plan_hash_preview: investigation.latest_recovery_approval_plan_hash?.slice(0, 16),
          recovery_approval_consumed: String(investigation.recovery_approval_consumed),
          recovery_attempt_id: investigation.latest_recovery_attempt_id,
          recovery_kind: investigation.latest_recovery_kind,
          recovery_execution_in_progress: String(investigation.recovery_execution_in_progress),
          recovery_pending_disposition: investigation.latest_recovery_pending_disposition,
          evidence_previews: investigation.evidence_previews.join(" "),
          evidence_count: String(investigation.evidence_count),
          model_turn_count: String(investigation.model_turn_count),
          tool_call_count: String(investigation.tool_call_count),
        },
      })
    }
    return records
  }

  private opencodeSessionContinuityService(): OpenCodeSessionContinuityService {
    this.opencodeSessionContinuityServiceInstance ??= new OpenCodeSessionContinuityService({
      sessionService: this.opencodeSessionService(),
      launchService: this.opencodeLaunchGateService(),
      launchReadinessService: this.opencodeLaunchReadinessService(),
      instructionPackService: this.opencodeSessionInstructionPackService(),
      commanderContinuityService: this.commanderContinuityService(),
      progressService: this.opencodeProgressService(),
      resultReportService: this.opencodeResultReportService(),
      researchMemoryService: this.researchMemoryService(),
      contextBudgetService: this.contextBudgetService(),
      previousRefresh: (refreshId) => this.opencodeContextRefreshService().previousSnapshot(refreshId),
      latestRefresh: (sessionId, continuityMode) => this.opencodeContextRefreshService().latestSnapshot(sessionId, continuityMode),
      now: this.researchSynthesisNow,
    })
    return this.opencodeSessionContinuityServiceInstance
  }

  private opencodeContextRefreshService(): OpenCodeContextRefreshService {
    this.opencodeContextRefreshServiceInstance ??= new OpenCodeContextRefreshService({
      projectDir: this.projectDir,
      eventStore: this.eventStore,
      continuityService: this.opencodeSessionContinuityService(),
      now: this.researchSynthesisNow,
    })
    return this.opencodeContextRefreshServiceInstance
  }

  private researchIngestionReadService(): Pick<ResearchIngestionService, "list" | "latest"> {
    this.researchIngestionReadServiceInstance ??= new ResearchIngestionService({
      eventStore: this.eventStore,
      researchDb: READ_ONLY_RESEARCH_INGESTION_DB,
      resultReviewService: this.opencodeResultReviewService(),
      resultReportService: this.opencodeResultReportService(),
      opencodeSessionService: this.opencodeSessionService(),
      launchGateService: this.opencodeLaunchGateService(),
      now: this.researchSynthesisNow,
    })
    return this.researchIngestionReadServiceInstance
  }

  private researchIngestionService(): ResearchIngestionService {
    this.researchIngestionServiceInstance ??= new ResearchIngestionService({
      eventStore: this.eventStore,
      researchDb: this.getResearchDb() as ResearchIngestionDbWriter,
      resultReviewService: this.opencodeResultReviewService(),
      resultReportService: this.opencodeResultReportService(),
      opencodeSessionService: this.opencodeSessionService(),
      launchGateService: this.opencodeLaunchGateService(),
      now: this.researchSynthesisNow,
    })
    return this.researchIngestionServiceInstance
  }

  private researchMemoryReadAdapter(): ResearchMemoryReadAdapter {
    if (this.researchProjectionMode === "disabled") {
      return { available: false, policy: "empty_projection", unavailableReason: "research projection is disabled; no internal research memory was inspected" }
    }
    if (!this.researchDb && !existsSync(join(this.projectDir, ".nxl", "research.db"))) {
      return { available: false, policy: "empty_projection", unavailableReason: "research.db projection is not present; no internal research memory was inspected" }
    }
    const integrity = this.checkResearchProjectionForStatus()
    if (!integrity.ok || integrity.stale) {
      return {
        available: false,
        policy: "empty_projection",
        unavailableReason: `research projection is not usable for read-only retrieval: ${integrity.reason ?? (integrity.stale ? "stale" : "unknown")}`,
      }
    }
    const db = this.getResearchDb() as RuntimeResearchDbProjection & ResearchMemoryReadAdapter
    return {
      available: true,
      policy: "projection_read",
      getResearchResult: typeof db.getResearchResult === "function" ? db.getResearchResult.bind(db) : undefined,
      searchResearchResults: typeof db.searchResearchResults === "function" ? db.searchResearchResults.bind(db) : undefined,
      searchResearchResultsFts: typeof db.searchResearchResultsFts === "function" ? db.searchResearchResultsFts.bind(db) : undefined,
      researchResultsFtsStatus: typeof db.researchResultsFtsStatus === "function" ? db.researchResultsFtsStatus.bind(db) : undefined,
      listResultCitationPointers: typeof db.listResultCitationPointers === "function" ? db.listResultCitationPointers.bind(db) : undefined,
      listResultArtifactPointers: typeof db.listResultArtifactPointers === "function" ? db.listResultArtifactPointers.bind(db) : undefined,
      listResultCitations: typeof db.listResultCitations === "function" ? db.listResultCitations.bind(db) : undefined,
      listResultArtifacts: typeof db.listResultArtifacts === "function" ? db.listResultArtifacts.bind(db) : undefined,
      searchCandidates: typeof db.searchCandidates === "function" ? db.searchCandidates.bind(db) : undefined,
      searchTrials: typeof db.searchTrials === "function" ? db.searchTrials.bind(db) : undefined,
      searchTrainingRuns: typeof db.searchTrainingRuns === "function" ? db.searchTrainingRuns.bind(db) : undefined,
    }
  }

  private commanderCycleService(): CommanderCycleService {
    return new CommanderCycleService({
      eventStore: this.eventStore,
      researchDb: this.getResearchDb(),
      missionRegistry: this.missionRegistry,
      proposalRegistry: this.proposalRegistry,
      proposalBundleRegistry: this.proposalBundleRegistry,
      provider: this.commanderCycleProvider,
      now: this.commanderCycleNow,
      cycleId: this.commanderCycleId,
    })
  }
}

function investigationControlActionForProjection(projectedState: OpenCodeHumanControlProjectionState): CommanderInvestigationControlSnapshot["action"] {
  if (projectedState === "pause_requested") return "pause"
  if (projectedState === "stop_requested") return "stop"
  if (projectedState === "correction_pending" || projectedState === "override_pending" || projectedState === "escalated") return "needs_human_review"
  return "continue"
}

function investigationControlWarnings(projectedState: OpenCodeHumanControlProjectionState, warnings: string[]): string[] {
  const next = warnings.slice(0, 6)
  if (projectedState === "resume_requested" || projectedState === "report_requested" || projectedState === "noted") {
    next.push(`latest durable human-control state ${projectedState} does not halt investigation`)
  }
  return next.slice(0, 8)
}

function humanControlSummaryPreview(result: OpenCodeHumanControlRecord | OpenCodeHumanControlResult): string {
  const rich = result as Partial<OpenCodeHumanControlResult>
  return redactText([
    `durable human control ${result.control_kind}`,
    `state=${result.projected_state_after}`,
    rich.reason_preview ?? rich.correction_preview ?? rich.override_preview ?? result.human_note_preview,
  ].filter(Boolean).join("; ")).replace(/\s+/g, " ").trim().slice(0, 300)
}

function providerReadinessResult(input: {
  status: CommanderInvestigationProviderReadiness["status"]
  configurationReady: boolean
  executionReady: boolean
  providerSource: CommanderInvestigationProviderReadiness["provider_source"]
  providerId?: string
  providerKind?: string
  connectorId?: string
  modelId?: string
  enabledPhases?: CommanderToolPhase[]
  capabilityId?: string
  defaultToolProtocol: CommanderInvestigationProviderReadiness["default_tool_protocol"]
  runtimeMode: RuntimeMode
  runtimeLifecycleState: CommanderRuntimeLifecycleState
  runtimeStarted: boolean
  runLockRequired: boolean
  runLockHeld: boolean
  adapterId?: string
  supportsStreaming: boolean
  wouldCallNetwork?: boolean
  wouldAppendExternalApiAudit?: boolean
  checks: CommanderInvestigationProviderReadinessCheck[]
  blockers: string[]
  warnings: string[]
  generatedAt: string
}): CommanderInvestigationProviderReadiness {
  const result: CommanderInvestigationProviderReadiness = {
    readiness_id: `commander_provider_readiness_${stableHash({
      status: input.status,
      provider_source: input.providerSource,
      provider_id: input.providerId,
      provider_kind: input.providerKind,
      connector_id: input.connectorId,
      model_id: input.modelId,
      phase_count: input.enabledPhases?.length ?? 0,
      configuration_ready: input.configurationReady,
      execution_ready: input.executionReady,
    }).slice(0, 16)}`,
    status: input.status,
    configuration_ready: input.configurationReady,
    execution_ready: input.executionReady,
    provider_source: input.providerSource,
    provider_id: input.providerId,
    provider_kind: input.providerKind,
    connector_id: input.connectorId,
    model_id: input.modelId,
    enabled_phases: input.enabledPhases ?? [],
    capability_id: input.capabilityId,
    default_tool_protocol: input.defaultToolProtocol,
    runtime_mode: input.runtimeMode,
    runtime_lifecycle_state: input.runtimeLifecycleState,
    runtime_started: input.runtimeStarted,
    run_lock_required: input.runLockRequired,
    run_lock_held: input.runLockHeld,
    adapter_id: input.adapterId,
    supports_streaming: input.supportsStreaming,
    would_call_network: input.wouldCallNetwork === true,
    would_append_external_api_audit: input.wouldAppendExternalApiAudit === true,
    checks: input.checks.slice(0, 32),
    blockers: input.blockers.map((item) => redactText(item).slice(0, 240)).slice(0, 16),
    warnings: input.warnings.map((item) => redactText(item).slice(0, 240)).slice(0, 16),
    generated_at: input.generatedAt,
    network_called: false,
    events_appended: false,
    readiness_hash: "",
  }
  result.readiness_hash = stableHash({ ...result, generated_at: "", readiness_hash: "" })
  return redactValue(result)
}

function requireCommanderRegistryAssertion(
  registry: ModelProfileRuntimeRegistry,
  config: CommanderInvestigationProviderConfig,
): void {
  const selection = registry.commanderSelection()
  if (!selection) throw new Error("explicit model-profile registry has no Commander role binding")
  if (
    selection.transport_kind !== config.transport_kind
    || selection.provider_id !== config.provider_id
    || selection.provider_kind !== config.provider_kind
    || selection.connector_id !== config.connector_id
    || selection.model_id !== config.model_id
  ) {
    throw new Error("Commander provider configuration assertion does not match explicit model-profile authority")
  }
}

class UnavailableReasoningProvider implements ResearchSynthesisProvider, CommanderCycleProvider, CommanderExecutorReviewProvider {
  constructor(readonly provider_id: string, private readonly reason: string) {}

  async synthesize(): Promise<never> {
    throw new Error(this.reason)
  }

  async run(): Promise<never> {
    throw new Error(this.reason)
  }

  async reviewExecutorResult(): Promise<never> {
    throw new Error(this.reason)
  }

  previewExecutorReviewReadiness(): { provider_ready: boolean; blockers: string[]; warnings: string[] } {
    return { provider_ready: false, blockers: [this.reason], warnings: [] }
  }
}

type ResearchProjectionRuntimeEventType = Extract<RuntimeEvent, { type: `ResearchProjection${string}` }>["type"]

function assertProjectionDb(db: RuntimeResearchDbProjection): RuntimeResearchDbProjection {
  const candidate = db as Partial<RuntimeResearchDbProjection>
  for (const method of ["checkProjectionIntegrity", "rebuildFromEvents", "getProjectionStatus"] as const) {
    if (typeof candidate[method] !== "function") throw new Error(`researchDb must support Branch 4D projection API: missing ${method}`)
  }
  return db
}

function isExecutorToolHandlerAdapter(adapter: OpenCodeRuntimeAdapter): adapter is OpenCodeRuntimeAdapter & ExecutorToolHandlerAdapter {
  return typeof (adapter as Partial<ExecutorToolHandlerAdapter>).setExecutorToolHandler === "function"
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function requiredRawString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return value
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${field} must be a string`)
  if (!value.trim()) throw new Error(`${field} must be nonblank`)
  return value.trim()
}

function optionalRawString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${field} must be a string`)
  return value
}

function optionalPositiveInteger(value: unknown, field: string, max = 1000): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${field} must be a positive integer`)
  if (Number(value) > max) throw new Error(`${field} must be no greater than ${max}`)
  return Number(value)
}

function optionalPositiveIntegerUnbounded(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${field} must be a positive integer`)
  return Number(value)
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`)
  return value
}

function readReasoningProviderSmokeInput(value: Record<string, unknown>): ReasoningProviderSmokeInput {
  return {
    surface: optionalString(value.surface, "surface") as ReasoningProviderSmokeInput["surface"],
    dry_run: optionalBoolean(value.dryRun ?? value.dry_run, "dryRun"),
    requested_by: optionalString(value.requestedBy ?? value.requested_by, "requestedBy"),
  }
}

function readMiniMaxLiveValidationInput(value: Record<string, unknown>): MiniMaxLiveValidationInput {
  const rawSurfaces = value.surfaces ?? value.surface
  const surfaces = rawSurfaces === undefined
    ? undefined
    : (Array.isArray(rawSurfaces) ? rawSurfaces : [rawSurfaces]).map((item, index) => readMiniMaxLiveValidationSurface(item, `surfaces[${index}]`))
  return {
    surfaces,
    requested_by: optionalString(value.requestedBy ?? value.requested_by, "requestedBy"),
    timeout_ms: optionalPositiveInteger(value.timeoutMs ?? value.timeout_ms, "timeoutMs", 60_000),
    dry_run: optionalBoolean(value.dryRun ?? value.dry_run, "dryRun"),
  }
}

function readMiniMaxLiveValidationSurface(value: unknown, field: string): MiniMaxLiveValidationSurface {
  if (value === "research" || value === "research_synthesis") return "research_synthesis"
  if (value === "cycle" || value === "commander_cycle") return "commander_cycle"
  if (value === "executor_review" || value === "commander_executor_review") return "commander_executor_review"
  throw new Error(`${field} must be research_synthesis, commander_cycle, or commander_executor_review`)
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value.map((item, index) => requiredString(item, `${field}[${index}]`))
}

function optionalRecord(value: unknown, field: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`${field} must be an object`)
  return value
}

function readCommanderPlaybookDraftInput(payload: Record<string, unknown>): CommanderPlaybookDraftInput {
  return {
    playbook_id: requiredString(payload.playbookId ?? payload.playbook_id, "playbookId"),
    requested_by: optionalString(payload.requestedBy ?? payload.requested_by, "requestedBy"),
    proposed_by: optionalString(payload.proposedBy ?? payload.proposed_by, "proposedBy"),
    fields: stringRecord(payload.fields, "fields"),
    bundle_title: optionalString(payload.bundleTitle ?? payload.bundle_title, "bundleTitle"),
    bundle_summary: optionalString(payload.bundleSummary ?? payload.bundle_summary, "bundleSummary"),
    create_bundle: optionalBoolean(payload.createBundle ?? payload.create_bundle, "createBundle"),
    request_reviews: optionalBoolean(payload.requestReviews ?? payload.request_reviews, "requestReviews"),
  }
}

function readCommanderApplyTarget(payload: Record<string, unknown>): { target_type: CommanderApplyTargetType; target_id: string } {
  return {
    target_type: requiredString(payload.targetType ?? payload.target_type, "targetType") as CommanderApplyTargetType,
    target_id: requiredString(payload.targetId ?? payload.target_id, "targetId"),
  }
}

function readExternalApiRequestInput(payload: Record<string, unknown>): ExternalApiRequestInput {
  return {
    connector_id: requiredString(payload.connectorId ?? payload.connector_id, "connectorId"),
    method: requiredString(payload.method, "method").toUpperCase() as ExternalApiRequestInput["method"],
    path: requiredString(payload.path, "path"),
    query: optionalRawStringRecord(payload.query, "query"),
    headers: optionalRawStringRecord(payload.headers, "headers"),
    body: optionalRawString(payload.body, "body"),
    dry_run: optionalBoolean(payload.dryRun ?? payload.dry_run, "dryRun"),
    requested_by: requiredString(payload.requestedBy ?? payload.requested_by, "requestedBy"),
  }
}

function readExternalApiResearchIngestionInput(payload: Record<string, unknown>): ExternalApiResearchIngestionInput {
  return {
    connector_id: requiredString(payload.connectorId ?? payload.connector_id, "connectorId"),
    method: requiredString(payload.method, "method").toUpperCase() as ExternalApiResearchIngestionInput["method"],
    path: requiredString(payload.path, "path"),
    query: optionalRawStringRecord(payload.query, "query"),
    headers: optionalRawStringRecord(payload.headers, "headers"),
    body: optionalRawString(payload.body, "body"),
    topic_id: requiredString(payload.topicId ?? payload.topic_id, "topicId"),
    source_title: requiredString(payload.sourceTitle ?? payload.source_title, "sourceTitle"),
    note_title: optionalString(payload.noteTitle ?? payload.note_title, "noteTitle"),
    requested_by: requiredString(payload.requestedBy ?? payload.requested_by, "requestedBy"),
    response_selector: optionalString(payload.responseSelector ?? payload.response_selector, "responseSelector") as ExternalApiResearchIngestionInput["response_selector"],
    tags: optionalStringArray(payload.tags, "tags"),
    dry_run: optionalBoolean(payload.dryRun ?? payload.dry_run, "dryRun"),
  }
}

function readResearchSynthesisInput(payload: Record<string, unknown>): ResearchSynthesisInput {
  return {
    topic_id: requiredString(payload.topicId ?? payload.topic_id, "topicId"),
    objective: optionalString(payload.objective, "objective"),
    provider_id: optionalString(payload.providerId ?? payload.provider_id, "providerId"),
    create_proposals: optionalBoolean(payload.createProposals ?? payload.create_proposals, "createProposals"),
    requested_by: requiredString(payload.requestedBy ?? payload.requested_by, "requestedBy"),
    max_context_bytes: optionalPositiveInteger(payload.maxContextBytes ?? payload.max_context_bytes, "maxContextBytes", 64 * 1024),
    max_output_bytes: optionalPositiveInteger(payload.maxOutputBytes ?? payload.max_output_bytes, "maxOutputBytes", 32 * 1024),
  }
}

function readCommanderCycleInput(payload: Record<string, unknown>): CommanderCycleInput {
  return {
    objective: optionalString(payload.objective, "objective"),
    topic_id: optionalString(payload.topicId ?? payload.topic_id, "topicId"),
    mission_id: optionalString(payload.missionId ?? payload.mission_id, "missionId"),
    provider_id: optionalString(payload.providerId ?? payload.provider_id, "providerId"),
    create_proposals: optionalBoolean(payload.createProposals ?? payload.create_proposals, "createProposals"),
    create_bundle: optionalBoolean(payload.createBundle ?? payload.create_bundle, "createBundle"),
    requested_by: requiredString(payload.requestedBy ?? payload.requested_by, "requestedBy"),
    max_context_bytes: optionalPositiveInteger(payload.maxContextBytes ?? payload.max_context_bytes, "maxContextBytes", 96 * 1024),
    max_output_bytes: optionalPositiveInteger(payload.maxOutputBytes ?? payload.max_output_bytes, "maxOutputBytes", 32 * 1024),
  }
}

function readOpenCodeHandoffInput(payload: Record<string, unknown>): OpenCodeHandoffInput {
  return {
    proposal_id: requiredString(payload.proposalId ?? payload.proposal_id, "proposalId"),
    requested_by: optionalString(payload.requestedBy ?? payload.requested_by, "requestedBy"),
    dry_run: optionalBoolean(payload.dryRun ?? payload.dry_run, "dryRun"),
  }
}

function readRuntimeCheckpointInput(payload: Record<string, unknown>): RuntimeCheckpointInput {
  return {
    scope: payload.scope === undefined ? undefined : readRuntimeCheckpointScope(payload.scope),
    reason: optionalString(payload.reason, "reason"),
    created_by: optionalString(payload.createdBy ?? payload.created_by, "createdBy"),
    requested_by: optionalString(payload.requestedBy ?? payload.requested_by, "requestedBy"),
    max_bytes: optionalPositiveInteger(payload.maxBytes ?? payload.max_bytes, "maxBytes", 256 * 1024),
  }
}

function readRuntimeRestoreInput(payload: Record<string, unknown>): RuntimeRestoreInput {
  return {
    checkpoint_id: requiredString(payload.checkpointId ?? payload.checkpoint_id, "checkpointId"),
    marked_by: optionalString(payload.markedBy ?? payload.marked_by, "markedBy"),
    requested_by: optionalString(payload.requestedBy ?? payload.requested_by, "requestedBy"),
  }
}

function stringRecord(value: unknown, field: string): Record<string, string> {
  if (!isRecord(value)) throw new Error(`${field} must be an object`)
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) out[requiredString(key, `${field} key`)] = requiredString(raw, key)
  return out
}

function optionalStringRecord(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined) return undefined
  return stringRecord(value, field)
}

function rawStringRecord(value: unknown, field: string): Record<string, string> {
  if (!isRecord(value)) throw new Error(`${field} must be an object`)
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== "string") throw new Error(`${key} must be a string`)
    out[requiredString(key, `${field} key`)] = raw
  }
  return out
}

function optionalRawStringRecord(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined) return undefined
  return rawStringRecord(value, field)
}

function readResearchEventsOptions(value: unknown): ListResearchEventsOptions | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("options must be an object")
  return value as ListResearchEventsOptions
}

function readSearchOptions(value: unknown): SearchOptions | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("options must be an object")
  return value as SearchOptions
}

function readRebuildProjectionOptions(value: unknown): { force: boolean } {
  if (value === undefined) return { force: false }
  if (!isRecord(value)) throw new Error("options must be an object")
  if (value.force !== undefined && typeof value.force !== "boolean") throw new Error("force must be a boolean")
  return { force: value.force ?? false }
}

function readCommanderRecoveryListInput(payload: Record<string, unknown>): import("./commander-agent").CommanderRecoveryOperatorListInput {
  assertExactKeys(payload, ["limit", "status", "recovery_state", "approval_state"])
  const limit = payload.limit === undefined ? undefined : requiredInteger(payload.limit, "limit")
  const status = optionalString(payload.status, "status")
  const recoveryState = optionalString(payload.recovery_state, "recovery_state")
  const approvalState = optionalString(payload.approval_state, "approval_state")
  if (status !== undefined && !["running", "final", "refused", "blocked", "failed", "cancelled", "budget_exhausted", "no_progress", "needs_human_review"].includes(status)) throw new Error("status is invalid")
  if (recoveryState !== undefined && ![
    "not_required",
    "checkpoint_available_resume_not_implemented",
    "uncertain_provider_outcome_resume_not_implemented",
    "checkpoint_approval_recorded_execution_not_implemented",
    "uncertain_outcome_approval_recorded_execution_not_implemented",
    "recovery_transaction_started",
    "recovery_execution_in_progress",
    "recovery_execution_interrupted_review_required",
    "no_checkpoint_resume_not_implemented",
  ].includes(recoveryState)) throw new Error("recovery_state is invalid")
  if (approvalState !== undefined && !["none", "current", "stale", "consumed"].includes(approvalState)) throw new Error("approval_state is invalid")
  return {
    limit,
    status,
    recovery_state: recoveryState as import("./commander-agent").CommanderInvestigationRecoveryState | undefined,
    approval_state: approvalState as import("./commander-agent").CommanderInvestigationRecoveryApprovalState | undefined,
  }
}

function readCommanderRecoveryShowInput(payload: Record<string, unknown>): { investigation_id: string } {
  assertExactKeys(payload, ["investigation_id"])
  return { investigation_id: requiredRecoveryAuthorityId(payload.investigation_id, "investigation_id", 200) }
}

function readCommanderRecoveryApprovalInput(payload: Record<string, unknown>): CommanderInvestigationRecoveryApprovalInput {
  assertExactKeys(payload, ["investigation_id", "recovery_plan_hash", "decision", "approved_by", "human_note", "acknowledgements"])
  if (!isRecord(payload.acknowledgements)) throw new Error("acknowledgements must be an object")
  const acknowledgements = payload.acknowledgements
  assertExactKeys(acknowledgements, ["fresh_context_required", "exact_replay_unavailable", "provider_request_replay_forbidden", "tool_execution_replay_forbidden", "uncertain_provider_outcome"])
  const decision = requiredRawString(payload.decision, "decision")
  if (decision !== "approve_resume_from_checkpoint" && decision !== "approve_continue_after_uncertain_provider_outcome") throw new Error("decision is invalid")
  const requiredTrue = (key: string): true => {
    if (acknowledgements[key] !== true) throw new Error(`${key} acknowledgement must be true`)
    return true
  }
  const uncertain = acknowledgements.uncertain_provider_outcome
  if (uncertain !== undefined && uncertain !== true) throw new Error("uncertain_provider_outcome acknowledgement must be true when present")
  return {
    investigation_id: requiredRecoveryAuthorityId(payload.investigation_id, "investigation_id", 200),
    recovery_plan_hash: requiredRawString(payload.recovery_plan_hash, "recovery_plan_hash"),
    decision,
    approved_by: requiredRawString(payload.approved_by, "approved_by"),
    human_note: optionalRawString(payload.human_note, "human_note"),
    acknowledgements: {
      fresh_context_required: requiredTrue("fresh_context_required"),
      exact_replay_unavailable: requiredTrue("exact_replay_unavailable"),
      provider_request_replay_forbidden: requiredTrue("provider_request_replay_forbidden"),
      tool_execution_replay_forbidden: requiredTrue("tool_execution_replay_forbidden"),
      ...(uncertain === true ? { uncertain_provider_outcome: true as const } : {}),
    },
  }
}

function readCommanderRecoveryExecuteInput(payload: Record<string, unknown>): CommanderInvestigationRecoveryTransactionInput {
  assertExactKeys(payload, ["investigation_id", "approval_id", "approval_hash", "recovery_plan_hash", "execution_preparation_hash"])
  return {
    investigation_id: requiredRecoveryAuthorityId(payload.investigation_id, "investigation_id", 200),
    approval_id: requiredRecoveryAuthorityId(payload.approval_id, "approval_id", 160),
    approval_hash: requiredRawString(payload.approval_hash, "approval_hash"),
    recovery_plan_hash: requiredRawString(payload.recovery_plan_hash, "recovery_plan_hash"),
    execution_preparation_hash: requiredRawString(payload.execution_preparation_hash, "execution_preparation_hash"),
  }
}

function readCommanderRecoveryCancelInput(payload: Record<string, unknown>): CommanderRecoveryCancelInput {
  assertExactKeys(payload, ["investigation_id", "operation_id", "approval_id", "recovery_attempt_id"])
  return {
    investigation_id: requiredRecoveryAuthorityId(payload.investigation_id, "investigation_id", 200),
    operation_id: requiredRecoveryAuthorityId(payload.operation_id, "operation_id", 160),
    approval_id: requiredRecoveryAuthorityId(payload.approval_id, "approval_id", 160),
    recovery_attempt_id: payload.recovery_attempt_id === undefined ? undefined : requiredRecoveryAuthorityId(payload.recovery_attempt_id, "recovery_attempt_id", 160),
  }
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed)
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key))
  if (unknown.length > 0) throw new Error(`unknown fields: ${unknown.sort().join(", ")}`)
}

function requiredInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value)) throw new Error(`${field} must be an integer`)
  return Number(value)
}

function requiredRecoveryAuthorityId(value: unknown, field: string, max: number): string {
  const result = requiredRawString(value, field)
  if (result.length > max || !/^[A-Za-z0-9_.:-]+$/.test(result)) throw new Error(`${field} must use bounded durable ID characters`)
  return result
}

function sameRecoveryAuthority(operation: CommanderRecoveryOperation, input: CommanderInvestigationRecoveryTransactionInput): boolean {
  return operation.investigation_id === input.investigation_id
    && operation.approval_id === input.approval_id
    && operation.approval_hash === input.approval_hash
    && operation.recovery_plan_hash === input.recovery_plan_hash
    && operation.execution_preparation_hash === input.execution_preparation_hash
}

function recoveryAttemptMatchesOperation(
  attempt: CommanderInvestigationRecoveryAttemptSummary | undefined,
  operation: CommanderRecoveryOperation,
): attempt is CommanderInvestigationRecoveryAttemptSummary {
  return attempt !== undefined
    && attempt.approval_id === operation.approval_id
    && attempt.approval_hash === operation.approval_hash
    && attempt.recovery_plan_hash === operation.recovery_plan_hash
    && attempt.execution_preparation_hash === operation.execution_preparation_hash
    && (operation.recovery_attempt_id === undefined || attempt.recovery_attempt_id === operation.recovery_attempt_id)
}

function recoveryAttemptForOperation(
  source: CommanderInvestigationRecoverySource | undefined,
  operation: CommanderRecoveryOperation,
): CommanderInvestigationRecoveryAttemptSummary | undefined {
  if (source?.investigation_id !== operation.investigation_id) return undefined
  const candidates = [source.current_recovery_attempt, source.latest_recovery_attempt]
  return candidates.find((attempt) => recoveryAttemptMatchesOperation(attempt, operation))
}

function recoveryOperationMayBeReplaced(source: CommanderInvestigationRecoverySource | undefined): boolean {
  return source?.projection_status === "ready"
    && source.record?.status === "running"
    && source.latest_checkpoint !== undefined
    && !source.terminal
    && !source.current_recovery_attempt
    && !source.latest_recovery_attempt
    && (source.recovery_attempts?.length ?? 0) === 0
}

function cloneRecoveryOperation(operation: CommanderRecoveryOperation): CommanderRecoveryOperation {
  return structuredClone(operation)
}

function recoveryCancellationResult(input: CommanderRecoveryCancelInput, status: CommanderRecoveryCancellationResult["status"], requested: boolean, generatedAt: string, attemptId?: string): CommanderRecoveryCancellationResult {
  return {
    status,
    investigation_id: input.investigation_id,
    operation_id: input.operation_id,
    approval_id: input.approval_id,
    recovery_attempt_id: attemptId,
    cancellation_requested: requested,
    provider_outcome_known: false,
    durable_state_changed: false,
    generated_at: generatedAt,
  }
}

function alreadyAbortedSignal(reason: string): AbortSignal {
  const controller = new AbortController()
  controller.abort(new Error(reason))
  return controller.signal
}

function commanderRecoveryApprovalBlockedResult(input: CommanderInvestigationRecoveryApprovalInput, preview: CommanderInvestigationRecoveryApprovalPreview, blocker: string, now: Date): CommanderInvestigationRecoveryApprovalResult {
  const generatedAt = now.toISOString()
  const result = {
    result_id: `commander_recovery_approval_result_${stableHash({ investigation_id: input.investigation_id, generated_at: generatedAt, blocked: true }).slice(0, 16)}`,
    status: "blocked" as const,
    investigation_id: input.investigation_id,
    decision: input.decision,
    approval_state: preview.existing_current_approval ? "current" as const : "none" as const,
    recovery_basis_hash: preview.recovery_basis_hash,
    recovery_plan_hash: preview.current_recovery_plan_hash,
    checkpoint_ref: preview.checkpoint_ref,
    pending_model_step_ref: preview.pending_model_step_ref,
    events_appended: false,
    provider_called: false as const,
    tool_executed: false as const,
    network_called: false as const,
    files_written: false as const,
    research_db_written: false as const,
    mission_mutated: false as const,
    proposal_mutated: false as const,
    opencode_action_performed: false as const,
    github_action_performed: false as const,
    mcp_called: false as const,
    blockers: [blocker, ...preview.blockers].map((item) => redactText(item).slice(0, 240)).slice(0, 24),
    warnings: preview.warnings.slice(0, 24),
    generated_at: generatedAt,
    result_hash: "",
  }
  result.result_hash = stableHash({ ...result, result_id: "", generated_at: "", result_hash: "" })
  return result
}

function durableResult(result: CommanderInvestigationResult, durability: import("./commander-agent").CommanderInvestigationDurabilitySummary): CommanderInvestigationResult {
  return {
    ...result,
    durability,
    investigation_event_count: durability.investigation_event_count,
    in_memory_only: false,
    working_set_persisted: true,
    investigation_events_appended: durability.investigation_event_count > 0,
    events_appended: result.external_api_audit_events_appended > 0 || durability.investigation_event_count > 0,
  }
}

async function commanderInvestigationProjectionAfterFailure(journal: import("./commander-agent").CommanderInvestigationJournalService, investigationId: string): Promise<import("./commander-agent").CommanderInvestigationRecord | undefined> {
  try {
    return await journal.get(investigationId)
  } catch {
    return undefined
  }
}

function durablePersistenceFailedResult(result: CommanderInvestigationResult, state: import("./commander-agent").CommanderInvestigationJournalRunState, error: unknown, projected?: import("./commander-agent").CommanderInvestigationRecord): CommanderInvestigationResult {
  const message = error instanceof Error ? redactText(error.message) : redactText(String(error))
  const projectedTerminalPersisted = projected ? projected.status !== "running" : undefined
  const projectedWarnings = projected ? [...projected.integrity_errors, ...projected.warnings].map((item) => redactText(item)).filter(Boolean) : []
  const durability = {
    mode: "event_journal" as const,
    started_persisted: state.started_persisted || Boolean(projected),
    initial_checkpoint_persisted: projected?.checkpoint_available ?? state.checkpoint_count > 0,
    terminal_persisted: projectedTerminalPersisted ?? false,
    investigation_event_count: projected?.investigation_event_count ?? state.investigation_event_count,
    started_event_id: state.started_event_id,
    latest_checkpoint_event_id: state.latest_checkpoint_event_id,
    latest_checkpoint_id: projected?.latest_checkpoint_id ?? state.latest_checkpoint?.checkpoint_id,
    latest_checkpoint_sequence: projected?.latest_checkpoint_sequence ?? state.latest_checkpoint?.checkpoint_sequence,
    latest_checkpoint_hash: projected?.latest_checkpoint_hash ?? state.latest_checkpoint?.checkpoint_hash,
    checkpoint_count: projected?.latest_checkpoint_sequence === undefined ? state.checkpoint_count : projected.latest_checkpoint_sequence + 1,
    pending_model_request_id: projected?.pending_model_request_id ?? state.pending_model_request_id,
    projection_status: projected?.projection_status ?? "corrupt" as const,
    resume_supported: false as const,
    full_transcript_persisted: false as const,
    raw_tool_results_persisted: false as const,
    chain_of_thought_persisted: false as const,
    original_terminal_status_if_persistence_failed: result.status,
    warnings: [message, ...projectedWarnings].filter(Boolean).slice(0, 12),
    durability_hash: "",
  }
  durability.durability_hash = stableHash({ ...durability, started_event_id: "", latest_checkpoint_event_id: "", durability_hash: "" })
  return {
    ...result,
    status: "failed",
    stop_reason: "persistence_failed",
    blockers: [message || "Commander investigation terminal persistence failed"],
    durability,
    investigation_event_count: durability.investigation_event_count,
    in_memory_only: false,
    working_set_persisted: durability.checkpoint_count > 0,
    investigation_events_appended: durability.investigation_event_count > 0,
    events_appended: result.external_api_audit_events_appended > 0 || durability.investigation_event_count > 0,
    result_hash: result.result_hash,
  }
}

function durableControllerRejectedResult(state: import("./commander-agent").CommanderInvestigationJournalRunState, error: unknown, now: Date): CommanderInvestigationResult {
  const checkpoint = state.latest_checkpoint
  if (!checkpoint) throw error
  const message = error instanceof Error ? redactText(error.message) : redactText(String(error))
  const completedAt = now.toISOString()
  const startedAt = state.started_at ?? checkpoint.created_at
  const resultHash = stableHash({
    status: "failed",
    stop_reason: "controller_error",
    phase: checkpoint.phase,
    objective_hash: checkpoint.objective_hash,
    provider_id: checkpoint.provider_id,
    provider_kind: checkpoint.provider_kind,
    model_id: checkpoint.model_id,
    tool_protocol: checkpoint.tool_protocol,
    bootstrap_hash: checkpoint.bootstrap_ref.bootstrap_hash,
    budget_hash: checkpoint.budget.budget_hash,
    loaded_tool_ids: checkpoint.working_set.loaded_tool_ids,
    evidence: checkpoint.working_set.evidence_cards.map((item) => ({ ...item, observed_at: "" })),
    turn_summaries: checkpoint.turn_summaries.map((item) => ({ ...item, model_request_id: "", model_result_hash: "", tool_execution_ids: [], provider_audit_request_ids: [], warnings: [], turn_hash: "" })),
    counters: {
      model_turn_count: checkpoint.working_set.model_turn_count,
      provider_request_count: checkpoint.provider_request_count,
      tool_call_count: checkpoint.working_set.tool_call_count,
      tool_search_call_count: checkpoint.working_set.tool_search_call_count,
      cumulative_tool_result_bytes: checkpoint.working_set.cumulative_tool_result_bytes,
      omitted_evidence_count: checkpoint.working_set.omitted_evidence_count,
      omitted_turn_count: checkpoint.working_set.omitted_turn_count,
      consecutive_no_progress_turns: checkpoint.working_set.consecutive_no_progress_turns,
    },
    provider_audit: {
      ...checkpoint.working_set.provider_audit,
      audit_request_ids: [],
    },
    pending_model_request: Boolean(state.pending_model_request_id),
    blocker: message,
  })
  return {
    investigation_id: checkpoint.investigation_id,
    status: "failed",
    stop_reason: "controller_error",
    phase: checkpoint.phase,
    objective_preview: checkpoint.working_set.objective_preview,
    provider_id: checkpoint.provider_id,
    provider_kind: checkpoint.provider_kind,
    model_id: checkpoint.model_id,
    tool_protocol: checkpoint.tool_protocol,
    bootstrap_id: checkpoint.bootstrap_ref.bootstrap_id,
    bootstrap_hash: checkpoint.bootstrap_ref.bootstrap_hash,
    context_budget_id: checkpoint.budget.source_context_budget_id,
    budget: checkpoint.budget,
    model_turn_count: checkpoint.working_set.model_turn_count,
    provider_request_count: checkpoint.provider_request_count,
    tool_call_count: checkpoint.working_set.tool_call_count,
    tool_search_call_count: checkpoint.working_set.tool_search_call_count,
    loaded_tool_ids: checkpoint.working_set.loaded_tool_ids.slice(),
    loaded_schema_bytes: 0,
    loaded_schema_tokens: 0,
    cumulative_tool_result_bytes: checkpoint.working_set.cumulative_tool_result_bytes,
    evidence: checkpoint.working_set.evidence_cards.slice(),
    turn_summaries: checkpoint.turn_summaries.slice(),
    omitted_evidence_count: checkpoint.working_set.omitted_evidence_count,
    omitted_turn_count: checkpoint.working_set.omitted_turn_count,
    provider_audit: checkpoint.working_set.provider_audit,
    blockers: [message || "Commander investigation controller rejected after durable start"],
    warnings: [...checkpoint.working_set.current_warnings, "Durable Commander investigation was terminalized after controller rejection."].slice(0, 16),
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: Math.max(0, now.getTime() - Date.parse(startedAt || completedAt)),
    investigation_event_count: state.investigation_event_count,
    in_memory_only: false,
    transcript_persisted: false,
    working_set_persisted: state.checkpoint_count > 0,
    investigation_events_appended: state.investigation_event_count > 0,
    external_api_audit_events_appended: checkpoint.external_api_audit_count,
    events_appended: state.investigation_event_count > 0 || checkpoint.external_api_audit_count > 0,
    files_written: false,
    research_db_written: false,
    mission_mutated: false,
    proposal_mutated: false,
    opencode_action_performed: false,
    github_action_performed: false,
    mcp_called: false,
    external_research_called: false,
    result_hash: resultHash,
  }
}

function durableOverrideResult(original: CommanderInvestigationResult, result: CommanderInvestigationResult): CommanderInvestigationResult {
  return {
    ...result,
    result_hash: stableHash({
      semantic: original.result_hash,
      status: result.status,
      stop_reason: result.stop_reason,
      blockers: result.blockers,
      provider_request_count: result.provider_request_count,
      tool_call_count: result.tool_call_count,
      investigation_event_count: result.investigation_event_count,
      external_api_audit_events_appended: result.external_api_audit_events_appended,
    }),
  }
}

function operationalMemorySourceKinds(value: CommanderOperationalMemorySearchInput["source_kinds"]): string[] {
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean)
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean)
  return []
}

function operationalMemoryStatuses(value: CommanderOperationalMemorySearchInput["statuses"]): string[] {
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean)
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean)
  return []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
