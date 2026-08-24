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

Add an OpenCode-internal read-only observation module and CLI command. The module shares the authoritative OpenCode schemas and local source precedence needed for the exact requested provider/model, but excludes side-effecting source classes. Excluded source classes make the corresponding state `unknown`; they are not silently ignored and never become `unavailable` evidence.

The command runs from the packaged binary, suppresses ordinary models.dev refresh and database migration, accepts no provider list request, returns no model list, and never constructs a language model.

## Packaging Finding

The committed upstream lock fails a frozen install under the pinned Bun version because `packages/app/package.json` names the moving `ghostty-web#main` branch while the lock resolves revision `20bd361`. The authorized repair pins the manifest and workspace lock specifier to that already-resolved revision; no resolved package version changes.

The supported readiness build embeds `test/tool/fixtures/models-api.json` as an explicit local input. At implementation time it is 2,408,942 bytes with SHA-256 `33f836f532fd8ada58f255f11030ff5500d45b0cf7e63587772221050ffb1f48`. No live catalog fetch is part of the build.
