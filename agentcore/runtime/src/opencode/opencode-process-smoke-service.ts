import { access } from "node:fs/promises"
import { delimiter, isAbsolute, join } from "node:path"
import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { OpenCodeAdapterConfig } from "./adapter-config"
import { ProcessOpenCodeAdapter, type OpenCodeSpawn } from "./process-adapter"
import type { OpenCodeProcessSmokeExecuteInput, OpenCodeProcessSmokePreview, OpenCodeProcessSmokeRecord, OpenCodeProcessSmokeResult } from "./opencode-process-smoke-types"

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_TIMEOUT_MS = 60_000
const PREVIEW_LIMIT = 240
const DIAGNOSTIC_LIMIT = 12
const SMOKE_OBJECTIVE = "NexusLoop OpenCode process smoke. Report readiness only. Do not mutate project state, missions, proposals, reviews, schedulers, or external services."

export interface OpenCodeProcessSmokeServiceOptions {
  eventStore: EventStore
  projectDir: string
  adapterConfig?: OpenCodeAdapterConfig
  env?: Record<string, string | undefined>
  spawn?: OpenCodeSpawn
  now?: () => Date
  idFactory?: () => string
}

export class OpenCodeProcessSmokeService {
  private readonly eventStore: EventStore
  private readonly projectDir: string
  private readonly adapterConfig?: OpenCodeAdapterConfig
  private readonly env: Record<string, string | undefined>
  private readonly spawn?: OpenCodeSpawn
  private readonly now: () => Date
  private readonly idFactory: () => string

  constructor(options: OpenCodeProcessSmokeServiceOptions) {
    this.eventStore = options.eventStore
    this.projectDir = options.projectDir
    this.adapterConfig = options.adapterConfig
    this.env = options.env ?? process.env
    this.spawn = options.spawn
    this.now = options.now ?? (() => new Date())
    this.idFactory = options.idFactory ?? (() => `opencode_smoke_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`)
  }

  async preview(input: { timeout_ms?: number } = {}): Promise<OpenCodeProcessSmokePreview> {
    const timeoutMs = this.readTimeout(input.timeout_ms)
    const command = this.resolveCommand()
    const binary = command ? await this.detectBinary(command) : { detected: false, path: undefined }
    const optIn = this.env.NXL_REAL_OPENCODE_SMOKE === "1"
    const adapterKind = this.adapterConfig?.kind ?? "fake"
    const blockers: string[] = []
    const warnings: string[] = []
    if (!command) blockers.push("OpenCode process command is not configured. Set NXL_OPENCODE_BIN or NXL_OPENCODE_COMMAND.")
    if (!binary.detected) blockers.push("OpenCode binary was not detected on the configured path or PATH.")
    if (!optIn) warnings.push("Set NXL_REAL_OPENCODE_SMOKE=1 to allow explicit real process smoke execution.")
    if (adapterKind !== "process") warnings.push("Runtime adapter is not configured for process mode; smoke will use the explicit configured binary only when opted in.")
    const canExecute = blockers.length === 0 && optIn
    return {
      status: blockers.length > 0 ? (command ? "blocked" : "not_configured") : "ready",
      can_execute: canExecute,
      adapter_kind: adapterKind,
      project_dir: this.safe(this.projectDir),
      binary_path: binary.path ? this.safe(binary.path) : command ? this.safe(command) : undefined,
      binary_detected: binary.detected,
      opt_in_required: true,
      opt_in_present: optIn,
      timeout_ms: timeoutMs,
      blockers,
      warnings,
      redacted_summary_preview: this.safe(canExecute ? "real OpenCode process smoke is ready" : [...blockers, ...warnings].join("; ")),
      recommended_commands: smokeCommands(),
    }
  }

  async execute(input: OpenCodeProcessSmokeExecuteInput = {}): Promise<OpenCodeProcessSmokeResult> {
    const timeoutMs = this.readTimeout(input.timeout_ms)
    const requestedBy = this.safe(input.requested_by ?? "operator")
    const startedAt = this.now().toISOString()
    const smokeId = this.idFactory()
    const preview = await this.preview({ timeout_ms: timeoutMs })
    if (input.dry_run) {
      return this.result({
        smokeId,
        status: "skipped",
        startedAt,
        requestedBy,
        diagnostics: ["dry-run requested; no process launched and no events appended", ...preview.warnings],
        error: preview.blockers[0],
      })
    }
    if (!preview.opt_in_present || preview.blockers.length > 0) {
      const result = this.result({
        smokeId,
        status: "blocked",
        startedAt,
        requestedBy,
        adapterKind: preview.adapter_kind,
        binaryPath: preview.binary_path,
        diagnostics: [...preview.blockers, ...preview.warnings],
        error: preview.blockers[0] ?? "real OpenCode process smoke requires NXL_REAL_OPENCODE_SMOKE=1",
      })
      await this.append("opencode_process_smoke_blocked", result)
      return result
    }

    const started = this.result({
      smokeId,
      status: "skipped",
      startedAt,
      requestedBy,
      adapterKind: preview.adapter_kind,
      binaryPath: preview.binary_path,
      diagnostics: ["real OpenCode process smoke started"],
    })
    await this.append("opencode_process_smoke_started", started)

    const startedTime = Date.now()
    const diagnostics: string[] = []
    try {
      const command = this.resolveCommand()
      if (!command) throw new Error("OpenCode process command is not configured")
      const adapter = new ProcessOpenCodeAdapter({
        command,
        args: this.adapterConfig?.kind === "process" ? this.adapterConfig.args : undefined,
        cwd: this.projectDir,
        env: this.adapterConfig?.kind === "process" ? this.adapterConfig.env : undefined,
        spawn: this.spawn,
        spawnTimeoutMs: timeoutMs,
        writeTimeoutMs: timeoutMs,
        shutdownTimeoutMs: Math.min(timeoutMs, 5_000),
      })
      await withTimeout(adapter.startSession({ projectDir: this.projectDir, objective: SMOKE_OBJECTIVE }), timeoutMs, "OpenCode smoke timed out during session start")
      await withTimeout(adapter.shutdown(), Math.min(timeoutMs, 5_000), "OpenCode smoke timed out during shutdown")
      for await (const event of adapter.streamExecutorEvents()) {
        if (event.type === "ExecutorLifecycle") diagnostics.push(`${event.phase}: ${event.message}`)
        if (diagnostics.length >= DIAGNOSTIC_LIMIT) break
      }
      const result = this.result({
        smokeId,
        status: "succeeded",
        startedAt,
        requestedBy,
        adapterKind: preview.adapter_kind,
        binaryPath: preview.binary_path,
        durationMs: Date.now() - startedTime,
        diagnostics: diagnostics.length ? diagnostics : ["OpenCode process adapter start/shutdown smoke completed"],
      })
      await this.append("opencode_process_smoke_succeeded", result)
      return result
    } catch (error) {
      const message = this.safe(error instanceof Error ? error.message : String(error))
      const result = this.result({
        smokeId,
        status: "failed",
        startedAt,
        requestedBy,
        adapterKind: preview.adapter_kind,
        binaryPath: preview.binary_path,
        durationMs: Date.now() - startedTime,
        diagnostics: [...diagnostics, "real OpenCode process smoke failed"].slice(0, DIAGNOSTIC_LIMIT),
        error: message,
      })
      await this.append("opencode_process_smoke_failed", result)
      return result
    }
  }

  async list(limit = 20): Promise<OpenCodeProcessSmokeRecord[]> {
    return (await this.results())
      .sort((left, right) => String(right.completed_at).localeCompare(String(left.completed_at)))
      .slice(0, Math.min(Math.max(1, limit), 100))
      .map((result) => ({
        smoke_id: result.smoke_id,
        status: result.status,
        adapter_kind: result.adapter_kind,
        completed_at: result.completed_at,
        duration_ms: result.duration_ms,
        exit_code: result.exit_code,
        summary_preview: result.error ? this.safe(result.error) : this.safe(result.diagnostics[0] ?? result.status),
        smoke_hash: result.smoke_hash,
      }))
  }

  async get(smokeId: string): Promise<OpenCodeProcessSmokeResult | null> {
    return (await this.results()).find((result) => result.smoke_id === smokeId) ?? null
  }

  private async results(): Promise<OpenCodeProcessSmokeResult[]> {
    const events = await this.eventStore.readAll()
    return events
      .filter((event) => typeof event.kind === "string" && event.kind.startsWith("opencode_process_smoke_") && event.kind !== "opencode_process_smoke_started")
      .map((event) => eventToResult(event))
      .filter((result): result is OpenCodeProcessSmokeResult => result !== null)
  }

  private resolveCommand(): string | undefined {
    const candidate = this.env.NXL_OPENCODE_BIN?.trim() || this.env.NXL_OPENCODE_COMMAND?.trim() || (this.adapterConfig?.kind === "process" ? this.adapterConfig.command : undefined)
    return candidate?.trim() || undefined
  }

  private async detectBinary(command: string): Promise<{ detected: boolean; path?: string }> {
    const candidates = command.includes("/") || isAbsolute(command)
      ? [command]
      : (this.env.PATH ?? process.env.PATH ?? "").split(delimiter).filter(Boolean).map((entry) => join(entry, command))
    for (const candidate of candidates) {
      try {
        await access(candidate)
        return { detected: true, path: candidate }
      } catch {
        // continue checking PATH entries
      }
    }
    return { detected: false, path: command }
  }

  private readTimeout(value: unknown): number {
    const envTimeout = this.env.NXL_OPENCODE_SMOKE_TIMEOUT_MS
    const raw = value ?? (envTimeout && /^\d+$/.test(envTimeout) ? Number(envTimeout) : undefined) ?? DEFAULT_TIMEOUT_MS
    if (!Number.isInteger(raw) || typeof raw !== "number" || raw <= 0) throw new Error("timeout_ms must be a positive integer")
    return Math.min(raw, MAX_TIMEOUT_MS)
  }

  private result(input: {
    smokeId: string
    status: OpenCodeProcessSmokeResult["status"]
    startedAt: string
    requestedBy: string
    adapterKind?: string
    binaryPath?: string
    durationMs?: number
    diagnostics: string[]
    error?: string
  }): OpenCodeProcessSmokeResult {
    const completedAt = this.now().toISOString()
    const result: Omit<OpenCodeProcessSmokeResult, "smoke_hash"> = {
      smoke_id: this.safe(input.smokeId),
      status: input.status,
      adapter_kind: input.adapterKind,
      project_dir: this.safe(this.projectDir),
      binary_path: input.binaryPath ? this.safe(input.binaryPath) : undefined,
      started_at: input.startedAt,
      completed_at: completedAt,
      duration_ms: input.durationMs,
      diagnostics: input.diagnostics.map((item) => this.safe(item)).slice(0, DIAGNOSTIC_LIMIT),
      error: input.error ? this.safe(input.error) : undefined,
      requested_by: input.requestedBy,
    }
    return { ...result, smoke_hash: hash(result) }
  }

  private async append(kind: string, result: OpenCodeProcessSmokeResult): Promise<void> {
    await this.eventStore.append(redactValue({ kind, ...result }))
  }

  private safe(value: string): string {
    return preview(redactText(value), PREVIEW_LIMIT)
  }
}

function smokeCommands() {
  return [
    { label: "Preview OpenCode smoke", command: "/opencode-smoke-preview", command_type: "read" as const },
    { label: "Dry-run OpenCode smoke", command: "/opencode-smoke-dry-run", command_type: "read" as const },
    { label: "Run OpenCode smoke", command: "/opencode-smoke", command_type: "write" as const, requires_active_runtime: true, notes: "requires NXL_REAL_OPENCODE_SMOKE=1" },
    { label: "List OpenCode smokes", command: "/opencode-smokes", command_type: "read" as const },
  ]
}

function eventToResult(event: JsonlEvent): OpenCodeProcessSmokeResult | null {
  if (typeof event.smoke_id !== "string" || typeof event.status !== "string") return null
  return {
    smoke_id: event.smoke_id,
    status: readStatus(event.status),
    adapter_kind: typeof event.adapter_kind === "string" ? event.adapter_kind : undefined,
    project_dir: typeof event.project_dir === "string" ? event.project_dir : "",
    binary_path: typeof event.binary_path === "string" ? event.binary_path : undefined,
    started_at: typeof event.started_at === "string" ? event.started_at : "",
    completed_at: typeof event.completed_at === "string" ? event.completed_at : "",
    duration_ms: typeof event.duration_ms === "number" ? event.duration_ms : undefined,
    exit_code: typeof event.exit_code === "number" ? event.exit_code : undefined,
    signal: typeof event.signal === "string" ? event.signal : undefined,
    stdout_preview: typeof event.stdout_preview === "string" ? event.stdout_preview : undefined,
    stderr_preview: typeof event.stderr_preview === "string" ? event.stderr_preview : undefined,
    diagnostics: Array.isArray(event.diagnostics) ? event.diagnostics.filter((item): item is string => typeof item === "string").slice(0, DIAGNOSTIC_LIMIT) : [],
    error: typeof event.error === "string" ? event.error : undefined,
    requested_by: typeof event.requested_by === "string" ? event.requested_by : "unknown",
    smoke_hash: typeof event.smoke_hash === "string" ? event.smoke_hash : hash(event),
  }
}

function readStatus(value: string): OpenCodeProcessSmokeResult["status"] {
  if (value === "succeeded" || value === "failed" || value === "blocked" || value === "skipped") return value
  return "failed"
}

function preview(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 12))}...[truncated]`
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex")
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (!value || typeof value !== "object") return JSON.stringify(value)
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
