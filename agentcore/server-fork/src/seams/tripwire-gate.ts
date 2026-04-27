/**
 * seams/tripwire-gate.ts
 * ----------------------
 * Blocks tool dispatches when a NON_NEGOTIABLE rule has been violated.
 *
 * VENDOR_BOUNDARY ENTRY 12
 *
 * Flow:
 *   1. Policy decision returns { kind: "deny_non_negotiable", rule_id, reason }
 *   2. gated-dispatch calls fireTripwire() → adds to active set + emits TripwireFired
 *   3. Next dispatch: isTripwireBlocked() → true → dispatch refused with structured error
 *   4. Human operator sends TripwireAcknowledgment IPC
 *   5. acknowledgeTripwire() → removes from active set + emits TripwireCleared
 *   6. Subsequent dispatch allowed
 *
 * State survives session restart via events.jsonl replay:
 *   On startup, replay finds TripwireFired without matching TripwireCleared
 *   and reconstructs the active-tripwire set.
 */
// @ts-nocheck — uses dynamic imports and process.cwd()
import { emitEvent } from '../../bridge/event-emitter';

interface ActiveTripwire {
  rule_id: string;
  reason: string;
  fired_at: number;
  tool_name?: string;
}

/**
 * ULID-like ID generator (time-sortable, URL-safe).
 * Uses time+entropy rather than crypto for speed.
 */
function makeTripwireId(): string {
  const now = Date.now();
  const timePart = now.toString(16).padStart(12, '0');
  const entropy = Math.floor(Math.random() * 0xffffffffffffffff).toString(16).padStart(16, '0');
  return `01H${timePart}${entropy.slice(0, 12).toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** Active tripwires: tripwireId → info */
const _activeTripwires = new Map<string, ActiveTripwire>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true if any tripwire is currently active.
 * Checked by gated-dispatch before allowing a tool dispatch.
 */
export function isTripwireBlocked(): boolean {
  return _activeTripwires.size > 0;
}

/**
 * Returns a snapshot of currently active tripwires.
 * Used by tests and diagnostics.
 */
export function getActiveTripwires(): Map<string, ActiveTripwire> {
  return new Map(_activeTripwires);
}

/**
 * Fires a tripwire: marks a NON_NEGOTIABLE violation as active and
 * emits a TripwireFired event to events.jsonl.
 *
 * @param ruleId  - Which NON_NEGOTIABLE rule was violated
 * @param reason  - Human-readable explanation
 * @param toolName - Optional: the tool that triggered the violation
 * @param sessionId - Optional: session where violation occurred
 */
export function fireTripwire(
  ruleId: string,
  reason: string,
  toolName: string = '',
  sessionId: string | null = null,
): string {
  const tripwireId = makeTripwireId();
  _activeTripwires.set(tripwireId, {
    rule_id: ruleId,
    reason,
    fired_at: Date.now(),
    tool_name: toolName,
  });

  emitEvent({
    event: {
      kind: 'tripwire_fired',
      tripwire_id: tripwireId,
      rule_id: ruleId,
      reason,
      tool_name: toolName,
      session_id: sessionId,
    },
  });

  return tripwireId;
}

/**
 * Acknowledges and clears a previously fired tripwire.
 *
 * @param tripwireId - ULID of the tripwire to clear
 * @param acknowledgedBy - Operator who acknowledged
 * @param reason - Optional notes from the operator
 * @returns true if the tripwire was found and cleared; false if it was not active
 */
export function acknowledgeTripwire(
  tripwireId: string,
  acknowledgedBy: string,
  reason?: string,
): boolean {
  if (!_activeTripwires.has(tripwireId)) {
    return false;
  }

  _activeTripwires.delete(tripwireId);

  emitEvent({
    event: {
      kind: 'tripwire_cleared',
      tripwire_id: tripwireId,
      acknowledged_by: acknowledgedBy,
      reason: reason ?? null,
    },
  });

  return true;
}

/**
 * Checks if a specific tripwire ID is currently active.
 */
export function isTripwireActive(tripwireId: string): boolean {
  return _activeTripwires.has(tripwireId);
}

// ---------------------------------------------------------------------------
// Replay from events.jsonl
// ---------------------------------------------------------------------------

const EVENTS_PATH = '.nxl/events.jsonl';

/**
 * Reconstructs active tripwires by replaying events.jsonl from cursor.
 * Finds all TripwireFired events without a matching TripwireCleared after them.
 * Clears any stale state before replay.
 *
 * @param cursor - event_id to resume from, or null to start from beginning
 */
export async function projectTripwiresFromEventLog(
  cursor: string | null,
): Promise<void> {
  // Clear any in-memory state before replay
  _activeTripwires.clear();

  let fd: number;
  let content: string;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { openSync, readSync, fstatSync } = require('fs') as typeof import('fs');
    fd = openSync(EVENTS_PATH, 'r');
    const stat = fstatSync(fd);
    const buf = Buffer.alloc(stat.size);
    readSync(fd, buf, 0, stat.size, 0);
    content = buf.toString('utf-8');
  } catch {
    // No events file yet — no tripwires to replay
    return;
  } finally {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { closeSync } = require('fs') as typeof import('fs');
      closeSync(fd);
    } catch {
      // ignore close errors
    }
  }

  const lines = content.split('\n').filter((l: string) => l.trim() !== '');

  // Track fired tripwires that haven't been cleared
  const firedTripwires = new Map<string, { rule_id: string; reason: string }>();

  let started = cursor === null;
  for (const line of lines) {
    if (!started) {
      try {
        const parsed = JSON.parse(line) as { event_id?: string; event?: Record<string, unknown> };
        if (parsed.event_id === cursor) started = true;
      } catch {
        // malformed line — skip
      }
      continue;
    }

    try {
      const record = JSON.parse(line) as { event_id?: string; event?: Record<string, unknown> };
      const event = record.event;
      if (!event) continue;

      const kind = event.kind as string;
      if (kind === 'tripwire_fired') {
        const tw = event as unknown as { tripwire_id: string; rule_id: string; reason: string };
        firedTripwires.set(tw.tripwire_id, {
          rule_id: tw.rule_id,
          reason: tw.reason,
        });
      } else if (kind === 'tripwire_cleared') {
        const tw = event as unknown as { tripwire_id: string };
        firedTripwires.delete(tw.tripwire_id);
      }
    } catch {
      // Malformed line — skip
    }
  }

  // Reconstruct active tripwires from un-cleared ones
  for (const [id, info] of firedTripwires) {
    _activeTripwires.set(id, { ...info, fired_at: 0 });
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Resets module state — for use in tests only */
export function _resetForTest(): void {
  _activeTripwires.clear();
}
