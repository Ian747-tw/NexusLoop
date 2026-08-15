# OpenCode Provider Surface Audit

Audit base: `771e27136e5405c7f053321cbb1bc29c1dab9eb5`. Files below are read-only
upstream evidence; 9W4B0 does not modify or import them.

## Catalog And Provider Loading

- `agentcore/upstream/packages/opencode/src/provider/models.ts:110-179`
  selects `OPENCODE_MODELS_URL` or `https://models.dev`, reads a cache or bundled
  snapshot, fetches `/api.json`, refreshes on a timer, and exposes catalog data.
- `agentcore/upstream/packages/opencode/src/provider/provider.ts:971-1010`
  converts catalog provider/model API URL, npm package, capabilities, limits,
  and cost into OpenCode model records.
- `agentcore/upstream/packages/opencode/src/provider/provider.ts:1111-1175`
  loads plugins before provider config, then merges configured provider options,
  model package, API URL, and capabilities with catalog state.
- `agentcore/upstream/packages/opencode/src/provider/provider.ts:1385-1520`
  resolves SDKs from provider options and environment, uses bundled loaders, or
  installs/imports npm and `file://` provider modules.
- `agentcore/upstream/packages/opencode/src/server/routes/instance/provider.ts:15-58`
  implements `provider.list` by combining filtered catalog data with currently
  connected providers and defaults.

## Authentication And Plugins

- `agentcore/upstream/packages/opencode/src/auth/index.ts:9-95` owns
  `auth.json`, `OPENCODE_AUTH_CONTENT`, API keys, OAuth access/refresh tokens,
  and well-known credentials.
- `agentcore/upstream/packages/opencode/src/provider/auth.ts` lets provider
  plugins supply API/OAuth methods and persists successful results through the
  OpenCode auth service.
- `agentcore/upstream/packages/opencode/src/config/plugin.ts:52-85` resolves
  path and `file://` plugins.
- `agentcore/upstream/packages/opencode/src/plugin/loader.ts:65-125` installs,
  checks, and dynamically imports configured npm or file plugins.
- `agentcore/upstream/packages/opencode/src/provider/provider.ts:1111-1115`
  confirms plugin config hooks may mutate provider configuration before it is
  read.

## Options, Headers, Fetch, Streaming, And Retry

- `agentcore/upstream/packages/opencode/src/config/provider.ts` accepts provider
  API/npm identity, arbitrary provider options, model options, headers, and
  provider-specific configuration.
- `agentcore/upstream/packages/opencode/src/session/llm.ts:86-190` loads the
  OpenCode language model, provider, config, and auth, then merges model,
  provider, agent, variant, and plugin-supplied options and headers.
- `agentcore/upstream/packages/opencode/src/session/llm.ts:350-410` calls the
  streaming AI SDK path with provider options, model/plugin headers, an abort
  signal, telemetry, and a configurable retry count.
- Provider loaders in
  `agentcore/upstream/packages/opencode/src/provider/provider.ts` may construct
  custom fetch functions and provider-specific authentication behavior.

## Defaults And Role Overrides

- `agentcore/upstream/packages/opencode/src/config/config.ts:142-176` supports a
  primary `model`, `small_model`, and title/summary/compaction agent references.
- `agentcore/upstream/packages/opencode/src/config/agent.ts` supports per-agent
  model and variant overrides.
- `agentcore/upstream/packages/opencode/src/session/prompt.ts:733-740` selects an
  explicit request model, agent model, or prior-session model.
- `agentcore/upstream/packages/opencode/src/session/prompt.ts:1597-1638` allows
  command, command-agent, request, and prior-session model selection.
- `agentcore/upstream/packages/opencode/src/session/compaction.ts:382-385`
  independently selects the compaction agent model or current user model.

The 9W4B0 `executor` role is therefore only the primary tactical model. It must
not overwrite these auxiliary, command, agent, or subagent choices.

## Package Generations

The upstream OpenCode package and lockfile contain their own broad AI SDK and
provider dependency graph, distinct from the runtime's pinned `ai@7.0.29`,
`@ai-sdk/openai-compatible@3.0.11`, and `@ai-sdk/anthropic@4.0.15` Commander
stack. No upstream package or provider object is imported into the kernel.

## Authority Conclusion

OpenCode catalog presence, authentication, provider connectivity, defaults,
plugins, or successful model loading may later inform Executor availability.
None is static Commander conformance. The following implication is forbidden:

```text
OpenCode supports or authenticates model X
=> Commander may use model X
```
