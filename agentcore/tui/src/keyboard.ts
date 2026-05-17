import type { FocusTarget, UiState } from "./state"
import { redactText } from "./redaction"

export type KeyCommand =
  | { type: "focus-next" }
  | { type: "focus-prev" }
  | { type: "select-next" }
  | { type: "select-prev" }
  | { type: "submit" }
  | { type: "cancel" }
  | { type: "insert"; text: string }
  | { type: "backspace" }

export type KeySideEffect =
  | { type: "send-command"; command: string; args?: string[] }
  | { type: "send-user-message"; message: string }

export type KeyCommandResult = {
  state: UiState
  effects: KeySideEffect[]
}

const mainFocusOrder: FocusTarget[] = [
  "executor",
  "commander",
  "system-actions",
  "search-records",
  "approval",
  "message-box",
]

function moveFocus(current: FocusTarget, direction: 1 | -1): FocusTarget {
  const index = mainFocusOrder.indexOf(current)
  if (index === -1) return "message-box"
  return mainFocusOrder[(index + direction + mainFocusOrder.length) % mainFocusOrder.length]
}

export function applyKeyCommand(state: UiState, command: KeyCommand): UiState {
  return applyKeyCommandWithEffects(state, command).state
}

export function applyKeyCommandWithEffects(state: UiState, command: KeyCommand): KeyCommandResult {
  switch (command.type) {
    case "focus-next":
      return { state: state.screen === "main" ? { ...state, focus: moveFocus(state.focus, 1) } : state, effects: [] }
    case "focus-prev":
      return { state: state.screen === "main" ? { ...state, focus: moveFocus(state.focus, -1) } : state, effects: [] }
    case "select-next":
      if (state.screen === "init") {
        return { state: { ...state, initSelection: (state.initSelection + 1) % state.initChoices.length }, effects: [] }
      }
      if (state.screen === "resume") {
        return { state: { ...state, resumeSelection: (state.resumeSelection + 1) % state.resumeChoices.length }, effects: [] }
      }
      return { state, effects: [] }
    case "select-prev":
      if (state.screen === "init") {
        return {
          state: { ...state, initSelection: (state.initSelection - 1 + state.initChoices.length) % state.initChoices.length },
          effects: [],
        }
      }
      if (state.screen === "resume") {
        return {
          state: {
            ...state,
            resumeSelection: (state.resumeSelection - 1 + state.resumeChoices.length) % state.resumeChoices.length,
          },
          effects: [],
        }
      }
      return { state, effects: [] }
    case "submit":
      if (state.screen === "init") {
        const choice = state.initChoices[state.initSelection]
        if (choice?.id === "initialize") {
          return {
            state: {
              ...state,
              screen: "main",
              focus: "message-box",
              lastCommand: "initialize",
              commander: { ...state.commander, workIntent: "TUI onboarding shell" },
              systemActions: [...state.systemActions, { title: "Initialize selected", detail: "Entered onboarding shell" }],
            },
            effects: [{ type: "send-command", command: "initialize" }],
          }
        }
        return { state: { ...state, lastCommand: "cancel" }, effects: [{ type: "send-command", command: "cancel" }] }
      }
      if (state.screen === "resume") {
        const choice = state.resumeChoices[state.resumeSelection]
        const selected = choice?.id ?? "resume"
        return {
          state: {
            ...state,
            screen: "main",
            focus: "message-box",
            lastCommand: selected,
            systemActions: [...state.systemActions, { title: choice?.label ?? "Resume choice", detail: "Selection routed to runtime" }],
          },
          effects: [{ type: "send-command", command: selected }],
        }
      }
      if (state.messageDraft.trim() === "") return { state, effects: [] }
      const runtimeCommand = parseRuntimeCommand(state.messageDraft)
      if (runtimeCommand) {
        const detail = redactText([runtimeCommand.command, ...runtimeCommand.args].join(" "))
        return {
          state: {
            ...state,
            lastCommand: runtimeCommand.command,
            systemActions: [...state.systemActions, { title: "user command -> runtime", detail }],
            messageDraft: "",
          },
          effects: [{
            type: "send-command",
            command: runtimeCommand.command,
            ...(runtimeCommand.args.length > 0 ? { args: runtimeCommand.args } : {}),
          }],
        }
      }
      const redactedMessage = redactText(state.messageDraft)
      return {
        state: {
          ...state,
          submittedMessages: [...state.submittedMessages, redactedMessage],
          systemActions: [...state.systemActions, { title: "user -> runtime", detail: redactedMessage }],
          messageDraft: "",
        },
        effects: [{ type: "send-user-message", message: state.messageDraft }],
      }
    case "cancel":
      return {
        state: state.screen === "init" || state.screen === "resume" ? { ...state, lastCommand: "cancel" } : { ...state, messageDraft: "" },
        effects: [],
      }
    case "insert":
      return {
        state: state.focus === "message-box" ? { ...state, messageDraft: state.messageDraft + command.text } : state,
        effects: [],
      }
    case "backspace":
      return {
        state: state.focus === "message-box" ? { ...state, messageDraft: state.messageDraft.slice(0, -1) } : state,
        effects: [],
      }
  }
}

function parseRuntimeCommand(value: string): { command: string; args: string[] } | undefined {
  const trimmed = value.trim()
  const match = /^\/([a-z][a-z-]*)(?:\s+(.+))?$/i.exec(trimmed)
  const command = match?.[1]?.toLowerCase()
  if (!command || !runtimeCommands.has(command)) return undefined
  const rest = match?.[2]?.trim()
  return { command, args: rest ? rest.split(/\s+/) : [] }
}

const runtimeCommands = new Set([
  "status",
  "missions",
  "resume",
  "new-session",
  "records",
  "shutdown",
  "research",
  "topics",
  "topic",
  "notes",
  "research-events",
  "projection",
  "rebuild-projection",
  "mission",
  "claims",
  "progress",
  "results",
  "claim",
  "progress-add",
  "result",
  "complete",
  "fail",
  "cancel-mission",
  "release-claim",
  "reviews",
  "review",
  "request-review",
  "approve",
  "reject",
  "cancel-review",
])
