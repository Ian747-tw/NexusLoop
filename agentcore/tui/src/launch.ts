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

  if (noStartInspectionScript && state.screen === "resume") {
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
	    || trimmed.startsWith("/executor-review-dry-run")
	    || trimmed.startsWith("/executor-reviews")
	    || trimmed.startsWith("/executor-review-show")
	    || trimmed.startsWith("/commander-executor-review-preview")
	    || trimmed.startsWith("/commander-executor-reviews")
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
