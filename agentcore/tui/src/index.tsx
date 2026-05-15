import { resolve } from "path"
import { applyKeyCommandWithEffects, type KeyCommand } from "./keyboard"
import { reduceRuntimeEvent } from "./reducer"
import { initialState } from "./state"
import { createTuiRuntimeClient } from "./runtime-client-factory"
import { layoutSnapshot } from "./snapshot"

const projectDir = resolve(process.env.NXL_PROJECT_DIR ?? process.cwd())
const runtime = createTuiRuntimeClient({ projectDir, env: process.env })
const HEADLESS_STREAM_IDLE_TIMEOUT_MS = 50

async function buildHeadlessSnapshot() {
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

  const commands = process.env.NXL_TUI_KEYS ? (JSON.parse(process.env.NXL_TUI_KEYS) as KeyCommand[]) : []
  for (const command of commands) {
    const result = applyKeyCommandWithEffects(state, command)
    state = result.state
    for (const effect of result.effects) {
      if (effect.type === "send-user-message") await runtime.sendUserMessage(effect.message)
      if (effect.type === "send-command") await runtime.sendCommand(effect.command)
    }
  }

  console.log(layoutSnapshot(state))
}

if (process.env.NXL_TUI_HEADLESS === "1") {
  await buildHeadlessSnapshot()
} else {
  const { runOpenTui } = await import("./app")
  await runOpenTui(runtime, projectDir)
}
