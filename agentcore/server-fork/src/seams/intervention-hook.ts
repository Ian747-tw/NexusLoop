import type { Intervention, InterventionVerb } from '../bridge/protocol';

const VALID_VERBS: InterventionVerb[] = [
  'ask', 'warn', 'narrow', 'deny', 'escalate', 'trap',
  'scaffold', 'redirect', 'explain', 'guide', 'review', 'confirm',
];

const _interventionQueue: Intervention[] = [];
const _syntheticQueue: string[] = [];

export function enqueueIntervention(v: Intervention): void {
  if (!VALID_VERBS.includes(v.verb)) {
    throw new Error(`Invalid intervention verb: ${v.verb}`);
  }
  _interventionQueue.push(v);
}

export function drainInterventionQueue(): Intervention[] {
  const drained = [..._interventionQueue];
  _interventionQueue.length = 0;
  return drained;
}

export function peekInterventionQueue(): Intervention[] {
  return [..._interventionQueue];
}

export function resetInterventionQueue(): void {
  _interventionQueue.length = 0;
}

/** Inject a synthetic /resume <handoff_id> message into the cycle. */
export function enqueueSyntheticResume(handoff_id: string): void {
  _syntheticQueue.push(`/resume ${handoff_id}`);
}

export function drainSyntheticQueue(): string[] {
  const drained = [..._syntheticQueue];
  _syntheticQueue.length = 0;
  return drained;
}

export function peekSyntheticQueue(): string[] {
  return [..._syntheticQueue];
}

export function resetSyntheticQueue(): void {
  _syntheticQueue.length = 0;
}
