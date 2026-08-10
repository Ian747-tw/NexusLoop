# 9XB External Research MCP Threat Model

## Protected Assets

- Runtime policy, Commander authority, tool bindings, capability profiles, and
  human approval state.
- Connector credentials, credential reference names, headers, endpoint policy,
  session IDs, MCP request IDs, and runtime lifecycle state.
- Journal integrity, recovery compatibility, request/audit accounting, and the
  one-shot no-replay recovery boundary.
- Model-visible context, where external content must remain untrusted evidence
  with `instruction_semantics="none"`.

## Trust Boundaries

```text
Commander model (untrusted tool arguments)
-> NexusLoop descriptor/binding/executor authority
-> RuntimeServer-owned MCP gateway
-> ExternalApiRequestService audit and credential boundary
-> configured MCP origin (untrusted protocol peer)
-> provider-internal APIs (not observable by NexusLoop)
-> external web sources (hostile evidence)
```

The MCP server is not an authority peer. Its tool descriptions, annotations,
schemas, instructions, prompts, resources, notifications, errors, and results
are untrusted input even when the server is first-party.

## Principal Threats And Required Controls

### Authority Confusion

Threats: dynamic tool discovery, server-selected tool names, annotation trust,
ambient OpenCode configuration, schema drift, marketplace fallback, and remote
instructions reaching model policy.

Controls: one built-in provider adapter; fixed origin/path/query/protocol/tool;
runtime-owned descriptor schemas; exact `tools/list` attestation only; fail on
extra/missing/drifted tools; never publish remote descriptions or instructions;
no fallback.

### SSRF, Credential, And Session Leakage

Threats: arbitrary URLs, redirects, private DNS answers, credential-bearing
query strings, cookies, raw response headers, session IDs in evidence/errors,
and cleanup against an attacker-controlled origin.

Controls: fixed HTTPS origin and path; no caller URL/header fields; existing DNS
and redirect controls; runtime-only credential injection; allowlisted internal
response headers (`content-type`, `mcp-session-id` only); ephemeral validated
session ID; same-origin audited cleanup; redaction before errors, hashing, or
publication.

### Audit Gaps And False Accounting

Threats: SDK-owned fetch, automatic auth retry, provider-internal retry,
unobserved initialization/list/cleanup calls, audit persistence failure, or one
MCP audit being described as all downstream work.

Controls: every NexusLoop HTTP attempt passes through
`ExternalApiRequestService`; client retry count zero; request count includes all
protocol messages and cleanup; evidence is withheld until audits are durable;
results explicitly state that provider-internal calls are unobserved. A provider
with hidden retries is rejected.

### Protocol Expansion

Threats: server requests, notifications, prompts, resources, sampling,
elicitation, tasks, retained runs, long-lived streams, resumption, list changes,
or unexpected content types expanding authority after initialization.

Controls: pin one protocol revision; support only initialize, initialized,
single-page attestation, one tool call, and cleanup; accept POST-scoped JSON or
bounded SSE only; reject every unexpected method/capability/message/content
type; no GET stream or resumption.

### Evidence Injection And False Completeness

Threats: hostile Markdown/system instructions, control characters, secret-like
text, malformed partial structures, arbitrary resources, image/audio payloads,
truncation presented as complete, and prose parsing ambiguity.

Controls: operation-specific output schema; structured-content validation;
deterministic Unicode/control normalization; redaction before semantic hash;
hard item/block/byte ceilings; explicit truncation and `unknown`; reject text-
only, image, audio, resource link, embedded resource, and extra content unless
an exact future contract permits it.

### Cancellation And Shutdown Races

Threats: ownership begins after the first await, abort starts another protocol
message, cleanup writes after shutdown, or uncertain transport becomes known
success.

Controls: register RuntimeServer ownership before the first await; combine
caller and lifecycle signals; check abort before and between each message;
drain transport and audit persistence before `runtime_shutdown`; cancelled,
timed-out, disconnected, or unaudited calls publish no successful evidence.

### Recovery Replay Or Authority Drift

Threats: stored MCP sessions, cursors, request IDs, arguments, or results become
execution authority; changed provider policy remains approved; historical
external calls replay automatically.

Controls: compatibility binds credential-free gateway policy identity and exact
descriptor/binding/authority/schema hashes; changes stale affected approvals;
only bounded evidence cards and hashes persist; no session, cursor, request, or
result replay; `resume_supported=false`.

## Evaluated Provider-Specific Findings

At Exa source revision
[`394f9210ed16d3e25d328e1e6db285824caedc04`](https://github.com/exa-labs/exa-mcp-server/tree/394f9210ed16d3e25d328e1e6db285824caedc04):

- `web_search_exa` and `web_fetch_exa` are enabled by default; the server also
  registers prompts and resources.
- `web_search_exa` returns formatted text and has no output schema.
- `web_fetch_exa` accepts arbitrary URLs and returns full page content.
- downstream API calls use `retryWithBackoff(..., maxRetries=2)` for transient
  server errors.
- Agnost analytics instrumentation is enabled and server-side rate limiting may
  fail open.
- optional `agent_run` supports retained asynchronous runs and continuation;
  it is forbidden even though the fixed query can omit it.

The hosted deployment probe on 2026-08-10 negotiated protocol `2025-03-26`,
returned POST-scoped `text/event-stream`, issued `Mcp-Session-Id`, advertised
tool/prompt/resource list-change capabilities, and reported server version
`3.2.1`. This differs from the inspected source's `3.4.0` identity and proves
that source revision cannot be inferred from hosted server metadata.

## Residual Risk Decision

The residual risks are authority blockers, not warnings. Hosted Exa cannot be
approved for 9XB1 until deployment identity, structured output, and downstream
retry visibility are resolved. Outcome: `NO-GO`.
