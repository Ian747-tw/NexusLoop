import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { OpenCodeLaunchReadinessService } from "./opencode-launch-readiness-service"
import type { OpenCodeLaunchReadinessPreview } from "./opencode-launch-readiness-types"
import type { OpenCodeSessionInstructionPackService } from "./opencode-session-instruction-pack-service"
import type { OpenCodeLaunchAdapter } from "./opencode-launch-adapter"
import type {
  OpenCodeLaunchAdapterKind,
  OpenCodeLaunchCommand,
  OpenCodeLaunchInput,
  OpenCodeLaunchMode,
  OpenCodeLaunchPreview,
  OpenCodeLaunchPreviewInput,
  OpenCodeLaunchRecord,
  OpenCodeLaunchResult,
} from "./opencode-launch-gate-types"

const MAX_LIST = 100
const ACTIVE_STATUSES = new Set(["launch_started", "launched"])

export type OpenCodeLaunchGateServiceOptions = {
  projectDir: string
  eventStore: EventStore
  readinessService: OpenCodeLaunchReadinessService
  instructionPackService: OpenCodeSessionInstructionPackService
  fakeAdapter: OpenCodeLaunchAdapter
  realAdapter?: OpenCodeLaunchAdapter
  env?: Record<string, string | undefined>
  now?: () => Date
  idFactory?: () => string
}

type BuiltPreview = {
  preview: OpenCodeLaunchPreview
  readiness?: OpenCodeLaunchReadinessPreview
}

export class OpenCodeLaunchGateService {
  private readonly now: () => Date
  private readonly idFactory: () => string
  private readonly env: Record<string, string | undefined>
  private launchQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: OpenCodeLaunchGateServiceOptions) {
    this.now = options.now ?? (() => new Date())
    this.idFactory = options.idFactory ?? (() => `opencode_launch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`)
    this.env = options.env ?? process.env
  }

  async preview(input: OpenCodeLaunchPreviewInput = {}): Promise<OpenCodeLaunchPreview> {
    return (await this.buildPreview(input)).preview
  }

  async launch(input: OpenCodeLaunchInput = {}): Promise<OpenCodeLaunchResult> {
    const startedAt = this.now().toISOString()
    const launchedBy = bound(input.launched_by ?? "operator")
    const built = await this.buildPreview(input)
    const preview = built.preview
    const launchId = this.idFactory()
    if (input.dry_run === true) {
      return resultFromPreview(preview, {
        launch_id: launchId,
        status: "dry_run",
        launch_performed: false,
        started_at: startedAt,
        completed_at: startedAt,
        output_summary_preview: "dry-run requested; no OpenCode process launched and no events appended",
      })
    }
    if (!preview.can_launch || !built.readiness) {
      return resultFromPreview(preview, {
        launch_id: launchId,
        status: "blocked",
        launch_performed: false,
        started_at: startedAt,
        completed_at: startedAt,
        error: preview.blockers[0] ?? "OpenCode launch is blocked",
      })
    }
    if (preview.adapter_kind !== "fake" && (input.require_opt_in ?? true) !== false && this.env.NXL_REAL_OPENCODE_LAUNCH !== "1") {
      return resultFromPreview(preview, {
        launch_id: launchId,
        status: "blocked",
        launch_performed: false,
        started_at: startedAt,
        completed_at: startedAt,
        error: "real OpenCode launch requires NXL_REAL_OPENCODE_LAUNCH=1",
      })
    }

    return this.serializeLaunch(async () => {
      const active = (await this.records()).find((record) => record.session_id === preview.session_id && ACTIVE_STATUSES.has(record.status))
      if (active) {
        return resultFromPreview(preview, {
          launch_id: launchId,
          status: "blocked",
          launch_performed: false,
          started_at: startedAt,
          completed_at: startedAt,
          error: "OpenCode session already has an active launch record",
        })
      }
      const failed = (await this.records()).find((record) => record.session_id === preview.session_id && record.status === "launch_failed")
      if (failed) {
        return resultFromPreview(preview, {
          launch_id: launchId,
          status: "blocked",
          launch_performed: false,
          started_at: startedAt,
          completed_at: startedAt,
          error: "prior failed launch exists; retry is out of scope for Branch 9D",
        })
      }
      const adapter = this.adapterFor(preview.adapter_kind)
      if (!adapter) {
        return resultFromPreview(preview, {
          launch_id: launchId,
          status: "blocked",
          launch_performed: false,
          started_at: startedAt,
          completed_at: startedAt,
          error: "OpenCode launch adapter is unavailable",
        })
      }
      const startedPayload = eventPayload(preview, {
        kind: "opencode_session_launch_started",
        launch_id: launchId,
        status: "launch_started",
        started_at: startedAt,
        launched_by: launchedBy,
      })
      await this.options.eventStore.append(startedPayload as JsonlEvent)
      const adapterResult = await adapter.launch({
        project_dir: this.options.projectDir,
        target_dir: preview.target_dir,
        instruction_files: preview.instruction_files,
        launch_id: launchId,
        session_id: preview.session_id,
      })
      const completedAt = this.now().toISOString()
      const result = resultFromPreview(preview, {
        launch_id: launchId,
        status: adapterResult.status,
        launch_performed: adapter.kind !== "fake",
        started_at: startedAt,
        completed_at: completedAt,
        process_id: adapterResult.process_id,
        native_session_id: adapterResult.native_session_id,
        exit_code: adapterResult.exit_code,
        error: adapterResult.error,
        output_summary_preview: adapterResult.output_summary_preview,
        event_count: adapterResult.event_count,
      })
      await this.options.eventStore.append(eventPayload(preview, {
        kind: adapterResult.status === "launch_failed" ? "opencode_session_launch_failed" : "opencode_session_launch_succeeded",
        ...result,
      }) as JsonlEvent)
      return redactValue(result)
    })
  }

  async list(input: { limit?: number; session_id?: string; status?: string } = {}): Promise<OpenCodeLaunchRecord[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, MAX_LIST))
    return (await this.records())
      .filter((record) => !input.session_id || record.session_id === input.session_id)
      .filter((record) => !input.status || record.status === input.status)
      .sort((left, right) => right.started_at.localeCompare(left.started_at))
      .slice(0, limit)
  }

  async get(launchId: string): Promise<OpenCodeLaunchResult | null> {
    const events = await this.options.eventStore.readAll()
    const event = events
      .filter((item) => item.kind === "opencode_session_launch_succeeded" || item.kind === "opencode_session_launch_failed")
      .reverse()
      .find((item) => item.launch_id === launchId)
    return event ? resultFromEvent(event) : null
  }

  private async buildPreview(input: OpenCodeLaunchPreviewInput = {}): Promise<BuiltPreview> {
    const generatedAt = this.now().toISOString()
    const sessionId = optional(input.session_id) ?? ""
    const launchMode = readLaunchMode(input.launch_mode)
    const blockers: string[] = []
    const warnings = new Set<string>([
      "launch preview does not launch OpenCode, call providers, call MCPs, query research.db, or mutate missions",
    ])
    if (!sessionId) blockers.push("session_id is required")
    if (launchMode !== "fresh") blockers.push("Branch 9D only supports fresh OpenCode launch mode")
    const readiness = sessionId ? await this.options.readinessService.preview({
      session_id: sessionId,
      pack_id: optional(input.pack_id),
      provider_kind: optional(input.provider_kind),
      model_id: optional(input.model_id),
    }) : undefined
    if (readiness && readiness.status !== "ready") blockers.push(`OpenCode launch readiness must be ready; current status is ${readiness.status}`)
    if (readiness && input.readiness_hash && readiness.readiness_hash !== input.readiness_hash) blockers.push("readiness_hash does not match rebuilt readiness preview")
    if (readiness && !readiness.pack_id) blockers.push("instruction pack is required before launch")
    const pack = readiness?.pack_id ? await this.options.instructionPackService.get(readiness.pack_id) : null
    if (readiness?.pack_id && !pack) blockers.push("ready instruction pack could not be loaded")
    const requestedKind = input.adapter_kind
    const adapter = this.adapterFor(requestedKind ?? this.defaultAdapterKind(input.allow_real_launch === true))
    const adapterPreview = adapter
      ? await adapter.preview({ project_dir: this.options.projectDir, target_dir: readiness?.target_dir, instruction_files: pack?.files.map((file) => file.relative_path) ?? [] })
      : { adapter_kind: "disabled" as const, blockers: ["OpenCode launch adapter is unavailable"], warnings: [] }
    blockers.push(...adapterPreview.blockers)
    for (const warning of adapterPreview.warnings) warnings.add(warning)
    if (adapterPreview.adapter_kind !== "fake" && input.allow_real_launch !== true) warnings.add("real launch is not allowed by preview input; non-dry launch also requires NXL_REAL_OPENCODE_LAUNCH=1")
    const active = sessionId ? (await this.records()).find((record) => record.session_id === sessionId && ACTIVE_STATUSES.has(record.status)) : undefined
    if (active) blockers.push("OpenCode session already has an active launch record")
    const failed = sessionId ? (await this.records()).find((record) => record.session_id === sessionId && record.status === "launch_failed") : undefined
    if (failed) blockers.push("prior failed launch exists; retry is out of scope for Branch 9D")
    const launchHash = hash(stableJson({
      session_id: sessionId,
      pack_id: readiness?.pack_id ?? input.pack_id,
      readiness_hash: readiness?.readiness_hash,
      adapter_kind: adapterPreview.adapter_kind,
      launch_mode: launchMode,
      instruction_files: pack?.files.map((file) => file.sha256) ?? [],
    }))
    const canLaunch = blockers.length === 0
    return {
      preview: redactValue({
        preview_id: `opencode_launch_preview_${launchHash.slice(0, 16)}`,
        status: canLaunch ? "ready" : "blocked",
        can_launch: canLaunch,
        launch_performed: false as const,
        adapter_kind: adapterPreview.adapter_kind,
        launch_mode: "fresh" as const,
        session_id: sessionId,
        pack_id: readiness?.pack_id ?? optional(input.pack_id),
        readiness_hash: readiness?.readiness_hash,
        readiness_status: readiness?.status,
        packet_id: readiness?.packet_id,
        packet_hash: pack?.packet_hash,
        budget_id: readiness?.budget_id,
        target_dir: readiness?.target_dir,
        command_preview: adapterPreview.command_preview,
        env_preview: adapterPreview.env_preview,
        instruction_files: pack?.files.map((file) => file.relative_path) ?? [],
        blockers: boundList(unique(blockers)),
        warnings: boundList(unique([...Array.from(warnings), ...(readiness?.warnings ?? [])])),
        recommended_commands: recommendedCommands(sessionId || "<session_id>", readiness?.pack_id),
        generated_at: generatedAt,
        redacted_summary_preview: canLaunch ? `OpenCode launch gate ready for ${sessionId}` : blockers[0] ?? "OpenCode launch gate blocked",
        launch_hash: launchHash,
      }),
      readiness,
    }
  }

  private adapterFor(kind: OpenCodeLaunchAdapterKind): OpenCodeLaunchAdapter | undefined {
    if (kind === "fake") return this.options.fakeAdapter
    if (kind === "process_adapter" || kind === "native_run_json") return this.options.realAdapter
    if (kind === "disabled") return undefined
    return undefined
  }

  private defaultAdapterKind(allowRealLaunch: boolean): OpenCodeLaunchAdapterKind {
    if (allowRealLaunch && this.options.realAdapter) return this.options.realAdapter.kind
    return this.options.fakeAdapter.kind
  }

  private async records(): Promise<OpenCodeLaunchRecord[]> {
    const events = await this.options.eventStore.readAll()
    return events
      .filter((event) => event.kind === "opencode_session_launch_succeeded" || event.kind === "opencode_session_launch_failed")
      .map(recordFromEvent)
      .filter((record): record is OpenCodeLaunchRecord => record !== null)
  }

  private serializeLaunch<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.launchQueue.then(operation, operation)
    this.launchQueue = run.then(() => undefined, () => undefined)
    return run
  }
}

export function readOpenCodeLaunchPreviewInput(value: unknown): OpenCodeLaunchPreviewInput {
  const input = isRecord(value) ? value : {}
  return {
    session_id: optional(input.sessionId ?? input.session_id ?? input.session),
    pack_id: optional(input.packId ?? input.pack_id ?? input.pack),
    readiness_hash: optional(input.readinessHash ?? input.readiness_hash),
    adapter_kind: optional(input.adapterKind ?? input.adapter_kind) as OpenCodeLaunchAdapterKind | undefined,
    provider_kind: optional(input.providerKind ?? input.provider_kind ?? input.provider),
    model_id: optional(input.modelId ?? input.model_id ?? input.model),
    allow_real_launch: optionalBoolean(input.allowRealLaunch ?? input.allow_real_launch),
    launch_mode: optional(input.launchMode ?? input.launch_mode),
  }
}

export function readOpenCodeLaunchInput(value: unknown): OpenCodeLaunchInput {
  const input = isRecord(value) ? value : {}
  return {
    ...readOpenCodeLaunchPreviewInput(input),
    dry_run: optionalBoolean(input.dryRun ?? input.dry_run),
    launched_by: optional(input.launchedBy ?? input.launched_by),
    require_opt_in: optionalBoolean(input.requireOptIn ?? input.require_opt_in),
  }
}

function resultFromPreview(preview: OpenCodeLaunchPreview, overrides: Partial<OpenCodeLaunchResult> & { launch_id: string; status: OpenCodeLaunchResult["status"]; launch_performed: boolean }): OpenCodeLaunchResult {
  return redactValue({
    launch_id: overrides.launch_id,
    status: overrides.status,
    adapter_kind: preview.adapter_kind,
    launch_mode: preview.launch_mode,
    session_id: preview.session_id,
    pack_id: preview.pack_id,
    readiness_hash: preview.readiness_hash,
    packet_id: preview.packet_id,
    packet_hash: preview.packet_hash,
    budget_id: preview.budget_id,
    target_dir: preview.target_dir,
    process_id: overrides.process_id,
    native_session_id: overrides.native_session_id,
    command_preview: preview.command_preview,
    started_at: overrides.started_at,
    completed_at: overrides.completed_at,
    exit_code: overrides.exit_code,
    error: bound(overrides.error),
    launch_performed: overrides.launch_performed,
    output_summary_preview: bound(overrides.output_summary_preview ?? preview.redacted_summary_preview),
    event_count: overrides.event_count,
    launch_hash: hash(stableJson({ launch_id: overrides.launch_id, preview_hash: preview.launch_hash, status: overrides.status })),
    recommended_commands: preview.recommended_commands,
  })
}

function eventPayload(preview: OpenCodeLaunchPreview, payload: Record<string, unknown>): Record<string, unknown> {
  return redactValue({
    ...payload,
    session_id: preview.session_id,
    pack_id: preview.pack_id,
    readiness_hash: preview.readiness_hash,
    packet_id: preview.packet_id,
    packet_hash: preview.packet_hash,
    budget_id: preview.budget_id,
    adapter_kind: preview.adapter_kind,
    launch_mode: preview.launch_mode,
    command_preview: preview.command_preview,
    target_dir: preview.target_dir,
  })
}

function recordFromEvent(event: JsonlEvent): OpenCodeLaunchRecord | null {
  if (typeof event.launch_id !== "string" || typeof event.session_id !== "string") return null
  const status = readResultStatus(event.status, event.kind === "opencode_session_launch_failed" ? "launch_failed" : "launched")
  const adapterKind = readAdapterKind(event.adapter_kind)
  return redactValue({
    launch_id: event.launch_id,
    status,
    adapter_kind: adapterKind,
    launch_mode: "fresh",
    session_id: event.session_id,
    pack_id: typeof event.pack_id === "string" ? event.pack_id : undefined,
    native_session_id: typeof event.native_session_id === "string" ? event.native_session_id : undefined,
    process_id: typeof event.process_id === "number" ? event.process_id : undefined,
    started_at: typeof event.started_at === "string" ? event.started_at : typeof event.completed_at === "string" ? event.completed_at : "",
    completed_at: typeof event.completed_at === "string" ? event.completed_at : undefined,
    exit_code: typeof event.exit_code === "number" ? event.exit_code : undefined,
    summary_preview: bound(typeof event.error === "string" ? event.error : typeof event.output_summary_preview === "string" ? event.output_summary_preview : String(event.status ?? event.kind)) ?? "launch record",
    launch_hash: typeof event.launch_hash === "string" ? event.launch_hash : hash(stableJson(event)),
  })
}

function resultFromEvent(event: JsonlEvent): OpenCodeLaunchResult {
  const status = readResultStatus(event.status, event.kind === "opencode_session_launch_failed" ? "launch_failed" : "launched")
  const adapterKind = readAdapterKind(event.adapter_kind)
  return redactValue({
    launch_id: String(event.launch_id ?? ""),
    status,
    adapter_kind: adapterKind,
    launch_mode: "fresh",
    session_id: String(event.session_id ?? ""),
    pack_id: typeof event.pack_id === "string" ? event.pack_id : undefined,
    readiness_hash: typeof event.readiness_hash === "string" ? event.readiness_hash : undefined,
    packet_id: typeof event.packet_id === "string" ? event.packet_id : undefined,
    packet_hash: typeof event.packet_hash === "string" ? event.packet_hash : undefined,
    budget_id: typeof event.budget_id === "string" ? event.budget_id : undefined,
    target_dir: typeof event.target_dir === "string" ? event.target_dir : undefined,
    process_id: typeof event.process_id === "number" ? event.process_id : undefined,
    native_session_id: typeof event.native_session_id === "string" ? event.native_session_id : undefined,
    command_preview: typeof event.command_preview === "string" ? event.command_preview : undefined,
    started_at: typeof event.started_at === "string" ? event.started_at : undefined,
    completed_at: typeof event.completed_at === "string" ? event.completed_at : undefined,
    exit_code: typeof event.exit_code === "number" ? event.exit_code : undefined,
    error: typeof event.error === "string" ? event.error : undefined,
    launch_performed: event.adapter_kind !== "fake",
    output_summary_preview: typeof event.output_summary_preview === "string" ? event.output_summary_preview : undefined,
    event_count: typeof event.event_count === "number" ? event.event_count : undefined,
    launch_hash: typeof event.launch_hash === "string" ? event.launch_hash : hash(stableJson(event)),
    recommended_commands: recommendedCommands(String(event.session_id ?? "<session_id>"), typeof event.pack_id === "string" ? event.pack_id : undefined),
  })
}

function readResultStatus(value: unknown, fallback: OpenCodeLaunchResult["status"]): OpenCodeLaunchResult["status"] {
  return value === "blocked" || value === "dry_run" || value === "launch_started" || value === "launch_failed" || value === "launched" ? value : fallback
}

function readAdapterKind(value: unknown): OpenCodeLaunchAdapterKind {
  return value === "fake" || value === "native_run_json" || value === "process_adapter" || value === "disabled" || value === "unknown" ? value : "unknown"
}

function recommendedCommands(sessionId: string, packId?: string): OpenCodeLaunchCommand[] {
  const packArg = packId ? ` pack=${packId}` : ""
  return [
    { label: "Preview launch", command: `/opencode-launch-preview session=${sessionId}${packArg}`, command_type: "read" },
    { label: "Dry-run launch", command: `/opencode-launch-dry-run session=${sessionId}${packArg}`, command_type: "read" },
    { label: "Launch OpenCode", command: `/opencode-launch session=${sessionId}${packArg}`, command_type: "write", requires_active_runtime: true, notes: "high-impact launch gate; real launch requires NXL_REAL_OPENCODE_LAUNCH=1" },
    { label: "List launches", command: "/opencode-launches", command_type: "read" },
  ]
}

function readLaunchMode(value: unknown): OpenCodeLaunchMode | string {
  if (value === undefined || value === null || value === "") return "fresh"
  return String(value)
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? bound(value) : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value === "boolean") return value
  if (value === "true") return true
  if (value === "false") return false
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function bound(value: unknown, max = 280): string | undefined {
  if (value === undefined || value === null) return undefined
  return redactText(String(value)).slice(0, max)
}

function boundList(values: string[], limit = 12): string[] {
  return values.map((item) => bound(item) ?? "").filter(Boolean).slice(0, limit)
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item
    return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)))
  })
}
