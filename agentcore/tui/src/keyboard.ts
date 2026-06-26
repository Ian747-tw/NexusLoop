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
  "authority",
  "authority-summary",
  "authority-list",
  "authority-show",
  "authority-profile",
  "command-authority",
  "command-map",
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
  "opencode-smoke-preview",
  "opencode-smoke",
  "opencode-smoke-dry-run",
  "opencode-smokes",
  "opencode-smoke-show",
  "opencode-process-smoke",
  "opencode-health-smoke",
  "handoff-readiness",
  "handoff-readiness-summary",
  "opencode-handoff-readiness",
  "handoff-ready",
  "result-review-packet",
  "result-review-summary",
  "opencode-result-review",
  "executor-result-review",
  "handoff-result-review",
  "executor-review-preview",
  "executor-review",
  "executor-review-dry-run",
  "executor-reviews",
  "executor-review-show",
  "commander-executor-review-preview",
  "commander-executor-review",
  "commander-executor-reviews",
  "executor-review-draft-preview",
  "executor-review-draft-summary",
  "executor-review-drafts",
  "commander-executor-draft-preview",
  "commander-executor-drafts",
  "executor-review-proposal-create-preview",
  "executor-review-proposal-create",
  "executor-review-proposal-create-dry-run",
  "executor-review-proposal-creates",
  "executor-review-proposal-create-show",
  "executor-draft-create-preview",
  "executor-draft-create",
  "commander-executor-proposal-create",
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
  "scheduler-audit",
  "scheduler-audit-summary",
  "scheduler-audit-timeline",
  "scheduler-audit-chain",
  "scheduler-audit-incidents",
  "scheduler-nav",
  "scheduler-navigation",
  "scheduler-nav-command",
  "scheduler-nav-target",
  "scheduler-nav-stage-preview",
  "scheduler-nav-stage",
  "scheduler-nav-staged",
  "scheduler-nav-unstage",
  "scheduler-nav-stage-clear",
  "scheduler-nav-run-preview",
  "scheduler-nav-run",
  "scheduler-nav-run-dry-run",
  "scheduler-nav-runs",
  "scheduler-nav-run-show",
  "scheduler-nav-read-preview",
  "scheduler-nav-read",
  "scheduler-nav-read-history",
  "scheduler-nav-run-history",
  "scheduler-nav-read-compare",
  "scheduler-nav-run-compare",
  "scheduler-nav-read-compare-runs",
  "scheduler-nav-read-stale",
  "scheduler-nav-read-group",
  "scheduler-nav-write-preview",
  "scheduler-nav-write-board",
  "scheduler-nav-write-stage-preview",
  "scheduler-nav-write-stage",
  "scheduler-nav-write-stage-medium",
  "scheduler-nav-write-staged",
  "scheduler-nav-write-unstage",
  "scheduler-nav-write-stage-clear",
  "scheduler-write-preview",
  "scheduler-write-board",
  "scheduler-write-stage-preview",
  "scheduler-write-stage",
  "scheduler-write-staged",
  "scheduler-nav-write-run-preview",
  "scheduler-nav-write-run",
  "scheduler-nav-write-run-dry-run",
  "scheduler-nav-write-runs",
  "scheduler-nav-write-run-show",
  "scheduler-nav-write-run-history",
  "scheduler-nav-write-run-compare",
  "scheduler-nav-write-run-compare-runs",
  "scheduler-nav-write-run-stale",
  "scheduler-nav-write-run-group",
  "scheduler-nav-write-readiness",
  "scheduler-nav-write-approve",
  "scheduler-nav-write-reject",
  "scheduler-nav-write-approval-revoke",
  "scheduler-nav-write-approvals",
  "scheduler-nav-write-approval-show",
  "scheduler-nav-checkpoint-run-preview",
  "scheduler-nav-checkpoint-run",
  "scheduler-nav-checkpoint-run-dry-run",
  "scheduler-nav-checkpoint-runs",
  "scheduler-nav-checkpoint-run-show",
  "scheduler-nav-checkpoint-history",
  "scheduler-nav-checkpoint-compare",
  "scheduler-nav-checkpoint-compare-runs",
  "scheduler-nav-checkpoint-stale",
  "scheduler-nav-checkpoint-group",
  "scheduler-nav-checkpoint-approval-usage",
  "scheduler-checkpoint-run-preview",
  "scheduler-checkpoint-run",
  "scheduler-checkpoint-runs",
  "scheduler-checkpoint-history",
  "scheduler-checkpoint-compare",
  "scheduler-checkpoint-stale",
  "scheduler-write-readiness",
  "scheduler-write-approve",
  "scheduler-write-reject",
  "scheduler-write-approvals",
  "scheduler-write-run-preview",
  "scheduler-write-run",
  "scheduler-write-runs",
  "scheduler-write-run-history",
  "scheduler-write-run-compare",
  "scheduler-write-run-stale",
  "scheduler-events",
  "wake-scheduler-preview",
  "wake-scheduler-start",
  "wake-scheduler-stop",
  "wake-scheduler-recovery",
  "wake-scheduler-recovery-workflow",
  "wake-scheduler-audit",
  "wake-scheduler-nav",
  "reasoning",
  "reasoning-health",
  "reasoning-smoke-preview",
  "reasoning-smoke",
  "reasoning-smoke-dry-run",
  "minimax-live-preview",
  "minimax-live-validate",
  "minimax-live-dry-run",
  "minimax-live-validations",
  "minimax-live-show",
  "reasoning-live-preview",
  "reasoning-live-validate",
  "minimax-provider-validate",
])
