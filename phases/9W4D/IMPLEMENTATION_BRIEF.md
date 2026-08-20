# 9W4D Implementation Brief

1. Add `@ai-sdk/openai@4.0.15` only to the runtime manifest/lock.
2. Extend the closed Commander transport union with
   `openai_responses_connector`; add adapter/request/audit policy identities.
3. Add Commander conformance policy v3. Preserve v1/v2 behavior and hashes;
   require v3 for Responses while admitting earlier protocols in mixed v3 registries.
4. Construct the explicit Responses model with a canonical base, fixed sentinel,
   custom audited fetch, and runtime-owned `store:false` provider option.
5. Extend the connector bridge with exact bearer-sentinel handling, exact
   `/responses` request validation, strict response validation, and
   protocol-shaped HTTP failure synthesis.
6. Bind transport policy into existing readiness/execution-envelope/recovery
   identity through the existing closed transport metadata.
7. Add a pure immutable compatibility matrix under model configuration, export
   package-only types/functions, and test that it cannot create authority.
8. Add focused adapter, connector, conformance, matrix, recovery, cancellation,
   shutdown, and unchanged-provider regressions.
9. Add a real headless-TUI recovery scenario using a deterministic local
   Responses server through the production connector path.
10. Add ADR-038 and update architecture/provider documentation with implemented facts.

