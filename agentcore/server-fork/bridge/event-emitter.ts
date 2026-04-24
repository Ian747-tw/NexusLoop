import { appendFileSync } from 'fs';
import { resolve } from 'path';

const EVENT_LOG_PATH = resolve(process.cwd(), 'events.jsonl');

export function emitEvent(event: Record<string, unknown>): void {
  const line = JSON.stringify(event) + '\n';
  appendFileSync(EVENT_LOG_PATH, line, 'utf-8');
}
