import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import type { ResearchResult } from "../research-db/research-db"
import { redactText, redactValue } from "../security/redaction"
import type { OpenCodeLaunchGateService } from "../opencode-session/opencode-launch-gate-service"
import type { OpenCodeResultReportService } from "../opencode-session/opencode-result-report-service"
import type { OpenCodeResultReportResult } from "../opencode-session/opencode-result-report-types"
import type { OpenCodeResultReviewService } from "../opencode-session/opencode-result-review-service"
import type { OpenCodeResultReviewResult } from "../opencode-session/opencode-result-review-types"
import type { OpenCodeSessionService } from "../opencode-session/opencode-session-service"
import type { OpenCodeSessionPlan } from "../opencode-session/opencode-session-types"
import type {
  ResearchEvidenceKind,
  ResearchIngestionCommand,
  ResearchIngestionDecision,
  ResearchIngestionPreview,
  ResearchIngestionPreviewInput,
  ResearchIngestionProvenanceRef,
  ResearchIngestionRecord,
  ResearchIngestionRecordInput,
  ResearchIngestionResult,
  ResearchIngestionSummary,
} from "./research-ingestion-types"

export const RESEARCH_MEMORY_INGESTION_EVENT_KIND = "research_memory_ingestion_recorded"

const MAX_LIST = 100
const MAX_ARRAY = 16
const MAX_TEXT = 360
const LAUNCHED_STATUSES = new Set(["launch_started", "launched"])
const EVIDENCE_KINDS: ResearchEvidenceKind[] = ["positive_finding", "negative_result", "inconclusive_result", "partial_result", "blocked_result", "status_note", "artifact_index", "metric_observation", "unknown"]
const RAW_PATTERNS = [
  /\n.{100,}\n.{100,}/s,
  /(diff --git|@@ |\+\+\+ |--- )/i,
  /(stdout|stderr|traceback|stack trace|diff --git|@@ |\+\+\+ |--- ).{0,120}\n/i,
  /(full research\.db|research\.db dump|full event log|events\.jsonl|raw opencode output|provider output|file contents|checkpoint created|follow-up mission created|mission completed|mcp called|online research)/i,
]

export type ResearchIngestionDbWriter = {
  getResearchResult?: (resultId: string) => ResearchResult | null
  proposeResearchResult(input: {
    result_id?: string
    result_type: "implementation_change" | "negative_finding" | "reproduction_record"
    label?: string
    title: string
    summary: string
    confidence: "low" | "medium" | "high"
    mission_id?: string
    metrics?: unknown
    reproduction?: unknown
    created_by: "human" | "system" | "executor" | "commander" | "verifier"
  }): ResearchResult
  acceptResearchResult(resultId: string): ResearchResult
}

export type ResearchIngestionServiceOptions = {
  eventStore: EventStore
  researchDb: ResearchIngestionDbWriter
  resultReviewService: OpenCodeResultReviewService
  resultReportService: OpenCodeResultReportService
  opencodeSessionService: OpenCodeSessionService
  launchGateService: OpenCodeLaunchGateService
  now?: () => Date
  idFactory?: () => string
}

type SequencedIngestion = { record: ResearchIngestionRecord; event_index: number }

export class ResearchIngestionService {
  private readonly now: () => Date
  private readonly idFactory: () => string
  private recordQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: ResearchIngestionServiceOptions) {
    this.now = options.now ?? (() => new Date())
    this.idFactory = options.idFactory ?? (() => `research_ingestion_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`)
  }

  async preview(input: ResearchIngestionPreviewInput = {}): Promise<ResearchIngestionPreview> {
    return this.buildPreview(input)
  }

  async record(input: ResearchIngestionRecordInput = {}): Promise<ResearchIngestionResult> {
    const preview = await this.buildPreview(input)
    const ingestionId = this.idFactory()
    const recordedAt = this.now().toISOString()
    const recordedBy = bound(input.recorded_by ?? "operator") ?? "operator"
    const memoryId = preview.can_ingest ? researchMemoryId(preview.review_id) : undefined
    if (!preview.can_ingest) return resultFromPreview(preview, { ingestion_id: ingestionId, status: "blocked", recorded_at: recordedAt, recorded_by: recordedBy, error: preview.blockers[0] ?? "research ingestion is blocked" })
    if (input.dry_run === true) return resultFromPreview(preview, { ingestion_id: ingestionId, status: "dry_run", recorded_at: recordedAt, recorded_by: recordedBy, research_memory_id: memoryId, research_db_write_status: "dry_run" })
    return this.serializeRecord(async () => {
      const rebuilt = await this.buildPreview(input)
      const rebuiltMemoryId = rebuilt.can_ingest ? researchMemoryId(rebuilt.review_id) : undefined
      if (!rebuilt.can_ingest) return resultFromPreview(rebuilt, { ingestion_id: ingestionId, status: "blocked", recorded_at: recordedAt, recorded_by: recordedBy, error: rebuilt.blockers[0] ?? "research ingestion is blocked" })
      let researchResult: ResearchResult
      try {
        researchResult = this.writeResearchMemory(rebuilt, rebuiltMemoryId ?? memoryId ?? ingestionId, recordedBy)
      } catch (error) {
        const result = resultFromPreview(rebuilt, {
          ingestion_id: ingestionId,
          status: "failed",
          recorded_at: recordedAt,
          recorded_by: recordedBy,
          research_memory_id: rebuiltMemoryId,
          research_db_write_status: "write_failed",
          research_db_written: false,
          error: redactText(error instanceof Error ? error.message : String(error)),
        })
        await this.options.eventStore.append(eventPayload(result) as JsonlEvent)
        return result
      }
      const result = resultFromPreview(rebuilt, {
        ingestion_id: ingestionId,
        status: "recorded",
        recorded_at: recordedAt,
        recorded_by: recordedBy,
        research_memory_id: researchResult.result_id,
        research_db_row_id: researchResult.result_id,
        research_db_write_status: "written",
        research_db_written: true,
      })
      await this.options.eventStore.append(eventPayload(result) as JsonlEvent)
      return redactValue(result)
    })
  }

  async list(input: { limit?: number; review_id?: string; report_id?: string; session_id?: string; launch_id?: string; evidence_kind?: string; research_db_written?: boolean } = {}): Promise<ResearchIngestionRecord[]> {
    const limit = positiveInteger(input.limit, 20, MAX_LIST)
    return (await this.sequencedRecords())
      .filter((item) => !input.review_id || item.record.review_id === input.review_id)
      .filter((item) => !input.report_id || item.record.report_id === input.report_id)
      .filter((item) => !input.session_id || item.record.session_id === input.session_id)
      .filter((item) => !input.launch_id || item.record.launch_id === input.launch_id)
      .filter((item) => !input.evidence_kind || item.record.evidence_kind === input.evidence_kind)
      .filter((item) => input.research_db_written === undefined || item.record.research_db_written === input.research_db_written)
      .sort(compareSequencedDesc)
      .map((item) => item.record)
      .slice(0, limit)
  }

  async get(ingestionId: string): Promise<ResearchIngestionResult | null> {
    const event = (await this.options.eventStore.readAll()).filter(isIngestionEvent).reverse().find((item) => item.ingestion_id === ingestionId)
    return event ? resultFromEvent(event) : null
  }

  async latest(input: { review_id?: string; report_id?: string; session_id?: string; launch_id?: string } = {}): Promise<ResearchIngestionResult | null> {
    const latest = (await this.list({ ...input, limit: 1 }))[0]
    return latest ? this.get(latest.ingestion_id) : null
  }

  async summary(input: { limit?: number } = {}): Promise<ResearchIngestionSummary> {
    const records = (await this.sequencedRecords()).sort(compareSequencedDesc).map((item) => item.record)
    const limit = positiveInteger(input.limit, 10, MAX_LIST)
    return redactValue({
      total_ingestions: records.length,
      research_memory_count: new Set(records.filter((record) => record.research_db_written).map((record) => record.research_memory_id).filter(Boolean)).size,
      session_count: new Set(records.map((record) => record.session_id)).size,
      positive_finding_count: records.filter((record) => record.evidence_kind === "positive_finding").length,
      negative_result_count: records.filter((record) => record.evidence_kind === "negative_result").length,
      inconclusive_result_count: records.filter((record) => record.evidence_kind === "inconclusive_result").length,
      partial_result_count: records.filter((record) => record.evidence_kind === "partial_result").length,
      blocked_result_count: records.filter((record) => record.evidence_kind === "blocked_result").length,
      db_written_count: records.filter((record) => record.research_db_written).length,
      failed_count: (await this.options.eventStore.readAll()).filter((event) => isIngestionEvent(event) && event.research_db_write_status === "write_failed").length,
      latest_ingestions: records.slice(0, limit),
      generated_at: this.now().toISOString(),
    })
  }

  private async buildPreview(input: ResearchIngestionPreviewInput): Promise<ResearchIngestionPreview> {
    const generatedAt = this.now().toISOString()
    const blockers: string[] = []
    const warnings = [
      "research ingestion writes bounded research-memory evidence only; it does not mutate missions, create checkpoints, create follow-up missions, call providers/MCPs, prompt OpenCode, or control processes",
      "accepted-as-evidence reviews can be ingested as durable evidence, not as universal truth or mission completion",
    ]
    const reviewId = bound(input.review_id) ?? ""
    if (!reviewId) blockers.push("review_id is required")
    const review = reviewId ? await this.options.resultReviewService.get(reviewId) : null
    if (reviewId && !review) blockers.push("review_id does not resolve to an OpenCode result review")
    const report = review ? await this.options.resultReportService.get(review.report_id) : null
    if (review && !report) blockers.push("linked result report does not resolve")
    const session = report ? await this.options.opencodeSessionService.get(report.session_id) : null
    if (report && !session) blockers.push("linked session_id does not resolve to a planned OpenCode session")
    const launch = report?.launch_id ? await this.options.launchGateService.get(report.launch_id) : null
    if (report && !report.launch_id) blockers.push("linked result report does not include launch_id")
    if (report?.launch_id && !launch) blockers.push("linked launch_id does not resolve to an OpenCode launch record")
    if (report && launch && launch.session_id !== report.session_id) blockers.push("linked launch_id does not belong to session_id")
    if (launch && !LAUNCHED_STATUSES.has(launch.status)) blockers.push(`research ingestion requires launch_started or launched status; current status is ${launch.status}`)
    if (review && (review.decision !== "accepted" || review.review_disposition !== "accepted_as_evidence" || review.projection_state_after !== "reviewed_accepted")) {
      blockers.push(blockedReviewMessage(review.decision))
    }
    const existing = reviewId ? await this.latestSuccessfulForReview(reviewId) : null
    if (existing) blockers.push("research ingestion already exists for this review_id")
    const rawBlocked = inputLooksRaw(input) || inputLooksRaw(review) || inputLooksRaw(report)
    if (rawBlocked) blockers.push("raw logs, full diffs, file contents, raw OpenCode output, provider output, full event logs, research.db dumps, mission mutation claims, checkpoints, follow-up missions, providers, MCPs, and online research are out of scope for research ingestion")

    const derivedKind = report ? evidenceKindForReport(report) : "unknown"
    const evidenceKind = readEvidenceKind(input.evidence_kind ?? derivedKind)
    if (input.evidence_kind && !isCompatibleEvidenceKind(evidenceKind, derivedKind)) blockers.push("evidence_kind override is incompatible with the accepted result report kind")
    const title = bound(input.research_title) ?? deriveTitle(session, report)
    const question = bound(input.research_question) ?? deriveQuestion(session, report)
    const hypothesis = bound(input.hypothesis) ?? firstBound(report?.claims_preview)
    const method = bound(input.method) ?? deriveMethod(report)
    const outcome = deriveOutcome(report, review)
    const evidenceSummary = deriveEvidenceSummary(report, review)
    const claims = unique([...(report?.claims_preview ?? []), ...(review?.accepted_claims_preview ?? [])].map((item) => bound(item)).filter(isString)).slice(0, MAX_ARRAY)
    const metrics = boundArray(report?.metrics_preview)
    const artifacts = boundArray([...(report?.artifacts_preview ?? []), ...(review?.artifact_refs_preview ?? [])])
    const tests = boundArray([...(report?.tests_run_preview ?? []), ...(report?.test_results_preview ?? []), ...(review?.test_refs_preview ?? [])])
    const failures = boundArray([...(report?.known_failures_preview ?? []), ...(review?.rejected_claims_preview ?? []), ...(review?.risk_flags_preview ?? [])])
    const followups = boundArray([...(report?.followups_preview ?? []), ...(review?.followup_requests_preview ?? [])])
    const tags = unique([...(input.tags ?? []), "opencode", "reviewed", "accepted", report?.result_kind ?? "", evidenceKind].map((item) => bound(item, 80)).filter(isString)).slice(0, MAX_ARRAY)
    const confidence = readConfidence(review?.confidence ?? report?.confidence)
    const noveltyKey = bound(input.novelty_key) ?? noveltyKeyFor(question, title, claims)
    const provenanceRefs = report && review ? provenanceFor(report, review) : []
    const ingestionHash = hash(stableJson({
      review_id: reviewId,
      report_id: report?.report_id,
      session_id: report?.session_id,
      launch_id: report?.launch_id,
      evidenceKind,
      title,
      question,
      hypothesis,
      method,
      outcome,
      evidenceSummary,
      claims,
      metrics,
      artifacts,
      tests,
      failures,
      followups,
      tags,
      confidence,
      noveltyKey,
    }))
    const duplicateHash = ingestionHash ? (await this.sequencedRecords()).find((item) => item.record.research_db_written && item.record.ingestion_hash === ingestionHash) : null
    if (duplicateHash) blockers.push("research ingestion with the same ingestion_hash already exists")
    const canIngest = blockers.length === 0
    const decision: ResearchIngestionDecision = canIngest && review?.decision === "accepted" ? "ingest" : review?.decision === "needs_followup" ? "defer" : blockers.length ? "block" : "unknown"
    return redactValue({
      preview_id: `research_ingestion_preview_${ingestionHash.slice(0, 16)}`,
      status: canIngest ? "ready" : "blocked",
      can_ingest: canIngest,
      review_id: reviewId,
      report_id: report?.report_id ?? review?.report_id ?? "",
      session_id: report?.session_id ?? review?.session_id ?? "",
      mission_id: session?.mission_id,
      launch_id: report?.launch_id ?? review?.launch_id,
      source_kind: "opencode_result_review",
      evidence_kind: evidenceKind,
      ingestion_decision: canIngest ? "ingest" : decision,
      review_decision: review?.decision,
      review_disposition: review?.review_disposition,
      review_projection_state: review?.projection_state_after,
      report_kind: report?.result_kind,
      report_disposition: report?.result_disposition,
      research_title_preview: title,
      research_question_preview: question,
      hypothesis_preview: hypothesis,
      method_preview: method,
      outcome_preview: outcome,
      evidence_summary_preview: evidenceSummary,
      claims_preview: claims,
      metrics_preview: metrics,
      artifacts_preview: artifacts,
      tests_preview: tests,
      failures_preview: failures,
      followups_preview: followups,
      tags_preview: tags,
      confidence,
      novelty_key_preview: noveltyKey,
      provenance_refs: provenanceRefs,
      research_db_write_status: "not_written",
      research_db_written: false,
      mission_mutated: false,
      checkpoint_created: false,
      followup_mission_created: false,
      provider_called: false,
      mcp_called: false,
      blockers: boundArray(unique(blockers)),
      warnings: boundArray(unique(warnings)),
      recommended_commands: recommendedCommands(reviewId, report?.session_id, canIngest),
      generated_at: generatedAt,
      redacted_summary_preview: canIngest ? "Research-memory ingestion is ready for explicit recording." : blockers[0] ?? "Research ingestion blocked",
      ingestion_hash: ingestionHash,
    })
  }

  private writeResearchMemory(preview: ResearchIngestionPreview, researchMemoryId: string, recordedBy: string): ResearchResult {
    const existing = this.options.researchDb.getResearchResult?.(researchMemoryId)
    if (existing?.status === "accepted") return existing
    const resultType = resultTypeForEvidenceKind(preview.evidence_kind)
    const result = this.options.researchDb.proposeResearchResult({
      result_id: researchMemoryId,
      result_type: resultType,
      label: researchMemoryLabelForEvidenceKind(preview.evidence_kind),
      title: preview.research_title_preview,
      summary: preview.evidence_summary_preview,
      confidence: confidenceForDb(preview.confidence),
      mission_id: preview.mission_id,
      metrics: {
        metrics_preview: preview.metrics_preview,
        evidence_kind: preview.evidence_kind,
        review_id: preview.review_id,
        report_id: preview.report_id,
        launch_id: preview.launch_id,
        novelty_key: preview.novelty_key_preview,
      },
      reproduction: {
        source_kind: "opencode_result_review",
        outcome_preview: preview.outcome_preview,
        method_preview: preview.method_preview,
        claims_preview: preview.claims_preview,
        artifacts_preview: preview.artifacts_preview,
        tests_preview: preview.tests_preview,
        failures_preview: preview.failures_preview,
        followups_preview: preview.followups_preview,
        tags_preview: preview.tags_preview,
        provenance_refs: preview.provenance_refs,
        recorded_by: redactText(recordedBy),
      },
      created_by: "human",
    })
    return this.options.researchDb.acceptResearchResult(result.result_id)
  }

  private async latestSuccessfulForReview(reviewId: string): Promise<ResearchIngestionRecord | null> {
    return (await this.sequencedRecords())
      .filter((item) => item.record.review_id === reviewId && item.record.research_db_written)
      .sort(compareSequencedDesc)[0]?.record ?? null
  }

  private async sequencedRecords(): Promise<SequencedIngestion[]> {
    return (await this.options.eventStore.readAll())
      .map((event, index) => ({ event, index }))
      .filter((item) => isIngestionEvent(item.event))
      .map((item) => ({ record: recordFromEvent(item.event), event_index: item.index }))
  }

  private serializeRecord<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.recordQueue.then(operation, operation)
    this.recordQueue = next.then(() => undefined, () => undefined)
    return next
  }
}

export function readResearchIngestionPreviewInput(value: unknown): ResearchIngestionPreviewInput {
  const input = isRecord(value) ? value : {}
  return {
    review_id: optional(input.reviewId ?? input.review_id ?? input.review),
    evidence_kind: optional(input.evidenceKind ?? input.evidence_kind),
    tags: optionalArray(input.tags),
    research_title: optionalRaw(input.researchTitle ?? input.research_title),
    research_question: optionalRaw(input.researchQuestion ?? input.research_question),
    hypothesis: optionalRaw(input.hypothesis),
    method: optionalRaw(input.method),
    novelty_key: optionalRaw(input.noveltyKey ?? input.novelty_key),
    recorded_by: optional(input.recordedBy ?? input.recorded_by),
  }
}

export function readResearchIngestionRecordInput(value: unknown): ResearchIngestionRecordInput {
  const input = isRecord(value) ? value : {}
  return {
    ...readResearchIngestionPreviewInput(value),
    dry_run: optionalBoolean(input.dryRun ?? input.dry_run),
    recorded_by: optional(input.recordedBy ?? input.recorded_by),
  }
}

function resultFromPreview(preview: ResearchIngestionPreview, overrides: { ingestion_id: string; status: ResearchIngestionResult["status"]; recorded_at: string; recorded_by: string; research_memory_id?: string; research_db_row_id?: string; research_db_write_status?: ResearchIngestionResult["research_db_write_status"]; research_db_written?: boolean; error?: string }): ResearchIngestionResult {
  return redactValue({
    ingestion_id: overrides.ingestion_id,
    status: overrides.status,
    review_id: preview.review_id,
    report_id: preview.report_id,
    session_id: preview.session_id,
    mission_id: preview.mission_id,
    launch_id: preview.launch_id,
    source_kind: preview.source_kind,
    evidence_kind: preview.evidence_kind,
    ingestion_decision: preview.ingestion_decision,
    review_decision: preview.review_decision,
    review_disposition: preview.review_disposition,
    review_projection_state: preview.review_projection_state,
    report_kind: preview.report_kind,
    report_disposition: preview.report_disposition,
    research_memory_id: overrides.research_memory_id,
    research_db_row_id: overrides.research_db_row_id,
    research_title_preview: preview.research_title_preview,
    research_question_preview: preview.research_question_preview,
    hypothesis_preview: preview.hypothesis_preview,
    method_preview: preview.method_preview,
    outcome_preview: preview.outcome_preview,
    evidence_summary_preview: preview.evidence_summary_preview,
    claims_preview: preview.claims_preview,
    metrics_preview: preview.metrics_preview,
    artifacts_preview: preview.artifacts_preview,
    tests_preview: preview.tests_preview,
    failures_preview: preview.failures_preview,
    followups_preview: preview.followups_preview,
    tags_preview: preview.tags_preview,
    confidence: preview.confidence,
    novelty_key_preview: preview.novelty_key_preview,
    provenance_refs: preview.provenance_refs,
    research_db_write_status: overrides.research_db_write_status ?? "not_written",
    research_db_written: overrides.research_db_written ?? false,
    mission_mutated: false,
    checkpoint_created: false,
    followup_mission_created: false,
    provider_called: false,
    mcp_called: false,
    recorded_at: overrides.recorded_at,
    recorded_by: overrides.recorded_by,
    error: overrides.error,
    ingestion_hash: preview.ingestion_hash,
    recommended_commands: preview.recommended_commands,
  })
}

function eventPayload(result: ResearchIngestionResult): Record<string, unknown> {
  return {
    kind: RESEARCH_MEMORY_INGESTION_EVENT_KIND,
    ingestion_id: result.ingestion_id,
    research_memory_id: result.research_memory_id,
    research_db_row_id: result.research_db_row_id,
    review_id: result.review_id,
    report_id: result.report_id,
    session_id: result.session_id,
    mission_id: result.mission_id,
    launch_id: result.launch_id,
    source_kind: result.source_kind,
    evidence_kind: result.evidence_kind,
    ingestion_decision: result.ingestion_decision,
    review_decision: result.review_decision,
    review_disposition: result.review_disposition,
    review_projection_state: result.review_projection_state,
    report_kind: result.report_kind,
    report_disposition: result.report_disposition,
    research_title_preview: result.research_title_preview,
    research_question_preview: result.research_question_preview,
    hypothesis_preview: result.hypothesis_preview,
    method_preview: result.method_preview,
    outcome_preview: result.outcome_preview,
    evidence_summary_preview: result.evidence_summary_preview,
    claims_preview: result.claims_preview,
    metrics_preview: result.metrics_preview,
    artifacts_preview: result.artifacts_preview,
    tests_preview: result.tests_preview,
    failures_preview: result.failures_preview,
    followups_preview: result.followups_preview,
    tags_preview: result.tags_preview,
    confidence: result.confidence,
    novelty_key_preview: result.novelty_key_preview,
    provenance_refs: result.provenance_refs,
    research_db_write_status: result.research_db_write_status,
    research_db_written: result.research_db_written,
    mission_mutated: false,
    checkpoint_created: false,
    followup_mission_created: false,
    provider_called: false,
    mcp_called: false,
    recorded_at: result.recorded_at,
    recorded_by: result.recorded_by,
    error: result.error,
    ingestion_hash: result.ingestion_hash,
  }
}

function resultFromEvent(event: Record<string, unknown>): ResearchIngestionResult {
  const writeStatus = readWriteStatus(event.research_db_write_status)
  return redactValue({
    ingestion_id: String(event.ingestion_id ?? ""),
    status: writeStatus === "write_failed" ? "failed" : "recorded",
    review_id: String(event.review_id ?? ""),
    report_id: String(event.report_id ?? ""),
    session_id: String(event.session_id ?? ""),
    mission_id: optional(event.mission_id),
    launch_id: optional(event.launch_id),
    source_kind: "opencode_result_review",
    evidence_kind: readEvidenceKind(event.evidence_kind),
    ingestion_decision: readDecision(event.ingestion_decision),
    review_decision: optional(event.review_decision),
    review_disposition: optional(event.review_disposition),
    review_projection_state: optional(event.review_projection_state),
    report_kind: optional(event.report_kind),
    report_disposition: optional(event.report_disposition),
    research_memory_id: optional(event.research_memory_id),
    research_db_row_id: optional(event.research_db_row_id),
    research_title_preview: String(event.research_title_preview ?? ""),
    research_question_preview: optional(event.research_question_preview),
    hypothesis_preview: optional(event.hypothesis_preview),
    method_preview: optional(event.method_preview),
    outcome_preview: optional(event.outcome_preview),
    evidence_summary_preview: String(event.evidence_summary_preview ?? ""),
    claims_preview: eventArray(event.claims_preview),
    metrics_preview: eventArray(event.metrics_preview),
    artifacts_preview: eventArray(event.artifacts_preview),
    tests_preview: eventArray(event.tests_preview),
    failures_preview: eventArray(event.failures_preview),
    followups_preview: eventArray(event.followups_preview),
    tags_preview: eventArray(event.tags_preview),
    confidence: typeof event.confidence === "number" || typeof event.confidence === "string" ? event.confidence : undefined,
    novelty_key_preview: optional(event.novelty_key_preview),
    provenance_refs: provenanceArray(event.provenance_refs),
    research_db_write_status: writeStatus,
    research_db_written: event.research_db_written === true,
    mission_mutated: false,
    checkpoint_created: false,
    followup_mission_created: false,
    provider_called: false,
    mcp_called: false,
    recorded_at: String(event.recorded_at ?? ""),
    recorded_by: String(event.recorded_by ?? "unknown"),
    error: optional(event.error),
    ingestion_hash: String(event.ingestion_hash ?? ""),
    recommended_commands: recommendedCommands(String(event.review_id ?? ""), String(event.session_id ?? ""), false),
  })
}

function recordFromEvent(event: Record<string, unknown>): ResearchIngestionRecord {
  return redactValue({
    ingestion_id: String(event.ingestion_id ?? ""),
    research_memory_id: optional(event.research_memory_id),
    review_id: String(event.review_id ?? ""),
    report_id: String(event.report_id ?? ""),
    session_id: String(event.session_id ?? ""),
    mission_id: optional(event.mission_id),
    launch_id: optional(event.launch_id),
    evidence_kind: readEvidenceKind(event.evidence_kind),
    ingestion_decision: readDecision(event.ingestion_decision),
    research_title_preview: String(event.research_title_preview ?? ""),
    evidence_summary_preview: String(event.evidence_summary_preview ?? ""),
    research_db_written: event.research_db_written === true,
    recorded_at: String(event.recorded_at ?? ""),
    recorded_by: String(event.recorded_by ?? "unknown"),
    confidence: typeof event.confidence === "number" || typeof event.confidence === "string" ? event.confidence : undefined,
    ingestion_hash: String(event.ingestion_hash ?? ""),
  })
}

function isIngestionEvent(event: unknown): event is Record<string, unknown> {
  return isRecord(event) && event.kind === RESEARCH_MEMORY_INGESTION_EVENT_KIND
}

function evidenceKindForReport(report: OpenCodeResultReportResult): ResearchEvidenceKind {
  if (report.result_kind === "completion_report" || report.result_disposition === "reported_done") return "positive_finding"
  if (report.result_kind === "partial_report" || report.result_disposition === "reported_partial") return "partial_result"
  if (report.result_kind === "failure_report" || report.result_disposition === "reported_failed") return "negative_result"
  if (report.result_kind === "inconclusive_report" || report.result_disposition === "reported_inconclusive") return "inconclusive_result"
  if (report.result_kind === "blocked_report" || report.result_disposition === "reported_blocked") return "blocked_result"
  if (report.result_kind === "status_report" || report.result_disposition === "reported_status_only") return "status_note"
  return "unknown"
}

function resultTypeForEvidenceKind(kind: ResearchEvidenceKind): "implementation_change" | "negative_finding" | "reproduction_record" {
  if (kind === "negative_result" || kind === "blocked_result") return "negative_finding"
  if (kind === "partial_result" || kind === "inconclusive_result" || kind === "status_note" || kind === "artifact_index" || kind === "metric_observation") return "reproduction_record"
  return "implementation_change"
}

function researchMemoryLabelForEvidenceKind(kind: ResearchEvidenceKind): string {
  if (kind === "negative_result" || kind === "blocked_result") return "failure"
  if (kind === "partial_result" || kind === "inconclusive_result" || kind === "status_note" || kind === "artifact_index" || kind === "metric_observation") return "probe"
  return "finding"
}

function isCompatibleEvidenceKind(input: ResearchEvidenceKind, derived: ResearchEvidenceKind): boolean {
  if (input === derived) return true
  if (derived === "positive_finding" && input === "metric_observation") return true
  if (derived === "status_note" && (input === "artifact_index" || input === "metric_observation")) return true
  return false
}

function blockedReviewMessage(decision: string): string {
  if (decision === "rejected") return "rejected evidence is not ingested in 9P"
  if (decision === "needs_revision") return "revision-required evidence is not ingested in 9P"
  if (decision === "needs_followup") return "follow-up-required evidence is not ingested in 9P"
  if (decision === "deferred") return "deferred reviews are not ingested in 9P"
  if (decision === "inconclusive") return "inconclusive reviews are not ingested in 9P"
  if (decision === "needs_human_review") return "human-review-required evidence is not ingested in 9P"
  return "research ingestion requires an accepted-as-evidence result review"
}

function deriveTitle(session: OpenCodeSessionPlan | null, report: OpenCodeResultReportResult | null): string {
  return bound(session?.objective || report?.summary_preview || "OpenCode reviewed result evidence") ?? "OpenCode reviewed result evidence"
}

function deriveQuestion(session: OpenCodeSessionPlan | null, report: OpenCodeResultReportResult | null): string | undefined {
  return bound(session?.objective || report?.summary_preview || "")
}

function deriveMethod(report: OpenCodeResultReportResult | null): string | undefined {
  const tests = report?.tests_run_preview?.join(", ")
  if (tests) return bound(`OpenCode result report with tests: ${tests}`)
  if (report?.result_kind) return bound(`OpenCode ${report.result_kind}`)
  return undefined
}

function deriveOutcome(report: OpenCodeResultReportResult | null, review: OpenCodeResultReviewResult | null): string | undefined {
  return bound([report?.outcome_preview, review?.decision ? `review=${review.decision}` : undefined, review?.rationale_preview].filter(Boolean).join("; "))
}

function deriveEvidenceSummary(report: OpenCodeResultReportResult | null, review: OpenCodeResultReviewResult | null): string {
  return bound([report?.summary_preview, report?.outcome_preview, review?.rationale_preview].filter(Boolean).join("; ")) ?? "accepted OpenCode result evidence"
}

function provenanceFor(report: OpenCodeResultReportResult, review: OpenCodeResultReviewResult): ResearchIngestionProvenanceRef[] {
  const refs: ResearchIngestionProvenanceRef[] = [
    provenance("result_review", review.review_id, review.decision, review.rationale_preview),
    provenance("result_report", report.report_id, report.result_kind, report.summary_preview),
    provenance("opencode_session", report.session_id, "session", report.summary_preview),
  ]
  if (report.launch_id) refs.push(provenance("opencode_launch", report.launch_id, "launch", report.result_disposition))
  for (const [kind, id] of [
    ["progress", report.linked_progress_id],
    ["watchdog", report.linked_watchdog_id],
    ["commander_question", report.linked_question_id],
    ["commander_guidance", report.linked_guidance_id],
    ["guidance_delivery", report.linked_delivery_id],
    ["wake_execution", report.linked_wake_execution_id],
    ["wake_action_execution", report.linked_wake_action_execution_id],
  ] as const) {
    if (id) refs.push(provenance(kind, id, "linked evidence"))
  }
  return refs.slice(0, 16)
}

function provenance(sourceKind: string, sourceId: string, status?: string, summary?: string): ResearchIngestionProvenanceRef {
  return {
    source_kind: sourceKind,
    source_id: bound(sourceId, 160) ?? "",
    status: bound(status ?? "", 80),
    summary_preview: bound(summary ?? ""),
    pointer_only: true,
  }
}

function recommendedCommands(reviewId: string, sessionId: string | undefined, canIngest: boolean): ResearchIngestionCommand[] {
  const commands: ResearchIngestionCommand[] = [
    { label: "List ingestions", command: reviewId ? `/research-ingestions review=${reviewId}` : "/research-ingestions", command_type: "read" },
    { label: "Research memory summary", command: "/research-memory-summary", command_type: "read" },
    { label: "Show authority", command: "/authority-show /research-ingestion", command_type: "read" },
  ]
  if (canIngest) commands.unshift({ label: "Record ingestion", command: `/research-ingestion review=${reviewId}`, command_type: "write", requires_active_runtime: true, notes: "explicit research-memory write only; no mission/checkpoint/provider/MCP/OpenCode/process side effects" })
  if (sessionId) commands.push({ label: "Search ingested memory", command: `/research-memory-search query=${sessionId}`, command_type: "read" })
  return commands
}

function researchMemoryId(reviewId: string): string {
  return `research_memory_${hash(reviewId).slice(0, 24)}`
}

function noveltyKeyFor(question: string | undefined, title: string, claims: string[]): string | undefined {
  return bound([question, title, claims.slice(0, 3).join(" ")].filter(Boolean).join(" "), 240)
}

function readEvidenceKind(value: unknown): ResearchEvidenceKind {
  return typeof value === "string" && (EVIDENCE_KINDS as string[]).includes(value) ? value as ResearchEvidenceKind : "unknown"
}

function readDecision(value: unknown): ResearchIngestionDecision {
  return value === "ingest" || value === "block" || value === "defer" ? value : "unknown"
}

function readWriteStatus(value: unknown): ResearchIngestionResult["research_db_write_status"] {
  if (value === "written" || value === "write_failed" || value === "dry_run" || value === "not_written") return value
  return "not_written"
}

function confidenceForDb(value: unknown): "low" | "medium" | "high" {
  if (value === "high" || value === 1 || value === "1") return "high"
  if (value === "low" || value === 0 || value === "0") return "low"
  if (typeof value === "number") return value >= 0.67 ? "high" : value <= 0.33 ? "low" : "medium"
  return value === "medium" ? "medium" : "medium"
}

function readConfidence(value: unknown): string | number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.min(1, value))
  if (typeof value === "string") {
    const trimmed = bound(value, 80)
    return trimmed || undefined
  }
  return undefined
}

function inputLooksRaw(value: unknown): boolean {
  const text = JSON.stringify(value ?? "").replace(/\\r\\n|\\n|\\r/g, "\n")
  return RAW_PATTERNS.some((pattern) => pattern.test(text))
}

function positiveInteger(value: unknown, fallback: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback
}

function eventArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => bound(item)).filter(isString).slice(0, MAX_ARRAY) : []
}

function provenanceArray(value: unknown): ResearchIngestionProvenanceRef[] {
  return Array.isArray(value) ? value.filter(isRecord).map((item) => provenance(String(item.source_kind ?? "unknown"), String(item.source_id ?? ""), optional(item.status), optional(item.summary_preview))).slice(0, 16) : []
}

function boundArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => bound(item)).filter(isString).slice(0, MAX_ARRAY) : []
}

function firstBound(value: unknown): string | undefined {
  return Array.isArray(value) ? bound(String(value.find((item) => typeof item === "string") ?? "")) : undefined
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function optionalRaw(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function optionalArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === "string").map((item) => bound(item, 80)).filter(isString).slice(0, MAX_ARRAY)
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function bound(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value !== "string") return undefined
  const redacted = redactText(value.trim())
  if (!redacted) return undefined
  return redacted.length <= max ? redacted : `${redacted.slice(0, Math.max(0, max - 1))}…`
}

function unique<T>(value: T[]): T[] {
  return Array.from(new Set(value))
}

function compareSequencedDesc(left: SequencedIngestion, right: SequencedIngestion): number {
  const time = right.record.recorded_at.localeCompare(left.record.recorded_at)
  if (time !== 0) return time
  return right.event_index - left.event_index
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
