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
import { ContextBudgetService, readContextBudgetPreviewInput, readModelCapabilityGetInput, readModelCapabilityListInput } from "./context/context-budget-service"
import type { ContextBudgetPreview, ContextBudgetSummary } from "./context/context-budget-types"
import { ModelCapabilityRegistry } from "./context/model-capability-registry"
import type { ModelCapability } from "./context/model-capability-types"
import { ContextPacketCompilerService, readContextPacketPreviewInput } from "./context/context-packet-compiler-service"
import type { ContextPacketPreview, ContextPacketSummary } from "./context/context-packet-types"
import { ResearchMemoryService, readResearchMemoryRetrievalInput, type ResearchMemoryReadAdapter } from "./research-memory/research-memory-service"
import { ResearchNoveltyService, readResearchNoveltyInput } from "./research-memory/research-novelty-service"
import type { ResearchMemoryRetrievalPreview, ResearchMemorySummary, ResearchNoveltyPreview } from "./research-memory/research-memory-types"
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
import { MissionToolRouter } from "./missions/mission-tool-router"
import type { ExecutorToolCall, ExecutorToolResult } from "./missions/mission-tool-types"
import { PolicyService } from "./spec/policy-service"
import { SpecService, type SpecSummary } from "./spec/spec-service"
import { redactText, redactValue } from "./security/redaction"
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
} from "./research-db/research-db"

const EXECUTOR_SHUTDOWN_DRAIN_TIMEOUT_MS = 50

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
  getTopic(id: string): Topic | null
  addSource(input: Parameters<ExternalApiResearchDbWriter["addSource"]>[0]): ReturnType<ExternalApiResearchDbWriter["addSource"]>
  addNote(input: Parameters<ExternalApiResearchDbWriter["addNote"]>[0]): ReturnType<ExternalApiResearchDbWriter["addNote"]>
  addArtifact(input: Parameters<ExternalApiResearchDbWriter["addArtifact"]>[0]): ReturnType<ExternalApiResearchDbWriter["addArtifact"]>
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
    this.externalApiEnv = options.externalApiEnv ?? {}
    this.externalApiResolveHostAddresses = options.externalApiResolveHostAddresses
    this.externalApiNow = options.externalApiNow
    this.externalApiRequestId = options.externalApiRequestId
    this.reasoningProviderConfig = validateReasoningProviderConfig(options.reasoningProviderConfig ?? defaultReasoningProviderConfig())
    this.modelCapabilityRegistry = new ModelCapabilityRegistry({ reasoningProviderConfig: this.reasoningProviderConfig })
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
    this.researchDbFactory = options.researchDbFactory ?? ((projectDir) => ResearchDb.open(projectDir))
    this.commanderQueueNow = options.commanderQueueNow
    this.researchProjectionHealth = {
      mode: this.researchProjectionMode,
      ok: this.researchProjectionMode === "disabled",
      stale: false,
      reason: this.researchProjectionMode === "disabled" ? "disabled" : "not checked",
      pending_count: 0,
    }
  }

  async start(): Promise<void> {
    if (modeRequiresApprovedSpec(this.mode)) {
      this.specSummary = await this.specService.requireApproved()
    } else {
      const current = await this.specService.readCurrent()
      this.specSummary = current?.status === "approved" ? this.specService.toSummary(current) : null
    }
    await this.runLock.acquire()
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
      case "runtime.opencode_result_review_summary":
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
      case "runtime.research_memory_summary":
        return this.researchMemorySummary()
      case "runtime.preview_research_memory_retrieval":
        return this.previewResearchMemoryRetrieval(readResearchMemoryRetrievalInput(payload))
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

  researchMemorySummary(): ResearchMemorySummary {
    return this.researchMemoryService().summary()
  }

  previewResearchMemoryRetrieval(input: Parameters<ResearchMemoryService["preview"]>[0] = {}): ResearchMemoryRetrievalPreview {
    return this.researchMemoryService().preview(input)
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
    let firstError: unknown = null
    if (this.started || this.runLock.isHeld()) {
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
        }
      }
    } else {
      this.executorStreamAbort = true
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
    if (integrity.ok && !integrity.stale) return
    if (integrity.stale && this.researchProjectionMode === "auto_rebuild") {
      this.requireProjectionWriteLock(`research projection auto-rebuild during ${operation}`)
      this.rebuildProjection(operation)
      const rebuilt = this.checkResearchProjectionForStatus({ emit: true })
      if (rebuilt.ok && !rebuilt.stale) return
      throw new Error(`research projection rebuild did not produce a usable projection: ${rebuilt.reason ?? "unknown"}`)
    }

    const reason = integrity.reason ?? (integrity.stale ? "stale" : "unknown")
    if (integrity.stale) throw new Error(`research projection stale: ${reason}`)
    throw new Error(`research projection corrupt: ${reason}`)
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
      searchResearchResults: typeof db.searchResearchResults === "function" ? db.searchResearchResults.bind(db) : undefined,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
