import type { UiState } from "./state"

export function snapshotUiState(state: UiState): UiState {
  return JSON.parse(JSON.stringify(state)) as UiState
}
