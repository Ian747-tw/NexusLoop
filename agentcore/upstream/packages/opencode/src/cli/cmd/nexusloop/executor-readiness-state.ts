import path from "node:path"
import os from "node:os"
import { existsSync } from "node:fs"
import { Database } from "bun:sqlite"
import { parse, visit, type ParseError } from "jsonc-parser"
import Ajv2020 from "ajv/dist/2020"
import openapi from "../../../../../sdk/openapi.json"
import { Info as AuthInfo } from "../../../auth/schema"
import { InstallationChannel } from "../../../installation/version"
import { Glob } from "@opencode-ai/shared/util/glob"
import type { ExecutorReadinessSource } from "./executor-readiness"

const MAX_CONFIG_BYTES = 1024 * 1024
const MAX_AUTH_BYTES = 1024 * 1024
const MAX_FRAGMENTS = 64
const MAX_GIT_OUTPUT_BYTES = 4096
const GIT_TIMEOUT_MS = 1000

const validateOpenCodeConfigSchema = new Ajv2020({ strict: false, allErrors: false }).compile({
  $ref: "#/components/schemas/Config",
  components: { schemas: openapi.components.schemas },
})

type LoadOptions = Readonly<{
  cwd: string
  env: Readonly<Record<string, string | undefined>>
  catalog: unknown
  configHome?: string
  dataHome?: string
  managedConfigDir?: string
}>

export async function loadExecutorReadinessSource(options: LoadOptions): Promise<ExecutorReadinessSource> {
  const environment = snapshotEnvironment(options.env)
  const home = environment.OPENCODE_TEST_HOME || os.homedir()
  const configHome = options.configHome ?? (options.env.XDG_CONFIG_HOME || path.join(home, ".config"))
  const dataHome = options.dataHome ?? (options.env.XDG_DATA_HOME || path.join(home, ".local", "share"))
  const fragments: unknown[] = []
  let complete = true

  const legacyGlobal = await boundedFile(path.join(configHome, "opencode", "config"), MAX_CONFIG_BYTES)
  if (legacyGlobal.status !== "missing") complete = false

  const projectConfigDisabled = truthy(environment.OPENCODE_DISABLE_PROJECT_CONFIG)
  const project = await discoverProjectBoundary(options.cwd)
  if (!project.complete) complete = false
  const configDirectories = uniqueLiteral([
    ...(!projectConfigDisabled ? upwardProjectDirectories(options.cwd, project.boundary) : []),
    path.join(home, ".opencode"),
    ...(options.env.OPENCODE_CONFIG_DIR ? [options.env.OPENCODE_CONFIG_DIR] : []),
  ]).map((directory) => path.isAbsolute(directory) ? directory : path.resolve(options.cwd, directory))
  const configFiles = [
    ...unique([
      path.join(configHome, "opencode", "config.json"),
      path.join(configHome, "opencode", "opencode.json"),
      path.join(configHome, "opencode", "opencode.jsonc"),
    ]),
    ...unique(options.env.OPENCODE_CONFIG ? [options.env.OPENCODE_CONFIG] : []),
    ...unique(!projectConfigDisabled ? upwardProjectConfigFiles(options.cwd, project.boundary) : []),
    ...configDirectories.flatMap((directory) => [
      path.join(directory, "opencode.json"),
      path.join(directory, "opencode.jsonc"),
    ]),
  ]

  for (let index = 0; index < configFiles.length; index += 1) {
    const text = await boundedFile(configFiles[index]!, MAX_CONFIG_BYTES)
    if (text.status === "missing") continue
    if (text.status === "failed") {
      complete = false
      continue
    }
    if (text.value.length === 0) continue
    if (fragments.length >= MAX_FRAGMENTS) {
      complete = false
      continue
    }
    const parsed = strictJson(text.value, true)
    if (!parsed.ok) {
      complete = false
      continue
    }
    const validated = validatedOpenCodeConfig(parsed.value)
    if (!validated) {
      complete = false
      continue
    }
    fragments.push(validated)
  }
  if (options.env.OPENCODE_CONFIG_CONTENT) {
    if (fragments.length >= MAX_FRAGMENTS) complete = false
    else if (Buffer.byteLength(options.env.OPENCODE_CONFIG_CONTENT, "utf8") > MAX_CONFIG_BYTES) complete = false
    else {
      const parsed = strictJson(options.env.OPENCODE_CONFIG_CONTENT, true)
      const validated = parsed.ok ? validatedOpenCodeConfig(parsed.value) : undefined
      if (validated) fragments.push(validated)
      else complete = false
    }
  }

  const managedDir = options.managedConfigDir ?? environment.OPENCODE_TEST_MANAGED_CONFIG_DIR ?? systemManagedConfigDir()
  const managed = await managedConfigFiles(managedDir)
  if (!managed.ok) complete = false
  for (let index = 0; index < managed.files.length; index += 1) {
    const text = await boundedFile(managed.files[index]!, MAX_CONFIG_BYTES)
    if (text.status === "missing") continue
    if (text.status === "failed") {
      complete = false
      continue
    }
    if (text.value.length === 0) continue
    if (fragments.length >= MAX_FRAGMENTS) {
      complete = false
      continue
    }
    const parsed = strictJson(text.value, true)
    const validated = parsed.ok ? validatedOpenCodeConfig(parsed.value) : undefined
    if (!validated) {
      complete = false
      continue
    }
    fragments.push(validated)
  }
  // The normal macOS path may add MDM preferences through plutil. The bounded
  // observer does not launch that subprocess, so a present profile is unknown.
  if (managedPreferencesMayExist()) complete = false

  if (options.env.OPENCODE_MODELS_PATH || options.env.OPENCODE_MODELS_URL) complete = false
  if (!truthy(environment.OPENCODE_PURE) && await hasPluginFiles(
    options.cwd,
    project.boundary,
    home,
    configHome,
    projectConfigDisabled,
    options.env.OPENCODE_CONFIG_DIR,
  )) {
    if (fragments.length >= MAX_FRAGMENTS) complete = false
    else fragments.push({ plugin: ["present"] })
  }

  const authFromEnvironment = Boolean(options.env.OPENCODE_AUTH_CONTENT)
  const authText = authFromEnvironment
    ? { status: "ready" as const, value: options.env.OPENCODE_AUTH_CONTENT! }
    : await boundedFile(path.join(dataHome, "opencode", "auth.json"), MAX_AUTH_BYTES)
  let auth: unknown = {}
  if (authText.status === "failed") complete = false
  if (authText.status === "ready") {
    const parsed = strictJson(authText.value, false)
    if (parsed.ok) {
      const validated = validateAuthRecord(parsed.value)
      if (authFromEnvironment) {
        auth = validated.complete ? validated.value : {}
        if (!validated.complete) complete = false
      } else {
        auth = validated.value
      }
      if (containsWellKnownAuth(auth)) complete = false
    } else complete = false
  }

  const databasePath = effectiveDatabasePath(dataHome, environment)
  if (!databasePath) complete = false
  const remoteAccount = databasePath ? activeRemoteAccountStatus(databasePath) : undefined
  if (remoteAccount !== false) complete = false

  return Object.freeze({
    catalog: options.catalog,
    config_fragments: Object.freeze(fragments),
    auth,
    env: environment,
    observation_complete: complete,
  })
}

function effectiveDatabasePath(
  dataHome: string,
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const dataDirectory = path.join(dataHome, "opencode")
  const configured = environment.OPENCODE_DB
  if (configured) {
    if (configured === ":memory:") return
    return path.isAbsolute(configured) ? configured : path.join(dataDirectory, configured)
  }
  if (["latest", "beta", "prod"].includes(InstallationChannel) || truthy(environment.OPENCODE_DISABLE_CHANNEL_DB)) {
    return path.join(dataDirectory, "opencode.db")
  }
  const channel = InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")
  return path.join(dataDirectory, `opencode-${channel}.db`)
}

function snapshotEnvironment(value: Readonly<Record<string, string | undefined>>): Record<string, string | undefined> {
  const output = Object.create(null) as Record<string, string | undefined>
  for (const key of Object.keys(value)) {
    const item = value[key]
    if (typeof item === "string" || item === undefined) output[key] = item
  }
  return Object.freeze(output)
}

function upwardDirectories(cwd: string, boundary = path.parse(path.resolve(cwd)).root): string[] {
  const output: string[] = []
  let current = path.resolve(cwd)
  const stop = path.resolve(boundary)
  for (;;) {
    output.unshift(current)
    if (current === stop) return output
    const parent = path.dirname(current)
    if (parent === current) return output
    current = parent
  }
}

function upwardProjectConfigFiles(cwd: string, boundary: string): string[] {
  return upwardDirectories(cwd, boundary).flatMap((directory) => [
    path.join(directory, "opencode.json"),
    path.join(directory, "opencode.jsonc"),
  ])
}

function upwardProjectDirectories(cwd: string, boundary: string): string[] {
  return upwardDirectories(cwd, boundary).toReversed().map((directory) => path.join(directory, ".opencode"))
}

async function hasPluginFiles(
  cwd: string,
  projectBoundary: string,
  home: string,
  configHome: string,
  projectConfigDisabled: boolean,
  explicitConfigDir?: string,
): Promise<boolean> {
  const roots = [path.join(configHome, "opencode")]
  if (!projectConfigDisabled) {
    for (const current of upwardDirectories(cwd, projectBoundary)) {
      roots.push(path.join(current, ".opencode"))
    }
  }
  roots.push(path.join(home, ".opencode"))
  if (explicitConfigDir) roots.push(explicitConfigDir)
  for (let index = 0; index < roots.length; index += 1) {
    try {
      const files = await Glob.scan("{plugin,plugins}/*.{ts,js}", {
        cwd: roots[index]!,
        absolute: true,
        dot: true,
        symlink: true,
      })
      if (files.length > 0) return true
    } catch {}
  }
  return false
}

async function discoverProjectBoundary(cwd: string): Promise<{ boundary: string; complete: boolean }> {
  let current = path.resolve(cwd)
  for (;;) {
    try {
      if (await fsStat(path.join(current, ".git")) !== "missing") break
    } catch {
      return { boundary: current, complete: false }
    }
    const parent = path.dirname(current)
    if (parent === current) return { boundary: current, complete: true }
    current = parent
  }

  const sandbox = current
  const commonResult = await boundedGit(["rev-parse", "--git-common-dir"], sandbox)
  if (commonResult.status === "failed") return { boundary: sandbox, complete: true }
  if (commonResult.status !== "ready") return { boundary: sandbox, complete: false }
  const common = resolveGitPath(sandbox, commonResult.value)
  if (!common) return { boundary: sandbox, complete: false }
  if (common === sandbox) return { boundary: sandbox, complete: true }

  const bareResult = await boundedGit(["config", "--bool", "core.bare"], sandbox)
  if (bareResult.status === "timeout") return { boundary: sandbox, complete: false }
  const bare = bareResult.status === "ready" && bareResult.value.trim() === "true"
  return { boundary: bare ? common : path.dirname(common), complete: true }
}

function resolveGitPath(cwd: string, value: string): string | undefined {
  const trimmed = value.replace(/[\r\n]+$/, "")
  if (!trimmed || /[\0\r\n]/.test(trimmed)) return
  return path.normalize(path.isAbsolute(trimmed) ? trimmed : path.resolve(cwd, trimmed))
}

async function boundedGit(
  args: readonly string[],
  cwd: string,
): Promise<{ status: "ready"; value: string } | { status: "failed" | "timeout" }> {
  let process: ReturnType<typeof Bun.spawn>
  try {
    process = Bun.spawn({ cmd: ["git", ...args], cwd, stdin: "ignore", stdout: "pipe", stderr: "ignore" })
  } catch {
    return { status: "failed" }
  }
  if (!(process.stdout instanceof ReadableStream)) {
    process.kill()
    await process.exited.catch(() => undefined)
    return { status: "failed" }
  }
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    process.kill()
  }, GIT_TIMEOUT_MS)
  try {
    const value = await boundedStreamText(process.stdout, MAX_GIT_OUTPUT_BYTES)
    if (value === undefined) process.kill()
    const code = await process.exited
    if (timedOut) return { status: "timeout" }
    if (code !== 0 || value === undefined) return { status: "failed" }
    return { status: "ready", value }
  } catch {
    process.kill()
    await process.exited.catch(() => undefined)
    return { status: timedOut ? "timeout" : "failed" }
  } finally {
    clearTimeout(timeout)
  }
}

async function boundedStreamText(stream: ReadableStream<Uint8Array>, maximumBytes: number): Promise<string | undefined> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > maximumBytes) return
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  const output = new Uint8Array(size)
  let offset = 0
  for (let index = 0; index < chunks.length; index += 1) {
    output.set(chunks[index]!, offset)
    offset += chunks[index]!.byteLength
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(output)
  } catch {
    return
  }
}

async function managedConfigFiles(directory: string): Promise<{ ok: boolean; files: string[] }> {
  try {
    const stat = await fsStat(directory)
    if (stat === "missing") return { ok: true, files: [] }
    if (stat !== "directory") return { ok: false, files: [] }
    return {
      ok: true,
      files: [path.join(directory, "opencode.json"), path.join(directory, "opencode.jsonc")],
    }
  } catch {
    return { ok: false, files: [] }
  }
}

async function fsStat(file: string): Promise<"missing" | "directory" | "other"> {
  try {
    const stat = await import("node:fs/promises").then((module) => module.stat(file))
    return stat.isDirectory() ? "directory" : "other"
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing"
    throw error
  }
}

function validatedOpenCodeConfig(value: unknown): Record<string, unknown> | undefined {
  const config = jsonRecord(value)
  if (!config) return
  if ([config.theme, config.keybinds, config.tui].some((item) => containsConfigSubstitution(item, /\{file:[^}]+\}/))) {
    return
  }
  const normalized = { ...config }
  delete normalized.theme
  delete normalized.keybinds
  delete normalized.tui
  if (containsConfigSubstitution(normalized)) return
  if (!validateOpenCodeConfigSchema(normalized)) return
  const plugin = normalized.plugin
  if (plugin === undefined) return normalized
  if (!Array.isArray(plugin)) return
  for (let index = 0; index < plugin.length; index += 1) {
    const item = plugin[index]
    if (typeof item === "string") continue
    if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== "string" || !jsonRecord(item[1])) return
  }
  return normalized
}

function containsConfigSubstitution(value: unknown, pattern = /\{(?:env|file):[^}]+\}/): boolean {
  const pending: unknown[] = [value]
  while (pending.length > 0) {
    const current = pending.pop()
    if (typeof current === "string") {
      if (pattern.test(current)) return true
      continue
    }
    if (typeof current !== "object" || current === null) continue
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) pending.push(current[index])
      continue
    }
    for (const key of Object.keys(current)) {
      pending.push(key, (current as Record<string, unknown>)[key])
    }
  }
  return false
}

function validateAuthRecord(value: unknown): { value: Record<string, unknown>; complete: boolean } {
  const record = jsonRecord(value)
  if (!record) return { value: {}, complete: false }
  const output = Object.create(null) as Record<string, unknown>
  let complete = true
  for (const [providerID, item] of Object.entries(record)) {
    const parsed = AuthInfo.zod.safeParse(item)
    if (!parsed.success) {
      complete = false
      continue
    }
    output[providerID] = parsed.data
  }
  return { value: output, complete }
}

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return
  return value as Record<string, unknown>
}

function systemManagedConfigDir(): string {
  if (process.platform === "darwin") return "/Library/Application Support/opencode"
  if (process.platform === "win32") return path.join(process.env.ProgramData || "C:\\ProgramData", "opencode")
  return "/etc/opencode"
}

function managedPreferencesMayExist(): boolean {
  if (process.platform !== "darwin") return false
  const domain = "ai.opencode.managed.plist"
  const user = os.userInfo().username
  return [
    path.join("/Library/Managed Preferences", user, domain),
    path.join("/Library/Managed Preferences", domain),
  ].some((file) => existsSync(file))
}

function truthy(value: string | undefined): boolean {
  const normalized = value?.toLowerCase()
  return normalized === "true" || normalized === "1"
}

function activeRemoteAccountStatus(databasePath: string): boolean | undefined {
  if (!existsSync(databasePath)) return false
  try {
    using database = new Database(databasePath, { readonly: true, strict: true })
    const row = database
      .query("SELECT active_org_id FROM account_state WHERE id = ? LIMIT 1")
      .get(1) as { active_org_id?: unknown } | null
    return typeof row?.active_org_id === "string" && row.active_org_id.length > 0
  } catch {
    return undefined
  }
}

function containsWellKnownAuth(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return true
  for (const key of Object.keys(value)) {
    const item = (value as Record<string, unknown>)[key]
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue
    if ((item as Record<string, unknown>).type === "wellknown") return true
  }
  return false
}

async function boundedFile(
  file: string,
  max: number,
): Promise<{ status: "missing" } | { status: "failed"; value: string } | { status: "ready"; value: string }> {
  const handle = Bun.file(file)
  if (!(await handle.exists())) return { status: "missing" }
  if (handle.size > max) return { status: "failed", value: "" }
  try {
    const value = await handle.text()
    if (Buffer.byteLength(value, "utf8") > max) return { status: "failed", value: "" }
    return { status: "ready", value }
  } catch {
    return { status: "failed", value: "" }
  }
}

function strictJson(text: string, allowComments: boolean): { ok: true; value: unknown } | { ok: false } {
  const errors: ParseError[] = []
  const stack: Set<string>[] = []
  let duplicate = false
  visit(
    text,
    {
      onObjectBegin() {
        stack.push(new Set())
      },
      onObjectProperty(property) {
        const keys = stack[stack.length - 1]
        if (!keys || keys.has(property)) duplicate = true
        keys?.add(property)
      },
      onObjectEnd() {
        stack.pop()
      },
      onError(error, offset, length) {
        errors.push({ error, offset, length })
      },
    },
    { disallowComments: !allowComments, allowTrailingComma: allowComments, allowEmptyContent: false },
  )
  const value = parse(text, errors, {
    disallowComments: !allowComments,
    allowTrailingComma: allowComments,
    allowEmptyContent: false,
  })
  if (errors.length || duplicate || typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false }
  return { ok: true, value }
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (let index = 0; index < values.length; index += 1) {
    const value = path.resolve(values[index]!)
    if (seen.has(value)) continue
    seen.add(value)
    output.push(value)
  }
  return output
}

function uniqueLiteral(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!
    if (seen.has(value)) continue
    seen.add(value)
    output.push(value)
  }
  return output
}
