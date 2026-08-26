# 9W4E Implementation Brief

1. Add versioned setup catalog/types/service/projection under
   `agentcore/runtime/src/model-configuration/`.
2. Define three exact Commander recipes and three exact Executor recipes from
   existing native protocol evidence; permit either role to be unconfigured.
3. Reconstruct candidates from recipe IDs, validate with ADR-035, project both
   roles, and return bounded safe hashes/readiness fields.
4. Confirm via expected revision/candidate hash and EventStore
   `appendIfLatestKind`; identical writes are idempotent and all others are stale or
   conflicting.
5. Add a bounded Runtime resolver for the packaged 9W4E0 command. It accepts
   only the exact immutable projection and invokes the exact process-adapter
   executable used for launch with fixed `nexusloop executor-readiness-v1`
   arguments. It is lifecycle-owned, capped at 2,048 request bytes, 4,096
   response bytes, five seconds, concurrency two, and zero retries.
6. Project persisted setup during launch and construct the immutable ADR-036
   registry plus Commander provider assertions. Reject explicit/legacy/persisted
   source conflicts. Construct the production resolver from the process
   adapter's immutable executable/cwd/environment authority;
   package-internal resolver injection remains test-only and no production
   environment input can select it.
7. Add canonical RuntimeServer/client commands for catalog, status, preview,
   and confirm. All are pre-start safe; confirmation temporarily acquires or
   reuses the run lock and is lifecycle-owned through durable settlement.
8. Replace the placeholder onboarding panel with keyboard-driven independent
   role selection, preview, explicit confirmation, pending/current selection,
   blocked readiness, and restart-required state.
9. Add red authority/runtime/TUI tests and one real headless CLI/OpenTUI E2E
   proving commit, clean restart, active projections, exact Executor launch
   model, and no secret durability.
10. Add ADR-040 and update implemented architecture/TUI/provider facts.
