import type { UiState } from "./state"

export function mergeRuntimeEffectState(current: UiState, next: UiState, previousActionCount = 0, baseline?: UiState): UiState {
  const addedActions = addedSystemActions(next.systemActions, previousActionCount, baseline?.systemActions)
  const canUpdateRuntimeStatus = baseline === undefined || stableEqual(current.runtimeStatus, baseline.runtimeStatus)
  const canUpdateAdapterStatus = baseline === undefined || stableEqual(current.adapterStatus, baseline.adapterStatus)
  const canUpdateResearchProjection =
    baseline === undefined || stableEqual(current.researchProjection, baseline.researchProjection)
  const canUpdateMissions = baseline === undefined || stableEqual(current.missions, baseline.missions)
  const canUpdateRuntimeCommandError =
    baseline === undefined ||
    (stableEqual(current.runtimeCommandError, baseline.runtimeCommandError) &&
      stableEqual(current.lastCommand, baseline.lastCommand))
  const canUpdateLastCommand = baseline === undefined || stableEqual(current.lastCommand, baseline.lastCommand)
  const canUpdateProjectName = canUpdateRuntimeStatus || current.header.projectName === baseline?.header.projectName
  const canUpdateHeaderRuntimeStatus =
    canUpdateRuntimeStatus || current.header.runtimeStatus === baseline?.header.runtimeStatus
  const canUpdateActiveMissionId = canUpdateMissions || current.header.activeMissionId === baseline?.header.activeMissionId

  return {
    ...current,
    systemActions: addedActions.length > 0 ? [...current.systemActions, ...addedActions].slice(-12) : current.systemActions,
    runtimeStatus: canUpdateRuntimeStatus ? next.runtimeStatus : current.runtimeStatus,
    adapterStatus: canUpdateAdapterStatus ? next.adapterStatus : current.adapterStatus,
    researchProjection: canUpdateResearchProjection ? next.researchProjection : current.researchProjection,
    missions: canUpdateMissions ? next.missions : current.missions,
    runtimeCommandError: canUpdateRuntimeCommandError ? next.runtimeCommandError : current.runtimeCommandError,
    lastCommand: canUpdateLastCommand ? next.lastCommand : current.lastCommand,
    header: {
      ...current.header,
      projectName: canUpdateProjectName ? next.header.projectName : current.header.projectName,
      runtimeStatus: canUpdateHeaderRuntimeStatus ? next.header.runtimeStatus : current.header.runtimeStatus,
      activeMissionId: canUpdateActiveMissionId ? next.header.activeMissionId : current.header.activeMissionId,
    },
  }
}

function stableEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
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
