import { existsSync } from "fs"
import { join } from "path"
import type { RuntimeEvent } from "./events"

export interface RuntimeClient {
  stream(): AsyncIterable<RuntimeEvent>
  sendUserMessage(message: string): Promise<void>
  sendCommand(command: string): Promise<void>
  shutdown?(): Promise<void>
}

export class FakeRuntimeClient implements RuntimeClient {
  readonly sentMessages: string[] = []
  readonly sentCommands: string[] = []

  constructor(
    private readonly projectDir: string,
    private readonly projectName: string,
  ) {}

  async *stream(): AsyncIterable<RuntimeEvent> {
    yield {
      type: "RuntimeReady",
      projectName: this.projectName,
      runtimeStatus: "fake runtime connected",
      providerLabel: "placeholder only",
      modelLabel: "not configured",
    }

    if (!existsSync(join(this.projectDir, ".nxl"))) {
      yield { type: "ProjectUninitialized", projectDir: this.projectDir }
      return
    }

    yield { type: "ProjectInitialized", projectDir: this.projectDir }
    yield { type: "ResumeSummaryLoaded", lastRunId: "fake-last-run", activeMissionId: "mission-placeholder", recordsCount: 0 }
    if (process.env.NXL_TUI_FAKE_FULL_STREAM !== "1") return
    yield {
      type: "MissionStarted",
      missionId: "mission-placeholder",
      workIntent: "Awaiting user message",
      budget: "placeholder budget",
      programState: "ready",
    }
    yield { type: "WakeHookFired", hook: "resume-screen-opened" }
    yield { type: "ExecutorToolStarted", tool: "runtime.connect", target: "fake runtime stream" }
    yield { type: "ExecutorToolCompleted", tool: "runtime.connect", status: "completed", output: "connection skeleton active" }
    yield {
      type: "CommanderDecisionRecorded",
      decision: "standby",
      reason: "Commander intelligence is intentionally not implemented in this branch",
    }
  }

  async sendUserMessage(message: string): Promise<void> {
    this.sentMessages.push(message)
    const python = process.env.NXL_PYTHON_EXECUTABLE ?? "python"
    const result = Bun.spawnSync({
      cmd: [
        python,
        "-m",
        "nxl_core.spec.tui_onboarding",
        "--project-dir",
        this.projectDir,
        "--message",
        message,
      ],
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    })
    if (result.exitCode !== 0) {
      const stderr = new TextDecoder().decode(result.stderr).trim()
      throw new Error(`spec onboarding failed: ${stderr}`)
    }
  }

  async sendCommand(command: string): Promise<void> {
    this.sentCommands.push(command)
  }
}
