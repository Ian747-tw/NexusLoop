# 9XB0 Provider And Transport Fit

## Decision Summary

**Decision: `NO-GO`.**

The official hosted Exa MCP server is useful for interactive assistants, but it
does not satisfy NexusLoop's production authority contract. No second provider
was evaluated because no other first-party or pinned credible MCP implementation
was identified from repository evidence, and marketplace sampling is forbidden.

No 9XB1 descriptor, binding, authority record, or runtime path is approved by
this decision.

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
- a bounded anonymous initialize/initialized/tools-list probe against the
  documented hosted endpoint; no research tool was called
- the official MCP
  [2025-03-26 Streamable HTTP specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)

The source revision was the official `main` head at inspection time. It declares
`exa-mcp-server` version `3.4.0`, resolves `@modelcontextprotocol/sdk` to
`1.26.0`, and uses `mcp-handler` `1.0.4`.

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

The sanitized probe sequence was:

1. POST `initialize` with protocol `2025-03-26`.
2. POST `notifications/initialized` with the returned ephemeral session header.
3. POST one `tools/list` request.

Observed facts:

```text
initialize status: 200
initialize content-type: text/event-stream
negotiated protocol: 2025-03-26
Mcp-Session-Id present: yes
reported server name: exa-search-server
reported server version: 3.2.1
server capabilities: tools.listChanged, prompts.listChanged, resources.listChanged
initialized status: 202
tools/list status: 200
tools/list content-type: text/event-stream
attested tools under fixed query: web_search_exa
input schema present: yes
output schema present: no
task support: forbidden
```

The inspected source advertises version `3.4.0`, but the hosted service reported
`3.2.1`. The endpoint does not expose an immutable source revision or deployment
digest. A server-version string alone is insufficient because it does not bind
the deployed schema, handler code, dependencies, or downstream policy.

Only protocol `2025-03-26` was positively verified. This contract does not infer
support for another revision from SDK source or current MCP documentation.

The hosted source issues `Mcp-Session-Id`, exposes it in CORS headers, stores
bounded client metadata for up to 24 hours when Redis is configured, and exports
GET, POST, and DELETE handlers. A compliant 2025-03-26 session client therefore
needs ephemeral session handling and same-origin DELETE termination.

### Exposed Capabilities

Default tools in the inspected source are:

- `web_search_exa`
- `web_fetch_exa`

Optional/deprecated entries include advanced search, code/company/people
search, deep research, and `agent_run`. `agent_run` can retain asynchronous work
and resume by run ID, so it is categorically forbidden.

Even with `tools=web_search_exa`, initialization advertises prompt and resource
capabilities and list-change support. The source registers a search-help prompt
and a tools-list resource. NexusLoop must reject and ignore these capabilities;
they must never become model context or runtime authority.

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

No output schema was observed. The pinned implementation converts each result
into a formatted text block containing title, URL, publication date, author,
and highlights/text, separated by prose delimiters. It does not return MCP
`structuredContent`.

This is not a citation-grade machine contract:

- hostile result text can imitate delimiters and labels;
- missing values are rendered as prose such as `N/A`;
- no structural distinction exists between provider metadata and source text;
- partial data cannot be distinguished reliably from complete data;
- no output-schema hash can be bound into recovery compatibility.

An exact text parser is not approved because the hosted deployment is not
revision-attested and the text includes attacker-controlled web content.

### Downstream Requests, Retry, Rate Limit, And Telemetry

`web_search_exa` calls the Exa Search REST API inside the remote server. The
implementation wraps that call in `retryWithBackoff`, whose default is two
retries after the first attempt for Exa errors with status 500, 502, 503, or
504. NexusLoop can see one MCP `tools/call`; it cannot see or durably audit the
one-to-three downstream Exa API attempts.

The hosted layer rate-limits anonymous `tools/call` requests. Source defaults
are 2 QPS and 50 requests/day when Upstash is configured. A rate-limiter failure
is explicitly fail-open. A provider API key bypasses anonymous limits. HTTP 429
is returned as an MCP error and is not retried by the inspected handler, but
NexusLoop cannot bind hosted environment configuration.

The source instruments the MCP server with Agnost analytics. Input, output,
error, and logs are configured disabled, and hosted request handling removes API
key headers/query before forwarding to the handler. Nevertheless, tool-side
analytics are an additional provider-controlled outbound boundary and their
deployed behavior cannot be attested by NexusLoop.

### Prompts, Resources, Sampling, Elicitation, Tasks, Notifications

| Capability | Candidate behavior | NexusLoop decision |
| --- | --- | --- |
| Tools | Search/fetch plus optional/deprecated tools | Attestation only; one exact tool would be required |
| Prompts | Registered | Reject capability and every prompt message |
| Resources | Registered | Reject capability and every resource/read |
| Tool list changes | Advertised | Reject; no server-driven changes |
| Sampling | Not needed for search | Reject any request/capability |
| Elicitation | Not needed for search | Reject any request/capability |
| Tasks | Search attestation says forbidden; agent supports retained runs | Reject all task/retained-run behavior |
| Notifications | List changes advertised | Reject server notifications; allow only client initialized notification |
| GET stream | Hosted handler exports GET | Do not use |
| SSE POST response | Observed and required for this candidate | A future client must parse bounded request-scoped SSE |

### Descriptor Fit

| Commander placeholder | Candidate mapping | Decision | Reason |
| --- | --- | --- | --- |
| `external_research.search` | `web_search_exa` | Rejected | Hidden downstream retries, text-only result, no output schema, deployment drift |
| `external_research.source_show` | `web_fetch_exa` | Rejected | Arbitrary URL arrays, full content fetch, same retry/audit gap |
| `external_research.paper_metadata` | none | Rejected | No exact remote paper metadata operation |

The initial descriptor set is therefore empty.

## Required MCP Subset If A Future Provider Qualifies

The narrow protocol contract is:

- exact version `2025-03-26`, subject to revalidation against the selected
  provider and any approved client dependency;
- Streamable HTTP to one fixed HTTPS origin/path/query;
- one JSON-RPC message per POST;
- `initialize`;
- `notifications/initialized`;
- one bounded `tools/list` page for exact attestation;
- exactly one allowlisted `tools/call`;
- same-origin audited DELETE session termination when a session is issued;
- POST responses may be `application/json` or bounded request-scoped
  `text/event-stream`;
- zero client retries and no resumption.

Reject any unexpected batch, response ID, duplicate ID, server request,
notification, capability, next cursor, extra tool, content type, SSE event,
JSON-RPC method, or message after the final response.

The selected provider must either be stateless and issue no session or support
the cleanup contract above. Session IDs must match a conservative ASCII token
grammar, remain memory-only, be sent only to the exact origin, and be destroyed
at settlement. Cleanup is an audited transport request; cleanup uncertainty
prevents successful evidence publication.

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
`external_api_request_failed` outcome. A logical result is not successful until
all required request audits, including cleanup, are durable. Audit IDs,
timestamps, session IDs, and JSON-RPC IDs are operational metadata excluded from
semantic evidence hashes.

The result must separately report:

- NexusLoop transport request count and audit IDs/kinds;
- one logical MCP invocation count;
- provider downstream request visibility: `unknown`.

It must never claim that a single MCP audit proves the count or outcome of
downstream search/fetch requests.

## Evidence Contract Required For A Future GO

Accepted result content is limited to:

- one operation-specific `structuredContent` object that validates against the
  exact expected output schema; and
- if required by the selected server, at most one text block containing
  canonical JSON that parses to semantic equality with `structuredContent`.

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
| MCP content blocks | 2 total; only structured plus canonical JSON mirror |
| Response bytes per request | 128,000 |
| Normalized evidence bytes | 8,000 |
| Total wall time | 15,000 ms |
| Concurrent external-research calls per RuntimeServer | 1 |
| Concurrent sessions | 1 |
| Client retries | 0 |

Each transport request must consume existing Commander external-request/tool
budget using the 9XA accounting model. Cancellation is checked before and
during every request, between messages, before the tool call, before cleanup,
and during shutdown drain. No later request starts after abort.

## Recovery Compatibility Identity

A future credential-free gateway policy hash must include:

- Commander descriptor version and exact input/output schema hashes;
- authority ID and complete authority-record hash;
- binding ID/version/hash;
- provider ID, immutable server build/policy identity, fixed origin/path/query;
- protocol version and accepted response content types;
- remote tool name and expected input/output schema hashes;
- accepted MCP result block types and normalization version;
- session/header/cleanup policy;
- request, item, block, response-byte, normalized-byte, wall-time,
  concurrency, and retry ceilings;
- source-scope policy;
- credential reference names and injection shape, never values;
- transport DNS, redirect, origin, and audit policy identity.

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
- **Fit:** preferred future transport shape if a provider qualifies and the
  protocol subset remains small; requires a fit spike before production.

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

Hosted Exa fails three independent mandatory gates:

1. no immutable deployment/source identity;
2. unobservable provider-internal retries;
3. no strict structured output schema.

It additionally exposes arbitrary fetch, prompts/resources/list changes,
provider analytics, and stateful cleanup requirements not supported by the
current audit service contract unchanged.

**Final provider result: `NO-GO`.**
