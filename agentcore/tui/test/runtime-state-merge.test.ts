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

  test("preserves new effect action when effect result action list is capped", () => {
    const baselineActions = Array.from({ length: 12 }, (_, index) => ({ title: `baseline-${index + 1}` }))
    const baseline: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      systemActions: baselineActions,
    }
    const current: UiState = {
      ...baseline,
      systemActions: baselineActions,
    }
    const effectAction = { title: "mission submitted", detail: "mission_id=mission-1 intent_id=intent-1" }
    const effectResult: UiState = {
      ...baseline,
      systemActions: [...baselineActions, effectAction].slice(-12),
    }

    const merged = mergeRuntimeEffectState(current, effectResult, baseline.systemActions.length, baseline)

    expect(merged.systemActions).toHaveLength(12)
    expect(merged.systemActions.at(-1)).toEqual(effectAction)
    expect(merged.systemActions[0]).toEqual({ title: "baseline-2" })
  })

  test("preserves newer research state while keeping older research effect actions", () => {
    const baseline: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      research: {
        topics: [{ id: "topic-old", title: "Old topic", status: "open" }],
        selectedTopic: null,
        notes: [],
        events: [],
      },
      systemActions: [{ title: "user command -> runtime", detail: "topics" }],
    }
    const current: UiState = {
      ...baseline,
      research: {
        ...baseline.research!,
        topics: [{ id: "topic-new", title: "New topic", status: "active" }],
      },
    }
    const olderEffectResult: UiState = {
      ...baseline,
      research: {
        ...baseline.research!,
        topics: [{ id: "topic-older-result", title: "Older result", status: "paused" }],
        commandError: "older failure",
      },
      systemActions: [
        ...baseline.systemActions,
        { title: "research command error", detail: "older failure", status: "failed" },
      ],
    }

    const merged = mergeRuntimeEffectState(current, olderEffectResult, baseline.systemActions.length, baseline)

    expect(merged.research?.topics[0]?.id).toBe("topic-new")
    expect(merged.research?.commandError).toBeUndefined()
    expect(merged.systemActions.at(-1)).toEqual({
      title: "research command error",
      detail: "older failure",
      status: "failed",
    })
  })

  test("preserves newer mission execution state while keeping older effect actions", () => {
    const baseline: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      missionExecution: {
        selectedMissionId: "mission-old",
        claims: [{ claim_id: "claim-old", mission_id: "mission-old", executor_id: "executor-old", status: "active" }],
        progress: [],
        results: [],
      },
      systemActions: [{ title: "user command -> runtime", detail: "claim mission-old executor-old" }],
    }
    const current: UiState = {
      ...baseline,
      missionExecution: {
        selectedMissionId: "mission-new",
        selectedClaimId: "claim-new",
        claims: [{ claim_id: "claim-new", mission_id: "mission-new", executor_id: "executor-new", status: "active" }],
        progress: [],
        results: [],
      },
    }
    const olderEffectResult: UiState = {
      ...baseline,
      missionExecution: {
        ...baseline.missionExecution!,
        commandError: "older claim failed",
      },
      systemActions: [
        ...baseline.systemActions,
        { title: "mission execution command error", detail: "older claim failed", status: "failed" },
      ],
    }

    const merged = mergeRuntimeEffectState(current, olderEffectResult, baseline.systemActions.length, baseline)

    expect(merged.missionExecution?.selectedMissionId).toBe("mission-new")
    expect(merged.missionExecution?.selectedClaimId).toBe("claim-new")
    expect(merged.missionExecution?.commandError).toBeUndefined()
    expect(merged.systemActions.at(-1)).toEqual({
      title: "mission execution command error",
      detail: "older claim failed",
      status: "failed",
    })
  })
})
