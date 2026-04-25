# ADR-005: cycle-driver evolves from turn-loop replacement to boundary observer

## Context

M1 implemented cycle-driver.ts as a replacement for OpenCode's native turn loop.
The Integration Principle (CLAUDE.md) says we should use OpenCode's native
patterns where they suffice and only modify the fork where plug-ins can't reach.

## Decision

cycle-driver.ts evolves from "replaces turn loop" to "observes turn loop and
emits typed events at lifecycle points." OpenCode runs its native turn loop;
we hook events at turn-start, tool-call, tool-result, turn-end. The LLM marks
cycle boundaries via `cycle_mcp.start(hypothesis_id)` / `cycle_mcp.end(status)`.

## Consequences

- Fork is thinner; rebase cost lower
- LLM has explicit control over cycle boundaries (research decision, per Decision Principle)
- Native OpenCode turn machinery is preserved unchanged
- Event emission is guaranteed at the lifecycle points we care about

## Migration

Implement in M3 (Phase F.4). Existing cycle-driver.ts stays functional during
migration; new behavior is gated behind a feature flag during transition.
