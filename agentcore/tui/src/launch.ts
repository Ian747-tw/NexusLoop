import { applyKeyCommandWithEffects, type KeyCommand } from "./keyboard"
import { reduceRuntimeEvent } from "./reducer"
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
  const iterator = runtime.stream()[Symbol.asyncIterator]()
  try {
    while (true) {
      const next = await Promise.race([
        iterator.next(),
        new Promise<"idle">((resolve) => setTimeout(() => resolve("idle"), HEADLESS_STREAM_IDLE_TIMEOUT_MS)),
      ])
      if (next === "idle" || next.done) break
      state = reduceRuntimeEvent(state, next.value)
    }
  } finally {
    await iterator.return?.()
  }

  const commands = env.NXL_TUI_KEYS ? (JSON.parse(env.NXL_TUI_KEYS) as KeyCommand[]) : []
  for (const command of commands) {
    const result = applyKeyCommandWithEffects(state, command)
    state = result.state
    for (const effect of result.effects) {
      if (effect.type === "send-user-message") await runtime.sendUserMessage(effect.message)
      if (effect.type === "send-command") await runtime.sendCommand(effect.command)
    }
  }

  return layoutSnapshot(state)
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
