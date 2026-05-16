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

class ResearchRuntime implements RuntimeClient {
  readonly calls: string[] = []

  async *stream(): AsyncIterable<RuntimeEvent> {}
  async sendUserMessage(): Promise<void> {}
  async sendCommand(): Promise<unknown> {
    return { ok: true }
  }
  async command(name: string, payload?: Record<string, unknown>): Promise<unknown> {
    this.calls.push(`${name}:${JSON.stringify(payload ?? {})}`)
    switch (name) {
      case "research.list_topics":
        return [
          { id: "topic-secret", title: "token=topic-secret", status: "active", created_at: "2026-05-16T00:00:00Z" },
          { id: "topic-2", title: "Second topic", status: "open" },
        ]
      case "research.get_topic_snapshot":
        return {
          topic: { id: payload?.topicId, title: "Selected topic", status: "active" },
          sources: [],
          notes: [],
          artifacts: [],
          stats: {
            source_count: 2,
            note_count: 3,
            artifact_count: 4,
            report_count: 1,
            reviewed_source_count: 1,
            rejected_source_count: 0,
          },
          latest_event: {
            event_id: "event-1",
            event_type: "topic_created",
            entity_type: "topic",
            entity_id: payload?.topicId,
            payload: { secret: "not rendered" },
            created_at: "2026-05-16T00:00:00Z",
          },
        }
      case "research.search_notes":
        return [
          {
            id: "note-1",
            topic_id: payload?.topicId,
            source_id: "source-1",
            content: `note token=note-secret ${(payload?.query as string) ?? ""}`,
            tags: ["secret=tag-secret", "safe"],
            created_at: "2026-05-16T00:00:00Z",
          },
        ]
      case "research.list_events":
        return [
          {
            event_id: "event-1",
            event_type: "note_added",
            entity_type: "note",
            entity_id: "note-1",
            payload: { token: "payload-secret" },
            created_at: "2026-05-16T00:00:00Z",
          },
        ]
      case "research.projection_status":
      case "research.rebuild_projection":
        return { mode: "auto_rebuild", ok: true, stale: false, reason: "token=projection-secret", pending_count: 0, last_event_id: "event-1" }
      default:
        return { ok: true }
    }
  }
}

class FailingResearchRuntime extends ResearchRuntime {
  async command(name: string): Promise<unknown> {
    if (name.startsWith("research.")) throw new Error("research failed token=research-secret")
    return super.command(name)
  }
}

describe("runtime UI effects", () => {
  test("recent mission refresh advances last and active mission to newest row", async () => {
    const state = {
      ...initialState("/tmp/demo"),
      lastCommand: "missions",
      runtimeCommandError: "previous failure",
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
    expect(next.runtimeCommandError).toBeUndefined()
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

  test("research command loads projection, topics, and events", async () => {
    const runtime = new ResearchRuntime()
    const state = initialState("/tmp/demo")

    const next = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "research" })

    expect(next.research?.projection?.mode).toBe("auto_rebuild")
    expect(next.research?.projection?.reason).toBe("[REDACTED]")
    expect(next.research?.topics[0]).toMatchObject({ id: "topic-secret", title: "[REDACTED]", status: "active" })
    expect(next.research?.events[0]).toMatchObject({ event_type: "note_added", entity_type: "note", entity_id: "note-1" })
    expect(JSON.stringify(next)).not.toContain("payload-secret")
  })

  test("topic notes events projection and rebuild commands map to research runtime commands", async () => {
    const runtime = new ResearchRuntime()
    let state = initialState("/tmp/demo")

    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "topic", args: ["topic-1"] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "notes", args: ["topic-1", "runtime", "query"] })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "research-events" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "projection" })
    state = await applyRuntimeUiEffect(state, runtime, { type: "send-command", command: "rebuild-projection" })

    expect(state.research?.selectedTopic?.stats).toMatchObject({ source_count: 2, note_count: 3, artifact_count: 4 })
    expect(state.research?.notes[0]?.content).toContain("[REDACTED]")
    expect(state.research?.lastQuery).toBe("runtime query")
    expect(runtime.calls.some((call) => call.startsWith("research.rebuild_projection"))).toBe(true)
    expect(runtime.calls.filter((call) => call.startsWith("research.projection_status"))).toHaveLength(2)
  })

  test("notes command clears stale selected topic when target topic changes", async () => {
    const state = {
      ...initialState("/tmp/demo"),
      research: {
        topics: [],
        notes: [],
        events: [],
        selectedTopicId: "topic-a",
        selectedTopic: {
          topic: { id: "topic-a", title: "Topic A", status: "active" },
          stats: {
            source_count: 1,
            note_count: 1,
            artifact_count: 0,
            report_count: 0,
            reviewed_source_count: 1,
            rejected_source_count: 0,
          },
        },
      },
    }

    const next = await applyRuntimeUiEffect(state, new ResearchRuntime(), {
      type: "send-command",
      command: "notes",
      args: ["topic-b", "runtime"],
    })

    expect(next.research?.selectedTopicId).toBe("topic-b")
    expect(next.research?.selectedTopic).toBeNull()
    expect(next.research?.notes[0]?.topic_id).toBe("topic-b")
  })

  test("notes command preserves selected topic when target topic matches", async () => {
    const selectedTopic = {
      topic: { id: "topic-1", title: "Topic 1", status: "active" },
      stats: {
        source_count: 1,
        note_count: 1,
        artifact_count: 0,
        report_count: 0,
        reviewed_source_count: 1,
        rejected_source_count: 0,
      },
    }
    const state = {
      ...initialState("/tmp/demo"),
      research: {
        topics: [],
        notes: [],
        events: [],
        selectedTopicId: "topic-1",
        selectedTopic,
      },
    }

    const next = await applyRuntimeUiEffect(state, new ResearchRuntime(), {
      type: "send-command",
      command: "notes",
      args: ["topic-1", "runtime"],
    })

    expect(next.research?.selectedTopic).toEqual(selectedTopic)
  })

  test("missing research command args produce redacted research errors", async () => {
    const next = await applyRuntimeUiEffect(initialState("/tmp/demo"), new ResearchRuntime(), {
      type: "send-command",
      command: "notes",
      args: ["topic-1"],
    })

    expect(next.research?.commandError).toBe("query is required")
    expect(next.systemActions.at(-1)).toMatchObject({ title: "research command error", status: "failed" })
  })

  test("failing research commands preserve runtime and mission state", async () => {
    const state = {
      ...initialState("/tmp/demo"),
      runtimeStatus: { runtimeStatus: "started", mode: "active", projectName: "demo", specApproved: true, lockHeld: true },
      missions: { pending_count: 1, failed_count: 0, recent: [{ mission_id: "mission-1", status: "sent" }] },
    }

    const next = await applyRuntimeUiEffect(state, new FailingResearchRuntime(), { type: "send-command", command: "projection" })

    expect(next.runtimeStatus).toEqual(state.runtimeStatus)
    expect(next.missions).toEqual(state.missions)
    expect(next.research?.commandError).toBe("research failed [REDACTED]")
  })
})
