import { createHash } from "node:crypto"
import type { EventStore } from "../events/event-store"
import type { JsonlEvent } from "../events/event-types"
import { redactValue } from "../security/redaction"
import type { OpenCodeLaunchGateService } from "./opencode-launch-gate-service"
import type { OpenCodeSessionService } from "./opencode-session-service"
import type { OpenCodeResultReportService } from "./opencode-result-report-service"
import type { OpenCodeResultReportResult } from "./opencode-result-report-types"
import type {
  OpenCodeResultReviewAuthorKind,
  OpenCodeResultReviewCommand,
  OpenCodeResultReviewDecision,
  OpenCodeResultReviewDisposition,
  OpenCodeResultReviewNextStep,
  OpenCodeResultReviewPreview,
  OpenCodeResultReviewPreviewInput,
  OpenCodeResultReviewProjectionState,
  OpenCodeResultReviewRecord,
  OpenCodeResultReviewRecordInput,
  OpenCodeResultReviewResult,
  OpenCodeResultReviewSummary,
} from "./opencode-result-review-types"

export const OPEN_CODE_RESULT_REVIEW_EVENT_KIND = "opencode_result_review_recorded"

const MAX_LIST = 100
const MAX_ARRAY = 16
const MAX_TEXT = 360
const LAUNCHED_STATUSES = new Set(["launch_started", "launched"])
const RAW_PATTERNS = [
  /\n.{100,}\n.{100,}/s,
  /(stdout|stderr|traceback|stack trace|bun test v|npm error|diff --git|@@ |\+\+\+ |--- ).{0,120}\n/i,
  /(\[[0-9]{2}:[0-9]{2}:[0-9]{2}\].*\n){3,}/i,
  /(full research\.db|research\.db|full event log|events\.jsonl|raw opencode output|provider output|file contents|checkpoint created|research result ingested|mission completed)/i,
]

export type OpenCodeResultReviewServiceOptions = {
  eventStore: EventStore
  opencodeSessionService: OpenCodeSessionService
  launchGateService: OpenCodeLaunchGateService
  resultReportService: OpenCodeResultReportService
  now?: () => Date
  idFactory?: () => string
}

type SequencedReview = { record: OpenCodeResultReviewRecord; event_index: number }

export class OpenCodeResultReviewService {
  private readonly now: () => Date
  private readonly idFactory: () => string
  private recordQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: OpenCodeResultReviewServiceOptions) {
    this.now = options.now ?? (() => new Date())
    this.idFactory = options.idFactory ?? (() => `opencode_result_review_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`)
  }

  async preview(input: OpenCodeResultReviewPreviewInput = {}): Promise<OpenCodeResultReviewPreview> {
    return this.buildPreview(input)
  }

  async record(input: OpenCodeResultReviewRecordInput = {}): Promise<OpenCodeResultReviewResult> {
    const preview = await this.buildPreview(input)
    const reviewId = this.idFactory()
    const recordedAt = this.now().toISOString()
    const recordedBy = bound(input.recorded_by ?? "operator") ?? "operator"
    if (!preview.can_record) return resultFromPreview(preview, { review_id: reviewId, status: "blocked", recorded_at: recordedAt, recorded_by: recordedBy, error: preview.blockers[0] ?? "OpenCode result review is blocked" })
    const existing = await this.latestForReport(preview.report_id)
    if (existing) return resultFromPreview(preview, { review_id: reviewId, status: "blocked", recorded_at: recordedAt, recorded_by: recordedBy, error: "OpenCode result report already has a result review" })
    if (input.dry_run === true) return resultFromPreview(preview, { review_id: reviewId, status: "dry_run", recorded_at: recordedAt, recorded_by: recordedBy })
    return this.serializeRecord(async () => {
      const rebuilt = await this.buildPreview(input)
      if (!rebuilt.can_record) return resultFromPreview(rebuilt, { review_id: reviewId, status: "blocked", recorded_at: recordedAt, recorded_by: recordedBy, error: rebuilt.blockers[0] ?? "OpenCode result review is blocked" })
      const existingAfterLock = await this.latestForReport(rebuilt.report_id)
      if (existingAfterLock) return resultFromPreview(rebuilt, { review_id: reviewId, status: "blocked", recorded_at: recordedAt, recorded_by: recordedBy, error: "OpenCode result report already has a result review" })
      const result = resultFromPreview(rebuilt, { review_id: reviewId, status: "recorded", recorded_at: recordedAt, recorded_by: recordedBy })
      await this.options.eventStore.append(eventPayload(result) as JsonlEvent)
      return redactValue(result)
    })
  }

  async list(input: { limit?: number; report_id?: string; session_id?: string; launch_id?: string; decision?: string; review_disposition?: string; projection_state_after?: string; next_step?: string } = {}): Promise<OpenCodeResultReviewRecord[]> {
    const limit = positiveInteger(input.limit, 20, MAX_LIST)
    return (await this.sequencedRecords())
      .filter((item) => !input.report_id || item.record.report_id === input.report_id)
      .filter((item) => !input.session_id || item.record.session_id === input.session_id)
      .filter((item) => !input.launch_id || item.record.launch_id === input.launch_id)
      .filter((item) => !input.decision || item.record.decision === input.decision)
      .filter((item) => !input.review_disposition || item.record.review_disposition === input.review_disposition)
      .filter((item) => !input.projection_state_after || item.record.projection_state_after === input.projection_state_after)
      .filter((item) => !input.next_step || item.record.next_step === input.next_step)
      .sort(compareSequencedDesc)
      .map((item) => item.record)
      .slice(0, limit)
  }

  async get(reviewId: string): Promise<OpenCodeResultReviewResult | null> {
    const event = (await this.options.eventStore.readAll()).filter(isReviewEvent).reverse().find((item) => item.review_id === reviewId)
    return event ? resultFromEvent(event) : null
  }

  async latest(input: { report_id?: string; session_id?: string; launch_id?: string } = {}): Promise<OpenCodeResultReviewResult | null> {
    const latest = (await this.list({ ...input, limit: 1 }))[0]
    return latest ? this.get(latest.review_id) : null
  }

  async summary(input: { limit?: number } = {}): Promise<OpenCodeResultReviewSummary> {
    const records = (await this.sequencedRecords()).sort(compareSequencedDesc).map((item) => item.record)
    const limit = positiveInteger(input.limit, 10, MAX_LIST)
    return redactValue({
      total_reviews: records.length,
      reviewed_report_count: new Set(records.map((record) => record.report_id)).size,
      accepted_count: records.filter((record) => record.decision === "accepted").length,
      rejected_count: records.filter((record) => record.decision === "rejected").length,
      needs_revision_count: records.filter((record) => record.decision === "needs_revision").length,
      needs_followup_count: records.filter((record) => record.decision === "needs_followup").length,
      inconclusive_count: records.filter((record) => record.decision === "inconclusive").length,
      needs_human_count: records.filter((record) => record.decision === "needs_human_review").length,
      deferred_count: records.filter((record) => record.decision === "deferred").length,
      research_ingestion_recommended_count: records.filter((record) => record.next_step === "prepare_research_ingestion").length,
      latest_reviews: records.slice(0, limit),
      generated_at: this.now().toISOString(),
    })
  }

  async projectionForReport(reportId: string): Promise<OpenCodeResultReviewRecord | null> {
    return this.latestForReport(reportId)
  }

  private async buildPreview(input: OpenCodeResultReviewPreviewInput): Promise<OpenCodeResultReviewPreview> {
    const generatedAt = this.now().toISOString()
    const blockers: string[] = []
    const warnings = [
      "result review decisions are metadata only; they do not complete missions, ingest research, create checkpoints, create follow-up missions, call providers, prompt OpenCode, or control processes",
      "accepted means accepted as report evidence for future ingestion; it is not project-state mutation",
    ]
    const reportId = bound(input.report_id) ?? ""
    if (!reportId) blockers.push("report_id is required")
    const report = reportId ? await this.options.resultReportService.get(reportId) : null
    if (reportId && !report) blockers.push("report_id does not resolve to an OpenCode result report")
    if (report) await this.validateReportChain(report, blockers)
    if (report && await this.latestForReport(report.report_id)) blockers.push("OpenCode result report already has a result review")

    const decision = readDecision(input.decision)
    if (!input.decision || decision === "unknown") blockers.push("explicit valid decision is required")
    const disposition = dispositionForDecision(decision)
    const projection = projectionForDecision(decision)
    const nextStep = readNextStep(input.next_step, defaultNextStep(decision, input))
    if (input.next_step && nextStep === "unknown") blockers.push("next_step is invalid")
    const authorKind = readAuthorKind(input.author_kind)
    const rawBlocked = inputLooksRaw(input)
    if (rawBlocked) blockers.push("raw logs, full diffs, file contents, provider output, raw OpenCode output, full event logs, research.db dumps, mission mutation claims, and checkpoint claims are out of scope for result reviews")

    const rationale = rawBlocked ? "raw review payload omitted" : bound(input.rationale)
    const evidenceSummary = rawBlocked ? undefined : bound(input.evidence_summary)
    const acceptedClaims = rawBlocked ? [] : boundArray(input.accepted_claims)
    const rejectedClaims = rawBlocked ? [] : boundArray(input.rejected_claims)
    const revisionRequests = rawBlocked ? [] : boundArray(input.revision_requests)
    const followupRequests = rawBlocked ? [] : boundArray(input.followup_requests)
    const riskFlags = rawBlocked ? [] : boundArray(input.risk_flags)
    const artifactRefs = rawBlocked ? [] : boundArray(input.artifact_refs)
    const testRefs = rawBlocked ? [] : boundArray(input.test_refs)
    const confidence = readConfidence(input.confidence)

    if (decision !== "deferred" && !rationale) blockers.push("rationale is required for non-deferred result review decisions")
    if (decision === "accepted" && !rationale) blockers.push("accepted result reviews require rationale")
    if (decision === "rejected" && !rationale) blockers.push("rejected result reviews require rationale")
    if (decision === "needs_revision" && revisionRequests.length === 0 && !rationale) blockers.push("needs_revision requires revision_requests or rationale")
    if (decision === "needs_followup" && followupRequests.length === 0 && !rationale) blockers.push("needs_followup requires followup_requests or rationale")
    if (decision === "inconclusive" && riskFlags.length === 0 && !rationale) blockers.push("inconclusive requires rationale or risk_flags")
    if (decision === "needs_human_review" && riskFlags.length === 0 && !rationale) blockers.push("needs_human_review requires rationale or risk_flags")

    const reviewHash = hash(stableJson({
      report_id: reportId,
      session_id: report?.session_id,
      launch_id: report?.launch_id,
      result_kind: report?.result_kind,
      result_disposition: report?.result_disposition,
      report_review_state: report?.review_state,
      decision,
      review_disposition: disposition,
      projection_state_after: projection,
      next_step: nextStep,
      author_kind: authorKind,
      rationale,
      evidenceSummary,
      acceptedClaims,
      rejectedClaims,
      revisionRequests,
      followupRequests,
      riskFlags,
      artifactRefs,
      testRefs,
      confidence,
    }))
    const canRecord = blockers.length === 0
    return redactValue({
      preview_id: `opencode_result_review_preview_${reviewHash.slice(0, 16)}`,
      status: canRecord ? "ready" : "blocked",
      can_record: canRecord,
      report_id: reportId,
      session_id: report?.session_id ?? "",
      launch_id: report?.launch_id,
      result_kind: report?.result_kind,
      result_disposition: report?.result_disposition,
      report_review_state: report?.review_state,
      decision,
      review_disposition: disposition,
      projection_state_after: projection,
      next_step: nextStep,
      author_kind: authorKind,
      rationale_preview: rationale ?? "",
      evidence_summary_preview: evidenceSummary,
      accepted_claims_preview: acceptedClaims,
      rejected_claims_preview: rejectedClaims,
      revision_requests_preview: revisionRequests,
      followup_requests_preview: followupRequests,
      risk_flags_preview: riskFlags,
      artifact_refs_preview: artifactRefs,
      test_refs_preview: testRefs,
      confidence,
      linked_progress_id: report?.linked_progress_id,
      linked_watchdog_id: report?.linked_watchdog_id,
      linked_question_id: report?.linked_question_id,
      linked_guidance_id: report?.linked_guidance_id,
      linked_delivery_id: report?.linked_delivery_id,
      linked_wake_execution_id: report?.linked_wake_execution_id,
      linked_wake_action_execution_id: report?.linked_wake_action_execution_id,
      mission_mutated: false as const,
      research_db_written: false as const,
      checkpoint_created: false as const,
      followup_mission_created: false as const,
      provider_called: false as const,
      blockers: boundArray(unique(blockers)),
      warnings: boundArray(unique(warnings)),
      recommended_commands: recommendedCommands(reportId, report?.session_id, decision, nextStep),
      generated_at: generatedAt,
      redacted_summary_preview: canRecord ? `OpenCode result review ${decision} is ready for durable metadata recording` : blockers[0] ?? "OpenCode result review blocked",
      review_hash: reviewHash,
    })
  }

  private async validateReportChain(report: OpenCodeResultReportResult, blockers: string[]): Promise<void> {
    const session = await this.options.opencodeSessionService.get(report.session_id)
    if (!session) blockers.push("linked result report session_id does not resolve to a planned OpenCode session")
    if (!report.launch_id) {
      blockers.push("linked result report does not include launch_id")
      return
    }
    const launch = await this.options.launchGateService.get(report.launch_id)
    if (!launch) blockers.push("linked result report launch_id does not resolve to an OpenCode launch record")
    if (launch && launch.session_id !== report.session_id) blockers.push("linked result report launch_id does not belong to session_id")
    if (launch && !LAUNCHED_STATUSES.has(launch.status)) blockers.push(`OpenCode result review requires launch_started or launched status; current status is ${launch.status}`)
  }

  private async latestForReport(reportId: string): Promise<OpenCodeResultReviewRecord | null> {
    return (await this.sequencedRecords())
      .filter((item) => item.record.report_id === reportId)
      .sort(compareSequencedDesc)[0]?.record ?? null
  }

  private async sequencedRecords(): Promise<SequencedReview[]> {
    return (await this.options.eventStore.readAll())
      .map((event, index) => ({ event, index }))
      .filter((item) => isReviewEvent(item.event))
      .map((item) => ({ record: recordFromEvent(item.event), event_index: item.index }))
  }

  private serializeRecord<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.recordQueue.then(operation, operation)
    this.recordQueue = next.then(() => undefined, () => undefined)
    return next
  }
}

export function readOpenCodeResultReviewPreviewInput(value: unknown): OpenCodeResultReviewPreviewInput {
  const input = isRecord(value) ? value : {}
  return {
    report_id: optional(input.reportId ?? input.report_id ?? input.report),
    decision: optional(input.decision),
    rationale: optionalRaw(input.rationale),
    evidence_summary: optionalRaw(input.evidenceSummary ?? input.evidence_summary),
    accepted_claims: optionalArray(input.acceptedClaims ?? input.accepted_claims),
    rejected_claims: optionalArray(input.rejectedClaims ?? input.rejected_claims),
    revision_requests: optionalArray(input.revisionRequests ?? input.revision_requests),
    followup_requests: optionalArray(input.followupRequests ?? input.followup_requests),
    risk_flags: optionalArray(input.riskFlags ?? input.risk_flags),
    artifact_refs: optionalArray(input.artifactRefs ?? input.artifact_refs),
    test_refs: optionalArray(input.testRefs ?? input.test_refs),
    confidence: input.confidence,
    author_kind: optional(input.authorKind ?? input.author_kind ?? input.author),
    next_step: optional(input.nextStep ?? input.next_step),
    recorded_by: optional(input.recordedBy ?? input.recorded_by),
  }
}

export function readOpenCodeResultReviewRecordInput(value: unknown): OpenCodeResultReviewRecordInput {
  const input = isRecord(value) ? value : {}
  return {
    ...readOpenCodeResultReviewPreviewInput(value),
    dry_run: optionalBoolean(input.dryRun ?? input.dry_run),
    recorded_by: optional(input.recordedBy ?? input.recorded_by),
  }
}

export function isOpenCodeResultReviewEvent(event: unknown): event is Record<string, unknown> {
  return isReviewEvent(event)
}

export function resultReviewProjectionFromEvent(event: Record<string, unknown>): {
  review_id: string
  projection_state_after: OpenCodeResultReviewProjectionState
  decision: OpenCodeResultReviewDecision
  review_disposition: OpenCodeResultReviewDisposition
  next_step: OpenCodeResultReviewNextStep
  recorded_at: string
} {
  return {
    review_id: String(event.review_id ?? ""),
    projection_state_after: readProjectionState(event.projection_state_after),
    decision: readDecision(event.decision),
    review_disposition: readDisposition(event.review_disposition),
    next_step: readNextStep(event.next_step, "unknown"),
    recorded_at: String(event.recorded_at ?? ""),
  }
}

function resultFromPreview(preview: OpenCodeResultReviewPreview, overrides: { review_id: string; status: OpenCodeResultReviewResult["status"]; recorded_at: string; recorded_by: string; error?: string }): OpenCodeResultReviewResult {
  return redactValue({
    review_id: overrides.review_id,
    status: overrides.status,
    report_id: preview.report_id,
    session_id: preview.session_id,
    launch_id: preview.launch_id,
    result_kind: preview.result_kind,
    result_disposition: preview.result_disposition,
    report_review_state: preview.report_review_state,
    decision: preview.decision,
    review_disposition: preview.review_disposition,
    projection_state_after: preview.projection_state_after,
    next_step: preview.next_step,
    author_kind: preview.author_kind,
    rationale_preview: preview.rationale_preview,
    evidence_summary_preview: preview.evidence_summary_preview,
    accepted_claims_preview: preview.accepted_claims_preview,
    rejected_claims_preview: preview.rejected_claims_preview,
    revision_requests_preview: preview.revision_requests_preview,
    followup_requests_preview: preview.followup_requests_preview,
    risk_flags_preview: preview.risk_flags_preview,
    artifact_refs_preview: preview.artifact_refs_preview,
    test_refs_preview: preview.test_refs_preview,
    confidence: preview.confidence,
    linked_progress_id: preview.linked_progress_id,
    linked_watchdog_id: preview.linked_watchdog_id,
    linked_question_id: preview.linked_question_id,
    linked_guidance_id: preview.linked_guidance_id,
    linked_delivery_id: preview.linked_delivery_id,
    linked_wake_execution_id: preview.linked_wake_execution_id,
    linked_wake_action_execution_id: preview.linked_wake_action_execution_id,
    mission_mutated: false as const,
    research_db_written: false as const,
    checkpoint_created: false as const,
    followup_mission_created: false as const,
    provider_called: false as const,
    recorded_at: overrides.recorded_at,
    recorded_by: bound(overrides.recorded_by) ?? "operator",
    error: bound(overrides.error),
    review_hash: preview.review_hash,
    recommended_commands: preview.recommended_commands,
  })
}

function eventPayload(result: OpenCodeResultReviewResult): Record<string, unknown> {
  return redactValue({ kind: OPEN_CODE_RESULT_REVIEW_EVENT_KIND, ...result, status: undefined, recommended_commands: undefined, error: undefined })
}

function resultFromEvent(event: Record<string, unknown>): OpenCodeResultReviewResult {
  return redactValue({
    review_id: String(event.review_id ?? ""),
    status: "recorded" as const,
    ...baseFromEvent(event),
    recorded_at: String(event.recorded_at ?? ""),
    recorded_by: String(event.recorded_by ?? "operator"),
    review_hash: String(event.review_hash ?? ""),
    recommended_commands: recommendedCommands(String(event.report_id ?? ""), String(event.session_id ?? ""), readDecision(event.decision), readNextStep(event.next_step, "unknown")),
  })
}

function recordFromEvent(event: Record<string, unknown>): OpenCodeResultReviewRecord {
  const base = baseFromEvent(event)
  return redactValue({
    review_id: String(event.review_id ?? ""),
    report_id: base.report_id,
    session_id: base.session_id,
    launch_id: base.launch_id,
    decision: base.decision,
    review_disposition: base.review_disposition,
    projection_state_after: base.projection_state_after,
    next_step: base.next_step,
    author_kind: base.author_kind,
    rationale_preview: base.rationale_preview,
    recorded_at: String(event.recorded_at ?? ""),
    recorded_by: String(event.recorded_by ?? "operator"),
    confidence: base.confidence,
    has_revision_requests: base.revision_requests_preview.length > 0,
    has_followup_requests: base.followup_requests_preview.length > 0,
    review_hash: String(event.review_hash ?? ""),
  })
}

function baseFromEvent(event: Record<string, unknown>) {
  return {
    report_id: String(event.report_id ?? ""),
    session_id: String(event.session_id ?? ""),
    launch_id: optional(event.launch_id),
    result_kind: optional(event.result_kind),
    result_disposition: optional(event.result_disposition),
    report_review_state: optional(event.report_review_state),
    decision: readDecision(event.decision),
    review_disposition: readDisposition(event.review_disposition),
    projection_state_after: readProjectionState(event.projection_state_after),
    next_step: readNextStep(event.next_step, "unknown"),
    author_kind: readAuthorKind(event.author_kind),
    rationale_preview: String(event.rationale_preview ?? ""),
    evidence_summary_preview: optional(event.evidence_summary_preview),
    accepted_claims_preview: boundArray(event.accepted_claims_preview),
    rejected_claims_preview: boundArray(event.rejected_claims_preview),
    revision_requests_preview: boundArray(event.revision_requests_preview),
    followup_requests_preview: boundArray(event.followup_requests_preview),
    risk_flags_preview: boundArray(event.risk_flags_preview),
    artifact_refs_preview: boundArray(event.artifact_refs_preview),
    test_refs_preview: boundArray(event.test_refs_preview),
    confidence: readConfidence(event.confidence),
    linked_progress_id: optional(event.linked_progress_id),
    linked_watchdog_id: optional(event.linked_watchdog_id),
    linked_question_id: optional(event.linked_question_id),
    linked_guidance_id: optional(event.linked_guidance_id),
    linked_delivery_id: optional(event.linked_delivery_id),
    linked_wake_execution_id: optional(event.linked_wake_execution_id),
    linked_wake_action_execution_id: optional(event.linked_wake_action_execution_id),
    mission_mutated: false as const,
    research_db_written: false as const,
    checkpoint_created: false as const,
    followup_mission_created: false as const,
    provider_called: false as const,
  }
}

function readDecision(value: unknown): OpenCodeResultReviewDecision {
  const raw = String(value ?? "")
  if (["accepted", "rejected", "needs_revision", "needs_followup", "inconclusive", "needs_human_review", "deferred"].includes(raw)) return raw as OpenCodeResultReviewDecision
  return "unknown"
}

function dispositionForDecision(decision: OpenCodeResultReviewDecision): OpenCodeResultReviewDisposition {
  if (decision === "accepted") return "accepted_as_evidence"
  if (decision === "rejected") return "rejected_as_evidence"
  if (decision === "needs_revision") return "revision_requested"
  if (decision === "needs_followup") return "followup_requested"
  if (decision === "inconclusive") return "inconclusive_evidence"
  if (decision === "needs_human_review") return "human_review_required"
  if (decision === "deferred") return "deferred_review"
  return "unknown"
}

function readDisposition(value: unknown): OpenCodeResultReviewDisposition {
  const raw = String(value ?? "")
  if (["accepted_as_evidence", "rejected_as_evidence", "revision_requested", "followup_requested", "inconclusive_evidence", "human_review_required", "deferred_review"].includes(raw)) return raw as OpenCodeResultReviewDisposition
  return "unknown"
}

function projectionForDecision(decision: OpenCodeResultReviewDecision): OpenCodeResultReviewProjectionState {
  if (decision === "accepted") return "reviewed_accepted"
  if (decision === "rejected") return "reviewed_rejected"
  if (decision === "needs_revision") return "reviewed_needs_revision"
  if (decision === "needs_followup") return "reviewed_needs_followup"
  if (decision === "inconclusive") return "reviewed_inconclusive"
  if (decision === "needs_human_review") return "reviewed_needs_human"
  if (decision === "deferred") return "review_deferred"
  return "unreviewed"
}

function readProjectionState(value: unknown): OpenCodeResultReviewProjectionState {
  const raw = String(value ?? "")
  if (["unreviewed", "reviewed_accepted", "reviewed_rejected", "reviewed_needs_revision", "reviewed_needs_followup", "reviewed_inconclusive", "reviewed_needs_human", "review_deferred"].includes(raw)) return raw as OpenCodeResultReviewProjectionState
  return "unreviewed"
}

function defaultNextStep(decision: OpenCodeResultReviewDecision, input: OpenCodeResultReviewPreviewInput): OpenCodeResultReviewNextStep {
  if (decision === "accepted") return "prepare_research_ingestion"
  if (decision === "rejected") return boundArray(input.revision_requests).length > 0 ? "request_revision" : "none"
  if (decision === "needs_revision") return "request_revision"
  if (decision === "needs_followup") return "request_followup"
  if (decision === "inconclusive") return boundArray(input.artifact_refs).length > 0 ? "inspect_artifacts" : "request_followup"
  if (decision === "needs_human_review") return "escalate_to_human"
  if (decision === "deferred") return "inspect_artifacts"
  return "unknown"
}

function readNextStep(value: unknown, fallback: OpenCodeResultReviewNextStep): OpenCodeResultReviewNextStep {
  const raw = optional(value)
  if (!raw) return fallback
  if (["none", "prepare_research_ingestion", "request_revision", "request_followup", "ask_commander_question", "escalate_to_human", "inspect_artifacts", "inspect_tests"].includes(raw)) return raw as OpenCodeResultReviewNextStep
  return "unknown"
}

function readAuthorKind(value: unknown): OpenCodeResultReviewAuthorKind {
  const raw = optional(value)
  if (!raw) return "human"
  if (["human", "commander_manual", "system", "unknown"].includes(raw)) return raw as OpenCodeResultReviewAuthorKind
  return "unknown"
}

function readConfidence(value: unknown): string | number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.min(1, value))
  const raw = optional(value)
  if (!raw) return undefined
  if (["low", "medium", "high", "unknown"].includes(raw)) return raw
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : "unknown"
}

function inputLooksRaw(input: OpenCodeResultReviewPreviewInput): boolean {
  const values = [
    input.rationale,
    input.evidence_summary,
    ...(input.accepted_claims ?? []),
    ...(input.rejected_claims ?? []),
    ...(input.revision_requests ?? []),
    ...(input.followup_requests ?? []),
    ...(input.risk_flags ?? []),
    ...(input.artifact_refs ?? []),
    ...(input.test_refs ?? []),
  ]
  return values.some((value) => typeof value === "string" && (value.length > 2000 || RAW_PATTERNS.some((pattern) => pattern.test(value))))
}

function recommendedCommands(reportId: string, sessionId: string | undefined, decision: OpenCodeResultReviewDecision, nextStep: OpenCodeResultReviewNextStep): OpenCodeResultReviewCommand[] {
  const commands: OpenCodeResultReviewCommand[] = [
    { label: "List result reviews", command: reportId ? `/opencode-result-reviews report=${reportId}` : "/opencode-result-reviews", command_type: "read", notes: "read bounded result-review metadata" },
    { label: "Latest result review", command: reportId ? `/opencode-result-review-latest report=${reportId}` : "/opencode-result-review-latest report=<report_id>", command_type: "read", notes: "read latest result-review metadata" },
  ]
  if (nextStep === "prepare_research_ingestion") commands.push({ label: "Prepare research ingestion", command: "/research-ingestion-preview review=<review_id>", command_type: "write", notes: "manual explicit command required; 9P ingests only accepted-as-evidence reviews" })
  if (nextStep === "request_revision") commands.push({ label: "Request revision", command: sessionId ? `/opencode-human-correction session=${sessionId} correction=<revision>` : "/opencode-human-correction session=<session_id> correction=<revision>", command_type: "write", requires_active_runtime: true, notes: "manual future/operator command required; result review does not prompt OpenCode" })
  if (nextStep === "request_followup") commands.push({ label: "Request follow-up", command: sessionId ? `/opencode-human-note session=${sessionId} note=<followup>` : "/opencode-human-note session=<session_id> note=<followup>", command_type: "write", notes: "manual metadata command only" })
  if (decision !== "unknown") commands.push({ label: "Record result review", command: reportId ? `/opencode-result-review report=${reportId} decision=${decision} rationale=<rationale>` : "/opencode-result-review report=<report_id> decision=<decision> rationale=<rationale>", command_type: "write", requires_active_runtime: true, notes: "manual metadata write only; no mission completion or research ingestion" })
  return commands
}

function isReviewEvent(event: unknown): event is Record<string, unknown> {
  return isRecord(event) && event.kind === OPEN_CODE_RESULT_REVIEW_EVENT_KIND && typeof event.review_id === "string" && typeof event.report_id === "string"
}

function compareSequencedDesc(a: SequencedReview, b: SequencedReview): number {
  const time = b.record.recorded_at.localeCompare(a.record.recorded_at)
  return time || b.event_index - a.event_index
}

function positiveInteger(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(Math.floor(parsed), max)) : fallback
}

function bound(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, MAX_TEXT) : undefined
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, MAX_TEXT) : undefined
}

function optionalRaw(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function optionalArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string")
  if (typeof value === "string" && value.trim()) return value.split(",").map((item) => item.trim()).filter(Boolean)
  return undefined
}

function boundArray(value: unknown): string[] {
  return (Array.isArray(value) ? value : optionalArray(value) ?? [])
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, MAX_ARRAY)
    .map((item) => item.slice(0, MAX_TEXT))
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value
  if (value === "true") return true
  if (value === "false") return false
  return undefined
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]))
  return value
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
