import { createHash } from "node:crypto"
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve, sep } from "node:path"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type {
  OpenCodeContextRefreshFilePreview,
  OpenCodeContextRefreshPreview,
  OpenCodeContextRefreshRecord,
  OpenCodeContextRefreshResult,
  OpenCodeContextRefreshSummary,
  OpenCodeContextRefreshWriteInput,
} from "./opencode-context-refresh-types"
import type { OpenCodeContinuationPacket, OpenCodeContinuitySafetyFlags, OpenCodeSessionContinuityPacket } from "./opencode-session-continuity-types"
import { continuitySectionHash, type OpenCodeSessionContinuityService, type PreviousRefreshSnapshot } from "./opencode-session-continuity-service"

export const OPENCODE_CONTEXT_REFRESH_EVENT_KIND = "opencode_session_context_refresh_written"
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]+$/
const MAX_MARKDOWN_BYTES = 24 * 1024
const MAX_MANIFEST_BYTES = 24 * 1024
const MAX_TOTAL_BYTES = 64 * 1024

type GeneratedFile = OpenCodeContextRefreshFilePreview & { content: string }
type BuiltRefresh = { preview: OpenCodeContextRefreshPreview; packet: OpenCodeSessionContinuityPacket | OpenCodeContinuationPacket; files: GeneratedFile[] }

export type OpenCodeContextRefreshServiceOptions = {
  projectDir: string
  eventStore: EventStore
  continuityService: OpenCodeSessionContinuityService
  now?: () => Date
}

export class OpenCodeContextRefreshService {
  private readonly now: () => Date
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: OpenCodeContextRefreshServiceOptions) {
    this.now = options.now ?? (() => new Date())
  }

  async preview(input: OpenCodeContextRefreshWriteInput = {}): Promise<OpenCodeContextRefreshPreview> {
    return (await this.build(input)).preview
  }

  async write(input: OpenCodeContextRefreshWriteInput = {}): Promise<OpenCodeContextRefreshResult> {
    const built = await this.build(input)
    const writtenAt = this.now().toISOString()
    const writtenBy = bound(input.written_by ?? "operator")
    const refreshId = refreshIdFor(built.preview.refresh_hash)
    if (!built.preview.can_write) return blockedResult(built.preview, refreshId, writtenAt, writtenBy)
    const targetDir = absoluteTargetDir(this.options.projectDir, built.preview.target_session_id, refreshId)
    const preflight = await validateContextRefreshTarget(this.options.projectDir, targetDir)
    if (preflight) return { ...blockedResult(built.preview, refreshId, writtenAt, writtenBy), error: preflight }
    if (input.dry_run) return resultFromPreview(built.preview, refreshId, "dry_run", writtenAt, writtenBy)

    return this.serializeWrite(async () => {
      const rebuilt = await this.build(input)
      const rebuiltId = refreshIdFor(rebuilt.preview.refresh_hash)
      if (!rebuilt.preview.can_write) return blockedResult(rebuilt.preview, rebuiltId, writtenAt, writtenBy)
      if (rebuilt.packet.delta.previous_refresh_id && rebuilt.packet.delta.summary_preview === "no substantive continuity delta") {
        const unchanged = await this.get(rebuilt.packet.delta.previous_refresh_id)
        const previous = await this.previousSnapshot(rebuilt.packet.delta.previous_refresh_id)
        const reusableActiveRefresh = rebuilt.packet.packet_kind === "session_refresh"
          && rebuilt.packet.continuity_mode === "active_refresh"
          && unchanged?.packet_kind === "session_refresh"
          && unchanged.continuity_mode === "active_refresh"
          && unchanged.target_session_id === rebuilt.preview.target_session_id
          && unchanged.base_pack_hash === rebuilt.preview.base_pack_hash
          && previous?.budget_id === rebuilt.packet.budget.budget_id
        if (reusableActiveRefresh) {
          const previousTarget = absoluteTargetDir(this.options.projectDir, unchanged.target_session_id, unchanged.refresh_id)
          if (await eventFilesMatch(previousTarget, unchanged.files)) return unchanged
          return { ...blockedResult(rebuilt.preview, rebuiltId, writtenAt, writtenBy), error: "existing context-refresh event was found but files are missing or differ; artifact integrity repair is required" }
        }
      }
      const existing = await this.findExistingByHash(rebuilt.preview.target_session_id, rebuilt.preview.refresh_hash)
      const target = absoluteTargetDir(this.options.projectDir, rebuilt.preview.target_session_id, rebuiltId)
      if (existing) {
        if (await filesMatch(target, rebuilt.files)) return resultFromEvent(existing)
        return { ...blockedResult(rebuilt.preview, rebuiltId, writtenAt, writtenBy), error: "existing context-refresh event was found but files are missing or differ; artifact integrity repair is required" }
      }
      const targetError = await validateContextRefreshTarget(this.options.projectDir, target)
      if (targetError) return { ...blockedResult(rebuilt.preview, rebuiltId, writtenAt, writtenBy), error: targetError }
      await writeAtomically(this.options.projectDir, target, rebuilt.files)
      const packet = rebuilt.packet
      const event = redactValue({
        kind: OPENCODE_CONTEXT_REFRESH_EVENT_KIND,
        refresh_id: rebuiltId,
        status: "written",
        packet_id: packet.packet_id,
        packet_hash: packet.packet_hash,
        packet_kind: packet.packet_kind,
        continuity_mode: packet.continuity_mode,
        source_session_id: packet.packet_kind === "session_refresh" ? packet.source_session_id : packet.source_session_id,
        source_launch_id: packet.packet_kind === "session_refresh" ? packet.launch_id : packet.source_launch_id,
        source_native_session_id: packet.packet_kind === "session_refresh" ? packet.native_session_id : packet.source_native_session_id,
        target_session_id: rebuilt.preview.target_session_id,
        target_launch_id: packet.packet_kind === "continuation" ? packet.target_launch_id : packet.launch_id,
        checkpoint_id: packet.packet_kind === "continuation" ? packet.checkpoint_id : undefined,
        base_pack_id: rebuilt.preview.base_pack_id,
        base_pack_hash: rebuilt.preview.base_pack_hash,
        base_context_packet_id: packet.packet_kind === "session_refresh" ? packet.base_context_packet_id : undefined,
        base_context_packet_hash: packet.packet_kind === "session_refresh" ? packet.base_context_packet_hash : undefined,
        previous_refresh_id: rebuilt.preview.previous_refresh_id,
        previous_refresh_hash: packet.packet_kind === "session_refresh" ? packet.previous_refresh_hash : undefined,
        context_strategy: "immutable_base_plus_latest_snapshot_and_delta",
        delta_kind: packet.delta.delta_kind,
        delta_hash: packet.delta.delta_hash,
        changed_section_kinds: packet.delta.changed_section_kinds,
        source_refs: packet.source_refs.slice(0, 48),
        section_hashes: Object.fromEntries(packet.sections.map((item) => [item.section_kind, continuitySectionHash(item)])),
        omitted_sections: packet.budget.omitted_sections,
        files: rebuilt.files.map(({ file_kind, relative_path, size_bytes, sha256 }) => ({ file_kind, relative_path, size_bytes, sha256 })),
        total_size_bytes: rebuilt.preview.total_size_bytes,
        budget_id: packet.budget.budget_id,
        estimated_input_tokens: packet.budget.estimated_input_tokens,
        estimated_input_bytes: packet.budget.estimated_input_bytes,
        consumption_status: "not_delivered",
        ...safetyFlags(),
        written_at: writtenAt,
        written_by: writtenBy,
        refresh_hash: rebuilt.preview.refresh_hash,
        redaction_policy: "bounded executor-safe snapshot and delta; excludes raw OpenCode transcripts/logs, file contents, diffs, event history, Commander chat, provider output, credentials, and full research.db",
      }) as JsonlEvent
      event.estimated_input_tokens = packet.budget.estimated_input_tokens
      event.estimated_input_bytes = packet.budget.estimated_input_bytes
      await this.options.eventStore.append(event)
      return resultFromPreview(rebuilt.preview, rebuiltId, "written", writtenAt, writtenBy)
    })
  }

  async list(input: { limit?: number; session_id?: string; continuity_mode?: string } = {}): Promise<OpenCodeContextRefreshRecord[]> {
    const limit = clamp(input.limit, 20, 1, 100)
    return (await this.events())
      .filter((item) => !input.session_id || item.target_session_id === input.session_id)
      .filter((item) => !input.continuity_mode || item.continuity_mode === input.continuity_mode)
      .map((item, appendOrder) => ({ record: recordFromEvent(item), appendOrder }))
      .sort((a, b) => b.record.written_at.localeCompare(a.record.written_at) || b.appendOrder - a.appendOrder)
      .map((item) => item.record)
      .slice(0, limit)
  }

  async get(refreshId: string): Promise<OpenCodeContextRefreshResult | null> {
    const event = (await this.events()).reverse().find((item) => item.refresh_id === refreshId)
    return event ? resultFromEvent(event) : null
  }

  async latest(input: { session_id?: string } = {}): Promise<OpenCodeContextRefreshResult | null> {
    const record = (await this.list({ session_id: input.session_id, limit: 1 }))[0]
    return record ? this.get(record.refresh_id) : null
  }

  async summary(input: { limit?: number } = {}): Promise<OpenCodeContextRefreshSummary> {
    const all = (await this.events())
      .map((item, appendOrder) => ({ record: recordFromEvent(item), appendOrder }))
      .sort((a, b) => b.record.written_at.localeCompare(a.record.written_at) || b.appendOrder - a.appendOrder)
      .map((item) => item.record)
    return redactValue({
      total_refreshes: all.length,
      session_count: new Set(all.map((item) => item.target_session_id)).size,
      active_refresh_count: all.filter((item) => item.continuity_mode === "active_refresh").length,
      continue_same_session_count: all.filter((item) => item.continuity_mode === "continue_same_session").length,
      fork_from_session_count: all.filter((item) => item.continuity_mode === "fork_from_session").length,
      patch_session_count: all.filter((item) => item.continuity_mode === "patch_session").length,
      resume_from_checkpoint_count: all.filter((item) => item.continuity_mode === "resume_from_checkpoint").length,
      not_delivered_count: all.length,
      latest_refreshes: all.slice(0, clamp(input.limit, 10, 1, 50)),
      generated_at: this.now().toISOString(),
    })
  }

  async previousSnapshot(refreshId: string): Promise<PreviousRefreshSnapshot | null> {
    const event = (await this.events()).reverse().find((item) => item.refresh_id === refreshId)
    return event ? snapshotFromEvent(event) : null
  }

  async latestSnapshot(sessionId: string, continuityMode: string): Promise<PreviousRefreshSnapshot | null> {
    const event = (await this.events()).filter((item) => item.target_session_id === sessionId && item.continuity_mode === continuityMode).at(-1)
    return event ? snapshotFromEvent(event) : null
  }

  private async build(input: OpenCodeContextRefreshWriteInput): Promise<BuiltRefresh> {
    const packet = input.packet_kind === "continuation" || (input.continuity_mode && input.continuity_mode !== "active_refresh")
      ? await this.options.continuityService.continuation(input)
      : await this.options.continuityService.session(input)
    const sourceSession = packet.packet_kind === "session_refresh" ? packet.source_session_id : packet.source_session_id
    const targetSession = packet.packet_kind === "session_refresh" ? packet.target_session_id : (packet.target_session_id ?? packet.source_session_id)
    const blockers = [...packet.blockers]
    const warnings = [...packet.warnings, "context refresh is an immutable artifact only; future 9X must explicitly select and deliver it"]
    if (!SESSION_ID_PATTERN.test(targetSession)) blockers.push("target session ID contains unsafe path characters")
    if (packet.packet_kind === "continuation" && packet.continuity_mode === "fork_from_session" && !input.target_session_id) blockers.push("fork context-refresh write requires target_session_id")
    if (packet.packet_kind === "continuation" && packet.continuity_mode === "fork_from_session" && !packet.target_base_pack_id) blockers.push("fork target requires its own written base instruction pack")
    const refreshHash = hash(stableJson({ packet: packet.packet_hash, targetSession, previous: packet.delta.previous_refresh_id, delta: packet.delta.delta_hash, base: packet.packet_kind === "session_refresh" ? packet.base_pack_hash : packet.target_base_pack_hash ?? packet.base_pack_hash }))
    const refreshId = refreshIdFor(refreshHash)
    const targetDir = `.nxl/opencode/sessions/${targetSession}/context-refreshes/${refreshId}`
    const contents = buildContents(packet, refreshId)
    const files = contents.map((item) => filePreview(targetDir, item.kind, item.name, item.content, packet))
    const total = files.reduce((sum, item) => sum + item.size_bytes, 0)
    if (files.some((item) => item.file_kind === "manifest" ? item.size_bytes > MAX_MANIFEST_BYTES : item.size_bytes > MAX_MARKDOWN_BYTES)) blockers.push("one or more context-refresh files exceed the 24 KB per-file cap")
    if (total > MAX_TOTAL_BYTES) blockers.push("context refresh exceeds the 64 KB total cap")
    const canWrite = blockers.length === 0 && (packet.status === "ready" || packet.status === "partial")
    return { packet, files, preview: redactValue({
      preview_id: `opencode_refresh_preview_${refreshHash.slice(0, 20)}`,
      status: blockers.length ? "blocked" : packet.status === "partial" ? "partial" : "ready",
      can_write: canWrite,
      packet_kind: packet.packet_kind,
      continuity_mode: packet.continuity_mode,
      packet_id: packet.packet_id,
      packet_hash: packet.packet_hash,
      source_session_id: sourceSession,
      target_session_id: targetSession,
      launch_id: packet.packet_kind === "session_refresh" ? packet.launch_id : packet.source_launch_id,
      native_session_id: packet.packet_kind === "session_refresh" ? packet.native_session_id : packet.source_native_session_id,
      base_pack_id: packet.packet_kind === "session_refresh" ? packet.base_pack_id : packet.target_base_pack_id ?? packet.base_pack_id,
      base_pack_hash: packet.packet_kind === "session_refresh" ? packet.base_pack_hash : packet.target_base_pack_hash ?? packet.base_pack_hash,
      previous_refresh_id: packet.delta.previous_refresh_id,
      delta: packet.delta,
      target_dir: targetDir,
      files: files.map(({ content: _content, ...item }) => item),
      total_size_bytes: total,
      consumption_status: "not_delivered",
      blockers: unique(blockers), warnings: unique(warnings), recommended_commands: packet.recommended_commands,
      generated_at: this.now().toISOString(),
      redacted_summary_preview: blockers[0] ?? `Immutable context-refresh artifact preview for ${targetSession}; no delivery performed`,
      refresh_hash: refreshHash,
      ...safetyFlags(),
    }) as OpenCodeContextRefreshPreview }
  }

  private async events(): Promise<Record<string, any>[]> {
    return (await this.options.eventStore.readAll()).filter((item) => item.kind === OPENCODE_CONTEXT_REFRESH_EVENT_KIND) as Record<string, any>[]
  }
  private async findExistingByHash(sessionId: string, refreshHash: string) { return (await this.events()).find((item) => item.target_session_id === sessionId && item.refresh_hash === refreshHash) }
  private serializeWrite<T>(operation: () => Promise<T>): Promise<T> { const next = this.writeQueue.then(operation, operation); this.writeQueue = next.then(() => undefined, () => undefined); return next }
}

export function readOpenCodeContextRefreshWriteInput(value: unknown): OpenCodeContextRefreshWriteInput {
  const input = isRecord(value) ? value : {}
  return {
    session_id: optional(input.sessionId ?? input.session_id ?? input.session), launch_id: optional(input.launchId ?? input.launch_id ?? input.launch),
    source_session_id: optional(input.sourceSessionId ?? input.source_session_id ?? input.source_session), source_launch_id: optional(input.sourceLaunchId ?? input.source_launch_id ?? input.source_launch), target_session_id: optional(input.targetSessionId ?? input.target_session_id ?? input.target_session),
    packet_kind: input.packetKind === "continuation" || input.packet_kind === "continuation" ? "continuation" : undefined, continuity_mode: optional(input.continuityMode ?? input.continuity_mode ?? input.mode),
    continuation_reason: optional(input.continuationReason ?? input.continuation_reason ?? input.reason), patch_reason: optional(input.patchReason ?? input.patch_reason), fork_reason: optional(input.forkReason ?? input.fork_reason), checkpoint_id: optional(input.checkpointId ?? input.checkpoint_id ?? input.checkpoint), previous_refresh_id: optional(input.previousRefreshId ?? input.previousRefresh ?? input.previous_refresh_id ?? input.previous_refresh),
    preserve: readArray(input.preserve), discard: readArray(input.discard), objective_delta: optional(input.objectiveDelta ?? input.objective_delta), provider_kind: optional(input.providerKind ?? input.provider_kind ?? input.provider), model_id: optional(input.modelId ?? input.model_id ?? input.model), max_context_tokens: optionalNumber(input.maxContextTokens ?? input.max_context_tokens), max_context_bytes: optionalNumber(input.maxContextBytes ?? input.max_context_bytes), research_memory_mode: input.researchMemoryMode === "include" || input.research_memory_mode === "include" || input.research_memory === "include" ? "include" : input.researchMemoryMode === "omit" || input.research_memory_mode === "omit" || input.research_memory === "omit" ? "omit" : "auto", max_progress_items: optionalNumber(input.maxProgressItems ?? input.max_progress_items ?? input.max_progress), max_open_loops: optionalNumber(input.maxOpenLoops ?? input.max_open_loops), max_research_candidates: optionalNumber(input.maxResearchCandidates ?? input.max_research_candidates), dry_run: input.dryRun === true || input.dry_run === true, written_by: optional(input.writtenBy ?? input.written_by),
  }
}

function buildContents(packet: OpenCodeSessionContinuityPacket | OpenCodeContinuationPacket, refreshId: string) {
  const target = packet.packet_kind === "session_refresh" ? packet.target_session_id : packet.target_session_id ?? packet.source_session_id
  const basePack = packet.packet_kind === "session_refresh" ? packet.base_pack_id : packet.target_base_pack_id ?? packet.base_pack_id
  const context = [
    "# OpenCode Context Refresh", "", `Refresh: ${refreshId}`, `Packet: ${packet.packet_id}`, `Target session: ${target}`, `Mode: ${packet.continuity_mode}`, `Base pack: ${basePack ?? "missing"}`, `Context strategy: immutable_base_plus_latest_snapshot_and_delta`, `Consumption status: not_delivered`, "",
    "This immutable artifact is executor-safe context only. OpenCode has not consumed it; no prompt, native session action, process control, provider/MCP call, research.db write, or mission mutation occurred.", "",
    ...packet.sections.filter((item) => item.status === "included" || item.status === "pointer_only").flatMap((item) => [`## ${item.section_kind}`, "", item.summary_preview, "", ...item.source_refs.map((ref) => `- ${ref.source_kind}:${ref.source_id} (${ref.status ?? "unknown"})`), ""]),
    "## Explicit Omissions", "", "Raw transcripts, logs, file contents, diffs, event history, Commander chat, provider output, credentials, and full research.db are excluded.", "",
  ].join("\n")
  const delta = ["# Context Refresh Delta", "", `Previous refresh: ${packet.delta.previous_refresh_id ?? "none"}`, `Delta kind: ${packet.delta.delta_kind}`, `Delta hash: ${packet.delta.delta_hash}`, "", `Summary: ${packet.delta.summary_preview}`, "", "## Changed sections", ...packet.delta.changed_section_kinds.map((item) => `- ${item}`), "", "## New durable source IDs", ...deltaLines(packet.delta), ""].join("\n")
  const manifest = JSON.stringify({ refresh_id: refreshId, packet_id: packet.packet_id, packet_hash: packet.packet_hash, packet_kind: packet.packet_kind, continuity_mode: packet.continuity_mode, source_session_id: packet.source_session_id, target_session_id: target, base_pack_id: basePack, previous_refresh_id: packet.delta.previous_refresh_id, budget: packet.budget, source_refs: packet.source_refs.slice(0, 48), omitted_sections: packet.budget.omitted_sections, consumption_status: "not_delivered", ...safetyFlags(), redaction_policy: "bounded executor-safe snapshot and delta; raw content excluded" }, null, 2) + "\n"
  return [{ kind: "context_refresh" as const, name: "CONTEXT_REFRESH.md", content: context }, { kind: "delta" as const, name: "DELTA.md", content: delta }, { kind: "manifest" as const, name: "REFRESH_MANIFEST.json", content: manifest }]
}
function deltaLines(delta: any): string[] { return Object.entries(delta).filter(([key]) => key.startsWith("new_") && key.endsWith("_ids")).flatMap(([key, value]) => (value as string[]).map((id) => `- ${key}: ${id}`)) }
function filePreview(targetDir: string, kind: any, name: string, content: string, packet: OpenCodeSessionContinuityPacket | OpenCodeContinuationPacket): GeneratedFile { const size = Buffer.byteLength(content, "utf8"); return { file_kind: kind, relative_path: `${targetDir}/${name}`, size_bytes: size, sha256: hash(content), would_write: true, summary_preview: `${name} bounded ${kind} artifact (${size} bytes)`, section_kinds: packet.sections.map((item) => item.section_kind).slice(0, 20), source_ref_ids: packet.source_refs.map((item) => item.source_id).slice(0, 48), warnings: [], content } }
function resultFromPreview(preview: OpenCodeContextRefreshPreview, refreshId: string, status: "written" | "dry_run", writtenAt: string, writtenBy: string): OpenCodeContextRefreshResult { return redactValue({ refresh_id: refreshId, status, packet_id: preview.packet_id, packet_hash: preview.packet_hash, packet_kind: preview.packet_kind, continuity_mode: preview.continuity_mode, source_session_id: preview.source_session_id, target_session_id: preview.target_session_id, launch_id: preview.launch_id, native_session_id: preview.native_session_id, base_pack_id: preview.base_pack_id, base_pack_hash: preview.base_pack_hash, previous_refresh_id: preview.previous_refresh_id, delta: preview.delta, target_dir: preview.target_dir, files: preview.files.map((item) => ({ ...item, would_write: status === "written" })), total_size_bytes: preview.total_size_bytes, consumption_status: "not_delivered", written_at: writtenAt, written_by: writtenBy, refresh_hash: preview.refresh_hash, recommended_commands: preview.recommended_commands, ...safetyFlags() }) as OpenCodeContextRefreshResult }
function blockedResult(preview: OpenCodeContextRefreshPreview, refreshId: string, at: string, by: string): OpenCodeContextRefreshResult { return { ...resultFromPreview(preview, refreshId, "dry_run", at, by), status: "blocked", error: preview.blockers[0] ?? "context refresh is blocked" } }
function recordFromEvent(event: Record<string, any>): OpenCodeContextRefreshRecord { return redactValue({ refresh_id: event.refresh_id, packet_id: event.packet_id, packet_kind: event.packet_kind, continuity_mode: event.continuity_mode, source_session_id: event.source_session_id, target_session_id: event.target_session_id, launch_id: event.source_launch_id, native_session_id: event.source_native_session_id, base_pack_id: event.base_pack_id, previous_refresh_id: event.previous_refresh_id, status: "written", written_at: event.written_at, written_by: event.written_by, summary_preview: `context refresh ${event.refresh_id}; ${event.continuity_mode}; consumption_status=not_delivered`, refresh_hash: event.refresh_hash }) }
function resultFromEvent(event: Record<string, any>): OpenCodeContextRefreshResult { return redactValue({ refresh_id: event.refresh_id, status: "written", packet_id: event.packet_id, packet_hash: event.packet_hash, packet_kind: event.packet_kind, continuity_mode: event.continuity_mode, source_session_id: event.source_session_id, target_session_id: event.target_session_id, launch_id: event.source_launch_id, native_session_id: event.source_native_session_id, base_pack_id: event.base_pack_id, base_pack_hash: event.base_pack_hash, previous_refresh_id: event.previous_refresh_id, delta: { delta_kind: event.delta_kind, previous_refresh_id: event.previous_refresh_id, previous_packet_hash: event.previous_packet_hash, changed_section_kinds: event.changed_section_kinds ?? [], new_progress_ids: [], new_question_ids: [], new_guidance_ids: [], new_delivery_ids: [], new_human_control_ids: [], new_watchdog_ids: [], new_wake_execution_ids: [], new_wake_action_ids: [], new_result_report_ids: [], new_result_review_ids: [], new_research_ingestion_ids: [], new_research_memory_ids: [], summary_preview: event.delta_kind === "initial_snapshot" ? "initial bounded tactical snapshot" : "bounded incremental delta", delta_hash: event.delta_hash }, target_dir: dirname(String(event.files?.[0]?.relative_path ?? "")), files: (event.files ?? []).map((item: any) => ({ ...item, would_write: false, summary_preview: `${item.file_kind} artifact`, section_kinds: [], source_ref_ids: [], warnings: [] })), total_size_bytes: event.total_size_bytes, consumption_status: "not_delivered", written_at: event.written_at, written_by: event.written_by, refresh_hash: event.refresh_hash, recommended_commands: [{ label: "Show refresh", command: `/opencode-context-refresh-show ${event.refresh_id}`, command_type: "read" }], ...safetyFlags() }) as OpenCodeContextRefreshResult }
function snapshotFromEvent(event: Record<string, any>): PreviousRefreshSnapshot { return { refresh_id: event.refresh_id, packet_hash: event.packet_hash, refresh_hash: event.refresh_hash, target_session_id: event.target_session_id, continuity_mode: event.continuity_mode, source_refs: (event.source_refs ?? []).slice(0, 48), section_hashes: event.section_hashes, base_pack_hash: event.base_pack_hash, budget_id: event.budget_id } }
export async function validateContextRefreshTarget(projectDir: string, target: string): Promise<string | undefined> {
  const projectRoot = resolve(projectDir)
  const root = join(projectRoot, ".nxl", "opencode", "sessions")
  const resolved = resolve(target)
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) return "context-refresh path escapes project session directory"
  const components = [join(projectRoot, ".nxl"), join(projectRoot, ".nxl", "opencode"), root]
  let current = root
  for (const part of relative(root, resolved).split(sep).filter(Boolean)) {
    current = join(current, part)
    components.push(current)
  }
  for (const component of components) {
    try {
      if ((await lstat(component)).isSymbolicLink()) return "context-refresh target contains a symlink component"
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
}
async function writeAtomically(projectDir: string, target: string, files: GeneratedFile[]) { await mkdir(dirname(target), { recursive: true }); const temp = `${target}.tmp-${process.pid}-${Date.now()}`; await mkdir(temp, { recursive: false }); try { for (const file of files) await writeFile(join(temp, file.relative_path.split("/").pop()!), file.content, { encoding: "utf8", flag: "wx" }); await rename(temp, target) } catch (error) { await rm(temp, { recursive: true, force: true }); throw error } }
async function filesMatch(target: string, files: GeneratedFile[]) { try { for (const file of files) if (hash(await readFile(join(target, file.relative_path.split("/").pop()!), "utf8")) !== file.sha256) return false; return true } catch { return false } }
async function eventFilesMatch(target: string, files: OpenCodeContextRefreshFilePreview[]) {
  const expectedNames = new Set(["CONTEXT_REFRESH.md", "DELTA.md", "REFRESH_MANIFEST.json"])
  if (files.length !== expectedNames.size) return false
  try {
    for (const file of files) {
      const name = file.relative_path.split("/").pop()
      if (!name || !expectedNames.delete(name) || hash(await readFile(join(target, name), "utf8")) !== file.sha256) return false
    }
    return expectedNames.size === 0
  } catch {
    return false
  }
}
function absoluteTargetDir(projectDir: string, sessionId: string, refreshId: string) { return join(projectDir, ".nxl", "opencode", "sessions", sessionId, "context-refreshes", refreshId) }
function refreshIdFor(refreshHash: string) { return `opencode_refresh_${refreshHash.slice(0, 24)}` }
function safetyFlags(): OpenCodeContinuitySafetyFlags { return { delivery_performed: false, opencode_prompt_sent: false, native_session_action_performed: false, process_control_performed: false, session_state_mutated: false, mission_mutated: false, provider_called: false, mcp_called: false, research_db_written: false } }
function clamp(value: unknown, fallback: number, min: number, max: number) { return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback }
function bound(value: string, max = 360) { const redacted = redactText(String(value ?? "").trim()); return redacted.length > max ? `${redacted.slice(0, max - 1)}…` : redacted }
function unique<T>(items: T[]): T[] { return [...new Set(items)] }
function hash(value: string) { return createHash("sha256").update(value).digest("hex") }
function stableJson(value: unknown): string { return JSON.stringify(sortValue(value)) }
function sortValue(value: unknown): unknown { if (Array.isArray(value)) return value.map(sortValue); if (!value || typeof value !== "object") return value; return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortValue(item)])) }
function isRecord(value: unknown): value is Record<string, any> { return Boolean(value) && typeof value === "object" && !Array.isArray(value) }
function optional(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? bound(value.trim()) : undefined }
function optionalNumber(value: unknown): number | undefined { if (typeof value === "number" && Number.isFinite(value)) return value; if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value); return undefined }
function readArray(value: unknown): string[] | undefined { if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").map((item) => bound(item)).filter(Boolean).slice(0, 12); if (typeof value === "string") return value.split(",").map((item) => bound(item)).filter(Boolean).slice(0, 12); return undefined }
