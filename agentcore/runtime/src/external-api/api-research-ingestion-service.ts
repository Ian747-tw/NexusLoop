import { createHash, randomUUID } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { Artifact, Note, Source, Topic } from "../research-db/research-db"
import { redactText, redactValue } from "../security/redaction"
import type { ExternalApiRequestInput } from "./api-connector-types"
import type { ExternalApiConnectorRegistry } from "./api-connector-registry"
import type { ExternalApiRequestService } from "./api-request-service"
import type {
  ExternalApiResearchIngestionInput,
  ExternalApiResearchIngestionPreview,
  ExternalApiResearchIngestionRecord,
  ExternalApiResearchIngestionResult,
} from "./api-research-ingestion-types"

const HARD_MAX_INGESTED_BYTES = 8 * 1024
const DEFAULT_LIST_LIMIT = 20
const MAX_LIST_LIMIT = 100

export interface ExternalApiResearchDbWriter {
  getTopic(id: string): Topic | null
  addSource(input: { id?: string; topic_id: string; locator: string; title?: string; source_type: "url"; status?: "reviewed"; credibility?: string }): Source
  addNote(input: { id?: string; topic_id: string; source_id?: string; content: string; tags?: string[] }): Note
  addArtifact(input: { id?: string; topic_id: string; kind: "snapshot"; content: string; artifact_type?: "snapshot"; sha256?: string; size_bytes?: number; description?: string }): Artifact
}

export interface ExternalApiResearchIngestionServiceOptions {
  registry: ExternalApiConnectorRegistry
  requestService: ExternalApiRequestService
  eventStore: EventStore
  researchDb: ExternalApiResearchDbWriter
  now?: () => Date
  ingestionId?: () => string
}

export class ExternalApiResearchIngestionService {
  private readonly now: () => Date
  private readonly ingestionId: () => string

  constructor(private readonly options: ExternalApiResearchIngestionServiceOptions) {
    this.now = options.now ?? (() => new Date())
    this.ingestionId = options.ingestionId ?? (() => `api_ingest_${randomUUID()}`)
  }

  preview(input: ExternalApiResearchIngestionInput): ExternalApiResearchIngestionPreview {
    const normalized = normalizeInput(input)
    const requestPreview = this.options.requestService.preview(toRequestInput(normalized))
    const blockers = [...requestPreview.blockers]
    if (!this.options.researchDb.getTopic(normalized.topic_id)) blockers.push(`topic not found: ${redactText(normalized.topic_id)}`)
    return redactValue({
      connector_id: normalized.connector_id,
      topic_id: normalized.topic_id,
      method: normalized.method,
      url: requestPreview.url,
      allowed: requestPreview.allowed && blockers.length === 0,
      blockers,
      would_create_source: blockers.length === 0,
      would_create_note: blockers.length === 0,
      max_ingested_bytes: this.maxIngestedBytes(normalized.connector_id),
      credential_refs_used: requestPreview.credential_refs_used,
      redacted_headers: requestPreview.redacted_headers,
    })
  }

  async execute(input: ExternalApiResearchIngestionInput): Promise<ExternalApiResearchIngestionResult> {
    const normalized = normalizeInput(input)
    const createdAt = this.now().toISOString()
    const ingestionId = this.ingestionId()
    const preview = this.preview(normalized)
    if (!preview.allowed) {
      const result = this.failureResult(ingestionId, normalized, createdAt, preview.blockers.join("; "), normalized.dry_run === true)
      if (normalized.dry_run !== true) await this.writeRecord("external_api_research_ingestion_failed", result, normalized.requested_by)
      throw new Error(result.error ?? "external API research ingestion blocked")
    }
    if (normalized.dry_run === true) {
      return redactValue({
        ingestion_id: ingestionId,
        connector_id: normalized.connector_id,
        topic_id: normalized.topic_id,
        ok: true,
        dry_run: true,
        ingested_bytes: 0,
        response_preview: "dry run: transport not called and ResearchDb not written",
        created_at: createdAt,
      })
    }

    let requestResult
    try {
      requestResult = await this.options.requestService.execute(toRequestInput(normalized))
    } catch (error) {
      const result = this.failureResult(ingestionId, normalized, createdAt, errorMessage(error), false)
      await this.writeRecord("external_api_research_ingestion_failed", result, normalized.requested_by)
      throw new Error(`external API research ingestion failed: ${result.error ?? "request failed"}`)
    }

    if (!requestResult.ok) {
      const result = this.failureResult(ingestionId, normalized, createdAt, requestResult.error ?? "external API request failed", false, requestResult.request_id)
      await this.writeRecord("external_api_research_ingestion_failed", result, normalized.requested_by)
      throw new Error(`external API research ingestion failed: ${result.error ?? "request failed"}`)
    }

    const responsePreview = boundedText(requestResult.response_preview ?? "", this.maxIngestedBytes(normalized.connector_id))
    const ingestedBytes = byteLength(responsePreview)
    const responseHash = sha256(responsePreview)
    try {
      const source = this.options.researchDb.addSource({
        topic_id: normalized.topic_id,
        locator: requestResult.url,
        title: normalized.source_title,
        source_type: "url",
        status: "reviewed",
        credibility: `external_api:${normalized.connector_id}`,
      })
      const note = this.options.researchDb.addNote({
        topic_id: normalized.topic_id,
        source_id: source.id,
        content: noteContent(normalized, requestResult.url, requestResult.status_code, responsePreview, responseHash),
        tags: ["external-api", ...(normalized.tags ?? [])],
      })
      const artifactContent = JSON.stringify({
        connector_id: normalized.connector_id,
        request_id: requestResult.request_id,
        audit_request_id: requestResult.request_id,
        method: normalized.method,
        url: requestResult.url,
        status_code: requestResult.status_code,
        response_preview: responsePreview,
        response_sha256: responseHash,
        ingested_bytes: ingestedBytes,
        requested_by: redactText(normalized.requested_by),
        created_at: createdAt,
      })
      const artifactHash = sha256(artifactContent)
      const artifactBytes = byteLength(artifactContent)
      const artifact = this.options.researchDb.addArtifact({
        topic_id: normalized.topic_id,
        kind: "snapshot",
        artifact_type: "snapshot",
        content: artifactContent,
        sha256: artifactHash,
        size_bytes: artifactBytes,
        description: `External API response preview from ${normalized.connector_id}`,
      })
      const result: ExternalApiResearchIngestionResult = redactValue({
        ingestion_id: ingestionId,
        request_id: requestResult.request_id,
        connector_id: normalized.connector_id,
        topic_id: normalized.topic_id,
        source_id: source.id,
        note_id: note.id,
        artifact_id: artifact.id,
        audit_request_id: requestResult.request_id,
        ok: true,
        dry_run: false,
        ingested_bytes: ingestedBytes,
        response_preview: responsePreview,
        created_at: createdAt,
      })
      await this.writeRecord("external_api_research_ingestion_succeeded", result, normalized.requested_by)
      return result
    } catch (error) {
      const result = this.failureResult(ingestionId, normalized, createdAt, errorMessage(error), false, requestResult.request_id)
      await this.writeRecord("external_api_research_ingestion_failed", result, normalized.requested_by)
      throw new Error(`external API research ingestion write failed: ${result.error ?? "ResearchDb write failed"}`)
    }
  }

  async list(limit = DEFAULT_LIST_LIMIT): Promise<ExternalApiResearchIngestionRecord[]> {
    const events = await this.options.eventStore.readAll()
    return events
      .filter((event) => event.kind === "external_api_research_ingestion_succeeded" || event.kind === "external_api_research_ingestion_failed")
      .reverse()
      .slice(0, Math.max(1, Math.min(limit, MAX_LIST_LIMIT)))
      .map((event) => redactValue({
        ingestion_id: String(event.ingestion_id ?? ""),
        connector_id: String(event.connector_id ?? ""),
        topic_id: String(event.topic_id ?? ""),
        source_id: optionalEventString(event.source_id),
        note_id: optionalEventString(event.note_id),
        artifact_id: optionalEventString(event.artifact_id),
        audit_request_id: optionalEventString(event.audit_request_id),
        ok: event.ok === true,
        dry_run: event.dry_run === true,
        requested_by: String(event.requested_by ?? "unknown"),
        error: optionalEventString(event.error),
        created_at: String(event.created_at ?? event.timestamp ?? ""),
      }))
  }

  private maxIngestedBytes(connectorId: string): number {
    const connector = this.options.registry.get(connectorId)
    return Math.min(HARD_MAX_INGESTED_BYTES, connector?.max_response_bytes ?? HARD_MAX_INGESTED_BYTES)
  }

  private failureResult(ingestionId: string, input: ExternalApiResearchIngestionInput, createdAt: string, error: string, dryRun: boolean, requestId?: string): ExternalApiResearchIngestionResult {
    return redactValue({
      ingestion_id: ingestionId,
      request_id: requestId,
      connector_id: input.connector_id,
      topic_id: input.topic_id,
      audit_request_id: requestId,
      ok: false,
      dry_run: dryRun,
      ingested_bytes: 0,
      response_preview: "",
      error: redactText(error),
      created_at: createdAt,
    })
  }

  private async writeRecord(kind: "external_api_research_ingestion_succeeded" | "external_api_research_ingestion_failed", result: ExternalApiResearchIngestionResult, requestedBy: string): Promise<void> {
    await this.options.eventStore.append(redactValue({
      kind,
      ingestion_id: result.ingestion_id,
      request_id: result.request_id,
      connector_id: result.connector_id,
      topic_id: result.topic_id,
      source_id: result.source_id,
      note_id: result.note_id,
      artifact_id: result.artifact_id,
      audit_request_id: result.audit_request_id,
      ok: result.ok,
      dry_run: result.dry_run,
      requested_by: redactText(requestedBy),
      ingested_bytes: result.ingested_bytes,
      response_preview: result.response_preview,
      error: result.error,
      created_at: result.created_at,
    }))
  }
}

function normalizeInput(input: ExternalApiResearchIngestionInput): ExternalApiResearchIngestionInput {
  return {
    ...input,
    connector_id: requiredString(input.connector_id, "connector_id"),
    method: input.method,
    path: requiredString(input.path, "path"),
    query: input.query,
    headers: input.headers,
    body: input.body,
    topic_id: requiredString(input.topic_id, "topic_id"),
    source_title: requiredString(input.source_title, "source_title"),
    note_title: input.note_title ? requiredString(input.note_title, "note_title") : undefined,
    requested_by: requiredString(input.requested_by, "requested_by"),
    response_selector: readResponseSelector(input.response_selector),
    tags: cleanTags(input.tags),
    dry_run: input.dry_run === true,
  }
}

function toRequestInput(input: ExternalApiResearchIngestionInput): ExternalApiRequestInput {
  return {
    connector_id: input.connector_id,
    method: input.method,
    path: input.path,
    query: input.query,
    headers: input.headers,
    body: input.body,
    dry_run: input.dry_run,
    requested_by: input.requested_by,
  }
}

function noteContent(input: ExternalApiResearchIngestionInput, url: string, statusCode: number | undefined, responsePreview: string, responseHash: string): string {
  return redactText([
    input.note_title ? `# ${input.note_title}` : "# External API response ingestion",
    "",
    `connector_id: ${input.connector_id}`,
    `method: ${input.method}`,
    `url: ${url}`,
    `status_code: ${statusCode ?? "unknown"}`,
    `requested_by: ${input.requested_by}`,
    `response_sha256: ${responseHash}`,
    "",
    responsePreview,
  ].join("\n"))
}

function boundedText(value: string, maxBytes: number): string {
  const redacted = redactText(value)
  const bytes = new TextEncoder().encode(redacted)
  if (bytes.byteLength <= maxBytes) return redacted
  const decoder = new TextDecoder("utf-8", { fatal: true })
  for (let end = maxBytes; end > 0; end -= 1) {
    try {
      return decoder.decode(bytes.slice(0, end))
    } catch {
      // Back off until the slice ends on a valid UTF-8 boundary.
    }
  }
  return ""
}

function cleanTags(value: string[] | undefined): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error("tags must be an array")
  return value.map((tag, index) => requiredString(tag, `tags[${index}]`)).map(redactText)
}

function readResponseSelector(value: unknown): "body_preview" {
  if (value === undefined) return "body_preview"
  if (value === "body_preview") return value
  throw new Error("response_selector currently supports body_preview only")
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function errorMessage(error: unknown): string {
  return redactText(error instanceof Error ? error.message : String(error))
}

function optionalEventString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}
