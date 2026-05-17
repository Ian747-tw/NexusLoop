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
    for (const message of [".status notes", ":missions", ".topics", ":research", ".mission", ":claim"]) {
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
