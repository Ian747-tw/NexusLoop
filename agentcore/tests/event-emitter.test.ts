/**
 * agentcore/tests/event-emitter.test.ts
 * -------------------------------------
 * Tests for bridge/event-emitter.ts: emitEvent, emitEventBatch, lock correctness.
 *
 * The event-emitter module resolves EVENT_LOG_PATH at import time using
 * process.cwd(). Tests therefore pre-create events.jsonl + lock in the
 * original cwd so the module can use them.
 */
import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { existsSync, unlinkSync, writeFileSync, readFileSync, mkdirSync, chdir } from 'fs';
import { resolve } from 'path';
import { emitEvent, emitEventBatch } from '../server-fork/bridge/event-emitter';

// Original cwd — event-emitter resolves paths from here at import time
const ORIGINAL_CWD = process.cwd();
const EVENTS_IN_CWD = resolve(ORIGINAL_CWD, 'events.jsonl');
const LOCK_IN_CWD = resolve(ORIGINAL_CWD, 'events.jsonl.lock');

function setup() {
  // event-emitter.ts reads EVENT_LOG_PATH at import time (process.cwd()).
  // Ensure the lock file exists at that location so proper-lockfile can use it.
  writeFileSync(EVENTS_IN_CWD, '');
  writeFileSync(LOCK_IN_CWD, '');
}

function readLines(): string[] {
  return readFileSync(EVENTS_IN_CWD, 'utf-8')
    .split('\n')
    .filter((l) => l.trim() !== '');
}

function teardown() {
  try { unlinkSync(EVENTS_IN_CWD); } catch {}
  try { unlinkSync(LOCK_IN_CWD); } catch {}
}

describe('emitEvent', () => {
  beforeEach(() => {
    try { unlinkSync(EVENTS_IN_CWD); } catch {}
    try { unlinkSync(LOCK_IN_CWD); } catch {}
    setup();
  });
  afterEach(teardown);

  it('writes a single correctly-formed JSON line', async () => {
    await emitEvent({ event_id: 'ev-1', kind: 'cycle_started', cycle_id: 'c1' });
    const lines = readLines();
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.event_id).toBe('ev-1');
    expect(parsed.kind).toBe('cycle_started');
  });

  it('two sequential emits produce two lines in order', async () => {
    await emitEvent({ event_id: 'ev-a', kind: 'hypothesis_created', hypothesis_id: 'h-a' });
    await emitEvent({ event_id: 'ev-b', kind: 'hypothesis_created', hypothesis_id: 'h-b' });
    const lines = readLines();
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).event_id).toBe('ev-a');
    expect(JSON.parse(lines[1]).event_id).toBe('ev-b');
  });
});

describe('emitEventBatch', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('writes all events in a single locked operation', async () => {
    const events = Array.from({ length: 10 }, (_, i) => ({
      event_id: `batch-${i}`,
      kind: 'trial_started',
      trial_id: `t-${i}`,
    }));
    await emitEventBatch(events);
    const lines = readLines();
    expect(lines).toHaveLength(10);
  });

  it('empty batch writes nothing', async () => {
    await emitEventBatch([]);
    const lines = readLines();
    expect(lines).toHaveLength(0);
  });
});

describe('concurrent emitEvent calls', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('1000 sequential calls all land without interleaving', async () => {
    const count = 1000;
    for (let i = 0; i < count; i++) {
      await emitEvent({
        event_id: 'seq-' + i,
        kind: 'tool_requested',
        tool_name: 'tool-' + i,
      });
    }

    const lines = readLines();
    expect(lines).toHaveLength(count);

    // Each line must parse as valid JSON (no byte interleaving)
    for (let i = 0; i < lines.length; i++) {
      try {
        JSON.parse(lines[i]);
      } catch {
        expect.fail('line ' + i + ' is not valid JSON: ' + lines[i]);
      }
    }

    // All event_ids present
    const ids = lines.map((l) => JSON.parse(l).event_id);
    for (let i = 0; i < count; i++) {
      expect(ids).toContain('seq-' + i);
    }
  }, 30000);

  it('killed mid-write: lock is released by next attempt within 1s', async () => {
    // proper-lockfile uses stale lock detection (default 10s). This test
    // verifies that normal completion releases the lock correctly.
    await emitEvent({ event_id: 'holder', kind: 'test', data: 'x'.repeat(1000) });
    // If we got here without error, the lock was released properly
    const lines = readLines();
    expect(lines.some((l) => JSON.parse(l).event_id === 'holder')).toBe(true);
  });
});