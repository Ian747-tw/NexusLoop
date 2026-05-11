import { spawn as nodeSpawn } from "node:child_process"
import { basename } from "node:path"
import type { RuntimeEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { MissionPacket, MissionUpdate, OpenCodeRuntimeAdapter, SessionSpec } from "./adapter"

export interface OpenCodeProcessEventSource {
  on(event: "data", listener: (data: unknown) => void): unknown
}

export interface OpenCodeSpawnedProcess {
  pid?: number
  stdin?: {
    write?(data: string): unknown
    end?(): unknown
  }
  stdout?: OpenCodeProcessEventSource | null
  stderr?: OpenCodeProcessEventSource | null
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  on(event: "error", listener: (error: Error) => void): unknown
  kill?(signal?: NodeJS.Signals): unknown
  terminate?(signal?: NodeJS.Signals): unknown
}

export interface OpenCodeSpawnOptions {
  cwd: string
  env?: Record<string, string>
}

export type OpenCodeSpawn = (command: string, args: string[], options: OpenCodeSpawnOptions) => OpenCodeSpawnedProcess

export interface ProcessOpenCodeAdapterOptions {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  spawn?: OpenCodeSpawn
}

type ProcessAdapterPhase = "new" | "running" | "failed" | "exited" | "shutdown"

export class ProcessOpenCodeAdapter implements OpenCodeRuntimeAdapter {
  private readonly command: string
  private readonly args: string[]
  private readonly cwd?: string
  private readonly env?: Record<string, string>
  private readonly spawn: OpenCodeSpawn
  private readonly events: RuntimeEvent[] = []
  private readonly commandLabel: string
  private streamCursor = 0
  private phase: ProcessAdapterPhase = "new"
  private process: OpenCodeSpawnedProcess | null = null
  private shutdownRequested = false
  private lastError: string | null = null

  constructor(options: ProcessOpenCodeAdapterOptions) {
    if (!options.command.trim()) throw new Error("OpenCode process command is required")
    this.command = options.command
    this.args = options.args ?? []
    this.cwd = options.cwd
    this.env = options.env
    this.spawn = options.spawn ?? defaultOpenCodeSpawn
    this.commandLabel = basename(options.command) || options.command
  }

  async startSession(sessionSpec: SessionSpec): Promise<void> {
    if (this.process) throw new Error("OpenCode process session already started")
    this.shutdownRequested = false
    this.lastError = null
    const cwd = this.cwd ?? sessionSpec.projectDir

    try {
      const child = this.spawn(this.command, this.args, { cwd, env: this.env })
      this.process = child
      this.phase = "running"
      this.attachProcessListeners(child)
      this.queue("process-started", `OpenCode process started: ${this.commandLabel}${child.pid === undefined ? "" : ` pid ${child.pid}`}`)
    } catch (error) {
      this.phase = "failed"
      this.process = null
      this.lastError = redactText(`OpenCode process spawn failed: ${errorMessage(error)}`)
      this.queue("process-spawn-failed", this.lastError)
      throw new Error(this.lastError)
    }
  }

  async sendMissionPacket(_packet: MissionPacket): Promise<void> {
    throw new Error("real mission packet transport not implemented")
  }

  async pauseAtSafeBoundary(_reason: string): Promise<void> {
    throw new Error("real pause transport not implemented")
  }

  async resumeWithMissionUpdate(_update: MissionUpdate): Promise<void> {
    throw new Error("real resume transport not implemented")
  }

  async *streamExecutorEvents(): AsyncIterable<RuntimeEvent> {
    while (this.streamCursor < this.events.length) {
      yield this.events[this.streamCursor]
      this.streamCursor += 1
    }
  }

  async shutdown(): Promise<void> {
    this.shutdownRequested = true
    this.phase = "shutdown"
    const child = this.process
    if (!child) return
    this.process = null
    try {
      child.stdin?.end?.()
    } catch (error) {
      this.lastError = redactText(`OpenCode stdin close failed: ${errorMessage(error)}`)
      this.queue("process-stdin-close-failed", this.lastError)
    }
    try {
      if (child.kill) child.kill("SIGTERM")
      else child.terminate?.("SIGTERM")
    } catch (error) {
      this.lastError = redactText(`OpenCode process termination failed: ${errorMessage(error)}`)
      this.queue("process-termination-failed", this.lastError)
    }
  }

  async getStatus(): Promise<Record<string, unknown>> {
    return redactValue({
      adapter: "process",
      phase: this.phase,
      pid: this.process?.pid,
      command: this.commandLabel,
      message: `ProcessOpenCodeAdapter ${this.phase}`,
      lastError: this.lastError ?? undefined,
    })
  }

  private attachProcessListeners(child: OpenCodeSpawnedProcess): void {
    child.stdout?.on("data", (data) => this.queue("process-stdout", dataToText(data)))
    child.stderr?.on("data", (data) => this.queue("process-stderr", dataToText(data)))
    child.on("error", (error) => {
      this.phase = "failed"
      this.lastError = redactText(`OpenCode process error: ${errorMessage(error)}`)
      this.queue("process-error", this.lastError)
    })
    child.on("exit", (code, signal) => {
      if (this.process === child) this.process = null
      if (this.shutdownRequested) {
        this.phase = "shutdown"
        this.queue("process-exited", exitMessage("OpenCode process exited", code, signal))
        return
      }
      this.phase = "exited"
      this.lastError = exitMessage("OpenCode process exited unexpectedly", code, signal)
      this.queue("process-exited", this.lastError)
    })
  }

  private queue(phase: string, message: string): void {
    this.events.push({ type: "ExecutorLifecycle", phase, message: redactText(message) })
  }
}

function defaultOpenCodeSpawn(command: string, args: string[], options: OpenCodeSpawnOptions): OpenCodeSpawnedProcess {
  return nodeSpawn(command, args, {
    cwd: options.cwd,
    env: options.env === undefined ? process.env : { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
  })
}

function dataToText(data: unknown): string {
  if (typeof data === "string") return data
  if (data instanceof Uint8Array) return new TextDecoder().decode(data)
  return String(data)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function exitMessage(prefix: string, code: number | null, signal: NodeJS.Signals | null): string {
  const status = code === null ? "without exit code" : `with code ${code}`
  return signal === null ? `${prefix} ${status}` : `${prefix} ${status} signal ${signal}`
}
