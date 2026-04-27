/**
 * seams/tripwire-gate.test.ts
 * Tests for tripwire-gate seam (VENDOR_BOUNDARY entry 12)
 *
 * Tests:
 * 1. Budget tripwire fires → next dispatch blocked with structured error
 * 2. Acknowledgment clears tripwire → subsequent dispatch allowed
 * 3. Multiple tripwires active simultaneously, each tracked + cleared independently
 * 4. Session restart with active tripwire (replayed from events.jsonl) → still blocked
 */
// @ts-ignore — bun:test is a Bun built-in, not in @types/node
import { describe, it, expect, beforeEach, vi } from 'bun:test';
import {
  isTripwireBlocked,
  fireTripwire,
  acknowledgeTripwire,
  getActiveTripwires,
  isTripwireActive,
  _resetForTest,
} from './tripwire-gate';

// ---------------------------------------------------------------------------
// Spy on emitEvent
// ---------------------------------------------------------------------------

const emittedEvents: Array<Record<string, unknown>> = [];

const mockEmitEvent = vi.fn((event: Record<string, unknown>) => {
  emittedEvents.push(event);
});

vi.mock('../../bridge/event-emitter', () => ({
  emitEvent: mockEmitEvent,
}));

describe('tripwire-gate seam', () => {
  beforeEach(() => {
    emittedEvents.length = 0;
    mockEmitEvent.mockClear();
    _resetForTest();
  });

  // -------------------------------------------------------------------------
  // Test 1: Budget tripwire fires → next dispatch blocked with structured error
  // -------------------------------------------------------------------------
  it('Test 1: fireTripwire() → isTripwireBlocked() returns true; error contains tripwire_id', () => {
    // Fire a tripwire for a NON_NEGOTIABLE rule violation
    const tripwireId = fireTripwire(
      'no_non_negotiable_modification',
      'Rule 2: Modifying NON_NEGOTIABLE_RULES.md is strictly forbidden.',
      'edit_file',
      null,
    );

    // Tripwire ID should be generated and non-empty
    expect(tripwireId).toBeTruthy();
    expect(tripwireId.length).toBeGreaterThan(10);

    // isTripwireBlocked should now return true
    expect(isTripwireBlocked()).toBe(true);

    // getActiveTripwires should contain the fired tripwire
    const active = getActiveTripwires();
    expect(active.has(tripwireId)).toBe(true);
    expect(active.get(tripwireId)?.rule_id).toBe('no_non_negotiable_modification');

    // A TripwireFired event should have been emitted
    expect(mockEmitEvent).toHaveBeenCalled();
    const firedEvent = emittedEvents.find(
      (e) => (e as { event?: Record<string, unknown> }).event?.kind === 'tripwire_fired',
    ) as { event: Record<string, unknown> };
    expect(firedEvent).toBeDefined();
    expect(firedEvent!.event.kind).toBe('tripwire_fired');
    expect(firedEvent!.event.tripwire_id).toBe(tripwireId);
    expect(firedEvent!.event.rule_id).toBe('no_non_negotiable_modification');
  });

  // -------------------------------------------------------------------------
  // Test 2: Acknowledgment clears tripwire → subsequent dispatch allowed
  // -------------------------------------------------------------------------
  it('Test 2: acknowledgeTripwire() clears active tripwire; isTripwireBlocked() → false', () => {
    // Fire a tripwire
    const tripwireId = fireTripwire(
      'no_source_code_deletion',
      'Rule 1: Deleting source code outside logs/ or skills/ is forbidden.',
      'delete_file',
      null,
    );

    expect(isTripwireBlocked()).toBe(true);

    // Acknowledge the tripwire
    const cleared = acknowledgeTripwire(
      tripwireId,
      'operator@nexusloop',
      'Confirmed false positive — test artifact cleanup',
    );

    // acknowledgeTripwire should return true (found and cleared)
    expect(cleared).toBe(true);

    // isTripwireBlocked should now return false
    expect(isTripwireBlocked()).toBe(false);

    // getActiveTripwires should be empty
    expect(getActiveTripwires().size).toBe(0);

    // A TripwireCleared event should have been emitted
    const clearedEvent = emittedEvents.find(
      (e) => (e as { event?: Record<string, unknown> }).event?.kind === 'tripwire_cleared',
    ) as { event: Record<string, unknown> };
    expect(clearedEvent).toBeDefined();
    expect(clearedEvent!.event.kind).toBe('tripwire_cleared');
    expect(clearedEvent!.event.tripwire_id).toBe(tripwireId);
    expect(clearedEvent!.event.acknowledged_by).toBe('operator@nexusloop');
  });

  // -------------------------------------------------------------------------
  // Test 3: Multiple tripwires active simultaneously, each tracked independently
  // -------------------------------------------------------------------------
  it('Test 3: multiple simultaneous tripwires; each acknowledged independently', () => {
    // Fire three tripwires for different rule violations
    const tw1 = fireTripwire('no_source_code_deletion', 'Rule 1 violated', 'delete_file', null);
    const tw2 = fireTripwire(
      'no_non_negotiable_modification',
      'Rule 2 violated',
      'edit_file',
      null,
    );
    const tw3 = fireTripwire('no_permission_check_disabled', 'Rule 3 violated', 'toggle_permission', null);

    // All three should be active
    expect(isTripwireBlocked()).toBe(true);
    expect(getActiveTripwires().size).toBe(3);
    expect(isTripwireActive(tw1)).toBe(true);
    expect(isTripwireActive(tw2)).toBe(true);
    expect(isTripwireActive(tw3)).toBe(true);

    // Acknowledge only tw2
    const cleared2 = acknowledgeTripwire(tw2, 'admin@nexusloop', 'False positive');
    expect(cleared2).toBe(true);

    // tw1 and tw3 should still be active; tw2 should be gone
    expect(isTripwireBlocked()).toBe(true);
    expect(getActiveTripwires().size).toBe(2);
    expect(isTripwireActive(tw1)).toBe(true);
    expect(isTripwireActive(tw2)).toBe(false);
    expect(isTripwireActive(tw3)).toBe(true);

    // Acknowledge remaining two
    acknowledgeTripwire(tw1, 'admin@nexusloop');
    acknowledgeTripwire(tw3, 'admin@nexusloop');

    expect(isTripwireBlocked()).toBe(false);
    expect(getActiveTripwires().size).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 4: Session restart — replay from events.jsonl restores active tripwires
  // -------------------------------------------------------------------------
  it('Test 4: projectTripwiresFromEventLog() replays TripwireFired without Cleared → still blocked', async () => {
    // Simulate: a tripwire was fired, events written to a tmp log
    // Then fresh fork instance starts with cursor pointing at that log
    // The replay should find the un-cleared TripwireFired and restore active state

    const { projectTripwiresFromEventLog } = await import('./tripwire-gate');

    // Simulate events.jsonl content with one fired tripwire and NO cleared event
    const tripwireId = '01H0000000000000000000001';
    const fakeEventsContent = [
      JSON.stringify({
        event_id: '01H0000000000000000000000',
        event: {
          kind: 'tripwire_fired',
          tripwire_id: tripwireId,
          rule_id: 'no_non_negotiable_modification',
          reason: 'Rule 2: Modifying NON_NEGOTIABLE_RULES.md is strictly forbidden.',
          tool_name: 'edit_file',
          session_id: null,
        },
      }),
    ].join('\n');

    // Mock the fs module for this test
    const originalOpenSync = require('fs').openSync;
    const originalReadSync = require('fs').readSync;
    const originalCloseSync = require('fs').closeSync;
    const originalFstatSync = require('fs').fstatSync;

    const mockFd = 999;
    const mockStat = { size: fakeEventsContent.length };

    require('fs').openSync = vi.fn().mockReturnValue(mockFd);
    require('fs').readSync = vi.fn((fd: number, buf: Buffer) => {
      if (fd === mockFd) {
        buf.write(fakeEventsContent, 0);
        return fakeEventsContent.length;
      }
      return originalReadSync(fd, buf);
    });
    require('fs').closeSync = vi.fn();
    require('fs').fstatSync = vi.fn().mockReturnValue(mockStat);

    // Override EVENTS_PATH via module cache trick
    // Since the module caches path, we need to work within the mocked fs
    // We already mocked openSync/readSync/closeSync above which the function uses

    await projectTripwiresFromEventLog(null);

    // After replay, the tripwire should be active
    expect(isTripwireBlocked()).toBe(true);
    expect(isTripwireActive(tripwireId)).toBe(true);

    // Restore original fs functions
    require('fs').openSync = originalOpenSync;
    require('fs').readSync = originalReadSync;
    require('fs').closeSync = originalCloseSync;
    require('fs').fstatSync = originalFstatSync;
  });

  // -------------------------------------------------------------------------
  // Test 4b: Replay clears tripwires that were acknowledged before restart
  // -------------------------------------------------------------------------
  it('Test 4b: replay with TripwireFired followed by TripwireCleared → not blocked', async () => {
    const { projectTripwiresFromEventLog } = await import('./tripwire-gate');

    const tripwireId = '01H0000000000000000000002';
    const firedEventId = '01H0000000000000000000000';
    const clearedEventId = '01H0000000000000000000001';

    const fakeEventsContent = [
      JSON.stringify({
        event_id: firedEventId,
        event: {
          kind: 'tripwire_fired',
          tripwire_id: tripwireId,
          rule_id: 'no_source_code_deletion',
          reason: 'Rule 1 violated',
          tool_name: 'delete_file',
          session_id: null,
        },
      }),
      '\n',
      JSON.stringify({
        event_id: clearedEventId,
        event: {
          kind: 'tripwire_cleared',
          tripwire_id: tripwireId,
          acknowledged_by: 'operator@nexusloop',
          reason: 'False positive',
        },
      }),
    ].join('');

    const mockFd = 999;
    const mockStat = { size: fakeEventsContent.length };

    const originalOpenSync = require('fs').openSync;
    const originalReadSync = require('fs').readSync;
    const originalCloseSync = require('fs').closeSync;
    const originalFstatSync = require('fs').fstatSync;

    require('fs').openSync = vi.fn().mockReturnValue(mockFd);
    require('fs').readSync = vi.fn((fd: number, buf: Buffer) => {
      if (fd === mockFd) {
        buf.write(fakeEventsContent, 0);
        return fakeEventsContent.length;
      }
      return originalReadSync(fd, buf);
    });
    require('fs').closeSync = vi.fn();
    require('fs').fstatSync = vi.fn().mockReturnValue(mockStat);

    await projectTripwiresFromEventLog(null);

    // After replay, the tripwire should NOT be active (was cleared)
    expect(isTripwireBlocked()).toBe(false);
    expect(isTripwireActive(tripwireId)).toBe(false);

    require('fs').openSync = originalOpenSync;
    require('fs').readSync = originalReadSync;
    require('fs').closeSync = originalCloseSync;
    require('fs').fstatSync = originalFstatSync;
  });
});
