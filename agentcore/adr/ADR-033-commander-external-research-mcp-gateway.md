# ADR-033 - Commander external research MCP gateway

## Status

Proposed. Branch 9XB0 production-fit decision: `NO-GO`.

## Context

ADR-018 reserved three future `external_research` descriptors, while ADR-021,
ADR-024, ADR-025, and ADR-032 established the only acceptable Commander
external-read path: curated descriptor, exact authority, fixed binding,
NexusLoop executor, audited request, bounded untrusted evidence, durable summary,
recovery compatibility, and RuntimeServer lifecycle drain.

The placeholders do not select an MCP provider, deployed server identity,
protocol, remote tool, schemas, output contract, session policy, source scope,
or downstream audit semantics. Those are authority decisions.

9XB0 evaluated the official hosted Exa MCP server using official documentation,
source revision `394f9210ed16d3e25d328e1e6db285824caedc04`, and a bounded anonymous
initialize/initialized/tools-list probe. No research tool was called.

## Decision

### No Production Activation

No `external_research` descriptor is promoted. No binding, authority record,
runtime adapter, package dependency, command, TUI surface, or network execution
is added in 9XB0. Existing broad flags remain false.

Hosted Exa is rejected for 9XB1 because:

1. the hosted endpoint reported server version `3.2.1` while the inspected
   source declares `3.4.0`, and no immutable deployment revision is attested;
2. initialize advertises prompts/resources and `tools.listChanged=true`, not the
   required exact static tools-only capability;
3. an exact hosted `2025-06-18` tools attestation exposes no output schema for
   `web_search_exa`;
4. the hosted endpoint issued a session but same-session DELETE returned HTTP
   405 instead of the required empty HTTP 200/204 cleanup acknowledgement.

Each observed defect independently prevents exact recovery authority,
citation-grade structural validation, or deterministic lifecycle cleanup.
Separately, NexusLoop's current native-fetch transport does not pin its validated
DNS answer to the eventual connection. A provider cannot be accepted until a
production-fit pinned-address HTTPS path is proven without weaker TLS checks.
Retry, result formatting, rate limits, telemetry, and retained-session behavior
found in source revision
`394f9210ed16d3e25d328e1e6db285824caedc04` are unbound source risks, not
verified hosted behavior. Hosted behavior in those areas remains
unknown/unattested.

No production-faithful deterministic real-CLI fixture is selected either. The
existing `allow_local_http` test path relaxes HTTPS and private-address policy,
so it cannot qualify this gateway. Provider requalification must include a
fixed HTTPS fixture origin that passes the same production transport checks;
without it, 9XB1 remains blocked.

`web_fetch_exa` is not attested by the fixed hosted query. Official docs and the
unbound source describe an arbitrary-URL/full-content contract, which cannot
establish approved `source_show` authority. The same evidence exposes no exact
`paper_metadata` operation. Remote `readOnlyHint` annotations are not NexusLoop
authority.

### Future Initial Scope

After a separate provider requalification decision, 9XB1 should implement at
most `external_research.search`. `source_show` remains deferred until source
handles or exact domain scope prevent arbitrary fetching. `paper_metadata`
remains deferred until a dedicated typed remote operation exists.

### Authority Shape

A future gateway must be one built-in provider adapter with fixed origin, path,
query, protocol version, remote tool, schemas, credentials, limits, and
normalization. Remote discovery may attest that exact identity but cannot create
descriptors, bindings, policy, or model-visible descriptions. There is no
marketplace, fallback, wildcard, or ambient OpenCode MCP authority.

Recovery policy identity includes the exact initialize server name/version and
static tools-only capability attestation. Drift in either identity or capability
shape stales only recovery authority that loaded the external-research tool.

### Protocol Subset

The only provisionally acceptable subset is Streamable HTTP with initialize,
initialized notification, one-page exact tools-list attestation, one tool call,
and deterministic session cleanup. POST-scoped JSON and bounded SSE may be
supported. Stdio, legacy SSE, GET streams, resumption, replay, OAuth browser
flows, prompts, resources, sampling, elicitation, roots, logging, completion,
subscriptions, tasks, retained runs, server requests, notifications, and list
changes are rejected.

Every unexpected capability or message fails closed. Hosted Exa negotiated
exact `2025-06-18` in the superseding probe, but its attested tool omitted the
required `outputSchema`; protocol support alone is insufficient. A prior probe
requested and received `2025-03-26`, which proved only support for that requested
revision and is not a maximum-version test. A future provider qualifies only by
negotiating exact `2025-06-18` and attesting an exact output schema. HTTP lifecycle
acknowledgements are not JSON-RPC responses: initialized must return an empty
HTTP 202, and session DELETE must return an empty HTTP 200 or 204. Any other
status or nonempty body fails closed. JSON-RPC responses for initialize,
attestation, and tool invocation require HTTP 200 exactly. A tool result requires
a `content` array containing zero entries or one canonical text mirror alongside
its separately validated structured output; absent content, extra block types,
or `isError: true` fails closed.

The outbound initialize request is exact authority: protocol `2025-06-18`,
empty client capabilities, and immutable client identity
`nexusloop-commander-external-research@1.0.0`. No SDK-added or caller-provided
capability or metadata field is accepted. Its canonical request-shape identity
is bound into recovery compatibility.

Before the initialized notification, the initialize result must exactly match
the selected immutable server name/version and capabilities
`{tools:{listChanged:false}}`, with no instructions or extra fields. Every other
capability or identity drift fails before any later application request. Hosted Exa's
prompts/resources/list-change advertisement therefore fails this gate; the fit
probe continued solely to gather bounded evidence. "Later request" means
application protocol work: if initialize issued a session, the mandatory
same-session audited DELETE remains the sole allowed cleanup request.

The runtime constructs every request header. POST uses JSON content type and an
Accept value for both JSON and event stream. Every post-initialize request binds
`MCP-Protocol-Version: 2025-06-18` and any issued session ID; session DELETE
binds the same protocol/session identity without a body. Caller headers and
overrides are forbidden.

### Session And Transport Boundary

Session IDs are validated, memory-only operational state. They never enter
evidence, audit previews, hashes, errors, journal state, or TUI state. If a
session is issued, same-origin DELETE cleanup is required and audited. Cleanup
has its own empty-response contract and is never passed to JSON-RPC parsing.

Caller and investigation cancellation stop application protocol messages but
do not skip cleanup for an already-issued session. Cleanup uses a separate
bounded RuntimeServer-owned signal, remains part of shutdown drain, and may run
while the runtime is stopping. One 15-second monotonic invocation ceiling
reserves its final two seconds for cleanup and durable audit settlement;
application messages stop after 13 seconds. Cleanup expires at the earliest of
two seconds after it begins, the original total deadline, or an earlier shutdown
drain deadline. It never extends executable authority beyond the invocation
ceiling. Cleanup failure or uncertainty prevents successful evidence
publication.

The current request service does not expose allowlisted response headers or
narrow MCP DELETE authority. A future implementation must add only
`content-type` and `mcp-session-id` to an internal header view and must not expose
raw headers or broaden DELETE for unrelated connectors.

That internal view is delivered to the gateway through a synchronous
validated-header observer at initialize response-header receipt, before the
transport consumes any body and before audit persistence. An issued session
therefore remains available ephemerally for mandatory DELETE when body handling
or the initialize audit append fails. The observer and session never enter
public options, results, errors, audits, hashes, journal state, or recovery
authority.

DNS validation must bind the actual HTTPS connection. Native fetch re-resolution
after validation is not approved. Every request resolves and validates the full
answer set, pins one deterministic public address without fallback, and retains
the configured hostname for SNI, certificate, and Host verification. Address or
peer data is operational only and is never evidence, durable state, or recovery
authority. Failure to prove this path keeps 9XB1 `NO-GO`.

Each protocol request opens one fresh pinned HTTP/1.1 TLS connection and closes
it after one response. Runtime-owned `Connection: close` is mandatory. Pooling,
keep-alive, HTTP/2/3 multiplexing, alternate-service upgrade, coalescing, and
cross-request connection reuse are forbidden, so every HTTP dispatch has its
own preceding observed connection attempt.

Every NexusLoop-controlled HTTP attempt must pass through
`ExternalApiRequestService` or an equally strong accepted boundary. Client
retries are zero. SDK transports that own unaudited fetch/auth retry are
rejected.

### Audit Truthfulness

The durable audit unit is one NexusLoop-to-MCP HTTP request. Initialization,
notification, attestation, tool call, pagination, and cleanup count separately.
One logical MCP invocation is reported separately. Provider-internal downstream
requests remain `unknown`; NexusLoop never claims to observe them.

No evidence is successful until every required transport audit and cleanup
audit is durable. Audit IDs and timestamps do not affect semantic evidence
hashes. Raw JSON-RPC bodies and responses are never persisted.

Attempted request-service calls, transport entry, pinned TCP/TLS connection
attempt, verified HTTP request dispatch, and confirmed durable audits are
separate bounded counters. `network_called` derives from a runtime-owned
synchronous callback immediately before opening the pinned connection. A second
callback after TLS verification records HTTP dispatch. TLS failure therefore
reports network activity without claiming request bytes or a provider response. A post-dispatch audit
append failure produces a schema-valid non-success with no evidence, still charges the
attempt, preserves truthful dispatch facts, and reconciles ambiguity or retains
the run-lock fence. It is never rewritten as zero network activity.

`CommanderToolExecutionResult` carries an MCP attempted-request count separately
from its durable external-audit count, including failed outcomes whose raw
handler result is withheld. The controller charges the attempted count while
checkpoint audit summaries continue to count only confirmed durable events.
An invoked MCP tool charges at least one tool-call slot even when gateway
preflight dispatches zero requests; larger attempted counts charge exactly.

### Evidence And Source Scope

A future result must use exact operation-specific structured content and an
exact output schema. Text-only output, image/audio, resource links, embedded
resources, arbitrary base64, remote instructions, and raw results are rejected.
Normalization, control-character handling, redaction, bounds, provenance,
truncation, and hashes are runtime-owned. Partial evidence produces `unknown`,
not false completeness.

Gateway `unknown` is not a successful Commander execution status. The future
binding/executor maps `ready | empty` to `ready`, maps `blocked`, `failed`, and
`cancelled` exactly, and maps `unknown` or any unrecognized status to `failed`
with no published result or evidence. An executor-owned progress-eligibility bit
is false for unknown/invalid outcomes, and the controller must use it instead of
inferring progress from failed status/result hash. Bounded audit facts remain
truthful.

`mcp_called` becomes a truthful execution boolean for this fixed gateway: false
before a protocol request enters the MCP adapter and true before `initialize` or
any later protocol request is submitted to the audited request service. It stays
true for policy, DNS, transport, cancellation, protocol, and uncertain failures,
even when the narrower observed-network fact is false. It remains false for
every non-MCP tool. A successful JSON-RPC envelope whose MCP tool result declares
`isError: true` is a failed invocation and cannot publish structured evidence.

Audit request IDs and timestamps are operational. Both the gateway result hash
and `CommanderToolExecutor` stable execution hash omit the exact nested audit-ID
field recursively while retaining audit counts, event kinds/outcomes,
network/MCP facts, and evidence. Fresh audit IDs cannot stale semantically
identical checkpoints; changed audit outcomes remain semantic.

Search URLs are evidence, not fetch permission. `source_show` cannot accept an
arbitrary URL. It requires an evidence-bound provider handle or exact configured
domain policy in a later ADR amendment.

### Budgets, Lifecycle, And Recovery

The proposed search ceiling is one logical call, five transport requests with
stateful cleanup, one tools-list page, eight items, one top-level structured
result, at most one exact canonical JSON text-mirror block, 128,000 response
bytes per request, 8,000 normalized bytes, 15 seconds total, one concurrent
call, one session, and zero retries.

The descriptor/executor envelope is 17 seconds solely to settle or hand off the
gateway's 15-second hard external-work and settlement deadline. On caller abort
or timeout, `CommanderToolExecutor` returns either the final settled ledger or a
bounded `runtime_owned_unresolved` lower-bound snapshot. The still-live promise
remains in RuntimeServer's exact external-research drain set, where it was
registered before the gateway's first await, and is removed only after actual
settlement. The executor never fabricates zero MCP/network/request facts. The
unresolved form publishes no evidence and halts
the Commander loop. The extra interval authorizes no network or audit request;
a drain timeout retains the run lock and prevents `runtime_shutdown`.

The exact external-research binding returns a package-internal synchronous
owned-execution handle before any await: a result promise, the
RuntimeServer-owned settlement promise, and a bounded side-effect-free ledger
snapshot callback. Only the fixed binding may use this path; remote data and
descriptor metadata cannot select it. This makes the handoff implementable even
when the result promise never settles. `persistence_uncertain` always implies
`runtime_owned_unresolved`; a settled/uncertain combination is invalid and the
RuntimeServer fence remains until exact audit reconciliation.

For the MCP binding, `CommanderToolExecutionResult` retains attempted-request,
transport-entry, pinned-connection, HTTP-dispatch, durable-audit, audit-status,
settlement-status, and durable event-kind facts even when the failed handler
result is omitted. Operational audit IDs remain non-semantic. Counts, statuses,
event kinds, and observed network/MCP facts remain semantic and fail closed on
inconsistent ordering.

Each transport request consumes existing Commander budget. RuntimeServer owns
the operation before its first await. Before transport, the gateway requires
remaining capacity for the full fixed sequence (five stateful/optionally
stateful, four proven stateless); insufficient capacity dispatches nothing, and
settlement charges exact request-service invocations counted before each call,
not only durable audits. RuntimeServer combines
cancellation with shutdown and drains protocol, audit, and cleanup work before
`runtime_shutdown`. Cancellation or uncertainty never becomes known successful
evidence.

Recovery compatibility must bind descriptor/input/output schemas, authority,
binding, provider/deployment identity, origin/path/query, protocol, remote tool
schemas, result types, session/cleanup, limits, source scope, credential
reference names, and transport policy including DNS address pinning,
original-host TLS verification, HTTP/ALPN and no-reuse policy, and
connection/HTTP dispatch observation. Relevant drift stales
only records that loaded the external-research descriptor. Sessions, requests,
cursors, arguments, results, and historical network work are never persisted or
replayed.

## Alternatives

- **Official MCP TypeScript SDK:** potentially viable only with explicit
  dependency approval and an audited fetch wrapper; default broad transport and
  auth behavior is not accepted.
- **Narrow adapter over `ExternalApiRequestService`:** preferred future shape
  if a bounded JSON/SSE spike proves the subset; no dependency change needed.
- **OpenCode MCP reuse:** rejected because ambient discovery and upstream
  transport do not own Commander audit authority.
- **Direct provider REST:** may be safer but does not meet 9XB MCP scope and
  requires a separate decision.

## Consequences

9XB0 succeeds by preventing a false implementation. The current placeholders
remain future-only, and 9XA invariants remain unchanged. Planned implementation
details are frozen in `phases/9XB/IMPLEMENTATION_BRIEF.md`, but production work
cannot begin until a provider amendment resolves deployment identity, retry
visibility, and structured output.

No external MCP call is available to Commander. No proposal or governance
authority is created. `resume_supported=false`,
`provider_tool_loop_enabled=false`, and
`external_read_execution_enabled=false` remain unchanged.

Branch 9W4A records external MCP and `external_research.*` as post-v1
deferred. 9XB1 therefore requires fresh provider requalification after v1;
this ADR remains Proposed with a `NO-GO` and no executable descriptor is
activated.
