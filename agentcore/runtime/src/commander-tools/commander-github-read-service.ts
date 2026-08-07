import { createHash } from "node:crypto"
import { redactText, redactValue } from "../security/redaction"
import type { ExternalApiRequestService } from "../external-api/api-request-service"
import type { ExternalApiPersistedAuditRecord, ExternalApiMethod } from "../external-api/api-connector-types"
import type { ExternalApiConnector } from "../external-api/api-connector-types"
import type { CommanderEvidenceCard } from "./commander-read-types"
import type { CommanderGithubGatewayConfig, CommanderGithubGatewayStatus, CommanderGithubReadResult, CommanderGithubReadToolId, CommanderGithubProvenance } from "./commander-github-read-types"

const REPOSITORY = /^[a-z0-9][a-z0-9_.-]{0,99}\/[a-z0-9][a-z0-9_.-]{0,99}$/
const FULL_SHA = /^[a-f0-9]{40}$/
const NUMBER = /^(?:0|[1-9][0-9]{0,8})$/
const MAX_REQUESTS = 4
const MAX_PAGES = 2
const MAX_ITEMS = 50
const MAX_BYTES = 24_000
const PAGE_SIZE = 25

type RequestSpec = { method: ExternalApiMethod; path: string; query?: Record<string, string>; body?: string }
type GatewayResponse = { body: unknown; audit: ExternalApiPersistedAuditRecord }
type Normalized = { result: Record<string, unknown>; truncated: boolean; item_count: number; normalized_bytes: number; observed_commit_sha?: string; page_count: number }

const REVIEW_THREADS_QUERY = "query CommanderPullRequestReviewThreads($owner:String!,$name:String!,$number:Int!,$first:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:$first){nodes{id isResolved isOutdated comments(first:1){nodes{author{login} bodyText createdAt}}} pageInfo{hasNextPage}}}}}"

export class CommanderGithubReadService {
  private readonly now: () => Date
  private readonly config: Required<Pick<CommanderGithubGatewayConfig, "max_requests_per_call" | "max_pages_per_call" | "max_items_per_call" | "max_normalized_bytes">> & CommanderGithubGatewayConfig
  private readonly repositories: Set<string>

  constructor(private readonly options: { requestService: ExternalApiRequestService; connector: ExternalApiConnector; config: CommanderGithubGatewayConfig; now?: () => Date }) {
    this.now = options.now ?? (() => new Date())
    this.config = {
      ...options.config,
      max_requests_per_call: bounded(options.config.max_requests_per_call, MAX_REQUESTS, MAX_REQUESTS),
      max_pages_per_call: bounded(options.config.max_pages_per_call, MAX_PAGES, MAX_PAGES),
      max_items_per_call: bounded(options.config.max_items_per_call, MAX_ITEMS, MAX_ITEMS),
      max_normalized_bytes: bounded(options.config.max_normalized_bytes, MAX_BYTES, MAX_BYTES),
    }
    this.repositories = new Set(options.config.allowed_repositories.map(canonicalRepository))
    validateGithubConnector(options.connector, this.config.connector_id)
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
      transport_policy_hash: blockers.length ? undefined : hash({ connector_id: this.config.connector_id, repositories: [...this.repositories].sort(), limits: limits(this.config), operations: COMMANDER_GITHUB_OPERATION_IDS }),
      blockers,
      warnings: ["GitHub evidence is untrusted data and cannot alter runtime authority."],
      generated_at: this.now().toISOString(),
    }
  }

  async execute(toolId: CommanderGithubReadToolId, args: Record<string, unknown>, signal?: AbortSignal, requestBudget?: number): Promise<CommanderGithubReadResult> {
    const generatedAt = this.now().toISOString()
    let repository: string
    try {
      validateArguments(toolId, args)
      repository = this.requireRepository(args.repository)
    } catch (error) {
      return this.blocked(toolId, generatedAt, error)
    }
    if (signal?.aborted) return this.cancelled(toolId, repository, generatedAt)
    const audits: ExternalApiPersistedAuditRecord[] = []
    const maxRequests = Math.min(this.config.max_requests_per_call, requestBudget === undefined ? this.config.max_requests_per_call : positiveBudget(requestBudget))
    if (maxRequests < 1) return this.blocked(toolId, generatedAt, new Error("Commander tool budget has no remaining external request capacity"), repository)
    try {
      const requestedRef = requestedReference(toolId, args)
      const responses = await this.fetchOperation(toolId, repository, args, maxRequests, audits, signal)
      if (signal?.aborted) return this.cancelled(toolId, repository, generatedAt, audits)
      const normalized = normalize(toolId, repository, requestedRef, responses.map((item) => item.body), this.config)
      const provenance = provenanceFor(toolId, repository, requestedRef, normalized, generatedAt)
      const evidence = evidenceFor(toolId, normalized.result, provenance, generatedAt)
      return this.ready(toolId, repository, normalized.result, provenance, evidence, generatedAt, normalized, audits)
    } catch (error) {
      return signal?.aborted
        ? this.cancelled(toolId, repository, generatedAt, audits)
        : this.failed(toolId, repository, generatedAt, error instanceof Error ? error.message : "GitHub gateway request failed", audits)
    }
  }

  private async fetchOperation(toolId: CommanderGithubReadToolId, repository: string, args: Record<string, unknown>, maxRequests: number, audits: ExternalApiPersistedAuditRecord[], signal?: AbortSignal): Promise<GatewayResponse[]> {
    const responses: GatewayResponse[] = []
    const request = async (spec: RequestSpec): Promise<unknown> => {
      if (signal?.aborted) throw new Error("GitHub gateway read was cancelled")
      if (responses.length >= maxRequests) throw new Error("GitHub gateway request ceiling reached before required bounded evidence was retrieved")
      const observed: ExternalApiPersistedAuditRecord[] = []
      const response = await this.options.requestService.executeForInternalUse({ connector_id: this.config.connector_id, method: spec.method, path: spec.path, query: spec.query, body: spec.body, requested_by: `commander_github_read:${toolId}` }, {
        timeout_ms: this.config.timeout_ms,
        max_response_bytes: this.config.max_response_bytes,
        redact_response_body: false,
        omit_response_preview_from_audit: true,
        abort_signal: signal,
        on_audit_persisted: (audit) => observed.push(audit),
      })
      if (observed.length !== 1) throw new Error("GitHub gateway request audit was not durably confirmed")
      audits.push(observed[0])
      if (!response.ok || !response.response_body_for_internal_use) throw new Error("GitHub gateway response was unavailable")
      let body: unknown
      try { body = JSON.parse(response.response_body_for_internal_use) } catch { throw new Error("GitHub gateway response was not valid JSON") }
      responses.push({ body, audit: observed[0] })
      return body
    }

    const number = (key: string) => requiredNumber(args[key], key)
    switch (toolId) {
      case "github.repository_get": await request({ method: "GET", path: `/repos/${repository}` }); break
      case "github.commit_get": await request({ method: "GET", path: `/repos/${repository}/commits/${fullSha(args.commit_sha)}` }); break
      case "github.issue_get": await request({ method: "GET", path: `/repos/${repository}/issues/${number("issue_number")}` }); break
      case "github.pull_request_get": {
        const pull = number("pull_number")
        await request({ method: "GET", path: `/repos/${repository}/pulls/${pull}` })
        await this.fetchPages(request, `/repos/${repository}/pulls/${pull}/files`)
        break
      }
      case "github.commit_checks": await this.fetchPages(request, `/repos/${repository}/commits/${fullSha(args.commit_sha)}/check-runs`, true); break
      case "github.pull_request_reviews": {
        const pull = number("pull_number")
        await this.fetchPages(request, `/repos/${repository}/pulls/${pull}/reviews`)
        const [owner, name] = repository.split("/")
        await request({ method: "POST", path: "/graphql", body: JSON.stringify({ query: REVIEW_THREADS_QUERY, variables: { owner, name, number: Number(pull), first: Math.min(PAGE_SIZE, this.config.max_items_per_call) } }) })
        break
      }
    }
    return responses
  }

  private async fetchPages(request: (spec: RequestSpec) => Promise<unknown>, path: string, checkRuns = false): Promise<void> {
    for (let page = 1; page <= this.config.max_pages_per_call; page += 1) {
      const raw = await request({ method: "GET", path, query: { per_page: String(PAGE_SIZE), page: String(page) } })
      const values = checkRuns ? arrayOf(requiredObject(raw).check_runs) : arrayOf(raw)
      if (values.length < PAGE_SIZE || values.length >= this.config.max_items_per_call) return
    }
  }

  private requireRepository(value: unknown): string {
    if (typeof value !== "string") throw new Error("repository is required")
    const repository = canonicalRepository(value)
    if (!this.repositories.has(repository)) throw new Error("repository is not allowlisted")
    return repository
  }

  private ready(toolId: CommanderGithubReadToolId, repository: string, result: Record<string, unknown>, provenance: CommanderGithubProvenance, evidence: CommanderEvidenceCard[], generatedAt: string, normalized: Normalized, audits: ExternalApiPersistedAuditRecord[]): CommanderGithubReadResult {
    const output: CommanderGithubReadResult = {
      status: "ready", tool_id: toolId, repository, result: redactValue(result), evidence, provenance,
      request_count: audits.length, page_count: normalized.page_count, item_count: normalized.item_count, normalized_bytes: normalized.normalized_bytes,
      truncated: normalized.truncated, external_api_audit_request_ids: audits.map((item) => item.request_id), external_api_audit_event_kinds: audits.map((item) => item.event_kind), network_called: audits.length > 0,
      blockers: [], warnings: normalized.truncated ? ["GitHub result was truncated by a fixed gateway ceiling and cannot prove completeness."] : [], generated_at: generatedAt, result_hash: "",
    }
    output.result_hash = hash({ ...output, generated_at: "", external_api_audit_request_ids: [] })
    return output
  }

  private blocked(toolId: CommanderGithubReadToolId, generatedAt: string, error: unknown, repository?: string): CommanderGithubReadResult { return base(toolId, generatedAt, "blocked", repository, error) }
  private cancelled(toolId: CommanderGithubReadToolId, repository: string, generatedAt: string, audits: ExternalApiPersistedAuditRecord[] = []): CommanderGithubReadResult { return base(toolId, generatedAt, "cancelled", repository, "GitHub gateway read was cancelled", audits) }
  private failed(toolId: CommanderGithubReadToolId, repository: string, generatedAt: string, error: string, audits: ExternalApiPersistedAuditRecord[] = []): CommanderGithubReadResult { return base(toolId, generatedAt, "failed", repository, error, audits) }
}

const COMMANDER_GITHUB_OPERATION_IDS = ["repository", "commit", "pull_request", "issue", "commit_checks", "pull_request_reviews", "review_threads"] as const

function validateArguments(toolId: CommanderGithubReadToolId, args: Record<string, unknown>): void {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("GitHub tool arguments must be an object")
  const allowed: Record<CommanderGithubReadToolId, readonly string[]> = {
    "github.repository_get": ["repository"], "github.commit_get": ["repository", "commit_sha"], "github.pull_request_get": ["repository", "pull_number"],
    "github.issue_get": ["repository", "issue_number"], "github.commit_checks": ["repository", "commit_sha"], "github.pull_request_reviews": ["repository", "pull_number"],
  }
  for (const key of Object.keys(args)) if (!allowed[toolId].includes(key)) throw new Error(`unknown GitHub ${toolId} argument: ${key}`)
  for (const key of allowed[toolId]) if (args[key] === undefined) throw new Error(`${key} is required`)
  if (toolId === "github.commit_get" || toolId === "github.commit_checks") fullSha(args.commit_sha)
  if (toolId === "github.pull_request_get" || toolId === "github.pull_request_reviews") requiredNumber(args.pull_number, "pull_number")
  if (toolId === "github.issue_get") requiredNumber(args.issue_number, "issue_number")
}

function requestedReference(toolId: CommanderGithubReadToolId, args: Record<string, unknown>): string | undefined {
  if (toolId === "github.commit_get" || toolId === "github.commit_checks") return fullSha(args.commit_sha)
  if (toolId === "github.pull_request_get" || toolId === "github.pull_request_reviews") return `pull:${requiredNumber(args.pull_number, "pull_number")}`
  if (toolId === "github.issue_get") return `issue:${requiredNumber(args.issue_number, "issue_number")}`
  return undefined
}

function normalize(toolId: CommanderGithubReadToolId, repository: string, requestedRef: string | undefined, responses: unknown[], config: { max_items_per_call: number; max_normalized_bytes: number; max_pages_per_call: number }): Normalized {
  const evidence = normalizeOperation(toolId, responses, config.max_items_per_call, config.max_pages_per_call)
  const result = { repository, operation: toolId, requested_ref: requestedRef, evidence }
  const encoded = JSON.stringify(redactValue(result))
  if (Buffer.byteLength(encoded) > config.max_normalized_bytes) throw new Error("GitHub normalized evidence exceeds the fixed gateway byte ceiling")
  const items = Array.isArray(evidence.items) ? evidence.items.length : 1
  return { result, truncated: evidence.truncated === true, item_count: items, normalized_bytes: Buffer.byteLength(encoded), observed_commit_sha: typeof evidence.observed_commit_sha === "string" ? evidence.observed_commit_sha : undefined, page_count: responses.length }
}

function normalizeOperation(toolId: CommanderGithubReadToolId, responses: unknown[], itemCap: number, pageCap: number): Record<string, unknown> {
  const first = responses[0]
  if (toolId === "github.repository_get") { const object = requiredObject(first); return { name: safeText(object.name, 120), description_preview: safeText(object.description, 500), default_branch: safeText(object.default_branch, 120), visibility: safeText(object.visibility, 32), archived: object.archived === true, private: object.private === true, truncated: false } }
  if (toolId === "github.commit_get") { const object = requiredObject(first); return { sha: safeSha(object.sha), observed_commit_sha: safeSha(object.sha), message_preview: safeText(nested(object, "commit", "message"), 500), author_login: safeText(nested(object, "author", "login"), 120), authored_at: safeTimestamp(nested3(object, "commit", "author", "date")), parent_shas: arrayOf(object.parents).slice(0, 8).map((item) => safeSha(requiredObject(item).sha)).filter(Boolean), truncated: false } }
  if (toolId === "github.issue_get") { const object = requiredObject(first); return { number: safePositive(object.number), title_preview: safeText(object.title, 500), body_preview: safeText(object.body, 1200), state: safeText(object.state, 32), updated_at: safeTimestamp(object.updated_at), author_login: safeText(nested(object, "user", "login"), 120), labels: labels(object), truncated: false } }
  if (toolId === "github.pull_request_get") {
    const object = requiredObject(first)
    const files = boundedItems(responses.slice(1).flatMap((page) => arrayOf(page)).map((item) => { const value = requiredObject(item); return { filename: safeText(value.filename, 500), status: safeText(value.status, 64), additions: safeNonNegative(value.additions), deletions: safeNonNegative(value.deletions), changes: safeNonNegative(value.changes), sha: safeSha(value.sha) } }), itemCap)
    const paginationTruncated = responses.length - 1 >= pageCap && arrayOf(responses.at(-1)).length >= PAGE_SIZE
    return { number: safePositive(object.number), title_preview: safeText(object.title, 500), state: safeText(object.state, 32), draft: object.draft === true, updated_at: safeTimestamp(object.updated_at), head_sha: safeSha(nested(object, "head", "sha")), base_sha: safeSha(nested(object, "base", "sha")), changed_files: safePositive(object.changed_files), labels: labels(object), files: files.items, truncated: files.truncated || paginationTruncated }
  }
  if (toolId === "github.commit_checks") {
    const pages = responses.map(requiredObject)
    const head = pages[0]
    const checks = boundedItems(pages.flatMap((page) => arrayOf(page.check_runs)).map((item) => { const value = requiredObject(item); return { name: safeText(value.name, 240), status: safeText(value.status, 64), conclusion: safeText(value.conclusion, 64), started_at: safeTimestamp(value.started_at), completed_at: safeTimestamp(value.completed_at) } }), itemCap)
    const paginationTruncated = pages.length >= pageCap && arrayOf(pages.at(-1)?.check_runs).length >= PAGE_SIZE
    return { commit_sha: safeSha(head.head_sha), observed_commit_sha: safeSha(head.head_sha), total_count: safeNonNegative(head.total_count), items: checks.items, truncated: checks.truncated || paginationTruncated || checks.items.length < (safeNonNegative(head.total_count) ?? 0) }
  }
  const reviewPages = responses.slice(0, -1)
  const reviews = boundedItems(reviewPages.flatMap((page) => arrayOf(page)).map((item) => { const value = requiredObject(item); return { id: safePositive(value.id), state: safeText(value.state, 64), user_login: safeText(nested(value, "user", "login"), 120), submitted_at: safeTimestamp(value.submitted_at), body_preview: safeText(value.body, 600), commit_id: safeSha(value.commit_id) } }), itemCap)
  const graph = requiredObject(responses[responses.length - 1])
  const threads = threadSummary(graph, itemCap)
  const paginationTruncated = reviewPages.length >= pageCap && arrayOf(reviewPages.at(-1)).length >= PAGE_SIZE
  return { items: reviews.items, thread_state: threads, truncated: reviews.truncated || threads.truncated || paginationTruncated }
}

function threadSummary(raw: Record<string, unknown>, cap: number): Record<string, unknown> {
  const repository = requiredObject(raw.data)
  const pull = requiredObject(repository.repository)
  const threadConnection = requiredObject(pull.pullRequest)
  const threads = requiredObject(threadConnection.reviewThreads)
  const nodes = arrayOf(threads.nodes).slice(0, cap).map((item) => {
    const thread = requiredObject(item)
    const comments = requiredObject(thread.comments)
    const comment = arrayOf(comments.nodes)[0]
    return { thread_id: safeText(thread.id, 160), resolved: thread.isResolved === true, outdated: thread.isOutdated === true, author_login: comment ? safeText(nested(requiredObject(comment), "author", "login"), 120) : undefined, body_preview: comment ? safeText(requiredObject(comment).bodyText, 600) : undefined, created_at: comment ? safeTimestamp(requiredObject(comment).createdAt) : undefined }
  })
  const pageInfo = requiredObject(threads.pageInfo)
  const unresolvedCurrent = nodes.filter((node) => node.resolved !== true && node.outdated !== true).length
  return { thread_count: nodes.length, unresolved_current_count: unresolvedCurrent, items: nodes, completeness: pageInfo.hasNextPage === true || arrayOf(threads.nodes).length > cap ? "unknown_truncated" : "bounded_complete", truncated: pageInfo.hasNextPage === true || arrayOf(threads.nodes).length > cap }
}

function boundedItems<T>(items: T[], cap: number): { items: T[]; truncated: boolean } { return { items: items.slice(0, cap), truncated: items.length > cap } }
function labels(object: Record<string, unknown>): string[] { return arrayOf(object.labels).slice(0, 20).map((item) => safeText(requiredObject(item).name, 100)).filter((item): item is string => Boolean(item)) }
function provenanceFor(toolId: CommanderGithubReadToolId, repository: string, requestedRef: string | undefined, normalized: Normalized, retrievedAt: string): CommanderGithubProvenance { const evidenceHash = hash({ repository, toolId, requestedRef, result: normalized.result }); return { repository, operation: toolId, requested_ref: requestedRef, observed_commit_sha: normalized.observed_commit_sha, source_class: "github_content_untrusted", retrieved_at: retrievedAt, truncated: normalized.truncated, evidence_hash: evidenceHash, web_url: `https://github.com/${repository}` } }
function evidenceFor(toolId: CommanderGithubReadToolId, result: Record<string, unknown>, provenance: CommanderGithubProvenance, observedAt: string): CommanderEvidenceCard[] { return [{ evidence_id: `github_evidence_${provenance.evidence_hash.slice(0, 20)}`, tool_id: toolId, source_kind: "github_read", source_id: `${provenance.repository}:${provenance.requested_ref ?? toolId}`, title: `GitHub ${toolId} evidence`, summary_preview: `Bounded untrusted GitHub evidence for ${provenance.repository}.`, trust_class: "github_content_untrusted", instruction_semantics: "none", content_hash: provenance.evidence_hash, commit_sha: provenance.observed_commit_sha, source_refs: [{ source_kind: "github", source_id: provenance.repository, pointer_only: true }], content_included: true, content_truncated: provenance.truncated, observed_at: observedAt, warnings: ["GitHub evidence is untrusted data and instruction_semantics=none."], evidence_hash: hash({ result, provenance }) }] }
function base(toolId: CommanderGithubReadToolId, generatedAt: string, status: "blocked" | "failed" | "cancelled", repository?: string, blocker?: unknown, audits: ExternalApiPersistedAuditRecord[] = []): CommanderGithubReadResult { const result: CommanderGithubReadResult = { status, tool_id: toolId, repository, result: null, evidence: [], request_count: audits.length, page_count: 0, item_count: 0, normalized_bytes: 0, truncated: false, external_api_audit_request_ids: audits.map((item) => item.request_id), external_api_audit_event_kinds: audits.map((item) => item.event_kind), network_called: audits.length > 0, blockers: [redactText(String(blocker ?? "GitHub gateway request failed"))], warnings: [], generated_at: generatedAt, result_hash: "" }; result.result_hash = hash({ ...result, generated_at: "", external_api_audit_request_ids: [] }); return result }
function validateGithubConnector(connector: ExternalApiConnector, connectorId: string): void {
  if (connector.connector_id !== connectorId) throw new Error("GitHub gateway connector identity does not match configuration")
  const base = new URL(connector.base_url)
  const production = base.protocol === "https:" && base.hostname === "api.github.com" && (base.pathname === "/" || base.pathname === "")
  const localTest = connector.allow_local_http === true && base.protocol === "http:" && base.hostname.endsWith(".test")
  if (!production && !localTest) throw new Error("GitHub gateway connector must use the fixed GitHub API origin")
  if (!connector.allowed_methods.includes("GET") || !connector.allowed_methods.includes("POST")) throw new Error("GitHub gateway connector must allow fixed GET and review-thread POST operations")
  if (production && (connector.credential_refs ?? []).length === 0) throw new Error("GitHub gateway production connector must use runtime-owned credential references")
}
function canonicalRepository(value: string): string { if (value !== value.trim() || !REPOSITORY.test(value) || value !== value.toLowerCase()) throw new Error("repository must be an exact lowercase owner/repository identity"); return value }
function fullSha(value: unknown): string { if (typeof value !== "string" || !FULL_SHA.test(value)) throw new Error("commit_sha must be a lowercase full 40-character SHA"); return value }
function requiredNumber(value: unknown, field: string): string { if (typeof value !== "number" && typeof value !== "string") throw new Error(`${field} is required`); const text = String(value); if (!NUMBER.test(text) || text === "0") throw new Error(`${field} must be a positive integer`); return text }
function bounded(value: number | undefined, fallback: number, ceiling: number): number { return Number.isInteger(value) && value! > 0 ? Math.min(value!, ceiling) : fallback }
function positiveBudget(value: number): number { return Number.isInteger(value) && value > 0 ? value : 0 }
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
