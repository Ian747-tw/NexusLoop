import { basename, resolve } from "path"
import { applyKeyCommand, type KeyCommand } from "./keyboard"
import { reduceRuntimeEvent } from "./reducer"
import { initialState } from "./state"
import { FakeRuntimeClient } from "./runtime"
import { layoutSnapshot } from "./snapshot"

const projectDir = resolve(process.env.NXL_PROJECT_DIR ?? process.cwd())
const runtime = new FakeRuntimeClient(projectDir, basename(projectDir))

async function buildHeadlessSnapshot() {
  let state = initialState(projectDir)
  for await (const event of runtime.stream()) {
    state = reduceRuntimeEvent(state, event)
  }

  const commands = process.env.NXL_TUI_KEYS ? (JSON.parse(process.env.NXL_TUI_KEYS) as KeyCommand[]) : []
  for (const command of commands) {
    state = applyKeyCommand(state, command)
    if (command.type === "submit" && state.submittedMessages.length > 0) {
      await runtime.sendUserMessage(state.submittedMessages.at(-1)!)
    }
    if (command.type === "submit" && state.lastCommand) {
      await runtime.sendCommand(state.lastCommand)
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
