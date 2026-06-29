import { createHash } from "node:crypto"
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve, sep } from "node:path"
import type { ContextPacketCompilerService } from "../context/context-packet-compiler-service"
import type { ContextPacketPreview, ContextPacketSection, ContextPacketSourceRef } from "../context/context-packet-types"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { OpenCodeSessionService } from "./opencode-session-service"
import type { OpenCodeSessionPlan } from "./opencode-session-types"
import type {
  OpenCodeSessionInstructionPackCommand,
  OpenCodeSessionInstructionPackFileKind,
  OpenCodeSessionInstructionPackFilePreview,
  OpenCodeSessionInstructionPackManifest,
  OpenCodeSessionInstructionPackPreview,
  OpenCodeSessionInstructionPackPreviewInput,
  OpenCodeSessionInstructionPackRecord,
  OpenCodeSessionInstructionPackResult,
  OpenCodeSessionInstructionPackWriteInput,
} from "./opencode-session-instruction-pack-types"

const MAX_TEXT = 280
const MAX_FILE_BYTES = 16_000
const MAX_TOTAL_BYTES = 64_000
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]+$/
const GENERATED_FILE_PATHS = [
  "TASK.md",
  "CONTEXT.md",
  "GUIDANCE.md",
  "SESSION_MEMORY.md",
  "POLICY.md",
  "MANIFEST.json",
  "opencode-session-config.json",
]

export type OpenCodeSessionInstructionPackServiceOptions = {
  projectDir: string
  eventStore: EventStore
  opencodeSessionService: OpenCodeSessionService
  contextPacketCompilerService: ContextPacketCompilerService
  now?: () => Date
}

type GeneratedFile = OpenCodeSessionInstructionPackFilePreview & {
  content: string
}

type BuiltPack = {
  preview: OpenCodeSessionInstructionPackPreview
  files: GeneratedFile[]
}

export class OpenCodeSessionInstructionPackService {
  private readonly now: () => Date
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: OpenCodeSessionInstructionPackServiceOptions) {
    this.now = options.now ?? (() => new Date())
  }

  async preview(input: OpenCodeSessionInstructionPackPreviewInput = {}): Promise<OpenCodeSessionInstructionPackPreview> {
    return (await this.build(input)).preview
  }

  async write(input: OpenCodeSessionInstructionPackWriteInput = {}): Promise<OpenCodeSessionInstructionPackResult> {
    const built = await this.build(input)
    const writtenAt = this.now().toISOString()
    const writtenBy = bound(input.written_by ?? "operator")
    const packId = packIdFor(built.preview.pack_hash)
    if (!built.preview.can_write) return blockedResult(built.preview, writtenAt, writtenBy)
    const targetDir = targetDirFor(this.options.projectDir, built.preview.session_id)
    const preflightError = await validateTargetForPack(this.options.projectDir, targetDir, built.files)
    if (preflightError) {
      return {
        ...blockedResult(built.preview, writtenAt, writtenBy),
        error: preflightError,
      }
    }
    if (input.dry_run === true) {
      return redactValue({
        pack_id: packId,
        status: "dry_run",
        session_id: built.preview.session_id,
        packet_id: built.preview.packet_id,
        packet_hash: built.preview.packet_hash,
        budget_id: built.preview.budget_id,
        target_dir: built.preview.target_dir,
        files: built.preview.files.map((file) => ({ ...file, would_write: false })),
        total_size_bytes: built.preview.total_size_bytes,
        written_at: writtenAt,
        written_by: writtenBy,
        pack_hash: built.preview.pack_hash,
        recommended_commands: built.preview.recommended_commands,
      })
    }

    return this.serializeWrite(async () => {
      const rebuilt = await this.build(input)
      const rebuiltPackId = packIdFor(rebuilt.preview.pack_hash)
      if (!rebuilt.preview.can_write) return blockedResult(rebuilt.preview, writtenAt, writtenBy)
      const targetDir = targetDirFor(this.options.projectDir, rebuilt.preview.session_id)
      const existing = await this.findExisting(rebuilt.preview.pack_hash)
      if (existing) {
        const existingPreflightError = await validateTargetForPack(this.options.projectDir, targetDir, rebuilt.files)
        if (existingPreflightError) {
          return {
            ...blockedResult(rebuilt.preview, writtenAt, writtenBy),
            error: existingPreflightError,
          }
        }
        const matchingFiles = await existingFilesMatch(targetDir, rebuilt.files)
        if (matchingFiles) {
          return redactValue({
            pack_id: existing.pack_id,
            status: "written",
            session_id: rebuilt.preview.session_id,
            packet_id: rebuilt.preview.packet_id,
            packet_hash: rebuilt.preview.packet_hash,
            budget_id: rebuilt.preview.budget_id,
            target_dir: rebuilt.preview.target_dir,
            files: rebuilt.preview.files.map((file) => ({ ...file, would_write: false })),
            total_size_bytes: rebuilt.preview.total_size_bytes,
            written_at: existing.written_at,
            written_by: writtenBy,
            pack_hash: rebuilt.preview.pack_hash,
            recommended_commands: rebuilt.preview.recommended_commands,
          })
        }
        return {
          ...blockedResult(rebuilt.preview, writtenAt, writtenBy),
          error: "existing instruction pack event was found but files differ; inspect target directory before rewriting",
        }
      }
      const rebuiltPreflightError = await validateTargetForPack(this.options.projectDir, targetDir, rebuilt.files)
      if (rebuiltPreflightError) {
        return {
          ...blockedResult(rebuilt.preview, writtenAt, writtenBy),
          error: rebuiltPreflightError,
        }
      }
      await writeFilesAtomically(this.options.projectDir, targetDir, rebuilt.files)
      await this.options.eventStore.append(redactValue({
        kind: "opencode_session_instruction_pack_written",
        pack_id: rebuiltPackId,
        status: "written",
        session_id: rebuilt.preview.session_id,
        packet_id: rebuilt.preview.packet_id,
        packet_hash: rebuilt.preview.packet_hash,
        budget_id: rebuilt.preview.budget_id,
        target_dir: rebuilt.preview.target_dir,
        files: rebuilt.preview.files.map((file) => ({
          file_kind: file.file_kind,
          relative_path: file.relative_path,
          size_bytes: file.size_bytes,
          sha256: file.sha256,
        })),
        total_size_bytes: rebuilt.preview.total_size_bytes,
        written_at: writtenAt,
        written_by: writtenBy,
        pack_hash: rebuilt.preview.pack_hash,
        source_refs_summary: rebuilt.preview.redacted_summary_preview,
        omitted_refs_summary: "omitted refs are stored in MANIFEST.json as bounded pointers only",
        redaction_policy: "bounded NexusLoop-generated session instruction pack; raw logs, full research.db, full event log, raw provider output, and Commander chat are excluded",
        launch_ready: false,
      }) as JsonlEvent)
      return redactValue({
        pack_id: rebuiltPackId,
        status: "written",
        session_id: rebuilt.preview.session_id,
        packet_id: rebuilt.preview.packet_id,
        packet_hash: rebuilt.preview.packet_hash,
        budget_id: rebuilt.preview.budget_id,
        target_dir: rebuilt.preview.target_dir,
        files: rebuilt.preview.files,
        total_size_bytes: rebuilt.preview.total_size_bytes,
        written_at: writtenAt,
        written_by: writtenBy,
        pack_hash: rebuilt.preview.pack_hash,
        recommended_commands: rebuilt.preview.recommended_commands,
      })
    })
  }

  async list(input: { limit?: number; session_id?: string; status?: string } = {}): Promise<OpenCodeSessionInstructionPackRecord[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100))
    return redactValue((await this.records())
      .filter((item) => !input.session_id || item.session_id === input.session_id)
      .filter((item) => !input.status || item.status === input.status)
      .sort((left, right) => right.written_at.localeCompare(left.written_at))
      .slice(0, limit))
  }

  async get(packId: string): Promise<OpenCodeSessionInstructionPackResult | null> {
    const safeId = required(packId, "pack_id")
    const event = (await this.options.eventStore.readAll())
      .filter((item) => item.kind === "opencode_session_instruction_pack_written")
      .reverse()
      .find((item) => item.pack_id === safeId)
    if (!event) return null
    return resultFromEvent(event)
  }

  private async build(input: OpenCodeSessionInstructionPackPreviewInput): Promise<BuiltPack> {
    const generatedAt = this.now().toISOString()
    const sessionId = optional(input.session_id) ?? ""
    const blockers: string[] = []
    const warnings = [
      "instruction-pack preview does not launch OpenCode, call providers, query research.db, call MCPs, or mutate missions",
    ]
    if (!sessionId) blockers.push("session_id is required")
    const safeSessionId = sessionId ? isSafeSessionId(sessionId) : false
    if (sessionId && !safeSessionId) blockers.push("session_id contains unsafe path characters")
    const session = sessionId && safeSessionId ? await this.options.opencodeSessionService.get(sessionId) : null
    if (sessionId && !session) blockers.push("planned OpenCode session was not found")
    const packet = session ? await this.options.contextPacketCompilerService.preview({
      purpose: "opencode_executor_session",
      session_id: sessionId,
      provider_kind: input.provider_kind,
      model_id: input.model_id,
      max_context_tokens: input.max_context_tokens,
      max_context_bytes: input.max_context_bytes,
    }) : null
    if (packet?.packet_status === "blocked") blockers.push(packet.blockers[0] ?? "context packet preview is blocked")
    if (packet?.can_compile_final_prompt !== false) blockers.push("context packet preview must remain non-executable")
    if (packet && packet.sections.some((section) => section.section === "raw_logs" && section.status === "included")) blockers.push("context packet includes raw_logs")
    if (packet && packet.sections.some((section) => section.section === "tool_or_mcp_schema" && section.status === "included")) blockers.push("context packet includes tool/MCP schemas")
    const targetDir = sessionId && safeSessionId ? relativeProjectPath(targetDirFor(this.options.projectDir, sessionId), this.options.projectDir) : ".nxl/opencode/sessions/<session_id>"
    const files = session && packet
      ? buildFiles(session, packet, targetDir, {
        includeManifest: input.include_manifest !== false,
        includeOpenCodeConfig: input.include_opencode_config !== false,
        generatedAt: session.created_at,
      })
      : []
    const totalSize = files.reduce((sum, file) => sum + file.size_bytes, 0)
    if (files.some((file) => file.size_bytes > MAX_FILE_BYTES)) blockers.push("one or more instruction-pack files exceed the per-file size cap")
    if (totalSize > MAX_TOTAL_BYTES) blockers.push("instruction pack exceeds total size cap")
    const packHash = hash(stableJson({
      session_id: sessionId,
      packet_hash: packet?.packet_hash,
      include_manifest: input.include_manifest !== false,
      include_opencode_config: input.include_opencode_config !== false,
      files: files.filter((file) => file.file_kind !== "manifest").map((file) => [file.relative_path, file.sha256]),
    }))
    const status = blockers.length > 0 ? "blocked" : "ready"
    const previewResult: OpenCodeSessionInstructionPackPreview = {
      preview_id: `opencode_instruction_pack_preview_${packHash.slice(0, 16)}`,
      status,
      can_write: blockers.length === 0,
      session_id: sessionId,
      packet_id: packet?.packet_id,
      packet_hash: packet?.packet_hash,
      budget_id: packet?.budget_id,
      source_kind: session?.source_kind,
      mission_id: session?.mission_id,
      proposal_id: session?.proposal_id,
      review_request_id: session?.review_request_id,
      apply_id: session?.apply_id,
      target_dir: targetDir,
      files: files.map(({ content: _content, ...file }) => file),
      total_size_bytes: totalSize,
      blockers: boundList(blockers),
      warnings: boundList([...warnings, ...(packet?.warnings ?? [])]),
      recommended_commands: recommendedCommands(safeSessionId ? sessionId : "<session_id>", packIdFor(packHash)),
      generated_at: generatedAt,
      redacted_summary_preview: blockers[0] ?? `session instruction pack for ${sessionId}`,
      pack_hash: packHash,
    }
    return { preview: redactValue(previewResult), files }
  }

  private async records(): Promise<OpenCodeSessionInstructionPackRecord[]> {
    return (await this.options.eventStore.readAll())
      .filter((event) => event.kind === "opencode_session_instruction_pack_written")
      .map(recordFromEvent)
  }

  private async findExisting(packHash: string): Promise<OpenCodeSessionInstructionPackRecord | undefined> {
    return (await this.records()).find((item) => item.pack_hash === packHash && item.status === "written")
  }

  private async serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.writeQueue
    let release!: () => void
    this.writeQueue = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

export function readOpenCodeSessionInstructionPackPreviewInput(value: unknown): OpenCodeSessionInstructionPackPreviewInput {
  const input = isRecord(value) ? value : {}
  return {
    session_id: optional(input.sessionId ?? input.session_id ?? input.session),
    provider_kind: optional(input.providerKind ?? input.provider_kind ?? input.provider),
    model_id: optional(input.modelId ?? input.model_id ?? input.model),
    max_context_tokens: optionalNumber(input.maxContextTokens ?? input.max_context_tokens),
    max_context_bytes: optionalNumber(input.maxContextBytes ?? input.max_context_bytes),
    include_opencode_config: input.includeOpenCodeConfig === false || input.include_opencode_config === false ? false : undefined,
    include_manifest: input.includeManifest === false || input.include_manifest === false ? false : undefined,
  }
}

export function readOpenCodeSessionInstructionPackWriteInput(value: unknown): OpenCodeSessionInstructionPackWriteInput {
  const input = isRecord(value) ? value : {}
  return {
    ...readOpenCodeSessionInstructionPackPreviewInput(input),
    dry_run: input.dryRun === true || input.dry_run === true,
    written_by: optional(input.writtenBy ?? input.written_by),
  }
}

function buildFiles(
  session: OpenCodeSessionPlan,
  packet: ContextPacketPreview,
  targetDir: string,
  options: { includeManifest: boolean; includeOpenCodeConfig: boolean; generatedAt: string },
): GeneratedFile[] {
  const files: Array<Omit<GeneratedFile, "size_bytes" | "sha256" | "summary_preview"> & { summary: string }> = [
    {
      file_kind: "task",
      relative_path: "TASK.md",
      would_write: true,
      content: taskMarkdown(session),
      sections_used: ["mission_state", "role_kernel"],
      source_refs: sourceRefIds(packet.included_source_refs),
      warnings: [],
      summary: "tactical objective, success criteria, constraints, and source links",
    },
    {
      file_kind: "context",
      relative_path: "CONTEXT.md",
      would_write: true,
      content: contextMarkdown(packet),
      sections_used: packet.sections.filter((section) => section.status === "included" || section.status === "pointer_only").map((section) => section.section),
      source_refs: sourceRefIds([...packet.included_source_refs, ...packet.omitted_source_refs]),
      warnings: ["raw logs, full research.db, full event log, provider output, and Commander chat are excluded"],
      summary: "bounded executor context sections and omitted section summary",
    },
    {
      file_kind: "guidance",
      relative_path: "GUIDANCE.md",
      would_write: true,
      content: guidanceMarkdown(session, packet),
      sections_used: ["commander_guidance"],
      source_refs: sourceRefIds(packet.omitted_source_refs.filter((ref) => ref.source_kind === "opencode_session")),
      warnings: ["CommanderGuidance protocol is future work"],
      summary: "current Commander guidance placeholders and pointers",
    },
    {
      file_kind: "session_memory",
      relative_path: "SESSION_MEMORY.md",
      would_write: true,
      content: sessionMemoryMarkdown(session),
      sections_used: ["executor_progress", "active_sessions"],
      source_refs: [session.session_id],
      warnings: ["progress report ingestion is future work"],
      summary: "planned session summary and policy metadata",
    },
    {
      file_kind: "policy",
      relative_path: "POLICY.md",
      would_write: true,
      content: policyMarkdown(session),
      sections_used: ["role_kernel"],
      source_refs: [session.session_id],
      warnings: [],
      summary: "runtime authority and tactical executor policy",
    },
  ]
  if (options.includeOpenCodeConfig) {
    files.push({
      file_kind: "opencode_config",
      relative_path: "opencode-session-config.json",
      would_write: true,
      content: JSON.stringify({
        generated_for_future_launch: true,
        launch_ready: false,
        session_id: session.session_id,
        max_context_bytes: packet.budget_summary.max_context_bytes ?? session.max_context_bytes,
        instructions: ["TASK.md", "CONTEXT.md", "GUIDANCE.md", "SESSION_MEMORY.md", "POLICY.md"].map((item) => `${targetDir}/${item}`),
        timeout_policy: session.timeout_policy,
        question_policy: session.question_policy,
        human_control_policy: session.human_control_policy,
        notes: [
          "This is a NexusLoop-generated future launch config hint, not a final OpenCode schema.",
          "No provider credentials, secrets, launch command, or process identifiers are included.",
        ],
      }, null, 2) + "\n",
      sections_used: ["opencode_config"],
      source_refs: [session.session_id, packet.packet_id],
      warnings: ["future launch config hint only; launch_ready=false"],
      summary: "safe future launch config hints without credentials or launch command",
    })
  }
  const provisional = files.map((file) => finalizeFile(file))
  const packHash = hash(stableJson({
    session_id: session.session_id,
    packet_hash: packet.packet_hash,
    include_manifest: options.includeManifest,
    include_opencode_config: options.includeOpenCodeConfig,
    files: provisional.map((file) => [file.relative_path, file.sha256]),
  }))
  const packId = packIdFor(packHash)
  if (options.includeManifest) {
    files.push({
      file_kind: "manifest",
      relative_path: "MANIFEST.json",
      would_write: true,
      content: JSON.stringify(manifestFor(packId, session, packet, options.generatedAt, provisional), null, 2) + "\n",
      sections_used: ["manifest"],
      source_refs: sourceRefIds([...packet.included_source_refs, ...packet.omitted_source_refs]),
      warnings: ["manifest stores hashes and bounded pointers only; no raw packet dump"],
      summary: "machine-readable hashes, source IDs, omitted refs, and redaction policy",
    })
  }
  return files.map((file) => finalizeFile(file))
}

function finalizeFile(file: Omit<GeneratedFile, "size_bytes" | "sha256" | "summary_preview"> & { summary: string }): GeneratedFile {
  const content = redactText(file.content)
  return {
    file_kind: file.file_kind,
    relative_path: file.relative_path,
    would_write: file.would_write,
    content,
    size_bytes: Buffer.byteLength(content, "utf8"),
    sha256: hash(content),
    summary_preview: bound(file.summary),
    sections_used: file.sections_used.slice(0, 16).map(bound),
    source_refs: file.source_refs.slice(0, 24).map(bound),
    warnings: boundList(file.warnings),
  }
}

function taskMarkdown(session: OpenCodeSessionPlan): string {
  return [
    "# TASK",
    "",
    "This file is generated by NexusLoop and is not Commander strategic memory.",
    "",
    `- session_id: ${session.session_id}`,
    `- title: ${session.title}`,
    `- objective: ${session.objective}`,
    `- source_kind: ${session.source_kind}`,
    `- mission_id: ${session.mission_id ?? "none"}`,
    `- proposal_id: ${session.proposal_id ?? "none"}`,
    `- review_request_id: ${session.review_request_id ?? "none"}`,
    `- apply_id: ${session.apply_id ?? "none"}`,
    "",
    "## Success Criteria",
    ...listMarkdown(session.success_criteria),
    "",
    "## Constraints",
    ...listMarkdown(session.constraints),
    "",
    "## Artifact Expectations",
    ...listMarkdown(session.artifact_expectations),
    "",
  ].join("\n")
}

function contextMarkdown(packet: ContextPacketPreview): string {
  const sections = packet.sections.filter((section) => section.status === "included" || section.status === "pointer_only")
  const omitted = packet.sections.filter((section) => section.status !== "included" && section.status !== "pointer_only")
  return [
    "# CONTEXT",
    "",
    "Bounded executor context derived from a NexusLoop context packet preview.",
    "",
    `- packet_id: ${packet.packet_id}`,
    `- packet_hash: ${packet.packet_hash}`,
    `- budget_id: ${packet.budget_id}`,
    `- can_compile_final_prompt: ${packet.can_compile_final_prompt}`,
    "",
    "## Included Or Pointer-Only Sections",
    ...sections.flatMap(sectionMarkdown),
    "",
    "## Omitted Or Excluded Sections",
    ...omitted.flatMap(omittedSectionMarkdown),
    "",
    "Policy: raw logs, full research.db, full event log, full repository dumps, raw provider output, raw Commander chat, and all tool/MCP schemas are excluded by default.",
    "",
  ].join("\n")
}

function guidanceMarkdown(session: OpenCodeSessionPlan, packet: ContextPacketPreview): string {
  return [
    "# GUIDANCE",
    "",
    "Current CommanderGuidance records are not implemented in Branch 9B3.",
    "Do not invent Commander guidance content from this placeholder.",
    "",
    `- session_id: ${session.session_id}`,
    `- packet_id: ${packet.packet_id}`,
    "- future_protocol: CommanderGuidance",
    "- guidance_status: missing/pointer-only until future branches",
    "",
    "If tactical execution later encounters a strategic ambiguity or blocker, report it through the future OpenCode asks Commander protocol.",
    "",
  ].join("\n")
}

function sessionMemoryMarkdown(session: OpenCodeSessionPlan): string {
  return [
    "# SESSION_MEMORY",
    "",
    "Branch 9B3 contains planned session memory only. No OpenCode history exists yet.",
    "",
    `- session_id: ${session.session_id}`,
    `- status: ${session.status}`,
    `- created_at: ${session.created_at}`,
    `- max_context_bytes: ${session.max_context_bytes}`,
    `- commander_context_hash: ${session.commander_context_hash}`,
    `- opencode_context_hash: ${session.opencode_context_hash}`,
    "",
    "## Timeout Policy",
    `- max_wall_time_ms: ${session.timeout_policy.max_wall_time_ms}`,
    `- max_no_progress_ms: ${session.timeout_policy.max_no_progress_ms}`,
    `- heartbeat_interval_ms: ${session.timeout_policy.heartbeat_interval_ms}`,
    `- forced_pause_enabled: ${session.timeout_policy.forced_pause_enabled}`,
    `- report_required_on_timeout: ${session.timeout_policy.report_required_on_timeout}`,
    "",
    "## Question Policy",
    `- allow_opencode_questions: ${session.question_policy.allow_opencode_questions}`,
    `- commander_answer_required_for_blockers: ${session.question_policy.commander_answer_required_for_blockers}`,
    `- human_escalation_allowed: ${session.question_policy.human_escalation_allowed}`,
    `- max_pending_questions: ${session.question_policy.max_pending_questions}`,
    "",
    "## Human Control Policy",
    `- allow_human_pause: ${session.human_control_policy.allow_human_pause}`,
    `- allow_human_override: ${session.human_control_policy.allow_human_override}`,
    `- allow_human_stop: ${session.human_control_policy.allow_human_stop}`,
    `- allow_human_guidance_note: ${session.human_control_policy.allow_human_guidance_note}`,
    `- require_reason_for_stop: ${session.human_control_policy.require_reason_for_stop}`,
    "",
    "Future progress reports, blocker summaries, and continuity notes will be appended through durable NexusLoop records, not raw OpenCode logs.",
    "",
  ].join("\n")
}

function policyMarkdown(session: OpenCodeSessionPlan): string {
  return [
    "# POLICY",
    "",
    "- OpenCode is the tactical executor for this bounded session.",
    "- Commander owns strategic and research direction.",
    "- Runtime owns durable authority, events, projections, lifecycle state, and permission boundaries.",
    "- Do not mutate NexusLoop mission, proposal, review, or apply state directly from these files.",
    "- Do not treat this instruction pack as approval to launch OpenCode.",
    "- Do not dump raw logs, full research.db, full event log, full repository state, raw provider output, or Commander chat into session context.",
    "- Report blockers, missing evidence, or strategic ambiguity through future Commander question/guidance records.",
    "- Obey timeout, question, and human-control policy metadata as reporting expectations only until enforcement branches exist.",
    "",
    `- session_id: ${session.session_id}`,
    `- launch_ready: false`,
    "",
  ].join("\n")
}

function sectionMarkdown(section: ContextPacketSection): string[] {
  return [
    `### ${section.section}`,
    "",
    `- status: ${section.status}`,
    `- priority: ${section.priority}`,
    `- inclusion_policy: ${section.inclusion_policy}`,
    `- estimated_bytes: ${section.estimated_bytes ?? "unknown"}`,
    `- max_bytes: ${section.max_bytes ?? "unknown"}`,
    `- summary: ${section.summary_preview}`,
    `- source_refs: ${sourceRefIds(section.source_refs).join(", ") || "none"}`,
    "",
  ]
}

function omittedSectionMarkdown(section: ContextPacketSection): string[] {
  return [
    `### ${section.section}`,
    "",
    `- status: ${section.status}`,
    `- omitted_reason: ${section.omitted_reason ?? "excluded or unavailable by policy"}`,
    `- summary: ${section.summary_preview}`,
    "",
  ]
}

function manifestFor(
  packId: string,
  session: OpenCodeSessionPlan,
  packet: ContextPacketPreview,
  generatedAt: string,
  files: OpenCodeSessionInstructionPackFilePreview[],
): OpenCodeSessionInstructionPackManifest {
  return {
    pack_id: packId,
    session_id: session.session_id,
    packet_id: packet.packet_id,
    packet_hash: packet.packet_hash,
    budget_id: packet.budget_id,
    generated_at: generatedAt,
    launch_ready: false,
    generated_for_future_launch: true,
    files: files.map((file) => ({
      file_kind: file.file_kind,
      relative_path: file.relative_path,
      size_bytes: file.size_bytes,
      sha256: file.sha256,
    })),
    source_refs: packet.included_source_refs.slice(0, 40),
    omitted_refs: packet.omitted_source_refs.slice(0, 40),
    redaction_policy: "bounded pointers and generated summaries only; no raw logs, full research.db, full event log, raw provider output, credentials, or Commander chat",
  }
}

function blockedResult(preview: OpenCodeSessionInstructionPackPreview, writtenAt: string, writtenBy: string): OpenCodeSessionInstructionPackResult {
  return redactValue({
    pack_id: packIdFor(preview.pack_hash),
    status: "blocked",
    session_id: preview.session_id,
    packet_id: preview.packet_id,
    packet_hash: preview.packet_hash,
    budget_id: preview.budget_id,
    target_dir: preview.target_dir,
    files: preview.files.map((file) => ({ ...file, would_write: false })),
    total_size_bytes: preview.total_size_bytes,
    written_at: writtenAt,
    written_by: writtenBy,
    error: preview.blockers[0] ?? "instruction pack write is blocked",
    pack_hash: preview.pack_hash,
    recommended_commands: preview.recommended_commands,
  })
}

function recordFromEvent(event: JsonlEvent): OpenCodeSessionInstructionPackRecord {
  const files = Array.isArray(event.files) ? event.files : []
  return redactValue({
    pack_id: required(event.pack_id, "pack_id"),
    status: "written",
    session_id: required(event.session_id, "session_id"),
    packet_id: optional(event.packet_id),
    target_dir: required(event.target_dir, "target_dir"),
    file_count: files.length,
    total_size_bytes: optionalNumber(event.total_size_bytes) ?? 0,
    written_at: required(event.written_at, "written_at"),
    summary_preview: bound(`instruction pack for ${required(event.session_id, "session_id")}`),
    pack_hash: required(event.pack_hash, "pack_hash"),
  })
}

function resultFromEvent(event: JsonlEvent): OpenCodeSessionInstructionPackResult {
  return redactValue({
    pack_id: required(event.pack_id, "pack_id"),
    status: "written",
    session_id: required(event.session_id, "session_id"),
    packet_id: optional(event.packet_id),
    packet_hash: optional(event.packet_hash),
    budget_id: optional(event.budget_id),
    target_dir: required(event.target_dir, "target_dir"),
    files: filePreviewsFromEvent(event.files),
    total_size_bytes: optionalNumber(event.total_size_bytes) ?? 0,
    written_at: required(event.written_at, "written_at"),
    written_by: required(event.written_by, "written_by"),
    pack_hash: required(event.pack_hash, "pack_hash"),
    recommended_commands: recommendedCommands(required(event.session_id, "session_id"), required(event.pack_id, "pack_id")),
  })
}

function filePreviewsFromEvent(value: unknown): OpenCodeSessionInstructionPackFilePreview[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map((item) => ({
    file_kind: readFileKind(item.file_kind),
    relative_path: required(item.relative_path, "relative_path"),
    would_write: false,
    size_bytes: optionalNumber(item.size_bytes) ?? 0,
    sha256: required(item.sha256, "sha256"),
    summary_preview: bound(`${item.file_kind ?? "file"} written`),
    sections_used: [],
    source_refs: [],
    warnings: [],
  }))
}

function readFileKind(value: unknown): OpenCodeSessionInstructionPackFileKind {
  if (value === "task" || value === "context" || value === "guidance" || value === "session_memory" || value === "policy" || value === "manifest" || value === "opencode_config") return value
  return "context"
}

async function writeFilesAtomically(projectDir: string, targetDir: string, files: GeneratedFile[]): Promise<void> {
  await rejectSymlinkedPath(projectDir, targetDir)
  await mkdir(targetDir, { recursive: true })
  for (const file of files) {
    const filePath = resolve(targetDir, file.relative_path)
    ensureChildPath(targetDir, filePath)
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(tmpPath, file.content, "utf8")
    await rename(tmpPath, filePath).catch(async (error) => {
      await rm(tmpPath, { force: true }).catch(() => undefined)
      throw error
    })
  }
}

async function rejectSymlinkedPath(projectDir: string, targetDir: string): Promise<void> {
  const symlinkPath = await symlinkedPathComponent(projectDir, targetDir)
  if (symlinkPath) throw new Error(`session instruction-pack target path contains a symlink: ${symlinkPath}`)
}

async function validateTargetForPack(projectDir: string, targetDir: string, files: GeneratedFile[]): Promise<string | null> {
  const symlinkPath = await symlinkedPathComponent(projectDir, targetDir)
  if (symlinkPath) return `session instruction-pack target path contains a symlink: ${symlinkPath}`
  const conflict = await conflictingExistingFile(targetDir, files)
  if (conflict) return `existing file differs: ${conflict}`
  const staleFile = await staleGeneratedFile(targetDir, files)
  if (staleFile) return `existing generated instruction-pack file is not part of requested pack: ${staleFile}; inspect target directory before rewriting`
  return null
}

async function symlinkedPathComponent(projectDir: string, targetDir: string): Promise<string | null> {
  const projectRoot = resolve(projectDir)
  const resolvedTarget = resolve(targetDir)
  ensureChildPath(projectRoot, resolvedTarget)
  const segments = relative(projectRoot, resolvedTarget).split(sep).filter(Boolean)
  let current = projectRoot
  for (const segment of segments) {
    current = resolve(current, segment)
    try {
      const stat = await lstat(current)
      if (stat.isSymbolicLink()) {
        return relative(projectRoot, current)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
      throw error
    }
  }
  return null
}

async function existingFilesMatch(targetDir: string, files: GeneratedFile[]): Promise<boolean> {
  for (const file of files) {
    const filePath = resolve(targetDir, file.relative_path)
    ensureChildPath(targetDir, filePath)
    try {
      const text = await readFile(filePath, "utf8")
      if (hash(text) !== file.sha256) return false
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
      throw error
    }
  }
  return true
}

async function conflictingExistingFile(targetDir: string, files: GeneratedFile[]): Promise<string | null> {
  for (const file of files) {
    const filePath = resolve(targetDir, file.relative_path)
    ensureChildPath(targetDir, filePath)
    try {
      const text = await readFile(filePath, "utf8")
      if (hash(text) !== file.sha256) return file.relative_path
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
      throw error
    }
  }
  return null
}

async function staleGeneratedFile(targetDir: string, files: GeneratedFile[]): Promise<string | null> {
  const requested = new Set(files.map((file) => file.relative_path))
  for (const relativePath of GENERATED_FILE_PATHS) {
    if (requested.has(relativePath)) continue
    const filePath = resolve(targetDir, relativePath)
    ensureChildPath(targetDir, filePath)
    try {
      await lstat(filePath)
      return relativePath
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
      throw error
    }
  }
  return null
}

function targetDirFor(projectDir: string, sessionId: string): string {
  const root = resolve(projectDir, ".nxl", "opencode", "sessions")
  const target = resolve(root, sessionId)
  ensureChildPath(root, target)
  return target
}

function ensureChildPath(root: string, target: string): void {
  const rel = relative(resolve(root), resolve(target))
  if (rel === "" || rel.startsWith("..") || rel.split(sep).includes("..")) throw new Error("target path escapes session directory")
}

function relativeProjectPath(target: string, projectDir: string): string {
  return relative(projectDir, target).split(sep).join("/")
}

function isSafeSessionId(value: string): boolean {
  return SESSION_ID_PATTERN.test(value) && !value.includes("..") && !value.includes("/") && !value.includes("\\") && !value.includes("\0")
}

function recommendedCommands(sessionId: string, packId?: string): OpenCodeSessionInstructionPackCommand[] {
  const commands: OpenCodeSessionInstructionPackCommand[] = [
    { label: "Preview instruction pack", command: `/opencode-session-instruction-pack-preview session=${sessionId}`, command_type: "read" },
    { label: "List instruction packs", command: "/opencode-session-instruction-packs", command_type: "read" },
    { label: "Show authority", command: "/authority-show /opencode-session-instruction-pack-write", command_type: "read" },
    { label: "Preview context packet", command: `/context-packet-preview purpose=opencode_executor_session session=${sessionId}`, command_type: "read" },
  ]
  if (packId) commands.push({ label: "Show instruction pack", command: `/opencode-session-instruction-pack-show ${packId}`, command_type: "read" })
  return commands
}

function sourceRefIds(refs: ContextPacketSourceRef[]): string[] {
  return refs.map((ref) => `${ref.source_kind}:${ref.source_id}`).filter(Boolean)
}

function listMarkdown(items: string[]): string[] {
  return items.length ? items.map((item) => `- ${item}`) : ["- none"]
}

function packIdFor(packHash: string): string {
  return `opencode_instruction_pack_${packHash.slice(0, 16)}`
}

function boundList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => bound(String(item))).filter(Boolean).slice(0, 16)
}

function bound(value: string): string {
  return redactText(value).slice(0, MAX_TEXT)
}

function optional(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const bounded = bound(value.trim())
  return bounded ? bounded : undefined
}

function required(value: unknown, name: string): string {
  const result = optional(value)
  if (!result) throw new Error(`${name} is required`)
  return result
}

function optionalNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : undefined
  return typeof number === "number" && Number.isFinite(number) ? Math.trunc(number) : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stableJson(value: unknown): string {
  return JSON.stringify(stable(value))
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
