import { createHash } from "node:crypto"
import { redactText, redactValue } from "../security/redaction"
import type {
  Artifact,
  Candidate,
  Citation,
  ResultArtifactPointer,
  ResultCitationPointer,
  ResearchResult,
  ResearchResultStatus,
  ResearchResultType,
  SearchCandidatesOptions,
  SearchResearchResultsOptions,
  SearchTrainingRunsOptions,
  SearchTrialsOptions,
  TrainingRun,
  Trial,
} from "../research-db/research-db"
import type {
  ResearchMemoryCandidate,
  ResearchMemoryInspectionInput,
  ResearchMemoryInspectionPreview,
  ResearchMemoryNearDuplicateInput,
  ResearchMemoryNearDuplicatePreview,
  ResearchMemoryRetrievalInput,
  ResearchMemoryRetrievalPolicy,
  ResearchMemoryRetrievalPreview,
  ResearchMemorySearchProfile,
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
  getResearchResult?: (resultId: string) => ResearchResult | null
  searchResearchResults?: (options?: SearchResearchResultsOptions) => ResearchResult[]
  listResultCitationPointers?: (resultId: string, limit?: number) => ResultCitationPointer[]
  listResultArtifactPointers?: (resultId: string, limit?: number) => ResultArtifactPointer[]
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

type RawCandidate = Omit<ResearchMemoryCandidate, "relevance_score" | "duplicate_similarity_score" | "matched_terms" | "unmatched_query_terms" | "matched_fields" | "scoring_explanation_preview" | "difference_preview" | "pointer_only">

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
          result_type: input.result_type,
          result_status: input.result_status,
          confidence: input.confidence,
          evidence_kind: input.evidence_kind,
          has_artifacts: input.has_artifacts,
          has_citations: input.has_citations,
          has_metrics: input.has_metrics,
          since: input.since,
          until: input.until,
        })
      : []
    const sessionScopeUnsupported = !!input.session_id && rawCandidates.length > 0 && rawCandidates.every((candidate) => !candidate.source_session_id)
    if (sessionScopeUnsupported) warnings.add("session-scoped research memory is not available yet; using global internal memory preview")
    const queryTokens = tokenize([query].join(" "))
    const scored = rawCandidates
      .map((candidate) => scoreCandidate(candidate, queryTokens))
      .filter((candidate) => queryTokens.length > 0 && candidate.matched_terms.length > 0)
      .filter((candidate) => labels.length === 0 || labels.includes(candidate.label))
      .sort(candidateSort(input.sort))
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

  inspect(input: ResearchMemoryInspectionInput = {}): ResearchMemoryInspectionPreview {
    const generatedAt = this.now().toISOString()
    const memoryId = bound(input.memory_id ?? "")
    const sourceKind = bound(input.source_kind ?? "research_db", 80)
    const blockers: string[] = []
    const warnings = new Set<string>([
      "research-memory inspection is read-only and bounded; it does not load raw artifacts, raw logs, full research.db, provider output, OpenCode output, or event dumps",
    ])
    if (!memoryId) blockers.push("research memory inspection requires id=<memoryId>")
    const adapter = this.options.readAdapter()
    if (!adapter.available) blockers.push(adapter.unavailableReason ?? "research memory projection is unavailable")
    if (sourceKind !== "research_db") blockers.push(`research memory inspection only supports source_kind=research_db in this branch; got ${sourceKind}`)
    const resolvedResult = blockers.length === 0 ? adapter.getResearchResult?.(memoryId) ?? null : null
    const resolvedCandidate = blockers.length === 0 && !resolvedResult ? adapter.searchCandidates?.({ candidate_id: memoryId, limit: 1 })[0] ?? null : null
    const resolvedTrial = blockers.length === 0 && !resolvedResult && !resolvedCandidate ? adapter.searchTrials?.({ trial_id: memoryId, limit: 1 })[0] ?? null : null
    const resolvedTrainingRun = blockers.length === 0 && !resolvedResult && !resolvedCandidate && !resolvedTrial
      ? adapter.searchTrainingRuns?.({ limit: SCAN_LIMIT, order: "newest" }).find((run) => run.training_run_id === memoryId) ?? null
      : null
    if (blockers.length === 0 && !resolvedResult && !resolvedCandidate && !resolvedTrial && !resolvedTrainingRun) blockers.push(`research memory record was not found: ${memoryId}`)
    if (resolvedResult && resolvedResult.status !== "accepted") blockers.push(`research memory inspection only returns accepted research results; ${memoryId} is ${resolvedResult.status}`)
    const result = resolvedResult?.status === "accepted" ? resolvedResult : null
    const citations = result && input.include_citations !== false
      ? adapter.listResultCitationPointers?.(result.result_id, 8) ?? adapter.listResultCitations?.(result.result_id).map(citationPointerFromFullRow) ?? []
      : []
    const artifacts = result && input.include_artifacts !== false
      ? adapter.listResultArtifactPointers?.(result.result_id, 8) ?? adapter.listResultArtifacts?.(result.result_id).map(artifactPointerFromFullRow) ?? []
      : []
    const rawCandidate = !result && resolvedCandidate
      ? candidateFromCandidate(resolvedCandidate)
      : !result && resolvedTrial
        ? candidateFromTrial(resolvedTrial)
        : !result && resolvedTrainingRun
          ? candidateFromTrainingRun(resolvedTrainingRun)
          : null
    const label = result ? labelForResearchResult(result) : rawCandidate?.label ?? "unknown"
    const inspectionHash = hash(stableJson({ memoryId, sourceKind, status: resolvedResult?.status, citations: citations.map((item) => item.citation_id), artifacts: artifacts.map((item) => item.id) }))
    const provenanceRefs = result
      ? [
          sourceRef("research_db", result.result_id, "accepted research result", `${result.title}: ${result.summary}`),
          ...[result.candidate_id, result.trial_id, result.training_run_id, result.mission_id].filter((item): item is string => !!item).map((id) => sourceRef("research_db", id, "linked research provenance", id)),
        ].slice(0, 8)
      : rawCandidate?.source_refs.slice(0, 8) ?? []
    return redactValue({
      inspection_id: `research_memory_inspection_${inspectionHash.slice(0, 16)}`,
      status: blockers.length > 0 ? "blocked" : "ready",
      memory_id: memoryId,
      source_kind: sourceKind,
      label,
      title_preview: result ? bound(result.title) : rawCandidate?.question_preview ? bound(rawCandidate.question_preview) : undefined,
      summary_preview: result ? bound(result.summary) : rawCandidate?.outcome_preview ? bound(rawCandidate.outcome_preview) : undefined,
      question_preview: result ? bound(result.title) : rawCandidate?.question_preview ? bound(rawCandidate.question_preview) : undefined,
      hypothesis_preview: result?.label ? bound(result.label) : rawCandidate?.hypothesis_preview ? bound(rawCandidate.hypothesis_preview) : undefined,
      method_preview: result ? bound(result.result_type) : rawCandidate?.method_preview ? bound(rawCandidate.method_preview) : undefined,
      outcome_preview: result ? bound(result.summary) : rawCandidate?.outcome_preview ? bound(rawCandidate.outcome_preview) : undefined,
      metric_preview: result ? previewUnknown(result.metrics) : rawCandidate?.metric_preview ? bound(rawCandidate.metric_preview) : undefined,
      config_preview: result ? previewUnknown(result.reproduction) : rawCandidate?.config_preview ? bound(rawCandidate.config_preview) : undefined,
      confidence: result?.confidence ?? rawCandidate?.confidence,
      status_preview: result?.status ?? rawCandidate?.status,
      source_mission_id: result?.mission_id ?? rawCandidate?.source_mission_id ?? undefined,
      source_session_id: undefined,
      artifact_refs: result
        ? artifacts.slice(0, 8).map((artifact) => sourceRef("artifact", artifact.id, "artifact pointer", artifact.description ?? artifact.kind))
        : rawCandidate?.artifact_ids.slice(0, 8).map((id) => sourceRef("artifact", id, "artifact pointer", id)) ?? [],
      citation_refs: citations.slice(0, 8).map((citation) => sourceRef("research_db", citation.citation_id, "citation pointer", citation.title ?? citation.source_type)),
      provenance_refs: provenanceRefs,
      related_event_ids: rawCandidate?.related_event_ids ?? [],
      warning_flags: rawCandidate?.warning_flags ?? (label === "failure" ? ["failure evidence included to avoid repeated work"] : []),
      recommended_commands: [
        { label: "Search related memory", command: result ? `/research-memory-search query=${shellish(result.title)}` : rawCandidate ? `/research-memory-search query=${shellish(rawCandidate.question_preview)}` : "/research-memory-search query=<query>", command_type: "read" },
        { label: "Near duplicates", command: result ? `/research-memory-near-duplicates query=${shellish(result.title)}` : rawCandidate ? `/research-memory-near-duplicates query=${shellish(rawCandidate.question_preview)}` : "/research-memory-near-duplicates query=<query>", command_type: "read" },
        { label: "Show authority", command: "/authority-show /research-memory-inspect", command_type: "read" },
      ],
      blockers: blockers.map((item) => bound(item)),
      warnings: Array.from(warnings).map((item) => bound(item)).slice(0, 12),
      generated_at: generatedAt,
      redacted_summary_preview: blockers[0] ?? `Inspected bounded research-memory record ${memoryId}.`,
      inspection_hash: inspectionHash,
    })
  }

  nearDuplicates(input: ResearchMemoryNearDuplicateInput = {}): ResearchMemoryNearDuplicatePreview {
    const generatedAt = this.now().toISOString()
    const query = bound(input.query ?? input.objective ?? "")
    const objective = input.objective ? bound(input.objective) : undefined
    const limit = clampLimit(input.limit)
    const threshold = clampThreshold(input.duplicate_threshold)
    const labels = (input.labels ?? []).map((item) => bound(item, 80)).filter(Boolean)
    const blockers: string[] = []
    const warnings = new Set<string>([
      "near-duplicate preview is advisory read-only lexical retrieval; it does not block proposals, call providers/MCPs/online sources, or write research.db",
    ])
    if (!query) blockers.push("research memory near-duplicate preview requires query=<query> or objective=<objective>")
    const retrieval = blockers.length
      ? null
      : this.preview({
          query,
          labels,
          limit,
          mission_id: input.mission_id,
          session_id: input.session_id,
          include_failures: input.include_failures,
          include_artifacts: input.include_artifacts,
          sort: "similarity",
        })
    if (retrieval?.warnings) for (const warning of retrieval.warnings) warnings.add(warning)
    const candidates = retrieval?.candidates ?? []
    const strongest = candidates[0]?.duplicate_similarity_score
    const likelyCount = candidates.filter((candidate) => candidate.duplicate_similarity_score >= threshold && candidate.matched_terms.length >= 3).length
    const warningCount = candidates.filter((candidate) => candidate.duplicate_similarity_score >= threshold * 0.75 || candidate.matched_terms.length >= 2).length
    const noveltyRisk = blockers.length ? "unknown" : strongest === undefined ? "unknown" : likelyCount > 0 ? "high" : warningCount > 0 ? "medium" : candidates.length > 0 ? "low" : "unknown"
    const nearHash = hash(stableJson({ query, labels, limit, threshold, candidates: candidates.map((candidate) => [candidate.result_id, candidate.duplicate_similarity_score]) }))
    return redactValue({
      preview_id: `research_memory_near_duplicate_${nearHash.slice(0, 16)}`,
      status: blockers.length > 0 ? "blocked" : candidates.length > 0 ? "ready" : "empty",
      query_preview: query,
      objective_preview: objective,
      labels,
      limit,
      duplicate_threshold: threshold,
      candidates,
      likely_duplicate_count: likelyCount,
      warning_duplicate_count: warningCount,
      strongest_duplicate_score: strongest,
      novelty_risk: noveltyRisk,
      blockers: blockers.map((item) => bound(item)),
      warnings: Array.from(warnings).map((item) => bound(item)).slice(0, 12),
      recommended_commands: [
        { label: "Research memory search", command: query ? `/research-memory-search query=${shellish(query)}` : "/research-memory-search query=<query>", command_type: "read" },
        { label: "Search profile", command: "/research-memory-profile", command_type: "read" },
        { label: "Show authority", command: "/authority-show /research-memory-near-duplicates", command_type: "read" },
      ],
      generated_at: generatedAt,
      redacted_summary_preview: blockers[0] ?? (candidates.length ? `Near-duplicate risk ${noveltyRisk} from ${candidates.length} bounded candidates.` : "No bounded near-duplicate candidates were found."),
      near_duplicate_hash: nearHash,
    })
  }

  searchProfile(): ResearchMemorySearchProfile {
    const generatedAt = this.now().toISOString()
    const adapter = this.options.readAdapter()
    const candidates = adapter.available ? this.collectCandidates(adapter, { include_failures: true, include_artifacts: true }) : []
    const acceptedResultCount = adapter.available ? adapter.searchResearchResults?.({ limit: SCAN_LIMIT, status: "accepted", order: "newest" }).length : undefined
    const candidateCount = adapter.available ? adapter.searchCandidates?.({ limit: SCAN_LIMIT, order: "newest" }).length : undefined
    const trialCount = adapter.available ? adapter.searchTrials?.({ limit: SCAN_LIMIT, order: "newest" }).length : undefined
    const trainingRunCount = adapter.available ? adapter.searchTrainingRuns?.({ limit: SCAN_LIMIT, order: "newest" }).length : undefined
    const warnings = [
      "search is bounded lexical retrieval; semantic, vector, FTS, provider, MCP, and online research are not enabled",
      ...(!adapter.available ? [adapter.unavailableReason ?? "research memory projection is unavailable"] : []),
    ]
    return redactValue({
      profile_id: `research_memory_profile_${hash(stableJson({ generatedAt, policy: adapter.policy, available: adapter.available, total: candidates.length })).slice(0, 16)}`,
      status: adapter.available ? "ready" : "degraded",
      retrieval_policy: adapter.available ? adapter.policy ?? "projection_read" : "empty_projection",
      has_research_db_projection: adapter.available,
      search_engine: "bounded_lexical",
      semantic_search_enabled: false,
      vector_index_enabled: false,
      fts_index_enabled: false,
      scan_limit: SCAN_LIMIT,
      default_limit: DEFAULT_LIMIT,
      max_limit: MAX_LIMIT,
      supported_filters: ["query", "labels", "source_kind", "mission_id", "session_id", "include_failures", "include_artifacts", "result_type", "result_status", "confidence", "evidence_kind", "has_artifacts", "has_citations", "has_metrics", "since", "until", "sort", "explain"],
      unsupported_filters: ["semantic_search", "vector_index", "fts_query", "raw_sql", "artifact_contents", "file_contents"],
      source_counts: countBy(candidates.map((candidate) => candidate.source_kind)),
      label_counts: countBy(candidates.map((candidate) => candidate.label)),
      accepted_result_count: acceptedResultCount,
      candidate_count: candidateCount,
      trial_count: trialCount,
      training_run_count: trainingRunCount,
      warnings: warnings.map((item) => bound(item)).slice(0, 12),
      generated_at: generatedAt,
      redacted_summary_preview: adapter.available ? `bounded_lexical scan_limit=${SCAN_LIMIT} max_limit=${MAX_LIMIT}` : "research memory projection unavailable; bounded lexical search is degraded",
    })
  }

  private collectCandidates(adapter: ResearchMemoryReadAdapter, input: { include_failures?: boolean; include_artifacts?: boolean; mission_id?: string; session_id?: string; source_kind?: string; labels?: string[]; result_type?: string; result_status?: string; confidence?: string; evidence_kind?: string; has_artifacts?: boolean; has_citations?: boolean; has_metrics?: boolean; since?: string; until?: string }): RawCandidate[] {
    const out: RawCandidate[] = []
    const resultStatusFilter = isResearchResultStatus(input.result_status) ? input.result_status : "accepted"
    const includeNonResultRows = !isResearchResultStatus(input.result_status)
    const missionRuns = input.mission_id ? adapter.searchTrainingRuns?.({ limit: SCAN_LIMIT, mission_id: input.mission_id, order: "newest" }) ?? [] : []
    const missionRunIds = new Set(missionRuns.map((run) => run.training_run_id))
    const missionCandidateIds = new Set(missionRuns.map((run) => run.candidate_id).filter((id): id is string => !!id))
    const missionTrialIds = new Set(missionRuns.map((run) => run.trial_id).filter((id): id is string => !!id))
    if (!input.source_kind || input.source_kind === "research_db") {
      const resultRows = input.mission_id
        ? [
            ...(adapter.searchResearchResults?.({ ...researchResultSearchOptions(input), limit: SCAN_LIMIT, mission_id: input.mission_id, status: resultStatusFilter, order: "newest" }) ?? []),
            ...Array.from(missionCandidateIds).flatMap((candidateId) => adapter.searchResearchResults?.({ ...researchResultSearchOptions(input), limit: SCAN_LIMIT, candidate_id: candidateId, status: resultStatusFilter, order: "newest" }) ?? []),
            ...Array.from(missionTrialIds).flatMap((trialId) => adapter.searchResearchResults?.({ ...researchResultSearchOptions(input), limit: SCAN_LIMIT, trial_id: trialId, status: resultStatusFilter, order: "newest" }) ?? []),
            ...Array.from(missionRunIds).flatMap((runId) => adapter.searchResearchResults?.({ ...researchResultSearchOptions(input), limit: SCAN_LIMIT, training_run_id: runId, status: resultStatusFilter, order: "newest" }) ?? []),
          ]
        : adapter.searchResearchResults?.({ ...researchResultSearchOptions(input), limit: SCAN_LIMIT, status: resultStatusFilter, order: "newest" }) ?? []
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
    if ((!input.source_kind || input.source_kind === "research_db") && includeNonResultRows) {
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
        : adapter.searchTrials?.({ limit: SCAN_LIMIT, order: "newest" }) ?? []
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
      .filter((candidate) => !input.confidence || candidate.confidence === input.confidence)
      .filter((candidate) => !input.evidence_kind || candidate.evidence_kind_preview === input.evidence_kind || candidate.label === input.evidence_kind)
      .filter((candidate) => input.has_artifacts === undefined || (input.has_artifacts ? candidate.artifact_ids.length > 0 : candidate.artifact_ids.length === 0))
      .filter((candidate) => input.has_citations === undefined || (input.has_citations ? candidate.citation_ids.length > 0 : candidate.citation_ids.length === 0))
      .filter((candidate) => input.has_metrics === undefined || (input.has_metrics ? !!candidate.metric_preview : !candidate.metric_preview))
      .filter((candidate) => !input.since || !candidate.created_at_preview || candidate.created_at_preview >= input.since)
      .filter((candidate) => !input.until || !candidate.created_at_preview || candidate.created_at_preview <= input.until)
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
    result_type: optional(input.resultType ?? input.result_type),
    result_status: optional(input.resultStatus ?? input.result_status),
    confidence: optional(input.confidence),
    evidence_kind: optional(input.evidenceKind ?? input.evidence_kind),
    has_artifacts: optionalBoolean(input.hasArtifacts ?? input.has_artifacts),
    has_citations: optionalBoolean(input.hasCitations ?? input.has_citations),
    has_metrics: optionalBoolean(input.hasMetrics ?? input.has_metrics),
    since: optional(input.since),
    until: optional(input.until),
    sort: optional(input.sort),
    explain: optionalBoolean(input.explain),
  }
}

export function readResearchMemoryInspectionInput(value: unknown): ResearchMemoryInspectionInput {
  const input = isRecord(value) ? value : {}
  return {
    memory_id: optional(input.memoryId ?? input.memory_id ?? input.id),
    source_kind: optional(input.sourceKind ?? input.source_kind ?? input.source),
    include_artifacts: optionalBoolean(input.includeArtifacts ?? input.include_artifacts),
    include_citations: optionalBoolean(input.includeCitations ?? input.include_citations),
  }
}

export function readResearchMemoryNearDuplicateInput(value: unknown): ResearchMemoryNearDuplicateInput {
  const input = isRecord(value) ? value : {}
  return {
    query: optional(input.query),
    objective: optional(input.objective),
    labels: arrayOfStrings(input.labels),
    limit: optionalNumber(input.limit),
    duplicate_threshold: optionalNumber(input.duplicateThreshold ?? input.duplicate_threshold),
    mission_id: optional(input.missionId ?? input.mission_id ?? input.mission),
    session_id: optional(input.sessionId ?? input.session_id ?? input.session),
    include_failures: optionalBoolean(input.includeFailures ?? input.include_failures),
    include_artifacts: optionalBoolean(input.includeArtifacts ?? input.include_artifacts),
  }
}

function candidateFromResearchResult(result: ResearchResult, adapter: ResearchMemoryReadAdapter, includeArtifacts: boolean, missionId?: string): RawCandidate {
  const citations = adapter.listResultCitationPointers?.(result.result_id, 8) ?? adapter.listResultCitations?.(result.result_id).map(citationPointerFromFullRow) ?? []
  const artifacts = includeArtifacts
    ? adapter.listResultArtifactPointers?.(result.result_id, 8) ?? adapter.listResultArtifacts?.(result.result_id).map(artifactPointerFromFullRow) ?? []
    : []
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
    evidence_kind_preview: evidenceKindForResearchResult(result),
    created_at_preview: result.created_at,
    updated_at_preview: result.updated_at,
    warning_flags: label === "failure" ? ["failure evidence included to avoid repeated work"] : [],
    source_refs: sourceRefs,
  })
}

function citationPointerFromFullRow(citation: Citation): ResultCitationPointer {
  return {
    citation_id: citation.citation_id,
    source_type: citation.source_type,
    title: citation.title,
  }
}

function artifactPointerFromFullRow(artifact: Artifact): ResultArtifactPointer {
  return {
    id: artifact.id,
    kind: artifact.kind,
    description: artifact.description,
  }
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
    created_at_preview: candidate.created_at,
    updated_at_preview: candidate.updated_at,
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
    created_at_preview: trial.created_at,
    updated_at_preview: trial.updated_at,
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
    created_at_preview: run.created_at,
    updated_at_preview: run.updated_at,
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

function evidenceKindForResearchResult(result: ResearchResult): string {
  const raw = `${result.label ?? ""} ${result.result_type}`.toLowerCase()
  if (raw.includes("negative") || raw.includes("bug") || raw.includes("failure")) return "negative_result"
  if (raw.includes("inconclusive")) return "inconclusive_result"
  if (raw.includes("partial")) return "partial_result"
  if (raw.includes("blocked")) return "blocked_result"
  if (raw.includes("status")) return "status_note"
  return "positive_finding"
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
    evidence_kind_preview: optionalBound(input.evidence_kind_preview, 80),
    created_at_preview: optionalBound(input.created_at_preview, 80),
    updated_at_preview: optionalBound(input.updated_at_preview, 80),
    warning_flags: input.warning_flags.map((item) => bound(item, 160)).slice(0, 6),
    source_refs: input.source_refs.slice(0, 8),
  }
}

function scoreCandidate(candidate: RawCandidate, queryTokens: string[]): ResearchMemoryCandidate {
  const fieldTexts: Array<[string, string | undefined, number]> = [
    ["question/title", candidate.question_preview, 1],
    ["hypothesis", candidate.hypothesis_preview, 0.75],
    ["method", candidate.method_preview, 0.7],
    ["config", candidate.config_preview, 0.55],
    ["outcome/summary", candidate.outcome_preview, 0.85],
    ["metric", candidate.metric_preview, 0.55],
    ["label", candidate.label, 0.25],
    ["source refs", candidate.source_refs.map((ref) => `${ref.source_kind} ${ref.label ?? ""} ${ref.summary_preview ?? ""}`).join(" "), 0.2],
  ]
  const matched = new Map<string, number>()
  const matchedFields = new Set<string>()
  for (const [field, text, weight] of fieldTexts) {
    const fieldTokens = new Set(tokenize(text ?? ""))
    for (const token of queryTokens) {
      if (!fieldTokens.has(token)) continue
      matched.set(token, Math.max(matched.get(token) ?? 0, weight))
      matchedFields.add(field)
    }
  }
  const matchedTerms = queryTokens.filter((token) => matched.has(token))
  const unmatchedTerms = queryTokens.filter((token) => !matched.has(token))
  const weighted = Array.from(matched.values()).reduce((sum, item) => sum + item, 0)
  const baseScore = queryTokens.length === 0 ? 0 : weighted / queryTokens.length
  const labelBoost = candidate.label === "failure" ? 0.05 : candidate.label === "finding" ? 0.04 : 0.02
  const titleBoost = matchedFields.has("question/title") ? 0.08 : 0
  const duplicateSimilarityScore = clampScore(baseScore + (matchedTerms.length >= 3 ? 0.15 : 0) + titleBoost)
  return {
    ...candidate,
    relevance_score: clampScore(baseScore + labelBoost),
    duplicate_similarity_score: duplicateSimilarityScore,
    matched_terms: matchedTerms.slice(0, 12),
    unmatched_query_terms: unmatchedTerms.slice(0, 12),
    matched_fields: Array.from(matchedFields).slice(0, 12),
    scoring_explanation_preview: bound(`bounded lexical score matched ${matchedTerms.length}/${queryTokens.length} query terms across ${Array.from(matchedFields).join(", ") || "no fields"}`),
    difference_preview: matchedTerms.length
      ? bound(`matched terms: ${matchedTerms.slice(0, 8).join(", ")}`)
      : "no strong lexical overlap with this prior record",
    pointer_only: true,
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

function candidateSort(sort?: string): (left: ResearchMemoryCandidate, right: ResearchMemoryCandidate) => number {
  return (left, right) => {
    if (sort === "oldest") return (left.created_at_preview ?? "").localeCompare(right.created_at_preview ?? "") || left.result_id.localeCompare(right.result_id)
    if (sort === "newest") return (right.created_at_preview ?? "").localeCompare(left.created_at_preview ?? "") || left.result_id.localeCompare(right.result_id)
    if (sort === "confidence") return confidenceRank(right.confidence) - confidenceRank(left.confidence) || right.relevance_score - left.relevance_score || left.result_id.localeCompare(right.result_id)
    if (sort === "similarity") return right.duplicate_similarity_score - left.duplicate_similarity_score || right.relevance_score - left.relevance_score || left.result_id.localeCompare(right.result_id)
    return right.relevance_score - left.relevance_score
      || right.duplicate_similarity_score - left.duplicate_similarity_score
      || confidenceRank(right.confidence) - confidenceRank(left.confidence)
      || (right.created_at_preview ?? "").localeCompare(left.created_at_preview ?? "")
      || left.result_id.localeCompare(right.result_id)
  }
}

function confidenceRank(value?: string): number {
  if (value === "high") return 3
  if (value === "medium") return 2
  if (value === "low") return 1
  return 0
}

function researchResultSearchOptions(input: { result_type?: string; result_status?: string }): Partial<SearchResearchResultsOptions> {
  const out: Partial<SearchResearchResultsOptions> = {}
  if (isResearchResultType(input.result_type)) out.result_type = input.result_type
  if (isResearchResultStatus(input.result_status)) out.status = input.result_status
  return out
}

function isResearchResultType(value: unknown): value is ResearchResultType {
  return typeof value === "string" && [
    "probe_result", "smoke_test_result", "full_training_result", "evaluation_result", "ablation_result", "finding", "negative_finding", "bug_diagnosis", "literature_finding", "implementation_change", "checkpoint_selection", "promotion_decision", "reproduction_record",
  ].includes(value)
}

function isResearchResultStatus(value: unknown): value is ResearchResultStatus {
  return typeof value === "string" && ["proposed", "accepted", "rejected", "superseded"].includes(value)
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

function clampThreshold(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.55
  return Math.round(Math.max(0.05, Math.min(value, 1)) * 100) / 100
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
