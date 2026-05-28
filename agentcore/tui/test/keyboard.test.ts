import { describe, expect, test } from "bun:test"
import { applyKeyCommand, applyKeyCommandWithEffects } from "../src/keyboard"
import { initialState, type UiState } from "../src/state"

describe("TUI keyboard command model", () => {
  test("select Initialize enters onboarding shell", () => {
    const state = { ...initialState("/tmp/demo"), screen: "init" as const, focus: "init-choice" as const }
    const next = applyKeyCommand(state, { type: "submit" })

    expect(next.screen).toBe("main")
    expect(next.lastCommand).toBe("initialize")
    expect(next.commander.workIntent).toBe("TUI onboarding shell")
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

  test("initialize submit followed by message submit does not resend initialize", () => {
    let state: UiState = { ...initialState("/tmp/demo"), screen: "init", focus: "init-choice" }
    const effects: string[] = []

    let result = applyKeyCommandWithEffects(state, { type: "submit" })
    state = result.state
    effects.push(...result.effects.map((effect) => `${effect.type}:${"command" in effect ? effect.command : effect.message}`))

    result = applyKeyCommandWithEffects(state, { type: "insert", text: "hello runtime" })
    state = result.state
    effects.push(...result.effects.map((effect) => `${effect.type}:${"command" in effect ? effect.command : effect.message}`))

    result = applyKeyCommandWithEffects(state, { type: "submit" })
    state = result.state
    effects.push(...result.effects.map((effect) => `${effect.type}:${"command" in effect ? effect.command : effect.message}`))

    expect(effects).toEqual(["send-command:initialize", "send-user-message:hello runtime"])
    expect(state.submittedMessages).toEqual(["hello runtime"])
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

    for (const message of ["/tmp/repro/handoff", "/path/handoff", ".handoff proposal-1", ":handoff-show handoff-1", ".handoff-followup handoff-1", ":handoff-active"]) {
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
})
