# OpenCode Executor Readiness Surface Audit

## Pinned Surface

- OpenCode package: `agentcore/upstream/packages/opencode`, version `1.14.22`.
- Workspace toolchain: `bun@1.3.13`.
- Native build: `packages/opencode/script/build.ts` compiles `src/index.ts` into `dist/opencode-<platform>-<arch>/bin/opencode`.
- CLI registration: `packages/opencode/src/index.ts` uses strict `yargs` command modules.

## Existing Authority Sources

- `src/provider/models.ts` owns the models.dev schema and bundled snapshot fallback. Its ordinary module path can refresh/cache over the network and is therefore not directly usable without a readiness-mode fence.
- `src/config/config.ts` owns global, project, managed, content, plugin, and provider config semantics. Its ordinary service can insert schema fields, create `.gitignore`, install dependencies, migrate legacy config, and read remote well-known/account config.
- `src/auth/index.ts` owns `auth.json` and `OPENCODE_AUTH_CONTENT` decoding. Its read methods can be reused only behind an enum-only projection.
- `src/provider/provider.ts` merges catalog, config, environment, auth, built-in loaders, plugins, dynamic packages, and provider-specific discovery. General `Provider.Service` initialization is too broad for a no-network/no-write readiness probe.
- `src/server/routes/instance/provider.ts` reports `all` and `connected`, but reaches the broad Provider service and returns complete provider/model data. It is not a bounded observation protocol.

## Selected Seam

Add an OpenCode-internal read-only observation module and CLI command. The module validates ordinary configuration against the committed OpenAPI schema generated from OpenCode's complete `Config.Info` contract and validates file-backed credentials through the schema shared with `Auth.Info`. It then evaluates only the bounded, side-effect-free local precedence needed for the exact requested provider/model. Side-effecting source classes remain excluded; their presence makes the corresponding state `unknown` rather than being ignored.

The command runs from the packaged binary, suppresses ordinary models.dev refresh and database migration, accepts no provider list request, returns no model list, and never constructs a language model.

OpenAI OAuth uses the same pure Codex model-allowance predicate as `CodexAuthPlugin`; credential presence cannot make a model available when normal plugin initialization would remove it. Remote account state is read from the exact database path selected by OpenCode's `OPENCODE_DB`, release-channel, channel-isolation, and `OPENCODE_DISABLE_CHANNEL_DB` rules. The database is opened read-only and is never migrated.

Configured model aliases resolve status against the same catalog key used by `Provider` construction. The packaged built-in provider-package set is shared as static code authority; selected non-bundled package or `file://` authority yields `unknown` without installation or import. Auto-discovered plugin ambiguity uses OpenCode's exact `{plugin,plugins}/*.{ts,js}` file suffix contract, so documentation and cache entries do not block readiness.

Before declaring an exact model available, the observation mirrors OpenCode's
effective local authority: hard-removed, deprecated, and disabled alpha models
are excluded; project configuration and project plugin directories are omitted
when `OPENCODE_DISABLE_PROJECT_CONFIG` is active; and global, explicit,
project, configuration-content, managed-directory, and macOS managed-preference
sources retain OpenCode's precedence. Valid unrelated config and model fields
remain valid because schema acceptance is not narrowed to the readiness
projection. The committed generated schema is compiled with direct
`ajv@8.18.0`; this avoids importing the side-effecting Config service into the
packaged readiness path. Dynamic remote
account configuration, well-known configuration, plugins, custom catalog
sources, unreadable managed authority, or malformed fragments likewise make
the bounded observation unknown.

## Packaging Finding

The committed upstream lock fails a frozen install under the pinned Bun version because `packages/app/package.json` names the moving `ghostty-web#main` branch while the lock resolves revision `20bd361`. The authorized repair pins the manifest and workspace lock specifier to that already-resolved revision; no resolved package version changes.

The readiness package also declares `ajv@8.18.0` directly and uses its JSON Schema 2020 entrypoint. That exact package was already present in the frozen graph; the manifest and lock changes add a direct ownership edge without changing its resolved artifact or any transitive version. The observer separately enforces the exact two-item plugin tuple because the committed generated schema contains `prefixItems` but omits tuple cardinality.

The supported readiness build embeds `test/tool/fixtures/models-api.json` as an explicit local input. At implementation time it is 2,408,942 bytes with SHA-256 `33f836f532fd8ada58f255f11030ff5500d45b0cf7e63587772221050ffb1f48`. No live catalog fetch is part of the build.
