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
and redirect controls plus connection pinning to one validated public address;
original-host SNI/certificate/Host verification; no native re-resolution or
address fallback; one fresh HTTP/1.1 connection per request with no pooling,
keep-alive, HTTP/2/3, coalescing, or alternate-service reuse; runtime-only
credential injection; allowlisted internal response headers (`content-type`,
`mcp-session-id` only); ephemeral validated
session ID; same-origin audited cleanup; redaction before errors, hashing, or
publication.

A valid issued session is observed synchronously through one internal
allowlisted-header callback at response-header receipt, before any body read or
audit persistence. Body timeout/oversize/decode failure and audit append failure
therefore cannot skip cleanup. The callback is memory-only and never becomes
result, error, audit, journal, or recovery state; malformed session headers are
not reflected.

The runtime injects exact JSON content type and JSON/SSE Accept headers on POST,
then exact MCP protocol version and any issued session ID on every subsequent
request. Missing, duplicate, caller-provided, premature-session, or overridden
headers fail before transport or result publication.

### Audit Gaps And False Accounting

Threats: SDK-owned fetch, automatic auth retry, provider-internal retry,
unobserved initialization/list/cleanup calls, audit persistence failure, or one
MCP audit being described as all downstream work.

Controls: every NexusLoop HTTP attempt passes through
`ExternalApiRequestService`; client retry count zero; request count includes all
protocol messages and cleanup; evidence is withheld until audits are durable;
results explicitly state that provider-internal calls are unobserved. Attempted
request-service calls, transport entry, pinned TCP/TLS connection attempt,
verified HTTP dispatch, and confirmed durable audits remain separate bounded
counters. `network_called` changes immediately before opening the pinned
connection; HTTP dispatch changes only after TLS verification. Transport entry
cannot fabricate network activity, TLS failure cannot be rewritten as no
network, and post-dispatch audit failure cannot erase either fact. The failed call
charges the attempt and publishes no evidence. The executor carries the attempted count
separately from durable audits even when it omits a failed handler result, and
the controller charges `max(1, attempted_count)` for every invoked MCP tool
before another model turn. A zero-request preflight therefore still consumes
one tool-call slot. A provider with hidden retries is rejected.

### Protocol Expansion

Threats: server requests, notifications, prompts, resources, sampling,
elicitation, tasks, retained runs, long-lived streams, resumption, list changes,
or unexpected content types expanding authority after initialization.

Controls: pin one protocol revision; support only initialize, initialized,
single-page attestation, one tool call, and cleanup; accept POST-scoped JSON or
bounded SSE only; reject every unexpected method/capability/message/content
type; no GET stream or resumption. The initialize request has fixed client
identity `nexusloop-commander-external-research@1.0.0`, empty client
capabilities, no SDK-added fields, and a policy-bound canonical request shape.
An initialize attestation rejection blocks all later application messages but
still permits the one mandatory audited DELETE when a session was issued.

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
caller and lifecycle signals for application messages; check abort before and
between each application message; after session issuance, use a separate
bounded RuntimeServer-owned cleanup signal so caller cancellation cannot skip
DELETE. Reserve the last 2,000 ms of one 15,000 ms monotonic invocation ceiling
for cleanup and its audit; application protocol work ends after 13,000 ms, and
cleanup also obeys any earlier shutdown-drain deadline. Start no network request
after the applicable deadline; drain cleanup, transport, and audit persistence
before `runtime_shutdown`; cancelled, timed-out, disconnected, or unaudited
calls publish no successful evidence.

The gateway hard deadline is 15 seconds. Its descriptor/executor envelope is 17
seconds solely so caller cancellation or the exact-deadline race can settle or
perform a bounded ownership handoff while preserving the observed accounting
ledger. A settled handler returns final facts. If an already-started cleanup or
audit boundary remains unresolved at 17 seconds, the executor returns a
non-success `runtime_owned_unresolved` lower-bound snapshot only after the live
promise remains registered in RuntimeServer's exact
`activeExternalResearchReadSettlements` drain set, where it was placed before
the gateway's first await. The controller halts and
publishes no evidence. No external request gains authority in the extra window;
a drain timeout retains the run lock and prevents `runtime_shutdown`.

The exact external-research binding returns a synchronous owned-execution handle
before the executor awaits anything: a result promise, the RuntimeServer-owned
settlement promise, and a bounded side-effect-free ledger snapshot callback.
Descriptor metadata cannot select this path. The callback makes the 17-second
handoff implementable without waiting for an unresolved result. Audit
`persistence_uncertain` and settlement `settled` are mutually incompatible;
ambiguity keeps the ownership entry and run-lock fence until reconciled.

### Recovery Replay Or Authority Drift

Threats: stored MCP sessions, cursors, request IDs, arguments, or results become
execution authority; changed provider policy remains approved; historical
external calls replay automatically.

Controls: compatibility binds credential-free gateway policy identity and exact
descriptor/binding/authority/schema hashes; changes stale affected approvals;
only bounded evidence cards and hashes persist; no session, cursor, request, or
result replay; `resume_supported=false`.

## Evaluated Provider-Specific Findings

The following are source-only findings at unbound Exa revision
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

These findings motivate attestation requirements but do not describe the hosted
deployment because hosted `3.2.1` is not bound to source `3.4.0`.

The superseding hosted probe on 2026-08-10 requested and negotiated exact
`2025-06-18`, returned POST-scoped `text/event-stream`, issued
`Mcp-Session-Id`, advertised tools/prompts/resources capability families,
set `tools.listChanged=true`, attested only `web_search_exa`, and supplied no
output schema. Same-session DELETE returned HTTP 405. A production client would
reject the initialize capability shape before sending another protocol message;
the fit probe continued only to collect bounded evidence. No research tool was
called, so hosted result shape, downstream retry behavior, rate limits,
telemetry, and retained-session policy remain unknown. A prior `2025-03-26` echo
is not treated as a maximum-version test.

## Residual Risk Decision

The residual risks are authority blockers, not warnings. Hosted Exa cannot be
approved for 9XB1 until deployment identity/policy, structured output, session
cleanup, and downstream visibility are resolved. Outcome: `NO-GO`.
