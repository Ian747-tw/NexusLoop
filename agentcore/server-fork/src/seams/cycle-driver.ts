import { emitEvent } from '../../bridge/event-emitter';
import { enqueueIntervention, drainInterventionQueue } from './intervention-hook';
import type { CycleControl } from '../../bridge/protocol';

type CycleState = 'idle' | 'running' | 'paused' | 'halted';

let _cycleState: CycleState = 'idle';
let _turnCount = 0;

export async function startCycle(brief: string): Promise<void> {
  _cycleState = 'running';
  _turnCount = 0;
  await emitEvent({ event: { kind: 'CycleStarted', brief, timestamp: Date.now() } });
}

export function pauseCycle(): void {
  _cycleState = 'paused';
  emitEvent({ event: { kind: 'CyclePaused', turn: _turnCount, timestamp: Date.now() } });
}

export function resumeCycle(): void {
  _cycleState = 'running';
  // Drain intervention queue at safe point
  const interventions = drainInterventionQueue();
  for (const intervention of interventions) {
    emitEvent({ event: { kind: 'InterventionApplied', ...intervention, timestamp: Date.now() } });
  }
  emitEvent({ event: { kind: 'CycleResumed', turn: _turnCount, timestamp: Date.now() } });
}

export function haltCycle(): void {
  _cycleState = 'halted';
  emitEvent({ event: { kind: 'CycleHalted', turn: _turnCount, timestamp: Date.now() } });
}

export function onTurnStart(turn: number): void {
  _turnCount = turn;
  emitEvent({ event: { kind: 'TurnStarted', turn, timestamp: Date.now() } });
}

export function onToolCall(name: string, args: Record<string, unknown>): void {
  emitEvent({ event: { kind: 'ToolCallRequested', name, args, turn: _turnCount, timestamp: Date.now() } });
}

export function onToolResult(name: string, result: unknown, error?: string): void {
  emitEvent({ event: { kind: 'ToolCallCompleted', name, result, error, turn: _turnCount, timestamp: Date.now() } });
}

export function onTurnEnd(): void {
  emitEvent({ event: { kind: 'TurnEnded', turn: _turnCount, timestamp: Date.now() } });
  // Safe point: drain interventions
  const interventions = drainInterventionQueue();
  for (const intervention of interventions) {
    emitEvent({ event: { kind: 'InterventionApplied', ...intervention, timestamp: Date.now() } });
  }
}