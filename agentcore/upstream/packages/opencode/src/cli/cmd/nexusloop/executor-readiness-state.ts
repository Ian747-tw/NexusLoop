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
}>

export async function loadExecutorReadinessSource(options: LoadOptions): Promise<ExecutorReadinessSource> {
  const environment = snapshotEnvironment(options.env)
  const home = environment.OPENCODE_TEST_HOME || os.homedir()
  const configHome = options.configHome ?? options.env.XDG_CONFIG_HOME ?? path.join(home, ".config")
  const dataHome = options.dataHome ?? options.env.XDG_DATA_HOME ?? path.join(home, ".local", "share")
  const fragments: unknown[] = []
  let complete = true

  const configFiles = unique([
    path.join(configHome, "opencode", "config.json"),
    path.join(configHome, "opencode", "opencode.json"),
    path.join(configHome, "opencode", "opencode.jsonc"),
    ...upwardConfigFiles(options.cwd),
    ...(options.env.OPENCODE_CONFIG ? [options.env.OPENCODE_CONFIG] : []),
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
    fragments.push(parsed.value)
  }
  if (configFiles.length > MAX_FRAGMENTS) complete = false

  if (options.env.OPENCODE_CONFIG_CONTENT) {
    if (Buffer.byteLength(options.env.OPENCODE_CONFIG_CONTENT, "utf8") > MAX_CONFIG_BYTES) complete = false
    else {
      const parsed = strictJson(options.env.OPENCODE_CONFIG_CONTENT, true)
      if (parsed.ok) fragments.push(parsed.value)
      else complete = false
    }
  }

  if (options.env.OPENCODE_MODELS_PATH || options.env.OPENCODE_MODELS_URL) complete = false
  if (await hasPluginFiles(options.cwd, configHome)) fragments.push({ plugin: ["present"] })

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

function upwardConfigFiles(cwd: string): string[] {
  const output: string[] = []
  let current = path.resolve(cwd)
  for (;;) {
    output.unshift(path.join(current, "opencode.jsonc"), path.join(current, "opencode.json"))
    output.unshift(path.join(current, ".opencode", "opencode.jsonc"), path.join(current, ".opencode", "opencode.json"))
    const parent = path.dirname(current)
    if (parent === current) return output
    current = parent
  }
}

async function hasPluginFiles(cwd: string, configHome: string): Promise<boolean> {
  const dirs = [path.join(configHome, "opencode", "plugin"), path.join(configHome, "opencode", "plugins")]
  let current = path.resolve(cwd)
  for (;;) {
    dirs.push(path.join(current, ".opencode", "plugin"), path.join(current, ".opencode", "plugins"))
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  for (let index = 0; index < dirs.length; index += 1) {
    try {
      for await (const _ of new Bun.Glob("*").scan({ cwd: dirs[index]!, onlyFiles: false })) return true
    } catch {}
  }
  return false
}

function activeRemoteAccountStatus(databasePath: string): boolean | undefined {
  if (!existsSync(databasePath)) return false
  try {
    using database = new Database(databasePath, { readonly: true, strict: true })
    const row = database
      .query("SELECT active_org_id FROM account_state WHERE id = ? LIMIT 1")
      .get("singleton") as { active_org_id?: unknown } | null
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
