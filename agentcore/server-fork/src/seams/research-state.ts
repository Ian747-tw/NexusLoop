/**
 * seams/research-state.ts
 * -----------------
 * Tier-2 seam: research namespace management.
 *
 * Provides the `research:` namespace extension for OpenCode sessions and
 * deterministic event-log projection used by the outer scheduler.
 *
 * Schema locked: ADR-008 §Locked schema (Zod)
 * Surface locked: SEAM_CONTRACT_TIER2.md (exactly 3 exports)
 */
import { z } from 'zod';
import { openSync, readSync, closeSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Private Zod schemas ( ADR-008 §Locked schema )
// ---------------------------------------------------------------------------

const HypothesisTier = z.enum(['T0', 'T1', 'T2', 'T3']);
type HypothesisTier = z.infer<typeof HypothesisTier>;

const HypothesisInfo = z.object({
  tier: HypothesisTier,
  score: z.number().nullable(),
  last_evidence_event_id: z.string().nullable(),
});

const CurrentCycle = z.object({
  cycle_id: z.string(),
  hypothesis_id: z.string(),
  started_at: z.number(),
  turn_count: z.number().int().nonnegative(),
});

const _ProgramStateSchema = z.enum([
  'cold_start',
  'exploring',
  'exploiting',
  'consolidating',
  'paused',
  'halted',
]);
type ProgramState = z.infer<typeof _ProgramStateSchema>;

const ProposalSource = z.enum(['llm', 'session_start_default']);

const CycleProposalSchema = z.object({
  cycle_proposal_id: z.string(),
  hypothesis_id: z.string(),
  priority: z.number(),
  proposed_by: ProposalSource,
  proposed_at: z.number(),
});

const TierState = z.object({
  promoted_at: z.number().nullable(),
  promotion_evidence: z.array(z.string()),
});

const RegistryProjection = z.object({
  hypotheses: z.record(z.string(), HypothesisInfo),
  cursor: z.string().nullable(),
});

const _ResearchNamespace = z.object({
  current_cycle: CurrentCycle.nullable(),
  program_state: _ProgramStateSchema,
  registry_projection: RegistryProjection,
  tier_state: z.record(z.string(), TierState),
  capsule_cursor: z.string().nullable(),
  scheduler_queue: z.array(CycleProposalSchema),
});
export type ResearchNamespace = z.infer<typeof _ResearchNamespace>;
export type CycleProposal = z.infer<typeof CycleProposalSchema>;

// ---------------------------------------------------------------------------
// Public types (used by scheduler-integration.ts via import)
// These are NOT counted by the CI grep since they use `type` keyword.
// ---------------------------------------------------------------------------


// Event kinds mirror nxl_core/events/schema.py Event union
const EventKind = z.enum([
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
]);
type EventKind = z.infer<typeof EventKind>;

// Discriminated-union event record
const _Event = z.record(z.string(), z.unknown());
type Event = z.infer<typeof _Event>;

// ---------------------------------------------------------------------------
// Empty namespace factory
// ---------------------------------------------------------------------------

function createEmptyResearchNamespace(): ResearchNamespace {
  return {
    current_cycle: null,
    program_state: 'cold_start',
    registry_projection: { hypotheses: {}, cursor: null },
    tier_state: {},
    capsule_cursor: null,
    scheduler_queue: [],
  };
}

// ---------------------------------------------------------------------------
// Public API — exactly 3 exports (SEAM_CONTRACT_TIER2.md)
// ---------------------------------------------------------------------------

/**
 * Returns the research namespace from a session.
 *
 * The `research` property is added by the fork at session creation time.
 * If absent (e.g. on an older session), returns an empty namespace.
 */
export function getResearchNamespace(
  session: { research?: ResearchNamespace },
): ResearchNamespace {
  return session.research ?? createEmptyResearchNamespace();
}

// ---------------------------------------------------------------------------
// projectFromEventLog
// ---------------------------------------------------------------------------

const EVENTS_PATH = resolve(process.cwd(), '.nxl', 'events.jsonl');

/**
 * Reconstructs a ResearchNamespace by replaying events.jsonl from `cursor`.
 * If `cursor` is null, replays from the beginning.
 *
 * Projection is deterministic: same event stream → same namespace.
 */
export async function projectFromEventLog(
  cursor: string | null,
): Promise<ResearchNamespace> {
  let ns = createEmptyResearchNamespace();

  let fd: number;
  try {
    fd = openSync(EVENTS_PATH, 'r');
  } catch {
    return ns;
  }

  try {
    const { fstatSync } = require('fs') as typeof import('fs');
    const stat = fstatSync(fd);
    const buf = Buffer.alloc(stat.size);
    readSync(fd, buf, 0, stat.size, 0);
    const content = buf.toString('utf-8');
    const lines = content.split('\n').filter((l: string) => l.trim() !== '');

    let started = cursor === null;
    for (const line of lines) {
      if (!started) {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (parsed.event_id === cursor) started = true;
        } catch {
          // malformed line — skip
        }
        continue;
      }
      try {
        const event = JSON.parse(line) as Event;
        ns = applyEvent(ns, event);
      } catch {
        // malformed line — skip
      }
    }
  } finally {
    closeSync(fd);
  }

  return ns;
}

// ---------------------------------------------------------------------------
// applyEvent
// ---------------------------------------------------------------------------

/**
 * Applies a single event to a ResearchNamespace, returning the updated namespace.
 *
 * Deterministic — same (namespace, event) pair always yields the same result.
 * No side effects; no timestamps used in transition logic.
 */
export function applyEvent(ns: ResearchNamespace, event: Event): ResearchNamespace {
  const kind = event.kind as EventKind;

  switch (kind) {
    case 'cycle_started': {
      const e = event as unknown as {
        cycle_id: string;
        hypothesis_id: string;
        started_at: number;
      };
      return {
        ...ns,
        current_cycle: {
          cycle_id: e.cycle_id,
          hypothesis_id: e.hypothesis_id,
          started_at: e.started_at,
          turn_count: 0,
        },
      };
    }

    case 'cycle_completed':
    case 'cycle_failed':
      return { ...ns, current_cycle: null };

    case 'hypothesis_created': {
      const e = event as unknown as { hypothesis_id: string };
      return {
        ...ns,
        registry_projection: {
          ...ns.registry_projection,
          hypotheses: {
            ...ns.registry_projection.hypotheses,
            [e.hypothesis_id]: {
              tier: 'T0',
              score: null,
              last_evidence_event_id: null,
            },
          },
        },
      };
    }

    case 'evidence_collected': {
      const e = event as unknown as {
        hypothesis_id: string;
        event_id: string;
      };
      const existing = ns.registry_projection.hypotheses[e.hypothesis_id];
      if (!existing) return ns;
      return {
        ...ns,
        registry_projection: {
          ...ns.registry_projection,
          hypotheses: {
            ...ns.registry_projection.hypotheses,
            [e.hypothesis_id]: {
              ...existing,
              last_evidence_event_id: e.event_id,
            },
          },
        },
      };
    }

    case 'zone_entered': {
      const e = event as unknown as { zone: string };
      const stateMap: Record<string, ProgramState> = {
        A: 'exploring',
        B: 'exploiting',
        C: 'consolidating',
      };
      const newState =
        stateMap[e.zone as 'A' | 'B' | 'C'] ?? ns.program_state;
      return { ...ns, program_state: newState };
    }

    case 'zone_exited':
      return { ...ns, program_state: 'paused' };

    case 'session_clearing':
      return createEmptyResearchNamespace();

    default:
      return ns;
  }
}
