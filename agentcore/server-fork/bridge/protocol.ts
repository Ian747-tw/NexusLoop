/**
 * bridge/protocol.ts
 * -----------------
 * TypeScript Zod schemas for all IPC message types.
 * Single source of truth for the Python↔TS protocol contract.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Session Context (carried in requests)
// ---------------------------------------------------------------------------

export const SessionCtx = z.object({
  cycle_id: z.string(),
  turn: z.number().int().nonnegative(),
  capsule_bytes: z.string(), // base64
  provider: z.enum(['anthropic', 'openai', 'ollama']),
});
export type SessionCtx = z.infer<typeof SessionCtx>;

// ---------------------------------------------------------------------------
// Python → TS (Decisions and State)
// ---------------------------------------------------------------------------

// Policy gate result — discriminated union
export const PolicyDecision = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('allow') }),
  z.object({ kind: z.literal('deny'), reason: z.string() }),
  z.object({ kind: z.literal('deny_non_negotiable'), rule_id: z.string(), reason: z.string() }),
  z.object({ kind: z.literal('ask'), verb: z.string(), payload: z.unknown() }),
  z.object({
    kind: z.literal('narrow'),
    narrowed_args: z.record(z.string(), z.unknown()),
    reason: z.string(),
  }),
]);
export type PolicyDecision = z.infer<typeof PolicyDecision>;

// Capsule assembled by nxl_core at cycle start
export const CapsuleResponse = z.object({
  prefix: z.string(),
  cache_break: z.string(),
});
export type CapsuleResponse = z.infer<typeof CapsuleResponse>;

// Compaction produced by nxl_core.capsule.compact
export const CompactResponse = z.object({
  new_prefix: z.string(),
  new_cache_break: z.string(),
  events_emitted: z.number().int().nonnegative(),
});
export type CompactResponse = z.infer<typeof CompactResponse>;

// Intervention verb vocabulary — single source of truth for the 12-verb algebra
export type InterventionVerb =
  | 'ask' | 'warn' | 'narrow' | 'deny' | 'escalate' | 'trap'
  | 'scaffold' | 'redirect' | 'explain' | 'guide' | 'review' | 'confirm';

// Intervention queued by Python side
export const Intervention = z.object({
  verb: z.string(),
  payload: z.unknown(),
});
export type Intervention = z.infer<typeof Intervention>;

// Cycle lifecycle control
export const CycleControl = z.object({
  action: z.enum(['start', 'pause', 'resume', 'halt']),
  provider: z.enum(['anthropic', 'openai', 'ollama']).optional(),
});
export type CycleControl = z.infer<typeof CycleControl>;

// ---------------------------------------------------------------------------
// TS → Python (Requests and Events)
// ---------------------------------------------------------------------------

// Request policy decision before tool dispatch
export const ToolCallRequest = z.object({
  id: z.string(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
  ctx: SessionCtx,
});
export type ToolCallRequest = z.infer<typeof ToolCallRequest>;

// Result of tool call attempt
export const ToolCallResult = z.object({
  id: z.string(),
  allowed: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export type ToolCallResult = z.infer<typeof ToolCallResult>;

// Request capsule prefix at cycle start
export const CapsuleRequest = z.object({
  cycle_id: z.string(),
});
export type CapsuleRequest = z.infer<typeof CapsuleRequest>;

// Upstream detected context overflow; request compaction
export const CompactRequest = z.object({
  cycle_id: z.string(),
  tier_hint: z.enum(['soft', 'hard', 'clear']),
  current_token_count: z.number().int().nonnegative(),
  reason: z.string(),
});
export type CompactRequest = z.infer<typeof CompactRequest>;

// Generic event emission at lifecycle points
export const EventEmission = z.object({
  event: z.record(z.string(), z.unknown()),
});
export type EventEmission = z.infer<typeof EventEmission>;

// ---------------------------------------------------------------------------
// Skill IPC (Python ↔ TS)
// ---------------------------------------------------------------------------

export const SkillRegistration = z.object({
  name: z.string(),
  description: z.string(),
  triggers: z.array(z.string()),
  inputs: z.record(z.string(), z.string()),
  outputs: z.record(z.string(), z.string()),
  steps_count: z.number().int().nonnegative(),
  budgets: z.record(z.string(), z.unknown()).optional(),
});
export type SkillRegistration = z.infer<typeof SkillRegistration>;

export const SkillInvoked = z.object({
  skill_name: z.string(),
  invocation_id: z.string(),
  args: z.record(z.string(), z.unknown()).optional(),
});
export type SkillInvoked = z.infer<typeof SkillInvoked>;

export const SkillCompleted = z.object({
  skill_name: z.string(),
  invocation_id: z.string(),
  success: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export type SkillCompleted = z.infer<typeof SkillCompleted>;

// ---------------------------------------------------------------------------
// Tripwire IPC (Python ↔ TS)
// ---------------------------------------------------------------------------

// Python → TS: human operator acknowledged a fired tripwire
export const TripwireAcknowledgment = z.object({
  kind: z.literal('TripwireAcknowledgment'),
  tripwire_id: z.string(),
  acknowledged_by: z.string(),
  reason: z.string().optional(),
});
export type TripwireAcknowledgment = z.infer<typeof TripwireAcknowledgment>;

// TS → Python: result of a tripwire acknowledgment attempt
export const TripwireAcknowledgmentResult = z.object({
  kind: z.literal('TripwireAcknowledgmentResult'),
  tripwire_id: z.string(),
  cleared: z.boolean(),
  error: z.string().optional(),
});
export type TripwireAcknowledgmentResult = z.infer<typeof TripwireAcknowledgmentResult>;