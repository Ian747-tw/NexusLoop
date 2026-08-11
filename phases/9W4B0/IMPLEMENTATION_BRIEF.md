# Branch 9W4B0 Implementation Brief

## Files

Add package-internal types and pure functions under
`agentcore/runtime/src/model-configuration/`, with a dedicated unit test in the
same directory. Export only credential-free types/functions from the runtime
package if required for later composition; add no server wiring.

## Schema

- schema version: `1`;
- policy version: `nexusloop_model_profile_policy_v1`;
- connection: normalized connection/provider/credential authority identifiers
  plus optional Commander connector/conformance and Executor provider mapping;
- profile: normalized profile/connection IDs, exact model ID, optional display
  label;
- binding: exact `commander | executor` role and profile ID;
- configuration: bounded arrays of those records.

## Pure Authority Inputs

Commander conformance is a separate NexusLoop-owned registry. Every entry binds
an exact conformance ID, provider kind, transport kind, Commander provider ID,
and exact model ID. It is not OpenCode or user catalog data.

Executor provider mapping is a second NexusLoop-owned registry. Every entry
binds bounded exact provider-ID aliases to one provider kind. Its selected
mapping and policy hashes are Executor projection authority; `provider.list`,
OpenCode authentication, and caller assertions are not inputs.

## Projections

- Commander: role/profile/connection identity, exact provider kind/model,
  connector mapping, closed transport, static conformance identity, semantic
  component hashes, and projection hash.
- Executor: role/profile/connection identity, exact OpenCode provider/model
  selection, validated provider mapping identity, opaque credential-binding
  identity, semantic component hashes, and projection hash.

Missing bindings or mappings fail closed. Shared profiles share selection only.

## Validation And Immutability

Reject unknown keys, duplicate normalized IDs, dangling references, duplicate
roles, provider-kind/mapping disagreement, malformed/bounded identifiers, and
secret/environment/control material. Authority fields cannot carry endpoints,
headers, packages, or plugins. Exact model IDs are inert bounded identifiers,
not a second endpoint/package grammar. Snapshot, canonicalize unordered arrays,
and recursively freeze every object and array. Reconstruct arrays only through
trusted dense own-index traversal; reject sparse, accessor-bearing,
symbol-bearing, non-index, and custom-prototype arrays without invoking
caller-owned methods or iterators. Canonical hashes accept plain JSON data only.

## Hashes

Use deterministic SHA-256 over canonical JSON. Display metadata and remote
catalog observations are non-semantic. Role projections include only common
selection identity and their own role-specific mapping/policy, so role-only
drift does not stale the other projection.

## Tests

Cover shared/different/missing role bindings, static Commander conformance,
OpenCode observation non-authority, strict parsing, duplicates/dangling refs,
deep immutability and caller mutation, hash canonicalization and invalidation,
and unchanged existing 9W4A/recovery tests. No E2E scenario is added because no
user surface exists; the complete historical suite remains a regression gate.

## Follow-On

- 9W4B1: runtime registry, legacy Commander environment adapter, scoped
  Executor projection, independent credential resolution, and role readiness.
- 9W4C: native Gemini through this profile authority.
- 9W4D: native OpenAI Responses and verified compatibility matrix.
- 9W4E: first-run setup and TUI role-model selection.
- 9Y follows; 9XB1 remains post-v1 and requires requalification.
