import type { UiState } from "./state"

export function mergeRuntimeEffectState(current: UiState, next: UiState, previousActionCount = 0): UiState {
  const addedActions = next.systemActions.slice(previousActionCount)
  return {
    ...current,
    systemActions: addedActions.length > 0 ? [...current.systemActions, ...addedActions].slice(-12) : current.systemActions,
    runtimeStatus: next.runtimeStatus,
    adapterStatus: next.adapterStatus,
    researchProjection: next.researchProjection,
    missions: next.missions,
    runtimeCommandError: next.runtimeCommandError,
    lastCommand: next.lastCommand,
    header: {
      ...current.header,
      projectName: next.header.projectName,
      runtimeStatus: next.header.runtimeStatus,
      activeMissionId: next.header.activeMissionId,
    },
  }
}
