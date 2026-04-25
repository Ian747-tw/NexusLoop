# Vendor Boundary

This file documents the boundary between vendored upstream code and our seams.

## Boundary Line

```
agentcore/upstream/   ← vendored, read-only (locked)
agentcore/seams/      ← our replacement code
agentcore/server-fork/ ← overlay workspace
```

## Rules

1. **Never modify files under `agentcore/upstream/`**
   - This is a locked vendor snapshot
   - All modifications go through seams

2. **Seams live in `agentcore/seams/`**
   - `gated-dispatch.ts` — replaces tool dispatch
   - `intervention-hook.ts` — replaces permission evaluation
   - `capsule-session.ts` — replaces session/context
   - `cycle-driver.ts` — replaces turn loop processor

3. **Path aliases in server-fork tsconfig.json**
   - `@opencode/*` aliases point to `../upstream/packages/opencode/src/`
   - Allows seams to import upstream types without duplication

4. **Protocol documentation (M1.2 freeze)**
   - `PROTOCOL.md` — defines 9 IPC message types (frozen after M1.1)
   - `SEAM_CONTRACT.md` — freezes 4 seam APIs (8 public functions)
   - `INTERVENTION_ALGEBRA.md` — defines 12 canonical intervention verbs
   - These docs are read-only after M1.1 phase gate

## Fork-Level Modifications (the work the fork actually does)

Counts and statuses on this page are verified by `scripts/audit-fork-depth.sh`.
A modification is "implemented" only if its file exists on disk with substantive
content. See `SEAM_INVENTORY.md` for the audit trail.

This is the complete list of upstream OpenCode behavior we modify.
Plug-ins cannot do any of these. If a future change adds another
fork-level modification, append here and bump the rebase impact estimate.

### Implemented fork-level modifications

1. `seams/gated-dispatch.ts` — intercepts every tool call before execution
2. `seams/intervention-hook.ts` — replaces upstream's permission UI with the 12-verb algebra
3. `seams/capsule-session.ts` — provides capsule-as-prefix + cache breakpoint + compaction delegation
4. `seams/cycle-driver.ts` — emits typed events at turn lifecycle points (evolving to "boundary observer" pattern in M3; see ADR-005)
5. `seams/skill-dispatcher.ts` — at fork startup, NexusLoop's YAML skills are registered as OpenCode slash commands via fork-modified registration
6. `seams/mcp-gate.ts` — wraps OpenCode MCP registry with PolicyEngine; intercepts every MCP tool call before dispatching
7. `seams/research-state.ts` — extends OpenCode session schema with a `research:` namespace (current_cycle, program_state, registry_projection, tier_state, capsule_cursor, scheduler_queue). Schema locked in ADR-008. Populated on session start by reading events.jsonl from cursor.
8. `seams/scheduler-integration.ts` — outer scheduler. TS class holding scheduler_queue, picks next cycle via priority + budget gates. Calls registered callbacks on cycle-driver.ts for cycle_end events. Never enqueues from TS — proposal authority stays with the LLM.

### Planned but not yet implemented

9. `seams/provider-instrumentation.ts` — wraps provider adapter to record:
   - prompt_bytes, response_bytes, tokens_used, cache_hit, latency_ms,
     model_version, temperature
   - Required for replay determinism and cost accounting.
   - STATUS: planned (file does not exist)

10. `seams/session-storage.ts` — upstream's message-list session store is replaced
    by a thin pointer into events.jsonl. Source of truth is the event log.
    - STATUS: planned (file does not exist)

11. `seams/lifecycle-hooks.ts` — graceful shutdown ensures all pending events
    are flushed to events.jsonl before exit. SIGTERM, SIGINT both honored.
    - STATUS: planned (file does not exist)

12. `seams/subagent-isolation.ts` — when a subagent is spawned with isolation=true,
    upstream's subagent setup is intercepted to enforce no parent context leak.
    - STATUS: planned (file does not exist)

13. `seams/tripwire-gate.ts` — when a tripwire is fired, the gate refuses
    next tool call until acknowledged. Fork-level integration with the gate.
    - STATUS: planned (file does not exist)

14. `seams/mode-flag-gate.ts` — `--allow-edit-without-approval` policy gating —
    flags that would bypass approval are themselves policy-gated.
    - STATUS: planned (file does not exist)

### Rebase impact

Each modification adds ~1–3 hours to a rebase. Total rebase budget:
- 8 implemented modifications: ~24 hours (already absorbed)
- 6 planned-but-missing (entries 9-14): ~18 hours budget reserved
- <1 day target for full fork integration (M4 exit gate)

## Pinned commit

The pinned commit for this vendor boundary is noted in `agentcore/PINNED_COMMIT.md`.
All seams must be verified against this pinned upstream version.
