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

This is the complete list of upstream OpenCode behavior we modify.
Plug-ins cannot do any of these. If a future change adds another
fork-level modification, append here and bump the rebase impact estimate.

### Named seams (defined at M1)

1. `seams/gated-dispatch.ts` — intercepts every tool call before execution
2. `seams/intervention-hook.ts` — replaces upstream's permission UI with the 12-verb algebra
3. `seams/capsule-session.ts` — provides capsule-as-prefix + cache breakpoint + compaction delegation
4. `seams/cycle-driver.ts` — emits typed events at turn lifecycle points (evolving to "boundary observer" pattern in M3; see ADR-005)

### Additional fork-level modifications

5. Provider call instrumentation — wraps provider adapter to record:
   - prompt_bytes, response_bytes, tokens_used, cache_hit, latency_ms,
     model_version, temperature
   - Required for replay determinism and cost accounting.
   - File: `seams/provider-instrumentation.ts`

6. Session storage swap — upstream's message-list session store is replaced
   by a thin pointer into events.jsonl. Source of truth is the event log.
   - File: `seams/session-storage.ts`

7. Lifecycle flush hooks — graceful shutdown ensures all pending events
   are flushed to events.jsonl before exit. SIGTERM, SIGINT both honored.
   - File: `seams/lifecycle-hooks.ts`

8. Subagent context firewall — when a subagent is spawned with isolation=true,
   upstream's subagent setup is intercepted to enforce no parent context leak.
   - File: `seams/subagent-isolation.ts`

9. Skill registration mechanism — at fork startup, NexusLoop's YAML skills
   are registered as OpenCode slash commands via fork-modified registration.
   - File: `seams/skill-registration.ts`

10. Tripwire dispatch integration — when a tripwire is fired, the gate refuses
    next tool call until acknowledged. Fork-level integration with the gate.
    - File: `seams/tripwire-gate.ts` (added in M4)

11. `--allow-edit-without-approval` policy gating — flags that would bypass
    approval are themselves policy-gated.
    - File: `seams/mode-flag-gate.ts` (added in M4)

### Rebase impact

Each modification adds ~1–3 hours to a rebase. Total rebase budget after
all 11 modifications: <1 day target (M4 exit gate).

## Pinned commit

The pinned commit for this vendor boundary is noted in `agentcore/PINNED_COMMIT.md`.
All seams must be verified against this pinned upstream version.
