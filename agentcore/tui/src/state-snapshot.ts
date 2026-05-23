import { copyExecutionCommand } from "./operator-actions"
import type { UiState } from "./state"

export function snapshotUiState(state: UiState): UiState {
  const snapshot = JSON.parse(JSON.stringify(state)) as UiState
  if (state.operatorActions?.staged && snapshot.operatorActions?.staged) {
    copyExecutionCommand(state.operatorActions.staged, snapshot.operatorActions.staged)
  }
  const sourceSuggestions = state.commanderNavigation?.selected?.suggested_commands
  const snapshotSuggestions = snapshot.commanderNavigation?.selected?.suggested_commands
  if (sourceSuggestions && snapshotSuggestions) {
    for (let index = 0; index < Math.min(sourceSuggestions.length, snapshotSuggestions.length); index += 1) {
      copyExecutionCommand(sourceSuggestions[index], snapshotSuggestions[index])
    }
  }
  return snapshot
}
