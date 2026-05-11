import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { ResearchDb } from "./research-db"

const cleanup: string[] = []

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nxl-research-db-"))
  cleanup.push(dir)
  return dir
}

function openTestDb(projectDir: string): ResearchDb {
  let next = 1
  return ResearchDb.open(projectDir, {
    now: () => new Date("2026-05-10T12:00:00Z"),
    idFactory: () => `id_${next++}`,
  })
}

function openSequencedTestDb(projectDir: string): ResearchDb {
  let nextId = 1
  let nextMs = 0
  return ResearchDb.open(projectDir, {
    now: () => new Date(Date.UTC(2026, 4, 10, 12, 0, 0, nextMs++)),
    idFactory: () => `id_${nextId++}`,
  })
}

afterEach(async () => {
  while (cleanup.length) await rm(cleanup.pop()!, { recursive: true, force: true })
})

describe("ResearchDb", () => {
  test("creates DB and schema from empty directory", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    const dbPath = join(dir, ".nxl", "research.db")

    expect(existsSync(dbPath)).toBe(true)
    expect(db.getTopic("missing")).toBeNull()
    db.close()

    const sqlite = new Database(dbPath)
    try {
      const tables = sqlite
        .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => String((row as { name: string }).name))
      expect(tables).toContain("topics")
      expect(tables).toContain("sources")
      expect(tables).toContain("notes")
      expect(tables).toContain("artifacts")
      expect(tables).toContain("research_events")
    } finally {
      sqlite.close()
    }
  })

  test("open closes sqlite handle when migration fails", async () => {
    const dir = await tempProject()
    await mkdir(join(dir, ".nxl"), { recursive: true })
    const dbPath = join(dir, ".nxl", "research.db")
    const sqlite = new Database(dbPath)
    try {
      sqlite.exec("CREATE TABLE topics (id TEXT PRIMARY KEY)")
    } finally {
      sqlite.close()
    }

    expect(() => openTestDb(dir)).toThrow()

    const retry = new Database(dbPath)
    try {
      expect(() => retry.exec("DROP TABLE topics")).not.toThrow()
    } finally {
      retry.close()
    }
  })

  test("create list and get topic", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)

    const topic = db.createTopic({ id: "topic_1", title: "Evaluate retrieval", status: "active" })

    expect(topic.id).toBe("topic_1")
    expect(topic.status).toBe("active")
    expect(db.getTopic("topic_1")).toEqual(topic)
    expect(db.listTopics()).toEqual([topic])
    db.close()
  })

  test("add and list sources", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })

    const source = db.addSource({
      id: "source_1",
      topic_id: "topic_1",
      locator: "https://example.test/paper",
      title: "Paper",
      source_type: "url",
      status: "reviewed",
      credibility: "primary",
    })

    expect(db.listSourcesForTopic("topic_1")).toEqual([source])
    expect(db.listSourcesForTopic(" topic_1 ")).toEqual([source])
    db.close()
  })

  test("add and list notes", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })
    db.addSource({ id: "source_1", topic_id: "topic_1", locator: "file://source.md", source_type: "file" })

    const note = db.addNote({ id: "note_1", topic_id: "topic_1", source_id: "source_1", content: "Useful finding", tags: ["probe", "finding"] })

    expect(note.tags).toEqual(["probe", "finding"])
    expect(db.listNotesForTopic("topic_1")).toEqual([note])
    expect(db.listNotesForTopic(" topic_1 ")).toEqual([note])
    db.close()
  })

  test("add report artifact", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })

    const report = db.addArtifact({ id: "report_1", topic_id: "topic_1", kind: "report", content: " Final summary " })

    expect(report.kind).toBe("report")
    expect(report.content).toBe("Final summary")
    expect(db.listArtifactsForTopic("topic_1")).toEqual([report])
    expect(db.listArtifactsForTopic(" topic_1 ")).toEqual([report])
    db.close()
  })

  test("rejects source and note for missing topic", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)

    expect(() => db.addSource({ topic_id: "missing", locator: "https://example.test", source_type: "url" })).toThrow("topic not found")
    expect(() => db.addNote({ topic_id: "missing", content: "note" })).toThrow("topic not found")
    db.close()
  })

  test("repeated open does not destroy existing data", async () => {
    const dir = await tempProject()
    const first = openTestDb(dir)
    first.createTopic({ id: "topic_1", title: "Durable topic" })
    first.close()

    const second = openTestDb(dir)
    expect(second.getTopic("topic_1")?.title).toBe("Durable topic")
    second.close()
  })

  test("migrates legacy rows with input fingerprints for idempotent explicit IDs", async () => {
    const dir = await tempProject()
    await mkdir(join(dir, ".nxl"), { recursive: true })
    const sqlite = new Database(join(dir, ".nxl", "research.db"), { create: true })
    try {
      sqlite.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE topics (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE sources (
          id TEXT PRIMARY KEY,
          topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
          locator TEXT NOT NULL,
          title TEXT,
          source_type TEXT NOT NULL,
          status TEXT NOT NULL,
          credibility TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE notes (
          id TEXT PRIMARY KEY,
          topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
          source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
          content TEXT NOT NULL,
          tags_json TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE artifacts (
          id TEXT PRIMARY KEY,
          topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          path TEXT,
          content TEXT,
          created_at TEXT NOT NULL,
          CHECK (path IS NOT NULL OR content IS NOT NULL)
        );
        INSERT INTO topics VALUES ('topic_legacy', 'Legacy topic', 'open', '2026-05-10T12:00:00.000Z', '2026-05-10T12:00:00.000Z');
        INSERT INTO sources VALUES ('source_legacy', 'topic_legacy', 'file://legacy.md', 'Legacy source', 'file', 'new', 'primary', '2026-05-10T12:00:00.000Z');
        INSERT INTO notes VALUES ('note_legacy', 'topic_legacy', 'source_legacy', 'Legacy note', '["legacy"]', '2026-05-10T12:00:00.000Z');
        INSERT INTO artifacts VALUES ('artifact_legacy', 'topic_legacy', 'report', NULL, 'Legacy report', '2026-05-10T12:00:00.000Z');
      `)
    } finally {
      sqlite.close()
    }

    const db = openTestDb(dir)
    expect(db.createTopic({ id: "topic_legacy", title: "Legacy topic" }).id).toBe("topic_legacy")
    expect(
      db.addSource({
        id: "source_legacy",
        topic_id: "topic_legacy",
        locator: "file://legacy.md",
        title: "Legacy source",
        source_type: "file",
        credibility: "primary",
      }).id,
    ).toBe("source_legacy")
    expect(db.addNote({ id: "note_legacy", topic_id: "topic_legacy", source_id: "source_legacy", content: "Legacy note", tags: ["legacy"] }).id).toBe(
      "note_legacy",
    )
    expect(db.addArtifact({ id: "artifact_legacy", topic_id: "topic_legacy", kind: "report", content: "Legacy report" }).id).toBe("artifact_legacy")
    db.close()
  })

  test("malformed legacy note tags do not abort open or backfill", async () => {
    const dir = await tempProject()
    await mkdir(join(dir, ".nxl"), { recursive: true })
    const sqlite = new Database(join(dir, ".nxl", "research.db"))
    try {
      sqlite.exec(`
        CREATE TABLE topics (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE notes (
          id TEXT PRIMARY KEY,
          topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
          source_id TEXT,
          content TEXT NOT NULL,
          tags_json TEXT,
          created_at TEXT NOT NULL
        );
        INSERT INTO topics VALUES ('topic_1', 'Topic', 'open', '2026-05-10T12:00:00.000Z', '2026-05-10T12:00:00.000Z');
        INSERT INTO notes VALUES ('note_1', 'topic_1', NULL, 'Legacy note', 'not-json', '2026-05-10T12:00:00.000Z');
      `)
    } finally {
      sqlite.close()
    }

    const reopened = openTestDb(dir)
    expect(reopened.listNotesForTopic("topic_1")[0]?.tags).toEqual([])
    reopened.close()
  })

  test("migration redacts secret-looking legacy row content", async () => {
    const dir = await tempProject()
    await mkdir(join(dir, ".nxl"), { recursive: true })
    const dbPath = join(dir, ".nxl", "research.db")
    const sqlite = new Database(dbPath)
    try {
      sqlite.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE topics (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE sources (
          id TEXT PRIMARY KEY,
          topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
          locator TEXT NOT NULL,
          title TEXT,
          source_type TEXT NOT NULL,
          status TEXT NOT NULL,
          credibility TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE notes (
          id TEXT PRIMARY KEY,
          topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
          source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
          content TEXT NOT NULL,
          tags_json TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE artifacts (
          id TEXT PRIMARY KEY,
          topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          path TEXT,
          content TEXT,
          created_at TEXT NOT NULL,
          CHECK (path IS NOT NULL OR content IS NOT NULL)
        );
        INSERT INTO topics VALUES ('topic_secret', 'token=topicSecret123', 'open', '2026-05-10T12:00:00.000Z', '2026-05-10T12:00:00.000Z');
        INSERT INTO sources VALUES ('source_secret', 'topic_secret', 'token=sourceSecret123', 'api_key=sourceTitle123', 'file', 'new', 'secret=credSecret123', '2026-05-10T12:00:00.000Z');
        INSERT INTO notes VALUES ('note_secret', 'topic_secret', 'source_secret', 'password=noteSecret123', '["token=tagSecret123"]', '2026-05-10T12:00:00.000Z');
        INSERT INTO artifacts VALUES ('artifact_secret', 'topic_secret', 'report', 'secret=pathSecret123', 'sk-artifactSecret123', '2026-05-10T12:00:00.000Z');
      `)
    } finally {
      sqlite.close()
    }

    const db = openTestDb(dir)
    const returned = JSON.stringify({
      topic: db.getTopic("topic_secret"),
      sources: db.listSourcesForTopic("topic_secret"),
      notes: db.listNotesForTopic("topic_secret"),
      artifacts: db.listArtifactsForTopic("topic_secret"),
    })
    db.close()

    const migrated = new Database(dbPath)
    try {
      const raw = JSON.stringify({
        topics: migrated.query("SELECT * FROM topics").all(),
        sources: migrated.query("SELECT * FROM sources").all(),
        notes: migrated.query("SELECT * FROM notes").all(),
        artifacts: migrated.query("SELECT * FROM artifacts").all(),
      })

      for (const serialized of [returned, raw]) {
        expect(serialized).not.toContain("topicSecret123")
        expect(serialized).not.toContain("sourceSecret123")
        expect(serialized).not.toContain("sourceTitle123")
        expect(serialized).not.toContain("credSecret123")
        expect(serialized).not.toContain("noteSecret123")
        expect(serialized).not.toContain("tagSecret123")
        expect(serialized).not.toContain("pathSecret123")
        expect(serialized).not.toContain("artifactSecret123")
        expect(serialized).toContain("[REDACTED]")
      }
    } finally {
      migrated.close()
    }
  })

  test("repeated open does not rewrite rows that already have fingerprints", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })
    db.close()

    const dbPath = join(dir, ".nxl", "research.db")
    const sqlite = new Database(dbPath)
    try {
      sqlite.exec(`
        CREATE TRIGGER fail_repeated_topic_update
        BEFORE UPDATE ON topics
        BEGIN
          SELECT RAISE(ABORT, 'unexpected repeated rewrite');
        END;
      `)
    } finally {
      sqlite.close()
    }

    const reopened = openTestDb(dir)
    expect(reopened.getTopic("topic_1")?.title).toBe("Topic")
    reopened.close()
  })

  test("duplicate explicit IDs are idempotent", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)

    const first = db.createTopic({ id: "topic_1", title: "Same topic" })
    const second = db.createTopic({ id: "topic_1", title: "Same topic" })

    expect(second).toEqual(first)
    expect(db.listTopics()).toHaveLength(1)
    db.close()

    const sqlite = new Database(join(dir, ".nxl", "research.db"))
    try {
      const count = sqlite.query("SELECT COUNT(*) AS count FROM research_events WHERE event_type = 'topic_created'").get() as { count: number }
      expect(count.count).toBe(1)
    } finally {
      sqlite.close()
    }
  })

  test("duplicate explicit IDs fail on conflicting payloads", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Same topic" })
    db.createTopic({ id: "topic_2", title: "Other topic" })
    db.addSource({ id: "source_1", topic_id: "topic_1", locator: "https://example.test/a", source_type: "url" })
    db.addNote({ id: "note_1", topic_id: "topic_1", content: "original" })
    db.addArtifact({ id: "artifact_1", topic_id: "topic_1", kind: "report", content: "original" })

    expect(() => db.createTopic({ id: "topic_1", title: "Different topic" })).toThrow("topic id collision")
    expect(() => db.addSource({ id: "source_1", topic_id: "topic_2", locator: "https://example.test/b", source_type: "url" })).toThrow(
      "source id collision",
    )
    expect(() => db.addNote({ id: "note_1", topic_id: "topic_1", content: "changed" })).toThrow("note id collision")
    expect(() => db.addArtifact({ id: "artifact_1", topic_id: "topic_1", kind: "report", content: "changed" })).toThrow(
      "artifact id collision",
    )
    db.close()
  })

  test("duplicate explicit IDs detect collisions before redaction", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.createTopic({ id: "topic_secret", title: "token=alpha123" })
    db.createTopic({ id: "topic_1", title: "Topic" })
    db.addSource({ id: "source_secret", topic_id: "topic_1", locator: "token=alpha123", source_type: "url" })
    db.addNote({ id: "note_secret", topic_id: "topic_1", content: "token=alpha123" })
    db.addArtifact({ id: "artifact_secret", topic_id: "topic_1", kind: "report", content: "token=alpha123" })

    expect(() => db.createTopic({ id: "topic_secret", title: "token=beta456" })).toThrow("topic id collision")
    expect(() => db.addSource({ id: "source_secret", topic_id: "topic_1", locator: "token=beta456", source_type: "url" })).toThrow(
      "source id collision",
    )
    expect(() => db.addNote({ id: "note_secret", topic_id: "topic_1", content: "token=beta456" })).toThrow("note id collision")
    expect(() => db.addArtifact({ id: "artifact_secret", topic_id: "topic_1", kind: "report", content: "token=beta456" })).toThrow(
      "artifact id collision",
    )
    db.close()
  })

  test("domain writes roll back when event append fails", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    const sqlite = new Database(join(dir, ".nxl", "research.db"))
    try {
      sqlite.exec(`
        CREATE TRIGGER fail_research_event_insert
        BEFORE INSERT ON research_events
        BEGIN
          SELECT RAISE(ABORT, 'forced event failure');
        END;
      `)

      expect(() => db.createTopic({ id: "topic_rollback", title: "Rollback topic" })).toThrow("forced event failure")
      expect(db.getTopic("topic_rollback")).toBeNull()
    } finally {
      sqlite.close()
      db.close()
    }
  })

  test("transaction wrapper preserves the original sqlite failure when rollback already happened", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    const sqlite = new Database(join(dir, ".nxl", "research.db"))
    try {
      sqlite.exec(`
        CREATE TRIGGER rollback_research_event_insert
        BEFORE INSERT ON research_events
        BEGIN
          SELECT RAISE(ROLLBACK, 'forced rollback failure');
        END;
      `)

      expect(() => db.createTopic({ id: "topic_rollback", title: "Rollback topic" })).toThrow("forced rollback failure")
      expect(db.getTopic("topic_rollback")).toBeNull()
    } finally {
      sqlite.close()
      db.close()
    }
  })

  test("event IDs are independent from injected entity id factory", async () => {
    const dir = await tempProject()
    const db = ResearchDb.open(dir, {
      now: () => new Date("2026-05-10T12:00:00Z"),
      idFactory: () => "reused_entity_id",
    })

    db.createTopic({ id: "topic_1", title: "First topic" })
    db.createTopic({ id: "topic_2", title: "Second topic" })

    expect(db.listTopics().map((topic) => topic.id)).toEqual(["topic_1", "topic_2"])
    db.close()
  })

  test("invalid input fails loudly", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })

    expect(() => db.createTopic({ id: " ", title: "Topic" })).toThrow("id is required")
    expect(() => db.createTopic({ title: " " })).toThrow("title is required")
    expect(() => db.createTopic({ title: "Topic", status: "bad" as never })).toThrow("invalid topic status")
    expect(() => db.addSource({ topic_id: "topic_1", locator: "x", source_type: "bad" as never })).toThrow("invalid source type")
    expect(() => db.addSource({ topic_id: "topic_1", locator: "x", source_type: "url", status: "bad" as never })).toThrow("invalid source status")
    expect(() => db.addNote({ topic_id: "topic_1", content: "note", tags: ["ok", 1] as never })).toThrow("invalid note tags")
    expect(() => db.addArtifact({ topic_id: "topic_1", kind: "bad" as never, content: "x" })).toThrow("invalid artifact kind")
    expect(() => db.addArtifact({ topic_id: "topic_1", kind: "report" })).toThrow("artifact requires path or content")
    expect(() => db.addArtifact({ topic_id: "topic_1", kind: "report", content: "   " })).toThrow("artifact requires path or content")
    expect(() => db.addArtifact({ topic_id: "topic_1", kind: "report", path: "   " })).toThrow("artifact requires path or content")
    db.close()
  })

  test("redacts secret-looking strings before storing or returning", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.createTopic({ id: "topic_1", title: "sk-test-SECRET123456789" })

    const note = db.addNote({
      id: "note_1",
      topic_id: "topic_1",
      content: "Bearer abc.def.ghi12345 and token=plainsecret",
      tags: ["api_key=hidden"],
    })

    const serialized = JSON.stringify({ topic: db.getTopic("topic_1"), note })
    expect(serialized).not.toContain("sk-test-SECRET123456789")
    expect(serialized).not.toContain("Bearer abc.def.ghi12345")
    expect(serialized).not.toContain("plainsecret")
    expect(serialized).toContain("[REDACTED]")
    db.close()
  })

  test("lists research events for all entity kinds in stable order", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)

    db.createTopic({ id: "topic_1", title: "Topic" })
    db.addSource({ id: "source_1", topic_id: "topic_1", locator: "file://source.md", source_type: "file" })
    db.addNote({ id: "note_1", topic_id: "topic_1", content: "Useful finding" })
    db.addArtifact({ id: "artifact_1", topic_id: "topic_1", kind: "report", content: "Report" })

    const events = db.listResearchEvents()

    expect(events.map((event) => event.entity_type)).toEqual(["topic", "source", "note", "artifact"])
    expect(events.map((event) => event.event_type)).toEqual(["topic_created", "source_added", "note_added", "artifact_added"])
    expect(events.map((event) => event.payload)).toEqual([
      db.getTopic("topic_1"),
      db.listSourcesForTopic("topic_1")[0],
      db.listNotesForTopic("topic_1")[0],
      db.listArtifactsForTopic("topic_1")[0],
    ])
    expect(JSON.stringify(events)).not.toContain("payload_json")
    db.close()
  })

  test("filters research events by entity type entity id and event type", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })
    db.addSource({ id: "source_1", topic_id: "topic_1", locator: "file://source.md", source_type: "file" })
    db.addNote({ id: "note_1", topic_id: "topic_1", content: "Useful finding" })

    expect(db.listResearchEvents({ entity_type: "source" }).map((event) => event.entity_id)).toEqual(["source_1"])
    expect(db.listResearchEvents({ entity_id: " note_1 " }).map((event) => event.event_type)).toEqual(["note_added"])
    expect(db.listResearchEvents({ event_type: " source_added " }).map((event) => event.entity_type)).toEqual(["source"])
    expect(() => db.listResearchEvents({ entity_type: "bad" as never })).toThrow("invalid research event entity_type")
    expect(() => db.listResearchEvents({ entity_id: " " })).toThrow("entity_id is required")
    expect(() => db.listResearchEvents({ event_type: " " })).toThrow("event_type is required")
    db.close()
  })

  test("lists research events strictly after an event id", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })
    db.addSource({ id: "source_1", topic_id: "topic_1", locator: "file://source.md", source_type: "file" })
    db.addNote({ id: "note_1", topic_id: "topic_1", content: "Useful finding" })

    const all = db.listResearchEvents()
    const afterFirst = db.listResearchEvents({ after_event_id: all[0]!.event_id })

    expect(afterFirst.map((event) => event.event_type)).toEqual(["source_added", "note_added"])
    expect(() => db.listResearchEvents({ after_event_id: " " })).toThrow("after_event_id is required")
    expect(() => db.listResearchEvents({ after_event_id: "missing" })).toThrow("research event not found: missing")
    db.close()
  })

  test("paginates same-timestamp research events without losing UUID tie-breakers", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })
    db.addSource({ id: "source_1", topic_id: "topic_1", locator: "file://source.md", source_type: "file" })
    db.addNote({ id: "note_1", topic_id: "topic_1", content: "Useful finding" })
    db.addArtifact({ id: "artifact_1", topic_id: "topic_1", kind: "report", content: "Report" })

    const seen: string[] = []
    let after_event_id: string | undefined
    for (let i = 0; i < 4; i++) {
      const page = db.listResearchEvents({ after_event_id, limit: 1 })
      expect(page).toHaveLength(1)
      seen.push(page[0]!.event_type)
      after_event_id = page[0]!.event_id
    }

    expect(seen).toEqual(["topic_created", "source_added", "note_added", "artifact_added"])
    expect(db.listResearchEvents({ after_event_id, limit: 1 })).toEqual([])
    db.close()
  })

  test("caps and validates research event limits", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)
    for (let i = 0; i < 505; i++) db.createTopic({ id: `topic_${i}`, title: `Topic ${i}` })

    expect(db.listResearchEvents({ limit: 2 })).toHaveLength(2)
    expect(db.listResearchEvents({ limit: 999 })).toHaveLength(500)
    expect(() => db.listResearchEvents({ limit: 0 })).toThrow("limit must be a positive integer")
    expect(() => db.listResearchEvents({ limit: 1.5 })).toThrow("limit must be a positive integer")
    db.close()
  })

  test("returns topic snapshot with related records stats and latest event", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)
    const topic = db.createTopic({ id: "topic_1", title: "Topic" })
    const reviewed = db.addSource({ id: "source_1", topic_id: "topic_1", locator: "file://source.md", source_type: "file", status: "reviewed" })
    const rejected = db.addSource({ id: "source_2", topic_id: "topic_1", locator: "file://rejected.md", source_type: "file", status: "rejected" })
    const note = db.addNote({ id: "note_1", topic_id: "topic_1", source_id: "source_1", content: "Useful finding" })
    const artifact = db.addArtifact({ id: "artifact_1", topic_id: "topic_1", kind: "artifact", content: "Artifact" })
    const report = db.addArtifact({ id: "report_1", topic_id: "topic_1", kind: "report", content: "Report" })

    const snapshot = db.getTopicSnapshot(" topic_1 ")

    expect(snapshot).toEqual({
      topic,
      sources: [reviewed, rejected],
      notes: [note],
      artifacts: [artifact, report],
      stats: {
        source_count: 2,
        note_count: 1,
        artifact_count: 2,
        report_count: 1,
        reviewed_source_count: 1,
        rejected_source_count: 1,
      },
      latest_event: expect.objectContaining({ event_type: "artifact_added", entity_id: "report_1" }),
    })
    db.close()
  })

  test("topic snapshot latest event uses insertion order for same-timestamp events", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })
    db.addSource({ id: "source_1", topic_id: "topic_1", locator: "file://source.md", source_type: "file" })
    db.addNote({ id: "note_1", topic_id: "topic_1", content: "Useful finding" })
    db.addArtifact({ id: "artifact_1", topic_id: "topic_1", kind: "report", content: "Report" })

    expect(db.getTopicSnapshot("topic_1")?.latest_event).toEqual(expect.objectContaining({ event_type: "artifact_added", entity_id: "artifact_1" }))
    db.close()
  })

  test("topic snapshot returns null for missing topic", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)

    expect(db.getTopicSnapshot("missing")).toBeNull()
    expect(() => db.getTopicSnapshot(" ")).toThrow("id is required")
    db.close()
  })

  test("searches topics with trimmed query and validates blank query", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)
    const alpha = db.createTopic({ id: "topic_alpha", title: "Alpha retrieval" })
    db.createTopic({ id: "topic_beta", title: "Beta planning" })
    const another = db.createTopic({ id: "topic_another", title: "Another alpha result" })

    expect(db.searchTopics(" alpha ")).toEqual([alpha, another])
    expect(db.searchTopics("alpha", { limit: 1 })).toEqual([alpha])
    expect(db.searchTopics("alpha", { limit: 999 })).toEqual([alpha, another])
    expect(() => db.searchTopics(" ")).toThrow("query is required")
    expect(() => db.searchTopics("alpha", { limit: -1 })).toThrow("limit must be a positive integer")
    db.close()
  })

  test("searches notes for an existing topic with trimmed query and validates inputs", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })
    db.createTopic({ id: "topic_2", title: "Other topic" })
    const contentMatch = db.addNote({ id: "note_content", topic_id: "topic_1", content: "Alpha finding", tags: ["probe"] })
    const tagMatch = db.addNote({ id: "note_tag", topic_id: "topic_1", content: "Different content", tags: ["alpha-tag"] })
    db.addNote({ id: "note_other_topic", topic_id: "topic_2", content: "Alpha elsewhere" })

    expect(db.searchNotes(" topic_1 ", " alpha ")).toEqual([contentMatch, tagMatch])
    expect(db.searchNotes("topic_1", "alpha", { limit: 1 })).toEqual([contentMatch])
    expect(() => db.searchNotes("topic_1", " ")).toThrow("query is required")
    expect(() => db.searchNotes("missing", "alpha")).toThrow("topic not found: missing")
    expect(() => db.searchNotes("topic_1", "alpha", { limit: 0 })).toThrow("limit must be a positive integer")
    db.close()
  })

  test("new read APIs preserve redaction", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)
    db.createTopic({ id: "topic_secret", title: "token=topicSecret123" })
    db.addSource({ id: "source_secret", topic_id: "topic_secret", locator: "secret=sourceSecret123", source_type: "file" })
    db.addNote({ id: "note_secret", topic_id: "topic_secret", content: "password=noteSecret123", tags: ["api_key=tagSecret123"] })
    db.addArtifact({ id: "artifact_secret", topic_id: "topic_secret", kind: "report", content: "sk-artifactSecret123456" })

    const serialized = JSON.stringify({
      events: db.listResearchEvents(),
      snapshot: db.getTopicSnapshot("topic_secret"),
      topics: db.searchTopics("[REDACTED]"),
      notes: db.searchNotes("topic_secret", "[REDACTED]"),
    })

    expect(serialized).not.toContain("topicSecret123")
    expect(serialized).not.toContain("sourceSecret123")
    expect(serialized).not.toContain("noteSecret123")
    expect(serialized).not.toContain("tagSecret123")
    expect(serialized).not.toContain("artifactSecret123456")
    expect(serialized).toContain("[REDACTED]")
    db.close()
  })

  test("creates typed result citation and link tables on empty DB", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.close()

    const sqlite = new Database(join(dir, ".nxl", "research.db"))
    try {
      const tables = sqlite
        .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => String((row as { name: string }).name))
      expect(tables).toContain("research_results")
      expect(tables).toContain("citations")
      expect(tables).toContain("result_citations")
      expect(tables).toContain("result_artifacts")
    } finally {
      sqlite.close()
    }
  })

  test("propose accept and reject research results write events", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)

    const result = db.proposeResearchResult({
      result_id: "result_1",
      result_type: "probe_result",
      title: "Probe passed",
      summary: "The bounded probe completed.",
      confidence: "medium",
      mission_id: "mission_1",
      created_by: "executor",
    })
    const accepted = db.acceptResearchResult(" result_1 ")
    const rejected = db.rejectResearchResult("result_1", "Superseded by better evidence")

    expect(result.status).toBe("proposed")
    expect(accepted.status).toBe("accepted")
    expect(rejected.status).toBe("rejected")
    expect(db.getResearchResult("result_1")?.status).toBe("rejected")
    expect(db.listResearchEvents({ entity_type: "research_result" }).map((event) => event.event_type)).toEqual([
      "ResearchResultProposed",
      "ResearchResultAccepted",
      "ResearchResultRejected",
    ])
    db.close()
  })

  test("duplicate explicit result ID is idempotent only for same pre-redaction payload", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    const input = {
      result_id: "result_secret",
      result_type: "probe_result" as const,
      title: "token=alpha123",
      summary: "same summary",
      confidence: "low" as const,
      created_by: "commander" as const,
    }

    const first = db.proposeResearchResult(input)
    const second = db.proposeResearchResult(input)

    expect(second).toEqual(first)
    expect(() => db.proposeResearchResult({ ...input, title: "token=beta456" })).toThrow("research result id collision")
    db.close()
  })

  test("record citation writes row and event", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)

    const citation = db.recordCitation({
      citation_id: "citation_1",
      source_type: "url",
      source_uri: "https://example.test/paper",
      title: "Reference",
      quoted_text_or_summary: "Supports the result.",
      metadata: { section: "2" },
    })

    expect(db.getCitation("citation_1")).toEqual(citation)
    expect(db.searchCitations({ source_type: "url" })).toEqual([citation])
    expect(db.listResearchEvents({ entity_type: "citation" }).map((event) => event.event_type)).toEqual(["CitationRecorded"])
    db.close()
  })

  test("result citation and artifact links are idempotent", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })
    const result = db.proposeResearchResult({
      result_id: "result_1",
      result_type: "finding",
      title: "Finding",
      summary: "Supported result",
      confidence: "high",
      created_by: "verifier",
    })
    const citation = db.recordCitation({
      citation_id: "citation_1",
      source_type: "paper",
      source_uri: "doi:10.0000/example",
      quoted_text_or_summary: "Paper summary",
    })
    const artifact = db.addArtifact({ id: "artifact_1", topic_id: "topic_1", kind: "log", content: "log", produced_by_mission_id: "mission_1" })

    const citationLink = db.linkResultCitation(" result_1 ", " citation_1 ")
    const artifactLink = db.linkResultArtifact("result_1", "artifact_1")

    expect(db.linkResultCitation("result_1", "citation_1")).toEqual(citationLink)
    expect(db.linkResultArtifact("result_1", "artifact_1")).toEqual(artifactLink)
    expect(db.listResultCitations(result.result_id)).toEqual([citation])
    expect(db.listResultArtifacts(result.result_id)).toEqual([artifact])
    expect(db.listResearchEvents({ entity_type: "result_citation" })).toHaveLength(1)
    expect(db.listResearchEvents({ entity_type: "result_artifact" })).toHaveLength(1)
    db.close()
  })

  test("accepting evidence-required result requires citation or artifact evidence", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.proposeResearchResult({
      result_id: "finding_1",
      result_type: "finding",
      title: "Finding",
      summary: "Needs evidence",
      confidence: "high",
      created_by: "commander",
    })

    expect(() => db.acceptResearchResult("finding_1")).toThrow("requires linked citation or artifact evidence")

    db.recordCitation({
      citation_id: "citation_1",
      source_type: "file",
      source_uri: "file://evidence.md",
      quoted_text_or_summary: "Evidence summary",
    })
    db.linkResultCitation("finding_1", "citation_1")

    expect(db.acceptResearchResult("finding_1").status).toBe("accepted")
    db.close()
  })

  test("accepting checkpoint selection requires linked evidence", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })
    db.proposeResearchResult({
      result_id: "checkpoint_1",
      result_type: "checkpoint_selection",
      title: "Select checkpoint",
      summary: "Checkpoint selected from candidate run.",
      confidence: "high",
      created_by: "verifier",
    })

    expect(() => db.acceptResearchResult("checkpoint_1")).toThrow("checkpoint selection requires linked checkpoint artifact")

    db.planTrainingRun({ training_run_id: "training_1", label: "full_training" })
    db.addArtifact({ id: "artifact_1", topic_id: "topic_1", kind: "snapshot", content: "checkpoint metadata" })
    db.recordTrainingCheckpoint({ checkpoint_id: "checkpoint_artifact_link", training_run_id: "training_1", artifact_id: "artifact_1" })
    db.linkResultArtifact("checkpoint_1", "artifact_1")

    expect(db.acceptResearchResult("checkpoint_1").status).toBe("accepted")
    db.close()
  })

  test("accepting evaluation result requires linked evidence", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.proposeResearchResult({
      result_id: "evaluation_1",
      result_type: "evaluation_result",
      title: "Evaluation result",
      summary: "Evaluation completed.",
      confidence: "medium",
      created_by: "verifier",
    })

    expect(() => db.acceptResearchResult("evaluation_1")).toThrow("requires linked citation or artifact evidence")

    db.recordCitation({
      citation_id: "citation_1",
      source_type: "file",
      source_uri: "file://evaluation.md",
      quoted_text_or_summary: "Evaluation evidence summary",
    })
    db.linkResultCitation("evaluation_1", "citation_1")

    expect(db.acceptResearchResult("evaluation_1").status).toBe("accepted")
    db.close()
  })

  test("accepting full training result requires linked evidence", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })
    db.proposeResearchResult({
      result_id: "training_1",
      result_type: "full_training_result",
      title: "Full training result",
      summary: "Training completed.",
      confidence: "medium",
      metrics: { loss: 0.25 },
      reproduction: { command: "bun train" },
      created_by: "executor",
    })

    expect(() => db.acceptResearchResult("training_1")).toThrow("requires linked citation or artifact evidence")

    db.addArtifact({ id: "artifact_1", topic_id: "topic_1", kind: "log", content: "training log" })
    db.linkResultArtifact("training_1", "artifact_1")

    expect(db.acceptResearchResult("training_1").status).toBe("accepted")
    db.close()
  })

  test("accepting an already accepted result is idempotent", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)
    db.proposeResearchResult({
      result_id: "result_1",
      result_type: "probe_result",
      title: "Probe",
      summary: "Accepted once",
      confidence: "medium",
      created_by: "executor",
    })

    const first = db.acceptResearchResult("result_1")
    const second = db.acceptResearchResult("result_1")

    expect(second).toEqual(first)
    expect(db.listResearchEvents({ event_type: "ResearchResultAccepted" })).toHaveLength(1)
    db.close()
  })

  test("artifact recording preserves the existing artifact_added event type", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })

    db.addArtifact({ id: "artifact_1", topic_id: "topic_1", kind: "report", content: "Report", description: "metadata" })

    expect(db.listResearchEvents({ entity_type: "artifact" }).map((event) => event.event_type)).toEqual(["artifact_added"])
    db.close()
  })

  test("result citation and artifact payloads are redacted before storage and return", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })

    const result = db.proposeResearchResult({
      result_id: "result_secret",
      result_type: "implementation_change",
      title: "token=resultSecret123",
      summary: "password=summarySecret123",
      confidence: "medium",
      metrics: { token: "metricSecret123" },
      reproduction: { command: "API_KEY=reproSecret123 bun test" },
      created_by: "executor",
    })
    const citation = db.recordCitation({
      citation_id: "citation_secret",
      source_type: "url",
      source_uri: "https://example.test/?token=citationSecret123",
      quoted_text_or_summary: "secret=citationSummary123",
      metadata: { bearer: "Bearer citationMetadata123" },
    })
    const artifact = db.addArtifact({
      id: "artifact_secret",
      topic_id: "topic_1",
      kind: "report",
      content: "sk-artifactSecret123456",
      description: "token=artifactDescription123",
    })

    const serialized = JSON.stringify({ result, citation, artifact, events: db.listResearchEvents() })
    expect(serialized).not.toContain("resultSecret123")
    expect(serialized).not.toContain("summarySecret123")
    expect(serialized).not.toContain("metricSecret123")
    expect(serialized).not.toContain("reproSecret123")
    expect(serialized).not.toContain("citationSecret123")
    expect(serialized).not.toContain("citationSummary123")
    expect(serialized).not.toContain("citationMetadata123")
    expect(serialized).not.toContain("artifactSecret123456")
    expect(serialized).not.toContain("artifactDescription123")
    expect(serialized).toContain("[REDACTED]")
    db.close()
  })

  test("mission and research-result write barriers report missing evidence", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })

    expect(db.canCompleteMission("mission_1")).toEqual({ ok: false, reason: "mission has no result evidence: mission_1" })
    expect(() => db.assertMissionHasResultEvidence("mission_1")).toThrow("mission has no result evidence")

    db.proposeResearchResult({
      result_id: "result_1",
      result_type: "probe_result",
      title: "Probe",
      summary: "Mission evidence",
      confidence: "medium",
      mission_id: "mission_1",
      created_by: "executor",
    })
    expect(db.canCompleteMission("mission_1")).toEqual({ ok: true })

    expect(db.canCompleteMission("mission_2")).toEqual({ ok: false, reason: "mission has no result evidence: mission_2" })
    db.addArtifact({ id: "artifact_1", topic_id: "topic_1", kind: "log", content: "log", produced_by_mission_id: "mission_2" })
    expect(db.canCompleteMission("mission_2")).toEqual({ ok: true })
    db.close()
  })

  test("migration from DB without typed result tables succeeds", async () => {
    const dir = await tempProject()
    await mkdir(join(dir, ".nxl"), { recursive: true })
    const sqlite = new Database(join(dir, ".nxl", "research.db"))
    try {
      sqlite.exec(`
        CREATE TABLE topics (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          input_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO topics VALUES ('topic_1', 'Topic', 'open', 'legacy-hash', '2026-05-10T12:00:00.000Z', '2026-05-10T12:00:00.000Z');
      `)
    } finally {
      sqlite.close()
    }

    const db = openTestDb(dir)
    expect(db.getTopic("topic_1")?.title).toBe("Topic")
    expect(db.searchResearchResults()).toEqual([])
    expect(db.searchCitations()).toEqual([])
    db.close()
  })

  test("upgraded artifacts keep idempotent explicit ID compatibility with old hashes", async () => {
    const dir = await tempProject()
    await mkdir(join(dir, ".nxl"), { recursive: true })
    const oldArtifactHash = createHash("sha256")
      .update(JSON.stringify({ topic_id: "topic_1", kind: "report", path: null, content: "Legacy report" }))
      .digest("hex")
    const sqlite = new Database(join(dir, ".nxl", "research.db"))
    try {
      sqlite.exec(`
        CREATE TABLE topics (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          input_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE artifacts (
          id TEXT PRIMARY KEY,
          topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          path TEXT,
          content TEXT,
          input_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          CHECK (path IS NOT NULL OR content IS NOT NULL)
        );
        INSERT INTO topics VALUES ('topic_1', 'Topic', 'open', 'legacy-topic-hash', '2026-05-10T12:00:00.000Z', '2026-05-10T12:00:00.000Z');
      `)
      sqlite
        .query("INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run("artifact_legacy", "topic_1", "report", null, "Legacy report", oldArtifactHash, "2026-05-10T12:00:00.000Z")
    } finally {
      sqlite.close()
    }

    const db = openTestDb(dir)
    expect(db.addArtifact({ id: "artifact_legacy", topic_id: "topic_1", kind: "report", content: "Legacy report" }).id).toBe("artifact_legacy")
    db.close()
  })

  test("citation explicit ID retry is idempotent when accessed_at is generated", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)
    const input = {
      citation_id: "citation_1",
      source_type: "url" as const,
      source_uri: "https://example.test",
      quoted_text_or_summary: "Evidence",
    }

    const first = db.recordCitation(input)
    const second = db.recordCitation(input)

    expect(second).toEqual(first)
    expect(db.searchCitations()).toHaveLength(1)
    expect(() => db.recordCitation({ ...input, quoted_text_or_summary: "Different evidence" })).toThrow("citation id collision")
    db.close()
  })

  test("citation explicit ID retry accepts returned generated accessed_at", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)

    const first = db.recordCitation({
      citation_id: "citation_1",
      source_type: "url",
      source_uri: "https://example.test",
      quoted_text_or_summary: "Evidence",
    })
    const second = db.recordCitation({
      citation_id: first.citation_id,
      source_type: first.source_type,
      source_uri: first.source_uri,
      title: first.title ?? undefined,
      quoted_text_or_summary: first.quoted_text_or_summary,
      accessed_at: first.accessed_at,
      sha256: first.sha256 ?? undefined,
      metadata: first.metadata,
    })

    expect(second).toEqual(first)
    expect(db.searchCitations()).toHaveLength(1)
    db.close()
  })

  test("typed result write rolls back when event append fails", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    const sqlite = new Database(join(dir, ".nxl", "research.db"))
    try {
      sqlite.exec(`
        CREATE TRIGGER fail_research_result_event_insert
        BEFORE INSERT ON research_events
        WHEN NEW.event_type = 'ResearchResultProposed'
        BEGIN
          SELECT RAISE(ABORT, 'forced typed event failure');
        END;
      `)

      expect(() =>
        db.proposeResearchResult({
          result_id: "result_rollback",
          result_type: "probe_result",
          title: "Rollback",
          summary: "Rollback",
          confidence: "low",
          created_by: "system",
        }),
      ).toThrow("forced typed event failure")
      expect(db.getResearchResult("result_rollback")).toBeNull()
    } finally {
      sqlite.close()
      db.close()
    }
  })

  test("citation and link writes roll back when event append fails", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })
    db.proposeResearchResult({
      result_id: "result_1",
      result_type: "probe_result",
      title: "Probe",
      summary: "Probe",
      confidence: "medium",
      created_by: "executor",
    })
    db.recordCitation({
      citation_id: "citation_1",
      source_type: "url",
      source_uri: "https://example.test",
      quoted_text_or_summary: "Evidence",
    })
    db.addArtifact({ id: "artifact_1", topic_id: "topic_1", kind: "log", content: "Log" })

    const sqlite = new Database(join(dir, ".nxl", "research.db"))
    try {
      sqlite.exec(`
        CREATE TRIGGER fail_citation_event_insert
        BEFORE INSERT ON research_events
        WHEN NEW.event_type IN ('CitationRecorded', 'ResultCitationLinked', 'ResultArtifactLinked')
        BEGIN
          SELECT RAISE(ABORT, 'forced citation/link event failure');
        END;
      `)

      expect(() =>
        db.recordCitation({
          citation_id: "citation_rollback",
          source_type: "file",
          source_uri: "file://rollback.md",
          quoted_text_or_summary: "Rollback",
        }),
      ).toThrow("forced citation/link event failure")
      expect(db.getCitation("citation_rollback")).toBeNull()

      expect(() => db.linkResultCitation("result_1", "citation_1")).toThrow("forced citation/link event failure")
      expect(db.listResultCitations("result_1")).toEqual([])

      expect(() => db.linkResultArtifact("result_1", "artifact_1")).toThrow("forced citation/link event failure")
      expect(db.listResultArtifacts("result_1")).toEqual([])
    } finally {
      sqlite.close()
      db.close()
    }
  })

  test("creates hypotheses candidates trials and candidate evidence tables on empty DB", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.close()

    const sqlite = new Database(join(dir, ".nxl", "research.db"))
    try {
      const tables = sqlite
        .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => String((row as { name: string }).name))
      expect(tables).toContain("hypotheses")
      expect(tables).toContain("candidates")
      expect(tables).toContain("trials")
      expect(tables).toContain("candidate_evidence")
    } finally {
      sqlite.close()
    }
  })

  test("Branch 4A DB opens after candidate projection migration", async () => {
    const dir = await tempProject()
    await mkdir(join(dir, ".nxl"), { recursive: true })
    const sqlite = new Database(join(dir, ".nxl", "research.db"))
    try {
      sqlite.exec(`
        CREATE TABLE topics (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          input_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE research_results (
          result_id TEXT PRIMARY KEY,
          result_type TEXT NOT NULL,
          label TEXT,
          title TEXT NOT NULL,
          summary TEXT NOT NULL,
          status TEXT NOT NULL,
          confidence TEXT NOT NULL,
          mission_id TEXT,
          candidate_id TEXT,
          hypothesis_id TEXT,
          trial_id TEXT,
          training_run_id TEXT,
          metrics_json TEXT,
          reproduction_json TEXT,
          created_by TEXT NOT NULL,
          input_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE citations (
          citation_id TEXT PRIMARY KEY,
          source_type TEXT NOT NULL,
          source_uri TEXT NOT NULL,
          title TEXT,
          quoted_text_or_summary TEXT NOT NULL,
          accessed_at TEXT NOT NULL,
          sha256 TEXT,
          metadata_json TEXT,
          input_hash TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE research_events (
          event_id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `)
    } finally {
      sqlite.close()
    }

    const db = openTestDb(dir)
    expect(db.searchHypotheses()).toEqual([])
    expect(db.searchCandidates()).toEqual([])
    expect(db.searchTrials()).toEqual([])
    db.close()
  })

  test("creates hypotheses with event and explicit ID idempotency", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    const input = { hypothesis_id: "hypothesis_1", claim: "token=alpha123", source: "Commander note" }

    const first = db.createHypothesis(input)
    const second = db.createHypothesis(input)

    expect(second).toEqual(first)
    expect(db.getHypothesis(" hypothesis_1 ")).toEqual(first)
    expect(db.listResearchEvents({ entity_type: "hypothesis" }).map((event) => event.event_type)).toEqual(["HypothesisCreated"])
    expect(() => db.createHypothesis({ ...input, claim: "token=beta456" })).toThrow("hypothesis id collision")
    expect(JSON.stringify(first)).not.toContain("alpha123")
    db.close()
  })

  test("updates hypothesis status with validation and event", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.createHypothesis({ hypothesis_id: "hypothesis_1", claim: "Claim", source: "Source" })

    const updated = db.updateHypothesisStatus("hypothesis_1", "paused")

    expect(updated.status).toBe("paused")
    expect(() => db.updateHypothesisStatus("hypothesis_1", "bad" as never)).toThrow("invalid hypothesis status")
    expect(db.listResearchEvents({ event_type: "HypothesisStatusUpdated" })).toHaveLength(1)
    db.close()
  })

  test("creates candidates with optional hypothesis link and explicit ID collision protection", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.createHypothesis({ hypothesis_id: "hypothesis_1", claim: "Hypothesis", source: "Source" })
    const input = { candidate_id: "candidate_1", hypothesis_id: "hypothesis_1", claim: "Candidate", source: "Commander" }

    const first = db.createCandidate(input)
    const second = db.createCandidate(input)
    const standalone = db.createCandidate({ candidate_id: "candidate_2", claim: "Standalone", source: "Commander" })

    expect(second).toEqual(first)
    expect(first.hypothesis_id).toBe("hypothesis_1")
    expect(standalone.hypothesis_id).toBeNull()
    expect(db.listResearchEvents({ entity_type: "candidate" }).map((event) => event.event_type)).toEqual(["CandidateCreated", "CandidateCreated"])
    expect(() => db.createCandidate({ ...input, claim: "Different" })).toThrow("candidate id collision")
    expect(() => db.createCandidate({ candidate_id: "candidate_promoted", claim: "Promoted", source: "Commander", status: "promoted" })).toThrow(
      "candidate cannot be created as promoted",
    )
    expect(() => db.createCandidate({ candidate_id: "candidate_missing", hypothesis_id: "missing", claim: "Candidate", source: "Source" })).toThrow(
      "hypothesis not found",
    )
    db.close()
  })

  test("candidate ranking selection rejection and needs-more-evidence write events", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)
    db.createCandidate({ candidate_id: "candidate_1", claim: "Candidate", source: "Commander" })

    expect(() => db.rankCandidate({ candidate_id: "candidate_1", commander_score: Number.NaN, rank_reason: "reason" })).toThrow(
      "commander_score must be a finite number",
    )
    expect(() => db.rankCandidate({ candidate_id: "candidate_1", commander_score: 0.5, rank_reason: " " })).toThrow("rank_reason is required")

    const ranked = db.rankCandidate({ candidate_id: "candidate_1", commander_score: 0.8, rank_reason: "Promising evidence" })
    const selected = db.selectCandidate("candidate_1")
    const needsEvidence = db.markCandidateNeedsMoreEvidence("candidate_1", "Needs citation")
    const rejected = db.rejectCandidate("candidate_1", "Weak result")

    expect(ranked.commander_score).toBe(0.8)
    expect(ranked.rank_reason).toBe("Promising evidence")
    expect(selected.status).toBe("active")
    expect(needsEvidence.status).toBe("needs_more_evidence")
    expect(rejected.status).toBe("rejected")
    expect(() => db.selectCandidate("candidate_1")).toThrow("candidate already rejected: candidate_1")
    expect(() => db.markCandidateNeedsMoreEvidence("candidate_1")).toThrow("candidate already rejected: candidate_1")
    expect(db.getCandidate("candidate_1")!.status).toBe("rejected")
    expect(db.listResearchEvents({ entity_type: "candidate" }).map((event) => event.event_type)).toEqual([
      "CandidateCreated",
      "CandidateRanked",
      "CandidateSelected",
      "CandidateNeedsMoreEvidence",
      "CandidateRejected",
    ])
    db.close()
  })

  test("links candidate evidence for research results citations artifacts and events idempotently", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })
    db.createCandidate({ candidate_id: "candidate_1", claim: "Candidate", source: "Commander" })
    db.proposeResearchResult({
      result_id: "result_1",
      result_type: "probe_result",
      title: "Probe",
      summary: "Probe",
      confidence: "medium",
      created_by: "executor",
    })
    db.recordCitation({ citation_id: "citation_1", source_type: "file", source_uri: "file://evidence.md", quoted_text_or_summary: "Evidence" })
    db.addArtifact({ id: "artifact_1", topic_id: "topic_1", kind: "log", content: "Evidence" })
    const eventId = db.listResearchEvents({ entity_type: "research_result" })[0]!.event_id

    const resultLink = db.linkCandidateEvidence(" candidate_1 ", "research_result", " result_1 ")
    const citationLink = db.linkCandidateEvidence("candidate_1", "citation", "citation_1")
    const artifactLink = db.linkCandidateEvidence("candidate_1", "artifact", "artifact_1")
    const eventLink = db.linkCandidateEvidence("candidate_1", "event", eventId)

    expect(db.linkCandidateEvidence("candidate_1", "research_result", "result_1")).toEqual(resultLink)
    expect(db.listCandidateEvidence("candidate_1")).toEqual([resultLink, citationLink, artifactLink, eventLink])
    expect(db.listResearchEvents({ entity_type: "candidate_evidence" })).toHaveLength(4)
    db.close()
  })

  test("event evidence link validation preserves IDs containing colons", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })
    db.createCandidate({ candidate_id: "candidate_1", claim: "Candidate", source: "Commander" })
    db.proposeResearchResult({
      result_id: "result:1",
      result_type: "probe_result",
      title: "Probe",
      summary: "Probe",
      confidence: "medium",
      created_by: "executor",
    })
    db.recordCitation({ citation_id: "citation:1", source_type: "file", source_uri: "file://evidence.md", quoted_text_or_summary: "Evidence" })
    db.addArtifact({ id: "artifact:1", topic_id: "topic_1", kind: "log", content: "Evidence" })
    db.linkResultCitation("result:1", "citation:1")
    db.linkResultArtifact("result:1", "artifact:1")
    const citationEvent = db.listResearchEvents({ event_type: "ResultCitationLinked" })[0]!.event_id
    const artifactEvent = db.listResearchEvents({ event_type: "ResultArtifactLinked" })[0]!.event_id

    expect(db.linkCandidateEvidence("candidate_1", "event", citationEvent).evidence_id).toBe(citationEvent)
    expect(db.linkCandidateEvidence("candidate_1", "event", artifactEvent).evidence_id).toBe(artifactEvent)
    db.close()
  })

  test("event evidence validation uses keyed link payloads instead of ambiguous entity ids", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })
    db.createCandidate({ candidate_id: "candidate_1", claim: "Candidate", source: "Commander" })
    db.proposeResearchResult({
      result_id: "result:valid",
      result_type: "probe_result",
      title: "Valid probe",
      summary: "Valid probe",
      confidence: "medium",
      created_by: "executor",
    })
    db.proposeResearchResult({
      result_id: "result",
      result_type: "probe_result",
      title: "Rejected probe",
      summary: "Rejected probe",
      confidence: "medium",
      created_by: "executor",
    })
    db.recordCitation({ citation_id: "citation", source_type: "file", source_uri: "file://citation.md", quoted_text_or_summary: "Evidence" })
    db.recordCitation({ citation_id: "valid:citation", source_type: "file", source_uri: "file://stale.md", quoted_text_or_summary: "Stale evidence" })
    db.addArtifact({ id: "artifact", topic_id: "topic_1", kind: "log", content: "Evidence" })
    db.addArtifact({ id: "valid:artifact", topic_id: "topic_1", kind: "log", content: "Stale evidence" })

    db.linkResultCitation("result:valid", "citation")
    db.linkResultCitation("result", "valid:citation")
    db.linkResultArtifact("result:valid", "artifact")
    db.linkResultArtifact("result", "valid:artifact")
    db.rejectResearchResult("result")

    const citationEvents = db.listResearchEvents({ event_type: "ResultCitationLinked" })
    const artifactEvents = db.listResearchEvents({ event_type: "ResultArtifactLinked" })
    const validCitationEvent = citationEvents.find((event) => (event.payload as { result_id?: unknown }).result_id === "result:valid")!.event_id
    const rejectedCitationEvent = citationEvents.find((event) => (event.payload as { result_id?: unknown }).result_id === "result")!.event_id
    const validArtifactEvent = artifactEvents.find((event) => (event.payload as { result_id?: unknown }).result_id === "result:valid")!.event_id
    const rejectedArtifactEvent = artifactEvents.find((event) => (event.payload as { result_id?: unknown }).result_id === "result")!.event_id

    expect(() => db.linkCandidateEvidence("candidate_1", "event", rejectedCitationEvent)).toThrow("research event evidence not found")
    expect(() => db.linkCandidateEvidence("candidate_1", "event", rejectedArtifactEvent)).toThrow("research event evidence not found")
    expect(db.linkCandidateEvidence("candidate_1", "event", validCitationEvent).evidence_id).toBe(validCitationEvent)
    expect(db.linkCandidateEvidence("candidate_1", "event", validArtifactEvent).evidence_id).toBe(validArtifactEvent)
    db.close()
  })

  test("event evidence validation survives redacted link event payload ids", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })
    db.createCandidate({ candidate_id: "candidate_1", claim: "Candidate", source: "Commander" })
    db.proposeResearchResult({
      result_id: "token=resultSecret123",
      result_type: "probe_result",
      title: "Probe",
      summary: "Probe",
      confidence: "medium",
      created_by: "executor",
    })
    db.recordCitation({ citation_id: "sk-citationSecret123", source_type: "file", source_uri: "file://evidence.md", quoted_text_or_summary: "Evidence" })
    db.addArtifact({ id: "sk-artifactSecret123", topic_id: "topic_1", kind: "log", content: "Evidence" })
    db.linkResultCitation("token=resultSecret123", "sk-citationSecret123")
    db.linkResultArtifact("token=resultSecret123", "sk-artifactSecret123")
    const citationEvent = db.listResearchEvents({ event_type: "ResultCitationLinked" })[0]!
    const artifactEvent = db.listResearchEvents({ event_type: "ResultArtifactLinked" })[0]!

    expect(JSON.stringify(citationEvent.payload)).toContain("[REDACTED]")
    expect(JSON.stringify(artifactEvent.payload)).toContain("[REDACTED]")
    expect(db.linkCandidateEvidence("candidate_1", "event", citationEvent.event_id).evidence_id).toBe(citationEvent.event_id)
    expect(db.linkCandidateEvidence("candidate_1", "event", artifactEvent.event_id).evidence_id).toBe(artifactEvent.event_id)
    db.close()
  })

  test("migration backfills legacy link event ids when payload ids were redacted", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })
    db.proposeResearchResult({
      result_id: "token=resultSecret123",
      result_type: "probe_result",
      title: "Probe",
      summary: "Probe",
      confidence: "medium",
      created_by: "executor",
    })
    db.recordCitation({ citation_id: "sk-citationSecret123", source_type: "file", source_uri: "file://evidence.md", quoted_text_or_summary: "Evidence" })
    db.addArtifact({ id: "sk-artifactSecret123", topic_id: "topic_1", kind: "log", content: "Evidence" })
    db.linkResultCitation("token=resultSecret123", "sk-citationSecret123")
    db.linkResultArtifact("token=resultSecret123", "sk-artifactSecret123")
    const citationEvent = db.listResearchEvents({ event_type: "ResultCitationLinked" })[0]!
    const artifactEvent = db.listResearchEvents({ event_type: "ResultArtifactLinked" })[0]!
    expect(JSON.stringify(citationEvent.payload)).toContain("[REDACTED]")
    expect(JSON.stringify(artifactEvent.payload)).toContain("[REDACTED]")
    db.close()

    const sqlite = new Database(join(dir, ".nxl", "research.db"))
    try {
      sqlite.query("UPDATE result_citations SET link_event_id = NULL").run()
      sqlite.query("UPDATE result_artifacts SET link_event_id = NULL").run()
      expect(sqlite.query("SELECT link_event_id FROM result_citations").get()).toEqual({ link_event_id: null })
      expect(sqlite.query("SELECT link_event_id FROM result_artifacts").get()).toEqual({ link_event_id: null })
    } finally {
      sqlite.close()
    }

    let next = 100
    const reopened = ResearchDb.open(dir, {
      now: () => new Date("2026-05-10T12:00:01Z"),
      idFactory: () => `after_${next++}`,
    })
    reopened.createCandidate({ candidate_id: "candidate_1", claim: "Candidate", source: "Commander" })
    expect(reopened.linkCandidateEvidence("candidate_1", "event", citationEvent.event_id).evidence_id).toBe(citationEvent.event_id)
    expect(reopened.linkCandidateEvidence("candidate_1", "event", artifactEvent.event_id).evidence_id).toBe(artifactEvent.event_id)
    reopened.close()
  })

  test("migration backfills ambiguous legacy link event ids by insertion order", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })
    db.proposeResearchResult({
      result_id: "token=result:aSecret123",
      result_type: "probe_result",
      title: "Valid probe",
      summary: "Valid probe",
      confidence: "medium",
      created_by: "executor",
    })
    db.proposeResearchResult({
      result_id: "token=result",
      result_type: "probe_result",
      title: "Rejected probe",
      summary: "Rejected probe",
      confidence: "medium",
      created_by: "executor",
    })
    db.recordCitation({ citation_id: "citation", source_type: "file", source_uri: "file://valid.md", quoted_text_or_summary: "Evidence" })
    db.recordCitation({ citation_id: "aSecret123:citation", source_type: "file", source_uri: "file://rejected.md", quoted_text_or_summary: "Rejected evidence" })
    db.addArtifact({ id: "artifact", topic_id: "topic_1", kind: "log", content: "Evidence" })
    db.addArtifact({ id: "aSecret123:artifact", topic_id: "topic_1", kind: "log", content: "Rejected evidence" })
    db.linkResultCitation("token=result:aSecret123", "citation")
    db.linkResultCitation("token=result", "aSecret123:citation")
    db.linkResultArtifact("token=result:aSecret123", "artifact")
    db.linkResultArtifact("token=result", "aSecret123:artifact")
    db.rejectResearchResult("token=result")
    const citationEvents = db.listResearchEvents({ event_type: "ResultCitationLinked" })
    const artifactEvents = db.listResearchEvents({ event_type: "ResultArtifactLinked" })
    expect(citationEvents.map((event) => event.entity_id)).toEqual(["token=result:aSecret123:citation", "token=result:aSecret123:citation"])
    expect(artifactEvents.map((event) => event.entity_id)).toEqual(["token=result:aSecret123:artifact", "token=result:aSecret123:artifact"])
    expect(JSON.stringify(citationEvents[0]!.payload)).toContain("[REDACTED]")
    expect(JSON.stringify(artifactEvents[0]!.payload)).toContain("[REDACTED]")
    db.close()

    const sqlite = new Database(join(dir, ".nxl", "research.db"))
    try {
      sqlite.query("UPDATE result_citations SET link_event_id = NULL").run()
      sqlite.query("UPDATE result_artifacts SET link_event_id = NULL").run()
    } finally {
      sqlite.close()
    }

    let next = 200
    const reopened = ResearchDb.open(dir, {
      now: () => new Date("2026-05-10T12:00:02Z"),
      idFactory: () => `after_${next++}`,
    })
    reopened.createCandidate({ candidate_id: "candidate_1", claim: "Candidate", source: "Commander" })
    expect(reopened.linkCandidateEvidence("candidate_1", "event", citationEvents[0]!.event_id).evidence_id).toBe(citationEvents[0]!.event_id)
    expect(reopened.linkCandidateEvidence("candidate_1", "event", artifactEvents[0]!.event_id).evidence_id).toBe(artifactEvents[0]!.event_id)
    expect(() => reopened.linkCandidateEvidence("candidate_1", "event", citationEvents[1]!.event_id)).toThrow("research event evidence not found")
    expect(() => reopened.linkCandidateEvidence("candidate_1", "event", artifactEvents[1]!.event_id)).toThrow("research event evidence not found")
    reopened.close()
  })

  test("candidate evidence linking fails clearly for missing candidate or evidence", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.createCandidate({ candidate_id: "candidate_1", claim: "Candidate", source: "Commander" })

    expect(() => db.linkCandidateEvidence("missing", "citation", "citation_1")).toThrow("candidate not found: missing")
    expect(() => db.linkCandidateEvidence("candidate_1", "citation", "missing")).toThrow("citation not found: missing")
    expect(() => db.linkCandidateEvidence("candidate_1", "artifact", "missing")).toThrow("artifact not found: missing")
    expect(() => db.linkCandidateEvidence("candidate_1", "research_result", "missing")).toThrow("research result evidence not found: missing")
    expect(() => db.linkCandidateEvidence("candidate_1", "event", "missing")).toThrow("research event evidence not found: missing")
    db.close()
  })

  test("candidate lifecycle events do not satisfy promotion evidence", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)
    db.createCandidate({ candidate_id: "candidate_1", claim: "Candidate", source: "Commander" })
    const candidateCreatedEvent = db.listResearchEvents({ entity_type: "candidate" })[0]!.event_id

    expect(() => db.linkCandidateEvidence("candidate_1", "event", candidateCreatedEvent)).toThrow("research event evidence not found")
    expect(db.canPromoteCandidate("candidate_1")).toEqual({ ok: false, reason: "candidate has no promotion evidence: candidate_1" })
    db.close()
  })

  test("rejected research result events do not satisfy promotion evidence", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)
    db.createCandidate({ candidate_id: "candidate_1", claim: "Candidate", source: "Commander" })
    db.proposeResearchResult({
      result_id: "result_1",
      result_type: "probe_result",
      title: "Probe",
      summary: "Probe",
      confidence: "medium",
      created_by: "executor",
    })
    db.rejectResearchResult("result_1")
    const rejectedEvent = db.listResearchEvents({ event_type: "ResearchResultRejected" })[0]!.event_id

    expect(() => db.linkCandidateEvidence("candidate_1", "event", rejectedEvent)).toThrow("research event evidence not found")
    expect(db.canPromoteCandidate("candidate_1")).toEqual({ ok: false, reason: "candidate has no promotion evidence: candidate_1" })
    db.close()
  })

  test("candidate promotion requires evidence and rejects already rejected candidates", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)
    db.createCandidate({ candidate_id: "candidate_1", claim: "Candidate", source: "Commander" })

    expect(db.canPromoteCandidate("candidate_1")).toEqual({ ok: false, reason: "candidate has no promotion evidence: candidate_1" })
    expect(() => db.promoteCandidate("candidate_1")).toThrow("candidate has no promotion evidence")

    db.proposeResearchResult({
      result_id: "result_1",
      result_type: "probe_result",
      title: "Probe",
      summary: "Probe",
      confidence: "medium",
      created_by: "executor",
    })
    db.linkCandidateEvidence("candidate_1", "research_result", "result_1")
    expect(db.proposeCandidatePromotion("candidate_1", ["result_1"])).toEqual(expect.objectContaining({ candidate_id: "candidate_1" }))
    expect(db.promoteCandidate("candidate_1").status).toBe("promoted")
    const promotedCandidate = db.getCandidate("candidate_1")!
    const promotedEvents = () => db.listResearchEvents({ entity_type: "candidate" }).filter((event) => event.event_type === "CandidatePromoted")
    expect(promotedEvents()).toHaveLength(1)
    expect(db.promoteCandidate("candidate_1")).toEqual(promotedCandidate)
    expect(promotedEvents()).toHaveLength(1)
    expect(() => db.selectCandidate("candidate_1")).toThrow("candidate already promoted: candidate_1")
    expect(() => db.rejectCandidate("candidate_1")).toThrow("candidate already promoted: candidate_1")
    expect(db.getCandidate("candidate_1")).toEqual(promotedCandidate)
    expect(promotedEvents()).toHaveLength(1)

    db.createCandidate({ candidate_id: "candidate_stale", claim: "Stale", source: "Commander" })
    const staleLink = db.linkCandidateEvidence("candidate_stale", "research_result", "result_1")
    db.rejectResearchResult("result_1")
    expect(db.linkCandidateEvidence("candidate_stale", "research_result", "result_1")).toEqual(staleLink)
    expect(db.canPromoteCandidate("candidate_stale")).toEqual({ ok: false, reason: "candidate has no promotion evidence: candidate_stale" })

    db.createCandidate({ candidate_id: "candidate_2", claim: "Rejected", source: "Commander" })
    db.proposeResearchResult({
      result_id: "result_2",
      result_type: "probe_result",
      title: "Probe 2",
      summary: "Probe",
      confidence: "medium",
      created_by: "executor",
    })
    db.linkCandidateEvidence("candidate_2", "research_result", "result_2")
    db.rejectCandidate("candidate_2")
    expect(() => db.selectCandidate("candidate_2")).toThrow("candidate already rejected: candidate_2")
    expect(() => db.promoteCandidate("candidate_2")).toThrow("candidate already rejected")
    db.close()
  })

  test("plans starts completes fails and cancels trials with search filters", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)
    db.createHypothesis({ hypothesis_id: "hypothesis_1", claim: "Hypothesis", source: "Source" })
    db.createCandidate({ candidate_id: "candidate_1", hypothesis_id: "hypothesis_1", claim: "Candidate", source: "Source" })

    const planned = db.planTrial({
      trial_id: "trial_1",
      hypothesis_id: "hypothesis_1",
      candidate_id: "candidate_1",
      trial_kind: "probe",
      config: { token: "trialSecret123" },
    })
    const running = db.startTrial("trial_1")
    const completed = db.completeTrial("trial_1")
    const failed = db.failTrial(db.planTrial({ trial_id: "trial_2", candidate_id: "candidate_1", trial_kind: "probe", config: {} }).trial_id, "bad metric")
    const cancelled = db.cancelTrial(db.planTrial({ trial_id: "trial_3", hypothesis_id: "hypothesis_1", trial_kind: "probe", config: {} }).trial_id, "stopped")

    expect(planned.status).toBe("planned")
    expect(running.status).toBe("running")
    expect(running.started_at).not.toBeNull()
    expect(completed.status).toBe("completed")
    expect(completed.completed_at).not.toBeNull()
    expect(failed.status).toBe("failed")
    expect(cancelled.status).toBe("cancelled")
    expect(db.searchTrials({ status: "completed" }).map((trial) => trial.trial_id)).toEqual(["trial_1"])
    expect(db.searchTrials({ candidate_id: "candidate_1" }).map((trial) => trial.trial_id)).toEqual(["trial_1", "trial_2"])
    expect(db.searchTrials({ hypothesis_id: "hypothesis_1" }).map((trial) => trial.trial_id)).toEqual(["trial_1", "trial_3"])
    expect(JSON.stringify(db.listResearchEvents({ entity_type: "trial" }))).not.toContain("trialSecret123")
    expect(db.listResearchEvents({ entity_type: "trial" }).map((event) => event.event_type)).toEqual([
      "TrialPlanned",
      "TrialStarted",
      "TrialCompleted",
      "TrialPlanned",
      "TrialFailed",
      "TrialPlanned",
      "TrialCancelled",
    ])
    db.close()
  })

  test("planning a trial enforces candidate hypothesis consistency", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.createHypothesis({ hypothesis_id: "hypothesis_1", claim: "Hypothesis 1", source: "Source" })
    db.createHypothesis({ hypothesis_id: "hypothesis_2", claim: "Hypothesis 2", source: "Source" })
    db.createCandidate({ candidate_id: "candidate_1", hypothesis_id: "hypothesis_1", claim: "Candidate", source: "Source" })
    db.createCandidate({ candidate_id: "candidate_standalone", claim: "Candidate", source: "Source" })

    expect(() =>
      db.planTrial({ trial_id: "trial_mismatch", hypothesis_id: "hypothesis_2", candidate_id: "candidate_1", trial_kind: "probe", config: {} }),
    ).toThrow("candidate hypothesis mismatch: candidate_1")
    expect(() =>
      db.planTrial({
        trial_id: "trial_standalone_mismatch",
        hypothesis_id: "hypothesis_1",
        candidate_id: "candidate_standalone",
        trial_kind: "probe",
        config: {},
      }),
    ).toThrow("candidate hypothesis mismatch: candidate_standalone")
    expect(db.getTrial("trial_mismatch")).toBeNull()
    db.close()
  })

  test("trial completion requires planned or running status", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.planTrial({ trial_id: "trial_1", trial_kind: "probe", config: {} })
    db.cancelTrial("trial_1")

    expect(() => db.completeTrial("trial_1")).toThrow("trial cannot be completed from status: cancelled")
    db.close()
  })

  test("trial start fail and cancel reject terminal state rewrites", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)
    db.planTrial({ trial_id: "trial_completed", trial_kind: "probe", config: {} })
    db.startTrial("trial_completed")
    const running = db.startTrial("trial_completed")
    db.completeTrial("trial_completed")
    db.planTrial({ trial_id: "trial_failed", trial_kind: "probe", config: {} })
    db.failTrial("trial_failed")
    db.planTrial({ trial_id: "trial_cancelled", trial_kind: "probe", config: {} })
    db.cancelTrial("trial_cancelled")

    expect(running.status).toBe("running")
    expect(db.listResearchEvents({ event_type: "TrialStarted" })).toHaveLength(1)
    expect(() => db.startTrial("trial_completed")).toThrow("trial cannot be started from status: completed")
    expect(() => db.startTrial("trial_failed")).toThrow("trial cannot be started from status: failed")
    expect(() => db.startTrial("trial_cancelled")).toThrow("trial cannot be started from status: cancelled")
    expect(() => db.failTrial("trial_completed")).toThrow("trial cannot be failed from status: completed")
    expect(() => db.cancelTrial("trial_completed")).toThrow("trial cannot be cancelled from status: completed")
    expect(() => db.cancelTrial("trial_failed")).toThrow("trial cannot be cancelled from status: failed")
    expect(() => db.failTrial("trial_cancelled")).toThrow("trial cannot be failed from status: cancelled")
    expect(db.getTrial("trial_completed")?.status).toBe("completed")
    expect(db.getTrial("trial_failed")?.status).toBe("failed")
    expect(db.getTrial("trial_cancelled")?.status).toBe("cancelled")
    db.close()
  })

  test("searches candidates by status and hypothesis", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)
    db.createHypothesis({ hypothesis_id: "hypothesis_1", claim: "Hypothesis", source: "Source" })
    const active = db.createCandidate({ candidate_id: "candidate_1", hypothesis_id: "hypothesis_1", claim: "Active", source: "Source" })
    const rejected = db.createCandidate({ candidate_id: "candidate_2", claim: "Rejected", source: "Source" })
    db.rejectCandidate(rejected.candidate_id)

    expect(db.searchCandidates({ status: "active" })).toEqual([active])
    expect(db.searchCandidates({ hypothesis_id: "hypothesis_1" })).toEqual([active])
    expect(() => db.searchCandidates({ status: "bad" as never })).toThrow("invalid candidate status")
    db.close()
  })

  test("redaction holds for hypothesis candidate trial config and events", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    const hypothesis = db.createHypothesis({ hypothesis_id: "hypothesis_secret", claim: "token=hypothesisSecret123", source: "password=sourceSecret123" })
    const candidate = db.createCandidate({ candidate_id: "candidate_secret", claim: "api_key=candidateSecret123", source: "Bearer sourceSecret123" })
    const trial = db.planTrial({ trial_id: "trial_secret", trial_kind: "secret=kindSecret123", config: { token: "configSecret123" } })

    const serialized = JSON.stringify({ hypothesis, candidate, trial, events: db.listResearchEvents() })
    expect(serialized).not.toContain("hypothesisSecret123")
    expect(serialized).not.toContain("sourceSecret123")
    expect(serialized).not.toContain("candidateSecret123")
    expect(serialized).not.toContain("kindSecret123")
    expect(serialized).not.toContain("configSecret123")
    expect(serialized).toContain("[REDACTED]")
    db.close()
  })

  test("candidate hypothesis and trial writes roll back when event append fails", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    const sqlite = new Database(join(dir, ".nxl", "research.db"))
    try {
      sqlite.exec(`
        CREATE TRIGGER fail_branch4b_event_insert
        BEFORE INSERT ON research_events
        WHEN NEW.event_type IN ('HypothesisCreated', 'CandidateCreated', 'TrialPlanned')
        BEGIN
          SELECT RAISE(ABORT, 'forced branch4b event failure');
        END;
      `)

      expect(() => db.createHypothesis({ hypothesis_id: "hypothesis_rollback", claim: "Claim", source: "Source" })).toThrow("forced branch4b event failure")
      expect(db.getHypothesis("hypothesis_rollback")).toBeNull()
      expect(() => db.createCandidate({ candidate_id: "candidate_rollback", claim: "Claim", source: "Source" })).toThrow("forced branch4b event failure")
      expect(db.getCandidate("candidate_rollback")).toBeNull()
      expect(() => db.planTrial({ trial_id: "trial_rollback", trial_kind: "probe", config: {} })).toThrow("forced branch4b event failure")
      expect(db.getTrial("trial_rollback")).toBeNull()
    } finally {
      sqlite.close()
      db.close()
    }
  })

  test("creates training run and checkpoint tables on empty DB", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.close()

    const sqlite = new Database(join(dir, ".nxl", "research.db"))
    try {
      const tables = sqlite
        .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => String((row as { name: string }).name))
      expect(tables).toContain("training_runs")
      expect(tables).toContain("training_checkpoints")
    } finally {
      sqlite.close()
    }
  })

  test("Branch 4B DB opens after training projection migration", async () => {
    const dir = await tempProject()
    await mkdir(join(dir, ".nxl"), { recursive: true })
    const sqlite = new Database(join(dir, ".nxl", "research.db"))
    try {
      sqlite.exec(`
        CREATE TABLE topics (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          input_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE hypotheses (
          hypothesis_id TEXT PRIMARY KEY,
          claim TEXT NOT NULL,
          source TEXT NOT NULL,
          status TEXT NOT NULL,
          input_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE candidates (
          candidate_id TEXT PRIMARY KEY,
          hypothesis_id TEXT,
          claim TEXT NOT NULL,
          source TEXT NOT NULL,
          status TEXT NOT NULL,
          commander_score REAL,
          rank_reason TEXT,
          input_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE trials (
          trial_id TEXT PRIMARY KEY,
          hypothesis_id TEXT,
          candidate_id TEXT,
          trial_kind TEXT NOT NULL,
          status TEXT NOT NULL,
          config_json TEXT NOT NULL,
          input_hash TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE research_events (
          event_id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `)
    } finally {
      sqlite.close()
    }

    const db = openTestDb(dir)
    expect(db.searchTrainingRuns()).toEqual([])
    db.close()
  })

  test("plans training run with event and explicit ID idempotency", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.createHypothesis({ hypothesis_id: "hypothesis_1", claim: "Hypothesis", source: "Source" })
    db.createCandidate({ candidate_id: "candidate_1", hypothesis_id: "hypothesis_1", claim: "Candidate", source: "Source" })
    db.planTrial({ trial_id: "trial_1", hypothesis_id: "hypothesis_1", candidate_id: "candidate_1", trial_kind: "full", config: {} })

    const input = {
      training_run_id: "training_1",
      trial_id: "trial_1",
      candidate_id: "candidate_1",
      hypothesis_id: "hypothesis_1",
      mission_id: "mission_1",
      label: "full_training" as const,
      log_path: "/tmp/token=logSecret123.log",
      metrics_path: "/tmp/metrics.json",
      checkpoint_dir: "/tmp/checkpoints",
      reproduction: { command: "API_KEY=reproSecret123 bun train" },
    }
    const first = db.planTrainingRun(input)
    const second = db.planTrainingRun(input)

    expect(second).toEqual(first)
    expect(first.status).toBe("planned")
    expect(first.label).toBe("full_training")
    expect(db.getTrainingRun(" training_1 ")).toEqual(first)
    expect(db.listResearchEvents({ entity_type: "training_run" }).map((event) => event.event_type)).toEqual(["TrainingRunPlanned"])
    expect(JSON.stringify({ first, events: db.listResearchEvents({ entity_type: "training_run" }) })).not.toContain("logSecret123")
    expect(JSON.stringify(first)).not.toContain("reproSecret123")
    expect(() => db.planTrainingRun({ ...input, label: "probe" })).toThrow("training run id collision")
    db.close()
  })

  test("planning training run from trial inherits trial candidate and hypothesis links", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.createHypothesis({ hypothesis_id: "hypothesis_1", claim: "Hypothesis", source: "Source" })
    db.createCandidate({ candidate_id: "candidate_1", hypothesis_id: "hypothesis_1", claim: "Candidate", source: "Source" })
    db.planTrial({ trial_id: "trial_1", hypothesis_id: "hypothesis_1", candidate_id: "candidate_1", trial_kind: "probe", config: {} })

    const run = db.planTrainingRun({ training_run_id: "training_1", trial_id: "trial_1", label: "probe" })

    expect(run.candidate_id).toBe("candidate_1")
    expect(run.hypothesis_id).toBe("hypothesis_1")
    expect(db.searchTrainingRuns({ candidate_id: "candidate_1" }).map((trainingRun) => trainingRun.training_run_id)).toEqual(["training_1"])
    expect(db.searchTrainingRuns({ hypothesis_id: "hypothesis_1" }).map((trainingRun) => trainingRun.training_run_id)).toEqual(["training_1"])
    db.close()
  })

  test("training run lifecycle progress checkpoint reproduction and search APIs write events", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })
    db.createHypothesis({ hypothesis_id: "hypothesis_1", claim: "Hypothesis", source: "Source" })
    db.createCandidate({ candidate_id: "candidate_1", hypothesis_id: "hypothesis_1", claim: "Candidate", source: "Source" })
    db.planTrial({ trial_id: "trial_1", hypothesis_id: "hypothesis_1", candidate_id: "candidate_1", trial_kind: "full", config: {} })
    db.planTrainingRun({
      training_run_id: "training_1",
      trial_id: "trial_1",
      candidate_id: "candidate_1",
      hypothesis_id: "hypothesis_1",
      mission_id: "mission_1",
      label: "full_training",
    })

    const started = db.startTrainingRun("training_1", { pid: 123, process_group_id: 456, log_path: "/tmp/train.log" })
    const progressed = db.observeTrainingProgress({ training_run_id: "training_1", step: 10, metric: { loss: 0.4, token: "metricSecret123" } })
    const stepOnlyProgress = db.observeTrainingProgress({ training_run_id: "training_1", step: 11 })
    const artifact = db.addArtifact({ id: "checkpoint_artifact_1", topic_id: "topic_1", kind: "snapshot", content: "checkpoint", produced_by_run_id: "training_1" })
    const checkpoint = db.recordTrainingCheckpoint({
      checkpoint_id: "checkpoint_1",
      training_run_id: "training_1",
      artifact_id: artifact.id,
      step: 20,
      metric: { loss: 0.2 },
    })
    const reproduced = db.recordReproductionRecipe("training_1", { command: "TOKEN=reproSecret123 bun train" })
    const completed = db.completeTrainingRun("training_1", { metrics_path: "/tmp/metrics.json" })

    expect(started.status).toBe("running")
    expect(started.started_at).not.toBeNull()
    expect(progressed.last_step).toBe(10)
    expect(progressed.last_metric).toEqual({ loss: 0.4, token: "[REDACTED]" })
    expect(progressed.last_observed_at).not.toBeNull()
    expect(stepOnlyProgress.last_step).toBe(11)
    expect(stepOnlyProgress.last_metric).toEqual({ loss: 0.4, token: "[REDACTED]" })
    expect(checkpoint.artifact_id).toBe("checkpoint_artifact_1")
    expect(db.getTrainingRun("training_1")?.latest_checkpoint_id).toBe("checkpoint_1")
    expect(reproduced.reproduction).toEqual({ command: "[REDACTED] bun train" })
    expect(completed.status).toBe("completed")
    expect(db.searchTrainingRuns({ label: "full_training" }).map((run) => run.training_run_id)).toEqual(["training_1"])
    expect(db.searchTrainingRuns({ status: "completed" }).map((run) => run.training_run_id)).toEqual(["training_1"])
    expect(db.searchTrainingRuns({ candidate_id: "candidate_1" }).map((run) => run.training_run_id)).toEqual(["training_1"])
    expect(db.searchTrainingRuns({ hypothesis_id: "hypothesis_1" }).map((run) => run.training_run_id)).toEqual(["training_1"])
    expect(db.searchTrainingRuns({ trial_id: "trial_1" }).map((run) => run.training_run_id)).toEqual(["training_1"])
    expect(db.listResearchEvents({ entity_type: "training_run" }).map((event) => event.event_type)).toEqual([
      "TrainingRunPlanned",
      "TrainingRunStarted",
      "TrainingProgressObserved",
      "TrainingProgressObserved",
      "TrainingRunCompleted",
    ])
    expect(db.listResearchEvents({ entity_type: "training_checkpoint" }).map((event) => event.event_type)).toEqual(["TrainingCheckpointObserved"])
    expect(db.listResearchEvents({ entity_type: "reproduction_record" }).map((event) => event.event_type)).toEqual(["ReproductionRecipeRecorded"])
    expect(JSON.stringify(db.listResearchEvents())).not.toContain("metricSecret123")
    expect(JSON.stringify(db.listResearchEvents())).not.toContain("reproSecret123")
    db.close()
  })

  test("training run failure cancellation and terminal rewrites are rejected", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)
    db.planTrainingRun({ training_run_id: "training_failed", label: "probe" })
    db.planTrainingRun({ training_run_id: "training_cancelled", label: "debug_run" })
    db.planTrainingRun({ training_run_id: "training_completed", label: "evaluation" })

    const failed = db.failTrainingRun("training_failed", "token=failedSecret123")
    const cancelled = db.cancelTrainingRun("training_cancelled", "stopped")
    const completed = db.completeTrainingRun("training_completed")

    expect(failed.status).toBe("failed")
    expect(cancelled.status).toBe("cancelled")
    expect(completed.status).toBe("completed")
    expect(() => db.startTrainingRun("training_failed")).toThrow("training run cannot be started from status: failed")
    expect(() => db.startTrainingRun("training_cancelled")).toThrow("training run cannot be started from status: cancelled")
    expect(() => db.startTrainingRun("training_completed")).toThrow("training run cannot be started from status: completed")
    expect(() => db.completeTrainingRun("training_failed")).toThrow("training run cannot be completed from status: failed")
    expect(() => db.completeTrainingRun("training_cancelled")).toThrow("training run cannot be completed from status: cancelled")
    expect(JSON.stringify(db.listResearchEvents())).not.toContain("failedSecret123")
    db.close()
  })

  test("checkpoint retry is idempotent when observed_at is generated", async () => {
    const dir = await tempProject()
    const db = openSequencedTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })
    db.planTrainingRun({ training_run_id: "training_1", label: "debug_run" })
    db.planTrainingRun({ training_run_id: "training_2", label: "debug_run" })
    db.addArtifact({ id: "checkpoint_artifact_1", topic_id: "topic_1", kind: "snapshot", content: "checkpoint" })
    db.addArtifact({ id: "wrong_run_artifact", topic_id: "topic_1", kind: "snapshot", content: "checkpoint", produced_by_run_id: "training_2" })

    const first = db.recordTrainingCheckpoint({
      checkpoint_id: "checkpoint_1",
      training_run_id: "training_1",
      artifact_id: "checkpoint_artifact_1",
      step: 1,
    })
    const second = db.recordTrainingCheckpoint({
      checkpoint_id: "checkpoint_1",
      training_run_id: "training_1",
      artifact_id: "checkpoint_artifact_1",
      step: 1,
    })

    expect(second).toEqual(first)
    expect(db.listResearchEvents({ event_type: "TrainingCheckpointObserved" })).toHaveLength(1)
    expect(() =>
      db.recordTrainingCheckpoint({
        checkpoint_id: "checkpoint_wrong_run",
        training_run_id: "training_1",
        artifact_id: "wrong_run_artifact",
      }),
    ).toThrow("checkpoint artifact run mismatch")
    db.close()
  })

  test("training write barriers enforce full training metrics reproduction and best-model labels", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })
    db.planTrainingRun({ training_run_id: "run_probe", label: "probe" })
    db.planTrainingRun({ training_run_id: "run_full", label: "full_training", reproduction: { command: "bun train" } })
    db.planTrainingRun({ training_run_id: "run_existing_reproduction", label: "full_training", reproduction: { command: "bun train" } })
    db.completeTrainingRun("run_probe")
    db.completeTrainingRun("run_full", { metrics_path: "/tmp/metrics.json" })
    expect(db.completeTrainingRun("run_existing_reproduction", { metrics_path: "/tmp/metrics.json", reproduction: null }).reproduction).toEqual({
      command: "bun train",
    })
    db.planTrainingRun({ training_run_id: "run_missing_reproduction", label: "full_training", metrics_path: "/tmp/metrics.json" })
    db.planTrainingRun({ training_run_id: "run_null_reproduction", label: "full_training", metrics_path: "/tmp/metrics.json" })
    db.planTrainingRun({ training_run_id: "run_missing_metrics", label: "full_training", reproduction: { command: "bun train" } })

    expect(() => db.completeTrainingRun("run_missing_reproduction")).toThrow("full training run requires reproduction before completion")
    expect(() => db.completeTrainingRun("run_null_reproduction", { reproduction: null })).toThrow("full training run requires reproduction before completion")
    expect(() => db.completeTrainingRun("run_missing_metrics")).toThrow("full training run requires metrics evidence before completion")

    expect(() => db.assertTrainingRunCanSupportBestModelUpdate("run_probe")).toThrow("training run label cannot update best model")
    expect(() => db.assertTrainingRunCanSupportBestModelUpdate(db.planTrainingRun({ training_run_id: "run_unfinished", label: "evaluation" }).training_run_id)).toThrow(
      "training run must be completed",
    )
    expect(() => db.assertTrainingRunCanSupportBestModelUpdate("run_full")).not.toThrow()

    db.proposeResearchResult({
      result_id: "missing_repro",
      result_type: "full_training_result",
      title: "Training",
      summary: "Training",
      confidence: "medium",
      metrics: { loss: 0.2 },
      created_by: "executor",
    })
    db.addArtifact({ id: "metrics_artifact_1", topic_id: "topic_1", kind: "log", content: "metrics" })
    db.linkResultArtifact("missing_repro", "metrics_artifact_1")
    expect(() => db.acceptResearchResult("missing_repro")).toThrow("full training result requires reproduction")

    db.proposeResearchResult({
      result_id: "missing_metrics",
      result_type: "full_training_result",
      title: "Training",
      summary: "Training",
      confidence: "medium",
      reproduction: { command: "bun train" },
      created_by: "executor",
    })
    expect(() => db.acceptResearchResult("missing_metrics")).toThrow("full training result requires metrics evidence")

    db.proposeResearchResult({
      result_id: "with_run_evidence",
      result_type: "full_training_result",
      title: "Training",
      summary: "Training",
      confidence: "medium",
      training_run_id: "run_full",
      created_by: "executor",
    })
    db.addArtifact({ id: "training_log_1", topic_id: "topic_1", kind: "log", content: "log" })
    db.linkResultArtifact("with_run_evidence", "training_log_1")
    expect(db.acceptResearchResult("with_run_evidence").status).toBe("accepted")
    db.close()
  })

  test("checkpoint selection requires a linked checkpoint artifact", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    db.createTopic({ id: "topic_1", title: "Topic" })
    db.planTrainingRun({ training_run_id: "training_1", label: "full_training" })
    db.planTrainingRun({ training_run_id: "training_2", label: "full_training" })
    db.proposeResearchResult({
      result_id: "checkpoint_selection_1",
      result_type: "checkpoint_selection",
      title: "Checkpoint",
      summary: "Select checkpoint",
      confidence: "high",
      training_run_id: "training_1",
      created_by: "verifier",
    })
    db.addArtifact({ id: "plain_artifact", topic_id: "topic_1", kind: "snapshot", content: "not linked as checkpoint" })
    db.linkResultArtifact("checkpoint_selection_1", "plain_artifact")
    expect(() => db.acceptResearchResult("checkpoint_selection_1")).toThrow("checkpoint selection requires linked checkpoint artifact")

    const checkpointArtifact = db.addArtifact({ id: "checkpoint_artifact", topic_id: "topic_1", kind: "snapshot", content: "checkpoint" })
    db.recordTrainingCheckpoint({ checkpoint_id: "checkpoint_wrong_run", training_run_id: "training_2", artifact_id: checkpointArtifact.id })
    db.linkResultArtifact("checkpoint_selection_1", checkpointArtifact.id)
    expect(() => db.acceptResearchResult("checkpoint_selection_1")).toThrow("checkpoint selection requires linked checkpoint artifact")

    const matchingCheckpointArtifact = db.addArtifact({ id: "matching_checkpoint_artifact", topic_id: "topic_1", kind: "snapshot", content: "checkpoint" })
    db.recordTrainingCheckpoint({ checkpoint_id: "checkpoint_1", training_run_id: "training_1", artifact_id: matchingCheckpointArtifact.id })
    db.linkResultArtifact("checkpoint_selection_1", matchingCheckpointArtifact.id)
    expect(db.acceptResearchResult("checkpoint_selection_1").status).toBe("accepted")
    db.close()
  })

  test("training writes roll back when event append fails", async () => {
    const dir = await tempProject()
    const db = openTestDb(dir)
    const sqlite = new Database(join(dir, ".nxl", "research.db"))
    try {
      sqlite.exec(`
        CREATE TRIGGER fail_training_event_insert
        BEFORE INSERT ON research_events
        WHEN NEW.event_type = 'TrainingRunPlanned'
        BEGIN
          SELECT RAISE(ABORT, 'forced training event failure');
        END;
      `)

      expect(() => db.planTrainingRun({ training_run_id: "training_rollback", label: "probe" })).toThrow("forced training event failure")
      expect(db.getTrainingRun("training_rollback")).toBeNull()
    } finally {
      sqlite.close()
      db.close()
    }
  })
})
