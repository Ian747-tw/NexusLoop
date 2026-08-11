# ADR-035 - Unified Model Profiles And Role Bindings

## Status

Accepted for Branch 9W4B0.

## Context

9W4A established two closed Commander model protocols with independent
connector, credential, audit, recovery, and lifecycle authority. OpenCode has a
different tactical provider runtime: it reads `auth.json`, loads and refreshes
`models.dev`, exposes `provider.list`, merges arbitrary provider/model options,
allows plugin mutation, loads npm and `file://` provider packages, and supports
primary, small, agent, command, compaction, and subagent model choices.

Users eventually need one vocabulary for saying that Commander and the primary
tactical Executor should use the same model selection or different selections.
Sharing selection intent must not make OpenCode provider support or
authentication Commander authority.

## Decision

### Three Concepts

The model-configuration schema version is `1`; its policy is
`nexusloop_model_profile_policy_v1`.

`ModelConnection` identifies one logical provider/account connection through
bounded semantic identifiers: normalized connection and provider kind, one
opaque credential-binding ID, and optional role-specific mappings. Commander
mapping identifies a current connector and static conformance entry. Executor
mapping identifies an exact OpenCode provider ID. A separately validated,
NexusLoop-owned Executor provider-mapping registry binds that exact provider ID
to one provider kind. No credential value, endpoint field, header field,
package field, plugin, option, callback, OAuth artifact, or catalog record is
accepted.

Credential-binding IDs use the explicit `credential-...` NexusLoop authority
grammar. They identify a future resolver entry; they are not provider tokens,
environment-variable names, authentication material, or OpenCode auth keys.

NexusLoop-owned connection, profile, binding, conformance, and provider-kind
identifiers normalize for semantic comparison. External connector IDs and
Commander/Executor provider IDs preserve exact case because their downstream
registries perform exact lookup; their case is therefore semantic authority.

`ModelProfile` binds an exact profile and connection to an exact case-preserved
model ID. The model ID is inert external identifier data: strings that resemble
URI schemes or host-and-port forms are not interpreted as endpoints, packages,
headers, or executable configuration. Optional display text is bounded and
non-semantic. Protocol, capability, limits, endpoint, authentication, and
package behavior are never inferred from the model name.

`RoleModelBinding` maps exactly `commander` or `executor` to a profile. Missing
roles are unconfigured; neither role falls back to the other. `executor` means
only OpenCode's primary tactical model. Small, title, summary, compaction,
command, agent, and subagent models require separately designed roles later.

### Snapshot And Validation

The pure kernel accepts allowlisted objects only, rejects duplicate normalized
identities and dangling references, canonicalizes unordered arrays, clones all
accepted values, and recursively freezes every nested object and array.
Arrays are reconstructed through dense own-index traversal into fresh plain
arrays. Sparse arrays, accessors, symbols, non-index properties, custom array
prototypes, and caller-owned `slice`, `map`, `sort`, or iterator behavior fail
closed without invocation. Records likewise require plain enumerable own-data
fields and are reconstructed with null prototypes so inherited properties
cannot become authority. Live and revoked proxies fail before array,
prototype, key, or descriptor reflection and before canonical hashing.
Canonical hashing accepts only dense plain JSON data.
Identifiers use bounded ASCII authority grammars. Authority fields reject URL,
credential, header, package, plugin, environment, path, wildcard, and control
material with bounded redacted errors. Model IDs use their own bounded exact
grammar, reject secrets, environment references, controls, wildcards, and
hierarchical URL syntax, and remain non-executable data even when their opaque
syntax resembles another identifier namespace.

Caller-owned objects are never retained. Display labels and remote catalog
observations cannot enter semantic hashes.

### Commander Projection

Commander projection requires:

1. an exact Commander binding;
2. its exact profile and connection;
3. Commander connector and conformance mapping;
4. an exact entry in a separately validated NexusLoop-owned conformance
   registry;
5. exact provider-kind and model-ID agreement;
6. a transport/provider pairing already permitted by the 9W4A closed protocol
   vocabulary.

The conformance registry policy is
`nexusloop_commander_conformance_policy_v1`. Entries bind conformance ID,
provider kind, transport kind, Commander provider ID, and exact model ID.
OpenCode config, auth, catalog, provider list, plugins, and loaded provider
objects are not inputs.

The output is credential-free selection data: profile/connection identity,
provider/model, connector, closed transport, conformance identity, component
hashes, and projection hash. `commander_verified` means static selection
conformance only; runtime readiness remains `role_readiness_unknown` in this
branch.

### Executor Projection

Executor projection requires an exact Executor binding, profile, connection,
provider mapping, and an exact provider-ID/provider-kind match in the static
Executor provider-mapping registry. The registry policy is
`nexusloop_executor_provider_mapping_policy_v1`; an entry may enumerate bounded
explicit aliases for one provider kind. Remote `provider.list`, OpenCode auth,
catalog data, and user assertions cannot create this authority. The projection
binds the selected mapping ID, mapping hash, and registry policy hash and
returns only exact provider/model selection plus credential authority and
semantic hashes. Availability and connectivity remain
`role_readiness_unknown`; this branch does not call `provider.list`, inspect
OpenCode auth, write configuration, or launch OpenCode.

### Shared Profile Semantics

When both roles bind one profile, they share only provider/model intent. Each
role retains separate authorization, credential resolution, provider
construction, context, tools, retry/streaming behavior, lifecycle, and network
boundary. Commander failure does not rewrite Executor selection. Executor
availability does not make Commander ready.

The opaque credential-binding ID identifies authority, not secret storage.
9W4B1 must prove role-specific resolution without Commander reading OpenCode
`auth.json` and without copying persistent secret material.

### Hashes

SHA-256 hashes use canonical JSON with sorted object keys and semantically
unordered arrays sorted before hashing. Accepted state exposes complete
connection, profile, binding, and configuration registry hashes. Connections
also expose role-specific authority hashes so one role's mapping does not stale
the other role's projection.

| Change | Commander projection | Executor projection |
| --- | --- | --- |
| Referenced shared profile model | changes | changes |
| Commander connector/conformance/policy | changes | unchanged |
| Executor provider binding | unchanged | changes |
| Selected Executor provider mapping/alias policy | unchanged | changes |
| Unrelated Executor provider mapping | unchanged | unchanged |
| Display label | unchanged | unchanged |
| OpenCode catalog/auth observation | unchanged | unchanged |
| Credential value behind same opaque ID | unchanged | unchanged |
| Opaque credential authority ID | changes | changes when referenced |
| Unrelated profile | unchanged | unchanged |

The complete configuration/profile registry hash changes for unrelated
registry membership, while unreferenced state does not enter either selected
role projection.

## Consequences

9W4B0 adds no RuntimeServer activation, environment adapter, command, UI,
credential resolution, provider object, request, readiness probe, event, or
recovery identity. Existing 9W4A configuration and recovery hashes remain
unchanged.

The sequence is:

- 9W4B0: immutable model profiles and pure role projections;
- 9W4B1: runtime registry, legacy Commander environment adapter, scoped
  Executor projection, independent credential resolution, and role readiness;
- 9W4C: native Gemini through this authority;
- 9W4D: native OpenAI Responses and verified compatibility matrix;
- 9W4E: first-run setup and TUI role-model selection;
- 9Y afterward.

9XB1 remains post-v1 and requires fresh provider requalification. Dynamic
provider authority, fallback, MCP, proposals, governance, and mutation remain
excluded. `resume_supported=false`, `provider_tool_loop_enabled=false`, and
`external_read_execution_enabled=false` remain unchanged.
