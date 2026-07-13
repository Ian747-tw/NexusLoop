import { spawn } from "node:child_process"
import { realpath } from "node:fs/promises"
import { resolve } from "node:path"
import { redactText } from "../security/redaction"
import type { CommanderGitDiffResult, CommanderGitLogResult, CommanderGitStatusResult } from "./commander-read-types"

const TIMEOUT_MS = 2500
const MAX_STDOUT = 96_000

export type RestrictedGitReadAdapterOptions = {
  projectDir: string
  timeoutMs?: number
  maxStdoutBytes?: number
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
    const blockers = [head.error, branch.error, porcelain.error].filter((item): item is string => !!item)
    const result = parseStatus(porcelain.stdout, head.stdout.trim(), branch.stdout.trim())
    return { result, blockers, warnings: [...head.warnings, ...branch.warnings, ...porcelain.warnings] }
  }

  async diff(input: Record<string, unknown> = {}): Promise<{ result: CommanderGitDiffResult; blockers: string[]; warnings: string[] }> {
    const verified = await this.verifyRoot()
    const scope = readScope(input.scope)
    const context = clamp(input.contextLines ?? input.context_lines, 3, 0, 10)
    const statOnly = input.statOnly === true || input.stat_only === true || input.statOnly === "true" || input.stat_only === "true"
    const path = optionalPath(input.path)
    if (verified.error) return { result: { scope, files: [], stat_preview: "", truncated: false, output_bytes: 0 }, blockers: [verified.error], warnings: [] }
    const baseArgs = scope === "staged" ? ["diff", "--cached"] : scope === "head" ? ["diff", "HEAD"] : ["diff"]
    const args = [...baseArgs, "--no-ext-diff", "--no-textconv", "--no-color", `--unified=${context}`, ...(statOnly ? ["--stat"] : []), ...(path ? ["--", path] : [])]
    const [head, diff] = await Promise.all([this.run(["rev-parse", "HEAD"]), this.run(args)])
    const blockers = [head.error, diff.error].filter((item): item is string => !!item)
    const patch = redactText(diff.stdout).slice(0, 64_000)
    const result: CommanderGitDiffResult = {
      scope,
      head_sha: head.stdout.trim() || undefined,
      path_filter: path,
      files: parseDiffFiles(diff.stdout).slice(0, 80),
      stat_preview: statOnly ? patch : summarizeDiffStat(diff.stdout),
      patch_preview: statOnly ? undefined : patch,
      truncated: diff.truncated || Buffer.byteLength(diff.stdout) > 64_000,
      output_bytes: Buffer.byteLength(patch),
    }
    return { result, blockers, warnings: [...head.warnings, ...diff.warnings] }
  }

  async log(input: Record<string, unknown> = {}): Promise<{ result: CommanderGitLogResult; blockers: string[]; warnings: string[] }> {
    const verified = await this.verifyRoot()
    const limit = clamp(input.limit, 10, 1, 50)
    const path = optionalPath(input.path)
    if (verified.error) return { result: { commits: [] }, blockers: [verified.error], warnings: [] }
    const args = ["log", `-${limit}`, "--date=iso-strict", "--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s", ...(path ? ["--", path] : [])]
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
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_PAGER: "cat",
      PAGER: "cat",
      GIT_CONFIG_NOSYSTEM: "1",
    }
    return new Promise((resolvePromise) => {
      let stdout = Buffer.alloc(0)
      let stderr = Buffer.alloc(0)
      let settled = false
      let truncated = false
      const child = spawn("git", args, { cwd: projectRoot, shell: false, env })
      const finish = (error?: string) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolvePromise({ stdout: redactText(stdout.toString("utf8")), stderr: redactText(stderr.toString("utf8")).slice(0, 1200), error, warnings, truncated })
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

function parseStatus(output: string, head: string, branch: string): CommanderGitStatusResult {
  const staged: Array<{ path: string; status: string }> = []
  const unstaged: Array<{ path: string; status: string }> = []
  const untracked: string[] = []
  const conflicted: string[] = []
  const parts = output.split("\0").filter(Boolean)
  for (const entry of parts.slice(0, 300)) {
    const status = entry.slice(0, 2)
    const path = entry.slice(3)
    if (status === "??") untracked.push(path)
    else if (status.includes("U")) conflicted.push(path)
    else {
      if (status[0] !== " ") staged.push({ path, status: status[0] })
      if (status[1] !== " ") unstaged.push({ path, status: status[1] })
    }
  }
  return {
    is_git_repository: true,
    branch: branch === "HEAD" ? undefined : branch,
    head_sha: head || undefined,
    detached_head: branch === "HEAD",
    staged,
    unstaged,
    untracked,
    conflicted,
    counts: { staged: staged.length, unstaged: unstaged.length, untracked: untracked.length, conflicted: conflicted.length },
    truncated: parts.length > 300,
  }
}

function parseDiffFiles(output: string): CommanderGitDiffResult["files"] {
  const files = new Map<string, { path: string; additions: number; deletions: number; binary: boolean }>()
  let current: string | undefined
  for (const line of output.split(/\r?\n/)) {
    const file = line.match(/^\+\+\+ b\/(.+)/)
    if (file) {
      current = file[1]
      files.set(current, { path: current, additions: 0, deletions: 0, binary: false })
      continue
    }
    if (/^Binary files /.test(line) && current) files.get(current)!.binary = true
    if (current && line.startsWith("+") && !line.startsWith("+++")) files.get(current)!.additions += 1
    if (current && line.startsWith("-") && !line.startsWith("---")) files.get(current)!.deletions += 1
  }
  return [...files.values()]
}

function summarizeDiffStat(output: string): string {
  const files = parseDiffFiles(output)
  if (files.length === 0) return "no diff"
  return files.slice(0, 40).map((file) => `${file.path} +${file.additions}/-${file.deletions}${file.binary ? " binary" : ""}`).join("; ")
}

function readScope(value: unknown): "working_tree" | "staged" | "head" {
  if (value === "staged" || value === "head" || value === "working_tree") return value
  return "working_tree"
}

function optionalPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined
  if (value.includes("\0") || value.startsWith("/") || value.split(/[\\/]+/).includes("..")) return undefined
  return value
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : undefined
  if (!parsed || !Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}
