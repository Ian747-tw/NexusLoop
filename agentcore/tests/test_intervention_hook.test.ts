import { describe, expect, test, afterEach } from 'bun:test';
import { enqueueIntervention, drainInterventionQueue, peekInterventionQueue, resetInterventionQueue } from '../server-fork/src/seams/intervention-hook';
import type { InterventionVerb } from '../server-fork/bridge/protocol';

afterEach(() => {
  resetInterventionQueue();
});

describe('intervention-hook', () => {
  test('enqueue adds to queue', () => {
    enqueueIntervention({ verb: 'warn', payload: { msg: 'test' } });
    expect(peekInterventionQueue()).toHaveLength(1);
  });

  test('drain empties queue', () => {
    enqueueIntervention({ verb: 'ask', payload: { tool: 'write' } });
    const drained = drainInterventionQueue();
    expect(drained).toHaveLength(1);
    expect(peekInterventionQueue()).toHaveLength(0);
  });

  test('invalid verb throws', () => {
    expect(() => {
      enqueueIntervention({ verb: 'invalid_verb' as InterventionVerb, payload: null });
    }).toThrow();
  });

  test('all 12 verbs enqueue successfully', () => {
    const verbs = ['ask', 'warn', 'narrow', 'deny', 'escalate', 'trap',
                   'scaffold', 'redirect', 'explain', 'guide', 'review', 'confirm'];
    for (const verb of verbs) {
      enqueueIntervention({ verb: verb as InterventionVerb, payload: {} });
    }
    expect(drainInterventionQueue()).toHaveLength(12);
  });
});
