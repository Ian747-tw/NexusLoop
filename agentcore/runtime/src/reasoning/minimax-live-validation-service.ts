import { createHash, randomUUID } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactText, redactValue } from "../security/redaction"
import type { ReasoningProviderHealthService } from "./reasoning-health-service"
import type { ReasoningProviderConfig, ReasoningProviderSurface } from "./reasoning-provider-config"
import type {
  MiniMaxLiveValidationCommand,
  MiniMaxLiveValidationInput,
  MiniMaxLiveValidationPreview,
  MiniMaxLiveValidationRecord,
  MiniMaxLiveValidationResult,
  MiniMaxLiveValidationSurface,
  MiniMaxLiveValidationSurfaceResult,
} from "./minimax-live-validation-types"

const LIVE_GATE = "NXL_MINIMAX_LIVE_VALIDATION"
const DEFAULT_TIMEOUT_MS = 20_000
const MAX_TIMEOUT_MS = 60_000
const TEXT_LIMIT = 512

export interface MiniMaxLiveValidationServiceOptions {
  eventStore: EventStore
  config: ReasoningProviderConfig
  healthService: ReasoningProviderHealthService
  env?: Record<string, string | undefined>
  now?: () => Date
  idFactory?: () => string
}

export class MiniMaxLiveValidationService {
  private readonly eventStore: EventStore
  private readonly config: ReasoningProviderConfig
  private readonly healthService: ReasoningProviderHealthService
  private readonly env: Record<string, string | undefined>
  private readonly now: () => Date
  private readonly idFactory: () => string

  constructor(options: MiniMaxLiveValidationServiceOptions) {
    this.eventStore = options.eventStore
    this.config = options.config
    this.healthService = options.healthService
    this.env = options.env ?? {}
    this.now = options.now ?? (() => new Date())
    this.idFactory = options.idFactory ?? (() => `minimax_live_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`)
  }

  preview(input: MiniMaxLiveValidationInput = {}): MiniMaxLiveValidationPreview {
    const requestedSurfaces = this.readSurfaces(input.surfaces)
    const timeoutMs = this.readTimeout(input.timeout_ms)
    const generatedAt = this.now().toISOString()
    const optInPresent = this.env[LIVE_GATE] === "1"
    const blockers: string[] = []
    const warnings: string[] = []

    if (this.config.kind !== "minimax") blockers.push("MiniMax reasoning provider is not configured")
    if (!this.config.connector_id) blockers.push("MiniMax reasoning connector is missing")
    if (!this.config.model) blockers.push("MiniMax reasoning model is missing")
    if (!optInPresent) blockers.push(`${LIVE_GATE}=1 is required for MiniMax live validation`)

    for (const surface of requestedSurfaces) {
      if (!this.config.enabled_for.includes(surface)) blockers.push(`provider is not enabled for ${surface}`)
      try {
        const preview = this.healthService.preview({ surface, require_real_smoke_gate: false })
        blockers.push(...preview.blockers)
      } catch (error) {
        blockers.push(error instanceof Error ? error.message : String(error))
      }
    }

    const dedupedBlockers = unique(blockers.map((item) => this.safe(item)))
    if (this.config.kind === "fake") warnings.push("default fake provider cannot run live MiniMax validation")
    if (requestedSurfaces.length > 1) warnings.push("each requested surface is validated independently; no product action is executed")
    return redactValue({
      status: this.previewStatus(dedupedBlockers),
      can_execute: dedupedBlockers.length === 0,
      provider_kind: this.config.kind,
      provider_id: this.safe(this.config.provider_id),
      connector_id: this.config.connector_id ? this.safe(this.config.connector_id) : undefined,
      model: this.config.model ? this.safe(this.config.model) : undefined,
      enabled_surfaces: this.config.enabled_for,
      requested_surfaces: requestedSurfaces,
      opt_in_required: true,
      opt_in_present: optInPresent,
      timeout_ms: timeoutMs,
      blockers: dedupedBlockers,
      warnings: warnings.map((item) => this.safe(item)),
      redacted_summary_preview: this.safe(dedupedBlockers.length === 0 ? "MiniMax live validation is ready" : dedupedBlockers.join("; ")),
      recommended_commands: validationCommands(requestedSurfaces),
      generated_at: generatedAt,
    } satisfies MiniMaxLiveValidationPreview)
  }

  async execute(input: MiniMaxLiveValidationInput = {}): Promise<MiniMaxLiveValidationResult> {
    const startedAt = this.now().toISOString()
    const startedMs = Date.now()
    const validationId = this.idFactory()
    const requestedBy = this.safe(input.requested_by ?? "operator")
    const preview = this.preview(input)
    if (input.dry_run === true) {
      return this.result({
        validationId,
        status: "skipped",
        startedAt,
        requestedBy,
        surfaces: preview.requested_surfaces.map((surface) => ({
          surface,
          status: "skipped",
          ok: false,
          parsed: false,
          summary_preview: "dry-run requested; no provider call or events appended",
          schema_version: "reasoning-smoke-v1",
        })),
        diagnostics: ["dry-run requested; no provider call or events appended", ...preview.warnings],
      })
    }
    if (!preview.can_execute) {
      return this.result({
        validationId,
        status: "blocked",
        startedAt,
        requestedBy,
        surfaces: preview.requested_surfaces.map((surface) => ({
          surface,
          status: "blocked",
          ok: false,
          parsed: false,
          error: preview.blockers.join("; "),
          schema_version: "reasoning-smoke-v1",
        })),
        diagnostics: preview.blockers,
        error: preview.blockers[0] ?? "MiniMax live validation blocked",
      })
    }

    const started = this.result({
      validationId,
      status: "skipped",
      startedAt,
      requestedBy,
      surfaces: [],
      diagnostics: ["MiniMax live validation started"],
    })
    await this.append("minimax_live_validation_started", started)

    const surfaceResults: MiniMaxLiveValidationSurfaceResult[] = []
    for (const surface of preview.requested_surfaces) {
      const surfaceStarted = Date.now()
      try {
        const smoke = await this.healthService.execute({
          surface,
          requested_by: `minimax-live-validation:${requestedBy}`,
          persist_event: false,
          persist_external_api_audit: false,
          require_real_smoke_gate: false,
          timeout_ms: input.timeout_ms === undefined ? undefined : preview.timeout_ms,
        })
        surfaceResults.push({
          surface,
          status: smoke.ok ? "succeeded" : "failed",
          ok: smoke.ok,
          parsed: smoke.parsed,
          request_id: smoke.request_id,
          summary_preview: this.safe(smoke.summary),
          error: smoke.error ? this.safe(smoke.error) : undefined,
          duration_ms: Date.now() - surfaceStarted,
          schema_version: "reasoning-smoke-v1",
        })
      } catch (error) {
        surfaceResults.push({
          surface,
          status: "failed",
          ok: false,
          parsed: false,
          error: this.safe(error instanceof Error ? error.message : String(error)),
          duration_ms: Date.now() - surfaceStarted,
          schema_version: "reasoning-smoke-v1",
        })
      }
    }

    const failed = surfaceResults.filter((item) => !item.ok)
    const result = this.result({
      validationId,
      status: failed.length === 0 ? "succeeded" : "failed",
      startedAt,
      requestedBy,
      durationMs: Date.now() - startedMs,
      surfaces: surfaceResults,
      diagnostics: failed.length === 0 ? ["MiniMax live validation succeeded"] : failed.map((item) => item.error ?? `${item.surface} failed`),
      error: failed[0]?.error,
    })
    await this.append(result.status === "succeeded" ? "minimax_live_validation_succeeded" : "minimax_live_validation_failed", result)
    return result
  }

  async list(limit = 20): Promise<MiniMaxLiveValidationRecord[]> {
    return (await this.results())
      .sort((left, right) => String(right.completed_at).localeCompare(String(left.completed_at)))
      .slice(0, Math.max(1, Math.min(limit, 100)))
      .map((result) => this.record(result))
  }

  async get(validationId: string): Promise<MiniMaxLiveValidationResult | null> {
    return (await this.results()).find((result) => result.validation_id === validationId) ?? null
  }

  private async results(): Promise<MiniMaxLiveValidationResult[]> {
    return (await this.eventStore.readAll())
      .filter((event) => typeof event.kind === "string" && event.kind.startsWith("minimax_live_validation_") && event.kind !== "minimax_live_validation_started")
      .map((event) => eventToResult(event))
      .filter((result): result is MiniMaxLiveValidationResult => result !== null)
  }

  private result(input: {
    validationId: string
    status: "succeeded" | "failed" | "blocked" | "skipped"
    startedAt: string
    requestedBy: string
    surfaces: MiniMaxLiveValidationSurfaceResult[]
    diagnostics: string[]
    durationMs?: number
    error?: string
  }): MiniMaxLiveValidationResult {
    const completedAt = this.now().toISOString()
    const safeSurfaces = input.surfaces.map((surface) => redactValue({
      ...surface,
      request_id: surface.request_id ? this.safe(surface.request_id) : undefined,
      summary_preview: surface.summary_preview ? this.safe(surface.summary_preview) : undefined,
      error: surface.error ? this.safe(surface.error) : undefined,
    })) as MiniMaxLiveValidationSurfaceResult[]
    const result = redactValue({
      validation_id: this.safe(input.validationId),
      status: input.status,
      provider_kind: this.config.kind,
      provider_id: this.safe(this.config.provider_id),
      connector_id: this.config.connector_id ? this.safe(this.config.connector_id) : undefined,
      model: this.config.model ? this.safe(this.config.model) : undefined,
      surfaces: safeSurfaces,
      started_at: input.startedAt,
      completed_at: completedAt,
      duration_ms: input.durationMs,
      requested_by: this.safe(input.requestedBy),
      diagnostics: input.diagnostics.map((item) => this.safe(item)).slice(0, 12),
      error: input.error ? this.safe(input.error) : undefined,
    }) as Omit<MiniMaxLiveValidationResult, "validation_hash">
    return { ...result, validation_hash: hashResult(result) }
  }

  private record(result: MiniMaxLiveValidationResult): MiniMaxLiveValidationRecord {
    const succeededCount = result.surfaces.filter((surface) => surface.status === "succeeded").length
    const failedCount = result.surfaces.filter((surface) => surface.status === "failed" || surface.status === "blocked").length
    return {
      validation_id: result.validation_id,
      status: result.status,
      provider_id: result.provider_id,
      model: result.model,
      completed_at: result.completed_at,
      surface_count: result.surfaces.length,
      succeeded_count: succeededCount,
      failed_count: failedCount,
      summary_preview: result.error ? this.safe(result.error) : this.safe(result.diagnostics[0] ?? result.status),
      validation_hash: result.validation_hash,
    }
  }

  private async append(kind: "minimax_live_validation_started" | "minimax_live_validation_succeeded" | "minimax_live_validation_failed" | "minimax_live_validation_blocked" | "minimax_live_validation_skipped", result: MiniMaxLiveValidationResult): Promise<void> {
    await this.eventStore.append({
      kind,
      validation_id: result.validation_id,
      status: result.status,
      provider_kind: result.provider_kind,
      provider_id: result.provider_id,
      connector_id: result.connector_id,
      model: result.model,
      surfaces: result.surfaces,
      surface_count: result.surfaces.length,
      succeeded_count: result.surfaces.filter((surface) => surface.status === "succeeded").length,
      failed_count: result.surfaces.filter((surface) => surface.status === "failed" || surface.status === "blocked").length,
      diagnostics: result.diagnostics,
      error: result.error,
      requested_by: result.requested_by,
      started_at: result.started_at,
      completed_at: result.completed_at,
      duration_ms: result.duration_ms,
      validation_hash: result.validation_hash,
    })
  }

  private readSurfaces(value: unknown): MiniMaxLiveValidationSurface[] {
    const raw = Array.isArray(value) ? value : value === undefined ? defaultSurfaces(this.config.enabled_for) : [value]
    if (raw.length === 0) throw new Error("MiniMax live validation requires at least one surface")
    return unique(raw.map((item) => readSurface(item)))
  }

  private readTimeout(value: unknown): number {
    if (value === undefined) return this.config.timeout_ms ? Math.min(this.config.timeout_ms, MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 1) throw new Error("timeout_ms must be a positive integer")
    return Math.min(parsed, MAX_TIMEOUT_MS)
  }

  private previewStatus(blockers: string[]): "not_configured" | "blocked" | "ready" {
    if (blockers.length === 0) return "ready"
    if (this.config.kind !== "minimax" || !this.config.connector_id || !this.config.model) return "not_configured"
    return "blocked"
  }

  private safe(value: string): string {
    return boundedText(redactText(value), TEXT_LIMIT)
  }
}

function defaultSurfaces(enabled: ReasoningProviderSurface[]): MiniMaxLiveValidationSurface[] {
  const surfaces = enabled.filter((surface): surface is MiniMaxLiveValidationSurface => isValidationSurface(surface))
  if (surfaces.includes("commander_executor_review")) return surfaces
  return Array.from(new Set<MiniMaxLiveValidationSurface>(["commander_executor_review", ...surfaces]))
}

function readSurface(value: unknown): MiniMaxLiveValidationSurface {
  if (value === "research" || value === "research_synthesis") return "research_synthesis"
  if (value === "cycle" || value === "commander_cycle") return "commander_cycle"
  if (value === "executor_review" || value === "commander_executor_review") return "commander_executor_review"
  throw new Error("MiniMax live validation surface must be research_synthesis, commander_cycle, or commander_executor_review")
}

function isValidationSurface(value: unknown): value is MiniMaxLiveValidationSurface {
  return value === "research_synthesis" || value === "commander_cycle" || value === "commander_executor_review"
}

function validationCommands(surfaces: MiniMaxLiveValidationSurface[]): MiniMaxLiveValidationCommand[] {
  const surface = surfaces[0] ?? "commander_executor_review"
  return [
    { label: "Preview live validation", command: `/minimax-live-preview surface=${surface}`, command_type: "read" },
    { label: "Dry-run live validation", command: "/minimax-live-dry-run", command_type: "read" },
    { label: "Reasoning smoke preview", command: `/reasoning-smoke-preview ${surface}`, command_type: "read" },
    { label: "Show validation authority", command: "/authority-show /minimax-live-validate", command_type: "read" },
  ]
}

function eventToResult(event: JsonlEvent): MiniMaxLiveValidationResult | null {
  const validationId = typeof event.validation_id === "string" ? event.validation_id : undefined
  const status = readResultStatus(event.status)
  if (!validationId || !status) return null
  const surfaces = Array.isArray(event.surfaces) ? event.surfaces.map(readSurfaceResult).filter((item): item is MiniMaxLiveValidationSurfaceResult => item !== null) : []
  const base = {
    validation_id: validationId,
    status,
    provider_kind: String(event.provider_kind ?? "unknown"),
    provider_id: String(event.provider_id ?? "unknown"),
    connector_id: typeof event.connector_id === "string" ? event.connector_id : undefined,
    model: typeof event.model === "string" ? event.model : undefined,
    surfaces,
    started_at: String(event.started_at ?? event.timestamp ?? ""),
    completed_at: String(event.completed_at ?? event.timestamp ?? ""),
    duration_ms: typeof event.duration_ms === "number" ? event.duration_ms : undefined,
    requested_by: String(event.requested_by ?? "unknown"),
    diagnostics: Array.isArray(event.diagnostics) ? event.diagnostics.map(String).slice(0, 12) : [],
    error: typeof event.error === "string" ? event.error : undefined,
  }
  return { ...base, validation_hash: typeof event.validation_hash === "string" ? event.validation_hash : hashResult(base) }
}

function readSurfaceResult(value: unknown): MiniMaxLiveValidationSurfaceResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  if (!isValidationSurface(item.surface)) return null
  const status = readSurfaceStatus(item.status)
  if (!status) return null
  return {
    surface: item.surface,
    status,
    ok: item.ok === true,
    parsed: item.parsed === true,
    request_id: typeof item.request_id === "string" ? item.request_id : undefined,
    summary_preview: typeof item.summary_preview === "string" ? item.summary_preview : undefined,
    error: typeof item.error === "string" ? item.error : undefined,
    duration_ms: typeof item.duration_ms === "number" ? item.duration_ms : undefined,
    schema_version: typeof item.schema_version === "string" ? item.schema_version : undefined,
  }
}

function readResultStatus(value: unknown): "succeeded" | "failed" | "blocked" | "skipped" | null {
  return value === "succeeded" || value === "failed" || value === "blocked" || value === "skipped" ? value : null
}

function readSurfaceStatus(value: unknown): "succeeded" | "failed" | "blocked" | "skipped" | null {
  return readResultStatus(value)
}

function hashResult(value: Omit<MiniMaxLiveValidationResult, "validation_hash"> | Record<string, unknown>): string {
  return createHash("sha256").update(stableJson(value)).digest("hex")
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function boundedText(value: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(value)
  if (bytes.byteLength <= maxBytes) return value
  const decoder = new TextDecoder("utf-8", { fatal: true })
  for (let end = maxBytes; end > 0; end -= 1) {
    try {
      return decoder.decode(bytes.slice(0, end))
    } catch {}
  }
  return ""
}
