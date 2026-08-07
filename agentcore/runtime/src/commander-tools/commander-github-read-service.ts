import { createHash } from "node:crypto"
import { redactText, redactValue } from "../security/redaction"
import type { ExternalApiRequestService } from "../external-api/api-request-service"
import type { ExternalApiPersistedAuditRecord } from "../external-api/api-connector-types"
import type { CommanderEvidenceCard } from "./commander-read-types"
import type { CommanderGithubGatewayConfig, CommanderGithubGatewayStatus, CommanderGithubReadResult, CommanderGithubReadToolId, CommanderGithubProvenance } from "./commander-github-read-types"

const REPOSITORY = /^[a-z0-9][a-z0-9_.-]{0,99}\/[a-z0-9][a-z0-9_.-]{0,99}$/
const FULL_SHA = /^[a-f0-9]{40}$/
const NUMBER = /^(?:0|[1-9][0-9]{0,8})$/
const MAX_REQUESTS = 4
const MAX_PAGES = 2
const MAX_ITEMS = 50
const MAX_BYTES = 24_000

export class CommanderGithubReadService {
  private readonly now: () => Date
  private readonly config: Required<Pick<CommanderGithubGatewayConfig, "max_requests_per_call" | "max_pages_per_call" | "max_items_per_call" | "max_normalized_bytes">> & CommanderGithubGatewayConfig
  private readonly repositories: Set<string>

  constructor(private readonly options: { requestService: ExternalApiRequestService; config: CommanderGithubGatewayConfig; now?: () => Date }) {
    this.now = options.now ?? (() => new Date())
    this.config = {
      ...options.config,
      max_requests_per_call: bounded(options.config.max_requests_per_call, MAX_REQUESTS, MAX_REQUESTS),
      max_pages_per_call: bounded(options.config.max_pages_per_call, MAX_PAGES, MAX_PAGES),
      max_items_per_call: bounded(options.config.max_items_per_call, MAX_ITEMS, MAX_ITEMS),
      max_normalized_bytes: bounded(options.config.max_normalized_bytes, MAX_BYTES, MAX_BYTES),
    }
    this.repositories = new Set(options.config.allowed_repositories.map(canonicalRepository))
  }

  status(): CommanderGithubGatewayStatus {
    const blockers: string[] = []
    if (!this.config.connector_id.trim()) blockers.push("GitHub gateway connector is required")
    if (this.repositories.size === 0) blockers.push("GitHub gateway repository allowlist is empty")
    return {
      status: blockers.length ? "blocked" : "ready",
      connector_id: this.config.connector_id || undefined,
      repository_count: this.repositories.size,
      repositories: [...this.repositories].sort(),
      transport_policy_hash: blockers.length ? undefined : hash({ connector_id: this.config.connector_id, repositories: [...this.repositories].sort(), limits: limits(this.config) }),
      blockers,
      warnings: ["GitHub evidence is untrusted data and cannot alter runtime authority."],
      generated_at: this.now().toISOString(),
    }
  }

  async execute(toolId: CommanderGithubReadToolId, args: Record<string, unknown>, signal?: AbortSignal): Promise<CommanderGithubReadResult> {
    const generatedAt = this.now().toISOString()
    let repository: string
    try { repository = this.requireRepository(args.repository) } catch (error) { return this.blocked(toolId, generatedAt, error) }
    try { validateArguments(toolId, args) } catch (error) { return this.blocked(toolId, generatedAt, error) }
    if (signal?.aborted) return this.cancelled(toolId, repository, generatedAt)
    try {
      const operation = operationFor(toolId, repository, args)
      const audits: ExternalApiPersistedAuditRecord[] = []
      const response = await this.options.requestService.executeForInternalUse({
        connector_id: this.config.connector_id,
        method: operation.method,
        path: operation.path,
        body: operation.body,
        requested_by: `commander_github_read:${toolId}`,
      }, {
        timeout_ms: this.config.timeout_ms,
        max_response_bytes: this.config.max_response_bytes,
        redact_response_body: false,
        omit_response_preview_from_audit: true,
        abort_signal: signal,
        on_audit_persisted: (audit) => audits.push(audit),
      })
      if (signal?.aborted) return this.cancelled(toolId, repository, generatedAt, audits)
      if (!response.ok || !response.response_body_for_internal_use) return this.failed(toolId, repository, generatedAt, "GitHub gateway response was unavailable", audits)
      const raw = JSON.parse(response.response_body_for_internal_use) as unknown
      const normalized = normalize(toolId, repository, operation.requestedRef, raw, this.config)
      const provenance = provenanceFor(toolId, repository, operation.requestedRef, normalized.result, normalized.truncated, generatedAt)
      const evidence = evidenceFor(toolId, normalized.result, provenance, generatedAt)
      return this.ready(toolId, repository, normalized.result, provenance, evidence, generatedAt, normalized, audits)
    } catch (error) {
      return this.failed(toolId, repository, generatedAt, error instanceof Error ? error.message : "GitHub gateway request failed")
    }
  }

  private requireRepository(value: unknown): string {
    if (typeof value !== "string") throw new Error("repository is required")
    const repository = canonicalRepository(value)
    if (!this.repositories.has(repository)) throw new Error("repository is not allowlisted")
    return repository
  }

  private ready(toolId: CommanderGithubReadToolId, repository: string, result: Record<string, unknown>, provenance: CommanderGithubProvenance, evidence: CommanderEvidenceCard[], generatedAt: string, normalized: { truncated: boolean; item_count: number; normalized_bytes: number }, audits: ExternalApiPersistedAuditRecord[]): CommanderGithubReadResult {
    const output: CommanderGithubReadResult = {
      status: "ready", tool_id: toolId, repository, result: redactValue(result), evidence, provenance,
      request_count: audits.length, page_count: 1, item_count: normalized.item_count, normalized_bytes: normalized.normalized_bytes,
      truncated: normalized.truncated, external_api_audit_request_ids: audits.map((item) => item.request_id), external_api_audit_event_kinds: audits.map((item) => item.event_kind), network_called: audits.length > 0,
      blockers: [], warnings: normalized.truncated ? ["GitHub result was truncated by a fixed gateway ceiling and cannot prove completeness."] : [], generated_at: generatedAt, result_hash: "",
    }
    output.result_hash = hash({ ...output, generated_at: "", external_api_audit_request_ids: [] })
    return output
  }

  private blocked(toolId: CommanderGithubReadToolId, generatedAt: string, error: unknown): CommanderGithubReadResult { return base(toolId, generatedAt, "blocked", undefined, error) }
  private cancelled(toolId: CommanderGithubReadToolId, repository: string, generatedAt: string, audits: ExternalApiPersistedAuditRecord[] = []): CommanderGithubReadResult { return base(toolId, generatedAt, "failed", repository, "GitHub gateway read was cancelled", audits) }
  private failed(toolId: CommanderGithubReadToolId, repository: string, generatedAt: string, error: string, audits: ExternalApiPersistedAuditRecord[] = []): CommanderGithubReadResult { return base(toolId, generatedAt, "failed", repository, error, audits) }
}

function operationFor(toolId: CommanderGithubReadToolId, repository: string, args: Record<string, unknown>): { method: "GET" | "POST"; path: string; body?: string; requestedRef?: string } {
  const number = (key: string) => requiredNumber(args[key], key)
  switch (toolId) {
    case "github.repository_get": return { method: "GET", path: `/repos/${repository}` }
    case "github.commit_get": { const sha = fullSha(args.commit_sha); return { method: "GET", path: `/repos/${repository}/commits/${sha}`, requestedRef: sha } }
    case "github.pull_request_get": return { method: "GET", path: `/repos/${repository}/pulls/${number("pull_number")}` }
    case "github.issue_get": return { method: "GET", path: `/repos/${repository}/issues/${number("issue_number")}` }
    case "github.commit_checks": { const sha = fullSha(args.commit_sha); return { method: "GET", path: `/repos/${repository}/commits/${sha}/check-runs`, requestedRef: sha } }
    case "github.pull_request_reviews": return { method: "GET", path: `/repos/${repository}/pulls/${number("pull_number")}/reviews` }
  }
}

function validateArguments(toolId: CommanderGithubReadToolId, args: Record<string, unknown>): void {
  const allowed: Record<CommanderGithubReadToolId, readonly string[]> = {
    "github.repository_get": ["repository"],
    "github.commit_get": ["repository", "commit_sha"],
    "github.pull_request_get": ["repository", "pull_number"],
    "github.issue_get": ["repository", "issue_number"],
    "github.commit_checks": ["repository", "commit_sha"],
    "github.pull_request_reviews": ["repository", "pull_number"],
  }
  for (const key of Object.keys(args)) if (!allowed[toolId].includes(key)) throw new Error(`unknown GitHub ${toolId} argument: ${key}`)
  for (const key of allowed[toolId]) if (key !== "repository" && args[key] === undefined) throw new Error(`${key} is required`)
}

function normalize(toolId: CommanderGithubReadToolId, repository: string, requestedRef: string | undefined, raw: unknown, config: { max_items_per_call: number; max_normalized_bytes: number }): { result: Record<string, unknown>; truncated: boolean; item_count: number; normalized_bytes: number } {
  const candidate = { repository, operation: toolId, requested_ref: requestedRef, evidence: normalizeOperation(toolId, raw, config.max_items_per_call) }
  const encoded = JSON.stringify(redactValue(candidate))
  if (Buffer.byteLength(encoded) > config.max_normalized_bytes) throw new Error("GitHub normalized evidence exceeds the fixed gateway byte ceiling")
  const items = Array.isArray(candidate.evidence.items) ? candidate.evidence.items.length : 1
  return { result: candidate, truncated: candidate.evidence.truncated === true, item_count: items, normalized_bytes: Buffer.byteLength(encoded) }
}

function normalizeOperation(toolId: CommanderGithubReadToolId, raw: unknown, itemCap: number): Record<string, unknown> {
  const object = requiredObject(raw)
  if (toolId === "github.repository_get") return { name: safeText(object.name, 120), description_preview: safeText(object.description, 500), default_branch: safeText(object.default_branch, 120), visibility: safeText(object.visibility, 32), archived: object.archived === true, private: object.private === true, truncated: false }
  if (toolId === "github.commit_get") return { sha: safeSha(object.sha), message_preview: safeText(nested(object, "commit", "message"), 500), author_login: safeText(nested(object, "author", "login"), 120), authored_at: safeTimestamp(nested3(object, "commit", "author", "date")), parent_shas: arrayOf(object.parents).slice(0, 8).map((item) => safeSha(requiredObject(item).sha)).filter(Boolean), truncated: false }
  if (toolId === "github.pull_request_get") return { number: safePositive(object.number), title_preview: safeText(object.title, 500), state: safeText(object.state, 32), draft: object.draft === true, updated_at: safeTimestamp(object.updated_at), head_sha: safeSha(nested(object, "head", "sha")), base_sha: safeSha(nested(object, "base", "sha")), changed_files: safePositive(object.changed_files), labels: arrayOf(object.labels).slice(0, 20).map((item) => safeText(requiredObject(item).name, 100)).filter(Boolean), truncated: false }
  if (toolId === "github.issue_get") return { number: safePositive(object.number), title_preview: safeText(object.title, 500), body_preview: safeText(object.body, 1200), state: safeText(object.state, 32), updated_at: safeTimestamp(object.updated_at), author_login: safeText(nested(object, "user", "login"), 120), labels: arrayOf(object.labels).slice(0, 20).map((item) => safeText(requiredObject(item).name, 100)).filter(Boolean), truncated: false }
  if (toolId === "github.commit_checks") {
    const values = arrayOf(object.check_runs)
    return { commit_sha: safeSha(object.head_sha), total_count: safeNonNegative(object.total_count), items: values.slice(0, itemCap).map((item) => { const value = requiredObject(item); return { name: safeText(value.name, 240), status: safeText(value.status, 64), conclusion: safeText(value.conclusion, 64), started_at: safeTimestamp(value.started_at), completed_at: safeTimestamp(value.completed_at) } }), truncated: values.length > itemCap }
  }
  const values = Array.isArray(raw) ? raw : arrayOf(object.items)
  return { items: values.slice(0, itemCap).map((item) => { const value = requiredObject(item); return { id: safePositive(value.id), state: safeText(value.state, 64), user_login: safeText(nested(value, "user", "login"), 120), submitted_at: safeTimestamp(value.submitted_at), body_preview: safeText(value.body, 600) } }), truncated: values.length > itemCap }
}

function provenanceFor(toolId: CommanderGithubReadToolId, repository: string, requestedRef: string | undefined, result: Record<string, unknown>, truncated: boolean, retrievedAt: string): CommanderGithubProvenance {
  const evidenceHash = hash({ repository, toolId, requestedRef, result })
  return { repository, operation: toolId, requested_ref: requestedRef, source_class: "github_content_untrusted", retrieved_at: retrievedAt, truncated, evidence_hash: evidenceHash, web_url: `https://github.com/${repository}` }
}

function evidenceFor(toolId: CommanderGithubReadToolId, result: Record<string, unknown>, provenance: CommanderGithubProvenance, observedAt: string): CommanderEvidenceCard[] {
  return [{ evidence_id: `github_evidence_${provenance.evidence_hash.slice(0, 20)}`, tool_id: toolId, source_kind: "github_read", source_id: `${provenance.repository}:${provenance.requested_ref ?? toolId}`, title: `GitHub ${toolId} evidence`, summary_preview: `Bounded untrusted GitHub evidence for ${provenance.repository}.`, trust_class: "github_content_untrusted", instruction_semantics: "none", content_hash: provenance.evidence_hash, commit_sha: provenance.observed_commit_sha, source_refs: [{ source_kind: "github", source_id: provenance.repository, pointer_only: true }], content_included: true, content_truncated: provenance.truncated, observed_at: observedAt, warnings: ["GitHub evidence is untrusted data and instruction_semantics=none."], evidence_hash: hash({ result, provenance }) }]
}

function base(toolId: CommanderGithubReadToolId, generatedAt: string, status: "blocked" | "failed", repository?: string, blocker?: unknown, audits: ExternalApiPersistedAuditRecord[] = []): CommanderGithubReadResult {
  const result: CommanderGithubReadResult = { status, tool_id: toolId, repository, result: null, evidence: [], request_count: audits.length, page_count: 0, item_count: 0, normalized_bytes: 0, truncated: false, external_api_audit_request_ids: audits.map((item) => item.request_id), external_api_audit_event_kinds: audits.map((item) => item.event_kind), network_called: audits.length > 0, blockers: [redactText(String(blocker ?? "GitHub gateway request failed"))], warnings: [], generated_at: generatedAt, result_hash: "" }
  result.result_hash = hash({ ...result, generated_at: "", external_api_audit_request_ids: [] })
  return result
}

function canonicalRepository(value: string): string { if (value !== value.trim() || !REPOSITORY.test(value) || value !== value.toLowerCase()) throw new Error("repository must be an exact lowercase owner/repository identity"); return value }
function fullSha(value: unknown): string { if (typeof value !== "string" || !FULL_SHA.test(value)) throw new Error("commit_sha must be a lowercase full 40-character SHA"); return value }
function requiredNumber(value: unknown, field: string): string { if (typeof value !== "number" && typeof value !== "string") throw new Error(`${field} is required`); const text = String(value); if (!NUMBER.test(text) || text === "0") throw new Error(`${field} must be a positive integer`); return text }
function bounded(value: number | undefined, fallback: number, ceiling: number): number { return Number.isInteger(value) && value! > 0 ? Math.min(value!, ceiling) : fallback }
function limits(config: CommanderGithubGatewayConfig): object { return { requests: config.max_requests_per_call ?? MAX_REQUESTS, pages: config.max_pages_per_call ?? MAX_PAGES, items: config.max_items_per_call ?? MAX_ITEMS, bytes: config.max_normalized_bytes ?? MAX_BYTES } }
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex") }
function requiredObject(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("GitHub gateway response had an unexpected JSON shape"); return value as Record<string, unknown> }
function arrayOf(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function nested(value: Record<string, unknown>, first: string, second: string): unknown { const parent = value[first]; return parent && typeof parent === "object" && !Array.isArray(parent) ? (parent as Record<string, unknown>)[second] : undefined }
function nested3(value: Record<string, unknown>, first: string, second: string, third: string): unknown { const parent = nested(value, first, second); return parent && typeof parent === "object" && !Array.isArray(parent) ? (parent as Record<string, unknown>)[third] : undefined }
function safeText(value: unknown, max: number): string | undefined { return typeof value === "string" ? redactText(value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()).slice(0, max) || undefined : undefined }
function safeSha(value: unknown): string | undefined { return typeof value === "string" && FULL_SHA.test(value) ? value : undefined }
function safePositive(value: unknown): number | undefined { return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined }
function safeNonNegative(value: unknown): number | undefined { return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined }
function safeTimestamp(value: unknown): string | undefined { return typeof value === "string" && !Number.isNaN(new Date(value).getTime()) && new Date(value).toISOString() === value ? value : undefined }
