import { FakeOpenCodeAdapter } from "./fake-adapter"
import { ProcessOpenCodeAdapter, type OpenCodeSpawn } from "./process-adapter"
import type { ExecutorToolHandler, OpenCodeRuntimeAdapter } from "./adapter"
import { redactValue } from "../security/redaction"

export type RuntimeOpenCodeAdapterKind = "fake" | "process"

export interface OpenCodeAdapterConfig {
  kind: RuntimeOpenCodeAdapterKind
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  spawnTimeoutMs?: number
  writeTimeoutMs?: number
  shutdownTimeoutMs?: number
}

export interface OpenCodeAdapterFactoryOptions {
  projectDir?: string
  spawn?: OpenCodeSpawn
  toolHandler?: ExecutorToolHandler
}

const PROCESS_ONLY_FIELDS = ["command", "args", "cwd", "env", "spawnTimeoutMs", "writeTimeoutMs", "shutdownTimeoutMs"] as const

export function createOpenCodeAdapter(config: OpenCodeAdapterConfig, options: OpenCodeAdapterFactoryOptions = {}): OpenCodeRuntimeAdapter {
  const validated = validateOpenCodeAdapterConfig(config)
  if (validated.kind === "fake") return new FakeOpenCodeAdapter()
  return new ProcessOpenCodeAdapter({
    command: validated.command!,
    args: validated.args,
    cwd: validated.cwd ?? options.projectDir,
    env: validated.env,
    spawn: options.spawn,
    spawnTimeoutMs: validated.spawnTimeoutMs,
    writeTimeoutMs: validated.writeTimeoutMs,
    shutdownTimeoutMs: validated.shutdownTimeoutMs,
    toolHandler: options.toolHandler,
  })
}

export function validateOpenCodeAdapterConfig(config: OpenCodeAdapterConfig): OpenCodeAdapterConfig {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("OpenCode adapter config must be an object")
  }
  if (config.kind !== "fake" && config.kind !== "process") {
    throw new Error(`unknown OpenCode adapter kind: ${String((config as { kind?: unknown }).kind)}`)
  }

  if (config.kind === "fake") {
    const processOnlyField = PROCESS_ONLY_FIELDS.find((field) => config[field] !== undefined)
    if (processOnlyField) throw new Error(`OpenCode fake adapter config does not accept process-only field: ${processOnlyField}`)
    return { kind: "fake" }
  }

  const command = requireNonblankString(config.command, "command")
  const args = optionalStringArray(config.args, "args")
  const cwd = optionalString(config.cwd, "cwd")
  const env = optionalStringRecord(config.env, "env")
  const spawnTimeoutMs = optionalPositiveInteger(config.spawnTimeoutMs, "spawnTimeoutMs")
  const writeTimeoutMs = optionalPositiveInteger(config.writeTimeoutMs, "writeTimeoutMs")
  const shutdownTimeoutMs = optionalPositiveInteger(config.shutdownTimeoutMs, "shutdownTimeoutMs")

  return {
    kind: "process",
    command,
    args,
    cwd,
    env,
    spawnTimeoutMs,
    writeTimeoutMs,
    shutdownTimeoutMs,
  }
}

export function redactOpenCodeAdapterConfig(config: OpenCodeAdapterConfig): OpenCodeAdapterConfig {
  return redactValue(validateOpenCodeAdapterConfig(config))
}

export function readOpenCodeAdapterConfigFromEnv(env: Record<string, string | undefined>): OpenCodeAdapterConfig | undefined {
  const kind = env.NXL_OPENCODE_ADAPTER
  if (kind === undefined || kind.trim() === "") return undefined
  if (kind !== "fake" && kind !== "process") throw new Error(`unknown OpenCode adapter kind in NXL_OPENCODE_ADAPTER: ${kind}`)
  if (kind === "fake") return { kind: "fake" }

  return validateOpenCodeAdapterConfig({
    kind,
    command: env.NXL_OPENCODE_COMMAND,
    args: readArgsJson(env.NXL_OPENCODE_ARGS_JSON),
    spawnTimeoutMs: readOptionalTimeout(env.NXL_OPENCODE_SPAWN_TIMEOUT_MS, "NXL_OPENCODE_SPAWN_TIMEOUT_MS"),
    writeTimeoutMs: readOptionalTimeout(env.NXL_OPENCODE_WRITE_TIMEOUT_MS, "NXL_OPENCODE_WRITE_TIMEOUT_MS"),
    shutdownTimeoutMs: readOptionalTimeout(env.NXL_OPENCODE_SHUTDOWN_TIMEOUT_MS, "NXL_OPENCODE_SHUTDOWN_TIMEOUT_MS"),
  })
}

function requireNonblankString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`OpenCode process adapter ${field} must be a nonblank string`)
  return value
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`OpenCode process adapter ${field} must be a string`)
  return value
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`OpenCode process adapter ${field} must be an array of strings`)
  }
  return [...value]
}

function optionalStringRecord(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`OpenCode process adapter ${field} must be a string record`)
  }
  const output: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof key !== "string" || typeof item !== "string") {
      throw new Error(`OpenCode process adapter ${field} keys and values must be strings`)
    }
    output[key] = item
  }
  return output
}

function optionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || typeof value !== "number" || value <= 0) {
    throw new Error(`OpenCode process adapter ${field} must be a positive integer`)
  }
  return value
}

function readArgsJson(value: string | undefined): string[] | undefined {
  if (value === undefined || value.trim() === "") return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    throw new Error(`NXL_OPENCODE_ARGS_JSON must be valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  return optionalStringArray(parsed, "args")
}

function readOptionalTimeout(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value.trim() === "") return undefined
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a positive integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}
