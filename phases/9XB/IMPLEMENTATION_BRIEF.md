# 9XB Implementation Brief

## Authority Status

This brief records a `NO-GO` at 9XB0. It identifies the exact missing provider
contract and the NexusLoop work that follows once that contract exists. It does
not authorize coding around missing provider guarantees.

Approved initial descriptor set: **empty**.

| Placeholder | Status |
| --- | --- |
| `external_research.search` | Conditional first descriptor after provider requalification |
| `external_research.source_show` | Deferred until evidence-bound source authority exists |
| `external_research.paper_metadata` | Deferred until an exact typed remote operation exists |

Recommended sequence:

1. **9XB0**: contract and provider-fit decision.
2. **9XB0R**: provider requalification naming one exact immutable deployment,
   remote schema, retry policy, structured result, and production-faithful
   deterministic E2E fixture origin, plus a validated-address pinning fit spike
   for the chosen HTTPS client stack.
3. **9XB1**: implement only `external_research.search`.
4. **9XB2A**: add `source_show` only with evidence-bound handles or exact domain
   scope.
5. **9XB2B**: add `paper_metadata` only with a dedicated typed provider tool.

9XB1 must not start until ADR-033 is amended from `Proposed` to an accepted
provider decision.

## Provider Requalification Gate

The amendment must fill every field below with immutable evidence:

- provider ID and owner;
- server implementation revision and deployed build/policy digest;
- exact initialize `serverInfo.name` and `serverInfo.version` constants bound to
  that deployed identity;
- fixed HTTPS origin, path, and query;
- exact MCP protocol version and remote tool name;
- exact remote input and output schemas and hashes;
- accepted result content block shape;
- authentication mode and credential reference names;
- session issuance and cleanup behavior;
- client and provider-internal retry count;
- downstream request visibility;
- rate-limit and analytics/telemetry behavior;
- citation provenance and source-scope semantics;
- cancellation and shutdown behavior.
- a proven HTTPS transport path that pins one validated public DNS address with
  original-host SNI/certificate/Host validation and no address fallback or
  native re-resolution, and proves fresh HTTP/1.1 connection/close behavior for
  every request;
- a fixed deterministic HTTPS fixture origin whose certificate, public-address
  resolution, protocol, schemas, and server build pass the same production
  policy as the selected provider without `allow_local_http`, private-address
  exceptions, injected fake transport, live mutable data, or real credentials.

Any unresolved or mutable field keeps the decision `NO-GO`.

## Conditional Search Descriptor

This is the NexusLoop side of the first possible descriptor. Provider fields
remain blocked because no provider is approved; implementation must not invent
them.

### Identity And Authority

| Field | Frozen value |
| --- | --- |
| `tool_id` | `external_research.search` |
| `namespace` | `external_research` |
| `version` | `1.0.0` |
| `authority_id` | `commander_tool_authority_external_research_search` |
| `binding_key` | `external_research.search` |
| `provider_id` | `BLOCKED_UNSELECTED` |
| `remote_mcp_tool` | `BLOCKED_UNSELECTED` |
| `availability` | `implemented_read_surface` only after provider acceptance |
| `load_policy` | `deferred` |
| `allowed_phases` | `proposal_investigation` |
| `trust_class` | `external_content_untrusted` |
| `instruction_semantics` | `none` |
| `risk` | `safe_read` |
| `side_effect_class` | `external_read` |
| `execution_backend` | `runtime_service` |
| `process_policy` | `none` |
| `requires_network` | `true` |
| `requires_credentials` | `true` |
| `requires_approval` | `false` |
| `requires_run_lock` | `true` |
| `creates_external_process` | `false` |
| `calls_provider` | `false` |
| `mutates_events` | `true`, exactly matching authority; audit events only |
| `max_output_bytes` | `12000` |
| `timeout_ms` | `17000` executor envelope; gateway external-work ceiling remains `15000` |

The descriptor's `mutates_events=true` must exactly equal the authority record;
the mandatory external-request audit is the only mutation. The authority record
otherwise mirrors 9XA: safe read, blocked until gateway readiness, active
RuntimeServer and run lock required, no provider-model call, approval, or
process, and expected events limited to `external_api_request_executed` and
`external_api_request_failed`. No separate Commander/journal mutation is
allowed.

### Strict Input Schema

```json
{
  "schema_version": "nxl-commander-tool-v1",
  "type": "object",
  "properties": {
    "query": { "type": "string", "minLength": 1, "maxLength": 500 },
    "result_limit": { "type": "integer", "minimum": 1, "maximum": 8 }
  },
  "required": ["query"],
  "additionalProperties": false
}
```

Normalization trims surrounding whitespace, rejects control-only input and all
URL/header/credential/context/server/tool override keys, and defaults
`result_limit` to 5. Query text is search data, never policy.

### Strict Output Schema

All arrays have explicit runtime caps even where the current Commander schema
vocabulary cannot express `maxItems`.

| Common envelope field | Exact contract |
| --- | --- |
| `status` | enum `ready`, `empty`, `blocked`, `failed`, `cancelled`, `unknown` |
| `tool_id` | constant `external_research.search` |
| `provider_id` / `remote_tool_id` | exact accepted constants |
| `result` / `provenance` | object or JSON `null` as required by status below |
| `evidence` | array, maximum 8 existing bounded Commander evidence cards |
| `request_count` | integer 0..5; request-service calls, incremented before each call |
| `transport_boundary_entered_count` | integer 0..5; request-service calls that reached the transport entry callback |
| `network_connection_attempt_count` | integer 0..5; pinned TCP/TLS connections attempted after DNS validation |
| `http_request_dispatch_count` | integer 0..5; HTTP requests dispatched after TLS verification |
| `durable_audit_count` | integer 0..5; confirmed durable external-request audit events |
| `audit_status` | enum `complete`, `persistence_failed`, `persistence_uncertain` |
| `settlement_status` | enum `settled`, `runtime_owned_unresolved` |
| `logical_mcp_tool_call_count` | integer 0..1 |
| `downstream_provider_request_visibility` | constant `unknown` |
| `external_api_audit_request_ids` | array, maximum 5 strings, each maximum 240 |
| `external_api_audit_event_kinds` | array, maximum 5; each exact `external_api_request_executed` or `external_api_request_failed` |
| `network_called` | boolean |
| `mcp_called` | boolean; true when the first MCP protocol request is submitted to the fixed adapter |
| `blockers` / `warnings` | arrays, maximum 24 strings each, each maximum 500 |
| `normalized_bytes` | integer 0..8000 |
| `envelope_bytes` | integer 0..12000 |
| `generated_at` | canonical timestamp |
| `result_hash` | SHA-256 semantic hash |

A non-null result has `query_hash`, `omitted_item_count`, `completeness`,
`truncated`, and an `items` array capped at eight. Every item requires a bounded
deterministic evidence ID (160), redacted title (240), validated HTTPS canonical
URL (500), untrusted source/instruction constants, and content hash; optional
published timestamp, author (120), and excerpt (500) remain bounded.

A non-null provenance object requires provider, server-policy, remote-tool,
input-schema, output-schema, source-class, retrieval, truncation, and evidence
hash fields. No additional properties are accepted at any level.

Status invariants are exact:

- `ready`: non-null result/provenance, 1..8 items, one evidence card per item,
  one logical MCP call, and complete durable audits;
- `empty`: non-null result/provenance, zero items/evidence/omissions,
  `truncated=false`, `completeness=bounded_complete`, one logical MCP call, and
  complete durable audits;
- `blocked | failed | cancelled | unknown`: `result=null`, `provenance=null`,
  zero evidence, and at least one bounded blocker; partial normalized provider
  data is discarded;
- every status requires
  `durable_audit_count == external_api_audit_request_ids.length`,
  `durable_audit_count == external_api_audit_event_kinds.length`,
  `durable_audit_count <= request_count`, and
  `http_request_dispatch_count <= network_connection_attempt_count`,
  `network_connection_attempt_count <= transport_boundary_entered_count`, and
  `transport_boundary_entered_count <= request_count`;
- `audit_status=complete` requires `durable_audit_count == request_count`.
  `ready | empty` require `complete`; `persistence_failed | persistence_uncertain`
  require a non-success status, null result/provenance, zero evidence, and a
  bounded blocker. The gateway reconciles an ambiguous append first and reports
  `complete` only when the exact audit is confirmed durable;
- `settlement_status=runtime_owned_unresolved` requires
  a non-success status, null result/provenance, zero evidence, and an atomic
  RuntimeServer drain handoff; `audit_status=persistence_uncertain` requires
  `settlement_status=runtime_owned_unresolved`. The only valid pairs are
  `settled + complete`, `settled + persistence_failed`, and
  `runtime_owned_unresolved` with any of the three audit statuses; all other
  pairs fail schema validation. An ambiguous append is not settled until
  reconciliation proves either the exact durable audit or a definite
  persistence failure;
- `network_called` is exactly `network_connection_attempt_count > 0`. An audited
  pre-dispatch policy/DNS rejection may truthfully have a positive request count
  and may enter the transport while retaining zero connection attempts. A TLS
  timeout or certificate failure has connection count one, HTTP dispatch count
  zero, and `network_called=true`. An audit append failure after pinned HTTP
  dispatch may have all three operational counts at one, durable audit count
  zero, and `audit_status=persistence_failed`;
- `mcp_called` remains false only while no MCP protocol request has entered the
  fixed adapter. It becomes true before the adapter submits `initialize` to
  `ExternalApiRequestService` and remains true even when policy, DNS, transport,
  cancellation, or protocol handling then fails or becomes unknown;
- `network_called` remains the narrower observed outbound-connection fact. A
  policy or DNS rejection can truthfully return `mcp_called=true` and
  `network_called=false`, while a TLS failure returns both true without claiming
  that HTTP request bytes or a provider response existed. Neither remote output
  nor the model supplies these values;
- `logical_mcp_tool_call_count` is zero before tool-call dispatch and one once
  the one allowlisted tool call is attempted, regardless of its outcome;
- `bounded_complete` is allowed only when the provider contract proves it;
  partial or transport/protocol-truncated evidence yields `unknown`.

The gateway enforces `envelope_bytes` over the complete DTO, including audit
and evidence arrays, before returning it; descriptor `max_output_bytes` is a
second boundary, not a substitute for these field caps.

The gateway status and Commander execution status are separate allowlists.
9XB1 must replace `handlerOutcome()`'s permissive fallback with this exact map:

| Gateway status | Execution status | `progress_eligible` |
| --- | --- | --- |
| `ready`, `empty` | `ready` | `true` |
| `blocked` | `blocked` | `true` (preserves existing first-result behavior) |
| `failed` | `failed` | `true` (preserves existing first-result behavior) |
| `cancelled` | `cancelled` | `false` |
| `unknown` | `failed` plus bounded completeness blocker | `false` |
| any other value | `failed` plus bounded invalid-status blocker | `false` |

The `unknown` and invalid-status paths retain truthful bounded transport/audit
facts but publish no result and no evidence and cannot count as controller
progress.

9XB1 extends `CommanderToolExecutionResult.mcp_called` from literal false to a
boolean and adds required executor-owned `progress_eligible`. The executor, not
the remote result, derives `mcp_called` from the fixed binding's observed entry
into its MCP adapter and derives `progress_eligible` from the validated gateway
status. The adapter reports its dispatch fact even when no HTTP network dispatch
was observed. The controller replaces its status-based progress fallback with
`execution.progress_eligible`; existing non-MCP ready/blocked/failed behavior
remains unchanged.

### Exact Argument Translation

The accepted provider amendment must define one fixed translation:

```text
Commander query -> one remote query string
Commander result_limit -> one provider result-count field capped at 8
all other remote fields -> runtime constants
```

No remote server, tool, domain, date, fetch, content mode, or query-expansion
field is model-controlled. The current Exa mapping is rejected.

## Protocol Adapter Contract

The preferred future implementation is a narrow adapter over
`ExternalApiRequestService`, provided a deterministic spike proves bounded JSON
and request-scoped SSE parsing safer than adding the broad SDK.

```text
initialize POST
-> notifications/initialized POST
-> one-page tools/list attestation POST
-> one tools/call POST
-> same-origin session DELETE if a session was issued
```

**Protocol identity:** only exact `2025-06-18` is eligible because it defines
`outputSchema` and `structuredContent`. Hosted Exa negotiated that exact version
in the superseding probe, but its tool attestation omitted `outputSchema` and its
session DELETE returned HTTP 405. Exact protocol support is necessary, not
sufficient, and does not approve the provider.

**JSON-RPC responses:** IDs are local, ephemeral, unique, and
non-authoritative. Each request carries one object, never a batch. HTTP 200 is
the only accepted status for `initialize`, `tools/list`, and `tools/call`
JSON-RPC responses. Those responses accept bounded `application/json` or
request-scoped `text/event-stream`. SSE accepts only `event: message` and one
final response for the request ID; unknown events, `retry`, duplicate finals,
server requests/notifications, and trailing messages fail closed.

**HTTP lifecycle acknowledgements:** initialized must return empty HTTP 202;
session DELETE must return empty HTTP 200 or 204. Neither has a JSON-RPC ID,
result, or SSE event. Any other status, nonempty body, or response content type
fails closed.

**Excluded protocol:** no GET, legacy SSE, resumption, Last-Event-ID, replay,
OAuth, discovery, dynamic registration, prompts, resources, sampling,
elicitation, roots, logging, completion, subscription, or tasks. Client retries
are zero.

**Initialize request:** the runtime-owned request method and params are exactly:

```json
{
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": {},
    "clientInfo": {
      "name": "nexusloop-commander-external-research",
      "version": "1.0.0"
    }
  }
}
```

The complete JSON-RPC object additionally contains only `jsonrpc:"2.0"` and
one local ephemeral request ID. No title, instructions, icons, URLs, roots,
sampling, elicitation, experimental capability, or caller field is allowed.
The exact client name/version, empty capability object, canonical serialization
version, and request-shape hash are recovery-policy identity. An outbound-body
fixture substitutes one deterministic test ID and compares the complete bytes.

**Initialize attestation:** before sending `notifications/initialized`, require
the initialize result to contain exactly:

```json
{
  "protocolVersion": "2025-06-18",
  "capabilities": { "tools": { "listChanged": false } },
  "serverInfo": {
    "name": "BLOCKED_EXPECTED_SERVER_NAME",
    "version": "BLOCKED_EXPECTED_SERVER_VERSION"
  }
}
```

The provider-requalification amendment replaces both blocked server constants
with exact values bound to its immutable deployment identity. `instructions`,
prompts, resources, logging, completions, sampling, elicitation, tasks, roots,
subscriptions, experimental/unknown capabilities, absent/true `listChanged`,
extra initialize fields, and server identity drift fail immediately. No
initialized notification, `tools/list`, or `tools/call` follows a mismatch. If
initialize issued a session, the sole permitted later request is the required
same-session audited DELETE cleanup under the separate cleanup signal.

**Tool attestation:** after initialize succeeds, `tools/list` fits one page and
exactly attests the expected tool/input/output schemas. A cursor, extra/missing
tool, or drift blocks before `tools/call`.

## Session And Header Contract

The runtime constructs request headers; callers and the model supply none.
Header injection is exact:

| Request | Required headers |
| --- | --- |
| initialize POST | `Content-Type: application/json`; `Accept: application/json, text/event-stream` |
| initialized/list/call POST | the initialize headers plus `MCP-Protocol-Version: 2025-06-18`; add the exact issued `Mcp-Session-Id` when stateful |
| session DELETE | `MCP-Protocol-Version: 2025-06-18` and exact issued `Mcp-Session-Id`; no body or content type |

Every request also uses the transport-owned `Connection: close` header over a
fresh HTTP/1.1 TLS connection. Caller override remains forbidden.

No session header is sent before one is issued. Credentials are resolved and
injected only inside the existing transport boundary and are never included in
this policy identity as values. Cookies, caller headers, alternate Accept
values, protocol overrides, duplicate headers, and forwarding response headers
are forbidden.

Add no raw response-header field to a public or Commander DTO. A future request
service extension exposes only this internal response allowlist:

```text
content-type
mcp-session-id
```

Duplicate, folded, non-ASCII, control-bearing, or oversized values fail. A
session ID is one 1..160 ASCII token matching `[A-Za-z0-9._~-]+`. It remains in
memory only and is never logged, audited, hashed, journaled, rendered, or
returned.

`ExternalApiRequestService` must pass a runtime-internal
`on_response_headers_validated` observer to the transport. Immediately when the
initialize HTTP response headers arrive, the transport allowlists, deduplicates,
bounds, and validates the session token and synchronously invokes the observer
before reading, decoding, or buffering any response-body byte and therefore
before `writeAudit()`.

The observer receives only immutable copies of `content-type` and optional
`mcp-session-id`; it is not exposed through public request options, Commander
arguments, result DTOs, errors, or audit payloads. The gateway records the
validated session ID in its ephemeral per-call ledger. The observer is supplied
only for initialize; later responses cannot replace session identity. If the
body then times out, exceeds its byte ceiling, fails UTF-8/JSON/SSE decoding, or
the initialize audit append fails or is ambiguous, the gateway still performs
mandatory same-session DELETE cleanup under the reserved cleanup signal while
returning a non-success with no evidence. A malformed or unvalidated session
header is never reflected into cleanup.
Session extraction is independent of content-type acceptance: a valid unique
session still reaches the observer when content type later fails, while a
duplicate or malformed session never does.

If issued, cleanup is an exact same-origin/path/query DELETE with the session
header and no body. Connector method authority must be MCP-specific; globally
broadening `ExternalApiMethod` for unrelated connectors is unacceptable.
Only an empty HTTP 200 or 204 response is accepted; cleanup is not parsed as a
JSON-RPC response. Cleanup failure or ambiguity prevents successful evidence.
Shutdown drains cleanup before `runtime_shutdown`.

## Audit And Accounting

- One durable audit per NexusLoop transport attempt.
- At most five attempts stateful, four proven stateless.
- Initialization, notification, attestation, call, and cleanup all count.
- Before the first transport dispatch, preflight the complete fixed sequence
  against remaining Commander tool-call capacity: require five slots for a
  stateful or optionally stateful provider and four only for a provider whose
  accepted policy proves it cannot issue a session. Insufficient capacity
  returns `blocked` with zero transport attempts/audits.
- The reservation guarantees cleanup capacity but does not fabricate usage;
  increment the request counter immediately before every request-service call
  and after settlement charge the absolute counter by that exact attempted
  count, never by the reservation or only the confirmed durable audits.
- The binding must pass the authoritative remaining capacity into the gateway;
  caller arguments cannot provide or override it.
- No success until every required audit is durable.
- Audit persistence failure fails the call.
- A post-dispatch audit-persistence failure remains a schema-valid non-success:
  attempted and dispatched counts stay truthful, durable audit metadata is
  confirmed-only, evidence is withheld, and ambiguity is reconciled or fenced
  before shutdown.
- `persistence_uncertain` is always fenced work, never a settled result. The
  RuntimeServer ownership entry remains live until reconciliation changes the
  status to `complete` or `persistence_failed`; shutdown cannot append
  `runtime_shutdown` or release the run lock while that entry exists.
- The gateway owns an ephemeral per-call accounting ledger before its first
  request await: increment `request_count` before invoking the request service,
  increment `transport_boundary_entered_count` from the existing
  `on_transport_dispatched` transport-entry callback, increment
  `network_connection_attempt_count` from a new runtime-owned synchronous
  callback after validated-address selection and the final pre-connect abort
  check but immediately before opening the pinned TCP/TLS connection, increment
  `http_request_dispatch_count` from a second synchronous callback after TLS
  hostname verification and the final pre-request abort check but immediately
  before HTTP request dispatch, and append ID/kind only from
  `on_audit_persisted`. Capture an issued session only through the pre-audit
  `on_response_headers_validated` observer. No await is allowed between the
  final abort check, the corresponding callback, and connect/request dispatch.
  A narrow typed request-service failure
  classification distinguishes audit persistence from transport/protocol
  failure without exposing raw errors. The ledger constructs the bounded DTO even when the
  request-service promise rejects; executor fallback must not fabricate zero
  network activity.
- Add these optional executor-owned fields to `CommanderToolExecutionResult`:
  `external_api_request_attempt_count`,
  `external_api_transport_boundary_entered_count`,
  `external_api_network_connection_attempt_count`,
  `external_api_http_request_dispatch_count`, `external_api_audit_status`,
  `external_api_audit_event_kinds`, and `external_api_settlement_status`.
  Settlement status is exactly `settled | runtime_owned_unresolved`; audit
  status is exactly `complete | persistence_failed | persistence_uncertain`.
  Every field is required for the MCP binding and copied from the gateway
  ledger even when the executor withholds a failed handler result.
  `external_api_audit_event_count` remains the confirmed durable audit count,
  `external_api_audit_request_ids` remains operational metadata, and
  `network_called` is derived from
  `external_api_network_connection_attempt_count > 0`. Existing non-MCP
  bindings that omit the new fields retain their current behavior.
- The controller validates
  `request_attempt_count >= transport_boundary_entered_count >=
  network_connection_attempt_count >= http_request_dispatch_count` and
  `request_attempt_count >= external_api_audit_event_count` independently,
  because a durable failed audit may precede connection or HTTP dispatch. It
  validates the durable event-kind array length against the durable count, adds
  only that count to `externalApiAudits`, and
  charges `tool_call_count` by `max(1, external_api_request_attempt_count)` for
  an invoked MCP tool. `runtime_owned_unresolved` or any non-complete audit
  status is non-progressing, publishes no evidence, stops the current
  Commander loop, and permits no later model, tool, checkpoint, or terminal
  event. Existing bindings that omit the MCP fields retain the current
  durable-count-or-one fallback. Malformed counts fail closed before another
  model request. Thus three MCP attempts with two durable audits consume three
  budget slots, while a gateway preflight that invokes the tool but dispatches
  zero requests still consumes one slot and cannot be repeated without
  exhausting `max_tool_calls`.
- Audit request IDs/timestamps are excluded from gateway and Commander execution
  semantic hashes. `CommanderToolExecutor` must recursively omit only the exact
  operational `external_api_audit_request_ids` field (and existing volatile time
  fields) from its stable execution projection; request, transport-entry,
  connection, HTTP-dispatch, and durable-audit counts, audit status, settlement
  status, audit event kinds/outcomes, network/MCP flags, and all evidence remain
  semantic.
- Raw JSON-RPC bodies/responses and sessions are never persisted.
- Provider downstream requests are `unknown` unless a separately validated
  attempt ledger exists.
- Rate limits are not retried.

### Validated-Address Pinning

Native `fetch(input.url)` is not sufficient because it may resolve the hostname
again after `validateResolvedHost()`. For every POST or DELETE, the future MCP
transport must resolve the fixed configured hostname once, reject empty answers
and any private/non-global/malformed member of the complete answer set, select
one canonical public address deterministically with no address fallback, and pin
the HTTPS connection to that address. TLS SNI, certificate verification, and the
HTTP Host authority remain the original configured hostname. Redirects remain
disabled. The validated address and peer address are checked for equality but
are operational only: neither is persisted, hashed into evidence, exposed to the
model, or reused by recovery.

Connection reuse is forbidden. Each initialize, initialized, attestation, tool
call, and cleanup request repeats DNS validation and opens one fresh pinned TLS
connection, negotiates exactly HTTP/1.1, sends `Connection: close`, consumes one
response, and closes before the next protocol request. Keep-alive pools, HTTP/2
or HTTP/3 multiplexing, alternate-service upgrade, connection coalescing, and
cross-call/session connection reuse fail closed. Therefore every HTTP dispatch
has its own preceding connection attempt and the aggregate ordering invariant
remains truthful. A provider that cannot support this exact transport remains
`NO-GO`.

Each protocol request repeats resolution and pinning before dispatch; no later
native resolver call may choose the connection peer. The fit spike must prove
the actual client stack honors pinning for IPv4 and IPv6. A public-first/private-
second rebinding fixture, mixed public/private answer fixture, peer mismatch,
and hostname-certificate mismatch all fail before HTTP request bytes. If this
cannot be implemented without a new dependency, frozen edit, ambient agent, or
weaker TLS verification, 9XB1 remains `NO-GO` and must request approval rather
than use native fetch.

## Result Validation

1. Classify the request as JSON-RPC or one of the two exact lifecycle
   acknowledgements above.
2. For a lifecycle acknowledgement, verify its exact status and empty body and
   do not run JSON-RPC parsing.
3. For JSON-RPC, require HTTP 200 and an exact accepted content type, then parse
   bounded JSON or bounded request-scoped SSE. Reject every other status even
   when its body is otherwise parseable.
4. Verify JSON-RPC version, response ID, and exclusive result/error shape.
5. Reject MCP errors as evidence.
6. For `tools/call`, require `isError` to be absent or exactly `false`; reject
   `isError: true` before reading or validating `structuredContent`.
7. Require exact structured output and output-schema validation.
8. If a canonical text mirror is required, parse it and require semantic
   equality with structured content; otherwise reject text.
9. Reject image, audio, resource link, embedded resource, base64, prompt,
   instruction, schema, annotation, and `_meta` evidence.
10. Normalize Unicode/control/terminal characters deterministically.
11. Redact secrets before sizing, hashing, publication, or display.
12. Validate HTTPS URLs and source policy without deriving authority.
13. Apply item/block/string/byte caps and omission counts.
14. Build stable provider/tool/schema/source-bound evidence hashes.

On the wire, `structuredContent` is exactly one top-level object in the MCP tool
result. It is not a `content[]` block. The `content` field is required and must
be an array containing either zero entries or exactly one `TextContent`
canonical JSON mirror; an absent/non-array field, every other block, or any
extra array entry fails closed.

No raw MCP result enters the journal. Existing checkpoints retain only bounded
evidence cards, execution digests, hashes, summaries, and truthful audit counts.

## Source And Paper Operations

`external_research.source_show` is not implemented in 9XB1. 9XB2A must define
an evidence-bound source handle or exact configured-domain policy. A search URL
is not execution permission.

`external_research.paper_metadata` is not implemented in 9XB1. 9XB2B must
select a typed bibliographic operation. Search heuristics may not fabricate DOI,
authorship, venue, or citation status.

## Hard Ceilings

| Dimension | Maximum |
| --- | --- |
| Logical MCP tool calls per Commander invocation | 1 |
| NexusLoop requests | 5 stateful; 4 stateless |
| `tools/list` pages | 1; any cursor fails |
| Search results | 8 |
| Top-level `structuredContent` objects | exactly 1 for successful evidence |
| MCP `content[]` blocks | at most 1 exact canonical JSON text mirror |
| Response bytes per request | 128,000 |
| Normalized evidence bytes | 8,000 |
| Application protocol wall time | 13,000 ms |
| Reserved cleanup-and-audit wall time | 2,000 ms |
| Gateway external-work and settlement wall time | 15,000 ms |
| CommanderToolExecutor envelope | 17,000 ms; drain grace only, no external authority |
| Concurrent calls per RuntimeServer | 1 |
| Concurrent sessions | 1 |
| Client retries | 0 |

## Runtime Lifecycle

- Register ownership before the first asynchronous preflight.
- RuntimeServer owns an exact `activeExternalResearchReadSettlements` registry.
  The gateway registers its final protocol/cleanup/audit settlement promise in
  that registry before its first await and removes it only after actual
  settlement. Returning a bounded unresolved handoff does not remove it.
- Extend `CommanderToolBinding` with one optional package-internal synchronous
  entry point, `begin_owned_external_read(context, validatedArguments)`, used
  only by the exact `external_research.search` binding. It returns before any
  await:

  ```text
  CommanderOwnedExternalReadExecution {
    result: Promise<unknown>
    settlement: Promise<void>
    snapshot: () => CommanderOwnedExternalReadSnapshot
  }
  ```

  `snapshot()` is synchronous, side-effect-free, deep-cloned/frozen, bounded,
  and returns only the current attempted-request, transport-entry,
  connection-attempt, HTTP-dispatch, durable-audit, audit-kind, network/MCP,
  audit-status, and settlement-status ledger plus bounded blockers. It never
  exposes evidence, raw protocol data, sessions, audit IDs, credentials, or an
  ownership token. The binding constructs the promises and registers
  `settlement` in `activeExternalResearchReadSettlements` before starting its
  asynchronous protocol function. `CommanderToolExecutor` obtains this handle
  synchronously before awaiting `result`; at the 17,000 ms envelope it invokes
  `snapshot()` and can therefore return a truthful unresolved result without
  waiting for `result`. Ordinary bindings retain the existing `execute`
  contract and cannot opt into this path through descriptor metadata.
- Require active, ready, non-stopping RuntimeServer and run lock.
- Compose investigation, caller, and shutdown cancellation for application
  messages.
- Check abort before initialization, during DNS/transport, between every
  application message, and before/during the tool call.
- Start no later application request after application abort.
- Start one monotonic 15,000 ms invocation deadline before protocol preflight.
  Application protocol requests use the earlier caller/lifecycle deadline and a
  fixed `started_at + 13,000 ms` deadline. The final 2,000 ms is reserved for
  session cleanup, its durable audit, and settlement; it is not fresh time added
  after the invocation ceiling.
- If initialization issued a session, run the mandatory cleanup DELETE even
  after caller/application cancellation. Cleanup uses a separate bounded,
  RuntimeServer-owned cleanup signal that ignores caller cancellation, remains
  part of shutdown drain, and expires at the earliest of `cleanup_started_at +
  2,000 ms`, the original `started_at + 15,000 ms` invocation deadline, or an
  earlier RuntimeServer shutdown-drain deadline.
- Check cleanup cancellation before and during DELETE. Begin no cleanup network
  request at or after that earliest deadline. Cleanup is disposal, not request
  replay or permission to publish evidence. Cleanup timeout or incomplete audit
  yields no successful evidence; unresolved durable persistence retains the run
  lock under the existing shutdown fence rather than extending the tool budget.
- Drain protocol, audit, normalization, and cleanup before shutdown.
- Add only `external_research.search` to a new exact
  `DRAINED_EXTERNAL_READ_TOOL_IDS` executor set; do not broaden
  `SAFE_GITHUB_TOOL_IDS` or infer draining from namespace/metadata.
  Its descriptor timeout is 17,000 ms, two seconds beyond the gateway's hard
  15,000 ms external-work/settlement deadline. Caller abort or executor timeout
  aborts the handler. The executor waits until the earlier of handler settlement
  or the 17,000 ms envelope before constructing `CommanderToolExecutionResult`;
  it never returns a zero-fact fallback.
- The extra executor interval permits only handler draining. No DNS, connection,
  HTTP, cleanup, or audit request may start at or after the gateway's 15,000 ms
  deadline. A settled handler returns its final ledger with
  `external_api_settlement_status=settled`. If cleanup, audit persistence, or
  another already-started boundary remains unresolved at 17,000 ms, the gateway
  synchronously freezes a bounded lower-bound ledger snapshot. Its still-active
  promise remains in the RuntimeServer-owned external-read registry where it
  was registered before the first await. The executor returns
  `external_api_settlement_status=runtime_owned_unresolved` and preserves the
  exact current audit status; an unresolved audit append requires
  `external_api_audit_status=persistence_uncertain`. The snapshot can report
  only facts already observed; it publishes no evidence and never claims final
  completeness. The controller halts as above. RuntimeServer drains the
  still-registered promise before `runtime_shutdown`; a drain timeout retains the
  run lock, fails shutdown, and appends no `runtime_shutdown` event. No detached
  or unowned promise is permitted. A result cannot report
  `external_api_settlement_status=settled` while audit status is uncertain.
- Retain the run lock if durable audit/journal work cannot settle.
- Cancellation, timeout, disconnect, malformed SSE, or cleanup uncertainty
  never becomes known successful evidence.

## Recovery Compatibility

When a checkpoint loaded `external_research.search`, bind:

- descriptor/schema/description identity;
- authority and binding identity;
- provider/server build policy;
- exact initialize server name/version and static tools-only capability
  attestation identity;
- exact initialize client name/version, empty client-capability object, and
  canonical request-shape identity;
- origin/path/query, protocol, remote tool schemas;
- result types and normalization contract;
- session/cleanup/retry and source-scope policies;
- every ceiling;
- credential reference names/injection shape, never values;
- DNS full-answer validation, address-selection/pinning, peer/SNI/certificate/Host
  verification, HTTP/ALPN version, connection-close/no-reuse, redirect,
  dispatch-observation, audit, cancellation, and lifecycle policy.

Relevant drift stales approval. Removed bindings, unavailable credentials, or a
blocked gateway prevent recovery. Sessions, requests, arguments, results,
cursors, and retained work are never reconstructed or replayed.

## Production File Plan After Provider GO

### Add

- `agentcore/runtime/src/commander-tools/commander-external-research-types.ts`
- `agentcore/runtime/src/commander-tools/commander-external-research-schemas.ts`
- `agentcore/runtime/src/commander-tools/commander-external-research-config.ts`
- `agentcore/runtime/src/commander-tools/commander-external-research-mcp-transport.ts`
- `agentcore/runtime/src/commander-tools/commander-external-research-service.ts`
- `agentcore/runtime/src/commander-tools/commander-external-research-service.test.ts`
- `agentcore/runtime/src/commander-agent/commander-external-research-tool-authority-registry.ts`
- `tests/e2e_user/scenarios/test_commander_external_research_mcp_tui.py`
- `tests/e2e_user/recorded/commander_external_research_mcp_events.jsonl`

### Modify

- `commander-tool-registry.ts`: promote search only with exact schemas.
- `commander-tool-bindings.ts`: add one explicit owned-external-read service
  closure that returns the synchronous execution handle.
- `commander-tool-executor.ts`, `commander-tool-execution-types.ts`, and binding
  types: add the package-internal owned-external-read handle; generalize audited external
  reads without weakening 9XA, preserve the MCP attempted-request count for
  failed outcomes, include it in the stable execution projection, and add only
  `external_research.search` to an exact drained-handler set.
- `commander-tool-service.ts`: retain proposal-only deferred membership.
- `api-request-service.ts`, `api-transport.ts`, and narrow types:
  allowlisted internal headers, MCP-specific DELETE, and a runtime-only final
  connection-attempt and HTTP-dispatch observation pair that is not caller/model authority;
  add a provider-scoped HTTPS path that pins the validated address while
  preserving original-host SNI/certificate/Host validation; add the internal
  validated-header observer at transport response-header receipt before body
  consumption and audit persistence.
- `server.ts`: config/readiness, service factory, exact
  `activeExternalResearchReadSettlements` ownership registry, lifecycle abort,
  and shutdown drain.
- investigation controller: charge every request and retain bounded evidence.
- recovery types/service: bind policy only when the descriptor was loaded.
- journal/projection tests: prove no raw result/session/request persistence.
- package exports and existing authority summary surfaces.
- ADR-033 and canonical docs only after implementation.

Do not modify frozen `agentcore/server-fork/src/seams/mcp-gate.ts` or shared
Python MCP contracts.

## Required 9XB1 Tests

- descriptor/binding/authority equality and deferred loading;
- exact provider/tool/schema attestation and drift rejection;
- exact initialize result attestation requires the selected server name/version,
  tools-only capability metadata, and `listChanged=false`; prompts, resources,
  list changes, instructions, unknown capabilities/fields, or identity drift
  stop before the initialized notification and every later application request,
  while an issued session still receives exactly one bounded audited DELETE;
- exact initialize outbound-body fixture verifies fixed method/params, client
  name/version, empty client capabilities, no extra fields, and canonical bytes
  with a deterministic test request ID;
- exact `2025-06-18` negotiation and rejection of earlier/later versions;
- exact POST/protocol/session request headers and rejection of caller, duplicate,
  missing, premature-session, and override headers;
- fresh pinned HTTP/1.1 connection per request, `Connection: close`, exact ALPN,
  and rejection of keep-alive, pooling, HTTP/2/3, alternate service, coalescing,
  or any cross-request connection reuse;
- strict input and direct-service validation;
- bounded JSON/SSE parsing and unexpected-message rejection;
- HTTP 200 is the only accepted status for JSON-RPC initialize, attestation, and
  tool-call responses; parseable 201/202/204 and error statuses are rejected;
- empty HTTP 202 initialized-notification acknowledgement handling;
- empty HTTP 200/204 session-DELETE acknowledgement handling without JSON-RPC
  parsing;
- session validation and audited cleanup;
- initialize response with a valid session and failed/ambiguous audit append
  still performs exactly one bounded audited cleanup DELETE using only the
  pre-audit validated-header observation, publishes no evidence, and never puts
  the session in the failure/error/audit DTO;
- initialize response with a valid session followed by body timeout, oversize,
  invalid content type, invalid UTF-8, malformed JSON, or malformed SSE still
  performs exactly one bounded cleanup DELETE and publishes no evidence;
- validated-header observer is initialize-only, runs before audit append,
  runs before any body read, rejects malformed/duplicate session headers, and
  cannot be used by later responses to replace the cleanup session identity;
- caller cancellation after session issuance still performs bounded cleanup;
- initialize attestation failure with an issued session performs only bounded
  same-session DELETE cleanup; without a session it sends nothing later;
- audit completeness, zero retry, and downstream visibility;
- audit-persistence failure before and after confirmed dispatch produces a
  schema-valid non-success with exact attempted, transport-entry,
  network-connection, HTTP-dispatch, and durable-audit counts; it withholds
  evidence, charges every attempt, and reconciles ambiguity;
- executor/controller propagation retains `external_api_request_attempt_count`
  after failed-result omission, keeps durable audit accounting separate, and
  charges three attempts when only two audits became durable;
- zero-attempt MCP preflight rejection charges one invoked tool-call slot, and
  repeated distinct blocked calls cannot bypass `max_tool_calls`;
- gateway total deadline remains 15,000 ms while descriptor/executor timeout is
  17,000 ms; exact-deadline, caller-abort, and shutdown races prove the executor
  returns either the settled final ledger or the explicit RuntimeServer-owned
  unresolved handoff at or before the envelope;
- a timeout winner followed by cleanup settlement returns cancelled/failed with
  the settled MCP, connection, HTTP, attempted-request, and durable-audit facts;
  a persistence promise still unresolved at 17,000 ms returns the bounded
  lower-bound ledger with `runtime_owned_unresolved`, remains visible in the
  RuntimeServer `activeExternalResearchReadSettlements` set, blocks all later
  Commander activity, and cannot outlive successful shutdown; no handler/audit
  event occurs after `runtime_shutdown`;
- the executor obtains `begin_owned_external_read()` synchronously before its
  first await; a never-settling `result` promise still yields the bounded
  snapshot at 17,000 ms while `settlement` remains RuntimeServer-owned;
- every `persistence_uncertain + settled` fixture fails schema/executor
  validation; ambiguous audit persistence remains
  `runtime_owned_unresolved` until exact reconciliation and blocks successful
  shutdown/run-lock release;
- failed-result omission preserves attempted-request, transport-entry,
  connection, HTTP-dispatch, durable-audit, audit-status, settlement-status,
  and durable event-kind facts; ordering or event-kind-count mismatch fails
  closed before another model request;
- gateway and executor semantic-hash tests vary nested audit request IDs while
  preserving hashes, and separately prove changed attempted/transport-entry/
  network-connection/HTTP-dispatch/durable counts, audit status/outcome kinds,
  settlement status, and network/MCP facts change the execution hash;
- a durable pre-connect policy/DNS-failure audit with zero connection and HTTP
  counts remains valid; durable audit count is bounded independently by request
  attempts rather than incorrectly ordered after HTTP dispatch;
- full four/five-request budget preflight before dispatch, including zero
  transport/audit activity when capacity is insufficient and exact actual
  charging after settlement;
- structured output, redaction, injection resistance, and bounds;
- ready/empty/non-success schema fixtures prove nullable result/provenance,
  status-specific required fields, eight-card evidence cap, five-entry audit
  caps, 240-character audit-ID cap, and attempted/transport-entry/network-
  dispatch/durable-audit invariants for complete and audit-persistence-failure
  outcomes;
- DNS or abort rejection inside the transport after request-service entry keeps
  transport entry one and both network/HTTP counts zero. TCP timeout, TLS
  timeout, peer mismatch, or certificate failure keeps connection count one,
  HTTP dispatch zero, and `network_called=true`. Only the immediate pre-connect
  callback can set the observed network fact, and only the post-verification
  pre-request callback can record HTTP dispatch;
- DNS pinning fixtures reject public-first/private-second rebinding, mixed
  public/private answers, connection-peer drift, and SNI/certificate/Host
  mismatch without sending HTTP request bytes; no native re-resolution occurs;
- five-request stateful sequence observes five separate pinned connection
  attempts, never reuses a socket, and preserves
  `http_request_dispatch_count <= network_connection_attempt_count` through TLS
  and HTTP failures;
- executor status mapping proves `unknown` and unrecognized gateway statuses
  fail without publishing evidence; controller-state tests prove consecutive
  unknown results do not reset no-progress state or count as progress;
- `mcp_called=false` for gateway preflight that never enters the MCP adapter and
  true once initialize, attestation, or tool-call protocol work enters it,
  including policy/DNS rejection with `network_called=false` and later
  failed/cancelled/unknown results;
- JSON-RPC-successful `tools/call` fixtures with `isError: true` fail before
  structured-content validation and publish no evidence;
- `CallToolResult.content` is required and accepts only an empty array or one
  canonical `TextContent` mirror; absent, non-array, or extra blocks fail;
- every request/item/block/byte/time/concurrency ceiling;
- cancellation at every boundary and shutdown-final ordering;
- deterministic 13,000 ms application and 2,000 ms cleanup/audit deadlines stay
  within the original 15,000 ms invocation ceiling, including cancellation and
  shutdown races, without sleeps;
- controller execution through existing binding/executor;
- request-budget accounting;
- bounded checkpoint/journal state only;
- exact recovery staleness and no historical replay;
- existing 9XA and 9W3C regressions;
- deterministic injected transport for unit/integration tests only;
- one fresh-sandbox `@pytest.mark.phase_m4` real-CLI/OpenTUI user simulation at
  `tests/e2e_user/scenarios/test_commander_external_research_mcp_tui.py`, using
  the deterministic HTTPS fixture origin accepted by 9XB0R through the
  configured production transport path, with no runtime imports,
  monkey-patching, `allow_local_http`, private-host exception, or fake transport.
  It must prove deferred tool discovery, bounded untrusted evidence, durable
  request audits, lifecycle shutdown, and absence of mutation/proposal/governance
  authority. No such fixture is approved now, so this is an additional NO-GO
  condition rather than permission to add a test bypass.

## Exclusions

No generic MCP gateway, dynamic catalog, source fetch, paper metadata, research
DB write, proposal, governance, mutation, OpenCode action, public MCP command,
automatic investigation/recovery, retry, replay, provider failover, retained
run, broad provider-loop activation, 9Y, 9Z, or 10A/10B/10C behavior.
