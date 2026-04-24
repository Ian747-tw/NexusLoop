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