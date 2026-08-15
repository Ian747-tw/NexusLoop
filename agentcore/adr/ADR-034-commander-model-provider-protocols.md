# ADR-034 - Commander model-provider protocols

## Status

Accepted for Branch 9W4A.

## Context

Commander previously had one configured wire contract: an
OpenAI-compatible Chat Completions request routed through NexusLoop's connector,
audit, controller, recovery, and lifecycle boundaries. Provider portability is
required before proposal generation, but a provider label over the same wire
format is not protocol portability. Commander authority must also remain
separate from ambient OpenCode provider configuration.

## Decision

### Closed Protocol Authority

Commander transport configuration is a closed discriminated union:

- `openai_compatible_connector` retains its existing meaning and request shape.
- `anthropic_messages_connector` selects native Anthropic Messages.

The discriminant selects only a built-in provider factory and request policy.
It cannot select a module, callback, arbitrary path, remote model list, or
request transformer. There is no dynamic package loading, discovery, fallback,
failover, or ambient OpenCode authority.

### Shared Step Engine

Both protocols use one NexusLoop-owned AI SDK step engine for `generateText`,
message conversion, curated client-tool schemas, tool-call validation, bounded
JSON fallback, usage and stop-reason normalization, cancellation, and semantic
result hashing. Provider construction is internal and keyed by the closed
transport discriminant. `maxRetries=0` remains mandatory.

The existing OpenAI-compatible factory and `/chat/completions` bridge retain
their established behavior. Anthropic uses `@ai-sdk/anthropic@4.0.15` with the
same `ai@7.0.29`, `@ai-sdk/provider@4.0.3`, and
`@ai-sdk/provider-utils@5.0.10` graph.

### Native Anthropic Policy

Anthropic configuration requires normalized `provider_kind=anthropic`. Its
endpoint is exactly `<connector.base_url>/messages`, normally
`https://api.anthropic.com/v1/messages`. Requests are JSON `POST` with no URL
credentials, query, fragment, alternate path, redirects, or streaming.

The SDK receives a fixed non-secret sentinel API key and the strict NexusLoop
fetch bridge. The bridge removes only that exact sentinel `x-api-key` value.
`ExternalApiRequestService` alone resolves and injects exactly one unprefixed
connector-owned `x-api-key` credential. `anthropic-version` is fixed at
`2023-06-01`; `Authorization`, `anthropic-beta`, caller headers, and arbitrary
credential fields are rejected.

The bridge allows only bounded ordinary user/assistant messages, system text,
NexusLoop client tools, tool choice, output token limit, and temperature. It
rejects unknown authority-bearing fields and all Anthropic server tools, MCP,
Files, Skills, Batch, web, computer-use, code execution, containers, context
management, prompt caching, thinking, service tiers, provider options,
retained/background work, and server fallback.

Native text, ordinary client `tool_use`, exact call IDs, tool-result
continuation, usage, and refusal stop reasons are normalized. Invalid arguments
remain non-executable calls without `execution_arguments`. Provider-executed
tool blocks cannot become executable Commander tools. Anthropic native
JSON-schema output is declared unsupported; bounded NexusLoop JSON fallback is
used without beta activation.

### Audit, Cancellation, And Lifecycle

Both protocols preserve the existing chain:

```text
RuntimeServer authority
-> Commander controller
-> connector-backed AI SDK adapter
-> strict protocol bridge
-> ExternalApiRequestService
-> audited ExternalApiTransport
```

One model step makes at most one HTTP request. Every attempted request must have
one durable audit outcome before model evidence or tool calls are trusted.
Rate-limit and transient failures are not retried. Cancellation reaches the
transport, and shutdown drains provider, audit, and journal work before
`runtime_shutdown` and run-lock release. Post-boundary uncertainty is never
converted into safe retry authority.

### Recovery Compatibility

Protocol identity is semantic authority. Anthropic recovery envelopes bind the
transport discriminant, provider/model/connector identity, exact Messages
endpoint policy, `@ai-sdk/anthropic@4.0.15`, request policy
`anthropic_messages_v1`, fixed protocol header, credential injection shape
without names or values, capability limits, tool schemas, and audit policy.
Drift stales affected approval and requires a new preview.

The legacy OpenAI-compatible envelope projection is unchanged when its
effective authority is unchanged. Historical records are not reinterpreted as
Anthropic. Neither protocol persists or replays SDK state, raw requests,
responses, credentials, tool results, or historical provider calls.

### V1 Boundary

V1 verifies model protocols before proposal generation. External MCP and
`external_research.*` execution are deferred until after v1. ADR-033 remains
Proposed with a `NO-GO`; 9XB1 requires fresh provider requalification. OpenCode
may retain broader tactical provider support, but it never authorizes
Commander implicitly.

## Consequences

Commander now proves two materially different configured protocols through the
same controller, audit, recovery, cancellation, and shutdown boundaries.
Support claims are conformance claims, not marketing compatibility claims.

No public investigation-start command, provider marketplace, MCP execution,
external-research execution, server tool, failover, retry, automatic recovery,
proposal, governance, or mutation authority is added.
`resume_supported=false`, `provider_tool_loop_enabled=false`, and
`external_read_execution_enabled=false` remain unchanged.

Branch 9W4B0 adds a pure, disconnected model-profile vocabulary above this
transport boundary. A Commander projection must still select one exact 9W4A
protocol through a NexusLoop-owned conformance entry; OpenCode model support,
catalog data, plugins, or authentication do not authorize either protocol.
There is no RuntimeServer activation and existing 9W4A configuration and
recovery identities are unchanged.
