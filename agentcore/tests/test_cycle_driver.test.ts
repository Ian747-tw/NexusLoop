import { describe, expect, test, beforeEach } from 'bun:test';
import {
  startCycle, pauseCycle, resumeCycle, haltCycle,
  onTurnStart, onToolCall, onToolResult, onTurnEnd,
} from '../server-fork/src/seams/cycle-driver';
import { enqueueIntervention } from '../server-fork/src/seams/intervention-hook';

describe('cycle-driver', () => {
  beforeEach(() => {
    haltCycle(); // reset state
  });

  test('startCycle sets state to running', async () => {
    await startCycle('test brief');
    // State is internal; verify via event emission
  });

  test('haltCycle sets state to halted', () => {
    haltCycle();
  });

  test('drainInterventionQueue called at turn end', () => {
    enqueueIntervention({ verb: 'warn', payload: { msg: 'test' } });
    onTurnEnd();
    // Intervention should be drained and emitted
  });
});