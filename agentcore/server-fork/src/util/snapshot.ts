import { mkdirSync, existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { emitEvent } from "../../bridge/event-emitter";
import { applyEvent, type ResearchNamespace } from "../seams/research-state";

interface SnapshotFile {
  cursor_event_id: string;
  event_count: number;
  state: ResearchNamespace;
}

function createEmptyResearchNamespace(): ResearchNamespace {
  return {
    current_cycle: null,
    program_state: "cold_start",
    registry_projection: { hypotheses: {}, cursor: null },
    tier_state: {},
    capsule_cursor: null,
    scheduler_queue: [],
  };
}

function normalizeEventRecord(raw: Record<string, unknown>): Record<string, unknown> | null {
  if (raw.event && typeof raw.event === "object") {
    const event = { ...(raw.event as Record<string, unknown>) };
    if (!event.event_id && raw.event_id) event.event_id = raw.event_id;
    if (!event.timestamp && raw.timestamp) event.timestamp = raw.timestamp;
    return event;
  }
  return raw;
}

function readEventLines(eventsPath: string): string[] {
  if (!existsSync(eventsPath)) return [];
  return readFileSync(eventsPath, "utf-8")
    .split("\n")
    .filter((line) => line.trim() !== "");
}

export function shouldSnapshot(eventCount: number, interval: number = 1000): boolean {
  return eventCount > 0 && eventCount % interval === 0;
}

export function writeSnapshot(
  snapshotsDir: string,
  projectionState: ResearchNamespace,
  eventId: string,
  eventCount: number = 0,
): string {
  mkdirSync(snapshotsDir, { recursive: true });
  const path = join(snapshotsDir, `${eventId}.json`);
  const payload: SnapshotFile = {
    cursor_event_id: eventId,
    event_count: eventCount,
    state: projectionState,
  };
  writeFileSync(path, JSON.stringify(payload));
  return path;
}

export function findLatestSnapshot(
  snapshotsDir: string,
): { path: string; cursor_event_id: string } | null {
  if (!existsSync(snapshotsDir)) return null;
  const candidates = readdirSync(snapshotsDir)
    .filter((file) => file.endsWith(".json"))
    .sort();
  if (candidates.length === 0) return null;
  const latest = candidates[candidates.length - 1];
  return {
    path: resolve(snapshotsDir, latest),
    cursor_event_id: latest.replace(/\.json$/, ""),
  };
}

export async function replayEventLog(
  eventsPath: string,
  cursor: string | null = null,
  initialState: ResearchNamespace = createEmptyResearchNamespace(),
): Promise<ResearchNamespace> {
  const lines = readEventLines(eventsPath);
  let state = initialState;
  let started = cursor === null;

  for (const line of lines) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const normalized = normalizeEventRecord(parsed);
    if (!normalized) continue;

    if (!started) {
      if (normalized.event_id === cursor || parsed.event_id === cursor) {
        started = true;
      }
      continue;
    }

    state = applyEvent(state, normalized as Record<string, unknown>);
  }

  return state;
}

async function emitSnapshotCursorMissing(
  eventsPath: string,
  cursor: string,
): Promise<void> {
  emitEvent({
    event: {
      kind: "snapshot_cursor_missing",
      cursor_event_id: cursor,
      events_path: eventsPath,
    },
  });
}

export async function replayFromSnapshot(
  snapshotPath: string,
  eventsPath: string,
): Promise<ResearchNamespace> {
  try {
    const payload = JSON.parse(readFileSync(snapshotPath, "utf-8")) as SnapshotFile;
    const lines = readEventLines(eventsPath);
    let state = payload.state;
    let foundCursor = false;

    for (const line of lines) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const normalized = normalizeEventRecord(parsed);
      if (!normalized) continue;

      if (!foundCursor) {
        if (normalized.event_id === payload.cursor_event_id || parsed.event_id === payload.cursor_event_id) {
          foundCursor = true;
        }
        continue;
      }

      state = applyEvent(state, normalized as Record<string, unknown>);
    }

    if (!foundCursor) {
      await emitSnapshotCursorMissing(eventsPath, payload.cursor_event_id);
      return replayEventLog(eventsPath, null, createEmptyResearchNamespace());
    }

    return state;
  } catch (error) {
    emitEvent({
      event: {
        kind: "snapshot_corrupted",
        snapshot_path: snapshotPath,
        error: String(error),
      },
    });
    return replayEventLog(eventsPath, null, createEmptyResearchNamespace());
  }
}

export async function materializeSnapshots(
  eventsPath: string,
  snapshotsDir: string,
  interval: number = 1000,
): Promise<string[]> {
  mkdirSync(dirname(eventsPath), { recursive: true });
  mkdirSync(snapshotsDir, { recursive: true });

  const lines = readEventLines(eventsPath);
  let state = createEmptyResearchNamespace();
  let count = 0;
  const written: string[] = [];

  for (const line of lines) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const event = normalizeEventRecord(parsed);
    if (!event) continue;

    state = applyEvent(state, event);
    count += 1;

    if (!shouldSnapshot(count, interval)) continue;
    const eventId = String(event.event_id ?? parsed.event_id ?? "");
    if (!eventId) continue;
    const snapshotPath = join(snapshotsDir, `${eventId}.json`);
    if (existsSync(snapshotPath)) continue;
    written.push(writeSnapshot(snapshotsDir, state, eventId, count));
  }

  return written;
}
