# ADR-024 - Commander provider activation and audit gate

## Status

Accepted for Branch 9W2B2.

## Context

9W2A added the bounded in-memory Commander investigation controller. 9W2B1
added a connector-backed OpenAI-compatible model transport substrate, but did
not activate it inside RuntimeServer.

9W2B2 activates that transport only through the existing internal TypeScript
method `RuntimeServer.runCommanderInvestigationInMemory(...)`. There is still
no public runtime command, slash command, TUI surface, durable investigation
record, provider failover, connector streaming, proposal generation, GitHub/MCP
gateway, or OpenCode action.

## Decision

### Explicit Credential-Free Provider Config

A Commander investigation provider is optional and explicitly enabled. Runtime
configuration contains provider/model/connector identity, enabled Commander
phases, context/output limits, timeout/byte caps, and capability flags. It
contains no base URL, API key, authorization value, credential environment name,
custom headers, arbitrary path, retry setting, SDK session option, runtime
command, or tool-list override.

Environment activation requires
`NXL_COMMANDER_INVESTIGATION_PROVIDER_ENABLED=1`. Provider fields without the
explicit opt-in fail closed. `ENABLED=0` with provider fields also fails closed.
RuntimeServerOptions config takes precedence over environment parsing, and an
injected model adapter may not coexist with configured provider activation.

### Connector-Backed Production Path

The configured production path constructs
`ConnectorBackedCommanderModelStepAdapter` with only the transport subset of
the provider config. Real credentials remain owned by
`ExternalApiConnector.credential_refs` and `ExternalApiRequestService`
environment injection. RuntimeServer construction and startup do not call the
provider and do not append provider audit events.

Injected adapters remain an internal/test override and do not require connector
audit metadata.

### Model Capability Registration

The configured model is registered as a runtime-config Commander capability.
That capability preserves provider ID, model ID, context/output limits, tool
support, JSON-schema support, long-context support, local-execution support, and
the nonstreaming connector-backed transport warning. Runtime-config
capabilities are considered before default/fallback metadata so the controller
uses the configured capability for protocol and budget selection.

### Readiness And Provider Gate

RuntimeServer exposes an internal readiness preview method. It performs no
network call and appends no event. It separates configuration readiness from
execution readiness.

Configured-provider execution requires exact provider ID, provider kind, model
ID, enabled phase, valid connector preview, credential refs and values,
runtime-config Commander capability, connector-backed nonstreaming adapter,
active mode, a fully ready RuntimeServer lifecycle, and the normal run lock.
The lifecycle is distinct from the legacy `started` boolean: configured
provider execution is blocked while the runtime is starting or stopping.

The provider gate runs before the investigation and before every model request.
If readiness is lost between model turns, the investigation stops before another
provider request. RuntimeServer does not reacquire the run lock inside the
investigation.

RuntimeServer owns active configured-provider investigation lifetimes. Shutdown
marks the lifecycle stopping, aborts in-flight configured-provider
investigations, waits for their external API audit writes to settle, then
appends `runtime_shutdown` and releases the run lock. If the bounded drain does
not settle, shutdown fails closed rather than releasing single-writer authority
while provider work may still append.

9W3A extends the same lifecycle drain to durable Commander investigation
journal writes. External API audits and Commander investigation lifecycle
events are distinct durable streams, and shutdown must settle both before
`runtime_shutdown` or run-lock release.

### Audit Completeness

Configured connector-backed provider requests must have one persisted external
API audit event per model request. The controller validates
`provider_metadata.nexusloop_transport` before interpreting model output or
executing tools.

Missing or malformed audit metadata, wrong connector ID, missing request ID,
audit count mismatch, success/failure count mismatch, or any persisted-body or
credential flag fails closed with `provider_audit_incomplete`.

### Truthful Investigation Flags

Investigation state remains in-memory. 9W2B2 does not persist transcripts,
working sets, or investigation-specific events.

The investigation result distinguishes:

- `investigation_events_appended=false`
- `external_api_audit_events_appended=<count>`
- `events_appended=true` only when external API audits were appended

Provider audit IDs are operational and volatile. They are exposed in bounded
result metadata, but they do not affect the semantic investigation result hash.

## Consequences

The internal configured stack is:

```text
RuntimeServer provider config
-> readiness/run-lock provider gate
-> bounded in-memory Commander controller
-> connector-backed model adapter
-> AI SDK one-step adapter
-> ExternalApiRequestService audit events
-> explicit NexusLoop tool executor
```

The public Commander profile remains conservative:
`provider_tool_loop_enabled=false`. 9W3A owns durable journal/checkpoint
records only. 9W3B owns recovery and human-reviewed resume. 9W3C owns any
future public/operator activation decision. 9Y owns proposal generation.
Existing MiniMax one-shot compatibility paths remain unchanged.

Branch 9W3B2B2B applies the same configured-provider readiness, one-request,
audit-completeness, abort, and shutdown-drain authority to approved Commander
recovery. Recovery additionally requires the durable one-shot transaction and
current plan/preparation revalidation before this connector path can run.
