# ADR-032 - Commander bounded GitHub read gateway

## Status

Accepted for Branch 9XA.

## Context

Commander investigations have a bounded tool registry, a fixed binding
allowlist, a safe-read executor, configured external-request auditing, durable
checkpoints, and exact recovery compatibility. GitHub evidence is useful to an
investigation, but a generic REST/GraphQL client, ambient credentials, raw
payload persistence, or repository discovery would bypass those boundaries.

## Decision

9XA implements exactly six deferred `github_read` descriptors:

- `github.repository_get`
- `github.commit_get`
- `github.pull_request_get`
- `github.issue_get`
- `github.commit_checks`
- `github.pull_request_reviews`

The runtime-owned gateway accepts only an exact configured lowercase
`owner/repository` allowlist and fixed operation inputs. Exact commit operations
require a full lowercase SHA. There is no arbitrary endpoint, header, URL,
repository search, organization enumeration, or model-supplied GraphQL query.

The connector is a fixed GitHub API origin in production with runtime-owned
credential references. Test connectors may be explicitly local. The gateway
uses only fixed GET paths plus one fixed review-thread GraphQL POST, bounded
request/page/item/normalized-byte ceilings, cancellation checks between pages,
and one existing external API audit outcome per attempted request.

Responses are converted immediately to typed, redacted, bounded untrusted
evidence with repository-bound provenance and hashes. Review thread output
distinguishes resolved, outdated, and current unresolved state. Truncation is
explicit and cannot prove clean CI or review state. Raw payloads, credentials,
headers, prompts, schemas, diffs, tool results, and response bodies are never
stored in Commander journal state.

The existing controller, binding registry, safe-read executor, tool budget,
checkpoint, and recovery machinery remain the only execution path. Each
external request consumes existing tool-call capacity. Gateway policy identity
is included in the recovery execution envelope so changed repository scope or
transport policy stales recovery authority. Historical requests are never
replayed automatically.

The existing Commander tool-summary surface may show bounded gateway readiness.
There is no direct GitHub slash-command family, GitHub mutation, public
provider-loop activation, governance authority, or automatic investigation.

## Consequences

GitHub content is evidence only with `instruction_semantics=none`; it cannot
alter policy, permissions, approvals, recovery authority, or execution state.
Runtime lifecycle cancellation and configured-investigation draining own the
request signal, so no next page begins after abort and no result is authoritative
without its audit.

9XB owns external research/MCP reads. 9Y owns evidence-backed proposal
authority. 9Z owns GitHub governance intents and mutations. `resume_supported`
and the broad `provider_tool_loop_enabled` flag remain false.
