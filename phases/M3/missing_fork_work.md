# Missing Fork-Level Work (from Phase D.2 audit)

The following fork-level modifications from VENDOR_BOUNDARY.md do not yet exist as seam files.
These are M3 work items to implement.

## Missing seam files

1. `agentcore/server-fork/src/seams/provider-instrumentation.ts`
   - Should instrument provider adapter with: prompt_bytes, response_bytes, tokens_used, cache_hit, latency_ms, model_version, temperature
   - Required for replay determinism and cost accounting

2. `agentcore/server-fork/src/seams/session-storage.ts`
   - Should swap upstream's message-list session store for events.jsonl pointer
   - Source of truth is the event log

3. `agentcore/server-fork/src/seams/lifecycle-hooks.ts`
   - Should flush pending events to events.jsonl on SIGTERM/SIGINT

4. `agentcore/server-fork/src/seams/subagent-isolation.ts`
   - Should intercept subagent spawn to enforce context firewall

5. `agentcore/server-fork/src/seams/skill-registration.ts`
   - Should register YAML skills as OpenCode slash commands at fork startup

## ADR-005 migration

- cycle-driver.ts should evolve to boundary observer per ADR-005
- Native OpenCode turn loop should be preserved
- LLM marks cycle boundaries via cycle_mcp.start/end