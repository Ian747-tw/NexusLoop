# ADR-007: Single Brain architecture

## Context

Earlier design implied Python could hold runtime research state and call into
OpenCode. The Decision + Integration principles already say "no Python LLM
calls," but state residence was unspecified.

## Decision

NexusLoop is one system: research-augmented OpenCode. Runtime research state
(current cycle, program state, registry projection, tier state, capsule cursor,
scheduler queue) lives in the fork's TS session under a `research:` namespace.
Python is a library: schemas, replay verification, ML primitives. Python does
not run the research cycle.

## Consequences

- State is no longer mediated by IPC for read access — the LLM sees it
  natively in its prompt
- Python loses runtime authority but gains clarity of role
- The Single-Writer invariant on `events.jsonl` (ADR-009) becomes enforceable
  because writes have one origin point

## Single-Writer Invariant

The fork is the only writer to events.jsonl at runtime. Python MCPs that need
to record send `EventEmissionRequest` (PROTOCOL_v1.1.md). See ADR-009 for
migration plan.

## Migration

Documentation in P1; `research:` namespace implementation in P2 via seam #12.
