# 9XB0 Scope Questions

## Decision

`NO-GO` for a 9XB1 production implementation against the evaluated hosted Exa
MCP service. No `external_research` placeholder is promoted.

The decision is not an invitation to choose a provider at runtime. A later
contract branch must identify one exact provider/deployment that closes every
blocker before implementation can begin.

## Resolved Questions

1. **Can 9XB use the existing Commander path?** Yes, and it must. ADR-018,
   ADR-021, ADR-024, ADR-025, and ADR-032 require curated descriptors, exact
   authority records, fixed bindings, `CommanderToolExecutor`, controller
   budgets, `ExternalApiRequestService`, bounded evidence, journal checkpoints,
   recovery compatibility, and RuntimeServer lifecycle drain.
2. **May the existing placeholders be treated as implemented contracts?** No.
   They are `future_external_read` registry entries with placeholder schemas and
   no binding or authority record.
3. **May remote discovery choose tools or schemas?** No. `tools/list` may only
   attest one runtime-owned expected tool name and exact schema hash. Its text,
   descriptions, annotations, and extra tools remain untrusted and invisible to
   the model.
4. **Is hosted Exa a pinned deployment?** No. On 2026-08-10 the hosted endpoint
   reported server version `3.2.1`, while the inspected official source revision
   `394f9210ed16d3e25d328e1e6db285824caedc04` declares package/server version
   `3.4.0`. The endpoint provides no source-revision attestation.
5. **Can hosted Exa search be audited completely?** No. NexusLoop can audit its
   MCP HTTP requests, but the hosted deployment does not attest its downstream
   request or retry policy. The unbound inspected source performs downstream
   Exa API calls and retries selected transient failures, but that behavior is
   not attributed to hosted `3.2.1`. Downstream attempts remain unknown.
6. **Does hosted Exa provide an operation-specific output contract?** No. The
   exact `2025-06-18` hosted `tools/list` entry has an input schema but no output
   schema. The unbound source returns formatted MCP text, but hosted result shape
   is unknown because no research tool was called.
7. **Can `external_research.source_show` map to `web_fetch_exa`?** No. The fixed
   hosted query did not attest that tool. Official docs and unbound source
   describe arbitrary URL arrays and full page text, not evidence-bound handles
   or an approved source-scope policy.
8. **Can `external_research.paper_metadata` be mapped?** No. The hosted fixed
   query attested only search, while official docs/source expose no exact typed
   paper-metadata operation. Search is not a substitute for bibliographic
   metadata.
9. **Can server annotations establish read authority?** No. `readOnlyHint=true`
   is a remote claim; NexusLoop authority must remain descriptor, binding, and
   runtime-policy owned.
10. **Can current `ExternalApiRequestService` implement a stateful MCP session
    unchanged?** No. It supports `GET | POST`, does not expose an allowlisted
    internal response-header view, and therefore cannot safely read an
    `Mcp-Session-Id` or perform audited `DELETE` cleanup.
11. **Should 9XB0 add an MCP SDK dependency?** No. The fit decision can be made
    without changing package metadata. Any later dependency and lockfile change
    requires explicit approval and must still route each request through the
    NexusLoop audit boundary.
12. **Can direct Exa REST be substituted?** Not in 9XB. It may offer a more
    structured transport, but it does not meet the stated MCP requirement and
    requires a separately authorized phase decision.
13. **Does exact MCP `2025-06-18` negotiation make hosted Exa suitable?** No.
    The superseding probe negotiated exact `2025-06-18`, but its one attested
    tool still had no output schema, initialize advertised forbidden dynamic and
    non-tool capabilities, and session DELETE returned HTTP 405. A prior
    `2025-03-26` echo proved only support for that requested revision and is not
    used as a maximum-version claim.
14. **Can a local real-CLI fixture use the existing test connector exception?**
    No. `allow_local_http` relaxes both HTTPS and private-host rejection, so it
    cannot prove the frozen transport policy. Provider requalification must
    include a deterministic HTTPS fixture origin that passes the same fixed
    origin, certificate, DNS/address, header, audit, and lifecycle checks without
    live mutable data or real credentials. No such fixture is currently
    approved.

## Blocking Facts Before A Future GO

- One deployment must attest an exact immutable server build or schema/policy
  identity that NexusLoop can verify before every call.
- The selected deployment must attest that provider-internal retries are zero or
  expose a truthful downstream-attempt ledger that NexusLoop can validate;
  hosted Exa's current behavior is unknown.
- The selected tool must return strict structured content under an exact output
  schema; a prose parser is not sufficient.
- The selected deployment must negotiate exact MCP `2025-06-18`; hosted Exa now
  passes this protocol-only condition but fails other authority gates.
- Initialize must attest the exact selected server name/version and only static
  tools capability with `listChanged=false`; any extra capability or identity
  drift blocks before another request.
- The outbound initialize request must use fixed client
  `nexusloop-commander-external-research@1.0.0`, empty client capabilities, and
  no caller/SDK-added fields; that request shape is recovery-bound.
- The transport must support auditable session initialization and cleanup with
  allowlisted response headers and no raw-header escape hatch.
- Initialize must expose its validated session ephemerally before audit append
  so mandatory cleanup survives audit persistence failure; no public/raw header
  or durable session field is allowed.
- The production HTTPS path must pin each validated DNS address through the
  connection while preserving original-host SNI/certificate/Host checks. Native
  fetch re-resolution is not approved; inability to prove pinning is a 9XB1
  `NO-GO`.
- Every MCP transport request requires a fresh pinned HTTP/1.1 TLS connection
  with `Connection: close`; pooling, multiplexing, coalescing, and cross-request
  reuse are not approved.
- Search source provenance must be citation-grade and bounded. `source_show`
  remains deferred until evidence-bound source handles or an exact domain policy
  exists.
- A production-faithful deterministic HTTPS E2E fixture must be approved; a
  loopback/private-address or `allow_local_http` exception is not acceptable.

The required authority shape is resolved. Provider capabilities, deterministic
fixture ownership, and validated-address transport fit remain explicit blockers
and produce `NO-GO`; they are not implementation flexibility.
