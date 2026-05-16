import { describe, expect, test } from "bun:test"
import { snapshotUiState } from "../src/state-snapshot"
import { initialState } from "../src/state"

describe("TUI state snapshot", () => {
  test("captures an immutable baseline for async runtime effects", () => {
    const state = initialState("/tmp/demo")
    state.systemActions.push({ title: "before" })

    const snapshot = snapshotUiState(state)
    state.systemActions.push({ title: "after" })
    state.header.activeMissionId = "mission-after"

    expect(snapshot.systemActions).toEqual([{ title: "before" }])
    expect(snapshot.header.activeMissionId).toBe("none")
  })
})
