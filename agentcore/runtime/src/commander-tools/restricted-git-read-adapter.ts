import { spawn } from "node:child_process"
import { realpath } from "node:fs/promises"
import { resolve } from "node:path"
import { redactText } from "../security/redaction"
import type { CommanderGitDiffResult, CommanderGitLogResult, CommanderGitStatusResult } from "./commander-read-types"
import { isDeniedRepositoryPath } from "./commander-repo-path-policy"

const TIMEOUT_MS = 2500
const MAX_STDOUT = 96_000
const SAFE_GIT_CONFIG_ARGS = [
  "-c", "core.fsmonitor=false",
  "-c", "core.fsmonitorHookVersion=0",
  "-c", "core.untrackedCache=false",
  "-c", "core.pager=cat",
  "-c", "pager.status=false",
  "-c", "pager.diff=false",
  "-c", "pager.log=false",
  "-c", "log.showSignature=false",
  "-c", "diff.external=",
] as const

export type RestrictedGitReadAdapterOptions = {
  projectDir: string
  timeoutMs?: number
  maxStdoutBytes?: number
}

export function restrictedGitReadEnv(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_NO_LAZY_FETCH: "1",
    GIT_PAGER: "cat",
    PAGER: "cat",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
  }
}

export function restrictedGitLogArgs(limit: number, path?: string): string[] {
  return ["log", `-${limit}`, "--no-show-signature", "--date=iso-strict", "--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s", ...(path ? ["--", path] : [])]
}

export class RestrictedGitReadAdapter {
  private readonly timeoutMs: number
  private readonly maxStdoutBytes: number

  constructor(private readonly options: RestrictedGitReadAdapterOptions) {
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS
    this.maxStdoutBytes = options.maxStdoutBytes ?? MAX_STDOUT
  }

  async status(): Promise<{ result: CommanderGitStatusResult; blockers: string[]; warnings: string[] }> {
    const verified = await this.verifyRoot()
    if (verified.error) return { result: emptyStatus(), blockers: [verified.error], warnings: [] }
    const [head, branch, porcelain] = await Promise.all([
      this.run(["rev-parse", "HEAD"]),
      this.run(["rev-parse", "--abbrev-ref", "HEAD"]),
      this.run(["status", "--porcelain=v1", "-z", "--untracked-files=normal"]),
    ])
    const blockers = [porcelain.error].filter((item): item is string => !!item)
    const parsed = parseStatus(porcelain.stdout, head.error ? "" : head.stdout.trim(), branch.error ? "HEAD" : branch.stdout.trim())
    const warnings = [...head.warnings, ...branch.warnings, ...porcelain.warnings]
    if (head.error || branch.error) warnings.push("Git HEAD is unborn; status metadata is limited")
    if (parsed.omittedSensitive > 0) warnings.push(`Suppressed ${parsed.omittedSensitive} sensitive Git status path(s)`)
    return { result: parsed.result, blockers, warnings }
  }

  async diff(input: Record<string, unknown> = {}): Promise<{ result: CommanderGitDiffResult; blockers: string[]; warnings: string[] }> {
    const verified = await this.verifyRoot()
    const scopeInput = readScope(input.scope)
    const scope = scopeInput.scope
    const context = clamp(input.contextLines ?? input.context_lines, 3, 0, 10)
    const statOnly = input.statOnly === true || input.stat_only === true || input.statOnly === "true" || input.stat_only === "true"
    const pathFilter = optionalPath(input.path)
    const path = pathFilter.path
    if (verified.error) return { result: { scope, files: [], stat_preview: "", truncated: false, output_bytes: 0 }, blockers: [verified.error], warnings: [] }
    if (scopeInput.error) return { result: { scope, files: [], stat_preview: "", truncated: false, output_bytes: 0 }, blockers: [scopeInput.error], warnings: [] }
    if (pathFilter.error) return { result: { scope, files: [], stat_preview: "", truncated: false, output_bytes: 0 }, blockers: [pathFilter.error], warnings: [] }
    if (path && isDeniedRepositoryPath(path)) return { result: { scope, files: [], path_filter: path, stat_preview: "", truncated: false, output_bytes: 0 }, blockers: ["sensitive Git diff path is denied"], warnings: [] }
    const baseArgs = scope === "staged" ? ["diff", "--cached"] : scope === "head" ? ["diff", "HEAD"] : ["diff"]
    const args = [...baseArgs, "--no-ext-diff", "--no-textconv", "--no-color", ...(statOnly ? ["--numstat"] : [`--unified=${context}`]), ...(path ? ["--", path] : [])]
    const [head, diff] = await Promise.all([this.run(["rev-parse", "HEAD"]), this.run(args)])
    const blockers = [scope === "head" ? head.error : undefined, diff.error].filter((item): item is string => !!item)
    const filtered = statOnly ? filterSensitiveStatLines(diff.stdout) : filterSensitiveDiffSections(diff.stdout)
    const patch = redactText(filtered.output).slice(0, 64_000)
    const warnings = [...head.warnings, ...diff.warnings]
    if (head.error && scope !== "head") warnings.push("Git HEAD is unborn; diff metadata is limited")
    if (filtered.omitted > 0) warnings.push(`Suppressed ${filtered.omitted} sensitive Git diff file(s) from patch output`)
    const result: CommanderGitDiffResult = {
      scope,
      head_sha: head.stdout.trim() || undefined,
      path_filter: path,
      files: (statOnly ? parseStatFiles(filtered.output) : parseDiffFiles(filtered.output)).slice(0, 80),
      stat_preview: statOnly ? patch : summarizeDiffStat(filtered.output),
      patch_preview: statOnly ? undefined : patch,
      truncated: diff.truncated || Buffer.byteLength(diff.stdout) > 64_000,
      output_bytes: Buffer.byteLength(patch),
    }
    return { result, blockers, warnings }
  }

  async log(input: Record<string, unknown> = {}): Promise<{ result: CommanderGitLogResult; blockers: string[]; warnings: string[] }> {
    const verified = await this.verifyRoot()
    const limit = clamp(input.limit, 10, 1, 50)
    const pathFilter = optionalPath(input.path)
    const path = pathFilter.path
    if (verified.error) return { result: { commits: [] }, blockers: [verified.error], warnings: [] }
    if (pathFilter.error) return { result: { commits: [] }, blockers: [pathFilter.error], warnings: [] }
    if (path && isDeniedRepositoryPath(path)) return { result: { commits: [] }, blockers: ["sensitive Git log path is denied"], warnings: [] }
    const args = restrictedGitLogArgs(limit, path)
    const output = await this.run(args)
    const commits = output.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const [commit_sha, short_sha, author_name, authored_at, subject] = line.split("\x1f")
      return { commit_sha, short_sha, author_name: redactText(author_name ?? ""), authored_at, subject_preview: redactText(subject ?? "").slice(0, 180) }
    })
    return { result: { commits }, blockers: output.error ? [output.error] : [], warnings: output.warnings }
  }

  private async verifyRoot(): Promise<{ error?: string }> {
    const projectRoot = resolve(this.options.projectDir)
    const git = await this.run(["rev-parse", "--show-toplevel"])
    if (git.error) return { error: "project is not a Git repository" }
    const actual = await realpath(git.stdout.trim()).catch(() => "")
    const expected = await realpath(projectRoot).catch(() => projectRoot)
    if (actual !== expected) return { error: "Git top-level does not match project root" }
    return {}
  }

  private run(args: string[]): Promise<{ stdout: string; stderr: string; error?: string; warnings: string[]; truncated: boolean }> {
    const warnings: string[] = []
    const projectRoot = resolve(this.options.projectDir)
    const env = restrictedGitReadEnv()
    return new Promise((resolvePromise) => {
      let stdout = Buffer.alloc(0)
      let stderr = Buffer.alloc(0)
      let settled = false
      let truncated = false
      const child = spawn("git", [...SAFE_GIT_CONFIG_ARGS, ...args], { cwd: projectRoot, shell: false, env })
      const finish = (error?: string) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolvePromise({ stdout: stdout.toString("utf8"), stderr: redactText(stderr.toString("utf8")).slice(0, 1200), error, warnings, truncated })
      }
      const timer = setTimeout(() => {
        warnings.push("Git read timed out and was terminated")
        try { child.kill("SIGTERM") } catch { /* noop */ }
        finish("Git read timed out")
      }, this.timeoutMs)
      child.stdout.on("data", (chunk: Buffer) => {
        stdout = Buffer.concat([stdout, chunk])
        if (stdout.byteLength > this.maxStdoutBytes) {
          truncated = true
          warnings.push("Git stdout exceeded output cap and was truncated")
          stdout = stdout.subarray(0, this.maxStdoutBytes)
          try { child.kill("SIGTERM") } catch { /* noop */ }
          finish(undefined)
        }
      })
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = Buffer.concat([stderr, chunk]).subarray(0, 4096)
      })
      child.on("error", (error) => finish(`Git read failed: ${redactText(error.message)}`))
      child.on("close", (code) => finish(code === 0 ? undefined : `Git read failed with exit code ${code}: ${redactText(stderr.toString("utf8")).slice(0, 240)}`))
    })
  }
}

function emptyStatus(): CommanderGitStatusResult {
  return { is_git_repository: false, detached_head: false, staged: [], unstaged: [], untracked: [], conflicted: [], counts: {}, truncated: false }
}

function parseStatus(output: string, head: string, branch: string): { result: CommanderGitStatusResult; omittedSensitive: number } {
  const staged: Array<{ path: string; status: string }> = []
  const unstaged: Array<{ path: string; status: string }> = []
  const untracked: string[] = []
  const conflicted: string[] = []
  const parts = output.split("\0").filter(Boolean)
  let omittedSensitive = 0
  let parsedEntries = 0
  let index = 0
  for (; index < parts.length && parsedEntries < 300; index += 1) {
    parsedEntries += 1
    const entry = parts[index]
    const status = entry.slice(0, 2)
    const path = entry.slice(3)
    let oldPath: string | undefined
    if ((status.includes("R") || status.includes("C")) && index + 1 < parts.length) {
      oldPath = parts[index + 1]
      index += 1
    }
    if (isDeniedRepositoryPath(path) || (oldPath && isDeniedRepositoryPath(oldPath))) {
      omittedSensitive += 1
      continue
    }
    if (status === "??") untracked.push(path)
    else if (isUnmergedStatus(status)) conflicted.push(path)
    else {
      if (status[0] !== " ") staged.push({ path, status: status[0] })
      if (status[1] !== " ") unstaged.push({ path, status: status[1] })
    }
  }
  return { result: {
    is_git_repository: true,
    branch: branch === "HEAD" ? undefined : branch,
    head_sha: head || undefined,
    detached_head: branch === "HEAD",
    staged,
    unstaged,
    untracked,
    conflicted,
    counts: { staged: staged.length, unstaged: unstaged.length, untracked: untracked.length, conflicted: conflicted.length },
    truncated: index < parts.length,
  }, omittedSensitive }
}

function parseDiffFiles(output: string): CommanderGitDiffResult["files"] {
  const files = new Map<string, { path: string; additions: number; deletions: number; binary: boolean }>()
  let current: string | undefined
  let pendingOldPath: string | undefined
  const ensureFile = (path: string) => {
    current = path
    if (!files.has(current)) files.set(current, { path: current, additions: 0, deletions: 0, binary: false })
  }
  for (const line of output.split(/\r?\n/)) {
    const header = line.match(/^diff --git a\/(.+) b\/(.+)$/)
    if (header) {
      ensureFile(header[2])
      pendingOldPath = header[1]
      continue
    }
    const file = line.match(/^\+\+\+ b\/(.+)/)
    if (file) {
      ensureFile(file[1])
      continue
    }
    if (line === "+++ /dev/null" && pendingOldPath) ensureFile(pendingOldPath)
    if (/^Binary files /.test(line) && current) files.get(current)!.binary = true
    if (current && line.startsWith("+") && !line.startsWith("+++")) files.get(current)!.additions += 1
    if (current && line.startsWith("-") && !line.startsWith("---")) files.get(current)!.deletions += 1
  }
  return [...files.values()]
}

function parseStatFiles(output: string): CommanderGitDiffResult["files"] {
  const files: CommanderGitDiffResult["files"] = []
  for (const line of output.split(/\r?\n/)) {
    const numeric = line.match(/^\s*(\d+|-)\s+(\d+|-)\s+(.+?)\s*$/)
    if (numeric) {
      const path = numeric[3].trim()
      if (!path || isDeniedStatPath(path)) continue
      files.push({
        path,
        additions: numeric[1] === "-" ? undefined : Number(numeric[1]),
        deletions: numeric[2] === "-" ? undefined : Number(numeric[2]),
        binary: numeric[1] === "-" && numeric[2] === "-",
      })
      continue
    }
    const match = line.match(/^\s*(.+?)\s+\|\s+(?:(\d+|-)\s+([+\-]+)?|Bin\b.*)\s*$/)
    if (!match) continue
    const path = match[1].trim()
    if (!path || isDeniedStatPath(path)) continue
    const markers = match[3] ?? ""
    files.push({
      path,
      additions: (markers.match(/\+/g) ?? []).length || undefined,
      deletions: (markers.match(/-/g) ?? []).length || undefined,
      binary: /\|\s+Bin\b/.test(line),
    })
  }
  return files
}

function filterSensitiveDiffSections(output: string): { output: string; omitted: number } {
  const kept: string[] = []
  let section: string[] = []
  let denySection = false
  let omitted = 0
  const flush = () => {
    if (section.length === 0) return
    if (denySection) omitted += 1
    else kept.push(...section)
    section = []
    denySection = false
  }
  for (const line of output.split(/\r?\n/)) {
    if (/^diff --git\s+"/.test(line)) {
      flush()
      section = [line]
      denySection = true
      continue
    }
    const header = line.match(/^diff --git a\/(.+) b\/(.+)$/)
    if (header) {
      flush()
      section = [line]
      denySection = isUnsafeDiffPath(header[1]) || isUnsafeDiffPath(header[2]) || isDeniedRepositoryPath(header[1]) || isDeniedRepositoryPath(header[2])
      continue
    }
    if (section.length > 0) {
      section.push(line)
      if (/^(?:\+\+\+|---)\s+"/.test(line)) denySection = true
      const newFile = line.match(/^\+\+\+ b\/(.+)/)
      const oldFile = line.match(/^--- a\/(.+)/)
      if (newFile && (isUnsafeDiffPath(newFile[1]) || isDeniedRepositoryPath(newFile[1]))) denySection = true
      if (oldFile && (isUnsafeDiffPath(oldFile[1]) || isDeniedRepositoryPath(oldFile[1]))) denySection = true
    } else {
      kept.push(line)
    }
  }
  flush()
  return { output: kept.join("\n"), omitted }
}

function isUnsafeDiffPath(path: string): boolean {
  return /[\x00-\x1f\x7f]/.test(path) || path.includes("\\")
}

function filterSensitiveStatLines(output: string): { output: string; omitted: number } {
  const kept: string[] = []
  let omitted = 0
  for (const line of output.split(/\r?\n/)) {
    const statPath = line.match(/^\s*(?:\d+|-)\s+(?:\d+|-)\s+(.+?)\s*$/)?.[1]?.trim()
      ?? line.match(/^\s*(.+?)\s+\|\s+(?:\d+|Bin\b)/)?.[1]?.trim()
    if (statPath && isDeniedStatPath(statPath)) {
      omitted += 1
      continue
    }
    kept.push(line)
  }
  return { output: kept.join("\n"), omitted }
}

function summarizeDiffStat(output: string): string {
  const files = parseDiffFiles(output)
  if (files.length === 0) return "no diff"
  return files.slice(0, 40).map((file) => `${file.path} +${file.additions}/-${file.deletions}${file.binary ? " binary" : ""}`).join("; ")
}

function isDeniedStatPath(path: string): boolean {
  if (isUnsafeDiffPath(path) || path.includes("\"")) return true
  if (isDeniedRepositoryPath(path)) return true
  if (!path.includes("=>")) return false
  const normalized = path.replace(/[{}]/g, "")
  return normalized.split("=>").some((part) => isDeniedRepositoryPath(part.trim()))
}

function readScope(value: unknown): { scope: "working_tree" | "staged" | "head"; error?: string } {
  if (value === undefined || value === null || value === "") return { scope: "working_tree" }
  if (value === "staged" || value === "head" || value === "working_tree") return { scope: value }
  return { scope: "working_tree", error: "Git diff scope is unsupported" }
}

function optionalPath(value: unknown): { path?: string; error?: string } {
  if (typeof value !== "string" || value.length === 0) return {}
  const path = value.length > 500 ? value.slice(0, 500) : value
  if (/[\x00-\x1f]/.test(path)) return { error: "Git path filter contains unsupported control characters" }
  if (path.startsWith(":")) return { error: "Git pathspec magic is not supported" }
  if (/[*?\[\]]/.test(path)) return { error: "Git wildcard path filters are not supported" }
  if (path.startsWith("/") || resolve(path) === path) return { error: "Git path filter must be project-relative" }
  if (path.split(/[\\/]+/).includes("..")) return { error: "Git path filter cannot escape the project root" }
  return { path }
}

function isUnmergedStatus(status: string): boolean {
  return status.includes("U") || status === "AA" || status === "DD"
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : undefined
  if (!parsed || !Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}
