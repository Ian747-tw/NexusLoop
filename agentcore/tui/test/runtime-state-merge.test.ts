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

  test("preserves newer runtime surface while keeping older effect outcome actions", () => {
    const baseline: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      systemActions: [{ title: "user command -> runtime", detail: "status" }],
      header: {
        ...initialState("/tmp/demo").header,
        activeMissionId: "mission-old",
      },
      missions: {
        pending_count: 1,
        failed_count: 0,
        active_claim_count: 0,
        completed_count: 0,
        cancelled_count: 0,
        last_mission_id: "mission-old",
        recent: [{ mission_id: "mission-old", status: "pending" }],
      },
    }
    const current: UiState = {
      ...baseline,
      runtimeCommandError: undefined,
      lastCommand: "missions",
      header: {
        ...baseline.header,
        activeMissionId: "mission-new",
      },
      missions: {
        ...baseline.missions!,
        last_mission_id: "mission-new",
        recent: [{ mission_id: "mission-new", status: "pending" }],
      },
    }
    const olderEffectResult: UiState = {
      ...baseline,
      runtimeCommandError: "older command failed",
      lastCommand: "status",
      systemActions: [
        ...baseline.systemActions,
        { title: "runtime command error", detail: "older command failed", status: "failed" },
      ],
    }

    const merged = mergeRuntimeEffectState(current, olderEffectResult, baseline.systemActions.length, baseline)

    expect(merged.missions?.last_mission_id).toBe("mission-new")
    expect(merged.header.activeMissionId).toBe("mission-new")
    expect(merged.lastCommand).toBe("missions")
    expect(merged.runtimeCommandError).toBeUndefined()
    expect(merged.systemActions.at(-1)).toEqual({
      title: "runtime command error",
      detail: "older command failed",
      status: "failed",
    })
  })

  test("default merge preserves startup refresh error actions", () => {
    const current: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      systemActions: [{ title: "stream event", detail: "ready" }],
    }
    const effectResult: UiState = {
      ...initialState("/tmp/demo"),
      runtimeCommandError: "runtime failed",
      systemActions: [{ title: "runtime command error", detail: "runtime failed", status: "failed" }],
    }

    const merged = mergeRuntimeEffectState(current, effectResult)

    expect(merged.systemActions).toEqual([
      { title: "stream event", detail: "ready" },
      { title: "runtime command error", detail: "runtime failed", status: "failed" },
    ])
    expect(merged.runtimeCommandError).toBe("runtime failed")
  })
})
