import { createHash } from "node:crypto"
import { spawn as nodeSpawn } from "node:child_process"
import { types as nodeUtilTypes } from "node:util"
import type { ExecutorModelSelectionProjection } from "./model-configuration-types"
import {
  validateOpenCodeAdapterConfig,
  type OpenCodeAdapterConfig,
} from "../opencode/adapter-config"
import type {
  OpenCodeSpawn,
  OpenCodeSpawnedProcess,
} from "../opencode/process-adapter"
import type {
  ExecutorModelReadinessObservation,
  ExecutorModelReadinessResolver,
} from "./model-profile-runtime-registry-types"

export const OPENCODE_EXECUTOR_READINESS_PROTOCOL_VERSION = 1 as const
export const OPENCODE_EXECUTOR_READINESS_PROTOCOL_POLICY = "nexusloop_opencode_executor_readiness_observation_v1" as const
export const OPENCODE_EXECUTOR_READINESS_REQUEST_VERSION = "nexusloop_opencode_executor_readiness_request_v1" as const

const HASH = /^[a-f0-9]{64}$/
const SAFE_ID = /^[A-Za-z0-9_.:-]+$/
const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_MAX_OUTPUT_BYTES = 4_096
const DEFAULT_MAX_CONCURRENCY = 2
const MAX_INPUT_BYTES = 2_048
const TERMINATION_GRACE_MS = 100

type ResolverOptions = Readonly<{
  command: string
  args?: readonly string[]
  cwd: string
  env?: Readonly<Record<string, string | undefined>>
  timeoutMs?: number
  maxOutputBytes?: number
  maxConcurrency?: number
  spawn?: OpenCodeSpawn
}>

type ActiveObservation = {
  child: OpenCodeSpawnedProcess
  promise: Promise<ExecutorModelReadinessObservation>
  rejectForShutdown: () => void
}

export class OpenCodeExecutorModelReadinessResolver implements ExecutorModelReadinessResolver {
  readonly #command: string
  readonly #args: readonly string[]
  readonly #cwd: string
  readonly #env?: Readonly<Record<string, string | undefined>>
  readonly #timeoutMs: number
  readonly #maxOutputBytes: number
  readonly #maxConcurrency: number
  readonly #spawn: OpenCodeSpawn
  readonly #active = new Set<ActiveObservation>()
  #lifecycleState: "available" | "starting" | "stopping" = "available"
  #startTask: Promise<void> | null = null

  constructor(options: ResolverOptions) {
    const input = resolverOptions(options)
    this.#command = boundedText(input.command, "observer command", 1_024)
    this.#args = Object.freeze(copyDenseStrings(input.args ?? [], "observer arguments", 1_024))
    this.#cwd = boundedText(input.cwd, "observer working directory", 4_096)
    this.#env = input.env ? Object.freeze(copyEnvironment(input.env)) : undefined
    this.#timeoutMs = positiveBoundedInteger(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, "observer timeout", 60_000)
    this.#maxOutputBytes = positiveBoundedInteger(input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES, "observer output limit", 65_536)
    this.#maxConcurrency = positiveBoundedInteger(input.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY, "observer concurrency", 8)
    this.#spawn = (input.spawn as OpenCodeSpawn | undefined) ?? defaultSpawn
  }

  observe(selection: ExecutorModelSelectionProjection): Promise<ExecutorModelReadinessObservation> {
    if (this.#lifecycleState === "stopping") return Promise.reject(new Error("Executor readiness observation failed: Runtime shutdown is in progress"))
    if (this.#lifecycleState === "starting") return Promise.reject(new Error("Executor readiness observation failed: Runtime startup is in progress"))
    if (this.#active.size >= this.#maxConcurrency) return Promise.reject(new Error("Executor readiness observation failed: observer capacity is exhausted"))
    const input = requestFor(selection)
    const requestText = `${JSON.stringify(input)}\n`
    if (Buffer.byteLength(requestText, "utf8") > MAX_INPUT_BYTES) {
      return Promise.reject(new Error("Executor readiness observation failed: request exceeded its bound"))
    }
    let child: OpenCodeSpawnedProcess
    try {
      child = this.#spawn(this.#command, [...this.#args], {
        cwd: this.#cwd,
        env: childEnvironment(this.#env),
      })
    } catch {
      return Promise.reject(new Error("Executor readiness observation failed: process start failed"))
    }
    let rejectForShutdown = () => {}
    const promise = new Promise<ExecutorModelReadinessObservation>((resolve, reject) => {
      let stdout = Buffer.alloc(0)
      let settled = false
      let forcedError: Error | null = null
      let timer: ReturnType<typeof setTimeout> | undefined
      let terminationTimer: ReturnType<typeof setTimeout> | undefined
      const finish = (error?: Error, value?: ExecutorModelReadinessObservation) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        if (terminationTimer) clearTimeout(terminationTimer)
        if (error) reject(error)
        else resolve(value!)
      }
      let terminating = false
      const terminate = () => {
        if (terminating) return
        terminating = true
        try { child.kill?.("SIGTERM") } catch {}
        terminationTimer = setTimeout(() => {
          try { child.kill?.("SIGKILL") } catch {}
          finish(forcedError ?? new Error("Executor readiness observation failed: observer process did not complete"))
        }, TERMINATION_GRACE_MS)
      }
      rejectForShutdown = () => {
        forcedError = new Error("Executor readiness observation failed: Runtime shutdown cancelled the observation")
        terminate()
      }
      child.stdout?.on("data", (chunk: unknown) => {
        if (settled) return
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
        if (stdout.length + bytes.length > this.#maxOutputBytes) {
          forcedError = new Error("Executor readiness observation failed: output exceeded its bound")
          terminate()
          return
        }
        stdout = Buffer.concat([stdout, bytes])
      })
      child.stderr?.on("data", () => {})
      child.on("error", () => finish(new Error("Executor readiness observation failed: process start failed")))
      child.on("close", (code, signal) => {
        if (settled) return
        if (forcedError) return finish(forcedError)
        if (code !== 0 || signal !== null) return finish(new Error("Executor readiness observation failed: observer process did not complete"))
        try {
          finish(undefined, parseResponse(stdout.toString("utf8"), input))
        } catch (error) {
          finish(new Error(error instanceof ObservationIdentityError
            ? "Executor readiness observation failed: observation identity mismatch"
            : "Executor readiness observation failed: malformed observer output"))
        }
      })
      timer = setTimeout(() => {
        forcedError = new Error(`Executor readiness observation failed: timed out after ${this.#timeoutMs}ms`)
        terminate()
      }, this.#timeoutMs)
      timer.unref()
      child.stdin?.on?.("error", () => {
        forcedError = new Error("Executor readiness observation failed: request delivery failed")
        terminate()
      })
      child.stdin?.write?.(requestText)
      child.stdin?.end?.()
    })
    const active: ActiveObservation = { child, promise, rejectForShutdown: () => rejectForShutdown() }
    this.#active.add(active)
    void promise.finally(() => this.#active.delete(active)).catch(() => {})
    return promise
  }

  start(): Promise<void> {
    if (this.#startTask) return this.#startTask
    this.#lifecycleState = "starting"
    const active = [...this.#active]
    const task = (async () => {
      await Promise.allSettled(active.map((item) => item.promise))
      if (this.#lifecycleState === "stopping") {
        throw new Error("Executor readiness observation failed: Runtime shutdown is in progress")
      }
      this.#lifecycleState = "available"
    })()
    this.#startTask = task
    void task.finally(() => {
      if (this.#startTask === task) this.#startTask = null
    }).catch(() => {})
    return task
  }

  async shutdown(): Promise<void> {
    this.#lifecycleState = "stopping"
    const active = [...this.#active]
    for (const item of active) item.rejectForShutdown()
    await Promise.allSettled(active.map((item) => item.promise))
  }

  activeCount(): number { return this.#active.size }
}

export function createProductionOpenCodeExecutorReadinessResolver(options: {
  projectDir: string
  openCodeAdapterConfig: OpenCodeAdapterConfig
  spawn?: OpenCodeSpawn
}): OpenCodeExecutorModelReadinessResolver {
  return createPackagedOpenCodeExecutorReadinessResolver(options)
}

export function createPackagedOpenCodeExecutorReadinessResolver(options: {
  projectDir: string
  openCodeAdapterConfig: OpenCodeAdapterConfig
  spawn?: OpenCodeSpawn
}): OpenCodeExecutorModelReadinessResolver {
  const input = snapshotRecord(options, "packaged Executor readiness options", ["projectDir", "openCodeAdapterConfig"], ["spawn"])
  const projectDir = boundedText(input.projectDir, "project directory", 4_096)
  const config = snapshotPackagedOpenCodeAdapterConfig(input.openCodeAdapterConfig)
  if (config.kind !== "process") throw new Error("packaged Executor readiness requires the process OpenCode adapter")
  return new OpenCodeExecutorModelReadinessResolver({
    command: config.command!,
    args: ["nexusloop", "executor-readiness-v1"],
    cwd: config.cwd ?? projectDir,
    env: config.env,
    ...(input.spawn === undefined ? {} : { spawn: input.spawn as OpenCodeSpawn }),
  })
}

export function snapshotPackagedOpenCodeAdapterConfig(value: unknown): Readonly<OpenCodeAdapterConfig> {
  const validated = validateOpenCodeAdapterConfig(snapshotOpenCodeAdapterConfig(value))
  if (validated.args) Object.freeze(validated.args)
  if (validated.env) Object.freeze(validated.env)
  return Object.freeze(validated)
}

function snapshotOpenCodeAdapterConfig(value: unknown): OpenCodeAdapterConfig {
  const input = snapshotRecord(value, "OpenCode adapter config", ["kind"], [
    "command", "args", "cwd", "env", "spawnTimeoutMs", "writeTimeoutMs", "shutdownTimeoutMs",
  ])
  const output: Record<string, unknown> = Object.create(null)
  output.kind = input.kind
  if (input.command !== undefined) output.command = input.command
  if (input.args !== undefined) output.args = copyDenseStrings(input.args, "OpenCode adapter arguments", 4_096)
  if (input.cwd !== undefined) output.cwd = input.cwd
  if (input.env !== undefined) output.env = copyEnvironment(input.env)
  for (const key of ["spawnTimeoutMs", "writeTimeoutMs", "shutdownTimeoutMs"] as const) {
    if (input[key] !== undefined) output[key] = input[key]
  }
  return output as unknown as OpenCodeAdapterConfig
}

function snapshotRecord(value: unknown, label: string, required: readonly string[], optional: readonly string[]): Record<string, unknown> {
  rejectProxy(value, label)
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error(`${label} must be a plain object`)
  }
  const allowed = new Set([...required, ...optional])
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== "string" || !allowed.has(key))) throw new Error(`${label} contains unknown fields`)
  const output = Object.create(null) as Record<string, unknown>
  for (const key of required) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new Error(`${label} requires own data fields`)
    output[key] = descriptor.value
  }
  for (const key of optional) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor) continue
    if (!descriptor.enumerable || !("value" in descriptor)) throw new Error(`${label} requires own data fields`)
    output[key] = descriptor.value
  }
  return output
}

function requestFor(selection: ExecutorModelSelectionProjection) {
  rejectProxy(selection, "Executor selection")
  if (typeof selection !== "object" || selection === null || (Object.getPrototypeOf(selection) !== Object.prototype && Object.getPrototypeOf(selection) !== null)) throw new Error("Executor selection must be a plain object")
  const projectionHash = ownData(selection, "projection_hash", "Executor selection")
  const providerId = ownData(selection, "provider_id", "Executor selection")
  const modelId = ownData(selection, "model_id", "Executor selection")
  const credentialBindingId = ownData(selection, "credential_binding_id", "Executor selection")
  return Object.freeze({
    request_version: OPENCODE_EXECUTOR_READINESS_REQUEST_VERSION,
    selection_projection_hash: hash(projectionHash, "selection projection hash"),
    provider_id: identifier(providerId, "provider ID", 160),
    model_id: inertText(modelId, "model ID", 240),
    credential_binding_id: identifier(credentialBindingId, "credential binding ID", 160),
  })
}

function parseResponse(text: string, expected: ReturnType<typeof requestFor>): ExecutorModelReadinessObservation {
  if (!text.endsWith("\n") || text.includes("\r") || text.slice(0, -1).includes("\n")) {
    throw new Error("observer output must contain one canonical JSON record")
  }
  const line = text.slice(0, -1)
  const rawKeys = [...line.matchAll(/"((?:\\.|[^"\\])*)"\s*:/g)].map((match) => JSON.parse(`"${match[1]}"`) as string)
  if (rawKeys.length !== 8 || new Set(rawKeys).size !== rawKeys.length) throw new Error("observer output contains duplicate or nested fields")
  const value = JSON.parse(line)
  const input = strictRecord(value, [
    "observation_version", "selection_projection_hash", "provider_id", "model_id", "credential_binding_id",
    "provider_availability_status", "credential_connection_status", "evidence_id",
  ])
  if (input.observation_version !== OPENCODE_EXECUTOR_READINESS_PROTOCOL_VERSION) throw new Error("protocol mismatch")
  if (input.selection_projection_hash !== expected.selection_projection_hash || input.provider_id !== expected.provider_id
    || input.model_id !== expected.model_id || input.credential_binding_id !== expected.credential_binding_id) {
    throw new ObservationIdentityError()
  }
  const selectionProjectionHash = hash(input.selection_projection_hash, "selection projection hash")
  const providerId = identifier(input.provider_id, "provider ID", 160)
  const modelId = inertText(input.model_id, "model ID", 240)
  const credentialBindingId = identifier(input.credential_binding_id, "credential binding ID", 160)
  const providerAvailability = enumValue(input.provider_availability_status, ["available", "unavailable", "unknown"] as const)
  const credentialConnection = enumValue(input.credential_connection_status, ["connected", "disconnected", "unknown"] as const)
  const evidence = {
    policy_version: "nexusloop_opencode_executor_readiness_policy_v1",
    selection_projection_hash: selectionProjectionHash,
    provider_id: providerId,
    model_id: modelId,
    credential_binding_id: credentialBindingId,
    provider_availability_status: providerAvailability,
    credential_connection_status: credentialConnection,
  }
  const expectedEvidenceId = `opencode-readiness-v1-${createHash("sha256").update(JSON.stringify(evidence)).digest("hex")}`
  if (input.evidence_id !== expectedEvidenceId) throw new ObservationIdentityError()
  return Object.freeze({
    observation_version: 1,
    selection_projection_hash: selectionProjectionHash,
    provider_id: providerId,
    model_id: modelId,
    credential_binding_id: credentialBindingId,
    provider_availability_status: providerAvailability,
    credential_connection_status: credentialConnection,
    evidence_id: expectedEvidenceId,
  })
}

function childEnvironment(overrides?: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const output: Record<string, string> = Object.create(null)
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) output[key] = value
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === undefined) delete output[key]
    else output[key] = value
  }
  return output
}

function resolverOptions(value: unknown): Record<string, unknown> {
  rejectProxy(value, "observer options")
  if (typeof value !== "object" || value === null || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new Error("observer options must be a plain object")
  const allowed = new Set(["command", "args", "cwd", "env", "timeoutMs", "maxOutputBytes", "maxConcurrency", "spawn"])
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== "string" || !allowed.has(key))) throw new Error("observer options contain unknown fields")
  const output = Object.create(null) as Record<string, unknown>
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new Error("observer options must contain own data fields")
    output[key] = descriptor.value
  }
  if (!Object.hasOwn(output, "command") || !Object.hasOwn(output, "cwd")) throw new Error("observer options are incomplete")
  return output
}

function copyEnvironment(value: unknown): Record<string, string | undefined> {
  rejectProxy(value, "observer environment")
  if (typeof value !== "object" || value === null || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new Error("observer environment must be a plain object")
  const output = Object.create(null) as Record<string, string | undefined>
  if (Object.getOwnPropertySymbols(value).length > 0) throw new Error("observer environment must not contain symbols")
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new Error("observer environment must contain own data properties")
    if (descriptor.value !== undefined && typeof descriptor.value !== "string") throw new Error("observer environment values must be strings")
    output[key] = descriptor.value
  }
  return output
}

function ownData(value: object, key: string, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new Error(`${label} must contain own data fields`)
  return descriptor.value
}

function copyDenseStrings(value: unknown, label: string, max: number): string[] {
  rejectProxy(value, label)
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  const keys = Reflect.ownKeys(value)
  const allowed = new Set(["length", ...Array.from({ length: value.length }, (_, index) => String(index))])
  if (keys.some((key) => typeof key !== "string" || !allowed.has(key))) throw new Error(`${label} must be a dense plain array`)
  const output: string[] = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new Error(`${label} must be a dense own-data array`)
    output.push(boundedText(descriptor.value, "observer argument", max))
  }
  return output
}

class ObservationIdentityError extends Error {}

function strictRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  rejectProxy(value, "Executor readiness response")
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("response must be a plain object")
  const own = Reflect.ownKeys(value)
  const expected = new Set(keys)
  if (own.length !== expected.size || own.some((key) => typeof key !== "string" || !expected.has(key))) throw new Error("response contains unknown or missing fields")
  const output = Object.create(null) as Record<string, unknown>
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new Error("response fields must be own data properties")
    output[key] = descriptor.value
  }
  return output
}

function identifier(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max || value !== value.trim() || !SAFE_ID.test(value)) throw new Error(`${label} is invalid`)
  return value
}
function inertText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label} is invalid`)
  return value
}
function boundedText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max || value !== value.trim() || /[\u0000\r\n]/.test(value)) throw new Error(`${label} is invalid`)
  return value
}
function positiveBoundedInteger(value: unknown, label: string, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > max) throw new Error(`${label} is invalid`)
  return value as number
}
function hash(value: unknown, label: string): string {
  if (typeof value !== "string" || !HASH.test(value)) throw new Error(`${label} is invalid`)
  return value
}
function enumValue<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error("observation status is invalid")
  return value
}
function rejectProxy(value: unknown, label: string): void {
  if ((typeof value === "object" && value !== null || typeof value === "function") && nodeUtilTypes.isProxy(value)) throw new Error(`${label} must not be a Proxy`)
}
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${Array.from(value, canonicalJson).join(",")}]`
  if (typeof value !== "object") throw new Error("non-canonical evidence")
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`
}

const defaultSpawn: OpenCodeSpawn = (command, args, options) => nodeSpawn(command, args, {
  cwd: options.cwd,
  env: options.env,
  stdio: ["pipe", "pipe", "pipe"],
}) as unknown as OpenCodeSpawnedProcess
