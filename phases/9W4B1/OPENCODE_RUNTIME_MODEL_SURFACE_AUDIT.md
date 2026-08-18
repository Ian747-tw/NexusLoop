# OpenCode Runtime Model Surface Audit

Audit base: `cb83208620e88b2f87f1f7bc8f4e446bc0ea8f8f`.
All upstream paths are read-only evidence.

## Primary Model Ingress

- `agentcore/upstream/packages/opencode/src/config/config.ts:142-147` defines
  global `model` and separate `small_model` configuration.
- `agentcore/upstream/packages/opencode/src/cli/cmd/run.ts:235-239` defines
  `--model`/`-m` in exact `provider/model` form.
- `agentcore/upstream/packages/opencode/src/cli/cmd/run.ts:643-653` sends that
  exact model to command execution or parses it and passes it to
  `sdk.session.prompt`.
- `agentcore/upstream/packages/opencode/src/provider/provider.ts:1708-1713`
  parses the first slash as provider ID and preserves the remaining model ID.

9W4B1 uses only the `run --model` prompt seam. NexusLoop rejects preconfigured
model arguments before adding its exact projection.

## Other Model Ingresses Excluded

- `config.ts:145-147` owns `small_model`.
- `config.ts:160-178` and `config/agent.ts:24-50` own primary, title, summary,
  compaction, and arbitrary agent/subagent model overrides.
- `config/command.ts:17-23` owns command-specific model selection.
- OpenCode session prompt/compaction code may select explicit request, agent,
  prior-session, small, or compaction models.
- `provider/provider.ts:1655-1682` reads recent model state and default models.

9W4B1 writes none of these and supplies no `--agent` or command invocation.

## Catalog, Provider, Auth, And Dynamic Authority

- `provider/models.ts:111-179` loads bundled/cache/models.dev data and refreshes
  it independently.
- `provider/provider.ts:971-1057` converts remote catalog package, API,
  capability, limit, and cost data.
- `provider/provider.ts:1111-1158` loads plugins before merging provider config,
  options, package, URL, and model overrides.
- `provider/provider.ts:1214-1274` discovers environment and stored/plugin auth
  and merges provider options.
- `provider/provider.ts:1385-1523` resolves bundled, npm, and `file://` provider
  SDKs with provider-specific options and fetch behavior.
- `provider/provider.ts:1385` exposes the loaded provider list; server routes
  expose `provider.list` observations.
- `auth/index.ts:9-95` owns `auth.json`, `OPENCODE_AUTH_CONTENT`, API keys,
  OAuth tokens, and well-known credentials.
- `config/config.ts`, `config/plugin.ts`, and plugin loaders accept plugin,
  package, provider option, header, URL, and custom fetch authority.

These surfaces may produce bounded Executor readiness observations only. They
never populate model configuration, static provider mapping, Commander
conformance, or Commander credentials. Commander imports none of them.

## Scope Conclusion

The exact `run --model provider/model` argument is the only safe existing seam
for the primary tactical selection. It is request-scoped, documented by the
local parser, and does not mutate global/user config. All catalog, auth,
provider, plugin, package, recent-model, and auxiliary-model surfaces remain
OpenCode-owned and non-authoritative for Commander.
