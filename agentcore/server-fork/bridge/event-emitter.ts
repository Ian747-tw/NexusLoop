import { openSync, writeSync, fsyncSync, closeSync } from 'fs';
import { resolve } from 'path';
import * as properLockfile from 'proper-lockfile';

const EVENT_LOG_PATH = resolve(process.cwd(), 'events.jsonl');
const LOCK_PATH = EVENT_LOG_PATH + '.lock';

export async function emitEvent(event: Record<string, unknown>): Promise<void> {
  const line = JSON.stringify(event) + '\n';
  const release = await properLockfile.lock(LOCK_PATH, {
    retries: {
      retries: 10,
      factor: 2,
      minTimeout: 20,
      maxTimeout: 500,
    },
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
    await release();
  }
}

export async function emitEventBatch(
  events: Record<string, unknown>[]
): Promise<void> {
  if (events.length === 0) return;
  const lines = events.map((e) => JSON.stringify(e) + '\n').join('');
  const release = await properLockfile.lock(LOCK_PATH, {
    retries: {
      retries: 10,
      factor: 2,
      minTimeout: 20,
      maxTimeout: 500,
    },
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
    await release();
  }
}