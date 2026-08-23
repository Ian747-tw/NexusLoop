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

The pinned OpenCode `provider.list` route was audited but is not used as the
production observation source. `server/routes/instance/provider.ts` returns
full provider/model records and a `connected` list from `Provider.Service`.
That connected list is unsuitable as credential evidence because configured
providers can be merged into the service independently of a usable credential.

That route is not suitable as a Runtime DTO: it returns full provider/model
records and may reflect catalog, plugin, package, URL, header, and credential
source details. 9W4E uses a NexusLoop-owned subprocess on the OpenCode side of
the process boundary. The child performs the equivalent exact selected-identity
lookup and discards every unrelated provider/model and every raw auth/config
field before writing one bounded JSON observation. Runtime never imports
OpenCode provider, auth, config, plugin, or catalog modules. The isolated child
reads the exact pinned `ModelsDev` and `Auth` services, then builds a bounded,
stable local config projection with the pinned schema and precedence. It does
not call `Config.Service`: that service can fetch remote account/well-known
configuration and install packages in config directories. The projection
rejects variables, plugins, symlinks, oversized or changing files, managed
dynamic sources, and malformed config. It checks the selected case-sensitive
provider/model against the bounded catalog/config snapshot and checks
credential-source presence independently from the selected provider's OpenCode
auth record, declared environment sources, or explicit provider API-key option.
It supports this credential observation only for the built-in `anthropic`,
`google`, and `openai` provider IDs; all other providers remain `unknown`.

The child disables models.dev refresh for the observation. The bundled/cache
snapshot remains the availability source; timeout, missing snapshot, malformed
state, process failure, truncation, or cancellation yields
`unknown`, never `unavailable`. No provider model request is made. The parent
owns timeout, output bytes, concurrency, identity validation, evidence hashing,
cancellation, and shutdown draining.

Production launch hard-binds `process.execPath`, a checked-in empty Bun
configuration that excludes project preloads, and the checked-in observer
module. The former `NXL_OPENCODE_EXECUTOR_READINESS_COMMAND` and
`NXL_OPENCODE_EXECUTOR_READINESS_ARGS_JSON` inputs are rejected, not parsed or
ignored. Custom process fixtures exist only in package-internal resolver unit
tests and cannot be selected through the real CLI or RuntimeServer launch
configuration.

The pinned `Config.Service.get()` path fetches remote
`<auth-key>/.well-known/opencode` configuration when any OpenCode auth entry
has type `wellknown`. The observer therefore reads the local OpenCode auth
snapshot first and returns `unknown`/`unknown` if any such entry exists, before
calling the config service. Readiness observation never performs that remote
fetch or treats remote configuration as selection or connection evidence.
The same config path requests active-organization configuration and tokens when
the local OpenCode account state selects an organization. The observer also
checks that local active-account marker first and returns `unknown`/`unknown`
when an organization is active, before config loading can contact the account
server. Because the observer never invokes that service after its local
preflights, later mutable-store rereads cannot race those checks.
