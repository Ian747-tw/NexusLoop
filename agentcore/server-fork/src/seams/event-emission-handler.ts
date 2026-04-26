/**
 * event-emission-handler.ts
 * Fork IPC handler for EventEmissionRequest (PROTOCOL_v1.1.md).
 *
 * Listens for EventEmissionRequest on stdin, validates the event payload,
 * emits via emitEvent (with lock), and replies with EventEmissionAck on stdout.
 * Piggybacks on the existing v1.0 JSON-lines-over-stdio transport.
 * Activated by importing startEventEmissionServer() at fork startup.
 */
import { emitEvent, emitEventBatch } from '../../bridge/event-emitter';
import type { EventEmissionRequest } from '../../bridge/protocol';
import { EventEmissionAck } from '../../bridge/protocol';

// ---------------------------------------------------------------------------
// Known event kinds (generated from nxl_core/events/schema.py)
// ---------------------------------------------------------------------------

const VALID_EVENT_KINDS = new Set([
  'cycle_started',
  'cycle_completed',
  'cycle_failed',
  'tool_requested',
  'tool_completed',
  'tool_failed',
  'hypothesis_created',
  'trial_started',
  'trial_completed',
  'trial_failed',
  'evidence_collected',
  'policy_decision',
  'zone_entered',
  'zone_exited',
  'capsule_built',
  'capsule_resumed',
  'incident_reported',
  'handoff_recorded',
  'skill_registered',
  'compact_requested',
  'soft_trimmed',
  'hard_regenerated',
  'session_clearing',
  'literature_invariant_violated',
  'change_intent_recorded',
  'free_form_trial_started',
  'compaction_tier_entered',
] as const);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateEvent(event: Record<string, unknown>): string | null {
  if (!event || typeof event !== 'object') return 'event must be a non-null object';
  if (!event.event_id || typeof event.event_id !== 'string' || event.event_id.trim() === '') {
    return 'event.event_id must be a non-empty string';
  }
  if (!event.kind || typeof event.kind !== 'string') {
    return 'event.kind must be a non-empty string';
  }
  if (!VALID_EVENT_KINDS.has(event.kind as (typeof VALID_EVENT_KINDS extends Set<infer T> ? T : never))) {
    return `unknown event kind: ${String(event.kind)}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface EventEmissionResult {
  event_id: string;
  error?: string;
}

export async function handleEventEmissionRequest(
  req: EventEmissionRequest,
): Promise<EventEmissionResult> {
  const validationError = validateEvent(req.event);
  if (validationError) {
    return { event_id: '', error: validationError };
  }

  try {
    await emitEvent(req.event);
    return { event_id: String(req.event.event_id) };
  } catch (err) {
    return { event_id: '', error: String(err) };
  }
}

export async function handleEventEmissionBatch(
  requests: EventEmissionRequest[],
): Promise<EventEmissionResult[]> {
  const validEvents: Record<string, unknown>[] = [];
  const results: EventEmissionResult[] = [];

  for (const req of requests) {
    const validationError = validateEvent(req.event);
    if (validationError) {
      results.push({ event_id: '', error: validationError });
    } else {
      results.push({ event_id: String(req.event.event_id) });
      validEvents.push(req.event);
    }
  }

  if (validEvents.length > 0) {
    try {
      await emitEventBatch(validEvents);
    } catch (err) {
      for (let i = 0; i < results.length; i++) {
        if (results[i].error === undefined && i < validEvents.length) {
          results[i] = { event_id: '', error: String(err) };
        }
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Stdio server
// ---------------------------------------------------------------------------

let _buffer = '';
let _running = false;

export function startEventEmissionServer(): void {
  if (_running) return;
  _running = true;

  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', async (chunk: string) => {
    _buffer += chunk;
    let newline: number;
    while ((newline = _buffer.indexOf('\n')) !== -1) {
      const line = _buffer.slice(0, newline);
      _buffer = _buffer.slice(newline + 1);
      if (!line.trim()) continue;

      try {
        const msg = JSON.parse(line);
        if (msg.kind === 'EventEmissionRequest') {
          const result = await handleEventEmissionRequest(msg);
          const ack = EventEmissionAck.parse({
            kind: 'EventEmissionAck',
            request_id: msg.request_id,
            event_id: result.error ? null : result.event_id,
            error: result.error,
          });
          process.stdout.write(JSON.stringify(ack) + '\n');
        }
        // Unknown kinds are silently ignored (forward compatibility)
      } catch {
        // Malformed JSON — ignore per PROTOCOL.md v1.0
      }
    }
  });

  process.stdin.on('end', () => {
    _running = false;
  });
}