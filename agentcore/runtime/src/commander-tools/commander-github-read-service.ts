import { createHash } from "node:crypto"
import { redactText, redactValue } from "../security/redaction"
import type { ExternalApiRequestService } from "../external-api/api-request-service"
import type { ExternalApiPersistedAuditRecord, ExternalApiMethod } from "../external-api/api-connector-types"
import type { ExternalApiConnector } from "../external-api/api-connector-types"
import type { CommanderEvidenceCard } from "./commander-read-types"
import type { CommanderGithubGatewayConfig, CommanderGithubGatewayStatus, CommanderGithubReadResult, CommanderGithubReadToolId, CommanderGithubProvenance } from "./commander-github-read-types"
import { COMMANDER_GITHUB_MIN_RESPONSE_BYTES, validateCommanderGithubGatewayConfig } from "./commander-github-read-config"

const REPOSITORY = /^[a-z0-9][a-z0-9_.-]{0,99}\/[a-z0-9][a-z0-9_.-]{0,99}$/
const FULL_SHA = /^[a-f0-9]{40}$/
const NUMBER = /^(?:0|[1-9][0-9]{0,8})$/
const MAX_REQUESTS = 4
const MAX_PAGES = 2
const MAX_ITEMS = 50
const MAX_BYTES = 8_000
const MAX_RESPONSE_BYTES = 128_000
const MAX_TIMEOUT_MS = 15_000
const PAGE_SIZE = 25

type RequestSpec = { method: ExternalApiMethod; path: string; query?: Record<string, string>; body?: string }
type GatewayResponse = { body: unknown; audit: ExternalApiPersistedAuditRecord }
type OperationResponses = { responses: GatewayResponse[]; pagination_truncated: boolean; network_called: boolean }
type Normalized = { result: Record<string, unknown>; truncated: boolean; item_count: number; normalized_bytes: number; observed_commit_sha?: string; page_count: number }

const REVIEW_THREADS_QUERY = "query CommanderPullRequestReviewThreads($owner:String!,$name:String!,$number:Int!,$first:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){headRefOid reviewThreads(first:$first){nodes{id isResolved isOutdated comments(first:1){nodes{author{login} bodyText createdAt}}} pageInfo{hasNextPage}}}}}"
const PULL_REQUEST_QUERY = "query CommanderPullRequestMetadata($owner:String!,$name:String!,$number:Int!,$first:Int!,$includeDetails:Boolean!){repository(owner:$owner,name:$name){pullRequest(number:$number){number title state isDraft updatedAt headRefOid baseRefOid changedFiles labels(first:$first)@include(if:$includeDetails){totalCount nodes{name} pageInfo{hasNextPage}} files(first:$first)@include(if:$includeDetails){nodes{path changeType additions deletions} pageInfo{hasNextPage}}}}}"
const GITHUB_REQUEST_CONTRACT_HASH = hash({
  contract_version: 2,
  commit_path: "/repos/{repository}/git/commits/{full_sha}",
  pull_request_query: PULL_REQUEST_QUERY,
  review_threads_query: REVIEW_THREADS_QUERY,
})

export class CommanderGithubReadService {
  private readonly now: () => Date
  private readonly config: Required<Pick<CommanderGithubGatewayConfig, "max_requests_per_call" | "max_pages_per_call" | "max_items_per_call" | "max_normalized_bytes" | "max_response_bytes" | "timeout_ms">> & CommanderGithubGatewayConfig
  private readonly repositories: Set<string>
  private activeReads = 0

  constructor(private readonly options: { requestService: ExternalApiRequestService; connector: ExternalApiConnector; config: CommanderGithubGatewayConfig; credentialsReady?: boolean; now?: () => Date }) {
    this.now = options.now ?? (() => new Date())
    const validatedConfig = validateCommanderGithubGatewayConfig(options.config)
    this.config = {
      ...validatedConfig,
      max_requests_per_call: bounded(validatedConfig.max_requests_per_call, MAX_REQUESTS, MAX_REQUESTS),
      max_pages_per_call: bounded(validatedConfig.max_pages_per_call, MAX_PAGES, MAX_PAGES),
      max_items_per_call: bounded(validatedConfig.max_items_per_call, MAX_ITEMS, MAX_ITEMS),
      max_normalized_bytes: bounded(validatedConfig.max_normalized_bytes, MAX_BYTES, MAX_BYTES),
      max_response_bytes: Math.min(validatedConfig.max_response_bytes ?? MAX_RESPONSE_BYTES, options.connector.max_response_bytes, MAX_RESPONSE_BYTES),
      timeout_ms: Math.min(validatedConfig.timeout_ms ?? MAX_TIMEOUT_MS, options.connector.timeout_ms, MAX_TIMEOUT_MS),
    }
    this.repositories = new Set(validatedConfig.allowed_repositories.map(canonicalRepository))
    validateGithubConnector(options.connector, this.config.connector_id)
  }

  status(): CommanderGithubGatewayStatus {
    const blockers: string[] = []
    if (!this.config.connector_id.trim()) blockers.push("GitHub gateway connector is required")
    if (this.repositories.size === 0) blockers.push("GitHub gateway repository allowlist is empty")
    if (this.config.max_response_bytes < COMMANDER_GITHUB_MIN_RESPONSE_BYTES) blockers.push(`GitHub gateway effective response ceiling must be at least ${COMMANDER_GITHUB_MIN_RESPONSE_BYTES} bytes`)
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
        response = await this.options.requestService.executeForInternalUse({ connector_id: this.config.connector_id, method: spec.method, path: spec.path, query: spec.query, headers: spec.method === "POST" ? { "Content-Type": "application/json" } : undefined, body: spec.body, requested_by: requestedBy }, {
          timeout_ms: this.config.timeout_ms,
          max_response_bytes: this.config.max_response_bytes,
          redact_response_body: false,
          omit_response_preview_from_audit: true,
          omit_url_from_audit: true,
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
      case "github.commit_get": await request({ method: "GET", path: `/repos/${repository}/git/commits/${fullSha(args.commit_sha)}` }); break
      case "github.issue_get": await request({ method: "GET", path: `/repos/${repository}/issues/${number("issue_number")}` }); break
      case "github.pull_request_get": {
        const pull = number("pull_number")
        const [owner, name] = repository.split("/")
        await request({ method: "POST", path: "/graphql", body: JSON.stringify({ query: PULL_REQUEST_QUERY, variables: { owner, name, number: Number(pull), first: Math.min(PAGE_SIZE, Math.max(1, this.config.max_items_per_call - 1)), includeDetails: true } }) })
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
    let checkTotal: number | undefined
    let fetchedChecks = 0
    const checkIds = new Set<number>()
    for (let page = 1; page <= pageLimit; page += 1) {
      const raw = await request({ method: "GET", path, query: { per_page: String(pageSize), page: String(page) } })
      const checkPage = checkRuns ? requiredObject(raw) : undefined
      const values = checkPage
        ? requiredArray(checkPage.check_runs, "GitHub check-runs response")
        : requiredArray(raw, "GitHub REST list response")
      if (checkPage) {
        const pageTotal = requiredNonNegative(checkPage.total_count, "GitHub check-run total count")
        if (checkTotal !== undefined && pageTotal !== checkTotal) throw new Error("GitHub check-run total changed between pages")
        checkTotal = pageTotal
        for (const value of values) {
          const checkId = requiredPositive(requiredObject(value).id, "GitHub check-run id")
          if (checkIds.has(checkId)) throw new Error("GitHub check-run pages contained a duplicate run id")
          checkIds.add(checkId)
        }
        fetchedChecks += values.length
        if (fetchedChecks > checkTotal) throw new Error("GitHub check-run pages exceeded the authoritative total")
        if (fetchedChecks === checkTotal) return false
        if (fetchedChecks >= this.config.max_items_per_call || values.length < pageSize) return true
        continue
      }
      if (values.length < pageSize || values.length >= this.config.max_items_per_call) return values.length >= this.config.max_items_per_call
    }
    return checkRuns ? fetchedChecks < (checkTotal ?? 0) : true
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
    output.result_hash = hash(stableGatewayValue({ ...output, generated_at: "", external_api_audit_request_ids: [] }))
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
  const operationEvidence = normalizeOperation(toolId, requestedRef, responses, config.max_items_per_call, config.max_pages_per_call)
  const evidence = paginationTruncated ? { ...operationEvidence, truncated: true } : operationEvidence
  const result = boundNormalizedResult({ repository, operation: toolId, requested_ref: requestedRef, evidence }, config.max_normalized_bytes)
  const boundedEvidence = requiredObject(result.evidence)
  const encoded = JSON.stringify(result)
  const items = normalizedItemCount(boundedEvidence)
  return { result, truncated: boundedEvidence.truncated === true || paginationTruncated, item_count: items, normalized_bytes: Buffer.byteLength(encoded), observed_commit_sha: typeof boundedEvidence.observed_commit_sha === "string" ? boundedEvidence.observed_commit_sha : undefined, page_count: responses.length }
}

function normalizeOperation(toolId: CommanderGithubReadToolId, requestedRef: string | undefined, responses: unknown[], itemCap: number, pageCap: number): Record<string, unknown> {
  const first = responses[0]
  if (toolId === "github.repository_get") {
    const object = requiredObject(first)
    return { full_name: requiredRepository(object.full_name, "GitHub repository identity"), name: requiredSafeText(object.name, "GitHub repository name", 120), description_preview: nullableSafeText(object.description, "GitHub repository description", 500), default_branch: requiredSafeText(object.default_branch, "GitHub default branch", 120), visibility: requiredSafeText(object.visibility, "GitHub repository visibility", 32), archived: requiredBoolean(object.archived, "GitHub repository archived state"), private: requiredBoolean(object.private, "GitHub repository private state"), truncated: false }
  }
  if (toolId === "github.commit_get") {
    const object = requiredObject(first)
    const parentShas = requiredArray(object.parents, "GitHub commit parents").map((item) => requiredSha(requiredObject(item).sha, "GitHub commit parent SHA"))
    const parents = boundedItems(parentShas, Math.max(0, itemCap - 1))
    const author = requiredObject(object.author)
    return {
      sha: requiredSha(object.sha, "GitHub commit SHA"), observed_commit_sha: requiredSha(object.sha, "GitHub commit SHA"), message_preview: requiredSafeText(object.message, "GitHub commit message", 500), author_name_preview: requiredSafeText(author.name, "GitHub commit author name", 120), authored_at: requiredTimestamp(author.date, "GitHub commit authored timestamp"),
      parent_shas: parents.items, omitted_parent_count: parentShas.length - parents.items.length, truncated: parents.truncated,
    }
  }
  if (toolId === "github.issue_get") {
    const object = requiredObject(first)
    if ("pull_request" in object) throw new Error("GitHub issue response identified a pull request instead of an issue")
    const issueLabels = boundedRestLabels(object.labels, Math.max(0, itemCap - 1), "GitHub issue labels")
    const user = requiredObject(object.user)
    return {
      number: requiredPositive(object.number, "GitHub issue number"), title_preview: requiredSafeText(object.title, "GitHub issue title", 500), body_preview: nullableSafeText(object.body, "GitHub issue body", 1200), state: requiredSafeText(object.state, "GitHub issue state", 32), updated_at: requiredTimestamp(object.updated_at, "GitHub issue update timestamp"), author_login: requiredSafeText(user.login, "GitHub issue author", 120),
      labels: issueLabels.items, omitted_label_count: issueLabels.omitted, truncated: issueLabels.truncated,
    }
  }
  if (toolId === "github.pull_request_get") {
    const graph = requiredGraphqlData(first, "GitHub pull-request response")
    const repository = requiredObject(graph.repository)
    const object = requiredObject(repository.pullRequest)
    const detailBudget = Math.max(0, itemCap - 1)
    const changedFiles = requiredNonNegative(object.changedFiles, "GitHub pull-request changed-file count")
    const fileConnection = requiredObject(object.files)
    const labelConnection = requiredObject(object.labels)
    const rawFiles = requiredArray(fileConnection.nodes, "GitHub pull-request changed-file nodes")
    if (rawFiles.length > changedFiles) throw new Error("GitHub changed-file nodes exceeded the authoritative changed-file count")
    const normalizedFiles = rawFiles.map((item) => { const value = requiredObject(item); const additions = requiredNonNegative(value.additions, "GitHub changed-file additions"); const deletions = requiredNonNegative(value.deletions, "GitHub changed-file deletions"); return { filename: requiredSafeText(value.path, "GitHub changed-file path", 240), status: requiredSafeText(value.changeType, "GitHub changed-file status", 64), additions, deletions, changes: additions + deletions } })
    const files = boundedItems(normalizedFiles, detailBudget)
    const pullLabels = boundedGraphLabels(labelConnection, Math.max(0, detailBudget - files.items.length), "GitHub pull-request labels")
    const fileHasNext = requiredBoolean(requiredObject(fileConnection.pageInfo).hasNextPage, "GitHub changed-file pagination state")
    return { number: requiredPositive(object.number, "GitHub pull-request number"), title_preview: requiredSafeText(object.title, "GitHub pull-request title", 500), state: requiredSafeText(object.state, "GitHub pull-request state", 32), draft: requiredBoolean(object.isDraft, "GitHub pull-request draft state"), updated_at: requiredTimestamp(object.updatedAt, "GitHub pull-request update timestamp"), head_sha: requiredSha(object.headRefOid, "GitHub pull-request head SHA"), base_sha: requiredSha(object.baseRefOid, "GitHub pull-request base SHA"), changed_files: changedFiles, labels: pullLabels.items, omitted_label_count: pullLabels.omitted, files: files.items, truncated: files.truncated || pullLabels.truncated || fileHasNext || files.items.length < changedFiles }
  }
  if (toolId === "github.commit_checks") {
    const pages = responses.map(requiredObject)
    const head = pages[0]
    const totalCount = requiredNonNegative(head.total_count, "GitHub check-run total count")
    const pageTotals = pages.map((page) => requiredNonNegative(page.total_count, "GitHub check-run total count"))
    if (pageTotals.some((count) => count !== totalCount)) throw new Error("GitHub check-run total changed between pages")
    const rawChecks = pages.flatMap((page) => requiredArray(page.check_runs, "GitHub check-runs response"))
    if (rawChecks.length > totalCount) throw new Error("GitHub check-run pages exceeded the authoritative total")
    const checkIds = rawChecks.map((item) => requiredPositive(requiredObject(item).id, "GitHub check-run id"))
    if (new Set(checkIds).size !== checkIds.length) throw new Error("GitHub check-run pages contained a duplicate run id")
    const expectedCommitSha = requiredSha(requestedRef, "GitHub requested check-run commit SHA")
    const checkShas = rawChecks.map((item) => requiredSha(requiredObject(item).head_sha, "GitHub check-run head SHA"))
    if (checkShas.some((sha) => sha !== expectedCommitSha)) throw new Error("GitHub check-run page identity did not match the exact commit request")
    const checks = boundedItems(rawChecks.map((item) => {
      const value = requiredObject(item)
      const suite = requiredObject(value.check_suite)
      const headSha = requiredSha(value.head_sha, "GitHub check-run head SHA")
      const suiteHeadSha = requiredSha(suite.head_sha, "GitHub check-suite head SHA")
      if (suiteHeadSha !== headSha) throw new Error("GitHub check-suite identity did not match its check run")
      return {
        id: requiredPositive(value.id, "GitHub check-run id"), name: requiredSafeText(value.name, "GitHub check-run name", 240), status: requiredSafeText(value.status, "GitHub check-run status", 64), conclusion: nullableSafeText(value.conclusion, "GitHub check-run conclusion", 64), started_at: nullableTimestamp(value.started_at, "GitHub check-run start timestamp"), completed_at: nullableTimestamp(value.completed_at, "GitHub check-run completion timestamp"),
        check_suite: { id: requiredPositive(suite.id, "GitHub check-suite id"), head_sha: suiteHeadSha, status: requiredSafeText(suite.status, "GitHub check-suite status", 64), conclusion: nullableSafeText(suite.conclusion, "GitHub check-suite conclusion", 64) },
      }
    }), itemCap)
    return { commit_sha: expectedCommitSha, observed_commit_sha: expectedCommitSha, total_count: totalCount, items: checks.items, truncated: checks.truncated || rawChecks.length < totalCount || checks.items.length < totalCount }
  }
  const reviewPages = responses.slice(0, -1)
  const reviewValues = reviewPages.flatMap((page) => requiredArray(page, "GitHub reviews response")).map((item) => {
    const value = requiredObject(item)
    const user = requiredObject(value.user)
    return { id: requiredPositive(value.id, "GitHub review id"), state: requiredSafeText(value.state, "GitHub review state", 64), user_login: requiredSafeText(user.login, "GitHub reviewer login", 120), submitted_at: requiredTimestamp(value.submitted_at, "GitHub review submission timestamp"), body_preview: nullableSafeText(value.body, "GitHub review body", 240), commit_id: requiredSha(value.commit_id, "GitHub review commit SHA") }
  })
  const reviews = boundedItems(reviewValues, Math.min(reviewValues.length, Math.ceil(itemCap / 2)))
  const graph = requiredObject(responses[responses.length - 1])
  const threads = threadSummary(graph, itemCap - reviews.items.length)
  const paginationTruncated = reviewPages.length >= pageCap && arrayOf(reviewPages.at(-1)).length >= PAGE_SIZE
  return { observed_commit_sha: threads.observed_commit_sha, items: reviews.items, thread_state: threads, truncated: reviews.truncated || threads.truncated || paginationTruncated }
}

function threadSummary(raw: Record<string, unknown>, cap: number): Record<string, unknown> {
  if ("errors" in raw) {
    const errors = requiredArray(raw.errors, "GitHub GraphQL errors")
    if (errors.length > 0) throw new Error("GitHub GraphQL review response was partial or errored")
  }
  const repository = requiredObject(raw.data)
  const pull = requiredObject(repository.repository)
  const threadConnection = requiredObject(pull.pullRequest)
  const observedCommitSha = requiredSha(threadConnection.headRefOid, "GitHub GraphQL pull request head")
  const threads = requiredObject(threadConnection.reviewThreads)
  const rawNodes = requiredArray(threads.nodes, "GitHub GraphQL review-thread nodes")
  const nodes = rawNodes.slice(0, cap).map((item) => {
    const thread = requiredObject(item)
    const threadId = requiredString(thread.id, "GitHub GraphQL review-thread id")
    const resolved = requiredBoolean(thread.isResolved, "GitHub GraphQL review-thread resolved state")
    const outdated = requiredBoolean(thread.isOutdated, "GitHub GraphQL review-thread outdated state")
    const comments = requiredObject(thread.comments)
    const comment = requiredArray(comments.nodes, "GitHub GraphQL review-thread comments")[0]
    const commentObject = comment === undefined ? undefined : requiredObject(comment)
    if (commentObject) {
      requiredString(commentObject.bodyText, "GitHub GraphQL review comment body")
      requiredTimestamp(commentObject.createdAt, "GitHub GraphQL review comment timestamp")
    }
    return { thread_id: safeText(threadId, 160), resolved, outdated, author_login: commentObject ? safeText(nested(commentObject, "author", "login"), 120) : undefined, body_preview: commentObject ? safeText(commentObject.bodyText, 240) : undefined, created_at: commentObject ? safeTimestamp(commentObject.createdAt) : undefined }
  })
  const pageInfo = requiredObject(threads.pageInfo)
  const hasNextPage = requiredBoolean(pageInfo.hasNextPage, "GitHub GraphQL review-thread pagination state")
  const unresolvedCurrent = nodes.filter((node) => node.resolved !== true && node.outdated !== true).length
  return { observed_commit_sha: observedCommitSha, thread_count: nodes.length, unresolved_current_count: unresolvedCurrent, items: nodes, completeness: hasNextPage || rawNodes.length > cap ? "unknown_truncated" : "bounded_complete", truncated: hasNextPage || rawNodes.length > cap }
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
  const originalEvidence = structuredClone(requiredObject(result.evidence))
  requiredObject(result.evidence).truncated = true
  while (Buffer.byteLength(JSON.stringify(result)) > maxBytes) {
    const arrays: unknown[][] = []
    visitStructured(result, (_parent, _key, value) => { if (Array.isArray(value) && value.length > 0) arrays.push(value) })
    arrays.sort((left, right) => Buffer.byteLength(JSON.stringify(right)) - Buffer.byteLength(JSON.stringify(left)))
    if (arrays[0]) {
      arrays[0].pop()
      synchronizeNormalizedTruncationMetadata(requiredObject(result.evidence), originalEvidence)
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

function synchronizeNormalizedTruncationMetadata(evidence: Record<string, unknown>, original: Record<string, unknown>): void {
  synchronizeOmittedCount(evidence, original, "labels", "omitted_label_count")
  synchronizeOmittedCount(evidence, original, "parent_shas", "omitted_parent_count")
  for (const key of ["files", "items"] as const) {
    if (arrayOf(evidence[key]).length < arrayOf(original[key]).length) evidence.truncated = true
  }
  const threadState = optionalObject(evidence.thread_state)
  const originalThreadState = optionalObject(original.thread_state)
  if (!threadState || !originalThreadState) return
  const items = requiredArray(threadState.items, "normalized GitHub review-thread items")
  const originalItems = requiredArray(originalThreadState.items, "original normalized GitHub review-thread items")
  threadState.thread_count = items.length
  threadState.unresolved_current_count = items.filter((item) => {
    const thread = requiredObject(item)
    return thread.resolved !== true && thread.outdated !== true
  }).length
  if (items.length < originalItems.length) {
    threadState.truncated = true
    threadState.completeness = "unknown_truncated"
    evidence.truncated = true
  }
}

function synchronizeOmittedCount(evidence: Record<string, unknown>, original: Record<string, unknown>, arrayKey: string, countKey: string): void {
  const removed = arrayOf(original[arrayKey]).length - arrayOf(evidence[arrayKey]).length
  if (removed <= 0) return
  const existing = safeNonNegative(original[countKey]) ?? 0
  evidence[countKey] = existing + removed
  evidence.truncated = true
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
function normalizedItemCount(evidence: Record<string, unknown>): number {
  const labels = Array.isArray(evidence.labels) ? evidence.labels.length : 0
  const parents = Array.isArray(evidence.parent_shas) ? evidence.parent_shas.length : 0
  if (Array.isArray(evidence.files)) return 1 + evidence.files.length + labels
  if (!Array.isArray(evidence.items)) return 1 + labels + parents
  const items = evidence.items.length
  const threadState = evidence.thread_state && typeof evidence.thread_state === "object" && !Array.isArray(evidence.thread_state) ? evidence.thread_state as Record<string, unknown> : undefined
  const threadItems = Array.isArray(threadState?.items) ? threadState.items.length : 0
  return items + threadItems
}
function boundedRestLabels(value: unknown, cap: number, field: string): { items: string[]; omitted: number; truncated: boolean } {
  const normalized = requiredArray(value, field).map((item) => requiredSafeText(requiredObject(item).name, `${field} name`, 100))
  const items = normalized.slice(0, cap)
  return { items, omitted: normalized.length - items.length, truncated: normalized.length > items.length }
}
function boundedGraphLabels(connection: Record<string, unknown>, cap: number, field: string): { items: string[]; omitted: number; truncated: boolean } {
  const nodes = requiredArray(connection.nodes, `${field} nodes`)
  const totalCount = requiredNonNegative(connection.totalCount, `${field} total count`)
  if (totalCount < nodes.length) throw new Error(`${field} total count did not include returned nodes`)
  const normalized = nodes.map((item) => requiredSafeText(requiredObject(item).name, `${field} name`, 100))
  const hasNextPage = requiredBoolean(requiredObject(connection.pageInfo).hasNextPage, `${field} pagination state`)
  const items = normalized.slice(0, cap)
  return { items, omitted: totalCount - items.length, truncated: hasNextPage || totalCount > items.length }
}
function provenanceFor(toolId: CommanderGithubReadToolId, repository: string, requestedRef: string | undefined, normalized: Normalized, retrievedAt: string): CommanderGithubProvenance { const evidenceHash = hash({ repository, toolId, requestedRef, result: normalized.result }); return { repository, operation: toolId, requested_ref: requestedRef, observed_commit_sha: normalized.observed_commit_sha, source_class: "github_content_untrusted", retrieved_at: retrievedAt, truncated: normalized.truncated, evidence_hash: evidenceHash, web_url: githubWebUrl(toolId, repository, requestedRef) } }
function evidenceFor(toolId: CommanderGithubReadToolId, _result: Record<string, unknown>, provenance: CommanderGithubProvenance, observedAt: string): CommanderEvidenceCard[] { return [{ evidence_id: `github_evidence_${provenance.evidence_hash.slice(0, 20)}`, tool_id: toolId, source_kind: "github_read", source_id: `${provenance.repository}:${provenance.requested_ref ?? toolId}`, title: `GitHub ${toolId} evidence`, summary_preview: `Bounded untrusted GitHub evidence for ${provenance.repository}.`, trust_class: "github_content_untrusted", instruction_semantics: "none", content_hash: provenance.evidence_hash, commit_sha: provenance.observed_commit_sha, source_refs: [{ source_kind: "github", source_id: provenance.repository, pointer_only: true }], content_included: true, content_truncated: provenance.truncated, observed_at: observedAt, warnings: ["GitHub evidence is untrusted data and instruction_semantics=none."], evidence_hash: provenance.evidence_hash }] }
function base(toolId: CommanderGithubReadToolId, generatedAt: string, status: "blocked" | "failed" | "cancelled", repository?: string, blocker?: unknown, audits: ExternalApiPersistedAuditRecord[] = [], networkCalled = false): CommanderGithubReadResult { const result: CommanderGithubReadResult = { status, tool_id: toolId, repository, result: null, evidence: [], request_count: audits.length, page_count: 0, item_count: 0, normalized_bytes: 0, truncated: false, external_api_audit_request_ids: audits.map((item) => item.request_id), external_api_audit_event_kinds: audits.map((item) => item.event_kind), network_called: networkCalled, blockers: [redactText(String(blocker ?? "GitHub gateway request failed"))], warnings: [], generated_at: generatedAt, result_hash: "" }; result.result_hash = hash({ ...result, generated_at: "", external_api_audit_request_ids: [] }); return result }
function validateGithubConnector(connector: ExternalApiConnector, connectorId: string): void {
  if (connector.connector_id !== connectorId) throw new Error("GitHub gateway connector identity does not match configuration")
  const base = new URL(connector.base_url)
  const production = isProductionGithubConnector(connector)
  const localTest = connector.allow_local_http === true && base.protocol === "http:" && (base.hostname === "localhost" || base.hostname.endsWith(".test"))
  if (!production && !localTest) throw new Error("GitHub gateway connector must use the fixed GitHub API origin")
  if (!connector.allowed_hosts.some((host) => host.trim().toLowerCase() === base.hostname.toLowerCase())) throw new Error("GitHub gateway connector must allow its fixed API host")
  if (!connector.allowed_methods.includes("GET") || !connector.allowed_methods.includes("POST")) throw new Error("GitHub gateway connector must allow fixed GET and review-thread POST operations")
  const credentialRefs = connector.credential_refs ?? []
  if (production && (credentialRefs.length !== 1 || !isGithubAuthorizationCredential(credentialRefs[0]!))) {
    throw new Error("GitHub gateway production connector must use a runtime-owned Authorization credential with a supported scheme")
  }
}
function isGithubAuthorizationCredential(ref: NonNullable<ExternalApiConnector["credential_refs"]>[number]): boolean {
  return ref.inject_as === "header"
    && ref.target_name.toLowerCase() === "authorization"
    && (ref.prefix === "Bearer " || ref.prefix === "token ")
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
    request_contract_hash: GITHUB_REQUEST_CONTRACT_HASH,
  })
}
function canonicalRepository(value: string): string { if (value !== value.trim() || !REPOSITORY.test(value) || value !== value.toLowerCase()) throw new Error("repository must be an exact lowercase owner/repository identity"); return value }
function fullSha(value: unknown): string { if (typeof value !== "string" || !FULL_SHA.test(value)) throw new Error("commit_sha must be a lowercase full 40-character SHA"); return value }
function requiredNumber(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || !NUMBER.test(String(value))) throw new Error(`${field} must be a positive integer`); return value }
function bounded(value: number | undefined, fallback: number, ceiling: number): number { return Number.isInteger(value) && value! > 0 ? Math.min(value!, ceiling) : fallback }
function positiveBudget(value: number): number { return Number.isInteger(value) && value > 0 ? value : 0 }
function limits(config: CommanderGithubGatewayConfig): object { return { requests: config.max_requests_per_call ?? MAX_REQUESTS, pages: config.max_pages_per_call ?? MAX_PAGES, items: config.max_items_per_call ?? MAX_ITEMS, bytes: config.max_normalized_bytes ?? MAX_BYTES } }
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex") }
function stableGatewayValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableGatewayValue)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "generated_at" && key !== "observed_at" && key !== "retrieved_at")
    .map(([key, nested]) => [key, stableGatewayValue(nested)]))
}
function requiredObject(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("GitHub gateway response had an unexpected JSON shape"); return value as Record<string, unknown> }
function optionalObject(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined }
function requiredArray(value: unknown, field: string): unknown[] { if (!Array.isArray(value)) throw new Error(`${field} had an unexpected JSON shape`); return value }
function requiredString(value: unknown, field: string): string { if (typeof value !== "string" || !value) throw new Error(`${field} had an unexpected JSON shape`); return value }
function requiredBoolean(value: unknown, field: string): boolean { if (typeof value !== "boolean") throw new Error(`${field} had an unexpected JSON shape`); return value }
function requiredSha(value: unknown, field: string): string { if (typeof value !== "string" || !FULL_SHA.test(value)) throw new Error(`${field} had an unexpected JSON shape`); return value }
function requiredTimestamp(value: unknown, field: string): string { const timestamp = safeTimestamp(value); if (!timestamp) throw new Error(`${field} had an unexpected JSON shape`); return timestamp }
function requiredPositive(value: unknown, field: string): number { const result = safePositive(value); if (result === undefined) throw new Error(`${field} had an unexpected JSON shape`); return result }
function requiredNonNegative(value: unknown, field: string): number { const result = safeNonNegative(value); if (result === undefined) throw new Error(`${field} had an unexpected JSON shape`); return result }
function requiredRepository(value: unknown, field: string): string { const result = safeRepository(value); if (!result) throw new Error(`${field} had an unexpected JSON shape`); return result }
function requiredSafeText(value: unknown, field: string, max: number): string { if (typeof value !== "string") throw new Error(`${field} had an unexpected JSON shape`); return redactText(value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()).slice(0, max) }
function nullableSafeText(value: unknown, field: string, max: number): string | undefined { if (value === null) return undefined; if (value === undefined) throw new Error(`${field} had an unexpected JSON shape`); return requiredSafeText(value, field, max) }
function nullableTimestamp(value: unknown, field: string): string | undefined { if (value === null) return undefined; if (value === undefined) throw new Error(`${field} had an unexpected JSON shape`); return requiredTimestamp(value, field) }
function requiredGraphqlData(value: unknown, field: string): Record<string, unknown> { const raw = requiredObject(value); if ("errors" in raw && requiredArray(raw.errors, `${field} errors`).length > 0) throw new Error(`${field} was partial or errored`); return requiredObject(raw.data) }
function arrayOf(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function nested(value: Record<string, unknown>, first: string, second: string): unknown { const parent = value[first]; return parent && typeof parent === "object" && !Array.isArray(parent) ? (parent as Record<string, unknown>)[second] : undefined }
function nested3(value: Record<string, unknown>, first: string, second: string, third: string): unknown { const parent = nested(value, first, second); return parent && typeof parent === "object" && !Array.isArray(parent) ? (parent as Record<string, unknown>)[third] : undefined }
function safeText(value: unknown, max: number): string | undefined { return typeof value === "string" ? redactText(value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()).slice(0, max) || undefined : undefined }
function safeSha(value: unknown): string | undefined { return typeof value === "string" && FULL_SHA.test(value) ? value : undefined }
function safePositive(value: unknown): number | undefined { return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined }
function safeNonNegative(value: unknown): number | undefined { return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined }
function safeTimestamp(value: unknown): string | undefined { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return undefined; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString() }
function safeRepository(value: unknown): string | undefined {
  if (typeof value !== "string" || value !== value.trim()) return undefined
  const canonical = value.toLowerCase()
  return REPOSITORY.test(canonical) ? canonical : undefined
}
function githubWebUrl(toolId: CommanderGithubReadToolId, repository: string, requestedRef: string | undefined): string {
  if (toolId === "github.commit_get" || toolId === "github.commit_checks") return `https://github.com/${repository}/commit/${requestedRef}`
  if ((toolId === "github.pull_request_get" || toolId === "github.pull_request_reviews") && requestedRef) return `https://github.com/${repository}/pull/${requestedRef.slice(5).split("@")[0]}`
  if (toolId === "github.issue_get" && requestedRef) return `https://github.com/${repository}/issues/${requestedRef.slice(6)}`
  return `https://github.com/${repository}`
}
