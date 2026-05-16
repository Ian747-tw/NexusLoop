import { describe, expect, test } from "bun:test"
import type { RuntimeEvent } from "../src/events"
import { applyRuntimeUiEffect } from "../src/runtime-effects"
import type { RuntimeClient } from "../src/runtime"
import { initialState } from "../src/state"

class RecentMissionRuntime implements RuntimeClient {
  async *stream(): AsyncIterable<RuntimeEvent> {}
  async sendUserMessage(): Promise<void> {}
  async sendCommand(): Promise<unknown> {
    return { ok: true }
  }
  async command(name: string): Promise<unknown> {
    if (name === "runtime.list_recent_missions") {
      return [
        {
          mission_id: "mission-new",
          intent_id: "intent-new",
          status: "sent",
          objective: "new mission",
          created_at: "2026-05-16T00:00:00Z",
          updated_at: "2026-05-16T00:00:00Z",
        },
      ]
    }
    return { ok: true }
  }
}

class RejectingRuntime implements RuntimeClient {
  commandCalls = 0
  sendCommandCalls = 0

  async *stream(): AsyncIterable<RuntimeEvent> {}
  async sendUserMessage(): Promise<void> {}
  async sendCommand(): Promise<unknown> {
    this.sendCommandCalls += 1
    throw new Error("runtime should not receive init command")
  }
  async command(): Promise<unknown> {
    this.commandCalls += 1
    throw new Error("runtime should not receive init command")
  }
}

class RefreshFailAfterSubmitRuntime implements RuntimeClient {
  async *stream(): AsyncIterable<RuntimeEvent> {}
  async sendUserMessage(): Promise<{ accepted: true; missionId: string; intentId: string }> {
    return { accepted: true, missionId: "mission-created", intentId: "intent-created" }
  }
  async sendCommand(): Promise<unknown> {
    return { ok: true }
  }
  async command(): Promise<unknown> {
    throw new Error("refresh failed after accepted mission")
  }
}

class CountingRuntime implements RuntimeClient {
  readonly calls: string[] = []

  async *stream(): AsyncIterable<RuntimeEvent> {}
  async sendUserMessage(): Promise<void> {}
  async sendCommand(): Promise<unknown> {
    return { ok: true }
  }
  async command(name: string): Promise<unknown> {
    this.calls.push(name)
    if (name === "runtime.list_recent_missions") return []
    return {
      runtimeStatus: "started",
      mode: "active",
      projectName: "demo",
      specApproved: true,
      lockHeld: true,
    }
  }
}

describe("runtime UI effects", () => {
  test("recent mission refresh advances last and active mission to newest row", async () => {
    const state = {
      ...initialState("/tmp/demo"),
      missions: {
        pending_count: 0,
        failed_count: 0,
        active_claim_count: 0,
        completed_count: 0,
        cancelled_count: 0,
        last_mission_id: "mission-old",
        recent: [{ mission_id: "mission-old", status: "sent" }],
      },
      header: {
        ...initialState("/tmp/demo").header,
        activeMissionId: "mission-old",
      },
    }

    const next = await applyRuntimeUiEffect(state, new RecentMissionRuntime(), { type: "load-recent-missions" })

    expect(next.missions?.last_mission_id).toBe("mission-new")
    expect(next.header.activeMissionId).toBe("mission-new")
    expect(next.missions?.recent).toEqual([
      {
        mission_id: "mission-new",
        intent_id: "intent-new",
        objective: "new mission",
        status: "sent",
        created_at: "2026-05-16T00:00:00Z",
        updated_at: "2026-05-16T00:00:00Z",
      },
    ])
  })

  test("init-only commands are handled locally without runtime dispatch", async () => {
    const runtime = new RejectingRuntime()
    const state = initialState("/tmp/demo")

    const next = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "initialize" })

    expect(next.lastCommand).toBe("initialize")
    expect(next.runtimeCommandError).toBeUndefined()
    expect(runtime.commandCalls).toBe(0)
    expect(runtime.sendCommandCalls).toBe(0)
  })

  test("post-submit refresh failure preserves accepted mission state", async () => {
    const state = initialState("/tmp/demo")

    const next = await applyRuntimeUiEffect(state, new RefreshFailAfterSubmitRuntime(), {
      type: "send-user-message",
      message: "start mission",
    })

    expect(next.header.activeMissionId).toBe("mission-created")
    expect(next.systemActions.some((action) => action.title === "mission submitted")).toBe(true)
    expect(next.runtimeCommandError).toBe("refresh failed after accepted mission")
  })

  test("status and missions commands do not run duplicate follow-up refreshes", async () => {
    const runtime = new CountingRuntime()
    const state = initialState("/tmp/demo")

    await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "status" })
    await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "missions" })

    expect(runtime.calls).toEqual(["runtime.status", "runtime.list_recent_missions"])
  })
})
