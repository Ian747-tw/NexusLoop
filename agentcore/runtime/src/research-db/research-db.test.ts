import { afterEach, describe, expect, test } from "bun:test"
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
})
