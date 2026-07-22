# ADR-023 - Commander connector-backed model transport

## Status

Accepted for Branch 9W2B1.

## Context

9W1 added the production AI SDK Core one-step model adapter. 9W2A added an
internal in-memory Commander investigation controller, but deliberately left
live provider transport unconfigured. Direct AI SDK fetches are not acceptable
for production Commander investigations because NexusLoop already has an
External API connector layer that owns provider egress, credential injection,
host policy, response caps, and audit events.

9W2B is split because connector transport and RuntimeServer provider activation
carry different risks. 9W2B1 implements only the transport substrate. 9W2B2
will decide how RuntimeServer selects providers, enforces run locks, registers
model capabilities, and reports investigation-level audit semantics.

## Decision

### Connector-Owned Credentials

In connector-backed mode, the AI SDK adapter never receives a real provider
credential. It runs in `connector_managed` credential mode with a fixed
non-secret sentinel value only because the OpenAI-compatible AI SDK provider
requires an API-key field.

The connector fetch bridge strips that exact sentinel authorization header
before calling `ExternalApiRequestService`. Any real Authorization, x-api-key,
cookie, proxy authorization, or other credential-like caller header fails
closed. Actual provider credentials come only from
`ExternalApiConnector.credential_refs` and the existing request service
environment injection.

### Exact OpenAI-Compatible Path

9W2B1 supports only OpenAI-compatible chat completions:

```text
<connector.base_url>/chat/completions
```

The bridge rejects alternate hosts, ports, paths, methods, query strings,
fragments, redirects, streaming request bodies, form bodies, blobs,
URL-encoded bodies, and arbitrary object coercion. It forwards only JSON
content negotiation headers. Other noncredential SDK headers are dropped and
only their bounded names are reported in transport metadata.

### External API Egress Authority

`ExternalApiRequestService` remains the egress authority. The connector-backed
adapter uses an injected fetch bridge that turns the AI SDK request into one
internal external API request. `ExternalApiTransport` remains the network
boundary and continues to enforce DNS/private-host policy, protocol policy,
manual redirects, timeout, and response caps.

The transport config contains only provider/model/connector IDs and bounded
request/response/time limits. It contains no base URL, API key, authorization
header, credential ref, arbitrary request path, query, or retry count.

### Audit Semantics

Every non-dry connector-backed HTTP attempt reuses the existing
`external_api_request_executed` and `external_api_request_failed` events.
Prompt bodies, response bodies, request headers, credential values, credential
environment names, model responses, and tool schemas are not persisted in those
audit events. Internal response previews use the existing omission marker.

`executeForInternalUse()` now supports a bounded post-persist audit observer.
The observer receives only a redacted immutable metadata projection after the
event append succeeds. Observer exceptions do not corrupt request execution.

### Abort And Caps

Parent `AbortSignal`s propagate through `ExternalApiRequestService` into
`ExternalApiTransport`. Pre-aborted requests stop before network dispatch,
in-flight aborts cancel fetch, and timeout remains distinguishable when the
runtime can distinguish it. Timers and listeners are cleaned up.

Internal callers may request a stricter per-call response cap, bounded by the
connector's own maximum. Existing public external API callers retain their
behavior when they do not use the new options.

### Connector-Backed Adapter

`ConnectorBackedCommanderModelStepAdapter` wraps the AI SDK one-step adapter
with connector-managed credentials and the strict fetch bridge. It validates
provider/model IDs against its transport config, performs no connector call on
mismatch, keeps `maxRetries=0`, and preserves the one-request invariant.

Bounded provider metadata records connector ID, persisted audit request IDs,
audit event kinds/counts, and dropped header names. Audit request IDs do not
change the normalized model result hash because the hash represents model
output, not operational audit identifiers.

### Streaming Boundary

Connector-backed streaming is not implemented in 9W2B1. The existing direct AI
SDK adapter keeps its streaming support for tests. The connector-backed wrapper
reports `supports_streaming=false`, and its stream method performs no network
request and appends no audit event.

## Consequences

The model transport stack for future activation is:

```text
CommanderModelStepRequest
-> ConnectorBackedCommanderModelStepAdapter
-> AiSdkCommanderModelStepAdapter
-> strict connector fetch bridge
-> ExternalApiRequestService
-> ExternalApiTransport
-> configured provider
```

9W2B1 does not modify RuntimeServer provider activation, launch config,
environment readers, public commands, TUI state, authority records, durable
investigation records, proposal generation, GitHub/MCP reads, OpenCode
lifecycle, or existing one-shot MiniMax provider behavior.

9W2B2 activates the connector substrate only through RuntimeServer's internal
in-memory investigation seam. That branch owns provider configuration, provider
preflight, model capability registration, run-lock enforcement, investigation
audit result semantics, and internal readiness previews. 9W3 still owns durable
investigation working sets, pause/resume, and recovery.
