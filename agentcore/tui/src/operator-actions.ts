import { redactText } from "./redaction"
import type { CommanderSuggestedCommandSummary, CommanderTargetContextSummary } from "./state"

export type OperatorStagedCommand = {
  source_target_type?: string
  source_target_id?: string
  label: string
  command: string
  command_type: "read" | "write"
  requires_review?: boolean
  requires_active_runtime?: boolean
  staged_at?: string
}

export type OperatorCommandExecutionResult = {
  command: string
  ok: boolean
  summary: string
  executed_at: string
  affected_target_type?: string
  affected_target_id?: string
}

const WRITE_COMMANDS = new Set([
  "claim",
  "progress-add",
  "result",
  "complete",
  "fail",
  "cancel-mission",
  "release-claim",
  "request-review",
  "approve",
  "reject",
  "cancel-review",
  "proposal-review",
  "apply-proposal",
  "cancel-proposal",
  "propose-progress",
  "propose-result",
  "propose-complete",
  "propose-fail",
  "propose-cancel",
  "propose-release",
  "create-bundle",
  "bundle-add",
  "bundle-review",
  "apply-bundle",
  "cancel-bundle",
  "draft-complete",
  "draft-result-complete",
  "draft-progress",
  "draft-fail",
  "draft-cancel",
  "draft-release",
  "draft-review",
  "cancel-draft",
  "apply-target",
  "apply-partial",
  "opencode-smoke",
  "opencode-process-smoke",
  "opencode-health-smoke",
  "executor-review-proposal-create",
  "executor-draft-create",
  "commander-executor-proposal-create",
  "executor-review-proposal-review-request",
  "executor-draft-review-request",
  "commander-executor-proposal-review-request",
  "executor-review-proposal-review-approve",
  "executor-review-proposal-review-reject",
  "executor-draft-review-approve",
  "executor-draft-review-reject",
  "commander-executor-proposal-review-approve",
  "commander-executor-proposal-review-reject",
  "executor-review-proposal-narrow-apply",
  "executor-draft-narrow-apply",
  "commander-executor-proposal-narrow-apply",
  "proposal-narrow-apply",
  "opencode-session-plan",
  "session-plan",
  "opencode-plan",
  "opencode-session-instruction-pack-write",
  "session-instruction-pack-write",
  "opencode-context-pack-write",
  "opencode-launch",
  "launch-opencode",
  "session-launch",
  "opencode-session-launch",
  "opencode-heartbeat",
  "session-heartbeat",
  "opencode-progress",
  "session-progress",
  "opencode-blocker",
  "session-blocker",
  "opencode-question",
  "session-question",
  "opencode-watchdog-record",
  "watchdog-record",
  "opencode-force-report",
  "force-report",
  "session-force-report",
  "opencode-ask-commander",
  "ask-commander",
  "commander-question",
  "commander-guidance",
  "answer-commander-question",
  "answer-question",
  "commander-guidance-deliver",
  "deliver-guidance",
  "send-guidance",
  "opencode-human-control",
  "opencode-human-pause",
  "human-pause",
  "opencode-human-resume",
  "human-resume",
  "opencode-human-stop",
  "human-stop",
  "opencode-human-correction",
  "human-correction",
  "opencode-human-override",
  "human-override",
  "opencode-human-force-report",
  "human-force-report",
  "opencode-human-note",
  "human-note",
  "opencode-wake-execution-record",
  "wake-execution-record",
  "opencode-wake-batch-record",
  "wake-batch-record",
  "opencode-wake-action-record",
  "wake-action-record",
  "opencode-result-report",
  "result-report",
  "opencode-result-review",
  "result-review",
  "research-ingestion",
  "research-ingest",
  "research-promote",
  "research-memory-ingest",
])

const EXECUTION_COMMAND_FIELD = "__nxl_operator_execution_command"

export function stageSuggestedCommand(context: CommanderTargetContextSummary | null | undefined, indexText: string | undefined): OperatorStagedCommand {
  if (!context) throw new Error("selected target context is required")
  const index = Number(indexText)
  if (!Number.isInteger(index) || index < 1) throw new Error("suggested command index must be a positive integer")
  const suggestion = context.suggested_commands[index - 1]
  if (!suggestion) throw new Error(`suggested command index is out of range: ${redactText(String(indexText ?? ""))}`)
  return stagedFromSuggestion(suggestion, context)
}

export function stageExplicitCommand(commandText: string): OperatorStagedCommand {
  const executionCommand = normalizeCommandText(commandText, { redact: false })
  const command = redactText(executionCommand)
  return withExecutionCommand({
    label: "Explicit command",
    command,
    command_type: commandTypeFromSlash(executionCommand),
    requires_review: undefined,
    requires_active_runtime: undefined,
  }, executionCommand)
}

export function normalizeCommandText(commandText: string, options: { redact?: boolean } = {}): string {
  const cleaned = commandText.trim()
  if (!cleaned) throw new Error("command is required")
  const normalized = cleaned.startsWith("/") ? cleaned : `/${cleaned}`
  return options.redact === false ? normalized : redactText(normalized)
}

export function commandTypeFromSlash(commandText: string): "read" | "write" {
  const command = /^\/?([a-z][a-z-]*)/i.exec(commandText.trim())?.[1]?.toLowerCase()
  return command && WRITE_COMMANDS.has(command) ? "write" : "read"
}

export function withExecutionCommand<T extends { command: string }>(value: T, executionCommand: string): T {
  Object.defineProperty(value, EXECUTION_COMMAND_FIELD, {
    value: executionCommand,
    enumerable: false,
    configurable: true,
    writable: false,
  })
  return value
}

export function executionCommandFor(value: { command: string }): string {
  const executionCommand = (value as { [EXECUTION_COMMAND_FIELD]?: unknown })[EXECUTION_COMMAND_FIELD]
  return typeof executionCommand === "string" ? executionCommand : value.command
}

export function copyExecutionCommand<T extends { command: string }>(source: { command: string }, target: T): T {
  return withExecutionCommand(target, executionCommandFor(source))
}

function stagedFromSuggestion(suggestion: CommanderSuggestedCommandSummary, context: CommanderTargetContextSummary): OperatorStagedCommand {
  const executionCommand = normalizeCommandText(executionCommandFor(suggestion), { redact: false })
  return withExecutionCommand({
    source_target_type: redactText(context.target_type),
    source_target_id: redactText(context.target_id),
    label: redactText(suggestion.label),
    command: normalizeCommandText(suggestion.command),
    command_type: suggestion.command_type,
    requires_review: suggestion.requires_review || undefined,
    requires_active_runtime: suggestion.requires_active_runtime || undefined,
  }, executionCommand)
}
