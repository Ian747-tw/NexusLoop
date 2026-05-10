import { createHash, randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { Database } from "bun:sqlite"
import type { SQLQueryBindings } from "bun:sqlite"
import { redactValue } from "../security/redaction"

export type TopicStatus = "open" | "active" | "paused" | "closed"
export type SourceStatus = "new" | "reviewed" | "rejected"
export type SourceType = "url" | "file" | "paper" | "note" | "artifact" | "other"
export type ArtifactKind = "artifact" | "report" | "log" | "dataset" | "snapshot" | "other"
export type ArtifactType = "artifact" | "report" | "log" | "dataset" | "snapshot" | "other"
export type ResearchResultType =
  | "probe_result"
  | "smoke_test_result"
  | "full_training_result"
  | "evaluation_result"
  | "ablation_result"
  | "finding"
  | "negative_finding"
  | "bug_diagnosis"
  | "literature_finding"
  | "implementation_change"
  | "checkpoint_selection"
  | "promotion_decision"
  | "reproduction_record"
export type ResearchResultStatus = "proposed" | "accepted" | "rejected" | "superseded"
export type ResearchResultConfidence = "low" | "medium" | "high"
export type ResearchResultCreatedBy = "commander" | "executor" | "verifier" | "human" | "system"
export type CitationSourceType = "paper" | "url" | "file" | "event" | "artifact" | "code" | "user"
export type HypothesisStatus = "active" | "paused" | "rejected" | "promoted" | "needs_more_evidence"
export type CandidateStatus = "active" | "paused" | "rejected" | "promoted" | "needs_more_evidence"
export type TrialStatus = "planned" | "running" | "completed" | "failed" | "cancelled"
export type CandidateEvidenceType = "research_result" | "citation" | "artifact" | "event"
export type ResearchEntityType =
  | "topic"
  | "source"
  | "note"
  | "artifact"
  | "research_result"
  | "citation"
  | "result_citation"
  | "result_artifact"
  | "hypothesis"
  | "candidate"
  | "trial"
  | "candidate_evidence"

const TOPIC_STATUSES = new Set<TopicStatus>(["open", "active", "paused", "closed"])
const SOURCE_STATUSES = new Set<SourceStatus>(["new", "reviewed", "rejected"])
const SOURCE_TYPES = new Set<SourceType>(["url", "file", "paper", "note", "artifact", "other"])
const ARTIFACT_KINDS = new Set<ArtifactKind>(["artifact", "report", "log", "dataset", "snapshot", "other"])
const ARTIFACT_TYPES = new Set<ArtifactType>(["artifact", "report", "log", "dataset", "snapshot", "other"])
const RESEARCH_RESULT_TYPES = new Set<ResearchResultType>([
  "probe_result",
  "smoke_test_result",
  "full_training_result",
  "evaluation_result",
  "ablation_result",
  "finding",
  "negative_finding",
  "bug_diagnosis",
  "literature_finding",
  "implementation_change",
  "checkpoint_selection",
  "promotion_decision",
  "reproduction_record",
])
const RESEARCH_RESULT_STATUSES = new Set<ResearchResultStatus>(["proposed", "accepted", "rejected", "superseded"])
const RESEARCH_RESULT_CONFIDENCES = new Set<ResearchResultConfidence>(["low", "medium", "high"])
const RESEARCH_RESULT_CREATED_BY = new Set<ResearchResultCreatedBy>(["commander", "executor", "verifier", "human", "system"])
const CITATION_SOURCE_TYPES = new Set<CitationSourceType>(["paper", "url", "file", "event", "artifact", "code", "user"])
const HYPOTHESIS_STATUSES = new Set<HypothesisStatus>(["active", "paused", "rejected", "promoted", "needs_more_evidence"])
const CANDIDATE_STATUSES = new Set<CandidateStatus>(["active", "paused", "rejected", "promoted", "needs_more_evidence"])
const TRIAL_STATUSES = new Set<TrialStatus>(["planned", "running", "completed", "failed", "cancelled"])
const CANDIDATE_EVIDENCE_TYPES = new Set<CandidateEvidenceType>(["research_result", "citation", "artifact", "event"])
const RESEARCH_ENTITY_TYPES = new Set<ResearchEntityType>([
  "topic",
  "source",
  "note",
  "artifact",
  "research_result",
  "citation",
  "result_citation",
  "result_artifact",
  "hypothesis",
  "candidate",
  "trial",
  "candidate_evidence",
])
const EVIDENCE_REQUIRED_RESULT_TYPES = new Set<ResearchResultType>([
  "finding",
  "literature_finding",
  "bug_diagnosis",
  "promotion_decision",
  "checkpoint_selection",
  "evaluation_result",
  "full_training_result",
])
const DEFAULT_READ_LIMIT = 100
const MAX_READ_LIMIT = 500

export interface ResearchDbOptions {
  dbPath?: string
  now?: () => Date
  idFactory?: () => string
}

export interface TopicInput {
  id?: string
  title: string
  status?: TopicStatus
}

export interface Topic {
  id: string
  title: string
  status: TopicStatus
  created_at: string
  updated_at: string
}

export interface SourceInput {
  id?: string
  topic_id: string
  locator: string
  title?: string
  source_type: SourceType
  status?: SourceStatus
  credibility?: string
}

export interface Source {
  id: string
  topic_id: string
  locator: string
  title: string | null
  source_type: SourceType
  status: SourceStatus
  credibility: string | null
  created_at: string
}

export interface NoteInput {
  id?: string
  topic_id: string
  source_id?: string
  content: string
  tags?: string[]
}

export interface Note {
  id: string
  topic_id: string
  source_id: string | null
  content: string
  tags: string[]
  created_at: string
}

export interface ArtifactInput {
  id?: string
  topic_id: string
  kind: ArtifactKind
  path?: string
  content?: string
  artifact_type?: ArtifactType
  sha256?: string
  size_bytes?: number
  produced_by_mission_id?: string
  produced_by_run_id?: string
  description?: string
}

export interface Artifact {
  id: string
  topic_id: string
  kind: ArtifactKind
  path: string | null
  content: string | null
  artifact_type: ArtifactType | null
  sha256: string | null
  size_bytes: number | null
  produced_by_mission_id: string | null
  produced_by_run_id: string | null
  description: string | null
  created_at: string
}

export interface ResearchResultInput {
  result_id?: string
  result_type: ResearchResultType
  label?: string
  title: string
  summary: string
  confidence: ResearchResultConfidence
  mission_id?: string
  candidate_id?: string
  hypothesis_id?: string
  trial_id?: string
  training_run_id?: string
  metrics?: unknown
  reproduction?: unknown
  created_by: ResearchResultCreatedBy
}

export interface ResearchResult {
  result_id: string
  result_type: ResearchResultType
  label: string | null
  title: string
  summary: string
  status: ResearchResultStatus
  confidence: ResearchResultConfidence
  mission_id: string | null
  candidate_id: string | null
  hypothesis_id: string | null
  trial_id: string | null
  training_run_id: string | null
  metrics: unknown | null
  reproduction: unknown | null
  created_by: ResearchResultCreatedBy
  created_at: string
  updated_at: string
}

export interface CitationInput {
  citation_id?: string
  source_type: CitationSourceType
  source_uri: string
  title?: string
  quoted_text_or_summary: string
  accessed_at?: string
  sha256?: string
  metadata?: unknown
}

export interface Citation {
  citation_id: string
  source_type: CitationSourceType
  source_uri: string
  title: string | null
  quoted_text_or_summary: string
  accessed_at: string
  sha256: string | null
  metadata: unknown | null
  created_at: string
}

export interface ResultCitationLink {
  result_id: string
  citation_id: string
  created_at: string
}

export interface ResultArtifactLink {
  result_id: string
  artifact_id: string
  created_at: string
}

export interface HypothesisInput {
  hypothesis_id?: string
  claim: string
  source: string
  status?: HypothesisStatus
}

export interface Hypothesis {
  hypothesis_id: string
  claim: string
  source: string
  status: HypothesisStatus
  input_hash: string
  created_at: string
  updated_at: string
}

export interface CandidateInput {
  candidate_id?: string
  hypothesis_id?: string
  claim: string
  source: string
  status?: CandidateStatus
}

export interface Candidate {
  candidate_id: string
  hypothesis_id: string | null
  claim: string
  source: string
  status: CandidateStatus
  commander_score: number | null
  rank_reason: string | null
  input_hash: string
  created_at: string
  updated_at: string
}

export interface CandidateEvidenceLink {
  candidate_id: string
  evidence_type: CandidateEvidenceType
  evidence_id: string
  created_at: string
}

export interface CandidateRankingInput {
  candidate_id: string
  commander_score: number
  rank_reason: string
}

export interface TrialInput {
  trial_id?: string
  hypothesis_id?: string
  candidate_id?: string
  trial_kind: string
  config: unknown
}

export interface Trial {
  trial_id: string
  hypothesis_id: string | null
  candidate_id: string | null
  trial_kind: string
  status: TrialStatus
  config: unknown
  input_hash: string
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface SearchResearchResultsOptions extends SearchOptions {
  result_type?: ResearchResultType
  status?: ResearchResultStatus
  mission_id?: string
}

export interface SearchCitationsOptions extends SearchOptions {
  source_type?: CitationSourceType
}

export interface SearchHypothesesOptions extends SearchOptions {
  status?: HypothesisStatus
}

export interface SearchCandidatesOptions extends SearchOptions {
  status?: CandidateStatus
  hypothesis_id?: string
}

export interface SearchTrialsOptions extends SearchOptions {
  status?: TrialStatus
  candidate_id?: string
  hypothesis_id?: string
}

export interface WriteBarrierResult {
  ok: boolean
  reason?: string
}

export interface ListResearchEventsOptions {
  entity_type?: ResearchEntityType
  entity_id?: string
  event_type?: string
  after_event_id?: string
  limit?: number
}

export interface ResearchEvent {
  event_id: string
  event_type: string
  entity_type: ResearchEntityType
  entity_id: string
  payload: unknown
  created_at: string
}

export interface TopicSnapshotStats {
  source_count: number
  note_count: number
  artifact_count: number
  report_count: number
  reviewed_source_count: number
  rejected_source_count: number
}

export interface TopicSnapshot {
  topic: Topic
  sources: Source[]
  notes: Note[]
  artifacts: Artifact[]
  stats: TopicSnapshotStats
  latest_event: ResearchEvent | null
}

export interface SearchOptions {
  limit?: number
}

interface NoteRow extends Omit<Note, "tags"> {
  tags_json: string | null
  input_hash?: string | null
}

interface TopicRow extends Topic {
  input_hash: string | null
}

interface SourceRow extends Source {
  input_hash: string | null
}

interface ArtifactRow extends Artifact {
  input_hash: string | null
}

interface ResearchResultRow extends Omit<ResearchResult, "metrics" | "reproduction"> {
  metrics_json: string | null
  reproduction_json: string | null
  input_hash: string | null
}

interface CitationRow extends Omit<Citation, "metadata"> {
  metadata_json: string | null
  input_hash: string | null
}

interface HypothesisRow extends Hypothesis {
  input_hash: string
}

interface CandidateRow extends Candidate {
  input_hash: string
}

interface TrialRow extends Omit<Trial, "config"> {
  config_json: string
  input_hash: string
}

interface ResearchEventRow {
  event_order: number
  event_id: string
  event_type: string
  entity_type: string
  entity_id: string
  payload_json: string
  created_at: string
}

export class ResearchDb {
  private readonly db: Database
  private readonly now: () => Date
  private readonly idFactory: () => string

  private constructor(db: Database, options: Required<Pick<ResearchDbOptions, "now" | "idFactory">>) {
    this.db = db
    this.now = options.now
    this.idFactory = options.idFactory
  }

  static open(projectDir: string, options: ResearchDbOptions = {}): ResearchDb {
    const dbPath = options.dbPath ?? join(projectDir, ".nxl", "research.db")
    mkdirSync(dirname(dbPath), { recursive: true })
    const db = new Database(dbPath, { create: true })
    db.exec("PRAGMA foreign_keys = ON")
    const researchDb = new ResearchDb(db, {
      now: options.now ?? (() => new Date()),
      idFactory: options.idFactory ?? (() => randomUUID()),
    })
    try {
      researchDb.migrate()
      return researchDb
    } catch (error) {
      db.close()
      throw error
    }
  }

  close(): void {
    this.db.close()
  }

  createTopic(input: TopicInput): Topic {
    const id = cleanId(input.id ?? this.idFactory())
    const title = cleanRequired(input.title, "title")
    const status = input.status ?? "open"
    assertAllowed(TOPIC_STATUSES, status, "topic status")
    const inputHash = hashPayload({ title, status })
    const redactedTitle = redactString(title)
    const createdAt = this.timestamp()
    return this.inTransaction(() => {
      const existing = this.db.query("SELECT * FROM topics WHERE id = ?").get(id) as TopicRow | null
      if (existing) {
        if (existing.input_hash === inputHash) return this.getTopic(id) as Topic
        throw new Error(`topic id collision: ${id}`)
      }
      this.db
        .query("INSERT INTO topics (id, title, status, input_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, redactedTitle, status, inputHash, createdAt, createdAt)
      const topic = this.getTopic(id)
      if (!topic) throw new Error(`failed to create topic: ${id}`)
      this.recordEvent("topic_created", "topic", id, topic)
      return topic
    })
  }

  getTopic(id: string): Topic | null {
    return this.db
      .query("SELECT id, title, status, created_at, updated_at FROM topics WHERE id = ?")
      .get(cleanId(id)) as Topic | null
  }

  listTopics(): Topic[] {
    return this.db.query("SELECT id, title, status, created_at, updated_at FROM topics ORDER BY created_at, id").all() as Topic[]
  }

  searchTopics(query: string, options: SearchOptions = {}): Topic[] {
    const term = cleanRequired(query, "query")
    const limit = cleanLimit(options.limit)
    return this.db
      .query("SELECT id, title, status, created_at, updated_at FROM topics WHERE title LIKE ? ESCAPE '\\' ORDER BY created_at, id LIMIT ?")
      .all(likeContains(term), limit) as Topic[]
  }

  addSource(input: SourceInput): Source {
    const topicId = cleanId(input.topic_id)
    this.requireTopic(topicId)
    const id = cleanId(input.id ?? this.idFactory())
    const locator = cleanRequired(input.locator, "locator")
    assertAllowed(SOURCE_TYPES, input.source_type, "source type")
    const status = input.status ?? "new"
    assertAllowed(SOURCE_STATUSES, status, "source status")
    const title = cleanOptional(input.title)
    const credibility = cleanOptional(input.credibility)
    const inputHash = hashPayload({
      topic_id: topicId,
      locator,
      title,
      source_type: input.source_type,
      status,
      credibility,
    })
    const redactedLocator = redactString(locator)
    const redactedTitle = title ? redactString(title) : null
    const redactedCredibility = credibility ? redactString(credibility) : null
    const createdAt = this.timestamp()
    return this.inTransaction(() => {
      const existing = this.db.query("SELECT * FROM sources WHERE id = ?").get(id) as SourceRow | null
      if (existing) {
        if (existing.input_hash === inputHash) return this.getSource(id) as Source
        throw new Error(`source id collision: ${id}`)
      }
      this.db
        .query(
          "INSERT INTO sources (id, topic_id, locator, title, source_type, status, credibility, input_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          topicId,
          redactedLocator,
          redactedTitle,
          input.source_type,
          status,
          redactedCredibility,
          inputHash,
          createdAt,
        )
      const source = this.getSource(id)
      if (!source) throw new Error(`failed to add source: ${id}`)
      this.recordEvent("source_added", "source", id, source)
      return source
    })
  }

  listSourcesForTopic(topicId: string): Source[] {
    const id = cleanId(topicId)
    this.requireTopic(id)
    return this.db
      .query("SELECT id, topic_id, locator, title, source_type, status, credibility, created_at FROM sources WHERE topic_id = ? ORDER BY created_at, id")
      .all(id) as Source[]
  }

  addNote(input: NoteInput): Note {
    const topicId = cleanId(input.topic_id)
    this.requireTopic(topicId)
    const sourceId = input.source_id ? cleanId(input.source_id) : null
    if (sourceId) this.requireSource(sourceId, topicId)
    const id = cleanId(input.id ?? this.idFactory())
    const content = cleanRequired(input.content, "content")
    const tags = cleanTags(input.tags)
    const inputHash = hashPayload({ topic_id: topicId, source_id: sourceId, content, tags })
    const redactedContent = redactString(content)
    const redactedTags = JSON.stringify(redactValue(tags))
    const createdAt = this.timestamp()
    return this.inTransaction(() => {
      const existingRow = this.db.query("SELECT * FROM notes WHERE id = ?").get(id) as NoteRow | null
      const existing = this.noteFromRow(existingRow)
      if (existing) {
        if (existingRow?.input_hash === inputHash) return existing
        throw new Error(`note id collision: ${id}`)
      }
      this.db
        .query("INSERT INTO notes (id, topic_id, source_id, content, tags_json, input_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(id, topicId, sourceId, redactedContent, redactedTags, inputHash, createdAt)
      const row = this.db.query("SELECT * FROM notes WHERE id = ?").get(id) as NoteRow | null
      if (!row) throw new Error(`failed to add note: ${id}`)
      const note = this.noteFromRow(row)
      this.recordEvent("note_added", "note", id, note)
      return note
    })
  }

  listNotesForTopic(topicId: string): Note[] {
    const id = cleanId(topicId)
    this.requireTopic(id)
    return (this.db.query("SELECT * FROM notes WHERE topic_id = ? ORDER BY created_at, id").all(id) as NoteRow[]).map((row) =>
      this.noteFromRow(row),
    )
  }

  addArtifact(input: ArtifactInput): Artifact {
    const topicId = cleanId(input.topic_id)
    this.requireTopic(topicId)
    const id = cleanId(input.id ?? this.idFactory())
    assertAllowed(ARTIFACT_KINDS, input.kind, "artifact kind")
    const path = cleanOptional(input.path)
    const content = cleanOptional(input.content)
    if (!path && !content) throw new Error("artifact requires path or content")
    const artifactType = cleanOptionalEnum(input.artifact_type, ARTIFACT_TYPES, "artifact type")
    const sha256 = cleanOptional(input.sha256)
    const sizeBytes = cleanOptionalSize(input.size_bytes)
    const producedByMissionId = input.produced_by_mission_id ? cleanId(input.produced_by_mission_id) : null
    const producedByRunId = input.produced_by_run_id ? cleanId(input.produced_by_run_id) : null
    const description = cleanOptional(input.description)
    const inputHash = hashPayload(artifactInputHashPayload({
      topic_id: topicId,
      kind: input.kind,
      path,
      content,
      artifact_type: artifactType,
      sha256,
      size_bytes: sizeBytes,
      produced_by_mission_id: producedByMissionId,
      produced_by_run_id: producedByRunId,
      description,
    }))
    const redactedPath = path ? redactString(path) : null
    const redactedContent = content ? redactString(content) : null
    const redactedDescription = description ? redactString(description) : null
    const createdAt = this.timestamp()
    return this.inTransaction(() => {
      const existing = this.db.query("SELECT * FROM artifacts WHERE id = ?").get(id) as ArtifactRow | null
      if (existing) {
        if (existing.input_hash === inputHash) return this.getArtifact(id) as Artifact
        throw new Error(`artifact id collision: ${id}`)
      }
      this.db
        .query(
          "INSERT INTO artifacts (id, topic_id, kind, path, content, artifact_type, sha256, size_bytes, produced_by_mission_id, produced_by_run_id, description, input_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          topicId,
          input.kind,
          redactedPath,
          redactedContent,
          artifactType,
          sha256,
          sizeBytes,
          producedByMissionId,
          producedByRunId,
          redactedDescription,
          inputHash,
          createdAt,
      )
      const artifact = this.getArtifact(id)
      if (!artifact) throw new Error(`failed to add artifact: ${id}`)
      this.recordEvent("artifact_added", "artifact", id, artifact)
      return artifact
    })
  }

  listArtifactsForTopic(topicId: string): Artifact[] {
    const id = cleanId(topicId)
    this.requireTopic(id)
    return this.db
      .query(
        "SELECT id, topic_id, kind, path, content, artifact_type, sha256, size_bytes, produced_by_mission_id, produced_by_run_id, description, created_at FROM artifacts WHERE topic_id = ? ORDER BY created_at, id",
      )
      .all(id) as Artifact[]
  }

  proposeResearchResult(input: ResearchResultInput): ResearchResult {
    const resultId = cleanId(input.result_id ?? this.idFactory())
    assertAllowed(RESEARCH_RESULT_TYPES, input.result_type, "research result type")
    const label = cleanOptional(input.label)
    const title = cleanRequired(input.title, "title")
    const summary = cleanRequired(input.summary, "summary")
    assertAllowed(RESEARCH_RESULT_CONFIDENCES, input.confidence, "research result confidence")
    assertAllowed(RESEARCH_RESULT_CREATED_BY, input.created_by, "research result created_by")
    const missionId = input.mission_id ? cleanId(input.mission_id) : null
    const candidateId = input.candidate_id ? cleanId(input.candidate_id) : null
    const hypothesisId = input.hypothesis_id ? cleanId(input.hypothesis_id) : null
    const trialId = input.trial_id ? cleanId(input.trial_id) : null
    const trainingRunId = input.training_run_id ? cleanId(input.training_run_id) : null
    const metrics = input.metrics ?? null
    const reproduction = input.reproduction ?? null
    const inputHash = hashPayload({
      result_type: input.result_type,
      label,
      title,
      summary,
      status: "proposed",
      confidence: input.confidence,
      mission_id: missionId,
      candidate_id: candidateId,
      hypothesis_id: hypothesisId,
      trial_id: trialId,
      training_run_id: trainingRunId,
      metrics,
      reproduction,
      created_by: input.created_by,
    })
    const redactedMetrics = redactValue(metrics)
    const redactedReproduction = redactValue(reproduction)
    const createdAt = this.timestamp()
    return this.inTransaction(() => {
      const existing = this.db.query("SELECT * FROM research_results WHERE result_id = ?").get(resultId) as ResearchResultRow | null
      if (existing) {
        if (existing.input_hash === inputHash) return this.researchResultFromRow(existing)
        throw new Error(`research result id collision: ${resultId}`)
      }
      this.db
        .query(
          "INSERT INTO research_results (result_id, result_type, label, title, summary, status, confidence, mission_id, candidate_id, hypothesis_id, trial_id, training_run_id, metrics_json, reproduction_json, created_by, input_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          resultId,
          input.result_type,
          label ? redactString(label) : null,
          redactString(title),
          redactString(summary),
          "proposed",
          input.confidence,
          missionId,
          candidateId,
          hypothesisId,
          trialId,
          trainingRunId,
          JSON.stringify(redactedMetrics),
          JSON.stringify(redactedReproduction),
          input.created_by,
          inputHash,
          createdAt,
          createdAt,
        )
      const result = this.getResearchResult(resultId)
      if (!result) throw new Error(`failed to propose research result: ${resultId}`)
      this.recordEvent("ResearchResultProposed", "research_result", resultId, result)
      return result
    })
  }

  acceptResearchResult(resultId: string): ResearchResult {
    const id = cleanId(resultId)
    const existing = this.getResearchResult(id)
    if (!existing) throw new Error(`research result not found: ${id}`)
    if (existing.status === "accepted") return existing
    this.assertResearchResultHasEvidence(id)
    const updatedAt = this.timestamp()
    return this.inTransaction(() => {
      this.db.query("UPDATE research_results SET status = ?, updated_at = ? WHERE result_id = ?").run("accepted", updatedAt, id)
      const result = this.getResearchResult(id)
      if (!result) throw new Error(`research result not found: ${id}`)
      this.recordEvent("ResearchResultAccepted", "research_result", id, result)
      return result
    })
  }

  rejectResearchResult(resultId: string, reason?: string): ResearchResult {
    const id = cleanId(resultId)
    if (!this.getResearchResult(id)) throw new Error(`research result not found: ${id}`)
    const cleanReason = cleanOptional(reason)
    const updatedAt = this.timestamp()
    return this.inTransaction(() => {
      this.db.query("UPDATE research_results SET status = ?, updated_at = ? WHERE result_id = ?").run("rejected", updatedAt, id)
      const result = this.getResearchResult(id)
      if (!result) throw new Error(`research result not found: ${id}`)
      this.recordEvent("ResearchResultRejected", "research_result", id, { result, reason: cleanReason ? redactString(cleanReason) : null })
      return result
    })
  }

  getResearchResult(resultId: string): ResearchResult | null {
    const row = this.db.query("SELECT * FROM research_results WHERE result_id = ?").get(cleanId(resultId)) as ResearchResultRow | null
    return this.researchResultFromRow(row)
  }

  searchResearchResults(options: SearchResearchResultsOptions = {}): ResearchResult[] {
    const filters: string[] = []
    const params: SQLQueryBindings[] = []
    if (options.result_type !== undefined) {
      assertAllowed(RESEARCH_RESULT_TYPES, options.result_type, "research result type")
      filters.push("result_type = ?")
      params.push(options.result_type)
    }
    if (options.status !== undefined) {
      assertAllowed(RESEARCH_RESULT_STATUSES, options.status, "research result status")
      filters.push("status = ?")
      params.push(options.status)
    }
    if (options.mission_id !== undefined) {
      filters.push("mission_id = ?")
      params.push(cleanId(options.mission_id))
    }
    params.push(cleanLimit(options.limit))
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : ""
    return (this.db.query(`SELECT * FROM research_results ${where} ORDER BY created_at, result_id LIMIT ?`).all(...params) as ResearchResultRow[]).map((row) =>
      this.researchResultFromRow(row),
    )
  }

  recordCitation(input: CitationInput): Citation {
    const citationId = cleanId(input.citation_id ?? this.idFactory())
    assertAllowed(CITATION_SOURCE_TYPES, input.source_type, "citation source type")
    const sourceUri = cleanRequired(input.source_uri, "source_uri")
    const title = cleanOptional(input.title)
    const quoted = cleanRequired(input.quoted_text_or_summary, "quoted_text_or_summary")
    const callerAccessedAt = cleanOptional(input.accessed_at)
    const accessedAt = callerAccessedAt ?? this.timestamp()
    const sha256 = cleanOptional(input.sha256)
    const metadata = input.metadata ?? null
    const inputHash = hashPayload({
      source_type: input.source_type,
      source_uri: sourceUri,
      title,
      quoted_text_or_summary: quoted,
      accessed_at: callerAccessedAt,
      sha256,
      metadata,
    })
    const createdAt = this.timestamp()
    return this.inTransaction(() => {
      const existing = this.db.query("SELECT * FROM citations WHERE citation_id = ?").get(citationId) as CitationRow | null
      if (existing) {
        if (existing.input_hash === inputHash) return this.citationFromRow(existing)
        const generatedAccessedAtHash = hashPayload({
          source_type: input.source_type,
          source_uri: sourceUri,
          title,
          quoted_text_or_summary: quoted,
          accessed_at: null,
          sha256,
          metadata,
        })
        if (callerAccessedAt === existing.accessed_at && existing.input_hash === generatedAccessedAtHash) return this.citationFromRow(existing)
        throw new Error(`citation id collision: ${citationId}`)
      }
      this.db
        .query(
          "INSERT INTO citations (citation_id, source_type, source_uri, title, quoted_text_or_summary, accessed_at, sha256, metadata_json, input_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          citationId,
          input.source_type,
          redactString(sourceUri),
          title ? redactString(title) : null,
          redactString(quoted),
          accessedAt,
          sha256,
          JSON.stringify(redactValue(metadata)),
          inputHash,
          createdAt,
        )
      const citation = this.getCitation(citationId)
      if (!citation) throw new Error(`failed to record citation: ${citationId}`)
      this.recordEvent("CitationRecorded", "citation", citationId, citation)
      return citation
    })
  }

  getCitation(citationId: string): Citation | null {
    const row = this.db.query("SELECT * FROM citations WHERE citation_id = ?").get(cleanId(citationId)) as CitationRow | null
    return this.citationFromRow(row)
  }

  searchCitations(options: SearchCitationsOptions = {}): Citation[] {
    const filters: string[] = []
    const params: SQLQueryBindings[] = []
    if (options.source_type !== undefined) {
      assertAllowed(CITATION_SOURCE_TYPES, options.source_type, "citation source type")
      filters.push("source_type = ?")
      params.push(options.source_type)
    }
    params.push(cleanLimit(options.limit))
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : ""
    return (this.db.query(`SELECT * FROM citations ${where} ORDER BY created_at, citation_id LIMIT ?`).all(...params) as CitationRow[]).map((row) =>
      this.citationFromRow(row),
    )
  }

  linkResultCitation(resultId: string, citationId: string): ResultCitationLink {
    const cleanResultId = cleanId(resultId)
    const cleanCitationId = cleanId(citationId)
    this.requireResearchResult(cleanResultId)
    this.requireCitation(cleanCitationId)
    const createdAt = this.timestamp()
    return this.inTransaction(() => {
      const existing = this.db
        .query("SELECT result_id, citation_id, created_at FROM result_citations WHERE result_id = ? AND citation_id = ?")
        .get(cleanResultId, cleanCitationId) as ResultCitationLink | null
      if (existing) return existing
      this.db.query("INSERT INTO result_citations (result_id, citation_id, created_at) VALUES (?, ?, ?)").run(cleanResultId, cleanCitationId, createdAt)
      const link = { result_id: cleanResultId, citation_id: cleanCitationId, created_at: createdAt }
      const eventId = this.recordEvent("ResultCitationLinked", "result_citation", `${cleanResultId}:${cleanCitationId}`, link)
      this.db.query("UPDATE result_citations SET link_event_id = ? WHERE result_id = ? AND citation_id = ?").run(eventId, cleanResultId, cleanCitationId)
      return link
    })
  }

  linkResultArtifact(resultId: string, artifactId: string): ResultArtifactLink {
    const cleanResultId = cleanId(resultId)
    const cleanArtifactId = cleanId(artifactId)
    this.requireResearchResult(cleanResultId)
    this.requireArtifact(cleanArtifactId)
    const createdAt = this.timestamp()
    return this.inTransaction(() => {
      const existing = this.db
        .query("SELECT result_id, artifact_id, created_at FROM result_artifacts WHERE result_id = ? AND artifact_id = ?")
        .get(cleanResultId, cleanArtifactId) as ResultArtifactLink | null
      if (existing) return existing
      this.db.query("INSERT INTO result_artifacts (result_id, artifact_id, created_at) VALUES (?, ?, ?)").run(cleanResultId, cleanArtifactId, createdAt)
      const link = { result_id: cleanResultId, artifact_id: cleanArtifactId, created_at: createdAt }
      const eventId = this.recordEvent("ResultArtifactLinked", "result_artifact", `${cleanResultId}:${cleanArtifactId}`, link)
      this.db.query("UPDATE result_artifacts SET link_event_id = ? WHERE result_id = ? AND artifact_id = ?").run(eventId, cleanResultId, cleanArtifactId)
      return link
    })
  }

  listResultCitations(resultId: string): Citation[] {
    const id = cleanId(resultId)
    this.requireResearchResult(id)
    return (this.db
      .query(
        "SELECT c.* FROM citations c INNER JOIN result_citations rc ON rc.citation_id = c.citation_id WHERE rc.result_id = ? ORDER BY rc.created_at, c.citation_id",
      )
      .all(id) as CitationRow[]).map((row) => this.citationFromRow(row))
  }

  listResultArtifacts(resultId: string): Artifact[] {
    const id = cleanId(resultId)
    this.requireResearchResult(id)
    return this.db
      .query(
        "SELECT a.id, a.topic_id, a.kind, a.path, a.content, a.artifact_type, a.sha256, a.size_bytes, a.produced_by_mission_id, a.produced_by_run_id, a.description, a.created_at FROM artifacts a INNER JOIN result_artifacts ra ON ra.artifact_id = a.id WHERE ra.result_id = ? ORDER BY ra.created_at, a.id",
      )
      .all(id) as Artifact[]
  }

  createHypothesis(input: HypothesisInput): Hypothesis {
    const hypothesisId = cleanId(input.hypothesis_id ?? this.idFactory())
    const claim = cleanRequired(input.claim, "claim")
    const source = cleanRequired(input.source, "source")
    const status = input.status ?? "active"
    assertAllowed(HYPOTHESIS_STATUSES, status, "hypothesis status")
    const inputHash = hashPayload({ claim, source, status })
    const createdAt = this.timestamp()
    return this.inTransaction(() => {
      const existing = this.db.query("SELECT * FROM hypotheses WHERE hypothesis_id = ?").get(hypothesisId) as HypothesisRow | null
      if (existing) {
        if (existing.input_hash === inputHash) return this.hypothesisFromRow(existing)
        throw new Error(`hypothesis id collision: ${hypothesisId}`)
      }
      this.db
        .query("INSERT INTO hypotheses (hypothesis_id, claim, source, status, input_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(hypothesisId, redactString(claim), redactString(source), status, inputHash, createdAt, createdAt)
      const hypothesis = this.getHypothesis(hypothesisId)
      if (!hypothesis) throw new Error(`failed to create hypothesis: ${hypothesisId}`)
      this.recordEvent("HypothesisCreated", "hypothesis", hypothesisId, hypothesis)
      return hypothesis
    })
  }

  getHypothesis(hypothesisId: string): Hypothesis | null {
    const row = this.db.query("SELECT * FROM hypotheses WHERE hypothesis_id = ?").get(cleanId(hypothesisId)) as HypothesisRow | null
    return this.hypothesisFromRow(row)
  }

  searchHypotheses(options: SearchHypothesesOptions = {}): Hypothesis[] {
    const filters: string[] = []
    const params: SQLQueryBindings[] = []
    if (options.status !== undefined) {
      assertAllowed(HYPOTHESIS_STATUSES, options.status, "hypothesis status")
      filters.push("status = ?")
      params.push(options.status)
    }
    params.push(cleanLimit(options.limit))
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : ""
    return (this.db.query(`SELECT * FROM hypotheses ${where} ORDER BY created_at, hypothesis_id LIMIT ?`).all(...params) as HypothesisRow[]).map((row) =>
      this.hypothesisFromRow(row),
    )
  }

  updateHypothesisStatus(hypothesisId: string, status: HypothesisStatus): Hypothesis {
    const id = cleanId(hypothesisId)
    assertAllowed(HYPOTHESIS_STATUSES, status, "hypothesis status")
    this.requireHypothesis(id)
    const updatedAt = this.timestamp()
    return this.inTransaction(() => {
      this.db.query("UPDATE hypotheses SET status = ?, updated_at = ? WHERE hypothesis_id = ?").run(status, updatedAt, id)
      const hypothesis = this.getHypothesis(id)
      if (!hypothesis) throw new Error(`hypothesis not found: ${id}`)
      this.recordEvent("HypothesisStatusUpdated", "hypothesis", id, hypothesis)
      return hypothesis
    })
  }

  createCandidate(input: CandidateInput): Candidate {
    const candidateId = cleanId(input.candidate_id ?? this.idFactory())
    const hypothesisId = input.hypothesis_id ? cleanId(input.hypothesis_id) : null
    if (hypothesisId) this.requireHypothesis(hypothesisId)
    const claim = cleanRequired(input.claim, "claim")
    const source = cleanRequired(input.source, "source")
    const status = input.status ?? "active"
    assertAllowed(CANDIDATE_STATUSES, status, "candidate status")
    if (status === "promoted") throw new Error("candidate cannot be created as promoted")
    const inputHash = hashPayload({ hypothesis_id: hypothesisId, claim, source, status })
    const createdAt = this.timestamp()
    return this.inTransaction(() => {
      const existing = this.db.query("SELECT * FROM candidates WHERE candidate_id = ?").get(candidateId) as CandidateRow | null
      if (existing) {
        if (existing.input_hash === inputHash) return this.candidateFromRow(existing)
        throw new Error(`candidate id collision: ${candidateId}`)
      }
      this.db
        .query(
          "INSERT INTO candidates (candidate_id, hypothesis_id, claim, source, status, commander_score, rank_reason, input_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(candidateId, hypothesisId, redactString(claim), redactString(source), status, null, null, inputHash, createdAt, createdAt)
      const candidate = this.getCandidate(candidateId)
      if (!candidate) throw new Error(`failed to create candidate: ${candidateId}`)
      this.recordEvent("CandidateCreated", "candidate", candidateId, candidate)
      return candidate
    })
  }

  getCandidate(candidateId: string): Candidate | null {
    const row = this.db.query("SELECT * FROM candidates WHERE candidate_id = ?").get(cleanId(candidateId)) as CandidateRow | null
    return this.candidateFromRow(row)
  }

  searchCandidates(options: SearchCandidatesOptions = {}): Candidate[] {
    const filters: string[] = []
    const params: SQLQueryBindings[] = []
    if (options.status !== undefined) {
      assertAllowed(CANDIDATE_STATUSES, options.status, "candidate status")
      filters.push("status = ?")
      params.push(options.status)
    }
    if (options.hypothesis_id !== undefined) {
      filters.push("hypothesis_id = ?")
      params.push(cleanId(options.hypothesis_id))
    }
    params.push(cleanLimit(options.limit))
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : ""
    return (this.db.query(`SELECT * FROM candidates ${where} ORDER BY created_at, candidate_id LIMIT ?`).all(...params) as CandidateRow[]).map((row) =>
      this.candidateFromRow(row),
    )
  }

  rankCandidate(input: CandidateRankingInput): Candidate {
    const candidateId = cleanId(input.candidate_id)
    if (!Number.isFinite(input.commander_score)) throw new Error("commander_score must be a finite number")
    const rankReason = cleanRequired(input.rank_reason, "rank_reason")
    this.requireCandidate(candidateId)
    const updatedAt = this.timestamp()
    return this.inTransaction(() => {
      this.db
        .query("UPDATE candidates SET commander_score = ?, rank_reason = ?, updated_at = ? WHERE candidate_id = ?")
        .run(input.commander_score, redactString(rankReason), updatedAt, candidateId)
      const candidate = this.getCandidate(candidateId)
      if (!candidate) throw new Error(`candidate not found: ${candidateId}`)
      this.recordEvent("CandidateRanked", "candidate", candidateId, candidate)
      return candidate
    })
  }

  selectCandidate(candidateId: string): Candidate {
    return this.updateCandidateStatus(candidateId, "active", "CandidateSelected")
  }

  rejectCandidate(candidateId: string, reason?: string): Candidate {
    return this.updateCandidateStatus(candidateId, "rejected", "CandidateRejected", reason)
  }

  markCandidateNeedsMoreEvidence(candidateId: string, reason?: string): Candidate {
    return this.updateCandidateStatus(candidateId, "needs_more_evidence", "CandidateNeedsMoreEvidence", reason)
  }

  proposeCandidatePromotion(candidateId: string, evidenceIds?: string[]): Candidate | WriteBarrierResult {
    const id = cleanId(candidateId)
    this.requireCandidate(id)
    if (evidenceIds !== undefined) {
      for (const evidenceId of evidenceIds) {
        const cleanEvidenceId = cleanId(evidenceId)
        if (!this.listCandidateEvidence(id).some((link) => link.evidence_id === cleanEvidenceId)) {
          throw new Error(`candidate evidence not linked: ${cleanEvidenceId}`)
        }
      }
    }
    const verdict = this.canPromoteCandidate(id)
    if (!verdict.ok) return verdict
    const candidate = this.getCandidate(id)
    if (!candidate) throw new Error(`candidate not found: ${id}`)
    return this.inTransaction(() => {
      this.recordEvent("CandidatePromotionProposed", "candidate", id, { candidate, evidence_ids: evidenceIds?.map(cleanId) ?? [] })
      return candidate
    })
  }

  promoteCandidate(candidateId: string): Candidate {
    const id = cleanId(candidateId)
    const candidate = this.getCandidate(id)
    if (!candidate) throw new Error(`candidate not found: ${id}`)
    if (candidate.status === "rejected") throw new Error(`candidate already rejected: ${id}`)
    if (candidate.status === "promoted") return candidate
    this.assertCandidateHasPromotionEvidence(id)
    return this.updateCandidateStatus(id, "promoted", "CandidatePromoted")
  }

  linkCandidateEvidence(candidateId: string, evidenceType: CandidateEvidenceType, evidenceId: string): CandidateEvidenceLink {
    const cleanCandidateId = cleanId(candidateId)
    assertAllowed(CANDIDATE_EVIDENCE_TYPES, evidenceType, "candidate evidence type")
    const cleanEvidenceId = cleanId(evidenceId)
    this.requireCandidate(cleanCandidateId)
    const existing = this.db
      .query("SELECT candidate_id, evidence_type, evidence_id, created_at FROM candidate_evidence WHERE candidate_id = ? AND evidence_type = ? AND evidence_id = ?")
      .get(cleanCandidateId, evidenceType, cleanEvidenceId) as CandidateEvidenceLink | null
    if (existing) return existing
    this.requireCandidateEvidence(evidenceType, cleanEvidenceId)
    const createdAt = this.timestamp()
    return this.inTransaction(() => {
      this.db
        .query("INSERT INTO candidate_evidence (candidate_id, evidence_type, evidence_id, created_at) VALUES (?, ?, ?, ?)")
        .run(cleanCandidateId, evidenceType, cleanEvidenceId, createdAt)
      const link = { candidate_id: cleanCandidateId, evidence_type: evidenceType, evidence_id: cleanEvidenceId, created_at: createdAt }
      this.recordEvent("CandidateEvidenceLinked", "candidate_evidence", `${cleanCandidateId}:${evidenceType}:${cleanEvidenceId}`, link)
      return link
    })
  }

  listCandidateEvidence(candidateId: string): CandidateEvidenceLink[] {
    const id = cleanId(candidateId)
    this.requireCandidate(id)
    return this.db
      .query(
        "SELECT candidate_id, evidence_type, evidence_id, created_at FROM candidate_evidence WHERE candidate_id = ? ORDER BY created_at, evidence_type, evidence_id",
      )
      .all(id) as CandidateEvidenceLink[]
  }

  canPromoteCandidate(candidateId: string): WriteBarrierResult {
    const id = cleanId(candidateId)
    const candidate = this.getCandidate(id)
    if (!candidate) return { ok: false, reason: `candidate not found: ${id}` }
    if (candidate.status === "rejected") return { ok: false, reason: `candidate already rejected: ${id}` }
    const evidence = this.listCandidateEvidence(id)
    if (!evidence.some((link) => this.isValidCandidateEvidence(link))) return { ok: false, reason: `candidate has no promotion evidence: ${id}` }
    return { ok: true }
  }

  assertCandidateHasPromotionEvidence(candidateId: string): void {
    const verdict = this.canPromoteCandidate(candidateId)
    if (!verdict.ok) throw new Error(verdict.reason)
  }

  planTrial(input: TrialInput): Trial {
    const trialId = cleanId(input.trial_id ?? this.idFactory())
    const hypothesisId = input.hypothesis_id ? cleanId(input.hypothesis_id) : null
    const candidateId = input.candidate_id ? cleanId(input.candidate_id) : null
    if (hypothesisId) this.requireHypothesis(hypothesisId)
    const candidate = candidateId ? this.getCandidate(candidateId) : null
    if (candidateId && !candidate) throw new Error(`candidate not found: ${candidateId}`)
    if (hypothesisId && candidate && candidate.hypothesis_id !== hypothesisId) {
      throw new Error(`candidate hypothesis mismatch: ${candidateId}`)
    }
    const trialKind = cleanRequired(input.trial_kind, "trial_kind")
    const config = input.config ?? null
    const inputHash = hashPayload({ hypothesis_id: hypothesisId, candidate_id: candidateId, trial_kind: trialKind, status: "planned", config })
    const createdAt = this.timestamp()
    return this.inTransaction(() => {
      const existing = this.db.query("SELECT * FROM trials WHERE trial_id = ?").get(trialId) as TrialRow | null
      if (existing) {
        if (existing.input_hash === inputHash) return this.trialFromRow(existing)
        throw new Error(`trial id collision: ${trialId}`)
      }
      this.db
        .query(
          "INSERT INTO trials (trial_id, hypothesis_id, candidate_id, trial_kind, status, config_json, input_hash, started_at, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(trialId, hypothesisId, candidateId, redactString(trialKind), "planned", JSON.stringify(redactValue(config)), inputHash, null, null, createdAt, createdAt)
      const trial = this.getTrial(trialId)
      if (!trial) throw new Error(`failed to plan trial: ${trialId}`)
      this.recordEvent("TrialPlanned", "trial", trialId, trial)
      return trial
    })
  }

  getTrial(trialId: string): Trial | null {
    const row = this.db.query("SELECT * FROM trials WHERE trial_id = ?").get(cleanId(trialId)) as TrialRow | null
    return this.trialFromRow(row)
  }

  searchTrials(options: SearchTrialsOptions = {}): Trial[] {
    const filters: string[] = []
    const params: SQLQueryBindings[] = []
    if (options.status !== undefined) {
      assertAllowed(TRIAL_STATUSES, options.status, "trial status")
      filters.push("status = ?")
      params.push(options.status)
    }
    if (options.candidate_id !== undefined) {
      filters.push("candidate_id = ?")
      params.push(cleanId(options.candidate_id))
    }
    if (options.hypothesis_id !== undefined) {
      filters.push("hypothesis_id = ?")
      params.push(cleanId(options.hypothesis_id))
    }
    params.push(cleanLimit(options.limit))
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : ""
    return (this.db.query(`SELECT * FROM trials ${where} ORDER BY created_at, trial_id LIMIT ?`).all(...params) as TrialRow[]).map((row) =>
      this.trialFromRow(row),
    )
  }

  startTrial(trialId: string): Trial {
    const id = cleanId(trialId)
    const existing = this.getTrial(id)
    if (!existing) throw new Error(`trial not found: ${id}`)
    if (existing.status === "running") return existing
    if (existing.status !== "planned") throw new Error(`trial cannot be started from status: ${existing.status}`)
    const timestamp = this.timestamp()
    return this.inTransaction(() => {
      this.db.query("UPDATE trials SET status = ?, started_at = COALESCE(started_at, ?), updated_at = ? WHERE trial_id = ?").run("running", timestamp, timestamp, id)
      const trial = this.getTrial(id)
      if (!trial) throw new Error(`trial not found: ${id}`)
      this.recordEvent("TrialStarted", "trial", id, trial)
      return trial
    })
  }

  completeTrial(trialId: string): Trial {
    const id = cleanId(trialId)
    const existing = this.getTrial(id)
    if (!existing) throw new Error(`trial not found: ${id}`)
    if (existing.status !== "running" && existing.status !== "planned") throw new Error(`trial cannot be completed from status: ${existing.status}`)
    const timestamp = this.timestamp()
    return this.inTransaction(() => {
      this.db.query("UPDATE trials SET status = ?, completed_at = ?, updated_at = ? WHERE trial_id = ?").run("completed", timestamp, timestamp, id)
      const trial = this.getTrial(id)
      if (!trial) throw new Error(`trial not found: ${id}`)
      this.recordEvent("TrialCompleted", "trial", id, trial)
      return trial
    })
  }

  failTrial(trialId: string, reason?: string): Trial {
    return this.finishTrial(trialId, "failed", "TrialFailed", reason)
  }

  cancelTrial(trialId: string, reason?: string): Trial {
    return this.finishTrial(trialId, "cancelled", "TrialCancelled", reason)
  }

  canCompleteMission(missionId: string): WriteBarrierResult {
    const id = cleanId(missionId)
    const result = this.db
      .query("SELECT result_id FROM research_results WHERE mission_id = ? AND status IN ('proposed', 'accepted') LIMIT 1")
      .get(id)
    if (result) return { ok: true }
    const artifact = this.db.query("SELECT id FROM artifacts WHERE produced_by_mission_id = ? LIMIT 1").get(id)
    if (artifact) return { ok: true }
    return { ok: false, reason: `mission has no result evidence: ${id}` }
  }

  assertMissionHasResultEvidence(missionId: string): void {
    const verdict = this.canCompleteMission(missionId)
    if (!verdict.ok) throw new Error(verdict.reason)
  }

  assertResearchResultHasEvidence(resultId: string): void {
    const id = cleanId(resultId)
    const result = this.getResearchResult(id)
    if (!result) throw new Error(`research result not found: ${id}`)
    if (!EVIDENCE_REQUIRED_RESULT_TYPES.has(result.result_type)) return
    const citation = this.db.query("SELECT 1 FROM result_citations WHERE result_id = ? LIMIT 1").get(id)
    const artifact = this.db.query("SELECT 1 FROM result_artifacts WHERE result_id = ? LIMIT 1").get(id)
    if (!citation && !artifact) throw new Error(`research result requires linked citation or artifact evidence: ${id}`)
  }

  listResearchEvents(options: ListResearchEventsOptions = {}): ResearchEvent[] {
    const filters: string[] = []
    const params: SQLQueryBindings[] = []

    if (options.entity_type !== undefined) {
      assertAllowed(RESEARCH_ENTITY_TYPES, options.entity_type, "research event entity_type")
      filters.push("entity_type = ?")
      params.push(options.entity_type)
    }
    if (options.entity_id !== undefined) {
      filters.push("entity_id = ?")
      params.push(cleanRequired(options.entity_id, "entity_id"))
    }
    if (options.event_type !== undefined) {
      filters.push("event_type = ?")
      params.push(cleanRequired(options.event_type, "event_type"))
    }
    if (options.after_event_id !== undefined) {
      const afterEventId = cleanRequired(options.after_event_id, "after_event_id")
      const after = this.db.query("SELECT rowid AS event_order, created_at FROM research_events WHERE event_id = ?").get(afterEventId) as
        | Pick<ResearchEventRow, "event_order" | "created_at">
        | null
      if (!after) throw new Error(`research event not found: ${afterEventId}`)
      filters.push("(created_at > ? OR (created_at = ? AND rowid > ?))")
      params.push(after.created_at, after.created_at, after.event_order)
    }

    params.push(cleanLimit(options.limit))
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : ""
    return (this.db
      .query(
        `SELECT rowid AS event_order, event_id, event_type, entity_type, entity_id, payload_json, created_at FROM research_events ${where} ORDER BY created_at ASC, rowid ASC LIMIT ?`,
      )
      .all(...params) as ResearchEventRow[]).map(researchEventFromRow)
  }

  getTopicSnapshot(topicId: string): TopicSnapshot | null {
    const id = cleanId(topicId)
    const topic = this.getTopic(id)
    if (!topic) return null
    const sources = this.listSourcesForTopic(id)
    const notes = this.listNotesForTopic(id)
    const artifacts = this.listArtifactsForTopic(id)
    return {
      topic,
      sources,
      notes,
      artifacts,
      stats: {
        source_count: sources.length,
        note_count: notes.length,
        artifact_count: artifacts.length,
        report_count: artifacts.filter((artifact) => artifact.kind === "report").length,
        reviewed_source_count: sources.filter((source) => source.status === "reviewed").length,
        rejected_source_count: sources.filter((source) => source.status === "rejected").length,
      },
      latest_event: this.latestEventForTopic(id),
    }
  }

  searchNotes(topicId: string, query: string, options: SearchOptions = {}): Note[] {
    const id = cleanId(topicId)
    this.requireTopic(id)
    const term = cleanRequired(query, "query")
    const limit = cleanLimit(options.limit)
    return (this.db
      .query(
        "SELECT * FROM notes WHERE topic_id = ? AND (content LIKE ? ESCAPE '\\' OR tags_json LIKE ? ESCAPE '\\') ORDER BY created_at, id LIMIT ?",
      )
      .all(id, likeContains(term), likeContains(term), limit) as NoteRow[]).map((row) => this.noteFromRow(row))
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS research_schema (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS topics (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('open', 'active', 'paused', 'closed')),
        input_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        locator TEXT NOT NULL,
        title TEXT,
        source_type TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('new', 'reviewed', 'rejected')),
        credibility TEXT,
        input_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
        content TEXT NOT NULL,
        tags_json TEXT,
        input_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        path TEXT,
        content TEXT,
        artifact_type TEXT,
        sha256 TEXT,
        size_bytes INTEGER,
        produced_by_mission_id TEXT,
        produced_by_run_id TEXT,
        description TEXT,
        input_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        CHECK (path IS NOT NULL OR content IS NOT NULL)
      );

      CREATE TABLE IF NOT EXISTS research_results (
        result_id TEXT PRIMARY KEY,
        result_type TEXT NOT NULL CHECK (result_type IN ('probe_result', 'smoke_test_result', 'full_training_result', 'evaluation_result', 'ablation_result', 'finding', 'negative_finding', 'bug_diagnosis', 'literature_finding', 'implementation_change', 'checkpoint_selection', 'promotion_decision', 'reproduction_record')),
        label TEXT,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('proposed', 'accepted', 'rejected', 'superseded')),
        confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
        mission_id TEXT,
        candidate_id TEXT,
        hypothesis_id TEXT,
        trial_id TEXT,
        training_run_id TEXT,
        metrics_json TEXT,
        reproduction_json TEXT,
        created_by TEXT NOT NULL CHECK (created_by IN ('commander', 'executor', 'verifier', 'human', 'system')),
        input_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS citations (
        citation_id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL CHECK (source_type IN ('paper', 'url', 'file', 'event', 'artifact', 'code', 'user')),
        source_uri TEXT NOT NULL,
        title TEXT,
        quoted_text_or_summary TEXT NOT NULL,
        accessed_at TEXT NOT NULL,
        sha256 TEXT,
        metadata_json TEXT,
        input_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS result_citations (
        result_id TEXT NOT NULL REFERENCES research_results(result_id) ON DELETE CASCADE,
        citation_id TEXT NOT NULL REFERENCES citations(citation_id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        link_event_id TEXT,
        PRIMARY KEY (result_id, citation_id)
      );

      CREATE TABLE IF NOT EXISTS result_artifacts (
        result_id TEXT NOT NULL REFERENCES research_results(result_id) ON DELETE CASCADE,
        artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        link_event_id TEXT,
        PRIMARY KEY (result_id, artifact_id)
      );

      CREATE TABLE IF NOT EXISTS hypotheses (
        hypothesis_id TEXT PRIMARY KEY,
        claim TEXT NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'rejected', 'promoted', 'needs_more_evidence')),
        input_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS candidates (
        candidate_id TEXT PRIMARY KEY,
        hypothesis_id TEXT REFERENCES hypotheses(hypothesis_id) ON DELETE SET NULL,
        claim TEXT NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'rejected', 'promoted', 'needs_more_evidence')),
        commander_score REAL,
        rank_reason TEXT,
        input_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS trials (
        trial_id TEXT PRIMARY KEY,
        hypothesis_id TEXT REFERENCES hypotheses(hypothesis_id) ON DELETE SET NULL,
        candidate_id TEXT REFERENCES candidates(candidate_id) ON DELETE SET NULL,
        trial_kind TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('planned', 'running', 'completed', 'failed', 'cancelled')),
        config_json TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS candidate_evidence (
        candidate_id TEXT NOT NULL REFERENCES candidates(candidate_id) ON DELETE CASCADE,
        evidence_type TEXT NOT NULL CHECK (evidence_type IN ('research_result', 'citation', 'artifact', 'event')),
        evidence_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (candidate_id, evidence_type, evidence_id)
      );

      CREATE TABLE IF NOT EXISTS research_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `)
    this.ensureColumn("topics", "input_hash", "TEXT")
    this.ensureColumn("sources", "input_hash", "TEXT")
    this.ensureColumn("notes", "input_hash", "TEXT")
    this.ensureColumn("artifacts", "input_hash", "TEXT")
    this.ensureColumn("artifacts", "artifact_type", "TEXT")
    this.ensureColumn("artifacts", "sha256", "TEXT")
    this.ensureColumn("artifacts", "size_bytes", "INTEGER")
    this.ensureColumn("artifacts", "produced_by_mission_id", "TEXT")
    this.ensureColumn("artifacts", "produced_by_run_id", "TEXT")
    this.ensureColumn("artifacts", "description", "TEXT")
    this.ensureColumn("result_citations", "link_event_id", "TEXT")
    this.ensureColumn("result_artifacts", "link_event_id", "TEXT")
    this.backfillLinkEventIds()
    this.backfillInputHashes()
    this.db.query("INSERT OR IGNORE INTO research_schema (version, applied_at) VALUES (?, ?)").run(1, this.timestamp())
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]
    if (!columns.some((row) => row.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  }

  private getSource(id: string): Source | null {
    return this.db
      .query("SELECT id, topic_id, locator, title, source_type, status, credibility, created_at FROM sources WHERE id = ?")
      .get(id) as Source | null
  }

  private getArtifact(id: string): Artifact | null {
    return this.db
      .query(
        "SELECT id, topic_id, kind, path, content, artifact_type, sha256, size_bytes, produced_by_mission_id, produced_by_run_id, description, created_at FROM artifacts WHERE id = ?",
      )
      .get(id) as Artifact | null
  }

  private backfillLinkEventIds(): void {
    const citationEntityIds = this.db
      .query(
        "SELECT DISTINCT entity_id FROM research_events WHERE event_type = 'ResultCitationLinked' AND entity_type = 'result_citation' ORDER BY rowid",
      )
      .all() as { entity_id: string }[]
    for (const row of citationEntityIds) {
      const events = this.db
        .query(
          "SELECT event_id FROM research_events WHERE event_type = 'ResultCitationLinked' AND entity_type = 'result_citation' AND entity_id = ? AND NOT EXISTS (SELECT 1 FROM result_citations WHERE link_event_id = research_events.event_id) ORDER BY rowid",
        )
        .all(row.entity_id) as { event_id: string }[]
      const links = this.db
        .query("SELECT result_id, citation_id FROM result_citations WHERE link_event_id IS NULL AND result_id || ':' || citation_id = ? ORDER BY rowid")
        .all(row.entity_id) as Pick<ResultCitationLink, "result_id" | "citation_id">[]
      if (events.length === 0 || events.length !== links.length) continue
      for (let index = 0; index < events.length; index++) {
        this.db
          .query("UPDATE result_citations SET link_event_id = ? WHERE result_id = ? AND citation_id = ? AND link_event_id IS NULL")
          .run(events[index]!.event_id, links[index]!.result_id, links[index]!.citation_id)
      }
    }

    const artifactEntityIds = this.db
      .query(
        "SELECT DISTINCT entity_id FROM research_events WHERE event_type = 'ResultArtifactLinked' AND entity_type = 'result_artifact' ORDER BY rowid",
      )
      .all() as { entity_id: string }[]
    for (const row of artifactEntityIds) {
      const events = this.db
        .query(
          "SELECT event_id FROM research_events WHERE event_type = 'ResultArtifactLinked' AND entity_type = 'result_artifact' AND entity_id = ? AND NOT EXISTS (SELECT 1 FROM result_artifacts WHERE link_event_id = research_events.event_id) ORDER BY rowid",
        )
        .all(row.entity_id) as { event_id: string }[]
      const links = this.db
        .query("SELECT result_id, artifact_id FROM result_artifacts WHERE link_event_id IS NULL AND result_id || ':' || artifact_id = ? ORDER BY rowid")
        .all(row.entity_id) as Pick<ResultArtifactLink, "result_id" | "artifact_id">[]
      if (events.length === 0 || events.length !== links.length) continue
      for (let index = 0; index < events.length; index++) {
        this.db
          .query("UPDATE result_artifacts SET link_event_id = ? WHERE result_id = ? AND artifact_id = ? AND link_event_id IS NULL")
          .run(events[index]!.event_id, links[index]!.result_id, links[index]!.artifact_id)
      }
    }
  }

  private backfillInputHashes(): void {
    for (const row of this.db.query("SELECT id, title, status, input_hash FROM topics WHERE input_hash IS NULL").all() as TopicRow[]) {
      const inputHash = hashPayload({ title: row.title, status: row.status })
      this.db.query("UPDATE topics SET title = ?, input_hash = ? WHERE id = ?").run(redactString(row.title), inputHash, row.id)
    }

    for (const row of this.db
      .query("SELECT id, topic_id, locator, title, source_type, status, credibility, input_hash, created_at FROM sources WHERE input_hash IS NULL")
      .all() as SourceRow[]) {
      const inputHash = hashPayload({
        topic_id: row.topic_id,
        locator: row.locator,
        title: row.title,
        source_type: row.source_type,
        status: row.status,
        credibility: row.credibility,
      })
      this.db
        .query("UPDATE sources SET locator = ?, title = ?, credibility = ?, input_hash = ? WHERE id = ?")
        .run(redactString(row.locator), redactNullable(row.title), redactNullable(row.credibility), inputHash, row.id)
    }

    for (const row of this.db
      .query("SELECT id, topic_id, source_id, content, tags_json, input_hash, created_at FROM notes WHERE input_hash IS NULL")
      .all() as NoteRow[]) {
      const inputHash = hashPayload({ topic_id: row.topic_id, source_id: row.source_id, content: row.content, tags: parseTags(row.tags_json) })
      this.db
        .query("UPDATE notes SET content = ?, tags_json = ?, input_hash = ? WHERE id = ?")
        .run(redactString(row.content), JSON.stringify(redactValue(parseTags(row.tags_json))), inputHash, row.id)
    }

    for (const row of this.db
      .query(
        "SELECT id, topic_id, kind, path, content, artifact_type, sha256, size_bytes, produced_by_mission_id, produced_by_run_id, description, input_hash, created_at FROM artifacts WHERE input_hash IS NULL",
      )
      .all() as ArtifactRow[]) {
      const inputHash = hashPayload(artifactInputHashPayload({
        topic_id: row.topic_id,
        kind: row.kind,
        path: row.path,
        content: row.content,
        artifact_type: row.artifact_type,
        sha256: row.sha256,
        size_bytes: row.size_bytes,
        produced_by_mission_id: row.produced_by_mission_id,
        produced_by_run_id: row.produced_by_run_id,
        description: row.description,
      }))
      this.db
        .query("UPDATE artifacts SET path = ?, content = ?, description = ?, input_hash = ? WHERE id = ?")
        .run(redactNullable(row.path), redactNullable(row.content), redactNullable(row.description), inputHash, row.id)
    }
  }

  private recordEvent(eventType: string, entityType: string, entityId: string, payload: unknown): string {
    const eventId = randomUUID()
    this.db
      .query(
        "INSERT INTO research_events (event_id, event_type, entity_type, entity_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(eventId, eventType, entityType, entityId, JSON.stringify(redactValue(payload)), this.timestamp())
    return eventId
  }

  private inTransaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE")
    try {
      const result = work()
      this.db.exec("COMMIT")
      return result
    } catch (error) {
      try {
        this.db.exec("ROLLBACK")
      } catch {
        // SQLite may already have rolled the transaction back; keep the original failure visible.
      }
      throw error
    }
  }

  private requireTopic(topicId: string): void {
    if (!this.getTopic(topicId)) throw new Error(`topic not found: ${topicId}`)
  }

  private requireSource(sourceId: string, topicId: string): void {
    const source = this.db.query("SELECT id FROM sources WHERE id = ? AND topic_id = ?").get(sourceId, topicId)
    if (!source) throw new Error(`source not found for topic: ${sourceId}`)
  }

  private requireArtifact(artifactId: string): void {
    if (!this.getArtifact(artifactId)) throw new Error(`artifact not found: ${artifactId}`)
  }

  private requireResearchResult(resultId: string): void {
    if (!this.getResearchResult(resultId)) throw new Error(`research result not found: ${resultId}`)
  }

  private requireCitation(citationId: string): void {
    if (!this.getCitation(citationId)) throw new Error(`citation not found: ${citationId}`)
  }

  private requireHypothesis(hypothesisId: string): void {
    if (!this.getHypothesis(hypothesisId)) throw new Error(`hypothesis not found: ${hypothesisId}`)
  }

  private requireCandidate(candidateId: string): void {
    if (!this.getCandidate(candidateId)) throw new Error(`candidate not found: ${candidateId}`)
  }

  private requireTrial(trialId: string): void {
    if (!this.getTrial(trialId)) throw new Error(`trial not found: ${trialId}`)
  }

  private requireCandidateEvidence(evidenceType: CandidateEvidenceType, evidenceId: string): void {
    if (evidenceType === "research_result") {
      const result = this.getResearchResult(evidenceId)
      if (!result || (result.status !== "accepted" && result.status !== "proposed")) throw new Error(`research result evidence not found: ${evidenceId}`)
      return
    }
    if (evidenceType === "citation") {
      this.requireCitation(evidenceId)
      return
    }
    if (evidenceType === "artifact") {
      this.requireArtifact(evidenceId)
      return
    }
    if (!this.isValidEventEvidence(evidenceId)) {
      throw new Error(`research event evidence not found: ${evidenceId}`)
    }
  }

  private isValidCandidateEvidence(link: CandidateEvidenceLink): boolean {
    if (link.evidence_type === "research_result") {
      const result = this.getResearchResult(link.evidence_id)
      return result?.status === "accepted" || result?.status === "proposed"
    }
    if (link.evidence_type === "citation") return this.getCitation(link.evidence_id) !== null
    if (link.evidence_type === "artifact") return this.getArtifact(link.evidence_id) !== null
    return this.isValidEventEvidence(link.evidence_id)
  }

  private isValidEventEvidence(eventId: string): boolean {
    const row = this.db.query("SELECT entity_type, entity_id, event_type, payload_json FROM research_events WHERE event_id = ?").get(eventId) as
      | Pick<ResearchEventRow, "entity_type" | "entity_id" | "event_type" | "payload_json">
      | null
    if (!row) return false
    if (row.event_type === "ResearchResultProposed" || row.event_type === "ResearchResultAccepted") {
      const result = this.getResearchResult(row.entity_id)
      return result?.status === "proposed" || result?.status === "accepted"
    }
    if (row.event_type === "CitationRecorded") return this.getCitation(row.entity_id) !== null
    if (row.event_type === "artifact_added") return this.getArtifact(row.entity_id) !== null
    if (row.event_type === "ResultCitationLinked") {
      const link =
        (this.db.query("SELECT result_id, citation_id FROM result_citations WHERE link_event_id = ?").get(eventId) as
          | Pick<ResultCitationLink, "result_id" | "citation_id">
          | null) ?? this.resultCitationLinkFromEventPayload(row.payload_json)
      if (!link) return false
      const result = this.getResearchResult(link.result_id)
      const currentLink = this.db
        .query("SELECT 1 FROM result_citations WHERE result_id = ? AND citation_id = ?")
        .get(link.result_id, link.citation_id)
      return (result?.status === "proposed" || result?.status === "accepted") && this.getCitation(link.citation_id) !== null && currentLink !== null
    }
    if (row.event_type === "ResultArtifactLinked") {
      const link =
        (this.db.query("SELECT result_id, artifact_id FROM result_artifacts WHERE link_event_id = ?").get(eventId) as
          | Pick<ResultArtifactLink, "result_id" | "artifact_id">
          | null) ?? this.resultArtifactLinkFromEventPayload(row.payload_json)
      if (!link) return false
      const result = this.getResearchResult(link.result_id)
      const currentLink = this.db.query("SELECT 1 FROM result_artifacts WHERE result_id = ? AND artifact_id = ?").get(link.result_id, link.artifact_id)
      return (result?.status === "proposed" || result?.status === "accepted") && this.getArtifact(link.artifact_id) !== null && currentLink !== null
    }
    return false
  }

  private resultCitationLinkFromEventPayload(payloadJson: string): Pick<ResultCitationLink, "result_id" | "citation_id"> | null {
    const payload = parseJsonObject(payloadJson)
    if (!payload || typeof payload.result_id !== "string" || typeof payload.citation_id !== "string") return null
    return { result_id: payload.result_id, citation_id: payload.citation_id }
  }

  private resultArtifactLinkFromEventPayload(payloadJson: string): Pick<ResultArtifactLink, "result_id" | "artifact_id"> | null {
    const payload = parseJsonObject(payloadJson)
    if (!payload || typeof payload.result_id !== "string" || typeof payload.artifact_id !== "string") return null
    return { result_id: payload.result_id, artifact_id: payload.artifact_id }
  }

  private updateCandidateStatus(candidateId: string, status: CandidateStatus, eventType: string, reason?: string): Candidate {
    const id = cleanId(candidateId)
    assertAllowed(CANDIDATE_STATUSES, status, "candidate status")
    this.requireCandidate(id)
    const cleanReason = cleanOptional(reason)
    const updatedAt = this.timestamp()
    return this.inTransaction(() => {
      this.db.query("UPDATE candidates SET status = ?, updated_at = ? WHERE candidate_id = ?").run(status, updatedAt, id)
      const candidate = this.getCandidate(id)
      if (!candidate) throw new Error(`candidate not found: ${id}`)
      this.recordEvent(eventType, "candidate", id, { candidate, reason: cleanReason ? redactString(cleanReason) : null })
      return candidate
    })
  }

  private finishTrial(trialId: string, status: "failed" | "cancelled", eventType: string, reason?: string): Trial {
    const id = cleanId(trialId)
    const existing = this.getTrial(id)
    if (!existing) throw new Error(`trial not found: ${id}`)
    if (existing.status !== "running" && existing.status !== "planned") throw new Error(`trial cannot be ${status} from status: ${existing.status}`)
    const cleanReason = cleanOptional(reason)
    const timestamp = this.timestamp()
    return this.inTransaction(() => {
      this.db.query("UPDATE trials SET status = ?, completed_at = ?, updated_at = ? WHERE trial_id = ?").run(status, timestamp, timestamp, id)
      const trial = this.getTrial(id)
      if (!trial) throw new Error(`trial not found: ${id}`)
      this.recordEvent(eventType, "trial", id, { trial, reason: cleanReason ? redactString(cleanReason) : null })
      return trial
    })
  }

  private latestEventForTopic(topicId: string): ResearchEvent | null {
    const row = this.db
      .query(
        `
        SELECT rowid AS event_order, event_id, event_type, entity_type, entity_id, payload_json, created_at
        FROM research_events
        WHERE (entity_type = 'topic' AND entity_id = ?)
          OR (entity_type = 'source' AND entity_id IN (SELECT id FROM sources WHERE topic_id = ?))
          OR (entity_type = 'note' AND entity_id IN (SELECT id FROM notes WHERE topic_id = ?))
          OR (entity_type = 'artifact' AND entity_id IN (SELECT id FROM artifacts WHERE topic_id = ?))
        ORDER BY created_at DESC, rowid DESC
        LIMIT 1
      `,
      )
      .get(topicId, topicId, topicId, topicId) as ResearchEventRow | null
    return row ? researchEventFromRow(row) : null
  }

  private noteFromRow(row: NoteRow): Note
  private noteFromRow(row: NoteRow | null): Note | null
  private noteFromRow(row: NoteRow | null): Note | null {
    if (!row) return null
    return { id: row.id, topic_id: row.topic_id, source_id: row.source_id, content: row.content, tags: parseTags(row.tags_json), created_at: row.created_at }
  }

  private researchResultFromRow(row: ResearchResultRow): ResearchResult
  private researchResultFromRow(row: ResearchResultRow | null): ResearchResult | null
  private researchResultFromRow(row: ResearchResultRow | null): ResearchResult | null {
    if (!row) return null
    assertAllowed(RESEARCH_RESULT_TYPES, row.result_type, "research result type")
    assertAllowed(RESEARCH_RESULT_STATUSES, row.status, "research result status")
    assertAllowed(RESEARCH_RESULT_CONFIDENCES, row.confidence, "research result confidence")
    assertAllowed(RESEARCH_RESULT_CREATED_BY, row.created_by, "research result created_by")
    return {
      result_id: row.result_id,
      result_type: row.result_type,
      label: row.label,
      title: row.title,
      summary: row.summary,
      status: row.status,
      confidence: row.confidence,
      mission_id: row.mission_id,
      candidate_id: row.candidate_id,
      hypothesis_id: row.hypothesis_id,
      trial_id: row.trial_id,
      training_run_id: row.training_run_id,
      metrics: parseNullableJson(row.metrics_json),
      reproduction: parseNullableJson(row.reproduction_json),
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  }

  private citationFromRow(row: CitationRow): Citation
  private citationFromRow(row: CitationRow | null): Citation | null
  private citationFromRow(row: CitationRow | null): Citation | null {
    if (!row) return null
    assertAllowed(CITATION_SOURCE_TYPES, row.source_type, "citation source type")
    return {
      citation_id: row.citation_id,
      source_type: row.source_type,
      source_uri: row.source_uri,
      title: row.title,
      quoted_text_or_summary: row.quoted_text_or_summary,
      accessed_at: row.accessed_at,
      sha256: row.sha256,
      metadata: parseNullableJson(row.metadata_json),
      created_at: row.created_at,
    }
  }

  private hypothesisFromRow(row: HypothesisRow): Hypothesis
  private hypothesisFromRow(row: HypothesisRow | null): Hypothesis | null
  private hypothesisFromRow(row: HypothesisRow | null): Hypothesis | null {
    if (!row) return null
    assertAllowed(HYPOTHESIS_STATUSES, row.status, "hypothesis status")
    return row
  }

  private candidateFromRow(row: CandidateRow): Candidate
  private candidateFromRow(row: CandidateRow | null): Candidate | null
  private candidateFromRow(row: CandidateRow | null): Candidate | null {
    if (!row) return null
    assertAllowed(CANDIDATE_STATUSES, row.status, "candidate status")
    return row
  }

  private trialFromRow(row: TrialRow): Trial
  private trialFromRow(row: TrialRow | null): Trial | null
  private trialFromRow(row: TrialRow | null): Trial | null {
    if (!row) return null
    assertAllowed(TRIAL_STATUSES, row.status, "trial status")
    return {
      trial_id: row.trial_id,
      hypothesis_id: row.hypothesis_id,
      candidate_id: row.candidate_id,
      trial_kind: row.trial_kind,
      status: row.status,
      config: parseNullableJson(row.config_json),
      input_hash: row.input_hash,
      started_at: row.started_at,
      completed_at: row.completed_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  }

  private timestamp(): string {
    return this.now().toISOString()
  }
}

function cleanId(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error("id is required")
  return trimmed
}

function cleanRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${field} is required`)
  return trimmed
}

function cleanOptional(value: string | undefined): string | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function cleanOptionalEnum<T extends string>(value: string | undefined, allowed: Set<T>, field: string): T | null {
  if (value === undefined) return null
  const trimmed = cleanRequired(value, field)
  assertAllowed(allowed, trimmed, field)
  return trimmed
}

function cleanOptionalSize(value: number | undefined): number | null {
  if (value === undefined) return null
  if (!Number.isInteger(value) || value < 0) throw new Error("size_bytes must be a non-negative integer")
  return value
}

function cleanLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_READ_LIMIT
  if (!Number.isInteger(value) || value <= 0) throw new Error("limit must be a positive integer")
  return Math.min(value, MAX_READ_LIMIT)
}

function cleanTags(value: string[] | undefined): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((tag) => typeof tag === "string")) throw new Error("invalid note tags")
  return value
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function artifactInputHashPayload(value: {
  topic_id: string
  kind: ArtifactKind
  path: string | null
  content: string | null
  artifact_type: ArtifactType | null
  sha256: string | null
  size_bytes: number | null
  produced_by_mission_id: string | null
  produced_by_run_id: string | null
  description: string | null
}): Record<string, unknown> {
  return {
    topic_id: value.topic_id,
    kind: value.kind,
    path: value.path,
    content: value.content,
    ...compactPayload({
      artifact_type: value.artifact_type,
      sha256: value.sha256,
      size_bytes: value.size_bytes,
      produced_by_mission_id: value.produced_by_mission_id,
      produced_by_run_id: value.produced_by_run_id,
      description: value.description,
    }),
  }
}

function compactPayload(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined))
}

function assertAllowed<T extends string>(allowed: Set<T>, value: string, field: string): asserts value is T {
  if (!allowed.has(value as T)) throw new Error(`invalid ${field}: ${value}`)
}

function redactString(value: string): string {
  return redactValue(value)
}

function redactNullable(value: string | null): string | null {
  return value === null ? null : redactString(value)
}

function parseTags(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed) || !parsed.every((tag) => typeof tag === "string")) return []
    return parsed
  } catch {
    return []
  }
}

function parseNullableJson(value: string | null): unknown | null {
  if (value === null) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function likeContains(value: string): string {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`
}

function researchEventFromRow(row: ResearchEventRow): ResearchEvent {
  assertAllowed(RESEARCH_ENTITY_TYPES, row.entity_type, "research event entity_type")
  return {
    event_id: row.event_id,
    event_type: row.event_type,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    payload: JSON.parse(row.payload_json) as unknown,
    created_at: row.created_at,
  }
}
