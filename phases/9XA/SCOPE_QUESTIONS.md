# 9XA Scope Questions

## Resolved from repository evidence

1. **May GitHub reads bypass Commander bindings?** No. ADR-021 and the existing
   `CommanderToolExecutor` make the binding registry the model-call execution
   seam. The gateway will be bound there.
2. **May GitHub use a new credential or HTTP subsystem?** No. The existing
   `ExternalApiRequestService` already owns connector policy, credential
   injection, transport cancellation, response limits, and audit events.
3. **Can the existing executor run a networked descriptor unchanged?** No. Its
   current preflight rejects `requires_network` and `external_read`; 9XA needs a
   narrow, explicit external-read execution mode with truthful result flags and
   no relaxation for any existing tool.
4. **Which operations are in scope?** Repository metadata, full-SHA commit
   metadata, PR metadata/files, issue metadata, exact-SHA checks, and PR review
   summaries/thread state only. Search, diffs, logs, mutations, and external
   research are excluded.
5. **Can response payloads be durable evidence?** No. ADR-025 journal working
   sets retain only bounded cards/digests/hashes; the gateway must normalize
   before results reach the controller.
6. **Can GitHub evidence influence authority?** No. Descriptors use
   `github_content_untrusted` and `instruction_semantics=none`.

## Implementation decisions

- GitHub repository targets will be exact lowercase `owner/repository` values
  selected from runtime configuration, never inferred from local Git state.
- The configured external connector is the sole transport authority. The public
  gateway status will expose only safe identity/readiness and hashed policy
  references.
- Pagination is gateway-owned with fixed per-operation request, page, item, and
  normalized-byte ceilings; caller inputs cannot alter those ceilings.
