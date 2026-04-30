// @ts-ignore
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import process from "process";

const {
  findLatestSnapshot,
  materializeSnapshots,
  replayEventLog,
  replayFromSnapshot,
} = await import("./snapshot");

const ORIGINAL_CWD = process.cwd();

function eventId(n: number): string {
  return `01H${String(n).padStart(22, "0")}`;
}

function buildEventLines(count: number): string {
  const lines: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const event =
      i === 1
        ? { event_id: eventId(i), kind: "hypothesis_created", hypothesis_id: "h-1" }
        : i === 2
          ? { event_id: eventId(i), kind: "evidence_collected", hypothesis_id: "h-1", value: 1 }
          : i === 3
            ? { event_id: eventId(i), kind: "zone_entered", zone: "B", reason: "promote" }
            : { event_id: eventId(i), kind: "subagent_completed", subagent_type: "noop", invocation_id: `inv-${i}`, success: true };
    if (i % 2 === 0) {
      lines.push(JSON.stringify({ event_id: event.event_id, event }));
    } else {
      lines.push(JSON.stringify(event));
    }
  }
  return lines.join("\n") + "\n";
}

describe("snapshot.ts", () => {
  let projectDir: string;
  let eventsPath: string;
  let snapshotsDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "nxl-snapshot-ts-"));
    mkdirSync(join(projectDir, ".nxl"), { recursive: true });
    eventsPath = join(projectDir, ".nxl", "events.jsonl");
    snapshotsDir = join(projectDir, ".nxl", "snapshots");
    process.chdir(projectDir);
  });

  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("writes a snapshot at event 1000 when 1500 events exist", async () => {
    writeFileSync(eventsPath, buildEventLines(1500));
    const written = await materializeSnapshots(eventsPath, snapshotsDir, 1000);

    expect(written).toHaveLength(1);
    expect(existsSync(join(snapshotsDir, `${eventId(1000)}.json`))).toBe(true);
  });

  it("snapshot + delta replay matches full replay", async () => {
    writeFileSync(eventsPath, buildEventLines(1500));
    await materializeSnapshots(eventsPath, snapshotsDir, 1000);
    const latest = findLatestSnapshot(snapshotsDir);
    expect(latest).not.toBeNull();

    const fromSnapshot = await replayFromSnapshot(latest!.path, eventsPath);
    const fullReplay = await replayEventLog(eventsPath);

    expect(fromSnapshot).toEqual(fullReplay);
    expect(fromSnapshot.program_state).toBe("exploiting");
    expect(fromSnapshot.registry_projection.hypotheses["h-1"].last_evidence_event_id).toBe(eventId(2));
  });

  it("corrupt snapshot falls back to full replay and emits snapshot_corrupted", async () => {
    writeFileSync(eventsPath, buildEventLines(20));
    mkdirSync(snapshotsDir, { recursive: true });
    const corruptPath = join(snapshotsDir, `${eventId(10)}.json`);
    writeFileSync(corruptPath, "{not-json");

    const replayed = await replayFromSnapshot(corruptPath, eventsPath);
    const fullReplay = await replayEventLog(eventsPath);

    expect(replayed).toEqual(fullReplay);
    const emitted = readFileSync(join(projectDir, ".nxl", "events.jsonl"), "utf-8");
    expect(emitted).toContain('"kind":"snapshot_corrupted"');
    expect(emitted).toContain(corruptPath);
  });

  it("selects the lexicographically latest snapshot file", () => {
    mkdirSync(snapshotsDir, { recursive: true });
    writeFileSync(join(snapshotsDir, `${eventId(10)}.json`), "{}");
    writeFileSync(join(snapshotsDir, `${eventId(20)}.json`), "{}");

    const latest = findLatestSnapshot(snapshotsDir);
    expect(latest).not.toBeNull();
    expect(latest!.cursor_event_id).toBe(eventId(20));
  });
});
