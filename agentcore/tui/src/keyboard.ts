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

export function parseRuntimeCommand(value: string): { command: string; args: string[] } | undefined {
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
  "proposals",
  "proposal",
  "proposal-review",
  "apply-proposal",
  "cancel-proposal",
  "propose-progress",
  "propose-result",
  "propose-complete",
  "propose-fail",
  "propose-cancel",
  "propose-release",
  "bundles",
  "bundle",
  "create-bundle",
  "bundle-add",
  "bundle-review",
  "bundle-ready",
  "apply-bundle",
  "cancel-bundle",
  "playbooks",
  "playbook",
  "draft-complete",
  "draft-result-complete",
  "draft-progress",
  "draft-fail",
  "draft-cancel",
  "draft-release",
  "drafts",
  "workbench",
  "draft",
  "draft-ready",
  "draft-review",
  "cancel-draft",
  "apply-preview",
  "apply-target",
  "apply-partial",
  "audit",
  "audit-kind",
  "queues",
  "queue",
  "queue-review",
  "queue-apply",
  "queue-blocked",
  "queue-failed",
  "queue-applied",
  "queue-drafts",
  "queue-bundles",
  "queue-stale",
  "open",
  "jump",
  "target",
  "open-proposal",
  "open-bundle",
  "open-draft",
  "open-review",
  "open-mission",
  "stage",
  "stage-command",
  "clear-stage",
  "run-staged",
  "execute-staged",
  "stage-preview",
  "apis",
  "api",
  "api-preview",
  "api-call",
  "api-dry-run",
  "api-audit",
  "api-ingest-preview",
  "api-ingest",
  "api-ingest-dry-run",
  "api-ingestions",
  "synthesize-preview",
  "synthesize",
  "synthesize-proposals",
  "syntheses",
  "synthesis",
  "cycle-preview",
  "cycle",
  "cycle-proposals",
  "cycle-bundle",
  "cycles",
  "cycle-show",
  "handoff-preview",
  "handoff",
  "handoff-dry-run",
  "handoffs",
  "handoff-show",
  "handoff-followup",
  "handoff-followups",
  "handoff-followup-summary",
  "handoff-queue",
  "handoff-active",
  "handoff-results",
  "handoff-failed",
  "handoff-blocked",
  "handoff-stale",
  "checkpoint-preview",
  "checkpoint",
  "checkpoints",
  "checkpoint-show",
  "restore-preview",
  "resume-preview",
  "resume-mark",
  "resume-anchors",
  "resume-anchor",
  "wake-preview",
  "wake",
  "wakes",
  "wake-show",
  "continue-preview",
  "cont-preview",
  "continue-plan",
  "continue-step",
  "cont-step",
  "continue-dry-run",
  "continue-pause",
  "continue-cancel",
  "continuations",
  "continue-show",
  "schedule-wake-preview",
  "schedule-wake",
  "wake-schedules",
  "wake-schedule",
  "wake-schedule-pause",
  "wake-schedule-resume",
  "wake-schedule-cancel",
  "wake-tick-preview",
  "wake-tick",
  "wake-tick-dry-run",
  "wake-ticks",
  "wake-tick-show",
  "scheduler-preview",
  "scheduler-start",
  "scheduler-stop",
  "scheduler-status",
  "scheduler-bootstrap",
  "scheduler-bootstrap-preview",
  "scheduler-recovery",
  "scheduler-recovery-preview",
  "scheduler-recoveries",
  "scheduler-recovery-show",
  "scheduler-recovery-ack",
  "scheduler-recovery-resolve",
  "scheduler-recovery-dismiss",
  "scheduler-recovery-workflow-preview",
  "scheduler-recovery-workflow",
  "scheduler-recovery-workflows",
  "scheduler-recovery-workflow-show",
  "scheduler-recovery-workflow-verify",
  "scheduler-recovery-step-done",
  "scheduler-recovery-step-skip",
  "scheduler-recovery-step-block",
  "scheduler-recovery-workflow-cancel",
  "scheduler-events",
  "wake-scheduler-preview",
  "wake-scheduler-start",
  "wake-scheduler-stop",
  "wake-scheduler-recovery",
  "wake-scheduler-recovery-workflow",
  "reasoning",
  "reasoning-health",
  "reasoning-smoke-preview",
  "reasoning-smoke",
  "reasoning-smoke-dry-run",
])
