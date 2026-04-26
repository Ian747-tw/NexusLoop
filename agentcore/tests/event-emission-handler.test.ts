/**
 * agentcore/tests/event-emission-handler.test.ts
 * -----------------------------------------------
 * Tests for src/seams/event-emission-handler.ts:
 * - validateEvent accepts known kinds, rejects unknown
 * - handleEventEmissionRequest returns event_id on valid event
 * - handleEventEmissionRequest returns error on invalid kind
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, unlinkSync, writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { resolve as pathResolve } from 'path';

// Import the module under test
import {
  handleEventEmissionRequest,
  validateEvent,
} from '../server-fork/src/seams/event-emission-handler';
import type { EventEmissionRequest } from '../server-fork/bridge/protocol';

const ORIGINAL_CWD = process.cwd();
const EVENTS_IN_CWD = resolve(ORIGINAL_CWD, 'events.jsonl');
const LOCK_IN_CWD = resolve(ORIGINAL_CWD, 'events.jsonl.lock');

function setup() {
  try { unlinkSync(EVENTS_IN_CWD); } catch {}
  try { unlinkSync(LOCK_IN_CWD); } catch {}
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

describe('validateEvent', () => {
  it('accepts a valid cycle_started event', () => {
    const result = validateEvent({
      event_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      kind: 'cycle_started',
      brief_hash: 'abc',
      hypothesis_id: 'h1',
      started_at: 1712000000000,
    });
    expect(result).toBeNull();
  });

  it('rejects missing event_id', () => {
    const result = validateEvent({
      kind: 'cycle_started',
      brief_hash: 'abc',
    });
    expect(result).not.toBeNull();
    expect(result).toContain('event_id');
  });

  it('rejects empty event_id', () => {
    const result = validateEvent({
      event_id: '',
      kind: 'cycle_started',
    });
    expect(result).not.toBeNull();
  });

  it('rejects unknown event kind', () => {
    const result = validateEvent({
      event_id: 'ev-1',
      kind: 'not_a_real_kind',
    });
    expect(result).not.toBeNull();
    expect(result).toContain('unknown event kind');
  });

  it('rejects non-object event', () => {
    expect(validateEvent(null as any)).not.toBeNull();
    expect(validateEvent('string' as any)).not.toBeNull();
  });
});

describe('handleEventEmissionRequest', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('emits a valid event and returns the event_id', async () => {
    const req: EventEmissionRequest = {
      kind: 'EventEmissionRequest',
      request_id: 'req-1',
      origin_mcp: 'journal',
      event: {
        event_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        kind: 'cycle_started',
        brief_hash: 'abc123',
        hypothesis_id: 'h1',
        started_at: 1712000000000,
      },
    };

    const result = await handleEventEmissionRequest(req);
    expect(result.error).toBeUndefined();
    expect(result.event_id).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');

    const lines = readLines();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).event_id).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
  });

  it('returns error for unknown event kind', async () => {
    const req: EventEmissionRequest = {
      kind: 'EventEmissionRequest',
      request_id: 'req-2',
      origin_mcp: 'journal',
      event: {
        event_id: 'ev-bad',
        kind: 'not_a_real_event_kind',
      },
    };

    const result = await handleEventEmissionRequest(req);
    expect(result.error).not.toBeUndefined();
    expect(result.error).toContain('unknown event kind');
  });

  it('returns error for missing event_id', async () => {
    const req: EventEmissionRequest = {
      kind: 'EventEmissionRequest',
      request_id: 'req-3',
      origin_mcp: 'journal',
      event: {
        kind: 'cycle_started',
      },
    };

    const result = await handleEventEmissionRequest(req);
    expect(result.error).not.toBeUndefined();
    expect(result.error).toContain('event_id');
  });

  it('10 sequential requests produce 10 lines in order', async () => {
    for (let i = 0; i < 10; i++) {
      const req: EventEmissionRequest = {
        kind: 'EventEmissionRequest',
        request_id: 'req-' + i,
        origin_mcp: 'journal',
        event: {
          event_id: 'ev-seq-' + i,
          kind: 'trial_started',
          trial_id: 't-' + i,
        },
      };
      const result = await handleEventEmissionRequest(req);
      expect(result.error).toBeUndefined();
      expect(result.event_id).toBe('ev-seq-' + i);
    }

    const lines = readLines();
    expect(lines).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(JSON.parse(lines[i]).event_id).toBe('ev-seq-' + i);
    }
  });
});