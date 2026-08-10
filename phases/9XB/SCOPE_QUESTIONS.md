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
   MCP HTTP requests, but Exa's `web_search_exa` performs downstream Exa API
   calls behind the hosted boundary and retries transient 500/502/503/504
   failures up to two times. Those attempts are not observable to NexusLoop.
6. **Does hosted Exa provide an operation-specific output contract?** No. The
   observed `tools/list` entry has an input schema but no output schema, and the
   pinned `web_search_exa` implementation returns formatted MCP text rather than
   structured content.
7. **Can `external_research.source_show` map to `web_fetch_exa`?** No. The remote
   tool accepts arbitrary URL arrays and returns full page text. Evidence-bound
   handles and an exact source-scope policy do not exist.
8. **Can `external_research.paper_metadata` be mapped?** No. Exa exposes no exact
   paper-metadata operation. Search is not a substitute for typed bibliographic
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

## Blocking Facts Before A Future GO

- One deployment must attest an exact immutable server build or schema/policy
  identity that NexusLoop can verify before every call.
- The selected remote tool must disable provider-internal retries or expose a
  truthful downstream-attempt ledger that NexusLoop can validate.
- The selected tool must return strict structured content under an exact output
  schema; a prose parser is not sufficient.
- The transport must support auditable session initialization and cleanup with
  allowlisted response headers and no raw-header escape hatch.
- Search source provenance must be citation-grade and bounded. `source_show`
  remains deferred until evidence-bound source handles or an exact domain policy
  exists.

There are no unresolved implementation choices inside this branch. The
unresolved provider capabilities are blockers and produce `NO-GO`.

