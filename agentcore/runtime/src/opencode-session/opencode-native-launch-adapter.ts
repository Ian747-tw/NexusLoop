import { spawn as nodeSpawn } from "node:child_process"
import { basename, join } from "node:path"
import type { OpenCodeSpawnedProcess } from "../opencode/process-adapter"
import { redactText } from "../security/redaction"
import type {
  OpenCodeLaunchAdapter,
  OpenCodeLaunchAdapterLaunchInput,
  OpenCodeLaunchAdapterPreview,
  OpenCodeLaunchAdapterPreviewInput,
  OpenCodeLaunchAdapterResult,
  ProcessOpenCodeLaunchAdapterOptions,
} from "./opencode-launch-adapter"

export class ProcessOpenCodeLaunchAdapter implements OpenCodeLaunchAdapter {
  readonly kind = "process_adapter" as const
  private readonly command: string
  private readonly args: string[]
  private readonly cwd?: string
  private readonly env?: Record<string, string>
  private readonly spawn: NonNullable<ProcessOpenCodeLaunchAdapterOptions["spawn"]>
  private readonly spawnTimeoutMs: number

  constructor(options: ProcessOpenCodeLaunchAdapterOptions) {
    if (!options.command.trim()) throw new Error("OpenCode launch command is required")
    this.command = options.command
    this.args = options.args ?? []
    this.cwd = options.cwd
    this.env = options.env
    this.spawn = options.spawn ?? defaultSpawn
    this.spawnTimeoutMs = options.spawnTimeoutMs ?? 2_000
  }

  preview(input: OpenCodeLaunchAdapterPreviewInput): OpenCodeLaunchAdapterPreview {
    return {
      adapter_kind: this.kind,
      command_preview: this.commandPreview(input),
      env_preview: this.env ? "bounded adapter env configured; values redacted" : "inherits process env",
      blockers: [],
      warnings: ["real launch will start one external process only after explicit opt-in and readiness gates pass"],
    }
  }

  async launch(input: OpenCodeLaunchAdapterLaunchInput): Promise<OpenCodeLaunchAdapterResult> {
    try {
      const child = this.spawn(this.command, this.commandArgs(input), { cwd: this.cwd ?? input.project_dir, env: this.env })
      await waitForSpawn(child, this.spawnTimeoutMs)
      return {
        status: "launch_started",
        process_id: child.pid,
        native_session_id: input.launch_id,
        output_summary_preview: `OpenCode launch process started: ${basename(this.command) || this.command}`,
        event_count: 0,
      }
    } catch (error) {
      return {
        status: "launch_failed",
        error: redactText(error instanceof Error ? error.message : String(error)),
      }
    }
  }

  private commandPreview(input: OpenCodeLaunchAdapterPreviewInput): string {
    return redactText([basename(this.command) || this.command, ...this.commandArgs(input)].join(" "))
  }

  private commandArgs(input: OpenCodeLaunchAdapterPreviewInput): string[] {
    return [
      ...this.args,
      ...input.instruction_files.flatMap((file) => ["--file", input.target_dir ? join(input.target_dir, file) : file]),
    ]
  }
}

function defaultSpawn(command: string, args: string[], options: { cwd: string; env?: Record<string, string> }): OpenCodeSpawnedProcess {
  return nodeSpawn(command, args, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdio: ["ignore", "ignore", "ignore"],
    detached: true,
  }) as unknown as OpenCodeSpawnedProcess
}

async function waitForSpawn(child: OpenCodeSpawnedProcess, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const evented = child as OpenCodeSpawnedProcess & {
      once?: OpenCodeSpawnedProcess["on"]
      off?: OpenCodeSpawnedProcess["on"]
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error("OpenCode launch spawn timed out"))
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      evented.off?.("spawn", onSpawn)
      evented.off?.("error", onError)
      evented.off?.("exit", onExit)
    }
    const onSpawn = () => {
      cleanup()
      ;(child as { unref?: () => void }).unref?.()
      resolve()
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup()
      reject(new Error(`OpenCode launch exited before spawn completed: code=${String(code)} signal=${String(signal)}`))
    }
    const subscribe = (evented.once ?? evented.on) as (event: string, listener: (...args: never[]) => void) => unknown
    subscribe.call(child, "spawn", onSpawn)
    subscribe.call(child, "error", onError)
    subscribe.call(child, "exit", onExit)
  })
}
