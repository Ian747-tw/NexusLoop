import { createHash } from "node:crypto"
import { lstat, readFile } from "node:fs/promises"
import { relative, resolve, sep } from "node:path"
import type { ContextPacketCompilerService } from "../context/context-packet-compiler-service"
import type { ResearchNoveltyService } from "../research-memory/research-novelty-service"
import { redactText, redactValue } from "../security/redaction"
import type { OpenCodeSessionInstructionPackService } from "./opencode-session-instruction-pack-service"
import type { OpenCodeSessionInstructionPackFilePreview, OpenCodeSessionInstructionPackResult } from "./opencode-session-instruction-pack-types"
import type { OpenCodeSessionService } from "./opencode-session-service"
import type {
  OpenCodeLaunchReadinessCheck,
  OpenCodeLaunchReadinessCheckStatus,
  OpenCodeLaunchReadinessCommand,
  OpenCodeLaunchReadinessPreview,
  OpenCodeLaunchReadinessPreviewInput,
  OpenCodeLaunchReadinessSourceRef,
  OpenCodeLaunchReadinessStatus,
  OpenCodeLaunchReadinessSummary,
  OpenCodeLaunchReadinessSummaryInput,
  OpenCodeLaunchSurface,
} from "./opencode-launch-readiness-types"

const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]+$/
const MAX_FILE_READ_BYTES = 20_000
const FORBIDDEN_INCLUDED_PATTERNS = [
  /raw_logs\s*[:=]\s*included/i,
  /full\s+research\.db\s*[:=]\s*included/i,
  /full\s+event\s+log\s*[:=]\s*included/i,
  /tool\/mcp\s+schemas?\s*[:=]\s*included/i,
  /raw\s+provider\s+output\s*[:=]\s*included/i,
  /launch_command\s*[:=]/i,
  /process_id\s*[:=]/i,
]

export type OpenCodeLaunchReadinessServiceOptions = {
  projectDir: string
  opencodeSessionService: OpenCodeSessionService
  instructionPackService: OpenCodeSessionInstructionPackService
  contextPacketCompilerService: ContextPacketCompilerService
  researchNoveltyService: ResearchNoveltyService
  nativeLaunchSurface?: OpenCodeLaunchSurface
  now?: () => Date
}

export class OpenCodeLaunchReadinessService {
  private readonly now: () => Date

  constructor(private readonly options: OpenCodeLaunchReadinessServiceOptions) {
    this.now = options.now ?? (() => new Date())
  }

  async preview(input: OpenCodeLaunchReadinessPreviewInput = {}): Promise<OpenCodeLaunchReadinessPreview> {
    const generatedAt = this.now().toISOString()
    const sessionId = optional(input.session_id) ?? ""
    const requestedPackId = optional(input.pack_id)
    const blockers: string[] = []
    const warnings = new Set<string>([
      "launch readiness is advisory; it does not launch OpenCode, call providers, call MCPs, write files, or mutate missions",
    ])
    const checks: OpenCodeLaunchReadinessCheck[] = []
    if (!sessionId) blockers.push("session_id is required")
    if (sessionId && !isSafeSessionId(sessionId)) blockers.push("session_id contains unsafe path characters")

    const session = sessionId && isSafeSessionId(sessionId) ? await this.options.opencodeSessionService.get(sessionId) : null
    checks.push(check("session", "Planned session", session ? "pass" : "fail", session ? `planned session ${session.session_id}` : "planned session was not found", session ? [] : ["planned OpenCode session was not found"], [], session ? [ref("opencode_session", session.session_id, "planned session", session.title)] : []))
    if (sessionId && !session) blockers.push("planned OpenCode session was not found")
    if (session && session.status !== "planned") blockers.push("OpenCode session status must be planned for future launch readiness")
    if (session && !session.max_context_bytes) blockers.push("planned session is missing bounded max_context_bytes metadata")

    const packet = session ? await this.options.contextPacketCompilerService.preview({
      purpose: "opencode_executor_session",
      session_id: session.session_id,
      provider_kind: input.provider_kind,
      model_id: input.model_id,
      max_context_tokens: input.max_context_tokens,
      max_context_bytes: input.max_context_bytes,
    }) : null
    if (packet?.packet_status === "blocked") blockers.push(packet.blockers[0] ?? "context packet preview is blocked")
    checks.push(check("context_packet", "Context packet", packet && packet.packet_status !== "blocked" ? statusToCheck(packet.packet_status) : "fail", packet ? `${packet.packet_status} packet ${packet.packet_id}` : "context packet unavailable", packet?.packet_status === "blocked" ? packet.blockers : [], packet?.warnings ?? [], packet ? [ref("context_packet", packet.packet_id, "context packet", packet.redacted_summary_preview), ref("context_budget", packet.budget_id, "context budget", "session executor budget")] : []))

    const pack = session ? await this.resolvePack(session.session_id, requestedPackId) : null
    if (session && requestedPackId && !pack) blockers.push("explicit pack_id was not found")
    if (session && !requestedPackId && !pack) blockers.push("instruction pack is required before future launch readiness")
    if (pack && pack.session_id !== sessionId) blockers.push("instruction pack does not belong to requested session_id")
    const packPacketBlockers = pack && packet ? packPacketMismatchBlockers(pack, packet) : []
    blockers.push(...packPacketBlockers)
    checks.push(check("instruction_pack", "Instruction pack", pack ? "pass" : "fail", pack ? `instruction pack ${pack.pack_id}` : "instruction pack missing", pack ? [] : ["instruction pack is required before future launch readiness"], [], pack ? [ref("instruction_pack", pack.pack_id, "instruction pack", `pack for ${pack.session_id}`)] : []))
    if (pack && packet) {
      checks.push(check("instruction_pack_packet", "Instruction pack packet identity", packPacketBlockers.length === 0 ? "pass" : "fail", packPacketBlockers.length === 0 ? "instruction pack packet and budget match readiness inputs" : "instruction pack packet or budget does not match readiness inputs", packPacketBlockers, [], [
        ref("instruction_pack", pack.pack_id, "instruction pack", pack.packet_id ?? "missing packet id"),
        ref("context_packet", packet.packet_id, "readiness packet", packet.packet_hash),
        ref("context_budget", packet.budget_id, "readiness budget", "budget for requested readiness inputs"),
      ]))
    }

    const fileVerification = pack && session ? await this.verifyPackFiles(session.session_id, pack) : verificationUnavailable()
    blockers.push(...fileVerification.blockers)
    for (const warning of fileVerification.warnings) warnings.add(warning)
    checks.push(...fileVerification.checks)

    const novelty = input.include_research_memory === false || !session
      ? null
      : this.options.researchNoveltyService.preview({ question: session.objective, session_id: session.session_id, limit: 3 })
    if (novelty) {
      if (novelty.duplicate_risk === "high" || novelty.duplicate_risk === "medium") {
        warnings.add("similar prior work found; future launch should include Commander/human justification")
      }
      if (novelty.missing_memory_warning) warnings.add("research memory is empty or unavailable; readiness remains advisory")
      checks.push(check("research_novelty", "Research memory novelty", novelty.status === "blocked" ? "warn" : "warn", `duplicate risk ${novelty.duplicate_risk}`, [], novelty.warnings, [ref("novelty_preview", novelty.preview_id, "novelty preview", novelty.difference_summary_preview)]))
    }

    const surface = input.include_native_config === false ? "unknown" : this.options.nativeLaunchSurface ?? "process_adapter"
    checks.push(check("native_config", "Native OpenCode launch surface", surface === "unknown" ? "warn" : "pass", `future launch surface=${surface}; readiness does not spawn OpenCode`, [], surface === "unknown" ? ["native launch surface is unknown until Branch 9D"] : ["live OpenCode binary/provider credentials are not verified in readiness"], [ref("opencode_native_audit", "docs/OPENCODE_NATIVE_CONTEXT_COMPATIBILITY.md", "9B0 native audit", "static audit only")]))

    const checkBlockers = checks.flatMap((item) => item.blockers)
    const allBlockers = boundList(unique([...blockers, ...checkBlockers]))
    const status = readinessStatus(allBlockers, checks)
    const readinessHash = hash(stableJson({
      session_id: sessionId,
      pack_id: pack?.pack_id ?? requestedPackId,
      packet_id: packet?.packet_id,
      checks: checks.map((item) => [item.check_id, item.status, item.blockers]),
    }))
    return redactValue({
      preview_id: `opencode_launch_readiness_${readinessHash.slice(0, 16)}`,
      status,
      can_launch_in_future: status === "ready",
      launch_performed: false as const,
      session_id: sessionId,
      pack_id: pack?.pack_id ?? requestedPackId,
      packet_id: packet?.packet_id,
      budget_id: packet?.budget_id,
      source_kind: session?.source_kind,
      mission_id: session?.mission_id,
      proposal_id: session?.proposal_id,
      review_request_id: session?.review_request_id,
      apply_id: session?.apply_id,
      target_dir: pack?.target_dir,
      instruction_files_verified: fileVerification.instructionFilesVerified,
      manifest_verified: fileVerification.manifestVerified,
      config_verified: fileVerification.configVerified,
      context_packet_status: packet?.packet_status,
      context_budget_status: packet ? (packet.budget_summary.over_budget ? "warn" : "pass") : undefined,
      research_memory_status: novelty?.status,
      novelty_risk: novelty?.duplicate_risk,
      selected_launch_surface: surface,
      checks,
      blockers: allBlockers,
      warnings: boundList(unique([...Array.from(warnings), ...checks.flatMap((item) => item.warnings)])),
      recommended_commands: recommendedCommands(sessionId || "<session_id>", pack?.pack_id),
      generated_at: generatedAt,
      redacted_summary_preview: allBlockers[0] ?? `future launch readiness for ${sessionId}`,
      readiness_hash: readinessHash,
    })
  }

  async summary(input: OpenCodeLaunchReadinessSummaryInput = {}): Promise<OpenCodeLaunchReadinessSummary> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 50))
    const sessions = await this.options.opencodeSessionService.list({ status: "planned", limit })
    const previews = await Promise.all(sessions.map((session) => this.preview({ session_id: session.session_id, include_research_memory: false })))
    return {
      total_planned_sessions: sessions.length,
      ready_count: previews.filter((item) => item.status === "ready").length,
      blocked_count: previews.filter((item) => item.status === "blocked").length,
      partial_count: previews.filter((item) => item.status === "partial").length,
      generated_at: this.now().toISOString(),
    }
  }

  private async resolvePack(sessionId: string, packId?: string): Promise<OpenCodeSessionInstructionPackResult | null> {
    if (packId) return this.options.instructionPackService.get(packId)
    const records = await this.options.instructionPackService.list({ session_id: sessionId, status: "written", limit: 1 })
    const latest = records[0]
    return latest ? this.options.instructionPackService.get(latest.pack_id) : null
  }

  private async verifyPackFiles(sessionId: string, pack: OpenCodeSessionInstructionPackResult): Promise<FileVerification> {
    const blockers: string[] = []
    const warnings: string[] = []
    const checks: OpenCodeLaunchReadinessCheck[] = []
    const targetDir = targetDirFor(this.options.projectDir, sessionId)
    const targetPathBlocker = safeTargetDirBlocker(this.options.projectDir, targetDir)
    if (targetPathBlocker) blockers.push(targetPathBlocker)
    const packTarget = resolve(this.options.projectDir, pack.target_dir)
    if (relative(targetDir, packTarget).startsWith("..")) blockers.push("instruction pack target_dir does not match session directory")
    try {
      const targetStat = await lstat(targetDir)
      if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) blockers.push("instruction pack target directory is not a safe directory")
    } catch {
      blockers.push("instruction pack target directory is missing")
    }
    let filesVerified = true
    let manifestVerified = false
    let configVerified = false
    const fileContents = new Map<string, string>()
    for (const file of pack.files) {
      const filePath = resolve(targetDir, file.relative_path)
      const fileBlocker = safeFilePathBlocker(targetDir, file.relative_path, filePath)
      if (fileBlocker) {
        blockers.push(fileBlocker)
        filesVerified = false
        continue
      }
      try {
        const stat = await lstat(filePath)
        if (!stat.isFile()) {
          blockers.push(`generated file is missing or not a regular file: ${file.relative_path}`)
          filesVerified = false
          continue
        }
        if (stat.size > MAX_FILE_READ_BYTES) {
          blockers.push(`generated file exceeds readiness read cap: ${file.relative_path}`)
          filesVerified = false
          continue
        }
        const content = await readFile(filePath, "utf8")
        fileContents.set(file.relative_path, content)
        const actualHash = hash(content)
        if (actualHash !== file.sha256) {
          blockers.push(`generated file hash mismatch: ${file.relative_path}`)
          filesVerified = false
        }
        if (containsForbiddenIncludedContent(content)) {
          blockers.push(`generated file contains forbidden launch-readiness content: ${file.relative_path}`)
          filesVerified = false
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        blockers.push(code === "ENOENT" ? `generated file is missing: ${file.relative_path}` : `generated file could not be verified: ${file.relative_path}`)
        filesVerified = false
      }
    }
    const manifestFile = pack.files.find((file) => file.relative_path === "MANIFEST.json")
    if (manifestFile) {
      const manifestText = fileContents.get("MANIFEST.json")
      const manifestCheck = manifestText ? verifyManifest(manifestText, pack, manifestFile) : { ok: false, blockers: ["MANIFEST.json is missing"], warnings: [] }
      manifestVerified = manifestCheck.ok
      blockers.push(...manifestCheck.blockers)
      warnings.push(...manifestCheck.warnings)
    }
    const configFile = pack.files.find((file) => file.relative_path === "opencode-session-config.json")
    if (configFile) {
      const configText = fileContents.get("opencode-session-config.json")
      const configCheck = configText ? verifyConfig(configText, sessionId, this.options.projectDir, targetDir) : { ok: false, blockers: ["opencode-session-config.json is missing"], warnings: [] }
      configVerified = configCheck.ok
      blockers.push(...configCheck.blockers)
      warnings.push(...configCheck.warnings)
    }
    checks.push(check("filesystem", "Instruction files", filesVerified ? "pass" : "fail", filesVerified ? "all recorded files match event hashes" : "one or more files failed verification", blockers.filter((item) => item.includes("file") || item.includes("target")), [], [ref("filesystem", pack.target_dir, "session instruction directory", "bounded generated files")]))
    checks.push(check("manifest", "Manifest", manifestFile ? manifestVerified ? "pass" : "fail" : "warn", manifestFile ? "MANIFEST.json verified against pack metadata" : "MANIFEST.json was not included in pack", manifestFile && !manifestVerified ? blockers.filter((item) => item.includes("manifest") || item.includes("MANIFEST")) : [], warnings, [ref("instruction_pack", pack.pack_id, "manifest metadata", "bounded manifest check")]))
    checks.push(check("opencode_config", "Future launch config", configFile ? configVerified ? "pass" : "fail" : "warn", configFile ? "opencode-session-config.json verified with launch_ready=false" : "opencode-session-config.json was not included in pack", configFile && !configVerified ? blockers.filter((item) => item.includes("config") || item.includes("launch_ready") || item.includes("credential") || item.includes("launch command")) : [], [], [ref("instruction_pack", pack.pack_id, "future launch config", "config hint only")]))
    return {
      instructionFilesVerified: filesVerified && blockers.length === 0,
      manifestVerified,
      configVerified,
      blockers: boundList(blockers),
      warnings: boundList(warnings),
      checks,
    }
  }
}

export function readOpenCodeLaunchReadinessPreviewInput(value: unknown): OpenCodeLaunchReadinessPreviewInput {
  const input = isRecord(value) ? value : {}
  return {
    session_id: optional(input.sessionId ?? input.session_id ?? input.session),
    pack_id: optional(input.packId ?? input.pack_id ?? input.pack),
    provider_kind: optional(input.providerKind ?? input.provider_kind ?? input.provider),
    model_id: optional(input.modelId ?? input.model_id ?? input.model),
    max_context_tokens: optionalNumber(input.maxContextTokens ?? input.max_context_tokens),
    max_context_bytes: optionalNumber(input.maxContextBytes ?? input.max_context_bytes),
    include_research_memory: optionalBoolean(input.includeResearchMemory ?? input.include_research_memory),
    include_native_config: optionalBoolean(input.includeNativeConfig ?? input.include_native_config),
  }
}

export function readOpenCodeLaunchReadinessSummaryInput(value: unknown): OpenCodeLaunchReadinessSummaryInput {
  const input = isRecord(value) ? value : {}
  return { limit: optionalNumber(input.limit) }
}

type FileVerification = {
  instructionFilesVerified: boolean
  manifestVerified: boolean
  configVerified: boolean
  blockers: string[]
  warnings: string[]
  checks: OpenCodeLaunchReadinessCheck[]
}

function verificationUnavailable(): FileVerification {
  return { instructionFilesVerified: false, manifestVerified: false, configVerified: false, blockers: [], warnings: [], checks: [] }
}

function packPacketMismatchBlockers(pack: OpenCodeSessionInstructionPackResult, packet: { packet_id: string; packet_hash: string; budget_id: string }): string[] {
  const blockers: string[] = []
  if (!pack.packet_id || pack.packet_id !== packet.packet_id) blockers.push("instruction pack packet_id does not match readiness context packet")
  if (!pack.packet_hash || pack.packet_hash !== packet.packet_hash) blockers.push("instruction pack packet_hash does not match readiness context packet")
  if (!pack.budget_id || pack.budget_id !== packet.budget_id) blockers.push("instruction pack budget_id does not match readiness context budget")
  return blockers
}

function verifyManifest(text: string, pack: OpenCodeSessionInstructionPackResult, manifestFile: OpenCodeSessionInstructionPackFilePreview): { ok: boolean; blockers: string[]; warnings: string[] } {
  const blockers: string[] = []
  try {
    const manifest = JSON.parse(text) as Record<string, unknown>
    if (manifest.pack_id !== pack.pack_id) blockers.push("manifest pack_id does not match instruction pack event")
    if (manifest.session_id !== pack.session_id) blockers.push("manifest session_id does not match instruction pack event")
    if (manifest.packet_id !== pack.packet_id) blockers.push("manifest packet_id does not match instruction pack event")
    if (manifest.launch_ready !== false) blockers.push("manifest launch_ready must be false")
    if (manifest.generated_for_future_launch !== true) blockers.push("manifest generated_for_future_launch must be true")
    if (!Array.isArray(manifest.files)) blockers.push("manifest files must be an array")
    if (hash(text) !== manifestFile.sha256) blockers.push("manifest file hash does not match instruction pack event")
  } catch {
    blockers.push("manifest is not valid JSON")
  }
  return { ok: blockers.length === 0, blockers, warnings: [] }
}

function verifyConfig(text: string, sessionId: string, projectDir: string, targetDir: string): { ok: boolean; blockers: string[]; warnings: string[] } {
  const blockers: string[] = []
  try {
    const config = JSON.parse(text) as Record<string, unknown>
    if (config.launch_ready !== false) blockers.push("opencode-session-config launch_ready must remain false in 9C")
    if (config.generated_for_future_launch !== true) blockers.push("opencode-session-config generated_for_future_launch must be true")
    if (config.session_id !== sessionId) blockers.push("opencode-session-config session_id does not match readiness session")
    if ("launch_command" in config || "command" in config || "process_id" in config) blockers.push("opencode-session-config contains launch command or process metadata")
    if (hasCredentialKey(config)) blockers.push("opencode-session-config contains suspected credentials")
    const instructions = Array.isArray(config.instructions) ? config.instructions : []
    if (!Array.isArray(config.instructions)) blockers.push("opencode-session-config instructions must be an array")
    for (const instruction of instructions) {
      if (typeof instruction !== "string") {
        blockers.push("opencode-session-config instruction path is not a string")
        continue
      }
      const resolved = resolve(projectDir, instruction)
      const relativeToTarget = relative(targetDir, resolved)
      if (instruction.includes("..") || instruction.includes("\0") || relativeToTarget.startsWith("..") || relativeToTarget.split(sep).includes("..")) {
        blockers.push("opencode-session-config instruction path escapes the session target directory")
      }
    }
  } catch {
    blockers.push("opencode-session-config is not valid JSON")
  }
  return { ok: blockers.length === 0, blockers, warnings: [] }
}

function hasCredentialKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasCredentialKey)
  if (!isRecord(value)) return false
  return Object.entries(value).some(([key, item]) => /api[_-]?key|secret|token|credential|password/i.test(key) || hasCredentialKey(item))
}

function containsForbiddenIncludedContent(text: string): boolean {
  return FORBIDDEN_INCLUDED_PATTERNS.some((pattern) => pattern.test(text))
}

function targetDirFor(projectDir: string, sessionId: string): string {
  const root = resolve(projectDir, ".nxl", "opencode", "sessions")
  const target = resolve(root, sessionId)
  ensureChildPath(root, target)
  return target
}

function safeTargetDirBlocker(projectDir: string, targetDir: string): string | null {
  try {
    ensureChildPath(resolve(projectDir, ".nxl", "opencode", "sessions"), targetDir)
    return null
  } catch {
    return "instruction pack target directory escapes .nxl/opencode/sessions"
  }
}

function safeFilePathBlocker(targetDir: string, relativePath: string, filePath: string): string | null {
  if (relativePath.includes("..") || relativePath.includes("\0") || relativePath.startsWith("/") || relativePath.includes("\\")) return `generated file path is unsafe: ${relativePath}`
  try {
    ensureChildPath(targetDir, filePath)
    return null
  } catch {
    return `generated file path escapes session directory: ${relativePath}`
  }
}

function ensureChildPath(root: string, target: string): void {
  const rel = relative(resolve(root), resolve(target))
  if (rel === "" || rel.startsWith("..") || rel.split(sep).includes("..")) throw new Error("target path escapes root")
}

function isSafeSessionId(value: string): boolean {
  return value !== "." && SESSION_ID_PATTERN.test(value) && !value.includes("..") && !value.includes("/") && !value.includes("\\") && !value.includes("\0")
}

function readinessStatus(blockers: string[], checks: OpenCodeLaunchReadinessCheck[]): OpenCodeLaunchReadinessStatus {
  if (blockers.length > 0 || checks.some((item) => item.status === "fail")) return "blocked"
  if (checks.some((item) => item.status === "warn" || item.status === "unknown")) return "partial"
  return "ready"
}

function statusToCheck(status: string): OpenCodeLaunchReadinessCheckStatus {
  if (status === "ready") return "pass"
  if (status === "partial") return "warn"
  if (status === "blocked") return "fail"
  return "unknown"
}

function check(checkId: string, label: string, status: OpenCodeLaunchReadinessCheckStatus, summary: string, blockers: string[], warnings: string[], refs: OpenCodeLaunchReadinessSourceRef[]): OpenCodeLaunchReadinessCheck {
  return {
    check_id: checkId,
    label,
    status,
    summary_preview: bound(summary),
    blockers: boundList(blockers),
    warnings: boundList(warnings),
    source_refs: refs,
  }
}

function ref(source_kind: OpenCodeLaunchReadinessSourceRef["source_kind"], source_id: string, label?: string, summary?: string): OpenCodeLaunchReadinessSourceRef {
  return {
    source_kind,
    source_id: bound(source_id, 120),
    label: label ? bound(label, 80) : undefined,
    summary_preview: summary ? bound(summary) : undefined,
    pointer_only: true,
  }
}

function recommendedCommands(sessionId: string, packId?: string): OpenCodeLaunchReadinessCommand[] {
  const commands: OpenCodeLaunchReadinessCommand[] = [
    { label: "Launch readiness", command: `/opencode-launch-readiness session=${sessionId}${packId ? ` pack=${packId}` : ""}`, command_type: "read" },
    { label: "Instruction packs", command: `/opencode-session-instruction-packs session=${sessionId}`, command_type: "read" },
    { label: "Context packet", command: `/context-packet-preview purpose=opencode_executor_session session=${sessionId}`, command_type: "read" },
    { label: "Authority", command: "/authority-show /opencode-launch-readiness", command_type: "read" },
  ]
  return commands
}

function optional(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = bound(value.trim(), 240)
  return trimmed ? trimmed : undefined
}

function optionalNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : undefined
  return typeof number === "number" && Number.isFinite(number) ? Math.trunc(number) : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function boundList(items: string[]): string[] {
  return items.map((item) => bound(item)).filter(Boolean).slice(0, 16)
}

function bound(value: string, max = 280): string {
  const redacted = redactText(String(value))
  return redacted.length <= max ? redacted : `${redacted.slice(0, Math.max(0, max - 1))}…`
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)))
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableJson(value: unknown): string {
  return JSON.stringify(stable(value))
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
}
