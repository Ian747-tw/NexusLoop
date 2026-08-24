import path from "node:path"
import os from "node:os"
import { existsSync } from "node:fs"
import { Database } from "bun:sqlite"
import { parse, visit, type ParseError } from "jsonc-parser"
import type { ExecutorReadinessSource } from "./executor-readiness"

const MAX_CONFIG_BYTES = 1024 * 1024
const MAX_AUTH_BYTES = 1024 * 1024
const MAX_FRAGMENTS = 64

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
  const configHome = options.configHome ?? options.env.XDG_CONFIG_HOME ?? path.join(home, ".config")
  const dataHome = options.dataHome ?? options.env.XDG_DATA_HOME ?? path.join(home, ".local", "share")
  const fragments: unknown[] = []
  let complete = true

  const projectConfigDisabled = truthy(environment.OPENCODE_DISABLE_PROJECT_CONFIG)
  const project = await discoverProjectBoundary(options.cwd)
  if (!project.complete) complete = false
  const configFiles = unique([
    path.join(configHome, "opencode", "config.json"),
    path.join(configHome, "opencode", "opencode.json"),
    path.join(configHome, "opencode", "opencode.jsonc"),
    ...(options.env.OPENCODE_CONFIG ? [options.env.OPENCODE_CONFIG] : []),
    ...(!projectConfigDisabled ? upwardProjectConfigFiles(options.cwd, project.boundary) : []),
    ...(!projectConfigDisabled ? upwardProjectDirectoryConfigFiles(options.cwd, project.boundary) : []),
    path.join(home, ".opencode", "opencode.json"),
    path.join(home, ".opencode", "opencode.jsonc"),
    ...(options.env.OPENCODE_CONFIG_DIR
      ? [
          path.join(options.env.OPENCODE_CONFIG_DIR, "opencode.json"),
          path.join(options.env.OPENCODE_CONFIG_DIR, "opencode.jsonc"),
        ]
      : []),
  ])

  for (let index = 0; index < configFiles.length && fragments.length < MAX_FRAGMENTS; index += 1) {
    const text = await boundedFile(configFiles[index]!, MAX_CONFIG_BYTES)
    if (text.status === "missing") continue
    if (text.status === "failed" || /\{(?:env|file):[^}]+\}/.test(text.value)) {
      complete = false
      continue
    }
    const parsed = strictJson(text.value, true)
    if (!parsed.ok) {
      complete = false
      continue
    }
    if (!validOpenCodeConfig(parsed.value)) {
      complete = false
      continue
    }
    fragments.push(parsed.value)
  }
  if (configFiles.length > MAX_FRAGMENTS) complete = false

  if (options.env.OPENCODE_CONFIG_CONTENT) {
    if (Buffer.byteLength(options.env.OPENCODE_CONFIG_CONTENT, "utf8") > MAX_CONFIG_BYTES) complete = false
    else {
      const parsed = strictJson(options.env.OPENCODE_CONFIG_CONTENT, true)
      if (parsed.ok && validOpenCodeConfig(parsed.value)) fragments.push(parsed.value)
      else complete = false
    }
  }

  const managedDir = options.managedConfigDir ?? environment.OPENCODE_TEST_MANAGED_CONFIG_DIR ?? systemManagedConfigDir()
  const managed = await managedConfigFiles(managedDir)
  if (!managed.ok) complete = false
  for (let index = 0; index < managed.files.length && fragments.length < MAX_FRAGMENTS; index += 1) {
    const text = await boundedFile(managed.files[index]!, MAX_CONFIG_BYTES)
    if (text.status === "missing") continue
    if (text.status === "failed") {
      complete = false
      continue
    }
    const parsed = strictJson(text.value, true)
    if (!parsed.ok || !validOpenCodeConfig(parsed.value)) {
      complete = false
      continue
    }
    fragments.push(parsed.value)
  }
  // The normal macOS path may add MDM preferences through plutil. The bounded
  // observer does not launch that subprocess, so a present profile is unknown.
  if (managedPreferencesMayExist()) complete = false

  if (options.env.OPENCODE_MODELS_PATH || options.env.OPENCODE_MODELS_URL) complete = false
  if (await hasPluginFiles(
    options.cwd,
    project.boundary,
    home,
    configHome,
    projectConfigDisabled,
    options.env.OPENCODE_CONFIG_DIR,
  )) {
    fragments.push({ plugin: ["present"] })
  }

  const authText = options.env.OPENCODE_AUTH_CONTENT
    ? { status: "ready" as const, value: options.env.OPENCODE_AUTH_CONTENT }
    : await boundedFile(path.join(dataHome, "opencode", "auth.json"), MAX_AUTH_BYTES)
  let auth: unknown = {}
  if (authText.status === "failed") complete = false
  if (authText.status === "ready") {
    const parsed = strictJson(authText.value, false)
    if (parsed.ok) {
      auth = parsed.value
      if (containsWellKnownAuth(parsed.value)) complete = false
    } else complete = false
  }

  const remoteAccount = activeRemoteAccountStatus(path.join(dataHome, "opencode", "opencode.db"))
  if (remoteAccount !== false) complete = false

  return Object.freeze({
    catalog: options.catalog,
    config_fragments: Object.freeze(fragments),
    auth,
    env: environment,
    observation_complete: complete,
  })
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
    path.join(directory, "opencode.jsonc"),
    path.join(directory, "opencode.json"),
  ])
}

function upwardProjectDirectoryConfigFiles(cwd: string, boundary: string): string[] {
  return upwardDirectories(cwd, boundary).flatMap((directory) => [
    path.join(directory, ".opencode", "opencode.json"),
    path.join(directory, ".opencode", "opencode.jsonc"),
  ])
}

async function hasPluginFiles(
  cwd: string,
  projectBoundary: string,
  home: string,
  configHome: string,
  projectConfigDisabled: boolean,
  explicitConfigDir?: string,
): Promise<boolean> {
  const dirs = [path.join(configHome, "opencode", "plugin"), path.join(configHome, "opencode", "plugins")]
  if (!projectConfigDisabled) {
    for (const current of upwardDirectories(cwd, projectBoundary)) {
      dirs.push(path.join(current, ".opencode", "plugin"), path.join(current, ".opencode", "plugins"))
    }
  }
  dirs.push(path.join(home, ".opencode", "plugin"), path.join(home, ".opencode", "plugins"))
  if (explicitConfigDir) dirs.push(path.join(explicitConfigDir, "plugin"), path.join(explicitConfigDir, "plugins"))
  for (let index = 0; index < dirs.length; index += 1) {
    try {
      for await (const _ of new Bun.Glob("*").scan({ cwd: dirs[index]!, onlyFiles: false })) return true
    } catch {}
  }
  return false
}

async function discoverProjectBoundary(cwd: string): Promise<{ boundary: string; complete: boolean }> {
  let current = path.resolve(cwd)
  for (;;) {
    try {
      if (await fsStat(path.join(current, ".git")) !== "missing") return { boundary: current, complete: true }
    } catch {
      return { boundary: current, complete: false }
    }
    const parent = path.dirname(current)
    if (parent === current) return { boundary: current, complete: true }
    current = parent
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

function validOpenCodeConfig(value: unknown): boolean {
  const config = jsonRecord(value)
  if (!config) return false
  const allowed = new Set([
    "$schema",
    "autoshare",
    "autoupdate",
    "default_agent",
    "disabled_providers",
    "enabled_providers",
    "model",
    "plugin",
    "provider",
    "share",
    "small_model",
    "snapshot",
    "username",
  ])
  if (Object.keys(config).some((key) => !allowed.has(key))) return false
  if (!optionalString(config.$schema) || !optionalString(config.default_agent) || !optionalString(config.model) ||
    !optionalString(config.small_model) || !optionalString(config.username)) return false
  if (!optionalBoolean(config.autoshare) || !optionalBoolean(config.snapshot)) return false
  if (config.autoupdate !== undefined && typeof config.autoupdate !== "boolean" && config.autoupdate !== "notify") return false
  if (config.share !== undefined && !["manual", "auto", "disabled"].includes(String(config.share))) return false
  if (!optionalStringArray(config.disabled_providers) || !optionalStringArray(config.enabled_providers)) return false
  if (!validPluginSpecs(config.plugin)) return false
  return validProviderConfigRecord(config.provider)
}

function validProviderConfigRecord(value: unknown): boolean {
  if (value === undefined) return true
  const providers = jsonRecord(value)
  if (!providers) return false
  for (const provider of Object.values(providers)) {
    const info = jsonRecord(provider)
    if (!info) return false
    const allowed = new Set(["api", "name", "env", "id", "npm", "whitelist", "blacklist", "options", "models"])
    if (Object.keys(info).some((key) => !allowed.has(key))) return false
    if (!optionalString(info.api) || !optionalString(info.name) || !optionalString(info.id) || !optionalString(info.npm)) return false
    if (!optionalStringArray(info.env) || !optionalStringArray(info.whitelist) || !optionalStringArray(info.blacklist)) return false
    if (info.options !== undefined && !jsonRecord(info.options)) return false
    if (!validConfiguredModels(info.models)) return false
  }
  return true
}

function validConfiguredModels(value: unknown): boolean {
  if (value === undefined) return true
  const models = jsonRecord(value)
  if (!models) return false
  const stringKeys = new Set(["id", "name", "family", "release_date"])
  const booleanKeys = new Set(["attachment", "reasoning", "temperature", "tool_call", "experimental"])
  const allowed = new Set([...stringKeys, ...booleanKeys, "status", "options", "headers"])
  for (const model of Object.values(models)) {
    const info = jsonRecord(model)
    if (!info || Object.keys(info).some((key) => !allowed.has(key))) return false
    for (const key of stringKeys) if (!optionalString(info[key])) return false
    for (const key of booleanKeys) if (!optionalBoolean(info[key])) return false
    if (info.status !== undefined && !["alpha", "beta", "deprecated"].includes(String(info.status))) return false
    if (info.options !== undefined && !jsonRecord(info.options)) return false
    const headers = info.headers === undefined ? undefined : jsonRecord(info.headers)
    if (info.headers !== undefined && (!headers || Object.values(headers).some((item) => typeof item !== "string"))) return false
  }
  return true
}

function validPluginSpecs(value: unknown): boolean {
  if (value === undefined) return true
  if (!Array.isArray(value)) return false
  for (const spec of value) {
    if (typeof spec === "string") continue
    if (!Array.isArray(spec) || spec.length !== 2 || typeof spec[0] !== "string" || !jsonRecord(spec[1])) return false
  }
  return true
}

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return
  return value as Record<string, unknown>
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string"
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean"
}

function optionalStringArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === "string"))
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
