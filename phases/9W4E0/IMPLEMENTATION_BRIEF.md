# 9W4E0 Implementation Brief

1. Repair `agentcore/upstream/bun.lock` only as required for `bun@1.3.13 --frozen-lockfile`.
2. Add strict protocol types/parser under the OpenCode CLI domain.
3. Add a read-only OpenCode-owned observer that validates complete ordinary config/auth schemas and the bounded effective default model cache, then evaluates only the exact requested provider/model and credential presence.
4. Register `opencode nexusloop executor-readiness-v1` without normal startup migration/refresh side effects.
5. Make the native build consume an explicit pinned catalog fixture for reproducible prerequisite validation.
6. Add upstream unit tests for parsing, exactness, ambiguity, redaction, no writes/network, and deterministic output.
7. Add a package verifier that copies only the built executable outside the repository and verifies source independence. Separately run the final packaging gate from a detached checkout with no inherited dependency directories, frozen-install twice, build, and run the verifier.
8. Update ADR/architecture documentation with implemented prerequisite behavior only.
9. Run full upstream, Runtime, TUI, CLI, and detached historical gates.

## Future upstream-update gate

Any later synchronization with upstream OpenCode must add or update a
differential fixture gate before the readiness command can be accepted. For
every fixture where the bounded observer reports both `available` and
`connected`, normal offline OpenCode provider resolution must resolve the same
case-sensitive provider and model from the same config, catalog, plugin, and
auth state. The comparison must perform no provider request and must fail the
update on disagreement. This is an upstream-update guard against semantic drift
in the intentionally bounded readiness-state mirror; it is not evidence that
the current command delegates selection authority to normal provider loading.
