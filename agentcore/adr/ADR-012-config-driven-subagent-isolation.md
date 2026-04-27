# ADR-012: config-driven subagent isolation

## Context

VENDOR_BOUNDARY entry 11 (P4.4) calls for a seam that enforces "no parent
context leak" when a subagent is spawned with `isolation=true`. The naive
implementation would add a parameter to the `TaskTool.execute` call:

```typescript
// WRONG — parameter-driven isolation
yield* sessions.create({
  parentID: ctx.sessionID,  // ← always set
  isolation: true,           // ← magic parameter
  ...
})
```

This is wrong for two reasons:

1. **Parameter burden on LLM**: The LLM would need to know to pass
   `isolation=true` on every `task` call where it wants isolation. The LLM
   makes research decisions; it shouldn't also manage system properties.

2. **Upstream coupling**: Adding `isolation` to upstream's TaskTool schema
   requires vendor modification. The fork is supposed to be isolatable.

## Decision

Isolation is a property of the **subagent type** (object), not of the
**spawn call** (action). This is a corollary of the Decision Principle:
research decisions live in LLM calls; system properties live in config.

A subagent type either IS isolated (always) or IS NOT (never). The fork
reads NexusLoop's subagent registry at startup, looks up the type, applies
firewall accordingly. The LLM just calls `task(subagent_type="second_review")`
— it doesn't need to know which subagents are isolated.

```
agentcore/subagents/registry.yaml
─────────────────────────────────
second_review:
  isolated: true   ← system property, never on LLM call
  purpose: tier_promotion_verification
```

The `__nexusloop_isolated` flag in `ctx.extra` is **metadata-only** for
downstream NexusLoop code. It is NOT load-bearing for isolation. The
load-bearing action is stripping `parentID` from the session create args
before upstream's `TaskTool` creates the child session.

## Mechanism

1. `subagent-registry.ts` loads `agentcore/subagents/registry.yaml` at startup
2. `subagent-isolation.ts` intercepts `TaskTool.def.init()` — wraps the
   returned `execute` function
3. On each `task` call: look up `subagent_type` in registry
   - If `isolated: true`: strip `parentID` from args → child gets no parent history
   - If not registered: passthrough (vanilla OpenCode behavior preserved)
4. `SubagentSpawned` + `SubagentCompleted` events emitted for audit

## Why not a naming convention?

A convention like `subagent_type="explore:isolated"` would work but is
fragile: collision-prone, requires LLM to learn internal conventions,
and leaks implementation details into the research layer.

Config-driven is cleaner: the LLM calls `second_review` (a natural name);
the fork looks up `second_review` in the registry and applies the right
policy automatically.

## Alternatives considered

- **Parameter-driven (`isolation=true` on call)**: Rejected — parameter
  burden on LLM, requires upstream schema modification.
- **Naming convention suffix**: Rejected — fragile, leaks implementation.
- **Upstream modification to add isolation to Agent.Service**: Rejected —
  vendor modification breaks the fork isolation property.

## Consequences

- Adding a new isolated subagent type: add entry to `registry.yaml`
  (no code change needed)
- Adding a new vanilla subagent type: no change (passthrough by default)
- Removing a subagent from the registry: reverts to passthrough (safe)