# 9W4E Model Setup Surface Audit

## Current Ingresses

- Project initialization: TUI `ProjectUninitialized` -> init choice -> the
  existing non-authoritative `initialize` shell action.
- Model configuration: ADR-035 pure validators and projections under
  `agentcore/runtime/src/model-configuration/`.
- Runtime registry: `RuntimeServerOptions.modelProfileRuntimeRegistry`, deeply
  revalidated and immutable by `ModelProfileRuntimeRegistry`.
- Commander authority: legacy validated
  `NXL_COMMANDER_INVESTIGATION_*` configuration, static conformance, connector
  registry, and provider readiness.
- Executor authority: static provider mapping and exact primary OpenCode
  `--model provider/model` launch projection.
- Connector construction: `NXL_EXTERNAL_API_CONNECTORS_JSON`; connector URLs,
  headers, credential references, and environment names remain outside model
  configuration.
- Credential resolution: Commander through `ExternalApiRequestService`;
  Executor through its independent readiness resolver.
- OpenCode observations: availability/connection evidence only; no selection
  or Commander conformance authority.
- Runtime startup: `createRuntimeServerFromLaunchConfig` and
  `readRuntimeServerLaunchOptionsFromEnv`.
- Runtime client: canonical `RuntimeServer.command`, `RuntimeServerClient`, and
  `TuiRuntimeServerClient` routing.
- TUI: `providerOnboarding` is currently static display state; init selection
  enters the main shell without durable model authority.
- Durability: `.nxl/events.jsonl` through `EventStore.appendIfLatest`; no model
  setup event exists at the base.

## 9W4E Seam

9W4E adds one model-setup domain under runtime model configuration. The launch
factory projects committed setup before RuntimeServer construction. Runtime
commands expose catalog/status/preview/confirm only. OpenTUI displays and stages
those safe DTOs and sends exact hashes back for confirmation.

No other ingress may override the selection. Existing explicit registry and
legacy environment inputs conflict with persisted authority. Executor launch
continues to inject exactly one primary `--model` argument and leaves every
auxiliary model untouched.

## Pinned OpenCode Observation Boundary

The pinned OpenCode `provider.list` route remains unsuitable as a Runtime DTO:
it exposes broad provider/model records and its connected list is not exact
credential evidence. 9W4E instead consumes the command packaged by 9W4E0:
`opencode nexusloop executor-readiness-v1`.

The packaged command owns the audited OpenCode-side catalog, configuration,
plugin, and authentication semantics. It accepts one exact selected identity,
discards unrelated providers/models and raw state, and emits only the echoed
identity, independent availability/credential enums, and deterministic
evidence ID. It performs no provider request, discovery refresh, mutation,
fallback, or retry. Partial or dynamic authority remains unknown.

Runtime never imports OpenCode provider, auth, config, plugin, or catalog
modules. It invokes the exact validated process-adapter command used for
Executor launch, replacing launch arguments with only the fixed readiness
subcommand. The same cwd and parent-plus-configured environment policy is used.
No readiness-specific executable, Bun config, preload, module path, dependency
path, or environment assertion exists.

Runtime caps request/output at 2,048/4,096 bytes, timeout at five seconds, and
concurrency at two. It requires exactly one newline-terminated flat JSON
observation, rejects identity/version/evidence drift, performs zero retries,
and owns cancellation plus shutdown drain. Failures become unknown readiness;
they never alter selection.
