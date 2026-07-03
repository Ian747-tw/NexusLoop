import { executionCommandFor } from "./operator-actions"
import type { UiState } from "./state"

export function mergeRuntimeEffectState(current: UiState, next: UiState, previousActionCount = 0, baseline?: UiState): UiState {
  const addedActions = addedSystemActions(next.systemActions, previousActionCount, baseline?.systemActions)
  const canUpdateRuntimeStatus = baseline === undefined || stableEqual(current.runtimeStatus, baseline.runtimeStatus)
  const canUpdateAdapterStatus = baseline === undefined || stableEqual(current.adapterStatus, baseline.adapterStatus)
  const canUpdateResearchProjection =
    baseline === undefined || stableEqual(current.researchProjection, baseline.researchProjection)
  const canUpdateMissions = baseline === undefined || stableEqual(current.missions, baseline.missions)
  const canUpdateMissionExecution =
    baseline === undefined || stableEqual(current.missionExecution, baseline.missionExecution)
  const canUpdateResearch = baseline === undefined || stableEqual(current.research, baseline.research)
  const canUpdateReviews = baseline === undefined || stableEqual(current.reviews, baseline.reviews)
  const canUpdateProposals = baseline === undefined || stableEqual(current.proposals, baseline.proposals)
  const canUpdateProposalBundles = baseline === undefined || stableEqual(current.proposalBundles, baseline.proposalBundles)
  const canUpdateCommanderPlaybooks = baseline === undefined || stableEqual(current.commanderPlaybooks, baseline.commanderPlaybooks)
  const canUpdateCommanderWorkbench = baseline === undefined || stableEqual(current.commanderWorkbench, baseline.commanderWorkbench)
  const canUpdateCommanderApply = baseline === undefined || stableEqual(current.commanderApply, baseline.commanderApply)
  const canUpdateCommanderAudit = baseline === undefined || stableEqual(current.commanderAudit, baseline.commanderAudit)
  const canUpdateCommanderQueues = baseline === undefined || stableEqual(current.commanderQueues, baseline.commanderQueues)
  const canUpdateOperatorActions =
    baseline === undefined || stableOperatorActionsEqual(current.operatorActions, baseline.operatorActions)
  const canUpdateExternalApi = baseline === undefined || stableEqual(current.externalApi, baseline.externalApi)
  const canUpdateOpenCodeProcessSmoke =
    baseline === undefined || stableEqual(current.opencodeProcessSmoke, baseline.opencodeProcessSmoke)
  const canUpdateOpenCodeHandoffReadiness =
    baseline === undefined || stableEqual(current.opencodeHandoffReadiness, baseline.opencodeHandoffReadiness)
  const canUpdateOpenCodeResultReview =
    baseline === undefined || stableEqual(current.opencodeResultReview, baseline.opencodeResultReview)
  const canUpdateOpenCodeSessions =
    baseline === undefined || stableEqual(current.opencodeSessions, baseline.opencodeSessions)
  const canUpdateContextBudgets =
    baseline === undefined || stableEqual(current.contextBudgets, baseline.contextBudgets)
  const canUpdateContextPackets =
    baseline === undefined || stableEqual(current.contextPackets, baseline.contextPackets)
  const canUpdateOpenCodeSessionInstructionPacks =
    baseline === undefined || stableEqual(current.opencodeSessionInstructionPacks, baseline.opencodeSessionInstructionPacks)
  const canUpdateOpenCodeLaunchReadiness =
    baseline === undefined || stableEqual(current.opencodeLaunchReadiness, baseline.opencodeLaunchReadiness)
  const canUpdateOpenCodeLaunches =
    baseline === undefined || stableEqual(current.opencodeLaunches, baseline.opencodeLaunches)
  const canUpdateOpenCodeProgress =
    baseline === undefined || stableEqual(current.opencodeProgress, baseline.opencodeProgress)
  const canUpdateOpenCodeWatchdog =
    baseline === undefined || stableEqual(current.opencodeWatchdog, baseline.opencodeWatchdog)
  const canUpdateOpenCodeCommanderQuestions =
    baseline === undefined || stableEqual(current.opencodeCommanderQuestions, baseline.opencodeCommanderQuestions)
  const canUpdateCommanderGuidance =
    baseline === undefined || stableEqual(current.commanderGuidance, baseline.commanderGuidance)
  const canUpdateCommanderGuidanceDelivery =
    baseline === undefined || stableEqual(current.commanderGuidanceDelivery, baseline.commanderGuidanceDelivery)
  const canUpdateResearchMemory =
    baseline === undefined || stableEqual(current.researchMemory, baseline.researchMemory)
  const canUpdateCommanderExecutorReview =
    baseline === undefined || stableEqual(current.commanderExecutorReview, baseline.commanderExecutorReview)
  const canUpdateExecutorReviewProposalDrafts =
    baseline === undefined || stableEqual(current.executorReviewProposalDrafts, baseline.executorReviewProposalDrafts)
  const canUpdateExecutorReviewProposalCreate =
    baseline === undefined || stableEqual(current.executorReviewProposalCreate, baseline.executorReviewProposalCreate)
  const canUpdateExecutorReviewProposalReviewRequest =
    baseline === undefined || stableEqual(current.executorReviewProposalReviewRequest, baseline.executorReviewProposalReviewRequest)
  const canUpdateExecutorReviewProposalReviewDecision =
    baseline === undefined || stableEqual(current.executorReviewProposalReviewDecision, baseline.executorReviewProposalReviewDecision)
  const canUpdateExecutorReviewProposalApplyReadiness =
    baseline === undefined || stableEqual(current.executorReviewProposalApplyReadiness, baseline.executorReviewProposalApplyReadiness)
  const canUpdateExecutorReviewProposalNarrowApply =
    baseline === undefined || stableEqual(current.executorReviewProposalNarrowApply, baseline.executorReviewProposalNarrowApply)
  const canUpdateMiniMaxLiveValidation =
    baseline === undefined || stableEqual(current.minimaxLiveValidation, baseline.minimaxLiveValidation)
  const canUpdateRuntimeCommandError =
    baseline === undefined ||
    (stableEqual(current.runtimeCommandError, baseline.runtimeCommandError) &&
      stableEqual(current.lastCommand, baseline.lastCommand))
  const canUpdateLastCommand = baseline === undefined || stableEqual(current.lastCommand, baseline.lastCommand)
  const canUpdateProjectName = canUpdateRuntimeStatus || current.header.projectName === baseline?.header.projectName
  const canUpdateHeaderRuntimeStatus =
    canUpdateRuntimeStatus || current.header.runtimeStatus === baseline?.header.runtimeStatus
  const canUpdateActiveMissionId = canUpdateMissions || current.header.activeMissionId === baseline?.header.activeMissionId
  const mergedMissionExecution = canUpdateMissionExecution ? next.missionExecution : current.missionExecution
  const missionExecutionChanged =
    canUpdateMissionExecution && !stableEqual(next.missionExecution, baseline?.missionExecution)
  const missionExecutionActiveMissionId = missionExecutionChanged
    ? next.missionExecution?.selectedMissionId
    : undefined

  return {
    ...current,
    systemActions: addedActions.length > 0 ? [...current.systemActions, ...addedActions].slice(-12) : current.systemActions,
    runtimeStatus: canUpdateRuntimeStatus ? next.runtimeStatus : current.runtimeStatus,
    adapterStatus: canUpdateAdapterStatus ? next.adapterStatus : current.adapterStatus,
    researchProjection: canUpdateResearchProjection ? next.researchProjection : current.researchProjection,
    missions: canUpdateMissions ? next.missions : current.missions,
    missionExecution: mergedMissionExecution,
    research: canUpdateResearch ? next.research : current.research,
    reviews: canUpdateReviews ? next.reviews : current.reviews,
    proposals: canUpdateProposals ? next.proposals : current.proposals,
    proposalBundles: canUpdateProposalBundles ? next.proposalBundles : current.proposalBundles,
    commanderPlaybooks: canUpdateCommanderPlaybooks ? next.commanderPlaybooks : current.commanderPlaybooks,
    commanderWorkbench: canUpdateCommanderWorkbench ? next.commanderWorkbench : current.commanderWorkbench,
    commanderApply: canUpdateCommanderApply ? next.commanderApply : current.commanderApply,
    commanderAudit: canUpdateCommanderAudit ? next.commanderAudit : current.commanderAudit,
    commanderQueues: canUpdateCommanderQueues ? next.commanderQueues : current.commanderQueues,
    operatorActions: canUpdateOperatorActions ? next.operatorActions : current.operatorActions,
    externalApi: canUpdateExternalApi ? next.externalApi : current.externalApi,
    opencodeProcessSmoke: canUpdateOpenCodeProcessSmoke ? next.opencodeProcessSmoke : current.opencodeProcessSmoke,
    opencodeHandoffReadiness: canUpdateOpenCodeHandoffReadiness ? next.opencodeHandoffReadiness : current.opencodeHandoffReadiness,
    opencodeResultReview: canUpdateOpenCodeResultReview ? next.opencodeResultReview : current.opencodeResultReview,
    opencodeSessions: canUpdateOpenCodeSessions ? next.opencodeSessions : current.opencodeSessions,
    contextBudgets: canUpdateContextBudgets ? next.contextBudgets : current.contextBudgets,
    contextPackets: canUpdateContextPackets ? next.contextPackets : current.contextPackets,
    opencodeSessionInstructionPacks: canUpdateOpenCodeSessionInstructionPacks ? next.opencodeSessionInstructionPacks : current.opencodeSessionInstructionPacks,
    opencodeLaunchReadiness: canUpdateOpenCodeLaunchReadiness ? next.opencodeLaunchReadiness : current.opencodeLaunchReadiness,
    opencodeLaunches: canUpdateOpenCodeLaunches ? next.opencodeLaunches : current.opencodeLaunches,
    opencodeProgress: canUpdateOpenCodeProgress ? next.opencodeProgress : current.opencodeProgress,
    opencodeWatchdog: canUpdateOpenCodeWatchdog ? next.opencodeWatchdog : current.opencodeWatchdog,
    opencodeCommanderQuestions: canUpdateOpenCodeCommanderQuestions ? next.opencodeCommanderQuestions : current.opencodeCommanderQuestions,
    commanderGuidance: canUpdateCommanderGuidance ? next.commanderGuidance : current.commanderGuidance,
    commanderGuidanceDelivery: canUpdateCommanderGuidanceDelivery ? next.commanderGuidanceDelivery : current.commanderGuidanceDelivery,
    researchMemory: canUpdateResearchMemory ? next.researchMemory : current.researchMemory,
    commanderExecutorReview: canUpdateCommanderExecutorReview ? next.commanderExecutorReview : current.commanderExecutorReview,
    executorReviewProposalDrafts: canUpdateExecutorReviewProposalDrafts ? next.executorReviewProposalDrafts : current.executorReviewProposalDrafts,
    executorReviewProposalCreate: canUpdateExecutorReviewProposalCreate ? next.executorReviewProposalCreate : current.executorReviewProposalCreate,
    executorReviewProposalReviewRequest: canUpdateExecutorReviewProposalReviewRequest ? next.executorReviewProposalReviewRequest : current.executorReviewProposalReviewRequest,
    executorReviewProposalReviewDecision: canUpdateExecutorReviewProposalReviewDecision ? next.executorReviewProposalReviewDecision : current.executorReviewProposalReviewDecision,
    executorReviewProposalApplyReadiness: canUpdateExecutorReviewProposalApplyReadiness ? next.executorReviewProposalApplyReadiness : current.executorReviewProposalApplyReadiness,
    executorReviewProposalNarrowApply: canUpdateExecutorReviewProposalNarrowApply ? next.executorReviewProposalNarrowApply : current.executorReviewProposalNarrowApply,
    minimaxLiveValidation: canUpdateMiniMaxLiveValidation ? next.minimaxLiveValidation : current.minimaxLiveValidation,
    runtimeCommandError: canUpdateRuntimeCommandError ? next.runtimeCommandError : current.runtimeCommandError,
    lastCommand: canUpdateLastCommand ? next.lastCommand : current.lastCommand,
    header: {
      ...current.header,
      projectName: canUpdateProjectName ? next.header.projectName : current.header.projectName,
      runtimeStatus: canUpdateHeaderRuntimeStatus ? next.header.runtimeStatus : current.header.runtimeStatus,
      activeMissionId: missionExecutionActiveMissionId ?? (canUpdateActiveMissionId ? next.header.activeMissionId : current.header.activeMissionId),
    },
  }
}

function stableEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function stableOperatorActionsEqual(left: UiState["operatorActions"], right: UiState["operatorActions"]): boolean {
  return stableEqual(operatorActionsComparable(left), operatorActionsComparable(right))
}

function operatorActionsComparable(actions: UiState["operatorActions"]): unknown {
  if (!actions?.staged) return actions
  return {
    ...actions,
    staged: {
      ...actions.staged,
      execution_command: executionCommandFor(actions.staged),
    },
  }
}

function addedSystemActions(
  nextActions: UiState["systemActions"],
  previousActionCount: number,
  baselineActions?: UiState["systemActions"],
): UiState["systemActions"] {
  if (baselineActions === undefined) return nextActions.slice(previousActionCount)
  const overlap = overlappingActionCount(baselineActions, nextActions)
  return nextActions.slice(overlap)
}

function overlappingActionCount(
  baselineActions: UiState["systemActions"],
  nextActions: UiState["systemActions"],
): number {
  const max = Math.min(baselineActions.length, nextActions.length)
  for (let count = max; count > 0; count -= 1) {
    const baselineSuffix = baselineActions.slice(baselineActions.length - count)
    const nextPrefix = nextActions.slice(0, count)
    if (stableEqual(baselineSuffix, nextPrefix)) return count
  }
  return 0
}
