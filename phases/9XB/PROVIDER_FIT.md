# 9XB0 Provider And Transport Fit

## Decision Summary

**Decision: `NO-GO`.**

The official hosted Exa MCP server is useful for interactive assistants, but it
does not satisfy NexusLoop's production authority contract. No second provider
was evaluated because no other first-party or pinned credible MCP implementation
was identified from repository evidence, and marketplace sampling is forbidden.

No 9XB1 descriptor, binding, authority record, or runtime path is approved by
this decision.

The current repository also lacks a production-faithful real-CLI fixture:
`allow_local_http` permits loopback by relaxing HTTPS/private-address policy and
therefore cannot validate this gateway contract. Provider requalification must
include a fixed deterministic HTTPS fixture origin that passes the same
certificate, public-address, origin, header, audit, and lifecycle checks without
real credentials or live mutable evidence. Until then, E2E activation is also
NO-GO.

## Evidence Basis

Evidence was collected on 2026-08-10 from:

- [Exa MCP official documentation](https://exa.ai/docs/reference/exa-mcp)
- [Exa MCP official repository](https://github.com/exa-labs/exa-mcp-server)
- exact source revision
  [`394f9210ed16d3e25d328e1e6db285824caedc04`](https://github.com/exa-labs/exa-mcp-server/tree/394f9210ed16d3e25d328e1e6db285824caedc04)
- exact source files for
  [server registration](https://github.com/exa-labs/exa-mcp-server/blob/394f9210ed16d3e25d328e1e6db285824caedc04/src/mcp-handler.ts),
  [hosted transport](https://github.com/exa-labs/exa-mcp-server/blob/394f9210ed16d3e25d328e1e6db285824caedc04/api/mcp.ts),
  [search](https://github.com/exa-labs/exa-mcp-server/blob/394f9210ed16d3e25d328e1e6db285824caedc04/src/tools/webSearch.ts),
  [fetch](https://github.com/exa-labs/exa-mcp-server/blob/394f9210ed16d3e25d328e1e6db285824caedc04/src/tools/webFetch.ts), and
  [retry behavior](https://github.com/exa-labs/exa-mcp-server/blob/394f9210ed16d3e25d328e1e6db285824caedc04/src/utils/errorHandler.ts)
- bounded anonymous initialize/initialized/tools-list probes against the
  documented hosted endpoint, including an exact `2025-06-18` request; no
  research tool was called
- the official MCP
  [2025-03-26 Streamable HTTP specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports),
  [2025-03-26 tool contract](https://modelcontextprotocol.io/specification/2025-03-26/server/tools),
  and [2025-06-18 structured tool contract](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)

The source revision was the official `main` head at inspection time. It declares
`exa-mcp-server` version `3.4.0`, resolves `@modelcontextprotocol/sdk` to
`1.26.0`, and uses `mcp-handler` `1.0.4`. It is evidence about one inspectable
candidate implementation only. The hosted deployment does not attest that
revision, so source-only behavior below is not attributed to hosted Exa.

## Hosted Exa Candidate

### Endpoint And Authentication

| Property | Verified contract |
| --- | --- |
| Origin | `https://mcp.exa.ai` |
| Path | `/mcp` |
| Narrowest fixed query evaluated | `tools=web_search_exa` |
| Transport | Streamable HTTP POST; hosted responses observed as `text/event-stream` |
| Anonymous mode | Supported with server-side rate limits |
| API key modes | `x-api-key`, `Authorization: Bearer`, or `exaApiKey` query |
| OAuth | Supported by hosted service |
| NexusLoop-compatible credential mode | Header credential reference only; query credentials and browser OAuth are forbidden |

The query must be a runtime constant. A model or operator must never add tool
names, login flags, API keys, source identifiers, or arbitrary query fields.

### Protocol And Session Probe

The superseding sanitized probe sequence was:

1. POST `initialize` requesting exact protocol `2025-06-18`.
2. POST `notifications/initialized` with the returned ephemeral session header.
3. POST one `tools/list` request.
4. DELETE the same session using the negotiated protocol and session header.

Observed facts:

```text
initialize status: 200
initialize content-type: text/event-stream
negotiated protocol: 2025-06-18
Mcp-Session-Id present: yes
reported server name: exa-search-server
reported server version: 3.2.1
server capabilities: tools.listChanged=true, prompts.listChanged=true,
  resources.listChanged=true
initialized status: 202
tools/list status: 200
tools/list content-type: text/event-stream
attested tools under fixed query: web_search_exa
input schema present: yes
output schema present: no
next cursor present: no
session DELETE status: 405
research tool called: no
```

The inspected source advertises version `3.4.0`, but the hosted service reported
`3.2.1`. The endpoint does not expose an immutable source revision or deployment
digest. A server-version string alone is insufficient because it does not bind
the deployed schema, handler code, dependencies, or downstream policy.

Hosted Exa therefore supports exact protocol `2025-06-18`, but its attested
`web_search_exa` tool still supplies no `outputSchema`. Protocol support alone
does not prove a provider-specific structured result. A prior probe requested
`2025-03-26` and received that supported version back; that observation did not
test the server's maximum supported revision and is not used as a NO-GO reason.

The hosted endpoint issued `Mcp-Session-Id`, but same-session DELETE returned
HTTP 405 with a nonempty body. That fails the required deterministic cleanup
contract. The inspected, unbound source exports DELETE and describes retained
session metadata, but those implementation details cannot repair or explain the
observed hosted behavior without deployment attestation.

### Exposed Capabilities

Default tools in the unbound inspected source are:

- `web_search_exa`
- `web_fetch_exa`

Optional/deprecated entries include advanced search, code/company/people
search, deep research, and `agent_run`. `agent_run` can retain asynchronous work
and resume by run ID, so it is categorically forbidden.

With `tools=web_search_exa`, the hosted initialization advertised tools,
prompts, and resources capability families. The unbound source registers a
search-help prompt and a tools-list resource. NexusLoop must reject these
capabilities regardless of their deployed contents; they never become model
context or runtime authority.

### Tool Schema And Result Shape

Observed `web_search_exa` input schema:

```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string", "minLength": 1 },
    "numResults": { "type": "number" }
  },
  "required": ["query"],
  "additionalProperties": false
}
```

The remote numeric field has no useful maximum in the observed attestation. A
future NexusLoop adapter would need a stricter runtime-owned integer bound and
must compare the remote schema to an expected hash rather than adopt it.

No output schema was observed under the exact hosted `2025-06-18` attestation.
No tool call was made, so hosted result content and formatting remain unknown.
The unbound source revision formats search results as MCP text and does not
produce structured content, but that is a source-fit warning, not a verified
hosted result contract. NexusLoop cannot approve either an output-schema-free
hosted deployment or a parser inferred from an unattested source revision.

### Downstream Requests, Retry, Rate Limit, And Telemetry

Hosted downstream request count, retry behavior, rate-limit configuration, and
telemetry are unknown because no deployed artifact or policy digest is attested.
The unbound source revision calls Exa Search behind the MCP boundary, uses
`retryWithBackoff` with two retries for selected transient errors, contains
rate-limit behavior, and instruments Agnost analytics. Those facts demonstrate
why an implementation/policy attestation is necessary; they are not claims that
the hosted `3.2.1` deployment executes the same code or policy. NexusLoop can
audit only its own MCP HTTP requests and must never infer downstream counts.

### Prompts, Resources, Sampling, Elicitation, Tasks, Notifications

| Capability | Evidence classification | NexusLoop decision |
| --- | --- | --- |
| Tools | Hosted fixed query attested only `web_search_exa`; other tools are source/docs-only | Attestation only; one exact tool would be required |
| Prompts | Hosted capability family advertised; contents not requested | Reject capability and every prompt message |
| Resources | Hosted capability family advertised; contents not requested | Reject capability and every resource/read |
| Tool list changes | Advertised in hosted initialization metadata | Reject; no server-driven changes |
| Sampling | Not observed or needed | Reject any request/capability |
| Elicitation | Not observed or needed | Reject any request/capability |
| Tasks | Not invoked; retained-agent behavior exists only in unbound source | Reject all task/retained-run behavior |
| Notifications | Hosted list-change metadata observed | Reject server notifications; allow only client initialized notification |
| GET stream | Exported by unbound source only | Do not use |
| SSE POST response | Hosted probe observed it | A future client must parse bounded request-scoped SSE |

### Descriptor Fit

| Commander placeholder | Candidate mapping | Decision | Reason |
| --- | --- | --- | --- |
| `external_research.search` | `web_search_exa` | Rejected | No hosted output schema, no immutable deployment/policy attestation, session cleanup returned 405 |
| `external_research.source_show` | `web_fetch_exa` | Rejected | Mapping exists only in unbound source/docs and its arbitrary-URL contract is outside approved source scope |
| `external_research.paper_metadata` | none | Rejected | No exact remote paper metadata operation |

The initial descriptor set is therefore empty.

## Required MCP Subset If A Future Provider Qualifies

The narrow protocol contract for any newly qualified provider is:

- exact version `2025-06-18`, re-probed against the selected deployment and any
  approved client dependency; earlier or later negotiated versions fail closed;
- Streamable HTTP to one fixed HTTPS origin/path/query;
- one JSON-RPC message per POST;
- `initialize` with exact runtime-owned params: protocol `2025-06-18`, empty
  client capabilities, and client identity
  `nexusloop-commander-external-research@1.0.0`; no caller or SDK-added field;
- immediate initialize attestation requiring exact protocol, selected
  `serverInfo.name`/`version`, and capabilities exactly
  `{tools:{listChanged:false}}`; every extra capability/field or identity drift
  stops before `notifications/initialized`; an issued session still receives
  only its bounded audited same-session DELETE cleanup;
- `notifications/initialized`, whose sole accepted acknowledgement is HTTP 202
  with an empty body and no JSON-RPC response;
- one bounded `tools/list` page for exact attestation;
- exactly one allowlisted `tools/call`;
- same-origin audited DELETE session termination when a session is issued;
  cleanup accepts only an empty HTTP 200 or 204 and is not parsed as JSON-RPC;
- `initialize`, `tools/list`, and `tools/call` JSON-RPC responses require HTTP
  200 exactly and may be `application/json` or bounded request-scoped
  `text/event-stream`; other statuses fail even with parseable bodies;
- every POST has runtime-owned `Content-Type: application/json` and
  `Accept: application/json, text/event-stream`; every post-initialize request
  also has `MCP-Protocol-Version: 2025-06-18` and the validated session ID when
  one was issued; callers cannot add or override headers;
- every request uses a fresh pinned HTTP/1.1 TLS connection with
  `Connection: close`; pooling, keep-alive, HTTP/2/3 multiplexing, alternate
  service, coalescing, and cross-request reuse are forbidden;
- session DELETE has no body and carries only the protocol version, issued
  session ID, runtime-owned credentials, and transport-required fixed headers;
- zero client retries and no resumption.

Reject any unexpected batch, response ID, duplicate ID, server request,
notification, capability, next cursor, extra tool, content type, SSE event,
JSON-RPC method, or message after the final response.

For `tools/call`, `content` is a required array with zero entries or one
canonical JSON `TextContent` mirror. `structuredContent` is the separately
required top-level object. An absent or malformed content array, `isError: true`,
or any other content-block type fails before evidence publication.

The selected provider must either be stateless and issue no session or support
the cleanup contract above. Session IDs must match a conservative ASCII token
grammar, remain memory-only, be sent only to the exact origin, and be destroyed
at settlement. Cleanup is an audited transport request; cleanup uncertainty
prevents successful evidence publication.

The request service must pass a runtime-internal validated-header observer to
the transport. The transport invokes it at initialize response-header receipt,
before body consumption or audit persistence. That lets the gateway retain an
issued session ephemerally and run DELETE cleanup when body processing or the
initialize audit append fails. It exposes only validated `content-type` and
`mcp-session-id`, never raw headers or durable session metadata.

## Audit Semantics

The audit unit is **one NexusLoop-controlled HTTP request**, not one logical MCP
call and not one provider-internal API request.

For a stateful single-tool invocation, the maximum expected audit sequence is:

1. initialize POST;
2. initialized-notification POST;
3. tools-list attestation POST;
4. tools-call POST;
5. session DELETE.

Every attempted request needs one durable `external_api_request_executed` or
`external_api_request_failed` outcome. Result DTOs use these full event-kind
strings rather than shortened labels. A logical result is not successful until
all required request audits, including cleanup, are durable. Audit IDs,
timestamps, session IDs, and JSON-RPC IDs are operational metadata excluded from
semantic evidence hashes.

The result must separately report:

- NexusLoop transport request count and audit IDs/kinds;
- one logical MCP invocation count;
- whether an MCP protocol request entered the fixed adapter (`mcp_called`);
- whether a pinned TCP/TLS connection was attempted (`network_called`) and,
  separately, whether HTTP request bytes were dispatched after TLS verification;
- provider downstream request visibility: `unknown`.

It must never claim that a single MCP audit proves the count or outcome of
downstream search/fetch requests.

## Evidence Contract Required For A Future GO

Accepted result content is limited to:

- one operation-specific `structuredContent` object that validates against the
  exact expected output schema; and
- if required by the selected server, at most one text block containing
  canonical JSON that parses to semantic equality with `structuredContent`.

`structuredContent` is a top-level tool-result field, not an element of
`content[]`. The content field is required and is either an empty array or an
array containing only that one canonical text mirror.

Rejected content:

- unstructured text;
- image or audio blocks;
- resource links;
- embedded resources;
- raw base64;
- annotations or `_meta` used as evidence;
- prompts, schemas, instructions, or executable guidance;
- extra or duplicate content blocks.

Normalization must bound strings and arrays, remove control/terminal escapes,
redact secrets before hashing, validate URL origin/scheme/userinfo/query policy,
and produce operation-specific evidence plus provenance containing provider,
server-policy, remote-tool, schema, source, retrieval, truncation, and stable
content hashes. Missing or partial required fields produce `unknown`, `blocked`,
or `failed`, never known-empty or complete.

`unknown` is a gateway fact, not a successful Commander execution outcome. The
future executor must map it to `failed`, retain bounded audit facts, publish no
result/evidence, and prevent controller progress. Any unrecognized gateway
status fails the same way.

## Source Scope

`external_research.source_show` is deferred. `web_fetch_exa` accepts arbitrary
URLs, which is incompatible with runtime-owned source authority.

A future source tool requires one of:

1. an opaque, provider-authenticated source handle issued by a prior accepted
   search result and cryptographically or semantically bound to the same
   provider/tool/policy; or
2. an exact configured domain allowlist plus canonical HTTPS URL validation and
   a proof that redirects and final destinations remain inside that scope.

Search output URLs are evidence, not permission. URLs with userinfo, fragments,
control characters, private/local destinations, credential-like query values,
unsupported schemes, excessive length, or non-allowlisted hosts are rejected
before transport and never persisted raw.

## Proposed Hard Ceilings For A Future 9XB1 Search

These ceilings are the maximum contract, not caller defaults:

| Dimension | Hard ceiling |
| --- | --- |
| Logical MCP tool calls per Commander invocation | 1 |
| NexusLoop transport requests | 5 with session cleanup; 4 if proven stateless |
| `tools/list` pages | 1; `nextCursor` fails attestation |
| Search results | 8 |
| Top-level `structuredContent` objects | exactly 1 for successful evidence |
| MCP `content[]` blocks | at most 1 exact canonical JSON text mirror |
| Response bytes per request | 128,000 |
| Normalized evidence bytes | 8,000 |
| Application protocol wall time | 13,000 ms |
| Reserved cleanup-and-audit wall time | 2,000 ms |
| Gateway external-work and settlement wall time | 15,000 ms |
| Executor settle-or-handoff envelope | 17,000 ms; no external work after 15,000 ms |
| Concurrent external-research calls per RuntimeServer | 1 |
| Concurrent sessions | 1 |
| Client retries | 0 |

Each transport request must consume existing Commander external-request/tool
budget using the 9XA accounting model. Before initialization, the gateway must
require capacity for the complete fixed sequence: five slots for stateful or
optionally stateful policy, four only for a proven-stateless policy. Insufficient
capacity dispatches zero requests; final charging uses the exact number of
request-service invocations incremented before each call rather than the
reservation or only durable audits. Attempted request-service, transport-entry,
pinned-connection, verified HTTP-dispatch, and confirmed-durable-audit counts
remain distinct when transport preflight or audit persistence fails.
Cancellation is checked before and during
every application request, between messages, and before the tool call.
No later application request starts after abort. If a session was issued,
same-origin cleanup still runs under a separate bounded RuntimeServer cleanup
signal that ignores caller cancellation but remains owned by shutdown drain.
One monotonic clock starts before protocol preflight. Application work ends at
`started_at + 13,000 ms`; the remaining 2,000 ms is reserved inside, not added
to, the 15,000 ms total for cleanup, its audit, and settlement. Cleanup expires
at the earliest of two seconds after cleanup begins, the original total
deadline, or an earlier shutdown-drain deadline. No network request starts after
that point. Cleanup uncertainty prevents successful evidence publication;
unresolved durable persistence uses the existing run-lock fence instead of
extending executable tool authority.

The executor does not await an unresolved persistence promise without a bound.
At 17,000 ms it must have either the final settled ledger or an atomic
RuntimeServer-owned handoff plus a bounded lower-bound ledger marked
`runtime_owned_unresolved`. The ledger preserves the exact current audit status;
an unresolved audit append is `persistence_uncertain`. The handoff publishes no
evidence, halts the Commander loop, remains in shutdown drain, and prevents a
successful shutdown/run-lock release until it settles safely.

The fixed binding must expose a synchronous package-internal owned-execution
handle before any await, containing separate result/settlement promises and a
bounded ledger snapshot callback. This is not a generic descriptor-selected
extension. `persistence_uncertain` always implies
`runtime_owned_unresolved`; a settled/uncertain pair is invalid and cannot
remove the RuntimeServer fence.

## Recovery Compatibility Identity

A future credential-free gateway policy hash must include:

- Commander descriptor version and exact input/output schema hashes;
- authority ID and complete authority-record hash;
- binding ID/version/hash;
- provider ID, immutable server build/policy identity, fixed origin/path/query;
- exact initialize server name/version and static tools-only capability
  attestation identity;
- exact initialize client name/version, empty client-capability object, and
  canonical request-shape identity;
- protocol version and accepted response content types;
- remote tool name and expected input/output schema hashes;
- accepted MCP result block types and normalization version;
- session/header/cleanup policy;
- request, item, block, response-byte, normalized-byte, wall-time,
  concurrency, and retry ceilings;
- source-scope policy;
- credential reference names and injection shape, never values;
- transport DNS full-answer validation, deterministic address pinning,
  peer/SNI/certificate/Host verification, HTTP/ALPN version,
  connection-close/no-reuse, redirect, origin, dispatch-observation, and audit
  policy identity.

Only investigations whose accepted checkpoint loaded an external-research tool
bind this policy. Any relevant change stales that recovery authority. Session
IDs, MCP/JSON-RPC request IDs, messages, arguments, result bodies, cursors,
retained runs, and historical network requests are never persisted or replayed.

## Dependency And Architecture Comparison

### 1. Official MCP TypeScript SDK

- **Package/lock impact:** adds a new runtime dependency and lockfile changes;
  not authorized in 9XB0.
- **Auditability:** default Streamable HTTP transport owns fetch; it is not
  acceptable unless every fetch is replaced by an adapter that routes through
  `ExternalApiRequestService`.
- **Cancellation/session:** capable, including session termination, but broad
  APIs also support OAuth, fallback transports, server requests, resumption,
  prompts, resources, sampling, elicitation, and tasks that NexusLoop must
  disable and test.
- **Retry:** SDK auth providers may retry after 401 when configured; forbidden
  for this path.
- **Authority:** remains NexusLoop-owned only with a strict wrapper and exact
  capability rejection.
- **Frozen/upstream impact:** no frozen file is inherently required; package and
  lock approval is required.
- **Fit:** potentially viable only after provider GO and an audited-fetch spike;
  not approved now.

### 2. Narrow Custom Adapter Over `ExternalApiRequestService`

- **Package/lock impact:** none if implemented with existing JSON and a small,
  fully tested bounded SSE parser.
- **Auditability:** strongest fit because each POST/DELETE is explicit and
  already audited.
- **Cancellation/session:** requires an allowlisted internal response-header
  view and a narrowly authorized DELETE path; current service is insufficient
  unchanged.
- **Retry:** can guarantee zero client retries.
- **Authority:** fixed methods, IDs, schemas, and capabilities remain local.
- **Frozen/upstream impact:** no frozen MCP gate or upstream code needed.
- **DNS/TLS fit:** current native fetch re-resolves after DNS validation and is
  not approved. The adapter must pin one validated public address with no
  fallback while retaining original-host SNI, certificate, and Host validation.
- **Connection fit:** one new pinned HTTP/1.1 connection per request is required;
  generic fetch pooling and HTTP/2 multiplexing are not approved.
- **Fit:** preferred future transport shape if a provider qualifies, the
  protocol subset remains small, and a deterministic pinning fit spike passes;
  otherwise remains `NO-GO`.

### 3. Reuse Upstream OpenCode MCP Machinery

- **Package/lock impact:** may avoid a new top-level package but imports runtime
  authority from vendored/upstream code.
- **Auditability:** does not naturally route every request through NexusLoop's
  external audit service.
- **Cancellation/session/retry:** coupled to upstream behavior and configuration.
- **Authority:** ambient OpenCode server/tool discovery conflicts with fixed
  Commander authority.
- **Frozen/upstream impact:** crosses the fork/vendor boundary and risks the
  frozen MCP gate shortcut.
- **Fit:** rejected.

### 4. Direct Provider REST

- **Package/lock impact:** none when using `ExternalApiRequestService`.
- **Auditability/cancellation/retry:** can match 9XA with fixed requests and zero
  retries.
- **Session:** generally unnecessary.
- **Authority:** NexusLoop can own exact endpoints and schemas.
- **Frozen/upstream impact:** none.
- **Fit:** may be technically safer, but it is not MCP and therefore does not
  satisfy the 9XB requirement. It needs a separately approved scope/ADR.

## Production-Fit Verdict

Hosted Exa fails four independently observed mandatory gates:

1. no immutable deployment/source identity;
2. initialize advertised forbidden prompts/resources capability families and
   `tools.listChanged=true` rather than exact tools-only static capability;
3. no strict output schema in exact `2025-06-18` tools attestation;
4. issued-session cleanup returned HTTP 405 instead of the required empty
   HTTP 200/204 acknowledgement.

Hosted downstream retries, result formatting, rate-limit policy, telemetry, and
retained-session implementation remain unknown/unattested. The inspected source
raises risks in each area but is not bound to the deployment. Hosted capability
families also include prompts and resources, which remain forbidden. The
production-faithful deterministic HTTPS fixture gate remains unresolved.
NexusLoop's current native-fetch transport also does not pin the validated DNS
answer to the connection; a production-fit pinning spike is an independent
9XB1 blocker, not permission to weaken DNS or TLS checks.

**Final provider result: `NO-GO`.**
