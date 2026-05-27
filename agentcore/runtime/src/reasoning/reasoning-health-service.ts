import type { EventStore } from "../events/event-store"
import type { ExternalApiConnector } from "../external-api/api-connector-types"
import type { ExternalApiConnectorRegistry } from "../external-api/api-connector-registry"
import type { ExternalApiRequestService } from "../external-api/api-request-service"
import { redactText, redactValue } from "../security/redaction"
import type { ReasoningProviderConfig, ReasoningProviderSurface } from "./reasoning-provider-config"
import { minimaxMessagesPath } from "./minimax-provider"
import type {
  ReasoningProviderHealth,
  ReasoningProviderHealthCheck,
  ReasoningProviderSmokeInput,
  ReasoningProviderSmokePreview,
  ReasoningProviderSmokeResult,
} from "./reasoning-health-types"

const SMOKE_PREVIEW_BYTES = 1024
const ERROR_PREVIEW_BYTES = 512
const REAL_SMOKE_GATE = "NXL_REAL_REASONING_PROVIDER_SMOKE"
const AUTH_HEADER_NAMES = new Set(["authorization", "cookie", "set-cookie", "proxy-authorization", "x-api-key", "api-key", "x-auth-token", "x-access-token"])
const AUTH_HEADER_PATTERNS = [/api[_-]?key/i, /token/i, /secret/i, /password/i, /authorization/i]

export interface ReasoningProviderHealthServiceOptions {
  config: ReasoningProviderConfig
  registry: ExternalApiConnectorRegistry
  requestService: ExternalApiRequestService
  eventStore: EventStore
  env?: Record<string, string | undefined>
  now?: () => Date
}

export class ReasoningProviderHealthService {
  private readonly env: Record<string, string | undefined>
  private readonly now: () => Date

  constructor(private readonly options: ReasoningProviderHealthServiceOptions) {
    this.env = options.env ?? {}
    this.now = options.now ?? (() => new Date())
  }

  health(): ReasoningProviderHealth {
    const checks = this.options.config.kind === "fake" ? this.fakeChecks() : this.minimaxChecks()
    return redactValue({
      provider_id: this.options.config.provider_id,
      kind: this.options.config.kind,
      status: healthStatus(checks),
      enabled_for: this.options.config.enabled_for,
      connector_id: this.options.config.connector_id,
      model: this.options.config.model,
      max_input_bytes: this.options.config.max_input_bytes,
      max_output_bytes: this.options.config.max_output_bytes,
      timeout_ms: this.options.config.timeout_ms,
      checks,
      last_checked_at: this.now().toISOString(),
    })
  }

  preview(input: ReasoningProviderSmokeInput = {}): ReasoningProviderSmokePreview {
    const surface = readSurface(input.surface)
    if (this.options.config.kind === "fake") return this.fakePreview(surface)
    return this.minimaxPreview(surface)
  }

  async execute(input: ReasoningProviderSmokeInput = {}): Promise<ReasoningProviderSmokeResult> {
    const surface = readSurface(input.surface)
    const dryRun = input.dry_run === true
    if (dryRun) return this.dryRunResult(surface, input.requested_by)
    if (this.options.config.kind === "fake") return this.fakeResult(surface, input.requested_by)

    const createdAt = this.now().toISOString()
    const preview = this.minimaxPreview(surface)
    if (preview.blockers.length > 0) {
      const result = this.result({
        surface,
        ok: false,
        dryRun,
        parsed: false,
        summary: "MiniMax smoke blocked",
        error: preview.blockers.join("; "),
        createdAt,
      })
      await this.writeSmokeEvent("reasoning_provider_smoke_failed", result, input.requested_by)
      return result
    }

    try {
      const request = minimaxSmokeRequest(this.options.config, surface)
      const apiResult = await this.options.requestService.executeForInternalUse({
        connector_id: this.options.config.connector_id ?? "",
        method: "POST",
        path: minimaxMessagesPath(previewConnector(this.options.config, this.options.registry) ?? undefined),
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(request),
        requested_by: `reasoning-smoke:${redactText(input.requested_by ?? "operator")}`,
      }, {
        timeout_ms: this.options.config.timeout_ms,
        redact_response_body: false,
        omit_response_preview_from_audit: true,
      })
      if (!apiResult.ok) throw new Error(apiResult.error ?? "MiniMax smoke request failed")
      const text = textFromAnthropicResponse(apiResult.response_body_for_internal_use ?? apiResult.response_preview ?? "")
      const parsed = parseJsonObject(text)
      validateSmokePayload(parsed, surface)
      const result = this.result({
        surface,
        ok: true,
        dryRun,
        parsed: true,
        requestId: apiResult.request_id,
        summary: smokeSummary(parsed),
        createdAt,
      })
      await this.writeSmokeEvent("reasoning_provider_smoke_succeeded", result, input.requested_by)
      return result
    } catch (error) {
      const result = this.result({
        surface,
        ok: false,
        dryRun,
        parsed: false,
        summary: "MiniMax smoke failed",
        error: boundedText(error instanceof Error ? error.message : String(error), ERROR_PREVIEW_BYTES),
        createdAt,
      })
      await this.writeSmokeEvent("reasoning_provider_smoke_failed", result, input.requested_by)
      return result
    }
  }

  private fakeChecks(): ReasoningProviderHealthCheck[] {
    return [
      { name: "config", ok: true, severity: "info", summary: "fake reasoning provider configured" },
      { name: "connector", ok: true, severity: "info", summary: "fake provider does not require an external API connector" },
      { name: "network", ok: true, severity: "info", summary: "fake provider performs no network calls" },
    ]
  }

  private minimaxChecks(): ReasoningProviderHealthCheck[] {
    const checks: ReasoningProviderHealthCheck[] = []
    const connectorId = this.options.config.connector_id
    const connector = connectorId ? this.options.registry.get(connectorId) : null
    checks.push({
      name: "config",
      ok: Boolean(this.options.config.connector_id && this.options.config.model && this.options.config.enabled_for.length > 0),
      severity: this.options.config.connector_id && this.options.config.model ? "info" : "error",
      summary: this.options.config.connector_id && this.options.config.model ? "MiniMax reasoning config is complete" : "MiniMax reasoning config is incomplete",
    })
    checks.push({
      name: "connector",
      ok: Boolean(connector),
      severity: connector ? "info" : "error",
      summary: connector ? "configured external API connector exists" : "configured external API connector is missing",
      redacted_detail: connectorId ? `connector_id=${redactText(connectorId)}` : "connector_id missing",
    })
    if (connector) {
      checks.push(...this.connectorChecks(connector))
    }
    checks.push({
      name: "surface",
      ok: this.options.config.enabled_for.length > 0,
      severity: this.options.config.enabled_for.length > 0 ? "info" : "error",
      summary: `enabled surfaces: ${this.options.config.enabled_for.join(", ")}`,
    })
    checks.push({
      name: "byte_caps",
      ok: this.options.config.max_input_bytes > 0 && this.options.config.max_output_bytes > 0,
      severity: "info",
      summary: `input=${this.options.config.max_input_bytes} output=${this.options.config.max_output_bytes}`,
    })
    checks.push({
      name: "real_smoke_gate",
      ok: true,
      severity: "info",
      summary: this.env[REAL_SMOKE_GATE] === "1" ? "real MiniMax smoke gate is enabled" : "real MiniMax smoke gate is disabled",
      redacted_detail: `${REAL_SMOKE_GATE}=${this.env[REAL_SMOKE_GATE] === "1" ? "1" : "not enabled"}`,
    })
    return checks.map((check) => redactValue(check))
  }

  private connectorChecks(connector: ExternalApiConnector): ReasoningProviderHealthCheck[] {
    const credentialRefs = connector.credential_refs ?? []
    const missingCredentialRefs = credentialRefs.filter((ref) => !this.env[ref.env_name]).map((ref) => ref.name)
    const authHeaders = Object.keys(connector.default_headers ?? {}).filter((key) => isAuthBearingHeader(key))
    let messagesPathOk = true
    let messagesPath = ""
    try {
      messagesPath = minimaxMessagesPath(connector)
      messagesPathOk = messagesPath.endsWith("/v1/messages")
    } catch {
      messagesPathOk = false
    }
    return [
      {
        name: "credential_refs",
        ok: credentialRefs.length > 0,
        severity: credentialRefs.length > 0 ? "info" : "error",
        summary: credentialRefs.length > 0 ? "connector has credential refs" : "connector has no credential refs",
      },
      {
        name: "credential_env",
        ok: missingCredentialRefs.length === 0,
        severity: missingCredentialRefs.length === 0 ? "info" : "error",
        summary: missingCredentialRefs.length === 0 ? "credential env refs are present" : "credential env refs are missing",
        redacted_detail: missingCredentialRefs.length === 0 ? undefined : `missing refs: ${missingCredentialRefs.map(redactText).join(", ")}`,
      },
      {
        name: "messages_path",
        ok: messagesPathOk,
        severity: messagesPathOk ? "info" : "error",
        summary: messagesPathOk ? "connector can produce /v1/messages request path" : "connector cannot produce /v1/messages request path",
        redacted_detail: messagesPath ? `path=${redactText(messagesPath)}` : undefined,
      },
      {
        name: "request_policy",
        ...this.requestPolicyCheck(connector),
      },
      {
        name: "default_headers",
        ok: authHeaders.length === 0,
        severity: authHeaders.length === 0 ? "info" : "error",
        summary: authHeaders.length === 0 ? "connector default headers do not carry credentials" : "connector default headers must not carry credentials",
        redacted_detail: authHeaders.length === 0 ? undefined : `headers=${authHeaders.map(redactText).join(", ")}`,
      },
    ]
  }

  private requestPolicyCheck(connector: ExternalApiConnector): Omit<ReasoningProviderHealthCheck, "name"> {
    try {
      const preview = this.options.requestService.preview({
        connector_id: connector.connector_id,
        method: "POST",
        path: minimaxMessagesPath(connector),
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(minimaxSmokeRequest(this.options.config, this.options.config.enabled_for[0] ?? "research_synthesis")),
        requested_by: "reasoning-health",
      })
      return {
        ok: preview.allowed,
        severity: preview.allowed ? "info" : "error",
        summary: preview.allowed ? "connector policy allows MiniMax smoke request" : "connector policy blocks MiniMax smoke request",
        redacted_detail: preview.blockers.length > 0 ? preview.blockers.join("; ") : undefined,
      }
    } catch (error) {
      return {
        ok: false,
        severity: "error",
        summary: "connector policy preview failed",
        redacted_detail: boundedText(error instanceof Error ? error.message : String(error), ERROR_PREVIEW_BYTES),
      }
    }
  }

  private fakePreview(surface: ReasoningProviderSurface): ReasoningProviderSmokePreview {
    const body = JSON.stringify({ provider: "fake", surface, schema: "strict-json-smoke" })
    return redactValue({
      provider_id: this.options.config.provider_id,
      kind: "fake",
      surface,
      would_call_network: false,
      prompt_bytes: byteLength(body),
      max_output_bytes: this.options.config.max_output_bytes,
      blockers: [],
      redacted_request_preview: boundedText(body, SMOKE_PREVIEW_BYTES),
    })
  }

  private minimaxPreview(surface: ReasoningProviderSurface): ReasoningProviderSmokePreview {
    const connector = previewConnector(this.options.config, this.options.registry)
    const request = minimaxSmokeRequest(this.options.config, surface)
    const body = JSON.stringify(request)
    const blockers: string[] = []
    if (!this.options.config.enabled_for.includes(surface)) blockers.push(`provider is not enabled for ${surface}`)
    if (!connector) blockers.push("configured external API connector is missing")
    if (connector && !(connector.credential_refs ?? []).length) blockers.push("connector has no credential refs")
    for (const ref of connector?.credential_refs ?? []) {
      if (!this.env[ref.env_name]) blockers.push(`credential env ref is missing: ${ref.name}`)
    }
    if (connector) {
      try {
        const requestPreview = this.options.requestService.preview({
          connector_id: connector.connector_id,
          method: "POST",
          path: minimaxMessagesPath(connector),
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body,
          requested_by: "reasoning-smoke-preview",
        })
        if (!requestPreview.allowed) blockers.push(...requestPreview.blockers)
      } catch (error) {
        blockers.push(error instanceof Error ? error.message : String(error))
      }
    }
    if (this.env[REAL_SMOKE_GATE] !== "1") blockers.push(`${REAL_SMOKE_GATE}=1 is required for real MiniMax smoke`)
    if (byteLength(body) > this.options.config.max_input_bytes) blockers.push(`smoke request exceeds max_input_bytes: ${this.options.config.max_input_bytes}`)
    const dedupedBlockers = [...new Set(blockers.map(redactText))]
    return redactValue({
      provider_id: this.options.config.provider_id,
      kind: "minimax",
      surface,
      would_call_network: true,
      connector_id: this.options.config.connector_id,
      model: this.options.config.model,
      prompt_bytes: byteLength(body),
      max_output_bytes: this.options.config.max_output_bytes,
      blockers: dedupedBlockers,
      redacted_request_preview: boundedText(JSON.stringify(redactedRequestPreview(request)), SMOKE_PREVIEW_BYTES),
    })
  }

  private dryRunResult(surface: ReasoningProviderSurface, requestedBy: string | undefined): ReasoningProviderSmokeResult {
    const preview = this.preview({ surface, requested_by: requestedBy })
    return this.result({
      surface,
      ok: preview.blockers.length === 0,
      dryRun: true,
      parsed: false,
      summary: preview.blockers.length === 0 ? "reasoning provider smoke dry-run passed" : "reasoning provider smoke dry-run blocked",
      error: preview.blockers.length > 0 ? preview.blockers.join("; ") : undefined,
      createdAt: this.now().toISOString(),
    })
  }

  private async fakeResult(surface: ReasoningProviderSurface, requestedBy: string | undefined): Promise<ReasoningProviderSmokeResult> {
    const result = this.result({
      surface,
      ok: true,
      dryRun: false,
      parsed: true,
      summary: `fake ${surface} smoke parsed deterministic provider output`,
      createdAt: this.now().toISOString(),
    })
    await this.writeSmokeEvent("reasoning_provider_smoke_succeeded", result, requestedBy)
    return result
  }

  private result(input: {
    surface: ReasoningProviderSurface
    ok: boolean
    dryRun: boolean
    parsed: boolean
    summary: string
    createdAt: string
    requestId?: string
    error?: string
  }): ReasoningProviderSmokeResult {
    return redactValue({
      provider_id: this.options.config.provider_id,
      kind: this.options.config.kind,
      surface: input.surface,
      ok: input.ok,
      dry_run: input.dryRun,
      connector_id: this.options.config.connector_id,
      model: this.options.config.model,
      request_id: input.requestId,
      parsed: input.parsed,
      summary: boundedText(input.summary, 512),
      error: input.error ? boundedText(input.error, ERROR_PREVIEW_BYTES) : undefined,
      created_at: input.createdAt,
    })
  }

  private async writeSmokeEvent(kind: "reasoning_provider_smoke_succeeded" | "reasoning_provider_smoke_failed", result: ReasoningProviderSmokeResult, requestedBy: string | undefined): Promise<void> {
    await this.options.eventStore.append({
      kind,
      provider_id: result.provider_id,
      provider_kind: result.kind,
      surface: result.surface,
      ok: result.ok,
      dry_run: result.dry_run,
      connector_id: result.connector_id,
      model: result.model,
      request_id: result.request_id,
      parsed: result.parsed,
      summary: result.summary,
      error: result.error,
      requested_by: redactText(requestedBy ?? "operator"),
      created_at: result.created_at,
    })
  }
}

function healthStatus(checks: ReasoningProviderHealthCheck[]): "ok" | "degraded" | "blocked" {
  if (checks.some((check) => check.severity === "error" && !check.ok)) return "blocked"
  if (checks.some((check) => check.severity === "warning" && !check.ok)) return "degraded"
  return "ok"
}

function previewConnector(config: ReasoningProviderConfig, registry: ExternalApiConnectorRegistry): ExternalApiConnector | null {
  return config.connector_id ? registry.get(config.connector_id) : null
}

function minimaxSmokeRequest(config: ReasoningProviderConfig, surface: ReasoningProviderSurface): Record<string, unknown> {
  return {
    model: config.model ?? "",
    max_tokens: Math.max(1, Math.floor(Math.min(1024, config.max_output_bytes) / 4)),
    system: "NexusLoop reasoning provider smoke. Return strict JSON only. Do not include prose, secrets, proposals, reviews, apply actions, OpenCode control, or external API calls.",
    messages: [{
      role: "user",
      content: JSON.stringify({
        task: "reasoning_provider_smoke",
        surface,
        schema: surface === "research_synthesis" ? researchSmokeSchema() : cycleSmokeSchema(),
        evidence_ids: ["smoke_evidence"],
        synthesis_ids: ["smoke_synthesis"],
      }),
    }],
  }
}

function redactedRequestPreview(request: Record<string, unknown>): Record<string, unknown> {
  return {
    model: request.model,
    max_tokens: request.max_tokens,
    system: "[synthetic smoke system prompt omitted]",
    messages: [{ role: "user", content: "[synthetic smoke prompt omitted]" }],
  }
}

function researchSmokeSchema(): Record<string, unknown> {
  return {
    title: "string",
    summary: "string",
    findings: ["string"],
    risks: ["string"],
    open_questions: ["string"],
    recommended_actions: [{ title: "string", summary: "string", action_kind: "operator_checkpoint|other", evidence_ids: ["smoke_evidence"] }],
    confidence: "low|medium|high",
  }
}

function cycleSmokeSchema(): Record<string, unknown> {
  return {
    title: "string",
    summary: "string",
    findings: ["string"],
    risks: ["string"],
    recommended_actions: [{ title: "string", summary: "string", action_kind: "operator_checkpoint|other", rationale: "string", evidence_ids: ["smoke_evidence"], synthesis_ids: ["smoke_synthesis"] }],
    should_create_proposals: false,
    confidence: "low|medium|high",
  }
}

function textFromAnthropicResponse(value: string): string {
  let parsed: { content?: unknown }
  try {
    parsed = JSON.parse(value) as { content?: unknown }
  } catch {
    return value
  }
  if (!Array.isArray(parsed.content)) throw new Error("MiniMax response content must be an array")
  const text = parsed.content.map((block) => {
    if (typeof block === "string") return block
    if (block && typeof block === "object" && ("type" in block ? (block as { type?: unknown }).type === "text" : true) && typeof (block as { text?: unknown }).text === "string") return (block as { text: string }).text
    return ""
  }).join("\n").trim()
  if (!text) throw new Error("MiniMax response contained no text content")
  return text
}

function parseJsonObject(value: string): Record<string, unknown> {
  const stripped = stripCodeFence(value.trim())
  try {
    const parsed = JSON.parse(stripped)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("MiniMax JSON response must be an object")
    return redactValue(parsed as Record<string, unknown>)
  } catch {
    throw new Error(`MiniMax response was not valid JSON: ${boundedText(stripped, ERROR_PREVIEW_BYTES)}`)
  }
}

function stripCodeFence(value: string): string {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return match?.[1]?.trim() ?? value
}

function validateSmokePayload(value: Record<string, unknown>, surface: ReasoningProviderSurface): void {
  requiredString(value.title, "title")
  requiredString(value.summary, "summary")
  stringArray(value.findings, "findings")
  stringArray(value.risks, "risks")
  arrayOfRecords(value.recommended_actions, "recommended_actions")
  if (surface === "research_synthesis") stringArray(value.open_questions, "open_questions")
  if (surface === "commander_cycle" && value.should_create_proposals !== undefined && typeof value.should_create_proposals !== "boolean") throw new Error("should_create_proposals must be boolean")
  if (!["low", "medium", "high"].includes(String(value.confidence))) throw new Error("confidence must be low, medium, or high")
}

function smokeSummary(value: Record<string, unknown>): string {
  return requiredString(value.summary, "summary")
}

function arrayOfRecords(value: unknown, field: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${field}[${index}] must be an object`)
    return item as Record<string, unknown>
  })
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value.map((item, index) => requiredString(item, `${field}[${index}]`))
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return redactText(value.trim())
}

function readSurface(value: unknown): ReasoningProviderSurface {
  if (value === undefined || value === "research" || value === "research_synthesis") return "research_synthesis"
  if (value === "cycle" || value === "commander_cycle") return "commander_cycle"
  throw new Error("reasoning smoke surface must be research_synthesis or commander_cycle")
}

function isAuthBearingHeader(key: string): boolean {
  const normalized = key.toLowerCase()
  return AUTH_HEADER_NAMES.has(normalized) || AUTH_HEADER_PATTERNS.some((pattern) => pattern.test(key))
}

function boundedText(value: string, maxBytes: number): string {
  const redacted = redactText(value)
  const bytes = new TextEncoder().encode(redacted)
  if (bytes.byteLength <= maxBytes) return redacted
  const decoder = new TextDecoder("utf-8", { fatal: true })
  for (let end = maxBytes; end > 0; end -= 1) {
    try {
      return decoder.decode(bytes.slice(0, end))
    } catch {}
  }
  return ""
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
