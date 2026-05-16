import { describe, expect, test } from "bun:test"
import { mergeRuntimeEffectState } from "../src/runtime-state-merge"
import { initialState, type UiState } from "../src/state"

describe("interactive runtime effect state merge", () => {
  test("rebases async runtime effect fields without dropping newer stream state", () => {
    const base: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      systemActions: [{ title: "user command -> runtime", detail: "status" }],
    }
    const current: UiState = {
      ...base,
      executor: [{ title: "tool started: runtime.connect", status: "running" }],
      systemActions: [...base.systemActions, { title: "stream event", detail: "arrived while command was in flight" }],
    }
    const effectResult: UiState = {
      ...base,
      runtimeStatus: {
        runtimeStatus: "started",
        mode: "active",
        projectName: "demo",
        specApproved: true,
        lockHeld: true,
      },
      header: {
        ...base.header,
        projectName: "demo",
        runtimeStatus: "started",
        activeMissionId: "mission-1",
      },
      systemActions: [...base.systemActions, { title: "runtime command error", detail: "none" }],
    }

    const merged = mergeRuntimeEffectState(current, effectResult, base.systemActions.length)

    expect(merged.executor).toEqual(current.executor)
    expect(merged.systemActions).toEqual([
      { title: "user command -> runtime", detail: "status" },
      { title: "stream event", detail: "arrived while command was in flight" },
      { title: "runtime command error", detail: "none" },
    ])
    expect(merged.runtimeStatus?.runtimeStatus).toBe("started")
    expect(merged.header.activeMissionId).toBe("mission-1")
  })
})
