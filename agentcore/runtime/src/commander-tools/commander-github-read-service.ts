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
const MAX_RESPONSE_BYTES = 128_000
const MAX_TIMEOUT_MS = 15_000
const PAGE_SIZE = 25

type RequestSpec = { method: ExternalApiMethod; path: string; query?: Record<string, string>; body?: string }
type GatewayResponse = { body: unknown; audit: ExternalApiPersistedAuditRecord }
type OperationResponses = { responses: GatewayResponse[]; pagination_truncated: boolean; network_called: boolean }
type Normalized = { result: Record<string, unknown>; truncated: boolean; item_count: number; normalized_bytes: number; observed_commit_sha?: string; page_count: number }

const REVIEW_THREADS_QUERY = "query CommanderPullRequestReviewThreads($owner:String!,$name:String!,$number:Int!,$first:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){headRefOid reviewThreads(first:$first){nodes{id isResolved isOutdated comments(first:1){nodes{author{login} bodyText createdAt}}} pageInfo{hasNextPage}}}}}"

export class CommanderGithubReadService {
  private readonly now: () => Date
  private readonly config: Required<Pick<CommanderGithubGatewayConfig, "max_requests_per_call" | "max_pages_per_call" | "max_items_per_call" | "max_normalized_bytes" | "max_response_bytes" | "timeout_ms">> & CommanderGithubGatewayConfig
  private readonly repositories: Set<string>
  private activeReads = 0

  constructor(private readonly options: { requestService: ExternalApiRequestService; connector: ExternalApiConnector; config: CommanderGithubGatewayConfig; credentialsReady?: boolean; now?: () => Date }) {
    this.now = options.now ?? (() => new Date())
    this.config = {
      ...options.config,
      max_requests_per_call: bounded(options.config.max_requests_per_call, MAX_REQUESTS, MAX_REQUESTS),
      max_pages_per_call: bounded(options.config.max_pages_per_call, MAX_PAGES, MAX_PAGES),
      max_items_per_call: bounded(options.config.max_items_per_call, MAX_ITEMS, MAX_ITEMS),
      max_normalized_bytes: bounded(options.config.max_normalized_bytes, MAX_BYTES, MAX_BYTES),
      max_response_bytes: Math.min(options.config.max_response_bytes ?? MAX_RESPONSE_BYTES, options.connector.max_response_bytes, MAX_RESPONSE_BYTES),
      timeout_ms: Math.min(options.config.timeout_ms ?? MAX_TIMEOUT_MS, options.connector.timeout_ms, MAX_TIMEOUT_MS),
    }
    this.repositories = new Set(options.config.allowed_repositories.map(canonicalRepository))
    validateGithubConnector(options.connector, this.config.connector_id)
  }

  status(): CommanderGithubGatewayStatus {
    const blockers: string[] = []
    if (!this.config.connector_id.trim()) blockers.push("GitHub gateway connector is required")
    if (this.repositories.size === 0) blockers.push("GitHub gateway repository allowlist is empty")
    if (isProductionGithubConnector(this.options.connector) && this.options.credentialsReady !== true) blockers.push("GitHub gateway runtime-owned credential is unavailable")
    return {
      status: blockers.length ? "blocked" : "ready",
      connector_id: this.config.connector_id || undefined,
      repository_count: this.repositories.size,
      repositories: [...this.repositories].sort(),
      transport_policy_hash: blockers.length ? undefined : githubTransportPolicyHash(this.options.connector, this.config, [...this.repositories]),
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
    const readiness = this.status()
    if (readiness.status !== "ready") return this.blocked(toolId, generatedAt, new Error(readiness.blockers.join("; ")), repository)
    if (signal?.aborted) return this.cancelled(toolId, repository, generatedAt)
    const audits: ExternalApiPersistedAuditRecord[] = []
    const observation = { network_called: false }
    const maxRequests = Math.min(this.config.max_requests_per_call, requestBudget === undefined ? this.config.max_requests_per_call : positiveBudget(requestBudget))
    if (maxRequests < 1) return this.blocked(toolId, generatedAt, new Error("Commander tool budget has no remaining external request capacity"), repository)
    if (this.activeReads >= 1) return this.blocked(toolId, generatedAt, new Error("Commander GitHub gateway concurrency ceiling is active"), repository)
    this.activeReads += 1
    try {
      const requestedRef = requestedReference(toolId, args)
      const requestedCommit = requestedCommitSha(toolId, args)
      const operation = await this.fetchOperation(toolId, repository, args, maxRequests, audits, observation, signal)
      if (signal?.aborted) return this.cancelled(toolId, repository, generatedAt, audits, observation.network_called)
      const normalized = normalize(toolId, repository, requestedRef, operation.responses.map((item) => item.body), this.config, operation.pagination_truncated)
      validateObservedResource(toolId, repository, args, normalized.result)
      const normalizedEvidence = requiredObject(normalized.result.evidence)
      const exactEmptyCheckResult = toolId === "github.commit_checks" && normalizedEvidence.total_count === 0 && Array.isArray(normalizedEvidence.items) && normalizedEvidence.items.length === 0 && normalized.observed_commit_sha === undefined
      if (requestedCommit && normalized.observed_commit_sha !== requestedCommit && !exactEmptyCheckResult) {
        return this.failed(toolId, repository, generatedAt, "GitHub response did not match the exact requested commit SHA", audits, operation.network_called)
      }
      const provenance = provenanceFor(toolId, repository, requestedRef, normalized, generatedAt)
      const evidence = evidenceFor(toolId, normalized.result, provenance, generatedAt)
      return this.ready(toolId, repository, normalized.result, provenance, evidence, generatedAt, normalized, audits, operation.network_called)
    } catch (error) {
      return signal?.aborted
        ? this.cancelled(toolId, repository, generatedAt, audits, observation.network_called)
        : this.failed(toolId, repository, generatedAt, error instanceof Error ? error.message : "GitHub gateway request failed", audits, observation.network_called)
    } finally {
      this.activeReads -= 1
    }
  }

  private async fetchOperation(toolId: CommanderGithubReadToolId, repository: string, args: Record<string, unknown>, maxRequests: number, audits: ExternalApiPersistedAuditRecord[], observation: { network_called: boolean }, signal?: AbortSignal): Promise<OperationResponses> {
    const responses: GatewayResponse[] = []
    let networkCalled = false
    let paginationTruncated = false
    const request = async (spec: RequestSpec): Promise<unknown> => {
      if (signal?.aborted) throw new Error("GitHub gateway read was cancelled")
      if (responses.length >= maxRequests) throw new Error("GitHub gateway request ceiling reached before required bounded evidence was retrieved")
      const observed: ExternalApiPersistedAuditRecord[] = []
      const requestedBy = `commander_github_read:${toolId}`
      let response
      try {
        response = await this.options.requestService.executeForInternalUse({ connector_id: this.config.connector_id, method: spec.method, path: spec.path, query: spec.query, body: spec.body, requested_by: requestedBy }, {
          timeout_ms: this.config.timeout_ms,
          max_response_bytes: this.config.max_response_bytes,
          redact_response_body: false,
          omit_response_preview_from_audit: true,
          abort_signal: signal,
          on_transport_dispatched: () => { networkCalled = true; observation.network_called = true },
          on_audit_persisted: (audit) => { observed.push(audit); audits.push(audit) },
        })
      } catch (error) {
        if (observed.length !== 1) throw new Error("GitHub gateway request failed without one durable audit outcome")
        validateAudit(observed[0], this.config.connector_id, spec.method, requestedBy, false)
        throw error
      }
      if (observed.length !== 1) throw new Error("GitHub gateway request audit was not durably confirmed")
      validateAudit(observed[0], this.config.connector_id, spec.method, requestedBy, response.ok)
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
        if (maxRequests < 2) throw new Error("GitHub pull-request evidence requires at least two remaining external request slots")
        await request({ method: "GET", path: `/repos/${repository}/pulls/${pull}` })
        paginationTruncated = await this.fetchPages(request, `/repos/${repository}/pulls/${pull}/files`, false, Math.min(this.config.max_pages_per_call, maxRequests - 1))
        break
      }
      case "github.commit_checks": paginationTruncated = await this.fetchPages(request, `/repos/${repository}/commits/${fullSha(args.commit_sha)}/check-runs`, true, Math.min(this.config.max_pages_per_call, maxRequests)); break
      case "github.pull_request_reviews": {
        const pull = number("pull_number")
        if (maxRequests < 2) throw new Error("GitHub review evidence requires at least two remaining external request slots")
        paginationTruncated = await this.fetchPages(request, `/repos/${repository}/pulls/${pull}/reviews`, false, Math.min(this.config.max_pages_per_call, maxRequests - 1))
        const [owner, name] = repository.split("/")
        await request({ method: "POST", path: "/graphql", body: JSON.stringify({ query: REVIEW_THREADS_QUERY, variables: { owner, name, number: Number(pull), first: Math.min(PAGE_SIZE, this.config.max_items_per_call) } }) })
        break
      }
    }
    return { responses, pagination_truncated: paginationTruncated, network_called: networkCalled }
  }

  private async fetchPages(request: (spec: RequestSpec) => Promise<unknown>, path: string, checkRuns: boolean, pageLimit: number): Promise<boolean> {
    const pageSize = Math.min(PAGE_SIZE, this.config.max_items_per_call)
    for (let page = 1; page <= pageLimit; page += 1) {
      const raw = await request({ method: "GET", path, query: { per_page: String(pageSize), page: String(page) } })
      const values = checkRuns ? arrayOf(requiredObject(raw).check_runs) : arrayOf(raw)
      if (values.length < pageSize || values.length >= this.config.max_items_per_call) return values.length >= this.config.max_items_per_call
    }
    return true
  }

  private requireRepository(value: unknown): string {
    if (typeof value !== "string") throw new Error("repository is required")
    const repository = canonicalRepository(value)
    if (!this.repositories.has(repository)) throw new Error("repository is not allowlisted")
    return repository
  }

  private ready(toolId: CommanderGithubReadToolId, repository: string, result: Record<string, unknown>, provenance: CommanderGithubProvenance, evidence: CommanderEvidenceCard[], generatedAt: string, normalized: Normalized, audits: ExternalApiPersistedAuditRecord[], networkCalled: boolean): CommanderGithubReadResult {
    const output: CommanderGithubReadResult = {
      status: "ready", tool_id: toolId, repository, result: redactValue(result), evidence, provenance,
      request_count: audits.length, page_count: normalized.page_count, item_count: normalized.item_count, normalized_bytes: normalized.normalized_bytes,
      truncated: normalized.truncated, external_api_audit_request_ids: audits.map((item) => item.request_id), external_api_audit_event_kinds: audits.map((item) => item.event_kind), network_called: networkCalled,
      blockers: [], warnings: normalized.truncated ? ["GitHub result was truncated by a fixed gateway ceiling and cannot prove completeness."] : [], generated_at: generatedAt, result_hash: "",
    }
    output.result_hash = hash({ ...output, generated_at: "", external_api_audit_request_ids: [] })
    return output
  }

  private blocked(toolId: CommanderGithubReadToolId, generatedAt: string, error: unknown, repository?: string): CommanderGithubReadResult { return base(toolId, generatedAt, "blocked", repository, error) }
  private cancelled(toolId: CommanderGithubReadToolId, repository: string, generatedAt: string, audits: ExternalApiPersistedAuditRecord[] = [], networkCalled = false): CommanderGithubReadResult { return base(toolId, generatedAt, "cancelled", repository, "GitHub gateway read was cancelled", audits, networkCalled) }
  private failed(toolId: CommanderGithubReadToolId, repository: string, generatedAt: string, error: string, audits: ExternalApiPersistedAuditRecord[] = [], networkCalled = false): CommanderGithubReadResult { return base(toolId, generatedAt, "failed", repository, error, audits, networkCalled) }
}

const COMMANDER_GITHUB_OPERATION_IDS = ["repository", "commit", "pull_request", "issue", "commit_checks", "pull_request_reviews", "review_threads"] as const

function validateArguments(toolId: CommanderGithubReadToolId, args: Record<string, unknown>): void {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("GitHub tool arguments must be an object")
  const allowed: Record<CommanderGithubReadToolId, readonly string[]> = {
    "github.repository_get": ["repository"], "github.commit_get": ["repository", "commit_sha"], "github.pull_request_get": ["repository", "pull_number"],
    "github.issue_get": ["repository", "issue_number"], "github.commit_checks": ["repository", "commit_sha"], "github.pull_request_reviews": ["repository", "pull_number", "commit_sha"],
  }
  for (const key of Object.keys(args)) if (!allowed[toolId].includes(key)) throw new Error(`unknown GitHub ${toolId} argument: ${key}`)
  for (const key of allowed[toolId]) if (args[key] === undefined) throw new Error(`${key} is required`)
  if (toolId === "github.commit_get" || toolId === "github.commit_checks" || toolId === "github.pull_request_reviews") fullSha(args.commit_sha)
  if (toolId === "github.pull_request_get" || toolId === "github.pull_request_reviews") requiredNumber(args.pull_number, "pull_number")
  if (toolId === "github.issue_get") requiredNumber(args.issue_number, "issue_number")
}

function requestedReference(toolId: CommanderGithubReadToolId, args: Record<string, unknown>): string | undefined {
  if (toolId === "github.commit_get" || toolId === "github.commit_checks") return fullSha(args.commit_sha)
  if (toolId === "github.pull_request_get") return `pull:${requiredNumber(args.pull_number, "pull_number")}`
  if (toolId === "github.pull_request_reviews") return `pull:${requiredNumber(args.pull_number, "pull_number")}@${fullSha(args.commit_sha)}`
  if (toolId === "github.issue_get") return `issue:${requiredNumber(args.issue_number, "issue_number")}`
  return undefined
}
function requestedCommitSha(toolId: CommanderGithubReadToolId, args: Record<string, unknown>): string | undefined { return toolId === "github.commit_get" || toolId === "github.commit_checks" || toolId === "github.pull_request_reviews" ? fullSha(args.commit_sha) : undefined }

function normalize(toolId: CommanderGithubReadToolId, repository: string, requestedRef: string | undefined, responses: unknown[], config: { max_items_per_call: number; max_normalized_bytes: number; max_pages_per_call: number }, paginationTruncated: boolean): Normalized {
  const operationEvidence = normalizeOperation(toolId, responses, config.max_items_per_call, config.max_pages_per_call)
  const evidence = paginationTruncated ? { ...operationEvidence, truncated: true } : operationEvidence
  const result = boundNormalizedResult({ repository, operation: toolId, requested_ref: requestedRef, evidence }, config.max_normalized_bytes)
  const boundedEvidence = requiredObject(result.evidence)
  const encoded = JSON.stringify(result)
  const items = normalizedItemCount(boundedEvidence)
  return { result, truncated: boundedEvidence.truncated === true || paginationTruncated, item_count: items, normalized_bytes: Buffer.byteLength(encoded), observed_commit_sha: typeof boundedEvidence.observed_commit_sha === "string" ? boundedEvidence.observed_commit_sha : undefined, page_count: responses.length }
}

function normalizeOperation(toolId: CommanderGithubReadToolId, responses: unknown[], itemCap: number, pageCap: number): Record<string, unknown> {
  const first = responses[0]
  if (toolId === "github.repository_get") { const object = requiredObject(first); return { full_name: safeRepository(object.full_name), name: safeText(object.name, 120), description_preview: safeText(object.description, 500), default_branch: safeText(object.default_branch, 120), visibility: safeText(object.visibility, 32), archived: object.archived === true, private: object.private === true, truncated: false } }
  if (toolId === "github.commit_get") { const object = requiredObject(first); return { sha: safeSha(object.sha), observed_commit_sha: safeSha(object.sha), message_preview: safeText(nested(object, "commit", "message"), 500), author_login: safeText(nested(object, "author", "login"), 120), authored_at: safeTimestamp(nested3(object, "commit", "author", "date")), parent_shas: arrayOf(object.parents).slice(0, 8).map((item) => safeSha(requiredObject(item).sha)).filter(Boolean), truncated: false } }
  if (toolId === "github.issue_get") { const object = requiredObject(first); return { number: safePositive(object.number), title_preview: safeText(object.title, 500), body_preview: safeText(object.body, 1200), state: safeText(object.state, 32), updated_at: safeTimestamp(object.updated_at), author_login: safeText(nested(object, "user", "login"), 120), labels: labels(object), truncated: false } }
  if (toolId === "github.pull_request_get") {
    const object = requiredObject(first)
    const files = boundedItems(responses.slice(1).flatMap((page) => arrayOf(page)).map((item) => { const value = requiredObject(item); return { filename: safeText(value.filename, 240), status: safeText(value.status, 64), additions: safeNonNegative(value.additions), deletions: safeNonNegative(value.deletions), changes: safeNonNegative(value.changes), sha: safeSha(value.sha) } }), itemCap)
    const paginationTruncated = responses.length - 1 >= pageCap && arrayOf(responses.at(-1)).length >= PAGE_SIZE
    const changedFiles = safePositive(object.changed_files)
    return { number: safePositive(object.number), title_preview: safeText(object.title, 500), state: safeText(object.state, 32), draft: object.draft === true, updated_at: safeTimestamp(object.updated_at), head_sha: safeSha(nested(object, "head", "sha")), base_sha: safeSha(nested(object, "base", "sha")), changed_files: changedFiles, labels: labels(object), files: files.items, truncated: files.truncated || paginationTruncated || changedFiles !== undefined && files.items.length < changedFiles }
  }
  if (toolId === "github.commit_checks") {
    const pages = responses.map(requiredObject)
    const head = pages[0]
    const rawChecks = pages.flatMap((page) => arrayOf(page.check_runs))
    const checkShas = rawChecks.map((item) => safeSha(requiredObject(item).head_sha))
    const observedCommitSha = checkShas[0]
    if (rawChecks.length > 0 && (!observedCommitSha || checkShas.some((sha) => sha !== observedCommitSha))) throw new Error("GitHub check-run page identity did not match across the exact commit request")
    const checks = boundedItems(rawChecks.map((item) => {
      const value = requiredObject(item)
      const suite = value.check_suite && typeof value.check_suite === "object" && !Array.isArray(value.check_suite) ? requiredObject(value.check_suite) : undefined
      if (suite && safeSha(suite.head_sha) !== safeSha(value.head_sha)) throw new Error("GitHub check-suite identity did not match its check run")
      return {
        name: safeText(value.name, 240), status: safeText(value.status, 64), conclusion: safeText(value.conclusion, 64), started_at: safeTimestamp(value.started_at), completed_at: safeTimestamp(value.completed_at),
        check_suite: suite ? { id: safePositive(suite.id), head_sha: safeSha(suite.head_sha), status: safeText(suite.status, 64), conclusion: safeText(suite.conclusion, 64) } : undefined,
      }
    }), itemCap)
    const paginationTruncated = pages.length >= pageCap && arrayOf(pages.at(-1)?.check_runs).length >= PAGE_SIZE
    return { commit_sha: observedCommitSha, observed_commit_sha: observedCommitSha, total_count: safeNonNegative(head.total_count), items: checks.items, truncated: checks.truncated || paginationTruncated || checks.items.length < (safeNonNegative(head.total_count) ?? 0) }
  }
  const reviewPages = responses.slice(0, -1)
  const reviewCap = Math.max(1, Math.floor(itemCap / 2))
  const reviews = boundedItems(reviewPages.flatMap((page) => arrayOf(page)).map((item) => { const value = requiredObject(item); return { id: safePositive(value.id), state: safeText(value.state, 64), user_login: safeText(nested(value, "user", "login"), 120), submitted_at: safeTimestamp(value.submitted_at), body_preview: safeText(value.body, 240), commit_id: safeSha(value.commit_id) } }), reviewCap)
  const graph = requiredObject(responses[responses.length - 1])
  const threads = threadSummary(graph, Math.max(1, itemCap - reviewCap))
  const paginationTruncated = reviewPages.length >= pageCap && arrayOf(reviewPages.at(-1)).length >= PAGE_SIZE
  return { observed_commit_sha: threads.observed_commit_sha, items: reviews.items, thread_state: threads, truncated: reviews.truncated || threads.truncated || paginationTruncated }
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
    return { thread_id: safeText(thread.id, 160), resolved: thread.isResolved === true, outdated: thread.isOutdated === true, author_login: comment ? safeText(nested(requiredObject(comment), "author", "login"), 120) : undefined, body_preview: comment ? safeText(requiredObject(comment).bodyText, 240) : undefined, created_at: comment ? safeTimestamp(requiredObject(comment).createdAt) : undefined }
  })
  const pageInfo = requiredObject(threads.pageInfo)
  const unresolvedCurrent = nodes.filter((node) => node.resolved !== true && node.outdated !== true).length
  return { observed_commit_sha: safeSha(threadConnection.headRefOid), thread_count: nodes.length, unresolved_current_count: unresolvedCurrent, items: nodes, completeness: pageInfo.hasNextPage === true || arrayOf(threads.nodes).length > cap ? "unknown_truncated" : "bounded_complete", truncated: pageInfo.hasNextPage === true || arrayOf(threads.nodes).length > cap }
}

function validateObservedResource(toolId: CommanderGithubReadToolId, repository: string, args: Record<string, unknown>, result: Record<string, unknown>): void {
  const evidence = requiredObject(result.evidence)
  if (toolId === "github.repository_get" && evidence.full_name !== repository) throw new Error("GitHub response did not match the exact requested repository")
  if (toolId === "github.issue_get" && evidence.number !== requiredNumber(args.issue_number, "issue_number")) throw new Error("GitHub response did not match the exact requested issue")
  if (toolId === "github.pull_request_get" && evidence.number !== requiredNumber(args.pull_number, "pull_number")) throw new Error("GitHub response did not match the exact requested pull request")
}

function validateAudit(audit: ExternalApiPersistedAuditRecord, connectorId: string, method: ExternalApiMethod, requestedBy: string, ok: boolean): void {
  const expectedKind = ok ? "external_api_request_executed" : "external_api_request_failed"
  if (audit.connector_id !== connectorId || audit.method !== method || audit.requested_by !== requestedBy || audit.ok !== ok || audit.event_kind !== expectedKind) {
    throw new Error("GitHub gateway external request audit identity did not match the attempted request")
  }
}

function boundNormalizedResult(input: Record<string, unknown>, maxBytes: number): Record<string, unknown> {
  const result = structuredClone(redactValue(input)) as Record<string, unknown>
  if (Buffer.byteLength(JSON.stringify(result)) <= maxBytes) return result
  requiredObject(result.evidence).truncated = true
  while (Buffer.byteLength(JSON.stringify(result)) > maxBytes) {
    const arrays: unknown[][] = []
    visitStructured(result, (_parent, _key, value) => { if (Array.isArray(value) && value.length > 0) arrays.push(value) })
    arrays.sort((left, right) => Buffer.byteLength(JSON.stringify(right)) - Buffer.byteLength(JSON.stringify(left)))
    if (arrays[0]) {
      arrays[0].pop()
      continue
    }
    const strings: Array<{ parent: Record<string, unknown>; key: string; value: string }> = []
    visitStructured(result, (parent, key, value) => {
      if (typeof value === "string" && !NORMALIZED_IDENTITY_KEYS.has(key) && value.length > 16) strings.push({ parent, key, value })
    })
    strings.sort((left, right) => right.value.length - left.value.length)
    const candidate = strings[0]
    if (!candidate) throw new Error("GitHub normalized evidence identity exceeds the fixed gateway byte ceiling")
    candidate.parent[candidate.key] = candidate.value.slice(0, Math.max(16, Math.floor(candidate.value.length / 2)))
  }
  return result
}

const NORMALIZED_IDENTITY_KEYS = new Set(["repository", "operation", "requested_ref", "full_name", "sha", "commit_sha", "observed_commit_sha", "head_sha", "base_sha"])

function visitStructured(value: unknown, visitor: (parent: Record<string, unknown>, key: string, value: unknown) => void): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    visitor(value as Record<string, unknown>, key, item)
    if (item && typeof item === "object" && !Array.isArray(item)) visitStructured(item, visitor)
  }
}

function boundedItems<T>(items: T[], cap: number): { items: T[]; truncated: boolean } { return { items: items.slice(0, cap), truncated: items.length > cap } }
function normalizedItemCount(evidence: Record<string, unknown>): number { if (Array.isArray(evidence.items)) return evidence.items.length; if (Array.isArray(evidence.files)) return evidence.files.length; return 1 }
function labels(object: Record<string, unknown>): string[] { return arrayOf(object.labels).slice(0, 20).map((item) => safeText(requiredObject(item).name, 100)).filter((item): item is string => Boolean(item)) }
function provenanceFor(toolId: CommanderGithubReadToolId, repository: string, requestedRef: string | undefined, normalized: Normalized, retrievedAt: string): CommanderGithubProvenance { const evidenceHash = hash({ repository, toolId, requestedRef, result: normalized.result }); return { repository, operation: toolId, requested_ref: requestedRef, observed_commit_sha: normalized.observed_commit_sha, source_class: "github_content_untrusted", retrieved_at: retrievedAt, truncated: normalized.truncated, evidence_hash: evidenceHash, web_url: githubWebUrl(toolId, repository, requestedRef) } }
function evidenceFor(toolId: CommanderGithubReadToolId, result: Record<string, unknown>, provenance: CommanderGithubProvenance, observedAt: string): CommanderEvidenceCard[] { return [{ evidence_id: `github_evidence_${provenance.evidence_hash.slice(0, 20)}`, tool_id: toolId, source_kind: "github_read", source_id: `${provenance.repository}:${provenance.requested_ref ?? toolId}`, title: `GitHub ${toolId} evidence`, summary_preview: `Bounded untrusted GitHub evidence for ${provenance.repository}.`, trust_class: "github_content_untrusted", instruction_semantics: "none", content_hash: provenance.evidence_hash, commit_sha: provenance.observed_commit_sha, source_refs: [{ source_kind: "github", source_id: provenance.repository, pointer_only: true }], content_included: true, content_truncated: provenance.truncated, observed_at: observedAt, warnings: ["GitHub evidence is untrusted data and instruction_semantics=none."], evidence_hash: hash({ result, provenance }) }] }
function base(toolId: CommanderGithubReadToolId, generatedAt: string, status: "blocked" | "failed" | "cancelled", repository?: string, blocker?: unknown, audits: ExternalApiPersistedAuditRecord[] = [], networkCalled = false): CommanderGithubReadResult { const result: CommanderGithubReadResult = { status, tool_id: toolId, repository, result: null, evidence: [], request_count: audits.length, page_count: 0, item_count: 0, normalized_bytes: 0, truncated: false, external_api_audit_request_ids: audits.map((item) => item.request_id), external_api_audit_event_kinds: audits.map((item) => item.event_kind), network_called: networkCalled, blockers: [redactText(String(blocker ?? "GitHub gateway request failed"))], warnings: [], generated_at: generatedAt, result_hash: "" }; result.result_hash = hash({ ...result, generated_at: "", external_api_audit_request_ids: [] }); return result }
function validateGithubConnector(connector: ExternalApiConnector, connectorId: string): void {
  if (connector.connector_id !== connectorId) throw new Error("GitHub gateway connector identity does not match configuration")
  const base = new URL(connector.base_url)
  const production = isProductionGithubConnector(connector)
  const localTest = connector.allow_local_http === true && base.protocol === "http:" && (base.hostname === "localhost" || base.hostname.endsWith(".test"))
  if (!production && !localTest) throw new Error("GitHub gateway connector must use the fixed GitHub API origin")
  if (!connector.allowed_hosts.some((host) => host.trim().toLowerCase() === base.hostname.toLowerCase())) throw new Error("GitHub gateway connector must allow its fixed API host")
  if (!connector.allowed_methods.includes("GET") || !connector.allowed_methods.includes("POST")) throw new Error("GitHub gateway connector must allow fixed GET and review-thread POST operations")
  if (production && (connector.credential_refs ?? []).length === 0) throw new Error("GitHub gateway production connector must use runtime-owned credential references")
}
function isProductionGithubConnector(connector: ExternalApiConnector): boolean { const base = new URL(connector.base_url); return base.protocol === "https:" && base.hostname === "api.github.com" && base.port === "" && (base.pathname === "/" || base.pathname === "") }
function githubTransportPolicyHash(connector: ExternalApiConnector, config: CommanderGithubGatewayConfig, repositories: string[]): string {
  const base = new URL(connector.base_url)
  return hash({
    connector_id: connector.connector_id,
    origin_hash: hash(base.origin),
    allowed_hosts_hash: hash([...connector.allowed_hosts].sort()),
    allowed_methods: [...connector.allowed_methods].sort(),
    default_header_shape_hash: hash(Object.entries(connector.default_headers ?? {}).map(([key, value]) => [key.toLowerCase(), hash(value)]).sort(([a], [b]) => a.localeCompare(b))),
    credential_injection_shape_hash: hash((connector.credential_refs ?? []).map((ref) => ({ source: ref.source, inject_as: ref.inject_as, target_name: ref.target_name.toLowerCase(), prefix_hash: hash(ref.prefix ?? "") })).sort((a, b) => `${a.inject_as}:${a.target_name}`.localeCompare(`${b.inject_as}:${b.target_name}`))),
    connector_timeout_ms: connector.timeout_ms,
    connector_max_response_bytes: connector.max_response_bytes,
    allow_local_http: connector.allow_local_http === true,
    repositories: [...repositories].sort(),
    limits: { ...limits(config), max_response_bytes: config.max_response_bytes, timeout_ms: config.timeout_ms },
    operations: COMMANDER_GITHUB_OPERATION_IDS,
  })
}
function canonicalRepository(value: string): string { if (value !== value.trim() || !REPOSITORY.test(value) || value !== value.toLowerCase()) throw new Error("repository must be an exact lowercase owner/repository identity"); return value }
function fullSha(value: unknown): string { if (typeof value !== "string" || !FULL_SHA.test(value)) throw new Error("commit_sha must be a lowercase full 40-character SHA"); return value }
function requiredNumber(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || !NUMBER.test(String(value))) throw new Error(`${field} must be a positive integer`); return value }
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
function safeTimestamp(value: unknown): string | undefined { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return undefined; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString() }
function safeRepository(value: unknown): string | undefined { return typeof value === "string" && REPOSITORY.test(value) && value === value.toLowerCase() ? value : undefined }
function githubWebUrl(toolId: CommanderGithubReadToolId, repository: string, requestedRef: string | undefined): string {
  if (toolId === "github.commit_get" || toolId === "github.commit_checks") return `https://github.com/${repository}/commit/${requestedRef}`
  if ((toolId === "github.pull_request_get" || toolId === "github.pull_request_reviews") && requestedRef) return `https://github.com/${repository}/pull/${requestedRef.slice(5).split("@")[0]}`
  if (toolId === "github.issue_get" && requestedRef) return `https://github.com/${repository}/issues/${requestedRef.slice(6)}`
  return `https://github.com/${repository}`
}
