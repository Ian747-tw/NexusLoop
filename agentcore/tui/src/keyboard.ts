import type { FocusTarget, UiState } from "./state"

export type KeyCommand =
  | { type: "focus-next" }
  | { type: "focus-prev" }
  | { type: "select-next" }
  | { type: "select-prev" }
  | { type: "submit" }
  | { type: "cancel" }
  | { type: "insert"; text: string }
  | { type: "backspace" }

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
  switch (command.type) {
    case "focus-next":
      return state.screen === "main" ? { ...state, focus: moveFocus(state.focus, 1) } : state
    case "focus-prev":
      return state.screen === "main" ? { ...state, focus: moveFocus(state.focus, -1) } : state
    case "select-next":
      if (state.screen === "init") return { ...state, initSelection: (state.initSelection + 1) % state.initChoices.length }
      if (state.screen === "resume") {
        return { ...state, resumeSelection: (state.resumeSelection + 1) % state.resumeChoices.length }
      }
      return state
    case "select-prev":
      if (state.screen === "init") {
        return { ...state, initSelection: (state.initSelection - 1 + state.initChoices.length) % state.initChoices.length }
      }
      if (state.screen === "resume") {
        return {
          ...state,
          resumeSelection: (state.resumeSelection - 1 + state.resumeChoices.length) % state.resumeChoices.length,
        }
      }
      return state
    case "submit":
      if (state.screen === "init") {
        const choice = state.initChoices[state.initSelection]
        if (choice?.id === "initialize") {
          return {
            ...state,
            screen: "main",
            focus: "message-box",
            lastCommand: "initialize",
            commander: { ...state.commander, workIntent: "TUI onboarding shell" },
            systemActions: [...state.systemActions, { title: "Initialize selected", detail: "Entered onboarding shell" }],
          }
        }
        return { ...state, lastCommand: "cancel" }
      }
      if (state.screen === "resume") {
        const choice = state.resumeChoices[state.resumeSelection]
        return {
          ...state,
          screen: "main",
          focus: "message-box",
          lastCommand: choice?.id,
          systemActions: [...state.systemActions, { title: choice?.label ?? "Resume choice", detail: "Selection routed to runtime" }],
        }
      }
      if (state.messageDraft.trim() === "") return state
      return {
        ...state,
        submittedMessages: [...state.submittedMessages, state.messageDraft],
        systemActions: [...state.systemActions, { title: "user -> runtime", detail: state.messageDraft }],
        messageDraft: "",
      }
    case "cancel":
      return state.screen === "init" || state.screen === "resume"
        ? { ...state, lastCommand: "cancel" }
        : { ...state, messageDraft: "" }
    case "insert":
      return state.focus === "message-box" ? { ...state, messageDraft: state.messageDraft + command.text } : state
    case "backspace":
      return state.focus === "message-box" ? { ...state, messageDraft: state.messageDraft.slice(0, -1) } : state
  }
}
