import { describe, expect, test } from "bun:test"
import { applyKeyCommand, applyKeyCommandWithEffects, parseRuntimeCommand } from "../src/keyboard"
import { initialState, type UiState } from "../src/state"

describe("TUI keyboard command model", () => {
  test("recovery approval slash parsing preserves the terminal raw note suffix", () => {
    expect(parseRuntimeCommand("/commander-recovery-approve investigation_id=inv confirm=APPROVE human_note=a  b  ")).toEqual({
      command: "commander-recovery-approve",
      args: ["investigation_id=inv", "confirm=APPROVE", "human_note=a  b  "],
    })
    expect(parseRuntimeCommand("/commander-recovery-approve investigation_id=inv confirm=APPROVE human_note=")).toEqual({
      command: "commander-recovery-approve",
      args: ["investigation_id=inv", "confirm=APPROVE", "human_note="],
    })
    expect(parseRuntimeCommand("/stage-command /commander-recovery-approve investigation_id=inv confirm=APPROVE human_note=a  b  ")).toEqual({
      command: "stage-command",
      args: ["/commander-recovery-approve investigation_id=inv confirm=APPROVE human_note=a  b  "],
    })
  })
  test("select Initialize enters model setup and loads server-owned recipes", () => {
    const state = { ...initialState("/tmp/demo"), screen: "init" as const, focus: "init-choice" as const }
    const next = applyKeyCommand(state, { type: "submit" })

    expect(next.screen).toBe("model-setup")
    expect(next.modelSetup.stage).toBe("loading")
    expect(next.modelSetup.origin).toBe("init")
  })

  test("submit message from message box", () => {
    let state: UiState = { ...initialState("/tmp/demo"), screen: "main", focus: "message-box" }
    state = applyKeyCommand(state, { type: "insert", text: "run smoke test" })
    state = applyKeyCommand(state, { type: "submit" })

    expect(state.messageDraft).toBe("")
    expect(state.submittedMessages).toEqual(["run smoke test"])
    expect(state.systemActions.at(-1)?.title).toBe("user -> runtime")
  })

  test("focus moves between panels", () => {
    let state: UiState = { ...initialState("/tmp/demo"), screen: "main", focus: "message-box" }
    state = applyKeyCommand(state, { type: "focus-next" })

    expect(state.focus).toBe("executor")

    state = applyKeyCommand(state, { type: "focus-prev" })
    expect(state.focus).toBe("message-box")
  })

  test("model setup keeps Commander and Executor choices independent", () => {
    let state: UiState = { ...initialState("/tmp/demo"), screen: "init", focus: "init-choice" }
    let result = applyKeyCommandWithEffects(state, { type: "submit" })
    expect(result.effects).toEqual([{ type: "load-model-setup", continueInitializationIfActive: true }])
    state = {
      ...result.state,
      modelSetup: {
        ...result.state.modelSetup,
        stage: "commander",
        commanderChoices: [{ id: "", label: "Leave Commander unconfigured" }, { id: "commander-a", label: "Commander A" }],
        executorChoices: [{ id: "", label: "Leave Executor unconfigured" }, { id: "executor-b", label: "Executor B" }],
      },
    }
    state = applyKeyCommand(state, { type: "select-next" })
    state = applyKeyCommand(state, { type: "submit" })
    expect(state.modelSetup.stage).toBe("executor")
    expect(state.modelSetup.commanderSelection).toBe(1)
    state = applyKeyCommand(state, { type: "submit" })
    expect(state.modelSetup.stage).toBe("preview")
  })

  test("committed first-run setup cannot enter the main shell before restart", () => {
    const state: UiState = {
      ...initialState("/tmp/demo"),
      screen: "model-setup",
      modelSetup: { ...initialState("/tmp/demo").modelSetup, stage: "committed", pendingRestart: true },
    }
    const result = applyKeyCommandWithEffects(state, { type: "submit" })
    expect(result.state.screen).toBe("model-setup")
    expect(result.state.modelSetup).toMatchObject({ stage: "committed", pendingRestart: true })
    expect(result.effects).toEqual([])
  })

  test("model setup cancellation returns to the screen that opened it", () => {
    const fromInit: UiState = {
      ...initialState("/tmp/demo"),
      screen: "model-setup",
      modelSetup: { ...initialState("/tmp/demo").modelSetup, origin: "init", stage: "commander" },
    }
    expect(applyKeyCommandWithEffects(fromInit, { type: "cancel" }).state).toMatchObject({ screen: "init", focus: "init-choice" })

    const fromMain: UiState = {
      ...initialState("/tmp/demo"),
      screen: "model-setup",
      modelSetup: { ...initialState("/tmp/demo").modelSetup, origin: "main", stage: "committed" },
    }
    expect(applyKeyCommandWithEffects(fromMain, { type: "cancel" }).state).toMatchObject({ screen: "main", focus: "message-box" })
  })

  test("model setup confirmation owns cancellation until the durable result settles", () => {
    const confirmation: UiState = {
      ...initialState("/tmp/demo"),
      screen: "model-setup",
      modelSetup: {
        ...initialState("/tmp/demo").modelSetup,
        stage: "confirmation",
        expectedRevision: 0,
        candidateHash: "a".repeat(64),
      },
    }
    const submitted = applyKeyCommandWithEffects(confirmation, { type: "submit" })
    expect(submitted.state.modelSetup.stage).toBe("confirming")
    expect(submitted.effects).toHaveLength(1)
    expect(applyKeyCommandWithEffects(submitted.state, { type: "cancel" })).toEqual({ state: submitted.state, effects: [] })
  })

  test("message box keeps API keys out of TUI state while sending original message", () => {
    let state: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "provider key sk-test-SECRET123",
    }

    const result = applyKeyCommandWithEffects(state, { type: "submit" })
    state = result.state

    expect(result.effects).toEqual([{ type: "send-user-message", message: "provider key sk-test-SECRET123" }])
    expect(JSON.stringify(state)).not.toContain("sk-test-SECRET123")
    expect(state.submittedMessages).toEqual(["provider key [REDACTED]"])
  })

  test("slash commands route through runtime command effects", () => {
    const state: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/status",
    }

    const result = applyKeyCommandWithEffects(state, { type: "submit" })

    expect(result.state.messageDraft).toBe("")
    expect(result.state.lastCommand).toBe("status")
    expect(result.effects).toEqual([{ type: "send-command", command: "status" }])
  })

  test("Commander recovery slash commands route only the six canonical surfaces", () => {
    const commands = [
      "/commander-recoveries limit=5",
      "/commander-recovery-show inv_1",
      "/commander-recovery-preview inv_1",
      "/commander-recovery-approve investigation_id=inv_1",
      "/commander-recovery-execute investigation_id=inv_1",
      "/commander-recovery-cancel investigation_id=inv_1",
    ]
    for (const messageDraft of commands) {
      const result = applyKeyCommandWithEffects({ ...initialState("/tmp/demo"), screen: "main", focus: "message-box", messageDraft }, { type: "submit" })
      expect(result.effects).toEqual([{
        type: "send-command",
        command: messageDraft.slice(1).split(" ")[0],
        args: messageDraft.split(" ").slice(1),
      }])
    }
    const forbidden = applyKeyCommandWithEffects({ ...initialState("/tmp/demo"), screen: "main", focus: "message-box", messageDraft: "/commander-recovery-resume inv_1" }, { type: "submit" })
    expect(forbidden.effects).toEqual([{ type: "send-user-message", message: "/commander-recovery-resume inv_1" }])
  })

  test("research slash commands route through whitelisted runtime command effects with args", () => {
    const state: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/notes topic-1 runtime projection",
    }

    const result = applyKeyCommandWithEffects(state, { type: "submit" })

    expect(result.state.messageDraft).toBe("")
    expect(result.state.lastCommand).toBe("notes")
    expect(result.effects).toEqual([{ type: "send-command", command: "notes", args: ["topic-1", "runtime", "projection"] }])
  })

  test("external API slash commands route through whitelisted runtime command effects with args", () => {
    const state: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/api-preview mock-research-api GET /search q=test",
    }

    const result = applyKeyCommandWithEffects(state, { type: "submit" })

    expect(result.state.messageDraft).toBe("")
    expect(result.state.lastCommand).toBe("api-preview")
    expect(result.effects).toEqual([
      { type: "send-command", command: "api-preview", args: ["mock-research-api", "GET", "/search", "q=test"] },
    ])
  })

  test("external API research ingestion slash command routes only exact whitelist command", () => {
    const state: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/api-ingest-preview mock-research-api GET /search topic=topic-1 source=API",
    }

    const result = applyKeyCommandWithEffects(state, { type: "submit" })

    expect(result.state.messageDraft).toBe("")
    expect(result.state.lastCommand).toBe("api-ingest-preview")
    expect(result.effects).toEqual([
      { type: "send-command", command: "api-ingest-preview", args: ["mock-research-api", "GET", "/search", "topic=topic-1", "source=API"] },
    ])
  })

  test("path-like API text remains a user message unless whitelisted exactly", () => {
    const state: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/api.example.test/path",
    }

    const result = applyKeyCommandWithEffects(state, { type: "submit" })

    expect(result.effects).toEqual([{ type: "send-user-message", message: "/api.example.test/path" }])

    const dotState: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: ".api-ingest mock-research-api GET /search topic=topic-1 source=API",
    }
    expect(applyKeyCommandWithEffects(dotState, { type: "submit" }).effects).toEqual([
      { type: "send-user-message", message: ".api-ingest mock-research-api GET /search topic=topic-1 source=API" },
    ])
  })

  test("commander tool slash commands route only exact whitelist commands", () => {
    const state: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/commander-tool-search query=research memory phase=proposal_investigation",
    }

    const result = applyKeyCommandWithEffects(state, { type: "submit" })

    expect(result.state.messageDraft).toBe("")
    expect(result.state.lastCommand).toBe("commander-tool-search")
    expect(result.effects).toEqual([
      { type: "send-command", command: "commander-tool-search", args: ["query=research", "memory", "phase=proposal_investigation"] },
    ])

    const pathState: UiState = { ...initialState("/tmp/demo"), screen: "main", focus: "message-box", messageDraft: "/tmp/tool-search" }
    expect(applyKeyCommandWithEffects(pathState, { type: "submit" }).effects).toEqual([{ type: "send-user-message", message: "/tmp/tool-search" }])

    const dotState: UiState = { ...initialState("/tmp/demo"), screen: "main", focus: "message-box", messageDraft: ".tool-search query=memory" }
    expect(applyKeyCommandWithEffects(dotState, { type: "submit" }).effects).toEqual([{ type: "send-user-message", message: ".tool-search query=memory" }])
  })

  test("commander internal read slash commands route only exact whitelist commands", () => {
    const searchState: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/commander-repo-search query=CommanderToolService path=agentcore/runtime/src",
    }

    expect(applyKeyCommandWithEffects(searchState, { type: "submit" }).effects).toEqual([
      { type: "send-command", command: "commander-repo-search", args: ["query=CommanderToolService", "path=agentcore/runtime/src"] },
    ])

    const readState: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/commander-repo-read path=agentcore/runtime/src/server.ts start=1 end=20",
    }
    expect(applyKeyCommandWithEffects(readState, { type: "submit" }).effects).toEqual([
      { type: "send-command", command: "commander-repo-read", args: ["path=agentcore/runtime/src/server.ts", "start=1", "end=20"] },
    ])

    const spacedPathState: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/commander-repo-read path=src/a b.ts start=1 end=20",
    }
    expect(applyKeyCommandWithEffects(spacedPathState, { type: "submit" }).effects).toEqual([
      { type: "send-command", command: "commander-repo-read", args: ["path=src/a", "b.ts", "start=1", "end=20"] },
    ])

    const gitState: UiState = { ...initialState("/tmp/demo"), screen: "main", focus: "message-box", messageDraft: "/repo-git-diff scope=working_tree stat_only=true" }
    expect(applyKeyCommandWithEffects(gitState, { type: "submit" }).effects).toEqual([
      { type: "send-command", command: "repo-git-diff", args: ["scope=working_tree", "stat_only=true"] },
    ])

    const zeroContextGitState: UiState = { ...initialState("/tmp/demo"), screen: "main", focus: "message-box", messageDraft: "/commander-git-diff scope=working_tree context_lines=0" }
    expect(applyKeyCommandWithEffects(zeroContextGitState, { type: "submit" }).effects).toEqual([
      { type: "send-command", command: "commander-git-diff", args: ["scope=working_tree", "context_lines=0"] },
    ])

    for (const message of ["/tmp/repo-search", ".repo-read path=server.ts", ":repo-tree path=."]) {
      const pathState: UiState = { ...initialState("/tmp/demo"), screen: "main", focus: "message-box", messageDraft: message }
      expect(applyKeyCommandWithEffects(pathState, { type: "submit" }).effects).toEqual([{ type: "send-user-message", message }])
    }
  })

  test("research synthesis slash commands route only exact whitelist commands", () => {
    const state: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/synthesize-preview topic-1 summarize current evidence",
    }

    const result = applyKeyCommandWithEffects(state, { type: "submit" })

    expect(result.state.messageDraft).toBe("")
    expect(result.state.lastCommand).toBe("synthesize-preview")
    expect(result.effects).toEqual([
      { type: "send-command", command: "synthesize-preview", args: ["topic-1", "summarize", "current", "evidence"] },
    ])

    const pathState: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/tmp/repro/synthesize",
    }
    expect(applyKeyCommandWithEffects(pathState, { type: "submit" }).effects).toEqual([
      { type: "send-user-message", message: "/tmp/repro/synthesize" },
    ])

    const colonState: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: ":synthesis synthesis-1",
    }
    expect(applyKeyCommandWithEffects(colonState, { type: "submit" }).effects).toEqual([
      { type: "send-user-message", message: ":synthesis synthesis-1" },
    ])
  })

  test("commander cycle slash commands route only exact whitelist commands", () => {
    const state: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/cycle-preview topic=topic-1 inspect evidence",
    }

    const result = applyKeyCommandWithEffects(state, { type: "submit" })

    expect(result.state.messageDraft).toBe("")
    expect(result.state.lastCommand).toBe("cycle-preview")
    expect(result.effects).toEqual([
      { type: "send-command", command: "cycle-preview", args: ["topic=topic-1", "inspect", "evidence"] },
    ])

    const objectiveOnlyState: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/cycle inspect next step",
    }
    expect(applyKeyCommandWithEffects(objectiveOnlyState, { type: "submit" }).effects).toEqual([
      { type: "send-command", command: "cycle", args: ["inspect", "next", "step"] },
    ])

    for (const message of ["/tmp/repro/cycle", "/path/cycle", ".cycle topic=topic-1", ":cycle-show cycle-1"]) {
      const pathState: UiState = {
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }
      expect(applyKeyCommandWithEffects(pathState, { type: "submit" }).effects).toEqual([
        { type: "send-user-message", message },
      ])
    }
  })

  test("reasoning provider slash commands route only exact whitelist commands", () => {
    const state: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/reasoning-smoke-preview research",
    }

    let result = applyKeyCommandWithEffects(state, { type: "submit" })
    expect(result.state.lastCommand).toBe("reasoning-smoke-preview")
    expect(result.effects).toEqual([
      { type: "send-command", command: "reasoning-smoke-preview", args: ["research"] },
    ])

    result = applyKeyCommandWithEffects({
      ...state,
      messageDraft: "/reasoning-smoke-preview commander_executor_review",
    }, { type: "submit" })
    expect(result.effects).toEqual([
      { type: "send-command", command: "reasoning-smoke-preview", args: ["commander_executor_review"] },
    ])

    for (const message of ["/tmp/repro/reasoning", "/path/reasoning", ".reasoning", ":reasoning-smoke"]) {
      result = applyKeyCommandWithEffects({
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }, { type: "submit" })
      expect(result.effects).toEqual([{ type: "send-user-message", message }])
    }
  })

  test("opencode handoff slash commands route only exact whitelist commands", () => {
    const state: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/handoff-preview proposal-1",
    }

    let result = applyKeyCommandWithEffects(state, { type: "submit" })
    expect(result.state.lastCommand).toBe("handoff-preview")
    expect(result.effects).toEqual([
      { type: "send-command", command: "handoff-preview", args: ["proposal-1"] },
    ])

    result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/handoff-dry-run proposal-1",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "handoff-dry-run", args: ["proposal-1"] }])

    result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/handoff-followup handoff-1",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "handoff-followup", args: ["handoff-1"] }])

    result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/handoff-results",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "handoff-results" }])

    result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/opencode-smoke-preview",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "opencode-smoke-preview" }])

    result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/opencode-smoke-show smoke-1",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "opencode-smoke-show", args: ["smoke-1"] }])

    result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/handoff-readiness proposal=proposal-1",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "handoff-readiness", args: ["proposal=proposal-1"] }])

    result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/handoff-ready",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "handoff-ready" }])

    for (const message of ["/tmp/repro/handoff", "/path/handoff", ".handoff proposal-1", ":handoff-show handoff-1", ".handoff-followup handoff-1", ":handoff-active", "/tmp/repro/opencode-smoke", "/path/opencode-smoke", ".opencode-smoke", ":opencode-smoke", "/tmp/repro/handoff-readiness", "/path/handoff-ready", ".handoff-readiness", ":opencode-handoff-readiness"]) {
      result = applyKeyCommandWithEffects({
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }, { type: "submit" })
      expect(result.effects).toEqual([{ type: "send-user-message", message }])
    }
  })

  test("mission execution slash commands route through whitelisted runtime command effects with args", () => {
    const state: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/progress-add mission-1 claim-1 working on runtime bridge",
    }

    const result = applyKeyCommandWithEffects(state, { type: "submit" })

    expect(result.state.messageDraft).toBe("")
    expect(result.state.lastCommand).toBe("progress-add")
    expect(result.effects).toEqual([
      { type: "send-command", command: "progress-add", args: ["mission-1", "claim-1", "working", "on", "runtime", "bridge"] },
    ])
  })

  test("path-like OpenCode progress and watchdog text remains a user message", () => {
    for (const message of ["/tmp/repro/opencode-progress", "/path/opencode-progress-preview", ".opencode-progress", ":opencode-progress", "/tmp/opencode-watchdog", "/path/opencode-watchdog", ".opencode-watchdog", ":opencode-watchdog"]) {
      const result = applyKeyCommandWithEffects({
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }, { type: "submit" })
      expect(result.effects).toEqual([{ type: "send-user-message", message }])
    }
  })

  test("Commander guidance delivery slash commands are exact whitelist entries", () => {
    let result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/commander-guidance-deliver guidance=guidance-1 mode=operator_handoff",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "commander-guidance-deliver", args: ["guidance=guidance-1", "mode=operator_handoff"] }])

    result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/deliver-guidance guidance=guidance-1",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "deliver-guidance", args: ["guidance=guidance-1"] }])

    for (const message of ["/tmp/deliver-guidance", "/path/commander-guidance-deliver", ".commander-guidance-deliver guidance=guidance-1", ":commander-guidance-deliver guidance=guidance-1"]) {
      result = applyKeyCommandWithEffects({
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }, { type: "submit" })
      expect(result.effects).toEqual([{ type: "send-user-message", message }])
    }
  })

  test("OpenCode human-control slash commands are exact whitelist entries", () => {
    let result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/opencode-human-pause session=session-1 reason=operator review",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "opencode-human-pause", args: ["session=session-1", "reason=operator", "review"] }])

    result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/human-correction session=session-1 correction=prefer safer path",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "human-correction", args: ["session=session-1", "correction=prefer", "safer", "path"] }])

    result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/opencode-human-controls session=session-1",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "opencode-human-controls", args: ["session=session-1"] }])

    for (const message of ["/tmp/human-pause", "/path/opencode-human-pause", ".opencode-human-pause session=session-1", ":opencode-human-pause session=session-1"]) {
      result = applyKeyCommandWithEffects({
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }, { type: "submit" })
      expect(result.effects).toEqual([{ type: "send-user-message", message }])
    }
  })

  test("OpenCode wake supervisor slash commands are exact whitelist entries", () => {
    let result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/opencode-wake-supervisor-preview session=session-1",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "opencode-wake-supervisor-preview", args: ["session=session-1"] }])

    result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/session-supervisor launch=launch-1",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "session-supervisor", args: ["launch=launch-1"] }])

    result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/opencode-wake-supervisor-summary status=human_attention",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "opencode-wake-supervisor-summary", args: ["status=human_attention"] }])

    for (const message of ["/tmp/wake-supervisor", "/path/opencode-wake-supervisor-preview", ".opencode-wake-supervisor-preview session=session-1", ":opencode-wake-supervisor-preview session=session-1"]) {
      result = applyKeyCommandWithEffects({
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }, { type: "submit" })
      expect(result.effects).toEqual([{ type: "send-user-message", message }])
    }
  })

  test("OpenCode wake supervisor execution slash commands are exact whitelist entries", () => {
    let result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/opencode-wake-execution-preview session=session-1",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "opencode-wake-execution-preview", args: ["session=session-1"] }])

    result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/wake-execution-record launch=launch-1",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "wake-execution-record", args: ["launch=launch-1"] }])

    result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/opencode-wake-batch-record limit=10",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "opencode-wake-batch-record", args: ["limit=10"] }])

    for (const message of ["/tmp/wake-execution", "/path/opencode-wake-execution-record", ".opencode-wake-execution-record session=session-1", ":opencode-wake-execution-record session=session-1"]) {
      result = applyKeyCommandWithEffects({
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }, { type: "submit" })
      expect(result.effects).toEqual([{ type: "send-user-message", message }])
    }
  })

  test("OpenCode wake action execution slash commands are exact whitelist entries", () => {
    let result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/opencode-wake-action-preview execution=execution-1",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "opencode-wake-action-preview", args: ["execution=execution-1"] }])

    result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/wake-action-record execution=execution-1 action=record_watchdog",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "wake-action-record", args: ["execution=execution-1", "action=record_watchdog"] }])

    result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/opencode-wake-action-summary",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "opencode-wake-action-summary" }])

    for (const message of ["/tmp/wake-action", "/path/opencode-wake-action-record", ".opencode-wake-action-record execution=execution-1", ":opencode-wake-action-record execution=execution-1"]) {
      result = applyKeyCommandWithEffects({
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }, { type: "submit" })
      expect(result.effects).toEqual([{ type: "send-user-message", message }])
    }
  })

  test("OpenCode result report slash commands are exact whitelist entries", () => {
    let result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/opencode-result-report-preview session=session-1 summary=done",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "opencode-result-report-preview", args: ["session=session-1", "summary=done"] }])

    result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/result-report session=session-1 kind=completion_report summary=done outcome=tests-passed",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "result-report", args: ["session=session-1", "kind=completion_report", "summary=done", "outcome=tests-passed"] }])

    result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/opencode-result-report-summary",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "opencode-result-report-summary" }])

    for (const message of ["/tmp/result-report", "/path/opencode-result-report", ".opencode-result-report session=session-1", ":opencode-result-report session=session-1"]) {
      result = applyKeyCommandWithEffects({
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }, { type: "submit" })
      expect(result.effects).toEqual([{ type: "send-user-message", message }])
    }
  })

  test("OpenCode result review slash commands are exact whitelist entries", () => {
    let result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/opencode-result-review-preview report=report-1 decision=accepted rationale=ok",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "opencode-result-review-preview", args: ["report=report-1", "decision=accepted", "rationale=ok"] }])

    result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/result-review report=report-1 decision=needs_revision rationale=needs-work revision_requests=tests",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "result-review", args: ["report=report-1", "decision=needs_revision", "rationale=needs-work", "revision_requests=tests"] }])

    result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/result-review-show review-1",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "result-review-show", args: ["review-1"] }])

    result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/opencode-result-review-summary",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "opencode-result-review-summary" }])

    for (const message of ["/tmp/result-review", "/path/opencode-result-review", ".opencode-result-review report=report-1", ":opencode-result-review report=report-1"]) {
      result = applyKeyCommandWithEffects({
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }, { type: "submit" })
      expect(result.effects).toEqual([{ type: "send-user-message", message }])
    }
  })

  test("research ingestion slash commands are exact whitelist entries", () => {
    let result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/research-ingestion-preview review=review-1",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "research-ingestion-preview", args: ["review=review-1"] }])

    result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/research-ingest review=review-1 tags=opencode,reviewed",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "research-ingest", args: ["review=review-1", "tags=opencode,reviewed"] }])

    result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/research-ingestion-show ingestion-1",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "research-ingestion-show", args: ["ingestion-1"] }])

    result = applyKeyCommandWithEffects({
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/research-ingestion-summary",
    }, { type: "submit" })
    expect(result.effects).toEqual([{ type: "send-command", command: "research-ingestion-summary" }])

    for (const message of ["/tmp/research-ingestion", "/path/research-ingestion", ".research-ingestion review=review-1", ":research-ingestion review=review-1"]) {
      result = applyKeyCommandWithEffects({
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }, { type: "submit" })
      expect(result.effects).toEqual([{ type: "send-user-message", message }])
    }
  })

  test("Commander continuity packet slash commands are exact whitelist entries", () => {
    for (const [message, command, args] of [
      ["/commander-continuity-preview objective=plan next step", "commander-continuity-preview", ["objective=plan", "next", "step"]],
      ["/continuity-preview objective=plan next step", "continuity-preview", ["objective=plan", "next", "step"]],
      ["/commander-proposal-memory-packet objective=plan next step", "commander-proposal-memory-packet", ["objective=plan", "next", "step"]],
      ["/proposal-memory-packet objective=plan next step", "proposal-memory-packet", ["objective=plan", "next", "step"]],
      ["/commander-proposal-continuity objective=plan next step", "commander-proposal-continuity", ["objective=plan", "next", "step"]],
      ["/proposal-continuity objective=plan next step", "proposal-continuity", ["objective=plan", "next", "step"]],
      ["/commander-midmission-packet session=session-1", "commander-midmission-packet", ["session=session-1"]],
      ["/midmission-packet launch=launch-1", "midmission-packet", ["launch=launch-1"]],
      ["/mid-mission-packet session=session-1", "mid-mission-packet", ["session=session-1"]],
      ["/commander-continuity-summary", "commander-continuity-summary", []],
      ["/continuity-summary", "continuity-summary", []],
      ["/commander-open-loops session=session-1", "commander-open-loops", ["session=session-1"]],
      ["/open-loops", "open-loops", []],
      ["/commander-continuity-thread session=session-1", "commander-continuity-thread", ["session=session-1"]],
      ["/continuity-thread mission=mission-1", "continuity-thread", ["mission=mission-1"]],
    ] as const) {
      const result = applyKeyCommandWithEffects({
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }, { type: "submit" })
      expect(result.effects).toEqual([{ type: "send-command", command, ...(args.length > 0 ? { args: [...args] } : {}) }])
    }

    for (const message of ["/tmp/continuity-preview", "/path/commander-continuity-preview", ".commander-continuity-preview objective=x", ":commander-continuity-preview objective=x"]) {
      const result = applyKeyCommandWithEffects({
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }, { type: "submit" })
      expect(result.effects).toEqual([{ type: "send-user-message", message }])
    }
  })

  test("review slash commands route through whitelisted runtime command effects with args", () => {
    const state: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/request-review mission-1 Approve completion -- Looks good",
    }

    const result = applyKeyCommandWithEffects(state, { type: "submit" })

    expect(result.state.messageDraft).toBe("")
    expect(result.state.lastCommand).toBe("request-review")
    expect(result.effects).toEqual([
      { type: "send-command", command: "request-review", args: ["mission-1", "Approve", "completion", "--", "Looks", "good"] },
    ])
  })

  test("proposal slash commands route through whitelisted runtime command effects with args", () => {
    const state: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/propose-progress mission-1 claim-1 Title -- message body",
    }

    const result = applyKeyCommandWithEffects(state, { type: "submit" })

    expect(result.state.messageDraft).toBe("")
    expect(result.state.lastCommand).toBe("propose-progress")
    expect(result.effects).toEqual([
      { type: "send-command", command: "propose-progress", args: ["mission-1", "claim-1", "Title", "--", "message", "body"] },
    ])
  })

  test("proposal bundle slash commands route through whitelisted runtime command effects with args", () => {
    const state: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/create-bundle Bundle title -- Bundle summary",
    }

    const result = applyKeyCommandWithEffects(state, { type: "submit" })

    expect(result.state.messageDraft).toBe("")
    expect(result.state.lastCommand).toBe("create-bundle")
    expect(result.effects).toEqual([
      { type: "send-command", command: "create-bundle", args: ["Bundle", "title", "--", "Bundle", "summary"] },
    ])
  })

  test("playbook slash commands route through whitelisted runtime command effects with args", () => {
    const state: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/draft-result-complete mission-1 claim-1 Title -- result summary || completion summary",
    }

    const result = applyKeyCommandWithEffects(state, { type: "submit" })

    expect(result.state.messageDraft).toBe("")
    expect(result.state.lastCommand).toBe("draft-result-complete")
    expect(result.effects).toEqual([
      { type: "send-command", command: "draft-result-complete", args: ["mission-1", "claim-1", "Title", "--", "result", "summary", "||", "completion", "summary"] },
    ])
  })

  test("workbench slash commands route through whitelisted runtime command effects with args", () => {
    const state: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/draft-review draft-1",
    }

    const result = applyKeyCommandWithEffects(state, { type: "submit" })

    expect(result.state.messageDraft).toBe("")
    expect(result.state.lastCommand).toBe("draft-review")
    expect(result.effects).toEqual([{ type: "send-command", command: "draft-review", args: ["draft-1"] }])
  })

  test("apply slash commands route through whitelisted runtime command effects with args", () => {
    const state: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/apply-target draft draft-1",
    }

    const result = applyKeyCommandWithEffects(state, { type: "submit" })

    expect(result.state.messageDraft).toBe("")
    expect(result.state.lastCommand).toBe("apply-target")
    expect(result.effects).toEqual([{ type: "send-command", command: "apply-target", args: ["draft", "draft-1"] }])
  })

  test("audit slash commands route through whitelisted runtime command effects with args", () => {
    const state: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/audit proposal proposal-1",
    }

    const result = applyKeyCommandWithEffects(state, { type: "submit" })

    expect(result.state.messageDraft).toBe("")
    expect(result.state.lastCommand).toBe("audit")
    expect(result.effects).toEqual([{ type: "send-command", command: "audit", args: ["proposal", "proposal-1"] }])
  })

  test("queue slash commands route through whitelisted runtime command effects with args", () => {
    const state: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/queue needs_review",
    }

    const result = applyKeyCommandWithEffects(state, { type: "submit" })

    expect(result.state.messageDraft).toBe("")
    expect(result.state.lastCommand).toBe("queue")
    expect(result.effects).toEqual([{ type: "send-command", command: "queue", args: ["needs_review"] }])
  })

  test("target navigation slash commands route through whitelisted runtime command effects with args", () => {
    for (const [message, command, args] of [
      ["/open proposal proposal-1", "open", ["proposal", "proposal-1"]],
      ["/jump bundle bundle-1", "jump", ["bundle", "bundle-1"]],
      ["/target draft draft-1", "target", ["draft", "draft-1"]],
      ["/open-review review-1", "open-review", ["review-1"]],
    ] as const) {
      const result = applyKeyCommandWithEffects({
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }, { type: "submit" })

      expect(result.state.messageDraft).toBe("")
      expect(result.state.lastCommand).toBe(command)
      expect(result.effects).toEqual([{ type: "send-command", command, args: [...args] }])
    }
  })

  test("operator action slash commands route through whitelisted runtime command effects with args", () => {
    for (const [message, command, args] of [
      ["/stage 1", "stage", ["1"]],
      ["/stage-command /queues", "stage-command", ["/queues"]],
      ["/stage-preview", "stage-preview", []],
      ["/clear-stage", "clear-stage", []],
      ["/run-staged", "run-staged", []],
      ["/execute-staged", "execute-staged", []],
    ] as const) {
      const result = applyKeyCommandWithEffects({
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }, { type: "submit" })

      expect(result.state.messageDraft).toBe("")
      expect(result.state.lastCommand).toBe(command)
      expect(result.effects).toEqual([{ type: "send-command", command, ...(args.length > 0 ? { args: [...args] } : {}) }])
    }
  })

  test("runtime checkpoint slash commands route through whitelist only", () => {
    for (const [message, command, args] of [
      ["/checkpoint-preview", "checkpoint-preview", []],
      ["/checkpoint full operator save", "checkpoint", ["full", "operator", "save"]],
      ["/checkpoints", "checkpoints", []],
      ["/checkpoint-show checkpoint-1", "checkpoint-show", ["checkpoint-1"]],
    ] as const) {
      const result = applyKeyCommandWithEffects({
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }, { type: "submit" })

      expect(result.state.messageDraft).toBe("")
      expect(result.state.lastCommand).toBe(command)
      expect(result.effects).toEqual([{ type: "send-command", command, ...(args.length > 0 ? { args: [...args] } : {}) }])
    }

    for (const message of ["/tmp/repro/checkpoint", "/path/checkpoint", ".checkpoint full", ":checkpoint full"]) {
      const result = applyKeyCommandWithEffects({
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }, { type: "submit" })

      expect(result.effects).toEqual([{ type: "send-user-message", message }])
    }
  })

  test("runtime restore slash commands route through whitelist only", () => {
    for (const [message, command, args] of [
      ["/restore-preview checkpoint-1", "restore-preview", ["checkpoint-1"]],
      ["/resume-preview checkpoint-1", "resume-preview", ["checkpoint-1"]],
      ["/resume-mark checkpoint-1", "resume-mark", ["checkpoint-1"]],
      ["/resume-anchors", "resume-anchors", []],
      ["/resume-anchor resume-1", "resume-anchor", ["resume-1"]],
    ] as const) {
      const result = applyKeyCommandWithEffects({
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }, { type: "submit" })

      expect(result.state.messageDraft).toBe("")
      expect(result.state.lastCommand).toBe(command)
      expect(result.effects).toEqual([{ type: "send-command", command, ...(args.length > 0 ? { args: [...args] } : {}) }])
    }

    for (const message of ["/tmp/repro/resume", "/path/restore-preview", ".resume-mark checkpoint-1", ":restore-preview checkpoint-1"]) {
      const result = applyKeyCommandWithEffects({
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }, { type: "submit" })

      expect(result.effects).toEqual([{ type: "send-user-message", message }])
    }
  })

  test("wake slash commands route through whitelist only", () => {
    for (const [message, command, args] of [
      ["/wake-preview resume=resume-1", "wake-preview", ["resume=resume-1"]],
      ["/wake-preview checkpoint=checkpoint-1", "wake-preview", ["checkpoint=checkpoint-1"]],
      ["/wake resume=resume-1", "wake", ["resume=resume-1"]],
      ["/wakes", "wakes", []],
      ["/wake-show wake-1", "wake-show", ["wake-1"]],
    ] as const) {
      const result = applyKeyCommandWithEffects({
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }, { type: "submit" })

      expect(result.state.messageDraft).toBe("")
      expect(result.state.lastCommand).toBe(command)
      expect(result.effects).toEqual([{ type: "send-command", command, ...(args.length > 0 ? { args: [...args] } : {}) }])
    }

    for (const message of ["/tmp/repro/wake", "/path/wake-preview", ".wake resume=resume-1", ":wake-preview resume=resume-1"]) {
      const result = applyKeyCommandWithEffects({
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }, { type: "submit" })

      expect(result.effects).toEqual([{ type: "send-user-message", message }])
    }
  })

  test("continuation slash commands route through whitelist only", () => {
    for (const [message, command, args] of [
      ["/continue-preview wake=wake-1", "continue-preview", ["wake=wake-1"]],
      ["/cont-preview wake=wake-1", "cont-preview", ["wake=wake-1"]],
      ["/continue-plan wake=wake-1", "continue-plan", ["wake=wake-1"]],
      ["/continue-step plan-1", "continue-step", ["plan-1"]],
      ["/continue-step plan-1 2", "continue-step", ["plan-1", "2"]],
      ["/cont-step plan-1", "cont-step", ["plan-1"]],
      ["/continue-dry-run plan-1 1", "continue-dry-run", ["plan-1", "1"]],
      ["/continue-pause plan-1", "continue-pause", ["plan-1"]],
      ["/continue-cancel plan-1", "continue-cancel", ["plan-1"]],
      ["/continuations", "continuations", []],
      ["/continue-show plan-1", "continue-show", ["plan-1"]],
    ] as const) {
      const result = applyKeyCommandWithEffects({
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }, { type: "submit" })

      expect(result.state.messageDraft).toBe("")
      expect(result.state.lastCommand).toBe(command)
      expect(result.effects).toEqual([{ type: "send-command", command, ...(args.length > 0 ? { args: [...args] } : {}) }])
    }

    for (const message of ["/tmp/repro/continue", "/path/continue-preview", ".continue wake=wake-1", ":continue-step plan-1"]) {
      const result = applyKeyCommandWithEffects({
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }, { type: "submit" })

      expect(result.effects).toEqual([{ type: "send-user-message", message }])
    }
  })

  test("wake schedule slash commands route through whitelist only", () => {
    for (const [message, command, args] of [
      ["/schedule-wake-preview resume=resume-1 every=5m nightly check", "schedule-wake-preview", ["resume=resume-1", "every=5m", "nightly", "check"]],
      ["/schedule-wake resume=resume-1 every=60s", "schedule-wake", ["resume=resume-1", "every=60s"]],
      ["/wake-schedules", "wake-schedules", []],
      ["/wake-schedule schedule-1", "wake-schedule", ["schedule-1"]],
      ["/wake-schedule-pause schedule-1", "wake-schedule-pause", ["schedule-1"]],
      ["/wake-schedule-resume schedule-1", "wake-schedule-resume", ["schedule-1"]],
      ["/wake-schedule-cancel schedule-1", "wake-schedule-cancel", ["schedule-1"]],
      ["/wake-tick-preview", "wake-tick-preview", []],
      ["/wake-tick", "wake-tick", []],
      ["/wake-tick-dry-run", "wake-tick-dry-run", []],
      ["/wake-ticks", "wake-ticks", []],
      ["/wake-tick-show tick-1", "wake-tick-show", ["tick-1"]],
      ["/scheduler-preview dry-run every=60s max=5", "scheduler-preview", ["dry-run", "every=60s", "max=5"]],
      ["/scheduler-start dry-run every=60s max=5", "scheduler-start", ["dry-run", "every=60s", "max=5"]],
      ["/scheduler-status", "scheduler-status", []],
      ["/scheduler-bootstrap", "scheduler-bootstrap", []],
      ["/scheduler-bootstrap-preview", "scheduler-bootstrap-preview", []],
      ["/scheduler-recovery", "scheduler-recovery", []],
      ["/scheduler-recovery-preview", "scheduler-recovery-preview", []],
      ["/scheduler-recoveries", "scheduler-recoveries", []],
      ["/scheduler-recovery-show recovery-1", "scheduler-recovery-show", ["recovery-1"]],
      ["/scheduler-recovery-ack recovery-1 saw it", "scheduler-recovery-ack", ["recovery-1", "saw", "it"]],
      ["/scheduler-recovery-resolve recovery-1 fixed", "scheduler-recovery-resolve", ["recovery-1", "fixed"]],
      ["/scheduler-recovery-dismiss recovery-1 ignore", "scheduler-recovery-dismiss", ["recovery-1", "ignore"]],
      ["/scheduler-recovery-workflow-preview recovery-1", "scheduler-recovery-workflow-preview", ["recovery-1"]],
      ["/scheduler-recovery-workflow recovery-1", "scheduler-recovery-workflow", ["recovery-1"]],
      ["/scheduler-recovery-workflows", "scheduler-recovery-workflows", []],
      ["/scheduler-recovery-workflow-show workflow-1", "scheduler-recovery-workflow-show", ["workflow-1"]],
      ["/scheduler-recovery-workflow-verify workflow-1", "scheduler-recovery-workflow-verify", ["workflow-1"]],
      ["/scheduler-recovery-step-done workflow-1 0 note", "scheduler-recovery-step-done", ["workflow-1", "0", "note"]],
      ["/scheduler-recovery-step-skip workflow-1 1 note", "scheduler-recovery-step-skip", ["workflow-1", "1", "note"]],
      ["/scheduler-recovery-step-block workflow-1 2 note", "scheduler-recovery-step-block", ["workflow-1", "2", "note"]],
      ["/scheduler-recovery-workflow-cancel workflow-1 stop", "scheduler-recovery-workflow-cancel", ["workflow-1", "stop"]],
      ["/scheduler-audit", "scheduler-audit", []],
      ["/scheduler-audit-summary", "scheduler-audit-summary", []],
      ["/scheduler-audit-timeline limit=5 related=recovery-1", "scheduler-audit-timeline", ["limit=5", "related=recovery-1"]],
      ["/scheduler-audit-chain recovery-1", "scheduler-audit-chain", ["recovery-1"]],
      ["/scheduler-audit-incidents open", "scheduler-audit-incidents", ["open"]],
      ["/scheduler-nav", "scheduler-nav", []],
      ["/scheduler-navigation related=recovery-1", "scheduler-navigation", ["related=recovery-1"]],
      ["/scheduler-nav incident=incident-1", "scheduler-nav", ["incident=incident-1"]],
      ["/scheduler-nav audit=audit-1", "scheduler-nav", ["audit=audit-1"]],
      ["/scheduler-nav-command /wake-tick-dry-run token=secret", "scheduler-nav-command", ["/wake-tick-dry-run", "token=secret"]],
      ["/scheduler-nav-target recovery recovery-1", "scheduler-nav-target", ["recovery", "recovery-1"]],
      ["/scheduler-nav-stage-preview /scheduler-status", "scheduler-nav-stage-preview", ["/scheduler-status"]],
      ["/scheduler-nav-stage /scheduler-status", "scheduler-nav-stage", ["/scheduler-status"]],
      ["/scheduler-nav-staged", "scheduler-nav-staged", []],
      ["/scheduler-nav-unstage staged-1", "scheduler-nav-unstage", ["staged-1"]],
      ["/scheduler-nav-stage-clear reason words", "scheduler-nav-stage-clear", ["reason", "words"]],
      ["/scheduler-nav-run-preview staged-1", "scheduler-nav-run-preview", ["staged-1"]],
      ["/scheduler-nav-run staged-1", "scheduler-nav-run", ["staged-1"]],
      ["/scheduler-nav-run-dry-run staged-1", "scheduler-nav-run-dry-run", ["staged-1"]],
      ["/scheduler-nav-runs", "scheduler-nav-runs", []],
      ["/scheduler-nav-run-show run-1", "scheduler-nav-run-show", ["run-1"]],
      ["/scheduler-nav-read-preview staged-1", "scheduler-nav-read-preview", ["staged-1"]],
      ["/scheduler-nav-read staged-1", "scheduler-nav-read", ["staged-1"]],
      ["/scheduler-nav-read-history staged=staged-1 limit=5", "scheduler-nav-read-history", ["staged=staged-1", "limit=5"]],
      ["/scheduler-nav-run-history staged=staged-1", "scheduler-nav-run-history", ["staged=staged-1"]],
      ["/scheduler-nav-read-compare staged-1", "scheduler-nav-read-compare", ["staged-1"]],
      ["/scheduler-nav-run-compare staged-1", "scheduler-nav-run-compare", ["staged-1"]],
      ["/scheduler-nav-read-compare-runs run-1 run-2", "scheduler-nav-read-compare-runs", ["run-1", "run-2"]],
      ["/scheduler-nav-read-stale after=1h", "scheduler-nav-read-stale", ["after=1h"]],
      ["/scheduler-nav-read-group staged-1", "scheduler-nav-read-group", ["staged-1"]],
      ["/scheduler-nav-write-preview /wake-tick-dry-run", "scheduler-nav-write-preview", ["/wake-tick-dry-run"]],
      ["/scheduler-write-preview /scheduler-start dry-run every=60s", "scheduler-write-preview", ["/scheduler-start", "dry-run", "every=60s"]],
      ["/scheduler-nav-write-board related=recovery-1", "scheduler-nav-write-board", ["related=recovery-1"]],
      ["/scheduler-write-board", "scheduler-write-board", []],
      ["/scheduler-nav-write-stage-preview /wake-tick-dry-run", "scheduler-nav-write-stage-preview", ["/wake-tick-dry-run"]],
      ["/scheduler-write-stage /wake-tick-dry-run", "scheduler-write-stage", ["/wake-tick-dry-run"]],
      ["/scheduler-nav-write-stage-medium /checkpoint full", "scheduler-nav-write-stage-medium", ["/checkpoint", "full"]],
      ["/scheduler-nav-write-staged", "scheduler-nav-write-staged", []],
      ["/scheduler-nav-write-unstage staged-write-1", "scheduler-nav-write-unstage", ["staged-write-1"]],
      ["/scheduler-nav-write-stage-clear done", "scheduler-nav-write-stage-clear", ["done"]],
      ["/scheduler-nav-write-run-preview staged-write-1", "scheduler-nav-write-run-preview", ["staged-write-1"]],
      ["/scheduler-write-run staged-write-1", "scheduler-write-run", ["staged-write-1"]],
      ["/scheduler-nav-write-run-dry-run staged-write-1", "scheduler-nav-write-run-dry-run", ["staged-write-1"]],
      ["/scheduler-nav-write-runs", "scheduler-nav-write-runs", []],
      ["/scheduler-nav-write-run-show run-1", "scheduler-nav-write-run-show", ["run-1"]],
      ["/scheduler-nav-write-run-history staged=staged-write-1 limit=5", "scheduler-nav-write-run-history", ["staged=staged-write-1", "limit=5"]],
      ["/scheduler-write-run-history staged=staged-write-1", "scheduler-write-run-history", ["staged=staged-write-1"]],
      ["/scheduler-nav-write-run-compare staged-write-1", "scheduler-nav-write-run-compare", ["staged-write-1"]],
      ["/scheduler-write-run-compare staged-write-1", "scheduler-write-run-compare", ["staged-write-1"]],
      ["/scheduler-nav-write-run-compare-runs run-1 run-2", "scheduler-nav-write-run-compare-runs", ["run-1", "run-2"]],
      ["/scheduler-nav-write-run-stale after=1h", "scheduler-nav-write-run-stale", ["after=1h"]],
      ["/scheduler-write-run-stale after=1h", "scheduler-write-run-stale", ["after=1h"]],
      ["/scheduler-nav-write-run-group staged-write-1", "scheduler-nav-write-run-group", ["staged-write-1"]],
      ["/scheduler-nav-write-readiness staged-write-1", "scheduler-nav-write-readiness", ["staged-write-1"]],
      ["/scheduler-write-readiness staged-write-1", "scheduler-write-readiness", ["staged-write-1"]],
      ["/scheduler-nav-write-approve staged-write-1 reason words", "scheduler-nav-write-approve", ["staged-write-1", "reason", "words"]],
      ["/scheduler-write-approve staged-write-1 reason", "scheduler-write-approve", ["staged-write-1", "reason"]],
      ["/scheduler-nav-write-reject staged-write-1 reason", "scheduler-nav-write-reject", ["staged-write-1", "reason"]],
      ["/scheduler-write-reject staged-write-1 reason", "scheduler-write-reject", ["staged-write-1", "reason"]],
      ["/scheduler-nav-write-approval-revoke approval-1 reason", "scheduler-nav-write-approval-revoke", ["approval-1", "reason"]],
      ["/scheduler-nav-write-approvals", "scheduler-nav-write-approvals", []],
      ["/scheduler-write-approvals", "scheduler-write-approvals", []],
      ["/scheduler-nav-write-approval-show approval-1", "scheduler-nav-write-approval-show", ["approval-1"]],
      ["/scheduler-nav-checkpoint-run-preview staged-write-1", "scheduler-nav-checkpoint-run-preview", ["staged-write-1"]],
      ["/scheduler-checkpoint-run staged-write-1", "scheduler-checkpoint-run", ["staged-write-1"]],
      ["/scheduler-nav-checkpoint-run-dry-run staged-write-1", "scheduler-nav-checkpoint-run-dry-run", ["staged-write-1"]],
      ["/scheduler-nav-checkpoint-runs", "scheduler-nav-checkpoint-runs", []],
      ["/scheduler-checkpoint-runs", "scheduler-checkpoint-runs", []],
      ["/scheduler-nav-checkpoint-run-show run-1", "scheduler-nav-checkpoint-run-show", ["run-1"]],
      ["/scheduler-nav-checkpoint-history staged=staged-write-1 approval=approval-1 limit=5", "scheduler-nav-checkpoint-history", ["staged=staged-write-1", "approval=approval-1", "limit=5"]],
      ["/scheduler-checkpoint-history staged=staged-write-1", "scheduler-checkpoint-history", ["staged=staged-write-1"]],
      ["/scheduler-nav-checkpoint-compare staged-write-1", "scheduler-nav-checkpoint-compare", ["staged-write-1"]],
      ["/scheduler-checkpoint-compare staged-write-1", "scheduler-checkpoint-compare", ["staged-write-1"]],
      ["/scheduler-nav-checkpoint-compare-runs run-1 run-2", "scheduler-nav-checkpoint-compare-runs", ["run-1", "run-2"]],
      ["/scheduler-nav-checkpoint-stale after=1d", "scheduler-nav-checkpoint-stale", ["after=1d"]],
      ["/scheduler-checkpoint-stale after=1d", "scheduler-checkpoint-stale", ["after=1d"]],
      ["/scheduler-nav-checkpoint-group staged-write-1", "scheduler-nav-checkpoint-group", ["staged-write-1"]],
      ["/scheduler-nav-checkpoint-approval-usage approval=approval-1 staged=staged-write-1", "scheduler-nav-checkpoint-approval-usage", ["approval=approval-1", "staged=staged-write-1"]],
      ["/authority", "authority", []],
      ["/authority-summary", "authority-summary", []],
      ["/command-authority", "command-authority", []],
      ["/command-map", "command-map", []],
      ["/authority-list risk=high_impact_write gate=handoff_runtime owner=opencode_handoff limit=5", "authority-list", ["risk=high_impact_write", "gate=handoff_runtime", "owner=opencode_handoff", "limit=5"]],
      ["/authority-show /scheduler-nav-checkpoint-run", "authority-show", ["/scheduler-nav-checkpoint-run"]],
      ["/authority-profile /scheduler-nav-checkpoint-run", "authority-profile", ["/scheduler-nav-checkpoint-run"]],
      ["/result-review-packet handoff=handoff-1", "result-review-packet", ["handoff=handoff-1"]],
      ["/result-review-packet-summary", "result-review-packet-summary", []],
      ["/executor-result-review result=result-1", "executor-result-review", ["result=result-1"]],
      ["/handoff-result-review proposal=proposal-1", "handoff-result-review", ["proposal=proposal-1"]],
      ["/opencode-session-preview objective=inspect training progress", "opencode-session-preview", ["objective=inspect", "training", "progress"]],
      ["/session-preview mission=mission-1", "session-preview", ["mission=mission-1"]],
      ["/opencode-session-plan objective=inspect training progress", "opencode-session-plan", ["objective=inspect", "training", "progress"]],
      ["/session-plan proposal=proposal-1", "session-plan", ["proposal=proposal-1"]],
      ["/opencode-plan mission=mission-1", "opencode-plan", ["mission=mission-1"]],
      ["/opencode-session-plan-dry-run objective=inspect training progress", "opencode-session-plan-dry-run", ["objective=inspect", "training", "progress"]],
      ["/opencode-sessions", "opencode-sessions", []],
      ["/sessions", "sessions", []],
      ["/opencode-session-show session-1", "opencode-session-show", ["session-1"]],
      ["/opencode-session-summary", "opencode-session-summary", []],
      ["/model-capabilities", "model-capabilities", []],
      ["/models provider=local", "models", ["provider=local"]],
      ["/model-capability fake-local-small", "model-capability", ["fake-local-small"]],
      ["/context-budget-summary", "context-budget-summary", []],
      ["/model-budget", "model-budget", []],
      ["/context-budget", "context-budget", []],
      ["/context-budget-preview purpose=commander_research_decision", "context-budget-preview", ["purpose=commander_research_decision"]],
      ["/budget-preview purpose=opencode_executor_session session=session-1", "budget-preview", ["purpose=opencode_executor_session", "session=session-1"]],
      ["/context-packet-preview purpose=commander_research_decision", "context-packet-preview", ["purpose=commander_research_decision"]],
      ["/packet-preview purpose=opencode_executor_session session=session-1", "packet-preview", ["purpose=opencode_executor_session", "session=session-1"]],
      ["/compile-context-preview purpose=wake_supervisor", "compile-context-preview", ["purpose=wake_supervisor"]],
      ["/context-compile-preview purpose=research_retrieval", "context-compile-preview", ["purpose=research_retrieval"]],
      ["/context-packet-summary", "context-packet-summary", []],
      ["/context-packets", "context-packets", []],
      ["/opencode-session-instruction-pack-preview session=session-1", "opencode-session-instruction-pack-preview", ["session=session-1"]],
      ["/session-instruction-pack-preview session=session-1", "session-instruction-pack-preview", ["session=session-1"]],
      ["/opencode-context-pack-preview session=session-1", "opencode-context-pack-preview", ["session=session-1"]],
      ["/opencode-session-instruction-pack-dry-run session=session-1", "opencode-session-instruction-pack-dry-run", ["session=session-1"]],
      ["/session-instruction-pack-dry-run session=session-1", "session-instruction-pack-dry-run", ["session=session-1"]],
      ["/opencode-session-instruction-pack-write session=session-1", "opencode-session-instruction-pack-write", ["session=session-1"]],
      ["/session-instruction-pack-write session=session-1", "session-instruction-pack-write", ["session=session-1"]],
      ["/opencode-context-pack-write session=session-1", "opencode-context-pack-write", ["session=session-1"]],
      ["/opencode-session-instruction-packs", "opencode-session-instruction-packs", []],
      ["/opencode-session-instruction-pack-show pack-1", "opencode-session-instruction-pack-show", ["pack-1"]],
      ["/opencode-launch-readiness session=session-1", "opencode-launch-readiness", ["session=session-1"]],
      ["/launch-readiness session=session-1 pack=pack-1", "launch-readiness", ["session=session-1", "pack=pack-1"]],
      ["/opencode-session-launch-readiness session=session-1", "opencode-session-launch-readiness", ["session=session-1"]],
      ["/session-launch-readiness session=session-1", "session-launch-readiness", ["session=session-1"]],
      ["/launch-ready session=session-1", "launch-ready", ["session=session-1"]],
      ["/opencode-launch-readiness-summary", "opencode-launch-readiness-summary", []],
      ["/opencode-launch-preview session=session-1", "opencode-launch-preview", ["session=session-1"]],
      ["/launch-opencode-preview session=session-1 pack=pack-1", "launch-opencode-preview", ["session=session-1", "pack=pack-1"]],
      ["/opencode-launch-dry-run session=session-1", "opencode-launch-dry-run", ["session=session-1"]],
      ["/launch-opencode-dry-run session=session-1", "launch-opencode-dry-run", ["session=session-1"]],
      ["/opencode-launch session=session-1", "opencode-launch", ["session=session-1"]],
      ["/launch-opencode session=session-1", "launch-opencode", ["session=session-1"]],
      ["/session-launch session=session-1", "session-launch", ["session=session-1"]],
      ["/opencode-session-launch session=session-1", "opencode-session-launch", ["session=session-1"]],
      ["/opencode-launches", "opencode-launches", []],
      ["/opencode-launch-show launch-1", "opencode-launch-show", ["launch-1"]],
      ["/opencode-progress-preview session=session-1 summary=working", "opencode-progress-preview", ["session=session-1", "summary=working"]],
      ["/opencode-heartbeat session=session-1 summary=alive", "opencode-heartbeat", ["session=session-1", "summary=alive"]],
      ["/session-heartbeat session=session-1 summary=alive", "session-heartbeat", ["session=session-1", "summary=alive"]],
      ["/opencode-progress session=session-1 summary=working", "opencode-progress", ["session=session-1", "summary=working"]],
      ["/session-progress session=session-1 summary=working", "session-progress", ["session=session-1", "summary=working"]],
      ["/opencode-blocker session=session-1 summary=blocked blocker=needs commander", "opencode-blocker", ["session=session-1", "summary=blocked", "blocker=needs", "commander"]],
      ["/session-blocker session=session-1 summary=blocked blocker=needs commander", "session-blocker", ["session=session-1", "summary=blocked", "blocker=needs", "commander"]],
      ["/opencode-question session=session-1 question=prefer A or B", "opencode-question", ["session=session-1", "question=prefer", "A", "or", "B"]],
      ["/session-question session=session-1 question=prefer A or B", "session-question", ["session=session-1", "question=prefer", "A", "or", "B"]],
      ["/opencode-progress-dry-run session=session-1 summary=dry", "opencode-progress-dry-run", ["session=session-1", "summary=dry"]],
      ["/opencode-progress-list session=session-1", "opencode-progress-list", ["session=session-1"]],
      ["/progress-list session=session-1", "progress-list", ["session=session-1"]],
      ["/opencode-progress-latest session=session-1", "opencode-progress-latest", ["session=session-1"]],
      ["/progress-latest session=session-1", "progress-latest", ["session=session-1"]],
      ["/opencode-progress-show progress-1", "opencode-progress-show", ["progress-1"]],
      ["/opencode-progress-summary", "opencode-progress-summary", []],
      ["/opencode-watchdog-preview session=session-1", "opencode-watchdog-preview", ["session=session-1"]],
      ["/session-watchdog session=session-1", "session-watchdog", ["session=session-1"]],
      ["/watchdog-preview launch=launch-1", "watchdog-preview", ["launch=launch-1"]],
      ["/opencode-watchdog-record session=session-1", "opencode-watchdog-record", ["session=session-1"]],
      ["/watchdog-record session=session-1 request_report=true", "watchdog-record", ["session=session-1", "request_report=true"]],
      ["/opencode-watchdog-dry-run session=session-1", "opencode-watchdog-dry-run", ["session=session-1"]],
      ["/opencode-force-report session=session-1 reason=needs report", "opencode-force-report", ["session=session-1", "reason=needs", "report"]],
      ["/force-report session=session-1 reason=needs report", "force-report", ["session=session-1", "reason=needs", "report"]],
      ["/session-force-report session=session-1 reason=needs report", "session-force-report", ["session=session-1", "reason=needs", "report"]],
      ["/opencode-force-report-dry-run session=session-1 reason=dry run", "opencode-force-report-dry-run", ["session=session-1", "reason=dry", "run"]],
      ["/opencode-watchdogs session=session-1", "opencode-watchdogs", ["session=session-1"]],
      ["/opencode-watchdog-show watchdog-1", "opencode-watchdog-show", ["watchdog-1"]],
      ["/opencode-force-report-requests session=session-1", "opencode-force-report-requests", ["session=session-1"]],
      ["/forced-reports session=session-1", "forced-reports", ["session=session-1"]],
      ["/opencode-force-report-show request-1", "opencode-force-report-show", ["request-1"]],
      ["/opencode-watchdog-summary", "opencode-watchdog-summary", []],
      ["/watchdog-summary", "watchdog-summary", []],
      ["/opencode-wake-supervisor-preview session=session-1", "opencode-wake-supervisor-preview", ["session=session-1"]],
      ["/wake-supervisor-preview session=session-1", "wake-supervisor-preview", ["session=session-1"]],
      ["/session-supervisor launch=launch-1", "session-supervisor", ["launch=launch-1"]],
      ["/opencode-supervisor session=session-1", "opencode-supervisor", ["session=session-1"]],
      ["/opencode-wake-supervisor-summary status=human_attention", "opencode-wake-supervisor-summary", ["status=human_attention"]],
      ["/wake-supervisor-summary", "wake-supervisor-summary", []],
      ["/supervisor-summary", "supervisor-summary", []],
      ["/opencode-wake-execution-preview session=session-1", "opencode-wake-execution-preview", ["session=session-1"]],
      ["/wake-execution-preview session=session-1", "wake-execution-preview", ["session=session-1"]],
      ["/opencode-wake-execution-dry-run session=session-1", "opencode-wake-execution-dry-run", ["session=session-1"]],
      ["/opencode-wake-execution-record session=session-1", "opencode-wake-execution-record", ["session=session-1"]],
      ["/wake-execution-record session=session-1", "wake-execution-record", ["session=session-1"]],
      ["/opencode-wake-batch-preview", "opencode-wake-batch-preview", []],
      ["/wake-batch-preview", "wake-batch-preview", []],
      ["/opencode-wake-batch-dry-run", "opencode-wake-batch-dry-run", []],
      ["/wake-batch-dry-run", "wake-batch-dry-run", []],
      ["/opencode-wake-batch-record", "opencode-wake-batch-record", []],
      ["/wake-batch-record", "wake-batch-record", []],
      ["/opencode-wake-executions session=session-1", "opencode-wake-executions", ["session=session-1"]],
      ["/wake-executions session=session-1", "wake-executions", ["session=session-1"]],
      ["/opencode-wake-execution-latest session=session-1", "opencode-wake-execution-latest", ["session=session-1"]],
      ["/wake-execution-latest session=session-1", "wake-execution-latest", ["session=session-1"]],
      ["/opencode-wake-execution-show execution-1", "opencode-wake-execution-show", ["execution-1"]],
      ["/opencode-wake-execution-summary", "opencode-wake-execution-summary", []],
      ["/wake-execution-summary", "wake-execution-summary", []],
      ["/opencode-ask-commander-preview session=session-1 question=prefer A or B", "opencode-ask-commander-preview", ["session=session-1", "question=prefer", "A", "or", "B"]],
      ["/ask-commander-preview session=session-1 question=prefer A or B", "ask-commander-preview", ["session=session-1", "question=prefer", "A", "or", "B"]],
      ["/opencode-ask-commander-dry-run session=session-1 question=prefer A or B", "opencode-ask-commander-dry-run", ["session=session-1", "question=prefer", "A", "or", "B"]],
      ["/ask-commander-dry-run session=session-1 question=prefer A or B", "ask-commander-dry-run", ["session=session-1", "question=prefer", "A", "or", "B"]],
      ["/opencode-ask-commander session=session-1 question=prefer A or B", "opencode-ask-commander", ["session=session-1", "question=prefer", "A", "or", "B"]],
      ["/ask-commander progress=progress-1", "ask-commander", ["progress=progress-1"]],
      ["/commander-question watchdog=watchdog-1", "commander-question", ["watchdog=watchdog-1"]],
      ["/opencode-commander-questions session=session-1", "opencode-commander-questions", ["session=session-1"]],
      ["/commander-questions session=session-1", "commander-questions", ["session=session-1"]],
      ["/opencode-commander-question-latest session=session-1", "opencode-commander-question-latest", ["session=session-1"]],
      ["/question-latest session=session-1", "question-latest", ["session=session-1"]],
      ["/opencode-commander-question-show question-1", "opencode-commander-question-show", ["question-1"]],
      ["/opencode-commander-question-summary", "opencode-commander-question-summary", []],
      ["/research-memory-summary", "research-memory-summary", []],
      ["/research-memory-search query=adapter timeout token=abc123", "research-memory-search", ["query=adapter", "timeout", "token=abc123"]],
      ["/research-memory-preview query=adapter timeout", "research-memory-preview", ["query=adapter", "timeout"]],
      ["/research-search query=adapter timeout", "research-search", ["query=adapter", "timeout"]],
      ["/memory-search query=adapter timeout", "memory-search", ["query=adapter", "timeout"]],
      ["/research-memory-show fake-finding-timeout", "research-memory-show", ["fake-finding-timeout"]],
      ["/research-memory-inspect id=fake-finding-timeout", "research-memory-inspect", ["id=fake-finding-timeout"]],
      ["/memory-show fake-finding-timeout", "memory-show", ["fake-finding-timeout"]],
      ["/memory-inspect id=fake-finding-timeout", "memory-inspect", ["id=fake-finding-timeout"]],
      ["/research-inspect id=fake-finding-timeout", "research-inspect", ["id=fake-finding-timeout"]],
      ["/research-memory-near-duplicates query=adapter timeout", "research-memory-near-duplicates", ["query=adapter", "timeout"]],
      ["/research-duplicates query=adapter timeout", "research-duplicates", ["query=adapter", "timeout"]],
      ["/memory-duplicates query=adapter timeout", "memory-duplicates", ["query=adapter", "timeout"]],
      ["/research-near-duplicates objective=adapter timeout", "research-near-duplicates", ["objective=adapter", "timeout"]],
      ["/research-memory-profile", "research-memory-profile", []],
      ["/research-search-profile", "research-search-profile", []],
      ["/memory-profile", "memory-profile", []],
      ["/research-novelty-preview question=adapter timeout method=watchdog config=short-interval", "research-novelty-preview", ["question=adapter", "timeout", "method=watchdog", "config=short-interval"]],
      ["/novelty-preview question=adapter timeout reason=replication", "novelty-preview", ["question=adapter", "timeout", "reason=replication"]],
      ["/research-dup-check question=adapter timeout", "research-dup-check", ["question=adapter", "timeout"]],
      ["/executor-review-preview result=result-1", "executor-review-preview", ["result=result-1"]],
      ["/executor-review result=result-1", "executor-review", ["result=result-1"]],
      ["/executor-review-dry-run result=result-1", "executor-review-dry-run", ["result=result-1"]],
      ["/executor-reviews", "executor-reviews", []],
      ["/executor-review-show review-1", "executor-review-show", ["review-1"]],
      ["/commander-executor-review-preview mission=mission-1", "commander-executor-review-preview", ["mission=mission-1"]],
      ["/commander-executor-review result=result-1", "commander-executor-review", ["result=result-1"]],
      ["/commander-executor-reviews", "commander-executor-reviews", []],
      ["/executor-review-draft-preview review=review-1", "executor-review-draft-preview", ["review=review-1"]],
      ["/executor-review-draft-summary", "executor-review-draft-summary", []],
      ["/executor-review-drafts result=result-1", "executor-review-drafts", ["result=result-1"]],
      ["/commander-executor-draft-preview mission=mission-1", "commander-executor-draft-preview", ["mission=mission-1"]],
      ["/commander-executor-drafts handoff=handoff-1", "commander-executor-drafts", ["handoff=handoff-1"]],
      ["/executor-review-proposal-create-preview review=review-1 draft=draft-1", "executor-review-proposal-create-preview", ["review=review-1", "draft=draft-1"]],
      ["/executor-review-proposal-create review=review-1 draft=draft-1", "executor-review-proposal-create", ["review=review-1", "draft=draft-1"]],
      ["/executor-review-proposal-create-dry-run review=review-1 draft=draft-1", "executor-review-proposal-create-dry-run", ["review=review-1", "draft=draft-1"]],
      ["/executor-review-proposal-creates", "executor-review-proposal-creates", []],
      ["/executor-review-proposal-create-show create-1", "executor-review-proposal-create-show", ["create-1"]],
      ["/executor-draft-create-preview review=review-1 draft=draft-1", "executor-draft-create-preview", ["review=review-1", "draft=draft-1"]],
      ["/executor-draft-create review=review-1 draft=draft-1", "executor-draft-create", ["review=review-1", "draft=draft-1"]],
      ["/commander-executor-proposal-create review=review-1 draft=draft-1", "commander-executor-proposal-create", ["review=review-1", "draft=draft-1"]],
      ["/executor-review-proposal-review-preview proposal=proposal-1 create=create-1", "executor-review-proposal-review-preview", ["proposal=proposal-1", "create=create-1"]],
      ["/executor-review-proposal-review-request proposal=proposal-1", "executor-review-proposal-review-request", ["proposal=proposal-1"]],
      ["/executor-review-proposal-review-dry-run proposal=proposal-1", "executor-review-proposal-review-dry-run", ["proposal=proposal-1"]],
      ["/executor-review-proposal-review-requests", "executor-review-proposal-review-requests", []],
      ["/executor-review-proposal-review-show gate-1", "executor-review-proposal-review-show", ["gate-1"]],
      ["/executor-draft-review-preview proposal=proposal-1", "executor-draft-review-preview", ["proposal=proposal-1"]],
      ["/executor-draft-review-request proposal=proposal-1", "executor-draft-review-request", ["proposal=proposal-1"]],
      ["/commander-executor-proposal-review-request proposal=proposal-1", "commander-executor-proposal-review-request", ["proposal=proposal-1"]],
      ["/executor-review-proposal-review-decision-preview review=review-1 decision=approve", "executor-review-proposal-review-decision-preview", ["review=review-1", "decision=approve"]],
      ["/executor-review-proposal-review-approve review=review-1", "executor-review-proposal-review-approve", ["review=review-1"]],
      ["/executor-review-proposal-review-reject review=review-1 reason=needs human review", "executor-review-proposal-review-reject", ["review=review-1", "reason=needs", "human", "review"]],
      ["/executor-review-proposal-review-decision-dry-run review=review-1 decision=reject reason=missing evidence", "executor-review-proposal-review-decision-dry-run", ["review=review-1", "decision=reject", "reason=missing", "evidence"]],
      ["/executor-review-proposal-review-decisions", "executor-review-proposal-review-decisions", []],
      ["/executor-review-proposal-review-decision-show decision-1", "executor-review-proposal-review-decision-show", ["decision-1"]],
      ["/executor-draft-review-approve review=review-1", "executor-draft-review-approve", ["review=review-1"]],
      ["/executor-draft-review-reject review=review-1 reason=no", "executor-draft-review-reject", ["review=review-1", "reason=no"]],
      ["/commander-executor-proposal-review-approve review=review-1", "commander-executor-proposal-review-approve", ["review=review-1"]],
      ["/commander-executor-proposal-review-reject review=review-1 reason=no", "commander-executor-proposal-review-reject", ["review=review-1", "reason=no"]],
      ["/executor-review-proposal-apply-readiness proposal=proposal-1", "executor-review-proposal-apply-readiness", ["proposal=proposal-1"]],
      ["/executor-review-proposal-apply-readiness review=review-1", "executor-review-proposal-apply-readiness", ["review=review-1"]],
      ["/executor-review-proposal-apply-readiness decision=decision-1", "executor-review-proposal-apply-readiness", ["decision=decision-1"]],
      ["/executor-review-proposal-apply-readiness-summary", "executor-review-proposal-apply-readiness-summary", []],
      ["/executor-review-proposal-apply-readiness-list status=ready", "executor-review-proposal-apply-readiness-list", ["status=ready"]],
      ["/executor-review-proposal-apply-readiness-show readiness-1", "executor-review-proposal-apply-readiness-show", ["readiness-1"]],
      ["/executor-review-proposal-narrow-apply-preview proposal=proposal-1", "executor-review-proposal-narrow-apply-preview", ["proposal=proposal-1"]],
      ["/executor-review-proposal-narrow-apply proposal=proposal-1", "executor-review-proposal-narrow-apply", ["proposal=proposal-1"]],
      ["/executor-review-proposal-narrow-apply-dry-run proposal=proposal-1", "executor-review-proposal-narrow-apply-dry-run", ["proposal=proposal-1"]],
      ["/executor-review-proposal-narrow-applies", "executor-review-proposal-narrow-applies", []],
      ["/executor-review-proposal-narrow-apply-show apply-1", "executor-review-proposal-narrow-apply-show", ["apply-1"]],
      ["/executor-draft-narrow-apply-preview proposal=proposal-1", "executor-draft-narrow-apply-preview", ["proposal=proposal-1"]],
      ["/executor-draft-narrow-apply proposal=proposal-1", "executor-draft-narrow-apply", ["proposal=proposal-1"]],
      ["/commander-executor-proposal-narrow-apply proposal=proposal-1", "commander-executor-proposal-narrow-apply", ["proposal=proposal-1"]],
      ["/proposal-narrow-apply proposal=proposal-1", "proposal-narrow-apply", ["proposal=proposal-1"]],
      ["/executor-draft-apply-readiness proposal=proposal-1", "executor-draft-apply-readiness", ["proposal=proposal-1"]],
      ["/commander-executor-proposal-apply-readiness proposal=proposal-1", "commander-executor-proposal-apply-readiness", ["proposal=proposal-1"]],
      ["/proposal-apply-readiness proposal=proposal-1", "proposal-apply-readiness", ["proposal=proposal-1"]],
      ["/minimax-live-preview surface=commander_executor_review", "minimax-live-preview", ["surface=commander_executor_review"]],
      ["/minimax-live-validate surface=commander_executor_review", "minimax-live-validate", ["surface=commander_executor_review"]],
      ["/minimax-live-dry-run", "minimax-live-dry-run", []],
      ["/minimax-live-validations", "minimax-live-validations", []],
      ["/minimax-live-show validation-1", "minimax-live-show", ["validation-1"]],
      ["/reasoning-live-preview research_synthesis", "reasoning-live-preview", ["research_synthesis"]],
      ["/reasoning-live-validate commander_cycle", "reasoning-live-validate", ["commander_cycle"]],
      ["/minimax-provider-validate", "minimax-provider-validate", []],
      ["/scheduler-stop e2e stop", "scheduler-stop", ["e2e", "stop"]],
      ["/scheduler-events", "scheduler-events", []],
      ["/wake-scheduler-preview every=60s", "wake-scheduler-preview", ["every=60s"]],
      ["/wake-scheduler-start dry-run", "wake-scheduler-start", ["dry-run"]],
      ["/wake-scheduler-stop stop", "wake-scheduler-stop", ["stop"]],
      ["/wake-scheduler-recovery", "wake-scheduler-recovery", []],
      ["/wake-scheduler-recovery-workflow recovery-1", "wake-scheduler-recovery-workflow", ["recovery-1"]],
      ["/wake-scheduler-audit", "wake-scheduler-audit", []],
      ["/wake-scheduler-nav", "wake-scheduler-nav", []],
    ] as const) {
      const result = applyKeyCommandWithEffects({
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }, { type: "submit" })

      expect(result.state.messageDraft).toBe("")
      expect(result.state.lastCommand).toBe(command)
      expect(result.effects).toEqual([{ type: "send-command", command, ...(args.length > 0 ? { args: [...args] } : {}) }])
    }

    for (const message of ["/tmp/repro/wake-tick", "/path/wake-schedule", ".wake-tick", ":wake-schedule schedule-1", "/tmp/repro/scheduler-start", "/path/scheduler-events", ".scheduler-start", ":scheduler-start", "/tmp/repro/scheduler-bootstrap", "/path/scheduler-bootstrap-preview", ".scheduler-bootstrap", ":scheduler-bootstrap", "/tmp/repro/scheduler-recovery", "/path/scheduler-recovery-ack", ".scheduler-recovery", ":scheduler-recovery", "/tmp/repro/scheduler-recovery-workflow", "/path/scheduler-recovery-step-done", ".scheduler-recovery-workflow", ":scheduler-recovery-step-done", "/tmp/repro/scheduler-audit", "/path/scheduler-audit-chain", ".scheduler-audit", ":scheduler-audit", "/tmp/repro/scheduler-nav", "/path/scheduler-nav-target", ".scheduler-nav", ":scheduler-nav", "/tmp/repro/scheduler-nav-stage", "/path/scheduler-nav-stage-preview", ".scheduler-nav-stage", ":scheduler-nav-stage", "/tmp/repro/scheduler-nav-run", "/path/scheduler-nav-run-preview", ".scheduler-nav-run", ":scheduler-nav-run", "/tmp/repro/scheduler-nav-read-history", "/path/scheduler-nav-read-compare", ".scheduler-nav-read-history", ":scheduler-nav-read-compare", "/tmp/repro/scheduler-nav-write-preview", "/path/scheduler-nav-write-board", ".scheduler-nav-write-preview", ":scheduler-write-board", "/tmp/repro/scheduler-nav-write-stage", "/path/scheduler-nav-write-stage-preview", ".scheduler-nav-write-stage", ":scheduler-write-stage", "/tmp/repro/scheduler-nav-write-run", "/path/scheduler-nav-write-run-preview", ".scheduler-nav-write-run", ":scheduler-write-run", "/tmp/repro/scheduler-nav-write-run-history", "/path/scheduler-nav-write-run-compare", ".scheduler-nav-write-run-history", ":scheduler-write-run-compare", "/tmp/repro/scheduler-nav-write-approve", "/path/scheduler-nav-write-readiness", ".scheduler-nav-write-approve", ":scheduler-write-readiness", "/tmp/repro/scheduler-nav-checkpoint-run", "/path/scheduler-nav-checkpoint-run-preview", ".scheduler-nav-checkpoint-run", ":scheduler-checkpoint-run", "/tmp/repro/scheduler-nav-checkpoint-history", "/path/scheduler-nav-checkpoint-compare", ".scheduler-nav-checkpoint-history", ":scheduler-checkpoint-compare", "/tmp/repro/authority", "/path/authority-show", ".authority", ":authority", "/tmp/repro/result-review-packet", "/path/result-review-summary", ".result-review-packet", ":result-review-packet", "/tmp/repro/opencode-session-plan", "/path/opencode-session-preview", ".opencode-session-plan", ":opencode-session-plan", "/tmp/repro/context-budget-preview", "/path/model-capabilities", ".context-budget-preview", ":context-budget-preview", "/tmp/repro/context-packet-preview", "/path/context-packet-summary", ".context-packet-preview", ":context-packet-preview", "/tmp/repro/opencode-session-instruction-pack-write", "/path/opencode-session-instruction-pack-preview", ".opencode-session-instruction-pack-write", ":opencode-session-instruction-pack-write", "/tmp/repro/opencode-launch-readiness", "/path/launch-readiness", ".opencode-launch-readiness", ":opencode-launch-readiness", "/tmp/ask-commander", "/path/opencode-ask-commander", ".opencode-ask-commander", ":opencode-ask-commander", "/tmp/repro/research-memory-search", "/path/research-novelty-preview", ".research-memory-search", ":research-memory-search", "/tmp/repro/research-memory-show", "/path/research-memory-inspect", ".research-memory-near-duplicates", ":research-memory-profile", "/tmp/research", "/tmp/repro/commander-continuity-preview", "/path/commander-midmission-packet", ".commander-open-loops", ":commander-continuity-thread", "/tmp/repro/executor-review", "/path/executor-review-preview", ".executor-review", ":executor-review", "/tmp/repro/executor-review-draft-preview", "/path/executor-review-draft-summary", ".executor-review-draft-preview", ":executor-review-draft-preview", "/tmp/repro/executor-review-proposal-create", "/path/executor-review-proposal-create-preview", ".executor-review-proposal-create", ":executor-review-proposal-create", "/tmp/repro/executor-review-proposal-review-request", "/path/executor-review-proposal-review-preview", ".executor-review-proposal-review-request", ":executor-review-proposal-review-request", "/tmp/repro/executor-review-proposal-review-approve", "/path/executor-review-proposal-review-reject", ".executor-review-proposal-review-approve", ":executor-review-proposal-review-reject", "/tmp/repro/executor-review-proposal-narrow-apply", "/path/executor-review-proposal-narrow-apply-preview", ".executor-review-proposal-narrow-apply", ":executor-review-proposal-narrow-apply", "/tmp/repro/minimax-live-preview", "/path/minimax-live-validate", ".minimax-live-preview", ":minimax-live-preview"]) {
      const result = applyKeyCommandWithEffects({
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }, { type: "submit" })

      expect(result.effects).toEqual([{ type: "send-user-message", message }])
    }
  })

  test("slash command arguments are redacted before entering system actions", () => {
    const state: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/notes topic-1 token=command-secret",
    }

    const result = applyKeyCommandWithEffects(state, { type: "submit" })

    expect(result.state.systemActions.at(-1)?.detail).toBe("notes topic-1 [REDACTED]")
    expect(JSON.stringify(result.state)).not.toContain("command-secret")
    expect(result.effects).toEqual([{ type: "send-command", command: "notes", args: ["topic-1", "token=command-secret"] }])
  })

  test("mission command arguments are redacted before entering system actions", () => {
    const state: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/result mission-1 claim-1 token=mission-secret",
    }

    const result = applyKeyCommandWithEffects(state, { type: "submit" })

    expect(result.state.systemActions.at(-1)?.detail).toBe("result mission-1 claim-1 [REDACTED]")
    expect(JSON.stringify(result.state)).not.toContain("mission-secret")
    expect(result.effects).toEqual([{ type: "send-command", command: "result", args: ["mission-1", "claim-1", "token=mission-secret"] }])
  })

  test("path-like slash messages remain user messages", () => {
    const state: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/tmp/repro should be inspected",
    }

    const result = applyKeyCommandWithEffects(state, { type: "submit" })

    expect(result.state.submittedMessages).toEqual(["/tmp/repro should be inspected"])
    expect(result.effects).toEqual([{ type: "send-user-message", message: "/tmp/repro should be inspected" }])
  })

  test("unknown slash commands remain user messages", () => {
    const state: UiState = {
      ...initialState("/tmp/demo"),
      screen: "main",
      focus: "message-box",
      messageDraft: "/unknown command",
    }

    const result = applyKeyCommandWithEffects(state, { type: "submit" })

    expect(result.state.submittedMessages).toEqual(["/unknown command"])
    expect(result.effects).toEqual([{ type: "send-user-message", message: "/unknown command" }])
  })

  test("dot and colon prefixed text remains a user message", () => {
    for (const message of [".status notes", ":missions", ".topics", ":research", ".mission", ":claim", ".complete", ":complete", ".reviews", ":approve", ".proposals", ":apply-proposal", ".bundles", ":apply-bundle", ".playbooks", ":draft-fail", ".drafts", ":draft-review", ".apply-target", ":apply-preview", ".audit", ":audit", ".queue", ":queues", ".open", ":jump", ".stage", ":run-staged", "/tmp/repro", "/path"]) {
      const state: UiState = {
        ...initialState("/tmp/demo"),
        screen: "main",
        focus: "message-box",
        messageDraft: message,
      }

      const result = applyKeyCommandWithEffects(state, { type: "submit" })

      expect(result.state.submittedMessages).toEqual([message])
      expect(result.effects).toEqual([{ type: "send-user-message", message }])
    }
  })

  test("parses OpenCode continuity and context refresh commands through the slash whitelist", () => {
    for (const [message, command] of [
      ["/opencode-continuity-preview session=session-1", "opencode-continuity-preview"],
      ["/opencode-continuation-preview source_session=session-1 mode=patch_session patch_reason=bounded patch", "opencode-continuation-preview"],
      ["/opencode-continuation-preview source_session_id=session-1 source_launch_id=launch-1 mode=continue_same_session continuation_reason=bounded continuation previous_refresh_id=refresh-1", "opencode-continuation-preview"],
      ["/opencode-context-refresh-preview session=session-1", "opencode-context-refresh-preview"],
      ["/opencode-context-refresh-dry-run session=session-1", "opencode-context-refresh-dry-run"],
      ["/opencode-context-refresh-write session=session-1", "opencode-context-refresh-write"],
      ["/context-refreshes session=session-1", "context-refreshes"],
      ["/context-refresh-latest session=session-1", "context-refresh-latest"],
      ["/opencode-context-refresh-show refresh-1", "opencode-context-refresh-show"],
      ["/opencode-context-refresh-summary", "opencode-context-refresh-summary"],
    ]) {
      const result = applyKeyCommandWithEffects({ ...initialState("/tmp/demo"), screen: "main", focus: "message-box", messageDraft: message }, { type: "submit" })
      expect(result.effects[0]).toMatchObject({ type: "send-command", command })
    }
    for (const message of ["/tmp/opencode-context-refresh", "/path/opencode-refresh-write", ".opencode-refresh-write session=session-1", ":opencode-refresh-write session=session-1"]) {
      const result = applyKeyCommandWithEffects({ ...initialState("/tmp/demo"), screen: "main", focus: "message-box", messageDraft: message }, { type: "submit" })
      expect(result.effects).toEqual([{ type: "send-user-message", message }])
    }
  })
})
