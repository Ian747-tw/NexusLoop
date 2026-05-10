import { createHash, randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { Database } from "bun:sqlite"
import { redactValue } from "../security/redaction"

export type TopicStatus = "open" | "active" | "paused" | "closed"
export type SourceStatus = "new" | "reviewed" | "rejected"
export type SourceType = "url" | "file" | "paper" | "note" | "artifact" | "other"
export type ArtifactKind = "artifact" | "report" | "log" | "dataset" | "snapshot" | "other"

const TOPIC_STATUSES = new Set<TopicStatus>(["open", "active", "paused", "closed"])
const SOURCE_STATUSES = new Set<SourceStatus>(["new", "reviewed", "rejected"])
const SOURCE_TYPES = new Set<SourceType>(["url", "file", "paper", "note", "artifact", "other"])
const ARTIFACT_KINDS = new Set<ArtifactKind>(["artifact", "report", "log", "dataset", "snapshot", "other"])

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
}

export interface Artifact {
  id: string
  topic_id: string
  kind: ArtifactKind
  path: string | null
  content: string | null
  created_at: string
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
    researchDb.migrate()
    return researchDb
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
    const tags = input.tags ?? []
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
    const inputHash = hashPayload({ topic_id: topicId, kind: input.kind, path, content })
    const redactedPath = path ? redactString(path) : null
    const redactedContent = content ? redactString(content) : null
    const createdAt = this.timestamp()
    return this.inTransaction(() => {
      const existing = this.db.query("SELECT * FROM artifacts WHERE id = ?").get(id) as ArtifactRow | null
      if (existing) {
        if (existing.input_hash === inputHash) return this.getArtifact(id) as Artifact
        throw new Error(`artifact id collision: ${id}`)
      }
      this.db
        .query("INSERT INTO artifacts (id, topic_id, kind, path, content, input_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(id, topicId, input.kind, redactedPath, redactedContent, inputHash, createdAt)
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
      .query("SELECT id, topic_id, kind, path, content, created_at FROM artifacts WHERE topic_id = ? ORDER BY created_at, id")
      .all(id) as Artifact[]
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
        input_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        CHECK (path IS NOT NULL OR content IS NOT NULL)
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
    return this.db.query("SELECT id, topic_id, kind, path, content, created_at FROM artifacts WHERE id = ?").get(id) as Artifact | null
  }

  private backfillInputHashes(): void {
    for (const row of this.db.query("SELECT id, title, status, input_hash FROM topics").all() as TopicRow[]) {
      const inputHash = row.input_hash ?? hashPayload({ title: row.title, status: row.status })
      this.db.query("UPDATE topics SET title = ?, input_hash = ? WHERE id = ?").run(redactString(row.title), inputHash, row.id)
    }

    for (const row of this.db
      .query("SELECT id, topic_id, locator, title, source_type, status, credibility, input_hash, created_at FROM sources")
      .all() as SourceRow[]) {
      const inputHash =
        row.input_hash ??
        hashPayload({
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
      .query("SELECT id, topic_id, source_id, content, tags_json, input_hash, created_at FROM notes")
      .all() as NoteRow[]) {
      const inputHash = row.input_hash ?? hashPayload({ topic_id: row.topic_id, source_id: row.source_id, content: row.content, tags: parseTags(row.tags_json) })
      this.db
        .query("UPDATE notes SET content = ?, tags_json = ?, input_hash = ? WHERE id = ?")
        .run(redactString(row.content), JSON.stringify(redactValue(parseTags(row.tags_json))), inputHash, row.id)
    }

    for (const row of this.db
      .query("SELECT id, topic_id, kind, path, content, input_hash, created_at FROM artifacts")
      .all() as ArtifactRow[]) {
      const inputHash = row.input_hash ?? hashPayload({ topic_id: row.topic_id, kind: row.kind, path: row.path, content: row.content })
      this.db
        .query("UPDATE artifacts SET path = ?, content = ?, input_hash = ? WHERE id = ?")
        .run(redactNullable(row.path), redactNullable(row.content), inputHash, row.id)
    }
  }

  private recordEvent(eventType: string, entityType: string, entityId: string, payload: unknown): void {
    this.db
      .query(
        "INSERT INTO research_events (event_id, event_type, entity_type, entity_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(randomUUID(), eventType, entityType, entityId, JSON.stringify(redactValue(payload)), this.timestamp())
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

  private noteFromRow(row: NoteRow): Note
  private noteFromRow(row: NoteRow | null): Note | null
  private noteFromRow(row: NoteRow | null): Note | null {
    if (!row) return null
    return { id: row.id, topic_id: row.topic_id, source_id: row.source_id, content: row.content, tags: parseTags(row.tags_json), created_at: row.created_at }
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

function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
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
