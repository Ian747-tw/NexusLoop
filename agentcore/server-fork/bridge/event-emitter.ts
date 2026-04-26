import { openSync, writeSync, fsyncSync, closeSync, existsSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { resolve } from 'path';
import { withFlock } from '../src/util/posix-flock';

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
  if (!existsSync(LOCK_PATH)) {
    writeFileSync(LOCK_PATH, '');
  }
  if (event.event && typeof event.event === 'object') {
    const inner = event.event as Record<string, unknown>;
    if (!inner.event_id) inner.event_id = _ulid();
    if (!inner.timestamp) inner.timestamp = new Date().toISOString();
  }
  const line = JSON.stringify(event) + '\n';
  withFlock(LOCK_PATH, () => {
    const fd = openSync(EVENT_LOG_PATH, 'a');
    try {
      writeSync(fd, line, undefined, 'utf-8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  });
}

export function emitEventBatch(
  events: Record<string, unknown>[]
): void {
  if (events.length === 0) return;
  const EVENT_LOG_PATH = resolve(process.cwd(), 'events.jsonl');
  const LOCK_PATH = EVENT_LOG_PATH + '.lock';
  if (!existsSync(LOCK_PATH)) {
    writeFileSync(LOCK_PATH, '');
  }
  const lines = events.map((e) => JSON.stringify(e) + '\n').join('');
  withFlock(LOCK_PATH, () => {
    const fd = openSync(EVENT_LOG_PATH, 'a');
    try {
      writeSync(fd, lines, undefined, 'utf-8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  });
}