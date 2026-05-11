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
  on(event: "spawn", listener: () => void): unknown
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
  spawnTimeoutMs?: number
  shutdownTimeoutMs?: number
}

type ProcessAdapterPhase = "new" | "running" | "failed" | "exited" | "shutdown"

export class ProcessOpenCodeAdapter implements OpenCodeRuntimeAdapter {
  private readonly command: string
  private readonly args: string[]
  private readonly cwd?: string
  private readonly env?: Record<string, string>
  private readonly spawn: OpenCodeSpawn
  private readonly spawnTimeoutMs: number
  private readonly shutdownTimeoutMs: number
  private readonly events: RuntimeEvent[] = []
  private readonly commandLabel: string
  private streamCursor = 0
  private phase: ProcessAdapterPhase = "new"
  private process: OpenCodeSpawnedProcess | null = null
  private readonly expectedExitProcesses = new WeakSet<object>()
  private readonly terminalProcesses = new WeakMap<object, string>()
  private readonly exitWaiters = new WeakMap<object, Set<() => void>>()
  private readonly terminatingProcesses = new Set<OpenCodeSpawnedProcess>()
  private readonly streamWaiters = new Set<() => void>()
  private streamClosed = true
  private shutdownRequested = false
  private lastError: string | null = null

  constructor(options: ProcessOpenCodeAdapterOptions) {
    if (!options.command.trim()) throw new Error("OpenCode process command is required")
    this.command = options.command
    this.args = options.args ?? []
    this.cwd = options.cwd
    this.env = options.env
    this.spawn = options.spawn ?? defaultOpenCodeSpawn
    this.spawnTimeoutMs = options.spawnTimeoutMs ?? 1000
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5000
    this.commandLabel = basename(options.command) || options.command
  }

  async startSession(sessionSpec: SessionSpec): Promise<void> {
    const previousProcess = this.process
    let child: OpenCodeSpawnedProcess | null = null
    if (previousProcess) this.terminateProcess(previousProcess, "process-restart-requested", { clearCurrent: false })
    this.shutdownRequested = false
    this.lastError = null
    this.streamClosed = false
    const cwd = this.cwd ?? sessionSpec.projectDir

    try {
      child = this.spawn(this.command, this.args, { cwd, env: this.env })
      this.process = child
      this.attachProcessListeners(child)
      await this.waitForProcessSpawn(child, this.spawnTimeoutMs)
      const terminalError = this.terminalProcesses.get(child)
      if (terminalError) throw new Error(terminalError)
      this.phase = "running"
      this.queue("process-started", `OpenCode process started: ${this.commandLabel}${child.pid === undefined ? "" : ` pid ${child.pid}`}`)
    } catch (error) {
      this.phase = "failed"
      const restoredPrevious = previousProcess && !this.terminalProcesses.has(previousProcess) ? previousProcess : null
      if (this.process === child) this.process = restoredPrevious
      this.lastError = redactText(`OpenCode process spawn failed: ${errorMessage(error)}`)
      this.queue("process-spawn-failed", this.lastError)
      if (!this.process) this.closeStream()
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
    while (true) {
      while (this.streamCursor < this.events.length) {
        const event = this.events[this.streamCursor]
        this.streamCursor += 1
        this.compactDrainedEvents()
        yield event
      }
      if (this.streamClosed) break
      await new Promise<void>((resolve) => {
        const waiter = () => {
          this.streamWaiters.delete(waiter)
          resolve()
        }
        this.streamWaiters.add(waiter)
      })
    }
  }

  async shutdown(): Promise<void> {
    this.shutdownRequested = true
    this.phase = "shutdown"
    const children = new Set(this.terminatingProcesses)
    if (this.process) children.add(this.process)
    if (children.size === 0) {
      this.closeStream()
      return
    }
    const exits = [...children].map((child) => this.waitForProcessExit(child, this.shutdownTimeoutMs))
    for (const child of children) this.terminateProcess(child, "process-shutdown-requested", { clearCurrent: false })
    try {
      await Promise.all(exits)
    } catch (error) {
      this.lastError = redactText(`OpenCode process shutdown failed: ${errorMessage(error)}`)
      this.queue("process-shutdown-failed", this.lastError)
      this.closeStream()
      throw new Error(this.lastError)
    }
  }

  private terminateProcess(child: OpenCodeSpawnedProcess, phase: string, options: { clearCurrent: boolean }): void {
    if (options.clearCurrent && this.process === child) this.process = null
    this.expectedExitProcesses.add(child)
    this.terminatingProcesses.add(child)
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
    this.queue(phase, `OpenCode process termination requested: ${this.commandLabel}${child.pid === undefined ? "" : ` pid ${child.pid}`}`)
  }

  async getStatus(): Promise<Record<string, unknown>> {
    return redactValue({
      adapter: "process",
      phase: this.phase,
      pid: this.process?.pid,
      terminatingPids: [...this.terminatingProcesses].map((child) => child.pid).filter((pid) => pid !== undefined),
      command: this.commandLabel,
      message: `ProcessOpenCodeAdapter ${this.phase}`,
      lastError: this.lastError ?? undefined,
    })
  }

  private attachProcessListeners(child: OpenCodeSpawnedProcess): void {
    child.stdout?.on("data", (data) => this.queue("process-stdout", dataToText(data)))
    child.stderr?.on("data", (data) => this.queue("process-stderr", dataToText(data)))
    child.on("error", (error) => {
      if (this.expectedExitProcesses.has(child) && this.process !== child) {
        this.queue("process-superseded-error", `OpenCode superseded process error: ${errorMessage(error)}`)
        return
      }
      this.phase = "failed"
      this.lastError = redactText(`OpenCode process error: ${errorMessage(error)}`)
      this.terminalProcesses.set(child, this.lastError)
      this.queue("process-error", this.lastError)
    })
    child.on("exit", (code, signal) => {
      const message = exitMessage("OpenCode process exited", code, signal)
      this.terminalProcesses.set(child, message)
      this.terminatingProcesses.delete(child)
      if (this.process === child) this.process = null
      const exitWaiters = this.exitWaiters.get(child)
      this.exitWaiters.delete(child)
      for (const waiter of exitWaiters ?? []) waiter()
      if (this.shutdownRequested || this.expectedExitProcesses.has(child)) {
        if (this.shutdownRequested) this.phase = "shutdown"
        this.queue("process-exited", message)
        if (this.shutdownRequested && this.terminatingProcesses.size === 0 && !this.process) this.closeStream()
        return
      }
      this.phase = "exited"
      this.lastError = exitMessage("OpenCode process exited unexpectedly", code, signal)
      this.queue("process-exited", this.lastError)
      this.closeStream()
    })
  }

  private queue(phase: string, message: string): void {
    this.events.push({ type: "ExecutorLifecycle", phase, message: redactText(message) })
    this.notifyStream()
  }

  private compactDrainedEvents(): void {
    if (this.streamCursor === 0) return
    this.events.splice(0, this.streamCursor)
    this.streamCursor = 0
  }

  private closeStream(): void {
    this.streamClosed = true
    this.notifyStream()
  }

  private notifyStream(): void {
    for (const waiter of [...this.streamWaiters]) waiter()
  }

  private async waitForProcessExit(child: OpenCodeSpawnedProcess, timeoutMs: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const timeout = setTimeout(() => {
        settled = true
        const waiters = this.exitWaiters.get(child)
        waiters?.delete(waiter)
        if (waiters?.size === 0) this.exitWaiters.delete(child)
        reject(new Error(`timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      const waiter = () => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve()
      }
      const waiters = this.exitWaiters.get(child) ?? new Set<() => void>()
      waiters.add(waiter)
      this.exitWaiters.set(child, waiters)
    })
  }

  private async waitForProcessSpawn(child: OpenCodeSpawnedProcess, timeoutMs: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        callback()
      }
      const timeout = setTimeout(() => finish(() => reject(new Error(`timed out after ${timeoutMs}ms`))), timeoutMs)
      child.on("spawn", () => finish(resolve))
      child.on("error", (error) => finish(() => reject(error)))
      child.on("exit", (code, signal) => finish(() => reject(new Error(exitMessage("OpenCode process exited before spawn", code, signal)))))
    })
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
