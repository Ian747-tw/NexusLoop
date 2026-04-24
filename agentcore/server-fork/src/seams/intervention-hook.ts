import type { Intervention, InterventionVerb } from '../bridge/protocol';

const VALID_VERBS: InterventionVerb[] = [
  'ask', 'warn', 'narrow', 'deny', 'escalate', 'trap',
  'scaffold', 'redirect', 'explain', 'guide', 'review', 'confirm',
];

const _interventionQueue: Intervention[] = [];

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
