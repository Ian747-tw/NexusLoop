import { openSync, writeSync, fsyncSync, closeSync } from 'fs';
import { createHash } from 'crypto';
import { resolve } from 'path';
import * as properLockfile from 'proper-lockfile';

/** Generate a ULID-formatted string (monotonic, URL-safe). */
function _ulid(): string {
  const timePart = Math.floor(Date.now() * 1000).toString(16).padStart(10, '0').slice(0, 10);
  const entropy = Math.floor(Math.random() * 2 ** 80);
  const randPart = entropy.toString(16).padStart(20, '0').slice(0, 12);
  return `01H${timePart}${randPart}`;
}

export function emitEvent(event: Record<string, unknown>): void {
  const EVENT_LOG_PATH = resolve(process.cwd(), 'events.jsonl');
  const LOCK_PATH = EVENT_LOG_PATH + '.lock';
  // Inject event_id and timestamp into the inner event when wrapped
  if (event.event && typeof event.event === 'object') {
    const inner = event.event as Record<string, unknown>;
    if (!inner.event_id) inner.event_id = _ulid();
    if (!inner.timestamp) inner.timestamp = new Date().toISOString();
  }
  const line = JSON.stringify(event) + '\n';
  const release = properLockfile.lockSync(LOCK_PATH, {
    stale: 1,
    updateAgeWhenOpening: true,
  });
  try {
    const fd = openSync(EVENT_LOG_PATH, 'a');
    try {
      writeSync(fd, line, undefined, 'utf-8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } finally {
    release();
  }
}

export function emitEventBatch(
  events: Record<string, unknown>[]
): void {
  if (events.length === 0) return;
  const EVENT_LOG_PATH = resolve(process.cwd(), 'events.jsonl');
  const LOCK_PATH = EVENT_LOG_PATH + '.lock';
  const lines = events.map((e) => JSON.stringify(e) + '\n').join('');
  const release = properLockfile.lockSync(LOCK_PATH, {
    stale: 1,
    updateAgeWhenOpening: true,
  });
  try {
    const fd = openSync(EVENT_LOG_PATH, 'a');
    try {
      writeSync(fd, lines, undefined, 'utf-8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } finally {
    release();
  }
}