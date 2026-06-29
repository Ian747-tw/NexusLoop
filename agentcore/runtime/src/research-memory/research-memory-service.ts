import { createHash } from "node:crypto"
import { redactText, redactValue } from "../security/redaction"
import type {
  Artifact,
  Candidate,
  Citation,
  ResearchResult,
  SearchCandidatesOptions,
  SearchResearchResultsOptions,
  SearchTrainingRunsOptions,
  SearchTrialsOptions,
  TrainingRun,
  Trial,
} from "../research-db/research-db"
import type {
  ResearchMemoryCandidate,
  ResearchMemoryRetrievalInput,
  ResearchMemoryRetrievalPolicy,
  ResearchMemoryRetrievalPreview,
  ResearchMemorySourceRef,
  ResearchMemorySummary,
} from "./research-memory-types"

const MAX_TEXT = 240
const DEFAULT_LIMIT = 8
const MAX_LIMIT = 20
const SCAN_LIMIT = 500
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
])

export type ResearchMemoryReadAdapter = {
  available: boolean
  unavailableReason?: string
  policy?: ResearchMemoryRetrievalPolicy
  searchResearchResults?: (options?: SearchResearchResultsOptions) => ResearchResult[]
  listResultCitations?: (resultId: string) => Citation[]
  listResultArtifacts?: (resultId: string) => Artifact[]
  searchCandidates?: (options?: SearchCandidatesOptions) => Candidate[]
  searchTrials?: (options?: SearchTrialsOptions) => Trial[]
  searchTrainingRuns?: (options?: SearchTrainingRunsOptions) => TrainingRun[]
}

export type ResearchMemoryServiceOptions = {
  readAdapter: () => ResearchMemoryReadAdapter
  now?: () => Date
}

type RawCandidate = Omit<ResearchMemoryCandidate, "relevance_score" | "duplicate_similarity_score" | "matched_terms" | "difference_preview">

export class ResearchMemoryService {
  private readonly now: () => Date

  constructor(private readonly options: ResearchMemoryServiceOptions) {
    this.now = options.now ?? (() => new Date())
  }

  summary(): ResearchMemorySummary {
    const generatedAt = this.now().toISOString()
    const adapter = this.options.readAdapter()
    if (!adapter.available) {
      return redactValue({
        total_candidates_available: 0,
        label_counts: {},
        source_counts: {},
        has_research_db_projection: false,
        retrieval_policy: adapter.policy ?? "empty_projection",
        generated_at: generatedAt,
      })
    }
    const candidates = this.collectCandidates(adapter, { include_failures: true, include_artifacts: true })
    return redactValue({
      total_candidates_available: candidates.length,
      label_counts: countBy(candidates.map((candidate) => candidate.label)),
      source_counts: countBy(candidates.map((candidate) => candidate.source_kind)),
      has_research_db_projection: true,
      retrieval_policy: adapter.policy ?? "projection_read",
      generated_at: generatedAt,
    })
  }

  preview(input: ResearchMemoryRetrievalInput = {}): ResearchMemoryRetrievalPreview {
    const generatedAt = this.now().toISOString()
    const query = bound(input.query ?? "")
    const limit = clampLimit(input.limit)
    const labels = (input.labels ?? []).map((item) => bound(item, 80)).filter(Boolean)
    const blockers: string[] = []
    const warnings = new Set<string>([
      "research-memory retrieval is a read-only lexical preview; it does not call providers, MCPs, online sources, OpenCode, or write research.db",
    ])
    if (!query) blockers.push("research memory retrieval requires query=<query>")
    const adapter = this.options.readAdapter()
    if (!adapter.available) warnings.add(adapter.unavailableReason ?? "research memory projection is unavailable; no internal memory was inspected")
    const rawCandidates = adapter.available
      ? this.collectCandidates(adapter, {
          include_failures: input.include_failures !== false,
          include_artifacts: input.include_artifacts !== false,
          mission_id: input.mission_id,
          session_id: input.session_id,
          source_kind: input.source_kind,
          labels,
        })
      : []
    const sessionScopeUnsupported = !!input.session_id && rawCandidates.length > 0 && rawCandidates.every((candidate) => !candidate.source_session_id)
    if (sessionScopeUnsupported) warnings.add("session-scoped research memory is not available yet; using global internal memory preview")
    const queryTokens = tokenize([query].join(" "))
    const scored = rawCandidates
      .map((candidate) => scoreCandidate(candidate, queryTokens))
      .filter((candidate) => queryTokens.length > 0 && candidate.matched_terms.length > 0)
      .filter((candidate) => labels.length === 0 || labels.includes(candidate.label))
      .sort(candidateSort)
    const candidates = blockers.length === 0 ? scored.slice(0, limit) : []
    const omittedCount = Math.max(0, scored.length - candidates.length)
    if (adapter.available && blockers.length === 0 && candidates.length === 0) warnings.add("no internal research memory candidates matched the query")
    if (adapter.available && blockers.length === 0 && input.session_id && !sessionScopeUnsupported && candidates.length === 0) warnings.add("no internal research memory candidates matched the requested session scope")
    if (!adapter.available && blockers.length === 0) warnings.add("empty memory does not block Commander; it only means no internal prior work was found")
    const retrievalHash = hash(stableJson({ query, labels, limit, candidates: candidates.map((candidate) => candidate.result_id), policy: adapter.policy }))
    const status = blockers.length > 0 ? "blocked" : candidates.length > 0 ? "ready" : adapter.available ? "empty" : "empty"
    return redactValue({
      preview_id: `research_memory_retrieval_${retrievalHash.slice(0, 16)}`,
      status,
      query_preview: query,
      labels,
      limit,
      candidates,
      omitted_count: omittedCount,
      retrieval_policy: adapter.available ? adapter.policy ?? "projection_read" : "empty_projection",
      blockers: blockers.map((item) => bound(item)),
      warnings: Array.from(warnings).map((item) => bound(item)).slice(0, 12),
      recommended_commands: recommendedCommands(query),
      generated_at: generatedAt,
      redacted_summary_preview: blockers[0] ?? (candidates.length > 0 ? `Found ${candidates.length} bounded research-memory candidates.` : "No internal research memory candidates were found."),
      retrieval_hash: retrievalHash,
    })
  }

  private collectCandidates(adapter: ResearchMemoryReadAdapter, input: { include_failures?: boolean; include_artifacts?: boolean; mission_id?: string; session_id?: string; source_kind?: string; labels?: string[] }): RawCandidate[] {
    const out: RawCandidate[] = []
    const missionRuns = input.mission_id ? adapter.searchTrainingRuns?.({ limit: SCAN_LIMIT, mission_id: input.mission_id, order: "newest" }) ?? [] : []
    const missionRunIds = new Set(missionRuns.map((run) => run.training_run_id))
    const missionCandidateIds = new Set(missionRuns.map((run) => run.candidate_id).filter((id): id is string => !!id))
    const missionTrialIds = new Set(missionRuns.map((run) => run.trial_id).filter((id): id is string => !!id))
    if (!input.source_kind || input.source_kind === "research_db") {
      const directResults = adapter.searchResearchResults?.({ limit: SCAN_LIMIT, mission_id: input.mission_id, order: "newest" }) ?? []
      const latestResults = input.mission_id ? adapter.searchResearchResults?.({ limit: SCAN_LIMIT, order: "newest" }) ?? [] : []
      const resultRows = input.mission_id ? [...directResults, ...latestResults] : directResults
      for (const result of resultRows) {
        const linkedToMission =
          !input.mission_id ||
          result.mission_id === input.mission_id ||
          (!!result.candidate_id && missionCandidateIds.has(result.candidate_id)) ||
          (!!result.trial_id && missionTrialIds.has(result.trial_id)) ||
          (!!result.training_run_id && missionRunIds.has(result.training_run_id))
        if (!linkedToMission) continue
        out.push(candidateFromResearchResult(result, adapter, input.include_artifacts !== false, input.mission_id && linkedToMission ? input.mission_id : undefined))
      }
    }
    if (!input.source_kind || input.source_kind === "research_db") {
      const candidates = input.mission_id
        ? Array.from(missionCandidateIds).flatMap((candidateId) => adapter.searchCandidates?.({ limit: 1, candidate_id: candidateId }) ?? [])
        : adapter.searchCandidates?.({ limit: SCAN_LIMIT, order: "newest" }) ?? []
      for (const candidate of candidates) {
        out.push(candidateFromCandidate(candidate, input.mission_id))
      }
      const trials = input.mission_id
        ? [
            ...Array.from(missionTrialIds).flatMap((trialId) => adapter.searchTrials?.({ limit: 1, trial_id: trialId }) ?? []),
            ...Array.from(missionCandidateIds).flatMap((candidateId) => adapter.searchTrials?.({ limit: SCAN_LIMIT, candidate_id: candidateId }) ?? []),
          ]
        : adapter.searchTrials?.({ limit: SCAN_LIMIT }) ?? []
      for (const trial of trials) {
        out.push(candidateFromTrial(trial, input.mission_id))
      }
      const runs = input.mission_id ? missionRuns : adapter.searchTrainingRuns?.({ limit: SCAN_LIMIT, order: "newest" }) ?? []
      for (const run of runs) out.push(candidateFromTrainingRun(run))
    }
    const filtered = out
      .filter((candidate) => input.include_failures !== false || candidate.label !== "failure")
      .filter((candidate) => !input.mission_id || candidate.source_mission_id === input.mission_id)
      .filter((candidate, _index, candidates) => !input.session_id || !candidates.some((item) => !!item.source_session_id) || candidate.source_session_id === input.session_id)
      .filter((candidate) => !input.labels?.length || input.labels.includes(candidate.label))
    return uniqueRawCandidates(filtered)
  }
}

export function readResearchMemoryRetrievalInput(value: unknown): ResearchMemoryRetrievalInput {
  const input = isRecord(value) ? value : {}
  return {
    query: optional(input.query),
    labels: arrayOfStrings(input.labels),
    limit: optionalNumber(input.limit),
    source_kind: optional(input.sourceKind ?? input.source_kind),
    mission_id: optional(input.missionId ?? input.mission_id ?? input.mission),
    session_id: optional(input.sessionId ?? input.session_id ?? input.session),
    include_failures: optionalBoolean(input.includeFailures ?? input.include_failures),
    include_artifacts: optionalBoolean(input.includeArtifacts ?? input.include_artifacts),
  }
}

function candidateFromResearchResult(result: ResearchResult, adapter: ResearchMemoryReadAdapter, includeArtifacts: boolean, missionId?: string): RawCandidate {
  const citations = adapter.listResultCitations?.(result.result_id) ?? []
  const artifacts = includeArtifacts ? adapter.listResultArtifacts?.(result.result_id) ?? [] : []
  const label = labelForResearchResult(result)
  const sourceRefs: ResearchMemorySourceRef[] = [
    sourceRef("research_db", result.result_id, "research result", `${result.title}: ${result.summary}`),
    ...citations.slice(0, 4).map((citation) => sourceRef("research_db", citation.citation_id, "citation pointer", citation.title ?? citation.source_type)),
    ...artifacts.slice(0, 4).map((artifact) => sourceRef("artifact", artifact.id, "artifact pointer", artifact.description ?? artifact.kind)),
  ]
  return baseCandidate({
    result_id: result.result_id,
    label,
    question_preview: result.title,
    hypothesis_preview: result.label ?? undefined,
    method_preview: result.result_type,
    config_preview: previewUnknown(result.reproduction),
    outcome_preview: result.summary,
    metric_preview: previewUnknown(result.metrics),
    confidence: result.confidence,
    status: result.status,
    source_mission_id: missionId ?? result.mission_id ?? undefined,
    artifact_ids: artifacts.map((artifact) => bound(artifact.id, 160)),
    citation_ids: citations.map((citation) => bound(citation.citation_id, 160)),
    related_event_ids: [],
    warning_flags: label === "failure" ? ["failure evidence included to avoid repeated work"] : [],
    source_refs: sourceRefs,
  })
}

function candidateFromCandidate(candidate: Candidate, missionId?: string): RawCandidate {
  return baseCandidate({
    result_id: candidate.candidate_id,
    label: candidate.status === "rejected" ? "failure" : "finding",
    question_preview: candidate.claim,
    hypothesis_preview: candidate.hypothesis_id ?? undefined,
    method_preview: "candidate",
    config_preview: candidate.source,
    outcome_preview: candidate.rank_reason ?? candidate.status,
    metric_preview: candidate.commander_score === null ? undefined : String(candidate.commander_score),
    status: candidate.status,
    source_mission_id: missionId,
    artifact_ids: [],
    citation_ids: [],
    related_event_ids: [],
    warning_flags: candidate.status === "rejected" ? ["rejected candidate evidence included"] : [],
    source_refs: [sourceRef("research_db", candidate.candidate_id, "candidate pointer", candidate.claim)],
  })
}

function candidateFromTrial(trial: Trial, missionId?: string): RawCandidate {
  return baseCandidate({
    result_id: trial.trial_id,
    label: trial.status === "failed" || trial.status === "cancelled" ? "failure" : "trial",
    question_preview: trial.trial_kind,
    hypothesis_preview: trial.hypothesis_id ?? undefined,
    method_preview: trial.trial_kind,
    config_preview: previewUnknown(trial.config),
    outcome_preview: trial.status,
    status: trial.status,
    source_mission_id: missionId,
    artifact_ids: [],
    citation_ids: [],
    related_event_ids: [],
    warning_flags: trial.status === "failed" || trial.status === "cancelled" ? ["failed/cancelled trial evidence included"] : [],
    source_refs: [sourceRef("research_db", trial.trial_id, "trial pointer", trial.trial_kind)],
  })
}

function candidateFromTrainingRun(run: TrainingRun): RawCandidate {
  return baseCandidate({
    result_id: run.training_run_id,
    label: run.status === "failed" || run.status === "cancelled" ? "failure" : run.label === "full_training" ? "full_training" : "probe",
    question_preview: run.label,
    hypothesis_preview: run.hypothesis_id ?? undefined,
    method_preview: run.label,
    config_preview: previewUnknown(run.reproduction),
    outcome_preview: run.status,
    metric_preview: previewUnknown(run.last_metric),
    status: run.status,
    source_mission_id: run.mission_id ?? undefined,
    artifact_ids: [run.latest_checkpoint_id].filter((item): item is string => typeof item === "string"),
    citation_ids: [],
    related_event_ids: [],
    warning_flags: run.status === "failed" || run.status === "cancelled" ? ["failed/cancelled training run evidence included"] : [],
    source_refs: [sourceRef("research_db", run.training_run_id, "training run pointer", `${run.label} ${run.status}`)],
  })
}

function labelForResearchResult(result: ResearchResult): string {
  const raw = `${result.label ?? ""} ${result.result_type} ${result.status}`.toLowerCase()
  if (raw.includes("negative") || raw.includes("bug") || raw.includes("failed") || raw.includes("rejected")) return "failure"
  if (result.result_type === "full_training_result" || raw.includes("full_training")) return "full_training"
  if (result.result_type === "probe_result" || raw.includes("probe")) return "probe"
  if (result.result_type === "smoke_test_result" || result.result_type === "evaluation_result" || result.result_type === "ablation_result") return "trial"
  if (result.result_type === "finding" || result.result_type === "literature_finding") return "finding"
  return result.label ?? "unknown"
}

function baseCandidate(input: Omit<RawCandidate, "source_kind"> & { source_kind?: string }): RawCandidate {
  return {
    ...input,
    result_id: bound(input.result_id, 160),
    label: bound(input.label, 80),
    source_kind: input.source_kind ?? "research_db",
    question_preview: bound(input.question_preview),
    hypothesis_preview: optionalBound(input.hypothesis_preview),
    method_preview: optionalBound(input.method_preview),
    config_preview: optionalBound(input.config_preview),
    outcome_preview: optionalBound(input.outcome_preview),
    metric_preview: optionalBound(input.metric_preview),
    confidence: optionalBound(input.confidence, 80),
    status: optionalBound(input.status, 80),
    source_session_id: optionalBound(input.source_session_id, 160),
    source_mission_id: optionalBound(input.source_mission_id, 160),
    artifact_ids: input.artifact_ids.map((item) => bound(item, 160)).slice(0, 8),
    citation_ids: input.citation_ids.map((item) => bound(item, 160)).slice(0, 8),
    related_event_ids: input.related_event_ids.map((item) => bound(item, 160)).slice(0, 8),
    warning_flags: input.warning_flags.map((item) => bound(item, 160)).slice(0, 6),
    source_refs: input.source_refs.slice(0, 8),
  }
}

function scoreCandidate(candidate: RawCandidate, queryTokens: string[]): ResearchMemoryCandidate {
  const text = [
    candidate.question_preview,
    candidate.hypothesis_preview,
    candidate.method_preview,
    candidate.config_preview,
    candidate.outcome_preview,
    candidate.metric_preview,
  ].join(" ")
  const candidateTokens = new Set(tokenize(text))
  const matchedTerms = queryTokens.filter((token) => candidateTokens.has(token))
  const baseScore = queryTokens.length === 0 ? 0 : matchedTerms.length / queryTokens.length
  const labelBoost = candidate.label === "failure" ? 0.05 : candidate.label === "finding" ? 0.04 : 0.02
  const duplicateSimilarityScore = clampScore(baseScore + (matchedTerms.length >= 3 ? 0.15 : 0))
  return {
    ...candidate,
    relevance_score: clampScore(baseScore + labelBoost),
    duplicate_similarity_score: duplicateSimilarityScore,
    matched_terms: matchedTerms.slice(0, 12),
    difference_preview: matchedTerms.length
      ? bound(`matched terms: ${matchedTerms.slice(0, 8).join(", ")}`)
      : "no strong lexical overlap with this prior record",
  }
}

function tokenize(value: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const token of value.toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? []) {
    if (STOP_WORDS.has(token) || seen.has(token)) continue
    seen.add(token)
    out.push(token)
  }
  return out
}

function candidateSort(left: ResearchMemoryCandidate, right: ResearchMemoryCandidate): number {
  return right.relevance_score - left.relevance_score
    || right.duplicate_similarity_score - left.duplicate_similarity_score
    || left.result_id.localeCompare(right.result_id)
}

function uniqueRawCandidates(candidates: RawCandidate[]): RawCandidate[] {
  const seen = new Set<string>()
  const out: RawCandidate[] = []
  for (const candidate of candidates) {
    const key = `${candidate.source_kind}:${candidate.result_id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(candidate)
  }
  return out
}

function sourceRef(sourceKind: string, sourceId: string, label: string, summary: string): ResearchMemorySourceRef {
  return {
    source_kind: bound(sourceKind, 80),
    source_id: bound(sourceId, 160),
    label: bound(label, 120),
    summary_preview: bound(summary),
    pointer_only: true,
  }
}

function recommendedCommands(query: string) {
  return [
    { label: "Research memory summary", command: "/research-memory-summary", command_type: "read" as const },
    { label: "Novelty preview", command: `/research-novelty-preview question=${shellish(query)}`, command_type: "read" as const },
    { label: "Show authority", command: "/authority-show /research-memory-search", command_type: "read" as const },
  ]
}

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const value of values) out[value] = (out[value] ?? 0) + 1
  return out
}

function previewUnknown(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === "string") return bound(redactText(value))
  try {
    return bound(JSON.stringify(redactMetadata(value)))
  } catch {
    return "unserializable metadata"
  }
}

function redactMetadata(value: unknown): unknown {
  const redacted = redactValue(value)
  if (Array.isArray(redacted)) return redacted.map((item) => redactMetadata(item))
  if (redacted && typeof redacted === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(redacted)) {
      const safeKey = /api[_-]?key|token|secret|password|credential/i.test(key) ? "[REDACTED_KEY]" : redactText(key)
      out[safeKey] = redactMetadata(child)
    }
    return out
  }
  return redacted
}

function optional(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function optionalBound(value: unknown, max = MAX_TEXT): string | undefined {
  const text = optional(value)
  return text ? bound(text, max) : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function arrayOfStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === "string").map((item) => bound(item, 80)).filter(Boolean)
}

function clampLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(Math.floor(value), MAX_LIMIT))
}

function clampScore(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function bound(value: string, max = MAX_TEXT): string {
  const redacted = redactText(String(value))
  return redacted.length <= max ? redacted : `${redacted.slice(0, Math.max(0, max - 1))}…`
}

function shellish(value: string): string {
  return bound(value, 80).replace(/\s+/g, " ")
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortValue(item)]))
}
