# ADR-008: Two-Tier Scheduling

## Context

OpenCode's native turn loop has an inner scheduler that orders tool calls
per-turn. NexusLoop needs cycle-level scheduling (which hypothesis next) on
minute-to-hour scale. These can't share state without conflict.

## Decision

Two schedulers, two layers, two time scales:

- **Inner** (OpenCode native, untouched): per-turn tool dispatch. State:
  `session.messages`, `pending_tool_calls`. Lifecycle hook: every tool call.
- **Outer** (NexusLoop, new seam #13 `scheduler-integration.ts`): cycle
  selection. State: `session.research.scheduler_queue`. Lifecycle hook:
  registered callback into `cycle-driver.ts` for cycle-end events; also fires
  at session_start.
- **No field is shared.** Outer never mutates per-turn state; inner never
  reads `session.research`.

## Relationship to ADR-005

ADR-005 evolved `cycle-driver.ts` from a turn-loop replacement to a boundary
observer (event emitter at lifecycle points). ADR-008 builds on that:
`cycle-driver.ts` exposes a callback registration API, and
`scheduler-integration.ts` registers itself for `cycle_end` events. **No new
`turn-loop-hooks.ts` seam is created** — the brief's original three-seam plan
is reduced to two. Prompt injection at `turn_start` is owned by
`capsule-session.ts` (which already controls the prefix).

## Locked schema (`research:` namespace, Zod)

```typescript
// To be implemented in P2 at seams/research-state.ts
const ResearchNamespace = z.object({
  current_cycle: z.object({
    cycle_id: z.string(),
    hypothesis_id: z.string(),
    started_at: z.number(),
    turn_count: z.number().int().nonnegative(),
  }).nullable(),

  program_state: z.enum([
    'cold_start', 'exploring', 'exploiting',
    'consolidating', 'paused', 'halted',
  ]),

  registry_projection: z.object({
    hypotheses: z.record(z.string(), z.object({
      tier: z.enum(['T0', 'T1', 'T2', 'T3']),
      score: z.number().nullable(),
      last_evidence_event_id: z.string().nullable(),
    })),
    cursor: z.string().nullable(),  // last events.jsonl event_id projected
  }),

  tier_state: z.record(z.string(), z.object({
    promoted_at: z.number().nullable(),
    promotion_evidence: z.array(z.string()),  // event_ids
  })),

  capsule_cursor: z.string().nullable(),

  scheduler_queue: z.array(z.object({
    cycle_proposal_id: z.string(),
    hypothesis_id: z.string(),
    priority: z.number(),
    proposed_by: z.enum(['llm', 'session_start_default']),
    proposed_at: z.number(),
  })),
});
```

## Consequences

- Two-file split (`research-state.ts` + `scheduler-integration.ts`) instead
  of three (no `turn-loop-hooks.ts`)
- Outer scheduler proposals always come from the LLM (Decision Principle
  preserved); TS only ranks/picks from the queue
- Inner scheduler is genuinely untouched — no fork code reaches into
  `pending_tool_calls`

## Migration

Schema locked here; implementation in P2.
