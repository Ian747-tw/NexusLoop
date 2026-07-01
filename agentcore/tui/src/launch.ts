import { applyKeyCommandWithEffects, type KeyCommand } from "./keyboard"
import { reduceRuntimeEvent } from "./reducer"
import { applyRuntimeUiEffect, refreshRuntimeRecords } from "./runtime-effects"
import { type RuntimeClient } from "./runtime"
import { createTuiRuntimeClient } from "./runtime-client-factory"
import { layoutSnapshot } from "./snapshot"
import { initialState } from "./state"

export const HEADLESS_STREAM_IDLE_TIMEOUT_MS = 50

export interface TuiLaunchOptions {
  projectDir: string
  env: Record<string, string | undefined>
  runtime?: RuntimeClient
  runOpenTui?: (runtime: RuntimeClient, projectDir: string) => Promise<void>
  writeOutput?: (output: string) => void
}

async function defaultRunOpenTui(runtime: RuntimeClient, projectDir: string): Promise<void> {
  const { runOpenTui } = await import("./app")
  await runOpenTui(runtime, projectDir)
}

export async function buildHeadlessSnapshot(runtime: RuntimeClient, projectDir: string, env: Record<string, string | undefined>): Promise<string> {
  let state = initialState(projectDir)
  const commands = env.NXL_TUI_KEYS ? (JSON.parse(env.NXL_TUI_KEYS) as KeyCommand[]) : []
  const noStartInspectionScript = isNoStartInspectionScript(commands)
  const needsExplicitRuntimeResume = noStartInspectionScript && hasExplicitRuntimeResumeCommand(commands)
  const iterator = runtime.stream()[Symbol.asyncIterator]()
  let sawEvent = false
  let idleTimedOut = false
  const useIdleBreak = runtime.streamMode === "long-lived"
  try {
    while (true) {
      const next = useIdleBreak && sawEvent
        ? await Promise.race([
            iterator.next(),
            new Promise<"idle">((resolve) => setTimeout(() => resolve("idle"), HEADLESS_STREAM_IDLE_TIMEOUT_MS)),
          ])
        : await iterator.next()
      if (next === "idle") {
        idleTimedOut = true
        break
      }
      if (next.done) break
      sawEvent = true
      state = reduceRuntimeEvent(state, next.value)
    }
  } finally {
    const close = iterator.return?.()
    if (idleTimedOut) void close?.catch(() => {})
    else await close
  }

  if (noStartInspectionScript && !needsExplicitRuntimeResume && state.screen === "resume") {
    state = { ...state, screen: "main", focus: "message-box" }
  }

  if (!noStartInspectionScript) {
    state = await refreshRuntimeRecords(state, runtime)
  }

  for (const command of commands) {
    const result = applyKeyCommandWithEffects(state, command)
    state = result.state
    for (const effect of result.effects) {
      state = await applyRuntimeUiEffect(state, runtime, effect)
    }
  }

  return layoutSnapshot(state)
}

function isNoStartInspectionScript(commands: KeyCommand[]): boolean {
  const inserts = commands.filter((command): command is Extract<KeyCommand, { type: "insert" }> => command.type === "insert")
  if (inserts.length === 0) return false
  return inserts.every((command) => isNoStartInspectionText(command.text))
}

function hasExplicitRuntimeResumeCommand(commands: KeyCommand[]): boolean {
  return commands.some((command) => command.type === "insert" && isExplicitRuntimeResumeText(command.text))
}

function isExplicitRuntimeResumeText(text: string): boolean {
  const command = text.trim().split(/\s+/, 1)[0]
  return command === "/opencode-session-plan"
    || command === "/session-plan"
    || command === "/opencode-plan"
}

function isNoStartInspectionText(text: string): boolean {
  const trimmed = text.trim()
  return (
	    trimmed.startsWith("/opencode-smoke")
	    || trimmed.startsWith("/opencode-process-smoke")
	    || trimmed.startsWith("/opencode-health-smoke")
	    || trimmed.startsWith("/handoff-readiness")
	    || trimmed.startsWith("/opencode-handoff-readiness")
	    || trimmed.startsWith("/handoff-ready")
	    || trimmed.startsWith("/result-review-packet")
	    || trimmed.startsWith("/result-review-summary")
	    || trimmed.startsWith("/opencode-result-review")
	    || trimmed.startsWith("/executor-result-review")
	    || trimmed.startsWith("/handoff-result-review")
	    || trimmed.startsWith("/executor-review-preview")
	    || trimmed.startsWith("/executor-review")
	    || trimmed.startsWith("/executor-review-dry-run")
	    || trimmed.startsWith("/executor-reviews")
	    || trimmed.startsWith("/executor-review-show")
	    || trimmed.startsWith("/commander-executor-review-preview")
	    || trimmed.startsWith("/commander-executor-review")
	    || trimmed.startsWith("/commander-executor-reviews")
	    || trimmed.startsWith("/executor-review-draft-preview")
	    || trimmed.startsWith("/executor-review-draft-summary")
	    || trimmed.startsWith("/executor-review-drafts")
	    || trimmed.startsWith("/commander-executor-draft-preview")
	    || trimmed.startsWith("/commander-executor-drafts")
	    || trimmed.startsWith("/executor-review-proposal-create-preview")
	    || trimmed.startsWith("/executor-review-proposal-create")
	    || trimmed.startsWith("/executor-review-proposal-create-dry-run")
	    || trimmed.startsWith("/executor-review-proposal-creates")
	    || trimmed.startsWith("/executor-review-proposal-create-show")
	    || trimmed.startsWith("/executor-draft-create-preview")
	    || trimmed.startsWith("/executor-draft-create")
	    || trimmed.startsWith("/commander-executor-proposal-create")
	    || trimmed.startsWith("/executor-review-proposal-review-preview")
	    || trimmed.startsWith("/executor-review-proposal-review-request")
	    || trimmed.startsWith("/executor-review-proposal-review-dry-run")
	    || trimmed.startsWith("/executor-review-proposal-review-requests")
	    || trimmed.startsWith("/executor-review-proposal-review-show")
	    || trimmed.startsWith("/executor-draft-review-preview")
	    || trimmed.startsWith("/executor-draft-review-request")
	    || trimmed.startsWith("/commander-executor-proposal-review-request")
	    || trimmed.startsWith("/executor-review-proposal-review-decision-preview")
	    || trimmed.startsWith("/executor-review-proposal-review-approve")
	    || trimmed.startsWith("/executor-review-proposal-review-reject")
	    || trimmed.startsWith("/executor-review-proposal-review-decision-dry-run")
	    || trimmed.startsWith("/executor-review-proposal-review-decisions")
	    || trimmed.startsWith("/executor-review-proposal-review-decision-show")
	    || trimmed.startsWith("/executor-draft-review-approve")
	    || trimmed.startsWith("/executor-draft-review-reject")
	    || trimmed.startsWith("/commander-executor-proposal-review-approve")
	    || trimmed.startsWith("/commander-executor-proposal-review-reject")
	    || trimmed.startsWith("/executor-review-proposal-apply-readiness")
	    || trimmed.startsWith("/executor-draft-apply-readiness")
	    || trimmed.startsWith("/commander-executor-proposal-apply-readiness")
	    || trimmed.startsWith("/proposal-apply-readiness")
	    || trimmed.startsWith("/executor-review-proposal-narrow-apply")
	    || trimmed.startsWith("/executor-draft-narrow-apply")
	    || trimmed.startsWith("/commander-executor-proposal-narrow-apply")
	    || trimmed.startsWith("/proposal-narrow-apply")
	    || trimmed.startsWith("/minimax-live-preview")
	    || trimmed.startsWith("/minimax-live-validate")
	    || trimmed.startsWith("/minimax-live-dry-run")
	    || trimmed.startsWith("/minimax-live-validations")
	    || trimmed.startsWith("/minimax-live-show")
    || trimmed.startsWith("/reasoning-live-preview")
    || trimmed.startsWith("/reasoning-live-validate")
    || trimmed.startsWith("/minimax-provider-validate")
    || trimmed.startsWith("/opencode-session-preview")
    || trimmed.startsWith("/session-preview")
    || trimmed.startsWith("/opencode-session-plan")
    || trimmed.startsWith("/session-plan")
    || trimmed.startsWith("/opencode-plan")
    || trimmed.startsWith("/opencode-session-plan-dry-run")
    || trimmed.startsWith("/opencode-sessions")
    || trimmed.startsWith("/sessions")
    || trimmed.startsWith("/opencode-session-show")
    || trimmed.startsWith("/opencode-session-summary")
    || trimmed.startsWith("/model-capabilities")
    || trimmed.startsWith("/models")
    || trimmed.startsWith("/model-capability")
    || trimmed.startsWith("/context-budget-summary")
    || trimmed.startsWith("/model-budget")
    || trimmed.startsWith("/context-budget")
    || trimmed.startsWith("/context-budget-preview")
    || trimmed.startsWith("/budget-preview")
    || trimmed.startsWith("/context-packet-preview")
    || trimmed.startsWith("/packet-preview")
    || trimmed.startsWith("/compile-context-preview")
    || trimmed.startsWith("/context-compile-preview")
    || trimmed.startsWith("/context-packet-summary")
    || trimmed.startsWith("/context-packets")
    || trimmed.startsWith("/opencode-session-instruction-pack-preview")
    || trimmed.startsWith("/session-instruction-pack-preview")
    || trimmed.startsWith("/opencode-context-pack-preview")
	    || trimmed.startsWith("/opencode-session-instruction-pack-dry-run")
	    || trimmed.startsWith("/session-instruction-pack-dry-run")
	    || trimmed.startsWith("/opencode-session-instruction-pack-write")
	    || trimmed.startsWith("/session-instruction-pack-write")
	    || trimmed.startsWith("/opencode-context-pack-write")
	    || trimmed.startsWith("/opencode-session-instruction-packs")
    || trimmed.startsWith("/opencode-session-instruction-pack-show")
    || trimmed.startsWith("/opencode-launch-readiness")
    || trimmed.startsWith("/launch-readiness")
    || trimmed.startsWith("/opencode-session-launch-readiness")
    || trimmed.startsWith("/session-launch-readiness")
    || trimmed.startsWith("/launch-ready")
    || trimmed.startsWith("/opencode-launch-readiness-summary")
    || trimmed.startsWith("/opencode-launch-preview")
    || trimmed.startsWith("/launch-opencode-preview")
    || trimmed.startsWith("/opencode-launch-dry-run")
    || trimmed.startsWith("/launch-opencode-dry-run")
    || trimmed.startsWith("/opencode-launch")
    || trimmed.startsWith("/launch-opencode")
    || trimmed.startsWith("/session-launch")
    || trimmed.startsWith("/opencode-session-launch")
    || trimmed.startsWith("/opencode-launches")
    || trimmed.startsWith("/opencode-launch-show")
    || trimmed.startsWith("/opencode-progress-preview")
    || trimmed.startsWith("/opencode-heartbeat")
    || trimmed.startsWith("/session-heartbeat")
    || trimmed.startsWith("/opencode-progress")
    || trimmed.startsWith("/session-progress")
    || trimmed.startsWith("/opencode-blocker")
    || trimmed.startsWith("/session-blocker")
    || trimmed.startsWith("/opencode-question")
    || trimmed.startsWith("/session-question")
    || trimmed.startsWith("/opencode-progress-dry-run")
    || trimmed.startsWith("/opencode-progress-list")
    || trimmed.startsWith("/progress-list")
    || trimmed.startsWith("/opencode-progress-latest")
    || trimmed.startsWith("/progress-latest")
    || trimmed.startsWith("/opencode-progress-show")
    || trimmed.startsWith("/opencode-progress-summary")
    || trimmed.startsWith("/research-memory-summary")
    || trimmed.startsWith("/research-memory-search")
    || trimmed.startsWith("/research-memory-preview")
    || trimmed.startsWith("/research-search")
    || trimmed.startsWith("/memory-search")
    || trimmed.startsWith("/research-novelty-preview")
    || trimmed.startsWith("/novelty-preview")
    || trimmed.startsWith("/research-dup-check")
    || trimmed.startsWith("/authority")
    || trimmed.startsWith("/command-authority")
    || trimmed.startsWith("/command-map")
  )
}

export async function runTuiEntrypoint(options: TuiLaunchOptions): Promise<void> {
  const runtime = options.runtime ?? createTuiRuntimeClient({ projectDir: options.projectDir, env: options.env })
  try {
    if (options.env.NXL_TUI_HEADLESS === "1") {
      const snapshot = await buildHeadlessSnapshot(runtime, options.projectDir, options.env)
      ;(options.writeOutput ?? console.log)(snapshot)
      return
    }

    await (options.runOpenTui ?? defaultRunOpenTui)(runtime, options.projectDir)
  } finally {
    await runtime.shutdown?.()
  }
}
