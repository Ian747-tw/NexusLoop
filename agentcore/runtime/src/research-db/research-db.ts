import { createHash, randomUUID } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
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
export type TrainingRunLabel = "probe" | "smoke_test" | "full_training" | "evaluation" | "ablation" | "debug_run"
export type TrainingRunStatus = "planned" | "starting" | "running" | "paused" | "completed" | "failed" | "cancelled"
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
  | "training_run"
  | "training_checkpoint"
  | "reproduction_record"

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
const TRAINING_RUN_LABELS = new Set<TrainingRunLabel>(["probe", "smoke_test", "full_training", "evaluation", "ablation", "debug_run"])
const TRAINING_RUN_STATUSES = new Set<TrainingRunStatus>(["planned", "starting", "running", "paused", "completed", "failed", "cancelled"])
const BEST_MODEL_TRAINING_LABELS = new Set<TrainingRunLabel>(["full_training", "evaluation", "ablation"])
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
  "training_run",
  "training_checkpoint",
  "reproduction_record",
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
  eventsPath?: string
  appendEvents?: boolean
  now?: () => Date
  idFactory?: () => string
}

export interface ResearchDbRebuildOptions extends ResearchDbOptions {
  appendEvents?: false
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

export interface TrainingRunInput {
  training_run_id?: string
  trial_id?: string
  candidate_id?: string
  hypothesis_id?: string
  mission_id?: string
  label: TrainingRunLabel
  pid?: number
  process_group_id?: number
  log_path?: string
  metrics_path?: string
  checkpoint_dir?: string
  reproduction?: unknown
}

export interface StartTrainingRunInput {
  pid?: number
  process_group_id?: number
  log_path?: string
  metrics_path?: string
  checkpoint_dir?: string
}

export interface TrainingProgressInput {
  training_run_id: string
  step?: number
  metric?: unknown
  metrics_path?: string
  log_path?: string
}

export interface TrainingCheckpointInput {
  checkpoint_id?: string
  training_run_id: string
  artifact_id: string
  step?: number
  metric?: unknown
  observed_at?: string
}

export interface CompleteTrainingRunInput {
  metrics_path?: string
  reproduction?: unknown
}

export interface TrainingRun {
  training_run_id: string
  trial_id: string | null
  candidate_id: string | null
  hypothesis_id: string | null
  mission_id: string | null
  label: TrainingRunLabel
  status: TrainingRunStatus
  pid: number | null
  process_group_id: number | null
  log_path: string | null
  metrics_path: string | null
  checkpoint_dir: string | null
  latest_checkpoint_id: string | null
  last_step: number | null
  last_metric: unknown | null
  reproduction: unknown | null
  started_at: string | null
  last_observed_at: string | null
  completed_at: string | null
  input_hash: string
  created_at: string
  updated_at: string
}

export interface TrainingCheckpoint {
  checkpoint_id: string
  training_run_id: string
  artifact_id: string
  step: number | null
  metric: unknown | null
  observed_at: string
  created_at: string
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

export interface SearchTrainingRunsOptions extends SearchOptions {
  label?: TrainingRunLabel
  status?: TrainingRunStatus
  candidate_id?: string
  hypothesis_id?: string
  trial_id?: string
  mission_id?: string
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

export interface ResearchProjectionStatus {
  projection_name: string
  last_event_id: string | null
  last_event_timestamp: string | null
  applied_count: number
  rebuilt_at: string | null
  updated_at: string | null
}

export interface ResearchProjectionIntegrity {
  ok: boolean
  stale: boolean
  reason?: string
  last_event_id?: string
  pending_count?: number
  corrupted_line?: number
  unsupported_event_type?: string
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

interface TrainingRunRow extends Omit<TrainingRun, "last_metric" | "reproduction"> {
  last_metric_json: string | null
  reproduction_json: string | null
}

interface TrainingCheckpointRow extends Omit<TrainingCheckpoint, "metric"> {
  metric_json: string | null
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

interface ResearchProjectionRow {
  projection_name: string
  last_event_id: string | null
  last_event_timestamp: string | null
  applied_count: number
  rebuilt_at: string | null
  updated_at: string | null
}

export interface ResearchJsonlEvent {
  event_id?: string
  timestamp?: string
  kind?: string
  type?: string
  event_type?: string
  entity_type?: string
  entity_id?: string
  payload?: unknown
  [key: string]: unknown
}

interface ParsedJsonlEvent {
  line: number
  event: ResearchJsonlEvent
}

const RESEARCH_PROJECTION_NAME = "research_db_v1"
const SUPPORTED_RESEARCH_EVENT_TYPES = new Set([
  "topic_created",
  "source_added",
  "note_added",
  "artifact_added",
  "ResearchResultProposed",
  "ResearchResultAccepted",
  "ResearchResultRejected",
  "CitationRecorded",
  "ResultCitationLinked",
  "ResultArtifactLinked",
  "HypothesisCreated",
  "HypothesisStatusUpdated",
  "CandidateCreated",
  "CandidateEvidenceLinked",
  "CandidateRanked",
  "CandidateSelected",
  "CandidateRejected",
  "CandidatePromotionProposed",
  "CandidatePromoted",
  "CandidateNeedsMoreEvidence",
  "TrialPlanned",
  "TrialStarted",
  "TrialCompleted",
  "TrialFailed",
  "TrialCancelled",
  "TrainingRunPlanned",
  "TrainingRunStarted",
  "TrainingProgressObserved",
  "TrainingCheckpointObserved",
  "ReproductionRecipeRecorded",
  "TrainingRunCompleted",
  "TrainingRunFailed",
  "TrainingRunCancelled",
])

export class ResearchDb {
  private readonly db: Database
  private readonly eventsPath: string
  private readonly appendEvents: boolean
  private readonly now: () => Date
  private readonly idFactory: () => string

  private constructor(
    db: Database,
    options: Required<Pick<ResearchDbOptions, "eventsPath" | "appendEvents" | "now" | "idFactory">>,
  ) {
    this.db = db
    this.eventsPath = options.eventsPath
    this.appendEvents = options.appendEvents
    this.now = options.now
    this.idFactory = options.idFactory
  }

  static open(projectDir: string, options: ResearchDbOptions = {}): ResearchDb {
    const dbPath = options.dbPath ?? join(projectDir, ".nxl", "research.db")
    const eventsPath = options.eventsPath ?? join(projectDir, ".nxl", "events.jsonl")
    mkdirSync(dirname(dbPath), { recursive: true })
    const db = new Database(dbPath, { create: true })
    db.exec("PRAGMA foreign_keys = ON")
    const researchDb = new ResearchDb(db, {
      eventsPath,
      appendEvents: options.appendEvents ?? true,
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

  static rebuildFromEvents(projectDir: string, eventsPath?: string, options: ResearchDbRebuildOptions = {}): ResearchDb {
    const db = ResearchDb.open(projectDir, {
      ...options,
      eventsPath: eventsPath ?? options.eventsPath,
      appendEvents: true,
    })
    try {
      db.rebuildFromEvents(eventsPath ?? options.eventsPath ?? join(projectDir, ".nxl", "events.jsonl"))
      return db
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

  planTrainingRun(input: TrainingRunInput): TrainingRun {
    const trainingRunId = cleanId(input.training_run_id ?? this.idFactory())
    const trialId = input.trial_id ? cleanId(input.trial_id) : null
    const linkedTrial = trialId ? this.getTrial(trialId) : null
    if (trialId && !linkedTrial) throw new Error(`trial not found: ${trialId}`)
    const candidateId = input.candidate_id ? cleanId(input.candidate_id) : linkedTrial?.candidate_id ?? null
    const hypothesisId = input.hypothesis_id ? cleanId(input.hypothesis_id) : linkedTrial?.hypothesis_id ?? null
    const missionId = input.mission_id ? cleanId(input.mission_id) : null
    assertAllowed(TRAINING_RUN_LABELS, input.label, "training run label")
    this.validateTrainingRunLinks({ trialId, candidateId, hypothesisId })
    const pid = cleanOptionalProcessId(input.pid, "pid")
    const processGroupId = cleanOptionalProcessId(input.process_group_id, "process_group_id")
    const logPath = cleanOptional(input.log_path)
    const metricsPath = cleanOptional(input.metrics_path)
    const checkpointDir = cleanOptional(input.checkpoint_dir)
    const reproduction = input.reproduction ?? null
    const inputHash = hashPayload({
      trial_id: trialId,
      candidate_id: candidateId,
      hypothesis_id: hypothesisId,
      mission_id: missionId,
      label: input.label,
      status: "planned",
      pid,
      process_group_id: processGroupId,
      log_path: logPath,
      metrics_path: metricsPath,
      checkpoint_dir: checkpointDir,
      reproduction,
    })
    const createdAt = this.timestamp()
    return this.inTransaction(() => {
      const existing = this.db.query("SELECT * FROM training_runs WHERE training_run_id = ?").get(trainingRunId) as TrainingRunRow | null
      if (existing) {
        if (existing.input_hash === inputHash) return this.trainingRunFromRow(existing)
        throw new Error(`training run id collision: ${trainingRunId}`)
      }
      this.db
        .query(
          "INSERT INTO training_runs (training_run_id, trial_id, candidate_id, hypothesis_id, mission_id, label, status, pid, process_group_id, log_path, metrics_path, checkpoint_dir, latest_checkpoint_id, last_step, last_metric_json, reproduction_json, started_at, last_observed_at, completed_at, input_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          trainingRunId,
          trialId,
          candidateId,
          hypothesisId,
          missionId,
          input.label,
          "planned",
          pid,
          processGroupId,
          logPath ? redactString(logPath) : null,
          metricsPath ? redactString(metricsPath) : null,
          checkpointDir ? redactString(checkpointDir) : null,
          null,
          null,
          null,
          JSON.stringify(redactValue(reproduction)),
          null,
          null,
          null,
          inputHash,
          createdAt,
          createdAt,
        )
      const run = this.getTrainingRun(trainingRunId)
      if (!run) throw new Error(`failed to plan training run: ${trainingRunId}`)
      this.recordEvent("TrainingRunPlanned", "training_run", trainingRunId, run)
      return run
    })
  }

  getTrainingRun(trainingRunId: string): TrainingRun | null {
    const row = this.db.query("SELECT * FROM training_runs WHERE training_run_id = ?").get(cleanId(trainingRunId)) as TrainingRunRow | null
    return this.trainingRunFromRow(row)
  }

  searchTrainingRuns(options: SearchTrainingRunsOptions = {}): TrainingRun[] {
    const filters: string[] = []
    const params: SQLQueryBindings[] = []
    if (options.label !== undefined) {
      assertAllowed(TRAINING_RUN_LABELS, options.label, "training run label")
      filters.push("label = ?")
      params.push(options.label)
    }
    if (options.status !== undefined) {
      assertAllowed(TRAINING_RUN_STATUSES, options.status, "training run status")
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
    if (options.trial_id !== undefined) {
      filters.push("trial_id = ?")
      params.push(cleanId(options.trial_id))
    }
    if (options.mission_id !== undefined) {
      filters.push("mission_id = ?")
      params.push(cleanId(options.mission_id))
    }
    params.push(cleanLimit(options.limit))
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : ""
    return (this.db.query(`SELECT * FROM training_runs ${where} ORDER BY created_at, training_run_id LIMIT ?`).all(...params) as TrainingRunRow[]).map((row) =>
      this.trainingRunFromRow(row),
    )
  }

  startTrainingRun(trainingRunId: string, input: StartTrainingRunInput = {}): TrainingRun {
    const id = cleanId(trainingRunId)
    const existing = this.getTrainingRun(id)
    if (!existing) throw new Error(`training run not found: ${id}`)
    if (existing.status === "running") return existing
    if (existing.status !== "planned" && existing.status !== "starting" && existing.status !== "paused") {
      throw new Error(`training run cannot be started from status: ${existing.status}`)
    }
    const pid = cleanOptionalProcessId(input.pid, "pid")
    const processGroupId = cleanOptionalProcessId(input.process_group_id, "process_group_id")
    const logPath = cleanOptional(input.log_path)
    const metricsPath = cleanOptional(input.metrics_path)
    const checkpointDir = cleanOptional(input.checkpoint_dir)
    const timestamp = this.timestamp()
    return this.inTransaction(() => {
      this.db
        .query(
          "UPDATE training_runs SET status = ?, pid = COALESCE(?, pid), process_group_id = COALESCE(?, process_group_id), log_path = COALESCE(?, log_path), metrics_path = COALESCE(?, metrics_path), checkpoint_dir = COALESCE(?, checkpoint_dir), started_at = COALESCE(started_at, ?), updated_at = ? WHERE training_run_id = ?",
        )
        .run(
          "running",
          pid,
          processGroupId,
          logPath ? redactString(logPath) : null,
          metricsPath ? redactString(metricsPath) : null,
          checkpointDir ? redactString(checkpointDir) : null,
          timestamp,
          timestamp,
          id,
        )
      const run = this.getTrainingRun(id)
      if (!run) throw new Error(`training run not found: ${id}`)
      this.recordEvent("TrainingRunStarted", "training_run", id, run)
      return run
    })
  }

  observeTrainingProgress(input: TrainingProgressInput): TrainingRun {
    const id = cleanId(input.training_run_id)
    const existing = this.getTrainingRun(id)
    if (!existing) throw new Error(`training run not found: ${id}`)
    this.assertTrainingRunObservable(existing)
    const step = cleanOptionalStep(input.step)
    const metricJson = input.metric === undefined ? null : JSON.stringify(redactValue(input.metric))
    const metricsPath = cleanOptional(input.metrics_path)
    const logPath = cleanOptional(input.log_path)
    const timestamp = this.timestamp()
    return this.inTransaction(() => {
      if (metricJson === null) {
        this.db
          .query(
            "UPDATE training_runs SET last_step = COALESCE(?, last_step), metrics_path = COALESCE(?, metrics_path), log_path = COALESCE(?, log_path), last_observed_at = ?, updated_at = ? WHERE training_run_id = ?",
          )
          .run(step, metricsPath ? redactString(metricsPath) : null, logPath ? redactString(logPath) : null, timestamp, timestamp, id)
      } else {
        this.db
          .query(
            "UPDATE training_runs SET last_step = COALESCE(?, last_step), last_metric_json = ?, metrics_path = COALESCE(?, metrics_path), log_path = COALESCE(?, log_path), last_observed_at = ?, updated_at = ? WHERE training_run_id = ?",
          )
          .run(step, metricJson, metricsPath ? redactString(metricsPath) : null, logPath ? redactString(logPath) : null, timestamp, timestamp, id)
      }
      const run = this.getTrainingRun(id)
      if (!run) throw new Error(`training run not found: ${id}`)
      this.recordEvent("TrainingProgressObserved", "training_run", id, run)
      return run
    })
  }

  recordTrainingCheckpoint(input: TrainingCheckpointInput): TrainingCheckpoint {
    const trainingRunId = cleanId(input.training_run_id)
    const run = this.getTrainingRun(trainingRunId)
    if (!run) throw new Error(`training run not found: ${trainingRunId}`)
    this.assertTrainingRunObservable(run)
    const artifactId = cleanId(input.artifact_id)
    const artifact = this.getArtifact(artifactId)
    if (!artifact) throw new Error(`artifact not found: ${artifactId}`)
    if (artifact.produced_by_run_id !== trainingRunId) {
      throw new Error(`checkpoint artifact run mismatch: ${artifactId}`)
    }
    const checkpointId = cleanId(input.checkpoint_id ?? this.idFactory())
    const step = cleanOptionalStep(input.step)
    const metricJson = input.metric === undefined ? null : JSON.stringify(redactValue(input.metric))
    const callerObservedAt = input.observed_at ? cleanRequired(input.observed_at, "observed_at") : null
    const observedAt = callerObservedAt ?? this.timestamp()
    const createdAt = this.timestamp()
    return this.inTransaction(() => {
      const existing = this.db.query("SELECT * FROM training_checkpoints WHERE checkpoint_id = ?").get(checkpointId) as TrainingCheckpointRow | null
      if (existing) {
        const checkpoint = this.trainingCheckpointFromRow(existing)
        if (
          checkpoint.training_run_id === trainingRunId &&
          checkpoint.artifact_id === artifactId &&
          checkpoint.step === step &&
          JSON.stringify(checkpoint.metric) === JSON.stringify(metricJson === null ? null : parseNullableJson(metricJson)) &&
          (callerObservedAt === null || checkpoint.observed_at === callerObservedAt)
        ) {
          return checkpoint
        }
        throw new Error(`training checkpoint id collision: ${checkpointId}`)
      }
      this.db
        .query(
          "INSERT INTO training_checkpoints (checkpoint_id, training_run_id, artifact_id, step, metric_json, observed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(checkpointId, trainingRunId, artifactId, step, metricJson, observedAt, createdAt)
      this.db
        .query(
          "UPDATE training_runs SET latest_checkpoint_id = ?, last_step = COALESCE(?, last_step), last_metric_json = COALESCE(?, last_metric_json), last_observed_at = ?, updated_at = ? WHERE training_run_id = ?",
        )
        .run(checkpointId, step, metricJson, observedAt, createdAt, trainingRunId)
      const checkpoint = this.getTrainingCheckpoint(checkpointId)
      if (!checkpoint) throw new Error(`failed to record training checkpoint: ${checkpointId}`)
      this.recordEvent("TrainingCheckpointObserved", "training_checkpoint", checkpointId, checkpoint)
      return checkpoint
    })
  }

  getTrainingCheckpoint(checkpointId: string): TrainingCheckpoint | null {
    const row = this.db.query("SELECT * FROM training_checkpoints WHERE checkpoint_id = ?").get(cleanId(checkpointId)) as TrainingCheckpointRow | null
    return this.trainingCheckpointFromRow(row)
  }

  recordReproductionRecipe(trainingRunId: string, reproduction: unknown): TrainingRun {
    const id = cleanId(trainingRunId)
    const existing = this.getTrainingRun(id)
    if (!existing) throw new Error(`training run not found: ${id}`)
    const updatedAt = this.timestamp()
    return this.inTransaction(() => {
      this.db.query("UPDATE training_runs SET reproduction_json = ?, updated_at = ? WHERE training_run_id = ?").run(JSON.stringify(redactValue(reproduction)), updatedAt, id)
      const run = this.getTrainingRun(id)
      if (!run) throw new Error(`training run not found: ${id}`)
      this.recordEvent("ReproductionRecipeRecorded", "reproduction_record", id, { training_run_id: id, reproduction: run.reproduction })
      return run
    })
  }

  completeTrainingRun(trainingRunId: string, input: CompleteTrainingRunInput = {}): TrainingRun {
    const id = cleanId(trainingRunId)
    const existing = this.getTrainingRun(id)
    if (!existing) throw new Error(`training run not found: ${id}`)
    if (existing.status === "failed" || existing.status === "cancelled" || existing.status === "completed") {
      throw new Error(`training run cannot be completed from status: ${existing.status}`)
    }
    const metricsPath = cleanOptional(input.metrics_path)
    const reproduction = input.reproduction
    const reproductionJson = reproduction === undefined || reproduction === null ? null : JSON.stringify(redactValue(reproduction))
    if (existing.label === "full_training") {
      const hasReproduction = (reproduction !== undefined && reproduction !== null) || existing.reproduction !== null
      if (!hasReproduction) throw new Error(`full training run requires reproduction before completion: ${id}`)
      const hasMetricsEvidence = metricsPath !== null || existing.metrics_path !== null || existing.last_metric !== null
      if (!hasMetricsEvidence) throw new Error(`full training run requires metrics evidence before completion: ${id}`)
    }
    const completedAt = this.timestamp()
    return this.inTransaction(() => {
      this.db
        .query(
          "UPDATE training_runs SET status = ?, metrics_path = COALESCE(?, metrics_path), reproduction_json = COALESCE(?, reproduction_json), completed_at = ?, updated_at = ? WHERE training_run_id = ?",
        )
        .run("completed", metricsPath ? redactString(metricsPath) : null, reproductionJson, completedAt, completedAt, id)
      const run = this.getTrainingRun(id)
      if (!run) throw new Error(`training run not found: ${id}`)
      this.recordEvent("TrainingRunCompleted", "training_run", id, run)
      return run
    })
  }

  failTrainingRun(trainingRunId: string, reason?: string): TrainingRun {
    return this.finishTrainingRun(trainingRunId, "failed", "TrainingRunFailed", reason)
  }

  cancelTrainingRun(trainingRunId: string, reason?: string): TrainingRun {
    return this.finishTrainingRun(trainingRunId, "cancelled", "TrainingRunCancelled", reason)
  }

  assertTrainingRunCanSupportBestModelUpdate(trainingRunId: string): void {
    const id = cleanId(trainingRunId)
    const run = this.getTrainingRun(id)
    if (!run) throw new Error(`training run not found: ${id}`)
    if (!BEST_MODEL_TRAINING_LABELS.has(run.label)) throw new Error(`training run label cannot update best model: ${run.label}`)
    if (run.status !== "completed") throw new Error(`training run must be completed to update best model: ${id}`)
  }

  assertFullTrainingResultHasMetricsAndReproduction(resultId: string): void {
    const id = cleanId(resultId)
    const result = this.getResearchResult(id)
    if (!result) throw new Error(`research result not found: ${id}`)
    if (result.result_type !== "full_training_result") return
    const run = result.training_run_id ? this.getTrainingRun(result.training_run_id) : null
    const hasReproduction = result.reproduction !== null || (run !== null && run.reproduction !== null)
    if (!hasReproduction) throw new Error(`full training result requires reproduction: ${id}`)
    const linkedArtifact = this.db.query("SELECT 1 FROM result_artifacts WHERE result_id = ? LIMIT 1").get(id)
    const hasMetricsEvidence = result.metrics !== null || (run !== null && run.metrics_path !== null) || linkedArtifact !== null
    if (!hasMetricsEvidence) throw new Error(`full training result requires metrics evidence: ${id}`)
  }

  assertCheckpointSelectionHasCheckpointArtifact(resultId: string): void {
    const id = cleanId(resultId)
    const result = this.getResearchResult(id)
    if (!result) throw new Error(`research result not found: ${id}`)
    if (result.result_type !== "checkpoint_selection") return
    const checkpointArtifact = result.training_run_id
      ? this.db
          .query(
            "SELECT 1 FROM result_artifacts ra INNER JOIN training_checkpoints tc ON tc.artifact_id = ra.artifact_id WHERE ra.result_id = ? AND tc.training_run_id = ? LIMIT 1",
          )
          .get(id, result.training_run_id)
      : this.db
          .query(
            "SELECT 1 FROM result_artifacts ra INNER JOIN training_checkpoints tc ON tc.artifact_id = ra.artifact_id WHERE ra.result_id = ? LIMIT 1",
          )
          .get(id)
    if (!checkpointArtifact) throw new Error(`checkpoint selection requires linked checkpoint artifact: ${id}`)
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
    this.assertFullTrainingResultHasMetricsAndReproduction(id)
    this.assertCheckpointSelectionHasCheckpointArtifact(id)
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

  rebuildFromEvents(eventsPath = this.eventsPath): void {
    const parsed = readJsonlEvents(eventsPath)
    this.inTransaction(() => {
      this.resetProjectionTables()
      this.upsertProjectionStatus(null, null, 0, this.timestamp())
      for (const item of parsed) {
        this.applyParsedEvent(item)
      }
    })
  }

  applyEvent(event: ResearchJsonlEvent): void {
    this.inTransaction(() => {
      this.applyParsedEvent({ line: 0, event })
    })
  }

  getProjectionStatus(): ResearchProjectionStatus {
    const row = this.db
      .query("SELECT projection_name, last_event_id, last_event_timestamp, applied_count, rebuilt_at, updated_at FROM research_projection WHERE projection_name = ?")
      .get(RESEARCH_PROJECTION_NAME) as ResearchProjectionRow | null
    if (!row) {
      return {
        projection_name: RESEARCH_PROJECTION_NAME,
        last_event_id: null,
        last_event_timestamp: null,
        applied_count: 0,
        rebuilt_at: null,
        updated_at: null,
      }
    }
    return row
  }

  checkProjectionIntegrity(eventsPath = this.eventsPath): ResearchProjectionIntegrity {
    if (!existsSync(eventsPath)) {
      const status = this.getProjectionStatus()
      const projectedRows = this.countProjectedRows()
      return status.applied_count === 0 && projectedRows === 0
        ? { ok: true, stale: false }
        : { ok: false, stale: true, reason: "event log missing", last_event_id: status.last_event_id ?? undefined, pending_count: projectedRows }
    }

    let parsed: ParsedJsonlEvent[]
    try {
      parsed = readJsonlEvents(eventsPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const match = message.match(/line (\d+)/)
      return { ok: false, stale: false, reason: message, corrupted_line: match ? Number(match[1]) : undefined }
    }

    for (const item of parsed) {
      const normalized = normalizeResearchEvent(item.event)
      if (!normalized.research) continue
      if (!normalized.supported) {
        return {
          ok: false,
          stale: false,
          reason: `unsupported research event: ${normalized.eventType}`,
          unsupported_event_type: normalized.eventType,
        }
      }
    }

    const researchEvents = parsed.filter((item) => normalizeResearchEvent(item.event).research)
    const status = this.getProjectionStatus()
    if (!status.updated_at) return { ok: false, stale: true, reason: "missing projection metadata", pending_count: researchEvents.length }
    if (!status.last_event_id) {
      return researchEvents.length === 0
        ? { ok: true, stale: false }
        : { ok: false, stale: true, reason: "projection has no cursor", pending_count: researchEvents.length }
    }
    const cursorIndex = researchEvents.findIndex((item) => String(item.event.event_id) === status.last_event_id)
    if (cursorIndex < 0) return { ok: false, stale: true, reason: "last_event_id not found in events log", last_event_id: status.last_event_id }
    const pendingCount = researchEvents.length - cursorIndex - 1
    if (pendingCount > 0) {
      return { ok: false, stale: true, reason: "events exist after projection cursor", last_event_id: status.last_event_id, pending_count: pendingCount }
    }
    return { ok: true, stale: false, last_event_id: status.last_event_id, pending_count: 0 }
  }

  resetProjection(): void {
    this.inTransaction(() => {
      this.resetProjectionTables()
      this.upsertProjectionStatus(null, null, 0, this.timestamp())
    })
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

      CREATE TABLE IF NOT EXISTS training_runs (
        training_run_id TEXT PRIMARY KEY,
        trial_id TEXT,
        candidate_id TEXT,
        hypothesis_id TEXT,
        mission_id TEXT,
        label TEXT NOT NULL CHECK (label IN ('probe', 'smoke_test', 'full_training', 'evaluation', 'ablation', 'debug_run')),
        status TEXT NOT NULL CHECK (status IN ('planned', 'starting', 'running', 'paused', 'completed', 'failed', 'cancelled')),
        pid INTEGER,
        process_group_id INTEGER,
        log_path TEXT,
        metrics_path TEXT,
        checkpoint_dir TEXT,
        latest_checkpoint_id TEXT,
        last_step INTEGER,
        last_metric_json TEXT,
        reproduction_json TEXT,
        started_at TEXT,
        last_observed_at TEXT,
        completed_at TEXT,
        input_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS training_checkpoints (
        checkpoint_id TEXT PRIMARY KEY,
        training_run_id TEXT NOT NULL REFERENCES training_runs(training_run_id) ON DELETE CASCADE,
        artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
        step INTEGER,
        metric_json TEXT,
        observed_at TEXT NOT NULL,
        created_at TEXT NOT NULL
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

      CREATE TABLE IF NOT EXISTS research_projection (
        projection_name TEXT PRIMARY KEY,
        last_event_id TEXT,
        last_event_timestamp TEXT,
        applied_count INTEGER NOT NULL,
        rebuilt_at TEXT,
        updated_at TEXT
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
    this.ensureColumn("training_runs", "pid", "INTEGER")
    this.ensureColumn("training_runs", "process_group_id", "INTEGER")
    this.ensureColumn("training_runs", "log_path", "TEXT")
    this.ensureColumn("training_runs", "metrics_path", "TEXT")
    this.ensureColumn("training_runs", "checkpoint_dir", "TEXT")
    this.ensureColumn("training_runs", "latest_checkpoint_id", "TEXT")
    this.ensureColumn("training_runs", "last_step", "INTEGER")
    this.ensureColumn("training_runs", "last_metric_json", "TEXT")
    this.ensureColumn("training_runs", "reproduction_json", "TEXT")
    this.ensureColumn("training_runs", "started_at", "TEXT")
    this.ensureColumn("training_runs", "last_observed_at", "TEXT")
    this.ensureColumn("training_runs", "completed_at", "TEXT")
    this.ensureColumn("training_runs", "input_hash", "TEXT")
    this.backfillLinkEventIds()
    this.backfillInputHashes()
    this.db.query("INSERT OR IGNORE INTO research_schema (version, applied_at) VALUES (?, ?)").run(1, this.timestamp())
  }

  private resetProjectionTables(): void {
    this.db.query("DELETE FROM candidate_evidence").run()
    this.db.query("DELETE FROM training_checkpoints").run()
    this.db.query("DELETE FROM training_runs").run()
    this.db.query("DELETE FROM trials").run()
    this.db.query("DELETE FROM candidates").run()
    this.db.query("DELETE FROM hypotheses").run()
    this.db.query("DELETE FROM result_artifacts").run()
    this.db.query("DELETE FROM result_citations").run()
    this.db.query("DELETE FROM citations").run()
    this.db.query("DELETE FROM research_results").run()
    this.db.query("DELETE FROM artifacts").run()
    this.db.query("DELETE FROM notes").run()
    this.db.query("DELETE FROM sources").run()
    this.db.query("DELETE FROM topics").run()
    this.db.query("DELETE FROM research_events").run()
    this.db.query("DELETE FROM research_projection WHERE projection_name = ?").run(RESEARCH_PROJECTION_NAME)
  }

  private applyParsedEvent(item: ParsedJsonlEvent): void {
    const normalized = normalizeResearchEvent(item.event)
    if (!normalized.research) return
    if (!normalized.supported) throw new Error(`unsupported research event at line ${item.line}: ${normalized.eventType}`)
    const eventId = cleanRequired(normalized.event_id, "event_id")
    const eventType = cleanRequired(normalized.eventType, "event_type")
    const entityType = cleanRequired(normalized.entityType, "entity_type")
    assertAllowed(RESEARCH_ENTITY_TYPES, entityType, "research event entity_type")
    const entityId = cleanRequired(normalized.entityId, "entity_id")
    const timestamp = cleanRequired(normalized.timestamp, "timestamp")
    const payload = redactValue(normalized.payload ?? null)
    const exists = this.db.query("SELECT 1 FROM research_events WHERE event_id = ?").get(eventId)
    if (exists) {
      this.upsertProjectionStatus(eventId, timestamp, this.countProjectedEvents(), null)
      return
    }

    this.applyResearchPayload(eventType, entityType, entityId, payload, timestamp, eventId)
    this.db
      .query("INSERT INTO research_events (event_id, event_type, entity_type, entity_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(eventId, eventType, entityType, entityId, JSON.stringify(payload), timestamp)
    this.upsertProjectionStatus(eventId, timestamp, this.countProjectedEvents(), null)
  }

  private applyResearchPayload(
    eventType: string,
    entityType: ResearchEntityType,
    entityId: string,
    payload: unknown,
    timestamp: string,
    eventId: string,
  ): void {
    switch (eventType) {
      case "topic_created":
        this.applyTopic(payload)
        return
      case "source_added":
        this.applySource(payload)
        return
      case "note_added":
        this.applyNote(payload)
        return
      case "artifact_added":
        this.applyArtifact(payload)
        return
      case "ResearchResultProposed":
      case "ResearchResultAccepted":
        this.applyResearchResult(payload)
        return
      case "ResearchResultRejected":
        this.applyResearchResult(payloadRecord(payload, "result"))
        return
      case "CitationRecorded":
        this.applyCitation(payload)
        return
      case "ResultCitationLinked":
        this.applyResultCitation(payload, eventId)
        return
      case "ResultArtifactLinked":
        this.applyResultArtifact(payload, eventId)
        return
      case "HypothesisCreated":
      case "HypothesisStatusUpdated":
        this.applyHypothesis(payload)
        return
      case "CandidateCreated":
      case "CandidateRanked":
        this.applyCandidate(payload)
        return
      case "CandidateSelected":
      case "CandidateRejected":
      case "CandidatePromotionProposed":
      case "CandidateNeedsMoreEvidence":
        this.applyCandidate(payloadRecord(payload, "candidate"))
        return
      case "CandidatePromoted": {
        const candidate = payloadRecord(payload, "candidate")
        const candidateId = requiredString(candidate, "candidate_id")
        const hasLinkedEvidence = this.db.query("SELECT 1 FROM candidate_evidence WHERE candidate_id = ? LIMIT 1").get(candidateId) != null
        if (!hasLinkedEvidence && !payloadContainsEvidenceIds(payload)) throw new Error(`candidate promotion event has no evidence: ${candidateId}`)
        this.applyCandidate(candidate)
        return
      }
      case "CandidateEvidenceLinked":
        this.applyCandidateEvidence(payload)
        return
      case "TrialPlanned":
      case "TrialStarted":
      case "TrialCompleted":
        this.applyTrial(payload)
        return
      case "TrialFailed":
      case "TrialCancelled":
        this.applyTrial(payloadRecord(payload, "trial"))
        return
      case "TrainingRunPlanned":
      case "TrainingRunStarted":
      case "TrainingProgressObserved":
      case "TrainingRunCompleted":
        this.applyTrainingRun(payload)
        return
      case "TrainingRunFailed":
      case "TrainingRunCancelled":
        this.applyTrainingRun(payloadRecord(payload, "training_run"))
        return
      case "TrainingCheckpointObserved":
        this.applyTrainingCheckpoint(payload)
        return
      case "ReproductionRecipeRecorded":
        this.applyReproductionRecipe(payload, entityId, timestamp)
        return
      default:
        throw new Error(`unsupported research event: ${eventType} (${entityType}:${entityId})`)
    }
  }

  private applyTopic(payload: unknown): void {
    const row = requireRecord(payload, "topic payload")
    const id = requiredString(row, "id")
    const title = requiredString(row, "title")
    const status = requiredString(row, "status")
    assertAllowed(TOPIC_STATUSES, status, "topic status")
    const createdAt = requiredString(row, "created_at")
    const updatedAt = requiredString(row, "updated_at")
    const inputHash = optionalString(row, "input_hash") ?? hashPayload({ title, status })
    this.db
      .query("INSERT OR REPLACE INTO topics (id, title, status, input_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, title, status, inputHash, createdAt, updatedAt)
  }

  private applySource(payload: unknown): void {
    const row = requireRecord(payload, "source payload")
    const id = requiredString(row, "id")
    const topicId = requiredString(row, "topic_id")
    const locator = requiredString(row, "locator")
    const sourceType = requiredString(row, "source_type")
    const status = requiredString(row, "status")
    assertAllowed(SOURCE_TYPES, sourceType, "source type")
    assertAllowed(SOURCE_STATUSES, status, "source status")
    const title = optionalString(row, "title")
    const credibility = optionalString(row, "credibility")
    const createdAt = requiredString(row, "created_at")
    const inputHash =
      optionalString(row, "input_hash") ?? hashPayload({ topic_id: topicId, locator, title, source_type: sourceType, status, credibility })
    this.db
      .query(
        "INSERT OR REPLACE INTO sources (id, topic_id, locator, title, source_type, status, credibility, input_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, topicId, locator, title, sourceType, status, credibility, inputHash, createdAt)
  }

  private applyNote(payload: unknown): void {
    const row = requireRecord(payload, "note payload")
    const id = requiredString(row, "id")
    const topicId = requiredString(row, "topic_id")
    const sourceId = optionalString(row, "source_id")
    const content = requiredString(row, "content")
    const tags = Array.isArray(row.tags) && row.tags.every((tag) => typeof tag === "string") ? row.tags : []
    const createdAt = requiredString(row, "created_at")
    const inputHash = optionalString(row, "input_hash") ?? hashPayload({ topic_id: topicId, source_id: sourceId, content, tags })
    this.db
      .query("INSERT OR REPLACE INTO notes (id, topic_id, source_id, content, tags_json, input_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, topicId, sourceId, content, JSON.stringify(tags), inputHash, createdAt)
  }

  private applyArtifact(payload: unknown): void {
    const row = requireRecord(payload, "artifact payload")
    const id = requiredString(row, "id")
    const topicId = requiredString(row, "topic_id")
    const kind = requiredString(row, "kind")
    assertAllowed(ARTIFACT_KINDS, kind, "artifact kind")
    const path = optionalString(row, "path")
    const content = optionalString(row, "content")
    const artifactType = optionalString(row, "artifact_type")
    if (artifactType !== null) assertAllowed(ARTIFACT_TYPES, artifactType, "artifact type")
    const sha256 = optionalString(row, "sha256")
    const sizeBytes = optionalNumber(row, "size_bytes")
    const producedByMissionId = optionalString(row, "produced_by_mission_id")
    const producedByRunId = optionalString(row, "produced_by_run_id")
    const description = optionalString(row, "description")
    const createdAt = requiredString(row, "created_at")
    const inputHash =
      optionalString(row, "input_hash") ??
      hashPayload(artifactInputHashPayload({ topic_id: topicId, kind, path, content, artifact_type: artifactType, sha256, size_bytes: sizeBytes, produced_by_mission_id: producedByMissionId, produced_by_run_id: producedByRunId, description }))
    this.db
      .query(
        "INSERT OR REPLACE INTO artifacts (id, topic_id, kind, path, content, artifact_type, sha256, size_bytes, produced_by_mission_id, produced_by_run_id, description, input_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        topicId,
        kind,
        path,
        content,
        artifactType,
        sha256,
        sizeBytes,
        producedByMissionId,
        producedByRunId,
        description,
        inputHash,
        createdAt,
      )
  }

  private applyResearchResult(payload: unknown): void {
    const row = requireRecord(payload, "research result payload")
    const resultId = requiredString(row, "result_id")
    const resultType = requiredString(row, "result_type")
    const status = requiredString(row, "status")
    const confidence = requiredString(row, "confidence")
    const createdBy = requiredString(row, "created_by")
    assertAllowed(RESEARCH_RESULT_TYPES, resultType, "research result type")
    assertAllowed(RESEARCH_RESULT_STATUSES, status, "research result status")
    assertAllowed(RESEARCH_RESULT_CONFIDENCES, confidence, "research result confidence")
    assertAllowed(RESEARCH_RESULT_CREATED_BY, createdBy, "research result created_by")
    const label = optionalString(row, "label")
    const title = requiredString(row, "title")
    const summary = requiredString(row, "summary")
    const missionId = optionalString(row, "mission_id")
    const candidateId = optionalString(row, "candidate_id")
    const hypothesisId = optionalString(row, "hypothesis_id")
    const trialId = optionalString(row, "trial_id")
    const trainingRunId = optionalString(row, "training_run_id")
    const metrics = row.metrics ?? null
    const reproduction = row.reproduction ?? null
    const createdAt = requiredString(row, "created_at")
    const updatedAt = requiredString(row, "updated_at")
    const inputHash =
      optionalString(row, "input_hash") ??
      hashPayload({ result_type: resultType, label, title, summary, status, confidence, mission_id: missionId, candidate_id: candidateId, hypothesis_id: hypothesisId, trial_id: trialId, training_run_id: trainingRunId, metrics, reproduction, created_by: createdBy })
    this.db
      .query(
        "INSERT INTO research_results (result_id, result_type, label, title, summary, status, confidence, mission_id, candidate_id, hypothesis_id, trial_id, training_run_id, metrics_json, reproduction_json, created_by, input_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(result_id) DO UPDATE SET result_type = excluded.result_type, label = excluded.label, title = excluded.title, summary = excluded.summary, status = excluded.status, confidence = excluded.confidence, mission_id = excluded.mission_id, candidate_id = excluded.candidate_id, hypothesis_id = excluded.hypothesis_id, trial_id = excluded.trial_id, training_run_id = excluded.training_run_id, metrics_json = excluded.metrics_json, reproduction_json = excluded.reproduction_json, created_by = excluded.created_by, input_hash = excluded.input_hash, created_at = excluded.created_at, updated_at = excluded.updated_at",
      )
      .run(
        resultId,
        resultType,
        label,
        title,
        summary,
        status,
        confidence,
        missionId,
        candidateId,
        hypothesisId,
        trialId,
        trainingRunId,
        JSON.stringify(metrics),
        JSON.stringify(reproduction),
        createdBy,
        inputHash,
        createdAt,
        updatedAt,
      )
  }

  private applyCitation(payload: unknown): void {
    const row = requireRecord(payload, "citation payload")
    const citationId = requiredString(row, "citation_id")
    const sourceType = requiredString(row, "source_type")
    assertAllowed(CITATION_SOURCE_TYPES, sourceType, "citation source type")
    const sourceUri = requiredString(row, "source_uri")
    const title = optionalString(row, "title")
    const quoted = requiredString(row, "quoted_text_or_summary")
    const accessedAt = requiredString(row, "accessed_at")
    const sha256 = optionalString(row, "sha256")
    const metadata = row.metadata ?? null
    const createdAt = requiredString(row, "created_at")
    const inputHash =
      optionalString(row, "input_hash") ??
      hashPayload({ source_type: sourceType, source_uri: sourceUri, title, quoted_text_or_summary: quoted, accessed_at: accessedAt, sha256, metadata })
    this.db
      .query(
        "INSERT OR REPLACE INTO citations (citation_id, source_type, source_uri, title, quoted_text_or_summary, accessed_at, sha256, metadata_json, input_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(citationId, sourceType, sourceUri, title, quoted, accessedAt, sha256, JSON.stringify(metadata), inputHash, createdAt)
  }

  private applyResultCitation(payload: unknown, eventId: string): void {
    const row = requireRecord(payload, "result citation payload")
    const resultId = requiredString(row, "result_id")
    const citationId = requiredString(row, "citation_id")
    const createdAt = requiredString(row, "created_at")
    this.db
      .query("INSERT OR REPLACE INTO result_citations (result_id, citation_id, created_at, link_event_id) VALUES (?, ?, ?, ?)")
      .run(resultId, citationId, createdAt, eventId)
  }

  private applyResultArtifact(payload: unknown, eventId: string): void {
    const row = requireRecord(payload, "result artifact payload")
    const resultId = requiredString(row, "result_id")
    const artifactId = requiredString(row, "artifact_id")
    const createdAt = requiredString(row, "created_at")
    this.db
      .query("INSERT OR REPLACE INTO result_artifacts (result_id, artifact_id, created_at, link_event_id) VALUES (?, ?, ?, ?)")
      .run(resultId, artifactId, createdAt, eventId)
  }

  private applyHypothesis(payload: unknown): void {
    const row = requireRecord(payload, "hypothesis payload")
    const hypothesisId = requiredString(row, "hypothesis_id")
    const claim = requiredString(row, "claim")
    const source = requiredString(row, "source")
    const status = requiredString(row, "status")
    assertAllowed(HYPOTHESIS_STATUSES, status, "hypothesis status")
    const createdAt = requiredString(row, "created_at")
    const updatedAt = requiredString(row, "updated_at")
    const inputHash = optionalString(row, "input_hash") ?? hashPayload({ claim, source, status })
    this.db
      .query(
        "INSERT INTO hypotheses (hypothesis_id, claim, source, status, input_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(hypothesis_id) DO UPDATE SET claim = excluded.claim, source = excluded.source, status = excluded.status, input_hash = excluded.input_hash, created_at = excluded.created_at, updated_at = excluded.updated_at",
      )
      .run(hypothesisId, claim, source, status, inputHash, createdAt, updatedAt)
  }

  private applyCandidate(payload: unknown): void {
    const row = requireRecord(payload, "candidate payload")
    const candidateId = requiredString(row, "candidate_id")
    const hypothesisId = optionalString(row, "hypothesis_id")
    const claim = requiredString(row, "claim")
    const source = requiredString(row, "source")
    const status = requiredString(row, "status")
    assertAllowed(CANDIDATE_STATUSES, status, "candidate status")
    const commanderScore = optionalNumber(row, "commander_score")
    const rankReason = optionalString(row, "rank_reason")
    const createdAt = requiredString(row, "created_at")
    const updatedAt = requiredString(row, "updated_at")
    const inputHash = optionalString(row, "input_hash") ?? hashPayload({ hypothesis_id: hypothesisId, claim, source, status })
    this.db
      .query(
        "INSERT INTO candidates (candidate_id, hypothesis_id, claim, source, status, commander_score, rank_reason, input_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(candidate_id) DO UPDATE SET hypothesis_id = excluded.hypothesis_id, claim = excluded.claim, source = excluded.source, status = excluded.status, commander_score = excluded.commander_score, rank_reason = excluded.rank_reason, input_hash = excluded.input_hash, created_at = excluded.created_at, updated_at = excluded.updated_at",
      )
      .run(candidateId, hypothesisId, claim, source, status, commanderScore, rankReason, inputHash, createdAt, updatedAt)
  }

  private applyCandidateEvidence(payload: unknown): void {
    const row = requireRecord(payload, "candidate evidence payload")
    const candidateId = requiredString(row, "candidate_id")
    const evidenceType = requiredString(row, "evidence_type")
    assertAllowed(CANDIDATE_EVIDENCE_TYPES, evidenceType, "candidate evidence type")
    const evidenceId = requiredString(row, "evidence_id")
    const createdAt = requiredString(row, "created_at")
    this.db
      .query("INSERT OR REPLACE INTO candidate_evidence (candidate_id, evidence_type, evidence_id, created_at) VALUES (?, ?, ?, ?)")
      .run(candidateId, evidenceType, evidenceId, createdAt)
  }

  private applyTrial(payload: unknown): void {
    const row = requireRecord(payload, "trial payload")
    const trialId = requiredString(row, "trial_id")
    const hypothesisId = optionalString(row, "hypothesis_id")
    const candidateId = optionalString(row, "candidate_id")
    const trialKind = requiredString(row, "trial_kind")
    const status = requiredString(row, "status")
    assertAllowed(TRIAL_STATUSES, status, "trial status")
    const config = row.config ?? null
    const startedAt = optionalString(row, "started_at")
    const completedAt = optionalString(row, "completed_at")
    const createdAt = requiredString(row, "created_at")
    const updatedAt = requiredString(row, "updated_at")
    const inputHash = optionalString(row, "input_hash") ?? hashPayload({ hypothesis_id: hypothesisId, candidate_id: candidateId, trial_kind: trialKind, status, config })
    this.db
      .query(
        "INSERT INTO trials (trial_id, hypothesis_id, candidate_id, trial_kind, status, config_json, input_hash, started_at, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(trial_id) DO UPDATE SET hypothesis_id = excluded.hypothesis_id, candidate_id = excluded.candidate_id, trial_kind = excluded.trial_kind, status = excluded.status, config_json = excluded.config_json, input_hash = excluded.input_hash, started_at = excluded.started_at, completed_at = excluded.completed_at, created_at = excluded.created_at, updated_at = excluded.updated_at",
      )
      .run(trialId, hypothesisId, candidateId, trialKind, status, JSON.stringify(config), inputHash, startedAt, completedAt, createdAt, updatedAt)
  }

  private applyTrainingRun(payload: unknown): void {
    const row = requireRecord(payload, "training run payload")
    const trainingRunId = requiredString(row, "training_run_id")
    const label = requiredString(row, "label")
    const status = requiredString(row, "status")
    assertAllowed(TRAINING_RUN_LABELS, label, "training run label")
    assertAllowed(TRAINING_RUN_STATUSES, status, "training run status")
    const trialId = optionalString(row, "trial_id")
    const candidateId = optionalString(row, "candidate_id")
    const hypothesisId = optionalString(row, "hypothesis_id")
    const missionId = optionalString(row, "mission_id")
    const pid = optionalNumber(row, "pid")
    const processGroupId = optionalNumber(row, "process_group_id")
    const logPath = optionalString(row, "log_path")
    const metricsPath = optionalString(row, "metrics_path")
    const checkpointDir = optionalString(row, "checkpoint_dir")
    const latestCheckpointId = optionalString(row, "latest_checkpoint_id")
    const lastStep = optionalNumber(row, "last_step")
    const lastMetric = row.last_metric ?? null
    const reproduction = row.reproduction ?? null
    const startedAt = optionalString(row, "started_at")
    const lastObservedAt = optionalString(row, "last_observed_at")
    const completedAt = optionalString(row, "completed_at")
    const createdAt = requiredString(row, "created_at")
    const updatedAt = requiredString(row, "updated_at")
    const inputHash =
      optionalString(row, "input_hash") ??
      hashPayload({ trial_id: trialId, candidate_id: candidateId, hypothesis_id: hypothesisId, mission_id: missionId, label, status, pid, process_group_id: processGroupId, log_path: logPath, metrics_path: metricsPath, checkpoint_dir: checkpointDir, reproduction })
    this.db
      .query(
        "INSERT INTO training_runs (training_run_id, trial_id, candidate_id, hypothesis_id, mission_id, label, status, pid, process_group_id, log_path, metrics_path, checkpoint_dir, latest_checkpoint_id, last_step, last_metric_json, reproduction_json, started_at, last_observed_at, completed_at, input_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(training_run_id) DO UPDATE SET trial_id = excluded.trial_id, candidate_id = excluded.candidate_id, hypothesis_id = excluded.hypothesis_id, mission_id = excluded.mission_id, label = excluded.label, status = excluded.status, pid = excluded.pid, process_group_id = excluded.process_group_id, log_path = excluded.log_path, metrics_path = excluded.metrics_path, checkpoint_dir = excluded.checkpoint_dir, latest_checkpoint_id = excluded.latest_checkpoint_id, last_step = excluded.last_step, last_metric_json = excluded.last_metric_json, reproduction_json = excluded.reproduction_json, started_at = excluded.started_at, last_observed_at = excluded.last_observed_at, completed_at = excluded.completed_at, input_hash = excluded.input_hash, created_at = excluded.created_at, updated_at = excluded.updated_at",
      )
      .run(trainingRunId, trialId, candidateId, hypothesisId, missionId, label, status, pid, processGroupId, logPath, metricsPath, checkpointDir, latestCheckpointId, lastStep, JSON.stringify(lastMetric), JSON.stringify(reproduction), startedAt, lastObservedAt, completedAt, inputHash, createdAt, updatedAt)
  }

  private applyTrainingCheckpoint(payload: unknown): void {
    const row = requireRecord(payload, "training checkpoint payload")
    const checkpointId = requiredString(row, "checkpoint_id")
    const trainingRunId = requiredString(row, "training_run_id")
    const artifactId = requiredString(row, "artifact_id")
    const step = optionalNumber(row, "step")
    const metric = row.metric ?? null
    const observedAt = requiredString(row, "observed_at")
    const createdAt = requiredString(row, "created_at")
    this.db
      .query("INSERT OR REPLACE INTO training_checkpoints (checkpoint_id, training_run_id, artifact_id, step, metric_json, observed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(checkpointId, trainingRunId, artifactId, step, JSON.stringify(metric), observedAt, createdAt)
    this.db
      .query(
        "UPDATE training_runs SET latest_checkpoint_id = ?, last_step = COALESCE(?, last_step), last_metric_json = COALESCE(?, last_metric_json), last_observed_at = ?, updated_at = ? WHERE training_run_id = ?",
      )
      .run(checkpointId, step, JSON.stringify(metric), observedAt, createdAt, trainingRunId)
  }

  private applyReproductionRecipe(payload: unknown, entityId: string, timestamp: string): void {
    const row = requireRecord(payload, "reproduction payload")
    const trainingRunId = optionalString(row, "training_run_id") ?? entityId
    const reproduction = row.reproduction ?? null
    this.db
      .query("UPDATE training_runs SET reproduction_json = ?, updated_at = ? WHERE training_run_id = ?")
      .run(JSON.stringify(reproduction), timestamp, trainingRunId)
  }

  private upsertProjectionStatus(lastEventId: string | null, lastEventTimestamp: string | null, appliedCount: number, rebuiltAt: string | null): void {
    const updatedAt = this.timestamp()
    this.db
      .query(
        "INSERT INTO research_projection (projection_name, last_event_id, last_event_timestamp, applied_count, rebuilt_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(projection_name) DO UPDATE SET last_event_id = excluded.last_event_id, last_event_timestamp = excluded.last_event_timestamp, applied_count = excluded.applied_count, rebuilt_at = COALESCE(excluded.rebuilt_at, research_projection.rebuilt_at), updated_at = excluded.updated_at",
      )
      .run(RESEARCH_PROJECTION_NAME, lastEventId, lastEventTimestamp, appliedCount, rebuiltAt, updatedAt)
  }

  private countProjectedEvents(): number {
    const row = this.db.query("SELECT COUNT(*) AS count FROM research_events").get() as { count: number }
    return row.count
  }

  private countProjectedRows(): number {
    const tables = [
      "topics",
      "sources",
      "notes",
      "artifacts",
      "research_results",
      "citations",
      "result_citations",
      "result_artifacts",
      "hypotheses",
      "candidates",
      "candidate_evidence",
      "trials",
      "training_runs",
      "training_checkpoints",
      "research_events",
    ]
    return tables.reduce((total, table) => {
      const row = this.db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }
      return total + row.count
    }, 0)
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
    const createdAt = this.timestamp()
    const redactedPayload = redactValue(this.withInputHashForEventPayload(entityType, entityId, payload))
    this.db
      .query(
        "INSERT INTO research_events (event_id, event_type, entity_type, entity_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(eventId, eventType, entityType, entityId, JSON.stringify(redactedPayload), createdAt)
    this.upsertProjectionStatus(eventId, createdAt, this.countProjectedEvents(), null)
    if (this.appendEvents) {
      mkdirSync(dirname(this.eventsPath), { recursive: true })
      appendFileSync(
        this.eventsPath,
        JSON.stringify({
          event_id: eventId,
          timestamp: createdAt,
          kind: "research_event",
          event_type: eventType,
          entity_type: entityType,
          entity_id: entityId,
          payload: redactedPayload,
        }) + "\n",
      )
    }
    return eventId
  }

  private withInputHashForEventPayload(entityType: string, entityId: string, payload: unknown): unknown {
    const inputHash = this.lookupInputHash(entityType, entityId)
    if (!inputHash) return payload
    const appendHash = (value: unknown): unknown => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value
      return { ...(value as Record<string, unknown>), input_hash: inputHash }
    }
    if (
      entityType === "topic" ||
      entityType === "source" ||
      entityType === "note" ||
      entityType === "artifact" ||
      entityType === "research_result" ||
      entityType === "citation" ||
      entityType === "hypothesis" ||
      entityType === "candidate" ||
      entityType === "trial" ||
      entityType === "training_run"
    ) {
      return appendHash(payload)
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload
    const object = payload as Record<string, unknown>
    if (typeof object.result === "object" && object.result !== null && !Array.isArray(object.result)) return { ...object, result: appendHash(object.result) }
    if (typeof object.candidate === "object" && object.candidate !== null && !Array.isArray(object.candidate)) {
      return { ...object, candidate: appendHash(object.candidate) }
    }
    if (typeof object.trial === "object" && object.trial !== null && !Array.isArray(object.trial)) return { ...object, trial: appendHash(object.trial) }
    if (typeof object.training_run === "object" && object.training_run !== null && !Array.isArray(object.training_run)) {
      return { ...object, training_run: appendHash(object.training_run) }
    }
    return payload
  }

  private lookupInputHash(entityType: string, entityId: string): string | null {
    const table = inputHashTableForEntity(entityType)
    if (!table) return null
    const row = this.db.query(`SELECT input_hash FROM ${table.table} WHERE ${table.idColumn} = ?`).get(entityId) as { input_hash: string | null } | null
    return row?.input_hash ?? null
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

  private validateTrainingRunLinks(input: { trialId: string | null; candidateId: string | null; hypothesisId: string | null }): void {
    const trial = input.trialId ? this.getTrial(input.trialId) : null
    if (input.trialId && !trial) throw new Error(`trial not found: ${input.trialId}`)
    const candidate = input.candidateId ? this.getCandidate(input.candidateId) : null
    if (input.candidateId && !candidate) throw new Error(`candidate not found: ${input.candidateId}`)
    if (input.hypothesisId) this.requireHypothesis(input.hypothesisId)
    if (trial?.candidate_id && input.candidateId && trial.candidate_id !== input.candidateId) throw new Error(`trial candidate mismatch: ${input.trialId}`)
    if (trial?.hypothesis_id && input.hypothesisId && trial.hypothesis_id !== input.hypothesisId) throw new Error(`trial hypothesis mismatch: ${input.trialId}`)
    if (candidate?.hypothesis_id && input.hypothesisId && candidate.hypothesis_id !== input.hypothesisId) throw new Error(`candidate hypothesis mismatch: ${input.candidateId}`)
    if (input.candidateId && input.hypothesisId && candidate?.hypothesis_id !== input.hypothesisId) throw new Error(`candidate hypothesis mismatch: ${input.candidateId}`)
  }

  private assertTrainingRunObservable(run: TrainingRun): void {
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      throw new Error(`training run cannot be observed from status: ${run.status}`)
    }
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
    const existing = this.getCandidate(id)
    if (!existing) throw new Error(`candidate not found: ${id}`)
    if (existing.status === "rejected" && status !== "rejected") throw new Error(`candidate already rejected: ${id}`)
    if (existing.status === "promoted" && status !== "promoted") throw new Error(`candidate already promoted: ${id}`)
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

  private finishTrainingRun(trainingRunId: string, status: "failed" | "cancelled", eventType: string, reason?: string): TrainingRun {
    const id = cleanId(trainingRunId)
    const existing = this.getTrainingRun(id)
    if (!existing) throw new Error(`training run not found: ${id}`)
    if (existing.status === "completed" || existing.status === "failed" || existing.status === "cancelled") {
      throw new Error(`training run cannot be ${status} from status: ${existing.status}`)
    }
    const cleanReason = cleanOptional(reason)
    const timestamp = this.timestamp()
    return this.inTransaction(() => {
      this.db.query("UPDATE training_runs SET status = ?, completed_at = ?, updated_at = ? WHERE training_run_id = ?").run(status, timestamp, timestamp, id)
      const run = this.getTrainingRun(id)
      if (!run) throw new Error(`training run not found: ${id}`)
      this.recordEvent(eventType, "training_run", id, { training_run: run, reason: cleanReason ? redactString(cleanReason) : null })
      return run
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

  private trainingRunFromRow(row: TrainingRunRow): TrainingRun
  private trainingRunFromRow(row: TrainingRunRow | null): TrainingRun | null
  private trainingRunFromRow(row: TrainingRunRow | null): TrainingRun | null {
    if (!row) return null
    assertAllowed(TRAINING_RUN_LABELS, row.label, "training run label")
    assertAllowed(TRAINING_RUN_STATUSES, row.status, "training run status")
    return {
      training_run_id: row.training_run_id,
      trial_id: row.trial_id,
      candidate_id: row.candidate_id,
      hypothesis_id: row.hypothesis_id,
      mission_id: row.mission_id,
      label: row.label,
      status: row.status,
      pid: row.pid,
      process_group_id: row.process_group_id,
      log_path: row.log_path,
      metrics_path: row.metrics_path,
      checkpoint_dir: row.checkpoint_dir,
      latest_checkpoint_id: row.latest_checkpoint_id,
      last_step: row.last_step,
      last_metric: parseNullableJson(row.last_metric_json),
      reproduction: parseNullableJson(row.reproduction_json),
      started_at: row.started_at,
      last_observed_at: row.last_observed_at,
      completed_at: row.completed_at,
      input_hash: row.input_hash,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  }

  private trainingCheckpointFromRow(row: TrainingCheckpointRow): TrainingCheckpoint
  private trainingCheckpointFromRow(row: TrainingCheckpointRow | null): TrainingCheckpoint | null
  private trainingCheckpointFromRow(row: TrainingCheckpointRow | null): TrainingCheckpoint | null {
    if (!row) return null
    return {
      checkpoint_id: row.checkpoint_id,
      training_run_id: row.training_run_id,
      artifact_id: row.artifact_id,
      step: row.step,
      metric: parseNullableJson(row.metric_json),
      observed_at: row.observed_at,
      created_at: row.created_at,
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

function cleanOptionalProcessId(value: number | undefined, field: string): number | null {
  if (value === undefined) return null
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${field} must be a positive integer`)
  return value
}

function cleanOptionalStep(value: number | undefined): number | null {
  if (value === undefined) return null
  if (!Number.isInteger(value) || value < 0) throw new Error("step must be a non-negative integer")
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

function readJsonlEvents(eventsPath: string): ParsedJsonlEvent[] {
  if (!existsSync(eventsPath)) return []
  const text = readFileSync(eventsPath, "utf8")
  const events: ParsedJsonlEvent[] = []
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (!line) continue
    try {
      const parsed = JSON.parse(line) as unknown
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("event must be a JSON object")
      events.push({ line: index + 1, event: parsed as ResearchJsonlEvent })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`corrupt JSONL line ${index + 1}: ${message}`)
    }
  }
  return events
}

function normalizeResearchEvent(event: ResearchJsonlEvent): {
  research: boolean
  supported: boolean
  event_id: string
  timestamp: string
  eventType: string
  entityType: string
  entityId: string
  payload: unknown
} {
  const eventType = typeof event.event_type === "string" ? event.event_type : typeof event.type === "string" ? event.type : ""
  const entityType = typeof event.entity_type === "string" ? event.entity_type : ""
  const entityId = typeof event.entity_id === "string" ? event.entity_id : ""
  const isResearchKind = event.kind === "research_event" || event.kind === "research_db_event" || entityType === "research_event"
  const isResearchDomain = eventType !== "" && (SUPPORTED_RESEARCH_EVENT_TYPES.has(eventType) || entityType !== "")
  const research = isResearchKind || (isResearchDomain && RESEARCH_ENTITY_TYPES.has(entityType as ResearchEntityType))
  return {
    research,
    supported: eventType !== "" && SUPPORTED_RESEARCH_EVENT_TYPES.has(eventType) && RESEARCH_ENTITY_TYPES.has(entityType as ResearchEntityType),
    event_id: typeof event.event_id === "string" ? event.event_id : "",
    timestamp: typeof event.timestamp === "string" ? event.timestamp : "",
    eventType,
    entityType,
    entityId,
    payload: event.payload,
  }
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function payloadRecord(payload: unknown, key: string): Record<string, unknown> {
  const row = requireRecord(payload, `${key} payload`)
  return requireRecord(row[key], `${key} payload`)
}

function payloadContainsEvidenceIds(payload: unknown): boolean {
  const row = requireRecord(payload, "candidate promotion payload")
  return Array.isArray(row.evidence_ids) && row.evidence_ids.some((id) => typeof id === "string" && id.trim() !== "")
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} is required`)
  return value
}

function optionalString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key]
  if (value === undefined || value === null) return null
  if (typeof value !== "string") throw new Error(`${key} must be a string`)
  return value
}

function optionalNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key]
  if (value === undefined || value === null) return null
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} must be a number`)
  return value
}

function inputHashTableForEntity(entityType: string): { table: string; idColumn: string } | null {
  switch (entityType) {
    case "topic":
      return { table: "topics", idColumn: "id" }
    case "source":
      return { table: "sources", idColumn: "id" }
    case "note":
      return { table: "notes", idColumn: "id" }
    case "artifact":
      return { table: "artifacts", idColumn: "id" }
    case "research_result":
      return { table: "research_results", idColumn: "result_id" }
    case "citation":
      return { table: "citations", idColumn: "citation_id" }
    case "hypothesis":
      return { table: "hypotheses", idColumn: "hypothesis_id" }
    case "candidate":
      return { table: "candidates", idColumn: "candidate_id" }
    case "trial":
      return { table: "trials", idColumn: "trial_id" }
    case "training_run":
      return { table: "training_runs", idColumn: "training_run_id" }
    default:
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
    payload: publicResearchEventPayload(JSON.parse(row.payload_json) as unknown),
    created_at: row.created_at,
  }
}

function publicResearchEventPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload
  const object = { ...(payload as Record<string, unknown>) }
  delete object.input_hash
  for (const key of ["result", "candidate", "trial", "training_run"]) {
    const nested = object[key]
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const nestedObject = { ...(nested as Record<string, unknown>) }
      delete nestedObject.input_hash
      object[key] = nestedObject
    }
  }
  return object
}
