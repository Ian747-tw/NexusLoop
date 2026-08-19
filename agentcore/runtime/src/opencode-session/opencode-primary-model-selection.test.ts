import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { ProcessOpenCodeLaunchAdapter } from "./opencode-native-launch-adapter"

class Spawned extends EventEmitter {
  pid = 4242
  stdout = null
  stderr = null
  kill() { return true }
  unref() {}
}

const selection = {
  selection_version: 1 as const,
  role: "executor" as const,
  provider_id: "anthropic",
  model_id: "claude-sonnet-4-5-20250929",
  selection_projection_hash: "a".repeat(64),
}

describe("9W4B1 scoped Executor primary-model launch", () => {
  test("passes exact registry selection through only the primary OpenCode --model argument", async () => {
    const calls: string[][] = []
    const adapter = new ProcessOpenCodeLaunchAdapter({
      command: "/bin/echo",
      args: ["--format", "json"],
      spawn: (_command, args) => {
        calls.push(args)
        const child = new Spawned()
        queueMicrotask(() => child.emit("spawn"))
        return child
      },
    })
    const input = {
      project_dir: "/tmp/project",
      instruction_files: ["TASK.md"],
      primary_model_selection: selection,
    }
    expect(adapter.preview(input)).toMatchObject({ blockers: [] })
    await expect(adapter.launch({ ...input, launch_id: "launch", session_id: "session" })).resolves.toMatchObject({ status: "launch_started" })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain("--model")
    expect(calls[0]).toContain("anthropic/claude-sonnet-4-5-20250929")
    expect(calls[0].filter((item) => item === "--model" || item === "-m")).toHaveLength(1)
    expect(calls[0].join(" ")).not.toMatch(/small_model|title|summary|compaction|agent|subagent/)
  })

  test("blocks every conflicting preconfigured primary-model argument", () => {
    for (const args of [["--model", "openai/gpt-5"], ["--model=openai/gpt-5"], ["-m", "openai/gpt-5"], ["-mopenai/gpt-5"]]) {
      const adapter = new ProcessOpenCodeLaunchAdapter({ command: "/bin/echo", args })
      expect(adapter.preview({ project_dir: "/tmp/project", instruction_files: [], primary_model_selection: selection })).toMatchObject({
        blockers: ["preconfigured OpenCode primary model conflicts with runtime model-profile authority"],
      })
    }
  })

  test("preserves legacy launch arguments when no Executor role selection is active", () => {
    const adapter = new ProcessOpenCodeLaunchAdapter({ command: "/bin/echo", args: ["--model", "legacy/model"] })
    expect(adapter.preview({ project_dir: "/tmp/project", instruction_files: [] }).blockers).toEqual([])
  })
})
