# 9W4E0 Scope Questions

## Resolved

1. **What owns readiness observation?** The packaged pinned OpenCode CLI owns it. Runtime will later invoke the same executable used for Executor launch.
2. **What is authority?** The request is an assertion from NexusLoop's immutable Executor projection. The response is observation only.
3. **Can the command call `Provider.Service` directly?** No. Its general initialization can load/install plugins and run provider-specific discovery. The command uses a dedicated read-only OpenCode-owned observation service over shared config/auth/catalog schemas.
4. **How are plugin effects handled?** Any external plugin or plugin-origin configuration that could alter the requested provider/model makes availability `unknown`; plugin code is not executed.
5. **How are remote configuration sources handled?** Well-known auth, active account configuration, and other network-dependent configuration make affected observation `unknown`; no request is made.
6. **How is the model catalog obtained?** Only the build-bundled models snapshot and explicit local OpenCode configuration are eligible. Runtime refresh and cache files are not authority for this command.
7. **What counts as connected?** A valid OpenCode API auth entry, a valid built-in OpenAI OAuth entry with refresh authority, or a present value for one of the selected provider's OpenCode-owned credential environment keys. Source names and values never leave OpenCode. Built-in OpenAI OAuth also applies the normal Codex plugin's exact model filter before availability can be `available`. Other OAuth and special multi-part or network-derived authentication return `unknown` unless exact offline semantics are implemented.
8. **Can a missing provider/model be `unavailable`?** Only when the local observation is complete and no plugin/remote/dynamic source could add it. Otherwise it is `unknown`.
9. **Can the command mutate config to normalize it?** No. Legacy config migration, schema insertion, dependency installation, `.gitignore` writes, auth writes, cache writes, and database migration are disabled for this command.
10. **Which database is inspected for remote configuration authority?** The exact path selected by the pinned OpenCode database policy: `OPENCODE_DB` when configured, the standard release-channel path when applicable, or the sanitized channel-specific path. `:memory:` cannot be inspected across the process boundary and makes readiness unknown.
10. **What is packaged?** The ordinary native OpenCode binary. The readiness command is a CLI subcommand compiled into that binary, not a separate source runner.
11. **What is the protocol?** One strict versioned JSON request on stdin and one strict versioned JSON response on stdout; diagnostics are bounded and stderr-only.
12. **Does this activate 9W4E?** No. Runtime integration and first-run setup remain blocked until this prerequisite merges.
13. **How does the side-effect-free observer validate ordinary OpenCode config and auth?** Config fragments are checked with JSON Schema 2020 semantics against the committed OpenAPI `Config` schema generated from `Config.Info`, plus the exact fixed plugin-tuple cardinality absent from that generated artifact; file-backed auth entries use the same schema exported by `Auth.Info`. Malformed environment auth overrides make the observation incomplete instead of being silently filtered, preserving their separate OpenCode precedence without claiming readiness.

## Packaging Decisions

- The lock repair changes only the `ghostty-web` manifest and workspace lock specifier from the moving `main` branch to the already-resolved `20bd361` revision.
- `packages/opencode` declares `ajv@8.18.0` directly so the packaged command can validate the committed OpenAPI config schema without relying on a transitive dependency. The version was already resolved in the workspace lock; the lock change adds only the direct workspace edge.
- The packaged build consumes the checked-in model snapshot by explicit path. Its identity is recorded in the surface audit and the detached final gate verifies the build without network catalog input.
